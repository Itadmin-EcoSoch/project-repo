import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  TEXT_MAX, TEXTAREA_MAX, PHONE_MAX,
  sanitizeText, tidyOnBlur, sanitizePhoneDigits, counterFor,
} from '../lib/fieldLimits';
import {
  COUNTRY_OPTIONS, DEFAULT_DIAL, splitPhone, joinPhone,
  maxDigitsFor, countryFor,
} from '../lib/countryCodes';

/* ── Shared option constants ─────────────────────────────────────── */
/*  Regions — these are the exact Enum values on Clients.Client_Region in the
    AppSheet Project Repository. They used to be a different, invented list
    (Mysore / Chennai / Pune / Delhi / Other), which meant a client saved here
    carried a region the original app did not recognise.                     */
export const REGIONS = [
  'Bangalore', 'Rest of Karnataka', 'Telangana', 'TamilNadu',
  'Kerala', 'Andhra Pradesh', 'Maharashtra', 'Rest of India',
];

/*  Client_Identity — the AppSheet Enum on Clients.Client_Identity: what KIND of
    customer this is. Distinct from Client_Type (Internal / External), which is
    about who executes the work and is set by the radio further down the form.  */
export const CLIENT_IDENTITIES = ['Individual', 'Association', 'Company', 'Institutional', 'NGO'];

/*  Kept so any older import keeps resolving. Points at the same list. */
export const CLI_TYPES = CLIENT_IDENTITIES;
export const INVERTERS  = ['String','Microinverter (IQ Series)','Optimizer','Hybrid','Off Grid','IQ8P','IQ7A'];
export const SCHEMES     = ['Subsidy','Non Subsidy','National Subsidy','KUSUM','MNRE','BESCOM','Net Metering','Commercial'];
export const PROJ_TYPES = ['EPC','Consultancy','I&C'];
export const SECTORS    = ['Residential','Commercial','Industrial','Institutional'];
export const SYS_TYPES  = ['Rooftop Solar','Ground Mount','Floating Solar'];
export const SYS_CATS   = ['Grid-Tied','Off-Grid','Hybrid'];
export const AMC_TYPES  = ['None','Cleaning','Inspection','Inspection, Cleaning'];

/* Type of Client (mirrors the AppSheet radio: Internal EPC/I&C vs External AMC) */
export const CLIENT_KINDS = [
  { v:'Internal', label:'Internal (EPC, I&C)', sub:'EcoSoch executes the project',         emoji:'🏢' },
  { v:'External', label:'External (AMC)',       sub:'Maintenance / service-only client',    emoji:'🔧' },
];

export const STATUSES = [
  { v:'Active',          emoji:'🟢', color:'#059669', bg:'#ecfdf5', border:'#059669' },
  { v:'On Hold',         emoji:'🔵', color:'#2563eb', bg:'#eff6ff', border:'#2563eb' },
  { v:'Under SolarCare', emoji:'⚡', color:'#7c3aed', bg:'#f5f3ff', border:'#7c3aed' },
  { v:'Defaulted',       emoji:'🟡', color:'#d97706', bg:'#fffbeb', border:'#d97706' },
  { v:'Cancelled',       emoji:'🔴', color:'#dc2626', bg:'#fef2f2', border:'#dc2626' },
];

/* ── Design tokens (mirror CSS vars for inline use) ──────────────── */
export const C = {
  primary:  '#1e3a5f',
  primaryL: '#2d5282',
  accent:   '#0ea5e9',
  accentL:  '#e0f2fe',
  success:  '#059669',
  warning:  '#d97706',
  danger:   '#dc2626',
  purple:   '#7c3aed',
  surface:  '#f1f5f9',
  border:   '#e2e8f0',
  text1:    '#0f172a',
  text2:    '#475569',
  text3:    '#94a3b8',
};

/* ── Shared inline styles ────────────────────────────────────────── */
export const page = { background: C.surface, minHeight:'100%', paddingBottom:0 };

export const card = {
  background:'#fff',
  borderRadius:16,
  margin:'12px 16px',
  boxShadow:'0 1px 3px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.04)',
  overflow:'hidden',
};

export const cardHeader = (color=C.primary) => ({
  padding:'13px 16px 11px',
  borderBottom:`1px solid ${C.surface}`,
  display:'flex', alignItems:'center', gap:10,
  background:`linear-gradient(135deg,${color}08,${color}04)`,
});

export const cardIconBg = (color=C.accent) => ({
  width:30, height:30, borderRadius:9,
  background:`linear-gradient(135deg,${color},${color}cc)`,
  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
});

export const fieldWrap  = { padding:'12px 16px', borderBottom:`1px solid ${C.surface}` };
/*  Labels were 10px grey uppercase and hard to read across a wide two-column
    form. Now dark navy, heavier and slightly larger — still uppercase, so
    nothing about the layout shifts.                                         */
export const fieldLabel = { fontSize:11, fontWeight:800, color:'#0f2c3f', textTransform:'uppercase', letterSpacing:'.045em', marginBottom:7, display:'block', lineHeight:1.45 };
export const reqStar    = { color:C.accent, marginLeft:2 };
export const errMsg     = { fontSize:11, color:C.danger, marginTop:5, display:'flex', alignItems:'center', gap:4 };

export const inputBase = {
  width:'100%', height:44, padding:'0 13px',
  border:`1.5px solid ${C.border}`, borderRadius:10,
  fontSize:13, fontFamily:'inherit', color:C.text1,
  outline:'none', background:'#fff',
  transition:'border .15s, box-shadow .15s', boxSizing:'border-box',
};
export const inputFocus = { border:`1.5px solid ${C.accent}`, boxShadow:`0 0 0 3px ${C.accentL}80` };
/*  Marks the field without shouting — a soft red rather than the full-strength
    danger colour, since dozens can be on screen at once.                    */
export const inputErr   = { border:'1.5px solid #fca5a5', background:'#fffafa' };
export const selectBase = {
  ...inputBase,
  paddingRight:36,
  appearance:'none',
  backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat:'no-repeat', backgroundPosition:'right 13px center', cursor:'pointer',
};
export const textareaBase = {
  ...inputBase, height:'auto', minHeight:78, padding:'10px 13px', resize:'vertical',
};

/* ── Smart input with focus glow ─────────────────────────────────── */
/*  maxLength / sanitize added so every single-line box in the app enforces the
    same ceiling and strips the same characters. See lib/fieldLimits.js for why
    the character rule is narrow rather than a blanket "no special characters"
    — Indian addresses legitimately contain # , . - / & ( ).

    sanitize={false} opts out. Used for coordinates, which must keep their
    leading minus for southern latitudes, and for numeric inputs where the
    browser already restricts what can be typed.                            */
/*  Group an integer/decimal string in the Indian system: 1,00,00,000. */
export function indianComma(x) {
  var s = String(x == null ? '' : x).replace(/,/g, '');
  if (s === '') return '';
  var neg = s.charAt(0) === '-'; if (neg) s = s.slice(1);
  var parts = s.split('.');
  var intp = (parts[0] || '').replace(/\D/g, '');
  var dec  = parts.length > 1 ? parts[1].replace(/\D/g, '') : null;
  if (intp === '') intp = '0';
  var last3 = intp.slice(-3);
  var rest  = intp.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  var out = rest + last3;
  if (dec !== null) out += '.' + dec;
  return (neg ? '-' : '') + out;
}

export function SInput({ value, onChange, type='text', placeholder, hasError, suffix, prefix,
                         step, autoFocus, maxLength, sanitize = true, multiline = false,
                         showCounter = false, onBlur, style:extra={} }) {
  const [foc, setFoc] = useState(false);

  /*  Numbers, dates and coordinates are left alone: sanitizeText strips a
      leading '-', which would make -12.97 impossible to type.              */
  const skip = !sanitize || type === 'number' || type === 'date';
  const cap  = maxLength ?? (skip ? undefined : TEXT_MAX);

  const handle = e => {
    if (!onChange) return;
    if (skip) return onChange(e);
    const clean = sanitizeText(e.target.value, cap ?? TEXT_MAX, { multiline });
    if (clean === e.target.value) return onChange(e);
    /*  Rebuild the event with the cleaned value so callers keep writing
        e.target.value and nothing else has to know this happened.         */
    onChange({ ...e, target: { ...e.target, value: clean } });
  };

  const handleBlur = e => {
    setFoc(false);
    if (!skip && onChange) {
      const tidy = tidyOnBlur(e.target.value);
      if (tidy !== e.target.value) {
        onChange({ ...e, target: { ...e.target, value: tidy } });
      }
    }
    onBlur?.(e);
  };

  const count = showCounter && cap ? counterFor(value, cap) : null;

  return (
    <div style={{ position:'relative' }}>
      <input type={type} value={value} onChange={handle} placeholder={placeholder}
        step={step} autoFocus={autoFocus} maxLength={cap}
        onFocus={()=>setFoc(true)} onBlur={handleBlur}
        style={{ ...inputBase, ...(foc?inputFocus:{}), ...(hasError?inputErr:{}),
                 ...(suffix?{paddingRight:40}:{}), ...(prefix?{paddingLeft:30}:{}), ...extra }}/>
      {prefix && (
        <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:12, fontWeight:600, color:C.text3 }}>
          {prefix}
        </span>
      )}
      {suffix && (
        <span style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', fontSize:12, fontWeight:600, color:C.text3 }}>
          {suffix}
        </span>
      )}
      {count && (
        <div style={{ fontSize:10, marginTop:3, textAlign:'right',
                      color: count.over ? C.danger : C.text3 }}>
          {count.len} / {count.max}
        </div>
      )}
    </div>
  );
}

export function SSelect({ value, onChange, options, hasError, placeholder, labels={}, onBlur }) {
  const [foc, setFoc] = useState(false);
  return (
    <select value={value} onChange={onChange} onFocus={()=>setFoc(true)} onBlur={(e)=>{ setFoc(false); onBlur?.(e); }}
      style={{ ...selectBase, ...(foc?inputFocus:{}), ...(hasError?inputErr:{}) }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o=><option key={o} value={o}>{labels[o] || o}</option>)}
    </select>
  );
}

/*  1000 characters by default. The counter only appears past 80% — a counter
    under every one of sixty fields is noise; one that shows up when you are
    running out is a warning.                                               */
export function STextarea({ value, onChange, placeholder, hasError, onBlur,
                            maxLength = TEXTAREA_MAX, showCounter = true }) {
  const [foc, setFoc] = useState(false);

  const handle = e => {
    if (!onChange) return;
    const clean = sanitizeText(e.target.value, maxLength, { multiline: true });
    if (clean === e.target.value) return onChange(e);
    onChange({ ...e, target: { ...e.target, value: clean } });
  };

  const count = showCounter ? counterFor(value, maxLength) : null;

  return (
    <>
      <textarea value={value} onChange={handle} placeholder={placeholder}
        maxLength={maxLength}
        data-error={hasError ? 'true' : undefined}
        onFocus={()=>setFoc(true)} onBlur={()=>{ setFoc(false); onBlur?.(); }}
        style={{ ...textareaBase, ...(foc?inputFocus:{}), ...(hasError?inputErr:{}) }}/>
      {count && (
        <div style={{ fontSize:10, marginTop:3, textAlign:'right',
                      color: count.over ? C.danger : C.text3 }}>
          {count.len} / {count.max}
        </div>
      )}
    </>
  );
}

/* ── SearchableSelect ────────────────────────────────────────────────
   A dropdown with a search box. Built for the country picker, but generic:
   pass options as [{ value, label, hint, group, keywords }].

   ── WHY THIS IS RENDERED IN A PORTAL ──────────────────────────────
   The `card` style in this file sets overflow:hidden, which is what gives
   the cards their rounded corners. A native <select> escapes that because
   the browser draws its popup outside the document flow — a div does not.
   Dropped in place, the list would be clipped at the bottom edge of the
   card and you would see about one and a half rows.

   So the panel goes into a portal on document.body with position:fixed,
   positioned from the trigger's bounding rect. That is also why it
   listens for scroll and resize: fixed positioning does not follow the
   element it was measured from.

   ── SEARCH RANKING ────────────────────────────────────────────────
   A plain substring match on the keyword blob puts nonsense first — "usa"
   matches Israel, because its keywords contain "jeruSAlem", and Zambia,
   because of "luSAka". Matches are scored instead: the label starting with
   what you typed beats the label containing it, which beats a keyword
   match. Ties keep list order, so the pinned countries stay on top.
------------------------------------------------------------------------ */
export function SearchableSelect({
  value, options = [], onChange,
  placeholder = 'Select…', searchPlaceholder = 'Type to search…',
  hasError, disabled, width, maxHeight = 320, emptyText = 'No match',
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);

  const btnRef   = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const selected = options.find(o => String(o.value) === String(value)) || null;

  /* ── ranked filter ── */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;

    const scored = [];
    options.forEach((o, i) => {
      const label = String(o.label || '').toLowerCase();
      const hint  = String(o.hint  || '').toLowerCase();
      const keys  = String(o.keywords || '').toLowerCase();

      let score = -1;
      if (label === s || hint === s)            score = 0;
      else if (label.startsWith(s))             score = 1;
      else if (hint.startsWith(s) ||
               hint.replace('+','').startsWith(s)) score = 2;
      else if (label.includes(s))               score = 3;
      else if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`).test(keys)) score = 4;
      else if (keys.includes(s))                score = 5;

      if (score >= 0) scored.push({ o, score, i });
    });

    return scored
      .sort((a, b) => a.score - b.score || a.i - b.i)
      .map(x => x.o);
  }, [q, options]);

  /* ── position the panel against the trigger ── */
  const measure = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    /*  Flip upward when the trigger is near the bottom of the window —
        the mobile field sits low on the Add Client form, so this is the
        normal case rather than the edge case.                          */
    const flip = below < Math.min(maxHeight, 260) && r.top > below;
    setRect({
      left : r.left,
      width: width || Math.max(r.width, 260),
      top  : flip ? undefined : r.bottom + 4,
      bottom: flip ? window.innerHeight - r.top + 4 : undefined,
      maxH : Math.min(maxHeight, (flip ? r.top : below) - 12),
    });
  };

  useLayoutEffect(() => { if (open) measure(); /* eslint-disable-next-line */ }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    /*  capture:true so a scroll inside ANY ancestor is caught, not just
        the window — the form itself scrolls.                           */
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── close on outside click / Escape ── */
  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (panelRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [q]);

  /* keep the highlighted row visible while arrowing */
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function close()  { setOpen(false); setQ(''); setActive(0); }
  function choose(o) { onChange?.(o.value); close(); btnRef.current?.focus(); }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
  }

  /*  Group headers are only drawn when nothing has been typed. Once you are
      searching, "Frequently used" above one result and "All countries" above
      the next is noise around an answer you already found.                 */
  const showGroups = !q.trim();
  let lastGroup = null;

  return (
    <>
      <button
        ref={btnRef} type="button" disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true); } }}
        style={{
          ...selectBase,
          width: width || '100%',
          backgroundImage: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 6, textAlign: 'left', fontFamily: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          ...(hasError ? inputErr : {}),
          ...(open ? inputFocus : {}),
        }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                       color: selected ? C.text1 : C.text3 }}>
                              {selected ? `${selected.label} ${selected.hint || ''}`.trim() : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.text3}
             strokeWidth="2" style={{ flexShrink:0, transform: open ? 'rotate(180deg)' : 'none',
                                      transition:'transform .15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && rect && createPortal(
        <div ref={panelRef}
          style={{
            position:'fixed', left:rect.left, width:rect.width,
            ...(rect.top !== undefined ? { top:rect.top } : { bottom:rect.bottom }),
            zIndex: 9999,
            background:'#fff', border:`1px solid ${C.border}`, borderRadius:12,
            boxShadow:'0 12px 34px rgba(15,23,42,.18)', overflow:'hidden',
            display:'flex', flexDirection:'column',
            maxHeight: Math.max(160, rect.maxH),
          }}>

          <div style={{ padding:8, borderBottom:`1px solid ${C.surface}`, background:'#fff' }}>
            <input
              ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
              placeholder={searchPlaceholder}
              style={{ ...inputBase, height:36, fontSize:12.5 }}/>
          </div>

          <div ref={listRef} style={{ overflowY:'auto', flex:1 }}>
            {filtered.length === 0 && (
              <div style={{ padding:'18px 14px', fontSize:12, color:C.text3, textAlign:'center' }}>
                {emptyText}
              </div>
            )}

            {filtered.map((o, i) => {
              const isActive = i === active;
              const isChosen = String(o.value) === String(value);
              const header = showGroups && o.group && o.group !== lastGroup ? o.group : null;
              if (header) lastGroup = o.group;

              return (
                <div key={`${o.value}-${o.label}`}>
                  {header && (
                    <div style={{ padding:'7px 13px 4px', fontSize:9.5, fontWeight:800,
                                  letterSpacing:'.07em', textTransform:'uppercase',
                                  color:C.text3, background:'#fbfcfd' }}>
                      {header}
                    </div>
                  )}
                  <div
                    data-active={isActive ? 'true' : undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={e => { e.preventDefault(); choose(o); }}
                    style={{
                      padding:'9px 13px', cursor:'pointer', fontSize:13,
                      display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
                      background: isActive ? C.accentL : '#fff',
                      color: isChosen ? C.primary : C.text1,
                      fontWeight: isChosen ? 700 : 500,
                    }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {o.label}
                    </span>
                    <span style={{ flexShrink:0, fontSize:12, color:C.text3,
                                   fontVariantNumeric:'tabular-nums' }}>
                      {o.hint}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ── PhoneField ──────────────────────────────────────────────────────
   A dial-code picker beside the number box, defaulting to India.

   THE VALUE IS STILL ONE STRING — "+91 9876543210" — because Client_Mobile
   is one column with 1,501 rows already in it. Splitting it into two columns
   would mean a sheet migration, a Code.gs change and an edit to mapping.js.
   The country code is now chosen rather than typed; nothing downstream needs
   to know that.

   The leading + is safe to store: textSafe_ in Code.gs prefixes a leading =
   or + with an apostrophe so Sheets stores it as text, and mapping.js lists
   Client_Mobile in its TEXT set so it is never coerced to a number. That pair
   is exactly what was missing when mobiles turned into #ERROR!.

   The 20-character ceiling covers the whole thing — "+971 501234567" is 14,
   and the longest dial code in the list is 4 characters.
------------------------------------------------------------------------ */
/* ── PhoneField ──────────────────────────────────────────────────────
   A dial-code picker beside the number box, defaulting to India.

   ── WHY THE COUNTRY LIVES IN STATE ────────────────────────────────
   The obvious implementation reads it back out of the value:

       const { dial, number } = splitPhone(value);          // WRONG

   That breaks the moment somebody picks a country BEFORE typing a
   number. joinPhone returns '' for an empty number — on purpose, so an
   abandoned form never leaves a stranded "+91" in the sheet with
   nothing after it — and splitPhone('') answers with the default. So
   the picker snapped straight back to India and stayed there until a
   digit was typed.

   Holding it here means the choice survives an empty number box. The
   value written out is unchanged: still '' until there is a number.

   ── ONE STRING, NOT TWO COLUMNS ───────────────────────────────────
   Client_Mobile is a single column with 1,501 rows already in it, so
   the value stays "+91 9876543210". The leading + is safe: textSafe_
   in Code.gs prefixes a leading = or + with an apostrophe so Sheets
   stores it as text, and mapping.js lists Client_Mobile in its TEXT
   set so it is never coerced to a number. That pair is exactly what
   was missing when mobiles turned into #ERROR!.
------------------------------------------------------------------------ */
export function PhoneField({ value, onChange, hasError, disabled = false, onBlur,
                             placeholder = '9876543210' }) {
  const parsed = splitPhone(value);

  /*  Seeded from the value on first render, then owned by this component. */
  const [dial, setDial] = useState(parsed.dial);
  const [foc,  setFoc]  = useState(false);

  /*  Resync only when a NON-EMPTY value arrives carrying a different code —
      an existing client loading into the edit form, or a parent resetting the
      field. Guarded on `value` being truthy, so it can never fire off the
      empty string and undo the user's choice, which is the bug above.     */
  useEffect(() => {
    if (value && parsed.dial !== dial) setDial(parsed.dial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /*  Two ceilings, and the stricter one wins.
        room  — what the 20-character column leaves after the code and space
        cap   — what a real number in that country actually is             */
  const room = Math.max(4, PHONE_MAX - dial.length - 1);
  const cap  = maxDigitsFor(dial, room);

  const number = parsed.number;

  /*  Switching country re-trims the number to the new country's length, so
      moving an Indian 10-digit number to Oman leaves 8 rather than silently
      keeping a value the field would no longer accept.                    */
  const changeDial = d => {
    setDial(d);
    const trimmed = sanitizePhoneDigits(number, maxDigitsFor(d, Math.max(4, PHONE_MAX - d.length - 1)));
    onChange(joinPhone(d, trimmed));
  };

  const changeNum = n => onChange(joinPhone(dial, sanitizePhoneDigits(n, cap)));

  const country = countryFor(dial);

  return (
    <div>
      <div style={{ display:'flex', gap:8 }}>
                {/*  185 countries is too many to scroll, so this one has a search box.
             Type a country, a city ("dubai"), an old name ("burma", "ceylon")
             or the code itself ("971") — see COUNTRY_OPTIONS.keywords.     */}
        <div style={{ width:150, flexShrink:0 }}>
          <SearchableSelect
            value={dial}
            options={COUNTRY_OPTIONS}
            onChange={changeDial}
            disabled={disabled}
            hasError={hasError}
            width={300}
            compact
            searchPlaceholder="Country, city or code…"
            emptyText="No country matches that"/>
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <input
            type="tel"
            inputMode="numeric"
            value={number}
            disabled={disabled}
            maxLength={cap}
            placeholder={placeholder}
            onChange={e => changeNum(e.target.value)}
            onFocus={()=>setFoc(true)} onBlur={()=>{ setFoc(false); onBlur?.(); }}
            style={{ ...inputBase, ...(foc?inputFocus:{}), ...(hasError?inputErr:{}),
                     letterSpacing:'.02em' }}/>
        </div>
      </div>

      {/*  Only while the box has focus and is short. A digit counter under
          every phone field on every screen is noise; one that appears while
          you are typing an incomplete number is useful.                   */}
      {foc && country.digits && number.length > 0 && number.length < country.digits && (
        <div style={{ fontSize:10, color:C.text3, marginTop:3 }}>
          {number.length} of {country.digits} digits for {country.name}
        </div>
      )}
    </div>
  );
}

/* ── Field wrapper ───────────────────────────────────────────────── */
/*  A 60-field form turns into a wall of red the moment you press Save, which
    reads as "everything is broken" rather than "fill these in". The asterisk
    already says a field is required, so the sentence under each one is gone.
    What remains: a soft red border marking the field, plus the toast naming the
    first missing one and the page scrolling to it.

    showErrorText brings the message back for a specific field — worth it for
    real validation errors like a malformed email, where the asterisk alone does
    not explain what is wrong.                                               */
export function Field({ label, required, error, children, showErrorText, style:extra={}, ...rest }) {
  return (
    <div style={{ ...fieldWrap, ...extra }} {...rest}>
      <label style={fieldLabel}>{label}{required && <span style={reqStar}>*</span>}</label>
      {children}
      {error && showErrorText && <p style={errMsg}><span>⚠</span>{error}</p>}
    </div>
  );
}

/* ── Card wrapper ────────────────────────────────────────────────── */
export function Card({ icon, title, color=C.primary, children }) {
  return (
    <div style={card}>
      <div style={cardHeader(color)}>
        <div style={cardIconBg(color)}>{icon}</div>
        <span style={{ fontSize:12, fontWeight:700, color:C.text1, letterSpacing:'.01em' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ── Footer buttons ──────────────────────────────────────────────────
   Two buttons by default. Pass onMiddle + middleLabel to get a third,
   outlined button between them — used by Add Project for
   [Cancel] [Save Project] [Send New Order Form].
   Existing two-button callers are unaffected.                        */
export function Footer({
  onSecondary, secondaryLabel,
  onMiddle, middleLabel, middleColor = C.success, middleDisabled = false,
  onPrimary, primaryLabel, primaryColor = C.primary, disabled = false,
}) {
  const hasMiddle = Boolean(onMiddle && middleLabel);
  return (
    <div style={{ position:'sticky', bottom:0, background:'#fff', borderTop:`1px solid ${C.border}`, padding:'10px 18px', display:'flex', gap:10, zIndex:40, boxShadow:'0 -4px 20px rgba(0,0,0,.07)' }}>
      <button onClick={onSecondary} style={{ flex:1, height:48, borderRadius:12, border:`1.5px solid ${C.border}`, background:'#fff', fontSize:13, fontWeight:700, color:C.text2, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
        {secondaryLabel}
      </button>

      {hasMiddle && (
        <button onClick={onMiddle} disabled={middleDisabled} style={{ flex:1.4, height:48, borderRadius:12, border:`1.5px solid ${middleDisabled?C.border:middleColor}`, background:'#fff', fontSize:13, fontWeight:700, color: middleDisabled?C.text3:middleColor, cursor: middleDisabled?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, transition:'all .2s' }}>
          {middleLabel}
        </button>
      )}

      <button onClick={onPrimary} disabled={disabled} style={{ flex:2, height:48, borderRadius:12, border:'none', background: disabled?'#94a3b8':`linear-gradient(135deg,${primaryColor},${C.primaryL})`, fontSize:13, fontWeight:700, color:'#fff', cursor:disabled?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow: disabled?'none':`0 4px 14px ${primaryColor}40`, transition:'all .2s' }}>
        {primaryLabel}
      </button>
    </div>
  );
}

/* ── File upload ─────────────────────────────────────────────────── */
export function UploadField({ label }) {
  const [file, setFile] = useState(null);
  const ref = useRef(null);
  return (
    <div style={fieldWrap}>
      <label style={fieldLabel}>{label}</label>
      <div onClick={() => ref.current && ref.current.click()} style={{
        border:`2px dashed ${file ? C.accent : C.border}`,
        borderRadius:10, padding:'11px 14px', cursor:'pointer',
        display:'flex', alignItems:'center', gap:12,
        background: file ? C.accentL : '#fafbfc',
        transition:'all .2s',
      }}>
        <div style={{ width:36,height:36,borderRadius:9,background: file ? `${C.accent}20` : C.surface, display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={file?C.accent:C.text3} strokeWidth="1.8" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12,fontWeight:600,color:file?C.primary:C.text2 }}>{file?file.name:'Tap to attach file'}</div>
          <div style={{ fontSize:10,color:C.text3,marginTop:2 }}>{file?`${(file.size/1024).toFixed(1)} KB`:'PDF, Excel, Images'}</div>
        </div>
        {file && <button onClick={e=>{e.stopPropagation();setFile(null)}} style={{ background:'none',border:'none',cursor:'pointer',color:C.text3,fontSize:20,lineHeight:1 }}>×</button>}
      </div>
      <input ref={ref} type="file" style={{ display:'none' }} onChange={e=>setFile(e.target.files[0]||null)}/>
    </div>
  );
}
/* ── SelectOrType ────────────────────────────────────────────────────
   A dropdown that also lets the user type a value that is not on the list.

   Used for Region on both the client form and the project form: the eight
   AppSheet regions cover most sites, but a project in a town that is not
   listed still has to be recordable rather than forced into "Rest of India".

   Picking "＋ Add a value not on the list" swaps the select for a text box.
   "← back to the list" returns and clears, so a half-typed value never
   survives the switch.

   `keepUnknown` controls what happens to a value that is not in `options`
   when the component mounts:
     false (default) — clear it and make the user re-pick. Right for stale
                       dropdowns where the old value is genuinely retired.
     true            — keep it and open straight into the text box. Right for
                       free-text fields like Region, where a previously typed
                       custom value must not silently vanish on edit.
------------------------------------------------------------------------ */
export function SelectOrType({ value, options = [], onChange, hasError, placeholder,
                               addLabel = '＋ Add a value not on the list',
                               typePlaceholder = 'Type the value',
                               keepUnknown = false }) {
  const current = String(value ?? '');
  const isCustom = Boolean(current) && !options.includes(current);

  const [typing, setTyping] = useState(keepUnknown && isCustom);
  const normalised = useRef(false);

  useEffect(() => {
    if (normalised.current) return;
    normalised.current = true;
    if (!keepUnknown && current && !options.includes(current)) onChange('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*  Switch into the text box when a custom value arrives AFTER mount.

      Without this, the Add Project form's "billing address same as site?"
      autofill can set Project Region to a value the client record holds but
      the dropdown does not list — and the select, having decided its mode at
      mount, would render blank while form state quietly held the value.

      Only runs when keepUnknown is on, and only in one direction: pressing
      "← back to the list" sets the value to '', which fails the test, so it
      cannot bounce straight back into typing mode.                        */
  useEffect(() => {
    if (keepUnknown && !typing && current && !options.includes(current)) setTyping(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, keepUnknown]);

  if (typing) {
    return (
      <>
        {/*  Placeholder comes from the field, not hard-coded. It used to read
             "Type the region" on every field that offered a custom value,
             which is wrong the moment the component is reused for inverter
             brands or roof materials.                                     */}
        <SInput value={current} onChange={e => onChange(e.target.value)}
                placeholder={typePlaceholder} hasError={hasError} autoFocus />
        <button type="button"
          onClick={() => { setTyping(false); onChange(''); }}
          style={{ background:'none', border:'none', padding:'6px 0', cursor:'pointer',
                   fontSize:11, fontWeight:700, color:C.accent }}>
          ← back to the list
        </button>
      </>
    );
  }

  return (
    <SSelect
      value={options.includes(current) ? current : ''}
      onChange={e => {
        if (e.target.value === '__other__') { setTyping(true); onChange(''); }
        else onChange(e.target.value);
      }}
      options={[...options, '__other__']}
      labels={{ __other__: addLabel }}
      placeholder={placeholder || 'Select…'}
      hasError={hasError}
    />
  );
}
/* ── Row ─────────────────────────────────────────────────────────────
   A responsive column layout for the standalone forms — AMC setup, new
   ticket — which build their own markup rather than going through the
   projectFields spec.

   `cols` is the count at desktop width. Below 1100px it halves (a 4-column
   row becomes 2), and below 760px everything stacks. Four date and select
   boxes across a 900px window are too narrow to read, so the step down is
   deliberate rather than a straight percentage.

       <Row cols={4}>
         <Field .../><Field .../><Field .../><Field .../>
       </Row>

   Uses a real stylesheet, injected once, because inline styles cannot carry
   media queries and these layouts have to respond to width.
--------------------------------------------------------------------- */
const ROW_CSS = `
.ek-row { display: grid; gap: 0 18px; grid-template-columns: 1fr; align-items: start; }
.ek-row-stretch { align-items: stretch; }
.ek-row > * { min-width: 0; }
@media (min-width: 760px) {
  .ek-row-2, .ek-row-3, .ek-row-4, .ek-row-5 { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
/*  A Row nested inside another Row is living in half the width, so it stays
    stacked until there is genuinely room. Without this the two date fields
    inside the Handling card were squeezed to about 180px each on a laptop —
    narrow enough that the native date picker clipped its own text.      */
@media (max-width: 1380px) {
  .ek-row > * .ek-row-2 { grid-template-columns: 1fr; }
}
@media (min-width: 1100px) {
  .ek-row-2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .ek-row-3 { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .ek-row-4 { grid-template-columns: repeat(4, minmax(0,1fr)); }
  .ek-row-5 { grid-template-columns: repeat(5, minmax(0,1fr)); }
}
`;

/*  Injected at MODULE LOAD, not inside the component's effect.

    It used to run in a useEffect on the first <Row> to mount. But the AMC
    setup page styles its option cards with the ek-row-3 class directly, and
    those cards render BEFORE any <Row> exists — no contract block appears
    until one is picked. So on first paint the classes were there with no
    stylesheet behind them and the three cards rendered as ragged, content-
    width blocks; choosing one mounted a Row, the effect finally fired, and
    the layout snapped into place.

    Injecting on import means the CSS is present before anything renders,
    whether or not a <Row> component is involved.                          */
if (typeof document !== 'undefined' && !document.getElementById('ek-row-css')) {
  const el = document.createElement('style');
  el.id = 'ek-row-css';
  el.textContent = ROW_CSS;
  document.head.appendChild(el);
}

export function Row({ cols = 2, children, style, className = '' }) {
  return (
    <div className={`ek-row ek-row-${cols} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}