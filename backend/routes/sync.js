/*  backend/routes/sync.js
    ----------------------------------------------------------------------------
    Two extras that only make sense now that the Sheet is the database:

      GET  /api/lookups            → every dropdown list, read live from the
                                     LookUp + Dropdowns tabs
      POST /api/sync/invalidate    → webhook the Apps Script "On change" trigger
                                     calls so app users see sheet edits instantly
      GET  /api/sync/status        → row counts per tab, for a health widget
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();
const db      = require('../db/sheets');

/* ── change tracking ─────────────────────────────────────────────────────
   The frontend polls GET /api/sync/version and refetches when the number
   moves. Two things can move it:

     • the Apps Script webhook below — instant, but Apps Script can only reach
       a PUBLIC url, so it does nothing while the backend is on localhost
     • the poller — re-reads a cheap fingerprint per tab on an interval, so
       sheet edits are picked up even on localhost

   Set SYNC_POLL_MS=0 in .env to switch the poller off once the webhook is
   reachable.                                                              */

const WATCHED = ['projects', 'clients', 'amc_contracts', 'amc_payments'];

/*  ── WHY THIS USED TO BE 20 SECONDS, AND WHY IT IS NOT ANY MORE ───────────

    The poller re-read all five tabs with { fresh: true } every twenty seconds
    — a full download of roughly 5,900 rows across Projects, Clients,
    AMC_Contracts, AMC_Tasks_Schedule and AMC_Payment_Schedule — in order to
    compute a row count and the newest Last_Updated_Date.

    Apps Script serialises executions per user, and one of those tabs alone
    takes 45 seconds. A single sweep therefore could not finish inside its own
    twenty-second interval; the `polling` guard stopped ticks overlapping, so
    instead of overlapping it simply ran CONTINUOUSLY. The Apps Script queue
    was never empty, and every real user action — opening a project, saving,
    uploading a PO — waited behind a fingerprint check nobody asked for.

    Two changes. The interval is five minutes rather than twenty seconds, and
    each tick reads ONE tab instead of five, round-robin. A sweep costs one
    read, and all five tabs are still covered inside half an hour.

    Set SYNC_POLL_MS in .env to override; 0 switches it off entirely, which is
    the right setting once the Apps Script webhook can reach the backend.   */
const POLL_MS = Number(process.env.SYNC_POLL_MS ?? 5 * 60 * 1000);

/** Round-robin cursor — which tab this tick is responsible for. */
let watchIndex = 0;

let version      = 1;
let lastChange   = new Date().toISOString();
let lastSource   = 'boot';
let fingerprints = {};
let polling      = false;

function bump(source, detail) {
  version += 1;
  lastChange = new Date().toISOString();
  lastSource = source;
  console.log(`[sync] v${version} — ${source}${detail ? ' · ' + detail : ''}`);
}

/*  Row count alone misses edits that neither add nor remove a row, so the
    newest Last_Updated_Date is folded in as well. */
function fingerprint(rows) {
  if (!Array.isArray(rows)) return '0';
  let stamp = '';
  for (const r of rows) {
    const t = r.Last_Updated_Date || r.Created_Date || '';
    if (t && t > stamp) stamp = t;
  }
  return rows.length + ':' + stamp;
}

async function checkForChanges() {
  if (polling) return;

  /*  Never compete with the person actually using the app. A background
      fingerprint check is worth nothing if it makes a save wait; if calls are
      already queued, skip this tick and try again in five minutes.        */
  if (typeof db.queueDepth === 'function' && db.queueDepth() > 0) {
    return;
  }

  polling = true;
  const moved = [];

  /* one tab per tick, in rotation */
  const table = WATCHED[watchIndex % WATCHED.length];
  watchIndex++;

  try {
    /*  background: true — a fingerprint check must never make somebody wait.
        It goes behind every request a person is actually looking at.      */
    const rows = await db.all(table, { fresh: true, background: true });
    const fp   = fingerprint(rows);
    if (fingerprints[table] !== undefined && fingerprints[table] !== fp) {
      moved.push(`${table} ${fingerprints[table]} -> ${fp}`);
    }
    fingerprints[table] = fp;

    if (moved.length) bump('sheet edit', moved.join(', '));
  } catch (e) {
    console.warn(`[sync] could not read ${table}: ${e.message}`);
  } finally {
    polling = false;
  }
}

if (POLL_MS > 0) {
  /*  The baseline used to run three seconds after boot — straight into the
      middle of prewarm, doubling the queue exactly when the app is slowest to
      start. Sixty seconds lets prewarm finish first.                       */
  setTimeout(() => checkForChanges().catch(() => {}), 60000);
  const t = setInterval(() => checkForChanges().catch(() => {}), POLL_MS);
  if (t.unref) t.unref();
  console.log(`[sync] watching ${WATCHED.length} tabs, one per tick, every ${POLL_MS / 1000}s ` +
              `(full sweep about every ${Math.round(WATCHED.length * POLL_MS / 60000)} min)`);
}

/* GET /api/sync/version — polled by the frontend. Does no sheet work. */
router.get('/version', (_req, res) => {
  res.json({
    success: true,
    data: { version, last_change: lastChange, source: lastSource,
            poll_ms: POLL_MS, watching: WATCHED },
  });
});

/* POST /api/sync/touch — the app's own writes call this so other open tabs
   refresh too. */
router.post('/touch', (req, res) => {
  bump('app write', req.body?.table || '');
  res.json({ success: true, data: { version } });
});

/* GET /api/lookups  — mounted at both /api/lookups and /api/sync/lookups */
router.get('/lookups', async (req, res, next) => {
  try {
    const data = await db.lookups({ fresh: req.query.fresh === '1' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/* POST /api/sync/invalidate — called by the sheet's onChange trigger */
router.post('/invalidate', (req, res) => {
  const token = req.body?.token || req.query.token;
  if (token !== process.env.SHEETS_API_TOKEN) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  db.invalidate(req.body?.table);       // no table → clear everything
  const t = req.body?.table;
  if (t) delete fingerprints[t]; else fingerprints = {};
  bump('sheet webhook', t || 'all');
  res.json({ success: true, cleared: t || 'all', version });
});

/* GET /api/sync/status */
router.get('/status', async (req, res, next) => {
  try {
    res.json({ success: true, data: await db.schema() });
  } catch (err) { next(err); }
});

/* POST /api/sync/refresh — manual "pull latest from sheet" button */
router.post('/refresh', async (_req, res, next) => {
  try {
    db.invalidate();
    fingerprints = {};
    await checkForChanges();
    bump('manual refresh');
    res.json({ success: true, version, last_change: lastChange,
               message: 'Re-read from the sheet' });
  } catch (err) { next(err); }
});

module.exports = router;