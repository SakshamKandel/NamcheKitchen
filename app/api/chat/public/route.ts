import { sameOrigin, rateLimit } from '@/lib/auth';
import { completeGroq, type GroqMessage, type GroqTool } from '@/lib/ai';
import {
  availableMenuItems,
  chatBodySchema,
  clientRateLimitKey,
  createChatReservation,
} from '@/lib/chat';
import { compactPublicMenuContext, publicChatMessages, publicConversationHistory } from '@/lib/public-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reservationTool: GroqTool = {
  type: 'function',
  function: {
    name: 'create_reservation',
    description: 'Prepare or submit a table reservation. Never submit until the guest has explicitly confirmed the complete details.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'email', 'phone', 'date', 'time', 'guests', 'notes', 'confirmed'],
      properties: {
        name: { type: 'string', description: 'Guest name' },
        email: { type: 'string', description: 'Guest email address' },
        phone: { type: 'string', description: 'Guest phone number' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Ottawa local time in HH:MM format' },
        guests: { type: 'integer', minimum: 1, maximum: 20 },
        notes: { type: 'string', description: 'Optional dietary or seating notes' },
        confirmed: { type: 'boolean', description: 'True only when the guest has clearly said to submit the request' },
      },
    },
  },
};

function messageText(value: string | null | undefined) {
  return value?.trim() || 'I can help with the menu or a table reservation. What would you like to know?';
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
    if (!await rateLimit(clientRateLimitKey(request, 'chat:public'), 20, 15)) {
      return Response.json({ error: 'Too many chat requests. Please try again in a few minutes.' }, { status: 429 });
    }
    const raw = await request.text();
    if (raw.length > 30_000) return Response.json({ error: 'Chat request is too large.' }, { status: 413 });
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return Response.json({ error: 'Send a valid JSON chat request.' }, { status: 400 });
    }
    const parsed = chatBodySchema.safeParse(input);
    if (!parsed.success || !parsed.data.messages.some(item => item.role === 'user')) {
      return Response.json({ error: 'Send at least one guest message.' }, { status: 400 });
    }
    if (parsed.data.image) return Response.json({ error: 'Public chat cannot upload or edit menu images.' }, { status: 403 });
    // Keep replies so short follow-ups remain meaningful. The helper marks
    // browser history as context only; authoritative menu data stays in DB.
    const incoming = publicConversationHistory(parsed.data.messages);
    const latestUserMessage = [...incoming].reverse().find(item => item.role === 'user')?.content || '';
    const menu = await availableMenuItems();
    const messages: GroqMessage[] = publicChatMessages(compactPublicMenuContext(menu), incoming);
    let completion = await completeGroq(messages, { tools: [reservationTool], parallelToolCalls: false, maxTokens: 800, temperature: 0.2 });
    const toolCalls = completion.message.tool_calls || [];
    if (!toolCalls.length) {
      return Response.json({ message: messageText(completion.message.content), model: completion.model });
    }

    // Public chat exposes one deliberately narrow tool. Every invocation is
    // validated again on the server, including the explicit confirmation.
    const toolResults: Array<{ ok: boolean; id?: string; status?: string; message: string }> = [];
    const firstCall = toolCalls[0];
    messages.push(toolCalls.length === 1 ? completion.message : { ...completion.message, tool_calls: [firstCall] });
    for (const call of [firstCall]) {
      if (call.type !== 'function' || call.function.name !== 'create_reservation') continue;
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = {};
      }
      const result = await createChatReservation(args, latestUserMessage);
      toolResults.push(result);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
    if (!toolResults.length) {
      return Response.json({ message: 'I could not process that reservation request. Please share the details again.', model: completion.model });
    }
    let finalMessage: string;
    let model = completion.model;
    try {
      completion = await completeGroq(messages, { tools: [reservationTool], toolChoice: 'none', maxTokens: 650, temperature: 0.2 });
      finalMessage = messageText(completion.message.content);
      model = completion.model;
    } catch {
      finalMessage = toolResults[0].message;
    }
    const saved = toolResults.find(result => result.ok && result.id);
    return Response.json({
      message: finalMessage,
      model,
      ...(saved ? { reservation: { id: saved.id, status: saved.status } } : {}),
    });
  } catch (error) {
    console.error('Public chat failed', error);
    return Response.json({ error: 'The chat assistant is temporarily unavailable. Please call us for help.' }, { status: 503 });
  }
}

