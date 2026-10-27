using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace Vigila.Api.Infrastructure;

public sealed class VigilaOptions
{
    public string DataPath { get; set; } = "App_Data";
    public long MaxUploadMb { get; set; } = 2048;
    public int MediaUrlLifetimeHours { get; set; } = 12;
    public int PasswordIterations { get; set; } = 210_000;
    public int LoginPermitPerMinute { get; set; } = 10;
    public int PublicPermitPerMinute { get; set; } = 300;
}

/// <summary>Uygulama genelinde aynÄ± JSON kurallarÄ±: camelCase alanlar, camelCase metin enum'lar.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = Configure(new JsonSerializerOptions(JsonSerializerDefaults.Web));

    public static JsonSerializerOptions Configure(JsonSerializerOptions options)
    {
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        options.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        return options;
    }
}

public static class ClaimsExtensions
{
    public const string StampClaim = "vigila:stamp";

    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("Kimlik yok."));

    public static bool IsAdmin(this ClaimsPrincipal user) => user.IsInRole("Admin");
}

/// <summary>PBKDF2-SHA512 parola Ã¶zeti. BiÃ§im: v1.{yineleme}.{tuz}.{Ã¶zet}</summary>
public sealed class PasswordHasher(IOptions<VigilaOptions> options)
{
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private readonly int _iterations = Math.Max(1000, options.Value.PasswordIterations);

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, _iterations, HashAlgorithmName.SHA512, KeySize);
        return $"v1.{_iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(key)}";
    }

    public bool Verify(string password, string hash)
    {
        var parts = hash.Split('.');
        if (parts.Length != 4 || parts[0] != "v1" || !int.TryParse(parts[1], out var iterations)) return false;
        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA512, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

public static class Tokens
{
    public static string NewUrlToken(int bytes = 18) => Base64Url(RandomNumberGenerator.GetBytes(bytes));

    public static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public static bool HashEquals(string value, string expectedHash) =>
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Sha256(value)), Encoding.ASCII.GetBytes(expectedHash));

    public static string Base64Url(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>OkunmasÄ± kolay katÄ±lÄ±mcÄ± kodu (karÄ±ÅŸan harfler hariÃ§).</summary>
    public static string ParticipantCode()
    {
        const string alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        Span<char> chars = stackalloc char[6];
        for (int i = 0; i < chars.Length; i++) chars[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        return "K-" + new string(chars);
    }
}

public static class Problems
{
    public static IResult NotFound(string what) =>
        TypedResults.Problem(title: $"{what} bulunamadÄ±.", statusCode: StatusCodes.Status404NotFound);

    public static IResult Conflict(string title, string? detail = null) =>
        TypedResults.Problem(title: title, detail: detail, statusCode: StatusCodes.Status409Conflict);

    public static IResult BadRequest(string title, string? detail = null) =>
        TypedResults.Problem(title: title, detail: detail, statusCode: StatusCodes.Status400BadRequest);

    public static IResult Validation(IEnumerable<(string Field, string Message)> issues) =>
        TypedResults.ValidationProblem(
            issues.GroupBy(i => i.Field).ToDictionary(g => ToCamel(g.Key), g => g.Select(i => i.Message).ToArray()),
            title: "BazÄ± alanlar hatalÄ±.");

    public static IResult Validation(string field, string message) => Validation([(field, message)]);

    private static string ToCamel(string s) => string.IsNullOrEmpty(s) ? s : char.ToLowerInvariant(s[0]) + s[1..];
}
