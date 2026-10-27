using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FeeReconDesk.Domain;
using FeeReconDesk.Infra;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace FeeReconDesk.Api;

public static class Endpoints
{
    static Actor ActorOf(ClaimsPrincipal p) => new(
        p.FindFirstValue(ClaimTypes.NameIdentifier) ?? "", p.FindFirstValue(ClaimTypes.Name) ?? "",
        p.FindFirstValue(ClaimTypes.Role) ?? "", p.FindFirstValue("sid") is { Length: > 0 } sid ? sid : null);

    static IResult Out(Result r) => r.Ok ? Results.Ok(new { ok = true, data = r.Data }) : Results.Json(new { ok = false, error = r.Error }, statusCode: 400);

    static async Task<bool> CsrfOk(HttpContext ctx)
    {
        try { await ctx.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(ctx); return true; }
        catch (AntiforgeryValidationException) { return false; }
    }

    static readonly User DummyUser = MakeDummy();
    static User MakeDummy() { var u = new User(); var (h, s) = Passwords.Hash(Guid.NewGuid().ToString()); u.PasswordHash = h; u.Salt = s; u.Iterations = Passwords.Iterations; return u; }

    /// <summary>Reads a JSON body; anything malformed, too deep or too large becomes an empty object and fails validation normally.</summary>
    static async Task<JsonElement> Body(HttpContext ctx)
    {
        if (ctx.Request.ContentLength is > 6_000_000) return default;
        try
        {
            using var doc = await JsonDocument.ParseAsync(ctx.Request.Body, new JsonDocumentOptions { MaxDepth = 16 });
            return doc.RootElement.ValueKind == JsonValueKind.Object ? doc.RootElement.Clone() : default;
        }
        catch (Exception ex) when (ex is JsonException or BadHttpRequestException or IOException) { return default; }
    }
    static string S(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Undefined ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ValueKind is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False ? v.ToString() : "") : "";
    static long N(JsonElement e, string k) => long.TryParse(S(e, k).Replace(",", ""), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;
    static int? I(JsonElement e, string k) => int.TryParse(S(e, k), out var n) ? n : null;
    static bool B(JsonElement e, string k) => S(e, k) is "true" or "True";

    public static void Map(WebApplication app)
    {
        var api = app.MapGroup("/api").RequireRateLimiting("api");

        api.MapGet("/csrf", (HttpContext ctx, IAntiforgery af) => Results.Ok(new { token = af.GetAndStoreTokens(ctx).RequestToken }));

        app.MapPost("/api/login", async (HttpContext ctx, Store store) =>
        {
            if (!await CsrfOk(ctx)) return Results.Json(new { ok = false, error = "Your session form expired. Reload the page and try again." }, statusCode: 400);
            var b = await Body(ctx); var userName = Engine.Clip(S(b, "userName").Trim().ToLowerInvariant(), 64); var pw = Engine.Clip(S(b, "password"), 128);
            // The deliberately slow password check runs outside the data lock, so a burst of sign-in attempts cannot stall other users.
            var snap = store.Read((s, _) => s.Users.FirstOrDefault(x => x.UserName == userName) is { } x
                ? new User { Id = x.Id, PasswordHash = x.PasswordHash, Salt = x.Salt, Iterations = x.Iterations } : null);
            var pwOk = Passwords.Verify(pw, snap ?? DummyUser); // same cost for unknown users, so timing does not reveal valid names
            var (ok, err, user) = store.Write((s, e) =>
            {
                var u = s.Users.FirstOrDefault(x => x.UserName == userName);
                var now = DateTimeOffset.UtcNow;
                var who = new Actor(u?.Id ?? "anonymous", u?.DisplayName ?? userName, u?.Role ?? "anonymous");
                const string generic = "User name or password is incorrect.";
                if (u == null) { e.LogEvent(who, "Sign-in failed", userName, "Unknown user", "denied"); return (false, generic, (User?)null); }
                if (!u.Enabled) { e.LogEvent(who, "Sign-in failed", u.UserName, "Account disabled", "denied"); return (false, generic, null); }
                if (u.LockedUntil > now) { e.LogEvent(who, "Sign-in failed", u.UserName, "Account locked", "denied"); return (false, "Too many failed attempts. Try again in a few minutes.", null); }
                if (!pwOk || u.PasswordHash != snap?.PasswordHash)
                {
                    u.FailedCount++;
                    if (u.FailedCount >= 5) { u.LockedUntil = now.AddMinutes(10); u.FailedCount = 0; e.LogEvent(who, "Account locked", u.UserName, "5 failed sign-ins; locked for 10 minutes", "denied"); }
                    else e.LogEvent(who, "Sign-in failed", u.UserName, "Wrong password", "denied");
                    return (false, generic, null);
                }
                u.FailedCount = 0; u.LockedUntil = null; u.LastSignIn = now;
                e.LogEvent(who, "Signed in", u.UserName, ctx.Connection.RemoteIpAddress?.ToString() ?? "");
                return (true, (string?)null, u);
            });
            if (!ok || user == null) return Results.Json(new { ok = false, error = err }, statusCode: 401);
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.Id), new(ClaimTypes.Name, user.DisplayName), new(ClaimTypes.Role, user.Role), new("stamp", user.Stamp) };
            if (user.StudentId != null) claims.Add(new Claim("sid", user.StudentId));
            await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
            return Results.Ok(new { ok = true });
        }).RequireRateLimiting("login");

        api.MapPost("/logout", async (HttpContext ctx, Store store) =>
        {
            if (!await CsrfOk(ctx)) return Results.BadRequest();
            if (ctx.User.Identity?.IsAuthenticated == true) store.Write((s, e) => { e.LogEvent(ActorOf(ctx.User), "Signed out", ActorOf(ctx.User).Name, ""); return 0; });
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new { ok = true });
        });

        api.MapGet("/state", (HttpContext ctx, Store store, IConfiguration cfg) =>
            Results.Content(store.Read((s, e) => Snapshot.Build(s, e, ActorOf(ctx.User), cfg.GetValue("EnableDemoData", true))), "application/json")).RequireAuthorization();

        api.MapPost("/act/{name}", async (string name, HttpContext ctx, Store store) =>
        {
            if (!await CsrfOk(ctx)) return Results.Json(new { ok = false, error = "Security check failed. Reload the page and try again." }, statusCode: 400);
            var b = await Body(ctx); var a = ActorOf(ctx.User);
            return Out(store.Write((s, e) => name switch
            {
                "propose" => e.Propose(a, S(b, "txnId"), b.ValueKind == JsonValueKind.Object && b.TryGetProperty("rows", out var rows) && rows.ValueKind == JsonValueKind.Array
                    ? rows.EnumerateArray().Take(20).Select(r => new AllocLine(S(r, "sid"), S(r, "comp"), N(r, "amount"))).ToList() : new(), S(b, "reason"), S(b, "evidence"), I(b, "version")),
                "approve" => e.Approve(a, S(b, "propId"), S(b, "note")),
                "reject" => e.Reject(a, S(b, "propId"), S(b, "reason")),
                "retry" => e.Retry(a, S(b, "propId")),
                "applyReversal" => e.ApplyReversal(a, S(b, "txnId"), S(b, "note")),
                "closeReversal" => e.CloseReversal(a, S(b, "txnId"), S(b, "note")),
                "relinkReversal" => e.RelinkReversal(a, S(b, "txnId")),
                "closeConflict" => e.CloseConflict(a, S(b, "txnId"), S(b, "note")),
                "reportCash" => e.ReportCash(a, N(b, "amount"), S(b, "sid"), S(b, "remark")),
                "recordCashEvidence" => e.RecordCashEvidence(a, S(b, "txnId"), S(b, "sid"), S(b, "receiptBook"), S(b, "depositRef")),
                "verifyCash" => e.VerifyCash(a, S(b, "txnId"), B(b, "confirmed")),
                "requestCorrection" => e.RequestCorrection(a, S(b, "allocId"), S(b, "reason")),
                "correct" => e.Correct(a, S(b, "allocId")),
                "rejectCorrection" => e.RejectCorrection(a, S(b, "allocId"), S(b, "note")),
                "requestEvidence" => e.RequestEvidence(a, S(b, "txnId"), S(b, "text")),
                "escalate" => e.Escalate(a, S(b, "txnId"), S(b, "text")),
                "recheckClaim" => e.RecheckClaim(a, S(b, "txnId")),
                "retryLookup" => e.RetryLookup(a, S(b, "txnId")),
                "submitClaim" => e.SubmitClaim(a, S(b, "utr"), N(b, "amount"), S(b, "payerName"), S(b, "file")),
                "raiseCase" => e.RaiseCase(a, S(b, "ref"), S(b, "text")),
                "resolveCase" => e.ResolveCase(a, S(b, "id"), S(b, "note")),
                "setPolicy" => e.SetPolicy(a, S(b, "key"), S(b, "value")),
                "registerStudent" => e.RegisterStudent(a, S(b, "id"), S(b, "name"), S(b, "contact"), S(b, "guardian")),
                _ => Result.Fail("Unknown action"),
            }));
        }).RequireAuthorization();

        // Bank statement import: the only way bank money enters the system, and Finance-only.
        api.MapPost("/import/bank", async (HttpContext ctx, Store store) =>
        {
            if (!await CsrfOk(ctx)) return Results.Json(new { ok = false, error = "Security check failed. Reload the page and try again." }, statusCode: 400);
            var a = ActorOf(ctx.User);
            var b = await Body(ctx); var csv = S(b, "csv"); var fileName = Engine.Clip(S(b, "fileName"), 80);
            if (csv.Length > 5_000_000) return Results.Json(new { ok = false, error = "File too large (5 MB maximum)." }, statusCode: 413);
            return Out(store.Write((s, e) =>
            {
                if (!e.Can(a, "importBank")) { e.LogEvent(a, "Import bank statement", fileName, $"{Engine.RoleLabel(a)} cannot import bank statements", "denied"); return Result.Fail("Only Finance can import bank statements."); }
                var parsed = Csv.ParseBank(csv, out var error);
                if (error != null) { e.LogEvent(a, "Import bank statement", fileName, error, "blocked"); return Result.Fail(error); }
                int imported = 0, dup = 0, conflict = 0, rejected = 0; var ids = new List<string>();
                var batch = fileName.Length > 0 ? fileName : "Upload " + DateTimeOffset.UtcNow.ToString("dd MMM HH:mm", CultureInfo.InvariantCulture);
                foreach (var ev in parsed)
                {
                    var t = e.IngestBank(ev with { Batch = batch }, a);
                    if (t == null) rejected++; else if (t.IdConflict) { conflict++; ids.Add(t.Id); } else if (t.DuplicateOf != null) { dup++; ids.Add(t.Id); } else { imported++; ids.Add(t.Id); }
                }
                rejected += Csv.LastRejected;
                e.LogEvent(a, "Bank statement imported", batch, $"{imported} new · {dup} duplicates · {conflict} ID conflicts · {rejected} rejected rows");
                return Result.Success(new { imported, duplicates = dup, conflicts = conflict, rejected, ids });
            }));
        }).RequireAuthorization();

        api.MapGet("/export/reconciliation.csv", (HttpContext ctx, Store store) =>
        {
            var a = ActorOf(ctx.User);
            var csv = store.Write((s, e) =>
            {
                if (!e.Can(a, "export")) { e.LogEvent(a, "Export reconciliation", "", "Not permitted", "denied"); return null; }
                e.LogEvent(a, "Export reconciliation", "reconciliation.csv", $"{s.Txns.Count} payment events");
                return Csv.Reconciliation(s, e);
            });
            return csv == null ? Results.StatusCode(403) : Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(), "text/csv", "reconciliation.csv");
        }).RequireAuthorization();

        api.MapGet("/selftest", (HttpContext ctx, Store store) =>
        {
            var a = ActorOf(ctx.User);
            if (!store.Read((s, e) => e.Can(a, "selftest"))) return Results.StatusCode(403);
            return Results.Ok(SelfTests.Run());
        }).RequireAuthorization();

        api.MapGet("/audit/verify", (HttpContext ctx, Store store) =>
        {
            var a = ActorOf(ctx.User);
            return store.Read((s, e) =>
            {
                if (!e.Can(a, "viewAudit")) return Results.StatusCode(403);
                var (ok, count, broken) = AuditChain.Verify(s.Audit);
                return Results.Ok(new { ok, count, brokenAt = broken });
            });
        }).RequireAuthorization();

        // ---------- users ----------
        api.MapGet("/users", (HttpContext ctx, Store store) =>
        {
            var a = ActorOf(ctx.User);
            return store.Read((s, e) => !e.Can(a, "users") ? Results.StatusCode(403) : Results.Ok(s.Users.Select(u => new { u.Id, u.UserName, u.DisplayName, u.Role, u.StudentId, u.Enabled, locked = u.LockedUntil > DateTimeOffset.UtcNow, u.LastSignIn, u.CreatedAt })));
        }).RequireAuthorization();

        api.MapPost("/users/{op}", async (string op, HttpContext ctx, Store store) =>
        {
            if (!await CsrfOk(ctx)) return Results.Json(new { ok = false, error = "Security check failed. Reload the page and try again." }, statusCode: 400);
            var a = ActorOf(ctx.User); var b = await Body(ctx);
            return Out(store.Write((s, e) =>
            {
                if (op == "my-password")
                {
                    var me = s.Users.FirstOrDefault(u => u.Id == a.UserId);
                    if (me == null) return Result.Fail("Not signed in");
                    if (!Passwords.Verify(S(b, "current"), me)) { e.LogEvent(a, "Change own password", me.UserName, "Current password wrong", "denied"); return Result.Fail("Current password is incorrect."); }
                    var perr = Passwords.PolicyError(S(b, "next")); if (perr != null) return Result.Fail(perr);
                    Bootstrap.SetPassword(me, S(b, "next")); e.LogEvent(a, "Changed own password", me.UserName, "");
                    return Result.Success(new { signOut = true });
                }
                if (!e.Can(a, "users")) { e.LogEvent(a, "Manage users", op, "Not permitted", "denied"); return Result.Fail("Only an administrator can manage users."); }
                var roles = new[] { "ops", "counsellor", "finrev", "finapp", "admin", "student" };
                if (op == "add")
                {
                    var userName = S(b, "userName").Trim().ToLowerInvariant();
                    if (!System.Text.RegularExpressions.Regex.IsMatch(userName, "^[a-z0-9._-]{3,32}$")) return Result.Fail("User name: 3–32 characters, letters, digits, dot, dash or underscore.");
                    if (s.Users.Any(u => u.UserName == userName)) return Result.Fail("That user name is taken.");
                    var role = S(b, "role"); if (!roles.Contains(role)) return Result.Fail("Choose a role.");
                    var sid = role == "student" ? S(b, "studentId").Trim().ToUpperInvariant() : null;
                    if (role == "student" && e.StudentById(sid) == null) return Result.Fail("Link the account to an existing student ID.");
                    if (role == "student" && s.Users.Any(u => u.StudentId == sid && u.Enabled)) return Result.Fail("That student already has an account.");
                    var display = Engine.Clip(S(b, "displayName").Trim(), 60); if (display.Length == 0) return Result.Fail("Enter a display name.");
                    var pw = Passwords.Generate();
                    var u = new User { Id = "u-" + Guid.NewGuid().ToString("N")[..10], UserName = userName, DisplayName = display, Role = role, StudentId = sid, CreatedAt = DateTimeOffset.UtcNow };
                    Bootstrap.SetPassword(u, pw); s.Users.Add(u);
                    e.LogEvent(a, "User added", userName, $"{display} · {Engine.RoleLabels[role]}{(sid != null ? " · " + sid : "")}");
                    return Result.Success(new { tempPassword = pw });
                }
                var target = s.Users.FirstOrDefault(u => u.Id == S(b, "id"));
                if (target == null) return Result.Fail("Unknown user");
                switch (op)
                {
                    case "role":
                        var nr = S(b, "role"); if (!roles.Contains(nr) || nr == "student") return Result.Fail("Choose a staff role.");
                        if (target.Role == "student") return Result.Fail("Student accounts keep the student role.");
                        if (target.Id == a.UserId && nr != "admin") return Result.Fail("You cannot remove your own administrator access.");
                        e.LogEvent(a, "Role changed", target.UserName, $"{target.Role} → {nr}"); target.Role = nr; target.Stamp = Guid.NewGuid().ToString("N"); return Result.Success();
                    case "disable":
                        if (target.Id == a.UserId) return Result.Fail("You cannot disable your own account.");
                        target.Enabled = false; target.Stamp = Guid.NewGuid().ToString("N"); e.LogEvent(a, "User disabled", target.UserName, ""); return Result.Success();
                    case "enable":
                        target.Enabled = true; target.FailedCount = 0; target.LockedUntil = null; e.LogEvent(a, "User enabled", target.UserName, ""); return Result.Success();
                    case "reset-password":
                        var pw = Passwords.Generate(); Bootstrap.SetPassword(target, pw); target.FailedCount = 0; target.LockedUntil = null;
                        e.LogEvent(a, "Password reset", target.UserName, "Temporary password issued"); return Result.Success(new { tempPassword = pw });
                    default: return Result.Fail("Unknown operation");
                }
            }));
        }).RequireAuthorization();

        api.MapPost("/admin/reset-demo", async (HttpContext ctx, Store store, IConfiguration cfg) =>
        {
            if (!await CsrfOk(ctx)) return Results.BadRequest();
            var a = ActorOf(ctx.User);
            if (!cfg.GetValue("EnableDemoData", true)) return Results.Json(new { ok = false, error = "Demo data is switched off on this installation." }, statusCode: 400);
            return Out(store.Write((s, e) =>
            {
                if (!e.Can(a, "users")) { e.LogEvent(a, "Reset demo data", "", "Not permitted", "denied"); return Result.Fail("Only an administrator can reset the demo."); }
                var fresh = Demo.Build(s.Settings); Demo.SeedHistory(fresh);
                var keepAudit = s.Audit;
                s.Students = fresh.Students; s.Txns = fresh.Txns; s.Allocs = fresh.Allocs; s.Proposals = fresh.Proposals; s.Ledger = fresh.Ledger; s.Receipts = fresh.Receipts; s.Cases = fresh.Cases;
                var au = s.N.Au; s.N = fresh.N; s.N.Au = au; s.Audit = keepAudit;
                e.LogEvent(a, "Demo data reset", "demo", "Sample book restored (P1–P9). Audit history kept.");
                return Result.Success();
            }));
        }).RequireAuthorization();
    }
}
