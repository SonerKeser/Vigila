using Vigila.Core;

namespace Vigila.Tests;

public class StatisticsTests
{
    [Fact]
    public void Inverse_normal_matches_known_quantiles()
    {
        Assert.Equal(1.959964, Distributions.InverseNormal(0.975), 5);
        Assert.Equal(0, Distributions.InverseNormal(0.5), 9);
        Assert.Equal(-2.326348, Distributions.InverseNormal(0.01), 5);
    }

    [Theory]
    [InlineData(1.0, 1, 0.5)]
    [InlineData(2.0, 10, 0.073388)]
    [InlineData(2.228139, 10, 0.05)]
    public void Two_tailed_p_matches_student_t(double t, int df, double expected)
    {
        Assert.Equal(expected, Distributions.TwoTailedP(t, df), 4);
    }

    [Fact]
    public void Paired_t_test_reports_t_p_and_effect_size()
    {
        var test = HypothesisTests.Paired([(10, 8), (12, 9), (9, 8), (11, 7)])!;
        Assert.Equal(4, test.N);
        Assert.Equal(2.5, test.MeanDiff);
        Assert.Equal(3.873, test.T, 3);
        Assert.Equal(3, test.Df);
        Assert.Equal(0.0305, test.P, 3);
        Assert.Equal(1.936, test.Dz, 3);
        Assert.Null(HypothesisTests.Paired([(1, 2)]));
    }

    [Fact]
    public void Signal_detection_uses_log_linear_correction()
    {
        var (dPrime, criterion) = SignalDetection.Compute(8, 10, 1, 20)!.Value;
        Assert.Equal(2.213, dPrime, 2);
        Assert.Equal(0.359, criterion, 2);

        // Hiç yanlış alarm ve tam isabet olsa bile sonsuz değer çıkmaz.
        var perfect = SignalDetection.Compute(10, 10, 0, 30)!.Value;
        Assert.True(double.IsFinite(perfect.DPrime));
        Assert.Null(SignalDetection.Compute(0, 0, 0, 10));
    }

    [Fact]
    public void Trimmed_mean_drops_outliers_beyond_k_sd()
    {
        double[] rts = [400, 410, 420, 430, 440, 405, 415, 425, 435, 445, 3000];
        Assert.Equal(422.5, Stats.TrimmedMean(rts, 2.5));
        Assert.Equal(Stats.Mean([400, 500]), Stats.TrimmedMean([400, 500], 2.5));
    }

    [Fact]
    public void Practice_schedule_has_requested_length_and_its_own_order()
    {
        var images = new[] { new ImageStimulus(Guid.NewGuid(), 100, 100), new ImageStimulus(Guid.NewGuid(), 100, 100) };
        var audios = new[] { new AudioStimulus(Guid.NewGuid(), 300) };
        var settings = new ExperimentSettings { PracticeTrials = 5 };
        var request = new ScheduleRequest(settings, 120_000, 1920, 1080, images, audios, 99);

        var (stimuli, durationMs) = ScheduleGenerator.GeneratePractice(request);

        Assert.Equal(5, stimuli.Count);
        Assert.Equal([0, 1, 2, 3, 4], stimuli.Select(s => s.Index));
        Assert.True(stimuli.Zip(stimuli.Skip(1)).All(p => p.Second.OnsetMs > p.First.OnsetMs));
        Assert.True(durationMs > stimuli[^1].OnsetMs);
        Assert.Empty(ScheduleGenerator.GeneratePractice(request with { Settings = settings with { PracticeTrials = 0 } }).Stimuli);
    }

    [Fact]
    public void Scorer_reports_blocks_and_signal_detection()
    {
        var settings = new ExperimentSettings { Repetitions = 2, ResponseWindowMs = 1500 };
        ScheduledStimulus Stim(int i, int onset) => new(i, StimulusKind.Visual, Guid.NewGuid(), null, onset, 1000, new StimulusBox(0.1, 0.1, 0.2, 0.2), 0);
        var schedule = new[] { Stim(0, 5000), Stim(1, 10_000), Stim(2, 15_000), Stim(3, 20_000) };
        var presentations = schedule.Select(s => new StimulusPresentation(s.Index, s.OnsetMs, null, s.OnsetMs + 1000, s.OnsetMs, false)).ToList();
        var responses = new[]
        {
            new ResponseEvent(5300, 5300, "Space"),
            new ResponseEvent(10_350, 10_350, "Space"),
            new ResponseEvent(15_500, 15_500, "Space"),
            new ResponseEvent(30_000, 30_000, "Space"),
        };

        var summary = SessionScorer.Score(new ScoringInput(settings, schedule, presentations, responses, 60_000, 0, BlockSize: 2)).Summary;

        Assert.Equal(2, summary.ByBlock!.Count);
        Assert.Equal(1.0, summary.ByBlock[0].HitRate);
        Assert.Equal(0.5, summary.ByBlock[1].HitRate);
        Assert.NotNull(summary.DPrime);
        Assert.True(summary.FalseAlarmRate > 0);
        Assert.Equal(Math.Round(summary.MeanRt!.Value / 0.75, 2), summary.Ies);
    }
}
