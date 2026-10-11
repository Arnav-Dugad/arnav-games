using Vystral.Core.Contracts;

namespace Vystral.Windows.Ai.Extras;

/// <summary>
/// One merge the Assistant proposes from a duplicate suggestion. <c>Target</c> keeps its page (and gains the other entry's
/// store versions); <c>SourceInstallationIds</c> are the versions that move, so Undo can separate exactly those again with
/// the existing unmerge. <c>Confidence</c>: "strong" | "likely" | "unsure".
/// </summary>
public sealed record MergeProposalDto(string Id, string TargetGameId, string SourceGameId, string TargetTitle, string SourceTitle,
    IReadOnlyList<string> SourceInstallationIds, IReadOnlyList<DuplicateFactDto> Facts, string Confidence, string Explanation, string KeepReason);

/// <summary>
/// Track E1: smart duplicate cleanup. Turns the library's duplicate suggestions (which Arnav Games deliberately did not merge
/// on its own) into merge proposals with the facts behind each one, strongest first. Nothing is merged here: the page runs
/// each approved proposal through the existing <c>game.merge</c>, and each can be undone with <c>game.unmerge</c>.
/// </summary>
public static class DuplicateCleanup
{
    public const int MaxProposals = 60;

    public static IReadOnlyList<MergeProposalDto> Propose(LibrarySnapshotDto snapshot, Func<string, string?> steamAppId)
    {
        var games = snapshot.Games.Where(g => !g.Hidden).ToDictionary(g => g.Id);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var list = new List<(MergeProposalDto P, int Rank)>();
        foreach (var s in snapshot.DuplicateSuggestions)
        {
            if (s.GameIdA == s.GameIdB || !games.TryGetValue(s.GameIdA, out var a) || !games.TryGetValue(s.GameIdB, out var b)) continue;
            if (!seen.Add(Key(a.Id, b.Id))) continue;
            var (target, source, keep) = ChooseTarget(a, b);
            var facts = DuplicateFacts.For(target, source, steamAppId(target.Id), steamAppId(source.Id));
            var confidence = Confidence(facts);
            list.Add((new MergeProposalDto(
                $"dup-{Key(target.Id, source.Id)}", target.Id, source.Id, target.Title, source.Title,
                source.Installations.Select(i => i.Id).ToList(), facts, confidence, Explain(facts), keep),
                confidence switch { "strong" => 0, "likely" => 1, _ => 2 }));
            if (list.Count >= MaxProposals) break;
        }
        return list.OrderBy(x => x.Rank).ThenBy(x => x.P.TargetTitle, StringComparer.OrdinalIgnoreCase).Select(x => x.P).ToList();
    }

    private static string Key(string a, string b) => string.CompareOrdinal(a, b) < 0 ? $"{a}-{b}" : $"{b}-{a}";

    /// <summary>
    /// Which entry keeps its page: the one with more of your history (tracked time, then sessions), then the one with more
    /// store versions, then the one with a description, then the one added first.
    /// </summary>
    public static (GameDto Target, GameDto Source, string Reason) ChooseTarget(GameDto a, GameDto b)
    {
        int Cmp(GameDto x, GameDto y)
        {
            var c = x.TrackedSeconds.CompareTo(y.TrackedSeconds);
            if (c != 0) return c;
            c = x.SessionCount.CompareTo(y.SessionCount);
            if (c != 0) return c;
            c = (x.Favorite ? 1 : 0).CompareTo(y.Favorite ? 1 : 0);
            if (c != 0) return c;
            c = x.Installations.Count.CompareTo(y.Installations.Count);
            if (c != 0) return c;
            c = (string.IsNullOrWhiteSpace(x.Description) ? 0 : 1).CompareTo(string.IsNullOrWhiteSpace(y.Description) ? 0 : 1);
            if (c != 0) return c;
            c = string.CompareOrdinal(y.Added, x.Added); // earlier added wins
            return c != 0 ? c : string.CompareOrdinal(y.Id, x.Id);
        }
        var (t, s) = Cmp(a, b) >= 0 ? (a, b) : (b, a);
        string reason;
        if (t.TrackedSeconds != s.TrackedSeconds) reason = $"Keeps {t.Title}’s page, which has more of your play history.";
        else if (t.SessionCount != s.SessionCount) reason = $"Keeps {t.Title}’s page, which has more sessions.";
        else if (t.Favorite != s.Favorite) reason = $"Keeps {t.Title}’s page, your favorite.";
        else if (t.Installations.Count != s.Installations.Count) reason = $"Keeps {t.Title}’s page, which already holds more store versions.";
        else reason = $"Keeps {t.Title}’s page.";
        return (t, s, reason + $" {s.Title}’s sessions, collections and store versions join it; where both have notes or a status, {t.Title}’s are kept.");
    }

    /// <summary>"strong": a shared Steam app or identical titles across stores with nothing against; "likely": more for than against; else "unsure".</summary>
    public static string Confidence(IReadOnlyList<DuplicateFactDto> facts)
    {
        var forCount = facts.Count(f => f.Supports);
        var against = facts.Count(f => !f.Supports);
        var hard = facts.Any(f => f.Supports && f.Kind == "steamAppId") || (facts.Any(f => f.Supports && f.Kind == "title") && facts.Any(f => f.Supports && f.Kind == "store"));
        if (hard && against == 0) return "strong";
        if (forCount > against && !facts.Any(f => !f.Supports && f.Kind == "store")) return "likely";
        return "unsure";
    }

    /// <summary>A plain sentence from the facts (no AI): what's alike, then anything that's different.</summary>
    public static string Explain(IReadOnlyList<DuplicateFactDto> facts)
    {
        var alike = facts.Where(f => f.Supports).Select(f => f.Text).ToList();
        var differ = facts.Where(f => !f.Supports).Select(f => f.Text).ToList();
        if (alike.Count == 0) return differ.Count == 0 ? "Arnav Games found them alike by title." : "But: " + string.Join(" ", differ);
        var s = string.Join(" ", alike);
        return differ.Count == 0 ? s : $"{s} But: {string.Join(" ", differ)}";
    }
}
