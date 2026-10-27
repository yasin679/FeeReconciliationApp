using System.Text.Json;
using FeeReconDesk.Domain;
using FeeReconDesk.Infra;

namespace FeeReconDesk.Api;

/// <summary>
/// What each role is allowed to see. Filtering happens here on the server: a student's browser never
/// receives other students, college totals, staff names, bank linkage or the audit log.
/// </summary>
public static class Snapshot
{
    public static string Build(AppState s, Engine e, Actor me, bool demo)
    {
        var perms = Engine.Perms.Where(p => p.Value.Contains(me.Role)).Select(p => p.Key).ToList();
        var meObj = new { id = me.UserId, name = me.Name, role = me.Role, roleLabel = Engine.RoleLabel(me), studentId = me.StudentId, perms };
        object payload;
        if (me.Role == "student") payload = ForStudent(s, e, me, meObj, demo);
        else
        {
            var fullAudit = e.Can(me, "viewAudit");
            payload = new
            {
                mode = "server", demo, me = meObj,
                people = s.Users.ToDictionary(u => u.Id, u => new { name = u.DisplayName, role = u.Role }),
                settings = s.Settings, students = s.Students, txns = s.Txns, allocs = s.Allocs, proposals = s.Proposals,
                ledger = s.Ledger, receipts = s.Receipts, cases = s.Cases,
                // Operations and counsellors get payment history only; the full log (sign-ins, users, policy) is Finance/Admin.
                audit = fullAudit ? s.Audit.Select(Slim) : s.Audit.Where(a => a.Txn.Length > 0).Select(Slim),
            };
        }
        return JsonSerializer.Serialize(payload, Store.Json);
    }

    static object Slim(AuditEvent a) => new { a.Id, a.Ts, a.Actor, a.Person, a.Role, a.Action, a.Entity, a.Txn, a.Detail, a.Result };

    static object ForStudent(AppState s, Engine e, Actor me, object meObj, bool demo)
    {
        var sid = me.StudentId ?? "";
        var allocs = s.Allocs.Where(a => a.Sid == sid).Select(a => new { a.Id, a.TxnId, a.PropId, a.Sid, a.Comp, a.Amount, a.Reversed, a.Status, overpay = false }).ToList();
        var postedTxns = s.Allocs.Where(a => a.Sid == sid && a.Status == "posted").Select(a => a.TxnId).ToHashSet();
        var txns = new List<object>();
        foreach (var t in s.Txns)
        {
            if (t.Kind == "claim" && t.StudentHint == sid)
            {
                // A student learns that money was found only once it is allocated to them, so claims can't probe for other people's payments.
                var mine = t.LinkedBankTxn != null && postedTxns.Contains(t.LinkedBankTxn);
                txns.Add(new
                {
                    t.Id, t.Kind, t.Amount, t.ClaimedUtr, t.ReceivedAt, t.StudentHint, source = "upload", channel = "Claimed payment",
                    verification = mine ? "linked" : "not_found", linkedBankTxn = mine ? t.LinkedBankTxn : null,
                    candidates = Array.Empty<object>(), flags = Array.Empty<string>(), notes = Array.Empty<object>(), linkedClaims = Array.Empty<string>(),
                });
            }
            else if (t.Kind == "cash" && t.Verification != "verified" && (t.CashEvidence?.Sid == sid || t.Candidates.Any(c => c.Sid == sid)))
                txns.Add(new { t.Id, t.Kind, t.Amount, t.Verification, t.ReceivedAt, source = "cash", channel = "Cash", candidates = new[] { new { sid, conf = "Medium", reasons = Array.Empty<string>() } }, flags = Array.Empty<string>(), notes = Array.Empty<object>(), linkedClaims = Array.Empty<string>() });
            else if (allocs.Any(a => a.TxnId == t.Id))
                txns.Add(new { t.Id, t.Kind, t.SourceTxnId, t.Channel, t.ReceivedAt, amount = allocs.Where(a => a.TxnId == t.Id).Sum(a => a.Amount), source = t.Source, verification = "verified", candidates = Array.Empty<object>(), flags = Array.Empty<string>(), notes = Array.Empty<object>(), linkedClaims = Array.Empty<string>() });
        }
        return new
        {
            mode = "server", demo, me = meObj, people = new Dictionary<string, object>(),
            settings = new { s.Settings.MaxOpenClaims },
            students = s.Students.Where(x => x.Id == sid),
            txns, allocs,
            proposals = s.Proposals.Where(p => allocs.Any(a => a.PropId == p.Id)).Select(p => new { p.Id, p.TxnId, p.Status, allocIds = p.AllocIds.Where(id => allocs.Any(a => a.Id == id)) }),
            ledger = s.Ledger.Where(l => l.Sid == sid),
            receipts = s.Receipts.Where(r => r.Sid == sid),
            cases = s.Cases.Where(c => c.Sid == sid),
            audit = Array.Empty<object>(),
        };
    }
}
