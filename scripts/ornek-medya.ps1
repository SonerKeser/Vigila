<#
  Vigila örnek deney paketi: 75 sn'lik ana video, 6 sn'lik yönerge videosu, dört saydam uyaran görseli ve üç kısa bip sesi.
  Gereksinim: ffmpeg (PATH'te). Görseller .NET System.Drawing ile çizilir (Windows PowerShell).
  Kullanım: powershell -File scripts/ornek-medya.ps1 -Out <klasör>
#>
param([Parameter(Mandatory)][string]$Out)
New-Item -ItemType Directory -Force $Out | Out-Null
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw "ffmpeg bulunamadı. https://ffmpeg.org adresinden kurup PATH'e ekleyin." }

function Invoke-Ffmpeg([string[]]$arguments) {
  & ffmpeg -hide_banner -loglevel error -y @arguments
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg başarısız oldu: $($arguments[-1])" }
}

$font = "C\:/Windows/Fonts/arial.ttf"
Invoke-Ffmpeg @("-f", "lavfi", "-i", "gradients=s=1280x720:c0=0x1a237e:c1=0x4a148c:c2=0x00695c:c3=0x311b92:nb_colors=4:speed=0.015:d=75:r=30",
  "-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.04:d=75", "-vf", "drawtext=fontfile='$font':text='%{pts\:hms}':fontcolor=white@0.6:fontsize=30:x=40:y=h-64",
  "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-crf", "28", "-c:a", "aac", "-b:a", "64k", "-shortest", (Join-Path $Out "ana-video.mp4"))
Invoke-Ffmpeg @("-f", "lavfi", "-i", "testsrc2=s=1280x720:d=6:r=30", "-f", "lavfi", "-i", "sine=frequency=440:d=6",
  "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-crf", "30", "-c:a", "aac", "-b:a", "48k", "-shortest", (Join-Path $Out "yonerge-videosu.mp4"))
foreach ($tone in @(@{ n = "bip-ince"; hz = 1400 }, @{ n = "bip-orta"; hz = 880 }, @{ n = "bip-kalin"; hz = 520 })) {
  Invoke-Ffmpeg @("-f", "lavfi", "-i", "sine=frequency=$($tone.hz):d=0.35", "-af", "afade=t=in:d=0.01,afade=t=out:st=0.3:d=0.05,volume=0.8", (Join-Path $Out "$($tone.n).wav"))
}

Add-Type -AssemblyName System.Drawing
function Save-Shape([string]$name, [string]$color, [string]$kind) {
  $bmp = New-Object System.Drawing.Bitmap 360, 360
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 10
  switch ($kind) {
    'circle' { $g.FillEllipse($brush, 30, 30, 300, 300); $g.DrawEllipse($pen, 30, 30, 300, 300) }
    'square' { $g.FillRectangle($brush, 50, 50, 260, 260); $g.DrawRectangle($pen, 50, 50, 260, 260) }
    'triangle' {
      $pts = [System.Drawing.Point[]]@((New-Object System.Drawing.Point 180, 25), (New-Object System.Drawing.Point 340, 320), (New-Object System.Drawing.Point 20, 320))
      $g.FillPolygon($brush, $pts); $g.DrawPolygon($pen, $pts)
    }
    'star' {
      $pts = for ($i = 0; $i -lt 10; $i++) {
        $r = if ($i % 2 -eq 0) { 165 } else { 70 }
        $a = [Math]::PI / 5 * $i - [Math]::PI / 2
        New-Object System.Drawing.Point ([int](180 + $r * [Math]::Cos($a))), ([int](185 + $r * [Math]::Sin($a)))
      }
      $g.FillPolygon($brush, [System.Drawing.Point[]]$pts); $g.DrawPolygon($pen, [System.Drawing.Point[]]$pts)
    }
  }
  $g.Dispose()
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Save-Shape "daire" "#FFB300" "circle"
Save-Shape "kare" "#00BFA5" "square"
Save-Shape "ucgen" "#FF5252" "triangle"
Save-Shape "yildiz" "#E040FB" "star"

@"
Vigila örnek deney paketi
=========================

Bu klasördeki dosyaları Vigila'nın Medya kütüphanesi sayfasına sürükleyip bırakın, ardından yeni bir deney oluşturun:

  Ana video        ana-video.mp4 (75 sn, 1280x720)
  Yönerge videosu  yonerge-videosu.mp4 (isteğe bağlı)
  Görseller        daire.png, kare.png, ucgen.png, yildiz.png (saydam PNG)
  Sesler           bip-ince.wav, bip-orta.wav, bip-kalin.wav (350 ms)

Önerilen ayarlar: sunum biçimi Karma, tekrar sayısı 2, yerleşim Dengeli çeyrek, yanıt penceresi 1800 ms, alıştırma 3 uyaran.
Bu ayarlarla her oturumda 20 uyaran sunulur ve görsel, işitsel, görsel-işitsel tepkiler karşılaştırılabilir.
"@ | Set-Content -Encoding utf8 (Join-Path $Out "BENIOKU.txt")

Get-ChildItem $Out | ForEach-Object { "{0,-22} {1,10:N0} bayt" -f $_.Name, $_.Length }
