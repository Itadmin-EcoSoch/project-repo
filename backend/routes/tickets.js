/*  backend/routes/tickets.js  — NEW FILE
    ----------------------------------------------------------------------------
    Ticket Generation — one of the two Solar Care operations that hang off a
    project. The other is AMC.

        Client  →  Project  →  Ticket 1, Ticket 2, Ticket 3 …

    Tickets are stored in the existing "Tickets" tab, linked to their project by
    Project_ID. Nothing new is needed in the sheet.

    ABOUT THE TICKET NUMBER
    Ticket_Id is whatever the sheet generates (a hex string on AppSheet-era rows).
    That is fine as a key but useless as a label, so "Ticket 1 / Ticket 2 / …" is
    computed per project at read time: the project's tickets are ordered oldest
    first and numbered from 1. Deleting ticket 2 renumbers the rest, which is the
    behaviour you want for a display label — it always reads 1..n with no gaps.

    If you later add a Ticket_No column to the sheet, this route writes it too;
    if the column does not exist it is quietly dropped (see pickKnownColumns).

    Endpoints
        GET    /api/tickets?project_id=&status=&q=&limit=
        GET    /api/tickets/by-project/:projectId     list + counts, for the UI
        GET    /api/tickets/:id
        POST   /api/tickets
        PATCH  /api/tickets/:id
        DELETE /api/tickets/:id
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const { MAP, toApp, toSheet } = require('../lib/mapping');
const { applyWarranty, TICKET_COLS } = require('../lib/warranty');
const { newTicketId } = require('../lib/uniqueId');

/* ── vocabulary ──────────────────────────────────────────────────────────
   Kept here as well as on the frontend so the API is usable on its own. */
const TICKET_STATUSES   = ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed', 'Cancelled'];
const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const TICKET_TYPES      = [
  'Breakdown', 'Generation Drop', 'Inverter Fault', 'Module Damage',
  'Wiring / Electrical', 'Structure', 'Monitoring', 'Cleaning Request',
  'Inspection Request', 'Other',
];

/** A ticket nobody needs to act on any more. */
const isClosed = s => /closed|resolved|cancelled|done/i.test(String(s || ''));

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Sortable number from whatever date format the sheet happens to hold. */
function dateVal(v) {
  if (!v) return 0;
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The columns that actually exist in the Tickets tab.
 *
 * Apps Script writes by header name, so sending a key the sheet has never heard
 * of is at best ignored and at worst an error. Reading the header set off a real
 * row means this route keeps working whether or not you add the optional
 * Ticket_No / Client_Id columns later.
 */
async function knownColumns() {
  try {
    const rows = await db.all('tickets');
    if (!rows.length) return null;          // empty tab — send everything, let the sheet decide
    return new Set(Object.keys(rows[0]));
  } catch { return null; }
}

function pickKnownColumns(row, cols) {
  if (!cols) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) if (cols.has(k)) out[k] = v;
  return out;
}

/**
 * Every ticket on one project, oldest first, numbered 1..n.
 * This is THE function that turns loose rows into "Ticket 1, Ticket 2, Ticket 3".
 */
function numberedForProject(rows, projectId) {
  const pid = String(projectId ?? '').trim();
  if (!pid) return [];

  return rows
    .map((r, sheetOrder) => ({ r, sheetOrder }))
    .filter(x => String(x.r.Project_ID ?? '').trim() === pid)
    .sort((a, b) => {
      const da = dateVal(a.r.Created_Date || a.r.Ticket_Start_Date);
      const dbv = dateVal(b.r.Created_Date || b.r.Ticket_Start_Date);
      if (da !== dbv) return da - dbv;
      return a.sheetOrder - b.sheetOrder;   // undated rows keep sheet order
    })
    .map((x, i) => ({
      ...toApp(MAP.tickets, x.r),
      ticket_no: i + 1,
      label    : `Ticket ${i + 1}`,
      is_closed: isClosed(x.r.Ticket_Status),
    }));
}

function summarise(tickets) {
  const closed = tickets.filter(t => t.is_closed).length;
  return {
    total : tickets.length,
    open  : tickets.length - closed,
    closed,
    next_due: tickets
      .filter(t => !t.is_closed && t.due_date)
      .sort((a, b) => dateVal(a.due_date) - dateVal(b.due_date))[0]?.due_date || null,
  };
}

/* ── GET /api/tickets/meta — the dropdown vocabulary ─────────────────── */
router.get('/meta', (_req, res) => {
  res.json({ success: true, data: {
    statuses: TICKET_STATUSES, priorities: TICKET_PRIORITIES, types: TICKET_TYPES,
  }});
});

/* ── GET /api/tickets/by-project/:projectId ──────────────────────────────
   What the project screen needs: the numbered list plus the counts, in one
   round trip.                                                             */
router.get('/by-project/:projectId', async (req, res, next) => {
  try {
    const rows    = await db.all('tickets');
    const tickets = numberedForProject(rows, req.params.projectId);
    res.json({
      success: true,
      data: { project_id: String(req.params.projectId), ...summarise(tickets), tickets },
    });
  } catch (err) { next(err); }
});

/* ── GET /api/tickets ────────────────────────────────────────────────────
   Cross-project list. Without project_id it returns everything, newest first —
   useful for a "all open tickets" screen.                                 */
router.get('/', async (req, res, next) => {
  try {
    const { project_id, status, q = '', limit = 500 } = req.query;
    const rows = await db.all('tickets');

    let out;
    if (project_id) {
      out = numberedForProject(rows, project_id);
    } else {
      /* number within each project, then flatten newest-first */
      const byProject = new Map();
      for (const r of rows) {
        const pid = String(r.Project_ID ?? '').trim();
        if (!pid) continue;
        if (!byProject.has(pid)) byProject.set(pid, numberedForProject(rows, pid));
      }
      out = [...byProject.values()].flat()
        .sort((a, b) => dateVal(b.created_at) - dateVal(a.created_at));
    }

    if (status && status !== 'All') {
      out = status === 'Open'
        ? out.filter(t => !t.is_closed)
        : out.filter(t => String(t.status || '').toLowerCase() === String(status).toLowerCase());
    }

    const needle = String(q).trim().toLowerCase();
    if (needle) {
      out = out.filter(t => [t.description, t.type, t.assigned_to, t.resolution, t.label]
        .some(v => v && String(v).toLowerCase().includes(needle)));
    }

    /* attach project + client names so a cross-project list is readable */
    const projects = await db.list('projects', { fields: 'Project_ID,Project_Name,Client_Id,Client_Name' });
    const byId = new Map(projects.data.map(p => [String(p.Project_ID), p]));
    out = out.map(t => {
      const p = byId.get(String(t.project_id));
      return { ...t,
        project_name: p?.Project_Name || null,
        client_id   : p?.Client_Id    || null,
        client_name : p?.Client_Name  || null };
    });

    const total = out.length;
    res.json({ success: true, total, data: out.slice(0, Number(limit) || 500) });
  } catch (err) { next(err); }
});

/* ── GET /api/tickets/:id — one ticket, with its place in the hierarchy ── */
router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.get('tickets', req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Ticket not found' });

    const pid  = String(row.Project_ID ?? '').trim();
    const rows = await db.all('tickets');
    const mine = numberedForProject(rows, pid);
    const me   = mine.find(t => String(t.id) === String(row.Ticket_Id)) || toApp(MAP.tickets, row);

    let project = null, client = null;
    if (pid) {
      const p = await db.get('projects', pid);
      if (p) {
        project = { id: p.Project_ID, name: p.Project_Name, area: p.Site_Area,
                    size_kwp: p.Project_Size, status: p.Project_Status };
        if (p.Client_Id) {
          const c = await db.get('clients', p.Client_Id);
          if (c) client = { id: c.Client_Id, name: c.Client_Name, phone: c.Client_Mobile };
        }
        if (!client && p.Client_Name) client = { id: p.Client_Id || null, name: p.Client_Name };
      }
    }

    res.json({
      success: true,
      data: { ...me, is_closed: isClosed(me.status),
              siblings: mine.length, project, client, _raw: row },
    });
  } catch (err) { next(err); }
});

/* ── POST /api/tickets ───────────────────────────────────────────────────
   A ticket cannot exist without a project — that is the whole point of the
   hierarchy, so it is enforced here rather than left to the sheet.        */
router.post('/', async (req, res, next) => {
  try {
    const projectId = String(req.body.project_id ?? '').trim();
    if (!projectId) {
      return res.status(400).json({ success: false,
        error: 'project_id is required — every ticket belongs to a project.' });
    }

    const project = await db.get('projects', projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: `No project found with id ${projectId}.` });
    }

    const existing = numberedForProject(await db.all('tickets'), projectId);
    const nextNo   = existing.length + 1;

    const row = toSheet(MAP.tickets, {
      ...req.body,
      project_id: projectId,
      status    : req.body.status   || 'Open',
      priority  : req.body.priority || 'Medium',
    });

    delete row.Ticket_Id;                       // the sheet generates it
    row.Project_ID   = projectId;
    row.Project_Name = project.Project_Name || '';
    row.Client_Id    = project.Client_Id    || '';
    row.Client_Name  = project.Client_Name  || '';
    row.Ticket_No    = nextNo;                  // written only if the column exists
    row.Created_By   = req.body.created_by || req.user?.email || 'app';
    row.Created_Date = new Date().toISOString();
    if (!row.Ticket_Start_Date) row.Ticket_Start_Date = new Date().toISOString().slice(0, 10);

    /*  Ticket_Warranty_End_Date and _Status are DERIVED, never typed:
            end = Ticket_Warranty_Start_Date + Ticket_Warranty_Period days
        Verified against 16 live rows. See lib/warranty.js.                */
    /*  Minted in Node and checked against the sheet — see lib/uniqueId.js.
        Apps Script's hex8_() does not look at existing ids.               */
    row.Ticket_Id = await newTicketId();

    const withWarranty = applyWarranty(row, TICKET_COLS);

    const saved = await db.insert('tickets', pickKnownColumns(withWarranty, await knownColumns()));
    db.invalidate('tickets');

    res.status(201).json({
      success: true,
      data: { ...toApp(MAP.tickets, saved), ticket_no: nextNo, label: `Ticket ${nextNo}` },
    });
  } catch (err) { next(err); }
});

/* ── PATCH /api/tickets/:id ─────────────────────────────────────────────── */
router.patch('/:id', async (req, res, next) => {
  try {
    const before = await db.get('tickets', req.params.id);
    if (!before) return res.status(404).json({ success: false, error: 'Ticket not found' });

    const patch = toSheet(MAP.tickets, req.body);
    delete patch.Ticket_Id;
    delete patch.Created_Date;
    delete patch.Project_ID;                    // a ticket never changes project
    patch.Last_Updated_By   = req.body.changed_by || req.user?.email || 'app';
    patch.Last_Updated_Date = new Date().toISOString();

    /*  Recompute the derived warranty columns, but only when this PATCH
        actually touched the start date or the period — applyWarranty returns
        the row untouched otherwise, so a PATCH that never mentioned warranty
        cannot blank it. The row is merged with `before` first so changing
        only the period still has a start date to work from.               */
    const merged  = applyWarranty({ ...before, ...patch }, TICKET_COLS);
    if (merged[TICKET_COLS.end]) {
      patch[TICKET_COLS.end]    = merged[TICKET_COLS.end];
      patch[TICKET_COLS.status] = merged[TICKET_COLS.status];
    }

    const saved = await db.update('tickets', req.params.id,
                                  pickKnownColumns(patch, await knownColumns()));
    db.invalidate('tickets');

    const mine = numberedForProject(await db.all('tickets'), before.Project_ID);
    const me   = mine.find(t => String(t.id) === String(req.params.id));

    res.json({ success: true, data: me || toApp(MAP.tickets, saved) });
  } catch (err) { next(err); }
});

/* ── DELETE /api/tickets/:id ────────────────────────────────────────────── */
router.delete('/:id', async (req, res, next) => {
  try {
    await db.remove('tickets', req.params.id);
    db.invalidate('tickets');
    res.json({ success: true, message: 'Ticket deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.numberedForProject = numberedForProject;
module.exports.summarise = summarise;
module.exports.isClosed  = isClosed;
module.exports.TICKET_STATUSES = TICKET_STATUSES;