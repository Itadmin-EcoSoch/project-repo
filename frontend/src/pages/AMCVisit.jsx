/*  frontend/src/pages/AMCVisit.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    A single AMC visit — the deepest node in the tree.

        Client → Project → AMC → Contract → THIS VISIT

    Recordable fields: Status, What was done, Due date (dates can move), and the
    visit Report — a Drive file upload (max 2 MB) that can be viewed once set and
    replaced at any time from the same control.
--------------------------------------------------------------------------- */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { updateVisit, isVisitDone, VISIT_STATUSES, VISIT_STATUS_STYLE,
         normalizeVisitStatus, visitStatusStyle } from '../lib/solarcare';
import { Loading, ErrorBox } from './ProjectSolarCare';
import { SSelect, STextarea, Field, DateField } from './formKit';
import FileField from './FileField';

/*  Sheet dates come back in mixed shapes (yyyy-mm-dd, dd/mm/yyyy, an ISO
    datetime). DateField only understands yyyy-mm-dd, so normalise on the way in. */
function toISO(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2,'0')}-${String(dmy[1]).padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return '';
}

export default function AMCVisit() {
  const { taskId } = useParams();
  const navigate   = useNavigate();

  const [visit, setVisit]   = useState(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState(null);
  const [saving, setSaving] = useState(false);

  const [status, setStatus]         = useState('');
  const [resolution, setResolution] = useState('');
  const [dueDate, setDueDate]       = useState('');
  const [report, setReport]         = useState('');   // Drive path of the report file

  const load = useCallback(() => {
    setLoad(true);
    return api.get(`/api/amc-schedule/visits/${encodeURIComponent(taskId)}`)
      .then(r => {
        const v = r?.data ?? r;
        setVisit(v);
        setStatus(normalizeVisitStatus(v.status));
        setResolution(v.resolution || '');
        setDueDate(toISO(v.due_date));
        setReport(v.report || '');
        setError(null);
      })
      .catch(e => setError(e.message || 'Could not load the visit'))
      .finally(() => setLoad(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const dirty = visit && (
    status     !== normalizeVisitStatus(visit.status) ||
    resolution !== (visit.resolution || '') ||
    dueDate    !== toISO(visit.due_date) ||
    report     !== (visit.report || '')
  );

  async function save() {
    setSaving(true);
    try {
      await updateVisit(taskId, { status, resolution, due_date: dueDate, report });
      toast.success(isVisitDone(status) ? 'Visit marked done' : 'Visit updated');
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally { setSaving(false); }
  }

  /*  Jump to the previous / next visit on the same contract. Guards unsaved
      edits so an arrow tap does not silently discard a half-recorded visit. */
  function go(id) {
    if (!id) return;
    if (dirty && !window.confirm('Discard unsaved changes and move to the other visit?')) return;
    navigate(`/amc/visits/${encodeURIComponent(id)}`);
  }

  if (loading) return <Loading label="Loading visit…" />;
  if (error)   return <ErrorBox message={error} onRetry={load} />;
  if (!visit)  return null;


  const NavArrow = ({ side, id }) => {
    const enabled = Boolean(id);
    const label = side === 'left' ? 'Previous' : 'Next';
    return (
      <button
        onClick={() => go(id)}
        disabled={!enabled}
        aria-label={side === 'left' ? 'Previous visit' : 'Next visit'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 36, padding: '0 12px', borderRadius: 10,
          border: '1px solid var(--slate-200)', background: '#fff',
          fontSize: 12.5, fontWeight: 700,
          color: enabled ? 'var(--text-head)' : 'var(--slate-300)',
          cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.55,
        }}>
        {side === 'left' ? <>‹ {label}</> : <>{label} ›</>}
      </button>
    );
  };

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
                       borderRadius: 11, fontSize: 11, fontWeight: 700,
                       background: visitStatusStyle(visit.status).bg,
                       color: visitStatusStyle(visit.status).fg }}>
          {normalizeVisitStatus(visit.status)}
        </span>
      </div>

      {/* prev / next visit navigation, sitting above the form so it never
          overlaps the fields */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: 10, padding: '12px 16px 0' }}>
        <NavArrow side="left"  id={visit.prev_task_id} />
        {visit.visit_no && visit.visit_count
          ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>
              Visit {visit.visit_no} of {visit.visit_count}
            </span>
          : <span />}
        <NavArrow side="right" id={visit.next_task_id} />
      </div>

      <div className="detail-section">
        <div className="detail-section-title">✅ Record this visit</div>

        <Field label="Due date">
          <DateField value={dueDate} onChange={setDueDate} />
        </Field>

        <Field label="Status">
          <SSelect value={status} onChange={e => setStatus(e.target.value)}
                   options={VISIT_STATUSES} optionStyles={VISIT_STATUS_STYLE} />
        </Field>

        <Field label="What was done">
          <STextarea value={resolution} onChange={e => setResolution(e.target.value)}
                     placeholder="Readings taken, panels cleaned, faults found — whatever the client should see" />
        </Field>

        <Field label="Report">
          <FileField
            value={report}
            onChange={setReport}
            column="AMC_Task_Report"
            projectId={visit.project_id || ''}
            maxSizeMB={2}
            displayName={visit.report_file?.name}
            fileUrl={visit.report_file?.download || visit.report_file?.view || ''}
          />
        </Field>
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
