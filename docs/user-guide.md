# Fee Reconciliation Desk – User Guide

Oct 27, 2026 · @Yasin Jariwala

Fee Reconciliation Desk matches every fee payment to the right student and fee, gets it approved by a second person, posts it once and issues one receipt. This guide is for the people who use it day to day; administrators should also read the Setup & Administration Guide.

## Signing in and roles

Open http://localhost:5090 (or the address your administrator gives you) and sign in with your own user name and password. After 5 wrong passwords the account is locked for 10 minutes, and you are signed out after 30 minutes without activity. Use **Password** at the top right to change your password.

| Role | What you do |
| --- | --- |
| Operations executive | Work the unmatched queue, propose allocations, request evidence, request corrections, resolve student cases |
| Counsellor | Report cash collected at the desk and attach the receipt-book and deposit-slip evidence |
| Finance reviewer | Import bank statements, verify cash deposits, close bank-data conflicts, propose allocations, read the audit log |
| Finance approver | Everything a reviewer does, plus approve or reject allocations, apply reversals and approve corrections |
| Administrator | Users and roles, policy controls, system check, audit log. Cannot move money. |
| Student | Own fee ledger and receipts, submit payment details, raise a mismatch case |

The two-person rule applies to people, not roles: whoever proposes an allocation, requests a correction or reports cash can never approve or verify it, even if they hold a Finance role.

## How a payment moves

A payment passes five gates in order. A student's balance changes only at gate 4, and only for money that passed gate 1.

1. **Verified.** The money appears in the bank statement Finance imports, or Finance has matched a cash deposit to the bank statement and cashbook. A screenshot or a counsellor's word is never verification.
2. **Matched.** A valid student ID in the bank reference (for example `S101`) matches automatically. A payer name or phone number only suggests a candidate.
3. **Allocated.** Operations proposes how the money splits across students and fee components (Admission, Tuition). Lines can never total more than was received.
4. **Posted.** A Finance approver who is not the proposer approves, and the ledger is written exactly once, even if the student-management system times out and the posting is retried.
5. **Receipted.** One receipt per posted line. Reversals and corrections adjust or cancel it; the receipt number never changes and nothing is deleted.

The **Overview** page shows the books check: verified money always equals posted + awaiting approval + not yet allocated. The control difference must read ₹0.

## Operations: working the queue

**Unmatched payments** lists every payment that needs a person, with its verification state, candidate students, status, next action and owner. Click a tile or a filter chip to narrow the list; click a row to open it.

**Allocate a payment**

1. Open the payment. The left column shows the bank record, verification, duplicate check and candidate students with the reason for each.
2. In **Allocate**, pick the student, the fee component and the amount on each line. Use **Add line** to split one payment across students or components. Split instructions in the bank remark (for example `S101 15000 / S104 15000`) are filled in for you.
3. Write a reason. If a student has no verified identifier on this payment (a name or phone match only), the **Corroborating evidence** box appears and is required: say what proves the link, such as a remittance advice or a guardian confirmed on the registered number.
4. When every check in the list is green, click **Propose allocation**. A Finance approver who is not you approves it.

**When you cannot allocate yet**

- **Request evidence** records what you asked the payer for and marks the payment *Waiting on payer*.
- **Escalate to Finance** hands it to a Finance reviewer.
- **Retry student lookup** re-checks a payment whose student ID was not registered yet, once the registration arrives.
- **Re-check bank feed** looks again for a student-reported UTR in the imported bank records.

**Fix a posted allocation**: in the payment's approval panel, click **Request correction…** on the line and give the reason. A Finance approver who is not you approves it; the original line stays visible, a compensating entry is written and the money returns to unallocated.

**Student cases**: open cases appear under the queue. Type the reply the student will see and click **Resolve**.

## Finance: imports, approvals and exceptions

**Import a bank statement** (Finance reviewer or approver): click **Add payments** → **Import bank statement**, choose the CSV exported from the college bank account and click **Import**. The file needs `TransactionId` and `Amount`; `Date`, `Channel`, `PayerName`, `PayerContact`, `Remark` and `ReversalOf` are optional, and reversals carry a negative amount. Re-importing a file is safe. The result line counts new payments, duplicates skipped, ID conflicts and rejected rows (a missing ID, text in the amount, zero, or more than ₹10 crore).

**Approve or reject** (Finance approver): open a payment showing *Awaiting approval*, read the lines, reason and evidence, then **Approve and post** or **Reject** with a reason. If a line is more than the fee outstanding, the approval note must say how the overpayment is treated. If the student system times out, nothing is written; click **Retry posting**, which can never post twice.

**Verify cash** (Finance reviewer or approver): open a cash record with evidence attached, check the deposit slip against the bank statement and the cashbook, tick the confirmation and click **Verify deposit**. Whoever reported or evidenced the cash cannot verify it.

**Reversals** (Finance approver): a negative bank line linked to its original payment waits as *Reversal — awaiting approval* and shows what it will take off. **Apply reversal** writes a linked negative entry and marks the receipt adjusted; the original payment keeps its full amount. A reversal larger than what is left, or pointing at a duplicate or at cash, is a *Reversal exception*: confirm with the bank, then **Re-check link to original** or **Close without applying** with a note.

**Same ID, different amount**: a bank line that repeats an existing transaction ID with another amount is never counted as money. Confirm the correct line with the bank and click **Keep … and close** with what the bank said.

**Corrections** (Finance approver): approve or reject correction requests raised by Operations. You cannot approve a correction you requested.

**Audit log** (Finance and Administrator): every action, sign-in and refused attempt. **Verify integrity** checks the hash chain; **Export reconciliation (CSV)** downloads one row per payment with the control difference at the foot.

## Counsellors: reporting cash

Cash stays out of every balance until Finance has matched it to a bank deposit.

1. Click **Add payments** → **Report cash collection**, enter the amount, the student and a note, and click **Record cash report**.
2. On the cash record that opens, choose the student, enter the cash receipt-book number and the bank deposit-slip reference, and click **Submit evidence to Finance**.
3. A Finance reviewer verifies the deposit. You cannot verify your own collection. Once verified, Operations allocates it like any other payment.

## Students: your fee ledger

Sign in to see **My fee ledger**: what is due for Admission and Tuition, what has been recognised, the posted entries and your receipts. Only payments that are verified, allocated and posted count. Anything still being checked appears under **Being checked** and does not reduce what you owe yet.

**Tell us about a payment** if you paid but the payment is not shown. Enter the UTR or transaction reference from your UPI app or bank statement (required), the amount, who paid if not you, and optionally a screenshot. It shows as *Under review* until it is confirmed and allocated to you; a screenshot alone cannot confirm a payment. You can have up to 5 payments under review at a time.

**Something looks wrong** raises a case with Operations. Give the payment or receipt reference if you have one. The reply appears under **My cases**.

**Receipts**: click **View receipt** to see the receipt number, payment reference, amount and any adjustment. An adjusted receipt shows the amount still recognised; a cancelled one shows why.

## Statuses and messages

| Status | Meaning | Who acts |
| --- | --- | --- |
| Matched — choose fee component | Student known from a valid ID in the reference; needs Admission or Tuition | Operations |
| Split — propose lines | Bank remark splits the money across students | Operations |
| Strong candidate — confirm and allocate | A student claim with the same UTR and amount points to one student | Operations |
| Candidate — needs evidence | Only a name or phone resembles a student | Operations |
| Unmatched — no identifier | Nothing links the payment to anyone | Operations |
| Reference not in student system | The ID in the remark is not registered yet | Operations, after registration |
| Cash — unverified / evidence with Finance | Reported cash, before or after evidence | Counsellor, then Finance reviewer |
| Claim — not in bank records | A student report with no matching bank line yet | Operations |
| Awaiting approval | A proposal waits for a second person | Finance approver |
| Posting failed — retry | The student system timed out; nothing was written | Anyone who can retry |
| Reversal — awaiting approval / exception | A bank reversal to apply, or one that cannot be applied | Finance approver |
| Same ID, different amount | A repeated bank ID with another amount | Finance reviewer |
| Duplicate — not posted | A re-imported line; kept for history only | No one |
| Allocated and posted | Done | No one |

| Message | What to do |
| --- | --- |
| Lines total ₹X but only ₹Y is unallocated | Reduce a line; part of the money is already proposed or posted |
| … has no verified identifier on this payment | Record the corroborating evidence |
| Separation of duties: … cannot approve it | Ask another Finance approver |
| This payment changed while you were editing | Someone else acted on it; the form has reloaded, check and propose again |
| Funds changed after this proposal | Reject the proposal and propose again |
| Your session ended | Sign in again; your role may have changed |
