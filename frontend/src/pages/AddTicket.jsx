/*  frontend/src/pages/AddTicket.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    Raise a ticket against a project.

        Client → Project → TICKET GENERATION → this

    The project is fixed by the route, which is what keeps the hierarchy honest:
    there is no way to create a ticket that floats free of a project.

    Route: /projects/:id/tickets/new
--------------------------------------------------------------------------- */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import { mergeOptions } from '../lib/projectFields';
import {
  createTicket, TICKET_TYPES, TICKET_PRIORITIES, TICKET_STATUSES,
} from '../lib/solarcare';
import {
  page, Card, Field, SInput, SSelect, STextarea, Footer, C, Row } from './formKit';

const today = () => new Date().toISOString().slice(0, 10);

export default function AddTicket() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { user }  = useAuth();

  const [project, setProject] = useState(null);
  const [users, setUsers]     = useState([]);
  const [saving, setSaving]   = useState(false);
  const [errors, setErrors]   = useState({});

  /*  Same admin-managed system as the project form (see
      pages/AdminDropdowns.jsx, field keys Ticket_Type / Ticket_Priority /
      Ticket_Status / Ticket_Assigned_To) — an Admin can add to these lists
      from that one screen, and they show up here for everyone the next time
      this form loads, merged on top of the built-in lists via mergeOptions.

      Assigned To is a bit different from the other three: its "built-in"
      list isn't a fixed set of words, it's whoever actually has a login
      (fetched below into `users`) — so admin-added extras here are for
      names that AREN'T a real account: an outside vendor, a subcontractor
      crew, anyone you want to assign a ticket to without giving them
      sign-in access.                                                       */
  const { dropdownOptions } = useDropdownOptions();
  const typeOptions       = mergeOptions(TICKET_TYPES,      dropdownOptions?.Ticket_Type,       '');
  const priorityOptions   = mergeOptions(TICKET_PRIORITIES, dropdownOptions?.Ticket_Priority,   '');
  const statusOptions     = mergeOptions(TICKET_STATUSES,   dropdownOptions?.Ticket_Status,     '');
  const assigneeOptions   = mergeOptions(users,             dropdownOptions?.Ticket_Assigned_To, '');

  /*  Nothing pre-selected.

      Priority, Status and Raised on used to arrive as Medium / Open / today.
      A pre-filled answer gets accepted without being read, and a ticket
      raised at Medium because nobody looked is worse than one that made the
      user choose.

      Safe to leave blank: routes/tickets.js applies 'Open', 'Medium' and
      today's date when none is sent, so the common case still costs nothing
      and no row lands in the sheet with an empty column.                 */
  const [f, setF] = useState({
    type       : '',
    priority   : '',
    status     : '',
    description: '',
    assigned_to: '',
    start_date : '',
    due_date   : '',
    total_charge: '',
  });

  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setErrors(e => ({ ...e, [k]: null })); };

  useEffect(() => {
    api.get(`/api/projects/${encodeURIComponent(projectId)}`)
      .then(r => setProject(r?.data ?? r))
      .catch(() => setProject(null));

    /* assignee list — optional, the field falls back to free text if it fails */
    api.get('/api/users?limit=500')
      .then(r => setUsers((r?.data ?? r ?? []).map(u => u.email).filter(Boolean)))
      .catch(() => setUsers([]));
  }, [projectId]);

  function validate() {
    const e = {};
    if (!f.type)                    e.type = 'Pick what kind of issue this is';
    if (!f.priority)                e.priority = 'Pick how urgent this is';
    if (!f.status)                  e.status = 'Pick the current status';
    if (!f.description.trim())      e.description = 'Describe the problem — this is what the technician reads';
    if (f.due_date && f.start_date && f.due_date < f.start_date) {
      e.due_date = 'The due date cannot be before the start date';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) { toast.error('Check the highlighted fields'); return; }
    setSaving(true);
    try {
      const saved = await createTicket({
        project_id  : projectId,
        type        : f.type,
        priority    : f.priority,
        status      : f.status,
        description : f.description.trim(),
        assigned_to : f.assigned_to || '',
        start_date  : f.start_date || '',
        due_date    : f.due_date || '',
        total_charge: f.total_charge === '' ? '' : Number(f.total_charge),
        created_by  : user?.email || '',
      });
      toast.success(`${saved.label || 'Ticket'} created`);
      navigate(`/projects/${encodeURIComponent(projectId)}/solar-care`);
    } catch (err) {
      toast.error(err.message || 'Could not create the ticket');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={page}>
      <div style={{ background: 'var(--slate-900)', padding: '15px 16px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em',
                      textTransform: 'uppercase', color: 'rgba(255,255,255,.45)' }}>
          New ticket
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginTop: 4 }}>
          {project?.name || 'Loading project…'}
        </div>
        {project?.clients?.name && (
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)', marginTop: 3 }}>
            👤 {project.clients.name}
          </div>
        )}
      </div>

      {/*  The two sections sit SIDE BY SIDE — the problem on the left, how it
           is being handled on the right.

           Stacked, the five Handling fields pushed Create ticket below the
           fold on a laptop, so raising a ticket meant scrolling to a button
           you could not see. Side by side the whole form fits one screen.

           ek-row-stretch makes both cards the same height rather than letting
           the shorter one float. Below 1100px they fall back to one column,
           because two halves of a 900px window are too narrow for a date
           field and its label.                                            */}
      <Row cols={2} className="ek-row-stretch" style={{ gap: 14 }}>

        <Card icon={<span style={{ fontSize: 15 }}>🎫</span>} title="What is the problem?" color={C.accent}>
          <Field label="Issue type" required error={errors.type}>
            <SSelect value={f.type} onChange={e => set('type', e.target.value)}
                     options={typeOptions} placeholder="Select…" hasError={!!errors.type} />
          </Field>

          <Field label="Priority" required error={errors.priority}>
            <SSelect value={f.priority} onChange={e => set('priority', e.target.value)}
                     options={priorityOptions} placeholder="Select…" hasError={!!errors.priority} />
          </Field>

          {/*  Description is the field people actually need room in, and it now
               has a full half-screen column to itself.                    */}
          <Field label="Description" required error={errors.description}>
            <STextarea value={f.description} onChange={e => set('description', e.target.value)}
                       placeholder="What is happening on site, since when, and anything the technician should carry" />
          </Field>
        </Card>

        <Card icon={<span style={{ fontSize: 15 }}>🧰</span>} title="Handling" color={C.primary}>
          <Field label="Assigned to">
            {assigneeOptions.length
              ? <SSelect value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)}
                         options={assigneeOptions} placeholder="Unassigned" />
              : <SInput value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)}
                        placeholder="name@ecosoch.com" />}
          </Field>

          <Field label="Status" required error={errors.status}>
            <SSelect value={f.status} onChange={e => set('status', e.target.value)}
                     options={statusOptions} placeholder="Select…" hasError={!!errors.status} />
          </Field>

          <Row cols={2}>
            <Field label="Raised on">
              <SInput type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>

            <Field label="Target close date" error={errors.due_date}>
              <SInput type="date" value={f.due_date} onChange={e => set('due_date', e.target.value)}
                      hasError={!!errors.due_date} />
            </Field>
          </Row>

          <Field label="Chargeable amount">
            <SInput type="number" value={f.total_charge}
                    onChange={e => set('total_charge', e.target.value)}
                    placeholder="0" suffix="₹" />
          </Field>
        </Card>

      </Row>

      <Footer
        onSecondary={() => navigate(`/projects/${encodeURIComponent(projectId)}/solar-care`)}
        secondaryLabel="Cancel"
        onPrimary={save}
        primaryLabel={saving ? 'Creating…' : 'Create ticket'}
        disabled={saving}
      />
    </div>
  );
}