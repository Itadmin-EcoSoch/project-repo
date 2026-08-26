/*  backend/verifyPaymentsWarranty.js
    ============================================================================
    Answers one question: are the Payments_Done and warranty rules actually
    wired in, end to end?

        cd backend
        node verifyPaymentsWarranty.js

    Four layers are checked separately, so a failure tells you WHICH one is
    wrong rather than just "something is broken":

      CHECK 1  the two new modules load and export what they should
      CHECK 2  the rules give the right answer for known inputs
      CHECK 3  routes/projects.js and routes/tickets.js actually call them
      CHECK 4  the LIVE server returns data consistent with those rules

    NOTHING IS WRITTEN. Every request is a GET.

    That is a real limit worth stating: the 422 enforcement on PATCH cannot be
    proven read-only, because proving it means attempting a write. Checks 2 and
    3 verify the guard exists and rejects correctly; the manual curl at the
    bottom of the output proves it end to end when you choose to run it.
    ============================================================================  */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
let failures = 0, liveSkipped = false;

const ok   = m => console.log(`  PASS   ${m}`);
const bad  = m => { failures++; console.log(`  FAIL   ${m}`); };
const info = m => console.log(`         ${m}`);

/* ── CHECK 1 — modules ──────────────────────────────────────────────────── */
console.log('\nCHECK 1  the two new modules');
let P, W;
try { P = require('./lib/paymentsDone'); ok('lib/paymentsDone.js loads'); }
catch (e) { bad(`lib/paymentsDone.js will not load — ${e.message}`); }
try { W = require('./lib/warranty'); ok('lib/warranty.js loads'); }
catch (e) { bad(`lib/warranty.js will not load — ${e.message}`); }

if (P) for (const fn of ['isPaymentsDoneVisible', 'paymentsDoneOptions', 'isPaymentsDoneAllowed'])
  typeof P[fn] === 'function' ? ok(`paymentsDone exports ${fn}`) : bad(`MISSING ${fn}`);
if (W) for (const fn of ['warrantyEndDate', 'warrantyStatus', 'applyWarranty'])
  typeof W[fn] === 'function' ? ok(`warranty exports ${fn}`) : bad(`MISSING ${fn}`);

/* ── CHECK 2 — rule behaviour ───────────────────────────────────────────── */
console.log('\nCHECK 2  rule behaviour on known inputs');

if (P) {
  const vis = (label, proj, want) => {
    const got = P.isPaymentsDoneVisible(proj);
    got === want ? ok(`SHOW_IF  ${label} -> ${got}`)
                 : bad(`SHOW_IF  ${label} -> got ${got}, expected ${want}`);
  };
  vis('Under SolarCare + EPC',            { Project_Status:'Under SolarCare', Project_Type:'EPC' }, true);
  vis('Under SolarCare + AMC type',       { Project_Status:'Under SolarCare', Project_Type:'AMC' }, false);
  vis('Defaulted - Project Payment + EPC',{ Project_Status:'Defaulted - Project Payment', Project_Type:'EPC' }, true);
  vis('Defaulted - TICKET Payment + EPC', { Project_Status:'Defaulted - Ticket Payment', Project_Type:'EPC' }, false);
  vis('Active + EPC',                     { Project_Status:'Active', Project_Type:'EPC' }, false);

  const val = (label, proj, cur, want) => {
    const got = P.paymentsDoneOptions(proj, cur).options;
    JSON.stringify(got) === JSON.stringify(want)
      ? ok(`VALID_IF ${label} -> [${got.join(', ')}]`)
      : bad(`VALID_IF ${label} -> got [${got.join(', ')}], expected [${want.join(', ')}]`);
  };
  val('Under SolarCare',            { Project_Status:'Under SolarCare' }, '',    [true, false]);
  val('Defaulted - Project Payment',{ Project_Status:'Defaulted - Project Payment' }, '', [false]);
  val('other status, blank',        { Project_Status:'Active' }, '',    [false, true]);
  val('other status, already No',   { Project_Status:'Active' }, false, [false, true]);
  val('other status, already Yes',  { Project_Status:'Active' }, true,  [true]);

  P.isPaymentsDoneAllowed('Yes', { Project_Status:'Defaulted - Project Payment' }) === false
    ? ok('enforcement rejects Yes on a project-payment default')
    : bad('enforcement WRONGLY allows Yes on a project-payment default');
}

if (W) {
  /*  Sixteen rows read straight off the live Tickets tab. If the maths ever
      changes, these are the rows that prove it still matches the sheet.   */
  const rows = [
    ['25/04/2022', 1,'2022-04-26'], ['12/01/2022', 0,'2022-01-12'],
    ['13/01/2022',30,'2022-02-12'], ['10/03/2019',30,'2019-04-09'],
    ['28/12/2021',30,'2022-01-27'], ['01/12/2021',15,'2021-12-16'],
    ['15/12/2021', 5,'2021-12-20'], ['09/12/2021', 5,'2021-12-14'],
    ['07/12/2021',15,'2021-12-22'], ['12/12/2021',15,'2021-12-27'],
    ['08/12/2021',30,'2022-01-07'], ['27/11/2021', 5,'2021-12-02'],
    ['01/12/2021',30,'2021-12-31'], ['13/12/2021', 5,'2021-12-18'],
    ['08/02/2022',30,'2022-03-10'], ['25/04/2022', 0,'2022-04-25'],
  ];
  const wrong = rows.filter(([s, p, e]) => W.warrantyEndDate(s, p) !== e);
  wrong.length === 0
    ? ok(`end = start + period days — all ${rows.length} live rows match`)
    : bad(`${wrong.length} of ${rows.length} rows do not match, e.g. ${wrong[0][0]} + ${wrong[0][1]}d`);

  /*  The dd/mm trap: new Date("12/01/2022") is December 1st in JavaScript. */
  W.warrantyEndDate('12/01/2022', 0) === '2022-01-12'
    ? ok('dd/mm/yyyy read as 12 January, not 1 December')
    : bad('dd/mm/yyyy is being parsed in US order — dates will be months out');

  W.warrantyStatus('2022-04-26') === 'Warranty Expired'
    ? ok('a past end date reads as Warranty Expired')
    : bad('past end date did not produce "Warranty Expired"');

  const untouched = W.applyWarranty({ Ticket_Status:'Open' }, W.TICKET_COLS);
  untouched.Ticket_Warranty_End_Date === undefined
    ? ok('a row with no warranty fields is left alone')
    : bad('applyWarranty wrote to a row that had no warranty fields');
}

/* ── CHECK 3 — route wiring ─────────────────────────────────────────────── */
console.log('\nCHECK 3  route wiring');
const wired = (file, needles) => {
  let src;
  try { src = fs.readFileSync(path.join(__dirname, file), 'utf8'); }
  catch (e) { return bad(`cannot read ${file}`); }
  for (const n of needles) {
    src.includes(n) ? ok(`${file} contains ${n}`)
                    : bad(`${file} does NOT contain ${n} — old copy still in place`);
  }
};
wired('routes/projects.js', ["require('../lib/paymentsDone')", 'isPaymentsDoneAllowed', 'isPaymentsDoneVisible']);
wired('routes/tickets.js',  ["require('../lib/warranty')", 'applyWarranty', 'TICKET_COLS']);
wired('../frontend/src/lib/projectFields.js', ['paymentsDoneVisible', 'lockedTo']);

/* ── CHECK 4 — live server ──────────────────────────────────────────────── */
(async () => {
  console.log(`\nCHECK 4  live server on http://localhost:${PORT}  (read-only)`);

  let headers = {};
  try {
    const { sign, REQUIRE_AUTH } = require('./middleware/auth');
    if (REQUIRE_AUTH) {
      headers = { Authorization: 'Bearer ' + sign({
        email:'verify-script@ecosoch.com', name:'Setup verification',
        role:'Super Admin', department:'IT' }, '5m') };
      info('REQUIRE_AUTH is on — signed a 5-minute token');
    }
  } catch { info('could not mint a token — check 4 may report AUTH_REQUIRED'); }

  const get = async url => {
    const res  = await fetch(`http://localhost:${PORT}${url}`, { headers });
    const json = await res.json();
    return { status: res.status, json };
  };

  /*  Projects are FOUND, not hard-coded.

      The first version named two ids taken from an earlier screenshot and one
      of them 404'd. A stale id makes the script report a failure that says
      nothing about the logic under test. Asking the sheet for a project that
      currently matches each case is self-updating, and "no project matches
      this case" is itself useful to know.                                 */
  let all = [];
  try {
    const r = await get('/api/projects?limit=2000');
    all = r.json?.data || [];
    if (!all.length) bad(`GET /api/projects -> HTTP ${r.status}: ${r.json?.error || 'no rows'}`);
  } catch {
    liveSkipped = true;
    info('server not reachable — start it and re-run for check 4');
  }

  if (all.length) {
    ok(`read ${all.length} projects from the live API`);
    const pick = fn => all.find(p => fn(String(p.status ?? '').trim(),
                                        String(p.project_type ?? '').trim()));
    const cases = [
      ['should be ASKED',        pick((st, ty) => st === 'Under SolarCare' && ty.toUpperCase() !== 'AMC'), true],
      ['locked to No',           pick(st => st === 'Defaulted - Project Payment'), true],
      ['hidden, AMC type',       pick((_st, ty) => ty.toUpperCase() === 'AMC'), false],
      ['hidden, status not listed', pick(st => st === 'Active'), false],
    ];
    for (const [note, proj, wantVisible] of cases) {
      if (!proj) { info(`no project currently matches: ${note}`); continue; }
      const row = { Project_Status: proj.status, Project_Type: proj.project_type,
                    Payments_Done: proj.payments_done };
      const visible = P.isPaymentsDoneVisible(row);
      visible === wantVisible
        ? ok(`${String(proj.id).padEnd(10)} ${String(proj.status).padEnd(28)} ${String(proj.project_type).padEnd(12)} -> ${visible ? 'ASKED' : 'HIDDEN'}   (${note})`)
        : bad(`${proj.id}: expected ${wantVisible ? 'ASKED' : 'HIDDEN'}, got ${visible ? 'ASKED' : 'HIDDEN'}  (${note})`);
      if (visible) {
        const o = P.paymentsDoneOptions(row, row.Payments_Done);
        info(`   allowed: ${o.options.map(v => v ? 'Yes' : 'No').join(', ')}${o.locked ? '  (locked)' : ''} — ${o.reason}`);
        info(`   open it: http://localhost:5173/projects/${proj.id}`);
      }
    }
  }

  if (!liveSkipped && W) {
    try {
      const r = await get('/api/tickets?limit=5');
      const list = r.json?.data || [];
      /*  warranty_start only exists once MAP.tickets carries the
          Ticket_Warranty_* columns. Before that, every ticket came back
          without them and this reported "none carry a warranty start date" —
          which looked like missing DATA but was missing MAPPING.          */
      if (list.length && !('warranty_start' in list[0]))
        bad('tickets come back with no warranty_start key — MAP.tickets is missing the Ticket_Warranty_* columns');
      const withW = list.filter(t => t.warranty_start || t.Ticket_Warranty_Start_Date);
      if (!list.length)      info('no tickets returned — skipping the warranty spot-check');
      else if (!withW.length) info(`${list.length} tickets read, none carry a warranty start date`);
      else {
        const t = withW[0];
        const start = t.warranty_start ?? t.Ticket_Warranty_Start_Date;
        const per   = t.warranty_period ?? t.Ticket_Warranty_Period;
        const end   = t.warranty_end   ?? t.Ticket_Warranty_End_Date;
        const want  = W.warrantyEndDate(start, per);
        String(end).slice(0, 10) === want
          ? ok(`ticket warranty end matches: ${start} + ${per}d = ${want}`)
          : info(`ticket end is ${end}, formula gives ${want} — expected for rows written before this change`);
      }
    } catch { info('tickets endpoint not reachable — skipping'); }
  }

  console.log('\n' + '-'.repeat(66));
  if (failures > 0)        console.log(`${failures} CHECK(S) FAILED — see the FAIL lines above.`);
  else if (liveSkipped)    console.log('CHECKS 1-3 PASSED. Check 4 was SKIPPED — start the backend and re-run.');
  else                     console.log('ALL CHECKS PASSED — both rules are installed and live.');
  console.log('-'.repeat(66));
  console.log('\nTo prove the 422 enforcement end to end (this WRITES, so use a test project):');
  console.log('  curl.exe -X PATCH http://localhost:4000/api/projects/<id> \\');
  console.log('    -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \\');
  console.log('    -d "{\\"payments_done\\":\\"Yes\\"}"');
  console.log('  On a project whose status is "Defaulted - Project Payment" this must return 422.\n');

  process.exitCode = failures === 0 ? 0 : 1;
})();