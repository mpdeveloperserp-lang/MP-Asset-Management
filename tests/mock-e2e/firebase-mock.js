// In-browser stand-in for the Firebase SDK (served in place of gstatic.com/firebasejs/* by the test runner).
// Implements just enough of Auth + Firestore for UI workflow tests: documents, batches, transactions
// (reads first, writes applied atomically on success), listeners, serverTimestamp, arrayUnion.
// Security rules are NOT simulated here — they are tested against the real emulator in tests/rules.
const seed = window.__SEED || {};
const DB = window.__DB = JSON.parse(JSON.stringify(seed.db || {}));
['users','settings','types','departments','locations','vendors','employees','assets','assignments','openingStock','audit','counters','serials']
  .forEach(c => DB[c] = DB[c] || {});
const AS = new URLSearchParams(location.search).get('as') || seed.as || 'u1';
const subs = new Set(); let idc = 0, txCount = 0;
window.__mock = {txCount: () => txCount, failTxAt: seed.failTxAt || 0, writes: 0};
const notify = () => setTimeout(() => subs.forEach(fn => fn()), 0);
const now = () => ({toDate: () => new Date(), seconds: Math.floor(Date.now() / 1000), __ts: true});

export const initializeApp = () => ({}); export const getAuth = () => ({});
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(AS === 'none' ? null : {uid: AS, email: AS + '@test'}), 5); return () => {}; };
export const signInWithEmailAndPassword = async () => {}; export const signOut = async () => {};
export const createUserWithEmailAndPassword = async (a, email) => ({user: {uid: 'new-' + (++idc), email}});
export const sendPasswordResetEmail = async () => {}; export const connectAuthEmulator = () => {};
export const initializeFirestore = () => ({}); export const connectFirestoreEmulator = () => {};
export const persistentLocalCache = o => o; export const persistentMultipleTabManager = () => ({});
export const collection = (db, c) => ({c});
export const doc = (a, b, c) => b === undefined ? {c: a.c, id: 'auto' + (++idc) + Math.random().toString(36).slice(2, 6)} : {c: b, id: String(c)};
const snap = r => { const d = DB[r.c]?.[r.id]; return {id: r.id, exists: () => d !== undefined, data: () => d === undefined ? undefined : JSON.parse(JSON.stringify(d), revive)}; };
const revive = (k, v) => v && v.__ts ? now() : v;
export const getDoc = async r => snap(r);
export const getDocs = async q => ({docs: Object.keys(DB[q.c] || {}).map(id => snap({c: q.c, id}))});
export const query = (r, ...q) => ({...r, q: q.filter(Boolean)});
export const where = (f, op, v) => ({f, op, v}); export const orderBy = () => null; export const limit = () => null; export const startAfter = () => null;
const pick = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
export const onSnapshot = (r, cb) => {
  const fire = () => {
    if (r.id) return cb(snap(r));
    const docs = Object.keys(DB[r.c] || {}).filter(id => (r.q || []).every(w => !w.f || pick(DB[r.c][id], w.f) === w.v)).map(id => snap({c: r.c, id}));
    cb({docs});
  };
  subs.add(fire); fire(); return () => subs.delete(fire);
};
export const serverTimestamp = () => ({__sv: 'ts'});
export const arrayUnion = (...x) => ({__au: x}); export const increment = n => ({__inc: n});
const resolve = (cur, v) => v && v.__sv ? now() : v && v.__au ? [...(cur || []), ...v.__au] : v && v.__inc !== undefined ? (cur || 0) + v.__inc : v;
function apply(op){
  const {kind, r, data, merge} = op; DB[r.c] = DB[r.c] || {};
  if (kind === 'delete'){ delete DB[r.c][r.id]; return; }
  const cur = DB[r.c][r.id];
  if (kind === 'update' && cur === undefined) throw new Error(`No document to update: ${r.c}/${r.id}`);
  const out = kind === 'set' && !merge ? {} : {...(cur || {})};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = resolve(cur?.[k], v);
  DB[r.c][r.id] = JSON.parse(JSON.stringify(out));
  window.__mock.writes++;
}
export const setDoc = async (r, d, o) => { apply({kind: 'set', r, data: d, merge: o?.merge}); notify(); };
export const updateDoc = async (r, d) => { apply({kind: 'update', r, data: d}); notify(); };
export const deleteDoc = async r => { apply({kind: 'delete', r}); notify(); };
export const writeBatch = () => { const ops = []; return {
  set: (r, d, o) => ops.push({kind: 'set', r, data: d, merge: o?.merge}), update: (r, d) => ops.push({kind: 'update', r, data: d}),
  delete: r => ops.push({kind: 'delete', r}),
  commit: async () => { const backup = JSON.stringify(DB); try { ops.forEach(apply); } catch (e){ Object.assign(DB, JSON.parse(backup)); throw e; } notify(); }}; };
export const runTransaction = async (db, fn) => {
  txCount++;
  const ops = [];
  const tx = {get: async r => snap(r), set: (r, d, o) => { ops.push({kind: 'set', r, data: d, merge: o?.merge}); return tx; },
    update: (r, d) => { ops.push({kind: 'update', r, data: d}); return tx; }, delete: r => { ops.push({kind: 'delete', r}); return tx; }};
  const res = await fn(tx);
  if (window.__mock.failTxAt && txCount === window.__mock.failTxAt) throw new Error('Simulated network failure (test)');
  const backup = JSON.stringify(DB);
  try { ops.forEach(apply); } catch (e){ for (const k of Object.keys(DB)) delete DB[k]; Object.assign(DB, JSON.parse(backup)); throw e; }
  notify(); return res;
};
