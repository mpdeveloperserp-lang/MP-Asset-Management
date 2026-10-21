import { arrayUnion, collection, db, doc, runTransaction, serverTimestamp, where, writeBatch } from './firebase.js';
import { daysBetween, g, isNum, serialKeyOf, today } from './calc.js';

/* =====================================================================
   STATE & HELPERS
   ===================================================================== */
const S = {
  user:null, profile:null, settings:{}, types:[], departments:[], locations:[], vendors:[], employees:[], assets:[], assignments:[],
  opening:{}, users:[], audit:[], unsubs:[],
  f:{}, vf:{}, rf:{days:'30', fy:''}, ef:{}, af:{}, rt:'stock', mt:'types', draft:{}, lastReport:null
};
const STATUSES = ['In Stock','Assigned','Under Repair','Lost','Disposed'];
const STATUS_LABEL = s => s === 'Lost' ? 'Lost – Pending Review' : s;
const ROLES = ['admin','manager','viewer','employee'];

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const curSym = () => S.settings.currency || '₹';
const money = v => isNum(v) ? curSym() + Number(v).toLocaleString('en-IN', {maximumFractionDigits:0}) : '—';
const num = v => Number(v || 0).toLocaleString('en-IN', {maximumFractionDigits:1});
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '—';
const fmtTs = ts => ts?.toDate ? ts.toDate().toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '…';
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const clean = o => o == null ? null : JSON.parse(JSON.stringify(o));
const role = () => S.profile?.role;
const isAdmin = () => role() === 'admin';
const isWriter = () => role() === 'admin' || role() === 'manager';
const typeOf = a => S.types.find(t => t.id === a.typeId);
const typeLabel = a => typeOf(a)?.name || a.typeName || '?';
const subLabel = a => typeOf(a)?.subtypes?.find(s => s.code === a.subCode)?.name || a.subtype || '?';
const empById = id => S.employees.find(e => e.empId === id);
const activeDepts = () => S.departments.filter(d => d.active !== false).sort(byName);
const activeLocs = () => S.locations.filter(l => l.active !== false).sort(byName);
const activeVendors = () => S.vendors.filter(v => v.active !== false).sort(byName);
const vendorOf = a => a.vendor ? S.vendors.find(v => v.name === a.vendor) : null;
function vendorSelect(name, sel = '', attrs = ''){
  const list = activeVendors(), known = !sel || list.some(v => v.name === sel);
  return `<select name="${name}" ${attrs}><option value="">— Select vendor —</option>${list.map(v => `<option ${v.name === sel ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}${known ? '' : `<option selected>${esc(sel)}</option>`}</select>`;
}
function warrantyChip(a){
  if (!a.warrantyUntil) return '';
  const d = daysBetween(today(), a.warrantyUntil);
  return d < 0 ? '<span class="chip grey">Warranty expired</span>' : d <= 60 ? `<span class="chip amber">Warranty ends in ${d}d</span>` : '<span class="chip green">In warranty</span>';
}
const locText = a => [a.location, a.locationDetail].filter(Boolean).join(' · ');
function locSelect(name, sel = '', {blank = '— Select location —', attrs = ''} = {}){
  const list = activeLocs(), known = !sel || list.some(l => l.name === sel);
  return `<select ${name ? `name="${name}"` : ''} ${attrs}><option value="">${blank}</option>${list.map(l => `<option ${l.name === sel ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}${known ? '' : `<option selected>${esc(sel)}</option>`}</select>`;
}

function chip(status){
  const m = {'In Stock':'teal','Assigned':'navy','Under Repair':'amber','Lost':'red','Disposed':'grey'};
  return `<span class="chip ${m[status] || 'grey'}">${esc(STATUS_LABEL(status))}</span>`;
}
function holderText(a){
  const c = a.current || {};
  if (a.status !== 'Assigned') return '';
  if (!c.department) return 'Unassigned (holder unknown)';
  return c.employeeName ? `${c.employeeName} (${c.employeeId}) · ${c.department}` : `${c.department} (department pool)`;
}
function holderHtml(a){
  const c = a.current || {};
  if (a.status !== 'Assigned') return '<span class="sub">—</span>';
  if (!c.department) return '<span class="flag">⚠ Unassigned</span>';
  return c.employeeName
    ? `${esc(c.employeeName)}<div class="sub">${esc(c.employeeId)} · ${esc(c.department)}</div>`
    : `${esc(c.department)}<div class="sub">department pool</div>`;
}
function toast(msg, type='ok'){
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (type === 'err' ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, type === 'err' ? 6000 : 3200);
}
function errMsg(e){
  const m = String(e?.message || e);
  if (m.includes('permission') || m.includes('PERMISSION')) return 'You do not have permission for this action.';
  return m.replace(/^Firebase:\s*/, '');
}

/* ---------- dates & CSV ---------- */
function download(name, text, mime='text/csv;charset=utf-8'){
  const url = URL.createObjectURL(new Blob([text], {type:mime}));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

/* ---------- depreciation (straight-line, monthly) ---------- */

/* ---------- exceptions ---------- */
function exceptions(){
  const out = [], t = today();
  for (const a of S.assets){
    if (a.status === 'Disposed') continue;
    const c = a.current || {};
    if (!isNum(a.cost) || !a.purchaseDate){
      const miss = [!isNum(a.cost) && 'cost', !a.purchaseDate && 'purchase date'].filter(Boolean).join(' & ');
      out.push({a, issue:'Data Incomplete', detail:`${miss} missing — excluded from depreciation`});
    }
    if (a.status === 'Assigned' && !c.department) out.push({a, issue:'Unassigned', detail:'In use, holder unknown — assign to resolve'});
    if (a.status === 'Assigned' && c.expectedReturn && c.expectedReturn < t)
      out.push({a, issue:'Overdue Return', detail:`Due ${fmtDate(c.expectedReturn)} · ${holderText(a)}`});
    if (c.employeeId){ const e = empById(c.employeeId); if (e && e.active === false)
      out.push({a, issue:'Held by Exited Employee', detail:`${e.name} (${e.empId}) — HR clearance pending`}); }
    if (a.status === 'Lost') out.push({a, issue:'Lost – Pending Review', detail: a.lost?.notes || ''});
  }
  return out;
}

/* ---------- filters ---------- */
function applyFilters(list, f){
  const q = (f.q || '').toLowerCase().trim();
  return list.filter(a => {
    if (f.type && a.typeId !== f.type) return false;
    if (f.sub && `${a.typeId}|${a.subCode}` !== f.sub) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.dept){
      const d = a.current?.department || '';
      if (f.dept === '__none' ? d : d !== f.dept) return false;
    }
    if (f.vendor && (f.vendor === '__none' ? a.vendor : (a.vendor || '') !== f.vendor)) return false;
    if (f.loc){ const l = a.location || ''; if (f.loc === '__none' ? l : l !== f.loc) return false; }
    if (f.from && (a.purchaseDate || '') < f.from) return false;
    if (f.to && (!a.purchaseDate || a.purchaseDate > f.to)) return false;
    if (q && ![a.assetId, a.name, a.serial, a.make, a.vendor, a.invoice, a.location, a.locationDetail, a.current?.employeeName, a.current?.employeeId]
      .join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
function filterBar(scope, f, opts = {}){
  const id = k => `${scope}-${k}`;
  const types = [...S.types].sort(byName);
  const subs = types.filter(t => !f.type || t.id === f.type)
    .flatMap(t => (t.subtypes || []).map(s => ({v:`${t.id}|${s.code}`, l: f.type ? s.name : `${t.name} › ${s.name}`})));
  return `<div class="filters">
    <input type="search" id="${id('q')}" data-filter="${scope}.q" placeholder="Search ID, name, serial, employee…" value="${esc(f.q || '')}">
    <select id="${id('type')}" data-filter="${scope}.type"><option value="">All types</option>${types.map(t => `<option value="${t.id}" ${f.type === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <select id="${id('sub')}" data-filter="${scope}.sub"><option value="">All subtypes</option>${subs.map(s => `<option value="${esc(s.v)}" ${f.sub === s.v ? 'selected' : ''}>${esc(s.l)}</option>`).join('')}</select>
    ${opts.noStatus ? '' : `<select id="${id('status')}" data-filter="${scope}.status"><option value="">All statuses</option>${STATUSES.map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${STATUS_LABEL(s)}</option>`).join('')}</select>`}
    ${opts.noDept ? '' : `<select id="${id('dept')}" data-filter="${scope}.dept"><option value="">All departments</option><option value="__none" ${f.dept === '__none' ? 'selected' : ''}>(No department)</option>${S.departments.slice().sort(byName).map(d => `<option ${f.dept === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`}
    ${opts.vendor ? `<select id="${id('vendor')}" data-filter="${scope}.vendor"><option value="">All vendors</option><option value="__none" ${f.vendor === '__none' ? 'selected' : ''}>(No vendor)</option>${S.vendors.slice().sort(byName).map(v => `<option ${f.vendor === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : ''}
    ${opts.noLoc ? '' : `<select id="${id('loc')}" data-filter="${scope}.loc"><option value="">All locations</option><option value="__none" ${f.loc === '__none' ? 'selected' : ''}>(No location)</option>${S.locations.slice().sort(byName).map(l => `<option ${f.loc === l.name ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`}
    ${opts.noDates ? '' : `<span class="lbl">Purchased</span><input type="date" id="${id('from')}" data-filter="${scope}.from" value="${esc(f.from || '')}"><span class="lbl">to</span><input type="date" id="${id('to')}" data-filter="${scope}.to" value="${esc(f.to || '')}">`}
    ${opts.extra || ''}
    <button class="btn sm" data-act="clear-filters" data-scope="${scope}">Clear</button>
  </div>`;
}

/* ---------- audit ---------- */
function diff(before, after){
  const b = {}, a = {}, skip = ['updatedAt','createdAt','log','updatedBy','updatedByName'];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys){
    if (skip.includes(k)) continue;
    const x = before?.[k] ?? null, y = after?.[k] ?? null;
    if (JSON.stringify(x) !== JSON.stringify(y)){ b[k] = x; a[k] = y; }
  }
  return {b, a};
}
function addAudit(w, entity, entityId, action, before, after, extra){
  const e = auditEntry(entity, entityId, action, before, after, extra);
  w.set(e.ref, e.data);
  return e.ref;   // the audited document stores ref.id as lastAuditId (required by the security rules)
}
/* Transaction reference shown in history and audit (one per business transaction). */
const txRef = () => 'TX-' + today().replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
/* Audit document. entityIds = every record the entry covers (the rules check membership). */
function auditEntry(entity, entityIds, action, before, after, extra = {}){
  const ids = (Array.isArray(entityIds) ? entityIds : [entityIds]).map(String);
  const {b, a} = diff(clean(before), clean(after));
  return {ref: doc(collection(db, 'audit')), data: {
    at: serverTimestamp(), by: S.user.uid, byName: S.profile?.name || S.user.email,
    entity, entityId: ids[0], entityIds: ids, action, before: b, after: a, txRef: txRef(), ...extra}};
}
const logEntry = (action, note = '', ref = '') => ({at: new Date().toISOString(), by: S.profile.name || S.user.email, action, note: note || '', txRef: ref || ''});

/* ---------- serial numbers ---------- */

/* ---------- manager scope (mirrors the security rules) ---------- */
const mgrDepts = () => S.profile?.managedDepartments || (S.profile?.department ? [S.profile.department] : []);
const mgrLocs = () => S.profile?.managedLocations || [];
const inScope = a => (!!a.current?.department && mgrDepts().includes(a.current.department)) || (!!a.location && mgrLocs().includes(a.location));
const canManage = a => isAdmin() || (role() === 'manager' && inScope(a) && ['In Stock', 'Assigned', 'Under Repair'].includes(a.status));
/* For new assets: a manager may only register at their locations, or assigned to their departments. */
function scopeError(location, department){
  if (isAdmin()) return '';
  if ((location && mgrLocs().includes(location)) || (department && mgrDepts().includes(department))) return '';
  const where = [mgrLocs().length && `locations: ${mgrLocs().join(', ')}`, mgrDepts().length && `departments: ${mgrDepts().join(', ')}`].filter(Boolean).join('; ');
  return `Outside your authorised scope (${where || 'none assigned — ask an admin'}).`;
}

class ConflictError extends Error {}

/* =====================================================================
   DATA WRITES — every write is atomic and audited
   ===================================================================== */
/* Retries an operation that failed because of a write conflict (contention), up to 5 attempts.
   Only for idempotent reservations; a genuine refusal still surfaces after the last attempt. */
const RETRYABLE = ['aborted', 'failed-precondition', 'unavailable', 'deadline-exceeded', 'permission-denied'];
async function withRetry(fn, attempts = 5){
  for (let i = 1; ; i++){
    try { return await fn(); }
    catch (e){
      if (i >= attempts || !RETRYABLE.includes(e?.code)) throw e;
      await new Promise(r => setTimeout(r, 150 * i + Math.random() * 250));
    }
  }
}
async function nextAssetIds(typeCode, subCode, n){
  const key = `${typeCode}-${subCode}`, ref = doc(db, 'counters', key);
  // Two people saving at the same instant contend for the counter; retry with a short random pause.
  const start = await withRetry(() => runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? (snap.data().next || 1) : 1;
    tx.set(ref, {next: cur + n});
    return cur;
  }));
  return Array.from({length: n}, (_, i) => `${key}-${String(start + i).padStart(4, '0')}`);
}

/* Assets per transaction. Each asset costs up to two document look-ups in the security rules
   (serial index + asset), and Firestore allows 20 per transaction. */
const CREATE_CHUNK = 6;

/* items: [{base, assign?:{department, employeeId, employeeName, date, expectedReturn, notes}}]
   Returns {created:[ids], failed:null | {error, items:[items not saved]}}.
   Each chunk is one transaction: assets + serial index + assignments + audit are saved together or not at all. */
async function createAssetRecords(items, note = '', onProgress){
  const groups = {};
  items.forEach(it => { const k = `${it.base.typeCode}-${it.base.subCode}`; (groups[k] = groups[k] || []).push(it); });
  for (const k of Object.keys(groups)){
    const [tc, sc] = k.split('-');
    const ids = await nextAssetIds(tc, sc, groups[k].length);
    groups[k].forEach((it, i) => it.id = ids[i]);
  }
  const created = [];
  for (let i = 0; i < items.length; i += CREATE_CHUNK){
    const chunk = items.slice(i, i + CREATE_CHUNK);
    try {
      await runTransaction(db, async tx => {
        const aSnaps = await Promise.all(chunk.map(it => tx.get(doc(db, 'assets', it.id))));
        aSnaps.forEach((s, j) => { if (s.exists()) throw new Error(`Asset ID ${chunk[j].id} is already in use. Ask an admin to run Integrity → “Advance counters”, then retry.`); });
        const sSnaps = await Promise.all(chunk.map(it => (it.base.serial || '').trim() ? tx.get(doc(db, 'serials', serialKeyOf(it.base.serial))) : null));
        sSnaps.forEach((s, j) => { if (s && s.exists()) throw new Error(`Serial number ${chunk[j].base.serial} is already registered to ${s.data().assetId}.`); });
        const ref = txRef();
        const summary = Object.fromEntries(chunk.map(it => [it.id, {name: it.base.name, serial: it.base.serial || '', location: it.base.location || '', cost: it.base.cost ?? null, qty: it.base.qty, source: it.base.source}]));
        const au = auditEntry('asset', chunk.map(it => it.id), chunk.length > 1 ? 'Create (batch)' : 'Create', null,
          chunk.length === 1 ? chunk[0].base : {assets: summary, note}, {txRef: ref});
        tx.set(au.ref, au.data);
        for (const it of chunk){
          const base = clean(it.base);
          base.serial = (base.serial || '').trim();
          base.serialKey = serialKeyOf(base.serial);
          if (it.assign){
            const aRef = doc(collection(db, 'assignments')), as = it.assign;
            tx.set(aRef, {
              assetId: it.id, assetName: base.name, department: as.department, employeeId: as.employeeId || '',
              employeeName: as.employeeName || '', startDate: as.date, endDate: null, expectedReturn: as.expectedReturn || '',
              conditionOut: 'Good', conditionIn: '', notes: as.notes || '', kind: 'Assign', fromHolder: '', txRef: ref,
              issuedBy: S.user.uid, issuedByName: S.profile.name, closeReason: '', createdAt: serverTimestamp()
            });
            base.status = 'Assigned';
            base.current = {assignmentId: aRef.id, department: as.department, employeeId: as.employeeId || '',
              employeeName: as.employeeName || '', assignedDate: as.date, expectedReturn: as.expectedReturn || '', notes: as.notes || ''};
          }
          tx.set(doc(db, 'assets', it.id), {
            ...base, assetId: it.id, rev: 0, lastAuditId: au.ref.id,
            createdAt: serverTimestamp(), createdBy: S.user.uid, createdByName: S.profile.name, updatedAt: serverTimestamp(),
            log: [logEntry('Created', note || (base.source === 'Opening' ? 'Opening balance' : ''), ref)]
          });
          if (base.serial) tx.set(doc(db, 'serials', base.serialKey), {assetId: it.id, serial: base.serial, by: S.user.uid, at: serverTimestamp()});
        }
      });
      created.push(...chunk.map(it => it.id));
      if (onProgress) onProgress(created.length, items.length);
    } catch (error){
      console.error('createAssetRecords', error);
      return {created, failed: {error, items: items.slice(i)}};
    }
  }
  return {created, failed: null};
}

/* Update one asset inside a transaction:
   • re-reads the asset, so it never acts on a stale on-screen copy;
   • refuses if anyone changed it since it was opened (rev — also enforced by the rules);
   • saves asset + audit + related assignment changes (extra) atomically.
   opts.serial: when the serial number changes (admin) — reserves the new index entry and releases the old one. */
async function updateAsset(a, patch, action, note, extra, opts = {}){
  const ref = doc(db, 'assets', a.assetId);
  const result = await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Asset ${a.assetId} no longer exists.`);
    const fresh = snap.data();
    if ((fresh.rev || 0) !== (a.rev || 0))
      throw new ConflictError(`${a.assetId} was changed by ${fresh.updatedByName || 'another user'} after you opened it. Nothing was saved — reopen the asset and try again.`);
    let serialWrites = null;
    if (opts.serial){
      const newKey = serialKeyOf(opts.serial.serial), oldKey = fresh.serialKey || '';
      const newSnap = newKey ? await tx.get(doc(db, 'serials', newKey)) : null;
      if (newSnap && newSnap.exists() && newSnap.data().assetId !== a.assetId)
        throw new Error(`Serial number ${opts.serial.serial} is already registered to ${newSnap.data().assetId}.`);
      const oldSnap = oldKey && oldKey !== newKey ? await tx.get(doc(db, 'serials', oldKey)) : null;
      serialWrites = {newKey, create: !!newKey && !(newSnap && newSnap.exists()), releaseOld: !!(oldSnap && oldSnap.exists() && oldSnap.data().assetId === a.assetId) ? oldKey : ''};
    }
    const p = {...patch};
    if (opts.serial){ p.serial = opts.serial.serial.trim(); p.serialKey = serialWrites.newKey; }
    const before = {}; Object.keys(p).forEach(k => before[k] = fresh[k] ?? null);
    const tref = txRef();
    const au = auditEntry('asset', a.assetId, action, before, p, {txRef: tref, note: note || ''});
    tx.set(au.ref, au.data);
    if (extra) extra(tx, fresh, tref);
    tx.update(ref, {...p, rev: (fresh.rev || 0) + 1, lastAuditId: au.ref.id,
      updatedAt: serverTimestamp(), updatedBy: S.user.uid, updatedByName: S.profile.name,
      log: arrayUnion(logEntry(action, note, tref))});
    if (serialWrites?.create) tx.set(doc(db, 'serials', serialWrites.newKey), {assetId: a.assetId, serial: p.serial, by: S.user.uid, at: serverTimestamp()});
    if (serialWrites?.releaseOld) tx.delete(doc(db, 'serials', serialWrites.releaseOld));
    return tref;
  });
  return result;
}
function closeAssignment(tx, fresh, endDate, reason, conditionIn = '', more = {}){
  const id = fresh.current?.assignmentId;
  // Only close a period that exists and is open (a missing/closed pointer is reported by Data Integrity instead).
  if (id && S.assignments.some(h => h.id === id && !h.endDate)) tx.update(doc(db, 'assignments', id), {endDate, closeReason: reason, conditionIn, closedBy: S.user.uid, closedByName: S.profile.name, ...more});
}

/* Writes a document that the rules require to be audit-linked (users, settings) together with its audit entry. */
async function auditedSet(ref, data, entity, action, before, opts = {}){
  const b = writeBatch(db);
  const aRef = addAudit(b, entity, ref.id, action, before, data);
  if (opts.update) b.update(ref, {...data, lastAuditId: aRef.id});
  else b.set(ref, {...data, lastAuditId: aRef.id}, {merge: !!opts.merge});
  if (opts.extra) opts.extra(b);
  await b.commit();
}

export { withRetry, S, STATUSES, STATUS_LABEL, ROLES, $, $$, esc, curSym, money, num, fmtDate, fmtTs, byName, clean, role, isAdmin, isWriter, canManage, typeOf, typeLabel, subLabel, empById, activeDepts, activeLocs, activeVendors, vendorOf, vendorSelect, warrantyChip, locText, locSelect, chip, holderText, holderHtml, toast, errMsg, download, exceptions, applyFilters, filterBar, diff, addAudit, logEntry, nextAssetIds, createAssetRecords, updateAsset, closeAssignment, auditEntry, txRef, mgrDepts, mgrLocs, inScope, scopeError, ConflictError, CREATE_CHUNK, auditedSet };
