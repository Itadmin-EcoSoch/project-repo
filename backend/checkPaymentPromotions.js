/*  backend/checkPaymentPromotions.js
    ============================================================================
    What WOULD happen if the payment-promotion rule ran over every project.

        cd backend
        node checkPaymentPromotions.js            report only, writes nothing
        node checkPaymentPromotions.js --apply    actually write the changes

    Report mode is the default, and deliberately so. This rule changes
    Project_Status, which drives the Solar Care dashboard, the defaulter emails
    and the client's Defaulter flag. A sweep across 1,542 projects that silently
    re-statused a few hundred of them would be very hard to unpick, so the
    default is to show the list and let a person read it first.

    It also prints the distinct Payment_Status spellings it found, because the
    rule keys on those words and the tab is hand-maintained. If a spelling
    appears there that the rule does not recognise, that is worth knowing
    BEFORE anything is written.
    ============================================================================  */

require('dotenv').config();
const db = require('./db/sheets');
const { decide, isPaid, isCancelled, SOURCE, DEFAULT_TO, PROMOTE_TO, GRACE_DAYS }
  = require('./lib/paymentPromotion');

const APPLY = process.argv.includes('--apply');
const key   = v => String(v ?? '').trim().toLowerCase();

(async () => {
  console.log(`\nPayment promotion rule — ${APPLY ? 'APPLY MODE (will write)' : 'report only, nothing will be written'}`);
  console.log(`  source      : ${SOURCE}`);
  console.log(`  cleared  -> : ${PROMOTE_TO}`);
  console.log(`  overdue  -> : ${DEFAULT_TO}`);
  console.log(`  grace days  : ${GRACE_DAYS}\n`);

  const [projects, contracts, payments, look] = await Promise.all([
    db.all('projects',      { fresh: true }),
    db.all('amc_contracts', { fresh: true }),
    db.all('amc_payments',  { fresh: true }),
    db.lookups().catch(() => null),
  ]);
  const base = look?.Project_Status?.length ? look.Project_Status : undefined;

  /* ── the vocabulary actually in the sheet ───────────────────────────── */
  const spellings = new Map();
  for (const p of payments) {
    if (!p) continue;
    const s = String(p.Payment_Status ?? '').trim() || '(blank)';
    spellings.set(s, (spellings.get(s) || 0) + 1);
  }
  console.log('Payment_Status spellings in AMC_Payment_Schedule:');
  for (const [s, n] of [...spellings].sort((a, b) => b[1] - a[1])) {
    const how = s === '(blank)' ? 'treated as UNPAID'
      : isCancelled(s) ? 'ignored (cancelled)'
      : isPaid(s)      ? 'counts as PAID'
      : 'treated as UNPAID';
    console.log(`  ${String(n).padStart(4)}  ${s.padEnd(16)} ${how}`);
  }
  console.log('');

  /* ── index ──────────────────────────────────────────────────────────── */
  const byProject = new Map();
  for (const c of contracts) {
    if (!c) continue;
    const k = key(c.Project_ID);
    if (!k) continue;
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k).push(c);
  }
  const byAmc = new Map();
  for (const p of payments) {
    if (!p) continue;
    const k = key(p.AMC_Id);
    if (!k) continue;
    if (!byAmc.has(k)) byAmc.set(k, []);
    byAmc.get(k).push(p);
  }

  const promote = [], toDefault = [], blocked = [];
  const reasons = new Map();

  for (const row of projects) {
    if (!row) continue;
    const mine = byProject.get(key(row.Project_ID)) || [];
    const pays = mine.flatMap(c => byAmc.get(key(c.AMC_Id)) || []);

    const d = decide(row, { contracts: mine, payments: pays, base });

    if (d.action === 'none') {
      reasons.set(d.reason, (reasons.get(d.reason) || 0) + 1);
      continue;
    }
    const entry = { id: row.Project_ID, name: String(row.Project_Name || '').slice(0, 44),
                    from: row.Project_Status, to: d.to, why: d.reason };
    if (!d.allowed)                 blocked.push(entry);
    else if (d.action === 'promote') promote.push(entry);
    else                             toDefault.push(entry);
  }

  const show = (title, list) => {
    console.log(`${title}: ${list.length}`);
    list.slice(0, 15).forEach(e =>
      console.log(`   ${String(e.id).padEnd(10)} ${e.name.padEnd(46)} ${e.from} -> ${e.to}\n        ${e.why}`));
    if (list.length > 15) console.log(`   ...and ${list.length - 15} more`);
    console.log('');
  };

  show(`WOULD PROMOTE to ${PROMOTE_TO}`, promote);
  show(`WOULD DEFAULT to ${DEFAULT_TO}`, toDefault);
  show('WOULD ACT, but the status rules block it', blocked);

  console.log('LEFT ALONE, by reason:');
  for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${String(n).padStart(5)}  ${why}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('-'.repeat(72));
    console.log(`Nothing was written. ${promote.length + toDefault.length} project(s) would change.`);
    console.log('Read the lists above, then re-run with --apply to write them.');
    console.log('-'.repeat(72) + '\n');
    return process.exit(0);
  }

  /* ── apply ──────────────────────────────────────────────────────────── */
  console.log(`Applying ${promote.length + toDefault.length} change(s)...\n`);
  let done = 0, failed = 0;
  for (const e of [...promote, ...toDefault]) {
    try {
      await db.update('projects', e.id, { Project_Status: e.to });
      /*  Status_Log keeps the audit trail the app writes for a manual edit —
          a sweep that changed statuses invisibly would leave nobody able to
          answer "why is this project Defaulted?".                        */
      await db.insert('status_log', {
        Log_Id    : (await require('./lib/uniqueId').newStatusLogId()),
        Project_ID: e.id, Old_Status: e.from, New_Status: e.to,
        Changed_By: 'payment-promotion-sweep',
        Note      : e.why,
        Changed_At: new Date().toISOString(),
      }).catch(() => {});
      done++;
      console.log(`   ok    ${e.id}  ${e.from} -> ${e.to}`);
    } catch (err) {
      failed++;
      console.log(`   FAIL  ${e.id}  ${err.message}`);
    }
  }
  console.log(`\n${done} written, ${failed} failed.\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });