-- ===========================================================================
-- EcoSoch Project Repository — change column types for the remaining tables:
--   AMC_Payment_Schedule · AMC_Tasks_Schedule · Tickets
-- ===========================================================================
-- RUN ORDER: deploy the matching backend code FIRST, THEN run on STAGING.
-- TIP: run ecosoch_find_bad_remaining_values.sql first to spot any column that
--      is really free text (leave those as text instead).
--
-- Ticket_Expenses is intentionally left as TEXT (may hold notes, not a number).
-- Service/Material_Charge_Applicable stay TEXT (Yes/No).
-- Tolerant casts: numbers strip commas; dates accept ISO + DD-MM-YYYY; junk -> NULL.
-- Transactional.

begin;

-- ── AMC_Payment_Schedule ─────────────────────────────────────────────────────
alter table "AMC_Payment_Schedule" alter column "Payment_Amount" type numeric using (case when replace(btrim("Payment_Amount"),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Payment_Amount"),',','')::numeric end);
alter table "AMC_Payment_Schedule" alter column "Payment_Due_Date" type date using (case when btrim("Payment_Due_Date") ~ '^\d{4}-\d{2}-\d{2}' then btrim("Payment_Due_Date")::timestamp::date when btrim("Payment_Due_Date") ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Payment_Due_Date"),'/','-'),'DD-MM-YYYY') end);

-- ── AMC_Tasks_Schedule ───────────────────────────────────────────────────────
alter table "AMC_Tasks_Schedule" alter column "AMC_Due_Date" type date using (case when btrim("AMC_Due_Date") ~ '^\d{4}-\d{2}-\d{2}' then btrim("AMC_Due_Date")::timestamp::date when btrim("AMC_Due_Date") ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("AMC_Due_Date"),'/','-'),'DD-MM-YYYY') end);

-- ── Tickets — numbers ────────────────────────────────────────────────────────
alter table "Tickets" alter column "Service_Charge"         type numeric using (case when replace(btrim("Service_Charge"),        ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Service_Charge"),        ',','')::numeric end);
alter table "Tickets" alter column "Material_Charge"        type numeric using (case when replace(btrim("Material_Charge"),       ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Material_Charge"),       ',','')::numeric end);
alter table "Tickets" alter column "Total_Charge"           type numeric using (case when replace(btrim("Total_Charge"),          ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Total_Charge"),          ',','')::numeric end);
alter table "Tickets" alter column "Ticket_Warranty_Period" type numeric using (case when replace(btrim("Ticket_Warranty_Period"),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Ticket_Warranty_Period"),',','')::numeric end);

-- ── Tickets — dates ──────────────────────────────────────────────────────────
alter table "Tickets" alter column "Ticket_Start_Date"          type date using (case when btrim("Ticket_Start_Date")          ~ '^\d{4}-\d{2}-\d{2}' then btrim("Ticket_Start_Date")::timestamp::date          when btrim("Ticket_Start_Date")          ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Ticket_Start_Date"),         '/','-'),'DD-MM-YYYY') end);
alter table "Tickets" alter column "Ticket_Due_Date"            type date using (case when btrim("Ticket_Due_Date")            ~ '^\d{4}-\d{2}-\d{2}' then btrim("Ticket_Due_Date")::timestamp::date            when btrim("Ticket_Due_Date")            ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Ticket_Due_Date"),           '/','-'),'DD-MM-YYYY') end);
alter table "Tickets" alter column "Ticket_Warranty_Start_Date" type date using (case when btrim("Ticket_Warranty_Start_Date") ~ '^\d{4}-\d{2}-\d{2}' then btrim("Ticket_Warranty_Start_Date")::timestamp::date when btrim("Ticket_Warranty_Start_Date") ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Ticket_Warranty_Start_Date"),'/','-'),'DD-MM-YYYY') end);
alter table "Tickets" alter column "Ticket_Warranty_End_Date"   type date using (case when btrim("Ticket_Warranty_End_Date")   ~ '^\d{4}-\d{2}-\d{2}' then btrim("Ticket_Warranty_End_Date")::timestamp::date   when btrim("Ticket_Warranty_End_Date")   ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Ticket_Warranty_End_Date"),  '/','-'),'DD-MM-YYYY') end);
alter table "Tickets" alter column "Created_Date"               type date using (case when btrim("Created_Date")               ~ '^\d{4}-\d{2}-\d{2}' then btrim("Created_Date")::timestamp::date               when btrim("Created_Date")               ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Created_Date"),              '/','-'),'DD-MM-YYYY') end);
alter table "Tickets" alter column "Last_Updated_Date"          type date using (case when btrim("Last_Updated_Date")          ~ '^\d{4}-\d{2}-\d{2}' then btrim("Last_Updated_Date")::timestamp::date          when btrim("Last_Updated_Date")          ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Last_Updated_Date"),         '/','-'),'DD-MM-YYYY') end);

commit;

-- Verify.
select table_name, column_name, data_type
from information_schema.columns
where (table_name = 'AMC_Payment_Schedule' and column_name in ('Payment_Amount','Payment_Due_Date'))
   or (table_name = 'AMC_Tasks_Schedule'   and column_name in ('AMC_Due_Date'))
   or (table_name = 'Tickets'              and column_name in (
        'Service_Charge','Material_Charge','Total_Charge','Ticket_Warranty_Period',
        'Ticket_Start_Date','Ticket_Due_Date','Ticket_Warranty_Start_Date',
        'Ticket_Warranty_End_Date','Created_Date','Last_Updated_Date'))
order by table_name, column_name;
