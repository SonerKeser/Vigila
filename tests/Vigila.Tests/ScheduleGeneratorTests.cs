using Vigila.Core;

namespace Vigila.Tests;

public class ScheduleGeneratorTests
{
    private static readonly ImageStimulus[] Images =
    [
        new(Guid.NewGuid(), 400, 300),
        new(Guid.NewGuid(), 300, 300),
        new(Guid.NewGuid(), 200, 400),
    ];

    private static readonly AudioStimulus[] Audios =
    [
        new(Guid.NewGuid(), 800),
        new(Guid.NewGuid(), 1200),
    ];

    private static ScheduleRequest Request(ExperimentSettings? settings = null, int videoMs = 180_000, uint seed = 42) =>
        new(settings ?? new ExperimentSettings(), videoMs, 1920, 1080, Images, Audios, seed);

    [Fact]
    public void Same_seed_produces_identical_schedule()
    {
        var a = ScheduleGenerator.Generate(Request(seed: 7));
        var b = ScheduleGenerator.Generate(Request(seed: 7));
        var c = ScheduleGenerator.Generate(Request(seed: 8));

        Assert.True(a.Ok);
        Assert.Equal(a.Stimuli, b.Stimuli);
        Assert.NotEqual(a.Stimuli.Select(x => x.OnsetMs), c.Stimuli.Select(x => x.OnsetMs));
    }

    [Theory]
    [InlineData(PairingMode.Independent, 1, 5)]
    [InlineData(PairingMode.Independent, 3, 15)]
    [InlineData(PairingMode.Paired, 2, 6)]
    [InlineData(PairingMode.Mixed, 1, 7)]
    public void Trial_count_matches_pairing_mode(PairingMode mode, int repetitions, int expected)
    {
        var settings = new ExperimentSettings { Pairing = mode, Repetitions = repetitions };
        var result = ScheduleGenerator.Generate(Request(settings, videoMs: 600_000));

        Assert.True(result.Ok, result.Error);
        Assert.Equal(expected, result.Stimuli.Count);
        Assert.Equal(expected, ScheduleGenerator.CountTrials(settings, Images.Length, Audios.Length));
    }

    [Fact]
    public void Every_stimulus_appears_once_per_repetition_block()
    {
        var settings = new ExperimentSettings { Repetitions = 4 };
        var result = ScheduleGenerator.Generate(Request(settings, videoMs: 900_000));

        Assert.True(result.Ok, result.Error);
        foreach (var block in result.Stimuli.Chunk(Images.Length + Audios.Length))
        {
            Assert.Equal(Images.Length, block.Count(s => s.Kind == StimulusKind.Visual));
            Assert.Equal(Audios.Length, block.Count(s => s.Kind == StimulusKind.Auditory));
            Assert.Equal(Images.Length, block.Where(s => s.ImageId is not null).Select(s => s.ImageId).Distinct().Count());
        }
    }

    [Fact]
    public void Response_windows_never_overlap_and_respect_bounds()
    {
        var settings = new ExperimentSettings
        {
            Repetitions = 6,
            DurationMinMs = 500,
            DurationMaxMs = 3000,
            ResponseWindowMs = 1800,
            MinGapMs = 700,
            LeadInMs = 4000,
            TailMs = 2500,
        };

        for (uint seed = 1; seed <= 50; seed++)
        {
            var result = ScheduleGenerator.Generate(Request(settings, videoMs: 240_000, seed: seed));
            Assert.True(result.Ok, result.Error);

            var list = result.Stimuli.OrderBy(s => s.OnsetMs).ToList();
            Assert.True(list[0].OnsetMs >= settings.LeadInMs);
            for (int i = 0; i < list.Count; i++)
            {
                var span = Math.Max(list[i].DurationMs, settings.ResponseWindowMs);
                Assert.InRange(list[i].DurationMs, settings.DurationMinMs, settings.DurationMaxMs);
                Assert.True(list[i].OnsetMs + span <= 240_000 - settings.TailMs);
                if (i + 1 < list.Count)
                    Assert.True(list[i + 1].OnsetMs >= list[i].OnsetMs + span + settings.MinGapMs);
            }
        }
    }

    [Fact]
    public void Fails_with_capacity_info_when_video_is_too_short()
    {
        var settings = new ExperimentSettings { Repetitions = 10 };
        var result = ScheduleGenerator.Generate(Request(settings, videoMs: 30_000));

        Assert.False(result.Ok);
        Assert.Contains("kısa", result.Error);
        Assert.Empty(result.Stimuli);
        Assert.True(result.Capacity.RequiredMs > result.Capacity.UsableMs);
        Assert.True(result.Capacity.MaxTrials < result.Capacity.TrialCount);
    }

    [Fact]
    public void Fails_when_pool_is_empty()
    {
        var request = new ScheduleRequest(new ExperimentSettings(), 60_000, 1920, 1080, [], [], 1);
        var result = ScheduleGenerator.Generate(request);
        Assert.False(result.Ok);
        Assert.Contains("boş", result.Error);
    }

    [Fact]
    public void Image_boxes_stay_inside_safe_margin_and_keep_aspect_ratio()
    {
        var settings = new ExperimentSettings { Repetitions = 20, SafeMargin = 0.05, ImageScale = 0.2 };
        var result = ScheduleGenerator.Generate(Request(settings, videoMs: 3_600_000));
        Assert.True(result.Ok, result.Error);

        foreach (var s in result.Stimuli.Where(s => s.Box is not null))
        {
            var b = s.Box!;
            Assert.True(b.X >= 0.05 - 1e-4 && b.X + b.W <= 0.95 + 1e-4);
            Assert.True(b.Y >= 0.05 - 1e-4 && b.Y + b.H <= 0.95 + 1e-4);

            var image = Images.Single(i => i.AssetId == s.ImageId);
            double renderedAspect = b.W * 1920 / (b.H * 1080);
            Assert.Equal((double)image.Width / image.Height, renderedAspect, 1);
        }
    }

    [Fact]
    public void Balanced_quadrants_distribute_visual_stimuli_evenly()
    {
        var settings = new ExperimentSettings { Repetitions = 8, Positioning = PositionMode.BalancedQuadrants };
        var result = ScheduleGenerator.Generate(Request(settings, videoMs: 3_600_000));
        Assert.True(result.Ok, result.Error);

        var counts = result.Stimuli.Where(s => s.Quadrant is not null).GroupBy(s => s.Quadrant!.Value).ToDictionary(g => g.Key, g => g.Count());
        Assert.Equal(4, counts.Count);
        Assert.True(counts.Values.Max() - counts.Values.Min() <= 1);

        foreach (var s in result.Stimuli.Where(s => s.Box is not null))
        {
            double cx = s.Box!.X + s.Box.W / 2, cy = s.Box.Y + s.Box.H / 2;
            Assert.Equal(s.Quadrant!.Value % 2 == 1, cx >= 0.5);
            Assert.Equal(s.Quadrant!.Value / 2 == 1, cy >= 0.5);
        }
    }

    [Fact]
    public void Audio_only_stimuli_have_no_box()
    {
        var result = ScheduleGenerator.Generate(Request());
        Assert.All(result.Stimuli.Where(s => s.Kind == StimulusKind.Auditory), s =>
        {
            Assert.Null(s.Box);
            Assert.Null(s.ImageId);
            Assert.NotNull(s.AudioId);
        });
    }

    [Fact]
    public void Validator_reports_inverted_duration_range()
    {
        var issues = SettingsValidator.Validate(new ExperimentSettings { DurationMinMs = 2000, DurationMaxMs = 1000 });
        Assert.Contains(issues, i => i.Field == nameof(ExperimentSettings.DurationMaxMs));
        Assert.Empty(SettingsValidator.Validate(new ExperimentSettings()));
    }

    [Fact]
    public void Prng_is_stable_across_runs()
    {
        var rng = new Prng(123);
        var values = Enumerable.Range(0, 5).Select(_ => rng.NextUInt()).ToArray();
        var again = new Prng(123);
        Assert.Equal(values, Enumerable.Range(0, 5).Select(_ => again.NextUInt()).ToArray());
        Assert.All(Enumerable.Range(0, 1000).Select(_ => rng.NextDouble()), d => Assert.InRange(d, 0, 0.9999999999));
    }
}
