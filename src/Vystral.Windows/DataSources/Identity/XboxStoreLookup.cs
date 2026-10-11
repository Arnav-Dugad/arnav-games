using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Vystral.Core.Cloud;
using Vystral.Windows.Services;
using Vystral.Windows.Subscriptions;

namespace Vystral.Windows.DataSources.Identity;

/// <summary>
/// What the Microsoft Store says an installed package is (Track E4). Every field was validated.
/// </summary>
/// <param name="ProductId">The Store product ID (BigId) whose package is the one asked about.</param>
/// <param name="Bundles">Products the Store lists as bundles that contain it (editions such as "Standard Edition", which other
/// catalogues often list instead of the base product). Used only as aliases when matching; never shown as the game's own ID.</param>
/// <param name="Poster">2:3 Store art (Poster, else BoxArt) on Microsoft's image CDN.</param>
/// <param name="Hero">Wide key art without the title baked in (SuperHeroArt, else Hero).</param>
/// <param name="Logo">The Store's square logo tile (the largest one).</param>
public sealed record XboxStoreProduct(string ProductId, string Pfn, string? Title, string? Kind, IReadOnlyList<string> Bundles,
    string? Poster, string? Hero, string? Logo);

/// <summary>
/// Track E4: the reverse of Track O's lookup — an installed Xbox package's family name → its Microsoft Store product, through
/// the display catalogue's public lookup by alternate ID (<c>/v7.0/products/lookup?alternateId=PackageFamilyName</c>). Grey:
/// public and unauthenticated (no cookies or special headers), but undocumented for third parties — so it is opt-in
/// (<c>dataSources.xboxStore</c>), on its own spaced lane, size-capped, every field validated, and cached for months.
/// Verified with single low-rate requests on 2026-10-11 (Forza Horizon 4: <c>Microsoft.SunriseBaseGame_8wekyb3d8bbwe</c> →
/// <c>9PNQKHFLD2WQ</c>; an unknown family name answers 200 with an empty <c>Products</c> list).
/// </summary>
public sealed class XboxStoreLookupClient(ProviderTransport transport)
{
    public const string Host = "displaycatalog.mp.microsoft.com";
    /// <summary>Forza Horizon 4 lists 12 bundles; a little room above that.</summary>
    public const int MaxBundles = 16;
    private const int MaxProducts = 5;

    internal static Uri LookupUri(string pfn, string market)
    {
        if (!CloudIds.IsPackageFamilyName(pfn)) throw new ArgumentException("Invalid package family name.", nameof(pfn));
        if (!CloudIds.IsMarket(market)) throw new ArgumentException("Invalid market.", nameof(market));
        // The family name is validated to letters, digits, dots, dashes and one underscore: nothing in it needs escaping.
        return new Uri($"https://{Host}/v7.0/products/lookup?alternateId=PackageFamilyName&value={pfn}&market={market}&languages=en-us&fieldsTemplate=details");
    }

    /// <summary>The product whose package is <paramref name="pfn"/>, or null when the Store doesn't list it.</summary>
    public async Task<XboxStoreProduct?> LookupAsync(string pfn, string market, CancellationToken ct)
    {
        var r = await transport.SendAsync(() => new HttpRequestMessage(HttpMethod.Get, LookupUri(pfn, market)), ct);
        if (r.Status == HttpStatusCode.NotFound) return null;
        if (r.Status != HttpStatusCode.OK) throw new DataSourceException(DataSourceOutcome.Malformed, $"Microsoft Store answered with an unexpected status ({(int)r.Status}).");
        return Parse(r.Body, pfn);
    }

    /// <summary>
    /// Reads the lookup answer. Only a product whose own package family name is the one asked about counts (the Store may
    /// list bundles too); wrong types count as missing. A non-object answer, or one without a <c>Products</c> list, is an error.
    /// </summary>
    internal static XboxStoreProduct? Parse(string json, string pfn)
    {
        using var doc = JsonRead.Parse(json, "Microsoft Store");
        if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("Products", out var products) || products.ValueKind != JsonValueKind.Array)
            throw new DataSourceException(DataSourceOutcome.Malformed, "The Microsoft Store answer couldn’t be read.");
        foreach (var p in products.EnumerateArray().Take(MaxProducts))
        {
            if (p.ValueKind != JsonValueKind.Object) continue;
            var id = JsonRead.Str(p, "ProductId", 20);
            if (!CloudIds.IsProductId(id)) continue;
            var own = JsonRead.Obj(p, "Properties") is { } props ? JsonRead.Str(props, "PackageFamilyName", 140) : null;
            if (own is null || !string.Equals(own, pfn, StringComparison.OrdinalIgnoreCase)) continue;

            var localized = JsonRead.Arr(p, "LocalizedProperties").FirstOrDefault();
            var title = localized.ValueKind == JsonValueKind.Object ? CleanTitle(JsonRead.Str(localized, "ProductTitle", 200)) : null;
            var kind = JsonRead.Str(p, "ProductKind", 30) is { } k && k.All(char.IsAsciiLetter) ? k : null;

            var bundles = new List<string>();
            foreach (var market in JsonRead.Arr(p, "MarketProperties").Take(4))
            foreach (var rel in JsonRead.Arr(market, "RelatedProducts").Take(60))
            {
                if (JsonRead.Str(rel, "RelationshipType", 30) != "Bundle") continue;
                var b = JsonRead.Str(rel, "RelatedProductId", 20);
                if (CloudIds.IsProductId(b) && b != id && !bundles.Contains(b!) && bundles.Count < MaxBundles) bundles.Add(b!);
            }

            string? poster = null, box = null, superHero = null, hero = null, logo = null;
            var logoWidth = 0L;
            if (localized.ValueKind == JsonValueKind.Object)
            {
                foreach (var img in JsonRead.Arr(localized, "Images").Take(80))
                {
                    if (img.ValueKind != JsonValueKind.Object) continue;
                    var purpose = JsonRead.Str(img, "ImagePurpose", 40);
                    if (purpose is not ("Poster" or "BoxArt" or "SuperHeroArt" or "Hero" or "Logo")) continue;
                    if (SubscriptionCatalogClient.SafeImageUrl(JsonRead.Str(img, "Uri", 300)) is not { } url) continue;
                    switch (purpose)
                    {
                        case "Poster": poster ??= url; break;
                        case "BoxArt": box ??= url; break;
                        case "SuperHeroArt": superHero ??= url; break;
                        case "Hero": hero ??= url; break;
                        default:
                            var w = JsonRead.Long(img, "Width") ?? 0;
                            if (logo is null || w > logoWidth) (logo, logoWidth) = (url, w);
                            break;
                    }
                }
            }
            return new XboxStoreProduct(id!, own, title, kind, bundles, poster ?? box, superHero ?? hero, logo);
        }
        return null;
    }

    private static string? CleanTitle(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = new string(s.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return s.Length == 0 ? null : s;
    }
}

/// <summary>One package's answer as cached in <c>provider_cache</c> ("xboxstore", keyed by the lower-case family name).</summary>
public sealed class XboxStoreCacheEntry
{
    public int V { get; set; } = 1;
    public string Pfn { get; set; } = "";
    /// <summary>Null when the Store didn't list the package (a sideloaded or delisted package, or a non-Store app).</summary>
    public string? ProductId { get; set; }
    public string? Title { get; set; }
    public string? Kind { get; set; }
    public List<string> Bundles { get; set; } = [];
    public string? Poster { get; set; }
    public string? Hero { get; set; }
    public string? Logo { get; set; }

    public static XboxStoreCacheEntry From(string pfn, XboxStoreProduct? p) => p is null
        ? new XboxStoreCacheEntry { Pfn = pfn }
        : new XboxStoreCacheEntry { Pfn = pfn, ProductId = p.ProductId, Title = p.Title, Kind = p.Kind, Bundles = p.Bundles.ToList(), Poster = p.Poster, Hero = p.Hero, Logo = p.Logo };

    /// <summary>Reads a cached body back (the database is user-writable): every field is validated again.</summary>
    public static XboxStoreCacheEntry? Read(string body)
    {
        try
        {
            if (body.Length > 16 * 1024) return null;
            var e = JsonSerializer.Deserialize<XboxStoreCacheEntry>(body, JsonFileCache.Options);
            if (e is null || e.V != 1 || !CloudIds.IsPackageFamilyName(e.Pfn)) return null;
            if (!CloudIds.IsProductId(e.ProductId)) return new XboxStoreCacheEntry { Pfn = e.Pfn };
            e.Title = e.Title is { Length: > 0 and <= 200 } t && !t.Any(char.IsControl) ? t : null;
            e.Kind = e.Kind is { Length: > 0 and <= 30 } k && k.All(char.IsAsciiLetter) ? k : null;
            e.Bundles = (e.Bundles ?? []).Where(b => CloudIds.IsProductId(b) && b != e.ProductId).Distinct(StringComparer.Ordinal).Take(XboxStoreLookupClient.MaxBundles).ToList();
            e.Poster = SubscriptionCatalogClient.SafeImageUrl(e.Poster);
            e.Hero = SubscriptionCatalogClient.SafeImageUrl(e.Hero);
            e.Logo = SubscriptionCatalogClient.SafeImageUrl(e.Logo);
            return e;
        }
        catch (JsonException) { return null; }
    }
}

/// <summary>IGDB's game for a Store product (provider_cache "xboxstore-igdb", keyed by product ID). <see cref="Via"/>: product | bundle.</summary>
public sealed class XboxStoreIgdbEntry
{
    public int V { get; set; } = 1;
    public string? Igdb { get; set; }
    public string? Name { get; set; }
    public int? Year { get; set; }
    public string? Steam { get; set; }
    public string? Gog { get; set; }
    public string? Via { get; set; }

    [JsonIgnore]
    public bool Found => Igdb is not null;

    public static XboxStoreIgdbEntry? Read(string body)
    {
        try
        {
            if (body.Length > 4096) return null;
            var e = JsonSerializer.Deserialize<XboxStoreIgdbEntry>(body, JsonFileCache.Options);
            if (e is null || e.V != 1) return null;
            if (!IdKinds.IsValid(IdKinds.Igdb, e.Igdb) || e.Via is not ("product" or "bundle")) return new XboxStoreIgdbEntry();
            e.Name = e.Name is { Length: > 0 and <= 200 } n && !n.Any(char.IsControl) ? n : null;
            e.Year = e.Year is > 1950 and < 2200 ? e.Year : null;
            e.Steam = IdKinds.IsValid(IdKinds.Steam, e.Steam) ? e.Steam : null;
            e.Gog = IdKinds.IsValid(IdKinds.Gog, e.Gog) ? e.Gog : null;
            return e;
        }
        catch (JsonException) { return null; }
    }
}

/// <summary>Track E4: pure rules for turning a Store product ID into evidence, unit-tested.</summary>
public static class XboxStoreEvidence
{
    /// <summary>IGDB's external_game_source ids that carry Microsoft Store product IDs: microsoft (11), xbox_marketplace (31),
    /// xbox_game_pass_ultimate_cloud (54) — api-docs.igdb.com, "External Game Enums" (the old <c>category</c> field is deprecated).</summary>
    public static readonly int[] IgdbSources = [11, 31, 54];

    /// <summary>
    /// The evidence one package's Store product gives:
    /// <list type="bullet">
    /// <item>the product ID itself — certain (the Store's own package lookup);</item>
    /// <item>the Wikidata item whose Microsoft Store product ID (P5885) is the product (0.95) or, only when that finds nothing and
    /// exactly one item carries one of its bundles, that item (0.9) — with the item's Steam, GOG and RAWG IDs;</item>
    /// <item>IGDB's game whose external Microsoft Store entry is the product or (likewise) a bundle, and that game's Steam and GOG
    /// IDs one link further (a little less sure).</item>
    /// </list>
    /// </summary>
    public static IReadOnlyList<IdEvidence> Build(XboxStoreCacheEntry entry, Func<string, (string? Qid, string? Label, IReadOnlyDictionary<string, string> Ids)?> wikidataRow,
        XboxStoreIgdbEntry? igdb)
    {
        if (entry.ProductId is not { } productId) return [];
        var list = new List<IdEvidence> { new(IdKinds.MicrosoftStore, productId, "msstore", "packageLookup", 1.0, entry.Title) };

        // Wikidata: the product first; bundles only when the product has no item and they agree on one.
        (string Qid, string? Label, IReadOnlyDictionary<string, string> Ids, double Conf)? wd = null;
        if (wikidataRow(productId) is { Qid: { } q } own) wd = (q, own.Label, own.Ids, 0.95);
        else
        {
            var viaBundles = entry.Bundles.Select(wikidataRow).Where(r => r is { Qid: not null }).Select(r => r!.Value).ToList();
            if (viaBundles.Select(r => r.Qid).Distinct(StringComparer.Ordinal).Count() == 1) wd = (viaBundles[0].Qid!, viaBundles[0].Label, viaBundles[0].Ids, 0.9);
        }
        if (wd is { } w && IdKinds.IsValid(IdKinds.Wikidata, w.Qid))
        {
            list.Add(new(IdKinds.Wikidata, w.Qid, "wikidata", "storeId", w.Conf, w.Label));
            if (w.Ids.TryGetValue("steam", out var s)) list.Add(new(IdKinds.Steam, s, "wikidata", "storeId", w.Conf, w.Label));
            if (w.Ids.TryGetValue("gogId", out var g)) list.Add(new(IdKinds.Gog, g, "wikidata", "storeId", w.Conf, w.Label));
            if (w.Ids.TryGetValue("rawg", out var r)) list.Add(new(IdKinds.Rawg, r, "wikidata", "storeId", w.Conf, w.Label));
            // Wikidata's IGDB property is a slug, not IGDB's numeric ID, so it isn't evidence for that kind.
        }

        if (igdb is { Found: true } i)
        {
            var c = i.Via == "product" ? 0.95 : 0.9;
            list.Add(new(IdKinds.Igdb, i.Igdb!, "igdb", "storeId", c, i.Name, i.Year));
            if (i.Steam is { } s) list.Add(new(IdKinds.Steam, s, "igdb", "storeId", c - 0.05, i.Name, i.Year));
            if (i.Gog is { } g) list.Add(new(IdKinds.Gog, g, "igdb", "storeId", c - 0.05, i.Name, i.Year));
        }
        return list.Where(e => IdKinds.IsValid(e.Kind, e.Value)).ToList();
    }

    /// <summary>
    /// IGDB's <c>external_games</c> rows for a product and its bundles → one game, the same way as Wikidata: rows for the
    /// product itself first; bundle rows only when they all point at one game. Each game's own Steam and GOG entries come
    /// from the nested <c>game.external_games</c>. An entry without a game when IGDB doesn't know it (or the rows disagree).
    /// </summary>
    public static XboxStoreIgdbEntry ParseIgdb(string json, string productId, IReadOnlyList<string> bundles)
    {
        using var doc = JsonRead.Parse(json, "IGDB");
        if (doc.RootElement.ValueKind != JsonValueKind.Array) throw new DataSourceException(DataSourceOutcome.Malformed, "IGDB’s answer couldn’t be read.");
        var rows = new List<(string Uid, long Game, string? Name, int? Year, string? Steam, string? Gog)>();
        foreach (var row in doc.RootElement.EnumerateArray().Take(60))
        {
            var source = JsonRead.Long(row, "external_game_source") ?? (JsonRead.Obj(row, "external_game_source") is { } src ? JsonRead.Long(src, "id") : null);
            if (source is not { } s || !IgdbSources.Contains((int)s)) continue;
            var uid = JsonRead.Str(row, "uid", 40)?.ToUpperInvariant();
            if (!CloudIds.IsProductId(uid)) continue;
            if (JsonRead.Obj(row, "game") is not { } game || JsonRead.Long(game, "id") is not { } gameId || gameId is not (> 0 and < 1_000_000_000_000)) continue;
            var name = JsonRead.Str(game, "name", 200);
            var released = JsonRead.Long(game, "first_release_date");
            int? year = released is > 0 and < 4102444800 ? DateTimeOffset.FromUnixTimeSeconds(released.Value).Year : null;
            string? steam = null, gog = null;
            foreach (var e in JsonRead.Arr(game, "external_games").Take(60))
            {
                var es = JsonRead.Long(e, "external_game_source") ?? (JsonRead.Obj(e, "external_game_source") is { } esrc ? JsonRead.Long(esrc, "id") : null);
                var euid = JsonRead.Str(e, "uid", 40);
                if (es == 1 && IdKinds.IsValid(IdKinds.Steam, euid)) steam ??= euid;
                if (es == 5 && IdKinds.IsValid(IdKinds.Gog, euid)) gog ??= euid;
            }
            rows.Add((uid!, gameId, name is null ? null : Services.MetadataService.Clean(name, 200), year, steam, gog));
        }
        var own = rows.Where(r => r.Uid == productId).ToList();
        var pool = own.Count > 0 ? own : rows.Where(r => bundles.Contains(r.Uid)).ToList();
        if (pool.Select(r => r.Game).Distinct().Count() != 1) return new XboxStoreIgdbEntry();
        var hit = pool[0];
        return new XboxStoreIgdbEntry
        {
            Igdb = hit.Game.ToString(CultureInfo.InvariantCulture), Name = string.IsNullOrEmpty(hit.Name) ? null : hit.Name, Year = hit.Year,
            Steam = pool.Select(r => r.Steam).FirstOrDefault(x => x is not null), Gog = pool.Select(r => r.Gog).FirstOrDefault(x => x is not null),
            Via = own.Count > 0 ? "product" : "bundle",
        };
    }
}
