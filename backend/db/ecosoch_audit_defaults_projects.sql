-- ===========================================================================
-- EcoSoch Project Repository — audit-field DB defaults (Projects)
-- ===========================================================================
-- The real source of these values is the APP (backend), which now stamps:
--   Created_By / Last_Updated_By  = the logged-in user's email (from the JWT)
--   Created_Date / Last_Updated_Date = today's date (IST), 'YYYY-MM-DDT00:00:00'
--
-- A database DEFAULT can only cover the DATE columns, as a safety net for any
-- row inserted OUTSIDE the app. It CANNOT default Created_By to the logged-in
-- email, because Postgres has no knowledge of the app session — that column is
-- set by the backend only.
--
-- Idempotent. Explicit values sent by the app/backfill always win over these
-- defaults (an explicit NULL also overrides a default), so this changes nothing
-- for normal app writes.

alter table "Projects"
  alter column "Created_Date"
  set default to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') || 'T00:00:00';

alter table "Projects"
  alter column "Last_Updated_Date"
  set default to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') || 'T00:00:00';

-- Note: no default on "Created_By" / "Last_Updated_By" — those come from the
-- logged-in user in the backend, which the database cannot know.

-- Sanity: show the defaults now on the audit columns.
select column_name, column_default
from information_schema.columns
where table_name = 'Projects'
  and column_name in ('Created_By','Created_Date','Last_Updated_By','Last_Updated_Date')
order by column_name;
