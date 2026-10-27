using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Vigila.Api.Data;
using Vigila.Api.Domain;
using Vigila.Api.Infrastructure;
using Vigila.Api.Services;
using Vigila.Core;

namespace Vigila.Api.Features;

public static class ExperimentEndpoints
{
    private const int MaxPoolSize = 200;

    public static void MapExperiments(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/experiments").RequireAuthorization();

        g.MapGet("/", async (ClaimsPrincipal principal, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var ownerId = principal.UserId();
            var experiments = await db.Experiments.AsNoTracking().Where(e => e.OwnerId == ownerId).OrderByDescending(e => e.UpdatedAt).ToListAsync(ct);
            var assets = await LoadAssetsAsync(db, ownerId, ct);
            var sessions = await db.Sessions.AsNoTracking()
                .Where(s => s.OwnerId == ownerId)
                .Select(s => new { s.ExperimentId, s.Status, s.HitRate, s.MeanRt, s.CreatedAt })
                .ToListAsync(ct);
            var byExperiment = sessions.ToLookup(s => s.ExperimentId);

            return TypedResults.Ok(experiments.Select(e =>
            {
                var list = byExperiment[e.Id].ToList();
                var done = list.Where(s => s.Status == SessionStatus.Completed).ToList();
                var video = e.VideoId is Guid v ? assets.GetValueOrDefault(v) : null;
                var resolved = Planner.Resolve(e, assets);
                return new ExperimentListItem(
                    e.Id, e.Name, e.Description,
                    video?.PosterStoredName is null ? null : signer.Url(video.Id, "poster"),
                    video?.Name, video?.DurationMs,
                    resolved.Images.Count, resolved.Audios.Count,
                    ScheduleGenerator.CountTrials(e.Settings, resolved.Images.Count, resolved.Audios.Count),
                    list.Count, done.Count,
                    done.Count > 0 ? Math.Round(done.Average(s => s.HitRate ?? 0), 4) : null,
                    done.Average(s => s.MeanRt) is double rt ? Math.Round(rt, 1) : null,
                    list.Count > 0 ? list.Max(s => s.CreatedAt) : null,
                    e.RunLinkEnabled, e.IsArchived,
                    Planner.Evaluate(e, assets).Ready,
                    e.UpdatedAt);
            }).ToList());
        });

        g.MapPost("/", async (CreateExperimentRequest req, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var name = req.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 160) return Problems.Validation("name", "Deney adı 1-160 karakter olmalı.");

            var experiment = new Experiment
            {
                OwnerId = principal.UserId(),
                Name = name,
                Description = req.Description?.Trim() ?? "",
                InstructionText = DefaultInstruction,
            };
            db.Experiments.Add(experiment);
            await db.SaveChangesAsync(ct);
            var assets = await LoadAssetsAsync(db, experiment.OwnerId, ct);
            return Results.Created($"/api/experiments/{experiment.Id}", ToDto(experiment, assets, 0, 0));
        });

        g.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            var assets = await LoadAssetsAsync(db, e.OwnerId, ct);
            var (count, linkCompleted) = await CountsAsync(db, id, ct);
            return Results.Ok(ToDto(e, assets, count, linkCompleted));
        });

        g.MapPut("/{id:guid}", async (Guid id, ExperimentDraft draft, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            var assets = await LoadAssetsAsync(db, e.OwnerId, ct);

            var issues = ValidateDraft(draft, assets);
            if (issues.Count > 0) return Problems.Validation(issues);

            e.Name = draft.Name!.Trim();
            e.Description = draft.Description?.Trim() ?? "";
            e.InstructionText = draft.InstructionText?.Trim() ?? "";
            e.VideoId = draft.VideoId;
            e.InstructionVideoId = draft.InstructionVideoId;
            e.ImageIds = (draft.ImageIds ?? []).Distinct().ToList();
            e.AudioIds = (draft.AudioIds ?? []).Distinct().ToList();
            e.Settings = draft.Settings ?? new ExperimentSettings();
            e.ConsentText = draft.ConsentText?.Trim() ?? "";
            e.Questions = (draft.Questions ?? []).Select(q => q with { Label = q.Label.Trim(), Options = q.Type == QuestionType.Choice ? q.Options?.Select(o => o.Trim()).Where(o => o.Length > 0).ToList() : null }).ToList();
            e.MaxParticipants = draft.MaxParticipants;
            e.LinkExpiresAt = draft.LinkExpiresAt?.ToUniversalTime();
            e.PreventRepeat = draft.PreventRepeat;
            e.CompletionUrl = string.IsNullOrWhiteSpace(draft.CompletionUrl) ? null : draft.CompletionUrl.Trim();
            e.UpdatedAt = DateTime.UtcNow;

            var readiness = Planner.Evaluate(e, assets);
            if (!readiness.Ready && e.RunLinkEnabled) e.RunLinkEnabled = false;

            await db.SaveChangesAsync(ct);
            var (count, linkCompleted) = await CountsAsync(db, id, ct);
            return Results.Ok(ToDto(e, assets, count, linkCompleted));
        });

        g.MapPost("/{id:guid}/preview", async (Guid id, PreviewRequest req, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            var assets = await LoadAssetsAsync(db, e.OwnerId, ct);

            var settings = req.Draft.Settings ?? e.Settings;
            uint seed = req.Seed ?? (settings.SeedMode == SeedMode.Fixed ? (uint)settings.FixedSeed : NewSeed());
            var resolved = Planner.Resolve(req.Draft.VideoId, req.Draft.ImageIds ?? [], req.Draft.AudioIds ?? [], assets);

            var settingIssues = SettingsValidator.Validate(settings);
            if (settingIssues.Count > 0)
            {
                var trials = ScheduleGenerator.CountTrials(settings, resolved.Images.Count, resolved.Audios.Count);
                return Results.Ok(new PreviewResponse(seed, false, settingIssues[0].Message, new ScheduleCapacity(trials, 0, 0, 0), []));
            }
            if (resolved.Video is null)
            {
                var trials = ScheduleGenerator.CountTrials(settings, resolved.Images.Count, resolved.Audios.Count);
                return Results.Ok(new PreviewResponse(seed, false, "Önizleme için ana videoyu seçin.", new ScheduleCapacity(trials, 0, 0, 0), []));
            }

            var result = ScheduleGenerator.Generate(Planner.Request(settings, resolved, seed));
            return Results.Ok(new PreviewResponse(result.Seed, result.Ok, result.Error, result.Capacity, result.Stimuli));
        });

        g.MapPost("/{id:guid}/duplicate", async (Guid id, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            var copy = new Experiment
            {
                OwnerId = e.OwnerId,
                Name = Truncate($"{e.Name} (kopya)", 160),
                Description = e.Description,
                InstructionText = e.InstructionText,
                VideoId = e.VideoId,
                InstructionVideoId = e.InstructionVideoId,
                ImageIds = [.. e.ImageIds],
                AudioIds = [.. e.AudioIds],
                Settings = e.Settings,
                ConsentText = e.ConsentText,
                Questions = [.. e.Questions],
                MaxParticipants = e.MaxParticipants,
                PreventRepeat = e.PreventRepeat,
                CompletionUrl = e.CompletionUrl,
            };
            db.Experiments.Add(copy);
            await db.SaveChangesAsync(ct);
            var assets = await LoadAssetsAsync(db, e.OwnerId, ct);
            return Results.Created($"/api/experiments/{copy.Id}", ToDto(copy, assets, 0, 0));
        });

        g.MapPost("/{id:guid}/archive", async (Guid id, ArchiveRequest req, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            e.IsArchived = req.Archived;
            if (req.Archived) e.RunLinkEnabled = false;
            e.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            await db.Sessions.Where(s => s.ExperimentId == id).ExecuteDeleteAsync(ct);
            db.Experiments.Remove(e);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapPost("/{id:guid}/link", async (Guid id, RunLinkRequest req, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");

            if (req.Enabled)
            {
                if (e.IsArchived) return Problems.Conflict("Arşivlenmiş deney için bağlantı açılamaz.");
                var readiness = Planner.Evaluate(e, await LoadAssetsAsync(db, e.OwnerId, ct));
                if (!readiness.Ready) return Problems.Conflict("Deney henüz hazır değil.", string.Join(" ", readiness.Issues));
                if (e.RunToken is null || req.Regenerate) e.RunToken = Tokens.NewUrlToken(12);
            }
            e.RunLinkEnabled = req.Enabled;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new RunLinkResponse(e.RunLinkEnabled, e.RunLinkEnabled ? e.RunToken : null));
        });

        g.MapGet("/{id:guid}/analytics", async (Guid id, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");

            var all = await db.Sessions.AsNoTracking().Where(s => s.ExperimentId == id).ToListAsync(ct);
            var done = all.Where(s => s.Status == SessionStatus.Completed && s.Trials is not null).ToList();
            var trials = done.SelectMany(s => s.Trials!).Where(t => t.Outcome != TrialOutcome.NotPresented).ToList();
            var hitRts = trials.Where(t => t.Outcome == TrialOutcome.Hit).Select(t => t.RtMs!.Value).ToList();

            var byKind = trials.GroupBy(t => t.Kind).OrderBy(x => x.Key).Select(k =>
            {
                var rts = k.Where(t => t.Outcome == TrialOutcome.Hit).Select(t => t.RtMs!.Value).ToList();
                return new KindAggregate(k.Key, k.Count(), rts.Count, Math.Round((double)rts.Count / k.Count(), 4), Stats.Mean(rts), Stats.Median(rts));
            }).ToList();

            var byQuadrant = trials.Where(t => t.Quadrant is not null).GroupBy(t => t.Quadrant!.Value).OrderBy(x => x.Key).Select(q =>
            {
                var rts = q.Where(t => t.Outcome == TrialOutcome.Hit).Select(t => t.RtMs!.Value).ToList();
                return new QuadrantAggregate(q.Key, q.Count(), rts.Count, Math.Round((double)rts.Count / q.Count(), 4), Stats.Mean(rts));
            }).ToList();

            var points = done.OrderBy(s => s.CompletedAt)
                .Select(s => new SessionPoint(s.Id, s.ParticipantCode, s.CompletedAt ?? s.CreatedAt, s.HitRate ?? 0, s.MeanRt))
                .ToList();

            // Kanallar arası karşılaştırma katılımcı düzeyindedir: her oturumun kanal ortalamaları eşleştirilir.
            var kindMeans = done.Where(s => s.Summary is not null)
                .Select(s => s.Summary!.ByKind.Where(k => k.MeanRt is not null).ToDictionary(k => k.Kind, k => k.MeanRt!.Value))
                .ToList();
            StimulusKind[][] pairs = [[StimulusKind.Visual, StimulusKind.Auditory], [StimulusKind.Visual, StimulusKind.Audiovisual], [StimulusKind.Auditory, StimulusKind.Audiovisual]];
            var comparisons = pairs
                .Select(p => (A: p[0], B: p[1], Test: HypothesisTests.Paired(kindMeans.Where(m => m.ContainsKey(p[0]) && m.ContainsKey(p[1])).Select(m => (m[p[0]], m[p[1]])).ToList())))
                .Where(c => c.Test is not null)
                .Select(c => new ModalityComparison(c.A, c.B, c.Test!))
                .ToList();

            var byBlock = done.Where(s => s.Summary?.ByBlock is not null)
                .SelectMany(s => s.Summary!.ByBlock!)
                .GroupBy(b => b.Block)
                .OrderBy(g => g.Key)
                .Select(g => new BlockAggregate(
                    g.Key,
                    g.Count(),
                    Math.Round(g.Average(b => b.HitRate), 4),
                    Stats.Mean(g.Where(b => b.MeanRt is not null).Select(b => b.MeanRt!.Value).ToList())))
                .ToList();

            var dprimes = done.Where(s => s.Summary?.DPrime is not null).Select(s => s.Summary!.DPrime!.Value).ToList();

            return Results.Ok(new ExperimentAnalytics(
                all.Count,
                done.Count,
                done.Select(s => s.ParticipantCode).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
                done.Count > 0 ? Math.Round(done.Average(s => s.HitRate ?? 0), 4) : null,
                Stats.Mean(done.Where(s => s.MeanRt is not null).Select(s => s.MeanRt!.Value).ToList()),
                Stats.Median(hitRts),
                trials.Where(t => t.Outcome == TrialOutcome.Hit)
                    .GroupBy(t => t.Kind)
                    .OrderBy(g => g.Key)
                    .Select(g => new KindValues(g.Key, g.Select(t => t.RtMs!.Value).Take(5000).ToList()))
                    .ToList(),
                byKind,
                byQuadrant,
                points,
                dprimes.Count > 0 ? Math.Round(dprimes.Average(), 3) : null,
                comparisons,
                byBlock));
        });
    }

    public const string DefaultInstruction =
        "Birazdan bir video izleyeceksiniz. Video sırasında ekranda zaman zaman görseller belirecek ya da sesler duyulacak.\n\n" +
        "Bir görsel gördüğünüzde ya da bir ses duyduğunuzda olabildiğince hızlı biçimde yanıt tuşuna basın. " +
        "Uyaran yokken tuşa basmamaya çalışın.";

    public static async Task<Experiment?> FindAsync(VigilaDb db, Guid id, ClaimsPrincipal principal, CancellationToken ct) =>
        await db.Experiments.FirstOrDefaultAsync(e => e.Id == id && e.OwnerId == principal.UserId(), ct);

    public static async Task<Dictionary<Guid, MediaAsset>> LoadAssetsAsync(VigilaDb db, Guid ownerId, CancellationToken ct) =>
        await db.Media.AsNoTracking().Where(m => m.OwnerId == ownerId).ToDictionaryAsync(m => m.Id, ct);

    public static uint NewSeed() => BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4)) & 0x7FFFFFFF;

    public static ExperimentDto ToDto(Experiment e, IReadOnlyDictionary<Guid, MediaAsset> assets, int sessionCount, int linkCompleted) => new(
        e.Id, e.Name, e.Description, e.InstructionText, e.VideoId, e.InstructionVideoId, e.ImageIds, e.AudioIds, e.Settings,
        e.RunLinkEnabled ? e.RunToken : null, e.RunLinkEnabled, e.IsArchived, e.CreatedAt, e.UpdatedAt,
        Planner.Evaluate(e, assets), Planner.TrialCount(e, assets), sessionCount,
        e.ConsentText, e.Questions, e.MaxParticipants, e.LinkExpiresAt, e.PreventRepeat, e.CompletionUrl, linkCompleted);

    public static async Task<(int Sessions, int LinkCompleted)> CountsAsync(VigilaDb db, Guid experimentId, CancellationToken ct)
    {
        var sessions = await db.Sessions.CountAsync(s => s.ExperimentId == experimentId, ct);
        var linkCompleted = await db.Sessions.CountAsync(s => s.ExperimentId == experimentId && s.Origin == SessionOrigin.Link && s.Status == SessionStatus.Completed, ct);
        return (sessions, linkCompleted);
    }

    private static List<(string Field, string Message)> ValidateDraft(ExperimentDraft d, IReadOnlyDictionary<Guid, MediaAsset> assets)
    {
        var issues = new List<(string, string)>();
        var name = d.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 160) issues.Add(("name", "Deney adı 1-160 karakter olmalı."));
        if ((d.Description?.Length ?? 0) > 2000) issues.Add(("description", "Açıklama en fazla 2000 karakter olabilir."));
        if ((d.InstructionText?.Length ?? 0) > 5000) issues.Add(("instructionText", "Yönerge en fazla 5000 karakter olabilir."));

        bool IsKind(Guid id, MediaKind kind) => assets.TryGetValue(id, out var a) && a.Kind == kind;
        if (d.VideoId is Guid v && !IsKind(v, MediaKind.Video)) issues.Add(("videoId", "Seçilen ana video bulunamadı."));
        if (d.InstructionVideoId is Guid iv && !IsKind(iv, MediaKind.Video)) issues.Add(("instructionVideoId", "Seçilen yönerge videosu bulunamadı."));
        if ((d.ImageIds ?? []).Any(id => !IsKind(id, MediaKind.Image))) issues.Add(("imageIds", "Görsel listesinde bulunamayan dosyalar var."));
        if ((d.AudioIds ?? []).Any(id => !IsKind(id, MediaKind.Audio))) issues.Add(("audioIds", "Ses listesinde bulunamayan dosyalar var."));
        if ((d.ImageIds?.Count ?? 0) > MaxPoolSize || (d.AudioIds?.Count ?? 0) > MaxPoolSize)
            issues.Add(("imageIds", $"Her havuzda en fazla {MaxPoolSize} dosya olabilir."));

        foreach (var issue in SettingsValidator.Validate(d.Settings ?? new ExperimentSettings()))
            issues.Add(($"settings.{char.ToLowerInvariant(issue.Field[0])}{issue.Field[1..]}", issue.Message));

        if ((d.ConsentText?.Length ?? 0) > 10_000) issues.Add(("consentText", "Onam metni en fazla 10.000 karakter olabilir."));
        issues.AddRange(ValidateQuestions(d.Questions ?? []));
        if (d.MaxParticipants is < 1 or > 100_000) issues.Add(("maxParticipants", "Katılımcı sınırı 1 ile 100.000 arasında olmalı."));
        if (!string.IsNullOrWhiteSpace(d.CompletionUrl) &&
            (d.CompletionUrl.Length > 1000 || !Uri.TryCreate(d.CompletionUrl.Trim().Replace("{kod}", "x"), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")))
            issues.Add(("completionUrl", "Yönlendirme adresi http:// ya da https:// ile başlayan geçerli bir adres olmalı."));

        return issues;
    }

    private static IEnumerable<(string, string)> ValidateQuestions(List<Question> questions)
    {
        if (questions.Count > 30) yield return ("questions", "En fazla 30 soru eklenebilir.");
        var ids = new HashSet<string>();
        foreach (var q in questions)
        {
            if (string.IsNullOrWhiteSpace(q.Id) || q.Id.Length > 40 || !q.Id.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-') || !ids.Add(q.Id))
                yield return ("questions", "Soru kimlikleri benzersiz olmalı ve yalnız harf, rakam, alt çizgi içermeli.");
            if (string.IsNullOrWhiteSpace(q.Label) || q.Label.Length > 300)
                yield return ("questions", "Her sorunun 1-300 karakterlik bir metni olmalı.");
            if (q.Type == QuestionType.Choice && (q.Options is null || q.Options.Count(o => !string.IsNullOrWhiteSpace(o)) < 2 || q.Options.Count > 20 || q.Options.Any(o => o.Length > 120)))
                yield return ("questions", $"“{q.Label}” sorusu için 2-20 seçenek girin.");
            if (q.Type == QuestionType.Scale && (q.Min is null || q.Max is null || q.Min >= q.Max || q.Max - q.Min > 20))
                yield return ("questions", $"“{q.Label}” ölçeğinin alt ve üst değerleri geçerli olmalı (en fazla 20 adım).");
        }
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
