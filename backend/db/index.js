/*  backend/db/index.js  — data-source facade
    ----------------------------------------------------------------------------
    Routes each table to the right store and keeps them in step.

      DATA_SOURCE=sheet     (default) reads/writes the Google Sheet (Apps Script);
                            for the migrated tables it also forward-mirrors each
                            write into Supabase (the live replica).
      DATA_SOURCE=supabase  reads/writes Supabase for the MIGRATED tables (fast
                            Postgres) and — when SHEET_WRITE_THROUGH=true —
                            reverse-mirrors those writes back to the Sheet.

    Tables NOT yet migrated to Supabase (order_log, status_log, dropdown_options,
    add_months, …) always go to Apps Script, in either mode. Drive uploads/links
    and email always go to Apps Script too.
--------------------------------------------------------------------------- */

const sheet  = require('./sheets');            // Apps Script (Google Sheet)
const supa   = require('./supabase');          // Supabase (PostgREST)
const mirror = require('../lib/supabaseSync');  // forward mirror (sheet -> supabase)

const SRC           = (process.env.DATA_SOURCE || 'sheet').toLowerCase();
const USE_SUPA      = SRC === 'supabase';
const WRITE_THROUGH = String(process.env.SHEET_WRITE_THROUGH || 'false').toLowerCase() === 'true';

/* the tables that live in Supabase */
const SUPA_TABLES = new Set(supa.MIRRORED);           // clients, projects, amc_*, tickets, users, launcher
const onSupa = name => USE_SUPA && SUPA_TABLES.has(name);

console.log(`[db] DATA_SOURCE=${SRC}` +
  (USE_SUPA ? ` (supabase tables: ${[...SUPA_TABLES].join(',')}; sheet write-through: ${WRITE_THROUGH})`
            : ' (mirroring migrated tables to Supabase)'));

/* ── reads ───────────────────────────────────────────────────────────── */
const all   = (name, opts)         => onSupa(name) ? supa.all(name, opts)    : sheet.all(name, opts);
const list  = (name, params, opts) => onSupa(name) ? supa.list(name, params) : sheet.list(name, params, opts);
const get   = (name, id, opts)     => onSupa(name) ? supa.get(name, id)      : sheet.get(name, id, opts);
const table = (name, opts)         => onSupa(name) ? supa.all(name, opts)    : sheet.table(name, opts);

/** Always read the Google Sheet, whatever the data source — used by the
 *  Supabase backfill so it can seed from the Sheet while running on Supabase. */
const readSheet = (name, opts) => sheet.all(name, opts);

/* ── writes (with cross-store mirroring) ─────────────────────────────── */
async function insert(name, row) {
  if (onSupa(name)) {
    const r = await supa.insert(name, row);
    if (WRITE_THROUGH) { try { await sheet.insert(name, r); } catch (e) { console.warn(`[reverse-sync] insert ${name}: ${e.message}`); } }
    return r;
  }
  const r = await sheet.insert(name, row);
  if (SUPA_TABLES.has(name)) await mirror.upsert(name, r);   // forward mirror (sheet mode)
  return r;
}

async function insertMany(name, rows) {
  if (onSupa(name)) {
    const made = await supa.insertMany(name, rows);
    if (WRITE_THROUGH) { try { await sheet.insertMany(name, made); } catch (e) { console.warn(`[reverse-sync] insertMany ${name}: ${e.message}`); } }
    return made;
  }
  const made = await sheet.insertMany(name, rows);
  if (SUPA_TABLES.has(name)) await mirror.upsert(name, made);
  return made;
}

async function update(name, id, patch) {
  if (onSupa(name)) {
    const r = await supa.update(name, id, patch);
    if (WRITE_THROUGH) { try { await sheet.update(name, id, r); } catch (e) { console.warn(`[reverse-sync] update ${name}: ${e.message}`); } }
    return r;
  }
  const r = await sheet.update(name, id, patch);
  if (SUPA_TABLES.has(name)) await mirror.upsert(name, r);
  return r;
}

async function remove(name, id) {
  if (onSupa(name)) {
    const r = await supa.remove(name, id);
    if (WRITE_THROUGH) { try { await sheet.remove(name, id); } catch (e) { console.warn(`[reverse-sync] remove ${name}: ${e.message}`); } }
    return r;
  }
  const r = await sheet.remove(name, id);
  if (SUPA_TABLES.has(name)) await mirror.remove(name, id);
  return r;
}

/* ── createOrder: client (+maybe new) + project + order-log, atomic-ish ── */
async function createOrder(p = {}) {
  if (USE_SUPA) {
    // client
    let client;
    if (p.client_type === 'existing') {
      client = (await supa.get('clients', p.client_id)) || { Client_Id: p.client_id };
    } else {
      client = await supa.insert('clients', p.client || {});
      if (WRITE_THROUGH) { try { await sheet.insert('clients', client); } catch (e) { console.warn('[reverse-sync] createOrder client: ' + e.message); } }
    }

    // project — ensure it links to the client
    const projRow = { ...(p.project || {}) };
    if (!projRow.Client_Id && (client.Client_Id || p.client_id)) projRow.Client_Id = client.Client_Id || p.client_id;
    if (!projRow.Client_Name && client.Client_Name) projRow.Client_Name = client.Client_Name;
    const project = await supa.insert('projects', projRow);
    if (WRITE_THROUGH) { try { await sheet.insert('projects', project); } catch (e) { console.warn('[reverse-sync] createOrder project: ' + e.message); } }

    // order log stays on the Sheet (not a migrated table) — best effort
    let order = null;
    try {
      const { newOrderId } = require('../lib/uniqueId');
      const Order_Id = await newOrderId();
      order = await sheet.insert('order_log', {
        Order_Id,
        Project_ID  : project.Project_ID,
        Client_Id   : client.Client_Id || '',
        Client_Type : p.client_type || 'new',
        Submitted_By: p.submitted_by || 'staff',
        Submitted_At: new Date().toISOString(),
      });
    } catch (e) { console.warn('[createOrder] order_log skipped: ' + e.message); }

    return { client, project, order };
  }

  // sheet mode: Apps Script batch, then forward-mirror the new client+project
  const out = await sheet.createOrder(p);
  try {
    if (p.client_type !== 'existing' && out && out.client) await mirror.upsert('clients', out.client);
    if (out && out.project) await mirror.upsert('projects', out.project);
  } catch (e) { console.warn('[mirror] createOrder: ' + e.message); }
  return out;
}

module.exports = {
  all, list, get, table, insert, insertMany, update, remove, readSheet, createOrder,
  /* Drive + email + misc always via Apps Script */
  call: sheet.call, resolveFiles: sheet.resolveFiles,
  lookups: sheet.lookups, schema: sheet.schema, ping: sheet.ping,
  sendMail: sheet.sendMail, mailQuota: sheet.mailQuota,
  invalidate: sheet.invalidate, prewarm: sheet.prewarm, stats: sheet.stats, queueDepth: sheet.queueDepth,
  hasCredentials: sheet.hasCredentials, API_URL: sheet.API_URL, TABLES: sheet.TABLES,
  DATA_SOURCE: SRC, USE_SUPA, WRITE_THROUGH,
};
