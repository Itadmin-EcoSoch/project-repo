-- ===========================================================================
-- EcoSoch Project Repository — equipment location questions (Projects)
-- ===========================================================================
-- Two new questions on the Add/Edit Project form, under "Scope & Commitments":
--   Inverter_Location    — String / Hybrid inverter, or SolarEdge systems
--   IQ_Gateway_Location  — Enphase systems
-- Free text; 'NA' when the question does not apply to the project.
--
-- RUN THIS BEFORE DEPLOYING THE APP CHANGE. The backend now writes these
-- columns, and on DATA_SOURCE=supabase a save naming a column the table does
-- not have is rejected by PostgREST — every project save would fail.
--
-- Safe to run more than once. Staging Supabase project first, then prod.
-- Also add the same two column headers to the Projects tab of the Google
-- Sheet (any position), so sheet mode / write-through can store them.

alter table "Projects" add column if not exists "Inverter_Location"   text;
alter table "Projects" add column if not exists "IQ_Gateway_Location" text;
