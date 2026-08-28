/*  frontend/src/pages/ProjectFormFields.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    Draws the form described in lib/projectFields.js.

    The whole point is the conditional behaviour: answer "Is there GSTIN Number?"
    with Yes and the GSTIN box appears; switch it to No and the box disappears
    and stops being required. Same for the referral, obstacle, retention,
    monitoring, TSV, billing-name and DISCOM-name questions.

    Used by both AddProject and EditProject, so the two screens can never drift
    apart again.
--------------------------------------------------------------------------- */

import { useState, useEffect, useRef } from 'react';
import { PROJECT_SECTIONS, ALL_FIELDS, isVisible, isRequired, mergeOptions, toDateInput, isNewProject } from '../lib/projectFields';
import { Card, Field, SInput, SSelect, STextarea, C, SelectOrType, indianComma, DateField } from './formKit';
import { maxLengthFor, TEXTAREA_MAX } from '../lib/fieldLimits';
import FileField from './FileField';

/*  Yes / No as two buttons, the way AppSheet shows them.

    They used to be welded together — gap 0, one shared outline, a hairline
    divider down the middle — which made the pair read as a single wide control
    rather than two things you choose between. Now they are separate buttons
    with their own border and corners, and a gap.

    The error border is the soft red used elsewhere, not full-strength danger:
    a page of unanswered questions should look like a page of unanswered
    questions, not a page of failures.                                       */
function YesNo({ value, onChange, hasError, lockedTo = null }) {
  const opts = ['No', 'Yes'];          // No on the left, matching AppSheet

  /*  lockedTo disables the other button rather than hiding it.

      Payments_Done has two AppSheet states where only one answer is legal:
      a project-payment default forces No, and a cleared payment can never go
      back to No. Showing one lone button would leave the user wondering where
      the other went — a visibly disabled one says "this is not available",
      and the help text under the field says why.                          */
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {opts.map(o => {
        const active   = String(value || '').trim().toLowerCase() === o.toLowerCase();
        const disabled = Boolean(lockedTo) && lockedTo.toLowerCase() !== o.toLowerCase();
        return (
          <button key={o} type="button" disabled={disabled}
            onClick={() => { if (!disabled) onChange(o); }}
            style={{
              flex: 1, padding: '11px 8px', borderRadius: 10,
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              border: `1.5px solid ${active ? C.primary : hasError ? '#fca5a5' : C.border}`,
              background: active ? C.primary : hasError ? '#fffafa' : '#fff',
              color     : active ? '#fff' : C.text2,
              transition: 'background .12s, border-color .12s',
            }}>
            {o.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A select that also accepts a value typed in, for the AppSheet lists whose
 * search box says "Add or search" — Inverter_Brand, Module_Brand, Sales_Lead.
 *
 * A STORED VALUE THAT IS NOT IN THE LIST IS DROPPED ON LOAD.
 * Old rows carry names and brands that are not in the current dropdown — a
 * Sales_Lead of "Maheshwari H", say. Rather than showing it, the field opens on
 * "Select…" and you pick from the standard list.
 *
 * Cleared in form state, not just on screen, so what you see is what gets
 * saved. Nothing is lost silently: these fields are required, so the form will
 * not save until you have actively chosen a replacement, and the old value
 * stays in the sheet until you do.
 *
 * The clear runs once, on mount. Without that guard it would also wipe a name
 * you had just typed into "＋ Add a name not on the list", since that is by
 * definition not in the list either.
 */
/*  SelectOrType now lives in formKit.jsx so the client form can use it too.
    Behaviour is unchanged for these fields: keepUnknown defaults to false, so a
    stale value that is no longer in the dropdown is still cleared on mount and
    the user must actively re-pick. Fields that should KEEP a typed-in value
    across edits set keepCustom: true in projectFields.js.
------------------------------------------------------------------------- */

/*  RadioGroup — the same pill buttons as YesNo, for any short option list.

    Used by Type of AMC Contract. Three choices that decide which terms appear
    below should all be visible at once; a dropdown hides two of them behind a
    click and gives no hint that picking one changes the form.

    Wraps on narrow screens rather than squashing, because
    "Inspection, Cleaning" is a long label.                               */
function RadioGroup({ value, options = [], onChange, hasError, lockedTo = null }) {
  const current = String(value ?? '').trim().toLowerCase();
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active   = current === String(o).trim().toLowerCase();
        /*  lockedTo disables the other choices rather than hiding them.
            "Is there a separate AMC provided?" on an AMC-type project can only
            be Yes — showing one lone button would leave the user wondering
            where No went, so it is greyed out with the reason underneath.  */
        const disabled = Boolean(lockedTo) &&
                         String(lockedTo).trim().toLowerCase() !== String(o).trim().toLowerCase();
        return (
          <button key={o} type="button" disabled={disabled}
            onClick={() => { if (!disabled) onChange(o); }}
            style={{
              flex: '1 1 auto', minWidth: 130, padding: '11px 14px', borderRadius: 10,
              fontSize: 13, fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              border: `1.5px solid ${active ? C.primary : hasError ? '#fca5a5' : C.border}`,
              background: active ? C.primary : hasError ? '#fffafa' : '#fff',
              color     : active ? '#fff' : C.text2,
              transition: 'all .12s',
            }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/*  Keep at most one decimal place while typing a percentage. */
const oneDecimal = s => String(s ?? '').replace(/(\.\d)\d+/, '$1');
/*  Subtle per-section colour theme so each card is visually distinct. */
const SECTION_PALETTE = [
  { color: '#2563eb', tint: '#f5f8ff' },
  { color: '#0a6450', tint: '#f1fbf7' },
  { color: '#c2410c', tint: '#fff7f2' },
  { color: '#7c3aed', tint: '#faf7ff' },
  { color: '#0891b2', tint: '#f1fbfd' },
  { color: '#be185d', tint: '#fff5f9' },
  { color: '#ca8a04', tint: '#fffdf2' },
  { color: '#0d9488', tint: '#f1fdfb' },
  { color: '#4f46e5', tint: '#f6f6ff' },
  { color: '#db2777', tint: '#fff5fa' },
  { color: '#65a30d', tint: '#f9fdf0' },
];

/*  Keep a numeric entry within [0, max] as the user types. Partial input
    like '' or '5.' is left alone so typing still works; anything that
    resolves to a number is clamped to 0..max.                              */
const clampNum = (raw, max) => {
  const s = String(raw ?? '');
  if (s === '' || s === '.' || s === '-') return '';
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  let c = n;
  if (c < 0) c = 0;
  if (typeof max === 'number' && c > max) c = max;
  return c === n ? s : String(c);
};

function renderField(f, form, set, errors, projectId, statusOptions, isAdmin, dropdownOptions, onFieldBlur) {
  const v   = form[f.name] ?? '';

  /*  Per-project option lists. The Project_Status choices depend on AMC
      contracts and payments, which only the backend can see, so it sends them
      with the project and they override the static list here.
      Falls back to f.options on the Add form, where there is no project yet.

      A field marked with optionsKey (Type of Project, Sales Lead, Inverter
      Brand, …) gets its hardcoded list topped up with whatever an Admin has
      added through the Admin screen — see mergeOptions in projectFields.js.
      currentValue is passed through too, so a value already saved on this
      project is never silently dropped even if an admin later removes it
      from the managed list.                                                */
  /*  f.options may be a FUNCTION of the form, not just an array — see
      projType, whose list collapses to ['AMC'] for an External client. Resolve
      it before anything else looks at it, so mergeOptions and the <select>
      both receive a real array.                                          */
  const baseOpts = typeof f.options === 'function' ? f.options(form) : f.options;

  const opts = (f.dynamicOptions === 'status' && Array.isArray(statusOptions) && statusOptions.length)
    ? statusOptions
    : f.optionsKey
      ? mergeOptions(baseOpts, dropdownOptions?.[f.optionsKey], v)
      : baseOpts;
  const err = errors[f.name];
  const bad = Boolean(err);
  const on  = val => set(f.name, val);

  /*  A field can mark itself adminOnlyAllowNew so that "+ Add a value not on
      the list" is only offered to admins; everyone else gets the plain
      dropdown. Nothing in projectFields.js uses this today — new values go
      through the Admin screen and optionsKey above instead — but the gate
      stays available for a field that genuinely needs an inline escape
      hatch later.                                                          */
  const allowNew = f.allowNew && (!f.adminOnlyAllowNew || isAdmin);

  /*  readOnlyIf — the value is a copy of another record, so it is shown but
      not typeable. A disabled input would look broken and still be tab-
      focusable; a plain panel says "this came from somewhere else" and the
      only way to change it is to change the source.                       */
  if (typeof f.readOnlyIf === 'function' && f.readOnlyIf(form)) {
    /*  Form state stores dates as ISO ('2028-09-30') because that's what
        <input type="date"> and the payload both need. Shown raw, that reads
        oddly next to every other date field on the form, which display
        dd-mm-yyyy via the browser's native picker. Reformat for display only
        — the underlying value driving validation and the save payload is
        untouched.                                                         */
    const isoDate = f.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v));
    const display = isoDate
      ? (([y, m, d]) => `${d}-${m}-${y}`)(String(v).slice(0, 10).split('-'))
      : v;
    return (
      <div style={{ padding: '11px 13px', background: C.surface, borderRadius: 10,
                    border: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600,
                    color: v ? C.text1 : C.text3, whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word', minHeight: 42 }}>
        {display || f.readOnlyNote || 'Copied automatically'}
      </div>
    );
  }

  /*  Project status on a brand-new (not-yet-saved) project: always 'Active',
      shown as a read-only dark-orange badge. It only becomes a dropdown once
      the project is saved (the Edit form), where the real status options apply. */
  if ((f.name === 'status' || f.sheet === 'Project_Status') && isNewProject(form)) {
    return (
      <div style={{ padding:'11px 14px', background:'#c2410c', color:'#fff',
                    borderRadius:10, border:'1px solid #c2410c', fontSize:13,
                    fontWeight:700, letterSpacing:'.02em', minHeight:42,
                    display:'flex', alignItems:'center' }}>
        {v || 'Active'}
      </div>
    );
  }

  switch (f.type) {
    case 'readonly':
      return (
        <div style={{ padding: '11px 13px', background: C.surface, borderRadius: 10,
                      border: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600,
                      color: v ? C.text1 : C.text3, wordBreak: 'break-word' }}>
          {(/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0,10).split('-').reverse().join('-') : v) || 'Fills in as you complete the form'}
        </div>
      );

    case 'radio':
      return <RadioGroup value={v} options={f.options} onChange={on} hasError={bad}
                         lockedTo={typeof f.lockedTo === 'function' ? f.lockedTo(form) : f.lockedTo} />;

    case 'yesno':
      return <YesNo value={v} onChange={on} hasError={bad}
                   lockedTo={typeof f.lockedTo === 'function' ? f.lockedTo(form) : f.lockedTo} />;

    case 'select':
      return allowNew
        ? <SelectOrType value={v} options={opts} onChange={on} hasError={bad}
                        keepUnknown={f.keepCustom === true}
                        addLabel={f.addLabel || '＋ Add a value not on the list'}
                        typePlaceholder={f.typePlaceholder
                          || `Type the ${String(typeof f.label === 'function' ? f.label(form) : f.label)
                                .replace(/[:*]$/, '').replace(/_/g, ' ').toLowerCase()}`} />
        : <SSelect value={v} onChange={e => on(e.target.value)} options={opts}
                   placeholder="Select…" hasError={bad} />;

        case 'textarea':
      /*  1000 by default. A field spec can override with maxLength — see
          maxLengthFor in lib/fieldLimits.js.                              */
      return <STextarea value={v} onChange={e => on(e.target.value)}
                        maxLength={maxLengthFor(f)}
                        placeholder={f.placeholder || ''} hasError={bad} />;

    case 'number':
      return <SInput type="number" step={f.step} min={0} max={f.max} value={v}
                     onChange={e => on(clampNum(e.target.value, f.max))}
                     placeholder={f.placeholder || '0'} suffix={f.suffix} hasError={bad}
                     onBlur={() => onFieldBlur?.(f)} />;

    case 'currency':
      return <SInput type="text" sanitize={false} inputMode="numeric" value={indianComma(v)}
                     onChange={e => on(clampNum(e.target.value.replace(/[^\d.]/g, ''), f.max))}
                     placeholder="0" prefix="₹" hasError={bad}
                     onBlur={() => onFieldBlur?.(f)} />;

    case 'percent':
      return <SInput type="number" step="0.1" min={0} max={f.max} value={v}
                     onChange={e => on(clampNum(oneDecimal(e.target.value), f.max))}
                     placeholder="0.0" suffix="%" hasError={bad}
                     onBlur={() => onFieldBlur?.(f)} />;

        case 'date':
      /*  toDateInput here as well as in EditProject's loader — belt and
          braces. A value can reach this component from a restored draft or a
          screen that builds its own form state, and a silently-blank date box
          is a bad way to find that out.                                     */
      return <DateField value={toDateInput(v)} onChange={on} hasError={bad} />;

        case 'latlng':
      /*  sanitize={false} — a southern latitude starts with a minus, and the
          shared sanitizer strips a leading minus to block Sheets formula
          injection. Coordinates are validated by their own regex in
          validateProject, which is the right guard for this field.        */
      return <SInput value={v} onChange={e => on(e.target.value)} sanitize={false}
                     maxLength={40}
                     placeholder="12.9716, 77.5946" hasError={bad} />;

    /*  Uploads to the project's Drive folder and stores the returned path —
        the same shape AppSheet wrote, so the New Order email keeps linking it.
        Falls back to a paste-a-link box if Drive upload is not configured.  */
    case 'file':
      /*  column names the uploaded file (Apps Script builds
          PROJECTID.Column.stamp.ext). The AMC contract fields are transient
          and have no `sheet`, which would have made every one of them upload
          as plain "File" with nothing to tell them apart — hence
          uploadColumn.

          displayName/onNameChange are the persisted original filename (see
          fileNameKey in projectFields.js) — undefined for the transient AMC
          file fields, which don't have one and fall back to FileField's own
          in-session-only display exactly as before.                       */
      return <FileField value={v} onChange={on}
                        column={f.uploadColumn || f.sheet || f.name}
                        projectId={projectId} hasError={bad}
                        maxSizeMB={f.maxSizeMB}
                        />;
                        

        default:
      /*  100 characters and the shared character rule, for every text box on
          the project form — Deal ID, tags, Quotation Name, DISCOM name,
          Billing Name, GSTIN, Referrer, Retention Period, Salesperson.     */
      return <SInput type={f.inputType || 'text'} value={v} onChange={e => on(e.target.value)}
                     maxLength={maxLengthFor(f)} showCounter={maxLengthFor(f) <= 100}
                     placeholder={f.placeholder || ''} hasError={bad}
                     onBlur={() => onFieldBlur?.(f)} />;
  }
}

/*  COLUMN LAYOUT
    A six-column grid, so 2-up and 3-up rows can live in the same card without
    splitting it into sub-containers:

        full   span 6   one per row   — paragraphs and the read-only name
        half   span 3   two per row   — the default for everything else
        third  span 2   three per row — the Files & Dates attachments

    Real media queries via a stylesheet rather than inline styles, because
    inline styles cannot respond to screen width. Two columns from 760px,
    thirds only open up at 1100px so they never get too narrow to read.     */
/*  TWELVE columns, not six.

    Six cannot express a quarter, and the AMC block needs four fields on one
    row — years, visits, start date, document. Twelve divides cleanly by 2, 3
    and 4, so half / third / quarter all land on exact boundaries.

    The steps are deliberate. Everything is one per row on a phone; at 760px
    the row splits in two; only past 1100px do thirds and quarters open up,
    because four fields across a 900px window leaves each one too narrow to
    read a date in.                                                        */
const GRID_CSS = `
.pf-grid { display: grid; gap: 0; grid-template-columns: 1fr; }
.pf-grid > * { min-width: 0; }
@media (min-width: 760px) {
  .pf-grid     { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .pf-w-full   { grid-column: span 12; }
  .pf-w-half   { grid-column: span 6; }
  .pf-w-third  { grid-column: span 6; }
  .pf-w-quarter{ grid-column: span 6; }
}
@media (min-width: 1100px) {
  .pf-w-third  { grid-column: span 4; }
  .pf-w-quarter{ grid-column: span 3; }
}
`;

/*  Paragraph boxes and the read-only project name always take the full row —
    a half-width textarea is not worth reading. Everything else defaults to
    two per row, and a field can override with width:'third'.              */
const widthOf = f => f.width || (f.type === 'textarea' || f.type === 'readonly' ? 'full' : 'half');

export default function ProjectFormFields({ form, set, errors = {}, only = null, projectId = null,
                                            statusOptions = null, isAdmin = false,
                                            dropdownOptions = {}, onFieldBlur = null }) {

  /*  forceValue — a field whose answer is dictated by other fields.

      Type of Project = AMC means "Is there a separate AMC provided?" can only
      be Yes, so it is set here rather than left for the user to click. Putting
      it in the renderer means BOTH AddProject and EditProject get the
      behaviour; an effect in one page would have missed the other.

      Guarded on inequality so it runs once per change and cannot loop, and it
      only ever sets a value the field itself declares — nothing here invents
      data on its own.

      Depends on the WHOLE form now, not just projType/status. The AMC end-date
      preview (inspEnd/cleanEnd) is a forceValue too, and it needs to recompute
      on every keystroke in inspStart/inspVisits/inspYears (and the Cleaning
      equivalents) — a narrower dependency list would leave it stale.        */
  useEffect(() => {
    for (const f of ALL_FIELDS) {
      if (typeof f.forceValue !== 'function') continue;
      const want = f.forceValue(form);
      if (want !== null && want !== undefined && String(form[f.name] ?? '') !== String(want)) {
        set(f.name, want);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const sections = only
    ? PROJECT_SECTIONS.filter(s => only.includes(s.id))
    : PROJECT_SECTIONS;

  return (
    <>
      <style>{GRID_CSS}</style>
      {sections.map((section, si) => {
        /*  A section whose every field is conditional and currently hidden is
            not worth a heading — it would read as an empty card.            */
        const visible = section.fields.filter(f => isVisible(f, form));
        if (!visible.length) return null;

        return (
          <Card key={section.id}
                color={SECTION_PALETTE[si % SECTION_PALETTE.length].color}
                tint={SECTION_PALETTE[si % SECTION_PALETTE.length].tint}
                title={typeof section.title === 'function' ? section.title(form) : section.title}
                icon={<span style={{ fontSize: 14 }}>{section.icon}</span>}>
            {/*  Two or three columns on a laptop, one on a phone. auto-fit with
                a 300px minimum lets the browser pick the count from the space
                available — no breakpoints to maintain, and the 60-field form
                stops being one very long ribbon.                            */}
            <div className="pf-grid">
            {visible.map(f => (
              f.type === 'sectionBreak'
                /*  No Field wrapper here on purpose — a divider has no value,
                    so the label-above / red-asterisk / error-below chrome
                    every other field gets would be meaningless noise on top
                    of what is really just a horizontal rule with a caption.
                    pf-w-full guarantees it always starts a fresh grid row,
                    which is the whole point of this field existing.        */
                ? <div key={f.name} className="pf-w-full"
                       style={{ marginTop: 10, paddingTop: 14, borderTop: `1px dashed ${C.border}`,
                                fontSize: 11.5, fontWeight: 800, letterSpacing: '.03em',
                                textTransform: 'uppercase', color: C.text3 }}>
                    {typeof f.label === 'function' ? f.label(form) : f.label}
                  </div>
                : (
              /*  data-field-error lets the page scroll to the first problem.
                  On a 60-field form an error below the fold is invisible, and
                  Save looks like it simply did nothing.                      */
              <Field key={f.name} label={typeof f.label === 'function' ? f.label(form) : f.label}
                     data-field-error={errors[f.name] ? 'true' : undefined}
                     className={`pf-w-${widthOf(f)}`}
                     required={isRequired(f, form)} error={errors[f.name]}
                     showErrorText={!!errors[f.name] && !/is required$/.test(String(errors[f.name] || ''))}>
                {renderField(f, form, set, errors, projectId, statusOptions, isAdmin, dropdownOptions, onFieldBlur)}
                {(() => {
                  /*  Resolve BEFORE testing. f.help may be a function whose
                      answer depends on the form — Payments_Done only explains
                      itself when it is actually locked. A bare `f.help &&`
                      is always truthy for a function, so the empty box would
                      render on every field that used one.                 */
                  const help = typeof f.help === 'function' ? f.help(form) : f.help;
                  if (!help) return null;
                  return (
                    <div style={{ fontSize: 10.5, color: C.text3, marginTop: 6, lineHeight: 1.5 }}>
                      {help}
                    </div>
                  );
                })()}
              </Field>
                )
            ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}