/*  frontend/src/components/OverflowMenu.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    The "..." button in the top bar used to render and do nothing at all. It now
    opens a real menu whose contents depend on which record you are looking at.

        /projects/:id        Copy link · Reload · Delete
                             (Edit, Solar Care and Raise a ticket are buttons on
                              the project page's own sticky header)
        /clients/:id         Edit client  · Add project     · Copy link · Delete
        /tickets/:id         Copy link    · Delete ticket
        /amc/contracts/:id   Copy link
        anywhere else        Copy link    · Reload from sheet

    Delete only appears for Admin and Super Admin. It is hidden rather than shown
    and refused, because a button that always fails is worse than no button — and
    the API refuses it anyway, so hiding it is the courtesy, not the control.
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { refreshFromSheet } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/** Work out what record the current URL is showing. */
function readContext(pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (parts[0] === 'projects' && parts[1] && parts[1] !== 'new') {
    return { kind: 'project', id: decodeURIComponent(parts[1]), leaf: parts[2] || null };
  }
  if (parts[0] === 'clients' && parts[1]) {
    return { kind: 'client', id: decodeURIComponent(parts[1]), leaf: parts[2] || null };
  }
  if (parts[0] === 'tickets' && parts[1]) {
    return { kind: 'ticket', id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'amc' && parts[1] === 'contracts' && parts[2]) {
    return { kind: 'contract', id: decodeURIComponent(parts[2]) };
  }
  if (parts[0] === 'solar-care' && parts[1] === 'clients' && parts[2]) {
    return { kind: 'client', id: decodeURIComponent(parts[2]) };
  }
  return { kind: null, id: null };
}

export default function OverflowMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can }  = useAuth();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  const ctx = readContext(location.pathname);

  /* close on outside click or Escape */
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey  = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* a route change should never leave the menu hanging open */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
    setOpen(false);
  }

  async function reload() {
    setBusy(true);
    await refreshFromSheet();
    setBusy(false);
    setOpen(false);
    window.location.reload();
  }

  async function remove() {
    const labels = {
      project : ['project', `/api/projects/${encodeURIComponent(ctx.id)}`, '/projects'],
      client  : ['client',  `/api/clients/${encodeURIComponent(ctx.id)}`,  '/clients'],
      ticket  : ['ticket',  `/api/tickets/${encodeURIComponent(ctx.id)}`,  null],
    };
    const entry = labels[ctx.kind];
    if (!entry) return;
    const [noun, url, back] = entry;

    const warning = noun === 'client'
      ? `Delete this client? Their projects will stay in the sheet but will no longer have a parent client.`
      : noun === 'project'
        ? `Delete this project? Its tickets and AMC contracts will be left without a parent project.`
        : `Delete this ticket? The remaining tickets on this project will be renumbered.`;

    if (!window.confirm(warning)) return;

    setBusy(true);
    try {
      await api.delete(url);
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} deleted`);
      setOpen(false);
      navigate(back || '/projects', { replace: true });
    } catch (e) {
      toast.error(e.message || `Could not delete the ${noun}`);
    } finally {
      setBusy(false);
    }
  }

  /* ── build the menu for wherever we are ─────────────────────────────── */
  const items = [];

  /*  Edit, Solar Care and Raise a ticket used to live here. They are now
      buttons on the project page's own sticky header, where they are one click
      away instead of two, so listing them again would just be a second door to
      the same room. What is left in this menu is the secondary and destructive
      work: copy a link, force a reload, delete.                             */
  if (ctx.kind === 'client') {
    items.push({ label: 'Edit client',       icon: '✏️', onClick: () => navigate(`/clients/${encodeURIComponent(ctx.id)}/edit`) });
    items.push({ label: 'Add project',       icon: '➕', onClick: () => navigate(`/clients/${encodeURIComponent(ctx.id)}/add-project`) });
    items.push({ label: 'Solar Care',        icon: '⚡', onClick: () => navigate(`/solar-care/clients/${encodeURIComponent(ctx.id)}`) });
  }

  items.push({ label: 'Copy link', icon: '🔗', onClick: copyLink });
  items.push({ label: busy ? 'Reloading…' : 'Reload from sheet', icon: '🔄', onClick: reload });

  const deletable = ['project', 'client', 'ticket'].includes(ctx.kind);
  if (deletable && can('delete')) {
    items.push({ label: `Delete ${ctx.kind}`, icon: '🗑', onClick: remove, danger: true });
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button className="topbar-btn" title="More options"
              aria-haspopup="menu" aria-expanded={open}
              onClick={() => setOpen(o => !o)}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round">
          <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
        </svg>
      </button>

      {open && (
        <div role="menu"
             style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, minWidth: 210,
                      background: 'var(--white)', borderRadius: 12,
                      border: '1px solid var(--slate-200)',
                      boxShadow: '0 12px 32px rgba(0,0,0,.18)', overflow: 'hidden', zIndex: 200 }}>
          {items.map((it, i) => (
            <button key={it.label} role="menuitem" onClick={it.onClick} disabled={busy}
              style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%',
                       padding: '11px 14px', background: 'none', border: 'none',
                       borderTop: i === 0 ? 'none' : '1px solid var(--slate-50)',
                       fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                       color: it.danger ? '#dc2626' : 'var(--text-head)',
                       cursor: busy ? 'not-allowed' : 'pointer', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--slate-50)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <span style={{ fontSize: 14, width: 18 }}>{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}