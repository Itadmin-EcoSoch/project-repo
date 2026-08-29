/*  backend/routes/solarcare.js  — NEW FILE
    ----------------------------------------------------------------------------
    One place that answers "what is going on under this client / this project",
    so the UI does not have to stitch five endpoints together on every screen.

    THE HIERARCHY THIS SERVES

        Client
          └── Project                     (a client may have 1, 3, or many)
                ├── Ticket Generation
                │     └── Ticket 1, Ticket 2, Ticket 3 …
                └── AMC
                      ├── Inspection contract
                      │     └── Visit 1, Visit 2, Visit 3 …
                      └── Cleaning contract
                            └── Visit 1, Visit 2, Visit 3 …

    A client who takes both Inspection and Cleaning simply has two AMC contract
    rows on the same project. "Both" is a choice on the form, never a stored type.

    Endpoints
        GET /api/solarcare/clients                    all clients + roll-up counts
        GET /api/solarcare/clients/:clientId          one client, its projects,
                                                      and each project's ops
        GET /api/solarcare/projects/:projectId        one project: tickets + AMC
        GET /api/solarcare/stats                      totals, for the dashboard

    Everything reads from db/sheets.js, which keeps whole tabs in memory — so
    these joins are done in Node and cost no extra Apps Script calls.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const { numberedForProject, summarise, isClosed } = require('./tickets');
const { effectiveStatus } = require('../lib/amcStatus');

/* ── shared helpers ──────────────────────────────────────────────────── */

const s = v => String(v ?? '').trim();
const visitDone = v => /done|complete/i.test(s(v.AMC_Task_Status || v.Status));

function dateVal(v) {
  if (!v) return 0;
  const str = s(v);
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const t = Date.parse(str);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Assigns every visit row to exactly one contract, returning Map<AMC_Id, visits[]>.
 *
 * Why an index instead of filtering per contract:
 *   Rows written by this app always carry AMC_Id, so they match directly. Rows
 *   imported from AppSheet often carry only Project_ID + AMC_Type, so they have
 *   to be matched on the type. Doing that match per-contract is wrong the moment
 *   a project has TWO contracts of the same type — say a 2025 Cleaning contract
 *   that has since been renewed. Both would claim the same id-less visits and
 *   the renewal would report 14 visits when it scheduled 12.
 *
 *   So id-less visits are adopted by exactly one contract: the earliest-starting
 *   contract of that type on that project. Every visit is counted once, and a
 *   renewed contract shows only the visits it actually generated.
 */
function indexVisits(allContracts, allVisits) {
  const byId = new Map();
  for (const c of allContracts) {
    const id = s(c.AMC_Id);
    if (id) byId.set(id, []);
  }

  /* "projectId|type" -> the AMC_Id that adopts untagged visits */
  const adopter = new Map();
  const oldestFirst = [...allContracts]
    .sort((a, b) => dateVal(a.AMC_Start_Date) - dateVal(b.AMC_Start_Date));
  for (const c of oldestFirst) {
    const key = `${s(c.Project_ID)}|${s(c.AMC_Type).toLowerCase()}`;
    if (!adopter.has(key)) adopter.set(key, s(c.AMC_Id));
  }

  const untagged = [];
  for (const v of allVisits) {
    const vid = s(v.AMC_Id);
    if (!vid) { untagged.push(v); continue; }
    if (!byId.has(vid)) byId.set(vid, []);   // visit points at a deleted contract
    byId.get(vid).push(v);
  }

  for (const v of untagged) {
    const id = adopter.get(`${s(v.Project_ID)}|${s(v.AMC_Type).toLowerCase()}`);
    if (id && byId.has(id)) byId.get(id).push(v);
  }

  for (const list of byId.values()) {
    list.sort((a, b) => dateVal(a.AMC_Due_Date) - dateVal(b.AMC_Due_Date));
  }
  return byId;
}

/** Map<AMC_Id, payments[]> so a contract's status can factor in its payments. */
function indexPayments(allPayments = []) {
  const m = new Map();
  for (const p of allPayments) {
    const id = s(p.AMC_Id);
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(p);
  }
  return m;
}

/** One contract, summarised for a list row. */
function contractSummary(contract, visitIndex, paymentIndex) {
  const visits    = visitIndex.get(s(contract.AMC_Id)) || [];
  const payments  = (paymentIndex && paymentIndex.get(s(contract.AMC_Id))) || [];
  const completed = visits.filter(visitDone).length;
  const next      = visits.find(v => !visitDone(v));

  return {
    amc_id          : contract.AMC_Id,
    amc_type        : contract.AMC_Type,
    /*  Derived so a fully-done contract reads "Completed" even before a write
        has synced AMC_Status; syncContractStatus keeps the sheet itself right. */
    status          : effectiveStatus(contract, visits, payments),
    /* visits per year — the "how many site visits per year" answer */
    frequency       : contract.AMC_Frequency,
    /* how many years the contract runs */
    period_years    : contract.AMC_Period_in_Years,
    start_date      : contract.AMC_Start_Date,
    end_date        : contract.AMC_End_Date,
    payment_available: contract.Payment_Available,
    payment_amount  : contract.Payment_Amount,
    payment_frequency: contract.Payment_Frequency,
    total_visits    : visits.length,
    completed_visits: completed,
    pending_visits  : visits.length - completed,
    next_visit_date : next ? next.AMC_Due_Date : null,
    progress_pct    : visits.length ? Math.round((completed / visits.length) * 100) : 0,
  };
}

/** Every AMC contract on a project, ordered Cleaning / Inspection alphabetically
 *  so the two rows never swap places between renders. */
function contractsForProject(projectId, allContracts, visitIndex, paymentIndex) {
  const pid = s(projectId);
  return allContracts
    .filter(c => s(c.Project_ID) === pid)
    .map(c => contractSummary(c, visitIndex, paymentIndex))
    .sort((a, b) => s(a.amc_type).localeCompare(s(b.amc_type)));
}

/** Which projects belong to a client — by id, falling back to name.
 *  Some AppSheet-era project rows have a blank Client_Id but a filled
 *  Client_Name, and dropping those would hide real projects. */
function projectsForClient(client, allProjects) {
  const id      = s(client.Client_Id);
  const nameKey = s(client.Client_Name).toLowerCase();
  return allProjects.filter(p =>
    (id && s(p.Client_Id) === id) ||
    (nameKey && s(p.Client_Name).toLowerCase() === nameKey));
}

/* ── GET /api/solarcare/clients ──────────────────────────────────────────
   The tree's top level: every client with enough numbers to decide whether
   it is worth expanding.                                                  */
router.get('/clients', async (req, res, next) => {
  try {
    const { q = '', limit = 2000, only_active } = req.query;

    const [clients, projects, contracts, visits, tickets] = await Promise.all([
      db.all('clients'), db.all('projects'), db.all('amc_contracts'),
      db.all('amc_tasks'), db.all('tickets'),
    ]);
    const payments = await db.all('amc_payments');
    const paymentIndex = indexPayments(payments);

    /* index once, then walk clients — otherwise this is O(clients × projects) */
    const ticketsByProject = new Map();
    for (const t of tickets) {
      const pid = s(t.Project_ID);
      if (!pid) continue;
      if (!ticketsByProject.has(pid)) ticketsByProject.set(pid, []);
      ticketsByProject.get(pid).push(t);
    }

    const contractsByProject = new Map();
    for (const c of contracts) {
      const pid = s(c.Project_ID);
      if (!pid) continue;
      if (!contractsByProject.has(pid)) contractsByProject.set(pid, []);
      contractsByProject.get(pid).push(c);
    }

    const visitIndex = indexVisits(contracts, visits);
    const needle     = s(q).toLowerCase();

    let rows = clients.map(c => {
      const mine = projectsForClient(c, projects);
      let openTickets = 0, totalTickets = 0, amcCount = 0, pendingVisits = 0;

      for (const p of mine) {
        const pid = s(p.Project_ID);
        const ts  = ticketsByProject.get(pid) || [];
        totalTickets += ts.length;
        openTickets  += ts.filter(t => !isClosed(t.Ticket_Status)).length;

        const cs = contractsByProject.get(pid) || [];
        amcCount += cs.length;
        for (const contract of cs) {
          const list = visitIndex.get(s(contract.AMC_Id)) || [];
          pendingVisits += list.filter(v => !visitDone(v)).length;
        }
      }

      return {
        id      : c.Client_Id,
        name    : c.Client_Name,
        phone   : c.Client_Mobile,
        email   : c.Client_Email,
        region  : c.Client_Region,
        identity: c.Client_Identity,
        projects_count : mine.length,
        tickets_total  : totalTickets,
        tickets_open   : openTickets,
        amc_contracts  : amcCount,
        pending_visits : pendingVisits,
      };
    });

    if (needle) {
      rows = rows.filter(r => [r.name, r.phone, r.email]
        .some(v => v && String(v).toLowerCase().includes(needle)));
    }
    if (only_active === '1') {
      rows = rows.filter(r => r.projects_count > 0);
    }

    rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    res.json({ success: true, total: rows.length, data: rows.slice(0, Number(limit) || 2000) });
  } catch (err) { next(err); }
});

/* ── GET /api/solarcare/clients/:clientId ────────────────────────────────
   One client and everything underneath, two levels deep. This is the payload
   the tree screen renders in a single request.                            */
router.get('/clients/:clientId', async (req, res, next) => {
  try {
    const client = await db.get('clients', req.params.clientId);
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    const [projects, contracts, visits, tickets, payments] = await Promise.all([
      db.all('projects'), db.all('amc_contracts'), db.all('amc_tasks'),
      db.all('tickets'), db.all('amc_payments'),
    ]);

    const mine         = projectsForClient(client, projects);
    const visitIndex   = indexVisits(contracts, visits);
    const paymentIndex = indexPayments(payments);

    const out = mine.map(p => {
      const pid         = s(p.Project_ID);
      const projTickets = numberedForProject(tickets, pid);
      const amc         = contractsForProject(pid, contracts, visitIndex, paymentIndex);

      return {
        id        : p.Project_ID,
        name      : p.Project_Name,
        area      : p.Site_Area,
        size_kwp  : p.Project_Size,
        status    : p.Project_Status,
        amc_type  : p.AMC_Type,
        created_at: p.Created_Date,

        /* operation 1 of 2 */
        tickets: {
          ...summarise(projTickets),
          /* the three most recent, so the tree can preview without a second call */
          recent: projTickets.slice(-3).reverse(),
        },

        /* operation 2 of 2 */
        amc: {
          count           : amc.length,
          has_inspection  : amc.some(c => /insp/i.test(s(c.amc_type))),
          has_cleaning    : amc.some(c => /clean/i.test(s(c.amc_type))),
          total_visits    : amc.reduce((n, c) => n + c.total_visits, 0),
          completed_visits: amc.reduce((n, c) => n + c.completed_visits, 0),
          pending_visits  : amc.reduce((n, c) => n + c.pending_visits, 0),
          list            : amc,
        },
      };
    });

    res.json({
      success: true,
      data: {
        client: {
          id: client.Client_Id, name: client.Client_Name, phone: client.Client_Mobile,
          email: client.Client_Email, region: client.Client_Region,
          identity: client.Client_Identity, address: client.Client_Address,
        },
        projects      : out,
        projects_count: out.length,
        totals: {
          tickets_total : out.reduce((n, p) => n + p.tickets.total, 0),
          tickets_open  : out.reduce((n, p) => n + p.tickets.open, 0),
          amc_contracts : out.reduce((n, p) => n + p.amc.count, 0),
          total_visits  : out.reduce((n, p) => n + p.amc.total_visits, 0),
          pending_visits: out.reduce((n, p) => n + p.amc.pending_visits, 0),
        },
      },
    });
  } catch (err) { next(err); }
});

/* ── GET /api/solarcare/projects/:projectId ──────────────────────────────
   One project with both operations expanded — the project Solar Care screen. */
router.get('/projects/:projectId', async (req, res, next) => {
  try {
    const project = await db.get('projects', req.params.projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const [contracts, visits, tickets, payments] = await Promise.all([
      db.all('amc_contracts'), db.all('amc_tasks'), db.all('tickets'),
      db.all('amc_payments'),
    ]);
    const paymentIndex = indexPayments(payments);

    let client = null;
    if (project.Client_Id) {
      const c = await db.get('clients', project.Client_Id);
      if (c) client = { id: c.Client_Id, name: c.Client_Name, phone: c.Client_Mobile,
                        email: c.Client_Email };
    }
    /*  Legacy/AppSheet rows sometimes lack Client_Id but have Client_Name.
        Resolve the id by name so the client name can hyperlink.            */
    if (!client && project.Client_Name) {
      let byName = null;
      try {
        const clients = await db.all('clients');
        byName = clients.find(c => s(c.Client_Name).toLowerCase() === s(project.Client_Name).toLowerCase()) || null;
      } catch (e) { /* fall back to unlinked */ }
      client = byName
        ? { id: byName.Client_Id, name: byName.Client_Name, phone: byName.Client_Mobile, email: byName.Client_Email }
        : { id: null, name: project.Client_Name };
    }

    const pid         = s(project.Project_ID);
    const projTickets = numberedForProject(tickets, pid);
    const amc         = contractsForProject(pid, contracts, indexVisits(contracts, visits), paymentIndex);

    res.json({
      success: true,
      data: {
        project: {
          id: project.Project_ID, name: project.Project_Name, area: project.Site_Area,
          size_kwp: project.Project_Size, status: project.Project_Status,
          amc_type: project.AMC_Type, site_address: project.Site_Address,
          commissioned_date: project.Commissioned_Date,
        },
        client,
        tickets: { ...summarise(projTickets), list: projTickets },
        amc: {
          count           : amc.length,
          has_inspection  : amc.some(c => /insp/i.test(s(c.amc_type))),
          has_cleaning    : amc.some(c => /clean/i.test(s(c.amc_type))),
          total_visits    : amc.reduce((n, c) => n + c.total_visits, 0),
          completed_visits: amc.reduce((n, c) => n + c.completed_visits, 0),
          pending_visits  : amc.reduce((n, c) => n + c.pending_visits, 0),
          list            : amc,
        },
      },
    });
  } catch (err) { next(err); }
});

/* ── GET /api/solarcare/contracts/:amcId ─────────────────────────────────
   One AMC contract with its visits, numbered Visit 1 … Visit n.

   This exists rather than reusing /api/amc-schedule/contracts/:id/visits
   because that route matches untagged visits by type alone, so on a project
   with a renewed contract it shows the same visits under both. This one uses
   the assignment index, so each visit appears under exactly one contract.  */
router.get('/contracts/:amcId', async (req, res, next) => {
  try {
    const contract = await db.get('amc_contracts', req.params.amcId);
    if (!contract) return res.status(404).json({ success: false, error: 'AMC contract not found' });

    const [contracts, visits, payments] = await Promise.all([
      db.all('amc_contracts'), db.all('amc_tasks'), db.all('amc_payments'),
    ]);

    const visitIndex   = indexVisits(contracts, visits);
    const paymentIndex = indexPayments(payments);
    const mine = visitIndex.get(s(contract.AMC_Id)) || [];
    const done = mine.filter(visitDone).length;

    let project = null;
    if (contract.Project_ID) {
      const p = await db.get('projects', contract.Project_ID);
      if (p) {
        let clientId = p.Client_Id;
        /*  Legacy/AppSheet rows sometimes have a blank Client_Id but a filled
            Client_Name. Resolve the id by name so the client name can link.  */
        if (!s(clientId) && s(p.Client_Name)) {
          try {
            const clients = await db.all('clients');
            const norm = v => s(v).toLowerCase();
            const match = clients.find(c => norm(c.Client_Name) === norm(p.Client_Name));
            if (match) clientId = match.Client_Id;
          } catch (e) { /* fall back to no link */ }
        }
        project = { id: p.Project_ID, name: p.Project_Name, client_id: clientId || null,
                    client_name: p.Client_Name };
      }
    }

    /*  The signed contract / quote file for this AMC, resolved to a Drive
        download link the same way project attachments are.                 */
    let contractFile = null;
    const filePath = s(contract.AMC_Contract_Files);
    if (filePath && filePath.includes('/')) {
      try {
        const resolved = await db.resolveFiles([filePath]);
        const f = resolved[filePath] || null;
        contractFile = {
          path    : filePath,
          name    : f?.name || filePath.split('/').pop(),
          found   : Boolean(f && f.id),
          view    : f?.view ?? null,
          download: f?.download ?? null,
        };
      } catch { contractFile = { path: filePath, name: filePath.split('/').pop(), found: false }; }
    }

    res.json({
      success: true,
      data: {
        contract: {
          ...contractSummary(contract, visitIndex, paymentIndex),
          contract_file    : contractFile,
          project_id  : contract.Project_ID,
          project_name: project?.name || contract.Project_Name || null,
          client_id   : project?.client_id || null,
          client_name : project?.client_name || null,
        },
        project,
        visits: mine.map((v, i) => ({
          task_id    : v.AMC_Task_Id,
          visit_no   : i + 1,
          label      : `${s(contract.AMC_Type) || 'AMC'} visit ${i + 1}`,
          description: v.AMC_Description,
          due_date   : v.AMC_Due_Date,
          status     : v.AMC_Task_Status || 'Scheduled',
          resolution : v.AMC_Resolution,
          report     : v.AMC_Task_Report,
          payment_id : v.Payment_Id,
          is_done    : visitDone(v),
        })),
        total_visits    : mine.length,
        completed_visits: done,
        pending_visits  : mine.length - done,
        payments: payments
          .filter(p => s(p.AMC_Id) === s(contract.AMC_Id))
          .sort((a, b) => dateVal(a.Payment_Due_Date) - dateVal(b.Payment_Due_Date))
          .map((p, i) => ({
            payment_id : p.Payment_Id,
            payment_no : i + 1,
            due_date   : p.Payment_Due_Date,
            amount     : p.Payment_Amount,
            status     : p.Payment_Status,
            description: p.Payment_Description,
          })),
      },
    });
  } catch (err) { next(err); }
});

/* ── GET /api/solarcare/stats ───────────────────────────────────────────── */
router.get('/stats', async (_req, res, next) => {
  try {
    const [clients, projects, contracts, visits, tickets] = await Promise.all([
      db.all('clients'), db.all('projects'), db.all('amc_contracts'),
      db.all('amc_tasks'), db.all('tickets'),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const pending = visits.filter(v => !visitDone(v));

    res.json({ success: true, data: {
      clients        : clients.length,
      projects       : projects.length,
      amc_contracts  : contracts.length,
      inspection     : contracts.filter(c => /insp/i.test(s(c.AMC_Type))).length,
      cleaning       : contracts.filter(c => /clean/i.test(s(c.AMC_Type))).length,
      visits_total   : visits.length,
      visits_pending : pending.length,
      visits_overdue : pending.filter(v => s(v.AMC_Due_Date) && s(v.AMC_Due_Date).slice(0, 10) < today).length,
      tickets_total  : tickets.length,
      tickets_open   : tickets.filter(t => !isClosed(t.Ticket_Status)).length,
    }});
  } catch (err) { next(err); }
});

module.exports = router;