using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Vigila.Api.Domain;
using Vigila.Api.Infrastructure;

namespace Vigila.Api.Data;

public sealed class VigilaDb(DbContextOptions<VigilaDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<MediaAsset> Media => Set<MediaAsset>();
    public DbSet<Experiment> Experiments => Set<Experiment>();
    public DbSet<Session> Sessions => Set<Session>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.DisplayName).HasMaxLength(120);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<MediaAsset>(e =>
        {
            e.HasIndex(x => new { x.OwnerId, x.Kind });
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Peaks).HasJson();
            e.HasOne<User>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Experiment>(e =>
        {
            e.HasIndex(x => x.OwnerId);
            e.HasIndex(x => x.RunToken).IsUnique();
            e.Property(x => x.Name).HasMaxLength(160);
            e.Property(x => x.ImageIds).HasJson();
            e.Property(x => x.AudioIds).HasJson();
            e.Property(x => x.Settings).HasJson();
            e.Property(x => x.Questions).HasJson();
            e.Property(x => x.CompletionUrl).HasMaxLength(1000);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Session>(e =>
        {
            e.HasIndex(x => new { x.ExperimentId, x.CreatedAt });
            e.HasIndex(x => new { x.OwnerId, x.CreatedAt });
            e.Property(x => x.ParticipantCode).HasMaxLength(64);
            e.Property(x => x.Origin).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(12);
            e.Property(x => x.Settings).HasJson();
            e.Property(x => x.Video).HasJson();
            e.Property(x => x.Schedule).HasJson();
            e.Property(x => x.Presentations).HasJson();
            e.Property(x => x.Responses).HasJson();
            e.Property(x => x.Interruptions).HasJson();
            e.Property(x => x.Client).HasJson();
            e.Property(x => x.Trials).HasJson();
            e.Property(x => x.FalseAlarms).HasJson();
            e.Property(x => x.Summary).HasJson();
            e.Property(x => x.Answers).HasJson();
            e.Property(x => x.Practice).HasJson();
            e.HasIndex(x => new { x.OwnerId, x.Status, x.LastSeenAt });
            e.HasOne<Experiment>().WithMany().HasForeignKey(x => x.ExperimentId).OnDelete(DeleteBehavior.Cascade);
        });

        // SQLite tarih türünü saklamaz; okunan değerler UTC olarak işaretlenmezse istemci yerel saat sanır.
        var utc = new ValueConverter<DateTime, DateTime>(
            v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        var utcNullable = new ValueConverter<DateTime?, DateTime?>(
            v => v.HasValue && v.Value.Kind != DateTimeKind.Utc ? v.Value.ToUniversalTime() : v,
            v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
        foreach (var property in b.Model.GetEntityTypes().SelectMany(t => t.GetProperties()))
        {
            if (property.ClrType == typeof(DateTime)) property.SetValueConverter(utc);
            else if (property.ClrType == typeof(DateTime?)) property.SetValueConverter(utcNullable);
        }
    }
}

internal static class JsonColumnExtensions
{
    /// <summary>Karmaşık nesneyi tek bir JSON metin sütununda saklar.</summary>
    public static PropertyBuilder<T> HasJson<T>(this PropertyBuilder<T> builder)
    {
        var converter = new ValueConverter<T, string>(
            v => JsonSerializer.Serialize(v, Json.Options),
            s => JsonSerializer.Deserialize<T>(s, Json.Options)!);

        var comparer = new ValueComparer<T>(
            (a, b) => JsonSerializer.Serialize(a, Json.Options) == JsonSerializer.Serialize(b, Json.Options),
            v => JsonSerializer.Serialize(v, Json.Options).GetHashCode(),
            v => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v, Json.Options), Json.Options)!);

        builder.HasConversion(converter, comparer).HasColumnType("TEXT");
        return builder;
    }
}
