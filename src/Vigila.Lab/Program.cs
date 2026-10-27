namespace Vigila.Lab;

/// <summary>
/// Vigila Laboratuvar İstemcisi.
/// Kullanım: VigilaLab.exe [--sunucu http://adres:5317] [--pencere] [--duman-testi cikti.txt]
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        string? Arg(string name) => Array.IndexOf(args, name) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        var settings = LabSettings.Load();
        var smokeTest = Arg("--duman-testi");
        var server = LabSettings.Normalize(Arg("--sunucu")) ?? LabSettings.Normalize(settings.ServerUrl);
        bool kiosk = settings.Kiosk && !args.Contains("--pencere");

        while (true)
        {
            if (server is null)
            {
                if (smokeTest is not null) return 3;
                using var connect = new ConnectForm(settings);
                if (connect.ShowDialog() != DialogResult.OK || connect.Server is null) return 0;
                server = connect.Server;
                settings.ServerUrl = server.ToString();
                settings.Kiosk = connect.Kiosk;
                kiosk = connect.Kiosk;
                settings.Save();
            }

            using var form = new KioskForm(server, kiosk, smokeTest);
            Application.Run(form);
            if (!form.ChangeServerRequested) return Environment.ExitCode;
            server = null;
        }
    }
}
