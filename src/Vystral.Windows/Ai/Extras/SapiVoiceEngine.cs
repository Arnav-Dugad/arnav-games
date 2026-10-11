using System.Globalization;
using System.Speech.Recognition;
using Microsoft.Win32;
using Vystral.Windows.Services;

namespace Vystral.Windows.Ai.Extras;

/// <summary>
/// Track E1: the Windows desktop speech recognizer (SAPI 5, "Microsoft Speech Recognizer 8.0 for Windows") with its
/// free-dictation grammar, run in-process (<see cref="SpeechRecognitionEngine"/>, not the shared Windows Speech
/// Recognition UI). Recognition happens on this PC: the engine and its language data are part of Windows' language
/// features, and nothing is sent anywhere. Verified on Windows 11 (build 26300): dictation from a recording returned live
/// hypotheses and a final phrase with the network unused.
/// </summary>
public sealed class SapiVoiceEngine : IVoiceEngine
{
    private readonly SpeechRecognitionEngine _engine;
    private bool _running;

    public string Language { get; }
    public event Action<string>? Hypothesis;
    public event Action<string>? Phrase;
    public event Action<int>? Level;
    public event Action<string?>? Ended;

    public SapiVoiceEngine(CultureInfo culture)
    {
        var info = SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(r => r.Culture.Name.Equals(culture.Name, StringComparison.OrdinalIgnoreCase))
                   ?? throw new ArgumentException("No recognizer for that language.", nameof(culture));
        Language = info.Culture.Name;
        _engine = new SpeechRecognitionEngine(info);
        _engine.LoadGrammar(new DictationGrammar());
        // Short silences end a phrase (so words arrive while the button is still held); a long hold keeps listening.
        _engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(500);
        _engine.SpeechHypothesized += (_, e) => Hypothesis?.Invoke(e.Result.Text);
        _engine.SpeechRecognized += (_, e) => Phrase?.Invoke(e.Result.Text);
        _engine.AudioLevelUpdated += (_, e) => Level?.Invoke(e.AudioLevel);
        _engine.RecognizeCompleted += (_, e) =>
        {
            _running = false;
            Ended?.Invoke(e.Error is null || e.Cancelled ? null : "Speech recognition stopped unexpectedly. Try again.");
        };
    }

    public void Start()
    {
        if (_running) return;
        _engine.SetInputToDefaultAudioDevice(); // throws InvalidOperationException when there's no microphone
        _engine.RecognizeAsync(RecognizeMode.Multiple);
        _running = true;
    }

    public void Stop()
    {
        if (!_running) throw new InvalidOperationException("Not listening.");
        _engine.RecognizeAsyncStop();
    }

    public void Cancel()
    {
        if (!_running) return;
        _engine.RecognizeAsyncCancel();
    }

    public void Dispose()
    {
        try
        {
            if (_running) _engine.RecognizeAsyncCancel();
            _engine.SetInputToNull();
        }
        catch (InvalidOperationException) { }
        _engine.Dispose();
    }
}

/// <summary>The real device: installed SAPI recognizers and Windows' microphone consent switches (read-only registry).</summary>
public sealed class WindowsVoiceBackend : IVoiceBackend
{
    public IReadOnlyList<CultureInfo> Languages() =>
        SpeechRecognitionEngine.InstalledRecognizers().Select(r => r.Culture).DistinctBy(c => c.Name).ToList();

    public IVoiceEngine Create(CultureInfo language) => new SapiVoiceEngine(language);

    public (string? Global, string? Desktop) MicrophoneConsent()
    {
        const string root = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(root);
            using var desktop = Registry.CurrentUser.OpenSubKey(root + @"\NonPackaged");
            return (key?.GetValue("Value") as string, desktop?.GetValue("Value") as string);
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            Log.Warn("voice", "Couldn't read the microphone privacy setting", new { error = ex.GetType().Name });
            return (null, null);
        }
    }
}
