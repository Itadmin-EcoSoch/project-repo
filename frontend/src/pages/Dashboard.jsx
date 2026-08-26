import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useSheetSync } from '../hooks/useSheetSync';

/*  Badge class + label come from lib/status.js, which folds every spelling of
    a status onto one canonical key — so "Defaulted - Project Payment" and
    "Defaulted" render identically instead of splitting into two things. */
import { statusClass as badgeFor, statusLabel as shortStatus } from '../lib/status';

/*  Quick actions on each row, matching the AppSheet dashboard:
      person  -> that project's client
      pencil  -> edit the project
      wrench  -> AMC tasks filtered to this project
    stopPropagation keeps the row's own onClick from firing too.          */
function RowActions({ p, navigate }) {
  const go = (e, path) => { e.stopPropagation(); navigate(path); };
  const clientId = p.client_id || p.clients?.id;

  return (
    <div className="row-actions labelled" onClick={e => e.stopPropagation()}>
      <button
        className="row-action"
        title={clientId ? `Client: ${p.clients?.name || p.client_name || ''}` : 'No client linked'}
        disabled={!clientId}
        onClick={e => clientId && go(e, `/clients/${clientId}`)}
      >
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [left,  setLeft]  = useState([]);
  const [right, setRight] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return Promise.all([
      api.get('/api/projects?dashboard=left&limit=5000').catch(()=>null),
      api.get('/api/projects?dashboard=right&limit=5000').catch(()=>null),
    ]).then(([l,r]) => {
      setLeft(Array.isArray(l)?l:Array.isArray(l?.data)?l.data:[]);
      setRight(Array.isArray(r)?r:Array.isArray(r?.data)?r.data:[]);
    }).finally(()=>setLoading(false));
  }, []);

  useEffect(()=>{load();},[load]);
  useSheetSync(()=>load(true), 30000);

  return (
    <div className="dash-split">
      <DashCol
        label="To Hand Over"
        title="Pending SolarCare Handover"
        items={left}
        loading={loading}
        emptyMsg="All projects handed over"
        showAMC={false}
        navigate={navigate}
      />
      <DashCol
        label="AMC Missing"
        title="No AMC Contract"
        items={right}
        loading={loading}
        emptyMsg="All projects have AMC"
        showAMC={true}
        navigate={navigate}
      />
    </div>
  );
}

function DashCol({ label, title, items, loading, emptyMsg, showAMC, navigate }) {
  return (
    <div className="dash-col">
      <div className="dash-col-head">
        <div className="dash-col-label">{label}</div>
        <div className="dash-col-title">
          {title}
          {!loading && <span className="dash-count">{items.length}</span>}
        </div>
      </div>

      {loading
        ? <SkeletonList />
        : items.length === 0
          ? <EmptyState msg={emptyMsg} />
          : items.map(p => (
              <div key={p.id} className="list-item" onClick={()=>navigate(`/projects/${p.id}`)}>
                <div className="item-avatar">
                  {(p.name||'?')[0].toUpperCase()}
                </div>
                <div className="item-body">
                  <div className="item-name">{p.name}</div>
                  <div className="item-meta">
                    {showAMC
                      ? <span className="item-type-badge">{p.amc_type||'No AMC'}</span>
                      : <span className={`item-status ${badgeFor(p.status)}`}>{shortStatus(p.status)}</span>
                    }
                    <span className="item-type-badge">{p.project_type||'EPC'}</span>
                    {p.clients?.name && <span className="item-sub">{p.clients.name}</span>}
                  </div>
                </div>
                <RowActions p={p} navigate={navigate} />
              </div>
            ))
      }
    </div>
  );
}

function SkeletonList() {
  return Array.from({length:5}).map((_,i) => (
    <div key={i} style={{padding:'12px 14px',borderBottom:'1px solid var(--slate-100)',display:'flex',gap:10}}>
      <div className="skeleton" style={{width:32,height:32,borderRadius:10,flexShrink:0}}/>
      <div style={{flex:1}}>
        <div className="skeleton" style={{height:12,width:'75%',marginBottom:7}}/>
        <div className="skeleton" style={{height:10,width:'40%'}}/>
      </div>
    </div>
  ));
}

function EmptyState({ msg }) {
  return (
    <div style={{padding:'40px 16px',textAlign:'center'}}>
      <div style={{width:44,height:44,borderRadius:14,background:'var(--brand-l)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px'}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div style={{fontSize:12,fontWeight:600,color:'var(--text-muted)'}}>{msg}</div>
    </div>
  );
}