# Vigila

Video tabanlı **uyaran-tepki deneyleri** için açık kaynaklı platform. Katılımcı bir video izlerken ekranın farklı yerlerinde
görseller belirir ya da sesler çalınır; katılımcı fark ettiği anda yanıt verir. Vigila uyaranları planlar, deneyi tarayıcıda
milisaniye hassasiyetiyle yürütür ve sonuçları oturum biter bitmez analiz eder.

**Ön sayfa ve indirmeler:** https://sonerkeser.github.io/Vigila/

Eski WinForms "videoplayer" projesinin sıfırdan yeniden yazımıdır; eski projenin analizi:
[docs/ESKI_PROJE_ANALIZI.md](docs/ESKI_PROJE_ANALIZI.md).

## Bileşenler ve indirme

| Bileşen | Ne işe yarar | Dosya |
|---|---|---|
| Sunucu (Windows) | Deney tasarımı, katılım bağlantıları, veri toplama ve analiz. .NET kurulumu gerektirmez. | `vigila-sunucu-win-x64.zip` |
| Sunucu (Linux) | Aynı sunucu; `sh vigila.sh` ile başlar. | `vigila-sunucu-linux-x64.tar.gz` |
| Laboratuvar istemcisi | Laboratuvar bilgisayarında Vigila'yı tarayıcı çubuğu olmadan, kesintisiz tam ekran açan kiosk uygulaması (WebView2). | `VigilaLab-win-x64.exe` |
| Örnek deney paketi | Hemen denemek için video, görsel ve sesler. | `vigila-ornek-deney-paketi.zip` |

Hepsi [Sürümler](https://github.com/SonerKeser/Vigila/releases/latest) sayfasında, SHA-256 özetleriyle birlikte. Katılımcıların
bir şey indirmesi gerekmez; bağlantıyı tarayıcıda açmaları yeterlidir.

## Neler yapılabilir

**Araştırma akışı.** Onam metni ve katılımcı formu (yaş, el tercihi, görme gibi hazır sorular ya da özel metin, sayı, seçmeli, ölçek
soruları), geri bildirimli alıştırma bloğu, klavye ya da dokunma/fareyle yanıt, Türkçe ve İngilizce katılımcı ekranları, yönerge videosu,
cihaz uygunluk denetimi (klavye gerektiren deneyde yalnız dokunmatik cihazları engelleme).

**Planlama.** Ayrı, eşleşik ya da karma görsel-işitsel sunum; rastgele, dengeli çeyrek ya da orta yerleşim; gösterim süresi aralığı,
yanıt penceresi, uyaranlar arası en kısa ara, başlangıç ve bitiş boşluğu; tohumla yeniden üretilebilir plan. Her değişiklikte plan
sunucuda yeniden üretilir, **konum haritası** ve **zaman çizelgesinde** canlı gösterilir; **canlı önizleme** katılımcının göreceğinin
aynısını oynatır.

**Analiz.** İsabet, kaçırma, erken basış, yanlış alarm; ortalama, ortanca, standart sapma ve ±2,5 SS ayıklanmış ortalama; sinyal algılama
ölçütleri d′ ve c (log-doğrusal düzeltmeli); ters etkinlik puanı; kanal ve ekran çeyreği kırılımı; çok duyulu kazanç; tekrar bloklarına
göre performans (dikkat düşüşü); deney düzeyinde kanallar arası **eşleştirilmiş t-testi** ve Cohen dz; oturumu yeniden izleme.

**Çevrim içi katılım.** Hesap gerektirmeyen bağlantı; katılımcı sınırı ve son tarih; aynı tarayıcıdan ya da aynı kodla tekrar katılım
engeli; adresten katılımcı kodu (`?kod=`, `?pid=`); bitişte anket ya da katılımcı havuzu platformuna yönlendirme (`{kod}` yer tutucusu);
gönderilemeyen sonucun cihazda saklanıp sonra gönderilmesi.

**İşletim.** Canlı oturum izleme; sunucuda atomik olarak düşülen oturum kredileri; roller ve hesap yönetimi; veritabanı, medya ve
anahtarları içeren tam yedek; laboratuvar kiosk istemcisi.

## Ölçüm yöntemi

Tepki süresi ağdan, sunucudan ve React çiziminden bağımsız olarak katılımcının tarayıcısında, tek bir saatle (`performance.now()`) ölçülür:

- **Görsel başlangıcı:** uyaran `requestVideoFrameCallback` içinde görünür yapılır; kaydedilen zaman o video karesinin ekranda görüneceği
  an olan `expectedDisplayTime`'dır.
- **Ses başlangıcı:** sesler önceden `AudioBuffer`'a çözülür. Motor video kare süresini ölçer ve her sesi, görselin belireceği karenin
  ekrana geleceği anda hoparlörden çıkacak biçimde **önceden zamanlar**; ses kartının çıkış gecikmesi `getOutputTimestamp()` ile telafi edilir.
- **Yanıt:** `KeyboardEvent.timeStamp` ya da `PointerEvent.timeStamp`. Basılı tutulan tuşun tekrarları sayılmaz.
- **Eşleştirme:** bir basış, başlangıcı basıştan önceki en son uyarana, yanıt penceresi içindeyse atanır; ilk basış tepki süresidir,
  sonrakiler fazladan yanıttır, hiçbir pencereye düşmeyen basış yanlış alarmdır. Eşikten kısa tepkiler erken basış sayılır.
- **Kalite:** her oturumda ekran yenileme hızı, ses çıkış gecikmesi, plandan sapma ve görsel-ses eşzamanlılığı kaydedilir; sapma yüksekse
  sonuç ekranı uyarır. Sekme değişimi, tam ekrandan çıkma, duraklatma ve video takılması kesinti olarak kayda geçer.

**Doğrulama.** Başsız Microsoft Edge'de, uyaranı sayfadan ve ses çıkışından algılayıp bilinen gecikmeyle yanıt veren üç sanal katılımcıyla
(60 deneme, 30 kare/sn video) ölçülen tepki ile gerçek tepki arasındaki fark: görselde −0,9 ± 4,5 ms, görsel-işitselde −2,0 ± 3,7 ms;
görsel-işitsel uyaranlarda sesle görüntü arasındaki ortalama fark 1 ms'nin altında; plandan sapma en fazla bir video karesi.

Planlama (`ScheduleGenerator`): her tekrar havuzdaki her uyaranı bir kez içeren karışık bir bloktur. Sığma kontrolü en kötü duruma göre
yapılır; artan süre boşluklara Dirichlet(1, …, 1) ağırlıklarıyla dağıtılır, böylece geçerli yerleşimlerin hepsi eşit olasılıklıdır.

## Mimari

```
┌──────────────────────────── Tarayıcı ────────────────────────────┐
│ React 19 + TypeScript + Vite                                      │
│  ├─ Araştırmacı paneli (React Router, TanStack Query, Motion)     │
│  └─ Deney yürütücüsü: TrialEngine, PracticeEngine                 │
│       requestVideoFrameCallback · Web Audio · Klavye/Dokunma      │
└───────────────▲───────────────────────────────▲──────────────────┘
                │ JSON (çerez kimliği)          │ imzalı medya adresi
┌───────────────┴───────────────────────────────┴──────────────────┐
│ ASP.NET Core (.NET 10) Minimal API: Vigila.Api                    │
│        ├─ Vigila.Core: planlayıcı, puanlayıcı, istatistik         │
│        └─ EF Core 10 + SQLite + dosya deposu                      │
└──────────────────────────────────────────────────────────────────┘
        ▲
        │ WebView2 (tam ekran, kiosk)
┌───────┴───────────┐
│ Vigila.Lab        │  Laboratuvar istemcisi (WinForms)
└───────────────────┘
```

| Proje | Görev |
|---|---|
| `src/Vigila.Core` | Saf alan mantığı: ayarlar, tohumlanabilir üreteç (xoshiro128**), uyaran ve alıştırma planlayıcı, puanlayıcı, istatistik (ters normal, t dağılımı, eşleştirilmiş t-testi, sinyal algılama). |
| `src/Vigila.Api` | HTTP API, kimlik doğrulama, veritabanı, medya deposu, canlı izleme, yedek; üretimde arayüzü `wwwroot`'tan sunar. |
| `src/Vigila.Web` | Araştırmacı paneli ve katılımcı yürütücüsü. `npm run build` çıktısı `Vigila.Api/wwwroot`'a yazılır. |
| `src/Vigila.Lab` | Laboratuvar kiosk istemcisi: çubuksuz tam ekran, yenileme/geri/geliştirici araçları kapalı, ekran uykusu engelli, yalnız sunucu adresleri. |
| `tests/Vigila.Tests` | xUnit: planlayıcı, puanlayıcı, istatistik ve uçtan uca API testleri. |
| `site` | GitHub Pages ön sayfası. |
| `scripts` | Sürüm paketleme ve örnek medya üretimi. |

## Geliştirme

Gereksinimler: .NET 10 SDK, Node.js 22+ (paketleme için ayrıca ffmpeg).

```bash
cd src/Vigila.Web
npm install
npm run build
```

```bash
dotnet run --project src/Vigila.Api --launch-profile http
```

Tarayıcıda `http://localhost:5317` adresini açın; ilk açılışta kurulum ekranı gelir ve ilk hesap yönetici olur. Arayüzü anlık yenilemeyle
geliştirmek için API açıkken `src/Vigila.Web` içinde `npm run dev` çalıştırın (Vite `http://localhost:5173`).

Laboratuvar istemcisi:

```bash
dotnet run --project src/Vigila.Lab -- --sunucu http://localhost:5317 --pencere
```

İstemci kısayolları: `Ctrl+Shift+R` yenile, `Ctrl+Shift+S` sunucu adresini değiştir, `Ctrl+Shift+Q` çık.

### Testler

```bash
dotnet test
```

```bash
cd src/Vigila.Web
npm test
```

### Sürüm paketleri

```powershell
powershell -File scripts/paketle.ps1
```

`artifacts/` klasörüne Windows ve Linux sunucusu (kendi kendine yeten), tek dosyalık laboratuvar istemcisi, örnek deney paketi ve
`SHA256SUMS.txt` yazılır.

### Yapılandırma (`appsettings.json` ya da ortam değişkenleri)

| Anahtar | Varsayılan | Açıklama |
|---|---|---|
| `ConnectionStrings:Default` | boş | Boşsa `DataPath/vigila.db` kullanılır. |
| `Vigila:DataPath` | `App_Data` | Veritabanı, medya dosyaları, veri koruma anahtarları ve medya imza anahtarı. Yedeklenmesi gereken tek klasör. |
| `Vigila:MaxUploadMb` | `2048` | Tek dosya için en büyük yükleme. |
| `Vigila:MediaUrlLifetimeHours` | `12` | İmzalı medya adreslerinin geçerlilik süresi. |
| `Vigila:PasswordIterations` | `210000` | PBKDF2-SHA512 yineleme sayısı. |
| `Vigila:LoginPermitPerMinute` | `10` | IP başına dakikada giriş denemesi. |
| `Vigila:PublicPermitPerMinute` | `300` | Katılımcı uçları için IP başına dakikada istek. |

Ortam değişkeni örneği: `Vigila__DataPath=D:\VigilaVeri`. Üretimde uygulamayı HTTPS arkasında yayınlayın; çerezler HTTPS'te otomatik
olarak `Secure` olur.

## Güvenlik

- Parolalar PBKDF2-SHA512 ile saklanır; kimlik çerezi HttpOnly ve SameSite=Strict'tir. Parola ya da rol değişince, hesap kapatılınca
  güvenlik damgası yenilenir ve eski çerezler bir sonraki istekte geçersizleşir.
- Oturum kredisi sunucuda tek bir atomik `UPDATE … WHERE CreditsRemaining > 0` ile düşülür; istemci sayıyı göremez ve değiştiremez.
- Katılımcı oturumu yalnız oturuma özel rastgele bir anahtarla (sunucuda SHA-256 özeti) tamamlanabilir.
- Medya HMAC-SHA256 imzalı, süreli adreslerle sunulur; yüklenen dosyanın türü uzantı ve dosya imzasıyla birlikte denetlenir.
- Giriş ve katılımcı uçlarında hız sınırı; CSP ve güvenlik başlıkları; CSV'de formül enjeksiyonuna karşı kaçış.

## Dışa aktarılan veri

**Deneme verisi** (her satır bir deneme): `experiment`, `session_id`, `participant`, `origin`, `status`, `started_utc`, `seed`, `trial`,
`block`, `kind` (`visual`, `auditory`, `audiovisual`), `image`, `audio`, `planned_onset_ms`, `duration_ms`, `quadrant` (0 sol üst, 1 sağ üst,
2 sol alt, 3 sağ alt), `box_x`, `box_y`, `box_w`, `box_h`, `outcome` (`hit`, `miss`, `anticipation`, `not_presented`), `rt_ms`,
`extra_responses`, `onset_lag_ms`, `av_async_ms`, `interrupted`.

**Oturum özetleri** (her satır bir oturum): sayımlar, isabet oranı, tepki süresi istatistikleri, `trimmed_mean_rt`, `ies`, `false_alarm_rate`,
`d_prime`, `criterion`, kanal kırılımı, alıştırma sonucu, zamanlama kalitesi, cihaz bilgisi ve her anket sorusu için bir `q_<kimlik>` sütunu.

## Lisans

[MIT](LICENSE)
