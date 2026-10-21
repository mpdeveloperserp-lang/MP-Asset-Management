import { app, collection, db, doc, getDoc, getDocs, runTransaction, writeBatch } from './firebase.js';
import { serialKeyOf, today } from './calc.js';
import { addAudit, auditEntry, chip, download, errMsg, esc, fmtDate, num, S, toast, updateAsset } from './core.js';

/* =====================================================================
   DATA INTEGRITY & MIGRATION (admin only)
   The scan is read-only. Every fix is explicit, audited, idempotent and never
   deletes or renumbers anything:
     • Serial index  — registers serial numbers of records created before Phase 1
                       in serials/{key}, so future duplicates are blocked.
     • Counters      — moves an ID counter forward if it is behind the highest
                       existing asset ID (prevents ID collisions).
     • Orphan periods — closes assignment periods that the asset no longer points to.
   ===================================================================== */

const rerender = () => window.dispatchEvent(new Event('app:render'));
let busyMsg = '';

async function scanIntegrity(){
  const assets = S.assets, byId = new Map(assets.map(a => [a.assetId, a]));
  // 1. serial numbers
  const byKey = new Map();
  assets.forEach(a => { const k = serialKeyOf(a.serial); if (k){ if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(a); } });
  const dupSerials = [...byKey.values()].filter(l => l.length > 1).map(l => ({serial: l[0].serial, ids: l.map(a => a.assetId)}));
  const dupIds = new Set(dupSerials.flatMap(d => d.ids));
  const needIndex = assets.filter(a => serialKeyOf(a.serial) && a.serialKey !== serialKeyOf(a.serial) && !dupIds.has(a.assetId));
  // 2. ID counters
  const maxBy = {};
  assets.forEach(a => { const m = String(a.assetId).match(/^([A-Z0-9]{2,5}-[A-Z0-9]{2,5})-(\d+)$/); if (m) maxBy[m[1]] = Math.max(maxBy[m[1]] || 0, Number(m[2])); });
  const counters = await Promise.all(Object.keys(maxBy).sort().map(async key => {
    const snap = await getDoc(doc(db, 'counters', key));
    return {key, next: snap.exists() ? snap.data().next : null, max: maxBy[key]};
  }));
  const behind = counters.filter(c => c.next === null || c.next <= c.max);
  // 3. assignment consistency
  const open = S.assignments.filter(h => !h.endDate);
  const orphans = open.filter(h => byId.get(h.assetId)?.current?.assignmentId !== h.id);
  const broken = assets.filter(a => a.status === 'Assigned' && a.current?.assignmentId
    && !S.assignments.some(h => h.id === a.current.assignmentId && !h.endDate));
  const legacy = assets.filter(a => a.rev === undefined).length;
  S.integrity = {at: new Date(), dupSerials, needIndex, behind, counters, orphans, broken, legacy, total: assets.length};
  rerender();
}

async function fixSerials(){
  const list = S.integrity?.needIndex || [];
  if (!list.length) return;
  if (!confirm(`Register ${list.length} serial number(s) in the serial index? Each asset gets an audited “Integrity: serial index” entry. No other data changes.`)) return;
  let ok = 0; const failed = [];
  for (const a of list){
    busyMsg = `Indexing ${ok + failed.length + 1} / ${list.length}…`; rerender();
    const fresh = S.assets.find(x => x.assetId === a.assetId) || a;
    try { await updateAsset(fresh, {}, 'Integrity: serial index', 'Serial number registered in the uniqueness index', null, {serial: {serial: fresh.serial}}); ok++; }
    catch (e){ failed.push(`${a.assetId}: ${errMsg(e)}`); }
  }
  busyMsg = '';
  toast(`Serial index: ${ok} registered${failed.length ? `, ${failed.length} failed` : ''}.`, failed.length ? 'err' : 'ok');
  if (failed.length) console.warn(failed);
  S.integrityLog = failed;
  await scanIntegrity();
}

async function fixCounters(){
  const list = S.integrity?.behind || [];
  if (!list.length) return;
  if (!confirm(`Move ${list.length} ID counter(s) forward past the highest existing asset ID? Existing IDs are not changed.`)) return;
  const done = [];
  try {
    for (const c of list){
      const ref = doc(db, 'counters', c.key);
      const res = await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const cur = snap.exists() ? snap.data().next : 0, want = c.max + 1;
        if (cur >= want) return null;
        tx.set(ref, {next: want});
        return {key: c.key, from: cur || null, to: want};
      });
      if (res) done.push(res);
    }
    if (done.length){
      const b = writeBatch(db);
      addAudit(b, 'integrity', done.map(d => d.key), 'Integrity: counters advanced', Object.fromEntries(done.map(d => [d.key, d.from])), Object.fromEntries(done.map(d => [d.key, d.to])));
      await b.commit();
    }
    toast(`${done.length} counter(s) advanced.`);
  } catch (e){ toast(errMsg(e), 'err'); }
  await scanIntegrity();
}

async function closeOrphan(id){
  const h = S.assignments.find(x => x.id === id); if (!h) return;
  if (!confirm(`Close the open period ${h.assetId} → ${h.employeeName || h.department} (started ${fmtDate(h.startDate)})? The asset no longer points to it.`)) return;
  try {
    await runTransaction(db, async tx => {
      const aSnap = await tx.get(doc(db, 'assets', h.assetId));
      const hSnap = await tx.get(doc(db, 'assignments', id));
      if (!hSnap.exists() || hSnap.data().endDate) throw new Error('This period is already closed.');
      if (aSnap.exists() && aSnap.data().current?.assignmentId === id) throw new Error('The asset still points to this period — it is not an orphan.');
      const au = auditEntry('assignment', id, 'Integrity: orphan period closed', {endDate: null}, {endDate: today()}, {assetId: h.assetId});
      tx.set(au.ref, au.data);
      tx.update(doc(db, 'assignments', id), {endDate: today(), closeReason: 'Integrity fix — orphan period', closedBy: S.user.uid, closedByName: S.profile.name});
    });
    toast('Orphan period closed.');
  } catch (e){ toast(errMsg(e), 'err'); }
  await scanIntegrity();
}

/* Full data export (admin): every collection as JSON — an authorised point-in-time copy.
   Not a substitute for managed backups (see docs/04-backup-and-recovery.md). */
const EXPORT_COLLECTIONS = ['users', 'types', 'departments', 'locations', 'vendors', 'employees', 'openingStock', 'counters', 'serials', 'assets', 'assignments', 'audit'];
async function exportAll(){
  if (!confirm('Download a full JSON export of all collections? The file contains personal data (users, employees) — store it securely.')) return;
  busyMsg = 'Exporting…'; rerender();
  try {
    const out = {meta: {app: 'MP Asset Management', exportedAt: new Date().toISOString(), exportedBy: S.profile.name, exportedByUid: S.user.uid, counts: {}}, data: {}};
    const settings = await getDoc(doc(db, 'settings', 'app'));
    out.data.settings = {app: settings.exists() ? settings.data() : null};
    for (const c of EXPORT_COLLECTIONS){
      const snap = await getDocs(collection(db, c));
      out.data[c] = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
      out.meta.counts[c] = snap.docs.length;
    }
    const json = JSON.stringify(out, (k, v) => v && typeof v === 'object' && typeof v.toDate === 'function' ? {__timestamp: v.toDate().toISOString()} : v, 1);
    const b = writeBatch(db);
    addAudit(b, 'integrity', 'export', 'Full data export', null, out.meta.counts);
    await b.commit();
    download(`mp-assets-export-${today()}.json`, json, 'application/json');
    toast('Export downloaded');
  } catch (e){ toast(errMsg(e), 'err'); }
  busyMsg = ''; rerender();
}

function viewIntegrity(){
  const r = S.integrity;
  const sec = (title, n, body, ok = 'None found ✓') => `<div class="card"><h3>${title} ${n ? `<span class="chip ${n ? 'amber' : 'green'}">${n}</span>` : '<span class="chip green">OK</span>'}</h3>${n ? body : `<div class="sub">${ok}</div>`}</div>`;
  if (!r) return `<div class="card"><h3>Data integrity check</h3>
    <p class="sub">Checks existing records for duplicate serial numbers, serial numbers not yet in the uniqueness index, ID counters that could re-issue an existing ID, and inconsistent assignment periods. The scan does not change anything.</p>
    <button class="btn primary" data-act="integrity-scan">Run check</button></div>${exportCard()}`;
  return `<div class="toolbar"><span class="sub">Scanned ${r.total} assets at ${r.at.toLocaleTimeString('en-GB')}${r.legacy ? ` · ${r.legacy} created before Phase 1 (that is fine)` : ''}</span><span class="spacer"></span>
      ${busyMsg ? `<span class="chip amber">${esc(busyMsg)}</span>` : ''}<button class="btn" data-act="integrity-scan">Re-run check</button></div>
    ${sec('Duplicate serial numbers', r.dupSerials.length, `<div class="note">These must be corrected by hand (edit the wrong asset's serial number). They are excluded from the index until fixed.</div>
      <div class="tbl-wrap"><table><thead><tr><th>Serial</th><th>Assets</th></tr></thead><tbody>${r.dupSerials.map(d => `<tr><td>${esc(d.serial)}</td><td>${d.ids.map(i => `<button class="linkbtn" data-act="open-asset" data-id="${esc(i)}">${esc(i)}</button>`).join(', ')}</td></tr>`).join('')}</tbody></table></div>`)}
    ${sec('Serial numbers not yet in the uniqueness index', r.needIndex.length, `<p class="sub">Records created before Phase 1. Until indexed, a new asset could reuse one of these serials.</p>
      <button class="btn teal" data-act="fix-serials" ${busyMsg ? 'disabled' : ''}>Register ${r.needIndex.length} serial number(s)</button>
      ${(S.integrityLog || []).length ? `<div class="err">${S.integrityLog.slice(0, 20).map(esc).join('<br>')}</div>` : ''}`)}
    ${sec('ID counters behind existing assets', r.behind.length, `<p class="sub">The next ID would collide with an existing asset. Saving would fail safely, but new assets of this subtype cannot be added until fixed.</p>
      <div class="tbl-wrap" style="margin-bottom:10px"><table><thead><tr><th>Counter</th><th class="num">Next</th><th class="num">Highest existing</th></tr></thead><tbody>${r.behind.map(c => `<tr><td>${esc(c.key)}</td><td class="num">${c.next ?? '—'}</td><td class="num">${c.max}</td></tr>`).join('')}</tbody></table></div>
      <button class="btn teal" data-act="fix-counters">Advance ${r.behind.length} counter(s)</button>`)}
    ${sec('Open assignment periods the asset no longer points to', r.orphans.length, `<div class="tbl-wrap"><table><thead><tr><th>Asset</th><th>Holder</th><th>Since</th><th></th></tr></thead><tbody>${r.orphans.map(h => `<tr><td>${esc(h.assetId)}</td><td>${esc(h.employeeName || h.department + ' pool')}</td><td>${fmtDate(h.startDate)}</td><td><button class="btn sm" data-act="fix-orphan" data-id="${esc(h.id)}">Close period</button></td></tr>`).join('')}</tbody></table></div>`)}
    ${sec('Assigned assets whose current period is missing or closed', r.broken.length, `<p class="sub">Open each asset and record a Return or a new Assignment to repair the history.</p>
      ${r.broken.map(a => `<button class="linkbtn" data-act="open-asset" data-id="${esc(a.assetId)}">${esc(a.assetId)}</button>`).join(', ')}`)}
    ${exportCard()}`;
}

const exportCard = () => `<div class="card"><h3>Full data export</h3><p class="sub">Downloads every collection (including the audit log) as one JSON file — an authorised point-in-time copy for safekeeping or migration. CSV report exports are <b>not</b> backups. See docs/04-backup-and-recovery.md for the full backup strategy.</p>
  <button class="btn" data-act="export-all" ${busyMsg ? 'disabled' : ''}>⬇ Download full export (JSON)</button></div>`;
const INTEGRITY_ACT = {
  'export-all': () => exportAll(),
  'integrity-scan': async () => { try { await scanIntegrity(); } catch (e){ toast(errMsg(e), 'err'); } },
  'fix-serials': () => fixSerials(),
  'fix-counters': () => fixCounters(),
  'fix-orphan': d => closeOrphan(d.id)
};

export { viewIntegrity, scanIntegrity, exportAll, INTEGRITY_ACT };
