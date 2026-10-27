# Fee Reconciliation Desk 1.0

Matches fee payments received by bank transfer, UPI, cash and student-reported transfers to the right student and fee, with
two-person approval, one posting and one receipt per allocation, linked reversals and a tamper-evident audit log.

## Start

1. Install the ASP.NET Core 8 runtime if needed: `winget install Microsoft.DotNet.AspNetCore.8`
2. Double-click `start.bat`.
3. Type a new admin password at the prompt (at least 10 characters, three of upper case, lower case, digits, symbols).
4. The browser opens http://localhost:5090. Sign in as `admin`.

Keep the console window open while the app is in use. On later starts, press Enter at the prompt to keep the current password.

## Demo data

With `EnableDemoData` on (the default) the first start loads a sample book (students S101–S104, payments P1–P9) and nine demo
accounts that share one password, printed once in the console in yellow:

| User | Role |
|---|---|
| meera | Operations executive |
| priya | Counsellor |
| arjun | Finance reviewer |
| kavita, rahul | Finance approvers (two, so approvals can be tested by different people) |
| ananya, rohan, zara, dev | Students S101–S104 |

Set `"EnableDemoData": false` in `app\appsettings.json` before the first start for real use.

## Folders

| Path | What it is |
|---|---|
| `app\` | Ready-built application. `app\data\` is created on first start and holds the data file, its backup and sign-in keys. |
| `src\FeeReconDesk\` | C# source (ASP.NET Core 8, no third-party packages). |
| `build.bat` | Rebuilds `app\` from source and runs the system check. Needs the .NET 8 SDK. |
| `sample-bank-statement.csv` | Example bank statement for Add payments → Import bank statement. |

## System check

`dotnet app\FeeReconDesk.dll --selftest` runs 27 automated checks of every financial and security control against a fresh
in-memory copy of the sample book. Finance and admin users can also run it from **System check** in the app.

## Security summary

- Sign-in with salted PBKDF2-SHA256 password hashes; lockout after 5 wrong passwords; 30-minute idle timeout.
- Permissions are enforced on the server for every action. Students only ever receive their own data.
- Two-person rule by user: proposer ≠ approver, correction requester ≠ approver, cash reporter ≠ verifier.
- Only Finance can import bank statements; duplicates and same-ID conflicts never become money.
- Anti-forgery tokens, SameSite=Strict HttpOnly cookies, strict Content Security Policy, no external web resources.
- Hash-chained audit log (Audit log → Verify integrity). CSV exports neutralise spreadsheet formulas.

See the Setup & Administration Guide for configuration, HTTPS hosting and backups.
