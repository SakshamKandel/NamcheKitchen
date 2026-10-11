import { digest, sameOrigin, rateLimit, session } from '@/lib/auth';
import { completeOwnerAI, type GroqMessage, type GroqTool } from '@/lib/ai';
import { menuSchema } from '@/lib/validation';
import {
  allMenuItems,
  clientRateLimitKey,
  menuMutationSchema,
  ownerChatBodySchema,
  storeChatImage,
  visibilitySchema,
} from '@/lib/chat';
import { sql, type MenuItem } from '@/lib/db';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ownerTools: GroqTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_menu',
      description: 'List every menu item, including hidden items, with IDs and image IDs.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_menu_item',
      description: 'Read one complete menu item from the database after list_menu provides its ID.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['id'],
        properties: { id: { type: 'string', maxLength: 150 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_menu_item',
      description: 'Create or update one menu item. Include confirmed=true only after the owner clearly confirms applying the proposed change. For an existing item include its id; for a new item include name and category.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['confirmed'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          kind: { type: 'string', enum: ['food', 'drink'] },
          price: { type: ['number', 'null'] },
          price_note: { type: 'string' },
          image_id: { type: ['string', 'null'] },
          available: { type: 'boolean' },
          featured: { type: 'boolean' },
          sort_order: { type: 'integer' },
          confirmed: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_menu_visibility',
      description: 'Show, hide, or feature one menu item. Include confirmed=true only after the owner clearly confirms the change.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'confirmed'],
        properties: {
          id: { type: 'string' },
          available: { type: 'boolean' },
          featured: { type: 'boolean' },
          confirmed: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upload_menu_image',
      description: 'Save the owner-provided image attachment and optionally attach it to a menu item. Include confirmed=true only after the owner clearly confirms the upload.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['confirmed'],
        properties: {
          confirmed: { type: 'boolean' },
          menu_item_id: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reservations',
      description: 'Read recent reservation requests for the owner. This does not contact guests or change their status.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
  },
];

const ownerSystem = () => `You are the private Namche Kitchen owner assistant. The authenticated owner is the only person who can use this route.
You can inspect the full menu and recent reservation requests. You can propose menu edits, visibility changes, and image uploads through the safe tools below.
Before any menu change or menu-specific answer, call list_menu so you use the current item IDs and values.
When the owner asks for a change, call the relevant mutation tool with confirmed=false to prepare a proposal. Never save from chat text, including “yes” or “go ahead”. The server returns a proposal and the owner must use the dedicated confirmation button to authorize that exact write.
Use the existing item id when editing. Never invent an image id. For a new item, require at least a name and category and use sensible defaults only after the owner confirms. Keep prices in CAD; null means ask the server. Uploaded images are processed as WebP.
Do not reveal credentials, API keys, cookies, SQL, or internal implementation details. Be concise and report the result of every tool call accurately.`;

type ProposalPayload = { adminId: string; tool: string; args: unknown; expiresAt: number; attachmentHash?: string };

function confirmationSecret() {
  const configured = process.env.AI_CONFIRMATION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('AI_CONFIRMATION_SECRET is required in production.');
  return process.env.GROQ_API_KEY?.trim() || 'namche-owner-confirmation-dev';
}

function attachmentHash(attachment: { data: string } | undefined) {
  return attachment ? createHash('sha256').update(attachment.data).digest('hex') : undefined;
}

function signProposal(payload: ProposalPayload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', confirmationSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyProposal(token: string, adminId: string): ProposalPayload | null {
  try {
    const [encoded, suppliedSignature] = token.split('.');
    if (!encoded || !suppliedSignature) return null;
    const expectedSignature = createHmac('sha256', confirmationSecret()).update(encoded).digest('base64url');
    const expected = Buffer.from(expectedSignature);
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ProposalPayload;
    if (payload.adminId !== adminId || payload.expiresAt < Date.now() || typeof payload.tool !== 'string' || !payload.args) return null;
    return payload;
  } catch {
    return null;
  }
}

function proposalSummary(tool: string, args: unknown) {
  const data = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {};
  if (tool === 'upsert_menu_item') {
    const name = typeof data.name === 'string' ? data.name : typeof data.id === 'string' ? data.id : 'this menu item';
    const fields = ['name', 'description', 'category', 'kind', 'price', 'price_note', 'image_id', 'available', 'featured', 'sort_order']
      .filter(field => field in data)
      .map(field => `${field}: ${String(data[field])}`);
    return `${data.id ? 'Update' : 'Create'} “${name}”${fields.length ? ` · ${fields.join(' · ')}` : ''}`;
  }
  if (tool === 'set_menu_visibility') {
    const changes = ['available', 'featured'].filter(field => field in data).map(field => `${field}: ${String(data[field])}`);
    return `Change visibility for ${String(data.id || 'this menu item')}${changes.length ? ` · ${changes.join(', ')}` : ''}`;
  }
  if (tool === 'upload_menu_image') return `Upload this image${data.menu_item_id ? ` and attach it to ${String(data.menu_item_id)}` : ''}`;
  return 'Apply this owner change';
}

function text(value: string | null | undefined) {
  return value?.trim() || 'I can inspect the menu and reservations or prepare a change for your confirmation.';
}

type ToolResult = { ok: boolean; message?: string; [key: string]: unknown };
type PendingProposal = { tool: string; args: unknown };

function pendingProposal(changes: ToolResult[], adminId: string, attachment: { data: string } | undefined) {
  const candidate = changes.find(change => change.requires_confirmation === true && change.proposal && typeof change.proposal === 'object')?.proposal as PendingProposal | undefined;
  if (!candidate || !candidate.tool) return undefined;
  const hash = candidate.tool === 'upload_menu_image' ? attachmentHash(attachment) : undefined;
  return {
    tool: candidate.tool,
    summary: proposalSummary(candidate.tool, candidate.args),
    token: signProposal({ adminId, tool: candidate.tool, args: candidate.args, expiresAt: Date.now() + 10 * 60 * 1000, ...(hash ? { attachmentHash: hash } : {}) }),
  };
}

async function runOwnerTool(name: string, rawArgs: unknown, attachment: { type: string; data: string } | undefined, writeAuthorized: boolean): Promise<ToolResult> {
  if (name === 'list_menu') {
    const items = await allMenuItems();
    // Keep the model context below provider TPM limits. The database still
    // holds complete values; get_menu_item reads one full row when needed.
    return { ok: true, items: items.map(item => ({ id: item.id, name: item.name, category: item.category, kind: item.kind, price: item.price, image_id: item.image_id, available: item.available, featured: item.featured, sort_order: item.sort_order })) };
  }
  if (name === 'get_menu_item') {
    const id = typeof rawArgs === 'object' && rawArgs !== null && typeof (rawArgs as { id?: unknown }).id === 'string'
      ? (rawArgs as { id: string }).id.trim() : '';
    if (!id) return { ok: false, message: 'Provide a menu item id from list_menu.' };
    const rows = await sql<MenuItem[]>`select * from namche.menu_items where id=${id} limit 1`;
    if (!rows.length) return { ok: false, message: 'I could not find that menu item id.' };
    return { ok: true, item: rows[0] };
  }
  if (name === 'list_reservations') {
    const parsed = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs as { limit?: unknown } : {};
    const limit = typeof parsed.limit === 'number' && Number.isInteger(parsed.limit) ? Math.min(100, Math.max(1, parsed.limit)) : 50;
    const rows = await sql`select id,name,email,phone,to_char(date,'YYYY-MM-DD') as date,to_char(time,'HH24:MI') as time,guests,notes,status,created_at from namche.reservations order by date desc,time desc,created_at desc limit ${limit}`;
    return { ok: true, reservations: rows };
  }

  // Do not issue a confirmation token for an upload that has no immutable
  // attachment to bind to it.
  if (name === 'upload_menu_image' && !attachment) {
    return { ok: false, message: 'Attach a JPG, PNG, or WebP image before I prepare an upload.' };
  }

  if (!writeAuthorized) {
    return { ok: false, requires_confirmation: true, proposal: { tool: name, args: rawArgs }, message: 'No change was saved. Review the proposed change and use the confirmation button to apply it.' };
  }
  if (name === 'upsert_menu_item') {
    const candidateArgs = typeof rawArgs === 'object' && rawArgs !== null ? { ...(rawArgs as Record<string, unknown>), confirmed: true } : rawArgs;
    const args = menuMutationSchema.safeParse(candidateArgs);
    if (!args.success) {
      return { ok: false, message: args.error.issues[0]?.message || 'Invalid menu change.' };
    }
    const { id: requestedId, ...changes } = args.data;
    const existing = requestedId
      ? (await sql<MenuItem[]>`select * from namche.menu_items where id=${requestedId} limit 1`)[0]
      : undefined;
    if (requestedId && !existing) return { ok: false, message: 'I could not find that menu item id.' };
    const base = existing || {
      id: requestedId || randomUUID(), name: '', description: '', category: 'Uncategorized', kind: 'food' as const,
      price: null, price_note: '', image_id: null, available: true, featured: false, sort_order: 100,
    };
    const candidate = { ...base, ...changes, id: undefined };
    // Postgres drivers may expose numeric columns as strings depending on the
    // configured type parser; normalize the two numeric fields before zod.
    if (candidate.price !== null && candidate.price !== undefined) candidate.price = Number(candidate.price);
    if (candidate.sort_order !== undefined) candidate.sort_order = Number(candidate.sort_order);
    const data = menuSchema.safeParse(candidate);
    if (!data.success) return { ok: false, message: data.error.issues[0]?.message || 'The menu item needs a name and category.' };
    if (data.data.image_id) {
      const image = await sql`select id from namche.images where id=${data.data.image_id} limit 1`;
      if (!image.length) return { ok: false, message: 'That image id does not exist. Upload or choose an existing image first.' };
    }
    await sql`insert into namche.menu_items ${sql({ id: base.id, ...data.data })} on conflict(id) do update set ${sql({ ...data.data, updated_at: new Date() })}`;
    const saved = (await sql<MenuItem[]>`select * from namche.menu_items where id=${base.id}`)[0];
    return { ok: true, message: existing ? 'Menu item updated.' : 'Menu item created.', item: saved };
  }

  if (name === 'set_menu_visibility') {
    const candidateArgs = typeof rawArgs === 'object' && rawArgs !== null ? { ...(rawArgs as Record<string, unknown>), confirmed: true } : rawArgs;
    const args = visibilitySchema.safeParse(candidateArgs);
    if (!args.success) return { ok: false, message: args.error.issues[0]?.message || 'Invalid visibility change.' };
    if (!args.data.confirmed) return { ok: false, requires_confirmation: true, message: 'The owner must confirm this visibility change.' };
    if (args.data.available === undefined && args.data.featured === undefined) return { ok: false, message: 'Choose Available or Featured before saving.' };
    const rows = await sql<MenuItem[]>`select * from namche.menu_items where id=${args.data.id} limit 1`;
    if (!rows.length) return { ok: false, message: 'I could not find that menu item id.' };
    const item = rows[0];
    const available = args.data.available ?? item.available;
    const featured = args.data.featured ?? item.featured;
    await sql`update namche.menu_items set available=${available},featured=${featured},updated_at=now() where id=${args.data.id}`;
    return { ok: true, message: 'Menu visibility saved.', item: { ...item, available, featured } };
  }

  if (name === 'upload_menu_image') {
    if (!attachment) return { ok: false, message: 'Attach a JPG, PNG, or WebP image before asking me to upload it.' };
    const candidateArgs = typeof rawArgs === 'object' && rawArgs !== null ? { ...(rawArgs as Record<string, unknown>), confirmed: true } : rawArgs;
    const parsedArgs = z.object({ confirmed: z.boolean(), menu_item_id: z.string().max(150).optional() }).safeParse(candidateArgs);
    if (!parsedArgs.success) return { ok: false, message: 'Invalid image upload request.' };
    const itemId = parsedArgs.data.menu_item_id;
    if (itemId) {
      const rows = await sql`select id from namche.menu_items where id=${itemId} limit 1`;
      if (!rows.length) return { ok: false, message: 'That menu item id does not exist. The image was not saved.' };
    }
    let imageId: string;
    try {
      imageId = await storeChatImage(attachment);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'The image could not be uploaded.' };
    }
    if (itemId) {
      await sql`update namche.menu_items set image_id=${imageId},updated_at=now() where id=${itemId}`;
    }
    return { ok: true, message: 'Image uploaded.', image_id: imageId };
  }
  return { ok: false, message: 'That owner action is not available.' };
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
    const admin = await session();
    if (!admin) return Response.json({ error: 'Owner sign-in required.' }, { status: 401 });
    if (!await rateLimit(clientRateLimitKey(request, `chat:owner:${admin.id}`), 60, 15)) {
      return Response.json({ error: 'Too many owner chat requests. Please try again in a few minutes.' }, { status: 429 });
    }
    const raw = await request.text();
    // An owner may attach one 5 MB source image as a base64 data URL. Keep a
    // bounded envelope for that attachment while still limiting chat history.
    if (raw.length > 8_500_000) return Response.json({ error: 'Chat request is too large.' }, { status: 413 });
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return Response.json({ error: 'Send a valid JSON chat request.' }, { status: 400 });
    }
    const parsed = ownerChatBodySchema.safeParse(input);
    if (!parsed.success || !parsed.data.messages.some(item => item.role === 'user')) {
      return Response.json({ error: 'Send at least one owner message.' }, { status: 400 });
    }
    if (parsed.data.confirmationToken) {
      if (parsed.data.confirm !== true) return Response.json({ error: 'Use the confirmation button to apply this proposal.' }, { status: 400 });
      const proposal = verifyProposal(parsed.data.confirmationToken, admin.id);
      if (!proposal) return Response.json({ error: 'This proposal expired. Ask the assistant to prepare it again.' }, { status: 400 });
      if (proposal.attachmentHash && proposal.attachmentHash !== attachmentHash(parsed.data.image)) {
        return Response.json({ error: 'The attached image changed or is missing. Ask the assistant to prepare the upload again.' }, { status: 400 });
      }
      if (!await rateLimit(`chat:owner-confirm:${digest(parsed.data.confirmationToken)}`, 1, 10)) {
        return Response.json({ error: 'This confirmation was already used. Ask the assistant to prepare the change again.' }, { status: 409 });
      }
      const result = await runOwnerTool(proposal.tool, proposal.args, parsed.data.image, true);
      return Response.json({ message: result.message || (result.ok ? 'Change saved.' : 'The change was not saved.'), changes: [result], committed: result.ok });
    }
    // Assistant messages come from the browser and are display history only;
    // never let them become model instructions or a source of database truth.
    const incoming = parsed.data.messages.filter(item => item.role === 'user').slice(-12);
    const attachmentNote = parsed.data.image
      ? `\nOWNER ATTACHMENT: An image is attached to this request. It is not stored unless a mutation is explicitly confirmed. If the owner wants it saved, ask for a clear confirmation, then call upload_menu_image.`
      : '';
    const messages: GroqMessage[] = [
      { role: 'system', content: ownerSystem() + attachmentNote },
      ...incoming.map(item => ({ role: item.role, content: item.content }) as GroqMessage),
    ];
    const aiDeadline = Date.now() + 75_000;
    let completion = await completeOwnerAI(messages, { tools: ownerTools, parallelToolCalls: false, maxTokens: 550, temperature: 0.15, deadlineMs: aiDeadline });
    const changes: ToolResult[] = [];
    for (let round = 0; round < 3; round++) {
      const calls = completion.message.tool_calls || [];
      if (!calls.length) {
        return Response.json({ message: text(completion.message.content), model: completion.model, changes, proposal: pendingProposal(changes, admin.id, parsed.data.image) });
      }
      const firstCall = calls[0];
      // A provider may still return parallel calls despite the request hint.
      // Keep only the call we execute so every assistant tool_call has a
      // matching tool result in the next provider request.
      messages.push(calls.length === 1 ? completion.message : { ...completion.message, tool_calls: [firstCall] });
      // Process one tool at a time so a single confirmation card represents
      // one exact database write. Read tools can be called on the next turn.
      for (const call of calls.slice(0, 1)) {
        if (call.type !== 'function') continue;
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
        const result = await runOwnerTool(call.function.name, args, parsed.data.image, false);
        changes.push(result);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      // A final no-tools turn gives the owner a natural-language summary and
      // prevents the model from issuing an unbounded chain of mutations.
      if (round === 2) {
        completion = await completeOwnerAI(messages, { tools: ownerTools, toolChoice: 'none', maxTokens: 550, temperature: 0.15, deadlineMs: aiDeadline });
      } else {
        completion = await completeOwnerAI(messages, { tools: ownerTools, parallelToolCalls: false, maxTokens: 550, temperature: 0.15, deadlineMs: aiDeadline });
      }
    }
    return Response.json({ message: text(completion.message.content), model: completion.model, changes, proposal: pendingProposal(changes, admin.id, parsed.data.image) });
  } catch (error) {
    console.error('Owner chat failed', error);
    return Response.json({ error: 'The owner assistant is temporarily unavailable.' }, { status: 503 });
  }
}

