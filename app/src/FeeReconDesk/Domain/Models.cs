namespace FeeReconDesk.Domain;

// Field names serialise in camelCase and match the browser engine, so the same screens render either backend.

public sealed class Obligation
{
    public string Id { get; set; } = "";
    public string Comp { get; set; } = "";
    public long Due { get; set; }
}

public sealed class Student
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Contact { get; set; } = "";
    public string Guardian { get; set; } = "";
    public List<Obligation> Obligations { get; set; } = new();
}

public sealed class Candidate
{
    public string Sid { get; set; } = "";
    public string Conf { get; set; } = "Low";
    public List<string> Reasons { get; set; } = new();
    public string? Basis { get; set; }
}

public sealed class Note
{
    public string By { get; set; } = "";
    public DateTimeOffset At { get; set; }
    public string Text { get; set; } = "";
}

public sealed class CashEvidence
{
    public string Sid { get; set; } = "";
    public string ReceiptBook { get; set; } = "";
    public string DepositRef { get; set; } = "";
    public string By { get; set; } = "";
    public DateTimeOffset At { get; set; }
}

public sealed class ReversalInfo
{
    public string? OriginalId { get; set; }
    public string State { get; set; } = "awaiting_approval";
    public string Reason { get; set; } = "";
    public string? Approver { get; set; }
    public string? Note { get; set; }
}

public sealed class SplitLine
{
    public string Sid { get; set; } = "";
    public long Amount { get; set; }
}

public sealed class Txn
{
    public string Id { get; set; } = "";
    public string Source { get; set; } = "";          // bank | cash | upload
    public string SourceTxnId { get; set; } = "";
    public string ReversalOfRef { get; set; } = "";
    public string Channel { get; set; } = "";
    public long Amount { get; set; }
    public string PayerName { get; set; } = "";
    public string PayerContact { get; set; } = "";
    public string Remark { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; }
    public DateTimeOffset IngestedAt { get; set; }
    public string Batch { get; set; } = "";
    public string Kind { get; set; } = "payment";     // payment | reversal | cash | claim
    public string Verification { get; set; } = "verified"; // verified | pending | not_found | linked | duplicate
    public string VerificationNote { get; set; } = "";
    public string? DuplicateOf { get; set; }
    public bool IdConflict { get; set; }
    public bool ConflictClosed { get; set; }
    public List<Candidate> Candidates { get; set; } = new();
    public string? Matched { get; set; }
    public string MatchBasis { get; set; } = "";
    public List<SplitLine>? Split { get; set; }
    public string? Exception { get; set; }
    public List<string> Flags { get; set; } = new();
    public string? Hold { get; set; }
    public List<Note> Notes { get; set; } = new();
    public long ReversedApplied { get; set; }
    public ReversalInfo? Reversal { get; set; }
    public string? UnknownRef { get; set; }
    public string? StudentHint { get; set; }
    public string ClaimedUtr { get; set; } = "";
    public string Screenshot { get; set; } = "";
    public string? LinkedClaim { get; set; }
    public List<string> LinkedClaims { get; set; } = new();
    public string? LinkedBankTxn { get; set; }
    public CashEvidence? CashEvidence { get; set; }
    public string? ReportedBy { get; set; }
    public int Version { get; set; }
}

public sealed class Proposal
{
    public string Id { get; set; } = "";
    public string TxnId { get; set; } = "";
    public string Proposer { get; set; } = "";
    public string Status { get; set; } = "proposed"; // proposed | approved | post_failed | posted | rejected
    public string Reason { get; set; } = "";
    public string Evidence { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public List<string> AllocIds { get; set; } = new();
    public string Note { get; set; } = "";
    public string? Approver { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public bool FailedOnce { get; set; }
}

public sealed class CorrectionRequest
{
    public string By { get; set; } = "";
    public string Reason { get; set; } = "";
    public DateTimeOffset At { get; set; }
}

public sealed class Allocation
{
    public string Id { get; set; } = "";
    public string TxnId { get; set; } = "";
    public string PropId { get; set; } = "";
    public string Sid { get; set; } = "";
    public string Comp { get; set; } = "";
    public long Amount { get; set; }
    public long Reversed { get; set; }
    public string Status { get; set; } = "proposed";
    public bool Overpay { get; set; }
    public DateTimeOffset? PostedAt { get; set; }
    public CorrectionRequest? CorrReq { get; set; }
    public string? CorrectedBy { get; set; }
    public string? CorrectionReason { get; set; }
    public string? CorrectionRequestedBy { get; set; }
}

public sealed class LedgerEntry
{
    public string Id { get; set; } = "";
    public string Key { get; set; } = "";
    public string Sid { get; set; } = "";
    public string Comp { get; set; } = "";
    public long Amount { get; set; }
    public string Type { get; set; } = "payment"; // payment | reversal | correction
    public string TxnId { get; set; } = "";
    public string? OrigTxnId { get; set; }
    public string AllocId { get; set; } = "";
    public DateTimeOffset Ts { get; set; }
}

public sealed class ReceiptAdjustment
{
    public string No { get; set; } = "";
    public long Amount { get; set; }
    public string RevId { get; set; } = "";
}

public sealed class Receipt
{
    public string No { get; set; } = "";
    public string AllocId { get; set; } = "";
    public string Sid { get; set; } = "";
    public string TxnId { get; set; } = "";
    public string Comp { get; set; } = "";
    public long Amount { get; set; }
    public string Status { get; set; } = "issued"; // issued | adjusted | cancelled
    public DateTimeOffset IssuedAt { get; set; }
    public List<ReceiptAdjustment> Adjustments { get; set; } = new();
    public string? CancelReason { get; set; }
}

public sealed class MismatchCase
{
    public string Id { get; set; } = "";
    public string Sid { get; set; } = "";
    public string Ref { get; set; } = "";
    public string Text { get; set; } = "";
    public string Status { get; set; } = "open";
    public DateTimeOffset At { get; set; }
    public string Resolution { get; set; } = "";
    public string? ResolvedBy { get; set; }
}

public sealed class AuditEvent
{
    public long Id { get; set; }
    public DateTimeOffset Ts { get; set; }
    public string Actor { get; set; } = "";
    public string Person { get; set; } = "";
    public string Role { get; set; } = "";
    public string Action { get; set; } = "";
    public string Entity { get; set; } = "";
    public string Txn { get; set; } = "";
    public string Detail { get; set; } = "";
    public string Result { get; set; } = "ok"; // ok | denied | blocked | failed
    public string PrevHash { get; set; } = "";
    public string Hash { get; set; } = "";
}

public sealed class Policy
{
    public bool AutoMatch { get; set; } = true;
    public string ComponentPolicy { get; set; } = "none"; // none | admission-first
    public bool SmsFail { get; set; }                      // demo only: simulate a student-system timeout
    public int MaxOpenClaims { get; set; } = 5;
    public long AdmissionFee { get; set; } = 25000;
    public long TuitionFee { get; set; } = 120000;
}

public sealed class Counters
{
    public int Prop { get; set; }
    public int A { get; set; }
    public int L { get; set; }
    public int R { get; set; }
    public int C { get; set; }
    public int Adj { get; set; }
    public long Au { get; set; }
}

public sealed class User
{
    public string Id { get; set; } = "";
    public string UserName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "ops";
    public string? StudentId { get; set; }
    public bool Enabled { get; set; } = true;
    public string PasswordHash { get; set; } = "";
    public string Salt { get; set; } = "";
    public int Iterations { get; set; } = 210000;
    public int FailedCount { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public string Stamp { get; set; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastSignIn { get; set; }
}

public sealed class AppState
{
    public int SchemaVersion { get; set; } = 1;
    public List<Student> Students { get; set; } = new();
    public List<Txn> Txns { get; set; } = new();
    public List<Allocation> Allocs { get; set; } = new();
    public List<Proposal> Proposals { get; set; } = new();
    public List<LedgerEntry> Ledger { get; set; } = new();
    public List<Receipt> Receipts { get; set; } = new();
    public List<AuditEvent> Audit { get; set; } = new();
    public List<MismatchCase> Cases { get; set; } = new();
    public Policy Settings { get; set; } = new();
    public Counters N { get; set; } = new();
    public List<User> Users { get; set; } = new();
}

/// <summary>Who is acting. Separation-of-duties checks compare UserId, so two approvers are two people.</summary>
public sealed record Actor(string UserId, string Name, string Role, string? StudentId = null)
{
    public static readonly Actor System = new("system", "System", "system");
    public static readonly Actor Policy = new("policy:AA-1", "Allocation policy AA-1", "system");
}

public sealed record Result(bool Ok, string? Error = null, object? Data = null)
{
    public static Result Success(object? data = null) => new(true, null, data);
    public static Result Fail(string error) => new(false, error);
}

public sealed record AllocLine(string Sid, string Comp, long Amount);

public sealed record BankEvent(string SourceTxnId, long Amount, string Channel = "", string PayerName = "", string PayerContact = "",
    string Remark = "", string ReversalOf = "", string Batch = "", DateTimeOffset? ReceivedAt = null, string? Ref = null);
