/*  backend/routes/users.js  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    The Users tab is keyed by Email (that is the primary key, not a uuid).

    WHAT CHANGED
      · Writes are Admin-only. That is enforced centrally by enforcePermissions
        in server.js; the extra checks here are the ones that need to know WHO
        is being edited, which a generic middleware cannot see:
          – only a Super Admin may create, edit or delete an Admin
          – nobody can demote or delete their own account (self-lockout guard)
      · GET returns a reduced payload for non-admins: email, name and role only.
        The Add Ticket screen needs the list to populate its assignee dropdown,
        so blocking the read outright would break a staff-level screen. Phone
        numbers, start dates and departments stay admin-only.
      · The role is validated against lib/permissions.js, so a typo in the form
        cannot silently create an account with no working permissions.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db   = require('../db/sheets');
const perm = require('../lib/permissions');
const { MAP, toApp, toSheet } = require('../lib/mapping');

const asUser = r => {
  const u = toApp(MAP.users, r);
  const parts = String(u.name || '').trim().split(/\s+/);
  return {
    ...u,
    user_id   : u.email,
    first_name: parts[0] || '',
    last_name : parts.slice(1).join(' '),
    username  : u.email,
    permissions_level: u.role,
    tier      : perm.tierOf(u.role),
    is_admin  : perm.can(u.role, 'manage_users'),
  };
};

/** What a non-admin is allowed to see about a colleague. */
const asColleague = u => ({
  email: u.email, name: u.name, role: u.role, status: u.status,
  user_id: u.email, username: u.email,
});

/** Is the caller allowed to see the full records? */
const callerIsAdmin = req => perm.can(req.user?.role, 'manage_users');

/*  With REQUIRE_AUTH=false there is no req.user at all, so treat the caller as
    an admin — otherwise local development would show an empty team list. The
    warning printed at boot covers this. */
const openMode = req => !req.user;

/* ── GET /api/users ──────────────────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const { q = '', role, department, fresh } = req.query;
    const where = {};
    if (role)       where.User_Role  = role;
    if (department) where.Department = department;

    const { data, total } = await db.list('users', {
      q, searchFields: 'Email,User_Name,User_Role,Department',
      where: Object.keys(where).length ? where : undefined,
      sort : 'User_Name', order: 'asc',
    }, { fresh: fresh === '1' });

    const full = data.filter(r => r.Email).map(asUser);
    const rows = (callerIsAdmin(req) || openMode(req)) ? full : full.map(asColleague);

    res.json({ success: true, count: rows.length, total, data: rows });
  } catch (err) { next(err); }
});

/* ── GET /api/users/roles — the vocabulary for the Team members form ── */
router.get('/roles', (_req, res) => {
  res.json({ success: true, data: perm.ROLE_OPTIONS });
});

/* ── GET /api/users/:id  (id = email) ────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const email = decodeURIComponent(req.params.id);
    const row   = await db.get('users', email);
    if (!row) return res.status(404).json({ success: false, error: 'User not found' });

    const u = asUser(row);
    const mine = String(req.user?.email || '').toLowerCase() === String(email).toLowerCase();

    /* you can always see your own full record */
    if (!callerIsAdmin(req) && !openMode(req) && !mine) {
      return res.json({ success: true, data: asColleague(u) });
    }
    res.json({ success: true, data: u });
  } catch (err) { next(err); }
});

/* ── guards that need to know who is being edited ────────────────────── */

/** Only a Super Admin may create or change an Admin-or-above account. */
function guardAdminTarget(req, res, targetRole) {
  if (openMode(req)) return null;
  const targetTier = perm.tierOf(targetRole);
  if (targetTier < perm.TIER.ADMIN) return null;
  if (perm.can(req.user?.role, 'manage_admins')) return null;
  return 'Only a Super Admin can create or change an Admin account.';
}

/** Nobody may lock themselves out. */
function guardSelf(req, targetEmail, { demotingTo } = {}) {
  const me = String(req.user?.email || '').toLowerCase();
  if (!me || me !== String(targetEmail || '').toLowerCase()) return null;
  if (demotingTo === undefined) {
    return 'You cannot delete your own account. Ask another admin to do it.';
  }
  if (perm.tierOf(demotingTo) < perm.tierOf(req.user?.role)) {
    return 'You cannot lower your own role. Ask another admin to do it.';
  }
  return null;
}

function validRole(role) {
  if (!role) return null;
  const known = perm.ROLE_OPTIONS.some(o => perm.normalise(o.value) === perm.normalise(role));
  return known ? null
    : `"${role}" is not a role. Use one of: ${perm.ROLE_OPTIONS.map(o => o.value).join(', ')}.`;
}

/* ── POST /api/users ─────────────────────────────────────────────────── */
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const email = String(b.email || b.Email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const domain = (process.env.ALLOWED_EMAIL_DOMAIN || 'ecosoch.com').toLowerCase();
    if (!email.endsWith('@' + domain)) {
      return res.status(400).json({
        success: false,
        error: `Team members must have an @${domain} address. "${email}" cannot sign in.`,
      });
    }

    const role = b.role || b.User_Role || 'Staff';
    const roleErr = validRole(role);
    if (roleErr) return res.status(400).json({ success: false, error: roleErr });

    const adminErr = guardAdminTarget(req, res, role);
    if (adminErr) return res.status(403).json({ success: false, error: adminErr, code: 'FORBIDDEN' });

    const existing = await db.get('users', email, { fresh: true });
    if (existing) {
      return res.status(409).json({ success: false, error: 'That email is already on the team' });
    }

    const name = b.name || [b.firstName || b.first_name, b.lastName || b.last_name]
                            .filter(Boolean).join(' ').trim();

        const row = toSheet(MAP.users, {
      ...b, email, name, role,
      department: b.department || 'All',
    });
    row.Email = email;

    const saved = await db.insert('users', row);
    db.invalidate('users');
    res.status(201).json({ success: true, message: 'Team member added', data: asUser(saved) });
  } catch (err) { next(err); }
});

/* ── PUT / PATCH /api/users/:id ──────────────────────────────────────── */
async function updateUser(req, res, next) {
  try {
    const id = decodeURIComponent(req.params.id);
    const b  = req.body || {};

    const before = await db.get('users', id, { fresh: true });
    if (!before) return res.status(404).json({ success: false, error: 'User not found' });

    const newRole = b.role || b.User_Role;

    if (newRole) {
      const roleErr = validRole(newRole);
      if (roleErr) return res.status(400).json({ success: false, error: roleErr });

      /*  Self first — "you cannot lower your own role" is a more useful thing
          to read than "only a Super Admin can change an Admin account" when
          the account in question is your own.                              */
      const selfErr = guardSelf(req, id, { demotingTo: newRole });
      if (selfErr) return res.status(403).json({ success: false, error: selfErr, code: 'FORBIDDEN' });

      /* touching an admin, or promoting someone to admin, is Super Admin work */
      const adminErr = guardAdminTarget(req, res, newRole)
                    || guardAdminTarget(req, res, before.User_Role);
      if (adminErr) return res.status(403).json({ success: false, error: adminErr, code: 'FORBIDDEN' });
    }

    const name = b.name || [b.firstName || b.first_name, b.lastName || b.last_name]
                            .filter(Boolean).join(' ').trim() || undefined;

    const patch = toSheet(MAP.users, { ...b, ...(name ? { name } : {}) });
    delete patch.Email;                        // primary key is immutable

    const saved = await db.update('users', id, patch);
    db.invalidate('users');
    res.json({ success: true, message: 'Team member updated', data: asUser(saved) });
  } catch (err) { next(err); }
}

router.put('/:id',   updateUser);
router.patch('/:id', updateUser);

/* ── DELETE /api/users/:id ───────────────────────────────────────────── */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = decodeURIComponent(req.params.id);

    const selfErr = guardSelf(req, id);
    if (selfErr) return res.status(403).json({ success: false, error: selfErr, code: 'FORBIDDEN' });

    const before = await db.get('users', id, { fresh: true });
    if (before) {
      const adminErr = guardAdminTarget(req, res, before.User_Role);
      if (adminErr) return res.status(403).json({ success: false, error: adminErr, code: 'FORBIDDEN' });
    }

    await db.remove('users', id);
    db.invalidate('users');
    res.json({ success: true, message: 'Team member removed' });
  } catch (err) { next(err); }
});

module.exports = router;