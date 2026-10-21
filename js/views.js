import { MAX_ROWS, ORG_NAME } from './config.js';
import { app, db, doc, serverTimestamp, writeBatch } from './firebase.js';
import { addDays, daysBetween, depr, fyLabel, fyStartYear, g, isNum, qtyOf, sum, toCSV, today, valueOf } from './calc.js';
import { addAudit, applyFilters, byName, chip, download, empById, esc, exceptions, filterBar, fmtDate, fmtTs, holderHtml, holderText, isAdmin, isWriter, locText, money, num, role, S, STATUS_LABEL, STATUSES, subLabel, toast, typeLabel, vendorOf } from './core.js';

/* =====================================================================
   VIEWS
   ===================================================================== */
const NAV = [
  {id:'dashboard', label:'Dashboard', ico:'▦', roles:['admin','manager','viewer']},
  {id:'assets', label:'Assets', ico:'▤', roles:['admin','manager','viewer']},
  {id:'opening', label:'Opening Stock', ico:'⧉', roles:['admin','manager','viewer']},
  {id:'reports', label:'Reports', ico:'▥', roles:['admin','manager','viewer']},
  {id:'masters', label:'Masters', ico:'⚙', roles:['admin']},
  {id:'users', label:'Users', ico:'☺', roles:['admin']},
  {id:'audit', label:'Audit Log', ico:'⎙', roles:['admin']},
  {id:'integrity', label:'Data Integrity', ico:'✔', roles:['admin']},
  {id:'mine', label:'My Assets', ico:'▤', roles:['employee']}
];
function allowedNav(){ return NAV.filter(n => n.roles.includes(role())); }
function currentView(){ const h = location.hash.slice(1); const al = allowedNav(); return (al.find(n => n.id === h) || al[0]).id; }

function bars(entries, fmt, cls = ''){
  if (!entries.length) return '<div class="sub">No data yet.</div>';
  const max = Math.max(...entries.map(e => e[1]), 1);
  return `<div class="bars">${entries.map(([l, v]) => `<div class="row"><span title="${esc(l)}">${esc(l)}</span><div class="track"><div class="fill ${cls}" style="width:${Math.max(2, v / max * 100)}%"></div></div><span>${fmt(v)}</span></div>`).join('')}</div>`;
}

function viewDashboard(){
  const live = S.assets.filter(a => a.status !== 'Disposed');
  if (!S.assets.length) return `<div class="card empty"><h3>No assets yet</h3><p>Start by setting up types and departments in Masters, then record your <a href="#opening">opening stock</a> or add assets from the <a href="#assets">Assets</a> page.</p></div>`;
  const units = sum(live, qtyOf), value = sum(live, valueOf), nbv = sum(live, a => depr(a)?.nbv ?? 0);
  const inService = live.filter(a => ['In Stock','Assigned','Under Repair'].includes(a.status));
  const assigned = sum(live.filter(a => a.status === 'Assigned'), qtyOf), svc = sum(inService, qtyOf);
  const t = today(), soon = addDays(t, 30);
  const overdue = live.filter(a => a.status === 'Assigned' && a.current?.expectedReturn && a.current.expectedReturn < t).length;
  const due = live.filter(a => a.status === 'Assigned' && a.current?.expectedReturn && a.current.expectedReturn >= t && a.current.expectedReturn <= soon).length;
  const repair = live.filter(a => a.status === 'Under Repair').length, exc = exceptions().length;
  const byType = {}; live.forEach(a => byType[typeLabel(a)] = (byType[typeLabel(a)] || 0) + valueOf(a));
  const byDept = {}; live.filter(a => a.status === 'Assigned').forEach(a => { const k = a.current?.department || 'Unassigned'; byDept[k] = (byDept[k] || 0) + qtyOf(a); });
  const byStatus = {}; S.assets.forEach(a => byStatus[a.status] = (byStatus[a.status] || 0) + qtyOf(a));
  const byLoc = {}; live.forEach(a => { const k = a.location || '(No location)'; byLoc[k] = (byLoc[k] || 0) + qtyOf(a); });
  const recent = [...S.assignments].sort((x, y) => (y.createdAt?.seconds || 9e9) - (x.createdAt?.seconds || 9e9)).slice(0, 8);
  return `
  <div class="kpis">
    <div class="kpi navy"><div class="l">Assets in books</div><div class="v">${num(units)}</div><div class="s">${live.length} records · excl. disposed</div></div>
    <div class="kpi gold"><div class="l">Cost value</div><div class="v">${money(value)}</div><div class="s">NBV ${money(nbv)}</div></div>
    <div class="kpi"><div class="l">Utilization</div><div class="v">${svc ? Math.round(assigned / svc * 100) : 0}%</div><div class="s">${num(assigned)} of ${num(svc)} in-service units assigned</div></div>
    <div class="kpi ${overdue ? 'red' : ''}"><div class="l">Overdue returns</div><div class="v">${overdue}</div><div class="s">${due} more due in 30 days</div></div>
    <div class="kpi amber"><div class="l">Under repair</div><div class="v">${repair}</div><div class="s">records</div></div>
    <div class="kpi ${exc ? 'red' : ''}"><div class="l">Exceptions</div><div class="v">${exc}</div><div class="s"><a href="#reports" data-act="goto-report" data-tab="exceptions">Review →</a></div></div>
  </div>
  <div class="grid2">
    <div class="card"><h3>Cost value by type</h3>${bars(Object.entries(byType).sort((a, b) => b[1] - a[1]), money)}</div>
    <div class="card"><h3>Assigned units by department</h3>${bars(Object.entries(byDept).sort((a, b) => b[1] - a[1]), num, 'gold')}</div>
    <div class="card"><h3>Units by location</h3>${bars(Object.entries(byLoc).sort((a, b) => b[1] - a[1]).slice(0, 12), num, 'gold')}
      <div class="sub" style="margin-top:6px"><a href="#reports" data-act="goto-report" data-tab="loc">Location-wise report →</a></div></div>
    <div class="card"><h3>Units by status</h3>${bars(STATUSES.filter(s => byStatus[s]).map(s => [STATUS_LABEL(s), byStatus[s]]), num)}</div>
    <div class="card"><h3>Recent assignments</h3>${recent.length ? `<div class="feed">${recent.map(h => `<div><b>${esc(h.assetId)}</b> ${esc(h.assetName || '')}
      <div class="sub">${esc(h.kind || 'Assign')} → ${esc(h.employeeName || h.department + ' pool')} · ${fmtDate(h.startDate)}${h.endDate ? ' (closed ' + fmtDate(h.endDate) + ')' : ''}</div></div>`).join('')}</div>` : '<div class="sub">No assignments yet.</div>'}</div>
  </div>`;
}

function assetTable(list, {clickable = true} = {}){
  if (!list.length) return '<div class="empty">No assets match.</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th>Asset ID</th><th>Name</th><th>Type › Subtype</th><th>Status</th><th>Holder</th><th>Location</th><th>Purchased</th><th class="num">Qty</th><th class="num">Cost value</th><th></th></tr></thead><tbody>
  ${list.map(a => `<tr class="${clickable ? 'click' : ''}" data-act="open-asset" data-id="${esc(a.assetId)}">
    <td><b>${esc(a.assetId)}</b></td><td>${esc(a.name)}${a.serial ? `<div class="sub">S/N ${esc(a.serial)}</div>` : ''}</td>
    <td>${esc(typeLabel(a))} › ${esc(subLabel(a))}</td><td>${chip(a.status)}</td><td>${holderHtml(a)}</td>
    <td>${esc(a.location || '—')}${a.locationDetail ? `<div class="sub">${esc(a.locationDetail)}</div>` : ''}</td>
    <td>${fmtDate(a.purchaseDate)}</td><td class="num">${qtyOf(a)}</td><td class="num">${isNum(a.cost) ? money(valueOf(a)) : '—'}</td>
    <td>${(!isNum(a.cost) || !a.purchaseDate) && a.status !== 'Disposed' ? '<span class="flag" title="Data Incomplete">⚠</span>' : ''}${a.source === 'Opening' ? ' <span class="chip gold" title="Opening balance">OB</span>' : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function viewAssets(){
  const list = applyFilters(S.assets, S.f).sort((a, b) => a.assetId.localeCompare(b.assetId));
  return `<div class="toolbar">
      ${isWriter() ? '<button class="btn primary" data-act="add-asset">＋ Add asset</button><button class="btn" data-act="import">⬆ Bulk import</button>' : ''}
      <span class="spacer"></span><span class="sub">${list.length} record${list.length === 1 ? '' : 's'} · ${num(sum(list, qtyOf))} units · ${money(sum(list, valueOf))}</span>
      <button class="btn sm" data-act="export-assets">⬇ Export CSV</button></div>
    ${filterBar('f', S.f, {vendor: true})}
    ${assetTable(list.slice(0, MAX_ROWS))}
    ${list.length > MAX_ROWS ? `<div class="sub" style="margin-top:8px">Showing first ${MAX_ROWS} of ${list.length}. Narrow the filters or export to see all.</div>` : ''}`;
}
function exportAssets(){
  const list = applyFilters(S.assets, S.f);
  download(`assets_${today()}.csv`, toCSV(
    ['Asset ID','Name','Description','Type','Subtype','Serial','Make','Vendor','Invoice','Purchase Date','Unit Cost','Qty','Cost Value','Salvage','Life (yrs)','Acc. Depreciation','NBV','Status','Department','Employee ID','Employee','Assigned Date','Expected Return','Location','Position','Warranty Until','Source','Flags'],
    list.map(a => { const d = depr(a), c = a.current || {}; return [a.assetId, a.name, a.description, typeLabel(a), subLabel(a), a.serial, a.make, a.vendor, a.invoice,
      a.purchaseDate, a.cost ?? '', qtyOf(a), isNum(a.cost) ? valueOf(a) : '', a.salvage ?? '', a.life ?? '', d ? d.acc.toFixed(2) : '', d ? d.nbv.toFixed(2) : '',
      STATUS_LABEL(a.status), c.department || '', c.employeeId || '', c.employeeName || '', c.assignedDate || '', c.expectedReturn || '', a.location, a.locationDetail || '', a.warrantyUntil || '', a.source,
      [(!isNum(a.cost) || !a.purchaseDate) && 'Data Incomplete', a.status === 'Assigned' && !c.department && 'Unassigned'].filter(Boolean).join('; ')]; })));
}

/* ---------- Opening stock ---------- */
function viewOpening(){
  const st = S.settings, locked = !!st.openingLocked, editable = isAdmin() && !locked, D = S.draft;
  const rows = [];
  [...S.types].sort(byName).forEach(t => (t.subtypes || []).forEach(s => {
    const key = `${t.id}__${s.code}`, decl = S.opening[key] || {}, dr = D[key] || {};
    const rec = S.assets.filter(a => a.source === 'Opening' && a.typeId === t.id && a.subCode === s.code);
    const dq = dr.qty ?? decl.qty ?? '', dv = dr.value ?? decl.value ?? '';
    const rq = sum(rec, qtyOf), rv = sum(rec, valueOf);
    if (!editable && dq === '' && !rq) return;
    rows.push({t, s, key, dq, dv, rq, rv, vq: (Number(dq) || 0) - rq, vv: (Number(dv) || 0) - rv});
  }));
  const tot = k => sum(rows, r => r[k]);
  const varCount = rows.filter(r => r.vq || Math.abs(r.vv) >= 1).length;
  return `<div class="card">
    <div class="toolbar"><h3 style="margin:0">Opening balance</h3>${locked ? '<span class="chip navy">🔒 Approved & locked</span>' : '<span class="chip amber">Draft</span>'}<span class="spacer"></span>
      <label class="check">Cut-off date <input type="date" data-ok="__cutoff" value="${esc(D.__cutoff ?? st.cutoff ?? '')}" ${editable ? '' : 'disabled'} style="padding:6px 8px;border:1px solid var(--line);border-radius:8px"></label>
      ${editable ? '<button class="btn teal" data-act="save-opening">Save declared totals</button><button class="btn gold" data-act="lock-opening">Approve & lock</button>' : ''}
      ${isAdmin() && locked ? '<button class="btn" data-act="unlock-opening">Unlock</button>' : ''}
      <button class="btn sm" data-act="export-opening">⬇ CSV</button></div>
    ${locked ? `<div class="sub" style="margin-bottom:10px">Locked by ${esc(st.lockedByName || '—')} on ${fmtTs(st.lockedAt)}. New opening-balance records can no longer be added.</div>` : ''}
    <div class="note"><b>How this works:</b> “Declared” is the control total from your books as at the cut-off date. “Recorded” is the sum of individual asset records marked <i>Opening balance</i> (add them via Add asset or Bulk import with source = Opening). Both must match before you lock. ${varCount ? `<b>${varCount} line${varCount === 1 ? '' : 's'} have a variance.</b>` : rows.length ? '<b>All lines reconcile.</b>' : ''}</div>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Type</th><th>Subtype</th><th class="num">Declared qty</th><th class="num">Declared value</th><th class="num">Recorded qty</th><th class="num">Recorded value</th><th class="num">Variance qty</th><th class="num">Variance value</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.t.name)}</td><td>${esc(r.s.name)}</td>
        <td class="num">${editable ? `<input type="number" min="0" data-ok="${r.key}" data-k="qty" value="${esc(r.dq)}" style="width:90px;text-align:right;padding:5px;border:1px solid var(--line);border-radius:6px">` : num(r.dq)}</td>
        <td class="num">${editable ? `<input type="number" min="0" step="0.01" data-ok="${r.key}" data-k="value" value="${esc(r.dv)}" style="width:130px;text-align:right;padding:5px;border:1px solid var(--line);border-radius:6px">` : money(r.dv || 0)}</td>
        <td class="num">${num(r.rq)}</td><td class="num">${money(r.rv)}</td>
        <td class="num" style="color:${r.vq ? 'var(--red)' : 'var(--green)'}">${r.vq ? num(r.vq) : '✓'}</td>
        <td class="num" style="color:${Math.abs(r.vv) >= 1 ? 'var(--red)' : 'var(--green)'}">${Math.abs(r.vv) >= 1 ? money(r.vv) : '✓'}</td></tr>`).join('')}
      <tr class="total"><td colspan="2">Total</td><td class="num">${num(tot('dq'))}</td><td class="num">${money(tot('dv'))}</td><td class="num">${num(tot('rq'))}</td><td class="num">${money(tot('rv'))}</td><td class="num">${num(tot('vq'))}</td><td class="num">${money(tot('vv'))}</td></tr>
      </tbody></table></div>` : '<div class="empty">No opening balance recorded.</div>'}
  </div>`;
}
async function saveOpening(silent = false){
  const b = writeBatch(db), D = S.draft;
  for (const [key, v] of Object.entries(D)){
    if (key === '__cutoff') continue;
    const [typeId, subCode] = key.split('__'), t = S.types.find(x => x.id === typeId), s = t?.subtypes?.find(x => x.code === subCode);
    const before = S.opening[key] || {};
    const data = {typeId, subCode, typeName: t?.name || '', subtype: s?.name || '',
      qty: isNum(v.qty ?? before.qty) ? Number(v.qty ?? before.qty) : 0, value: isNum(v.value ?? before.value) ? Number(v.value ?? before.value) : 0};
    if (data.qty < 0 || data.value < 0) throw new Error('Declared quantities and values cannot be negative.');
    b.set(doc(db, 'openingStock', key), {...data, updatedAt: serverTimestamp(), updatedBy: S.user.uid});
    addAudit(b, 'openingStock', key, 'Update', {qty: before.qty ?? null, value: before.value ?? null}, {qty: data.qty, value: data.value});
  }
  if (D.__cutoff !== undefined && D.__cutoff !== S.settings.cutoff){
    const aRef = addAudit(b, 'settings', 'app', 'Cut-off date', {cutoff: S.settings.cutoff || null}, {cutoff: D.__cutoff});
    b.update(doc(db, 'settings', 'app'), {cutoff: D.__cutoff, lastAuditId: aRef.id});
  }
  await b.commit(); S.draft = {};
  if (!silent) toast('Opening balance saved');
}

/* ---------- Reports ---------- */
const REPORTS = [
  ['stock','Stock summary'],['loc','Location-wise'],['locreg','Location register'],['dept','Department distribution'],['emp','Employee holdings'],['due','Due for return'],
  ['vend','Vendor-wise'],['warr','Warranty expiry'],['depr','Depreciation schedule'],['disp','Disposal log'],['hist','Transfer history'],['exceptions','Exceptions']
];
function fyOptions(){
  const now = fyStartYear(today());
  const years = S.assets.filter(a => a.purchaseDate).map(a => fyStartYear(a.purchaseDate));
  const first = Math.min(now, ...(years.length ? years : [now]));
  const out = []; for (let y = now; y >= first; y--) out.push(y); return out;
}
function buildReport(tab){
  const F = S.rf, t = today();
  const base = applyFilters(S.assets, {...F, status: ''});
  const col = (k, l, type = 'text', total = false) => ({k, l, type, total});
  const eventRange = `<span class="lbl">Event date</span><input type="date" id="rf-hfrom" data-filter="rf.hfrom" value="${esc(F.hfrom || '')}"><span class="lbl">to</span><input type="date" id="rf-hto" data-filter="rf.hto" value="${esc(F.hto || '')}">`;
  const inRange = d => (!F.hfrom || (d || '') >= F.hfrom) && (!F.hto || (d && d <= F.hto));
  switch (tab){
  case 'stock': {
    const g2 = {};
    base.forEach(a => {
      const k = `${a.typeId}|${a.subCode}`, q = qtyOf(a), v = valueOf(a);
      const r = g2[k] = g2[k] || {type: typeLabel(a), sub: subLabel(a), oq:0, ov:0, aq:0, av:0, dq:0, lq:0, cq:0, asq:0, rq:0, avq:0, cv:0, nbv:0};
      if (a.source === 'Opening'){ r.oq += q; r.ov += v; } else { r.aq += q; r.av += v; }
      if (a.status === 'Disposed') r.dq += q;
      else if (a.status === 'Lost') r.lq += q;
      else { r.cq += q; r.cv += v; r.nbv += depr(a)?.nbv ?? 0;
        if (a.status === 'Assigned') r.asq += q; else if (a.status === 'Under Repair') r.rq += q; else r.avq += q; }
    });
    return {title: 'Stock summary by type / subtype', note: 'Current = Opening + Additions − Disposals − Lost. Current, assigned, repair and available are units; values are at cost.',
      filters: {noStatus: true, noDept: true},
      cols: [col('type','Type'), col('sub','Subtype'), col('oq','Opening qty','num',1), col('ov','Opening value','money',1), col('aq','Additions qty','num',1), col('av','Additions value','money',1),
        col('dq','Disposed','num',1), col('lq','Lost','num',1), col('cq','Current qty','num',1), col('asq','Assigned','num',1), col('rq','Under repair','num',1), col('avq','Available','num',1),
        col('cv','Current cost','money',1), col('nbv','Net book value','money',1)],
      rows: Object.values(g2).sort((a, b) => a.type.localeCompare(b.type) || a.sub.localeCompare(b.sub))};
  }
  case 'dept': {
    const g2 = {}, live = base.filter(a => !['Disposed','Lost'].includes(a.status));
    live.forEach(a => {
      const c = a.current || {};
      const k = a.status === 'Assigned' ? (c.department || '⚠ Unassigned (holder unknown)') : a.status === 'Under Repair' ? '— Under repair' : '— Unallocated stock';
      const r = g2[k] = g2[k] || {dept: k, units: 0, emp: 0, pool: 0, recs: 0, value: 0, nbv: 0};
      r.units += qtyOf(a); r.recs++; r.value += valueOf(a); r.nbv += depr(a)?.nbv ?? 0;
      if (a.status === 'Assigned' && c.department){ if (c.employeeId) r.emp += qtyOf(a); else r.pool += qtyOf(a); }
    });
    const rows = Object.values(g2).sort((a, b) => (a.dept.startsWith('—') || a.dept.startsWith('⚠')) - (b.dept.startsWith('—') || b.dept.startsWith('⚠')) || b.units - a.units);
    return {title: 'Assets by department', filters: {noStatus: true}, note: 'Excludes disposed and lost assets.',
      cols: [col('dept','Department'), col('recs','Records','num',1), col('units','Units','num',1), col('emp','With employees','num',1), col('pool','Department pool','num',1), col('value','Cost value','money',1), col('nbv','Net book value','money',1)], rows};
  }
  case 'emp': {
    const rows = base.filter(a => a.status === 'Assigned' && a.current?.employeeId).map(a => { const c = a.current, e = empById(c.employeeId);
      return {eid: c.employeeId, ename: c.employeeName, dept: c.department, id: a.assetId, asset: a.name, ts: `${typeLabel(a)} › ${subLabel(a)}`, serial: a.serial || '',
        qty: qtyOf(a), from: c.assignedDate, ret: c.expectedReturn || '', days: c.assignedDate ? daysBetween(c.assignedDate, t) : '', value: valueOf(a),
        st: e?.active === false ? 'Exited – clearance pending' : ''}; })
      .sort((a, b) => (a.ename || '').localeCompare(b.ename || '') || a.id.localeCompare(b.id));
    return {title: 'Assets currently with each employee', filters: {noStatus: true}, clickKey: 'id',
      cols: [col('eid','Emp ID'), col('ename','Employee'), col('dept','Department'), col('id','Asset ID'), col('asset','Asset'), col('ts','Type › Subtype'), col('serial','Serial'),
        col('qty','Qty','num',1), col('from','Since','date'), col('ret','Expected return','date'), col('days','Days held','num'), col('value','Cost value','money',1), col('st','Flag','flag')], rows};
  }
  case 'due': {
    const days = Number(F.days) || 30, lim = addDays(t, days);
    const rows = base.filter(a => a.status === 'Assigned' && a.current?.expectedReturn && a.current.expectedReturn <= lim).map(a => { const c = a.current, dd = daysBetween(t, c.expectedReturn);
      return {id: a.assetId, asset: a.name, holder: c.employeeName || `${c.department} pool`, eid: c.employeeId || '', dept: c.department, from: c.assignedDate, ret: c.expectedReturn,
        dd, st: dd < 0 ? `Overdue ${-dd}d` : dd === 0 ? 'Due today' : `Due in ${dd}d`}; }).sort((a, b) => a.ret.localeCompare(b.ret));
    return {title: `Assets due for return (next ${days} days, incl. overdue)`, filters: {noStatus: true, extra: `<span class="lbl">Window</span><select id="rf-days" data-filter="rf.days">${[7,15,30,60,90].map(d => `<option value="${d}" ${String(days) === String(d) ? 'selected' : ''}>${d} days</option>`).join('')}</select>`},
      clickKey: 'id', cols: [col('id','Asset ID'), col('asset','Asset'), col('holder','Holder'), col('eid','Emp ID'), col('dept','Department'), col('from','Assigned','date'), col('ret','Expected return','date'), col('st','Status','due')], rows};
  }
  case 'vend': {
    const g2 = {}, NO = '(No vendor)', t0 = today();
    base.forEach(a => {
      const k = a.vendor || NO, vd = vendorOf(a);
      const r = g2[k] = g2[k] || {v: k, contact: vd ? [vd.contactPerson, vd.phone].filter(Boolean).join(' · ') : '', gst: vd?.gstin || '', recs: 0, units: 0, inv: new Set(), value: 0, live: 0, warr: 0, last: ''};
      r.recs++; r.units += qtyOf(a); r.value += valueOf(a); if (a.invoice) r.inv.add(a.invoice);
      if (a.status !== 'Disposed') r.live += qtyOf(a);
      if (a.status !== 'Disposed' && a.warrantyUntil && a.warrantyUntil >= t0) r.warr += qtyOf(a);
      if ((a.purchaseDate || '') > r.last) r.last = a.purchaseDate;
    });
    const rows = Object.values(g2).map(r => ({...r, inv: r.inv.size})).sort((a, b) => (a.v === NO) - (b.v === NO) || b.value - a.value);
    return {title: 'Purchases by vendor', filters: {noStatus: true, vendor: true},
      note: 'Includes disposed assets in purchase totals. Use the purchase-date filter for a period (e.g. this financial year).',
      cols: [col('v','Vendor'), col('contact','Contact'), col('gst','GSTIN'), col('inv','Invoices','num',1), col('recs','Records','num',1), col('units','Units bought','num',1),
        col('value','Purchase value','money',1), col('live','Units in use / stock','num',1), col('warr','Units in warranty','num',1), col('last','Last purchase','date')], rows};
  }
  case 'warr': {
    const days = Number(F.days) || 30, t0 = today(), lim = addDays(t0, days);
    const rows = base.filter(a => a.status !== 'Disposed' && a.warrantyUntil && a.warrantyUntil <= lim).map(a => { const dd = daysBetween(t0, a.warrantyUntil), vd = vendorOf(a);
      return {id: a.assetId, asset: a.name, serial: a.serial || '', vendor: a.vendor || '', contact: vd ? [vd.contactPerson, vd.phone].filter(Boolean).join(' · ') : '',
        loc: locText(a), until: a.warrantyUntil, st: dd < 0 ? `Expired ${-dd}d ago` : dd === 0 ? 'Ends today' : `Ends in ${dd}d`}; })
      .sort((a, b) => a.until.localeCompare(b.until));
    return {title: `Warranty expiring in the next ${days} days (incl. already expired)`, clickKey: 'id',
      filters: {noStatus: true, vendor: true, extra: `<span class="lbl">Window</span><select id="rf-days" data-filter="rf.days">${[30,60,90,180,365].map(d => `<option value="${d}" ${String(days) === String(d) ? 'selected' : ''}>${d} days</option>`).join('')}</select>`},
      note: 'Use this to raise warranty claims or plan AMC renewals before cover ends.',
      cols: [col('id','Asset ID'), col('asset','Asset'), col('serial','Serial'), col('vendor','Vendor'), col('contact','Vendor contact'), col('loc','Location'), col('until','Warranty until','date'), col('st','Status','due')], rows};
  }
  case 'depr': {
    const fy = Number(F.fy) || fyStartYear(t), fs = `${fy}-04-01`, fe = `${fy + 1}-03-31`, prev = addDays(fs, -1), asAt = fe < t ? fe : t;
    const rows = [];
    base.forEach(a => {
      if (!a.purchaseDate || !isNum(a.cost) || a.purchaseDate > fe) return;
      if (a.status === 'Disposed' && a.disposal?.date && a.disposal.date < fs) return;
      const open = depr(a, prev), close = depr(a, asAt);
      rows.push({id: a.assetId, asset: a.name, ts: `${typeLabel(a)} › ${subLabel(a)}`, pd: a.purchaseDate, value: close.value, life: a.life || 0,
        openNbv: a.purchaseDate > prev ? 0 : open.nbv, adds: a.purchaseDate >= fs ? close.value : 0, charge: close.acc - (a.purchaseDate > prev ? 0 : open.acc),
        acc: close.acc, nbv: a.status === 'Disposed' && a.disposal?.date <= asAt ? 0 : close.nbv, st: a.status === 'Disposed' ? 'Disposed ' + fmtDate(a.disposal?.date) : ''});
    });
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const excl = base.filter(a => a.status !== 'Disposed' && (!a.purchaseDate || !isNum(a.cost))).length;
    return {title: `Depreciation schedule — ${fyLabel(fy)} (straight-line, monthly; as at ${fmtDate(asAt)})`, clickKey: 'id',
      note: `${excl ? `${excl} asset record(s) excluded as Data Incomplete. ` : ''}Indian financial year (April–March). Disposed assets show nil closing NBV.`,
      filters: {extra: `<span class="lbl">Year</span><select id="rf-fy" data-filter="rf.fy">${fyOptions().map(y => `<option value="${y}" ${fy === y ? 'selected' : ''}>${fyLabel(y)}</option>`).join('')}</select>`},
      cols: [col('id','Asset ID'), col('asset','Asset'), col('ts','Type › Subtype'), col('pd','Purchased','date'), col('value','Cost','money',1), col('life','Life (yrs)','num'),
        col('openNbv','Opening NBV','money',1), col('adds','Additions','money',1), col('charge','Charge for year','money',1), col('acc','Accumulated','money',1), col('nbv','Closing NBV','money',1), col('st','Note')], rows};
  }
  case 'disp': {
    const rows = applyFilters(S.assets, {...F, status: ''}).filter(a => a.status === 'Disposed' && inRange(a.disposal?.date)).map(a => { const d = a.disposal || {};
      return {date: d.date, id: a.assetId, asset: a.name, ts: `${typeLabel(a)} › ${subLabel(a)}`, cost: valueOf(a), nbv: d.nbvAtDisposal ?? '', value: d.value || 0,
        gl: isNum(d.nbvAtDisposal) ? (d.value || 0) - d.nbvAtDisposal : '', reason: d.reason, method: d.method, by: d.approvedBy}; })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return {title: 'Disposal log', clickKey: 'id', filters: {noStatus: true, noDept: true, extra: eventRange},
      cols: [col('date','Disposal date','date'), col('id','Asset ID'), col('asset','Asset'), col('ts','Type › Subtype'), col('cost','Cost','money',1), col('nbv','NBV at disposal','money',1),
        col('value','Recovery','money',1), col('gl','Gain / (loss)','money',1), col('reason','Reason'), col('method','Method'), col('by','Approved by')], rows};
  }
  case 'hist': {
    const q = (F.q || '').toLowerCase();
    const assetIds = new Set(applyFilters(S.assets, {...F, q: '', dept: '', status: ''}).map(a => a.assetId));
    const rows = S.assignments.filter(h => assetIds.has(h.assetId) && inRange(h.startDate) && (!F.dept || h.department === F.dept)
        && (!q || [h.assetId, h.assetName, h.employeeName, h.employeeId].join(' ').toLowerCase().includes(q)))
      .map(h => ({date: h.startDate, id: h.assetId, asset: h.assetName, kind: h.kind || 'Assign', from: h.fromHolder || '', to: h.employeeName ? `${h.employeeName} (${h.employeeId})` : `${h.department} pool`,
        dept: h.department, end: h.endDate || '', reason: h.closeReason || (h.endDate ? '' : 'Current'), cond: `${h.conditionOut || '—'}${h.conditionIn ? ' → ' + h.conditionIn : ''}`, by: h.issuedByName}))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return {title: 'Assignment & transfer history', clickKey: 'id', filters: {noStatus: true, extra: eventRange},
      cols: [col('date','Start','date'), col('id','Asset ID'), col('asset','Asset'), col('kind','Type'), col('from','From'), col('to','To'), col('dept','Department'),
        col('end','End','date'), col('reason','Closed by'), col('cond','Condition out → in'), col('by','Issued by')], rows};
  }
  case 'loc': {
    const g2 = {}, NO = '(No location)';
    base.filter(a => !['Disposed','Lost'].includes(a.status)).forEach(a => {
      const L = a.location || NO, k = `${L}|${a.typeId}|${a.subCode}`, q = qtyOf(a);
      const r = g2[k] = g2[k] || {loc: L, type: typeLabel(a), sub: subLabel(a), recs: 0, units: 0, stock: 0, asg: 0, rep: 0, value: 0, nbv: 0};
      r.recs++; r.units += q; r.value += valueOf(a); r.nbv += depr(a)?.nbv ?? 0;
      if (a.status === 'Assigned') r.asg += q; else if (a.status === 'Under Repair') r.rep += q; else r.stock += q;
    });
    const rows = Object.values(g2).sort((a, b) => (a.loc === NO) - (b.loc === NO) || a.loc.localeCompare(b.loc) || a.type.localeCompare(b.type) || a.sub.localeCompare(b.sub));
    return {title: 'Assets by location', filters: {noStatus: true},
      note: 'Excludes disposed and lost assets. For the unit-by-unit list with serial numbers and positions, use the Location register tab.',
      cols: [col('loc','Location'), col('type','Type'), col('sub','Subtype'), col('recs','Records','num',1), col('units','Units','num',1), col('stock','In stock','num',1),
        col('asg','In use / assigned','num',1), col('rep','Under repair','num',1), col('value','Cost value','money',1), col('nbv','Net book value','money',1)], rows};
  }
  case 'locreg': {
    const rows = base.filter(a => a.status !== 'Disposed').map(a => ({loc: a.location || '(No location)', pos: a.locationDetail || '', id: a.assetId, asset: a.name,
        ts: `${typeLabel(a)} › ${subLabel(a)}`, serial: a.serial || '', qty: qtyOf(a), st: STATUS_LABEL(a.status), holder: holderText(a)}))
      .sort((a, b) => a.loc.localeCompare(b.loc) || a.pos.localeCompare(b.pos) || a.id.localeCompare(b.id));
    return {title: 'Location register — every asset with its serial and position', clickKey: 'id', filters: {noStatus: true},
      note: 'Excludes disposed assets. Tip: pick one location and one subtype (e.g. CCTV Camera) to get a physical-verification checklist, then Print / PDF.',
      cols: [col('loc','Location'), col('pos','Position'), col('id','Asset ID'), col('asset','Asset'), col('ts','Type › Subtype'), col('serial','Serial'),
        col('qty','Qty','num',1), col('st','Status'), col('holder','Holder')], rows};
  }
  case 'exceptions': {
    const ids = new Set(base.map(a => a.assetId));
    const rows = exceptions().filter(x => ids.has(x.a.assetId)).map(x => ({issue: x.issue, id: x.a.assetId, asset: x.a.name, ts: `${typeLabel(x.a)} › ${subLabel(x.a)}`, st: STATUS_LABEL(x.a.status), detail: x.detail}))
      .sort((a, b) => a.issue.localeCompare(b.issue) || a.id.localeCompare(b.id));
    return {title: 'Exceptions & data quality', clickKey: 'id', filters: {noStatus: true}, note: 'Resolve by editing the asset (missing data), assigning it (Unassigned), returning it (overdue / exited employee), or marking found / disposing (lost).',
      cols: [col('issue','Issue','flag'), col('id','Asset ID'), col('asset','Asset'), col('ts','Type › Subtype'), col('st','Status'), col('detail','Detail','wrap')], rows};
  }}
}
function cellHtml(c, v){
  switch (c.type){
    case 'money': return v === '' || v == null ? '—' : money(v);
    case 'num': return v === '' || v == null ? '—' : num(v);
    case 'date': return fmtDate(v);
    case 'flag': return v ? `<span class="chip ${/Data|Unassigned/.test(v) ? 'amber' : 'red'}">${esc(v)}</span>` : '';
    case 'due': return `<span class="chip ${/Overdue|Expired/.test(v) ? 'red' : 'amber'}">${esc(v)}</span>`;
    default: return esc(v);
  }
}
function viewReports(){
  const R = buildReport(S.rt); S.lastReport = R;
  const totals = R.cols.some(c => c.total) && R.rows.length;
  return `<div class="tabs">${REPORTS.map(([k, l]) => `<button class="${S.rt === k ? 'active' : ''}" data-act="report-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    ${filterBar('rf', S.rf, R.filters)}
    <div class="card">
      <div class="print-title">${esc(ORG_NAME)} — ${esc(R.title)}<div class="sub">Generated ${new Date().toLocaleString('en-GB')} by ${esc(S.profile.name)}</div></div>
      <div class="toolbar"><h3 style="margin:0">${esc(R.title)}</h3><span class="spacer"></span><span class="sub">${R.rows.length} row${R.rows.length === 1 ? '' : 's'}</span>
        <button class="btn sm" data-act="export-report">⬇ Excel (CSV)</button><button class="btn sm" data-act="print-report">⎙ Print / PDF</button></div>
      ${R.note ? `<div class="sub" style="margin-bottom:10px">${esc(R.note)}</div>` : ''}
      ${R.rows.length ? `<div class="tbl-wrap"><table><thead><tr>${R.cols.map(c => `<th class="${['money','num'].includes(c.type) ? 'num' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>
        ${R.rows.map(r => `<tr ${R.clickKey ? `class="click" data-act="open-asset" data-id="${esc(r[R.clickKey])}"` : ''}>${R.cols.map(c => `<td class="${['money','num'].includes(c.type) ? 'num' : ''}${c.type === 'wrap' ? ' wrap' : ''}">${cellHtml(c, r[c.k])}</td>`).join('')}</tr>`).join('')}
        ${totals ? `<tr class="total">${R.cols.map((c, i) => `<td class="${['money','num'].includes(c.type) ? 'num' : ''}">${c.total ? cellHtml(c, sum(R.rows, r => r[c.k])) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr>` : ''}
      </tbody></table></div>` : '<div class="empty">Nothing to report for these filters.</div>'}
    </div>`;
}
function exportReport(){
  const R = S.lastReport; if (!R) return;
  const rows = R.rows.map(r => R.cols.map(c => { const v = r[c.k]; return c.type === 'money' && isNum(v) ? Number(v).toFixed(2) : v ?? ''; }));
  if (R.cols.some(c => c.total) && R.rows.length) rows.push(R.cols.map((c, i) => c.total ? (c.type === 'money' ? sum(R.rows, r => r[c.k]).toFixed(2) : sum(R.rows, r => r[c.k])) : i === 0 ? 'Total' : ''));
  download(`${R.title.split(' —')[0].replace(/[^\w]+/g, '_')}_${today()}.csv`, toCSV(R.cols.map(c => c.l), rows));
}

export { NAV, allowedNav, currentView, bars, viewDashboard, assetTable, viewAssets, exportAssets, viewOpening, saveOpening, REPORTS, fyOptions, buildReport, cellHtml, viewReports, exportReport };
