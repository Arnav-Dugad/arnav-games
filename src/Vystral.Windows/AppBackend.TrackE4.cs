using Vystral.Core.Providers;
using Vystral.Windows.DataSources;
using Vystral.Windows.DataSources.Identity;
using Vystral.Windows.Services;
using Vystral.Windows.Services.NetworkHealth;

namespace Vystral.Windows;

/// <summary>
/// Track E4: Xbox Store IDs for exact matching. With "Xbox Store details" on (<c>dataSources.xboxStore</c>, off by default),
/// each installed Xbox package is looked up in the Microsoft Store's catalogue, and the product ID it belongs to becomes a
/// certain "Microsoft Store" ID in the cross-store resolver (Track D4), the key for exact Wikidata (P5885) and IGDB matches,
/// an exact product → package map for GeForce NOW's Xbox variants (Track O) and the Game Pass lists (Track V), and the source
/// of Store art for Xbox games whose art is weak.
/// </summary>
public sealed partial class AppBackend
{
    private XboxStoreIdService? _xboxStore;

    private void RegisterTrackE4Handlers()
    {
        if (_identity is null) return;
        var store = _xboxStore = new XboxStoreIdService(Repository, Settings, _dataSources, _dataSources.XboxStore)
        {
            IsGameActive = () => IsGameActive,
            Market = () => _cloud?.Market.Market ?? "US",
            ApplyArt = (gameId, entry, ct) => Artwork.ApplyXboxStoreArtAsync(gameId, entry.Poster, entry.Hero, entry.Logo, ct),
        };
        _identity.StoreEvidence = store.Evidence;
        _identity.StoreLookup = SafeMode ? null : (gameId, refresh, ct) => store.ResolveGameAsync(gameId, refresh, ct);
        if (_cloud is not null) _cloud.InstalledProductPfns = store.ProductPfns;
        if (_subs is not null) _subs.InstalledProductPfns = store.ProductPfns;

        store.Changed += (gameIds, identity) =>
        {
            if (identity)
            {
                foreach (var gameId in gameIds) _identity.LocalEvidenceChanged(gameId);
                _events.Emit("tags.changed", new { done = 0 });
                // Exact product matches can change what streams and what your plans include.
                if (_cloud is { } cloud)
                {
                    cloud.Invalidate();
                    _events.Emit("cloud.changed", cloud.Status());
                }
                if (_subs is { } subs)
                {
                    subs.Invalidate();
                    _events.Emit("subs.changed", subs.Status());
                }
            }
            else _events.Emit("library.changed", new { reason = "artwork" });
        };

        Settings.Changed += key =>
        {
            if (key is not ("*" or XboxStoreIdService.SettingKey)) return;
            _identity.InvalidateAll();
            _events.Emit("identity.changed", new { gameId = (string?)null });
            if (store.Enabled) StartXboxStoreWork(TimeSpan.FromSeconds(5));
        };

        RegisterTrackE4Health();
        StartXboxStoreWork(TimeSpan.FromMinutes(3));
    }

    private void RegisterTrackE4Health()
    {
        _health?.Register(new HealthProbe
        {
            Id = "provider.xboxstore", Label = "Xbox Store details", Purpose = "Exact Microsoft Store IDs and art for your Xbox games",
            Url = new Uri($"https://{XboxStoreLookupClient.Host}/v7.0/products/lookup?alternateId=PackageFamilyName&value=Microsoft.WindowsCalculator_8wekyb3d8bbwe&market=US&languages=en-us&fieldsTemplate=browse"),
            Method = HttpMethod.Get, Visible = ctx => ctx.Setting(XboxStoreIdService.SettingKey),
        });
        ProviderHealthHub.Registry.Register(
            new ProviderDescriptor("xboxstore", "Xbox Store details", "Game details", "xbox-store", "Exact Microsoft Store IDs and art for your Xbox games"),
            () => Settings.GetBool("privacy.localOnly") ? ProviderAvailability.Off("Offline mode is on", true)
                : Settings.GetBool(XboxStoreIdService.SettingKey) ? ProviderAvailability.On(true) : ProviderAvailability.Off("Turned off", true),
            () => { try { return Repository.ProviderCacheStats([XboxStoreIdService.CacheProvider]).Newest; } catch (Microsoft.Data.Sqlite.SqliteException) { return null; } });
    }

    private int _xboxStoreWorkRunning;

    /// <summary>Background, polite and pausable: up to 20 packages a round, every six hours (sooner after a skipped round).</summary>
    private void StartXboxStoreWork(TimeSpan delay)
    {
        if (SafeMode || _xboxStore is null || Interlocked.Exchange(ref _xboxStoreWorkRunning, 1) == 1) return;
        var store = _xboxStore;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(delay, _life.Token);
                while (!_life.IsCancellationRequested && store.Enabled)
                {
                    var ran = false;
                    if (store.BlockReason() is null && !DataSaverActive)
                    {
                        ran = true;
                        try { await store.RefreshLibraryAsync(20, () => IsGameActive || DataSaverActive, _life.Token); }
                        catch (DataSourceException ex) { Log.Warn("xboxstore", "Store lookups stopped for this round", new { outcome = ex.Outcome.ToString() }); }
                    }
                    await Task.Delay(ran ? TimeSpan.FromHours(6) : TimeSpan.FromMinutes(30), _life.Token);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { Log.Warn("xboxstore", "Store lookups failed", ex: ex); }
            finally { Interlocked.Exchange(ref _xboxStoreWorkRunning, 0); }
        });
    }
}
