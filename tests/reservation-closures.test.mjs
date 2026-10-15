import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { registerHooks } from 'node:module';
import { setDefaultAutoSelectFamily } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { reservationDateRange } from '../lib/reservation-dates.ts';

const allowed = process.env.TEST_ALLOW_DATABASE_WRITES === 'isolated-reservation-tests';

// This suite is deliberately opt-in. Run against an isolated server/database:
// node --env-file=.env.reservation-test --test tests/reservation-closures.test.mjs
test('isolated reservation closure API, chatbot, and concurrent writes', {
  skip: allowed ? false : 'Requires TEST_ALLOW_DATABASE_WRITES=isolated-reservation-tests',
  timeout: 180_000,
}, async t => {
  assert.ok(!(process.env.SMTP_PASSWORD || '').trim(), 'Disable SMTP before running reservation tests.');
  const base = new URL(process.env.TEST_BASE_URL || 'http://localhost:3001');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local isolated test server.');
  assert.ok(process.env.DATABASE_URL, 'An isolated DATABASE_URL is required.');
  assert.ok(process.env.TEST_ADMIN_USERNAME && process.env.TEST_ADMIN_PASSWORD, 'Isolated test admin credentials are required.');
  // Keep lib/db.ts on the explicitly supplied isolated URL even if another
  // connection variant exists in the calling shell. Never load .env.local.
  process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
  process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  setDefaultResultOrder('ipv4first');
  setDefaultAutoSelectFamily(false);
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 3, connect_timeout: 15 });
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
      }
      if (specifier === 'next/headers') return nextResolve('next/headers.js', context);
      if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(specifier + '.ts', context);
      }
      return nextResolve(specifier, context);
    },
  });
  let appSql;
  let cookie = '';
  const ownedIds = new Set();
  const ownedDates = new Set();
  const run = randomUUID();
  const request = (path, method = 'GET', body, options = {}) => fetch(new URL(path, base), {
    method,
    headers: {
      'Content-Type': 'application/json', Origin: options.origin || base.origin,
      ...(options.auth === false || !cookie ? {} : { Cookie: cookie }),
    },
    body: options.raw !== undefined ? options.raw : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const input = (date, label) => ({
    name: 'Reservation closure QA', email: `qa-${label}-${run}@example.com`, phone: '6135550100',
    date, time: '18:00', guests: 2, notes: 'Temporary isolated reservation closure test', website: '',
  });
  const countEmail = async email => Number((await sql`select count(*)::int as count from namche.reservations where email=${email}`)[0].count);
  const track = id => { assert.ok(id); ownedIds.add(id); return id; };
  try {
    const { createReservation, createReservationResult, closeReservationDate } = await import('../lib/reservations.ts');
    const { createChatReservation } = await import('../lib/chat.ts');
    appSql = (await import('../lib/db.ts')).sql;
    const [admin] = await sql`select id from namche.admins where username=${process.env.TEST_ADMIN_USERNAME}`;
    assert.ok(admin, 'The isolated QA admin must exist.');
    const { today } = reservationDateRange();
    const occupied = new Set((await sql`select to_char(date,'YYYY-MM-DD') as date from namche.reservations where date>=${today}::date
      union select to_char(date,'YYYY-MM-DD') as date from namche.reservation_closures where date>=${today}::date`).map(row => row.date));
    const dates = [];
    for (let offset = 21; offset < 170 && dates.length < 3; offset++) {
      const candidate = new Date(today + 'T12:00:00Z');
      candidate.setUTCDate(candidate.getUTCDate() + offset);
      const date = candidate.toISOString().slice(0, 10);
      if (!occupied.has(date)) dates.push(date);
    }
    assert.equal(dates.length, 3, 'Need three unused dates in the isolated branch.');
    for (const date of dates) ownedDates.add(date);
    const [date, closeFirstDate, saveFirstDate] = dates;

    await t.test('staff availability requires sign-in and rejects cross-origin writes', async () => {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const response = await request('/api/admin/reservation-closures', method, method === 'GET' ? undefined : { date }, { auth: false });
        assert.equal(response.status, 401, method);
      }
      const login = await request('/api/admin/login', 'POST', {
        username: process.env.TEST_ADMIN_USERNAME, password: process.env.TEST_ADMIN_PASSWORD,
      }, { auth: false });
      assert.equal(login.status, 200, 'Isolated QA sign-in');
      cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
      assert.ok(cookie);
      const denied = await request('/api/admin/reservation-closures', 'POST', { date }, { origin: 'https://untrusted.example' });
      assert.equal(denied.status, 403);
    });

    await t.test('closure writes validate JSON, calendar dates, range, and reason length', async () => {
      const malformed = await request('/api/admin/reservation-closures', 'POST', undefined, { raw: '{' });
      assert.equal(malformed.status, 400);
      for (const body of [{ date: 'not-a-date' }, { date: '2026-02-31' }, { date: '2000-01-01' }, { date: '2099-01-01' }, { date, reason: 'x'.repeat(301) }, { date, public_reason: 'x'.repeat(301) }]) {
        assert.equal((await request('/api/admin/reservation-closures', 'POST', body)).status, 400);
      }
      assert.equal((await request('/api/admin/reservation-closures', 'DELETE', { date: '2026-02-31' })).status, 400);
      const malformedBooking = await request('/api/reservations', 'POST', undefined, { raw: '{' });
      assert.equal(malformedBooking.status, 400);
      assert.equal((await request('/api/reservations', 'POST', input('2099-01-01', 'invalid'))).status, 400);
    });

    await t.test('closing preserves existing requests and exposes dates without staff notes', async () => {
      const pendingId = track(await createReservation(input(date, 'existing-pending')));
      const cancelledId = track(await createReservation(input(date, 'existing-cancelled')));
      await sql`update namche.reservations set status='cancelled' where id=${cancelledId}`;
      const reason = 'Private staff note ' + run;
      const close = await request('/api/admin/reservation-closures', 'POST', { date, reason });
      assert.equal(close.status, 200);
      assert.equal((await close.json()).activeReservations, 1);
      const [preserved] = await sql`select status from namche.reservations where id=${pendingId}`;
      assert.equal(preserved.status, 'pending');
      const staff = await request('/api/admin/reservation-closures');
      assert.equal(staff.status, 200);
      const closure = (await staff.json()).closures.find(row => row.date === date);
      assert.equal(closure.reason, reason);
      assert.equal(closure.active_reservations, 1);
      const publicResponse = await request('/api/reservations/availability', 'GET', undefined, { auth: false });
      assert.equal(publicResponse.status, 200);
      assert.match(publicResponse.headers.get('cache-control'), /no-store/);
      const availability = await publicResponse.json();
      assert.deepEqual(Object.keys(availability).sort(), ['closedDates', 'closures', 'maxDate', 'today']);
      assert.ok(availability.closedDates.includes(date));
      assert.ok(availability.closedDates.every(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)));
      assert.ok(!JSON.stringify(availability).includes(reason));
      assert.deepEqual(availability.closures.find(row => row.date === date), { date, reason: '' });
    });

    await t.test('staff can edit an existing public closure explanation without exposing private notes', async () => {
      const publicReason = 'Closed for a private event.';
      const privateReason = 'Staff-only arrangements ' + run;
      const edited = await request('/api/admin/reservation-closures', 'PATCH', { date, reason: privateReason, public_reason: publicReason });
      assert.equal(edited.status, 200);
      assert.equal((await edited.json()).activeReservations, 1);
      const availability = await (await request('/api/reservations/availability', 'GET', undefined, { auth: false })).json();
      assert.deepEqual(availability.closures.find(row => row.date === date), { date, reason: publicReason });
      assert.ok(!JSON.stringify(availability).includes(privateReason));
      const denied = await request('/api/reservations', 'POST', input(date, 'closed-public-reason'), { auth: false });
      assert.equal(denied.status, 409);
      const result = await denied.json();
      assert.equal(result.reason, publicReason);
      assert.ok(result.error.includes(publicReason));
      assert.ok(!result.error.includes(privateReason));
      assert.deepEqual(await createReservationResult(input(date, 'atomic-public-reason')), { id: null, closedReason: publicReason });
      assert.equal((await request('/api/admin/reservation-closures', 'PATCH', { date: closeFirstDate, reason: '', public_reason: publicReason })).status, 404);
    });

    await t.test('public API and chatbot reject closed dates without saving a request', async () => {
      const booking = input(date, 'closed-api');
      const response = await request('/api/reservations', 'POST', booking, { auth: false });
      assert.equal(response.status, 409);
      const result = await response.json();
      assert.equal(result.code, 'RESERVATION_DATE_CLOSED');
      assert.match(result.error, /choose another day/i);
      assert.equal(await countEmail(booking.email), 0);
      for (const confirmed of [false, true]) {
        const chat = { ...input(date, `closed-chat-${confirmed}`), confirmed };
        const result = await createChatReservation(chat, confirmed ? 'Yes, submit my request.' : 'Can I book that date?');
        assert.equal(result.ok, false);
        assert.match(result.message, /closed on this date/i);
        assert.ok(!('requires_confirmation' in result), 'Closed dates are rejected before asking for confirmation.');
        assert.equal(await countEmail(chat.email), 0);
      }
    });

    await t.test('reopening permits pending reservations through both public paths', async () => {
      assert.equal((await request('/api/admin/reservation-closures', 'DELETE', { date })).status, 200);
      const availability = await (await request('/api/reservations/availability', 'GET', undefined, { auth: false })).json();
      assert.ok(!availability.closedDates.includes(date));
      const response = await request('/api/reservations', 'POST', input(date, 'reopened-api'), { auth: false });
      assert.equal(response.status, 201);
      const apiId = track((await response.json()).id);
      const chat = await createChatReservation({ ...input(date, 'reopened-chat'), confirmed: true }, 'Yes, submit my request.');
      assert.equal(chat.ok, true);
      assert.equal(chat.status, 'pending');
      const chatId = track(chat.id);
      const rows = await sql`select status from namche.reservations where id in (${apiId},${chatId})`;
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.status === 'pending'));
    });

    async function queuedRace(raceDate, closeFirst) {
      let release;
      let announceLock;
      const released = new Promise(resolve => { release = resolve; });
      const locked = new Promise(resolve => { announceLock = resolve; });
      const blocker = sql.begin(async tx => {
        await tx`select pg_advisory_xact_lock(748230, ${raceDate}::date - date '2000-01-01')`;
        announceLock();
        await released;
      });
      let close;
      let booking;
      const waitForWaiters = async expected => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const [row] = await sql`select count(*)::int as count from pg_locks where locktype='advisory'
            and classid=748230 and objid=(${raceDate}::date - date '2000-01-01')::oid and not granted`;
          if (row.count >= expected) return;
          await delay(30);
        }
        assert.fail('Reservation operations did not queue on the common date lock.');
      };
      try {
        await locked;
        if (closeFirst) close = closeReservationDate(raceDate, 'Isolated concurrency QA', admin.id);
        else booking = createReservation(input(raceDate, 'race-save-first'));
        await waitForWaiters(1);
        if (closeFirst) booking = createReservation(input(raceDate, 'race-close-first'));
        else close = closeReservationDate(raceDate, 'Isolated concurrency QA', admin.id);
        await waitForWaiters(2);
      } finally {
        release();
        await blocker;
      }
      const [active, id] = await Promise.all([close, booking]);
      if (id) track(id);
      return { active, id };
    }

    await t.test('concurrent close before save rejects booking under the common date lock', async () => {
      assert.deepEqual(await queuedRace(closeFirstDate, true), { active: 0, id: null });
    });
    await t.test('concurrent save before close preserves the new pending request', async () => {
      const result = await queuedRace(saveFirstDate, false);
      assert.equal(result.active, 1);
      assert.ok(result.id);
      const [row] = await sql`select status from namche.reservations where id=${result.id}`;
      assert.equal(row.status, 'pending');
    });
  } finally {
    // These exact IDs and previously unused dates belong to this run. Copied
    // guest records, existing closures, and staff notes are never modified.
    for (const id of ownedIds) await sql`delete from namche.reservations where id=${id}`;
    for (const date of ownedDates) await sql`delete from namche.reservation_closures where date=${date}::date`;
    if (cookie) await request('/api/admin/logout', 'POST').catch(() => {});
    if (appSql) await appSql.end();
    await sql.end();
    hook.deregister();
  }
});
