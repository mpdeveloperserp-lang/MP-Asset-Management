import { ORG_NAME } from './config.js';
import { g, isNum, parseCSVRows, parseDate, serialKeyOf, serialProblem, sum, toCSV, today } from './calc.js';
import { $, activeDepts, activeLocs, activeVendors, byName, chip, createAssetRecords, download, errMsg, esc, fmtDate, isAdmin, num, S, scopeError, toast } from './core.js';
import { busy, closeModal, openModal } from './ui.js';

/* =====================================================================
   BULK IMPORT — Excel template generated from live Masters
   Columns = the exact fields of the Add-asset form (+ assignment fields).
   Every master-linked value must match Masters exactly.
   ===================================================================== */
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let excelLoading = null;
function loadExcel(){
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return excelLoading = excelLoading || new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = EXCELJS_URL;
    s.onload = () => res(window.ExcelJS);
    s.onerror = () => { excelLoading = null; rej(new Error('Could not load the Excel library — check the internet connection.')); };
    document.head.appendChild(s);
  });
}
const TRACK_VALUES = ['Individual', 'Lot'];
const SOURCE_VALUES = ['New addition (purchase)', 'Opening balance'];
const YESNO = ['No', 'Yes'];
const TEMPLATE_ROWS = 1000;
const FIELDS = [
  {key:'type', label:'Type', req:true, list:'type', w:18, help:'Pick from the list (Masters → Types & subtypes).', ex:'Electronics'},
  {key:'subtype', label:'Subtype', req:true, list:'subtype', w:18, help:'Pick from the list — shows only the subtypes of the Type chosen in column A.', ex:'CCTV Camera'},
  {key:'name', label:'Asset name', req:true, w:30, help:'Free text.', ex:'Hikvision 2MP Dome Camera'},
  {key:'description', label:'Description', w:26, help:'Optional free text.', ex:'IR 30m, outdoor'},
  {key:'tracking', label:'Tracking', list:'tracking', w:13, help:'Individual = one row per unit (Quantity 1). Lot = one row carrying a quantity. Blank = Individual.', ex:'Individual'},
  {key:'qty', label:'Quantity', kind:'int', w:10, help:'Individual: 1 or blank. Lot: number of items (whole number).', ex:'1'},
  {key:'serial', label:'Serial number', kind:'text', w:18, help:'Must be unique across all assets. Stored as text, so leading zeros are kept.', ex:'K12345601'},
  {key:'make', label:'Make / model', w:20, help:'Optional free text.', ex:'Hikvision DS-2CE76D0T'},
  {key:'vendor', label:'Vendor', list:'vendor', w:24, help:'Pick from the list (Masters → Vendors).', ex:'SecureTech Systems'},
  {key:'invoice', label:'Invoice reference', kind:'text', w:16, help:'Optional.', ex:'INV-4410'},
  {key:'purchaseDate', label:'Purchase date', kind:'date', w:14, help:'A date (dd-mm-yyyy), not in the future. Blank → flagged “Data Incomplete”.', ex:'10-10-2026'},
  {key:'cost', label:'Unit cost', kind:'num', w:12, help:'Number only — no ₹ symbol or commas. Blank → flagged “Data Incomplete”.', ex:'3200'},
  {key:'life', label:'Useful life (years)', kind:'num', w:12, help:'Blank → default life of the subtype.', ex:'5'},
  {key:'salvage', label:'Salvage value', kind:'num', w:12, help:'Total for the record. Blank → 0.', ex:'0'},
  {key:'location', label:'Location', list:'location', w:22, help:'Pick from the list (Masters → Locations).', ex:'Head Office'},
  {key:'position', label:'Position / sub-location', w:24, help:'Free text — the exact spot (floor, gate, pole…).', ex:'Main gate – pole 1'},
  {key:'source', label:'Source', list:'source', w:22, help:'“New addition (purchase)” or “Opening balance”. Blank → New addition.', ex:'New addition (purchase)'},
  {key:'warrantyUntil', label:'Warranty valid until', kind:'date', w:14, help:'A date on or after the purchase date. Optional.', ex:'10-10-2027'},
  {key:'holderUnknown', label:'In use, holder unknown', list:'yesno', w:13, help:'Yes → flagged “Unassigned”; then leave Department and Employee ID blank. Blank → No.', ex:'No'},
  {key:'department', label:'Department', list:'department', w:16, help:'Optional — assigns the asset on import (Masters → Departments).', ex:''},
  {key:'employeeId', label:'Employee ID', list:'employee', kind:'text', w:13, help:'Optional — must belong to the Department. Names are on the “Master Lists” sheet.', ex:''},
  {key:'assignedDate', label:'Assignment date', kind:'date', w:14, help:'Blank → purchase date.', ex:''},
  {key:'expectedReturn', label:'Expected return date', kind:'date', w:14, help:'On or after the assignment date. Blank → permanent issue.', ex:''},
  {key:'notes', label:'Notes', w:26, help:'Assignment notes.', ex:''}
];
const colLetter = n => { let s = ''; while (n){ const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function importMasters(){
  const types = S.types.filter(t => t.active !== false).sort(byName)
    .map(t => ({...t, subs: (t.subtypes || []).filter(s => s.active !== false)})).filter(t => t.subs.length);
  return {
    types,
    vendor: activeVendors().map(v => v.name), location: activeLocs().map(l => l.name), department: activeDepts().map(d => d.name),
    employees: S.employees.filter(e => e.active !== false).sort((a, b) => String(a.empId).localeCompare(String(b.empId))),
    tracking: TRACK_VALUES, source: S.settings.openingLocked ? [SOURCE_VALUES[0]] : SOURCE_VALUES, yesno: YESNO
  };
}

async function downloadTemplate(){
  const ExcelJS = await loadExcel();
  const M = importMasters();
  if (!M.types.length) throw new Error('Add at least one active type with subtypes in Masters first.');
  const NAVY = 'FF0B1F3A', GOLD = 'FFC9A227', TEAL = 'FF138D90', WHITE = 'FFFFFFFF';
  const wb = new ExcelJS.Workbook(); wb.creator = ORG_NAME; wb.created = new Date();
  const info = wb.addWorksheet('Instructions', {properties: {tabColor: {argb: GOLD}}});
  const ws = wb.addWorksheet('Assets', {views: [{state: 'frozen', ySplit: 1}], properties: {tabColor: {argb: TEAL}}});
  const ml = wb.addWorksheet('Master Lists', {properties: {tabColor: {argb: NAVY}}});
  const head = (cell, text, fill = NAVY, font = WHITE) => {
    cell.value = text; cell.font = {bold: true, color: {argb: font}};
    cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: fill}};
    cell.alignment = {vertical: 'middle', wrapText: true};
  };

  /* ---- Master Lists sheet (read-only reference, feeds the dropdowns) ---- */
  const ref = {}; let c = 1;
  const put = (key, title, values, width) => {
    head(ml.getCell(1, c), title);
    values.forEach((v, i) => { ml.getCell(i + 2, c).value = v; });
    ml.getColumn(c).width = width || Math.max(14, Math.min(42, Math.max(title.length, ...values.map(v => String(v).length)) + 2));
    if (values.length){ const L = colLetter(c); ref[key] = `'Master Lists'!$${L}$2:$${L}$${values.length + 1}`; }
    return c++;
  };
  const tCol = put('type', 'Types', M.types.map(t => t.name));
  const keyOf = (t, i) => 'ST_' + (String(t.code || '').replace(/[^A-Za-z0-9]/g, '') || 'T' + i);
  put('typeKey', 'Type key (do not edit)', M.types.map(keyOf), 22);
  wb.definedNames.add(`'Master Lists'!$${colLetter(tCol)}$2:$${colLetter(tCol + 1)}$${M.types.length + 1}`, 'TypeTable');
  M.types.forEach((t, i) => {
    const col = put('st_' + i, `${t.name} › subtypes`, t.subs.map(s => s.name));
    const L = colLetter(col);
    wb.definedNames.add(`'Master Lists'!$${L}$2:$${L}$${t.subs.length + 1}`, keyOf(t, i));
  });
  c++;
  put('vendor', 'Vendors', M.vendor);
  put('location', 'Locations', M.location);
  put('department', 'Departments', M.department);
  put('employee', 'Employee ID', M.employees.map(e => String(e.empId)));
  put('empName', 'Employee name', M.employees.map(e => e.name));
  put('empDept', 'Employee department', M.employees.map(e => e.department));
  c++;
  put('tracking', 'Tracking', M.tracking);
  put('source', 'Source', M.source);
  put('yesno', 'In use, holder unknown', M.yesno);
  ml.views = [{state: 'frozen', ySplit: 1}];
  await ml.protect('', {selectLockedCells: true, selectUnlockedCells: true});

  /* ---- Assets sheet ---- */
  const last = TEMPLATE_ROWS + 1;
  FIELDS.forEach((f, i) => {
    const n = i + 1, L = colLetter(n), cell = ws.getCell(1, n);
    head(cell, f.label + (f.req ? ' *' : ''), f.req ? GOLD : NAVY, f.req ? NAVY : WHITE);
    cell.note = f.help + (f.ex ? `\nExample: ${f.ex}` : '');
    const col = ws.getColumn(n); col.width = f.w;
    if (f.kind === 'date') col.numFmt = 'dd-mm-yyyy';
    else if (f.kind === 'text' || f.list) col.numFmt = '@';
    const range = `${L}2:${L}${last}`;
    const base = {allowBlank: true, showErrorMessage: true, errorStyle: 'stop', errorTitle: f.label, showInputMessage: true, promptTitle: f.label, prompt: f.help.slice(0, 250)};
    if (f.list === 'subtype'){
      ws.dataValidations.add(range, {...base, type: 'list', formulae: [`INDIRECT(VLOOKUP($A2,TypeTable,2,FALSE))`],
        error: 'Choose a subtype that belongs to the Type in column A (pick the Type first).'});
    } else if (f.list && ref[f.list]){
      ws.dataValidations.add(range, {...base, type: 'list', formulae: [ref[f.list]], error: `Pick a value from the list — it must match Masters exactly.`});
    } else if (f.kind === 'date'){
      ws.dataValidations.add(range, {...base, type: 'date', operator: 'greaterThan', formulae: [new Date(Date.UTC(1990, 0, 1))], error: 'Enter a valid date (dd-mm-yyyy).'});
    } else if (f.kind === 'num'){
      ws.dataValidations.add(range, {...base, type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], error: 'Enter a number ≥ 0 (no ₹ or commas).'});
    } else if (f.kind === 'int'){
      ws.dataValidations.add(range, {...base, type: 'whole', operator: 'greaterThanOrEqual', formulae: [1], error: 'Enter a whole number ≥ 1.'});
    }
  });
  ws.getRow(1).height = 32;
  ws.autoFilter = {from: {row: 1, column: 1}, to: {row: 1, column: FIELDS.length}};

  /* ---- Instructions sheet ---- */
  info.getColumn(1).width = 26; info.getColumn(2).width = 11; info.getColumn(3).width = 80; info.getColumn(4).width = 28;
  info.getCell('A1').value = `${ORG_NAME} — Asset bulk upload template`; info.getCell('A1').font = {bold: true, size: 15, color: {argb: NAVY}};
  info.getCell('A2').value = `Generated ${new Date().toLocaleString('en-GB')} from the live Masters by ${S.profile.name}. If Masters change (new vendor, location, subtype…), download a fresh template.`;
  info.getCell('A2').font = {italic: true, color: {argb: 'FF6B7686'}}; info.getCell('A2').alignment = {wrapText: true}; info.mergeCells('A2:D2'); info.getRow(2).height = 30;
  const steps = [
    '1. Fill one row per asset on the “Assets” sheet. 55 cameras = 55 rows, each with its own Serial number, Location and Position.',
    '2. Columns with a dropdown (Type, Subtype, Tracking, Vendor, Location, Source, holder unknown, Department, Employee ID) only accept values from Masters — pick, don’t type.',
    '3. Do not rename, delete or add columns — the headers must stay exactly as given (the upload rejects unknown or missing columns).',
    '4. Upload the saved .xlsx in Assets → Bulk import. Every row is checked before anything is saved; rows with errors are listed and skipped.',
    '5. Columns marked * (gold) are mandatory. Blank cost or purchase date is allowed but flags the asset “Data Incomplete”.'
  ];
  steps.forEach((s, i) => { const cell = info.getCell(4 + i, 1); cell.value = s; info.mergeCells(4 + i, 1, 4 + i, 4); cell.alignment = {wrapText: true, vertical: 'top'}; info.getRow(4 + i).height = 30; });
  let r = 4 + steps.length + 1;
  ['Column', 'Required', 'What to enter', 'Example'].forEach((h, i) => head(info.getCell(r, i + 1), h));
  FIELDS.forEach(f => { r++; info.getRow(r).values = [f.label, f.req ? 'Yes' : '', f.help, f.ex]; info.getCell(r, 3).alignment = {wrapText: true}; });
  r += 2; info.getCell(r, 1).value = 'Worked example — 2 of 55 CCTV cameras (copy the pattern, using your own Masters values):'; info.getCell(r, 1).font = {bold: true};
  r++; FIELDS.forEach((f, i) => head(info.getCell(r, i + 1), f.label, TEAL));
  const ex2 = {...Object.fromEntries(FIELDS.map(f => [f.key, f.ex])), serial: 'K12345602', position: 'Reception'};
  [Object.fromEntries(FIELDS.map(f => [f.key, f.ex])), ex2].forEach(row => { r++; FIELDS.forEach((f, i) => { info.getCell(r, i + 1).value = row[f.key]; }); });

  wb.views = [{activeTab: 1}];
  const buf = await wb.xlsx.writeBuffer();
  download(`Asset_Upload_Template_${today()}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function cellText(v){
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object'){
    if ('result' in v) return cellText(v.result);
    if (v.richText) return v.richText.map(t => t.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}
async function readImportFile(file){
  if (/\.csv$/i.test(file.name)){
    const rows = parseCSVRows(await file.text());
    return {headers: rows[0] || [], data: rows.slice(1).map((vals, i) => ({rn: i + 2, vals: vals.map(v => String(v).trim())})).filter(x => x.vals.some(Boolean))};
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Upload the .xlsx template (or a .csv with the same columns).');
  const ExcelJS = await loadExcel(), wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet('Assets');
  if (!ws) throw new Error('The workbook has no “Assets” sheet — use the template downloaded from this page.');
  const headers = [];
  ws.getRow(1).eachCell({includeEmpty: true}, (cell, i) => { headers[i - 1] = cellText(cell.value); });
  const data = [];
  ws.eachRow({includeEmpty: false}, (row, rn) => {
    if (rn === 1) return;
    const vals = headers.map((_, i) => cellText(row.getCell(i + 1).value));
    if (vals.some(v => v !== '')) data.push({rn, vals});
  });
  return {headers, data};
}
function mapHeaders(headers){
  const byName = new Map(FIELDS.flatMap(f => [[f.label.toLowerCase(), f.key], [f.key.toLowerCase(), f.key]]));
  const map = [], unknown = [], dupes = [];
  headers.forEach((h, i) => {
    const n = String(h ?? '').replace(/\*\s*$/, '').trim().toLowerCase();
    if (!n || n === 'row' || n === 'errors') return;
    const k = byName.get(n);
    if (!k) unknown.push(String(h).trim());
    else if (map.includes(k)) dupes.push(String(h).trim());
    else map[i] = k;
  });
  const missing = FIELDS.filter(f => f.req && !map.includes(f.key)).map(f => f.label);
  return {map, unknown, dupes, missing};
}
function exactIn(val, names, label){
  if (names.includes(val)) return {val};
  const ci = names.find(n => n.toLowerCase() === val.toLowerCase());
  return {err: ci ? `${label} "${val}" must be written exactly as in Masters: "${ci}"` : `${label} "${val}" is not in Masters`};
}

/* records: [{row, r}] where r is keyed by lower-case field key */
function validateImport(records){
  const M = importMasters();
  const existing = new Set(S.assets.map(a => serialKeyOf(a.serial)).filter(Boolean));
  const seen = new Set(), t0 = today(), locked = !!S.settings.openingLocked, cutoff = S.settings.cutoff;
  return records.map(({row, r}) => {
    const errs = [], warns = [];
    const chk = (v, names, label) => { const x = exactIn(v, names, label); if (x.err) errs.push(x.err); return x.val; };
    const name = g(r, 'name'); if (!name) errs.push('Asset name is required');
    let t = null, s = null;
    const tv = g(r, 'type');
    if (!tv) errs.push('Type is required');
    else { const n = chk(tv, M.types.map(x => x.name), 'Type'); if (n) t = M.types.find(x => x.name === n);
      else if (S.types.some(x => x.name === tv && x.active === false)) { errs.pop(); errs.push(`Type "${tv}" is inactive`); } }
    const sv = g(r, 'subtype');
    if (!sv) errs.push('Subtype is required');
    else if (t){ const n = chk(sv, t.subs.map(x => x.name), `Subtype (for ${t.name})`); if (n) s = t.subs.find(x => x.name === n); }
    let tracking = g(r, 'tracking') || 'Individual'; if (g(r, 'tracking')) tracking = chk(tracking, TRACK_VALUES, 'Tracking');
    const qtyRaw = g(r, 'qty'), qty = qtyRaw === '' ? 1 : Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 1) errs.push('Quantity must be a whole number ≥ 1');
    else if (tracking === 'Individual' && qty !== 1) errs.push('Tracking is Individual, so Quantity must be 1 — add one row per unit, or set Tracking to Lot');
    const pd = parseDate(g(r, 'purchaseDate')); if (pd === null) errs.push('Purchase date is not a valid date'); else if (pd > t0) errs.push('Purchase date is in the future');
    const costRaw = g(r, 'cost'); if (costRaw && (!isNum(costRaw) || Number(costRaw) < 0)) errs.push('Unit cost must be a number ≥ 0 (no ₹ or commas)');
    const salv = g(r, 'salvage'); if (salv && (!isNum(salv) || Number(salv) < 0)) errs.push('Salvage value must be a number ≥ 0');
    const lifeRaw = g(r, 'life'); if (lifeRaw && (!isNum(lifeRaw) || Number(lifeRaw) < 0)) errs.push('Useful life must be a number ≥ 0');
    let source = 'Purchase'; const srcRaw = g(r, 'source');
    if (srcRaw){ const n = srcRaw === 'Opening' ? 'Opening balance' : srcRaw === 'Purchase' ? SOURCE_VALUES[0] : chk(srcRaw, SOURCE_VALUES, 'Source');
      if (n) source = n === 'Opening balance' ? 'Opening' : 'Purchase'; }
    if (source === 'Opening' && locked) errs.push('Opening balance is locked — use “New addition (purchase)”');
    if (source === 'Opening' && pd && cutoff && pd > cutoff) errs.push(`Opening-balance asset purchased after the cut-off date (${fmtDate(cutoff)})`);
    const serial = g(r, 'serial'), sk = serialKeyOf(serial);
    if (serialProblem(serial)) errs.push(serialProblem(serial));
    if (serial){ if (existing.has(sk)) errs.push(`Serial number ${serial} already exists`); else if (seen.has(sk)) errs.push(`Serial number ${serial} is repeated in the file`); seen.add(sk); }
    const vend = g(r, 'vendor') ? chk(g(r, 'vendor'), M.vendor, 'Vendor') || '' : '';
    const loc = g(r, 'location') ? chk(g(r, 'location'), M.location, 'Location') || '' : '';
    const wu = parseDate(g(r, 'warrantyUntil')); if (wu === null) errs.push('Warranty valid until is not a valid date'); else if (wu && pd && wu < pd) errs.push('Warranty end is before the purchase date');
    let unknown = false; const hu = g(r, 'holderUnknown');
    if (hu){ const n = /^y$/i.test(hu) ? 'Yes' : /^n$/i.test(hu) ? 'No' : chk(hu, YESNO, 'In use, holder unknown'); unknown = n === 'Yes'; }
    let dept = g(r, 'department') ? chk(g(r, 'department'), M.department, 'Department') || '' : '';
    const empId = g(r, 'employeeId'); let emp = null;
    if (empId){
      emp = M.employees.find(e => String(e.empId) === empId);
      if (!emp){ const any = S.employees.find(e => String(e.empId) === empId);
        errs.push(any ? `Employee ${empId} has exited (inactive)` : `Employee ID ${empId} is not in Masters`); }
      else if (g(r, 'department') && dept && emp.department !== dept) errs.push(`Employee ${empId} (${emp.name}) belongs to ${emp.department}, not ${dept}`);
      else dept = emp.department;
    }
    if (unknown && (g(r, 'department') || empId)) errs.push('“In use, holder unknown” is Yes, so leave Department and Employee ID blank');
    const ad = parseDate(g(r, 'assignedDate')); if (ad === null) errs.push('Assignment date is not a valid date');
    const er = parseDate(g(r, 'expectedReturn')); if (er === null) errs.push('Expected return date is not a valid date');
    const assignDate = ad || pd || t0;
    if (!dept && (ad || er)) errs.push('Assignment dates given without a Department / Employee ID');
    if (dept && er && er < assignDate) errs.push('Expected return date is before the assignment date');
    if (dept && ad && ad > t0) errs.push('Assignment date is in the future');
    if (dept && pd && ad && ad < pd) errs.push('Assignment date is before the purchase date');
    if (!isAdmin()){ const se = scopeError(loc, dept); if (se) errs.push(se); }
    if (!costRaw || !pd) warns.push('Data Incomplete');
    if (unknown) warns.push('Unassigned');
    let item = null;
    if (!errs.length){
      item = {base: {name, description: g(r, 'description'), typeId: t.id, typeName: t.name, typeCode: t.code, subCode: s.code, subtype: s.name,
        serial, make: g(r, 'make'), vendor: vend, invoice: g(r, 'invoice'), purchaseDate: pd || '', warrantyUntil: wu || '',
        cost: costRaw ? Number(costRaw) : null, salvage: salv ? Number(salv) : 0, life: lifeRaw ? Number(lifeRaw) : (Number(s.life) || 0),
        location: loc, locationDetail: g(r, 'position'), qty, source, method: 'SL', status: unknown ? 'Assigned' : 'In Stock', current: unknown ? {unknown: true} : {}}};
      if (dept) item.assign = {department: dept, employeeId: emp ? String(emp.empId) : '', employeeName: emp?.name || '', date: assignDate, expectedReturn: er || '', notes: g(r, 'notes')};
    }
    return {row, r, errs, warns, item};
  });
}

function importDialog(){
  const M = importMasters();
  const body = `<div class="note"><b>Step 1.</b> Download the Excel template — it is generated from your current Masters: <b>${M.types.length}</b> types, <b>${sum(M.types, t => t.subs.length)}</b> subtypes, <b>${M.vendor.length}</b> vendors, <b>${M.location.length}</b> locations, <b>${M.department.length}</b> departments, <b>${M.employees.length}</b> employees.
      Its columns are exactly the fields of the Add-asset form, and master fields are dropdowns. <b>Step 2.</b> Fill one row per asset (55 cameras = 55 rows). <b>Step 3.</b> Upload it here — every row is checked against Masters before anything is saved.</div>
    <div class="toolbar"><button class="btn gold" id="tpl">⬇ Download Excel template</button><span class="spacer"></span>
      <label class="btn primary" style="position:relative;overflow:hidden">⬆ Choose filled file<input type="file" id="file" accept=".xlsx,.csv" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label></div>
    <div id="prev"></div>`;
  openModal('Bulk import assets', body, {wide: true, onMount: m => {
    const prev = $('#prev', m);
    $('#tpl', m).onclick = async e => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Preparing…';
      try { await downloadTemplate(); toast('Template downloaded'); } catch (err){ toast(errMsg(err), 'err'); }
      finally { b.disabled = false; b.textContent = '⬇ Download Excel template'; } };
    $('#file', m).onchange = async e => {
      const file = e.target.files[0]; if (!file) return; e.target.value = '';
      prev.innerHTML = '<div class="sub">Reading file…</div>';
      let parsed;
      try { parsed = await readImportFile(file); } catch (err){ return (prev.innerHTML = `<div class="err">${esc(errMsg(err))}</div>`); }
      const hm = mapHeaders(parsed.headers);
      if (hm.unknown.length || hm.missing.length || hm.dupes.length){
        return (prev.innerHTML = `<div class="err"><b>The columns don't match the template, so nothing was imported.</b>
          ${hm.unknown.length ? `<br>Unknown column(s): ${hm.unknown.map(esc).join(', ')}` : ''}
          ${hm.dupes.length ? `<br>Repeated column(s): ${hm.dupes.map(esc).join(', ')}` : ''}
          ${hm.missing.length ? `<br>Missing required column(s): ${hm.missing.map(esc).join(', ')}` : ''}
          <br>Download a fresh template and copy your data into it.</div>`);
      }
      if (!parsed.data.length) return (prev.innerHTML = '<div class="err">The file has no data rows.</div>');
      if (parsed.data.length > 3000) return (prev.innerHTML = '<div class="err">Please import at most 3,000 rows per file.</div>');
      const records = parsed.data.map(d => { const r = {}; hm.map.forEach((k, i) => { if (k) r[k.toLowerCase()] = d.vals[i] ?? ''; }); return {row: d.rn, r}; });
      const res = validateImport(records), ok = res.filter(x => x.item), bad = res.filter(x => !x.item);
      prev.innerHTML = `
        <div class="toolbar"><span class="sub">${esc(file.name)}</span><span class="chip green">${ok.length} ready</span><span class="chip red">${bad.length} with errors</span>
          <span class="chip amber">${res.filter(x => x.item && x.warns.length).length} with warnings</span><span class="spacer"></span>
          ${bad.length ? '<button class="btn sm" id="errDl">⬇ Error report</button>' : ''}
          <button class="btn teal" id="doImp" ${ok.length ? '' : 'disabled'}>Import ${ok.length} row${ok.length === 1 ? '' : 's'}</button></div>
        ${bad.length && ok.length ? '<div class="sub" style="margin-bottom:8px">Rows with errors are skipped. Fix them (download the error report) and upload those rows again.</div>' : ''}
        <div class="tbl-wrap" style="max-height:45vh"><table><thead><tr><th>Excel row</th><th>Result</th><th>Asset name</th><th>Type › Subtype</th><th>Qty</th><th>Serial</th><th>Vendor</th><th>Location</th><th>Holder</th></tr></thead><tbody>
        ${[...bad, ...ok].slice(0, 300).map(x => `<tr><td>${x.row}</td>
          <td class="wrap" style="min-width:280px">${x.errs.length ? `<span style="color:var(--red)">${x.errs.map(esc).join('<br>')}</span>` : x.warns.length ? `<span class="flag">${esc(x.warns.join(', '))}</span>` : '<span style="color:var(--green)">OK</span>'}</td>
          <td>${esc(g(x.r, 'name'))}</td><td>${esc(g(x.r, 'type'))} › ${esc(g(x.r, 'subtype'))}</td><td>${esc(g(x.r, 'qty') || 1)}</td>
          <td>${esc(g(x.r, 'serial'))}</td><td>${esc(g(x.r, 'vendor'))}</td><td>${esc([g(x.r, 'location'), g(x.r, 'position')].filter(Boolean).join(' · '))}</td>
          <td>${esc(x.item?.assign ? (x.item.assign.employeeName || x.item.assign.department + ' pool') : (x.item?.base.current.unknown ? 'Unknown' : '—'))}</td>
          </tr>`).join('')}
        </tbody></table></div>${res.length > 300 ? `<div class="sub" style="margin-top:6px">Showing first 300 of ${res.length} rows (errors first).</div>` : ''}
        <div class="err" id="fe" hidden></div>`;
      if (bad.length) $('#errDl', m).onclick = () => download(`asset_import_errors_${today()}.csv`,
        toCSV(['Row', ...FIELDS.map(f => f.label), 'Errors'], bad.map(x => [x.row, ...FIELDS.map(f => g(x.r, f.key)), x.errs.join('; ')])));
      $('#doImp', m).onclick = ev => busy(ev.target, async () => {
        if (bad.length && !confirm(`${bad.length} row(s) have errors and will be skipped. Import the ${ok.length} valid row(s)?`)) return;
        const btn = ev.target;
        const items = ok.map(x => ({...x.item, row: x.row}));
        const res = await createAssetRecords(items, `Bulk import (${file.name})`, (n, total) => { btn.textContent = `Saving ${n} / ${total}…`; });
        const ids = res.created;
        if (!res.failed){ closeModal(); toast(`Imported ${ids.length} assets (${ids[0]}${ids.length > 1 ? ' … ' + ids[ids.length - 1] : ''})`); return; }
        // Partial failure: report exactly what was and was not saved; offer the unsaved rows for download.
        const rest = res.failed.items;
        prev.innerHTML = `<div class="err"><b>Import stopped.</b> ${ids.length ? `${ids.length} row(s) were saved (${ids[0]} … ${ids[ids.length - 1]}).` : 'Nothing was saved.'}
          <br>Reason: ${esc(errMsg(res.failed.error))}
          <br><b>${rest.length} row(s) were NOT saved</b> (Excel rows ${rest.slice(0, 15).map(x => x.row).join(', ')}${rest.length > 15 ? '…' : ''}).</div>
          <div class="toolbar" style="margin-top:10px"><button class="btn sm" id="restDl">⬇ Rows not saved</button></div>`;
        const byRow = new Map(ok.map(x => [x.row, x]));
        $('#restDl', m).onclick = () => download(`asset_import_not_saved_${today()}.csv`,
          toCSV(FIELDS.map(f => f.label), rest.map(it => FIELDS.map(f => g(byRow.get(it.row).r, f.key)))));
        throw Object.assign(new Error('Import stopped — see details above.'), {shown: true});
      });
    };
  }});
}

export { EXCELJS_URL, excelLoading, loadExcel, TRACK_VALUES, SOURCE_VALUES, YESNO, TEMPLATE_ROWS, FIELDS, colLetter, importMasters, downloadTemplate, cellText, readImportFile, mapHeaders, exactIn, validateImport, importDialog };
