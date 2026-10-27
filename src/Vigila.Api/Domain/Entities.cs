using System.Security.Cryptography;
using Vigila.Core;

namespace Vigila.Api.Domain;

public enum UserRole
{
    Researcher,
    Admin,
}

public enum MediaKind
{
    Video,
    Image,
    Audio,
}

public enum SessionStatus
{
    Created,
    Running,
    Completed,
    Aborted,
}

public enum SessionOrigin
{
    Lab,
    Link,
}

public enum QuestionType
{
    Text,
    Number,
    Choice,
    Scale,
}

/// <summary>Katılımcı formundaki bir soru. Ölçek için Min/Max, seçmeli soru için Options kullanılır.</summary>
public sealed record Question(string Id, string Label, QuestionType Type, List<string>? Options, bool Required, int? Min, int? Max);

/// <summary>Alıştırma bloğunun özeti; asıl puanlamaya katılmaz, katılımcının görevi anlayıp anlamadığını gösterir.</summary>
public sealed record PracticeResult(int Trials, int Hits, double? MeanRt);

public sealed class User
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Email { get; set; }
    public required string DisplayName { get; set; }
    public required string PasswordHash { get; set; }
    public UserRole Role { get; set; }

    /// <summary>Kalan oturum kredisi. null sınırsız demektir.</summary>
    public int? CreditsRemaining { get; set; }
    public int CreditsUsed { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>Parola değişince ya da hesap kapatılınca yenilenir; eski oturum çerezleri geçersizleşir.</summary>
    public string SecurityStamp { get; set; } = NewStamp();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }

    public static string NewStamp() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
}

public sealed class MediaAsset
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid OwnerId { get; set; }
    public MediaKind Kind { get; set; }
    public required string Name { get; set; }
    public required string OriginalFileName { get; set; }
    public required string StoredName { get; set; }
    public required string ContentType { get; set; }
    public long SizeBytes { get; set; }
    public int? DurationMs { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public string? PosterStoredName { get; set; }

    /// <summary>Ses dalga biçimi için 0-100 arası tepe değerleri.</summary>
    public List<int>? Peaks { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class Experiment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid OwnerId { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = "";
    public string InstructionText { get; set; } = "";
    public Guid? VideoId { get; set; }
    public Guid? InstructionVideoId { get; set; }
    public List<Guid> ImageIds { get; set; } = [];
    public List<Guid> AudioIds { get; set; } = [];
    public ExperimentSettings Settings { get; set; } = new();
    public string? RunToken { get; set; }
    public bool RunLinkEnabled { get; set; }
    public bool IsArchived { get; set; }

    /// <summary>Boş değilse katılımcı başlamadan önce bu metni okuyup onaylar.</summary>
    public string ConsentText { get; set; } = "";
    public List<Question> Questions { get; set; } = [];

    // Bağlantıyla katılım denetimleri
    public int? MaxParticipants { get; set; }
    public DateTime? LinkExpiresAt { get; set; }
    public bool PreventRepeat { get; set; }

    /// <summary>Deney bitince yönlendirilecek adres; {kod} katılımcı koduyla değiştirilir.</summary>
    public string? CompletionUrl { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Oturum açıldığı andaki videonun kopyası; video sonradan değişse de sonuçlar yorumlanabilir kalır.</summary>
public sealed record VideoSnapshot(Guid VideoId, string Name, int DurationMs, int Width, int Height);

public sealed record ClientInfo(
    string? UserAgent,
    int? ScreenWidth,
    int? ScreenHeight,
    int? ViewportWidth,
    int? ViewportHeight,
    double? PixelRatio,
    double? RefreshRateHz,
    double? AudioOutputLatencyMs,
    double? AudioBaseLatencyMs,
    bool? VideoFrameCallback,
    bool? Fullscreen,
    string? Timezone,
    string? Language);

/// <summary>Deney sırasında yaşanan kesinti (duraklatma, sekme değiştirme, tam ekrandan çıkma).</summary>
public sealed record Interruption(string Reason, double AtMediaMs, double AtTime, double? ResumedAt);

public sealed class Session
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ExperimentId { get; set; }
    public Guid OwnerId { get; set; }
    public required string ParticipantCode { get; set; }
    public SessionOrigin Origin { get; set; }
    public SessionStatus Status { get; set; } = SessionStatus.Created;
    public long Seed { get; set; }
    public required string KeyHash { get; set; }
    public required ExperimentSettings Settings { get; set; }
    public required VideoSnapshot Video { get; set; }
    public required List<ScheduledStimulus> Schedule { get; set; }
    public List<StimulusPresentation>? Presentations { get; set; }
    public List<ResponseEvent>? Responses { get; set; }
    public List<Interruption>? Interruptions { get; set; }
    public ClientInfo? Client { get; set; }
    public List<TrialResult>? Trials { get; set; }
    public List<FalseAlarm>? FalseAlarms { get; set; }
    public SessionSummary? Summary { get; set; }

    public Dictionary<string, string>? Answers { get; set; }
    public DateTime? ConsentAt { get; set; }
    public PracticeResult? Practice { get; set; }

    /// <summary>Canlı izleme: yürütücünün son bildirdiği an ve video konumu.</summary>
    public DateTime? LastSeenAt { get; set; }
    public int? ProgressMs { get; set; }

    // Liste ve panolarda hızlı sorgu için özetten kopyalanan alanlar.
    public int TrialCount { get; set; }
    public double? HitRate { get; set; }
    public double? MeanRt { get; set; }
    public int? FalseAlarmCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
