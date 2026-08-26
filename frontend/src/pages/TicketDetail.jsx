/*  frontend/src/pages/TicketDetail.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    One ticket — the leaf of the Ticket Generation branch.

        Client → Project → Ticket Generation → THIS

    Read-only header, and the three fields that actually change while a ticket is
    being worked (status, progress note, resolution) editable in place. Everything
    else lives on the record and is shown for reference.

    Route: /tickets/:ticketId
--------------------------------------------------------------------------- */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import {
  getTicket, updateTicket, deleteTicket,
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_STATUS_COLOR, PRIORITY_COLOR, fmtDate,
} from '../lib/solarcare';
import { Loading, ErrorBox, Chip } from './ProjectSolarCare';
import { SSelect, STextarea, Field, C } from './formKit';

export default function TicketDetail() {
  const { ticketId } = useParams();
  const navigate     = useNavigate();
  const { user, can } = useAuth();

  const [t, setT]           = useState(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState(null);
  const [saving, setSaving] = useState(false);

  /* local copies of the editable fields */
  const [status, setStatus]         = useState('');
  const [priority, setPriority]     = useState('');
  const [progress, setProgress]     = useState('');
  const [resolution, setResolution] = useState('');

  const load = useCallback(() => {
    setLoad(true);
    return getTicket(ticketId)
      .then(d => {
        setT(d);
        setStatus(d.status || 'Open');
        setPriority(d.priority || 'Medium');
        setProgress(d.progress || '');
        setResolution(d.resolution || '');
        setError(null);
      })
      .catch(e => setError(e.message || 'Could not load this ticket'))
      .finally(() => setLoad(false));
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const dirty = t && (
    status !== (t.status || 'Open') ||
    priority !== (t.priority || 'Medium') ||
    progress !== (t.progress || '') ||
    resolution !== (t.resolution || '')
  );

  async function save() {
    setSaving(true);
    try {
      await updateTicket(ticketId, {
        status, priority, progress, resolution, changed_by: user?.email || '',
      });
      toast.success('Ticket updated');
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this ticket? The remaining tickets on this project will be renumbered.')) return;
    try {
      await deleteTicket(ticketId);
      toast.success('Ticket deleted');
      navigate(`/projects/${encodeURIComponent(t.project_id)}/solar-care`);
    } catch (e) {
      toast.error(e.message || 'Could not delete');
    }
  }

  if (loading) return <Loading label="Loading ticket…" />;
  if (error)   return <ErrorBox message={error} onRetry={load} />;
  if (!t)      return null;

  const sc = TICKET_STATUS_COLOR[t.status] || TICKET_STATUS_COLOR.Open;
  const pc = PRIORITY_COLOR[t.priority] || PRIORITY_COLOR.Medium;

  return (
    <div style={{ background: 'var(--slate-100)', minHeight: '100%', paddingBottom: 90 }}>

      <div style={{ background: '#0f2c3f', padding: '18px 16px 20px' }}>
        <button onClick={() => navigate(`/projects/${encodeURIComponent(t.project_id)}/solar-care`)}
                style={{ background: 'none', border: 0, color: 'rgba(255,255,255,.75)',
                         fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
          ← Back to Solar Care
        </button>

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,.5)' }}>
          Ticket {t.ticket_no} of {t.siblings}
        </div>
        <h1 style={{ margin: '5px 0 0', fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.35 }}>
          {t.type || 'Ticket'}
        </h1>
        {t.project && (
          <div onClick={() => navigate(`/projects/${encodeURIComponent(t.project.id)}/solar-care`)}
               style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', marginTop: 4,
                        cursor: 'pointer', textDecoration: 'underline' }}>
            {t.project.name}
          </div>
        )}
        {t.client && (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
            👤 {t.client.name}
          </div>
        )}

        <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
          <Chip {...sc}>{t.status || 'Open'}</Chip>
          {t.priority && <Chip {...pc}>{t.priority}</Chip>}
        </div>
      </div>

      {/* the problem, as reported */}
      <div className="detail-section">
        <div className="detail-section-title">📝 Reported problem</div>
        <div style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-head)' }}>
          {t.description || 'No description was recorded.'}
        </div>
      </div>

      {/* what changes while the ticket is live */}
      <div className="detail-section">
        <div className="detail-section-title">🔄 Update</div>

        <Field label="Status">
          <SSelect value={status} onChange={e => setStatus(e.target.value)} options={TICKET_STATUSES} />
        </Field>

        <Field label="Priority">
          <SSelect value={priority} onChange={e => setPriority(e.target.value)} options={TICKET_PRIORITIES} />
        </Field>

        <Field label="Progress note">
          <STextarea value={progress} onChange={e => setProgress(e.target.value)}
                     placeholder="What has been done so far" />
        </Field>

        <Field label="Resolution">
          <STextarea value={resolution} onChange={e => setResolution(e.target.value)}
                     placeholder="How it was fixed — fill this in when you close the ticket" />
        </Field>
      </div>

      {/* the rest of the record */}
      <div className="detail-section">
        <div className="detail-section-title">📋 Details</div>
        {[
          ['Ticket ID',    t.id],
          ['Assigned to',  t.assigned_to],
          ['Raised on',    fmtDate(t.start_date || t.created_at)],
          ['Target close', t.due_date ? fmtDate(t.due_date) : null],
          ['Chargeable',   t.total_charge ? `₹${Number(t.total_charge).toLocaleString('en-IN')}` : null],
          ['Raised by',    t.created_by],
          ['Last updated', t.updated_at ? fmtDate(t.updated_at) : null],
        ].map(([label, value]) => (
          <div key={label} className="detail-row">
            <div className="d-label">{label}</div>
            <div className="d-value">{value || '—'}</div>
          </div>
        ))}
      </div>

      {/* Delete is Admin-only. The API refuses it too, so this is the
          courtesy, not the control. */}
      {can('delete') && <div style={{ padding: '6px 16px 0' }}>
        <button onClick={remove}
                style={{ background: 'none', border: 'none', color: C.danger,
                         fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '8px 0' }}>
          Delete this ticket
        </button>
      </div>}

      {/* the save bar only appears once something has actually changed */}
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
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}