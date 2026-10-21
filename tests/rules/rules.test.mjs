// Firestore Security Rules tests — run against the official Firebase emulator.
//   cd tests && npm install && npm run test:rules
// (needs Java 11+; `firebase emulators:exec` starts and stops the emulator automatically)
// Each test attempts the operation DIRECTLY against Firestore, bypassing the app UI.
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, runTransaction,
  serverTimestamp, arrayUnion } from 'firebase/firestore';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.resolve(HERE, '../../firestore.rules'), 'utf8');
let env;

const USERS = {
  admin:   {name: 'Admin', role: 'admin', active: true, managedDepartments: [], managedLocations: []},
  mgr:     {name: 'Mani', role: 'manager', department: 'Sales', managedDepartments: ['Sales'], managedLocations: ['Tower A'], active: true},
  legacyMgr: {name: 'Old', role: 'manager', department: 'Sales', active: true},            // profile created before Phase 1
  viewer:  {name: 'Vik', role: 'viewer', active: true},
  emp:     {name: 'Priya', role: 'employee', empId: 'E1', active: true},
  emp2:    {name: 'Arun', role: 'employee', empId: 'E2', active: true},
  gone:    {name: 'Ex', role: 'manager', managedDepartments: ['Sales'], active: false}
};
const asset = (id, over = {}) => ({assetId: id, name: id, typeId: 't1', subCode: 'CAM', typeCode: 'ELE', qty: 1, cost: 3200,
  purchaseDate: '2026-10-01', status: 'In Stock', source: 'Purchase', serial: '', serialKey: '', rev: 0, current: {},
  location: 'Head Office', createdBy: 'admin', ...over});

const db = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function seed(extra = async () => {}){
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(f, 'users', uid), u);
    await setDoc(doc(f, 'settings', 'app'), {openingLocked: false, cutoff: '2026-03-31'});
    await setDoc(doc(f, 'types', 't1'), {name: 'Electronics', code: 'ELE', subtypes: [{name: 'CCTV Camera', code: 'CAM'}]});
    await setDoc(doc(f, 'counters', 'ELE-CAM'), {next: 10});
    await setDoc(doc(f, 'assets', 'ELE-CAM-0001'), asset('ELE-CAM-0001', {status: 'Assigned', serial: 'S1', serialKey: 's1',
      current: {assignmentId: 'h1', department: 'Sales', employeeId: 'E1', employeeName: 'Priya'}}));
    await setDoc(doc(f, 'serials', 's1'), {assetId: 'ELE-CAM-0001', by: 'admin'});
    await setDoc(doc(f, 'assignments', 'h1'), {assetId: 'ELE-CAM-0001', department: 'Sales', employeeId: 'E1', startDate: '2026-10-01', endDate: null, issuedBy: 'admin'});
    await setDoc(doc(f, 'assets', 'ELE-CAM-0002'), asset('ELE-CAM-0002', {status: 'Assigned',
      current: {assignmentId: 'h2', department: 'Finance', employeeId: 'E2'}}));
    await setDoc(doc(f, 'assignments', 'h2'), {assetId: 'ELE-CAM-0002', department: 'Finance', employeeId: 'E2', startDate: '2026-10-01', endDate: null, issuedBy: 'admin'});
    await setDoc(doc(f, 'assets', 'ELE-CAM-0003'), asset('ELE-CAM-0003', {location: 'Tower A'}));
    await setDoc(doc(f, 'assignments', 'old'), {assetId: 'ELE-CAM-0003', department: 'Sales', employeeId: 'E1', startDate: '2026-01-01', endDate: '2026-02-01', issuedBy: 'admin'});
    await setDoc(doc(f, 'audit', 'a0'), {by: 'admin', entity: 'asset', entityIds: ['ELE-CAM-0001'], action: 'seed'});
    await extra(f);
  });
}

// ---- helpers that mimic what the app writes ----
function auditDoc(f, uid, entity, ids, action = 'test'){
  const ref = doc(collection(f, 'audit'));
  return {ref, data: {at: serverTimestamp(), by: uid, byName: uid, entity, entityId: ids[0], entityIds: ids, action, before: {}, after: {}}};
}
async function createAsset(uid, id, over = {}, {withAudit = true, withSerialIndex = true, assign = null} = {}){
  const f = db(uid), b = writeBatch(f);
  const a = asset(id, {createdBy: uid, ...over});
  if (withAudit){ const au = auditDoc(f, uid, 'asset', [id], 'Create'); b.set(au.ref, au.data); a.lastAuditId = au.ref.id; }
  if (assign){
    const h = doc(collection(f, 'assignments'));
    a.status = 'Assigned'; a.current = {assignmentId: h.id, ...assign};
    b.set(h, {assetId: id, endDate: null, issuedBy: uid, startDate: '2026-10-10', ...assign});
  }
  b.set(doc(f, 'assets', id), a);
  if (a.serial && withSerialIndex) b.set(doc(f, 'serials', a.serialKey), {assetId: id, by: uid, serial: a.serial});
  return b.commit();
}
async function updateAsset(uid, id, patch, {withAudit = true, revDelta = 1, auditBy = uid, auditIds = [id], extra} = {}){
  const f = db(uid);
  return runTransaction(f, async tx => {
    const s = await tx.get(doc(f, 'assets', id));
    const cur = s.data();
    const p = {...patch, rev: (cur.rev || 0) + revDelta, log: arrayUnion({action: 'x'})};
    if (withAudit){ const au = auditDoc(f, auditBy, 'asset', auditIds); tx.set(au.ref, {...au.data, by: auditBy}); p.lastAuditId = au.ref.id; }
    if (extra) extra(tx, f, cur);
    tx.update(doc(f, 'assets', id), p);
  });
}

before(async () => {
  env = await initializeTestEnvironment({projectId: 'demo-mp-assets', firestore: {rules: RULES,
    host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080)}});
});
// Same retry policy as the app (js/core.js withRetry): contention between simultaneous writers is retried.
async function withRetry(fn, attempts = 5){
  for (let i = 1; ; i++){
    try { return await fn(); }
    catch (e){ if (i >= attempts) throw e; await new Promise(r => setTimeout(r, 150 * i + Math.random() * 250)); }
  }
}
// clearFirestore can briefly hit locks left by aborted concurrent transactions — retry.
beforeEach(async () => { await withRetry(() => env.clearFirestore(), 8); await seed(); });
after(async () => { await env?.cleanup(); });

// ---------------- Acceptance 6: viewer cannot modify through direct requests ----------------
test('viewer: read allowed, every write denied', async () => {
  await assertSucceeds(getDoc(doc(db('viewer'), 'assets', 'ELE-CAM-0001')));
  await assertFails(createAsset('viewer', 'ELE-CAM-0050'));
  await assertFails(updateAsset('viewer', 'ELE-CAM-0001', {name: 'hacked'}));
  await assertFails(setDoc(doc(db('viewer'), 'types', 'tx'), {name: 'X', code: 'XX', subtypes: []}));
  await assertFails(setDoc(doc(db('viewer'), 'counters', 'ELE-CAM'), {next: 11}));
  const au = auditDoc(db('viewer'), 'viewer', 'asset', ['x']);
  await assertFails(setDoc(au.ref, au.data));
});

// ---------------- Acceptance 5: employee isolation ----------------
test('employee: only own assets and own history', async () => {
  const f = db('emp');
  await assertSucceeds(getDoc(doc(f, 'assets', 'ELE-CAM-0001')));
  await assertFails(getDoc(doc(f, 'assets', 'ELE-CAM-0002')));
  await assertSucceeds(getDocs(query(collection(f, 'assets'), where('current.employeeId', '==', 'E1'))));
  await assertFails(getDocs(query(collection(f, 'assets'), where('current.employeeId', '==', 'E2'))));
  await assertFails(getDocs(collection(f, 'assets')));
  await assertSucceeds(getDocs(query(collection(f, 'assignments'), where('employeeId', '==', 'E1'))));
  await assertFails(getDocs(query(collection(f, 'assignments'), where('employeeId', '==', 'E2'))));
  await assertFails(getDocs(collection(f, 'employees')));
  await assertFails(getDocs(collection(f, 'vendors')));
  await assertFails(getDocs(collection(f, 'audit')));
  await assertFails(updateAsset('emp', 'ELE-CAM-0001', {name: 'mine now'}));
});

test('unprofiled and inactive accounts are locked out', async () => {
  await assertFails(getDoc(doc(db('stranger'), 'assets', 'ELE-CAM-0001')));
  await assertFails(getDoc(doc(db('stranger'), 'settings', 'app')), 'bootstrapped → settings hidden');
  await assertFails(getDoc(doc(anon(), 'assets', 'ELE-CAM-0001')));
  await assertFails(getDoc(doc(db('gone'), 'assets', 'ELE-CAM-0001')));
  await assertFails(updateAsset('gone', 'ELE-CAM-0001', {status: 'In Stock'}));
});

// ---------------- Acceptance 7: manager scope ----------------
test('manager: in-scope lifecycle allowed', async () => {
  // held by Sales → may send to repair after return (status change + audit + rev)
  await assertSucceeds(updateAsset('mgr', 'ELE-CAM-0001', {status: 'Assigned', locationDetail: 'Desk 4'}));
  // at Tower A (location scope) → may assign to any department
  await assertSucceeds(updateAsset('mgr', 'ELE-CAM-0003', {status: 'Assigned', current: {assignmentId: 'hNew', department: 'Finance'}}, {
    extra: (tx, f) => tx.set(doc(f, 'assignments', 'hNew'), {assetId: 'ELE-CAM-0003', department: 'Finance', endDate: null, issuedBy: 'mgr'})}));
});
test('manager: out-of-scope, financial fields, disposal and transfers out are denied', async () => {
  await assertFails(updateAsset('mgr', 'ELE-CAM-0002', {status: 'In Stock', current: {}}), 'held by Finance');
  await assertFails(updateAsset('mgr', 'ELE-CAM-0001', {cost: 1}), 'cost is admin-only');
  await assertFails(updateAsset('mgr', 'ELE-CAM-0001', {purchaseDate: '2020-01-01'}));
  await assertFails(updateAsset('mgr', 'ELE-CAM-0001', {qty: 5}));
  await assertFails(updateAsset('mgr', 'ELE-CAM-0001', {serial: 'NEW', serialKey: 'new'}));
  await assertFails(updateAsset('mgr', 'ELE-CAM-0001', {status: 'Disposed', disposal: {date: '2026-10-10'}, current: {}}));
  await assertFails(updateAsset('mgr', 'ELE-CAM-0001', {current: {assignmentId: 'hx', department: 'Finance'}}), 'moving out of scope');
  await assertFails(createAsset('mgr', 'ELE-CAM-0060', {location: 'Head Office'}), 'unallocated stock outside own locations');
  await assertSucceeds(createAsset('mgr', 'ELE-CAM-0061', {location: 'Tower A'}));
  await assertSucceeds(createAsset('mgr', 'ELE-CAM-0062', {location: 'Head Office'}, {assign: {department: 'Sales'}}));
});
test('legacy manager profile (no scope lists) falls back to home department', async () => {
  await assertSucceeds(updateAsset('legacyMgr', 'ELE-CAM-0001', {locationDetail: 'x'}));
  await assertFails(updateAsset('legacyMgr', 'ELE-CAM-0003', {locationDetail: 'x'}));
});

// ---------------- audit trail cannot be bypassed or altered (Acceptance 8) ----------------
test('every asset write must be linked to a fresh audit entry by the same user', async () => {
  await assertFails(updateAsset('admin', 'ELE-CAM-0001', {name: 'no audit'}, {withAudit: false}));
  await assertFails(updateAsset('admin', 'ELE-CAM-0001', {name: 'audit by someone else'}, {auditBy: 'mgr'}));
  await assertFails(updateAsset('admin', 'ELE-CAM-0001', {name: 'audit for another record'}, {auditIds: ['ELE-CAM-0002']}));
  await assertFails(createAsset('admin', 'ELE-CAM-0070', {}, {withAudit: false}));
  await assertSucceeds(updateAsset('admin', 'ELE-CAM-0001', {name: 'ok'}));
});
test('audit entries are append-only and admin-readable only', async () => {
  await assertFails(updateDoc(doc(db('admin'), 'audit', 'a0'), {action: 'edited'}));
  await assertFails(deleteDoc(doc(db('admin'), 'audit', 'a0')));
  await assertFails(getDoc(doc(db('mgr'), 'audit', 'a0')));
  await assertSucceeds(getDoc(doc(db('admin'), 'audit', 'a0')));
  const f = db('mgr'), au = auditDoc(f, 'admin', 'asset', ['x']);
  await assertFails(setDoc(au.ref, au.data), 'cannot forge another user');
  await assertFails(setDoc(au.ref, {...auditDoc(f, 'mgr', 'asset', ['x']).data, at: new Date(2000, 0, 1)}), 'cannot back-date');
});

// ---------------- optimistic concurrency ----------------
test('stale writes are rejected (rev must increase by exactly 1)', async () => {
  await assertFails(updateAsset('admin', 'ELE-CAM-0001', {name: 'stale'}, {revDelta: 0}));
  await assertFails(updateAsset('admin', 'ELE-CAM-0001', {name: 'skip'}, {revDelta: 2}));
});

// ---------------- Acceptance 1: unique asset IDs ----------------
test('an existing asset can never be overwritten by a create (ID collision)', async () => {
  await assertFails(createAsset('admin', 'ELE-CAM-0001', {name: 'overwrite attempt'}));
});
test('counters only move forward', async () => {
  await assertFails(setDoc(doc(db('admin'), 'counters', 'ELE-CAM'), {next: 5}));
  await assertFails(setDoc(doc(db('admin'), 'counters', 'ELE-CAM'), {next: 10}));
  await assertSucceeds(setDoc(doc(db('mgr'), 'counters', 'ELE-CAM'), {next: 11}));
  await assertFails(deleteDoc(doc(db('admin'), 'counters', 'ELE-CAM')));
});
test('concurrent ID reservations never overlap', async () => {
  const take = n => { const f = db('admin'); return runTransaction(f, async tx => {
    const r = doc(f, 'counters', 'ELE-CAM'); const s = await tx.get(r); const cur = s.data().next;
    tx.set(r, {next: cur + n}); return Array.from({length: n}, (_, i) => cur + i);
  }); };
  // 6 users reserve IDs at the same instant; each retries on contention exactly as the app does.
  const results = await Promise.all(Array.from({length: 6}, () => withRetry(() => take(5), 8)));
  const all = results.flat();
  if (new Set(all).size !== all.length) throw new Error('duplicate IDs issued: ' + all);
  if (all.length !== 30) throw new Error('expected 30 ids');
  let next;
  await env.withSecurityRulesDisabled(async x => { next = (await getDoc(doc(x.firestore(), 'counters', 'ELE-CAM'))).data().next; });
  if (next !== 40) throw new Error('counter should end at 40, got ' + next);
});

// ---------------- Acceptance 2: duplicate serials ----------------
test('duplicate serial numbers are rejected at the database', async () => {
  await assertFails(createAsset('admin', 'ELE-CAM-0080', {serial: 'S1', serialKey: 's1'}), 'index entry s1 already exists');
  await assertFails(createAsset('admin', 'ELE-CAM-0081', {serial: 'S9', serialKey: 's9'}, {withSerialIndex: false}), 'serial without index entry');
  await assertFails(createAsset('admin', 'ELE-CAM-0082', {serial: 'S10', serialKey: 'something-else'}), 'serialKey must match serial');
  await assertSucceeds(createAsset('admin', 'ELE-CAM-0083', {serial: 'S11', serialKey: 's11'}));
  await assertFails(createAsset('admin', 'ELE-CAM-0084', {serial: 's11 ', serialKey: 's11'}), 'case/space variant of an existing serial');
});

// ---------------- Acceptance 3/4: assignment history integrity ----------------
test('an assignment period can only be opened when the asset points to it', async () => {
  await assertFails(setDoc(doc(db('admin'), 'assignments', 'free'), {assetId: 'ELE-CAM-0003', department: 'Sales', endDate: null, issuedBy: 'admin'}));
});
test('transfer: closing the old period and opening the new one together succeeds', async () => {
  await assertSucceeds(updateAsset('admin', 'ELE-CAM-0001', {current: {assignmentId: 'h1b', department: 'Finance', employeeId: 'E2'}}, {
    extra: (tx, f) => {
      tx.update(doc(f, 'assignments', 'h1'), {endDate: '2026-10-15', closeReason: 'Transfer', closedBy: 'admin', closedByName: 'Admin'});
      tx.set(doc(f, 'assignments', 'h1b'), {assetId: 'ELE-CAM-0001', department: 'Finance', employeeId: 'E2', endDate: null, issuedBy: 'admin'});
    }}));
});
test('closing the current period without moving the asset off it is denied; closed periods are immutable', async () => {
  await assertFails(updateDoc(doc(db('admin'), 'assignments', 'h1'), {endDate: '2026-10-15', closeReason: 'x', closedBy: 'admin'}));
  await assertFails(updateDoc(doc(db('admin'), 'assignments', 'old'), {endDate: '2026-03-01', closedBy: 'admin'}));
  await assertFails(deleteDoc(doc(db('admin'), 'assignments', 'old')));
});

// ---------------- Acceptance 11: disposal keeps history ----------------
test('assets are never deleted; disposal is admin-only', async () => {
  await assertFails(deleteDoc(doc(db('admin'), 'assets', 'ELE-CAM-0003')));
  await assertSucceeds(updateAsset('admin', 'ELE-CAM-0003', {status: 'Disposed', disposal: {date: '2026-10-15', reason: 'EOL'}}));
});

// ---------------- opening-balance lock ----------------
test('opening-balance lock is enforced for everyone', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'settings', 'app'), {openingLocked: true}));
  await assertFails(createAsset('admin', 'ELE-CAM-0090', {source: 'Opening'}));
  await assertFails(updateAsset('admin', 'ELE-CAM-0003', {source: 'Opening'}));
  await assertFails(setDoc(doc(db('admin'), 'openingStock', 't1__CAM'), {qty: 1, value: 1}));
  await assertSucceeds(createAsset('admin', 'ELE-CAM-0091', {source: 'Purchase'}));
});

// ---------------- Acceptance 8: roles and settings ----------------
test('only admins manage users; nobody can escalate themselves; changes are audited', async () => {
  await assertFails(updateDoc(doc(db('mgr'), 'users', 'mgr'), {role: 'admin'}));
  await assertFails(setDoc(doc(db('stranger'), 'users', 'stranger'), {name: 'x', role: 'admin', active: true}), 'bootstrap closed');
  const f = db('admin'), b = writeBatch(f), au = auditDoc(f, 'admin', 'user', ['newu']);
  b.set(au.ref, au.data); b.set(doc(f, 'users', 'newu'), {name: 'New', role: 'viewer', active: true, lastAuditId: au.ref.id});
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(f, 'users', 'newu2'), {name: 'New', role: 'viewer', active: true}), 'unaudited user change');
  const b2 = writeBatch(f), au2 = auditDoc(f, 'admin', 'user', ['admin']);
  b2.set(au2.ref, au2.data); b2.update(doc(f, 'users', 'admin'), {role: 'viewer', lastAuditId: au2.ref.id});
  await assertFails(b2.commit(), 'admin cannot demote self');
  await assertFails(deleteDoc(doc(f, 'users', 'viewer')));
});
test('settings: admin + audit only', async () => {
  await assertFails(updateDoc(doc(db('mgr'), 'settings', 'app'), {openingLocked: true}));
  await assertFails(updateDoc(doc(db('admin'), 'settings', 'app'), {openingLocked: true}), 'unaudited');
  const f = db('admin'), b = writeBatch(f), au = auditDoc(f, 'admin', 'settings', ['app']);
  b.set(au.ref, au.data); b.update(doc(f, 'settings', 'app'), {openingLocked: true, lastAuditId: au.ref.id});
  await assertSucceeds(b.commit());
});
test('first-admin bootstrap works once on an empty database, then closes', async () => {
  await env.clearFirestore();
  const f = db('first'), b = writeBatch(f);
  b.set(doc(f, 'users', 'first'), {name: 'First', role: 'admin', active: true});
  b.set(doc(f, 'settings', 'app'), {openingLocked: false});
  await assertSucceeds(getDoc(doc(db('first'), 'settings', 'app')), 'unprofiled may check bootstrap state');
  await assertSucceeds(b.commit());
  const g = db('second'), b2 = writeBatch(g);
  b2.set(doc(g, 'users', 'second'), {name: 'Second', role: 'admin', active: true});
  await assertFails(b2.commit());
  await assertFails(getDoc(doc(db('second'), 'settings', 'app')));
});
