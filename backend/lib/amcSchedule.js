/*  backend/lib/amcSchedule.js
    ----------------------------------------------------------------------------
    AMC contract maths, ported from the AppSheet Project Repository app.

    Every formula below was read off the AppSheet editor recordings. Where the
    expression was fully legible it is quoted above the code. Where it was
    truncated on screen the behaviour is marked INFERRED — those are the ones
    worth checking against a real contract before going live.

    AppSheet source formulas (AMC_Contracts):
      Total_AMC_Tasks    = number([AMC_Frequency]) * [AMC_Period_in_Years]
      Total_Payments     = [Payment_Frequency] * [Payment_Period_in_Years]
      Payment_Period_in_Years = [AMC_Period_in_Years]
      Payment_End_Date   = [AMC_End_Date]
      Tasks_per_Payment  = IFS([Payment_Available], [Total_AMC_Tasks]/[Total_Payments])
      Payment_Start_Date = EOMONTH([AMC_Start_Date], number(SELECT(Add_Months…)))
      Project_Name       = [Project_ID].[Project_Name]

    AMC_Frequency is visits PER YEAR, held as text: "24", "12", "6", "4", "2", "1".
--------------------------------------------------------------------------- */

/* ── frequency vocabulary ─────────────────────────────────────────────── */

const FREQUENCY_LABELS = {
  24: 'Twice a month',
  12: 'Monthly',
  6 : 'Every 2 months',
  4 : 'Quarterly',
  2 : 'Half-yearly',
  1 : 'Yearly',
};

const AMC_FREQUENCIES     = [24, 12, 6, 4, 2, 1];
const PAYMENT_FREQUENCIES = [12, 6, 4, 2, 1];

/**
 * Payment frequency options for a given visit frequency. CONFIRMED.
 *
 * AppSheet Valid_If on Payment_Frequency:
 *   SWITCH(NUMBER([AMC_Frequency]),
 *      1, list(1),
 *      2, LIST(1,2),
 *      4, LIST(1,2,4),
 *      6, LIST(1,2,4,6),
 *     12, LIST(1,2,4,6,12),
 *     24, LIST(1,2,4,6,12),
 *     [_THIS])
 *
 * Note this is a fixed ladder, NOT "must divide evenly": 6 visits a year allows
 * 4 payments a year, which gives 1.5 visits per payment. AppSheet permits that,
 * so this does too.
 *
 * Invalid value error, verbatim from the app:
 *   "Payment frequency should be less than or equal to Contract frequency.
 *    One task cannot have many payments but one payment can be linked to
 *    many tasks"
 */
const PAYMENT_FREQ_BY_AMC = {
  1 : [1],
  2 : [1, 2],
  4 : [1, 2, 4],
  6 : [1, 2, 4, 6],
  12: [1, 2, 4, 6, 12],
  24: [1, 2, 4, 6, 12],
};

const PAYMENT_FREQUENCY_ERROR =
  'Payment frequency should be less than or equal to Contract frequency. ' +
  'One task cannot have many payments but one payment can be linked to many tasks';

function paymentFrequencyOptions(amcFrequency) {
  return PAYMENT_FREQ_BY_AMC[num(amcFrequency)] || [];
}

/* ── small helpers ────────────────────────────────────────────────────── */

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Accepts ISO, dd/mm/yyyy, or a Google Sheets serial. Returns a Date or null. */
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));

  if (/^\d+(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    return new Date((+s - 25569) * 86400000);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toISO(d) {
  return d ? d.toISOString().slice(0, 10) : '';
}

/** Adds whole months, clamping the day so 31 Jan + 1 month is 28/29 Feb. */
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** AppSheet EOMONTH(date, n) — last day of the month n months away. */
function eomonth(date, months) {
  const d = addMonths(date, months);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

/**
 * AMC_End_Date — the date of the final scheduled visit. CONFIRMED (see above).
 */
function amcEndDate(start, frequency, periodYears) {
  const F = num(frequency), P = num(periodYears);
  if (!start || !F || !P) return null;

  const monthOffset = Math.floor((F - 1) * (12 / F)) - 1 + 12 * (P - 1);
  let d = addDays(eomonth(start, monthOffset), start.getUTCDate());
  if (F === 24) d = addDays(d, 14);
  return d;
}

/* ── Add_Months lookup ────────────────────────────────────────────────── */

/**
 * Key into the Add_Months tab. CONFIRMED — the tab's _ComputedKey column is
 *   CONCATENATE([Payment_Frequency], ": ", [AMC_Frequency])
 */
function addMonthsKey(paymentFrequency, amcFrequency) {
  return `${num(paymentFrequency)}: ${num(amcFrequency)}`;
}

/**
 * Turns raw Add_Months rows from the sheet into a { "4: 12": 3 } map.
 * Pass the result as options.addMonthsTable and Payment_Start_Date is computed
 * from your real data rather than a fallback.
 */
function buildAddMonthsTable(rows = []) {
  const table = {};
  for (const r of rows) {
    const key = r._ComputedKey || addMonthsKey(r.Payment_Frequency, r.AMC_Frequency);
    const val = num(r.Add_Months);
    if (key) table[String(key).trim()] = val;
  }
  return table;
}

/**
 * Months to offset the first payment by.
 *
 * Uses the real Add_Months row when one is supplied. The fallback — one billing
 * interval, i.e. billing in arrears — only applies when the row is missing, and
 * deriveContract reports which was used via payment_start_source.
 */
function lookupAddMonths(table, paymentFrequency, amcFrequency) {
  const key = addMonthsKey(paymentFrequency, amcFrequency);
  if (table && Object.prototype.hasOwnProperty.call(table, key)) {
    return { months: num(table[key]), source: 'Add_Months' };
  }
  const pf = num(paymentFrequency);
  return { months: pf ? 12 / pf : 0, source: 'fallback' };
}

/* ── contract derivation ──────────────────────────────────────────────── */

/**
 * Fills in every computed column on an AMC contract.
 *
 * @param {object} c raw contract, app-side field names
 *   { amc_type, frequency, period_years, start_date,
 *     payment_available, payment_amount, percent_increase,
 *     payment_frequency, payment_start_date }
 * @returns {object} the derived values, ready to write to the sheet
 */
function deriveContract(c = {}, opts = {}) {
  const frequency    = num(c.frequency);
  const periodYears  = num(c.period_years);
  const start        = parseDate(c.start_date);
  const paymentOn    = truthy(c.payment_available);

  /* AMC_End_Date — CONFIRMED, exact port of the App formula:
       ifs(ISNOTBLANK([AMC_Start_Date]),
         IF(number([AMC_Frequency])=24,
           EOMONTH([AMC_Start_Date],
             (floor(((number([AMC_Frequency])-1)*(12/number([AMC_Frequency]))))-1)
             + (12*([AMC_Period_in_Years]-1))) + DAY([AMC_Start_Date]) + 14,
           EOMONTH([AMC_Start_Date], …same…) + DAY([AMC_Start_Date])))

     It resolves to the date of the LAST VISIT, not the end of the contract
     term: EOMONTH(S, m-1) + DAY(S) lands on the same day-of-month m months on,
     and m works out to 12*Period - 12/Frequency. The +14 on fortnightly
     contracts covers the half-month the floor() drops. */
  const endDate = amcEndDate(start, frequency, periodYears);

  /* Total_AMC_Tasks = number([AMC_Frequency]) * [AMC_Period_in_Years] */
  const totalTasks = frequency * periodYears;

  /* Payment_Period_in_Years = [AMC_Period_in_Years] */
  const paymentPeriodYears = periodYears;

  const paymentFrequency = paymentOn ? num(c.payment_frequency) : 0;

  /* Total_Payments = [Payment_Frequency] * [Payment_Period_in_Years] */
  const totalPayments = paymentOn ? paymentFrequency * paymentPeriodYears : 0;

  /* Tasks_per_Payment = IFS([Payment_Available], [Total_AMC_Tasks]/[Total_Payments]) */
  const tasksPerPayment = paymentOn && totalPayments
    ? totalTasks / totalPayments
    : null;

  /* Payment_Start_Date = EOMONTH([AMC_Start_Date], <Add_Months lookup>) + DAY([AMC_Start_Date])
     Same EOMONTH(...) + DAY(...) idiom as AMC_End_Date, which keeps the payment
     on the same day of the month as the contract start. The month offset comes
     from the Add_Months tab, read live from the sheet. */
  const explicitStart = parseDate(c.payment_start_date);
  const lookup = lookupAddMonths(opts.addMonthsTable, paymentFrequency, frequency);

  const paymentStart = !paymentOn ? null
    : explicitStart
      || (start ? addDays(eomonth(start, lookup.months - 1), start.getUTCDate()) : null);

  const paymentStartSource = !paymentOn ? null
    : explicitStart ? 'explicit' : lookup.source;

  return {
    end_date            : toISO(endDate),
    total_tasks         : totalTasks,
    tasks_count         : totalTasks,
    payment_period_years: paymentPeriodYears,
    total_payments      : totalPayments,
    payments_count      : totalPayments,
    tasks_per_payment   : tasksPerPayment,
    payment_start_date  : toISO(paymentStart),
    /* 'Add_Months' = read from your sheet · 'fallback' = no matching row found
       · 'explicit' = supplied on the contract */
    payment_start_source: paymentStartSource,
    add_months_key      : paymentOn ? addMonthsKey(paymentFrequency, frequency) : null,
    add_months_value    : paymentOn ? lookup.months : null,
    /* Payment_End_Date = [AMC_End_Date] */
    payment_end_date    : paymentOn ? toISO(endDate) : '',
    frequency_label     : FREQUENCY_LABELS[frequency] || '',
  };
}

function truthy(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return ['y', 'yes', 'true', '1'].includes(s);
}

/* ── schedule generation ──────────────────────────────────────────────── */

/**
 * The AMC_Tasks_Schedule rows for a contract.
 *
 * Total_AMC_Tasks visits, evenly spaced at 12/AMC_Frequency months from the
 * start date. Each task is tagged with the payment it falls under, which is how
 * AppSheet links AMC_Tasks_Schedule.Payment_Id — Tasks_per_Payment consecutive
 * visits share one payment.
 *
 * @returns {Array} rows in app-side field names, ready for toSheet()
 */
function generateTasks(contract, { amcId, projectId, amcType, paymentIds = [], addMonthsTable } = {}) {
  const frequency = num(contract.frequency);
  const start     = parseDate(contract.start_date);
  const d         = deriveContract(contract, { addMonthsTable });

  if (!frequency || !start || !d.total_tasks) return [];

  const perPayment = d.tasks_per_payment || 0;
  const rows       = [];

  /*  Twice-a-month contracts sit on two fixed days: the start day and 14 days
      later. That is what the +14 in the AMC_End_Date formula encodes, and
      spacing them as 0.5-month steps puts the final visit in the wrong month.
      Every other frequency is a clean 12/F month step. */
  const fortnightly    = frequency === 24;
  const intervalMonths = fortnightly ? 1 : 12 / frequency;

  for (let i = 0; i < d.total_tasks; i++) {
    const due = fortnightly
      ? addDays(addMonths(start, Math.floor(i / 2)), (i % 2) * 14)
      : addMonths(start, Math.round(intervalMonths * i));

    /* Which payment covers this visit */
    const paymentIndex = perPayment ? Math.floor(i / perPayment) : -1;

    rows.push({
      amc_id     : amcId || contract.id || '',
      project_id : projectId || contract.project_id || '',
      amc_type   : amcType || contract.amc_type || '',
      due_date   : toISO(due),
      description: `${amcType || contract.amc_type || 'AMC'} visit ${i + 1} of ${d.total_tasks}`,
      status     : 'Scheduled',
      payment_id : paymentIndex >= 0 ? (paymentIds[paymentIndex] || '') : '',
      _index     : i + 1,
    });
  }
  return rows;
}

/**
 * The AMC_Payment_Schedule rows for a contract.
 *
 * Total_Payments instalments at 12/Payment_Frequency month intervals from
 * Payment_Start_Date.
 *
 * Percent_Increase escalates EVERY PAYMENT, compounding. CONFIRMED by its
 * display name in the app: "% increase for every payment". So instalment n is
 * base * (1 + rate)^n, not an annual step.
 *
 * Percent_Increase is also Editable_If
 *   and(ISBLANK(LOOKUP([_THISROW],"AMC_Contracts","AMC_Id","Percent_Increase")),
 *       [Total_Payments]>1)
 * — set once on creation, and only when there is more than one payment.
 */
function generatePayments(contract, { amcId, projectId, amcType, addMonthsTable } = {}) {
  const d = deriveContract(contract, { addMonthsTable });
  if (!truthy(contract.payment_available) || !d.total_payments) return [];

  const paymentFrequency = num(contract.payment_frequency);
  const start            = parseDate(d.payment_start_date);
  if (!paymentFrequency || !start) return [];

  const intervalMonths = 12 / paymentFrequency;
  const base           = num(contract.payment_amount);
  const increase       = num(contract.percent_increase);   // 0.1 = 10%
  const rate           = increase > 1 ? increase / 100 : increase;

  const rows = [];
  for (let i = 0; i < d.total_payments; i++) {
    const due    = addMonths(start, Math.round(intervalMonths * i));
    const amount = round2(base * Math.pow(1 + rate, i));   // compounds per payment

    rows.push({
      amc_id     : amcId || contract.id || '',
      project_id : projectId || contract.project_id || '',
      amc_type   : amcType || contract.amc_type || '',
      due_date   : toISO(due),
      amount,
      base_amount: base,
      description: `${amcType || contract.amc_type || 'AMC'} payment ${i + 1} of ${d.total_payments}` +
                   (i > 0 && rate ? ` (+${round2(rate * 100)}% per payment, compounded ${i}×)` : ''),
      status     : 'Unpaid',
      _index     : i + 1,
    });
  }
  return rows;
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Everything for a new contract in one call: derived columns, payment rows,
 * then task rows linked to those payments.
 */
function buildContractPlan(contract, ids = {}) {
  const derived  = deriveContract(contract, { addMonthsTable: ids.addMonthsTable });
  const payments = generatePayments(contract, ids);
  const tasks    = generateTasks(contract, {
    ...ids,
    paymentIds: payments.map(p => p.payment_id || ''),
  });
  return { derived, payments, tasks };
}

/**
 * Sanity checks a derived contract. These catch the places where the AppSheet
 * behaviour could not be read in full, so a wrong assumption shows up as a
 * warning instead of a silently wrong schedule.
 */
function validateContract(contract, opts = {}) {
  const d = deriveContract(contract, opts);
  const errors   = [];   // block creation — the contract cannot be built
  const warnings = [];   // inform only — the schedule is still valid

  if (!num(contract.frequency))    errors.push('Visit frequency is missing.');
  if (!num(contract.period_years)) errors.push('Contract period in years is missing.');
  if (!parseDate(contract.start_date)) errors.push('Start date is missing or unreadable.');

  if (truthy(contract.payment_available)) {
    const allowed = paymentFrequencyOptions(contract.frequency);
    if (allowed.length && !allowed.includes(num(contract.payment_frequency))) {
      errors.push(`${PAYMENT_FREQUENCY_ERROR}. Allowed here: ${allowed.join(', ')}.`);
    }

    /* AppSheet allows fractional visits per payment (6 visits + 4 payments is
       a valid combination), so this is a note rather than a problem. */
    if (d.tasks_per_payment && !Number.isInteger(d.tasks_per_payment)) {
      warnings.push(
        `Note: ${d.tasks_per_payment} visits per payment — not a whole number. ` +
        `AppSheet permits this; visits are assigned to payments by rounding down.`
      );
    }

    /* The Add_Months offset feeding Payment_Start_Date was never shown on
       screen. If the schedule runs past the contract end, the assumed offset
       is wrong — set payment_start_date explicitly to override it. */
    const payments = generatePayments(contract, { addMonthsTable: opts.addMonthsTable });
    const last = payments.length ? parseDate(payments[payments.length - 1].due_date) : null;
    const end  = parseDate(d.end_date);
    if (last && end && last > end) {
      warnings.push(
        `The last payment (${toISO(last)}) falls after the contract ends (${d.end_date}).` +
        (d.payment_start_source === 'fallback'
          ? ` No Add_Months row matched "${d.add_months_key}", so a fallback offset was used — ` +
            `add that row to the Add_Months tab.`
          : ` Check the Add_Months value for "${d.add_months_key}" (currently ${d.add_months_value}).`)
      );
    }

    if (d.payment_start_source === 'fallback') {
      warnings.push(
        `No Add_Months row for "${d.add_months_key}" — first payment date was estimated. ` +
        `Add that row to the Add_Months tab for an exact match with AppSheet.`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, derived: d };
}

/** Human-readable summary, for confirming a contract before it is written. */
function describeContract(contract) {
  const d = deriveContract(contract);
  const f = num(contract.frequency);
  const lines = [
    `${contract.amc_type || 'AMC'} · ${FREQUENCY_LABELS[f] || f + '/year'} · ${num(contract.period_years)} year(s)`,
    `${d.total_tasks} visits from ${contract.start_date} to ${d.end_date}`,
  ];
  if (truthy(contract.payment_available)) {
    lines.push(
      `${d.total_payments} payments from ${d.payment_start_date}, ` +
      `${d.tasks_per_payment} visit(s) per payment` +
      (num(contract.percent_increase) ? `, escalating annually` : '')
    );
  } else {
    lines.push('No payment schedule on this contract');
  }
  return lines.join('\n');
}

module.exports = {
  amcEndDate,
  addMonthsKey,
  buildAddMonthsTable,
  lookupAddMonths,
  PAYMENT_FREQ_BY_AMC,
  PAYMENT_FREQUENCY_ERROR,
  deriveContract,
  validateContract,
  generateTasks,
  generatePayments,
  buildContractPlan,
  describeContract,
  paymentFrequencyOptions,
  FREQUENCY_LABELS,
  AMC_FREQUENCIES,
  PAYMENT_FREQUENCIES,
  addMonths,
  eomonth,
  parseDate,
  toISO,
};