using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Vystral.Windows.Ai.Extras;
using Vystral.Windows.Bridge;
using Xunit;

namespace Vystral.Tests.TrackE1;

/// <summary>Track E1: push-to-talk voice input over a fake on-device recognizer (no microphone is used in tests).</summary>
public sealed class VoiceServiceTests
{
    private sealed class FakeEngine(string language) : IVoiceEngine
    {
        public string Language { get; } = language;
        public bool Started, Stopped, Cancelled, Disposed;
        public bool NoMicrophone;
        public event Action<string>? Hypothesis;
        public event Action<string>? Phrase;
        public event Action<int>? Level;
        public event Action<string?>? Ended;
        public void Start() { if (NoMicrophone) throw new InvalidOperationException("no device"); Started = true; }
        public void Stop() { Stopped = true; Ended?.Invoke(null); }
        public void Cancel() { Cancelled = true; }
        public void Dispose() => Disposed = true;
        public void Hear(string partial) => Hypothesis?.Invoke(partial);
        public void Say(string phrase) => Phrase?.Invoke(phrase);
        public void Loud(int level) => Level?.Invoke(level);
        public void Fail(string why) => Ended?.Invoke(why);
    }

    private sealed class FakeBackend : IVoiceBackend
    {
        public List<CultureInfo> Langs { get; } = [CultureInfo.GetCultureInfo("en-US"), CultureInfo.GetCultureInfo("fr-FR")];
        public (string?, string?) Consent { get; set; } = ("Allow", "Allow");
        public FakeEngine? Last;
        public bool NoMicrophone;
        public IReadOnlyList<CultureInfo> Languages() => Langs;
        public IVoiceEngine Create(CultureInfo language) => Last = new FakeEngine(language.Name) { NoMicrophone = NoMicrophone };
        public (string? Global, string? Desktop) MicrophoneConsent() => Consent;
    }

    private readonly FakeBackend _backend = new();
    private readonly Dictionary<string, bool> _settings = new() { ["assistant.voice"] = true };
    private readonly List<JsonObject> _events = [];
    private readonly VoiceService _svc;

    public VoiceServiceTests()
    {
        _svc = new VoiceService(_backend, k => _settings.GetValueOrDefault(k), (name, payload) =>
        {
            Assert.Equal(VoiceService.EventName, name);
            lock (_events) _events.Add(JsonSerializer.SerializeToNode(payload, BridgeDispatcher.Json)!.AsObject());
        }) { UiCulture = () => CultureInfo.GetCultureInfo("en-GB") };
    }

    private List<JsonObject> Of(string type)
    {
        lock (_events) return _events.Where(e => e["type"]!.GetValue<string>() == type).ToList();
    }

    [Fact]
    public void Picks_the_recognizer_for_the_display_language_then_the_same_language_then_english()
    {
        var installed = new[] { "en-US", "fr-FR", "de-DE" }.Select(CultureInfo.GetCultureInfo).ToList();
        Assert.Equal("fr-FR", VoiceService.PickLanguage(CultureInfo.GetCultureInfo("fr-FR"), installed)!.Name);
        Assert.Equal("fr-FR", VoiceService.PickLanguage(CultureInfo.GetCultureInfo("fr-CA"), installed)!.Name);
        Assert.Equal("en-US", VoiceService.PickLanguage(CultureInfo.GetCultureInfo("ja-JP"), installed)!.Name);
        Assert.Equal("de-DE", VoiceService.PickLanguage(CultureInfo.GetCultureInfo("ja-JP"), [CultureInfo.GetCultureInfo("de-DE")])!.Name);
        Assert.Null(VoiceService.PickLanguage(CultureInfo.GetCultureInfo("en-US"), []));
    }

    [Fact]
    public void Status_explains_why_voice_is_unavailable_and_says_audio_stays_on_the_device()
    {
        var ok = _svc.Status();
        Assert.True(ok.Available);
        Assert.True(ok.OnDevice);
        Assert.Equal("en-US", ok.Language);

        _settings["assistant.voice"] = false;
        Assert.Equal("setting", _svc.Status().Fix);
        _settings["assistant.voice"] = true;

        _backend.Consent = ("Allow", "Deny");
        var mic = _svc.Status();
        Assert.False(mic.Available);
        Assert.Equal("microphone", mic.Fix);
        Assert.Contains("Let desktop apps access your microphone", mic.Reason);
        _backend.Consent = ("Deny", null);
        Assert.Equal("microphone", _svc.Status().Fix);
        _backend.Consent = (null, null);
        Assert.True(_svc.Status().Available);

        _backend.Langs.Clear();
        var none = _svc.Status();
        Assert.Equal("language", none.Fix);
        Assert.Contains("Speech recognition", none.Reason);
        Assert.Throws<BridgeException>(() => _svc.Start("v1"));
    }

    [Fact]
    public void A_hold_streams_partials_and_levels_and_ends_with_the_whole_text()
    {
        var started = _svc.Start("v1");
        Assert.True(started.Listening);
        var e = _backend.Last!;
        Assert.True(e.Started);
        e.Hear("what should");
        e.Say("What should I play tonight");
        e.Hear("I have one");
        e.Loud(250);
        Assert.Equal(["What should I play tonight", "What should I play tonight I have one"], Of("partial").Skip(1).Select(x => x["text"]!.GetValue<string>()));
        Assert.Equal("what should", Of("partial")[0]["text"]!.GetValue<string>());
        Assert.Equal(100, Of("level").Single()["level"]!.GetValue<int>());
        e.Say("I have one hour");
        Assert.True(_svc.Stop("v1"));
        var end = Of("end").Single();
        Assert.Equal("What should I play tonight I have one hour", end["text"]!.GetValue<string>());
        Assert.False(end["cancelled"]!.GetValue<bool>());
        Assert.False(_svc.Stop("v1")); // already over
        e.Say("late words"); // after the hold: ignored
        Assert.Single(Of("end"));
    }

    [Fact]
    public void Levels_are_throttled_and_text_is_cleaned()
    {
        _svc.Start("v2");
        var e = _backend.Last!;
        for (var i = 0; i < 50; i++) e.Loud(i);
        Assert.Single(Of("level"));
        e.Say("hello\u0007 ​there   friend");
        Assert.Equal("hello there friend", Of("partial").Last()["text"]!.GetValue<string>());
    }

    [Fact]
    public void Cancel_and_a_newer_hold_end_the_older_one_and_errors_are_reported()
    {
        _svc.Start("v1");
        var first = _backend.Last!;
        _svc.Start("v2"); // e.g. the key was pressed again before the release arrived
        Assert.True(first.Cancelled);
        Assert.True(Of("end").Single()["cancelled"]!.GetValue<bool>());
        Assert.False(_svc.Cancel("v1"));
        Assert.True(_svc.Cancel("v2"));
        _svc.Start("v3");
        _backend.Last!.Fail("Speech recognition stopped unexpectedly. Try again.");
        Assert.Contains("unexpectedly", Of("error").Single()["message"]!.GetValue<string>());
    }

    [Fact]
    public void No_microphone_is_a_plain_error_not_a_crash()
    {
        _backend.NoMicrophone = true;
        var ex = Assert.Throws<BridgeException>(() => _svc.Start("v1"));
        Assert.Contains("No microphone", ex.Message);
        Assert.False(_svc.Status().Listening);
    }

    [Fact]
    public void Safe_mode_turns_voice_off()
    {
        _svc.SafeMode = true;
        Assert.False(_svc.Status().Available);
        Assert.Throws<BridgeException>(() => _svc.Start("v1"));
    }
}
