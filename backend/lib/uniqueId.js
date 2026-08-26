/*  backend/lib/uniqueId.js
    ============================================================================
    Generates the primary key for every NEW row the app creates:
        Project_ID  on the Projects tab
        Client_Id   on the Clients tab

    Both used AppSheet's UNIQUEID(). Existing rows are never touched — this
    only decides what new records get from now on.

    ---------------------------------------------------------------------------
    TWO FORMATS, BECAUSE THE SHEET ALREADY HAS TWO

    The live EcoSoch_Database follows a convention worth preserving:

        Projects tab   AD5E1004  94C2038A  6DA3A98B  464C20DB   uppercase
        Clients  tab   c8b6b032  93e92018  305e1c5d  6b1c87a0   lowercase

    So the two profiles differ deliberately:

      projects   8 chars. First character a digit or UPPERCASE letter, the
                 remaining seven any digit / uppercase / lowercase.
                 e.g.  R7kmQ2xv   4Bp8Ln3z   XcV7b1Ns
                 The restricted first character is cosmetic: an id starting on
                 a lowercase letter reads badly at the top of a project page
                 and in email subject lines.

      clients    8 chars, any digit / uppercase / lowercase in every position,
                 including the first.
                 e.g.  k3Rm9qXt   7bVn2Lp4   zQ8fH1cW
                 Client ids are internal plumbing — they appear in URLs and
                 foreign keys, not on printed documents — so the extra
                 freedom costs nothing and matches the lowercase-hex ids the
                 tab already holds.

    Keyspaces:
        projects  36 x 62^7 = 126,778,125,823,488   (126 trillion)
        clients        62^8 = 218,340,105,584,896   (218 trillion)
    The old 8-hex AppSheet format had 4.29 billion, so both are vastly larger.
    ---------------------------------------------------------------------------

    RULE 1 — never a value JavaScript can parse as a number.

    db.get() in backend/db/sheets.js compares ids as numbers when the string
    comparison fails. Four families of 8-character strings survive Number(),
    and ALL of them are reachable in both profiles:

        Number('42156161') -> 42156161      all digits
        Number('0xcE7BC8') -> 13532104      0x / 0X hexadecimal literal
        Number('5E123456') -> 5.0e+123456   E / e scientific notation
        Number('Infinity') -> Infinity      the literal word, capital I

    Any of these can silently match the WRONG row: two ids that both overflow
    to Infinity compare EQUAL to each other. Only a few ids per million land
    here, but rejecting them costs nothing. Number() is tested directly rather
    than pattern-matched, because no regex cleanly expresses "JavaScript cannot
    parse this as a number".

    RULE 2 — uniqueness is checked CASE-INSENSITIVELY.

    Mixed case means 'R7kmQ2xv' and 'R7KMq2XV' are different strings. They are
    still treated as a collision, because:

      · Google Sheets' own MATCH / VLOOKUP / QUERY are case-insensitive, so two
        ids differing only by case would break sheet-side formulas and any
        surviving AppSheet logic.
      · Nobody reading an id off a screen, an email or a printed PO can be
        expected to preserve case.
      · It lets db.get() stay case-insensitive, which is what makes the legacy
        mixed-case ids (43126c00 and E6F2C552 side by side) resolve.

    RULE 3 — crypto, not Math.random.
    Math.random is not a cryptographic RNG and repeats far more readily across
    restarted or forked processes. crypto.randomInt is uniform and unbiased.
    ============================================================================  */

const crypto = require('crypto');
const db     = require('../db/sheets');

const DIGITS      = '0123456789';
const UPPER       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER       = 'abcdefghijklmnopqrstuvwxyz';

const BASE62      = DIGITS + UPPER + LOWER;   // 62 — any position, any case
const NO_LOWER    = DIGITS + UPPER;           // 36 — digits and capitals only

const ID_LENGTH    = 8;
const MAX_ATTEMPTS = 50;

/**
 * One profile per table. `first` is the alphabet for character 1, `rest` for
 * characters 2-8, and `shape` is the matching validity pattern.
 *
 * To add a table later (tickets, AMC contracts), add an entry here — the rest
 * of the module is generic.
 */
/*  Every table whose primary key this app mints.

    Before this, only projects and clients were covered. The other six were
    left to Apps Script's hex8_(), which generates an id WITHOUT looking at
    what is already in the column — so a duplicate was possible and would have
    been silent. Tickets, AMC contracts, AMC tasks, AMC payments, order log
    and status log now all go through the same checked path.

    Users and Launcher are deliberately absent: their keys are Email and
    App_Id, real values rather than generated ones.                        */
const ANY_CASE = {
  first: BASE62, rest: BASE62,
  shape: /^[0-9A-Za-z]{8}$/,
  label: 'any alphanumeric, upper or lower, in every position',
};

/*  ── UPPERCASE ONLY — Client_Id and Project_ID ────────────────────────────

    8 characters, every one of them a digit or a CAPITAL letter. No lowercase
    anywhere, including the first character.

        e.g.  R7KMQ2XV   4BP8LN3Z   XCV7B1NS

    These two ids are the ones people actually see and handle. Project_ID goes
    into the New Order Form subject line, onto the printed PO and into the
    Drive filename of every upload (PROJECTID.Column.stamp.ext). Client_Id
    appears in URLs. A single case makes them readable, dictatable over the
    phone, and impossible to get wrong by re-typing.

    It also matches what the sheet already holds: 1,040 of the 1,542
    Project_IDs are already 8 uppercase characters. This makes the rule the
    convention rather than a third variant alongside it.

    KEYSPACE: 36^8 = 2,821,109,907,456 — 2.8 trillion. Down from base62's 218
    trillion, but against 1,542 projects and 1,501 clients that is not a
    number worth caring about, and every id is checked against the sheet
    anyway (see newUniqueId below).

    RULE 1 STILL MATTERS, AND STILL WORKS. Dropping lowercase does not make
    the ids safe from Number():

        Number('42156161') -> 42156161      all digits
        Number('0XCE7BC8') -> 13532104      0X is a hex literal with a CAPITAL X
        Number('5E123456') -> Infinity      E notation, capital E

    All three are reachable from this alphabet. Measured over 500,000 draws,
    0.0068% of candidates are rejected for this — 34 in half a million — so the
    200-attempt loop in mintId has room to spare. The only family that does go
    away is the literal word 'Infinity', which needs lowercase letters:
    Number('INFINITY') is NaN.

    RULE 2 ALSO STILL MATTERS. takenIds() lower-cases everything before
    comparing, so a new 'A1B2C3D4' is treated as a collision with an existing
    lowercase 'a1b2c3d4'. That is deliberate: 1,043 Client_Ids in the sheet are
    lowercase hex from AppSheet, and Sheets' own MATCH/VLOOKUP are
    case-insensitive, so two ids differing only by case would break formulas.
    ──────────────────────────────────────────────────────────────────────── */
const UPPER_ONLY = {
  first: NO_LOWER, rest: NO_LOWER,
  shape: /^[0-9A-Z]{8}$/,
  label: 'digits and capital letters only, in every position',
};

const PROFILES = {
  /*  The two ids people read, type and say out loud. */
  projects: { keyCol: 'Project_ID', ...UPPER_ONLY },
  clients : { keyCol: 'Client_Id',  ...UPPER_ONLY },

  /*  Everything below is internal plumbing — these ids live in URLs and
      foreign keys, never on a printed document — so the full any-case
      alphabet is used. Change a line here to alter one table's shape.   */
  tickets      : { keyCol: 'Ticket_Id',   ...ANY_CASE },
  amc_contracts: { keyCol: 'AMC_Id',      ...ANY_CASE },
  amc_tasks    : { keyCol: 'AMC_Task_Id', ...ANY_CASE },
  amc_payments : { keyCol: 'Payment_Id',  ...ANY_CASE },
  order_log    : { keyCol: 'Order_Id',    ...ANY_CASE },
  status_log   : { keyCol: 'Log_Id',      ...ANY_CASE },
};

function profile(table) {
  const p = PROFILES[table];
  if (!p) throw new Error(`uniqueId: no profile configured for table "${table}"`);
  return p;
}

/** Right shape for this table AND not parseable as a number. See RULE 1. */
function isValidId(table, v) {
  const s = String(v ?? '').trim();
  return profile(table).shape.test(s) && Number.isNaN(Number(s));
}

/** Convenience wrappers, used by checkIds.js and available to routes. */
const isValidProjectId = v => isValidId('projects', v);
const isValidClientId  = v => isValidId('clients',  v);

/** One raw candidate for this table. May be rejected by mintId. */
function rawId(table) {
  const p = profile(table);
  let out = p.first[crypto.randomInt(p.first.length)];
  for (let i = 1; i < ID_LENGTH; i++) {
    out += p.rest[crypto.randomInt(p.rest.length)];
  }
  return out;
}

/**
 * A well-formed id for this table, ignoring what is already in the sheet.
 * Rejection-sampled rather than patched in place, which keeps every valid id
 * equally likely.
 */
function mintId(table = 'projects') {
  for (let i = 0; i < 200; i++) {
    const id = rawId(table);
    if (isValidId(table, id)) return id;
  }
  throw new Error(`uniqueId: RNG produced no valid candidate for "${table}"`);
}

/**
 * Every id currently in this tab's key column, lower-cased for comparison.
 * Includes all the legacy AppSheet ids (563447, 44d3cfd9, E6F2C552, 93e92018),
 * so a new id can never collide with an old one.
 *
 * Defaults to fresh: true — a LIVE read, bypassing the cache.
 *
 * This matters. backend/db/sheets.js serves cached tabs for up to 15 minutes
 * (MAX_STALE_MS) and refreshes in the background. If someone adds a row
 * directly in the Google Sheet, or a second backend instance creates one, a
 * cached read would not see it and the "unique" check would be running against
 * stale data. Records are created a few times a day, not a few times a second,
 * so one extra round-trip is the right trade.
 */
async function takenIds(table = 'projects', { fresh = true } = {}) {
  const col  = profile(table).keyCol;
  const rows = await db.all(table, { fresh });
  const set  = new Set();
  for (const r of rows) {
    if (!r) continue;
    const v = String(r[col] ?? '').trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

/**
 * The function the routes call. Works for any table in PROFILES.
 *
 * Randomness alone is not enough: 500,000 draws from a 4-billion keyspace
 * produced 38 duplicates in testing (the birthday paradox). Every existing id
 * in the tab is loaded and checked against, so a new id can never be one that
 * already exists.
 *
 * @param {string} table  'projects' | 'clients'
 * @param {{ fresh?: boolean }} opts  pass { fresh: false } only when minting
 *                                    ids in a tight loop
 */
async function newUniqueId(table = 'projects', opts = {}) {
  const taken = await takenIds(table, opts);

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const id = mintId(table);
    if (!taken.has(id.toLowerCase())) return id;
  }
  throw new Error(
    `uniqueId: could not allocate a unique ${profile(table).keyCol} after ` +
    `${MAX_ATTEMPTS} attempts (${taken.size} ids already in use)`
  );
}

/**
 * MANY ids at once, from a SINGLE read of the sheet.
 *
 * This exists for lib/amcCreate.js. Creating a 5-year cleaning contract
 * generates one contract, five payments and up to 120 task rows. Calling
 * newUniqueId per row would mean 120 live reads of the AMC_Tasks tab — at the
 * 2-3 seconds each that tab currently takes, that is several minutes for one
 * contract, and a lock held the whole time.
 *
 * One read, then mint locally, checking each new id against both the sheet and
 * the ids already handed out in this batch.
 *
 * @param {string} table
 * @param {number} count
 * @param {{ fresh?: boolean }} opts
 * @returns {Promise<string[]>}
 */
async function newUniqueIds(table, count, opts = {}) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return [];

  const taken = await takenIds(table, opts);
  const out   = [];

  for (let i = 0; i < n; i++) {
    let id = null;
    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      const candidate = mintId(table);
      if (!taken.has(candidate.toLowerCase())) { id = candidate; break; }
    }
    if (!id) {
      throw new Error(
        `uniqueId: could not allocate ${n} unique ${profile(table).keyCol} values ` +
        `(failed on number ${i + 1} of ${n})`
      );
    }
    taken.add(id.toLowerCase());   // so the rest of this batch avoids it too
    out.push(id);
  }
  return out;
}

/** Project_ID for a new project. Digit or capital first. e.g. "R7kmQ2xv" */
const newProjectId = (opts = {}) => newUniqueId('projects', opts);

/** Client_Id for a new client. Any case anywhere. e.g. "k3Rm9qXt" */
const newClientId  = (opts = {}) => newUniqueId('clients',  opts);

/** One id each for the remaining tables. */
const newTicketId      = (opts = {}) => newUniqueId('tickets',       opts);
const newAmcId         = (opts = {}) => newUniqueId('amc_contracts', opts);
const newAmcTaskId     = (opts = {}) => newUniqueId('amc_tasks',     opts);
const newAmcPaymentId  = (opts = {}) => newUniqueId('amc_payments',  opts);
const newOrderId       = (opts = {}) => newUniqueId('order_log',     opts);
const newStatusLogId   = (opts = {}) => newUniqueId('status_log',    opts);

module.exports = {
  newUniqueId, newUniqueIds,
  newProjectId, newClientId, newTicketId,
  newAmcId, newAmcTaskId, newAmcPaymentId,
  newOrderId, newStatusLogId,
  takenIds, mintId,
  isValidId, isValidProjectId, isValidClientId,
  PROFILES,
};