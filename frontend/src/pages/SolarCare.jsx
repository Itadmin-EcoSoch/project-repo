/*  frontend/src/pages/SolarCare.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    The top of the hierarchy — the screen that makes the parent/child structure
    visible in one place.

        CLIENT → Project → { Tickets, AMC } → Visits

    Two routes share this file:
        /solar-care                     the client list, with roll-up counts
        /solar-care/clients/:clientId   one client expanded into its projects

    Expanding a client shows every project it owns, and under each project the
    ticket count and the AMC contracts with their visit progress. Tapping a
    project opens its Solar Care hub.
--------------------------------------------------------------------------- */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listSolarCareClients, getClientTree, fmtDate } from '../lib/solarcare';
import { useDebounce } from '../hooks/useDebounce';
import { Loading, ErrorBox } from './ProjectSolarCare';

/* ═══════════════════════ client list ═══════════════════════ */

export default function SolarCare() {
  const navigate = useNavigate();
  const [q, setQ]             = useState('');
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [withWorkOnly, setWithWorkOnly] = useState(false);
  const debQ = useDebounce(q, 250);

  const load = useCallback(() => {
    setLoading(true);
    return listSolarCareClients(debQ)
      .then(d => { setRows(d || []); setError(null); })
      .catch(e => setError(e.message || 'Could not load clients'))
      .finally(() => setLoading(false));
  }, [debQ]);

  useEffect(() => { load(); }, [load]);

  const shown = withWorkOnly
    ? rows.filter(r => r.tickets_open > 0 || r.amc_contracts > 0)
    : rows;

  return (
    <div style={{ background: 'var(--white)', minHeight: '100%' }}>

      <div style={{ padding: '12px 16px', background: 'var(--white)',
                    borderBottom: '1px solid var(--slate-200)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--slate-100)',
                      border: '1.5px solid var(--slate-200)', borderRadius: 12, padding: '0 14px', height: 42 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
               strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Find a client…"
                 style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13,
                          fontFamily: 'inherit', color: 'var(--text-head)', outline: 'none' }} />
          {q && <button onClick={() => setQ('')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer',
                                 color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>×</button>}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10,
                        fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={withWorkOnly}
                 onChange={e => setWithWorkOnly(e.target.checked)} />
          Only clients with open tickets or an AMC
        </label>
      </div>

      {loading && <Loading label="Loading clients…" />}
      {!loading && error && <ErrorBox message={error} onRetry={load} />}

      {!loading && !error && (
        <>
          <div style={{ padding: '9px 16px', fontSize: 11, fontWeight: 600,
                        color: 'var(--text-muted)', background: 'var(--slate-50)',
                        borderBottom: '1px solid var(--slate-200)' }}>
            {shown.length} client{shown.length === 1 ? '' : 's'}
          </div>

          {shown.length === 0 && (
            <div style={{ padding: '48px 24px', textAlign: 'center',
                          color: 'var(--text-muted)', fontSize: 13 }}>
              No clients match that.
            </div>
          )}

          {shown.map(c => (
            <div key={c.id} className="list-item"
                 onClick={() => navigate(`/solar-care/clients/${encodeURIComponent(c.id)}`)}>
              <div className="item-avatar"
                   style={{ background: 'var(--brand-l)', color: 'var(--brand-d)',
                            fontSize: 13, fontWeight: 700 }}>
                {(c.name || '?')[0].toUpperCase()}
              </div>
              <div className="item-body">
                <div className="item-name">{c.name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <Tag>{c.projects_count} project{c.projects_count === 1 ? '' : 's'}</Tag>
                  {c.tickets_open > 0 && <Tag tone="warn">{c.tickets_open} open ticket{c.tickets_open === 1 ? '' : 's'}</Tag>}
                  {c.amc_contracts > 0 && <Tag tone="info">{c.amc_contracts} AMC</Tag>}
                  {c.pending_visits > 0 && <Tag>{c.pending_visits} visits due</Tag>}
                </div>
              </div>
              <span style={{ color: 'var(--slate-300)', fontSize: 16 }}>›</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════ one client, expanded ═══════════════════════ */

export function ClientSolarCare() {
  const { clientId } = useParams();
  const navigate     = useNavigate();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [open, setOpen]       = useState({});      // projectId -> expanded?

  const load = useCallback(() => {
    setLoading(true);
    return getClientTree(clientId)
      .then(d => {
        setData(d);
        setError(null);
        /* one project? open it — nobody wants to tap twice for a single row */
        if (d?.projects?.length === 1) setOpen({ [d.projects[0].id]: true });
      })
      .catch(e => setError(e.message || 'Could not load this client'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading label="Loading client…" />;
  if (error)   return <ErrorBox message={error} onRetry={load} />;
  if (!data)   return null;

  const { client, projects, totals } = data;

  return (
    <div style={{ background: 'var(--slate-100)', minHeight: '100%', paddingBottom: 40 }}>

      <div style={{ background: 'var(--slate-900)', padding: '18px 16px 20px',
                    position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -20, right: -20, width: 120, height: 120,
                      borderRadius: '50%', background: 'rgba(0,135,90,.12)' }} />
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,.45)' }}>
          Client
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginTop: 4 }}>{client.name}</div>
        {client.phone && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 3 }}>{client.phone}</div>
        )}

        <div style={{ display: 'flex', gap: 16, marginTop: 15, flexWrap: 'wrap' }}>
          <Stat n={projects.length}         label={`project${projects.length === 1 ? '' : 's'}`} />
          <Stat n={totals.tickets_open}     label="open tickets" />
          <Stat n={totals.amc_contracts}    label="AMC contracts" />
          <Stat n={totals.pending_visits}   label="visits due" />
        </div>
      </div>

      {projects.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          This client has no projects yet.
          <div style={{ marginTop: 14 }}>
            <button onClick={() => navigate(`/clients/${encodeURIComponent(clientId)}/add-project`)}
              style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 9,
                       padding: '9px 20px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              Add the first project
            </button>
          </div>
        </div>
      )}

      {projects.map(p => {
        const expanded = !!open[p.id];
        return (
          <div key={p.id} className="detail-section" style={{ overflow: 'hidden' }}>

            {/* project header — tap to expand, tap the arrow to open the hub */}
            <div onClick={() => setOpen(o => ({ ...o, [p.id]: !o[p.id] }))}
                 style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px',
                          cursor: 'pointer', background: 'var(--white)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 12,
                             transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                ▶
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-head)' }}>{p.name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                  {p.area && <Tag>{p.area}</Tag>}
                  {p.size_kwp && <Tag>{p.size_kwp} kWp</Tag>}
                  <Tag tone={p.tickets.open ? 'warn' : undefined}>
                    {p.tickets.total} ticket{p.tickets.total === 1 ? '' : 's'}
                  </Tag>
                  <Tag tone={p.amc.count ? 'info' : undefined}>
                    {p.amc.count ? `${p.amc.count} AMC` : 'No AMC'}
                  </Tag>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation();
                                      navigate(`/projects/${encodeURIComponent(p.id)}/solar-care`); }}
                      style={{ background: 'var(--white)', border: '1.5px solid var(--slate-300)',
                               borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700,
                               color: 'var(--text-body)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Open
              </button>
            </div>

            {expanded && (
              <div style={{ background: 'var(--slate-50)', borderTop: '1px solid var(--slate-100)' }}>

                {/* tickets */}
                <SubHead
                  icon="🎫" title="Ticket Generation"
                  right={`${p.tickets.open} open · ${p.tickets.total} total`}
                  onAdd={() => navigate(`/projects/${encodeURIComponent(p.id)}/tickets/new`)} />

                {p.tickets.total === 0
                  ? <Muted>No tickets yet</Muted>
                  : p.tickets.recent.map(t => (
                      <div key={t.id} onClick={() => navigate(`/tickets/${encodeURIComponent(t.id)}`)}
                           style={subRow}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
                                       width: 20, flexShrink: 0 }}>#{t.ticket_no}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text-head)',
                                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.description || t.type || t.label}
                        </span>
                        <span className={t.is_closed ? 'badge-done' : 'badge-pending'}>{t.status}</span>
                      </div>
                    ))}

                {p.tickets.total > p.tickets.recent.length && (
                  <div style={{ ...subRow, cursor: 'pointer', color: 'var(--brand)' }}
                       onClick={() => navigate(`/projects/${encodeURIComponent(p.id)}/solar-care`)}>
                    <span style={{ fontSize: 11.5, fontWeight: 700 }}>
                      View all {p.tickets.total} tickets →
                    </span>
                  </div>
                )}

                {/* AMC */}
                <SubHead
                  icon="🔧" title="AMC"
                  right={p.amc.count
                    ? `${p.amc.pending_visits} of ${p.amc.total_visits} visits pending`
                    : 'none'}
                  onAdd={() => navigate(`/projects/${encodeURIComponent(p.id)}/amc/new`)} />

                {p.amc.count === 0
                  ? <Muted>No AMC contract</Muted>
                  : p.amc.list.map(c => (
                      <div key={c.amc_id}
                           onClick={() => navigate(`/amc/contracts/${encodeURIComponent(c.amc_id)}`)}
                           style={subRow}>
                        <span style={{ fontSize: 13, width: 20, flexShrink: 0 }}>
                          {/insp/i.test(c.amc_type) ? '🔍' : '🧽'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-head)' }}>
                            {c.amc_type}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                            {c.frequency}/year · {c.period_years}y ·{' '}
                            {c.completed_visits}/{c.total_visits} done
                            {c.next_visit_date ? ` · next ${fmtDate(c.next_visit_date)}` : ''}
                          </div>
                        </div>
                        <span style={{ color: 'var(--slate-300)', fontSize: 14 }}>›</span>
                      </div>
                    ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────── */

const subRow = {
  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px 9px 30px',
  borderTop: '1px solid var(--slate-100)', cursor: 'pointer', background: 'var(--white)',
};

function SubHead({ icon, title, right, onAdd }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
                  background: 'var(--slate-50)', borderTop: '1px solid var(--slate-100)' }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-head)',
                     textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</span>
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>{right}</span>
      {onAdd && (
        <button onClick={e => { e.stopPropagation(); onAdd(); }}
                style={{ background: 'var(--white)', border: '1px solid var(--slate-300)',
                         borderRadius: 6, width: 22, height: 22, fontSize: 13, lineHeight: 1,
                         color: 'var(--text-body)', cursor: 'pointer', padding: 0 }}>
          +
        </button>
      )}
    </div>
  );
}

function Muted({ children }) {
  return (
    <div style={{ padding: '10px 14px 10px 30px', fontSize: 11.5, color: 'var(--text-muted)',
                  background: 'var(--white)', borderTop: '1px solid var(--slate-100)' }}>
      {children}
    </div>
  );
}

function Tag({ children, tone }) {
  const tones = {
    warn: { bg: '#FEF3C7', fg: '#92400E' },
    info: { bg: '#EDE9FE', fg: '#5B21B6' },
  };
  const t = tones[tone] || { bg: 'var(--slate-100)', fg: 'var(--text-muted)' };
  return (
    <span style={{ background: t.bg, color: t.fg, borderRadius: 20, padding: '2px 8px',
                   fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Stat({ n, label }) {
  return (
    <div>
      <div style={{ fontSize: 19, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{n ?? 0}</div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', marginTop: 3 }}>{label}</div>
    </div>
  );
}