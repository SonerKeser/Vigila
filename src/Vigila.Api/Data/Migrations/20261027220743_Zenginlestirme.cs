using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vigila.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Zenginlestirme : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Answers",
                table: "Sessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ConsentAt",
                table: "Sessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSeenAt",
                table: "Sessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Practice",
                table: "Sessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ProgressMs",
                table: "Sessions",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompletionUrl",
                table: "Experiments",
                type: "TEXT",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ConsentText",
                table: "Experiments",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "LinkExpiresAt",
                table: "Experiments",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MaxParticipants",
                table: "Experiments",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PreventRepeat",
                table: "Experiments",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Questions",
                table: "Experiments",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_OwnerId_Status_LastSeenAt",
                table: "Sessions",
                columns: new[] { "OwnerId", "Status", "LastSeenAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Sessions_OwnerId_Status_LastSeenAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Answers",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "ConsentAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "LastSeenAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Practice",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "ProgressMs",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "CompletionUrl",
                table: "Experiments");

            migrationBuilder.DropColumn(
                name: "ConsentText",
                table: "Experiments");

            migrationBuilder.DropColumn(
                name: "LinkExpiresAt",
                table: "Experiments");

            migrationBuilder.DropColumn(
                name: "MaxParticipants",
                table: "Experiments");

            migrationBuilder.DropColumn(
                name: "PreventRepeat",
                table: "Experiments");

            migrationBuilder.DropColumn(
                name: "Questions",
                table: "Experiments");
        }
    }
}
