import { statusClass, statusLabel, isDefaulted } from '../lib/status';

export function ItemActions({ onEdit, onAssign, onCancel, showCancel=true }) {
  return (
    <div className="item-actions">
      <button onClick={e=>{e.stopPropagation();onEdit?.(e);}} title="Edit">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      {onAssign && (
        <button onClick={e=>{e.stopPropagation();onAssign?.(e);}} title="Assign">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
      )}
      {showCancel && (
        <button onClick={e=>{e.stopPropagation();onCancel?.(e);}} title="Cancel" style={{color:'var(--rose)!important'}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  );
}

export function FAB({ onClick }) {
  return (
    <button className="fab" onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>
  );
}

export function StatusBadge({ status, pct }) {
  /*  Was an exact-match lookup, so any legacy value ("Defaulted - Project
      Payment", "Out of SolarCare", "Completed") silently fell through to the
      green Active badge. canonicalStatus() handles every spelling.          */
  const label = statusLabel(status);
  return (
    <span className={`item-status ${statusClass(status)}`}>
      {label}{isDefaulted(status) && pct ? ` (${pct}% paid)` : ''}
    </span>
  );
}