/*  backend/routes/amc.js — Google Sheets edition
    AMC_Tasks_Schedule links to AMC_Contracts via AMC_Id,
    and AMC_Contracts links to Projects via Project_ID.                    */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const { MAP, toApp, toSheet } = require('../lib/mapping');
const { newAmcTaskId } = require('../lib/uniqueId');

/* GET /api/amc?project_id=&status=&limit= */
router.get('/', async (req, res, next) => {
  try {
    const { project_id, status, limit = 200, fresh } = req.query;

    const [tasksRes, contractsRes, projectsRes, clientsRes] = await Promise.all([
      db.list('amc_tasks', {
        where: status ? { AMC_Task_Status: status } : undefined,
        sort : 'AMC_Due_Date', order: 'asc',
      }, { fresh: fresh === '1' }),
      db.list('amc_contracts', { fields: 'AMC_Id,Project_ID,AMC_Type,AMC_Status' }),
      db.list('projects',      { fields: 'Project_ID,Project_Name,Client_Id,Client_Name' }),
      db.list('clients',       { fields: 'Client_Id,Client_Name' }),
    ]);

    /*  Key on a trimmed, lower-cased id. The AppSheet-era Project_IDs are hex
        strings that appear as E994221D in one tab and e994221d in another, and
        an exact-string Map lookup silently misses on that — which shows up as a
        blank Project column rather than as an error.                        */
    const key = v => String(v ?? '').trim().toLowerCase();

    const projByAmc = new Map(contractsRes.data.map(c => [key(c.AMC_Id), key(c.Project_ID)]));
    const projById  = new Map(projectsRes.data.map(p => [key(p.Project_ID), p]));

    let rows = tasksRes.data.map(t => {
      /* prefer the task's own Project_ID, else go via its contract */
      const direct = key(t.Project_ID);
      const pid    = direct || projByAmc.get(key(t.AMC_Id)) || null;
      const p      = pid ? projById.get(pid) : null;
      return {
        ...toApp(MAP.amc_tasks, t),
        project_id: p ? p.Project_ID : (t.Project_ID || null),
        projects: p ? { id: p.Project_ID, name: p.Project_Name,
                        clients: { name: p.Client_Name } } : null,
      };
    });

    if (project_id) rows = rows.filter(r => key(r.project_id) === key(project_id));

    const total = rows.length;
    rows = rows.slice(0, Number(limit));

    res.json({ success: true, total, data: rows });
  } catch (err) { next(err); }
});

/* GET /api/amc/contracts?project_id= */
router.get('/contracts', async (req, res, next) => {
  try {
    const { project_id } = req.query;
    const { data, total } = await db.list('amc_contracts', {
      where: project_id ? { Project_ID: String(project_id) } : undefined,
      sort : 'AMC_Start_Date', order: 'desc',
    });
    res.json({ success: true, total, data: data.map(r => toApp(MAP.amc_contracts, r)) });
  } catch (err) { next(err); }
});

/* GET /api/amc/payments?amc_id= */
router.get('/payments', async (req, res, next) => {
  try {
    const { amc_id } = req.query;
    const { data, total } = await db.list('amc_payments', {
      where: amc_id ? { AMC_Id: String(amc_id) } : undefined,
      sort : 'Payment_Due_Date', order: 'asc',
    });
    res.json({ success: true, total, data: data.map(r => toApp(MAP.amc_payments, r)) });
  } catch (err) { next(err); }
});

/* POST /api/amc — new AMC task */
router.post('/', async (req, res, next) => {
  try {
    const row = toSheet(MAP.amc_tasks, req.body);
    /*  Minted in Node and checked against the sheet — see lib/uniqueId.js.
        Apps Script's hex8_() does not look at existing ids.               */
    row.AMC_Task_Id = await newAmcTaskId();
    row.AMC_Task_Status = row.AMC_Task_Status || 'Pending';
    const saved = await db.insert('amc_tasks', row);
    res.status(201).json({ success: true, data: toApp(MAP.amc_tasks, saved) });
  } catch (err) { next(err); }
});

/* PATCH /api/amc/:id */
router.patch('/:id', async (req, res, next) => {
  try {
    const patch = toSheet(MAP.amc_tasks, req.body);
    delete patch.AMC_Task_Id;
    const saved = await db.update('amc_tasks', req.params.id, patch);
    res.json({ success: true, data: toApp(MAP.amc_tasks, saved) });
  } catch (err) { next(err); }
});

/* DELETE /api/amc/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    await db.remove('amc_tasks', req.params.id);
    res.json({ success: true, message: 'AMC task deleted' });
  } catch (err) { next(err); }
});

module.exports = router;