-- ===========================================================================
-- EcoSoch Project Repository — wind speed committed to the client (Projects)
-- ===========================================================================
-- New required question on the Add/Edit Project form, under
-- "Scope & Commitments", right after the salesperson commitment question:
--   "What's the windspeed in km/h committed to the client for the structure
--    (if any)?"   -> Wind_Speed, free text (a speed, or NA if none).
--
-- RUN THIS BEFORE DEPLOYING THE APP CHANGE. The backend now writes this
-- column, and on DATA_SOURCE=supabase a save naming a column the table does
-- not have is rejected by PostgREST — every project save would fail.
--
-- Safe to run more than once. Staging Supabase project first, then prod.
-- Also add a "Wind_Speed" column header to the Projects tab of the Google
-- Sheet (any position), so sheet mode / write-through can store it.

alter table "Projects" add column if not exists "Wind_Speed" text;
