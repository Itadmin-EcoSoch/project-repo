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
  dropdown_options: 'dropdowns',
};
const EXTRA = {
  tickets: [
    /*  Columns the Tickets tab carries but lib/mapping.js never mapped, so
        clean() dropped them on backfill/write (charge-applicable flags and
        amounts, ticket expenses, the ticket files, and the updated-by stamp). */
    'Service_Charge_Applicable', 'Service_Charge',
    'Material_Charge_Applicable', 'Ticket_Expenses',
    'Ticket_Files', 'Last_Updated_By',
  ],
  amc_payments: [
    /*  The payment receipt file column exists in the AMC_Payment_Schedule tab
        but was never mapped, so it was dropped on backfill/write. */
    'Payment_Receipt',
  ],
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
/*  Columns that are numeric / date types in Supabase (see the type-change SQL).
    They reject '' — so an empty value must become NULL, numbers must drop any
    thousands commas, and dates must be a bare 'YYYY-MM-DD'. Sending strings
    keeps this safe whether the column is still text or already retyped, because
    Postgres coerces the string to the column type. */
const NUM_COLS = {
  dropdown_options: new Set(['Sort_Order']),
  amc_payments: new Set(['Payment_Amount']),
  tickets: new Set([
    'Service_Charge', 'Material_Charge', 'Total_Charge', 'Ticket_Warranty_Period',
  ]),
  amc_contracts: new Set([
    'AMC_Frequency', 'AMC_Period_in_Years', 'Payment_Amount', 'Tasks_Count',
    'Payments_Count', 'Percent_Increase', 'Payment_Frequency',
    'Payment_Period_in_Years', 'AMC_Tasks_Done', 'Payments_Done',
  ]),
  projects: new Set([
    'Project_Size', 'Module_Wattage', 'Module_No', 'Order_Value', 'Margin',
    'Warranty_Period', 'Referral_Amount', 'Retention_Amount',
    // Retention_Period stays TEXT — it holds values like 'NA', '1 year',
    // 'As per the tariff Rate', not just numbers.
  ]),
};
const DATE_COLS = {
  amc_payments: new Set(['Payment_Due_Date']),
  amc_tasks: new Set(['AMC_Due_Date']),
  tickets: new Set([
    'Ticket_Start_Date', 'Ticket_Due_Date',
    'Ticket_Warranty_Start_Date', 'Ticket_Warranty_End_Date',
    'Created_Date', 'Last_Updated_Date',
  ]),
  amc_contracts: new Set([
    'AMC_Start_Date', 'AMC_End_Date', 'Payment_Start_Date', 'Payment_End_Date',
  ]),
  projects: new Set([
    'Commissioned_Date', 'Warranty_Start_Date', 'Warranty_End_Date',
    'Exp_Inst_Date', 'Exp_Commsn_Date', 'Created_Date', 'Last_Updated_Date',
    'New_Order_Sent_At',
  ]),
};

/* keep only real columns; drop null/undefined -> stringify to mirror the Sheet */
function clean(key, row) {
  const allow = ALLOWED[key]; const out = {};
  const num = NUM_COLS[key]; const dat = DATE_COLS[key];
  for (const [k, v] of Object.entries(row || {})) {
    if (!allow.has(k)) continue;
    if (v === undefined || v === null) { out[k] = null; continue; }
    if (typeof v === 'boolean') { out[k] = v; continue; }
    if (num && num.has(k)) {
      const sv = String(v).replace(/,/g, '').trim();
      out[k] = sv === '' ? null : sv;             // numeric string; '' -> NULL
      continue;
    }
    if (dat && dat.has(k)) {
      const sv = String(v).trim();
      out[k] = sv === '' ? null : (/^\d{4}-\d{2}-\d{2}/.test(sv) ? sv.slice(0, 10) : sv);
      continue;
    }
    out[k] = String(v);
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

  if (params.sort) qs.push(`order=${encodeURIComponent(params.sort)}.${(String(params.order || 'desc').toLowerCase() === 'asc') ? 'asc' : 'desc'}.nullslast`);

  const base = `${REST}/${encodeURIComponent(tab)}?${qs.join('&')}`;

  /*  Page PAST PostgREST's 1000-row cap so the FULL filtered set comes back.
      The projects/clients list routes pull the whole set and then filter/slice
      in memory, so a single capped request silently hid every row beyond 1000
      (e.g. 1,588 projects showed as 1,000). Range headers, same as all().   */
  const page = 1000; let from = 0; const rowsAll = [];
  for (;;) {
    const { body } = await req(base, { headers: headers({ Range: `${from}-${from + page - 1}` }) });
    const rows = Array.isArray(body) ? body : [];
    rowsAll.push(...rows);
    if (rows.length < page) break;
    from += page;
  }

  const total = rowsAll.length;
  const off = Number(params.offset) > 0 ? Number(params.offset) : 0;
  const lim = Number(params.limit)  > 0 ? Number(params.limit)  : 0;
  const data = (off || lim) ? rowsAll.slice(off, lim ? off + lim : undefined) : rowsAll;
  return { data, total };
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
