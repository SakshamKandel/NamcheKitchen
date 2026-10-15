import test from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarDate, isReservationDate, reservationDateRange } from '../lib/reservation-dates.ts';

test('calendar validation rejects impossible and nonstandard date strings', () => {
  for (const date of ['2026-10-24', '2028-02-29', '2026-12-31']) {
    assert.equal(isCalendarDate(date), true, date);
  }
  for (const date of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '2026-10-32', '2026-1-24', '24-10-2026', '2026-10-24T12:00:00Z', '']) {
    assert.equal(isCalendarDate(date), false, date);
  }
});

test('reservation dates follow Ottawa midnight instead of the UTC calendar', () => {
  assert.deepEqual(reservationDateRange(new Date('2026-10-15T03:59:59Z')), {
    today: '2026-10-14', maxDate: '2027-04-11',
  });
  assert.deepEqual(reservationDateRange(new Date('2026-10-15T04:00:00Z')), {
    today: '2026-10-15', maxDate: '2027-04-12',
  });
  assert.equal(reservationDateRange(new Date('2026-12-01T04:59:59Z')).today, '2026-11-30');
  assert.equal(reservationDateRange(new Date('2026-12-01T05:00:00Z')).today, '2026-12-01');
});

test('booking window includes today and the final day and rejects adjacent dates', () => {
  const now = new Date('2026-10-15T16:00:00Z');
  assert.equal(isReservationDate('2026-10-15', now), true);
  assert.equal(isReservationDate('2027-04-12', now), true);
  assert.equal(isReservationDate('2026-10-14', now), false);
  assert.equal(isReservationDate('2027-04-13', now), false);
  assert.equal(isReservationDate('2027-02-29', now), false);
});

test('booking window spans leap days and daylight saving changes as calendar days', () => {
  const now = new Date('2027-12-01T17:00:00Z');
  assert.deepEqual(reservationDateRange(now), { today: '2027-12-01', maxDate: '2028-05-28' });
  assert.equal(isReservationDate('2028-02-29', now), true);
  assert.deepEqual(reservationDateRange(new Date('2026-03-08T12:00:00Z')), {
    today: '2026-03-08', maxDate: '2026-09-03',
  });
});
