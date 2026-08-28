/*  frontend/src/hooks/useAuth.jsx  — REPLACES THE EXISTING FILE
    ----------------------------------------------------------------------------
    Session state for the whole app, plus the permission helpers every screen
    uses to decide what to show.

    WHAT CHANGED
      · can('delete'), canPage('users'), isAdmin and isManager are now available
        anywhere via useAuth(), so a screen never has to know role names.
      · Permissions come from the server (user.permissions) and fall back to the
        local table if an old token is still in localStorage.
      · A 403 from the API no longer looks like a network error — see lib/api.js.

    Remember: this only controls what is SHOWN. The API enforces the same rules
    server-side, so hiding a button is not what makes the app secure.
--------------------------------------------------------------------------- */

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import api, { setAuthToken } from '../lib/api';
import { describe, tierOf, TIER } from '../lib/permissions';

const TOKEN_KEY = 'ecosoch-token';
const USER_KEY  = 'ecosoch-user';
const AuthCtx   = createContext(null);

function readStored() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user  = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return token && user ? { token, user } : { token: null, user: null };
  } catch { return { token: null, user: null }; }
}

export function AuthProvider({ children }) {
  const [{ token, user }, setSession] = useState(readStored);
  const [checking, setChecking] = useState(true);
  const [config,   setConfig]   = useState(null);

  useEffect(() => { setAuthToken(token); }, [token]);

  /* what the login page needs, and whether auth is even switched on */
  useEffect(() => {
    let alive = true;
    api.get('/api/auth/config')
      .then(r => alive && setConfig(r))
      .catch(() => alive && setConfig({ configured: false, enforced: false, domain: 'ecosoch.com' }));
    return () => { alive = false; };
  }, []);

  /* revalidate a stored token on boot — this is also how a role change picked
     up in the sheet reaches someone who is already signed in */
  useEffect(() => {
    let alive = true;
    if (!token) { setChecking(false); return; }
    api.get('/api/auth/me')
      .then(r => { if (alive && r?.user) persist(token, r.user); })
      .catch(() => { if (alive) clear(); })
      .finally(() => alive && setChecking(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persist(t, u) {
    try {
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {}
    setAuthToken(t);
    setSession({ token: t, user: u });
  }

  function clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
    setAuthToken(null);
    setSession({ token: null, user: null });
  }

  const signInWithGoogle = useCallback(async (credential) => {
    const r = await api.post('/api/auth/google', { credential });
    if (!r?.token) throw new Error(r?.error || 'Sign in failed');
    persist(r.token, r.user);
    return r.user;
  }, []);

  const signOut = useCallback(() => {
    api.post('/api/auth/logout').catch(() => {});
    clear();
    try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch {}
  }, []);

  /* ── permissions ───────────────────────────────────────────────────────
     Prefer what the server said. Fall back to the local table for a token
     issued before permissions were added, so nobody is locked out by an old
     localStorage entry.                                                    */
  const permissions = useMemo(() => {
    if (user?.permissions) return user.permissions;
    if (user?.role)        return describe(user.role);
    return null;
  }, [user]);

    /*  With auth switched off there is no user, so everything is allowed —
      otherwise local development would show an app with every button hidden.

      `configured` is whether GOOGLE_CLIENT_ID is set, i.e. whether the login
      page can RENDER. Whether the rules are enforced is `enforced`. And until
      config arrives we assume auth IS on, so nothing flashes open — RequireAuth
      is showing its Loading… screen during that window anyway.            */
  const authOn = config
    ? Boolean(config.enforced ?? config.configured)
    : true;

  const value = useMemo(() => ({
    user, token, checking, config,
    isAuthed: Boolean(user),
    authRequired: authOn,

    role : user?.role || null,
    tier : permissions?.tier ?? TIER.ADMIN,
    permissions,

    /** can('delete') — may the signed-in person do this? */
    can: (capability) => {
      if (!authOn) return true;
      if (!permissions) return false;
      return Boolean(permissions.capabilities?.[capability]);
    },

    /** canPage('users') — may they open this screen? */
    canPage: (page) => {
      if (!authOn) return true;
      if (!permissions) return false;
      const p = permissions.pages?.[String(page).toLowerCase()];
      return p === undefined ? true : Boolean(p);
    },

    isAdmin  : !authOn || Boolean(permissions?.is_admin),
    isManager: !authOn || Boolean(permissions?.is_manager),

    signInWithGoogle, signOut,
  }), [user, token, checking, config, permissions, authOn, signInWithGoogle, signOut]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Convenience for the common case: const canDelete = useCan('delete') */
export function useCan(capability) {
  return useAuth().can(capability);
}

export { tierOf, TIER };