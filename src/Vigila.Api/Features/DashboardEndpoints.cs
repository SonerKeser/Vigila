using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Vigila.Api.Data;
using Vigila.Api.Domain;
using Vigila.Api.Infrastructure;

namespace Vigila.Api.Features;

public static class DashboardEndpoints
{
    public static void MapDashboard(this IEndpointRouteBuilder api)
    {
        api.MapGet("/dashboard", async (ClaimsPrincipal principal, VigilaDb db, CancellationToken ct) =>
        {
            var ownerId = principal.UserId();
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == ownerId, ct);
            var experiments = await db.Experiments.AsNoTracking().Where(e => e.OwnerId == ownerId)
                .Select(e => new { e.Id, e.Name, e.RunLinkEnabled, e.IsArchived })
                .ToListAsync(ct);
            var names = experiments.ToDictionary(e => e.Id, e => e.Name);

            var sessions = await db.Sessions.AsNoTracking().Where(s => s.OwnerId == ownerId)
                .Select(s => new { s.Id, s.ExperimentId, s.ParticipantCode, s.Origin, s.Status, s.CreatedAt, s.CompletedAt, s.TrialCount, s.HitRate, s.MeanRt, s.FalseAlarmCount })
                .ToListAsync(ct);
            var completed = sessions.Where(s => s.Status == SessionStatus.Completed).ToList();

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var activity = Enumerable.Range(0, 14)
                .Select(i => today.AddDays(i - 13))
                .Select(day => new DayCount(day, completed.Count(s => DateOnly.FromDateTime(s.CompletedAt ?? s.CreatedAt) == day)))
                .ToList();

            var recent = sessions.OrderByDescending(s => s.CreatedAt).Take(8)
                .Select(s => new SessionListItem(s.Id, s.ExperimentId, names.GetValueOrDefault(s.ExperimentId, "Silinmiş deney"), s.ParticipantCode,
                    s.Origin, s.Status, s.CreatedAt, s.CompletedAt, s.TrialCount, s.HitRate, s.MeanRt, s.FalseAlarmCount))
                .ToList();

            var trend = completed.OrderByDescending(s => s.CompletedAt).Take(24).OrderBy(s => s.CompletedAt)
                .Select(s => new TrendPoint(s.CompletedAt ?? s.CreatedAt, s.MeanRt, s.HitRate))
                .ToList();

            var weekAgo = DateTime.UtcNow.AddDays(-7);
            return TypedResults.Ok(new DashboardDto(
                experiments.Count(e => !e.IsArchived),
                experiments.Count(e => e.RunLinkEnabled && !e.IsArchived),
                completed.Count,
                completed.Count(s => (s.CompletedAt ?? s.CreatedAt) >= weekAgo),
                completed.Select(s => s.ParticipantCode).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
                completed.Count > 0 ? Math.Round(completed.Average(s => s.HitRate ?? 0), 4) : null,
                completed.Average(s => s.MeanRt) is double rt ? Math.Round(rt, 1) : null,
                user.CreditsRemaining,
                user.CreditsUsed,
                activity,
                recent,
                trend));
        }).RequireAuthorization();
    }
}
