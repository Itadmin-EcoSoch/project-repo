/*  backend/lib/paymentsDone.js
    ============================================================================
    Projects.Payments_Done — "Has client cleared the required project payments?"

    Ported from two AppSheet expressions on that column.

    ── SHOW_IF ──────────────────────────────────────────────────────────────
        and(in([Project_Status], LIST("Under SolarCare","Defaulted - Project Payment")),
            [Project_Type] <> "AMC")

    The question only makes sense once a project has reached SolarCare or has
    defaulted on its project payment, and never for an AMC-type project — an
    AMC has its own payment schedule, so "project payments" is meaningless
    there.

    ── VALID_IF ─────────────────────────────────────────────────────────────
        IF([Project_Status]="Under SolarCare", list(true,false),
        IF([Project_Status]="Defaulted - Project Payment", list(false),
        if(isblank([_this]), list(false,true), list([_this], true)
        )))

    Read as three cases:

      Under SolarCare              both Yes and No are selectable. The project
                                   is in service; payment may or may not have
                                   cleared.

      Defaulted - Project Payment  ONLY No. A project cannot simultaneously be
                                   flagged as defaulting on its payment and be
                                   marked as having cleared it.

      anything else                blank -> either. Already set -> the current
                                   value, or true. That is a ONE-WAY RATCHET:
                                   once Payments_Done is Yes, list([_this],true)
                                   collapses to [true, true], so it can never be
                                   set back to No. Undoing a cleared payment is
                                   deliberately not something the form allows.

    ── WHY THE DEFAULTED SPELLING MATTERS ───────────────────────────────────
    This rule keys on "Defaulted - Project Payment" SPECIFICALLY, not on any
    status starting with "Defaulted". Your sheet has three variants:

        Defaulted - Project Payment   <- only this one forces No
        Defaulted - Ticket Payment
        Defaulted - AMC Payment

    Until the canonicalStatus fix, all three collapsed onto the first, which
    would have made this rule fire for ticket and AMC defaults too — forcing
    Payments_Done to No on projects whose PROJECT payment was perfectly fine.
    canonicalStatus now keeps them distinct, so the exact match is safe.
    ============================================================================  */

const { canonicalStatus } = require('./status');

/** The two statuses that make the question relevant. */
const SHOW_STATUSES = ['Under SolarCare', 'Defaulted - Project Payment'];

/** Loose Yes/No read — the sheet stores true, "Yes", "Y", "TRUE". */
function asBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? '').trim();
  if (!s) return null;                       // blank, genuinely unset
  if (/^(y|yes|true|1)$/i.test(s))  return true;
  if (/^(n|no|false|0)$/i.test(s)) return false;
  return null;
}

/**
 * SHOW_IF — should the question be asked at all?
 * @param {object} project raw sheet row (Project_Status, Project_Type)
 */
function isPaymentsDoneVisible(project = {}) {
  const status = canonicalStatus(project.Project_Status);
  const type   = String(project.Project_Type ?? '').trim();
  return SHOW_STATUSES.includes(status) && type.toUpperCase() !== 'AMC';
}

/**
 * VALID_IF — which values may be chosen right now.
 *
 * @param {object} project raw sheet row
 * @param {*} current      the value currently stored ([_this])
 * @returns {{ options: boolean[], reason: string, locked: boolean }}
 *          `locked` is true when only one value is possible.
 */
function paymentsDoneOptions(project = {}, current = project.Payments_Done) {
  const status = canonicalStatus(project.Project_Status);

  if (status === 'Under SolarCare') {
    return {
      options: [true, false], locked: false,
      reason : 'Project is under SolarCare — payment may or may not have cleared',
    };
  }

  if (status === 'Defaulted - Project Payment') {
    return {
      options: [false], locked: true,
      reason : 'Project is flagged as defaulting on its project payment — this must be No',
    };
  }

  const cur = asBool(current);
  if (cur === null) {
    return {
      options: [false, true], locked: false,
      reason : 'Not yet answered — either value may be set',
    };
  }

  /*  list([_this], true) — deduped. When _this is already true this leaves
      exactly [true], which is the one-way ratchet described above.        */
  const opts = cur === true ? [true] : [false, true];
  return {
    options: opts, locked: opts.length === 1,
    reason : cur === true
      ? 'Payments were already marked as cleared — this cannot be reversed here'
      : 'Currently No — may be changed to Yes',
  };
}

/** Is this value selectable right now? */
function isPaymentsDoneAllowed(value, project = {}, current = project.Payments_Done) {
  const want = asBool(value);
  if (want === null) return false;
  return paymentsDoneOptions(project, current).options.includes(want);
}

/**
 * REQUIRE — AppSheet has Require? ticked, and a hidden column is never
 * required, so this is simply "required when visible".
 */
const isPaymentsDoneRequired = project => isPaymentsDoneVisible(project);

/** The AppSheet Display name expression for this column. */
const PAYMENTS_DONE_LABEL = 'Has client cleared the required project payments?';

module.exports = {
  SHOW_STATUSES, PAYMENTS_DONE_LABEL,
  asBool,
  isPaymentsDoneVisible,
  paymentsDoneOptions,
  isPaymentsDoneAllowed,
  isPaymentsDoneRequired,
};