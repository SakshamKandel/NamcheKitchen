export const CLOSED_DATE_MESSAGE = 'Reservations are closed on this date. Please choose another day.';

/** Calendar dates use the restaurant's timezone, independently of the server or guest. */
export function reservationDateRange(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(now);
  const lastDay = new Date(today + 'T12:00:00Z');
  lastDay.setUTCDate(lastDay.getUTCDate() + 179);
  return { today, maxDate: lastDay.toISOString().slice(0, 10) };
}

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isReservationDate(value: string, now = new Date()) {
  const { today, maxDate } = reservationDateRange(now);
  return isCalendarDate(value) && value >= today && value <= maxDate;
}
