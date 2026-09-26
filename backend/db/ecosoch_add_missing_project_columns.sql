-- EcoSoch Project Repository — add the Projects columns that were missing from
-- the original Supabase schema. These are columns the app's project form reads
-- and writes (Billing & Documentation toggles, referral, retention, monitoring,
-- etc.) but that were never created in Supabase, so they showed blank/hidden.
--
-- Safe to run more than once: every statement is IF NOT EXISTS.
-- Run in the Supabase SQL editor for the STAGING project first, then PROD at cutover.
-- After running, re-run the backfill (POST /api/supabase/backfill) to populate them.

alter table "Projects" add column if not exists "Bill_Available"          text;
alter table "Projects" add column if not exists "PO_Available"            text;
alter table "Projects" add column if not exists "PO_Bill_Name_Same"       text;
alter table "Projects" add column if not exists "Billing_Quotation_Same"  text;
alter table "Projects" add column if not exists "GST_Available"           text;
alter table "Projects" add column if not exists "Quotation_Name"          text;

alter table "Projects" add column if not exists "Referral"                text;
alter table "Projects" add column if not exists "Referral_Amount"         text;
alter table "Projects" add column if not exists "Referrer_Name"           text;

alter table "Projects" add column if not exists "Retention"               text;
alter table "Projects" add column if not exists "Retention_Amount"        text;
alter table "Projects" add column if not exists "Retention_Period"        text;

alter table "Projects" add column if not exists "Monitoring_Frequency"    text;
alter table "Projects" add column if not exists "TSV_Required"            text;
alter table "Projects" add column if not exists "Capacity_Finalised"      text;
alter table "Projects" add column if not exists "Elevated_drawings"       text;

alter table "Projects" add column if not exists "New_Order_Sent_At"       text;
alter table "Projects" add column if not exists "New_Order_Sent_By"       text;
alter table "Projects" add column if not exists "Internal_Id"             text;

-- ---------------------------------------------------------------------------
-- AMC_Contracts — same gap: these columns exist in the AMC_Contracts sheet tab
-- but were never created in Supabase (payment schedule terms, the
-- tasks/payments-done flags and the annual percent increase).
-- ---------------------------------------------------------------------------
alter table "AMC_Contracts" add column if not exists "Payment_Available"        text;
alter table "AMC_Contracts" add column if not exists "Percent_Increase"         text;
alter table "AMC_Contracts" add column if not exists "Payment_Frequency"        text;
alter table "AMC_Contracts" add column if not exists "Payment_Period_in_Years"  text;
alter table "AMC_Contracts" add column if not exists "Payment_Start_Date"       text;
alter table "AMC_Contracts" add column if not exists "Payment_End_Date"         text;
alter table "AMC_Contracts" add column if not exists "AMC_Tasks_Done"           text;
alter table "AMC_Contracts" add column if not exists "Payments_Done"            text;

-- Sanity: list the columns now on the Projects table.
select column_name
from information_schema.columns
where table_name = 'Projects'
order by ordinal_position;

-- Sanity: list the columns now on the AMC_Contracts table.
select column_name
from information_schema.columns
where table_name = 'AMC_Contracts'
order by ordinal_position;
