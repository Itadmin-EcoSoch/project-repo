/*  frontend/src/pages/AllProjects.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    WHAT CHANGED, AND WHY

    The chosen filter, the search box and how far down the list you had scrolled
    all lived in component state. Opening a project unmounts this component, and
    coming back mounts a FRESH one — so every one of those reset. You were sent
    back to "All", at the top, every single time.

    They now live in the URL instead:

        /projects?status=Under%20SolarCare&q=whitefield

    The back arrow already calls navigate(-1), which restores the previous URL,
    so restoring that URL is all it takes. It also means the filtered list is a
    real, shareable, bookmarkable address — paste it into Slack and the other
    person lands on the same list you were looking at.

    Scroll position and the "load more" count cannot go in the URL without
    making it ugly, so they are kept in sessionStorage against the search
    string, and restored only when you return to the SAME list.
--------------------------------------------------------------------------- */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';
import { useSheetSync } from '../hooks/useSheetSync';

import {
  matchesStatus, buildStatusChips,
  statusClass, statusDot, statusLabel, isDefaulted,
} from '../lib/status';

/*  Where the list's scroll position is remembered. sessionStorage, not local:
    it should survive a click into a project and back, not next Monday.     */
const SCROLL_KEY = 'ecosoch.projects.scroll';

/** The scrolling element is <main class="content-area">, not the window. */
const scroller = () => document.querySelector('.content-area');

function RowActions({ p, navigate, from }) {
  const go = (e, path) => { e.stopPropagation(); navigate(path, { state: { from } }); };
  const clientId = p.client_id || p.clients?.id;

  return (
    <div className="row-actions labelled" onClick={e => e.stopPropagation()}>
      <button className="row-action" disabled={!clientId}
        title={clientId ? `Client: ${p.clients?.name || p.client_name || ''}` : 'No client linked'}
        onClick={e => clientId && go(e, `/clients/${clientId}`)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
        <span className="ra-label">Client</span>
      </button>
      <button className="row-action" title="Edit project" onClick={e => go(e, `/projects/${p.id}/edit`)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>
        </svg>
        <span className="ra-label">Edit</span>
      </button>
      <button className="row-action" title="AMC tasks for this project" onClick={e => go(e, `/amc?project=${p.id}`)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M14.7 6.3a4 4 0 01-5.6 5.6l-5.7 5.7a2 2 0 102.8 2.8l5.7-5.7a4 4 0 015.6-5.6l-2.6 2.6-2.1-2.1z"/>
        </svg>
        <span className="ra-label">AMC</span>
      </button>
    </div>
  );
}

export default function AllProjects() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  /*  THE FIX: filter and search are read from the URL, not from useState, so
      they survive unmount. Everything below is unchanged apart from reading
      `filter` here instead of from state.                                  */
  const filter = params.get('status') || 'All';
  const urlQ   = params.get('q') || '';

  const [projects, setProjects] = useState([]);
  const [search,   setSearch]   = useState(urlQ);
  const [loading,  setLoading]  = useState(true);
  const [shown,    setShown]    = useState(150);
  const debQ = useDebounce(search, 250);

  /*  The address of THIS list, handed to every page you can open from it so
      they know where "back" is even when history has been replaced.        */
  const listUrl = `${location.pathname}${location.search}`;

  const restored = useRef(false);   // scroll restore runs once per mount

  /* ── the typed search box → the URL, debounced ──────────────────────── */
  useEffect(() => {
    const q = debQ.trim();
    if (q === urlQ) return;
    const next = new URLSearchParams(params);
    if (q) next.set('q', q); else next.delete('q');
    /*  replace, not push: typing eight characters should not put eight
        entries in the history for the back button to walk through.        */
    setParams(next, { replace: true });
  }, [debQ]);                        // eslint-disable-line react-hooks/exhaustive-deps

  /*  If the URL changes underneath us — back button, a pasted link — pull the
      search box back into line with it.                                    */
  useEffect(() => { setSearch(s => (s.trim() === urlQ ? s : urlQ)); }, [urlQ]);

  const setFilter = key => {
    const next = new URLSearchParams(params);
    if (key && key !== 'All') next.set('status', key); else next.delete('status');
    setParams(next, { replace: true });
    const el = scroller();
    if (el) el.scrollTop = 0;        // a new filter starts at the top
  };

  /* ── data ───────────────────────────────────────────────────────────── */
  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setProjects([]); }
    try {
      const res = await api.get('/api/projects?limit=5000');
      setProjects(Array.isArray(res) ? res : (res?.data ?? []));
    } catch { if (!silent) setProjects([]); }
    finally  { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useSheetSync(() => load(true), 30000);

  const chips = useMemo(() => buildStatusChips(projects), [projects]);

  const visible = useMemo(() => {
    let rows = projects;
    if (filter !== 'All') rows = rows.filter(p => matchesStatus(p.status, filter));
    const q = debQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter(p =>
        [p.name, p.area, p.client_name, p.clients?.name]
          .some(v => v && String(v).toLowerCase().includes(q))
      );
    }
    return rows;
  }, [projects, filter, debQ]);

  /*  Reset the page size when the LIST changes — but not on the first render
      after a restore, or we would undo the restore we just did.            */
  useEffect(() => {
    if (!restored.current) return;
    setShown(150);
    const el = scroller();
    if (el) el.scrollTop = 0;
  }, [filter, debQ]);

  /* ── remember / restore scroll + page size ──────────────────────────── */

  /* save on every scroll, cheaply */
  useEffect(() => {
    const el = scroller();
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        try {
          sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
            search: location.search, top: el.scrollTop, shown,
          }));
        } catch { /* private mode — not worth failing over */ }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [location.search, shown]);

  /*  Restore once the rows are actually on screen. Restoring before the list
      has painted would scroll a short page and land at the top anyway.     */
  useEffect(() => {
    if (loading || restored.current) return;
    restored.current = true;
    if (!visible.length) return;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null'); } catch { /* ignore */ }
    if (!saved || saved.search !== location.search) return;

    if (saved.shown && saved.shown > shown) setShown(saved.shown);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scroller();
        if (el && saved.top) el.scrollTop = saved.top;
      });
    });
  }, [loading, visible.length]);     // eslint-disable-line react-hooks/exhaustive-deps

  /*  Opening a project carries the list address with it, so the project page
      can offer a real "back to this list" even if you arrived from a link.  */
  const openProject = id => navigate(`/projects/${id}`, { state: { from: listUrl } });

  return (
    <div style={{background:'var(--white)',minHeight:'100%'}}>
      <div className="filter-bar">
        {chips.map(c => (
          <button
            key={c.key}
            className={`pill${filter===c.key?' active':''}`}
            onClick={()=>setFilter(c.key)}
            title={c.key}
          >
            {c.label}
            <span style={{
              marginLeft:6, fontSize:10, fontWeight:800, opacity:.75,
              padding:'1px 6px', borderRadius:8,
              background: filter===c.key ? 'rgba(255,255,255,.22)' : 'var(--slate-100)',
            }}>{c.count}</span>
          </button>
        ))}
      </div>

      {!loading && (
        <div style={{padding:'8px 16px',fontSize:11,color:'var(--text-muted)',fontWeight:600,background:'var(--slate-50)',borderBottom:'1px solid var(--slate-200)',display:'flex',alignItems:'center',gap:8}}>
          <span>
            Showing {Math.min(shown,visible.length)} of {visible.length} project{visible.length!==1?'s':''}
            {filter!=='All' ? ` \u00b7 ${filter}` : ''}
            {debQ.trim() ? ` \u00b7 "${debQ.trim()}"` : ''}
          </span>
          {(filter!=='All' || debQ.trim()) && (
            <button
              onClick={()=>{ setSearch(''); setParams(new URLSearchParams(), { replace:true }); }}
              style={{marginLeft:'auto',background:'none',border:'none',color:'var(--brand)',
                      fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              Clear filter
            </button>
          )}
        </div>
      )}

      {loading
        ? <SkeletonList />
        : visible.length===0
          ? <Empty filter={filter} />
          : visible.slice(0,shown).map(p=>{
              const cls = statusClass(p.status);
              const dot = statusDot(p.status);
              return (
                <div key={p.id} className="list-item" onClick={()=>openProject(p.id)}>
                  <div className="item-avatar" style={{background:`${dot}15`,color:dot}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                    </svg>
                  </div>
                  <div className="item-body">
                    <div className="item-name">{p.name}</div>
                    <div className="item-meta">
                      <span className={`item-status ${cls}`}>
                        {statusLabel(p.status)}
                        {isDefaulted(p.status) && p.defaulted_pct ? ` (${p.defaulted_pct}%)` : ''}
                      </span>
                      <span className="item-type-badge">{p.project_type||'EPC'}</span>
                      {p.size_kwp && <span className="item-type-badge">{p.size_kwp} kWp</span>}
                      {p.amc_type && p.amc_type !== 'None' && <span className="item-type-badge">{p.amc_type}</span>}
                      {(p.clients?.name || p.client_name) && <span className="item-sub">{p.clients?.name || p.client_name}</span>}
                    </div>
                  </div>
                  <RowActions p={p} navigate={navigate} from={listUrl} />
                </div>
              );
            })
      }

      {!loading && visible.length > shown && (
        <div style={{padding:'14px 16px',textAlign:'center'}}>
          <button
            onClick={()=>setShown(s=>s+250)}
            style={{background:'var(--white)',border:'1px solid var(--slate-300)',borderRadius:10,
                    padding:'10px 22px',fontSize:13,fontWeight:700,cursor:'pointer',color:'var(--text-1)'}}>
            Load 250 more ({visible.length - shown} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

function SkeletonList() {
  return Array.from({length:7}).map((_,i)=>(
    <div key={i} style={{padding:'12px 16px',borderBottom:'1px solid var(--slate-100)',display:'flex',gap:10,alignItems:'center'}}>
      <div className="skeleton" style={{width:32,height:32,borderRadius:10,flexShrink:0}}/>
      <div style={{flex:1}}>
        <div className="skeleton" style={{height:12,width:'68%',marginBottom:7}}/>
        <div className="skeleton" style={{height:10,width:'35%'}}/>
      </div>
    </div>
  ));
}

function Empty({ filter }) {
  return (
    <div style={{padding:'60px 24px',textAlign:'center'}}>
      <div style={{width:56,height:56,borderRadius:16,background:'var(--brand-l)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <div style={{fontSize:14,fontWeight:700,color:'var(--text-head)',marginBottom:5}}>No projects found</div>
      <div style={{fontSize:12,color:'var(--text-muted)'}}>
        {filter!=='All'?`No "${filter}" projects`:'Projects will appear here once added'}
      </div>
    </div>
  );
}