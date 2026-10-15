import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the real handler without accessing a database or staff credentials.
test('menu deletion removes only the selected item after authorization and validation', async t => {
  const id = 'jhol-momo-veg';
  const image = { id: 'momo-photo', data: 'reusable-image' };
  const retained = { id: 'jhol-momo-chicken', image_id: image.id };
  const state = {
    signedIn: true, sameOrigin: true, queries: [], failDatabase: false,
    items: new Map([[id, { id, image_id: image.id }], [retained.id, retained]]),
    images: new Map([[image.id, image]]),
  };
  globalThis.__namcheMenuDeleteTest = state;
  state.sql = async (strings, ...values) => {
    const text = strings.join('?');
    state.queries.push({ text, values });
    assert.match(text, /^delete from namche\.menu_items where id=\? returning id$/);
    assert.equal(values.length, 1);
    if (state.failDatabase) throw new Error('Simulated database failure');
    const row = state.items.get(values[0]);
    if (!row) return [];
    state.items.delete(values[0]);
    return [{ id: row.id }];
  };
  const sourceUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const stubs = {
    '@/lib/db': sourceUrl('export const sql = (...args) => globalThis.__namcheMenuDeleteTest.sql(...args);'),
    '@/lib/auth': sourceUrl('export const session = async () => globalThis.__namcheMenuDeleteTest.signedIn; export const sameOrigin = () => globalThis.__namcheMenuDeleteTest.sameOrigin;'),
  };
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (stubs[specifier]) return { url: stubs[specifier], shortCircuit: true };
      if (specifier.startsWith('@/')) return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
      if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
      return nextResolve(specifier, context);
    },
  });
  try {
    const { DELETE } = await import('../app/api/admin/menu/route.ts');
    const remove = body => DELETE(new Request('https://namche.example/api/admin/menu', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }));

    await t.test('sign-in and origin checks prevent all database calls', async () => {
      for (const property of ['signedIn', 'sameOrigin']) {
        state[property] = false;
        assert.equal((await remove({ id })).status, 401);
        state[property] = true;
      }
      assert.equal(state.queries.length, 0);
      assert.equal(state.items.size, 2);
    });

    await t.test('invalid IDs and malformed JSON never reach the database', async () => {
      for (const body of ['{', null, [], {}, { id: null }, { id: 42 }, { id: '' }, { id: ' \n ' }, { id: 'x'.repeat(151) }]) {
        assert.equal((await remove(body)).status, 400, JSON.stringify(body));
      }
      assert.equal(state.queries.length, 0);
      assert.equal(state.items.size, 2);
    });

    await t.test('a trimmed text ID removes the selected item and preserves other items and shared images', async () => {
      const response = await remove({ id: `  ${id}  ` });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, id });
      assert.deepEqual(state.queries, [{ text: 'delete from namche.menu_items where id=? returning id', values: [id] }]);
      assert.equal(state.items.has(id), false);
      assert.deepEqual([...state.items.values()], [retained]);
      assert.deepEqual([...state.images.values()], [image]);
    });

    await t.test('IDs remain parameter values including SQL metacharacters', async () => {
      const specialId = "test'; delete from namche.images; --";
      state.items.set(specialId, { id: specialId });
      assert.equal((await remove({ id: specialId })).status, 200);
      assert.deepEqual(state.queries.at(-1).values, [specialId]);
      assert.ok(!state.queries.at(-1).text.includes(specialId));
      assert.equal(state.items.has(retained.id), true);
      assert.equal(state.images.size, 1);
    });

    await t.test('150-character IDs are accepted after trimming', async () => {
      const longId = 'x'.repeat(150);
      state.items.set(longId, { id: longId });
      assert.equal((await remove({ id: `  ${longId}  ` })).status, 200);
      assert.deepEqual(state.queries.at(-1).values, [longId]);
    });

    await t.test('missing items return 404 and database failures return a safe error', async () => {
      const missing = await remove({ id });
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), { error: 'This menu item no longer exists.' });
      state.failDatabase = true;
      const failure = await remove({ id: retained.id });
      assert.equal(failure.status, 500);
      assert.deepEqual(await failure.json(), { error: 'Unable to remove this item. Please try again.' });
      assert.deepEqual([...state.items.values()], [retained]);
      assert.deepEqual([...state.images.values()], [image]);
    });
  } finally {
    hook.deregister();
    delete globalThis.__namcheMenuDeleteTest;
  }
});
