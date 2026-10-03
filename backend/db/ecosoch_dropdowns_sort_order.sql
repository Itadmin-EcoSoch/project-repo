-- ===========================================================================
-- EcoSoch Project Repository - add Sort_Order to the dropdowns table so the
-- Manage Dropdown Lists screen can rearrange options (up/down) for every field.
-- Run on BOTH staging and production Supabase. Idempotent.
-- ===========================================================================

alter table "dropdowns" add column if not exists "Sort_Order" numeric;

-- Seed an initial order (alphabetical, 0-based) per field key for existing rows.
-- Only fills rows that don't have an order yet, so it's safe to re-run.
with ord as (
  select "Option_Id",
         row_number() over (partition by "Field_Key" order by "Value") - 1 as rn
  from "dropdowns"
  where "Sort_Order" is null
)
update "dropdowns" d
set "Sort_Order" = o.rn
from ord o
where d."Option_Id" = o."Option_Id";

-- Verify.
select "Field_Key", "Sort_Order", "Value"
from "dropdowns"
order by "Field_Key", "Sort_Order"
limit 40;
