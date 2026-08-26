/*  backend/checkAmcPayments.js
    ============================================================================
    Shows every row in AMC_Payment_Schedule, what column actually records that a
    payment was made, and which project each row belongs to.

        cd backend
        node checkAmcPayments.js

    Nothing is written.

    WHY THIS EXISTS
    checkPaymentPromotions.js reported 0 changes across 1,542 projects. The
    reason was not a bug in the rule — it was the data:

        · all 30 payment rows read "Pending" (28) or "Cancelled" (2)
        · NOT ONE says Paid, Received or anything equivalent
        · every one belongs to a project that is already Under or Out of
          SolarCare, never to one of the 489 Active projects

    A rule that promotes on "payments cleared" can never fire if no row is ever
    marked cleared. So the question is not "is the rule right" but "where is
    payment completion actually recorded". This prints every candidate column so
    that question can be answered from the data rather than guessed at.
    ============================================================================  */

require('dotenv').config();
const db = require('./db/sheets');

const key  = v => String(v ?? '').trim().toLowerCase();
const norm = v => String(v ?? '').trim();

(async () => {
  const [payments, contracts, projects] = await Promise.all([
    db.all('amc_payments',  { fresh: true }),
    db.all('amc_contracts', { fresh: true }),
    db.all('projects',      { fresh: true }),
  ]);

  console.log(`\n${payments.length} payment rows, ${contracts.length} contracts, ${projects.length} projects\n`);

  /* ── which columns does the tab actually have? ───────────────────────── */
  const cols = new Set();
  payments.forEach(r => r && Object.keys(r).forEach(c => cols.add(c)));
  console.log('AMC_Payment_Schedule columns:');
  console.log('  ' + [...cols].join(', ') + '\n');

  /* ── every column that might record "this was paid" ──────────────────── */
  const CANDIDATES = [...cols].filter(c =>
    /status|resolution|receipt|paid|amount|date/i.test(c));

  console.log('Columns that could record payment completion, and what is in them:');
  for (const c of CANDIDATES) {
    const vals = new Map();
    for (const r of payments) {
      if (!r) continue;
      const v = norm(r[c]) || '(blank)';
      vals.set(v, (vals.get(v) || 0) + 1);
    }
    const filled = payments.filter(r => r && norm(r[c])).length;
    console.log(`\n  ${c}   —   ${filled} of ${payments.length} rows filled`);
    [...vals].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .forEach(([v, n]) => console.log(`      ${String(n).padStart(3)}  ${v.slice(0, 60)}`));
  }

  /* ── every row, with the project it belongs to ───────────────────────── */
  const contractById = new Map(contracts.filter(Boolean).map(c => [key(c.AMC_Id), c]));
  const projectById  = new Map(projects.filter(Boolean).map(p => [key(p.Project_ID), p]));

  console.log('\n\nEvery payment row, and the project it hangs off:\n');
  console.log('  Payment_Id  Status      Due          Amount   Project      Project status');
  console.log('  ' + '-'.repeat(84));

  const statusTally = new Map();
  for (const r of payments) {
    if (!r) continue;
    const c = contractById.get(key(r.AMC_Id));
    const p = c ? projectById.get(key(c.Project_ID)) : null;
    const ps = p ? norm(p.Project_Status) : '(no project)';
    statusTally.set(ps, (statusTally.get(ps) || 0) + 1);

    console.log(
      '  ' + norm(r.Payment_Id).padEnd(12) +
      norm(r.Payment_Status).padEnd(12) +
      norm(r.Payment_Due_Date).padEnd(13) +
      String(norm(r.Payment_Amount) || '-').padStart(8) + '   ' +
      String(p ? norm(p.Project_ID) : '?').padEnd(12) + ps
    );
  }

  console.log('\nPayment rows grouped by their project\'s status:');
  [...statusTally].sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`  ${String(n).padStart(3)}  ${s}`));

  const active = statusTally.get('Active') || 0;
  console.log('\n' + '-'.repeat(72));
  console.log(active === 0
    ? 'NO payment row belongs to an Active project. The promotion rule has\n' +
      'nothing to act on until an Active project gets AMC payment rows.'
    : `${active} payment row(s) belong to Active projects — those are the ones\nthe promotion rule can act on.`);
  console.log('-'.repeat(72) + '\n');

  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });