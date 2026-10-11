using System.Text.Json;
using Vystral.Core.Cloud;
using Vystral.Core.Data;
using Vystral.Windows.Services;

namespace Vystral.Windows.DataSources.Identity;

/// <summary>
/// Track E4: Xbox Store IDs for exact matching. For every installed Xbox package (its family name, from XboxAdapter) the
/// Microsoft Store's own lookup names the product it belongs to (opt-in, <c>dataSources.xboxStore</c>). That product ID is:
/// <list type="bullet">
/// <item>a new, certain ID kind in the cross-store resolver ("Microsoft Store", found by package lookup);</item>
/// <item>the key for exact lookups elsewhere — Wikidata's Microsoft Store product ID (P5885) and IGDB's Microsoft Store
/// external games — which bring the game's Steam app, GOG product, IGDB and Wikidata IDs with high confidence;</item>
/// <item>a product → package map (the product and the bundles that contain it) that makes GeForce NOW's Xbox variants and the
/// Game Pass lists match by ID instead of by title;</item>
/// <item>the source of the Store's own Poster, SuperHeroArt and Logo for Xbox games with weak local art.</item>
/// </list>
/// Answers are cached for months (product IDs don't change), misses for a month. Nothing is fetched in Offline mode or while a
/// game runs; Wikidata and IGDB are asked only when their own switches (and keys) allow it.
/// </summary>
public sealed class XboxStoreIdService
{
    public const string SettingKey = "dataSources.xboxStore";
    public const string CacheProvider = "xboxstore";
    public const string IgdbProvider = "xboxstore-igdb";
    public static readonly TimeSpan FoundTtl = TimeSpan.FromDays(180);
    public static readonly TimeSpan MissTtl = TimeSpan.FromDays(30);
    public static readonly TimeSpan IgdbTtl = TimeSpan.FromDays(60);
    public static readonly TimeSpan IgdbMissTtl = TimeSpan.FromDays(14);

    private readonly LibraryRepository _repo;
    private readonly SettingsService _settings;
    private readonly DataSourcesService _sources;
    private readonly XboxStoreLookupClient _client;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Lock _lock = new();
    private (int Version, IReadOnlyDictionary<string, string> Map)? _pfnMap;
    private int _version;
    private readonly HashSet<string> _artTried = new(StringComparer.Ordinal);

    public Func<bool> IsGameActive { get; set; } = () => false;
    /// <summary>Data saver: Store art waits (lookups are small and still run).</summary>
    public Func<bool> DataSaverActive { get; set; } = () => false;
    /// <summary>The Store market (Track O's: the setting, then the Windows region).</summary>
    public Func<string> Market { get; set; } = () => "US";
    /// <summary>Downloads the Store's art for a game whose art is weak; returns how many images landed. Null = no art.</summary>
    public Func<string, XboxStoreCacheEntry, CancellationToken, Task<int>>? ApplyArt { get; set; }
    /// <summary>Raised with the game IDs whose Store identity (or art) changed.</summary>
    public event Action<IReadOnlyList<string>, bool>? Changed;

    public XboxStoreIdService(LibraryRepository repo, SettingsService settings, DataSourcesService sources, XboxStoreLookupClient client)
    {
        _repo = repo;
        _settings = settings;
        _sources = sources;
        _client = client;
    }

    public bool Enabled => _settings.GetBool(SettingKey);
    private bool LocalOnly => _settings.GetBool("privacy.localOnly");

    public string? BlockReason() => !Enabled ? "off" : LocalOnly ? "offline" : IsGameActive() ? "gameRunning" : null;

    // ---------- What other features read (local only) ----------

    /// <summary>The cached Store answer for a package, fresh or not; null when never asked (or unreadable).</summary>
    public XboxStoreCacheEntry? Cached(string pfn) =>
        CloudIds.IsPackageFamilyName(pfn) && _repo.GetProviderCache(CacheProvider, pfn.ToLowerInvariant()) is { } c ? Checked(XboxStoreCacheEntry.Read(c.Body), pfn) : null;

    private static XboxStoreCacheEntry? Checked(XboxStoreCacheEntry? e, string pfn) =>
        e is not null && string.Equals(e.Pfn, pfn, StringComparison.OrdinalIgnoreCase) ? e : null;

    /// <summary>A library game's Xbox package family names (valid ones only).</summary>
    private IReadOnlyList<string> PackagesOf(string gameId) =>
        _repo.GetInstallations(gameId).Where(i => i.Platform == Core.Domain.PlatformId.Xbox).Select(i => i.PlatformGameId)
            .Where(CloudIds.IsPackageFamilyName).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>The Store product of a library game's Xbox copy, from the cache (the first package the Store listed).</summary>
    public XboxStoreCacheEntry? EntryFor(string gameId) =>
        PackagesOf(gameId).Select(Cached).FirstOrDefault(e => e?.ProductId is not null);

    /// <summary>Evidence for the cross-store resolver: the product ID (certain) and what Wikidata and IGDB say about it.</summary>
    public IReadOnlyList<IdEvidence> Evidence(string gameId)
    {
        if (EntryFor(gameId) is not { ProductId: { } productId } entry) return [];
        var igdb = _repo.GetProviderCache(IgdbProvider, productId) is { } c ? XboxStoreIgdbEntry.Read(c.Body) : null;
        return XboxStoreEvidence.Build(entry, key => _repo.GetExternalIds("microsoft", key) is { } row ? (row.WikidataId, row.Label, row.Ids) : null, igdb);
    }

    /// <summary>
    /// Store product → installed package family name, for exact Game Pass and GeForce NOW matching: each listed package's own
    /// product, plus the bundles that contain it — except bundles that contain more than one of your games (an "A + B bundle").
    /// </summary>
    public IReadOnlyDictionary<string, string> ProductPfns()
    {
        lock (_lock)
        {
            if (_pfnMap is { } m && m.Version == _version) return m.Map;
        }
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        var bundleOwners = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var (key, (body, _, _)) in _repo.GetProviderCacheAll(CacheProvider, 5000))
        {
            if (XboxStoreCacheEntry.Read(body) is not { ProductId: { } id } e || !string.Equals(e.Pfn, key, StringComparison.OrdinalIgnoreCase)) continue;
            map.TryAdd(id, e.Pfn);
            foreach (var b in e.Bundles)
            {
                if (!bundleOwners.TryGetValue(b, out var owners)) bundleOwners[b] = owners = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                owners.Add(e.Pfn);
            }
        }
        foreach (var (bundle, owners) in bundleOwners)
            if (owners.Count == 1) map.TryAdd(bundle, owners.First());
        lock (_lock) _pfnMap = (_version, map);
        return map;
    }

    /// <summary>(gameId, package family name) for every installed Xbox copy in the library.</summary>
    private IReadOnlyList<(string GameId, string Pfn)> AllPackages() =>
        _repo.GetCloudLibrary().SelectMany(g => g.Copies.Where(c => c.Platform == CloudStores.Xbox && CloudIds.IsPackageFamilyName(c.PlatformGameId))
            .Select(c => (g.GameId, c.PlatformGameId))).DistinctBy(x => x.PlatformGameId.ToLowerInvariant()).ToList();

    // ---------- Lookups ----------

    /// <summary>
    /// Looks up one game's Xbox packages when allowed and due (or <paramref name="refresh"/>), then Wikidata and IGDB by the
    /// product, then the Store's art when the game's art is weak. Returns true when anything changed.
    /// </summary>
    public async Task<bool> ResolveGameAsync(string gameId, bool refresh, CancellationToken ct)
    {
        if (BlockReason() is not null) return false;
        var packages = PackagesOf(gameId);
        if (packages.Count == 0) return false;
        await _gate.WaitAsync(ct);
        var changed = false;
        try
        {
            foreach (var pfn in packages)
            {
                if (BlockReason() is not null) break;
                changed |= await ResolvePackageAsync(gameId, pfn, refresh, ct);
            }
        }
        finally
        {
            _gate.Release();
        }
        if (changed) Raise([gameId], identity: true);
        return changed;
    }

    /// <summary>Background: up to <paramref name="max"/> packages never asked or due, politely. Returns how many were asked.</summary>
    public async Task<int> RefreshLibraryAsync(int max, Func<bool> shouldStop, CancellationToken ct)
    {
        if (BlockReason() is not null) return 0;
        var cached = _repo.GetProviderCacheAll(CacheProvider, 5000);
        var due = AllPackages().Where(p => !cached.TryGetValue(p.Pfn.ToLowerInvariant(), out var c) || !c.Fresh).Take(max).ToList();
        var done = 0;
        var touched = new List<string>();
        foreach (var (gameId, pfn) in due)
        {
            if (shouldStop() || BlockReason() is not null) break;
            await _gate.WaitAsync(ct);
            try
            {
                if (await ResolvePackageAsync(gameId, pfn, false, ct)) touched.Add(gameId);
                done++;
            }
            catch (DataSourceException ex) when (ex.Outcome is DataSourceOutcome.RateLimited or DataSourceOutcome.Unavailable or DataSourceOutcome.Offline)
            {
                Log.Warn("xboxstore", "Store lookups paused for this round", new { outcome = ex.Outcome.ToString() });
                break;
            }
            finally
            {
                _gate.Release();
            }
        }
        if (touched.Count > 0) Raise(touched, identity: true);
        return done;
    }

    /// <summary>One package: the Store lookup (when due), then Wikidata and IGDB by product (when due), then art. Caller holds the gate.</summary>
    private async Task<bool> ResolvePackageAsync(string gameId, string pfn, bool refresh, CancellationToken ct)
    {
        var changed = false;
        var key = pfn.ToLowerInvariant();
        var row = _repo.GetProviderCache(CacheProvider, key);
        var entry = row is { } r ? Checked(XboxStoreCacheEntry.Read(r.Body), pfn) : null;
        if (entry is null || refresh || row is not { Fresh: true })
        {
            try
            {
                var product = await _client.LookupAsync(pfn, Market(), ct);
                var fresh = XboxStoreCacheEntry.From(pfn, product);
                changed = entry?.ProductId != fresh.ProductId || entry?.Bundles.Count != fresh.Bundles.Count;
                entry = fresh;
                _repo.SetProviderCache(CacheProvider, key, JsonSerializer.Serialize(entry, JsonFileCache.Options), entry.ProductId is null ? MissTtl : FoundTtl);
                lock (_lock) _version++;
                changed |= row is null;
            }
            catch (DataSourceException ex) when (ex.Outcome is DataSourceOutcome.Malformed)
            {
                // A changed or broken answer: keep what was known, and try again in a while rather than every visit.
                Log.Warn("xboxstore", "The Store's answer couldn't be read", new { outcome = ex.Outcome.ToString() });
                if (entry is null) _repo.SetProviderCache(CacheProvider, key, JsonSerializer.Serialize(XboxStoreCacheEntry.From(pfn, null), JsonFileCache.Options), TimeSpan.FromDays(1));
                return false;
            }
        }
        if (entry.ProductId is not { } productId) return changed;
        var ids = new[] { productId }.Concat(entry.Bundles).ToList();

        // Wikidata by Microsoft Store product ID (P5885), for the product and its bundles, in one query.
        if (_settings.GetBool("dataSources.wikidata") && !LocalOnly && !IsGameActive())
        {
            var now = DateTimeOffset.UtcNow;
            var stale = ids.Where(id => _repo.GetExternalIds("microsoft", id) is not { } x ||
                                        now - x.Fetched > (x.WikidataId is null ? DataSourcesService.IdentityMissTtl : DataSourcesService.IdentityTtl)).ToList();
            if (stale.Count > 0 || refresh)
            {
                try
                {
                    var found = await _sources.Wikidata.LookupAsync("microsoft", refresh ? ids : stale, ct);
                    foreach (var f in found) _repo.UpsertExternalIds("microsoft", f.Key, f.ItemId, f.Label, f.Ids);
                    changed |= found.Any(f => f.ItemId is not null);
                }
                catch (DataSourceException ex) when (ex.Outcome is not DataSourceOutcome.Offline)
                {
                    Log.Warn("xboxstore", "Wikidata couldn't be asked about a Store product", new { outcome = ex.Outcome.ToString() });
                }
            }
        }

        // IGDB's Microsoft Store external games (with your Twitch app).
        if (_sources.ProviderReady("igdb") && (refresh || _repo.GetProviderCache(IgdbProvider, productId) is not { Fresh: true }))
        {
            try
            {
                var igdb = XboxStoreEvidence.ParseIgdb(await _sources.Igdb.FindByMicrosoftStoreIdsAsync(ids, ct), productId, entry.Bundles);
                _repo.SetProviderCache(IgdbProvider, productId, JsonSerializer.Serialize(igdb, JsonFileCache.Options), igdb.Found ? IgdbTtl : IgdbMissTtl);
                changed |= igdb.Found;
            }
            catch (DataSourceException ex) when (ex.Outcome is not DataSourceOutcome.Offline)
            {
                Log.Warn("xboxstore", "IGDB couldn't be asked about a Store product", new { outcome = ex.Outcome.ToString() });
            }
        }

        // The Store's own art, for Xbox games whose art is weak (missing, or only the package's splash and tile images).
        // Tried once per game per run (or when you ask for a fresh look), so a game without Store art isn't asked again on every visit.
        if (ApplyArt is { } art && !IsGameActive() && !DataSaverActive() && (_artTried.Add(gameId) || refresh))
        {
            var landed = await art(gameId, entry, ct);
            if (landed > 0) Raise([gameId], identity: false);
        }
        return changed;
    }

    private void Raise(IReadOnlyList<string> gameIds, bool identity)
    {
        lock (_lock) _version++;
        Changed?.Invoke(gameIds, identity);
    }
}
