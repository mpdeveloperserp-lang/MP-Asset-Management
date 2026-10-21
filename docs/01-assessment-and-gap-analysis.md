# MP Developers Asset Management: Existing-System Assessment and Gap Analysis

| | |
|---|---|
| **Reviewed** | `index.html` (single file, about 2,100 lines), `firestore.rules`, `SETUP.md`, as delivered on 17-Oct-2026 |
| **Firebase project** | `mp-asset-management` (config is in the source; the live rules in the Firebase console were **not** visible to the reviewer, see Q1 at the end) |
| **Hosting** | GitHub Pages, `mpdeveloperserp-lang/MP-Asset-Management` |

Severity scale:
- **Critical:** exploitable now or can silently corrupt data.
- **High:** a control the brief requires is missing or bypassable.
- **Medium:** correctness or robustness issue.
- **Low:** polish.

---

## 1. What exists today (confirmed in the source code, not just the UI)

### 1.1 Modules and functions

| Area | Implementation (function names) | Status |
|---|---|---|
| Auth and session | `onAuthStateChanged`, `showLogin`, `showBootstrap` (first admin), idle logout (`resetIdle`, 30 min), password reset email | Working |
| Roles | `admin`, `manager`, `viewer`, `employee` in `users/{uid}.role` (UI checks `isAdmin`, `isWriter`, `canManage`, plus the rules) | Partial (see S-1 to S-6) |
| Masters | Types with embedded subtypes (`typeForm`, `subForm`), Locations, Vendors (GSTIN/PAN validation, CSV import/export), Departments, Employees (CSV import) | Working |
| Asset register | `assetForm`: Individual or Lot; per-unit serial/location grid with paste from Excel; `assets/{assetId}` with ID `TYPE-SUB-0001` from `counters/{TYPE-SUB}` | Working (see D-1 to D-3) |
| Opening stock | Declared totals (`openingStock`) vs. recorded `source:'Opening'` assets; variance; approve and lock (`settings/app.openingLocked`); unlock with reason | Working |
| Bulk import | Excel template generated from live Masters with dropdowns (ExcelJS); exact-match validation; preview; error report | Working (see D-4) |
| Lifecycle | `assignDialog` (assign/transfer), `returnDialog`, repair / repair complete, lost / found, `disposeDialog` (admin) | Working (see D-2, D-5) |
| History | `assignments` collection (one doc per custody period), `asset.log[]` array, `audit` collection with field-level before/after | Partial (see S-3, D-6) |
| Reports | Stock summary, Location-wise, Location register, Department, Employee holdings, Due for return, Vendor-wise, Warranty expiry, Depreciation (FY Apr–Mar), Disposal log, Transfer history, Exceptions; CSV export and print to PDF | Working (see F-1 to F-4) |
| Dashboard | KPIs, value by type, units by department / location / status, recent assignments | Working |
| Users | Admin creates Auth users via a secondary app instance; role, department, employee ID, active flag | Partial (see S-1, S-6) |

### 1.2 Firestore collections

`users`, `settings/app`, `types` (subtypes embedded), `departments`, `locations`, `vendors`, `employees`, `openingStock`, `counters`, `assets`, `assignments`, `audit`.

**Not present:** maintenance, verification, documents/storage, projects, insurance/AMC, approvals, notifications, serial-number index.

### 1.3 Data loading

The app keeps real-time listeners on **entire** collections: `assets`, `assignments`, `employees`, `vendors`, plus the last 500 `audit` entries for admins. All reports are computed in the browser.

---

## 2. Defects and risks found

### Security and access control

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| S-1 | **Critical** | A manager can change **any field** of an asset in their department, including cost, purchase date, useful life, salvage, source and serial number. They can also move it to **any** department, because the rules only check the department *before* the change. | `match /assets` update rule checks `managerScope()` on `resource` only |
| S-2 | **Critical** | **Asset overwrite:** if `counters/{TYPE-SUB}` is reset or set lower (any manager can write counters), the next creation re-uses an existing ID. `batch.set()` on an existing document is then treated as an *update* and **replaces the existing asset** (silently for admin; for a manager when the asset is in scope). | `createAssetRecords` uses `set`; `/counters` allows any write by `isWriter()` |
| S-3 | **High** | The audit trail can be bypassed. Assets can be written directly through the Firestore API without an audit entry. Any profiled user, including viewers and employees, can create audit entries. | `/audit` create rule only checks `by == uid` |
| S-4 | **High** | Assignment history is mutable. Any admin or manager can create or edit any assignment document, including **closed** historical periods, in any department. | `/assignments` `allow create, update: if isWriter()` |
| S-5 | **High** | Manager scope is a single department. The brief requires **explicitly authorised departments and/or locations**. Unallocated stock is editable by every manager. | `managerScope()` |
| S-6 | **Medium** | First-admin bootstrap is open to **any** authenticated account until `settings/app` exists. Firebase Email/Password sign-up is open by default, so anyone holding the public API key can create an Auth account. Once bootstrap is done the window is closed. | `users` create rule |
| S-7 | **Medium** | `settings/app` is readable by any signed-in account, even one without a profile. | `/settings` read rule |
| S-8 | **Medium** | The opening-balance lock is enforced in the UI only. The rules don't stop an asset's `source` being switched to or from `Opening` after locking. | `/assets` update rule |
| S-9 | **Medium** | CSV exports are open to *formula injection*: a value such as `=HYPERLINK(...)` typed into a name field executes when the export is opened in Excel. | `toCSV` |
| S-10 | **Low** | There's no Content-Security-Policy. All output is HTML-escaped (`esc()`), so no XSS sink was found, but a CSP adds defence in depth. | `index.html` head |
| S-11 | **Low** | Viewers can export every report. Whether that's allowed is a policy decision (Q6). | Reports toolbar |
| S-12 | **Info** | No privileged secrets in browser code. The Firebase web API key is public by design. | config block |

### Data integrity

| ID | Severity | Finding |
|---|---|---|
| D-1 | **High** | **Serial-number uniqueness is checked only against assets loaded in the browser.** Two users saving the same serial at the same time, or a direct API write, can create duplicates. |
| D-2 | **High** | **Race on lifecycle actions:** transfer, return, dispose and similar use the asset as it was loaded on screen, not a fresh read. If two users act on the same asset together, the second write closes an already-closed assignment and overwrites `current`, leaving an **orphan open assignment**. There's no optimistic-concurrency check. |
| D-3 | **Medium** | Bulk creation commits in batches of 150 *after* reserving IDs. If batch 2 fails, batch 1 is already saved, the error toast doesn't say which rows were created, and reserved IDs are skipped. That's not a false success, but it is an incomplete report. |
| D-4 | **Medium** | A lot record (for example 25 chairs) can only be assigned or transferred as a whole. It behaves like a serialised asset, which the brief says it must not. |
| D-5 | **Medium** | Repair is a status flag plus a note. There's no work order, cost, vendor or before/after condition, and "Repair complete" can return an asset to stock without inspection. |
| D-6 | **Medium** | `asset.log[]` grows without limit inside the asset document (1 MB document cap). The audit collection is the durable history; `log` should be capped or moved. |
| D-7 | **Low** | Asset condition is captured only at assign or return. There's no "current condition" field. |
| D-8 | **Low** | `assignments` have no `returnedBy` / `receivedBy` / accessories / acknowledgement fields. |

### Financial (depreciation and reports)

| ID | Severity | Finding |
|---|---|---|
| F-1 | **High (policy)** | **Opening-balance assets are depreciated from their purchase date by the app's own formula.** There's no field for *accumulated depreciation as per books at the cut-off date*. If Finance's historical method differs (WDV, a different life, Schedule II rates), app NBV ≠ book NBV, and reconciliation will fail. |
| F-2 | **Medium (policy)** | Depreciation counts **complete months** from the purchase date (an asset bought 12-Jun starts 12-Jul). Companies Act Schedule II practice is usually **pro-rata by days** from the put-to-use date, and some companies use half-year conventions. The rule must come from Finance (Q3). |
| F-3 | **Medium** | The depreciation report has no **gross-block movement**: opening gross block, additions, **deletions**, closing gross block; and accumulated depreciation written back on disposals. Category-wise schedule and FAR reconciliation are missing. |
| F-4 | **Low** | The disposal record has no disposal-expense field; gain/loss = proceeds − NBV only. |

Verified correct with tests (kept as regression tests): straight-line monthly charge, salvage floor, cessation at disposal, nil depreciation for missing cost/date ("Data Incomplete"), April–March FY bucketing. For example, a ₹68,500 asset with a 3-year life bought 12-Jun-2024 has an FY 2025-26 opening NBV of ₹51,375, a charge of ₹22,833.33 and a closing NBV of ₹28,541.67.

### Performance and reliability

| ID | Severity | Finding |
|---|---|---|
| P-1 | **Medium** | Whole-collection listeners. Fine up to roughly 3–5k assets, but every page load reads every asset and assignment. **On the free Spark plan (50,000 reads/day)**, 1,500 assets × 2 collections × 30 loads/day is enough to hit the quota. |
| P-2 | **Low** | No offline / persistent cache, so every reload is a full re-read. |
| P-3 | **Low** | `audit` is limited to the latest 500, with no paging or search by date. |

---

## 3. Gap analysis against the brief

Status key:
- ✅ exists
- 🟡 partial or needs correction
- ❌ missing

| § | Requirement | Status | Notes / phase |
|---|---|---|---|
| 2 | Role model (admin / manager / viewer / employee) | 🟡 | S-1…S-8, scoped managers → **Phase 1** |
| 2 | Rules-enforced authorisation, field-level protection | 🟡 | **Phase 1** |
| 2 | Inactive users blocked | ✅ | `active == true` required in rules |
| 2 | Storage rules for files | ❌ | No uploads yet → **Phase 4**; needs the Blaze plan (Q2) |
| 2 | Trusted backend validation | ❌ | Needs Cloud Functions (Blaze) → Phase 5 |
| 3 | Asset register fields | 🟡 | Missing: PO ref, invoice date, project/site, condition, documents → Phase 2/4 |
| 3 | Unique IDs under concurrency | 🟡 | Counter is transactional, but overwrite risk (S-2) → **Phase 1** |
| 3 | Unique serials under concurrency | ❌ | D-1 → **Phase 1** (serial index) |
| 3 | Exception report for incomplete data | ✅ | Exceptions report |
| 3 | Complete material-change history | 🟡 | Bypassable (S-3) → **Phase 1** |
| 3 | Lot vs. serialised behaviour | 🟡 | D-4 → Phase 2 |
| 4 | Assignment / transfer / return | 🟡 | Exists; race D-2 → **Phase 1**; acknowledgement, accessories, received-by → Phase 2 |
| 4 | Lost-asset investigation workflow | 🟡 | Status only → Phase 2 |
| 4 | Disposal with approval and documents | 🟡 | Admin-only; no approval workflow or documents → Phase 4/5 |
| 4 | Atomic related writes | 🟡 | Batches exist; no concurrency control → **Phase 1** |
| 5 | Maintenance & repair module | ❌ | Phase 3 |
| 5 | Preventive maintenance schedules | ❌ | Phase 3 |
| 6 | Physical verification campaigns | ❌ | Phase 3 (Location register exists as a manual checklist) |
| 6 | QR labels and scanning | ❌ | Phase 3 |
| 7 | Purchase references (PO, GRN, taxes) | 🟡 | Invoice ref only → Phase 4 |
| 7 | Document attachments | ❌ | Phase 4 (Firebase Storage, Blaze) |
| 8 | Depreciation validation | 🟡 | F-1…F-4; policy from Finance (Q3) → Phase 4 |
| 8 | Gross-block schedule, FAR reconciliation | ❌ | Phase 4 |
| 9 | Project/site master | ❌ | Locations only → Phase 5 (Q4) |
| 9 | Multi-company | ❌ | Only if required (Q5) |
| 9 | Insurance & AMC | ❌ | Warranty only → Phase 5 |
| 10 | Approvals with segregation of duties | ❌ | Phase 5 (Q7 thresholds) |
| 10 | Scheduled notifications | ❌ | Needs Cloud Functions + email provider → Phase 5 (Q2, Q8) |
| 11 | Reports 1–18 | 🟡 | 1–9, 13 (warranty only), 15, 16 exist. Missing: 10–12 (maintenance/verification), 14 additions-by-period (filterable), 17 missing documents, 18 FAR reconciliation |
| 12 | Backups / restore drills | ❌ | Requires Blaze for scheduled exports → Phase 6 docs; CSV ≠ backup |
| 12 | Audit with transaction reference | 🟡 | **Phase 1** adds a mandatory link and transaction reference |
| 13 | Pagination / server queries | 🟡 | P-1 → Phase 2 (persistent cache now, query-based views later) |
| 14 | Consistent UI, mobile | ✅ | Responsive layout exists |
| 17 | Separate files by purpose | ❌ | **Phase 1** |

---

## 4. Priority list and phase plan

| Phase | Scope | Depends on |
|---|---|---|
| **1. Security and integrity** (this delivery) | Fix S-1…S-10, D-1…D-3. Split into modules. Rules unit tests and an emulator end-to-end test in CI. Integrity / migration tool for existing records. | – |
| **2. Core lifecycle** | Acknowledgement, accessories, returned-by / received-by, condition field, lot partial issue (D-4), lost-asset investigation, `log` cap (D-6), persistent cache, paging of audit | – |
| **3. Maintenance and verification** | Work orders, costs, vendor, PM schedules; verification campaigns; QR labels and scan | – |
| **4. Financial controls** | Purchase refs, documents (Storage), depreciation per Finance policy, gross-block schedule, FAR reconciliation, opening accumulated depreciation | Q2, Q3 |
| **5. Business improvements** | Project/site master, Insurance/AMC, approvals, scheduled notifications | Q2, Q4, Q7, Q8 |
| **6. Testing and deployment** | Full role matrix, load test, backup/restore drill, rollback rehearsal | Q2 |

---

## 5. Decisions and information needed from MP Developers

These are business or configuration decisions I can't make on your behalf. Phase 1 doesn't depend on them.

| # | Question | Why it matters |
|---|---|---|
| Q1 | Are the **currently published** Firestore rules exactly the `firestore.rules` delivered on 17-Oct, and is there any real data in the project yet? | Migration and rollback planning |
| Q2 | Can the Firebase project move to the **Blaze (pay-as-you-go)** plan? | Required for Cloud Storage (documents/photos), Cloud Functions (scheduled reminders, trusted validation, admin user creation) and scheduled backups. Typical cost at this scale is near zero, but a billing account is required. |
| Q3 | **Depreciation policy** from Finance: method (SLM / WDV), Companies Act Schedule II useful lives or company-specific, pro-rata by days or months, residual %, put-to-use date vs. purchase date, and whether opening assets should carry **book accumulated depreciation at cut-off**. Please also give 3–5 sample assets with Finance-approved figures for test cases. | F-1, F-2 |
| Q4 | List of **projects/sites** and how they relate to locations (one project → many locations?). | Project master |
| Q5 | Is more than one **legal entity** needed? | Company-level data isolation |
| Q6 | May **viewers export** reports, and which ones? | S-11 |
| Q7 | **Approval thresholds and approvers**: high-value assignment amount, repair amount, disposal, write-off, interdepartmental transfer. | Approval engine |
| Q8 | Notification channel: email (which sender domain / service?) or in-app only. | Reminders |
| Q9 | Should **managers** be able to transfer assets *out* of their scope (to another department), or should that go to admin / approval? Phase 1 currently says **no**: an out-of-scope transfer needs an admin. | Manager scope |
