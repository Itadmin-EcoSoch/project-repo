# EcoSoch Project Repository — Deployment & ONE-portal integration

Integrated the same way as **Site Visit Report (field.ecosoch.com)**: deployed at
its own URL and shown in the one.ecosoch.com portal as an app tile, with Google
sign-in that does not prompt a second time.

## Architecture
- **frontend/** — Vite + React (MUI). Builds to static (`frontend/dist`).
- **backend/** — Express API. Data lives in Google Sheets, reached through an
  **Apps Script Web App** (`SHEETS_API_URL`/`exec`). Auth = Google ID token
  verified server-side, then a 7-day JWT.

## Seamless login (already implemented)
`frontend/src/pages/Login.jsx` initialises Google Identity Services with
`auto_select: true` and calls `prompt()` to resolve the existing Google session
silently, falling back to a button only if needed. Because every user reaches
this app already signed in at one.ecosoch.com, no second login screen shows —
same behaviour as field.ecosoch.com. Requires `GOOGLE_CLIENT_ID` to be set and
the deployed origin added to the OAuth client's *Authorised JavaScript origins*.

## Pointing at the new Google Sheet
The sheet ID is **not in this code** — it is bound inside the Apps Script.
To use the itadmin-owned sheet (`1o62ttAgFdDm_iyrQ8YuWmxL6o4sBdZwgoGP17vaRMXw`):
1. Ensure the new sheet has the same tabs the app expects: `Clients, Projects,
   AMC_Contracts, AMC_Tasks_Schedule, AMC_Payment_Schedule, Tickets, Users,
   Launcher, Order_Log, Status_Log, Add_Months, Dropdown_Options`.
2. In the Apps Script project (Code.gs), point it at the new sheet (change the
   bound spreadsheet / `openById`) and **Deploy → Manage deployments** to get a
   fresh `/exec` URL.
3. Put that URL in `SHEETS_API_TOKEN`-matched `SHEETS_API_URL` (backend env).
4. Verify with `GET /health/db` — every tab should report `ok`.

## Hosting options
### Recommended: frontend on Vercel, backend on a persistent Node host
Cold Google-Sheet reads can take up to ~90s (`SHEETS_TIMEOUT=90000`), which
exceeds typical Vercel serverless function limits. Run the backend on a
persistent host (Render / Railway / small VM) so long reads, the warm cache and
the nightly SolarCare job work as written.
- Backend: deploy `backend/`, `npm start`, set all `backend/.env` vars.
- Frontend: deploy `frontend/` on Vercel, set `VITE_API_URL` to the backend URL.

### Single Vercel project (closest to field's setup)
Frontend static + Express as a serverless function under `/api`. Set
`VITE_API_URL` blank (same-origin). Caveats: raise function `maxDuration`
(needs a plan that allows it) or the slowest sheet reads will time out; move the
SolarCare cron to Vercel Cron.

## Register in the ONE portal
Add to `one-ecosoch/src/lib/data.ts` `apps[]` as an `external_link` app (like
`site-visit`), pointing at the deployed URL, under the chosen team.

## Environment variables
See `backend/.env.example` and `frontend/.env.example`. Never commit a real
`.env`. NOTE: a previous `backend/.env.example` contained a real-looking
Supabase key — it has been removed here; rotate that key if it was ever live.
