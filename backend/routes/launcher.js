/*  backend/routes/launcher.js — Google Sheets edition
    The Launcher tab is keyed by App_Id.                                    */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const { MAP, toApp, toSheet } = require('../lib/mapping');

const asLauncher = r => {
  const l = toApp(MAP.launcher, r);
  return {
    ...l,
    launcher_id: l.id,
    status     : 'Active',
    // "admin,superadmin" → ['admin','superadmin'] so role filtering is easy
    roles      : String(l.role_restrictions || '').split(',').map(s => s.trim()).filter(Boolean),
  };
};

/* GET /api/launcher?role= */
router.get('/', async (req, res, next) => {
  try {
    const { role, fresh } = req.query;
    const { data, total } = await db.list('launcher', {
      sort: 'Display_Order', order: 'asc',
    }, { fresh: fresh === '1' });

    let rows = data.filter(r => r.App_Id).map(asLauncher);
    if (role) {
      const want = String(role).trim().toLowerCase();
      rows = rows.filter(l => !l.roles.length || l.roles.some(r => r.toLowerCase() === want));
    }
    res.json({ success: true, count: rows.length, total, data: rows });
  } catch (err) { next(err); }
});

/* GET /api/launcher/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.get('launcher', decodeURIComponent(req.params.id));
    if (!row) return res.status(404).json({ success: false, error: 'Launcher tile not found' });
    res.json({ success: true, data: asLauncher(row) });
  } catch (err) { next(err); }
});

/* POST /api/launcher */
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = b.title || b.App_Name;
    if (!title) return res.status(400).json({ success: false, error: 'Title is required' });

    const row = toSheet(MAP.launcher, b);
    row.App_Id = b.launcherId || b.id || b.App_Id ||
                 `${String(title).replace(/[^A-Za-z0-9]/g, '')}-${Date.now().toString().slice(-7)}`;

    if (row.Display_Order === undefined || row.Display_Order === null || row.Display_Order === '') {
      const all = await db.list('launcher', { fields: 'Display_Order' });
      const max = all.data.reduce((m, r) => Math.max(m, Number(r.Display_Order) || 0), 0);
      row.Display_Order = max + 1;
    }
    if (Array.isArray(row.User_Role)) row.User_Role = row.User_Role.join(',');

    const saved = await db.insert('launcher', row);
    res.status(201).json({ success: true, message: 'Launcher created', data: asLauncher(saved) });
  } catch (err) { next(err); }
});

/* PUT / PATCH /api/launcher/:id */
async function updateLauncher(req, res, next) {
  try {
    const patch = toSheet(MAP.launcher, req.body || {});
    delete patch.App_Id;
    if (Array.isArray(patch.User_Role)) patch.User_Role = patch.User_Role.join(',');

    const saved = await db.update('launcher', decodeURIComponent(req.params.id), patch);
    res.json({ success: true, message: 'Launcher updated', data: asLauncher(saved) });
  } catch (err) { next(err); }
}

router.put('/:id',   updateLauncher);
router.patch('/:id', updateLauncher);

/* DELETE /api/launcher/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    await db.remove('launcher', decodeURIComponent(req.params.id));
    res.json({ success: true, message: 'Launcher deleted' });
  } catch (err) { next(err); }
});

module.exports = router;