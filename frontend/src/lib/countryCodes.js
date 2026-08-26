/*  frontend/src/lib/countryCodes.js  — REPLACES THE PREVIOUS VERSION
    ----------------------------------------------------------------------------
    Dial codes for the mobile field.

    ── WHAT CHANGED IN THIS VERSION ─────────────────────────────────────────
    1. EVERY country, not a shortlist. The previous version had 77, which was
       the countries EcoSoch deals with today plus the obvious big ones. That
       is a list somebody has to maintain, and the first client from a country
       nobody thought of gets recorded wrong. All of them is less work than
       most of them.

    2. `aka` — extra words that match in the search box but are not shown.
       This is what makes typing "Dubai" find the United Arab Emirates,
       "Holland" find the Netherlands, "Burma" find Myanmar and "UK" find the
       United Kingdom. A country's own name is often not what the person
       typing is thinking of.

    3. SHARED DIAL CODES ARE ONE ENTRY, NOT TWO.
       +1 is the United States AND Canada AND most of the Caribbean; +7 is
       Russia AND Kazakhstan. The value stored is a dial code, so two entries
       sharing one code cannot be told apart on the way back — pick "Canada",
       save, reopen, and it would read "United States". Merging them means the
       label never contradicts the data. Search still finds either, via `aka`.

    4. `digits` — how many digits a national mobile number has there, so the
       number box stops at the right place instead of at whatever the
       20-character column ceiling leaves over. Filled in where it is
       unambiguous; left out where the national plan genuinely varies, which
       falls back to FALLBACK_DIGITS.

    ── HOW THE VALUE IS STORED ──────────────────────────────────────────────
    One string, exactly as before: "+91 9876543210".

    Client_Mobile is a single column with 1,501 rows already in it. Splitting
    it into two columns would mean a migration, a Code.gs change and an edit to
    mapping.js. Keeping one string means the sheet, the API, the New Order
    email and every existing row carry on working untouched.

    ── THE LEADING PLUS ─────────────────────────────────────────────────────
    "+91 …" starts with a +, which Google Sheets reads as the start of a
    formula. That is the exact bug that turned mobile numbers into #ERROR!
    across the Clients tab. It is already handled: textSafe_ in Code.gs v5
    prefixes a leading = or + with an apostrophe, and mapping.js lists
    Client_Mobile and Phone in its TEXT set so the value is never coerced to a
    number.
--------------------------------------------------------------------------- */

/** The default for every new client and every new project. */
export const DEFAULT_DIAL = '+91';

/*  Used when a country has no `digits` of its own. Deliberately loose — a
    validator stricter than reality just blocks a real customer with no way
    round it.                                                                */
export const FALLBACK_DIGITS = 15;

/*  name    what the picker shows
    dial    what is stored
    digits  national mobile length; omit when the plan varies
    aka     extra search words — cities, old names, abbreviations           */
export const COUNTRIES = [
  /* ── pinned to the top: India first, then where EcoSoch actually works ── */
  { iso:'IN', name:'India',                  dial:'+91',  digits:10, aka:'bharat bengaluru bangalore mumbai delhi', top:true },
  { iso:'AE', name:'United Arab Emirates',   dial:'+971', digits:9,  aka:'uae dubai abu dhabi sharjah ajman emirates', top:true },
  { iso:'SA', name:'Saudi Arabia',           dial:'+966', digits:9,  aka:'ksa riyadh jeddah dammam', top:true },
  { iso:'OM', name:'Oman',                   dial:'+968', digits:8,  aka:'muscat salalah', top:true },
  { iso:'QA', name:'Qatar',                  dial:'+974', digits:8,  aka:'doha', top:true },
  { iso:'KW', name:'Kuwait',                 dial:'+965', digits:8,  aka:'kuwait city', top:true },
  { iso:'BH', name:'Bahrain',                dial:'+973', digits:8,  aka:'manama', top:true },
  { iso:'SG', name:'Singapore',              dial:'+65',  digits:8,  top:true },
  { iso:'US', name:'United States / Canada', dial:'+1',   digits:10, aka:'usa us america united states canada toronto new york jamaica bahamas barbados trinidad puerto rico dominican', top:true },
  { iso:'GB', name:'United Kingdom',         dial:'+44',  digits:10, aka:'uk britain england scotland wales london', top:true },
  { iso:'AU', name:'Australia',              dial:'+61',  digits:9,  aka:'sydney melbourne', top:true },

  /* ── everywhere else, alphabetically ── */
  { iso:'AF', name:'Afghanistan',            dial:'+93',  digits:9 },
  { iso:'AL', name:'Albania',                dial:'+355', digits:9 },
  { iso:'DZ', name:'Algeria',                dial:'+213', digits:9 },
  { iso:'AD', name:'Andorra',                dial:'+376', digits:6 },
  { iso:'AO', name:'Angola',                 dial:'+244', digits:9 },
  { iso:'AR', name:'Argentina',              dial:'+54',  digits:10, aka:'buenos aires' },
  { iso:'AM', name:'Armenia',                dial:'+374', digits:8 },
  { iso:'AW', name:'Aruba',                  dial:'+297', digits:7 },
  { iso:'AT', name:'Austria',                dial:'+43',  aka:'vienna' },
  { iso:'AZ', name:'Azerbaijan',             dial:'+994', digits:9,  aka:'baku' },
  { iso:'BD', name:'Bangladesh',             dial:'+880', digits:10, aka:'dhaka' },
  { iso:'BY', name:'Belarus',                dial:'+375', digits:9 },
  { iso:'BE', name:'Belgium',                dial:'+32',  digits:9,  aka:'brussels' },
  { iso:'BZ', name:'Belize',                 dial:'+501', digits:7 },
  { iso:'BJ', name:'Benin',                  dial:'+229', digits:8 },
  { iso:'BT', name:'Bhutan',                 dial:'+975', digits:8,  aka:'thimphu' },
  { iso:'BO', name:'Bolivia',                dial:'+591', digits:8 },
  { iso:'BA', name:'Bosnia and Herzegovina', dial:'+387', digits:8,  aka:'sarajevo' },
  { iso:'BW', name:'Botswana',               dial:'+267', digits:8 },
  { iso:'BR', name:'Brazil',                 dial:'+55',  digits:11, aka:'sao paulo rio brasil' },
  { iso:'BN', name:'Brunei',                 dial:'+673', digits:7 },
  { iso:'BG', name:'Bulgaria',               dial:'+359', digits:9,  aka:'sofia' },
  { iso:'BF', name:'Burkina Faso',           dial:'+226', digits:8 },
  { iso:'BI', name:'Burundi',                dial:'+257', digits:8 },
  { iso:'KH', name:'Cambodia',               dial:'+855', aka:'phnom penh' },
  { iso:'CM', name:'Cameroon',               dial:'+237', digits:9 },
  { iso:'CV', name:'Cape Verde',             dial:'+238', digits:7,  aka:'cabo verde' },
  { iso:'CF', name:'Central African Republic', dial:'+236', digits:8 },
  { iso:'TD', name:'Chad',                   dial:'+235', digits:8 },
  { iso:'CL', name:'Chile',                  dial:'+56',  digits:9,  aka:'santiago' },
  { iso:'CN', name:'China',                  dial:'+86',  digits:11, aka:'beijing shanghai prc' },
  { iso:'CO', name:'Colombia',               dial:'+57',  digits:10, aka:'bogota' },
  { iso:'KM', name:'Comoros',                dial:'+269', digits:7 },
  { iso:'CG', name:'Congo (Republic)',       dial:'+242', digits:9,  aka:'brazzaville' },
  { iso:'CD', name:'Congo (DR)',             dial:'+243', digits:9,  aka:'kinshasa zaire drc' },
  { iso:'CR', name:'Costa Rica',             dial:'+506', digits:8 },
  { iso:'CI', name:'Côte d’Ivoire',          dial:'+225', digits:10, aka:'ivory coast abidjan' },
  { iso:'HR', name:'Croatia',                dial:'+385', digits:9,  aka:'zagreb' },
  { iso:'CU', name:'Cuba',                   dial:'+53',  digits:8,  aka:'havana' },
  { iso:'CY', name:'Cyprus',                 dial:'+357', digits:8,  aka:'nicosia' },
  { iso:'CZ', name:'Czechia',                dial:'+420', digits:9,  aka:'czech republic prague' },
  { iso:'DK', name:'Denmark',                dial:'+45',  digits:8,  aka:'copenhagen' },
  { iso:'DJ', name:'Djibouti',               dial:'+253', digits:8 },
  { iso:'EC', name:'Ecuador',                dial:'+593', digits:9,  aka:'quito' },
  { iso:'EG', name:'Egypt',                  dial:'+20',  digits:10, aka:'cairo' },
  { iso:'SV', name:'El Salvador',            dial:'+503', digits:8 },
  { iso:'GQ', name:'Equatorial Guinea',      dial:'+240', digits:9 },
  { iso:'ER', name:'Eritrea',                dial:'+291', digits:7 },
  { iso:'EE', name:'Estonia',                dial:'+372', digits:8,  aka:'tallinn' },
  { iso:'SZ', name:'Eswatini',               dial:'+268', digits:8,  aka:'swaziland' },
  { iso:'ET', name:'Ethiopia',               dial:'+251', digits:9,  aka:'addis ababa' },
  { iso:'FJ', name:'Fiji',                   dial:'+679', digits:7 },
  { iso:'FI', name:'Finland',                dial:'+358', aka:'helsinki' },
  { iso:'FR', name:'France',                 dial:'+33',  digits:9,  aka:'paris' },
  { iso:'GA', name:'Gabon',                  dial:'+241', digits:8 },
  { iso:'GM', name:'Gambia',                 dial:'+220', digits:7 },
  { iso:'GE', name:'Georgia',                dial:'+995', digits:9,  aka:'tbilisi' },
  { iso:'DE', name:'Germany',                dial:'+49',  digits:11, aka:'berlin munich deutschland frankfurt' },
  { iso:'GH', name:'Ghana',                  dial:'+233', digits:9,  aka:'accra' },
  { iso:'GR', name:'Greece',                 dial:'+30',  digits:10, aka:'athens' },
  { iso:'GT', name:'Guatemala',              dial:'+502', digits:8 },
  { iso:'GN', name:'Guinea',                 dial:'+224', digits:9 },
  { iso:'GW', name:'Guinea-Bissau',          dial:'+245', digits:9 },
  { iso:'GY', name:'Guyana',                 dial:'+592', digits:7 },
  { iso:'HT', name:'Haiti',                  dial:'+509', digits:8 },
  { iso:'HN', name:'Honduras',               dial:'+504', digits:8 },
  { iso:'HK', name:'Hong Kong',              dial:'+852', digits:8 },
  { iso:'HU', name:'Hungary',                dial:'+36',  digits:9,  aka:'budapest' },
  { iso:'IS', name:'Iceland',                dial:'+354', digits:7,  aka:'reykjavik' },
  { iso:'ID', name:'Indonesia',              dial:'+62',  aka:'jakarta bali' },
  { iso:'IR', name:'Iran',                   dial:'+98',  digits:10, aka:'tehran persia' },
  { iso:'IQ', name:'Iraq',                   dial:'+964', digits:10, aka:'baghdad' },
  { iso:'IE', name:'Ireland',                dial:'+353', digits:9,  aka:'dublin eire' },
  { iso:'IL', name:'Israel',                 dial:'+972', digits:9,  aka:'tel aviv jerusalem' },
  { iso:'IT', name:'Italy',                  dial:'+39',  digits:10, aka:'rome milan italia' },
  { iso:'JP', name:'Japan',                  dial:'+81',  digits:10, aka:'tokyo osaka' },
  { iso:'JO', name:'Jordan',                 dial:'+962', digits:9,  aka:'amman' },
  { iso:'KE', name:'Kenya',                  dial:'+254', digits:9,  aka:'nairobi' },
  { iso:'KI', name:'Kiribati',               dial:'+686' },
  { iso:'KG', name:'Kyrgyzstan',             dial:'+996', digits:9,  aka:'bishkek' },
  { iso:'LA', name:'Laos',                   dial:'+856', aka:'vientiane' },
  { iso:'LV', name:'Latvia',                 dial:'+371', digits:8,  aka:'riga' },
  { iso:'LB', name:'Lebanon',                dial:'+961', digits:8,  aka:'beirut' },
  { iso:'LS', name:'Lesotho',                dial:'+266', digits:8 },
  { iso:'LR', name:'Liberia',                dial:'+231' },
  { iso:'LY', name:'Libya',                  dial:'+218', digits:9,  aka:'tripoli' },
  { iso:'LI', name:'Liechtenstein',          dial:'+423', digits:7 },
  { iso:'LT', name:'Lithuania',              dial:'+370', digits:8,  aka:'vilnius' },
  { iso:'LU', name:'Luxembourg',             dial:'+352', digits:9 },
  { iso:'MO', name:'Macau',                  dial:'+853', digits:8 },
  { iso:'MG', name:'Madagascar',             dial:'+261', digits:9 },
  { iso:'MW', name:'Malawi',                 dial:'+265', digits:9 },
  { iso:'MY', name:'Malaysia',               dial:'+60',  digits:10, aka:'kuala lumpur' },
  { iso:'MV', name:'Maldives',               dial:'+960', digits:7,  aka:'male' },
  { iso:'ML', name:'Mali',                   dial:'+223', digits:8 },
  { iso:'MT', name:'Malta',                  dial:'+356', digits:8,  aka:'valletta' },
  { iso:'MH', name:'Marshall Islands',       dial:'+692' },
  { iso:'MR', name:'Mauritania',             dial:'+222', digits:8 },
  { iso:'MU', name:'Mauritius',              dial:'+230', digits:8,  aka:'port louis' },
  { iso:'MX', name:'Mexico',                 dial:'+52',  digits:10, aka:'mexico city' },
  { iso:'FM', name:'Micronesia',             dial:'+691' },
  { iso:'MD', name:'Moldova',                dial:'+373', digits:8 },
  { iso:'MC', name:'Monaco',                 dial:'+377' },
  { iso:'MN', name:'Mongolia',               dial:'+976', digits:8,  aka:'ulaanbaatar' },
  { iso:'ME', name:'Montenegro',             dial:'+382', digits:8 },
  { iso:'MA', name:'Morocco',                dial:'+212', digits:9,  aka:'casablanca rabat' },
  { iso:'MZ', name:'Mozambique',             dial:'+258', digits:9,  aka:'maputo' },
  { iso:'MM', name:'Myanmar',                dial:'+95',  aka:'burma yangon rangoon' },
  { iso:'NA', name:'Namibia',                dial:'+264', digits:9 },
  { iso:'NR', name:'Nauru',                  dial:'+674' },
  { iso:'NP', name:'Nepal',                  dial:'+977', digits:10, aka:'kathmandu' },
  { iso:'NL', name:'Netherlands',            dial:'+31',  digits:9,  aka:'holland amsterdam dutch' },
  { iso:'NZ', name:'New Zealand',            dial:'+64',  aka:'auckland wellington' },
  { iso:'NI', name:'Nicaragua',              dial:'+505', digits:8 },
  { iso:'NE', name:'Niger',                  dial:'+227', digits:8 },
  { iso:'NG', name:'Nigeria',                dial:'+234', digits:10, aka:'lagos abuja' },
  { iso:'KP', name:'North Korea',            dial:'+850' },
  { iso:'MK', name:'North Macedonia',        dial:'+389', digits:8,  aka:'macedonia skopje' },
  { iso:'NO', name:'Norway',                 dial:'+47',  digits:8,  aka:'oslo' },
  { iso:'PK', name:'Pakistan',               dial:'+92',  digits:10, aka:'karachi lahore islamabad' },
  { iso:'PW', name:'Palau',                  dial:'+680' },
  { iso:'PS', name:'Palestine',              dial:'+970', digits:9,  aka:'gaza ramallah' },
  { iso:'PA', name:'Panama',                 dial:'+507', digits:8 },
  { iso:'PG', name:'Papua New Guinea',       dial:'+675', digits:8 },
  { iso:'PY', name:'Paraguay',               dial:'+595', digits:9 },
  { iso:'PE', name:'Peru',                   dial:'+51',  digits:9,  aka:'lima' },
  { iso:'PH', name:'Philippines',            dial:'+63',  digits:10, aka:'manila cebu' },
  { iso:'PL', name:'Poland',                 dial:'+48',  digits:9,  aka:'warsaw polska' },
  { iso:'PT', name:'Portugal',               dial:'+351', digits:9,  aka:'lisbon porto' },
  { iso:'QA_', name:'—',                     dial:'',     hidden:true },
  { iso:'RO', name:'Romania',                dial:'+40',  digits:9,  aka:'bucharest' },
  { iso:'RU', name:'Russia / Kazakhstan',    dial:'+7',   digits:10, aka:'russia moscow kazakhstan almaty astana' },
  { iso:'RW', name:'Rwanda',                 dial:'+250', digits:9,  aka:'kigali' },
  { iso:'WS', name:'Samoa',                  dial:'+685' },
  { iso:'SM', name:'San Marino',             dial:'+378' },
  { iso:'ST', name:'São Tomé and Príncipe',  dial:'+239', digits:7 },
  { iso:'SN', name:'Senegal',                dial:'+221', digits:9,  aka:'dakar' },
  { iso:'RS', name:'Serbia',                 dial:'+381', digits:9,  aka:'belgrade' },
  { iso:'SC', name:'Seychelles',             dial:'+248', digits:7 },
  { iso:'SL', name:'Sierra Leone',           dial:'+232', digits:8 },
  { iso:'SK', name:'Slovakia',               dial:'+421', digits:9,  aka:'bratislava' },
  { iso:'SI', name:'Slovenia',               dial:'+386', digits:8,  aka:'ljubljana' },
  { iso:'SB', name:'Solomon Islands',        dial:'+677' },
  { iso:'SO', name:'Somalia',                dial:'+252', digits:8,  aka:'mogadishu' },
  { iso:'ZA', name:'South Africa',           dial:'+27',  digits:9,  aka:'johannesburg cape town durban' },
  { iso:'KR', name:'South Korea',            dial:'+82',  digits:10, aka:'seoul korea' },
  { iso:'SS', name:'South Sudan',            dial:'+211', digits:9,  aka:'juba' },
  { iso:'ES', name:'Spain',                  dial:'+34',  digits:9,  aka:'madrid barcelona espana' },
  { iso:'LK', name:'Sri Lanka',              dial:'+94',  digits:9,  aka:'colombo ceylon' },
  { iso:'SD', name:'Sudan',                  dial:'+249', digits:9,  aka:'khartoum' },
  { iso:'SR', name:'Suriname',               dial:'+597', digits:7 },
  { iso:'SE', name:'Sweden',                 dial:'+46',  aka:'stockholm' },
  { iso:'CH', name:'Switzerland',            dial:'+41',  digits:9,  aka:'zurich geneva' },
  { iso:'SY', name:'Syria',                  dial:'+963', digits:9,  aka:'damascus' },
  { iso:'TW', name:'Taiwan',                 dial:'+886', digits:9,  aka:'taipei' },
  { iso:'TJ', name:'Tajikistan',             dial:'+992', digits:9,  aka:'dushanbe' },
  { iso:'TZ', name:'Tanzania',               dial:'+255', digits:9,  aka:'dar es salaam' },
  { iso:'TH', name:'Thailand',               dial:'+66',  digits:9,  aka:'bangkok' },
  { iso:'TL', name:'Timor-Leste',            dial:'+670', aka:'east timor' },
  { iso:'TG', name:'Togo',                   dial:'+228', digits:8 },
  { iso:'TO', name:'Tonga',                  dial:'+676' },
  { iso:'TN', name:'Tunisia',                dial:'+216', digits:8,  aka:'tunis' },
  { iso:'TR', name:'Türkiye',                dial:'+90',  digits:10, aka:'turkey istanbul ankara' },
  { iso:'TM', name:'Turkmenistan',           dial:'+993', digits:8 },
  { iso:'TV', name:'Tuvalu',                 dial:'+688' },
  { iso:'UG', name:'Uganda',                 dial:'+256', digits:9,  aka:'kampala' },
  { iso:'UA', name:'Ukraine',                dial:'+380', digits:9,  aka:'kyiv kiev' },
  { iso:'UY', name:'Uruguay',                dial:'+598', digits:8,  aka:'montevideo' },
  { iso:'UZ', name:'Uzbekistan',             dial:'+998', digits:9,  aka:'tashkent' },
  { iso:'VU', name:'Vanuatu',                dial:'+678' },
  { iso:'VE', name:'Venezuela',              dial:'+58',  digits:10, aka:'caracas' },
  { iso:'VN', name:'Vietnam',                dial:'+84',  digits:9,  aka:'hanoi ho chi minh saigon' },
  { iso:'YE', name:'Yemen',                  dial:'+967', digits:9,  aka:'sanaa' },
  { iso:'ZM', name:'Zambia',                 dial:'+260', digits:9,  aka:'lusaka' },
  { iso:'ZW', name:'Zimbabwe',               dial:'+263', digits:9,  aka:'harare' },
].filter(c => !c.hidden && c.dial);

/*  Longest dial code first. "+1" is a prefix of "+91", so matching shortest-
    first would read an Indian number as American and leave "1 9876543210" in
    the number box. Sorting once here means splitPhone below is simply "the
    first code that matches is the right one".                              */
const BY_LENGTH = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** Every distinct dial code, longest first. */
export const DIAL_CODES = [...new Set(BY_LENGTH.map(c => c.dial))];

/** The label shown in the picker, e.g. "India +91". */
export const dialLabel = c => `${c.name}  ${c.dial}`;

/*  Every dial code appears exactly once in COUNTRIES — shared codes are merged
    into one entry — so this is unambiguous in both directions.             */
export const countryFor = dial =>
  COUNTRIES.find(c => c.dial === dial) || COUNTRIES[0];

/**
 * How many digits the number box should accept for this country.
 *
 * `hardCeiling` is the room left by the 20-character column limit once the
 * dial code and its space are spent. The country's own length wins whenever it
 * is stricter, which is the point — India gets 10, not 16.
 */
export function maxDigitsFor(dial, hardCeiling = FALLBACK_DIGITS) {
  const known = countryFor(dial).digits || FALLBACK_DIGITS;
  return Math.max(1, Math.min(known, hardCeiling));
}

/**
 * Options for the searchable picker in formKit.jsx.
 *
 * `keywords` is what the search box matches on but never displays: the
 * country name, its dial code with and without the +, its ISO code, and the
 * `aka` list. That is what makes "dubai", "971", "uae" and "emirates" all
 * land on the same row.
 */
export const COUNTRY_OPTIONS = COUNTRIES.map(c => ({
  value   : c.dial,
  label   : c.name,
  hint    : c.dial,
  group   : c.top ? 'Frequently used' : 'All countries',
  keywords: `${c.name} ${c.dial} ${c.dial.replace('+', '')} ${c.iso} ${c.aka || ''}`,
}));

/**
 * "+91 9876543210"  ->  { dial: '+91', number: '9876543210' }
 *
 * Handles the three shapes already sitting in your Clients tab:
 *   "+91 9876543210"   written by this form
 *   "9876543210"       the AppSheet rows — assumed Indian, which they are
 *   "919876543210"     pasted from WhatsApp, no plus
 */
export function splitPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { dial: DEFAULT_DIAL, number: '' };

  if (raw.startsWith('+')) {
    const compact = raw.replace(/[^\d+]/g, '');
    const hit = DIAL_CODES.find(d => compact.startsWith(d));
    if (hit) return { dial: hit, number: compact.slice(hit.length) };
    return { dial: DEFAULT_DIAL, number: compact.replace(/\D/g, '') };
  }

  const digits = raw.replace(/\D/g, '');

  /*  A bare 10-digit number is an Indian mobile. That is what 1,501 existing
      rows hold, and reading them as anything else would rewrite history.   */
  if (digits.length <= 10) return { dial: DEFAULT_DIAL, number: digits };

  /*  Longer than 10 and no plus: try to peel a known code off the front.
      "919876543210" -> +91 / 9876543210.                                   */
  const hit = DIAL_CODES.find(d => digits.startsWith(d.slice(1)));
  if (hit) return { dial: hit, number: digits.slice(hit.length - 1) };

  return { dial: DEFAULT_DIAL, number: digits };
}

/**
 * { dial, number } -> the single string stored in Client_Mobile.
 *
 * An empty number produces an empty string, never a stranded "+91" — an
 * abandoned half-filled form must not leave a dial code with no number behind
 * it in the sheet.
 *
 * THIS IS WHY PhoneField HOLDS THE COUNTRY IN ITS OWN STATE. Picking a country
 * before typing a number returns '' from here, and splitPhone('') answers with
 * the default — so a picker that read the country back out of the value
 * snapped straight back to India. See formKit.jsx.
 */
export function joinPhone(dial, number) {
  const n = String(number ?? '').replace(/\D/g, '');
  if (!n) return '';
  return `${dial || DEFAULT_DIAL} ${n}`;
}

/**
 * Is this a plausible number for its country?
 *
 * India is checked exactly — ten digits starting 6, 7, 8 or 9 — because it is
 * 99% of the data and the rule is unambiguous. Everywhere else is checked
 * against that country's own length when we know it, and loosely when we do
 * not: numbering plans vary, and a validator stricter than reality just blocks
 * a real customer with no way round it.
 */
export function validatePhone(dial, number) {
  const n = String(number ?? '').replace(/\D/g, '');
  if (!n) return 'Mobile number is required';

  if (dial === '+91') {
    if (n.length !== 10)   return 'An Indian mobile number is 10 digits';
    if (!/^[6-9]/.test(n)) return 'An Indian mobile number starts with 6, 7, 8 or 9';
    return null;
  }

  const c = countryFor(dial);
  if (c.digits && n.length !== c.digits) {
    return `A ${c.name} mobile number is ${c.digits} digits`;
  }

  if (n.length < 5)  return 'That number looks too short';
  if (n.length > 15) return 'That number looks too long';
  return null;
}