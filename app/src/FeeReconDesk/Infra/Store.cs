using System.Text.Json;
using System.Text.Json.Serialization;
using FeeReconDesk.Domain;

namespace FeeReconDesk.Infra;

/// <summary>
/// Single JSON file store. All reads and writes go through one lock, so concurrent requests are serialised and
/// every action is all-or-nothing: the state is saved only after the engine call returns, by writing a temp file
/// and atomically replacing the old one. A rolling backup of the previous file is kept.
/// </summary>
public sealed class Store
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = false,
    };

    readonly object gate = new();
    readonly string file;
    readonly ILogger<Store> log;
    AppState state;

    public string DataPath { get; }

    public Store(string dataPath, ILogger<Store> log)
    {
        this.log = log;
        DataPath = Path.GetFullPath(dataPath);
        Directory.CreateDirectory(DataPath);
        file = Path.Combine(DataPath, "fee-recon-desk.json");
        state = Load();
    }

    AppState Load()
    {
        if (!File.Exists(file)) return new AppState();
        try { return JsonSerializer.Deserialize<AppState>(File.ReadAllText(file), Json) ?? new AppState(); }
        catch (Exception ex)
        {
            log.LogError(ex, "Data file is unreadable; refusing to start with an empty book so nothing is overwritten.");
            throw new InvalidOperationException($"The data file {file} could not be read. Restore it from {file}.bak or move it aside to start fresh.", ex);
        }
    }

    void SaveLocked()
    {
        var tmp = file + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(state, Json));
        if (File.Exists(file)) File.Copy(file, file + ".bak", overwrite: true);
        File.Move(tmp, file, overwrite: true);
    }

    /// <summary>Read-only access under the lock.</summary>
    public T Read<T>(Func<AppState, Engine, T> f) { lock (gate) return f(state, new Engine(state)); }

    /// <summary>Run a change under the lock and persist it. Engine refusals are audited, so the state is saved either way.</summary>
    public T Write<T>(Func<AppState, Engine, T> f)
    {
        lock (gate)
        {
            var r = f(state, new Engine(state));
            SaveLocked();
            return r;
        }
    }

    public void Replace(AppState next) { lock (gate) { state = next; SaveLocked(); } }
}
