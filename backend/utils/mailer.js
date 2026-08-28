// backend/utils/mailer.js
// Sends a "what changed" email to the EcoSoch team after a client/project edit.
// Works with any SMTP (Gmail / Google Workspace / etc) via env vars.
// If SMTP isn't configured (or nodemailer isn't installed), it logs the message
// to the server console instead of crashing — so the app keeps working.

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* not installed yet */ }

const TEAM = (process.env.TEAM_EMAILS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const FROM = process.env.MAIL_FROM || 'EcoSoch App <noreply@ecosoch.com>';

let transporter = null;
function getTransporter() {
  if (transporter !== null) return transporter;
  if (!nodemailer || !process.env.SMTP_HOST) { transporter = false; return false; }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // 465 = SSL
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

// Compare two records and return a list of {label, from, to} for changed fields.
// Only fields present in `after` (i.e. fields the edit actually sent) are checked.
function buildChanges(before = {}, after = {}, labels) {
  const norm = v => (v === null || v === undefined || v === '') ? '—' : String(v);
  const changes = [];
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in after)) continue;
    if (norm(before?.[key]) !== norm(after[key])) {
      changes.push({ label, from: norm(before?.[key]), to: norm(after[key]) });
    }
  }
  return changes;
}

async function sendChangeEmail({ subject, heading, entityName, editedBy, changes }) {
  if (!changes || !changes.length) return { sent: false, reason: 'no changes' };

  const when = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const text =
    `${heading}\n${entityName}\n` +
    (editedBy ? `Edited by: ${editedBy}\n` : '') +
    `\nChanges:\n` +
    changes.map(c => `  • ${c.label}: ${c.from}  ->  ${c.to}`).join('\n') +
    `\n\nUpdated: ${when}\n— EcoSoch Solar Care`;

  const rows = changes.map(c => `
    <tr>
      <td style="padding:7px 14px;font-weight:600;color:#475569;border-bottom:1px solid #f1f5f9">${c.label}</td>
      <td style="padding:7px 14px;color:#94a3b8;border-bottom:1px solid #f1f5f9">${c.from}</td>
      <td style="padding:7px 14px;color:#0f172a;font-weight:600;border-bottom:1px solid #f1f5f9">${c.to}</td>
    </tr>`).join('');
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px">
    <div style="background:#1e3a5f;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0">
      <div style="font-size:16px;font-weight:800">${heading}</div>
      <div style="font-size:13px;opacity:.7;margin-top:2px">${entityName}</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:8px 0">
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="background:#f8fafc">
          <th style="padding:7px 14px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Field</th>
          <th style="padding:7px 14px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Before</th>
          <th style="padding:7px 14px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em">After</th>
        </tr>
        ${rows}
      </table>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:14px">
      ${editedBy ? `Edited by ${editedBy} · ` : ''}${when} · EcoSoch Solar Care
    </p>
  </div>`;

  /*  Use the same transport as the rest of the app. This function was left
      behind when mail moved to Apps Script: it called getTransporter()
      directly, which only ever returns an SMTP transport. sendMail() below
      already picks the right one, so defer to it.                        */
  if (!TEAM.length) {
    console.log('\n──────── [EcoSoch mail — not sent, no recipients] ────────');
    console.log('To: (set TEAM_EMAILS in backend/.env)');
    console.log('Subject:', subject);
    console.log(text);
    console.log('──────────────────────────────────────────────────────────\n');
    return { sent: false, reason: 'TEAM_EMAILS is empty', preview: text };
  }

  try {
    const res = await sendMail({
      to: TEAM, subject, text, html,
      senderName: process.env.MAIL_SENDER_NAME || 'EcoSoch Solar Care',
    });
    return { sent: res.sent, to: res.to, reason: res.reason || null };
  } catch (e) {
    /*  A change notification must never fail the save that triggered it. */
    console.warn(`[mail] change email not sent: ${e.message}`);
    return { sent: false, reason: e.message, preview: text };
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   Generic send — used by the New Order Form (routes/newOrder.js).

   Reuses the transporter above, so there is one SMTP config for the whole app.
   Recipients are explicit here rather than always TEAM_EMAILS, because the New
   Order Form has its own list (ecosoch-team@ecosoch.com) and its own test-mode
   override.

   Returns { sent, to, messageId } and NEVER throws for a missing SMTP config —
   it logs a full preview to the console instead, same as sendChangeEmail.
─────────────────────────────────────────────────────────────────────────── */
/*  Mail goes through the Apps Script that owns the sheet — the script's Google
    account is the sender, using its own quota. No SMTP server, no app password.

    The nodemailer path below is kept only as an escape hatch: set
    MAIL_TRANSPORT=smtp in .env if you ever need it. It is off by default and
    no SMTP_* variables are read unless you turn it on.                      */
/*  senderName sets the display name the recipient sees in the From line.
    The New Order Form sends as "New Sales Order"; an update to an existing
    project sends as "Updated Sales Order". Callers that pass nothing keep the
    old behaviour.                                                          */
async function sendMail({ to, cc, subject, html, text, replyTo, from, senderName,
                         inReplyTo, references, headers }) {

  if (String(process.env.MAIL_TRANSPORT || 'appsscript').toLowerCase() === 'appsscript') {
    const db = require('../db/sheets');
    const list = (Array.isArray(to) ? to : String(to || '').split(','))
      .map(s => String(s).trim()).filter(Boolean);
    if (!list.length) throw new Error('No recipients — nothing to send to.');

    const res = await db.sendMail({
      to: list, cc, subject, html, text, replyTo,
      name: senderName || process.env.MAIL_SENDER_NAME || 'New Sales Order',
    });

    console.log(
      `[mail:appsscript] "${subject}" -> [${(res.to || []).join(', ')}] ` +
      `· ${res.remaining_quota} sends left today`
    );

    return {
      sent: true, to: res.to || list, cc: res.cc || [],
      accepted: res.to || list, rejected: [],
      messageId: null, from: res.sender,
      response: `Apps Script accepted · ${res.remaining_quota} remaining today`,
      reason: null,
    };
  }

  const list = (Array.isArray(to) ? to : String(to || '').split(','))
    .map(s => String(s).trim()).filter(Boolean);
  const ccList = (Array.isArray(cc) ? cc : String(cc || '').split(','))
    .map(s => String(s).trim()).filter(Boolean);

  if (!list.length) throw new Error('No recipients — nothing to send to.');

  const t = getTransporter();
  if (!t) {
    console.log('\n──────── [EcoSoch mail — NOT SENT, SMTP not configured] ────────');
    console.log('To:', list.join(', '));
    if (ccList.length) console.log('Cc:', ccList.join(', '));
    console.log('Subject:', subject);
    console.log(text || '(html only)');
    console.log('────────────────────────────────────────────────────────────────');
    console.log('Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in backend/.env to send for real.\n');
    return { sent: false, reason: 'SMTP not configured', to: list, preview: text };
  }

  /*  FROM is a full header like 'EcoSoch App <noreply@ecosoch.com>'. To honour
      senderName on the SMTP path, swap just the display part and keep the
      address, since that is what the server is authorised to send as.      */
  const fromHeader = from
    || (senderName
        ? `"${String(senderName).replace(/"/g, '')}" <${(String(FROM).match(/<([^>]+)>/) || [null, FROM])[1]}>`
        : FROM);

  const info = await t.sendMail({
    from: fromHeader,
    to  : list.join(','),
    cc  : ccList.length ? ccList.join(',') : undefined,
    replyTo: replyTo || undefined,
    /* Threading: Gmail groups a message with an earlier one when In-Reply-To
       and References carry that message's Message-ID. */
    inReplyTo : inReplyTo || undefined,
    references: references || undefined,
    headers   : headers    || undefined,
    subject, text, html,
  });

  const accepted = info.accepted || [];
  const rejected = info.rejected || [];

  /*  "Sent" has to mean the SMTP server actually took the message for at least
      one recipient. Without this check nodemailer resolving successfully was
      being reported as delivered even when Gmail accepted zero recipients —
      which is how you get a success toast and no email.                     */
  const delivered = accepted.length > 0 && rejected.length === 0;

  console.log(
    `[mail] ${delivered ? 'OK ' : 'PROBLEM'} "${subject}" ` +
    `accepted=[${accepted.join(', ')}] rejected=[${rejected.join(', ')}] ` +
    `id=${info.messageId} server="${(info.response || '').trim()}"`
  );

  return {
    sent: delivered,
    to: list,
    cc: ccList,
    messageId: info.messageId,
    accepted,
    rejected,
    response: info.response || null,
    envelope: info.envelope || null,
    from: from || FROM,
    reason: delivered
      ? null
      : (rejected.length ? `The mail server rejected: ${rejected.join(', ')}`
                         : 'The mail server accepted no recipients'),
  };
}

/*  Gmail refuses to send as an address the authenticated account does not own.
    Depending on the account it either errors or silently rewrites the From,
    and a rewritten From is a common reason a "sent" message never turns up
    where you expected it. Surfaced by /api/new-order/health.               */
function checkFromAddress() {
  const user = String(process.env.SMTP_USER || '').trim().toLowerCase();
  const m = String(process.env.MAIL_FROM || '').match(/<([^>]+)>/);
  const fromAddr = (m ? m[1] : process.env.MAIL_FROM || '').trim().toLowerCase();

  if (!user || !fromAddr) return { ok: true };
  if (user === fromAddr) return { ok: true };

  return {
    ok: false,
    warning:
      `MAIL_FROM is "${fromAddr}" but you are authenticated as "${user}". ` +
      `Gmail only allows sending as an address the account owns. Either set ` +
      `MAIL_FROM to <${user}>, or add ${fromAddr} as a verified alias under ` +
      `Gmail Settings -> Accounts -> Send mail as.`,
  };
}

/** Verify SMTP credentials without sending anything. */
async function verifyMailer() {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'SMTP not configured (SMTP_HOST is empty)' };
  try { await t.verify(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { buildChanges, sendChangeEmail, sendMail, verifyMailer, checkFromAddress };