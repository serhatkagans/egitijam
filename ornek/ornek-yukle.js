// Vitrini denemek için örnek veri. Sunucu açıkken çalıştırılır (ornek-yukle.bat / ornek-sil.bat).
//   node --env-file=.env ornek/ornek-yukle.js        -> örnek takımları, oyunları ve geçmiş yılları ekler
//   node --env-file=.env ornek/ornek-yukle.js --sil  -> kullanıcı adı "ornek" ile başlayan takımları siler
// Örnek takımların kullanıcı adları ornek1, ornek2 ..., mentörlerin ornekmentor1 ... olduğu için gerçek kayıtlara dokunulmaz.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 3100;
const B = `http://localhost:${PORT}/`;
const OYUN_DIR = path.join(__dirname, 'oyunlar');

let TOKEN;
async function api(yontem, yol, govde, ham, jeton = TOKEN) {
  const h = {};
  if (jeton) h.Authorization = 'Bearer ' + jeton;
  if (govde !== undefined && !ham) h['Content-Type'] = 'application/json';
  const r = await fetch(B + yol, { method: yontem, headers: h, body: ham ? govde : govde === undefined ? undefined : JSON.stringify(govde) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${yol}: ${d.error || r.status}`);
  return d;
}

// ---- Kapak ve ekran görüntüsü çizimi (bağımlılıksız PNG) ----
function tuval(w, h) {
  const px = Buffer.alloc(w * h * 3);
  const set = (x, y, [r, g, b], a = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 3;
    px[o] = px[o] * (1 - a) + r * a; px[o + 1] = px[o + 1] * (1 - a) + g * a; px[o + 2] = px[o + 2] * (1 - a) + b * a;
  };
  const t = {
    w, h,
    egim(ust, alt) { for (let y = 0; y < h; y++) { const k = y / h; const c = ust.map((v, i) => v + (alt[i] - v) * k); for (let x = 0; x < w; x++) set(x, y, c); } },
    kutu(x0, y0, kw, kh, c, a = 1) { for (let y = y0; y < y0 + kh; y++) for (let x = x0; x < x0 + kw; x++) set(x | 0, y | 0, c, a); },
    daire(cx, cy, r, c, a = 1) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y); if (d <= r) set((cx + x) | 0, (cy + y) | 0, c, a * Math.min(1, r - d + .5)); } },
    halka(cx, cy, r, k, c, a = 1) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y); if (d <= r && d >= r - k) set((cx + x) | 0, (cy + y) | 0, c, a); } },
    isik(cx, cy, r, c, a = .5) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y) / r; if (d < 1) set((cx + x) | 0, (cy + y) | 0, c, a * (1 - d) * (1 - d)); } },
    tepe(f, c) { for (let x = 0; x < w; x++) for (let y = Math.max(0, f(x) | 0); y < h; y++) set(x, y, c); },
    cizgi(x0, y0, x1, y1, k, c, a = 1) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) t.daire(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, k, c, a); },
    png() {
      const raw = Buffer.alloc((w * 3 + 1) * h);
      for (let y = 0; y < h; y++) px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
      const chunk = (tp, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(tp), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([l, td, c]); };
      const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
      return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
    }
  };
  return t;
}
// Sabit tohumlu rastgele: her çalıştırmada aynı görseller
function rastgele(tohum) { return () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647); }

const SAHNELER = {
  // İki karakter el ele, gece tepesinde
  ikiz(t, R, v) {
    t.egim([18, 22, 60], [120, 30, 70]);
    for (let i = 0; i < 90; i++) t.daire(R() * t.w, R() * t.h * .6, R() * 1.6 + .4, [255, 255, 255], R() * .8 + .2);
    t.isik(t.w * .8, t.h * .2, 90, [255, 240, 200], .6); t.daire(t.w * .8, t.h * .2, 34, [255, 244, 214]);
    t.tepe(x => t.h * .72 - Math.sin(x / 90 + v) * 22, [52, 20, 50]);
    const y = t.h * .72 - 40, x = t.w * .42 + v * 30;
    t.kutu(x - 46, y - 10, 34, 50, [196, 22, 28]); t.kutu(x + 12, y - 10, 34, 50, [255, 214, 90]);
    t.kutu(x - 16, y + 12, 32, 8, [255, 255, 255]);
    t.kutu(x - 38, y + 2, 7, 7, [255, 255, 255]); t.kutu(x + 30, y + 2, 7, 7, [40, 30, 40]);
  },
  // Su üstünde yarım köprü
  kopru(t, R, v) {
    t.egim([255, 170, 90], [196, 22, 28]);
    t.isik(t.w * .5, t.h * .55, 160, [255, 230, 150], .7); t.daire(t.w * .5, t.h * .55, 50, [255, 225, 140]);
    t.kutu(0, t.h * .62, t.w, t.h, [40, 60, 110]);
    for (let i = 0; i < 40; i++) t.kutu(R() * t.w, t.h * .64 + R() * t.h * .35, 30 + R() * 50, 3, [255, 200, 150], .35);
    t.kutu(0, t.h * .5, t.w * .2, t.h, [60, 30, 30]); t.kutu(t.w * .8, t.h * .5, t.w, t.h, [60, 30, 30]);
    const n = 9 + (v | 0);
    for (let i = 0; i < n; i++) t.kutu(t.w * .2 + i * 30, t.h * .5 + Math.sin(i / 3) * 6, 26, 10, [140, 85, 45]);
    t.cizgi(t.w * .2, t.h * .42, t.w * .2 + n * 30, t.h * .45, 2, [90, 50, 30]);
  },
  // Işık zinciri: birbirine bağlı parlayan noktalar
  isik(t, R, v) {
    t.egim([10, 12, 30], [40, 10, 40]);
    const p = Array.from({ length: 7 }, (_, i) => [t.w * (.1 + i * .13), t.h * (.3 + R() * .45)]);
    for (let i = 0; i < p.length - 1; i++) if (i < 4 + v * 2) t.cizgi(...p[i], ...p[i + 1], 2, [255, 210, 120], .9);
    p.forEach(([x, y], i) => { const on = i <= 4 + v * 2; t.isik(x, y, on ? 70 : 30, on ? [255, 190, 90] : [90, 90, 140], on ? .7 : .4); t.daire(x, y, 12, on ? [255, 236, 190] : [80, 80, 120]); });
  },
  // Dişliler
  disli(t, R, v) {
    t.egim([250, 190, 60], [210, 110, 20]);
    const disli = (cx, cy, r, c, aci) => {
      t.daire(cx, cy, r, c);
      for (let i = 0; i < 10; i++) { const a = aci + i * Math.PI / 5; t.daire(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * .18, c); }
      t.daire(cx, cy, r * .35, [250, 170, 50]);
    };
    disli(t.w * .35, t.h * .5, 90, [70, 40, 20], v); disli(t.w * .65, t.h * .38, 62, [130, 60, 20], -v);
    disli(t.w * .7, t.h * .78, 44, [196, 22, 28], v * 1.5);
  },
  // Kovan petekleri
  kovan(t, R, v) {
    t.egim([255, 220, 90], [230, 150, 20]);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
      const cx = x * 58 + (y % 2) * 29, cy = y * 50 + 10;
      t.daire(cx, cy, 24, R() < .3 + v * .1 ? [200, 110, 10] : [255, 235, 150], .9);
    }
    for (let i = 0; i < 5; i++) { const x = R() * t.w, y = R() * t.h; t.daire(x, y, 9, [40, 30, 20]); t.kutu(x - 3, y - 9, 6, 18, [255, 200, 0]); t.daire(x - 6, y - 10, 6, [255, 255, 255], .7); }
  },
  // Hafıza kartları
  kartlar(t, R, v) {
    t.egim([36, 90, 150], [20, 40, 90]);
    const renk = [[196, 22, 28], [255, 200, 60], [60, 180, 120], [240, 120, 60], [140, 90, 200]];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
      const kx = 60 + x * 104, ky = 70 + y * 128, acik = R() < .4 + v * .15;
      t.kutu(kx + 4, ky + 6, 86, 112, [0, 0, 0], .25);
      t.kutu(kx, ky, 86, 112, acik ? [250, 250, 250] : [196, 22, 28]);
      if (acik) t.daire(kx + 43, ky + 56, 24, renk[(x + y * 2) % 5]); else t.halka(kx + 43, ky + 56, 26, 4, [255, 255, 255], .5);
    }
  },
  // Ortak bahçe
  bahce(t, R, v) {
    t.egim([150, 210, 255], [220, 240, 255]);
    t.isik(t.w * .15, t.h * .15, 120, [255, 255, 200], .8); t.daire(t.w * .15, t.h * .15, 40, [255, 236, 120]);
    t.tepe(x => t.h * .6 + Math.sin(x / 140) * 18, [90, 170, 70]);
    t.tepe(x => t.h * .75 + Math.sin(x / 70 + 2) * 10, [60, 130, 50]);
    for (let i = 0; i < 26 + v * 10; i++) {
      const x = R() * t.w, y = t.h * .66 + R() * t.h * .3, c = [[196, 22, 28], [255, 200, 40], [240, 110, 170], [255, 255, 255]][i % 4];
      t.kutu(x - 1, y, 3, 22, [40, 100, 40]);
      for (let k = 0; k < 5; k++) t.daire(x + Math.cos(k * 1.26) * 7, y + Math.sin(k * 1.26) * 7, 5, c);
      t.daire(x, y, 4, [255, 220, 80]);
    }
  }
};
function gorsel(sahne, tohum, v, w, h) { const t = tuval(w, h); SAHNELER[sahne](t, rastgele(tohum), v); return t.png(); }

// ---- ZIP (tarayıcı oyunları için) ----
function zip(files) {
  const L = [], C = []; let off = 0;
  for (const [n, c] of files) {
    const nb = Buffer.from(n), data = Buffer.from(c), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    const c2 = Buffer.alloc(46); c2.writeUInt32LE(0x02014b50, 0); c2.writeUInt16LE(20, 4); c2.writeUInt16LE(20, 6); c2.writeUInt16LE(0x800, 8); c2.writeUInt16LE(8, 10);
    c2.writeUInt32LE(crc, 16); c2.writeUInt32LE(comp.length, 20); c2.writeUInt32LE(data.length, 24); c2.writeUInt16LE(nb.length, 28); c2.writeUInt32LE(off, 42);
    L.push(h, nb, comp); C.push(c2, nb); off += 30 + nb.length + comp.length;
  }
  const cs = C.reduce((a, b) => a + b.length, 0), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cs, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...L, ...C, e]);
}

// ---- Örnek takımlar ----
const UYELER = [['Zeynep Arslan', 'Programlama'], ['Emre Demir', 'Görsel tasarım'], ['Elif Çelik', 'Ses ve müzik'], ['Yusuf Kaya', 'Hikâye ve bölüm tasarımı'], ['Ayşe Yıldız', 'Test ve sunum']];
const ORNEKLER = [
  { takim: 'Kodçu Kartallar', il: 'Ankara', okul: 'Atatürk Ortaokulu', danisman: 'Ayşe Yılmaz', sahne: 'ikiz', oyun: 'ikiz-kutular.html',
    baslik: 'Birlikte Güçlüyüz', kisa: 'İki karakteri aynı anda yönetin: biri olmadan diğeri kapıya ulaşamaz.', etiketler: ['Bulmaca', 'İş birliği', '2D'],
    aciklama: 'Kırmızı ve sarı iki arkadaş, aynı labirentin iki yarısında sıkışıp kalmıştır. Her biri ancak diğerinin bastığı düğmeyle açılan kapılardan geçebilir.\n\n"Tek Başına İşlemez" temasını oyunun temel mekaniğine taşıdık: iki karakter aynı klavyeyle, aynı anda yönetilir. Tek oyunculu oynanabilir, ama iki kişiyle çok daha eğlenceli!',
    kontroller: 'Kırmızı: W A S D\nSarı: Ok tuşları\nİkisi de kendi yıldızına ulaşınca bölüm biter.', rozet: '1.' },
  { takim: 'Piksel Ustaları', il: 'İzmir', okul: 'Bilim ve Sanat Merkezi', danisman: 'Mehmet Kaya', sahne: 'kartlar', oyun: 'hafiza.html',
    baslik: 'Hafıza Ortakları', kisa: 'Kartları eşleştirin; her doğru eşleşme takım arkadaşınıza bir ipucu açar.', etiketler: ['Eğitici', 'Hafıza', 'Fare'],
    aciklama: 'Klasik hafıza oyununu bir takım oyununa dönüştürdük. Eşleşen her çift, ekranın diğer yarısındaki arkadaşınıza yeni bir ipucu kazandırır.\n\nOyun ilkokul öğrencilerinin kısa süreli bellek becerilerini desteklemek amacıyla tasarlandı.',
    kontroller: 'Fare ile kartlara tıklayın.\nEn az hamlede tüm çiftleri bulmaya çalışın.', rozet: '2.' },
  { takim: 'Karadeniz Kodlama', il: 'Trabzon', okul: 'Fen Lisesi', danisman: 'Hasan Öztürk', sahne: 'isik', oyun: 'toplayici.html',
    baslik: 'Işık Zinciri', kisa: 'Karanlıktaki köylere ışık taşıyın; her ışık bir sonrakini yakar.', etiketler: ['Macera', 'Atmosferik'],
    aciklama: 'Bir fırtınadan sonra vadideki tüm fenerler sönmüştür. Tek bir ışık kıvılcımı olarak fenerleri sırayla yakmanız gerekir; her fener bir sonrakine giden yolu aydınlatır.\n\nIşığı yalnızca birlikte çoğaltabileceğimiz fikrinden yola çıktık.',
    kontroller: 'Ok tuşları: hareket\nIşık toplarını toplayarak zinciri büyütün.', rozet: '3.' },
  { takim: 'Dişli Takımı', il: 'Bursa', okul: 'Mesleki ve Teknik Anadolu Lisesi', danisman: 'Fatma Şahin', sahne: 'disli',
    baslik: 'Dişli', kisa: 'Makinenin her dişlisi diğerine bağlı: birini döndürmeden ötekini çalıştıramazsınız.', etiketler: ['Fizik', 'Bulmaca', '3D'],
    aciklama: 'Eski bir saat kulesini yeniden çalıştırmaya çalışan bir tamircinin hikâyesi. Dişlileri doğru sıraya yerleştirerek mekanizmayı canlandırın.', kontroller: 'Fare: dişli seç ve yerleştir\nR: döndür', indir: true, rozet: 'Jüri Özel Ödülü' },
  { takim: 'Arı Kodlar', il: 'Mersin', okul: 'Cumhuriyet Ortaokulu', danisman: 'Ali Koç', sahne: 'kovan',
    baslik: 'Kovan', kisa: 'Arı kolonisini yönetin; hiçbir arı tek başına kovanı ayakta tutamaz.', etiketler: ['Simülasyon', 'Strateji'],
    aciklama: 'İşçi, bekçi ve dadı arıları arasında görev dağıtımı yaparak kovanı kış boyunca hayatta tutun.', kontroller: 'Fare ile arıları görevlere sürükleyin.', indir: true },
  { takim: 'Trakya Tech', il: 'Edirne', okul: 'Anadolu Lisesi', danisman: 'Zehra Aydın', sahne: 'kopru',
    baslik: 'Köprü Ustaları', kisa: 'Köyler arasına köprü kurun; her köprü ancak iki ekip birlikte çalışınca tamamlanır.', etiketler: ['Strateji', 'Eğitici'],
    aciklama: 'Nehrin iki yakasındaki ekipler köprüyü ortada buluşturmalıdır. Malzemeyi paylaşmadan köprü hiçbir zaman tamamlanmaz.', kontroller: 'Fare ile tahta yerleştirin.', indir: true },
  { takim: 'Yeşil Piksel', il: 'Gaziantep', okul: 'İmam Hatip Ortaokulu', danisman: 'Murat Arslan', sahne: 'bahce',
    baslik: 'Ortak Bahçe', kisa: 'Mahalleli birlikte bahçe kurar; tohumlar ancak paylaşıldığında büyür.', etiketler: ['Rahat', 'Eğitici'],
    aciklama: 'Boş bir arsayı mahalle bahçesine dönüştürün. Komşularınızla tohum, su ve emek paylaştıkça bahçe büyür.', kontroller: 'Fare ile ekin, sulayın, paylaşın.' }
];

async function yukle() {
  // Önce eski örnekler temizlenir: betik tekrar çalıştırılabilir
  await sil(true);
  console.log('Örnek takımlar ekleniyor…');
  const yeni = [];
  for (const [i, o] of ORNEKLER.entries()) {
    const t = (await api('POST', 'api/admin/takim', { ad: o.takim, il: o.il, okul: o.okul, danisman: o.danisman, kullanici: `ornek${i + 1}` })).yeni[0];
    const q = 'takim=' + t.id;
    await api('PUT', 'api/takim/sayfa?' + q, {
      baslik: o.baslik, kisa: o.kisa, etiketler: o.etiketler, aciklama: o.aciklama, kontroller: o.kontroller,
      uyeler: UYELER.slice(0, 3 + (i % 3)).map(([ad, rol]) => ({ ad, rol })),
      video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      krediler: 'Ses efektleri: Kenney.nl (CC0)\nYazı tipi: Google Fonts\nYapay zekâ: Hikâye taslağı için bir sohbet asistanından fikir alındı; tüm kod ve görseller ekip tarafından yapıldı.'
    });
    await api('POST', `api/takim/yukle?${q}&tur=kapak&ad=kapak.png`, gorsel(o.sahne, i + 1, 0, 630, 500), true);
    for (let j = 1; j <= 3; j++) await api('POST', `api/takim/yukle?${q}&tur=gorsel&ad=ekran${j}.png`, gorsel(o.sahne, (i + 1) * 10 + j, j * .7, 800, 500), true);
    if (o.oyun) await api('POST', `api/takim/yukle?${q}&tur=oyun&ad=oyun.zip`, zip([['Web/index.html', fs.readFileSync(path.join(OYUN_DIR, o.oyun))]]), true);
    if (o.indir) await api('POST', `api/takim/yukle?${q}&tur=indir&ad=${encodeURIComponent(o.baslik)}-Windows.zip`,
      zip([['OKUBENI.txt', `${o.baslik} - örnek indirme dosyası.\r\nGerçek bir takım burada oyunun Windows sürümünü yükler.\r\n`]]), true);
    yeni.push({ ...t, rozet: o.rozet || '' });
    console.log(`  ${o.baslik} (${t.id})`);
  }
  // Rozetler: sonuçlar açıklandığında vitrinde görünür
  const durum = await api('GET', 'api/admin/durum');
  for (const y of yeni) if (y.rozet) {
    const t = durum.teams.find(x => x.id === y.id);
    await api('PUT', 'api/admin/takim', { id: t.id, ad: t.ad, il: t.il, okul: t.okul, danisman: t.danisman, yayinda: true, rozet: y.rozet });
  }
  await api('PUT', 'api/admin/bayraklar', { sonuclarAcik: true });
  const mentorler = await ornekMentorler(yeni);

  console.log('Geçmiş yıllar itch.io\'dan aktarılıyor…');
  for (const [adres, donem] of [['https://itch.io/jam/egitijam2025', '2025'], ['https://itch.io/jam/egitijam-2024', '2024']]) {
    try { const a = (await api('POST', 'api/admin/arsiv', { adres, donem })).aktarilan; console.log(`  ${donem}: ${a.sayi} oyun`); }
    catch (e) { console.log(`  ${donem} aktarılamadı (${e.message}). İnternet bağlantısını kontrol edin; daha sonra Yönetim > Geçmiş yıllar'dan aktarabilirsiniz.`); }
  }
  console.log(`\nHazır: ${B}`);
  console.log('\nMesajlaşmayı denemek için (bu şifreler yalnızca şimdi gösterilir):');
  for (const m of mentorler) console.log(`  Mentör paneli ${B}mentor  kullanıcı: ${m.id}  şifre: ${m.sifre}  (${m.ad})`);
  console.log(`  Takım paneli  ${B}takim   kullanıcı: ${yeni[1].id}  şifre: ${yeni[1].sifre}  (${yeni[1].ad})`);
  console.log('Örnek takımları kaldırmak için ornek-sil.bat (geçmiş yıllar arşivi kalır; Yönetim > Geçmiş yıllar\'dan silinir).');
}

// Örnek mentörler takımlara atanır; kanallara örnek yazışmalar eklenir
async function ornekMentorler(takimlar) {
  console.log('Örnek mentörler ve mesajlar ekleniyor…');
  const ids = takimlar.map(t => t.id);
  const m1 = (await api('POST', 'api/admin/mentor', { ad: 'Elif Demir', alan: 'Programlama', kullanici: 'ornekmentor1', takimlar: ids.slice(0, 4) })).yeni[0];
  const m2 = (await api('POST', 'api/admin/mentor', { ad: 'Can Öztürk', alan: 'Görsel tasarım', kullanici: 'ornekmentor2', takimlar: ids.slice(3) })).yeni[0];
  const giris = async (tur, kullanici, sifre) => (await api('POST', `api/${tur}/giris`, { kullanici, sifre }, undefined, null)).token;
  const M1 = await giris('mentor', m1.id, m1.sifre), M2 = await giris('mentor', m2.id, m2.sifre);
  const T = {};
  for (const t of takimlar.slice(0, 3)) T[t.id] = await giris('takim', t.id, t.sifre);
  const yaz = (jeton, kanal, metin, yardim) => api('POST', 'api/mesaj', { kanal, metin, yardim }, undefined, jeton);
  const [a, b, c] = takimlar;
  await yaz(M1, 'duyuru', 'Merhaba takımlar! Ben Elif, programlama mentörüyüm. Sorularınızı kendi kanalınıza yazın; takıldığınızda "Yardım istiyorum" kutusunu işaretlerseniz tüm mentörlere bildirim düşer.');
  await yaz(M2, 'duyuru', 'Kapak görseli için önerilen boyut 630×500 piksel. Oynanış videosunu YouTube\'a "liste dışı" yükleyip bağlantısını sayfanıza ekleyebilirsiniz.');
  await yaz(M1, 'mentor', 'Akşam 20:00\'de takımların durumunu birlikte gözden geçirelim. Sayfası eksik olanları Takımlarım sekmesinden görebilirsiniz.');
  await yaz(M2, 'mentor', 'Tamam, görsel tarafındaki soruları ben alıyorum.');
  await yaz(T[a.id], 't:' + a.id, 'Hocam iki karakterin aynı anda düğmeye basmasını nasıl kontrol edebiliriz?');
  await yaz(M1, 't:' + a.id, 'Her karakterin hangi karede durduğuna bakın; iki koşul birlikte doğruysa kapıyı açın. Kapının açık kalmasını istiyorsanız bir değişkende saklayın.');
  await yaz(T[a.id], 't:' + a.id, 'Oldu, teşekkürler! 🎉');
  await yaz(T[b.id], 't:' + b.id, 'WebGL sürümünü yükledik ama sayfada gri ekran kalıyor, oyun açılmıyor.', true);
  await yaz(T[c.id], 't:' + c.id, 'Ekran görüntülerini hangi çözünürlükte almalıyız?');
  await yaz(M2, 't:' + c.id, '16:9 oranında, en az 1280×720 öneririm. Oyunun en hareketli anlarını seçin.');
  console.log(`  2 mentör (${m1.id}, ${m2.id}) ${takimlar.length} takıma atandı; 1 takım yardım bekliyor`);
  return [m1, m2];
}

async function sil(sessiz) {
  const d = await api('GET', 'api/admin/durum');
  const ornek = d.teams.filter(t => /^ornek\d+$/.test(t.id));
  for (const t of ornek) await api('DELETE', 'api/admin/takim?id=' + t.id);
  // Örnek mentörler ve genel kanallara yazdıkları (takım kanalları takımla birlikte silinir)
  const om = (d.mentors || []).filter(m => /^ornekmentor\d+$/.test(m.id));
  for (const kanal of om.length ? ['duyuru', 'mentor'] : []) {
    for (const m of (await api('GET', 'api/mesaj?kanal=' + kanal)).mesajlar) {
      if (/^m:ornekmentor\d+$/.test(m.kim)) await api('DELETE', 'api/mesaj?id=' + m.id);
    }
  }
  for (const m of om) await api('DELETE', 'api/admin/mentor?id=' + m.id);
  if (!sessiz && om.length) console.log(`${om.length} örnek mentör silindi.`);
  if (!sessiz || ornek.length) console.log(`${ornek.length} örnek takım silindi.`);
}

(async () => {
  if (!process.env.ADMIN_SIFRE) throw new Error('.env dosyasında ADMIN_SIFRE yok. Önce baslat.bat ile kurulumu yapın.');
  try { TOKEN = (await api('POST', 'api/admin/giris', { sifre: process.env.ADMIN_SIFRE })).token; }
  catch (e) {
    if (e.cause || /fetch failed/.test(e.message)) throw new Error(`Sunucuya bağlanılamadı (${B}). Önce baslat.bat ile sunucuyu açın.`);
    throw new Error(`Yönetici girişi başarısız: ${e.message}. Şifre panelden değiştirildiyse .env'deki ADMIN_SIFRE artık geçerli değildir.`);
  }
  if (process.argv.includes('--sil')) await sil(false); else await yukle();
})().catch(e => { console.error('\nHata: ' + e.message); process.exitCode = 1; });
