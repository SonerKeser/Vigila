using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Vigila.Api.Domain;

namespace Vigila.Api.Infrastructure;

/// <summary>Yüklenen dosyaları veri klasöründe saklar; tür denetimini uzantı ve dosya imzasıyla birlikte yapar.</summary>
public sealed class MediaStorage
{
    private static readonly Dictionary<string, (MediaKind Kind, string ContentType)> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".mp4"] = (MediaKind.Video, "video/mp4"),
        [".m4v"] = (MediaKind.Video, "video/mp4"),
        [".webm"] = (MediaKind.Video, "video/webm"),
        [".ogv"] = (MediaKind.Video, "video/ogg"),
        [".png"] = (MediaKind.Image, "image/png"),
        [".jpg"] = (MediaKind.Image, "image/jpeg"),
        [".jpeg"] = (MediaKind.Image, "image/jpeg"),
        [".webp"] = (MediaKind.Image, "image/webp"),
        [".gif"] = (MediaKind.Image, "image/gif"),
        [".avif"] = (MediaKind.Image, "image/avif"),
        [".mp3"] = (MediaKind.Audio, "audio/mpeg"),
        [".wav"] = (MediaKind.Audio, "audio/wav"),
        [".ogg"] = (MediaKind.Audio, "audio/ogg"),
        [".oga"] = (MediaKind.Audio, "audio/ogg"),
        [".opus"] = (MediaKind.Audio, "audio/ogg"),
        [".m4a"] = (MediaKind.Audio, "audio/mp4"),
        [".aac"] = (MediaKind.Audio, "audio/aac"),
        [".flac"] = (MediaKind.Audio, "audio/flac"),
    };

    public string Root { get; }

    public MediaStorage(IOptions<VigilaOptions> options, IWebHostEnvironment env)
    {
        Root = Path.Combine(DataPaths.Resolve(options.Value, env), "media");
        Directory.CreateDirectory(Root);
    }

    public static IReadOnlyCollection<string> AllowedExtensions => Types.Keys;

    public static (MediaKind Kind, string ContentType)? Describe(string fileName) =>
        Types.TryGetValue(Path.GetExtension(fileName), out var t) ? t : null;

    public string PathFor(string storedName) => Path.Combine(Root, Path.GetFileName(storedName));

    /// <summary>Akışı diske yazar; boyut sınırını ve dosya imzasını yazarken denetler.</summary>
    public async Task<(string StoredName, long Size)> SaveAsync(Stream source, string extension, MediaKind kind, long maxBytes, CancellationToken ct)
    {
        var storedName = $"{Guid.CreateVersion7():N}{extension.ToLowerInvariant()}";
        var path = PathFor(storedName);
        long total = 0;
        var buffer = new byte[81920];
        bool headerChecked = false;

        try
        {
            await using var target = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            var header = new byte[16];
            int headerLength = 0;
            int read;
            while ((read = await source.ReadAsync(buffer, ct)) > 0)
            {
                if (!headerChecked)
                {
                    int take = Math.Min(read, header.Length - headerLength);
                    Array.Copy(buffer, 0, header, headerLength, take);
                    headerLength += take;
                    if (headerLength == header.Length)
                    {
                        if (!FileSignature.Matches(kind, header)) throw new InvalidMediaException("Dosyanın içeriği uzantısıyla uyuşmuyor.");
                        headerChecked = true;
                    }
                }

                total += read;
                if (total > maxBytes) throw new InvalidMediaException($"Dosya en fazla {maxBytes / (1024 * 1024)} MB olabilir.");
                await target.WriteAsync(buffer.AsMemory(0, read), ct);
            }

            if (!headerChecked) throw new InvalidMediaException("Dosya boş ya da çok küçük.");
            return (storedName, total);
        }
        catch
        {
            TryDelete(path);
            throw;
        }
    }

    public void Delete(string? storedName)
    {
        if (!string.IsNullOrEmpty(storedName)) TryDelete(PathFor(storedName));
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (IOException) { }
    }
}

public sealed class InvalidMediaException(string message) : Exception(message);

public static class DataPaths
{
    public static string Resolve(VigilaOptions options, IWebHostEnvironment env)
    {
        var path = Path.IsPathRooted(options.DataPath) ? options.DataPath : Path.Combine(env.ContentRootPath, options.DataPath);
        Directory.CreateDirectory(path);
        return path;
    }
}

/// <summary>Dosyanın ilk baytlarına bakarak gerçekten iddia ettiği türde olup olmadığını denetler.</summary>
public static class FileSignature
{
    public static bool Matches(MediaKind kind, ReadOnlySpan<byte> h) => kind switch
    {
        MediaKind.Image => IsPng(h) || IsJpeg(h) || IsGif(h) || IsRiff(h, "WEBP") || IsFtyp(h, "avif", "avis"),
        MediaKind.Video => IsFtyp(h) || IsEbml(h) || IsOgg(h),
        MediaKind.Audio => IsMp3(h) || IsRiff(h, "WAVE") || IsOgg(h) || IsFtyp(h) || IsFlac(h) || IsAdts(h) || IsEbml(h),
        _ => false,
    };

    public static bool IsImage(ReadOnlySpan<byte> h) => Matches(MediaKind.Image, h);

    private static bool IsPng(ReadOnlySpan<byte> h) => h.StartsWith((byte[])[0x89, 0x50, 0x4E, 0x47]);
    private static bool IsJpeg(ReadOnlySpan<byte> h) => h.StartsWith((byte[])[0xFF, 0xD8, 0xFF]);
    private static bool IsGif(ReadOnlySpan<byte> h) => h.StartsWith("GIF8"u8);
    private static bool IsOgg(ReadOnlySpan<byte> h) => h.StartsWith("OggS"u8);
    private static bool IsFlac(ReadOnlySpan<byte> h) => h.StartsWith("fLaC"u8);
    private static bool IsEbml(ReadOnlySpan<byte> h) => h.StartsWith((byte[])[0x1A, 0x45, 0xDF, 0xA3]);
    private static bool IsAdts(ReadOnlySpan<byte> h) => h.Length > 1 && h[0] == 0xFF && (h[1] & 0xF6) == 0xF0;
    private static bool IsMp3(ReadOnlySpan<byte> h) => h.StartsWith("ID3"u8) || (h.Length > 1 && h[0] == 0xFF && (h[1] & 0xE0) == 0xE0);

    private static bool IsRiff(ReadOnlySpan<byte> h, string form) =>
        h.Length >= 12 && h.StartsWith("RIFF"u8) && h.Slice(8, 4).SequenceEqual(Encoding.ASCII.GetBytes(form));

    private static bool IsFtyp(ReadOnlySpan<byte> h, params string[] brands)
    {
        if (h.Length < 12 || !h.Slice(4, 4).SequenceEqual("ftyp"u8)) return false;
        if (brands.Length == 0) return true;
        var brand = Encoding.ASCII.GetString(h.Slice(8, 4));
        return brands.Contains(brand);
    }
}

/// <summary>
/// Medya dosyaları için süreli, imzalı adresler üretir. Video ve ses etiketleri çerez ya da başlık
/// taşımadan da dosyaya erişebilsin, ama adres tahmin edilemesin diye HMAC kullanılır.
/// Süre saat dilimine yuvarlanır; böylece aynı saat içinde adres değişmez ve tarayıcı önbelleği çalışır.
/// </summary>
public sealed class MediaUrlSigner
{
    private readonly byte[] _key;
    private readonly int _lifetimeHours;

    public MediaUrlSigner(IOptions<VigilaOptions> options, IWebHostEnvironment env)
    {
        _lifetimeHours = Math.Max(1, options.Value.MediaUrlLifetimeHours);
        var keyPath = Path.Combine(DataPaths.Resolve(options.Value, env), "media-signing.key");
        if (File.Exists(keyPath))
        {
            _key = Convert.FromBase64String(File.ReadAllText(keyPath).Trim());
        }
        else
        {
            _key = RandomNumberGenerator.GetBytes(32);
            File.WriteAllText(keyPath, Convert.ToBase64String(_key));
        }
    }

    public string Url(Guid id, string variant = "file")
    {
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long bucket = 3600;
        long expires = ((now + _lifetimeHours * 3600L) / bucket + 1) * bucket;
        return $"/media/{id:N}/{variant}?e={expires}&s={Sign(id, variant, expires)}";
    }

    public bool Verify(Guid id, string variant, long expires, string? signature)
    {
        if (string.IsNullOrEmpty(signature) || expires < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false;
        var expected = Encoding.ASCII.GetBytes(Sign(id, variant, expires));
        return CryptographicOperations.FixedTimeEquals(expected, Encoding.ASCII.GetBytes(signature));
    }

    private string Sign(Guid id, string variant, long expires)
    {
        var mac = HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes($"{id:N}:{variant}:{expires}"));
        return Tokens.Base64Url(mac.AsSpan(0, 18));
    }
}
