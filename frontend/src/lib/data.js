// No seed data — all data will come from the API (Supabase / AppSheet import)

export const SEED_CLIENTS  = [];
export const SEED_PROJECTS = [];
export const AMC_TASKS     = [];

export const STATUS_COLOR = {
  Active:             '#16a34a',
  'On Hold':          '#2563eb',
  Cancelled:          '#dc2626',
  Defaulted:          '#d97706',
  'Under SolarCare':  '#7c3aed',
};

export const STATUS_CLASS = {
  Active:             's-active',
  'On Hold':          's-hold',
  Cancelled:          's-cancelled',
  Defaulted:          's-defaulted',
  'Under SolarCare':  's-solarcare',
};