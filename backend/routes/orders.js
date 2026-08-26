/*  backend/routes/orders.js — Google Sheets edition
    POST /api/orders is what your "New Order Form" submits to.
    It creates the client (if new) + the project + the log rows in ONE call,
    inside a single Apps Script lock, so half-written orders are impossible. */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const automations = require('../lib/automations');
const { newProjectId, newClientId, isValidProjectId } = require('../lib/uniqueId');
const { MAP, toApp, toSheet } = require('../lib/mapping');
const { toSheetStatus, isDefaulted } = require('../lib/status');

const asClient  = r => toApp(MAP.clients,  r, { geoCol: 'Client_GMap_Location' });
const asProject = r => toApp(MAP.projects, r, { geoCol: 'GMap_Link' });

/* POST /api/orders */
router.post('/', async (req, res, next) => {
  try {
    const {
      client_type, client_id,
      client: clientData = {},
      project: projectData = {},
      status, defaulted_pct, submitted_by,
    } = req.body;

    if (client_type === 'new' && !String(clientData.name || '').trim()) {
      return res.status(400).json({ success: false, error: 'Client name is required' });
    }
    if (client_type === 'existing' && !client_id) {
      return res.status(400).json({ success: false, error: 'client_id is required' });
    }

    /* map the app's field names onto sheet column names */
    const clientRow = toSheet(MAP.clients, {
      ...clientData,
      name           : String(clientData.name || '').trim(),
      region         : clientData.region          || 'Bangalore',
      client_identity: clientData.client_identity || 'Individual',
      client_status  : clientData.client_status   || 'Normal',
      type_of_client : clientData.type_of_client  || 'Internal',
    }, { geoCol: 'Client_GMap_Location' });
    /*  Client_Id is minted here, in Node — see lib/uniqueId.js. Only needed
        when this order creates a brand-new client; an existing client already
        has one.                                                             */
    clientRow.Client_Id = client_type === 'existing' ? undefined : await newClientId();
    if (!clientRow.Client_Id) delete clientRow.Client_Id;

    const projectRow = toSheet(MAP.projects, {
      ...projectData,
      project_type   : projectData.project_type    || 'EPC',
      sector         : projectData.sector          || 'Residential',
      system_type    : projectData.system_type     || 'Rooftop Solar',
      system_category: projectData.system_category || 'Grid-Tied',
      proposal_model : projectData.proposal_model  || 'Standard',
      amc_type       : projectData.amc_type        || 'None',
      obstacles      : projectData.obstacles       || 'NO',
      status         : toSheetStatus(status)       || 'Active',
      defaulted_pct  : isDefaulted(status) ? defaulted_pct : null,
    }, { geoCol: 'GMap_Link' });
    /*  Project_ID: use one already minted via GET /api/projects/new-id if the
        caller supplied a valid one — that's what keeps file uploads (which
        start before Save is even clicked, filed under whatever id the
        frontend was given up front) and this saved row pointing at the SAME
        id. Only mint a fresh one here as a fallback, for any caller that
        didn't go through that endpoint. Checked against isValidProjectId
        rather than trusted outright — a malformed or hand-edited value here
        must not end up as this project's permanent primary key.
        This is the New Order Form path, so a freshly-minted fallback checks
        against a LIVE read of the sheet rather than the cache. */
    projectRow.Project_ID = isValidProjectId(projectData.Project_ID)
      ? projectData.Project_ID
      : await newProjectId();

    /* one atomic round-trip to the sheet */
    const out = await db.createOrder({
      client_type : client_type || 'new',
      client_id,
      client      : clientRow,
      project     : projectRow,
      submitted_by: submitted_by || 'staff',
    });

    const client  = asClient(out.client);
    const project = asProject(out.project);

    /*  AppSheet bot: a new EPC or I&C project marks its client Internal.
        Fire-and-forget so a slow client write never delays the response. */
    if (out?.project) {
      automations.onProjectCreated(out.project)
        .catch(e => console.error('[automation] create:', e.message));
    }

    res.status(201).json({
      success: true,
      data: {
        order_id     : out.order?.Order_Id ?? null,
        project_id   : project.id,
        project_name : project.name,
        client,
        status       : project.status,
        sheets_synced: true,        // it IS the sheet now
        wa_notified  : false,
      },
    });
  } catch (err) { next(err); }
});

/* GET /api/orders — recent submissions from the Order_Log tab */
router.get('/', async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;

    const { data, total } = await db.list('order_log', {
      sort: 'Submitted_At', order: 'desc', limit: Number(limit),
    });

    const [clients, projects] = await Promise.all([
      db.list('clients',  { fields: 'Client_Id,Client_Name,Client_Mobile' }),
      db.list('projects', { fields: 'Project_ID,Project_Name,Project_Status,Project_Size' }),
    ]);
    const cById = new Map(clients.data.map(c => [String(c.Client_Id), c]));
    const pById = new Map(projects.data.map(p => [String(p.Project_ID), p]));

    res.json({
      success: true,
      total,
      data: data.map(o => {
        const c = cById.get(String(o.Client_Id));
        const p = pById.get(String(o.Project_ID));
        return {
          id           : o.Order_Id,
          client_type  : o.Client_Type,
          submitted_by : o.Submitted_By,
          submitted_at : o.Submitted_At,
          sheets_synced: true,
          wa_notified  : false,
          clients : c ? { id: c.Client_Id, name: c.Client_Name, phone: c.Client_Mobile } : null,
          projects: p ? { id: p.Project_ID, name: p.Project_Name,
                          status: p.Project_Status, size_kwp: p.Project_Size } : null,
        };
      }),
    });
  } catch (err) { next(err); }
});

module.exports = router;