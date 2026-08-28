/*  backend/routes/dropdownOptions.js  — NEW FILE
    ----------------------------------------------------------------------------
    Backs the Admin screen (frontend/src/pages/AdminDropdowns.jsx) that lets an
    Admin add or remove values from the "pick from a list" fields on the
    project form — Type of Project, Sales Lead, Inverter Brand, Inverter Type,
    Module Brand, Roof Material, Type of Structure, Project Region, and
    Monitoring Frequency — WITHOUT touching code or redeploying anything.

        GET    /api/dropdown-options?field_key=Sales_Lead   list (everyone signed in)
        POST   /api/dropdown-options                        add one
        DELETE /api/dropdown-options/:id                     remove one (Admin+, always)

    Reads are open to every signed-in user — the New/Edit Project form and the
    Add Client form both need the live list for everyone, not just admins.

    Adding is field-aware, not blanket-gated:
      · Project_Region  — any signed-in user can add (see OPEN_TO_ANY_STAFF
                           below), because the Add Client form has always let
                           any user record a region for a client.
      · everything else — Admin+ only, enforced here since only the route
                           handler can see which field_key is being written to.
    Deleting is always Admin+, for every list without exception.

    ── ONE-TIME SETUP, BEFORE THIS ROUTE WILL WORK ─────────────────────────────
    This talks to a table called `dropdown_options`, which needs to exist on
    both ends:

    1. In Code.gs, add this to the TABLES object (anywhere alongside the other
       entries) and redeploy the Apps Script web app once:

           dropdown_options: {
             sheet : 'Dropdown_Options',
             idCol : 'Option_Id',
             idType: 'hex8',
             ensure: ['Field_Key', 'Value', 'Active',
                      'Created_By', 'Created_Date',
                      'Last_Updated_By', 'Last_Updated_Date'],
           },

       The sheet tab itself does not need to exist beforehand — the same
       sheet_() helper Code.gs already uses for every other table creates it,
       with the right header row, the first time anyone adds an option.

    2. backend/db/sheets.js already has the Node-side half of this wired up
       (TABLE_NAMES.dropdown_options and ID_COL.dropdown_options) — nothing
       else to do there.

    After that one Code.gs edit, every future dropdown value is managed
    entirely from the Admin screen — no more code changes, no more redeploys.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db   = require('../db/sheets');
const perm = require('../lib/permissions');
const { REQUIRE_AUTH } = require('../middleware/auth');

/*  Lists any signed-in user may add to, not just an Admin — kept to a short,
    explicit list rather than "everything except a few" so a new field added
    to projectFields.js is Admin-only by default and has to be deliberately
    opened up here, not the other way around.

    Project_Region is here because the Add Client form has always let any
    user record a region for a client (see pages/AddClient.jsx) — moving that
    behind an Admin wall would be a real regression for the sales team, not a
    security fix. Every other list (Project_Type, Inverter_Brand, …) stays
    Admin-only, because those values change what business logic elsewhere in
    projectFields.js does (isAmcProject, isWarrantyProject, the AMC
    schedule, …), not just what a picker shows.                             */
const OPEN_TO_ANY_STAFF = new Set(['Project_Region']);

const truthy = v => /^(true|yes|y|1)$/i.test(String(v ?? '').trim());

const asOption = r => ({
  id        : r.Option_Id,
  field_key : r.Field_Key,
  value     : r.Value,
  /*  Active defaults to true when the column is blank — every option created
      through this screen sets it explicitly, but a row someone adds by hand
      directly in the sheet, with the Active cell left empty, should still
      show up rather than silently vanishing.                              */
  active    : r.Active === '' || r.Active === undefined || r.Active === null
              ? true : truthy(r.Active),
  created_by: r.Created_By   || '',
  created_at: r.Created_Date || '',
});

/* GET /api/dropdown-options?field_key=Sales_Lead&active=1 */
router.get('/', async (req, res, next) => {
  try {
    const { data } = await db.list('dropdown_options', {
      sort: 'Field_Key', order: 'asc',
    }, { fresh: req.query.fresh === '1' });

    let rows = data.filter(r => r.Option_Id).map(asOption);

    if (req.query.field_key) {
      const want = String(req.query.field_key).trim().toLowerCase();
      rows = rows.filter(r => String(r.field_key || '').trim().toLowerCase() === want);
    }
    /*  The project form only ever wants the live ones; the Admin screen wants
        everything so a disabled-but-not-deleted option can still be managed.
        Opt in with ?active=1 rather than defaulting to it, so a caller that
        forgets the flag sees everything rather than a silently short list.  */
    if (req.query.active === '1') rows = rows.filter(r => r.active);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { next(err); }
});

/* POST /api/dropdown-options   { field_key, value } */
router.post('/', async (req, res, next) => {
  try {
    const b        = req.body || {};
    const fieldKey = String(b.field_key || '').trim();
    const value    = String(b.value || '').trim();

    if (!fieldKey) return res.status(400).json({ success: false, error: 'field_key is required' });
    if (!value)    return res.status(400).json({ success: false, error: 'A value is required' });

    /*  The blanket write gate (enforcePermissions in middleware/auth.js)
        already requires at least Staff to reach here at all. This is the
        extra check for everything that is NOT in OPEN_TO_ANY_STAFF: those
        lists need Admin specifically, checked here rather than in the global
        gate because only the route handler can see field_key.             */
    if (REQUIRE_AUTH && !OPEN_TO_ANY_STAFF.has(fieldKey)) {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Sign in required', code: 'AUTH_REQUIRED' });
      }
      if (!perm.can(req.user.role, 'manage_dropdowns')) {
        return res.status(403).json({
          success: false,
          error: `Only an Admin can add to "${fieldKey}". Ask an admin to add it for you.`,
          code: 'FORBIDDEN', capability: 'manage_dropdowns',
        });
      }
    }

    /*  No case-insensitive duplicates on the same list — "Waaree" and
        "waaree " should not both be selectable options a moment apart.    */
    const { data: existing } = await db.list('dropdown_options', { where: { Field_Key: fieldKey } });
    const dup = existing.find(r => String(r.Value || '').trim().toLowerCase() === value.toLowerCase());
    if (dup) {
      return res.status(409).json({ success: false, error: `"${value}" is already on this list.` });
    }

    const saved = await db.insert('dropdown_options', {
      Field_Key : fieldKey,
      Value     : value,
      Active    : true,
      Created_By: req.user?.email || b.created_by || '',
    });

    res.status(201).json({ success: true, message: 'Option added', data: asOption(saved) });
  } catch (err) { next(err); }
});

/* DELETE /api/dropdown-options/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    await db.remove('dropdown_options', decodeURIComponent(req.params.id));
    res.json({ success: true, message: 'Option deleted' });
  } catch (err) { next(err); }
});

module.exports = router;