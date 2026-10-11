namespace Vystral;

/// <summary>
/// The product's public identity: the one place its user-visible name lives in C#. Use
/// <see cref="Name"/> wherever text is built in code (window titles, notifications, error
/// messages); plain static copy may contain the literal.
/// </summary>
/// <remarks>
/// The app was called VYSTRAL before 1.0.0. Internal identifiers keep that name on purpose, so
/// existing installs, data, settings, updates and saved keys keep working: the Velopack pack ID
/// and install folder, the data folder, the exe and assembly names, Credential Manager targets,
/// named mutexes, the <c>vystral:</c> protocol, the WebView2 virtual hosts and storage keys.
/// They are listed in <see cref="Legacy"/> and in docs/ARCHITECTURE.md › Legacy identifiers.
/// </remarks>
public static class Brand
{
    /// <summary>The product name shown to people. Singular: "Arnav Games is…", "Arnav Games' cache".</summary>
    public const string Name = "Arnav Games";

    /// <summary>The product token in HTTP User-Agent headers (no spaces allowed there).</summary>
    public const string UserAgentProduct = "ArnavGames";

    /// <summary>The project's GitHub repository: updates, release notes and the contact URL in User-Agents.</summary>
    public const string RepositoryUrl = "https://github.com/Arnav-Dugad/arnav-games";

    /// <summary>The User-Agent comment that carries the contact URL (Wikimedia's policy asks for one).</summary>
    public const string UserAgentComment = "(+" + RepositoryUrl + ")";

    /// <summary>
    /// Identifiers that keep the old name so existing installs keep working. Changing any of these
    /// orphans users' data, settings, saved keys or updates; tests pin them.
    /// </summary>
    public static class Legacy
    {
        /// <summary>Velopack's <c>--packId</c>: the install folder, the update feed, the AUMID (<c>velopack.Vystral</c>) and the release asset names.</summary>
        public const string PackId = "Vystral";

        /// <summary>The data folder under %LOCALAPPDATA% (library database, settings, caches, logs).</summary>
        public const string DataFolderName = "VYSTRAL.Data";

        /// <summary>The executable's file name (also Velopack's root launcher).</summary>
        public const string ExeName = "Vystral.exe";

        /// <summary>The prefix of every Windows Credential Manager target the app writes.</summary>
        public const string CredentialPrefix = "VYSTRAL/";

        /// <summary>The prefix of the session-local named mutexes and events that coordinate the app and the background tracker.</summary>
        public const string MutexPrefix = @"Local\VYSTRAL-";

        /// <summary>The URI scheme clickable notifications use.</summary>
        public const string ProtocolScheme = "vystral";
    }
}
