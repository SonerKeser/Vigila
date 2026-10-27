namespace Vigila.Core;

public sealed record ImageStimulus(Guid AssetId, int Width, int Height);

public sealed record AudioStimulus(Guid AssetId, int DurationMs);

public sealed record ScheduleRequest(
    ExperimentSettings Settings,
    int VideoDurationMs,
    int VideoWidth,
    int VideoHeight,
    IReadOnlyList<ImageStimulus> Images,
    IReadOnlyList<AudioStimulus> Audios,
    uint Seed);

/// <summary>Görselin video karesine göre normalize konumu ve boyutu (sol üst köşe, 0-1).</summary>
public sealed record StimulusBox(double X, double Y, double W, double H);

/// <summary>
/// Planlanmış tek bir uyaran. Zamanlar video zamanına göredir.
/// Çeyrek numarası: 0 sol üst, 1 sağ üst, 2 sol alt, 3 sağ alt.
/// </summary>
public sealed record ScheduledStimulus(
    int Index,
    StimulusKind Kind,
    Guid? ImageId,
    Guid? AudioId,
    int OnsetMs,
    int DurationMs,
    StimulusBox? Box,
    int? Quadrant);

public sealed record ScheduleCapacity(int TrialCount, int UsableMs, int RequiredMs, int MaxTrials)
{
    /// <summary>Gereken sürenin kullanılabilir süreye oranı; 1'in üstü planın sığmadığını gösterir.</summary>
    public double Utilization => UsableMs <= 0 ? 1 : Math.Round((double)RequiredMs / UsableMs, 4);
}

public sealed record ScheduleResult(uint Seed, IReadOnlyList<ScheduledStimulus> Stimuli, ScheduleCapacity Capacity, string? Error)
{
    public bool Ok => Error is null;
}

/// <summary>
/// Uyaranları video zaman çizelgesine yerleştirir.
/// Her tekrar bir blok oluşturur (havuzdaki her uyaran blokta bir kez yer alır), blok kendi içinde karıştırılır.
/// Başlangıç zamanları, artan süre (slack) Dirichlet dağılımıyla boşluklara paylaştırılarak bulunur; bu sayede
/// uyaranlar hiçbir zaman çakışmaz, yanıt pencereleri birbirine girmez ve geçerli yerleşimlerin hepsi eşit olasılıklıdır.
/// </summary>
public static class ScheduleGenerator
{
    private const int DurationStepMs = 10;

    private readonly record struct Trial(StimulusKind Kind, int? Image, int? Audio);

    public static int CountTrials(ExperimentSettings s, int imageCount, int audioCount)
    {
        int perBlock = s.Pairing switch
        {
            PairingMode.Independent => imageCount + audioCount,
            PairingMode.Paired => Math.Max(imageCount, audioCount),
            PairingMode.Mixed => imageCount + audioCount + Math.Min(imageCount, audioCount),
            _ => 0,
        };
        return perBlock * Math.Max(1, s.Repetitions);
    }

    public static ScheduleResult Generate(ScheduleRequest req)
    {
        var s = req.Settings;
        var rng = new Prng(req.Seed);
        int usable = req.VideoDurationMs - s.LeadInMs - s.TailMs;
        int worstSpan = Math.Max(s.DurationMaxMs, s.ResponseWindowMs);
        int maxTrials = usable <= 0 ? 0 : (usable + s.MinGapMs) / Math.Max(1, worstSpan + s.MinGapMs);

        var trials = BuildTrials(req, rng);
        int n = trials.Count;

        ScheduleResult Fail(string error, int required = 0) =>
            new(req.Seed, [], new ScheduleCapacity(n, Math.Max(0, usable), required, maxTrials), error);

        if (req.VideoDurationMs <= 0)
            return Fail("Videonun süresi bilinmiyor. Videoyu kütüphaneye yeniden yükleyin.");
        if (n == 0)
            return Fail("Uyaran havuzu boş. En az bir görsel ya da ses ekleyin.");
        if (usable <= 0)
            return Fail("Başlangıç ve bitiş boşlukları toplamı videodan uzun. Boşlukları kısaltın.");

        // Sığma kontrolü en kötü duruma göre yapılır: süreler rastgele çekildiğinden, bir tohumda sığıp
        // başka bir tohumda sığmayan plan olmasın. Böylece "hazır" görünen deney her oturumda çalışır.
        long worstRequired = (long)n * worstSpan + (long)(n - 1) * s.MinGapMs;
        if (worstRequired > usable)
        {
            return Fail(
                $"Video bu plan için kısa: {n} uyaran en az {FormatDuration(worstRequired)} gerektiriyor, " +
                $"kullanılabilir süre {FormatDuration(usable)}. Bu ayarlarla en fazla {maxTrials} uyaran sığar.",
                (int)Math.Min(int.MaxValue, worstRequired));
        }

        int steps = Math.Max(0, (s.DurationMaxMs - s.DurationMinMs) / DurationStepMs);
        var durations = new int[n];
        var spans = new int[n];
        long required = (long)(n - 1) * s.MinGapMs;
        for (int i = 0; i < n; i++)
        {
            durations[i] = steps == 0 ? s.DurationMinMs : s.DurationMinMs + DurationStepMs * rng.NextInt(0, steps + 1);
            spans[i] = Math.Max(durations[i], s.ResponseWindowMs);
            required += spans[i];
        }

        // Artan süreyi n+1 boşluğa Dirichlet(1,...,1) ağırlıklarıyla dağıt.
        double slack = usable - required;
        var weights = new double[n + 1];
        double weightSum = 0;
        for (int i = 0; i <= n; i++)
        {
            weights[i] = -Math.Log(1.0 - rng.NextDouble());
            weightSum += weights[i];
        }

        var placements = PlaceImages(req, trials, rng);

        var result = new List<ScheduledStimulus>(n);
        double cursor = s.LeadInMs;
        for (int i = 0; i < n; i++)
        {
            cursor += weightSum > 0 ? slack * weights[i] / weightSum : 0;
            int onset = (int)Math.Floor(cursor);
            var t = trials[i];
            var (box, quadrant) = placements[i];
            result.Add(new ScheduledStimulus(
                i,
                t.Kind,
                t.Image is int img ? req.Images[img].AssetId : null,
                t.Audio is int aud ? req.Audios[aud].AssetId : null,
                onset,
                durations[i],
                box,
                quadrant));
            cursor += spans[i] + s.MinGapMs;
        }

        return new ScheduleResult(req.Seed, result, new ScheduleCapacity(n, usable, (int)worstRequired, maxTrials), null);
    }

    /// <summary>
    /// Alıştırma planı: aynı havuz ve kurallarla, videosuz kısa bir sahne için üretilir. Asıl plandan farklı bir
    /// tohum türetilir; böylece katılımcı alıştırmada asıl deneyin sırasını görmez.
    /// </summary>
    public static (IReadOnlyList<ScheduledStimulus> Stimuli, int DurationMs) GeneratePractice(ScheduleRequest req)
    {
        var s = req.Settings;
        int n = s.PracticeTrials;
        int perBlock = CountTrials(s with { Repetitions = 1 }, req.Images.Count, req.Audios.Count);
        if (n <= 0 || perBlock == 0) return ([], 0);

        const int leadIn = 1500;
        int reps = (n + perBlock - 1) / perBlock;
        int total = reps * perBlock;
        int worstSpan = Math.Max(s.DurationMaxMs, s.ResponseWindowMs);
        int gap = Math.Max(s.MinGapMs, 800);
        int duration = leadIn + total * (worstSpan + gap + 400);
        var practice = Generate(req with
        {
            Settings = s with { Repetitions = reps, LeadInMs = leadIn, TailMs = 0, MinGapMs = gap },
            VideoDurationMs = duration,
            Seed = req.Seed ^ 0x5EED5EED,
        });
        if (!practice.Ok) return ([], 0);

        var stimuli = practice.Stimuli.OrderBy(x => x.OnsetMs).Take(n).Select((x, i) => x with { Index = i }).ToList();
        return (stimuli, stimuli[^1].OnsetMs + worstSpan + 800);
    }

    private static List<Trial> BuildTrials(ScheduleRequest req, Prng rng)
    {
        var s = req.Settings;
        int ic = req.Images.Count, ac = req.Audios.Count;
        var trials = new List<Trial>();

        for (int rep = 0; rep < Math.Max(1, s.Repetitions); rep++)
        {
            var imgs = Enumerable.Range(0, ic).ToList();
            var auds = Enumerable.Range(0, ac).ToList();
            rng.Shuffle(imgs);
            rng.Shuffle(auds);
            var block = new List<Trial>();

            switch (s.Pairing)
            {
                case PairingMode.Independent:
                    block.AddRange(imgs.Select(i => new Trial(StimulusKind.Visual, i, null)));
                    block.AddRange(auds.Select(a => new Trial(StimulusKind.Auditory, null, a)));
                    break;

                case PairingMode.Paired:
                    if (ic == 0)
                        block.AddRange(auds.Select(a => new Trial(StimulusKind.Auditory, null, a)));
                    else if (ac == 0)
                        block.AddRange(imgs.Select(i => new Trial(StimulusKind.Visual, i, null)));
                    else
                        for (int k = 0; k < Math.Max(ic, ac); k++)
                            block.Add(new Trial(StimulusKind.Audiovisual, imgs[k % ic], auds[k % ac]));
                    break;

                case PairingMode.Mixed:
                    block.AddRange(imgs.Select(i => new Trial(StimulusKind.Visual, i, null)));
                    block.AddRange(auds.Select(a => new Trial(StimulusKind.Auditory, null, a)));
                    var pairImgs = imgs.ToList();
                    var pairAuds = auds.ToList();
                    rng.Shuffle(pairImgs);
                    rng.Shuffle(pairAuds);
                    for (int k = 0; k < Math.Min(ic, ac); k++)
                        block.Add(new Trial(StimulusKind.Audiovisual, pairImgs[k], pairAuds[k]));
                    break;
            }

            rng.Shuffle(block);
            trials.AddRange(block);
        }

        return trials;
    }

    private static (StimulusBox? Box, int? Quadrant)[] PlaceImages(ScheduleRequest req, List<Trial> trials, Prng rng)
    {
        var s = req.Settings;
        var output = new (StimulusBox?, int?)[trials.Count];
        double videoAspect = req.VideoWidth > 0 && req.VideoHeight > 0 ? (double)req.VideoWidth / req.VideoHeight : 16.0 / 9.0;
        double m = s.SafeMargin;
        double avail = 1 - 2 * m;

        int visualCount = trials.Count(t => t.Image is not null);
        var quadrants = new List<int>(visualCount);
        if (s.Positioning == PositionMode.BalancedQuadrants)
        {
            while (quadrants.Count < visualCount)
            {
                var block = new List<int> { 0, 1, 2, 3 };
                rng.Shuffle(block);
                quadrants.AddRange(block);
            }
        }

        int visualIndex = 0;
        for (int i = 0; i < trials.Count; i++)
        {
            if (trials[i].Image is not int img) continue;

            var image = req.Images[img];
            double imageAspect = image.Width > 0 && image.Height > 0 ? (double)image.Width / image.Height : 1;
            double w = s.ImageScale;
            double h = w / imageAspect * videoAspect;
            if (h > avail) { w *= avail / h; h = avail; }
            if (w > avail) { h *= avail / w; w = avail; }

            double x, y;
            int? quadrant;
            switch (s.Positioning)
            {
                case PositionMode.Center:
                    x = (1 - w) / 2;
                    y = (1 - h) / 2;
                    quadrant = null;
                    break;

                case PositionMode.BalancedQuadrants:
                    int q = quadrants[visualIndex];
                    x = PlaceInHalf(q % 2, w, m, rng);
                    y = PlaceInHalf(q / 2, h, m, rng);
                    quadrant = q;
                    break;

                default:
                    x = m + rng.NextDouble() * Math.Max(0, avail - w);
                    y = m + rng.NextDouble() * Math.Max(0, avail - h);
                    quadrant = (x + w / 2 >= 0.5 ? 1 : 0) + (y + h / 2 >= 0.5 ? 2 : 0);
                    break;
            }

            output[i] = (new StimulusBox(Round(x), Round(y), Round(w), Round(h)), quadrant);
            visualIndex++;
        }

        return output;
    }

    /// <summary>Kutuyu verilen yarıya (0: sol/üst, 1: sağ/alt) sığdırır; sığmıyorsa o kenara yaslar.</summary>
    private static double PlaceInHalf(int half, double size, double margin, Prng rng)
    {
        double min = half == 0 ? margin : 0.5;
        double max = half == 0 ? 0.5 : 1 - margin;
        double room = max - min - size;
        if (room >= 0) return min + rng.NextDouble() * room;
        return half == 0 ? margin : 1 - margin - size;
    }

    private static double Round(double v) => Math.Round(v, 4);

    public static string FormatDuration(long ms)
    {
        var ts = TimeSpan.FromMilliseconds(ms);
        return ts.TotalHours >= 1 ? $"{(int)ts.TotalHours} sa {ts.Minutes} dk" :
            ts.TotalMinutes >= 1 ? $"{(int)ts.TotalMinutes} dk {ts.Seconds} sn" :
            $"{ts.TotalSeconds:0.#} sn";
    }
}
