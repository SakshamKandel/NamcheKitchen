'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './ReservationStatusControl.module.css';

type Props = {
  reservation: { id: string; status: string; cancellation_note?: string };
  disabled: boolean;
  onUpdate: (id: string, status: string, cancellationNote?: string) => Promise<boolean>;
};

export default function ReservationStatusControl({ reservation, disabled, onUpdate }: Props) {
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState('');
  const noteInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (cancelling) noteInput.current?.focus();
  }, [cancelling]);

  return <div className={styles.control}>
    <label className="field">Booking status
      <select value={cancelling ? 'cancelled' : reservation.status} disabled={disabled} onChange={event => {
        if (event.target.value === 'cancelled') {
          setNote(reservation.cancellation_note || '');
          setCancelling(true);
        } else {
          setCancelling(false);
          void onUpdate(reservation.id, event.target.value);
        }
      }}>
        {['pending', 'confirmed', 'cancelled', 'completed'].map(status => <option key={status}>{status}</option>)}
      </select>
    </label>
    {cancelling && <form className={styles.form} onSubmit={async event => {
      event.preventDefault();
      if (disabled || !note.trim()) return;
      if (await onUpdate(reservation.id, 'cancelled', note.trim())) {
        setCancelling(false);
        setNote('');
      }
    }}>
      <label className="field">Cancellation note
        <textarea ref={noteInput} value={note} onChange={event => setNote(event.target.value)} required maxLength={1000} rows={4} disabled={disabled} aria-describedby={`cancellation-help-${reservation.id}`} />
      </label>
      <p id={`cancellation-help-${reservation.id}`} className={styles.help}>Explain why this table is being cancelled. This note is saved for staff and included in the guest’s cancellation email when email delivery is configured.</p>
      <div className={styles.actions}>
        <button className="button dark small" type="submit" disabled={disabled || !note.trim()}>{disabled ? 'Saving…' : 'Cancel reservation'}</button>
        <button className="button small" type="button" disabled={disabled} onClick={() => { setCancelling(false); setNote(''); }}>Keep booking</button>
      </div>
    </form>}
    {reservation.status === 'cancelled' && reservation.cancellation_note && <div className={styles.savedNote}>
      <strong>Cancellation note</strong>
      <p>{reservation.cancellation_note}</p>
    </div>}
  </div>;
}
