/*  backend/checkStatusRules.js
    ============================================================================
    Runs the Project_Status Valid_If rules over EVERY project in the sheet and
    reports which rule each one lands on, with real Project_IDs you can open in
    the app to see the behaviour.

        cd backend
        node checkStatusRules.js

        node checkStatusRules.js 99C46486      # explain ONE project in detail

    Nothing is written. This script only reads.

    Why this exists: made-up examples prove nothing. The rules depend on how
    AMC_Contracts and AMC_Payment_Schedule actually look for a given project,
    so the only way to see rule 2 or rule 3 fire is to find a project whose
    data really triggers it.

    The five rules, in priority order:
      1  no Project_Status stored yet          -> only "Active"
      2  AMC on, some payment has no amount    -> base list
      3  AMC on, types promised != active contracts -> base list
      4  Project_Type EPC / I&C / AMC          -> base + "Under SolarCare"
      5  Project_Type Consultancy              -> base + "Completed"
      0  no rule matched (e.g. Retail)         -> base list, see status.js
    ============================================================================  */

require('dotenv').config();
const db = require('./db/sheets');
const { projectStatusOptions, countAmcTypes } = require('./lib/status');

const RULE_LABEL = {
  1: 'New project — only "Active" allowed',
  2: 'AMC payment missing an amount — blocks Under SolarCare',
  3: 'AMC types do not match active contracts — blocks Under SolarCare',
  4: 'EPC / I&C / AMC — Under SolarCare available',
  5: 'Consultancy — Completed available',
  0: 'No rule matched (Project_Type not covered by the AppSheet expression)',
};

const yes = v => v === true || /^(y|yes|true|1)$/i.test(String(v ?? '').trim());

async function load() {
  const [p, c, pay] = await Promise.all([
    db.all('projects',      { fresh: true }),
    db.all('amc_contracts', { fresh: true }),
    db.all('amc_payments',  { fresh: true }),
  ]);

  // contracts and payments indexed for O(1) lookup per project
  const byProject = new Map();          // Project_ID -> contract rows
  for (const r of c) {
    if (!r) continue;
    const k = String(r.Project_ID ?? '').trim().toLowerCase();
    if (!k) continue;
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k).push(r);
  }
  const byAmc = new Map();              // AMC_Id -> payment rows
  for (const r of pay) {
    if (!r) continue;
    const k = String(r.AMC_Id ?? '').trim().toLowerCase();
    if (!k) continue;
    if (!byAmc.has(k)) byAmc.set(k, []);
    byAmc.get(k).push(r);
  }
  return { projects: p.filter(Boolean), byProject, byAmc };
}

function contextFor(row, byProject, byAmc) {
  const pid       = String(row.Project_ID ?? '').trim().toLowerCase();
  const contracts = byProject.get(pid) || [];
  const payments  = contracts.flatMap(
    c => byAmc.get(String(c.AMC_Id ?? '').trim().toLowerCase()) || []
  );
  return {
    isNew      : !String(row.Project_Status ?? '').trim(),
    projectType: row.Project_Type,
    amcProvided: row.AMC_Provided,
    amcType    : row.AMC_Type,
    contracts, payments,
  };
}

/* ── detail mode: explain one project ─────────────────────────────────── */
async function explainOne(wanted) {
  const { projects, byProject, byAmc } = await load();
  const row = projects.find(
    r => String(r.Project_ID ?? '').trim().toLowerCase() === wanted.trim().toLowerCase()
  );
  if (!row) return console.log(`No project with Project_ID "${wanted}".`);

  const ctx = contextFor(row, byProject, byAmc);
  const res = projectStatusOptions(ctx);
  const activeContracts = ctx.contracts.filter(
    c => String(c.AMC_Status ?? '').trim().toLowerCase() === 'active'
  );
  const blankPayments = ctx.payments.filter(p => {
    const v = p.Payment_Amount;
    return v === null || v === undefined || String(v).trim() === '' || Number(v) === 0;
  });

  console.log(`\nPROJECT  ${row.Project_ID}  ${row.Project_Name || ''}`);
  console.log(`  Project_Type   : ${row.Project_Type || '(blank)'}`);
  console.log(`  Project_Status : ${row.Project_Status || '(blank)'}`);
  console.log(`  AMC_Provided   : ${row.AMC_Provided ?? '(blank)'}  -> ${yes(row.AMC_Provided) ? 'rules 2 and 3 apply' : 'rules 2 and 3 SKIPPED'}`);
  console.log(`  AMC_Type       : ${row.AMC_Type || '(blank)'}  -> ${countAmcTypes(row.AMC_Type)} type(s) promised`);
  console.log(`  AMC_Contracts  : ${ctx.contracts.length} row(s), ${activeContracts.length} Active`);
  ctx.contracts.forEach(c => console.log(`      ${c.AMC_Id}  ${String(c.AMC_Type || '').padEnd(14)} ${c.AMC_Status || ''}`));
  console.log(`  Payments       : ${ctx.payments.length} row(s), ${blankPayments.length} with no amount`);
  ctx.payments.slice(0, 8).forEach(p =>
    console.log(`      ${p.Payment_Id}  AMC ${p.AMC_Id}  amount=${p.Payment_Amount === '' || p.Payment_Amount == null ? '(blank)' : p.Payment_Amount}`));
  if (ctx.payments.length > 8) console.log(`      ...and ${ctx.payments.length - 8} more`);

  console.log(`\n  RESULT`);
  console.log(`    rule matched : ${res.rule}  — ${RULE_LABEL[res.rule]}`);
  console.log(`    reason       : ${res.reason}`);
  console.log(`    options      : ${res.options.join(', ')}`);
  console.log('');
}

/* ── survey mode: bucket every project ────────────────────────────────── */
async function surveyAll() {
  const { projects, byProject, byAmc } = await load();
  console.log(`Scanned ${projects.length} projects.\n`);

  const buckets = new Map();
  for (const row of projects) {
    const res = projectStatusOptions(contextFor(row, byProject, byAmc));
    if (!buckets.has(res.rule)) buckets.set(res.rule, []);
    buckets.get(res.rule).push({ row, res });
  }

  for (const rule of [1, 2, 3, 4, 5, 0]) {
    const hits = buckets.get(rule) || [];
    console.log(`RULE ${rule} — ${RULE_LABEL[rule]}`);
    console.log(`  ${hits.length} project(s)`);
    if (!hits.length) {
      console.log('  (no project in your sheet currently lands here)\n');
      continue;
    }
    hits.slice(0, 5).forEach(({ row, res }) => {
      const name = String(row.Project_Name || '').slice(0, 46);
      console.log(`      ${String(row.Project_ID).padEnd(10)} ${name.padEnd(48)} ${row.Project_Type || ''}`);
      console.log(`          ${res.reason}`);
      console.log(`          http://localhost:5173/projects/${row.Project_ID}`);
    });
    if (hits.length > 5) console.log(`      ...and ${hits.length - 5} more`);
    console.log('');
  }

  console.log('Open any URL above and press Edit to see that rule in the status dropdown.');
  console.log('For a full breakdown of one project:  node checkStatusRules.js <Project_ID>');
}

(async () => {
  const arg = process.argv[2];
  if (arg) await explainOne(arg);
  else     await surveyAll();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });