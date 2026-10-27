namespace FeeReconDesk.Domain;

/// <summary>Sample book: four students and nine payment events covering every reconciliation case.</summary>
public static class Demo
{
    public static readonly (string id, string name, string contact, string guardian)[] Students =
    {
        ("S101", "Ananya Kapoor", "2140", "9081"),
        ("S102", "Rohan Mehta", "2189", "9874"),
        ("S103", "Zara Ali", "4408", "1172"),
        ("S104", "Dev Nair", "6622", "5482"),
    };

    static DateTimeOffset D(string s) => DateTimeOffset.Parse(s + "+05:30");

    public static AppState Build(Policy? policy = null)
    {
        var s = new AppState { Settings = policy ?? new Policy() };
        var e = new Engine(s);
        foreach (var st in Students) s.Students.Add(e.MakeStudent(st.id, st.name, st.contact, st.guardian));
        void At(string when, Action a) { e.Clock = D(when); a(); }

        At("2026-10-19T10:18:00", () => e.IngestBank(new("UPI/430219884120", 10000, "UPI", "", "7731", "S101", "", "BANK-STMT-19OCT", D("2026-10-19T10:14:00"), "P1"), Actor.System));
        At("2026-10-19T15:44:00", () => e.IngestBank(new("NEFT/N293260551901", 20000, "Bank transfer", "R Mehta", "", "COLLEGE FEES", "", "BANK-STMT-19OCT", D("2026-10-19T15:40:00"), "P2"), Actor.System));
        At("2026-10-20T09:06:00", () => e.IngestBank(new("UPI/430312902337", 15000, "UPI", "", "", "S103", "", "BANK-STMT-20OCT", D("2026-10-20T09:02:00"), "P3"), Actor.System));
        At("2026-10-20T10:20:00", () => e.IngestBank(new("UPI/430219884120", 10000, "UPI", "", "7731", "S101", "", "BANK-STMT-20OCT (re-import)", D("2026-10-19T10:14:00"), "P4"), Actor.System));
        var counsellor = new Actor("u-counsellor", "Priya S.", "counsellor");
        At("2026-10-21T12:34:00", () => e.Ingest("cash", "CASH-RPT-0041", 10000, counsellor, "Cash", remark: "Counsellor reports cash collected at centre", batch: "Counsellor entry", receivedAt: D("2026-10-21T12:30:00"), reference: "P5"));
        At("2026-10-21T16:09:00", () => e.IngestBank(new("NEFT/N294261007733", 30000, "Bank transfer", "", "", "S101 15000 / S104 15000", "", "BANK-STMT-21OCT", D("2026-10-21T16:05:00"), "P6"), Actor.System));
        var rohan = new Actor("u-s102", "Rohan Mehta", "student", "S102");
        At("2026-10-22T19:24:00", () => e.Ingest("upload", "UPLOAD-S102-001", 20000, rohan, "UPI (claimed)", reference: "P7", studentHint: "S102", claimedUtr: "UPI/430618771204", screenshot: "gpay_receipt_20000.jpg", receivedAt: D("2026-10-22T19:20:00")));
        At("2026-10-23T11:49:00", () => e.IngestBank(new("RVSL/430712008711", -5000, "UPI reversal", "", "", "Partial reversal of P3", "UPI/430312902337", "BANK-STMT-23OCT", D("2026-10-23T11:45:00"), "P8"), Actor.System));
        At("2026-10-24T14:14:00", () => e.IngestBank(new("IMPS/430815344201", 25000, "Bank transfer", "Dev Nair", "", "", "", "BANK-STMT-24OCT", D("2026-10-24T14:10:00"), "P9"), Actor.System));
        e.Clock = null;
        return s;
    }

    /// <summary>Demo history: P3 already allocated and posted, so the P8 reversal has something to adjust.</summary>
    public static void SeedHistory(AppState s)
    {
        var e = new Engine(s);
        var ops = new Actor("u-ops", "Meera J.", "ops"); var fin = new Actor("u-finapp", "Kavita R.", "finapp");
        e.Clock = DateTimeOffset.Parse("2026-10-20T11:30:00+05:30");
        var r = e.Propose(ops, "P3", new() { new("S103", "Tuition", 15000) }, "Valid student ID S103 in UPI reference; student confirmed tuition instalment");
        e.Clock = DateTimeOffset.Parse("2026-10-20T15:05:00+05:30");
        if (r.Ok) e.Approve(fin, s.Proposals[^1].Id, "Reference verified");
        e.Clock = null;
    }

    public static readonly (string id, string user, string display, string role, string? sid)[] DemoUsers =
    {
        ("u-ops", "meera", "Meera J.", "ops", null),
        ("u-counsellor", "priya", "Priya S.", "counsellor", null),
        ("u-finrev", "arjun", "Arjun K.", "finrev", null),
        ("u-finapp", "kavita", "Kavita R.", "finapp", null),
        ("u-finapp2", "rahul", "Rahul P.", "finapp", null),
        ("u-s101", "ananya", "Ananya Kapoor", "student", "S101"),
        ("u-s102", "rohan", "Rohan Mehta", "student", "S102"),
        ("u-s103", "zara", "Zara Ali", "student", "S103"),
        ("u-s104", "dev", "Dev Nair", "student", "S104"),
    };
}
