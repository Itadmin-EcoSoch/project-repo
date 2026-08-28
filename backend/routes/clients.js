/*  backend/routes/clients.js — Google Sheets edition
    Same request/response shape as the old Supabase version, so the React
    frontend needs no changes.                                              */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const automations = require('../lib/automations');
const { MAP, toApp, toSheet } = require('../lib/mapping');
const { buildChanges, sendChangeEmail } = require('../utils/mailer');
const { newClientId } = require('../lib/uniqueId');

const GEO = 'Client_GMap_Location';
const asClient = r => toApp(MAP.clients, r, { geoCol: GEO });

/* GET /api/clients?q=&page=&limit= */
router.get('/', async (req, res, next) => {
  try {
    const { q = '', page = 1, limit = 2000, fresh } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const { data, total } = await db.list('clients', {
      q,
      /*  Client_Id added for the same reason as Project_ID on the projects
          route — pasting an id from the sheet or a URL should find the row.  */
      searchFields: 'Client_Id,Client_Name,Client_Mobile,Client_Email,Client_Address',
      reverse: true,          // newest rows are at the bottom of the sheet

      limit : Number(limit),
      offset,
    }, { fresh: fresh === '1' });

    const rows = data.map(asClient);

    // project count per client — one cheap read of two columns
    const projs = await db.list('projects', { fields: 'Client_Id,Client_Name' });
    const byId = {}, byName = {};
    for (const p of projs.data) {
      if (p.Client_Id)   byId[String(p.Client_Id)]   = (byId[String(p.Client_Id)]   || 0) + 1;
      if (p.Client_Name) byName[String(p.Client_Name).trim().toLowerCase()] =
                        (byName[String(p.Client_Name).trim().toLowerCase()] || 0) + 1;
    }

    res.json({
      success: true,
      total,
      data: rows.map(c => ({
        ...c,
        project_count: byId[String(c.id)] ?? byName[String(c.name || '').trim().toLowerCase()] ?? 0,
      })),
    });
  } catch (err) { next(err); }
});

/*  ── GET /api/clients/check-duplicate?name= ──────────────────────────────
    Expects the BASE NAME ONLY — no tag. The frontend used to send name+tag,
    which meant the tag's own letters counted towards the score, so typing a
    tag CAUSED the warning instead of answering it. See AddClient.jsx.

    WHY THIS IS NOT A SIMILARITY RATIO
    The old check counted how many of the shorter name's CHARACTERS appeared
    anywhere in the longer one, ignoring order and recounting duplicates.
    That is an anagram detector, not a name comparison:

        ABCDEF        vs FEDCBA           scored 1.000
        Suresh        vs Sushree          scored 0.857
        vasanth adgsd vs Vasanth kumar    scored 0.769

    and it missed what matters — Vasanth vs Vasanth kumar scored 0.538 and
    passed silently.

    Two rules replace it, both of which can be explained to whoever reads the
    warning:
      1. every word of the shorter name appears in the longer one
         ("Vasanth" inside "Vasanth kumar")
      2. the whole string is within a typo's distance of the other
         ("Chethan"/"Chetan", "Madhumitha"/"Madhumita")

    Random letters now match nothing, which is exactly what a tag is.     */
router.get('/check-duplicate', async (req, res, next) => {
  try {
        const { name = '', exact = '' } = req.query;
    if (!name.trim()) return res.json({ success: true, duplicate: false });

    /*  ── TWO QUESTIONS, TWO MODES ────────────────────────────────────────
        Callers ask one of two different things, and answering both with the
        same rules produced a false block:

        DEFAULT (advisory) — "is there a client with a similar name?"
          Fuzzy on purpose. Typing "Srilekha" should surface the existing
          "Srilekha Thuraka" so the user knows to add a tag.

        exact=1 (blocking) — "is THIS name, tag included, already taken?"
          Only an exact match counts. The containment rule below says every
          word of the shorter name appears in the longer, which is right for
          the advisory and wrong here:

              "Srilekha Thuraka white" vs "Srilekha Thuraka"  -> contained
              "Vasanth Kumar K"        vs "Vasanth Kumar"     -> contained

          Both are legitimately different clients, and both were refused.  */
    const exactOnly = String(exact) === '1' || String(exact) === 'true';
    const { data } = await db.list('clients', {
      q: name.trim().slice(0, 8),
      searchFields: 'Client_Name',
      fields: 'Client_Id,Client_Name,Client_Mobile',
      /*  Raised from 10. A short name like "Ram" matches a lot of rows, and
          the real near-duplicate could easily sit past the tenth.        */
      limit: 25,
    });

    const norm = s => String(s || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const toks = s => norm(s).split(' ').filter(Boolean);

    /*  Iterative, two rows at a time — a recursive version blows the stack on
        long strings and allocates a full matrix for no reason.            */
    const lev = (a, b) => {
      if (a === b) return 0;
      const m = a.length, n = b.length;
      if (!m) return n; if (!n) return m;
      let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
      for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++)
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        [prev, cur] = [cur, prev];
      }
      return prev[n];
    };

    const target = norm(name);
    const tTok   = toks(name);

    let why = null;
    const hit = data.find(r => {
      const cand = norm(r.Client_Name);
      if (!cand) return false;

          if (cand === target) { why = 'the same name'; return true; }

      /*  Exact mode stops here. Everything below is deliberately fuzzy and
          belongs only to the advisory check.                             */
      if (exactOnly) return false;

      const cTok    = toks(r.Client_Name);
      const shared  = tTok.filter(x => cTok.includes(x));
      const shorter = tTok.length <= cTok.length ? tTok : cTok;
      if (shared.length === shorter.length && shared.join('').length >= 4) {
        why = `the same name with more words — "${shared.join(' ')}"`;
        return true;
      }

      /* 15% of the longer string, minimum 1 — one typo in a short name */
      const max = Math.max(target.length, cand.length);
      if (lev(target, cand) <= Math.max(1, Math.floor(max * 0.15))) {
        why = 'an almost identical spelling';
        return true;
      }
      return false;
    });

    res.json({
      success  : true,
      duplicate: !!hit,
      reason   : why,
      match    : hit ? { id: hit.Client_Id, name: hit.Client_Name, phone: hit.Client_Mobile } : null,
    });
  } catch (err) { next(err); }
});

/* GET /api/clients/:id — client + their projects */
router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.get('clients', req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Client not found' });
    const client = asClient(row);

    const all = await db.list('projects', {
      fields: 'Project_ID,Project_Name,Client_Id,Client_Name,Site_Area,Project_Size,' +
                            'Inverter_Type,Business_Model,Project_Status,Order_Value,' +
              'AMC_Type,Created_Date',
      sort: 'Project_ID', order: 'desc',
    });

    const nameKey = String(client.name || '').trim().toLowerCase();
    const mine = all.data.filter(p =>
      String(p.Client_Id ?? '') === String(client.id) ||
      String(p.Client_Name || '').trim().toLowerCase() === nameKey
    );

    res.json({ success: true, data: { ...client, projects: mine.map(p => toApp(MAP.projects, p)) } });
  } catch (err) { next(err); }
});

/*  ── POST /api/clients — CLOSED BY DEFAULT ──────────────────────────────────
    A client exists because there is a project for them. Creating one on its
    own left the Clients tab holding rows that no project ever referenced —
    every abandoned New Order form produced one, and nothing cleaned them up.

    The client and their first project are now written together by
    POST /api/orders with client_type:'new', in a single Apps Script lock
    (createOrder_ in Code.gs), so an order produces both rows or neither.

    This endpoint is kept, not deleted, because a bulk import or a one-off
    script is a legitimate reason to want it. Two ways to open it:
      · flip ALLOW_STANDALONE_CLIENT to true, or
      · send allow_standalone: true in the body of that one request.
    Leave it false for the app itself — that is what keeps the rule enforced
    on the server, where the UI cannot drift away from it.                  */
const ALLOW_STANDALONE_CLIENT = false;

router.post('/', async (req, res, next) => {
  try {
    if (!ALLOW_STANDALONE_CLIENT && req.body.allow_standalone !== true) {
      return res.status(409).json({
        success: false,
        error: 'A client is saved only together with their first project. ' +
               'Submit it through POST /api/orders with client_type:"new".',
      });
    }

    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const row = toSheet(MAP.clients, {
      ...req.body,
      name           : String(name).trim(),
      region         : req.body.region          || 'Bangalore',
      client_identity: req.body.client_identity  || 'Individual',
      client_status  : req.body.client_status    || 'Normal',
      type_of_client : req.body.type_of_client   || 'Internal',
    }, { geoCol: GEO });

    /*  Client_Id is minted here, in Node — see lib/uniqueId.js. 8 characters,
        checked against every Client_Id already in the sheet, matching the
        AppSheet UNIQUEID() shape the Clients tab has always used.           */
    row.Client_Id = await newClientId();

    const saved = await db.insert('clients', row);
    res.status(201).json({ success: true, data: asClient(saved) });
  } catch (err) { next(err); }
});

/* PATCH /api/clients/:id */
router.patch('/:id', async (req, res, next) => {
  try {
    const beforeRow = await db.get('clients', req.params.id, { fresh: true });
    if (!beforeRow) return res.status(404).json({ success: false, error: 'Client not found' });

    const patch = toSheet(MAP.clients, req.body, { geoCol: GEO });
      delete patch.Client_Id;

    const saved  = await db.update('clients', req.params.id, patch);
    const data   = asClient(saved);
    const before = asClient(beforeRow);

    const labels = {
      name:'Name', phone:'Mobile', email:'Email', billing_address:'Billing Address',
      region:'Region', client_identity:'Client Type', type_of_client:'Type of Client',
      lat:'Latitude', lng:'Longitude', client_status:'Status', notes:'Notes',
    };
    const changes = buildChanges(before, toApp(MAP.clients, patch, { geoCol: GEO }), labels);

    sendChangeEmail({
      subject   : `[EcoSoch] Client updated: ${data.name}`,
      heading   : 'A client record was updated',
      entityName: `${data.name}${data.phone ? ' · ' + data.phone : ''}`,
      editedBy  : req.body.changed_by || 'staff',
      changes,
    }).catch(e => console.error('[mail] client update:', e.message));

    res.json({ success: true, data, changes });
  } catch (err) { next(err); }
});

/* DELETE /api/clients/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    await db.remove('clients', req.params.id);
    res.json({ success: true, message: 'Client deleted' });
  } catch (err) { next(err); }
});

/* ── GET /:id/related ────────────────────────────────────────────────────
   The Clients virtual columns from AppSheet:
     Related_Projects  = REF_ROWS("Projects","Client_Name")
     Defaulted_Project = unique(SELECT(Projects[Defaulted_Project], …))
   Defaulted_Project was only shown when Client_Status = "Defaulter", so
   show_defaulted carries that rule to the UI.                            */
router.get('/:id/related', async (req, res, next) => {
  try {
    const client = await db.get('clients', req.params.id);
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    const projects = await db.all('projects');
    const related  = automations.relatedProjects(client.Client_Name, projects);
    const defaulted = automations.defaultedProjects(client.Client_Name, projects);

    res.json({
      success: true,
      data: {
        client_id      : client.Client_Id,
        client_name    : client.Client_Name,
        client_type    : client.Client_Type,
        client_status  : client.Client_Status,
        related_projects: related,
        project_count  : related.length,
        defaulted_projects: defaulted,
        show_defaulted : String(client.Client_Status || '').trim().toLowerCase() === 'defaulter',
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;