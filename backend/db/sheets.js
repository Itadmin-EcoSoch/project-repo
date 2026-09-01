/*  backend/db/sheets.js  ** v2 — SPEED RELEASE **
    ----------------------------------------------------------------------------
    What changed and why it was slow before:

    v1 sent every query straight to Apps Script, and the Node cache was keyed on
    the query string. So ?status=All, ?status=Active and ?q=kumar were three
    separate cache entries — three separate full reads of a 1,542-row sheet.
    Each page also made a SECOND call to fetch clients for the join.

    v2 caches the WHOLE TAB once, then does all filtering, searching, sorting
    and pagination in Node memory. One Apps Script read per tab per minute,
    no matter how many filters you click.

    Plus:
      • stale-while-revalidate — once warm, a request NEVER waits on the sheet;
        stale data is served instantly and refreshed in the background
      • request coalescing — 10 simultaneous requests trigger 1 sheet read
      • prewarm on boot — tables load while you're still opening the browser
      • columnar transport — pairs with action=all in Code.gs v2

    Requires Node 18+ (global fetch).
--------------------------------------------------------------------------- */

require('dotenv').config();

const API_URL   = process.env.SHEETS_API_URL   || '';
const API_TOKEN = process.env.SHEETS_API_TOKEN || '';
const TIMEOUT   = Number(process.env.SHEETS_TIMEOUT || 90000);

/** How long a cached tab counts as fresh (ms). After this it is still served
 *  instantly, but a background refresh kicks off. */
const FRESH_MS = Number(process.env.SHEETS_CACHE_TTL || 60000);

/** Past this age we stop trusting the cache and make the caller wait. */
const MAX_STALE_MS = Number(process.env.SHEETS_MAX_STALE || 15 * 60 * 1000);

const hasCredentials = Boolean(API_URL && API_TOKEN);

const TABLE_NAMES = {
  clients: 'Clients', projects: 'Projects', amc_contracts: 'AMC_Contracts',
  amc_tasks: 'AMC_Tasks_Schedule', amc_payments: 'AMC_Payment_Schedule',
  tickets: 'Tickets', users: 'Users', launcher: 'Launcher',
  order_log: 'Order_Log', status_log: 'Status_Log',
  /* Lookup feeding AMC_Contracts.Payment_Start_Date. Keyed
     "{Payment_Frequency}: {AMC_Frequency}" -> Add_Months. */
  add_months: 'Add_Months',
  /*  Admin-managed dropdown values (Project_Type, Sales_Lead, Inverter_Brand,
      …) — see routes/dropdownOptions.js and pages/AdminDropdowns.jsx. Needs a
      matching entry in Code.gs's TABLES map before this works; see the setup
      note at the top of routes/dropdownOptions.js.                          */
  dropdown_options: 'Dropdown_Options',
};

/* ───────────────────────── transport ───────────────────────── */

/*  ── ONE APPS SCRIPT CALL AT A TIME ───────────────────────────────────────

    Apps Script SERIALISES executions per user. Five simultaneous requests to
    /exec do not run in parallel — they queue inside Google, and each one's
    clock includes the wait for the ones in front.

    That is why the boot log reads like this:

        AMC_Payment_Schedule :   30 rows in 13276ms
        Dropdown_Options     :    0 rows in 14900ms   <-- zero rows, 15 seconds

    Nothing takes fifteen seconds to read nothing. Those numbers are queue
    time, because prewarm fired five tabs at once with Promise.allSettled and
    the 20-second sync watcher kept adding more on top.

    The damage was not just slowness. A request's timeout was ticking while it
    sat in that queue, so an upload could exhaust its budget having never
    reached Google — which is exactly the "timeout of 45000ms exceeded" on the
    PO field. Queueing here instead means the timeout measures the request,
    not the traffic jam in front of it.

    Sending one at a time is not slower overall. The executions were always
    serial; all the parallelism bought was sockets held open and clocks
    running down.                                                            */
/*  ── TWO TIERS, NOT ONE QUEUE ─────────────────────────────────────────────

    Serialising fixed the timeouts caused by parallel requests. It introduced a
    fairness problem in their place: strict FIFO means whatever arrives first
    wins, and on boot what arrives first is always prewarm.

    That is the 60-second Users read in the log. Thirteen rows do not take a
    minute — the sign-in needed the Users tab and got in line behind Projects,
    Clients and AMC_Contracts, three full-table downloads nobody was waiting
    for. The person signing in paid for all of them.

    So there are two tiers. A request somebody is waiting on goes in front of
    every background job still queued; prewarm and the sync poller go to the
    back. Background work still happens, just never at the expense of somebody
    watching a spinner.

    Ahead of OTHER BACKGROUND JOBS, not ahead of the one already running —
    Apps Script has no way to interrupt an execution in flight, so the worst
    case is still one slow read of wait.                                    */
const waiting = [];        // { fn, resolve, reject, bg }
let  running  = false;

function enqueue(fn, bg = false) {
  return new Promise((resolve, reject) => {
    const job = { fn, resolve, reject, bg };

    if (bg) {
      waiting.push(job);
    } else {
      /* in front of the first background job, behind other foreground work */
      const at = waiting.findIndex(j => j.bg);
      if (at === -1) waiting.push(job); else waiting.splice(at, 0, job);
    }

    pump();
  });
}

async function pump() {
  if (running) return;
  const job = waiting.shift();
  if (!job) return;

  running = true;
  try {
    job.resolve(await job.fn());
  } catch (err) {
    job.reject(err);
  } finally {
    running = false;
    pump();                                  // next in line
  }
}

async function call(payload, opts = {}) {
  if (!hasCredentials) {
    throw new Error('Google Sheets is not configured. Set SHEETS_API_URL and SHEETS_API_TOKEN in backend/.env');
  }
  if (waiting.length >= 4) {
    console.warn(`[sheets] ${waiting.length} calls waiting — "${payload.action}" is behind them` +
                 `${opts.background ? ' (background)' : ''}.`);
  }
  return enqueue(() => callNow(payload, opts), !!opts.background);
}

async function callNow(payload, { method = 'POST' } = {}) {
  const body = { token: API_TOKEN, ...payload };
  const ctl  = new AbortController();
  const t    = setTimeout(() => ctl.abort(), TIMEOUT);

  try {
    let res;
    if (method === 'GET') {
      const qs = new URLSearchParams();
      Object.entries(body).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        qs.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
      res = await fetch(`${API_URL}?${qs}`, { signal: ctl.signal, redirect: 'follow' });
    } else {
      /*  The token goes in the QUERY STRING as well as the body.

          A POST to /exec is answered with a 302 to script.googleusercontent.com.
          Per the fetch spec, following a 302 after a POST reissues it as a GET
          — and a GET has no body, so the token inside it is gone. Apps Script
          then sees no token and answers "Unauthorized — bad token", which is
          the line in the boot log against the Users write. Intermittent,
          because it depends on which redirect Google serves.

          handle_() in Code.gs already falls back to e.parameter.token, so a
          copy in the URL survives the redirect and closes that hole. The body
          copy stays for the normal path.                                   */
      const auth = new URLSearchParams({ token: API_TOKEN });
      res = await fetch(`${API_URL}?${auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctl.signal,
        redirect: 'follow',
      });
    }

    const text = await res.text();
    let out;
    try { out = JSON.parse(text); }
    catch {
      throw new Error(
        `Sheets API did not return JSON (HTTP ${res.status}). ` +
        `Check the deployment is set to "Anyone" access. First 200 chars: ${text.slice(0, 200)}`
      );
    }
    if (!out.success) throw new Error(out.error || 'Sheets API error');
    return out;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Sheets API timed out — the sheet may be very large.');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/* ──────────────────── whole-table cache ──────────────────── */

/** table -> { rows:[{}], at:number, loading:Promise|null, refreshing:boolean } */
const CACHE = new Map();

/** Pull one tab and expand the columnar payload back into row objects. */
async function fetchTable(table, background = false) {
  const started = Date.now();
  const out  = await call({ action: 'all', table }, { method: 'GET', background });
  const head = out.headers || [];
  const rows = (out.rows || []).filter(Array.isArray).map(line => {
    const o = {};
    for (let i = 0; i < head.length; i++) if (head[i]) o[head[i]] = line[i];
    return o;
  });
  console.log(`[sheets] loaded ${TABLE_NAMES[table] || table}: ${rows.length} rows in ${Date.now() - started}ms`);
  return rows;
}

/**
 * The core of v2. Returns rows for a tab, never blocking once warm.
 *   fresh    → return immediately
 *   stale    → return immediately AND refresh in the background
 *   too old  → await the refresh
 *   missing  → await the first load (coalesced across concurrent callers)
 */
async function table(name, { force = false, background = false } = {}) {
  const e   = CACHE.get(name);
  const age = e ? Date.now() - e.at : Infinity;

  if (e && !force && age < FRESH_MS) return e.rows;

  if (e && !force && age < MAX_STALE_MS) {
    if (!e.refreshing) {
      e.refreshing = true;
      /*  A stale-while-revalidate refresh is by definition not urgent — the
          caller already has rows and has been handed them.                */
      fetchTable(name, true)
        .then(rows => { e.rows = rows; e.at = Date.now(); })
        .catch(err => console.error(`[sheets] background refresh of ${name} failed:`, err.message))
        .finally(() => { e.refreshing = false; });
    }
    return e.rows;                          // instant, slightly stale
  }

  if (e?.loading) return e.loading;         // someone else is already fetching

  const p = fetchTable(name, background)
    .then(rows => {
      CACHE.set(name, { rows, at: Date.now(), loading: null, refreshing: false });
      return rows;
    })
    .catch(err => {
      const prev = CACHE.get(name);
      if (prev) { prev.loading = null; return prev.rows; }   // fall back to whatever we had
      CACHE.delete(name);
      throw err;
    });

  CACHE.set(name, { rows: e?.rows || [], at: e?.at || 0, loading: p, refreshing: false });
  return p;
}

function invalidate(name) {
  if (!name) return CACHE.clear();
  CACHE.delete(name);
}

/*  Apply a write to the in-memory copy so the UI updates before the refresh.

    A null/undefined row must NEVER be pushed. Doing so used to poison the whole
    tab: every later lookup did String(r[idCol]) on the hole and threw
    "Cannot read properties of undefined (reading 'Project_ID')", which surfaced
    as "Could not build the email" on the New Order Form. The row is validated
    here, and every reader below also skips holes, so one bad write can no
    longer take down reads.                                                  */
function patchCache(name, idCol, id, row, mode) {
  const e = CACHE.get(name);
  if (!e || !e.rows) return;

  if (mode === 'insert') {
    if (!row || typeof row !== 'object') {
      console.warn(`[sheets] patchCache: refused to insert a non-object into ${name} cache`);
      invalidate(name);            // force a clean reload instead of caching a hole
      return;
    }
    e.rows.push(row);
    return;
  }

  const want = String(id ?? '').trim().toLowerCase();
  const i = e.rows.findIndex(
    r => r && String(r[idCol] ?? '').trim().toLowerCase() === want);
  if (i === -1) return;
  if (mode === 'delete') e.rows.splice(i, 1);
  else                   e.rows[i] = { ...e.rows[i], ...row };
}

const ID_COL = {
  clients: 'Client_Id', projects: 'Project_ID', amc_contracts: 'AMC_Id',
  amc_tasks: 'AMC_Task_Id', amc_payments: 'Payment_Id', tickets: 'Ticket_Id',
  users: 'Email', launcher: 'App_Id', order_log: 'Order_Id', status_log: 'Log_Id',
  add_months: '_ComputedKey', dropdown_options: 'Option_Id',
};

/* ──────────────── in-memory query engine ──────────────── */

function matches(have, want) {
  const h = have === null || have === undefined ? '' : String(have).trim().toLowerCase();
  return String(want).split('|').some(w => {
    w = w.trim();
    if (w.startsWith('!')) return h !== w.slice(1).toLowerCase();
    return h === w.toLowerCase();
  });
}

function runQuery(rows, params = {}) {
  /*  Drop any null/undefined holes before filtering, searching or sorting.
      Object.keys(undefined) and undefined[key] both throw, so a single bad
      cache write used to break every list page as well as single lookups.  */
  let out = (rows || []).filter(Boolean);

  if (params.where && typeof params.where === 'object') {
    for (const [k, want] of Object.entries(params.where)) {
      if (want === null || want === undefined || want === '') continue;
      out = out.filter(r => matches(r[k], want));
    }
  }

  const q = String(params.q || '').trim().toLowerCase();
  if (q) {
    const keys = params.searchFields
      ? String(params.searchFields).split(',').map(s => s.trim())
      : null;
    out = out.filter(r => {
      const ks = keys || Object.keys(r);
      return ks.some(k => r[k] != null && String(r[k]).toLowerCase().includes(q));
    });
  }

  const total = out.length;

  if (params.sort) {
    const dir = String(params.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const sc  = params.sort;
    out = [...out].sort((a, b) => {
      const x = a[sc], y = b[sc];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const nx = Number(x), ny = Number(y);
      if (!isNaN(nx) && !isNaN(ny)) return (nx - ny) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  // newest-first when there is no reliable date column: new rows are appended
  // to the bottom of the sheet, so reversing gives most-recent-first
  if (params.reverse && !params.sort) out = [...out].reverse();

  const offset = Math.max(0, Number(params.offset) || 0);
  const limit  = Number(params.limit);
  if (limit > 0)   out = out.slice(offset, offset + limit);
  else if (offset) out = out.slice(offset);

  if (params.fields) {
    const keep = String(params.fields).split(',').map(s => s.trim());
    out = out.map(r => {
      const o = {};
      for (const k of keep) o[k] = k in r ? r[k] : null;
      return o;
    });
  }

  return { data: out, total };
}

/* ─────────────────────── public API ─────────────────────── */

async function list(name, params = {}, { fresh = false } = {}) {
  const rows = await table(name, { force: fresh });
  return runQuery(rows, params);
}

async function all(name, opts = {}) {
  return table(name, { force: opts.fresh, background: !!opts.background });
}

/**
 * Find one row by primary key.
 *
 * The old version compared ids as numbers whenever the string match failed:
 *
 *     const a = Number(have), b = Number(want);
 *     return !isNaN(a) && !isNaN(b) && a === b;
 *
 * That silently returned the WRONG row in two cases:
 *
 *     Number('723E8001') -> Infinity      'E' read as scientific notation, so
 *     Number('5377E622') -> Infinity      these two ids compared EQUAL
 *     Number('00563447') -> 563447        collided with legacy numeric rows
 *
 * Now: a case-insensitive exact match first (which also fixes the mixed-case
 * AppSheet ids — 43126c00 and E6F2C552 live side by side in the sheet), then a
 * numeric fallback restricted to genuinely all-digit ids so nothing can ever
 * alias through Infinity again.
 */
async function get(name, id, { fresh = false } = {}) {
  if (id === undefined || id === null || id === '') return null;
  const rows = await table(name, { force: fresh });
  const col  = ID_COL[name];
  const want = String(id).trim().toLowerCase();

  const hit = rows.find(r => r && String(r[col] ?? '').trim().toLowerCase() === want);
  if (hit) return hit;

  if (!/^\d+$/.test(want)) return null;          // no coercion for text ids
  return rows.find(r => {
    if (!r) return false;
    const have = String(r[col] ?? '').trim();
    return /^\d+$/.test(have) && Number(have) === Number(want);
  }) || null;
}

async function insert(name, row) {
  const out = await call({ action: 'create', table: name, row });
  patchCache(name, ID_COL[name], null, out.data, 'insert');
  return out.data;
}

/**
 * Append MANY rows in ONE round trip.
 *
 * The AMC schedule is what forced this. A five-year quarterly cleaning
 * contract is 20 visits plus 20 payment rows, and lib/amcCreate.js was
 * awaiting insert() once per row inside a for loop. Apps Script serialises
 * executions per user, and db/sheets.js serialises them again through pump(),
 * so those 40 rows became 40 sequential /exec round trips — each taking a
 * lock, appending one row, flushing and busting the cache. At roughly 3.5
 * seconds a trip that is two and a half minutes of the user watching a
 * "Saving..." button, for a write the sheet can do in one call.
 *
 * Code.gs handles this with a single setValues() over the whole block, one
 * lock, one flush, one cacheBust — see createMany_ there.
 */
async function insertMany(name, rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return [];
  const out = await call({ action: 'createMany', table: name, rows: list });
  const made = out.data || [];
  for (const r of made) patchCache(name, ID_COL[name], null, r, 'insert');
  return made;
}

/**
 * Append MANY rows in ONE round trip.
 *
 * Your own log is the argument for this: a 2-row tab takes 2552ms and a
 * 1502-row tab takes 3123ms. The payload barely matters — roughly 3 seconds
 * is the fixed cost of the /exec call, the script lock and the flush. So what
 * decides how long a save takes is the NUMBER of round trips, and lib/
 * amcCreate.js was making one per AMC row: 40+ for a five-year quarterly
 * contract, all serialised through pump() and Apps Script's per-user
 * execution lock.
 *
 * Code.gs does the whole block with one setValues(), one lock, one flush and
 * one cacheBust — see createMany_ there.
 */
async function insertMany(name, rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return [];
  const out = await call({ action: 'createMany', table: name, rows: list });
  const made = out.data || [];
  for (const r of made) patchCache(name, ID_COL[name], null, r, 'insert');
  return made;
}

async function update(name, id, patch) {
  const out = await call({ action: 'update', table: name, id: String(id), patch });
  patchCache(name, ID_COL[name], id, out.data, 'update');
  return out.data;
}

async function remove(name, id) {
  const out = await call({ action: 'delete', table: name, id: String(id) });
  patchCache(name, ID_COL[name], id, null, 'delete');
  return out.data;
}

/*  Apps Script replies { success:true, data:{ client, project, order } }, and
    call() returns that whole envelope. The old code read out.client and
    out.project — one level too shallow, so both were undefined and got pushed
    into the cache as holes. Read out.data.*.                                */
async function createOrder(payload) {
  const out    = await call({ action: 'createOrder', ...payload });
  const result = out.data ?? out;

  patchCache('clients',  ID_COL.clients,  null, result.client,  'insert');
  patchCache('projects', ID_COL.projects, null, result.project, 'insert');
  invalidate('order_log');
  invalidate('status_log');
  return result;
}

let lookupCache = { at: 0, data: null };
async function lookups({ fresh = false } = {}) {
  if (!fresh && lookupCache.data && Date.now() - lookupCache.at < 10 * 60 * 1000) {
    return lookupCache.data;
  }
  const out = await call({ action: 'lookups' }, { method: 'GET' });
  lookupCache = { at: Date.now(), data: out.data };
  return out.data;
}

/** Resolve AppSheet attachment paths to real Drive links. Cached 30 min. */
const fileCache = new Map();
async function resolveFiles(paths = [], { fresh = false } = {}) {
  const want = [...new Set(paths.filter(Boolean))];
  if (!want.length) return {};

  const out = {}, missing = [];
  for (const p of want) {
    /*  fresh=true skips the cache entirely — used by the New Order send retry,
        so a file that missed seconds after upload (Drive not yet indexed) is
        looked up again instead of served from the 60s miss-cache.          */
    const hit = fresh ? null : fileCache.get(p);
    if (hit && Date.now() - hit.at < (hit.ttl ?? 30 * 60 * 1000)) out[p] = hit.value;
    else missing.push(p);
  }
  if (missing.length) {
    const res = await call({ action: 'files', paths: missing }, { method: 'GET' });
    for (const [k, v] of Object.entries(res.data || {})) {
      /*  A MISS is cached for one minute, a hit for thirty.

          They used to share the 30-minute lifetime, which meant a lookup that
          failed for a transient reason — Drive's search index not having caught
          up with a file uploaded seconds earlier — kept returning "no such
          file" for half an hour after the file was perfectly findable. The
          email sent in that window showed a plain filename instead of a link,
          and re-sending it did not help, because the miss was being served
          from here rather than looked up again.                            */
      const ttl = v && v.id ? 30 * 60 * 1000 : 60 * 1000;
      fileCache.set(k, { at: Date.now(), value: v, ttl });
      out[k] = v;
    }
  }
  return out;
}

/**
 * Sends mail through Apps Script — the script's owning Google account is the
 * sender, so no SMTP credentials are involved.
 * Requires the sendMail action in Code.gs (see appsscript-sendMail.gs).
 */
async function sendMail({ to, cc, subject, html, text, replyTo, name, attachments }) {
  /*  attachments — [{ id, name }] where id is a Drive FILE id, not bytes.
      Apps Script already has Drive access and is already inside Google, so it
      fetches the blob itself. Nothing is base64'd through this process, which
      keeps a 20 MB proposal out of the Node heap and off the wire twice.   */
  const out = await call({
    action: 'sendMail', to, cc, subject, html, text, replyTo, name,
    attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
  });
  return out.data;
}

/** Remaining MailApp quota for today. */
async function mailQuota() {
  const out = await call({ action: 'mailQuota' }, { method: 'GET' });
  return out.data;
}

async function schema() { return (await call({ action: 'schema' }, { method: 'GET' })).data; }
async function ping()   { return call({ action: 'ping' }, { method: 'GET' }); }

/** Load the busy tabs at boot so the first user never waits. */
/*  ── ORDER MATTERS: SMALLEST FIRST ────────────────────────────────────────

    Projects used to be first. It is 1,542 rows across 85 columns and takes the
    better part of a minute, and Apps Script cannot interrupt an execution once
    it has started — so a sign-in arriving one second after boot waited out that
    whole read before its own turn, even with priority queuing. 45 seconds
    later the browser gave up: "timeout of 45000ms exceeded" on the login page,
    with nothing wrong except the order these were fetched in.

    Users is 13 rows and is what sign-in needs, so it goes first. By the time
    anyone finishes the Google consent screen, the only thing that can be
    holding the queue is a small tab.                                        */
async function prewarm(names = ['users', 'launcher', 'clients', 'amc_contracts', 'projects']) {
  if (!hasCredentials) return;

  /*  Five seconds of nothing. The app is served separately, so someone can be
      at the login screen before this even starts; letting real traffic claim
      the queue first costs a few seconds of warm cache and saves a timeout. */
  await new Promise(r => setTimeout(r, 5000));

  console.log('[sheets] prewarming cache…');
  const t0 = Date.now();

  /*  One at a time, and reporting each. Promise.allSettled here was always an
      illusion of parallelism — Apps Script ran them serially regardless — but
      it made the first user-facing request queue behind all five, and made the
      per-tab timings meaningless because each included everyone else's wait.

      Sequential means a tab that finishes early is usable immediately, and the
      log tells you the truth about which tab is actually slow.             */
  for (const n of names) {
    const t = Date.now();
    try {
      await table(n, { force: true, background: true });
    } catch (e) {
      console.warn(`[sheets] prewarm ${n} failed after ${Date.now() - t}ms: ${e.message}`);
    }
  }

  console.log(`[sheets] prewarm finished in ${Date.now() - t0}ms`);
}

/** How many Apps Script calls are waiting. Lets callers back off politely. */
function queueDepth() { return waiting.length + (running ? 1 : 0); }

function stats() {
  const out = {};
  for (const [k, v] of CACHE.entries()) {
    out[k] = { rows: v.rows?.length ?? 0, age_ms: Date.now() - v.at, refreshing: !!v.refreshing };
  }
  return out;
}

module.exports = {
  hasCredentials, API_URL,
  /*  Exposed so routes/uploads.js can send the custom `uploadFile` action
      without duplicating the token, timeout and JSON-error handling above. */
  call,
  table, list, all, get, insert, insertMany, update, remove,
  createOrder, lookups, schema, ping, resolveFiles,
  invalidate, prewarm, stats,
  TABLES: TABLE_NAMES,
  sendMail, mailQuota,
  queueDepth,
};