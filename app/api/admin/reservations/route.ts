import { sql } from '@/lib/db';
import { session, sameOrigin } from '@/lib/auth';
import { reservationStatusSchema } from '@/lib/validation';
import { sendReservationStatusEmail, type ReservationEmail } from '@/lib/email';
export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request) || !await session()) return new Response(null, { status: 401 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid request.' }, { status: 400 });
    }
    const result = reservationStatusSchema.safeParse(body);
    if (!result.success) return Response.json({ error: result.error.issues[0]?.message || 'Invalid status.' }, { status: 400 });
    const { id, status } = result.data;
    const cancellationNote = status === 'cancelled' ? result.data.cancellation_note! : '';
    const rows = await sql`update namche.reservations set status=${status}, cancellation_note=${cancellationNote} where id=${id}
      returning id,name,email,phone,to_char(date,'YYYY-MM-DD') as date,to_char(time,'HH24:MI') as time,guests,notes,status,cancellation_note`;
    if (!rows.length) return Response.json({ error: 'Request not found.' }, { status: 404 });
    let emailSent = false;
    try {
      emailSent = await sendReservationStatusEmail(rows[0] as ReservationEmail);
    } catch (error) {
      console.error('Reservation status email failed', error);
    }
    return Response.json({ ok: true, emailSent });
  } catch {
    return Response.json({ error: 'Unable to update reservation.' }, { status: 500 });
  }
}
