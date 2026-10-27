using System.Globalization;
using System.Text;
using FeeReconDesk.Domain;

namespace FeeReconDesk.Api;

public static class Csv
{
    [ThreadStatic] public static int LastRejected;

    /// <summary>Parses a bank statement. Required columns: TransactionId, Amount. Optional: Date, Channel, PayerName, PayerContact, Remark, ReversalOf.</summary>
    public static List<BankEvent> ParseBank(string csv, out string? error)
    {
        error = null; LastRejected = 0; var list = new List<BankEvent>();
        var rows = Parse(csv);
        if (rows.Count < 2) { error = "The file has no data rows. The first row must be headers."; return list; }
        if (rows.Count > 20001) { error = "Too many rows (20,000 maximum per file)."; return list; }
        var h = rows[0].Select(x => x.Trim().ToLowerInvariant().Replace(" ", "").Replace("_", "")).ToList();
        int Col(params string[] names) { foreach (var n in names) { var i = h.IndexOf(n); if (i >= 0) return i; } return -1; }
        int cId = Col("transactionid", "txnid", "utr", "reference", "referenceno"), cAmt = Col("amount", "credit", "amountinr");
        int cDate = Col("date", "valuedate", "transactiondate"), cCh = Col("channel", "mode"), cPayer = Col("payername", "payer", "remitter"),
            cContact = Col("payercontact", "contact", "mobile"), cRemark = Col("remark", "narration", "description", "note"), cRev = Col("reversalof", "originaltransactionid");
        if (cId < 0 || cAmt < 0) { error = "Missing required columns. The file needs TransactionId and Amount (Date, Channel, PayerName, PayerContact, Remark, ReversalOf are optional)."; return list; }
        string Get(List<string> r, int i) => i >= 0 && i < r.Count ? r[i].Trim() : "";
        foreach (var r in rows.Skip(1))
        {
            if (r.All(string.IsNullOrWhiteSpace)) continue;
            var raw = Get(r, cAmt).Replace(",", "").Replace("₹", "").Replace("INR", "").Trim();
            if (!decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var amt) || amt != decimal.Truncate(amt) || amt == 0 || Math.Abs(amt) > Engine.MaxAmount || Get(r, cId).Length == 0) { LastRejected++; continue; }
            DateTimeOffset? when = null;
            if (DateTimeOffset.TryParse(Get(r, cDate), CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var d)) when = d;
            else if (DateTime.TryParseExact(Get(r, cDate), new[] { "dd-MM-yyyy", "dd/MM/yyyy", "dd-MMM-yyyy", "dd MMM yyyy" }, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var d2)) when = d2;
            list.Add(new BankEvent(Get(r, cId), (long)amt, Get(r, cCh) is { Length: > 0 } ch ? ch : "Bank feed", Get(r, cPayer), Get(r, cContact), Get(r, cRemark), Get(r, cRev), "", when));
        }
        return list;
    }

    static List<List<string>> Parse(string text)
    {
        var rows = new List<List<string>>(); var row = new List<string>(); var sb = new StringBuilder(); var q = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (q) { if (c == '"') { if (i + 1 < text.Length && text[i + 1] == '"') { sb.Append('"'); i++; } else q = false; } else sb.Append(c); continue; }
            switch (c)
            {
                case '"': q = true; break;
                case ',': row.Add(sb.ToString()); sb.Clear(); break;
                case '\r': break;
                case '\n': row.Add(sb.ToString()); sb.Clear(); rows.Add(row); row = new List<string>(); break;
                default: sb.Append(c); break;
            }
        }
        if (sb.Length > 0 || row.Count > 0) { row.Add(sb.ToString()); rows.Add(row); }
        return rows;
    }

    /// <summary>Cells that start with = + - @ or a control character are prefixed so spreadsheets never run them as formulas.</summary>
    public static string Cell(object? v)
    {
        var s = Convert.ToString(v, CultureInfo.InvariantCulture) ?? "";
        if (s.Length > 0 && "=+-@\t\r".Contains(s[0]) && !decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out _)) s = "'" + s;
        return s.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }

    public static string Reconciliation(AppState s, Engine e)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Payment,Received,Source,Bank transaction ID,Amount,Reversed,Verification,Status,Matched student,Allocations,Unallocated,Exception");
        foreach (var t in s.Txns)
        {
            var allocs = string.Join("; ", s.Allocs.Where(a => a.TxnId == t.Id && a.Status != "rejected").Select(a => $"{a.Sid} {a.Comp} {a.Amount - a.Reversed} ({a.Status})"));
            sb.AppendLine(string.Join(",", new object?[] { t.Id, t.ReceivedAt.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture), t.Source, t.SourceTxnId, t.Amount, t.ReversedApplied, t.Verification, e.Status(t).label, t.Matched, allocs, e.Allocatable(t), t.Exception }.Select(Cell)));
        }
        sb.AppendLine();
        sb.AppendLine("Control difference (must be 0)," + e.ControlDifference().ToString(CultureInfo.InvariantCulture));
        return sb.ToString();
    }
}
