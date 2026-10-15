import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const username = process.env.TEST_ADMIN_USERNAME;
const password = process.env.TEST_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Set TEST_ADMIN_USERNAME and TEST_ADMIN_PASSWORD for the test environment.');

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let context;
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const login = await context.request.post(`${base}/api/admin/login`, {
    headers: { Origin: base }, data: { username, password },
  });
  assert.equal(login.status(), 200, 'The test admin must be able to sign in.');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  let allowLoad = false;
  let failNextClose = true;
  let failNextReopen = true;
  let pauseNextClose = false;
  let releaseClose;
  let closeStarted;
  let closures = [{ date: '2026-10-24', reason: 'Private event', public_reason: 'Closed for a private event.', active_reservations: 2 }];
  const mutations = [];
  await page.route('**/api/admin/reservation-closures', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      if (!allowLoad) {
        return route.fulfill({ status: 503, json: { error: 'Availability is temporarily unavailable.' } });
      }
      return route.fulfill({ json: { closures, today: '2026-10-15', maxDate: '2027-04-13' } });
    }
    const data = request.postDataJSON();
    mutations.push({ method: request.method(), data });
    if (request.method() === 'POST') {
      if (failNextClose) {
        failNextClose = false;
        return route.fulfill({ status: 503, json: { error: 'The date could not be saved. Please try again.' } });
      }
      if (pauseNextClose) {
        pauseNextClose = false;
        await new Promise(resolve => { releaseClose = resolve; closeStarted(); });
      }
      closures.push({ ...data, active_reservations: 1 });
      return route.fulfill({ json: { ok: true, activeReservations: 1 } });
    }
    if (failNextReopen) {
      failNextReopen = false;
      return route.fulfill({ status: 503, json: { error: 'The date could not be reopened. Please try again.' } });
    }
    closures = closures.filter(closure => closure.date !== data.date);
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto(`${base}/admin`, { waitUntil: 'networkidle' });
  const cookieNotice = page.getByRole('button', { name: /^Got it/ });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  await page.getByRole('button', { name: /^Reservations/ }).click();
  const panel = page.getByRole('region', { name: 'Close a day for reservations.' });
  const closeButton = panel.getByRole('button', { name: 'Close this date' });
  const date = panel.getByLabel('Date to close');
  const note = panel.getByLabel('Internal note (optional)');
  const publicReason = panel.getByLabel('Public closure reason');
  await expect(panel.getByRole('alert')).toHaveText('Availability is temporarily unavailable.');
  await expect(closeButton).toBeDisabled();
  allowLoad = true;
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(panel.getByText('2 existing active reservations')).toBeVisible();
  await expect(panel.getByText('Existing reservations are not cancelled.', { exact: false })).toBeVisible();
  await expect(date).toHaveAttribute('min', '2026-10-15');
  await expect(date).toHaveAttribute('max', '2027-04-13');
  await expect(note).toHaveAttribute('maxlength', '300');
  await expect(publicReason).toHaveAttribute('maxlength', '300');
  await expect(publicReason).toHaveAttribute('required', '');
  await date.fill('2026-10-24');
  await expect(closeButton).toBeDisabled();
  await date.fill('2026-10-26');
  await note.fill('  Staff training  ');
  await publicReason.fill('  Closed for staff training.  ');
  await closeButton.click();
  await expect(panel.getByRole('alert')).toHaveText('The date could not be saved. Please try again.');
  await expect(date).toHaveValue('2026-10-26');
  await expect(note).toHaveValue('  Staff training  ');
  await expect(publicReason).toHaveValue('  Closed for staff training.  ');

  pauseNextClose = true;
  const pendingClose = new Promise(resolve => { closeStarted = resolve; });
  await closeButton.click();
  await pendingClose;
  await expect(panel.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await expect(date).toBeDisabled();
  await expect(note).toBeDisabled();
  await expect(publicReason).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Reopen Saturday, October 24, 2026 for reservations' })).toBeDisabled();
  releaseClose();
  await expect(panel.getByRole('status')).toContainText('Monday, October 26, 2026 is closed');
  await expect(panel.getByRole('status')).toContainText('1 existing reservation needs your attention');
  await expect(panel.getByText('Staff note: Staff training', { exact: true })).toBeVisible();
  await expect(panel.getByText('Public reason: Closed for staff training.', { exact: true })).toBeVisible();
  await expect(date).toHaveValue('');
  await expect(note).toHaveValue('');
  await expect(publicReason).toHaveValue('');

  const reopen24 = panel.getByRole('button', { name: 'Reopen Saturday, October 24, 2026 for reservations' });
  await reopen24.click();
  await expect(panel.getByRole('alert')).toHaveText('The date could not be reopened. Please try again.');
  await expect(panel.getByText('Staff note: Private event', { exact: true })).toBeVisible();
  await expect(panel.getByText('Public reason: Closed for a private event.', { exact: true })).toBeVisible();
  await reopen24.click();
  await expect(panel.getByRole('status')).toContainText('open to new reservations again');
  await expect(panel.getByText('Staff note: Private event', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('Public reason: Closed for a private event.', { exact: true })).toHaveCount(0);

  await fs.mkdir('test-results', { recursive: true });
  await panel.screenshot({ path: 'test-results/admin-closures-desktop.png', style: 'nextjs-portal { display: none !important; }' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The mobile page must fit the viewport.');
  await panel.screenshot({ path: 'test-results/admin-closures-mobile.png', style: 'nextjs-portal { display: none !important; }' });

  await panel.getByRole('button', { name: 'Reopen Monday, October 26, 2026 for reservations' }).click();
  await expect(panel.getByText('No upcoming dates are closed.', { exact: true })).toBeVisible();
  assert.deepEqual(mutations, [
    { method: 'POST', data: { date: '2026-10-26', reason: 'Staff training', public_reason: 'Closed for staff training.' } },
    { method: 'POST', data: { date: '2026-10-26', reason: 'Staff training', public_reason: 'Closed for staff training.' } },
    { method: 'DELETE', data: { date: '2026-10-24' } },
    { method: 'DELETE', data: { date: '2026-10-24' } },
    { method: 'DELETE', data: { date: '2026-10-26' } },
  ]);
  assert.deepEqual(errors, [], 'The browser must not report client errors.');
  console.log('Admin closed-date UI passed loading retry, date bounds, duplicate protection, failed saves, pending controls, close/reopen, public reason, private note, guest warning, empty state, and mobile overflow checks. Closure mutations were mocked.');
} finally {
  if (context) await context.request.post(`${base}/api/admin/logout`, { headers: { Origin: base } }).catch(() => {});
  await browser.close();
}
