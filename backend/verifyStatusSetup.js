/*  backend/verifyStatusSetup.js
    ============================================================================
    Answers one question: is the Project_Status Valid_If logic actually wired in,
    end to end?

        cd backend
        node verifyStatusSetup.js

    Downloading files proves nothing — a file can be saved to the wrong folder,
    or saved correctly while the server still runs the old code in memory. This
    checks the four layers separately so a failure tells you WHICH one is wrong.

      CHECK 1  lib/status.js exports the new functions
      CHECK 2  the rules produce the right answer for known inputs
      CHECK 3  routes/projects.js actually calls them and returns status_options
      CHECK 4  the LIVE server on :4000 returns status_options for a real project

    Check 4 needs the backend running. If it is not, checks 1-3 still tell you
    whether the code is in place.

    Nothing is written. This script only reads.
    ============================================================================  */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
let failures = 0;
let liveSkipped = false;

const ok   = m => console.log(`  PASS   ${m}`);
const bad  = m => { failures++; console.log(`  FAIL   ${m}`); };
const info = m => console.log(`         ${m}`);

/* ── CHECK 1 — the module exports what it should ────────────────────────── */
console.log('\nCHECK 1  lib/status.js exports');
let status;
try {
  status = require('./lib/status');
} catch (e) {
  bad(`cannot load lib/status.js — ${e.message}`);
}
if (status) {
  for (const fn of ['projectStatusOptions', 'isStatusAllowed', 'countAmcTypes', 'BASE_STATUSES']) {
    typeof status[fn] !== 'undefined'
      ? ok(`exports ${fn}`)
      : bad(`MISSING export "${fn}" — you are still on the old lib/status.js`);
  }
}

/* ── CHECK 2 — the rules behave ─────────────────────────────────────────── */
console.log('\nCHECK 2  rule behaviour on known inputs');
if (status?.projectStatusOptions) {
  const t = (label, ctx, wantRule, wantHas, wantNot) => {
    const r = status.projectStatusOptions(ctx);
    const has = !wantHas || r.options.includes(wantHas);
    const not = !wantNot || !r.options.includes(wantNot);
    (r.rule === wantRule && has && not)
      ? ok(`${label} -> rule ${r.rule}`)
      : bad(`${label} -> got rule ${r.rule}, options [${r.options.join(', ')}]`);
  };

  t('brand-new project', { isNew: true, projectType: 'EPC' }, 1, 'Active', 'Under SolarCare');

  t('EPC, AMC promised, NO contracts (your 116)', {
    projectType: 'EPC', amcProvided: 'Yes', amcType: 'Cleaning',
    contracts: [], payments: [],
  }, 3, 'Active', 'Under SolarCare');

  t('EPC, 2 types, 2 active contracts (like 563402)', {
    projectType: 'EPC', amcProvided: 'Yes', amcType: 'Inspection , Cleaning',
    contracts: [{ AMC_Id: 'x', AMC_Status: 'Active' }, { AMC_Id: 'y', AMC_Status: 'Active' }],
    payments : [{ AMC_Id: 'x', Payment_Amount: 5000 }, { AMC_Id: 'y', Payment_Amount: 5000 }],
  }, 4, 'Under SolarCare');

  t('Consultancy', { projectType: 'Consultancy', amcProvided: 'No' }, 5, 'Completed', 'Under SolarCare');

  t('Ad-hoc Maintenance (your 13)', { projectType: 'Ad-hoc Maintenance', amcProvided: 'No' },
    0, 'Active', 'Under SolarCare');

  // the awkward spelling in your sheet
  status.countAmcTypes('Inspection , Cleaning') === 2
    ? ok('"Inspection , Cleaning" counts as 2 types')
    : bad('"Inspection , Cleaning" mis-counted — check countAmcTypes');
}

/* ── CHECK 3 — the route is wired ───────────────────────────────────────── */
console.log('\nCHECK 3  routes/projects.js wiring');
try {
  const src = fs.readFileSync(path.join(__dirname, 'routes', 'projects.js'), 'utf8');
  src.includes("require('../lib/status')") && src.includes('projectStatusOptions')
    ? ok('imports projectStatusOptions from lib/status')
    : bad('does NOT import projectStatusOptions — old routes/projects.js still in place');
  src.includes('status_options')
    ? ok('GET /:id returns status_options')
    : bad('no status_options in the response — old routes/projects.js still in place');
  src.includes('STATUS_RULES_ENFORCE')
    ? ok('PATCH has the enforcement guard')
    : bad('no enforcement guard on PATCH');
} catch (e) {
  bad(`cannot read routes/projects.js — ${e.message}`);
}

const enforce = String(process.env.STATUS_RULES_ENFORCE).toLowerCase() === 'true';
info(`STATUS_RULES_ENFORCE is ${enforce ? 'TRUE — the API will REJECT an invalid status'
                                       : 'not set — the API logs a warning and writes anyway'}`);

/* ── CHECK 4 — the live server ──────────────────────────────────────────── */
(async () => {
  console.log(`\nCHECK 4  live server on http://localhost:${PORT}`);

  /*  The API is behind sign-in. A plain GET returns
          {"success":false,"error":"Sign in required","code":"AUTH_REQUIRED"}
      which is what made this check report "no data" on the first run.

      This script runs on the server machine and can read .env, so it signs a
      short-lived token with the SAME helper the login route uses rather than
      hand-rolling the payload — if the token shape ever changes, this follows
      it automatically. The token lives 5 minutes and is used for two GETs.  */
  let authHeaders = {};
  try {
    const { sign, REQUIRE_AUTH } = require('./middleware/auth');
    if (REQUIRE_AUTH) {
      const token = sign({
        email: 'verify-script@ecosoch.com', name: 'Setup verification',
        role : 'Super Admin', department: 'IT',
      }, '5m');
      authHeaders = { Authorization: `Bearer ${token}` };
      info('REQUIRE_AUTH is on — signed a 5-minute token to read the two projects');
    } else {
      info('REQUIRE_AUTH is off — no token needed');
    }
  } catch (e) {
    info(`could not mint a token (${e.message}) — check 4 may report AUTH_REQUIRED`);
  }

  // Rule 3 and rule 5 examples taken from your own checkStatusRules.js output
  const samples = [
    { id: '410714', expectRule: 3, expectMissing: 'Under SolarCare' },
    { id: '563484', expectRule: 5, expectHas    : 'Completed' },
  ];

  for (const s of samples) {
    let json, httpStatus;
    try {
      const res = await fetch(`http://localhost:${PORT}/api/projects/${s.id}`, { headers: authHeaders });
      httpStatus = res.status;
      json = await res.json();
    } catch {
      liveSkipped = true;
      info(`server not reachable — start it with "npm run dev" and re-run for check 4`);
      break;
    }

    const d = json?.data;
    if (!d) {
      /*  Report what the server ACTUALLY said. The first version printed
          "returned no data" for every failure, which hid an AUTH_REQUIRED
          response and sent the diagnosis in the wrong direction. Always
          surface the real HTTP status and message.                        */
      bad(`GET /api/projects/${s.id} -> HTTP ${httpStatus}: ${json?.error || JSON.stringify(json)}`);
      if (json?.code === 'AUTH_REQUIRED') {
        info('the API wants a token. Either this script and the server disagree on');
        info('JWT_SECRET, or set REQUIRE_AUTH=false in backend/.env, restart, re-run.');
      }
      continue;
    }

    if (!Array.isArray(d.status_options)) {
      bad(`${s.id}: no status_options in the live response — the server is running OLD code. ` +
          `Stop it (Ctrl+C) and start it again.`);
      continue;
    }
    ok(`${s.id}: status_options = [${d.status_options.join(', ')}]`);
    info(`rule ${d.status_rule?.rule} — ${d.status_rule?.reason}`);

    if (s.expectMissing && d.status_options.includes(s.expectMissing)
        && String(d.status).trim() !== s.expectMissing) {
      bad(`${s.id}: "${s.expectMissing}" should NOT be offered here`);
    }
    if (s.expectHas && !d.status_options.includes(s.expectHas)) {
      bad(`${s.id}: expected "${s.expectHas}" to be offered`);
    }
  }

  console.log('\n' + '─'.repeat(64));
  if (failures > 0) {
    console.log(`${failures} CHECK(S) FAILED — see the FAIL lines above.`);
  } else if (liveSkipped) {
    console.log('CHECKS 1-3 PASSED — the code is in place.');
    console.log('CHECK 4 was SKIPPED because the server was not running, so this does');
    console.log('NOT yet prove the running server picked the new code up. Start the');
    console.log('backend and run this again for the full answer.');
  } else {
    console.log('ALL CHECKS PASSED — the status logic is installed AND live on the server.');
  }
  console.log('─'.repeat(64) + '\n');

  /*  process.exit() crashed Node on Windows with
          Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
      because fetch keeps a connection pool alive and exit() tears the event
      loop down underneath it. Set the code and let Node drain naturally.   */
  process.exitCode = failures === 0 ? 0 : 1;
})();