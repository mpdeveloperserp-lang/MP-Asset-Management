# MP Developers: Asset Management System

A static web app (GitHub Pages) on Firebase Authentication and Cloud Firestore. It covers the asset register, opening stock, assignments and transfers, reports, masters, roles and the audit trail.

| | |
|---|---|
| **Live** | https://mpdeveloperserp-lang.github.io/MP-Asset-Management/ |
| **Firebase** | project `mp-asset-management` (config in `js/config.js`) |
| **Current release** | Phase 1: security and data integrity (`docs/03-phase-1-security-and-integrity.md`) |

## Structure
| Path | Purpose |
|---|---|
| `index.html`, `css/app.css` | Page shell (with Content-Security-Policy) and styles |
| `js/app.js` | Entry: sign-in, routing, actions, live data subscriptions |
| `js/firebase.js`, `js/config.js` | Firebase SDK initialisation (pinned 10.12.2) and project config |
| `js/calc.js` | Pure calculations: depreciation, dates, CSV (unit-tested) |
| `js/core.js` | State, helpers, **atomic and audited write layer** |
| `js/assets.js`, `js/import.js` | Asset register, lifecycle actions, Excel bulk import |
| `js/views.js`, `js/masters.js`, `js/admin.js`, `js/integrity.js` | Dashboard and reports, masters, users and audit, data integrity and export |
| `firestore.rules`, `firestore.indexes.json`, `firebase.json` | Security rules (**the real access control**), indexes, emulator/deploy config |
| `tests/` | `unit`, `mock-e2e`, `rules` (emulator), `emulator-e2e` (app + real rules) |
| `.github/workflows/tests.yml` | Runs all tests on every push (emulators only; never touches live data) |
| `docs/` | 00 setup, 01 assessment and gap analysis, 02 architecture and data model, 03 Phase 1 deploy / test / rollback, 04 backup and recovery |

## Rules of the road
- **Never publish `firestore.rules` unless the Actions run is green.**
- **Work on a branch.** Pages publishes `main` only.
- No secrets in this repository. The Firebase web API key is public by design; data is protected by the rules.
