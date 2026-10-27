using FeeReconDesk.Domain;

namespace FeeReconDesk.Infra;

/// <summary>First-start setup: admin account, optional demo book and demo accounts.</summary>
public static class Bootstrap
{
    public static void Run(Store store, IConfiguration cfg, ILogger log)
    {
        var demo = cfg.GetValue("EnableDemoData", true);
        var adminPw = Environment.GetEnvironmentVariable("FRD_ADMIN_PASSWORD");
        string? tempAdmin = null, demoPw = null;

        store.Write((s, e) =>
        {
            if (s.Students.Count == 0 && s.Txns.Count == 0 && demo)
            {
                var fresh = Demo.Build(s.Settings);
                Demo.SeedHistory(fresh);
                s.Students = fresh.Students; s.Txns = fresh.Txns; s.Allocs = fresh.Allocs; s.Proposals = fresh.Proposals;
                s.Ledger = fresh.Ledger; s.Receipts = fresh.Receipts; s.Cases = fresh.Cases; s.N = fresh.N; s.Audit = fresh.Audit;
            }

            var admin = s.Users.FirstOrDefault(u => u.UserName == "admin");
            if (admin == null)
            {
                admin = new User { Id = "u-admin", UserName = "admin", DisplayName = "Administrator", Role = "admin", CreatedAt = DateTimeOffset.UtcNow };
                s.Users.Add(admin);
                if (string.IsNullOrEmpty(adminPw)) { tempAdmin = Passwords.Generate(); SetPassword(admin, tempAdmin); }
            }
            if (!string.IsNullOrEmpty(adminPw))
            {
                var err = Passwords.PolicyError(adminPw);
                if (err != null) log.LogWarning("FRD_ADMIN_PASSWORD ignored: {Err}", err);
                else { SetPassword(admin, adminPw); admin.Enabled = true; admin.Role = "admin"; admin.FailedCount = 0; admin.LockedUntil = null; e.LogEvent(Actor.System, "Admin password set at start-up", "admin", "Set from FRD_ADMIN_PASSWORD"); }
            }

            if (demo && !s.Users.Any(u => u.Role != "admin"))
            {
                demoPw = Passwords.Generate();
                foreach (var d in Demo.DemoUsers)
                {
                    var u = new User { Id = d.id, UserName = d.user, DisplayName = d.display, Role = d.role, StudentId = d.sid, CreatedAt = DateTimeOffset.UtcNow };
                    SetPassword(u, demoPw); s.Users.Add(u);
                }
                e.LogEvent(Actor.System, "Demo accounts created", "users", $"{Demo.DemoUsers.Length} demo accounts");
            }
            return 0;
        });

        if (tempAdmin != null) Yellow($"First start: temporary admin password is  {tempAdmin}   (sign in as 'admin' and change it under Settings → My password)");
        if (demoPw != null)
        {
            Yellow($"Demo accounts created. Shared demo password:  {demoPw}");
            Console.WriteLine("  meera (Operations) · priya (Counsellor) · arjun (Finance reviewer) · kavita, rahul (Finance approvers)");
            Console.WriteLine("  ananya, rohan, zara, dev (students S101–S104)");
            Console.WriteLine("  This password is shown only once. An administrator can reset any account later.");
        }
        if (!string.IsNullOrEmpty(adminPw) && Passwords.PolicyError(adminPw) == null) Console.WriteLine("Admin password set from FRD_ADMIN_PASSWORD.");
    }

    public static void SetPassword(User u, string pw)
    {
        var (h, salt) = Passwords.Hash(pw);
        u.PasswordHash = h; u.Salt = salt; u.Iterations = Passwords.Iterations; u.Stamp = Guid.NewGuid().ToString("N");
    }

    static void Yellow(string s) { var c = Console.ForegroundColor; Console.ForegroundColor = ConsoleColor.Yellow; Console.WriteLine(s); Console.ForegroundColor = c; }
}
