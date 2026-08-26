// ── ProjectsMap ───────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { useDebounce } from '../hooks/useDebounce';
import { useSheetSync } from '../hooks/useSheetSync';
import { useParams, useSearchParams } from 'react-router-dom';

/*  Status colour used by the search results below. Kept local (and
    prefix-matching) so "Defaulted - Project Payment", "Out of SolarCare" and
    "Completed" all resolve — the old STATUS_COLOR map in lib/data.js had none
    of them and fell back to the brand green.                              */
const statusColour = status => {
  const s = String(status || '').trim();
  if (s === 'Active')            return '#16A34A';
  if (s === 'Under SolarCare')   return '#7C3AED';
  if (s === 'Out of SolarCare')  return '#64748B';
  if (s === 'Completed')         return '#0891B2';
  if (s === 'On Hold')           return '#2563EB';
  if (s.startsWith('Defaulted')) return '#D97706';
  if (s === 'Cancelled')         return '#DC2626';
  return 'var(--brand)';
};

/*  ProjectsMap now lives in its own file (real Leaflet map with working
    zoom / pan). Re-exported here so existing imports keep working:
        import { ProjectsMap } from './pages/Pages'                        */
export { default as ProjectsMap } from './ProjectsMap';

// ── AllClients ────────────────────────────────────────────────
export function AllClients() {
  const navigate=useNavigate();
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(true);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return api.get('/api/clients?limit=5000')
      .then(res=>setClients(Array.isArray(res)?res:(res?.data??[])))
      .catch(()=>{ if(!silent) setClients([]); })
      .finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{load();},[load]);
  useSheetSync(()=>load(true), 30000);

  if (loading) return <SkelList/>;

  if (!clients.length) return (
    <EmptyScreen icon="👥" title="No clients yet" sub="Add your first client to get started"/>
  );

  return (
    <div style={{background:'var(--white)',minHeight:'100%'}}>
      <div style={{padding:'10px 16px',fontSize:11,fontWeight:600,color:'var(--text-muted)',background:'var(--slate-50)',borderBottom:'1px solid var(--slate-200)'}}>
        {clients.length} client{clients.length!==1?'s':''}
      </div>
      {clients.map((c,i)=>(
        <div key={c.id||i} className="list-item" onClick={()=>navigate(`/clients/${c.id}`)}>
          <div className="item-avatar" style={{background:'var(--brand-l)',color:'var(--brand-d)',fontSize:13,fontWeight:700}}>
            {(c.name||'?')[0].toUpperCase()}
          </div>
          <div className="item-body">
            <div className="item-name">{c.name}</div>
            <div className="item-meta">
              <span style={{fontSize:11,color:'var(--text-muted)'}}>{c.phone}</span>
              {c.client_identity&&<span className="item-type-badge">{c.client_identity}</span>}
            </div>
          </div>
          <div className="row-actions labelled" onClick={e=>e.stopPropagation()}>
            <button
              className="row-action"
              title="Edit client"
              onClick={e=>{e.stopPropagation();navigate(`/clients/${c.id}/edit`);}}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>
              </svg>
              <span className="ra-label">Edit</span>
            </button>

            <button
              className="row-action primary"
              title="Add a project for this client"
              onClick={e=>{e.stopPropagation();navigate(`/clients/${c.id}/add-project`);}}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span className="ra-label">Add project</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ClientDetail ──────────────────────────────────────────────
export function ClientDetail() {
  const {id}=useParams();
  const navigate=useNavigate();
  const [client,setClient]=useState(null);
  const [loading,setLoading]=useState(true);
  const [notFound,setNotFound]=useState(false);

  useEffect(()=>{
    setClient(null);setLoading(true);setNotFound(false);
    api.get(`/api/clients/${id}`)
      .then(res=>{const c=res?.data??res;if(!c?.id){setNotFound(true);return;}setClient(c);})
      .catch(()=>setNotFound(true))
      .finally(()=>setLoading(false));
  },[id]);

  if(loading)return <SkelList/>;
  if(notFound)return <EmptyScreen icon="👤" title="Client not found" sub="This client may have been removed." action={{label:'← Back',onClick:()=>navigate('/clients')}}/>;

  const projs=client.projects||[];

  return (
    <div style={{background:'var(--slate-100)',minHeight:'100%',paddingBottom:80}}>
      {/* Header card */}
      <div style={{background:'var(--slate-900)',padding:'18px 18px 16px',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:-10,right:-10,width:100,height:100,borderRadius:'50%',background:'rgba(0,135,90,.1)'}}/>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:48,height:48,borderRadius:14,background:'var(--brand)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:800,color:'#fff',flexShrink:0}}>
            {(client.name||'?')[0].toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:17,fontWeight:800,color:'#fff',letterSpacing:'-.01em'}}>{client.name}</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,.55)',marginTop:3}}>{client.phone}</div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{display:'flex',gap:10,padding:'12px 14px',background:'var(--white)',borderBottom:'1px solid var(--slate-100)'}}>
        <button onClick={()=>navigate(`/clients/${id}/add-project`)} style={{flex:1,height:38,background:'var(--brand)',color:'#fff',border:'none',borderRadius:10,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Project
        </button>
        <button onClick={()=>navigate(`/clients/${id}/edit`)} style={{flex:1,height:38,background:'var(--white)',color:'var(--text-head)',border:'1.5px solid var(--slate-200)',borderRadius:10,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit Client
        </button>
      </div>

      {/* Details */}
      <div className="detail-section">
        <div className="detail-section-title">📋 Client Information</div>
        {[
          ['Email',    client.email||'—'],
          ['Address',  client.billing_address||'—'],
          ['Region',   client.region||'—'],
          ['Type',     client.client_identity||'—'],
          ['Client Of',client.type_of_client==='External' ? 'External (AMC)' : 'Internal (EPC, I&C)'],
        ].map(([l,v])=>(
          <div key={l} className="detail-row">
            <div className="d-label">{l}</div>
            <div className="d-value">{v}</div>
          </div>
        ))}
        {client.lat&&client.lng&&(
          <div className="detail-row">
            <div className="d-label">Location</div>
            <div className="d-value" style={{fontFamily:'monospace',fontSize:12}}>{client.lat?.toFixed(5)}, {client.lng?.toFixed(5)}</div>
          </div>
        )}
        {client.notes&&(
          <div className="detail-row">
            <div className="d-label">Notes</div>
            <div className="d-value" style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5}}>{client.notes}</div>
          </div>
        )}
      </div>

      {/* Projects */}
      <div className="detail-section">
        <div className="detail-section-title">
          🏗 Projects
          <span style={{background:'var(--slate-200)',color:'var(--text-muted)',borderRadius:10,padding:'1px 7px',fontSize:10,fontWeight:700,marginLeft:6}}>{projs.length}</span>
        </div>
        {projs.length>0
          ? projs.map(p=>(
              <div key={p.id} className="list-item" onClick={()=>navigate(`/projects/${p.id}`)}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'var(--brand)',flexShrink:0,marginTop:4}}/>
                <div className="item-body">
                  <div className="item-name">{p.name}</div>
                  <div className="item-meta">
                    <span className="item-type-badge">{p.area||'—'}</span>
                    {p.size_kwp&&<span className="item-type-badge">{p.size_kwp} kWp</span>}
                  </div>
                </div>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--slate-300)" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </div>
            ))
          : <div style={{padding:'20px',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>No projects yet</div>
        }
      </div>
    </div>
  );
}

// ── AMCTasks ──────────────────────────────────────────────────
export function AMCTasks() {
  const navigate=useNavigate();
  const [params]=useSearchParams();
  const projectId=params.get('project');          // set by the wrench icon on a row
  const [tasks,setTasks]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    setLoading(true);
    const qs=new URLSearchParams({limit:'5000'});
    if(projectId) qs.set('project_id',projectId);
    api.get(`/api/amc?${qs}`)
      .then(res=>setTasks(Array.isArray(res)?res:(res?.data??[])))
      .catch(()=>setTasks([]))
      .finally(()=>setLoading(false));
  },[projectId]);

  const heading = projectId
    ? (tasks[0]?.projects?.name || `Project ${projectId}`)
    : null;

  if(loading)return <SkelList/>;
  if(!tasks.length)return <EmptyScreen icon="📅" title="No AMC tasks" sub={projectId?"This project has no AMC tasks yet":"AMC tasks will appear here once contracts are created"}/>;

  return (
    <div style={{overflowX:'auto'}}>
      {projectId && (
        <div style={{padding:'10px 14px',display:'flex',alignItems:'center',gap:10,
                     background:'var(--slate-50)',borderBottom:'1px solid var(--slate-200)'}}>
          <span style={{fontSize:11,fontWeight:700,color:'var(--text-muted)'}}>
            {tasks.length} task{tasks.length!==1?'s':''} · {heading}
          </span>
          <button onClick={()=>navigate('/amc')}
            style={{marginLeft:'auto',background:'var(--white)',border:'1px solid var(--slate-300)',
                    borderRadius:8,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',
                    color:'var(--text-body)'}}>Show all AMC tasks</button>
        </div>
      )}
      <table className="amc-table">
        <thead>
          <tr>
            <th>Description</th><th>Due Date</th><th>Resolution</th><th>Status</th><th>Project</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t=>(
            /*  The API returns this joined project under `projects` (plural).
                Reading `t.project` here left the column permanently blank, which
                also made rows from different sites look like duplicates.     */
            <tr key={t.id} onClick={()=>t.project_id&&navigate(`/projects/${t.project_id}`)}
                style={{cursor:t.project_id?'pointer':'default'}}>
              <td>{t.description}</td>
              <td style={{whiteSpace:'nowrap'}}>{t.due_date}</td>
              <td style={{color:'var(--text-muted)'}}>{t.resolution||'—'}</td>
              <td><span className={t.status==='Done'?'badge-done':'badge-pending'}>{t.status}</span></td>
              <td style={{color:'var(--brand)',fontSize:11}}>
                {t.projects?.name
                  ? <>
                      {t.projects.name.slice(0,28)}
                      {t.projects?.clients?.name &&
                        <div style={{color:'var(--text-muted)',fontSize:10,marginTop:2}}>
                          {t.projects.clients.name.slice(0,24)}
                        </div>}
                    </>
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SearchPage ────────────────────────────────────────────────
export function SearchPage() {
  const navigate=useNavigate();
  const [q,setQ]=useState('');
  const [res,setRes]=useState({clients:[],projects:[]});
  const [busy,setBusy]=useState(false);
  const debQ=useDebounce(q,250);

  useEffect(()=>{
    if(!debQ.trim()){setRes({clients:[],projects:[]});return;}
    setBusy(true);
    Promise.all([
      api.get(`/api/clients?q=${encodeURIComponent(debQ)}&limit=20`).catch(()=>null),
      api.get(`/api/projects?q=${encodeURIComponent(debQ)}&limit=20`).catch(()=>null),
    ]).then(([c,p])=>{
      setRes({clients:Array.isArray(c)?c:(c?.data??[]),projects:Array.isArray(p)?p:(p?.data??[])});
    }).finally(()=>setBusy(false));
  },[debQ]);

  function hl(text) {
    if(!debQ)return text;
    const parts=text.split(new RegExp(`(${debQ.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'));
    return parts.map((p,i)=>i%2===1?<mark key={i} style={{background:'#FEF9C3',borderRadius:2}}>{p}</mark>:p);
  }

  return (
    <div style={{background:'var(--white)',minHeight:'100%'}}>
      {/* Search input */}
      <div style={{padding:'12px 16px',background:'var(--white)',borderBottom:'1px solid var(--slate-200)',position:'sticky',top:0,zIndex:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10,background:'var(--slate-100)',border:'1.5px solid var(--slate-200)',borderRadius:12,padding:'0 14px',height:44,transition:'border .15s'}}
          onFocusCapture={e=>e.currentTarget.style.borderColor='var(--brand)'}
          onBlurCapture={e=>e.currentTarget.style.borderColor='var(--slate-200)'}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search clients or projects…"
            style={{flex:1,border:'none',background:'transparent',fontSize:13,fontFamily:'inherit',color:'var(--text-head)',outline:'none'}}/>
          {busy&&<div style={{width:14,height:14,border:'2px solid var(--slate-300)',borderTop:'2px solid var(--brand)',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>}
          {q&&!busy&&<button onClick={()=>setQ('')} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:18,lineHeight:1,padding:0}}>×</button>}
        </div>
      </div>

      {debQ&&!busy&&!res.clients.length&&!res.projects.length&&(
        <div style={{padding:'48px 24px',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>No results for "{debQ}"</div>
      )}

      {res.clients.length>0&&(
        <>
          <div className="search-group">Clients ({res.clients.length})</div>
          {res.clients.map(c=>(
            <div key={c.id} className="search-result" onClick={()=>navigate(`/clients/${c.id}`)}>
              <div className="s-avatar" style={{background:'var(--brand-l)',color:'var(--brand-d)',fontWeight:700,fontSize:13}}>{(c.name||'?')[0]}</div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'var(--text-head)'}}>{hl(c.name)}</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                  {c.phone} · {c.client_identity||'Individual'}
                  {c.id&&<> · <span style={{fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontSize:10.5}}>{hl(String(c.id))}</span></>}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {res.projects.length>0&&(
        <>
          <div className="search-group">Projects ({res.projects.length})</div>
          {res.projects.map(p=>(
            <div key={p.id} className="search-result" onClick={()=>navigate(`/projects/${p.id}`)}>
              <div className="s-avatar" style={{background:'var(--brand-l)',color:'var(--brand-d)'}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text-head)'}}>{hl(p.name)}</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                  <span style={{color:statusColour(p.status),fontWeight:600}}>{p.status}</span>
                  {p.size_kwp&&` · ${p.size_kwp} kWp`}
                  {/*  The id is shown because it is now searchable. Matching on
                       "3554" and seeing only a project name gives no way to tell
                       WHICH id matched, or whether it matched the id at all.  */}
                  {p.id&&<> · <span style={{fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontSize:10.5}}>{hl(String(p.id))}</span></>}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────
function SkelList() {
  return Array.from({length:5}).map((_,i)=>(
    <div key={i} style={{padding:'12px 16px',borderBottom:'1px solid var(--slate-100)',display:'flex',gap:10}}>
      <div className="skeleton" style={{width:36,height:36,borderRadius:10,flexShrink:0}}/>
      <div style={{flex:1}}>
        <div className="skeleton" style={{height:12,width:'60%',marginBottom:7}}/>
        <div className="skeleton" style={{height:10,width:'35%'}}/>
      </div>
    </div>
  ));
}

function EmptyScreen({ icon, title, sub, action }) {
  return (
    <div style={{padding:'60px 24px',textAlign:'center'}}>
      <div style={{fontSize:40,marginBottom:14}}>{icon}</div>
      <div style={{fontSize:15,fontWeight:700,color:'var(--text-head)',marginBottom:6}}>{title}</div>
      <div style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5}}>{sub}</div>
      {action&&<button onClick={action.onClick} style={{marginTop:16,background:'var(--brand)',color:'#fff',border:'none',borderRadius:10,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>{action.label}</button>}
    </div>
  );
}