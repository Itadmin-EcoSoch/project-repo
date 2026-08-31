/*  backend/routes/newOrder.js
    ----------------------------------------------------------------------------
    Sends the "New Order Form" email — the Project Repository replacement for the AppSheet
    automation that used to fire whenever a project was added.

        GET  /api/new-order/:projectId/preview   render, don't send
        POST /api/new-order/:projectId/send      render and send
        GET  /api/new-order/health               is SMTP configured?

    Both read the RAW sheet rows, because lib/newOrderTemplate.js is keyed on
    sheet column names. Attachment paths are resolved to Drive links first, so
    the file rows in the email are clickable exactly like the AppSheet ones.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');
const { buildNewOrderEmail, buildProjectUpdateEmail, FILE_COLUMNS,
        PROJECT_ROWS, SENDER_NAMES } = require('../lib/newOrderTemplate');
const { sendMail: smtpSendMail, verifyMailer, checkFromAddress } = require('../utils/mailer');
const { newOrderId } = require('../lib/uniqueId');

/*  Mail transport. 'appsscript' (default) sends through the Apps Script that
    already owns the sheet — the script's Google account is the sender, so no
    SMTP credentials are needed at all. Set MAIL_TRANSPORT=smtp in backend/.env
    to fall back to nodemailer.                                              */
const TRANSPORT = String(process.env.MAIL_TRANSPORT || 'appsscript').toLowerCase();

/*  opts.senderName picks the From display name:
        'New Sales Order'      a brand-new project
        'Updated Sales Order'  an update to an existing one                 */
async function sendMail(opts) {
  if (TRANSPORT !== 'appsscript') {
    /*  Attachments are Drive file IDs, which only mean something to Apps
        Script. nodemailer would need the bytes streamed down and re-uploaded,
        so on SMTP the files stay as links in the body — same as before.   */
    if (opts.attachments?.length) {
      console.warn(`[mail:smtp] ${opts.attachments.length} attachment(s) skipped — ` +
                   'file attachments require MAIL_TRANSPORT=appsscript. Links remain in the body.');
    }
    return smtpSendMail(opts);
  }

  const res = await db.sendMail({
    to: opts.to, cc: opts.cc,
    subject: opts.subject, html: opts.html, text: opts.text,
    replyTo: opts.replyTo,
    attachments: opts.attachments,
    /*  Matches the sender the team has seen for years. When the mail reaches
        ecosoch-team@ecosoch.com the Google Group appends "via EcoSoch Team"
        by itself, giving the original
            'New Sales Order' via EcoSoch Team <ecosoch-team@ecosoch.com>
        That suffix only appears once NEW_ORDER_TEST_MODE=false, because in
        test mode the mail goes straight to you and never through the group. */
    name: opts.senderName || SENDER_NAMES.new,
  });

  console.log(
    `[mail:appsscript] sent "${res.subject}" from ${res.sender} ` +
    `to [${(res.to || []).join(', ')}] · ${(res.attached || []).length} file(s) attached · ` +
    `${res.remaining_quota} sends left today`
  );
  (res.skipped || []).forEach(sk =>
    console.warn(`[mail:appsscript] attachment skipped — ${sk.name || sk.id}: ${sk.why}`));

  return {
    sent     : true,
    to       : res.to || [],
    cc       : res.cc || [],
    accepted : res.to || [],
    rejected : [],
    messageId: null,
    response : `Apps Script accepted · ${res.remaining_quota} sends remaining today`,
    from     : res.sender,
    attached : res.attached || [],
    skipped  : res.skipped  || [],
    reason   : null,
  };
}

/* ── recipients ─────────────────────────────────────────────────────────
   TEST MODE is ON by default, on purpose. Until you explicitly set
   NEW_ORDER_TEST_MODE=false in backend/.env, every New Order Form goes to
   NEW_ORDER_TEST_RECIPIENT and nowhere else, with [TEST] on the subject.
   That makes it impossible to spam ecosoch-team@ecosoch.com by accident
   while you are still trying this out.                                  */
const TEST_MODE = String(process.env.NEW_ORDER_TEST_MODE ?? 'false').toLowerCase() === 'true';
const TEST_TO   = process.env.NEW_ORDER_TEST_RECIPIENT || 'venkat@ecosoch.com';

const split = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

/*  The frontend gives up at 45s. These keep the whole request comfortably
    under that even when Apps Script is slow. */
const ATTACHMENT_TIMEOUT_MS = Number(process.env.NEW_ORDER_FILES_TIMEOUT || 12000);
const CLIENT_TIMEOUT_MS     = Number(process.env.NEW_ORDER_CLIENT_TIMEOUT || 12000);

function recipients() {
  if (TEST_MODE) return { to: split(TEST_TO), cc: [], testMode: true };
  return {
    to: split(process.env.NEW_ORDER_TO) .length ? split(process.env.NEW_ORDER_TO)  : ['ecosoch-team@ecosoch.com'],
    cc: split(process.env.NEW_ORDER_CC),
    testMode: false,
  };
}

/* ── load ───────────────────────────────────────────────────────────── */

/** Resolve after `ms`, so one slow dependency cannot hang the whole request. */
function withTimeout(promise, ms, fallback, label) {
  let timer;
  return Promise.race([
    promise.catch(e => {
      console.warn(`[new-order] ${label} failed: ${e.message}`);
      return fallback;
    }),
    new Promise(resolve => {
      timer = setTimeout(() => {
        console.warn(`[new-order] ${label} exceeded ${ms}ms — continuing without it`);
        resolve(fallback);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Attachment paths → Drive links. Degrades to plain filenames if slow. */
async function resolveAttachments(project) {
  const paths = FILE_COLUMNS
    .flatMap(col => String(project[col] || '').split(','))
    .map(s => s.trim())
    .filter(p => p && p.includes('/'));

  if (!paths.length) return {};
  return withTimeout(db.resolveFiles(paths), ATTACHMENT_TIMEOUT_MS, {}, 'attachment lookup');
}

/*  Gmail rejects a message over ~25 MB in total. 20 MB leaves room for the
    HTML body and MIME encoding overhead, which inflates binary by about a
    third. Anything that does not fit stays a link in the body rather than
    silently bouncing the whole email.                                      */
const MAX_ATTACH_BYTES = Number(process.env.NEW_ORDER_MAX_ATTACH_BYTES || 20 * 1024 * 1024);

/**
 * The resolved Drive files, as an attachment list for Apps Script.
 *
 * Deduped by Drive id on purpose: one PDF is routinely chosen for more than
 * one column — Cost Breakdown Sheet, Proposal and Other Files can all point at
 * the same upload — and without this the recipient gets three copies of it.
 *
 * Only ids and names travel. The bytes are fetched inside Apps Script, which
 * is already authenticated against the same Drive.
 */
/**
 * @param nameByPath { [path]: 'DWG - EL - 001….pdf' } — optional. The name the
 *   file was UPLOADED under, from the sheet's companion _Name column.
 *
 *   Without it the attachment arrives called X2LgXPB2.Proposal.0961209.pdf.
 *   That shape is deliberate on Drive — it keeps names unique and it is what
 *   findFile_ resolves against — but in an inbox it is unreadable, and the
 *   recipient cannot tell one project's proposal from another's.
 */
function attachmentsFrom(files, nameByPath = {}) {
  const seen = new Set();
  const out  = [];
  let budget = MAX_ATTACH_BYTES;

  for (const [path, info] of Object.entries(files || {})) {
    if (!info || !info.id || info.error) continue;   // unresolved → link only
    if (seen.has(info.id)) continue;
    seen.add(info.id);

    const size = Number(info.size) || 0;
    if (size > budget) {
      console.warn(
        `[new-order] "${info.name || info.id}" (${(size / 1048576).toFixed(1)} MB) not attached — ` +
        'over the remaining size budget. It is still linked in the email body.'
      );
      continue;
    }
    budget -= size;
    out.push({ id: info.id, name: nameByPath[path] || info.name || undefined });
  }

  return out;
}

/*  Label -> sheet column, for the attachment fields only. Built from the same
    table the email body is rendered from, so the two can never drift.      */
const FILE_LABEL_TO_COL = {};
PROJECT_ROWS.filter(r => r.type === 'file')
            .forEach(r => { FILE_LABEL_TO_COL[String(r.label).trim()] = r.col; });

/**
 * The file paths a project update actually introduced.
 *
 * An update email should carry the file that was just uploaded — not all eight
 * attachments again, which the team already received with the New Order Form
 * and would have to re-download to find the one that changed.
 *
 * Driven by the change row's LABEL, not its value. It used to read the path
 * out of the `to` side, which worked only for as long as that side held a
 * path — routes/projects.js now puts the uploaded FILENAME there instead, so
 * the team reads "DWG - EL - 001…pdf" rather than
 * "X2LgXPB2/X2LgXPB2.Quote_Sheet.7406670.pdf". The label survives that change;
 * the value did not. The real path is then taken from the project row, which
 * is the authority on it either way.
 */
function changedFilePaths(changes, project) {
  const cols = new Set();
  for (const c of changes || []) {
    const col = FILE_LABEL_TO_COL[String(c.label || '').trim()];
    if (col) cols.add(col);
  }

  const out = [];
  for (const col of cols) {
    String(project[col] || '')
      .split(',')
      .map(s => s.trim())
      .filter(p => p && !/^https?:/i.test(p))
      .forEach(p => out.push(p));
  }
  return [...new Set(out)];
}

/** Client row, by id, falling back to a name match on older AppSheet rows. */
async function loadClient(project) {
  if (project.Client_Id) {
    const byId = await db.get('clients', project.Client_Id);
    if (byId) return byId;
  }
  if (project.Client_Name) {
    const rows = await db.all('clients');
    const want = String(project.Client_Name).trim().toLowerCase();
    return rows.find(c => String(c.Client_Name || '').trim().toLowerCase() === want) || {};
  }
  return {};
}

/**
 * Raw project row + raw client row + resolved attachment links.
 *
 * Performance matters here: this used to force a fresh full read of the
 * ~1,500-row Projects tab and then wait on the client lookup and the Drive
 * lookup one after another, which blew past the frontend's 45s timeout.
 *
 * Three changes:
 *   1. Read from cache. db.createOrder and db.update both patch the cache, so
 *      a project saved a moment ago is already there. A forced sheet read only
 *      happens if the row genuinely is not in the cache.
 *   2. Client and attachments are fetched in parallel, not in sequence.
 *   3. The Drive lookup has its own timeout and degrades to plain filenames,
 *      so a slow Apps Script call costs the links, not the whole email.
 */
async function load(projectId) {
  const t0 = Date.now();

  let project = await db.get('projects', projectId);
  let viaSheet = false;
  if (!project) {
    viaSheet = true;
    project = await db.get('projects', projectId, { fresh: true });
  }

  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const [client, files] = await Promise.all([
    withTimeout(loadClient(project), CLIENT_TIMEOUT_MS, {}, 'client lookup'),
    resolveAttachments(project),
  ]);

  console.log(
    `[new-order] loaded ${projectId} in ${Date.now() - t0}ms ` +
    `(${viaSheet ? 'forced sheet read' : 'cache'}, ${Object.keys(files).length} attachment link(s))`
  );

  return { project, client: client || {}, files };
}

function render(project, client, files, req) {
  return buildNewOrderEmail({
    client,
    project,
    files,
    addedBy: req.query.addedBy || req.body?.addedBy ||
             req.user?.name  || project.Sales_Lead || project.Created_By || '',
    options: {
      hideEmptyRows: String(req.query.hideEmpty || '') === '1',
      appUrl: process.env.FRONTEND_URL || null,
    },
  });
}

/* ── GET /api/new-order/health ──────────────────────────────────────── */
router.get('/health', async (_req, res) => {
  let smtp, from;
  if (TRANSPORT === 'appsscript') {
    try {
      const q = await db.mailQuota();
      smtp = { ok: true, transport: 'appsscript', sender: q.sender, remaining_quota: q.remaining_quota };
    } catch (e) {
      smtp = {
        ok: false, transport: 'appsscript', error: e.message,
        hint: 'Add the sendMail action to Code.gs and redeploy — see appsscript-sendMail.gs.',
      };
    }
    from = { ok: true, note: 'Apps Script sends as the account that owns the script.' };
  } else {
    smtp = { ...(await verifyMailer()), transport: 'smtp' };
    from = checkFromAddress();
  }
  const r = recipients();
  res.json({
    success: true,
    smtp,
    from_address: from,
    smtp_user: process.env.SMTP_USER || null,
    mail_from : process.env.MAIL_FROM || null,
    test_mode: r.testMode,
    will_send_to: r.to,
    cc: r.cc,
    hint: r.testMode
      ? `Test mode is ON — everything goes to ${r.to.join(', ')}. Set NEW_ORDER_TEST_MODE=false in backend/.env to mail the real team list.`
      : 'Test mode is OFF — the real team list will receive the form.',
  });
});

/* ── GET /api/new-order/:projectId/preview ──────────────────────────── */
router.get('/:projectId/preview', async (req, res, next) => {
  try {
    const { project, client, files } = await load(req.params.projectId);
    const email = render(project, client, files, req);
    const r = recipients();

    res.json({
      success: true,
      data: {
        ...email,
        recipients : r.to,
        cc         : r.cc,
        test_mode  : r.testMode,
        project_id : project.Project_ID,
        project_name: project.Project_Name,
        client_name : client.Client_Name || project.Client_Name || null,
        already_sent_at: project.New_Order_Sent_At || null,
        attachments_resolved: Object.keys(files).length,
      },
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: err.message });
    next(err);
  }
});

/* ── POST /api/new-order/:projectId/send ────────────────────────────── */
router.post('/:projectId/send', async (req, res, next) => {
  try {
    const { project, client, files } = await load(req.params.projectId);

    /* Guard against a double-click sending the form twice. Pass { force:true }
       to deliberately resend. New_Order_Sent_At is written below; if that
       column does not exist in the Projects tab yet the write is skipped and
       this guard simply never trips — the email still sends fine. */
    if (project.New_Order_Sent_At && !req.body?.force) {
      return res.status(409).json({
        success: false,
        error  : 'The New Order Form has already been sent for this project.',
        sent_at: project.New_Order_Sent_At,
        hint   : 'Send again with { "force": true } to resend.',
      });
    }

    const email = render(project, client, files, req);
    const r = recipients();
    const subject = email.subject;

    /*  The same files that are listed as links in the body now ride along as
        real attachments, which is what the AppSheet automation did and what
        the team expects to be able to open from their phone.

        Named the way they were uploaded. The New Order Form email lists a
        readable filename in the body, so an attachment called
        X2LgXPB2.Proposal.0961209.pdf beside it looks like a different file
        altogether.                                                         */
    const newOrderNames = {};
    for (const [, col] of Object.entries(FILE_LABEL_TO_COL)) {
      const path = String(project[col] || '').split(',')[0].trim();
      const friendly = String(project[`${col}_Name`] || '').trim();
      if (path && friendly) newOrderNames[path] = friendly;
    }

    const attachments = attachmentsFrom(files, newOrderNames);

    const result = await sendMail({
      to: r.to,
      senderName: SENDER_NAMES.new,      // "New Sales Order"
      cc: r.cc,
      subject,
      html: email.html,
      text: email.text,
      replyTo: (r.to && r.to.length ? r.to.join(',') : undefined),
      attachments,
    });

        /*  The project row is no longer stamped with New_Order_Sent_At /
        New_Order_Sent_By / New_Order_Message_Id — those three columns were
        removed from the Projects tab to match the itadmin master schema.

        Nothing is lost. The Order_Log insert below already records who sent
        what and when, which is the audit trail that mattered. The Message-ID
        was only ever used to thread update emails, and it could never work
        on the Apps Script transport: MailApp does not return a Message-ID,
        which is why that column was empty on all 1,720 rows.              */
    const sentAt = new Date().toISOString();
    const stamped = false;


    /*  Audit row in Order_Log — best effort, never blocks the response.

        Order_Id is minted and awaited BEFORE the fire-and-forget insert. The
        insert itself is deliberately not awaited, but the id must be, or the
        row is written with a Promise in the key column.                    */
    const orderLogId = await newOrderId();
    db.insert('order_log', {
      Order_Id: orderLogId,
      Project_ID  : project.Project_ID,
      Client_Id   : project.Client_Id || '',
      Client_Type : 'existing',
      Submitted_By: req.user?.email || req.body?.addedBy || 'app',
      Submitted_At: sentAt,
      Note        : `New Order Form ${result.sent ? 'emailed to' : 'NOT sent (SMTP off) — intended for'} ${r.to.join(', ')}`,
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        sent      : result.sent,
        reason    : result.reason || null,
        subject,
        recipients: result.to,
        cc        : result.cc || [],
        message_id: result.messageId || null,
        accepted  : result.accepted || [],
        rejected  : result.rejected || [],
        attached  : (result.attached || []).map(a => a.name),
        attachments_skipped: result.skipped || [],
        smtp_response: result.response || null,
        from      : result.from || null,
        test_mode : r.testMode,
        sent_at   : sentAt,
        stamped,
        preview   : result.sent ? undefined : result.preview,
      },
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: err.message });
    console.error('[new-order] send failed:', err);
    res.status(500).json({ success: false, error: `Could not send the New Order Form: ${err.message}` });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Project updates — emailed as a reply inside the original New Order thread
   ══════════════════════════════════════════════════════════════════════════ */

/** Normalise and sanity-check the changes array coming from the edit form. */
function readChanges(body) {
  const raw = Array.isArray(body?.changes) ? body.changes : [];
  return raw
    .filter(c => c && c.label)
    .map(c => ({
      label: String(c.label),
      from : c.from === null || c.from === undefined ? '' : String(c.from),
      to   : c.to   === null || c.to   === undefined ? '' : String(c.to),
    }))
    .filter(c => c.from !== c.to);
}

/* POST /api/new-order/:projectId/update-preview   body: { changes:[...] } */
router.post('/:projectId/update-preview', async (req, res, next) => {
  try {
    const { project, client } = await load(req.params.projectId);
    const changes = readChanges(req.body);

    if (!changes.length) {
      return res.json({ success: true, data: { changes: [], empty: true } });
    }

    const email = buildProjectUpdateEmail({
      client, project, changes,
      updatedBy: req.body?.updatedBy || req.user?.name || req.user?.email || '',
      options  : { appUrl: process.env.FRONTEND_URL || null },
    });
    const r = recipients();

    res.json({
      success: true,
      data: {
        ...email,
        changes,
        recipients : r.to,
        cc         : r.cc,
        test_mode  : r.testMode,
        project_id : project.Project_ID,
        project_name: project.Project_Name,
        /* No original Message-ID means the New Order Form was never sent from
           Project Repository, so this reply cannot be threaded onto it. */
        threaded   : Boolean(project.New_Order_Message_Id),
      },
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: err.message });
    next(err);
  }
});

/* POST /api/new-order/:projectId/send-update     body: { changes:[...] } */
router.post('/:projectId/send-update', async (req, res, next) => {
  try {
    const { project, client } = await load(req.params.projectId);
    const changes = readChanges(req.body);

    if (!changes.length) {
      return res.status(400).json({
        success: false,
        error  : 'Nothing changed, so there is nothing to email.',
      });
    }

    /*  Attach only what this update introduced. load() already resolved every
        file on the project, but sending all of them again is noise — the team
        wants the new PO, not a second copy of the proposal they read last
        week. Resolved separately, and against the paths from the change rows
        rather than the project row, so it is exactly the delta.           */
    const newPaths = changedFilePaths(changes, project);
    const newFiles = newPaths.length
      ? await withTimeout(db.resolveFiles(newPaths), ATTACHMENT_TIMEOUT_MS, {}, 'update attachment lookup')
      : {};

    /*  The same resolved lookup feeds three things, so it is only done once:

          links       -> the "After" cell in the Changes table becomes a
                         clickable link to the new file
          nameByPath  -> the attachment arrives named the way it was uploaded,
                         not X2LgXPB2.Proposal.0961209.pdf
          attachments -> the file itself rides along

        All three are keyed off the SAME path, so they cannot disagree about
        which file a row is talking about.                                 */
    const links      = {};
    const nameByPath = {};

    for (const [label, col] of Object.entries(FILE_LABEL_TO_COL)) {
      const path = String(project[col] || '').split(',')[0].trim();
      if (!path) continue;

      const friendly = String(project[`${col}_Name`] || '').trim();
      if (friendly) nameByPath[path] = friendly;

      const info = newFiles[path];
      if (info && info.view) links[label] = { view: info.view };
    }

    const attachments = attachmentsFrom(newFiles, nameByPath);

    const email = buildProjectUpdateEmail({
      client, project, changes, links,
      updatedBy: req.body?.updatedBy || req.user?.name || req.user?.email || '',
      options  : { appUrl: process.env.FRONTEND_URL || null },
    });

    const r = recipients();
    const subject = email.subject;
    const parentId = project.New_Order_Message_Id || null;

    const result = await sendMail({
      to: r.to,
      senderName: SENDER_NAMES.update,   // "Updated Sales Order"
      cc: r.cc,
      subject,
      html: email.html,
      text: email.text,
      replyTo: (r.to && r.to.length ? r.to.join(',') : undefined),
      inReplyTo : parentId || undefined,
      references: parentId || undefined,
      attachments,
    });

    const sentAt = new Date().toISOString();

    const sentOrderLogId = await newOrderId();
    db.insert('order_log', {
      Order_Id: sentOrderLogId,
      Project_ID  : project.Project_ID,
      Client_Id   : project.Client_Id || '',
      Client_Type : 'existing',
      Submitted_By: req.user?.email || req.body?.updatedBy || 'app',
      Submitted_At: sentAt,
      Note        : `Project update (${changes.length} field${changes.length===1?'':'s'}) ` +
                    `${result.sent ? 'emailed to' : 'NOT sent — intended for'} ${r.to.join(', ')}`,
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        sent      : result.sent,
        reason    : result.reason || null,
        subject,
        changes,
        recipients: result.to,
        cc        : result.cc || [],
        message_id: result.messageId || null,
        accepted  : result.accepted || [],
        rejected  : result.rejected || [],
        attached  : (result.attached || []).map(a => a.name),
        attachments_skipped: result.skipped || [],
        smtp_response: result.response || null,
        threaded  : Boolean(parentId),
        test_mode : r.testMode,
        sent_at   : sentAt,
      },
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: err.message });
    console.error('[new-order] update send failed:', err);
    res.status(500).json({ success: false, error: `Could not send the update: ${err.message}` });
  }
});

/* POST /api/new-order/test-send — plain diagnostic email, no project needed */
router.post('/test-send', async (req, res) => {
  try {
    const r = recipients();
    const result = await sendMail({
      to: r.to,
      subject: `[TEST] Project Repository SMTP check — ${new Date().toLocaleString('en-IN')}`,
      text: 'If you are reading this, Project Repository can send email successfully.',
      html: '<p style="font-family:Arial">If you are reading this, Project Repository can send email successfully.</p>',
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;