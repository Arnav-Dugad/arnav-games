using System.Globalization;
using System.Text.RegularExpressions;
using Vystral.Windows.Services;

namespace Vystral.Windows.Ai.Extras;

/// <summary>
/// call('voice.status'). <c>Fix</c> names what would make voice input work: "setting" (turned off in Settings),
/// "microphone" (Windows' microphone privacy setting), "language" (no on-device speech recognizer for any installed
/// language), "device" (no microphone found) or null.
/// </summary>
public sealed record VoiceStatusDto(bool Enabled, bool Available, string? Reason, string? Fix, string? Language, string? LanguageName,
    string Engine, bool OnDevice, bool Listening);

/// <summary>An on-device speech recognizer for one push-to-talk hold. Events may arrive on any thread.</summary>
public interface IVoiceEngine : IDisposable
{
    string Language { get; }
    event Action<string>? Hypothesis;
    event Action<string>? Phrase;
    event Action<int>? Level;
    event Action<string?>? Ended;
    /// <summary>Starts listening to the default microphone. Throws <see cref="InvalidOperationException"/> without one.</summary>
    void Start();
    /// <summary>Stops after the phrase being heard (its words still arrive), then raises <see cref="Ended"/>.</summary>
    void Stop();
    /// <summary>Stops at once and drops what was being heard.</summary>
    void Cancel();
}

/// <summary>What the device offers: installed recognizer languages, and the engine factory.</summary>
public interface IVoiceBackend
{
    IReadOnlyList<CultureInfo> Languages();
    IVoiceEngine Create(CultureInfo language);
    /// <summary>Windows' microphone consent for desktop apps: "Allow", "Deny" or null (unknown).</summary>
    (string? Global, string? Desktop) MicrophoneConsent();
}

/// <summary>
/// Track E1: push-to-talk voice input for the Assistant, on this PC only.
/// <para>Engine choice (see docs/PRIVACY.md, "Voice input"): the Windows desktop speech recognizer (SAPI, through
/// <c>System.Speech</c>) with its dictation grammar, running in Arnav Games' own process. It needs no network and no account:
/// audio from the microphone goes to the recognizer on this PC and is never stored or sent anywhere. The WinRT
/// <c>Windows.Media.SpeechRecognition</c> dictation topic and WebView2's <c>webkitSpeechRecognition</c> both use
/// Microsoft's online speech service, so neither is used.</para>
/// <para>The microphone is open only while the user holds the button or key (at most <see cref="MaxListen"/>), nothing is
/// sent anywhere automatically: the words land in the message box for the user to edit and send.</para>
/// Events: <c>voice.event</c> {sessionId, type: start | level | partial | end | error, text?, level?, message?}.
/// </summary>
public sealed partial class VoiceService(IVoiceBackend backend, Func<string, bool> setting, Action<string, object?> emit) : IDisposable
{
    public const string EventName = "voice.event";
    public static readonly TimeSpan MaxListen = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan IdleDispose = TimeSpan.FromMinutes(3);
    public const int MaxTextChars = 4000;

    private readonly Lock _lock = new();
    private IVoiceEngine? _engine;
    private bool _engineBusy;
    private string? _session;
    private string _committed = "";
    private long _lastLevelTicks;
    private Timer? _maxTimer;
    private Timer? _idleTimer;

    public bool SafeMode { get; set; }
    public Func<CultureInfo> UiCulture { get; set; } = () => CultureInfo.CurrentUICulture;

    /// <summary>
    /// The recognizer language for the user's display language: the same culture, else the same language in another
    /// region, else English, else the first one installed. Null when no recognizer is installed.
    /// </summary>
    public static CultureInfo? PickLanguage(CultureInfo ui, IReadOnlyList<CultureInfo> installed)
    {
        if (installed.Count == 0) return null;
        return installed.FirstOrDefault(c => c.Name.Equals(ui.Name, StringComparison.OrdinalIgnoreCase))
               ?? installed.FirstOrDefault(c => c.TwoLetterISOLanguageName == ui.TwoLetterISOLanguageName)
               ?? installed.FirstOrDefault(c => c.Name.Equals("en-US", StringComparison.OrdinalIgnoreCase))
               ?? installed.FirstOrDefault(c => c.TwoLetterISOLanguageName == "en")
               ?? installed[0];
    }

    /// <summary>"Deny" in either the global or the desktop-apps switch blocks the microphone for Arnav Games.</summary>
    public static bool MicrophoneBlocked((string? Global, string? Desktop) consent) =>
        string.Equals(consent.Global, "Deny", StringComparison.OrdinalIgnoreCase) || string.Equals(consent.Desktop, "Deny", StringComparison.OrdinalIgnoreCase);

    public VoiceStatusDto Status()
    {
        var enabled = setting("assistant.voice");
        bool listening;
        lock (_lock) listening = _session is not null;
        if (SafeMode) return new(enabled, false, "Voice input is off in safe mode.", null, null, null, "Windows speech recognition", true, false);
        IReadOnlyList<CultureInfo> langs;
        try { langs = backend.Languages(); }
        catch (Exception ex) when (ex is InvalidOperationException or PlatformNotSupportedException or UnauthorizedAccessException or System.Runtime.InteropServices.COMException)
        {
            Log.Warn("voice", "Couldn't list speech recognizers", new { error = ex.GetType().Name });
            langs = [];
        }
        var lang = PickLanguage(UiCulture(), langs);
        if (lang is null)
            return new(enabled, false,
                "Windows has no on-device speech recognizer for your languages. Add one with a language’s Speech recognition option in Windows Settings › Time & language.",
                "language", null, null, "Windows speech recognition", true, false);
        if (MicrophoneBlocked(backend.MicrophoneConsent()))
            return new(enabled, false,
                "Windows is blocking microphone access for desktop apps. Turn on “Let desktop apps access your microphone” in Windows Settings › Privacy & security › Microphone.",
                "microphone", lang.Name, lang.DisplayName, "Windows speech recognition", true, listening);
        if (!enabled)
            return new(false, false, "Voice input is off. Turn it on in Settings › AI › Assistant.", "setting", lang.Name, lang.DisplayName, "Windows speech recognition", true, false);
        return new(true, true, null, null, lang.Name, lang.DisplayName, "Windows speech recognition", true, listening);
    }

    /// <summary>Starts listening for one hold. A newer hold replaces an older one that never ended.</summary>
    public VoiceStatusDto Start(string sessionId)
    {
        var status = Status();
        if (!status.Available) throw new Bridge.BridgeException("unavailable", status.Reason ?? "Voice input isn’t available.");
        lock (_lock)
        {
            if (_session is not null) EndLocked(cancel: true, error: null);
            _idleTimer?.Dispose();
            _idleTimer = null;
            try
            {
                // A recognizer still finishing the last hold (released and pressed again quickly) is replaced, never shared.
                if (_engine is null || _engine.Language != status.Language || _engineBusy)
                {
                    _engine?.Dispose();
                    _engine = backend.Create(CultureInfo.GetCultureInfo(status.Language!));
                    Wire(_engine);
                }
                _session = sessionId;
                _committed = "";
                _engine.Start();
                _engineBusy = true;
            }
            catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException or UnauthorizedAccessException or ArgumentException)
            {
                Log.Warn("voice", "Couldn't start listening", new { error = ex.GetType().Name });
                _session = null;
                _engine?.Dispose();
                _engine = null;
                throw new Bridge.BridgeException("unavailable", ex is InvalidOperationException
                    ? "No microphone was found. Plug one in, or choose one in Windows Settings › System › Sound."
                    : "Windows couldn’t start speech recognition. Try again.");
            }
            _maxTimer?.Dispose();
            _maxTimer = new Timer(_ => Stop(sessionId, reason: "That’s the longest a single hold can be. Hold again to keep talking."), null, MaxListen, Timeout.InfiniteTimeSpan);
        }
        emit(EventName, new { sessionId, type = "start", language = status.Language });
        return status with { Listening = true };
    }

    /// <summary>Released: the phrase being heard still arrives, then an "end" event carries the full text.</summary>
    public bool Stop(string sessionId, string? reason = null)
    {
        lock (_lock)
        {
            if (_session != sessionId || _engine is null) return false;
            _maxTimer?.Dispose();
            _maxTimer = null;
            if (reason is not null) emit(EventName, new { sessionId, type = "notice", message = reason });
            try { _engine.Stop(); }
            catch (InvalidOperationException) { EndLocked(cancel: false, error: null); return true; }
            // The recognizer normally finishes the phrase within a second; never leave the page waiting on it.
            _maxTimer = new Timer(_ =>
            {
                lock (_lock) if (_session == sessionId) EndLocked(cancel: true, error: null);
            }, null, TimeSpan.FromSeconds(4), Timeout.InfiniteTimeSpan);
            return true;
        }
    }

    public bool Cancel(string sessionId)
    {
        lock (_lock)
        {
            if (_session != sessionId) return false;
            EndLocked(cancel: true, error: null);
            return true;
        }
    }

    private void Wire(IVoiceEngine e)
    {
        e.Hypothesis += text =>
        {
            string? sid;
            string full;
            lock (_lock)
            {
                if (_session is null || _engine != e) return;
                sid = _session;
                full = Join(_committed, Clean(text));
            }
            emit(EventName, new { sessionId = sid, type = "partial", text = full });
        };
        e.Phrase += text =>
        {
            string? sid;
            string full;
            lock (_lock)
            {
                if (_session is null || _engine != e) return;
                _committed = Join(_committed, Clean(text));
                sid = _session;
                full = _committed;
            }
            emit(EventName, new { sessionId = sid, type = "partial", text = full });
        };
        e.Level += level =>
        {
            string? sid;
            lock (_lock)
            {
                if (_session is null || _engine != e) return;
                // About 20 a second is plenty for a meter; the recognizer reports more often.
                var now = Environment.TickCount64;
                if (now - _lastLevelTicks < 45) return;
                _lastLevelTicks = now;
                sid = _session;
            }
            emit(EventName, new { sessionId = sid, type = "level", level = Math.Clamp(level, 0, 100) });
        };
        e.Ended += error =>
        {
            lock (_lock)
            {
                if (_engine == e) _engineBusy = false;
                if (_engine != e || _session is null) return;
                EndLocked(cancel: false, error: error);
            }
        };
    }

    private void EndLocked(bool cancel, string? error)
    {
        var sid = _session;
        var text = _committed;
        _session = null;
        _committed = "";
        _maxTimer?.Dispose();
        _maxTimer = null;
        if (cancel)
            try { _engine?.Cancel(); }
            catch (InvalidOperationException) { }
        _idleTimer?.Dispose();
        _idleTimer = new Timer(_ => DisposeIdle(), null, IdleDispose, Timeout.InfiniteTimeSpan);
        if (sid is null) return;
        if (error is not null) emit(EventName, new { sessionId = sid, type = "error", message = error, text });
        else emit(EventName, new { sessionId = sid, type = "end", text, cancelled = cancel });
    }

    private void DisposeIdle()
    {
        lock (_lock)
        {
            if (_session is not null) return;
            _engine?.Dispose();
            _engine = null;
        }
    }

    /// <summary>One line of text: no control or invisible format characters, single spaces, capped.</summary>
    public static string Clean(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var t = new string(s.Where(c => !char.IsControl(c) && CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.Format).ToArray());
        t = Spaces().Replace(t, " ").Trim();
        return t.Length > MaxTextChars ? t[..MaxTextChars] : t;
    }

    public static string Join(string a, string b) => a.Length == 0 ? b : b.Length == 0 ? a : Clean(a + " " + b);

    public void Dispose()
    {
        lock (_lock)
        {
            _maxTimer?.Dispose();
            _idleTimer?.Dispose();
            _engine?.Dispose();
            _engine = null;
            _session = null;
        }
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
