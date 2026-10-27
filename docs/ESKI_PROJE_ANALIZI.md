# Eski "videoplayer" projesinin analizi ve değerlendirmesi

Bu belge, `videoplayer-main.zip` arşivindeki eski projenin ne yapmaya çalıştığını, nasıl kurulduğunu,
nerede bozulduğunu ve Vigila'nın bu sorunları nasıl çözdüğünü anlatır.

## 1. Proje ne yapmak istiyordu?

README tek cümle: *"Kullanıcının görsel ve işitsel uyaranlara verdiği tepkiyi ölçmek için geliştirilmektedir."*

Kodun bütününden çıkan fikir, bilişsel psikolojide yaygın bir **ikili görev / sürekli dikkat (vigilance)** düzeneğidir:

1. Katılımcı ana görev olarak bir video izler.
2. Video sırasında rastgele anlarda, ekranın rastgele yerlerinde **görsel uyaranlar** belirir ve/veya **sesler** çalınır.
3. Katılımcı uyaranı fark ettiğinde bir tuşa (`B`) basar.
4. Program hangi uyaranın, nerede, ne zaman gösterildiğini ve katılımcının ne zaman tepki verdiğini kaydeder.

Ek olarak ticari bir lisans katmanı vardı: kullanıcı adı/parola ile giriş, kalan kullanım hakkı (kredi),
dakikada bir sunucu denetimi ve kod gizleme (Obfuscar).

## 2. Mimari ve teknoloji

| Katman | Eski çözüm |
|---|---|
| Uygulama | .NET Framework 4.8, Windows Forms, tek masaüstü programı |
| Video | LibVLCSharp 3.8 (VLC yerel kütüphaneleri) |
| Ses | `MediaPlayer.MediaPlayer` (Windows Media Player COM bileşeni) |
| Görsel uyaran | Ayrı, kenarlıksız, `TopMost`, saydamlık anahtarlı ikinci bir pencere (`ImageForm`) |
| Uyaran kaynağı | Çalışma klasöründeki `Videos`, `Images`, `Audios` klasörlerinin içeriği |
| Kayıt | `Texts` klasörüne tarih adlı `.txt` uzantılı JSON |
| Lisans | ASMX SOAP servisi (`Login`, `Control`, `Update`), AES ile "şifrelenmiş" JSON |
| Koruma | Obfuscar ile isim gizleme |

Akış: `LoginForm` → servis girişi → `MainForm` açılır → ilk video yüklenip duraklatılır → araştırmacı
"Uyaranları Yerleştir" düğmesiyle plan üretir → "Oynat" ile video başlar → `B` tuşu kayda yazılır.

## 3. Bulunan hatalar

Önem: **K** kritik (yanlış veri ya da çökme), **Y** yüksek, **O** orta.

| # | Önem | Yer | Sorun |
|---|---|---|---|
| 1 | K | `MainForm.btnEmbedImages_Click` | "Görselleri ve sesleri eşleştir" seçeneğinde koşul ters yazılmış: `audioPaths.Count < y ? audioPaths[y] : null`. Eşleştirme hiç çalışmaz; sesler hep `null` olur, liste sınırı aşılınca da `ArgumentOutOfRangeException` ile program çöker. |
| 2 | K | aynı yöntem | Eşleştirme kapalı ve tekrar sayısı 1'den büyükken ilk turda listeler `RemoveAt` ile boşaltılıyor; ikinci turda `totalCount` 0, `stimulusList.Count` 0'dan büyük olduğu için `while` döngüsü **sonsuza dek döner**, arayüz donar. |
| 3 | K | tepki ölçümü | Zaman `Convert.ToInt32(e.Time / 1000.0)` ile **tam saniyeye yuvarlanıyor**. İnsan tepki süresi 200-600 ms olduğundan ölçüm bilimsel olarak kullanılamaz; tepki süresi hiç hesaplanmıyor, yalnız "saat:dakika:saniye" yazılıyor. |
| 4 | K | `MainForm_KeyDown` | Aynı uyaran sırasında ikinci kez `B`'ye basılınca `Dictionary.Add` aynı anahtarı ikinci kez eklemeye çalışır, `ArgumentException` fırlar ve program kapanır. |
| 5 | K | `logs` listesi | Her "Uyaranları Yerleştir" tıklamasında `stimulusList` temizleniyor ama `logs` temizlenmiyor. İkinci planlamadan sonra `logs[index]` eski plana ait kayda yazar; veriler karışır. |
| 6 | K | kullanım hakkı | Hak sıfır olduğunda uyarı gösteriliyor ama uyaranlar **zaten yerleştirilmiş ve kayıt dosyası yazılmış** oluyor; kontrol hiçbir şeyi engellemiyor. |
| 7 | Y | konumlama | Konum `videoView` boyutuna göre hesaplanıp `ImageForm.Location`'a (ekran koordinatı) veriliyor; görseller videonun değil ekranın sol üstüne göre yerleşiyor. Görsel videodan büyükse `Random.Next` negatif aralıkla çöker. |
| 8 | Y | `MediaPlayer_TimeChanged` | Her zaman olayında (saniyede birkaç kez) `Image.FromFile` çağrılıyor ve hiç `Dispose` edilmiyor: bellek ve dosya tutamacı sızıntısı, dosyalar kilitli kalıyor. |
| 9 | Y | aynı yöntem | Uyaran penceresindeyken her olayda `soundPlayer.Open` + `Play` yeniden çağrılıyor; ses sürekli baştan başlıyor, kekeler. |
| 10 | Y | `CheckForIllegalCrossThreadCalls = false` | VLC olayları arka plan iş parçacığından arayüzü değiştiriyor; .NET'in güvenlik denetimi kapatılarak gizlenmiş. Yarış koşulları ve rastgele çökmeler. |
| 11 | Y | süre ve aralık | `random.Next(1, showTime)` üst sınırı dahil etmez: "Gösterim süresi 1" seçilince süre hep 1 sn, 10 seçilince en fazla 9 sn. Ayar alanının adı süre ama değer rastgele. `range` 0 olursa (videonun saniyesinden çok uyaran) `Random.Next(1, 0)` çöker; uyaran listesi boşsa sıfıra bölme. |
| 12 | Y | çakışma | Uyaran bitiş saniyesi bir sonraki dilime taşabiliyor; uyaranlar üst üste binebilir, video süresini aşabilir. |
| 13 | O | dosya seçimi | `Videos` klasöründeki **ilk** dosya ana video olarak açılıyor; bilgilendirme videosu da aynı klasörde ve adında "info" geçtiği için yanlış video açılabilir. Klasördeki her dosya (ör. `Thumbs.db`) uyaran sayılıyor, görsel olmayan dosyada çöker. |
| 14 | O | durdurma | "Durdur" düğmesi sesi durdurmuyor; video bitince de ses ve görsel kapanmıyor. |
| 15 | O | açılış | Videoyu "ısıtmak" için `Thread.Sleep(100)` ile oynat-duraklat ve görsel penceresini göster-gizle hilesi. |
| 16 | O | lisans döngüsü | `Control()` hata alırsa arka plandaki görev sessizce ölür (denetim durur); yanıt "OK" değilse `Environment.Exit(0)` **deneyin ortasında** kayıt yazılmadan programı kapatır. |
| 17 | O | ölü kod | `CountDownTimer` hiç kullanılmıyor; `BasicDefinations`, `IsRunnign` gibi yazım hataları. |

## 4. Güvenlik değerlendirmesi

- **AES anahtarı ve IV kodun içinde sabit** (`Crypto.cs`). IV her mesajda aynı. Obfuscar bunu gizlemez; derlenmiş dosyadan dakikalar içinde okunur. Bu "şifreleme" HTTPS'in üzerine hiçbir şey katmıyor.
- **Servis parolası (`passKey`) istemcide sabit.** Programı açan herkes servisi doğrudan çağırabilir.
- **Kullanım hakkını istemci bildiriyor.** `Update` çağrısı kalan ve toplam hakkı istemciden alıyor; değiştirilmiş bir istemci sınırsız hak yazabilir. `-1071` "sihirli sayısı" sınırsız anlamına geliyor.
- Sunucu yanıtı doğrudan `MessageBox.Show(result)` ile gösteriliyor.
- Gizleme (Korece isimler, string gizleme) bir güvenlik önlemi değil; asıl doğrulama sunucuda olmadığı sürece aşılabilir.

## 5. Bilimsel geçerlilik değerlendirmesi

Eski program bir tepki süresi deneyi için gerekli temel ölçümleri yapamıyordu:

- Tepki süresi yok; yalnız saniye düzeyinde "basış anı" var.
- Kaçırılan uyaranlar (miss), uyaran yokken basışlar (yanlış alarm), erken basışlar kaydedilmiyor.
- Görselin ekranda gerçekten ne zaman belirdiği bilinmiyor (ayrı pencere, `TopMost`, VLC olay gecikmesi).
- Sesin ne zaman çaldığı bilinmiyor (COM oynatıcı, her olayda yeniden başlatma).
- Rastgelelik tohumlanmadığı için hiçbir plan yeniden üretilemiyor; aynı plan iki katılımcıya verilemiyor.
- Kayıtta katılımcı kimliği, cihaz bilgisi, deney ayarları yok; analiz için elle temizlenmesi gerekiyor.

## 6. Korunmaya değer olanlar

Fikir sağlam ve araştırma değeri yüksek: doğal bir görev (video izleme) sırasında periferik görsel ve
işitsel uyaranlara tepkiyi ölçmek; görsel ile sesi eşleştirerek çok duyulu etkiyi incelemek; bir kredi modeliyle
platformu birden çok araştırmacıya açmak. Vigila bu fikri olduğu gibi korur ve doğru biçimde uygular.

## 7. Vigila'daki karşılıkları

| Eski sorun | Vigila'daki çözüm |
|---|---|
| Saniye çözünürlüğü | Tüm zamanlar `performance.now()` tabanında, milisaniyenin altında. Görsel başlangıcı `requestVideoFrameCallback`'in `expectedDisplayTime` değeri, ses başlangıcı Web Audio `getOutputTimestamp` ile; tuş anı `KeyboardEvent.timeStamp`. |
| Ayrı pencerede görsel | Görseller videonun gerçek görüntü alanına (letterbox hesaplı) yerleşen katmanda; konumlar video karesine göre oranlı (0-1). |
| Eşleştirme hatası, sonsuz döngü, çakışma | `ScheduleGenerator`: tekrarlar blok halinde karıştırılır, başlangıçlar Dirichlet dağılımıyla yerleştirilir; uyaranlar ve yanıt pencereleri asla çakışmaz. 11 birim testi bu kuralları 50 tohumla sınar. |
| Tohum yok | xoshiro128** üreteci; her oturumun tohumu saklanır, istenirse herkese aynı plan. |
| Eksik ölçütler | İsabet, kaçırma, erken basış, yanlış alarm, fazladan yanıt; kanal ve ekran çeyreği bazında ortalama/ortanca/SS; çok duyulu kazanç; zamanlama kalite göstergeleri. |
| İstemcinin bildirdiği kredi | Kredi sunucuda tek bir atomik SQL güncellemesiyle düşülür; istemci sayıyı göremez ve değiştiremez. |
| Sabit anahtar/IV, gizleme | PBKDF2-SHA512 parola özeti, HttpOnly + SameSite=Strict çerez, güvenlik damgası, oturum başına rastgele anahtar, HMAC imzalı medya adresleri, dosya imzası denetimi, hız sınırlama, CSP. |
| Deney ortasında kapanma | Kesintiler (duraklatma, sekme değişimi, tam ekrandan çıkış, video takılması) kaydedilir; sonuçlar gönderilemezse cihazda saklanıp sonra gönderilir. |
| Dağınık kayıt | Uzun biçimli CSV (R, SPSS, Python için) ve ham JSON; katılımcı kodu, tohum, cihaz bilgisi dahil. |
