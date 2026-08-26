/*  frontend/src/hooks/useTheme.jsx
    ----------------------------------------------------------------------------
    Dark / Light / System theme, persisted in localStorage.

    Sets  <html data-theme="dark">  which globals.css keys off, so every colour
    in the app switches from one place. No component needs to know the theme
    except the toggle button and the map (which swaps its tile layer).
--------------------------------------------------------------------------- */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const KEY = 'ecosoch-theme';           // 'light' | 'dark' | 'system'
const ThemeCtx = createContext(null);

function systemPrefersDark() {
  return typeof window !== 'undefined' &&
         window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function resolve(mode) {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
  });

  const resolved = resolve(mode);

  // paint the theme onto <html> so CSS variables flip everywhere at once
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', resolved);
    el.style.colorScheme = resolved;                     // native scrollbars, inputs
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0A1628' : '#0F1F35');
    try { localStorage.setItem(KEY, mode); } catch {}
  }, [mode, resolved]);

  // follow the OS while the user is on "system"
  useEffect(() => {
    if (mode !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setMode(m => (m === 'system' ? 'system' : m));
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode(m => (resolve(m) === 'dark' ? 'light' : 'dark'));
  }, []);

  const cycle = useCallback(() => {
    setMode(m => (m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light'));
  }, []);

  return (
    <ThemeCtx.Provider value={{ mode, setMode, resolved, isDark: resolved === 'dark', toggle, cycle }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** Sun / moon / auto icon button for the topbar. */
export function ThemeToggle({ className = 'topbar-btn' }) {
  const { mode, resolved, cycle } = useTheme();
  const title = mode === 'system'
    ? `Theme: follow system (${resolved})`
    : `Theme: ${mode}`;

  return (
    <button className={className} onClick={cycle} title={title} aria-label={title}>
      {mode === 'system' ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg>
      ) : resolved === 'dark' ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2"/>
          <line x1="12" y1="1.5" x2="12" y2="3.6"/><line x1="12" y1="20.4" x2="12" y2="22.5"/>
          <line x1="4.2" y1="4.2" x2="5.7" y2="5.7"/><line x1="18.3" y1="18.3" x2="19.8" y2="19.8"/>
          <line x1="1.5" y1="12" x2="3.6" y2="12"/><line x1="20.4" y1="12" x2="22.5" y2="12"/>
          <line x1="4.2" y1="19.8" x2="5.7" y2="18.3"/><line x1="18.3" y1="5.7" x2="19.8" y2="4.2"/>
        </svg>
      )}
    </button>
  );
}