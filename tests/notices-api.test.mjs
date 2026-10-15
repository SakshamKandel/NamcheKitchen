import test from 'node:test';
import assert from 'node:assert/strict';
import { reservationDateRange } from '../lib/reservation-dates.ts';

const allowed = process.env.TEST_ALLOW_DATABASE_WRITES === 'isolated-reservation-tests';

test('isolated notices API preserves scheduling and staff-only write access', {
  skip: allowed ? false : 'Requires TEST_ALLOW_DATABASE_WRITES=isolated-reservation-tests', timeout: 120_000,
}, async t => {
  assert.ok(!(process.env.SMTP_PASSWORD || '').trim(), 'Disable SMTP for isolated tests.');
  const base = new URL(process.env.TEST_BASE_URL || 'http://localhost:3001');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local isolated server.');
  assert.ok(process.env.TEST_ADMIN_USERNAME && process.env.TEST_ADMIN_PASSWORD);
  let cookie = '';
  const owned = new Set();
  const request = (path, method = 'GET', body, options = {}) => fetch(new URL(path, base), {
    method, headers: { 'Content-Type': 'application/json', Origin: options.origin || base.origin, ...(options.auth === false || !cookie ? {} : { Cookie: cookie }) },
    body: options.raw !== undefined ? options.raw : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const { today } = reservationDateRange();
  const shift = days => { const value = new Date(today + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
  const input = { title: 'Isolated notice QA', message: 'A temporary test notice.', type: 'event', starts_on: today, ends_on: today, event_date: today, enabled: true };
  async function add(patch = {}) {
    const response = await request('/api/admin/notices', 'POST', { ...input, ...patch });
    assert.equal(response.status, 201);
    const { notice } = await response.json();
    assert.ok(notice?.id);
    owned.add(notice.id);
    return notice;
  }
  try {
    await t.test('anonymous and foreign-origin writes are blocked', async () => {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal((await request('/api/admin/notices', method, method === 'GET' ? undefined : input, { auth: false })).status, 401);
      const login = await request('/api/admin/login', 'POST', { username: process.env.TEST_ADMIN_USERNAME, password: process.env.TEST_ADMIN_PASSWORD }, { auth: false });
      assert.equal(login.status, 200);
      cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
      assert.ok(cookie);
      assert.equal((await request('/api/admin/notices', 'POST', input, { origin: 'https://untrusted.example' })).status, 403);
    });
    await t.test('malformed and invalid notices are rejected before writing', async () => {
      assert.equal((await request('/api/admin/notices', 'POST', undefined, { raw: '{' })).status, 400);
      for (const patch of [{ title: '' }, { message: 'x'.repeat(1001) }, { starts_on: '2026-02-31' }, { ends_on: shift(-1) }, { type: 'unknown' }]) assert.equal((await request('/api/admin/notices', 'POST', { ...input, ...patch })).status, 400);
    });
    let current;
    await t.test('public notices include only enabled entries inside the Toronto display window', async () => {
      current = await add();
      const hidden = [await add({ enabled: false }), await add({ starts_on: shift(1), ends_on: shift(2) }), await add({ starts_on: shift(-2), ends_on: shift(-1) })];
      const response = await request('/api/notices', 'GET', undefined, { auth: false });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const { notices } = await response.json();
      assert.ok(notices.some(notice => notice.id === current.id));
      assert.ok(hidden.every(notice => !notices.some(value => value.id === notice.id)));
      assert.ok(notices.every(notice => !('created_by' in notice)));
      const staff = await (await request('/api/admin/notices')).json();
      assert.equal(staff.today, today);
      assert.ok(hidden.every(notice => staff.notices.some(value => value.id === notice.id)));
    });
    await t.test('editing, hiding, and removing notices changes the public feed', async () => {
      const changed = { ...input, id: current.id, type: 'closure', title: 'Updated notice', enabled: false };
      const response = await request('/api/admin/notices', 'PATCH', changed);
      assert.equal(response.status, 200);
      const { notice } = await response.json();
      assert.equal(notice.title, changed.title);
      assert.equal(notice.enabled, false);
      assert.ok(!(await (await request('/api/notices')).json()).notices.some(value => value.id === current.id));
      assert.equal((await request('/api/admin/notices', 'DELETE', { id: current.id })).status, 200);
      owned.delete(current.id);
      assert.equal((await request('/api/admin/notices', 'PATCH', changed)).status, 404);
      assert.equal((await request('/api/admin/notices', 'DELETE', { id: current.id })).status, 404);
    });
  } finally {
    for (const id of owned) await request('/api/admin/notices', 'DELETE', { id }).catch(() => {});
    if (cookie) await request('/api/admin/logout', 'POST').catch(() => {});
  }
});
