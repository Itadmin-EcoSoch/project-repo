/*  backend/lib/warranty.js
    ============================================================================
    Warranty_End_Date and Warranty_Status, computed rather than typed.

    ── THE RULE ─────────────────────────────────────────────────────────────
        Warranty_End_Date = Warranty_Start_Date + Warranty_Period days

    Verified against 16 rows read off the live Tickets tab — all 16 match:

        25/04/2022 +  1  ->  26/04/2022
        13/01/2022 + 30  ->  12/02/2022
        12/01/2022 +  0  ->  12/01/2022      period 0 means same day
        28/12/2021 + 30  ->  27/01/2022      crosses a year boundary
        08/02/2022 + 30  ->  10/03/2022      crosses a short month

    The unit is DAYS, not months or years. That is worth stating explicitly
    because AMC_Period_in_Years on the contracts tab is years, and the two are
    easy to confuse when both are called "period".

    ── WHERE THESE COLUMNS LIVE ─────────────────────────────────────────────
    There are TWO separate sets in the sheet and they are not the same thing:

        Projects tab   Warranty_Status, Warranty_Period,
                       Warranty_Start_Date, Warranty_End_Date
                       — the panel/inverter warranty on the installation

        Tickets tab    Ticket_Warranty_Status, Ticket_Warranty_Period,
                       Ticket_Warranty_Start_Date, Ticket_Warranty_End_Date
                       — the warranty on the repair done under that ticket

    The maths is identical, so the helpers below take plain values and the
    caller supplies whichever column set applies.
    ============================================================================  */

/** Parse a sheet date: ISO from Apps Script, or dd/mm/yyyy typed by hand. */
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;

  const s = String(v).trim();
  if (!s) return null;

  /*  dd/mm/yyyy is checked FIRST. new Date("12/01/2022") is parsed by
      JavaScript as December 1st (US order), which would silently shift the
      Indian-format dates in this sheet by up to eleven months.            */
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy.map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "yyyy-mm-dd", the shape the rest of the app stores dates in. */
function toISODate(d) {
  if (!d) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
         `${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Warranty_End_Date = start + period days.
 *
 * @param {*} start  Warranty_Start_Date
 * @param {*} period Warranty_Period, in DAYS
 * @returns {string} ISO date, or '' when either input is missing
 */
function warrantyEndDate(start, period) {
  const d = parseDate(start);
  if (!d) return '';

  const n = Number(period);
  if (!Number.isFinite(n)) return '';

  const end = new Date(d.getTime());
  end.setUTCDate(end.getUTCDate() + n);
  return toISODate(end);
}

/**
 * Warranty_Status from the end date.
 *
 * The sheet's live values show "Warranty Expired" for past dates. The label
 * for a still-valid warranty is NOT visible in the data I have — every row
 * sampled was expired — so IN_WARRANTY is defined here as a single constant
 * to change once, rather than guessed at in several places.
 *
 * @param {*} end   Warranty_End_Date
 * @param {Date} [today]
 */
const EXPIRED      = 'Warranty Expired';
const IN_WARRANTY  = 'In Warranty';        // <- confirm against the sheet
const NO_WARRANTY  = '';

function warrantyStatus(end, today = new Date()) {
  const e = parseDate(end);
  if (!e) return NO_WARRANTY;

  /*  Compared date-to-date, not timestamp-to-timestamp. A warranty ending
      today is still valid for the whole of today.                        */
  const t = new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return e.getTime() < t.getTime() ? EXPIRED : IN_WARRANTY;
}

/**
 * Fill both derived columns on a row about to be written.
 *
 * @param {object} row       the sheet row
 * @param {object} cols      column names, so the same code serves Projects
 *                           and Tickets
 * @returns {object} a new row — nothing is mutated
 */
function applyWarranty(row = {}, cols = {}) {
  const {
    start  = 'Warranty_Start_Date',
    period = 'Warranty_Period',
    end    = 'Warranty_End_Date',
    status = 'Warranty_Status',
  } = cols;

  /*  Only recompute when there is something to compute from. A PATCH that
      never touched the warranty fields must not blank them.              */
  if (row[start] === undefined && row[period] === undefined) return row;

  const out = { ...row };
  const computed = warrantyEndDate(out[start], out[period]);
  if (computed) {
    out[end]    = computed;
    out[status] = warrantyStatus(computed);
  }
  return out;
}

/** Column sets for the two tabs that carry warranty columns. */
const PROJECT_COLS = {
  start: 'Warranty_Start_Date', period: 'Warranty_Period',
  end  : 'Warranty_End_Date',   status: 'Warranty_Status',
};
const TICKET_COLS = {
  start: 'Ticket_Warranty_Start_Date', period: 'Ticket_Warranty_Period',
  end  : 'Ticket_Warranty_End_Date',   status: 'Ticket_Warranty_Status',
};

module.exports = {
  parseDate, toISODate,
  warrantyEndDate, warrantyStatus, applyWarranty,
  PROJECT_COLS, TICKET_COLS,
  EXPIRED, IN_WARRANTY,
};