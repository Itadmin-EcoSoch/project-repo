-- ===========================================================================
-- EcoSoch Project Repository — change AMC_Contracts column types
-- Numbers: 10 columns · Dates: 4 columns · everything else stays text.
-- ===========================================================================
-- RUN ORDER: deploy the matching backend code FIRST, THEN run on STAGING.
-- TIP: run ecosoch_find_bad_amc_values.sql first to see any non-convertible
--      values (e.g. a column that is actually free text like 'NA'/'monthly').
--
-- Tolerant casts: numbers strip commas (junk -> NULL); dates accept ISO
-- 'YYYY-MM-DD[THH:MM:SS]' AND Indian 'DD-MM-YYYY' / 'DD/MM/YYYY' (else NULL).
-- Transactional: any error rolls the whole thing back.

begin;

-- ── Numbers (10) ───────────────────────────────────────────────────────────
alter table "AMC_Contracts" alter column "AMC_Frequency"           type numeric using (case when replace(btrim("AMC_Frequency"),          ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("AMC_Frequency"),          ',','')::numeric end);
alter table "AMC_Contracts" alter column "AMC_Period_in_Years"     type numeric using (case when replace(btrim("AMC_Period_in_Years"),    ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("AMC_Period_in_Years"),    ',','')::numeric end);
alter table "AMC_Contracts" alter column "Payment_Amount"          type numeric using (case when replace(btrim("Payment_Amount"),         ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Payment_Amount"),         ',','')::numeric end);
alter table "AMC_Contracts" alter column "Tasks_Count"             type numeric using (case when replace(btrim("Tasks_Count"),            ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Tasks_Count"),            ',','')::numeric end);
alter table "AMC_Contracts" alter column "Payments_Count"          type numeric using (case when replace(btrim("Payments_Count"),         ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Payments_Count"),         ',','')::numeric end);
alter table "AMC_Contracts" alter column "Percent_Increase"        type numeric using (case when replace(btrim("Percent_Increase"),       ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Percent_Increase"),       ',','')::numeric end);
alter table "AMC_Contracts" alter column "Payment_Frequency"       type numeric using (case when replace(btrim("Payment_Frequency"),      ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Payment_Frequency"),      ',','')::numeric end);
alter table "AMC_Contracts" alter column "Payment_Period_in_Years" type numeric using (case when replace(btrim("Payment_Period_in_Years"),',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Payment_Period_in_Years"),',','')::numeric end);
alter table "AMC_Contracts" alter column "AMC_Tasks_Done"          type numeric using (case when replace(btrim("AMC_Tasks_Done"),         ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("AMC_Tasks_Done"),         ',','')::numeric end);
alter table "AMC_Contracts" alter column "Payments_Done"           type numeric using (case when replace(btrim("Payments_Done"),          ',','') ~ '^-?[0-9]+(\.[0-9]+)?$' then replace(btrim("Payments_Done"),          ',','')::numeric end);

-- ── Dates (4) ──────────────────────────────────────────────────────────────
alter table "AMC_Contracts" alter column "AMC_Start_Date"     type date using (case when btrim("AMC_Start_Date")     ~ '^\d{4}-\d{2}-\d{2}' then btrim("AMC_Start_Date")::timestamp::date     when btrim("AMC_Start_Date")     ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("AMC_Start_Date"),    '/','-'),'DD-MM-YYYY') end);
alter table "AMC_Contracts" alter column "AMC_End_Date"       type date using (case when btrim("AMC_End_Date")       ~ '^\d{4}-\d{2}-\d{2}' then btrim("AMC_End_Date")::timestamp::date       when btrim("AMC_End_Date")       ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("AMC_End_Date"),      '/','-'),'DD-MM-YYYY') end);
alter table "AMC_Contracts" alter column "Payment_Start_Date" type date using (case when btrim("Payment_Start_Date") ~ '^\d{4}-\d{2}-\d{2}' then btrim("Payment_Start_Date")::timestamp::date when btrim("Payment_Start_Date") ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Payment_Start_Date"),'/','-'),'DD-MM-YYYY') end);
alter table "AMC_Contracts" alter column "Payment_End_Date"   type date using (case when btrim("Payment_End_Date")   ~ '^\d{4}-\d{2}-\d{2}' then btrim("Payment_End_Date")::timestamp::date   when btrim("Payment_End_Date")   ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then to_date(replace(btrim("Payment_End_Date"),  '/','-'),'DD-MM-YYYY') end);

commit;

-- Verify.
select column_name, data_type
from information_schema.columns
where table_name = 'AMC_Contracts'
  and column_name in (
    'AMC_Frequency','AMC_Period_in_Years','Payment_Amount','Tasks_Count',
    'Payments_Count','Percent_Increase','Payment_Frequency','Payment_Period_in_Years',
    'AMC_Tasks_Done','Payments_Done',
    'AMC_Start_Date','AMC_End_Date','Payment_Start_Date','Payment_End_Date'
  )
order by column_name;
