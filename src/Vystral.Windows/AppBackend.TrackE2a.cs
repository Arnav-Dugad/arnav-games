using Vystral.Windows.Bridge;
using Vystral.Windows.Recap;
using static Vystral.Windows.Bridge.BridgeDispatcher;

namespace Vystral.Windows;

// Track E2a parameter records.
public sealed record CompletionImageBeginParams(string GameId, int Bytes);

/// <summary>
/// Track E2a: the "Completed 100%" card (Save image / Copy image). The page draws a 1920×1080 PNG and sends it in
/// base64 chunks, exactly like the session replay card, through its own upload store: each upload is bound to a game
/// in the library, expires after two minutes and must be precisely a 1920×1080 PNG. The page never chooses a path;
/// saving always goes through the native save dialog with a file name built here from the game's own title.
/// Also the start page ("startup.page", read by the host to start in Immersive Mode) and pinned collection covers
/// ("library.collectionCovers") are plain validated settings (see SettingsService).
/// </summary>
public sealed partial class AppBackend
{
    public const string StartPageSetting = "startup.page";
    public const string CollectionCoversSetting = "library.collectionCovers";

    private readonly ReplayImageStore _completionImages = new();

    private void RegisterTrackE2aHandlers()
    {
        Dispatcher.Register<CompletionImageBeginParams>("completion.imageBegin", (p, _) =>
        {
            var gameId = RequireId(p.GameId, "game");
            if (Repository.GetGame(gameId) is null) throw new BridgeException("notFound", "That game is no longer in your library.");
            return Task.FromResult<object?>(new { token = _completionImages.Begin(gameId, p.Bytes), maxChunk = ReplayImageStore.MaxChunkChars });
        });
        Dispatcher.Register<ReplayChunkParams>("completion.imageChunk", (p, _) =>
            Task.FromResult<object?>(new { received = _completionImages.Append(RequireToken(p.Token), p.Index, p.Data ?? "") }));
        Dispatcher.Register<ReplayTokenParams>("completion.imageSave", async (p, _) =>
        {
            var (gameId, png) = _completionImages.Take(RequireToken(p.Token));
            var game = Repository.GetGame(gameId) ?? throw new BridgeException("notFound", "That game is no longer in your library.");
            var path = await _shell.PickSaveFileAsync(CompletionImageName(game.Title, DateTimeOffset.Now), ".png", "PNG image");
            if (path is null) return null;
            if (!path.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) path += ".png";
            var tmp = path + ".tmp";
            await File.WriteAllBytesAsync(tmp, png);
            File.Move(tmp, path, overwrite: true);
            Repository.Audit("completion.saveImage", gameId);
            return new { path };
        });
        Dispatcher.Register<ReplayTokenParams>("completion.imageCopy", async (p, _) =>
        {
            var (_, png) = _completionImages.Take(RequireToken(p.Token));
            var host = ClipboardHost ?? throw new BridgeException("unsupported", "The clipboard isn't available right now.");
            if (!await host.CopyPngAsync(png)) throw new BridgeException("unavailable", "The clipboard is busy. Try again in a moment.");
            return true;
        });
    }

    /// <summary>"Arnav Games 100% - Ashen Crown - 2026-10-11": a safe default name from the title (never from the page).</summary>
    public static string CompletionImageName(string title, DateTimeOffset at)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string((title ?? "").Where(c => !invalid.Contains(c) && !char.IsControl(c)).ToArray()).Trim().TrimEnd('.');
        if (clean.Length > 60) clean = clean[..60].TrimEnd();
        if (clean.Length == 0) clean = "Game";
        return $"{Brand.Name} 100% - {clean} - {at.ToLocalTime():yyyy-MM-dd}";
    }

    /// <summary>Whether the host should open in Immersive Mode: the older switch, or "Open on start" set to Immersive.</summary>
    public static bool StartsInImmersive(bool startupImmersive, string? startPage) => startupImmersive || startPage == "immersive";
}
