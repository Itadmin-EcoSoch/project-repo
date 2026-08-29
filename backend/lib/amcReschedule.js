/*  backend/lib/amcReschedule.js
    ----------------------------------------------------------------------------
    Keeps an AMC contract's visit schedule consistent after one visit's due date
    is edited by hand.

    Rule (as requested):
      If a visit's due date is moved to a date >= the NEXT visit's due date, the
      next visit and every visit after it are pushed forward so they stay one
      frequency-interval apart, anchored on the edited visit's new date. Then, if
      the last visit now falls past the contract's end date, the contract end
      date grows to match the last visit.

    Visits moved EARLIER (no collision with the next visit) are left alone, and
    the contract end date is only ever grown, never shrunk.

    Spacing mirrors how the schedule was originally generated in amcSchedule.js:
    a clean 12/frequency-month step (fortnightly, 24/yr, alternates +14 days).
--------------------------------------------------------------------------- */

const { addMonths, parseDate, toISO } = require('./amcSchedule');

const s      = v => String(v ?? '').trim();
const num    = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

/*  Pull the "- N" index out of "Cleaning Visit - 3" so ties on due date (two
    visits generated for the same day) still order by their real sequence.   */
function seqOf(task) {
  const m = s(task.AMC_Description).match(/-\s*(\d+)\s*$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * Work out which visit rows must move after an edit, and whether the contract
 * end date needs to grow. Pure — it computes, it does not write.
 *
 * @param {object}   contract  raw amc_contracts row (AMC_Frequency, AMC_End_Date)
 * @param {object[]} siblings  raw amc_tasks rows for this contract
 * @param {string}   editedId  AMC_Task_Id of the edited visit
 * @param {string}   oldDue    its due date BEFORE the edit (for ordering)
 * @param {string}   newDue    its due date AFTER the edit
 * @returns {{ updates: {id:string,due_date:string}[], newContractEnd: string|null }}
 */
function planReschedule(contract, siblings, editedId, oldDue, newDue) {
  const out = { updates: [], newContractEnd: null };
  const frequency = num(contract.AMC_Frequency);
  const newDueDate = parseDate(newDue);
  if (!newDueDate) return out;

  const fortnightly    = frequency === 24;
  const intervalMonths = fortnightly ? 1 : (frequency > 0 ? 12 / frequency : 0);

  /*  Order visits by their PRE-edit due date (the edited one uses oldDue), so
      "subsequent" means the visits that originally came after it.           */
  const ordered = siblings
    .map(t => ({
      row: t,
      orderDate: s(t.AMC_Task_Id) === s(editedId) ? parseDate(oldDue) : parseDate(t.AMC_Due_Date),
      seq: seqOf(t),
    }))
    .sort((a, b) => {
      const av = a.orderDate ? a.orderDate.getTime() : Infinity;
      const bv = b.orderDate ? b.orderDate.getTime() : Infinity;
      return av - bv || a.seq - b.seq;
    });

  const editedIdx = ordered.findIndex(o => s(o.row.AMC_Task_Id) === s(editedId));
  if (editedIdx === -1) return out;

  /*  The effective due date of each visit once the edit is applied — used both
      for the cascade and for finding the final visit's date.                */
  const effective = ordered.map((o, i) =>
    i === editedIdx ? newDueDate : parseDate(o.row.AMC_Due_Date));

  const next = ordered[editedIdx + 1];
  const nextDate = next ? parseDate(next.row.AMC_Due_Date) : null;
  const collides = next && nextDate && newDueDate.getTime() >= nextDate.getTime();

  if (collides && intervalMonths > 0) {
    for (let j = editedIdx + 1; j < ordered.length; j++) {
      const p = j - editedIdx;                       // steps past the edited visit
      const due = fortnightly
        ? addDays(addMonths(newDueDate, Math.floor(p / 2)), (p % 2) * 14)
        : addMonths(newDueDate, Math.round(intervalMonths * p));
      effective[j] = due;
      out.updates.push({ id: s(ordered[j].row.AMC_Task_Id), due_date: toISO(due) });
    }
  }

  /*  Grow the contract end date if the final visit now lands past it. Only
      grow — a visit pulled earlier never shortens the contract.             */
  const lastDue = effective.reduce(
    (max, d) => (d && (!max || d.getTime() > max.getTime()) ? d : max), null);
  const currentEnd = parseDate(contract.AMC_End_Date);
  if (lastDue && (!currentEnd || lastDue.getTime() > currentEnd.getTime())) {
    out.newContractEnd = toISO(lastDue);
  }

  return out;
}

module.exports = { planReschedule };
