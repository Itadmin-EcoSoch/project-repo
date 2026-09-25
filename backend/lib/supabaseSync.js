/*  backend/lib/supabaseSync.js
    ----------------------------------------------------------------------------
    Mirrors every Sheet write into Supabase, so Supabase is a live replica of
    the Google Sheet. Called from db/sheets.js right after a successful Apps
    Script write (insert / update / delete), so it covers every table and every
    route with no per-route wiring.

    - Dormant until SUPABASE_URL and SUPABASE_SERVICE_KEY are set (no-op).
    - Upserts on the tab's id column (PostgREST on_conflict), so add = insert,
      update = merge. Column names must match the Supabase table exactly — we
      allow only the columns defined in mapping.js (+ geo / file-name extras),
      so an unexpected sheet column can never 400 the upsert.
    - Best-effort and time-boxed: a Supabase hiccup never breaks the Sheet write
      (the caller swallows anything this throws), but we DO await it so the
      write completes before the serverless function is frozen.
--------------------------------------------------------------------------- */

const { MAP } = require('./mapping');

const URL     = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY     = process.env.SUPABASE_SERVICE_KEY || '';
const ENABLED = Boolean(URL && KEY);
const TIMEOUT = Number(process.env.SUPABASE_TIMEOUT || 8000);

/* internal table key -> Supabase table name (the Sheet tab name) */
const TABLE = {
  clients:      'Clients',
  projects:     'Projects',
  amc_contracts:'AMC_Contracts',
  amc_tasks:    'AMC_Tasks_Schedule',
  amc_payments: 'AMC_Payment_Schedule',
  tickets:      'Tickets',
  users:        'Users',
  launcher:     'Launcher',
};

/* Sheet columns that exist in the tables but aren't in the app field-map. */
const EXTRA = {
  clients:  ['Client_GMap_Location'],
  projects: ['GMap_Link', 'Quote_Sheet_Name', 'Proposal_Name', 'Files_Name', 'Bill_File_Name', 'PO_File_Name'],
};

/* Per-table: id column + the set of allowed columns (kept in sync with mapping). */
const ID_COL = {}, ALLOWED = {};
for (const k of Object.keys(TABLE)) {
  ID_COL[k] = MAP[k].id;
  const s = new Set(Object.values(MAP[k]));
  (EXTRA[k] || []).forEach(c => s.add(c));
  ALLOWED[k] = s;
}

function headers() {
  return {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  };
}

/** Keep only real table columns, and never send an empty/idless row. */
function clean(key, row) {
  const allow = ALLOWED[key];
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (allow.has(k)) out[k] = (v === undefined || v === null) ? null : String(v);
  }
  out.synced_at = new Date().toISOString();
  return out;
}

async function withTimeout(promise) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), TIMEOUT);
  try { return await promise(ac.signal); }
  finally { clearTimeout(t); }
}

/** Upsert one or many rows into the tab's Supabase table. Best-effort. */
async function upsert(key, rows) {
  if (!ENABLED) return;
  const tab = TABLE[key];
  if (!tab) return;                       // tab not mirrored (e.g. status_log)
  const list = (Array.isArray(rows) ? rows : [rows])
    .filter(Boolean)
    .map(r => clean(key, r))
    .filter(r => r[ID_COL[key]] != null && r[ID_COL[key]] !== '');
  if (!list.length) return;

  const url = `${URL}/rest/v1/${encodeURIComponent(tab)}?on_conflict=${encodeURIComponent(ID_COL[key])}`;
  try {
    await withTimeout(async signal => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(list),
        signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn(`[supabase] upsert ${tab} -> ${res.status} ${txt.slice(0, 300)}`);
      }
    });
  } catch (e) {
    console.warn(`[supabase] upsert ${tab} failed: ${e.message}`);
  }
}

/** Delete a row from the tab's Supabase table by id. Best-effort. */
async function remove(key, id) {
  if (!ENABLED) return;
  const tab = TABLE[key];
  if (!tab || id == null || id === '') return;
  const url = `${URL}/rest/v1/${encodeURIComponent(tab)}?${encodeURIComponent(ID_COL[key])}=eq.${encodeURIComponent(String(id))}`;
  try {
    await withTimeout(async signal => {
      const res = await fetch(url, { method: 'DELETE', headers: headers(), signal });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn(`[supabase] delete ${tab} -> ${res.status} ${txt.slice(0, 300)}`);
      }
    });
  } catch (e) {
    console.warn(`[supabase] delete ${tab} failed: ${e.message}`);
  }
}

module.exports = { upsert, remove, ENABLED, MIRRORED: Object.keys(TABLE) };
