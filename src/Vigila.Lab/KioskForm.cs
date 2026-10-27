using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Vigila.Lab;

internal static class Theme
{
    public static readonly Color Ink = Color.FromArgb(0x0E, 0x11, 0x30);
    public static readonly Color Paper = Color.FromArgb(0xED, 0xEF, 0xFF);
    public static readonly Color Mist = Color.FromArgb(0xA7, 0xAC, 0xD8);

    public static Icon AppIcon { get; } = LoadIcon();

    private static Icon LoadIcon()
    {
        using var stream = typeof(Theme).Assembly.GetManifestResourceStream("vigila.ico");
        return stream is null ? SystemIcons.Application : new Icon(stream);
    }
}

/// <summary>
/// Vigila'yı tarayıcı çubuğu olmadan, tam ekran açan pencere. Yenileme, geri, yakınlaştırma, sağ tık menüsü ve
/// geliştirici araçları kapalıdır; yalnız sunucunun kendi adresleri açılır, dış bağlantılar varsayılan tarayıcıya gider.
/// Deney boyunca ekranın kararması ve bilgisayarın uykuya geçmesi engellenir.
/// </summary>
public sealed class KioskForm : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    private readonly Panel _offline = new() { Dock = DockStyle.Fill, BackColor = Theme.Ink, Visible = false };
    private readonly Label _offlineText = new() { AutoSize = true, ForeColor = Theme.Paper, Font = new Font("Segoe UI", 14f) };
    private readonly Uri _server;
    private readonly bool _kiosk;
    private readonly string? _smokeTestOutput;
    private bool _allowClose;

    public bool ChangeServerRequested { get; private set; }

    public KioskForm(Uri server, bool kiosk, string? smokeTestOutput)
    {
        _server = server;
        _kiosk = kiosk;
        _smokeTestOutput = smokeTestOutput;

        Text = "Vigila";
        Icon = Theme.AppIcon;
        BackColor = Color.Black;
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        TopMost = kiosk && smokeTestOutput is null;
        KeyPreview = true;

        BuildOfflinePanel();
        Controls.Add(_web);
        Controls.Add(_offline);
        Load += async (_, _) => await InitializeAsync();
        FormClosing += OnFormClosing;
        FormClosed += (_, _) => NativeMethods.SetThreadExecutionState(NativeMethods.EsContinuous);
    }

    private async Task InitializeAsync()
    {
        NativeMethods.SetThreadExecutionState(NativeMethods.EsContinuous | NativeMethods.EsSystemRequired | NativeMethods.EsDisplayRequired);
        try
        {
            Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.AboveNormal;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException) { }

        var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vigila", "WebView2");
        // Arka planda sekme kısıtlaması ve otomatik oynatma engeli deney zamanlamasını bozmasın.
        var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding");
        CoreWebView2Environment environment;
        try
        {
            environment = await CoreWebView2Environment.CreateAsync(null, dataFolder, options);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Bu bilgisayarda Microsoft Edge WebView2 çalışma zamanı bulunamadı. Windows Update ile ya da Microsoft'un sitesinden kurup yeniden deneyin.",
                "Vigila", MessageBoxButtons.OK, MessageBoxIcon.Error);
            ExitWith(2);
            return;
        }

        await _web.EnsureCoreWebView2Async(environment);
        var core = _web.CoreWebView2;
        var s = core.Settings;
        s.AreDevToolsEnabled = false;
        s.AreDefaultContextMenusEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;

        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.NavigationCompleted += OnNavigationCompleted;
        core.DocumentTitleChanged += (_, _) => Text = core.DocumentTitle;
        _web.KeyDown += OnAcceleratorKey;

        core.Navigate(_server.ToString());
    }

    private bool IsSameOrigin(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && Uri.Compare(uri, _server, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsSameOrigin(e.Uri) || e.Uri.StartsWith("about:", StringComparison.Ordinal) || e.Uri.StartsWith("data:", StringComparison.Ordinal)) return;
        e.Cancel = true;
        OpenExternally(e.Uri);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (IsSameOrigin(e.Uri)) _web.CoreWebView2.Navigate(e.Uri);
        else OpenExternally(e.Uri);
    }

    private static void OpenExternally(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        }
        catch (System.ComponentModel.Win32Exception) { }
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (_smokeTestOutput is not null)
        {
            var root = e.IsSuccess ? await _web.CoreWebView2.ExecuteScriptAsync("document.getElementById('root') !== null") : "false";
            File.WriteAllText(_smokeTestOutput, $"basari={e.IsSuccess}\nkok={root}\nbaslik={_web.CoreWebView2.DocumentTitle}\nadres={_web.CoreWebView2.Source}\n");
            ExitWith(e.IsSuccess && root == "true" ? 0 : 1);
            return;
        }

        if (e.IsSuccess)
        {
            _offline.Visible = false;
            return;
        }
        if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
        _offlineText.Text = $"Sunucuya ulaşılamadı ({_server.Authority}).\nAğ bağlantısını ve sunucunun çalıştığını kontrol edin.";
        _offline.Visible = true;
        _offline.BringToFront();
    }

    /// <summary>Ctrl+Shift+Q: çıkış, Ctrl+Shift+S: sunucu adresini değiştir, Ctrl+Shift+R: sayfayı yeniden yükle.</summary>
    private void OnAcceleratorKey(object? sender, KeyEventArgs e)
    {
        if (!(e.Control && e.Shift)) return;
        switch (e.KeyCode)
        {
            case Keys.Q:
                e.Handled = true;
                Close();
                break;
            case Keys.S:
                e.Handled = true;
                ChangeServerRequested = true;
                _allowClose = true;
                Close();
                break;
            case Keys.R:
                e.Handled = true;
                _web.CoreWebView2?.Reload();
                break;
        }
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_allowClose || !_kiosk || _smokeTestOutput is not null) return;
        var answer = MessageBox.Show(this,
            "Vigila kapatılsın mı?\n\nSüren bir deney varsa yarıda kalır; o ana dek toplanan veriler bu cihazda saklanır ve bir sonraki açılışta gönderilir.",
            "Vigila", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) e.Cancel = true;
    }

    private void BuildOfflinePanel()
    {
        var retry = MakeButton("Yeniden dene", (_, _) =>
        {
            _offline.Visible = false;
            _web.CoreWebView2?.Navigate(_server.ToString());
        });
        var change = MakeButton("Sunucu adresini değiştir", (_, _) =>
        {
            ChangeServerRequested = true;
            _allowClose = true;
            Close();
        });
        var quit = MakeButton("Çık", (_, _) =>
        {
            _allowClose = true;
            Close();
        });
        var help = new Label { AutoSize = true, ForeColor = Theme.Mist, Text = "Kısayollar: Ctrl+Shift+R yenile, Ctrl+Shift+S sunucuyu değiştir, Ctrl+Shift+Q çık." };
        var stack = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, BackColor = Theme.Ink, Anchor = AnchorStyles.None };
        var buttons = new FlowLayoutPanel { AutoSize = true, BackColor = Theme.Ink };
        buttons.Controls.AddRange([retry, change, quit]);
        stack.Controls.AddRange([_offlineText, buttons, help]);
        foreach (Control c in stack.Controls) c.Margin = new Padding(0, 0, 0, 18);
        var center = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 1, BackColor = Theme.Ink };
        center.Controls.Add(stack);
        _offline.Controls.Add(center);
    }

    private static Button MakeButton(string text, EventHandler onClick)
    {
        var b = new Button { Text = text, AutoSize = true, Padding = new Padding(14, 6, 14, 6), FlatStyle = FlatStyle.Flat, BackColor = Theme.Paper, ForeColor = Theme.Ink, Font = new Font("Segoe UI", 10f), Margin = new Padding(0, 0, 10, 0) };
        b.FlatAppearance.BorderSize = 0;
        b.Click += onClick;
        return b;
    }

    private void ExitWith(int code)
    {
        _allowClose = true;
        Environment.ExitCode = code;
        Close();
    }
}

internal static partial class NativeMethods
{
    public const uint EsContinuous = 0x80000000;
    public const uint EsSystemRequired = 0x00000001;
    public const uint EsDisplayRequired = 0x00000002;

    [LibraryImport("kernel32.dll")]
    public static partial uint SetThreadExecutionState(uint esFlags);
}
