using Vigila.Api.Domain;
using Vigila.Api.Features;
using Vigila.Core;

namespace Vigila.Api.Services;

/// <summary>Deneyin seçtiği medya kayıtlarını zamanlayıcı girdisine çevirir ve deneyin çalışmaya hazır olup olmadığını söyler.</summary>
public static class Planner
{
    public sealed record Resolved(MediaAsset? Video, List<MediaAsset> Images, List<MediaAsset> Audios);

    public static Resolved Resolve(Guid? videoId, IEnumerable<Guid> imageIds, IEnumerable<Guid> audioIds, IReadOnlyDictionary<Guid, MediaAsset> assets)
    {
        MediaAsset? video = videoId is Guid v && assets.TryGetValue(v, out var a) && a.Kind == MediaKind.Video ? a : null;
        var images = imageIds.Distinct().Select(id => assets.GetValueOrDefault(id)).OfType<MediaAsset>().Where(m => m.Kind == MediaKind.Image).ToList();
        var audios = audioIds.Distinct().Select(id => assets.GetValueOrDefault(id)).OfType<MediaAsset>().Where(m => m.Kind == MediaKind.Audio).ToList();
        return new Resolved(video, images, audios);
    }

    public static Resolved Resolve(Experiment e, IReadOnlyDictionary<Guid, MediaAsset> assets) =>
        Resolve(e.VideoId, e.ImageIds, e.AudioIds, assets);

    public static ScheduleRequest Request(ExperimentSettings settings, Resolved r, uint seed) =>
        new(
            settings,
            r.Video?.DurationMs ?? 0,
            r.Video?.Width ?? 1920,
            r.Video?.Height ?? 1080,
            r.Images.Select(i => new ImageStimulus(i.Id, i.Width ?? 1, i.Height ?? 1)).ToList(),
            r.Audios.Select(a => new AudioStimulus(a.Id, a.DurationMs ?? 0)).ToList(),
            seed);

    public static Readiness Evaluate(Experiment e, IReadOnlyDictionary<Guid, MediaAsset> assets)
    {
        var issues = new List<string>();
        var r = Resolve(e, assets);

        if (r.Video is null) issues.Add("Ana video seçilmedi.");
        else if ((r.Video.DurationMs ?? 0) <= 0) issues.Add("Ana videonun süresi okunamadı; videoyu yeniden yükleyin.");
        if (r.Images.Count + r.Audios.Count == 0) issues.Add("Uyaran havuzunda görsel ya da ses yok.");
        if (SettingsValidator.Validate(e.Settings).Count > 0) issues.Add("Ayarlarda düzeltilmesi gereken alanlar var.");

        if (issues.Count == 0)
        {
            var result = ScheduleGenerator.Generate(Request(e.Settings, r, 1));
            if (!result.Ok) issues.Add(result.Error!);
        }

        return new Readiness(issues.Count == 0, issues);
    }

    public static int TrialCount(Experiment e, IReadOnlyDictionary<Guid, MediaAsset> assets)
    {
        var r = Resolve(e, assets);
        return ScheduleGenerator.CountTrials(e.Settings, r.Images.Count, r.Audios.Count);
    }
}
