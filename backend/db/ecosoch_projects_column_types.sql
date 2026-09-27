-- ===========================================================================
-- EcoSoch Project Repository — change Projects column types (per Book1.xlsx)
-- Numbers: 9 columns · Dates: 8 columns · everything else stays text.
-- ===========================================================================
-- RUN ORDER: deploy the matching backend code FIRST (the Supabase adapter now
-- sends NULL for empty typed fields, plain numbers, and 'YYYY-MM-DD' dates),
-- THEN run this on the STAGING Supabase. Roll to prod only at cutover.
--
-- The USING clause is required: existing values are text, and empty strings
-- ('') cannot cast to numeric/date, so nullif(...,'') turns them into NULL.
-- Wrapped in a transaction so a bad cast rolls the whole thing back cleanly.
--
-- If a cast ERRORS, some rows hold non-standard text for that column. Find them:
--   select "Order_Value" from "Projects"
--   where "Order_Value" is not null and btrim("Order_Value") <> ''
--     and "Order_Value" !~ '^-?[0-9]+(\.[0-9]+)?$';           -- numeric check
--   select "Commissioned_Date" from "Projects"
--   where "Commissioned_Date" is not null and btrim("Commissioned_Date") <> ''
--     and "Commissioned_Date" !~ '^\d{4}-\d{2}-\d{2}';        -- date check
-- Clean those rows, then re-run.

begin;

-- ── Numbers ────────────────────────────────────────────────────────────────
alter table "Projects" alter column "Project_Size"     type numeric using nullif(btrim("Project_Size"),'')::numeric;
alter table "Projects" alter column "Module_Wattage"   type numeric using nullif(btrim("Module_Wattage"),'')::numeric;
alter table "Projects" alter column "Module_No"        type numeric using nullif(btrim("Module_No"),'')::numeric;
alter table "Projects" alter column "Order_Value"      type numeric using nullif(btrim("Order_Value"),'')::numeric;
alter table "Projects" alter column "Margin"           type numeric using nullif(btrim("Margin"),'')::numeric;
alter table "Projects" alter column "Warranty_Period"  type numeric using nullif(btrim("Warranty_Period"),'')::numeric;
alter table "Projects" alter column "Referral_Amount"  type numeric using nullif(btrim("Referral_Amount"),'')::numeric;
alter table "Projects" alter column "Retention_Amount" type numeric using nullif(btrim("Retention_Amount"),'')::numeric;
alter table "Projects" alter column "Retention_Period" type numeric using nullif(btrim("Retention_Period"),'')::numeric;

-- ── Dates ──────────────────────────────────────────────────────────────────
-- Created_Date / Last_Updated_Date currently carry a TEXT default; drop it
-- before retyping, then re-add a DATE default afterwards.
alter table "Projects" alter column "Created_Date"      drop default;
alter table "Projects" alter column "Last_Updated_Date" drop default;

-- ::timestamp::date tolerates both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS'.
alter table "Projects" alter column "Commissioned_Date"   type date using nullif(btrim("Commissioned_Date"),'')::timestamp::date;
alter table "Projects" alter column "Warranty_Start_Date" type date using nullif(btrim("Warranty_Start_Date"),'')::timestamp::date;
alter table "Projects" alter column "Warranty_End_Date"   type date using nullif(btrim("Warranty_End_Date"),'')::timestamp::date;
alter table "Projects" alter column "Exp_Inst_Date"       type date using nullif(btrim("Exp_Inst_Date"),'')::timestamp::date;
alter table "Projects" alter column "Exp_Commsn_Date"     type date using nullif(btrim("Exp_Commsn_Date"),'')::timestamp::date;
alter table "Projects" alter column "Created_Date"        type date using nullif(btrim("Created_Date"),'')::timestamp::date;
alter table "Projects" alter column "Last_Updated_Date"   type date using nullif(btrim("Last_Updated_Date"),'')::timestamp::date;
alter table "Projects" alter column "New_Order_Sent_At"   type date using nullif(btrim("New_Order_Sent_At"),'')::timestamp::date;

-- Re-add the audit-date defaults, now as a real date (IST).
alter table "Projects" alter column "Created_Date"      set default (now() at time zone 'Asia/Kolkata')::date;
alter table "Projects" alter column "Last_Updated_Date" set default (now() at time zone 'Asia/Kolkata')::date;

commit;

-- Verify the new types.
select column_name, data_type
from information_schema.columns
where table_name = 'Projects'
  and column_name in (
    'Project_Size','Module_Wattage','Module_No','Order_Value','Margin',
    'Warranty_Period','Referral_Amount','Retention_Amount','Retention_Period',
    'Commissioned_Date','Warranty_Start_Date','Warranty_End_Date',
    'Exp_Inst_Date','Exp_Commsn_Date','Created_Date','Last_Updated_Date','New_Order_Sent_At'
  )
order by column_name;
