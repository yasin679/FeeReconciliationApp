# Fee Reconciliation Desk

A working prototype for matching fee payments to students. It matches each payment to the right student and fee component, has a second person approve it, posts it once and issues one receipt. Money is never counted twice, and nothing is deleted.

Prepared by Yasin Jariwala for the AVP – Product Management assignment, 27 October 2026.

## What's in this repository

| Folder | Contents |
| --- | --- |
| `app/` | **Fee Reconciliation Desk**: an ASP.NET Core 8 (C#) web app with real sign-in for each role. It needs no database server and no NuGet packages. See `app/README.md`. |
| `prototype/` | Single-file HTML prototypes that open in any browser and use no network: `fee-reconciliation-workbench.html` (the assignment walkthrough: gaps, PRD, APM feedback and founder update) and `fee-reconciliation-desk-demo.html` (the Desk with sample data and a role switcher). |
| `deck/` | The 10-slide presentation sources (`project/deck.json` plus one HTML file per slide, each with speaker notes) and the screenshots used on slide 7. |
| `docs/` | User Guide, Setup & Administration Guide and Release Notes v1.0. |
| `reports/` | Retest and security report, and the check of coverage against the assignment (Excel). |
| `tests/` | Browser end-to-end, API security, race and fuzz test scripts (Node + Playwright) used to verify the app and the prototypes. |

## Quick start

**Without installing anything:** open `prototype/fee-reconciliation-desk-demo.html` in a browser.

**The C# app (Windows):**
1. Install the runtime: `winget install Microsoft.DotNet.SDK.8`.
2. In `app/`, run `build.bat`. It builds the app and runs the 27-scenario system check.
3. Run `start.bat`, set an admin password, and open http://localhost:5090.

**Any OS:**

```
cd app/src/FeeReconDesk
dotnet run -- --selftest   # 27 automated scenarios
dotnet run                 # http://localhost:5090
```

## Core rules

- **Five gates in order:** verified → matched → allocated → posted → receipted. A balance changes only for verified money that has been posted.
- **Duplicates:** an import is checked against normalised transaction IDs. A repeated ID with a different amount becomes a conflict and is never counted as money.
- **Two people:** the same individual can't both propose and approve (or request and approve a correction, or report and verify cash). The rule applies by user, not by role.
- **Posting:** each posting is idempotent and safe to retry, with one receipt per allocation line.
- **No deletes:** reversals are linked and capped at the amount remaining. Corrections are written as compensating entries.
- **Audit:** the audit log is hash-chained.
- **Daily control:** verified = posted + pending + unallocated, so the control difference is ₹0.

## Test results (release build)

| Suite | Result |
| --- | --- |
| C# system check | 27 / 27 pass |
| Browser end-to-end | 14 / 14 pass |
| API security checks | 0 of 19 open |
| Concurrency (20 parallel attempts) | 1 posting, 1 receipt |

The prototype shows that the rules hold. It is not production code. See `docs/release-notes-v1.0.md` for known limitations.
