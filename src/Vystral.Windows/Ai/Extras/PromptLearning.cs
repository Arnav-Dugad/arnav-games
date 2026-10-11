using System.Globalization;
using System.Text.RegularExpressions;
using Vystral.Windows.Ai.Assistant;
using Vystral.Windows.Services;

namespace Vystral.Windows.Ai.Extras;

/// <summary>One learned prompt: its text (a game's title replaced by <c>{game}</c> on game pages), how often and when last asked.</summary>
public sealed record LearnedPromptDto(string Text, int Count, DateTimeOffset LastAsked);

/// <summary>call('assistant.prompts.get'): learned prompts per page type.</summary>
public sealed record LearnedPromptsDto(bool Enabled, IReadOnlyDictionary<string, IReadOnlyList<LearnedPromptDto>> Pages);

/// <summary>
/// Track E1: suggested prompts learned from what you ask, per page type, on this PC only. The page templates a prompt
/// before recording it (a game's title becomes <c>{game}</c>), so "Is Hades good with a controller?" asked on one game page
/// becomes a suggestion on every game page. The page blends these with the built-in suggestions; only prompts asked more
/// than once are shown. Capped per page, erasable from Settings, and nothing is recorded with the setting off.
/// </summary>
public sealed partial class PromptLearningStore(string folder)
{
    public const int PerPage = 25;
    public const int MinChars = 4;
    public const int MaxChars = 120;

    private readonly Lock _lock = new();
    private string File => Path.Combine(folder, "prompts.json");

    private sealed class Stored
    {
        public int Version { get; set; } = 1;
        public Dictionary<string, List<Entry>>? Pages { get; set; }
    }

    private sealed class Entry
    {
        public string? Text { get; set; }
        public int Count { get; set; }
        public DateTimeOffset Last { get; set; }
    }

    public Func<DateTimeOffset> Now { get; set; } = () => DateTimeOffset.UtcNow;

    /// <summary>One line, single spaces, 4–120 characters, no control/format characters, at most one {game} placeholder.</summary>
    public static string? Clean(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > MaxChars * 2) return null;
        if (text.Any(c => char.IsControl(c) || CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.Format)) return null;
        var s = Spaces().Replace(text, " ").Trim();
        if (s.Length is < MinChars or > MaxChars) return null;
        if (Regex.Matches(s, Regex.Escape("{game}")).Count > 1 || (s.Contains('{') && !OnlyPlaceholder().IsMatch(s))) return null;
        if (AssistantMemoryStore.LooksSecret(s)) return null;
        return s;
    }

    public LearnedPromptsDto Get(bool enabled)
    {
        lock (_lock)
        {
            var pages = Load().ToDictionary(kv => kv.Key,
                kv => (IReadOnlyList<LearnedPromptDto>)kv.Value.OrderByDescending(e => e.Count).ThenByDescending(e => e.Last)
                    .Select(e => new LearnedPromptDto(e.Text!, e.Count, e.Last)).ToList());
            return new LearnedPromptsDto(enabled, pages);
        }
    }

    /// <summary>Counts one asked prompt for a page type. Returns false when the text or page isn't acceptable.</summary>
    public bool Record(string page, string? text)
    {
        if (!AssistantService.Pages.Contains(page) || Clean(text) is not { } clean) return false;
        lock (_lock)
        {
            var pages = Load();
            if (!pages.TryGetValue(page, out var list)) pages[page] = list = [];
            var e = list.FirstOrDefault(x => string.Equals(x.Text, clean, StringComparison.OrdinalIgnoreCase));
            if (e is null)
            {
                if (list.Count >= PerPage)
                {
                    // Make room by forgetting the weakest: fewest asks, then the oldest.
                    var weakest = list.OrderBy(x => x.Count).ThenBy(x => x.Last).First();
                    list.Remove(weakest);
                }
                list.Add(e = new Entry { Text = clean, Count = 0 });
            }
            e.Count = Math.Min(e.Count + 1, 10_000);
            e.Last = Now();
            return JsonFileCache.Write(File, new Stored { Pages = pages });
        }
    }

    public void Clear()
    {
        lock (_lock) JsonFileCache.Delete(File);
    }

    private Dictionary<string, List<Entry>> Load()
    {
        var stored = JsonFileCache.Read<Stored>(File, 256 * 1024);
        var result = new Dictionary<string, List<Entry>>(StringComparer.Ordinal);
        foreach (var (page, list) in stored?.Pages ?? [])
        {
            if (!AssistantService.Pages.Contains(page) || list is null) continue;
            var clean = new List<Entry>();
            foreach (var e in list)
            {
                if (e is null || Clean(e.Text) is not { } t || clean.Any(x => string.Equals(x.Text, t, StringComparison.OrdinalIgnoreCase))) continue;
                clean.Add(new Entry { Text = t, Count = Math.Clamp(e.Count, 1, 10_000), Last = e.Last });
                if (clean.Count == PerPage) break;
            }
            if (clean.Count > 0) result[page] = clean;
        }
        return result;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    [GeneratedRegex(@"\A[^{}]*(\{game\}[^{}]*)?\z")]
    private static partial Regex OnlyPlaceholder();
}
