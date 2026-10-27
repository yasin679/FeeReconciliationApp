using System.Security.Cryptography;
using System.Text;
using FeeReconDesk.Domain;

namespace FeeReconDesk.Infra;

/// <summary>Salted PBKDF2-SHA256 password hashes with constant-time comparison.</summary>
public static class Passwords
{
    public const int Iterations = 210_000;

    public static (string hash, string salt) Hash(string password, int iterations = Iterations)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, 32);
        return (Convert.ToBase64String(hash), Convert.ToBase64String(salt));
    }

    public static bool Verify(string password, User u)
    {
        if (string.IsNullOrEmpty(u.PasswordHash) || string.IsNullOrEmpty(u.Salt)) return false;
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password ?? ""), Convert.FromBase64String(u.Salt), u.Iterations, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(hash, Convert.FromBase64String(u.PasswordHash));
    }

    /// <summary>At least 10 characters and three of: upper case, lower case, digit, symbol.</summary>
    public static string? PolicyError(string? p)
    {
        if (string.IsNullOrEmpty(p) || p.Length < 10) return "Password must be at least 10 characters.";
        if (p.Length > 128) return "Password must be at most 128 characters.";
        int classes = (p.Any(char.IsUpper) ? 1 : 0) + (p.Any(char.IsLower) ? 1 : 0) + (p.Any(char.IsDigit) ? 1 : 0) + (p.Any(c => !char.IsLetterOrDigit(c)) ? 1 : 0);
        return classes < 3 ? "Use at least three of: upper-case letters, lower-case letters, digits, symbols." : null;
    }

    public static string Generate()
    {
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnpqrstuvwxyz", digits = "23456789", sym = "!@#%*?";
        var all = upper + lower + digits;
        var chars = new List<char> { Pick(upper), Pick(lower), Pick(digits), Pick(sym) };
        while (chars.Count < 14) chars.Add(Pick(all));
        return new string(chars.OrderBy(_ => RandomNumberGenerator.GetInt32(1000)).ToArray());
        static char Pick(string set) => set[RandomNumberGenerator.GetInt32(set.Length)];
    }
}

/// <summary>Each audit event carries the hash of the previous one, so any edit or deletion breaks the chain.</summary>
public static class AuditChain
{
    public static string HashOf(AuditEvent e)
    {
        var payload = string.Join("\u001f", e.Id, e.Ts.ToUnixTimeMilliseconds(), e.Actor, e.Person, e.Role, e.Action, e.Entity, e.Txn, e.Detail, e.Result, e.PrevHash);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
    }

    public static (bool ok, long checkedCount, long? brokenAt) Verify(IReadOnlyList<AuditEvent> events)
    {
        var prev = "GENESIS";
        foreach (var e in events)
        {
            if (e.PrevHash != prev || HashOf(e) != e.Hash) return (false, events.Count, e.Id);
            prev = e.Hash;
        }
        return (true, events.Count, null);
    }
}
