using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Vigila.Api.Data;
using Vigila.Api.Features;
using Vigila.Api.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<VigilaOptions>(builder.Configuration.GetSection("Vigila"));
var options = builder.Configuration.GetSection("Vigila").Get<VigilaOptions>() ?? new VigilaOptions();
var dataPath = DataPaths.Resolve(options, builder.Environment);

var connectionString = builder.Configuration.GetConnectionString("Default") is { Length: > 0 } cs
    ? cs
    : $"Data Source={Path.Combine(dataPath, "vigila.db")}";

builder.Services.AddDbContext<VigilaDb>(o => o.UseSqlite(connectionString));
builder.Services.AddDataProtection()
    .SetApplicationName("Vigila")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataPath, "keys")));

builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddSingleton<MediaStorage>();
builder.Services.AddSingleton<MediaUrlSigner>();

builder.Services.ConfigureHttpJsonOptions(o => Json.Configure(o.SerializerOptions));
builder.Services.AddProblemDetails();

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "vigila.auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromDays(14);
        o.SlidingExpiration = true;
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
        // Parola deÄŸiÅŸtiÄŸinde, rol deÄŸiÅŸtiÄŸinde ya da hesap kapatÄ±ldÄ±ÄŸÄ±nda eski Ã§erezler hemen geÃ§ersizleÅŸir.
        o.Events.OnValidatePrincipal = async ctx =>
        {
            var id = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            var stamp = ctx.Principal?.FindFirstValue(ClaimsExtensions.StampClaim);
            var db = ctx.HttpContext.RequestServices.GetRequiredService<VigilaDb>();
            var valid = Guid.TryParse(id, out var userId) &&
                        await db.Users.AnyAsync(u => u.Id == userId && u.IsActive && u.SecurityStamp == stamp);
            if (!valid)
            {
                ctx.RejectPrincipal();
                await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            }
        };
    });

builder.Services.AddAuthorizationBuilder().AddPolicy("Admin", p => p.RequireRole("Admin"));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "?",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = options.LoginPermitPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("public", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "?",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = options.PublicPermitPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/problem+json";
        await ctx.HttpContext.Response.WriteAsJsonAsync(
            new { title = "Ã‡ok fazla istek gÃ¶nderildi. Bir dakika sonra yeniden deneyin.", status = 429 }, ct);
    };
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<VigilaDb>().Database.Migrate();
}

app.UseExceptionHandler();
app.UseStatusCodePages();

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.XContentTypeOptions = "nosniff";
    h.XFrameOptions = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    h.ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

var api = app.MapGroup("/api");
api.MapAuth();
api.MapMedia();
api.MapExperiments();
api.MapSessions();
api.MapDashboard();
api.MapAdmin();
api.MapGet("/health", () => TypedResults.Ok(new { status = "ok" }));
api.MapFallback(() => Problems.NotFound("Adres"));

app.MapMediaFiles();
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
