# Fee Reconciliation Desk – Release Notes v1.0

Oct 27, 2026 · @Yasin Jariwala

Version 1.0 is the first release: a C# (ASP.NET Core 8) web app that runs on a Windows laptop with no database server and no third-party packages, plus a web preview with sample data.

## What's in 1.0

| Area | What it does |
| --- | --- |
| Bank statement import | Finance imports a CSV from the college bank account. Duplicates (case, spacing and punctuation ignored), same-ID-different-amount conflicts and malformed rows never become money. |
| Automatic matching | A valid student ID in the bank reference matches without a person (policy AM-1). Split notes such as `S101 15000 / S104 15000` are read into allocation lines. Names and phone numbers only suggest candidates, with the reason shown. |
| Unmatched-payment queue | Every payment needing a person, with verification state, candidates, status, next action, owner and age; tiles and filters by stage. |
| Allocation and approval | Lines by student and fee component, never more than received; evidence required for non-ID matches; approval by a different Finance approver; overpayments need an approval note. |
| Posting and receipts | Written once with an idempotency key, safe to retry after a student-system timeout; one receipt per posted line. |
| Reversals | Linked to the original bank payment, capped at what remains, applied by a Finance approver; the original keeps its amount and the receipt shows the adjustment. Exceptions can be re-linked or closed with a note. |
| Corrections | Requested by one person, approved by a different Finance approver; a compensating entry, the original line kept, the receipt cancelled with the reason. |
| Cash | Reported by a counsellor, evidenced with receipt-book and deposit-slip numbers, verified by Finance; the reporter cannot verify it. |
| Student portal | Own fee ledger, receipts, payment claims with UTR and screenshot, mismatch cases and replies. |
| Administration | Users and roles, policy controls, audit log with integrity check, reconciliation CSV export, built-in system check, sample data reset. |
| Books check | Verified money = posted + awaiting approval + unallocated, shown on the Overview; the control difference stays ₹0. |

## Security and quality

Every suite below passed on the release build, run on 27 Oct 2026.

| Suite | Scope | Result |
| --- | --- | --- |
| Built-in system check (C#) | 27 scenarios on a fresh sample book: duplicates, splits, cash, screenshots, reversals, corrections, retries, stale edits, late registration, two-person rule, input limits, audit tamper detection | 27 of 27 pass |
| End-to-end in a browser | 14 journeys signed in as each real role against the running server, including import, approvals, reversal, correction, cash, user admin and persistence | 14 of 14 pass, 0 page errors |
| API attack suite | 19 checks: anonymous access, file traversal, request forgery, cookie flags, student data isolation, 11 role-escalation attempts, two-person rule, session revocation, lockout, sign-in timing, malformed input, stored script injection, CSV formula injection, headers, host and method tampering, audit chain, secrets at rest | 0 findings open |
| Concurrency | 20 simultaneous proposals and parallel approvals on one ₹25,000 payment | 1 proposal, 1 approval, 1 posting, 1 receipt |
| Sign-in rate limit | 35 rapid attempts from one address | Attempts 31 onwards refused |
| Web preview | 27 live scenarios, injection and data-leak checks, network capture | All pass; the page makes no network requests |

Issues found and fixed during release testing included a sign-in error shown as "server could not be reached", a user form that lost typed input, a sign-in timing difference that revealed which user names exist, a server error on malformed requests, and sign-in checks that could stall other users during a burst of attempts.

## Known limitations and next steps

- **Single machine.** Data lives in one file on the machine running the app. For shared use, host it on a server behind HTTPS and back up `app\data` daily.
- **No live bank or student-system connection.** Bank money arrives through CSV import and students through manual entry; postings are recorded in the app's own ledger. A bank API, virtual accounts per student and a student-system posting connector are the next candidates.
- **Refund payouts are out of scope.** Reversals record money the bank returned; paying refunds is a separate Finance process.
- **Policy changes are single-person.** An administrator changes AM-1 and AA-1 alone, with the change audited; a Finance sign-off step for policy changes is planned.
- **Receipts are on-screen.** A PDF receipt with the institution's letterhead is planned.
- **Fee amounts are fixed per component** (Admission ₹25,000, Tuition ₹1,20,000 in the sample book) rather than loaded per student from the student system.
- **Not yet tested on Windows by a user.** The build was verified on Linux with the same .NET 8 runtime; run the first session on the sample data and the system check.
