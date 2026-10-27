using System.IO.Compression;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Vigila.Api.Data;
using Vigila.Api.Domain;
using Vigila.Api.Infrastructure;

namespace Vigila.Api.Features;

public static class AdminEndpoints
{
    public static void MapAdmin(this IEndpointRouteBuilder api)
    {
        // Tam yedek: veritabanının tutarlı kopyası (VACUUM INTO), medya dosyaları ve anahtarlar tek zip dosyasında.
        api.MapGet("/admin/backup", async (VigilaDb db, MediaStorage storage, IOptions<VigilaOptions> options, IWebHostEnvironment env, HttpContext http, CancellationToken ct) =>
        {
            var dataPath = DataPaths.Resolve(options.Value, env);
            var tmp = Directory.CreateDirectory(Path.Combine(dataPath, "tmp")).FullName;
            var stamp = Guid.NewGuid().ToString("N");
            var dbCopy = Path.Combine(tmp, $"{stamp}.db");
            var zipPath = Path.Combine(tmp, $"{stamp}.zip");

            try
            {
                await db.Database.ExecuteSqlRawAsync($"VACUUM INTO '{dbCopy.Replace("'", "''")}'", ct);
                using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    zip.CreateEntryFromFile(dbCopy, "vigila.db", CompressionLevel.Optimal);
                    foreach (var file in Directory.EnumerateFiles(storage.Root))
                        zip.CreateEntryFromFile(file, $"media/{Path.GetFileName(file)}", CompressionLevel.NoCompression);
                    var keys = Path.Combine(dataPath, "keys");
                    if (Directory.Exists(keys))
                        foreach (var file in Directory.EnumerateFiles(keys))
                            zip.CreateEntryFromFile(file, $"keys/{Path.GetFileName(file)}");
                    var signing = Path.Combine(dataPath, "media-signing.key");
                    if (File.Exists(signing)) zip.CreateEntryFromFile(signing, "media-signing.key");

                    using var readme = new StreamWriter(zip.CreateEntry("GERI-YUKLEME.txt").Open());
                    readme.Write(
                        "Vigila yedeği\n\n" +
                        "Geri yüklemek için uygulamayı durdurun, bu arşivin içeriğini veri klasörüne (Vigila:DataPath, varsayılan App_Data) açın\n" +
                        "ve uygulamayı yeniden başlatın. Arşiv parola özetleri ile anahtarlar içerir; güvenli bir yerde saklayın.\n");
                }
            }
            finally
            {
                File.Delete(dbCopy);
            }

            http.Response.OnCompleted(() =>
            {
                try { File.Delete(zipPath); } catch (IOException) { }
                return Task.CompletedTask;
            });
            return Results.File(zipPath, "application/zip", $"vigila-yedek-{DateTime.UtcNow:yyyyMMdd-HHmm}.zip");
        }).RequireAuthorization("Admin");

        var g = api.MapGroup("/admin/users").RequireAuthorization("Admin");

        g.MapGet("/", async (VigilaDb db, CancellationToken ct) =>
        {
            var users = await db.Users.AsNoTracking().OrderBy(u => u.DisplayName).ToListAsync(ct);
            var experiments = await db.Experiments.GroupBy(e => e.OwnerId).Select(x => new { x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            var sessions = await db.Sessions.GroupBy(s => s.OwnerId).Select(x => new { x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
            return TypedResults.Ok(users.Select(u => ToDto(u, experiments.GetValueOrDefault(u.Id), sessions.GetValueOrDefault(u.Id))).ToList());
        });

        g.MapPost("/", async (CreateUserRequest req, VigilaDb db, PasswordHasher hasher, CancellationToken ct) =>
        {
            if (AuthEndpoints.ValidateAccount(req.Email, req.DisplayName, req.Password) is { } invalid) return invalid;
            if (req.Credits is < 0) return Problems.Validation("credits", "Kredi negatif olamaz.");

            var email = AuthEndpoints.NormalizeEmail(req.Email!);
            if (await db.Users.AnyAsync(u => u.Email == email, ct)) return Problems.Validation("email", "Bu e-posta ile kayıtlı bir kullanıcı var.");

            var user = new User
            {
                Email = email,
                DisplayName = req.DisplayName!.Trim(),
                PasswordHash = hasher.Hash(req.Password!),
                Role = req.Role,
                CreditsRemaining = req.Credits,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/admin/users/{user.Id}", ToDto(user, 0, 0));
        });

        g.MapPatch("/{id:guid}", async (Guid id, UpdateUserRequest req, ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var user = await db.Users.FindAsync([id], ct);
            if (user is null) return Problems.NotFound("Kullanıcı");
            bool self = id == principal.UserId();

            if (req.DisplayName is not null)
            {
                var name = req.DisplayName.Trim();
                if (name.Length is 0 or > 120) return Problems.Validation("displayName", "Ad soyad 1-120 karakter olmalı.");
                user.DisplayName = name;
            }

            if (req.Role is UserRole role && role != user.Role)
            {
                if (self) return Problems.Conflict("Kendi rolünüzü değiştiremezsiniz.");
                user.Role = role;
                user.SecurityStamp = User.NewStamp();
            }

            if (req.IsActive is bool active && active != user.IsActive)
            {
                if (self) return Problems.Conflict("Kendi hesabınızı kapatamazsınız.");
                user.IsActive = active;
                user.SecurityStamp = User.NewStamp();
            }

            if (req.Credits is { } change)
            {
                switch (change.Mode)
                {
                    case "unlimited":
                        user.CreditsRemaining = null;
                        break;
                    case "set" when change.Value >= 0:
                        user.CreditsRemaining = change.Value;
                        break;
                    case "add" when user.CreditsRemaining is not null:
                        user.CreditsRemaining = Math.Max(0, user.CreditsRemaining.Value + change.Value);
                        break;
                    case "add":
                        break;
                    default:
                        return Problems.Validation("credits", "Geçersiz kredi işlemi.");
                }
            }

            await db.SaveChangesAsync(ct);
            var experiments = await db.Experiments.CountAsync(e => e.OwnerId == id, ct);
            var sessions = await db.Sessions.CountAsync(s => s.OwnerId == id, ct);
            return Results.Ok(ToDto(user, experiments, sessions));
        });

        g.MapPost("/{id:guid}/password", async (Guid id, ResetPasswordRequest req, VigilaDb db, PasswordHasher hasher, CancellationToken ct) =>
        {
            var user = await db.Users.FindAsync([id], ct);
            if (user is null) return Problems.NotFound("Kullanıcı");
            if (string.IsNullOrEmpty(req.NewPassword) || req.NewPassword.Length < AuthEndpoints.MinPasswordLength)
                return Problems.Validation("newPassword", $"Parola en az {AuthEndpoints.MinPasswordLength} karakter olmalı.");
            user.PasswordHash = hasher.Hash(req.NewPassword);
            user.SecurityStamp = User.NewStamp();
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static AdminUserDto ToDto(User u, int experiments, int sessions) => new(
        u.Id, u.Email, u.DisplayName, u.Role, u.IsActive, u.CreditsRemaining, u.CreditsUsed, u.CreatedAt, u.LastLoginAt, experiments, sessions);
}
