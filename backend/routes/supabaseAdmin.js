/*  backend/routes/supabaseAdmin.js
    ----------------------------------------------------------------------------
    One-time (or on-demand) backfill of the whole Google Sheet into Supabase.
    The live mirror in db/sheets.js only fires on new writes, so this seeds the
    tables that already have data.

        POST /api/supabase/backfill            all mirrored tabs
        POST /api/supabase/backfill?table=projects   just one

    Admin / Super Admin only. Upserts in chunks so a big tab is one-ish request.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db   = require('../db/sheets');
const supa = require('../lib/supabaseSync');
const { requireRole } = require('../middleware/auth');

const CHUNK = 400;

router.post('/backfill', requireRole('Admin', 'Super Admin'), async (req, res, next) => {
  try {
    if (!supa.ENABLED) {
      return res.status(400).json({
        success: false,
        error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY, then redeploy.',
      });
    }

    const only = String(req.query.table || '').trim();
    const tables = only ? [only] : supa.MIRRORED;
    const result = {};

    for (const key of tables) {
      if (!supa.MIRRORED.includes(key)) { result[key] = { error: 'not a mirrored table' }; continue; }
      const rows = await db.all(key, { fresh: true });
      let done = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await supa.upsert(key, rows.slice(i, i + CHUNK));
        done += Math.min(CHUNK, rows.length - i);
      }
      result[key] = { rows: rows.length, upserted: done };
    }

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
