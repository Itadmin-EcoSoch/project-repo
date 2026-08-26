/*  backend/middleware/auth.js  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    Session verification plus the permission gate.

    WHAT CHANGED
      · requireCapability(cap) added — the piece that actually stops a
        non-admin from deleting things.
      · enforcePermissions added — one middleware mounted on /api that applies
        the rules by HTTP method, so no route file has to be edited:
              DELETE anything          → needs 'delete'      (Admin+)
              write to /api/users      → needs 'manage_users'(Admin+)
              write to /api/launcher   → needs 'manage_launcher' (Admin+)
              any other write          → needs 'create'/'update' (Staff+)
      · requireRole no longer silently passes everyone when REQUIRE_AUTH is off.
        It now says so in the log the first time, so a misconfigured .env is
        visible instead of quietly disabling every check.

    IMPORTANT
      All of this is inert while REQUIRE_AUTH=false, because with no sign-in
      there is no role to check. Set REQUIRE_AUTH=true in backend/.env to turn
      the permission system on.
--------------------------------------------------------------------------- */

require('dotenv').config();

const jwt  = require('jsonwebtoken');
const perm = require('../lib/permissions');

const SECRET       = process.env.JWT_SECRET || 'change-me-in-env';
const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH || 'false').toLowerCase() === 'true';

/** Routes reachable without a token, even when REQUIRE_AUTH is on. */
const PUBLIC = [/^\/health/, /^\/api\/auth\//];

/* Warn once, loudly, rather than on every request. */
let warned = false;
function warnOpen(what) {
  if (warned) return;
  warned = true;
  console.warn(
    `\n⚠️   REQUIRE_AUTH=false — permission checks are NOT being enforced (${what}).\n` +
    `    Anyone who can reach this API can delete data. Set REQUIRE_AUTH=true in\n` +
    `    backend/.env once everyone has signed in at least once.\n`
  );
}

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return req.query.token || null;
}

function attachUser(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try { req.user = jwt.verify(token, SECRET); } catch { req.user = null; }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!REQUIRE_AUTH) return next();
  if (PUBLIC.some(rx => rx.test(req.path))) return next();
  if (req.user) return next();
  res.status(401).json({ success: false, error: 'Sign in required', code: 'AUTH_REQUIRED' });
}

/* ── the permission gate ─────────────────────────────────────────────── */

function deny(res, message, capability) {
  return res.status(403).json({
    success: false, error: message, code: 'FORBIDDEN', capability: capability || null,
  });
}

/** requireCapability('delete') — mount on a specific route when you need it. */
function requireCapability(capability) {
  return (req, res, next) => {
    if (!REQUIRE_AUTH) { warnOpen(`requireCapability('${capability}')`); return next(); }
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Sign in required', code: 'AUTH_REQUIRED' });
    }
    if (perm.can(req.user.role, capability)) return next();
    return deny(res, MESSAGES[capability] || 'You do not have permission for this action', capability);
  };
}

/** requireRole('Admin','Super Admin') — kept for compatibility. */
function requireRole(...roles) {
  const want = roles.map(r => perm.normalise(r));
  return (req, res, next) => {
    if (!REQUIRE_AUTH) { warnOpen('requireRole'); return next(); }
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Sign in required', code: 'AUTH_REQUIRED' });
    }
    if (want.includes(perm.normalise(req.user.role))) return next();
    return deny(res, 'You do not have permission for this action');
  };
}

/*  Wording matters here — a 403 is the app telling somebody they cannot do
    their job, so it should say who can instead of just refusing.          */
const MESSAGES = {
  delete         : 'Only an Admin can delete records. Ask an admin if this needs removing.',
  manage_users   : 'Only an Admin can manage team members.',
  manage_launcher: 'Only an Admin can change the app launcher.',
  manage_dropdowns: 'Only an Admin can add or remove dropdown options. Ask an admin to add it for you.',
  manage_admins  : 'Only a Super Admin can change an Admin account.',
  create         : 'Your account is read-only. Ask an admin to change your role.',
  update         : 'Your account is read-only. Ask an admin to change your role.',
};

/** Areas where even READING is restricted. */
const ADMIN_AREAS = [
  { rx: /^\/launcher\b/, capability: 'manage_launcher', writeOnly: true },
  { rx: /^\/users\b/,    capability: 'manage_users',    writeOnly: true },
  /*  /dropdown-options is deliberately NOT listed here. Project_Region is
      open for anyone signed in to add (it mirrors the existing Add Client
      form, which has always let any user record a region), while every
      other list on this same endpoint (Project_Type, Inverter_Brand, …) is
      Admin-only. One blanket rule here cannot tell those apart — the field-
      by-field check lives in routes/dropdownOptions.js instead, where the
      request body is actually visible.                                     */
];

/**
 * The single gate. Mount once, after requireAuth:
 *
 *     app.use('/api', requireAuth);
 *     app.use('/api', enforcePermissions);
 *
 * Note req.path here is relative to the mount point, so it reads '/users/x',
 * not '/api/users/x'.
 */
function enforcePermissions(req, res, next) {
  if (!REQUIRE_AUTH) { warnOpen('enforcePermissions'); return next(); }
  if (PUBLIC.some(rx => rx.test(req.originalUrl || req.path))) return next();
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Sign in required', code: 'AUTH_REQUIRED' });
  }

  const role    = req.user.role;
  const method  = req.method.toUpperCase();
  const isWrite = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';

  /* 1. administration areas */
  for (const area of ADMIN_AREAS) {
    if (!area.rx.test(req.path)) continue;
    if (area.writeOnly && !isWrite) break;      // reads handled by the route itself
    if (!perm.can(role, area.capability)) {
      return deny(res, MESSAGES[area.capability], area.capability);
    }
  }

  /* 2. deleting anything at all */
  if (method === 'DELETE' && !perm.can(role, 'delete')) {
    return deny(res, MESSAGES.delete, 'delete');
  }

  /* 3. any other write */
  if (isWrite && !perm.can(role, 'create')) {
    return deny(res, MESSAGES.create, 'create');
  }

  next();
}

/* ── token issuing ───────────────────────────────────────────────────── */

function sign(user, expiresIn = process.env.JWT_EXPIRES || '7d') {
  return jwt.sign(
    {
      email     : user.email,
      name      : user.name,
      role      : user.role,
      department: user.department,
      picture   : user.picture || null,
      /* the tier is baked into the token so the API never has to re-read the
         Users tab on every request; changing a role signs that person out of
         their elevated access at their next sign-in */
      tier      : perm.tierOf(user.role),
    },
    SECRET,
    { expiresIn }
  );
}

module.exports = {
  attachUser, requireAuth, requireRole, requireCapability, enforcePermissions,
  sign, REQUIRE_AUTH, SECRET,
};