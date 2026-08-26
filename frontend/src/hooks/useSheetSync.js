/*  frontend/src/hooks/useSheetSync.js
    ----------------------------------------------------------------------------
    Makes "someone edited the Google Sheet directly" show up in the app on its
    own — new projects appear, deleted ones disappear.

    HOW IT WORKS NOW
    The backend keeps a version number that moves whenever anything actually
    changes, from either of two sources:

      • the Apps Script webhook (instant, but only once the backend is on a
        public url — Apps Script cannot reach localhost)
      • the backend's own poller, which re-reads a cheap fingerprint per tab

    This hook polls that number — a tiny call that touches no sheet data — and
    reloads ONLY when it moves. The previous version refetched everything on a
    timer regardless, which meant a full Projects read every 30 seconds whether
    or not a single cell had changed.

    USAGE (unchanged, existing call sites keep working):

      import { useSheetSync } from '../hooks/useSheetSync';
      useSheetSync(() => load(true), 30000);
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../lib/api';

/**
 * @param {Function} reload   your existing data-loading function
 * @param {number}   everyMs  how often to CHECK for changes (default 15s).
 *                            Cheap now — it only reloads when something moved.
 */
export function useSheetSync(reload, everyMs = 15000) {
  const fn = useRef(reload);
  fn.current = reload;

  const seen = useRef(null);
  const [syncing, setSyncing]       = useState(false);
  const [lastChange, setLastChange] = useState(null);

  const check = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;   // don't poll a hidden tab
    try {
      const res = await api.get('/api/sync/version');
      const d = res?.data ?? res;
      if (!d || typeof d.version !== 'number') return;

      setLastChange(d.last_change);

      /* First check just records where we are — not a change. */
      if (seen.current === null) { seen.current = d.version; return; }

      if (d.version !== seen.current) {
        seen.current = d.version;
        setSyncing(true);
        try { await fn.current?.(); } finally { setSyncing(false); }
      }
    } catch {
      /* Backend restarting or offline — stay quiet, try again next tick. */
    }
  }, []);

  useEffect(() => {
    check();
    const timer = everyMs > 0 ? setInterval(check, everyMs) : null;

    /* Catch up the moment the tab comes back to the front. */
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [everyMs, check]);

  /** Force the backend to re-read the sheet right now, then reload. */
  const refreshNow = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await api.post('/api/sync/refresh', {});
      const d = res?.data ?? res;
      if (typeof d?.version === 'number') seen.current = d.version;
      await fn.current?.();
    } finally {
      setSyncing(false);
    }
  }, []);

  return { syncing, lastChange, refreshNow };
}

export default useSheetSync;