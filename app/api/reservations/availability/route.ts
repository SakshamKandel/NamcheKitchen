import { closedReservationDates } from '@/lib/reservations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Only explicitly public closure reasons are exposed. Staff notes stay private.
    return Response.json(await closedReservationDates(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Unable to check availability. Please try again or call (613) 761-1616.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
