import { z } from 'zod';
import { isCalendarDate, reservationDateRange } from './reservation-dates';

export const noticeTypes = ['announcement', 'closure', 'event'] as const;
const calendarDate = z.string().refine(isCalendarDate, { message: 'Choose a valid calendar date.' });
const optionalDate = z.preprocess(value => value === '' || value === undefined ? null : value, calendarDate.nullable());
const fields = {
  title: z.string().trim().min(1, 'Add a notice title.').max(120, 'Titles must be 120 characters or fewer.').regex(/^[^\u0000-\u001f\u007f]+$/, 'Use a single line for the title.'),
  message: z.string().trim().min(1, 'Add the notice message.').max(1000, 'Messages must be 1,000 characters or fewer.').regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/, 'Use plain text for the message.'),
  type: z.enum(noticeTypes),
  starts_on: optionalDate,
  ends_on: optionalDate,
  event_date: optionalDate,
  enabled: z.boolean(),
};
const validWindow = (value: { starts_on: string | null; ends_on: string | null }) => !value.starts_on || !value.ends_on || value.ends_on >= value.starts_on;
const windowError = { message: 'The last display date must be on or after the first display date.', path: ['ends_on'] };
export const noticeSchema = z.object(fields).refine(validWindow, windowError);
export const noticeUpdateSchema = z.object({ id: z.uuid(), ...fields }).refine(validWindow, windowError);
export const noticeDeleteSchema = z.object({ id: z.uuid() });
export type NoticeInput = z.infer<typeof noticeSchema>;
export type SiteNotice = NoticeInput & { id: string; created_at: string; updated_at: string };

/** Date-only schedules follow the restaurant's calendar, including DST. */
export function isNoticeVisible(notice: Pick<SiteNotice, 'enabled' | 'starts_on' | 'ends_on'>, now = new Date()) {
  const { today } = reservationDateRange(now);
  return notice.enabled && (!notice.starts_on || notice.starts_on <= today) && (!notice.ends_on || notice.ends_on >= today);
}
