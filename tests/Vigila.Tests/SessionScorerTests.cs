using Vigila.Core;

namespace Vigila.Tests;

public class SessionScorerTests
{
    private static readonly ExperimentSettings Settings = new() { ResponseWindowMs = 1500, MinValidRtMs = 100, ResponseKey = "Space" };

    private static ScheduledStimulus Stim(int index, StimulusKind kind, int onset, int? quadrant = null) =>
        new(index, kind, kind == StimulusKind.Auditory ? null : Guid.NewGuid(), kind == StimulusKind.Visual ? null : Guid.NewGuid(),
            onset, 1000, kind == StimulusKind.Auditory ? null : new StimulusBox(0.1, 0.1, 0.2, 0.2), quadrant);

    private static StimulusPresentation Shown(int index, double perfOnset, int plannedOnset, bool audio = false) =>
        new(index, audio ? null : perfOnset, audio ? perfOnset : null, perfOnset + 1000, plannedOnset + 8, false);

    // Video zamanı 0 anı performance zaman tabanında 10_000 ms kabul edilir.
    private const double T0 = 10_000;

    [Fact]
    public void Classifies_hits_misses_anticipations_and_false_alarms()
    {
        var schedule = new[]
        {
            Stim(0, StimulusKind.Visual, 5_000, 0),
            Stim(1, StimulusKind.Auditory, 10_000),
            Stim(2, StimulusKind.Visual, 15_000, 3),
            Stim(3, StimulusKind.Visual, 20_000, 1),
        };
        var presentations = schedule.Select(s => Shown(s.Index, T0 + s.OnsetMs, s.OnsetMs, s.Kind == StimulusKind.Auditory)).ToArray();
        var responses = new[]
        {
            new ResponseEvent(T0 + 5_420, 5_420, "Space"),   // isabet, 420 ms
            new ResponseEvent(T0 + 5_900, 5_900, "Space"),   // fazladan yanıt
            new ResponseEvent(T0 + 8_000, 8_000, "Space"),   // yanlış alarm
            new ResponseEvent(T0 + 10_310, 10_310, "Space"), // isabet, 310 ms
            new ResponseEvent(T0 + 20_050, 20_050, "Space"), // erken basış (50 ms)
            new ResponseEvent(T0 + 15_300, 15_300, "KeyX"),  // yanlış tuş, yok sayılır
        };

        var result = SessionScorer.Score(new ScoringInput(Settings, schedule, presentations, responses, 60_000, 0));

        Assert.Equal(TrialOutcome.Hit, result.Trials[0].Outcome);
        Assert.Equal(420, result.Trials[0].RtMs);
        Assert.Equal(1, result.Trials[0].ExtraResponses);
        Assert.Equal(TrialOutcome.Hit, result.Trials[1].Outcome);
        Assert.Equal(310, result.Trials[1].RtMs);
        Assert.Equal(TrialOutcome.Miss, result.Trials[2].Outcome);
        Assert.Equal(TrialOutcome.Anticipation, result.Trials[3].Outcome);

        var summary = result.Summary;
        Assert.Equal(4, summary.Presented);
        Assert.Equal(2, summary.Hits);
        Assert.Equal(1, summary.Misses);
        Assert.Equal(1, summary.Anticipations);
        Assert.Equal(1, summary.FalseAlarms);
        Assert.Equal(1, summary.ExtraResponses);
        Assert.Equal(0.5, summary.HitRate);
        Assert.Equal(365, summary.MeanRt);
        Assert.Equal(1, summary.FalseAlarmsPerMinute);
        Assert.Equal(8, summary.Timing.MeanOnsetLagMs);
    }

    [Fact]
    public void Response_after_window_is_a_false_alarm()
    {
        var schedule = new[] { Stim(0, StimulusKind.Visual, 5_000) };
        var presentations = new[] { Shown(0, T0 + 5_000, 5_000) };
        var responses = new[] { new ResponseEvent(T0 + 6_600, 6_600, "Space") };

        var result = SessionScorer.Score(new ScoringInput(Settings, schedule, presentations, responses, 30_000, 0));

        Assert.Equal(TrialOutcome.Miss, result.Trials[0].Outcome);
        Assert.Single(result.FalseAlarms);
    }

    [Fact]
    public void Unpresented_and_interrupted_trials_are_excluded_from_hit_rate()
    {
        var schedule = new[] { Stim(0, StimulusKind.Visual, 5_000), Stim(1, StimulusKind.Visual, 9_000), Stim(2, StimulusKind.Visual, 13_000) };
        var presentations = new[]
        {
            Shown(0, T0 + 5_000, 5_000),
            new StimulusPresentation(1, T0 + 9_000, null, null, 9_000, Interrupted: true),
        };
        var responses = new[] { new ResponseEvent(T0 + 5_250, 5_250, "Space") };

        var result = SessionScorer.Score(new ScoringInput(Settings, schedule, presentations, responses, 20_000, 1));

        Assert.Equal(TrialOutcome.NotPresented, result.Trials[1].Outcome);
        Assert.Equal(TrialOutcome.NotPresented, result.Trials[2].Outcome);
        Assert.Equal(1, result.Summary.Presented);
        Assert.Equal(1.0, result.Summary.HitRate);
        Assert.Equal(1, result.Summary.Timing.Interruptions);
    }

    [Fact]
    public void Audiovisual_onset_uses_earliest_channel_and_reports_redundancy_gain()
    {
        var schedule = new[]
        {
            Stim(0, StimulusKind.Visual, 5_000),
            Stim(1, StimulusKind.Auditory, 10_000),
            Stim(2, StimulusKind.Audiovisual, 15_000),
        };
        var presentations = new[]
        {
            Shown(0, T0 + 5_000, 5_000),
            Shown(1, T0 + 10_000, 10_000, audio: true),
            new StimulusPresentation(2, T0 + 15_010, T0 + 15_000, null, 15_000, false),
        };
        var responses = new[]
        {
            new ResponseEvent(T0 + 5_400, 0, "Space"),
            new ResponseEvent(T0 + 10_350, 0, "Space"),
            new ResponseEvent(T0 + 15_280, 0, "Space"),
        };

        var result = SessionScorer.Score(new ScoringInput(Settings, schedule, presentations, responses, 20_000, 0));

        Assert.Equal(280, result.Trials[2].RtMs);
        Assert.Equal(-10, result.Trials[2].AvAsyncMs);
        Assert.Equal(70, result.Summary.RedundancyGainMs);
        Assert.Equal(3, result.Summary.ByKind.Count);
    }

    [Theory]
    [InlineData(ResponseMode.Keyboard, 1)]
    [InlineData(ResponseMode.Pointer, 1)]
    [InlineData(ResponseMode.Both, 2)]
    public void Response_mode_decides_which_inputs_count(ResponseMode mode, int expectedHits)
    {
        var settings = Settings with { ResponseMode = mode };
        var schedule = new[] { Stim(0, StimulusKind.Visual, 5_000), Stim(1, StimulusKind.Visual, 10_000) };
        var presentations = schedule.Select(s => Shown(s.Index, T0 + s.OnsetMs, s.OnsetMs)).ToArray();
        // Klavye: [tuş, dokunma] → 1; Dokunma: [dokunma, tuş] → 1; İkisi: [tuş, dokunma] → 2
        string first = mode == ResponseMode.Pointer ? SessionScorer.PointerKey : "Space";
        string second = mode == ResponseMode.Pointer ? "Space" : SessionScorer.PointerKey;
        var responses = new[] { new ResponseEvent(T0 + 5_400, 5_400, first), new ResponseEvent(T0 + 10_400, 10_400, second) };

        var result = SessionScorer.Score(new ScoringInput(settings, schedule, presentations, responses, 30_000, 0));
        Assert.Equal(expectedHits, result.Summary.Hits);
    }

    [Fact]
    public void Stats_helpers_compute_median_and_sample_sd()
    {
        Assert.Equal(3, Stats.Median([5, 1, 3]));
        Assert.Equal(2.5, Stats.Median([4, 1, 3, 2]));
        Assert.Equal(1.58, Stats.Sd([1, 2, 3, 4, 5]));
        Assert.Null(Stats.Sd([1]));
        Assert.Null(Stats.Mean([]));
    }
}
