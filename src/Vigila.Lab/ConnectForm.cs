namespace Vigila.Lab;

/// <summary>İlk açılışta (ya da adres değiştirilirken) Vigila sunucusunun adresini sorar ve bağlantıyı dener.</summary>
public sealed class ConnectForm : Form
{
    private readonly TextBox _address = new() { Width = 360, Font = new Font("Segoe UI", 11f) };
    private readonly CheckBox _kiosk = new() { Text = "Kiosk kipi (her zaman üstte, kapatırken onay iste)", AutoSize = true, ForeColor = Theme.Mist };
    private readonly Label _status = new() { AutoSize = true, ForeColor = Theme.Mist, MaximumSize = new Size(380, 0) };
    private readonly Button _connect = new() { Text = "Bağlan", Width = 120, Height = 36 };

    public Uri? Server { get; private set; }
    public bool Kiosk => _kiosk.Checked;

    public ConnectForm(LabSettings settings)
    {
        Text = "Vigila Laboratuvar İstemcisi";
        Icon = Theme.AppIcon;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        BackColor = Theme.Ink;
        ForeColor = Theme.Paper;
        Font = new Font("Segoe UI", 10f);
        ClientSize = new Size(440, 280);
        Padding = new Padding(28);

        var title = new Label { Text = "Sunucuya bağlanın", Font = new Font("Segoe UI Semibold", 16f), AutoSize = true };
        var hint = new Label
        {
            Text = "Vigila sunucusunun adresini yazın. Örnek: http://lab-sunucu:5317",
            AutoSize = true,
            ForeColor = Theme.Mist,
            MaximumSize = new Size(380, 0),
        };
        _address.Text = settings.ServerUrl ?? "http://localhost:5317";
        _kiosk.Checked = settings.Kiosk;
        _connect.FlatStyle = FlatStyle.Flat;
        _connect.BackColor = Theme.Paper;
        _connect.ForeColor = Theme.Ink;
        _connect.FlatAppearance.BorderSize = 0;
        _connect.Click += async (_, _) => await ConnectAsync();
        AcceptButton = _connect;

        var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Theme.Ink };
        layout.Controls.AddRange([title, hint, _address, _kiosk, _connect, _status]);
        foreach (Control c in layout.Controls) c.Margin = new Padding(0, 0, 0, 12);
        Controls.Add(layout);
    }

    private async Task ConnectAsync()
    {
        var uri = LabSettings.Normalize(_address.Text);
        if (uri is null)
        {
            _status.Text = "Adres geçerli değil. http:// ya da https:// ile başlayan bir adres yazın.";
            return;
        }

        _connect.Enabled = false;
        _status.Text = "Bağlantı deneniyor…";
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var response = await http.GetAsync(new Uri(uri, "/api/health"));
            if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Sunucu {(int)response.StatusCode} döndürdü.");
            Server = uri;
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _status.Text = $"Sunucuya ulaşılamadı: {ex.Message} Adresi ve ağ bağlantısını kontrol edin.";
        }
        finally
        {
            _connect.Enabled = true;
        }
    }
}
