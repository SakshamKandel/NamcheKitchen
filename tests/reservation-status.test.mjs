import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the real handler, validation, and email rendering without connecting
// to a database, sending mail, or requiring staff credentials.
test('reservation status updates retain and deliver cancellation reasons', async t => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const initial = {
    id, name: 'Test Guest', email: 'guest@example.com', phone: '6135550100',
    date: '2026-11-01', time: '18:00', guests: 2, notes: '',
    status: 'confirmed', cancellation_note: '',
  };
  const state = { signedIn: true, sameOrigin: true, queries: [], mails: [], row: { ...initial }, missing: false, failDatabase: false, failEmail: false };
  globalThis.__namcheReservationStatusTest = state;
  state.sql = async (strings, ...values) => {
    state.queries.push({ text: strings.join('?'), values });
    if (state.failDatabase) throw new Error('Simulated database failure');
    if (state.missing) return [];
    state.row = { ...state.row, status: values[0], cancellation_note: values[1] };
    return [state.row];
  };
  const sourceUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const stubs = {
    '@/lib/db': sourceUrl('export const sql = (...args) => globalThis.__namcheReservationStatusTest.sql(...args);'),
    '@/lib/auth': sourceUrl('export const session = async () => globalThis.__namcheReservationStatusTest.signedIn; export const sameOrigin = () => globalThis.__namcheReservationStatusTest.sameOrigin;'),
    nodemailer: sourceUrl(`export default { createTransport() { return { async sendMail(message) {
      const state = globalThis.__namcheReservationStatusTest;
      if (state.failEmail) throw new Error('Simulated delivery failure');
      state.mails.push(message);
    } }; } };`),
  };
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (stubs[specifier]) return { url: stubs[specifier], shortCircuit: true };
      if (specifier.startsWith('@/')) return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
      if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
      return nextResolve(specifier, context);
    },
  });
  const originalPassword = process.env.SMTP_PASSWORD;
  process.env.SMTP_PASSWORD = 'mock-transport-only';
  try {
    const { PATCH } = await import('../app/api/admin/reservations/route.ts');
    const request = body => new Request('https://namche.example/api/admin/reservations', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const update = body => PATCH(request(body));

    await t.test('sign-in and origin gates prevent all status writes', async () => {
      for (const property of ['signedIn', 'sameOrigin']) {
        state[property] = false;
        assert.equal((await update({ id, status: 'confirmed' })).status, 401);
        state[property] = true;
      }
      assert.equal(state.queries.length, 0);
      assert.equal(state.mails.length, 0);
    });

    await t.test('invalid requests and blank or oversized cancellation notes never write', async () => {
      for (const body of [
        '{', { id, status: 'cancelled' }, { id, status: 'cancelled', cancellation_note: ' \n ' },
        { id, status: 'cancelled', cancellation_note: 'x'.repeat(1001) },
        { id, status: 'cancelled', cancellation_note: 42 },
        { id: 'invalid', status: 'cancelled', cancellation_note: 'Closed' }, { id, status: 'unknown' },
      ]) assert.equal((await update(body)).status, 400, JSON.stringify(body));
      assert.equal(state.queries.length, 0);
      assert.equal(state.mails.length, 0);
    });

    await t.test('cancellation saves the trimmed reason and emails escaped HTML plus plain text', async () => {
      const reason = 'Kitchen <closed> & "unavailable"\nPlease choose another day.';
      const response = await update({ id, status: 'cancelled', cancellation_note: `  ${reason}  ` });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, emailSent: true });
      assert.deepEqual(state.queries.at(-1).values, ['cancelled', reason, id]);
      assert.match(state.queries.at(-1).text, /returning[\s\S]*cancellation_note/);
      assert.equal(state.row.cancellation_note, reason);
      const email = state.mails.at(-1);
      assert.equal(email.to, initial.email);
      assert.match(email.html, /Reason for cancellation/);
      assert.ok(email.html.includes('Kitchen &lt;closed&gt; &amp; &quot;unavailable&quot;<br/>Please choose another day.'));
      assert.ok(!email.html.includes('<closed>'));
      assert.ok(email.text.includes('Reason for cancellation: ' + reason));
    });

    await t.test('the 1,000 character boundary is accepted after trimming', async () => {
      const response = await update({ id, status: 'cancelled', cancellation_note: `  ${'x'.repeat(1000)}  ` });
      assert.equal(response.status, 200);
      assert.equal(state.row.cancellation_note.length, 1000);
    });

    await t.test('pending, confirmed, and completed updates clear old reasons', async () => {
      for (const status of ['pending', 'confirmed', 'completed']) {
        const response = await update({ id, status, cancellation_note: 'Stale cancellation reason' });
        assert.equal(response.status, 200);
        assert.equal(state.row.status, status);
        assert.equal(state.row.cancellation_note, '');
        assert.ok(!state.mails.at(-1).html.includes('Reason for cancellation'));
        assert.ok(!state.mails.at(-1).text.includes('Stale cancellation reason'));
      }
      assert.equal((await update({ id, status: 'confirmed' })).status, 200);
    });

    await t.test('missing SMTP and delivery failures report a saved status without claiming delivery', async () => {
      const mailCount = state.mails.length;
      delete process.env.SMTP_PASSWORD;
      let response = await update({ id, status: 'cancelled', cancellation_note: 'Private event' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, emailSent: false });
      assert.equal(state.row.cancellation_note, 'Private event');
      assert.equal(state.mails.length, mailCount);
      process.env.SMTP_PASSWORD = 'mock-transport-only';
      state.failEmail = true;
      t.mock.method(console, 'error', () => {});
      response = await update({ id, status: 'cancelled', cancellation_note: 'Unexpected closure' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, emailSent: false });
      assert.equal(state.row.cancellation_note, 'Unexpected closure');
      state.failEmail = false;
    });

    await t.test('missing reservations and database failures do not send email', async () => {
      const mailCount = state.mails.length;
      state.missing = true;
      assert.equal((await update({ id, status: 'confirmed' })).status, 404);
      state.missing = false;
      state.failDatabase = true;
      assert.equal((await update({ id, status: 'confirmed' })).status, 500);
      state.failDatabase = false;
      assert.equal(state.mails.length, mailCount);
    });
  } finally {
    if (originalPassword === undefined) delete process.env.SMTP_PASSWORD;
    else process.env.SMTP_PASSWORD = originalPassword;
    hook.deregister();
    delete globalThis.__namcheReservationStatusTest;
  }
});
