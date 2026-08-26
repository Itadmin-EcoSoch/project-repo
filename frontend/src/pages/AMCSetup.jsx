/*  frontend/src/pages/AMCSetup.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    Set up the AMC branch of Solar Care for one project.

        Client → Project → AMC → THIS → generates Visit 1, Visit 2, Visit 3 …

    Three choices, exactly as the client buys them:
        Inspection only        → 1 contract
        Cleaning only          → 1 contract
        Inspection + Cleaning  → 2 contracts, each with its own schedule

    For each contract you answer two questions — for how many years, and how many
    site visits per year — and the visit rows are generated from that. 4 visits a
    year for 3 years is 12 visits; the preview shows every one of them with its
    due date before anything is written to the sheet.

    Route: /projects/:id/amc/new
--------------------------------------------------------------------------- */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import FileField from './FileField';
import {
  previewAMC, createAMC, getProjectSolarCare,
  AMC_OPTIONS, VISIT_FREQUENCIES, PAYMENT_FREQ_BY_VISITS, fmtDate, amcEndDatePreview,
} from '../lib/solarcare';
import { Loading } from './ProjectSolarCare';
import { page, Card, Field, SInput, SSelect, SelectOrType, Footer, C, Row } from './formKit';

const today = () => new Date().toISOString().slice(0, 10);

/** The starting state for one contract block. */
const blankBlock = () => ({
  /*  Nothing pre-filled.

      Years, visits and the start date used to arrive as 1 / 4 / today, which
      meant a contract could be saved without anyone having chosen its terms —
      the form answered its own questions and the visit schedule was generated
      off values nobody read. validate() already refuses each of these when
      blank, so an empty start is safe as well as honest.

      Status stays out too; the backend applies 'Active' when none is sent, so
      the common case still costs no clicks.                              */
  years            : '',
  visits_per_year  : '',
  start_date       : '',
  status           : '',
  payment_available: false,
  payment_amount   : '',
  payment_frequency: 1,
  percent_increase : '',
  /*  The signed contract / quote / scan for THIS type. Per block, so an
      Inspection and a Cleaning contract on the same project each keep their
      own document. Written to AMC_Contracts.AMC_Contract_Files.        */
  contract_file    : '',
});

export default function AMCSetup() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject]   = useState(null);
  const [existing, setExisting] = useState({ has_inspection: false, has_cleaning: false });
  const [loading, setLoading]   = useState(true);

  const [option, setOption]     = useState('');           // Inspection | Cleaning | Both
  const [inspection, setInspection] = useState(blankBlock());
  const [cleaning, setCleaning]     = useState(blankBlock());

  const [preview, setPreview]   = useState(null);
  const [busy, setBusy]         = useState(false);
  const [showAll, setShowAll]   = useState({});           // amc_type -> show every visit?

  useEffect(() => {
    Promise.all([
      api.get(`/api/projects/${encodeURIComponent(projectId)}`).then(r => r?.data ?? r).catch(() => null),
      getProjectSolarCare(projectId).catch(() => null),
    ]).then(([p, sc]) => {
      setProject(p);
      if (sc?.amc) setExisting({ has_inspection: sc.amc.has_inspection, has_cleaning: sc.amc.has_cleaning });
      /* if one half already exists, default to the missing half */
      if (sc?.amc?.has_inspection && !sc?.amc?.has_cleaning) setOption('Cleaning');
      else if (sc?.amc?.has_cleaning && !sc?.amc?.has_inspection) setOption('Inspection');
    }).finally(() => setLoading(false));
  }, [projectId]);

  /* the option controls which blocks are sent — everything else follows from it */
  const wantsInspection = option === 'Inspection' || option === 'Both';
  const wantsCleaning   = option === 'Cleaning'   || option === 'Both';

  function payloadFor() {
    const out = { project_id: projectId, amc_option: option };
    if (wantsInspection) out.inspection = clean(inspection);
    if (wantsCleaning)   out.cleaning   = clean(cleaning);
    return out;
  }

  function clean(b) {
    return {
      years            : Number(b.years) || 0,
      visits_per_year  : Number(b.visits_per_year) || 0,
      start_date       : b.start_date,
      status           : b.status,
      payment_available: !!b.payment_available,
      payment_amount   : b.payment_available ? Number(b.payment_amount) || 0 : 0,
      payment_frequency: b.payment_available ? Number(b.payment_frequency) || 1 : 0,
      percent_increase : b.payment_available ? Number(b.percent_increase) || 0 : 0,
      /*  Sent only when something was actually attached, so a contract created
          without paperwork does not blank a file added later by hand.     */
      ...(b.contract_file ? { contract_file: b.contract_file } : {}),
    };
  }

  function validate() {
    if (!option) { toast.error('Choose Inspection, Cleaning, or both'); return false; }
    for (const [name, b, on] of [['Inspection', inspection, wantsInspection],
                                 ['Cleaning', cleaning, wantsCleaning]]) {
      if (!on) continue;
      if (!Number(b.years))           { toast.error(`${name}: how many years?`); return false; }
      if (!Number(b.visits_per_year)) { toast.error(`${name}: how many visits per year?`); return false; }
      if (!b.start_date)              { toast.error(`${name}: pick a start date`); return false; }
      if (b.payment_available && !Number(b.payment_amount)) {
        toast.error(`${name}: enter the payment amount`); return false;
      }
    }
    return true;
  }

  async function doPreview() {
    if (!validate()) return;
    setBusy(true);
    try {
      const d = await previewAMC(payloadFor());
      setPreview(d);
      if (!d.ok) toast.error('Fix the errors shown below');
    } catch (e) {
      toast.error(e.message || 'Could not build the schedule');
    } finally { setBusy(false); }
  }

  async function doCreate() {
    if (!validate()) return;
    if (!preview) { await doPreview(); return; }

    const n = preview.total_visits;
    if (!window.confirm(
      `Create ${preview.contracts.length} contract${preview.contracts.length > 1 ? 's' : ''} ` +
      `and ${n} visit${n === 1 ? '' : 's'} on this project?`)) return;

    setBusy(true);
    try {
      const d = await createAMC(payloadFor());
      toast.success(`${d.contracts.length} contract${d.contracts.length > 1 ? 's' : ''} created · ${d.total_visits} visits`);
      navigate(`/projects/${encodeURIComponent(projectId)}/solar-care`);
    } catch (e) {
      toast.error(e.message || 'Could not create the contracts');
    } finally { setBusy(false); }
  }

  if (loading) return <Loading label="Loading project…" />;

  return (
    <div style={page}>

      <div style={{ background: 'var(--slate-900)', padding: '15px 16px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,.45)' }}>
          Set up AMC
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginTop: 4 }}>
          {project?.name || projectId}
        </div>
        {project?.clients?.name && (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)', marginTop: 3 }}>
            👤 {project.clients.name}
          </div>
        )}
      </div>

      {/* ── 1. what did the client buy? ─────────────────────────────── */}
      <Card icon={<span style={{ fontSize: 15 }}>🔧</span>} title="What did the client take?" color={C.purple}>
        {/*  Three across rather than stacked. They are three alternatives to
             one question, and side by side they compare at a glance instead
             of costing most of a screen.

             The cards align to a common height and the hint sits under the
             label, so the three read as equals rather than a list.       */}
        <Row cols={3} className="ek-row-stretch" style={{ padding: '12px 16px', gap: 10 }}>
          {AMC_OPTIONS.map(o => {
            const already =
              (o.value === 'Inspection' && existing.has_inspection) ||
              (o.value === 'Cleaning'   && existing.has_cleaning)   ||
              (o.value === 'Both'       && existing.has_inspection && existing.has_cleaning);
            const active = option === o.value;
            return (
              <button key={o.value} onClick={() => { setOption(o.value); setPreview(null); }}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 10,
                         height: '100%',
                         padding: '13px 13px', borderRadius: 12, cursor: 'pointer',
                         background: active ? `${C.purple}0f` : '#fff',
                         border: `1.5px solid ${active ? C.purple : C.border}`,
                         transition: 'all .15s' }}>
                <span style={{ fontSize: 19 }}>{o.emoji}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700,
                                 color: active ? C.purple : C.text1 }}>
                    {o.label}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: C.text3, marginTop: 2 }}>
                    {already ? 'Already on this project — this would add another contract' : o.hint}
                  </span>
                </span>
                {active && <span style={{ color: C.purple, fontSize: 16, fontWeight: 800 }}>✓</span>}
              </button>
            );
          })}
        </Row>
      </Card>

      {/* ── 2. terms, one block per contract ────────────────────────── */}
      {wantsInspection && (
        <ContractBlock title="Inspection contract" emoji="🔍" color="#7c3aed"
                       kind="Inspection" projectId={projectId}
                       value={inspection} onChange={v => { setInspection(v); setPreview(null); }} />
      )}
      {wantsCleaning && (
        <ContractBlock title="Cleaning contract" emoji="🧽" color="#1d4ed8"
                       kind="Cleaning" projectId={projectId}
                       value={cleaning} onChange={v => { setCleaning(v); setPreview(null); }} />
      )}

      {/* ── 3. what will be created ─────────────────────────────────── */}
      {preview && (
        <Card icon={<span style={{ fontSize: 15 }}>📅</span>}
              title={`Schedule preview · ${preview.total_visits} visits`} color={C.success}>
          {preview.contracts.map(c => (
            <div key={c.amc_type} style={{ borderBottom: `1px solid ${C.surface}` }}>
              <div style={{ padding: '11px 16px 9px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text1 }}>
                  {c.amc_type} · {c.visit_count} visit{c.visit_count === 1 ? '' : 's'}
                  {c.payment_count ? ` · ${c.payment_count} payments` : ''}
                </div>
                <div style={{ fontSize: 11, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>
                  {c.visits.length > 0 && (
                    <>First visit {fmtDate(c.visits[0].due_date)} · last visit{' '}
                      {fmtDate(c.visits[c.visits.length - 1].due_date)}</>
                  )}
                </div>

                {c.errors?.map(e => (
                  <div key={e} style={{ fontSize: 11, color: C.danger, marginTop: 6 }}>⚠ {e}</div>
                ))}
                {c.warnings?.map(w => (
                  <div key={w} style={{ fontSize: 10.5, color: C.warning, marginTop: 6, lineHeight: 1.5 }}>
                    ⚠ {w}
                  </div>
                ))}
              </div>

              <div style={{ padding: '0 16px 12px' }}>
                {(showAll[c.amc_type] ? c.visits : c.visits.slice(0, 4)).map(v => (
                  <div key={v.visit_no}
                       style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0',
                                fontSize: 11.5, color: C.text2 }}>
                    <span style={{ width: 46, fontWeight: 700, color: C.text3 }}>
                      Visit {v.visit_no}
                    </span>
                    <span>{fmtDate(v.due_date)}</span>
                  </div>
                ))}
                {c.visits.length > 4 && (
                  <button onClick={() => setShowAll(s => ({ ...s, [c.amc_type]: !s[c.amc_type] }))}
                    style={{ background: 'none', border: 'none', color: C.accent, fontSize: 11.5,
                             fontWeight: 700, cursor: 'pointer', padding: '4px 0' }}>
                    {showAll[c.amc_type]
                      ? 'Show less'
                      : `Show all ${c.visits.length} visits`}
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      <div style={{ height: 8 }} />

      <Footer
        onSecondary={() => navigate(`/projects/${encodeURIComponent(projectId)}/solar-care`)}
        secondaryLabel="Cancel"
        onMiddle={doPreview}
        middleLabel={busy ? 'Working…' : 'Preview schedule'}
        middleColor={C.accent}
        middleDisabled={busy || !option}
        onPrimary={doCreate}
        primaryLabel={preview ? 'Create contracts' : 'Preview first'}
        primaryColor={C.success}
        disabled={busy || !option || (preview && !preview.ok)}
      />
    </div>
  );
}

/* ── one contract's terms ───────────────────────────────────────────── */

function ContractBlock({ title, emoji, color, value, onChange, projectId, kind }) {
  const set = (k, v) => onChange({ ...value, [k]: v });

  const allowedPaymentFreqs = PAYMENT_FREQ_BY_VISITS[Number(value.visits_per_year)] || [1];
  const totalVisits = (Number(value.years) || 0) * (Number(value.visits_per_year) || 0);

  return (
    <Card icon={<span style={{ fontSize: 15 }}>{emoji}</span>} title={title} color={color}>

      {/*  Six across now, not five — Contract End Date is new (see below).
           These five-turned-six ARE the contract — reading them as one row
           is the point; stacked they took a full screen of scrolling to
           answer what is really a single question.                        */}
      {/*  Three across, two rows — NOT six across. This app's grid CSS
          (formKit.jsx) only defines .ek-row-2 through .ek-row-5; cols={6}
          has no matching rule and silently falls back to the bare .ek-row
          default of ONE column, which is why this briefly rendered as six
          full-width stacked fields instead of a compact grid. Six fields
          divides evenly into two rows of three, which the existing
          .ek-row-3 rule already handles correctly.                        */}
      <Row cols={3} style={{ padding: '0 4px' }}>

      {/*  SelectOrType, not a plain closed dropdown — the ten years offered
          cover most contracts, but a client occasionally signs for something
          outside that range (e.g. 12 years), and typing it in directly beats
          being unable to enter the real number at all. Open to any user, not
          admin-gated: a one-off contract term doesn't need the central
          governance a new Inverter Brand or Project Type would.           */}
      <Field label="For how many years?" required>
        <SelectOrType value={value.years === '' ? '' : String(value.years)}
                 onChange={v => set('years', v === '' ? '' : Number(v))}
                 options={['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']}
                 addLabel="＋ Enter a different number"
                 typePlaceholder="Type the number of years"
                 placeholder="Select…" />
      </Field>

      <Field label="Per year, how many site visits?" required>
        <SelectOrType value={value.visits_per_year === '' ? '' : String(value.visits_per_year)}
                 onChange={v => set('visits_per_year', v === '' ? '' : Number(v))}
                 options={VISIT_FREQUENCIES.map(f => String(f.value))}
                 addLabel="＋ Enter a different number"
                 typePlaceholder="Type the number of visits"
                 placeholder="Select…" />
        {/*  Silent until BOTH years and frequency are chosen. It used to read
             "Quarterly — that is 4 visits in total" before the user had picked
             anything, describing a contract that did not exist yet.      */}
        {Number(value.visits_per_year) > 0 && (
          <div style={{ fontSize: 10.5, color: C.text3, marginTop: 6 }}>
            {VISIT_FREQUENCIES.find(f => f.value === Number(value.visits_per_year))?.note || ''}
            {totalVisits > 0 && (
              <> — that is <b style={{ color: color }}>{totalVisits} visits</b> in total</>
            )}
          </div>
        )}
      </Field>

      <Field label="Contract start date" required>
        <SInput type="date" value={value.start_date} onChange={e => set('start_date', e.target.value)} />
      </Field>

      {/*  Read-only — always Start Date + Years + Visits/year, calculated the
          same way backend/lib/amcSchedule.js will when the contract is
          actually created (see amcEndDatePreview in lib/solarcare.js), so
          this can never disagree with the real schedule a moment later.   */}
      <Field label="Contract end date">
        {(() => {
          const endDate = amcEndDatePreview(value.start_date, value.visits_per_year, value.years);
          return (
            <div style={{ padding: '11px 13px', background: C.surface, borderRadius: 10,
                          border: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600,
                          color: endDate ? C.text1 : C.text3, minHeight: 42,
                          display: 'flex', alignItems: 'center' }}>
              {endDate ? fmtDate(endDate) : 'Fills in once the fields to the left are set'}
            </div>
          );
        })()}
        <div style={{ fontSize: 10.5, color: C.text3, marginTop: 6, lineHeight: 1.5 }}>
          The date of the last scheduled visit.
        </div>
      </Field>

      {/*  Optional on purpose: the paperwork often arrives after the schedule
           is agreed, and making it required would block the visit rows from
           being generated on the day the client signs verbally.          */}
      <Field label="Attach contract / document">
        <FileField value={value.contract_file}
                   onChange={v => set('contract_file', v)}
                   column={`AMC_${kind}_Contract`}
                   projectId={projectId} />
      </Field>

      <Field label="Contract status">
        <SSelect value={value.status} onChange={e => set('status', e.target.value)}
                 options={['Active', 'On Hold', 'Completed', 'Cancelled']}
                 placeholder="Select…" />
      </Field>

      </Row>

      {/* payments are optional — plenty of AMCs are billed outside the app */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.surface}` }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!value.payment_available}
                 onChange={e => set('payment_available', e.target.checked)} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text1 }}>
            Generate a payment schedule too
          </span>
        </label>
      </div>

      {value.payment_available && (
        <Row cols={3} style={{ padding: '0 4px' }}>
          <Field label="Amount per payment" required>
            <SInput type="number" value={value.payment_amount}
                    onChange={e => set('payment_amount', e.target.value)}
                    placeholder="0" suffix="₹" />
          </Field>

          <Field label="Payments per year">
            <SSelect value={String(value.payment_frequency)}
                     onChange={e => set('payment_frequency', Number(e.target.value))}
                     options={allowedPaymentFreqs.map(String)} />
            <div style={{ fontSize: 10.5, color: C.text3, marginTop: 6, lineHeight: 1.5 }}>
              One payment can cover several visits, but one visit cannot be split
              across payments — so this cannot exceed the visit frequency.
            </div>
          </Field>

          <Field label="Increase per payment">
            <SInput type="number" value={value.percent_increase}
                    onChange={e => set('percent_increase', e.target.value)}
                    placeholder="0" suffix="%" />
            <div style={{ fontSize: 10.5, color: C.text3, marginTop: 6 }}>
              Compounds on every instalment. Leave blank for a flat amount.
            </div>
          </Field>
        </Row>
      )}
    </Card>
  );
}