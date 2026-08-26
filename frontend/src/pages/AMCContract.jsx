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
import { getContract, fmtDate } from '../lib/solarcare';
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
            ? navigate(`/projects/${encodeURIComponent(c.project_id)}/solar-care`)
            : navigate(-1)}
          style={{ background: 'none', border: 0, color: 'rgba(255,255,255,.75)',
                   fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
          ← Back to Solar Care
        </button>

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.11em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' }}>
          AMC contract
        </div>
        <h1 style={{ margin: '5px 0 2px', fontSize: 20, fontWeight: 700, color: '#fff' }}>
          {isInspection ? '🔍' : '🧽'} {c.amc_type || 'AMC'}
        </h1>
        {c.project_name && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{c.project_name}</div>
        )}
        {c.client_name && (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
            👤 {c.client_name}
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

      {/* terms */}
      <div className="detail-section">
        <div className="detail-section-title">📄 Contract terms</div>
        {[
          ['Visits per year',   c.frequency],
          ['For how many years', c.period_years],
          ['Total visits',      data.total_visits],
          ['Start date',        fmtDate(c.start_date)],
          ['Last visit',        fmtDate(c.end_date)],
          ['Status',            c.status],
          ['Payments',          /^(y|yes|true)$/i.test(String(c.payment_available || ''))
                                  ? `Yes · ${data.payments.length} instalments` : 'No'],
        ].map(([label, value]) => (
          <div key={label} className="detail-row">
            <div className="d-label">{label}</div>
            <div className="d-value">
              {value === null || value === undefined || value === '' ? '—' : String(value)}
            </div>
          </div>
        ))}
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
                  <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11, fontWeight: 800,
                                background: v.is_done ? '#DCFCE7' : 'var(--slate-100)',
                                color: v.is_done ? '#15803D' : 'var(--text-muted)' }}>
                    {v.is_done ? '✓' : v.visit_no}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-head)' }}>
                      {v.label}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      Due {fmtDate(v.due_date)}
                    </div>
                  </div>
                  <span className={v.is_done ? 'badge-done' : 'badge-pending'}>{v.status}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 15 }}>›</span>
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