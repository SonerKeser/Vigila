using Vigila.Api.Domain;
using Vigila.Core;

namespace Vigila.Api.Features;

// Kimlik
public sealed record MeDto(Guid Id, string Email, string DisplayName, UserRole Role, int? CreditsRemaining, int CreditsUsed);
public sealed record LoginRequest(string? Email, string? Password, bool Remember);
public sealed record SetupStatus(bool NeedsSetup);
public sealed record SetupRequest(string? Email, string? DisplayName, string? Password);
public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

// Medya
public sealed record MediaDto(
    Guid Id,
    MediaKind Kind,
    string Name,
    string FileName,
    string ContentType,
    long SizeBytes,
    int? DurationMs,
    int? Width,
    int? Height,
    string Url,
    string? PosterUrl,
    IReadOnlyList<int>? Peaks,
    DateTime CreatedAt,
    int UsageCount);

public sealed record MediaMeta(string? Name, int? DurationMs, int? Width, int? Height, List<int>? Peaks);
public sealed record RenameMediaRequest(string? Name);

// Deneyler
public sealed record CreateExperimentRequest(string? Name, string? Description);

public sealed record ExperimentDraft(
    string? Name,
    string? Description,
    string? InstructionText,
    Guid? VideoId,
    Guid? InstructionVideoId,
    List<Guid>? ImageIds,
    List<Guid>? AudioIds,
    ExperimentSettings? Settings,
    string? ConsentText = null,
    List<Question>? Questions = null,
    int? MaxParticipants = null,
    DateTime? LinkExpiresAt = null,
    bool PreventRepeat = false,
    string? CompletionUrl = null);

public sealed record Readiness(bool Ready, IReadOnlyList<string> Issues);

public sealed record ExperimentDto(
    Guid Id,
    string Name,
    string Description,
    string InstructionText,
    Guid? VideoId,
    Guid? InstructionVideoId,
    IReadOnlyList<Guid> ImageIds,
    IReadOnlyList<Guid> AudioIds,
    ExperimentSettings Settings,
    string? RunToken,
    bool RunLinkEnabled,
    bool IsArchived,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    Readiness Readiness,
    int TrialCount,
    int SessionCount,
    string ConsentText,
    IReadOnlyList<Question> Questions,
    int? MaxParticipants,
    DateTime? LinkExpiresAt,
    bool PreventRepeat,
    string? CompletionUrl,
    int LinkCompletedCount);

public sealed record ExperimentListItem(
    Guid Id,
    string Name,
    string Description,
    string? PosterUrl,
    string? VideoName,
    int? VideoDurationMs,
    int ImageCount,
    int AudioCount,
    int TrialCount,
    int SessionCount,
    int CompletedCount,
    double? MeanHitRate,
    double? MeanRt,
    DateTime? LastSessionAt,
    bool RunLinkEnabled,
    bool IsArchived,
    bool Ready,
    DateTime UpdatedAt);

public sealed record PreviewRequest(ExperimentDraft Draft, uint? Seed);
public sealed record PreviewResponse(uint Seed, bool Ok, string? Error, ScheduleCapacity Capacity, IReadOnlyList<ScheduledStimulus> Stimuli);
public sealed record RunLinkRequest(bool Enabled, bool Regenerate);
public sealed record RunLinkResponse(bool Enabled, string? Token);
public sealed record ArchiveRequest(bool Archived);

public sealed record KindAggregate(StimulusKind Kind, int Trials, int Hits, double HitRate, double? MeanRt, double? MedianRt);
public sealed record QuadrantAggregate(int Quadrant, int Trials, int Hits, double HitRate, double? MeanRt);
public sealed record SessionPoint(Guid SessionId, string ParticipantCode, DateTime CompletedAt, double HitRate, double? MeanRt);
public sealed record KindValues(StimulusKind Kind, IReadOnlyList<double> Values);

/// <summary>İki kanalın katılımcı ortalamaları arasındaki eşleştirilmiş karşılaştırma (A − B).</summary>
public sealed record ModalityComparison(StimulusKind A, StimulusKind B, PairedTest Test);
public sealed record BlockAggregate(int Block, int Sessions, double HitRate, double? MeanRt);

public sealed record ExperimentAnalytics(
    int Sessions,
    int Completed,
    int Participants,
    double? MeanHitRate,
    double? MeanRt,
    double? MedianRt,
    IReadOnlyList<KindValues> HitRts,
    IReadOnlyList<KindAggregate> ByKind,
    IReadOnlyList<QuadrantAggregate> ByQuadrant,
    IReadOnlyList<SessionPoint> Points,
    double? MeanDPrime,
    IReadOnlyList<ModalityComparison> Comparisons,
    IReadOnlyList<BlockAggregate> ByBlock);

// Deney yürütme
public sealed record RunInfo(
    string ExperimentName,
    string InstructionText,
    string? InstructionVideoUrl,
    string ResponseKey,
    bool AllowPause,
    int VideoDurationMs,
    int TrialCount,
    string ConsentText,
    IReadOnlyList<Question> Questions,
    ResponseMode ResponseMode,
    ParticipantLanguage Language,
    bool BlockTouchOnly,
    int PracticeTrials,
    bool PreventRepeat);

public sealed record StartSessionRequest(string? ParticipantCode, ClientInfo? Client, Dictionary<string, string>? Answers = null, bool Consented = false);

public sealed record RunSettings(
    string ResponseKey,
    int ResponseWindowMs,
    bool AllowPause,
    double AudioVolume,
    double VideoVolume,
    int MinValidRtMs,
    ResponseMode ResponseMode,
    ParticipantLanguage Language,
    bool PracticeFeedback);

public sealed record RunPractice(int DurationMs, IReadOnlyList<ScheduledStimulus> Stimuli);
public sealed record RunVideo(string Url, int DurationMs, int Width, int Height, long SizeBytes);
public sealed record RunAsset(Guid Id, string Url, int? Width, int? Height, long SizeBytes);

public sealed record RunPayload(
    Guid SessionId,
    string SessionKey,
    string ParticipantCode,
    string ExperimentName,
    SessionOrigin Origin,
    RunSettings Settings,
    RunVideo Video,
    IReadOnlyList<ScheduledStimulus> Stimuli,
    IReadOnlyList<RunAsset> Images,
    IReadOnlyList<RunAsset> Audios,
    RunPractice? Practice);

public sealed record CompleteSessionRequest(
    List<StimulusPresentation>? Presentations,
    List<ResponseEvent>? Responses,
    List<Interruption>? Interruptions,
    ClientInfo? Client,
    double ObservedDurationMs,
    bool Aborted,
    PracticeResult? Practice = null);

public sealed record CompleteSessionResponse(Guid SessionId, SessionStatus Status, SessionSummary? Summary, string? RedirectUrl = null);

public sealed record HeartbeatRequest(int ProgressMs);

public sealed record LiveSession(
    Guid Id,
    Guid ExperimentId,
    string ExperimentName,
    string ParticipantCode,
    SessionOrigin Origin,
    int ProgressMs,
    int DurationMs,
    DateTime? StartedAt,
    DateTime LastSeenAt);

// Oturum sonuçları
public sealed record SessionListItem(
    Guid Id,
    Guid ExperimentId,
    string ExperimentName,
    string ParticipantCode,
    SessionOrigin Origin,
    SessionStatus Status,
    DateTime CreatedAt,
    DateTime? CompletedAt,
    int TrialCount,
    double? HitRate,
    double? MeanRt,
    int? FalseAlarms);

public sealed record AssetRef(Guid Id, MediaKind Kind, string Name, string Url, int? Width, int? Height, IReadOnlyList<int>? Peaks);

public sealed record SessionDetail(
    SessionListItem Info,
    long Seed,
    ExperimentSettings Settings,
    VideoSnapshot Video,
    string? VideoUrl,
    string? PosterUrl,
    IReadOnlyList<ScheduledStimulus> Schedule,
    IReadOnlyList<TrialResult> Trials,
    IReadOnlyList<FalseAlarm> FalseAlarms,
    IReadOnlyList<ResponseEvent> Responses,
    IReadOnlyList<Interruption> Interruptions,
    ClientInfo? Client,
    SessionSummary? Summary,
    IReadOnlyList<AssetRef> Assets,
    DateTime? StartedAt,
    IReadOnlyDictionary<string, string> Answers,
    IReadOnlyList<Question> Questions,
    DateTime? ConsentAt,
    PracticeResult? Practice);

// Pano
public sealed record DayCount(DateOnly Date, int Count);
public sealed record TrendPoint(DateTime At, double? MeanRt, double? HitRate);

public sealed record DashboardDto(
    int Experiments,
    int ActiveLinks,
    int SessionsCompleted,
    int SessionsThisWeek,
    int Participants,
    double? MeanHitRate,
    double? MeanRt,
    int? CreditsRemaining,
    int CreditsUsed,
    IReadOnlyList<DayCount> Activity,
    IReadOnlyList<SessionListItem> Recent,
    IReadOnlyList<TrendPoint> Trend);

// Yönetim
public sealed record AdminUserDto(
    Guid Id,
    string Email,
    string DisplayName,
    UserRole Role,
    bool IsActive,
    int? CreditsRemaining,
    int CreditsUsed,
    DateTime CreatedAt,
    DateTime? LastLoginAt,
    int ExperimentCount,
    int SessionCount);

public sealed record CreateUserRequest(string? Email, string? DisplayName, string? Password, UserRole Role, int? Credits);
public sealed record CreditChange(string Mode, int Value);
public sealed record UpdateUserRequest(string? DisplayName, UserRole? Role, bool? IsActive, CreditChange? Credits);
public sealed record ResetPasswordRequest(string? NewPassword);
