import { useNavigate, useLocation, NavLink } from 'react-router-dom';
import { useState } from 'react';
import { ThemeToggle } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import AccountDrawer from './AccountDrawer';
import OverflowMenu  from './OverflowMenu';
import ProgressBar   from './ProgressBar';

const NAV = [
  { to:'/dashboard',  label:'Dashboard',  Icon:DashIcon,   page:'dashboard' },
  { to:'/add-client', label:'Add Client', Icon:AddIcon,    page:'addclient' },
  { to:'/projects',   label:'Projects',   Icon:ProjIcon,   page:'projects'  },
  { to:'/map',        label:'Map',        Icon:MapIcon,    page:'map'       },
  { to:'/clients',    label:'Clients',    Icon:ClientIcon, page:'clients'   },
  { to:'/search',     label:'Search',     Icon:SearchIcon, page:'search'    },

  /*  Solar Care is deliberately NOT in the bar for now. Everything behind it
      still works — /solar-care, the project hub, tickets, AMC and the visit
      schedules are all live, reachable from the Solar Care card on any project.
      To put the tab back, uncomment this line. CareIcon below is kept for it.
        { to:'/solar-care', label:'SolarCare', Icon:CareIcon, page:'solarcare' },  */
];

const TITLES = {
  '/dashboard':'Dashboard', '/add-client':'Add Client',
  '/projects':'All Projects', '/map':'Projects Map',
  '/clients':'Clients', '/search':'Search', '/amc':'AMC Tasks',
  '/solar-care':'Solar Care', '/tickets':'Ticket',
};

export default function Layout({ children }) {
  const navigate = useNavigate();
  const { user, canPage } = useAuth();

  /*  A tab nobody can open is worse than a missing tab — Dashboard and Map are
      Manager and above, so Staff simply do not see them.                    */
  const nav = NAV.filter(n => !n.page || canPage(n.page));
  const [drawer, setDrawer] = useState(false);
  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const location = useLocation();
  const base     = '/' + location.pathname.split('/')[1];
  const isDetail = location.pathname.split('/').length > 2;
  const isAMC    = base === '/amc';
  const showBack = isDetail || isAMC;
  /*  On the AMC contract screen the title sits centred in the banner. */
  const isContract = location.pathname.startsWith('/amc/contracts');
  const title    = isContract ? 'AMC Contract Details' : (TITLES[base] || 'EcoSoch');

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar" style={{ position: 'relative' }}>
        <div className="topbar-brand">
          {showBack ? (
            <button className="topbar-btn" onClick={() => navigate(-1)} title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
          ) : (
            <img
              className="topbar-logo-img"
              src="https://ecosoch.com/Images/white-logo.png"
              alt="EcoSoch"
              onClick={() => navigate('/dashboard')}
              onError={e => {
                /* if the logo can't load (offline, site down) fall back to text */
                e.currentTarget.style.display = 'none';
                const t = document.getElementById('brand-fallback');
                if (t) t.style.display = 'inline';
              }}
            />
          )}
          {showBack
            ? <span className="topbar-title"
                    style={isContract
                      ? { position: 'absolute', left: '50%', top: '50%',
                          transform: 'translate(-50%, -50%)', pointerEvents: 'none' }
                      : undefined}>{title}</span>
            : <span className="topbar-title" id="brand-fallback" style={{ display: 'none' }}>EcoSoch</span>}
        </div>

        <div className="topbar-actions">
          {['/clients','/projects'].includes(base) && (
            <button className="topbar-btn" onClick={() => navigate('/search')} title="Search">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </button>
          )}
          {isDetail && <OverflowMenu />}
          <ThemeToggle />
          <button className="topbar-btn" onClick={() => window.location.reload()} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>

          <button
            className="topbar-avatar"
            onClick={() => setDrawer(true)}
            title={user ? `${user.name} · ${user.email}` : 'Account'}
          >
            {user?.picture
              ? <img src={user.picture} alt="" referrerPolicy="no-referrer" />
              : <span>{initials}</span>}
          </button>
        </div>
      </header>

      <AccountDrawer open={drawer} onClose={() => setDrawer(false)} />

      {/* Content */}
      <main className="content-area">{children}</main>
      <ProgressBar />

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {nav.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function DashIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>; }
function AddIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>; }
function ProjIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>; }
function MapIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>; }
function ClientIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>; }
function CareIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>; }