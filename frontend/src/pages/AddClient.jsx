import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { saveClientDraft } from '../lib/clientDraft';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import { mergeOptions } from '../lib/projectFields';
import { useDebounce } from '../hooks/useDebounce';

import {
  C, page, card, cardHeader, cardIconBg, fieldWrap, fieldLabel, reqStar, errMsg,
  inputBase, SInput, SSelect, STextarea, PhoneField, Field, Card, Footer,
  REGIONS, CLIENT_IDENTITIES, CLIENT_KINDS, SelectOrType,
} from './formKit';
import { TEXT_MAX, TEXTAREA_MAX, sanitizeEmail, EMAIL_MAX } from '../lib/fieldLimits';
import { DEFAULT_DIAL, splitPhone, validatePhone } from '../lib/countryCodes';

const init = () => ({
  /*  mobile starts as an empty string, NOT '+91 '. joinPhone returns '' for an
      empty number precisely so a form that is abandoned half-filled does not
      leave a stranded dial code in the sheet. PhoneField shows +91 as the
      selected country regardless — see splitPhone's empty-value branch.    */
  name:'', nameTag:'', lat:'', lng:'', address:'', mobile:'', email:'',
  /*  clientIdentity starts EMPTY, not 'Individual'. A pre-selected value gets
      accepted without being read, and most misfiled clients come from a default
      nobody looked at. The field is required, so the form will not save until
      it has been chosen deliberately.                                        */
  region:'Bangalore', clientIdentity:'', typeOfClient:'', notes:'',
});

/* ── Robust "lat, lng" parser ─────────────────────────────────────
   Accepts:  13.070653120798728, 77.5914228197834
             13.070653,77.591422   ·   13.070653 77.591422
             (13.070653, 77.591422)   ·   13.0706° N, 77.5914° E
             Google Maps URLs containing @13.07,77.59 or q=13.07,77.59  */
function parseCoords(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // Google Maps URL patterns first
  const url = s.match(/[@=](-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (url) s = `${url[1]}, ${url[2]}`;
  // strip degree symbols, quotes, direction letters, brackets
  s = s.replace(/[()\[\]°º'"]/g, ' ').replace(/\b[NnEeSsWw]\b/g, ' ');
  const m = s.match(/(-?\d{1,3}(?:\.\d+)?)[\s,;]+(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

/* ── Location card with Google Maps embed (terrain/satellite/map layers) ── */
const MAP_LAYERS = [
  { id:'roadmap',   label:'Map',       icon:'🗺️' },
  { id:'terrain',   label:'Terrain',   icon:'🏔️' },
  { id:'satellite', label:'Satellite', icon:'🛰️' },
];

function LocationCard({ lat, lng, address, onChange }) {
  const [locating,  setLocating]  = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [mapLayer,  setMapLayer]  = useState('roadmap');
  const [locMode,   setLocMode]   = useState('');   // 'gps' | 'manual' | 'address'
  const [paste,     setPaste]     = useState('');
  const debAddress = useDebounce(address, 900);

  /* Auto-fetch GPS location from the billing address (OpenStreetMap Nominatim).
     Runs 0.9s after typing stops. Never overwrites a GPS capture or a
     manually-entered / pasted coordinate — only fills when nothing is set yet
     or when the previous pin also came from the address. */
  useEffect(() => {
    if (!debAddress || debAddress.trim().length < 6) return;
    if (locMode === 'gps' || locMode === 'manual') return;
    let cancelled = false;
    setGeocoding(true);
    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(debAddress)}`)
      .then(r => r.json())
      .then(rows => {
        if (cancelled) return;
        if (rows?.[0]?.lat && rows?.[0]?.lon) {
          onChange(parseFloat(rows[0].lat).toFixed(6), parseFloat(rows[0].lon).toFixed(6));
          setLocMode('address');
          toast.success('📍 Location pinned from billing address', { id:'geo-addr', duration:2500 });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setGeocoding(false); });
    return () => { cancelled = true; };
  }, [debAddress]);   // eslint-disable-line react-hooks/exhaustive-deps

  const hasCoords = lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng));
  const latF = hasCoords ? parseFloat(lat).toFixed(6) : '';
  const lngF = hasCoords ? parseFloat(lng).toFixed(6) : '';

  const googleMapSrc = hasCoords
    ? `https://maps.google.com/maps?q=${latF},${lngF}&z=17&t=${
        mapLayer === 'roadmap' ? 'm' : mapLayer === 'terrain' ? 'p' : 'k'
      }&output=embed&iwloc=near`
    : '';

  // Capture the salesperson's current device location (they're at the site)
  function captureLocation() {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported by this browser');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const newLat = pos.coords.latitude.toFixed(6);
        const newLng = pos.coords.longitude.toFixed(6);
        onChange(newLat, newLng);
        setLocMode('gps');
        setPaste('');
        toast.success(`📡 Location captured: ${newLat}, ${newLng}`, { duration: 3000 });
        setLocating(false);
      },
      err => {
        setLocating(false);
        const msgs = {
          1: 'Permission denied — allow location access in the browser',
          2: 'Position unavailable — check GPS signal',
          3: 'GPS timed out — try again',
        };
        toast.error(msgs[err.code] || 'Could not get location');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // Accept a pasted "lat, lng" string or Google Maps link and pin it instantly
  function handlePaste(val) {
    setPaste(val);
    const c = parseCoords(val);
    if (c) {
      onChange(c[0].toFixed(6), c[1].toFixed(6));
      setLocMode('manual');
      toast.success(`📍 Pinned: ${c[0].toFixed(6)}, ${c[1].toFixed(6)}`, { id:'geo-paste', duration:2200 });
    }
  }

  return (
    <div style={card}>
      <div style={{ ...cardHeader(C.success), justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={cardIconBg(C.success)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
              <circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/>
            </svg>
          </div>
          <div>
            <span style={{ fontSize:12, fontWeight:700, color:C.text1 }}>Site Location</span>
            {geocoding && (
              <span style={{ fontSize:10, fontWeight:600, marginLeft:8, color:C.accent }}>⟳ Locating from address…</span>
            )}
            {!geocoding && hasCoords && (
              <span style={{ fontSize:10, fontWeight:600, marginLeft:8, color: C.success }}>
                ● {locMode==='gps' ? 'GPS Pinned' : locMode==='address' ? 'Pinned from Address' : 'Coordinates Set'}
              </span>
            )}
          </div>
        </div>
        <button onClick={captureLocation} disabled={locating} style={{
          display:'flex', alignItems:'center', gap:6,
          background: locating ? C.surface : `linear-gradient(135deg,${C.success},#047857)`,
          color: locating ? C.text3 : '#fff',
          border:'none', borderRadius:22, padding:'7px 14px',
          fontSize:11, fontWeight:700, cursor: locating?'not-allowed':'pointer',
          boxShadow: locating?'none':'0 2px 8px rgba(5,150,105,.3)',
          transition:'all .2s',
        }}>
          {locating ? (
            <><div style={{ width:11,height:11,border:'2px solid #94a3b8',borderTop:'2px solid transparent',borderRadius:'50%',animation:'spin .7s linear infinite' }}/>Capturing…</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>Capture GPS Location</>
          )}
        </button>
      </div>

      <div style={{ padding:'13px 16px', borderBottom:`1px solid ${C.surface}` }}>
        <label style={fieldLabel}>Coordinates</label>

        {/* Quick paste — accepts "13.0686, 77.5913" copied from Google Maps */}
        <div style={{ marginBottom:10 }}>
          <input
            value={paste}
            onChange={e=>handlePaste(e.target.value)}
            placeholder="Paste coordinates here  ·  e.g. 13.068579, 77.591302"
            style={{ ...inputBase, fontFamily:'monospace', fontSize:12 }}
          />
          <div style={{ fontSize:10, color:C.text3, marginTop:4 }}>
            Tip: in Google Maps, long-press the spot → copy the numbers → paste here.
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <div style={{ fontSize:10,fontWeight:700,color:C.text3,marginBottom:5,textAlign:'center',letterSpacing:'.05em' }}>LATITUDE</div>
            <SInput type="number" value={lat} placeholder="e.g. 13.068579"
              onChange={e=>{ onChange(e.target.value,lng); setLocMode('manual'); }}
              style={{ textAlign:'center',fontFamily:'monospace',fontWeight:600 }}/>
          </div>
          <div>
            <div style={{ fontSize:10,fontWeight:700,color:C.text3,marginBottom:5,textAlign:'center',letterSpacing:'.05em' }}>LONGITUDE</div>
            <SInput type="number" value={lng} placeholder="e.g. 77.591302"
              onChange={e=>{ onChange(lat,e.target.value); setLocMode('manual'); }}
              style={{ textAlign:'center',fontFamily:'monospace',fontWeight:600 }}/>
          </div>
        </div>

        {hasCoords && (
          <div style={{ marginTop:8,display:'flex',alignItems:'center',gap:8,padding:'7px 11px',background:'#ecfdf5',borderRadius:8,border:'1px solid #a7f3d0' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill={C.success}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            <div style={{ flex:1 }}>
              <span style={{ fontSize:12,color:C.success,fontWeight:700,fontFamily:'monospace' }}>{latF}, {lngF}</span>
              {locMode && <span style={{ fontSize:10,color:C.text3,marginLeft:8 }}>via {locMode==='gps'?'device GPS':locMode==='address'?'billing address':'manual entry'}</span>}
            </div>
            <button onClick={()=>{onChange('','');setLocMode('');setPaste('');}} style={{ background:'none',border:'none',cursor:'pointer',color:C.text3,fontSize:16,lineHeight:1 }}>×</button>
          </div>
        )}
      </div>

      {hasCoords && (
        <div style={{ display:'flex', borderBottom:`1px solid ${C.border}`, background:'#f8fafc' }}>
          {MAP_LAYERS.map(l => (
            <button key={l.id} onClick={()=>setMapLayer(l.id)} style={{
              flex:1, padding:'8px 4px', border:'none', background:'none',
              borderBottom:`2px solid ${mapLayer===l.id ? C.accent : 'transparent'}`,
              color: mapLayer===l.id ? C.primary : C.text3,
              fontSize:11, fontWeight:700, cursor:'pointer',
              fontFamily:'inherit', transition:'all .15s',
              display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}>
              <span style={{ fontSize:13 }}>{l.icon}</span>
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ position:'relative', height:230, background:'#f0f4f8' }}>
        {!hasCoords ? (
          <div style={{ position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,background:'#f8fafc' }}>
            <div style={{ width:52,height:52,borderRadius:'50%',background:C.accentL,display:'flex',alignItems:'center',justifyContent:'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                <circle cx="12" cy="9" r="2.5"/>
              </svg>
            </div>
            <div style={{ textAlign:'center', padding:'0 24px' }}>
              <div style={{ fontSize:13,fontWeight:600,color:C.text2 }}>No location set</div>
              <div style={{ fontSize:11,color:C.text3,marginTop:3 }}>
                At the site? Tap <b>Capture GPS Location</b>. Otherwise paste or type the site coordinates above and the map pins automatically.
              </div>
            </div>
          </div>
        ) : (
          <iframe
            key={`${latF},${lngF},${mapLayer}`}
            src={googleMapSrc}
            width="100%"
            height="230"
            style={{ border:'none', display:'block' }}
            title="Site location"
            loading="lazy"
            referrerPolicy="no-referrer"
            allowFullScreen
          />
        )}

        {hasCoords && (
          <a
            href={`https://www.google.com/maps?q=${latF},${lngF}&z=17`}
            target="_blank" rel="noopener noreferrer"
            style={{
              position:'absolute', bottom:10, right:10,
              background:'rgba(255,255,255,.95)',
              border:`1px solid ${C.border}`,
              borderRadius:8, padding:'5px 10px',
              fontSize:11, color:C.primary, fontWeight:700,
              textDecoration:'none',
              backdropFilter:'blur(6px)',
              display:'flex', alignItems:'center', gap:5,
              boxShadow:'0 2px 8px rgba(0,0,0,.12)',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.primary} strokeWidth="2.5" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            Open in Maps
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Type-of-Client radio (mirrors the AppSheet "Type of Client:" prompt) ── */
function TypeOfClientCard({ value, onChange, error }) {
  return (
    <Card color={C.purple}
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>}
      title="Type of Client">
      <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
        {CLIENT_KINDS.map(k=>{
          const active = value===k.v;
          return (
            <button key={k.v} onClick={()=>onChange(k.v)} style={{
              display:'flex', alignItems:'center', gap:12, textAlign:'left',
              padding:'13px 14px', borderRadius:12, cursor:'pointer',
              border:`2px solid ${active?C.purple:C.border}`,
              background: active?'#f5f3ff':'#fff',
              transition:'all .15s', boxShadow: active?`0 2px 8px ${C.purple}25`:'none',
            }}>
              <div style={{
                width:20, height:20, borderRadius:'50%', flexShrink:0,
                border:`2px solid ${active?C.purple:C.border}`,
                display:'flex', alignItems:'center', justifyContent:'center',
                background: active?C.purple:'#fff',
              }}>
                {active && <div style={{ width:8, height:8, borderRadius:'50%', background:'#fff' }}/>}
              </div>
              <span style={{ fontSize:18 }}>{k.emoji}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color: active?C.purple:C.text1 }}>{k.label}</div>
                <div style={{ fontSize:11, color:C.text3, marginTop:1 }}>{k.sub}</div>
              </div>
            </button>
          );
        })}
        {error && <p style={errMsg}><span>⚠</span>{error}</p>}
      </div>
    </Card>
  );
}

/* ── Main component — CLIENT ONLY ────────────────────────────────── */
export default function AddClient() {
  const navigate = useNavigate();
  const [form,   setForm]   = useState(init());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [dup,    setDup]    = useState(null);

  /*  Regions added centrally through the Admin screen (pages/AdminDropdowns.jsx,
      field key 'Project_Region') show up here too, so a region added on either
      this form or that screen is visible on both — one list, not two.        */
  const { dropdownOptions } = useDropdownOptions();
  const regionOptions = mergeOptions(REGIONS, dropdownOptions?.Project_Region, form.region);

  /*  Client Identity has no inline "+Add" on this form (it never has) — new
      values are Admin-only, added from the same Admin screen under field key
      'Client_Identity'. This just merges them into the picker; adding one
      still only happens on /admin/dropdowns, not here.                      */
  const clientIdentityOptions =
    mergeOptions(CLIENT_IDENTITIES, dropdownOptions?.Client_Identity, form.clientIdentity);
  /*  Final saved name = name + optional tag, separated by a single space:
      "Srilekha Thuraka", not "Srilekha (Thuraka)".

      The brackets were doing a job — they made it obvious which part was the
      tag — but they travel everywhere the name does: into Project_Name, into
      the New Order Form subject line, onto the printed PO. A customer reading
      "New Order - Srilekha (Thuraka)_Whitefield_5kWp" sees punctuation that
      means nothing to them.

      The tag still does its real job, which is making two same-name clients
      distinguishable. It is just now part of the name rather than an
      annotation on it.

      NOTE ON EXISTING DATA: the 1,501 client rows already in the sheet keep
      whatever they have, brackets included. Nothing here rewrites them, and
      the duplicate check matches loosely enough that an old "Srilekha
      (Thuraka)" and a new "Srilekha Thuraka" will still flag each other.   */
  const fullName = form.nameTag.trim()
    ? `${form.name.trim()} ${form.nameTag.trim()}`.replace(/\s{2,}/g, ' ')
    : form.name.trim();

  /*  ── THE CHECK RUNS ON THE NAME, NOT THE NAME PLUS TAG ────────────────
      It used to send fullName. The tag's own letters then counted towards the
      similarity score, so typing a tag CAUSED the warning instead of
      answering it:

          "vasanth"            vs "Vasanth kumar"    0.538  -> quiet
          "vasanth shh"        vs "Vasanth kumar"    0.846  -> warned
          "vasanth shheyhee"   vs "vasanthi sridhar" 0.750  -> warned
          "vasanth adgsd"      vs "Vasanth kumar"    0.769  -> warned

      That is also why the client it named kept changing mid-typing: the
      letters in "shh" overlap "kumar", the letters in "shheyhee" overlap
      "sridhar", so a different row won each time.

      The tag exists to say "I know, this is a different person." Feeding it
      back into the thing it is meant to answer was the whole bug.        */

        const debName = useDebounce(form.name.trim(), 420);
  const debFull = useDebounce(fullName, 420);

  /*  CHECK 1 — advisory. Is there a client with a similar BASE name?
      Answers "you may be about to create a second Vasanth". Runs on the name
      alone so the tag's letters cannot influence it.                      */
  useEffect(() => {
    if (!debName || debName.length < 3) { setDup(null); return; }
    api.get(`/api/clients/check-duplicate?name=${encodeURIComponent(debName)}`)
      .then(res => setDup(res?.duplicate ? res.match : null))
      .catch(() => setDup(null));
  }, [debName]);

  /*  CHECK 2 — blocking. Is the FULL name, tag included, already taken?

      This is the one that was missing. dupResolved used to mean nothing more
      than "a tag exists", so typing tag "kumar" under name "vasanth" turned
      the box green and announced the tag kept it separate — while producing
      "vasanth kumar", which is exactly the client it was warning about.

      Only runs when a tag is present: debFull === debName means no tag, and
      check 1 has already answered that case.                              */
  const [taken, setTaken] = useState(null);
  useEffect(() => {
    if (!debFull || debFull.length < 3 || debFull === debName) { setTaken(null); return; }
        /*  exact=1 — only a literal match blocks. Without it the endpoint's
        containment rule fires, and "Srilekha Thuraka white" is refused for
        colliding with "Srilekha Thuraka", which is a different client.   */
    api.get(`/api/clients/check-duplicate?name=${encodeURIComponent(debFull)}&exact=1`)
      .then(res => setTaken(res?.duplicate ? res.match : null))
      .catch(() => setTaken(null));
  }, [debFull, debName]);

  /*  Three states, not two:
        taken       the tag did not help — this exact name already exists
        resolved    a tag is present AND the result is genuinely different
        (neither)   no tag yet, so the advisory still stands              */
  const tagged      = Boolean(form.nameTag.trim());
  const dupResolved = Boolean(dup) && tagged && !taken;


  const set = (k,v) => { setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:undefined})); };

  function validate() {
    const e={};
    if (!form.name.trim())    e.name         = 'Customer name is required';
    if (!form.address.trim()) e.address      = 'Billing address is required';
    if (!form.clientIdentity) e.clientIdentity = 'Please select a client identity';
    if (!String(form.region || '').trim()) e.region = 'Region is required';
    if (!form.typeOfClient)   e.typeOfClient = 'Please choose Internal or External';

    /*  Checked against the chosen country, so an Indian number is held to the
        real rule — ten digits starting 6-9 — while an overseas one is only
        sanity-checked for length. A validator stricter than reality just
        blocks a real customer with no way round it.                       */
    const { dial, number } = splitPhone(form.mobile);
    const phoneErr = validatePhone(dial, number);
    if (phoneErr) e.mobile = phoneErr;

    /*  The inputs cap length as you type, so these only fire on a value that
        arrived some other way — a paste that outran the handler, or a draft
        restored from sessionStorage written by an older build.            */
        if (fullName.length > TEXT_MAX)      e.name    = `Name and tag together cannot exceed ${TEXT_MAX} characters`;

    /*  A name that exactly matches an existing client is refused, because the
        two become indistinguishable everywhere the name is used — the project
        name, the New Order subject line, the client picker. And with
        Client_Id empty on all 1,542 project rows, the NAME is currently the
        only link between a project and its client, so two identical ones are
        genuinely ambiguous rather than merely untidy.

        The way through is a better tag, which is what the message asks for. */
    if (taken) e.name = `A client called "${fullName}" already exists — make the tag more specific`;
    if (form.address.length > TEXTAREA_MAX) e.address = `Address cannot exceed ${TEXTAREA_MAX} characters`;
    if (form.notes.length   > TEXTAREA_MAX) e.notes   = `Notes cannot exceed ${TEXTAREA_MAX} characters`;
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      e.email = 'That does not look like an email address';
    }

    setErrors(e); return !Object.keys(e).length;
  }

  /*  ── NOTHING IS WRITTEN TO THE SHEET HERE ────────────────────────────────
      This used to POST /api/clients, which appended a row to the Clients tab
      the instant Save was pressed. If the user then abandoned the project form
      — or it failed — the sheet was left holding a client with no project, and
      nothing ever cleaned those up.

      A client exists because there is a project for them. So the filled-in form
      is stashed (lib/clientDraft.js) and carried to the project form instead.
      Both rows are then written by a single POST /api/orders with
      client_type:'new', inside one Apps Script lock: either the client AND the
      project are saved, or neither is.

      This function is therefore synchronous and cannot fail — there is no
      network call left in it. `saving` is kept only so the button cannot be
      double-clicked into two navigations.                                   */
  function submit() {
    if (!validate()) return;
    setSaving(true);

    const latN = parseFloat(form.lat);
    const lngN = parseFloat(form.lng);

    /*  App field names, not sheet column names — this object is sent verbatim
        as the `client` half of POST /api/orders, which maps it through
        toSheet(MAP.clients, …) in backend/routes/orders.js. Keep the keys in
        step with backend/lib/mapping.js if either side changes.            */
    const draft = {
      name           : fullName,
      phone          : form.mobile,
      email          : form.email,
      billing_address: form.address,
      lat            : Number.isNaN(latN) ? null : latN,
      lng            : Number.isNaN(lngN) ? null : lngN,
      region         : form.region,
      client_identity: form.clientIdentity,
      client_status  : 'Normal',
      type_of_client : form.typeOfClient,
      notes          : form.notes,
    };

    /*  A region typed in here that is not on either list (built-in or
        admin-added) should be added to Dropdown_Options centrally — but only
        once the client it was typed on is actually saved. Carried along as a
        leading-underscore key, which toSheet() ignores, and acted on by
        AddProject after the order succeeds.                                */
    const typed = String(form.region || '').trim();
    if (typed) {
      const alreadyKnown =
        REGIONS.some(v => v.toLowerCase() === typed.toLowerCase()) ||
        (dropdownOptions?.Project_Region || []).some(v => v.toLowerCase() === typed.toLowerCase());
      if (!alreadyKnown) draft._newRegion = typed;
    }

    saveClientDraft(draft);

    toast.success('Client details ready — add their first project to save both.');
    navigate('/clients/new/add-project', { state: { clientDraft: draft } });
  }

  return (
    <div style={page}>
      {/* Heading strip */}
      <div style={{ background:'#fff', borderBottom:`1px solid ${C.border}`, padding:'13px 18px', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize:14, fontWeight:800, color:C.text1 }}>Add Client</div>
        <div style={{ fontSize:11, color:C.text3, marginTop:2 }}>
          Nothing is saved yet — the client is written to the sheet only when their first project is saved.
        </div>
      </div>

      <div className="ac-grid">
        {/* ── LEFT pane: client details ── */}
        <div className="ac-col">

      {/* Client info */}
      <Card color={C.primary}
        icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
        title="Client Information">

        <Field label="End Customer Name" required error={errors.name}>
                    {/*  ── THE 100 CHARACTERS ARE SHARED, NOT SPLIT ──────────────────
               Name and tag are stored as ONE string in Client_Name, so they do
               have to share a budget. A fixed 70/30 split was the wrong way to
               spend it: an 8-character name should let you write a 91-
               character tag, and it did not — the tag stopped dead at 30.

               Each box now offers whatever the other one is not using, minus
               the single space that joins them. The counter under the preview
               shows the combined total, which is the number that actually
               reaches the sheet.                                           */}
          <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:10 }}>
            <SInput value={form.name} onChange={e=>set('name',e.target.value)}
                    placeholder="Enter full name"
                    maxLength={Math.max(1, TEXT_MAX - (form.nameTag.trim() ? form.nameTag.trim().length + 1 : 0))}
                    hasError={!!errors.name}/>
            <SInput value={form.nameTag} onChange={e=>set('nameTag',e.target.value)}
                    placeholder="Tag · surname / area"
                    maxLength={Math.max(1, TEXT_MAX - (form.name.trim() ? form.name.trim().length + 1 : 0))}/>
          </div>
          <div style={{ fontSize:10, color:C.text3, marginTop:4 }}>
            Tag is optional — use a surname, locality or landmark to tell same-name clients apart.
          </div>
                    {form.nameTag.trim() && form.name.trim() && (
            <div style={{ marginTop:6, fontSize:11, color:C.text2 }}>
              Will be saved as: <strong>{fullName}</strong>
              <span style={{ marginLeft:6,
                             color: fullName.length >= TEXT_MAX ? C.danger
                                  : fullName.length >= TEXT_MAX * 0.9 ? C.warning
                                  : C.text3 }}>
                {fullName.length}/{TEXT_MAX}
                {fullName.length < TEXT_MAX && ` · ${TEXT_MAX - fullName.length} left`}
              </span>
            </div>
          )}

                  {/*  Red   — the full name is already taken; the tag changed nothing
               Green — tagged, and the result is genuinely distinct
               Amber — no tag yet, here is what you might collide with     */}
          {(dup || taken) && (
            <div style={{
              marginTop:8, display:'flex', gap:8, alignItems:'flex-start',
              padding:'9px 12px', borderRadius:9, fontSize:11, lineHeight:1.55,
              background: taken ? '#fef2f2' : dupResolved ? '#f0fdf4' : '#fffbeb',
              border   : `1px solid ${taken ? '#fecaca' : dupResolved ? '#bbf7d0' : '#fde68a'}`,
              color    : taken ? '#991b1b' : dupResolved ? '#166534' : '#92400e',
            }}>
              <span style={{ fontSize:13, flexShrink:0 }}>
                {taken ? '✕' : dupResolved ? '✓' : '⚠️'}
              </span>

              {taken ? (
                <span>
                  <strong>{fullName}</strong> is already a client
                  {taken.phone ? ` (${taken.phone})` : ''}. Your tag has not made
                  this one different — try a locality, a landmark, or a fuller
                  surname instead.
                </span>
              ) : dupResolved ? (
                <span>
                  There is already a client called <strong>{dup.name}</strong>
                  {dup.phone ? ` (${dup.phone})` : ''}. Your tag keeps this one
                  separate — it will be saved as <strong>{fullName}</strong>.
                </span>
              ) : (
                <span>
                  <strong>{dup.name}</strong>{dup.phone ? ` (${dup.phone})` : ''} already
                  exists. If this is a different person, add a <strong>tag</strong> —
                  a surname or locality — in the box beside the name.
                </span>
              )}
            </div>
          )}  

        </Field>

                {/*  A textarea, not a one-line box. A real Indian billing address —
             "#22, Sector A, Ramaiah Reddy Colony, Marathahalli, Bangalore - 37"
             — does not fit legibly on one line, and this field also seeds the
             geocoder and gets copied to Site Address on the project form.  */}
        <Field label="Client's Billing Address" required error={errors.address} showErrorText>
          <STextarea value={form.address} onChange={e=>set('address',e.target.value)}
                     placeholder="Full billing address" hasError={!!errors.address}/>
        </Field>

        <div style={{ ...fieldWrap, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                 <div>
            <label style={fieldLabel}>Mobile<span style={reqStar}>*</span></label>
            <PhoneField value={form.mobile} onChange={v=>set('mobile',v)} hasError={!!errors.mobile}/>
            {errors.mobile && <p style={errMsg}><span>⚠</span>{errors.mobile}</p>}
            <div style={{ fontSize:10, color:C.text3, marginTop:4 }}>
             
            </div>
          </div>
          <div>
            <label style={fieldLabel}>Email</label>
            <SInput value={form.email} onChange={e=>set('email', sanitizeEmail(e.target.value))}
                    type="email" placeholder="name@domain.com" maxLength={EMAIL_MAX}
                    sanitize={false} hasError={!!errors.email}/>
            {errors.email && <p style={errMsg}><span>⚠</span>{errors.email}</p>}
          </div>
        </div>

        <div style={{ ...fieldWrap, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label style={fieldLabel}>Region<span style={reqStar}>*</span></label>
            {/*  SelectOrType, not a plain select: the eight AppSheet regions
                 cover most clients, but one outside them must still be
                 recordable rather than forced into "Rest of India".        */}
            <SelectOrType value={form.region} options={regionOptions}
                          onChange={v=>set('region',v)}
                          addLabel="＋ Add a region not on the list"
                          typePlaceholder="Type the region"
                          keepUnknown
                          hasError={!!errors.region}/>
            {errors.region && <p style={errMsg}><span>⚠</span>{errors.region}</p>}
          </div>
          <div>
            <label style={fieldLabel}>Client Identity<span style={reqStar}>*</span></label>
            {/*  Clients.Client_Identity in AppSheet — what KIND of customer
                 this is. Separate from the Internal/External radio below,
                 which is Client_Type.                                      */}
            <SSelect value={form.clientIdentity} onChange={e=>set('clientIdentity',e.target.value)}
                     options={clientIdentityOptions} placeholder="Select…" hasError={!!errors.clientIdentity}/>
            {errors.clientIdentity && <p style={errMsg}><span>⚠</span>{errors.clientIdentity}</p>}
          </div>
        </div>

        <Field label="Notes (contact time, site-in-charge, etc.)">
          <STextarea value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional notes about this client…"/>
        </Field>
      </Card>

      {/* Type of Client radio */}
      <TypeOfClientCard value={form.typeOfClient} onChange={v=>set('typeOfClient',v)} error={errors.typeOfClient}/>

        </div>{/* /left pane */}

        {/* ── RIGHT pane: site location ── */}
        <div className="ac-col">
      {/* Location */}
      <LocationCard lat={form.lat} lng={form.lng} address={form.address} onChange={(lat,lng)=>setForm(f=>({...f,lat,lng}))}/>
        </div>{/* /right pane */}
      </div>{/* /ac-grid */}

      <Footer
        onSecondary={()=>navigate('/clients')} secondaryLabel="Cancel"
        onPrimary={submit}
        primaryLabel={saving ? 'Opening…' : 'Continue → Add Project'}
        primaryColor={C.success}
        disabled={saving}
      />

      <style>{`
        .ac-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;   /* 50% / 50% */
          align-items: start;
          width: 100%;
        }
        /* a faint divider between the two halves */
        .ac-grid > .ac-col + .ac-col {
          border-left: 1px solid ${C.border};
        }
        /* Stack into a single column on narrow / mobile screens */
        @media (max-width: 900px) {
          .ac-grid { grid-template-columns: 1fr; }
          .ac-grid > .ac-col + .ac-col { border-left: none; }
        }
      `}</style>
    </div>
  );
}