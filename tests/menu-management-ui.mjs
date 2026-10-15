import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import * as net from 'node:net';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { chromium, expect as baseExpect } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30000 });

if (process.env.TEST_ALLOW_DATABASE_WRITES !== 'isolated-reservation-tests' || process.env.SMTP_PASSWORD) {
  throw new Error('Use an isolated test database/server with SMTP disabled and TEST_ALLOW_DATABASE_WRITES=isolated-reservation-tests.');
}
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local isolated test server.');
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
assert.ok(databaseUrl, 'Set an isolated test database URL.');
const main = parseEnv(await fs.readFile('.env.local', 'utf8'));
const hostname = value => new URL(value).hostname.replace('-pooler', '');
assert.notEqual(hostname(databaseUrl), hostname(main.DATABASE_URL), 'The test endpoint must differ from the main database.');
const username = process.env.TEST_ADMIN_USERNAME;
const password = process.env.TEST_ADMIN_PASSWORD;
assert.ok(username && password, 'Set test staff credentials.');
net.setDefaultAutoSelectFamily(false);
const sql = postgres(databaseUrl, { ssl: 'require', max: 1, connect_timeout: 15 });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const token = randomUUID().slice(0, 8);
const selectedId = randomUUID();
const visibleId = randomUUID();
const hiddenId = randomUUID();
const selectedName = `Menu UI ${token} remove me`;
const visibleName = `Menu UI ${token} visible`;
const hiddenName = `Menu UI ${token} hidden`;
const categoryName = `UI original ${token}`;
const renamedCategory = `UI renamed ${token}`;
const replacementCategory = `UI replacement ${token}`;
const emptyCategory = `UI empty ${token}`;
const fixtureIds = [selectedId, visibleId, hiddenId];
const fixtureCategories = [categoryName, renamedCategory, replacementCategory, emptyCategory];
let context;
let page;
let releaseDelete = () => {};
try {
  const [image] = await sql`select id from namche.images order by id limit 1`;
  assert.ok(image, 'Use a seeded isolated database to verify preservation of reusable images.');
  for (const item of [
    { id: selectedId, name: selectedName, available: true },
    { id: visibleId, name: visibleName, available: true },
    { id: hiddenId, name: hiddenName, available: false },
  ]) {
    await sql`insert into namche.menu_items(id,name,description,category,kind,price,price_note,image_id,available,featured,sort_order)
      values(${item.id},${item.name},'Temporary isolated menu management test.','Starters','food',12.5,'',${image.id},${item.available},false,9999)`;
  }
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(30000);
  const login = await context.request.post(`${base}/api/admin/login`, { headers: { Origin: base }, data: { username, password } });
  assert.equal(login.status(), 200, 'Test staff can sign in.');
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/images/**', route => route.abort());
  let deleteRequests = 0;
  let deleteStarted;
  const pendingDelete = new Promise(resolve => { deleteStarted = resolve; });
  await page.route('**/api/admin/menu', async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    assert.deepEqual(route.request().postDataJSON(), { id: selectedId });
    deleteRequests++;
    if (deleteRequests === 1) return route.fulfill({ status: 503, json: { error: 'Temporary removal failure. Please try again.' } });
    await new Promise(resolve => { releaseDelete = resolve; deleteStarted(); });
    return route.continue();
  });
  await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
  const cookieNotice = page.getByRole('button', { name: /^Got it/ });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  await expect(page.getByRole('button', { name: 'Add menu item', exact: true })).toBeVisible();
  await page.getByLabel('Search menu items').fill(token);
  const selected = page.locator('.admin-item').filter({ has: page.getByRole('heading', { name: selectedName, exact: true }) });
  const visible = page.locator('.admin-item').filter({ has: page.getByRole('heading', { name: visibleName, exact: true }) });
  const hidden = page.locator('.admin-item').filter({ has: page.getByRole('heading', { name: hiddenName, exact: true }) });
  await expect(selected).toBeVisible();
  await expect(visible).toBeVisible();
  await expect(hidden).toBeVisible();

  await page.getByRole('button', { name: 'Add menu item', exact: true }).click();
  const editor = page.getByRole('dialog', { name: /MENU ITEM/ });
  await expect(editor.getByRole('button', { name: 'Remove item', exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Close editor' }).click();
  await selected.click();
  await editor.getByRole('button', { name: 'Remove item', exact: true }).click();
  const confirmation = editor.getByRole('group', { name: 'Confirm item removal' });
  await expect(confirmation).toContainText(selectedName);
  await expect(confirmation.getByRole('button', { name: 'Keep item', exact: true })).toBeFocused();
  assert.equal(deleteRequests, 0, 'The first remove click only opens confirmation.');
  await confirmation.getByRole('button', { name: 'Keep item', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Remove item', exact: true })).toBeFocused();
  assert.equal(deleteRequests, 0, 'Keeping the item does not issue a delete request.');
  assert.equal((await sql`select id from namche.menu_items where id=${selectedId}`).length, 1);
  await editor.getByRole('button', { name: 'Remove item', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Remove permanently', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('Temporary removal failure. Please try again.');
  await expect(editor).toBeVisible();
  await expect(confirmation).toBeVisible();
  assert.equal((await sql`select id from namche.menu_items where id=${selectedId}`).length, 1, 'A failed request retains the item.');

  await confirmation.getByRole('button', { name: 'Remove permanently', exact: true }).click();
  await pendingDelete;
  await expect(confirmation.getByRole('button', { name: 'Removing…', exact: true })).toBeDisabled();
  await expect(confirmation.getByRole('button', { name: 'Keep item', exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Close editor' })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  releaseDelete();
  await expect(editor).not.toBeVisible();
  await expect(selected).toHaveCount(0);
  await expect(visible).toBeVisible();
  await expect(hidden).toBeVisible();
  await expect(page.locator('.save-status')).toContainText(`${selectedName} was permanently removed`);
  assert.equal(deleteRequests, 2, 'Only explicit confirmation and retry issue requests.');
  assert.equal((await sql`select id from namche.menu_items where id=${selectedId}`).length, 0);
  assert.equal((await sql`select id from namche.menu_items where id in ${sql([visibleId, hiddenId])}`).length, 2);
  assert.equal((await sql`select id from namche.images where id=${image.id}`).length, 1, 'Removing an item preserves its reusable image.');

  const categories = page.getByRole('region', { name: 'Menu categories', exact: true });
  await expect(categories).toBeVisible();
  await categories.getByRole('group', { name: 'Category menu', exact: true }).getByRole('button', { name: 'Food', exact: true }).click();
  const categoryRow = name => categories.getByRole('group', { name: `${name} category`, exact: true });
  const addCategory = async name => {
    await categories.getByRole('textbox', { name: 'New food category', exact: true }).fill(name);
    await categories.getByRole('button', { name: 'Add category', exact: true }).click();
    await expect(categoryRow(name)).toBeVisible();
  };
  await addCategory(categoryName);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(categoryRow(categoryName)).toBeVisible();
  const [storedEmpty] = await sql`select name from namche.menu_categories where kind='food' and name=${categoryName}`;
  assert.equal(storedEmpty.name, categoryName, 'An empty category persists independently of menu items.');
  await sql`update namche.menu_items set category=${categoryName} where id in ${sql([visibleId, hiddenId])}`;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(categoryRow(categoryName)).toBeVisible();
  await categoryRow(categoryName).getByRole('button', { name: `Rename ${categoryName} category`, exact: true }).click();
  await categoryRow(categoryName).getByRole('textbox', { name: 'Rename category', exact: true }).fill(renamedCategory);
  await categoryRow(categoryName).getByRole('button', { name: 'Save category', exact: true }).click();
  await expect(categoryRow(renamedCategory)).toBeVisible();
  await expect(categoryRow(categoryName)).toHaveCount(0);
  let assigned = await sql`select id,category,available from namche.menu_items where id in ${sql([visibleId, hiddenId])} order by id`;
  assert.equal(assigned.length, 2);
  assert.ok(assigned.every(item => item.category === renamedCategory), 'Renaming updates visible and hidden items.');
  assert.equal(assigned.find(item => item.id === hiddenId).available, false, 'Renaming preserves hidden availability.');

  const publicPage = await context.newPage();
  await publicPage.route('**/api/images/**', route => route.abort());
  await publicPage.goto(`${base}/menu`, { waitUntil: 'domcontentloaded' });
  await expect(publicPage.getByRole('button', { name: renamedCategory, exact: true })).toBeVisible();
  await publicPage.getByRole('button', { name: renamedCategory, exact: true }).click();
  await expect(publicPage.getByRole('heading', { name: visibleName, exact: true })).toBeVisible();
  await expect(publicPage.getByRole('heading', { name: hiddenName, exact: true })).toHaveCount(0);
  await expect(publicPage.getByRole('heading', { name: selectedName, exact: true })).toHaveCount(0);

  await addCategory(replacementCategory);
  await addCategory(emptyCategory);
  await categoryRow(renamedCategory).getByRole('button', { name: `Remove ${renamedCategory} category`, exact: true }).click();
  const moveButton = categoryRow(renamedCategory).getByRole('button', { name: 'Move items & remove category', exact: true });
  await expect(moveButton).toBeDisabled();
  await categoryRow(renamedCategory).getByRole('button', { name: 'Keep category', exact: true }).click();
  assert.equal((await sql`select id from namche.menu_items where category=${renamedCategory} and id in ${sql([visibleId, hiddenId])}`).length, 2, 'Keeping a category does not move its items.');
  await categoryRow(renamedCategory).getByRole('button', { name: `Remove ${renamedCategory} category`, exact: true }).click();
  await categoryRow(renamedCategory).getByRole('combobox', { name: 'Move items to', exact: true }).selectOption(replacementCategory);
  await moveButton.click();
  await expect(categoryRow(renamedCategory)).toHaveCount(0);
  await expect(categoryRow(replacementCategory)).toBeVisible();
  assigned = await sql`select id,category,available,image_id from namche.menu_items where id in ${sql([visibleId, hiddenId])}`;
  assert.equal(assigned.length, 2, 'Removing a populated category keeps its dishes.');
  assert.ok(assigned.every(item => item.category === replacementCategory));
  assert.ok(assigned.every(item => item.image_id === image.id));
  assert.equal(assigned.find(item => item.id === hiddenId).available, false);
  assert.equal((await sql`select name from namche.menu_categories where kind='food' and name=${renamedCategory}`).length, 0);

  await categoryRow(emptyCategory).getByRole('button', { name: `Remove ${emptyCategory} category`, exact: true }).click();
  await categoryRow(emptyCategory).getByRole('button', { name: 'Remove empty category', exact: true }).click();
  await expect(categoryRow(emptyCategory)).toHaveCount(0);
  assert.equal((await sql`select name from namche.menu_categories where kind='food' and name=${emptyCategory}`).length, 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(categoryRow(replacementCategory)).toBeVisible();
  await expect(categoryRow(emptyCategory)).toHaveCount(0);

  await publicPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(publicPage.getByRole('button', { name: renamedCategory, exact: true })).toHaveCount(0);
  await publicPage.getByRole('button', { name: replacementCategory, exact: true }).click();
  await expect(publicPage.getByRole('heading', { name: visibleName, exact: true })).toBeVisible();
  await expect(publicPage.getByRole('heading', { name: hiddenName, exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(categories).toBeVisible();
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The mobile admin must fit the viewport.');
  await fs.mkdir('test-results/menu-management', { recursive: true });
  await categories.screenshot({ path: 'test-results/menu-management/categories-mobile.png', style: 'nextjs-portal { display: none !important; }' });
  await page.getByLabel('Search menu items').fill(token);
  await visible.click();
  await editor.getByRole('button', { name: 'Remove item', exact: true }).click();
  await expect(editor.getByRole('group', { name: 'Confirm item removal' })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The mobile removal dialog must fit the viewport.');
  await editor.screenshot({ path: 'test-results/menu-management/item-removal-mobile.png', style: 'nextjs-portal { display: none !important; }' });
  await editor.getByRole('button', { name: 'Keep item', exact: true }).click();
  await editor.getByRole('button', { name: 'Close editor' }).click();
  assert.deepEqual(errors, [], 'The browser must not report client errors.');
  console.log('Menu management UI passed: permanent deletion confirmation/cancel/failure retry/pending guards, real deletion with image and other item preservation, new-item editor, empty category persistence, rename including hidden items, reassignment before category deletion, empty deletion, public menu updates, and mobile overflow. SMTP disabled; isolated DB only.');
} catch (error) {
  if (page) await page.screenshot({ path: 'test-results/menu-management/failure.png', fullPage: true, style: 'nextjs-portal { display: none !important; }' }).catch(() => {});
  throw error;
} finally {
  releaseDelete();
  if (context) await context.request.post(`${base}/api/admin/logout`, { headers: { Origin: base } }).catch(() => {});
  await browser.close();
  try {
    await sql`delete from namche.menu_items where id in ${sql(fixtureIds)}`;
    await sql`delete from namche.menu_categories where kind='food' and name in ${sql(fixtureCategories)}`;
  } finally {
    await sql.end();
  }
}
