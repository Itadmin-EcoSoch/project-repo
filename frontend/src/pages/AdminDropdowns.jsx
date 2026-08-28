/*  frontend/src/pages/AdminDropdowns.jsx  — NEW FILE
    ----------------------------------------------------------------------------
    Lets an Admin add or remove values from the "pick from a list" fields on
    the New/Edit Project form — Type of Project, Sales Lead, Inverter Brand,
    Inverter Type, Module Brand, Roof Material, Type of Structure, Project
    Region, Monitoring Frequency — without ever touching code or redeploying
    anything.

    Every list below is a FIELD_KEY that lib/projectFields.js tags a select
    field with via `optionsKey` (see mergeOptions there). A value added here
    is written to the Dropdown_Options sheet through
    backend/routes/dropdownOptions.js, and shows up in that field's dropdown
    for every signed-in user the next time they open the New or Edit Project
    form — via useDropdownOptions.jsx. Nothing else needs to change, and
    nobody needs to touch this screen's code to keep the lists current.

    The built-in values that ship in code (PROJECT_TYPES, SALES_LEADS, …) are
    shown for reference but cannot be removed here — they are not sheet rows.
    They are the safe fallback the form keeps working from even if the sheet,
    or the Dropdown_Options tab specifically, is ever unreachable. Only what
    your team adds through this screen can be deleted through this screen.

    Reached from Account → Manage → "Dropdown lists" (AccountDrawer.jsx),
    Admin-only — see the /admin/dropdowns route in main.jsx.
--------------------------------------------------------------------------- */

import { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { getDropdownOptions, addDropdownOption, deleteDropdownOption } from '../lib/api';
import {
  PROJECT_TYPES, REGIONS, SALES_LEADS, INVERTER_BRANDS, INVERTER_TYPES,
  MODULE_BRANDS, ROOF_MATERIALS, STRUCTURE_TYPES, MONITORING_FREQ,
  BILL_AVAILABLE, BUILDING_TYPES, BUSINESS_MODELS, PROPOSAL_MODELS,
  SECTORS, SYSTEM_TYPES, SYSTEM_CATEGORIES,
} from '../lib/projectFields';
import { CLIENT_IDENTITIES } from './formKit';
import { TICKET_TYPES, TICKET_PRIORITIES, TICKET_STATUSES } from '../lib/solarcare';

import {
  Box, Paper, Typography, Button, TextField, CircularProgress,
  List, ListItem, ListItemButton, ListItemText, Chip, IconButton,
  Divider, Stack, Checkbox,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

/*  Every admin-manageable list: its FIELD_KEY (must match the optionsKey used
    in lib/projectFields.js exactly — that string is the join between this
    screen and the project form), a friendly label, and its built-in values
    (shown for reference, read-only here).

    NOT every dropdown on the project form is here, on purpose:
      Project_Status   — computed per-project by the backend (which AMC
                          contracts and payments exist), not a fixed list.
      GST_Available     — a Yes/No gate, not really a "list" to extend.
      AMC_Type           — "Inspection" / "Cleaning" / "Inspection, Cleaning"
                          are matched by regex in wantsInspection/wantsCleaning
                          (lib/projectFields.js). Adding a fourth value here
                          would render as a choice that quietly generates no
                          AMC schedule at all, since nothing recognises it.
    Both are better fixed in code, where changing them is a deliberate,
    reviewed step rather than a click on this screen.                       */
const LISTS = [
  { key: 'Project_Type',         label: 'Type of Project',      builtIn: PROJECT_TYPES },
  { key: 'Project_Region',       label: 'Project Region',       builtIn: REGIONS },
  { key: 'Client_Identity',      label: 'Client Identity',      builtIn: CLIENT_IDENTITIES },
  { key: 'Sales_Lead',           label: 'Sales Lead',           builtIn: SALES_LEADS },
  { key: 'Bill_Available',       label: 'Electricity Bill Available', builtIn: BILL_AVAILABLE },
  { key: 'Building_Type',        label: 'Building Type',        builtIn: BUILDING_TYPES },
  { key: 'Business_Model',       label: 'Business Model',       builtIn: BUSINESS_MODELS },
  { key: 'Inverter_Brand',       label: 'Inverter Brand',       builtIn: INVERTER_BRANDS },
  { key: 'Inverter_Type',        label: 'Inverter Type',        builtIn: INVERTER_TYPES },
  { key: 'Proposal_Model',       label: 'Proposal Model',       builtIn: PROPOSAL_MODELS },
  { key: 'Module_Brand',         label: 'Module Brand',         builtIn: MODULE_BRANDS },
  { key: 'Roof_Material',        label: 'Roof Material',        builtIn: ROOF_MATERIALS },
  { key: 'Roof_Type',            label: 'Type of Structure',    builtIn: STRUCTURE_TYPES },
  { key: 'Project_Sector',       label: 'Project Sector',       builtIn: SECTORS },
  { key: 'System_Type',          label: 'System Type',          builtIn: SYSTEM_TYPES },
  { key: 'System_Category',      label: 'System Category',      builtIn: SYSTEM_CATEGORIES },
  { key: 'Monitoring_Frequency', label: 'Monitoring Frequency', builtIn: MONITORING_FREQ },
  { key: 'Ticket_Type',          label: 'Ticket Issue Type',    builtIn: TICKET_TYPES },
  { key: 'Ticket_Priority',      label: 'Ticket Priority',      builtIn: TICKET_PRIORITIES },
  { key: 'Ticket_Status',        label: 'Ticket Status',        builtIn: TICKET_STATUSES },
  /*  No builtIn list here — unlike the three above, "Assigned To" isn't a
      fixed set of words in code, it's whoever actually has a login,
      fetched live on the ticket form. What you add here is for names that
      are NOT a real account: an outside vendor, a subcontractor crew,
      anyone worth assigning a ticket to without giving them sign-in
      access.                                                              */
  { key: 'Ticket_Assigned_To',   label: 'Ticket Assigned To (non-account names)', builtIn: [] },
];

export default function AdminDropdowns() {
  const [rows,      setRows]      = useState([]);   // raw rows from the API, every key
  const [loading,   setLoading]   = useState(true);
  const [activeKey, setActiveKey] = useState(LISTS[0].key);
  const [newValue,  setNewValue]  = useState('');
  const [saving,    setSaving]    = useState(false);

  function load() {
    setLoading(true);
    return getDropdownOptions()
      .then(data => setRows(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Could not load dropdown options'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { setSelectedIds([]); }, [activeKey]);

  const active = LISTS.find(l => l.key === activeKey) || LISTS[0];

  /*  Everything added through this screen for the selected list, newest
      first. r.active === false is filtered out defensively — nothing here
      offers a "deactivate" action (only delete), but a row toggled off by
      hand directly in the sheet should still disappear from this list.    */
  const addedRows = useMemo(
    () => rows
      .filter(r => r.field_key === active.key && r.active !== false)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [rows, active.key]
  );

  async function handleAdd() {
    const value = newValue.trim();
    if (!value) return;

    /*  Block a duplicate of a BUILT-IN value too — the server only knows its
        own table, not the hardcoded list baked into the frontend, so typing
        "EPC" again would otherwise create a second, confusing row that
        merges away to nothing visible on the actual form.                  */
    const clash = active.builtIn.some(v => v.toLowerCase() === value.toLowerCase())
      || addedRows.some(r => String(r.value || '').toLowerCase() === value.toLowerCase());
    if (clash) { toast.error(`"${value}" is already on this list.`); return; }

    setSaving(true);
    try {
      await addDropdownOption(active.key, value);
      toast.success(`Added "${value}" to ${active.label}`);
      setNewValue('');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not add that value');
    } finally {
      setSaving(false);
    }
  }

  const [selectedIds, setSelectedIds] = useState([]);
  const toggleSelect = (id) =>
    setSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  async function handleBulkDelete() {
    const ids = selectedIds.filter(id => addedRows.some(r => r.id === id));
    if (!ids.length) return;
    if (!window.confirm(
      `Remove ${ids.length} value${ids.length > 1 ? 's' : ''} from ${active.label}?\n\n` +
      `Projects that already use them keep them — this only removes them from the picker for new entries.`
    )) return;
    try {
      await Promise.all(ids.map(id => deleteDropdownOption(id)));
      toast.success(`Removed ${ids.length} value${ids.length > 1 ? 's' : ''}`);
      setRows(prev => prev.filter(r => !ids.includes(r.id)));
      setSelectedIds([]);
    } catch (err) {
      toast.error(err.message || 'Could not delete the selected values');
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(
      `Remove "${row.value}" from ${active.label}?\n\n` +
      `Projects that already use it keep it — this only removes it from the picker for new entries.`
    )) return;

    try {
      await deleteDropdownOption(row.id);
      toast.success(`Removed "${row.value}"`);
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) {
      toast.error(err.message || 'Could not delete that value');
    }
  }

  return (
    /*  Fills exactly the space between the top bar and bottom nav (see
        .content-area / .app-shell in styles/globals.css — content-area is a
        flex:1 child of a 100vh flex column, so height:'100%' here resolves
        to that same fixed area, not the whole browser window).

        overflow:'hidden' on this root means content-area itself never needs
        to scroll for this page — scrolling now happens ONLY inside the two
        panels below, independently of each other. Before this, the header
        text and both panels were one long flowing page, so scrolling the
        list of field names on the left also carried the "Add a value" box
        on the right out of view with it.                                   */
    <Box p={4} sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header — stays put, never scrolls */}
      <Box sx={{ flexShrink: 0 }}>
        <Typography variant="h4" gutterBottom>Manage Dropdown Lists</Typography>
      </Box>

      {/*  flex:1 + minHeight:0 is what lets the row below actually shrink to
          fit the remaining space instead of pushing past it — without
          minHeight:0, a flex child refuses to be smaller than its content,
          which is exactly what was forcing the whole page to grow and
          scroll as one piece.                                              */}
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
        {/* ── the list of lists — scrolls on its own ── */}
        <Paper sx={{ width: 260, flexShrink: 0, overflowY: 'auto' }}>
          <List dense>
            {LISTS.map(l => {
              const addedCount = rows.filter(r => r.field_key === l.key && r.active !== false).length;
              return (
                <ListItem key={l.key} disablePadding>
                  <ListItemButton selected={l.key === activeKey} onClick={() => setActiveKey(l.key)}>
                    <ListItemText
                      primary={l.label}
                      secondary={`${l.builtIn.length} built-in${addedCount ? ` · +${addedCount} added` : ''}`}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Paper>

        {/* ── the selected list ── */}
        <Paper sx={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/*  The title and "Add a value" box are pinned at the top of THIS
              panel — sticky, not just non-scrolling, so they stay visible
              even while the built-in chips and "Added by your team" list
              below scroll on their own inside this same panel.             */}
          <Box sx={{ p: 3, pb: 2, flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="h6" gutterBottom>{active.label}</Typography>

            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField
                size="small" fullWidth placeholder={`Add a new ${active.label.toLowerCase()}…`}
                value={newValue} onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                disabled={saving}
              />
              <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd}
                      disabled={saving || !newValue.trim()}>
                Add
              </Button>
            </Stack>
          </Box>

          <Box sx={{ p: 3, pt: 2, overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {loading ? (
              <Box textAlign="center" py={4}><CircularProgress size={24} /></Box>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Built-in (from code — cannot be removed here)
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2.5 }}>
                  {active.builtIn.map(v => <Chip key={v} label={v} size="small" />)}
                </Box>

                <Divider sx={{ mb: 2 }} />

                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Added by your team
                  </Typography>
                  {selectedIds.length > 0 && (
                    <Button size="small" color="error" variant="outlined"
                            startIcon={<DeleteIcon fontSize="small" />} onClick={handleBulkDelete}>
                      Delete selected ({selectedIds.length})
                    </Button>
                  )}
                </Stack>
                {addedRows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Nothing added yet — use the box above.
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {addedRows.map(r => (
                      <ListItem key={r.id} disablePadding
                        secondaryAction={
                          <IconButton edge="end" color="error" onClick={() => handleDelete(r)} title="Remove">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        }>
                        <Checkbox edge="start" size="small"
                                  checked={selectedIds.includes(r.id)}
                                  onChange={() => toggleSelect(r.id)} />
                        <ListItemText
                          primary={r.value}
                          secondary={r.created_by ? `Added by ${r.created_by}` : undefined}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}