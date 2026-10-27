using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using FeeReconDesk.Infra;

namespace FeeReconDesk.Domain;

/// <summary>
/// Rules engine. Verification, matching, allocation, posting and receipt are five separate states.
/// Every money-changing action checks permission, validation and separation of duties here, on the server.
/// The engine is not thread-safe; the store serialises access.
/// </summary>
public sealed partial class Engine
{
    public static readonly string[] Components = { "Admission", "Tuition" };
    public const long MaxAmount = 100_000_000; // ₹10 crore: anything larger is a data error, not a payment
    static readonly string[] Active = { "proposed", "approved", "post_failed", "posted" };
    static readonly string[] Pending = { "proposed", "approved", "post_failed" };

    public static readonly Dictionary<string, string> RoleLabels = new()
    {
        ["ops"] = "Operations executive", ["counsellor"] = "Counsellor", ["finrev"] = "Finance reviewer",
        ["finapp"] = "Finance approver", ["admin"] = "Administrator", ["student"] = "Student", ["system"] = "System",
    };

    public static readonly Dictionary<string, string[]> Perms = new()
    {
        ["viewQueue"] = new[] { "ops", "counsellor", "finrev", "finapp", "admin" },
        ["propose"] = new[] { "ops", "finrev", "finapp" },
        ["approve"] = new[] { "finapp" },
        ["retry"] = new[] { "ops", "finrev", "finapp" },
        ["recordCash"] = new[] { "counsellor", "ops" },
        ["reportCash"] = new[] { "counsellor", "ops" },
        ["verifyCash"] = new[] { "finrev", "finapp" },
        ["reversal"] = new[] { "finapp" },
        ["correct"] = new[] { "finapp" },
        ["requestCorrection"] = new[] { "ops", "finrev", "finapp" },
        ["evidence"] = new[] { "ops", "counsellor", "finrev", "finapp" },
        ["escalate"] = new[] { "ops", "counsellor", "finrev" },
        ["cases"] = new[] { "ops", "finrev", "finapp" },
        ["policy"] = new[] { "admin" },
        ["viewAudit"] = new[] { "finrev", "finapp", "admin" },
        ["importBank"] = new[] { "finrev", "finapp" },
        ["export"] = new[] { "finrev", "finapp", "admin" },
        ["students"] = new[] { "admin" },
        ["users"] = new[] { "admin" },
        ["selftest"] = new[] { "admin", "finrev", "finapp" },
    };

    readonly AppState s;
    readonly Func<DateTimeOffset> now;
    public Engine(AppState state, Func<DateTimeOffset>? clock = null) { s = state; now = clock ?? (() => DateTimeOffset.UtcNow); }
    public AppState State => s;
    public DateTimeOffset? Clock { get; set; }
    DateTimeOffset Ts() => Clock ?? now();

    // ---------- helpers ----------
    public static string Fmt(long n)
    {
        var neg = n < 0; var d = Math.Abs(n).ToString(CultureInfo.InvariantCulture);
        string g;
        if (d.Length <= 3) g = d;
        else
        {
            var last3 = d[^3..]; var rest = d[..^3]; var sb = new StringBuilder();
            for (int i = 0; i < rest.Length; i++) { if (i > 0 && (rest.Length - i) % 2 == 0) sb.Append(','); sb.Append(rest[i]); }
            g = sb + "," + last3;
        }
        return (neg ? "−" : "") + "₹" + g;
    }
    public static string Clip(string? v, int n) => string.IsNullOrEmpty(v) ? "" : (v.Length > n ? v[..n] : v);
    static string IdKey(string? v) => Regex.Replace((v ?? "").ToUpperInvariant(), "[^A-Z0-9]", "");
    static string IdDigits(string? v) => Regex.Replace(v ?? "", "[^0-9]", "");
    public static bool SameId(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
        if (IdKey(a) == IdKey(b)) return true;
        var da = IdDigits(a); return da.Length >= 10 && da == IdDigits(b);
    }
    static string Norm(string? v) => Regex.Replace(Regex.Replace((v ?? "").ToLowerInvariant(), "[^a-z ]", " "), "\\s+", " ").Trim();
    static string Pad(long n, int w = 3) => n.ToString(CultureInfo.InvariantCulture).PadLeft(w, '0');
    public static string RoleLabel(Actor a) => RoleLabels.TryGetValue(a.Role, out var l) ? l : a.Role;
    public bool Can(Actor a, string perm) => Perms.TryGetValue(perm, out var r) && r.Contains(a.Role);

    void Log(Actor a, string action, string entity = "", string txn = "", string detail = "", string result = "ok")
    {
        var prev = s.Audit.Count > 0 ? s.Audit[^1].Hash : "GENESIS";
        var ev = new AuditEvent
        {
            Id = ++s.N.Au, Ts = Ts(), Actor = a.UserId, Person = a.Name, Role = RoleLabel(a), Action = action,
            Entity = Clip(entity, 80), Txn = Clip(txn, 40), Detail = Clip(detail, 2000), Result = result, PrevHash = prev,
        };
        ev.Hash = AuditChain.HashOf(ev);
        s.Audit.Add(ev);
    }
    Result Deny(Actor a, string action, string entity, string? txn, string msg) { Log(a, action, entity, txn ?? "", msg, "denied"); return Result.Fail(msg); }
    Result Block(Actor a, string action, string entity, string? txn, string msg) { Log(a, action, entity, txn ?? "", msg, "blocked"); return Result.Fail(msg); }

    public Student? StudentById(string? id) => id == null ? null : s.Students.FirstOrDefault(x => x.Id == id);
    public Txn? TxnById(string? id) => id == null ? null : s.Txns.FirstOrDefault(x => x.Id == id);
    public Proposal? Prop(string? id) => id == null ? null : s.Proposals.FirstOrDefault(x => x.Id == id);
    public long PostedFor(string sid, string? comp = null) => s.Ledger.Where(l => l.Sid == sid && (comp == null || l.Comp == comp)).Sum(l => l.Amount);
    public long Due(string sid, string? comp = null) => StudentById(sid)?.Obligations.Where(o => comp == null || o.Comp == comp).Sum(o => o.Due) ?? 0;
    public long Outstanding(string sid, string? comp = null) => Due(sid, comp) - PostedFor(sid, comp);
    public long PendingFor(string sid, string comp) => s.Allocs.Where(a => a.Sid == sid && a.Comp == comp && Pending.Contains(a.Status)).Sum(a => a.Amount);
    public long ActiveNet(Txn t) => s.Allocs.Where(a => a.TxnId == t.Id && Active.Contains(a.Status)).Sum(a => a.Amount - a.Reversed);
    public long Allocatable(Txn? t) => t == null || t.DuplicateOf != null || !(t.Kind == "payment" || t.Kind == "cash") ? 0 : t.Amount - t.ReversedApplied - ActiveNet(t);
    long PendingRev(Txn t, string? exclude) => s.Txns.Where(r => r.Kind == "reversal" && r.Reversal?.OriginalId == t.Id && r.Reversal.State == "awaiting_approval" && r.Id != exclude).Sum(r => Math.Abs(r.Amount));
    string NextId() { var i = s.Txns.Count + 1; while (TxnById("P" + i) != null) i++; return "P" + i; }
    bool StrongBasis(Txn t, string sid) => t.Matched == sid || t.Candidates.Any(c => c.Sid == sid && c.Conf == "High");

    public Student MakeStudent(string id, string name, string contact = "", string guardian = "") => new()
    {
        Id = id, Name = name, Contact = contact, Guardian = guardian,
        Obligations = new()
        {
            new Obligation { Id = id + "-ADM", Comp = "Admission", Due = s.Settings.AdmissionFee },
            new Obligation { Id = id + "-TUI", Comp = "Tuition", Due = s.Settings.TuitionFee },
        },
    };

    // ---------- ingestion (FR-001..003) ----------
    public Txn? IngestBank(BankEvent ev, Actor actor) => Ingest("bank", ev.SourceTxnId, ev.Amount, actor, ev.Channel, ev.PayerName, ev.PayerContact, ev.Remark, ev.ReversalOf, ev.Batch, ev.ReceivedAt, ev.Ref);

    public Txn? Ingest(string source, string sourceTxnId, long amount, Actor actor, string channel = "", string payerName = "", string payerContact = "",
        string remark = "", string reversalOf = "", string batch = "", DateTimeOffset? receivedAt = null, string? reference = null,
        string? studentHint = null, string claimedUtr = "", string screenshot = "")
    {
        if (amount == 0 || Math.Abs(amount) > MaxAmount || string.IsNullOrWhiteSpace(sourceTxnId))
        {
            Log(actor, "Import rejected", Clip(sourceTxnId, 64) is { Length: > 0 } x ? x : "—", "",
                string.IsNullOrWhiteSpace(sourceTxnId) ? "Missing transaction ID" : $"Invalid amount ({amount}). Allowed: non-zero, up to {Fmt(MaxAmount)}.", "blocked");
            return null;
        }
        var id = reference != null && TxnById(reference) == null ? reference : NextId();
        var t = new Txn
        {
            Id = id, Source = source, SourceTxnId = Clip(sourceTxnId.Trim(), 64), ReversalOfRef = Clip(reversalOf?.Trim(), 64), Channel = Clip(channel, 60),
            Amount = amount, PayerName = Clip(payerName, 120), PayerContact = Clip(payerContact, 20), Remark = Clip(remark, 300),
            ReceivedAt = receivedAt ?? Ts(), IngestedAt = Ts(), Batch = Clip(batch, 60), StudentHint = studentHint,
            ClaimedUtr = Clip(claimedUtr, 64), Screenshot = Clip(screenshot, 120),
            ReportedBy = source == "cash" ? actor.UserId : null,
        };

        if (source == "bank")
        {
            var orig = s.Txns.FirstOrDefault(x => x.Source == "bank" && x.DuplicateOf == null && SameId(x.SourceTxnId, t.SourceTxnId));
            if (orig != null)
            {
                t.Kind = t.Amount < 0 ? "reversal" : "payment"; t.Verification = "duplicate"; t.DuplicateOf = orig.Id; t.Exception = "Duplicate import";
                t.VerificationNote = $"Same bank transaction ID as {orig.Id}. Linked, not counted as new money.";
                if (t.Amount != orig.Amount)
                {
                    t.IdConflict = true; t.Exception = "Same ID, different amount";
                    t.VerificationNote = $"Same bank transaction ID as {orig.Id} but {Fmt(t.Amount)} instead of {Fmt(orig.Amount)}. Not counted as money. Finance must confirm the correct record with the bank.";
                }
                s.Txns.Add(t);
                Log(actor, t.IdConflict ? "Import blocked: ID conflict" : "Import blocked as duplicate", t.Id, t.Id,
                    t.IdConflict ? t.VerificationNote : $"{t.SourceTxnId} already ingested as {orig.Id}. No posting, no receipt.", "blocked");
                if (t.IdConflict) Log(actor, "Import blocked: ID conflict", t.Id, orig.Id, $"{t.Id} re-uses this ID with {Fmt(t.Amount)}");
                return t;
            }
            t.VerificationNote = "Present in the approved bank statement feed";
            s.Txns.Add(t);
            Log(actor, "Imported from bank feed", t.Id, t.Id, $"{Fmt(t.Amount)} · {t.SourceTxnId} · batch {(t.Batch.Length > 0 ? t.Batch : "—")}");
            if (t.Amount < 0) { t.Kind = "reversal"; SetupReversal(t, actor); return t; }
            if (t.ReversalOfRef.Length > 0) t.Flags.Add($"Feed marked this as a reversal of {t.ReversalOfRef}, but the amount is a credit. Treated as a new payment; confirm with the bank.");
            foreach (var c in s.Txns.Where(c => c.Kind == "claim" && c.Verification == "not_found" && SameId(c.ClaimedUtr, t.SourceTxnId)).ToList()) LinkClaim(c, t, actor);
            Match(t); Dispose(t);
            return t;
        }
        if (source == "cash")
        {
            t.Kind = "cash"; t.Verification = "pending"; t.Exception = "Cash not yet verified";
            t.VerificationNote = "Counsellor report only. No deposit proof or cashbook reconciliation yet.";
            if (studentHint != null && StudentById(studentHint) != null) t.Candidates.Add(new Candidate { Sid = studentHint, Conf = "Medium", Reasons = { "Named by the collecting counsellor (unverified)" } });
            s.Txns.Add(t);
            Log(actor, "Cash collection reported", t.Id, t.Id, $"{Fmt(t.Amount)} reported. Held as pending verification; ledger unchanged.");
            return t;
        }
        if (source == "upload")
        {
            t.Kind = "claim"; if (t.Channel.Length == 0) t.Channel = "Claimed payment";
            s.Txns.Add(t);
            Log(actor, "Payment details submitted by student", t.Id, t.Id, $"Claims {Fmt(t.Amount)} with UTR {t.ClaimedUtr}{(t.Screenshot.Length > 0 ? " · screenshot " + t.Screenshot : "")}");
            var bank = s.Txns.FirstOrDefault(b => b.Source == "bank" && b.DuplicateOf == null && b.Kind == "payment" && SameId(b.SourceTxnId, t.ClaimedUtr));
            if (bank != null) LinkClaim(t, bank, actor);
            else { t.Verification = "not_found"; t.Exception = "Not found in bank records"; t.VerificationNote = "No transaction with this UTR in verified bank records. A screenshot is evidence to investigate, not proof of receipt."; }
            return t;
        }
        return t;
    }

    void LinkClaim(Txn claim, Txn bank, Actor actor)
    {
        claim.Verification = "linked"; claim.LinkedBankTxn = bank.Id; claim.Exception = null;
        claim.VerificationNote = $"Matched to verified bank transaction {bank.Id}";
        bank.LinkedClaim ??= claim.Id;
        bank.LinkedClaims.Add(claim.Id);
        var claimants = bank.LinkedClaims.Select(id => TxnById(id)?.StudentHint).Where(x => x != null).Distinct().ToList();
        var existing = bank.Candidates.FirstOrDefault(c => c.Sid == claim.StudentHint);
        if (existing != null) existing.Reasons.Add($"Also claimed by the student in {claim.Id}");
        else if (claim.Amount == bank.Amount) bank.Candidates.Add(new Candidate { Sid = claim.StudentHint!, Conf = "High", Reasons = { $"UTR and amount match student claim {claim.Id}" }, Basis = "claim" });
        else
        {
            bank.Flags.Add($"Claim {claim.Id} quotes this UTR but a different amount ({Fmt(claim.Amount)})");
            bank.Candidates.Add(new Candidate { Sid = claim.StudentHint!, Conf = "Medium", Reasons = { $"UTR matches claim {claim.Id}; amount differs" } });
        }
        if (claimants.Count > 1)
        {
            bank.Flags.Add($"Two students claim this payment: {string.Join(" and ", claimants)}. Neither claim is enough on its own; confirm with the payer.");
            foreach (var c in bank.Candidates.Where(c => c.Basis == "claim")) { c.Conf = "Medium"; c.Basis = "claim-conflict"; }
        }
        // A claim never outranks the bank's own reference.
        var refOwner = bank.Matched ?? bank.Candidates.FirstOrDefault(c => c.Basis is "ref" or "split")?.Sid;
        if (refOwner != null && refOwner != claim.StudentHint)
        {
            var c = bank.Candidates.FirstOrDefault(x => x.Sid == claim.StudentHint); if (c != null) { c.Conf = "Low"; c.Basis = "claim-disputed"; }
            bank.Flags.Add($"Student {claim.StudentHint} ({claim.Id}) claims this payment, but the bank reference names {refOwner}. The claim does not change the match; investigate before acting.");
        }
        var allocatedTo = s.Allocs.Where(a => a.TxnId == bank.Id && Active.Contains(a.Status)).Select(a => a.Sid).Distinct().Where(x => x != claim.StudentHint).ToList();
        if (allocatedTo.Count > 0) bank.Flags.Add($"{claim.Id} (student {claim.StudentHint}) claims money already allocated to {string.Join(", ", allocatedTo)}. Investigate before changing anything.");
        if (bank.Exception is "No identifier" or "Name or contact similarity only") bank.Exception = "Candidate needs review";
        Log(actor, "Student claim linked to bank transaction", claim.Id, bank.Id, $"{claim.Id} ↔ {bank.Id} via UTR {bank.SourceTxnId}");
    }

    // ---------- matching (FR-004) ----------
    static readonly Regex IdRx = new(@"\bS\d{3}\b", RegexOptions.Compiled);
    static readonly Regex PairRx = new(@"\b(S\d{3})\s*[:=\-]?\s*₹?\s*(\d[\d,]*)", RegexOptions.Compiled);
    static readonly Dictionary<string, int> Rank = new() { ["High"] = 3, ["Medium"] = 2, ["Low"] = 1 };

    void Match(Txn t)
    {
        var text = (t.Remark ?? "").ToUpperInvariant();
        var ids = IdRx.Matches(text).Select(m => m.Value).Distinct().ToList();
        var pairs = PairRx.Matches(text).Select(m => new SplitLine { Sid = m.Groups[1].Value, Amount = long.Parse(m.Groups[2].Value.Replace(",", ""), CultureInfo.InvariantCulture) }).ToList();
        void Add(string sid, string conf, string reason, string? basis = null)
        {
            var c = t.Candidates.FirstOrDefault(x => x.Sid == sid);
            if (c != null) { c.Reasons.Add(reason); if (Rank[conf] > Rank[c.Conf]) { c.Conf = conf; c.Basis = basis; } }
            else t.Candidates.Add(new Candidate { Sid = sid, Conf = conf, Reasons = { reason }, Basis = basis });
        }
        if (ids.Count >= 2)
        {
            t.Split = pairs.Count > 0 ? pairs : null;
            var sum = pairs.Sum(p => p.Amount);
            var unknown = ids.Where(i => StudentById(i) == null).ToList();
            if (pairs.Count < ids.Count) { t.Exception = "Several student IDs, no split amounts"; foreach (var i in ids.Where(i => StudentById(i) != null)) Add(i, "Medium", "Student ID in bank remark; amount for this student not stated"); }
            else if (unknown.Count > 0) { t.Exception = $"Unknown student ID in split ({string.Join(", ", unknown)})"; t.UnknownRef = unknown[0]; }
            else if (sum != t.Amount) { t.Exception = $"Split amounts total {Fmt(sum)}, payment is {Fmt(t.Amount)}"; foreach (var p in pairs) Add(p.Sid, "Medium", $"Remark assigns {Fmt(p.Amount)}, but split does not reconcile"); }
            else { t.Exception = "Split payment"; foreach (var p in pairs) Add(p.Sid, "High", $"Bank remark instructs {Fmt(p.Amount)} for {p.Sid}", "split"); }
        }
        else if (ids.Count == 1)
        {
            if (StudentById(ids[0]) != null) Add(ids[0], "High", "Valid student ID in the verified bank reference", "ref");
            else { t.UnknownRef = ids[0]; t.Exception = $"Reference {ids[0]} not found in student system"; }
        }
        if (!string.IsNullOrEmpty(t.PayerContact))
        {
            var d = IdDigits(t.PayerContact); var last4 = d.Length >= 4 ? d[^4..] : d;
            foreach (var st in s.Students)
            {
                if (st.Contact == last4) Add(st.Id, "Medium", $"Payer contact ending {last4} matches registered contact");
                if (st.Guardian == last4) Add(st.Id, "Medium", $"Payer contact ending {last4} matches guardian contact");
            }
            if (last4.Length > 0 && !s.Students.Any(st => st.Contact == last4 || st.Guardian == last4))
                t.Flags.Add($"Payer contact ending {last4} is not on any student record. A parent, friend or sibling may have paid; this neither confirms nor rules out ownership.");
        }
        if (!string.IsNullOrEmpty(t.PayerName))
        {
            var pn = Norm(t.PayerName); var parts = pn.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length > 0)
                foreach (var st in s.Students)
                {
                    var sn = Norm(st.Name); var sp = sn.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (sp.Length == 0) continue;
                    if (sn == pn) Add(st.Id, "Medium", "Payer name exactly matches student name. Names are not unique identifiers.");
                    else if (parts.Length >= 2 && parts[0].Length == 1 && parts[^1] == sp[^1] && sp[0][0] == parts[0][0]) Add(st.Id, "Low", $"\"{t.PayerName}\" shares initial and surname with {st.Name}. Could be a parent or anyone else.");
                    else if (sp[^1] == parts[^1] && pn.Length > 2) Add(st.Id, "Low", $"Payer surname matches {st.Name}");
                }
        }
        var refC = t.Candidates.Where(c => c.Conf == "High").ToList();
        if (refC.Count > 0 && t.Candidates.Any(c => c.Conf != "High" && !refC.Any(r => r.Sid == c.Sid)))
            t.Flags.Add("Conflicting signals: the reference and the name/contact point to different students.");
    }

    void Dispose(Txn t)
    {
        var strong = t.Candidates.Where(c => c.Conf == "High" && c.Basis == "ref").ToList();
        var conflict = t.Flags.Any(f => f.StartsWith("Conflicting"));
        if (t.Split == null && strong.Count == 1 && t.Candidates.Count == 1 && !conflict && s.Settings.AutoMatch && t.UnknownRef == null)
        {
            t.Matched = strong[0].Sid; t.MatchBasis = "Rule AM-1: verified bank transaction carries a valid student ID; no conflicting signal; not a duplicate";
            Log(Actor.System, "Auto-matched to student", t.Id, t.Id, $"{t.Id} → {t.Matched} ({t.MatchBasis})");
            if (s.Settings.ComponentPolicy == "admission-first") AutoAllocate(t); else t.Exception = "Fee component not specified";
            return;
        }
        if (t.Exception == null)
        {
            if (t.Candidates.Count == 0) t.Exception = "No identifier";
            else if (t.Candidates.All(c => c.Conf != "High")) t.Exception = "Name or contact similarity only";
            else t.Exception = "Candidate needs review";
        }
    }

    void AutoAllocate(Txn t)
    {
        var left = Allocatable(t); var rows = new List<AllocLine>();
        foreach (var comp in Components)
        {
            var o = Outstanding(t.Matched!, comp) - PendingFor(t.Matched!, comp);
            var take = Math.Min(left, Math.Max(0, o));
            if (take > 0) { rows.Add(new AllocLine(t.Matched!, comp, take)); left -= take; }
        }
        if (rows.Count == 0) { t.Exception = "Overpayment — Finance policy needed"; return; }
        var p = MkProposal(t, rows, Actor.System, "Rule AA-1: Finance-approved allocation order (admission first, then tuition)", "");
        p.Status = "approved"; p.Approver = Actor.Policy.UserId; p.ApprovedAt = Ts();
        foreach (var a in s.Allocs.Where(a => a.PropId == p.Id)) a.Status = "approved";
        Log(Actor.System, "Auto-allocated under approved policy", p.Id, t.Id, string.Join("; ", rows.Select(r => $"{Fmt(r.Amount)} → {r.Comp}")));
        Post(Actor.System, p.Id);
        t.Exception = left > 0 ? "Unallocated remainder (overpayment)" : null;
    }

    Proposal MkProposal(Txn t, List<AllocLine> rows, Actor actor, string reason, string evidence)
    {
        var p = new Proposal { Id = "PR-" + Pad(++s.N.Prop), TxnId = t.Id, Proposer = actor.UserId, Reason = reason, Evidence = evidence, CreatedAt = Ts() };
        foreach (var r in rows)
        {
            var o = Outstanding(r.Sid, r.Comp) - PendingFor(r.Sid, r.Comp);
            var a = new Allocation { Id = "AL-" + Pad(++s.N.A), TxnId = t.Id, PropId = p.Id, Sid = r.Sid, Comp = r.Comp, Amount = r.Amount, Overpay = r.Amount > o };
            s.Allocs.Add(a); p.AllocIds.Add(a.Id);
        }
        s.Proposals.Add(p); t.Version++;
        return p;
    }

    // ---------- allocation, approval, posting (FR-007..012) ----------
    public Result Propose(Actor actor, string txnId, List<AllocLine> rows, string reason = "", string evidence = "", int? expectedVersion = null)
    {
        const string A = "Propose allocation"; var t = TxnById(txnId);
        reason = Clip(reason, 1000); evidence = Clip(evidence, 1000);
        if (!Can(actor, "propose")) return Deny(actor, A, txnId, txnId, $"{RoleLabel(actor)} cannot propose allocations");
        if (t == null) return Result.Fail("Unknown payment");
        if (expectedVersion != null && expectedVersion != t.Version) return Block(actor, A, txnId, txnId, "This payment changed while you were editing (another reviewer acted on it). Reload the record and try again.");
        if (t.DuplicateOf != null) return Block(actor, A, txnId, txnId, $"{t.Id} is a duplicate import of {t.DuplicateOf}. It carries no money of its own.");
        if (!(t.Kind == "payment" || t.Kind == "cash")) return Block(actor, A, txnId, txnId, "Only payments can be allocated. Claims and reversals are linked records.");
        if (t.Verification != "verified") return Block(actor, A, txnId, txnId, "Funds are not verified. Allocation stays disabled until the money is confirmed in a trusted source.");
        rows = (rows ?? new()).Where(r => r != null && (r.Sid.Length > 0 || r.Amount != 0 || r.Comp.Length > 0)).Take(20).ToList();
        if (rows.Count == 0) return Block(actor, A, txnId, txnId, "Add at least one allocation line");
        foreach (var r in rows)
        {
            if (StudentById(r.Sid) == null) return Block(actor, A, txnId, txnId, "Choose a valid student on every line");
            if (!Components.Contains(r.Comp)) return Block(actor, A, txnId, txnId, "Choose the fee component on every line. The system does not guess admission versus tuition.");
            if (r.Amount <= 0 || r.Amount > MaxAmount) return Block(actor, A, txnId, txnId, "Amounts must be whole rupees above zero");
        }
        var sum = rows.Sum(r => r.Amount); var free = Allocatable(t);
        if (sum > free) return Block(actor, A, txnId, txnId, $"Lines total {Fmt(sum)} but only {Fmt(free)} of {t.Id} is unallocated");
        if (string.IsNullOrWhiteSpace(reason)) return Block(actor, A, txnId, txnId, "Give a reason for the allocation");
        var weak = rows.Where(r => !StrongBasis(t, r.Sid)).Select(r => r.Sid).Distinct().ToList();
        if (weak.Count > 0 && evidence.Trim().Length < 10) return Block(actor, A, txnId, txnId, $"{string.Join(", ", weak)} has no verified identifier on this payment. A name or contact resemblance is not proof. Record the corroborating evidence first.");
        var p = MkProposal(t, rows, actor, reason, evidence);
        Log(actor, A, p.Id, t.Id, string.Join("; ", rows.Select(r => $"{Fmt(r.Amount)} → {r.Sid} {r.Comp}")) + (evidence.Length > 0 ? $" · Evidence: {evidence}" : "") + $" · Reason: {reason}");
        return Result.Success(new { prop = p.Id });
    }

    public Result Approve(Actor actor, string propId, string note = "")
    {
        const string A = "Approve allocation"; var p = Prop(propId); var tx = p?.TxnId ?? ""; note = Clip(note, 1000);
        if (!Can(actor, "approve")) return Deny(actor, A, propId, tx, $"{RoleLabel(actor)} cannot approve allocations");
        if (p == null || p.Status != "proposed") return Block(actor, A, propId, tx, "Only proposed allocations can be approved");
        if (p.Proposer == actor.UserId) return Block(actor, A, propId, tx, "Separation of duties: the person who proposed an allocation cannot approve it");
        var t = TxnById(p.TxnId)!; var mine = s.Allocs.Where(a => a.PropId == p.Id).ToList();
        if (t.Verification != "verified") return Block(actor, A, propId, tx, "Funds are no longer verified");
        var others = s.Allocs.Where(a => a.TxnId == t.Id && a.PropId != p.Id && (a.Status is "approved" or "posted" or "post_failed")).Sum(a => a.Amount - a.Reversed);
        var room = t.Amount - t.ReversedApplied - others; var total = mine.Sum(a => a.Amount);
        if (total > room) return Block(actor, A, propId, tx, $"Funds changed after this proposal: only {Fmt(room)} is still free. Reject and re-propose.");
        if (mine.Any(a => a.Overpay) && note.Trim().Length < 5) return Block(actor, A, propId, tx, "A line exceeds the fee outstanding. Record the overpayment treatment in the approval note.");
        p.Status = "approved"; p.Approver = actor.UserId; p.ApprovedAt = Ts(); p.Note = note;
        foreach (var a in mine) a.Status = "approved";
        Log(actor, A, p.Id, t.Id, $"Approved {Fmt(total)} on {t.Id}" + (note.Length > 0 ? $" · {note}" : ""));
        return Post(Actor.System, p.Id);
    }

    public Result Reject(Actor actor, string propId, string reason = "")
    {
        const string A = "Reject allocation"; var p = Prop(propId); var tx = p?.TxnId ?? ""; reason = Clip(reason, 1000);
        if (!Can(actor, "approve")) return Deny(actor, A, propId, tx, $"{RoleLabel(actor)} cannot reject allocations");
        if (p == null || p.Status != "proposed") return Block(actor, A, propId, tx, "Only proposed allocations can be rejected");
        if (reason.Trim().Length < 5) return Block(actor, A, propId, tx, "Give a reason so the proposer knows what to fix");
        p.Status = "rejected"; p.Note = reason; p.Approver = actor.UserId; p.ApprovedAt = Ts();
        foreach (var a in s.Allocs.Where(a => a.PropId == p.Id)) a.Status = "rejected";
        TxnById(p.TxnId)!.Version++;
        Log(actor, A, p.Id, tx, reason);
        return Result.Success();
    }

    public Result Post(Actor actor, string propId)
    {
        var p = Prop(propId); if (p == null) return Result.Fail("Unknown proposal");
        var allocs = s.Allocs.Where(a => a.PropId == propId).ToList();
        if (p.Status == "posted") { Log(actor, "Post to student system", p.Id, p.TxnId, "Already posted. Idempotent no-op; no second entry or receipt."); return Result.Success(new { noop = true }); }
        if (p.Status is not ("approved" or "post_failed")) return Result.Fail("Only approved allocations can be posted");
        if (s.Settings.SmsFail && !p.FailedOnce)
        {
            p.FailedOnce = true; p.Status = "post_failed"; foreach (var a in allocs) a.Status = "post_failed";
            Log(Actor.System, "Post to student system", p.Id, p.TxnId, $"Student-management system timed out. Nothing posted. Retry is safe: idempotency key {p.Id}.", "failed");
            return Result.Success(new { failed = true });
        }
        foreach (var a in allocs)
        {
            if (!s.Ledger.Any(l => l.Key == a.Id)) s.Ledger.Add(new LedgerEntry { Id = "LE-" + Pad(++s.N.L, 4), Key = a.Id, Sid = a.Sid, Comp = a.Comp, Amount = a.Amount, Type = "payment", TxnId = a.TxnId, AllocId = a.Id, Ts = Ts() });
            a.Status = "posted"; a.PostedAt = Ts();
            if (!s.Receipts.Any(r => r.AllocId == a.Id)) s.Receipts.Add(new Receipt { No = "RCPT/" + ReceiptYear() + "/" + Pad(++s.N.R, 5), AllocId = a.Id, Sid = a.Sid, TxnId = a.TxnId, Comp = a.Comp, Amount = a.Amount, IssuedAt = Ts() });
        }
        p.Status = "posted";
        Log(Actor.System, "Posted to student ledger", p.Id, p.TxnId, $"{allocs.Count} line(s) posted with idempotency key {p.Id}; one receipt per line");
        return Result.Success();
    }
    string ReceiptYear() { var d = Ts(); var y = d.Month >= 4 ? d.Year : d.Year - 1; return $"{y % 100:00}-{(y + 1) % 100:00}"; }

    public Result Retry(Actor actor, string propId)
    {
        var p = Prop(propId);
        if (!Can(actor, "retry")) return Deny(actor, "Retry posting", propId, p?.TxnId, $"{RoleLabel(actor)} cannot retry postings");
        Log(actor, "Retry posting", propId, p?.TxnId ?? "", "Manual retry requested");
        return Post(actor, propId);
    }

    // ---------- reversals (FR-013) ----------
    void SetupReversal(Txn t, Actor actor)
    {
        Txn? orig = null; var why = "Original payment not found";
        static bool Reversible(Txn? x) => x != null && x.Source == "bank" && x.Kind == "payment" && x.DuplicateOf == null;
        if (t.ReversalOfRef.Length > 0) orig = s.Txns.FirstOrDefault(x => Reversible(x) && SameId(x.SourceTxnId, t.ReversalOfRef));
        if (orig == null)
        {
            var m = Regex.Match(t.Remark.ToUpperInvariant(), @"\bP\d+\b");
            var c = m.Success ? TxnById(m.Value) : null;
            if (Reversible(c)) orig = c;
            else if (c != null) why = c.DuplicateOf != null ? $"{c.Id} is a duplicate import of {c.DuplicateOf}; reverse the original instead" : $"{c.Id} is not a bank payment, so it cannot be reversed by the bank";
        }
        t.Reversal = new ReversalInfo { OriginalId = orig?.Id, State = "awaiting_approval" };
        t.Exception = "Reversal";
        if (orig == null) { t.Reversal.State = "exception"; t.Reversal.Reason = why; t.Exception = "Reversal: original not found"; }
        else
        {
            var remaining = orig.Amount - orig.ReversedApplied - PendingRev(orig, t.Id);
            if (Math.Abs(t.Amount) > remaining) { t.Reversal.State = "exception"; t.Reversal.Reason = $"Reversal {Fmt(Math.Abs(t.Amount))} exceeds the unreversed {Fmt(remaining)} on {orig.Id}"; t.Exception = "Reversal exceeds remaining amount"; }
        }
        Log(Actor.System, "Reversal validated", t.Id, t.Id, t.Reversal.State == "exception" ? t.Reversal.Reason : $"Linked to {orig!.Id}. Awaiting Finance approval before any balance changes.", t.Reversal.State == "exception" ? "blocked" : "ok");
    }

    public Result RelinkReversal(Actor actor, string revId)
    {
        var r = TxnById(revId);
        if (!Can(actor, "reversal")) return Deny(actor, "Retry reversal link", revId, revId, $"{RoleLabel(actor)} cannot work reversals");
        if (r == null || r.Kind != "reversal" || r.DuplicateOf != null || r.Reversal?.State != "exception") return Block(actor, "Retry reversal link", revId, revId, "Only reversal exceptions can be re-checked");
        SetupReversal(r, actor); r.Version++;
        return Result.Success(new { state = r.Reversal!.State });
    }

    public Result CloseReversal(Actor actor, string revId, string note = "")
    {
        const string A = "Close reversal without applying"; var r = TxnById(revId); note = Clip(note, 1000);
        if (!Can(actor, "reversal")) return Deny(actor, A, revId, revId, $"{RoleLabel(actor)} cannot close reversals");
        if (r == null || r.Kind != "reversal" || r.DuplicateOf != null || r.Reversal?.State is not ("exception" or "awaiting_approval")) return Block(actor, A, revId, revId, "Only open reversals can be closed");
        if (note.Trim().Length < 10) return Block(actor, A, revId, revId, "Record what the bank confirmed (at least 10 characters)");
        r.Reversal.State = "closed"; r.Reversal.Note = note; r.Reversal.Approver = actor.UserId; r.Exception = null;
        Log(actor, A, r.Id, r.Id, $"No balance change. {note}");
        if (r.Reversal.OriginalId != null) Log(actor, A, r.Id, r.Reversal.OriginalId, $"{r.Id} closed without applying. {note}");
        return Result.Success();
    }

    public Result ApplyReversal(Actor actor, string revId, string note = "")
    {
        const string A = "Apply reversal"; var r = TxnById(revId); note = Clip(note, 1000);
        if (!Can(actor, "reversal")) return Deny(actor, A, revId, revId, $"{RoleLabel(actor)} cannot apply reversals");
        if (r == null || r.Kind != "reversal" || r.DuplicateOf != null || r.Reversal == null) return Block(actor, A, revId, revId, "Not an applicable reversal");
        if (r.Reversal.State != "awaiting_approval") return Block(actor, A, revId, revId, r.Reversal.State == "applied" ? "Already applied" : (r.Reversal.Reason.Length > 0 ? r.Reversal.Reason : "Reversal is not open"));
        var orig = TxnById(r.Reversal.OriginalId)!;
        var amt = Math.Abs(r.Amount);
        var remaining = orig.Amount - orig.ReversedApplied;
        if (amt > remaining) { r.Reversal.State = "exception"; r.Reversal.Reason = "Exceeds remaining amount"; return Block(actor, A, revId, revId, $"Reversal exceeds the unreversed {Fmt(remaining)}"); }
        var left = amt; var take = new List<(Allocation a, long n)>();
        foreach (var a in s.Allocs.Where(a => a.TxnId == orig.Id && a.Status == "posted" && a.Amount - a.Reversed > 0).Reverse())
        { if (left <= 0) break; var n = Math.Min(left, a.Amount - a.Reversed); take.Add((a, n)); left -= n; }
        var unalloc = Allocatable(orig);
        if (left > unalloc) return Block(actor, A, revId, revId, $"{Fmt(left)} must come from unallocated funds, but only {Fmt(unalloc)} is free because allocations are pending. Reject or reduce the pending proposal first.");
        var netBefore = orig.Amount - orig.ReversedApplied;
        foreach (var (a, n) in take)
        {
            a.Reversed += n;
            var adj = "ADJ/" + ReceiptYear() + "/" + Pad(++s.N.Adj, 4);
            s.Ledger.Add(new LedgerEntry { Id = "LE-" + Pad(++s.N.L, 4), Key = $"{r.Id}:{a.Id}", Sid = a.Sid, Comp = a.Comp, Amount = -n, Type = "reversal", TxnId = r.Id, OrigTxnId = orig.Id, AllocId = a.Id, Ts = Ts() });
            var rc = s.Receipts.FirstOrDefault(x => x.AllocId == a.Id);
            if (rc != null) { rc.Status = "adjusted"; rc.Adjustments.Add(new ReceiptAdjustment { No = adj, Amount = -n, RevId = r.Id }); }
        }
        orig.ReversedApplied += amt; orig.Version++;
        r.Reversal.State = "applied"; r.Reversal.Approver = actor.UserId; r.Reversal.Note = note; r.Exception = null;
        Log(actor, A, r.Id, orig.Id, $"{Fmt(r.Amount)} applied to {orig.Id}. Original kept; net recognised {Fmt(netBefore)} → {Fmt(netBefore - amt)}." + (note.Length > 0 ? $" · {note}" : ""));
        Log(actor, A, r.Id, r.Id, $"Applied against {orig.Id}");
        return Result.Success();
    }

    // ---------- duplicates with conflicting amounts ----------
    public Result CloseConflict(Actor actor, string txnId, string note = "")
    {
        const string A = "Close ID conflict"; var t = TxnById(txnId); note = Clip(note, 1000);
        if (!Can(actor, "verifyCash")) return Deny(actor, A, txnId, txnId, $"{RoleLabel(actor)} cannot resolve bank-data conflicts");
        if (t == null || !t.IdConflict || t.ConflictClosed) return Block(actor, A, txnId, txnId, "No open ID conflict on this record");
        if (note.Trim().Length < 10) return Block(actor, A, txnId, txnId, "Record what the bank confirmed (at least 10 characters)");
        t.ConflictClosed = true; t.Exception = "Duplicate import"; t.Notes.Add(new Note { By = actor.UserId, At = Ts(), Text = note });
        Log(actor, A, t.Id, t.Id, $"Kept {t.DuplicateOf} as the true record; {t.Id} stays non-financial. {note}");
        return Result.Success();
    }

    // ---------- cash (FR-014) ----------
    public Result ReportCash(Actor actor, long amount, string? studentHint, string remark)
    {
        if (!Can(actor, "reportCash")) return Deny(actor, "Report cash collection", "", "", $"{RoleLabel(actor)} cannot report cash");
        if (amount <= 0 || amount > MaxAmount) return Block(actor, "Report cash collection", "", "", "Enter the amount collected, in whole rupees");
        var t = Ingest("cash", "CASH-RPT-" + Pad(s.Txns.Count + 1, 4), amount, actor, "Cash", remark: Clip(remark, 300), batch: "Counsellor entry",
            studentHint: StudentById(studentHint) != null ? studentHint : null);
        return t == null ? Result.Fail("Rejected") : Result.Success(new { txn = t.Id });
    }

    public Result RecordCashEvidence(Actor actor, string txnId, string sid, string receiptBook, string depositRef)
    {
        const string A = "Record cash evidence"; var t = TxnById(txnId);
        if (!Can(actor, "recordCash")) return Deny(actor, A, txnId, txnId, $"{RoleLabel(actor)} cannot record cash evidence");
        if (t == null || t.Kind != "cash") return Block(actor, A, txnId, txnId, "Not a cash record");
        if (t.Verification == "verified") return Block(actor, A, txnId, txnId, "Cash already verified");
        if (StudentById(sid) == null) return Block(actor, A, txnId, txnId, "Name the student the cash was collected for");
        receiptBook = Clip(receiptBook, 40); depositRef = Clip(depositRef, 40);
        if (receiptBook.Trim().Length == 0 || depositRef.Trim().Length == 0) return Block(actor, A, txnId, txnId, "Both the cash receipt-book number and the bank deposit slip reference are required");
        t.CashEvidence = new CashEvidence { Sid = sid, ReceiptBook = receiptBook, DepositRef = depositRef, By = actor.UserId, At = Ts() };
        t.Candidates = new() { new Candidate { Sid = sid, Conf = "Medium", Reasons = { $"Named in cash receipt {receiptBook}; pending Finance verification" } } };
        t.VerificationNote = $"Evidence submitted (receipt {receiptBook}, deposit {depositRef}). Awaiting Finance to match the deposit to the bank statement and cashbook.";
        t.Version++;
        Log(actor, A, t.Id, t.Id, $"Student {sid} · receipt book {receiptBook} · deposit slip {depositRef}");
        return Result.Success();
    }

    public Result VerifyCash(Actor actor, string txnId, bool confirmed)
    {
        const string A = "Verify cash deposit"; var t = TxnById(txnId);
        if (!Can(actor, "verifyCash")) return Deny(actor, A, txnId, txnId, $"{RoleLabel(actor)} cannot verify cash. The collector cannot verify their own collection.");
        if (t == null || t.Kind != "cash") return Block(actor, A, txnId, txnId, "Not a cash record");
        if (t.CashEvidence == null) return Block(actor, A, txnId, txnId, "No receipt-book or deposit evidence recorded yet");
        if (t.ReportedBy == actor.UserId || t.CashEvidence.By == actor.UserId) return Block(actor, A, txnId, txnId, "Separation of duties: whoever reported or evidenced the cash cannot verify it");
        if (!confirmed) return Block(actor, A, txnId, txnId, "Confirm the deposit appears in the bank statement and the cashbook before verifying");
        t.Verification = "verified"; t.Matched = t.CashEvidence.Sid; t.MatchBasis = "Cash receipt-book entry and bank deposit verified by Finance";
        t.Candidates = new() { new Candidate { Sid = t.Matched, Conf = "High", Reasons = { "Deposit verified against bank statement and cashbook" } } };
        t.Exception = "Fee component not specified"; t.VerificationNote = $"Deposit {t.CashEvidence.DepositRef} matched to bank statement and cashbook"; t.Version++;
        Log(actor, A, t.Id, t.Id, t.VerificationNote);
        return Result.Success();
    }

    // ---------- corrections (FR-015): two-person ----------
    public Result RequestCorrection(Actor actor, string allocId, string reason = "")
    {
        const string A = "Request correction"; var a = s.Allocs.FirstOrDefault(x => x.Id == allocId); reason = Clip(reason, 1000);
        if (!Can(actor, "requestCorrection")) return Deny(actor, A, allocId, a?.TxnId, $"{RoleLabel(actor)} cannot request corrections");
        if (a == null || a.Status != "posted") return Block(actor, A, allocId, a?.TxnId, "Only posted allocations can be corrected");
        if (a.CorrReq != null) return Block(actor, A, allocId, a.TxnId, "A correction is already waiting for approval");
        if (reason.Trim().Length < 10) return Block(actor, A, allocId, a.TxnId, "Record why the allocation was wrong (at least 10 characters)");
        a.CorrReq = new CorrectionRequest { By = actor.UserId, Reason = reason, At = Ts() }; TxnById(a.TxnId)!.Version++;
        Log(actor, A, a.Id, a.TxnId, $"{Fmt(a.Amount - a.Reversed)} for {a.Sid} {a.Comp}. Reason: {reason}. Needs a different Finance approver.");
        return Result.Success();
    }

    public Result RejectCorrection(Actor actor, string allocId, string note = "")
    {
        const string A = "Reject correction"; var a = s.Allocs.FirstOrDefault(x => x.Id == allocId);
        if (!Can(actor, "correct")) return Deny(actor, A, allocId, a?.TxnId, $"{RoleLabel(actor)} cannot decide corrections");
        if (a == null || a.CorrReq == null) return Block(actor, A, allocId, a?.TxnId, "No correction request on this allocation");
        if (a.CorrReq.By == actor.UserId) return Block(actor, A, allocId, a.TxnId, "The requester cannot decide their own correction");
        Log(actor, A, a.Id, a.TxnId, Clip(note, 1000) is { Length: > 0 } n ? n : "Rejected"); a.CorrReq = null; TxnById(a.TxnId)!.Version++;
        return Result.Success();
    }

    public Result Correct(Actor actor, string allocId)
    {
        const string A = "Approve correction"; var a = s.Allocs.FirstOrDefault(x => x.Id == allocId);
        if (!Can(actor, "correct")) return Deny(actor, A, allocId, a?.TxnId, $"{RoleLabel(actor)} cannot approve corrections");
        if (a == null || a.Status != "posted") return Block(actor, A, allocId, a?.TxnId, "Only posted allocations can be corrected");
        if (a.CorrReq == null) return Block(actor, A, allocId, a.TxnId, "Request the correction first; a second person approves it");
        if (a.CorrReq.By == actor.UserId) return Block(actor, A, allocId, a.TxnId, "Separation of duties: the person who requested a correction cannot approve it");
        var reason = a.CorrReq.Reason; var net = a.Amount - a.Reversed;
        s.Ledger.Add(new LedgerEntry { Id = "LE-" + Pad(++s.N.L, 4), Key = "corr:" + a.Id, Sid = a.Sid, Comp = a.Comp, Amount = -net, Type = "correction", TxnId = a.TxnId, AllocId = a.Id, Ts = Ts() });
        a.Status = "corrected"; a.CorrectedBy = actor.UserId; a.CorrectionReason = reason; a.CorrectionRequestedBy = a.CorrReq.By; a.CorrReq = null;
        var rc = s.Receipts.FirstOrDefault(x => x.AllocId == a.Id); if (rc != null) { rc.Status = "cancelled"; rc.CancelReason = reason; }
        TxnById(a.TxnId)!.Version++;
        Log(actor, A, a.Id, a.TxnId, $"Compensating entry {Fmt(-net)} for {a.Sid} {a.Comp}. Original allocation kept; receipt {rc?.No} cancelled. Reason: {reason}");
        return Result.Success();
    }

    // ---------- investigation ----------
    public Result RequestEvidence(Actor actor, string txnId, string what)
    {
        var t = TxnById(txnId);
        if (!Can(actor, "evidence")) return Deny(actor, "Request evidence", txnId, txnId, $"{RoleLabel(actor)} cannot request evidence");
        if (t == null) return Result.Fail("Unknown payment");
        what = Clip(what, 1000);
        if (string.IsNullOrWhiteSpace(what)) return Block(actor, "Request evidence", txnId, txnId, "Say what evidence is needed");
        t.Hold = "Waiting on payer"; t.Notes.Add(new Note { By = actor.UserId, At = Ts(), Text = what });
        Log(actor, "Requested evidence", t.Id, t.Id, what);
        return Result.Success();
    }

    public Result Escalate(Actor actor, string txnId, string why)
    {
        var t = TxnById(txnId);
        if (!Can(actor, "escalate")) return Deny(actor, "Escalate", txnId, txnId, $"{RoleLabel(actor)} cannot escalate");
        if (t == null) return Result.Fail("Unknown payment");
        why = Clip(why, 1000);
        t.Hold = "Escalated to Finance"; t.Notes.Add(new Note { By = actor.UserId, At = Ts(), Text = why.Length > 0 ? why : "Escalated" });
        Log(actor, "Escalated to Finance", t.Id, t.Id, why);
        return Result.Success();
    }

    public Result RecheckClaim(Actor actor, string txnId)
    {
        var t = TxnById(txnId);
        if (!Can(actor, "evidence")) return Deny(actor, "Re-check bank feed", txnId, txnId, $"{RoleLabel(actor)} cannot re-check claims");
        if (t == null || t.Kind != "claim") return Result.Fail("Not a claim");
        if (t.Verification == "linked") return Result.Success(new { linked = t.LinkedBankTxn });
        var bank = s.Txns.FirstOrDefault(b => b.Source == "bank" && b.DuplicateOf == null && b.Kind == "payment" && SameId(b.SourceTxnId, t.ClaimedUtr));
        if (bank != null) { LinkClaim(t, bank, actor); return Result.Success(new { linked = bank.Id }); }
        Log(actor, "Re-checked bank feed", t.Id, t.Id, $"UTR {t.ClaimedUtr} still not in verified bank records");
        return Result.Success(new { linked = (string?)null });
    }

    public Result RetryLookup(Actor actor, string txnId)
    {
        var t = TxnById(txnId);
        if (!Can(actor, "propose")) return Deny(actor, "Retry student lookup", txnId, txnId, $"{RoleLabel(actor)} cannot retry lookups");
        if (t == null || t.Kind != "payment" || t.DuplicateOf != null) return Result.Fail("Not a payment");
        if (ActiveNet(t) > 0) return Block(actor, "Retry student lookup", txnId, txnId, "This payment already has allocations; lookup cannot be re-run");
        t.Candidates = new(); t.Exception = null; t.UnknownRef = null; t.Split = null; t.Flags = new(); t.Matched = null;
        Match(t); Dispose(t); t.Version++;
        Log(actor, "Retried student lookup", t.Id, t.Id, t.Matched != null ? $"Now matched to {t.Matched}" : (t.Exception ?? "Still unmatched"));
        return Result.Success();
    }

    public Result RegisterStudent(Actor actor, string id, string name, string contact = "", string guardian = "")
    {
        if (actor != Actor.System && !Can(actor, "students")) return Deny(actor, "Add student", id, "", $"{RoleLabel(actor)} cannot add students");
        id = (id ?? "").Trim().ToUpperInvariant();
        if (!Regex.IsMatch(id, @"^S\d{3}$")) return Result.Fail("Student ID must look like S105");
        if (StudentById(id) != null) return Result.Fail($"{id} already exists");
        name = Clip(name?.Trim(), 80);
        if (name.Length == 0) return Result.Fail("Name required");
        contact = Clip(IdDigits(contact), 4); guardian = Clip(IdDigits(guardian), 4);
        s.Students.Add(MakeStudent(id, name, contact, guardian));
        Log(actor, "Student registration synced from student system", id, "", $"{id} · {name}");
        return Result.Success();
    }

    public Result SubmitClaim(Actor actor, string utr, long amount, string payerName, string file)
    {
        var sid = actor.StudentId;
        if (actor.Role != "student" || StudentById(sid) == null) return Deny(actor, "Submit payment details", "", "", "Only a signed-in student can submit payment details");
        if (amount <= 0 || amount > MaxAmount) return Result.Fail("Enter the amount you paid, in whole rupees");
        utr = Clip((utr ?? "").Trim(), 64);
        if (utr.Length == 0) return Result.Fail("Enter the UTR / transaction reference from your bank or UPI app");
        var dup = s.Txns.FirstOrDefault(t => t.Kind == "claim" && t.StudentHint == sid && SameId(t.ClaimedUtr, utr));
        if (dup != null) return Result.Fail($"You already submitted this reference ({dup.Id})");
        var open = s.Txns.Count(t => t.Kind == "claim" && t.StudentHint == sid && t.Verification == "not_found");
        if (open >= s.Settings.MaxOpenClaims) { Log(actor, "Payment details refused", sid!, "", $"{open} claims already under review", "blocked"); return Result.Fail($"You already have {open} payments under review. Please wait for those to be checked, or raise a mismatch case."); }
        var t2 = Ingest("upload", $"UPLOAD-{sid}-{Pad(s.Txns.Count + 1)}", amount, actor, "Claimed payment", Clip(payerName, 120), studentHint: sid, claimedUtr: utr, screenshot: Clip(file, 120));
        return t2 == null ? Result.Fail("Rejected") : Result.Success(new { txn = t2.Id });
    }

    public Result RaiseCase(Actor actor, string reference, string text)
    {
        var sid = actor.StudentId;
        if (actor.Role != "student" || StudentById(sid) == null) return Deny(actor, "Raise mismatch case", "", "", "Only a signed-in student can raise a mismatch case for themselves");
        if (string.IsNullOrWhiteSpace(text)) return Result.Fail("Describe what looks wrong");
        if (s.Cases.Count(k => k.Sid == sid && k.Status == "open") >= s.Settings.MaxOpenClaims) return Result.Fail("You already have several open cases. Operations will reply to those first.");
        var k = new MismatchCase { Id = "CASE-" + Pad(++s.N.C), Sid = sid!, Ref = Clip(reference, 64), Text = Clip(text, 1000), At = Ts() };
        s.Cases.Add(k);
        Log(actor, "Mismatch case raised", k.Id, k.Ref, $"{(k.Ref.Length > 0 ? k.Ref + ": " : "")}{k.Text}");
        return Result.Success(new { @case = k.Id });
    }

    public Result ResolveCase(Actor actor, string id, string note)
    {
        var k = s.Cases.FirstOrDefault(c => c.Id == id);
        if (!Can(actor, "cases")) return Deny(actor, "Resolve case", id, "", $"{RoleLabel(actor)} cannot resolve cases");
        if (string.IsNullOrWhiteSpace(note)) return Block(actor, "Resolve case", id, "", "Add the resolution the student will see");
        if (k == null || k.Status != "open") return Block(actor, "Resolve case", id, "", "Case not found or already resolved");
        k.Status = "resolved"; k.Resolution = Clip(note, 1000); k.ResolvedBy = actor.UserId;
        Log(actor, "Resolved case", id, k.Ref, k.Resolution);
        return Result.Success();
    }

    public Result SetPolicy(Actor actor, string key, string value)
    {
        if (!Can(actor, "policy")) return Deny(actor, "Change policy", key, "", $"{RoleLabel(actor)} cannot change policy settings");
        string before;
        switch (key)
        {
            case "autoMatch": before = s.Settings.AutoMatch.ToString(); s.Settings.AutoMatch = value == "true"; break;
            case "componentPolicy":
                if (value is not ("none" or "admission-first")) return Result.Fail("Unknown policy value");
                before = s.Settings.ComponentPolicy; s.Settings.ComponentPolicy = value; break;
            case "smsFail": before = s.Settings.SmsFail.ToString(); s.Settings.SmsFail = value == "true"; break;
            case "maxOpenClaims":
                if (!int.TryParse(value, out var n) || n < 1 || n > 50) return Result.Fail("Choose 1 to 50");
                before = s.Settings.MaxOpenClaims.ToString(); s.Settings.MaxOpenClaims = n; break;
            default: return Result.Fail("Unknown setting");
        }
        Log(actor, "Policy setting changed", key, "", $"{before} → {value}");
        return Result.Success();
    }

    public void LogEvent(Actor actor, string action, string entity, string detail, string result = "ok") => Log(actor, action, entity, "", detail, result);

    // ---------- reporting (FR-019) ----------
    public (string key, string label, string tone) Status(Txn t)
    {
        if (t.DuplicateOf != null && t.IdConflict && !t.ConflictClosed) return ("conflict", "Same ID, different amount", "bad");
        if (t.DuplicateOf != null) return ("dup", "Duplicate — not posted", "muted");
        if (t.Kind == "reversal")
        {
            var st = t.Reversal?.State;
            return st switch
            {
                "applied" => ("done", "Reversal applied", "ok"),
                "closed" => ("done", "Reversal closed — not applied", "muted"),
                "exception" => ("rev", "Reversal exception", "bad"),
                _ => ("rev", "Reversal — awaiting approval", "rev"),
            };
        }
        if (t.Kind == "claim") return t.Verification == "linked" ? ("done", $"Claim linked to {t.LinkedBankTxn}", "ok") : ("verify", "Claim — not in bank records", "warn");
        if (t.Verification != "verified") return ("verify", t.CashEvidence != null ? "Cash — evidence with Finance" : "Cash — unverified", "warn");
        var props = s.Proposals.Where(p => p.TxnId == t.Id).ToList();
        if (props.Any(p => p.Status == "post_failed")) return ("approval", "Posting failed — retry", "bad");
        if (props.Any(p => p.Status == "proposed")) return ("approval", "Awaiting approval", "info");
        var free = Allocatable(t);
        if (free <= 0) return ("done", "Allocated and posted", "ok");
        if (ActiveNet(t) > 0) return ("review", $"Partly allocated · {Fmt(free)} left", "info");
        if (t.Split != null && t.Exception == "Split payment") return ("review", "Split — propose lines", "info");
        if (t.Matched != null) return ("review", "Matched — choose fee component", "info");
        if (t.UnknownRef != null) return ("review", "Reference not in student system", "warn");
        if (t.Candidates.Any(c => c.Conf == "High")) return ("review", "Strong candidate — confirm and allocate", "info");
        if (t.Candidates.Count > 0) return ("review", "Candidate — needs evidence", "warn");
        return ("review", "Unmatched — no identifier", "bad");
    }

    public object Totals()
    {
        var pays = s.Txns.Where(t => (t.Kind == "payment" || t.Kind == "cash") && t.DuplicateOf == null).ToList();
        var verified = pays.Where(t => t.Verification == "verified").ToList();
        long feedGross = verified.Sum(t => t.Amount), reversed = verified.Sum(t => t.ReversedApplied), posted = s.Ledger.Sum(l => l.Amount);
        long pending = s.Allocs.Where(a => Pending.Contains(a.Status)).Sum(a => a.Amount - a.Reversed);
        long unalloc = verified.Sum(Allocatable);
        long unverified = pays.Where(t => t.Verification != "verified").Sum(t => t.Amount);
        long claimed = s.Txns.Where(t => t.Kind == "claim" && t.Verification == "not_found").Sum(t => t.Amount);
        return new { feedGross, reversed, net = feedGross - reversed, posted, pending, unalloc, unverified, claimed, diff = feedGross - reversed - posted - pending - unalloc };
    }
    public long ControlDifference()
    {
        var verified = s.Txns.Where(t => (t.Kind == "payment" || t.Kind == "cash") && t.DuplicateOf == null && t.Verification == "verified").ToList();
        return verified.Sum(t => t.Amount) - verified.Sum(t => t.ReversedApplied) - s.Ledger.Sum(l => l.Amount)
            - s.Allocs.Where(a => Pending.Contains(a.Status)).Sum(a => a.Amount - a.Reversed) - verified.Sum(Allocatable);
    }
}
