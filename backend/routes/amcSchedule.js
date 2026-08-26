/*  backend/routes/amcSchedule.js
    ----------------------------------------------------------------------------
    AMC contracts with automatic task and payment schedule generation.

    Mount alongside the existing AMC routes in server.js:
        const amcScheduleRouter = require('./routes/amcSchedule');
        app.use('/api/amc-schedule', amcScheduleRouter);

    Endpoints
        GET  /api/amc-schedule/add-months          the live Add_Months lookup
        POST /api/amc-schedule/preview             derive + validate, write nothing
        POST /api/amc-schedule/contracts           create contract + tasks + payments
        GET  /api/amc-schedule/contracts/:id       contract with its schedules

    Everything writes to the Google Sheet through db/sheets.js — the same Apps
    Script layer the rest of the app uses. Nothing is stored anywhere else.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db  = require('../db/sheets');
const amc = require('../lib/amcSchedule');
const { toSheet, toApp, MAP } = require('../lib/mapping');
const { newAmcId, newAmcPaymentId, newAmcTaskId } = require('../lib/uniqueId');

/* ── Add_Months ──────────────────────────────────────────────────────────
   Read once per request from the Add_Months tab and handed to the engine, so
   Payment_Start_Date comes from your real data instead of an assumption.
   The sheets layer caches the tab, so this is a memory read after the first
   call. A failure here degrades to the fallback rather than failing the
   request — deriveContract reports which was used.                        */
async function loadAddMonths() {
  try {
    const rows = await db.all('add_months');
    return amc.buildAddMonthsTable(rows);
  } catch (e) {
    console.warn('[amc] could not read the Add_Months tab:', e.message);
    return {};
  }
}

/** Contract fields accepted from the client, in app-side names. */
function readContract(body = {}) {
  return {
    project_id       : body.project_id || '',
    amc_type         : body.amc_type || '',
    frequency        : body.frequency,
    period_years     : body.period_years,
    start_date       : body.start_date,
    status           : body.status || 'Active',
    payment_available: body.payment_available,
    payment_amount   : body.payment_amount,
    percent_increase : body.percent_increase,
    payment_frequency: body.payment_frequency,
    payment_start_date: body.payment_start_date || '',
  };
}

/* ── GET /add-months ─────────────────────────────────────────────────── */
router.get('/add-months', async (_req, res, next) => {
  try {
    const table = await loadAddMonths();
    res.json({
      success: true,
      data: {
        table,
        rows: Object.keys(table).length,
        key_format: '"{Payment_Frequency}: {AMC_Frequency}"',
        note: Object.keys(table).length
          ? 'Read from the Add_Months tab.'
          : 'The Add_Months tab is empty or unreadable — payment start dates will use the fallback offset.',
      },
    });
  } catch (err) { next(err); }
});

/* ── POST /preview ───────────────────────────────────────────────────────
   Derive the computed columns and generate both schedules WITHOUT writing.
   Use this to show the user what will be created before they commit.      */
router.post('/preview', async (req, res, next) => {
  try {
    const contract = readContract(req.body);
    const addMonthsTable = await loadAddMonths();

    const check = amc.validateContract(contract, { addMonthsTable });
    const plan  = amc.buildContractPlan(contract, { addMonthsTable, amcType: contract.amc_type });

    res.json({
      success: true,
      data: {
        summary       : amc.describeContract(contract),
        derived       : plan.derived,
        tasks         : plan.tasks,
        payments      : plan.payments,
        task_count    : plan.tasks.length,
        payment_count : plan.payments.length,
        errors        : check.errors,
        warnings      : check.warnings,
        ok            : check.ok,
        payment_frequency_options: amc.paymentFrequencyOptions(contract.frequency),
      },
    });
  } catch (err) { next(err); }
});

/* ── POST /contracts ─────────────────────────────────────────────────────
   Creates the contract row, then its payment rows, then its task rows —
   payments first so each task can carry the Payment_Id that covers it.    */
router.post('/contracts', async (req, res, next) => {
  try {
    const contract = readContract(req.body);
    const addMonthsTable = await loadAddMonths();

    const check = amc.validateContract(contract, { addMonthsTable });
    /* Only hard errors block. Warnings (e.g. a payment landing just past the
       contract end because of the Add_Months offset) are returned with the
       created contract so they are visible without stopping the work. */
    if (!check.ok && !req.body.force) {
      return res.status(400).json({
        success : false,
        error   : 'The contract cannot be created as entered.',
        errors  : check.errors,
        warnings: check.warnings,
        derived : check.derived,
      });
    }

    const d = check.derived;

    /* 1. the contract row */
    const contractRow = toSheet(MAP.amc_contracts, {
      project_id    : contract.project_id,
      amc_type      : contract.amc_type,
      frequency     : contract.frequency,
      period_years  : contract.period_years,
      start_date    : contract.start_date,
      end_date      : d.end_date,
      status        : contract.status,
      payment_amount: contract.payment_amount,
      tasks_count   : d.total_tasks,
      payments_count: d.total_payments,
    });

    /* Columns with no MAP entry are passed through by name — toSheet forwards
       any key that starts with a capital and contains an underscore. */
    Object.assign(contractRow, {
      /*  A REAL BOOLEAN — see the note in lib/amcCreate.js. The column holds
          genuine TRUE / FALSE on all 117 existing rows; 'Y' / 'N' put a lone
          string into it.                                                    */
      Payment_Available      : Boolean(contract.payment_available),
      Percent_Increase       : contract.percent_increase || 0,
      Payment_Frequency      : contract.payment_frequency || '',
      Payment_Period_in_Years: d.payment_period_years,
      Payment_Start_Date     : d.payment_start_date,
      Payment_End_Date       : d.payment_end_date,
      Total_AMC_Tasks        : d.total_tasks,
      Total_Payments         : d.total_payments,
      Tasks_per_Payment      : d.tasks_per_payment ?? '',
    });

    contractRow.AMC_Id = await newAmcId();
    const created = await db.insert('amc_contracts', contractRow);
    const amcId   = created?.AMC_Id || contractRow.AMC_Id || '';

    if (!amcId) throw new Error('The sheet did not return an AMC_Id for the new contract.');

    const ids = { amcId, projectId: contract.project_id, amcType: contract.amc_type, addMonthsTable };

    /* 2. payments — sequential, because each insert appends a row and the
          Apps Script layer is not safe to hit concurrently. */
    const paymentRows = amc.generatePayments(contract, ids);
    const payments = [];
    for (const p of paymentRows) {
      const row = toSheet(MAP.amc_payments, {
        amc_id     : amcId,
        amc_type   : contract.amc_type,
        amount     : p.amount,
        due_date   : p.due_date,
        description: p.description,
        status     : p.status,
      });
      row.Project_ID        = contract.project_id;
      row.Payment_Baseamount = p.base_amount;
      row.Payment_Id = await newAmcPaymentId();
      payments.push(await db.insert('amc_payments', row));
    }

    /* 3. tasks, each linked to the payment covering it */
    const taskRows = amc.generateTasks(contract, {
      ...ids,
      paymentIds: payments.map(p => p?.Payment_Id || ''),
    });

    const tasks = [];
    for (const t of taskRows) {
      const row = toSheet(MAP.amc_tasks, {
        amc_id     : amcId,
        project_id : contract.project_id,
        amc_type   : contract.amc_type,
        due_date   : t.due_date,
        description: t.description,
        status     : t.status,
        payment_id : t.payment_id,
      });
      row.AMC_Task_Id = await newAmcTaskId();
      tasks.push(await db.insert('amc_tasks', row));
    }

    db.invalidate('amc_contracts');
    db.invalidate('amc_tasks');
    db.invalidate('amc_payments');

    res.status(201).json({
      success: true,
      data: {
        amc_id       : amcId,
        contract     : toApp(MAP.amc_contracts, created),
        derived      : d,
        tasks_created: tasks.length,
        payments_created: payments.length,
        warnings     : check.warnings,
        summary      : amc.describeContract(contract),
      },
    });
  } catch (err) {
    console.error('[amc] contract creation failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ── GET /contracts/:id ──────────────────────────────────────────────── */
router.get('/contracts/:id', async (req, res, next) => {
  try {
    const row = await db.get('amc_contracts', req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Contract not found' });

    const [allTasks, allPayments] = await Promise.all([
      db.all('amc_tasks'),
      db.all('amc_payments'),
    ]);

    const mine = rows => rows.filter(r => String(r.AMC_Id || '').trim() === String(req.params.id).trim());
    const byDate = (a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''));

    res.json({
      success: true,
      data: {
        contract: toApp(MAP.amc_contracts, row),
        tasks   : mine(allTasks).map(r => toApp(MAP.amc_tasks, r)).sort(byDate),
        payments: mine(allPayments).map(r => toApp(MAP.amc_payments, r)).sort(byDate),
      },
    });
  } catch (err) { next(err); }
});

/* ── GET /by-project/:projectId ──────────────────────────────────────────
   Every AMC contract on a project, each with its visit counts. This is what
   the project screen needs: two rows (Inspection, Cleaning), not 28 loose
   visits. Drill into a contract to see its visits.                        */
router.get('/by-project/:projectId', async (req, res, next) => {
  try {
    const pid = String(req.params.projectId).trim();

    const [contracts, tasks, payments] = await Promise.all([
      db.all('amc_contracts'),
      db.all('amc_tasks'),
      db.all('amc_payments'),
    ]);

    const mine = rows => rows.filter(r => String(r.Project_ID || '').trim() === pid);
    const myContracts = mine(contracts);
    const myTasks     = mine(tasks);

    /*  Older rows written by AppSheet carry AMC_Type but not always AMC_Id, so
        tasks are matched on the id when there is one and fall back to the type.
        Without the fallback a Cleaning contract shows zero visits.        */
    function tasksFor(c) {
      const id   = String(c.AMC_Id || '').trim();
      const type = String(c.AMC_Type || '').trim().toLowerCase();
      return myTasks.filter(t => {
        const tid = String(t.AMC_Id || '').trim();
        if (id && tid && tid === id) return true;
        if (id && tid) return false;
        return type && String(t.AMC_Type || '').trim().toLowerCase() === type;
      });
    }

    const done = t => /done|complete/i.test(String(t.AMC_Task_Status || t.Status || ''));

    const out = myContracts.map(c => {
      const ts = tasksFor(c).sort((a, b) =>
        String(a.AMC_Due_Date || '').localeCompare(String(b.AMC_Due_Date || '')));
      const completed = ts.filter(done).length;
      const next = ts.find(t => !done(t));

      return {
        amc_id      : c.AMC_Id,
        amc_type    : c.AMC_Type,
        status      : c.AMC_Status,
        frequency   : c.AMC_Frequency,
        period_years: c.AMC_Period_in_Years,
        start_date  : c.AMC_Start_Date,
        end_date    : c.AMC_End_Date,
        payment_available: c.Payment_Available,
        payment_amount   : c.Payment_Amount,
        payment_frequency: c.Payment_Frequency,
        total_visits    : ts.length,
        completed_visits: completed,
        pending_visits  : ts.length - completed,
        next_visit_date : next ? next.AMC_Due_Date : null,
        payments_count  : mine(payments).filter(p =>
          String(p.AMC_Id || '').trim() === String(c.AMC_Id || '').trim()).length,
      };
    });

    res.json({ success: true, data: out });
  } catch (err) { next(err); }
});

/* ── GET /contracts/:id/visits ──────────────────────────────────────────
   The visits under one contract, oldest first.                          */
router.get('/contracts/:id/visits', async (req, res, next) => {
  try {
    const id = String(req.params.id).trim();
    const contract = await db.get('amc_contracts', id);
    if (!contract) return res.status(404).json({ success: false, error: 'Contract not found' });

    const all  = await db.all('amc_tasks');
    const type = String(contract.AMC_Type || '').trim().toLowerCase();

    const visits = all.filter(t => {
      const tid = String(t.AMC_Id || '').trim();
      if (tid && tid === id) return true;
      if (tid) return false;
      return String(t.Project_ID || '').trim() === String(contract.Project_ID || '').trim()
          && String(t.AMC_Type || '').trim().toLowerCase() === type;
    }).sort((a, b) => String(a.AMC_Due_Date || '').localeCompare(String(b.AMC_Due_Date || '')));

    const done = t => /done|complete/i.test(String(t.AMC_Task_Status || ''));

    res.json({
      success: true,
      data: {
        contract: {
          amc_id: contract.AMC_Id, amc_type: contract.AMC_Type,
          status: contract.AMC_Status, frequency: contract.AMC_Frequency,
          period_years: contract.AMC_Period_in_Years,
          start_date: contract.AMC_Start_Date, end_date: contract.AMC_End_Date,
          project_id: contract.Project_ID, project_name: contract.Project_Name,
          payment_available: contract.Payment_Available,
        },
        visits: visits.map((t, i) => ({
          task_id    : t.AMC_Task_Id,
          index      : i + 1,
          description: t.AMC_Description,
          due_date   : t.AMC_Due_Date,
          status     : t.AMC_Task_Status || 'Pending',
          resolution : t.AMC_Resolution,
          report     : t.AMC_Task_Report,
          amc_type   : t.AMC_Type,
        })),
        total_visits    : visits.length,
        completed_visits: visits.filter(done).length,
        pending_visits  : visits.filter(t => !done(t)).length,
      },
    });
  } catch (err) { next(err); }
});

/* ── GET /visits/:taskId — one visit, with its contract and project ───────
   AMCVisit used to pull the whole task list and search it client-side. This
   fetches the single row instead.                                          */
router.get('/visits/:taskId', async (req, res, next) => {
  try {
    const t = await db.get('amc_tasks', req.params.taskId);
    if (!t) return res.status(404).json({ success: false, error: 'Visit not found' });

    let contract = null;
    if (t.AMC_Id) { try { contract = await db.get('amc_contracts', t.AMC_Id); } catch (e) {} }

    let projectName = t.Project_Name || contract?.Project_Name || null;
    const pid = t.Project_ID || contract?.Project_ID || null;
    if (!projectName && pid) {
      try { projectName = (await db.get('projects', pid))?.Project_Name || null; } catch (e) {}
    }

    res.json({
      success: true,
      data: {
        task_id     : t.AMC_Task_Id,
        description : t.AMC_Description,
        due_date    : t.AMC_Due_Date,
        status      : t.AMC_Task_Status || 'Pending',
        resolution  : t.AMC_Resolution,
        report      : t.AMC_Task_Report,
        amc_type    : t.AMC_Type,
        amc_id      : t.AMC_Id,
        payment_id  : t.Payment_Id,
        project_id  : pid,
        project_name: projectName,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;