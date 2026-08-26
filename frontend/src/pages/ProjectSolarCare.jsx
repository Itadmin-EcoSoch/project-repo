/*  frontend/src/pages/ProjectSolarCare.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    The middle of the hierarchy, and the screen you will use most.

        Client → PROJECT → { Ticket Generation, AMC } → Visits

    One project, its two Solar Care operations side by side:

        🎫 Ticket Generation     Ticket 1, Ticket 2, Ticket 3 …
        🔧 AMC                   Inspection contract → visits
                                 Cleaning contract   → visits

    Route: /projects/:id/solar-care
--------------------------------------------------------------------------- */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getProjectSolarCare, fmtDate,
  TICKET_STATUS_COLOR, PRIORITY_COLOR,
} from '../lib/solarcare';

export default function ProjectSolarCare() {
  const { id }   = useParams();
  const navigate = useNavigate();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    return getProjectSolarCare(id)
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message || 'Could not load this project'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading label="Loading Solar Care…" />;
  if (error)   return <ErrorBox message={error} onRetry={load} />;
  if (!data)   return null;

  const { project, client, tickets, amc } = data;

  return (
    <div style={{ background: 'var(--slate-100)', minHeight: '100%', paddingBottom: 40 }}>

      {/* ── who / what ───────────────────────────────────────────────── */}
      <div style={{ background: 'var(--slate-900)', padding: '16px 16px 18px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -24, right: -24, width: 130, height: 130,
                      borderRadius: '50%', background: 'rgba(0,135,90,.12)' }} />
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
                      color: 'rgba(255,255,255,.45)' }}>Solar Care</div>

        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginTop: 5, lineHeight: 1.35 }}>
          {project.name}
        </div>

        {client && (
          <div
            onClick={() => client.id && navigate(`/solar-care/clients/${encodeURIComponent(client.id)}`)}
            style={{ fontSize: 11.5, color: 'rgba(255,255,255,.65)', marginTop: 4,
                     cursor: client.id ? 'pointer' : 'default',
                     textDecoration: client.id ? 'underline' : 'none' }}>
            👤 {client.name}
          </div>
        )}

        <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
          <HeroStat n={tickets.open}         label="open tickets" />
          <HeroStat n={amc.count}            label={`AMC contract${amc.count === 1 ? '' : 's'}`} />
          <HeroStat n={amc.pending_visits}   label="visits due" />
        </div>
      </div>

      {/* ── operation 1: Ticket Generation ───────────────────────────── */}
      <div className="detail-section">
        <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center' }}>
          🎫 Ticket Generation
          <span className="sec-count" style={{ marginLeft: 6 }}>{tickets.total}</span>
          <button
            onClick={() => navigate(`/projects/${encodeURIComponent(id)}/tickets/new`)}
            style={btnSmall}>
            + New ticket
          </button>
        </div>

        {tickets.total === 0 ? (
          <Empty
            text="No tickets raised on this project yet."
            action="Raise the first ticket"
            onClick={() => navigate(`/projects/${encodeURIComponent(id)}/tickets/new`)} />
        ) : (
          tickets.list.map(t => {
            const sc = TICKET_STATUS_COLOR[t.status] || TICKET_STATUS_COLOR.Open;
            const pc = PRIORITY_COLOR[t.priority] || PRIORITY_COLOR.Medium;
            return (
              <div key={t.id} onClick={() => navigate(`/tickets/${encodeURIComponent(t.id)}`)}
                   style={rowStyle}>
                <div style={{ ...numberChip, background: t.is_closed ? 'var(--slate-200)' : '#0f2c3f',
                              color: t.is_closed ? 'var(--text-muted)' : '#fff' }}>
                  {t.ticket_no}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-head)' }}>
                    {t.label}{t.type ? ` · ${t.type}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.description || 'No description'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Chip {...sc}>{t.status || 'Open'}</Chip>
                    {t.priority && <Chip {...pc}>{t.priority}</Chip>}
                    {t.due_date && <Chip bg="var(--slate-100)" fg="var(--text-muted)">
                      due {fmtDate(t.due_date)}
                    </Chip>}
                  </div>
                </div>
                <span style={chevron}>›</span>
              </div>
            );
          })
        )}
      </div>

      {/* ── operation 2: AMC ─────────────────────────────────────────── */}
      <div className="detail-section">
        <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center' }}>
          🔧 AMC
          <span className="sec-count" style={{ marginLeft: 6 }}>{amc.count}</span>
          <button
            onClick={() => navigate(`/projects/${encodeURIComponent(id)}/amc/new`)}
            style={btnSmall}>
            + Set up AMC
          </button>
        </div>

        {amc.count === 0 ? (
          <Empty
            text="No AMC contract on this project. Set one up to generate the visit schedule."
            action="Set up AMC"
            onClick={() => navigate(`/projects/${encodeURIComponent(id)}/amc/new`)} />
        ) : (
          <>
            {amc.list.map(c => (
              <div key={c.amc_id}
                   onClick={() => navigate(`/amc/contracts/${encodeURIComponent(c.amc_id)}`)}
                   style={{ ...rowStyle, alignItems: 'stretch', flexDirection: 'column', gap: 0 }}>

                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ ...numberChip, borderRadius: 9,
                                background: /insp/i.test(c.amc_type) ? '#EDE9FE' : '#DBEAFE',
                                color: /insp/i.test(c.amc_type) ? '#5B21B6' : '#1E40AF',
                                fontSize: 15 }}>
                    {/insp/i.test(c.amc_type) ? '🔍' : '🧽'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-head)' }}>
                      {c.amc_type}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      {c.frequency} visit{Number(c.frequency) === 1 ? '' : 's'}/year ·{' '}
                      {c.period_years} year{Number(c.period_years) === 1 ? '' : 's'}
                      {c.next_visit_date ? ` · next ${fmtDate(c.next_visit_date)}` : ''}
                    </div>
                  </div>

                  <span className={c.status === 'Active' ? 'badge-done' : 'badge-pending'}>
                    {c.status || '—'}
                  </span>
                  <span style={chevron}>›</span>
                </div>

                {/* how far through the schedule this contract is */}
                <div style={{ marginTop: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                                fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>
                      <b style={{ color: 'var(--text-head)' }}>{c.completed_visits}</b> of{' '}
                      <b style={{ color: 'var(--text-head)' }}>{c.total_visits}</b> visits done
                    </span>
                    <span>{c.pending_visits} pending</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--slate-200)' }}>
                    <div style={{ width: `${c.progress_pct}%`, height: '100%', borderRadius: 3,
                                  background: '#22c55e', transition: 'width .3s' }} />
                  </div>
                </div>
              </div>
            ))}

            {/*  Adding the missing half of a Both contract is the single most
                common follow-up, so it gets its own affordance rather than
                being buried in the setup form.                              */}
            {amc.count > 0 && !(amc.has_inspection && amc.has_cleaning) && (
              <div style={{ padding: '11px 14px', background: 'var(--slate-50)' }}>
                <button
                  onClick={() => navigate(`/projects/${encodeURIComponent(id)}/amc/new`)}
                  style={{ ...btnSmall, marginLeft: 0, width: '100%', height: 34 }}>
                  + Add {amc.has_inspection ? 'Cleaning' : 'Inspection'} contract
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '4px 16px 0' }}>
        <button onClick={() => navigate(`/projects/${encodeURIComponent(id)}`)} style={linkBtn}>
          ← Full project record
        </button>
      </div>
    </div>
  );
}

/* ── small pieces ──────────────────────────────────────────────────── */

const rowStyle = {
  padding: '12px 14px', borderBottom: '1px solid var(--slate-50)',
  display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer',
};

const numberChip = {
  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, fontWeight: 800,
};

const chevron = { color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 };

const btnSmall = {
  marginLeft: 'auto', background: 'var(--white)', border: '1.5px solid var(--slate-300)',
  borderRadius: 8, padding: '5px 11px', fontSize: 11, fontWeight: 700,
  color: 'var(--text-body)', cursor: 'pointer',
};

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--text-muted)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0',
};

function HeroStat({ n, label }) {
  return (
    <div>
      <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{n ?? 0}</div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

export function Chip({ bg, fg, children }) {
  return (
    <span style={{ background: bg, color: fg, borderRadius: 20, padding: '2px 8px',
                   fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Empty({ text, action, onClick }) {
  return (
    <div style={{ padding: '22px 18px', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{text}</div>
      {action && (
        <button onClick={onClick}
          style={{ marginTop: 12, background: 'var(--brand)', color: '#fff', border: 'none',
                   borderRadius: 9, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {action}
        </button>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: '55vh', gap: 13 }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--slate-200)',
                    borderTop: '3px solid var(--brand)', borderRadius: '50%',
                    animation: 'spin .8s linear infinite' }} />
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-head)', marginBottom: 6 }}>
        Could not load this
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
        {message}
      </div>
      {onRetry && (
        <button onClick={onRetry}
          style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 9,
                   padding: '9px 22px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          Try again
        </button>
      )}
    </div>
  );
}