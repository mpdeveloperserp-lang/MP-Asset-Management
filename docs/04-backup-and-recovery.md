# Data Protection, Backup and Recovery

## 1. What exists today (Spark / free plan)

| Control | Status |
|---|---|
| **Full data export (JSON)** | Data Integrity → *Download full export*. Admin only, audited, includes every collection and the audit log. Store the file in a restricted company drive folder. |
| **CSV report exports** | Useful for people, but **not a backup**: they don't include IDs of related records, history, users, counters or the audit log. |
| **No hard deletes** | The rules forbid deleting assets, assignments, audit, users and masters, so mistakes are corrected by audited edits, never lost. |
| **Rules version history** | The Firebase console keeps every published rules version and can roll back. |
| **Code history** | The GitHub repository keeps every version of the app and can revert. |

**Minimum routine until Blaze is enabled:** an admin downloads the JSON export **every Friday and on the last working day of each month**. Keep 8 weekly and 12 monthly copies in a folder only IT/Finance admins can open.

## 2. Target strategy (requires the Blaze plan, Q2)

| Layer | Setting | Purpose |
|---|---|---|
| **Point-in-time recovery (PITR)** | Enable on the Firestore database (7-day window) | Undo accidental changes from any minute in the last 7 days |
| **Scheduled managed exports** | Daily `gcloud firestore export` via Cloud Scheduler to a dedicated Cloud Storage bucket in `asia-south1` | Full restorable backups |
| **Retention** | Bucket lifecycle: keep daily copies 35 days, first-of-month copies 13 months, financial-year-end copies 8 years (books-of-account retention) | Policy-driven |
| **Restricted access** | Bucket readable only by a backup service account and 2 named admins; no public access; uniform bucket-level access | Least privilege |
| **Documents (Phase 4)** | Storage bucket with object versioning and soft delete; nightly copy to the backup bucket | Files are protected like data |
| **Restore drills** | Quarterly: import the latest export into a **separate test project** and run the integrity check and reports. Record the date, the duration and the person. | Proves backups work (acceptance test 16) |

## 3. Recovery procedures

**A. A wrong change to a few records** (any plan)
- Open the asset's history or the Audit Log to see the before and after values and the transaction reference.
- Correct it with an audited edit (or Return / Assign).

**B. Larger accidental change, within 7 days** (Blaze + PITR)
- Read the data as of a timestamp with PITR.
- Restore the affected documents (gcloud or a script). This can run against production only with written approval from the system owner.

**C. Full restore** (Blaze)
- `gcloud firestore import gs://<backup-bucket>/<date>` into a **new or empty** database first.
- Verify with the integrity check and reports.
- Switch the app config, or restore into production in a maintenance window.

**D. Restore from a JSON export** (Spark)
- A restore script using the Firebase Admin SDK runs on an admin's PC with a service-account key that is **never** put in the browser or the repository. It will be delivered with Phase 6.
- Until then, the JSON is the record of truth for a manual rebuild.

## 4. Responsibilities (to confirm)

| Task | Owner | Frequency |
|---|---|---|
| Weekly / monthly JSON export (until Blaze) | System admin | Weekly, monthly |
| Review the Data Integrity page | System admin | Monthly |
| Restore drill | IT + Finance | Quarterly |
| Review users and roles (leavers, scopes) | HR + system admin | Monthly |
