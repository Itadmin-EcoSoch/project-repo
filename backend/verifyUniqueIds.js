/*  backend/verifyUniqueIds.js
    ============================================================================
    Two jobs in one command:

      1. VERIFY the ID-minting code is wired into every route that creates rows
      2. AUDIT the eight key columns in the sheet for duplicates and clashes

        cd backend
        node verifyUniqueIds.js

    NOTHING IS WRITTEN. Every operation is a read.

    A limit worth stating plainly: this cannot prove that a NEW row gets a
    checked id, because proving that means creating a row. Checks 1 and 2 prove
    the code is in place and correct; the manual step printed at the end proves
    it end to end when you choose to run it.
    ============================================================================  */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('./db/sheets');

let failures = 0;
const ok   = m => console.log(`  PASS   ${m}`);
const bad  = m => { failures++; console.log(`  FAIL   ${m}`); };
const info = m => console.log(`         ${m}`);

/* ── CHECK 1 — the generator ────────────────────────────────────────────── */
console.log('\nCHECK 1  lib/uniqueId.js');
let U;
try { U = require('./lib/uniqueId'); ok('module loads'); }
catch (e) { bad(`will not load — ${e.message}`); process.exit(1); }

const WANT = ['projects', 'clients', 'tickets', 'amc_contracts',
              'amc_tasks', 'amc_payments', 'order_log', 'status_log'];

for (const t of WANT) {
  U.PROFILES?.[t]
    ? ok(`profile for ${t.padEnd(14)} -> ${U.PROFILES[t].keyCol}`)
    : bad(`NO profile for ${t} — old lib/uniqueId.js still in place`);
}
typeof U.newUniqueIds === 'function'
  ? ok('newUniqueIds (bulk) is exported')
  : bad('newUniqueIds MISSING — AMC creation will mint ids one read at a time');

/* ── CHECK 2 — route wiring ─────────────────────────────────────────────── */
console.log('\nCHECK 2  every route that creates rows sets its own key');

/*  file -> [ [needle, description], ... ]
    The needles are the exact assignments, so a partially-saved file is
    caught rather than passing on the import line alone.                  */
const WIRING = [
  ['routes/projects.js',   [['newProjectId()',    'Project_ID'],
                            ['newStatusLogId()',  'Log_Id']]],
  ['routes/clients.js',    [['newClientId()',     'Client_Id']]],
  ['routes/orders.js',     [['newProjectId()',    'Project_ID (new order)'],
                            ['newClientId()',     'Client_Id (new order)']]],
  ['routes/tickets.js',    [['newTicketId()',     'Ticket_Id']]],
  ['routes/amc.js',        [['newAmcTaskId()',    'AMC_Task_Id']]],
  ['routes/amcSchedule.js',[['newAmcId()',        'AMC_Id'],
                            ['newAmcPaymentId()', 'Payment_Id'],
                            ['newAmcTaskId()',    'AMC_Task_Id']]],
  ['routes/newOrder.js',   [['newOrderId()',      'Order_Id']]],
  ['lib/amcCreate.js',     [['newAmcId()',        'AMC_Id'],
                            ['paymentIdPool',     'Payment_Id (bulk)'],
                            ['taskIdPool',        'AMC_Task_Id (bulk)']]],
];

for (const [file, needles] of WIRING) {
  let src;
  try { src = fs.readFileSync(path.join(__dirname, file), 'utf8'); }
  catch { bad(`cannot read ${file}`); continue; }
  for (const [needle, what] of needles) {
    src.includes(needle)
      ? ok(`${file.padEnd(24)} mints ${what}`)
      : bad(`${file.padEnd(24)} does NOT mint ${what} — old copy still saved`);
  }
}

/* ── CHECK 3 — audit the sheet ──────────────────────────────────────────── */
(async () => {
  console.log('\nCHECK 3  the eight key columns in the sheet  (read-only)');
  let audited = 0;

  const norm = v => String(v ?? '').trim();

  for (const table of WANT) {
    const col = U.PROFILES[table].keyCol;
    let rows;
    try { rows = await db.all(table, { fresh: true }); }
    catch (e) { info(`${table}: could not read (${e.message})`); continue; }

    const exact   = new Map();   // id           -> count
    const folded  = new Map();   // lowercase id -> Set of spellings
    const numeric = new Map();   // Number(id)   -> Set of ids
    let blank = 0, legacy = 0, minted = 0, other = 0;

    for (const r of rows) {
      if (!r) continue;
      const raw = norm(r[col]);
      if (!raw) { blank++; continue; }

      exact.set(raw, (exact.get(raw) || 0) + 1);

      const k = raw.toLowerCase();
      if (!folded.has(k)) folded.set(k, new Set());
      folded.get(k).add(raw);

      const n = Number(raw);
      if (!Number.isNaN(n)) {
        if (!numeric.has(n)) numeric.set(n, new Set());
        numeric.get(n).add(raw);
      }

      if (U.isValidId(table, raw))                    minted++;
      else if (/^[0-9a-fA-F]{8}$/.test(raw))          legacy++;
      else if (/^\d+$/.test(raw))                     legacy++;
      else                                            other++;
    }

    const dupExact  = [...exact].filter(([, n]) => n > 1);
    const dupFolded = [...folded].filter(([, s]) => s.size > 1);
    const dupNumber = [...numeric].filter(([, s]) => s.size > 1);
    const clean     = !dupExact.length && !dupFolded.length && !dupNumber.length;

    const line = `${table.padEnd(14)} ${String(rows.length).padStart(5)} rows  ` +
                 `legacy ${String(legacy).padStart(5)}  new ${String(minted).padStart(4)}  ` +
                 `blank ${String(blank).padStart(3)}`;

    /*  An empty tab is NOT a pass. Reporting "PASS ... 0 rows" for a table the
        script could not actually reach reads as a green light when nothing was
        examined — which is worse than saying so.                          */
    if (!rows.length) { info(`${line}   (empty or unreachable — nothing audited)`); continue; }
    audited++;

    clean ? ok(line) : bad(line);

    if (dupExact.length)
      info(`   EXACT DUPLICATES: ${dupExact.slice(0, 5).map(([i, n]) => `${i} x${n}`).join(', ')}`);
    if (dupFolded.length)
      info(`   CASE CLASHES: ${dupFolded.slice(0, 5).map(([k, s]) => [...s].join(' == ')).join(', ')}`);
    if (dupNumber.length)
      info(`   NUMBER CLASHES: ${dupNumber.slice(0, 5).map(([n, s]) => `${[...s].join(' == ')} -> ${n}`).join(', ')}`);
    if (other)
      info(`   ${other} id(s) match neither the legacy nor the new format`);
  }

  console.log('\n' + '-'.repeat(70));
  if (failures > 0) {
    console.log(`${failures} CHECK(S) FAILED — see the FAIL lines above.`);
  } else if (audited === 0) {
    console.log('CHECKS 1 and 2 PASSED — the code is wired into every route.');
    console.log('CHECK 3 audited NOTHING: no tab returned any rows, so this says');
    console.log('nothing yet about duplicates in your data. Confirm SHEETS_API_URL');
    console.log('and SHEETS_API_TOKEN in backend/.env, then run this again.');
  } else {
    console.log(`ALL CHECKS PASSED — every table mints checked ids, and across the`);
    console.log(`${audited} tab(s) audited no id resolves to more than one row.`);
  }
  console.log('-'.repeat(70));
  console.log('\nThe one thing this cannot prove without writing: that a NEW row gets a');
  console.log('minted id. To prove that, create one of each and look at the sheet:');
  console.log('   Set up AMC on a project  -> AMC_Id, Payment_Id, AMC_Task_Id');
  console.log('   Raise a ticket           -> Ticket_Id');
  console.log('   Add a client and project -> Client_Id, Project_ID, Log_Id');
  console.log('   Send a New Order Form    -> Order_Id');
  console.log('New ids are 8 mixed-case characters (czvO0EHv). Legacy AppSheet ids are');
  console.log('8 lowercase hex (8c5ead4f). The difference is visible at a glance.\n');

  process.exitCode = failures === 0 ? 0 : 1;
})();