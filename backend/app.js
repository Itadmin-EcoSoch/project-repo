require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const compression = require('compression');
const morgan  = require('morgan');

const clientsRouter  = require('./routes/clients');
const projectsRouter = require('./routes/projects');
const ordersRouter   = require('./routes/orders');
const newOrderRouter = require('./routes/newOrder');
const amcScheduleRouter = require('./routes/amcSchedule');
const amcRouter      = require('./routes/amc');

/* ── Solar Care: Client → Project → { Tickets, AMC } → Visits ── */
const uploadsRouter   = require('./routes/uploads');
const ticketsRouter   = require('./routes/tickets');
const solarcareRouter = require('./routes/solarcare');
const amcSetupRouter  = require('./routes/amcSetup');
const usersRouter    = require('./routes/users');
const launcherRouter = require('./routes/launcher');
const dropdownOptionsRouter = require('./routes/dropdownOptions');
const syncRouter     = require('./routes/sync');
const authRouter     = require('./routes/auth');
const errorHandler   = require('./middleware/errorHandler');
const { attachUser, requireAuth, enforcePermissions, REQUIRE_AUTH } = require('./middleware/auth');

const db   = require('./db/sheets');
const app  = express();
const PORT = process.env.PORT || 4000;

app.use(compression());                       // gzip — big win on list payloads
/*  CORS — allow the configured frontend(s), plus any *.ecosoch.com and any
    *.vercel.app (preview + production deploys), and non-browser callers.
    The app authenticates with Bearer tokens, not cookies.                  */
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                     // curl / server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    try {
      const h = new URL(origin).hostname;
      if (h === 'localhost' || h.endsWith('.ecosoch.com') || h.endsWith('.vercel.app')) {
        return cb(null, true);
      }
    } catch { /* malformed origin */ }
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));
app.use(attachUser);          // decodes the session token when one is sent

app.get('/health', (_, res) =>
  res.json({ status: 'ok', service: 'EcoSoch API', db: 'Google Sheets' }));

/* Google Sheets connectivity + tab check — open http://localhost:4000/health/db */
app.get('/health/db', async (_, res) => {
  if (!db.hasCredentials) {
    return res.status(500).json({
      ok: false,
      error: 'Missing credentials',
      hint : 'Set SHEETS_API_URL and SHEETS_API_TOKEN in backend/.env ' +
             '(Apps Script → Deploy → Manage deployments → Web app URL).',
    });
  }

  try {
    await db.ping();
    const schema = await db.schema();
    const tables = {};
    let ok = true;
    for (const [name, info] of Object.entries(schema)) {
      if (info.error) { ok = false; tables[name] = { ok: false, error: info.error }; }
      else            { tables[name] = { ok: true, sheet: info.sheet, rows: info.rows,
                                         columns: info.columns.length }; }
    }
    res.status(ok ? 200 : 500).json({
      ok, api_url: db.API_URL, tables,
      hint: ok ? undefined
               : 'Check each tab name matches the TABLES map in Code.gs, then re-deploy the Web app.',
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
      hint : 'Most common causes: the deployment is not set to "Anyone" access, ' +
             'the token does not match, or you pasted the /dev URL instead of /exec.',
    });
  }
});

app.use('/api/auth',     authRouter);

/*  Everything below needs a signed-in user once REQUIRE_AUTH=true.
    While it is false this is a no-op, so you can deploy the login screen
    first and switch enforcement on once everyone has signed in at least once. */
app.use('/api', requireAuth);

/*  WHO CAN DO WHAT — one gate for the whole API, so no route file has to be
    edited. Everyone given access can read, create and update; only Admin and
    Super Admin can delete or manage team members and the launcher.
    See backend/lib/permissions.js. Inert while REQUIRE_AUTH=false.        */
app.use('/api', enforcePermissions);

app.use('/api/clients',  clientsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/orders',   ordersRouter);
app.use('/api/new-order', newOrderRouter);   // New Order Form email
app.use('/api/amc-schedule', amcScheduleRouter);   // AMC contracts + generated schedules
app.use('/api/amc',      amcRouter);
app.use('/api/uploads',  uploadsRouter);   // real file attachment → Drive

/* Solar Care */
app.use('/api/tickets',   ticketsRouter);     // Ticket Generation
app.use('/api/amc-setup', amcSetupRouter);    // Inspection / Cleaning / Both
app.use('/api/solarcare', solarcareRouter);   // the client → project → ops tree
app.use('/api/users',    usersRouter);
app.use('/api/launcher', launcherRouter);
app.use('/api/dropdown-options', dropdownOptionsRouter);
app.use('/api/sync',     syncRouter);
app.use('/api',          syncRouter);          // exposes GET /api/lookups

/* cache diagnostics — how warm is each tab right now?
   MUST be declared before the 404 catch-all below, or it can never be reached. */
app.get('/health/cache', (_, res) => res.json({ ok: true, cache: db.stats() }));

app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
