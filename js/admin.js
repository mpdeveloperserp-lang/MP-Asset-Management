import { createUserWithEmailAndPassword, db, doc, secondaryAuth, serverTimestamp, signOut } from './firebase.js';
import { today } from './calc.js';
import { $, $$, activeDepts, activeLocs, auditedSet, byName, chip, empById, esc, fmtDate, fmtTs, role, ROLES, S, toast } from './core.js';
import { actionsRow, busy, closeModal, formErr, formObj, openModal } from './ui.js';
import { assetTable, viewAssets, viewDashboard, viewOpening, viewReports } from './views.js';
import { viewMasters } from './masters.js';
import { viewIntegrity } from './integrity.js';

/* ---------- Users ---------- */
const scopeText = u => u.role !== 'manager' ? '' :
  [ (u.managedDepartments || (u.department ? [u.department] : [])).join(', '), (u.managedLocations || []).join(', ') ].map((x, i) => x ? `${i ? 'Locations' : 'Depts'}: ${x}` : '').filter(Boolean).join(' · ') || 'No scope';
function viewUsers(){
  return `<div class="toolbar"><button class="btn primary" data-act="user-form">＋ Add user</button><span class="spacer"></span>
    <span class="sub">Admin: everything · Manager: assets in their authorised departments/locations · Viewer: read-only · Employee: own assets only</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Manager scope</th><th>Emp ID</th><th>Status</th><th></th></tr></thead><tbody>
    ${[...S.users].sort(byName).map(u => `<tr class="${u.active === false ? 'off' : ''}"><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="chip ${u.role === 'admin' ? 'gold' : u.role === 'manager' ? 'teal' : 'grey'}">${esc(u.role)}</span></td>
      <td>${esc(u.department || '—')}</td><td class="wrap sub">${esc(scopeText(u))}</td><td>${esc(u.empId || '—')}</td><td>${u.active === false ? '<span class="chip red">Disabled</span>' : '<span class="chip green">Active</span>'}</td>
      <td><button class="btn sm" data-act="user-form" data-id="${u.id}">Edit</button> <button class="btn sm" data-act="reset-pw" data-email="${esc(u.email)}">Reset password</button></td></tr>`).join('')}
    </tbody></table></div>`;
}
function checks(name, items, selected){
  return `<div class="checklist">${items.map(x => `<label class="check"><input type="checkbox" name="${name}" value="${esc(x)}" ${selected.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('') || '<span class="sub">None defined in Masters</span>'}</div>`;
}
function userForm(id){
  const u = id ? S.users.find(x => x.id === id) : null, self = u?.id === S.user.uid;
  const md = u?.managedDepartments || (u?.department ? [u.department] : []), ml = u?.managedLocations || [];
  openModal(u ? `Edit user · ${esc(u.name)}` : 'Add user', `<form id="fm" class="form" autocomplete="off">
    <label class="f"><span class="req">Name</span><input name="name" value="${esc(u?.name || '')}"></label>
    <label class="f"><span class="req">Email</span><input type="email" name="email" value="${esc(u?.email || '')}" ${u ? 'disabled' : ''}></label>
    ${u ? '' : '<label class="f"><span class="req">Temporary password</span><input type="text" name="password" minlength="8" placeholder="min 8 characters"></label><div></div>'}
    <label class="f"><span class="req">Role</span><select name="role" ${self ? 'disabled' : ''}>${ROLES.map(r => `<option ${u?.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="f">Home department<select name="department"><option value="">—</option>${activeDepts().map(d => `<option ${u?.department === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    <label class="f">Employee ID <span class="hint">(required for employee role)</span><input name="empId" value="${esc(u?.empId || '')}"></label><div></div>
    <div class="full" id="scopeBox">
      <div class="section-t" style="margin-top:4px">Manager scope — the manager can act only on assets held by these departments or kept at these locations</div>
      <div class="grid2"><div><b class="sub">Departments</b>${checks('md', activeDepts().map(d => d.name), md)}</div>
      <div><b class="sub">Locations</b>${checks('ml', activeLocs().map(l => l.name), ml)}</div></div>
    </div>
    ${u && !self ? `<label class="check full"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Active (untick to block access immediately)</label>` : ''}
    ${self ? '<div class="full hint">You cannot change your own role or disable yourself.</div>' : ''}</form>${actionsRow()}`, {onMount: m => {
    const fm = $('#fm', m), box = $('#scopeBox', m);
    const sync = () => { box.hidden = (fm.role.value || u?.role) !== 'manager'; };
    fm.role.onchange = sync; sync();
    $('#go', m).onclick = e => busy(e.target, async () => {
      const f = formObj(fm), r = f.role || u.role;
      const managedDepartments = r === 'manager' ? $$('input[name=md]:checked', fm).map(x => x.value) : [];
      const managedLocations = r === 'manager' ? $$('input[name=ml]:checked', fm).map(x => x.value) : [];
      if (!f.name?.trim()) return formErr('Name is required.');
      if (r === 'manager' && !managedDepartments.length && !managedLocations.length) return formErr('Give the manager at least one department or location.');
      if (r === 'employee' && !(f.empId || '').trim()) return formErr('Employee role needs an Employee ID.');
      if (r === 'employee' && !empById(f.empId.trim())) return formErr('That Employee ID is not in the employee master.');
      const data = {name: f.name.trim(), role: r, department: f.department || '', empId: (f.empId || '').trim(),
        managedDepartments, managedLocations, active: u ? (self ? true : !!f.active) : true};
      let uid = u?.id;
      if (!u){
        if (!f.email || (f.password || '').length < 8) return formErr('Email and an 8+ character password are required.');
        const sa = secondaryAuth();
        const cred = await createUserWithEmailAndPassword(sa, f.email.trim(), f.password);
        uid = cred.user.uid; await signOut(sa); data.email = f.email.trim(); data.createdAt = serverTimestamp();
      }
      const before = u ? {name: u.name, role: u.role, department: u.department, empId: u.empId, active: u.active !== false,
        managedDepartments: u.managedDepartments || null, managedLocations: u.managedLocations || null} : null;
      await auditedSet(doc(db, 'users', uid), data, 'user', u ? 'Update' : 'Create', before, {merge: true});
      closeModal(); toast(u ? 'User updated' : `User created — share the temporary password with ${data.name}`);
    });
  }});
}

/* ---------- Audit ---------- */
function viewAudit(){
  const q = (S.af.q || '').toLowerCase(), ent = S.af.entity || '';
  const list = S.audit.filter(x => (!ent || x.entity === ent) && (!q || `${x.entityId} ${x.byName} ${x.action}`.toLowerCase().includes(q)));
  const fmtV = v => v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `<div class="filters"><input type="search" id="af-q" data-filter="af.q" placeholder="Search ID, user, action…" value="${esc(S.af.q || '')}">
    <select id="af-entity" data-filter="af.entity"><option value="">All entities</option>${['asset','assignment','type','location','vendor','department','employee','user','openingStock','settings','integrity'].map(e => `<option ${ent === e ? 'selected' : ''}>${e}</option>`).join('')}</select>
    <span class="sub">Latest 500 entries · entries cannot be edited or deleted</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>When</th><th>User</th><th>Entity</th><th>ID</th><th>Action</th><th>Tx ref</th><th>Changes (old → new)</th></tr></thead><tbody>
    ${list.map(x => `<tr><td>${fmtTs(x.at)}</td><td>${esc(x.byName)}</td><td>${esc(x.entity)}</td><td>${esc(x.entityId)}</td><td>${esc(x.action)}${(x.entityIds || []).length > 1 ? `<div class="sub">${x.entityIds.length} records</div>` : ''}</td><td class="sub">${esc(x.txRef || '')}</td>
      <td class="wrap sub">${Object.keys(x.after || {}).slice(0, 8).map(k => `<b>${esc(k)}</b>: ${esc(fmtV(x.before?.[k]).slice(0, 80))} → ${esc(fmtV(x.after[k]).slice(0, 80))}`).join('<br>') || '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
}

/* ---------- Employee self view ---------- */
function viewMine(){
  const mine = S.assets.filter(a => a.status === 'Assigned');
  const hist = [...S.assignments].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  return `<div class="kpis"><div class="kpi navy"><div class="l">Assets with you</div><div class="v">${mine.length}</div></div>
      <div class="kpi ${mine.some(a => a.current?.expectedReturn && a.current.expectedReturn < today()) ? 'red' : ''}"><div class="l">Overdue returns</div><div class="v">${mine.filter(a => a.current?.expectedReturn && a.current.expectedReturn < today()).length}</div></div></div>
    <div class="card"><h3>Currently assigned to you</h3>${assetTable(mine)}</div>
    <div class="card"><h3>Your assignment history</h3>${hist.length ? `<div class="tbl-wrap"><table><thead><tr><th>Asset</th><th>From</th><th>To</th><th>Closed by</th></tr></thead><tbody>
      ${hist.map(h => `<tr><td><b>${esc(h.assetId)}</b> ${esc(h.assetName)}</td><td>${fmtDate(h.startDate)}</td><td>${h.endDate ? fmtDate(h.endDate) : 'present'}</td><td>${esc(h.closeReason || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="sub">No history.</div>'}</div>`;
}

const VIEWS = {dashboard: viewDashboard, assets: viewAssets, opening: viewOpening, reports: viewReports, masters: viewMasters, users: viewUsers, audit: viewAudit, integrity: viewIntegrity, mine: viewMine};

export { viewUsers, userForm, viewAudit, viewMine, VIEWS, scopeText };
