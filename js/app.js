import { firebaseConfig, IDLE_LOGOUT_MIN, ORG_NAME } from './config.js';
import { app, auth, collection, db, doc, getDoc, limit, onAuthStateChanged, onSnapshot, orderBy, query, sendPasswordResetEmail, serverTimestamp, signInWithEmailAndPassword, signOut, where, writeBatch } from './firebase.js';
import { qtyOf, sum, toCSV, today, valueOf } from './calc.js';
import { $, $$, auditedSet, byName, chip, download, errMsg, esc, role, S, toast } from './core.js';
import { closeModal, formErr, formObj } from './ui.js';
import { assetForm, showAsset } from './assets.js';
import { importDialog } from './import.js';
import { allowedNav, currentView, exportAssets, exportReport, saveOpening } from './views.js';
import { deptForm, empForm, empImport, locForm, subForm, typeForm, vendorForm, vendorImport } from './masters.js';
import { userForm, VIEWS } from './admin.js';
import { INTEGRITY_ACT } from './integrity.js';

/* =====================================================================
   RENDER & EVENTS
   ===================================================================== */
let rq = null;
function scheduleRender(){ if (rq) return; rq = requestAnimationFrame(() => { rq = null; render(); }); }
function render(){
  if (!S.profile) return;
  const v = currentView(), nav = allowedNav();
  $('#nav').innerHTML = nav.map(n => `<a href="#${n.id}" class="${n.id === v ? 'active' : ''}"><span class="ico">${n.ico}</span>${n.label}</a>`).join('');
  $('#title').textContent = nav.find(n => n.id === v).label;
  const ae = document.activeElement, id = ae?.id, pos = ae?.selectionStart;
  $('#view').innerHTML = VIEWS[v]();
  if (id){ const el = document.getElementById(id); if (el && el.closest('#view')){ el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch {} } }
}
window.addEventListener('app:render', () => scheduleRender());
window.addEventListener('hashchange', () => { $('#side').classList.remove('open'); render(); window.scrollTo(0, 0); });
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');
$('#scrim').onclick = () => $('#side').classList.remove('open');

const onField = e => {
  const el = e.target;
  if (el.dataset.filter){ const [scope, key] = el.dataset.filter.split('.'); S[scope][key] = el.value; if (key === 'type') S[scope].sub = ''; scheduleRender(); }
  else if (el.dataset.ok){ const k = el.dataset.ok;
    if (k === '__cutoff') S.draft.__cutoff = el.value; else { S.draft[k] = S.draft[k] || {}; S.draft[k][el.dataset.k] = el.value; } }
};
$('#view').addEventListener('input', onField);
$('#view').addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') onField(e); });

const ACT = {
  'open-asset': d => showAsset(d.id),
  'add-asset': () => assetForm(),
  'import': () => importDialog(),
  'export-assets': () => exportAssets(),
  'clear-filters': d => { S[d.scope] = d.scope === 'rf' ? {days: '30', fy: S.rf.fy} : {}; render(); },
  'report-tab': d => { S.rt = d.tab; render(); },
  'goto-report': d => { S.rt = d.tab; },
  'export-report': () => exportReport(),
  'print-report': () => window.print(),
  'masters-tab': d => { S.mt = d.tab; render(); },
  'type-form': d => typeForm(d.type),
  'sub-form': d => subForm(d.type, d.i !== undefined ? Number(d.i) : undefined),
  'dept-form': d => deptForm(d.id),
  'loc-form': d => locForm(d.id),
  'vendor-form': d => vendorForm(d.id),
  'vendor-import': () => vendorImport(),
  'vendor-export': () => download(`vendors_${today()}.csv`, toCSV(['Name','Code','Supplies','Contact Person','Phone','Email','GSTIN','PAN','Address','City','Payment Terms','Notes','Active','Assets','Purchase Value'],
    S.vendors.slice().sort(byName).map(v => { const al = S.assets.filter(a => a.vendor === v.name); return [v.name, v.code, v.category, v.contactPerson, v.phone, v.email, v.gstin, v.pan, v.address, v.city, v.paymentTerms, v.notes, v.active === false ? 'N' : 'Y', al.length, sum(al, valueOf).toFixed(2)]; }))),
  'emp-form': d => empForm(d.id),
  'emp-import': () => empImport(),
  'user-form': d => userForm(d.id),
  'reset-pw': async d => { if (!confirm(`Send a password reset email to ${d.email}?`)) return;
    try { await sendPasswordResetEmail(auth, d.email); toast('Reset email sent'); } catch (e){ toast(errMsg(e), 'err'); } },
  'save-opening': async (d, el) => { el.disabled = true; try { await saveOpening(); } catch (e){ toast(errMsg(e), 'err'); } el.disabled = false; },
  'lock-opening': async (d, el) => {
    const cutoff = S.draft.__cutoff ?? S.settings.cutoff;
    if (!cutoff) return toast('Set the cut-off date first.', 'err');
    el.disabled = true;
    try {
      if (Object.keys(S.draft).length) await saveOpening(true);
      const bad = S.types.flatMap(t => (t.subtypes || []).map(s => {
        const d = S.opening[`${t.id}__${s.code}`] || {}, rec = S.assets.filter(a => a.source === 'Opening' && a.typeId === t.id && a.subCode === s.code);
        return (Number(d.qty) || 0) !== sum(rec, qtyOf) || Math.abs((Number(d.value) || 0) - sum(rec, valueOf)) >= 1;
      })).filter(Boolean).length;
      if (!confirm(bad ? `${bad} line(s) still have a variance between declared and recorded opening stock. Lock anyway? Opening-balance records can't be added after locking.` : 'Approve and lock the opening balance? Opening-balance records can\'t be added after locking.')) return;
      await auditedSet(doc(db, 'settings', 'app'), {openingLocked: true, lockedBy: S.user.uid, lockedByName: S.profile.name, lockedAt: serverTimestamp(), varianceLinesAtLock: bad},
        'settings', 'Opening balance locked', {openingLocked: false}, {update: true});
      toast('Opening balance approved and locked');
    } catch (e){ toast(errMsg(e), 'err'); } finally { if (el.isConnected) el.disabled = false; }
  },
  'unlock-opening': async () => {
    const reason = prompt('Reason for unlocking the opening balance (recorded in the audit log):'); if (!reason?.trim()) return;
    try { await auditedSet(doc(db, 'settings', 'app'), {openingLocked: false, unlockReason: reason.trim(), unlockedBy: S.user.uid, unlockedAt: serverTimestamp()},
        'settings', 'Opening balance unlocked', {openingLocked: true}, {update: true});
      toast('Opening balance unlocked'); } catch (e){ toast(errMsg(e), 'err'); }
  },
  'export-opening': () => {
    const rows = []; [...S.types].sort(byName).forEach(t => (t.subtypes || []).forEach(s => { const k = `${t.id}__${s.code}`, d = S.opening[k] || {};
      const rec = S.assets.filter(a => a.source === 'Opening' && a.typeId === t.id && a.subCode === s.code);
      if (d.qty || rec.length) rows.push([t.name, s.name, d.qty || 0, d.value || 0, sum(rec, qtyOf), sum(rec, valueOf), (d.qty || 0) - sum(rec, qtyOf), ((d.value || 0) - sum(rec, valueOf)).toFixed(2)]); }));
    download(`opening_balance_${today()}.csv`, toCSV(['Type','Subtype','Declared Qty','Declared Value','Recorded Qty','Recorded Value','Variance Qty','Variance Value'], rows));
  }
};
Object.assign(ACT, INTEGRITY_ACT);
$('#view').addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'A' && el.dataset.act !== 'goto-report') e.preventDefault();
  ACT[el.dataset.act]?.(el.dataset, el);
});
$('#logoutBtn').onclick = () => signOut(auth);

/* ---------- idle logout ---------- */
let idleT = null, lastAct = 0, sessionMsg = '';
function resetIdle(){
  const now = Date.now(); if (now - lastAct < 15000) return; lastAct = now;
  clearTimeout(idleT); if (S.user) idleT = setTimeout(() => { sessionMsg = `Signed out after ${IDLE_LOGOUT_MIN} minutes of inactivity.`; signOut(auth); }, IDLE_LOGOUT_MIN * 60000);
}
['click','keydown','mousemove','touchstart','scroll'].forEach(ev => document.addEventListener(ev, resetIdle, {passive: true}));

/* =====================================================================
   AUTH & SUBSCRIPTIONS
   ===================================================================== */
function screen(which){ $('#loading').hidden = which !== 'loading'; $('#auth').hidden = which !== 'auth'; $('#app').hidden = which !== 'app'; }
$$('.org-label').forEach(e => e.textContent = ORG_NAME);

function showLogin(msg = ''){
  screen('auth');
  $('#authBody').innerHTML = `<form id="lf" class="form">
    <label class="f full">Email<input type="email" name="email" autocomplete="username" required></label>
    <label class="f full">Password<input type="password" name="password" autocomplete="current-password" required></label>
    ${msg ? `<div class="full err">${esc(msg)}</div>` : ''}
    <button class="btn primary full" style="justify-content:center;padding:10px">Sign in</button>
    <button type="button" class="linkbtn full" id="forgot">Forgot password?</button></form>`;
  const lf = $('#lf');
  lf.onsubmit = async e => { e.preventDefault(); const f = formObj(lf), b = lf.querySelector('button.primary'); b.disabled = true; b.textContent = 'Signing in…';
    try { await signInWithEmailAndPassword(auth, f.email.trim(), f.password); }
    catch (err){ showLogin(/invalid|wrong|not-found|credential/i.test(err.code || '') ? 'Incorrect email or password.' : errMsg(err)); } };
  $('#forgot').onclick = async () => { const em = lf.email.value.trim(); if (!em) return showLogin('Enter your email first, then click “Forgot password?”.');
    try { await sendPasswordResetEmail(auth, em); showLogin('If that account exists, a reset email has been sent.'); } catch (err){ showLogin(errMsg(err)); } };
  setTimeout(() => lf.email.focus(), 30);
}
function showMessage(html){
  screen('auth');
  $('#authBody').innerHTML = `${html}<div class="form-actions"><button class="btn" id="so">Sign out</button></div>`;
  $('#so').onclick = () => signOut(auth);
}
function showBootstrap(){
  screen('auth');
  $('#authBody').innerHTML = `<div class="note"><b>First-time setup.</b> No administrator exists yet. Create the admin profile for <b>${esc(S.user.email)}</b>. This option disappears once setup is done.</div>
    <form id="bf" class="form"><label class="f full">Your name<input name="name" required></label>
    <label class="check full"><input type="checkbox" name="seed" checked> Add starter types (Electronics, Furniture, Office Equipment, Vehicles), departments (Sales, CRM, Finance, HR, Engineering, Admin) and a Head Office location</label>
    <div class="full err" id="fe" hidden></div><button class="btn primary full" style="justify-content:center">Create admin & continue</button></form>
    <div class="form-actions"><button class="btn sm" id="so">Sign out</button></div>`;
  $('#so').onclick = () => signOut(auth);
  $('#bf').onsubmit = async e => {
    e.preventDefault(); const f = formObj(e.target), btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const b = writeBatch(db), uid = S.user.uid;
      b.set(doc(db, 'users', uid), {name: f.name.trim(), email: S.user.email, role: 'admin', department: '', empId: '', managedDepartments: [], managedLocations: [], active: true, createdAt: serverTimestamp()});
      b.set(doc(db, 'settings', 'app'), {orgName: ORG_NAME, currency: '₹', cutoff: today(), openingLocked: false, createdAt: serverTimestamp()});
      await b.commit();
      if (f.seed){
        const b2 = writeBatch(db);
        const types = [
          ['Electronics','ELE',[['Laptop','LAP',3],['Desktop','DES',3],['Monitor','MON',5],['Printer','PRN',5],['Mobile Phone','MOB',2],['Networking','NET',5],['CCTV Camera','CAM',5],['NVR / DVR','NVR',5]]],
          ['Furniture','FUR',[['Desk','DSK',10],['Chair','CHR',10],['Cabinet','CAB',10],['Conference Table','TBL',10]]],
          ['Office Equipment','OEQ',[['Air Conditioner','AC',8],['Projector','PRJ',5],['UPS','UPS',5]]],
          ['Vehicles','VEH',[['Car','CAR',8],['Two-wheeler','TWO',8]]]];
        types.forEach(([name, code, subs]) => b2.set(doc(collection(db, 'types')), {name, code, active: true, subtypes: subs.map(([n, c, l]) => ({name: n, code: c, life: l, active: true}))}));
        b2.set(doc(collection(db, 'locations')), {name: 'Head Office', code: 'HO', address: '', active: true});
        ['Sales','CRM','Finance','HR','Engineering','Admin'].forEach(n => b2.set(doc(collection(db, 'departments')), {name: n, code: n.slice(0, 3).toUpperCase(), active: true}));
        await b2.commit();
      }
      location.reload();
    } catch (err){ formErr(errMsg(err)); btn.disabled = false; }
  };
}

function unsubAll(){ S.unsubs.forEach(u => { try { u(); } catch {} }); S.unsubs = []; }
function subscribe(){
  const L = S.unsubs, r = role(), list = s => s.docs.map(d => ({id: d.id, ...d.data()}));
  const err = what => e => { console.error(what, e); toast(`Could not load ${what}: ${errMsg(e)}`, 'err'); };
  L.push(onSnapshot(doc(db, 'settings', 'app'), s => { S.settings = s.data() || {}; scheduleRender(); }, err('settings')));
  L.push(onSnapshot(collection(db, 'types'), s => { S.types = list(s).sort(byName); scheduleRender(); }, err('types')));
  L.push(onSnapshot(collection(db, 'departments'), s => { S.departments = list(s).sort(byName); scheduleRender(); }, err('departments')));
  if (r !== 'employee') L.push(onSnapshot(collection(db, 'vendors'), s => { S.vendors = list(s).sort(byName); scheduleRender(); }, err('vendors')));
  L.push(onSnapshot(collection(db, 'locations'), s => { S.locations = list(s).sort(byName); scheduleRender(); }, err('locations')));
  if (r === 'employee'){
    const eid = S.profile.empId || '__none__';
    L.push(onSnapshot(query(collection(db, 'assets'), where('current.employeeId', '==', eid)), s => { S.assets = list(s); scheduleRender(); }, err('your assets')));
    L.push(onSnapshot(query(collection(db, 'assignments'), where('employeeId', '==', eid)), s => { S.assignments = list(s); scheduleRender(); }, err('your history')));
    return;
  }
  L.push(onSnapshot(collection(db, 'assets'), s => { S.assets = list(s).map(a => ({...a, assetId: a.assetId || a.id, current: a.current || {}})); scheduleRender(); }, err('assets')));
  L.push(onSnapshot(collection(db, 'assignments'), s => { S.assignments = list(s); scheduleRender(); }, err('assignments')));
  L.push(onSnapshot(collection(db, 'employees'), s => { S.employees = list(s); scheduleRender(); }, err('employees')));
  L.push(onSnapshot(collection(db, 'openingStock'), s => { S.opening = Object.fromEntries(s.docs.map(d => [d.id, d.data()])); scheduleRender(); }, err('opening stock')));
  if (r === 'admin'){
    L.push(onSnapshot(collection(db, 'users'), s => { S.users = list(s); scheduleRender(); }, err('users')));
    L.push(onSnapshot(query(collection(db, 'audit'), orderBy('at', 'desc'), limit(500)), s => { S.audit = list(s); scheduleRender(); }, err('audit log')));
  }
}

onAuthStateChanged(auth, async user => {
  unsubAll(); closeModal();
  Object.assign(S, {user, profile: null, settings: {}, types: [], departments: [], locations: [], vendors: [], employees: [], assets: [], assignments: [], opening: {}, users: [], audit: [], draft: {}});
  if (!user){ const m = sessionMsg; sessionMsg = ''; showLogin(m); return; }
  screen('loading');
  try {
    const p = await getDoc(doc(db, 'users', user.uid));
    if (!p.exists()){
      // The rules only let an unprofiled account read settings/app while the app is not yet bootstrapped.
      let bootstrapped = true;
      try { bootstrapped = (await getDoc(doc(db, 'settings', 'app'))).exists(); } catch { bootstrapped = true; }
      if (!bootstrapped) return showBootstrap();
      return showMessage(`<div class="note">Signed in as <b>${esc(user.email)}</b>, but no access profile exists for this account. Ask an administrator to add you under <b>Users</b>.</div>`);
    }
    S.profile = {id: p.id, ...p.data()};
    if (S.profile.active === false) return showMessage('<div class="err">Your access has been disabled. Contact an administrator.</div>');
    if (S.profile.role === 'employee' && !S.profile.empId) return showMessage('<div class="note">Your account is not linked to an Employee ID yet. Ask an administrator.</div>');
    $('#whoName').textContent = S.profile.name || user.email;
    $('#whoRole').innerHTML = `<span class="chip ${S.profile.role === 'admin' ? 'gold' : 'teal'}">${esc(S.profile.role)}</span>`;
    screen('app'); lastAct = 0; resetIdle(); subscribe(); render();
  } catch (e){
    console.error(e);
    showMessage(`<div class="err">Could not load your profile: ${esc(errMsg(e))}<br><br>Check that the Firebase config is filled in and the Firestore rules are published.</div>`);
  }
});

if (firebaseConfig.apiKey === 'YOUR_API_KEY'){
  screen('auth'); $('#authBody').innerHTML = '<div class="err">Firebase is not configured yet. Open <b>index.html</b> and paste your project\'s config into <code>firebaseConfig</code> (see SETUP.md).</div>';
}
