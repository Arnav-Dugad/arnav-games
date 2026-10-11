using Vystral.Core.Cloud;
using Vystral.Windows.DataSources.Identity;

namespace Vystral.Windows.DataSources;

/// <summary>Track E4: IGDB's games by Microsoft Store product ID (exact, not by title).</summary>
public sealed partial class IgdbClient
{
    /// <summary>
    /// IGDB's <c>external_games</c> rows whose Microsoft Store entry (sources 11, 31, 54) is one of <paramref name="productIds"/>,
    /// with each row's game, its first release date and its own Steam/GOG entries. IGDB's docs don't promise the case of
    /// these IDs, so both cases are asked for. Returns IGDB's raw answer (see <see cref="XboxStoreEvidence.ParseIgdb"/>).
    /// </summary>
    public async Task<string> FindByMicrosoftStoreIdsAsync(IReadOnlyList<string> productIds, CancellationToken ct)
    {
        var ids = productIds.Where(CloudIds.IsProductId).Distinct(StringComparer.Ordinal).Take(XboxStoreLookupClient.MaxBundles + 1).ToList();
        if (ids.Count == 0) return "[]";
        return await QueryAsync("external_games", BuildMicrosoftStoreQuery(ids), ct);
    }

    /// <summary>The query, built only from validated product IDs (12 letters and digits each).</summary>
    internal static string BuildMicrosoftStoreQuery(IReadOnlyList<string> productIds)
    {
        if (productIds.Count == 0 || !productIds.All(CloudIds.IsProductId)) throw new ArgumentException("Invalid product IDs.", nameof(productIds));
        var values = string.Join(',', productIds.SelectMany(id => new[] { id, id.ToLowerInvariant() }).Select(v => $"\"{v}\""));
        return "fields uid,external_game_source,game.id,game.name,game.first_release_date,game.external_games.uid,game.external_games.external_game_source; " +
               $"where external_game_source = ({string.Join(',', XboxStoreEvidence.IgdbSources)}) & uid = ({values}); limit 50;";
    }
}
