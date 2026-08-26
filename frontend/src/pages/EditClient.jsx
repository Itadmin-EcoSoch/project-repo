import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { SEED_CLIENTS } from '../lib/data';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import { mergeOptions } from '../lib/projectFields';

/*  Both lists are the AppSheet Enum values, imported rather than repeated so
    the edit form can never drift from the add form.                        */
import { REGIONS, CLIENT_IDENTITIES, PhoneField, STextarea } from './formKit';
import { TEXT_MAX, TEXTAREA_MAX, EMAIL_MAX, sanitizeText, sanitizeEmail } from '../lib/fieldLimits';
import { splitPhone, validatePhone } from '../lib/countryCodes';
const CLI_TYPES = CLIENT_IDENTITIES;

export default function EditClient() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [form, setForm]     = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  /*  Same admin-managed lists as AddClient.jsx — Project_Region is open for
      any signed-in user to add to (see routes/dropdownOptions.js), the
      Client Identity list is Admin-only, both via /admin/dropdowns. `form`
      is null until the client loads, so every access below is optional.    */
  const { dropdownOptions } = useDropdownOptions();
  const regionOptions =
    mergeOptions(REGIONS, dropdownOptions?.Project_Region, form?.region);
  const cliTypeOptions =
    mergeOptions(CLI_TYPES, dropdownOptions?.Client_Identity, form?.clientType);

  useEffect(() => {
    api.get(`/api/clients/${id}`)
      .then(res => {
        const c = res.data;
        setForm({
          name:       c.name        || '',
          latlng:     c.lat && c.lng ? `${c.lat}, ${c.lng}` : '',
          address:    c.billing_address || '',
          mobile:     c.phone       || '',
          email:      c.email       || '',
          region:     c.region      || 'Bangalore',
          clientType: c.client_identity || '',
          typeOfClient: c.type_of_client || 'Internal',
          notes:      c.notes       || '',
        });
      })
      .catch(() => {
        const c = SEED_CLIENTS.find(x => x.id === id);
        if (c) setForm({
          name:       c.name        || '',
          latlng:     c.lat && c.lng ? `${c.lat}, ${c.lng}` : '',
          address:    c.billing_address || '',
          mobile:     c.phone       || '',
          email:      c.email       || '',
          region:     c.region      || 'Bangalore',
          clientType: c.client_identity || '',
          typeOfClient: c.type_of_client || 'Internal',
          notes:      c.notes       || '',
        });
      });
  }, [id]);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined }));
  };

  function validate() {
    const e = {};
    if (!form.name.trim())    e.name    = 'Required';
    if (!form.address.trim()) e.address = 'Required';
    if (!form.clientType)     e.clientType = 'Required';

    const { dial, number } = splitPhone(form.mobile);
    const phoneErr = validatePhone(dial, number);
    if (phoneErr) e.mobile = phoneErr;

    if (form.name.length    > TEXT_MAX)     e.name    = `Cannot exceed ${TEXT_MAX} characters`;
    if (form.address.length > TEXTAREA_MAX) e.address = `Cannot exceed ${TEXTAREA_MAX} characters`;
    if (form.notes.length   > TEXTAREA_MAX) e.notes   = `Cannot exceed ${TEXTAREA_MAX} characters`;
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      e.email = 'That does not look like an email address';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      /* Parse "lat, lng" only if it's actually valid — never inject default
         coordinates, and send nothing for lat/lng when the field is blank
         so we don't wipe an existing pin. */
      const payload = {
        name:             form.name,
        phone:            form.mobile,
        email:            form.email,
        billing_address:  form.address,
        region:           form.region,
        client_identity:  form.clientType,
        type_of_client:   form.typeOfClient,
        notes:            form.notes,
        changed_by:       'staff',
      };
      const m = (form.latlng || '').match(/(-?\d{1,3}(?:\.\d+)?)[\s,;]+(-?\d{1,3}(?:\.\d+)?)/);
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (!Number.isNaN(lat) && !Number.isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          payload.lat = lat; payload.lng = lng;
        }
      }
      await api.patch(`/api/clients/${id}`, payload);
      toast.success('✅ Client updated!');
      navigate(`/clients/${id}`);
    } catch (err) {
      /* Do NOT fake success — surface the real error so failed updates
         (like Type of Client not saving) are visible instead of silent. */
      toast.error(err.message || 'Failed to update client');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <div style={{ padding:20, color:'#9ca3af', fontSize:13 }}>Loading…</div>;

  return (
    <div className="form-page">

      <div style={{ padding:'8px 14px', background:'#fff7ed', borderBottom:'1px solid #fed7aa' }}>
        <p style={{ fontSize:11, fontWeight:700, color:'#c2410c', textTransform:'uppercase', letterSpacing:'.06em' }}>
          Editing Client
        </p>
        <p style={{ fontSize:13, fontWeight:600, color:'#111', marginTop:2 }}>{form.name}</p>
      </div>

      {/* Name */}
      <div className="form-field">
        <label className="f-label">End Customer Name<span className="f-req">*</span></label>
               <input className={`f-input${errors.name ? ' err' : ''}`} maxLength={TEXT_MAX}
          value={form.name} onChange={e => set('name', sanitizeText(e.target.value, TEXT_MAX))} />
        {errors.name && <p className="f-err">{errors.name}</p>}
      </div>

      {/* Lat/Lng */}
      <div className="form-field">
        <label className="f-label">Latitude, Longitude</label>
        <input className="f-input" placeholder="e.g. 13.065237, 77.576867"
          value={form.latlng} onChange={e => set('latlng', e.target.value)} />
      </div>

      {/* Address */}
      <div className="form-field">
        <label className="f-label">Client's billing address<span className="f-req">*</span></label>
                <STextarea value={form.address} hasError={!!errors.address}
          onChange={e => set('address', e.target.value)} />
        {errors.address && <p className="f-err">{errors.address}</p>}
      </div>

      {/* Mobile */}
      <div className="form-field">
                <label className="f-label">Mobile<span className="f-req">*</span></label>
        <PhoneField value={form.mobile} onChange={v => set('mobile', v)} hasError={!!errors.mobile} />
        {errors.mobile && <p className="f-err">{errors.mobile}</p>}
      </div>

      {/* Email */}
      <div className="form-field">
        <label className="f-label">Client_Email</label>
                <input className="f-input" type="email" maxLength={EMAIL_MAX}
          value={form.email} onChange={e => set('email', sanitizeEmail(e.target.value))} />
      </div>

      {/* Region */}
      <div className="form-field">
        <label className="f-label">Client_Region<span className="f-req">*</span></label>
        <select className="f-select" value={form.region} onChange={e => set('region', e.target.value)}>
          {regionOptions.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>

      {/* Type */}
      <div className="form-field">
        <label className="f-label">Type of Client:<span className="f-req">*</span></label>
        <select className={`f-select${errors.clientType ? ' err' : ''}`}
          value={form.clientType} onChange={e => set('clientType', e.target.value)}>
          <option value="">Select…</option>
          {cliTypeOptions.map(t => <option key={t}>{t}</option>)}
        </select>
        {errors.clientType && <p className="f-err">{errors.clientType}</p>}
      </div>

      {/* Type of Client (Internal / External) */}
      <div className="form-field">
        <label className="f-label">Type of Client (Internal / External)</label>
        <div style={{ display:'flex', gap:10 }}>
          {[
            { v:'Internal', label:'Internal (EPC, I&C)' },
            { v:'External', label:'External (AMC)' },
          ].map(o=>{
            const active = form.typeOfClient===o.v;
            return (
              <button key={o.v} type="button" onClick={()=>set('typeOfClient',o.v)}
                style={{ flex:1, height:46, borderRadius:10, fontSize:12, fontWeight:700, cursor:'pointer',
                  border:`2px solid ${active?'#7c3aed':'#e2e8f0'}`,
                  background: active?'#f5f3ff':'#fff', color: active?'#7c3aed':'#475569', transition:'all .15s' }}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div className="form-field">
        <label className="f-label">Notes about the client</label>
            <STextarea value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      <div className="form-footer">
        <button className="btn-cancel" onClick={() => navigate(`/clients/${id}`)}>Cancel</button>
        <button className="btn-save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}