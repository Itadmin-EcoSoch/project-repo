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
    /*  Same unmapped Projects columns added to db/supabase.js EXTRA — kept in
        sync here so the forward mirror (sheet -> Supabase replica) carries them
        too, rather than silently dropping them.                            */
    'Bill_Available', 'PO_Available', 'PO_Bill_Name_Same', 'Billing_Quotation_Same',
    'GST_Available', 'Quotation_Name',
    'Referral', 'Referral_Amount', 'Referrer_Name',
    'Retention', 'Retention_Amount', 'Retention_Period',
    'Monitoring_Frequency', 'TSV_Required', 'Capacity_Finalised', 'Elevated_drawings',
    'New_Order_Sent_At', 'New_Order_Sent_By', 'Internal_Id',
  ],
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
const NUM_COLS = {
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
  amc_contracts: new Set([
    'AMC_Start_Date', 'AMC_End_Date', 'Payment_Start_Date', 'Payment_End_Date',
  ]),
  projects: new Set([
    'Commissioned_Date', 'Warranty_Start_Date', 'Warranty_End_Date',
    'Exp_Inst_Date', 'Exp_Commsn_Date', 'Created_Date', 'Last_Updated_Date',
    'New_Order_Sent_At',
  ]),
};
function clean(key, row) {
  const allow = ALLOWED[key];
  const num = NUM_COLS[key]; const dat = DATE_COLS[key];
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (!allow.has(k)) continue;
    if (v === undefined || v === null) { out[k] = null; continue; }
    if (num && num.has(k)) {
      const sv = String(v).replace(/,/g, '').trim();
      out[k] = sv === '' ? null : sv;
      continue;
    }
    if (dat && dat.has(k)) {
      const sv = String(v).trim();
      out[k] = sv === '' ? null : (/^\d{4}-\d{2}-\d{2}/.test(sv) ? sv.slice(0, 10) : sv);
      continue;
    }
    out[k] = String(v);
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
