/*  backend/routes/projects.js — Google Sheets edition  */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const { MAP, toApp, toSheet, splitGeo } = require('../lib/mapping');
const { toSheetStatus, canonicalStatus,
        projectStatusOptions, isStatusAllowed } = require('../lib/status');
const { isPaymentsDoneAllowed, paymentsDoneOptions,
        isPaymentsDoneVisible } = require('../lib/paymentsDone');
const { buildChanges, sendChangeEmail } = require('../utils/mailer');
const automations = require('../lib/automations');
const { newProjectId, newClientId, newStatusLogId } = require('../lib/uniqueId');

const GEO = 'GMap_Link';
const asProject = r => toApp(MAP.projects, r, { geoCol: GEO });

/* Columns pulled for list views — keeps the payload small on 1700+ rows. */
const LIST_FIELDS = [
  'Project_ID','Project_Name','Client_Id','Client_Name','Site_Area','Project_Size',
  'Inverter_Type','Business_Model','Project_Type','Project_Sector','System_Type',
  'System_Category','Roof_Type','Order_Value','Margin','Proposal_Model','AMC_Type',
  'Project_Status','Salesperson_Email','Client_Committment',
  'Obstacle_Removal','GMap_Link','Project_Region','Site_Address','Created_Date',
].join(',');

/* Attach the nested clients{} object the React pages expect. */
async function withClients(rows, opts = {}) {
  /*  withAddress is OFF by default and ON only for the single-project fetch.

      The edit form needs the client's billing address to work out whether
      "billing address same as site?" was answered Yes — see EditProject.jsx.
      The LIST endpoint does not: it would carry a full postal address on all
      1,542 rows, for a question no list ever asks.                         */
  const withAddress = opts.withAddress === true;

  const clients = await db.list('clients', {
      fields: 'Client_Id,Client_Name,Client_Mobile,Client_Email,Client_Region,Client_Identity,Client_Type' +
            (withAddress ? ',Client_Address,Client_GMap_Location' : ''),
  });
  const byId = new Map(), byName = new Map();
  for (const c of clients.data) {
    const obj = {
      id: c.Client_Id, name: c.Client_Name, phone: c.Client_Mobile,
      email: c.Client_Email, region: c.Client_Region, client_identity: c.Client_Identity,
      /*  Type of Client — Internal (EPC, I&C) or External (AMC). The edit form
          needs it to decide whether Type of Project should offer anything but
          AMC. Named type_of_client to match MAP.clients.

          Cheap to carry: one short word per row, and the Clients tab is
          already being read here for the name and phone anyway.          */
      type_of_client: c.Client_Type,
    };
    /*  Named billing_address to match MAP.clients, which is what every other
        screen already reads. The old code looked for `address`, a key that has
        never existed anywhere in this codebase.                             */
        if (withAddress) {
      obj.billing_address = c.Client_Address || '';
      /*  Answering Yes on the edit form copies address, coordinates AND
          region, exactly as Add Project does. The coordinates live inside
          Client_GMap_Location as "lat, lng" and are split here so the form
          does not have to know the storage format.                        */
      const geo = splitGeo(c.Client_GMap_Location);
      obj.lat = geo.lat;
      obj.lng = geo.lng;
    }
    byId.set(String(c.Client_Id), obj);
    byName.set(String(c.Client_Name || '').trim().toLowerCase(), obj);
  }
  return rows.map(p => ({
    ...p,
    clients: byId.get(String(p.client_id)) ||
             byName.get(String(p.client_name || '').trim().toLowerCase()) || null,
  }));
}
/*  The app keys LIST_FIELDS can actually populate. toApp() walks the whole of
    MAP.projects and writes every key it knows, so a row fetched with 26 columns
    still came out with 66 keys and ~40 nulls. On 1,542 rows that is roughly
    900 KB of "null" per request, built, gzipped and parsed for nothing.

    Derived from LIST_FIELDS rather than typed out, so adding a column to the
    list is still a one-line change.                                        */
const LIST_APP_KEYS = new Set(
  Object.entries(MAP.projects)
    .filter(([, col]) => LIST_FIELDS.split(',').includes(col))
    .map(([appKey]) => appKey)
    .concat(['lat', 'lng'])
);

const asListProject = r => {
  const full = asProject(r);
  const out  = {};
  for (const k of LIST_APP_KEYS) out[k] = full[k];
  return out;
};

/* GET /api/projects?status=&q=&page=&limit=&dashboard=left|right
   NOTE: post-filters (dashboard=right) are applied BEFORE pagination, otherwise
   we would slice to 100 rows and *then* drop most of them — which is why the
   dashboard used to show 16 AMC projects instead of the real 219.            */
router.get('/', async (req, res, next) => {
  try {
    const { status, q = '', page = 1, limit = 2000, dashboard, fresh } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    /*  Status filtering is done on the CANONICAL status, not the raw cell, so
        ?status=Defaulted returns both "Defaulted" and the legacy
        "Defaulted - Project Payment" rows as one set. An equality filter in
        `where` cannot express that, so it is post-filtered below.          */
    const wantStatus = status && status !== 'All' ? canonicalStatus(status) : null;

    const where = {};
    if (dashboard === 'left') where.Project_Status = 'Active';

    // pull the whole filtered set first — it is all in memory, so this is free
    const { data } = await db.list('projects', {
      q,
      /*  Project_ID FIRST — searching "3554380B" used to return nothing at all,
          because the id was not among the searched columns. The match is a
          case-insensitive substring, so a partial id ("3554") works too, as do
          partial names and areas.

          Deal_ID and Salesperson_Email are here because they are the other two
          things people paste in from an email or a quote.                    */
      /*  Match on identifiers a user searches by (name, id, client, deal id).
          Site_Area / Project_Region / Salesperson_Email were searched too, so
          a project whose hidden region or salesperson email contained the
          query surfaced with no visible reason — dropped for clearer results. */
      searchFields: 'Project_ID,Project_Name,Client_Name,Deal_ID',
      where : Object.keys(where).length ? where : undefined,
      fields: LIST_FIELDS,
      sort  : 'Created_Date',
      order : 'desc',
    }, { fresh: fresh === '1' });

    let rows = data.map(asListProject);

    if (wantStatus) rows = rows.filter(p => canonicalStatus(p.status) === wantStatus);

    // "has an AMC contract" cannot be expressed as an equality filter, because
    // an empty cell is also "not None". Do it here, before slicing.
    if (dashboard === 'right') {
      rows = rows.filter(p => p.amc_type && String(p.amc_type).trim() &&
                              p.amc_type !== 'None' && p.amc_type !== 'NA');
    }

    const total = rows.length;
    const paged = Number(limit) > 0 ? rows.slice(offset, offset + Number(limit)) : rows;

    res.json({ success: true, total, count: paged.length, data: await withClients(paged) });
  } catch (err) { next(err); }
});

/*  Attachment columns AppSheet wrote into the sheet, with the labels we want
    to show instead of the raw generated filename.                          */
const ATTACHMENTS = [
  { col: 'Quote_Sheet',       label: 'Quote Sheet',      kind: 'quote'    },
  { col: 'Proposal',          label: 'Proposal',         kind: 'proposal' },
  { col: 'Files',             label: 'Site Files',       kind: 'site'     },
  { col: 'PO_File',           label: 'Purchase Order',   kind: 'po'       },
  { col: 'Bill_File',         label: 'Bill',             kind: 'bill'     },
];

/*  GET /api/projects/new-id — mints a real Project_ID before the project
    itself exists yet.

    WHY THIS EXISTS
    File uploads on the Add Project form start the moment someone attaches a
    file, long before Save is clicked — so Code.gs's handleUploadFile needs a
    Project_ID to file each upload under right then, not later. Previously the
    frontend just made one up client-side (a random 8-hex-character string),
    which meant the id used for uploads and the REAL id this project got
    later (minted properly by newProjectId() in POST /api/orders, below)
    were two different values — the Drive folder and the saved project row
    pointed at different ids, and files ended up looking orphaned.

    This route hands out a real one up front, from the exact same generator
    orders.js uses for the final save, so both stay in sync end to end.

    Note this route sits ABOVE GET /api/projects/:id (further down this file)
    on purpose — Express matches routes top to bottom, and /:id would
    otherwise swallow "new-id" as if it were an id being looked up.         */
router.get('/new-id', async (req, res, next) => {
  try {
    const id = await newProjectId({ fresh: false });
    res.json({ success: true, data: { id } });
  } catch (err) { next(err); }
});

/* GET /api/projects/:id/attachments — resolved Drive links */
router.get('/:id/attachments', async (req, res, next) => {
  try {
    const row = await db.get('projects', req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Project not found' });

    const wanted = ATTACHMENTS
      .map(a => ({ ...a, path: String(row[a.col] || '').trim() }))
      .filter(a => a.path && a.path.includes('/'));      // ignore stray TRUE/FALSE values

    if (!wanted.length) return res.json({ success: true, data: [] });

    const resolved = await db.resolveFiles(wanted.map(a => a.path));

    res.json({
      success: true,
      data: wanted.map(a => {
        const f = resolved[a.path] || null;
        const ext = (a.path.split('.').pop() || '').toLowerCase();
        return {
          label   : a.label,
          kind    : a.kind,
          ext,
          path    : a.path,
          /*  The filename as Drive knows it. ProjectDetail falls back to this
              when the sheet's companion _Name column is empty, which is the
              case on every row imported from AppSheet. Without it that
              fallback silently resolved to undefined and older projects
              showed the machine name.                                     */
          name    : f?.name ?? null,
          found   : Boolean(f && f.id),
          id      : f?.id ?? null,
          size    : f?.size ?? null,
          mime    : f?.mime ?? null,
          view    : f?.view ?? null,
          download: f?.download ?? null,
          error   : f?.error ?? null,
        };
      }),
    });
  } catch (err) { next(err); }
});

/* GET /api/projects/:id — project + client + status logs + AMC tasks */
router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.get('projects', req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Project not found' });

    const project = asProject(row);
        const [withCli] = await withClients([project], { withAddress: true });

    // status history
    let logs = [];
    try {
      const l = await db.list('status_log', {
        where: { Project_ID: String(project.id) }, sort: 'Changed_At', order: 'desc',
      });
      logs = l.data.map(r => ({
        id: r.Log_Id, project_id: r.Project_ID, old_status: r.Old_Status,
        new_status: r.New_Status, changed_by: r.Changed_By, note: r.Note,
        changed_at: r.Changed_At,
      }));
    } catch { /* Status_Log tab not created yet — fine */ }

    // AMC tasks: Tasks_Schedule → AMC_Id → Contracts → Project_ID
    let amcTasks  = [];
    let contracts = [];
    let payments  = [];
    try {
      /*  AMC_Status is now fetched too — the Project_Status Valid_If rules
          count ACTIVE contracts, so the status column is load-bearing.     */
            /*  The extra columns are for the EDIT FORM, not for the status rules.

          cleanVisits / cleanYears / cleanStart and their inspection twins are
          transient: true in projectFields.js — no sheet column of their own —
          so EditProject seeds them from these contracts. With only four
          columns fetched, AMC_Frequency, AMC_Period_in_Years and
          AMC_Start_Date were absent from the response and every AMC box on
          the edit form opened blank.

          These rows are returned RAW, not through toApp() — unlike amcTasks
          below — so the client sees AMC_Frequency, not `frequency`.        */
      const c = await db.list('amc_contracts', {
        where: { Project_ID: String(project.id) },
        fields: 'AMC_Id,AMC_Type,Project_ID,AMC_Status,' +
                'AMC_Frequency,AMC_Period_in_Years,AMC_Start_Date,AMC_End_Date,' +
                'AMC_Contract_Files',
      });
      contracts = c.data;
      const ids = new Set(contracts.map(x => String(x.AMC_Id)));
      if (ids.size) {
        const t = await db.list('amc_tasks', { sort: 'AMC_Due_Date', order: 'asc' });
        amcTasks = t.data
          .filter(r => ids.has(String(r.AMC_Id)) || String(r.Project_ID) === String(project.id))
          .map(r => toApp(MAP.amc_tasks, r));

        const pay = await db.list('amc_payments', { fields: 'Payment_Id,AMC_Id,Payment_Amount' });
        payments = pay.data.filter(r => ids.has(String(r.AMC_Id)));
      }
    } catch { /* ignore */ }

    /*  Which statuses may be picked right now — the AppSheet Valid_If port.
        Base list comes from the live Dropdowns tab when available so the sheet
        stays the single source of truth; lib/status.js only holds a fallback. */
    let statusChoice;
    try {
      const look = await db.lookups();
      statusChoice = projectStatusOptions({
        isNew       : !String(row.Project_Status ?? '').trim(),
        projectType : row.Project_Type,
        amcProvided : row.AMC_Provided,
        amcType     : row.AMC_Type,
        contracts, payments,
        base        : (look && look.Project_Status && look.Project_Status.length)
                        ? look.Project_Status : undefined,
      });
    } catch {
      statusChoice = projectStatusOptions({
        isNew       : !String(row.Project_Status ?? '').trim(),
        projectType : row.Project_Type,
        amcProvided : row.AMC_Provided,
        amcType     : row.AMC_Type,
        contracts, payments,
      });
    }

    /*  The stored value is always offered, even when a rule would now exclude
        it. Otherwise opening an older project whose AMC setup has since gone
        incomplete would show a dropdown that cannot represent its own current
        state, and any save would silently change the status.                */
    const current = canonicalStatus(row.Project_Status);
    if (current && !statusChoice.options.some(o => canonicalStatus(o) === current)) {
      statusChoice = {
        ...statusChoice,
        options: statusChoice.options.concat(current),
        reason : statusChoice.reason + ' (current value kept)',
      };
    }

    res.json({
      success: true,
      data: {
              ...withCli, _raw: row, status_logs: logs, amc_tasks: amcTasks,
        /*  contracts WAS FETCHED AND THEN THROWN AWAY. It was read above for
            projectStatusOptions and never put in the response, so the edit
            form's `p.contracts` was undefined, its seeding loop iterated an
            empty array, and every AMC term box — visits per year, number of
            years, start date — opened blank on a project that had a contract.

            Worse than cosmetic: those boxes are the INPUTS that regenerate
            the visit schedule on save, so pressing Save Changes rebuilt the
            whole schedule from empty values.                              */
        contracts,
        status_options: statusChoice.options,
        status_rule   : { rule: statusChoice.rule, reason: statusChoice.reason },
      },
    });
  } catch (err) { next(err); }
});

/* POST /api/projects */
router.post('/', async (req, res, next) => {
  try {
    const row = toSheet(MAP.projects, req.body, { geoCol: GEO });
    /*  Project_ID is minted here, in Node — see lib/uniqueId.js.
        8 characters, base62, checked against every id already in the sheet. */
    row.Project_ID = await newProjectId();
    row.Created_By      = req.body.changed_by || req.body.submitted_by || 'app';
    /*  CLAUSE 1 of the AppSheet Valid_If:
            if(ISBLANK(LOOKUP([_THISROW],"Projects","Project_ID","Project_Status")),
               list('Active'), ...)

        A row that does not exist in Projects yet has exactly ONE valid status.
        This used to be `toSheetStatus(...) || 'Active'`, which defaulted to
        Active but happily accepted "Under SolarCare" or "Completed" if a
        caller sent one — so a project could be born already under SolarCare,
        which AppSheet refuses. Forced, not defaulted.

        Anything else the caller sent is reported back rather than silently
        dropped, so a mistaken client learns why.                            */
    const requested = toSheetStatus(row.Project_Status);
    if (requested && canonicalStatus(requested) !== 'Active') {
      return res.status(422).json({
        success: false,
        error  : `A new project must start as "Active" — "${requested}" can only be set ` +
                 `after it exists. Create it, then change the status.`,
        allowed: ['Active'],
      });
    }
    row.Project_Status  = 'Active';

    // resolve client name if only the id was given
    if (row.Client_Id && !row.Client_Name) {
      const c = await db.get('clients', row.Client_Id);
      if (c) row.Client_Name = c.Client_Name;
    }
    if (!row.Project_Name) {
      row.Project_Name = [row.Client_Name, row.Site_Area,
                          row.Project_Size ? row.Project_Size + 'kW' : '', row.Inverter_Type]
                         .filter(Boolean).join('_');
    }

    const saved = await db.insert('projects', row);

        /*  Best effort, and it must STAY best effort. The trailing .catch() could
        not catch a failure from `await newStatusLogId()`, because that runs
        while building the ARGUMENT, before db.insert exists to attach a
        .catch to. The project row was already written by then, so a failure
        here returned a 500 on a save that had actually succeeded.          */
    try {
      await db.insert('status_log', {
        Log_Id    : await newStatusLogId({ fresh: false }),
        Project_ID: saved.Project_ID, Old_Status: '', New_Status: saved.Project_Status,
        Changed_By: row.Created_By, Note: 'Created', Changed_At: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(`[status_log] could not log creation of ${saved.Project_ID}: ${e.message}`);
    }

    res.status(201).json({ success: true, data: asProject(saved) });
  } catch (err) { next(err); }
});

/*  Sheet column → app key, so a caller may send either spelling.

    The Edit form sends sheet columns (Project_Size, Order_Value…) because the
    field spec is keyed that way. The write worked — toSheet passes those through
    untouched — but the change detection below only recognised app keys, so
    `changes` came back empty and the "Send Update" button never enabled.     */
const APP_BY_COL = Object.fromEntries(
  Object.entries(MAP.projects).map(([app, col]) => [String(col), app])
);

/** Project_Size → "Project Size", for columns with no label of their own. */
const prettyCol = c =>
  String(c).replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

/*  ── FILE COLUMNS IN THE CHANGES TABLE ────────────────────────────────────

    An attachment is TWO columns: the path (Quote_Sheet) and the name the user
    uploaded it under (Quote_Sheet_Name). Changing one file therefore changed
    two columns, and the update email printed both as separate rows — one
    showing an internal path nobody recognises:

        Quote Sheet       X2LgXPB2/X2LgXPB2.Quote_Sheet.5441112.xlsx
                       -> X2LgXPB2/X2LgXPB2.Quote_Sheet.7406670.pdf
        Quote Sheet Name  BOM for_Chandrabhas Narayana_ 4.34kWp…xlsx
                       -> DWG - EL - 001_Gagan Reddy_8.4kWp…pdf

    Neither row was wrong, but together they report one edit twice and lead
    with the version nobody can read.

    Two things happen below. The path column borrows the NAME column's value,
    so the row shows the filename that was actually uploaded; and the _Name
    column is dropped, because the row above it now says the same thing.

    The labels match the form and the New Order email exactly. Without them
    prettyCol turned Quote_Sheet into "Quote Sheet", while the field is called
    "Cost Breakdown Sheet" on screen — so the email named a field the person
    editing had never seen.                                                 */
const FILE_COL_LABELS = {
  Quote_Sheet : 'Cost Breakdown Sheet',
  Proposal    : 'Proposal',
  Files       : 'Other Files',
  PO_File     : 'Purchase Order',
  Bill_File   : 'Electricity Bill photo',
};

/** "X2LgXPB2/X2LgXPB2.Quote_Sheet.7406670.pdf" -> the bit after the last "/" */
const baseName = v => String(v || '').split('/').pop().trim();

/* PATCH /api/projects/:id */
router.patch('/:id', async (req, res, next) => {
  try {
    const { changed_by, note, suppress_auto_email, ...updates } = req.body;

    const beforeRow = await db.get('projects', req.params.id, { fresh: true });
    if (!beforeRow) return res.status(404).json({ success: false, error: 'Project not found' });

    const patch = toSheet(MAP.projects, updates, { geoCol: GEO });
    delete patch.Project_ID;
    delete patch.Created_Date;
    patch.Last_Updated_By = changed_by || 'app';

    /*  One spelling only. Without this the Edit form wrote "Defaulted" while
        the sheet already held "Defaulted - Project Payment", and the projects
        list showed the same status as two separate chips.                   */
    if (Object.prototype.hasOwnProperty.call(patch, 'Project_Status')) {
      patch.Project_Status = toSheetStatus(patch.Project_Status);

      /*  AppSheet's Valid_If REJECTS an out-of-rule status rather than just
          hiding it, so the same guard belongs here — the API is reachable from
          curl and any future client, not only the Edit form.

          Only a CHANGE is checked. Re-saving a project without touching its
          status must never fail, or an older row whose AMC setup has since
          gone incomplete would become uneditable.                          */
      const nextStatus = canonicalStatus(patch.Project_Status);
      const prevStatus = canonicalStatus(beforeRow.Project_Status);

      if (nextStatus && nextStatus !== prevStatus) {
        let contracts = [], payments = [];
        try {
          const c = await db.list('amc_contracts', {
            where: { Project_ID: String(req.params.id) },
            fields: 'AMC_Id,AMC_Type,Project_ID,AMC_Status',
          });
          contracts = c.data;
          const ids = new Set(contracts.map(x => String(x.AMC_Id)));
          if (ids.size) {
            const pay = await db.list('amc_payments', { fields: 'Payment_Id,AMC_Id,Payment_Amount' });
            payments = pay.data.filter(r => ids.has(String(r.AMC_Id)));
          }
        } catch { /* tabs missing — fall through to the base rules */ }

        const ctx = {
          isNew      : false,
          projectType: beforeRow.Project_Type,
          amcProvided: beforeRow.AMC_Provided,
          amcType    : beforeRow.AMC_Type,
          contracts, payments,
        };
        if (!isStatusAllowed(patch.Project_Status, ctx)) {
          const choice = projectStatusOptions(ctx);

          /*  WARN by default, REJECT only when explicitly switched on.

              checkStatusRules.js found 116 projects sitting on rule 3, every
              one reporting "0 active contract(s)". Until it is confirmed that
              those AMC contracts genuinely do not exist — rather than simply
              not linking — a hard 422 would lock real projects out of a status
              change for a reason that may be a data-linkage artefact.

              Set STATUS_RULES_ENFORCE=true in .env once checkAmcLink.js says
              the link is healthy. The rule still drives the dropdown either
              way; this only controls whether the API refuses the write.    */
          if (String(process.env.STATUS_RULES_ENFORCE).toLowerCase() === 'true') {
            return res.status(422).json({
              success: false,
              error  : `"${patch.Project_Status}" is not a valid status for this project. ${choice.reason}.`,
              allowed: choice.options,
            });
          }
          console.warn(
            `[status] ${req.params.id}: "${patch.Project_Status}" is outside the ` +
            `Valid_If rules (${choice.reason}). Allowed now: ${choice.options.join(', ')}. ` +
            `Writing anyway — set STATUS_RULES_ENFORCE=true to block.`
          );
        }
      }
    }

    /*  Projects.Payments_Done VALID_IF — see lib/paymentsDone.js.

        Checked against the row AS IT WILL BE, not as it was: a single PATCH
        can move a project to "Defaulted - Project Payment" and set
        Payments_Done in the same call, and the rule has to see the new status.

        Only a CHANGE is checked, so re-saving a project never fails on a value
        it already holds.                                                    */
    if (Object.prototype.hasOwnProperty.call(patch, 'Payments_Done')) {
      const after = { ...beforeRow, ...patch };
      if (String(patch.Payments_Done ?? '') !== String(beforeRow.Payments_Done ?? '')) {
        if (!isPaymentsDoneAllowed(patch.Payments_Done, after, beforeRow.Payments_Done)) {
          const choice = paymentsDoneOptions(after, beforeRow.Payments_Done);
          return res.status(422).json({
            success: false,
            error  : `"${patch.Payments_Done}" is not valid for Payments_Done. ${choice.reason}.`,
            allowed: choice.options.map(v => (v ? 'Yes' : 'No')),
          });
        }
      }
      /*  SHOW_IF — a hidden column is not answerable, so a value sent for one
          is dropped rather than written. Mirrors AppSheet, where the column
          simply is not on the form for AMC projects or other statuses.     */
      if (!isPaymentsDoneVisible(after)) delete patch.Payments_Done;
    }

    const saved  = await db.update('projects', req.params.id, patch);
    const data   = asProject(saved);
    const before = asProject(beforeRow);
    const [withCli] = await withClients([data]);

        /*  db.update() has already committed by this point, so nothing in here
        may be allowed to fail the response. See the matching block in POST. */
    if (patch.Project_Status && patch.Project_Status !== beforeRow.Project_Status) {
      try {
        await db.insert('status_log', {
          Log_Id    : await newStatusLogId({ fresh: false }),
          Project_ID: req.params.id,
          Old_Status: beforeRow.Project_Status || '',
          New_Status: patch.Project_Status,
          Changed_By: changed_by || 'app',
          Note      : note || '',
          Changed_At: new Date().toISOString(),
        });
      } catch (e) {
        console.warn(`[status_log] could not log status change on ${req.params.id}: ${e.message}`);
      }
    }

    /*  Labels use the same wording as the New Order Form, so a change email
        reads consistently with the original. Anything not listed here is saved
        but not reported as a change.                                        */
    const labels = {
      area:'Area', site_address:'Postal address of site', size_kwp:'Capacity (in kWp)',
      inverter_type:'Inverter Type', inverter_brand:'Inverter Brand',
      module_brand:'Module Brand', module_wattage:'Module Wattage (Wp)', module_no:'No.of Modules',
      scheme:'Business Model', project_type:'Type of Project', building_type:'Building Type',
      sector:'Project Sector', system_type:'System Type', system_category:'System Category',
      roof_type:'Type of Roof', roof_material:'Roof Material',
      amc_provided:'Is there a separate AMC provided?', amc_type:'Type of AMC Contract',
      obstacles:'Are there any obstacles to be removed before installation?',
      obstacle_scope:'Is the removal of the obstacle in Client or EcoSoch scope?',
      order_value:'Order Value', ecosoch_margin_pct:'Margin %',
      proposal_model:'Proposal Model', salesperson_email:'Salesperson',
      commitment:'What have you committed to the client as a salesperson?',
      status:'Current Project Status',
      region:'Project Region', comments:'Project Comments',
      description:'Points specific to this Project',
      billing_name:'Billing Name', discom_name:'DISCOM Documentation Name',
      gst_number:'GSTIN Number', deal_id:'Deal ID in Zoho',
      subsidy:'Is this a subsidy project?', bescom:'Can we apply for DISCOM before TSV?',
      monitoring:'Is generation monitoring committed to the client?',
      sales_lead:'Sales Lead',
      exp_inst_date:'Expected Installation Date',
      exp_commsn_date:'Expected Commissioning Date',
    };
    /*  Compare ONLY the fields the client actually sent.

        toApp() walks the whole MAP and writes every app key, filling anything
        absent from the patch with null. Handing that straight to buildChanges
        made every untouched field look like it had been cleared — which is why
        an edit could report "Sales Lead: Srilekha Thuraka -> —" without anyone
        having touched Sales Lead. Restricting it to the keys present in the
        request body fixes that.                                             */
    const afterAll = toApp(MAP.projects, patch, { geoCol: GEO });
    const afterSent = {};
    for (const key of Object.keys(updates)) {
      /* accept the app key or the sheet column it maps to */
      const appKey = (key in afterAll) ? key : APP_BY_COL[key];
      if (appKey && appKey in afterAll) afterSent[appKey] = afterAll[appKey];
    }
    /* lat/lng both write the single GMap_Link column */
    if ('lat' in updates || 'lng' in updates) {
      afterSent.lat = afterAll.lat;
      afterSent.lng = afterAll.lng;
    }

    /*  AppSheet bots: Client_Status follows the defaulted projects, and a
        handover to Under SolarCare emails the team. Fire-and-forget — an
        automation must never stop a project from saving. */
    automations.onProjectUpdated(beforeRow, { ...beforeRow, ...patch })
      .catch(e => console.error('[automation] update:', e.message));

    const changes = buildChanges(before, afterSent, labels);

    /*  buildChanges only reports fields that appear in `labels`, which covers
        about twenty of the sixty columns. The rest — Quotation_Name, Referral,
        GST_Available and so on — are just as worth reporting, so they are
        compared straight off the raw row.                                   */
    const already = new Set(changes.map(c => c.label));
    const SKIP = new Set(['Last_Updated_By', 'Last_Updated_Date', 'Project_ID', 'Created_Date']);

    for (const [col, val] of Object.entries(patch)) {
      if (SKIP.has(col)) continue;
      if (APP_BY_COL[col] && labels[APP_BY_COL[col]]) continue;   // handled above

      /*  Drop the companion name column when its file column is in this same
          patch — the file row below reports the change already. Kept as its
          own row only if somebody edited the name WITHOUT changing the file,
          which the form cannot do but a script could.                      */
      if (col.endsWith('_Name') && FILE_COL_LABELS[col.slice(0, -5)] &&
          col.slice(0, -5) in patch) {
        continue;
      }

      const isFileCol = Object.prototype.hasOwnProperty.call(FILE_COL_LABELS, col);
      const norm = v => (v === null || v === undefined || v === '') ? '—' : String(v).trim();

      /*  ── DECIDE ON THE PATH, DISPLAY THE NAME ─────────────────────────
          These two must not be the same value, and conflating them was a bug.

          The previous version swapped in the _Name column BEFORE the equality
          check. When a new file was uploaded but PO_File_Name was not part of
          the same patch, `to` fell back to the row's EXISTING name — so it
          compared the old name against the old name, concluded nothing had
          changed, and dropped the row. If that file was the only edit, the
          response carried changes: [] and the Send Update button stayed
          disabled on a save that had genuinely happened.

          So: the PATH decides whether something changed, because the path is
          what actually changed. The NAME is only ever used for display, and
          only after the comparison has been made.                        */
      if (norm(beforeRow[col]) === norm(val)) continue;

      let from = beforeRow[col];
      let to   = val;

      /*  The stored shape (PROJECTID.Column.stamp.ext) is deliberate — it is
          what keeps names unique in Drive and what findFile_ resolves against
          — but it is machinery, and machinery does not belong in an email to
          the sales team. Falls back to the last path segment when the _Name
          column is empty, which is the case on older AppSheet rows.       */
      if (isFileCol) {
        from = beforeRow[`${col}_Name`] || baseName(from) || '—';
        to   = (`${col}_Name` in patch && patch[`${col}_Name`])
               || baseName(to) || '—';
      }

      const label = isFileCol ? FILE_COL_LABELS[col] : prettyCol(col);
      if (already.has(label)) continue;
      already.add(label);
      changes.push({ label, from: norm(from), to: norm(to) });
    }

    /*  The edit form sends suppress_auto_email so it can show the changes in a
        preview and email them as a threaded reply instead — see
        POST /api/new-order/:id/send-update. Any other caller keeps the old
        fire-and-forget behaviour.                                           */
    if (!req.body.suppress_auto_email) {
      sendChangeEmail({
        subject   : `[EcoSoch] Project updated: ${data.name}`,
        heading   : 'A project record was updated',
        entityName: `${data.name}${withCli.clients?.name ? ' · ' + withCli.clients.name : ''}`,
        editedBy  : changed_by || 'staff',
        changes,
      }).catch(e => console.error('[mail] project update:', e.message));
    }

    res.json({ success: true, data: withCli, changes });
  } catch (err) { next(err); }
});

/* DELETE /api/projects/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    await db.remove('projects', req.params.id);
    res.json({ success: true, message: 'Project deleted' });
  } catch (err) { next(err); }
});

module.exports = router;