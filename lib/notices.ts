import { randomUUID } from 'node:crypto';
import { sql } from './db';
import { reservationDateRange } from './reservation-dates';
import type { NoticeInput, SiteNotice } from './notice-input';

type NoticeRow = NoticeInput & { id: string; created_at: Date | string; updated_at: Date | string };
const serialize = (row: NoticeRow): SiteNotice => ({
  ...row,
  created_at: new Date(row.created_at).toISOString(),
  updated_at: new Date(row.updated_at).toISOString(),
});

export async function getNotices(onlyVisible = false) {
  const { today } = reservationDateRange();
  const rows = await sql<NoticeRow[]>`select id,title,message,type,enabled,
    to_char(starts_on,'YYYY-MM-DD') as starts_on,to_char(ends_on,'YYYY-MM-DD') as ends_on,
    to_char(event_date,'YYYY-MM-DD') as event_date,created_at,updated_at
    from namche.site_notices where (${onlyVisible}=false or (enabled=true
      and (starts_on is null or starts_on<=${today}::date) and (ends_on is null or ends_on>=${today}::date)))
    order by updated_at desc,id`;
  return { notices: rows.map(serialize), today };
}

export async function saveNotice(input: NoticeInput, adminId: string, id?: string) {
  const noticeId = id || randomUUID();
  const rows = id
    ? await sql<NoticeRow[]>`update namche.site_notices set title=${input.title},message=${input.message},type=${input.type},
      starts_on=${input.starts_on}::date,ends_on=${input.ends_on}::date,event_date=${input.event_date}::date,
      enabled=${input.enabled},updated_at=now() where id=${noticeId}
      returning id,title,message,type,enabled,to_char(starts_on,'YYYY-MM-DD') as starts_on,
      to_char(ends_on,'YYYY-MM-DD') as ends_on,to_char(event_date,'YYYY-MM-DD') as event_date,created_at,updated_at`
    : await sql<NoticeRow[]>`insert into namche.site_notices(id,title,message,type,starts_on,ends_on,event_date,enabled,created_by)
      values(${noticeId},${input.title},${input.message},${input.type},${input.starts_on}::date,${input.ends_on}::date,${input.event_date}::date,${input.enabled},${adminId})
      returning id,title,message,type,enabled,to_char(starts_on,'YYYY-MM-DD') as starts_on,
      to_char(ends_on,'YYYY-MM-DD') as ends_on,to_char(event_date,'YYYY-MM-DD') as event_date,created_at,updated_at`;
  return rows[0] ? serialize(rows[0]) : null;
}

export async function removeNotice(id: string) {
  const rows = await sql`delete from namche.site_notices where id=${id} returning id`;
  return rows.length > 0;
}
