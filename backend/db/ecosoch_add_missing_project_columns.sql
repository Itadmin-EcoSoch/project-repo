-- ===========================================================================
-- EcoSoch Project Repository — Supabase schema top-up (CONSOLIDATED)
-- ===========================================================================
-- The original Supabase schema was generated from the app's column mapping,
-- so any sheet column that wasn't mapped was left out — and those fields then
-- showed blank/hidden in the app. This script adds every such column across
-- all affected tables:
--     Projects .............. 19 columns
--     AMC_Contracts ......... 8 columns
--     AMC_Payment_Schedule .. 1 column  (Payment_Receipt)
--     Tickets ............... 6 columns
-- (Clients and AMC_Tasks_Schedule were already complete — no changes.)
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

-- ---------------------------------------------------------------------------
-- AMC_Payment_Schedule — the receipt file column exists in the sheet tab but
-- was never created in Supabase.
-- ---------------------------------------------------------------------------
alter table "AMC_Payment_Schedule" add column if not exists "Payment_Receipt" text;

-- ---------------------------------------------------------------------------
-- Tickets — columns present in the Tickets sheet tab but never created in
-- Supabase (charge-applicable flags and amounts, ticket expenses, ticket files,
-- and the updated-by stamp).
-- ---------------------------------------------------------------------------
alter table "Tickets" add column if not exists "Service_Charge_Applicable"  text;
alter table "Tickets" add column if not exists "Service_Charge"             text;
alter table "Tickets" add column if not exists "Material_Charge_Applicable" text;
alter table "Tickets" add column if not exists "Ticket_Expenses"            text;
alter table "Tickets" add column if not exists "Ticket_Files"               text;
alter table "Tickets" add column if not exists "Last_Updated_By"            text;

-- ---------------------------------------------------------------------------
-- Users — the app has an Active/Inactive status but it was never mapped or
-- stored, so it never persisted. Add the column so status round-trips.
-- ---------------------------------------------------------------------------
alter table "Users" add column if not exists "User_Status" text;

-- ---------------------------------------------------------------------------
-- Sanity: column counts on each affected table after the top-up.
-- ---------------------------------------------------------------------------
select table_name, count(*) as column_count
from information_schema.columns
where table_name in ('Projects','AMC_Contracts','AMC_Payment_Schedule','Tickets')
group by table_name
order by table_name;
