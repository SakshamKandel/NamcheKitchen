import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { sql } from './db';
import type { reservationSchema } from './validation';
import { reservationDateRange } from './reservation-dates';

type ReservationInput = z.infer<typeof reservationSchema>;

export async function isReservationDateClosed(date: string) {
  const rows = await sql`select date from namche.reservation_closures where date=${date}::date`;
  return rows.length > 0;
}

export async function closedReservationDates() {
  const { today, maxDate } = reservationDateRange();
  const rows = await sql`select to_char(date,'YYYY-MM-DD') as date from namche.reservation_closures where date between ${today}::date and ${maxDate}::date order by date`;
  return { closedDates: rows.map(row => row.date as string), today, maxDate };
}

export async function reservationClosures() {
  const { today, maxDate } = reservationDateRange();
  const closures = await sql`select to_char(c.date,'YYYY-MM-DD') as date,c.reason,
    (select count(*)::int from namche.reservations r where r.date=c.date and r.status in ('pending','confirmed')) as active_reservations
    from namche.reservation_closures c where c.date>=${today}::date order by c.date`;
  return { closures, today, maxDate };
}

/** All booking and availability mutations take the same per-date transaction lock. */
export async function createReservation(data: ReservationInput): Promise<string | null> {
  return sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(748230, ${data.date}::date - date '2000-01-01')`;
    const closed = await tx`select date from namche.reservation_closures where date=${data.date}::date`;
    if (closed.length) return null;
    const id = randomUUID();
    await tx`insert into namche.reservations(id,name,email,phone,date,time,guests,notes)
      values(${id},${data.name},${data.email.toLowerCase()},${data.phone},${data.date},${data.time},${data.guests},${data.notes})`;
    return id;
  });
}

export async function closeReservationDate(date: string, reason: string, adminId: string) {
  return sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(748230, ${date}::date - date '2000-01-01')`;
    await tx`insert into namche.reservation_closures(date,reason,created_by) values(${date},${reason},${adminId})
      on conflict(date) do update set reason=excluded.reason,updated_at=now()`;
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
