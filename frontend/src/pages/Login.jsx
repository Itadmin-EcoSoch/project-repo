/*  frontend/src/pages/Login.jsx
    ----------------------------------------------------------------------------
    Google Sign-In, restricted to the company domain.

    The button comes from Google Identity Services, loaded from the CDN. The
    credential it hands back is verified server-side in routes/auth.js — nothing
    here is trusted.
--------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) { existing.addEventListener('load', resolve); return; }
    const s = document.createElement('script');
    s.src = GSI_SRC; s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not reach accounts.google.com'));
    document.head.appendChild(s);
  });
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signInWithGoogle, config, isAuthed } = useAuth();
  const { isDark } = useTheme();

  const btnRef = useRef(null);
  const [err,  setErr]  = useState('');
  const [busy, setBusy] = useState(false);

  const from = location.state?.from || '/dashboard';

  useEffect(() => { if (isAuthed) navigate(from, { replace: true }); }, [isAuthed, from, navigate]);

    /*  ── WHY THIS TRIES BEFORE IT ASKS ──────────────────────────────────
      Every EcoSoch app is behind the same Google Workspace, and the person
      arriving here has just signed in at one.ecosoch.com. The browser is
      already holding a valid Google session — this page simply refused to
      use it, because auto_select was false, which means "always make them
      click" even when there is exactly one obvious answer.

      Now: initialise with auto_select, ask Google to resolve it silently,
      and only fall back to the button if it cannot. That is why Site Visit
      Report opens straight into the app from the one.ecosoch.com tile and
      this one did not.

      THE BUTTON IS STILL RENDERED, always, just hidden until needed. GIS
      will not sign somebody in silently when there are two Google accounts
      in the browser, when third-party cookies are blocked, or the first
      time a person uses THIS app — see the note on the client id below.
      In every one of those cases the click has to exist.                */
  const [tryingSilent, setTryingSilent] = useState(true);

  /*  Held in a ref so the effect is not re-run each time useAuth re-renders
      and hands back a new function identity — re-initialising GIS mid-prompt
      cancels the prompt.                                                 */
  const signInRef = useRef(signInWithGoogle);
  useEffect(() => { signInRef.current = signInWithGoogle; }, [signInWithGoogle]);

  useEffect(() => {
    if (!config?.google_client_id || !btnRef.current) return;
    let cancelled = false;
    let reveal;

    loadGsi()
      .then(() => {
        if (cancelled || !btnRef.current) return;

        window.google.accounts.id.initialize({
          client_id: config.google_client_id,
          callback: async ({ credential }) => {
            if (cancelled) return;
            clearTimeout(reveal);
            setBusy(true); setErr('');
            try {
              await signInRef.current(credential);
              navigate(from, { replace: true });
            } catch (e) {
              setErr(e.message || 'Sign in failed');
              setTryingSilent(false);      // let them try by hand
            } finally { setBusy(false); }
          },
          hd: config.domain,
          auto_select: true,               // ← the whole fix
          itp_support: true,               // Safari / iOS
          use_fedcm_for_prompt: true,      // required by current Chrome
          cancel_on_tap_outside: false,
        });

        /* Render it now so it is ready the instant we decide to show it. */
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: isDark ? 'filled_black' : 'outline',
          size: 'large', shape: 'pill', text: 'signin_with',
          logo_alignment: 'left', width: 280,
        });

        /*  Ask Google to resolve the session with no UI.

            Deliberately NOT branching on the notification callbacks
            (isNotDisplayed / isSkippedMoment). Under FedCM — on by default
            in current Chrome — those are deprecated and throw. A plain timer
            behaves the same in every browser: if the callback above has not
            fired by now, show the button.                                */
        window.google.accounts.id.prompt();

        reveal = setTimeout(() => { if (!cancelled) setTryingSilent(false); }, 2500);
      })
      .catch(e => { setErr(e.message); setTryingSilent(false); });

    return () => { cancelled = true; clearTimeout(reveal); };
  }, [config, isDark, navigate, from]);

  const notConfigured = config && !config.configured;

  return (
    <div style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'var(--slate-100)', padding:20,
    }}>
      <div style={{
        width:'100%', maxWidth:400, background:'var(--white)', borderRadius:'var(--radius-xl)',
        boxShadow:'var(--shadow-lg)', padding:'36px 30px', textAlign:'center',
        border:'1px solid var(--slate-200)',
      }}>
        {/* logo */}
        <div style={{
          width:56, height:56, borderRadius:18, background:'var(--brand)',
          display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        </div>

        <h1 style={{fontSize:22, fontWeight:800, color:'var(--text-head)', marginBottom:6,
                    fontFamily:"'Space Grotesk', Inter, sans-serif"}}>
          EcoSoch
        </h1>
        <p style={{fontSize:13, color:'var(--text-muted)', marginBottom:26, lineHeight:1.5}}>
          Project Repository<br/>
          <span style={{fontSize:12}}>
            Sign in with your <strong>@{config?.domain || 'ecosoch.com'}</strong> account
          </span>
        </p>

        {notConfigured ? (
          <div style={{
            background:'var(--amber-l)', color:'var(--amber)', borderRadius:12,
            padding:'14px 16px', fontSize:12, textAlign:'left', lineHeight:1.6,
          }}>
            <strong>Google sign-in isn't set up yet.</strong><br/>
            Add <code>GOOGLE_CLIENT_ID</code> to <code>backend/.env</code> and restart
            the API. See <code>LOGIN_SETUP.md</code> for the five-minute walkthrough.
          </div>
        ) : (
          <>
                       {/*  Kept mounted, not conditionally rendered — GIS writes into this
                 node once and cannot re-render into a node that was unmounted
                 while it was thinking.                                      */}
            <div ref={btnRef}
                 style={{ display: tryingSilent && !err ? 'none' : 'flex',
                          justifyContent:'center', minHeight:44 }} />

            {tryingSilent && !err && (
              <div style={{marginTop:4, fontSize:12.5, color:'var(--text-muted)', fontWeight:600}}>
                Signing you in…
              </div>
            )}

            {busy && (
              <div style={{marginTop:14, fontSize:12, color:'var(--text-muted)', fontWeight:600}}>
                Checking your account…
              </div>
            )}
          </>
        )}

        {err && (
          <div style={{
            marginTop:16, background:'var(--rose-l)', color:'var(--rose)',
            borderRadius:10, padding:'11px 13px', fontSize:12, textAlign:'left', lineHeight:1.5,
          }}>
            {err}
          </div>
        )}

        <div style={{marginTop:26, paddingTop:16, borderTop:'1px solid var(--slate-200)',
                     fontSize:11, color:'var(--text-muted)'}}>
          Company accounts only. Personal Gmail addresses are rejected.
        </div>
      </div>
    </div>
  );
}