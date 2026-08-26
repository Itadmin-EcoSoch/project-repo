/*  backend/routes/uploads.js  — NEW FILE
    ----------------------------------------------------------------------------
    Real file attachment for the project form.

    Until now the five file columns held whatever text somebody pasted. This
    accepts an actual file from the browser, hands it to Apps Script, which
    writes it into the project's Drive folder and returns the stored path — the
    same shape AppSheet used, so the New Order email keeps hyperlinking it.

        browser  ──base64──▶  POST /api/uploads  ──▶  Apps Script  ──▶  Drive
                                                  ◀── { path, url, name }

    You must add the matching `uploadFile` case to your Apps Script project —
    the snippet is in the guide. Until you do, this route returns a clear 501
    and the form falls back to accepting a pasted link, so nothing breaks.

    Endpoints
        POST /api/uploads            { filename, mimeType, data, column, project_id }
        GET  /api/uploads/status     is Drive upload wired up?
--------------------------------------------------------------------------- */

const express = require('express');
const router  = express.Router();

const db = require('../db/sheets');

/*  Files arrive base64-encoded inside JSON, which inflates them by about a
    third. The global express.json() limit is far too small for a 5 MB PO, so
    this router gets its own.                                                */
const MAX_MB = Number(process.env.UPLOAD_MAX_MB || 20);
router.use(express.json({ limit: `${Math.ceil(MAX_MB * 1.4)}mb` }));

/** Extensions we are willing to put in Drive. */
const ALLOWED = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'gif',
  'xls', 'xlsx', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'txt',
]);

const extOf = name => String(name || '').split('.').pop().toLowerCase();

/** Strip anything that would break a Drive filename or a sheet cell. */
function safeName(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/* ── GET /api/uploads/status ─────────────────────────────────────────── */
router.get('/status', async (_req, res) => {
  if (!db.hasCredentials) {
    return res.json({ success: true, data: { enabled: false,
      reason: 'SHEETS_API_URL / SHEETS_API_TOKEN are not set in backend/.env' } });
  }
  try {
    const out = await db.call({ action: 'uploadStatus' });
    res.json({ success: true, data: { enabled: true, ...(out.data || {}) } });
  } catch (e) {
    res.json({ success: true, data: { enabled: false, reason: e.message } });
  }
});

/* ── POST /api/uploads ───────────────────────────────────────────────── */
router.post('/', async (req, res, next) => {
  try {
    const { filename, mimeType, data, column = '', project_id = '' } = req.body || {};

    if (!filename || !data) {
      return res.status(400).json({ success: false, error: 'filename and data are required' });
    }

    const ext = extOf(filename);
    if (!ALLOWED.has(ext)) {
      return res.status(400).json({
        success: false,
        error: `.${ext} files are not accepted. Allowed: ${[...ALLOWED].join(', ')}`,
      });
    }

    /* base64 is ~4/3 the size of the bytes it encodes */
    const approxBytes = Math.ceil((String(data).length * 3) / 4);
    if (approxBytes > MAX_MB * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        error: `That file is about ${(approxBytes / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_MB} MB.`,
      });
    }

    const out = await db.call({
      action   : 'uploadFile',
      filename : safeName(filename),
      mimeType : mimeType || 'application/octet-stream',
      data     : String(data).includes(',') ? String(data).split(',').pop() : data,
      column,                       // e.g. PO_File — decides the Drive subfolder
      project_id,
    });

    const file = out.data || out.file || {};
    if (!file.path && !file.url) {
      throw new Error('Apps Script did not return a path for the uploaded file.');
    }

    /*  Logged BEFORE responding. After res.json() the handler can still be
        cut short by a client disconnect, and the one line that tells you
        which Drive id a file landed on is the line you want most when an
        upload later fails to resolve.                                     */
    console.log(`[upload] ${safeName(filename)} -> ${file.path} (drive id ${file.id || 'unknown'})`);

    res.status(201).json({
      success: true,
      data: {
        path: file.path || file.url,
        url : file.url  || null,
        /*  The Drive file id. Apps Script has always returned it and this
            route has always dropped it, which is why every email since has
            paid for a five-strategy filename search to recover an id we were
            handed for free. Passed through now so the frontend can keep it.  */
        id  : file.id   || null,
        name: file.name || safeName(filename),
        size: approxBytes,
      },
    });
  } catch (err) {
    /*  The most likely failure by far is that the Apps Script side has not been
        updated yet. Say so plainly instead of surfacing "Sheets API error",
        which sends people looking in the wrong place.                        */
    if (/unknown action|uploadFile|not supported/i.test(err.message || '')) {
      return res.status(501).json({
        success: false,
        code   : 'UPLOAD_NOT_CONFIGURED',
        error  : 'Drive upload is not set up yet. Add the uploadFile handler to your ' +
                 'Apps Script project (see the guide), then redeploy the Web App.',
      });
    }
    next(err);
  }
});

/*  Express rejects an oversized body before the route runs, and its default
    message is "request entity too large" with a 500. Translate it into
    something a salesperson can act on.                                      */
router.use((err, _req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      success: false,
      error: `That file is too large. The limit is ${MAX_MB} MB — try compressing the PDF or photo.`,
    });
  }
  next(err);
});

module.exports = router;