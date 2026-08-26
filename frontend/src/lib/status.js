/*  frontend/src/lib/status.js
    ----------------------------------------------------------------------------
    Single source of truth for project status.

    THE BUG THIS FIXES
    ------------------
    The sheet holds two different strings that mean exactly the same thing:

        "Defaulted - Project Payment"   <- written by the old AppSheet app  (5 rows)
        "Defaulted"                     <- written by this app's Add/Edit forms

    Every chip bar in the app counted DISTINCT RAW STRINGS, so those two turned
    into two separate "Defaulted" chips (5 and 1) instead of one chip of 6.

    Fix, in two halves:
      1. READ  — fold every status through canonicalStatus() before it is
                 counted, compared or displayed. One chip, no matter how many
                 spellings exist in the sheet.
      2. WRITE — send toSheetStatus() back to the sheet so the app stops
                 inventing new spellings and the two sets converge over time.
--------------------------------------------------------------------------- */

/*  The canonical statuses the UI works in, in the order chips should appear.
    Anything in the sheet that is not on this list still shows up as its own
    chip at the end — nothing is ever silently hidden.                       */
export const STATUS_KEYS = [
  'Active',
  'Under SolarCare',
  'Out of SolarCare',
  'Completed',
  'On Hold',
  'Defaulted',
  'Cancelled',
];

export const NO_STATUS = 'No status';

/*  Collapse a raw sheet value onto one canonical key.

    Rules, in order:
      - blank                     -> "No status"
      - starts with "defaulted"   -> "Defaulted"   (covers "Defaulted - Project
                                                    Payment", "Defaulted - AMC
                                                    Payment", plain "Defaulted")
      - matches a known key apart from case / spacing -> that key
      - anything else             -> passed through unchanged                */
export function canonicalStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NO_STATUS;

  const k = s.toLowerCase().replace(/\s+/g, ' ');
  if (k.startsWith('defaulted')) return 'Defaulted';

  const squash = x => x.toLowerCase().replace(/[\s-]+/g, '');
  const known  = STATUS_KEYS.find(x => squash(x) === squash(k));
  return known || s;
}

/*  Value written BACK to the sheet.

    Keeping the legacy AppSheet string means the ~1,500 existing rows and this
    app agree without a data migration, and any AppSheet bot still watching
    Project_Status keeps firing.

    If you would rather migrate the sheet to the short form, change this to
    'Defaulted' and find/replace the column in the sheet once. Nothing else in
    the app needs to change — reads are already spelling-proof.              */
export const SHEET_STATUS = {
  Defaulted: 'Defaulted - Project Payment',
};

export const toSheetStatus = s => {
  const c = canonicalStatus(s);
  return SHEET_STATUS[c] || c;
};

/*  True when a row belongs under a chip. Chip keys are canonical, so this is
    just a canonical comparison — but going through one helper keeps every
    list, map and dashboard filtering identically.                          */
export const matchesStatus = (rowStatus, chipKey) =>
  chipKey === 'All' || canonicalStatus(rowStatus) === chipKey;

export const isDefaulted = s => canonicalStatus(s) === 'Defaulted';

/*  Sort helper: known statuses in STATUS_KEYS order, unknown ones after. */
export const statusRank = s => {
  const i = STATUS_KEYS.indexOf(canonicalStatus(s));
  return i === -1 ? 99 : i;
};

/* ── display ──────────────────────────────────────────────────────────── */

const CLASSES = {
  'Active':            's-active',
  'Under SolarCare':   's-solarcare',
  'Out of SolarCare':  's-outsolarcare',
  'Completed':         's-completed',
  'On Hold':           's-hold',
  'Defaulted':         's-defaulted',
  'Cancelled':         's-cancelled',
};

/* list / badge palette */
const DOTS = {
  'Active':            '#059669',
  'Under SolarCare':   '#7C3AED',
  'Out of SolarCare':  '#64748B',
  'Completed':         '#0891B2',
  'On Hold':           '#2563EB',
  'Defaulted':         '#D97706',
  'Cancelled':         '#E11D48',
};

/* map-pin palette (slightly punchier greens/reds so pins read at small size) */
const PINS = {
  ...DOTS,
  'Active':    '#16A34A',
  'Cancelled': '#DC2626',
};

export const statusClass  = s => CLASSES[canonicalStatus(s)] || 's-active';
export const statusDot    = s => DOTS[canonicalStatus(s)]    || '#059669';
export const statusPin    = s => PINS[canonicalStatus(s)]    || '#00875A';

/*  Chip and badge text. "No status" renders as an em dash. */
export const statusLabel = s => {
  const c = canonicalStatus(s);
  return c === NO_STATUS ? '\u2014' : c;
};

/*  Chips + counts for a list of projects, already grouped and ordered.
    Every chip bar in the app calls this, so they can never disagree again.  */
export function buildStatusChips(projects = []) {
  const counts = new Map();
  for (const p of projects) {
    const c = canonicalStatus(p?.status);
    counts.set(c, (counts.get(c) || 0) + 1);
  }

  const keys = [...counts.keys()].sort((a, b) => {
    const d = statusRank(a) - statusRank(b);
    return d !== 0 ? d : a.localeCompare(b);
  });

  return [
    { key: 'All', label: 'All', count: projects.length, dot: '#059669', pin: '#00875A' },
    ...keys.map(k => ({
      key: k, label: statusLabel(k), count: counts.get(k),
      dot: statusDot(k), pin: statusPin(k),
    })),
  ];
}