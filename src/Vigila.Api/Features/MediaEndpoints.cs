using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Vigila.Api.Data;
using Vigila.Api.Domain;
using Vigila.Api.Infrastructure;

namespace Vigila.Api.Features;

public static class MediaEndpoints
{
    private const long MaxPosterBytes = 5 * 1024 * 1024;

    public static void MapMedia(this IEndpointRouteBuilder api)
    {
        var group = api.MapGroup("/media").RequireAuthorization();

        group.MapGet("/", async (MediaKind? kind, ClaimsPrincipal principal, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var ownerId = principal.UserId();
            var query = db.Media.AsNoTracking().Where(m => m.OwnerId == ownerId);
            if (kind is not null) query = query.Where(m => m.Kind == kind);
            var assets = await query.OrderByDescending(m => m.CreatedAt).ToListAsync(ct);
            var usage = await UsageAsync(db, ownerId, ct);
            return TypedResults.Ok(assets.Select(a => ToDto(a, signer, usage.GetValueOrDefault(a.Id))).ToList());
        });

        group.MapPost("/", Upload);

        group.MapPatch("/{id:guid}", async (Guid id, RenameMediaRequest req, ClaimsPrincipal principal, VigilaDb db, MediaUrlSigner signer, CancellationToken ct) =>
        {
            var asset = await db.Media.FirstOrDefaultAsync(m => m.Id == id && m.OwnerId == principal.UserId(), ct);
            if (asset is null) return Problems.NotFound("Medya");
            var name = req.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 200) return Problems.Validation("name", "Ad 1-200 karakter olmalı.");
            asset.Name = name;
            await db.SaveChangesAsync(ct);
            var usage = await UsageAsync(db, asset.OwnerId, ct);
            return Results.Ok(ToDto(asset, signer, usage.GetValueOrDefault(asset.Id)));
        });

        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, VigilaDb db, MediaStorage storage, CancellationToken ct) =>
        {
            var ownerId = principal.UserId();
            var asset = await db.Media.FirstOrDefaultAsync(m => m.Id == id && m.OwnerId == ownerId, ct);
            if (asset is null) return Problems.NotFound("Medya");

            var users = (await db.Experiments.AsNoTracking().Where(e => e.OwnerId == ownerId).ToListAsync(ct))
                .Where(e => e.VideoId == id || e.InstructionVideoId == id || e.ImageIds.Contains(id) || e.AudioIds.Contains(id))
                .Select(e => e.Name)
                .ToList();
            if (users.Count > 0)
                return Problems.Conflict("Bu dosya bir deneyde kullanılıyor.", $"Önce şu deneylerden çıkarın: {string.Join(", ", users)}.");

            db.Media.Remove(asset);
            await db.SaveChangesAsync(ct);
            storage.Delete(asset.StoredName);
            storage.Delete(asset.PosterStoredName);
            return Results.NoContent();
        });
    }

    /// <summary>İmzalı adresle medya dosyası sunar; video ilerletme için aralık (Range) isteklerini destekler.</summary>
    public static void MapMediaFiles(this IEndpointRouteBuilder app)
    {
        app.MapGet("/media/{id:guid}/{variant}", async (Guid id, string variant, long? e, string? s, VigilaDb db, MediaStorage storage, MediaUrlSigner signer, HttpContext http, CancellationToken ct) =>
        {
            if (variant is not ("file" or "poster") || e is null || !signer.Verify(id, variant, e.Value, s))
                return Results.NotFound();

            var asset = await db.Media.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id, ct);
            var stored = variant == "poster" ? asset?.PosterStoredName : asset?.StoredName;
            if (asset is null || stored is null) return Results.NotFound();

            var path = storage.PathFor(stored);
            if (!File.Exists(path)) return Results.NotFound();

            http.Response.Headers.CacheControl = "private, max-age=3600";
            var contentType = variant == "poster" ? MediaStorage.Describe(stored)?.ContentType ?? "image/jpeg" : asset.ContentType;
            return TypedResults.PhysicalFile(path, contentType, lastModified: File.GetLastWriteTimeUtc(path), enableRangeProcessing: true);
        });
    }

    /// <summary>
    /// Çok parçalı yüklemeyi bellekte tamponlamadan doğrudan diske akıtır.
    /// Beklenen parçalar: "meta" (JSON), isteğe bağlı "poster" (video kapak görseli) ve "file".
    /// </summary>
    private static async Task<IResult> Upload(HttpContext http, ClaimsPrincipal principal, VigilaDb db, MediaStorage storage, MediaUrlSigner signer, IOptions<VigilaOptions> options, CancellationToken ct)
    {
        long maxBytes = options.Value.MaxUploadMb * 1024 * 1024;
        var sizeFeature = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (sizeFeature is { IsReadOnly: false }) sizeFeature.MaxRequestBodySize = maxBytes + MaxPosterBytes + 1024 * 1024;

        if (!MediaTypeHeaderValue.TryParse(http.Request.ContentType, out var mediaType) ||
            !mediaType.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase) ||
            HeaderUtilities.RemoveQuotes(mediaType.Boundary).Value is not { Length: > 0 } boundary)
            return Problems.BadRequest("Yükleme çok parçalı form olarak gönderilmeli.");

        var reader = new MultipartReader(boundary, http.Request.Body) { BodyLengthLimit = maxBytes };
        MediaMeta? meta = null;
        string? posterName = null;
        (string Stored, long Size, string FileName, MediaKind Kind, string ContentType)? file = null;

        try
        {
            MultipartSection? section;
            while ((section = await reader.ReadNextSectionAsync(ct)) is not null)
            {
                if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var cd)) continue;
                var name = HeaderUtilities.RemoveQuotes(cd.Name).Value;

                if (name == "meta")
                {
                    using var sr = new StreamReader(section.Body);
                    meta = JsonSerializer.Deserialize<MediaMeta>(await sr.ReadToEndAsync(ct), Json.Options);
                }
                else if (name == "poster" && posterName is null)
                {
                    var ext = Path.GetExtension(HeaderUtilities.RemoveQuotes(cd.FileName).Value ?? ".jpg");
                    if (MediaStorage.Describe("x" + ext)?.Kind != MediaKind.Image) ext = ".jpg";
                    posterName = (await storage.SaveAsync(section.Body, ext, MediaKind.Image, MaxPosterBytes, ct)).StoredName;
                }
                else if (name == "file" && file is null)
                {
                    var fileName = Path.GetFileName(HeaderUtilities.RemoveQuotes(cd.FileNameStar.HasValue ? cd.FileNameStar : cd.FileName).Value ?? "");
                    if (MediaStorage.Describe(fileName) is not { } type)
                    {
                        storage.Delete(posterName);
                        return Problems.BadRequest(
                            "Bu dosya türü desteklenmiyor.",
                            $"Desteklenen uzantılar: {string.Join(", ", MediaStorage.AllowedExtensions.Order())}.");
                    }
                    var saved = await storage.SaveAsync(section.Body, Path.GetExtension(fileName), type.Kind, maxBytes, ct);
                    file = (saved.StoredName, saved.Size, fileName, type.Kind, type.ContentType);
                }
            }
        }
        catch (Exception ex) when (ex is InvalidMediaException or InvalidDataException or BadHttpRequestException or JsonException)
        {
            storage.Delete(posterName);
            if (file is not null) storage.Delete(file.Value.Stored);
            return ex switch
            {
                InvalidMediaException => Problems.BadRequest(ex.Message),
                JsonException => Problems.BadRequest("Dosya bilgileri okunamadı."),
                _ => TypedResults.Problem(title: $"Dosya en fazla {options.Value.MaxUploadMb} MB olabilir.", statusCode: StatusCodes.Status413PayloadTooLarge),
            };
        }

        if (file is not { } f)
        {
            storage.Delete(posterName);
            return Problems.BadRequest("Yüklenecek dosya bulunamadı.");
        }

        if (f.Kind != MediaKind.Video && posterName is not null)
        {
            storage.Delete(posterName);
            posterName = null;
        }

        var asset = new MediaAsset
        {
            OwnerId = principal.UserId(),
            Kind = f.Kind,
            Name = Truncate(string.IsNullOrWhiteSpace(meta?.Name) ? Path.GetFileNameWithoutExtension(f.FileName) : meta!.Name!.Trim(), 200),
            OriginalFileName = Truncate(f.FileName, 255),
            StoredName = f.Stored,
            ContentType = f.ContentType,
            SizeBytes = f.Size,
            DurationMs = f.Kind == MediaKind.Image ? null : Clamp(meta?.DurationMs, 1, 24 * 3600 * 1000),
            Width = Clamp(meta?.Width, 1, 16384),
            Height = Clamp(meta?.Height, 1, 16384),
            PosterStoredName = posterName,
            Peaks = f.Kind == MediaKind.Audio ? meta?.Peaks?.Take(400).Select(p => Math.Clamp(p, 0, 100)).ToList() : null,
        };
        db.Media.Add(asset);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/media/{asset.Id}", ToDto(asset, signer, 0));
    }

    public static async Task<Dictionary<Guid, int>> UsageAsync(VigilaDb db, Guid ownerId, CancellationToken ct)
    {
        var experiments = await db.Experiments.AsNoTracking().Where(e => e.OwnerId == ownerId).ToListAsync(ct);
        var usage = new Dictionary<Guid, int>();
        foreach (var e in experiments)
        {
            var ids = e.ImageIds.Concat(e.AudioIds);
            if (e.VideoId is Guid v) ids = ids.Append(v);
            if (e.InstructionVideoId is Guid iv) ids = ids.Append(iv);
            foreach (var id in ids.Distinct()) usage[id] = usage.GetValueOrDefault(id) + 1;
        }
        return usage;
    }

    public static MediaDto ToDto(MediaAsset a, MediaUrlSigner signer, int usage) => new(
        a.Id, a.Kind, a.Name, a.OriginalFileName, a.ContentType, a.SizeBytes, a.DurationMs, a.Width, a.Height,
        signer.Url(a.Id), a.PosterStoredName is null ? null : signer.Url(a.Id, "poster"), a.Peaks, a.CreatedAt, usage);

    private static int? Clamp(int? value, int min, int max) => value is int v && v >= min ? Math.Min(v, max) : null;

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
