using System.Security.Claims;
using System.Threading.RateLimiting;
using FeeReconDesk.Api;
using FeeReconDesk.Domain;
using FeeReconDesk.Infra;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;

if (args.Contains("--selftest"))
{
    var results = SelfTests.Run();
    foreach (var r in results)
    {
        Console.WriteLine($"{(r.Pass ? "PASS" : "FAIL")} {r.Id} {r.Name}");
        foreach (var c in r.Checks.Where(c => !c.Passed)) Console.WriteLine($"     x {c.Description}");
        if (r.Error != null) Console.WriteLine($"     ! {r.Error}");
    }
    Console.WriteLine($"{results.Count(r => r.Pass)}/{results.Count} passing");
    return results.All(r => r.Pass) ? 0 : 1;
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory, WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot") });
var cfg = builder.Configuration;
var dataPath = cfg["DataPath"] is { Length: > 0 } dp ? (Path.IsPathRooted(dp) ? dp : Path.Combine(AppContext.BaseDirectory, dp)) : Path.Combine(AppContext.BaseDirectory, "data");
var loginPerMinute = int.TryParse(cfg["LoginAttemptsPerMinute"], out var lpm) ? Math.Clamp(lpm, 3, 10000) : 30;
var sessionMinutes = int.TryParse(cfg["SessionTimeoutMinutes"], out var sm) ? Math.Clamp(sm, 5, 480) : 30;

builder.WebHost.ConfigureKestrel(k => { k.Limits.MaxRequestBodySize = 6 * 1024 * 1024; k.AddServerHeader = false; });
builder.Services.AddSingleton(sp => new Store(dataPath, sp.GetRequiredService<ILogger<Store>>()));
// Sign-in cookie keys live with the data (encrypted with Windows DPAPI on Windows), so sessions survive restarts.
var dpb = builder.Services.AddDataProtection().SetApplicationName("FeeReconDesk").PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataPath, "keys")));
if (OperatingSystem.IsWindows()) dpb.ProtectKeysWithDpapi();
builder.Services.AddAntiforgery(o => { o.HeaderName = "X-CSRF-TOKEN"; o.Cookie.Name = "frd.csrf"; o.Cookie.SameSite = SameSiteMode.Strict; o.Cookie.HttpOnly = true; o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; });
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "frd.auth"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict; o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromMinutes(sessionMinutes); o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
    // Every request re-checks the account: disabled users, role changes and password resets take effect immediately.
    o.Events.OnValidatePrincipal = async ctx =>
    {
        var store = ctx.HttpContext.RequestServices.GetRequiredService<Store>();
        var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier); var stamp = ctx.Principal?.FindFirstValue("stamp");
        var ok = store.Read((s, _) => s.Users.FirstOrDefault(u => u.Id == id) is { Enabled: true } u && u.Stamp == stamp && u.Role == ctx.Principal?.FindFirstValue(ClaimTypes.Role));
        if (!ok) { ctx.RejectPrincipal(); await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme); }
    };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "x", _ => new FixedWindowRateLimiterOptions { PermitLimit = loginPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("api", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "x", _ => new FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1) }));
});
if (cfg.GetValue<bool>("BehindProxy")) builder.Services.Configure<ForwardedHeadersOptions>(o => o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);

var app = builder.Build();
var store = app.Services.GetRequiredService<Store>();
Bootstrap.Run(store, cfg, app.Logger);

if (cfg.GetValue<bool>("BehindProxy")) app.UseForwardedHeaders();
app.UseExceptionHandler(e => e.Run(async ctx => { ctx.Response.StatusCode = 500; await ctx.Response.WriteAsJsonAsync(new { error = "Something went wrong. The action was not completed." }); }));
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'";
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
    h["Cross-Origin-Opener-Policy"] = "same-origin";
    h["Cross-Origin-Resource-Policy"] = "same-origin";
    if (ctx.Request.IsHttps) h["Strict-Transport-Security"] = "max-age=31536000";
    if (ctx.Request.Path.StartsWithSegments("/api")) h["Cache-Control"] = "no-store";
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
Endpoints.Map(app);

app.Logger.LogInformation("Fee Reconciliation Desk 1.0 · data in {Path}", store.DataPath);
await app.RunAsync();
return 0;
