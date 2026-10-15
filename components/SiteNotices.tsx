'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Info, Music2, X } from 'lucide-react';
import styles from './SiteNotices.module.css';

type Notice = {
  id: string; title: string; message: string;
  type: 'announcement' | 'closure' | 'event';
  event_date: string | null; updated_at: string;
};

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function validNotice(value: unknown): value is Notice {
  if (!value || typeof value !== 'object') return false;
  const notice = value as Record<string, unknown>;
  return typeof notice.id === 'string' && typeof notice.title === 'string' &&
    typeof notice.message === 'string' && typeof notice.updated_at === 'string' &&
    ['announcement', 'closure', 'event'].includes(String(notice.type)) &&
    (notice.event_date === null || (typeof notice.event_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(notice.event_date) && Number.isFinite(Date.parse(`${notice.event_date}T12:00:00Z`))));
}

export default function SiteNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const dismissed = useRef(new Map<string, string>());

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let lastChecked = 0;

    async function load() {
      if (controller || document.visibilityState === 'hidden' || Date.now() - lastChecked < 60000) return;
      lastChecked = Date.now();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch('/api/notices', { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.notices) || !data.notices.every(validNotice)) return;
        if (active) {
          setNotices(data.notices.filter((notice: Notice) => {
            let saved = dismissed.current.get(notice.id);
            try { saved = localStorage.getItem(`namche.notice.dismissed.${notice.id}`) || saved; } catch {}
            return saved !== notice.updated_at;
          }));
        }
      } catch {
        // Keep any notice already displayed if a refresh cannot reach the server.
      } finally {
        clearTimeout(timeout);
        controller = null;
      }
    }

    void load();
    const interval = setInterval(() => { void load(); }, 60000);
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(interval);
      controller?.abort();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  function dismiss(notice: Notice) {
    dismissed.current.set(notice.id, notice.updated_at);
    try { localStorage.setItem(`namche.notice.dismissed.${notice.id}`, notice.updated_at); } catch {}
    setNotices(current => current.filter(item => item.id !== notice.id));
  }

  if (!notices.length) return null;
  return <aside className={styles.notices} aria-label="Restaurant notices">
    {notices.map(notice => {
      const Icon = notice.type === 'closure' ? CalendarDays : notice.type === 'event' ? Music2 : Info;
      return <div key={notice.id} className={`${styles.notice} ${styles[notice.type]}`}>
        <div className={styles.inner}>
          <Icon size={19} aria-hidden="true" className={styles.icon} />
          <div className={styles.copy}>
            <p><strong>{notice.title}</strong>{notice.event_date && <time dateTime={notice.event_date}>{dateLabel(notice.event_date)}</time>}</p>
            <p>{notice.message}</p>
          </div>
          <button type="button" className={styles.dismiss} aria-label={`Dismiss notice: ${notice.title}`} onClick={() => dismiss(notice)}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
      </div>;
    })}
  </aside>;
}
