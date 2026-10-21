import { collection, db, doc, serverTimestamp } from './firebase.js';
import { depr, isNum, qtyOf, serialKeyOf, serialProblem, today } from './calc.js';
import { $, $$, activeDepts, byName, canManage, chip, closeAssignment, createAssetRecords, curSym, empById, errMsg, esc, exceptions, fmtDate, holderHtml, holderText, inScope, isAdmin, isWriter, locSelect, locText, mgrDepts, mgrLocs, money, S, scopeError, STATUS_LABEL, subLabel, toast, txRef, typeLabel, updateAsset, vendorOf, vendorSelect, warrantyChip } from './core.js';
import { actionsRow, busy, closeModal, formErr, formObj, openModal } from './ui.js';
import { vendorForm } from './masters.js';

/* =====================================================================
   ASSET FORMS & ACTIONS
   ===================================================================== */
function assetForm(a = null){
  const isNew = !a, locked = !!S.settings.openingLocked;
  // Managers may not change financial or identity fields of an existing asset (enforced by the security rules).
  const lockOpening = !isNew && !isAdmin();
  const types = S.types.filter(t => t.active !== false || (a && t.id === a.typeId)).sort(byName);
  if (isNew && !types.length){ toast('Add asset types in Masters first.', 'err'); return; }
  const v = a || {source: 'Purchase', qty: 1};
  const body = `<form id="fm" class="form" autocomplete="off">
    <label class="f"><span class="req">Type</span><select name="typeId" ${a ? 'disabled' : ''}>${types.map(t => `<option value="${t.id}" ${v.typeId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <label class="f"><span class="req">Subtype</span><select name="subCode" ${a ? 'disabled' : ''}></select></label>
    <label class="f full"><span class="req">Asset name</span><input name="name" value="${esc(v.name || '')}" placeholder="e.g. Dell Latitude 5440"></label>
    <label class="f full">Description<textarea name="description">${esc(v.description || '')}</textarea></label>
    ${isNew ? `
      <label class="f">Tracking<select name="mode"><option value="unit">Individual — one record per item</option><option value="lot">Lot — one record with quantity</option></select></label>
      <label class="f"><span class="req" id="cntLbl">Number of units</span><input type="number" name="count" min="1" max="200" value="1"></label>`
    : `<label class="f">Quantity<input type="number" name="qty" min="1" value="${qtyOf(a)}" ${lockOpening ? 'disabled' : ''}></label><div></div>`}
    <label class="f">Serial number<input name="serial" value="${esc(v.serial || '')}" ${lockOpening ? 'disabled' : ''}></label>
    <label class="f">Make / model<input name="make" value="${esc(v.make || '')}"></label>
    <label class="f">Vendor ${isAdmin() ? '<button type="button" class="linkbtn" id="newVendor" style="font-size:12px">＋ new vendor</button>' : ''}${vendorSelect('vendor', v.vendor || '')}</label>
    <label class="f">Invoice reference<input name="invoice" value="${esc(v.invoice || '')}"></label>
    <label class="f">Purchase date<input type="date" name="purchaseDate" value="${esc(v.purchaseDate || '')}" max="${today()}" ${lockOpening ? 'disabled' : ''}></label>
    <label class="f">Unit cost (${curSym()})<input type="number" step="0.01" min="0" name="cost" value="${isNum(v.cost) ? v.cost : ''}" ${lockOpening ? 'disabled' : ''}></label>
    <label class="f">Useful life (years)<input type="number" step="0.5" min="0" name="life" value="${isNum(v.life) ? v.life : ''}" ${lockOpening ? 'disabled' : ''}></label>
    <label class="f">Salvage value (record total)<input type="number" step="0.01" min="0" name="salvage" value="${isNum(v.salvage) ? v.salvage : 0}" ${lockOpening ? 'disabled' : ''}></label>
    <label class="f"><span id="locLbl">Location</span>${locSelect('location', v.location || '')}</label>
    <label class="f">Position / sub-location<input name="locationDetail" value="${esc(v.locationDetail || '')}" placeholder="e.g. Tower B – Main gate pole 2"></label>
    <label class="f">Source<select name="source" ${(!isNew && (locked || lockOpening)) ? 'disabled' : ''}>
      <option value="Purchase" ${v.source === 'Purchase' ? 'selected' : ''}>New addition (purchase)</option>
      <option value="Opening" ${v.source === 'Opening' ? 'selected' : ''} ${locked ? 'disabled' : ''}>Opening balance${locked ? ' (locked)' : ''}</option></select></label>
    <label class="f">Warranty valid until<input type="date" name="warrantyUntil" value="${esc(v.warrantyUntil || '')}"></label>
    ${isNew ? `<label class="check full"><input type="checkbox" name="holderUnknown"> In use, but holder unknown (will be flagged “Unassigned”)</label>` : ''}
    <div class="full hint">Missing cost or purchase date is allowed — the asset is flagged “Data Incomplete” and left out of depreciation until fixed.${lockOpening ? ' Serial number, quantity, dates, cost, life, salvage and source can only be changed by an admin.' : ''}</div>
  </form>${isNew ? '<div id="units" hidden></div>' : ''}${actionsRow(isNew ? 'Add asset' : 'Save changes')}`;

  openModal(isNew ? 'Add asset' : `Edit ${esc(a.assetId)}`, body, {wide: isNew, onMount: m => {
    const fm = $('#fm', m), tSel = fm.typeId, sSel = fm.subCode, units = $('#units', m);
    const readUnits = () => units ? $$('tr[data-u]', units).map(tr => ({
      serial: $('[data-k=serial]', tr).value.trim(), location: $('[data-k=loc]', tr).value, detail: $('[data-k=det]', tr).value.trim()})) : [];
    const renderUnits = (n, fill) => {
      if (!(n >= 2 && n <= 200)) return;
      const prev = fill || readUnits(), def = fm.location.value;
      const sel = (loc, attrs) => locSelect('', loc, {attrs: `class="grid-in" ${attrs}`});
      units.innerHTML = `<div class="section-t">Unit details — serial number and location for each of the ${n} units</div>
        <div class="toolbar">
          <span class="sub">Set every unit's location to</span>${sel(def, 'id="allLoc" style="width:auto"')}
          <button type="button" class="btn sm" id="applyLoc">Apply to all</button><span class="spacer"></span>
          <button type="button" class="btn sm" id="pasteBtn">⧉ Paste from Excel</button></div>
        <div id="pasteBox" hidden style="margin-bottom:10px">
          <textarea id="pasteTxt" class="grid-in" style="min-height:120px;font-family:ui-monospace,monospace;font-size:13px" placeholder="One unit per line. Copy 1, 2 or 3 columns from Excel:&#10;Serial&#9;Location&#9;Position&#10;HKV-K12345&#9;Head Office&#9;Reception&#10;HKV-K12346&#9;Head Office&#9;Car park entry"></textarea>
          <div class="toolbar" style="margin-top:6px"><button type="button" class="btn sm teal" id="pasteGo">Fill rows</button>
          <span class="sub">The number of units changes to match the number of lines.</span></div></div>
        <div class="sub" id="pasteMsg" style="margin-bottom:6px"></div>
        <div class="tbl-wrap" style="max-height:46vh"><table><thead><tr><th>#</th><th>Serial number</th><th>Location</th><th>Position / sub-location</th></tr></thead><tbody>
        ${Array.from({length: n}, (_, i) => { const p = prev[i] || {}, loc = i < prev.length ? p.location : def;
          return `<tr data-u="${i}"><td>${i + 1}</td>
          <td><input class="grid-in" data-k="serial" value="${esc(p.serial || '')}" placeholder="Serial no."></td>
          <td>${sel(loc || '', 'data-k="loc"')}</td>
          <td><input class="grid-in" data-k="det" value="${esc(p.detail || '')}" placeholder="e.g. Tower B – Lift lobby"></td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="hint" style="margin-top:6px">Each unit is saved as its own asset record (e.g. ELE-CAM-0001 … ELE-CAM-00${String(n).padStart(2, '0')}) with its own serial, location and history.</div>`;
      $('#applyLoc', units).onclick = () => { const v2 = $('#allLoc', units).value; $$('[data-k=loc]', units).forEach(s => s.value = v2); };
      $('#pasteBtn', units).onclick = () => { const b = $('#pasteBox', units); b.hidden = !b.hidden; if (!b.hidden) $('#pasteTxt', units).focus(); };
      $('#pasteGo', units).onclick = () => {
        const lines = $('#pasteTxt', units).value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return;
        if (lines.length > 200) return ($('#pasteMsg', units).textContent = 'Paste at most 200 lines.');
        if (lines.length < 2) return ($('#pasteMsg', units).textContent = 'For a single unit, type the serial in the form above.');
        let unknown = 0; const d = fm.location.value;
        const rows = lines.map(l => {
          const c = (l.includes('\t') ? l.split('\t') : l.split(',')).map(x => x.trim());
          let loc = d;
          if (c[1]){ const hit = S.locations.find(x => x.name.toLowerCase() === c[1].toLowerCase() && x.active !== false); if (hit) loc = hit.name; else unknown++; }
          return {serial: c[0] || '', location: loc, detail: c[2] || ''};
        });
        fm.count.value = rows.length; renderUnits(rows.length, rows);
        $('#pasteMsg', units).innerHTML = `Filled ${rows.length} units.${unknown ? ` <span class="flag">${unknown} location name(s) not found in Masters → Locations; those rows use the default location.</span>` : ''}`;
      };
    };
    const fillSubs = () => {
      const t = S.types.find(x => x.id === tSel.value);
      const subs = (t?.subtypes || []).filter(s => s.active !== false || (a && s.code === a.subCode));
      sSel.innerHTML = subs.map(s => `<option value="${esc(s.code)}" ${v.subCode === s.code ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      if (isNew){ const s = subs.find(x => x.code === sSel.value); if (s && isNum(s.life) && fm.life.value === '') fm.life.value = s.life; }
    };
    tSel.onchange = () => { fm.life.value = ''; fillSubs(); };
    sSel.onchange = () => { if (isNew){ const t = S.types.find(x => x.id === tSel.value); const s = t?.subtypes?.find(x => x.code === sSel.value); if (s && isNum(s.life)) fm.life.value = s.life; } };
    fillSubs();
    const nv = $('#newVendor', m);
    if (nv) nv.onclick = () => { const keep = formObj(fm); vendorForm(null, name => { assetForm(a); setTimeout(() => {
      const f2 = $('#fm'); if (!f2) return;
      ['name','description','make','invoice','purchaseDate','cost','life','salvage','warrantyUntil'].forEach(k => { if (f2[k] && keep[k] !== undefined) f2[k].value = keep[k]; });
      if (f2.vendor){ if (![...f2.vendor.options].some(o => o.value === name)) f2.vendor.add(new Option(name, name)); f2.vendor.value = name; } }, 60); }); };
    if (isNew){
      const sync = () => {
        const lot = fm.mode.value === 'lot', n = Math.floor(Number(fm.count.value)) || 0, multi = !lot && n > 1;
        $('#cntLbl').textContent = lot ? 'Quantity in lot' : 'Number of units';
        fm.serial.disabled = multi; if (multi) fm.serial.value = '';
        fm.locationDetail.disabled = multi; if (multi) fm.locationDetail.value = '';
        $('#locLbl').textContent = multi ? 'Default location (copied to each unit)' : 'Location';
        units.hidden = !multi;
        if (multi) renderUnits(n);
      };
      fm.mode.onchange = sync; fm.count.oninput = sync;
      fm.location.addEventListener('change', () => { if (!units.hidden) $$('[data-k=loc]', units).forEach(s => { if (!s.value) s.value = fm.location.value; }); });
    }
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj(fm);
      const typeId = a ? a.typeId : f.typeId, subCode = a ? a.subCode : f.subCode;
      const t = S.types.find(x => x.id === typeId), s = t?.subtypes?.find(x => x.code === subCode);
      const source = f.source || v.source;
      if (!t || !s) return formErr('Choose a type and subtype.');
      if (!f.name?.trim()) return formErr('Asset name is required.');
      if (f.purchaseDate && f.purchaseDate > today()) return formErr('Purchase date cannot be in the future.');
      if (isNum(f.cost) && Number(f.cost) < 0) return formErr('Cost cannot be negative.');
      if (f.warrantyUntil && f.purchaseDate && f.warrantyUntil < f.purchaseDate) return formErr('Warranty end date cannot be before the purchase date.');
      if (source === 'Opening' && f.purchaseDate && S.settings.cutoff && f.purchaseDate > S.settings.cutoff)
        return formErr(`Opening-balance assets must be purchased on or before the cut-off date (${fmtDate(S.settings.cutoff)}).`);
      const serial = lockOpening ? (a.serial || '') : (f.serial || '').trim();
      if (serialProblem(serial)) return formErr(serialProblem(serial));
      if (serial){
        const dup = S.assets.find(x => x.assetId !== a?.assetId && serialKeyOf(x.serial) === serialKeyOf(serial));
        if (dup) return formErr(`Serial number already used by ${dup.assetId}.`);
      }
      const common = {
        name: f.name.trim(), description: (f.description || '').trim(), serial, make: (f.make || '').trim(),
        vendor: (f.vendor || '').trim(), invoice: (f.invoice || '').trim(), location: (f.location || '').trim(),
        locationDetail: (f.locationDetail || '').trim(), warrantyUntil: f.warrantyUntil || '',
      };
      if (!lockOpening){
        common.life = isNum(f.life) ? Number(f.life) : (isNum(s.life) ? Number(s.life) : 0);
        common.salvage = isNum(f.salvage) ? Number(f.salvage) : 0;
      }
      if (!lockOpening){ common.purchaseDate = f.purchaseDate || ''; common.cost = isNum(f.cost) ? Number(f.cost) : null; }
      if (isNew){
        const count = Math.floor(Number(f.count));
        if (!(count >= 1 && count <= 200)) return formErr('Enter between 1 and 200.');
        const lot = f.mode === 'lot', unknown = !!f.holderUnknown;
        const base = {...common, typeId: t.id, typeName: t.name, typeCode: t.code, subCode: s.code, subtype: s.name,
          method: 'SL', source, qty: lot ? count : 1, status: unknown ? 'Assigned' : 'In Stock', current: unknown ? {unknown: true} : {}};
        let items;
        if (!lot && count > 1){
          const ud = readUnits();
          if (ud.length !== count) return formErr('Unit grid is out of date — re-enter the number of units.');
          const seen = new Map();
          for (const [i, u] of ud.entries()){
            const se = scopeError(u.location, '');
            if (se && !unknown) return formErr(`Unit ${i + 1}: ${se}`);
            if (serialProblem(u.serial)) return formErr(`Unit ${i + 1}: ${serialProblem(u.serial)}`);
            if (!u.serial) continue;
            const k = serialKeyOf(u.serial);
            if (seen.has(k)) return formErr(`Serial ${u.serial} is entered twice (units ${seen.get(k) + 1} and ${i + 1}).`);
            seen.set(k, i);
            const dup = S.assets.find(x => serialKeyOf(x.serial) === k);
            if (dup) return formErr(`Unit ${i + 1}: serial ${u.serial} is already used by ${dup.assetId}.`);
          }
          const noSer = ud.filter(u => !u.serial).length, noLoc = ud.filter(u => !u.location).length;
          const warn = [noSer && `${noSer} unit(s) have no serial number`, noLoc && `${noLoc} unit(s) have no location`].filter(Boolean);
          if (warn.length && !confirm(`${warn.join(' and ')}. Add all ${count} units anyway? You can fill these in later by editing each asset.`)) return;
          items = ud.map(u => ({base: {...base, serial: u.serial, location: u.location, locationDetail: u.detail}}));
        } else {
          const se = scopeError(base.location, '');
          if (se) return formErr(se);
          items = [{base: {...base}}];
        }
        const btn = $('#go', m);
        const res = await createAssetRecords(items, '', (n, total) => { if (total > 1) btn.textContent = `Saving ${n} / ${total}…`; });
        const ids = res.created;
        if (res.failed){
          // Accurate partial-failure report: nothing is claimed that was not saved.
          return formErr(`${ids.length ? `Saved ${ids.length} of ${items.length} (${ids[0]} … ${ids[ids.length - 1]}). ` : 'Nothing was saved. '}`
            + `Stopped because: ${errMsg(res.failed.error)} — the remaining ${res.failed.items.length} unit(s) were NOT saved.`);
        }
        closeModal(); toast(ids.length === 1 ? `Added ${ids[0]}` : `Added ${ids.length} assets (${ids[0]} … ${ids[ids.length - 1]})`);
      } else {
        const patch = {...common};
        delete patch.serial;   // serial changes go through the serial index (below)
        if (!lockOpening && isNum(f.qty)) patch.qty = Math.max(1, Math.floor(Number(f.qty)));
        if (!locked && !lockOpening && f.source) patch.source = f.source;
        if (!isAdmin() && !inScope({...a, location: common.location}))
          return formErr(`You can only move assets to your own locations (${mgrLocs().join(', ') || 'none'}), unless the asset is held by your department.`);
        const moved = (a.location || '') !== common.location || (a.locationDetail || '') !== common.locationDetail;
        const serialChanged = !lockOpening && serialKeyOf(serial) !== serialKeyOf(a.serial) ;
        await updateAsset(a, patch, moved ? 'Relocate' : 'Edit',
          moved ? `Location: ${locText(a) || '—'} → ${[common.location, common.locationDetail].filter(Boolean).join(' · ') || '—'}` : (serialChanged ? `Serial: ${a.serial || '—'} → ${serial || '—'}` : 'Details updated'),
          null, serialChanged ? {serial: {serial}} : {});
        closeModal(); toast('Asset updated');
      }
    });
  }});
}

function assignDialog(a){
  const c = a.current || {};
  // Managers: own departments only, unless the asset sits at one of their locations (mirrors the rules).
  const deptChoices = isAdmin() || (a.location && mgrLocs().includes(a.location)) ? activeDepts() : activeDepts().filter(d => mgrDepts().includes(d.name));
  const body = `<form id="fm" class="form">
    ${c.department ? `<div class="note full">Currently with <b>${esc(holderText(a))}</b> since ${fmtDate(c.assignedDate)}. Saving closes that assignment and opens a new one — history is kept.</div>` : ''}
    ${c.unknown ? `<div class="note full">This asset is flagged <b>Unassigned</b> (holder unknown). Recording the holder resolves the flag.</div>` : ''}
    <label class="f"><span class="req">Department</span><select name="department"><option value="">Select…</option>${deptChoices.map(d => `<option>${esc(d.name)}</option>`).join('')}</select></label>
    ${deptChoices.length < activeDepts().length ? `<div class="full hint">You can assign within your authorised scope only. Transfers to other departments need an admin.</div>` : ''}
    <label class="f">Employee<select name="employeeId"></select></label>
    <label class="f"><span class="req">${c.department ? 'Transfer' : 'Assignment'} date</span><input type="date" name="date" value="${today()}" max="${today()}"></label>
    <label class="f">Expected return date<input type="date" name="expectedReturn"><span class="hint">Leave blank for a permanent issue.</span></label>
    <label class="f">Condition at issue<select name="condition"><option>Good</option><option>Fair</option><option>Damaged</option></select></label>
    <div></div>
    <label class="f full">Notes<textarea name="notes" placeholder="e.g. Issued with charger and bag"></textarea></label>
  </form>${actionsRow(c.department ? 'Transfer' : 'Assign')}`;
  openModal(`${c.department ? 'Transfer' : 'Assign'} ${esc(a.assetId)} · ${esc(a.name)}`, body, {onMount: m => {
    const fm = $('#fm', m);
    const fill = () => {
      const list = S.employees.filter(e => e.active !== false && (!fm.department.value || e.department === fm.department.value)).sort(byName);
      fm.employeeId.innerHTML = `<option value="">— Department pool (no individual) —</option>` +
        list.map(e => `<option value="${esc(e.empId)}">${esc(e.name)} (${esc(e.empId)})${fm.department.value ? '' : ' · ' + esc(e.department)}</option>`).join('');
    };
    fm.department.onchange = fill;
    fm.employeeId.onchange = () => { const e = empById(fm.employeeId.value); if (e && !fm.department.value){ fm.department.value = e.department; const keep = e.empId; fill(); fm.employeeId.value = keep; } };
    fill();
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj(fm), emp = f.employeeId ? empById(f.employeeId) : null;
      if (!f.department) return formErr('Choose a department.');
      if (!f.date) return formErr('Date is required.');
      if (emp && emp.department !== f.department) return formErr(`${emp.name} belongs to ${emp.department}.`);
      if (c.assignedDate && f.date < c.assignedDate) return formErr('Transfer date cannot be before the current assignment date.');
      if (f.expectedReturn && f.expectedReturn < f.date) return formErr('Expected return date must be on or after the assignment date.');
      if (c.department && c.department === f.department && (c.employeeId || '') === (f.employeeId || '')) return formErr('That is the current holder.');
      const kind = c.department ? 'Transfer' : 'Assign';
      const aRef = doc(collection(db, 'assignments'));
      const current = {assignmentId: aRef.id, department: f.department, employeeId: emp?.empId || '', employeeName: emp?.name || '',
        assignedDate: f.date, expectedReturn: f.expectedReturn || '', notes: (f.notes || '').trim()};
      const toTxt = emp ? `${emp.name} (${emp.empId}), ${f.department}` : `${f.department} pool`;
      await updateAsset(a, {status: 'Assigned', current}, kind, `${c.department ? 'From ' + holderText(a) + ' → ' : 'To '}${toTxt}`, (tx, fresh, tref) => {
        closeAssignment(tx, fresh, f.date, 'Transfer', f.condition);
        tx.set(aRef, {txRef: tref,assetId: a.assetId, assetName: a.name, department: f.department, employeeId: emp?.empId || '',
          employeeName: emp?.name || '', startDate: f.date, endDate: null, expectedReturn: f.expectedReturn || '',
          conditionOut: f.condition, conditionIn: '', notes: (f.notes || '').trim(), kind, fromHolder: c.department ? holderText(a) : '',
          issuedBy: S.user.uid, issuedByName: S.profile.name, closeReason: '', createdAt: serverTimestamp()});
      });
      closeModal(); toast(`${a.assetId} ${kind === 'Transfer' ? 'transferred' : 'assigned'} to ${toTxt}`);
    });
  }});
}

function returnDialog(a){
  const c = a.current || {};
  const body = `<form id="fm" class="form">
    <div class="note full">Returning from <b>${esc(holderText(a))}</b>, assigned ${fmtDate(c.assignedDate)}.</div>
    <label class="f"><span class="req">Return date</span><input type="date" name="date" value="${today()}" max="${today()}"></label>
    <label class="f">Condition on return<select name="condition"><option>Good</option><option>Fair</option><option>Damaged</option></select></label>
    <label class="f full">Next status<select name="outcome"><option value="In Stock">Back to stock (available)</option><option value="Under Repair">Send to repair</option></select></label>
    <label class="f full">Notes<textarea name="notes"></textarea></label>
  </form>${actionsRow('Record return')}`;
  openModal(`Return ${esc(a.assetId)} · ${esc(a.name)}`, body, {onMount: m => {
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj($('#fm', m));
      if (!f.date) return formErr('Return date is required.');
      if (c.assignedDate && f.date < c.assignedDate) return formErr('Return date cannot be before the assignment date.');
      const patch = {status: f.outcome, current: {}};
      if (f.outcome === 'Under Repair') patch.repair = {since: f.date, notes: (f.notes || '').trim()};
      await updateAsset(a, patch, 'Return', `From ${holderText(a)} · condition ${f.condition}${f.notes ? ' · ' + f.notes : ''}`,
        (tx, fresh) => closeAssignment(tx, fresh, f.date, 'Return', f.condition));
      closeModal(); toast(`${a.assetId} returned`);
    });
  }});
}

function simpleStatusDialog(a, {title, label, to, action, extraPatch = () => ({}), closeReason, cls = 'teal', intro = ''}){
  const body = `<form id="fm" class="form">${intro ? `<div class="note full">${intro}</div>` : ''}
    <label class="f"><span class="req">Date</span><input type="date" name="date" value="${today()}" max="${today()}"></label><div></div>
    <label class="f full">Notes<textarea name="notes"></textarea></label></form>${actionsRow(label, cls)}`;
  openModal(`${title} · ${esc(a.assetId)}`, body, {onMount: m => {
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj($('#fm', m)); if (!f.date) return formErr('Date is required.');
      const patch = {status: to, ...extraPatch(f)};
      if (closeReason) patch.current = {};
      await updateAsset(a, patch, action, f.notes || '', closeReason ? (tx, fresh) => closeAssignment(tx, fresh, f.date, closeReason) : null);
      closeModal(); toast(`${a.assetId}: ${STATUS_LABEL(to)}`);
    });
  }});
}

function disposeDialog(a){
  const body = `<form id="fm" class="form">
    ${a.status === 'Assigned' ? `<div class="note full">This asset is currently with <b>${esc(holderText(a))}</b>. Disposing closes that assignment.</div>` : ''}
    <label class="f"><span class="req">Disposal date</span><input type="date" name="date" value="${today()}" max="${today()}"></label>
    <label class="f"><span class="req">Reason</span><select name="reason"><option>End of life</option><option>Damaged beyond repair</option><option>Obsolete</option><option>Lost / stolen</option><option>Sold</option><option>Other</option></select></label>
    <label class="f"><span class="req">Method</span><select name="method"><option>Scrap</option><option>Sale</option><option>Donation</option><option>Write-off</option><option>Buy-back by employee</option><option>E-waste recycler</option></select></label>
    <label class="f">Sale / recovery value (${curSym()})<input type="number" step="0.01" min="0" name="value" value="0"></label>
    <div class="full sub" id="nbvInfo"></div>
    <label class="f full">Notes<textarea name="notes"></textarea></label>
  </form>${actionsRow('Dispose asset', 'danger')}`;
  openModal(`Dispose ${esc(a.assetId)} · ${esc(a.name)}`, body, {onMount: m => {
    const fm = $('#fm', m);
    const info = () => { const d = depr(a, fm.date.value || today()); $('#nbvInfo').textContent = d ? `Net book value on this date: ${money(d.nbv)} (cost ${money(d.value)}, accumulated depreciation ${money(d.acc)})` : 'Cost or purchase date missing — net book value unknown.'; };
    fm.date.oninput = info; info();
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj(fm); if (!f.date) return formErr('Disposal date is required.');
      if (a.purchaseDate && f.date < a.purchaseDate) return formErr('Disposal date cannot be before the purchase date.');
      if (!confirm(`Dispose ${a.assetId}? This is permanent (the record is kept for the log).`)) return;
      const nbv = depr({...a, status: 'In Stock'}, f.date)?.nbv ?? null;
      const disposal = {date: f.date, reason: f.reason, method: f.method, value: Number(f.value) || 0, nbvAtDisposal: nbv,
        notes: (f.notes || '').trim(), approvedBy: S.profile.name, approvedByUid: S.user.uid};
      await updateAsset(a, {status: 'Disposed', current: {}, disposal}, 'Dispose', `${f.reason} · ${f.method}`,
        (tx, fresh) => closeAssignment(tx, fresh, f.date, 'Disposal'));
      closeModal(); toast(`${a.assetId} disposed`);
    });
  }});
}

const ASSET_ACT = {
  edit: a => assetForm(a),
  assign: a => assignDialog(a),
  ret: a => returnDialog(a),
  repair: a => simpleStatusDialog(a, {title: 'Send to repair', label: 'Send to repair', to: 'Under Repair', action: 'Repair',
    extraPatch: f => ({repair: {since: f.date, notes: (f.notes || '').trim()}}), cls: 'gold'}),
  repaired: a => simpleStatusDialog(a, {title: 'Repair complete', label: 'Back to stock', to: 'In Stock', action: 'Repair complete',
    extraPatch: () => ({repair: null})}),
  lost: a => simpleStatusDialog(a, {title: 'Mark lost', label: 'Mark lost', to: 'Lost', action: 'Marked lost', closeReason: 'Lost', cls: 'danger',
    intro: 'The asset moves to “Lost – Pending Review” and appears on the exceptions report until it is found or disposed.',
    extraPatch: f => ({lost: {date: f.date, notes: (f.notes || '').trim()}})}),
  found: a => simpleStatusDialog(a, {title: 'Mark found', label: 'Back to stock', to: 'In Stock', action: 'Found', extraPatch: () => ({lost: null})}),
  dispose: a => disposeDialog(a)
};

function showAsset(id){
  const a = S.assets.find(x => x.assetId === id); if (!a) return;
  const c = a.current || {}, d = depr(a), can = isWriter() && canManage(a) && a.status !== 'Disposed';
  const hist = S.assignments.filter(h => h.assetId === id)
    .sort((x, y) => (y.startDate || '').localeCompare(x.startDate || '') || ((y.createdAt?.seconds || 9e9) - (x.createdAt?.seconds || 9e9)));
  const log = [...(a.log || [])].reverse();
  const btn = (k, l, cls = '') => `<button class="btn sm ${cls}" data-aact="${k}">${l}</button>`;
  const actions = [
    can && btn('edit', 'Edit'),
    can && ['In Stock', 'Assigned'].includes(a.status) && btn('assign', a.status === 'Assigned' && c.department ? 'Transfer' : 'Assign', 'teal'),
    can && a.status === 'Assigned' && c.department && btn('ret', 'Return'),
    can && a.status === 'In Stock' && btn('repair', 'Send to repair'),
    can && a.status === 'Under Repair' && btn('repaired', 'Repair complete', 'teal'),
    can && ['In Stock', 'Assigned', 'Under Repair'].includes(a.status) && btn('lost', 'Mark lost'),
    isAdmin() && a.status === 'Lost' && btn('found', 'Mark found', 'teal'),
    isAdmin() && a.status !== 'Disposed' && btn('dispose', 'Dispose', 'danger')
  ].filter(Boolean).join('');
  const body = `
    <div class="dl">
      <div><span>Status</span>${chip(a.status)}</div>
      <div><span>Type › Subtype</span>${esc(typeLabel(a))} › ${esc(subLabel(a))}</div>
      <div><span>Source</span>${a.source === 'Opening' ? '<span class="chip gold">Opening balance</span>' : 'New addition'}</div>
      <div><span>Serial</span>${esc(a.serial || '—')}</div>
      <div><span>Make / model</span>${esc(a.make || '—')}</div>
      <div><span>Quantity</span>${qtyOf(a)}</div>
      <div><span>Purchase date</span>${a.purchaseDate ? fmtDate(a.purchaseDate) : '<span class="flag">Missing</span>'}</div>
      <div><span>Unit cost</span>${isNum(a.cost) ? money(a.cost) : '<span class="flag">Missing</span>'}</div>
      <div><span>Vendor / invoice</span>${esc(a.vendor || '—')}${a.invoice ? ' · ' + esc(a.invoice) : ''}${(() => { const vd = vendorOf(a); return vd ? `<div class="sub">${esc([vd.contactPerson, vd.phone, vd.email].filter(Boolean).join(' · '))}</div>` : ''; })()}</div>
      <div><span>Warranty until</span>${a.warrantyUntil ? fmtDate(a.warrantyUntil) + ' ' + warrantyChip(a) : '—'}</div>
      <div><span>Location</span>${esc(locText(a) || '—')}</div>
      <div><span>Useful life</span>${isNum(a.life) ? a.life + ' yrs' : '—'}</div>
      <div><span>Net book value</span>${d ? money(d.nbv) + `<div class="sub">acc. dep. ${money(d.acc)}</div>` : '<span class="flag">Data Incomplete</span>'}</div>
      ${a.description ? `<div style="grid-column:1/-1"><span>Description</span>${esc(a.description)}</div>` : ''}
    </div>
    ${a.status === 'Assigned' ? `<div class="section-t">Current holder</div>
      <div class="dl"><div><span>Holder</span>${holderHtml(a)}</div><div><span>Since</span>${fmtDate(c.assignedDate)}</div>
      <div><span>Expected return</span>${c.expectedReturn ? fmtDate(c.expectedReturn) + (c.expectedReturn < today() ? ' <span class="chip red">Overdue</span>' : '') : 'Permanent'}</div>
      ${c.notes ? `<div style="grid-column:1/-1"><span>Notes</span>${esc(c.notes)}</div>` : ''}</div>` : ''}
    ${a.status === 'Disposed' && a.disposal ? `<div class="section-t">Disposal</div>
      <div class="dl"><div><span>Date</span>${fmtDate(a.disposal.date)}</div><div><span>Reason / method</span>${esc(a.disposal.reason)} · ${esc(a.disposal.method)}</div>
      <div><span>Recovery value</span>${money(a.disposal.value)}</div><div><span>NBV at disposal</span>${money(a.disposal.nbvAtDisposal)}</div><div><span>Approved by</span>${esc(a.disposal.approvedBy)}</div></div>` : ''}
    ${actions ? `<div class="actions no-print">${actions}</div>` : ''}
    <div class="grid2" style="margin-top:8px">
      <div><div class="section-t">Assignment history</div>
        ${hist.length ? `<div class="timeline">${hist.map(h => `<div class="ev">
          <b>${esc(h.employeeName ? `${h.employeeName} (${h.employeeId})` : h.department + ' pool')}</b> <span class="sub">· ${esc(h.department)}</span>
          <div class="sub">${fmtDate(h.startDate)} → ${h.endDate ? fmtDate(h.endDate) : '<b>present</b>'}${h.closeReason ? ' · ' + esc(h.closeReason) : ''}</div>
          <div class="sub">Out: ${esc(h.conditionOut || '—')}${h.conditionIn ? ' · In: ' + esc(h.conditionIn) : ''} · by ${esc(h.issuedByName || '')}</div>
          ${h.notes ? `<div class="sub">${esc(h.notes)}</div>` : ''}</div>`).join('')}</div>` : '<div class="sub">Never assigned.</div>'}
      </div>
      <div><div class="section-t">Activity log</div>
        ${log.length ? `<div class="timeline">${log.map(l => `<div class="ev gold"><b>${esc(l.action)}</b> <span class="sub">· ${esc(l.by)}</span>
          <div class="sub">${new Date(l.at).toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'})}</div>
          ${l.note ? `<div class="sub">${esc(l.note)}</div>` : ''}</div>`).join('')}</div>` : '<div class="sub">No activity.</div>'}
      </div>
    </div>`;
  openModal(`${esc(a.assetId)} · ${esc(a.name)}`, body, {wide: true, onMount: m => {
    $$('[data-aact]', m).forEach(b => b.onclick = () => ASSET_ACT[b.dataset.aact](a));
  }});
}

export { assetForm, assignDialog, returnDialog, simpleStatusDialog, disposeDialog, ASSET_ACT, showAsset };
