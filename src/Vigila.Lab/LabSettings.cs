using System.Text.Json;

namespace Vigila.Lab;

/// <summary>İstemci ayarları; %APPDATA%\Vigila\laboratuvar.json dosyasında saklanır.</summary>
public sealed class LabSettings
{
    public string? ServerUrl { get; set; }

    /// <summary>Açık olduğunda pencere her zaman üstte kalır ve kapatmak için onay istenir.</summary>
    public bool Kiosk { get; set; } = true;

    private static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vigila", "laboratuvar.json");

    public static LabSettings Load()
    {
        try
        {
            return File.Exists(FilePath) ? JsonSerializer.Deserialize<LabSettings>(File.ReadAllText(FilePath)) ?? new() : new();
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return new();
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>Kullanıcının yazdığı adresi düzenler: şema yoksa http eklenir, sondaki eğik çizgi atılır.</summary>
    public static Uri? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var text = input.Trim();
        if (!text.Contains("://")) text = "http://" + text;
        return Uri.TryCreate(text.TrimEnd('/'), UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? uri : null;
    }
}
