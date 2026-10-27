# Fee Reconciliation Desk – Setup & Administration Guide

Oct 27, 2026 · @Yasin Jariwala

This guide is for administrators who install, configure and support Fee Reconciliation Desk. Day-to-day users should read the User Guide.

## Installing on a Windows laptop

The app needs only Windows 10 or 11 and the ASP.NET Core 8 runtime. It uses no database server and no third-party packages, and runs on the laptop at http://localhost:5090.

| Requirement | Notes |
| --- | --- |
| Windows 10 or 11 | Any edition. Linux and macOS also work with the same runtime. |
| ASP.NET Core 8 runtime | `winget install Microsoft.DotNet.AspNetCore.8`, or the full SDK with `winget install Microsoft.DotNet.SDK.8` (needed only to rebuild from source). |
| The **Fee Reconciliation Desk App** folder | Contains `start.bat`, the ready-built `app` folder, the source in `src`, `build.bat`, `README.md` and `sample-bank-statement.csv`. Also shared as `Fee-Reconciliation-Desk.zip`. |

**First start**

1. Unzip or copy the **Fee Reconciliation Desk App** folder to the laptop.
2. Double-click `start.bat`.
3. At **New admin password**, type a password and press Enter. It is hidden as you type and must have at least 10 characters with three of upper case, lower case, digits and symbols. The console confirms *Admin password set from FRD\_ADMIN\_PASSWORD*.
4. With demo data on, the console also prints one shared demo password in yellow, once, for the nine demo accounts. Copy it now.
5. The browser opens http://localhost:5090. Sign in as `admin`.
6. Keep the black console window open while the app is in use. Closing it stops the app.

On later starts, press Enter at the prompt to keep the current password. If you skip the prompt on the very first start, a temporary admin password is printed once in yellow.

## Going live

The first start with demo data on loads a sample book (students S101–S104, payments P1–P9) and nine demo accounts. For real use:

1. Before the first start, open `app\appsettings.json` and set `"EnableDemoData": false`. If the app has already run with demo data, close it and rename the `app\data` folder first; a new empty book is created on the next start.
2. Start the app, sign in as `admin`, and add one account per person under **Users and roles**. Give each Finance approver their own account: approvals and corrections need two different people.
3. Add students under **Add payments → Add student**, or ask for them to be loaded from the student-management system.
4. Finance imports the bank statement each day under **Add payments → Import bank statement**.

**Bank statement CSV**

The first row holds column names; matching ignores case, spaces and underscores, and common bank names are accepted (`UTR`, `Narration`, `Remitter`, `Mobile`).

| Column | Required | Notes |
| --- | --- | --- |
| TransactionId | Yes | Bank UTR or reference. The duplicate check ignores case, spaces and punctuation. |
| Amount | Yes | Whole rupees; commas and ₹ allowed. Negative = a reversal. Up to ₹10 crore. |
| Date | No | `2026-10-26`, `26-10-2026`, `26/10/2026` or `26-Oct-2026` |
| PayerName, PayerContact | No | Used only to suggest candidates |
| Remark | No | A student ID here (`S101`) matches automatically; `S101 15000 / S104 15000` becomes a split |
| ReversalOf | No | The original TransactionId, for reversals |
| Channel | No | UPI, NEFT, IMPS and so on |

One file holds up to 20,000 rows and 5 MB. `sample-bank-statement.csv` in the app folder shows the format.

## Users, roles and passwords

Administrators manage accounts under **Users and roles**. Each person needs their own account so the audit log and the two-person checks know who did what.

| Task | How |
| --- | --- |
| Add a user | Enter user name, display name and role (for a student, also the student ID), then **Add user**. A temporary password is shown once; share it securely. |
| Change a role | Pick the new role in the user's row. Their open session ends immediately. |
| Disable a user | **Disable** in their row. They are signed out on their next request; their history stays in the audit log. |
| Reset a password | **Reset password** in their row. A new temporary password is shown once, and any lockout is cleared. |
| Change your own password | **Password** at the top right. You are signed out and sign in again. |
| Recover the admin account | Close the app, run `start.bat` and type a new password at the prompt. This also re-enables and unlocks `admin`. |

**Password rules**: at least 10 characters with three of upper case, lower case, digits and symbols. Passwords are stored only as salted PBKDF2-SHA256 hashes (210,000 iterations). After 5 wrong attempts an account is locked for 10 minutes.

**Rules that protect administrators**: you cannot disable your own account or remove your own administrator access. Administrators cannot propose, approve, post or correct money; give a person a Finance role for that.

**Demo accounts** (demo data only): `meera` Operations, `priya` Counsellor, `arjun` Finance reviewer, `kavita` and `rahul` Finance approvers, and students `ananya`, `rohan`, `zara`, `dev` (S101–S104). They share the password printed at first start.

## Settings reference

Matching and allocation policies are changed in the app under **Policy controls** (administrators only), take effect for payments imported afterwards, and are recorded in the audit log. The rest live in `app\appsettings.json` and need a restart.

**In the app (Policy controls)**

| Setting | Default | Meaning |
| --- | --- | --- |
| AM-1 Auto-match on a valid student ID | On | A verified bank line with exactly one valid student ID and no conflicting signal is matched without a person. |
| AA-1 Fee-component allocation order | No policy | With *Admission first, then tuition*, matched payments are allocated and posted automatically. Turn it on only with Finance's written approval. |
| Claims under review per student | 5 | Limits unconfirmed claims and open cases per student. |
| Fail first posting attempt | Off | Demo data only: simulates a student-system timeout to show safe retries. |

**In appsettings.json (restart needed)**

| Setting | Default | Meaning |
| --- | --- | --- |
| `Urls` | `http://localhost:5090` | Address the app listens on. Keep it on localhost unless it sits behind HTTPS. |
| `DataPath` | `data` | Folder for the data file, its backup and the sign-in keys, relative to `app`. |
| `SessionTimeoutMinutes` | 30 | Sign-out after inactivity (5–480). |
| `LoginAttemptsPerMinute` | 30 | Sign-in attempts allowed per network address per minute. Raise it if many staff share one office address. |
| `EnableDemoData` | true | Set to false before the first real start. |
| `BehindProxy` | false | Set to true only behind a trusted reverse proxy that sends X-Forwarded headers. |
| `AllowedHosts` | `localhost;127.0.0.1` | Host names the app answers to. Add the server's name when you host it for others. |

Any setting can also be given as an environment variable of the same name. `FRD_ADMIN_PASSWORD`, set by `start.bat`, resets the admin password at start-up.

## Security, data and backups

The app stores payment metadata, ledgers, receipts, users and the audit log in one file on the machine it runs on. Screenshot files students attach are never uploaded; only the file name is kept.

| Where | What is stored |
| --- | --- |
| `app\data\fee-recon-desk.json` | Students, payments, allocations, ledger, receipts, cases, policy, users (password hashes only) and the audit log |
| `app\data\fee-recon-desk.json.bak` | The previous version of the data file, refreshed on every save |
| `app\data\keys\` | Keys that sign session cookies; encrypted with Windows DPAPI on Windows |
| `app\appsettings.json` / environment variables | Configuration. No secrets are needed in the file. |

**Built-in protections**

- Every action is checked on the server: role, the two-person rule by user, and the money rules. The page only displays.
- Students receive only their own record, ledger, receipts, claims and cases; no other students, college totals, staff names or audit entries. A claim never reveals whether a payment exists until the money is allocated to that student.
- Only Finance can import bank statements. Duplicates, same-ID conflicts and malformed rows never become money.
- Sessions: HttpOnly, SameSite=Strict cookies with a 30-minute idle timeout; disabling a user, changing a role or resetting a password ends their session on the next request.
- Anti-forgery tokens on every change; a strict Content Security Policy; no external web resources; frames, sniffing and referrers blocked.
- Sign-in: same response and similar timing for unknown users and wrong passwords; lockout after 5 failures; rate limit per network address.
- Audit log: append-only and hash-chained. **Audit log → Verify integrity** detects any edited or deleted entry. Refused attempts are recorded too.
- CSV exports neutralise spreadsheet formulas; free text and amounts are length- and range-checked.

**Before shared or production use**

- Run it on a server behind HTTPS (IIS, Azure App Service or a reverse proxy) instead of a laptop, set `BehindProxy` and `AllowedHosts`, and restrict who can reach it.
- Set `EnableDemoData` to false, give everyone a personal account, and keep at least two Finance approvers.
- Back up `app\data` daily: stop the app, or copy `fee-recon-desk.json` and the `keys` folder together. Restoring the keys keeps existing sign-ins valid; without them, users simply sign in again.
- Agree with Finance who may turn on AA-1, since it posts without a person.

## Rebuilding from source and the system check

The source is in `src\FeeReconDesk` (C#, ASP.NET Core 8). It references no NuGet packages, and its `nuget.config` clears all package sources, so it builds without internet access.

1. Install the .NET 8 SDK: `winget install Microsoft.DotNet.SDK.8`.
2. Double-click `build.bat`. It publishes into `app` and then runs the system check.

The system check runs 27 automated scenarios against a fresh in-memory copy of the sample book and never touches live data: duplicates, splits, cash, screenshots, reversals, corrections, retries, concurrency, late registration, the two-person rule, input limits and audit-chain tamper detection. Run it any time with `dotnet app\FeeReconDesk.dll --selftest`, or from **System check** in the app (Finance and administrators).

| Folder | Contents |
| --- | --- |
| `Domain` | Rules engine, data model, sample book, self-tests |
| `Api` | Endpoints, role-filtered snapshots, CSV import and export |
| `Infra` | Data store, password hashing, audit chain, first-start setup |
| `wwwroot` | The screens (HTML, CSS, JavaScript) |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `start.bat` says the ASP.NET Core 8 runtime is not installed | `winget install Microsoft.DotNet.AspNetCore.8`, then open a new window and run `start.bat` again. |
| Admin password unknown, or no temporary password shown | Run `start.bat` and type a new password at the prompt. |
| *Admin password ignored* in the console | The password did not meet the rules; run `start.bat` again with a stronger one. |
| Demo password lost | Sign in as `admin` and **Reset password** for each demo account. |
| Browser shows "can't reach this page" | The console window was closed or the app failed to start. Run `start.bat` and read the console message. |
| "Too many requests" at sign-in | More than `LoginAttemptsPerMinute` attempts from one address; wait a minute or raise the limit. |
| "Too many failed attempts" | The account is locked for 10 minutes; an administrator can **Reset password** to unlock it now. |
| "Security check failed. Reload the page" | The page was open across a restart or a sign-out. Reload it. |
| The app will not start and says the data file could not be read | The file is damaged. Close the app, rename `fee-recon-desk.json` and rename `fee-recon-desk.json.bak` to take its place. |
| Import reports rejected rows | Check those rows have a TransactionId and a whole, non-zero amount up to ₹10 crore. |
| Many payments stuck in *Posting failed* | The demo timeout setting may be on (Policy controls). Click **Retry posting**; it never posts twice. |
| Need to start completely fresh | Close the app and rename the `app\data` folder. A new empty book is created on the next start. |
