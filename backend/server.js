/*  backend/server.js — local dev / Node-host entry.
    The Express app itself lives in app.js so it can also be imported by the
    Vercel serverless entry at backend/api/index.js.                          */

require('dotenv').config();
const app = require('./app');
const db  = require('./db/sheets');
const { REQUIRE_AUTH } = require('./middleware/auth');
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`\n🌞  EcoSoch API (Google Sheets) → http://localhost:${PORT}`);
  console.log(`    health check → http://localhost:${PORT}/health/db`);
  console.log(`    auth         → ${REQUIRE_AUTH ? 'ENFORCED' : 'open (REQUIRE_AUTH=false)'}`);

  /*  WHO CAN SIGN IN — printed in full at every boot.

      This exists because AUTH_MODE is read from .env once, at startup, and
      getting it wrong produces a login screen that refuses real employees with
      no clue as to why. Printing the effective setting here means the answer is
      always in the terminal you just started, rather than in a file you have to
      remember to check.                                                     */
  const mode   = (process.env.AUTH_MODE || 'domain').toLowerCase();
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || 'ecosoch.com';
  const role   = process.env.DEFAULT_ROLE || 'User';

  console.log(`    sign-in      → Google, @${domain} addresses only`);
  if (mode === 'sheet') {
    console.log(`    AUTH_MODE    → sheet  ⚠️  ONLY people already listed in the`);
    console.log(`                     Users tab can sign in. A new employee will be`);
    console.log(`                     REFUSED with "has not been given access yet".`);
    console.log(`                     Want everyone at @${domain} to sign in`);
    console.log(`                     automatically? Set AUTH_MODE=domain in`);
    console.log(`                     backend/.env and restart.`);
  } else {
    console.log(`    AUTH_MODE    → domain — anyone with an @${domain} address`);
    console.log(`                     signs in and is saved to Team members as "${role}"`);
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('⚠️   GOOGLE_CLIENT_ID is not set — the login page cannot render');
  }
  console.log('');
  if (!db.hasCredentials) {
    console.warn('⚠️   SHEETS_API_URL / SHEETS_API_TOKEN are not set in backend/.env\n');
    return;
  }
  // Load the busy tabs now, while you are still opening the browser.
  db.prewarm().catch(e => console.error('[sheets] prewarm failed:', e.message));
});