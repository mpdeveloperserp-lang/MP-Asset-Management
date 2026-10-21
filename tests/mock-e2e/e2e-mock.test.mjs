// UI workflow tests against an in-browser Firebase mock (no network, no emulator needed).
// Run:  cd tests && npm install && npm run test:mock
// Covers client behaviour: atomic multi-unit creation, serial index, audit links, rev concurrency,
// transfer/return history, partial-failure reporting, Excel import exact-match, manager scope in the UI,
// data-integrity migration, CSV formula-injection guard, CSP compliance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MOCK = fs.readFileSync(path.join(HERE, 'firebase-mock.js'), 'utf8');
const EXCELJS_DIST = fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'), 'utf8');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'am-e2e-'));
let server, base, browser;

const TYPES = {t1: {name: 'Electronics', code: 'ELE', active: true, subtypes: [
  {name: 'CCTV Camera', code: 'CAM', life: 5, active: true}, {name: 'Laptop', code: 'LAP', life: 3, active: true}]},
  t2: {name: 'Furniture', code: 'FUR', active: true, subtypes: [{name: 'Chair', code: 'CHR', life: 10, active: true}]}};
const baseDb = () => ({
  users: {u1: {name: 'Sara', email: 'sara@test', role: 'admin', active: true},
          u2: {name: 'Mani', email: 'mani@test', role: 'manager', department: 'Sales', managedDepartments: ['Sales'], managedLocations: ['Site - Tower A'], active: true},
          u3: {name: 'Vik', email: 'vik@test', role: 'viewer', active: true},
          u4: {name: 'Priya', email: 'priya@test', role: 'employee', empId: 'E1023', active: true}},
  settings: {app: {currency: '₹', cutoff: '2026-03-31', openingLocked: false}},
  types: TYPES,
  departments: {d1: {name: 'Admin', active: true}, d2: {name: 'Sales', active: true}, d3: {name: 'Finance', active: true}},
  locations: {l1: {name: 'Head Office', active: true}, l2: {name: 'Site - Tower A', active: true}, l3: {name: 'Site - Tower B', active: true}},
  vendors: {v1: {name: 'SecureTech Systems', active: true}},
  employees: {E1023: {empId: 'E1023', name: 'Priya Raman', department: 'Sales', active: true},
              E2001: {empId: 'E2001', name: 'Arun K', department: 'Finance', active: true}}
});

async function open(as = 'u1', db = baseDb(), opts = {}){
  const ctx = await browser.newContext({acceptDownloads: true, viewport: {width: 1300, height: 900}});
  await ctx.addInitScript(s => { window.__SEED = s; }, {db, as, failTxAt: opts.failTxAt || 0});
  const page = await ctx.newPage();
  page.errors = []; page.csp = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) page.csp.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({contentType: 'application/javascript', body: MOCK}));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs/, r => r.fulfill({contentType: 'application/javascript', body: EXCELJS_DIST}));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({body: '', contentType: 'text/css'}));
  await page.goto(`${base}/index.html?as=${as}#${opts.hash || 'assets'}`);
  await page.waitForSelector('#app:not([hidden])');
  page.db = () => page.evaluate(() => window.__DB);
  return page;
}
const close = p => p.context().close();
async function addCameras(page, lines){
  await page.click('[data-act=add-asset]');
  await page.selectOption('#fm [name=subCode]', 'CAM');
  await page.fill('#fm [name=name]', 'Hikvision 2MP Dome Camera');
  await page.fill('#fm [name=cost]', '3200'); await page.fill('#fm [name=purchaseDate]', '2026-10-10');
  await page.selectOption('#fm [name=location]', 'Head Office');
  await page.fill('#fm [name=count]', '2');
  await page.click('#pasteBtn'); await page.fill('#pasteTxt', lines.join('\n')); await page.click('#pasteGo');
  await page.click('#go');
}

before(async () => {
  server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ res.writeHead(404); return res.end(); }
    const type = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css'}[path.extname(p)] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type': type}); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
});
after(async () => { await browser?.close(); server?.close(); });

test('55 cameras: unique IDs, serial index, audit-linked, atomic chunks', async () => {
  const p = await open();
  const L = ['Head Office', 'Site - Tower A', 'Site - Tower B'];
  await addCameras(p, Array.from({length: 55}, (_, i) => `HKV-${1000 + i}\t${L[i % 3]}\tPole ${i + 1}`));
  await p.waitForFunction(() => Object.keys(window.__DB.assets).length === 55, null, {timeout: 20000});
  const db = await p.db();
  const assets = Object.values(db.assets);
  assert.equal(new Set(assets.map(a => a.assetId)).size, 55);
  assert.equal(new Set(assets.map(a => a.serial)).size, 55);
  assert.equal(Object.keys(db.serials).length, 55, 'serial index has one entry per camera');
  for (const a of assets){
    assert.equal(a.rev, 0);
    assert.equal(db.serials[a.serialKey].assetId, a.assetId);
    const au = db.audit[a.lastAuditId];
    assert.ok(au && au.entityIds.includes(a.assetId), `${a.assetId} is linked to an audit entry that covers it`);
  }
  assert.equal(Object.keys(db.audit).length, Math.ceil(55 / 6), 'one audit entry per atomic chunk of 6');
  assert.equal(db.counters['ELE-CAM'].next, 56);
  assert.deepEqual(p.errors, []); assert.deepEqual(p.csp, [], 'no Content-Security-Policy violations');
  await close(p);
});

test('duplicate serial is rejected (form and grid)', async () => {
  const db = baseDb();
  db.assets = {'ELE-CAM-0001': {assetId: 'ELE-CAM-0001', name: 'Cam', typeId: 't1', subCode: 'CAM', qty: 1, status: 'In Stock', source: 'Purchase', serial: 'HKV-1000', serialKey: 'hkv-1000', rev: 0, current: {}, location: 'Head Office'}};
  db.serials = {'hkv-1000': {assetId: 'ELE-CAM-0001'}};
  const p = await open('u1', db);
  await addCameras(p, ['hkv-1000\tHead Office\tGate', 'HKV-2000\tHead Office\tLobby']);
  await p.waitForSelector('#fe:not([hidden])');
  assert.match(await p.textContent('#fe'), /already used by ELE-CAM-0001/);
  assert.equal(Object.keys((await p.db()).assets).length, 1, 'nothing saved');
  await close(p);
});

test('transfer closes the previous period and opens a new one; return closes it; rev increments', async () => {
  const p = await open();
  await addCameras(p, ['S-1\tHead Office\tA', 'S-2\tHead Office\tB']);
  await p.waitForFunction(() => Object.keys(window.__DB.assets).length === 2);
  const open1 = async () => { await p.click('tr.click[data-id="ELE-CAM-0001"]'); };
  await open1(); await p.click('[data-aact=assign]');
  await p.selectOption('#fm [name=department]', 'Sales'); await p.selectOption('#fm [name=employeeId]', 'E1023'); await p.click('#go');
  await p.waitForFunction(() => window.__DB.assets['ELE-CAM-0001'].status === 'Assigned');
  await open1(); await p.click('[data-aact=assign]');
  await p.selectOption('#fm [name=department]', 'Finance'); await p.selectOption('#fm [name=employeeId]', 'E2001'); await p.click('#go');
  await p.waitForFunction(() => window.__DB.assets['ELE-CAM-0001'].current.employeeId === 'E2001');
  await open1(); await p.click('[data-aact=ret]'); await p.click('#go');
  await p.waitForFunction(() => window.__DB.assets['ELE-CAM-0001'].status === 'In Stock');
  const db = await p.db(), a = db.assets['ELE-CAM-0001'];
  const periods = Object.values(db.assignments).filter(h => h.assetId === 'ELE-CAM-0001').sort((x, y) => x.employeeId.localeCompare(y.employeeId));
  assert.equal(periods.length, 2);
  assert.ok(periods.every(h => h.endDate), 'both periods closed');
  assert.deepEqual(periods.map(h => h.closeReason).sort(), ['Return', 'Transfer']);
  assert.equal(a.rev, 3); assert.deepEqual(a.current, {});
  assert.equal(a.log.length, 4);
  assert.ok(a.log.every(l => /^TX-\d{8}-/.test(l.txRef || l.note) || l.txRef), 'every history line has a transaction reference');
  assert.ok(db.audit[a.lastAuditId].entityIds.includes('ELE-CAM-0001'));
  await close(p);
});

test('concurrent change is detected: stale screen copy cannot overwrite (rev check)', async () => {
  const p = await open();
  await addCameras(p, ['C-1\tHead Office\tA', 'C-2\tHead Office\tB']);
  await p.waitForFunction(() => Object.keys(window.__DB.assets).length === 2);
  await p.click('tr.click[data-id="ELE-CAM-0001"]'); await p.click('[data-aact=repair]');
  // another user changes the asset while this dialog is open
  await p.evaluate(() => { const a = window.__DB.assets['ELE-CAM-0001']; a.rev = 1; a.updatedByName = 'Other User'; });
  await p.click('#go');
  await p.waitForSelector('#fe:not([hidden])');
  assert.match(await p.textContent('#fe'), /changed by Other User .*Nothing was saved/);
  assert.equal((await p.db()).assets['ELE-CAM-0001'].status, 'In Stock');
  await close(p);
});

test('partial failure is reported exactly — no false success', async () => {
  // transactions: #1 counter, #2..#5 chunks → fail the 3rd chunk (tx #4)
  const p = await open('u1', baseDb(), {failTxAt: 4});
  await addCameras(p, Array.from({length: 20}, (_, i) => `PF-${i}\tHead Office\tP${i}`));
  await p.waitForSelector('#fe:not([hidden])');
  const msg = await p.textContent('#fe');
  assert.match(msg, /Saved 12 of 20/); assert.match(msg, /remaining 8 unit\(s\) were NOT saved/);
  assert.equal(Object.keys((await p.db()).assets).length, 12);
  assert.ok(!(await p.isVisible('#toast:not(.err)')) || !/Added/.test(await p.textContent('#toast')), 'no success toast');
  await close(p);
});

test('Excel template round-trip: exact-match validation and import', async () => {
  const p = await open();
  await p.click('[data-act=import]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#tpl')]);
  const file = path.join(TMP, 'tpl.xlsx'); await dl.saveAs(file);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Assets');
  assert.equal(ws.getCell('A1').value, 'Type *');
  const row = (i, v) => { ws.getRow(i).values = v; };
  row(2, ['Electronics', 'CCTV Camera', 'Cam A', '', 'Individual', 1, '0123', '', 'SecureTech Systems', '', new Date(Date.UTC(2026, 9, 1)), 3200, '', '', 'Head Office', 'Gate', 'New addition (purchase)']);
  row(3, ['electronics', 'CCTV Camera', 'bad case']);
  row(4, ['Electronics', 'Chair', 'wrong subtype']);
  row(5, ['Electronics', 'CCTV Camera', 'bad vendor', '', '', '', '', '', 'Securetech systems']);
  row(6, ['Furniture', 'Chair', '25 chairs', '', 'Lot', 25, '', '', '', '', '', 7800, '', '', 'Head Office']);
  await wb.xlsx.writeFile(file);
  await p.setInputFiles('#file', file); await p.waitForSelector('#doImp');
  const chips = await p.$$eval('#prev .chip', c => c.map(x => x.innerText));
  assert.deepEqual(chips.slice(0, 2), ['2 ready', '3 with errors']);
  await p.click('#doImp');
  await p.waitForFunction(() => Object.keys(window.__DB.assets).length === 2);
  const db = await p.db();
  assert.equal(db.assets['ELE-CAM-0001'].serial, '0123', 'leading zero kept');
  assert.equal(db.assets['FUR-CHR-0001'].qty, 25);
  assert.deepEqual(p.csp, [], 'ExcelJS from cdnjs works under the CSP');
  await close(p);
});

test('manager sees actions only inside scope; departments limited', async () => {
  const db = baseDb();
  const mk = (id, loc, dept) => ({assetId: id, name: id, typeId: 't1', subCode: 'CAM', qty: 1, status: dept ? 'Assigned' : 'In Stock', source: 'Purchase', serial: '', serialKey: '', rev: 0, location: loc,
    current: dept ? {department: dept, assignmentId: 'h-' + id, assignedDate: '2026-10-01'} : {}});
  db.assets = {'ELE-CAM-0001': mk('ELE-CAM-0001', 'Head Office', ''), 'ELE-CAM-0002': mk('ELE-CAM-0002', 'Site - Tower A', ''),
               'ELE-CAM-0003': mk('ELE-CAM-0003', 'Head Office', 'Sales'), 'ELE-CAM-0004': mk('ELE-CAM-0004', 'Head Office', 'Finance')};
  const p = await open('u2', db);
  const actionsOf = async id => { await p.click(`tr.click[data-id="${id}"]`); const a = await p.$$eval('[data-aact]', b => b.map(x => x.dataset.aact)); await p.click('[data-close]'); return a; };
  assert.deepEqual(await actionsOf('ELE-CAM-0001'), [], 'HO stock is outside scope');
  assert.ok((await actionsOf('ELE-CAM-0002')).includes('assign'), 'Tower A is in scope');
  assert.ok((await actionsOf('ELE-CAM-0003')).includes('ret'), 'held by Sales is in scope');
  assert.deepEqual(await actionsOf('ELE-CAM-0004'), [], 'held by Finance is outside scope');
  assert.ok(!(await actionsOf('ELE-CAM-0003')).includes('dispose'), 'managers cannot dispose');
  await p.click('tr.click[data-id="ELE-CAM-0003"]'); await p.click('[data-aact=edit]');
  for (const f of ['cost', 'purchaseDate', 'serial', 'life', 'salvage', 'qty']) assert.ok(await p.isDisabled(`#fm [name=${f}]`), `${f} locked for managers`);
  await close(p);
});

test('integrity tool: indexes legacy serials, flags duplicates, advances counters, closes orphan periods', async () => {
  const db = baseDb();
  const legacy = (id, serial, extra = {}) => ({assetId: id, name: id, typeId: 't1', subCode: 'CAM', qty: 1, status: 'In Stock', source: 'Purchase', serial, current: {}, location: 'Head Office', ...extra});
  db.assets = {'ELE-CAM-0001': legacy('ELE-CAM-0001', 'L-1'), 'ELE-CAM-0002': legacy('ELE-CAM-0002', 'L-2'),
               'ELE-CAM-0003': legacy('ELE-CAM-0003', 'DUP'), 'ELE-CAM-0004': legacy('ELE-CAM-0004', 'dup')};
  db.counters = {'ELE-CAM': {next: 3}};
  db.assignments = {orph: {assetId: 'ELE-CAM-0001', department: 'Sales', startDate: '2026-01-01', endDate: null}};
  const p = await open('u1', db, {hash: 'integrity'});
  await p.click('[data-act=integrity-scan]');
  await p.waitForSelector('[data-act=fix-serials]');
  const txt = await p.textContent('#view');
  assert.match(txt, /Duplicate serial numbers\s*1/); assert.match(txt, /not yet in the uniqueness index\s*2/);
  await p.click('[data-act=fix-serials]');
  await p.waitForFunction(() => Object.keys(window.__DB.serials).length === 2);
  await p.waitForSelector('[data-act=fix-counters]'); await p.click('[data-act=fix-counters]');
  await p.waitForFunction(() => window.__DB.counters['ELE-CAM'].next === 5);
  await p.waitForSelector('[data-act=fix-orphan]'); await p.click('[data-act=fix-orphan]');
  await p.waitForFunction(() => !!window.__DB.assignments.orph.endDate);
  const out = await p.db();
  assert.equal(out.assets['ELE-CAM-0001'].serialKey, 'l-1'); assert.equal(out.assets['ELE-CAM-0001'].rev, 1);
  assert.ok(!out.assets['ELE-CAM-0003'].serialKey, 'duplicates are not indexed automatically');
  assert.ok(Object.values(out.audit).some(a => a.action === 'Integrity: counters advanced'));
  assert.ok(Object.values(out.audit).some(a => a.action === 'Integrity: orphan period closed'));
  await close(p);
});

test('CSV export neutralises spreadsheet formulas', async () => {
  const db = baseDb();
  db.assets = {'ELE-CAM-0001': {assetId: 'ELE-CAM-0001', name: '=HYPERLINK("http://evil","x")', typeId: 't1', subCode: 'CAM', qty: 1, status: 'In Stock', source: 'Purchase', serial: '', current: {}, rev: 0}};
  const p = await open('u1', db);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=export-assets]')]);
  const f = path.join(TMP, 'a.csv'); await dl.saveAs(f);
  const csv = fs.readFileSync(f, 'utf8');
  assert.match(csv, /"'=HYPERLINK/); assert.doesNotMatch(csv, /,=HYPERLINK|^=HYPERLINK|,"=HYPERLINK/m);
  await close(p);
});

test('employee sees only "My Assets"; viewer has no write buttons', async () => {
  const db = baseDb();
  db.assets = {'ELE-CAM-0001': {assetId: 'ELE-CAM-0001', name: 'Mine', typeId: 't1', subCode: 'CAM', qty: 1, status: 'Assigned', source: 'Purchase', current: {employeeId: 'E1023', employeeName: 'Priya Raman', department: 'Sales'}, rev: 0},
               'ELE-CAM-0002': {assetId: 'ELE-CAM-0002', name: 'Not mine', typeId: 't1', subCode: 'CAM', qty: 1, status: 'Assigned', source: 'Purchase', current: {employeeId: 'E2001', department: 'Finance'}, rev: 0}};
  const e = await open('u4', db, {hash: 'mine'});
  assert.deepEqual(await e.$$eval('#nav a', a => a.map(x => x.textContent.trim())), ['▤My Assets']);
  assert.match(await e.textContent('#view'), /Mine/); assert.doesNotMatch(await e.textContent('#view'), /Not mine/);
  await close(e);
  const v = await open('u3', db);
  assert.equal(await v.$$eval('[data-act=add-asset],[data-act=import]', b => b.length), 0);
  await v.click('tr.click[data-id="ELE-CAM-0001"]');
  assert.equal(await v.$$eval('[data-aact]', b => b.length), 0);
  await close(v);
});

test('admin full JSON export contains every collection and is audited', async () => {
  const db = baseDb();
  db.assets = {'ELE-CAM-0001': {assetId: 'ELE-CAM-0001', name: 'x', typeId: 't1', subCode: 'CAM', qty: 1, status: 'In Stock', source: 'Purchase', current: {}, rev: 0}};
  const p = await open('u1', db, {hash: 'integrity'});
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=export-all]')]);
  const f = path.join(TMP, 'export.json'); await dl.saveAs(f);
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const c of ['users', 'assets', 'assignments', 'audit', 'serials', 'counters', 'employees', 'vendors']) assert.ok(c in out.data, c);
  assert.equal(out.meta.counts.assets, 1); assert.ok(out.data.settings.app);
  assert.ok(Object.values((await p.db()).audit).some(a => a.action === 'Full data export'));
  await close(p);
});
