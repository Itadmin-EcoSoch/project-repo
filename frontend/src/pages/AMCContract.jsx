/*  frontend/src/pages/AMCContract.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    One AMC contract and its visits — the level between the project and a single
    visit.

        Client → Project → AMC → THIS CONTRACT → Visit 1, Visit 2, Visit 3 …

    WHAT CHANGED FROM THE OLD VERSION
    It now reads /api/solarcare/contracts/:amcId instead of
    /api/amc-schedule/contracts/:id/visits. The old endpoint matched untagged
    AppSheet-era visits by AMC_Type alone, so a project with two Cleaning
    contracts (an original and a renewal) showed the same legacy visits under
    both, and the totals did not add up. The new endpoint assigns every visit to
    exactly one contract.

    Also new: visits are numbered, and the payment schedule is shown when the
    contract has one.
--------------------------------------------------------------------------- */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getContract, fmtDate, normalizeVisitStatus, visitStatusStyle,
         contractStatusStyle, normalizeContractStatus } from '../lib/solarcare';
import { Loading, ErrorBox } from './ProjectSolarCare';

export default function AMCContract() {
  const { amcId } = useParams();
  const navigate  = useNavigate();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tab, setTab]         = useState('visits');

  const load = useCallback(() => {
    setLoading(true);
    return getContract(amcId)
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message || 'Could not load the contract'))
      .finally(() => setLoading(false));
  }, [amcId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading label="Loading contract…" />;
  if (error)   return <ErrorBox message={error} onRetry={load} />;
  if (!data)   return null;

  const c   = data.contract;
  const pct = c.progress_pct ?? 0;
  const isInspection = /insp/i.test(String(c.amc_type || ''));

  return (
    <div style={{ background: 'var(--slate-100)', minHeight: '100%', paddingBottom: 60 }}>

      <div style={{ background: '#0f2c3f', padding: '18px 16px 20px' }}>
        <button
          onClick={() => c.project_id
            ? navigate(`/projects/${encodeURIComponent(c.project_id)}`)
            : navigate(-1)}
          style={{ background: 'none', border: 0, color: 'rgba(255,255,255,.75)',
                   fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
          ← Back to Project
        </button>

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.11em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' }}>
          AMC contract
        </div>
        <h1 style={{ margin: '5px 0 2px', fontSize: 20, fontWeight: 700, color: '#fff' }}>
          {isInspection ? '🔍' : '🧽'} {c.amc_type || 'AMC'}
        </h1>
        {c.project_name && (
          <div style={{ fontSize: 12, marginTop: 1 }}>
            {c.project_id
              ? <span onClick={() => navigate(`/projects/${encodeURIComponent(c.project_id)}`)}
                      style={{ color: '#7dd3fc', cursor: 'pointer', textDecoration: 'underline' }}>
                  {c.project_name}
                </span>
              : <span style={{ color: 'rgba(255,255,255,.7)' }}>{c.project_name}</span>}
          </div>
        )}
        {c.client_name && (
          <div style={{ fontSize: 11.5, marginTop: 2 }}>
            👤 {c.client_id
              ? <span onClick={() => navigate(`/clients/${encodeURIComponent(c.client_id)}`)}
                      style={{ color: '#7dd3fc', cursor: 'pointer', textDecoration: 'underline' }}>
                  {c.client_name}
                </span>
              : <span style={{ color: 'rgba(255,255,255,.5)' }}>{c.client_name}</span>}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5,
                        color: 'rgba(255,255,255,.85)', marginBottom: 5 }}>
            <span>
              <b>{data.completed_visits}</b> of <b>{data.total_visits}</b> visits completed
            </span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.18)' }}>
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3,
                          background: '#22c55e', transition: 'width .3s' }} />
          </div>
        </div>
      </div>

      {/* terms — labels mirror the AppSheet contract form, keyed to the AMC type.
          Rendered as a real 2-column table so every value lines up in one
          column regardless of how long each label is.                       */}
      <div className="detail-section">
        <div className="detail-section-title">📄 Contract terms</div>
        {(() => {
          const t = String(c.amc_type || 'AMC').trim();               // "Cleaning" / "Inspection"
          const paysYes = /^(y|yes|true)$/i.test(String(c.payment_available || ''));
          const fileVal = c.contract_file && (c.contract_file.download || c.contract_file.view)
            ? <a href={c.contract_file.download || c.contract_file.view}
                 target="_blank" rel="noopener noreferrer"
                 style={{ color: 'var(--brand, #0f766e)', fontWeight: 600,
                          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                📄 {c.contract_file.name || 'Open file'}
              </a>
            : (c.contract_file && c.contract_file.name
                ? <span title="File is recorded but could not be resolved from Drive">📄 {c.contract_file.name}</span>
                : '—');
          const rows = [
            [`How many ${t} visits every year?`, c.frequency],
            ['For how many years?',              c.period_years],
            ['Total visits',                     data.total_visits],
            [`Start Date of ${t} Contract`,      fmtDate(c.start_date)],
            [`End Date of ${t} Contract`,        fmtDate(c.end_date)],
            ['Status of contract',
              (() => { const st = contractStatusStyle(c.status); return (
                <span style={{ background: st.bg, color: st.fg, borderRadius: 8,
                               padding: '3px 10px', fontSize: 11.5, fontWeight: 700,
                               display: 'inline-block' }}>
                  {normalizeContractStatus(c.status)}
                </span>); })()],
            [`Are periodic payments available for this ${t} contract?`,
              paysYes ? `Yes · ${data.payments.length} instalment${data.payments.length === 1 ? '' : 's'}` : 'No'],
            /* renamed for the saved/view state, per request */
            ['Files related to the contract',    fileVal],
          ];
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <tbody>
                {rows.map(([label, value], i) => (
                  <tr key={i} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--slate-50)' : 'none' }}>
                    {/*  width:1% + nowrap shrinks the label column to its widest
                        label, so values sit right next to their labels.       */}
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)',
                                 fontWeight: 500, verticalAlign: 'top',
                                 width: '1%', whiteSpace: 'nowrap', paddingRight: 28 }}>
                      {label}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-head)',
                                 fontWeight: 500, verticalAlign: 'top', wordBreak: 'break-word' }}>
                      {value === null || value === undefined || value === '' ? '—'
                        : (typeof value === 'object' ? value : String(value))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>

      {/* visits / payments */}
      <div className="detail-section">
        <div style={{ display: 'flex', borderBottom: '1px solid var(--slate-100)' }}>
          {[['visits', `Visits (${data.total_visits})`],
            ['payments', `Payments (${data.payments.length})`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ flex: 1, padding: '11px 8px', background: 'none', border: 'none',
                       borderBottom: `2px solid ${tab === key ? 'var(--brand)' : 'transparent'}`,
                       fontSize: 12, fontWeight: 700, cursor: 'pointer',
                       color: tab === key ? 'var(--brand)' : 'var(--text-muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'visits' && (
          data.visits.length === 0
            ? <div style={{ padding: 22, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No visits scheduled on this contract.
              </div>
            : data.visits.map(v => (
                <div key={v.task_id}
                     onClick={() => navigate(`/amc/visits/${encodeURIComponent(v.task_id)}`)}
                     style={{ padding: '11px 14px', borderBottom: '1px solid var(--slate-50)',
                              display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}>
                  {(() => {
                    const st  = normalizeVisitStatus(v.status);
                    const stl = visitStatusStyle(v.status);
                    const glyph = st === 'Done' ? '✓' : st === 'Skipped' ? '⊘' : v.visit_no;
                    return (<>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, fontWeight: 800,
                                    background: st === 'Pending' ? 'var(--slate-100)' : stl.bg,
                                    color: st === 'Pending' ? 'var(--text-muted)' : stl.fg }}>
                        {glyph}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-head)' }}>
                          {v.label}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                          Due {fmtDate(v.due_date)}
                        </div>
                      </div>
                      <span style={{ background: stl.bg, color: stl.fg, borderRadius: 8,
                                     padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>{st}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 15 }}>›</span>
                    </>);
                  })()}
                </div>
              ))
        )}

        {tab === 'payments' && (
          data.payments.length === 0
            ? <div style={{ padding: 22, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                This contract has no payment schedule.
              </div>
            : data.payments.map(p => (
                <div key={p.payment_id}
                     style={{ padding: '11px 14px', borderBottom: '1px solid var(--slate-50)',
                              display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 28, fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>
                    {p.payment_no}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-head)' }}>
                      ₹{Number(p.amount || 0).toLocaleString('en-IN')}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      Due {fmtDate(p.due_date)}
                    </div>
                  </div>
                  <span className={/paid/i.test(String(p.status)) ? 'badge-done' : 'badge-pending'}>
                    {p.status || 'Unpaid'}
                  </span>
                </div>
              ))
        )}
      </div>
    </div>
  );
}