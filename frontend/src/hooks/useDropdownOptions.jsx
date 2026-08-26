/*  frontend/src/hooks/useDropdownOptions.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    Fetches the Admin-managed dropdown values once (Type of Project, Sales
    Lead, Inverter Brand, …), groups them by Field_Key, and hands back a plain
    map that ProjectFormFields.jsx merges into each field's static option
    list — see mergeOptions in lib/projectFields.js.

        const { dropdownOptions, loading, refresh } = useDropdownOptions();
        <ProjectFormFields ... dropdownOptions={dropdownOptions} />

    Used by AddProject.jsx and EditProject.jsx. The Admin screen
    (pages/AdminDropdowns.jsx) does its own fetch instead of this hook — it
    needs the raw rows (ids, the inactive ones too) to manage them, not the
    grouped active-only shape this hook produces for the project form.
--------------------------------------------------------------------------- */

import { useState, useEffect, useCallback } from 'react';
import { getDropdownOptions } from '../lib/api';

export function useDropdownOptions() {
  const [dropdownOptions, setDropdownOptions] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    return getDropdownOptions()
      .then(rows => {
        const grouped = {};
        (Array.isArray(rows) ? rows : []).forEach(r => {
          if (!r || r.active === false) return;
          const key = String(r.field_key || '').trim();
          const val = String(r.value || '').trim();
          if (!key || !val) return;
          (grouped[key] = grouped[key] || []).push(val);
        });
        setDropdownOptions(grouped);
      })
      /*  A failed fetch should not block the form — it just means nobody has
          added anything beyond the built-in lists yet, which is also true the
          very first time this ever runs.                                    */
      .catch(() => setDropdownOptions({}))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return { dropdownOptions, loading, refresh: load };
}