import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import * as net from 'node:net';
import postgres from 'postgres';
import { chromium, expect } from '@playwright/test';

if (process.env.TEST_ALLOW_DATABASE_WRITES !== 'isolated-reservation-tests' || process.env.SMTP_PASSWORD) {
  throw new Error('Use an isolated test database/server with SMTP disabled and TEST_ALLOW_DATABASE_WRITES=isolated-reservation-tests.');
}
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local isolated test server.');
const username = process.env.TEST_ADMIN_USERNAME;
const password = process.env.TEST_ADMIN_PASSWORD;
assert.ok(username && password, 'Set test staff credentials.');
net.setDefaultAutoSelectFamily(false);
const sql = postgres(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, { ssl: 'require', max: 1, connect_timeout: 15 });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const id = randomUUID();
const note = 'The dining room is closed for a private event.\nPlease call us to choose another evening.';
let context;
try {
  await sql`insert into namche.reservations(id,name,email,phone,date,time,guests,notes)
    values(${id},'Cancellation UI Test','cancellation-ui@example.com','6137611616',current_date+7,'18:00',2,'Guest asked for a window seat.')`;
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post(`${base}/api/admin/login`, { headers: { Origin: base }, data: { username, password } });
  assert.equal(login.status(), 200, 'Test staff can sign in.');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const updates = [];
  let rejectNext = true;
  await page.route('**/api/admin/reservations', async route => {
    updates.push(route.request().postDataJSON());
    if (rejectNext) {
      rejectNext = false;
      return route.fulfill({ status: 503, json: { error: 'Temporary save failure. Please try again.' } });
    }
    return route.continue();
  });
  await page.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  const cookieNotice = page.getByRole('button', { name: /^Got it/ });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  await page.getByRole('button', { name: /^Reservations/ }).click();
  const card = page.locator('.booking-card').filter({ hasText: 'Cancellation UI Test' });
  const status = card.getByLabel('Booking status');
  await status.selectOption('cancelled');
  await expect(card.getByLabel('Cancellation note')).toBeFocused();
  await expect(card.getByRole('button', { name: 'Cancel reservation', exact: true })).toBeDisabled();
  await card.getByLabel('Cancellation note').fill('   ');
  await expect(card.getByRole('button', { name: 'Cancel reservation', exact: true })).toBeDisabled();
  assert.equal(updates.length, 0, 'Selecting cancelled must wait for a note and explicit submit.');
  await card.getByRole('button', { name: 'Keep booking' }).click();
  await expect(status).toHaveValue('pending');
  assert.equal(updates.length, 0, 'Keeping the booking must not mutate it.');

  await status.selectOption('cancelled');
  await card.getByLabel('Cancellation note').fill(`  ${note}  `);
  await card.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
  await expect(page.locator('.admin-shell').getByRole('alert')).toHaveText('Temporary save failure. Please try again.');
  await expect(card.getByLabel('Cancellation note')).toHaveValue(`  ${note}  `);
  const [unchanged] = await sql`select status,cancellation_note from namche.reservations where id=${id}`;
  assert.equal(unchanged.status, 'pending');
  assert.equal(unchanged.cancellation_note, '');
  await card.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
  await expect(card.getByLabel('Cancellation note')).toHaveCount(0);
  await expect(card.getByText(note, { exact: true })).toBeVisible();
  await expect(page.locator('.admin-shell').getByRole('status')).toContainText('Email was not sent; please contact the guest directly.');
  assert.deepEqual(updates[1], { id, status: 'cancelled', cancellation_note: note });
  const [cancelled] = await sql`select status,cancellation_note,notes from namche.reservations where id=${id}`;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellation_note, note);
  assert.equal(cancelled.notes, 'Guest asked for a window seat.');

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Reservations/ }).click();
  await expect(card.getByText(note, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByText(note, { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The mobile admin must fit the viewport.');
  await fs.mkdir('test-results', { recursive: true });
  await card.screenshot({ path: 'test-results/cancellation-note-mobile.png', style: 'nextjs-portal { display: none !important; }' });
  await status.selectOption('confirmed');
  await expect(card.getByText(note, { exact: true })).toHaveCount(0);
  const [reopened] = await sql`select status,cancellation_note from namche.reservations where id=${id}`;
  assert.equal(reopened.status, 'confirmed');
  assert.equal(reopened.cancellation_note, '');
  assert.deepEqual(errors, [], 'The browser must not report client errors.');
  console.log('Cancellation UI passed: required note, keep booking, failed-save retry, trimming, real persistence, refresh, guest notes preserved, mobile layout, and clearing on status change. SMTP disabled.');
} finally {
  if (context) await context.request.post(`${base}/api/admin/logout`, { headers: { Origin: base } }).catch(() => {});
  await browser.close();
  await sql`delete from namche.reservations where id=${id}`;
  await sql.end();
}
