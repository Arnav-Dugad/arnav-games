using System.Text.RegularExpressions;
using Vystral.Windows.Ai;
using Vystral.Windows.DataSources;
using Vystral.Windows.Services;
using Vystral.Windows.Tracking;
using Xunit;

namespace Vystral.Tests.Shell;

/// <summary>
/// The app was renamed from VYSTRAL to Arnav Games in 1.0.0. These identifiers must keep the old name, or
/// existing installs lose their data, settings, saved keys or updates (docs/ARCHITECTURE.md › Legacy identifiers).
/// If one of these fails, the change needs a migration, not a test update.
/// </summary>
public sealed class LegacyIdentifierTests
{
    [Fact]
    public void The_product_name_changed()
    {
        Assert.Equal("Arnav Games", Brand.Name);
        Assert.Equal("ArnavGames", Brand.UserAgentProduct);
        Assert.Equal("https://github.com/Arnav-Dugad/arnav-games", Brand.RepositoryUrl);
        Assert.Equal(Brand.RepositoryUrl, UpdateService.RepositoryUrl);
        Assert.Equal("(+https://github.com/Arnav-Dugad/arnav-games)", Brand.UserAgentComment);
    }

    [Fact]
    public void The_legacy_constants_keep_their_values()
    {
        Assert.Equal("Vystral", Brand.Legacy.PackId);
        Assert.Equal("VYSTRAL.Data", Brand.Legacy.DataFolderName);
        Assert.Equal("Vystral.exe", Brand.Legacy.ExeName);
        Assert.Equal("VYSTRAL/", Brand.Legacy.CredentialPrefix);
        Assert.Equal(@"Local\VYSTRAL-", Brand.Legacy.MutexPrefix);
        Assert.Equal("vystral", Brand.Legacy.ProtocolScheme);
    }

    [Fact]
    public void The_data_folder_is_still_VYSTRAL_Data()
    {
        Assert.Equal("VYSTRAL.Data", Path.GetFileName(AppPaths.DefaultRoot));
        Assert.Equal(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Path.GetDirectoryName(AppPaths.DefaultRoot));
    }

    [Fact]
    public void Mutex_names_keep_the_old_prefix()
    {
        var names = TrackerNames.For(@"C:\Users\me\AppData\Local\VYSTRAL.Data");
        foreach (var name in new[] { names.App, names.Tracker, names.Helper })
            Assert.StartsWith(@"Local\VYSTRAL-", name);
    }

    [Fact]
    public void Credential_Manager_targets_keep_the_old_prefix()
    {
        Assert.Equal("VYSTRAL/SteamWebApiKey", SteamApiKeyStore.Target);
        Assert.Equal("VYSTRAL/SteamGridDB", DataSourceKeyStore.Target(KeyedProvider.SteamGridDb));
        Assert.Equal("VYSTRAL/IGDB", DataSourceKeyStore.Target(KeyedProvider.Igdb));
        Assert.Equal("VYSTRAL/RAWG", DataSourceKeyStore.Target(KeyedProvider.Rawg));
        Assert.Equal("VYSTRAL/IsThereAnyDeal", DataSourceKeyStore.Target(KeyedProvider.IsThereAnyDeal));
        Assert.Equal("VYSTRAL/AI-Anthropic", CloudAiKeyStore.Target(CloudAiProvider.Anthropic));
        Assert.Equal("VYSTRAL/AI-OpenAI", CloudAiKeyStore.Target(CloudAiProvider.OpenAi));
        Assert.Equal("VYSTRAL/AI-Gemini", CloudAiKeyStore.Target(CloudAiProvider.Gemini));
        Assert.Equal("VYSTRAL/AI-Compatible", CloudAiKeyStore.Target(CloudAiProvider.Compatible));
    }

    [Fact]
    public void The_protocol_is_still_vystral()
    {
        Assert.Equal("vystral", ActivationUri.Scheme);
        Assert.Equal("vystral", ShellRegistration.ProtocolKey);
    }

    [Fact]
    public void The_installer_keeps_its_pack_id_and_exe_but_shows_the_new_name()
    {
        var pack = File.ReadAllText(RepoFile("build", "pack.ps1"));
        Assert.Matches(new Regex(@"--packId Vystral\s"), pack);
        Assert.Matches(new Regex(@"--mainExe Vystral\.exe\s"), pack);
        Assert.Contains("--packTitle 'Arnav Games'", pack);
        foreach (Match m in Regex.Matches(pack, @"--(?:icon|splashImage) (\S+)"))
            Assert.True(File.Exists(RepoFile(m.Groups[1].Value.Split('/'))), $"{m.Groups[1].Value} is missing");

        var csproj = File.ReadAllText(RepoFile("src", "Vystral.App", "Vystral.App.csproj"));
        Assert.Contains("<AssemblyName>Vystral</AssemblyName>", csproj);
        Assert.Contains("<AssemblyTitle>Arnav Games</AssemblyTitle>", csproj);
        var icon = Regex.Match(csproj, @"<ApplicationIcon>([^<]+)</ApplicationIcon>").Groups[1].Value;
        Assert.True(File.Exists(RepoFile(["src", "Vystral.App", .. icon.Split('\\')])), icon);

        // The WebView2 page origin owns the interface's localStorage (vystral.* keys): it must not change.
        var window = File.ReadAllText(RepoFile("src", "Vystral.App", "MainWindow.cs"));
        Assert.Contains("AppHost = \"app.vystral.example\"", window);
        Assert.Equal("art.vystral.example", ArtworkService.ArtHost);
        Assert.Equal("media.vystral.example", MediaService.MediaHost);
    }

    [Fact]
    public void Releases_are_named_Arnav_Games()
    {
        var release = File.ReadAllText(RepoFile(".github", "workflows", "release.yml"));
        Assert.Contains("--releaseName \"Arnav Games $env:VERSION\"", release);
        Assert.DoesNotContain("VYSTRAL", release);
    }

    private static string RepoFile(params string[] parts)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Vystral.slnx"))) dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine([dir!.FullName, .. parts]);
    }
}
