/*  backend/lib/status.js
    ----------------------------------------------------------------------------
    Project_Status normalisation, applied at the write boundary.

    The sheet had accumulated two spellings of the same status:
        "Defaulted - Project Payment"   <- the old AppSheet app
        "Defaulted"                     <- this app's Add / Edit Project forms
    which is why the UI showed two separate "Defaulted" chips.

    Normalising here rather than in the frontend means EVERY caller — the Edit
    form, Add Project, the New Order flow, curl, a future mobile client — writes
    the same value. The sheet can only ever hold one spelling from now on.

    Reads stay deliberately permissive: automations.isDefaultedStatus() already
    prefix-matches, so the 5 legacy rows keep working untouched.
--------------------------------------------------------------------------- */

/*  The real values, read off the live Dropdowns tab via db.lookups().

    NOTE THE THREE DEFAULTED VARIANTS. They are DIFFERENT statuses — a project
    defaulting on its AMC payment is not the same as one defaulting on the
    project payment — and collapsing them loses information the business needs.

    This list previously held a single bare 'Defaulted', and canonicalStatus
    prefix-matched anything starting with "defaulted" onto it. The effect was
    that picking "Defaulted - AMC Payment" WROTE "Defaulted - Project Payment"
    into the sheet. Silent, and unrecoverable once saved.                    */
const CANONICAL = [
  'Active',
  'Under SolarCare',
  'Out of SolarCare',
  'Completed',
  'On Hold',
  'Cancelled',
  'Defaulted - Project Payment',
  'Defaulted - Ticket Payment',
  'Defaulted - AMC Payment',
];

/*  Values that are APPENDED conditionally by the Valid_If rules, so they must
    not sit in the base list — otherwise rules 2 and 3 stop gating anything.
    See sanitiseBase() below.                                                */
const CONDITIONAL = ['Under SolarCare', 'Completed'];

/*  The single spelling written to Project_Status.

    We keep the legacy AppSheet string for Defaulted so the ~1,500 rows already
    in the sheet stay valid and no migration is needed. To switch to the short
    form instead, change this to 'Defaulted' and find/replace the column once —
    every read path in the app is already spelling-proof.                     */
const SHEET_VALUE = {
  /*  A bare "Defaulted" is the old short spelling this app's own forms used to
      write. It means the project payment one, so it maps there. The three
      explicit variants are left exactly as they are.                        */
  'Defaulted': 'Defaulted - Project Payment',
};

const squash = s => String(s).toLowerCase().replace(/[\s-]+/g, '');

/** Raw sheet or client value -> canonical key ('Defaulted', 'Active', …). */
function canonicalStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  /*  Exact match first, ignoring spacing and hyphens, so
      "Defaulted - AMC Payment" and "Defaulted-AMC Payment" both resolve to
      the AMC variant and NOT to the project-payment one.                   */
  const exact = CANONICAL.find(c => squash(c) === squash(s));
  if (exact) return exact;

  /*  Only a BARE "Defaulted", with nothing after it, falls back to the
      project-payment variant. The old code prefix-matched here, which is what
      collapsed all three variants into one.                                */
  if (squash(s) === 'defaulted') return 'Defaulted - Project Payment';

  return s;
}

/** Canonical key -> the exact string to store in Project_Status. */
function toSheetStatus(raw) {
  const c = canonicalStatus(raw);
  if (!c) return '';
  return SHEET_VALUE[c] || c;
}

/** True for any of the three Defaulted variants. */
const isDefaulted = s => /^defaulted/i.test(String(canonicalStatus(s)).trim());

/*  Normalise Project_Status on a row destined for the sheet. Mutates nothing —
    returns a new object. Leaves the key absent if it was absent, so a PATCH
    that never touched status does not accidentally write one.               */
function normaliseRowStatus(row = {}) {
  if (!Object.prototype.hasOwnProperty.call(row, 'Project_Status')) return row;
  const v = toSheetStatus(row.Project_Status);
  return { ...row, Project_Status: v };
}

module.exports = {
  CANONICAL,
  canonicalStatus,
  toSheetStatus,
  isDefaulted,
  normaliseRowStatus,
};
/* ═══════════════════════════════════════════════════════════════════════════
   PROJECT STATUS VALID_IF — ported from the AppSheet expression on
   Projects.Project_Status.

   The original:

     if(ISBLANK(LOOKUP([_THISROW],"Projects","Project_ID","Project_Status")),
        list('Active'),
     IF(AND([AMC_Provided], count(SELECT(AMC_Payment_Schedule[Payment_Id],
        and(in([AMC_Id],[Related AMC Contracts][AMC_Id]),
            or(ISBLANK([Payment_Amount]),[Payment_Amount]=0))))>0),
        Dropdowns[Project_Status],
     IF(AND([AMC_Provided], COUNT(split(list([AMC_Type]),","))<>
            count(SELECT([Related AMC Contracts][AMC_Type],[AMC_Status]="Active"))),
        Dropdowns[Project_Status],
     if(in([Project_Type],list("EPC","I&C","AMC")),
        Dropdowns[Project_Status]+{"Under SolarCare"},
     ifs([Project_Type]="Consultancy",
        Dropdowns[Project_Status]+{"Completed"}
     )))))

   In plain terms, the rules in priority order:

     1. Brand-new project (no Project_Status stored yet) -> only "Active".
        A project cannot be born already under SolarCare or completed.

     2. AMC provided AND any related payment row has a blank or zero
        Payment_Amount -> base list only. Unbilled AMC money blocks the
        promotion to "Under SolarCare".

     3. AMC provided AND the number of AMC types on the project does not
        match the number of ACTIVE related contracts -> base list only. A
        project promising Inspection + Cleaning with only one active contract
        is not fully set up yet.

     4. Project_Type is EPC, I&C or AMC -> base list + "Under SolarCare".

     5. Project_Type is Consultancy -> base list + "Completed".

   ── TWO DELIBERATE DEVIATIONS ────────────────────────────────────────────

   (a) THE BASE LIST. "Under SolarCare" and "Completed" are APPENDED in rules
       4 and 5, which means Dropdowns[Project_Status] cannot already contain
       them. So the base is the other five. Pass the live sheet values in as
       `base` when you have them (db.lookups().Project_Status) and this
       constant is only a fallback.

   (b) THE UNMATCHED CASE. AppSheet's trailing ifs() has ONE condition and no
       else, so a project whose type is "Retail" — a real value in
       PROJECT_TYPES — falls through and yields a BLANK valid list. In
       AppSheet that means no status can be selected at all: the field is
       effectively locked. That reads as an oversight rather than intent, so
       here an unmatched type returns the base list. Pass { strict: true } to
       reproduce AppSheet's lock-out exactly.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Strip the conditionally-appended values out of a base list.
 *
 * THIS IS THE FIX FOR A REAL BUG. The live Dropdowns tab returns:
 *
 *   Active, Under SolarCare, Out of SolarCare, On Hold, Cancelled,
 *   Defaulted - Project Payment, Defaulted - Ticket Payment,
 *   Defaulted - AMC Payment
 *
 * "Under SolarCare" is ALREADY in there. So when rule 2 or rule 3 returned
 * Dropdowns[Project_Status] to block the promotion, "Under SolarCare" came
 * along anyway and the gate did nothing at all. Verified live against project
 * 410714, which has an AMC promised and zero contracts yet was still offered
 * Under SolarCare.
 *
 * The AppSheet expression APPENDS these two in rules 4 and 5, which only makes
 * sense if the base excludes them — so they are removed here before the rules
 * run, and added back by whichever rule matches. Same net result as AppSheet
 * intended, and now the gate actually gates.
 */
function sanitiseBase(list) {
  const drop = new Set(CONDITIONAL.map(squash));
  return (Array.isArray(list) ? list : [])
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .filter(v => !drop.has(squash(v)));
}

/** Fallback for Dropdowns[Project_Status] when the sheet is unreachable. */
const BASE_STATUSES = [
  'Active',
  'Out of SolarCare',
  'On Hold',
  'Cancelled',
  'Defaulted - Project Payment',
  'Defaulted - Ticket Payment',
  'Defaulted - AMC Payment',
];

/** Project types that can be promoted to "Under SolarCare". */
const SOLARCARE_TYPES = ['EPC', 'I&C', 'AMC'];

/** Truthy test matching the sheet's loose Yes/No/TRUE storage. */
const yes = v => {
  if (v === true) return true;
  return /^(y|yes|true|1)$/i.test(String(v ?? '').trim());
};

/** "Inspection, Cleaning" -> 2. Mirrors COUNT(split(list([AMC_Type]),",")). */
function countAmcTypes(amcType) {
  if (Array.isArray(amcType)) {
    return amcType.map(s => String(s).trim()).filter(Boolean).length;
  }
  return String(amcType ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean).length;
}

/** ISBLANK([Payment_Amount]) OR [Payment_Amount] = 0 */
const unpaid = p => {
  const v = p?.Payment_Amount ?? p?.amount;
  if (v === null || v === undefined || String(v).trim() === '') return true;
  const n = Number(v);
  return !Number.isNaN(n) && n === 0;
};

/**
 * Which Project_Status values may be selected right now.
 *
 * @param {object}  ctx
 * @param {boolean} ctx.isNew        no Project_Status stored yet (rule 1)
 * @param {string}  ctx.projectType  Project_Type
 * @param {*}       ctx.amcProvided  AMC_Provided
 * @param {*}       ctx.amcType      AMC_Type on the PROJECT ("a, b" or array)
 * @param {object[]}ctx.contracts    related AMC_Contracts rows
 * @param {object[]}ctx.payments     AMC_Payment_Schedule rows for those contracts
 * @param {string[]}[ctx.base]       live Dropdowns[Project_Status]
 * @param {boolean} [ctx.strict]     reproduce AppSheet's blank-list lock-out
 * @returns {{ options: string[], rule: number, reason: string }}
 */
function projectStatusOptions(ctx = {}) {
  const {
    isNew = false,
    projectType = '',
    amcProvided,
    amcType,
    contracts = [],
    payments  = [],
    base = BASE_STATUSES,
    strict = false,
  } = ctx;

  /*  Always sanitised, whether it came from the live sheet or the fallback —
      a caller must not be able to smuggle "Under SolarCare" in through base
      and quietly disable rules 2 and 3.                                     */
  const list = sanitiseBase(base);

  /* Rule 1 — a new row can only start Active. */
  if (isNew) {
    return { options: ['Active'], rule: 1, reason: 'New project — must start as Active' };
  }

  if (yes(amcProvided)) {
    /* Rule 2 — any AMC payment with no amount set. */
    const contractIds = new Set(
      contracts.map(c => String(c?.AMC_Id ?? c?.id ?? '').trim()).filter(Boolean)
    );
    const blocking = payments.filter(p => {
      const amcId = String(p?.AMC_Id ?? p?.amc_id ?? '').trim();
      return contractIds.has(amcId) && unpaid(p);
    });
    if (blocking.length > 0) {
      return {
        options: list, rule: 2,
        reason: `${blocking.length} AMC payment row(s) have no amount set — ` +
                'cannot move to Under SolarCare yet',
      };
    }

    /* Rule 3 — AMC types promised vs active contracts in place. */
    const wanted = countAmcTypes(amcType);
    const active = contracts.filter(
      c => String(c?.AMC_Status ?? c?.status ?? '').trim().toLowerCase() === 'active'
    ).length;
    if (wanted !== active) {
      return {
        options: list, rule: 3,
        reason: `${wanted} AMC type(s) on the project but ${active} active contract(s) — ` +
                'AMC setup is incomplete',
      };
    }
  }

  /* Rule 4 — the SolarCare-eligible types. */
  if (SOLARCARE_TYPES.includes(String(projectType).trim())) {
    return {
      options: list.concat('Under SolarCare'), rule: 4,
      reason: `${projectType} project with AMC in order — Under SolarCare available`,
    };
  }

  /* Rule 5 — Consultancy can be closed off. */
  if (String(projectType).trim() === 'Consultancy') {
    return {
      options: list.concat('Completed'), rule: 5,
      reason: 'Consultancy project — Completed available',
    };
  }

  /* Unmatched. See deviation (b). */
  if (strict) {
    return { options: [], rule: 0, reason: `No rule matches Project_Type "${projectType}"` };
  }
  return {
    options: list, rule: 0,
    reason: `Project_Type "${projectType}" matches no AppSheet rule — base list used`,
  };
}

/** Convenience: is this status selectable for this project right now? */
function isStatusAllowed(status, ctx) {
  const want = canonicalStatus(status);
  return projectStatusOptions(ctx).options.some(o => canonicalStatus(o) === want);
}

module.exports.BASE_STATUSES        = BASE_STATUSES;
module.exports.CONDITIONAL          = CONDITIONAL;
module.exports.sanitiseBase        = sanitiseBase;
module.exports.SOLARCARE_TYPES      = SOLARCARE_TYPES;
module.exports.countAmcTypes        = countAmcTypes;
module.exports.projectStatusOptions = projectStatusOptions;
module.exports.isStatusAllowed      = isStatusAllowed;