namespace Vigila.Core;

/// <summary>Bir uyaranın hangi duyu kanalından sunulduğu.</summary>
public enum StimulusKind
{
    Visual,
    Auditory,
    Audiovisual,
}

/// <summary>Görsel ve işitsel uyaranların denemelere nasıl dağıtılacağı.</summary>
public enum PairingMode
{
    /// <summary>Her görsel ve her ses ayrı bir deneme olur.</summary>
    Independent,

    /// <summary>Görseller seslerle eşleştirilip birlikte sunulur.</summary>
    Paired,

    /// <summary>Görsel, işitsel ve görsel-işitsel denemeler bir arada (artıklık kazancı ölçümü).</summary>
    Mixed,
}

/// <summary>Görsel uyaranların ekran üzerindeki yerleşimi.</summary>
public enum PositionMode
{
    Random,
    BalancedQuadrants,
    Center,
}

/// <summary>Zamanlama tohumunun her oturumda mı yenileneceği, yoksa sabit mi olacağı.</summary>
public enum SeedMode
{
    PerSession,
    Fixed,
}

/// <summary>Katılımcının nasıl yanıt vereceği.</summary>
public enum ResponseMode
{
    Keyboard,
    Pointer,
    Both,
}

/// <summary>Katılımcı ekranlarının dili.</summary>
public enum ParticipantLanguage
{
    Tr,
    En,
}

/// <summary>Bir deneyin uyaran yerleşimini ve yanıt değerlendirmesini belirleyen ayarlar.</summary>
public sealed record ExperimentSettings
{
    /// <summary>Uyaran havuzunun kaç kez tekrarlanacağı.</summary>
    public int Repetitions { get; init; } = 1;

    /// <summary>Uyaranın ekranda kalma süresinin alt sınırı (ms).</summary>
    public int DurationMinMs { get; init; } = 1000;

    /// <summary>Uyaranın ekranda kalma süresinin üst sınırı (ms). Alt sınıra eşitse süre sabittir.</summary>
    public int DurationMaxMs { get; init; } = 1500;

    public PairingMode Pairing { get; init; } = PairingMode.Independent;

    public PositionMode Positioning { get; init; } = PositionMode.Random;

    /// <summary>Görsel uyaran genişliğinin video genişliğine oranı (0-1).</summary>
    public double ImageScale { get; init; } = 0.16;

    /// <summary>Görsellerin video kenarından uzak tutulacağı pay (0-0,25).</summary>
    public double SafeMargin { get; init; } = 0.04;

    /// <summary>Uyaran başlangıcından sonra yanıtın isabet sayılacağı süre (ms).</summary>
    public int ResponseWindowMs { get; init; } = 2000;

    /// <summary>Ardışık iki uyaranın yanıt pencereleri arasında bırakılacak en kısa boşluk (ms).</summary>
    public int MinGapMs { get; init; } = 1500;

    /// <summary>Video başında uyaran gösterilmeyecek süre (ms).</summary>
    public int LeadInMs { get; init; } = 3000;

    /// <summary>Video sonunda uyaran gösterilmeyecek süre (ms).</summary>
    public int TailMs { get; init; } = 2000;

    /// <summary>Bundan kısa tepki süreleri gerçek tepki sayılmaz, erken basış olarak işaretlenir (ms).</summary>
    public int MinValidRtMs { get; init; } = 100;

    /// <summary>Yanıt tuşu, KeyboardEvent.code değeri olarak (ör. "Space", "KeyB").</summary>
    public string ResponseKey { get; init; } = "Space";

    public double AudioVolume { get; init; } = 0.8;

    public double VideoVolume { get; init; } = 1.0;

    public SeedMode SeedMode { get; init; } = SeedMode.PerSession;

    public int FixedSeed { get; init; } = 20240501;

    /// <summary>Katılımcı Esc ile deneyi duraklatabilir mi?</summary>
    public bool AllowPause { get; init; } = true;

    /// <summary>Asıl deneyden önce, videosuz bir sahnede sunulacak alıştırma uyaranı sayısı (0: alıştırma yok).</summary>
    public int PracticeTrials { get; init; } = 0;

    /// <summary>Alıştırmada her uyarandan sonra isabet ve tepki süresi gösterilsin mi?</summary>
    public bool PracticeFeedback { get; init; } = true;

    public ResponseMode ResponseMode { get; init; } = ResponseMode.Keyboard;

    public ParticipantLanguage Language { get; init; } = ParticipantLanguage.Tr;

    /// <summary>Klavyeyle yanıt gerekiyorsa yalnız dokunmatik cihazlar (telefon, tablet) katılamaz.</summary>
    public bool BlockTouchOnly { get; init; } = true;
}

public sealed record ValidationIssue(string Field, string Message);

public static class SettingsValidator
{
    public static IReadOnlyList<ValidationIssue> Validate(ExperimentSettings s)
    {
        var issues = new List<ValidationIssue>();

        void Range(string field, double value, double min, double max, string label)
        {
            if (double.IsNaN(value) || value < min || value > max)
                issues.Add(new(field, $"{label} {min:0.##} ile {max:0.##} arasında olmalı."));
        }

        Range(nameof(s.Repetitions), s.Repetitions, 1, 50, "Tekrar sayısı");
        Range(nameof(s.DurationMinMs), s.DurationMinMs, 50, 60_000, "En kısa gösterim süresi (ms)");
        Range(nameof(s.DurationMaxMs), s.DurationMaxMs, 50, 60_000, "En uzun gösterim süresi (ms)");
        if (s.DurationMaxMs < s.DurationMinMs)
            issues.Add(new(nameof(s.DurationMaxMs), "En uzun gösterim süresi en kısa süreden küçük olamaz."));
        Range(nameof(s.ImageScale), s.ImageScale, 0.02, 0.9, "Görsel boyutu oranı");
        Range(nameof(s.SafeMargin), s.SafeMargin, 0, 0.25, "Kenar payı");
        Range(nameof(s.ResponseWindowMs), s.ResponseWindowMs, 200, 30_000, "Yanıt penceresi (ms)");
        Range(nameof(s.MinGapMs), s.MinGapMs, 0, 120_000, "Uyaranlar arası boşluk (ms)");
        Range(nameof(s.LeadInMs), s.LeadInMs, 0, 600_000, "Başlangıç boşluğu (ms)");
        Range(nameof(s.TailMs), s.TailMs, 0, 600_000, "Bitiş boşluğu (ms)");
        Range(nameof(s.MinValidRtMs), s.MinValidRtMs, 0, 1000, "En kısa geçerli tepki süresi (ms)");
        Range(nameof(s.AudioVolume), s.AudioVolume, 0, 1, "Uyaran ses düzeyi");
        Range(nameof(s.VideoVolume), s.VideoVolume, 0, 1, "Video ses düzeyi");
        if (s.MinValidRtMs >= s.ResponseWindowMs)
            issues.Add(new(nameof(s.MinValidRtMs), "En kısa geçerli tepki süresi yanıt penceresinden kısa olmalı."));
        if (string.IsNullOrWhiteSpace(s.ResponseKey) || s.ResponseKey.Length > 32 || s.ResponseKey == "Escape")
            issues.Add(new(nameof(s.ResponseKey), "Geçerli bir yanıt tuşu seçin (Esc kullanılamaz)."));
        if (s.FixedSeed < 0)
            issues.Add(new(nameof(s.FixedSeed), "Sabit tohum negatif olamaz."));
        Range(nameof(s.PracticeTrials), s.PracticeTrials, 0, 20, "Alıştırma uyaranı sayısı");

        return issues;
    }
}
