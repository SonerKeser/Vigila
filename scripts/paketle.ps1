<#
  Vigila sürüm paketlerini üretir:
    vigila-sunucu-win-x64.zip        Kendi kendine yeten Windows sunucusu (.NET kurulumu gerekmez)
    vigila-sunucu-linux-x64.tar.gz   Kendi kendine yeten Linux sunucusu
    VigilaLab-win-x64.exe            Laboratuvar masaüstü istemcisi (tek dosya)
    vigila-ornek-deney-paketi.zip    Örnek video, görsel ve sesler
    SHA256SUMS.txt                   Doğrulama özetleri
  Kullanım: powershell -File scripts/paketle.ps1 [-Out artifacts]
#>
param([string]$Out = "artifacts")
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }
$work = Join-Path $out "_is"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $work | Out-Null

function Run([string]$file, [string[]]$arguments, [string]$dir = $root) {
  Push-Location $dir
  try {
    & $file @arguments
    if ($LASTEXITCODE -ne 0) { throw "$file $($arguments -join ' ') başarısız oldu ($LASTEXITCODE)." }
  } finally { Pop-Location }
}

Write-Host "Arayüz derleniyor"
Run "npm" @("ci", "--no-audit", "--no-fund") (Join-Path $root "src\Vigila.Web")
Run "npm" @("run", "build") (Join-Path $root "src\Vigila.Web")

$readme = @"
Vigila sunucusu
===============

Başlatmak için:
  Windows : Vigila-Baslat.cmd dosyasını çift tıklayın
  Linux   : sh vigila.sh

Ardından tarayıcıda http://localhost:5317 adresini açın. İlk açılışta kurulum ekranı gelir; ilk hesap yönetici olur.
Başka bir adres ya da port için: Vigila.Api --urls http://0.0.0.0:8080

Veriler (veritabanı, yüklenen medya, anahtarlar) App_Data klasöründe tutulur. Başka bir yerde tutmak için
Vigila__DataPath ortam değişkenini verin. Yönetici, Kullanıcılar sayfasından tam yedek indirebilir.

Ayrıntılar: https://github.com/SonerKeser/Vigila
"@

foreach ($rid in "win-x64", "linux-x64") {
  Write-Host "Sunucu yayımlanıyor: $rid"
  $dir = Join-Path $work "vigila-sunucu-$rid"
  Run "dotnet" @("publish", "src/Vigila.Api", "-c", "Release", "-r", $rid, "--self-contained", "true", "-p:SkipWebBuild=true", "-p:DebugType=none", "-o", $dir)
  $readme | Set-Content -Encoding utf8 (Join-Path $dir "BENIOKU.txt")
  if ($rid -eq "win-x64") {
    "@echo off`r`ncd /d %~dp0`r`nstart `"`" http://localhost:5317`r`nVigila.Api.exe --urls http://0.0.0.0:5317`r`n" | Set-Content -Encoding ascii (Join-Path $dir "Vigila-Baslat.cmd")
    Compress-Archive -Path "$dir\*" -DestinationPath (Join-Path $out "vigila-sunucu-win-x64.zip") -CompressionLevel Optimal
  } else {
    "#!/bin/sh`ncd `"`$(dirname `"`$0`")`"`nchmod +x ./Vigila.Api`nexec ./Vigila.Api --urls http://0.0.0.0:5317 `"`$@`"`n" | Set-Content -NoNewline -Encoding ascii (Join-Path $dir "vigila.sh")
    Run "tar" @("-czf", (Join-Path $out "vigila-sunucu-linux-x64.tar.gz"), "-C", $work, "vigila-sunucu-$rid")
  }
}

Write-Host "Laboratuvar istemcisi yayımlanıyor"
$lab = Join-Path $work "lab"
Run "dotnet" @("publish", "src/Vigila.Lab", "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-p:PublishSingleFile=true", "-p:EnableCompressionInSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true", "-p:DebugType=none", "-o", $lab)
Copy-Item (Join-Path $lab "VigilaLab.exe") (Join-Path $out "VigilaLab-win-x64.exe")

Write-Host "Örnek deney paketi hazırlanıyor"
$samples = Join-Path $work "ornek"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "ornek-medya.ps1") -Out $samples | Out-Null
Compress-Archive -Path "$samples\*" -DestinationPath (Join-Path $out "vigila-ornek-deney-paketi.zip") -CompressionLevel Optimal

Remove-Item $work -Recurse -Force
Get-ChildItem $out -File | Where-Object Name -ne "SHA256SUMS.txt" | ForEach-Object {
  "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
} | Set-Content -Encoding ascii (Join-Path $out "SHA256SUMS.txt")

Get-ChildItem $out -File | ForEach-Object { "{0,-34} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB) }
