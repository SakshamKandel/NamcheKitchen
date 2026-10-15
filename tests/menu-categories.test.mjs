import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

test('category handlers guard staff data and preserve menu items when categories change', async t => {
  const state = { signedIn: true, sameOrigin: true, queries: [], categories: [], failDatabase: false };
  const db = async (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    state.queries.push({ text, values });
    if (state.failDatabase) throw new Error('Database connection details must stay private');
    if (text.startsWith('with categories as')) return state.categories;
    if (text.startsWith('select c.kind, min(c.name)')) {
      const [kind, name] = values;
      return state.categories.filter(category => category.kind === kind && category.name.toLowerCase() === name.toLowerCase());
    }
    if (text.startsWith('select name from')) {
      const [kind, newName, oldName] = values;
      return state.categories.filter(category => category.kind === kind && category.name.toLowerCase() === newName.toLowerCase() && category.name.toLowerCase() !== oldName.toLowerCase());
    }
    if (text.startsWith('select lower(')) return [{ same_category: values[0].toLowerCase() === values[1].toLowerCase() }];
    assert.ok(!/delete from namche\.(menu_items|images)/i.test(text), 'category changes cannot delete menu items or photos');
    return [];
  };
  db.begin = async callback => callback(db);
  state.sql = db;
  globalThis.__namcheCategoryTest = state;
  const sourceUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const stubs = {
    '@/lib/db': sourceUrl('export const sql = globalThis.__namcheCategoryTest.sql;'),
    '@/lib/auth': sourceUrl('export const session = async () => globalThis.__namcheCategoryTest.signedIn; export const sameOrigin = () => globalThis.__namcheCategoryTest.sameOrigin;'),
  };
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    return stubs[specifier] ? { url: stubs[specifier], shortCircuit: true } : nextResolve(specifier, context);
  } });
  try {
    const handlers = await import('../app/api/admin/menu-categories/route.ts');
    const change = (method, body) => handlers[method](new Request('https://namche.example/api/admin/menu-categories', {
      method, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
    const data = { kind: 'food', name: 'Momo', newName: 'Nepali Momo' };

    await t.test('GET and every mutation require sign-in; writes require same origin', async () => {
      state.signedIn = false;
      const response = await handlers.GET();
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await change(method, data)).status, 401);
      state.signedIn = true;
      state.sameOrigin = false;
      for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await change(method, data)).status, 403);
      state.sameOrigin = true;
      assert.equal(state.queries.length, 0);
    });

    await t.test('malformed JSON, invalid fields, and oversized bodies never reach the database', async () => {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        for (const invalid of ['{', null, [], {}, { ...data, kind: 'other' }, { ...data, name: 7 }, { ...data, name: '  ' }, { ...data, name: 'x'.repeat(81) }, { ...data, name: 'A\0B' }, { ...data, name: 'Momo\nDishes' }]) {
          assert.equal((await change(method, invalid)).status, 400);
        }
        assert.equal((await change(method, 'x'.repeat(2001))).status, 413);
      }
      assert.equal((await change('PATCH', { kind: 'food', name: 'Momo' })).status, 400);
      assert.equal((await change('DELETE', { kind: 'food', name: 'Momo', replacement: 12 })).status, 400);
      assert.equal(state.queries.length, 0);
    });

    await t.test('list response includes empty persistent and populated discovered categories', async () => {
      state.categories = [{ kind: 'food', name: 'Momo', item_count: 2 }, { kind: 'food', name: 'New dishes', item_count: 0 }];
      const response = await handlers.GET();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { categories: state.categories });
    });

    await t.test('case-insensitive duplicates and missing categories do not mutate data', async () => {
      state.queries = [];
      state.categories = [{ kind: 'food', name: 'Momo', item_count: 2 }, { kind: 'food', name: 'Sides', item_count: 1 }];
      assert.equal((await change('POST', { kind: 'food', name: ' momo ' })).status, 409);
      assert.equal((await change('PATCH', { kind: 'food', name: 'Momo', newName: 'sides' })).status, 409);
      assert.equal((await change('DELETE', { kind: 'food', name: 'Missing' })).status, 404);
      assert.ok(state.queries.every(query => !/^(insert|update|delete)/.test(query.text)));
    });

    await t.test('populated removal requires a different category of the same kind', async () => {
      state.queries = [];
      state.categories = [{ kind: 'food', name: 'Momo', item_count: 2 }, { kind: 'drink', name: 'Beer', item_count: 1 }];
      assert.equal((await change('DELETE', { kind: 'food', name: 'Momo' })).status, 400);
      assert.equal((await change('DELETE', { kind: 'food', name: 'Momo', replacement: 'momo' })).status, 400);
      assert.equal((await change('DELETE', { kind: 'food', name: 'Momo', replacement: 'Beer' })).status, 404);
      assert.ok(state.queries.every(query => !/^(insert|update|delete)/.test(query.text)));
    });

    await t.test('renaming scopes every item update to kind and parameterizes names', async () => {
      state.queries = [];
      const newName = "Chef's choice'; --";
      const response = await change('PATCH', { kind: 'food', name: ' Momo ', newName });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, kind: 'food', name: newName });
      const update = state.queries.find(query => query.text.startsWith('update namche.menu_items'));
      assert.match(update.text, /updated_at=now\(\).*where kind=\? and lower\(category\)=lower\(\?\)/);
      assert.deepEqual(update.values, [newName, 'food', 'Momo']);
      assert.ok(!update.text.includes(newName));
      assert.match(state.queries[0].text, /^lock table namche\.menu_categories,namche\.menu_items/);
    });

    await t.test('populated removal moves items without deleting any item or image', async () => {
      state.queries = [];
      state.categories.push({ kind: 'food', name: 'Sides', item_count: 0 });
      const response = await change('DELETE', { kind: 'food', name: 'Momo', replacement: 'sides' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, movedItems: 2 });
      const update = state.queries.find(query => query.text.startsWith('update namche.menu_items'));
      assert.deepEqual(update.values, ['Sides', 'food', 'Momo']);
      assert.equal(state.queries.filter(query => query.text.startsWith('delete')).length, 1);
    });

    await t.test('database failures return a safe error', async () => {
      state.failDatabase = true;
      for (const response of [await handlers.GET(), await change('POST', data)]) {
        assert.equal(response.status, 503);
        assert.ok(!(await response.text()).includes('connection details'));
      }
    });
  } finally {
    hook.deregister();
    delete globalThis.__namcheCategoryTest;
  }
});
