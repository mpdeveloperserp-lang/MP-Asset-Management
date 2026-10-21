# Asset Manager: Setup Guide

The app is a static web app (GitHub Pages) on Firebase Auth and Firestore:

- **`index.html`, `css/`, `js/`**: the app. The Firebase project config is in `js/config.js`.
- **`firestore.rules`**: the security rules that enforce the admin, manager, viewer and employee roles on the server.
- **`tests/`, `.github/workflows/tests.yml`**: automated tests, which run in GitHub Actions on every push.
- **`docs/`**: assessment, architecture, Phase 1 deployment and rollback, backup and recovery.

> Already live? Follow **docs/03-phase-1-security-and-integrity.md §5** instead of the first-time steps below.

---

## 1. Create the Firebase project (about 10 minutes)

1. Go to https://console.firebase.google.com, click **Add project** and name it, for example `mp-assets`. Analytics is optional.
2. **Authentication:**
   1. Open Authentication, then **Get started**.
   2. Under Sign-in method, enable **Email/Password**.
3. **Firestore:**
   1. Open Firestore Database, then **Create database**.
   2. Choose **Production mode** and region `asia-south1` (Mumbai).
4. **Rules:**
   1. In Firestore, open the **Rules** tab.
   2. Replace everything there with the contents of `firestore.rules`.
   3. Click **Publish**.
5. **Web app config:**
   1. Go to Project settings, then General, then Your apps.
   2. Click the `</>` icon and register a web app named "Asset Manager". You don't need Firebase Hosting.
   3. Copy the `firebaseConfig` object.
6. Open `js/config.js` and check `firebaseConfig` matches your project (it is pre-filled for `mp-asset-management`). Optionally change `ORG_NAME` and `IDLE_LOGOUT_MIN`.

## 2. Deploy on GitHub Pages

1. Create a repo, for example `mp-assets`, and upload **all files and folders** of the package (keep the folder structure: `index.html` at the top level, with `css/`, `js/`, `tests/`, `docs/` and `.github/` beside it).
2. Go to repo Settings, then Pages. Set Source to **Deploy from a branch**, branch `main`, folder `/root`.
3. Your URL will be `https://<your-github-user>.github.io/mp-assets/`.
4. In Firebase, go to Authentication, then Settings, then **Authorized domains**. Add `<your-github-user>.github.io`.

## 3. First login (bootstrap the admin)

1. In Firebase, go to Authentication, then Users. Click **Add user** and enter your own email and a password.
2. Open the app URL and sign in.
3. The app sees that no admin exists yet and shows **First-time setup**.
4. Enter your name and keep **starter types and departments** ticked. Click **Create admin & continue**.

From then on, the bootstrap option is closed. The rules allow it only while `settings/app` doesn't exist. Do this step right after deploying.

## 4. Order of setup inside the app

1. **Masters → Types & subtypes:**
   - Review the starter list and add your own.
   - Codes become the asset ID prefix. For example, type `ELE` with subtype `LAP` gives `ELE-LAP-0001`.
   - Codes lock once any asset uses them.
2. **Masters → Departments:** review the list.
3. **Masters → Employees:** use **Import CSV** with the columns `empId,name,department,email,active`.
4. **Users:** add managers, viewers and employee logins.
   - Managers need a department.
   - Employee logins need an Employee ID that already exists in the employee master.
5. **Opening Stock:**
   1. Set the cut-off date.
   2. Enter the declared quantity and value per subtype from your books.
   3. Load the individual opening assets with **Assets → Bulk import**, setting `source` to `Opening`.
   4. Once every line shows ✓, click **Approve & lock**.
6. After that, every new asset is a **New addition**, added one at a time or by bulk import with `source` set to `Purchase`.

---

## 5. Worked example: one laptop through its full life

Setting: cut-off date **31-Mar-2026**. Your books say Electronics › Laptop has **2 laptops worth ₹1,37,000**.

**Step 1: Declare the opening total.**
1. Go to Opening Stock, find the row Electronics › Laptop, and enter Declared qty `2` and value `137000`.
2. Click **Save declared totals**.
3. The row shows a variance of 2 units and ₹1,37,000, because no records exist yet.

**Step 2: Record the individual laptops.**
1. Go to Assets → **Bulk import** → **⬇ Download Excel template**.
   - The template is built from your live Masters.
   - Its columns are exactly the fields of the Add-asset form.
   - Type, Subtype, Tracking, Vendor, Location, Source, Department and Employee ID are dropdowns of Masters values. The Subtype list only shows subtypes of the Type you picked.
2. On the **Assets** sheet, fill two rows:

| Type * | Subtype * | Asset name * | Tracking | Quantity | Serial number | Vendor | Purchase date | Unit cost | Location | Source | Department | Employee ID | Assignment date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Electronics | Laptop | Dell Latitude 5440 | Individual | 1 | DL5440-8812 | Redington | 12-06-2024 | 68500 | Head Office | Opening balance | Sales | E1023 | 15-06-2024 |
| Electronics | Laptop | Dell Latitude 5440 | Individual | 1 | DL5440-9035 | Redington | 12-06-2024 | 68500 | Head Office | Opening balance | | | |

3. Save the file and upload it with **⬆ Choose filled file**.
   - Every row is checked against Masters before anything is saved.
   - The preview shows **2 ready**. Click **Import 2 rows**.
4. The app creates:
   - **ELE-LAP-0001**, assigned to employee E1023 (Priya, Sales) since 15-Jun-2024.
   - **ELE-LAP-0002**, In Stock.
5. Back on Opening Stock, the Laptop row now shows ✓ ✓. Click **Approve & lock**.

**Exact-match rules for the upload**
- **Columns:** the headers must be the template's headers. If any column is unknown, missing (a required one), or repeated, nothing is imported.
- **Master values:** Type, Subtype, Vendor, Location, Department and Employee ID must match Masters character for character. For example, `electronics` or `Securetech systems` is rejected, and the error names the correct spelling: *must be written exactly as in Masters: "SecureTech Systems"*.
- **Subtype:** must belong to the chosen Type.
- **Status checks:** inactive types, vendors, locations and departments are rejected, and so are exited employees. An employee must also belong to the given Department.
- **Tracking:** with *Individual* the Quantity must be 1 (one row per unit). *Lot* takes a quantity.
- **Serial numbers:** must be unique, both within the file and against existing assets. Leading zeros are kept.
- **Error report:** rows with errors are skipped, and **⬇ Error report** lists each one. Fix those rows and upload them again.
- **Stale templates:** if you add a vendor, location or subtype, download a fresh template so its dropdowns include it.

**Step 3: Transfer.** Priya moves to Finance on 01-Oct-2026.
1. Open ELE-LAP-0001 and click **Transfer**.
2. Choose Department `Finance`, Employee `Priya Raman (E1023)`, date `01-10-2026`, expected return blank.
3. The result:
   - The Sales assignment closes with end date 01-Oct-2026 and reason "Transfer".
   - A new Finance assignment opens.
   - Both appear in the asset's **Assignment history** and in **Reports → Transfer history**.

**Step 4: Short-term loan.** Lend the spare to Karthik (E1107, Engineering) for a site audit.
1. Open ELE-LAP-0002 and click **Assign**.
2. Choose Engineering and Karthik, date `05-10-2026`, expected return `12-10-2026`.
3. On 16-Oct-2026 it hasn't come back, so:
   - The Dashboard shows **Overdue returns: 1**.
   - Reports → Due for return shows it as "Overdue 4d".
4. When Karthik returns it, click **Return** with condition `Fair` and next status `Back to stock`.

**Step 5: Depreciation check** for ELE-LAP-0001: cost ₹68,500, life 3 years, salvage 0, purchased 12-Jun-2024.
- Monthly charge = 68,500 ÷ 36 = **₹1,902.78**.
- In Reports → Depreciation, FY 2025-26:
  - Opening NBV (as at 31-Mar-2025, 9 full months) = 68,500 − 17,125 = **₹51,375**.
  - Charge for the year = 12 months × 1,902.78 = **₹22,833**.
  - Closing NBV (as at 31-Mar-2026, 21 months) = **₹28,542**.

**Step 6: Disposal.** The laptop dies on 10-Jun-2027, so an admin opens it and clicks **Dispose**.
1. Set reason `Damaged beyond repair`, method `E-waste recycler`, recovery `₹2,000`.
2. The dialog shows NBV on that date: 35 months gives ₹1,903.
3. Reports → Disposal log records a gain of **₹97** (2,000 − 1,903), approved by the admin.
4. The asset record is kept. Only its status changes to Disposed.

---

## 5A. Locations: adding a lot of 55 CCTV cameras, each with its own serial and location

**Set up locations first.** In **Masters → Locations**, add each site or office, for example:
- Head Office
- Project – Tower A
- Project – Tower B

The exact spot, such as a floor, gate or pole, is not a location. It goes in each asset's **Position** field.

**Option 1: In the app**
1. Go to Assets → **＋ Add asset**.
2. Choose Type `Electronics`, Subtype `CCTV Camera`, and name `Hikvision 2MP Dome Camera`.
3. Enter purchase date `10-10-2026`, unit cost `3200` and invoice `INV-4410`.
4. Set Tracking to **Individual** and Number of units to `55`.
5. A **Unit details** grid with 55 rows appears, with Serial number, Location and Position columns.
6. Either type in each row, or click **⧉ Paste from Excel**. In Excel, select the three columns (Serial, Location, Position) for all 55 rows, copy them, paste into the box, and click **Fill rows**:
   ```
   K12345601   Head Office          Main gate – pole 1
   K12345602   Head Office          Reception
   K12345603   Project – Tower A    Basement P1 ramp
   …
   ```
   Location names must match Masters exactly. Any row whose location isn't found falls back to the default location, and the screen tells you how many.
7. Click **Add asset**. This creates **ELE-CAM-0001 … ELE-CAM-0055**, each with its own serial, location, position and history.
8. The app blocks a duplicate serial, either inside the grid or against existing assets. Blank serials or locations trigger a warning first.

**Option 2: Bulk import Excel.** Download the template and fill 55 rows: Type `Electronics`, Subtype `CCTV Camera`, Tracking `Individual`, Quantity `1`, plus each camera's own **Serial number**, **Location** (dropdown) and **Position / sub-location**. The template's Instructions sheet shows two camera rows as a worked example.

**Moving a camera later.** Open the asset, click **Edit**, and change the Location and Position. The activity log records it as *Relocate: Head Office · Reception → Project – Tower A · Lift lobby*.

**Seeing it location-wise.**
- **Reports → Location-wise:** units and value for each location and subtype. For example, Head Office › CCTV Camera shows 27 units worth ₹86,400.
- **Reports → Location register:** every unit with its serial and position. Filter Location = `Project – Tower A` and Subtype = `CCTV Camera`, then click **Print / PDF** to get a checklist for physical verification.
- **Assets page:** use the location filter. The Dashboard also has a *Units by location* chart.

---

## 5B. Vendors and warranty

**Add vendors.** In **Masters → Vendors**, add each supplier, or use **Import CSV** to load many at once. Each vendor record has:
- name
- code
- what they supply
- contact person, phone and email
- GSTIN and PAN, checked for the correct format
- address and city
- payment terms
- service or AMC notes

**Example**
1. Add the vendor *SecureTech Systems*:
   - Supplies: `CCTV, access control`
   - Contact: `R. Karthik, 98400 12345`
   - GSTIN: `33AABCS1234F1Z5`
2. While adding the 55 cameras, choose Vendor **SecureTech Systems** and set Warranty valid until to `10-10-2027`.
   - Admins can also click **＋ new vendor** inside the asset form. That creates the vendor and returns to the form with it selected.
3. Opening any camera then shows the vendor's contact under *Vendor / invoice*, plus a warranty badge: *In warranty*, *Warranty ends in 34d*, or *Warranty expired*.
4. **Reports → Vendor-wise** shows:
   - SecureTech Systems with 55 units and a purchase value of ₹1,76,000
   - the number of invoices
   - how many units are still in use and still in warranty
   - the last purchase date

   Use the purchase-date filter to see one financial year.
5. **Reports → Warranty expiry**: choose a window of 30, 60, 90, 180 or 365 days. The report lists every asset whose warranty ends in that window, or has already ended, along with the vendor contact. Use it to raise claims or renew AMCs in time.

**Bulk import:** the **Vendor** column is a dropdown of Masters → Vendors, and **Warranty valid until** takes a date.

---

## 6. How the spec maps to the app

| Spec item | Where it lives |
|---|---|
| Type / subtype master | Masters → Types & subtypes (`types` collection, subtypes as an array) |
| Asset fields and status | `assets/{assetId}`. Statuses: In Stock, Assigned, Under Repair, Lost – Pending Review, Disposed |
| Opening stock | Declared totals in `openingStock`, records with `source: "Opening"`, lock flag in `settings/app` |
| Current stock | Opening + Additions − Disposed − Lost (Reports → Stock summary) |
| Department → employee assignment | `asset.current` plus one `assignments` doc per period. Transfers close the old period and open a new one |
| Locations | Masters → Locations (`locations` collection). Each asset has `location` (from master) + `locationDetail` (position) |
| Vendors & warranty | Masters → Vendors (`vendors` collection). Each asset stores `vendor` (from master), `invoice`, `warrantyUntil` |
| Unknown holder | "In use, holder unknown" checkbox, or `holderUnknown=Y` in import. Flagged **Unassigned** |
| Missing cost or date | Flagged **Data Incomplete** and excluded from depreciation |
| Employee exit | Untick Active on the employee. Their assets are flagged "Held by Exited Employee" |
| Audit trail | `audit` collection, append-only (rules block update and delete). Shows old → new values per field |
| No hard deletes | Rules deny delete on assets, assignments, employees, users and audit |

**Roles**

| Role | Can do |
|---|---|
| Admin | Everything, including masters, users, opening lock and disposals |
| Manager | Only within the **departments and locations ticked on their user profile**: add/import assets, assign, transfer, return, repair, mark lost. Cannot change cost, dates, quantity, serial, life or salvage; cannot dispose or resolve a lost asset |
| Viewer | Read-only access to the dashboard, assets and reports |
| Employee | **My Assets** only. The rules return only assets whose current holder is their own Employee ID |

## 7. Notes and limits

- **Audit authorship:** the browser writes audit entries in the same atomic batch as the change. The rules make entries append-only and tie each one to the signed-in user. For fully tamper-proof logging, move audit writes to a Cloud Function trigger.
- **Data loading:** the app loads all assets and assignments in real time. That's fine for a few thousand records. For tens of thousands, add paging.
- **Lot quantities:** a lot record (for example, 25 chairs) is assigned as a whole. To issue chairs individually, create them as individual units.
- **Password resets:** "Reset password" on the Users page sends Firebase's standard reset email.
