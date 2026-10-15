import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { sql } from './db';
import type { reservationSchema } from './validation';
import { reservationDateRange } from './reservation-dates';

type ReservationInput = z.infer<typeof reservationSchema>;

export async function isReservationDateClosed(date: string) {
  return Boolean(await getReservationClosure(date));
}

export async function getReservationClosure(date: string) {
  const rows = await sql`select to_char(date,'YYYY-MM-DD') as date,public_reason as reason from namche.reservation_closures where date=${date}::date`;
  return rows[0] ? { date: rows[0].date as string, reason: rows[0].reason as string } : null;
}

export async function closedReservationDates() {
  const { today, maxDate } = reservationDateRange();
  const rows = await sql`select to_char(date,'YYYY-MM-DD') as date,public_reason as reason from namche.reservation_closures where date between ${today}::date and ${maxDate}::date order by date`;
  const closures = rows.map(row => ({ date: row.date as string, reason: row.reason as string }));
  return { closedDates: closures.map(row => row.date), closures, today, maxDate };
}

export async function reservationClosures() {
  const { today, maxDate } = reservationDateRange();
  const closures = await sql`select to_char(c.date,'YYYY-MM-DD') as date,c.reason,c.public_reason,
    (select count(*)::int from namche.reservations r where r.date=c.date and r.status in ('pending','confirmed')) as active_reservations
    from namche.reservation_closures c where c.date>=${today}::date order by c.date`;
  return { closures, today, maxDate };
}

/** All booking and availability mutations take the same per-date transaction lock. */
export async function createReservation(data: ReservationInput): Promise<string | null> {
  return (await createReservationResult(data)).id;
}

/** Capture the public explanation under the same date lock as the booking. */
export async function createReservationResult(data: ReservationInput): Promise<{ id: string | null; closedReason: string | null }> {
  return sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(748230, ${data.date}::date - date '2000-01-01')`;
    const closed = await tx`select public_reason from namche.reservation_closures where date=${data.date}::date`;
    if (closed.length) return { id: null, closedReason: closed[0].public_reason as string };
    const id = randomUUID();
    await tx`insert into namche.reservations(id,name,email,phone,date,time,guests,notes)
      values(${id},${data.name},${data.email.toLowerCase()},${data.phone},${data.date},${data.time},${data.guests},${data.notes})`;
    return { id, closedReason: null };
  });
}

export async function closeReservationDate(date: string, reason: string, adminId: string, publicReason = '') {
  return sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(748230, ${date}::date - date '2000-01-01')`;
    await tx`insert into namche.reservation_closures(date,reason,public_reason,created_by) values(${date},${reason},${publicReason},${adminId})
      on conflict(date) do update set reason=excluded.reason,public_reason=excluded.public_reason,updated_at=now()`;
    const [row] = await tx`select count(*)::int as count from namche.reservations where date=${date}::date and status in ('pending','confirmed')`;
    return row.count as number;
  });
}

export async function updateReservationClosure(date: string, reason: string, publicReason: string) {
  return sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(748230, ${date}::date - date '2000-01-01')`;
    const rows = await tx`update namche.reservation_closures set reason=${reason},public_reason=${publicReason},updated_at=now() where date=${date}::date returning date`;
    if (!rows.length) return null;
    const [row] = await tx`select count(*)::int as count from namche.reservations where date=${date}::date and status in ('pending','confirmed')`;
    return row.count as number;
  });
}

export async function reopenReservationDate(date: string) {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(748230, ${date}::date - date '2000-01-01')`;
    await tx`delete from namche.reservation_closures where date=${date}::date`;
  });
}
