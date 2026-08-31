/*  backend/lib/newOrderTemplate.js
    ----------------------------------------------------------------------------
    Rebuilds the AppSheet "Send email to All after project is added" body
    template in Node, so Project Repository can send the same New Order Form the team has
    been receiving for years.

    Reference: New Order - Naveen Mudgil_Vaishnavi Commune_Subsidy_6.82kWp_String

    Two things make this a faithful port rather than a lookalike:

      1. ROWS is keyed on the SHEET COLUMN NAMES (Client_Name, Project_Size…),
         which are the same names the DOCX uses inside <<[ ]>>. So it renders
         straight off the raw row from db.get('projects', id) — no mapping, no
         field-name drift.

      2. Values are printed exactly as the sheet holds them. AppSheet never
         normalised these, which is why the real email shows "Y" for one Yes/No
         column and "No. Have to ask customer to send the bill photo" for
         another. Converting them would make the email disagree with the sheet.

    Empty rows are KEPT by default, because the AppSheet email keeps them.
--------------------------------------------------------------------------- */

/* ── Styling lifted from the AppSheet email ──────────────────────────────
   Google-Docs export: 1pt solid black grid, #cccccc section header,
   Arial 10pt bold labels (#444444), Arial 11pt values (#000000).        */
/*  ── EVERY LINK IN THIS EMAIL OPENS IN A NEW TAB ──────────────────────────

    target="_blank" is the part that matters. Without it, a webmail client is
    free to open the link in the same tab, which navigates AWAY from the email
    — the salesperson loses their place, and getting back means finding the
    thread again. Attachments in particular are opened one after another,
    so staying put is the whole point.

    rel="noopener noreferrer" travels with it. A page opened via target=_blank
    can otherwise reach back through window.opener and redirect the tab it came
    from. These links point at Drive today, but the same helper renders any URL
    somebody types into the GMap or Files fields, and a template should not
    depend on its inputs being trustworthy.

    Written as one constant rather than repeated five times so a link added
    later cannot quietly miss it.                                            */
const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';

const S = {
  /*  Full-width layout. The AppSheet original used fixed point widths
      (180.8pt + 287.2pt) which left most of the message body empty on a
      desktop screen. Everything here is percentage-based, so the tables fill
      whatever width the mail client gives them, down to phone size.        */
  page    : "margin:0;padding:0;width:100%;background:#eef1f3",
  shell   : "width:100%;border-collapse:collapse;background:#ffffff",
  pad     : "padding:22px 28px",
  band    : "background:#2F3E46;padding:20px 28px",
  /* Unused since the "EcoSoch Energy Solutions" strap was removed from the
     header. Kept so it is one line to put back if you ever want it. */
  brand   : "font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#F58220;margin:0",
  title   : "font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;margin:6px 0 0 0;line-height:1.3",
  sub     : "font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#c7d1d6;margin:8px 0 0 0;line-height:1.5",

  table   : "width:100%;border-collapse:collapse;margin:0 0 22px 0",
  section : "background:#F58220;padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ffffff",

  /* 32/68 split — long question labels still wrap sensibly, and the value
     column gets the room addresses and comments actually need. */
  /*  Gmail ignores CSS percentage widths on <td> often enough that the label
      column was rendering at ~50%. A <colgroup> plus explicit width attributes
      is the combination email clients actually honour.                      */
  /*  Fixed PIXEL width on the label cell, and no table-layout:fixed.
      Percentage widths are unreliable in Gmail — they were rendering the label
      column at 50%, and once that was corrected the row rules broke at the
      column boundary. Pixel widths on the first cell are the pattern email
      clients handle consistently, and the value cell simply takes the rest. */
  label   : "width:220px;min-width:220px;padding:10px 14px;border-bottom:1px solid #e3e7e8;background:#f7f9fa;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#42525a;vertical-align:top;line-height:1.45",
  value   : "padding:10px 14px;border-bottom:1px solid #e3e7e8;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1d272c;vertical-align:top;line-height:1.45;word-break:break-word",
  empty   : "color:#b6c0c4",

  para    : "margin:0;line-height:1.55",
  link    : "color:#0b6bcb;text-decoration:underline",
  footer  : "padding:18px 28px;border-top:1px solid #e3e7e8;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#7b878d;line-height:1.6",
};

/* ── Sender names and subject prefixes ───────────────────────────────────
   A brand-new project and an update to an existing one are two different
   messages and should not look identical in an inbox. Both the From name and
   the subject prefix change; everything else about the two emails is shared.

       new project      From: New Sales Order
                        Subject: New Order - <Project_Name>

       updated project  From: Updated Sales Order
                        Subject: Re: Updated Order - <Project_Name>

   Either name can be overridden from .env without touching this file:
       MAIL_SENDER_NAME=New Sales Order
       MAIL_SENDER_NAME_UPDATE=Updated Sales Order                          */
const SENDER_NAMES = {
  new   : process.env.MAIL_SENDER_NAME        || 'New Sales Order',
  update: process.env.MAIL_SENDER_NAME_UPDATE || 'Updated Sales Order',
};

const SUBJECT_PREFIX = {
  new   : 'New Order - ',
  update: 'Updated Order - ',
};

/* ── Client Details ─────────────────────────────────────────────────────
   In the DOCX these are <<[Client_Name].[Client_Address]>> — a dereference
   into the Clients table, so they read from the client row.              */
const CLIENT_ROWS = [
  { col: 'Client_Name',           label: 'Name' },
  { col: 'Client_Address',        label: 'Address' },
  { col: 'Client_GMap_Location',  label: 'Gmap Location', type: 'gmap' },
  { col: 'Client_Mobile',         label: 'Mobile' },
  { col: 'Client_Email',          label: 'Email' },
  { col: 'Client_Region',         label: 'Region' },
  { col: 'Client_Identity',       label: 'Identity' },
  { col: 'Client_Notes',          label: 'Notes' },
];

/* ── Project Details — order verbatim from the DOCX ──────────────────── */
const PROJECT_ROWS = [
  { col: 'Project_ID',              label: 'Project Id' },
  { col: 'Deal_ID',                 label: 'Deal ID in Zoho',   type: 'url' },
  { col: 'Proposal_Model',          label: 'Proposal Model',     bold: true, color: '#D32F2F' },
  { col: 'Project_Name',            label: 'Project Name' },
  { col: 'Project_Size',            label: 'Capacity (in kWp)',  type: 'decimal3' },
  { col: 'Project_Type',            label: 'Type of Project' },
  { col: 'AMC_Provided',            label: 'Is there a separate AMC provided?' },
  { col: 'AMC_Type',                label: 'Type of AMC Contract' },
  { col: 'Project_Status',          label: 'Current Project Status' },
  { col: 'Bill_Available',          label: 'Electricity Bill Available?' },
  { col: 'Bill_File',               label: 'Electricity Bill photo',  type: 'file' },
  { col: 'Quotation_Name',          label: 'Quotation Name' },
  { col: 'PO_Bill_Name_Same',       label: 'Is the Customer name on PO and name on DISCOM bill same?' },
  { col: 'DISCOM_Name',             label: 'DISCOM Documentation Name' },
  { col: 'Billing_Quotation_Same',  label: 'Is the Billing Name the same as the Quotation Name?' },
  { col: 'Billing_Name',            label: 'Billing Name' },
  { col: 'GST_Available',           label: 'Is there a GSTIN Number?' },
  { col: 'GST_Number',              label: 'GSTIN Number' },
  { col: 'PO_File',                 label: 'Purchase Order',     type: 'file' },
  { col: 'Site_Address',            label: 'Postal address of site' },
  { col: 'GMap_Link',               label: 'GMap Location',      type: 'gmap' },
  { col: 'Project_Region',          label: 'Project Region' },
  { col: 'Project_Comments',        label: 'Project Comments' },
  { col: 'Project_Description',     label: 'Points specific to this Project' },
  { col: 'Client_Committment',      label: 'What have you committed to the client as a salesperson?' },
  { col: 'Obstacle_Removal',        label: 'Are there any obstacles to be removed before installation?' },
  { col: 'Obstacle_Scope',          label: 'Is the removal of the obstacle in Client or EcoSoch scope? Provide exact details.' },
  { col: 'Elevated_drawings',       label: 'Is Elevated structure detailed drawings required?' },
  { col: 'Referral',                label: 'Is this a referral project?' },
  { col: 'Referrer_Name',           label: 'Name of Referrer' },
  { col: 'Referral_Amount',         label: 'Referral Amount' },
  { col: 'BESCOM',                  label: 'Can we apply for DISCOM before TSV?' },
  { col: 'Capacity_Finalised',      label: 'Is the system size finalised?' },
  { col: 'TSV_Required',            label: 'Is then a TSV required to finalise the system size?' },
  { col: 'Subsidy',                 label: 'Is this a subsidy project?' },
  { col: 'Monitoring',              label: 'Is generation monitoring committed to the client?' },
  { col: 'Monitoring_Frequency',    label: 'What is the monitoring frequency?' },
  { col: 'Retention',               label: 'Is there any retention amount for this project?' },
  { col: 'Retention_Amount',        label: 'What is the Retention Amount?' },
  { col: 'Retention_Period',        label: 'What is the Retention Period?' },
  { col: 'Sales_Lead',              label: 'Sales Lead' },
  { col: 'Building_Type',           label: 'Building Type' },
  { col: 'Business_Model',          label: 'Business Model' },
  { col: 'Inverter_Brand',          label: 'Inverter Brand' },
  { col: 'Inverter_Type',           label: 'Inverter Type' },
  { col: 'Module_Brand',            label: 'Module Brand' },
  { col: 'Module_Wattage',          label: 'Module Wattage (Wp)' },
  { col: 'Module_No',               label: 'No.of Modules' },
  { col: 'Roof_Material',           label: 'Roof Material' },
  { col: 'Roof_Type',               label: 'Type of Roof' },
  { col: 'Project_Sector',          label: 'Project Sector' },
  { col: 'System_Type',             label: 'System Type' },
  { col: 'System_Category',         label: 'System Category' },
  { col: 'Quote_Sheet',             label: 'Cost Breakdown Sheet', type: 'file' },
  { col: 'Proposal',                label: 'Proposal',             type: 'file' },
  { col: 'Files',                   label: 'Other Files',          type: 'file' },
  { col: 'Exp_Inst_Date',           label: 'Expected Installation Date', type: 'date' },
  { col: 'Exp_Commsn_Date',         label: 'Expected Commissioning Date', type: 'date' },
];

/** Every attachment column the template can hyperlink. */
const FILE_COLUMNS = PROJECT_ROWS.filter(r => r.type === 'file').map(r => r.col);

/* ────────────────────────── value helpers ────────────────────────── */

function fmtBool(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true')  return 'Yes';
  if (s === 'false') return 'No';
  return null;   // not a boolean — leave the value untouched
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function blank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

/** dd/mm/yyyy — how the AppSheet email prints Exp_Inst_Date. */
function fmtDate(v) {
  if (blank(v)) return '';
  const s = String(v).trim();

  // already dd/mm/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;

  // Google Sheets serial number
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    const ms = (Number(s) - 25569) * 86400000;
    const d  = new Date(ms);
    return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
  }

  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

/** 6.82 -> "6.820", matching AppSheet's 3-decimal capacity display. */
function fmtDecimal3(v) {
  if (blank(v)) return '';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toFixed(3);
}

/** "4FBA449F.PO_File.045929.pdf" -> "4FBA449F.PO_File.045929", or the real
 *  original filename when one was saved alongside the path (see fileNameKey
 *  in frontend/src/lib/projectFields.js and the *_Name sheet columns it
 *  writes). Older rows saved before that existed have no such column, so
 *  preferredName is undefined and this falls back to the derived name,
 *  exactly as before. */
function fileLabel(path, preferredName) {
  if (preferredName && String(preferredName).trim()) return String(preferredName).trim();
  const base = String(path).split('/').pop() || '';
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, '') || base;
}

function gmapUrl(v) {
  return `http://maps.google.com/maps?q=${encodeURIComponent(String(v).trim())}`;
}

/* ────────────────────────── cell rendering ────────────────────────── */

function p(inner, extra = '') {
  return `<p style="${S.para}${extra}">${inner}</p>`;
}

/**
 * @param {object} row       cell definition from CLIENT_ROWS / PROJECT_ROWS
 * @param {*}      raw       value straight off the sheet row
 * @param {object} files     { [sheetPath]: { view, download } } from db.resolveFiles
 * @param {object} source    the full sheet row this cell came from — needed
 *                           only by the 'file' case, to look up row.col + '_Name'
 */
function valueHtml(row, raw, files, source) {
  if (blank(raw)) return '';

  switch (row.type) {
    case 'gmap': {
      const v = String(raw).trim();
      // Matches the AppSheet cell: the hyperlink, then the raw coordinates.
      return `<a href="${esc(gmapUrl(v))}" ${NEW_TAB} style="${S.link}">Click on ${esc(v)} for GMap Location</a>` +
             `<div style="margin-top:3px;color:#5c686d">${esc(v)}</div>`;
    }

    case 'url': {
      const v = String(raw).trim();
      return /^https?:\/\//i.test(v)
        ? p(`<a href="${esc(v)}" ${NEW_TAB} style="${S.link}">${esc(v)}</a>`)
        : p(esc(v));
    }

    case 'file': {
      // Sheets can hold several comma-separated attachment paths in one cell.
      const paths = String(raw).split(',').map(s => s.trim()).filter(Boolean);
      /*  Our upload flow only ever writes one path per field (see
          fileNameKey in projectFields.js), so there is exactly one companion
          name to look up here — but this stays comma-list-safe regardless,
          for any cell that genuinely does hold more than one path.        */
      const preferredName = source?.[`${row.col}_Name`];
      return paths.map(path => {
        const f = files?.[path];
        const url = f?.view || f?.download || null;
        const label = fileLabel(path, preferredName);
        return url
          ? p(`<a href="${esc(url)}" ${NEW_TAB} style="${S.link}">${esc(label)}</a>`)
          : p(esc(label));
      }).join('');
    }

    case 'date':     return p(esc(fmtDate(raw)));
    case 'decimal3': return p(esc(fmtDecimal3(raw)));

    default: {
      // Booleans render as Yes/No in the email only (the sheet keeps TRUE/FALSE).
      const yn = fmtBool(raw);
      if (yn !== null) return p(esc(yn));
      // Multi-line values (Project_Description) keep their line breaks.
      return String(raw).split(/\r?\n/).map(line => p(esc(line) || '&nbsp;')).join('');
    }
  }
}

function valueText(row, raw, files) {
  if (blank(raw)) return '';
  switch (row.type) {
    case 'gmap': {
      const v = String(raw).trim();
      return `Click on ${v} for GMap Location\n\n${v}`;
    }
    case 'file':
      return String(raw).split(',').map(s => s.trim()).filter(Boolean)
        .map(path => {
          const f = files?.[path];
          const url = f?.view || f?.download;
          return url ? `${fileLabel(path)} — ${url}` : fileLabel(path);
        }).join('\n');
    case 'date':     return fmtDate(raw);
    case 'decimal3': return fmtDecimal3(raw);
    default:         { const yn = fmtBool(raw); return yn !== null ? yn : String(raw); }
  }
}

/* ────────────────────────── table rendering ────────────────────────── */

function section(title, rows, source, files, opts) {
  let i = 0;
  const body = rows.map(row => {
    const raw = source?.[row.col];
    if (opts.hideEmptyRows && blank(raw)) return '';

    /* Zebra covers the WHOLE row, not just the value cell — striping only one
       column is what made the horizontal rules look broken. */
    const zebra = i++ % 2 ? '#fcfdfd' : '#ffffff';
    const bold  = row.bold ? 'font-weight:bold;' : '';
    const color = row.color ? `color:${row.color};` : '';

    const cell = blank(raw)
      ? `<span style="${S.empty}">&mdash;</span>`
      : valueHtml(row, raw, files, source);

    return (
      `<tr>` +
        `<td width="220" style="${S.label}">${esc(row.label)}</td>` +
        `<td style="${S.value};background:${zebra};${bold}${color}">${cell}</td>` +
      `</tr>`
    );
  }).join('');

  /*  Heading kept in its own table so the data table's first row is a real
      two-column row. A colspan heading inside the table supplied no column
      widths and the layout collapsed to an even split.                     */
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="width:100%;border-collapse:collapse;margin:0">` +
      `<tr><td style="${S.section}">${esc(title)}</td></tr>` +
    `</table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${S.table}">` +
      body +
    `</table>`
  );
}

function sectionText(title, rows, source, files, opts) {
  const out = [title, ''];
  for (const row of rows) {
    const raw = source?.[row.col];
    if (opts.hideEmptyRows && blank(raw)) continue;
    out.push(row.label, valueText(row, raw, files), '');
  }
  return out.join('\n');
}

/* ────────────────────────── public API ────────────────────────── */

/**
 * Subject line, exactly as AppSheet built it:
 *   New Order - Naveen Mudgil_Vaishnavi Commune_Subsidy_6.82kWp_String
 *
 * Project_Name is already the underscore-joined composite, so the subject is
 * simply the prefix plus the project name. Falls back to assembling it from
 * the parts if Project_Name is somehow empty.
 */
function buildSubject(project = {}, client = {}, opts = {}) {
  const prefix = opts.updated ? SUBJECT_PREFIX.update : SUBJECT_PREFIX.new;

  const name = String(project.Project_Name || '').trim();
  if (name) return `${prefix}${name}`;

  const parts = [
    client.Client_Name, project.Site_Area,
    project.Project_Size ? `${project.Project_Size}kWp` : '',
    project.Inverter_Type,
  ].filter(Boolean);
  return `${prefix}${parts.join('_')}`;
}

/**
 * Build the full New Order Form email.
 *
 * @param {object}  args
 * @param {object}  args.client     raw Clients row
 * @param {object}  args.project    raw Projects row
 * @param {object} [args.files]     resolved attachments, { path: { view, download } }
 * @param {string} [args.addedBy]   name shown in "is now added by …"
 * @param {object} [args.options]
 * @param {boolean} [args.options.hideEmptyRows=false]  drop blank rows
 *                  Default false to match AppSheet, which prints every row.
 * @param {string}  [args.options.appUrl]  adds an "Open in Project Repository" link
 * @returns {{subject:string, html:string, text:string}}
 */
function buildNewOrderEmail({ client = {}, project = {}, files = {}, addedBy = '', options = {} }) {
  const opts = { hideEmptyRows: false, appUrl: null, ...options };

  const subject   = buildSubject(project, client);
  const projName  = String(project.Project_Name || '').trim();
  const who       = String(project.Salesperson_Email || addedBy || project.Sales_Lead || '').trim();
  const headline  = `New Project ${projName} is now added${who ? ` by ${who}` : ''}`;

  const openLink = opts.appUrl && project.Project_ID
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0">` +
      `<tr><td style="background:#F58220;border-radius:3px;padding:10px 20px">` +
      `<a href="${esc(opts.appUrl)}/projects/${encodeURIComponent(project.Project_ID)}" ${NEW_TAB} ` +
      `style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none">` +
      `Open this project in Project Repository</a></td></tr></table>`
    : '';

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(subject)}</title></head>` +
    `<body style="${S.page}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${S.page}">` +
    `<tr><td align="center" style="padding:0">` +

    /* No max-width: the message fills the reading pane instead of sitting in a
       narrow column with empty space either side. */
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${S.shell}">` +

      `<tr><td style="${S.band}">` +
        `<h1 style="${S.title}">${esc(projName || 'New Order Form')}</h1>` +
        `<p style="${S.sub}">${esc(headline)}</p>` +
      `</td></tr>` +

      `<tr><td style="${S.pad}">` +
        openLink +
        section('Client Details',  CLIENT_ROWS,  client,  files, opts) +
        section('Project Details', PROJECT_ROWS, project, files, opts) +
      `</td></tr>` +

      `<tr><td style="${S.footer}">` +
        `Sent automatically by Project Repository — EcoSoch Project Repository. ` +
        `Please raise any correction against the project record rather than replying.` +
      `</td></tr>` +

    `</table></td></tr></table></body></html>`;

  const text =
    `${headline}\n\n\n` +
    sectionText('Client Details',  CLIENT_ROWS,  client,  files, opts) + '\n' +
    sectionText('Project Details', PROJECT_ROWS, project, files, opts) + '\n' +
    `Sent from Project Repository — EcoSoch Project Repository\n`;

  return { subject, html, text };
}

/* ─────────────────── project update ("what changed") ─────────────────── */

/**
 * Reply email listing only the fields that changed on an existing project.
 *
 * Subject is "Re: " + the original New Order subject, and the caller threads it
 * by passing the original Message-ID as In-Reply-To / References — so it lands
 * inside the same Gmail conversation as the New Order Form.
 *
 * @param {object}   args
 * @param {object}   args.client      raw Clients row
 * @param {object}   args.project     raw Projects row (already updated)
 * @param {Array}    args.changes     [{ label, from, to }]
 * @param {string}  [args.updatedBy]
 * @param {object}  [args.options]    { appUrl }
 * @returns {{subject:string, html:string, text:string}}
 */
/**
 * @param links  { [changeLabel]: { view } } — a Drive url per FILE change row.
 *               Supplied by routes/newOrder.js, which has already resolved the
 *               paths in order to attach them.
 */
function buildProjectUpdateEmail({ client = {}, project = {}, changes = [],
                                   updatedBy = '', links = {}, options = {} }) {
  const opts = { appUrl: null, ...options };

  const projName = String(project.Project_Name || '').trim();
  /*  "Re: Updated Order - …" rather than "Re: New Order - …", so an update is
      distinguishable from the original at a glance. Threading is unaffected:
      Gmail groups on the In-Reply-To / References headers the caller sets,
      not on the subject text.                                              */
  const subject  = `Re: ${buildSubject(project, client, { updated: true })}`;
  const who      = String(updatedBy || '').trim();
  const when     = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const headline = `${changes.length} field${changes.length === 1 ? '' : 's'} updated on ${projName}` +
                   `${who ? ` by ${who}` : ''}`;

  const head = ['Field', 'Before', 'After'].map(h =>
    `<td${h === 'Field' ? ' width="220"' : ''} style="${S.label};background:#eef2f3">${esc(h)}</td>`
  ).join('');

  const body = changes.map(c => {
    const before = c.from === null || c.from === undefined || c.from === '' ? '—' : String(c.from);
    const after  = c.to   === null || c.to   === undefined || c.to   === '' ? '—' : String(c.to);

    /*  ── THE "After" CELL IS A LINK WHEN THE CHANGE IS A FILE ────────────
        Every other row in this table is a value — a date, a status, a number
        — and printing it is the whole job. A file row is different: the thing
        that changed is a DOCUMENT, and the reader's next action is always to
        open it. Leaving it as text meant scrolling back to the New Order Form
        email, or into the app, to reach a file whose name was already on
        screen.

        Only the "After" side is linked. "Before" names a file that has been
        replaced; the path that pointed at it is gone from the row, so there
        is nothing honest to link it to.

        No link resolved (an unreadable file, or a non-file change) falls back
        to plain escaped text, exactly as before.                          */
    const href  = links?.[c.label]?.view;
    const afterCell = href
      ? `<a href="${esc(href)}" ${NEW_TAB} style="${S.link};font-weight:bold">${esc(after)}</a>`
      : esc(after);

    return (
      `<tr>` +
        `<td width="220" style="${S.label}">${esc(c.label)}</td>` +
        `<td style="${S.value};color:#8a9498">${esc(before)}</td>` +
        `<td style="${S.value};font-weight:bold;color:#1d272c">${afterCell}</td>` +
      `</tr>`
    );
  }).join('');

  const openLink = opts.appUrl && project.Project_ID
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0">` +
      `<tr><td style="background:#F58220;border-radius:3px;padding:10px 20px">` +
      `<a href="${esc(opts.appUrl)}/projects/${encodeURIComponent(project.Project_ID)}" ${NEW_TAB} ` +
      `style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none">` +
      `Open this project in Project Repository</a></td></tr></table>`
    : '';

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="${S.page}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${S.page}">` +
    `<tr><td align="center" style="padding:0">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${S.shell}">` +
      `<tr><td style="${S.band}">` +
        `<h1 style="${S.title}">${esc(projName)}</h1>` +
        `<p style="${S.sub}">${esc(headline)}</p>` +
      `</td></tr>` +
      `<tr><td style="${S.pad}">` +
        openLink +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
        `style="width:100%;border-collapse:collapse;margin:0">` +
          `<tr><td style="${S.section}">Changes</td></tr>` +
        `</table>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${S.table}">` +
          `<tr>${head}</tr>` +
          body +
        `</table>` +
        `<p style="${S.para};font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7b878d">` +
        `Client: ${esc(client.Client_Name || project.Client_Name || '—')} · Updated ${esc(when)}</p>` +
      `</td></tr>` +
      `<tr><td style="${S.footer}">Sent from Project Repository — EcoSoch Project Repository</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const text =
    `${headline}\n\n` +
    changes.map(c => `${c.label}\n  before: ${c.from ?? '—'}\n  after : ${c.to ?? '—'}\n`).join('\n') +
    `\nClient: ${client.Client_Name || project.Client_Name || '—'}\nUpdated ${when}\n\n` +
    `Sent from Project Repository — EcoSoch Project Repository\n`;

  return { subject, html, text };
}

module.exports = {
  buildNewOrderEmail,
  buildProjectUpdateEmail,
  buildSubject,
  SENDER_NAMES,
  SUBJECT_PREFIX,
  CLIENT_ROWS,
  PROJECT_ROWS,
  FILE_COLUMNS,
};