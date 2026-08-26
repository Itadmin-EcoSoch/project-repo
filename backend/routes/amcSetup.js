/*  backend/routes/amcSetup.js  — NEW FILE
    ----------------------------------------------------------------------------
    The AMC half of Solar Care, set up from the project screen.

    The existing /api/amc-schedule routes still work exactly as before — this one
    sits beside them and adds the thing they could not do: create an Inspection
    contract AND a Cleaning contract for the same project in a single request,
    each with its own years / visits-per-year, each generating its own numbered
    visit schedule.

        POST /api/amc-setup/preview     show the visits, write nothing
        POST /api/amc-setup/create      write the contracts + visits + payments
        GET  /api/amc-setup/options     the dropdown values for the form

    Request body for both preview and create:

        {
          "project_id": "44d3cfd9",
          "amc_option": "Both",             // or "Inspection" / "Cleaning"
          "inspection": {
            "years": 3,                     // for how many years
            "visits_per_year": 4,           // per year, how many site visits
            "start_date": "2026-04-01",
            "payment_available": true,      // optional
            "payment_amount": 12000,
            "payment_frequency": 2,
            "percent_increase": 5
          },
          "cleaning": {
            "years": 3,
            "visits_per_year": 12,
            "start_date": "2026-04-01"
          }
        }

    With amc_option "Inspection" or "Cleaning" you may put the fields at the top
    level instead of inside a named block — both shapes are accepted.
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const amcCreate = require('../lib/amcCreate');
const amc       = require('../lib/amcSchedule');

/* ── GET /options ────────────────────────────────────────────────────────
   Everything the form needs to render, so the frequency vocabulary lives in
   one place instead of being retyped in React.                            */
router.get('/options', (_req, res) => {
  res.json({ success: true, data: {
    amc_options: [
      { value: 'Inspection', label: 'Inspection only',
        hint: 'Periodic health check of the plant' },
      { value: 'Cleaning',   label: 'Cleaning only',
        hint: 'Periodic module cleaning' },
      { value: 'Both',       label: 'Inspection + Cleaning',
        hint: 'Creates two separate contracts on this project' },
    ],
    /* visits per year, with the plain-English label for each */
    visit_frequencies: amc.AMC_FREQUENCIES.map(f => ({
      value: f, label: `${f} visit${f > 1 ? 's' : ''} / year`,
      note : amc.FREQUENCY_LABELS[f] || '',
    })),
    payment_frequencies: amc.PAYMENT_FREQUENCIES,
    /* which payment frequencies are legal for a given visit frequency */
    payment_frequency_by_visits: amc.PAYMENT_FREQ_BY_AMC,
    payment_frequency_error    : amc.PAYMENT_FREQUENCY_ERROR,
    statuses: ['Active', 'On Hold', 'Completed', 'Cancelled'],
  }});
});

/* ── POST /preview ───────────────────────────────────────────────────────
   Derives both schedules and hands back the full numbered visit list without
   touching the sheet. Show this to the user before they commit — 12 visits a
   year over 3 years is 36 rows, and it is much cheaper to spot a wrong start
   date here than to delete 36 rows afterwards.                             */
router.post('/preview', async (req, res, next) => {
  try {
    const data = await amcCreate.previewSolarCareAMC(req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/* ── POST /create ────────────────────────────────────────────────────────
   Writes, in this order, per contract:
       1. the AMC_Contracts row
       2. its AMC_Payment_Schedule rows   (so visits can reference them)
       3. its AMC_Tasks_Schedule rows     (the visits)
   then stamps AMC_Type back onto the project.                             */
router.post('/create', async (req, res, next) => {
  try {
    const data = await amcCreate.createSolarCareAMC(req.body);
    res.status(201).json({
      success: true,
      message: `${data.contracts.length} AMC contract${data.contracts.length > 1 ? 's' : ''} created ` +
               `with ${data.total_visits} visits.`,
      data,
    });
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({
        success: false, error: err.message, details: err.details || null,
      });
    }
    next(err);
  }
});

module.exports = router;