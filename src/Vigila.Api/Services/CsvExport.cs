using System.Globalization;
using System.Text;
using Vigila.Api.Domain;
using Vigila.Core;

namespace Vigila.Api.Services;

/// <summary>
/// Analiz yazılımlarına (R, SPSS, Python, Excel) uygun, uzun biçimli CSV üretir.
/// Sütun adları ASCII snake_case, sayılar nokta ondalıklı, kategoriler sabit İngilizce kodlardır.
/// </summary>
public static class CsvExport
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static string Trials(IEnumerable<Session> sessions, string experimentName, IReadOnlyDictionary<Guid, MediaAsset> assets)
    {
        var sb = new StringBuilder();
        Row(sb, "experiment", "session_id", "participant", "origin", "status", "started_utc", "seed",
            "trial", "block", "kind", "image", "audio", "planned_onset_ms", "duration_ms", "quadrant", "box_x", "box_y", "box_w", "box_h",
            "outcome", "rt_ms", "extra_responses", "onset_lag_ms", "av_async_ms", "interrupted");

        foreach (var s in sessions)
        {
            var boxes = s.Schedule.ToDictionary(x => x.Index, x => x.Box);
            foreach (var t in s.Trials ?? [])
            {
                var box = boxes.GetValueOrDefault(t.Index);
                Row(sb, experimentName, s.Id, s.ParticipantCode, Code(s.Origin), Code(s.Status), Date(s.StartedAt), s.Seed,
                    t.Index + 1, t.Block + 1, Code(t.Kind), Name(t.ImageId, assets), Name(t.AudioId, assets), t.PlannedOnsetMs, t.DurationMs,
                    t.Quadrant, box?.X, box?.Y, box?.W, box?.H,
                    OutcomeCode(t.Outcome), t.RtMs, t.ExtraResponses, t.OnsetLagMs, t.AvAsyncMs, t.Interrupted ? 1 : 0);
            }
        }
        return sb.ToString();
    }

    public static string Sessions(IEnumerable<Session> sessions, string experimentName, IReadOnlyList<Question> questions)
    {
        var sb = new StringBuilder();
        string[] header =
        [
            "experiment", "session_id", "participant", "origin", "status", "created_utc", "started_utc", "completed_utc", "consent_utc", "seed",
            "trials", "presented", "hits", "misses", "anticipations", "false_alarms", "extra_responses",
            "hit_rate", "mean_rt", "median_rt", "sd_rt", "min_rt", "max_rt", "trimmed_mean_rt", "ies",
            "false_alarms_per_min", "false_alarm_rate", "d_prime", "criterion", "redundancy_gain_ms",
            "visual_hit_rate", "visual_mean_rt", "auditory_hit_rate", "auditory_mean_rt", "audiovisual_hit_rate", "audiovisual_mean_rt",
            "practice_trials", "practice_hits", "practice_mean_rt",
            "mean_onset_lag_ms", "mean_av_async_ms", "interruptions", "refresh_hz", "audio_latency_ms", "screen", "user_agent",
        ];
        Row(sb, [.. header, .. questions.Select(q => $"q_{q.Id}")]);

        foreach (var s in sessions)
        {
            var m = s.Summary;
            KindStats? K(StimulusKind k) => m?.ByKind.FirstOrDefault(x => x.Kind == k);
            object?[] values =
            [
                experimentName, s.Id, s.ParticipantCode, Code(s.Origin), Code(s.Status),
                Date(s.CreatedAt), Date(s.StartedAt), Date(s.CompletedAt), Date(s.ConsentAt), s.Seed,
                s.TrialCount, m?.Presented, m?.Hits, m?.Misses, m?.Anticipations, m?.FalseAlarms, m?.ExtraResponses,
                m?.HitRate, m?.MeanRt, m?.MedianRt, m?.SdRt, m?.MinRt, m?.MaxRt, m?.TrimmedMeanRt, m?.Ies,
                m?.FalseAlarmsPerMinute, m?.FalseAlarmRate, m?.DPrime, m?.Criterion, m?.RedundancyGainMs,
                K(StimulusKind.Visual)?.HitRate, K(StimulusKind.Visual)?.MeanRt,
                K(StimulusKind.Auditory)?.HitRate, K(StimulusKind.Auditory)?.MeanRt,
                K(StimulusKind.Audiovisual)?.HitRate, K(StimulusKind.Audiovisual)?.MeanRt,
                s.Practice?.Trials, s.Practice?.Hits, s.Practice?.MeanRt,
                m?.Timing.MeanOnsetLagMs, m?.Timing.MeanAvAsyncMs, m?.Timing.Interruptions,
                s.Client?.RefreshRateHz, s.Client?.AudioOutputLatencyMs,
                s.Client is { ScreenWidth: int w, ScreenHeight: int h } ? $"{w}x{h}" : null,
                s.Client?.UserAgent,
            ];
            Row(sb, [.. values, .. questions.Select(q => (object?)s.Answers?.GetValueOrDefault(q.Id))]);
        }
        return sb.ToString();
    }

    public static string OutcomeCode(TrialOutcome o) => o switch
    {
        TrialOutcome.Hit => "hit",
        TrialOutcome.Miss => "miss",
        TrialOutcome.Anticipation => "anticipation",
        _ => "not_presented",
    };

    private static string Code<T>(T value) where T : struct, Enum => value.ToString().ToLowerInvariant();

    private static string? Date(DateTime? d) => d?.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", Inv);

    private static string? Name(Guid? id, IReadOnlyDictionary<Guid, MediaAsset> assets) =>
        id is Guid g ? assets.TryGetValue(g, out var a) ? a.OriginalFileName : g.ToString() : null;

    private static void Row(StringBuilder sb, params object?[] values)
    {
        for (int i = 0; i < values.Length; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(Escape(values[i]));
        }
        sb.Append("\r\n");
    }

    private static string Escape(object? value)
    {
        var text = value switch
        {
            null => "",
            double d => d.ToString("0.####", Inv),
            float f => f.ToString("0.####", Inv),
            IFormattable f => f.ToString(null, Inv),
            _ => value.ToString() ?? "",
        };
        // Hücre başındaki =, +, -, @ karakterleri Excel'de formül olarak çalışmasın.
        if (text.Length > 0 && value is string && "=+-@".Contains(text[0])) text = "'" + text;
        return text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
    }
}
