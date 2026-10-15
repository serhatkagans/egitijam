// EğitiJAM yük testi: gerçekçi kullanıcı karışımıyla eşzamanlı yük üretir, gecikme ve hata oranlarını raporlar.
//
//   node yuk-testi/yuk-testi.js                 -> kendi geçici sunucusunu açar (ayrı veri klasörü), test eder, kapatır
//   node yuk-testi/yuk-testi.js --kullanici 800 --sure 180
//   node yuk-testi/yuk-testi.js --adres http://sunucu:3100 --sifre YONETICI_SIFRESI --test-sunucusu
//        -> çalışan bir sunucuyu test eder. YALNIZCA BOŞ BİR TEST KURULUMUNDA kullanın: jüri listesini,
//           odaları ve ayarları değiştirir, "yuk" ile başlayan 150 takım ve mentör ekler.
//
// Kullanıcı karışımı (500 için): %76 ziyaretçi, %14 takım, %6 mentör, 16 jüri, 4 yönetici.
// Ziyaretçiler vitrini ve oyun sayfalarını gezer; takımlar/mentörler mesaj kanalını açık tutar (5 sn'de bir yenileme),
// mesaj yazar, sayfa kaydeder; jüriler puan verir; yöneticiler yönetim panelini izler.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const arg = (ad, vars) => { const i = process.argv.indexOf('--' + ad); return i > 0 ? process.argv[i + 1] : vars; };
const KULLANICI = Number(arg('kullanici', 500));
const SURE = Number(arg('sure', 120));          // sabit yük süresi (sn)
const ISINMA = Number(arg('isinma', 30));       // kullanıcıların kademeli katılma süresi (sn)
const TAKIM_SAYI = Number(arg('takim', 150));
const DIS_ADRES = arg('adres', null);
const KOK = path.join(__dirname, '..');

let B, YON_SIFRE, sunucu = null, veriDir = null;

// ---- Ölçüm ----
const olcum = {};   // grup -> { sure: [], hata: 0, durum: {} , bayt: 0 }
function kaydet(grup, ms, ok, durum, bayt) {
  const o = olcum[grup] ||= { sure: [], hata: 0, durum: {}, bayt: 0 };
  o.sure.push(ms); o.bayt += bayt || 0;
  if (!ok) { o.hata++; o.durum[durum] = (o.durum[durum] || 0) + 1; }
}
async function istek(grup, yontem, yol, { govde, jeton, ham, tur = 'json' } = {}) {
  const h = {};
  if (jeton) h.Authorization = 'Bearer ' + jeton;
  if (govde !== undefined && !ham) h['Content-Type'] = 'application/json';
  const t0 = performance.now();
  try {
    const r = await fetch(B + yol, { method: yontem, headers: h, body: ham ? govde : govde === undefined ? undefined : JSON.stringify(govde), signal: AbortSignal.timeout(30000) });
    const buf = Buffer.from(await r.arrayBuffer());
    kaydet(grup, performance.now() - t0, r.ok, r.status, buf.length);
    if (!r.ok) return null;
    return tur === 'json' ? JSON.parse(buf.toString('utf8') || '{}') : buf;
  } catch (e) {
    kaydet(grup, performance.now() - t0, false, e.name === 'TimeoutError' ? 'zaman aşımı' : (e.cause?.code || e.name));
    return null;
  }
}
const uyu = ms => new Promise(r => setTimeout(r, ms));
const rast = (a, b) => a + Math.random() * (b - a);
const sec = l => l[Math.floor(Math.random() * l.length)];

// ---- Basit PNG (kapak ~200 KB, ekran görüntüsü ~250 KB: gerçek kapaklara yakın) ----
function png(w, h, tohum) {
  const satir = w * 3 + 1, ham = Buffer.alloc(satir * h);
  let s = tohum * 9973 + 7;
  for (let y = 0; y < h; y++) {
    ham[y * satir] = 0;
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const o = y * satir + 1 + x * 3, n = (s >> 16) & 31;
      ham[o] = (((x >> 3) + (y >> 3)) * 9 + tohum * 40) % 256; ham[o + 1] = ((y >> 2) * 3) % 256 ^ ((x & 3) === 0 ? n & 15 : 0); ham[o + 2] = 120;
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parca = (tip, veri) => { const l = Buffer.alloc(4); l.writeUInt32BE(veri.length); const tv = Buffer.concat([Buffer.from(tip), veri]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tv)); return Buffer.concat([l, tv, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), parca('IHDR', ihdr), parca('IDAT', zlib.deflateSync(ham)), parca('IEND', Buffer.alloc(0))]);
}
// Tek dosyalık ZIP (stored)
function zip(ad, veri) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff; for (const x of veri) c = crcT[(c ^ x) & 255] ^ (c >>> 8); c = (c ^ 0xffffffff) >>> 0;
  const n = Buffer.from(ad), y = Buffer.alloc(30); y.writeUInt32LE(0x04034b50, 0); y.writeUInt16LE(20, 4); y.writeUInt32LE(c, 14); y.writeUInt32LE(veri.length, 18); y.writeUInt32LE(veri.length, 22); y.writeUInt16LE(n.length, 26);
  const m = Buffer.alloc(46); m.writeUInt32LE(0x02014b50, 0); m.writeUInt16LE(20, 4); m.writeUInt16LE(20, 6); m.writeUInt32LE(c, 16); m.writeUInt32LE(veri.length, 20); m.writeUInt32LE(veri.length, 24); m.writeUInt16LE(n.length, 28);
  const son = Buffer.alloc(22); son.writeUInt32LE(0x06054b50, 0); son.writeUInt16LE(1, 8); son.writeUInt16LE(1, 10); son.writeUInt32LE(46 + n.length, 12); son.writeUInt32LE(30 + n.length + veri.length, 16);
  return Buffer.concat([y, n, veri, m, n, son]);
}

// ---- Sunucu (yerel test) ----
async function sunucuAc() {
  veriDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egitijam-yuk-'));
  YON_SIFRE = crypto.randomBytes(9).toString('hex');
  const port = 3190 + Math.floor(Math.random() * 50);
  B = `http://127.0.0.1:${port}/`;
  sunucu = spawn(process.execPath, ['--no-warnings', path.join(KOK, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: veriDir, ADMIN_SIFRE: YON_SIFRE }, stdio: ['ignore', 'ignore', 'pipe']
  });
  sunucu.stderr.on('data', d => process.stderr.write('[sunucu] ' + d));
  for (let i = 0; i < 50; i++) { try { await fetch(B + 'api/durum'); return; } catch { await uyu(200); } }
  throw new Error('Test sunucusu açılamadı');
}
function sunucuKapat() {
  if (sunucu) sunucu.kill();
  if (veriDir) setTimeout(() => fs.rmSync(veriDir, { recursive: true, force: true }), 500);
}
// Sunucu sürecinin CPU ve bellek kullanımı (yalnızca yerel testte, Windows/Linux)
const kaynak = [];
function kaynakIzle() {
  if (!sunucu) return () => {};
  let onceki = null;
  const z = setInterval(() => {
    const pid = sunucu.pid;
    if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid}; "$($p.TotalProcessorTime.TotalMilliseconds) $($p.WorkingSet64)"`], (e, out) => {
        if (e) return;
        const [cpu, bel] = out.trim().split(/\s+/).map(Number), simdi = Date.now();
        if (onceki) kaynak.push({ cpu: (cpu - onceki.cpu) / (simdi - onceki.t) * 100, mb: bel / 1048576 });
        onceki = { cpu, t: simdi };
      });
    } else {
      try {
        const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' '), cpu = (Number(st[13]) + Number(st[14])) * 10, simdi = Date.now();
        const mb = Number(fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096 / 1048576;
        if (onceki) kaynak.push({ cpu: (cpu - onceki.cpu) / (simdi - onceki.t) * 100, mb });
        onceki = { cpu, t: simdi };
      } catch {}
    }
  }, 3000);
  return () => clearInterval(z);
}

// ---- Veri hazırlığı ----
const HESAP = { takim: [], mentor: [], juri: [] };
let URUNLER = [], OYUNLU = [];
async function hazirla() {
  const A = (await istek('hazırlık', 'POST', 'api/admin/giris', { govde: { sifre: YON_SIFRE } }))?.token;
  if (!A) throw new Error('Yönetici girişi başarısız');
  const yaz = (y, p, b, ham) => istek('hazırlık', y, p, { govde: b, jeton: A, ham });
  const IL = ['Ankara', 'İstanbul', 'İzmir', 'Bursa', 'Konya', 'Trabzon', 'Van', 'Erzurum', 'Mersin', 'Kayseri'];
  const satirlar = Array.from({ length: TAKIM_SAYI }, (_, i) => `Yük Takımı ${i + 1}; ${IL[i % IL.length]}; Okul ${i % 37}; Öğretmen ${i}`);
  const t = await yaz('POST', 'api/admin/takimlar', { metin: satirlar.join('\n') });
  HESAP.takim = t.yeni.map(x => ({ id: x.id, sifre: x.sifre }));
  process.stdout.write(`  ${HESAP.takim.length} takım oluşturuldu, sayfalar ve dosyalar yükleniyor`);
  const kapak = png(630, 500, 1), ekran = png(800, 500, 2);
  const oyun = zip('index.html', fs.readFileSync(path.join(KOK, 'ornek', 'oyunlar', 'toplayici.html')));
  const uzun = 'Bu oyun, takım çalışmasının önemini anlatan bir macera oyunudur. '.repeat(20);
  // 10'ar paralel
  for (let i = 0; i < HESAP.takim.length; i += 10) {
    await Promise.all(HESAP.takim.slice(i, i + 10).map(async (x, j) => {
      const q = 'takim=' + x.id, n = i + j;
      await yaz('PUT', 'api/takim/sayfa?' + q, { baslik: `Oyun ${n + 1}`, kisa: 'Birlikte oynanan bir bulmaca oyunu', aciklama: uzun, kontroller: 'Ok tuşları',
        uyeler: [{ ad: 'Ali', rol: 'Kod' }, { ad: 'Ayşe', rol: 'Çizim' }, { ad: 'Can', rol: 'Ses' }], video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', krediler: 'Kenney.nl' });
      await yaz('POST', `api/takim/yukle?${q}&tur=kapak&ad=k.png`, kapak, true);
      await yaz('POST', `api/takim/yukle?${q}&tur=gorsel&ad=e.png`, ekran, true);
      if (n % 3 === 0) await yaz('POST', `api/takim/yukle?${q}&tur=oyun&ad=o.zip`, oyun, true);
    }));
    process.stdout.write('.');
  }
  console.log('');
  // Jüriler, odalar, mentörler
  const juriler = Array.from({ length: 16 }, (_, i) => ({ name: `Yük Jürisi ${i + 1}`, id: `yukjuri${i + 1}` }));
  await yaz('PUT', 'api/admin/juriler', { list: juriler });
  const JSIFRE = crypto.randomBytes(6).toString('hex');
  await yaz('PUT', 'api/admin/sifre', { tur: 'ortak', sifre: JSIFRE });
  HESAP.juri = juriler.map(j => ({ id: j.id, sifre: JSIFRE }));
  const odalar = (await yaz('PUT', 'api/admin/odalar', { list: [1, 2, 3, 4].map(n => ({ ad: `Oda ${n}` })) })).odalar;
  await yaz('PUT', 'api/admin/oda-ata', { juriler: Object.fromEntries(juriler.map((j, i) => [j.id, odalar[i % 4].id])) });
  await yaz('POST', 'api/admin/oda-dagit', { hepsi: true });
  await yaz('PUT', 'api/admin/bayraklar', { oylamaAcik: true, teslimAcik: true });
  const MSAY = Math.max(5, Math.round(KULLANICI * .06));
  const m = await yaz('POST', 'api/admin/mentorler', { metin: Array.from({ length: MSAY }, (_, i) => `Yük Mentörü ${i + 1}; Programlama`).join('\n') });
  HESAP.mentor = m.yeni.map(x => ({ id: x.id, sifre: x.sifre }));
  for (const [i, x] of HESAP.mentor.entries()) {
    await yaz('PUT', 'api/admin/mentor', { id: x.id, ad: `Yük Mentörü ${i + 1}`, alan: 'Programlama', takimlar: HESAP.takim.filter((_, k) => k % HESAP.mentor.length === i).map(t => t.id) });
  }
  // Kanallarda geçmiş mesaj (gerçekçi: her takım kanalında birkaç mesaj, 40 duyuru)
  for (let i = 0; i < 40; i++) await yaz('POST', 'api/mesaj', { kanal: 'duyuru', metin: `Duyuru ${i + 1}: Teslim kuralları hakkında bilgilendirme.` });
  const v = await istek('hazırlık', 'GET', 'api/vitrin');
  URUNLER = v.urunler; OYUNLU = URUNLER.filter(u => u.oyun);
  console.log(`  ${URUNLER.length} ürün (${OYUNLU.length} tarayıcı oyunu), ${HESAP.mentor.length} mentör, 16 jüri / 4 oda hazır`);
  return A;
}

// ---- Sanal kullanıcılar ----
let bitis = 0;
const devam = () => Date.now() < bitis;
const STATIK = ['', 'tema.css', 'ortak.css', 'tema.js', 'ortak.js', 'ikonlar.svg'];

// Tarayıcı gibi: görseller bir kez indirilir (sunucu 1 gün önbellek izni veriyor), sayfa dosyaları her açılışta istenir
async function ziyaretci() {
  const onbellek = new Set();
  const gorsel = yol => onbellek.has(yol) ? null : (onbellek.add(yol), istek('görsel', 'GET', yol, { tur: 'ham' }));
  await Promise.all(STATIK.map(s => istek('vitrin sayfası (statik)', 'GET', s, { tur: 'ham' })));
  const v = await istek('api/vitrin', 'GET', 'api/vitrin');
  // Ekranda ilk görünen kartların kapakları (lazy loading)
  const kapaklar = (v?.urunler || URUNLER).slice(0, 8).filter(u => u.kapak);
  await Promise.all(kapaklar.map(u => gorsel(`dosya/${u.id}/${u.kapak}`)));
  while (devam()) {
    await uyu(rast(3000, 9000));
    const u = sec(URUNLER);
    await istek('oyun sayfası (html)', 'GET', 'oyun/' + u.id, { tur: 'ham' });
    const d = await istek('api/urun', 'GET', 'api/urun/' + u.id);
    if (d?.urun?.kapak) await gorsel(`dosya/${u.id}/${d.urun.kapak}`);
    if (d?.urun?.gorseller?.length) await gorsel(`dosya/${u.id}/${d.urun.gorseller[0]}`);
    if (d?.urun?.oyun && Math.random() < .5) await istek('tarayıcı oyunu', 'GET', d.urun.oyun.adres.replace(/^https?:\/\/[^/]+\//, ''), { tur: 'ham' });
    if (Math.random() < .15) await istek('api/vitrin', 'GET', 'api/vitrin');
  }
}
async function giris(tur, h) {
  const d = await istek(`giriş (${tur})`, 'POST', `api/${tur}/giris`, { govde: { kullanici: h.id, sifre: h.sifre } });
  return d?.token;
}
// Mesaj kanalı açık: 5 sn'de bir yeni mesaj sorgusu (sohbet.js gibi)
async function sohbetDongusu(jeton, kanallar, yazmaAraligi, ekIs, yazilir = kanallar) {
  let son = {}, kanal = kanallar[0], sonYazma = Date.now() + rast(0, yazmaAraligi), sonEk = Date.now() + rast(0, 60000);
  const ilk = await istek('mesaj kanalı (ilk açılış)', 'GET', `api/mesaj?kanal=${encodeURIComponent(kanal)}`, { jeton });
  son[kanal] = ilk?.mesajlar?.at(-1)?.id || 0;
  while (devam()) {
    await uyu(rast(4500, 5500));
    if (Math.random() < .05) { kanal = sec(kanallar); }
    const d = await istek('mesaj yenileme (5 sn)', 'GET', `api/mesaj?kanal=${encodeURIComponent(kanal)}&sonra=${son[kanal] || 0}`, { jeton });
    if (d?.mesajlar?.length) son[kanal] = d.mesajlar.at(-1).id;
    if (Date.now() > sonYazma && yazilir.includes(kanal)) { await istek('mesaj gönderme', 'POST', 'api/mesaj', { jeton, govde: { kanal, metin: 'Yük testi mesajı ' + Math.random().toString(36).slice(2) } }); sonYazma = Date.now() + rast(yazmaAraligi * .5, yazmaAraligi * 1.5); }
    if (ekIs && Date.now() > sonEk) { await ekIs(); sonEk = Date.now() + rast(45000, 90000); }
  }
}
async function takim(h, n) {
  const j = await giris('takim', h); if (!j) return;
  await istek('takım paneli', 'GET', 'api/takim/ben', { jeton: j });
  await sohbetDongusu(j, [`t:${h.id}`, 'duyuru'], 60000, async () => {
    await istek('takım sayfa kaydı', 'PUT', 'api/takim/sayfa', { jeton: j, govde: { baslik: `Oyun ${n + 1}`, kisa: 'Güncellendi ' + Date.now(), aciklama: 'Açıklama '.repeat(100), uyeler: [{ ad: 'Ali', rol: 'Kod' }] } });
  }, [`t:${h.id}`]);
}
async function mentor(h) {
  const j = await giris('mentor', h); if (!j) return;
  await istek('mentör paneli', 'GET', 'api/mentor/durum', { jeton: j });
  const benim = HESAP.takim.filter((_, k) => k % HESAP.mentor.length === HESAP.mentor.indexOf(h)).map(t => `t:${t.id}`);
  await sohbetDongusu(j, [...benim, 'mentor', 'duyuru'], 45000, () => istek('mentör paneli', 'GET', 'api/mentor/durum', { jeton: j }));
}
async function juri(h) {
  const j = await giris('juri', h); if (!j) return;
  let d = await istek('jüri paneli', 'GET', 'api/juri/durum', { jeton: j });
  while (devam()) {
    await uyu(rast(12000, 25000));
    const u = d?.urunler?.length ? sec(d.urunler) : null;
    if (u) {
      await istek('api/urun', 'GET', 'api/urun/' + u.id, { jeton: j });
      const r = await istek('jüri oyu', 'PUT', 'api/juri/oy', { jeton: j, govde: { takim: u.id, scores: [15, 14, 16, 12, 18, 3], note: 'Yük testi' } });
      if (r) d = r;
    }
  }
}
async function yonetici(A) {
  while (devam()) {
    await istek('yönetim paneli (durum)', 'GET', 'api/admin/durum', { jeton: A });
    await uyu(rast(8000, 12000));
  }
}

// Olay yükü gecikmesi: hafif bir istek 500 ms'de bir; sunucu kilitlenirse burada görünür
async function nabiz() {
  while (devam()) { await istek('nabız (hafif istek)', 'GET', 'api/durum'); await uyu(500); }
}

// ---- Rapor ----
function yuzdelik(l, p) { if (!l.length) return 0; const s = [...l].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
function rapor(baslik, sure) {
  const satir = [];
  let top = 0, hata = 0;
  for (const [g, o] of Object.entries(olcum)) {
    if (g === 'hazırlık') continue;
    top += o.sure.length; hata += o.hata;
    satir.push([g, o.sure.length, o.hata, yuzdelik(o.sure, .5), yuzdelik(o.sure, .95), yuzdelik(o.sure, .99), Math.max(...o.sure), o.bayt, o.durum]);
  }
  satir.sort((a, b) => b[1] - a[1]);
  const p = (s, n) => String(s).padEnd(n), q = (s, n) => String(s).padStart(n);
  console.log(`\n=== ${baslik} ===`);
  console.log(p('İstek türü', 32) + q('adet', 8) + q('hata', 7) + q('p50 ms', 9) + q('p95 ms', 9) + q('p99 ms', 9) + q('en çok', 9));
  for (const s of satir) {
    console.log(p(s[0], 32) + q(s[1], 8) + q(s[2], 7) + q(Math.round(s[3]), 9) + q(Math.round(s[4]), 9) + q(Math.round(s[5]), 9) + q(Math.round(s[6]), 9)
      + (s[2] ? '  ' + JSON.stringify(s[8]) : ''));
  }
  const mb = satir.reduce((a, s) => a + s[7], 0) / 1048576;
  console.log(`Toplam ${top} istek, ${hata} hata (%${(hata / Math.max(1, top) * 100).toFixed(2)}), ${(top / sure).toFixed(1)} istek/sn, ${mb.toFixed(1)} MB veri`);
  if (kaynak.length) {
    const cpu = kaynak.map(k => k.cpu), bel = kaynak.map(k => k.mb);
    console.log(`Sunucu süreci: CPU ort. %${(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(0)}, en çok %${Math.max(...cpu).toFixed(0)} (tek çekirdek = %100) · bellek en çok ${Math.max(...bel).toFixed(0)} MB`);
  }
  for (const k of Object.keys(olcum)) if (k !== 'hazırlık') delete olcum[k];
  kaynak.length = 0;
}

// ---- Akış ----
(async () => {
  if (DIS_ADRES) {
    if (!process.argv.includes('--test-sunucusu')) throw new Error('Çalışan bir sunucuyu test etmek jüri listesini ve ayarları değiştirir. Yalnızca boş bir test kurulumunda, --test-sunucusu ile çalıştırın.');
    B = DIS_ADRES.replace(/\/?$/, '/'); YON_SIFRE = arg('sifre', process.env.ADMIN_SIFRE);
  } else {
    console.log('Geçici test sunucusu açılıyor (gerçek veriniz kullanılmaz)…');
    await sunucuAc();
  }
  console.log(`Veri hazırlanıyor (${TAKIM_SAYI} takım)…`);
  const A = await hazirla();

  // 1) Açılış anı: tüm takım, mentör ve jürilerin 10 saniye içinde giriş yapması
  const girenler = [...HESAP.takim.map(h => ['takim', h]), ...HESAP.mentor.map(h => ['mentor', h]), ...HESAP.juri.map(h => ['juri', h])];
  console.log(`\n1) Toplu giriş: ${girenler.length} hesap 10 saniye içinde giriş yapıyor; bu sırada vitrin ziyaretçileri de geliyor…`);
  bitis = Date.now() + 15000;
  const durKaynak1 = kaynakIzle();
  const t1 = Date.now();
  await Promise.all([
    nabiz(),
    ...girenler.map(async ([tur, h]) => { await uyu(rast(0, 10000)); await giris(tur, h); }),
    ...Array.from({ length: 100 }, async () => { await uyu(rast(0, 10000)); await istek('api/vitrin', 'GET', 'api/vitrin'); })
  ]);
  durKaynak1();
  rapor('Toplu giriş', (Date.now() - t1) / 1000);

  // 2) Sabit yük: KULLANICI kişi, ISINMA saniyede kademeli katılır, SURE saniye sürer
  const nT = Math.min(HESAP.takim.length, Math.round(KULLANICI * .14)), nM = HESAP.mentor.length, nJ = 16, nY = 4;
  const nZ = Math.max(0, KULLANICI - nT - nM - nJ - nY);
  console.log(`\n2) Sabit yük: ${KULLANICI} eşzamanlı kullanıcı (${nZ} ziyaretçi, ${nT} takım, ${nM} mentör, ${nJ} jüri, ${nY} yönetici)`);
  console.log(`   ${ISINMA} sn'de kademeli katılım, ardından ${SURE} sn sabit yük…`);
  bitis = Date.now() + (ISINMA + SURE) * 1000;
  const durKaynak2 = kaynakIzle();
  const t2 = Date.now();
  const gecik = fn => (async () => { await uyu(rast(0, ISINMA * 1000)); await fn(); })();
  await Promise.all([
    nabiz(),
    ...Array.from({ length: nZ }, () => gecik(ziyaretci)),
    ...HESAP.takim.slice(0, nT).map((h, i) => gecik(() => takim(h, i))),
    ...HESAP.mentor.slice(0, nM).map(h => gecik(() => mentor(h))),
    ...HESAP.juri.slice(0, nJ).map(h => gecik(() => juri(h))),
    ...Array.from({ length: nY }, () => gecik(() => yonetici(A)))
  ]);
  durKaynak2();
  rapor(`Sabit yük (${KULLANICI} kullanıcı)`, (Date.now() - t2) / 1000);
})().catch(e => { console.error('\nHata: ' + e.message); process.exitCode = 1; }).finally(sunucuKapat);
