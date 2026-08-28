/*  backend/lib/mapping.js
    ----------------------------------------------------------------------------
    Your Google Sheet uses AppSheet-style column names (Client_Name, Project_Size…)
    while the React frontend expects the old Supabase field names (name, size_kwp…).

    This file translates in both directions so NOT ONE LINE of the React code
    has to change.

        toApp(MAP.clients,   sheetRow)   →  { id, name, phone, … }
        toSheet(MAP.clients, appPatch)   →  { Client_Name, Client_Mobile, … }
--------------------------------------------------------------------------- */

/* ── CLIENTS ─────────────────────────────────────────────────────────── */
const clients = {
  id             : 'Client_Id',
  name           : 'Client_Name',
  phone          : 'Client_Mobile',
  email          : 'Client_Email',
  billing_address: 'Client_Address',
  region         : 'Client_Region',
  client_identity: 'Client_Identity',
  client_status  : 'Client_Status',
  type_of_client : 'Client_Type',
  notes          : 'Client_Notes',
    /*  Created_Date / Last_Updated_Date / Created_By / Last_Updated_By were
      removed from the Clients tab to match the itadmin master schema.     */
  // lat / lng are handled specially — they live inside Client_GMap_Location
};

/* ── PROJECTS ────────────────────────────────────────────────────────── */
const projects = {
  id                : 'Project_ID',
  /*  Client_Id was removed from the Projects tab. Client_Name is the link:
      it is unique across all 1,520 rows of the Clients tab, and the itadmin
      master Projects tab has never carried a Client_Id at all.            */
  client_name       : 'Client_Name',
  name              : 'Project_Name',
  area              : 'Site_Area',
  size_kwp          : 'Project_Size',
  project_type      : 'Project_Type',
  amc_provided      : 'AMC_Provided',
  amc_type          : 'AMC_Type',
  status            : 'Project_Status',
  prev_status       : 'Prev_Project_Status',
  site_address      : 'Site_Address',
  region            : 'Project_Region',
  comments          : 'Project_Comments',
  description       : 'Project_Description',
  sales_lead        : 'Sales_Lead',
  building_type     : 'Building_Type',
  scheme            : 'Business_Model',      // CAPEX / OPEX / CAPEX with Loan
  inverter_brand    : 'Inverter_Brand',
  inverter_type     : 'Inverter_Type',
  module_brand      : 'Module_Brand',
  module_wattage    : 'Module_Wattage',
  module_no         : 'Module_No',
  roof_material     : 'Roof_Material',
  roof_type         : 'Roof_Type',
  sector            : 'Project_Sector',
  system_type       : 'System_Type',
  system_category   : 'System_Category',
  order_value       : 'Order_Value',
  ecosoch_margin_pct: 'Margin',
  proposal_model    : 'Proposal_Model',
  commitment        : 'Client_Committment',
  obstacles         : 'Obstacle_Removal',
  obstacle_scope    : 'Obstacle_Scope',
  salesperson_email : 'Salesperson_Email',
  payments_done     : 'Payments_Done',
  commissioned_date : 'Commissioned_Date',
  warranty_status   : 'Warranty_Status',
  warranty_period   : 'Warranty_Period',
  warranty_start    : 'Warranty_Start_Date',
  warranty_end      : 'Warranty_End_Date',
  gst_number        : 'GST_Number',
  discom_name       : 'DISCOM_Name',
  billing_name      : 'Billing_Name',
  deal_id           : 'Deal_ID',
  subsidy           : 'Subsidy',
  bescom            : 'BESCOM',
  monitoring        : 'Monitoring',
  exp_inst_date     : 'Exp_Inst_Date',
  exp_commsn_date   : 'Exp_Commsn_Date',
  quote_sheet       : 'Quote_Sheet',
  proposal_file     : 'Proposal',
  site_files        : 'Files',
  bill_file         : 'Bill_File',
  po_file           : 'PO_File',
  created_by        : 'Created_By',
  created_at        : 'Created_Date',
  updated_by        : 'Last_Updated_By',
  updated_at        : 'Last_Updated_Date',
  // lat / lng come out of GMap_Link
};

/* ── AMC ─────────────────────────────────────────────────────────────── */
const amc_contracts = {
  id              : 'AMC_Id',
  project_id      : 'Project_ID',
  amc_type        : 'AMC_Type',
  frequency       : 'AMC_Frequency',
  period_years    : 'AMC_Period_in_Years',
  start_date      : 'AMC_Start_Date',
  end_date        : 'AMC_End_Date',
  status          : 'AMC_Status',
  payment_amount  : 'Payment_Amount',
  payment_status  : 'Payment_Status',
  tasks_count     : 'Tasks_Count',
  payments_count  : 'Payments_Count',

  /*  The signed contract / quote / scan for this AMC. The column already
      exists in the AMC_Contracts tab but was never mapped, so a file sent
      from the form would have been silently dropped — the same gap the
      Ticket_Warranty_* columns had.                                      */
  contract_file   : 'AMC_Contract_Files',
};

const amc_tasks = {
  id         : 'AMC_Task_Id',
  /*  AMC_Id is the only parent. A task belongs to a contract, the contract
      belongs to a project — Project_ID here was a denormalised shortcut.  */
  amc_id     : 'AMC_Id',
  amc_type   : 'AMC_Type',
  due_date   : 'AMC_Due_Date',
  description: 'AMC_Description',
  resolution : 'AMC_Resolution',
  status     : 'AMC_Task_Status',
  report     : 'AMC_Task_Report',
  payment_id : 'Payment_Id',
};

const amc_payments = {
  id         : 'Payment_Id',
  amc_id     : 'AMC_Id',
  amc_type   : 'AMC_Type',
  amount     : 'Payment_Amount',
  due_date   : 'Payment_Due_Date',
  description: 'Payment_Description',
  resolution : 'Payment_Resolution',
  status     : 'Payment_Status',
};

/* ── TICKETS ─────────────────────────────────────────────────────────── */
const tickets = {
  id          : 'Ticket_Id',
  project_id  : 'Project_ID',
  type        : 'Ticket_Type',
  priority    : 'Ticket_Priority',
  description : 'Ticket_Description',
  status      : 'Ticket_Status',
  assigned_to : 'Assigned_To',
  progress    : 'Progress_Update',
  resolution  : 'Ticket_Resolution',
  start_date  : 'Ticket_Start_Date',
  due_date    : 'Ticket_Due_Date',
  total_charge: 'Total_Charge',

  /*  Warranty on the repair done under this ticket. These were missing, so
      routes/tickets.js could WRITE Ticket_Warranty_End_Date to the sheet but
      the app could never read it back — toApp only emits mapped keys, and
      every ticket came out of the API with no warranty fields at all.

      Distinct from the Projects tab's Warranty_* columns, which cover the
      installation rather than a repair.                                  */
  warranty_status : 'Ticket_Warranty_Status',
  warranty_period : 'Ticket_Warranty_Period',
  warranty_start  : 'Ticket_Warranty_Start_Date',
  warranty_end    : 'Ticket_Warranty_End_Date',

  material_charge : 'Material_Charge',
  payment_status  : 'Ticket_Payment_Status',
  payment_receipt : 'Ticket_Payment_Receipt',
  created_by  : 'Created_By',
  created_at  : 'Created_Date',
  updated_at  : 'Last_Updated_Date',
};

/* ── USERS ───────────────────────────────────────────────────────────── */
const users = {
  id        : 'Email',
  email     : 'Email',
  name      : 'User_Name',
  role      : 'User_Role',
  department: 'Department',
};

/* ── LAUNCHER ────────────────────────────────────────────────────────── */
const launcher = {
  id               : 'App_Id',
  title            : 'App_Name',
  icon_url         : 'Icon',
  description      : 'Sub_Header',
  order_index      : 'Display_Order',
  role_restrictions: 'User_Role',
};

const MAP = { clients, projects, amc_contracts, amc_tasks, amc_payments, tickets, users, launcher };

/* ─────────────────────────── helpers ─────────────────────────── */

const NUMERIC = new Set([
  'Project_Size', 'Order_Value', 'Margin', 'Module_Wattage', 'Module_No',
  'Warranty_Period', 'Ticket_Warranty_Period', 'Material_Charge',
  'Display_Order', 'Payment_Amount', 'AMC_Period_in_Years',
  'Tasks_Count', 'Payments_Count', 'Total_Charge',
]);

/* Primary keys are NEVER coerced to numbers.
   Your sheet mixes two id styles inherited from AppSheet:
     • 498 numeric ids   e.g. 563447
     • 1044 hex ids      e.g. 44d3cfd9, E6F2C552
   Number('44d3cfd9') is NaN, which used to become null — that is what sent
   every hex-id project to /projects/null. Ids stay strings, always. */
const IDS = new Set(['Client_Id', 'Project_ID', 'AMC_Id', 'AMC_Task_Id',
                     'Payment_Id', 'Ticket_Id', 'App_Id', 'Order_Id', 'Log_Id']);

/*  Columns the sheet stores as REAL BOOLEANS — a Sheets checkbox, TRUE or
    FALSE, never the words. toApp() reads them into true/false; toSheet()
    writes true/false back. Anything not listed here is stored as typed.

    ── NOT IN THIS SET: GST_Available, PO_Available, Bill_Available ────────
    They are TEXT columns with three or four options each, and every
    populated cell across all 1,542 rows is a string:

        GST_Available   Yes / No / Yet to receive from customer
        PO_Available    Yes / No, yet to receive
        Bill_Available  Yes / No. Have to ask customer… / RR number not available

    They used to be listed here on the theory that toBool() returns undefined
    for a tri-state answer so the string would survive. That protected the
    third option and nothing else — "Yes" and "No" ARE recognised by toBool,
    so they were converted, and the sheet ended up with a boolean TRUE in a
    column whose other 1,100 rows read "Yes".                              */
const BOOLEAN = new Set([
  'AMC_Provided', 'Payments_Done',
  'Elevated_drawings', 'Referral', 'BESCOM', 'Capacity_Finalised',
  'TSV_Required', 'Subsidy', 'Monitoring', 'Retention',
  'Obstacle_Removal',
]);

                         
/* Always strings — Sheets stores mobiles as numbers and eats the leading 0 / +91. */
const TEXT = new Set(['Client_Mobile', 'Phone', 'GST_Number', 'Deal_ID', 'Internal_Id']);

/*  ── COLUMNS THAT NO LONGER EXIST ─────────────────────────────────────────

    Deleted from the Sheet to match the itadmin master schema. They are listed
    here because toSheet() lets any capitalised key through untouched, so a
    browser tab that was loaded before this change — or a cached mobile
    session, or an old script — would still post them and Apps Script would be
    asked to write columns that are not there.

    Stripping them here means the old client simply saves without those
    fields, rather than erroring on every save until someone reloads.

    Do NOT add a column here to "disable" it. This list is for columns that
    have genuinely been removed from every tab.                             */
const RETIRED = new Set([
  /* Projects */
  'Defaulted_Pct', 'Scheme',
  'New_Order_Sent_At', 'New_Order_Sent_By', 'New_Order_Message_Id',
  'Workmanship_Start_Date', 'Workmanship_End_Date', 'Workmanship_Status',
  'Is_Commissioned',
  'Bill_File_Name', 'PO_File_Name', 'Quote_Sheet_Name', 'Proposal_Name', 'Files_Name',
  /* Users */
  'User_Status', 'Phone', 'Start_Date',
  /* AMC_Contracts */
  'Total_AMC_Tasks', 'Total_Payments', 'Tasks_per_Payment',
]);


function coerce(col, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (IDS.has(col))     return String(v).replace(/\.0+$/, '').trim();
  if (TEXT.has(col))    return String(v).replace(/\.0$/, '').trim();
  if (NUMERIC.has(col)) { const n = Number(v); return isNaN(n) ? null : n; }
  if (BOOLEAN.has(col)) {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === 'y' || s === 'yes' || s === '1';
  }
  return v;
}

/** "12.83, 77.49"  →  { lat: 12.83, lng: 77.49 } */
function splitGeo(str) {
  if (!str) return { lat: null, lng: null };
  const m = String(str).split(',');
  if (m.length < 2) return { lat: null, lng: null };
  const lat = parseFloat(String(m[0]).replace(/[^\d.\-]/g, ''));
  const lng = parseFloat(String(m[1]).replace(/[^\d.\-]/g, ''));
  return { lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng };
}

function joinGeo(lat, lng) {
  if (lat === null || lat === undefined || lat === '' ||
      lng === null || lng === undefined || lng === '') return null;
  return `${lat}, ${lng}`;
}

/** Sheet row  →  app object (adds lat/lng, keeps _raw for anything unmapped). */
function toApp(map, row, { geoCol = null, includeRaw = false } = {}) {
  if (!row) return null;
  const out = {};
  for (const [appKey, sheetCol] of Object.entries(map)) {
    out[appKey] = coerce(sheetCol, row[sheetCol]);
  }
  if (geoCol) {
    const g = splitGeo(row[geoCol]);
    out.lat = g.lat;
    out.lng = g.lng;
    out[geoCol.toLowerCase()] = row[geoCol] ?? null;
  }
  if (includeRaw) out._raw = row;
  return out;
}

/** App object  →  sheet row (only keys actually present are written). */
/**
 * "Yes" / "No" from a form  →  a real boolean for the sheet.
 *
 * The app talks in Yes and No because that is what reads well on a form. The
 * sheet stores real booleans, which Google Sheets renders as TRUE and FALSE.
 * toApp() has always converted on the way IN — coerce() maps true/y/yes/1 to
 * true — but toSheet() passed the value straight through on the way OUT, so a
 * form saving "Yes" wrote the STRING "Yes" into a column holding 1,320 real
 * booleans.
 *
 * You can see it in the data: AMC_Provided holds 1320 False, 222 True, and a
 * single 'No' — that one row is the app's, the rest are AppSheet's.
 *
 * Anything unrecognised is left alone on purpose. Bill_Available and
 * GST_Available are listed as BOOLEAN but really carry three or four options
 * ("No. Have to ask customer to send the bill photo", "Yet to receive from
 * customer", "RR number not available"). Returning undefined for those lets
 * the caller keep the original string rather than flattening a real answer
 * into false.
 */
function toBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '') return null;
  if (s === 'true'  || s === 'yes' || s === 'y' || s === '1') return true;
  if (s === 'false' || s === 'no'  || s === 'n' || s === '0') return false;
  return undefined;                       // not a yes/no — leave as typed
}

function toSheet(map, obj, { geoCol = null } = {}) {
  if (!obj) return {};
  const out = {};
  for (const [appKey, sheetCol] of Object.entries(map)) {
    if (appKey in obj && obj[appKey] !== undefined) {
      const v = obj[appKey];
      if (BOOLEAN.has(sheetCol)) {
        const b = toBool(v);
        out[sheetCol] = b === undefined ? v : b;   // undefined = keep the string
      } else {
        out[sheetCol] = v;
      }
    }
  }
  if (geoCol && ('lat' in obj || 'lng' in obj)) {
    const g = joinGeo(obj.lat, obj.lng);
    if (g !== null) out[geoCol] = g;
  }
  /*  Let callers pass sheet column names straight through, e.g. { Sales_Lead: 'Harsha' }.

      This used to also require an underscore, which quietly dropped every
      single-word column — Referral and Retention among them. The Edit form
      appeared to save and the value never reached the sheet.

      The rule is now "starts with a capital, and is not an app key", which
      covers both spellings. App keys are all lowercase (size_kwp, order_value),
      so there is no ambiguity to resolve.                                    */
    for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (!/^[A-Z]/.test(k)) continue;      // app keys are lowercase
    if (k in map) continue;               // already handled above
    /*  Silently drop a column that no longer exists — see RETIRED above. */
    if (RETIRED.has(k)) continue;
    /*  Same boolean conversion as above. EditProject sends several columns by
        their sheet name — Is_Commissioned among them — so they arrive here
        rather than through the mapped loop.                              */
    if (BOOLEAN.has(k)) {
      const b = toBool(v);
      out[k] = b === undefined ? v : b;
    } else {
      out[k] = v;
    }
  }
  delete out.undefined;
  return out;
}

/** Comma-list of sheet columns for the given app fields — keeps payloads small. */
function fieldsFor(map, appKeys, extra = []) {
  const cols = appKeys.map(k => map[k]).filter(Boolean);
  return [...new Set([...cols, ...extra])].join(',');
}

module.exports = { MAP, toApp, toSheet, fieldsFor, splitGeo, joinGeo, coerce, RETIRED };