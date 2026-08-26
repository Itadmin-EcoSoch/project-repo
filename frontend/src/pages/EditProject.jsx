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
  emptyProjectForm, validateProject, toProjectPayload, ALL_FIELDS, isVisible, toDateInput, fileNameKey
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
          loaded[f.name] = f.type === 'date'
            ? toDateInput(v)
            : ((v === undefined || v === null) ? '' : v);
          /*  The original filename, saved alongside the Drive path — see
              fileNameKey in lib/projectFields.js. Older rows saved before
              this existed just don't have the column yet, so nv is
              undefined and FileField.jsx falls back to deriving a name from
              the path, same as it always did.                            */
          if (f.type === 'file' && f.sheet) {
            const nv = row[`${f.sheet}_Name`];
            loaded[fileNameKey(f)] = (nv === undefined || nv === null) ? '' : nv;
          }
        }
        const merged = { ...emptyProjectForm(), ...loaded, projectName: p.name || '' };
        setForm(merged);
        setOriginal(merged);
        if (Array.isArray(p.status_options)) setStatusOptions(p.status_options);
        if (p.status_rule?.reason)           setStatusReason(p.status_rule.reason);
      })
      .catch(() => setNotFound(true));
  }, [id]);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
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

      if (!Object.keys(patch).length) {
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

      const res = await api.patch(`/api/projects/${id}`, {
        ...patch,
        changed_by: user?.name || user?.email || 'staff',
        /* the threaded "Updated Order" email is sent explicitly from the modal */
        suppress_auto_email: true,
      });

      const changes = res?.changes || [];
      setSavedChanges(changes);
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
                         dropdownOptions={dropdownOptions} />

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