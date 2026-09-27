-- ===========================================================================
-- EcoSoch Project Repository — change Projects column types (per Book1.xlsx)
-- Numbers: 9 columns · Dates: 8 columns · everything else stays text.
-- ===========================================================================
-- RUN ORDER: deploy the matching backend code FIRST (the Supabase adapter now
-- sends NULL for empty typed fields, plain numbers, and 'YYYY-MM-DD' dates),
-- THEN run this on the STAGING Supabase. Roll to prod only at cutover.
--
-- IMPORTANT: the columns hold free text today, including non-numeric / non-date
-- markers like 'NA', 'N/A', '-', 'TBD', etc. Those CANNOT become a number or a
-- date, so the CASE expressions below convert any value that is not a clean
-- number / not an ISO date into NULL. That is intentional: 'NA' in an amount or
-- date column means "no value". Everything that IS a valid number/date is kept.
--
-- Wrapped in a transaction so any problem rolls the whole thing back cleanly.
-- To preview what WOULD be nulled before committing, run e.g.:
--   select distinct "Order_Value" from "Projects"
--   where "Order_Value" is not null
--     and "Order_Value" !~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$';

begin;

-- ── Numbers ──────────────────────────────────────────────────────────────
-- Keep clean integers/decimals (commas stripped); anything else -> NULL.
alter table "Projects" alter column "Project_Size"     type numeric using (case when replace(btrim("Project_Size"),     ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Project_Size"),     ',','')::numeric end);
alter table "Projects" alter column "Module_Wattage"   type numeric using (case when replace(btrim("Module_Wattage"),   ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Module_Wattage"),   ',','')::numeric end);
alter table "Projects" alter column "Module_No"        type numeric using (case when replace(btrim("Module_No"),        ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Module_No"),        ',','')::numeric end);
alter table "Projects" alter column "Order_Value"      type numeric using (case when replace(btrim("Order_Value"),      ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Order_Value"),      ',','')::numeric end);
alter table "Projects" alter column "Margin"           type numeric using (case when replace(btrim("Margin"),           ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Margin"),           ',','')::numeric end);
alter table "Projects" alter column "Warranty_Period"  type numeric using (case when replace(btrim("Warranty_Period"),  ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Warranty_Period"),  ',','')::numeric end);
alter table "Projects" alter column "Referral_Amount"  type numeric using (case when replace(btrim("Referral_Amount"),  ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Referral_Amount"),  ',','')::numeric end);
alter table "Projects" alter column "Retention_Amount" type numeric using (case when replace(btrim("Retention_Amount"), ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Retention_Amount"), ',','')::numeric end);
alter table "Projects" alter column "Retention_Period" type numeric using (case when replace(btrim("Retention_Period"), ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Retention_Period"), ',','')::numeric end);

-- ── Dates ────────────────────────────────────────────────────────────────
-- Created_Date / Last_Updated_Date currently carry a TEXT default; drop it
-- before retyping, then re-add a DATE default afterwards.
alter table "Projects" alter column "Created_Date"      drop default;
alter table "Projects" alter column "Last_Updated_Date" drop default;

-- Keep values that START with an ISO date (handles 'YYYY-MM-DD' and
-- 'YYYY-MM-DDTHH:MM:SS'); anything else (NA, blank, other formats) -> NULL.
alter table "Projects" alter column "Commissioned_Date"   type date using (case when btrim("Commissioned_Date")   ~ '^\d{4}-\d{2}-\d{2}' then btrim("Commissioned_Date")::timestamp::date end);
alter table "Projects" alter column "Warranty_Start_Date" type date using (case when btrim("Warranty_Start_Date") ~ '^\d{4}-\d{2}-\d{2}' then btrim("Warranty_Start_Date")::timestamp::date end);
alter table "Projects" alter column "Warranty_End_Date"   type date using (case when btrim("Warranty_End_Date")   ~ '^\d{4}-\d{2}-\d{2}' then btrim("Warranty_End_Date")::timestamp::date end);
alter table "Projects" alter column "Exp_Inst_Date"       type date using (case when btrim("Exp_Inst_Date")       ~ '^\d{4}-\d{2}-\d{2}' then btrim("Exp_Inst_Date")::timestamp::date end);
alter table "Projects" alter column "Exp_Commsn_Date"     type date using (case when btrim("Exp_Commsn_Date")     ~ '^\d{4}-\d{2}-\d{2}' then btrim("Exp_Commsn_Date")::timestamp::date end);
alter table "Projects" alter column "Created_Date"        type date using (case when btrim("Created_Date")        ~ '^\d{4}-\d{2}-\d{2}' then btrim("Created_Date")::timestamp::date end);
alter table "Projects" alter column "Last_Updated_Date"   type date using (case when btrim("Last_Updated_Date")   ~ '^\d{4}-\d{2}-\d{2}' then btrim("Last_Updated_Date")::timestamp::date end);
alter table "Projects" alter column "New_Order_Sent_At"   type date using (case when btrim("New_Order_Sent_At")   ~ '^\d{4}-\d{2}-\d{2}' then btrim("New_Order_Sent_At")::timestamp::date end);

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
