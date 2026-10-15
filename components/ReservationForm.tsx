'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import styles from './ReservationForm.module.css';

type Availability = {
  closedDates: string[];
  today: string;
  maxDate: string;
};

const closedDateMessage = 'Reservations are closed on this date. Please choose another day.';
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export default function ReservationForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rejectedDate, setRejectedDate] = useState('');
  const availabilityRequest = useRef<AbortController | null>(null);

  const refreshAvailability = useCallback(async (force = false) => {
    if (availabilityRequest.current) {
      if (!force) return;
      availabilityRequest.current.abort();
    }
    const controller = new AbortController();
    availabilityRequest.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10000);
    setAvailabilityStatus('loading');
    try {
      const response = await fetch('/api/reservations/availability', {
        cache: 'no-store',
        signal: controller.signal,
      });
      const result = await response.json();
      if (
        !response.ok ||
        !Array.isArray(result.closedDates) ||
        !result.closedDates.every((date: unknown) => typeof date === 'string' && datePattern.test(date)) ||
        typeof result.today !== 'string' || !datePattern.test(result.today) ||
        typeof result.maxDate !== 'string' || !datePattern.test(result.maxDate) ||
        result.maxDate < result.today
      ) {
        throw new Error('Availability is unavailable.');
      }
      if (controller.signal.aborted) return;
      setAvailability({
        closedDates: [...new Set<string>(result.closedDates)]
          .filter(date => date >= result.today && date <= result.maxDate)
          .sort(),
        today: result.today,
        maxDate: result.maxDate,
      });
      setRejectedDate('');
      setAvailabilityStatus('ready');
    } catch {
      if (availabilityRequest.current === controller && (!controller.signal.aborted || timedOut)) {
        setAvailabilityStatus('error');
      }
    } finally {
      clearTimeout(timeout);
      if (availabilityRequest.current === controller) availabilityRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void refreshAvailability();
    const refresh = () => { void refreshAvailability(); };
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      availabilityRequest.current?.abort();
      availabilityRequest.current = null;
    };
  }, [refreshAvailability]);

  const dateClosed = Boolean(selectedDate && (
    availability?.closedDates.includes(selectedDate) || rejectedDate === selectedDate
  ));
  const dateOutsideRange = Boolean(selectedDate && availability && (
    selectedDate < availability.today || selectedDate > availability.maxDate
  ));
  const dateError = dateClosed
    ? closedDateMessage
    : dateOutsideRange && availability
      ? `Please choose a date from ${formatDate(availability.today)} through ${formatDate(availability.maxDate)}.`
      : '';
  const closedDates = availability?.closedDates ?? [];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || availabilityStatus !== 'ready' || !availability || dateError) return;
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, guests: Number(data.guests) }),
      });
      const result = await response.json();
      if (response.status === 409 && result.code === 'RESERVATION_DATE_CLOSED') {
        setRejectedDate(String(data.date));
        void refreshAvailability(true);
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      if (typeof result.id !== 'string') throw new Error('Please try again.');
      setSuccess(result.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (success) return (
    <div className="reservation-success" role="status">
      <div className="success-icon"><Check size={32} /></div>
      <span className="eyebrow">WE LOOK FORWARD TO WELCOMING YOU</span>
      <h2>REQUEST RECEIVED.</h2>
      <p>Our team will contact you by phone or email to confirm your table. Your reservation is pending until you hear from us.</p>
      <p className="reference">Reference: {success.slice(0, 8).toUpperCase()}</p>
      <a href="/menu" className="button dark">Explore the menu <ArrowUpRight size={18} /></a>
    </div>
  );

  return (
    <form onSubmit={submit} className="reservation-form">
      <div className="form-heading">
        <span className="eyebrow">A PLACE AT OUR TABLE</span>
        <h2>LET’S MAKE PLANS.</h2>
      </div>
      <div className={styles.availability} id="reservation-availability" aria-live="polite">
        {availabilityStatus === 'loading' && <p role="status">Checking reservation availability…</p>}
        {availabilityStatus === 'error' && (
          <div role="alert">
            <p>We couldn’t check availability. Please retry before sending your request. Your details will stay here.</p>
            <button type="button" className={styles.retry} onClick={() => void refreshAvailability()}>Retry availability</button>
          </div>
        )}
        {closedDates.length > 0 && (
          <div>
            <p><strong>Reservations are closed on:</strong>{' '}
              {closedDates.slice(0, 3).map((date, index) => (
                <span key={date}>{index > 0 && '; '}<time dateTime={date}>{formatDate(date)}</time></span>
              ))}
              {closedDates.length > 3 && `; and ${closedDates.length - 3} more dates`}.
            </p>
            {closedDates.length > 3 && (
              <details className={styles.dates}>
                <summary>View all {closedDates.length} closed dates</summary>
                <ul>{closedDates.map(date => <li key={date}><time dateTime={date}>{formatDate(date)}</time></li>)}</ul>
              </details>
            )}
          </div>
        )}
        {availabilityStatus === 'ready' && closedDates.length === 0 && availability && (
          <p>Choose your preferred date through {formatDate(availability.maxDate)}.</p>
        )}
      </div>
      <div className="form-grid">
        <label>Your name<input name="name" required minLength={2} maxLength={100} autoComplete="name" placeholder="Full name" /></label>
        <label>Email address<input name="email" type="email" required maxLength={200} autoComplete="email" placeholder="you@example.com" /></label>
        <label>Phone number<input name="phone" type="tel" required minLength={7} maxLength={25} autoComplete="tel" placeholder="(613) 000-0000" /></label>
        <label>Guests<select name="guests" defaultValue="2">{Array.from({ length: 20 }, (_, index) => <option value={index + 1} key={index}>{index + 1} {index ? 'guests' : 'guest'}</option>)}</select></label>
        <label>Preferred date
          <input
            name="date"
            type="date"
            min={availability?.today}
            max={availability?.maxDate}
            value={selectedDate}
            onChange={event => { setSelectedDate(event.target.value); setError(''); }}
            onFocus={() => void refreshAvailability()}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? 'reservation-availability reservation-date-error' : 'reservation-availability'}
            required
          />
          {dateError && <span className={styles.dateError} id="reservation-date-error" role="alert">{dateError}</span>}
        </label>
        <label>Preferred time (Ottawa)<input name="time" type="time" required /></label>
        <label className="span-2">Anything we should know? <span className="optional">Optional</span><textarea name="notes" rows={3} maxLength={1000} placeholder="A special occasion, accessibility needs, or dietary requirements…" /></label>
      </div>
      <label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <p className="form-note">This is a reservation request. We’ll contact you to confirm availability. Your contact details are used to manage your booking. <a href="/privacy">Privacy policy</a></p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button dark" disabled={busy || availabilityStatus !== 'ready' || Boolean(dateError)}>
        {busy ? 'Sending request…' : availabilityStatus === 'loading' ? 'Checking availability…' : 'Request your table'}
        <ArrowUpRight size={18} />
      </button>
    </form>
  );
}
