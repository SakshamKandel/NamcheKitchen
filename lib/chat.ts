import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { digest, rateLimit } from '@/lib/auth';
import { sql, type MenuItem } from '@/lib/db';
import { reservationSchema } from '@/lib/validation';
import { sendReservationEmails } from '@/lib/email';
import { createReservation, isReservationDateClosed } from './reservations';
import { CLOSED_DATE_MESSAGE } from './reservation-dates';

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(5000),
});

export const chatBodySchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(30),
  // Owner chat can send a cropped image from the browser.  It is intentionally
  // a separate attachment rather than executable content in the message.
  image: z.object({
    name: z.string().trim().max(160).optional(),
    type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    data: z.string().min(1).max(8_000_000),
  }).optional(),
});

export const ownerChatBodySchema = chatBodySchema.extend({
  // Signed proposals may include a full menu description (up to 2,000
  // characters) and therefore need more room than a short chat message.
  confirmationToken: z.string().trim().min(20).max(16_000).optional(),
  confirm: z.boolean().optional(),
});

export const chatReservationSchema = reservationSchema.extend({
  confirmed: z.boolean().optional().default(false),
});

export const menuMutationSchema = z.object({
  confirmed: z.boolean().default(false),
  id: z.string().trim().max(150).optional(),
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().min(2).max(80).optional(),
  kind: z.enum(['food', 'drink']).optional(),
  price: z.number().min(0).max(9999).nullable().optional(),
  price_note: z.string().max(200).optional(),
  image_id: z.string().max(150).nullable().optional(),
  available: z.boolean().optional(),
  featured: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
});

export const visibilitySchema = z.object({
  confirmed: z.boolean().default(false),
  id: z.string().trim().min(1).max(150),
  available: z.boolean().optional(),
  featured: z.boolean().optional(),
});

export type ChatBody = z.infer<typeof chatBodySchema>;

export function clientRateLimitKey(request: Request, scope: string) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || request.headers.get('x-real-ip') || 'unknown-client';
  return `${scope}:${digest(address).slice(0, 32)}`;
}

export function menuPromptContext(items: MenuItem[]) {
  return JSON.stringify(items.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    kind: item.kind,
    price: item.price,
    price_note: item.price_note,
    image_id: item.image_id,
    available: item.available,
    featured: item.featured,
    sort_order: item.sort_order,
  })));
}

export function publicMenuPromptContext(items: MenuItem[]) {
  return JSON.stringify(items.map(item => ({
    name: item.name,
    description: item.description,
    category: item.category,
    kind: item.kind,
    price: item.price,
    price_note: item.price_note,
  })));
}

export function ownerMenuPromptContext(items: MenuItem[]) {
  return JSON.stringify(items.map(item => ({
    id: item.id,
    name: item.name,
    description: item.description.slice(0, 220),
    category: item.category,
    kind: item.kind,
    price: item.price,
    price_note: item.price_note,
    image_id: item.image_id,
    available: item.available,
    featured: item.featured,
    sort_order: item.sort_order,
  })));
}

export async function allMenuItems() {
  return sql<MenuItem[]>`select * from namche.menu_items order by kind, sort_order, name`;
}

export async function availableMenuItems() {
  const [food, drinks] = await Promise.all([
    sql<MenuItem[]>`select * from namche.menu_items where kind='food' and available=true order by sort_order,name`,
    sql<MenuItem[]>`select * from namche.menu_items where kind='drink' and available=true order by sort_order,name`,
  ]);
  return [...food, ...drinks];
}

function hasExplicitConfirmation(message: string) {
  return /\b(yes|yeah|yep|confirm(?:ed)?|book it|go ahead|submit|reserve it|make the reservation)\b/i.test(message);
}

export type ChatReservationResult =
  | { ok: true; id: string; status: 'pending'; message: string }
  | { ok: false; requires_confirmation: true; message: string }
  | { ok: false; message: string };

/** Validate and, only after an explicit confirmation, save a chat reservation. */
export async function createChatReservation(
  raw: unknown,
  latestUserMessage: string,
): Promise<ChatReservationResult> {
  const parsed = chatReservationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message || 'Please provide all reservation details.' };
  }
  const data = parsed.data;
  if (await isReservationDateClosed(data.date)) {
    return { ok: false, message: CLOSED_DATE_MESSAGE };
  }
  if (!data.confirmed || !hasExplicitConfirmation(latestUserMessage)) {
    return {
      ok: false,
      requires_confirmation: true,
      message: 'I have the reservation details ready. Ask the guest to confirm that they want me to submit this request before saving it.',
    };
  }
  if (!await rateLimit('booking:' + digest(data.email.toLowerCase()), 3, 60)
    || !await rateLimit('bookings-global', 100, 60)) {
    return { ok: false, message: 'Too many reservation requests right now. Please call us to arrange your table.' };
  }
  const id = await createReservation(data);
  if (!id) return { ok: false, message: CLOSED_DATE_MESSAGE };
  try {
    await sendReservationEmails({ ...data, id, status: 'pending' });
  } catch (error) {
    console.error('Chat reservation email delivery failed', error);
  }
  return {
    ok: true,
    id,
    status: 'pending',
    message: 'Your reservation request is saved. Our team will contact you to confirm the table.',
  };
}

/**
 * Store a browser-provided cropped image using the same processing as the
 * staff uploader.  Only a base64 data URL (or base64 with an explicit MIME
 * type) is accepted, so the AI route cannot be used as an arbitrary URL proxy.
 */
export async function storeChatImage(input: { type: string; data: string }) {
  let mime = input.type;
  let base64 = input.data;
  const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(base64);
  if (dataUrl) {
    mime = dataUrl[1];
    base64 = dataUrl[2];
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  const compact = base64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error('Invalid image data.');
  const source = Buffer.from(compact, 'base64');
  if (!source.length || source.length > 5 * 1024 * 1024) throw new Error('Image must be under 5 MB.');
  const data = await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1400, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  const id = randomUUID();
  await sql`insert into namche.images(id,mime,data) values(${id},'image/webp',${data})`;
  return id;
}

