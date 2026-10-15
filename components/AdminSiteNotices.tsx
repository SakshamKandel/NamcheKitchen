'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Megaphone, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import styles from './AdminSiteNotices.module.css';

type Notice = {
  id: string; title: string; message: string; type: 'announcement' | 'closure' | 'event';
  starts_on: string | null; ends_on: string | null; event_date: string | null;
  enabled: boolean; created_at: string; updated_at: string;
};
type Draft = Omit<Notice, 'created_at' | 'updated_at'>;
type NoticeList = { notices: Notice[]; today: string };
const empty: Draft = { id: '', title: '', message: '', type: 'announcement', starts_on: '', ends_on: '', event_date: '', enabled: true };
const types = { announcement: 'General announcement', closure: 'Closure notice', event: 'Event / live music' };

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

async function request<T>(method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/admin/notices', {
    method, cache: 'no-store', signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(response.status === 401
    ? 'Your session has expired. Sign in again to manage notices.'
    : result.error || 'Could not update the notice. Please try again.');
  return result as T;
}

export default function AdminSiteNotices() {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [data, setData] = useState<NoticeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await request<NoticeList>('GET', undefined, signal);
      if (!signal?.aborted) setData(result);
    } catch (cause) {
      if (!signal?.aborted) setLoadError(cause instanceof Error ? cause.message : 'Could not load notices.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function edit(notice?: Notice) {
    setDraft(notice ? { ...notice, starts_on: notice.starts_on || '', ends_on: notice.ends_on || '', event_date: notice.event_date || '' } : { ...empty });
    setError('');
    setMessage('');
    setRemoving(null);
    requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('input')?.focus());
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending) return;
    setError('');
    setMessage('');
    if (draft.starts_on && draft.ends_on && draft.starts_on > draft.ends_on) {
      setError('The last display date must be on or after the first display date.');
      return;
    }
    setPending(true);
    try {
      await request(draft.id ? 'PATCH' : 'POST', { ...draft, title: draft.title.trim(), message: draft.message.trim() });
      setMessage(draft.enabled ? 'Notice saved. It will appear above the homepage navigation during its display dates.' : 'Notice saved as hidden. Enable it when you are ready to publish.');
      setDraft(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the notice.');
    } finally {
      setPending(false);
    }
  }

  async function remove(notice: Notice) {
    if (pending) return;
    setError('');
    setMessage('');
    setPending(true);
    try {
      await request('DELETE', { id: notice.id });
      if (draft?.id === notice.id) setDraft(null);
      setRemoving(null);
      setMessage(`“${notice.title}” was removed from the homepage notices.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the notice.');
    } finally {
      setPending(false);
    }
  }

  const busy = loading || pending;
  return <section className={styles.panel} aria-labelledby={`${id}-heading`} aria-busy={busy}>
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>HOMEPAGE NOTICES</span><h2 id={`${id}-heading`}>Keep your guests in the know.</h2>
        <p>Share closures, live music, special events, or any announcement above the homepage navigation. Guests can dismiss each notice; editing it will show the new version again.</p></div>
      <Megaphone size={28} aria-hidden="true" />
    </div>
    <p className={styles.help}>Display dates use Ottawa local time and include both the first and last day. Closure notices are announcements; block bookings separately under Reservations.</p>
    {loadError && <div className={styles.error} role="alert"><p>{loadError}</p><button type="button" className={styles.secondary} disabled={busy} onClick={() => { void load(); }}><RefreshCw size={15} aria-hidden="true" />Retry</button></div>}
    {message && <p className={styles.success} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!draft && <button type="button" className={styles.primary} disabled={busy || !data} onClick={() => edit()}><Plus size={17} aria-hidden="true" />Add homepage notice</button>}
    {draft && <form className={styles.form} ref={form} onSubmit={save} aria-label={draft.id ? 'Edit homepage notice' : 'Add homepage notice'}>
      <h3>{draft.id ? 'Edit notice' : 'New notice'}</h3>
      <fieldset disabled={pending} className={styles.fields}>
        <label className={styles.wide}>Notice title<input required minLength={1} maxLength={120} value={draft.title} onChange={event => update('title', event.target.value)} placeholder="e.g. Live music this Friday" /></label>
        <label>Notice type<select value={draft.type} onChange={event => update('type', event.target.value as Draft['type'])}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Event or closure date <span className={styles.optional}>(optional)</span><input type="date" value={draft.event_date || ''} onChange={event => update('event_date', event.target.value)} /></label>
        <label className={styles.wide}>Notice message<textarea required minLength={1} maxLength={1000} rows={3} value={draft.message} onChange={event => update('message', event.target.value)} placeholder="Add the details your guests need to know." /></label>
        <label>First display date <span className={styles.optional}>(optional)</span><input type="date" value={draft.starts_on || ''} max={draft.ends_on || undefined} onChange={event => update('starts_on', event.target.value)} /></label>
        <label>Last display date <span className={styles.optional}>(optional)</span><input type="date" value={draft.ends_on || ''} min={draft.starts_on || undefined} onChange={event => update('ends_on', event.target.value)} /></label>
        <p className={`${styles.fieldHint} ${styles.wide}`}>Leave display dates blank to show the notice until you hide or remove it. The event date is shown to guests and does not control when the notice appears.</p>
        <label className={`${styles.checkbox} ${styles.wide}`}><input type="checkbox" checked={draft.enabled} onChange={event => update('enabled', event.target.checked)} />Show this notice during its display dates</label>
        <div className={`${styles.actions} ${styles.wide}`}><button type="button" className={styles.secondary} onClick={() => { setDraft(null); setError(''); }}>Cancel</button><button className={styles.primary}>{pending ? 'Saving…' : 'Save notice'}</button></div>
      </fieldset>
    </form>}
    <div className={styles.listHeading}><h3>All homepage notices</h3>{data && <span>{data.notices.length} {data.notices.length === 1 ? 'notice' : 'notices'}</span>}</div>
    {loading && !data && <p role="status">Loading notices…</p>}
    {data?.notices.length === 0 && <p className={styles.empty}>No notices yet. Add one when you have news to share with your guests.</p>}
    {data && data.notices.length > 0 && <ul className={styles.list}>{data.notices.map(notice => {
      const status = !notice.enabled ? 'Hidden' : notice.starts_on && notice.starts_on > data.today ? 'Scheduled' : notice.ends_on && notice.ends_on < data.today ? 'Finished' : 'Showing now';
      return <li key={notice.id} className={styles.item}>
        <div className={styles.itemCopy}><span className={styles.status}>{types[notice.type]} · {status}</span><h3>{notice.title}</h3><p className={styles.message}>{notice.message}</p>
          {notice.event_date && <p className={styles.detail}>Event / closure: <time dateTime={notice.event_date}>{formatDate(notice.event_date)}</time></p>}
          <p className={styles.detail}>Display: {notice.starts_on ? formatDate(notice.starts_on) : 'Immediately'} — {notice.ends_on ? formatDate(notice.ends_on) : 'Until removed'}</p>
        </div>
        <div className={styles.itemActions}>
          {removing === notice.id ? <div className={styles.confirm}><p>Remove “{notice.title}”?</p><div><button type="button" className={styles.secondary} disabled={busy} onClick={() => setRemoving(null)}>Keep notice</button><button type="button" className={styles.danger} disabled={busy} onClick={() => { void remove(notice); }}>Remove notice</button></div></div>
            : <><button type="button" className={styles.secondary} disabled={busy} aria-label={`Edit notice: ${notice.title}`} onClick={() => edit(notice)}><Pencil size={15} aria-hidden="true" />Edit</button><button type="button" className={styles.secondary} disabled={busy} aria-label={`Remove notice: ${notice.title}`} onClick={() => setRemoving(notice.id)}><Trash2 size={15} aria-hidden="true" />Remove</button></>}
        </div>
      </li>;
    })}</ul>}
  </section>;
}
