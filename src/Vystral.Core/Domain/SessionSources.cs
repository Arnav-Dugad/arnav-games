namespace Vystral.Core.Domain;

/// <summary>
/// Values of <c>sessions.source</c>. Every source except <see cref="Imported"/> is a session Arnav Games
/// observed itself; they only differ in how it noticed the game, and are counted the same everywhere.
/// </summary>
public static class SessionSources
{
    /// <summary>Started from Arnav Games and observed by it.</summary>
    public const string Tracked = "tracked";

    /// <summary>Started outside Arnav Games (a store client, a shortcut) and noticed while Arnav Games was open.</summary>
    public const string Detected = "detected";

    /// <summary>Noticed by the background tracker while Arnav Games was closed.</summary>
    public const string Background = "background";

    /// <summary>Track O: a GeForce NOW stream started from Arnav Games (time estimated from the app, stream or browser window it saw).</summary>
    public const string CloudGfn = "cloud-gfn";

    /// <summary>Track O: an Xbox Cloud Gaming stream started from Arnav Games (estimated the same way).</summary>
    public const string CloudXbox = "cloud-xbox";

    /// <summary>Read from a store (never mixed with observed time).</summary>
    public const string Imported = "imported";

    /// <summary>SQL list for <c>source IN …</c>: every source Arnav Games observed itself.</summary>
    public const string ObservedSql = "('tracked','detected','background','cloud-gfn','cloud-xbox')";

    public static bool IsObserved(string? source) => source is Tracked or Detected or Background or CloudGfn or CloudXbox;

    /// <summary>Track O: a cloud stream (no local process, so no performance data).</summary>
    public static bool IsCloud(string? source) => source is CloudGfn or CloudXbox;
}
