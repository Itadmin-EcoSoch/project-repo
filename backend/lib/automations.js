/*  backend/lib/automations.js
    ----------------------------------------------------------------------------
    Port of the AppSheet Bots that fire on the Projects table, plus the virtual
    columns that depend on them.

    ORIGINAL BOTS (from the AppSheet editor)

    1. "Set Client_Type as Internal when a new project is added"
         Event     : Projects · Adds
         Condition : in([Project_Type], LIST("EPC","I&C"))
         Action    : on SELECT(Clients[Client_Name],
                       ([Client_Name] = [_THISROW].[Client_Name]))
                     run "Set Client type to Internal"

    2. "Set Client Status if Project Status is or was Defaulted"
         Event     : Projects · Updates
         Condition : and([_THISROW_BEFORE].[Project_Status] <> [_THISROW_AFTER].[Project_Status],
                       or([_THISROW_BEFORE].[Project_Status]="Defaulted - Project Payment",
                          [_THISROW_AFTER].[Project_Status] ="Defaulted - Project Payment"))
         Action    : on the matching client run "Set Client Status"

    3. "Send email to SolarCare team once project is Under SolarCare"
         Event     : Projects · Updates
         Condition : and([_THISROW_before].[Project_Status]<>[_THISROW_after].[Project_Status],
                         [_THISROW_after].[Project_Status]="Under SolarCare")
         Task      : email solarcare_team@ecosoch.com

    VIRTUAL COLUMNS

      Projects.Defaulted_Project
        = IFS(STARTSWITH([Project_Status],'Defaulted'), [Project_Name])

      Clients.Related_Projects
        = REF_ROWS("Projects", "Client_Name")

      Clients.Defaulted_Project
        = unique(SELECT(Projects[Defaulted_Project],
            and([Client_Name] = [_THISROW], ISNOTBLANK([Defaulted_Project]))))
        shown only when [Client_Status] = "Defaulter"

    Every rule is best-effort: a failure is logged and the request continues.
    None of these should ever block saving a project.
--------------------------------------------------------------------------- */

const db = require('../db/sheets');
const promo = require('./paymentPromotion');
const { newStatusLogId } = require('./uniqueId');

const DEFAULTED_STATUS   = 'Defaulted - Project Payment';
const SOLARCARE_STATUS   = 'Under SolarCare';
const INTERNAL_TYPES     = ['EPC', 'I&C'];
const SOLARCARE_TEAM     = process.env.SOLARCARE_TEAM_EMAIL || 'solarcare_team@ecosoch.com';

const norm = v => String(v ?? '').trim();
const eq   = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

/*  "Is this status a defaulted one?"

    The AppSheet app was inconsistent about this and I ported both literally,
    which was a mistake:

      Projects.Defaulted_Project  STARTSWITH([Project_Status],'Defaulted')
      Bot 2 condition             [Project_Status] = "Defaulted - Project Payment"

    So a project set to any OTHER defaulted status — "Defaulted - AMC Payment",
    or plain "Defaulted" — showed up in the virtual column but never triggered
    the bot, and the client was never marked a Defaulter.

    Both now use the prefix test, which is the broader of the two and the one
    that matches what the virtual column reports.                          */
const isDefaultedStatus = v => norm(v).toLowerCase().startsWith('defaulted');

/* ── virtual columns ─────────────────────────────────────────────────── */

/** Projects.Defaulted_Project — the project name, but only when defaulted. */
function projectDefaultedName(project = {}) {
  return isDefaultedStatus(project.Project_Status) ? norm(project.Project_Name) : '';
}

/** Clients.Related_Projects — REF_ROWS("Projects","Client_Name"). */
function relatedProjects(clientName, projects = []) {
  const want = norm(clientName).toLowerCase();
  if (!want) return [];
  return projects
    .filter(p => norm(p.Client_Name).toLowerCase() === want)
    .map(p => ({
      project_id  : p.Project_ID,
      project_name: p.Project_Name,
      status      : p.Project_Status,
      size_kwp    : p.Project_Size,
      type        : p.Project_Type,
    }));
}

/** Clients.Defaulted_Project — the distinct defaulted project names. */
function defaultedProjects(clientName, projects = []) {
  const want = norm(clientName).toLowerCase();
  const out  = [];
  for (const p of projects) {
    if (norm(p.Client_Name).toLowerCase() !== want) continue;
    const name = projectDefaultedName(p);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/* ── finding the client ──────────────────────────────────────────────── */

/**
 * The AppSheet actions selected the client by NAME:
 *   SELECT(Clients[Client_Name], ([Client_Name] = [_THISROW].[Client_Name]))
 * Client_Id is used first here when the project carries one, since it is
 * exact, and the name match is the fallback for older rows.
 */
async function findClient(project = {}) {
  if (project.Client_Id) {
    try {
      const byId = await db.get('clients', project.Client_Id);
      if (byId) return byId;
    } catch (e) { /* fall through to the name match */ }
  }
  const want = norm(project.Client_Name).toLowerCase();
  if (!want) return null;
  const rows = await db.all('clients');
  return rows.find(c => norm(c.Client_Name).toLowerCase() === want) || null;
}

/* ── BOT 1 — Client_Type = Internal on a new EPC / I&C project ───────── */

async function botSetClientTypeInternal(project) {
  const type = norm(project.Project_Type);
  if (!INTERNAL_TYPES.some(t => eq(t, type))) {
    return { rule: 'client_type_internal', ran: false, reason: `Project_Type "${type}" is not EPC or I&C` };
  }

  const client = await findClient(project);
  if (!client) return { rule: 'client_type_internal', ran: false, reason: 'client not found' };

  if (eq(client.Client_Type, 'Internal')) {
    return { rule: 'client_type_internal', ran: false, reason: 'already Internal' };
  }

  /* Captured before the write — db.get can hand back a cached object that
     the update then mutates, which would make the log read "Internal -> Internal". */
  const wasType = client.Client_Type || '(blank)';
  await db.update('clients', client.Client_Id, { Client_Type: 'Internal' });
  return {
    rule: 'client_type_internal', ran: true,
    detail: `${client.Client_Name}: Client_Type ${wasType} -> Internal`,
  };
}

/* ── BOT 2 — Client_Status follows the defaulted projects ────────────── */

async function botSetClientStatus(before, after) {
  const wasDefaulted = isDefaultedStatus(before?.Project_Status);
  const isDefaulted  = isDefaultedStatus(after?.Project_Status);
  const changed      = !eq(before?.Project_Status, after?.Project_Status);

  /* Exactly the AppSheet condition: the status changed AND it was or is
     "Defaulted - Project Payment". */
  if (!changed || (!wasDefaulted && !isDefaulted)) {
    return { rule: 'client_status', ran: false, reason: 'status did not cross the defaulted state' };
  }

  const client = await findClient(after);
  if (!client) return { rule: 'client_status', ran: false, reason: 'client not found' };

  /*  Recomputed from ALL the client's projects rather than toggled, so
      clearing one default while another is still outstanding does not
      wrongly mark the client as settled. */
  const projects  = await db.all('projects');
  const defaulted = defaultedProjects(client.Client_Name, projects)
    .filter(n => !(eq(n, after.Project_Name) && !isDefaulted));

  const status = defaulted.length ? 'Defaulter' : 'Normal';

  if (eq(client.Client_Status, status)) {
    return { rule: 'client_status', ran: false, reason: `already ${status}` };
  }

  const wasStatus = client.Client_Status || '(blank)';
  await db.update('clients', client.Client_Id, { Client_Status: status });
  return {
    rule: 'client_status', ran: true,
    detail: `${client.Client_Name}: Client_Status ${wasStatus} -> ${status}` +
            (defaulted.length ? ` (${defaulted.length} defaulted project(s))` : ''),
  };
}

/* ── BOT 3 — email SolarCare on handover ─────────────────────────────── */

async function botSolarCareEmail(before, after) {
  const changed = !eq(before?.Project_Status, after?.Project_Status);
  if (!changed || !eq(after?.Project_Status, SOLARCARE_STATUS)) {
    return { rule: 'solarcare_email', ran: false, reason: 'not a handover to Under SolarCare' };
  }

  const { sendMail } = require('../utils/mailer');
  const testMode = String(process.env.NEW_ORDER_TEST_MODE ?? 'false').toLowerCase() === 'true';
  const to = testMode
    ? [process.env.NEW_ORDER_TEST_RECIPIENT || 'venkat@ecosoch.com']
    : [SOLARCARE_TEAM];

  const name    = norm(after.Project_Name) || norm(after.Project_ID);
  const subject = `${testMode ? '[TEST] ' : ''}Handover to SolarCare — ${name}`;

  const rows = [
    ['Project',        after.Project_Name],
    ['Project ID',     after.Project_ID],
    ['Client',         after.Client_Name],
    ['Capacity (kWp)', after.Project_Size],
    ['Site Address',   after.Site_Address],
    ['Region',         after.Project_Region],
    ['Commissioned',   after.Commissioned_Date],
    ['Sales Lead',     after.Sales_Lead],
  ].filter(([, v]) => norm(v));

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1d272c">` +
    `<p>${esc(name)} has been handed over to SolarCare.</p>` +
    `<table cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="width:100%;border-collapse:collapse;margin-top:12px">` +
    rows.map(([k, v], i) =>
      `<tr>` +
      `<td width="220" style="padding:9px 14px;border-bottom:1px solid #e3e7e8;` +
      `background:#f7f9fa;font-weight:bold;color:#42525a;vertical-align:top">${esc(k)}</td>` +
      `<td style="padding:9px 14px;border-bottom:1px solid #e3e7e8;` +
      `background:${i % 2 ? '#fcfdfd' : '#ffffff'};vertical-align:top">${esc(v)}</td>` +
      `</tr>`).join('') +
    `</table>` +
    `<p style="margin-top:14px;font-size:11.5px;color:#7b878d">` +
    `Sent automatically by Project Repository — EcoSoch Project Repository.</p></div>`;

  const text = `${name} has been handed over to SolarCare.\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n');

  const res = await sendMail({ to, subject, html, text });
  return {
    rule: 'solarcare_email', ran: true,
    detail: `emailed ${(res.to || to).join(', ')}${testMode ? ' (test mode)' : ''}`,
  };
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── runners ─────────────────────────────────────────────────────────── */

async function safely(fn, name) {
  try { return await fn(); }
  catch (e) {
    console.warn(`[automation] ${name} failed: ${e.message}`);
    return { rule: name, ran: false, error: e.message };
  }
}

/** Fire the Adds bots. Call after a project row is created. */
async function onProjectCreated(project) {
  if (!project) return [];
  const results = [await safely(() => botSetClientTypeInternal(project), 'client_type_internal')];
  logResults('created', project, results);
  return results;
}

/** Fire the Updates bots. Call after a project row is updated. */
/*  Bot: an Active project with an AMC follows its payments.

        payments cleared  -> Under SolarCare
        payment overdue   -> Defaulted - AMC Payment

    OFF BY DEFAULT. Set PAYMENT_PROMOTION=true in backend/.env to enable.

    It is off because it WRITES Project_Status, which drives the Solar Care
    dashboard, the defaulter emails and the client's Defaulter flag. Turning it
    on without first reading `node checkPaymentPromotions.js` would re-status
    an unknown number of live projects with nobody having looked at the list.

    Everything it does is also written to Status_Log, so "why is this project
    Defaulted?" always has an answer.                                       */
async function botPaymentPromotion(before, after) {
  if (String(process.env.PAYMENT_PROMOTION).toLowerCase() !== 'true') {
    return { ran: false, why: 'PAYMENT_PROMOTION is off' };
  }
  const pid = String(after.Project_ID ?? '').trim();
  if (!pid) return { ran: false, why: 'no project id' };

  const key = v => String(v ?? '').trim().toLowerCase();

  const c = await db.list('amc_contracts', {
    where : { Project_ID: pid },
    fields: 'AMC_Id,AMC_Type,Project_ID,AMC_Status',
  });
  const contracts = c.data;
  const ids = new Set(contracts.map(x => key(x.AMC_Id)));
  let payments = [];
  if (ids.size) {
    const pay = await db.list('amc_payments', {
      fields: 'Payment_Id,AMC_Id,Payment_Amount,Payment_Status,Payment_Due_Date',
    });
    payments = pay.data.filter(r => ids.has(key(r.AMC_Id)));
  }

  let base;
  try { base = (await db.lookups())?.Project_Status; } catch { /* fallback list */ }

  const d = promo.decide(after, { contracts, payments, base });
  if (d.action === 'none') return { ran: false, why: d.reason };
  if (!d.allowed)          return { ran: false, why: d.reason };

  await db.update('projects', pid, { Project_Status: d.to });
  await db.insert('status_log', {
    Log_Id    : await newStatusLogId({ fresh: false }),
    Project_ID: pid,
    Old_Status: after.Project_Status || '',
    New_Status: d.to,
    Changed_By: 'payment-promotion',
    Note      : d.reason,
    Changed_At: new Date().toISOString(),
  }).catch(() => {});

  return { ran: true, why: `${after.Project_Status} -> ${d.to}: ${d.reason}` };
}

async function onProjectUpdated(before, after) {
  if (!after) return [];
  const results = [
    await safely(() => botSetClientStatus(before, after), 'client_status'),
    await safely(() => botSolarCareEmail(before, after), 'solarcare_email'),
    await safely(() => botPaymentPromotion(before, after), 'payment_promotion'),
  ];
  logResults('updated', after, results);
  return results;
}

function logResults(event, project, results) {
  const fired = results.filter(r => r.ran);
  if (!fired.length) return;
  console.log(`[automation] project ${project.Project_ID} ${event}:`);
  fired.forEach(r => console.log(`  · ${r.rule} — ${r.detail}`));
}

module.exports = {
  botPaymentPromotion,
  onProjectCreated,
  onProjectUpdated,
  botSetClientTypeInternal,
  botSetClientStatus,
  botSolarCareEmail,
  projectDefaultedName,
  relatedProjects,
  defaultedProjects,
  findClient,
  isDefaultedStatus,
  DEFAULTED_STATUS,
  SOLARCARE_STATUS,
  INTERNAL_TYPES,
};