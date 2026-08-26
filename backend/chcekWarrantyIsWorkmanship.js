/*  backend/checkWarrantyIsWorkmanship.js
    ============================================================================
    Tests one hypothesis against all 1,542 live rows:

        THE Warranty_* COLUMNS ON THE PROJECTS TAB ARE ALREADY THE
        WORKMANSHIP WARRANTY, UNDER A DIFFERENT NAME.

        cd backend
        node checkWarrantyIsWorkmanship.js

    Reads only. Writes nothing, ever.

    ── WHERE THIS CAME FROM ─────────────────────────────────────────────────

    discoverWarrantyColumns.js printed these three sample values:

        Commissioned_Date     2021-12-23
        Warranty_Start_Date   2021-12-23      <- the same day
        Warranty_End_Date     2023-12-23      <- exactly two years later
        Warranty_Period       2

    If that pattern holds across the sheet, then the workmanship warranty was
    never missing — it has been recorded in Warranty_* all along, and I was
    wrong to tell you it did not exist.

    It also means lib/warranty.js is wrong about this tab. That file says
    Warranty_Period is in DAYS, verified against 16 rows — but those 16 rows
    were read off the TICKETS tab, where the period really is days (25/04/2022
    + 1 -> 26/04/2022). On the PROJECTS tab a period of 2 spans 730 days. Same
    column name, two different units, two different tabs. That is exactly the
    kind of thing that is invisible until you count it.

    ── WHY IT MATTERS ───────────────────────────────────────────────────────

    Coverage. From the discovery run:

        Commissioned_Date     651 projects have a readable date
        Warranty_Start_Date   843 projects have a readable date

    backfillWorkmanship.js could not date 837 EPC projects. If Warranty_Start_Date
    is the same thing, most of those become datable — one flag, no data entry.

    ── WHAT THIS SCRIPT WILL NOT DO ─────────────────────────────────────────

    It will not turn the flag on for you. It counts, reports, and tells you
    whether the numbers support the hypothesis. Flipping
    USE_WARRANTY_START_AS_FALLBACK in lib/workmanship.js is a decision about
    what your company's data means, and that is yours to make.
    ============================================================================  */

require('dotenv').config();
const db = require('./db/sheets');
const D  = require('./lib/dateMath');
const W  = require('./lib/workmanship');

const s   = v => String(v ?? '').trim();
const pct = (n, total) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

(async () => {
  console.log('\nIs Warranty_* on the Projects tab the workmanship warranty?');
  console.log('Reading the live sheet. Nothing will be written.\n');

  const projects = await db.all('projects', { fresh: true });
  const epc = projects.filter(p =>
    p && W.ELIGIBLE_TYPES.some(t => t.toLowerCase() === s(p.Project_Type).toLowerCase()));

  console.log(`${projects.length} projects, ${epc.length} of them EPC.\n`);

  /* ── TEST 1: what units is Warranty_Period in? ──────────────────────── */
  console.log('TEST 1  Warranty_Period — days, or years?\n');

  const periods = new Map();
  for (const p of epc) {
    const v = s(p.Warranty_Period);
    if (!v) continue;
    periods.set(v, (periods.get(v) || 0) + 1);
  }
  console.log('  distinct values on EPC projects:');
  for (const [v, n] of [...periods].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(5)}  "${v}"`);
  }
  console.log('');
  console.log('  A column measured in DAYS would hold values like 30, 90, 365.');
  console.log('  A column measured in YEARS would hold 1, 2, 5.\n');

  /* ── TEST 2: does end - start match the period, in years or in days? ─ */
  console.log('TEST 2  Does Warranty_End_Date = Warranty_Start_Date + Warranty_Period?\n');

  let bothDates = 0, matchYears = 0, matchDays = 0, matchNeither = 0;
  const gaps = new Map();

  for (const p of epc) {
    const st = D.parseDate(p.Warranty_Start_Date);
    const en = D.parseDate(p.Warranty_End_Date);
    const yr = Number(p.Warranty_Period);
    if (!st || !en || !Number.isFinite(yr) || yr <= 0) continue;
    bothDates++;

    const asYears = D.addYears(st, yr);
    const asDays  = new Date(st.getTime() + yr * 86400000);

    const gapYears = Math.round((en - st) / 86400000 / 365.25 * 100) / 100;
    gaps.set(gapYears, (gaps.get(gapYears) || 0) + 1);

    if (D.toISODate(asYears) === D.toISODate(en))      matchYears++;
    else if (D.toISODate(asDays) === D.toISODate(en))  matchDays++;
    else                                               matchNeither++;
  }

  console.log(`  ${bothDates} EPC project(s) have start, end and period all readable.\n`);
  console.log(`    ${String(matchYears).padStart(5)}  (${pct(matchYears, bothDates)}%)  end = start + period YEARS`);
  console.log(`    ${String(matchDays).padStart(5)}  (${pct(matchDays, bothDates)}%)  end = start + period DAYS`);
  console.log(`    ${String(matchNeither).padStart(5)}  (${pct(matchNeither, bothDates)}%)  neither`);
  console.log('');
  console.log('  gap between start and end, in years:');
  for (const [g, n] of [...gaps].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(5)}  ${g} year(s)`);
  }
  console.log('');

  /* ── TEST 3: is Warranty_Start_Date the commissioning date? ─────────── */
  console.log('TEST 3  Is Warranty_Start_Date the same day as Commissioned_Date?\n');

  let haveBoth = 0, same = 0, differ = 0;
  const examples = [];

  for (const p of epc) {
    const c = D.parseDate(p.Commissioned_Date);
    const w = D.parseDate(p.Warranty_Start_Date);
    if (!c || !w) continue;
    haveBoth++;
    if (D.toISODate(c) === D.toISODate(w)) same++;
    else {
      differ++;
      if (examples.length < 8) examples.push({
        id: p.Project_ID, c: D.toISODate(c), w: D.toISODate(w),
        days: Math.round((w - c) / 86400000),
      });
    }
  }

  console.log(`  ${haveBoth} EPC project(s) have BOTH dates.\n`);
  console.log(`    ${String(same).padStart(5)}  (${pct(same, haveBoth)}%)  identical`);
  console.log(`    ${String(differ).padStart(5)}  (${pct(differ, haveBoth)}%)  different`);
  if (examples.length) {
    console.log('\n  where they differ:');
    for (const e of examples) {
      console.log(`    ${s(e.id).padEnd(11)} commissioned ${e.c}, warranty starts ${e.w}  (${e.days} days apart)`);
    }
  }
  console.log('');

  /* ── TEST 4: how much coverage would the flag actually buy? ─────────── */
  console.log('TEST 4  How many more projects could be dated?\n');

  let viaCommissioned = 0, viaWarrantyOnly = 0, neither = 0;
  let underCareRescued = 0;

  for (const p of epc) {
    const c = D.parseDate(p.Commissioned_Date);
    const w = D.parseDate(p.Warranty_Start_Date);
    if (c)      viaCommissioned++;
    else if (w) {
      viaWarrantyOnly++;
      if (s(p.Project_Status).toLowerCase() === 'under solarcare') underCareRescued++;
    }
    else neither++;
  }

  console.log(`    ${String(viaCommissioned).padStart(5)}  datable today, from Commissioned_Date`);
  console.log(`    ${String(viaWarrantyOnly).padStart(5)}  datable ONLY if Warranty_Start_Date is used  <- what the flag buys`);
  console.log(`    ${String(neither).padStart(5)}  still undatable either way — real data entry`);
  console.log('');
  console.log(`    ${underCareRescued} of the rescued project(s) are Under SolarCare right now,`);
  console.log('    so that is how many the expiry rule could newly judge.\n');

  /* ── VERDICT ────────────────────────────────────────────────────────── */
  console.log('-'.repeat(74));
  const yearsWin  = bothDates && (matchYears / bothDates) > 0.9;
  const sameWin   = haveBoth  && (same / haveBoth)        > 0.9;

  if (yearsWin && sameWin) {
    console.log('THE HYPOTHESIS HOLDS.');
    console.log('');
    console.log('Warranty_Start_Date is the commissioning date and Warranty_End_Date is');
    console.log('two years later. These columns ARE the workmanship warranty — it was');
    console.log('recorded all along, just not called that. I was wrong to tell you it did');
    console.log('not exist in your sheet.');
    console.log('');
    console.log('You can set USE_WARRANTY_START_AS_FALLBACK = true in lib/workmanship.js.');
    console.log('It is a FALLBACK, so Commissioned_Date still wins where both are present —');
    console.log('nothing already dated changes, and the undated ones get dated.');
    console.log('');
    console.log('Then re-run:  node backfillWorkmanship.js        (dry run first)');
  } else if (yearsWin || sameWin) {
    console.log('PARTIALLY. One of the two tests passed, the other did not.');
    console.log('');
    console.log(`  end = start + period years : ${pct(matchYears, bothDates)}%`);
    console.log(`  start = commissioning date : ${pct(same, haveBoth)}%`);
    console.log('');
    console.log('Look at the mismatched examples above before turning the flag on.');
    console.log('A column that means the right thing 70% of the time is worse than one');
    console.log('that means nothing, because the 30% is invisible.');
  } else {
    console.log('THE HYPOTHESIS DOES NOT HOLD.');
    console.log('');
    console.log('Warranty_* does not behave like a 2-year warranty running from');
    console.log('commissioning. Leave USE_WARRANTY_START_AS_FALLBACK off, and fill in');
    console.log('Commissioned_Date for the projects that need it.');
  }
  console.log('-'.repeat(74) + '\n');
  process.exit(0);
})().catch(e => { console.error('\n' + e.message + '\n'); process.exit(2); });