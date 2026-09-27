-- Find AMC_Contracts values that WON'T convert (non-empty, not a clean number /
-- not an ISO or DD-MM-YYYY date). Run before the type-change script.
-- Lists: column, AMC_Id, and the bad value. Empty strings are ignored (-> NULL).

-- ── Numeric columns ──────────────────────────────────────────────────────────
select 'AMC_Frequency'           as column_name, "AMC_Id", "AMC_Frequency"           as bad_value from "AMC_Contracts" where "AMC_Frequency"           is not null and replace(btrim("AMC_Frequency"),          ',','') <> '' and replace(btrim("AMC_Frequency"),          ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'AMC_Period_in_Years',     "AMC_Id", "AMC_Period_in_Years"     from "AMC_Contracts" where "AMC_Period_in_Years"     is not null and replace(btrim("AMC_Period_in_Years"),    ',','') <> '' and replace(btrim("AMC_Period_in_Years"),    ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'Payment_Amount',          "AMC_Id", "Payment_Amount"          from "AMC_Contracts" where "Payment_Amount"          is not null and replace(btrim("Payment_Amount"),         ',','') <> '' and replace(btrim("Payment_Amount"),         ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'Tasks_Count',             "AMC_Id", "Tasks_Count"             from "AMC_Contracts" where "Tasks_Count"             is not null and replace(btrim("Tasks_Count"),            ',','') <> '' and replace(btrim("Tasks_Count"),            ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'Payments_Count',          "AMC_Id", "Payments_Count"          from "AMC_Contracts" where "Payments_Count"          is not null and replace(btrim("Payments_Count"),         ',','') <> '' and replace(btrim("Payments_Count"),         ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'Percent_Increase',        "AMC_Id", "Percent_Increase"        from "AMC_Contracts" where "Percent_Increase"        is not null and replace(btrim("Percent_Increase"),       ',','') <> '' and replace(btrim("Percent_Increase"),       ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'Payment_Frequency',       "AMC_Id", "Payment_Frequency"       from "AMC_Contracts" where "Payment_Frequency"       is not null and replace(btrim("Payment_Frequency"),      ',','') <> '' and replace(btrim("Payment_Frequency"),      ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'Payment_Period_in_Years', "AMC_Id", "Payment_Period_in_Years" from "AMC_Contracts" where "Payment_Period_in_Years" is not null and replace(btrim("Payment_Period_in_Years"),',','') <> '' and replace(btrim("Payment_Period_in_Years"),',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'AMC_Tasks_Done',          "AMC_Id", "AMC_Tasks_Done"          from "AMC_Contracts" where "AMC_Tasks_Done"          is not null and replace(btrim("AMC_Tasks_Done"),         ',','') <> '' and replace(btrim("AMC_Tasks_Done"),         ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all select 'Payments_Done',           "AMC_Id", "Payments_Done"           from "AMC_Contracts" where "Payments_Done"           is not null and replace(btrim("Payments_Done"),          ',','') <> '' and replace(btrim("Payments_Done"),          ',','') !~ '^-?[0-9]+(\.[0-9]+)?$'

-- ── Date columns (ISO or DD-MM-YYYY accepted) ───────────────────────────────
union all select 'AMC_Start_Date',     "AMC_Id", "AMC_Start_Date"     from "AMC_Contracts" where "AMC_Start_Date"     is not null and btrim("AMC_Start_Date")     <> '' and btrim("AMC_Start_Date")     !~ '^\d{4}-\d{2}-\d{2}' and btrim("AMC_Start_Date")     !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all select 'AMC_End_Date',       "AMC_Id", "AMC_End_Date"       from "AMC_Contracts" where "AMC_End_Date"       is not null and btrim("AMC_End_Date")       <> '' and btrim("AMC_End_Date")       !~ '^\d{4}-\d{2}-\d{2}' and btrim("AMC_End_Date")       !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all select 'Payment_Start_Date', "AMC_Id", "Payment_Start_Date" from "AMC_Contracts" where "Payment_Start_Date" is not null and btrim("Payment_Start_Date") <> '' and btrim("Payment_Start_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Payment_Start_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all select 'Payment_End_Date',   "AMC_Id", "Payment_End_Date"   from "AMC_Contracts" where "Payment_End_Date"   is not null and btrim("Payment_End_Date")   <> '' and btrim("Payment_End_Date")   !~ '^\d{4}-\d{2}-\d{2}' and btrim("Payment_End_Date")   !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'

order by column_name, "AMC_Id";
