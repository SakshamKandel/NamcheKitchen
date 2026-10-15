import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import sharp from 'sharp';
import { chromium, expect as baseExpect } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30000 });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use a local test server.');
assert.equal(process.env.TEST_ALLOW_DATABASE_WRITES, 'isolated-reservation-tests', 'Use the isolated test environment.');
assert.ok(!process.env.SMTP_PASSWORD, 'Disable outgoing email for browser checks.');
const main = parseEnv(await fs.readFile('.env.local', 'utf8'));
const hostname = value => new URL(value).hostname.replace('-pooler', '');
assert.notEqual(hostname(process.env.DATABASE_URL), hostname(main.DATABASE_URL), 'Keep the main database untouched.');
assert.ok(process.env.TEST_ADMIN_USERNAME && process.env.TEST_ADMIN_PASSWORD, 'Set isolated staff credentials.');

const output = 'test-results/crop-zoom';
await fs.mkdir(output, { recursive: true });
const fixtures = [];
for (const [name, width, height] of [['landscape', 1600, 900], ['square', 1200, 1200], ['portrait', 900, 1600]]) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.floor(x / width * 12);
    const row = Math.floor(y / height * 12);
    const offset = (y * width + x) * channels;
    data[offset] = 30 + column * 18;
    data[offset + 1] = 30 + row * 18;
    data[offset + 2] = 40 + ((row + column) % 6) * 32;
  }
  const file = path.resolve(output, `${name}.png`);
  await sharp(data, { raw: { width, height, channels } }).png().toFile(file);
  fixtures.push({ name, file, width, height });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
context.setDefaultTimeout(30000);
let page;
const errors = [];
const uploads = [];
const forbiddenWrites = [];
const results = [];

const geometry = () => page.locator('.crop-stage').evaluate(stage => {
  const image = stage.querySelector('img');
  const crop = stage.querySelector('.reactEasyCrop_CropArea');
  const rectangle = element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
  };
  return {
    image: rectangle(image), crop: rectangle(crop), stage: rectangle(stage),
    natural: { width: image.naturalWidth, height: image.naturalHeight },
    slider: Object.fromEntries(['min', 'max', 'step', 'value'].map(key => [key, Number(document.querySelector('.crop-zoom input')[key])])),
  };
});

const setZoom = async value => {
  const slider = page.getByRole('slider', { name: /Zoom/ });
  const maximum = Number(await slider.getAttribute('max'));
  const minimum = Number(await slider.getAttribute('min'));
  assert.ok(value === maximum || value === minimum, 'Exercise the slider through its keyboard boundaries.');
  await slider.press(value === maximum ? 'End' : 'Home');
  await expect.poll(async () => Number(await page.getByRole('slider', { name: /Zoom/ }).inputValue())).toBeCloseTo(value, 2);
  await page.waitForTimeout(100);
};

const assertCovered = state => {
  assert.ok(state.image.x <= state.crop.x + 1 && state.image.y <= state.crop.y + 1 && state.image.right >= state.crop.right - 1 && state.image.bottom >= state.crop.bottom - 1,
    `The crop must contain image pixels without blank edges: ${JSON.stringify(state)}`);
};

const assertFit = state => {
  assertCovered(state);
  const fittedEdge = Math.min(Math.abs(state.image.width - state.crop.width), Math.abs(state.image.height - state.crop.height));
  assert.ok(fittedEdge <= 2, `Minimum zoom should show the widest crop that fills the 4:3 frame, fitted edge=${fittedEdge}`);
  assert.ok(Math.abs(state.crop.width / state.crop.height - 4 / 3) < 0.01, 'The frame keeps the menu image ratio.');
  assert.ok(Math.abs(state.image.width / state.image.height - state.natural.width / state.natural.height) < 0.01, 'The preview preserves source image proportions.');
};

const assertViewport = async () => {
  const layout = await page.locator('.crop-editor').evaluate(editor => {
    const rect = editor.getBoundingClientRect();
    const visible = selector => {
      const box = editor.querySelector(selector).getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1;
    };
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, slider: visible('input[type="range"]'), actions: visible('.editor-actions'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(layout.x >= -1 && layout.y >= -1 && layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1 && layout.slider && layout.actions && !layout.horizontalOverflow,
    `The crop frame and controls must fit the viewport: ${JSON.stringify(layout)}`);
};

async function previewPixels() {
  return page.locator('.crop-stage').evaluate(stage => {
    const image = stage.querySelector('img');
    const imageBox = image.getBoundingClientRect();
    const crop = stage.querySelector('.reactEasyCrop_CropArea').getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const drawing = canvas.getContext('2d');
    drawing.drawImage(image, (crop.x - imageBox.x) / imageBox.width * image.naturalWidth, (crop.y - imageBox.y) / imageBox.height * image.naturalHeight, crop.width / imageBox.width * image.naturalWidth, crop.height / imageBox.height * image.naturalHeight, 0, 0, canvas.width, canvas.height);
    return Array.from(drawing.getImageData(0, 0, canvas.width, canvas.height).data);
  });
}

async function verifyUpload(preview, label) {
  const count = uploads.length;
  await page.getByRole('button', { name: 'Use this crop', exact: true }).click();
  await expect.poll(() => uploads.length).toBe(count + 1);
  await expect(page.getByRole('dialog', { name: 'Crop menu image', exact: true })).not.toBeVisible();
  const uploaded = uploads.at(-1);
  const metadata = await sharp(uploaded).metadata();
  assert.equal(metadata.format, 'jpeg', 'The prepared menu crop is a JPEG.');
  assert.ok(Math.abs(metadata.width / metadata.height - 4 / 3) < 0.004, 'The uploaded image follows the preview ratio.');
  const raw = await sharp(uploaded).resize(320, 240).removeAlpha().raw().toBuffer();
  let difference = 0;
  let countPixels = 0;
  for (let y = 12; y < 228; y += 12) for (let x = 12; x < 308; x += 12) {
    for (let channel = 0; channel < 3; channel++) difference += Math.abs(raw[(y * 320 + x) * 3 + channel] - preview[(y * 320 + x) * 4 + channel]);
    countPixels += 3;
  }
  assert.ok(difference / countPixels < 4, `Saved crop must match the visible selection: average channel difference=${difference / countPixels}`);
  await fs.writeFile(path.join(output, `${label}-uploaded.jpg`), uploaded);
  return { width: metadata.width, height: metadata.height, averagePixelDifference: difference / countPixels };
}

try {
  const login = await context.request.post(`${base}/api/admin/login`, {
    headers: { Origin: base }, data: { username: process.env.TEST_ADMIN_USERNAME, password: process.env.TEST_ADMIN_PASSWORD },
  });
  assert.equal(login.status(), 200, 'The isolated staff can sign in.');
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/admin/**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.continue();
    if (new URL(request.url()).pathname === '/api/admin/upload') {
      const form = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
      const image = form.get('image');
      assert.ok(image instanceof File, 'The crop is sent as an image file.');
      uploads.push(Buffer.from(await image.arrayBuffer()));
      return route.fulfill({ status: 200, json: { id: `crop-zoom-mocked-image-${uploads.length}` } });
    }
    forbiddenWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.fulfill({ status: 500, json: { error: 'This crop test must never save menu or category changes.' } });
  });
  await page.route('**/api/images/crop-zoom-mocked-image-*', async route => {
    const index = Number(new URL(route.request().url()).pathname.split('-').at(-1)) - 1;
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: uploads[index] });
  });
  await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
  const notice = page.getByRole('button', { name: /^Got it/ });
  if (await notice.isVisible()) await notice.click();
  await page.getByRole('button', { name: 'Add menu item', exact: true }).click();
  const editor = page.getByRole('dialog', { name: /ADD MENU ITEM/ });
  const cropper = page.getByRole('dialog', { name: 'Crop menu image', exact: true });

  for (const [viewport, label] of [[{ width: 1440, height: 1000 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile'], [{ width: 844, height: 390 }, 'short']]) {
    await page.setViewportSize(viewport);
    for (const fixture of fixtures) {
      await editor.locator('input[type="file"]').setInputFiles(fixture.file);
      await expect(cropper).toBeVisible();
      await expect.poll(async () => page.locator('.crop-stage img').evaluate(image => image.complete && image.naturalWidth)).toBe(fixture.width);
      await expect(cropper.getByRole('button', { name: 'Use this crop', exact: true })).toBeEnabled();
      await page.waitForTimeout(150);
      let state = await geometry();
      const initial = state;
      assertFit(state);
      await assertViewport();
      const startingZoom = state.slider.value;
      const maximum = state.slider.max;
      await setZoom(maximum);
      const enlarged = await geometry();
      assert.ok(enlarged.image.width > state.image.width * 1.5, 'The slider zooms in.');
      assertCovered(enlarged);
      await page.locator('.reactEasyCrop_Container').press('ArrowRight');
      await page.locator('.reactEasyCrop_Container').press('ArrowDown');
      const stage = enlarged.stage;
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width / 2 + 45, stage.y + stage.height / 2 + 35, { steps: 8 });
      await page.mouse.up();
      const dragged = await geometry();
      assert.ok(Math.abs(dragged.image.x - enlarged.image.x) > 5 || Math.abs(dragged.image.y - enlarged.image.y) > 5, 'Dragging moves the photo inside the frame.');
      assertCovered(dragged);
      await cropper.getByRole('button', { name: 'Reset view', exact: true }).click();
      await expect(page.getByRole('slider', { name: 'Zoom', exact: true })).toHaveValue('1');
      const reset = await geometry();
      assertFit(reset);
      assert.ok(Math.abs(reset.image.x + reset.image.width / 2 - (reset.crop.x + reset.crop.width / 2)) < 1 && Math.abs(reset.image.y + reset.image.height / 2 - (reset.crop.y + reset.crop.height / 2)) < 1,
        'Reset view centers the image again.');
      if (label === 'mobile') {
        const cdp = await context.newCDPSession(page);
        const centerX = reset.crop.x + reset.crop.width / 2;
        const centerY = reset.crop.y + reset.crop.height / 2;
        const touches = distance => [{ id: 1, x: centerX - distance, y: centerY }, { id: 2, x: centerX + distance, y: centerY }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(25) });
        for (const distance of [30, 35, 40, 45]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(distance) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Zoom', exact: true }).inputValue())).toBeGreaterThan(1.1);
        assertCovered(await geometry());
        await cdp.detach();
      }
      await setZoom(startingZoom);
      state = await geometry();
      assertFit(state);
      await assertViewport();
      await cropper.screenshot({ path: path.join(output, `${label}-${fixture.name}-minimum.png`), style: 'nextjs-portal { display: none !important; }' });
      const prepared = await verifyUpload(await previewPixels(), `${label}-${fixture.name}`);
      results.push({ label, fixture: fixture.name, initial, prepared });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('button', { name: 'Adjust crop & layout', exact: true }).click();
  await expect(cropper).toBeVisible();
  await expect(cropper.getByRole('button', { name: 'Use this crop', exact: true })).toBeEnabled();
  assertFit(await geometry());
  await assertViewport();
  await setZoom(3);
  const selected = (await geometry()).crop;
  await page.mouse.move(selected.x + selected.width / 2, selected.y + selected.height / 2);
  await page.mouse.down();
  await page.mouse.move(selected.x + selected.width / 2 - 45, selected.y + selected.height / 2 - 25, { steps: 8 });
  await page.mouse.up();
  assertCovered(await geometry());
  await cropper.screenshot({ path: path.join(output, 'mobile-existing-image-zoomed.png'), style: 'nextjs-portal { display: none !important; }' });
  const zoomed = await verifyUpload(await previewPixels(), 'mobile-existing-image-zoomed');
  results.push({ label: 'mobile-existing-image-zoomed', prepared: zoomed });
  await editor.getByRole('button', { name: 'Adjust crop & layout', exact: true }).click();
  await expect(cropper).toBeVisible();
  await expect(cropper.getByRole('button', { name: 'Use this crop', exact: true })).toBeEnabled();
  assertFit(await geometry());
  await cropper.getByRole('button', { name: 'Cancel', exact: true }).click();
  await editor.getByRole('button', { name: 'Close editor', exact: true }).click();
  assert.deepEqual(forbiddenWrites, [], 'No menu/category mutations leave the browser.');
  assert.deepEqual(errors, [], 'The browser reports no runtime errors.');
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors, uploads: uploads.length, forbiddenWrites }, null, 2));
  console.log(JSON.stringify({ cases: results.length, uploads: uploads.length, browserErrors: errors, forbiddenWrites }));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, style: 'nextjs-portal { display: none !important; }' }).catch(() => {});
  throw error;
} finally {
  await context.request.post(`${base}/api/admin/logout`, { headers: { Origin: base } }).catch(() => {});
  await browser.close();
}
