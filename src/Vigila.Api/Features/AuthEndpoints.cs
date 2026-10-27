using System.Net.Mail;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Vigila.Api.Data;
using Vigila.Api.Domain;
using Vigila.Api.Infrastructure;

namespace Vigila.Api.Features;

public static class AuthEndpoints
{
    public const int MinPasswordLength = 8;

    public static void MapAuth(this IEndpointRouteBuilder api)
    {
        api.MapGet("/setup", async (VigilaDb db, CancellationToken ct) =>
            TypedResults.Ok(new SetupStatus(!await db.Users.AnyAsync(ct))));

        api.MapPost("/setup", async (SetupRequest req, VigilaDb db, PasswordHasher hasher, HttpContext http, CancellationToken ct) =>
        {
            if (await db.Users.AnyAsync(ct)) return Problems.Conflict("Kurulum zaten tamamlanmış.");
            if (ValidateAccount(req.Email, req.DisplayName, req.Password) is { } invalid) return invalid;

            var user = new User
            {
                Email = NormalizeEmail(req.Email!),
                DisplayName = req.DisplayName!.Trim(),
                PasswordHash = hasher.Hash(req.Password!),
                Role = UserRole.Admin,
                CreditsRemaining = null,
                LastLoginAt = DateTime.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
            await SignInAsync(http, user, persistent: true);
            return Results.Ok(ToMe(user));
        }).RequireRateLimiting("login");

        api.MapPost("/auth/login", async (LoginRequest req, VigilaDb db, PasswordHasher hasher, HttpContext http, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrEmpty(req.Password))
                return Problems.BadRequest("E-posta ve parola gerekli.");

            var email = NormalizeEmail(req.Email);
            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
            if (user is null || !hasher.Verify(req.Password, user.PasswordHash))
                return Problems.BadRequest("E-posta ya da parola hatalı.");
            if (!user.IsActive)
                return TypedResults.Problem(title: "Bu hesap kapatılmış. Yöneticinizle görüşün.", statusCode: StatusCodes.Status403Forbidden);

            user.LastLoginAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            await SignInAsync(http, user, req.Remember);
            return Results.Ok(ToMe(user));
        }).RequireRateLimiting("login");

        api.MapPost("/auth/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        api.MapGet("/auth/me", async (ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var user = await db.Users.FindAsync([principal.UserId()], ct);
            return user is null ? Results.Unauthorized() : Results.Ok(ToMe(user));
        }).RequireAuthorization();

        api.MapPost("/auth/password", async (ChangePasswordRequest req, ClaimsPrincipal principal, VigilaDb db, PasswordHasher hasher, HttpContext http, CancellationToken ct) =>
        {
            var user = await db.Users.FindAsync([principal.UserId()], ct);
            if (user is null) return Results.Unauthorized();
            if (string.IsNullOrEmpty(req.CurrentPassword) || !hasher.Verify(req.CurrentPassword, user.PasswordHash))
                return Problems.Validation("currentPassword", "Mevcut parola hatalı.");
            if (string.IsNullOrEmpty(req.NewPassword) || req.NewPassword.Length < MinPasswordLength)
                return Problems.Validation("newPassword", $"Yeni parola en az {MinPasswordLength} karakter olmalı.");

            user.PasswordHash = hasher.Hash(req.NewPassword);
            user.SecurityStamp = User.NewStamp();
            await db.SaveChangesAsync(ct);
            await SignInAsync(http, user, persistent: true);
            return Results.NoContent();
        }).RequireAuthorization();
    }

    public static IResult? ValidateAccount(string? email, string? displayName, string? password)
    {
        var issues = new List<(string, string)>();
        if (string.IsNullOrWhiteSpace(email) || !MailAddress.TryCreate(email.Trim(), out _) || email.Length > 256)
            issues.Add(("email", "Geçerli bir e-posta adresi girin."));
        if (string.IsNullOrWhiteSpace(displayName) || displayName.Trim().Length > 120)
            issues.Add(("displayName", "Ad soyad 1-120 karakter olmalı."));
        if (string.IsNullOrEmpty(password) || password.Length < MinPasswordLength)
            issues.Add(("password", $"Parola en az {MinPasswordLength} karakter olmalı."));
        return issues.Count > 0 ? Problems.Validation(issues) : null;
    }

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public static MeDto ToMe(User u) => new(u.Id, u.Email, u.DisplayName, u.Role, u.CreditsRemaining, u.CreditsUsed);

    public static Task SignInAsync(HttpContext http, User user, bool persistent)
    {
        Claim[] claims =
        [
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.DisplayName),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Role, user.Role.ToString()),
            new(ClaimsExtensions.StampClaim, user.SecurityStamp),
        ];
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        return http.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = persistent });
    }
}
