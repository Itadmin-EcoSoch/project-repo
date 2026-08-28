/*  backend/lib/amcCreate.js  — NEW FILE
    ----------------------------------------------------------------------------
    Creating an AMC contract (plus its visits and its payment rows) used to live
    inline inside routes/amcSchedule.js, so it could only ever make ONE contract
    per request. The Solar Care flow needs to make TWO in one go — a client who
    asks for "Inspection and Cleaning" gets two separate contracts under the same
    project, each with its own visit schedule.

    So the work is lifted out here and exposed as two functions:

        createOneContract(spec)     one contract + its visits + its payments
        createSolarCareAMC(spec)    'Inspection' | 'Cleaning' | 'Both'

    Nothing about the existing routes/amcSchedule.js behaviour changes. The maths
    still comes from lib/amcSchedule.js — this file only orchestrates the writes.

    HIERARCHY THIS SITS IN
        Client  →  Project  →  AMC contract  →  visit 1, visit 2, visit 3 …
--------------------------------------------------------------------------- */

const db  = require('../db/sheets');
const amc = require('./amcSchedule');
const { toSheet, toApp, MAP } = require('./mapping');
const { newAmcId, newUniqueIds } = require('../lib/uniqueId');

/* The only two kinds of AMC EcoSoch sells. "Both" is a UI convenience that
   creates one of each — it is never stored as a contract type. */
const INSPECTION = 'Inspection';
const CLEANING   = 'Cleaning';

/**
 * 'Inspection' | 'Cleaning' | 'Both' | 'Inspection, Cleaning'  →  ['Inspection', …]
 * Written loosely on purpose: the AppSheet data has at least three spellings of
 * the both-option and they should all resolve rather than silently create nothing.
 */
function typesFor(option) {
  const s = String(option || '').trim().toLowerCase();
  if (!s || s === 'none') return [];
  const wantsInspection = s.includes('insp');
  const wantsCleaning   = s.includes('clean');
  if (s === 'both' || (wantsInspection && wantsCleaning)) return [INSPECTION, CLEANING];
  if (wantsInspection) return [INSPECTION];
  if (wantsCleaning)   return [CLEANING];
  return [];
}

/** The Add_Months tab, used for the first payment date. Never fatal. */
async function loadAddMonths() {
  try {
    return amc.buildAddMonthsTable(await db.all('add_months'));
  } catch (e) {
    console.warn('[amc] Add_Months tab unreadable:', e.message);
    return {};
  }
}

/** Normalise one per-type block from the request body into a contract spec. */
function readTypeSpec(body = {}, amcType, projectId) {
  return {
    project_id        : projectId,
    amc_type          : amcType,
    /* visits per year — this is what the user means by
       "per year how many site visits" */
    frequency         : body.visits_per_year ?? body.frequency,
    /* "for how many years" */
    period_years      : body.years ?? body.period_years,
    start_date        : body.start_date,
    status            : body.status || 'Active',
    payment_available : body.payment_available,
    payment_amount    : body.payment_amount,
    percent_increase  : body.percent_increase,
    payment_frequency : body.payment_frequency,
    payment_start_date: body.payment_start_date || '',
    /*  The Drive path of the attached contract, written to
        AMC_Contracts.AMC_Contract_Files. Per TYPE, so an Inspection and a
        Cleaning contract on the same project each keep their own document. */
    contract_file     : body.contract_file || '',
  };
}

/**
 * What WOULD be created, without writing anything. Use this to show the user
 * the visit list before they commit.
 */
async function previewSolarCareAMC(body = {}) {
  const addMonthsTable = await loadAddMonths();
  const projectId = String(body.project_id || '').trim();
  const types     = typesFor(body.amc_option ?? body.option ?? body.amc_type);

  const out = [];
  for (const type of types) {
    const block = type === INSPECTION
      ? (body.inspection || body)
      : (body.cleaning   || body);
    const spec  = readTypeSpec(block, type, projectId);
    const check = amc.validateContract(spec, { addMonthsTable });
    const plan  = amc.buildContractPlan(spec, { addMonthsTable, amcType: type });

    out.push({
      amc_type     : type,
      ok           : check.ok,
      errors       : check.errors,
      warnings     : check.warnings,
      summary      : amc.describeContract(spec),
      derived      : plan.derived,
      visit_count  : plan.tasks.length,
      payment_count: plan.payments.length,
      /* the visits, numbered — visit 1, visit 2, visit 3 … */
      visits       : plan.tasks.map((t, i) => ({
        visit_no   : i + 1,
        due_date   : t.due_date,
        description: t.description,
        status     : t.status,
      })),
      payments     : plan.payments.map((p, i) => ({
        payment_no : i + 1,
        due_date   : p.due_date,
        amount     : p.amount,
        description: p.description,
      })),
      payment_frequency_options: amc.paymentFrequencyOptions(spec.frequency),
    });
  }

  return {
    project_id : projectId,
    amc_option : types.length === 2 ? 'Both' : (types[0] || 'None'),
    contracts  : out,
    ok         : out.length > 0 && out.every(c => c.ok),
    total_visits: out.reduce((n, c) => n + c.visit_count, 0),
  };
}

/**
 * Writes one contract, then its payment rows, then its visit rows.
 *
 * Payments go first so every visit can carry the Payment_Id of the instalment
 * that covers it — same order the AppSheet app used.
 */
async function createOneContract(spec, { addMonthsTable, force = false } = {}) {
  const table = addMonthsTable || await loadAddMonths();
  const check = amc.validateContract(spec, { addMonthsTable: table });

  if (!check.ok && !force) {
    const err = new Error(check.errors.join(' '));
    err.status  = 400;
    err.details = check;
    throw err;
  }

  const d = check.derived;

  /* ── 1. the contract row ────────────────────────────────────────────── */
  const contractRow = toSheet(MAP.amc_contracts, {
    project_id    : spec.project_id,
    amc_type      : spec.amc_type,
    frequency     : spec.frequency,
    period_years  : spec.period_years,
    start_date    : spec.start_date,
    end_date      : d.end_date,
    status        : spec.status || 'Active',
    payment_amount: spec.payment_amount,
    tasks_count   : d.total_tasks,
    payments_count: d.total_payments,
    /*  Optional. Only sent when the form actually attached something, so a
        contract created without paperwork does not blank a file added later
        by hand in the sheet.                                             */
    ...(spec.contract_file ? { contract_file: spec.contract_file } : {}),
  });

  Object.assign(contractRow, {
    /*  A REAL BOOLEAN, not the string 'Y' / 'N'.

        Every one of the 117 contracts already in AMC_Contracts stores this as
        a genuine TRUE / FALSE — the same thing a checkbox writes. Writing 'Y'
        or 'N' here put a lone string into an otherwise boolean column, which
        showed up as a bare "N" sitting among TRUE and FALSE in the sheet, and
        would not have matched any of the truthiness tests the rest of the app
        applies to that column.

        Apps Script's toCell_ passes booleans through untouched, so appendRow
        writes the same value type the legacy rows hold.                     */
    Payment_Available      : truthy(spec.payment_available),
    Percent_Increase       : spec.percent_increase || 0,
    Payment_Frequency      : spec.payment_frequency || '',
    Payment_Period_in_Years: d.payment_period_years,
    Payment_Start_Date     : d.payment_start_date,
    Payment_End_Date       : d.payment_end_date,
  });

  /*  AMC_Id minted here rather than by Apps Script, so it is checked against
      every AMC_Id already in the sheet. See lib/uniqueId.js.

      { fresh: false } — takenIds defaults to fresh:true, which forces a full
      uncached re-read of AMC_Contracts for EVERY contract. The log shows both
      of them on a Both order:

          [sheets] loaded AMC_Contracts: 118 rows in 3262ms
          [sheets] loaded AMC_Contracts: 119 rows in 3000ms

      Six seconds of the save spent proving that two random 8-character ids
      out of a 62^8 keyspace are not already taken. The payment and task
      pools below already use the cache for exactly this reason.           */
  contractRow.AMC_Id = await newAmcId({ fresh: false });

  const created = await db.insert('amc_contracts', contractRow);
  const amcId   = created?.AMC_Id || contractRow.AMC_Id || '';
  if (!amcId) throw new Error('The sheet did not return an AMC_Id for the new contract.');

  const ids = {
    amcId,
    projectId: spec.project_id,
    amcType  : spec.amc_type,
    addMonthsTable: table,
  };

  /* ── 2. payments ────────────────────────────────────────────────────────
     Sequential, not Promise.all — Apps Script appends rows and is not safe to
     hit concurrently. Parallel inserts here produced interleaved, half-written
     rows during testing. */
  /*  Ids for the whole batch from ONE read per tab.

      A 5-year cleaning contract produces 5 payments and up to 120 visits.
      Minting each individually would mean 120 live reads of AMC_Tasks — at
      2-3 seconds a read that is several minutes for one contract, with the
      Apps Script lock held throughout. newUniqueIds reads once and checks
      each candidate against the sheet AND the ids already issued in this
      batch.                                                               */
  /*  generatePayments is called ONCE into a variable. Calling it inline in the
      for-of AND again for .length would generate the schedule twice, and the
      pool could be sized off a different run.                              */
  const paymentRows   = amc.generatePayments(spec, ids);
  const paymentIdPool = await newUniqueIds('amc_payments', paymentRows.length, { fresh: false });

  /*  BUILT FIRST, WRITTEN ONCE. This was `await db.insert(...)` per row
      inside the loop, which is one Apps Script round trip per payment.   */
  const paymentPayload = paymentRows.map((p, i) => {
    const row = toSheet(MAP.amc_payments, {
      amc_id     : amcId,
      amc_type   : spec.amc_type,
      amount     : p.amount,
      due_date   : p.due_date,
      description: p.description,
      status     : p.status,
    });
    row.Payment_Baseamount = p.base_amount;
    row.Payment_Id         = paymentIdPool[i];
    return row;
  });
  const payments = await db.insertMany('amc_payments', paymentPayload);

  /* ── 3. visits, each linked to the payment covering it ──────────────── */
  const visitRows = amc.generateTasks(spec, {
    ...ids,
    paymentIds: payments.map(p => p?.Payment_Id || ''),
  });

  const taskIdPool = await newUniqueIds('amc_tasks', visitRows.length, { fresh: false });

  /*  Same again: one call for every visit, not one call per visit. A
      five-year quarterly contract is 20 of these.                        */
  const visitPayload = visitRows.map((t, i) => {
    const row = toSheet(MAP.amc_tasks, {
      amc_id     : amcId,
      project_id : spec.project_id,
      amc_type   : spec.amc_type,
      due_date   : t.due_date,
      description: t.description,
      status     : t.status,
      payment_id : t.payment_id,
    });
    row.AMC_Task_Id = taskIdPool[i];
    return row;
  });
  const visits = await db.insertMany('amc_tasks', visitPayload);

  return {
    amc_id          : amcId,
    amc_type        : spec.amc_type,
    contract        : toApp(MAP.amc_contracts, created),
    derived         : d,
    visits_created  : visits.length,
    payments_created: payments.length,
    warnings        : check.warnings,
    summary         : amc.describeContract(spec),
  };
}

/**
 * The Solar Care entry point.
 *
 * body = {
 *   project_id : 'ABC123',
 *   amc_option : 'Inspection' | 'Cleaning' | 'Both',
 *   inspection : { years: 3, visits_per_year: 4, start_date: '2026-04-01', … },
 *   cleaning   : { years: 3, visits_per_year: 12, start_date: '2026-04-01', … },
 * }
 *
 * With amc_option 'Both' the two blocks are independent — a client can take
 * quarterly inspections and monthly cleaning on the same project, which is the
 * normal case.
 */
async function createSolarCareAMC(body = {}) {
  const projectId = String(body.project_id || '').trim();
  if (!projectId) {
    const e = new Error('project_id is required — an AMC always belongs to a project.');
    e.status = 400;
    throw e;
  }

  const project = await db.get('projects', projectId);
  if (!project) {
    const e = new Error(`No project found with id ${projectId}.`);
    e.status = 404;
    throw e;
  }

  const types = typesFor(body.amc_option ?? body.option ?? body.amc_type);
  if (!types.length) {
    const e = new Error('Choose Inspection, Cleaning, or Both.');
    e.status = 400;
    throw e;
  }

  const addMonthsTable = await loadAddMonths();
  const created = [];

  for (const type of types) {
    const block = type === INSPECTION ? (body.inspection || body) : (body.cleaning || body);
    const spec  = readTypeSpec(block, type, projectId);
    created.push(await createOneContract(spec, { addMonthsTable, force: body.force }));
  }

  /*  Keep the project row in step so the Projects list and the dashboard's
      "has AMC" filter both see it. AMC_Type on the project is the ROLL-UP of
      what was sold; the contracts remain the source of truth.               */
  try {
    const label = types.length === 2 ? 'Inspection, Cleaning' : types[0];
    await db.update('projects', projectId, {
      AMC_Type    : label,
      AMC_Provided: true,
    });
  } catch (e) {
    console.warn('[amc] could not stamp AMC_Type on the project:', e.message);
  }


  return {
    project_id      : projectId,
    project_name    : project.Project_Name || '',
    amc_option      : types.length === 2 ? 'Both' : types[0],
    contracts       : created,
    total_visits    : created.reduce((n, c) => n + c.visits_created, 0),
    total_payments  : created.reduce((n, c) => n + c.payments_created, 0),
  };
}

function truthy(v) {
  if (typeof v === 'boolean') return v;
  return ['y', 'yes', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());
}

module.exports = {
  INSPECTION, CLEANING,
  typesFor,
  loadAddMonths,
  previewSolarCareAMC,
  createOneContract,
  createSolarCareAMC,
};