using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Vigila.Api.Domain;
using Vigila.Api.Features;
using Vigila.Api.Infrastructure;
using Vigila.Core;

namespace Vigila.Tests;

public sealed class VigilaFactory : WebApplicationFactory<Program>
{
    public string DataPath { get; } = Path.Combine(Path.GetTempPath(), "vigila-tests", Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Vigila:DataPath", DataPath);
        builder.UseSetting("Vigila:PasswordIterations", "1000");
        builder.UseSetting("Vigila:LoginPermitPerMinute", "1000");
        builder.UseSetting("Vigila:PublicPermitPerMinute", "1000");
        builder.UseSetting("ConnectionStrings:Default", $"Data Source={Path.Combine(DataPath, "test.db")}");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(DataPath, recursive: true); } catch (IOException) { }
    }
}

public class ApiTests : IClassFixture<VigilaFactory>
{
    private static readonly JsonSerializerOptions JsonOptions = Json.Options;
    private const string AdminEmail = "admin@lab.test";
    private const string AdminPassword = "Guclu-Parola-1";
    private readonly VigilaFactory _factory;

    public ApiTests(VigilaFactory factory) => _factory = factory;

    private HttpClient NewClient() => _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    private async Task<HttpClient> AdminAsync()
    {
        var client = NewClient();
        var status = await client.GetFromJsonAsync<SetupStatus>("/api/setup", JsonOptions);
        if (status!.NeedsSetup)
        {
            var setup = await client.PostAsJsonAsync("/api/setup", new SetupRequest(AdminEmail, "Lab Yöneticisi", AdminPassword), JsonOptions);
            if (setup.StatusCode == HttpStatusCode.OK) return client;
        }
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(AdminEmail, AdminPassword, false), JsonOptions);
        login.EnsureSuccessStatusCode();
        return client;
    }

    // En küçük geçerli dosya imzaları
    private static byte[] Mp4() => [0, 0, 0, 0x18, .. "ftypisom"u8, 0, 0, 2, 0, .. new byte[64]];
    private static byte[] Png() => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. new byte[64]];
    private static byte[] Jpeg() => [0xFF, 0xD8, 0xFF, 0xE0, .. new byte[64]];
    private static byte[] Wav() => [.. "RIFF"u8, 0x24, 0, 0, 0, .. "WAVEfmt "u8, .. new byte[64]];

    private static async Task<MediaDto> UploadAsync(HttpClient client, string fileName, byte[] bytes, object meta, byte[]? poster = null)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(JsonSerializer.Serialize(meta, JsonOptions), Encoding.UTF8, "application/json"), "meta");
        if (poster is not null) form.Add(new ByteArrayContent(poster), "poster", "poster.jpg");
        form.Add(new ByteArrayContent(bytes), "file", fileName);
        var response = await client.PostAsync("/api/media", form);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<MediaDto>(JsonOptions))!;
    }

    private static async Task<ExperimentDto> ReadyExperimentAsync(HttpClient client, ExperimentSettings? settings = null)
    {
        var video = await UploadAsync(client, "film.mp4", Mp4(), new { durationMs = 120_000, width = 1280, height = 720 }, Jpeg());
        var image = await UploadAsync(client, "yuz.png", Png(), new { width = 300, height = 200 });
        var audio = await UploadAsync(client, "bip.wav", Wav(), new { durationMs = 400, peaks = new[] { 10, 80, 30 } });

        var created = await client.PostAsJsonAsync("/api/experiments", new CreateExperimentRequest("Dikkat deneyi", null), JsonOptions);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var experiment = (await created.Content.ReadFromJsonAsync<ExperimentDto>(JsonOptions))!;
        Assert.False(experiment.Readiness.Ready);

        var draft = new ExperimentDraft("Dikkat deneyi", "Açıklama", "Yönerge", video.Id, null, [image.Id], [audio.Id],
            settings ?? new ExperimentSettings { Repetitions = 3, Pairing = PairingMode.Mixed });
        var updated = await client.PutAsJsonAsync($"/api/experiments/{experiment.Id}", draft, JsonOptions);
        updated.EnsureSuccessStatusCode();
        experiment = (await updated.Content.ReadFromJsonAsync<ExperimentDto>(JsonOptions))!;
        Assert.True(experiment.Readiness.Ready, string.Join(" ", experiment.Readiness.Issues));
        return experiment;
    }

    [Fact]
    public async Task Protected_endpoints_require_login()
    {
        var client = NewClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/experiments")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/olmayan-adres")).StatusCode);
    }

    [Fact]
    public async Task Setup_runs_once_and_login_validates_password()
    {
        await AdminAsync();
        var client = NewClient();
        Assert.False((await client.GetFromJsonAsync<SetupStatus>("/api/setup", JsonOptions))!.NeedsSetup);

        var again = await client.PostAsJsonAsync("/api/setup", new SetupRequest("x@y.test", "X", "12345678"), JsonOptions);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);

        var wrong = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(AdminEmail, "yanlis-parola", false), JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        var ok = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(" ADMIN@lab.test ", AdminPassword, true), JsonOptions);
        ok.EnsureSuccessStatusCode();
        var me = await client.GetFromJsonAsync<MeDto>("/api/auth/me", JsonOptions);
        Assert.Equal(UserRole.Admin, me!.Role);
        Assert.Null(me.CreditsRemaining);
    }

    [Fact]
    public async Task Upload_rejects_content_that_does_not_match_extension()
    {
        var client = await AdminAsync();
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("{}"), "meta");
        form.Add(new ByteArrayContent("<html><script>alert(1)</script></html>"u8.ToArray()), "file", "resim.png");
        var response = await client.PostAsync("/api/media", form);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var form2 = new MultipartFormDataContent();
        form2.Add(new ByteArrayContent(Png()), "file", "betik.html");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/media", form2)).StatusCode);
    }

    [Fact]
    public async Task Media_is_served_only_with_valid_signature_and_supports_ranges()
    {
        var client = await AdminAsync();
        var video = await UploadAsync(client, "klip.mp4", Mp4(), new { durationMs = 5000, width = 640, height = 360 }, Jpeg());
        Assert.NotNull(video.PosterUrl);

        var anonymous = NewClient();
        var request = new HttpRequestMessage(HttpMethod.Get, video.Url);
        request.Headers.Range = new RangeHeaderValue(0, 9);
        var partial = await anonymous.SendAsync(request);
        Assert.Equal(HttpStatusCode.PartialContent, partial.StatusCode);
        Assert.Equal(10, (await partial.Content.ReadAsByteArrayAsync()).Length);
        Assert.Equal("video/mp4", partial.Content.Headers.ContentType?.MediaType);

        var tampered = video.Url[..^3] + "xyz";
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(tampered)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync(video.PosterUrl)).StatusCode);
    }

    [Fact]
    public async Task Media_in_use_cannot_be_deleted()
    {
        var client = await AdminAsync();
        var experiment = await ReadyExperimentAsync(client);
        var response = await client.DeleteAsync($"/api/media/{experiment.VideoId}");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Preview_is_reproducible_for_a_given_seed()
    {
        var client = await AdminAsync();
        var e = await ReadyExperimentAsync(client);
        var draft = new ExperimentDraft(e.Name, e.Description, e.InstructionText, e.VideoId, null, [.. e.ImageIds], [.. e.AudioIds], e.Settings);

        async Task<PreviewResponse> Preview(uint seed)
        {
            var r = await client.PostAsJsonAsync($"/api/experiments/{e.Id}/preview", new PreviewRequest(draft, seed), JsonOptions);
            r.EnsureSuccessStatusCode();
            return (await r.Content.ReadFromJsonAsync<PreviewResponse>(JsonOptions))!;
        }

        var a = await Preview(99);
        var b = await Preview(99);
        Assert.True(a.Ok, a.Error);
        Assert.Equal(9, a.Stimuli.Count);
        Assert.Equal(a.Stimuli.Select(s => s.OnsetMs), b.Stimuli.Select(s => s.OnsetMs));
    }

    [Fact]
    public async Task Participant_link_flow_scores_results_and_exports_csv()
    {
        var client = await AdminAsync();
        var experiment = await ReadyExperimentAsync(client);

        var link = await client.PostAsJsonAsync($"/api/experiments/{experiment.Id}/link", new RunLinkRequest(true, false), JsonOptions);
        link.EnsureSuccessStatusCode();
        var token = (await link.Content.ReadFromJsonAsync<RunLinkResponse>(JsonOptions))!.Token!;

        var participant = NewClient();
        var info = await participant.GetFromJsonAsync<RunInfo>($"/api/run/{token}", JsonOptions);
        Assert.Equal("Dikkat deneyi", info!.ExperimentName);
        Assert.Equal(9, info.TrialCount);

        var startResponse = await participant.PostAsJsonAsync($"/api/run/{token}/sessions", new StartSessionRequest("P-001", null), JsonOptions);
        startResponse.EnsureSuccessStatusCode();
        var payload = (await startResponse.Content.ReadFromJsonAsync<RunPayload>(JsonOptions))!;
        Assert.Equal(9, payload.Stimuli.Count);
        Assert.Equal(SessionOrigin.Link, payload.Origin);

        var wrongKey = new HttpRequestMessage(HttpMethod.Post, $"/api/sessions/{payload.SessionId}/start");
        wrongKey.Headers.Add(SessionEndpoints.SessionKeyHeader, "yanlis");
        Assert.Equal(HttpStatusCode.NotFound, (await participant.SendAsync(wrongKey)).StatusCode);

        participant.DefaultRequestHeaders.Add(SessionEndpoints.SessionKeyHeader, payload.SessionKey);
        Assert.Equal(HttpStatusCode.NoContent, (await participant.PostAsync($"/api/sessions/{payload.SessionId}/start", null)).StatusCode);

        // Video zamanı 0, performance zaman tabanında 1000 ms. Her uyarana 350 ms sonra yanıt verilir.
        const double t0 = 1000;
        var presentations = payload.Stimuli.Select(s => new StimulusPresentation(
            s.Index,
            s.ImageId is null ? null : t0 + s.OnsetMs + 10,
            s.AudioId is null ? null : t0 + s.OnsetMs,
            t0 + s.OnsetMs + s.DurationMs, s.OnsetMs + 10, false)).ToList();
        var responses = payload.Stimuli.Take(8).Select(s => new ResponseEvent(t0 + s.OnsetMs + 360, s.OnsetMs + 360, "Space")).ToList();

        var complete = await participant.PostAsJsonAsync($"/api/sessions/{payload.SessionId}/complete",
            new CompleteSessionRequest(presentations, responses, [], null, 120_000, false), JsonOptions);
        complete.EnsureSuccessStatusCode();
        var completed = (await complete.Content.ReadFromJsonAsync<CompleteSessionResponse>(JsonOptions))!;
        Assert.Equal(SessionStatus.Completed, completed.Status);
        Assert.Null(completed.Summary); // katılımcıya sonuç gösterilmez

        var detail = await client.GetFromJsonAsync<SessionDetail>($"/api/sessions/{payload.SessionId}", JsonOptions);
        Assert.Equal(8, detail!.Summary!.Hits);
        Assert.Equal(1, detail.Summary.Misses);
        Assert.Equal("P-001", detail.Info.ParticipantCode);
        Assert.Equal(DateTimeKind.Utc, detail.Info.CompletedAt!.Value.Kind); // istemci saati yerel sanmasın
        Assert.True(Math.Abs((DateTime.UtcNow - detail.Info.CompletedAt.Value).TotalMinutes) < 5);
        Assert.Equal(3, detail.Summary.ByKind.Count);
        Assert.Equal(2, detail.Assets.Count); // uyaran olarak kullanılan görsel ve ses

        var csv = await client.GetStringAsync($"/api/experiments/{experiment.Id}/export");
        var lines = csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("﻿experiment,session_id,participant", lines[0]);
        Assert.Equal(10, lines.Length);
        Assert.Contains(lines, l => l.Contains(",hit,"));

        var sessionsCsv = await client.GetStringAsync($"/api/experiments/{experiment.Id}/export?kind=sessions");
        Assert.Equal(2, sessionsCsv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);

        // Bağlantı kapatılınca katılım durur.
        await client.PostAsJsonAsync($"/api/experiments/{experiment.Id}/link", new RunLinkRequest(false, false), JsonOptions);
        Assert.Equal(HttpStatusCode.NotFound, (await NewClient().GetAsync($"/api/run/{token}")).StatusCode);
    }

    [Fact]
    public async Task Credits_are_enforced_on_the_server()
    {
        var admin = await AdminAsync();
        var email = $"arastirmaci-{Guid.NewGuid():N}@lab.test";
        var create = await admin.PostAsJsonAsync("/api/admin/users",
            new CreateUserRequest(email, "Araştırmacı", "parola-1234", UserRole.Researcher, 1), JsonOptions);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        var researcher = NewClient();
        (await researcher.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "parola-1234", false), JsonOptions)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await researcher.GetAsync("/api/admin/users")).StatusCode);

        var experiment = await ReadyExperimentAsync(researcher);
        var first = await researcher.PostAsJsonAsync($"/api/experiments/{experiment.Id}/sessions", new StartSessionRequest(null, null), JsonOptions);
        first.EnsureSuccessStatusCode();
        var payload = (await first.Content.ReadFromJsonAsync<RunPayload>(JsonOptions))!;
        Assert.StartsWith("K-", payload.ParticipantCode);

        var second = await researcher.PostAsJsonAsync($"/api/experiments/{experiment.Id}/sessions", new StartSessionRequest(null, null), JsonOptions);
        Assert.Equal(HttpStatusCode.PaymentRequired, second.StatusCode);

        var me = await researcher.GetFromJsonAsync<MeDto>("/api/auth/me", JsonOptions);
        Assert.Equal(0, me!.CreditsRemaining);
        Assert.Equal(1, me.CreditsUsed);

        // Yönetici kredi ekleyince yeniden oturum açılabilir; hesap kapatılınca çerez hemen geçersizleşir.
        var users = await admin.GetFromJsonAsync<List<AdminUserDto>>("/api/admin/users", JsonOptions);
        var id = users!.Single(u => u.Email == email).Id;
        (await admin.PatchAsJsonAsync($"/api/admin/users/{id}", new UpdateUserRequest(null, null, null, new CreditChange("add", 2)), JsonOptions)).EnsureSuccessStatusCode();
        (await researcher.PostAsJsonAsync($"/api/experiments/{experiment.Id}/sessions", new StartSessionRequest(null, null), JsonOptions)).EnsureSuccessStatusCode();

        (await admin.PatchAsJsonAsync($"/api/admin/users/{id}", new UpdateUserRequest(null, null, false, null), JsonOptions)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await researcher.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Completing_twice_returns_the_first_result()
    {
        var client = await AdminAsync();
        var experiment = await ReadyExperimentAsync(client);
        var start = await client.PostAsJsonAsync($"/api/experiments/{experiment.Id}/sessions", new StartSessionRequest("Lab-1", null), JsonOptions);
        var payload = (await start.Content.ReadFromJsonAsync<RunPayload>(JsonOptions))!;

        var request = new CompleteSessionRequest([], [], [], null, 1000, Aborted: true);
        using var msg1 = new HttpRequestMessage(HttpMethod.Post, $"/api/sessions/{payload.SessionId}/complete") { Content = JsonContent.Create(request, options: JsonOptions) };
        msg1.Headers.Add(SessionEndpoints.SessionKeyHeader, payload.SessionKey);
        var first = (await (await client.SendAsync(msg1)).Content.ReadFromJsonAsync<CompleteSessionResponse>(JsonOptions))!;
        Assert.Equal(SessionStatus.Aborted, first.Status);
        Assert.NotNull(first.Summary); // laboratuvar oturumunda araştırmacı özeti görür

        using var msg2 = new HttpRequestMessage(HttpMethod.Post, $"/api/sessions/{payload.SessionId}/complete")
        {
            Content = JsonContent.Create(request with { Aborted = false }, options: JsonOptions),
        };
        msg2.Headers.Add(SessionEndpoints.SessionKeyHeader, payload.SessionKey);
        var second = (await (await client.SendAsync(msg2)).Content.ReadFromJsonAsync<CompleteSessionResponse>(JsonOptions))!;
        Assert.Equal(SessionStatus.Aborted, second.Status);
    }

    private static async Task<string> EnableLinkAsync(HttpClient client, Guid experimentId)
    {
        var link = await client.PostAsJsonAsync($"/api/experiments/{experimentId}/link", new RunLinkRequest(true, false), JsonOptions);
        link.EnsureSuccessStatusCode();
        return (await link.Content.ReadFromJsonAsync<RunLinkResponse>(JsonOptions))!.Token!;
    }

    [Fact]
    public async Task Consent_questions_practice_quota_and_redirect_work_together()
    {
        var client = await AdminAsync();
        var e = await ReadyExperimentAsync(client);
        List<Question> questions =
        [
            new("yas", "Yaşınız", QuestionType.Number, null, true, 18, 99),
            new("el", "El tercihiniz", QuestionType.Choice, ["Sağ", "Sol"], false, null, null),
        ];
        var draft = new ExperimentDraft(e.Name, e.Description, e.InstructionText, e.VideoId, null, [.. e.ImageIds], [.. e.AudioIds],
            e.Settings with { PracticeTrials = 3 }, "Araştırmaya gönüllü katılıyorum.", questions,
            MaxParticipants: 1, PreventRepeat: true, CompletionUrl: "https://anket.example/bitti?kod={kod}");
        (await client.PutAsJsonAsync($"/api/experiments/{e.Id}", draft, JsonOptions)).EnsureSuccessStatusCode();
        var token = await EnableLinkAsync(client, e.Id);

        var participant = NewClient();
        var info = (await participant.GetFromJsonAsync<RunInfo>($"/api/run/{token}", JsonOptions))!;
        Assert.Equal(2, info.Questions.Count);
        Assert.Equal(3, info.PracticeTrials);
        Assert.False(string.IsNullOrEmpty(info.ConsentText));

        async Task<HttpResponseMessage> Start(Dictionary<string, string> answers, bool consented) =>
            await participant.PostAsJsonAsync($"/api/run/{token}/sessions", new StartSessionRequest("P 9", null, answers, consented), JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, (await Start(new() { ["yas"] = "30" }, consented: false)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Start([], consented: true)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Start(new() { ["yas"] = "30", ["el"] = "İkisi" }, consented: true)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Start(new() { ["yas"] = "12" }, consented: true)).StatusCode);

        var started = await Start(new() { ["yas"] = "30", ["el"] = "Sol", ["bilinmeyen"] = "x" }, consented: true);
        started.EnsureSuccessStatusCode();
        var payload = (await started.Content.ReadFromJsonAsync<RunPayload>(JsonOptions))!;
        Assert.Equal(3, payload.Practice!.Stimuli.Count);

        using var complete = new HttpRequestMessage(HttpMethod.Post, $"/api/sessions/{payload.SessionId}/complete")
        {
            Content = JsonContent.Create(new CompleteSessionRequest([], [], [], null, 60_000, false, new PracticeResult(3, 2, 410)), options: JsonOptions),
        };
        complete.Headers.Add(SessionEndpoints.SessionKeyHeader, payload.SessionKey);
        var done = (await (await participant.SendAsync(complete)).Content.ReadFromJsonAsync<CompleteSessionResponse>(JsonOptions))!;
        Assert.Equal("https://anket.example/bitti?kod=P%209", done.RedirectUrl);

        // Katılımcı sınırı doldu: bağlantı kapanır.
        Assert.Equal(HttpStatusCode.Gone, (await NewClient().GetAsync($"/api/run/{token}")).StatusCode);

        var detail = (await client.GetFromJsonAsync<SessionDetail>($"/api/sessions/{payload.SessionId}", JsonOptions))!;
        Assert.Equal("30", detail.Answers["yas"]);
        Assert.False(detail.Answers.ContainsKey("bilinmeyen"));
        Assert.NotNull(detail.ConsentAt);
        Assert.Equal(2, detail.Practice!.Hits);

        var csv = await client.GetStringAsync($"/api/experiments/{e.Id}/export?kind=sessions");
        Assert.Contains("q_yas", csv.Split("\r\n")[0]);
        Assert.Contains("d_prime", csv.Split("\r\n")[0]);
    }

    [Fact]
    public async Task Expired_link_is_closed()
    {
        var client = await AdminAsync();
        var e = await ReadyExperimentAsync(client);
        var draft = new ExperimentDraft(e.Name, e.Description, e.InstructionText, e.VideoId, null, [.. e.ImageIds], [.. e.AudioIds], e.Settings,
            LinkExpiresAt: DateTime.UtcNow.AddDays(-1));
        (await client.PutAsJsonAsync($"/api/experiments/{e.Id}", draft, JsonOptions)).EnsureSuccessStatusCode();
        var token = await EnableLinkAsync(client, e.Id);
        Assert.Equal(HttpStatusCode.Gone, (await NewClient().GetAsync($"/api/run/{token}")).StatusCode);
    }

    [Fact]
    public async Task Heartbeat_makes_session_visible_in_live_view()
    {
        var client = await AdminAsync();
        var e = await ReadyExperimentAsync(client);
        var start = await client.PostAsJsonAsync($"/api/experiments/{e.Id}/sessions", new StartSessionRequest("Canli-1", null), JsonOptions);
        var payload = (await start.Content.ReadFromJsonAsync<RunPayload>(JsonOptions))!;

        using var beat = new HttpRequestMessage(HttpMethod.Post, $"/api/sessions/{payload.SessionId}/heartbeat") { Content = JsonContent.Create(new HeartbeatRequest(12_000), options: JsonOptions) };
        beat.Headers.Add(SessionEndpoints.SessionKeyHeader, payload.SessionKey);
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(beat)).StatusCode);

        var live = await client.GetFromJsonAsync<List<LiveSession>>("/api/live", JsonOptions);
        var mine = Assert.Single(live!, l => l.Id == payload.SessionId);
        Assert.Equal(12_000, mine.ProgressMs);
        Assert.Equal("Canli-1", mine.ParticipantCode);
    }

    [Fact]
    public async Task Admin_can_download_full_backup()
    {
        var client = await AdminAsync();
        await UploadAsync(client, "yedek.png", Png(), new { width = 10, height = 10 });
        var response = await client.GetAsync("/api/admin/backup");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType?.MediaType);

        using var zip = new System.IO.Compression.ZipArchive(await response.Content.ReadAsStreamAsync());
        Assert.Contains(zip.Entries, x => x.FullName == "vigila.db" && x.Length > 0);
        Assert.Contains(zip.Entries, x => x.FullName.StartsWith("media/") && x.FullName.EndsWith(".png"));
        Assert.Contains(zip.Entries, x => x.FullName == "GERI-YUKLEME.txt");
    }

    [Fact]
    public async Task Invalid_settings_are_reported_per_field()
    {
        var client = await AdminAsync();
        var created = await client.PostAsJsonAsync("/api/experiments", new CreateExperimentRequest("Hatalı", null), JsonOptions);
        var e = (await created.Content.ReadFromJsonAsync<ExperimentDto>(JsonOptions))!;
        var draft = new ExperimentDraft("Hatalı", null, null, null, null, null, null, new ExperimentSettings { DurationMinMs = 3000, DurationMaxMs = 1000 });
        var response = await client.PutAsJsonAsync($"/api/experiments/{e.Id}", draft, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("settings.durationMaxMs", body);
    }
}
