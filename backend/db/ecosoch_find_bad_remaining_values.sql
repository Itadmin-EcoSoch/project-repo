-- Find non-convertible values in AMC_Payment_Schedule, AMC_Tasks_Schedule and
-- Tickets before the type-change script. Lists: table.column, id, bad value.
-- "Bad" = non-empty and not a clean number / not an ISO or DD-MM-YYYY date.

-- ── AMC_Payment_Schedule ─────────────────────────────────────────────────────
select 'AMC_Payment_Schedule.Payment_Amount' as where_, "Payment_Id"::text as id, "Payment_Amount" as bad_value
  from "AMC_Payment_Schedule" where "Payment_Amount" is not null and replace(btrim("Payment_Amount"),',','') <> '' and replace(btrim("Payment_Amount"),',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all
select 'AMC_Payment_Schedule.Payment_Due_Date', "Payment_Id"::text, "Payment_Due_Date"
  from "AMC_Payment_Schedule" where "Payment_Due_Date" is not null and btrim("Payment_Due_Date") <> '' and btrim("Payment_Due_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Payment_Due_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'

-- ── AMC_Tasks_Schedule ───────────────────────────────────────────────────────
union all
select 'AMC_Tasks_Schedule.AMC_Due_Date', "AMC_Task_Id"::text, "AMC_Due_Date"
  from "AMC_Tasks_Schedule" where "AMC_Due_Date" is not null and btrim("AMC_Due_Date") <> '' and btrim("AMC_Due_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("AMC_Due_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'

-- ── Tickets — numbers ────────────────────────────────────────────────────────
union all
select 'Tickets.Service_Charge', "Ticket_Id"::text, "Service_Charge"
  from "Tickets" where "Service_Charge" is not null and replace(btrim("Service_Charge"),',','') <> '' and replace(btrim("Service_Charge"),',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all
select 'Tickets.Material_Charge', "Ticket_Id"::text, "Material_Charge"
  from "Tickets" where "Material_Charge" is not null and replace(btrim("Material_Charge"),',','') <> '' and replace(btrim("Material_Charge"),',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all
select 'Tickets.Total_Charge', "Ticket_Id"::text, "Total_Charge"
  from "Tickets" where "Total_Charge" is not null and replace(btrim("Total_Charge"),',','') <> '' and replace(btrim("Total_Charge"),',','') !~ '^-?[0-9]+(\.[0-9]+)?$'
union all
select 'Tickets.Ticket_Warranty_Period', "Ticket_Id"::text, "Ticket_Warranty_Period"
  from "Tickets" where "Ticket_Warranty_Period" is not null and replace(btrim("Ticket_Warranty_Period"),',','') <> '' and replace(btrim("Ticket_Warranty_Period"),',','') !~ '^-?[0-9]+(\.[0-9]+)?$'

-- ── Tickets — dates ──────────────────────────────────────────────────────────
union all
select 'Tickets.Ticket_Start_Date', "Ticket_Id"::text, "Ticket_Start_Date"
  from "Tickets" where "Ticket_Start_Date" is not null and btrim("Ticket_Start_Date") <> '' and btrim("Ticket_Start_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Ticket_Start_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all
select 'Tickets.Ticket_Due_Date', "Ticket_Id"::text, "Ticket_Due_Date"
  from "Tickets" where "Ticket_Due_Date" is not null and btrim("Ticket_Due_Date") <> '' and btrim("Ticket_Due_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Ticket_Due_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all
select 'Tickets.Ticket_Warranty_Start_Date', "Ticket_Id"::text, "Ticket_Warranty_Start_Date"
  from "Tickets" where "Ticket_Warranty_Start_Date" is not null and btrim("Ticket_Warranty_Start_Date") <> '' and btrim("Ticket_Warranty_Start_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Ticket_Warranty_Start_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all
select 'Tickets.Ticket_Warranty_End_Date', "Ticket_Id"::text, "Ticket_Warranty_End_Date"
  from "Tickets" where "Ticket_Warranty_End_Date" is not null and btrim("Ticket_Warranty_End_Date") <> '' and btrim("Ticket_Warranty_End_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Ticket_Warranty_End_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all
select 'Tickets.Created_Date', "Ticket_Id"::text, "Created_Date"
  from "Tickets" where "Created_Date" is not null and btrim("Created_Date") <> '' and btrim("Created_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Created_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
union all
select 'Tickets.Last_Updated_Date', "Ticket_Id"::text, "Last_Updated_Date"
  from "Tickets" where "Last_Updated_Date" is not null and btrim("Last_Updated_Date") <> '' and btrim("Last_Updated_Date") !~ '^\d{4}-\d{2}-\d{2}' and btrim("Last_Updated_Date") !~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'

order by where_, id;
