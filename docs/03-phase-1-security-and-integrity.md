# Phase 1: Security and Data Integrity

Release notes, deployment, testing and rollback.

## 1. What changed and why

| Fix | Finding (see 01) | Where |
|---|---|---|
| Rules rewritten: active-only access, field-level manager limits, explicit manager scope, audit link required, `rev` concurrency, forward-only counters, create-only serial index, assignment linkage, opening lock enforced, no deletes, bootstrap one-time only, settings hidden from unprofiled accounts | S-1…S-8 | `firestore.rules` |
| All asset writes run in **transactions**: re-read, check `rev`, write asset + assignment(s) + audit together | D-2, S-3, S-4 | `js/core.js` (`updateAsset`, `closeAssignment`) |
| Asset creation: chunks of 6 per transaction with serial index and audit; **exact partial-failure report** (what was / wasn't saved, with a download of unsaved import rows) | D-1, D-3, S-2 | `js/core.js` (`createAssetRecords`), `js/assets.js`, `js/import.js` |
| Manager scope: Users screen sets **departments and locations** per manager. The UI shows only allowed actions and departments and locks financial fields. | S-5 | `js/admin.js`, `js/assets.js`, `js/core.js` (`inScope`, `scopeError`) |
| Every audit entry carries a **transaction reference** (`TX-YYYYMMDD-XXXXXX`), also shown in the asset history and the Audit Log | §12 | `js/core.js`, `js/admin.js` |
| **Data Integrity** page (admin): scan for duplicate serials, unindexed legacy serials, counters behind existing IDs, orphan or broken assignment periods. Audited one-click fixes. **Full JSON export.** | Migration, §12 | `js/integrity.js` |
| CSV formula-injection guard | S-9 | `js/calc.js` (`toCSV`) |
| Content-Security-Policy and referrer policy | S-10 | `index.html` |
| Firestore persistent cache (fewer reads on reload) | P-2 | `js/firebase.js` |
| Code split into files by purpose; pure maths in `calc.js` with unit tests | §17 | `index.html`, `css/`, `js/` |
| Test suites and CI workflow | §16 | `tests/`, `.github/workflows/tests.yml` |

**Unchanged:** asset IDs, existing records, screens, reports, the Excel template, and the Firebase project and config.

**Compatibility:** records created before Phase 1 keep working. They have no `rev` (treated as 0), `lastAuditId` or `serialKey`, and the first change to each one adds these fields. Manager profiles without scope lists fall back to their home department.

## 2. Files in this release

```
index.html  css/app.css
js/ app.js firebase.js config.js calc.js core.js ui.js assets.js import.js views.js masters.js admin.js integrity.js
firestore.rules  firestore.indexes.json  firebase.json  .nojekyll  .gitignore
.github/workflows/tests.yml
tests/ package.json  unit/  mock-e2e/  rules/  emulator-e2e/
docs/ 00-setup-guide.md 01-… 02-… 03-… 04-backup-and-recovery.md
```

## 3. Test status (honest)

| Suite | What it proves | Status |
|---|---|---|
| `unit` (10 tests) | Depreciation maths (including the setup-guide worked example), FY bucketing, date parsing, CSV quoting and injection guard, serial keys | ✅ **Passed** 17-Oct-2026 (sandbox) |
| `mock-e2e` (11 tests) | UI workflows: 55 cameras (unique IDs and serials, index, audit links, chunking), duplicate-serial refusal, assign → transfer → return history, concurrent-change refusal, **partial-failure report**, Excel exact-match import, manager UI scope, integrity migration, CSV injection, employee/viewer views, full export, **no CSP violations** | ✅ **Passed** 17-Oct-2026 (sandbox, Chromium) |
| `rules` (21 tests) | Direct Firestore attacks against the real rules: viewer writes, employee cross-reads, manager out of scope / financial fields / disposal, unaudited writes, audit tampering and back-dating, stale `rev`, ID overwrite, counter rollback, **8 parallel ID reservations**, duplicate serials (including case/space variants), assignment-history tampering, opening lock, self-escalation, bootstrap closure | ⏳ **Written, not yet run.** The sandbox's network policy blocks the emulator download. Runs automatically in GitHub Actions. |
| `emulator-e2e` | The real app against the emulators **with the real rules**: bootstrap → masters → users → 8 cameras → assign/transfer/return/repair/dispose/lost/found → serial correction → Excel import → lock/unlock → integrity clean → manager in/out of scope → viewer and employee views, with **zero permission errors** | ⏳ **Written, not yet run.** Same reason. |

> **Do not publish the new `firestore.rules` until the GitHub Actions run shows all four suites green.** The rules have not yet been executed against the emulator. A rule typo would block the app, which is safe but disruptive.

### Mandatory acceptance tests (§16) mapped to tests

| # | Acceptance test | Covered by | Status |
|---|---|---|---|
| 1 | Unique IDs under concurrency | rules: *concurrent ID reservations*, *ID overwrite*; mock: 55 cameras | mock ✅ / rules ⏳ |
| 2 | Duplicate serials rejected | rules: *duplicate serial numbers…*; mock: *duplicate serial…* | mock ✅ / rules ⏳ |
| 3 | Transfer closes the previous period, opens the new one | rules: *transfer…*; mock: *transfer…*; emulator-e2e | mock ✅ / ⏳ |
| 4 | Return updates asset and history consistently | mock: *transfer… return…*; emulator-e2e | mock ✅ / ⏳ |
| 5 | Employee can't access others' records | rules: *employee…*; mock: *employee…*; emulator-e2e | mock ✅ / ⏳ |
| 6 | Viewer can't modify via direct requests | rules: *viewer…* | ⏳ |
| 7 | Manager can't modify outside scope | rules: *manager…* (×3); mock: *manager…*; emulator-e2e | mock ✅ / ⏳ |
| 8 | Unauthorised changes to roles, settings or audit | rules: *only admins manage users…*, *settings…*, *audit…* | ⏳ |
| 9 | Failed operation shows no false success | mock: *partial failure is reported exactly* | ✅ |
| 10 | Bulk import validates before committing | mock: *Excel template round-trip* | ✅ |
| 11 | Disposal keeps history | rules: *assets are never deleted…*; emulator-e2e | ⏳ |
| 12 | Maintenance records linked to asset | Phase 3 | – |
| 13 | Verification discrepancies tracked to closure | Phase 3 | – |
| 14 | Depreciation matches approved cases | unit: regression cases ✅. **Finance-approved cases still needed (Q3).** | partial |
| 15 | Exported reports match displayed figures | Same row data feeds both screen and export (`exportReport`). A dedicated test is planned for Phase 4. | partial |
| 16 | Backup restoration demonstrated | Phase 6 (needs Blaze, or the JSON export + restore script) | – |
| 17 | Existing IDs, records and features intact | mock suite reruns all earlier scenarios; integrity migration test on legacy records ✅ | ✅ |

## 4. How to run the tests

**In GitHub (recommended, no setup):** upload the files to a **new branch** (see §5 step 1). The *Tests — security rules & workflows* workflow runs automatically. Open the **Actions** tab and check that all steps are green.

**On a PC** (needs Node 22 and Java 21):
```
cd tests
npm install
npx playwright install chromium
npm test            # unit → mock-e2e → rules (emulator) → emulator-e2e
```
The emulators use the dummy project `demo-mp-assets`. They can't touch live data.

## 5. Deployment (about 15 minutes, in a quiet window)

> The new app and the new rules must go live **together**. The old app can't satisfy the new rules (it doesn't write audit links or `rev`), and the new app can't create assets under the old rules (there's no `serials` collection permission).

1. **Test on a branch first.**
   1. In the repo, click **main ▾ → type `phase-1` → Create branch**.
   2. Upload all files and folders from this package to that branch, keeping the folder structure.
   3. Wait for **Actions** to show green. If anything is red, send me a screenshot of the failing step and **stop here**.
2. **Back up first.** Signed in as admin on the *current* live app, export your data (Assets → Export CSV and the report exports). If you have only test data, skip this.
3. **Make the app live:** open a pull request `phase-1 → main` and merge it. GitHub Pages rebuilds in about 1 minute.
4. **Immediately publish the rules:** Firebase console → Firestore → **Rules** → paste `firestore.rules` → **Publish**. The console keeps the previous version in its history.
5. **Hard-refresh** the app (Ctrl+Shift+R) and sign in as admin.
6. **Migrate** under **Data Integrity → Run check**:
   - **Register serial numbers** (indexes existing serials).
   - **Advance counters** if any are listed.
   - Review and fix any **duplicate serials** by editing the wrong asset.
7. **Set manager scopes:** Users → edit each manager → tick their departments and/or locations.
8. **Smoke test:**
   - As admin, add 2 units, assign one, then return it.
   - As a manager, act on an in-scope asset, and confirm out-of-scope assets show no buttons.
   - As a viewer, confirm there are no write buttons.

## 6. Rollback (under 5 minutes, no data loss)

1. **Rules:** Firebase console → Firestore → Rules → history (clock icon) → select the previous version → **Publish**.
2. **App:** GitHub → the merge commit → **Revert**, then merge the revert pull request. Pages rebuilds in about 1 minute.
3. **Data stays compatible both ways.** The new fields (`rev`, `lastAuditId`, `serialKey`, `serials/*`, `txRef`) are ignored by the old app, and nothing was renamed or deleted.

## 7. Known limitations after Phase 1

- **Manager read scope:** managers and viewers can **read** the whole register (needed for company-wide reports); only **writes** are scoped. Restricting reads per scope needs query-based loading (Phase 2), if required.
- **Out-of-scope transfers** by managers are refused. An admin does them, or (Phase 5) they go through approvals (Q9).
- **Admin creates logins from the browser** via a secondary Auth instance. Disabling public self-sign-up in Firebase Auth would also block this until a Cloud Function exists (needs Blaze, Q2).
- **Whole-collection loading** is unchanged apart from the persistent cache. Fine to about 3–5k assets (P-1, Phase 2).
- **Depreciation policy** is unchanged and unconfirmed by Finance (F-1, F-2, Phase 4).
- **Asset `log[]`** still grows in the document. The audit collection is the authoritative history; the cap/move is planned for Phase 2 (D-6).
