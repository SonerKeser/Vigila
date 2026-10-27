namespace Vigila.Core;

/// <summary>
/// Tarayıcının bildirdiği gerçek sunum bilgisi. Zamanlar performance.now() zaman tabanındadır (ms),
/// böylece klavye olaylarının zaman damgalarıyla doğrudan karşılaştırılabilir.
/// </summary>
public sealed record StimulusPresentation(
    int Index,
    double? VisualOnset,
    double? AudioOnset,
    double? Offset,
    double? MediaOnsetMs,
    bool Interrupted);

/// <summary>Bir tuş basışı: performance zaman damgası ve o andaki video zamanı.</summary>
public sealed record ResponseEvent(double Time, double MediaMs, string Key);

public enum TrialOutcome
{
    Hit,
    Miss,
    Anticipation,
    NotPresented,
}

public sealed record TrialResult(
    int Index,
    StimulusKind Kind,
    int PlannedOnsetMs,
    int DurationMs,
    double? OnsetTime,
    double? OnsetLagMs,
    double? AvAsyncMs,
    TrialOutcome Outcome,
    double? RtMs,
    int ExtraResponses,
    int? Quadrant,
    Guid? ImageId,
    Guid? AudioId,
    bool Interrupted,
    int Block = 0);

public sealed record FalseAlarm(double Time, double MediaMs);

/// <summary>Bir tekrar bloğundaki performans; zamanla dikkat düşüşünü (vigilance decrement) görmek için.</summary>
public sealed record BlockStats(int Block, int Trials, int Hits, double HitRate, double? MeanRt);

public sealed record KindStats(
    StimulusKind Kind,
    int Trials,
    int Hits,
    int Misses,
    int Anticipations,
    double HitRate,
    double? MeanRt,
    double? MedianRt,
    double? SdRt);

public sealed record QuadrantStats(int Quadrant, int Trials, int Hits, double HitRate, double? MeanRt);

/// <summary>Sunumun ne kadar plana uygun gerçekleştiğini gösteren kalite göstergeleri.</summary>
public sealed record TimingQuality(double? MeanOnsetLagMs, double? MaxOnsetLagMs, double? MeanAvAsyncMs, int Interruptions);

public sealed record SessionSummary(
    int Trials,
    int Presented,
    int Hits,
    int Misses,
    int Anticipations,
    int FalseAlarms,
    int ExtraResponses,
    double HitRate,
    double? MeanRt,
    double? MedianRt,
    double? SdRt,
    double? MinRt,
    double? MaxRt,
    double FalseAlarmsPerMinute,
    double? RedundancyGainMs,
    IReadOnlyList<KindStats> ByKind,
    IReadOnlyList<QuadrantStats> ByQuadrant,
    TimingQuality Timing,
    double? FalseAlarmRate = null,
    double? DPrime = null,
    double? Criterion = null,
    double? Ies = null,
    double? TrimmedMeanRt = null,
    IReadOnlyList<BlockStats>? ByBlock = null);

public sealed record ScoringInput(
    ExperimentSettings Settings,
    IReadOnlyList<ScheduledStimulus> Schedule,
    IReadOnlyList<StimulusPresentation> Presentations,
    IReadOnlyList<ResponseEvent> Responses,
    double ObservedDurationMs,
    int Interruptions,
    int BlockSize = 0);

public sealed record ScoringResult(IReadOnlyList<TrialResult> Trials, IReadOnlyList<FalseAlarm> FalseAlarms, SessionSummary Summary);

/// <summary>
/// Ham tuş basışlarını uyaranlarla eşleştirip deneme sonuçlarını ve oturum özetini hesaplar.
/// Kural: bir basış, başlangıcı basıştan önce olan en son uyarana, yanıt penceresi içindeyse atanır.
/// O uyarana atanan ilk basış tepki süresini belirler, sonrakiler "fazladan yanıt" sayılır.
/// Hiçbir pencereye düşmeyen basış yanlış alarmdır.
/// </summary>
public static class SessionScorer
{
    public static ScoringResult Score(ScoringInput input)
    {
        var s = input.Settings;
        var byIndex = input.Presentations
            .GroupBy(p => p.Index)
            .ToDictionary(g => g.Key, g => g.First());

        var onsets = new List<(int Index, double Onset)>();
        foreach (var stim in input.Schedule)
        {
            if (byIndex.TryGetValue(stim.Index, out var p) && EffectiveOnset(p) is double onset)
                onsets.Add((stim.Index, onset));
        }
        onsets.Sort((a, b) => a.Onset.CompareTo(b.Onset));

        var firstRt = new Dictionary<int, double>();
        var extra = new Dictionary<int, int>();
        var falseAlarms = new List<FalseAlarm>();

        var responses = input.Responses
            .Where(r => IsResponse(r.Key, s))
            .OrderBy(r => r.Time)
            .ToList();

        int cursor = -1;
        foreach (var r in responses)
        {
            while (cursor + 1 < onsets.Count && onsets[cursor + 1].Onset <= r.Time) cursor++;

            if (cursor >= 0 && r.Time - onsets[cursor].Onset <= s.ResponseWindowMs)
            {
                int idx = onsets[cursor].Index;
                if (!firstRt.ContainsKey(idx)) firstRt[idx] = r.Time - onsets[cursor].Onset;
                else extra[idx] = extra.GetValueOrDefault(idx) + 1;
            }
            else
            {
                falseAlarms.Add(new FalseAlarm(Math.Round(r.Time, 3), Math.Round(r.MediaMs, 1)));
            }
        }

        var trials = new List<TrialResult>(input.Schedule.Count);
        foreach (var stim in input.Schedule.OrderBy(x => x.Index))
        {
            byIndex.TryGetValue(stim.Index, out var p);
            double? onset = p is null ? null : EffectiveOnset(p);
            bool interrupted = p?.Interrupted ?? false;
            double? rt = firstRt.TryGetValue(stim.Index, out var v) ? Math.Round(v, 2) : null;

            TrialOutcome outcome;
            if (onset is null) outcome = TrialOutcome.NotPresented;
            else if (rt is double value) outcome = value < s.MinValidRtMs ? TrialOutcome.Anticipation : TrialOutcome.Hit;
            else outcome = interrupted ? TrialOutcome.NotPresented : TrialOutcome.Miss;

            double? lag = p?.MediaOnsetMs is double media ? Math.Round(media - stim.OnsetMs, 1) : null;
            double? avAsync = p is { VisualOnset: double vo, AudioOnset: double ao } ? Math.Round(ao - vo, 2) : null;

            trials.Add(new TrialResult(
                stim.Index, stim.Kind, stim.OnsetMs, stim.DurationMs,
                onset is double o ? Math.Round(o, 3) : null, lag, avAsync,
                outcome, rt, extra.GetValueOrDefault(stim.Index),
                stim.Quadrant, stim.ImageId, stim.AudioId, interrupted,
                input.BlockSize > 0 ? stim.Index / input.BlockSize : 0));
        }

        return new ScoringResult(trials, falseAlarms, Summarize(input, trials, falseAlarms));
    }

    /// <summary>Dokunma ve fare tıklamaları "Pointer" anahtarıyla kaydedilir.</summary>
    public const string PointerKey = "Pointer";

    private static bool IsResponse(string key, ExperimentSettings s) => s.ResponseMode switch
    {
        ResponseMode.Pointer => key == PointerKey,
        ResponseMode.Both => key == PointerKey || key == s.ResponseKey,
        _ => key == s.ResponseKey,
    };

    private static double? EffectiveOnset(StimulusPresentation p) =>
        (p.VisualOnset, p.AudioOnset) switch
        {
            (double v, double a) => Math.Min(v, a),
            (double v, null) => v,
            (null, double a) => a,
            _ => null,
        };

    private static SessionSummary Summarize(ScoringInput input, List<TrialResult> trials, List<FalseAlarm> falseAlarms)
    {
        var presented = trials.Where(t => t.Outcome != TrialOutcome.NotPresented).ToList();
        var hits = presented.Where(t => t.Outcome == TrialOutcome.Hit).ToList();
        var rts = hits.Select(t => t.RtMs!.Value).ToList();

        var byKind = Enum.GetValues<StimulusKind>()
            .Select(kind =>
            {
                var group = presented.Where(t => t.Kind == kind).ToList();
                var groupRts = group.Where(t => t.Outcome == TrialOutcome.Hit).Select(t => t.RtMs!.Value).ToList();
                return new KindStats(
                    kind,
                    group.Count,
                    groupRts.Count,
                    group.Count(t => t.Outcome == TrialOutcome.Miss),
                    group.Count(t => t.Outcome == TrialOutcome.Anticipation),
                    Ratio(groupRts.Count, group.Count),
                    Stats.Mean(groupRts),
                    Stats.Median(groupRts),
                    Stats.Sd(groupRts));
            })
            .Where(k => k.Trials > 0)
            .ToList();

        var byQuadrant = Enumerable.Range(0, 4)
            .Select(q =>
            {
                var group = presented.Where(t => t.Quadrant == q).ToList();
                var groupRts = group.Where(t => t.Outcome == TrialOutcome.Hit).Select(t => t.RtMs!.Value).ToList();
                return new QuadrantStats(q, group.Count, groupRts.Count, Ratio(groupRts.Count, group.Count), Stats.Mean(groupRts));
            })
            .Where(q => q.Trials > 0)
            .ToList();

        double? Mean(StimulusKind k) => byKind.FirstOrDefault(x => x.Kind == k)?.MeanRt;
        double? redundancyGain = Mean(StimulusKind.Visual) is double mv && Mean(StimulusKind.Auditory) is double ma && Mean(StimulusKind.Audiovisual) is double mav
            ? Math.Round(Math.Min(mv, ma) - mav, 2)
            : null;

        var lags = trials.Where(t => t.OnsetLagMs is not null).Select(t => Math.Abs(t.OnsetLagMs!.Value)).ToList();
        var asyncs = trials.Where(t => t.AvAsyncMs is not null).Select(t => t.AvAsyncMs!.Value).ToList();

        double minutes = input.ObservedDurationMs / 60_000.0;

        // Yanlış alarm fırsatı: uyaran pencereleri dışında kalan süre, yanıt penceresi uzunluğunda dilimlere bölünür.
        var s = input.Settings;
        double signalMs = presented.Sum(t => (double)Math.Max(t.DurationMs, s.ResponseWindowMs));
        int opportunities = input.ObservedDurationMs > 0 ? Math.Max(1, (int)((input.ObservedDurationMs - signalMs) / s.ResponseWindowMs)) : 0;
        var sdt = SignalDetection.Compute(hits.Count, presented.Count, falseAlarms.Count, opportunities);
        double hitRate = Ratio(hits.Count, presented.Count);
        double? meanRt = Stats.Mean(rts);

        var byBlock = presented
            .GroupBy(t => t.Block)
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var blockRts = g.Where(t => t.Outcome == TrialOutcome.Hit).Select(t => t.RtMs!.Value).ToList();
                return new BlockStats(g.Key + 1, g.Count(), blockRts.Count, Ratio(blockRts.Count, g.Count()), Stats.Mean(blockRts));
            })
            .ToList();

        return new SessionSummary(
            trials.Count,
            presented.Count,
            hits.Count,
            presented.Count(t => t.Outcome == TrialOutcome.Miss),
            presented.Count(t => t.Outcome == TrialOutcome.Anticipation),
            falseAlarms.Count,
            trials.Sum(t => t.ExtraResponses),
            hitRate,
            meanRt,
            Stats.Median(rts),
            Stats.Sd(rts),
            rts.Count > 0 ? rts.Min() : null,
            rts.Count > 0 ? rts.Max() : null,
            minutes > 0 ? Math.Round(falseAlarms.Count / minutes, 3) : 0,
            redundancyGain,
            byKind,
            byQuadrant,
            new TimingQuality(Stats.Mean(lags), lags.Count > 0 ? lags.Max() : null, Stats.Mean(asyncs), input.Interruptions),
            opportunities > 0 ? Math.Round(Math.Min(1, (double)falseAlarms.Count / opportunities), 4) : null,
            sdt?.DPrime,
            sdt?.Criterion,
            meanRt is double m && hitRate > 0 ? Math.Round(m / hitRate, 2) : null,
            Stats.TrimmedMean(rts, 2.5),
            byBlock);
    }

    private static double Ratio(int part, int whole) => whole == 0 ? 0 : Math.Round((double)part / whole, 4);
}

public static class Stats
{
    public static double? Mean(IReadOnlyCollection<double> values) =>
        values.Count == 0 ? null : Math.Round(values.Average(), 2);

    public static double? Median(IReadOnlyCollection<double> values)
    {
        if (values.Count == 0) return null;
        var sorted = values.Order().ToArray();
        int mid = sorted.Length / 2;
        return Math.Round(sorted.Length % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, 2);
    }

    /// <summary>Ortalamadan ±k standart sapma dışındaki değerler atılarak hesaplanan ortalama (en az 5 değer).</summary>
    public static double? TrimmedMean(IReadOnlyCollection<double> values, double k)
    {
        if (values.Count < 5) return Mean(values);
        double mean = values.Average();
        double sd = Math.Sqrt(values.Sum(v => (v - mean) * (v - mean)) / (values.Count - 1));
        var kept = values.Where(v => Math.Abs(v - mean) <= k * sd).ToList();
        return Mean(kept);
    }

    /// <summary>Örneklem standart sapması (n-1).</summary>
    public static double? Sd(IReadOnlyCollection<double> values)
    {
        if (values.Count < 2) return null;
        double mean = values.Average();
        double sum = values.Sum(v => (v - mean) * (v - mean));
        return Math.Round(Math.Sqrt(sum / (values.Count - 1)), 2);
    }
}
