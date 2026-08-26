/*  backend/checkIds.js
    ============================================================================
    Audits the primary-key columns on BOTH tabs:
        Projects.Project_ID
        Clients.Client_Id

        cd backend
        node checkIds.js

    Run it once before switching the generators over, and again afterwards.
    Nothing is written — this script only reads.

    Reported per tab, in order of severity:

      1. NUMBER-COERCION CLASHES — two different ids that db.get() would treat
         as the same row. This is the one that silently serves the wrong
         record, so it is checked first.

         Worth knowing: your Clients tab already contains 93e92018, and
         Number('93e92018') is Infinity. It resolves correctly today only
         because the exact string match runs first. A SECOND client id of the
         same shape would alias to it, and then one of the two becomes
         unreachable. That is exactly what this check finds.

      2. CASE-INSENSITIVE CLASHES — ids identical apart from letter case.
         Google Sheets' own MATCH / VLOOKUP / QUERY cannot tell these apart.
      3. EXACT DUPLICATES
      4. BLANK IDS
      5. FORMAT BREAKDOWN — legacy numeric, legacy hex, or newly generated.
         Legacy rows are expected and fine; this is just so you can see the
         shape of the data at a glance.
    ============================================================================  */

require('dotenv').config();
const db = require('./db/sheets');
const { PROFILES, isValidId } = require('./lib/uniqueId');

const show = (label, items, fmt = String) => {
  console.log(`  ${label}: ${items.length}`);
  items.slice(0, 25).forEach(i => console.log('      ' + fmt(i)));
  if (items.length > 25) console.log(`      ...and ${items.length - 25} more`);
};

async function auditTable(table) {
  const { keyCol } = PROFILES[table];
  const nameCol = table === 'projects' ? 'Project_Name' : 'Client_Name';

  const rows = await db.all(table, { fresh: true });
  console.log(`\n══ ${table.toUpperCase()} — ${keyCol} ══`);
  console.log(`  ${rows.length} rows read.\n`);

  const exact   = new Map();   // id           -> count
  const folded  = new Map();   // lowercase id -> Set of spellings
  const numeric = new Map();   // Number(id)   -> Set of ids
  const blank   = [];
  const fmt     = { legacyNumeric: 0, legacyHex: 0, newFormat: 0, other: 0 };

  for (const r of rows) {
    if (!r) continue;
    const raw  = String(r[keyCol] ?? '').trim();
    const name = r[nameCol] || '(no name)';
    if (!raw) { blank.push(name); continue; }

    exact.set(raw, (exact.get(raw) || 0) + 1);

    const key = raw.toLowerCase();
    if (!folded.has(key)) folded.set(key, new Set());
    folded.get(key).add(raw);

    const n = Number(raw);
    if (!Number.isNaN(n)) {
      if (!numeric.has(n)) numeric.set(n, new Set());
      numeric.get(n).add(raw);
    }

    if (/^\d+$/.test(raw) && raw.length !== 8)  fmt.legacyNumeric++;
    else if (/^[0-9a-fA-F]{8}$/.test(raw))      fmt.legacyHex++;
    else if (isValidId(table, raw))             fmt.newFormat++;
    else                                        fmt.other++;
  }

  const dupExact  = [...exact].filter(([, n]) => n > 1);
  const dupFolded = [...folded].filter(([, s]) => s.size > 1);
  const dupNumber = [...numeric].filter(([, s]) => s.size > 1);
  const coercible = [...numeric].map(([, s]) => [...s]).flat();

  show('NUMBER-COERCION CLASHES (db.get returns the wrong row)', dupNumber,
       ([n, s]) => `${[...s].join('  ==  ')}   both parse to ${n}`);
  show('CASE-INSENSITIVE CLASHES', dupFolded,
       ([k, s]) => `${k}   spelled as: ${[...s].join(', ')}`);
  show('EXACT DUPLICATES', dupExact, ([id, n]) => `${id}  x${n}`);
  show('BLANK IDS', blank);

  console.log(`  ids that Number() can parse (harmless alone, risky in pairs): ${coercible.length}`);
  coercible.slice(0, 10).forEach(x => console.log(`      ${x}  ->  ${Number(x)}`));
  if (coercible.length > 10) console.log(`      ...and ${coercible.length - 10} more`);

  console.log('\n  FORMAT BREAKDOWN');
  console.log(`      legacy numeric (563447 style) : ${fmt.legacyNumeric}`);
  console.log(`      legacy hex     (8 hex chars)  : ${fmt.legacyHex}`);
  console.log(`      new format                    : ${fmt.newFormat}`);
  console.log(`      other                         : ${fmt.other}`);

  return !dupNumber.length && !dupFolded.length && !dupExact.length && !blank.length;
}

(async () => {
  const okProjects = await auditTable('projects');
  const okClients  = await auditTable('clients');

  console.log('\n' + '─'.repeat(60));
  console.log(okProjects && okClients
    ? 'CLEAN — every id on both tabs resolves to exactly one row.'
    : 'ISSUES FOUND — see the rows listed above.');
  process.exit(okProjects && okClients ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });