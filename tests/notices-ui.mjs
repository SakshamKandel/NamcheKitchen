import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { chromium, expect as baseExpect } from '@playwright/test';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local isolated server.');
assert.equal(process.env.TEST_ALLOW_DATABASE_WRITES, 'isolated-reservation-tests');
assert.ok(!process.env.SMTP_PASSWORD, 'Disable outgoing email.');
const main = parseEnv(await fs.readFile('.env.local', 'utf8'));
const host = url => new URL(url).hostname.replace('-pooler', '');
assert.notEqual(host(process.env.DATABASE_URL), host(main.DATABASE_URL), 'Keep the main database untouched.');
const output = 'test-results/reviews';
await fs.mkdir(output, { recursive: true });
const expect = baseExpect.configure({ timeout: 20000 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const results = [];
const errors = [];
let ownedNotice;
let ownedClosure;
const token = randomUUID().slice(0, 8);
const title = `Kitchen announcement ${token}`;
const revised = `Live music update ${token}`;
const privateNote = `Private staffing detail ${token}`;
const publicReason = `Closed for a private celebration ${token}.`;
const api = (method, url, data) => admin.request.fetch(`${base}${url}`, { method, headers: { Origin: base }, data });
const safeImages = async context => context.route('**/*', route => {
  if (route.request().resourceType() === 'image') return route.abort();
  return route.continue();
});
async function checkHeader(page) {
  const geometry = await page.evaluate(() => {
    const notice = document.querySelector('aside[aria-label="Restaurant notices"]').getBoundingClientRect();
    const header = document.querySelector('header').getBoundingClientRect();
    return { noticeBottom: notice.bottom, navTop: header.top, navLeft: header.left, navRight: header.right, width: innerWidth, bodyWidth: document.body.scrollWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.ok(geometry.navTop >= geometry.noticeBottom, `Navigation follows notices: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.navLeft >= 0 && geometry.navRight <= geometry.width + 1 && geometry.bodyWidth <= geometry.width + 1 && geometry.documentWidth <= geometry.width + 1, `Notice layout fits viewport: ${JSON.stringify(geometry)}`);
}
const dateLabel = date => new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
let page;
let publicPage;
let mobile;
try {
  for (const context of [admin, guest, mobileContext]) { await safeImages(context); context.on('page', page => page.on('pageerror', error => errors.push(error.message))); }
  const login = await api('POST', '/api/admin/login', { username: process.env.TEST_ADMIN_USERNAME, password: process.env.TEST_ADMIN_PASSWORD });
  assert.equal(login.status(), 200, 'Isolated staff can sign in.');
  page = await admin.newPage();
  await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Notices', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Keep your guests in the know.' });
  await panel.getByRole('button', { name: 'Add homepage notice', exact: true }).click();
  await panel.getByLabel('Notice title', { exact: true }).fill(title);
  await panel.getByRole('combobox', { name: /^Notice type/ }).selectOption('event');
  await panel.getByRole('textbox', { name: /^Notice message/ }).fill('Join us for a warm evening of Nepali food and live music.');
  const staffList = await (await api('GET', '/api/admin/notices')).json();
  await panel.getByLabel('First display date').fill(staffList.today);
  await panel.getByLabel('Last display date').fill(staffList.today);
  await panel.getByLabel('Event or closure date').fill(staffList.today);
  const saved = page.waitForResponse(response => response.url().endsWith('/api/admin/notices') && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Save notice', exact: true }).click();
  const saveResponse = await saved;
  assert.equal(saveResponse.status(), 201);
  ownedNotice = (await saveResponse.json()).notice.id;
  await expect(panel.getByRole('status')).toContainText('Notice saved.');
  await expect(panel.getByRole('button', { name: `Edit notice: ${title}`, exact: true })).toBeVisible();
  results.push('Staff create a scheduled event notice from the admin Notices tab.');

  publicPage = await guest.newPage();
  await publicPage.clock.install({ time: new Date() });
  await publicPage.goto(base, { waitUntil: 'domcontentloaded' });
  const banner = publicPage.getByRole('complementary', { name: 'Restaurant notices' });
  await expect(banner).toContainText(title);
  await expect(banner).toContainText('Join us for a warm evening');
  await checkHeader(publicPage);
  await publicPage.screenshot({ path: `${output}/notice-desktop.png`, animations: 'disabled' });
  results.push('Current notices appear above desktop navigation without overlap or overflow.');

  await banner.getByRole('button', { name: `Dismiss notice: ${title}`, exact: true }).click();
  await expect(publicPage.getByRole('button', { name: 'Dismiss notice: ' + title, exact: true })).toHaveCount(0);
  await publicPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(publicPage.getByRole('button', { name: `Dismiss notice: ${title}`, exact: true })).toHaveCount(0);
  results.push('Guest dismissal persists across reloads.');

  await panel.getByRole('button', { name: `Edit notice: ${title}`, exact: true }).click();
  await panel.getByLabel('Notice title', { exact: true }).fill(revised);
  await panel.getByRole('textbox', { name: /^Notice message/ }).fill('Live music begins at 7 pm. We look forward to welcoming you.');
  const updated = page.waitForResponse(response => response.url().endsWith('/api/admin/notices') && response.request().method() === 'PATCH');
  await panel.getByRole('button', { name: 'Save notice', exact: true }).click();
  assert.equal((await updated).status(), 200);
  await expect(panel.getByRole('button', { name: `Edit notice: ${revised}`, exact: true })).toBeVisible();
  await publicPage.evaluate(() => { window.__noticesQaMarker = 'same document'; });
  await publicPage.clock.fastForward(61000);
  await expect(banner).toContainText(revised);
  assert.equal(await publicPage.evaluate(() => window.__noticesQaMarker), 'same document');
  results.push('Editing a dismissed notice displays the new version on an open homepage automatically.');

  mobile = await mobileContext.newPage();
  await mobile.goto(base, { waitUntil: 'domcontentloaded' });
  const mobileBanner = mobile.getByRole('complementary', { name: 'Restaurant notices' });
  await expect(mobileBanner).toContainText(revised);
  await checkHeader(mobile);
  await mobile.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(mobile.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await mobile.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await mobile.screenshot({ path: `${output}/notice-mobile.png`, animations: 'disabled' });
  results.push('Mobile notices fit above the navigation and the menu still opens and closes.');

  await panel.getByRole('button', { name: `Edit notice: ${revised}`, exact: true }).click();
  await panel.getByLabel('Show this notice during its display dates').uncheck();
  await panel.getByRole('button', { name: 'Save notice', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Notice saved as hidden.');
  await publicPage.clock.fastForward(61000);
  await expect(publicPage.getByRole('button', { name: `Dismiss notice: ${revised}`, exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: `Remove notice: ${revised}`, exact: true }).click();
  await panel.getByRole('button', { name: 'Keep notice', exact: true }).click();
  await expect(panel.getByRole('button', { name: `Edit notice: ${revised}`, exact: true })).toBeVisible();
  await panel.getByRole('button', { name: `Remove notice: ${revised}`, exact: true }).click();
  await panel.getByRole('button', { name: 'Remove notice', exact: true }).click();
  await expect(panel.getByRole('button', { name: `Edit notice: ${revised}`, exact: true })).toHaveCount(0);
  ownedNotice = undefined;
  results.push('Staff can hide notices and cancel or confirm permanent removal.');

  const availability = await (await api('GET', '/api/admin/reservation-closures')).json();
  const closed = new Set(availability.closures.map(closure => closure.date));
  let candidate = new Date(`${availability.maxDate}T12:00:00Z`);
  for (let index = 0; index < 30 && closed.has(candidate.toISOString().slice(0, 10)); index++) candidate.setUTCDate(candidate.getUTCDate() - 1);
  const closureDate = candidate.toISOString().slice(0, 10);
  assert.ok(!closed.has(closureDate), 'Pick a previously unused date.');
  await page.getByRole('button', { name: /^Reservations/ }).click();
  const closurePanel = page.getByRole('region', { name: 'Close a day for reservations.' });
  await expect(closurePanel.getByLabel('Date to close', { exact: true })).toBeEnabled();
  await closurePanel.getByLabel('Date to close', { exact: true }).fill(closureDate);
  await closurePanel.getByLabel('Public closure reason', { exact: true }).fill(publicReason);
  await closurePanel.getByLabel('Internal note').fill(privateNote);
  const closedResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/reservation-closures') && response.request().method() === 'POST');
  await closurePanel.getByRole('button', { name: 'Close this date', exact: true }).click();
  assert.equal((await closedResponse).status(), 200);
  ownedClosure = closureDate;
  await expect(closurePanel.getByRole('button', { name: `Edit closure details for ${dateLabel(closureDate)}`, exact: true })).toBeVisible();
  await expect(closurePanel).toContainText(privateNote);
  results.push('Staff can close a day with separate public and internal explanations.');

  await mobile.goto(`${base}/reservations`, { waitUntil: 'domcontentloaded' });
  await expect(mobile.locator('.reservation-form input[name="date"]')).toBeEnabled();
  await mobile.locator('.reservation-form input[name="date"]').fill(closureDate);
  await expect(mobile.locator('#reservation-date-error')).toContainText(publicReason);
  await expect(mobile.locator('body')).not.toContainText(privateNote);
  await expect(mobile.getByRole('button', { name: 'Request your table', exact: true })).toBeDisabled();
  results.push('Guests see the public closure reason and cannot submit for that day; staff notes stay private.');

  await closurePanel.getByRole('button', { name: `Edit closure details for ${dateLabel(closureDate)}`, exact: true }).click();
  await expect(closurePanel.getByLabel('Date to close', { exact: true })).toHaveAttribute('readonly', '');
  await closurePanel.getByLabel('Public closure reason', { exact: true }).fill(`${publicReason} Please visit us another day.`);
  const closureUpdated = page.waitForResponse(response => response.url().endsWith('/api/admin/reservation-closures') && response.request().method() === 'PATCH');
  await closurePanel.getByRole('button', { name: 'Save closure details', exact: true }).click();
  assert.equal((await closureUpdated).status(), 200);
  await expect(closurePanel.getByRole('status')).toContainText('were updated.');
  await closurePanel.getByRole('button', { name: `Reopen ${dateLabel(closureDate)} for reservations`, exact: true }).click();
  await expect(closurePanel.getByRole('button', { name: `Edit closure details for ${dateLabel(closureDate)}`, exact: true })).toHaveCount(0);
  ownedClosure = undefined;
  results.push('Staff edit closure explanations while keeping the day closed, then reopen it.');

  assert.deepEqual(errors, [], `No browser runtime errors: ${errors.join('; ')}`);
  await fs.writeFile(`${output}/notices-results.json`, JSON.stringify({ passed: results.length, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results, errors }, null, 2));
} catch (error) {
  await fs.writeFile(`${output}/notices-failure.json`, JSON.stringify({ message: error.message, stack: error.stack, passed: results, errors }, null, 2));
  await page?.screenshot({ path: `${output}/notices-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (ownedNotice) await api('DELETE', '/api/admin/notices', { id: ownedNotice }).catch(() => {});
  if (ownedClosure) await api('DELETE', '/api/admin/reservation-closures', { date: ownedClosure }).catch(() => {});
  await api('POST', '/api/admin/logout').catch(() => {});
  await Promise.all([admin.close(), guest.close(), mobileContext.close()]);
  await browser.close();
}



