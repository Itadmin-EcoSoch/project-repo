/*  backend/db/supabase.js
    ----------------------------------------------------------------------------
    Supabase (PostgREST) data adapter — the same read/write interface as
    db/sheets.js, so the app can run on Supabase instead of the Google Sheet by
    setting DATA_SOURCE=supabase. Column names ARE the Sheet headers, so rows
    returned here are shaped exactly like Sheet rows and flow through the same
    toApp()/toSheet() mapping unchanged.

    Drive files and email stay on Apps Script (see db/index.js) — only the DB
    moves here.
--------------------------------------------------------------------------- */

const { MAP } = require('../lib/mapping');

const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const REST = URL ? `${URL}/rest/v1` : '';
const TIMEOUT = Number(process.env.SUPABASE_TIMEOUT || 15000);

/* internal key -> Supabase table (Sheet tab) name */
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
const EXTRA = {
  amc_contracts: [
    /*  Columns the AMC_Contracts tab carries but lib/mapping.js never mapped,
        so clean() dropped them on backfill/write and they were blank on
        Supabase (payment schedule terms, the tasks/payments-done flags and
        the annual percent increase). Add them so they round-trip.          */
    'Payment_Available', 'Percent_Increase', 'Payment_Frequency',
    'Payment_Period_in_Years', 'Payment_Start_Date', 'Payment_End_Date',
    'AMC_Tasks_Done', 'Payments_Done',
  ],
  clients:  ['Client_GMap_Location'],
  projects: [
    'GMap_Link', 'Client_Id', 'Quote_Sheet_Name', 'Proposal_Name', 'Files_Name',
    'Bill_File_Name', 'PO_File_Name',
    /*  Columns the Projects tab carries and the project form reads via f.sheet
        from _raw, but that lib/mapping.js never mapped — so clean() dropped
        them on backfill/insert/update and they came back blank on Supabase
        (Electricity Bill Available?, Purchase Order Available?, GSTIN?,
        Quotation Name, the PO/billing name-match toggles, referral, retention,
        monitoring frequency, TSV, capacity, elevated drawings, and the
        New-Order-sent stamps). Add them here so they round-trip.          */
    'Bill_Available', 'PO_Available', 'PO_Bill_Name_Same', 'Billing_Quotation_Same',
    'GST_Available', 'Quotation_Name',
    'Referral', 'Referral_Amount', 'Referrer_Name',
    'Retention', 'Retention_Amount', 'Retention_Period',
    'Monitoring_Frequency', 'TSV_Required', 'Capacity_Finalised', 'Elevated_drawings',
    'New_Order_Sent_At', 'New_Order_Sent_By', 'Internal_Id',
  ],
};
const ID_COL = {}, ALLOWED = {};
for (const k of Object.keys(TABLE)) {
  ID_COL[k] = MAP[k].id;
  const s = new Set(Object.values(MAP[k]));
  (EXTRA[k] || []).forEach(c => s.add(c));
  ALLOWED[k] = s;
}

function assertKnown(key) {
  if (!REST || !KEY) throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  if (!TABLE[key]) throw new Error(`Supabase adapter: unknown table "${key}"`);
}
function headers(extra) {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(extra || {}) };
}
async function req(url, opts = {}) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 400)}`);
    return { res, body: text ? JSON.parse(text) : null };
  } finally { clearTimeout(t); }
}
/* keep only real columns; drop null/undefined -> stringify to mirror the Sheet */
function clean(key, row) {
  const allow = ALLOWED[key]; const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (allow.has(k)) out[k] = (v === undefined || v === null) ? null : (typeof v === 'boolean' ? v : String(v));
  }
  return out;
}

/* ── reads ─────────────────────────────────────────────────────────────── */

/** Every row of a table (paged past PostgREST's 1000-row cap). */
async function all(key /*, opts */) {
  assertKnown(key);
  const tab = TABLE[key];
  const page = 1000; let from = 0; const out = [];
  for (;;) {
    const url = `${REST}/${encodeURIComponent(tab)}?select=*`;
    const { body } = await req(url, { headers: headers({ Range: `${from}-${from + page - 1}` }) });
    const rows = Array.isArray(body) ? body : [];
    out.push(...rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

/** list({ where, q, searchFields, sort, order, fields, limit, offset }) -> { data, total } */
async function list(key, params = {}) {
  assertKnown(key);
  const tab = TABLE[key];
  const qs = [];

  qs.push('select=' + (params.fields ? String(params.fields).split(',').map(s => s.trim()).join(',') : '*'));

  if (params.where && typeof params.where === 'object') {
    for (const [col, want] of Object.entries(params.where)) {
      if (want === null || want === undefined || want === '') continue;
      const v = String(want);
      if (v.startsWith('!')) qs.push(`${col}=neq.${encodeURIComponent(v.slice(1))}`);
      else qs.push(`${col}=eq.${encodeURIComponent(v)}`);
    }
  }

  const q = String(params.q || '').trim();
  if (q && params.searchFields) {
    const cols = String(params.searchFields).split(',').map(s => s.trim()).filter(Boolean);
    const like = encodeURIComponent(`*${q}*`);
    const ors  = cols.map(c => `${c}.ilike.${like}`).join(',');
    qs.push(`or=(${ors})`);
  }

  if (params.sort) qs.push(`order=${encodeURIComponent(params.sort)}.${(String(params.order || 'desc').toLowerCase() === 'asc') ? 'asc' : 'desc'}`);
  if (Number(params.limit)  > 0) qs.push(`limit=${Number(params.limit)}`);
  if (Number(params.offset) > 0) qs.push(`offset=${Number(params.offset)}`);

  const url = `${REST}/${encodeURIComponent(tab)}?${qs.join('&')}`;
  const { res, body } = await req(url, { headers: headers({ Prefer: 'count=exact' }) });
  const rows = Array.isArray(body) ? body : [];
  const cr = res.headers.get('content-range') || '';           // "0-24/1500"
  const total = cr.includes('/') ? Number(cr.split('/')[1]) || rows.length : rows.length;
  return { data: rows, total };
}

async function get(key, id) {
  assertKnown(key);
  if (id === undefined || id === null || id === '') return null;
  const tab = TABLE[key];
  const url = `${REST}/${encodeURIComponent(tab)}?${encodeURIComponent(ID_COL[key])}=eq.${encodeURIComponent(String(id))}&limit=1`;
  const { body } = await req(url, { headers: headers() });
  return (Array.isArray(body) && body[0]) || null;
}

/* ── writes ────────────────────────────────────────────────────────────── */

/** For a project, resolve Client_Id from Client_Name (FK) if not already set. */
async function fillClientId(key, row) {
  if (key !== 'projects') return row;
  if (row.Client_Id && String(row.Client_Id).trim()) return row;
  const name = String(row.Client_Name || '').trim();
  if (!name) return row;
  try {
    const url = `${REST}/${encodeURIComponent(TABLE.clients)}?Client_Name=eq.${encodeURIComponent(name)}&select=Client_Id&limit=1`;
    const { body } = await req(url, { headers: headers() });
    if (Array.isArray(body) && body[0] && body[0].Client_Id) return { ...row, Client_Id: body[0].Client_Id };
  } catch (e) { console.warn('[supabase] fillClientId: ' + e.message); }
  return row;
}

async function insert(key, row) {
  assertKnown(key);
  const withFk = await fillClientId(key, row);
  const body = clean(key, withFk);
  const url = `${REST}/${encodeURIComponent(TABLE[key])}`;
  const { body: out } = await req(url, {
    method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify([body]),
  });
  return (Array.isArray(out) && out[0]) || body;
}

async function insertMany(key, rows) {
  assertKnown(key);
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  if (!list.length) return [];
  const bodies = [];
  for (const r of list) bodies.push(clean(key, await fillClientId(key, r)));
  const url = `${REST}/${encodeURIComponent(TABLE[key])}`;
  const { body: out } = await req(url, {
    method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(bodies),
  });
  return Array.isArray(out) ? out : bodies;
}

async function update(key, id, patch) {
  assertKnown(key);
  const body = clean(key, patch);
  delete body[ID_COL[key]];                 // never change the primary key
  const url = `${REST}/${encodeURIComponent(TABLE[key])}?${encodeURIComponent(ID_COL[key])}=eq.${encodeURIComponent(String(id))}`;
  const { body: out } = await req(url, {
    method: 'PATCH', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(body),
  });
  return (Array.isArray(out) && out[0]) || { ...patch, [ID_COL[key]]: id };
}

async function remove(key, id) {
  assertKnown(key);
  const url = `${REST}/${encodeURIComponent(TABLE[key])}?${encodeURIComponent(ID_COL[key])}=eq.${encodeURIComponent(String(id))}`;
  await req(url, { method: 'DELETE', headers: headers() });
  return { [ID_COL[key]]: id };
}

const CONFIGURED = Boolean(REST && KEY);

module.exports = { all, list, get, insert, insertMany, update, remove, CONFIGURED, MIRRORED: Object.keys(TABLE) };
