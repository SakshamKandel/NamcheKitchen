import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
});
const { noticeSchema, noticeUpdateSchema, isNoticeVisible } = await import('../lib/notice-input.ts');
hook.deregister();
const input = { title: 'Live music', message: 'Join us on Friday evening.', type: 'event', starts_on: '2026-10-15', ends_on: '2026-10-16', event_date: '2026-10-16', enabled: true };

test('notices validate calendar dates, display order, plain text, and reasonable lengths', () => {
  assert.deepEqual(noticeSchema.parse({ ...input, title: ' Live music ', message: ' Come along! ' }), { ...input, title: 'Live music', message: 'Come along!' });
  for (const patch of [
    { title: '' }, { title: 'x'.repeat(121) }, { title: 'Two\nlines' },
    { message: ' ' }, { message: 'x'.repeat(1001) }, { message: 'Null\u0000byte' },
    { type: 'unsupported' }, { enabled: 'true' }, { starts_on: '2026-02-30' },
    { ends_on: '2026-10-14' }, { event_date: '2026-13-01' },
  ]) assert.equal(noticeSchema.safeParse({ ...input, ...patch }).success, false, JSON.stringify(patch));
  const unbounded = noticeSchema.parse({ ...input, starts_on: '', ends_on: undefined, event_date: null });
  assert.equal(unbounded.starts_on, null);
  assert.equal(unbounded.ends_on, null);
  assert.equal(unbounded.event_date, null);
  assert.equal(noticeSchema.parse({ ...input, message: 'One line\nAnother line' }).message, 'One line\nAnother line');
  assert.equal(noticeUpdateSchema.safeParse({ ...input, id: 'invalid' }).success, false);
  assert.equal(noticeUpdateSchema.safeParse({ ...input, id: '12345678-1234-4234-8234-123456789abc' }).success, true);
});

test('notice schedules are inclusive and switch at Ottawa midnight across DST seasons', () => {
  const singleDay = { enabled: true, starts_on: '2026-10-15', ends_on: '2026-10-15' };
  assert.equal(isNoticeVisible(singleDay, new Date('2026-10-15T03:59:59Z')), false);
  assert.equal(isNoticeVisible(singleDay, new Date('2026-10-15T04:00:00Z')), true);
  assert.equal(isNoticeVisible(singleDay, new Date('2026-10-16T03:59:59Z')), true);
  assert.equal(isNoticeVisible(singleDay, new Date('2026-10-16T04:00:00Z')), false);
  const winter = { enabled: true, starts_on: '2026-12-01', ends_on: '2026-12-01' };
  assert.equal(isNoticeVisible(winter, new Date('2026-12-01T04:59:59Z')), false);
  assert.equal(isNoticeVisible(winter, new Date('2026-12-01T05:00:00Z')), true);
  assert.equal(isNoticeVisible({ ...singleDay, enabled: false }, new Date('2026-10-15T18:00:00Z')), false);
  assert.equal(isNoticeVisible({ enabled: true, starts_on: null, ends_on: null }), true);
});
