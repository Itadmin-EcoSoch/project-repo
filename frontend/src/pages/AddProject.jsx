/*  frontend/src/pages/AddProject.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    Add a project under an existing client.

    WHAT CHANGED
    The 700 lines of hand-written fields are gone. Every field now comes from
    lib/projectFields.js and is drawn by ProjectFormFields, so the form matches
    the AppSheet original exactly — all 60 fields, in order, with the show/hide
    rules working.

    WHAT DID NOT CHANGE
    The client card, the auto-generated project name, and the two-step
    Save → Send New Order Form flow all behave exactly as before. The email is
    still built from the saved sheet row, so Send stays locked until Save has
    written the project.
--------------------------------------------------------------------------- */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { addDropdownOption } from '../lib/api';
import { readClientDraft, clearClientDraft } from '../lib/clientDraft';
import { useAuth } from '../hooks/useAuth';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import ProjectFormFields from './ProjectFormFields';
import {
  emptyProjectForm, validateProject, toProjectPayload, ALL_FIELDS, isVisible,
  amcSetupPayload, amcVisitCount,
} from '../lib/projectFields';
import { C, page, Card, Field, Footer } from './formKit';

/*  ── SAVE PROGRESS ────────────────────────────────────────────────────────

    The weights are MEASURED, not guessed. From the backend log on a real
    two-contract order:

        POST /api/orders             7.5s
        POST /api/amc-setup/create  25.8s
        New Order Form email        background, does not block

    So writing the order is roughly a quarter of the wait and the AMC schedule
    is the rest, which is why the bar sits at 25% for a long time and then
    moves. A bar that crawled evenly to 100% would be lying about which part
    is slow.

    The percentage is per-STAGE, not a live byte count — the work is happening
    inside Apps Script and Node cannot see into it. The elapsed counter next to
    it is the honest number, and it is there so nobody has to guess whether a
    long pause means progress or a hang.

    Per-FILE upload progress is real byte progress and already exists — see
    pages/FileField.jsx, which reads axios's onUploadProgress.               */
const SAVE_STAGES = [
  { pct: 25,  label: 'Saving the client and project…' },
  { pct: 85,  label: 'Generating the AMC contracts and visit schedule…' },
  { pct: 100, label: 'Saved. Sending the New Order Form…' },
];


export default function AddProject() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin } = useAuth();
  const { dropdownOptions } = useDropdownOptions();

  /*  Reached two ways:
        /clients/:realId/add-project   — a real, already-saved client
        /clients/new/add-project       — a client that does not exist in the
                                          sheet yet (see AddClient.jsx), whose
                                          filled-in form is sitting in router
                                          state instead of the database.
      isNewClient controls which shape saveOrder() sends to POST /api/orders
      — client_type: 'existing' + client_id, or client_type: 'new' + the
      whole client object — and everywhere else "the client" is referenced
      below, needing to distinguish a real saved id from the placeholder.   */
  const isNewClient = id === 'new';

  /*  Router state first, sessionStorage second. State is in memory and dies on
      a page reload — and a 60-field form is exactly what people reload. The
      stash (lib/clientDraft.js) is what makes F5 survivable. Read ONCE, into
      state, so a later clearClientDraft() cannot pull the client card out from
      under a form that is already open.                                     */
  const [clientDraft] = useState(() => location.state?.clientDraft || readClientDraft());

  const [client,  setClient]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(emptyProjectForm);
  const [errors,  setErrors]  = useState({});
  const [saving,  setSaving]  = useState(false);

  /*  SAVE PROGRESS.

      `stage` is the index into SAVE_STAGES above; `startedAt` drives the
      elapsed-seconds counter. Both reset on every attempt so a retry after a
      failure does not carry the previous run's clock.                     */
  const [stage,     setStage]     = useState(-1);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed,   setElapsed]   = useState(0);

  /*  One-second tick while saving. Cleared the moment saving stops, so no
      timer survives an unmount or a failed attempt.                       */
  useEffect(() => {
    if (!saving || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [saving, startedAt]);

  /*  Fetched once, the moment this page opens — before the project exists in
      the sheet at all. Without this, every file attached while still filling
      out the form (Cost Breakdown Sheet, Proposal, PO, …) had no Project_ID
      to be uploaded under yet, since Code.gs only ever assigns one at Save
      time — so Code.gs's handleUploadFile fell back to a shared "unfiled"
      folder for all of them.

      This used to be generated client-side with crypto.randomUUID() — but
      that produces a plain 8-hex-character string, which is a DIFFERENT
      shape from what this app's projects actually use. Real Project_IDs are
      minted by backend/lib/uniqueId.js: 8 characters, first one a digit or
      capital letter, checked against every id already live in the sheet so
      it can never collide — e.g. "R7kmQ2xv", not "090b6720". POST
      /api/orders (see saveOrder below) mints its own id from that same
      generator regardless of what it's handed, so a client-made-up id was
      always going to be silently replaced at Save — meaning the Drive
      folder files were uploaded under (this id) and the project's real,
      saved id ended up being two DIFFERENT values. Fetching a real one from
      GET /api/projects/new-id up front, and having orders.js accept and use
      it instead of minting a second one, is what keeps them in sync.       */
  const [newProjectId, setNewProjectId] = useState(null);

  /*  Set once the project exists in the sheet. The New Order Form email now
      fires automatically the moment this is set (see handleSave below) —
      there is no longer a separate "Send" button/state to track for it.   */
  const [created,  setCreated]  = useState(null);

  useEffect(() => {
    if (isNewClient) {
      /*  No draft to work from — most likely this page was reached by
          reloading, which throws away React Router's in-memory state (see
          the note in AddClient.jsx's submit()). There is nothing to recover;
          send them back to fill the client form out again rather than
          showing a broken "Client not found" page for a client that was
          never supposed to exist in the sheet yet anyway.                  */
      if (!clientDraft) {
        clearClientDraft();
        toast.error('Client details were lost — please fill the client form out again.');
        navigate('/add-client', { replace: true });
        return;
      }
      setClient(clientDraft);
      api.get('/api/projects/new-id')
        .then(res => setNewProjectId((res?.data ?? res)?.id || null))
        .catch(() => setNewProjectId(null))
        .finally(() => setLoading(false));
      return;
    }

    Promise.all([
      api.get(`/api/clients/${id}`).then(res => setClient(res?.data ?? res)).catch(() => setClient(null)),
      api.get('/api/projects/new-id').then(res => setNewProjectId((res?.data ?? res)?.id || null))
        /*  Uploads simply have nowhere real to go if this fails — FileField
            falls back to "unfiled", the same safety net it always had, so a
            hiccup here degrades gracefully instead of blocking the form.  */
        .catch(() => setNewProjectId(null)),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => {
      const upd = { ...e, [k]: undefined };
      /*  Cross-field: Installation must be on/before Commissioning. Evaluated
          the instant EITHER date changes, and the message always lands on the
          Installation field so it flags immediately — no blur needed.       */
      if (k === 'expInstDate' || k === 'expCommsnDate') {
        const inst = k === 'expInstDate'  ? v : form.expInstDate;
        const comm = k === 'expCommsnDate' ? v : form.expCommsnDate;
        upd.expInstDate = (inst && comm && String(inst) > String(comm))
          ? 'Expected Installation Date must be on or before Expected Commissioning Date'
          : undefined;
      }
      return upd;
    });
  };

  /*  "Is the client's billing address the same as the site's postal address?"

      Yes → copy THREE things off the client record, because for a rooftop job
            at the client's own address all three are the same fact:
              · Client_Address        → Postal address of site
              · Client_GMap_Location  → Latitude, Longitude
              · Client_Region         → Project Region
      No  → clear all three, so a stale copy is never mistaken for typed input.

      Everything stays editable after copying. Most sites match the client
      record exactly, but some need a flat number or a landmark appended, and
      read-only boxes would force the user back to No and a full retype just to
      add four words.

      Runs on the ANSWER changing, not on every render, so a manual edit made
      after choosing Yes is never overwritten.                              */
  useEffect(() => {
    if (form.billingSameAsSite === 'Yes') {
      const billing = String(client?.billing_address || '').trim();
      const region  = String(client?.region || '').trim();

      /*  lat/lng come out of Client_GMap_Location, split by the backend.
          Fallback: a few older client rows have the coordinates typed into
          the billing address field instead of the map field, so if the
          proper fields are empty and the address parses as "lat, lng",
          use that rather than leaving the box blank.                      */
      let coords = '';
      if (client?.lat != null && client?.lng != null) {
        coords = `${client.lat}, ${client.lng}`;
      } else {
        const m = billing.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
        if (m) coords = `${m[1]}, ${m[2]}`;
      }

      setForm(f => ({
        ...f,
        siteAddress  : billing || f.siteAddress,
        gmap         : coords  || f.gmap,
        projectRegion: region  || f.projectRegion,
      }));
      setErrors(e => ({ ...e, siteAddress: undefined, gmap: undefined, projectRegion: undefined }));

      const missing = [
        !billing && 'billing address',
        !coords  && 'coordinates',
        !region  && 'region',
      ].filter(Boolean);
      if (missing.length) {
        toast(`This client has no ${missing.join(' or ')} saved — please fill that in by hand.`);
      }
    } else if (form.billingSameAsSite === 'No') {
      setForm(f => ({ ...f, siteAddress: '', gmap: '', projectRegion: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.billingSameAsSite, client]);

  /*  Same composite AppSheet builds: client_tags_sizekWp_invertertype.       */
  const projName = useMemo(() => [
    client?.name,
    form.area,
    form.size ? `${form.size}kWp` : '',
    form.inverterType,
  ].filter(Boolean).join('_'), [client, form.area, form.size, form.inverterType]);

  /* the read-only Project Name box mirrors it as you type */
   /*  Carry Type of Client onto the project form, and pre-answer Type of
      Project when it is already decided.

      External (AMC) can only ever be an AMC project, so it is selected here
      rather than asked again — the field's option list collapses to ['AMC']
      too (see projType in lib/projectFields.js), so the two cannot disagree.

      Internal is NOT pre-filled: it covers EPC and I&C, and Consultancy,
      Retail and Ad-hoc Maintenance are all still legitimate choices for an
      internal client. Guessing one of six would be worse than asking.

      Only ever fills a BLANK projType, so a value already chosen on this form
      is never overwritten by a late-arriving client fetch.               */
  useEffect(() => {
    const ct = String(client?.type_of_client ?? '').trim();
    if (!ct) return;
    setForm(f => {
      const isExternal = ct.toLowerCase() === 'external';
      if (f.clientType === ct && (!isExternal || f.projType === 'AMC')) return f;
      return {
        ...f,
        clientType: ct,
        projType  : isExternal && !f.projType ? 'AMC' : f.projType,
      };
    });
  }, [client]);

  useEffect(() => { setForm(f => ({ ...f, projectName: projName })); }, [projName]);

  function validate() {
    const e = validateProject(form);
    setErrors(e);
    if (!Object.keys(e).length) return true;

    /*  Scroll to the first problem. On a 60-field form an error 40 fields below
        the fold is invisible, and the user is left pressing Save with nothing
        appearing to happen.                                                  */
    const first = ALL_FIELDS.find(f => e[f.name] && isVisible(f, form));
    toast.error(first ? e[first.name] : 'Please check the highlighted fields');
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-field-error="true"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return false;
  }

  /** Creates the project (and, for a new client, the client too — one atomic
   *  call). Returns { project_id, project_name, client_id }. */
  async function saveOrder({ onStage = () => {} } = {}) {
    if (created) return created;                  // already saved this session

    /*  _newRegion is bookkeeping from the client form, not a client field.
        toSheet() would drop it anyway (it is not capitalised), but stripping
        it here keeps the request body honest about what it is sending.     */
    const { _newRegion, ...clientPayload } = clientDraft || {};

    onStage(0);
    const res = await api.post('/api/orders', {
      ...(isNewClient
        ? { client_type: 'new', client: clientPayload }
        : { client_type: 'existing', client_id: id }),
      project: toProjectPayload(form, {
        ...(newProjectId ? { Project_ID: newProjectId } : {}),
        Project_Name: projName,
        /*  For a new client, Client_Id/Client_Name aren't known until the
            response comes back — Code.gs fills these into the project row
            itself as part of the same atomic write (see createOrder_ in
            Code.gs), so they're deliberately left out here rather than sent
            blank and overwritten a moment later.                          */
        ...(isNewClient ? {} : { Client_Id: id, Client_Name: client?.name || '' }),
      }),
      status       : 'Active',
      submitted_by : user?.email || 'staff',
    });

    const data = res?.data ?? res;
    const out  = {
      project_id  : data?.project_id ?? null,
      project_name: data?.project_name ?? projName,
      /*  The client's real, permanent id — only meaningfully NEW when this
          request just created the client for the first time. For an
          existing client this just echoes back the id already in the URL.  */
      client_id   : data?.client?.id ?? (isNewClient ? null : id),
    };

    /*  If an AMC was sold, generate its contracts and every visit row now.
        Two contracts when the client took Inspection AND Cleaning, each with
        its own frequency and term. A failure here must not lose the project —
        it is already saved, so report it and let them retry from the project's
        Solar Care screen.                                                   */
    const amc = amcSetupPayload(form, out.project_id);
    if (amc) {
      onStage(1);
      try {
        const r = await api.post('/api/amc-setup/create', amc);
        const d = r?.data ?? r;
        out.amc = { contracts: d?.contracts?.length || 0, visits: d?.total_visits || 0 };
      } catch (e) {
        out.amcError = e.message || 'Could not create the AMC schedule';
      }
    }

    /*  The order is in the sheet, so the draft has done its job. Clearing it
        now is what stops a later reload of /clients/new/add-project from
        offering to create the same client a second time.                   */
    if (isNewClient && out.project_id) {
      clearClientDraft();
      /*  A region typed on the client form that was not already on the list.
          Deliberately only now — the point of the whole change is that
          nothing about a client is persisted until their project is.
          Fire-and-forget: a failure here leaves the region typed on this one
          client, which is harmless, and must not undo a saved order.       */
      if (_newRegion) addDropdownOption('Project_Region', _newRegion).catch(() => {});
    }

    onStage(2);
    setCreated(out);
    return out;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setStage(0);
    setStartedAt(Date.now());
    setElapsed(0);
    try {
      const out = await saveOrder({ onStage: setStage });

      if (out.amcError) {
        toast.success('✅ Project saved');
        toast.error(`AMC schedule not created: ${out.amcError}. You can set it up from Solar Care.`);
      } else if (out.amc) {
        toast.success(
          `✅ Project saved · ${out.amc.contracts} AMC contract` +
          `${out.amc.contracts > 1 ? 's' : ''} with ${out.amc.visits} visits`
        );
      } else {
        toast.success('✅ Project saved');
      }

      /*  New Order Form now sends automatically the moment Save succeeds —
          no second button, no preview step. This is deliberately only for
          a brand-new project (this page); Edit Project still shows its own
          "Send Update" button and stays exactly as it was, since a change
          to an existing project is not something that should ever go out
          without someone choosing to send it.

          Calls the same endpoint the preview-then-send modal used to call
          in 'new' mode (see NewOrderEmailModal.jsx) — this just skips
          straight to sending instead of waiting for a click on Send after
          showing a preview. A failure here does not undo the save that
          already succeeded; it only means the email itself needs sending
          by hand afterward, from the project's own page.                  */
      if (out.project_id) {
        api.post(`/api/new-order/${encodeURIComponent(out.project_id)}/send`, { force: false })
          .then(res => {
            const data = res?.data ?? res;
            if (data?.sent) toast.success(`New Order Form sent to ${data.recipients?.join(', ') || 'the team'}`);
            else toast.error(data?.reason || 'Project saved, but the New Order Form email was not sent.');
          })
          .catch(err => toast.error(err.message || 'Project saved, but the New Order Form email failed to send.'));
      }

      /*  Straight to the saved project. There used to be a second press —
          the footer flipped to "Done →" and waited — which is a click that
          asks nothing and decides nothing. The save has happened, the email
          is on its way, so the only thing left is to show the project.

          Toasts live at the app root (react-hot-toast <Toaster/>), so the
          "saved" message and the New Order Form result that lands a second
          or two later both survive this navigation and appear over the
          project page.

          Small delay so the success toast is visibly tied to THIS screen
          before it changes. replace:true means Back returns to the client,
          not to a filled-in Add Project form for a project that now exists.  */
      if (out.project_id) {
        setTimeout(() => {
          navigate(`/projects/${encodeURIComponent(out.project_id)}`, { replace: true });
        }, 900);
      }

      return out;
    } catch (err) {
      toast.error(err.message || 'Failed to save project');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 24, color: C.text3, fontSize: 13 }}>Loading client…</div>;

  if (!client) return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text1, marginBottom: 6 }}>Client not found</div>
      <button onClick={() => navigate('/clients')}
        style={{ marginTop: 8, background: C.primary, color: '#fff', border: 'none',
                 borderRadius: 10, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        ← Back to Clients
      </button>
    </div>
  );

  return (
    <div style={page}>

      <div style={{ background: '#fff', borderBottom: `1px solid ${C.border}`,
                    padding: '13px 18px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text1 }}>Add Project</div>
        <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>
          {isNewClient
            ? 'New client and their first project — written to the sheet together, in one step'
            : 'New project under an existing client'}
        </div>
      </div>

      {/* client card — sticky, so you always know who you are adding for */}
      <div style={{ position: 'sticky', top: 0, zIndex: 40, padding: '8px 16px',
                    background: 'rgba(241,245,249,.92)',
                    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>
        <div style={{ padding: '10px 14px', background: '#fff', borderRadius: 14,
                      border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center',
                      gap: 12, boxShadow: '0 4px 14px rgba(15,23,42,.10)' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%',
                        background: `linear-gradient(135deg,${C.primary},${C.primaryL})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
            {(client.name || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.name}</div>
            <div style={{ fontSize: 11, color: C.text3, marginTop: 1, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {client.phone} · {client.region} · {client.type_of_client || 'Internal'}
            </div>
          </div>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
                         color: C.success, background: '#ecfdf5', border: '1px solid #a7f3d0',
                         borderRadius: 20, padding: '4px 10px', flexShrink: 0 }}>
            New Project
          </span>
        </div>
      </div>

      {/* the whole AppSheet form */}
      {/*  CLAUSE 1 of the AppSheet Valid_If: a project that does not exist yet
           has exactly one valid status. Passing ['Active'] means the Add form
           offers only that, instead of the full nine-value fallback list and a
           422 from the API a moment later.                                  */}
      <ProjectFormFields form={form} set={set} errors={errors} statusOptions={['Active']}
                         isAdmin={isAdmin} dropdownOptions={dropdownOptions}
                         projectId={newProjectId}
                         onFieldBlur={(f) => { const e = validateProject(form); setErrors(prev => ({ ...prev, [f.name]: e[f.name] })); }} />

      {/*  SAVE PROGRESS — only while saving. Replaces nothing; it sits above
           the status card so the card's "Not saved yet" text stays put.   */}
      {saving && stage >= 0 && (
        <div style={{ margin: '0 16px 12px', padding: '12px 14px', borderRadius: 12,
                      background: '#f8fafc', border: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                        gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
              {SAVE_STAGES[stage]?.label || 'Working…'}
            </div>
            <div style={{ fontSize: 11, color: C.text3, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {SAVE_STAGES[stage]?.pct ?? 0}% · {elapsed}s
            </div>
          </div>

          <div style={{ height: 6, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${SAVE_STAGES[stage]?.pct ?? 0}%`,
              background: C.success,
              borderRadius: 99,
              /*  Long, because the jumps are large and infrequent. A snappy
                  transition on a 60-point jump reads as a glitch.        */
              transition: 'width .8s ease',
            }} />
          </div>

          <div style={{ fontSize: 10.5, color: C.text3, marginTop: 7, lineHeight: 1.5 }}>
            Writing to Google Sheets. This normally takes about
            {amcVisitCount(form) > 0 ? ' 20–30 seconds when an AMC is included' : ' 8–10 seconds'}.
            Please do not close this tab.
          </div>
        </div>
      )}

      {/* which button is live right now */}
      <div style={{ margin: '0 16px 12px', padding: '10px 14px', borderRadius: 12,
                    background: created ? '#ecfdf5' : '#f8fafc',
                    border: `1px solid ${created ? '#a7f3d0' : C.border}`,
                    display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                       background: created ? C.success : C.text3 }} />
        <div style={{ fontSize: 11.5, color: created ? '#065f46' : C.text2, lineHeight: 1.5 }}>
          {created
            ? <><b>Saved.</b> Project <b>{created.project_id}</b> is in the sheet, the New Order
                Form email is on its way, and the project page is opening.
                {created.amc && <> {created.amc.contracts} AMC contract
                  {created.amc.contracts > 1 ? 's' : ''} and {created.amc.visits} visits were generated.</>}</>
            : <><b>Not saved yet.</b> Press Save Project to save
                {isNewClient ? <> <b>this client and their project together</b></> : <> it</>} and
                automatically send the New Order Form email in one step.
                {amcVisitCount(form) > 0 &&
                  <> Saving will also generate <b>{amcVisitCount(form)} AMC visits</b>.</>}</>}
        </div>
      </div>

      <Footer
        onSecondary={() => navigate(
          created?.client_id ? `/clients/${created.client_id}` : (isNewClient ? '/clients' : `/clients/${id}`)
        )}
        secondaryLabel="Cancel"
        onPrimary={handleSave}
        primaryLabel={saving ? 'Saving…' : created ? 'Opening project…' : '✓ Save Project'}
        primaryColor={C.success}
        /*  Disabled once `created` is set: the page is about to navigate, and
            a second press in that window would be a second save.            */
        disabled={saving || !!created}
      />
    </div>
  );
}