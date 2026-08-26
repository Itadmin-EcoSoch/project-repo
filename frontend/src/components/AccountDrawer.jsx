/*  frontend/src/components/AccountDrawer.jsx
    ----------------------------------------------------------------------------
    Slide-in account panel: who you are, appearance (light / dark / system),
    app preferences, and sign out.
--------------------------------------------------------------------------- */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import api, { refreshFromSheet } from '../lib/api';

const THEMES = [
  { key:'light',  label:'Light',  hint:'Always bright' },
  { key:'dark',   label:'Dark',   hint:'Always dim' },
  { key:'system', label:'System', hint:'Follow your device' },
];

export default function AccountDrawer({ open, onClose }) {
  const navigate = useNavigate();
  const { user, signOut, isAdmin, permissions } = useAuth();
  const { mode, setMode, resolved } = useTheme();

  const [syncing, setSyncing] = useState(false);
  const [health,  setHealth]  = useState(null);

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // pull row counts when the drawer opens
  useEffect(() => {
    if (!open) return;
    api.get('/api/sync/status').then(r => setHealth(r?.data || null)).catch(() => setHealth(null));
  }, [open]);

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  async function syncNow() {
    setSyncing(true);
    await refreshFromSheet();
    setSyncing(false);
    window.location.reload();
  }

  function handleSignOut() {
    signOut();
    onClose();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <div className={`drawer-scrim${open ? ' open' : ''}`} onClick={onClose} />

      <aside className={`account-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <div className="drawer-avatar">
            {user?.picture
              ? <img src={user.picture} alt="" referrerPolicy="no-referrer" />
              : <span>{initials}</span>}
          </div>
          <div style={{minWidth:0}}>
            <div className="drawer-name">{user?.name || 'Not signed in'}</div>
            <div className="drawer-email">{user?.email || '—'}</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {user && (
          <div className="drawer-badges">
            <span className="drawer-badge">{user.role || 'User'}</span>
            {permissions && (
              <span className="drawer-badge alt" title="What this role can do">
                {permissions.capabilities?.delete ? 'Can delete'
                  : permissions.capabilities?.create ? 'Can add & edit'
                  : 'Read only'}
              </span>
            )}
            {user.department && user.department !== 'All' &&
              <span className="drawer-badge alt">{user.department}</span>}
          </div>
        )}

        {/* ---- Appearance ---- */}
        <div className="drawer-section">
          <div className="drawer-section-title">Appearance</div>
          <div className="theme-grid">
            {THEMES.map(t => (
              <button
                key={t.key}
                className={`theme-opt${mode === t.key ? ' active' : ''}`}
                onClick={() => setMode(t.key)}
              >
                <span className={`theme-swatch ${t.key}`} />
                <span className="theme-label">{t.label}</span>
                <span className="theme-hint">{t.hint}</span>
              </button>
            ))}
          </div>
          <div className="drawer-note">
            Currently showing the <strong>{resolved}</strong> theme.
          </div>
        </div>

        {/* ---- Data ---- */}
        <div className="drawer-section">
          <div className="drawer-section-title">Data</div>
          <button className="drawer-row" onClick={syncNow} disabled={syncing}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            <span>{syncing ? 'Syncing…' : 'Sync now from Google Sheet'}</span>
          </button>

          {health && (
            <div className="drawer-stats">
              {[['Clients','clients'],['Projects','projects'],['AMC tasks','amc_tasks'],['Tickets','tickets']]
                .map(([label,key]) => (
                  <div key={key} className="drawer-stat">
                    <span>{label}</span><strong>{health[key]?.rows ?? '—'}</strong>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/*  ---- Manage ----
             Team members decides who gets into the app at all, so it is
             Admin-only. A Staff account does not see it rather than seeing
             it and being refused.

             App launcher is deliberately NOT linked here. The feature is
             unfinished — most of its fields silently fail to save (see
             backend/lib/mapping.js, which is missing entries for icon,
             target app/view, external URL, status, color, help text, badge
             count and featured), and nothing in the app actually reads this
             data back out to show as tiles anywhere. The page and route
             still exist (pages/Launcher.jsx, LauncherManager.jsx,
             /launcher-manager in main.jsx) — only the link to reach them
             from here has been removed, so this is easy to undo later if
             the feature ever gets finished off.                            */}
        <div className="drawer-section">
          <div className="drawer-section-title">Manage</div>

          {isAdmin && <button className="drawer-row" onClick={() => { onClose(); navigate('/users'); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/>
            </svg>
            <span>Team members</span>
          </button>}

          {/*  Lets an Admin add or remove values on the project form's
              picklists (Type of Project, Sales Lead, Inverter Brand, …)
              without touching code — see pages/AdminDropdowns.jsx.        */}
          {isAdmin && <button className="drawer-row" onClick={() => { onClose(); navigate('/admin/dropdowns'); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/>
            </svg>
            <span>Dropdown lists</span>
          </button>}
          <button className="drawer-row" onClick={() => { onClose(); navigate('/amc'); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            <span>All AMC tasks</span>
          </button>

          {!isAdmin && (
            <div style={{padding:'10px 16px',fontSize:11,color:'var(--text-muted)',lineHeight:1.5}}>
              Team members and dropdown lists are managed by an admin.
            </div>
          )}
        </div>

        {/* ---- About ---- */}
        <div className="drawer-section">
          <div className="drawer-section-title">About</div>
          <div className="drawer-about">
            <div><span>App</span><strong>EcoSoch Project Repository</strong></div>
            <div><span>Version</span><strong>2.0</strong></div>
            <div><span>Database</span><strong>Google Sheets</strong></div>
          </div>
        </div>

        {user && (
          <div className="drawer-section">
            <button className="drawer-row danger" onClick={handleSignOut}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}