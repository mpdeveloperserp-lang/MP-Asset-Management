import { collection, db, doc, writeBatch } from './firebase.js';
import { g, isNum, parseCSV, qtyOf, sum, toCSV, valueOf } from './calc.js';
import { $, activeDepts, addAudit, byName, chip, download, empById, esc, money, num, S, toast } from './core.js';
import { actionsRow, busy, closeModal, formErr, formObj, openModal } from './ui.js';

/* ---------- Masters ---------- */
function viewMasters(){
  const tabs = [['types','Types & subtypes'],['locs','Locations'],['vendors','Vendors'],['depts','Departments'],['emps','Employees']];
  let html = `<div class="tabs">${tabs.map(([k, l]) => `<button class="${S.mt === k ? 'active' : ''}" data-act="masters-tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  const count = fn => S.assets.filter(a => a.status !== 'Disposed' && fn(a)).length;
  if (S.mt === 'types'){
    html += `<div class="toolbar"><button class="btn primary" data-act="type-form">＋ Add type</button><span class="spacer"></span><span class="sub">Codes form the asset ID, e.g. type ELE + subtype LAP → ELE-LAP-0001.</span></div>`;
    html += [...S.types].sort(byName).map(t => `<div class="card">
      <div class="toolbar"><h3 style="margin:0">${esc(t.name)} <span class="chip grey">${esc(t.code)}</span> ${t.active === false ? '<span class="chip red">Inactive</span>' : ''}</h3><span class="spacer"></span>
        <button class="btn sm" data-act="sub-form" data-type="${t.id}">＋ Subtype</button><button class="btn sm" data-act="type-form" data-type="${t.id}">Edit</button></div>
      ${(t.subtypes || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>Subtype</th><th>Code</th><th class="num">Default life (yrs)</th><th class="num">Assets</th><th>Status</th><th></th></tr></thead><tbody>
        ${t.subtypes.map((s, i) => `<tr class="${s.active === false ? 'off' : ''}"><td>${esc(s.name)}</td><td>${esc(s.code)}</td><td class="num">${esc(s.life ?? '')}</td><td class="num">${count(a => a.typeId === t.id && a.subCode === s.code)}</td>
          <td>${s.active === false ? '<span class="chip red">Inactive</span>' : '<span class="chip green">Active</span>'}</td><td><button class="btn sm" data-act="sub-form" data-type="${t.id}" data-i="${i}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="sub">No subtypes yet.</div>'}</div>`).join('') || '<div class="empty">No types yet.</div>';
  } else if (S.mt === 'depts'){
    html += `<div class="toolbar"><button class="btn primary" data-act="dept-form">＋ Add department</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>Department</th><th>Code</th><th class="num">Employees</th><th class="num">Assets held</th><th>Status</th><th></th></tr></thead><tbody>
      ${[...S.departments].sort(byName).map(d => `<tr class="${d.active === false ? 'off' : ''}"><td>${esc(d.name)}</td><td>${esc(d.code || '')}</td>
        <td class="num">${S.employees.filter(e => e.department === d.name && e.active !== false).length}</td><td class="num">${count(a => a.status === 'Assigned' && a.current?.department === d.name)}</td>
        <td>${d.active === false ? '<span class="chip red">Inactive</span>' : '<span class="chip green">Active</span>'}</td><td><button class="btn sm" data-act="dept-form" data-id="${d.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>`;
  } else if (S.mt === 'vendors'){
    const q = (S.vf?.q || '').toLowerCase();
    const list = S.vendors.filter(v => !q || [v.name, v.code, v.category, v.contactPerson, v.phone, v.email, v.gstin, v.city].join(' ').toLowerCase().includes(q)).sort(byName);
    html += `<div class="toolbar"><button class="btn primary" data-act="vendor-form">＋ Add vendor</button><button class="btn" data-act="vendor-import">⬆ Import CSV</button>
      <button class="btn sm" data-act="vendor-export">⬇ Export CSV</button><span class="spacer"></span><span class="sub">${list.length} vendors</span></div>
      <div class="filters"><input type="search" id="vf-q" data-filter="vf.q" placeholder="Search name, contact, phone, GSTIN, city…" value="${esc(S.vf?.q || '')}"></div>
      <div class="tbl-wrap"><table><thead><tr><th>Vendor</th><th>Supplies</th><th>Contact</th><th>GSTIN</th><th>City</th><th class="num">Assets</th><th class="num">Purchase value</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(v => { const al = S.assets.filter(a => a.vendor === v.name);
        return `<tr class="${v.active === false ? 'off' : ''}"><td><b>${esc(v.name)}</b>${v.code ? `<div class="sub">${esc(v.code)}</div>` : ''}</td><td class="wrap">${esc(v.category || '')}</td>
        <td>${esc(v.contactPerson || '')}<div class="sub">${esc([v.phone, v.email].filter(Boolean).join(' · '))}</div></td><td>${esc(v.gstin || '')}</td><td>${esc(v.city || '')}</td>
        <td class="num">${al.length}</td><td class="num">${money(sum(al, valueOf))}</td>
        <td>${v.active === false ? '<span class="chip red">Inactive</span>' : '<span class="chip green">Active</span>'}</td>
        <td><button class="btn sm" data-act="vendor-form" data-id="${v.id}">Edit</button></td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">No vendors yet.</td></tr>'}
      </tbody></table></div>`;
  } else if (S.mt === 'locs'){
    html += `<div class="toolbar"><button class="btn primary" data-act="loc-form">＋ Add location</button><span class="spacer"></span>
      <span class="sub">Sites, offices, warehouses (e.g. Head Office, Project – Tower A). The exact spot (floor, gate, pole) goes in each asset's Position field.</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Location</th><th>Code</th><th>Address / notes</th><th class="num">Asset records</th><th class="num">Units</th><th>Status</th><th></th></tr></thead><tbody>
      ${[...S.locations].sort(byName).map(l => { const list = S.assets.filter(a => a.status !== 'Disposed' && a.location === l.name);
        return `<tr class="${l.active === false ? 'off' : ''}"><td><b>${esc(l.name)}</b></td><td>${esc(l.code || '')}</td><td class="wrap">${esc(l.address || '')}</td>
        <td class="num">${list.length}</td><td class="num">${num(sum(list, qtyOf))}</td>
        <td>${l.active === false ? '<span class="chip red">Inactive</span>' : '<span class="chip green">Active</span>'}</td>
        <td><button class="btn sm" data-act="loc-form" data-id="${l.id}">Edit</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">No locations yet — add your sites and offices.</td></tr>'}
      </tbody></table></div>`;
  } else {
    const q = (S.ef.q || '').toLowerCase();
    const list = S.employees.filter(e => (!S.ef.dept || e.department === S.ef.dept) && (!q || `${e.empId} ${e.name} ${e.email}`.toLowerCase().includes(q))).sort(byName);
    html += `<div class="toolbar"><button class="btn primary" data-act="emp-form">＋ Add employee</button><button class="btn" data-act="emp-import">⬆ Import CSV</button><span class="spacer"></span><span class="sub">${list.length} employees</span></div>
      <div class="filters"><input type="search" id="ef-q" data-filter="ef.q" placeholder="Search ID, name, email…" value="${esc(S.ef.q || '')}">
        <select id="ef-dept" data-filter="ef.dept"><option value="">All departments</option>${S.departments.slice().sort(byName).map(d => `<option ${S.ef.dept === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="tbl-wrap"><table><thead><tr><th>Emp ID</th><th>Name</th><th>Department</th><th>Email</th><th class="num">Assets held</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(e => { const n = count(a => a.current?.employeeId === e.empId); return `<tr class="${e.active === false ? 'off' : ''}"><td>${esc(e.empId)}</td><td>${esc(e.name)}</td><td>${esc(e.department)}</td><td>${esc(e.email || '')}</td>
        <td class="num">${n}${e.active === false && n ? ' <span class="chip red">clearance</span>' : ''}</td><td>${e.active === false ? '<span class="chip red">Exited</span>' : '<span class="chip green">Active</span>'}</td>
        <td><button class="btn sm" data-act="emp-form" data-id="${esc(e.empId)}">Edit</button></td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  return html;
}
const CODE_RE = /^[A-Z0-9]{2,5}$/;
function typeForm(id){
  const t = id ? S.types.find(x => x.id === id) : null, used = t && S.assets.some(a => a.typeId === t.id);
  openModal(t ? `Edit type · ${esc(t.name)}` : 'Add asset type', `<form id="fm" class="form">
    <label class="f"><span class="req">Type name</span><input name="name" value="${esc(t?.name || '')}" placeholder="e.g. Electronics"></label>
    <label class="f"><span class="req">Code (2–5 letters)</span><input name="code" value="${esc(t?.code || '')}" placeholder="ELE" ${used ? 'disabled' : ''} style="text-transform:uppercase"></label>
    ${t ? `<label class="check full"><input type="checkbox" name="active" ${t.active !== false ? 'checked' : ''}> Active (inactive types can't be used for new assets)</label>` : ''}
    ${used ? '<div class="full hint">Code is locked because assets already use it.</div>' : ''}</form>${actionsRow()}`, {onMount: m => {
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj($('#fm', m)), code = (f.code ?? t.code).trim().toUpperCase(), name = (f.name || '').trim();
      if (!name) return formErr('Name is required.'); if (!CODE_RE.test(code)) return formErr('Code must be 2–5 letters/digits.');
      if (S.types.some(x => x.id !== id && (x.code === code || x.name.toLowerCase() === name.toLowerCase()))) return formErr('Another type already uses this name or code.');
      const data = {name, code, active: t ? !!f.active : true};
      const ref = t ? doc(db, 'types', t.id) : doc(collection(db, 'types')), b = writeBatch(db);
      if (t) b.update(ref, data); else b.set(ref, {...data, subtypes: []});
      addAudit(b, 'type', ref.id, t ? 'Update' : 'Create', t ? {name: t.name, code: t.code, active: t.active !== false} : null, data);
      await b.commit(); closeModal(); toast('Type saved');
    });
  }});
}
function subForm(typeId, idx){
  const t = S.types.find(x => x.id === typeId), subs = [...(t.subtypes || [])], s = idx !== undefined ? subs[idx] : null;
  const used = s && S.assets.some(a => a.typeId === t.id && a.subCode === s.code);
  openModal(`${s ? 'Edit' : 'Add'} subtype · ${esc(t.name)}`, `<form id="fm" class="form">
    <label class="f"><span class="req">Subtype name</span><input name="name" value="${esc(s?.name || '')}" placeholder="e.g. Laptop"></label>
    <label class="f"><span class="req">Code</span><input name="code" value="${esc(s?.code || '')}" placeholder="LAP" ${used ? 'disabled' : ''} style="text-transform:uppercase"></label>
    <label class="f">Default useful life (years)<input type="number" min="0" step="0.5" name="life" value="${esc(s?.life ?? '')}"></label><div></div>
    ${s ? `<label class="check full"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> Active</label>` : ''}</form>${actionsRow()}`, {onMount: m => {
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj($('#fm', m)), code = (f.code ?? s.code).trim().toUpperCase(), name = (f.name || '').trim();
      if (!name) return formErr('Name is required.'); if (!CODE_RE.test(code)) return formErr('Code must be 2–5 letters/digits.');
      if (subs.some((x, i) => i !== idx && (x.code === code || x.name.toLowerCase() === name.toLowerCase()))) return formErr('This type already has a subtype with that name or code.');
      const ns = {name, code, life: isNum(f.life) ? Number(f.life) : 0, active: s ? !!f.active : true};
      if (s) subs[idx] = ns; else subs.push(ns);
      const b = writeBatch(db); b.update(doc(db, 'types', t.id), {subtypes: subs});
      addAudit(b, 'type', t.id, s ? 'Update subtype' : 'Add subtype', s ? {subtype: s} : null, {subtype: ns});
      await b.commit(); closeModal(); toast('Subtype saved');
    });
  }});
}
function deptForm(id){
  const d = id ? S.departments.find(x => x.id === id) : null;
  const used = d && (S.employees.some(e => e.department === d.name) || S.assets.some(a => a.current?.department === d.name) || S.assignments.some(h => h.department === d.name));
  openModal(d ? `Edit department · ${esc(d.name)}` : 'Add department', `<form id="fm" class="form">
    <label class="f"><span class="req">Name</span><input name="name" value="${esc(d?.name || '')}" ${used ? 'disabled' : ''}></label>
    <label class="f">Code<input name="code" value="${esc(d?.code || '')}"></label>
    ${d ? `<label class="check full"><input type="checkbox" name="active" ${d.active !== false ? 'checked' : ''}> Active</label>` : ''}
    ${used ? '<div class="full hint">Name is locked because employees or assets reference it.</div>' : ''}</form>${actionsRow()}`, {onMount: m => {
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj($('#fm', m)), name = (f.name ?? d.name).trim();
      if (!name) return formErr('Name is required.');
      if (S.departments.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return formErr('Department already exists.');
      const data = {name, code: (f.code || '').trim().toUpperCase(), active: d ? !!f.active : true};
      const ref = d ? doc(db, 'departments', d.id) : doc(collection(db, 'departments')), b = writeBatch(db);
      b.set(ref, data, {merge: true}); addAudit(b, 'department', ref.id, d ? 'Update' : 'Create', d ? {name: d.name, code: d.code, active: d.active !== false} : null, data);
      await b.commit(); closeModal(); toast('Department saved');
    });
  }});
}
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const VFIELDS = ['name','code','category','contactPerson','phone','email','gstin','pan','address','city','paymentTerms','notes'];
function vendorErrors(d, selfId){
  const e = [];
  if (!d.name) e.push('name is required');
  else if (S.vendors.some(x => x.id !== selfId && x.name.toLowerCase() === d.name.toLowerCase())) e.push(`vendor "${d.name}" already exists`);
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) e.push('email looks invalid');
  if (d.gstin && !GST_RE.test(d.gstin)) e.push('GSTIN must be 15 characters, e.g. 33AABCM1234F1Z5');
  if (d.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.pan)) e.push('PAN must be like AABCM1234F');
  if (d.phone && !/^[0-9+\-\s()]{6,20}$/.test(d.phone)) e.push('phone looks invalid');
  return e;
}
function vendorForm(id, after){
  const v = id ? S.vendors.find(x => x.id === id) : null;
  const used = v && S.assets.some(a => a.vendor === v.name);
  const fld = (k, label, ph = '', cls = '') => `<label class="f ${cls}">${label}<input name="${k}" value="${esc(v?.[k] || '')}" placeholder="${ph}" ${k === 'name' && used ? 'disabled' : ''}></label>`;
  openModal(v ? `Edit vendor · ${esc(v.name)}` : 'Add vendor', `<form id="fm" class="form" autocomplete="off">
    <label class="f"><span class="req">Vendor name</span><input name="name" value="${esc(v?.name || '')}" placeholder="e.g. SecureTech Systems" ${used ? 'disabled' : ''}></label>
    ${fld('code', 'Vendor code', 'e.g. V-0012')}
    ${fld('category', 'Supplies / category', 'e.g. CCTV, networking, AMC', 'full')}
    ${fld('contactPerson', 'Contact person', 'e.g. R. Karthik')}
    ${fld('phone', 'Phone', 'e.g. 98400 12345')}
    ${fld('email', 'Email', 'sales@vendor.com')}
    ${fld('city', 'City', 'Chennai')}
    ${fld('gstin', 'GSTIN', '33AABCM1234F1Z5')}
    ${fld('pan', 'PAN', 'AABCM1234F')}
    <label class="f full">Address<textarea name="address">${esc(v?.address || '')}</textarea></label>
    ${fld('paymentTerms', 'Payment terms', 'e.g. 30 days')}
    <div></div>
    <label class="f full">Notes (service / AMC / escalation)<textarea name="notes">${esc(v?.notes || '')}</textarea></label>
    ${v ? `<label class="check full"><input type="checkbox" name="active" ${v.active !== false ? 'checked' : ''}> Active (inactive vendors can't be chosen for new assets)</label>` : ''}
    ${used ? '<div class="full hint">Name is locked because assets reference this vendor.</div>' : ''}</form>${actionsRow()}`, {onMount: m => {
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj($('#fm', m)), data = {};
      VFIELDS.forEach(k => data[k] = (f[k] ?? v?.[k] ?? '').trim());
      data.gstin = data.gstin.toUpperCase(); data.pan = data.pan.toUpperCase(); data.code = data.code.toUpperCase();
      data.active = v ? !!f.active : true;
      const errs = vendorErrors(data, id); if (errs.length) return formErr(errs.join('; ') + '.');
      const ref = v ? doc(db, 'vendors', v.id) : doc(collection(db, 'vendors')), b = writeBatch(db);
      b.set(ref, data, {merge: true});
      const before = v ? Object.fromEntries([...VFIELDS, 'active'].map(k => [k, k === 'active' ? v.active !== false : v[k] || ''])) : null;
      addAudit(b, 'vendor', ref.id, v ? 'Update' : 'Create', before, data);
      await b.commit(); closeModal(); toast('Vendor saved');
      if (after) after(data.name);
    });
  }});
}
function vendorImport(){
  const cols = ['name','code','category','contactPerson','phone','email','gstin','pan','address','city','paymentTerms','notes'];
  openModal('Import vendors', `<div class="note">CSV columns: <b>${cols.join(', ')}</b>. Only <b>name</b> is required. Existing names are skipped.</div>
    <div class="toolbar"><button class="btn sm" id="tpl">⬇ Template</button><input type="file" id="file" accept=".csv"></div><div id="prev"></div>`, {wide: true, onMount: m => {
    $('#tpl', m).onclick = () => download('vendor_template.csv', toCSV(cols, [['SecureTech Systems','V-0012','CCTV, access control','R. Karthik','9840012345','sales@securetech.in','33AABCS1234F1Z5','AABCS1234F','12, Anna Salai','Chennai','30 days','AMC till Mar-2028']]));
    $('#file', m).onchange = async ev => {
      const rows = parseCSV(await ev.target.files[0].text()), seen = new Set();
      const res = rows.map((r, i) => { const d = {}; cols.forEach(k => d[k] = g(r, k));
        d.gstin = d.gstin.toUpperCase(); d.pan = d.pan.toUpperCase(); d.code = d.code.toUpperCase(); d.active = true;
        const errs = vendorErrors(d, null); const k = d.name.toLowerCase();
        if (d.name && seen.has(k)) errs.push('duplicate name in file'); seen.add(k);
        return {row: i + 2, d, errs}; });
      const ok = res.filter(x => !x.errs.length);
      $('#prev', m).innerHTML = `<div class="toolbar"><span class="chip green">${ok.length} ready</span><span class="chip red">${res.length - ok.length} errors</span><span class="spacer"></span><button class="btn teal" id="doImp" ${ok.length ? '' : 'disabled'}>Import</button></div>
        ${res.filter(x => x.errs.length).slice(0, 100).map(x => `<div class="sub">Row ${x.row}: ${esc(x.errs.join('; '))}</div>`).join('')}<div class="err" id="fe" hidden></div>`;
      $('#doImp', m).onclick = e2 => busy(e2.target, async () => {
        for (let i = 0; i < ok.length; i += 200){ const b = writeBatch(db);
          ok.slice(i, i + 200).forEach(x => { const ref = doc(collection(db, 'vendors')); b.set(ref, x.d); addAudit(b, 'vendor', ref.id, 'Create (import)', null, x.d); });
          await b.commit(); }
        closeModal(); toast(`Imported ${ok.length} vendors`);
      });
    };
  }});
}
function locForm(id){
  const l = id ? S.locations.find(x => x.id === id) : null;
  const used = l && (S.assets.some(a => a.location === l.name));
  openModal(l ? `Edit location · ${esc(l.name)}` : 'Add location', `<form id="fm" class="form">
    <label class="f"><span class="req">Location name</span><input name="name" value="${esc(l?.name || '')}" placeholder="e.g. Project – Tower A" ${used ? 'disabled' : ''}></label>
    <label class="f">Code<input name="code" value="${esc(l?.code || '')}" placeholder="e.g. TWA"></label>
    <label class="f full">Address / notes<textarea name="address">${esc(l?.address || '')}</textarea></label>
    ${l ? `<label class="check full"><input type="checkbox" name="active" ${l.active !== false ? 'checked' : ''}> Active (inactive locations can't be chosen for new assets)</label>` : ''}
    ${used ? '<div class="full hint">Name is locked because assets are recorded at this location.</div>' : ''}</form>${actionsRow()}`, {onMount: m => {
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj($('#fm', m)), name = (f.name ?? l.name).trim();
      if (!name) return formErr('Name is required.');
      if (S.locations.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return formErr('Location already exists.');
      const data = {name, code: (f.code || '').trim().toUpperCase(), address: (f.address || '').trim(), active: l ? !!f.active : true};
      const ref = l ? doc(db, 'locations', l.id) : doc(collection(db, 'locations')), b = writeBatch(db);
      b.set(ref, data, {merge: true});
      addAudit(b, 'location', ref.id, l ? 'Update' : 'Create', l ? {name: l.name, code: l.code, address: l.address, active: l.active !== false} : null, data);
      await b.commit(); closeModal(); toast('Location saved');
    });
  }});
}
function empForm(id){
  const e = id ? empById(id) : null;
  openModal(e ? `Edit employee · ${esc(e.name)}` : 'Add employee', `<form id="fm" class="form">
    <label class="f"><span class="req">Employee ID</span><input name="empId" value="${esc(e?.empId || '')}" ${e ? 'disabled' : ''} placeholder="e.g. E1023"></label>
    <label class="f"><span class="req">Name</span><input name="name" value="${esc(e?.name || '')}"></label>
    <label class="f"><span class="req">Department</span><select name="department"><option value="">Select…</option>${activeDepts().map(d => `<option ${e?.department === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <label class="f">Email<input type="email" name="email" value="${esc(e?.email || '')}"></label>
    ${e ? `<label class="check full"><input type="checkbox" name="active" ${e.active !== false ? 'checked' : ''}> Active (untick when the employee exits — their assets are flagged for HR clearance)</label>` : ''}
  </form>${actionsRow()}`, {onMount: m => {
    $('#go', m).onclick = ev => busy(ev.target, async () => {
      const f = formObj($('#fm', m)), empId = (f.empId ?? e.empId).trim();
      if (!empId || /[\/]/.test(empId)) return formErr('Employee ID is required and cannot contain “/”.');
      if (!e && empById(empId)) return formErr('Employee ID already exists.');
      if (!f.name?.trim() || !f.department) return formErr('Name and department are required.');
      const data = {empId, name: f.name.trim(), department: f.department, email: (f.email || '').trim(), active: e ? !!f.active : true};
      const held = S.assets.filter(a => a.current?.employeeId === empId && a.status === 'Assigned');
      if (e && e.active !== false && !data.active && held.length && !confirm(`${data.name} holds ${held.length} asset(s). They will be flagged “Held by Exited Employee” until returned. Continue?`)) return;
      if (e && e.department !== data.department && held.length && !confirm(`${data.name} holds ${held.length} asset(s) recorded under ${e.department}. Changing department does not move those assets — transfer them separately. Continue?`)) return;
      const b = writeBatch(db); b.set(doc(db, 'employees', empId), data, {merge: true});
      addAudit(b, 'employee', empId, e ? 'Update' : 'Create', e ? {name: e.name, department: e.department, email: e.email, active: e.active !== false} : null, data);
      await b.commit(); closeModal(); toast('Employee saved');
    });
  }});
}
function empImport(){
  openModal('Import employees', `<div class="note">CSV columns: <b>empId, name, department, email, active</b> (active = Y/N, optional). Existing IDs are updated.</div>
    <div class="toolbar"><button class="btn sm" id="tpl">⬇ Template</button><input type="file" id="file" accept=".csv"></div><div id="prev"></div>`, {wide: true, onMount: m => {
    $('#tpl', m).onclick = () => download('employee_template.csv', toCSV(['empId','name','department','email','active'], [['E1023','Priya Raman','Sales','priya@example.com','Y']]));
    $('#file', m).onchange = async ev => {
      const rows = parseCSV(await ev.target.files[0].text()), seen = new Set();
      const res = rows.map((r, i) => { const errs = [], id = g(r, 'empId'), dn = g(r, 'department');
        const d = S.departments.find(x => x.name.toLowerCase() === dn.toLowerCase());
        if (!id || id.includes('/')) errs.push('empId invalid'); else if (seen.has(id)) errs.push('duplicate empId'); seen.add(id);
        if (!g(r, 'name')) errs.push('name missing'); if (!d) errs.push(`unknown department "${dn}"`);
        return {row: i + 2, id, errs, data: errs.length ? null : {empId: id, name: g(r, 'name'), department: d.name, email: g(r, 'email'), active: !/^(n|no|false|0)$/i.test(g(r, 'active'))}}; });
      const ok = res.filter(x => x.data);
      $('#prev', m).innerHTML = `<div class="toolbar"><span class="chip green">${ok.length} ready</span><span class="chip red">${res.length - ok.length} errors</span><span class="spacer"></span><button class="btn teal" id="doImp" ${ok.length ? '' : 'disabled'}>Import</button></div>
        ${res.filter(x => x.errs.length).slice(0, 100).map(x => `<div class="sub">Row ${x.row}: ${esc(x.errs.join('; '))}</div>`).join('')}<div class="err" id="fe" hidden></div>`;
      $('#doImp', m).onclick = e2 => busy(e2.target, async () => {
        for (let i = 0; i < ok.length; i += 200){ const b = writeBatch(db);
          ok.slice(i, i + 200).forEach(x => { const prev = empById(x.id); b.set(doc(db, 'employees', x.id), x.data, {merge: true});
            addAudit(b, 'employee', x.id, prev ? 'Update (import)' : 'Create (import)', prev ? {name: prev.name, department: prev.department, email: prev.email, active: prev.active !== false} : null, x.data); });
          await b.commit(); }
        closeModal(); toast(`Imported ${ok.length} employees`);
      });
    };
  }});
}

export { viewMasters, CODE_RE, typeForm, subForm, deptForm, GST_RE, VFIELDS, vendorErrors, vendorForm, vendorImport, locForm, empForm, empImport };
