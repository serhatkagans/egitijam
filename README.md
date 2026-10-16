# EğitiJAM — Oyun Vitrini ve Jüri Platformu

EğitiJAM K12 oyun geliştirme maratonu için kendi platformumuz. Öğrenci takımları oyunlarını
burada sergiler, ziyaretçiler giriş yapmadan inceleyip tarayıcıda oynar, jüri kriterlere göre
puanlar. Fiyatlandırma yoktur. Geçmiş yılların itch.io jam'leri arşiv olarak içe aktarılabilir.

Bağımlılık yok: Node.js 22.13+ yeterli (veritabanı Node'un yerleşik SQLite modülü).
Yapı ve görsel dil `../jürigenctek` uygulamasıyla aynıdır (GençTek kırmızısı, Tema D).

## Çalıştırma

| Dosya | Ne yapar |
|---|---|
| `baslat.bat` | Sunucuyu açar. İlk çalıştırmada `.env` dosyasını oluşturur ve yönetici şifresini sorar. |
| `durdur.bat` | `.env`'deki porttaki (varsayılan 3100) sunucuyu kapatır. Başka programlara dokunmaz. |
| `ornek-yukle.bat` | Vitrini denemek için 7 örnek takım (3'ü tarayıcıda oynanır), rozetler, 2 örnek mentör ve yazışmalar, itch.io'dan 2024–2025 arşivini ekler. Mentörlerin giriş bilgilerini ekrana yazar. Sunucu açık olmalı. Tekrar çalıştırılabilir. |
| `ornek-sil.bat` | Örnek takımları ve mentörleri siler (kullanıcı adı `ornek1` …, `ornekmentor1` …). Gerçek kayıtlara dokunmaz. Arşiv kalır; Yönetim → Geçmiş yıllar'dan silinir. |

`ornek-yukle.bat` "Sonuçlar açıklandı" anahtarını da açar; gerçek etkinliğe geçmeden önce
`ornek-sil.bat` çalıştırıp Yönetim → Genel bakış'tan bu anahtarı kapatın.
Örnek oyunların kaynakları `ornek/oyunlar/` klasöründedir.

| Adres | Kim | Ne |
|---|---|---|
| `http://localhost:3100/` | Herkes | Vitrin: bu yılın oyunları, geçmiş yıllar, etkinlik ve kurallar |
| `http://localhost:3100/oyun/<kullanıcıadı>` | Herkes | Oyun sayfası: tarayıcıda oyna, indir, video, ekran görüntüleri, ekip |
| `http://localhost:3100/takim` | Takımlar | Kendi oyun sayfasını düzenleme, dosya yükleme, mentörlerle mesajlaşma |
| `http://localhost:3100/mentor` | Mentörler | Takımlarını takip etme, sayfalarını düzenleme, mesajlaşma |
| `http://localhost:3100/juri` | Jüri | Oyunları inceleme ve puanlama |
| `http://localhost:3100/yonetim` | Yönetici | Her şey |

## Etkinlik akışı

1. **Yönetim → Takımlar → Toplu ekle.** Excel'den "Takım adı, İl, Okul, Danışman" sütunlarını
   yapıştırın. Kullanıcı adları ve şifreler üretilir. Şifreler **yalnızca bir kez** gösterilir;
   CSV olarak indirip danışman öğretmenlere iletin. Kaybolan şifre "Şifre sıfırla" ile yenilenir.
   CSV'de her takımın **öğrenci katılım kodu** da vardır.
   **Mentör atayın:** Her mentörün tek takımı, her takımın tek mentörü olur. Yönetim → Mentörler'de mentörün takımını seçin (başka mentörü olan takım seçilirse o mentör takımsız kalır). Takımı olmayan mentör, mentör panelinden **Takımını kur** ile kendi takımını da kurabilir. Takımlar tablosunda mentörü
   olmayan takım "Mentör atanmadı" diye işaretlenir ("Mentörü atanmamış" süzgeci ile listelenir).
   Takım panelinde "Mentörünüz" kartı, mentör panelinde "Takımım" sayfası atamayı gösterir.
2. **Öğrenciler takımda toplanır** (`/takim`): her öğrenci "Kayıt ol" ile kendi hesabını açar.
   Bir öğrenci takımı kurar (kaptan olur) ya da yönetimin/mentörün açtığı takımın kodunu girer;
   diğerleri aynı **katılım koduyla** (ör. `K7M-Q2X`) katılır. Takım başına en fazla 5 öğrenci.
   Kod, takım panelindeki **Ekip** kartında görünür; `/takim?kod=K7MQ2X` bağlantısı kodu hazır doldurur.
   Kaptan, mentör ve yönetim ekipten öğrenci çıkarabilir, kaptanlığı devredebilir, kodu yenileyebilir;
   unutulan öğrenci şifresini mentör ya da yönetim sıfırlar. Yönetim → Takımlar → **Öğrenciler**
   tablosunda tüm hesaplar görünür; öğrenci koda gerek olmadan takıma konabilir. "Öğrenciler hesap
   açabilir" ve "Öğrenciler takım kurabilir" anahtarları kayıtları ve takım kurmayı kapatır.
   Teslim kapanınca ekip değiştirilemez. Takımın ortak kullanıcı adı ve şifresi de çalışmaya devam eder.
3. **Takımlar sayfalarını hazırlar** (`/takim`): oyun adı, kısa tanıtım, kapak, web sürümü (ZIP),
   indirilebilir sürüm, tanıtım metni, ekip ve görevleri, ekran görüntüleri, oynanış videosu
   (YouTube), hazır içerik/YZ beyanı. Sağdaki kontrol listesi kurallardaki zorunlu içeriği gösterir.
   Oyun adı girilen sayfa vitrinde görünür.
4. **Yönetim → Genel bakış → Teslim açık** kapatılınca sayfalar kilitlenir. Yönetici,
   Takımlar tablosundaki kalem simgesiyle her takımın sayfasını yine düzenleyebilir.
5. **Jüriler** eklenir (Yönetim → Jüriler), **Oylama açık** yapılır. Jüriler `/juri`'de her
   kritere 0–azami arası puan verir, isterse not düşer. Notları yalnızca jüri ve yönetici görür.
6. **Sonuçlar** sekmesinde sıralama, kriter ortalamaları ve jüri ayrıntısı görünür; XLSX indirilir.
   "Rozet" sütununa "1.", "Jüri Özel Ödülü", "Sergilenmeye Değer" gibi ödüller yazılır.
7. **Sonuçlar açıklandı** açılınca rozetler vitrinde "Ödül alan oyunlar" bölümünde ve kartlarda
   görünür. Puanlar hiçbir zaman herkese açık olmaz.

- **Tema açıklama anı:** Genel bakış'taki **Tema başlangıçta açıklansın** açıksa (varsayılan),
  tema Etkinlik sekmesindeki başlangıç anına kadar vitrinde "? ? ?" olarak görünür, takım,
  mentör ve jüri panellerine de gitmez; o an vitrin kendiliğinden yenilenip temayı gösterir.
  Başlangıç zamanı girilmemişse tema hep görünür. Yönetim temayı her zaman görür.
- **Jüri geri bildirimi:** Jüriler puanlarken özel notun yanında isteğe bağlı **Takıma geri
  bildirim** yazar. Genel bakış'taki **Jüri geri bildirimleri takımlara açık** anahtarı açılınca
  takım panelinde "Jüriden geri bildirimler" kartı çıkar (jüri adı ve puan gösterilmez).
  Jürilerin özel notları hiçbir zaman takıma gitmez.
- **Katılım belgesi:** Teslim kapanınca takım panelinde **Katılım belgeleri** düğmesi çıkar.
  Ekip bölümündeki her üye ve danışman öğretmen için A4 yatay bir belge hazırlanır (ad, takım,
  görev, oyun adı, tema; ödül varsa rozet). "Yazdır / PDF olarak kaydet" ile PDF alınır.
  Yönetici ya da mentör takımın sayfasını açıp aynı düğmeyle belgeleri alabilir.

Uygunsuz içerikli bir sayfa Takımlar tablosundaki **Vitrinde** anahtarıyla anında kaldırılır.

## Mentörler ve mesajlaşma

Discord yerine platformun kendi mesajlaşması kullanılır (takım, mentör, jüri ve yönetim panellerinde "Mesajlar"). Jüriler duyuruları okur ama tarafsızlık için takım kanallarını ve mentör odasını görmez; takımlar ve mentörler de jüri kanallarını görmez. Kanallar:

| Kanal | Kim okur | Kim yazar |
|---|---|---|
| Duyurular | Herkes (takımlar, mentörler, yönetim) | Yönetim ve mentörler |
| Genel sohbet | Takımlar, mentörler, yönetim (jüriler göremez) | Aynı. Yönetim → Mesajlar'daki anahtarla kapatılırsa yalnızca yönetim |
| Mentör odası | Mentörler ve yönetim | Mentörler ve yönetim |
| Her takımın kendi kanalı | O takım, tüm mentörler, yönetim | Aynı |
| Jüri odası | Tüm jüriler ve yönetim | Aynı |
| Oda kanalı (jüri odaları varsa) | O odanın jürileri ve yönetim | Aynı |

- **Yönetim → Mentörler**'den mentör eklenir (tek tek ya da "Ad Soyad; Uzmanlık" satırlarıyla toplu).
  Şifreler takımlardaki gibi yalnızca bir kez gösterilir. Düzenle penceresinden takımlar atanır.
- Mentör, kendisine **atanan** takımların sayfasını düzenleyebilir, ilerlemesini (kontrol listesi)
  görür ve şifresini sıfırlayabilir. Teslim kapanınca mentör de düzenleyemez (yönetici düzenler).
- Atanmamış takımların kanallarını da tüm mentörler görür ve yanıtlar; böylece yardım isteyen
  takım, kendi mentörü çevrimdışıyken de yanıt alır.
- Takım mesaj yazarken **Yardım istiyorum** kutusunu işaretlerse kanal mentörlerin listesinde
  "Yardım bekleyenler" grubuna çıkar; bir mentör ya da yönetim yanıt verince oradan düşer.
- Okunmamış mesaj sayısı üst menüde ve sekme başlığında görünür. Yeni mesajlar birkaç saniyede
  bir kendiliğinden gelir.
- **Mentörler kendi takımını kurabilir** anahtarı açıksa (varsayılan; Yönetim → Mentörler) takımı olmayan mentör
  panelinden tek takımını kurar; takım otomatik olarak ona atanır.
- Herkes kendi mesajını, yönetici tüm mesajları silebilir.

Discord'daki gibi kullanım:

- Mesajın üzerine gelince araç çubuğu açılır: hızlı tepki (👍 ❤️ 😂), emoji tepkisi, **Yanıtla**,
  **Düzenle** (yalnızca kendi mesajı; boş kutuda ↑ tuşu son mesajı düzenler) ve **Sil**.
  Duyuruları yalnızca okuyabilenler de tepki verebilir.
- Biçimlendirme: `**kalın**`, `*italik*`, `__altı çizili__`, `~~üstü çizili~~`, `` `kod` ``,
  ` ```kod bloğu``` `, `> alıntı`, `- liste`, `# başlık`, `||sürpriz||`.
- `@` yazınca kanaldaki kişiler önerilir. Bahsedilen kişinin kanalında kırmızı **@** rozeti çıkar,
  mesaj sarı vurgulanır. Yönetim, mentörler ve jüriler `@herkes` ile kanaldaki herkese bildirebilir.
- 📎 düğmesi, sürükle-bırak ya da yapıştırma (Ctrl+V) ile dosya/görsel eklenir (bir mesaja en
  fazla 10 dosya, her biri en fazla 10 MB, `EK_MB` ile değişir). Görseller mesajda gösterilir,
  diğer dosyalar indirilir. Ekler `ekler/` klasöründe durur ve tahmin edilemez bir adresle
  sunulur; yedek dosyasına girmez (kayıtları girer).
- Sağdaki **Üyeler** listesi kanalı görebilenleri gösterir; yeşil nokta son bir dakikada
  platformda olanları gösterir. Üst sağdaki kişi simgesiyle açılıp kapanır.
- **Yazan öğrenci:** Öğrenci kendi hesabıyla girdiyse mesajda kendi adı, yanında takım adı görünür;
  yalnızca kendi mesajlarını düzenleyip silebilir. Takımın ortak hesabıyla girildiyse oyun sayfasındaki
  ekip üyelerinden "Yazan" seçilir (tarayıcı hatırlar); bu ad seçime dayanır, şifreyle doğrulanmaz.
- **Bildirimler:** Sizden bahsedilince, takıma mentörden yanıt gelince ve (mentör/yönetim için)
  yeni yardım çağrısında kısa bir ses çalar; sekme arka plandaysa tarayıcı bildirimi de çıkar.
  Kanal başlığındaki zil simgesiyle açılıp kapanır.

### Moderasyon

- Herkes başkasının mesajını araç çubuğundaki bayrak simgesiyle **bildirebilir**. Bildirilenler
  Yönetim → Mesajlar'daki **Moderasyon** kartında listelenir (menüde kırmızı sayı): mesaja git,
  sil, yazanı sustur ya da "sorun yok" diyerek kapat.
- **Susturma:** Yönetim, bir mesajın üzerindeki yasak simgesiyle ya da Moderasyon kartından
  kişiyi belirli bir süre (dakika) susturur. Susturulan mesaj yazamaz, dosya gönderemez, tepki
  veremez; nedenini ve bitiş saatini görür. Takım susturulursa tüm üyeleri susturulmuş olur.
- **Küfür filtresi:** Yaygın küfür ve argo, gönderilirken ilk harfi kalacak şekilde yıldızlanır
  ("götürmek", "klasik" gibi masum kelimelere dokunmaz). Moderasyon kartındaki "Ek yasaklı
  kelimeler" ile liste genişletilir.

## Puanlama

Varsayılan kriterler EğitiJAM 2026 kurallarındaki gibidir (Yönetim → Kriterler'den değişir):
Tema ile Uyum 20, Oynanış 20, Naratif 20, Görsel Tasarım 20, İşitsel Tasarım 20 → **100**,
artı Jüri Özel Seçimi / EğitiJAM Ruhu **+5 ek puan**. Sıralama, puan veren jürilerin
toplamlarının ortalamasıdır.

### Jüri odaları (ön eleme + final)

Jüri ve takım çoksa **Yönetim → Jüri odaları**'ndan istediğiniz kadar oda açın (ör. 16 jüri, 4 oda;
sayılar serbesttir, odalar eşit olmak zorunda değildir).

1. Odaları ekleyip kaydedin, **Oda dağılımı**'nda her jüriyi bir odaya atayın.
2. **Odasız takımları dağıt**: yayındaki takımlar odalara eşit bölünür; aynı okuldan, sonra aynı
   ilden takımlar farklı odalara konmaya çalışılır. Açılır listelerle elle taşıyabilirsiniz.
3. **Ön eleme**: her jüri yalnızca kendi odasındaki takımları görür ve puanlar. Sıralama oda içindedir.
   Takım başka odaya taşınırsa eski odanın jüri puanları sıralamaya girmez (silinmez, geri taşınırsa döner).
4. **Finalistleri ön elemeden seç**: her odadan ilk N takım finalist olur. Sonuçlar sekmesindeki
   "Final" kutularıyla elle ekleyip çıkarabilirsiniz.
5. Aşamayı **Final**'e alın: tüm jüriler yalnızca finalistleri puanlar. Final puanları ön eleme
   puanlarından ayrı tutulur; dereceleri (rozet) final sıralamasına göre verin.

XLSX dosyasında "Ön Eleme" (oda sütunlu), "Final" ve aşama sütunlu "Jüri Ayrıntısı" sayfaları olur.
Eski veritabanı ilk açılışta kendiliğinden dönüştürülür; mevcut oylar ön eleme oyu sayılır.

## Tarayıcıda oyun

Takım, oyunun web çıktısını (Unity WebGL, Godot Web, GDevelop, Construct, Phaser, HTML5 …) ZIP
olarak yükler. ZIP içinde `index.html` aranır; tek bir klasörün içindeyse klasör kökü kaldırılır.
Unity'nin `.gz` / `.br` sıkıştırılmış dosyaları doğru başlıklarla sunulur.

**Güvenlik:** öğrenci oyunları denetlenmemiş koddur. Ana sitede sunulurken `Content-Security-Policy:
sandbox` ile ayrı (opak) bir kökende çalışır: sitenin oturum jetonlarına, çerezlerine ve
localStorage'ına erişemez. Bunun bir yan etkisi, oyunun kendi kayıt verisini (PlayerPrefs,
IndexedDB) tutamamasıdır; oyun yine oynanır. Kayıt özelliği gereken oyunlar için oyunlar ayrı bir
alan adından sunulabilir: `.env` içinde `OYUN_ADRESI=https://oyun.ornek.gov.tr` yazın ve bu alan
adını da aynı sunucuya yönlendirin. O alan adında yalnızca `/oyunlar/...` dosyaları verilir.

Godot 4'te dışa aktarırken "Thread Support" kapalı olmalıdır (takım panelinde de yazıyor).

İndirilebilir dosyalar (ZIP, 7Z, RAR, EXE, MSI, APK, SB3, PDF) yalnızca ek olarak indirilir,
sitede çalıştırılmaz. Kurallar gereği virüs/riskli dosya kontrolü jüri ön değerlendirmesindedir.

## Geçmiş yıllar (arşiv)

**Yönetim → Geçmiş yıllar**'a itch.io jam adresini ve yılı yazın:

| Adres | Yıl |
|---|---|
| `https://itch.io/jam/egitijam2025` | 2025 |
| `https://itch.io/jam/egitijam-2024` | 2024 |

Oyunların adı, kısa açıklaması, yapımcıları, platformu ve kapağı alınır (kapaklar sunucuya
kopyalanır). Vitrinde yıl sekmeleri çıkar; kartlar oyunun itch.io sayfasını açar. Her oyuna rozet
verilebilir ya da vitrinden gizlenebilir. Aynı jam'i yeniden aktarmak bilgileri günceller,
rozet ve gizleme ayarlarını korur. Bu yılın oyunları ise **Yönetim → Etkinlik → Yıl** alanındaki
sekmede (ör. 2026) görünür.

## Sınırlar

| | Varsayılan | Ayar |
|---|---|---|
| Web sürümü ZIP | 300 MB (açılmış hâli en fazla 1 GB) | `OYUN_MB` |
| İndirilebilir dosya | 500 MB | `INDIRME_MB` |
| Kapak / ekran görüntüsü | 5 MB, PNG/JPG/WEBP/GIF | — |
| Ekran görüntüsü sayısı | 8 | — |
| Mesaj eki | 10 MB, mesaj başına 10 dosya | `EK_MB` |

Ters vekil (Apache/nginx) arkasında yayında, vekilin istek gövdesi sınırını da bu değerlere göre
açın (Apache `LimitRequestBody`, nginx `client_max_body_size`) ve `TRUST_PROXY=true` yazın.

## Yük testi

`yuk-testi.bat` (ya da `node yuk-testi/yuk-testi.js --kullanici 500`) geçici ve ayrı bir test sunucusu
açar, 150 takımlık veri yükler ve eşzamanlı kullanıcıları çalıştırır: vitrini gezen ziyaretçiler,
mesaj kanalı açık takım ve mentörler (5 sn'de bir yenileme), puan veren jüriler, paneli izleyen
yöneticiler. Önce etkinlik açılışındaki toplu girişi, sonra sabit yükü ölçer; istek türü başına
gecikme (p50/p95/p99), hata ve sunucunun CPU/bellek kullanımını yazar. Gerçek verinize dokunmaz.

**Asıl etkinlik sunucusunda çalıştırın**: sonuçlar donanıma bağlıdır.

Geliştirme bilgisayarında (Intel Core Ultra 5, test istemcisi aynı makinede) ölçülenler:

| | 500 kullanıcı | 1500 kullanıcı |
|---|---|---|
| Hata | 0 / 45.935 istek | 0 / 116.685 istek |
| Gecikme (p95, en yavaş istek türü) | < 30 ms | ~0,6 s |
| Sunucu CPU (tek çekirdek = %100) | ort. %31 | ort. %97 (doymuş) |
| Bellek | 164 MB | 316 MB |
| Toplu giriş (196 hesap / 10 sn) | giriş p95 60 ms, diğer istekler p95 6 ms | |

Node tek çekirdekte çalışır; 500 kullanıcıda bol pay vardır. Asıl sınır genelde **internet çıkışıdır**:
testte ziyaretçiler birkaç saniyede bir yeni oyun sayfası açtığı için 500 kişi ortalama ~200 Mbit/sn
görsel çekti (gerçekte daha yavaş gezilir ve tarayıcı önbelleği devrededir). Bunun için:

- Kapak ve ekran görüntüleri takım panelinde yüklenmeden önce tarayıcıda en çok 1280 px'e küçültülüp
  WEBP'ye çevrilir (3-8 MB'lık fotoğraflar ~100-300 KB olur).
- Sayfa dosyaları ve büyük JSON yanıtları gzip ile sıkıştırılır; sayfa dosyaları ETag ile önbelleğe
  alınır, görseller 1 gün önbellekte kalır.
- Tarayıcı oyunları büyükse (Unity WebGL 50-300 MB) ve sunucunun çıkışı zayıfsa `OYUN_MB` değerini
  düşürün; takımlar oyunu itch.io gibi bir yerde yayımlayıp sayfalarına "Dış bağlantı" olarak ekleyebilir.

## Veri

- `egitijam.db` — ayarlar, takımlar, sayfalar, mentörler, mesajlar, oylar, oturumlar, arşiv
- `urunler/<takım>/` — kapak, ekran görüntüleri, `oyun/` (açılmış web sürümü), `indir/`
- `arsiv/` — geçmiş yıl kapakları

Bunlar `DATA_DIR` altında tutulur (varsayılan proje klasörü). **Yönetim → Güvenlik & veri → Yedek
indir** ayarları, takımları ve mentörleri (şifre özetleriyle), mesajları, oyları ve arşiv kayıtlarını JSON olarak verir;
yüklenen dosyalar yedeğe girmez, `urunler/` ve `arsiv/` klasörlerini ayrıca yedekleyin.
