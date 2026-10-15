'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from './MenuCategories.module.css';

export type MenuCategory = {
  kind: 'food' | 'drink';
  name: string;
  item_count: number;
};

type Props = { onChange?: () => void; refreshKey?: number };
type Action = { name: string; mode: 'rename' | 'remove' };

async function categoryRequest(method: string, data?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/admin/menu-categories', {
    method,
    cache: 'no-store',
    signal,
    ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Please sign in again to manage categories.' : result.error || 'Unable to update categories. Please try again.');
  }
  return result;
}

export default function MenuCategories({ onChange, refreshKey = 0 }: Props) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [kind, setKind] = useState<MenuCategory['kind']>('food');
  const [name, setName] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [newName, setNewName] = useState('');
  const [replacement, setReplacement] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestNumber = useRef(0);
  const id = useId();

  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++requestNumber.current;
    setLoading(true);
    setLoadError('');
    try {
      const result = await categoryRequest('GET', undefined, signal);
      if (request === requestNumber.current && !signal?.aborted) setCategories(result.categories);
    } catch (cause) {
      if (request === requestNumber.current && !signal?.aborted) {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load categories.');
      }
    } finally {
      if (request === requestNumber.current && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  async function mutate(method: string, data: unknown, success: string) {
    if (busy || loading || loadError) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await categoryRequest(method, data);
      setAction(null);
      setName('');
      setMessage(success);
      await load();
      onChange?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this category.');
    } finally {
      setBusy(false);
    }
  }

  const visibleCategories = categories.filter(category => category.kind === kind);
  const disabled = busy || loading || Boolean(loadError);
  const menuLabel = kind === 'food' ? 'food' : 'drinks';

  return <section className={styles.panel} aria-labelledby={`${id}-heading`} aria-busy={busy || loading}>
    <div className={styles.heading}>
      <div>
        <h2 id={`${id}-heading`}>Menu categories</h2>
        <p>Add, rename, or remove categories for your food and drinks menus.</p>
      </div>
      <div className={styles.switcher} role="group" aria-label="Category menu">
        {(['food', 'drink'] as const).map(value => <button key={value} type="button" disabled={busy} aria-pressed={kind === value} onClick={() => {
          setKind(value);
          setAction(null);
          setError('');
          setMessage('');
        }}>{value === 'food' ? 'Food' : 'Drinks'}</button>)}
      </div>
    </div>

    <form className={styles.addForm} onSubmit={event => {
      event.preventDefault();
      if (name.trim().length >= 2) void mutate('POST', { kind, name: name.trim() }, `“${name.trim()}” added to ${menuLabel} categories.`);
    }}>
      <label className={styles.field}>New {menuLabel} category
        <input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={80} disabled={disabled} placeholder="Category name" />
      </label>
      <button className="button dark small" disabled={disabled || name.trim().length < 2} type="submit">Add category</button>
    </form>

    <div role="status" aria-live="polite" className={styles.status}>
      {busy ? 'Saving category changes…' : loading ? 'Loading categories…' : message}
    </div>
    {loadError && <div className={styles.error} role="alert"><p>{loadError}</p><button className="button small" type="button" onClick={() => { void load(); }}>Retry loading categories</button></div>}
    {error && <p className={styles.error} role="alert">{error}</p>}

    {!loading && !loadError && visibleCategories.length === 0 && <p className={styles.empty}>No {menuLabel} categories yet. Add your first category above.</p>}
    <ul className={styles.list} aria-label={`${kind === 'food' ? 'Food' : 'Drinks'} categories`}>
      {visibleCategories.map((category, index) => {
        const active = action?.name === category.name;
        const alternatives = visibleCategories.filter(candidate => candidate.name !== category.name);
        const countLabel = `${category.item_count} ${category.item_count === 1 ? 'item' : 'items'}`;
        const helpId = `${id}-remove-help-${index}`;

        return <li className={styles.category} key={category.name}>
          <div role="group" aria-label={`${category.name} category`}>
            <div className={styles.row}>
              <div className={styles.categoryName}><strong>{category.name}</strong><span>{countLabel}</span></div>
              <div className={styles.actions}>
                <button className={styles.actionButton} type="button" disabled={disabled} aria-label={`Rename ${category.name} category`} onClick={() => {
                  setAction({ name: category.name, mode: 'rename' });
                  setNewName(category.name);
                  setError('');
                  setMessage('');
                }}>Rename</button>
                <button className={`${styles.actionButton} ${styles.removeButton}`} type="button" disabled={disabled} aria-label={`Remove ${category.name} category`} onClick={() => {
                  setAction({ name: category.name, mode: 'remove' });
                  setReplacement('');
                  setError('');
                  setMessage('');
                }}>Remove</button>
              </div>
            </div>

            {active && action.mode === 'rename' && <form className={styles.inlineForm} onSubmit={event => {
              event.preventDefault();
              if (newName.trim().length >= 2 && newName.trim() !== category.name) {
                void mutate('PATCH', { kind, name: category.name, newName: newName.trim() }, `Category renamed to “${newName.trim()}”. ${countLabel} updated.`);
              }
            }}>
              <label className={styles.field}>Rename category
                <input autoFocus value={newName} onChange={event => setNewName(event.target.value)} required minLength={2} maxLength={80} disabled={disabled} />
              </label>
              <p className={styles.help}>This updates the category name on {countLabel}.</p>
              <div className={styles.actions}>
                <button className="button dark small" type="submit" disabled={disabled || newName.trim().length < 2 || newName.trim() === category.name}>Save category</button>
                <button className="button small" type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</button>
              </div>
            </form>}

            {active && action.mode === 'remove' && <form className={styles.inlineForm} onSubmit={event => {
              event.preventDefault();
              if (category.item_count > 0 && !replacement) return;
              void mutate('DELETE', { kind, name: category.name, ...(category.item_count > 0 ? { replacement } : {}) }, category.item_count > 0 ? `“${category.name}” removed. ${countLabel} moved to “${replacement}”.` : `“${category.name}” removed.`);
            }}>
              <p id={helpId} className={styles.help}>{category.item_count > 0 ? `“${category.name}” contains ${countLabel}. Choose where to move them before removing this category. All menu items will be kept.` : `Remove the empty category “${category.name}”?`}</p>
              {category.item_count > 0 && (alternatives.length ? <label className={styles.field}>Move items to
                <select aria-label="Move items to" required value={replacement} disabled={disabled} onChange={event => setReplacement(event.target.value)} aria-describedby={helpId}>
                  <option value="">Choose a category</option>
                  {alternatives.map(candidate => <option key={candidate.name} value={candidate.name}>{candidate.name}</option>)}
                </select>
              </label> : <p className={styles.help}>Add another {menuLabel} category first so these items have somewhere to go.</p>)}
              <div className={styles.actions}>
                <button className={`button small ${styles.confirmRemove}`} type="submit" disabled={disabled || (category.item_count > 0 && !replacement)}>{category.item_count > 0 ? 'Move items & remove category' : 'Remove empty category'}</button>
                <button className="button small" type="button" disabled={busy} onClick={() => setAction(null)}>Keep category</button>
              </div>
            </form>}
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
