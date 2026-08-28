/*  frontend/src/pages/EditProject.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    Edit an existing project.

    WHAT CHANGED
    It now renders the SAME field list as Add Project, from lib/projectFields.js.
    The old version edited about 16 of the 60 columns, so a field you filled in
    on the way in could not be corrected afterwards — you had to open the sheet.

    WHAT DID NOT CHANGE
    Save still patches only what actually changed, still suppresses the automatic
    email, and still offers the threaded "Updated Order" message afterwards.
--------------------------------------------------------------------------- */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import ProjectUpdateEmailModal from '../components/NewOrderEmailModal';
import ProjectFormFields from './ProjectFormFields';
import {
  emptyProjectForm, validateProject, toProjectPayload, ALL_FIELDS, isVisible,
  toDateInput, toYesNo, amcSetupPayload,
} from '../lib/projectFields';

import { C, page, Footer } from './formKit';

export default function EditProject() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { dropdownOptions } = useDropdownOptions();

  const [proj,     setProj]     = useState(null);
  const [form,     setForm]     = useState(null);
  const [original, setOriginal] = useState(null);      // to diff against on save
  const [errors,   setErrors]   = useState({});
  const [saving,   setSaving]   = useState(false);
  const [notFound, setNotFound] = useState(false);

  /*  Per-project Project_Status choices, computed by the backend from this
      project's AMC contracts and payments — the Valid_If port in
      backend/lib/status.js. null until loaded, at which point
      ProjectFormFields uses it in place of the static PROJECT_STATUSES.   */
  const [statusOptions, setStatusOptions] = useState(null);
  const [statusReason,  setStatusReason]  = useState('');

  const [savedChanges, setSavedChanges] = useState(null);
  const [emailOpen,    setEmailOpen]    = useState(false);

  useEffect(() => {
    api.get(`/api/projects/${id}`)
      .then(res => {
        const p = res?.data ?? res;
        if (!p?.id) { setNotFound(true); return; }
        setProj(p);

        /*  The API returns app-cased keys (size_kwp), the spec is keyed by sheet
            column (Project_Size). _raw carries the untouched row when the API
            supplies it; otherwise fall back to the app keys.                  */
        const row = p._raw || {
          Project_Name: p.name, Site_Area: p.area, Project_Size: p.size_kwp,
          Project_Type: p.project_type, Project_Status: p.status,
          Site_Address: p.site_address, Project_Region: p.region,
          Project_Comments: p.comments, Project_Description: p.description,
          Sales_Lead: p.sales_lead, Building_Type: p.building_type,
          Business_Model: p.scheme, Inverter_Brand: p.inverter_brand,
          Inverter_Type: p.inverter_type, Module_Brand: p.module_brand,
          Module_Wattage: p.module_wattage, Module_No: p.module_no,
          Roof_Material: p.roof_material, Roof_Type: p.roof_type,
          Project_Sector: p.sector, System_Type: p.system_type,
          System_Category: p.system_category, Order_Value: p.order_value,
          Margin: p.ecosoch_margin_pct, Proposal_Model: p.proposal_model,
          Client_Committment: p.commitment, Obstacle_Removal: p.obstacles,
          Obstacle_Scope: p.obstacle_scope, Salesperson_Email: p.salesperson_email,
          GST_Number: p.gst_number, DISCOM_Name: p.discom_name,
          Billing_Name: p.billing_name, Deal_ID: p.deal_id, Subsidy: p.subsidy,
          BESCOM: p.bescom, Monitoring: p.monitoring, AMC_Type: p.amc_type,
          AMC_Provided: p.amc_provided, Exp_Inst_Date: p.exp_inst_date,
          Exp_Commsn_Date: p.exp_commsn_date,
        };

                const loaded = {};
        for (const f of ALL_FIELDS) {
          const v = row[f.sheet];

          /*  Date columns need converting, not just copying. cell_() in Code.gs
              returns every Date cell as ISO WITH TIME — '2026-08-31T00:00:00'
              — and <input type="date"> only accepts 'yyyy-MM-dd'. Assigning
              the raw value left every date box on this form blank, which read
              as "the dates were never saved" when they were there all along.  */
                    /*  Two shapes need converting, not just copying:

              date   cell_() in Code.gs returns every Date as ISO WITH TIME
                     ('2026-08-31T00:00:00'), and <input type="date"> accepts
                     only 'yyyy-MM-dd'.

              yesno  the sheet stores real booleans, so AMC_Provided arrives as
                     true — and the YesNo toggle compares against the string
                     'Yes', so neither button lit up.                        */
                    loaded[f.name] =
            f.type === 'date'  ? toDateInput(v) :
            f.type === 'yesno' ? toYesNo(v)     :
            /*  A BOOLEAN FROM THE SHEET, WHATEVER CONTROL SHOWS IT.

                The yesno branch above was not enough. AMC_Provided is a real
                checkbox column — 1,320 false and 222 true across the tab —
                but its field is type:'radio', not type:'yesno', so it fell
                through to the raw branch and arrived as the boolean `true`.
                The radio compares against the STRING 'Yes', true !== 'Yes',
                and neither button lit up on a project that plainly had an AMC.

                Keying off the VALUE rather than the control type fixes it for
                any future radio or select put on a boolean column.        */
            typeof v === 'boolean' ? toYesNo(v) :
                        /*  The inverse of the /100 in toProjectPayload. Margin is stored
                as a fraction because the column is formatted 0.00% and Sheets
                applies that to the RAW value. The box asks for "Margin%", so
                0.12 has to come back as 12 or the next save would divide it
                again and turn 12% into 0.12%.                             */
            (f.type === 'percent' && v !== '' && v !== null && v !== undefined
              && !Number.isNaN(Number(v)))
              ? String(Math.round(Number(v) * 1000) / 10) :
            ((v === undefined || v === null) ? '' : v);
          /*  The original filename, saved alongside the Drive path — see
              fileNameKey in lib/projectFields.js. Older rows saved before
              this existed just don't have the column yet, so nv is
              undefined and FileField.jsx falls back to deriving a name from
              the path, same as it always did.                            */
      
        }
                /*  ── SEED THE AMC TERMS FROM THE EXISTING CONTRACTS ────────────────
            cleanVisits / cleanYears / cleanStart and their inspection twins are
            transient: true — they have no sheet column, so the loop above read
            row[undefined] and left them blank on every edit. They are inputs
            that GENERATE a contract on save; the saved values live in the
            AMC_Contracts tab.

            GET /api/projects/:id already returns those contracts, so this reads
            them back. Without it, opening a project that has an AMC and
            pressing Save regenerated its whole visit schedule from empty boxes.

            Matched on AMC_Type, because one project can hold an Inspection
            contract AND a Cleaning contract at once, each with its own
            visits-per-year and start date.                                  */
        const amcSeed = {};
        for (const c of (Array.isArray(p.contracts) ? p.contracts : [])) {
          const type = String(c.amc_type ?? c.AMC_Type ?? '').toLowerCase();

          /*  Reads both the mapped app keys and the raw sheet columns, because
              the detail route may return either shape.                      */
          const pick = (appKey, sheetCol) => c[appKey] ?? c[sheetCol] ?? '';

          const visits = pick('frequency',     'AMC_Frequency');
          const years  = pick('period_years',  'AMC_Period_in_Years');
          const start  = pick('start_date',    'AMC_Start_Date');
          const file   = pick('contract_file', 'AMC_Contract_Files');

          if (type.includes('inspect')) {
            amcSeed.inspVisits = visits === '' ? '' : String(visits);
            amcSeed.inspYears  = years  === '' ? '' : String(years);
            amcSeed.inspStart  = toDateInput(start);
            if (file) amcSeed.inspFile = file;
          }
          if (type.includes('clean')) {
            amcSeed.cleanVisits = visits === '' ? '' : String(visits);
            amcSeed.cleanYears  = years  === '' ? '' : String(years);
            amcSeed.cleanStart  = toDateInput(start);
            if (file) amcSeed.cleanFile = file;
          }
        }

                /*  isCommissioned is transient — no column of its own. The answer is
            simply whether Commissioned_Date holds a date, so derive it rather
            than showing a blank question on every edit.                    */
        /*  Carry Type of Client onto the edit form too.

            Without this, clientType is blank on Edit and Type of Project
            offers all six options again — so an External (AMC) client's
            project, saved correctly as AMC, invited someone to change it to
            EPC on the next visit.

            mergeOptions keeps whatever is already saved on the row, so a
            legacy project whose type does not match its client is still
            shown and still editable rather than silently dropped.       */
        loaded.clientType = String(p.clients?.type_of_client ?? '').trim();

        loaded.isCommissioned = String(row.Commissioned_Date ?? '').trim() ? 'Yes' : 'No';

        
                /*  billingSameAsSite is transient — no column, nothing to restore. But
            the answer is recoverable: if the site address still matches the
            client's billing address, Yes is what was chosen. Deriving it beats
            showing a blank question that suggests an answer was lost.      */
                const clientAddr = String(p.clients?.billing_address ?? '').trim().toLowerCase();
        const siteAddr   = String(loaded.siteAddress ?? '').trim().toLowerCase();

        /*  Three-way, not two. The old line read p.clients?.address — a key
            that does not exist; MAP.clients calls it billing_address, and
            withClients was not fetching the column at all. clientAddr was
            therefore always '', the && short-circuited, and EVERY project
            opened showing No.

            When the address genuinely cannot be read, leave the question
            UNANSWERED rather than asserting No. A wrong No is not neutral:
            it unlocks the address boxes and invites someone to retype an
            address that was correct, which is how the two tabs drift apart.
            Blank shows the question as still to answer, and the field is
            only required while siteAddress is empty, so the edit still
            saves untouched.                                              */
        if (siteAddr && clientAddr) {
          loaded.billingSameAsSite = clientAddr === siteAddr ? 'Yes' : 'No';
        }

        /*  amcSeed goes AFTER ...loaded so it wins — loaded already set those
            same keys to '' from the row[undefined] reads above.            */
        const merged = { ...emptyProjectForm(), ...loaded, ...amcSeed,
                         projectName: p.name || '' };
        setForm(merged);
        setOriginal(merged);
        if (Array.isArray(p.status_options)) setStatusOptions(p.status_options);
        if (p.status_rule?.reason)           setStatusReason(p.status_rule.reason);
      })
      .catch(() => setNotFound(true));
  }, [id]);
    /*  Project_Name is a composite — client_tags_sizekWp_invertertype. AddProject
      rebuilds it live as you type; this screen set it once on load and never
      again, so changing the tags or size updated those columns and left the
      name stale.

      Guarded on `original` so it cannot fire during the initial load, when
      form.area and form.size are still '' — otherwise it would blank the name
      of every project the instant it opened.                               */
  useEffect(() => {
    if (!form || !original) return;
    const next = [
      proj?.client_name || proj?.clients?.name || '',
      form.area,
      form.size ? `${form.size}kWp` : '',
      form.inverterType,
    ].filter(Boolean).join('_');
    if (next && next !== form.projectName) setForm(f => ({ ...f, projectName: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.area, form?.size, form?.inverterType, original]);

  /*  "Is the client's billing address the same as the site's postal address?"

      Yes → copy THREE things off the client record, because for a rooftop job
            at the client's own address all three are the same fact:
              · Client_Address       → Postal address of site
              · Client_GMap_Location → Latitude, Longitude
              · Client_Region        → Project Region
      No  → clear all three, so a stale copy is never mistaken for typed input.

      Add Project does this in a useEffect keyed on the answer. That pattern is
      WRONG here and would lose data: this form DERIVES an answer during load
      (see the block in the fetch above), so the effect would fire immediately
      on open — and a project whose answer derives to No would have its saved
      address, coordinates and region wiped the moment somebody looked at it.

      Handling it inside set() instead means it can only ever run from a real
      click on the toggle. Loading the form does not go through set().     */
  function answerBillingSameAsSite(v) {
    if (v !== 'Yes' && v !== 'No') {
      setForm(f => ({ ...f, billingSameAsSite: v }));
      return;
    }

    if (v === 'No') {
      setForm(f => ({ ...f, billingSameAsSite: 'No',
                      siteAddress: '', gmap: '', projectRegion: '' }));
      setErrors(e => ({ ...e, billingSameAsSite: undefined }));
      return;
    }

    const c       = proj?.clients || {};
    const billing = String(c.billing_address || '').trim();
    const region  = String(c.region || '').trim();

    /*  Fallback: a few older client rows have the coordinates typed into the
        address field instead of the map field, so if the proper fields are
        empty and the address parses as "lat, lng", use that.              */
    let coords = '';
    if (c.lat != null && c.lng != null) {
      coords = `${c.lat}, ${c.lng}`;
    } else {
      const m = billing.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
      if (m) coords = `${m[1]}, ${m[2]}`;
    }

    setForm(f => ({
      ...f,
      billingSameAsSite: 'Yes',
      siteAddress  : billing || f.siteAddress,
      gmap         : coords  || f.gmap,
      projectRegion: region  || f.projectRegion,
    }));
    setErrors(e => ({ ...e, billingSameAsSite: undefined, siteAddress: undefined,
                      gmap: undefined, projectRegion: undefined }));

    const missing = [
      !billing && 'billing address',
      !coords  && 'coordinates',
      !region  && 'region',
    ].filter(Boolean);
    if (missing.length) {
      toast(`This client has no ${missing.join(' or ')} saved — please fill that in by hand.`);
    }
  }

  const set = (k, v) => {
    if (k === 'billingSameAsSite') return answerBillingSameAsSite(v);
    setForm(f => { const next = { ...f, [k]: v }; if (k === 'commissionedDate') next.warrantyStart = v; return next; });
    setErrors(e => {
      const upd = { ...e, [k]: undefined };
      if (k === 'commissionedDate') upd.warrantyStart = undefined;   // mirror into Warranty Start
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
      if (k === 'commissionedDate' || k === 'warrantyStart') {
        const comm = k === 'commissionedDate' ? v : form.commissionedDate;
        const ws   = k === 'commissionedDate' ? v : (k === 'warrantyStart' ? v : form.warrantyStart);
        upd.commissionedDate = (comm && ws && String(comm) > String(ws))
          ? 'Commissioned Date must be on or before Warranty Start Date'
          : undefined;
      }
      return upd;
    });
  };

  function validate() {
    const e = validateProject(form);
    setErrors(e);
    if (!Object.keys(e).length) return true;
    const first = ALL_FIELDS.find(f => e[f.name] && isVisible(f, form));
    toast.error(first ? e[first.name] : 'Please check the highlighted fields');
    requestAnimationFrame(() => {
      document.querySelector('[data-field-error="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return false;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      /*  Send only what actually changed. Patching all 60 columns every time
          would stamp Last_Updated on rows nobody touched, and the update email
          lists "what changed" — a full patch would report everything.        */
      const full  = toProjectPayload(form);
      const before = toProjectPayload(original);
      const patch = {};
      for (const [k, v] of Object.entries(full)) {
        if (String(v ?? '') !== String(before[k] ?? '')) patch[k] = v;
      }

      /*  AMC terms are transient (they live on AMC_Contracts, not Projects) and
          are only present when the user actually fills them in on this edit —
          so this is non-null exactly when a new AMC schedule should be created.
          The backend skips any type that already has a contract, so re-saving
          never duplicates.                                                    */
      const amc = amcSetupPayload(form, id);

      if (!Object.keys(patch).length && !amc) {
        /*  Do NOT clear savedChanges here.

            setOriginal(form) runs after a successful save, so a SECOND press of
            Save Changes correctly finds nothing new — and this used to reset
            savedChanges to [], which disabled Send Update and threw away the
            list of what had just been saved. Pressing Save twice, which is a
            perfectly natural thing to do, silently cost you the ability to
            send the update at all.                                         */
        toast(savedChanges?.length
          ? 'Already saved — nothing further changed.'
          : 'Nothing changed.');
        return savedChanges ?? [];
      }

      let changes = savedChanges ?? [];
      if (Object.keys(patch).length) {
        const res = await api.patch(`/api/projects/${id}`, {
          ...patch,
          changed_by: user?.name || user?.email || 'staff',
          /* the threaded "Updated Order" email is sent explicitly from the modal */
          suppress_auto_email: true,
        });
        changes = res?.changes || [];
        setSavedChanges(changes);
      }

      if (amc) {
        try {
          const r = await api.post('/api/amc-setup/create', amc);
          const d = r?.data ?? r;
          const n = d?.contracts?.length || 0;
          toast.success(n
            ? `AMC schedule created · ${d.total_visits || 0} visit${(d.total_visits || 0) === 1 ? '' : 's'}`
            : 'AMC already set up — no duplicate created');
        } catch (e) {
          toast.error(e.message || 'Could not create the AMC schedule');
        }
      }

      setOriginal(form);
      toast.success(changes.length
        ? `✅ Saved · ${changes.length} field${changes.length > 1 ? 's' : ''} changed`
        : '✅ Saved');
      return changes;
    } catch (err) {
      toast.error(err.message || 'Failed to save project');
    } finally {
      setSaving(false);
    }
  }

  if (notFound) return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text1, marginBottom: 6 }}>Project not found</div>
      <button onClick={() => navigate('/projects')}
        style={{ marginTop: 8, background: C.primary, color: '#fff', border: 'none',
                 borderRadius: 10, padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        ← Back to Projects
      </button>
    </div>
  );

  if (!form) return <div style={{ padding: 24, color: C.text3, fontSize: 13 }}>Loading project…</div>;

  return (
    <div style={page}>
      <div style={{ background: '#fff', borderBottom: `1px solid ${C.border}`,
                    padding: '13px 18px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text1 }}>Edit Project</div>
        <div style={{ fontSize: 11, color: C.text3, marginTop: 2, whiteSpace: 'nowrap',
                      overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {proj?.name || id}
        </div>
      </div>

      <ProjectFormFields form={form} set={set} errors={errors} projectId={id}
                         statusOptions={statusOptions} isAdmin={isAdmin}
                         dropdownOptions={dropdownOptions}
                         onFieldBlur={(f) => { const e = validateProject(form); setErrors(prev => ({ ...prev, [f.name]: e[f.name] })); }} />

      {/*  Why the status list looks the way it does. Without this, a user who
           expects "Under SolarCare" and cannot find it has no way to discover
           that an AMC payment is missing an amount.                        */}
      {statusReason && (
        <div style={{ margin: '0 0 18px', padding: '10px 13px', borderRadius: 10,
                      background: 'rgba(56,132,255,0.07)',
                      border: '1px solid rgba(56,132,255,0.22)',
                      fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2, #55606e)' }}>
          <strong style={{ fontWeight: 700 }}>Status options:</strong> {statusReason}
        </div>
      )}

      {savedChanges && savedChanges.length > 0 && (
        <div style={{ margin: '0 16px 12px', padding: '11px 14px', background: '#ecfdf5',
                      border: '1px solid #a7f3d0', borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: '#065f46', lineHeight: 1.55 }}>
            <b>{savedChanges.length} field{savedChanges.length > 1 ? 's' : ''} changed.</b>{' '}
            Send the update to the team so the thread stays current.
          </div>
        </div>
      )}

      <Footer
        onSecondary={() => navigate(`/projects/${id}`)}
        secondaryLabel="Cancel"
        onMiddle={save}
        middleLabel={saving ? 'Saving…' : '✓ Save Changes'}
        middleColor={C.success}
        middleDisabled={saving}
        onPrimary={() => setEmailOpen(true)}
        primaryLabel="Send Update"
        primaryColor={C.primary}
        disabled={saving || !savedChanges || savedChanges.length === 0}
      />

      <ProjectUpdateEmailModal
        projectId={emailOpen ? id : null}
        projectName={proj?.name}
        mode="update"
        changes={savedChanges || []}
        onClose={() => setEmailOpen(false)}
        onSent={() => { setEmailOpen(false); navigate(`/projects/${id}`); }}
      />
    </div>
  );
}