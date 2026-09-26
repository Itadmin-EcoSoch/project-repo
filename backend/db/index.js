/*  backend/db/index.js  — data-source facade
    ----------------------------------------------------------------------------
    Every route imports the DB through here. It picks the data source and keeps
    both stores in step:

      DATA_SOURCE=sheet     (default)  reads/writes the Google Sheet (Apps
                                       Script) and forward-mirrors each write
                                       into Supabase (the live replica).

      DATA_SOURCE=supabase             reads/writes Supabase (fast Postgres) and
                                       — when SHEET_WRITE_THROUGH=true — reverse-
                                       mirrors each write back into the Google
                                       Sheet, so the Sheet stays usable elsewhere.

    Drive file uploads/links and email always stay on Apps Script (delegated to
    ./sheets), regardless of the data source.
--------------------------------------------------------------------------- */

const sheet  = require('./sheets');            // Apps Script (Google Sheet)
const supa   = require('./supabase');          // Supabase (PostgREST)
const mirror = require('../lib/supabaseSync');  // forward mirror (sheet -> supabase)

const SRC          = (process.env.DATA_SOURCE || 'sheet').toLowerCase();
const USE_SUPA     = SRC === 'supabase';
const WRITE_THROUGH = String(process.env.SHEET_WRITE_THROUGH || 'false').toLowerCase() === 'true';

console.log(`[db] DATA_SOURCE=${SRC}` + (USE_SUPA ? ` (sheet write-through: ${WRITE_THROUGH})` : ' (mirroring to Supabase)'));

/* ── reads ───────────────────────────────────────────────────────────── */
const all   = (name, opts)         => USE_SUPA ? supa.all(name, opts)      : sheet.all(name, opts);
const list  = (name, params, opts) => USE_SUPA ? supa.list(name, params)   : sheet.list(name, params, opts);
const get   = (name, id, opts)     => USE_SUPA ? supa.get(name, id)        : sheet.get(name, id, opts);
const table = (name, opts)         => USE_SUPA ? supa.all(name, opts)      : sheet.table(name, opts);

/** Always read from the Google Sheet, whatever the data source — used by the
 *  Supabase backfill so it can seed from the Sheet even while running on
 *  Supabase. */
const readSheet = (name, opts) => sheet.all(name, opts);

/* ── writes (with cross-store mirroring) ─────────────────────────────── */
async function insert(name, row) {
  if (USE_SUPA) {
    const r = await supa.insert(name, row);
    if (WRITE_THROUGH) { try { await sheet.insert(name, r); } catch (e) { console.warn(`[reverse-sync] insert ${name}: ${e.message}`); } }
    return r;
  }
  const r = await sheet.insert(name, row);
  await mirror.upsert(name, r);
  return r;
}

async function insertMany(name, rows) {
  if (USE_SUPA) {
    const made = await supa.insertMany(name, rows);
    if (WRITE_THROUGH) { try { await sheet.insertMany(name, made); } catch (e) { console.warn(`[reverse-sync] insertMany ${name}: ${e.message}`); } }
    return made;
  }
  const made = await sheet.insertMany(name, rows);
  await mirror.upsert(name, made);
  return made;
}

async function update(name, id, patch) {
  if (USE_SUPA) {
    const r = await supa.update(name, id, patch);
    if (WRITE_THROUGH) { try { await sheet.update(name, id, r); } catch (e) { console.warn(`[reverse-sync] update ${name}: ${e.message}`); } }
    return r;
  }
  const r = await sheet.update(name, id, patch);
  await mirror.upsert(name, r);
  return r;
}

async function remove(name, id) {
  if (USE_SUPA) {
    const r = await supa.remove(name, id);
    if (WRITE_THROUGH) { try { await sheet.remove(name, id); } catch (e) { console.warn(`[reverse-sync] remove ${name}: ${e.message}`); } }
    return r;
  }
  const r = await sheet.remove(name, id);
  await mirror.remove(name, id);
  return r;
}

module.exports = {
  /* switched data ops */
  all, list, get, table, insert, insertMany, update, remove, readSheet,
  /* Drive + email + misc always via Apps Script */
  call: sheet.call, resolveFiles: sheet.resolveFiles,
  createOrder: sheet.createOrder, lookups: sheet.lookups, schema: sheet.schema, ping: sheet.ping,
  sendMail: sheet.sendMail, mailQuota: sheet.mailQuota,
  invalidate: sheet.invalidate, prewarm: sheet.prewarm, stats: sheet.stats, queueDepth: sheet.queueDepth,
  hasCredentials: sheet.hasCredentials, API_URL: sheet.API_URL, TABLES: sheet.TABLES,
  /* flags for callers/health */
  DATA_SOURCE: SRC, USE_SUPA, WRITE_THROUGH,
};
