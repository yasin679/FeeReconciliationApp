namespace FeeReconDesk.Domain;

/// <summary>Product QA suite. Runs on fresh in-memory copies of the demo book; never touches live data.</summary>
public static class SelfTests
{
    public sealed record Check(string Description, bool Passed);
    public sealed record TestResult(string Id, string Ac, string Name, bool Pass, List<Check> Checks, string? Error);

    static readonly Actor Ops = new("u-ops", "Meera J.", "ops");
    static readonly Actor Cou = new("u-counsellor", "Priya S.", "counsellor");
    static readonly Actor Rev = new("u-finrev", "Arjun K.", "finrev");
    static readonly Actor App = new("u-finapp", "Kavita R.", "finapp");
    static readonly Actor App2 = new("u-finapp2", "Rahul P.", "finapp");
    static readonly Actor Adm = new("u-admin", "Administrator", "admin");
    static Actor Stu(string sid) => new("u-" + sid.ToLowerInvariant(), sid, "student", sid);

    static (AppState s, Engine e) Fresh(Action<Policy>? p = null)
    {
        var pol = new Policy(); p?.Invoke(pol);
        var s = Demo.Build(pol); return (s, new Engine(s));
    }
    static string LastProp(AppState s) => s.Proposals[^1].Id;
    static List<AllocLine> L(params (string sid, string comp, long amt)[] x) => x.Select(v => new AllocLine(v.sid, v.comp, v.amt)).ToList();

    static readonly (string id, string ac, string name, Action<Action<string, bool>> run)[] Tests =
    {
        ("TC-01", "AC-01", "Valid student ID in a verified reference is matched, not posted while the fee component is undefined", c => {
            var (s, e) = Fresh(); var t = e.TxnById("P1")!;
            c("P1 matched to S101 by rule AM-1", t.Matched == "S101");
            c("Unregistered payer contact is flagged", t.Flags.Any(f => f.Contains("7731")));
            c("No ledger entry and no receipt yet", s.Ledger.Count == 0 && s.Receipts.Count == 0);
        }),
        ("TC-02", "AC-02", "With a Finance-approved allocation order, P1 posts automatically once", c => {
            var (s, e) = Fresh(p => p.ComponentPolicy = "admission-first");
            c("₹10,000 posted to S101 Admission", e.PostedFor("S101", "Admission") == 10000);
            c("Exactly one receipt for P1", s.Receipts.Count(r => r.TxnId == "P1") == 1);
            c("P3 also auto-posted to S103", e.PostedFor("S103") == 15000);
        }),
        ("TC-03", "AC-03", "Duplicate import P4 and a full re-import create no new money, posting or receipt", c => {
            var (s, e) = Fresh(p => p.ComponentPolicy = "admission-first");
            var l = s.Ledger.Count; var r = s.Receipts.Count; var diff = e.ControlDifference();
            c("P4 linked as duplicate of P1", e.TxnById("P4")!.DuplicateOf == "P1");
            c("P4 has nothing to allocate", e.Allocatable(e.TxnById("P4")) == 0);
            c("Proposing on P4 is blocked", !e.Propose(Ops, "P4", L(("S101", "Tuition", 10000)), "test").Ok);
            foreach (var t in s.Txns.Where(x => x.Source == "bank" && x.DuplicateOf == null).ToList()) e.IngestBank(new(t.SourceTxnId, t.Amount, t.Channel, t.PayerName, t.PayerContact, t.Remark, t.ReversalOfRef), Actor.System);
            c("Re-importing every bank record changes no ledger entry or receipt", s.Ledger.Count == l && s.Receipts.Count == r && e.ControlDifference() == diff);
        }),
        ("TC-04", "AC-04", "P6 split: one source transaction, two allocation lines, money counted once", c => {
            var (s, e) = Fresh();
            c("Proposal accepted", e.Propose(Ops, "P6", L(("S101", "Tuition", 15000), ("S104", "Tuition", 15000)), "Per bank remark").Ok);
            c("Approved by a Finance approver and posted", e.Approve(App, LastProp(s)).Ok && s.Proposals[^1].Status == "posted");
            var lines = s.Allocs.Where(a => a.TxnId == "P6").ToList();
            c("Two allocation rows, one source payment", lines.Count == 2 && s.Txns.Count(t => t.SourceTxnId == "NEFT/N294261007733") == 1);
            c("Lines sum to ₹30,000; P6 fully allocated", lines.Sum(a => a.Amount) == 30000 && e.Allocatable(e.TxnById("P6")) == 0);
            c("One receipt per student line", s.Receipts.Count(x => x.TxnId == "P6") == 2);
        }),
        ("TC-05", "AC-05", "Allocation above the available amount is blocked", c => {
            var (_, e) = Fresh();
            c("₹35,000 against ₹30,000 rejected", !e.Propose(Ops, "P6", L(("S101", "Tuition", 20000), ("S104", "Tuition", 15000)), "x").Ok);
            c("Missing fee component rejected", !e.Propose(Ops, "P6", L(("S101", "", 15000)), "x").Ok);
        }),
        ("TC-06", "AC-06", "Name-only candidates (P2, P9) need recorded evidence before any proposal", c => {
            var (s, e) = Fresh();
            c("P2 'R Mehta' is a Low candidate, not a match", e.TxnById("P2")!.Candidates.Any(x => x.Sid == "S102" && x.Conf == "Low") && e.TxnById("P2")!.Matched == null);
            c("P9 'Dev Nair' is a Medium candidate, not a match", e.TxnById("P9")!.Candidates.Any(x => x.Sid == "S104" && x.Conf == "Medium") && e.TxnById("P9")!.Matched == null);
            c("Proposing P9 → S104 without evidence is blocked", !e.Propose(Ops, "P9", L(("S104", "Tuition", 25000)), "name matches").Ok);
            c("With evidence it becomes a proposal, still unposted", e.Propose(Ops, "P9", L(("S104", "Tuition", 25000)), "Confirmed", "Guardian confirmed by call to registered number").Ok && s.Ledger.Count == 0);
        }),
        ("TC-07", "AC-07", "Maker-checker: nobody approves their own proposal; only Finance approvers approve", c => {
            var (s, e) = Fresh();
            e.Propose(App, "P3", L(("S103", "Tuition", 15000)), "Per reference");
            c("Finance approver cannot approve own proposal", !e.Approve(App, LastProp(s)).Ok);
            c("A different Finance approver can", e.Approve(App2, LastProp(s)).Ok);
            e.Propose(Ops, "P1", L(("S101", "Admission", 10000)), "Per reference");
            c("Operations cannot approve", !e.Approve(Ops, LastProp(s)).Ok);
            c("Denied attempt written to the audit log", s.Audit.Any(a => a.Result == "denied" && a.Action == "Approve allocation"));
        }),
        ("TC-08", "AC-08", "Cash stays out of the ledger until Finance verifies the deposit", c => {
            var (s, e) = Fresh();
            c("P5 cash is pending", e.TxnById("P5")!.Verification == "pending");
            c("Allocation blocked while unverified", !e.Propose(Ops, "P5", L(("S102", "Tuition", 10000)), "x").Ok);
            c("Counsellor cannot verify", !e.VerifyCash(Cou, "P5", true).Ok);
            c("Counsellor records evidence", e.RecordCashEvidence(Cou, "P5", "S102", "CRB-0912", "DEP-55120").Ok);
            c("Finance reviewer verifies; ledger unchanged until allocation approved", e.VerifyCash(Rev, "P5", true).Ok && s.Ledger.Count == 0);
        }),
        ("TC-09", "AC-09", "A screenshot is not proof; a later bank credit with the same UTR links to it", c => {
            var (s, e) = Fresh(); var t = e.TxnById("P7")!;
            c("Claim is not found, never verified", t.Verification == "not_found");
            c("Nothing to allocate, no receipt", e.Allocatable(t) == 0 && !s.Receipts.Any(r => r.Sid == "S102"));
            var b = e.IngestBank(new("UPI/430618771204", 20000, "UPI"), Actor.System)!;
            c("Bank credit links to claim P7", e.TxnById("P7")!.Verification == "linked" && b.LinkedClaim == "P7");
            c("S102 becomes a High candidate, still unallocated", b.Candidates.Any(x => x.Sid == "S102" && x.Conf == "High") && s.Ledger.Count == 0);
        }),
        ("TC-10", "AC-10", "P8 partial reversal after posting keeps P3 and nets it to ₹10,000", c => {
            var (s, e) = Fresh();
            e.Propose(Ops, "P3", L(("S103", "Tuition", 15000)), "Per reference"); e.Approve(App, LastProp(s));
            c("Reversal waits for approval", e.TxnById("P8")!.Reversal!.State == "awaiting_approval" && e.PostedFor("S103") == 15000);
            c("Finance approver applies it", e.ApplyReversal(App, "P8").Ok);
            c("P3 still ₹15,000 gross", e.TxnById("P3")!.Amount == 15000);
            c("S103 net recognised ₹10,000", e.PostedFor("S103") == 10000);
            c("Receipt marked adjusted", s.Receipts.First(x => x.TxnId == "P3").Status == "adjusted");
        }),
        ("TC-11", "AC-11", "A reversal larger than the unreversed amount is blocked", c => {
            var (_, e) = Fresh(); e.ApplyReversal(App, "P8");
            var r = e.IngestBank(new("RVSL/999", -12000, "UPI reversal", "", "", "Reversal P3", "UPI/430312902337"), Actor.System)!;
            c("−₹12,000 against ₹10,000 remaining goes to exception", r.Reversal!.State == "exception");
            c("It cannot be applied", !e.ApplyReversal(App, r.Id).Ok && e.TxnById("P3")!.ReversedApplied == 5000);
        }),
        ("TC-12", "AC-03", "A re-delivered reversal event is idempotent", c => {
            var (_, e) = Fresh(); e.ApplyReversal(App, "P8");
            var d = e.IngestBank(new("RVSL/430712008711", -5000, "UPI reversal", "", "", "Partial reversal of P3", "UPI/430312902337"), Actor.System)!;
            c("Second delivery flagged duplicate", d.DuplicateOf == "P8");
            c("P3 reversed only once", e.TxnById("P3")!.ReversedApplied == 5000);
        }),
        ("TC-13", "AC-12", "Student-system timeout: retry posts exactly once", c => {
            var (s, e) = Fresh(p => p.SmsFail = true);
            e.Propose(Ops, "P3", L(("S103", "Tuition", 15000)), "Per reference"); e.Approve(App, LastProp(s));
            c("First attempt fails; nothing posted", s.Proposals[^1].Status == "post_failed" && s.Ledger.Count == 0);
            e.Retry(Ops, LastProp(s)); e.Retry(Ops, LastProp(s));
            c("After two retries: one ledger entry, one receipt", s.Ledger.Count == 1 && s.Receipts.Count == 1);
        }),
        ("TC-14", "AC-07", "Unauthorised actions are denied and logged", c => {
            var (s, e) = Fresh();
            e.Propose(Ops, "P3", L(("S103", "Tuition", 15000)), "Per reference");
            c("Student cannot approve", !e.Approve(Stu("S103"), LastProp(s)).Ok);
            c("Administrator cannot propose or approve", !e.Propose(Adm, "P1", L(("S101", "Tuition", 1)), "x").Ok && !e.Approve(Adm, LastProp(s)).Ok);
            c("Counsellor cannot apply a reversal", !e.ApplyReversal(Cou, "P8").Ok);
            c("Each denial is audited", s.Audit.Count(a => a.Result == "denied") >= 4);
        }),
        ("TC-15", "AC-13", "Payment arrives before registration: held, then matched after sync", c => {
            var (_, e) = Fresh();
            var t = e.IngestBank(new("UPI/LATE-1", 25000, "UPI", "", "", "S105"), Actor.System)!;
            c("Held as unknown reference; no student invented", t.UnknownRef == "S105" && e.StudentById("S105") == null);
            e.RegisterStudent(Actor.System, "S105", "Meher Shah"); e.RetryLookup(Ops, t.Id);
            c("After sync and retry it matches S105", e.TxnById(t.Id)!.Matched == "S105");
        }),
        ("TC-16", "AC-14", "Correcting a wrong allocation keeps history and frees the funds", c => {
            var (s, e) = Fresh();
            e.Propose(Ops, "P9", L(("S104", "Tuition", 25000)), "Guardian confirmed", "Guardian confirmed via registered contact"); e.Approve(App, LastProp(s));
            var a = s.Proposals[^1].AllocIds[0];
            c("Correction request needs a reason", !e.RequestCorrection(Ops, a, "x").Ok);
            c("Requested by Operations", e.RequestCorrection(Ops, a, "Payer later identified as parent of another student").Ok);
            c("Approved by a Finance approver", e.Correct(App, a).Ok);
            c("Original row kept as corrected", s.Allocs.First(x => x.Id == a).Status == "corrected");
            c("Ledger nets to zero for S104; receipt cancelled", e.PostedFor("S104") == 0 && s.Receipts.First(x => x.TxnId == "P9").Status == "cancelled");
            c("₹25,000 back to unallocated", e.Allocatable(e.TxnById("P9")) == 25000);
        }),
        ("TC-17", "AC-15", "Two reviewers on the same payment: the stale edit is rejected", c => {
            var (_, e) = Fresh(); var v = e.TxnById("P6")!.Version;
            c("Reviewer A proposes", e.Propose(Ops, "P6", L(("S101", "Tuition", 15000), ("S104", "Tuition", 15000)), "A", "", v).Ok);
            c("Reviewer B on the old version is blocked", !e.Propose(Rev, "P6", L(("S101", "Tuition", 30000)), "B", "", v).Ok);
        }),
        ("TC-18", "AC-16", "Books balance: verified money = posted + pending + unallocated", c => {
            var (s, e) = Fresh();
            e.Propose(Ops, "P6", L(("S101", "Tuition", 15000), ("S104", "Tuition", 15000)), "x"); e.Approve(App, LastProp(s));
            e.Propose(Ops, "P3", L(("S103", "Tuition", 15000)), "x");
            c("Pending proposal blocks reversal from over-committing P3", !e.ApplyReversal(App, "P8").Ok);
            c("Control difference is ₹0", e.ControlDifference() == 0);
        }),
        ("TC-19", "AC-03", "Formatted re-imports and same-ID-different-amount conflicts", c => {
            var (_, e) = Fresh();
            c("Lower-case, padded ID is a duplicate of P1", e.IngestBank(new(" upi/430219884120 ", 10000, "UPI", "", "", "S101"), Actor.System)!.DuplicateOf == "P1");
            var d = e.IngestBank(new("UPI/430219884120", 25000, "UPI", "", "", "S101"), Actor.System)!;
            c("Different amount is an ID conflict, not money", d.IdConflict && e.Allocatable(d) == 0 && e.Status(d).key == "conflict");
            c("Only Finance closes it", !e.CloseConflict(Ops, d.Id, "bank confirmed P1").Ok && e.CloseConflict(Rev, d.Id, "Bank confirmed P1 is the correct line").Ok);
        }),
        ("TC-20", "AC-09", "UTR typed as plain digits links to the formatted bank ID", c => {
            var (s, e) = Fresh();
            var r = e.SubmitClaim(Stu("S101"), "4309 1122 3344", 12000, "", "");
            c("Claim accepted and held", r.Ok && s.Txns[^1].Verification == "not_found");
            var claimId = s.Txns[^1].Id;
            var b = e.IngestBank(new("UPI/430911223344", 12000, "UPI"), Actor.System)!;
            c("Bank credit links to the claim", e.TxnById(claimId)!.Verification == "linked" && b.Candidates.Any(x => x.Sid == "S101"));
        }),
        ("TC-21", "AC-09", "Two students claiming one payment are both downgraded and flagged", c => {
            var (_, e) = Fresh();
            e.SubmitClaim(Stu("S101"), "UPI/430618771204", 20000, "", "");
            var b = e.IngestBank(new("UPI/430618771204", 20000, "UPI"), Actor.System)!;
            c("No High candidate", !b.Candidates.Any(x => x.Conf == "High"));
            c("Conflict flagged", b.Flags.Any(f => f.Contains("Two students")));
        }),
        ("TC-22", "AC-11", "Reversals must target a real bank payment and carry a negative amount", c => {
            var (_, e) = Fresh();
            var r1 = e.IngestBank(new("RVSL/A", -1000, "x", "", "", "Reversal of P4"), Actor.System)!;
            c("Reversal of duplicate P4 goes to exception", r1.Reversal!.State == "exception" && r1.Reversal.Reason.Contains("duplicate"));
            var r2 = e.IngestBank(new("RVSL/B", -1000, "x", "", "", "Reversal of P5"), Actor.System)!;
            c("Reversal of cash P5 goes to exception", r2.Reversal!.State == "exception");
            var p = e.IngestBank(new("NEFT/POS", 5000, "x", "", "", "S102", "UPI/430312902337"), Actor.System)!;
            c("Positive credit tagged as reversal is a payment, flagged", p.Kind == "payment" && p.Flags.Count > 0 && e.TxnById("P3")!.ReversedApplied == 0);
            c("Exception closed by Finance with a note, no balance change", e.CloseReversal(App, r1.Id, "Bank confirmed no such reversal").Ok && e.ControlDifference() == 0);
        }),
        ("TC-23", "AC-07", "Security: nobody can approve an allocation and then undo it alone", c => {
            var (s, e) = Fresh();
            e.Propose(Ops, "P9", L(("S104", "Tuition", 25000)), "x", "Guardian confirmed via registered contact"); e.Approve(App, LastProp(s));
            var a = s.Proposals[^1].AllocIds[0];
            c("Direct correction without a request is refused", !e.Correct(App, a).Ok);
            c("Approver requests, then cannot approve own request", e.RequestCorrection(App, a, "Self-initiated reversal attempt").Ok && !e.Correct(App, a).Ok);
            c("A second approver can", e.Correct(App2, a).Ok);
        }),
        ("TC-24", "AC-09", "Security: a student cannot claim money whose bank reference names another student", c => {
            var (_, e) = Fresh();
            e.SubmitClaim(Stu("S102"), "UPI/430219884120", 10000, "", "");
            var t = e.TxnById("P1")!;
            c("P1 stays matched to S101", t.Matched == "S101");
            c("S102 claim is Low and flagged", t.Candidates.Any(x => x.Sid == "S102" && x.Conf == "Low") && t.Flags.Any(f => f.Contains("S102") && f.Contains("S101")));
        }),
        ("TC-25", "AC-07", "Security: input abuse is bounded", c => {
            var (s, e) = Fresh();
            c("Staff cannot raise a case as a student", !e.RaiseCase(Ops, "", "fake").Ok);
            var n = 0; for (var i = 0; i < 12; i++) if (e.SubmitClaim(Stu("S101"), "SP/" + i, 100, "", "").Ok) n++;
            c("Claims per student capped at " + s.Settings.MaxOpenClaims, n == s.Settings.MaxOpenClaims);
            c("Implausible amounts rejected at import", e.IngestBank(new("BIG", 1_000_000_000_000_000), Actor.System) == null);
            e.RaiseCase(Stu("S102"), "", new string('A', 50000));
            c("Free text clipped to 1,000 characters", s.Cases[^1].Text.Length == 1000);
        }),
        ("TC-26", "AC-08", "Security: whoever reported cash cannot verify it, even as Finance", c => {
            var (s, e) = Fresh();
            var r = e.ReportCash(Ops, 8000, "S101", "Collected at front desk"); var id = s.Txns[^1].Id;
            e.RecordCashEvidence(Ops, id, "S101", "CRB-1", "DEP-1");
            c("Reporter and evidencer are recorded", s.Txns[^1].ReportedBy == "u-ops");
            var rev2 = new Actor("u-ops", "Meera J.", "finrev"); // same person, hypothetically given a finance role
            c("Same person cannot verify", !e.VerifyCash(rev2, id, true).Ok);
            c("A different Finance user can", e.VerifyCash(Rev, id, true).Ok);
        }),
        ("TC-27", "AC-16", "Audit log is hash-chained and tamper-evident", c => {
            var (s, e) = Fresh();
            c("Fresh chain verifies", Infra.AuditChain.Verify(s.Audit).ok);
            s.Audit[2].Detail = "edited";
            c("Editing any entry breaks the chain", !Infra.AuditChain.Verify(s.Audit).ok);
        }),
    };

    public static List<TestResult> Run()
    {
        var results = new List<TestResult>();
        foreach (var (id, ac, name, run) in Tests)
        {
            var checks = new List<Check>(); string? err = null;
            try { run((d, v) => checks.Add(new Check(d, v))); } catch (Exception ex) { err = ex.Message; }
            results.Add(new TestResult(id, ac, name, err == null && checks.Count > 0 && checks.All(k => k.Passed), checks, err));
        }
        return results;
    }
}
