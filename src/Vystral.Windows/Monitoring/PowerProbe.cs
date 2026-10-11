using System.Runtime.InteropServices;
using Vystral.Core.Insights;
using Vystral.Windows.Services;

namespace Vystral.Windows.Monitoring;

/// <summary>
/// Track E3: the PC's power state, read-only. <c>GetSystemPowerStatus</c> gives the power source, whether a system
/// battery exists, its charge and whether battery saver is on; the effective power mode (Windows 10 1809+) comes from
/// <c>PowerRegisterForEffectivePowerModeNotifications</c>, which only listens — nothing here changes a power setting,
/// plan or mode.
/// </summary>
public static class PowerProbe
{
    /// <summary>The current power state, or null when Windows didn't answer.</summary>
    public static PowerReading? Read()
    {
        if (!GetSystemPowerStatus(out var s)) return null;
        return Interpret(s.ACLineStatus, s.BatteryFlag, s.BatteryLifePercent, s.SystemStatusFlag, EffectiveMode.Current);
    }

    /// <summary>Whether this PC reports a system battery (laptops, handhelds). False when it says "no battery" or doesn't know.</summary>
    public static bool HasBattery() => GetSystemPowerStatus(out var s) && HasBattery(s.BatteryFlag);

    /// <summary>BatteryFlag 128 = no system battery, 255 = unknown status.</summary>
    public static bool HasBattery(byte batteryFlag) => batteryFlag != 128 && batteryFlag != 255;

    /// <summary>
    /// Turns SYSTEM_POWER_STATUS fields into a reading. A PC without a battery is always "plugged in"; an unknown line
    /// status (255) stays unknown. Battery saver is SystemStatusFlag 1; the percentage 255 means unknown.
    /// </summary>
    public static PowerReading Interpret(byte acLineStatus, byte batteryFlag, byte batteryPercent, byte systemStatusFlag, int? effectiveMode)
    {
        var battery = HasBattery(batteryFlag);
        bool? onBattery = acLineStatus switch { 0 => true, 1 => false, _ => battery ? null : false };
        bool? saver = systemStatusFlag switch { 0 => false, 1 => true, _ => null };
        int? pct = battery && batteryPercent <= 100 ? batteryPercent : null;
        return new PowerReading(onBattery, saver, pct, effectiveMode is int m ? PowerModes.FromEffective(m) : null);
    }

    /// <summary>
    /// Listens for the effective power mode once per process (the registration reports the current mode right away and
    /// again on every change). Null until the first report, or when the API isn't available.
    /// </summary>
    private static class EffectiveMode
    {
        private const uint Version2 = 2; // EFFECTIVE_POWER_MODE_V2: adds game mode and mixed reality
        private static readonly EffectivePowerModeCallback Callback = OnChange; // kept alive for the process lifetime
        private static readonly Lock Gate = new();
        private static bool _registered;
        private static volatile int _mode = -1;

        public static int? Current
        {
            get
            {
                Register();
                var m = _mode;
                return m < 0 ? null : m;
            }
        }

        private static void Register()
        {
            lock (Gate)
            {
                if (_registered) return;
                _registered = true;
                try
                {
                    if (PowerRegisterForEffectivePowerModeNotifications(Version2, Callback, IntPtr.Zero, out _) != 0)
                        Log.Info("power", "Effective power mode isn't available on this PC");
                }
                catch (Exception ex) when (ex is EntryPointNotFoundException or DllNotFoundException)
                {
                    Log.Info("power", "Effective power mode isn't available on this version of Windows");
                }
            }
        }

        private static void OnChange(int mode, IntPtr context) => _mode = mode is >= 0 and <= 6 ? mode : -1;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemPowerStatus
    {
        public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
        public int BatteryLifeTime, BatteryFullLifeTime;
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate void EffectivePowerModeCallback(int mode, IntPtr context);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);

    [DllImport("powrprof.dll")]
    private static extern int PowerRegisterForEffectivePowerModeNotifications(uint version, EffectivePowerModeCallback callback, IntPtr context, out IntPtr handle);
}
