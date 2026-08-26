/*  frontend/src/pages/AMCVisit.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    A single AMC visit — the deepest node in the tree.

        Client → Project → AMC → Contract → THIS VISIT

    WHAT CHANGED FROM THE OLD VERSION
    The old page was read-only and displayed raw sheet column names, so a
    completed visit could never be recorded and the progress bars upstream never
    moved. This one lets you set the status and write a resolution, which is what
    makes "3 of 12 visits completed" mean anything.
--------------------------------------------------------------------------- */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { updateVisit, isVisitDone, fmtDate, VISIT_STATUSES } from '../lib/solarcare';
import { Loading, ErrorBox } from './ProjectSolarCare';
import { SSelect, STextarea, Field } from './formKit';

export default function AMCVisit() {
  const { taskId } = useParams();
  const navigate   = useNavigate();

  const [visit, setVisit]   = useState(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState(null);
  const [saving, setSaving] = useState(false);

  const [status, setStatus]         = useState('');
  const [resolution, setResolution] = useState('');

  const load = useCallback(() => {
    setLoad(true);
    return api.get(`/api/amc-schedule/visits/${encodeURIComponent(taskId)}`)
      .then(r => {
        const v = r?.data ?? r;
        setVisit(v);
        setStatus(v.status || 'Scheduled');
        setResolution(v.resolution || '');
        setError(null);
      })
      .catch(e => setError(e.message || 'Could not load the visit'))
      .finally(() => setLoad(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const dirty = visit && (status !== (visit.status || 'Scheduled') ||
                          resolution !== (visit.resolution || ''));

  async function save() {
    setSaving(true);
    try {
      await updateVisit(taskId, { status, resolution });
      toast.success(isVisitDone(status) ? 'Visit marked done' : 'Visit updated');
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally { setSaving(false); }
  }

  if (loading) return <Loading label="Loading visit…" />;
  if (error)   return <ErrorBox message={error} onRetry={load} />;
  if (!visit)  return null;

  const done = isVisitDone(visit.status);

  return (
    <div style={{ background: 'var(--slate-100)', minHeight: '100%', paddingBottom: 90 }}>

      <div style={{ background: '#0f2c3f', padding: '18px 16px 20px' }}>
        <button
          onClick={() => visit.amc_id
            ? navigate(`/amc/contracts/${encodeURIComponent(visit.amc_id)}`)
            : navigate(-1)}
          style={{ background: 'none', border: 0, color: 'rgba(255,255,255,.75)',
                   fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
          ← Back to contract
        </button>

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.11em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' }}>
          {visit.amc_type || 'AMC'} visit
        </div>
        <h1 style={{ margin: '5px 0 0', fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.35 }}>
          {visit.description || 'AMC visit'}
        </h1>
        {visit.project_name && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginTop: 4 }}>
            {visit.project_name}
          </div>
        )}

        <span style={{ display: 'inline-block', marginTop: 12, padding: '3px 11px',
                       borderRadius: 11, fontSize: 11, fontWeight: 700, color: '#fff',
                       background: done ? '#22c55e' : 'var(--amber)' }}>
          {visit.status || 'Scheduled'}
        </span>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">✅ Record this visit</div>

        <Field label="Status">
          <SSelect value={status} onChange={e => setStatus(e.target.value)} options={VISIT_STATUSES} />
        </Field>

        <Field label="What was done">
          <STextarea value={resolution} onChange={e => setResolution(e.target.value)}
                     placeholder="Readings taken, panels cleaned, faults found — whatever the client should see" />
        </Field>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">📋 Visit details</div>
        {[
          ['Due date',    fmtDate(visit.due_date)],
          ['AMC type',    visit.amc_type],
          ['Contract',    visit.amc_id],
          ['Visit ID',    visit.task_id || taskId],
          ['Report',      visit.report],
        ].map(([label, value]) => (
          <div key={label} className="detail-row">
            <div className="d-label">{label}</div>
            <div className="d-value" style={{ wordBreak: 'break-word' }}>{value || '—'}</div>
          </div>
        ))}
      </div>

      {dirty && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff',
                      borderTop: '1px solid var(--slate-200)', padding: '10px 16px',
                      display: 'flex', gap: 10, boxShadow: '0 -4px 20px rgba(0,0,0,.07)' }}>
          <button onClick={load}
                  style={{ flex: 1, height: 44, borderRadius: 11, border: '1.5px solid var(--slate-200)',
                           background: '#fff', fontSize: 13, fontWeight: 700,
                           color: 'var(--text-body)', cursor: 'pointer' }}>
            Discard
          </button>
          <button onClick={save} disabled={saving}
                  style={{ flex: 2, height: 44, borderRadius: 11, border: 'none',
                           background: saving ? '#94a3b8' : 'var(--brand)', color: '#fff',
                           fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save visit'}
          </button>
        </div>
      )}
    </div>
  );
}