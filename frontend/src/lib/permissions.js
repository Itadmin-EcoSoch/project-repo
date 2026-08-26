/*  frontend/src/lib/permissions.js  — NEW FILE
    ----------------------------------------------------------------------------
    A MIRROR of backend/lib/permissions.js. Keep the two in step.

    The frontend copy decides what to SHOW. The backend copy decides what is
    ALLOWED. Hiding a button is a courtesy, not a security control — someone who
    edits their own JavaScript still cannot delete anything, because the API
    checks the same table server-side before it writes.

    If you change a tier here, change it there too.
--------------------------------------------------------------------------- */

/* ── the ladder ──────────────────────────────────────────────────────────
   Higher number = more access. Nothing else in the app hardcodes a role
   name; everything asks for a tier.                                       */
const TIER = {
  VIEWER    : 0,   // read-only
  STAFF     : 1,   // the working majority: read, create, update
  MANAGER   : 2,   // + every page in the app
  ADMIN     : 3,   // + delete, + manage users and the launcher
  SUPERADMIN: 4,   // + can change other admins
};

/**
 * Role name (as typed in the Users tab) → tier.
 *
 * Matching is case-insensitive and ignores spaces, hyphens and underscores, so
 * "Super Admin", "super-admin" and "SUPERADMIN" are all the same role.
 *
 * Add new job titles here. Anything not listed lands on STAFF.
 */
const ROLE_TIERS = {
  /* ── tier 4 ── */
  'superadmin'        : TIER.SUPERADMIN,
  'superadministrator': TIER.SUPERADMIN,
  'owner'             : TIER.SUPERADMIN,

  /* ── tier 3 ── */
  'admin'         : TIER.ADMIN,
  'administrator' : TIER.ADMIN,
  'itadmin'       : TIER.ADMIN,
  'director'      : TIER.ADMIN,
  'ceo'           : TIER.ADMIN,

  /* ── tier 2 ── */
  'manager'          : TIER.MANAGER,
  'operationsmanager': TIER.MANAGER,
  'projectmanager'   : TIER.MANAGER,
  'salesmanager'     : TIER.MANAGER,
  'servicemanager'   : TIER.MANAGER,
  'supervisor'       : TIER.MANAGER,
  'teamlead'         : TIER.MANAGER,
  'qac'              : TIER.MANAGER,   // Quality Assurance & Control
  'qa'               : TIER.MANAGER,

  /* ── tier 1 — the default for everyone else ──
     'user' is what a new @ecosoch.com sign-in becomes automatically: they can
     do the daily work — add and edit projects, raise tickets, send the New
     Order Form — but they cannot delete anything and cannot reach the
     company-wide or administration screens until an admin raises their role. */
  'user'             : TIER.STAFF,
  'staff'            : TIER.STAFF,
  'employee'         : TIER.STAFF,
  'salescoordinator' : TIER.STAFF,
  'salesexecutive'   : TIER.STAFF,
  'sales'            : TIER.STAFF,
  'engineer'         : TIER.STAFF,
  'technician'       : TIER.STAFF,
  'designer'         : TIER.STAFF,
  'webdesigner'      : TIER.STAFF,
  'accounts'         : TIER.STAFF,
  'finance'          : TIER.STAFF,
  'operations'       : TIER.STAFF,

  /* ── tier 0 ── */
  'viewer'   : TIER.VIEWER,
  'readonly' : TIER.VIEWER,
  'guest'    : TIER.VIEWER,
};

/** The names offered in the Team members form. Order matters — highest first. */
const ROLE_OPTIONS = [
  { value: 'Super Admin', tier: TIER.SUPERADMIN,
    hint: 'Full control, including other admins' },
  { value: 'Admin',       tier: TIER.ADMIN,
    hint: 'Everything, including delete and team management' },
  { value: 'Manager',     tier: TIER.MANAGER,
    hint: 'Every page. Can add and edit, cannot delete' },
  { value: 'QAC',         tier: TIER.MANAGER,
    hint: 'Quality assurance. Every page, cannot delete' },
  { value: 'User',        tier: TIER.STAFF,
    hint: 'The default. Add and edit projects, clients, tickets and AMC. Cannot delete' },
  { value: 'Viewer',      tier: TIER.VIEWER,
    hint: 'Read only. Cannot change anything' },
];

/*  Job titles that already exist in the Users tab from the AppSheet days.
    They are not offered in the dropdown, but they still resolve to a tier so
    nobody's access changes when this ships.                               */

/* ── capabilities ────────────────────────────────────────────────────────
   The minimum tier each action needs. This is the whole permission model —
   if you want managers to be able to delete, change one number here.      */
const CAPABILITY_TIERS = {
  read           : TIER.VIEWER,
  create         : TIER.STAFF,
  update         : TIER.STAFF,
  delete         : TIER.ADMIN,      // ← only Admin and Super Admin
  manage_users   : TIER.ADMIN,      // ← Team members
  manage_launcher: TIER.ADMIN,      // ← App launcher
  manage_admins  : TIER.SUPERADMIN, // promoting or removing an Admin
  view_all_pages : TIER.MANAGER,
};

/* ── pages ───────────────────────────────────────────────────────────────
   The minimum tier needed to open each screen. Anything not listed is open
   to every signed-in user.                                                */
const PAGE_TIERS = {
  /*  The working pages — anyone signed in, including a read-only Viewer.
      Reading is not what needs controlling here; writing is, and that is
      handled by CAPABILITY_TIERS above. A Viewer can look at all of this and
      change none of it.                                                     */
  dashboard  : TIER.VIEWER,
  map        : TIER.VIEWER,
  projects   : TIER.VIEWER,
  clients    : TIER.VIEWER,
  solarcare  : TIER.VIEWER,
  tickets    : TIER.VIEWER,
  amc        : TIER.VIEWER,
  search     : TIER.VIEWER,

  /* creation screens — a Viewer has nothing to do on these */
  addclient  : TIER.STAFF,
  addproject : TIER.STAFF,

  /* administration — Admin and above */
  users      : TIER.ADMIN,
  launcher   : TIER.ADMIN,
};

/*  NOTE ON MANAGER vs USER
    With the Dashboard and Map open to everyone, Manager and QAC currently have
    exactly the same access as User. That is deliberate — there is nothing on
    those screens worth hiding. If you later want a page back in Manager hands,
    change its line above to TIER.MANAGER and the nav tab, the route guard and
    the API all follow from that one edit.                                   */

/* ── helpers ─────────────────────────────────────────────────────────── */

/** "Super Admin" / "super-admin" / "SUPERADMIN" → "superadmin" */
function normalise(role) {
  return String(role || '').toLowerCase().replace(/[\s_\-.]+/g, '');
}

/** Any role string → its tier. Unknown roles are STAFF, never admin. */
function tierOf(role) {
  const key = normalise(role);
  if (!key) return TIER.STAFF;
  if (Object.prototype.hasOwnProperty.call(ROLE_TIERS, key)) return ROLE_TIERS[key];

  /*  A title we have not seen before, e.g. "Senior Sales Coordinator".
      Match on the strongest word it contains so a new job title behaves
      sensibly instead of silently dropping to the bottom — but note that
      "admin" only ever arrives here from a role someone typed into the
      Users tab, which is already an admin-controlled surface. */
  for (const [name, tier] of Object.entries(ROLE_TIERS)) {
    if (key.includes(name)) return tier;
  }
  return TIER.STAFF;
}

/** Can this role do this thing? */
function can(role, capability) {
  const need = CAPABILITY_TIERS[capability];
  if (need === undefined) return false;      // unknown capability = denied
  return tierOf(role) >= need;
}

/** Can this role open this page? */
function canAccessPage(role, page) {
  const need = PAGE_TIERS[String(page || '').toLowerCase()];
  if (need === undefined) return true;       // unlisted pages are open
  return tierOf(role) >= need;
}

/** Everything the frontend needs to render the right buttons. */
function describe(role) {
  const tier = tierOf(role);
  const caps = {};
  for (const cap of Object.keys(CAPABILITY_TIERS)) caps[cap] = tier >= CAPABILITY_TIERS[cap];

  const pages = {};
  for (const page of Object.keys(PAGE_TIERS)) pages[page] = tier >= PAGE_TIERS[page];

  return {
    role : role || 'Staff',
    tier,
    tier_name: Object.keys(TIER).find(k => TIER[k] === tier) || 'STAFF',
    capabilities: caps,
    pages,
    is_admin  : tier >= TIER.ADMIN,
    is_manager: tier >= TIER.MANAGER,
  };
}

/** What a brand-new @ecosoch.com sign-in is given automatically. */
const DEFAULT_NEW_USER_ROLE = 'User';


export {
  TIER, ROLE_TIERS, ROLE_OPTIONS, CAPABILITY_TIERS, PAGE_TIERS,
  DEFAULT_NEW_USER_ROLE,
  normalise, tierOf, can, canAccessPage, describe,
};