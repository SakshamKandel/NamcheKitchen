'use client';

import { useRef, useState } from 'react';
import styles from './MenuItemRemoval.module.css';

export default function MenuItemRemoval({ name, disabled, onRemove }: {
  name: string;
  disabled: boolean;
  onRemove: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return <div className={styles.removal}>
    {confirming ? <div role="group" aria-label="Confirm item removal">
      <p>Remove <strong>{name}</strong> permanently? This item will be deleted from the menu. This cannot be undone.</p>
      <div className={styles.actions}>
        <button className={`button small ${styles.danger}`} type="button" disabled={disabled} onClick={() => void onRemove()}>{disabled ? 'Removing…' : 'Remove permanently'}</button>
        <button className="button small" type="button" autoFocus disabled={disabled} onClick={() => {
          setConfirming(false);
          requestAnimationFrame(() => trigger.current?.focus());
        }}>Keep item</button>
      </div>
    </div> : <button ref={trigger} className={`button small ${styles.danger}`} type="button" disabled={disabled} onClick={() => setConfirming(true)}>Remove item</button>}
  </div>;
}
