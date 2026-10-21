// End-to-end: the REAL app (index.html?emulator) against the Firebase Auth + Firestore emulators
// with the REAL security rules. Proves the client and the rules agree: every workflow below must
// complete without a single permission error.
//   cd tests && npm install && npm run test:emulator-e2e
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
const EXCELJS_DIST = fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'), 'utf8');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'am-emu-'));
const AUTH = 'http://127.0.0.1:9099', FS = 'http://127.0.0.1:8080', PROJECT = 'demo-mp-assets';
const PW = 'Passw0rd!x';
let server, base, browser, page;
const problems = [];

async function signUp(email){
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password: PW, returnSecureToken: true})});
  if (!r.ok) throw new Error('signUp failed ' + await r.text());
}
async function login(email){
  await page.goto(`${base}/index.html?emulator`);
  await page.waitForSelector('#lf input[name=email]');
  await page.fill('#lf input[name=email]', email); await page.fill('#lf input[name=password]', PW);
  await page.click('#lf button.primary');
}
async function logout(){ await page.click('#logoutBtn'); await page.waitForSelector('#lf'); }
const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(150); };
// textContent, not innerText: innerText applies CSS text-transform (e.g. KPI labels shown in capitals).
const viewHas = (txt, timeout = 15000) => page.waitForFunction(t => document.querySelector('#view')?.textContent.includes(t), txt, {timeout});
async function noErrorToast(step){
  const err = await page.$('#toast.err:not([hidden])');
  if (err) problems.push(`${step}: ${await err.innerText()}`);
  const fe = await page.$('#fe:not([hidden])');
  if (fe && await fe.isVisible()) problems.push(`${step} (form): ${await fe.innerText()}`);
}
async function submitModal(step){
  await page.click('#go');
  await page.waitForFunction(() => document.querySelector('#modal').hidden || !document.querySelector('#fe')?.hidden, null, {timeout: 20000});
  await noErrorToast(step);
  if (!(await page.$eval('#modal', m => m.hidden))) { problems.push(`${step}: modal still open`); await page.click('[data-close]'); }
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
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {method: 'DELETE'});
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, {method: 'DELETE'});
  await signUp('admin@mp.test');
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {});
  const ctx = await browser.newContext({acceptDownloads: true, viewport: {width: 1300, height: 900}});
  page = await ctx.newPage();
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'E2E unlock test' : undefined));
  page.on('console', m => { const t = m.text(); if (/permission|PERMISSION|Missing or insufficient|Content Security Policy/i.test(t)) problems.push('console: ' + t); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs/, r => r.fulfill({contentType: 'application/javascript', body: EXCELJS_DIST}));
});
after(async () => { await browser?.close(); server?.close(); });

test('full workflow against emulator + real rules', async (t) => {
  await t.test('bootstrap first admin with starter masters', async () => {
    await login('admin@mp.test');
    await page.waitForSelector('#bf');
    await page.fill('#bf input[name=name]', 'Sara Admin'); await page.click('#bf button');
    await page.waitForSelector('#app:not([hidden])', {timeout: 30000});
    await go('#masters'); await viewHas('Electronics');
  });

  await t.test('masters: location, vendor, employees', async () => {
    await page.click('[data-act=masters-tab][data-tab=locs]'); await page.click('[data-act=loc-form]');
    await page.fill('#fm [name=name]', 'Site - Tower A'); await submitModal('add location'); await viewHas('Site - Tower A');
    await page.click('[data-act=masters-tab][data-tab=vendors]'); await page.click('[data-act=vendor-form]');
    await page.fill('#fm [name=name]', 'SecureTech Systems'); await page.fill('#fm [name=gstin]', '33AABCS1234F1Z5'); await submitModal('add vendor');
    await page.click('[data-act=masters-tab][data-tab=emps]');
    for (const [id, name, dept] of [['E1023', 'Priya Raman', 'Sales'], ['E2001', 'Arun K', 'Finance']]){
      await page.click('[data-act=emp-form]');
      await page.fill('#fm [name=empId]', id); await page.fill('#fm [name=name]', name); await page.selectOption('#fm [name=department]', dept);
      await submitModal('add employee ' + id);
    }
    await viewHas('Arun K');
  });

  await t.test('users: manager (scoped), viewer, employee login', async () => {
    await go('#users');
    const add = async (email, name, role, opts = {}) => {
      await page.click('[data-act=user-form]');
      await page.fill('#fm [name=name]', name); await page.fill('#fm [name=email]', email); await page.fill('#fm [name=password]', PW);
      await page.selectOption('#fm [name=role]', role);
      if (opts.md) for (const d of opts.md) await page.check(`#fm input[name=md][value="${d}"]`);
      if (opts.ml) for (const l of opts.ml) await page.check(`#fm input[name=ml][value="${l}"]`);
      if (opts.empId) await page.fill('#fm [name=empId]', opts.empId);
      await submitModal('add user ' + email);
    };
    await add('mgr@mp.test', 'Mani Manager', 'manager', {md: ['Sales'], ml: ['Site - Tower A']});
    await add('viewer@mp.test', 'Vik Viewer', 'viewer');
    await add('priya@mp.test', 'Priya Raman', 'employee', {empId: 'E1023'});
    await viewHas('Vik Viewer');
  });

  await t.test('register 8 cameras in one go (two atomic chunks) with serials and locations', async () => {
    await go('#assets');
    await page.click('[data-act=add-asset]');
    await page.selectOption('#fm [name=subCode]', 'CAM');
    await page.fill('#fm [name=name]', 'Hikvision 2MP Dome Camera'); await page.fill('#fm [name=cost]', '3200');
    await page.fill('#fm [name=purchaseDate]', '2026-10-10'); await page.selectOption('#fm [name=vendor]', 'SecureTech Systems');
    await page.selectOption('#fm [name=location]', 'Head Office'); await page.fill('#fm [name=count]', '2');
    await page.click('#pasteBtn');
    await page.fill('#pasteTxt', Array.from({length: 8}, (_, i) => `HKV-${100 + i}\t${i < 4 ? 'Head Office' : 'Site - Tower A'}\tPole ${i + 1}`).join('\n'));
    await page.click('#pasteGo');
    await submitModal('add 8 cameras');
    await viewHas('ELE-CAM-0008');
  });

  await t.test('assign → transfer → return; repair cycle; dispose', async () => {
    const openA = async id => { await page.click(`tr.click[data-id="${id}"]`); await page.waitForSelector('#modal:not([hidden])'); };
    await openA('ELE-CAM-0001'); await page.click('[data-aact=assign]');
    await page.selectOption('#fm [name=department]', 'Sales'); await page.selectOption('#fm [name=employeeId]', 'E1023'); await submitModal('assign');
    await openA('ELE-CAM-0001'); await page.click('[data-aact=assign]');
    await page.selectOption('#fm [name=department]', 'Finance'); await page.selectOption('#fm [name=employeeId]', 'E2001'); await submitModal('transfer');
    await openA('ELE-CAM-0001'); await page.click('[data-aact=ret]'); await submitModal('return');
    await openA('ELE-CAM-0001'); await page.click('[data-aact=repair]'); await submitModal('send to repair');
    await openA('ELE-CAM-0001'); await page.click('[data-aact=repaired]'); await submitModal('repair complete');
    await openA('ELE-CAM-0002'); await page.click('[data-aact=dispose]'); await submitModal('dispose');
    await openA('ELE-CAM-0003'); await page.click('[data-aact=edit]');
    await page.fill('#fm [name=serial]', 'HKV-103-FIXED'); await submitModal('admin serial correction');
    await openA('ELE-CAM-0004'); await page.click('[data-aact=lost]'); await submitModal('mark lost');
    await openA('ELE-CAM-0004'); await page.click('[data-aact=found]'); await submitModal('mark found');
  });

  await t.test('duplicate serial is refused (database-level refusal is proven in tests/rules)', async () => {
    await page.click('[data-act=add-asset]');
    await page.selectOption('#fm [name=subCode]', 'CAM'); await page.fill('#fm [name=name]', 'Dup');
    await page.selectOption('#fm [name=location]', 'Head Office'); await page.fill('#fm [name=serial]', 'HKV-105');
    await page.click('#go');
    await page.waitForSelector('#fe:not([hidden])');
    assert.match(await page.textContent('#fe'), /HKV-105|already/i);
    await page.click('[data-close]');
  });

  await t.test('Excel bulk import (template from live masters)', async () => {
    await page.click('[data-act=import]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tpl')]);
    const file = path.join(TMP, 'tpl.xlsx'); await dl.saveAs(file);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet('Assets');
    ws.getRow(2).values = ['Electronics', 'Laptop', 'Dell Latitude 5440', '', 'Individual', 1, 'DL-1', '', '', 'INV-1', new Date(Date.UTC(2024, 5, 12)), 68500, 3, 0, 'Head Office', '', 'Opening balance', '', 'No', 'Sales', 'E1023', new Date(Date.UTC(2024, 5, 15))];
    ws.getRow(3).values = ['Furniture', 'Chair', 'Mesh chair', '', 'Lot', 25, '', '', '', '', new Date(Date.UTC(2025, 0, 20)), 7800, '', '', 'Head Office'];
    await wb.xlsx.writeFile(file);
    await page.setInputFiles('#file', file); await page.waitForSelector('#doImp');
    await page.click('#doImp');
    await page.waitForFunction(() => document.querySelector('#modal').hidden, null, {timeout: 20000});
    await noErrorToast('excel import');
    await viewHas('FUR-CHR-0001');
  });

  await t.test('opening balance: declare, lock, unlock (audited settings)', async () => {
    await go('#opening'); await viewHas('Opening balance');
    await page.click('[data-act=lock-opening]'); await viewHas('Approved & locked'); await noErrorToast('lock');
    await page.click('[data-act=unlock-opening]'); await viewHas('Draft'); await noErrorToast('unlock');
  });

  await t.test('integrity check is clean; audit log populated', async () => {
    await go('#integrity'); await page.click('[data-act=integrity-scan]'); await viewHas('Scanned');
    const chips = await page.$$eval('#view .card h3 .chip', c => c.map(x => x.innerText));
    assert.ok(chips.every(c => c === 'OK'), 'integrity: ' + chips.join(','));
    await go('#audit'); await viewHas('Create (batch)');
  });

  await t.test('manager: works inside scope, blocked outside', async () => {
    await logout(); await login('mgr@mp.test'); await page.waitForSelector('#app:not([hidden])');
    await go('#assets'); await viewHas('ELE-CAM-0005');
    await page.click('tr.click[data-id="ELE-CAM-0001"]');
    assert.equal((await page.$$('[data-aact]')).length, 0, 'Head Office stock is outside the manager scope');
    await page.click('[data-close]');
    await page.click('tr.click[data-id="ELE-CAM-0005"]'); await page.click('[data-aact=assign]');
    await page.selectOption('#fm [name=department]', 'Finance'); await submitModal('manager assigns Tower A camera');
    await page.click('[data-act=add-asset]');
    await page.selectOption('#fm [name=subCode]', 'CAM'); await page.fill('#fm [name=name]', 'Mgr cam');
    await page.selectOption('#fm [name=location]', 'Site - Tower A'); await page.fill('#fm [name=serial]', 'MGR-1');
    await submitModal('manager registers at own location');
    await viewHas('ELE-CAM-0009');
  });

  await t.test('viewer and employee are read-only / own-only', async () => {
    await logout(); await login('viewer@mp.test'); await page.waitForSelector('#app:not([hidden])');
    await go('#assets'); await viewHas('ELE-CAM-0001');
    assert.equal((await page.$$('[data-act=add-asset]')).length, 0);
    await go('#reports'); await viewHas('Stock summary');
    await logout(); await login('priya@mp.test'); await page.waitForSelector('#app:not([hidden])');
    await viewHas('Assets with you');
    const txt = await page.textContent('#view');
    assert.ok(txt.includes('ELE-LAP-0001'), 'imported laptop assigned to E1023 is visible');
    assert.ok(!txt.includes('ELE-CAM-0005'), "another department's camera is not visible");
  });

  assert.deepEqual(problems, [], 'no permission errors, form errors or CSP violations during the workflow');
});
