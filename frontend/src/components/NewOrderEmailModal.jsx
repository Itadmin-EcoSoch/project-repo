import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { C } from '../pages/formKit';

/*  Preview-then-send dialog for the New Order Form.

    Renders the exact email the backend will send (inside a sandboxed iframe, so
    the email's own Arial/table styling cannot leak into the app), then sends it.

    Props
      projectId   string | null   opens when this is set
      projectName string          shown in the header
      onClose     fn()
      onSent      fn(result)      optional, after a successful send
*/
export default function NewOrderEmailModal({
  projectId, projectName, onClose, onSent,
  mode = 'new',        // 'new' = New Order Form, 'update' = changed-fields reply
  changes = [],        // required when mode==='update'
  updatedBy = '',
}) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState(null);
  const [sent,    setSent]    = useState(null);
  const [force,   setForce]   = useState(false);
  const [attempt, setAttempt] = useState(0);   // bump to re-run the preview

  const open = Boolean(projectId);

  /* ── load the preview ── */
  useEffect(() => {
    if (!open) return;
    let dead = false;

    setLoading(true); setError(null); setSent(null); setForce(false); setPreview(null);

    const req = mode === 'update'
      ? api.post(`/api/new-order/${encodeURIComponent(projectId)}/update-preview`, { changes, updatedBy })
      : api.get(`/api/new-order/${encodeURIComponent(projectId)}/preview`);

    req
      .then(res => { if (!dead) setPreview(res?.data ?? res); })
      .catch(err => { if (!dead) setError(err.message || 'Could not build the email'); })
      .finally(() => { if (!dead) setLoading(false); });

    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, mode, attempt]);

  /* ── Escape closes ── */
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape' && !sending) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending, onClose]);

  const send = useCallback(async () => {
    setSending(true); setError(null);
    try {
      const url = mode === 'update'
        ? `/api/new-order/${encodeURIComponent(projectId)}/send-update`
        : `/api/new-order/${encodeURIComponent(projectId)}/send`;

      const res  = await api.post(url, mode === 'update' ? { changes, updatedBy } : { force });
      const data = res?.data ?? res;
      setSent(data);

      /*  data.sent is only true when the mail server actually accepted at
          least one recipient — a resolved request is not proof of delivery. */
      if (data.sent) {
        toast.success(`Sent to ${data.recipients.join(', ')}`);
        onSent?.(data);
      } else {
        toast.error(data.reason || 'The email was not sent — see the details below.');
      }
    } catch (err) {
      const msg = err.message || 'Send failed';
      if (/already been sent/i.test(msg)) { setForce(true); setError(`${msg} Press Send again to resend.`); }
      else setError(msg);
    } finally {
      setSending(false);
    }
  }, [projectId, force, onSent, mode, changes, updatedBy]);

  if (!open) return null;

  const box = {
    background:'#fff', borderRadius:16, width:'min(920px, 96vw)', maxHeight:'92vh',
    display:'flex', flexDirection:'column', overflow:'hidden',
    boxShadow:'0 24px 70px rgba(0,0,0,.35)',
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Send New Order Form"
      onClick={e => { if (e.target === e.currentTarget && !sending) onClose?.(); }}
      style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(15,23,42,.62)',
               display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
    >
      <div style={box}>

        {/* header */}
        <div style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:C.text1, display:'flex', alignItems:'center', gap:7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.primary} strokeWidth="2" strokeLinecap="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>
              </svg>
              {mode === 'update' ? 'Send project update' : 'Send New Order Form'}
            </div>
            <div style={{ fontSize:11, color:C.text3, marginTop:3, wordBreak:'break-word' }}>
              {preview
                ? <>To <b style={{ color:C.text2 }}>{preview.recipients?.join(', ')}</b>
                    {preview.cc?.length ? <> · Cc {preview.cc.join(', ')}</> : null}</>
                : projectName || 'Loading…'}
            </div>
          </div>
          <button onClick={onClose} disabled={sending} aria-label="Close"
            style={{ width:30, height:30, borderRadius:9, border:`1px solid ${C.border}`, background:'#fff',
                     color:C.text3, cursor: sending?'not-allowed':'pointer', fontSize:16, lineHeight:1, flexShrink:0 }}>
            ×
          </button>
        </div>

        {/* test-mode notice */}
        {preview?.test_mode && (
          <div style={{ padding:'10px 18px', background:'#fffbeb', borderBottom:'1px solid #fde68a',
                        fontSize:11.5, color:'#92400e', lineHeight:1.55 }}>
            <b>Test mode.</b> This goes only to <b>{preview.recipients?.join(', ')}</b> and the subject is
            prefixed <code style={{ background:'#fef3c7', padding:'1px 4px', borderRadius:3 }}>[TEST]</code>.
            Set <code style={{ background:'#fef3c7', padding:'1px 4px', borderRadius:3 }}>NEW_ORDER_TEST_MODE=false</code> in
            backend/.env to mail the real EcoSoch team list.
          </div>
        )}

        {/* subject */}
        {preview && (
          <div style={{ padding:'9px 18px', background:C.surface, borderBottom:`1px solid ${C.border}` }}>
            <div style={{ fontSize:9, fontWeight:700, color:C.text3, textTransform:'uppercase', letterSpacing:'.1em' }}>Subject</div>
            <div style={{ fontSize:12.5, fontWeight:700, color:C.text1, marginTop:2, wordBreak:'break-word' }}>
              {preview.test_mode ? `[TEST] ${preview.subject}` : preview.subject}
            </div>
          </div>
        )}

        {/* update-mode context */}
        {mode === 'update' && preview && (
          <div style={{ padding:'8px 18px', borderBottom:`1px solid ${C.border}`,
                        fontSize:11.5, color:C.text2, background:'#fff' }}>
            <b>{preview.changes?.length || 0}</b> changed field
            {(preview.changes?.length || 0) === 1 ? '' : 's'}
            {preview.threaded
              ? <> · replies into the original New Order email thread</>
              : <span style={{ color:C.warning }}> · the New Order Form was never sent from EcoFlow for this project, so this will start a new thread</span>}
          </div>
        )}

        {/* body */}
        <div style={{ flex:1, overflow:'auto', background:'#f8fafc', minHeight:220 }}>
          {loading && (
            <div style={{ padding:'56px 18px', textAlign:'center', color:C.text3, fontSize:13 }}>
              Building the form from the sheet…
            </div>
          )}

          {!loading && error && !preview && (
            <div style={{ margin:18, padding:'14px 16px', background:'#fef2f2', border:'1px solid #fecaca',
                          borderRadius:10, color:'#991b1b', fontSize:12.5, lineHeight:1.6 }}>
              <div style={{ fontWeight:700, marginBottom:4 }}>Could not build the email</div>
              <div style={{ marginBottom:2 }}>{error}</div>
              {/timeout/i.test(error) && (
                <div style={{ marginTop:6, color:'#7f1d1d' }}>
                  The Google Sheet took too long to answer. Nothing was sent and the
                  project is safely saved — press Retry.
                </div>
              )}
              <button
                onClick={()=>setAttempt(a=>a+1)}
                style={{ marginTop:10, height:34, padding:'0 16px', borderRadius:9, border:'none',
                         background:C.primary, color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                ↻ Retry
              </button>
            </div>
          )}

          {!loading && preview && (
            <iframe
              title="New Order Form preview"
              srcDoc={preview.html}
              sandbox=""
              style={{ width:'100%', height:'46vh', border:0, background:'#fff', display:'block' }}
            />
          )}
        </div>

        {/* footer */}
        <div style={{ padding:'11px 18px', borderTop:`1px solid ${C.border}`, display:'flex',
                      alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:180, fontSize:11.5, lineHeight:1.5 }}>
            {sent ? (
              <div>
                <span style={{ color: sent.sent ? C.success : C.danger, fontWeight:700 }}>
                  {sent.sent ? `Sent to ${sent.accepted?.join(', ') || sent.recipients.join(', ')}` : 'Not sent'}
                </span>
                {/* Delivery detail straight from the mail server, so a silent
                    non-delivery is visible instead of looking like success. */}
                {!sent.sent && (
                  <div style={{ color:C.danger, marginTop:3 }}>
                    {sent.reason || 'The mail server accepted no recipients.'}
                    {sent.rejected?.length ? <> Rejected: {sent.rejected.join(', ')}.</> : null}
                  </div>
                )}
                {sent.smtp_response && (
                  <div style={{ color:C.text3, marginTop:3, fontFamily:'monospace', fontSize:10.5 }}>
                    {sent.smtp_response}
                  </div>
                )}
              </div>
            ) : error ? (
              <span style={{ color:C.warning }}>{error}</span>
            ) : preview?.already_sent_at ? (
              <span style={{ color:C.warning }}>
                Already sent {new Date(preview.already_sent_at).toLocaleString('en-IN')}
              </span>
            ) : (
              <span style={{ color:C.text3 }}>Check the details, then send.</span>
            )}
          </div>

          <button onClick={onClose} disabled={sending}
            style={{ height:42, padding:'0 18px', borderRadius:11, border:`1.5px solid ${C.border}`,
                     background:'#fff', fontSize:12.5, fontWeight:700, color:C.text2,
                     cursor: sending?'not-allowed':'pointer' }}>
            {sent ? 'Close' : 'Cancel'}
          </button>

          {!sent && (
            <button onClick={send} disabled={sending || loading || !preview}
              style={{ height:42, padding:'0 20px', borderRadius:11, border:'none',
                       background: (sending||loading||!preview) ? '#94a3b8' : `linear-gradient(135deg,${C.success},#10b981)`,
                       fontSize:12.5, fontWeight:700, color:'#fff',
                       cursor: (sending||loading||!preview)?'not-allowed':'pointer',
                       display:'flex', alignItems:'center', gap:7 }}>
              {sending ? 'Sending…' : force ? 'Send again' : mode === 'update' ? '✉ Send update' : '✉ Send to team'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}