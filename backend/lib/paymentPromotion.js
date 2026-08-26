/*  backend/lib/paymentPromotion.js
    ============================================================================
    "When a project is Active and an AMC is provided, look at the payments.
     Payments cleared  -> Under SolarCare.
     Payment overdue   -> Defaulted."

    ── THE THREE DECISIONS THIS RULE HAD TO MAKE ────────────────────────────

    The instruction is clear in intent but leaves three things open, and each
    one changes what happens to real rows. They are named here rather than
    buried, and each is a one-line change at the top of this file.

    (1) WHICH PAYMENTS?  The sheet has two unrelated notions of payment:
            Projects.Payments_Done        the EPC / project payment
            AMC_Payment_Schedule rows     the AMC instalments
        "if AMC is provided then check the payment status" reads as the AMC
        instalments, so those are what SOURCE = 'amc' uses. Set SOURCE to
        'project' to key off Payments_Done instead, or 'both' to require both.

    (2) WHICH DEFAULTED?  Your sheet has three:
            Defaulted - Project Payment
            Defaulted - Ticket Payment
            Defaulted - AMC Payment
        An overdue AMC instalment is an AMC-payment default, so DEFAULT_TO is
        'Defaulted - AMC Payment'. If the business treats every default as a
        project-payment default, change that one constant.

    (3) WHAT COUNTS AS OVERDUE?  A pending instalment whose due date has not
        arrived is not a default — the client simply has not been billed yet.
        So only rows PAST their due date count. GRACE_DAYS adds a buffer so a
        payment does not flip a project to Defaulted the morning after it fell
        due.

    ── WHAT THIS RULE WILL NOT DO ───────────────────────────────────────────

    It never promotes to a status the Project_Status Valid_If forbids. A
    project with an incomplete AMC setup fails rule 3 there, and silently
    promoting it would put the sheet in a state the form itself refuses to
    produce. When that happens the reason is reported and nothing is written.

    It also only ever acts on an ACTIVE project. It will not move something out
    of Cancelled, Completed, or an existing Defaulted state — un-defaulting a
    client is a decision for a person, not for a sweep.
    ============================================================================  */

const { canonicalStatus, isStatusAllowed } = require('./status');

/* ── the three decisions, as constants ─────────────────────────────────── */

/** 'amc' | 'project' | 'both' — see decision (1). */
const SOURCE = 'amc';

/** Where an overdue payment sends the project — see decision (2). */
const DEFAULT_TO = 'Defaulted - AMC Payment';

/** Where cleared payments send it. */
const PROMOTE_TO = 'Under SolarCare';

/** Days past the due date before a payment counts as overdue — decision (3). */
const GRACE_DAYS = 7;

/*  Which statuses this rule is allowed to touch.
    ---------------------------------------------------------------------------
    'Active' ONLY, and that is a considered choice rather than a limitation.

    The instruction was "when status is Active, check the payments". But the
    live data runs the other way round: an AMC contract is created through the
    Set up AMC flow, the project is promoted to Under SolarCare, and only THEN
    do the instalments fall due over the next three to five years. So "all
    payments cleared" is not true at promotion time — it becomes true years
    later, when promoting is already meaningless.

    That is why 0 of 1,542 projects matched. It is the sequencing, not the rule.

    Adding 'Under SolarCare' here would make the DEFAULT half fire, and on
    today's data it would flip SEVEN live projects:

        406608, 563364, 563402, 563403, 8D41CFCD, 25AAA252, 68E2C6EA
        25 overdue instalments, the oldest 4.2 years past due

    Do NOT add it yet. Four years of genuinely unpaid AMC on a project that is
    still receiving SolarCare visits is not credible — those payments were
    almost certainly collected and never written back to the sheet. Flipping
    them to Defaulted would raise the client's Defaulter flag and fire the
    defaulter emails, off the back of stale data.

    The prerequisite is a way to MARK A PAYMENT PAID. Payment_Status is
    "Pending" on 28 of 30 rows, Payment_Receipt is empty on all 30, and
    Payment_Resolution is filled on exactly one. Until completion is recorded
    somewhere, no rule keyed on it can be trusted in either direction.        */
const ACT_ON = ['Active'];

/*  Payment_Status spellings. Read off the live AMC_Payment_Schedule tab, which
    holds "Pending" and "Cancelled"; the paid vocabulary is matched loosely
    because the tab is hand-maintained and "Paid", "Received" and "Completed"
    all appear in EcoSoch's other payment columns.

    A CANCELLED instalment is not owed, so it can neither clear nor default —
    it is simply ignored. Getting that wrong would default every project that
    ever cancelled a payment line.                                          */
const isPaid      = s => /paid|received|cleared|complete|settled/i.test(String(s || ''));
const isCancelled = s => /cancel|void|waiv/i.test(String(s || ''));

const yes = v => v === true || /^(y|yes|true|1)$/i.test(String(v ?? '').trim());

/** dd/mm/yyyy or ISO. dd/mm checked first — see lib/warranty.js for why. */
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy.map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * The payment picture for one project.
 *
 * @param {object[]} payments AMC_Payment_Schedule rows for this project
 * @param {Date}     [today]
 */
function paymentState(payments = [], today = new Date()) {
  const cutoff = new Date(today.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - GRACE_DAYS);

  let paid = 0, cancelled = 0, overdue = 0, notYetDue = 0, undated = 0;

  for (const p of payments) {
    if (!p) continue;
    const st = p.Payment_Status;
    if (isCancelled(st)) { cancelled++; continue; }
    if (isPaid(st))      { paid++;      continue; }

    const due = parseDate(p.Payment_Due_Date);
    if (!due)                       undated++;        // cannot judge — see below
    else if (due < cutoff)          overdue++;
    else                            notYetDue++;
  }

  const owed = payments.length - cancelled;
  return {
    total: payments.length, paid, cancelled, overdue, notYetDue, undated, owed,
    allCleared: owed > 0 && paid === owed,
  };
}

/**
 * What should happen to this project, if anything.
 *
 * @param {object}   project    raw Projects row
 * @param {object}   ctx
 * @param {object[]} ctx.contracts AMC_Contracts rows for this project
 * @param {object[]} ctx.payments  AMC_Payment_Schedule rows for those contracts
 * @param {string[]} [ctx.base]    live Dropdowns[Project_Status]
 * @param {Date}     [ctx.today]
 * @returns {{ action:'promote'|'default'|'none', to:string|null, reason:string,
 *             state:object }}
 */
function evaluatePromotion(project = {}, ctx = {}) {
  const { contracts = [], payments = [], base, today = new Date() } = ctx;
  const state = paymentState(payments, today);

  const none = reason => ({ action: 'none', to: null, reason, state });

  /*  Scope check — see ACT_ON above. Un-defaulting is a human decision, so a
      status outside the list is never touched in either direction.        */
  const st = canonicalStatus(project.Project_Status);
  if (!ACT_ON.includes(st)) {
    return none(`Status is "${project.Project_Status}", not in [${ACT_ON.join(', ')}] — left alone`);
  }

  if (!yes(project.AMC_Provided)) {
    return none('No AMC provided — payment state is not this rule\'s business');
  }

  /*  The project-payment source, when selected. Payments_Done is the explicit
      "has client cleared the required project payments?" answer.          */
  if (SOURCE === 'project' || SOURCE === 'both') {
    const done = project.Payments_Done;
    if (done === '' || done === null || done === undefined) {
      return none('Payments_Done has not been answered yet');
    }
    if (!yes(done)) {
      return { action: 'default', to: DEFAULT_TO,
               reason: 'Payments_Done is No — project payment outstanding', state };
    }
    if (SOURCE === 'project') {
      return { action: 'promote', to: PROMOTE_TO,
               reason: 'Payments_Done is Yes', state };
    }
  }

  /* The AMC instalment source. */
  if (!payments.length) {
    return none('AMC provided but no payment rows exist — nothing to judge');
  }

  if (state.overdue > 0) {
    return { action: 'default', to: DEFAULT_TO,
             reason: `${state.overdue} AMC payment(s) past due by more than ${GRACE_DAYS} days`,
             state };
  }

  /*  An undated unpaid row cannot be called overdue OR cleared. Saying so is
      better than guessing in either direction — one guess defaults a paying
      client, the other promotes a non-paying one.                         */
  if (state.undated > 0) {
    return none(`${state.undated} unpaid AMC payment(s) have no due date — cannot judge`);
  }

  if (state.allCleared) {
    return { action: 'promote', to: PROMOTE_TO,
             reason: `all ${state.paid} AMC payment(s) cleared`, state };
  }

  return none(`${state.notYetDue} AMC payment(s) not yet due — still Active`);
}

/**
 * evaluatePromotion, then check the target against the Project_Status Valid_If.
 * A promotion the form itself would refuse is reported, not written.
 */
function decide(project = {}, ctx = {}) {
  const out = evaluatePromotion(project, ctx);
  if (out.action === 'none') return { ...out, allowed: true };

  const statusCtx = {
    isNew      : false,
    projectType: project.Project_Type,
    amcProvided: project.AMC_Provided,
    amcType    : project.AMC_Type,
    contracts  : ctx.contracts || [],
    payments   : ctx.payments  || [],
    base       : ctx.base,
  };

  const allowed = isStatusAllowed(out.to, statusCtx);
  return allowed ? { ...out, allowed: true } : {
    ...out, allowed: false,
    reason: `${out.reason}, but "${out.to}" is blocked by the status rules — not written`,
  };
}

module.exports = {
  SOURCE, DEFAULT_TO, PROMOTE_TO, GRACE_DAYS, ACT_ON,
  isPaid, isCancelled, parseDate,
  paymentState, evaluatePromotion, decide,
};