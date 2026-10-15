import { z } from 'zod';
import { sameOrigin, session } from '@/lib/auth';
import { isCalendarDate, isReservationDate } from '@/lib/reservation-dates';
import { closeReservationDate, reopenReservationDate, reservationClosures } from '@/lib/reservations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const dateSchema = z.string().refine(isCalendarDate, { message: 'Choose a valid date.' });
const closeSchema = z.object({
  date: dateSchema.refine(value => isReservationDate(value), { message: 'Choose a date within the next six months.' }),
  reason: z.string().trim().max(300).default(''),
});
const reopenSchema = z.object({ date: dateSchema });
const noStore = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    if (!await session()) return Response.json({ error: 'Please sign in.' }, { status: 401, headers: noStore });
    return Response.json(await reservationClosures(), { headers: noStore });
  } catch {
    return Response.json({ error: 'Unable to load closed dates. Please try again.' }, { status: 503, headers: noStore });
  }
}

async function changeClosure(request: Request, reopen: boolean) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
    const admin = await session();
    if (!admin) return Response.json({ error: 'Please sign in.' }, { status: 401 });
    const raw = await request.text();
    if (raw.length > 2000) return Response.json({ error: 'Request is too large.' }, { status: 413 });
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return Response.json({ error: 'Send a valid request.' }, { status: 400 }); }
    if (reopen) {
      const parsed = reopenSchema.safeParse(input);
      if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
      await reopenReservationDate(parsed.data.date);
      return Response.json({ ok: true });
    }
    const parsed = closeSchema.safeParse(input);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const activeReservations = await closeReservationDate(parsed.data.date, parsed.data.reason, admin.id);
    return Response.json({ ok: true, activeReservations });
  } catch {
    return Response.json({ error: 'Unable to update reservation availability. Please try again.' }, { status: 503 });
  }
}

export async function POST(request: Request) { return changeClosure(request, false); }
export async function DELETE(request: Request) { return changeClosure(request, true); }
