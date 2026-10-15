'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarOff, CalendarCheck, RefreshCw } from 'lucide-react';
import styles from './ReservationAvailability.module.css';

type Closure = { date: string; reason: string; active_reservations: number };
type Availability = { closures: Closure[]; today: string; maxDate: string };

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

async function request<T>(method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/admin/reservation-closures', {
    method,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(response.status === 401
      ? 'Your session has expired. Sign in again to manage closed dates.'
      : result.error || 'Could not update reservation availability. Please try again.');
  }
  return result as T;
}

export default function ReservationAvailability() {
  const id = useId();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await request<Availability>('GET', undefined, signal);
      if (!signal?.aborted) setAvailability(data);
    } catch (cause) {
      if (!signal?.aborted) {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load closed dates. Please try again.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const busy = loading || pending !== null;
  const alreadyClosed = availability?.closures.some(closure => closure.date === date);

  async function closeDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !availability || alreadyClosed) return;
    setError('');
    setMessage('');
    if (!date || date < availability.today || date > availability.maxDate) {
      setError('Choose a date within the available reservation window.');
      return;
    }
    setPending('close');
    try {
      const result = await request<{ ok: true; activeReservations: number }>('POST', { date, reason: reason.trim() });
      const guestNote = result.activeReservations > 0
        ? ` ${result.activeReservations} existing ${result.activeReservations === 1 ? 'reservation needs' : 'reservations need'} your attention. Contact the affected guests directly.`
        : '';
      setMessage(`${formatDate(date)} is closed to new reservations.${guestNote}`);
      setDate('');
      setReason('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not close this date. Please try again.');
    } finally {
      setPending(null);
    }
  }

  async function reopenDate(closedDate: string) {
    if (busy) return;
    setPending(closedDate);
    setError('');
    setMessage('');
    try {
      await request<{ ok: true }>('DELETE', { date: closedDate });
      setMessage(`${formatDate(closedDate)} is open to new reservations again.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reopen this date. Please try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>RESERVATION AVAILABILITY</span>
          <h2 id={`${id}-heading`}>Close a day for reservations.</h2>
          <p>Block new bookings for holidays, private events, or days you are unavailable. Dates use Ottawa local time.</p>
        </div>
        <CalendarOff size={30} aria-hidden="true" className={styles.headingIcon} />
      </div>

      <p className={styles.notice}>Existing reservations are not cancelled. Contact affected guests directly; closing or reopening a date does not send an email.</p>

      {loadError && <div className={styles.loadError}>
        <p className={styles.errorText} role="alert">{loadError}</p>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { void load(); }}>
          <RefreshCw size={15} aria-hidden="true" />Retry
        </button>
      </div>}
      {message && <p className={styles.success} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      <form onSubmit={closeDate} className={styles.form}>
        <fieldset disabled={busy || !availability} className={styles.fields}>
          <label className={styles.field} htmlFor={`${id}-date`}>
            Date to close
            <input id={`${id}-date`} type="date" value={date} min={availability?.today} max={availability?.maxDate}
              required aria-describedby={`${id}-date-note`} onChange={event => setDate(event.target.value)} />
          </label>
          <label className={styles.field} htmlFor={`${id}-reason`}>
            <span>Internal note <span className={styles.optional}>(optional)</span></span>
            <input id={`${id}-reason`} type="text" value={reason} maxLength={300} placeholder="e.g. Private event"
              aria-describedby={`${id}-reason-note`} onChange={event => setReason(event.target.value)} />
          </label>
          <button type="submit" className={styles.primaryButton} disabled={busy || !availability || alreadyClosed}>
            <CalendarOff size={17} aria-hidden="true" />{pending === 'close' ? 'Closing…' : 'Close this date'}
          </button>
        </fieldset>
        <div className={styles.hints}>
          <p id={`${id}-date-note`}>{alreadyClosed ? 'This date is already closed. You can reopen it below.' : 'This closes the full day to new reservation requests.'}</p>
          <p id={`${id}-reason-note`}>Internal notes are visible to staff only.</p>
        </div>
      </form>

      <div className={styles.listHeading}>
        <h3>Upcoming closed dates</h3>
        {availability && <span>{availability.closures.length} {availability.closures.length === 1 ? 'date' : 'dates'}</span>}
      </div>
      {loading && !availability && <p className={styles.loading} role="status">Loading reservation availability…</p>}
      {availability?.closures.length === 0 && <div className={styles.empty}>
        <CalendarCheck size={23} aria-hidden="true" />
        <div><strong>No upcoming dates are closed.</strong><p>Guests can request reservations on any date within the booking window. Add a date above when you need to pause bookings.</p></div>
      </div>}
      {availability && availability.closures.length > 0 && <ul className={styles.list}>
        {[...availability.closures].sort((a, b) => a.date.localeCompare(b.date)).map(closure => <li key={closure.date} className={styles.closedDate}>
          <div className={styles.dateCopy}>
            <time dateTime={closure.date}>{formatDate(closure.date)}</time>
            {closure.reason && <p className={styles.reason}>{closure.reason}</p>}
            <p className={closure.active_reservations > 0 ? styles.affected : styles.noBookings}>
              {closure.active_reservations > 0
                ? `${closure.active_reservations} existing active ${closure.active_reservations === 1 ? 'reservation' : 'reservations'} — contact the affected guests.`
                : 'No existing active reservations.'}
            </p>
          </div>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { void reopenDate(closure.date); }}
            aria-label={`Reopen ${formatDate(closure.date)} for reservations`}>
            {pending === closure.date ? 'Reopening…' : 'Reopen date'}
          </button>
        </li>)}
      </ul>}
    </section>
  );
}
