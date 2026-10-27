using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Vigila.Api.Data;
using Vigila.Api.Domain;
using Vigila.Api.Infrastructure;
using Vigila.Api.Services;
using Vigila.Core;

namespace Vigila.Api.Features;

public static class SessionEndpoints
{
    public const string SessionKeyHeader = "X-Session-Key";
    private const int MaxResponses = 20_000;

    public static void MapSessions(this IEndpointRouteBuilder api)
    {
        // Katılımcı bağlantısı (oturum açmadan)
        var run = api.MapGroup("/run").RequireRateLimiting("public");

        run.MapGet("/{token}", async (string token, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var e = await FindByTokenAsync(db, token, ct);
            if (e is null) return Problems.NotFound("Deney bağlantısı");
            if (await LinkClosedAsync(db, e, ct) is { } closed) return closed;
            var assets = await ExperimentEndpoints.LoadAssetsAsync(db, e.OwnerId, ct);
            if (!Planner.Evaluate(e, assets).Ready)
                return Problems.Conflict("Bu deney şu anda katılıma kapalı.", "Araştırmacı deneyi düzenliyor olabilir.");
            return Results.Ok(ToRunInfo(e, assets, signer));
        });

        run.MapPost("/{token}/sessions", async (string token, StartSessionRequest req, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var e = await FindByTokenAsync(db, token, ct);
            if (e is null) return Problems.NotFound("Deney bağlantısı");
            if (await LinkClosedAsync(db, e, ct) is { } closed) return closed;
            return await CreateSessionAsync(db, signer, e, SessionOrigin.Link, req, ct);
        });

        // Araştırmacının laboratuvarda başlattığı oturum
        var lab = api.MapGroup("/experiments/{id:guid}").RequireAuthorization();

        lab.MapGet("/run-info", async (Guid id, ClaimsPrincipal principal, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var e = await ExperimentEndpoints.FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            var assets = await ExperimentEndpoints.LoadAssetsAsync(db, e.OwnerId, ct);
            var readiness = Planner.Evaluate(e, assets);
            if (!readiness.Ready) return Problems.Conflict("Deney henüz hazır değil.", string.Join(" ", readiness.Issues));
            return Results.Ok(ToRunInfo(e, assets, signer));
        });

        lab.MapPost("/sessions", async (Guid id, StartSessionRequest req, ClaimsPrincipal principal, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var e = await ExperimentEndpoints.FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            if (e.IsArchived) return Problems.Conflict("Arşivlenmiş deneyle oturum açılamaz.");
            return await CreateSessionAsync(db, signer, e, SessionOrigin.Lab, req, ct);
        });

        lab.MapGet("/sessions", async (Guid id, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await ExperimentEndpoints.FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            var list = await db.Sessions.AsNoTracking().Where(s => s.ExperimentId == id).OrderByDescending(s => s.CreatedAt).ToListAsync(ct);
            return Results.Ok(list.Select(s => ToListItem(s, e.Name)).ToList());
        });

        lab.MapGet("/export", async (Guid id, string? kind, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var e = await ExperimentEndpoints.FindAsync(db, id, principal, ct);
            if (e is null) return Problems.NotFound("Deney");
            var sessions = await db.Sessions.AsNoTracking().Where(s => s.ExperimentId == id).OrderBy(s => s.CreatedAt).ToListAsync(ct);
            var assets = await ExperimentEndpoints.LoadAssetsAsync(db, e.OwnerId, ct);
            var stem = $"{Slug(e.Name)}-{DateTime.UtcNow:yyyyMMdd-HHmm}";
            return kind == "sessions"
                ? Csv(CsvExport.Sessions(sessions, e.Name, e.Questions), $"{stem}-oturumlar.csv")
                : Csv(CsvExport.Trials(sessions, e.Name, assets), $"{stem}-denemeler.csv");
        });

        // Oturum anahtarıyla yürütme adımları (laboratuvar ve bağlantı için ortak)
        api.MapPost("/sessions/{id:guid}/start", async (Guid id, HttpContext http, VigilaDb db, CancellationToken ct) =>
        {
            var s = await FindWithKeyAsync(db, id, http, ct);
            if (s is null) return Problems.NotFound("Oturum");
            if (s.Status is SessionStatus.Completed or SessionStatus.Aborted) return Problems.Conflict("Bu oturum zaten kapanmış.");
            s.Status = SessionStatus.Running;
            s.StartedAt ??= DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireRateLimiting("public");

        api.MapPost("/sessions/{id:guid}/complete", async (Guid id, CompleteSessionRequest req, HttpContext http, VigilaDb db, CancellationToken ct) =>
        {
            var s = await FindWithKeyAsync(db, id, http, ct);
            if (s is null) return Problems.NotFound("Oturum");

            // Aynı sonuç ağ hatası yüzünden yeniden gönderilebilir; ikinci gönderim ilk sonucu döndürür.
            if (s.Status is SessionStatus.Completed or SessionStatus.Aborted)
                return Results.Ok(new CompleteSessionResponse(s.Id, s.Status, s.Origin == SessionOrigin.Lab ? s.Summary : null, await RedirectAsync(db, s, ct)));

            var presentations = (req.Presentations ?? []).Where(p => p.Index >= 0 && p.Index < s.Schedule.Count).ToList();
            var responses = req.Responses ?? [];
            if (responses.Count > MaxResponses) return Problems.BadRequest("Yanıt sayısı sınırı aşıldı.");
            var interruptions = (req.Interruptions ?? []).Take(500).ToList();

            var scored = SessionScorer.Score(new ScoringInput(
                s.Settings, s.Schedule, presentations, responses,
                Math.Clamp(req.ObservedDurationMs, 0, s.Video.DurationMs + 600_000), interruptions.Count,
                s.Schedule.Count / Math.Max(1, s.Settings.Repetitions)));
            if (req.Practice is { } practice)
                s.Practice = new PracticeResult(Math.Clamp(practice.Trials, 0, 100), Math.Clamp(practice.Hits, 0, 100), practice.MeanRt is double rt ? Math.Round(Math.Clamp(rt, 0, 60_000), 1) : null);

            s.Presentations = presentations;
            s.Responses = responses;
            s.Interruptions = interruptions;
            s.Client = req.Client ?? s.Client;
            s.Trials = scored.Trials.ToList();
            s.FalseAlarms = scored.FalseAlarms.ToList();
            s.Summary = scored.Summary;
            s.HitRate = scored.Summary.HitRate;
            s.MeanRt = scored.Summary.MeanRt;
            s.FalseAlarmCount = scored.Summary.FalseAlarms;
            s.Status = req.Aborted ? SessionStatus.Aborted : SessionStatus.Completed;
            s.StartedAt ??= DateTime.UtcNow;
            s.CompletedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(new CompleteSessionResponse(s.Id, s.Status, s.Origin == SessionOrigin.Lab ? s.Summary : null, await RedirectAsync(db, s, ct)));
        }).RequireRateLimiting("public");

        // Yürütücü deney sürerken düzenli aralıklarla konumunu bildirir; araştırmacı canlı izler.
        api.MapPost("/sessions/{id:guid}/heartbeat", async (Guid id, HeartbeatRequest req, HttpContext http, VigilaDb db, CancellationToken ct) =>
        {
            var s = await FindWithKeyAsync(db, id, http, ct);
            if (s is null) return Problems.NotFound("Oturum");
            if (s.Status is SessionStatus.Completed or SessionStatus.Aborted) return Results.NoContent();
            s.LastSeenAt = DateTime.UtcNow;
            s.ProgressMs = Math.Clamp(req.ProgressMs, 0, s.Video.DurationMs);
            if (s.Status == SessionStatus.Created) s.Status = SessionStatus.Running;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).RequireRateLimiting("public");

        api.MapGet("/live", async (ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var ownerId = principal.UserId();
            var since = DateTime.UtcNow.AddSeconds(-45);
            var running = await db.Sessions.AsNoTracking()
                .Where(s => s.OwnerId == ownerId && s.Status == SessionStatus.Running && s.LastSeenAt != null && s.LastSeenAt >= since)
                .OrderBy(s => s.StartedAt)
                .ToListAsync(ct);
            var ids = running.Select(s => s.ExperimentId).Distinct().ToList();
            var names = await db.Experiments.Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id, e => e.Name, ct);
            return Results.Ok(running.Select(s => new LiveSession(
                s.Id, s.ExperimentId, names.GetValueOrDefault(s.ExperimentId, ""), s.ParticipantCode, s.Origin,
                s.ProgressMs ?? 0, s.Video.DurationMs, s.StartedAt, s.LastSeenAt!.Value)).ToList());
        }).RequireAuthorization();

        // Araştırmacının oturum sonuçları
        var sessions = api.MapGroup("/sessions").RequireAuthorization();

        sessions.MapGet("/", async (int? take, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var ownerId = principal.UserId();
            var list = await db.Sessions.AsNoTracking()
                .Where(s => s.OwnerId == ownerId)
                .OrderByDescending(s => s.CreatedAt)
                .Take(Math.Clamp(take ?? 200, 1, 1000))
                .ToListAsync(ct);
            var names = await db.Experiments.AsNoTracking().Where(e => e.OwnerId == ownerId).ToDictionaryAsync(e => e.Id, e => e.Name, ct);
            return Results.Ok(list.Select(s => ToListItem(s, names.GetValueOrDefault(s.ExperimentId, "Silinmiş deney"))).ToList());
        });

        sessions.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var s = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == principal.UserId(), ct);
            if (s is null) return Problems.NotFound("Oturum");
            var experiment = await db.Experiments.AsNoTracking().FirstOrDefaultAsync(e => e.Id == s.ExperimentId, ct);
            var name = experiment?.Name ?? "Silinmiş deney";
            var assets = await ExperimentEndpoints.LoadAssetsAsync(db, s.OwnerId, ct);

            var usedIds = s.Schedule.SelectMany(x => new[] { x.ImageId, x.AudioId }).OfType<Guid>().Distinct();
            var refs = usedIds.Select(assets.GetValueOrDefault).OfType<MediaAsset>()
                .Select(a => new AssetRef(a.Id, a.Kind, a.Name, signer.Url(a.Id), a.Width, a.Height, a.Peaks))
                .ToList();
            var video = assets.GetValueOrDefault(s.Video.VideoId);

            return Results.Ok(new SessionDetail(
                ToListItem(s, name), s.Seed, s.Settings, s.Video,
                video is null ? null : signer.Url(video.Id),
                video?.PosterStoredName is null ? null : signer.Url(video.Id, "poster"),
                s.Schedule, s.Trials ?? [], s.FalseAlarms ?? [], s.Responses ?? [], s.Interruptions ?? [],
                s.Client, s.Summary, refs, s.StartedAt,
                s.Answers ?? [], experiment?.Questions ?? [], s.ConsentAt, s.Practice));
        });

        sessions.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var deleted = await db.Sessions.Where(s => s.Id == id && s.OwnerId == principal.UserId()).ExecuteDeleteAsync(ct);
            return deleted == 0 ? Problems.NotFound("Oturum") : Results.NoContent();
        });

        sessions.MapGet("/{id:guid}/export", async (Guid id, string? format, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var s = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.OwnerId == principal.UserId(), ct);
            if (s is null) return Problems.NotFound("Oturum");
            var name = await db.Experiments.Where(e => e.Id == s.ExperimentId).Select(e => e.Name).FirstOrDefaultAsync(ct) ?? "deney";
            var stem = $"{Slug(name)}-{Slug(s.ParticipantCode)}";
            if (format == "json")
            {
                var bytes = JsonSerializer.SerializeToUtf8Bytes(new { experiment = name, session = s }, new JsonSerializerOptions(Json.Options) { WriteIndented = true });
                return Results.File(bytes, "application/json", $"{stem}.json");
            }
            var assets = await ExperimentEndpoints.LoadAssetsAsync(db, s.OwnerId, ct);
            return Csv(CsvExport.Trials([s], name, assets), $"{stem}.csv");
        });
    }

    /// <summary>
    /// Oturumu oluşturur ve sahibinin kredisinden tek bir atomik güncellemeyle düşer.
    /// Kredi istemciden gelen sayıya göre değil, sunucudaki kayda göre denetlenir.
    /// </summary>
    private static async Task<IResult> CreateSessionAsync(VigilaDb db, MediaUrlSigner signer, Experiment e, SessionOrigin origin, StartSessionRequest req, CancellationToken ct)
    {
        var assets = await ExperimentEndpoints.LoadAssetsAsync(db, e.OwnerId, ct);
        var readiness = Planner.Evaluate(e, assets);
        if (!readiness.Ready) return Problems.Conflict("Deney henüz hazır değil.", string.Join(" ", readiness.Issues));

        var code = req.ParticipantCode?.Trim();
        if (string.IsNullOrEmpty(code)) code = Tokens.ParticipantCode();
        if (code.Length > 64) return Problems.Validation("participantCode", "Katılımcı kodu en fazla 64 karakter olabilir.");

        if (!string.IsNullOrWhiteSpace(e.ConsentText) && !req.Consented)
            return Problems.Validation("consented", "Devam etmek için onam vermeniz gerekiyor.");
        var (answers, answerError) = ValidateAnswers(e.Questions, req.Answers);
        if (answerError is not null) return Problems.Validation("answers", answerError);

        if (origin == SessionOrigin.Link && e.PreventRepeat && !string.IsNullOrEmpty(req.ParticipantCode))
        {
            var lowered = code.ToLower();
            if (await db.Sessions.AnyAsync(x => x.ExperimentId == e.Id && x.Status == SessionStatus.Completed && x.ParticipantCode.ToLower() == lowered, ct))
                return Problems.Conflict("Bu katılımcı kodu ile deney zaten tamamlanmış.", "Her katılımcı deneye bir kez katılabilir.");
        }

        var resolved = Planner.Resolve(e, assets);
        uint seed = e.Settings.SeedMode == SeedMode.Fixed ? (uint)e.Settings.FixedSeed : ExperimentEndpoints.NewSeed();
        var request = Planner.Request(e.Settings, resolved, seed);
        var schedule = ScheduleGenerator.Generate(request);
        if (!schedule.Ok) return Problems.Conflict("Uyaran planı oluşturulamadı.", schedule.Error);
        var practice = ScheduleGenerator.GeneratePractice(request);

        var key = Tokens.NewUrlToken(24);
        var video = resolved.Video!;
        var session = new Session
        {
            ExperimentId = e.Id,
            OwnerId = e.OwnerId,
            ParticipantCode = code,
            Origin = origin,
            Seed = seed,
            KeyHash = Tokens.Sha256(key),
            Settings = e.Settings,
            Video = new VideoSnapshot(video.Id, video.Name, video.DurationMs ?? 0, video.Width ?? 1920, video.Height ?? 1080),
            Schedule = schedule.Stimuli.ToList(),
            TrialCount = schedule.Stimuli.Count,
            Client = req.Client,
            Answers = answers,
            ConsentAt = string.IsNullOrWhiteSpace(e.ConsentText) ? null : DateTime.UtcNow,
        };

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var charged = await db.Users
            .Where(u => u.Id == e.OwnerId && u.IsActive && (u.CreditsRemaining == null || u.CreditsRemaining > 0))
            .ExecuteUpdateAsync(set => set
                .SetProperty(u => u.CreditsRemaining, u => u.CreditsRemaining == null ? null : u.CreditsRemaining - 1)
                .SetProperty(u => u.CreditsUsed, u => u.CreditsUsed + 1), ct);
        if (charged == 0)
        {
            return TypedResults.Problem(
                title: origin == SessionOrigin.Lab ? "Oturum krediniz kalmadı." : "Bu deney şu anda yeni katılımcı kabul etmiyor.",
                detail: origin == SessionOrigin.Lab ? "Yöneticinizden kredi tanımlamasını isteyin." : null,
                statusCode: StatusCodes.Status402PaymentRequired);
        }

        db.Sessions.Add(session);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        var images = resolved.Images.Select(i => new RunAsset(i.Id, signer.Url(i.Id), i.Width, i.Height, i.SizeBytes)).ToList();
        var audios = resolved.Audios.Select(a => new RunAsset(a.Id, signer.Url(a.Id), null, null, a.SizeBytes)).ToList();
        var s = e.Settings;

        return Results.Ok(new RunPayload(
            session.Id, key, code, e.Name, origin,
            new RunSettings(s.ResponseKey, s.ResponseWindowMs, s.AllowPause, s.AudioVolume, s.VideoVolume, s.MinValidRtMs, s.ResponseMode, s.Language, s.PracticeFeedback),
            new RunVideo(signer.Url(video.Id), session.Video.DurationMs, session.Video.Width, session.Video.Height, video.SizeBytes),
            session.Schedule, images, audios,
            practice.Stimuli.Count > 0 ? new RunPractice(practice.DurationMs, practice.Stimuli) : null));
    }

    /// <summary>Yanıtları soru tanımına göre denetler; bilinmeyen alanlar atılır, zorunlu sorular aranır.</summary>
    private static (Dictionary<string, string>? Answers, string? Error) ValidateAnswers(List<Question> questions, Dictionary<string, string>? given)
    {
        if (questions.Count == 0) return (null, null);
        var result = new Dictionary<string, string>();
        foreach (var q in questions)
        {
            var value = given?.GetValueOrDefault(q.Id)?.Trim() ?? "";
            if (value.Length == 0)
            {
                if (q.Required) return (null, $"“{q.Label}” sorusunu yanıtlayın.");
                continue;
            }
            if (value.Length > 1000) return (null, $"“{q.Label}” yanıtı çok uzun.");
            switch (q.Type)
            {
                case QuestionType.Number when !double.TryParse(value.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) || (q.Min is int min && n < min) || (q.Max is int max && n > max):
                    return (null, $"“{q.Label}” için geçerli bir sayı girin.");
                case QuestionType.Scale when !int.TryParse(value, out var v) || v < (q.Min ?? 1) || v > (q.Max ?? 5):
                    return (null, $"“{q.Label}” için ölçekten bir değer seçin.");
                case QuestionType.Choice when q.Options is null || !q.Options.Contains(value):
                    return (null, $"“{q.Label}” için seçeneklerden birini işaretleyin.");
            }
            result[q.Id] = value;
        }
        return (result, null);
    }

    /// <summary>Bağlantının süresi dolduysa ya da katılımcı sınırına ulaşıldıysa kapalı olduğunu bildirir.</summary>
    private static async Task<IResult?> LinkClosedAsync(VigilaDb db, Experiment e, CancellationToken ct)
    {
        if (e.LinkExpiresAt is DateTime expires && expires < DateTime.UtcNow)
            return TypedResults.Problem(title: "Bu deneyin katılım süresi doldu.", detail: "Katılım için teşekkür ederiz.", statusCode: StatusCodes.Status410Gone);
        if (e.MaxParticipants is int max &&
            await db.Sessions.CountAsync(s => s.ExperimentId == e.Id && s.Origin == SessionOrigin.Link && s.Status == SessionStatus.Completed, ct) >= max)
            return TypedResults.Problem(title: "Bu deney için gereken katılımcı sayısına ulaşıldı.", detail: "Katılım için teşekkür ederiz.", statusCode: StatusCodes.Status410Gone);
        return null;
    }

    /// <summary>Bağlantıyla tamamlanan oturum için araştırmacının belirlediği adrese yönlendirme ({kod} yerine katılımcı kodu).</summary>
    private static async Task<string?> RedirectAsync(VigilaDb db, Session s, CancellationToken ct)
    {
        if (s.Origin != SessionOrigin.Link || s.Status != SessionStatus.Completed) return null;
        var url = await db.Experiments.Where(e => e.Id == s.ExperimentId).Select(e => e.CompletionUrl).FirstOrDefaultAsync(ct);
        return string.IsNullOrEmpty(url) ? null : url.Replace("{kod}", Uri.EscapeDataString(s.ParticipantCode));
    }

    private static async Task<Experiment?> FindByTokenAsync(VigilaDb db, string token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 64) return null;
        return await db.Experiments.FirstOrDefaultAsync(e => e.RunToken == token && e.RunLinkEnabled && !e.IsArchived, ct);
    }

    private static async Task<Session?> FindWithKeyAsync(VigilaDb db, Guid id, HttpContext http, CancellationToken ct)
    {
        var key = http.Request.Headers[SessionKeyHeader].ToString();
        if (string.IsNullOrEmpty(key)) return null;
        var s = await db.Sessions.FirstOrDefaultAsync(x => x.Id == id, ct);
        return s is not null && Tokens.HashEquals(key, s.KeyHash) ? s : null;
    }

    private static RunInfo ToRunInfo(Experiment e, IReadOnlyDictionary<Guid, MediaAsset> assets, MediaUrlSigner signer)
    {
        var resolved = Planner.Resolve(e, assets);
        var instruction = e.InstructionVideoId is Guid iv && assets.TryGetValue(iv, out var a) && a.Kind == MediaKind.Video ? a : null;
        var s = e.Settings;
        return new RunInfo(
            e.Name, e.InstructionText,
            instruction is null ? null : signer.Url(instruction.Id),
            s.ResponseKey, s.AllowPause,
            resolved.Video?.DurationMs ?? 0,
            ScheduleGenerator.CountTrials(s, resolved.Images.Count, resolved.Audios.Count),
            e.ConsentText, e.Questions, s.ResponseMode, s.Language, s.BlockTouchOnly, s.PracticeTrials, e.PreventRepeat);
    }

    public static SessionListItem ToListItem(Session s, string experimentName) => new(
        s.Id, s.ExperimentId, experimentName, s.ParticipantCode, s.Origin, s.Status, s.CreatedAt, s.CompletedAt,
        s.TrialCount, s.HitRate, s.MeanRt, s.FalseAlarmCount);

    private static IResult Csv(string content, string fileName) =>
        Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(content)).ToArray(), "text/csv; charset=utf-8", fileName);

    public static string Slug(string value)
    {
        var map = new Dictionary<char, char> { ['ç'] = 'c', ['ğ'] = 'g', ['ı'] = 'i', ['ö'] = 'o', ['ş'] = 's', ['ü'] = 'u' };
        var sb = new StringBuilder();
        foreach (var ch in value.ToLower(CultureInfo.GetCultureInfo("tr-TR")))
        {
            var c = map.GetValueOrDefault(ch, ch);
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9') sb.Append(c);
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }
        var slug = sb.ToString().Trim('-');
        return slug.Length == 0 ? "veri" : slug[..Math.Min(slug.Length, 60)];
    }
}
