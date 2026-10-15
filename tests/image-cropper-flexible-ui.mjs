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

const output = 'test-results/crop-flexible';
await fs.mkdir(output, { recursive: true });
const fixtures = {};
for (const [name, width, height] of [['landscape', 1600, 900], ['square', 1200, 1200], ['portrait', 900, 1600], ['large', 3000, 2250]]) {
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
  fixtures[name] = { name, file, width, height };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
context.setDefaultTimeout(30000);
let page;
let editor;
let cropper;
const errors = [];
const uploads = [];
const forbiddenWrites = [];
const results = [];
const slider = () => cropper.getByRole('slider', { name: 'Zoom', exact: true });
const shape = () => cropper.getByLabel('Crop shape', { exact: true });
const geometry = () => page.locator('.crop-stage').evaluate(stage => {
  const rectangle = element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
  };
  const image = stage.querySelector('img');
  return { image: rectangle(image), crop: rectangle(stage.querySelector('.reactEasyCrop_CropArea')), stage: rectangle(stage), natural: { width: image.naturalWidth, height: image.naturalHeight } };
});
const settled = async () => {
  await expect(cropper.getByRole('button', { name: 'Use this crop', exact: true })).toBeEnabled();
  await page.waitForTimeout(100);
};
const assertCovered = state => assert.ok(
  state.image.x <= state.crop.x + 1 && state.image.y <= state.crop.y + 1 && state.image.right >= state.crop.right - 1 && state.image.bottom >= state.crop.bottom - 1,
  `The crop must contain image pixels without blank edges: ${JSON.stringify(state)}`,
);
const assertFit = (state, ratio) => {
  assertCovered(state);
  assert.ok(Math.min(Math.abs(state.image.width - state.crop.width), Math.abs(state.image.height - state.crop.height)) <= 2, 'Minimum zoom shows the widest possible selection.');
  assert.ok(Math.abs(state.crop.width / state.crop.height - ratio) < 0.015, `The selected crop ratio is ${ratio}.`);
};
const centered = state => {
  assert.ok(Math.abs(state.image.x + state.image.width / 2 - (state.crop.x + state.crop.width / 2)) < 1 && Math.abs(state.image.y + state.image.height / 2 - (state.crop.y + state.crop.height / 2)) < 1, 'Reset centers the photo.');
};
async function assertViewport() {
  const layout = await cropper.evaluate(editor => {
    const box = editor.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(layout.left >= -1 && layout.top >= -1 && layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1 && !layout.horizontalOverflow, `Crop dialog fits the viewport: ${JSON.stringify(layout)}`);
  for (const control of [shape(), slider(), cropper.getByRole('button', { name: 'Keep full photo', exact: true }), cropper.getByRole('button', { name: 'Use this crop', exact: true })]) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'All crop controls can be reached inside the viewport.');
  }
}
async function open(fixture) {
  await editor.locator('input[type="file"]').setInputFiles(fixture.file);
  await expect(editor.locator('input[type="file"]')).toHaveValue('');
  await expect(cropper).toBeVisible();
  await expect.poll(() => page.locator('.crop-stage img').evaluate(image => image.complete && image.naturalWidth)).toBe(fixture.width);
  await settled();
  await expect(slider()).toHaveValue('1');
  await expect(shape()).toHaveValue('4:3');
  assertFit(await geometry(), 4 / 3);
}
async function choose(value) {
  await shape().selectOption(value);
  await settled();
}
async function zoomBoundary(key, value) {
  await slider().press(key);
  await expect.poll(async () => Number(await slider().inputValue())).toBe(value);
  await expect(slider()).toHaveAttribute('aria-valuetext', `${value * 100}%`);
  await settled();
}
async function previewPixels(rotation, width, height) {
  return page.locator('.crop-stage').evaluate((stage, { rotation, width, height }) => {
    const image = stage.querySelector('img');
    const imageBox = image.getBoundingClientRect();
    const crop = stage.querySelector('.reactEasyCrop_CropArea').getBoundingClientRect();
    const rotated = document.createElement('canvas');
    const swap = rotation % 180 !== 0;
    rotated.width = swap ? image.naturalHeight : image.naturalWidth;
    rotated.height = swap ? image.naturalWidth : image.naturalHeight;
    const source = rotated.getContext('2d');
    source.translate(rotated.width / 2, rotated.height / 2);
    source.rotate(rotation * Math.PI / 180);
    source.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const drawing = canvas.getContext('2d');
    drawing.drawImage(rotated, (crop.x - imageBox.x) / imageBox.width * rotated.width, (crop.y - imageBox.y) / imageBox.height * rotated.height, crop.width / imageBox.width * rotated.width, crop.height / imageBox.height * rotated.height, 0, 0, width, height);
    return Array.from(drawing.getImageData(0, 0, width, height).data);
  }, { rotation, width, height });
}
function pixelDifference(actual, expected, width, height, expectedChannels) {
  let difference = 0;
  let count = 0;
  for (let y = 10; y < height - 10; y += 10) for (let x = 10; x < width - 10; x += 10) for (let channel = 0; channel < 3; channel++) {
    difference += Math.abs(actual[(y * width + x) * 3 + channel] - expected[(y * width + x) * expectedChannels + channel]);
    count++;
  }
  return difference / count;
}
async function save(label, ratio, rotation = 0, wholeFixture) {
  const width = 320;
  const height = Math.round(width / ratio);
  const preview = await previewPixels(rotation, width, height);
  await cropper.screenshot({ path: path.join(output, `${label}.png`), style: 'nextjs-portal { display: none !important; }' });
  const count = uploads.length;
  await cropper.getByRole('button', { name: 'Use this crop', exact: true }).click();
  await expect.poll(() => uploads.length).toBe(count + 1);
  await expect(cropper).not.toBeVisible();
  const uploaded = uploads.at(-1);
  const metadata = await sharp(uploaded).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.ok(Math.abs(metadata.width / metadata.height - ratio) < 0.01, `Export ratio matches selected frame: ${JSON.stringify(metadata)}`);
  assert.ok(Math.max(metadata.width, metadata.height) <= 2000, 'Exports cap the longest side at 2000px.');
  const raw = await sharp(uploaded).resize(width, height).removeAlpha().raw().toBuffer();
  const averagePixelDifference = pixelDifference(raw, preview, width, height, 4);
  assert.ok(averagePixelDifference < 6, `Saved crop matches preview at rotation ${rotation}: average channel difference=${averagePixelDifference}`);
  let wholePhotoPixelDifference;
  if (wholeFixture) {
    const expected = await sharp(wholeFixture.file).rotate(rotation).resize(width, height).removeAlpha().raw().toBuffer();
    wholePhotoPixelDifference = pixelDifference(raw, expected, width, height, 3);
    assert.ok(wholePhotoPixelDifference < 5, `Keep full photo retains all source edges and correct rotation: average channel difference=${wholePhotoPixelDifference}`);
  }
  await fs.writeFile(path.join(output, `${label}-uploaded.jpg`), uploaded);
  results.push({ label, rotation, ratio, width: metadata.width, height: metadata.height, averagePixelDifference, wholePhotoPixelDifference });
}

try {
  const login = await context.request.post(`${base}/api/admin/login`, { headers: { Origin: base }, data: { username: process.env.TEST_ADMIN_USERNAME, password: process.env.TEST_ADMIN_PASSWORD } });
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
      return route.fulfill({ status: 200, json: { id: `crop-flexible-mocked-image-${uploads.length}` } });
    }
    forbiddenWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.fulfill({ status: 500, json: { error: 'This crop test must never save menu or category changes.' } });
  });
  await page.route('**/api/images/crop-flexible-mocked-image-*', async route => {
    const index = Number(new URL(route.request().url()).pathname.split('-').at(-1)) - 1;
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: uploads[index] });
  });
  await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
  const notice = page.getByRole('button', { name: /^Got it/ });
  await expect(notice).toBeVisible();
  await notice.click();
  await page.getByRole('button', { name: 'Add menu item', exact: true }).click();
  editor = page.getByRole('dialog', { name: /ADD MENU ITEM/ });
  cropper = page.getByRole('dialog', { name: 'Crop menu image', exact: true });

  for (const [value, ratio] of [['4:3', 4 / 3], ['1:1', 1], ['16:9', 16 / 9], ['3:4', 3 / 4], ['original', 16 / 9]]) {
    await open(fixtures.landscape);
    await choose(value);
    assertFit(await geometry(), ratio);
    await assertViewport();
    if (value === '4:3') {
      await shape().focus();
      for (let step = 0; step < 18; step++) {
        await page.keyboard.press('Tab');
        assert.ok(await cropper.evaluate(dialog => dialog.contains(document.activeElement)), 'Tab keeps keyboard focus in the image editor.');
      }
      for (let step = 0; step < 18; step++) {
        await page.keyboard.press('Shift+Tab');
        assert.ok(await cropper.evaluate(dialog => dialog.contains(document.activeElement)), 'Shift+Tab keeps keyboard focus in the image editor.');
      }
    }
    await save(`desktop-${value.replace(':', '-')}`, ratio, 0, value === 'original' ? fixtures.landscape : undefined);
  }

  await open(fixtures.landscape);
  await choose('3:4');
  await cropper.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await settled();
  await cropper.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => Number(await slider().inputValue())).toBeGreaterThan(1);
  await zoomBoundary('End', 5);
  await expect(cropper.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
  await zoomBoundary('Home', 1);
  await expect(cropper.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
  await cropper.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const beforeDecrease = Number(await slider().inputValue());
  await cropper.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(async () => Number(await slider().inputValue())).toBeLessThan(beforeDecrease);
  await zoomBoundary('End', 5);
  const start = await geometry();
  await page.mouse.move(start.crop.x + start.crop.width / 2, start.crop.y + start.crop.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.crop.x + start.crop.width / 2 + 55, start.crop.y + start.crop.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const dragged = await geometry();
  assertCovered(dragged);
  assert.ok(Math.abs(dragged.image.x - start.image.x) > 5 || Math.abs(dragged.image.y - start.image.y) > 5, 'Dragging moves the selected photo.');
  await cropper.getByRole('button', { name: 'Reset view', exact: true }).click();
  await settled();
  await expect(shape()).toHaveValue('3:4');
  await expect(slider()).toHaveValue('1');
  assertFit(await geometry(), 3 / 4);
  centered(await geometry());
  await save('desktop-rotated-reset', 3 / 4, 90);

  for (const [rotation, turns] of [[90, 1], [180, 2], [270, -1]]) {
    await open(fixtures.landscape);
    for (let turn = 0; turn < Math.abs(turns); turn++) await cropper.getByRole('button', { name: turns > 0 ? 'Rotate right' : 'Rotate left', exact: true }).click();
    await settled();
    await zoomBoundary('End', 5);
    await cropper.getByRole('button', { name: 'Keep full photo', exact: true }).click();
    await settled();
    await expect(shape()).toHaveValue('original');
    await expect(slider()).toHaveValue('1');
    const ratio = rotation % 180 ? 9 / 16 : 16 / 9;
    assertFit(await geometry(), ratio);
    centered(await geometry());
    await save(`desktop-full-rotated-${rotation}`, ratio, rotation, fixtures.landscape);
  }

  await open(fixtures.large);
  await cropper.getByRole('button', { name: 'Keep full photo', exact: true }).click();
  await settled();
  await save('desktop-large-full-photo', 4 / 3, 0, fixtures.large);
  assert.equal(Math.max(results.at(-1).width, results.at(-1).height), 2000, 'Large full photos are resized to the upload cap.');

  for (const [viewport, label] of [[{ width: 390, height: 844 }, 'mobile'], [{ width: 844, height: 390 }, 'short']]) {
    await page.setViewportSize(viewport);
    for (const fixture of [fixtures.square, fixtures.portrait]) {
      await open(fixture);
      await choose('3:4');
      await assertViewport();
      await cropper.getByRole('button', { name: 'Keep full photo', exact: true }).click();
      await settled();
      const ratio = fixture.width / fixture.height;
      assertFit(await geometry(), ratio);
      await assertViewport();
      if (label === 'mobile') {
        await page.locator('.crop-stage').scrollIntoViewIfNeeded();
        const frame = (await geometry()).crop;
        const centerX = frame.x + frame.width / 2;
        const centerY = frame.y + frame.height / 2;
        const touches = distance => [{ id: 1, x: centerX - distance, y: centerY }, { id: 2, x: centerX + distance, y: centerY }];
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(20) });
        for (const distance of [25, 30, 35, 40]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(distance) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => Number(await slider().inputValue())).toBeGreaterThan(1.1);
        assertCovered(await geometry());
        await cdp.detach();
        await cropper.getByRole('button', { name: 'Keep full photo', exact: true }).click();
        await settled();
      }
      await save(`${label}-${fixture.name}-full`, ratio, 0, fixture);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('button', { name: 'Adjust crop & layout', exact: true }).click();
  await expect(cropper).toBeVisible();
  await settled();
  await expect(shape()).toHaveValue('4:3');
  await expect(slider()).toHaveValue('1');
  await choose('1:1');
  await zoomBoundary('End', 5);
  await save('mobile-recrop-existing', 1);

  await open(fixtures.landscape);
  await choose('1:1');
  await cropper.getByRole('button', { name: 'Rotate right', exact: true }).click();
  await zoomBoundary('End', 5);
  await cropper.getByRole('button', { name: 'Cancel', exact: true }).click();
  await open(fixtures.portrait);
  await page.keyboard.press('Escape');
  await expect(cropper).not.toBeVisible();
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Close editor', exact: true }).click();
  assert.deepEqual(forbiddenWrites, [], 'No menu/category mutations leave the browser.');
  assert.deepEqual(errors, [], 'The browser reports no runtime errors.');
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors, uploads: uploads.length, forbiddenWrites }, null, 2));
  await fs.rm(path.join(output, 'failure.png'), { force: true });
  console.log(JSON.stringify({ cases: results.length, uploads: uploads.length, browserErrors: errors, forbiddenWrites }));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, style: 'nextjs-portal { display: none !important; }' }).catch(() => {});
  throw error;
} finally {
  await context.request.post(`${base}/api/admin/logout`, { headers: { Origin: base } }).catch(() => {});
  await browser.close();
}
