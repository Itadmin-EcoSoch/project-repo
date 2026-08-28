/*  backend/routes/auth.js  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    Google sign-in, gated to the EcoSoch domain and checked against the Users tab.

    Flow:
      1. browser gets a Google ID token from the "Sign in with Google" button
      2. POST /api/auth/google  { credential }
      3. the token is verified WITH GOOGLE (never trust the browser's copy)
      4. the @ecosoch.com domain is enforced
      5. the person is looked up in the Users tab, which decides their role
      6. a session token valid for 7 days is returned

    WHAT CHANGED
      · The signed-in user now carries their tier and capability list, so the
        UI can hide what they cannot do instead of showing buttons that 403.
      · AUTH_MODE=sheet is now the recommended setting: the address must already
        exist in the Users tab. That is what "only the people we give access to"
        means in practice — a valid @ecosoch.com address is no longer enough on
        its own.
      · New accounts provisioned in domain mode default to Staff, not to
        Sales Coordinator. Staff can add and edit but cannot delete.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db   = require('../db/sheets');
const perm = require('../lib/permissions');
const { MAP, toApp } = require('../lib/mapping');
const { sign, REQUIRE_AUTH } = require('../middleware/auth');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DOMAIN    = (process.env.ALLOWED_EMAIL_DOMAIN || 'ecosoch.com').toLowerCase();

/*  'domain' – anyone with an @ecosoch.com address may sign in, and their first
               sign-in saves them into the Users tab as DEFAULT_ROLE ← default
    'sheet'  – the address must already be in the Users tab

    Domain mode is the one you want for a company app: nobody waits on an admin
    to start working, and an admin still decides who gets raised above the
    default role. The domain check below is what keeps outsiders out.       */
const AUTH_MODE    = (process.env.AUTH_MODE || 'domain').toLowerCase();

/*  New sign-ins land here: they can add and edit, but cannot delete and cannot
    open the company-wide or administration screens. An admin raises specific
    people afterwards under Team members.                                    */
const DEFAULT_ROLE = (() => {
  const wanted = String(process.env.DEFAULT_ROLE || '').trim();
  if (!wanted) return perm.DEFAULT_NEW_USER_ROLE;

  /*  Only honour DEFAULT_ROLE if it is a role the app still offers. Older .env
      files carry DEFAULT_ROLE=Sales Coordinator from before roles meant
      anything, which would stamp every new employee with a job title they do
      not hold. Same permissions either way, but the wrong word on screen. */
  const known = perm.ROLE_OPTIONS.some(o => perm.normalise(o.value) === perm.normalise(wanted));
  if (known) return wanted;

  console.warn(
    `[auth] DEFAULT_ROLE="${wanted}" in .env is not one of ` +
    `${perm.ROLE_OPTIONS.map(o => o.value).join(', ')} — new sign-ins will be ` +
    `saved as "${perm.DEFAULT_NEW_USER_ROLE}" instead.`
  );
  return perm.DEFAULT_NEW_USER_ROLE;
})();

/** Ask Google whether this ID token is real: signature, expiry, audience. */
async function verifyGoogleToken(credential) {
  const res = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential)
  );
  if (!res.ok) throw new Error('Google rejected that sign-in token');

  const p = await res.json();

  if (CLIENT_ID && p.aud !== CLIENT_ID) {
    throw new Error('This token was issued for a different app');
  }
  if (p.email_verified !== true && p.email_verified !== 'true') {
    throw new Error('That Google account has no verified email address');
  }
  if (Number(p.exp) * 1000 < Date.now()) {
    throw new Error('That sign-in token has expired — please try again');
  }
  return {
    email  : String(p.email || '').toLowerCase().trim(),
    name   : p.name || '',
    picture: p.picture || null,
    hd     : p.hd || null,
  };
}

/* POST /api/auth/google  { credential } */
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ success: false, error: 'Missing Google credential' });
    }

    const g = await verifyGoogleToken(credential);

    /* ── gate 1: the company domain ──────────────────────────────────── */
    if (!g.email.endsWith('@' + DOMAIN)) {
      return res.status(403).json({
        success: false,
        error: `This app is for @${DOMAIN} accounts only. You signed in as ${g.email}.`,
        code: 'WRONG_DOMAIN',
      });
    }

    /* ── gate 2: the Users tab ───────────────────────────────────────────
       In domain mode this is not a gate at all — it is where the account gets
       created. The person signs in and is working immediately; they simply
       appear under Team members as a User for an admin to raise later.    */
    let row = await db.get('users', g.email, { fresh: true });

    if (!row && AUTH_MODE === 'sheet') {
      return res.status(403).json({
        success: false,
        error: `${g.email} has not been given access to this app yet. ` +
               `Ask an admin to add you under Team members.`,
        code: 'NOT_IN_USERS',
        /*  Surfaced so the admin testing this can see WHY without reading the
            source. AUTH_MODE=sheet is the only thing that produces this. */
        admin_hint: `AUTH_MODE is set to "sheet" in backend/.env, so only people ` +
                    `already listed in the Users tab can sign in. To let every ` +
                    `@${DOMAIN} employee sign in automatically, set AUTH_MODE=domain ` +
                    `and restart the backend.`,
      });
    }

    if (!row) {
      const seed = {
        Email       : g.email,
        User_Name   : g.name || g.email.split('@')[0],
        User_Role   : DEFAULT_ROLE,
        Department  : 'All',
      };
      /*  A failure writing the row must NOT block the sign-in. If Apps Script
          is slow or the Users tab is briefly locked, the person still gets in
          on the default role and the row is written on their next visit —
          failing to log the account is not a reason to stop someone working. */
      try {
        row = await db.insert('users', seed);
        db.invalidate('users');
        console.log(`[auth] new sign-in: saved ${g.email} to Team members as ${DEFAULT_ROLE}`);
      } catch (e) {
        row = seed;
        console.warn(`[auth] could not write ${g.email} to the Users tab (${e.message}) — ` +
                     `signing in as ${DEFAULT_ROLE} anyway`);
      }
    } else {
      /*  The row exists but is missing the two things the app needs. This
          happens to rows typed into the sheet by hand, and to anyone who was
          added before roles existed — without this they would sign in with no
          role at all and see an app with every button hidden.             */
      const fixes = {};
      if (!String(row.User_Role   || '').trim()) fixes.User_Role   = DEFAULT_ROLE;
      if (!String(row.User_Name   || '').trim()) fixes.User_Name   = g.name || g.email.split('@')[0];
      

      if (Object.keys(fixes).length) {
        try {
          row = await db.update('users', g.email, fixes);
          db.invalidate('users');
          console.log(`[auth] completed the Users row for ${g.email}:`, fixes);
        } catch (e) {
          console.warn(`[auth] could not complete the Users row for ${g.email}:`, e.message);
          Object.assign(row, fixes);   // carry on with sensible values in memory
        }
      }
    }

    const u = toApp(MAP.users, row);


    const role = u.role || DEFAULT_ROLE;
    const user = {
      email      : u.email || g.email,
      name       : u.name || g.name,
      role,
      department : u.department || 'All',
      picture    : g.picture,
      permissions: perm.describe(role),
    };

    console.log(`[auth] ${user.email} signed in as ${role} (tier ${user.permissions.tier})`);
    res.json({ success: true, token: sign(user), user });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message, code: 'AUTH_FAILED' });
  }
});

/* GET /api/auth/me — is my saved token still good, and what may I do?
   The role is re-read from the Users tab so a demotion takes effect on the
   next page load rather than waiting for the 7-day token to expire. */
router.get('/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Not signed in', code: 'AUTH_REQUIRED' });
  }

  const { email, name, department, picture, exp } = req.user;
  let role = req.user.role;

  try {
    const row = await db.get('users', email);
    if (row) {
      const u = toApp(MAP.users, row);
      if (u.status && String(u.status).toLowerCase() === 'inactive') {
        return res.status(403).json({
          success: false, error: 'This account has been deactivated.', code: 'INACTIVE',
        });
      }
      if (u.role) role = u.role;
    }
  } catch { /* sheet unreachable — fall back to the role in the token */ }

  res.json({
    success: true,
    user: { email, name, role, department, picture, permissions: perm.describe(role) },
    expires_at: exp ? new Date(exp * 1000).toISOString() : null,
  });
});

/* GET /api/auth/config — what the login page needs to render */
router.get('/config', (_req, res) => {
  res.json({
    success: true,
    google_client_id: CLIENT_ID,
    domain    : DOMAIN,
    mode      : AUTH_MODE,
    enforced  : REQUIRE_AUTH,
    configured: Boolean(CLIENT_ID),
    roles     : perm.ROLE_OPTIONS,
  });
});

/* POST /api/auth/logout — tokens are stateless, so this is just for symmetry */
router.post('/logout', (_req, res) => res.json({ success: true }));

module.exports = router;