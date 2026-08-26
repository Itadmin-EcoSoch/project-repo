/*  frontend/src/pages/ProjectDetail.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    WHAT CHANGED, AND WHY

    The old page listed 21 fields, hand-typed into a `sections` array. The sheet
    has 85 columns and the Edit screen renders all of them, which is why a
    project looked half-empty until you pressed Edit. Every time a column was
    added to the form spec, this page fell further behind.

    It now renders from THE SAME SPEC the Add and Edit forms use —
    lib/projectFields.js — against `_raw`, the untouched sheet row the API
    already returns on GET /api/projects/:id. Same section titles, same labels,
    same order as the form. Add a field to the spec and it appears here too.

    Three groups the form spec does not cover are added explicitly below:

      WARRANTY_ROWS   Commissioned / Warranty / Workmanship dates — the columns
                      the SolarCare expiry cron reads. Worth seeing on the page
                      that decides whether a project is still covered.
      RECORD_ROWS     who created it, who last touched it, when.
      leftovers       ANY other column in the row that none of the above
                      claimed, so a new column in the sheet can never again be
                      invisible here.

    Empty fields are hidden by default and revealed by the "Show empty fields"
    toggle — AppSheet's detail view behaved the same way.
--------------------------------------------------------------------------- */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { PROJECT_SECTIONS, fromProjectRow, isVisible } from '../lib/projectFields';
import { canonicalStatus, statusLabel } from '../lib/status';

const STATUS_BADGE = {
  'Active':            { bg:'#D1FAE5', color:'#065F46' },
  'On Hold':           { bg:'#DBEAFE', color:'#1E40AF' },
  'Under SolarCare':   { bg:'#EDE9FE', color:'#5B21B6' },
  'Out of SolarCare':  { bg:'#E2E8F0', color:'#334155' },
  'Completed':         { bg:'#CFFAFE', color:'#155E75' },
  'Defaulted':         { bg:'#FEF3C7', color:'#92400E' },
  'Cancelled':         { bg:'#FFE4E6', color:'#9F1239' },
};

/* ── value formatting ─────────────────────────────────────────────────── */

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/*  The sheet holds three shapes of date: real Date cells (returned as ISO by
    Apps Script), ISO strings, and ~176 rows typed by hand as dd-MM-yyyy.
    dd-MM is tested BEFORE new Date(), because new Date('03-07-2026') is read
    as 7 March in the US order and would show the wrong month.              */
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const fmtDate = v => {
  const d = parseDate(v);
  if (!d) return String(v ?? '');
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const fmtDateTime = v => {
  const s = String(v ?? '');
  const t = s.match(/[T ](\d{2}):(\d{2})/);
  return t ? `${fmtDate(v)}, ${t[1]}:${t[2]}` : fmtDate(v);
};

const money = v => {
  const n = Number(v);
  return Number.isFinite(n) ? '₹' + n.toLocaleString('en-IN') : String(v);
};

/** Today in IST, as yyyy-mm-dd — the same day boundary the cron uses. */
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const isoOf = v => { const d = parseDate(v); return d ? d.toISOString().slice(0,10) : ''; };

/*  The attachment columns, as one test used by both the renderer and the link
    lookup — they must agree, or a row shows a filename with no link.       */
/*  Must stay in step with ATTACHMENTS in backend/routes/projects.js — that
    endpoint is the only thing that turns these paths into links, so a column
    listed here but missing there renders a filename that can never be
    clicked. Site_Photos was in an earlier draft of this list and is NOT in
    ATTACHMENTS; it is left out rather than promising a link nothing supplies. */
const isFileCol = (col, type) =>
  type === 'file' || /^(Quote_Sheet|Proposal|Files|PO_File|Bill_File)$/.test(col);

const isDateCol = k => /(_Date|_At)$/.test(k);
const isMoneyCol = k => /^(Order_Value|Referral_Amount|Retention_Amount|Payment_Amount)$/.test(k);
const isPctCol   = k => /^(Margin|Defaulted_Pct)$/.test(k);

/** One sheet value → what the user should read. */
function display(col, value, type) {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value).trim();
  if (!s) return '';

  if (isFileCol(col, type)) {
    return s.split('/').pop();               // path → just the filename
  }
  if (/^(TRUE|FALSE)$/i.test(s)) return /^true$/i.test(s) ? 'Yes' : 'No';
  if (isMoneyCol(col)) return money(s);
  if (isPctCol(col))   return s.endsWith('%') ? s : `${s}%`;
  if (type === 'date' || isDateCol(col)) return /(_At)$/.test(col) ? fmtDateTime(s) : fmtDate(s);
  return s;
}

/* ── extra rows the form spec does not define ─────────────────────────── */

const WARRANTY_ROWS = [
  ['Commissioned_Date',      'Commissioned Date'],
  ['Workmanship_Start_Date', 'Workmanship Start'],
  ['Workmanship_End_Date',   'Workmanship End'],
  ['Workmanship_Status',     'Workmanship Status'],
  ['Warranty_Start_Date',    'Warranty Start'],
  ['Warranty_End_Date',      'Warranty End'],
  ['Warranty_Period',        'Warranty Period (years)'],
  ['Warranty_Status',        'Warranty Status'],
];

const RECORD_ROWS = [
  ['Project_ID',           'Project ID'],
  ['Client_Id',            'Client ID'],
  ['Internal_Id',          'Internal ID'],
  ['Prev_Project_Status',  'Previous Status'],
  ['Defaulted_Pct',        'Payment Received'],
  ['New_Order_Sent_At',    'New Order Email Sent'],
  ['New_Order_Sent_By',    'Sent By'],
  ['Created_By',           'Created By'],
  ['Created_Date',         'Created On'],
  ['Last_Updated_By',      'Last Updated By'],
  ['Last_Updated_Date',    'Last Updated'],
];

/*  Columns deliberately never shown: duplicated in the header, or plumbing. */
const HIDDEN = new Set([
  'Project_Name', 'Client_Name', 'New_Order_Message_Id',
]);

/* ── small pieces ─────────────────────────────────────────────────────── */

function HeroAction({ icon, label, onClick, primary }) {
  return (
    <button type="button" onClick={onClick} title={label}
      style={{
        display:'inline-flex', alignItems:'center', gap:6,
        padding:'7px 13px', borderRadius:9, cursor:'pointer',
        fontSize:12, fontWeight:700, fontFamily:'inherit', whiteSpace:'nowrap',
        background: primary ? 'var(--brand)' : 'rgba(255,255,255,.1)',
        border    : `1px solid ${primary ? 'var(--brand)' : 'rgba(255,255,255,.22)'}`,
        color     : '#fff',
        transition:'background .15s',
      }}
      onMouseEnter={e=>{ if(!primary) e.currentTarget.style.background='rgba(255,255,255,.2)'; }}
      onMouseLeave={e=>{ if(!primary) e.currentTarget.style.background='rgba(255,255,255,.1)'; }}>
      <span style={{fontSize:13}}>{icon}</span>{label}
    </button>
  );
}

/*  How much cover is left. Shown next to Warranty End and Workmanship End
    because those two dates are what the nightly SolarCare job acts on, and
    "2026-08-19" alone does not tell you which side of today it falls.     */
function CoverChip({ end }) {
  const e = isoOf(end);
  if (!e) return null;
  const t = todayISO();
  const days = Math.round((Date.parse(e) - Date.parse(t)) / 86400000);
  const over = days < 0;
  return (
    <span style={{
      marginLeft:8, padding:'1px 7px', borderRadius:8, fontSize:10, fontWeight:700,
      background: over ? 'var(--slate-200)' : '#DCFCE7',
      color     : over ? 'var(--text-muted)' : '#15803D',
    }}>
      {over ? `ended ${Math.abs(days)}d ago` : days === 0 ? 'ends today' : `${days}d left`}
    </span>
  );
}

function Row({ label, value, href, onClick, chip, wide }) {
  return (
    <div className={`detail-row${wide ? ' wide' : ''}`}>
      <div className="d-label">{label}</div>
      {href
        ? <div className="d-value"><a className="d-link" href={href} target="_blank" rel="noreferrer" title={value}>{value}</a></div>
        : onClick
          ? <div className="d-value green" style={{cursor:'pointer',textDecoration:'underline'}} onClick={onClick}>{value}</div>
          : <div className="d-value" style={{whiteSpace: wide ? 'pre-wrap' : 'normal'}}>{value}{chip}</div>}
    </div>
  );
}

function Section({ title, icon, rows }) {
  if (!rows.length) return null;
  return (
    <div className="detail-section">
      <div className="detail-section-title">{icon} {title}</div>
      <div className="pd-grid">
        {rows.map(r => <Row key={r.key} {...r} />)}
      </div>
    </div>
  );
}

/* ── the page ─────────────────────────────────────────────────────────── */

export default function ProjectDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /*  ── FILE PATH -> DRIVE LINK ───────────────────────────────────────────
      The sheet stores "X2LgXPB2/X2LgXPB2.Quote_Sheet.7406670.pdf". That is a
      path, not a URL, so the row rendered the filename as dead text and there
      was nothing to click.

      /api/projects/:id/attachments already resolves every attachment column to
      a Drive view URL — the Attachments panel further down this page has been
      using it all along. The same answer is kept here so the detail ROWS can
      link too, rather than making the reader scroll to a separate panel to
      open a file whose name is right in front of them.

      Failure is silent on purpose: if the lookup errors, the rows fall back to
      plain text exactly as before. A missing link is a small loss; a detail
      page that refuses to render because of it is a large one.            */
  const [fileLinks, setFileLinks] = useState({});

  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.get(`/api/projects/${id}/attachments`)
      .then(r => {
        if (!alive) return;
        const map = {};
        for (const a of (r?.data ?? r ?? [])) {
          if (a?.path && a?.view) map[a.path] = { view: a.view, name: a.name || null };
        }
        setFileLinks(map);
      })
      .catch(() => { if (alive) setFileLinks({}); });
    return () => { alive = false; };
  }, [id]);

  /*  Where "back to the list" goes. AllProjects passes the filtered list's own
      address; anyone arriving from a pasted link falls back to /projects.   */
  const backTo = location.state?.from || '/projects';

  const [proj,     setProj]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [amcContracts, setAmcContracts] = useState([]);
  const [ticketStats,  setTicketStats]  = useState(null);
  const [showEmpty,    setShowEmpty]    = useState(false);

  useEffect(()=>{
    setProj(null); setLoading(true); setNotFound(false);
    let cancelled = false;
    api.get(`/api/projects/${id}`)
      .then(res=>{ if(cancelled)return; const p=res?.data??res; if(!p?.id){setNotFound(true);return;} setProj(p); })
      .catch(()=>{ if(!cancelled)setNotFound(true); })
      .finally(()=>{ if(!cancelled)setLoading(false); });

    api.get(`/api/solarcare/projects/${encodeURIComponent(id)}`)
      .then(r => {
        if (cancelled) return;
        const d = r?.data ?? r;
        setAmcContracts(d?.amc?.list || []);
        setTicketStats(d?.tickets || null);
      })
      .catch(() => {});

    return ()=>{cancelled=true;};
  },[id]);

  /*  Every section, built from the form spec plus the extras. Memoised because
      it walks 85 columns and the page re-renders on every toggle.          */
  const sections = useMemo(() => {
    if (!proj) return [];
    const raw  = proj._raw || {};
    const form = fromProjectRow(raw);
    form.isNew = '';                     // this page only ever shows saved rows
    const used = new Set(HIDDEN);
    const out  = [];

    const push = (key, label, value, opts = {}) => ({
      key, label, value, ...opts,
    });

    /* 1 — the form's own sections, in the form's own order */
    for (const sec of PROJECT_SECTIONS) {
      const rows = [];
      for (const f of sec.fields) {
        if (!f.sheet || f.transient) continue;
        if (HIDDEN.has(f.sheet)) { used.add(f.sheet); continue; }
        used.add(f.sheet);

        const label = typeof f.label === 'function' ? f.label(form) : (f.label || f.name);
        const shown = display(f.sheet, raw[f.sheet], f.type);

        /*  A conditional field that is switched off (Referral = No) stays
            hidden even in "show empty" mode — showing "Name of Referrer: —"
            on a non-referral project is noise, not information.           */
        if (!shown && (!showEmpty || !isVisible(f, form))) continue;

        const isUrl = /^https?:\/\//i.test(shown);

        /*  An attachment links to Drive and is labelled with the name it was
            uploaded under — Quote_Sheet_Name — rather than the Drive-safe
            PROJECTID.Column.stamp.ext, which means nothing to a reader.   */
        const rawPath  = String(raw[f.sheet] || '').trim();
        const link     = isFileCol(f.sheet, f.type) ? fileLinks[rawPath] : null;
        const fileName = isFileCol(f.sheet, f.type)
          ? (raw[`${f.sheet}_Name`] || link?.name || shown)
          : shown;

        rows.push(push(f.sheet, String(label).replace(/\s*[:*]\s*$/, ''), fileName || '—', {
          href : link?.view || (isUrl ? shown : undefined),
          wide : f.type === 'textarea' || (shown && shown.length > 90),
          chip : /_End_Date$/.test(f.sheet) && raw[f.sheet] ? <CoverChip end={raw[f.sheet]} /> : null,
          onClick: f.sheet === 'GMap_Link' && raw.GMap_Link && !isUrl
            ? () => window.open(`https://maps.google.com/?q=${encodeURIComponent(raw.GMap_Link)}`, '_blank')
            : undefined,
        }));
      }
      const title = typeof sec.title === 'function' ? sec.title(form) : sec.title;
      if (rows.length) out.push({ title, icon: sec.icon || '📄', rows });
    }

    /* 2 — warranty / workmanship: what the SolarCare cron reads.
           Anything the form spec already rendered above is skipped, so adding
           these columns to lib/projectFields.js does not double them up. */
    const wRows = [];
    for (const [col, label] of WARRANTY_ROWS) {
      if (used.has(col)) continue;
      used.add(col);
      const shown = display(col, raw[col]);
      if (!shown && !showEmpty) continue;
      wRows.push(push(col, label, shown || '—', {
        chip: /_(End)_Date$/.test(col) && raw[col] ? <CoverChip end={raw[col]} /> : null,
      }));
    }
    if (wRows.length) out.push({ title: 'Warranty & SolarCare', icon: '🛡️', rows: wRows });

    /* 3 — the record itself */
    const rRows = [];
    for (const [col, label] of RECORD_ROWS) {
      used.add(col);
      const shown = display(col, raw[col]);
      if (!shown && !showEmpty) continue;
      rRows.push(push(col, label, shown || '—'));
    }
    if (rRows.length) out.push({ title: 'Record', icon: '🗂️', rows: rRows });

    /* 4 — anything in the sheet that nothing above claimed */
    const leftovers = Object.keys(raw)
      .filter(k => k && !used.has(k))
      .map(k => push(k, k.replace(/_/g, ' '), display(k, raw[k]) || '—'))
      .filter(r => showEmpty || r.value !== '—');
    if (leftovers.length) out.push({ title: 'Other Sheet Columns', icon: '📎', rows: leftovers });

    return out;
  }, [proj, showEmpty, fileLinks]);

  if (loading)  return <Spinner />;
  if (notFound) return <NotFound onBack={()=>navigate(backTo)} />;

  const client = proj.clients ?? {};
  const sb     = STATUS_BADGE[canonicalStatus(proj.status)] || STATUS_BADGE['Active'];
  const fieldCount = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div style={{background:'var(--slate-100)',minHeight:'100%',paddingBottom:40}}>

      <style>{`
        .pd-hero { position: sticky; top: 0; z-index: 50; }
        .pd-grid { display: grid; grid-template-columns: 1fr; }

        /*  flex:1 alone does not stop a flex child growing past its column —
            the minimum size of a flex item is its content, so one long value
            (the Zoho Deal ID URL) pushed straight through the next column.
            min-width:0 is what actually lets it shrink.                    */
        .pd-grid .d-value { min-width: 0; overflow-wrap: anywhere; }

        /*  A URL is one unbreakable token. Truncate it and keep it clickable
            rather than letting it set the width of the whole row.          */
        .pd-grid .d-link {
          display: block; max-width: 100%;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          color: var(--brand); text-decoration: underline;
        }

        /* paragraphs get the full width — they read badly in a narrow column */
        .pd-grid .detail-row.wide { grid-column: 1 / -1; }

        @media (min-width: 760px) {
          .pd-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .pd-grid .detail-row { border-right: 1px solid var(--slate-50); }
          .pd-grid .detail-row:nth-child(2n) { border-right: none; }
        }

        /*  Three across once there is room. The label moves ABOVE the value
            at this width — a 130px label column next to a 250px value column
            wastes half the row on questions like "Is generation monitoring
            committed to the client?".                                      */
        @media (min-width: 1180px) {
          .pd-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .pd-grid .detail-row {
            flex-direction: column; align-items: stretch; gap: 3px;
            padding: 9px 14px;
            border-right: 1px solid var(--slate-50);
          }
          .pd-grid .detail-row:nth-child(2n) { border-right: 1px solid var(--slate-50); }
          .pd-grid .detail-row:nth-child(3n) { border-right: none; }
          .pd-grid .d-label { min-width: 0; }
        }
      `}</style>

      <div className="pd-hero" style={{background:'var(--slate-900)',padding:'16px 16px 14px',position:'sticky',top:0,zIndex:50,overflow:'hidden',boxShadow:'0 6px 18px rgba(15,23,42,.22)'}}>
        <div style={{position:'absolute',top:-20,right:-20,width:120,height:120,borderRadius:'50%',background:'rgba(0,135,90,.12)'}}/>
        <div style={{position:'absolute',bottom:-30,right:40,width:80,height:80,borderRadius:'50%',background:'rgba(0,168,107,.08)'}}/>
        <div style={{display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
          <div style={{flex:'1 1 320px',minWidth:0}}>
            <div
              onClick={()=>navigate(backTo)}
              style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,.45)',textTransform:'uppercase',
                      letterSpacing:'.08em',marginBottom:6,cursor:'pointer'}}>
              ← Project
            </div>
            <div style={{fontSize:14,fontWeight:700,color:'#fff',lineHeight:1.4,marginBottom:10}}>{proj.name}</div>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:20,background:sb.bg,color:sb.color,fontSize:11,fontWeight:700}}>
                {statusLabel(proj.status)}
              </span>
              {client?.name && (
                <span
                  onClick={() => client.id && navigate(`/clients/${client.id}`)}
                  style={{fontSize:11,color:'rgba(255,255,255,.75)',fontWeight:600,
                          cursor:client.id?'pointer':'default',
                          textDecoration:client.id?'underline':'none'}}>
                  👤 {client.name}
                </span>
              )}
              {proj.area && <span style={{fontSize:11,color:'rgba(255,255,255,.6)',fontWeight:500}}>📍 {proj.area}</span>}
              {proj.size_kwp && <span style={{fontSize:11,color:'rgba(255,255,255,.6)',fontWeight:500}}>⚡ {proj.size_kwp} kWp</span>}
            </div>
          </div>

          <div style={{display:'flex',gap:8,flexWrap:'wrap',flexShrink:0}}>
            <HeroAction icon="✏️" label="Edit"
                        onClick={()=>navigate(`/projects/${id}/edit`, { state:{ from: backTo } })} />
            <HeroAction icon="⚡" label="Solar Care" primary
                        onClick={()=>navigate(`/projects/${id}/solar-care`, { state:{ from: backTo } })} />
            <HeroAction icon="🎫" label="Raise a ticket"
                        onClick={()=>navigate(`/projects/${id}/tickets/new`, { state:{ from: backTo } })} />
          </div>
        </div>
      </div>

      {/*  Empty fields are hidden so the page reads as a summary rather than a
           column dump — but they are one tap away, because "is that blank or
           is it just not shown?" is exactly the doubt this page had before. */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',
                   background:'var(--white)',borderBottom:'1px solid var(--slate-200)',
                   fontSize:11,color:'var(--text-muted)',fontWeight:600}}>
        <span>{fieldCount} field{fieldCount===1?'':'s'}</span>
        <button
          onClick={()=>setShowEmpty(v=>!v)}
          style={{marginLeft:'auto',background:'none',border:'none',color:'var(--brand)',
                  fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          {showEmpty ? 'Hide empty fields' : 'Show empty fields'}
        </button>
      </div>

      {sections.map(sec => <Section key={sec.title} {...sec} />)}

      {/* Solar Care summary */}
      <div className="detail-section">
        <div className="detail-section-title">⚡ Solar Care</div>
        <div style={{display:'flex',gap:10,padding:'12px 14px'}}>
          <div
            onClick={()=>navigate(`/projects/${encodeURIComponent(id)}/solar-care`)}
            style={{flex:1,padding:'12px 10px',borderRadius:12,border:'1.5px solid var(--slate-200)',
                    cursor:'pointer',textAlign:'center',background:'var(--white)'}}>
            <div style={{fontSize:18}}>🎫</div>
            <div style={{fontSize:19,fontWeight:800,color:'var(--text-head)',marginTop:4}}>
              {ticketStats ? ticketStats.open : '—'}
            </div>
            <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>
              open ticket{ticketStats?.open === 1 ? '' : 's'}
            </div>
          </div>
          <div
            onClick={()=>navigate(`/projects/${encodeURIComponent(id)}/solar-care`)}
            style={{flex:1,padding:'12px 10px',borderRadius:12,border:'1.5px solid var(--slate-200)',
                    cursor:'pointer',textAlign:'center',background:'var(--white)'}}>
            <div style={{fontSize:18}}>🔧</div>
            <div style={{fontSize:19,fontWeight:800,color:'var(--text-head)',marginTop:4}}>
              {amcContracts.length}
            </div>
            <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>
              AMC contract{amcContracts.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div style={{padding:'0 14px 13px'}}>
          <button onClick={()=>navigate(`/projects/${encodeURIComponent(id)}/solar-care`)}
            style={{width:'100%',height:38,background:'var(--brand)',color:'#fff',border:'none',
                    borderRadius:10,fontSize:12.5,fontWeight:700,cursor:'pointer'}}>
            Open Solar Care
          </button>
        </div>
      </div>

      {/* AMC contracts */}
      <div className="detail-section">
        <div className="detail-section-title">
          📅 AMC Contracts
          <span style={{background:'var(--slate-200)',color:'var(--text-muted)',borderRadius:10,padding:'1px 7px',fontSize:10,fontWeight:700,marginLeft:4}}>
            {amcContracts.length}
          </span>
        </div>

        {amcContracts.length === 0
          ? <div style={{padding:'20px',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>No AMC contracts</div>
          : amcContracts.map(c => {
              const pct = c.progress_pct ?? (c.total_visits ? Math.round((c.completed_visits / c.total_visits) * 100) : 0);
              return (
                <div key={c.amc_id}
                  onClick={() => navigate(`/amc/contracts/${encodeURIComponent(c.amc_id)}`)}
                  style={{padding:'12px 14px',borderBottom:'1px solid var(--slate-50)',cursor:'pointer'}}>

                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:'var(--text-head)'}}>{c.amc_type}</div>
                      <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>
                        {c.frequency} visits/year · {c.period_years} year{c.period_years > 1 ? 's' : ''}
                        {c.next_visit_date ? ` · next ${String(c.next_visit_date).slice(0,10)}` : ''}
                      </div>
                    </div>
                    <span className={c.status === 'Active' ? 'badge-done' : 'badge-pending'}>{c.status}</span>
                    <span style={{color:'var(--text-muted)',fontSize:15}}>›</span>
                  </div>

                  <div style={{marginTop:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:10.5,color:'var(--text-muted)',marginBottom:4}}>
                      <span><b style={{color:'var(--text-head)'}}>{c.completed_visits}</b> of <b style={{color:'var(--text-head)'}}>{c.total_visits}</b> visits completed</span>
                      <span>{c.pending_visits} pending</span>
                    </div>
                    <div style={{height:5,borderRadius:3,background:'var(--slate-200)'}}>
                      <div style={{width:`${pct}%`,height:'100%',borderRadius:3,background:'#22c55e'}}/>
                    </div>
                  </div>
                </div>
              );
            })
        }
      </div>

      <Attachments projectId={id} />
    </div>
  );
}

/* ── attachments (unchanged) ──────────────────────────────────────────── */

function Attachments({ projectId }) {
  const [files, setFiles]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState(null);
  const [tick, setTick]     = useState(0);

  useEffect(() => {
    let alive = true;
    setLoad(true); setErr(null);
    api.get(`/api/projects/${projectId}/attachments`)
      .then(r => { if (alive) { setFiles(r?.data ?? []); setErr(null); } })
      .catch(e => { if (alive) { setFiles([]); setErr(e.message || 'Request failed'); } })
      .finally(() => alive && setLoad(false));
    return () => { alive = false; };
  }, [projectId, tick]);

  const icon = ext => {
    if (['xlsx','xls','xlsm','csv'].includes(ext)) return { bg:'#DCFCE7', fg:'#15803D', tag:'XLS' };
    if (ext === 'pdf')                             return { bg:'#FEE2E2', fg:'#B91C1C', tag:'PDF' };
    if (['jpg','jpeg','png','webp','heic'].includes(ext)) return { bg:'#DBEAFE', fg:'#1D4ED8', tag:'IMG' };
    if (['doc','docx'].includes(ext))              return { bg:'#DBEAFE', fg:'#1E40AF', tag:'DOC' };
    return { bg:'var(--slate-100)', fg:'var(--text-muted)', tag:(ext||'FILE').toUpperCase().slice(0,4) };
  };

  const size = b => {
    if (!b) return null;
    const n = Number(b);
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n/1024).toFixed(0) + ' KB';
    return (n/1048576).toFixed(1) + ' MB';
  };

  return (
    <div className="detail-section">
      <div className="detail-section-title">
        📎 Attachments {!loading && <span className="sec-count">{files.filter(f=>f.found).length}</span>}
      </div>

      {loading && (
        <div style={{padding:'18px',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>
          Looking up files in Drive…
        </div>
      )}

      {!loading && err && (
        <div className="att-error">
          <div className="att-error-title">Could not load attachments</div>
          <div className="att-error-msg">{err}</div>
          <div className="att-error-hint">
            Usually one of: the backend was not restarted after adding the
            <code> /attachments</code> route, or Apps Script was saved but not
            re-deployed as a <strong>New version</strong>.
          </div>
          <button className="att-retry" onClick={() => setTick(t => t + 1)}>Retry</button>
        </div>
      )}

      {!loading && !err && !files.length && (
        <div style={{padding:'20px',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>
          No documents uploaded for this project
        </div>
      )}

      {!loading && files.map(f => {
        const ic = icon(f.ext);
        const body = (
          <>
            <div className="att-icon" style={{background:ic.bg,color:ic.fg}}>{ic.tag}</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="att-label">{f.label}</div>
              <div className="att-sub">
                {f.found
                  ? [f.ext?.toUpperCase(), size(f.size)].filter(Boolean).join(' · ')
                  : 'Not found in Drive'}
              </div>
            </div>
            {f.found ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>
              </svg>
            ) : (
              <span className="att-missing">!</span>
            )}
          </>
        );

        return f.found ? (
          <a key={f.kind} className="att-row" href={f.download} download title={`Download ${f.label}`}>
            {body}
          </a>
        ) : (
          <div key={f.kind} className="att-row disabled" title={f.error || f.path}>{body}</div>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',flexDirection:'column',gap:14}}>
      <div style={{width:36,height:36,border:'3px solid var(--slate-200)',borderTop:'3px solid var(--brand)',borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
      <div style={{fontSize:13,color:'var(--text-muted)',fontWeight:500}}>Loading project…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function NotFound({ onBack }) {
  return (
    <div style={{padding:'60px 24px',textAlign:'center'}}>
      <div style={{fontSize:40,marginBottom:14}}>🔍</div>
      <div style={{fontSize:15,fontWeight:700,color:'var(--text-head)',marginBottom:6}}>Project not found</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:20}}>This project doesn't exist or was removed.</div>
      <button onClick={onBack} style={{background:'var(--brand)',color:'#fff',border:'none',borderRadius:10,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>← Back to Projects</button>
    </div>
  );
}