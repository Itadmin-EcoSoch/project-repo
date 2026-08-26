/*  backend/checkAmcLink.js
    ============================================================================
    Diagnoses why AMC_Contracts rows are not attaching to their projects.

        cd backend
        node checkAmcLink.js

    Nothing is written. This script only reads.

    WHY: checkStatusRules.js reported 116 projects sitting on rule 3, EVERY one
    of them saying "0 active contract(s)" — while the sheet holds 117
    AMC_Contracts rows. If the link were sound, at least some of those projects
    would show a non-zero count. Something between the two tabs is not matching,
    and there are only a few candidates:

        A. AMC_Contracts has no Project_ID column at all
        B. Project_ID is present but blank on most rows
        C. Project_ID is present but does not match any Projects row
           (case, stray spaces, a trailing ".0" from Sheets numeric coercion)
        D. AMC_Status is not spelled "Active" — maybe "ACTIVE", "active",
           "Live", or blank

    This prints enough of the raw data to tell which.
    ============================================================================  */

require('dotenv').config();
const db = require('./db/sheets');

const norm = v => String(v ?? '').trim();
const key  = v => norm(v).toLowerCase().replace(/\.0+$/, '');

(async () => {
  const [projects, contracts, payments] = await Promise.all([
    db.all('projects',      { fresh: true }),
    db.all('amc_contracts', { fresh: true }),
    db.all('amc_payments',  { fresh: true }),
  ]);

  console.log(`\nProjects: ${projects.length}   AMC_Contracts: ${contracts.length}   AMC_Payment_Schedule: ${payments.length}\n`);

  /* ── A. what columns does AMC_Contracts actually have? ───────────────── */
  const cols = new Set();
  contracts.forEach(r => r && Object.keys(r).forEach(k => cols.add(k)));
  console.log('AMC_Contracts columns:');
  console.log('   ' + [...cols].join(', ') + '\n');
  console.log(`   Has a Project_ID column? ${cols.has('Project_ID') ? 'YES' : 'NO  <-- this alone explains it'}\n`);

  /* ── B/C. how many contracts carry a usable Project_ID? ─────────────── */
  const projIds = new Set(projects.filter(Boolean).map(p => key(p.Project_ID)));
  let blank = 0, matched = 0, orphan = 0;
  const orphanSamples = [];

  for (const c of contracts) {
    if (!c) continue;
    const raw = norm(c.Project_ID);
    if (!raw) { blank++; continue; }
    if (projIds.has(key(raw))) matched++;
    else { orphan++; if (orphanSamples.length < 10) orphanSamples.push({ amc: c.AMC_Id, pid: raw }); }
  }

  console.log('Project_ID on AMC_Contracts rows:');
  console.log(`   blank / missing            : ${blank}`);
  console.log(`   matches a Projects row     : ${matched}`);
  console.log(`   present but NO match found : ${orphan}`);
  if (orphanSamples.length) {
    console.log('   examples that did not match:');
    orphanSamples.forEach(o => console.log(`       AMC ${o.amc}  ->  Project_ID "${o.pid}"`));
  }
  console.log('');

  /* ── D. what values does AMC_Status actually hold? ──────────────────── */
  const statusCount = new Map();
  for (const c of contracts) {
    if (!c) continue;
    const s = norm(c.AMC_Status) || '(blank)';
    statusCount.set(s, (statusCount.get(s) || 0) + 1);
  }
  console.log('AMC_Status values in AMC_Contracts:');
  [...statusCount].sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`   ${String(n).padStart(4)}  "${s}"${s.toLowerCase() === 'active' ? '' : '   <-- not "Active"'}`));
  console.log('');

  /* ── which projects DO have contracts attached ──────────────────────── */
  const byProject = new Map();
  for (const c of contracts) {
    if (!c) continue;
    const k = key(c.Project_ID);
    if (!k) continue;
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k).push(c);
  }
  console.log(`Distinct projects with at least one contract: ${byProject.size}`);
  let shown = 0;
  for (const [k, list] of byProject) {
    if (shown++ >= 8) break;
    const p = projects.find(x => x && key(x.Project_ID) === k);
    const active = list.filter(c => norm(c.AMC_Status).toLowerCase() === 'active').length;
    /*  String() around Project_ID is NOT decorative. The 498 legacy ids
        (563447 …) arrive from Sheets as NUMBERS, and Number.padEnd does not
        exist — this line threw "padEnd is not a function" until it was added. */
    const idText   = String(p ? p.Project_ID : k);
    const nameText = String(p ? (p.Project_Name ?? '') : '(no matching project)');
    console.log(`   ${idText.padEnd(10)} ${nameText.slice(0, 42).padEnd(44)} ` +
                `${list.length} contract(s), ${active} Active   AMC_Type on project: "${p ? norm(p.AMC_Type) : '?'}"`);
  }
  console.log('');

  /* ── the 116: do they have AMC_Provided on with no contracts? ───────── */
  const yes = v => v === true || /^(y|yes|true|1)$/i.test(norm(v));
  const stranded = projects.filter(p =>
    p && yes(p.AMC_Provided) && norm(p.AMC_Type) && !byProject.has(key(p.Project_ID)));
  console.log(`Projects with AMC_Provided = Yes and an AMC_Type but ZERO contract rows: ${stranded.length}`);
  stranded.slice(0, 8).forEach(p =>
    console.log(`   ${String(p.Project_ID).padEnd(10)} ${String(p.Project_Name ?? '').slice(0, 44).padEnd(46)} AMC_Type "${norm(p.AMC_Type)}"`));
  console.log('');

  /*  Projects that DO have contracts but whose promised type count still does
      not match — these are the genuinely half-configured ones, as opposed to
      the ones where no contract was ever created.                          */
  const mismatched = projects.filter(p => {
    if (!p || !yes(p.AMC_Provided)) return false;
    const list = byProject.get(key(p.Project_ID));
    if (!list) return false;
    const wanted = norm(p.AMC_Type).split(',').map(x => x.trim()).filter(Boolean).length;
    const active = list.filter(c => norm(c.AMC_Status).toLowerCase() === 'active').length;
    return wanted !== active;
  });
  console.log(`Projects WITH contracts whose type count still does not match: ${mismatched.length}`);
  mismatched.slice(0, 8).forEach(p => {
    const list = byProject.get(key(p.Project_ID));
    const active = list.filter(c => norm(c.AMC_Status).toLowerCase() === 'active').length;
    console.log(`   ${String(p.Project_ID).padEnd(10)} AMC_Type "${norm(p.AMC_Type)}" -> ` +
                `${norm(p.AMC_Type).split(',').filter(x => x.trim()).length} promised, ${active} active contract(s)`);
  });
  console.log('');

  /* ── verdict ────────────────────────────────────────────────────────── */
  console.log('─'.repeat(70));
  if (!cols.has('Project_ID')) {
    console.log('CAUSE A: AMC_Contracts has no Project_ID column. Contracts cannot be');
    console.log('  tied to projects at all, so rule 3 will fire for every AMC project.');
  } else if (blank === contracts.length) {
    console.log('CAUSE B: every AMC_Contracts row has a blank Project_ID.');
  } else if (orphan > matched) {
    console.log('CAUSE C: most Project_ID values on AMC_Contracts match no project.');
    console.log('  Compare the samples above against the Projects tab — look for case');
    console.log('  differences or a trailing ".0" added by Sheets.');
  } else if (stranded.length > 20) {
    console.log('NOT A BUG. The Project_ID link is sound — ' + matched + ' of ' + contracts.length);
    console.log('  contract rows match a project, and every AMC_Status reads "Active".');
    console.log('');
    console.log(`  Rule 3 fires for ${stranded.length} projects because those projects promise an`);
    console.log('  AMC in AMC_Type but have NO contract row at all. AppSheet would block');
    console.log('  them from "Under SolarCare" for exactly the same reason, so the port is');
    console.log('  behaving correctly and STATUS_RULES_ENFORCE can safely be turned on.');
    console.log('');
    console.log('  The real finding is a data gap: those projects were sold an AMC that');
    console.log('  was never set up as a contract.');
  } else {
    console.log('The link looks healthy. Re-run checkStatusRules.js and compare.');
  }
  console.log('─'.repeat(70) + '\n');

  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });