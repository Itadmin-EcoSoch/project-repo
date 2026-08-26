/*  frontend/src/pages/FileField.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    A real attachment control: pick a file from the folder, or drag one in.

    It uploads immediately, then stores the path Apps Script returns in the form
    state — so the value written to the sheet is the same kind of path AppSheet
    wrote, and the New Order email keeps hyperlinking it.

    If Drive upload is not configured yet, it degrades to the old paste-a-link
    box rather than showing a picker that cannot work.
--------------------------------------------------------------------------- */

import { useRef, useState, useEffect } from 'react';
import api from '../lib/api';
import { C, SInput } from './formKit';

/*  WHY THIS IS A MEMOISED PROMISE, NOT A MEMOISED VALUE
    The first version cached the boolean. Every FileField on the page called
    checkUpload() at mount, all of them saw `null` at the same moment, and all
    of them fired their own request — a race. If any one of those requests hiccups
    the others still succeed, and each component keeps whichever answer its own
    request returned. That is why the Purchase Order field showed a file picker
    while the Electricity Bill field, on the same page, showed a link box.

    Caching the promise means one request, one answer, shared by every field. */
let readyPromise = null;
function checkUpload() {
  if (!readyPromise) {
    readyPromise = api.get('/api/uploads/status')
      .then(r => Boolean((r?.data ?? r)?.enabled))
      /*  A failed status check is not proof that upload is broken — it might be
          a blip. Assume the picker works and find out for real on first use,
          which is far better than silently downgrading every field.        */
      .catch(() => true);
  }
  return readyPromise;
}

/** Flipped only when an upload actually comes back "not configured". */
let uploadDisabled = false;

const readAsBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload  = () => resolve(String(r.result).split(',').pop());
  r.onerror = () => reject(new Error('Could not read that file'));
  r.readAsDataURL(file);
});

const prettySize = b =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export default function FileField({ value, onChange, column, projectId, hasError, maxSizeMB,
                                    displayName, onNameChange }) {
  const ref = useRef(null);
  const [ready,   setReady]   = useState(!uploadDisabled);
  const [busy,    setBusy]    = useState(false);
  const [pct,     setPct]     = useState(0);
  const [url,     setUrl]     = useState('');
  const [drag,    setDrag]    = useState(false);
  const [error,   setError]   = useState(null);
  const [display, setDisplay] = useState('');

  /*  Default stays 20 MB, matching what the field has always said. A field
      that passes maxSizeMB (Other Files -> 2) gets a tighter cap without
      touching every other FileField on the form.                          */
  const limitMB    = Number(maxSizeMB) > 0 ? Number(maxSizeMB) : 20;
  const limitBytes = limitMB * 1024 * 1024;

  useEffect(() => { checkUpload().then(ok => setReady(ok && !uploadDisabled)); }, []);

  async function handleFile(file) {
    if (!file) return;
    setError(null);

    /*  Rejected before it ever reaches the network — no point spending an
        upload round-trip on a file we already know is too big.            */
    if (file.size > limitBytes) {
      setError(`That file is ${prettySize(file.size)}. Maximum allowed here is ${limitMB} MB.`);
      if (ref.current) ref.current.value = '';
      return;
    }

    setBusy(true);
    setPct(0);
    setUrl('');            // drop the old file's link before fetching a new one
    try {
      const data = await readAsBase64(file);

      /*  ── WHY THIS CALL GETS ITS OWN TIMEOUT ────────────────────────────
          api.js sets a 45s default, sized for a cold Projects read. An upload
          is a different shape of request entirely:

            · base64 inflates the file by about a third, so a 6 MB PO is 8 MB
              of JSON leaving the browser
            · that goes to Node, then on to Apps Script as another 8 MB POST
            · Apps Script decodes it, writes it to Drive, and calls setSharing
              — three Drive round trips, each of which can take seconds

          None of that is stuck; it is simply slower than 45 seconds on an
          ordinary office connection. Cutting it off at 45s threw away work
          that was about to succeed and made a working feature look broken.

          Four minutes is generous enough for a 20 MB file at the limit, and
          still short enough that a genuinely dead request eventually reports
          rather than hanging forever.                                     */
      const r = await api.post('/api/uploads', {
        filename: file.name, mimeType: file.type, data,
        column, project_id: projectId || '',
      }, {
        timeout: 4 * 60 * 1000,
        /*  Progress is measured on the BROWSER -> NODE hop only. Node then
            has to forward the file to Apps Script and wait for Drive, so the
            bar reaching 100% means "sent", not "finished" — which is why it
            switches to a finishing message rather than disappearing.     */
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          setPct(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
        },
      });
      const out = r?.data ?? r;
      onChange(out.path);
      /*  The upload response carries the Drive url. Keeping it makes the
          filename clickable straight away, without a round trip to resolve
          the path we literally just created.                              */
      if (out.url) setUrl(out.url);
      setDisplay(`${out.name} · ${prettySize(file.size)}`);
      /*  This is the ONE moment the real filename is known. setDisplay above
          only lasts for this browser tab's lifetime — reload the page, or
          come back tomorrow to edit this project, and that state is gone.
          onNameChange saves the real name into form state so it reaches the
          save payload and round-trips back on the next load; without it,
          every file falls back to showing its internal Drive-safe name
          (e.g. "346acf81.Quote_Sheet.1783711.xlsx") the moment this session
          ends, which is exactly the behaviour this prop fixes.            */
      onNameChange?.(out.name);
    } catch (e) {
      /*  The one case that genuinely means "no upload here": Apps Script has
          not been given the uploadFile handler yet. Fall back to the link box
          for every field, not just this one.                                */
      if (/not set up|UPLOAD_NOT_CONFIGURED|not configured/i.test(e.message || '')) {
        uploadDisabled = true;
        setReady(false);
        setError(null);
      } else {
        setError(/timeout/i.test(e.message || '')
          ? 'The upload ran out of time. Large files over a slow connection can ' +
            'take a few minutes — try again, or compress the file first.'
          : (e.message || 'Upload failed'));
      }
    } finally {
      setBusy(false);
      setPct(0);
      if (ref.current) ref.current.value = '';
    }
  }

  /*  Upload is not wired up — fall back to the link box rather than showing a
      picker that would fail on every attempt.                               */
  if (ready === false) {
    return (
      <>
        <SInput value={value} onChange={e => onChange(e.target.value)}
                placeholder="Paste a Drive link or the file name" hasError={hasError} />
        <div style={{ fontSize: 10, color: C.text3, marginTop: 5 }}>
          Direct upload is not set up yet — paste a link for now.
        </div>
      </>
    );
  }

  const filled = Boolean(value);

  return (
    <>
      <div
        onClick={() => !busy && ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault(); setDrag(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        style={{
          border: `2px dashed ${hasError ? C.danger : drag ? C.accent : filled ? C.success : C.border}`,
          borderRadius: 10, padding: '12px 14px', cursor: busy ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 12,
          background: drag ? `${C.accent}0d` : filled ? '#f0fdf4' : '#fafbfc',
          transition: 'all .15s',
        }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: filled ? '#dcfce7' : C.surface, fontSize: 15 }}>
          {busy ? '⏳' : filled ? '✓' : '📎'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600,
                        color: filled ? '#15803d' : C.text2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {busy    ? (pct >= 99
                          /*  100% means the bytes have left the browser. Node
                              still has to hand them to Apps Script and wait
                              for Drive, which is the slow part — saying
                              "Uploading 100%" for two more minutes reads as
                              frozen, so the label says what is actually
                              happening instead.                           */
                          ? 'Saving to Drive…'
                          : `Uploading… ${pct}%`)
             /*  Order matters: `display` is this session's just-uploaded name
                 (freshest, includes file size); `displayName` is what was
                 actually saved and read back from the sheet on a reopened
                 project; the derived-from-path fallback is the last resort
                 for older rows saved before this existed, or a project still
                 mid-edit that hasn't been saved since attaching the file.  */
             : filled
               /*  Clickable the moment there is somewhere to go. target=_blank
                   so opening the PO does not navigate away from a half-filled
                   form — losing sixty fields to check one attachment is the
                   kind of thing people only forgive once.

                   stopPropagation matters: the whole tile is a click target
                   that opens the file picker, so without it, clicking the
                   link would ALSO pop the "choose a file" dialog over the
                   tab that just opened.                                   */
               ? (url
                   ? <a href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: '#15803d', textDecoration: 'underline' }}
                        title="Open this file in a new tab">
                       {display || displayName || String(value).split('/').pop()}
                     </a>
                   : (display || displayName || String(value).split('/').pop()))
             : 'Choose a file or drag it here'}
          </div>
          <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>
            {busy
              ? 'Large files can take a couple of minutes — leave this page open.'
              : `PDF, images, Excel, Word · up to ${limitMB} MB`}
          </div>
        </div>

        {filled && !busy && (
          <button type="button"
            /*  setUrl('') matters. Without it the previous file's Drive link
                survives the clear, and if the NEXT upload does not return a
                url — an older Apps Script deployment, or a partial response —
                the field would render the new filename pointing at the OLD
                file. A link to the wrong document is worse than no link.  */
            onClick={e => { e.stopPropagation(); onChange(''); setDisplay('');
                            setUrl(''); onNameChange?.(''); setError(null); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
                     color: C.text3, fontSize: 20, lineHeight: 1, padding: '0 4px' }}
            title="Remove">
            ×
          </button>
        )}
      </div>

      <input ref={ref} type="file" style={{ display: 'none' }}
             accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.txt"
             onChange={e => handleFile(e.target.files?.[0])} />

      {error && <div style={{ fontSize: 11, color: C.danger, marginTop: 5 }}>{error}</div>}
    </>
  );
}