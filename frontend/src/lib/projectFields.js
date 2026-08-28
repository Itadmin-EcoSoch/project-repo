/*  frontend/src/lib/projectFields.js  — NEW FILE
    ----------------------------------------------------------------------------
    EVERY field on the AppSheet "Add a Project for the Client" form, in the same
    order, with the same labels, the same options, and the same show/hide rules.

    WHY A SPEC INSTEAD OF JSX
    The old AddProject.jsx hand-coded ~30 fields across 700 lines and had no
    conditional logic at all — answering "Is there GSTIN Number? = Yes" did not
    reveal a GSTIN box, because there was nothing to reveal. Adding the missing
    30 fields by hand would have doubled the file and left EditProject.jsx out of
    step again.

    So the form is described once, here, and rendered by ProjectFormFields.jsx.
    Add a field to this list and it appears on both Add and Edit, is validated,
    and is written to the right sheet column.

    EACH FIELD
      name      key in the form state
      label     shown to the user — copied verbatim from AppSheet
      type      text | textarea | number | currency | percent | select |
                yesno | file | date | latlng | readonly
      sheet     the Google Sheet column it is written to
      options   for select
      required  true, or a function (form) => boolean
      showIf    (form) => boolean — the conditional logic
      help      small grey line under the field
      optionsKey  select's extra values come from the Admin screen too — see
                mergeOptions and pages/AdminDropdowns.jsx

    THE CONDITIONAL RULES, IN PLAIN WORDS
      Customer name on PO ≠ DISCOM bill   → ask for DISCOM Documentation Name
      Billing Name ≠ Quotation Name       → ask for Billing Name
      GSTIN = Yes                         → ask for the GSTIN Number
      Obstacles = Yes                     → ask whose scope the removal is
      Referral = Yes                      → ask referrer name and amount
      System size finalised = No          → ask whether a TSV is required
      Monitoring committed = Yes          → ask the monitoring frequency
      Retention = Yes                     → ask the amount and the period
      Electricity bill available = Yes    → allow the bill photo upload
      AMC provided = Yes                  → ask which type of AMC
--------------------------------------------------------------------------- */

/* ── option lists, copied from the AppSheet dropdowns ─────────────────── */
import { maxLengthFor } from './fieldLimits';
/**
 * Any date the sheet might hold -> 'yyyy-MM-dd', or '' if unreadable.
 *
 * <input type="date"> accepts ONLY 'yyyy-MM-dd'. Anything else is rejected
 * and the box renders EMPTY — no error, no console warning, which is why the
 * edit form looked like the dates had never been saved.
 *
 * Three shapes reach us:
 *   '2026-08-31T00:00:00'  a real Date cell — cell_() in Code.gs formats every
 *                          Date as ISO WITH TIME, so this is the common case
 *   '2026-08-31'           already correct
 *   '31-08-2026'           typed by hand; 176 rows on the Projects tab are
 *                          dd-MM-yyyy text rather than dates
 *
 * dd-MM IS CHECKED BEFORE LETTING JAVASCRIPT PARSE THE STRING. new Date(
 * '03-07-2026') reads as 7 March in the US order, which would silently move a
 * commissioning date by four months. Same reasoning as scDate_ in SolarCare.gs.
 */
export function toDateInput(v) {
  if (v === null || v === undefined || v === '') return '';

  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  }

  const s = String(v).trim();
  if (!s) return '';

  /* ISO, with or without a time part — the overwhelmingly common case */
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  /* 31-08-2026, 31/08/2026, 31.08.2026 — day first, as typed here */
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
    if (+mo > 12 || +d > 31) return '';
    return `${m[3]}-${mo}-${d}`;
  }

  /* last resort — 'Aug 31, 2026' and friends */
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Any truthy/falsy the sheet might hold  ->  'Yes' | 'No' | ''.
 *
 * AMC_Provided, Payments_Done, Subsidy, Retention, Referral and
 * Is_Commissioned are REAL BOOLEANS in the sheet — Google renders them as TRUE
 * and FALSE. The YesNo toggle in ProjectFormFields.jsx compares
 *
 *     String(value).trim().toLowerCase() === 'yes'
 *
 * and String(true) is "true", so a project with AMC_Provided = TRUE showed
 * NEITHER button selected. Same failure as the dates: the value was right, the
 * shape was not.
 *
 * Returns '' for anything that is not a clean yes/no on purpose.
 * Bill_Available and GST_Available also carry "Yet to receive from customer"
 * and "No. Have to ask customer to send the bill photo" — those are select
 * fields, not toggles, and must pass through untouched.
 */
export function toYesNo(v) {
  if (v === true)  return 'Yes';
  if (v === false) return 'No';
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'yes' || s === 'y' || s === 'true'  || s === '1') return 'Yes';
  if (s === 'no'  || s === 'n' || s === 'false' || s === '0') return 'No';
  return '';
}
export const YES_NO = ['Yes', 'No'];

/*  'Ad-hoc Maintenance' is on 13 live projects (426867, 447960, 406409 …) but
    was missing from this list. A select whose stored value is not in its own
    options renders BLANK, so opening one of those projects and pressing Save
    wrote an empty Project_Type — silently destroying the classification. The
    field also carries optionsKey now (see mergeOptions), so any type an admin
    adds later, or one already sitting in the sheet, is displayed and
    preserved rather than blanked.                                          */
export const PROJECT_TYPES = [
  'EPC', 'I&C', 'AMC', 'Consultancy', 'Retail', 'Ad-hoc Maintenance',
];

/*  The real values from the Dropdowns tab, confirmed against the live API.

    Note the THREE Defaulted variants — they are distinct statuses, not
    spellings of one. This list previously had a single bare 'Defaulted',
    and the backend collapsed all three onto "Defaulted - Project Payment",
    so choosing the AMC or Ticket variant silently wrote the wrong one.

    On the Edit screen these are replaced per-project by status_options from
    the API. This list is the fallback for the Add form, where the project
    does not exist yet and only "Active" is valid anyway.                   */
export const PROJECT_STATUSES = [
  'Active', 'Under SolarCare', 'Out of SolarCare', 'Completed', 'On Hold', 'Cancelled',
  'Defaulted - Project Payment', 'Defaulted - Ticket Payment', 'Defaulted - AMC Payment',
];

export const BILL_AVAILABLE = [
  'Yes',
  'No. Have to ask customer to send the bill photo',
  'Not applicable',
];

/*  These two mirror what is ALREADY in the sheet. GST_Available was offered as
    a plain Yes/No, but 52 rows read "Yet to receive from customer" — a real
    answer the form could not express, so anyone in that position had to pick
    a wrong one.                                                            */
export const GST_AVAILABLE = [
  'Yes',
  'No',
  'Yet to receive from customer',
];

export const PO_AVAILABLE = [
  'Yes',
  'No, yet to receive',
];
export const REGIONS = [
  'Bangalore', 'Rest of Karnataka', 'Telangana', 'TamilNadu',
  'Kerala', 'Andhra Pradesh', 'Maharashtra', 'Rest of India',
];

export const SALES_LEADS = [
  'John', 'Joseph', 'Harsha', 'Govindaraju JS', 'Gautam',
  'Mahantayya', 'Hariom', 'Gaur', 'SolarCare',
];

export const BUILDING_TYPES = [
  'Residence or Villa', 'Villa Community - Common Area', 'Apartments',
  'Commercial', 'Industrial', 'School', 'Hospital', 'College', 'Farm',
  'Hotel', 'Resort', 'Place of Worship', 'Other',
];

export const BUSINESS_MODELS = ['CAPEX', 'CAPEX with Loan', 'OPEX'];

export const INVERTER_BRANDS = [
  'Enphase', 'SolarEdge', 'Deye', 'Feston', 'Studer', 'Luminous', 'Sukam',
  'Unipar', 'ABB', 'Fronius', 'Sungrow', 'Havells', 'MicroTek', 'MRO-TEK',
  'Power-One', 'GoodWe', 'Grundfos', 'Shakti',
];

export const INVERTER_TYPES = [
  'Microinverter (IQ Series)', 'String', 'Optimizer', 'Hybrid',
  'Power Conditioning Unit (PCU)', 'Variable Frequency Drive (VFD)',
  'Off Grid', 'UPS',
];

export const PROPOSAL_MODELS = ['Essential', 'Premium', 'NA (only for C&I projects)'];

export const MODULE_BRANDS = [
  'Waaree', 'Adani', 'Premier', 'Vikram Solar', 'Novasys',
  'Sunpower', 'NA', 'Axitec', 'Trina',
];

export const ROOF_MATERIALS = ['RCC', 'Corrugated Sheet', 'GI', 'MS Rafter'];
export const STRUCTURE_TYPES = [
  'Flat', 'Sloped', 'Elevated (HDGI) - Penetrative', 'SolrFit - Non-penetrative',
  'Elevated (MS)', 'Tiled', 'Special Structures (talk to Salesperson for details)', 'BIPV',
];
export const SECTORS        = ['Residential', 'Commercial', 'Industrial', 'Institutional', 'Government', 'Agricultural'];
export const SYSTEM_TYPES   = ['Rooftop Solar', 'Solar DC Pump', 'Solar AC Pump', 'EV Charging'];
export const SYSTEM_CATEGORIES = ['Grid-Tied', 'Off Grid', 'Hybrid', 'Grid-Supported'];
/*  "None" removed on purpose. Reaching this field already means "Is there a
    separate AMC provided?" was answered Yes, or the project type is AMC — in
    both cases an AMC exists, so "None" was a contradiction the form allowed
    the user to choose. Say No to the question above instead.              */
export const AMC_TYPES      = ['Inspection', 'Cleaning', 'Inspection, Cleaning'];
/*  Visits per year, the six AppSheet offers. 12/yr is monthly, 4/yr quarterly.
    The schedule engine spaces them 12 ÷ frequency months apart.            */
export const AMC_VISITS_PER_YEAR = [24, 12, 6, 4, 2, 1];

export const MONITORING_FREQ = ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'];

/* ── helpers used by showIf ──────────────────────────────────────────── */

/*  The sheet holds Yes/No inconsistently — "Y", "Yes", "YES", true. Treating
    only the exact string 'Yes' as true would hide fields on rows that came from
    AppSheet, so the check is deliberately loose.                           */
const isYes = v => /^(y|yes|true|1)$/i.test(String(v ?? '').trim());
const isNo  = v => /^(n|no|false|0)$/i.test(String(v ?? '').trim());

export { isYes, isNo };

/*  Should the Site Location boxes be on screen?

    On a NEW project they stay hidden until the billing-address question is
    answered, so the form asks one thing at a time instead of presenting three
    empty boxes the user may not need to touch.

    The trailing checks are not optional. toProjectPayload() blanks any field
    that is hidden at save time:

        let v = visible ? form[f.name] : '';

    EditProject renders this same field list, and an existing project has no
    stored answer to the question — so without "or one of them already has a
    value", opening an old project and pressing Save would WIPE Site_Address,
    GMap_Link and Project_Region. They are shown whenever there is something
    to protect.                                                             */
/*  Projects.Payments_Done SHOW_IF — see the field definition below.
    Exact status match, and never for an AMC-type project.               */
const paymentsDoneVisible = f => {
  const st = String(f?.status ?? '').trim();
  const ty = String(f?.projType ?? '').trim();
  return (st === 'Under SolarCare' || st === 'Defaulted - Project Payment')
      && ty.toUpperCase() !== 'AMC';
};

/** Yes = the three boxes below are a copy of the client record, not typed. */
export const billingCopied = f => isYes(f?.billingSameAsSite);

const siteLocationOpen = f =>
  isYes(f.billingSameAsSite) || isNo(f.billingSameAsSite) ||
  Boolean(String(f.siteAddress   ?? '').trim()) ||
  Boolean(String(f.gmap          ?? '').trim()) ||
  Boolean(String(f.projectRegion ?? '').trim());

/*  Which AMC blocks to show. Matched loosely so "Inspection, Cleaning",
    "Both" and the AppSheet spellings all resolve.                          */
/*  A project whose TYPE is AMC always has an AMC — that is what it is. So the
    Solar Care block opens as soon as Type of Project is set to AMC, without
    waiting for the separate Yes/No, and that question is forced to Yes and
    locked (see forceValue / lockedTo on amcProvided below).               */
export const isAmcProject = f => String(f?.projType ?? '').trim().toUpperCase() === 'AMC';
const amcOn = form => isYes(form.amcProvided) || isAmcProject(form);

const amcWants = (form, word) =>
  amcOn(form) && new RegExp(word, 'i').test(String(form.amcType || ''));

export const wantsInspection = f => amcWants(f, 'insp')  || (amcOn(f) && /both/i.test(String(f.amcType || '')));
export const wantsCleaning   = f => amcWants(f, 'clean') || (amcOn(f) && /both/i.test(String(f.amcType || '')));
export const amcIsOn = amcOn;

/* ── AMC end-date preview ────────────────────────────────────────────────
   The backend (backend/lib/amcSchedule.js -> amcEndDate) always DERIVES the
   contract's end date itself, from start date + visits/year + years — it
   never accepts one typed in. So rather than let the user type a date that
   the server would silently overrule, this ports that exact same formula to
   the frontend and shows it as a live, read-only preview. What you see here
   is what gets written when the contract is actually created on save.

   If backend/lib/amcSchedule.js's amcEndDate() ever changes, mirror the
   change here too — the two are not wired together, just kept in step.   */
const amcNum = v => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const amcParseDate = v => {
  if (!v) return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);          // <input type="date"> value
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const amcAddMonths = (date, months) => {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
};

const amcEomonth = (date, months) => {
  const d = amcAddMonths(date, months);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
};

const amcAddDays = (date, days) => new Date(date.getTime() + days * 86400000);
const amcToISO   = d => (d ? d.toISOString().slice(0, 10) : '');

/** Date of the last scheduled visit \u2014 identical formula to the backend. */
function amcEndDatePreview(startVal, frequencyVal, yearsVal) {
  const start = amcParseDate(startVal);
  const F = amcNum(frequencyVal), P = amcNum(yearsVal);
  if (!start || !F || !P) return '';
  const monthOffset = Math.floor((F - 1) * (12 / F)) - 1 + 12 * (P - 1);
  let d = amcAddDays(amcEomonth(start, monthOffset), start.getUTCDate());
  if (F === 24) d = amcAddDays(d, 14);
  return amcToISO(d);
}

/*  Same calendar day, N years later \u2014 identical formula to SolarCare.gs's
    scAddYears_, so what this form shows is exactly what the nightly SolarCare
    job will compare "today" against once the project is saved:

        2024-08-19 + 2 years -> 2026-08-19, covered through that whole day.
        29 Feb + 1 year clamps to 28 Feb rather than rolling into March.

    Used for Warranty End Date \u2014 kept as a real, saved field
    (not a preview like the AMC one above) because SolarCare.gs reads
    Warranty_End_Date straight off the sheet; if this were never written, the
    nightly job would fall back to its own fixed default period instead of
    honouring whatever number of years THIS project actually has.           */
function addYearsSameDay(startVal, yearsVal) {
  const start = amcParseDate(startVal);
  const years = amcNum(yearsVal);
  if (!start || !years) return '';
  const y = start.getUTCFullYear() + years, mo = start.getUTCMonth(), da = start.getUTCDate();
  let d = new Date(Date.UTC(y, mo, da));
  if (d.getUTCMonth() !== mo) d = new Date(Date.UTC(y, mo + 1, 0));   // 29 Feb -> 28 Feb
  return amcToISO(d);
}

/* ── the form ────────────────────────────────────────────────────────── */

/** EPC and I&C are the ones we installed, so only they carry warranty. */
export const isInstalledByUs = f =>
  ['EPC', 'I&C'].includes(String(f?.projType ?? '').trim().toUpperCase());

/* ── warranty wording follows the project type ─────────────────────────
    ONE set of columns (Warranty_Start_Date / Warranty_End_Date /
    Warranty_Period / Warranty_Status), labelled for what it actually is on
    this project:

        EPC or I&C  ->  "Warranty ..."   we installed it
        AMC         ->  "AMC Warranty ..."           outside customer
        anything else -> "Warranty ..."

    This is why there is no second set of Warranty_* boxes any more. The
    period field already takes any number of years, so a separate pair of
    dates only created two places to record one fact.                      */

const projTypeOf = f => String(f?.projType ?? '').trim().toUpperCase();

/*  Only EPC and I&C carry a warranty from us — we installed those. An AMC
    customer's cover lives in AMC_Contracts (Cleaning / Inspection, each with
    its own dates), and Consultancy, Retail and Ad-hoc Maintenance have no
    ongoing cover at all. So the whole section is hidden for them rather than
    offering boxes that should never be filled.                             */
export const isWarrantyProject = f => {
  const t = projTypeOf(f);
  return t === 'EPC' || t === 'I&C';
};

/*  WHEN DO THE WARRANTY/COMMISSIONING FIELDS SHOW, AND WHEN ARE THEY REQUIRED?

    isWarrantyProject already narrows this whole section to EPC/I&C — AMC
    and everything else never reach it at all, and get their own dates inside
    the AMC (Solar Care) section instead (Inspection/Cleaning start dates,
    already required there via wantsInspection/wantsCleaning).

    Within EPC/I&C, a new gate question decides whether the actual dates show:

        isCommissioned = No (locked here on a new, not-yet-saved project —
        see lockedTo/forceValue on the field itself)
            Nothing else in this card is visible yet. There is nothing to
            fill in for a system that has not gone live. Once the project
            has been saved once, this unlocks and can be changed to Yes.

        isCommissioned = Yes
            Commissioned Date, Warranty Period, Warranty Start/End Date and
            Warranty Status all appear — and all become mandatory, because
            you would not answer Yes without already knowing them.         */
export const warrantyFieldsVisible = f =>
  !isNewProject(f) && isWarrantyProject(f) && isYes(f.isCommissioned);
export const warrantyFieldsRequired = warrantyFieldsVisible;

/*  Add form or Edit form?

    `isNew` is a hidden, transient field defaulted to 'yes'. emptyProjectForm()
    applies that default, so the Add screen carries it; EditProject rebuilds
    the form from the sheet row, where a transient field has no column and so
    comes back blank. No page needs to pass a flag for this to work.        */
export const isNewProject = f => String(f?.isNew ?? '') === 'yes';

/*  Is this an External (AMC) client?

    Type of Client is answered on the Add Client screen — Internal (EPC, I&C)
    or External (AMC) — and it already decides what kind of work this is.
    Asking "Type of Project" again on the very next screen, with all six
    options open, invites a contradiction: an External client with an EPC
    project is not a thing, and nothing downstream would catch it.

    `clientType` is a hidden transient field. AddProject seeds it from the
    client record; EditProject leaves it blank, because on an existing project
    the saved Project_Type is the truth and must stay editable.            */
export const isExternalClient = f => String(f?.clientType ?? '').trim().toLowerCase() === 'external';

/*  Merges a field's static base list with whatever an Admin has added through
    the Admin screen (frontend/src/pages/AdminDropdowns.jsx), for fields
    marked with optionsKey below.

        base          the hardcoded list in this file (e.g. PROJECT_TYPES)
        extra         active values for this optionsKey, from the API
        currentValue  the value this specific form already holds

    currentValue is always kept even if it matches neither list. That is what
    used to be keepCustom's job — a value saved before this system existed, or
    one an admin later removed from the list, still shows up on THIS project
    rather than silently blanking the field the next time it's opened.       */
export function mergeOptions(base = [], extra = [], currentValue = '') {
  /*  The sheet (Dropdown_Options, passed in as `extra`) is the source of truth
      once a field has been seeded there — that is what lets Admins add AND
      delete built-in values from Manage Dropdown Lists. The hardcoded `base`
      is only a fallback for a field not yet present in the sheet, so a form
      never shows an empty dropdown before the one-time seed runs.          */
  const sheet  = (extra || []).map(v => String(v ?? '').trim()).filter(Boolean);
  const source = sheet.length ? sheet : (base || []);

  const seen = new Set();
  const merged = [];
  source.forEach(v => {
    const sv = String(v ?? '').trim();
    if (!sv) return;
    const key = sv.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(sv);
  });

  const cur = String(currentValue ?? '').trim();
  if (cur && !seen.has(cur.toLowerCase())) merged.push(cur);

  return merged;
}

export const PROJECT_SECTIONS = [
  {
    id: 'basics',
    title: 'Project Basics',
    icon: '📋',
    fields: [
      /*  Not a field. A hidden marker so a spec rule can tell the Add form
          from the Edit form — see isNewProject above.                     */
      { name: 'isNew', label: '', type: 'text', transient: true,
        default: 'yes', showIf: () => false },

      /*  Hidden marker carrying Clients.Client_Type onto the project form.
          Seeded by AddProject from the client being added to. See
          isExternalClient above and the projType rule below.             */
      { name: 'clientType', label: '', type: 'text', transient: true,
        default: '', showIf: () => false },

      { name: 'projectName', label: 'Project Name', type: 'readonly', sheet: 'Project_Name',
        help: 'Built automatically from client, tags, size and inverter type.' },

      { name: 'dealId', label: 'Deal ID from Zoho', type: 'text', sheet: 'Deal_ID',
  required: true,
  /*  A pasted Zoho CRM link, not an id — the real ones run to about 115
      characters:
      …/crm/org653257787/tab/Potentials/2773741000102618020?pfrom=gsearch
      300 leaves room for a longer org or record id without another round
      of this. maxLengthFor() in lib/fieldLimits.js honours this over the
      100-character default.                                             */
  maxLength: 300 },

      { name: 'area', label: 'Add Project Tags (like Site Location, Villa community name, Subsidy, etc)',
        type: 'text', sheet: 'Site_Area', required: true,
        help: 'These tags become part of the project name.' },

      { name: 'size', label: 'Project Size (in kWp)', type: 'number', sheet: 'Project_Size',
        required: true, step: '0.001', suffix: 'kWp', max: 50000 },

      /*  AMC ONLY FOR AN EXTERNAL CLIENT.

          The Add Client screen already asked Internal (EPC, I&C) vs External
          (AMC). For External the answer here is decided, so the list collapses
          to the single valid option rather than offering five that would
          contradict what was just chosen. AddProject also pre-selects it, so
          in practice this field is answered before it is ever seen.

          Internal keeps the full list: EPC and I&C are both Internal, and
          Consultancy / Retail / Ad-hoc are genuinely open choices.

          On the EDIT form clientType is blank, so the full list comes back —
          an existing project's saved type must stay editable.           */
      { name: 'projType', label: 'Type of Project:', type: 'select', sheet: 'Project_Type',
        options: f => (isExternalClient(f) ? ['AMC'] : PROJECT_TYPES), required: true,
        /*  "+ Add a project type not on the list" is gone. It changed what
            every downstream rule in this file keys off (isAmcProject,
            isWarrantyProject, warrantyFieldsVisible, the AMC block, …), so
            a mistyped or made-up type here had knock-on effects across the
            whole form, and it was never governed — anyone could type
            anything. New types are now added once, centrally, from the Admin
            screen (pages/AdminDropdowns.jsx) and appear here for everyone
            via optionsKey — see mergeOptions above and ProjectFormFields.jsx. */
        optionsKey: 'Project_Type' },

      { name: 'orderVal', label: 'Order Value (without GST)', type: 'currency', sheet: 'Order_Value',
        required: true, max: 10000000000 },

      { name: 'margin', label: 'EcoSoch Margin%', type: 'percent', sheet: 'Margin', required: true, max: 100 },

      /*  Options are computed per project by the backend and passed into
          ProjectFormFields as statusOptions — see the Valid_If port in
          backend/lib/status.js. PROJECT_STATUSES is only the fallback for the
          Add form, where the project does not exist yet.

          The label mirrors AppSheet's Display name expression
              "Current Status of the "&[Project_Type]&" Project:"
          so an EPC project reads "Current Status of the EPC Project:".     */
      /*  default 'Active' — clause 1 allows nothing else on a new project, and
          a required select with one option should arrive already answered
          rather than making the user pick the only choice available.      */
      { name: 'status', type: 'select', sheet: 'Project_Status', default: 'Active',
        label: form => {
          /*  form.projType — NOT projectType. The field is declared as
              { name: 'projType', sheet: 'Project_Type' }, so the wrong key
              read undefined and every project fell back to the generic
              label instead of "Current Status of the EPC Project:".      */
          const t = String(form?.projType || '').trim();
          return t ? `Current Status of the ${t} Project:` : 'Current Status of the Project:';
        },
        options: PROJECT_STATUSES, required: true, dynamicOptions: 'status' },

      /*  Projects.Payments_Done — ported from the AppSheet column.

          SHOW_IF   and(in([Project_Status], LIST("Under SolarCare",
                            "Defaulted - Project Payment")),
                        [Project_Type] <> "AMC")

          VALID_IF  Under SolarCare              -> Yes or No
                    Defaulted - Project Payment  -> No only
                    otherwise                    -> once Yes, stays Yes

          The label is AppSheet's Display name expression verbatim.

          The status test is EXACT, not a "Defaulted" prefix. Ticket-payment
          and AMC-payment defaults must not force this to No — only a project
          -payment default does. See backend/lib/paymentsDone.js.          */
      /*  whenHidden: 'No' — see toProjectPayload.

          Payments_Done is a real checkbox column (957 TRUE, 47 FALSE). The
          question only shows for two statuses, and a hidden field is sent as
          '' — so every project created at status Active left the cell BLANK,
          which is neither true nor false and breaks the payment rules that
          read it. Not-yet-asked means not-yet-paid, so No is the honest
          value and keeps the column boolean the whole way down.          */
      { name: 'paymentsDone', type: 'yesno', sheet: 'Payments_Done',
        label: 'Has client cleared the required project payments?',
        showIf  : paymentsDoneVisible,
        required: paymentsDoneVisible,
        whenHidden: 'No',
        lockedTo: form => {
          const st = String(form?.status || '').trim();
          if (st === 'Defaulted - Project Payment') return 'No';
          if (isYes(form?.paymentsDone)) return 'Yes';
          return null;
        },
        help: form => String(form?.status || '').trim() === 'Defaulted - Project Payment'
          ? 'Locked to No — the project is flagged as defaulting on its payment.'
          : (isYes(form?.paymentsDone)
              ? 'Already cleared. This cannot be set back to No here.'
              : undefined),
      },
    ],
  },

  {
    id: 'billing',
    title: 'Billing & Documentation',
    icon: '🧾',
    fields: [
      { name: 'billAvailable', label: 'Electricity Bill Available?', type: 'select',
        sheet: 'Bill_Available', options: BILL_AVAILABLE, required: true,
        optionsKey: 'Bill_Available' },

      { name: 'billFile', label: 'Attach Electricity Bill Photo:', type: 'file', sheet: 'Bill_File',
        required: f => isYes(f.billAvailable), showIf: f => isYes(f.billAvailable) },

      { name: 'quotationName', label: 'Quotation Name:', type: 'text',
        sheet: 'Quotation_Name', required: true },

      { name: 'poBillSame', label: 'Is the Customer name on PO and name on DISCOM bill same?',
        type: 'yesno', sheet: 'PO_Bill_Name_Same', required: true },

      { name: 'discomName', label: 'DISCOM Documentation Name', type: 'text', sheet: 'DISCOM_Name',
        required: f => isNo(f.poBillSame), showIf: f => isNo(f.poBillSame) },

      { name: 'billingSame', label: 'Is the Billing Name same as Quotation Name?',
        type: 'yesno', sheet: 'Billing_Quotation_Same', required: true },

      { name: 'billingName', label: 'Billing Name:', type: 'text', sheet: 'Billing_Name',
        required: f => isNo(f.billingSame), showIf: f => isNo(f.billingSame) },

      { name: 'gstAvailable', label: 'Is there GSTIN Number?', type: 'select',
        sheet: 'GST_Available', options: GST_AVAILABLE, required: true,
        optionsKey: 'GST_Available' },

      /*  A GSTIN is exactly 15 characters — 2 state digits, a 10-character
          PAN, an entity digit, a literal Z, and a checksum. maxLength stops
          the box accepting a 39-character run of keyboard mashing; the
          pattern check in validateProject catches a paste that outran it.  */
      { name: 'gstNumber', label: 'GSTIN Number:', type: 'text', sheet: 'GST_Number',
        required: f => isYes(f.gstAvailable), showIf: f => isYes(f.gstAvailable),
        maxLength: 15,
        help: '15 characters, e.g. 29ABCDE1234F1Z5' },

      /*  PO_Available had NO FIELD AT ALL. The form collected the PO file and
          nothing ever wrote the column, so it stayed blank on every project
          the app created while 813 older rows read "Yes".

          Modelled on billAvailable / billFile directly above: the question
          first, the attachment only when the answer is Yes. A PO that has not
          arrived yet is a real state and now has somewhere to live.       */
      { name: 'poAvailable', label: 'Purchase Order Available?', type: 'select',
        sheet: 'PO_Available', options: PO_AVAILABLE, required: true,
        optionsKey: 'PO_Available' },

      { name: 'poFile', label: "Attach Purchase Order (with client's signature):", type: 'file',
        sheet: 'PO_File',
        required: f => isYes(f.poAvailable), showIf: f => isYes(f.poAvailable) },
    ],
  },

  {
    id: 'site',
    title: 'Site Location',
    icon: '📍',
    fields: [
      /*  Most rooftop jobs are at the address the client is billed at, and
          retyping it is both slow and a source of mismatches between the two
          tabs. Answer Yes and the billing address captured on the client form
          is copied into the box below; answer No and it is entered by hand.

          transient: true — this is a data-entry convenience, not a column.
          It never reaches the Projects tab. The ANSWER is disposable; the
          address it produces is what gets saved.                            */
      { name: 'billingSameAsSite', type: 'yesno', transient: true,
        /*  Required only while the address box is still empty. EditProject
            renders this same field list, and existing projects have no stored
            answer — an unconditional `required: true` would make every edit
            unsaveable. Once the address is filled, by either route, the
            question has served its purpose and stops blocking.              */
        required: form => !String(form.siteAddress || '').trim(),
        label: "Is the client's billing address is same as the site's postal address?",
        help: 'Yes copies the address, coordinates and region from the client record. '
            + 'No opens the boxes for you to fill in by hand.' },

      /*  Answering Yes copies the client's billing address, coordinates and
          region into these three. Typing over a copy is how the two tabs
          drift apart, so while Yes is selected they are shown but not
          editable — switch to No to enter a different address by hand.    */
      { name: 'siteAddress', label: 'Postal address of site:', type: 'textarea',
        sheet: 'Site_Address', required: true, showIf: siteLocationOpen,
        readOnlyIf: billingCopied, readOnlyNote: 'Copied from the client record' },

      { name: 'gmap', label: 'Latitude, Longitude', type: 'latlng', sheet: 'GMap_Link',
        required: true, showIf: siteLocationOpen,
        readOnlyIf: billingCopied, readOnlyNote: 'Copied from the client record',
        help: f => (billingCopied(f)
          ? undefined
          : 'In Google Maps, long-press the spot → copy the numbers → paste here.') },

      /*  The eight built-in regions cover most sites, but one in a town that
          is not listed must still be recordable. That now happens through
          the Admin screen rather than a free-type box on this form.        */
      { name: 'projectRegion', label: 'Project Region', type: 'select', sheet: 'Project_Region',
        options: REGIONS, required: true, optionsKey: 'Project_Region',
        showIf: siteLocationOpen,
        readOnlyIf: billingCopied, readOnlyNote: 'Copied from the client record' },
    ],
  },

  {
    id: 'scope',
    title: 'Scope & Commitments',
    icon: '📝',
    fields: [
      /*  Not required in AppSheet — the only field on the whole form without a
          red asterisk, so it is left optional here too.                     */
      { name: 'projectComments', label: 'Site and Project description (Customer details, Site details, Schedule, etc.):',
        type: 'textarea', sheet: 'Project_Comments' },

      { name: 'projectDescription', label: 'Points specific to this Project',
        type: 'textarea', sheet: 'Project_Description', required: true },

      { name: 'commitment', label: 'What have you committed to the client as a salesperson?',
        type: 'textarea', sheet: 'Client_Committment', required: true },

      { name: 'obstacles', label: 'Are there any obstacles to be removed before installation?',
        type: 'yesno', sheet: 'Obstacle_Removal', required: true },

      { name: 'obstacleScope', label: 'Is the removal of the obstacle in Client or EcoSoch scope? Provide exact details.',
        type: 'textarea', sheet: 'Obstacle_Scope',
        required: f => isYes(f.obstacles), showIf: f => isYes(f.obstacles) },

      { name: 'elevatedDrawings', label: 'Is Elevated structure detailed drawings required?',
        type: 'yesno', sheet: 'Elevated_drawings', required: true },
    ],
  },

  {
    id: 'commercial',
    title: 'Referral, Subsidy & Retention',
    icon: '💰',
    fields: [
      { name: 'referral', label: 'Is this a referral project?', type: 'yesno',
        sheet: 'Referral', required: true },

      /*  whenHidden — what to store when the gate above these is answered No.

          A hidden field is sent as '' by toProjectPayload, which left these
          cells BLANK. The sheet's own convention across 376 legacy rows is
          'NA' for the text ones and 0 for the amounts, never blank, and the
          reports that read these columns count on it.                     */
      { name: 'referrerName', label: 'Name of Referrer', type: 'text', sheet: 'Referrer_Name',
        required: f => isYes(f.referral), showIf: f => isYes(f.referral),
        whenHidden: 'NA' },

      { name: 'referralAmount', label: 'Referral Amount', type: 'currency', sheet: 'Referral_Amount',
        required: f => isYes(f.referral), showIf: f => isYes(f.referral),
        whenHidden: 0, max: 1000000 },

      { name: 'bescom', label: 'Can we apply for DISCOM before TSV?', type: 'yesno',
        sheet: 'BESCOM', required: true },

      { name: 'capacityFinalised', label: 'Is the system size finalised?', type: 'yesno',
        sheet: 'Capacity_Finalised', required: true },

      /*  The one rule that fires on No rather than Yes: if the size is NOT
          finalised, we need to know whether a site visit will settle it.

          whenHidden: 'No' -> FALSE. Hidden means the size IS finalised, so
          no site visit is needed to finalise it — a real answer, not an
          absence of one. Legacy rows leave this blank when the question did
          not apply; FALSE says the same thing and keeps the column boolean
          the whole way down.                                              */
      { name: 'tsvRequired', label: 'Is then a TSV required to finalise the system size?',
        type: 'yesno', sheet: 'TSV_Required',
        required: f => isNo(f.capacityFinalised), showIf: f => isNo(f.capacityFinalised),
        whenHidden: 'No' },

      { name: 'subsidy', label: 'Is this a subsidy project?', type: 'yesno',
        sheet: 'Subsidy', required: true },

      { name: 'monitoring', label: 'Is generation monitoring committed to the client?',
        type: 'yesno', sheet: 'Monitoring', required: true },

      { name: 'monitoringFreq', label: 'What is the monitoring frequency?', type: 'select',
        sheet: 'Monitoring_Frequency', options: MONITORING_FREQ, optionsKey: 'Monitoring_Frequency',
        required: f => isYes(f.monitoring), showIf: f => isYes(f.monitoring),
        whenHidden: 'NA' },

      { name: 'retention', label: 'Is there any retention amount for this project?',
        type: 'yesno', sheet: 'Retention', required: true },

      { name: 'retentionAmount', label: 'What is the Retention Amount?', type: 'currency',
        sheet: 'Retention_Amount',
        required: f => isYes(f.retention), showIf: f => isYes(f.retention),
        whenHidden: 0, max: 1000000 },

      { name: 'retentionPeriod', label: 'What is the Retention period (in months, years)?',
        type: 'text', sheet: 'Retention_Period',
        required: f => isYes(f.retention), showIf: f => isYes(f.retention),
        whenHidden: 'NA' },
    ],
  },

  {
    id: 'ownership',
    title: 'Sales Ownership',
    icon: '👤',
    fields: [
      { name: 'salesLead', label: 'Sales_Lead', type: 'select', sheet: 'Sales_Lead',
        options: SALES_LEADS, required: true, optionsKey: 'Sales_Lead' },

      { name: 'spEmail', label: 'Salesperson_Email', type: 'text', sheet: 'Salesperson_Email',
        required: true, inputType: 'email', placeholder: 'name@ecosoch.com' },
    ],
  },

  {
    id: 'system',
    title: 'System Specification',
    icon: '⚙️',
    fields: [
      { name: 'buildingType', label: 'Building_Type', type: 'select', sheet: 'Building_Type',
        options: BUILDING_TYPES, required: true, optionsKey: 'Building_Type' },

      { name: 'businessModel', label: 'Business_Model', type: 'select', sheet: 'Business_Model',
        options: BUSINESS_MODELS, required: true, optionsKey: 'Business_Model' },

/*  optionsKey on the equipment and structure dropdowns.

    The list covers what EcoSoch normally fits, but a one-off brand or an
    unusual roof must still be recordable rather than forced into the
    nearest wrong option. That value is now added once, centrally, from the
    Admin screen (pages/AdminDropdowns.jsx) rather than typed inline here —
    see mergeOptions above for how the two lists combine, and how a value
    already saved on a project is never silently dropped even if it later
    disappears from the managed list.                                      */
      { name: 'inverterBrand', label: 'Inverter_Brand', type: 'select', sheet: 'Inverter_Brand',
        options: INVERTER_BRANDS, required: true, optionsKey: 'Inverter_Brand' },

      { name: 'inverterType', label: 'Inverter_Type', type: 'select', sheet: 'Inverter_Type',
        options: INVERTER_TYPES, required: true, optionsKey: 'Inverter_Type' },

      { name: 'proposalModel', label: 'Proposal Model', type: 'select', sheet: 'Proposal_Model',
        options: PROPOSAL_MODELS, required: true, optionsKey: 'Proposal_Model' },

      { name: 'moduleBrand', label: 'Module_Brand', type: 'select', sheet: 'Module_Brand',
        options: MODULE_BRANDS, required: true, optionsKey: 'Module_Brand' },

      { name: 'moduleWattage', label: 'Module Wattage (Wp)', type: 'number',
        sheet: 'Module_Wattage', required: true, suffix: 'Wp', max: 5000 },

      { name: 'moduleNo', label: 'No.of Modules', type: 'number', sheet: 'Module_No', required: true, max: 10000 },

      { name: 'roofMaterial', label: 'Roof Material', type: 'select', sheet: 'Roof_Material',
        options: ROOF_MATERIALS, required: true, optionsKey: 'Roof_Material' },

      { name: 'structureType', label: 'Type of Structure', type: 'select', sheet: 'Roof_Type',
        options: STRUCTURE_TYPES, required: true, optionsKey: 'Roof_Type' },

      { name: 'sector', label: 'Project Sector', type: 'select', sheet: 'Project_Sector',
        options: SECTORS, optionsKey: 'Project_Sector' },

      { name: 'systemType', label: 'System Type', type: 'select', sheet: 'System_Type',
        options: SYSTEM_TYPES, required: true, optionsKey: 'System_Type' },

      { name: 'systemCategory', label: 'System Category', type: 'select', sheet: 'System_Category',
        options: SYSTEM_CATEGORIES, required: true, optionsKey: 'System_Category' },
    ],
  },

  {
    id: 'amc',
    title: 'AMC (Solar Care)',
    icon: '🔧',
    fields: [
      /*  The rule, verbatim:
              IF Type of project = AMC  ->  AMC_Provided = Yes
              ELSE                      ->  AMC_Provided = List(Yes, No)

          Radio buttons rather than a dropdown, and on an AMC project the No
          button is disabled rather than removed.                          */
      { name: 'amcProvided', label: 'Is there a separate AMC provided?', type: 'radio',
        options: ['Yes', 'No'],
        sheet: 'AMC_Provided', required: true,
        /*  An AMC-type project cannot answer No to this, so it is set to Yes
            and the No button is disabled rather than hidden — a lone button
            leaves people wondering where the other went.                  */
        forceValue: f => (isAmcProject(f) ? 'Yes' : null),
        lockedTo  : f => (isAmcProject(f) ? 'Yes' : null),
        help: f => (isAmcProject(f)
          ? 'Set to Yes automatically — this is an AMC project.'
          : undefined) },

      /*  RADIO, not a dropdown. Three options that decide which terms appear
          below deserve to be visible at once rather than hidden behind a
          click, and it matches the AppSheet form.                        */
      { name: 'amcType', label: 'Type of AMC Contract', type: 'radio', sheet: 'AMC_Type',
        options: AMC_TYPES,
        required: amcIsOn, showIf: amcIsOn,
        help: 'Choosing a type asks for its terms below, and the visit schedule is generated on save.' },

      /*  ── AMC terms ───────────────────────────────────────────────────────
          These are NOT columns on the Projects tab — they belong to
          AMC_Contracts. transient:true keeps them out of the project payload,
          so they never create stray columns in the sheet. AddProject reads
          them separately and calls /api/amc-setup/create after the project is
          saved, which is what generates the contracts and every visit row.

          "Inspection, Cleaning" shows both sets, one row each, so a client can
          take quarterly inspections alongside monthly cleaning.            */

      /*  Four across on a wide screen: visits, years, start date, document.
          They are one decision, so reading them needs one glance rather than
          a scroll.                                                        */
      { name: 'inspVisits', label: 'How many Inspection visits every year?',
        type: 'select', options: AMC_VISITS_PER_YEAR.map(String), transient: true,
        width: 'quarter',
        /*  The six AppSheet frequencies cover most contracts, but a client
            occasionally agrees to an odd number (e.g. 3 visits/year) that
            isn't one of them — allowNew lets anyone type that in directly,
            not just an admin. This is a per-field escape hatch, unlike the
            admin-governed optionsKey lists elsewhere in this file: a one-off
            visit count doesn't need central governance the way a new
            Inverter Brand or Project Type does, so it stays open to any
            user rather than routed through the Admin screen.              */
        allowNew: true, keepCustom: true, addLabel: '＋ Enter a different number',
        required: f => wantsInspection(f), showIf: f => wantsInspection(f) },

      { name: 'inspYears', label: 'Inspection — for how many years?',
        type: 'number', transient: true, width: 'quarter', suffix: 'yrs', max: 25,
        required: f => wantsInspection(f), showIf: f => wantsInspection(f) },

      { name: 'inspStart', label: 'Inspection start date', type: 'date',
        transient: true, width: 'quarter',
        required: f => wantsInspection(f), showIf: f => wantsInspection(f) },

      /*  Read-only preview, kept in step with inspStart/inspVisits/inspYears
          via forceValue below \u2014 see the amcEndDatePreview note above for
          why this is never a typed field.                                  */
      { name: 'inspEnd', label: 'Inspection End Date', type: 'readonly',
        transient: true, width: 'quarter', showIf: f => wantsInspection(f),
        forceValue: f => amcEndDatePreview(f.inspStart, f.inspVisits, f.inspYears),
        help: 'The date of the last scheduled visit \u2014 calculated automatically '
            + 'once the start date, visits per year and number of years are filled in.' },

      /*  The signed contract, scan or quote for THIS type.

          transient:true — it belongs to AMC_Contracts.AMC_Contract_Files, not
          to the Projects tab, so it must not create a stray project column.
          amcSetupPayload carries it across to /api/amc-setup/create.

          Optional on purpose: the paperwork often arrives after the schedule
          has been set up, and making it required would block the visits from
          being generated on the day the client signs verbally.           */
      { name: 'inspFile', label: 'Attach Inspection contract / document', type: 'file',
        transient: true, width: 'quarter', uploadColumn: 'AMC_Inspection_Contract',
        showIf: f => wantsInspection(f),
      },

      /*  Forces Cleaning onto a fresh row rather than cramming into whatever
          slots are left over on Inspection's last (often uneven) row — with
          five quarter-width fields per block, that leftover could be one,
          two or three slots depending on which fields are currently visible,
          so a fixed-width spacer can't fix it reliably; a full-width break
          always starts the next row clean regardless. Doubles as a visual
          label separating the two contracts, and only appears once a
          Cleaning contract is actually part of this order.                 */
      { name: 'amcCleaningBreak', label: 'Cleaning contract', type: 'sectionBreak',
        transient: true, width: 'full', showIf: f => wantsCleaning(f) },

      { name: 'cleanVisits', label: 'How many Cleaning visits every year?',
        type: 'select', options: AMC_VISITS_PER_YEAR.map(String), transient: true,
        width: 'quarter',
        allowNew: true, keepCustom: true, addLabel: '＋ Enter a different number',
        required: f => wantsCleaning(f), showIf: f => wantsCleaning(f) },

      { name: 'cleanYears', label: 'Cleaning — for how many years?',
        type: 'number', transient: true, width: 'quarter', suffix: 'yrs', max: 25,
        required: f => wantsCleaning(f), showIf: f => wantsCleaning(f) },

      { name: 'cleanStart', label: 'Cleaning start date', type: 'date',
        transient: true, width: 'quarter',
        required: f => wantsCleaning(f), showIf: f => wantsCleaning(f) },

      { name: 'cleanEnd', label: 'Cleaning End Date', type: 'readonly',
        transient: true, width: 'quarter', showIf: f => wantsCleaning(f),
        forceValue: f => amcEndDatePreview(f.cleanStart, f.cleanVisits, f.cleanYears),
        help: 'The date of the last scheduled visit \u2014 calculated automatically '
            + 'once the start date, visits per year and number of years are filled in.' },

      { name: 'cleanFile', label: 'Attach Cleaning contract / document', type: 'file',
        transient: true, width: 'quarter', uploadColumn: 'AMC_Cleaning_Contract',
        showIf: f => wantsCleaning(f),
      },
    ],
  },

  {
    id: 'files',
    title: 'Files & Dates',
    icon: '📎',
    fields: [
      /*  width:'third' puts these three attachments across one row on a wide
          screen. Everything else on the form is 'half', i.e. two per row.

          Cost Breakdown Sheet is now required — a project should not be
          saveable without the sheet the quoted price came from.           */
      { name: 'quoteSheet', label: 'Cost Breakdown Sheet', type: 'file',
        sheet: 'Quote_Sheet', required: true, width: 'third' },
      { name: 'proposalFile', label: 'Attach Proposal:', type: 'file',
        sheet: 'Proposal', required: true, width: 'third' },
      /*  maxSizeMB is enforced inside FileField itself — an oversized file is
          rejected before it is ever uploaded, not after.                  */
      { name: 'siteFiles', label: 'Other Files', type: 'file',
        sheet: 'Files', required: true, width: 'third', maxSizeMB: 2 },
      { name: 'expInstDate', label: 'Expected Installation Date', type: 'date',
        sheet: 'Exp_Inst_Date', required: true },
      { name: 'expCommsnDate', label: 'Expected Commissioning Date', type: 'date',
        sheet: 'Exp_Commsn_Date', required: true },
    ],
  },

  {
    id: 'warranty',
    title: 'Commissioning & Warranty',
    icon: '🛡️',
    fields: [
      /*  The gate. Locked to No on a new, not-yet-saved project — matching
          warrantyStatus further down, which uses the same isNewProject
          check for the same reason: a project that does not exist in the
          sheet yet cannot honestly be "commissioned". The other button is
          shown but disabled rather than hidden, so it's clear the choice
          exists and will open up, not that it's missing. Once the project
          has been saved once, both options become selectable and answering
          Yes reveals the four fields below and makes them mandatory.       */
            /*  TRANSIENT — there is no Is_Commissioned column any more.

          It held 3 rows of 1,720, all of them "No", while Commissioned_Date
          held 651. A date and a yes/no meaning "is that date filled in?" are
          the same fact stored twice, and the pair can contradict each other.
          The question stays on the FORM, because it is how somebody
          naturally answers, but it writes nothing: saying Yes reveals
          Commissioned_Date below and that date is what gets stored.       */
      { name: 'isCommissioned', label: 'Has the project been commissioned?',
        type: 'yesno', transient: true,
        showIf  : f => !isNewProject(f) && isWarrantyProject(f),
        required: f => !isNewProject(f) && isWarrantyProject(f),
      
        help: f => (isNewProject(f)
          ? 'Locked to No until this project is saved \u2014 a brand-new order has not gone live yet.'
          : 'Answer Yes once the system has gone live \u2014 that reveals the warranty '
            + 'warranty dates below and makes them mandatory. Leave it No until then.') },

      { name: 'commissionedDate', label: 'Commissioned Date', type: 'date',
        sheet: 'Commissioned_Date',
        showIf: warrantyFieldsVisible, required: warrantyFieldsRequired,
        help: 'The day the system went live. Cover normally starts here.' },

      { name: 'warrantyPeriod', label: ' Warranty Period (in years)', type: 'number',
        sheet: 'Warranty_Period', step: '1', suffix: 'yrs',
        showIf: warrantyFieldsVisible, required: warrantyFieldsRequired },

      { name: 'warrantyStart', label: 'Warranty Start Date', type: 'date',
        sheet: 'Warranty_Start_Date',
        showIf: warrantyFieldsVisible, required: warrantyFieldsRequired,
        help: 'Usually the same day as commissioning.' },

      /*  Always Start Date + Period, computed live \u2014 not typed. Locked
          with readOnlyIf rather than made a 'readonly' field type, because
          toProjectPayload() skips 'readonly' fields entirely, and this one
          genuinely needs to reach the sheet (see addYearsSameDay above for
          why). forceValue keeps it in step with warrantyStart/warrantyPeriod
          on every keystroke; readOnlyIf just stops anyone typing over it.  */
      { name: 'warrantyEnd', label: 'Warranty End Date', type: 'date',
        sheet: 'Warranty_End_Date',
        showIf: warrantyFieldsVisible, required: warrantyFieldsRequired,
        forceValue: f => addYearsSameDay(f.warrantyStart, f.warrantyPeriod),
        readOnlyIf: () => true,
        readOnlyNote: 'Fills in once Start Date and Period are set',
        help: 'Always Start Date + Period \u2014 calculated automatically, not typed. '
            + 'The nightly SolarCare job compares today against this date; cover runs '
            + 'through the whole of this day, so a warranty ending 19 Aug is out from 20 Aug.' },

      /*  Radio rather than a dropdown, so the locked state is visible: on a new
          order the other choice is greyed out instead of missing, which tells
          you the rule exists rather than leaving you wondering.            */
      { name: 'warrantyStatus', label: 'Warranty Status', type: 'radio',
        sheet: 'Warranty_Status', options: ['Under Warranty', 'Warranty Expired'],
        showIf: warrantyFieldsVisible, required: warrantyFieldsRequired,
        default: 'Under Warranty',
        lockedTo  : f => (isNewProject(f) ? 'Under Warranty' : null),
        forceValue: f => (isNewProject(f) ? 'Under Warranty' : null),
        help: f => (isNewProject(f)
          ? 'A new order always starts under warranty. The other option becomes available once the project is saved.'
          : undefined) },
    ],
  },
];

/** Flat list of every field, in form order. */
export const ALL_FIELDS = PROJECT_SECTIONS.flatMap(s => s.fields);

/*  The key holding a file field's ORIGINAL filename, alongside the field's
    normal value (which holds the Drive-safe generated path, e.g.
    "346acf81/346acf81.Quote_Sheet.1783711.xlsx" — see Code.gs's
    handleUploadFile). Derived from the field name so no per-field wiring is
    needed here or in ProjectFormFields.jsx; every 'file' field that has a
    `sheet` gets one automatically. Purely cosmetic: this is what lets the
    Files & Dates screen and the New Order email show "Vendor_PQ_-_Solar.xlsx"
    instead of the internal generated name once the project is reopened or
    the email is built later, since only this value round-trips to the sheet
    (as sheet + '_Name') and back \u2014 the local "just uploaded" filename a
    FileField shows in the same session is never on its own persisted.

    AMC contract files (inspFile/cleanFile) are excluded on purpose \u2014 they
    have no `sheet` (they go to AMC_Contracts via a completely different
    payload, amcSetupPayload below), so this only ever applies to the file
    fields that live directly on the Projects tab.                         */
export const fileNameKey = f => `${f.name}__origName`;
const isNamedFileField = f => f.type === 'file' && f.sheet;

/** Blank form state, with the defaults applied. */
export function emptyProjectForm() {
  const out = {};
  for (const f of ALL_FIELDS) {
    out[f.name] = f.default ?? '';
  }
  return out;
}

const truth = (rule, form) => (typeof rule === 'function' ? Boolean(rule(form)) : Boolean(rule));

/** Is this field currently on screen? */
export const isVisible = (field, form) => (field.showIf ? truth(field.showIf, form) : true);

/** Is it required right now? A hidden field is never required. */
export const isRequired = (field, form) =>
  isVisible(field, form) && truth(field.required, form);

/**
 * Validate the whole form.
 *
 * Only visible fields are checked — that is the point of the conditionals. If
 * you answer "No" to the referral question, the referrer name disappears and
 * stops being required, so the form can actually be submitted.
 */
export function validateProject(form) {
  const errors = {};
  for (const f of ALL_FIELDS) {
    if (f.type === 'readonly') continue;
    if (!isRequired(f, form)) continue;
    const v = form[f.name];
    if (v === null || v === undefined || String(v).trim() === '') {
      /*  f.label may be a function — the status field builds its label from
          Project_Type, mirroring AppSheet's Display name expression. Calling
          .replace on a function throws, so resolve it first.               */
      const text = typeof f.label === 'function' ? f.label(form) : String(f.label ?? f.name);
      errors[f.name] = `${text.replace(/[:*]$/, '')} is required`;
    }
  }

   /*  Length ceilings. The inputs already cap as you type, so this only fires
      on a value that got in another way — a paste that outran the handler, or
      a project row saved by an older build. Checked before the field-specific
      rules below so the message names the real problem.                    */
  for (const f of ALL_FIELDS) {
    if (f.type === 'readonly' || f.type === 'file') continue;
    if (f.type !== 'text' && f.type !== 'textarea' && f.type !== undefined) continue;
    const v = form[f.name];
    if (v === null || v === undefined) continue;
    const cap = maxLengthFor(f);
    if (String(v).length > cap) {
      const text = typeof f.label === 'function' ? f.label(form) : String(f.label ?? f.name);
      errors[f.name] = `${text.replace(/[:*]$/, '')} cannot exceed ${cap} characters`;
    }
  }

  if (form.spEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(form.spEmail).trim())) {
    errors.spEmail = 'That does not look like an email address';
  }
  if (form.gmap && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(form.gmap).trim())) {
    errors.gmap = 'Use "latitude, longitude", e.g. 12.9716, 77.5946';
  }
  if (form.size && Number(form.size) <= 0) {
    errors.size = 'System size must be greater than zero';
  }

  /*  Expected Installation Date must be on or before Expected Commissioning Date.
      Both are ISO yyyy-mm-dd in form state, so a string compare is a date compare. */
  if (form.expInstDate && form.expCommsnDate &&
      String(form.expInstDate) > String(form.expCommsnDate)) {
    errors.expInstDate = 'Expected Installation Date must be on or before Expected Commissioning Date';
  }

  /*  Every numeric field must be zero or positive — no negatives anywhere. */
  for (const f of ALL_FIELDS) {
    if (f.type !== 'number' && f.type !== 'currency' && f.type !== 'percent') continue;
    if (!isVisible(f, form)) continue;
    const v = form[f.name];
    if (v === '' || v === null || v === undefined) continue;
    if (Number(v) < 0) {
      const text = typeof f.label === 'function' ? f.label(form) : String(f.label ?? f.name);
      errors[f.name] = `${text.replace(/[:*]$/, '')} cannot be negative`;
    }
  }

  /*  Numeric ceilings declared as f.max on the field spec. */
  for (const f of ALL_FIELDS) {
    if (typeof f.max !== 'number') continue;
    if (!isVisible(f, form)) continue;   // don't block on a hidden field's stale value
    const v = form[f.name];
    if (v === '' || v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isNaN(n) && n > f.max) {
      const text = typeof f.label === 'function' ? f.label(form) : String(f.label ?? f.name);
      errors[f.name] = `${text.replace(/[:*]$/, '')} cannot exceed ${f.max.toLocaleString('en-IN')}`;
    }
  }
  /*  Only when one was actually entered — the required check above already
      handles a missing one, and this must not fire on a project whose GSTIN
      predates the rule and is merely being re-saved untouched.           */
  const gst = String(form.gstNumber ?? '').trim();
  if (gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gst.toUpperCase())) {
    errors.gstNumber = gst.length === 15
      ? 'That is 15 characters but not a valid GSTIN — check it against the invoice'
      : `A GSTIN is exactly 15 characters — this one is ${gst.length}`;
  }
  return errors;
}

/**
 * Form state → the payload the API writes to the sheet.
 *
 * Hidden fields are sent as empty rather than skipped, so answering Yes, filling
 * a box, then switching to No does not leave the old value stranded in the sheet.
 */
export function toProjectPayload(form, extra = {}) {
  const out = {};
  for (const f of ALL_FIELDS) {
    if (f.type === 'readonly') continue;
    /* AMC terms live on AMC_Contracts, not Projects — see the note above */
    if (f.transient) continue;
    const visible = isVisible(f, form);
    /*  A hidden field is normally sent as '' so switching an answer back to No
        cannot strand the old value in the sheet. A field may override that
        with whenHidden when blank is not a legal value for its column — see
        paymentsDone, whose column is a real boolean.                      */
    let v = visible ? form[f.name] : (f.whenHidden ?? '');

    if ((f.type === 'number' || f.type === 'currency' || f.type === 'percent')
        && v !== '' && v !== null && v !== undefined) {
      const n = Number(v);
      v = Number.isNaN(n) ? '' : n;

      /*  A PERCENT COLUMN STORES A FRACTION, NOT A WHOLE NUMBER.

          Margin is formatted 0.00% in the sheet, and Sheets applies that
          format to the RAW value: 0.12 displays as 12.00%. Every one of the
          1,020 legacy rows holds a fraction — 0.10, 0.125, 0.15.

          The form asks for "EcoSoch Margin%" and the user types 10, which
          went in as the number 10 and displayed as 1000.00%. Two orders of
          magnitude out, and invisible unless you compare it against the row
          above it.

          Divide on the way out, and only here — the form keeps showing the
          human number the user typed.                                      */
      if (f.type === 'percent' && v !== '') v = (Math.round(Number(v) * 10) / 10) / 100;
    }
    out[f.sheet] = v ?? '';

    /*  The original filename, saved alongside the Drive path so it survives
        a reload or a later-built email. Cleared right along with the path
        when the field is hidden or the file is removed — a stray "_Name"
        for a file that no longer exists would be worse than no name at all. */
    if (isNamedFileField(f)) {
      out[`${f.sheet}_Name`] = visible ? (form[fileNameKey(f)] || '') : '';
    }
  }
  return { ...out, ...extra };
}

/**
 * The AMC terms, in the shape /api/amc-setup/create wants.
 * Returns null when there is no AMC to set up, so the caller can just skip.
 */
export function amcSetupPayload(form, projectId) {
  const insp  = wantsInspection(form);
  const clean = wantsCleaning(form);
  if (!projectId || (!insp && !clean)) return null;

  const block = (visits, years, start, file) => ({
    visits_per_year  : Number(visits) || 0,
    years            : Number(years)  || 0,
    start_date       : start || new Date().toISOString().slice(0, 10),
    status           : 'Active',
    payment_available: false,
    /*  Written to AMC_Contracts.AMC_Contract_Files. Sent only when present,
        so a contract created without paperwork does not get an empty cell
        overwriting anything later attached by hand in the sheet.        */
    ...(file ? { contract_file: file } : {}),
  });

  const body = {
    project_id: projectId,
    amc_option: insp && clean ? 'Both' : insp ? 'Inspection' : 'Cleaning',
  };
  if (insp)  body.inspection = block(form.inspVisits,  form.inspYears,  form.inspStart,  form.inspFile);
  if (clean) body.cleaning   = block(form.cleanVisits, form.cleanYears, form.cleanStart, form.cleanFile);
  return body;
}

/** How many visit rows this will create — used for the confirmation message. */
export function amcVisitCount(form) {
  let n = 0;
  if (wantsInspection(form)) n += (Number(form.inspVisits)  || 0) * (Number(form.inspYears)  || 0);
  if (wantsCleaning(form))   n += (Number(form.cleanVisits) || 0) * (Number(form.cleanYears) || 0);
  return n;
}

/** Sheet row → form state, for the Edit screen. */
export function fromProjectRow(row = {}) {
  const out = emptyProjectForm();
  for (const f of ALL_FIELDS) {
    if (f.transient) continue;
    const v = row[f.sheet];
    if (v !== undefined && v !== null && v !== '') out[f.name] = v;

    /*  Older rows saved before this existed simply have no _Name column yet
        (or Code.gs hasn't created it there until the first save that writes
        one) — v is then undefined and the field quietly stays '', which
        FileField.jsx already treats correctly: it falls back to deriving a
        name from the path, i.e. exactly the old behaviour, not a crash.   */
  }
  return out;
}