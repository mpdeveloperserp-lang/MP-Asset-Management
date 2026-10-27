// Unit tests for pure calculations (no browser, no Firebase).   npm run test:unit
// Depreciation cases are REGRESSION tests of the current policy (straight-line, complete months from
// purchase date, salvage floor, stop at disposal). Replace / extend with Finance-approved cases (Q3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depr, monthsBetween, fyStartYear, fyLabel, parseDate, parseCSVRows, toCSV, serialKeyOf, serialProblem, valueOf, excelSerialToIso } from '../../js/calc.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} ≠ ${b}`);
const laptop = {cost: 68500, qty: 1, life: 3, salvage: 0, purchaseDate: '2024-06-12', status: 'Assigned'};

test('straight-line: worked example from the setup guide', () => {
  close(depr(laptop, '2025-03-31').acc, 17125, 'acc at 31-Mar-2025 (9 months)');
  close(depr(laptop, '2026-03-31').nbv, 28541.67, 'NBV at 31-Mar-2026 (21 months)');
  close(depr(laptop, '2026-03-31').acc - depr(laptop, '2025-03-31').acc, 22833.33, 'charge FY 2025-26');
  close(depr(laptop, '2027-06-10').nbv, 1902.78, 'NBV at 10-Jun-2027 (35 months)');
  close(depr(laptop).monthly, 1902.78, 'monthly charge');
});
test('fully depreciated assets stop at cost − salvage', () => {
  assert.equal(depr(laptop, '2030-01-01').nbv, 0);
  close(depr({...laptop, salvage: 5000}, '2030-01-01').nbv, 5000, 'salvage floor');
  close(depr({...laptop, salvage: 999999}, '2030-01-01').nbv, 68500, 'salvage capped at cost');
});
test('lot quantity multiplies cost', () => {
  assert.equal(valueOf({cost: 7800, qty: 25}), 195000);
  close(depr({cost: 7800, qty: 25, life: 10, salvage: 0, purchaseDate: '2025-01-20'}, '2026-01-20').acc, 19500, '12 months of 195000/120');
});
test('depreciation stops at the disposal date', () => {
  const d = {...laptop, status: 'Disposed', disposal: {date: '2025-06-12'}};
  close(depr(d, '2027-01-01').acc, 12 * 68500 / 36, 'only 12 months');
});
test('no depreciation before purchase, with zero life, or with missing data', () => {
  assert.equal(depr(laptop, '2024-01-01').acc, 0);
  assert.equal(depr({...laptop, life: 0}, '2026-01-01').acc, 0);
  assert.equal(depr({...laptop, cost: null}), null, 'missing cost → Data Incomplete');
  assert.equal(depr({...laptop, purchaseDate: ''}), null, 'missing date → Data Incomplete');
});
test('complete-month counting', () => {
  assert.equal(monthsBetween('2024-06-12', '2024-07-11'), 0);
  assert.equal(monthsBetween('2024-06-12', '2024-07-12'), 1);
  assert.equal(monthsBetween('2024-01-31', '2024-02-29'), 0);
  assert.equal(monthsBetween('2024-06-12', '2024-01-01'), 0, 'never negative');
});
test('Indian financial year (April–March)', () => {
  assert.equal(fyStartYear('2026-03-31'), 2025); assert.equal(fyStartYear('2026-04-01'), 2026);
  assert.equal(fyLabel(2025), 'FY 2025-26');
});
test('dates: ISO and DD-MM-YYYY, invalid dates rejected', () => {
  assert.equal(parseDate('12-06-2024'), '2024-06-12'); assert.equal(parseDate('2024-6-1'), '2024-06-01');
  assert.equal(parseDate('31/02/2024'), null); assert.equal(parseDate(''), ''); assert.equal(parseDate('junk'), null);
});
test('CSV: quoting, BOM, and formula-injection guard', () => {
  assert.deepEqual(parseCSVRows('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  const out = toCSV(['n'], [['=SUM(A1)'], ['+1'], ['@x'], ['-5'], ['-12.5'], ['plain']]);
  assert.match(out, /'=SUM\(A1\)/); assert.match(out, /'\+1/); assert.match(out, /'@x/);
  assert.match(out, /\r\n-5\r\n/, 'negative numbers untouched'); assert.match(out, /\r\n-12\.5\r\n/);
});
test('serial keys: case/space-insensitive, slash-safe, reserved names rejected', () => {
  assert.equal(serialKeyOf('  AbC/12 '), 'abc_12');
  assert.equal(serialKeyOf('HKV-1'), serialKeyOf('hkv-1 '));
  assert.ok(serialProblem('..')); assert.ok(serialProblem('__x__')); assert.ok(serialProblem('x'.repeat(201)));
  assert.equal(serialProblem('K12345'), '');
});

test('dates: month-name forms; DD-MM never read as MM-DD', () => {
  assert.equal(parseDate('05-Oct-2026'), '2026-10-05'); assert.equal(parseDate('5 October 2026'), '2026-10-05');
  assert.equal(parseDate('05/10/2026'), '2026-10-05', 'day first, whatever the PC region');
  assert.equal(parseDate('10/25/2026'), null, 'US month-first text is refused, not misread');
  assert.equal(parseDate('05-Foo-2026'), null);
});
test('Excel date serials (a date cell that lost its format)', () => {
  assert.equal(excelSerialToIso('45000'), '2023-03-15'); assert.equal(excelSerialToIso(46310), '2026-10-15');
  assert.equal(excelSerialToIso('46310.75'), '2026-10-15', 'time of day ignored');
  assert.equal(excelSerialToIso('123'), null); assert.equal(excelSerialToIso('27395'), '1975-01-01', 'converted; the import rejects it as out of range');
  assert.equal(excelSerialToIso('K1234'), null); assert.equal(excelSerialToIso(''), null);
});
