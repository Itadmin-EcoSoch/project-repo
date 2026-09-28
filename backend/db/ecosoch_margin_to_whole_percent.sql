-- ===========================================================================
-- EcoSoch Project Repository — convert Margin from fraction to WHOLE percent.
-- Old convention stored 0.549 for 54.9% (Sheet %-format). New convention stores
-- the human percent: 54.9. Deploy the matching frontend FIRST (it stops the
-- ÷100 on save and ×100 on read/display), THEN run this on the STAGING Supabase.
--
-- Only values <= 1 are rescaled (those are the fractions). Rows that already
-- hold a whole number (> 1, e.g. a legacy 12) are left as-is. round(...,2) also
-- clears the floating-point noise (0.5489999999999999 -> 54.9).
-- Idempotent-ish: safe to run once. Re-running would NOT double-scale values
-- that are now > 1, but a genuine <=1% margin would be affected — there are
-- none in practice (solar margins are 7-55%).
-- ===========================================================================

update "Projects"
set "Margin" = round("Margin" * 100, 2)
where "Margin" is not null
  and "Margin" <= 1;

-- Enforce clean 2-decimal storage going forward (max 9999.99, fits 0-100).
alter table "Projects" alter column "Margin" type numeric(6,2);

-- Verify.
select "Project_ID", "Margin" from "Projects"
where "Margin" is not null
order by "Margin" desc
limit 20;
