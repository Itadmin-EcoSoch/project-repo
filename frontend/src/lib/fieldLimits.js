/*  frontend/src/lib/fieldLimits.js  — NEW FILE
    ----------------------------------------------------------------------------
    One place that decides how long a field may be and which characters it will
    accept. Imported by formKit.jsx, AddClient.jsx, EditClient.jsx and
    ProjectFormFields.jsx, so a limit can never be enforced on one screen and
    forgotten on another.

    ── THE LIMITS ───────────────────────────────────────────────────────────
        single-line text   100 characters
        description / notes / address   1000 characters
        mobile             20 characters, including the country code

    ── WHY CHARACTERS ARE STRIPPED AT ALL ───────────────────────────────────
    Two separate hazards, and they need different rules.

    1. GOOGLE SHEETS READS A LEADING = + - @ AS A FORMULA.
       This is not theoretical — it already happened here. A mobile typed as
       "+91 98765 43210" was written into the cell as =+91 98765 43210, which
       does not parse, so the cell evaluated to #ERROR! and the number was gone
       from every screen that read it. Code.gs now guards = and + with a
       leading apostrophe (textSafe_), but a leading - is still unguarded, and
       relying on the far end to catch it is one deploy away from breaking
       again. Stripping it here means the value is never dangerous in the first
       place.

    2. SOME CHARACTERS BREAK A DRIVE FILENAME OR AN HTML EMAIL.
       Uploaded files are named after project fields, and the New Order Form
       renders those same values into an HTML table. \ / : * ? " < > | are
       illegal in a Drive filename, and < > " leak into the email markup.

    ── WHAT IS DELIBERATELY *NOT* STRIPPED ──────────────────────────────────
    Indian addresses genuinely start with # and contain , . - / & ( ) — for
    example "#22, Sector A, 3rd Cross, Marathahalli - 37". 342 rows in your
    Site_Address column and 333 in Client_Address begin with #. A blanket
    special-character filter would mangle every one of them, so the rule is
    narrow on purpose: block what is actually dangerous, allow what real data
    contains.
--------------------------------------------------------------------------- */

/** Single-line text: names, tags, GSTIN, Deal ID, area, billing name. */
export const TEXT_MAX = 100;

/** Anything typed into a textarea: addresses, comments, notes, commitments. */
export const TEXTAREA_MAX = 1000;

/** Mobile, INCLUDING the dial code and the space — "+91 9876543210" is 14. */
export const PHONE_MAX = 20;

/** Email is its own thing; RFC caps the whole address at 254. */
export const EMAIL_MAX = 254;

/*  Illegal in a Drive filename, or unsafe once rendered into the New Order
    Form's HTML. Removed wherever they appear, not just at the start.
    Forward slash is NOT here — "12/A, 2nd Main" is a normal address.       */
const UNSAFE_ANYWHERE = /[<>"\\|*?\u0000-\u001F\u007F]/g;

/*  A leading one of these turns the cell into a formula. Only stripped from
    the FRONT — "Ram & Co" and "3-Phase" keep their punctuation.            */
const FORMULA_PREFIX_SINGLE = /^[=+\-@\s]+/;

/*  Same idea for a textarea, minus the hyphen: people write bulleted notes
    starting "- fix the earthing", and losing that dash every time would be
    its own small annoyance. = + @ are still blocked.                       */
const FORMULA_PREFIX_MULTI = /^[=+@\s]+/;

/**
 * Clean a value as the user types.
 *
 * Called on every keystroke, so it must never do anything that makes typing
 * feel wrong. In particular it does NOT trim trailing spaces — doing that on
 * change makes it impossible to type "John Smith", because the space after
 * "John" is removed before you reach the S. Trailing whitespace is dealt with
 * on blur instead, by tidyOnBlur below.
 *
 * @param {*} raw            whatever came out of the input
 * @param {number} max       character ceiling
 * @param {{multiline?: boolean}} opts
 * @returns {string}
 */
export function sanitizeText(raw, max = TEXT_MAX, { multiline = false } = {}) {
  let s = String(raw ?? '');

  s = s.replace(UNSAFE_ANYWHERE, '');
  s = s.replace(multiline ? FORMULA_PREFIX_MULTI : FORMULA_PREFIX_SINGLE, '');

  /*  A textarea keeps its newlines; a single-line field folds them into
      spaces, because a pasted multi-line address in a one-line box otherwise
      arrives in the sheet with invisible breaks in it.                     */
  if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');

  if (s.length > max) s = s.slice(0, max);
  return s;
}

/** Collapse runs of spaces and trim. Safe on blur, wrong on change. */
export function tidyOnBlur(raw) {
  return String(raw ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Digits only, for the number half of a phone field.
 * The dial code carries the +, so the number itself never needs one.
 */
export function sanitizePhoneDigits(raw, max = PHONE_MAX) {
  return String(raw ?? '').replace(/\D+/g, '').slice(0, Math.max(0, max));
}

/**
 * Email: no spaces, no angle brackets, lower-cased.
 * Deliberately does NOT strip a leading @ — an address cannot start with one
 * anyway, and the format check on save is the right place to say so.
 */
export function sanitizeEmail(raw, max = EMAIL_MAX) {
  return String(raw ?? '')
    .replace(/[\s<>"\\|*?,;:()\[\]]/g, '')
    .slice(0, max)
    .toLowerCase();
}

/**
 * The limit for a field spec from lib/projectFields.js.
 * An explicit f.maxLength always wins; otherwise the type decides.
 */
export function maxLengthFor(field = {}) {
  if (Number.isFinite(field.maxLength)) return field.maxLength;
  if (field.type === 'textarea') return TEXTAREA_MAX;
  if (field.inputType === 'email') return EMAIL_MAX;
  return TEXT_MAX;
}

/**
 * "94 of 100" style counter text — but only once the user is close enough for
 * it to matter. A counter under every one of sixty fields is noise; a counter
 * that appears at 80% is a warning.
 */
export function counterFor(value, max, showFrom = 0.8) {
  const len = String(value ?? '').length;
  if (len < max * showFrom) return null;
  return { len, max, over: len >= max };
}