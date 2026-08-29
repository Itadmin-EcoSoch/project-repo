/*  backend/lib/amcStatus.js
    ----------------------------------------------------------------------------
    One place that decides whether an AMC contract is finished, and keeps the
    AMC_Status column in step with that decision.

    A contract is COMPLETED when:
      - it has at least one visit, and every visit is done, AND
      - every payment on it (if any) is done.

    "Done" for a visit is the same rule the Solar Care screens already use
    (AMC_Task_Status contains "done" or "complete"). "Done" for a payment is
    Paid / Received / Settled / Done / Complete - deliberately NOT "Unpaid"
    (\bpaid\b does not match inside "unpaid").

    Only the AMC_Status VALUE is ever written - no new columns are created, so
    this is safe against the production sheet's frozen master tabs.
--------------------------------------------------------------------------- */

const s           = v => String(v ?? '').trim();
const visitDone   = v => /done|complete/i.test(s(v.AMC_Task_Status || v.Status));
/*  A visit no longer needs attention once it is Done OR Skipped — both count
    as "finished" for deciding whether the contract is complete. (visitDone
    stays Done-only, because the progress bar counts completed visits.)      */
const visitFinished = v => /done|complete|skip/i.test(s(v.AMC_Task_Status || v.Status));
const paymentDone = p =>
  /\b(paid|received|settled|done|complete)\b/i.test(s(p.Payment_Status || p.Status));

/** True when every visit is Done/Skipped and every payment is done. */
function contractComplete(visits = [], payments = []) {
  if (!visits.length) return false;                 // nothing scheduled yet
  if (!visits.every(visitFinished)) return false;
  if (payments.length && !payments.every(paymentDone)) return false;
  return true;
}

/** The status the contract SHOULD have, given its visits and payments.
 *  Completed when finished; otherwise Active - including flipping a stale
 *  "Completed" back to Active if a visit/payment was later reopened. */
function effectiveStatus(contract, visits = [], payments = []) {
  const stored = s(contract && (contract.AMC_Status || contract.status)) || 'Active';
  if (contractComplete(visits, payments)) return 'Completed';
  return /^completed$/i.test(stored) ? 'Active' : stored;
}

/** Recompute and, if it changed, persist AMC_Status for one contract.
 *  Returns the resulting status string. Never throws to the caller. */
async function syncContractStatus(db, amcId) {
  try {
    const id = s(amcId);
    if (!id) return null;
    const contract = await db.get('amc_contracts', id);
    if (!contract) return null;

    const [allTasks, allPayments] = await Promise.all([
      db.all('amc_tasks'), db.all('amc_payments'),
    ]);
    const visits   = allTasks.filter(t => s(t.AMC_Id) === id);
    const payments = allPayments.filter(p => s(p.AMC_Id) === id);

    const want = effectiveStatus(contract, visits, payments);
    if (want && want !== s(contract.AMC_Status)) {
      await db.update('amc_contracts', id, { AMC_Status: want });
    }
    return want;
  } catch {
    return null;                                     // status sync is best-effort
  }
}

module.exports = { visitDone, visitFinished, paymentDone, contractComplete, effectiveStatus, syncContractStatus };
