# Architecture and Data Model (after Phase 1)

## 1. Architecture

```
Browser (GitHub Pages, static files)                     Firebase project: mp-asset-management
┌───────────────────────────────────────────┐           ┌──────────────────────────────────────┐
│ index.html  (CSP, layout)                 │  HTTPS    │ Firebase Authentication (email/pw)   │
│ css/app.css                               │──────────▶│ Cloud Firestore                      │
│ js/app.js        entry: auth, routing      │           │   └─ firestore.rules  ◀── the real   │
│ js/firebase.js   SDK init (pinned 10.12.2) │           │                         access control│
│ js/config.js     project config, constants │           └──────────────────────────────────────┘
│ js/calc.js       pure maths (unit-tested)  │
│ js/core.js       state, helpers, ATOMIC    │   Phase 4–5 (needs Blaze plan):
│                  AUDITED WRITES            │     Cloud Storage (documents) + storage.rules
│ js/ui.js         modal / form helpers      │     Cloud Functions (reminders, approvals,
│ js/assets.js     register + lifecycle      │                      trusted validation, backups)
│ js/import.js     Excel template / import   │
│ js/views.js      dashboard, register,      │
│                  opening stock, reports    │
│ js/masters.js    types, locations, vendors,│
│                  departments, employees    │
│ js/admin.js      users, audit log, my-assets│
│ js/integrity.js  integrity scan, migration,│
│                  full export               │
└───────────────────────────────────────────┘
tests/  unit · mock-e2e (UI) · rules (emulator) · emulator-e2e (app + real rules) — run by GitHub Actions
```

**Trust model.**
- The browser is untrusted. Everything that matters is enforced in `firestore.rules`.
- The UI mirrors the rules only for usability, for example by hiding buttons a user can't use.
- No secrets live in browser code. The Firebase web API key is a public identifier, not a credential.

## 2. Collections

| Collection | Key | Purpose | Who can write |
|---|---|---|---|
| `users/{uid}` | Auth uid | Profile: `name, email, role, department, empId, managedDepartments[], managedLocations[], active, lastAuditId` | Admin (audited); first admin bootstrap only |
| `settings/app` | – | `cutoff, currency, openingLocked, lockedBy/At, unlockReason, lastAuditId` | Admin (audited) |
| `types/{id}` | auto | Type with embedded `subtypes[{name, code, life, active}]` | Admin |
| `departments`, `locations`, `vendors` | auto | Masters | Admin |
| `employees/{empId}` | Employee ID | `name, department, email, active` | Admin |
| `openingStock/{typeId__subCode}` | composite | Declared opening qty/value | Admin, only while unlocked |
| `counters/{TYPE-SUB}` | e.g. `ELE-CAM` | `next`: next asset number; **forward-only** | Admin / manager |
| `serials/{serialKey}` | normalised serial | `{assetId, serial, by, at}`: uniqueness index, **create-only** | Admin / manager |
| `assets/{assetId}` | e.g. `ELE-CAM-0001` | The asset register (fields below) | Admin; manager within scope and non-financial fields |
| `assignments/{id}` | auto | One custody period: `assetId, department, employeeId, startDate, endDate, expectedReturn, conditionOut/In, notes, kind, issuedBy, closedBy, closeReason, txRef` | Opened or closed only together with the asset |
| `audit/{id}` | auto | Append-only: `at (server time), by, byName, entity, entityId, entityIds[], action, before{}, after{}, txRef, note` | Admin / manager create; nobody updates or deletes |

### Asset document

| Group | Fields |
|---|---|
| Identity | `assetId`, `typeId/typeCode/typeName`, `subCode/subtype`, `name`, `description`, `make`, `serial`, **`serialKey`** |
| Quantity / tracking | `qty` (1 for individual units; N for a lot) |
| Purchase | `vendor`, `invoice`, `purchaseDate`, `cost` (per unit), `warrantyUntil`, `source` (`Purchase` / `Opening`) |
| Depreciation | `method` (`SL`), `life` (years), `salvage` (record total) |
| Place | `location` (from Masters), `locationDetail` (free-text position) |
| Status | `status` (In Stock · Assigned · Under Repair · Lost · Disposed), `current{assignmentId, department, employeeId, employeeName, assignedDate, expectedReturn, notes}`, `repair{}`, `lost{}`, `disposal{}` |
| Control (Phase 1) | **`rev`** (concurrency counter), **`lastAuditId`** (link to the audit entry of the last change) |
| Stamps | `createdAt/By/ByName`, `updatedAt/By/ByName`, `log[]` (human-readable history with `txRef`) |

## 3. How each guarantee is enforced

| Guarantee | Mechanism |
|---|---|
| Unique asset IDs under concurrency | `counters` reserved in a Firestore transaction. The counter can only increase (rules). An asset document can never be overwritten, because a "create" on an existing ID is treated as an update with `rev 0 ≠ old+1` and is denied. |
| Unique serials under concurrency | `serials/{serialKey}` is created in the **same transaction** as the asset. The rules deny creating an index entry that already exists, and deny an asset whose `serialKey` doesn't match its serial or has no index entry. |
| No stale or concurrent overwrites | Every update re-reads the asset in a transaction. `rev` must increase by exactly 1 (rules). |
| Complete, untamperable history | Every asset, user and settings write must set `lastAuditId` to a **new** audit document written in the same transaction by the **same** user and covering the record (rules). Audit entries are never updatable or deletable. |
| Consistent custody history | An assignment period can be opened only if the asset points to it in the same write. It can be closed only when the asset has moved off it. Closed periods are immutable. |
| Manager scope | `inMgrScope` = current department ∈ `managedDepartments` **or** location ∈ `managedLocations`, checked before **and** after the change. Financial and identity fields are admin-only. Managers can't dispose, or resolve a Lost asset. |
| Employee isolation | Assets and assignments are readable by an employee only where `employeeId == their empId`. Masters with personal data (employees, vendors) and the audit log are not readable by employees. |
| Inactive users | Every rule requires `users/{uid}.active == true`. |
| Opening lock | Opening-source assets can't be created, and `source` can't be changed, while `settings/app.openingLocked` is true; `openingStock` is frozen. |
| Atomic multi-record writes | One transaction per logical change (asset + assignment(s) + serial index + audit). Bulk creation runs in transactions of 6 assets, and any failure is reported exactly (saved vs. not saved). |

## 4. Firestore limits respected

- **Rules document-access limit:** 20 `get/exists` calls per transaction. Each new asset needs about 2, so bulk creation uses chunks of 6 (`CREATE_CHUNK` in `core.js`).
- **Batch size:** at most 500 writes. Master imports use 200 records + 200 audit entries per batch.
- **Indexes:** all current queries are single-field equality, so no composite indexes are needed (`firestore.indexes.json` is empty and deployable).
