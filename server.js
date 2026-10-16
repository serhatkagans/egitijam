// EğitiJAM Vitrin & Jüri Platformu - bağımlılıksız Node.js sunucusu
// Çalıştırma: baslat.bat (ya da npm start)  ->  http://localhost:3100
// Sunucu ayarları ortam değişkenlerinden / .env dosyasından okunur (bkz. .env.example).
// Etkinlik ayarları, takımlar, jüriler ve kriterler veritabanındadır; yönetim panelinden (/yonetim) değişir.
//
// Roller
//   ziyaretçi : giriş gerekmez; vitrini gezer, ürün sayfalarını açar, oyunları oynar
//   öğrenci   : kendi hesabını açar (/takim), takım kurar ya da takımın katılım koduyla katılır; takımın sayfasını düzenler
//   takım     : yöneticinin verdiği ortak kullanıcı adı + şifre ile de girilebilir (eski yöntem)
//   jüri      : ürünleri kriterlere göre puanlar (/juri)
//   yönetici  : her şey (/yonetim)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'egitijam.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const URUN_DIR = path.join(DATA_DIR, 'urunler'); // takımların yüklediği dosyalar: urunler/<takım>/...
const TMP_DIR = path.join(DATA_DIR, 'gecici');
const ARSIV_DIR = path.join(DATA_DIR, 'arsiv');  // geçmiş yıllardan içe aktarılan kapaklar
const EK_DIR = path.join(DATA_DIR, 'ekler');     // mesajlara eklenen dosyalar
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const MB = 1024 * 1024;
const LIMIT = {
  gorsel: 5 * MB,
  oyun: (Number(process.env.OYUN_MB) || 300) * MB,      // tarayıcı oyunu ZIP'i
  indir: (Number(process.env.INDIRME_MB) || 500) * MB,  // indirilebilir dosya (Windows sürümü vb.)
  acik: 1024 * MB,                                       // ZIP açıldığında toplam boyut
  ek: (Number(process.env.EK_MB) || 10) * MB             // mesaj eki
};
const MAX_GORSEL = 8;

// İsteğe bağlı: oyunlar ayrı bir alan adından sunulursa (ör. https://oyun.ornek.gov.tr) tam yetkiyle çalışır.
// Tanımlı değilse oyunlar ana sitede, tarayıcının "sandbox" yalıtımıyla çalışır (bkz. serveGame).
const OYUN_ADRESI = (process.env.OYUN_ADRESI || '').replace(/\/+$/, '');
const OYUN_HOST = OYUN_ADRESI ? new URL(OYUN_ADRESI).host : null;

fs.mkdirSync(URUN_DIR, { recursive: true });
fs.mkdirSync(ARSIV_DIR, { recursive: true });
fs.mkdirSync(EK_DIR, { recursive: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Kullanıcı adı Türkçe karakterle ya da boşluklu yazılsa da kabul edilir: "Ali Demir" -> "alidemir"
function normalizeUser(u) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
  return String(u || '').toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, c => map[c]).replace(/[^a-z0-9]/g, '');
}
const stripTitles = n => String(n || '').replace(/^(Prof\.|Doç\.|Dr\.|Öğr\. ?Gör\.|Arş\. ?Gör\.|\s)+/g, '');
const str = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const trKey = s => s.toLocaleLowerCase('tr');
const urlOk = u => /^https?:\/\/[^\s]+$/i.test(u);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Şifre deneme sınırı: bir IP 10 dakikada en fazla 10 hatalı deneme yapabilir
const failures = new Map();
const FAIL_LIMIT = 10, FAIL_WINDOW = 10 * 60 * 1000;
function clientIp(req) {
  const fwd = TRUST_PROXY && req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress;
}

// ---- Varsayılan ayarlar: yalnızca İLK çalıştırmada veritabanına yazılır ----
const TEMALAR = ['d', 'b']; // public/tema.css'teki [data-tema] blokları
const DEFAULTS = {
  event: {
    kurum: 'GençTek',
    ad: 'EğitiJAM 2026',
    donem: '2026', // vitrindeki yıl sekmesinin adı; geçmiş yıllar arşivde ayrı sekmelerde
    altBaslik: 'K12 Oyun Geliştirme Maratonu',
    tema: 'Tek Başına İşlemez',
    tarih: '23-25 Ocak 2026',
    baslangic: null,   // geri sayım: etkinliğin başlangıcı (ms), yoksa null
    bitis: null,       // geri sayım: teslim/bitiş anı (ms)
    aciklama: 'EğitiJAM, K12 öğrencilerini oyun sektörüyle tanıştırmak, oyun ekosistemini eğitim kurumları aracılığıyla büyütmek ve öğretmen-öğrenci etkileşimini güçlendirmek için düzenlenen 48 saatlik oyun geliştirme maratonudur. Takımlar danışman öğretmenleriyle birlikte verilen temaya uygun bir oyun geliştirir.',
    kurallar: 'Her takım en fazla 5 öğrenci ve 1 danışman öğretmenden oluşur ve tek proje ile katılır.\nHerhangi bir oyun motoru kullanılabilir; son sürüm Windows PC\'de çalışmalıdır.\nHazır asset ve yapay zekâ desteği serbesttir, ancak ürün sayfasında belirtilmelidir.\nProje EğitiJAM sürecinde geliştirilmiş olmalıdır.\nÜrün sayfasında ekip üyeleri, rolleri, tanıtım metni ve oynanış videosu bulunmalıdır.\nÇalışmayan, virüs ya da riskli dosya içeren veya uygunsuz içerikli oyunlar değerlendirme dışı kalır.\nİçerik; insan haklarına, eşitlik ilkelerine ve KVKK\'ya uygun olmalı, reklam, şiddet, korku, argo ve cinsel içerik barındırmamalıdır.'
  },
  juries: [],
  criteria: [ // ek: toplamın üstüne eklenen bonus kriter (100 + 5 gibi gösterilir)
    { name: 'Tema ile Uyum', short: 'Tema', max: 20, ek: false },
    { name: 'Oynanış', short: 'Oynanış', max: 20, ek: false },
    { name: 'Naratif (hikâyesi yoksa konsept)', short: 'Naratif', max: 20, ek: false },
    { name: 'Görsel Tasarım', short: 'Görsel', max: 20, ek: false },
    { name: 'İşitsel Tasarım', short: 'İşitsel', max: 20, ek: false },
    { name: 'Jüri Özel Seçimi / EğitiJAM Ruhu', short: 'Jüri Özel', max: 5, ek: true }
  ],
  teslimAcik: true,    // takımlar sayfalarını düzenleyebilir / dosya yükleyebilir
  oylamaAcik: false,   // jüriler puan verebilir
  sonuclarAcik: false, // ödüller vitrinde görünür
  mentorKayit: false,  // mentörler kendi takımlarını oluşturabilir
  ogrenciKayit: true,  // öğrenciler kendi hesabını açıp katılım koduyla takıma katılabilir
  ogrenciTakim: true,  // öğrenciler yeni takım kurabilir (kapalıysa yalnızca yönetimin/mentörün açtığı takımlara katılır)
  genelSohbet: true,   // Genel sohbet kanalına takımlar ve mentörler yazabilir (kapalıysa yalnızca okur)
  temaGizle: true,     // tema, geri sayımdaki başlangıç anına kadar yönetim dışındakilerden gizlenir
  geriBildirimAcik: false, // jürilerin "takıma geri bildirim" yazıları takım panelinde (isimsiz) görünür
  yasakKelimeler: [],  // sohbette yıldızlanacak ek kelimeler (yerleşik listeye eklenir)
  // Jüri odaları: oda varsa jüriler yalnızca kendi odalarındaki takımları puanlar (ön eleme),
  // finalde tüm jüriler finalistleri puanlar. Oda yoksa tüm jüriler tüm takımları puanlar.
  odalar: [],          // [{ id, ad }]; jürinin odası juries[].oda, takımınki oda_takim tablosunda
  asama: 'on',         // 'on' (ön eleme) | 'final'
  finalistler: [],     // takım kimlikleri
  finalSayi: 2,        // her odadan finale çıkacak takım sayısı (öneri)
  tema: 'd'
};

// ---- Veritabanı (Node'un yerleşik SQLite modülü) ----
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
let txDepth = 0;
function tx(fn) {
  if (txDepth) return fn();
  db.exec('BEGIN'); txDepth++;
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth--; }
}

db.exec(`
CREATE TABLE IF NOT EXISTS ayarlar (anahtar TEXT PRIMARY KEY, deger TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS takimlar (
  id         TEXT PRIMARY KEY,   -- kullanıcı adı, aynı zamanda ürün adresi: /oyun/<id>
  ad         TEXT NOT NULL,
  il         TEXT NOT NULL DEFAULT '',
  okul       TEXT NOT NULL DEFAULT '',
  danisman   TEXT NOT NULL DEFAULT '',
  sifre      TEXT NOT NULL,      -- scrypt özeti
  sayfa      TEXT NOT NULL DEFAULT '{}',
  yayinda    INTEGER NOT NULL DEFAULT 1,
  rozet      TEXT NOT NULL DEFAULT '',  -- ödül/derece (sonuçlar açıklanınca vitrinde görünür)
  olusturma  INTEGER NOT NULL,
  guncelleme INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS oylar (
  juri    TEXT NOT NULL,
  takim   TEXT NOT NULL,
  tur     TEXT NOT NULL DEFAULT 'on',  -- 'on' (ön eleme / tek aşama) | 'final'
  puanlar TEXT NOT NULL,
  toplam  INTEGER NOT NULL,
  notu    TEXT NOT NULL DEFAULT '',
  zaman   INTEGER NOT NULL,
  PRIMARY KEY (juri, takim, tur)
);
CREATE TABLE IF NOT EXISTS oda_takim (takim TEXT PRIMARY KEY, oda TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oturumlar (ozet TEXT PRIMARY KEY, kim TEXT NOT NULL, bitis INTEGER NOT NULL);
-- Geçmiş yıllar: itch.io jam sayfalarından içe aktarılan oyunlar (oyunun kendisi itch.io'da kalır)
CREATE TABLE IF NOT EXISTS arsiv (
  donem     TEXT NOT NULL,     -- '2025' gibi
  itch_id   INTEGER NOT NULL,
  baslik    TEXT NOT NULL,
  kisa      TEXT NOT NULL DEFAULT '',
  yapimci   TEXT NOT NULL DEFAULT '',  -- itch.io kullanıcı adları
  baglanti  TEXT NOT NULL,             -- oyunun itch.io sayfası
  kapak     TEXT,                      -- ARSIV_DIR içindeki dosya adı
  platform  TEXT NOT NULL DEFAULT '[]',
  rozet     TEXT NOT NULL DEFAULT '',
  gizli     INTEGER NOT NULL DEFAULT 0,
  sira      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (donem, itch_id)
);
-- Mentörler: takımlara destek veren öğretmen/uzmanlar. Atandıkları takımların sayfasını düzenleyebilir.
CREATE TABLE IF NOT EXISTS mentorler (
  id         TEXT PRIMARY KEY,
  ad         TEXT NOT NULL,
  alan       TEXT NOT NULL DEFAULT '',  -- uzmanlık: Programlama, Görsel tasarım, Ses …
  sifre      TEXT NOT NULL,
  olusturma  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mentor_takim (mentor TEXT NOT NULL, takim TEXT NOT NULL, PRIMARY KEY (mentor, takim));
-- Öğrenciler: her öğrencinin kendi hesabı vardır; takıma katılım koduyla girer. Takımı kuran (ya da ilk katılan) kaptandır.
CREATE TABLE IF NOT EXISTS ogrenciler (
  id         TEXT PRIMARY KEY,   -- kullanıcı adı
  ad         TEXT NOT NULL,
  sifre      TEXT NOT NULL,
  takim      TEXT,               -- henüz takımı yoksa NULL
  kaptan     INTEGER NOT NULL DEFAULT 0,
  katilma    INTEGER NOT NULL DEFAULT 0,
  olusturma  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ogrenciler_takim ON ogrenciler (takim);
-- Mesajlaşma: kanal 'duyuru' | 'mentor' (mentör odası) | 't:<takım>' (takımın kendi kanalı)
--   | 'juri' (tüm jüriler + yönetim) | 'oda:<oda>' (jüri odasının kanalı)
CREATE TABLE IF NOT EXISTS mesajlar (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kanal   TEXT NOT NULL,
  kim     TEXT NOT NULL,     -- oturum kimliği: '@admin' | 'm:<mentör>' | 't:<takım>'
  ad      TEXT NOT NULL,     -- yazıldığı andaki görünen ad
  rol     TEXT NOT NULL,     -- 'admin' | 'mentor' | 'takim' | 'juri'
  metin   TEXT NOT NULL,
  yardim  INTEGER NOT NULL DEFAULT 0,  -- takımın yardım çağrısı
  zaman   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mesajlar_kanal ON mesajlar (kanal, id);
CREATE TABLE IF NOT EXISTS okunan (kim TEXT NOT NULL, kanal TEXT NOT NULL, son INTEGER NOT NULL, PRIMARY KEY (kim, kanal));
-- Mesaja verilen emoji tepkileri
CREATE TABLE IF NOT EXISTS tepkiler (mesaj INTEGER NOT NULL, kim TEXT NOT NULL, ad TEXT NOT NULL, emoji TEXT NOT NULL, zaman INTEGER NOT NULL,
  PRIMARY KEY (mesaj, kim, emoji));
-- @bahsetmeler: kim '*' ise kanaldaki herkes (@herkes)
CREATE TABLE IF NOT EXISTS bahsetmeler (mesaj INTEGER NOT NULL, kanal TEXT NOT NULL, kim TEXT NOT NULL, PRIMARY KEY (mesaj, kim));
CREATE INDEX IF NOT EXISTS bahsetmeler_kim ON bahsetmeler (kim, kanal);
-- Mesaj ekleri: dosya EK_DIR/<id> adıyla saklanır; mesaj NULL ise henüz gönderilmemiş (yazma alanında bekliyor)
CREATE TABLE IF NOT EXISTS ekler (id TEXT PRIMARY KEY, mesaj INTEGER, kanal TEXT NOT NULL, kim TEXT NOT NULL, ad TEXT NOT NULL,
  boyut INTEGER NOT NULL, gorsel INTEGER NOT NULL DEFAULT 0, zaman INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ekler_mesaj ON ekler (mesaj);
-- Moderasyon: bildirilen mesajlar ve susturulan kişiler (bitis'e kadar yazamaz, tepki veremez)
CREATE TABLE IF NOT EXISTS bildirimler (mesaj INTEGER NOT NULL, kim TEXT NOT NULL, ad TEXT NOT NULL, neden TEXT NOT NULL DEFAULT '', zaman INTEGER NOT NULL,
  PRIMARY KEY (mesaj, kim));
CREATE TABLE IF NOT EXISTS susturmalar (kim TEXT PRIMARY KEY, ad TEXT NOT NULL, bitis INTEGER NOT NULL, neden TEXT NOT NULL DEFAULT '', zaman INTEGER NOT NULL);
-- Jürinin takıma yazdığı geri bildirim. Puanlar ve jürinin özel notu gizli kalır; yönetim açınca takım isimsiz görür.
CREATE TABLE IF NOT EXISTS geribildirimler (juri TEXT NOT NULL, takim TEXT NOT NULL, metin TEXT NOT NULL, zaman INTEGER NOT NULL, PRIMARY KEY (juri, takim));
`);

// Eski veritabanı: mesajlara yanıt, düzenleme ve silme bilgisi eklenir.
// surum: mesaj düzenlenince, silinince ya da tepki alınca artar; istemciler değişenleri bununla çeker.
{
  const cols = new Set(db.prepare('PRAGMA table_info(mesajlar)').all().map(c => c.name));
  if (!cols.has('yanit')) db.exec('ALTER TABLE mesajlar ADD COLUMN yanit INTEGER');
  if (!cols.has('duzenlendi')) db.exec('ALTER TABLE mesajlar ADD COLUMN duzenlendi INTEGER');
  if (!cols.has('silindi')) db.exec('ALTER TABLE mesajlar ADD COLUMN silindi INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('surum')) db.exec('ALTER TABLE mesajlar ADD COLUMN surum INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('uye')) db.exec('ALTER TABLE mesajlar ADD COLUMN uye TEXT'); // takım mesajını yazan öğrenci
  db.exec('CREATE INDEX IF NOT EXISTS mesajlar_surum ON mesajlar (kanal, surum)');
}

// Eski veritabanı: takımların katılım kodu yoksa eklenir (kodlar aşağıda, takım sorgularından sonra üretilir)
if (!db.prepare('PRAGMA table_info(takimlar)').all().some(c => c.name === 'kod')) db.exec('ALTER TABLE takimlar ADD COLUMN kod TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS takimlar_kod ON takimlar (kod)');

// Eski veritabanı: oylar tablosunda aşama sütunu yoksa tablo yeniden kurulur, oylar ön eleme sayılır
if (!db.prepare('PRAGMA table_info(oylar)').all().some(c => c.name === 'tur')) {
  tx(() => db.exec(`
    ALTER TABLE oylar RENAME TO oylar_eski;
    CREATE TABLE oylar (juri TEXT NOT NULL, takim TEXT NOT NULL, tur TEXT NOT NULL DEFAULT 'on', puanlar TEXT NOT NULL,
      toplam INTEGER NOT NULL, notu TEXT NOT NULL DEFAULT '', zaman INTEGER NOT NULL, PRIMARY KEY (juri, takim, tur));
    INSERT INTO oylar (juri, takim, tur, puanlar, toplam, notu, zaman) SELECT juri, takim, 'on', puanlar, toplam, notu, zaman FROM oylar_eski;
    DROP TABLE oylar_eski;`));
}

const getSetting = db.prepare('SELECT deger FROM ayarlar WHERE anahtar = ?');
const putSetting = db.prepare(`INSERT INTO ayarlar (anahtar, deger) VALUES (?, ?)
  ON CONFLICT (anahtar) DO UPDATE SET deger = excluded.deger`);
const readSetting = (k, def) => { const r = getSetting.get(k); return r ? JSON.parse(r.deger) : def; };
const writeSetting = (k, v) => putSetting.run(k, JSON.stringify(v));

let CFG = readSetting('ayarlar', null);
if (!CFG) { CFG = structuredClone(DEFAULTS); writeSetting('ayarlar', CFG); }
CFG = { ...structuredClone(DEFAULTS), ...CFG, event: { ...DEFAULTS.event, ...CFG.event } };
const saveCfg = () => writeSetting('ayarlar', CFG);

// Şifreler istemciye hiç gitmez; yalnızca scrypt özetleri saklanır.
// ortak: jürilerin ortak şifresi (.env JURI_SIFRE yerine geçer), juri[id]: jüriye özel şifre, admin: yönetici
let SECRETS = { ortak: null, admin: null, juri: {}, ...readSetting('sifreler', {}) };
const saveSecrets = () => writeSetting('sifreler', SECRETS);

// scryptSync bir şifre için ~30 ms sunucuyu kilitler; girişlerde ve toplu işlemlerde eşzamansız sürüm kullanılır
const scryptAsync = (p, salt) => new Promise((ok, no) => crypto.scrypt(String(p), salt, 32, (e, k) => e ? no(e) : ok(k)));
async function hashPwAsync(p) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + (await scryptAsync(p, salt)).toString('hex');
}
function hashPw(p) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(String(p), salt, 32).toString('hex');
}
async function checkPw(p, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const x = await scryptAsync(p, Buffer.from(salt, 'hex'));
  return crypto.timingSafeEqual(x, Buffer.from(hash, 'hex'));
}
// Takımlara verilen şifre: karışmayan harf ve rakamlar (0/O, 1/l/I yok)
function newPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(8), b => abc[b % abc.length]).join('');
}
async function juryPasswordOk(u, p) {
  const h = SECRETS.juri[u] || SECRETS.ortak;
  if (h) return checkPw(p, h);
  return !!process.env.JURI_SIFRE && safeEqual(process.env.JURI_SIFRE, p);
}
const adminConfigured = () => !!(SECRETS.admin || process.env.ADMIN_SIFRE);
async function adminPasswordOk(p) {
  if (SECRETS.admin) return checkPw(p, SECRETS.admin);
  return !!process.env.ADMIN_SIFRE && safeEqual(process.env.ADMIN_SIFRE, p);
}

const JURY_NAME = () => Object.fromEntries(CFG.juries.map(j => [j.id, j.name]));
const CRITERIA = () => CFG.criteria;
const maxTotals = () => ({
  ana: CFG.criteria.filter(c => !c.ek).reduce((a, c) => a + c.max, 0),
  ek: CFG.criteria.filter(c => c.ek).reduce((a, c) => a + c.max, 0)
});

// ---- Takımlar ----
const Q = {
  team: db.prepare('SELECT * FROM takimlar WHERE id = ?'),
  teams: db.prepare('SELECT * FROM takimlar ORDER BY ad COLLATE NOCASE'),
  insertTeam: db.prepare(`INSERT INTO takimlar (id, ad, il, okul, danisman, sifre, sayfa, yayinda, rozet, olusturma, guncelleme, kod)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  teamByCode: db.prepare('SELECT * FROM takimlar WHERE kod = ?'),
  setCode: db.prepare('UPDATE takimlar SET kod = ? WHERE id = ?'),
  updateTeamInfo: db.prepare('UPDATE takimlar SET ad = ?, il = ?, okul = ?, danisman = ?, yayinda = ?, rozet = ? WHERE id = ?'),
  updatePage: db.prepare('UPDATE takimlar SET sayfa = ?, guncelleme = ? WHERE id = ?'),
  setTeamPw: db.prepare('UPDATE takimlar SET sifre = ? WHERE id = ?'),
  renameTeam: db.prepare('UPDATE takimlar SET id = ? WHERE id = ?'),
  deleteTeam: db.prepare('DELETE FROM takimlar WHERE id = ?'),
  votes: db.prepare('SELECT * FROM oylar'),
  upsertVote: db.prepare(`INSERT INTO oylar (juri, takim, tur, puanlar, toplam, notu, zaman) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (juri, takim, tur) DO UPDATE SET puanlar = excluded.puanlar, toplam = excluded.toplam, notu = excluded.notu, zaman = excluded.zaman`),
  deleteVote: db.prepare('DELETE FROM oylar WHERE juri = ? AND takim = ? AND tur = ?'),
  rooms: db.prepare('SELECT * FROM oda_takim'),
  setRoom: db.prepare('INSERT INTO oda_takim (takim, oda) VALUES (?, ?) ON CONFLICT (takim) DO UPDATE SET oda = excluded.oda'),
  clearRoom: db.prepare('DELETE FROM oda_takim WHERE takim = ?'),
  insertSession: db.prepare('INSERT INTO oturumlar (ozet, kim, bitis) VALUES (?, ?, ?)'),
  session: db.prepare('SELECT kim, bitis FROM oturumlar WHERE ozet = ?'),
  deleteSession: db.prepare('DELETE FROM oturumlar WHERE ozet = ?'),
  deleteSessionsOf: db.prepare('DELETE FROM oturumlar WHERE kim = ?'),
  purgeSessions: db.prepare('DELETE FROM oturumlar WHERE bitis < ?'),
  sessionCounts: db.prepare('SELECT kim, COUNT(*) AS n FROM oturumlar WHERE bitis >= ? GROUP BY kim')
};

// Katılım kodu: 6 karakter, karışmayan harf ve rakamlar; "K7M-Q2X" biçiminde gösterilir, tire ve boşluk önemsenmez
const normCode = k => String(k || '').toLocaleUpperCase('en').replace(/[^A-Z0-9]/g, '');
function newCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const k = Array.from(crypto.randomBytes(6), b => abc[b % abc.length]).join('');
    if (!Q.teamByCode.get(k)) return k;
  }
}
for (const r of db.prepare('SELECT id FROM takimlar WHERE kod IS NULL').all()) Q.setCode.run(newCode(), r.id);

const teamDir = id => path.join(URUN_DIR, id);
const pageOf = row => { try { return JSON.parse(row.sayfa) || {}; } catch { return {}; } };
function getTeam(id) {
  const row = typeof id === 'string' && Q.team.get(id);
  if (!row) fail(404, 'Takım bulunamadı');
  return row;
}
function savePage(id, page) { Q.updatePage.run(JSON.stringify(page), Date.now(), id); }

// Vitrinde görünen kısa bilgi
function cardOf(row) {
  const p = pageOf(row);
  return {
    id: row.id, takim: row.ad, il: row.il, okul: row.okul,
    baslik: p.baslik || '', kisa: p.kisa || '', kapak: p.kapak || null, etiketler: p.etiketler || [],
    oyun: !!p.oyun, indir: !!p.indir, baglanti: !!p.baglanti, video: !!p.video,
    rozet: CFG.sonuclarAcik ? row.rozet : '', guncelleme: row.guncelleme
  };
}
// Ürün sayfası: yalnızca yayında olan ve başlığı girilmiş ürünler herkese açıktır
const isPublic = row => row.yayinda && !!pageOf(row).baslik;
function productOf(row) {
  const p = pageOf(row);
  return {
    ...cardOf(row), danisman: row.danisman,
    aciklama: p.aciklama || '', kontroller: p.kontroller || '', krediler: p.krediler || '',
    uyeler: p.uyeler || [], gorseller: p.gorseller || [], video: p.video || '', baglanti: p.baglanti || '',
    oyun: p.oyun ? { giris: p.oyun.giris, en: p.oyun.en, boy: p.oyun.boy, adres: gameUrl(row.id, p.oyun) } : null,
    indir: p.indir ? { ad: p.indir.ad, boyut: p.indir.boyut } : null,
    yayinda: !!row.yayinda
  };
}
const gameUrl = (id, g) => `${OYUN_ADRESI ? OYUN_ADRESI + '/' : ''}oyunlar/${id}/${g.giris.split('/').map(encodeURIComponent).join('/')}?v=${g.zaman}`;

// Takım sayfasının metin alanları (dosyalar ayrı uç noktalardan yüklenir)
function cleanPage(b, old) {
  const list = (v, n) => Array.isArray(v) ? v.slice(0, n) : [];
  const link = (v, ad) => { const u = str(v, 400); if (u && !urlOk(u)) fail(400, `${ad} http:// ya da https:// ile başlamalı`); return u; };
  const page = {
    ...old,
    baslik: str(b.baslik, 80),
    kisa: str(b.kisa, 160),
    aciklama: str(b.aciklama, 8000),
    kontroller: str(b.kontroller, 1500),
    krediler: str(b.krediler, 3000),
    etiketler: [...new Set(list(b.etiketler, 6).map(t => str(t, 24)).filter(Boolean))],
    uyeler: list(b.uyeler, 8).map(u => ({ ad: str(u && u.ad, 60), rol: str(u && u.rol, 80) })).filter(u => u.ad),
    video: link(b.video, 'Video bağlantısı'),
    baglanti: link(b.baglanti, 'Dış bağlantı')
  };
  if (old.oyun && b.oyunBoyut) {
    const en = Number(b.oyunBoyut.en), boy = Number(b.oyunBoyut.boy);
    if (!(en >= 320 && en <= 1920 && boy >= 240 && boy <= 1200)) fail(400, 'Oyun alanı en 320-1920, boy 240-1200 piksel olmalı');
    page.oyun = { ...old.oyun, en: Math.round(en), boy: Math.round(boy) };
  }
  return page;
}

// Yeni takım; kullanıcı adı boşsa takım adından üretilir, çakışırsa sonuna sayı eklenir
function createTeam({ ad, il, okul, danisman, kullanici }, hazir) {
  ad = str(ad, 80); il = str(il, 40); okul = str(okul, 120); danisman = str(danisman, 80);
  if (!ad) fail(400, 'Takım adı boş bırakılamaz');
  let base = normalizeUser(kullanici) || normalizeUser(ad) || 'takim';
  base = base.slice(0, 30);
  let id = base;
  if (kullanici && (Q.team.get(id) || OQ.get.get(id))) fail(409, `"${id}" kullanıcı adı kullanılıyor`);
  for (let i = 2; Q.team.get(id) || OQ.get.get(id) || JURY_NAME()[id]; i++) id = `${base}${i}`;
  const sifre = hazir ? hazir.sifre : newPassword(), now = Date.now(), kod = newCode();
  Q.insertTeam.run(id, ad, il, okul, danisman, hazir ? hazir.ozet : hashPw(sifre), '{}', 1, '', now, 0, kod);
  return { id, ad, il, okul, sifre, kod };
}

// Toplu ekleme: her satır "Takım adı; İl; Okul; Danışman öğretmen" (Excel'den yapıştırılırsa sekmeyle ayrılır)
// Şifre ve özetleri iş parçacıklarında üretir (toplu eklemede sunucu kilitlenmesin)
const passwordsFor = n => Promise.all(Array.from({ length: n }, async () => { const sifre = newPassword(); return { sifre, ozet: await hashPwAsync(sifre) }; }));
async function createTeamsBulk(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) fail(400, 'Eklenecek satır yok');
  if (lines.length > 1000) fail(400, 'Tek seferde en fazla 1000 takım eklenebilir');
  const pw = await passwordsFor(lines.length);
  return tx(() => lines.map((l, i) => {
    const [ad, il, okul, danisman] = l.split(/\t|;/).map(s => s.trim());
    return createTeam({ ad, il, okul, danisman }, pw[i]);
  }));
}

function renameTeamId(oldId, newId) {
  newId = normalizeUser(newId).slice(0, 30);
  if (!newId) fail(400, 'Kullanıcı adı boş olamaz');
  if (newId === oldId) return oldId;
  if (Q.team.get(newId) || OQ.get.get(newId)) fail(409, `"${newId}" kullanıcı adı kullanılıyor`);
  tx(() => {
    Q.renameTeam.run(newId, oldId);
    db.prepare('UPDATE oylar SET takim = ? WHERE takim = ?').run(newId, oldId);
    db.prepare('UPDATE mentor_takim SET takim = ? WHERE takim = ?').run(newId, oldId);
    db.prepare('UPDATE oda_takim SET takim = ? WHERE takim = ?').run(newId, oldId);
    db.prepare('UPDATE mesajlar SET kanal = ? WHERE kanal = ?').run(`t:${newId}`, `t:${oldId}`);
    db.prepare('UPDATE mesajlar SET kim = ? WHERE kim = ?').run(`t:${newId}`, `t:${oldId}`);
    db.prepare('UPDATE okunan SET kanal = ? WHERE kanal = ?').run(`t:${newId}`, `t:${oldId}`);
    db.prepare('UPDATE okunan SET kim = ? WHERE kim = ?').run(`t:${newId}`, `t:${oldId}`);
    db.prepare('UPDATE mesajlar SET metin = replace(metin, ?, ?) WHERE instr(metin, ?) > 0').run(`<@t:${oldId}>`, `<@t:${newId}>`, `<@t:${oldId}>`);
    for (const tablo of ['tepkiler', 'bahsetmeler', 'ekler']) db.prepare(`UPDATE ${tablo} SET kim = ? WHERE kim = ?`).run(`t:${newId}`, `t:${oldId}`);
    for (const tablo of ['bahsetmeler', 'ekler']) db.prepare(`UPDATE ${tablo} SET kanal = ? WHERE kanal = ?`).run(`t:${newId}`, `t:${oldId}`);
    for (const tablo of ['bildirimler', 'susturmalar']) db.prepare(`UPDATE ${tablo} SET kim = ? WHERE kim = ?`).run(`t:${newId}`, `t:${oldId}`);
    db.prepare('UPDATE geribildirimler SET takim = ? WHERE takim = ?').run(newId, oldId);
    db.prepare('UPDATE ogrenciler SET takim = ? WHERE takim = ?').run(newId, oldId);
    Q.deleteSessionsOf.run(`t:${oldId}`);
  });
  if (CFG.finalistler.includes(oldId)) { CFG.finalistler = CFG.finalistler.map(x => x === oldId ? newId : x); saveCfg(); }
  if (fs.existsSync(teamDir(oldId))) fs.renameSync(teamDir(oldId), teamDir(newId));
  return newId;
}

function removeTeam(id) {
  getTeam(id);
  tx(() => {
    Q.deleteTeam.run(id);
    db.prepare('DELETE FROM oylar WHERE takim = ?').run(id);
    db.prepare('DELETE FROM mentor_takim WHERE takim = ?').run(id);
    db.prepare('DELETE FROM geribildirimler WHERE takim = ?').run(id);
    db.prepare('UPDATE ogrenciler SET takim = NULL, kaptan = 0 WHERE takim = ?').run(id); // öğrenciler hesaplarını korur, takımsız kalır
    db.prepare('DELETE FROM susturmalar WHERE kim = ?').run(`t:${id}`);
    Q.clearRoom.run(id);
    purgeChannel(`t:${id}`);
    db.prepare('DELETE FROM okunan WHERE kanal = ? OR kim = ?').run(`t:${id}`, `t:${id}`);
    Q.deleteSessionsOf.run(`t:${id}`);
  });
  if (CFG.finalistler.includes(id)) { CFG.finalistler = CFG.finalistler.filter(x => x !== id); saveCfg(); }
  fs.rmSync(teamDir(id), { recursive: true, force: true });
}

// ---- Mentörler ----
const MQ = {
  get: db.prepare('SELECT * FROM mentorler WHERE id = ?'),
  all: db.prepare('SELECT * FROM mentorler ORDER BY ad COLLATE NOCASE'),
  insert: db.prepare('INSERT INTO mentorler (id, ad, alan, sifre, olusturma) VALUES (?, ?, ?, ?, ?)'),
  update: db.prepare('UPDATE mentorler SET ad = ?, alan = ? WHERE id = ?'),
  setPw: db.prepare('UPDATE mentorler SET sifre = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM mentorler WHERE id = ?'),
  teamsOf: db.prepare('SELECT takim FROM mentor_takim WHERE mentor = ?'),
  assignments: db.prepare('SELECT * FROM mentor_takim'),
  assigned: db.prepare('SELECT 1 FROM mentor_takim WHERE mentor = ? AND takim = ?'),
  assign: db.prepare('INSERT OR IGNORE INTO mentor_takim (mentor, takim) VALUES (?, ?)'),
  unassignAll: db.prepare('DELETE FROM mentor_takim WHERE mentor = ?')
};
function getMentor(id) {
  const row = typeof id === 'string' && MQ.get.get(id);
  if (!row) fail(404, 'Mentör bulunamadı');
  return row;
}
const mentorTeams = id => MQ.teamsOf.all(id).map(r => r.takim);
const isAssigned = (mentor, takim) => !!MQ.assigned.get(mentor, takim);

function createMentor({ ad, alan, kullanici }, hazir) {
  ad = str(ad, 80); alan = str(alan, 80);
  if (!ad) fail(400, 'Mentör adı boş bırakılamaz');
  let base = (normalizeUser(kullanici) || normalizeUser(stripTitles(ad)) || 'mentor').slice(0, 30), id = base;
  if (kullanici && MQ.get.get(id)) fail(409, `"${id}" kullanıcı adı kullanılıyor`);
  for (let i = 2; MQ.get.get(id); i++) id = `${base}${i}`;
  const sifre = hazir ? hazir.sifre : newPassword();
  MQ.insert.run(id, ad, alan, hazir ? hazir.ozet : hashPw(sifre), Date.now());
  return { id, ad, alan, sifre };
}
// Her satır "Ad Soyad; Uzmanlık alanı"
async function createMentorsBulk(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) fail(400, 'Eklenecek satır yok');
  if (lines.length > 500) fail(400, 'Tek seferde en fazla 500 mentör eklenebilir');
  const pw = await passwordsFor(lines.length);
  return tx(() => lines.map((l, i) => { const [ad, alan] = l.split(/\t|;/).map(s => s.trim()); return createMentor({ ad, alan }, pw[i]); }));
}
function updateMentor({ id, ad, alan, takimlar }) {
  const row = getMentor(id);
  ad = str(ad, 80);
  if (!ad) fail(400, 'Mentör adı boş bırakılamaz');
  tx(() => {
    MQ.update.run(ad, str(alan, 80), row.id);
    if (Array.isArray(takimlar)) {
      MQ.unassignAll.run(row.id);
      for (const t of takimlar) if (typeof t === 'string' && Q.team.get(t)) MQ.assign.run(row.id, t);
    }
  });
}
function removeMentor(id) {
  getMentor(id);
  tx(() => {
    MQ.remove.run(id); MQ.unassignAll.run(id);
    db.prepare('DELETE FROM okunan WHERE kim = ?').run(`m:${id}`);
    Q.deleteSessionsOf.run(`m:${id}`);
  });
}

// ---- Öğrenciler ----
// Her öğrenci kendi hesabıyla girer. Takımı kuran öğrenci kaptan olur; diğerleri takımın katılım koduyla katılır.
// Takıma katılan öğrencinin adı, takım sayfasının Ekip bölümüne kendiliğinden eklenir (görevini takım yazar).
const MAX_OGRENCI = 5; // kurallar: takım başına en fazla 5 öğrenci (danışman öğretmen ayrıca)
const OQ = {
  get: db.prepare('SELECT * FROM ogrenciler WHERE id = ?'),
  all: db.prepare('SELECT * FROM ogrenciler ORDER BY ad COLLATE NOCASE'),
  ofTeam: db.prepare('SELECT * FROM ogrenciler WHERE takim = ? ORDER BY kaptan DESC, katilma, ad COLLATE NOCASE'),
  count: db.prepare('SELECT COUNT(*) AS n FROM ogrenciler WHERE takim = ?'),
  insert: db.prepare('INSERT INTO ogrenciler (id, ad, sifre, takim, kaptan, katilma, olusturma) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  setTeam: db.prepare('UPDATE ogrenciler SET takim = ?, kaptan = ?, katilma = ? WHERE id = ?'),
  setCaptain: db.prepare('UPDATE ogrenciler SET kaptan = ? WHERE id = ?'),
  setPw: db.prepare('UPDATE ogrenciler SET sifre = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM ogrenciler WHERE id = ?')
};
function getStudent(id) {
  const row = typeof id === 'string' && OQ.get.get(id);
  if (!row) fail(404, 'Öğrenci bulunamadı');
  return row;
}
const studentsOf = takim => OQ.ofTeam.all(takim).map(o => ({ id: o.id, ad: o.ad, kaptan: !!o.kaptan }));

async function createStudent({ ad, kullanici, sifre }) {
  ad = str(ad, 60);
  const id = normalizeUser(kullanici).slice(0, 30);
  if (!ad) fail(400, 'Adınızı ve soyadınızı yazın');
  if (id.length < 3) fail(400, 'Kullanıcı adı en az 3 harf ya da rakam olmalı');
  if (String(sifre || '').length < 6) fail(400, 'Şifre en az 6 karakter olmalı');
  if (OQ.get.get(id) || Q.team.get(id)) fail(409, `"${id}" kullanıcı adı alınmış, başka bir ad seçin`);
  OQ.insert.run(id, ad, await hashPwAsync(sifre), null, 0, 0, Date.now());
  return OQ.get.get(id);
}

// Takım sayfasının Ekip listesinde öğrencinin satırı (sayfanın güncelleme zamanı değişmez)
function syncMember(takim, ad, ekle) {
  const row = Q.team.get(takim);
  if (!row) return;
  const p = pageOf(row), l = p.uyeler || [], var_ = l.some(u => trKey(u.ad) === trKey(ad));
  if (ekle && !var_ && l.length < 8) p.uyeler = [...l, { ad, rol: '' }];
  else if (!ekle && var_) p.uyeler = l.filter(u => trKey(u.ad) !== trKey(ad));
  else return;
  Q.updatePage.run(JSON.stringify(p), row.guncelleme, takim);
}
function joinTeam(ogr, takim) {
  if (ogr.takim) fail(400, 'Zaten bir takımdasınız. Başka takıma geçmek için önce takımdan ayrılın.');
  if (OQ.count.get(takim).n >= MAX_OGRENCI) fail(400, `Takım dolu: bir takımda en fazla ${MAX_OGRENCI} öğrenci olabilir`);
  tx(() => {
    OQ.setTeam.run(takim, OQ.count.get(takim).n ? 0 : 1, Date.now(), ogr.id); // takımın ilk öğrencisi kaptandır
    syncMember(takim, ogr.ad, true);
  });
}
function leaveTeam(ogr) {
  if (!ogr.takim) return;
  tx(() => {
    OQ.setTeam.run(null, 0, 0, ogr.id);
    syncMember(ogr.takim, ogr.ad, false);
    // Kaptan ayrılırsa kaptanlık takıma en önce katılan öğrenciye geçer
    const kalan = OQ.ofTeam.all(ogr.takim);
    if (ogr.kaptan && kalan.length && !kalan.some(o => o.kaptan)) OQ.setCaptain.run(1, kalan[0].id);
  });
}
function removeStudent(id) {
  const o = getStudent(id);
  tx(() => { leaveTeam(o); OQ.remove.run(o.id); Q.deleteSessionsOf.run(`s:${o.id}`); });
}

// Takım sayfasının kontrol listesi (takım panelindeki listeyle aynı maddeler)
function pageProgress(p) {
  const uyeler = p.uyeler || [];
  const m = [p.baslik, p.kisa, p.kapak, p.oyun || p.indir, (p.aciklama || '').length >= 40,
    uyeler.length && uyeler.every(u => u.rol), p.video, (p.gorseller || []).length, p.krediler];
  return { tamam: m.filter(Boolean).length, toplam: m.length };
}

// ---- Mesajlaşma (Discord yerine platform içi kanallar) ----
// Mesaj metninde bahsetmeler <@kim> biçiminde saklanır (kim: '@admin' | 'm:<id>' | 't:<id>' | 'j:<id>'), <@herkes> kanaldaki herkestir.
// Biçimlendirme (kalın, italik, kod…) istemcide yapılır; sunucu metni olduğu gibi saklar.
const KQ = {
  insert: db.prepare('INSERT INTO mesajlar (kanal, kim, ad, rol, metin, yardim, zaman, yanit, uye) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  restore: db.prepare(`INSERT INTO mesajlar (id, kanal, kim, ad, rol, metin, yardim, zaman, yanit, duzenlendi, silindi, uye)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  get: db.prepare('SELECT * FROM mesajlar WHERE id = ?'),
  many: db.prepare('SELECT * FROM mesajlar WHERE id IN (SELECT value FROM json_each(?))'),
  edit: db.prepare('UPDATE mesajlar SET metin = ?, duzenlendi = ?, surum = ? WHERE id = ?'),
  remove: db.prepare("UPDATE mesajlar SET metin = '', silindi = 1, surum = ? WHERE id = ?"),
  touch: db.prepare('UPDATE mesajlar SET surum = ? WHERE id = ?'),
  after: db.prepare('SELECT * FROM mesajlar WHERE kanal = ? AND id > ? AND silindi = 0 ORDER BY id LIMIT 500'),
  before: db.prepare('SELECT * FROM mesajlar WHERE kanal = ? AND id < ? AND silindi = 0 ORDER BY id DESC LIMIT ?'),
  changed: db.prepare('SELECT * FROM mesajlar WHERE kanal = ? AND surum > ? AND id <= ?'),
  summary: db.prepare(`SELECT kanal, MAX(id) AS son, MAX(zaman) AS zaman,
    MAX(CASE WHEN rol = 'takim' AND yardim = 1 THEN id END) AS yardim,
    MAX(CASE WHEN rol <> 'takim' THEN id END) AS cevap
    FROM mesajlar WHERE silindi = 0 GROUP BY kanal`),
  unread: db.prepare(`SELECT m.kanal, COUNT(*) AS n FROM mesajlar m
    LEFT JOIN okunan o ON o.kim = ? AND o.kanal = m.kanal
    WHERE m.id > COALESCE(o.son, 0) AND m.kim <> ? AND m.silindi = 0 GROUP BY m.kanal`),
  mentions: db.prepare(`SELECT b.kanal, COUNT(DISTINCT b.mesaj) AS n FROM bahsetmeler b
    JOIN mesajlar m ON m.id = b.mesaj AND m.silindi = 0 AND m.kim <> ?
    LEFT JOIN okunan o ON o.kim = ? AND o.kanal = b.kanal
    WHERE b.kim IN (?, '*') AND b.mesaj > COALESCE(o.son, 0) GROUP BY b.kanal`),
  markRead: db.prepare(`INSERT INTO okunan (kim, kanal, son) VALUES (?, ?, ?)
    ON CONFLICT (kim, kanal) DO UPDATE SET son = MAX(son, excluded.son)`),
  reactionsOf: db.prepare('SELECT * FROM tepkiler WHERE mesaj IN (SELECT value FROM json_each(?)) ORDER BY zaman'),
  reaction: db.prepare('SELECT 1 FROM tepkiler WHERE mesaj = ? AND kim = ? AND emoji = ?'),
  react: db.prepare('INSERT INTO tepkiler (mesaj, kim, ad, emoji, zaman) VALUES (?, ?, ?, ?, ?)'),
  unreact: db.prepare('DELETE FROM tepkiler WHERE mesaj = ? AND kim = ? AND emoji = ?'),
  reactionKinds: db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM tepkiler WHERE mesaj = ?'),
  mention: db.prepare('INSERT OR IGNORE INTO bahsetmeler (mesaj, kanal, kim) VALUES (?, ?, ?)'),
  unmention: db.prepare('DELETE FROM bahsetmeler WHERE mesaj = ?'),
  attachmentsOf: db.prepare('SELECT * FROM ekler WHERE mesaj IN (SELECT value FROM json_each(?)) ORDER BY zaman'),
  attachment: db.prepare('SELECT * FROM ekler WHERE id = ?'),
  addAttachment: db.prepare('INSERT INTO ekler (id, mesaj, kanal, kim, ad, boyut, gorsel, zaman) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  linkAttachment: db.prepare('UPDATE ekler SET mesaj = ? WHERE id = ? AND mesaj IS NULL AND kim = ? AND kanal = ?'),
  pending: db.prepare('SELECT COUNT(*) AS n FROM ekler WHERE mesaj IS NULL AND kim = ?'),
  stale: db.prepare('SELECT id FROM ekler WHERE mesaj IS NULL AND zaman < ?'),
  dropAttachment: db.prepare('DELETE FROM ekler WHERE id = ?')
};
const MESAJ_SAYFA = 150;
const MAX_EK = 10;
// İzin verilen tepkiler (public/sohbet.js'teki EMOJILER ile aynı)
const EMOJILER = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏', '👏', '🔥', '✅', '👀', '💯', '🤔', '😍', '😎', '🥳', '🚀', '⭐', '💡', '🎮',
  '🏆', '👋', '🙌', '😅', '🤝', '⚡', '🐛', '👎', '❌', '😡'];
// Görseller sayfada gösterilir, diğer dosyalar indirilir
const EK_EXT = /\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json|zip|7z|rar|docx?|xlsx?|pptx?|odt|ods|odp|mp3|wav|ogg|m4a|mp4|webm|mov|sb3|psd|blend|fbx|obj|unitypackage|aseprite|ase|ttf|otf|svg)$/i;
const BAHSETME = /<@(herkes|@admin|[mtj]:[a-z0-9]+)>/g;

// Mesajın sürümü: düzenleme, silme ve tepkide artar. İstemci son gördüğü sürümden sonrakileri ister.
let surumSayac = db.prepare('SELECT COALESCE(MAX(surum), 0) AS s FROM mesajlar').get().s;
const yeniSurum = () => ++surumSayac;

// Çevrimiçi durumu: oturumlu her istekte güncellenir (sessionOf). Sohbet açık olmasa da paneller 15-30 sn'de bir sorgular.
const gorulme = new Map();
const CEVRIMICI = 70e3;

// Oturum kimliğinden kişi: yönetici, mentör, takım ya da jüri (yoksa null).
// Öğrenci sohbette takımı adına konuşur (kim: 't:<takım>'); mesajı yazan öğrenci (uye) kendi adıdır.
function identityOf(k) {
  if (k && k.startsWith('s:')) {
    const o = OQ.get.get(k.slice(2)), t = o && o.takim && Q.team.get(o.takim);
    return t ? { kim: 't:' + t.id, rol: 'takim', ad: t.ad, id: t.id, uye: o.ad, ogrenci: o.id } : null;
  }
  if (k === '@admin') return { kim: k, rol: 'admin', ad: 'Yönetim' };
  if (k && k.startsWith('m:')) { const m = MQ.get.get(k.slice(2)); if (m) return { kim: k, rol: 'mentor', ad: m.ad, id: m.id, alan: m.alan }; }
  if (k && k.startsWith('t:')) { const t = Q.team.get(k.slice(2)); if (t) return { kim: k, rol: 'takim', ad: t.ad, id: t.id }; }
  if (k && k.startsWith('j:')) { const j = CFG.juries.find(x => x.id === k.slice(2)); if (j) return { kim: k, rol: 'juri', ad: j.name, id: j.id, oda: j.oda || '' }; }
  return null;
}
function speakerOf(req) {
  const k = sessionOf(req), s = identityOf(k);
  if (!s && k && k.startsWith('s:') && OQ.get.get(k.slice(2))) fail(409, 'Mesajlar için önce bir takıma katılın');
  return s || fail(401, 'Oturum geçersiz, tekrar giriş yapın');
}
// 'yaz' | 'oku' | null. Jüriler tarafsızlık için takım kanallarını ve mentör odasını görmez;
// takımlar ve mentörler de jüri kanallarını görmez.
function channelAccess(s, kanal) {
  if (typeof kanal !== 'string') return null;
  if (kanal === 'duyuru') return s.rol === 'takim' || s.rol === 'juri' ? 'oku' : 'yaz';
  if (kanal === 'genel') return s.rol === 'juri' ? null : s.rol === 'admin' || CFG.genelSohbet ? 'yaz' : 'oku';
  if (kanal === 'mentor') return s.rol === 'admin' || s.rol === 'mentor' ? 'yaz' : null;
  if (kanal === 'juri') return s.rol === 'admin' || s.rol === 'juri' ? 'yaz' : null;
  if (kanal.startsWith('oda:') && CFG.odalar.some(o => o.id === kanal.slice(4))) {
    return s.rol === 'admin' || (s.rol === 'juri' && s.oda === kanal.slice(4)) ? 'yaz' : null;
  }
  if (kanal.startsWith('t:') && Q.team.get(kanal.slice(2))) {
    if (s.rol === 'juri') return null;
    return s.rol !== 'takim' || s.id === kanal.slice(2) ? 'yaz' : null;
  }
  return null;
}
// Kişinin görebildiği kanallar: okunmamış sayısı, bahsetme sayısı ve bekleyen yardım çağrısıyla
function channelsOf(s) {
  const sum = Object.fromEntries(KQ.summary.all().map(r => [r.kanal, r]));
  const unread = Object.fromEntries(KQ.unread.all(s.kim, s.kim).map(r => [r.kanal, r.n]));
  const ment = Object.fromEntries(KQ.mentions.all(s.kim, s.kim, s.kim).map(r => [r.kanal, r.n]));
  const mine = s.rol === 'mentor' ? new Set(mentorTeams(s.id)) : null;
  const ch = (kanal, ad, ek = {}) => {
    const x = sum[kanal] || {};
    return { kanal, ad, son: x.son || 0, zaman: x.zaman || 0, okunmamis: unread[kanal] || 0, bahsetme: ment[kanal] || 0,
      yardim: !!(x.yardim && (!x.cevap || x.cevap < x.yardim)), yazar: channelAccess(s, kanal) === 'yaz', ...ek };
  };
  const list = [ch('duyuru', 'Duyurular')];
  if (s.rol !== 'juri') list.push(ch('genel', 'Genel sohbet'));
  if (s.rol === 'takim') {
    list.push(ch(`t:${s.id}`, 'Mentörlerimiz', { takim: s.id }));
  } else if (s.rol === 'juri') {
    list.push(ch('juri', 'Jüri odası'));
    const oda = CFG.odalar.find(o => o.id === s.oda);
    if (oda) list.push(ch('oda:' + oda.id, `${oda.ad} jürisi`));
  } else {
    list.push(ch('mentor', 'Mentör odası'));
    if (s.rol === 'admin') {
      list.push(ch('juri', 'Jüri odası'));
      for (const o of CFG.odalar) list.push(ch('oda:' + o.id, `${o.ad} jürisi`));
    }
    const names = {};
    for (const a of MQ.assignments.all()) (names[a.takim] ||= []).push(a.mentor);
    for (const t of Q.teams.all()) {
      list.push(ch(`t:${t.id}`, t.ad, { takim: t.id, il: t.il, okul: t.okul, benim: mine ? mine.has(t.id) : false, mentorler: names[t.id] || [] }));
    }
  }
  return list;
}

// Platformdaki tüm kişiler (üye listesi ve bahsetme adları için). Kısa süre önbellekte tutulur.
let kisilerOnbellek = null;
function allPeople() {
  if (kisilerOnbellek && Date.now() - kisilerOnbellek.zaman < 15e3) return kisilerOnbellek.liste;
  const liste = [{ kim: '@admin', rol: 'admin', ad: 'Yönetim' }];
  for (const m of MQ.all.all()) liste.push({ kim: 'm:' + m.id, rol: 'mentor', ad: m.ad, id: m.id, alan: m.alan });
  for (const j of CFG.juries) liste.push({ kim: 'j:' + j.id, rol: 'juri', ad: j.name, id: j.id, oda: j.oda || '' });
  for (const t of db.prepare('SELECT id, ad FROM takimlar ORDER BY ad COLLATE NOCASE').all()) liste.push({ kim: 't:' + t.id, rol: 'takim', ad: t.ad, id: t.id });
  kisilerOnbellek = { zaman: Date.now(), liste };
  return liste;
}
// Kanalı görebilen herkes, çevrimiçi durumuyla
function membersOf(kanal) {
  const now = Date.now();
  return allPeople().filter(p => channelAccess(p, kanal)).map(p => ({
    kim: p.kim, ad: p.ad, rol: p.rol, alan: p.alan || '', cevrimici: now - (gorulme.get(p.kim) || 0) < CEVRIMICI
  }));
}

// Metindeki bahsetmeleri kaydeder: yalnızca kanalı görebilenler; @herkes'i takımlar kullanamaz
function cleanMentions(metin, s, kanal) {
  return metin.replace(BAHSETME, (tam, kim) => {
    if (kim === 'herkes') return s.rol === 'takim' ? '@herkes' : tam;
    const p = identityOf(kim);
    return p && channelAccess(p, kanal) ? tam : '@' + (p ? p.ad : 'bilinmeyen');
  });
}
function saveMentions(id, kanal, metin) {
  KQ.unmention.run(id);
  for (const [, kim] of metin.matchAll(BAHSETME)) KQ.mention.run(id, kanal, kim === 'herkes' ? '*' : kim);
}

// Mesajları istemciye hazırlar: yanıtlanan mesaj, tepkiler, ekler ve metinde geçen kişilerin adlarıyla
function messagesOut(rows, s) {
  if (!rows.length) return [];
  const live = rows.filter(r => !r.silindi), ids = JSON.stringify(live.map(r => r.id));
  const tep = {}, ek = {};
  for (const t of KQ.reactionsOf.all(ids)) (tep[t.mesaj] ||= []).push(t);
  for (const e of KQ.attachmentsOf.all(ids)) (ek[e.mesaj] ||= []).push(e);
  const yIds = [...new Set(live.map(r => r.yanit).filter(Boolean))];
  const yan = yIds.length ? Object.fromEntries(KQ.many.all(JSON.stringify(yIds)).map(r => [r.id, r])) : {};
  const yEk = yIds.length ? new Set(KQ.attachmentsOf.all(JSON.stringify(yIds)).map(e => e.mesaj)) : new Set();
  const people = Object.fromEntries(allPeople().map(p => [p.kim, p]));
  const adlar = (...metinler) => {
    const o = {};
    for (const m of metinler) for (const [, kim] of String(m || '').matchAll(BAHSETME)) if (kim !== 'herkes') o[kim] = people[kim]?.ad || 'bilinmeyen';
    return o;
  };
  return rows.map(r => {
    if (r.silindi) return { id: r.id, silindi: true };
    const y = r.yanit && yan[r.yanit];
    const gruplar = new Map();
    for (const t of tep[r.id] || []) {
      const g = gruplar.get(t.emoji) || { e: t.emoji, n: 0, ben: false, adlar: [] };
      g.n++; if (t.kim === s.kim) g.ben = true; if (g.adlar.length < 10) g.adlar.push(t.ad);
      gruplar.set(t.emoji, g);
    }
    return {
      id: r.id, kim: r.kim, ad: r.ad, uye: r.uye || '', rol: r.rol, alan: people[r.kim]?.alan || '', metin: r.metin, yardim: !!r.yardim, zaman: r.zaman,
      duzenlendi: r.duzenlendi || 0,
      yanit: r.yanit ? (y && !y.silindi ? { id: y.id, kim: y.kim, ad: y.ad, uye: y.uye || '', rol: y.rol, metin: y.metin.slice(0, 200), ek: yEk.has(y.id) } : { id: r.yanit, silindi: true }) : null,
      tepkiler: [...gruplar.values()],
      ekler: (ek[r.id] || []).map(e => ({ id: e.id, ad: e.ad, boyut: e.boyut, gorsel: !!e.gorsel })),
      kisiler: adlar(r.metin, y && !y.silindi ? y.metin : '')
    };
  });
}

function removeAttachmentFile(id) { fs.rmSync(path.join(EK_DIR, id), { force: true }); }
// Kanalın tüm mesajları, tepkileri, bahsetmeleri ve ekleri silinir (takım ya da oda silinince)
function purgeChannel(kanal) {
  for (const e of db.prepare('SELECT id FROM ekler WHERE kanal = ?').all(kanal)) removeAttachmentFile(e.id);
  db.prepare('DELETE FROM ekler WHERE kanal = ?').run(kanal);
  db.prepare('DELETE FROM tepkiler WHERE mesaj IN (SELECT id FROM mesajlar WHERE kanal = ?)').run(kanal);
  db.prepare('DELETE FROM bahsetmeler WHERE kanal = ?').run(kanal);
  db.prepare('DELETE FROM bildirimler WHERE mesaj IN (SELECT id FROM mesajlar WHERE kanal = ?)').run(kanal);
  db.prepare('DELETE FROM mesajlar WHERE kanal = ?').run(kanal);
}
// Yüklenip gönderilmeyen ekler 6 saat sonra silinir
function purgeStaleAttachments() {
  for (const e of KQ.stale.all(Date.now() - 6 * 3600e3)) { removeAttachmentFile(e.id); KQ.dropAttachment.run(e.id); }
}
purgeStaleAttachments();
setInterval(purgeStaleAttachments, 3600e3).unref();

// Kısa sürede çok istek gönderilmesini engeller (mesaj, tepki, dosya ayrı sayılır)
const postTimes = new Map();
function postLimited(anahtar, sinir = 12, msj = 'Çok hızlı mesaj gönderiyorsunuz, biraz bekleyin') {
  const now = Date.now(), list = (postTimes.get(anahtar) || []).filter(t => now - t < 30e3);
  if (list.length >= sinir) fail(429, msj);
  list.push(now); postTimes.set(anahtar, list);
}

// ---- Moderasyon ----
// Küfür/argo filtresi: yerleşik liste + yönetimin eklediği kelimeler. Eşleşen kelime ilk harfi kalacak şekilde yıldızlanır.
// Kökler kelimenin başında aranır (siktir, siktirin…); kısa ya da başka kelimelerin başı olabilecekler yalnızca tam eşleşir (göt ≠ götürmek).
const KUFUR_KOK = ['amına', 'amina', 'amcık', 'amcik', 'siktir', 'sikerim', 'sikeyim', 'sikim', 'sikik', 'sikiş', 'sikis', 'orospu', 'oruspu',
  'piç', 'yavşak', 'yavsak', 'ibne', 'gavat', 'pezevenk', 'kahpe', 'yarrak', 'dalyarak', 'taşak', 'tasak', 'şerefsiz', 'serefsiz', 'puşt', 'pust',
  'kaltak', 'fahişe', 'fahise', 'gerizekalı', 'gerizekali', 'avradını'];
const KUFUR_TAM = ['amk', 'aq', 'amq', 'mk', 'oç', 'göt', 'götü', 'götün', 'götveren', 'sik', 'yarak', 'bok', 'boktan'];
const kelimeListesi = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,\n]/))
  .map(k => String(k).trim().toLocaleLowerCase('tr')).filter(k => k && k.length <= 40))].slice(0, 300);
let filtreOnbellek = null;
function kufurRegex() {
  const ek = CFG.yasakKelimeler || [], anahtar = ek.join('\n');
  if (filtreOnbellek?.anahtar === anahtar) return filtreOnbellek.re;
  const kac = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\async function receiveAttachment(req, url, s) {');
  const kok = KUFUR_KOK.map(kac).join('|'), tam = [...KUFUR_TAM, ...ek].map(kac).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:${kok})[\\p{L}]*|(?:${tam}))(?![\\p{L}\\p{N}])`, 'gu');
  filtreOnbellek = { anahtar, re };
  return re;
}
// Bahsetme etiketlerine (<@t:…>) dokunmadan metni süzer. Küçük harfe çevirme Türkçe'de uzunluğu korur, eşleşme konumları aynı kalır.
function kufurSuz(metin) {
  return metin.split(/(<@[^>\s]+>)/).map((parca, i) => {
    if (i % 2) return parca;
    const kucuk = parca.toLocaleLowerCase('tr');
    if (kucuk.length !== parca.length) return parca;
    let out = '', son = 0;
    for (const m of kucuk.matchAll(kufurRegex())) {
      out += parca.slice(son, m.index) + parca[m.index] + '*'.repeat(m[0].length - 1);
      son = m.index + m[0].length;
    }
    return out + parca.slice(son);
  }).join('');
}
const MQ_SUS = {
  get: db.prepare('SELECT * FROM susturmalar WHERE kim = ? AND bitis > ?'),
  set: db.prepare(`INSERT INTO susturmalar (kim, ad, bitis, neden, zaman) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (kim) DO UPDATE SET ad = excluded.ad, bitis = excluded.bitis, neden = excluded.neden, zaman = excluded.zaman`),
  remove: db.prepare('DELETE FROM susturmalar WHERE kim = ?'),
  active: db.prepare('SELECT * FROM susturmalar WHERE bitis > ? ORDER BY bitis')
};
function susturmaKontrol(s) {
  const r = MQ_SUS.get.get(s.kim, Date.now());
  if (r) fail(403, `Yönetim sizi ${new Date(r.bitis).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} saatine kadar susturdu${r.neden ? ': ' + r.neden : ''}`);
}
// Takım mesajını yazan öğrenci: takım sayfasındaki ekip üyeleri ve danışman öğretmen
function teamMembers(id) {
  const row = Q.team.get(id);
  if (!row) return [];
  const p = pageOf(row);
  return [...new Set([...(p.uyeler || []).map(u => str(u.ad, 80)), str(row.danisman, 80)].filter(Boolean))];
}
function channelName(kanal) {
  if (kanal === 'duyuru') return 'Duyurular';
  if (kanal === 'genel') return 'Genel sohbet';
  if (kanal === 'mentor') return 'Mentör odası';
  if (kanal === 'juri') return 'Jüri odası';
  if (kanal.startsWith('oda:')) return (CFG.odalar.find(o => o.id === kanal.slice(4))?.ad || 'Oda') + ' jürisi';
  if (kanal.startsWith('t:')) return Q.team.get(kanal.slice(2))?.ad || kanal;
  return kanal;
}

async function receiveAttachment(req, url, s) {
  const kanal = url.searchParams.get('kanal'), ad = str(url.searchParams.get('ad'), 120).replace(/[\\/:*?"<>|]/g, '_');
  if (channelAccess(s, kanal) !== 'yaz') { req.resume(); fail(403, 'Bu kanala dosya gönderemezsiniz'); }
  try { susturmaKontrol(s); } catch (e) { req.resume(); throw e; }
  const ext = (ad.match(EK_EXT) || [])[0]?.toLowerCase();
  if (!ext) { req.resume(); fail(400, 'Bu dosya türü gönderilemez. Görsel, PDF, belge, ses, video ya da arşiv (ZIP) gönderin.'); }
  if (KQ.pending.get(s.kim).n >= MAX_EK * 2) { req.resume(); fail(400, 'Gönderilmemiş çok fazla ekiniz var'); }
  postLimited(s.kim + ':dosya', 20, 'Çok hızlı dosya yüklüyorsunuz, biraz bekleyin');
  const { tmp, size } = await receiveFile(req, LIMIT.ek);
  const tur = IMG_EXT[ext.slice(1)];
  let gorsel = 0;
  if (tur) {
    const head = Buffer.alloc(12), fd = fs.openSync(tmp, 'r');
    try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
    gorsel = size >= 12 && IMG_MAGIC[tur](head) ? 1 : 0;
    if (!gorsel) { fs.rmSync(tmp, { force: true }); fail(400, 'Dosya bir görsel değil ya da uzantısı yanlış'); }
  }
  const id = crypto.randomBytes(12).toString('hex') + ext;
  fs.renameSync(tmp, path.join(EK_DIR, id));
  KQ.addAttachment.run(id, null, kanal, s.kim, ad, size, gorsel, Date.now());
  return { id, ad, boyut: size, gorsel: !!gorsel };
}

// Ekler tahmin edilemez adresle sunulur: /ek/<id>/<dosya adı> (resim etiketleri oturum başlığı gönderemez)
function serveAttachment(req, res, url) {
  const id = decodeURIComponent(url.pathname.slice('/ek/'.length).split('/')[0] || '');
  const row = /^[a-f0-9]{24}\.[a-z0-9]+$/.test(id) && KQ.attachment.get(id);
  if (!row) { res.writeHead(404); return res.end('Bulunamadı'); }
  const full = path.join(EK_DIR, id);
  fs.stat(full, (err, st) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
    const h = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Length': st.size,
      'Cache-Control': 'private, max-age=86400, immutable' };
    if (row.gorsel) h['Content-Type'] = MIME[path.extname(id)];
    else {
      h['Content-Type'] = 'application/octet-stream';
      h['Content-Disposition'] = `attachment; filename="${row.ad.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(row.ad)}`;
    }
    res.writeHead(200, h);
    fs.createReadStream(full).pipe(res);
  });
}

async function messageRoutes(req, res, url) {
  const p = url.pathname.slice('/api/mesaj'.length), m = req.method;
  const s = speakerOf(req);
  // Kendi mesajı: öğrenci hesabıyla yalnızca kendi yazdıkları (takım arkadaşlarınınki değil)
  const benim = row => row.kim === s.kim && (!s.uye || row.uye === s.uye);
  const own = id => {
    const row = KQ.get.get(Number(id));
    if (!row || row.silindi || !channelAccess(s, row.kanal)) fail(404, 'Mesaj bulunamadı');
    return row;
  };

  if (m === 'GET' && p === '') {
    const kanal = url.searchParams.get('kanal');
    const sus = MQ_SUS.get.get(s.kim, Date.now());
    const result = { ben: { kim: s.kim, rol: s.rol, ad: s.ad, uye: s.uye || '', susturma: sus ? { bitis: sus.bitis, neden: sus.neden } : null }, kanallar: channelsOf(s), surum: surumSayac };
    if (s.rol === 'takim') result.ben.uyeler = s.uye ? [] : teamMembers(s.id); // öğrenci hesabında yazan seçilmez
    if (s.rol === 'admin') result.bildirimSayisi = db.prepare('SELECT COUNT(DISTINCT mesaj) AS n FROM bildirimler').get().n;
    if (kanal) {
      if (!channelAccess(s, kanal)) fail(403, 'Bu kanala erişiminiz yok');
      const sonra = Number(url.searchParams.get('sonra')) || 0, once = Number(url.searchParams.get('once')) || 0;
      const surum = Number(url.searchParams.get('surum'));
      if (once) {
        const rows = KQ.before.all(kanal, once, MESAJ_SAYFA + 1);
        result.mesajlar = messagesOut(rows.slice(0, MESAJ_SAYFA).reverse(), s);
        result.dahaVar = rows.length > MESAJ_SAYFA;
      } else if (sonra) {
        result.mesajlar = messagesOut(KQ.after.all(kanal, sonra), s);
        // Daha önce yüklenmiş mesajlardan düzenlenen, silinen ya da tepki alanlar
        if (Number.isFinite(surum) && surum < surumSayac) result.degisen = messagesOut(KQ.changed.all(kanal, surum, sonra), s);
      } else {
        const rows = KQ.before.all(kanal, Number.MAX_SAFE_INTEGER, MESAJ_SAYFA + 1);
        result.mesajlar = messagesOut(rows.slice(0, MESAJ_SAYFA).reverse(), s);
        result.dahaVar = rows.length > MESAJ_SAYFA;
      }
      if (url.searchParams.get('uyeler')) result.uyeler = membersOf(kanal);
      const son = result.kanallar.find(k => k.kanal === kanal)?.son;
      if (son && !once) {
        KQ.markRead.run(s.kim, kanal, son);
        Object.assign(result.kanallar.find(k => k.kanal === kanal), { okunmamis: 0, bahsetme: 0 });
      }
    }
    return json(res, 200, result);
  }
  if (m === 'POST' && p === '') {
    const b = await readBody(req, 3e4);
    if (channelAccess(s, b.kanal) !== 'yaz') fail(403, b.kanal === 'duyuru' ? 'Duyuruları yalnızca yönetim ve mentörler yazar' : 'Bu kanala yazamazsınız');
    const ekler = Array.isArray(b.ekler) ? [...new Set(b.ekler.filter(e => typeof e === 'string'))].slice(0, MAX_EK) : [];
    susturmaKontrol(s);
    const metin = kufurSuz(cleanMentions(str(b.metin, 2000), s, b.kanal));
    if (!metin && !ekler.length) fail(400, 'Mesaj boş');
    let uye = null;
    if (s.uye) uye = s.uye;
    else if (s.rol === 'takim') {
      const uyeler = teamMembers(s.id);
      uye = str(b.uye, 80) || null;
      if (uyeler.length && !uyeler.includes(uye)) fail(400, 'Mesajı yazan öğrenciyi seçin');
      if (!uyeler.length) uye = null;
    }
    postLimited(s.kim);
    const yanitRow = b.yanit && KQ.get.get(Number(b.yanit));
    const yanit = yanitRow && yanitRow.kanal === b.kanal && !yanitRow.silindi ? yanitRow.id : null;
    const yardim = s.rol === 'takim' && !!b.yardim ? 1 : 0;
    const id = tx(() => {
      const id = Number(KQ.insert.run(b.kanal, s.kim, s.ad, s.rol, metin, yardim, Date.now(), yanit, uye).lastInsertRowid);
      for (const e of ekler) KQ.linkAttachment.run(id, e, s.kim, b.kanal);
      saveMentions(id, b.kanal, metin);
      KQ.markRead.run(s.kim, b.kanal, id);
      return id;
    });
    return json(res, 200, { id });
  }
  if (m === 'PUT' && p === '') {
    const b = await readBody(req, 3e4), row = own(b.id);
    if (!benim(row)) fail(403, 'Yalnızca kendi mesajınızı düzenleyebilirsiniz');
    susturmaKontrol(s);
    const metin = kufurSuz(cleanMentions(str(b.metin, 2000), s, row.kanal));
    if (!metin && !KQ.attachmentsOf.all(JSON.stringify([row.id])).length) fail(400, 'Mesaj boş olamaz; silmek için sil düğmesini kullanın');
    if (metin !== row.metin) tx(() => { KQ.edit.run(metin, Date.now(), yeniSurum(), row.id); saveMentions(row.id, row.kanal, metin); });
    return json(res, 200, { ok: true });
  }
  if (m === 'DELETE' && p === '') {
    const row = own(url.searchParams.get('id'));
    if (s.rol !== 'admin' && !benim(row)) fail(403, 'Yalnızca kendi mesajınızı silebilirsiniz');
    tx(() => {
      for (const e of KQ.attachmentsOf.all(JSON.stringify([row.id]))) { removeAttachmentFile(e.id); KQ.dropAttachment.run(e.id); }
      db.prepare('DELETE FROM tepkiler WHERE mesaj = ?').run(row.id);
      db.prepare('DELETE FROM bildirimler WHERE mesaj = ?').run(row.id);
      KQ.unmention.run(row.id);
      KQ.remove.run(yeniSurum(), row.id);
    });
    return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/tepki') {
    const b = await readBody(req, 2e3), row = own(b.id);
    if (!EMOJILER.includes(b.emoji)) fail(400, 'Geçersiz tepki');
    susturmaKontrol(s);
    postLimited(s.kim + ':tepki', 30, 'Çok hızlı tepki veriyorsunuz, biraz bekleyin');
    const vardi = !!KQ.reaction.get(row.id, s.kim, b.emoji);
    if (!vardi && KQ.reactionKinds.get(row.id).n >= 20) fail(400, 'Bu mesaja daha fazla farklı tepki eklenemez');
    tx(() => {
      if (vardi) KQ.unreact.run(row.id, s.kim, b.emoji);
      else KQ.react.run(row.id, s.kim, s.ad, b.emoji, Date.now());
      KQ.touch.run(yeniSurum(), row.id);
    });
    return json(res, 200, { ok: true, eklendi: !vardi });
  }
  if (m === 'POST' && p === '/dosya') return json(res, 200, await receiveAttachment(req, url, s));
  // Mesajı yönetime bildir (uygunsuz içerik)
  if (m === 'POST' && p === '/bildir') {
    const b = await readBody(req, 4e3), row = own(b.id);
    if (row.kim === s.kim) fail(400, 'Kendi mesajınızı bildiremezsiniz');
    if (s.rol === 'admin') fail(400, 'Yönetim mesajı doğrudan silebilir');
    postLimited(s.kim + ':bildir', 10, 'Çok fazla bildirim gönderdiniz, biraz bekleyin');
    db.prepare('INSERT OR IGNORE INTO bildirimler (mesaj, kim, ad, neden, zaman) VALUES (?, ?, ?, ?, ?)').run(row.id, s.kim, s.ad, str(b.neden, 300), Date.now());
    return json(res, 200, { ok: true });
  }
  if (p === '/bildirimler' || p === '/bildirim-kapat' || p === '/sustur') {
    if (s.rol !== 'admin') fail(403, 'Yalnızca yönetim');
    if (m === 'GET' && p === '/bildirimler') {
      const raporlar = db.prepare('SELECT * FROM bildirimler ORDER BY zaman').all(), grup = new Map();
      for (const b of raporlar) (grup.get(b.mesaj) || grup.set(b.mesaj, []).get(b.mesaj)).push({ ad: b.ad, neden: b.neden, zaman: b.zaman });
      const rows = grup.size ? KQ.many.all(JSON.stringify([...grup.keys()])).filter(r => !r.silindi) : [];
      const msj = Object.fromEntries(messagesOut(rows, s).map(m => [m.id, m]));
      return json(res, 200, {
        bildirimler: rows.map(r => ({ kanal: r.kanal, kanalAd: channelName(r.kanal), mesaj: msj[r.id], raporlar: grup.get(r.id) }))
          .sort((a, b) => b.raporlar.at(-1).zaman - a.raporlar.at(-1).zaman),
        susturmalar: MQ_SUS.active.all(Date.now()).map(r => ({ kim: r.kim, ad: r.ad, bitis: r.bitis, neden: r.neden }))
      });
    }
    if (m === 'POST' && p === '/bildirim-kapat') {
      db.prepare('DELETE FROM bildirimler WHERE mesaj = ?').run(Number((await readBody(req)).id));
      return json(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/sustur') {
      const b = await readBody(req, 4e3), kisi = identityOf(b.kim), dakika = Number(b.dakika);
      if (!kisi || kisi.rol === 'admin') fail(400, 'Kişi bulunamadı');
      if (!dakika) MQ_SUS.remove.run(kisi.kim);
      else {
        if (!(dakika > 0 && dakika <= 7 * 1440)) fail(400, 'Süre 1 dakika ile 7 gün arasında olmalı');
        MQ_SUS.set.run(kisi.kim, kisi.ad, Date.now() + dakika * 60e3, str(b.neden, 200), Date.now());
      }
      return json(res, 200, { ok: true });
    }
  }
  if (m === 'DELETE' && p === '/dosya') {
    const e = KQ.attachment.get(String(url.searchParams.get('id')));
    if (e && e.kim === s.kim && e.mesaj === null) { removeAttachmentFile(e.id); KQ.dropAttachment.run(e.id); }
    return json(res, 200, { ok: true });
  }
  fail(404, 'Bulunamadı');
}

// ---- Oylar ve sıralama ----
// votes[juri][takim] = { scores, total, note, time }
function loadVotes(tur = 'on') {
  const names = JURY_NAME(), votes = {};
  for (const j of CFG.juries) votes[j.id] = {};
  for (const r of Q.votes.all()) {
    if (!names[r.juri] || r.tur !== tur) continue;
    votes[r.juri][r.takim] = { scores: JSON.parse(r.puanlar), total: r.toplam, note: r.notu, time: r.zaman };
  }
  return votes;
}
function scoreError(scores) {
  const C = CRITERIA();
  if (!Array.isArray(scores) || scores.length !== C.length) return 'Tüm kriterler puanlanmalıdır';
  for (let i = 0; i < C.length; i++) {
    const s = scores[i];
    if (!Number.isInteger(s) || s < 0 || s > C[i].max) return `"${C[i].name}" için 0-${C[i].max} arası puan verin`;
  }
  return null;
}
// ---- Jüri odaları ----
const hasRooms = () => CFG.odalar.length > 0;
const currentRound = () => hasRooms() && CFG.asama === 'final' ? 'final' : 'on';
const roomOfTeam = () => Object.fromEntries(Q.rooms.all().map(r => [r.takim, r.oda]));
const roomName = id => CFG.odalar.find(o => o.id === id)?.ad || '';
// Bir takımı hangi jüriler puanlar: odasız düzende ve finalde tümü, ön elemede takımın odasındakiler
function juriesFor(teamId, tur, rooms) {
  if (!hasRooms() || tur === 'final') return CFG.juries.map(j => j.id);
  const oda = rooms[teamId];
  return oda ? CFG.juries.filter(j => j.oda === oda).map(j => j.id) : [];
}
// Jürinin şu anki aşamada puanlayacağı takımlar
function juryTeamIds(user) {
  const rows = Q.teams.all().filter(r => r.yayinda);
  if (!hasRooms()) return rows.map(r => r.id);
  if (CFG.asama === 'final') return rows.filter(r => CFG.finalistler.includes(r.id)).map(r => r.id);
  const oda = CFG.juries.find(j => j.id === user)?.oda, rooms = roomOfTeam();
  return oda ? rows.filter(r => rooms[r.id] === oda).map(r => r.id) : [];
}

// Sıralama: jüri ortalaması, sonra oy veren jüri sayısı, sonra takım adı.
// per: tüm jüriler sırasıyla (o takımı puanlamayan jüri için null); beklenen: puanlaması gereken jüri sayısı
function ranking(tur = 'on') {
  const votes = loadVotes(tur), rooms = roomOfTeam();
  const rows = Q.teams.all().filter(r => tur !== 'final' || CFG.finalistler.includes(r.id));
  return rows.map(row => {
    const say = new Set(juriesFor(row.id, tur, rooms));
    const per = CFG.juries.map(j => say.has(j.id) ? votes[j.id][row.id] || null : null);
    const done = per.filter(Boolean);
    const avg = done.length ? done.reduce((a, v) => a + v.total, 0) / done.length : null;
    const critAvg = CFG.criteria.map((_, i) => done.length ? done.reduce((a, v) => a + v.scores[i], 0) / done.length : null);
    return { id: row.id, takim: row.ad, il: row.il, okul: row.okul, baslik: pageOf(row).baslik || '', yayinda: !!row.yayinda, rozet: row.rozet,
      oda: rooms[row.id] || '', finalist: CFG.finalistler.includes(row.id), per, n: done.length, beklenen: say.size, avg, critAvg };
  }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.n - a.n || a.takim.localeCompare(b.takim, 'tr'));
}

// Odalar listesi: yeni odaya kimlik verilir; silinen odanın jürileri ve takımları odasız kalır
function setRooms(list) {
  if (!Array.isArray(list)) fail(400, 'Geçersiz liste');
  if (list.length > 50) fail(400, 'En fazla 50 oda olabilir');
  const used = new Set(CFG.odalar.map(o => o.id));
  const rows = list.map((x, i) => {
    const ad = str(x.ad, 40) || `Oda ${i + 1}`;
    let id = CFG.odalar.some(o => o.id === x.id) ? x.id : null;
    if (!id) { for (let n = 1; !id; n++) if (!used.has('o' + n)) id = 'o' + n; used.add(id); }
    return { id, ad };
  });
  const keep = new Set(rows.map(r => r.id));
  tx(() => {
    for (const r of Q.rooms.all()) if (!keep.has(r.oda)) Q.clearRoom.run(r.takim);
    CFG.juries = CFG.juries.map(j => keep.has(j.oda) ? j : { id: j.id, name: j.name });
    CFG.odalar = rows;
    if (!rows.length) CFG.asama = 'on';
    // Silinen odaların jüri kanalı mesajları da silinir
    for (const r of db.prepare("SELECT DISTINCT kanal FROM mesajlar WHERE kanal LIKE 'oda:%'").all()) {
      if (!keep.has(r.kanal.slice(4))) purgeChannel(r.kanal);
    }
    saveCfg();
  });
}
// Jüri ve takımları odalara atama: { juriler: { id: oda | '' }, takimlar: { id: oda | '' } }
function assignRooms({ juriler, takimlar }) {
  const ok = id => id === '' || CFG.odalar.some(o => o.id === id);
  tx(() => {
    for (const [id, oda] of Object.entries(juriler || {})) {
      if (!ok(oda)) fail(400, 'Geçersiz oda');
      const j = CFG.juries.find(x => x.id === id);
      if (j) { if (oda) j.oda = oda; else delete j.oda; }
    }
    for (const [id, oda] of Object.entries(takimlar || {})) {
      if (!ok(oda)) fail(400, 'Geçersiz oda');
      if (!Q.team.get(id)) continue;
      if (oda) Q.setRoom.run(id, oda); else Q.clearRoom.run(id);
    }
    saveCfg();
  });
}
// Takımları odalara eşit dağıtır; aynı okuldan, sonra aynı ilden takımları ayrı odalara koymaya çalışır.
// hepsi=false ise yalnızca odası olmayan (yayındaki) takımlar dağıtılır.
function distributeTeams(hepsi) {
  if (!hasRooms()) fail(400, 'Önce oda ekleyin');
  const rooms = hepsi ? {} : roomOfTeam();
  const rows = Q.teams.all().filter(r => r.yayinda);
  const load = Object.fromEntries(CFG.odalar.map(o => [o.id, { n: 0, okul: {}, il: {} }]));
  for (const r of rows) if (rooms[r.id] && load[rooms[r.id]]) { const L = load[rooms[r.id]]; L.n++; L.okul[r.okul] = (L.okul[r.okul] || 0) + 1; L.il[r.il] = (L.il[r.il] || 0) + 1; }
  const bekleyen = rows.filter(r => !rooms[r.id] || !load[rooms[r.id]]);
  // Kalabalık okul ve iller önce yerleşir ki dağılabilsin
  const sayac = k => bekleyen.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
  const okulN = sayac('okul'), ilN = sayac('il');
  bekleyen.sort((a, b) => (okulN[b.okul] - okulN[a.okul]) || (ilN[b.il] - ilN[a.il]) || a.ad.localeCompare(b.ad, 'tr'));
  const sonuc = {};
  for (const r of bekleyen) {
    const best = CFG.odalar.map(o => o.id).sort((x, y) => {
      const X = load[x], Y = load[y];
      return (X.n - Y.n) || ((r.okul ? X.okul[r.okul] || 0 : 0) - (r.okul ? Y.okul[r.okul] || 0 : 0)) || ((r.il ? X.il[r.il] || 0 : 0) - (r.il ? Y.il[r.il] || 0 : 0));
    })[0];
    const L = load[best]; L.n++; L.okul[r.okul] = (L.okul[r.okul] || 0) + 1; L.il[r.il] = (L.il[r.il] || 0) + 1;
    sonuc[r.id] = best;
  }
  tx(() => {
    if (hepsi) db.exec('DELETE FROM oda_takim');
    for (const [id, oda] of Object.entries(sonuc)) Q.setRoom.run(id, oda);
  });
  return Object.keys(sonuc).length;
}
// Her odadan ön eleme ortalaması en yüksek "sayi" takım finalist olur (puanı olmayanlar seçilmez)
function pickFinalists(sayi) {
  sayi = Number(sayi);
  if (!Number.isInteger(sayi) || sayi < 1 || sayi > 100) fail(400, 'Odadan çıkacak takım sayısı 1-100 arası olmalı');
  if (!hasRooms()) fail(400, 'Önce oda ekleyin');
  const rank = ranking('on').filter(r => r.n && r.oda && r.yayinda), list = [];
  for (const o of CFG.odalar) list.push(...rank.filter(r => r.oda === o.id).slice(0, sayi).map(r => r.id));
  CFG.finalSayi = sayi; CFG.finalistler = list;
  saveCfg();
  return list.length;
}
function setFinalists(list) {
  if (!Array.isArray(list)) fail(400, 'Geçersiz liste');
  CFG.finalistler = [...new Set(list.filter(id => typeof id === 'string' && Q.team.get(id)))];
  saveCfg();
}

// ---- Jüri listesi ve kriterler (yönetim paneli) ----
function setJuries(list) {
  if (!Array.isArray(list)) fail(400, 'Geçersiz liste');
  const names = JURY_NAME(), seen = new Set();
  const rows = list.map(x => {
    const name = str(x.name, 80);
    if (!name) fail(400, 'Jüri adı boş bırakılamaz');
    const id = normalizeUser(x.id) || normalizeUser(stripTitles(name));
    if (!id) fail(400, `"${name}" için kullanıcı adı üretilemedi`);
    if (seen.has(id)) fail(400, `"${id}" kullanıcı adı iki kez var`);
    seen.add(id);
    const eski = names[x.eski] ? x.eski : null;
    const oda = CFG.odalar.some(o => o.id === x.oda) ? x.oda : CFG.juries.find(j => j.id === (eski || id))?.oda;
    return { id, name, eski, oda };
  });
  tx(() => {
    const keep = new Set(rows.map(r => r.eski).filter(Boolean));
    const del = db.prepare('DELETE FROM oylar WHERE juri = ?');
    const delG = db.prepare('DELETE FROM geribildirimler WHERE juri = ?');
    for (const j of CFG.juries) if (!keep.has(j.id)) { del.run(j.id); delG.run(j.id); }
    // Yeniden adlandırma (takas güvenli: önce geçici ada)
    const moved = rows.filter(r => r.eski && r.eski !== r.id);
    const upd = db.prepare('UPDATE oylar SET juri = ? WHERE juri = ?');
    const updG = db.prepare('UPDATE geribildirimler SET juri = ? WHERE juri = ?');
    moved.forEach((r, i) => { upd.run(`\u0001${i}`, r.eski); updG.run(`\u0001${i}`, r.eski); });
    moved.forEach((r, i) => { upd.run(r.id, `\u0001${i}`); updG.run(r.id, `\u0001${i}`); });
    const same = new Set(rows.filter(r => r.eski === r.id).map(r => r.id));
    for (const j of CFG.juries) if (!same.has(j.id)) Q.deleteSessionsOf.run(`j:${j.id}`);
    const pw = {};
    for (const r of rows) { const h = SECRETS.juri[r.eski || r.id]; if (h && (r.eski || !names[r.id])) pw[r.id] = h; }
    SECRETS.juri = pw;
    saveSecrets();
  });
  CFG.juries = rows.map(({ id, name, oda }) => oda ? { id, name, oda } : { id, name });
  saveCfg();
}

// Oy varken kriter sayısı değişemez, azami puan verilmiş puanların altına inemez
function setCriteria(list) {
  if (!Array.isArray(list) || !list.length) fail(400, 'En az bir kriter olmalı');
  const rows = list.map(x => {
    const name = str(x.name, 120), short = str(x.short, 24), max = Number(x.max);
    if (!name) fail(400, 'Kriter adı boş bırakılamaz');
    if (!Number.isInteger(max) || max < 1 || max > 1000) fail(400, `"${name}" için azami puan 1-1000 arası bir tam sayı olmalı`);
    return { name, short, max, ek: !!x.ek };
  });
  const all = Q.votes.all().map(r => JSON.parse(r.puanlar));
  if (all.length) {
    if (rows.length !== CFG.criteria.length) fail(409, `Kayıtlı ${all.length} oy var. Kriter eklemek ya da çıkarmak için önce oyları sıfırlayın.`);
    rows.forEach((c, i) => {
      const top = Math.max(...all.map(s => s[i]));
      if (c.max < top) fail(409, `"${c.name}" için ${top} puan verilmiş; azami puan ${top} altına inemez.`);
    });
  }
  CFG.criteria = rows;
  saveCfg();
}

// Geri sayım zamanı: ms cinsinden sayı ya da boş
function zamanOf(v, ad) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < Date.UTC(2000, 0) || n > Date.UTC(2100, 0)) fail(400, `${ad} zamanı geçersiz`);
  return Math.round(n);
}
function setEvent(e) {
  const ev = {
    kurum: str(e.kurum, 40), ad: str(e.ad, 80), donem: str(e.donem, 20) || String(new Date().getFullYear()),
    altBaslik: str(e.altBaslik, 120), tema: str(e.tema, 120),
    tarih: str(e.tarih, 80), aciklama: str(e.aciklama, 4000), kurallar: str(e.kurallar, 8000),
    baslangic: zamanOf(e.baslangic, 'Başlangıç'), bitis: zamanOf(e.bitis, 'Bitiş')
  };
  if (ev.baslangic && ev.bitis && ev.bitis <= ev.baslangic) fail(400, 'Bitiş, başlangıçtan sonra olmalı');
  CFG.event = ev;
  saveCfg();
}

// Jam geleneği: tema, başlangıç anına kadar yönetim dışındaki herkese boş gönderilir
const temaGizli = () => !!(CFG.temaGizle && CFG.event.tema && CFG.event.baslangic && Date.now() < CFG.event.baslangic);
const pubEvent = () => temaGizli() ? { ...CFG.event, tema: '', temaGizli: true } : CFG.event;

async function setPassword({ tur, juri, sifre }) {
  const p = String(sifre ?? '');
  if (tur === 'juri') {
    if (!JURY_NAME()[juri]) fail(400, 'Jüri bulunamadı');
    if (!p) delete SECRETS.juri[juri];
    else if (p.length < 4) fail(400, 'Şifre en az 4 karakter olmalı');
    else SECRETS.juri[juri] = await hashPwAsync(p);
    Q.deleteSessionsOf.run(`j:${juri}`);
  } else if (tur === 'ortak' || tur === 'admin') {
    if (p.length < (tur === 'admin' ? 6 : 4)) fail(400, `Şifre en az ${tur === 'admin' ? 6 : 4} karakter olmalı`);
    SECRETS[tur] = await hashPwAsync(p);
  } else fail(400, 'Geçersiz şifre türü');
  saveSecrets();
}

// ---- Oturumlar: jeton açık tutulmaz, yalnızca SHA-256 özeti saklanır ----
// kim: '@admin' | 'j:<jüri>' | 't:<takım>' | 'm:<mentör>'
const TTL = { admin: 12 * 3600e3, juri: 24 * 3600e3, takim: 7 * 24 * 3600e3, mentor: 7 * 24 * 3600e3, ogrenci: 7 * 24 * 3600e3 };
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');
Q.purgeSessions.run(Date.now());
function newSession(kim, ttl) {
  const token = crypto.randomBytes(24).toString('hex'), now = Date.now();
  Q.purgeSessions.run(now);
  Q.insertSession.run(tokenHash(token), kim, now + ttl);
  return token;
}
function tokenOf(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function sessionOf(req) {
  const t = tokenOf(req);
  if (!t) return null;
  const s = Q.session.get(tokenHash(t)), now = Date.now();
  if (!s || s.bitis < now) return null;
  gorulme.set(s.kim, now);
  // Öğrenci çevrimiçiyse sohbetin üye listesinde takımı çevrimiçi görünür
  if (s.kim.startsWith('s:')) { const o = OQ.get.get(s.kim.slice(2)); if (o && o.takim) gorulme.set('t:' + o.takim, now); }
  return s.kim;
}
// Açık oturum sayıları; öğrenci oturumları takımlarının sayısına da eklenir (panellerdeki "çevrimiçi" için)
function sessionCounts(now) {
  const n = Object.fromEntries(Q.sessionCounts.all(now).map(r => [r.kim, r.n]));
  for (const r of db.prepare(`SELECT o.takim, COUNT(*) AS n FROM oturumlar s JOIN ogrenciler o ON s.kim = 's:' || o.id
    WHERE s.bitis >= ? AND o.takim IS NOT NULL GROUP BY o.takim`).all(now)) n[`t:${r.takim}`] = (n[`t:${r.takim}`] || 0) + r.n;
  return n;
}
const isAdmin = req => sessionOf(req) === '@admin';
function juryOf(req) {
  const k = sessionOf(req);
  return k && k.startsWith('j:') && JURY_NAME()[k.slice(2)] ? k.slice(2) : null;
}
// Takım uç noktaları: takım kendi oturumuyla, yönetici ve atanmış mentör ?takim=<id> ile çağırır
function teamOf(req, url) {
  const k = sessionOf(req);
  if (k === '@admin') return { id: getTeam(url.searchParams.get('takim')).id, admin: true };
  if (k && k.startsWith('m:') && MQ.get.get(k.slice(2))) {
    const id = getTeam(url.searchParams.get('takim')).id;
    if (!isAssigned(k.slice(2), id)) fail(403, 'Bu takım size atanmamış');
    return { id, admin: false, mentor: k.slice(2) };
  }
  if (k && k.startsWith('t:') && Q.team.get(k.slice(2))) return { id: k.slice(2), admin: false };
  if (k && k.startsWith('s:')) {
    const o = OQ.get.get(k.slice(2));
    if (o && o.takim) return { id: o.takim, admin: false, ogrenci: o };
    if (o) fail(409, 'Henüz bir takıma katılmadınız', { takimsiz: true });
  }
  fail(401, 'Oturum geçersiz, tekrar giriş yapın');
}
function loginLimited(req) {
  const ip = clientIp(req), now = Date.now();
  let f = failures.get(ip);
  if (f && f.until < now) { failures.delete(ip); f = null; }
  if (f && f.count >= FAIL_LIMIT) fail(429, 'Çok fazla hatalı deneme. Birkaç dakika sonra tekrar deneyin.');
  return {
    ok() { failures.delete(ip); },
    bad() { failures.set(ip, { count: (f ? f.count : 0) + 1, until: now + FAIL_WINDOW }); }
  };
}

// ---- HTTP yardımcıları ----
const gzipOk = req => /\bgzip\b/.test(req?.headers['accept-encoding'] || '');
function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (body.length > 1400 && gzipOk(res.req)) {
    res.writeHead(code, { ...h, 'Content-Encoding': 'gzip' });
    return res.end(zlib.gzipSync(body, { level: 4 }));
  }
  res.writeHead(code, h);
  res.end(body);
}
function fail(code, msg, extra) { throw Object.assign(new Error(msg), { http: code, extra }); }

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Dosya çok büyük'), { http: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBody(req, limit = 2e5) {
  const buf = await readRaw(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { fail(400, 'Geçersiz istek'); }
}
// Büyük dosyalar belleğe alınmadan geçici klasöre yazılır
async function receiveFile(req, limit) {
  const len = Number(req.headers['content-length']);
  const mb = Math.round(limit / MB);
  if (len > limit) { req.resume(); fail(413, `Dosya en fazla ${mb} MB olabilir`); }
  const tmp = path.join(TMP_DIR, crypto.randomBytes(8).toString('hex'));
  let size = 0;
  const counter = new (require('stream').Transform)({
    transform(chunk, _, cb) {
      size += chunk.length;
      if (size > limit) return cb(Object.assign(new Error(`Dosya en fazla ${mb} MB olabilir`), { http: 413 }));
      cb(null, chunk);
    }
  });
  try { await pipeline(req, counter, fs.createWriteStream(tmp)); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e.http ? e : Object.assign(new Error('Yükleme yarıda kesildi'), { http: 400 }); }
  if (!size) { fs.rmSync(tmp, { force: true }); fail(400, 'Dosya boş'); }
  return { tmp, size };
}

// ---- ZIP açma (bağımlılıksız): tarayıcı oyunu ZIP olarak yüklenir ----
function unzipTo(file, dest) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) fail(400, 'Dosya geçerli bir ZIP değil');
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff) fail(400, 'ZIP64 biçimi desteklenmiyor. Klasörü Windows\'ta "Sıkıştırılmış klasöre gönder" ile yeniden sıkıştırın.');
    if (count > 20000) fail(400, 'ZIP içinde çok fazla dosya var');
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const entries = [];
    let total = 0;
    for (let p = 0, i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) fail(400, 'ZIP dosyası bozuk');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const raw = cd.subarray(p + 46, p + 46 + nlen);
      p += 46 + nlen + xlen + clen;
      // Bayrak 11: UTF-8 ad. Değilse Windows'un eski kod sayfası: ASCII dışı harfler bozulabilir, latin1 ile okunur
      const name = (flags & 0x800 ? raw.toString('utf8') : raw.toString('latin1')).replace(/\\/g, '/');
      if (name.endsWith('/')) continue;
      if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/i.test(name)) continue;
      if (flags & 1) fail(400, 'Şifreli ZIP desteklenmiyor');
      if (method !== 0 && method !== 8) fail(400, `"${name}" desteklenmeyen sıkıştırma yöntemiyle sıkıştırılmış`);
      const parts = name.split('/').filter(s => s && s !== '.');
      if (!parts.length || parts.some(s => s === '..') || /^[a-z]:/i.test(name) || name.startsWith('/')) fail(400, `ZIP içinde geçersiz dosya yolu: ${name}`);
      total += usize;
      if (total > LIMIT.acik) fail(400, `ZIP açıldığında ${Math.round(LIMIT.acik / MB)} MB'tan büyük`);
      entries.push({ parts, method, csize, usize, local });
    }
    if (!entries.length) fail(400, 'ZIP boş');
    // Giriş sayfası: en sığdaki index.html. Tek bir klasörün içindeyse klasör kökü kaldırılır.
    const idx = entries.filter(e => e.parts[e.parts.length - 1].toLowerCase() === 'index.html')
      .sort((a, b) => a.parts.length - b.parts.length)[0];
    if (!idx) fail(400, 'ZIP içinde index.html bulunamadı. Oyunun Web/HTML5/WebGL çıktısını sıkıştırın.');
    const prefix = idx.parts.slice(0, -1);
    const under = e => prefix.every((s, i) => e.parts[i] === s) && e.parts.length > prefix.length;
    const head = Buffer.alloc(30);
    for (const e of entries) {
      if (!under(e)) continue;
      fs.readSync(fd, head, 0, 30, e.local);
      if (head.readUInt32LE(0) !== 0x04034b50) fail(400, 'ZIP dosyası bozuk');
      const start = e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const comp = Buffer.alloc(e.csize);
      fs.readSync(fd, comp, 0, e.csize, start);
      let data;
      try { data = e.method === 8 ? zlib.inflateRawSync(comp, { maxOutputLength: e.usize + 1 }) : comp; }
      catch { fail(400, `ZIP içindeki "${e.parts.join('/')}" açılamadı`); }
      const out = path.join(dest, ...e.parts.slice(prefix.length));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, data);
    }
    return 'index.html';
  } finally { fs.closeSync(fd); }
}

// ---- Dosya yükleme / silme (takım ya da yönetici) ----
const IMG_EXT = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif' };
const IMG_MAGIC = { png: b => b.readUInt32BE(0) === 0x89504e47, jpg: b => b[0] === 0xff && b[1] === 0xd8, gif: b => b.toString('ascii', 0, 3) === 'GIF', webp: b => b.toString('ascii', 8, 12) === 'WEBP' };
const DL_EXT = /\.(zip|7z|rar|exe|msi|apk|sb3|pdf)$/i;
const safeFileName = n => {
  const ext = path.extname(n).toLowerCase();
  return (normalizeUser(path.basename(n, ext)).slice(0, 60) || 'dosya') + ext;
};

async function upload(req, url, who) {
  const tur = url.searchParams.get('tur'), ad = url.searchParams.get('ad') || '';
  if (!who.admin && !CFG.teslimAcik) { req.resume(); fail(403, 'Teslim süresi doldu; sayfa artık düzenlenemez'); }
  const row = getTeam(who.id), page = pageOf(row), dir = teamDir(who.id);
  fs.mkdirSync(dir, { recursive: true });

  if (tur === 'kapak' || tur === 'gorsel') {
    const ext = IMG_EXT[(ad.match(/\.([a-z]+)$/i) || [])[1]?.toLowerCase()];
    if (!ext) { req.resume(); fail(400, 'Yalnızca PNG, JPG, WEBP ya da GIF yüklenebilir'); }
    if (tur === 'gorsel' && (page.gorseller || []).length >= MAX_GORSEL) { req.resume(); fail(400, `En fazla ${MAX_GORSEL} ekran görüntüsü eklenebilir`); }
    const buf = await readRaw(req, LIMIT.gorsel);
    if (buf.length < 12 || !IMG_MAGIC[ext](buf)) fail(400, 'Dosya bir görsel değil ya da uzantısı yanlış');
    const name = `${tur}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    if (tur === 'kapak') {
      if (page.kapak) fs.rmSync(path.join(dir, page.kapak), { force: true });
      page.kapak = name;
    } else page.gorseller = [...(page.gorseller || []), name];
  } else if (tur === 'oyun') {
    if (!/\.zip$/i.test(ad)) { req.resume(); fail(400, 'Tarayıcı oyunu ZIP olarak yüklenmeli'); }
    const { tmp, size } = await receiveFile(req, LIMIT.oyun);
    const out = path.join(TMP_DIR, crypto.randomBytes(8).toString('hex'));
    try {
      fs.mkdirSync(out);
      const giris = unzipTo(tmp, out);
      fs.rmSync(path.join(dir, 'oyun'), { recursive: true, force: true });
      fs.renameSync(out, path.join(dir, 'oyun'));
      page.oyun = { giris, boyut: size, zaman: Date.now(), en: page.oyun?.en || 960, boy: page.oyun?.boy || 600 };
    } catch (e) { fs.rmSync(out, { recursive: true, force: true }); throw e; }
    finally { fs.rmSync(tmp, { force: true }); }
  } else if (tur === 'indir') {
    if (!DL_EXT.test(ad)) { req.resume(); fail(400, 'İndirme dosyası ZIP, 7Z, RAR, EXE, MSI, APK, SB3 ya da PDF olmalı'); }
    const { tmp, size } = await receiveFile(req, LIMIT.indir);
    const name = safeFileName(ad);
    fs.rmSync(path.join(dir, 'indir'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'indir'));
    fs.renameSync(tmp, path.join(dir, 'indir', name));
    page.indir = { ad: name, boyut: size, zaman: Date.now() };
  } else { req.resume(); fail(400, 'Geçersiz yükleme türü'); }

  savePage(who.id, page);
  return page;
}

function removeFile(url, who) {
  if (!who.admin && !CFG.teslimAcik) fail(403, 'Teslim süresi doldu; sayfa artık düzenlenemez');
  const tur = url.searchParams.get('tur'), ad = url.searchParams.get('ad');
  const row = getTeam(who.id), page = pageOf(row), dir = teamDir(who.id);
  if (tur === 'kapak' && page.kapak) { fs.rmSync(path.join(dir, page.kapak), { force: true }); delete page.kapak; }
  else if (tur === 'gorsel' && (page.gorseller || []).includes(ad)) {
    fs.rmSync(path.join(dir, ad), { force: true });
    page.gorseller = page.gorseller.filter(g => g !== ad);
  } else if (tur === 'oyun' && page.oyun) { fs.rmSync(path.join(dir, 'oyun'), { recursive: true, force: true }); delete page.oyun; }
  else if (tur === 'indir' && page.indir) { fs.rmSync(path.join(dir, 'indir'), { recursive: true, force: true }); delete page.indir; }
  else fail(404, 'Dosya bulunamadı');
  savePage(who.id, page);
  return page;
}

function teamView(row) {
  const mentorler = db.prepare('SELECT m.ad, m.alan FROM mentor_takim mt JOIN mentorler m ON m.id = mt.mentor WHERE mt.takim = ? ORDER BY m.ad').all(row.id);
  return {
    mentorler: mentorler.map(m => ({ ad: m.ad, alan: m.alan })),
    ekip: { kod: row.kod, ogrenciler: studentsOf(row.id), max: MAX_OGRENCI },
    id: row.id, ad: row.ad, il: row.il, okul: row.okul, danisman: row.danisman, yayinda: !!row.yayinda,
    sayfa: pageOf(row), guncelleme: row.guncelleme,
    teslimAcik: CFG.teslimAcik, event: pubEvent(), tema: CFG.tema, simdi: Date.now(),
    rozet: CFG.sonuclarAcik ? row.rozet : '', belgeAcik: !CFG.teslimAcik,
    // Jüri geri bildirimleri isimsiz ve sırası karışık gider (hangi jürinin yazdığı anlaşılmasın)
    geriBildirim: CFG.geriBildirimAcik ? db.prepare('SELECT metin FROM geribildirimler WHERE takim = ? ORDER BY juri').all(row.id).map(r => r.metin) : null,
    sinir: { gorsel: LIMIT.gorsel, oyun: LIMIT.oyun, indir: LIMIT.indir, maxGorsel: MAX_GORSEL }
  };
}

// ---- XLSX dışa aktarma (bağımlılıksız: elle yazılmış OOXML + ZIP) ----
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8); head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10); cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, comp);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
const xmlEsc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colName(i) { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
function sheetXml(rows, widths) {
  const body = rows.map((row, r) => `<row r="${r + 1}">` + row.map((c, i) => {
    const cell = c !== null && typeof c === 'object' ? c : { v: c };
    if (cell.v === null || cell.v === undefined || cell.v === '') return '';
    const ref = colName(i) + (r + 1), st = cell.s ? ` s="${cell.s}"` : '';
    return typeof cell.v === 'number'
      ? `<c r="${ref}"${st}><v>${cell.v}</v></c>`
      : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${body}</sheetData></worksheet>`;
}
function workbook(sheets) {
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  return zip([
    ['[Content_Types].xml', ct], ['_rels/.rels', rels], ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', wbRels], ['xl/styles.xml', styles],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths)])
  ]);
}
function scoresXlsx() {
  const H = v => ({ v, s: 1 }), r1 = x => Math.round(x * 10) / 10;
  const J = CFG.juries, C = CFG.criteria, odali = hasRooms();
  const t = maxTotals(), tot = t.ana + (t.ek ? ` + ${t.ek}` : '');
  // Odalı düzende ön eleme sırası oda içindedir
  function siralama(tur) {
    const rank = ranking(tur), oda = odali && tur === 'on';
    const rows = [[H('Sıra'), ...(oda ? [H('Oda')] : []), H('Takım'), H('Oyun'), H('İl'), H('Okul'), H(`Ortalama (/${tot})`), H('Oy veren jüri'),
      ...C.map(c => H(`${c.short || c.name} ort.`)), ...J.map(j => H(j.name)), ...(odali && tur === 'on' ? [H('Finalist')] : []), H('Rozet')]];
    const gruplar = oda ? [...CFG.odalar.map(o => rank.filter(r => r.oda === o.id)), rank.filter(r => !r.oda)] : [rank];
    for (const g of gruplar) g.forEach((s, i) => rows.push([
      s.n ? i + 1 : null, ...(oda ? [roomName(s.oda) || 'Odasız'] : []), s.takim, s.baslik, s.il, s.okul, s.avg === null ? null : { v: r1(s.avg), s: 3 }, `${s.n} / ${s.beklenen}`,
      ...s.critAvg.map(v => v === null ? null : { v: r1(v), s: 2 }), ...s.per.map(v => v ? v.total : null), ...(odali && tur === 'on' ? [s.finalist ? 'Evet' : ''] : []), s.rozet
    ]));
    return { rows, widths: [6, ...(oda ? [14] : []), 24, 26, 14, 30, 14, 12, ...C.map(() => 11), ...J.map(() => 16), ...(odali && tur === 'on' ? [10] : []), 20] };
  }
  const when = x => new Date(x).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const detay = [[H('Aşama'), H('Takım'), H('Oyun'), H('Jüri'), ...C.map(c => H(`${c.name} (/${c.max})`)), H('Toplam'), H('Jüri notu'), H('Oy zamanı')]];
  const turlar = odali && CFG.finalistler.length ? ['on', 'final'] : ['on'];
  for (const tur of turlar) {
    const votes = loadVotes(tur);
    for (const s of ranking(tur)) for (const j of J) {
      const v = votes[j.id][s.id];
      if (v) detay.push([tur === 'final' ? 'Final' : odali ? 'Ön eleme' : '', s.takim, s.baslik, j.name, ...v.scores, v.total, v.note, when(v.time)]);
    }
  }
  const sayfalar = [{ name: odali ? 'Ön Eleme' : 'Sıralama', ...siralama('on') }];
  if (turlar.includes('final')) sayfalar.push({ name: 'Final', ...siralama('final') });
  sayfalar.push({ name: 'Jüri Ayrıntısı', rows: detay, widths: [10, 24, 26, 24, ...C.map(() => 14), 9, 40, 18] });
  return workbook(sayfalar);
}

// ---- Arşiv: geçmiş yılların itch.io jam'leri ----
// Jam sayfasındaki I.ViewJam(..., {"id":N}) değerinden jam numarası bulunur, katılımlar
// itch.io'nun jam sayfasının kendisinin de kullandığı /jam/<N>/entries.json adresinden okunur.
const ITCH_UA = { 'User-Agent': 'Mozilla/5.0 (EgitiJAM arsiv)' };
const AQ = {
  list: db.prepare('SELECT * FROM arsiv ORDER BY donem DESC, sira'),
  donemler: db.prepare('SELECT donem, COUNT(*) AS sayi, SUM(gizli) AS gizli FROM arsiv GROUP BY donem ORDER BY donem DESC'),
  get: db.prepare('SELECT * FROM arsiv WHERE donem = ? AND itch_id = ?'),
  upsert: db.prepare(`INSERT INTO arsiv (donem, itch_id, baslik, kisa, yapimci, baglanti, kapak, platform, sira) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (donem, itch_id) DO UPDATE SET baslik = excluded.baslik, kisa = excluded.kisa, yapimci = excluded.yapimci,
    baglanti = excluded.baglanti, kapak = COALESCE(excluded.kapak, arsiv.kapak), platform = excluded.platform, sira = excluded.sira`),
  update: db.prepare('UPDATE arsiv SET rozet = ?, gizli = ? WHERE donem = ? AND itch_id = ?'),
  deleteDonem: db.prepare('DELETE FROM arsiv WHERE donem = ?')
};
const arsivKart = r => ({
  donem: r.donem, id: r.itch_id, baslik: r.baslik, kisa: r.kisa, yapimci: r.yapimci, baglanti: r.baglanti,
  kapak: r.kapak, platform: JSON.parse(r.platform), rozet: r.rozet, gizli: !!r.gizli
});

async function itchGet(url, type) {
  const r = await fetch(url, { headers: ITCH_UA, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) fail(502, `itch.io yanıt vermedi (${r.status}): ${url}`);
  return type === 'json' ? r.json() : type === 'buf' ? Buffer.from(await r.arrayBuffer()) : r.text();
}

async function importItchJam(adres, donem) {
  const m = String(adres || '').trim().match(/^https?:\/\/itch\.io\/jam\/([a-z0-9_-]+)\/?/i);
  if (!m) fail(400, 'Adres https://itch.io/jam/... biçiminde olmalı');
  donem = str(donem, 20);
  if (!donem) fail(400, 'Yıl (dönem) boş bırakılamaz');
  if (donem === CFG.event.donem) fail(400, `${donem} bu yılın dönemi; arşiv için geçmiş bir yıl yazın`);
  const html = await itchGet(`https://itch.io/jam/${m[1]}`);
  const idm = html.match(/I\.ViewJam\([^)]*?"id":(\d+)/);
  if (!idm) fail(502, 'Jam sayfasında jam numarası bulunamadı');
  const data = await itchGet(`https://itch.io/jam/${idm[1]}/entries.json`, 'json');
  const list = Array.isArray(data.jam_games) ? data.jam_games : [];
  if (!list.length) fail(404, 'Bu jam\'de katılım bulunamadı');

  // Kapaklar 4'erli indirilir; yalnızca itch.io görsel sunucusundan
  let kapakSay = 0;
  const kapaklar = new Map();
  const isler = list.map(e => async () => {
    const g = e.game || {};
    const u = String(g.cover || '');
    if (!/^https:\/\/img\.itch\.zone\//.test(u)) return;
    try {
      const buf = await itchGet(u, 'buf');
      const ext = Object.keys(IMG_MAGIC).find(k => buf.length > 12 && IMG_MAGIC[k](buf));
      if (!ext) return;
      const name = `${normalizeUser(donem)}-${Number(g.id)}.${ext}`;
      fs.writeFileSync(path.join(ARSIV_DIR, name), buf);
      kapaklar.set(g.id, name); kapakSay++;
    } catch { /* kapak alınamazsa kartta renkli zemin görünür */ }
  });
  for (let i = 0; i < isler.length; i += 4) await Promise.all(isler.slice(i, i + 4).map(f => f()));

  tx(() => list.forEach((e, i) => {
    const g = e.game || {};
    if (!g.id || !g.title || !/^https:\/\/[a-z0-9-]+\.itch\.io\//i.test(g.url || '')) return;
    const kisiler = [g.user?.name, ...(e.contributors || []).map(c => c.name)].filter(Boolean);
    AQ.upsert.run(donem, Number(g.id), str(g.title, 120), str(g.short_text, 300), str([...new Set(kisiler)].join(', '), 200),
      g.url, kapaklar.get(g.id) || null, JSON.stringify((g.platforms || []).filter(p => typeof p === 'string').slice(0, 6)), i);
  }));
  return { donem, sayi: list.length, kapak: kapakSay };
}

function removeDonem(donem) {
  for (const r of AQ.list.all()) if (r.donem === donem && r.kapak) fs.rmSync(path.join(ARSIV_DIR, r.kapak), { force: true });
  AQ.deleteDonem.run(donem);
}

// ---- Yönetim paneli ----
function adminState() {
  const now = Date.now();
  const sessions = sessionCounts(now);
  const byMentor = {}, byTeam = {}, rooms = roomOfTeam();
  for (const a of MQ.assignments.all()) { (byMentor[a.mentor] ||= []).push(a.takim); (byTeam[a.takim] ||= []).push(a.mentor); }
  return {
    event: CFG.event, criteria: CFG.criteria, maxTotals: maxTotals(), tema: CFG.tema,
    teslimAcik: CFG.teslimAcik, oylamaAcik: CFG.oylamaAcik, sonuclarAcik: CFG.sonuclarAcik, mentorKayit: CFG.mentorKayit, genelSohbet: CFG.genelSohbet,
    ogrenciKayit: CFG.ogrenciKayit, ogrenciTakim: CFG.ogrenciTakim, maxOgrenci: MAX_OGRENCI,
    ogrenciler: OQ.all.all().map(o => ({ id: o.id, ad: o.ad, takim: o.takim, kaptan: !!o.kaptan, olusturma: o.olusturma, oturum: sessions[`s:${o.id}`] || 0 })),
    temaGizle: CFG.temaGizle, temaGizli: temaGizli(), geriBildirimAcik: CFG.geriBildirimAcik, yasakKelimeler: CFG.yasakKelimeler,
    geriBildirimSayisi: db.prepare('SELECT COUNT(*) AS n FROM geribildirimler').get().n,
    mentors: MQ.all.all().map(r => ({ id: r.id, ad: r.ad, alan: r.alan, takimlar: byMentor[r.id] || [], oturum: sessions[`m:${r.id}`] || 0 })),
    juries: CFG.juries.map(j => ({ ...j, ozelSifre: !!SECRETS.juri[j.id], oturum: sessions[`j:${j.id}`] || 0 })),
    teams: Q.teams.all().map(row => {
      const p = pageOf(row);
      return {
        id: row.id, ad: row.ad, il: row.il, okul: row.okul, danisman: row.danisman, yayinda: !!row.yayinda, rozet: row.rozet,
        baslik: p.baslik || '', kapak: p.kapak || null, oyun: !!p.oyun, indir: !!p.indir, video: !!p.video,
        gorsel: (p.gorseller || []).length, uye: (p.uyeler || []).length, guncelleme: row.guncelleme, oturum: sessions[`t:${row.id}`] || 0,
        mentorler: byTeam[row.id] || [], oda: rooms[row.id] || '', kod: row.kod
      };
    }),
    ranking: ranking('on'), votes: loadVotes('on'),
    odalar: CFG.odalar, asama: CFG.asama, finalistler: CFG.finalistler, finalSayi: CFG.finalSayi,
    finalRanking: hasRooms() ? ranking('final') : [], finalVotes: hasRooms() ? loadVotes('final') : {},
    sifre: { ortak: SECRETS.ortak ? 'panel' : process.env.JURI_SIFRE ? 'env' : null, admin: SECRETS.admin ? 'panel' : 'env' },
    oyunAdresi: OYUN_ADRESI || null,
    arsiv: AQ.list.all().map(arsivKart)
  };
}

// Yedek: ayarlar, takımlar (şifre özetleriyle) ve oylar. Yüklenen dosyalar (urunler/ klasörü) yedeğe girmez.
function backup() {
  return {
    tur: 'egitijam-yedek', zaman: new Date().toISOString(),
    ayarlar: { event: CFG.event, juries: CFG.juries, criteria: CFG.criteria, teslimAcik: CFG.teslimAcik, oylamaAcik: CFG.oylamaAcik, sonuclarAcik: CFG.sonuclarAcik, mentorKayit: CFG.mentorKayit, genelSohbet: CFG.genelSohbet, temaGizle: CFG.temaGizle, geriBildirimAcik: CFG.geriBildirimAcik, yasakKelimeler: CFG.yasakKelimeler, tema: CFG.tema,
      ogrenciKayit: CFG.ogrenciKayit, ogrenciTakim: CFG.ogrenciTakim,
      odalar: CFG.odalar, asama: CFG.asama, finalistler: CFG.finalistler, finalSayi: CFG.finalSayi },
    odaTakim: Q.rooms.all(),
    mentorler: MQ.all.all(), mentorTakim: MQ.assignments.all(),
    ogrenciler: OQ.all.all(),
    mesajlar: db.prepare('SELECT * FROM mesajlar WHERE silindi = 0 ORDER BY id').all(),
    tepkiler: db.prepare('SELECT * FROM tepkiler').all(),
    ekler: db.prepare('SELECT * FROM ekler WHERE mesaj IS NOT NULL').all(), // dosyaların kendisi ekler/ klasöründe kalır
    takimlar: Q.teams.all(),
    oylar: Q.votes.all().map(r => ({ ...r, puanlar: JSON.parse(r.puanlar) })),
    geribildirimler: db.prepare('SELECT * FROM geribildirimler').all(),
    arsiv: AQ.list.all()
  };
}
function restore(b) {
  if (!b || b.tur !== 'egitijam-yedek' || !b.ayarlar) fail(400, 'Bu dosya bir EğitiJAM yedeği değil');
  const a = b.ayarlar, oldCfg = structuredClone(CFG), oldSecrets = structuredClone(SECRETS);
  try {
    return tx(() => {
      db.exec('DELETE FROM oylar; DELETE FROM takimlar; DELETE FROM oda_takim; DELETE FROM geribildirimler; DELETE FROM susturmalar; DELETE FROM bildirimler;');
      CFG.odalar = Array.isArray(a.odalar) ? a.odalar.filter(o => o && /^o\d+$/.test(o.id)).map(o => ({ id: o.id, ad: str(o.ad, 40) || o.id })) : [];
      db.exec("DELETE FROM oturumlar WHERE kim <> '@admin'");
      CFG.juries = [];
      setEvent(a.event || {});
      setJuries(Array.isArray(a.juries) ? a.juries : []);
      setCriteria(a.criteria);
      CFG.teslimAcik = a.teslimAcik !== false; CFG.oylamaAcik = !!a.oylamaAcik; CFG.sonuclarAcik = !!a.sonuclarAcik; CFG.mentorKayit = !!a.mentorKayit; CFG.genelSohbet = a.genelSohbet !== false;
      CFG.ogrenciKayit = a.ogrenciKayit !== false; CFG.ogrenciTakim = a.ogrenciTakim !== false;
      CFG.temaGizle = a.temaGizle !== false; CFG.geriBildirimAcik = !!a.geriBildirimAcik; CFG.yasakKelimeler = kelimeListesi(a.yasakKelimeler);
      CFG.asama = a.asama === 'final' && CFG.odalar.length ? 'final' : 'on';
      CFG.finalSayi = Number.isInteger(a.finalSayi) && a.finalSayi > 0 ? a.finalSayi : 2;
      CFG.tema = TEMALAR.includes(a.tema) ? a.tema : 'd';
      for (const t of Array.isArray(b.takimlar) ? b.takimlar : []) {
        const id = normalizeUser(t.id);
        if (!id || !t.ad || !t.sifre) continue;
        Q.insertTeam.run(id, str(t.ad, 80), str(t.il, 40), str(t.okul, 120), str(t.danisman, 80), String(t.sifre),
          typeof t.sayfa === 'string' ? t.sayfa : '{}', t.yayinda ? 1 : 0, str(t.rozet, 60), Number(t.olusturma) || Date.now(), Number(t.guncelleme) || 0,
          normCode(t.kod).length === 6 && !Q.teamByCode.get(normCode(t.kod)) ? normCode(t.kod) : newCode());
      }
      // Öğrenciler (eski yedeklerde yoksa mevcutlar kalır, silinen takımlardakiler takımsız olur)
      if (Array.isArray(b.ogrenciler)) {
        db.exec("DELETE FROM ogrenciler; DELETE FROM oturumlar WHERE kim LIKE 's:%'");
        for (const o of b.ogrenciler) {
          const id = normalizeUser(o.id);
          if (!id || !o.ad || !o.sifre || OQ.get.get(id) || Q.team.get(id)) continue;
          const takim = o.takim && Q.team.get(o.takim) ? o.takim : null;
          OQ.insert.run(id, str(o.ad, 60), String(o.sifre), takim, takim && o.kaptan ? 1 : 0, Number(o.katilma) || 0, Number(o.olusturma) || Date.now());
        }
      } else db.exec('UPDATE ogrenciler SET takim = NULL, kaptan = 0 WHERE takim NOT IN (SELECT id FROM takimlar)');
      CFG.finalistler = (Array.isArray(a.finalistler) ? a.finalistler : []).filter(id => Q.team.get(id));
      for (const r of Array.isArray(b.odaTakim) ? b.odaTakim : []) if (Q.team.get(r.takim) && CFG.odalar.some(o => o.id === r.oda)) Q.setRoom.run(r.takim, r.oda);
      // Mentörler ve mesajlar (eski yedeklerde yoksa yalnızca silinen takımlara ait olanlar temizlenir)
      if (Array.isArray(b.mentorler)) {
        db.exec("DELETE FROM mentorler; DELETE FROM mentor_takim; DELETE FROM okunan; DELETE FROM oturumlar WHERE kim LIKE 'm:%'");
        for (const r of b.mentorler) {
          const id = normalizeUser(r.id);
          if (id && r.ad && r.sifre && !MQ.get.get(id)) MQ.insert.run(id, str(r.ad, 80), str(r.alan, 80), String(r.sifre), Number(r.olusturma) || Date.now());
        }
        for (const a of Array.isArray(b.mentorTakim) ? b.mentorTakim : []) if (MQ.get.get(a.mentor) && Q.team.get(a.takim)) MQ.assign.run(a.mentor, a.takim);
      } else db.exec('DELETE FROM mentor_takim WHERE takim NOT IN (SELECT id FROM takimlar)');
      if (Array.isArray(b.mesajlar)) {
        db.exec('DELETE FROM mesajlar; DELETE FROM okunan; DELETE FROM tepkiler; DELETE FROM bahsetmeler; DELETE FROM ekler;');
        for (const r of b.mesajlar) {
          if (!r.kanal || typeof r.metin !== 'string' || r.silindi || !['admin', 'mentor', 'takim', 'juri'].includes(r.rol)) continue;
          if (r.kanal.startsWith('t:') && !Q.team.get(r.kanal.slice(2))) continue;
          const kanal = str(r.kanal, 40), metin = str(r.metin, 2000);
          const id = Number(KQ.restore.run(Number.isInteger(r.id) && r.id > 0 ? r.id : null, kanal, str(r.kim, 40), str(r.ad, 80), r.rol, metin,
            r.yardim ? 1 : 0, Number(r.zaman) || Date.now(), Number.isInteger(r.yanit) ? r.yanit : null, Number(r.duzenlendi) || null, 0, str(r.uye, 80) || null).lastInsertRowid);
          saveMentions(id, kanal, metin);
        }
        for (const t of Array.isArray(b.tepkiler) ? b.tepkiler : []) {
          if (EMOJILER.includes(t.emoji) && KQ.get.get(t.mesaj)) db.prepare('INSERT OR IGNORE INTO tepkiler (mesaj, kim, ad, emoji, zaman) VALUES (?, ?, ?, ?, ?)')
            .run(t.mesaj, str(t.kim, 40), str(t.ad, 80), t.emoji, Number(t.zaman) || Date.now());
        }
        for (const e of Array.isArray(b.ekler) ? b.ekler : []) {
          const msj = KQ.get.get(e.mesaj);
          if (msj && /^[a-f0-9]{24}\.[a-z0-9]+$/.test(e.id || '') && fs.existsSync(path.join(EK_DIR, e.id))) {
            KQ.addAttachment.run(e.id, msj.id, msj.kanal, str(e.kim, 40), str(e.ad, 120), Number(e.boyut) || 0, e.gorsel ? 1 : 0, Number(e.zaman) || Date.now());
          }
        }
      } else db.exec("DELETE FROM mesajlar WHERE kanal LIKE 't:%' AND substr(kanal, 3) NOT IN (SELECT id FROM takimlar)");
      // Eski yedeklerde arşiv yoksa mevcut arşiv korunur
      if (Array.isArray(b.arsiv)) {
        db.exec('DELETE FROM arsiv');
        for (const r of b.arsiv) {
          if (!r.donem || !Number.isInteger(r.itch_id) || !r.baslik || !/^https:\/\//.test(r.baglanti || '')) continue;
          AQ.upsert.run(str(r.donem, 20), r.itch_id, str(r.baslik, 120), str(r.kisa, 300), str(r.yapimci, 200), r.baglanti,
            /^[a-z0-9]+-\d+\.(png|jpg|gif|webp)$/.test(r.kapak || '') ? r.kapak : null, typeof r.platform === 'string' ? r.platform : '[]', Number(r.sira) || 0);
          AQ.update.run(str(r.rozet, 60), r.gizli ? 1 : 0, str(r.donem, 20), r.itch_id);
        }
      }
      let skipped = 0;
      const names = JURY_NAME();
      for (const v of Array.isArray(b.oylar) ? b.oylar : []) {
        if (!names[v.juri] || !Q.team.get(v.takim) || scoreError(v.puanlar)) { skipped++; continue; }
        Q.upsertVote.run(v.juri, v.takim, v.tur === 'final' ? 'final' : 'on', JSON.stringify(v.puanlar), v.puanlar.reduce((x, y) => x + y, 0), str(v.notu, 2000), Number(v.zaman) || Date.now());
      }
      for (const g of Array.isArray(b.geribildirimler) ? b.geribildirimler : []) {
        if (names[g.juri] && Q.team.get(g.takim) && str(g.metin, 2000)) db.prepare('INSERT OR REPLACE INTO geribildirimler (juri, takim, metin, zaman) VALUES (?, ?, ?, ?)')
          .run(g.juri, g.takim, str(g.metin, 2000), Number(g.zaman) || Date.now());
      }
      saveCfg();
      return skipped;
    });
  } catch (e) { CFG = oldCfg; SECRETS = oldSecrets; throw e; }
}

const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' }).slice(0, 16).replace(' ', '_').replace(':', '');

async function adminRoutes(req, res, url) {
  const p = url.pathname.slice('/api/admin/'.length), m = req.method;

  if (m === 'POST' && p === 'giris') {
    if (!adminConfigured()) fail(503, 'Yönetim şifresi tanımlı değil: .env dosyasına ADMIN_SIFRE yazıp sunucuyu yeniden başlatın.');
    const lim = loginLimited(req);
    const { sifre } = await readBody(req);
    if (!(await adminPasswordOk(sifre || ''))) { lim.bad(); fail(401, 'Şifre hatalı'); }
    lim.ok();
    return json(res, 200, { token: newSession('@admin', TTL.admin) });
  }
  if (!isAdmin(req)) fail(401, 'Yönetici oturumu geçersiz, tekrar giriş yapın');

  if (m === 'POST' && p === 'cikis') { Q.deleteSession.run(tokenHash(tokenOf(req))); return json(res, 200, { ok: true }); }
  if (m === 'GET' && p === 'durum') return json(res, 200, adminState());

  if (m === 'GET' && p === 'puanlar.xlsx') {
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="egitijam-puanlar-${stamp()}.xlsx"`, 'Cache-Control': 'no-store'
    });
    return res.end(scoresXlsx());
  }
  if (m === 'GET' && p === 'yedek') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="egitijam-yedek-${stamp()}.json"`, 'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(backup(), null, 2));
  }

  let extra = {};
  if (m === 'PUT' && p === 'etkinlik') setEvent(await readBody(req, 1e5));
  else if (m === 'PUT' && p === 'juriler') setJuries((await readBody(req)).list);
  else if (m === 'PUT' && p === 'kriterler') setCriteria((await readBody(req)).list);
  else if (m === 'PUT' && p === 'sifre') await setPassword(await readBody(req));
  else if (m === 'PUT' && p === 'bayraklar') {
    const b = await readBody(req);
    for (const k of ['teslimAcik', 'oylamaAcik', 'sonuclarAcik', 'mentorKayit', 'genelSohbet', 'temaGizle', 'geriBildirimAcik', 'ogrenciKayit', 'ogrenciTakim']) if (k in b) CFG[k] = !!b[k];
    if ('yasakKelimeler' in b) CFG.yasakKelimeler = kelimeListesi(b.yasakKelimeler);
    if ('asama' in b) {
      if (!['on', 'final'].includes(b.asama)) fail(400, 'Geçersiz aşama');
      if (b.asama === 'final' && !hasRooms()) fail(400, 'Final aşaması yalnızca jüri odalarıyla kullanılır');
      if (b.asama === 'final' && !CFG.finalistler.length) fail(400, 'Önce finalistleri belirleyin');
      CFG.asama = b.asama;
    }
    if ('tema' in b) { if (!TEMALAR.includes(b.tema)) fail(400, 'Geçersiz tema'); CFG.tema = b.tema; }
    saveCfg();
  } else if (m === 'POST' && p === 'takim') {
    extra.yeni = [createTeam(await readBody(req))];
  } else if (m === 'POST' && p === 'takimlar') {
    extra.yeni = await createTeamsBulk((await readBody(req, 1e6)).metin);
  } else if (m === 'PUT' && p === 'takim') {
    const b = await readBody(req);
    const row = getTeam(b.id);
    const ad = str(b.ad, 80);
    if (!ad) fail(400, 'Takım adı boş bırakılamaz');
    Q.updateTeamInfo.run(ad, str(b.il, 40), str(b.okul, 120), str(b.danisman, 80), b.yayinda ? 1 : 0, str(b.rozet, 60), row.id);
    if (b.kullanici !== undefined) extra.id = renameTeamId(row.id, b.kullanici);
  } else if (m === 'POST' && p === 'takim-sifre') {
    const row = getTeam((await readBody(req)).id);
    const sifre = newPassword();
    Q.setTeamPw.run(await hashPwAsync(sifre), row.id);
    Q.deleteSessionsOf.run(`t:${row.id}`);
    extra.yeni = [{ id: row.id, ad: row.ad, il: row.il, okul: row.okul, sifre, kod: row.kod }];
  } else if (m === 'DELETE' && p === 'takim') {
    removeTeam(url.searchParams.get('id'));
  } else if (m === 'POST' && p === 'mentor') {
    const b = await readBody(req);
    const yeni = tx(() => { const r = createMentor(b); if (Array.isArray(b.takimlar)) updateMentor({ ...r, takimlar: b.takimlar }); return r; });
    extra.yeni = [yeni];
  } else if (m === 'POST' && p === 'mentorler') {
    extra.yeni = await createMentorsBulk((await readBody(req, 1e6)).metin);
  } else if (m === 'PUT' && p === 'mentor') {
    updateMentor(await readBody(req, 1e5));
  } else if (m === 'POST' && p === 'mentor-sifre') {
    const row = getMentor((await readBody(req)).id);
    const sifre = newPassword();
    MQ.setPw.run(await hashPwAsync(sifre), row.id);
    Q.deleteSessionsOf.run(`m:${row.id}`);
    extra.yeni = [{ id: row.id, ad: row.ad, alan: row.alan, sifre }];
  } else if (m === 'DELETE' && p === 'mentor') {
    removeMentor(url.searchParams.get('id'));
  } else if (m === 'PUT' && p === 'ogrenci') {
    // Öğrenciyi koda gerek olmadan bir takıma koyar ya da takımdan çıkarır (takim: '' ise takımsız)
    const b = await readBody(req), o = getStudent(b.id), takim = b.takim ? getTeam(b.takim).id : null;
    if (takim !== o.takim) tx(() => { leaveTeam(o); if (takim) joinTeam(getStudent(o.id), takim); });
  } else if (m === 'POST' && p === 'ogrenci-sifre') {
    const o = getStudent((await readBody(req)).id), sifre = newPassword();
    OQ.setPw.run(await hashPwAsync(sifre), o.id);
    Q.deleteSessionsOf.run(`s:${o.id}`);
    extra.yeniSifre = { id: o.id, ad: o.ad, sifre };
  } else if (m === 'DELETE' && p === 'ogrenci') {
    removeStudent(url.searchParams.get('id'));
  } else if (m === 'PUT' && p === 'oy') {
    const { juri, takim, scores, note, tur } = await readBody(req);
    if (!JURY_NAME()[juri]) fail(400, 'Geçersiz jüri');
    getTeam(takim);
    const err = scoreError(scores); if (err) fail(400, err);
    Q.upsertVote.run(juri, takim, tur === 'final' ? 'final' : 'on', JSON.stringify(scores), scores.reduce((a, b) => a + b, 0), str(note, 2000), Date.now());
  } else if (m === 'DELETE' && p === 'oy') {
    Q.deleteVote.run(url.searchParams.get('juri'), url.searchParams.get('takim'), url.searchParams.get('tur') === 'final' ? 'final' : 'on');
  } else if (m === 'PUT' && p === 'odalar') {
    setRooms((await readBody(req)).list);
  } else if (m === 'PUT' && p === 'oda-ata') {
    assignRooms(await readBody(req, 1e6));
  } else if (m === 'POST' && p === 'oda-dagit') {
    extra.dagitilan = distributeTeams(!!(await readBody(req)).hepsi);
  } else if (m === 'POST' && p === 'finalist-sec') {
    extra.secilen = pickFinalists((await readBody(req)).sayi);
  } else if (m === 'PUT' && p === 'finalistler') {
    setFinalists((await readBody(req)).list);
  } else if (m === 'POST' && p === 'sifirla') {
    if ((await readBody(req)).onay !== 'SIFIRLA') fail(400, 'Onay metni hatalı');
    db.exec('DELETE FROM oylar');
  } else if (m === 'DELETE' && p === 'oturum') {
    const kim = url.searchParams.get('kim');
    if (kim) Q.deleteSessionsOf.run(kim);
    else db.exec("DELETE FROM oturumlar WHERE kim <> '@admin'");
  } else if (m === 'POST' && p === 'arsiv') {
    const { adres, donem } = await readBody(req);
    extra.aktarilan = await importItchJam(adres, donem);
  } else if (m === 'PUT' && p === 'arsiv') {
    const { donem, id, rozet, gizli } = await readBody(req);
    if (!AQ.get.get(donem, id)) fail(404, 'Arşiv kaydı bulunamadı');
    AQ.update.run(str(rozet, 60), gizli ? 1 : 0, donem, id);
  } else if (m === 'DELETE' && p === 'arsiv') {
    removeDonem(url.searchParams.get('donem'));
  } else if (m === 'POST' && p === 'geri-yukle') {
    extra.atlanan = restore(await readBody(req, 50e6));
  } else fail(404, 'Bulunamadı');

  return json(res, 200, { ...adminState(), ...extra });
}

// ---- Takım paneli ----
async function teamRoutes(req, res, url) {
  const p = url.pathname.slice('/api/takim/'.length), m = req.method;

  // Aynı giriş formu: önce öğrenci hesabı, yoksa ortak takım hesabı
  if (m === 'POST' && p === 'giris') {
    const lim = loginLimited(req);
    const { kullanici, sifre } = await readBody(req);
    const id = normalizeUser(kullanici), ogr = OQ.get.get(id), row = !ogr && Q.team.get(id);
    if (!(ogr || row) || !(await checkPw(String(sifre || ''), (ogr || row).sifre))) { lim.bad(); fail(401, 'Kullanıcı adı veya şifre hatalı'); }
    lim.ok();
    return json(res, 200, ogr ? { token: newSession(`s:${ogr.id}`, TTL.ogrenci), id: ogr.id, ogrenci: true }
      : { token: newSession(`t:${row.id}`, TTL.takim), id: row.id });
  }
  if (m === 'POST' && p === 'cikis') { const t = tokenOf(req); if (t) Q.deleteSession.run(tokenHash(t)); return json(res, 200, { ok: true }); }
  const who = teamOf(req, url);

  const view = () => ({
    ...teamView(getTeam(who.id)), yonetici: who.admin, mentor: !!who.mentor,
    ogrenci: who.ogrenci ? { id: who.ogrenci.id, ad: who.ogrenci.ad, kaptan: !!OQ.get.get(who.ogrenci.id)?.kaptan } : null
  });
  // Ekibi yönetebilen: yönetim, takımın mentörü ya da kaptan
  const kaptan = () => who.admin || who.mentor || !!(who.ogrenci && OQ.get.get(who.ogrenci.id)?.kaptan);
  const ekipUyesi = id => { const o = getStudent(id); if (o.takim !== who.id) fail(404, 'Öğrenci bu takımda değil'); return o; };
  if (m === 'GET' && p === 'ben') return json(res, 200, view());
  let extra = {};
  if (m === 'PUT' && p === 'sayfa') {
    if (!who.admin && !CFG.teslimAcik) fail(403, 'Teslim süresi doldu; sayfa artık düzenlenemez');
    const row = getTeam(who.id);
    savePage(who.id, cleanPage(await readBody(req, 1e5), pageOf(row)));
  } else if (m === 'POST' && p === 'yukle') await upload(req, url, who);
  else if (m === 'DELETE' && p === 'dosya') removeFile(url, who);
  else if (m === 'PUT' && p === 'gorsel-sira') {
    if (!who.admin && !CFG.teslimAcik) fail(403, 'Teslim süresi doldu; sayfa artık düzenlenemez');
    const { sira } = await readBody(req);
    const page = pageOf(getTeam(who.id)), cur = page.gorseller || [];
    if (!Array.isArray(sira) || sira.length !== cur.length || !sira.every(g => cur.includes(g))) fail(400, 'Geçersiz sıralama');
    page.gorseller = sira;
    savePage(who.id, page);
  } else if (m === 'PUT' && p === 'sifre') {
    if (who.admin || who.mentor) fail(400, 'Takım şifresi yönetim ya da mentör panelinden sıfırlanır');
    const { eski, yeni } = await readBody(req);
    // Öğrenci kendi hesabının şifresini, ortak takım hesabı takımın şifresini değiştirir
    const hesap = who.ogrenci ? getStudent(who.ogrenci.id) : getTeam(who.id);
    if (!(await checkPw(String(eski || ''), hesap.sifre))) fail(400, 'Mevcut şifre hatalı');
    if (String(yeni || '').length < 6) fail(400, 'Yeni şifre en az 6 karakter olmalı');
    (who.ogrenci ? OQ.setPw : Q.setTeamPw).run(await hashPwAsync(yeni), hesap.id);
  } else if (m === 'POST' && p === 'ayril') {
    if (!who.ogrenci) fail(400, 'Yalnızca öğrenci hesabıyla takımdan ayrılınabilir');
    if (!CFG.teslimAcik) fail(403, 'Teslim süresi doldu; ekip artık değiştirilemez');
    leaveTeam(getStudent(who.ogrenci.id));
    return json(res, 200, { ok: true, takimsiz: true });
  } else if (m === 'POST' && p === 'uye-cikar') {
    if (!kaptan()) fail(403, 'Ekipten öğrenci çıkarmayı yalnızca kaptan, mentör ya da yönetim yapabilir');
    if (!who.admin && !who.mentor && !CFG.teslimAcik) fail(403, 'Teslim süresi doldu; ekip artık değiştirilemez');
    const o = ekipUyesi((await readBody(req)).id);
    if (o.id === who.ogrenci?.id) fail(400, 'Kendinizi çıkaramazsınız; "Takımdan ayrıl"ı kullanın');
    leaveTeam(o);
  } else if (m === 'POST' && p === 'kaptan') {
    if (!kaptan()) fail(403, 'Kaptanlığı yalnızca kaptan, mentör ya da yönetim devredebilir');
    const o = ekipUyesi((await readBody(req)).id);
    tx(() => { db.prepare('UPDATE ogrenciler SET kaptan = 0 WHERE takim = ?').run(who.id); OQ.setCaptain.run(1, o.id); });
  } else if (m === 'POST' && p === 'kod-yenile') {
    if (!kaptan()) fail(403, 'Katılım kodunu yalnızca kaptan, mentör ya da yönetim yenileyebilir');
    Q.setCode.run(newCode(), who.id);
  } else if (m === 'POST' && p === 'uye-sifre') {
    // Şifresini unutan öğrenci: mentör ya da yönetim yeni şifre üretir
    if (!who.admin && !who.mentor) fail(403, 'Öğrenci şifresini mentör ya da yönetim sıfırlar');
    const o = ekipUyesi((await readBody(req)).id), sifre = newPassword();
    OQ.setPw.run(await hashPwAsync(sifre), o.id);
    Q.deleteSessionsOf.run(`s:${o.id}`);
    extra.yeniSifre = { id: o.id, ad: o.ad, sifre };
  } else fail(404, 'Bulunamadı');

  return json(res, 200, { ...view(), ...extra });
}

// ---- Öğrenci hesabı: kayıt, takım kurma, katılım koduyla katılma ----
// Takımı olan öğrenci takım panelini /api/takim/* ile kullanır; buradaki uç noktalar takımsız öğrenci içindir.
async function studentRoutes(req, res, url) {
  const p = url.pathname.slice('/api/ogrenci/'.length), m = req.method;

  if (m === 'POST' && p === 'kayit') {
    if (!CFG.ogrenciKayit) fail(403, 'Öğrenci kaydı şu anda kapalı. Hesabınızı yönetimden isteyin.');
    postLimited('kayit:' + clientIp(req), 20, 'Çok fazla kayıt denemesi, biraz bekleyin');
    const o = await createStudent(await readBody(req));
    return json(res, 200, { token: newSession(`s:${o.id}`, TTL.ogrenci), id: o.id, ogrenci: true });
  }
  const k = sessionOf(req), ogr = k && k.startsWith('s:') && OQ.get.get(k.slice(2));
  if (!ogr) fail(401, 'Oturum geçersiz, tekrar giriş yapın');
  const state = () => {
    const o = OQ.get.get(ogr.id);
    return { ogrenci: { id: o.id, ad: o.ad }, takim: o.takim || null, ogrenciTakim: CFG.ogrenciTakim, teslimAcik: CFG.teslimAcik,
      max: MAX_OGRENCI, event: pubEvent(), tema: CFG.tema };
  };
  if (m === 'GET' && p === 'ben') return json(res, 200, state());
  if (m === 'POST' && (p === 'katil' || p === 'takim-kur')) {
    if (!CFG.teslimAcik) fail(403, 'Teslim süresi doldu; artık takım kurulamaz ya da takıma katılınamaz');
    postLimited('katil:' + ogr.id, 10, 'Çok fazla deneme, biraz bekleyin');
    const b = await readBody(req);
    if (p === 'katil') {
      const t = Q.teamByCode.get(normCode(b.kod));
      if (!t) fail(404, 'Bu koda ait takım bulunamadı. Kodu takım arkadaşınızdan ya da mentörünüzden kontrol edin.');
      joinTeam(ogr, t.id);
    } else {
      if (!CFG.ogrenciTakim) fail(403, 'Takımları yönetim ve mentörler açıyor; takımınızın katılım kodunu onlardan isteyin');
      if (ogr.takim) fail(400, 'Zaten bir takımdasınız');
      tx(() => { const t = createTeam({ ad: b.ad, il: b.il, okul: b.okul, danisman: b.danisman }); joinTeam(ogr, t.id); });
    }
    return json(res, 200, state());
  }
  fail(404, 'Bulunamadı');
}

// ---- Mentör paneli ----
function mentorOf(req) {
  const k = sessionOf(req);
  const row = k && k.startsWith('m:') && MQ.get.get(k.slice(2));
  if (!row) fail(401, 'Oturum geçersiz, tekrar giriş yapın');
  return row;
}
function mentorState(mentor) {
  const now = Date.now();
  const sessions = sessionCounts(now);
  const ids = new Set(mentorTeams(mentor.id));
  return {
    ben: { id: mentor.id, ad: mentor.ad, alan: mentor.alan },
    event: pubEvent(), tema: CFG.tema, teslimAcik: CFG.teslimAcik, mentorKayit: CFG.mentorKayit, simdi: Date.now(), maxOgrenci: MAX_OGRENCI,
    takimSayisi: Q.teams.all().length,
    takimlar: Q.teams.all().filter(r => ids.has(r.id)).map(row => {
      const p = pageOf(row);
      return {
        id: row.id, ad: row.ad, il: row.il, okul: row.okul, danisman: row.danisman, yayinda: !!row.yayinda,
        baslik: p.baslik || '', kisa: p.kisa || '', kapak: p.kapak || null, oyun: !!p.oyun, indir: !!p.indir, video: !!p.video,
        uyeler: p.uyeler || [], ilerleme: pageProgress(p), guncelleme: row.guncelleme, cevrimici: !!sessions[`t:${row.id}`],
        kod: row.kod, ogrenciler: studentsOf(row.id)
      };
    })
  };
}
async function mentorRoutes(req, res, url) {
  const p = url.pathname.slice('/api/mentor/'.length), m = req.method;

  if (m === 'POST' && p === 'giris') {
    const lim = loginLimited(req);
    const { kullanici, sifre } = await readBody(req);
    const row = MQ.get.get(normalizeUser(kullanici));
    if (!row || !(await checkPw(String(sifre || ''), row.sifre))) { lim.bad(); fail(401, 'Kullanıcı adı veya şifre hatalı'); }
    lim.ok();
    return json(res, 200, { token: newSession(`m:${row.id}`, TTL.mentor), id: row.id });
  }
  const mentor = mentorOf(req);

  if (m === 'POST' && p === 'cikis') { Q.deleteSession.run(tokenHash(tokenOf(req))); return json(res, 200, { ok: true }); }
  if (m === 'GET' && p === 'durum') return json(res, 200, mentorState(mentor));

  let extra = {};
  if (m === 'POST' && p === 'takim') {
    if (!CFG.mentorKayit) fail(403, 'Takımları yönetim ekliyor; mentörlerin takım eklemesi kapalı');
    if (mentorTeams(mentor.id).length >= 30) fail(400, 'Bir mentör en fazla 30 takım ekleyebilir');
    const b = await readBody(req);
    const t = tx(() => { const t = createTeam({ ad: b.ad, il: b.il, okul: b.okul, danisman: b.danisman || mentor.ad }); MQ.assign.run(mentor.id, t.id); return t; });
    extra.yeni = [t];
  } else if (m === 'POST' && p === 'takim-sifre') {
    const row = getTeam((await readBody(req)).id);
    if (!isAssigned(mentor.id, row.id)) fail(403, 'Bu takım size atanmamış');
    const sifre = newPassword();
    Q.setTeamPw.run(await hashPwAsync(sifre), row.id);
    Q.deleteSessionsOf.run(`t:${row.id}`);
    extra.yeni = [{ id: row.id, ad: row.ad, il: row.il, okul: row.okul, sifre, kod: row.kod }];
  } else if (m === 'PUT' && p === 'sifre') {
    const { eski, yeni } = await readBody(req);
    if (!(await checkPw(String(eski || ''), mentor.sifre))) fail(400, 'Mevcut şifre hatalı');
    if (String(yeni || '').length < 6) fail(400, 'Yeni şifre en az 6 karakter olmalı');
    MQ.setPw.run(await hashPwAsync(yeni), mentor.id);
  } else fail(404, 'Bulunamadı');
  return json(res, 200, { ...mentorState(MQ.get.get(mentor.id)), ...extra });
}

// ---- Jüri paneli ----
function juryState(user) {
  const tur = currentRound(), votes = loadVotes(tur)[user] || {}, ids = new Set(juryTeamIds(user));
  const oda = CFG.juries.find(j => j.id === user)?.oda;
  return {
    user, name: JURY_NAME()[user], criteria: CFG.criteria, maxTotals: maxTotals(), oylamaAcik: CFG.oylamaAcik,
    event: pubEvent(), tema: CFG.tema, geriBildirimAcik: CFG.geriBildirimAcik,
    geri: Object.fromEntries(db.prepare('SELECT takim, metin FROM geribildirimler WHERE juri = ?').all(user).filter(r => ids.has(r.takim)).map(r => [r.takim, r.metin])),
    odali: hasRooms(), asama: tur, oda: oda ? roomName(oda) : '',
    urunler: Q.teams.all().filter(r => ids.has(r.id)).map(cardOf),
    votes: Object.fromEntries(Object.entries(votes).filter(([id]) => ids.has(id)))
  };
}
async function juryRoutes(req, res, url) {
  const p = url.pathname.slice('/api/juri/'.length), m = req.method;

  if (m === 'POST' && p === 'giris') {
    const lim = loginLimited(req);
    const { kullanici, sifre } = await readBody(req);
    const u = normalizeUser(kullanici);
    if (!JURY_NAME()[u] || !(await juryPasswordOk(u, sifre || ''))) { lim.bad(); fail(401, 'Kullanıcı adı veya şifre hatalı'); }
    lim.ok();
    return json(res, 200, { token: newSession(`j:${u}`, TTL.juri), user: u });
  }
  const user = juryOf(req);
  if (!user) fail(401, 'Oturum geçersiz, tekrar giriş yapın');

  if (m === 'POST' && p === 'cikis') { Q.deleteSession.run(tokenHash(tokenOf(req))); return json(res, 200, { ok: true }); }
  if (m === 'GET' && p === 'durum') return json(res, 200, juryState(user));
  if (m === 'PUT' && p === 'oy') {
    if (!CFG.oylamaAcik) fail(403, 'Oylama şu anda kapalı');
    const { takim, scores, note, geri } = await readBody(req);
    const row = getTeam(takim);
    if (!row.yayinda) fail(400, 'Bu ürün değerlendirmeye açık değil');
    if (typeof geri === 'string') {
      const metin = str(geri, 2000);
      if (metin) db.prepare(`INSERT INTO geribildirimler (juri, takim, metin, zaman) VALUES (?, ?, ?, ?)
        ON CONFLICT (juri, takim) DO UPDATE SET metin = excluded.metin, zaman = excluded.zaman`).run(user, row.id, metin, Date.now());
      else db.prepare('DELETE FROM geribildirimler WHERE juri = ? AND takim = ?').run(user, row.id);
    }
    if (!juryTeamIds(user).includes(row.id)) fail(403, hasRooms() ? 'Bu takım sizin odanızda değil' : 'Bu ürün değerlendirmeye açık değil');
    const err = scoreError(scores); if (err) fail(400, err);
    Q.upsertVote.run(user, takim, currentRound(), JSON.stringify(scores), scores.reduce((a, b) => a + b, 0), str(note, 2000), Date.now());
  } else if (m === 'DELETE' && p === 'oy') {
    if (!CFG.oylamaAcik) fail(403, 'Oylama şu anda kapalı');
    const { changes } = Q.deleteVote.run(user, url.searchParams.get('takim'), currentRound());
    if (!changes) fail(404, 'Bu ürün için kayıtlı puanınız yok');
  } else fail(404, 'Bulunamadı');
  return json(res, 200, juryState(user));
}

// ---- Dosya sunma ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pck': 'application/octet-stream', '.data': 'application/octet-stream'
};
// Oyunlar öğrencilerin yazdığı, denetlenmemiş koddur. Ana sitede sunulurken CSP "sandbox" ile
// ayrı (opak) bir kökene konur: sitenin oturum bilgilerine, çerezlere ve localStorage'a erişemez.
// Opak kökenden yapılan dosya istekleri (Unity/Godot fetch) için CORS izni verilir.
const GAME_SANDBOX = 'sandbox allow-scripts allow-pointer-lock allow-popups allow-forms allow-modals allow-downloads allow-orientation-lock allow-presentation';
function serveGame(req, res, url, onGameHost) {
  const rest = url.pathname.slice('/oyunlar/'.length).split('/');
  const id = rest.shift();
  let rel;
  try { rel = rest.map(decodeURIComponent).join('/'); } catch { res.writeHead(400); return res.end(); }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const root = path.join(teamDir(normalizeUser(id)), 'oyun');
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  const row = Q.team.get(normalizeUser(id));
  // Yayında olmayan ürünün oyunu yalnızca bağlantıyı bilen (takım, jüri, yönetici) tarafından açılır; liste vermez
  if (!row) { res.writeHead(404); return res.end('Bulunamadı'); }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Bulunamadı'); }
    // Unity sıkıştırılmış derlemeleri: Build.wasm.gz / .br -> tarayıcı açsın diye Content-Encoding
    let name = full.toLowerCase(), enc = null;
    if (name.endsWith('.gz')) { enc = 'gzip'; name = name.slice(0, -3); }
    else if (name.endsWith('.br')) { enc = 'br'; name = name.slice(0, -3); }
    const headers = {
      'Content-Type': MIME[path.extname(name)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    };
    if (enc) headers['Content-Encoding'] = enc;
    if (!onGameHost) headers['Content-Security-Policy'] = GAME_SANDBOX;
    res.writeHead(200, headers);
    fs.createReadStream(full).pipe(res);
  });
}

// Kapak, ekran görüntüleri ve indirme dosyası: /dosya/<takım>/<ad>
function serveTeamFile(req, res, url) {
  const [id, a, b] = url.pathname.slice('/dosya/'.length).split('/').map(s => { try { return decodeURIComponent(s); } catch { return ''; } });
  const row = Q.team.get(normalizeUser(id));
  if (!row) { res.writeHead(404); return res.end('Bulunamadı'); }
  const page = pageOf(row), dir = teamDir(row.id);
  let full, headers = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
  if (a === 'indir' && page.indir && b === page.indir.ad) {
    full = path.join(dir, 'indir', page.indir.ad);
    headers['Content-Type'] = 'application/octet-stream';
    headers['Content-Disposition'] = `attachment; filename="${page.indir.ad}"`;
  } else if (!b && (a === page.kapak || (page.gorseller || []).includes(a))) {
    full = path.join(dir, a);
    headers['Content-Type'] = MIME[path.extname(a)] || 'application/octet-stream';
    headers['Cache-Control'] = 'public, max-age=86400, immutable';
  } else { res.writeHead(404); return res.end('Bulunamadı'); }
  fs.stat(full, (err, st) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(full).pipe(res);
  });
}

// public/ dosyaları bellekte tutulur (değişirse yeniden okunur). Tarayıcı ETag ile doğrular, değişmediyse 304 alır.
const publicCache = new Map();
const SIKISTIR = /\.(html|css|js|svg|json|txt)$/;
function servePublic(req, res, full) {
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Bulunamadı'); }
    let c = publicCache.get(full);
    if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
      let buf;
      try { buf = fs.readFileSync(full); } catch { res.writeHead(404); return res.end(); }
      c = { mtime: st.mtimeMs, size: st.size, buf, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"',
        gz: SIKISTIR.test(full) && buf.length > 1024 ? zlib.gzipSync(buf, { level: 9 }) : null };
      publicCache.set(full, c);
    }
    const h = { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
      ETag: c.etag, 'Cache-Control': /\.(png|woff2)$/.test(full) ? 'public, max-age=86400' : 'no-cache', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, h); return res.end(); }
    if (c.gz && gzipOk(req)) { res.writeHead(200, { ...h, 'Content-Encoding': 'gzip', 'Content-Length': c.gz.length }); return res.end(c.gz); }
    res.writeHead(200, { ...h, 'Content-Length': c.buf.length });
    res.end(c.buf);
  });
}

const PAGES = { '/': '/vitrin.html', '/takim': '/takim.html', '/juri': '/juri.html', '/yonetim': '/yonetim.html', '/mentor': '/mentor.html', '/belge': '/belge.html' };

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end('Geçersiz adres'); }
  const onGameHost = OYUN_HOST && req.headers.host === OYUN_HOST;

  try {
    // Ayrı oyun alan adından yalnızca oyun dosyaları sunulur
    if (onGameHost) {
      if (req.method === 'GET' && url.pathname.startsWith('/oyunlar/')) return serveGame(req, res, url, true);
      res.writeHead(404); return res.end('Bulunamadı');
    }
    if (url.pathname.startsWith('/api/admin/')) return await adminRoutes(req, res, url);
    if (url.pathname.startsWith('/api/takim/')) return await teamRoutes(req, res, url);
    if (url.pathname.startsWith('/api/juri/')) return await juryRoutes(req, res, url);
    if (url.pathname.startsWith('/api/mentor/')) return await mentorRoutes(req, res, url);
    if (url.pathname.startsWith('/api/ogrenci/')) return await studentRoutes(req, res, url);
    if (url.pathname === '/api/mesaj' || url.pathname.startsWith('/api/mesaj/')) return await messageRoutes(req, res, url);
    if (req.method === 'GET' && url.pathname.startsWith('/ek/')) return serveAttachment(req, res, url);

    if (req.method === 'GET' && url.pathname === '/api/durum') return json(res, 200, { event: pubEvent(), tema: CFG.tema, simdi: Date.now(), ogrenciKayit: CFG.ogrenciKayit });

    if (req.method === 'GET' && url.pathname === '/api/vitrin') {
      const rows = Q.teams.all().filter(isPublic);
      return json(res, 200, {
        event: pubEvent(), tema: CFG.tema, teslimAcik: CFG.teslimAcik, sonuclarAcik: CFG.sonuclarAcik, simdi: Date.now(),
        kriterler: CFG.criteria.map(c => ({ name: c.name, max: c.max, ek: c.ek })),
        takimSayisi: Q.teams.all().length, urunler: rows.map(cardOf),
        arsiv: AQ.donemler.all().map(d => ({ donem: d.donem, sayi: d.sayi - (d.gizli || 0) })).filter(d => d.sayi)
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/arsiv') {
      const donem = url.searchParams.get('donem');
      return json(res, 200, { urunler: AQ.list.all().filter(r => r.donem === donem && !r.gizli).map(arsivKart) });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/arsiv-kapak/')) {
      const name = decodeURIComponent(url.pathname.slice('/arsiv-kapak/'.length));
      if (!/^[a-z0-9]+-\d+\.(png|jpg|gif|webp)$/.test(name)) { res.writeHead(404); return res.end(); }
      return fs.stat(path.join(ARSIV_DIR, name), (err, st) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(name)], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        fs.createReadStream(path.join(ARSIV_DIR, name)).pipe(res);
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/urun/')) {
      const row = Q.team.get(normalizeUser(url.pathname.slice('/api/urun/'.length)));
      // Yayında olmayan ürünü yalnızca kendi takımı, jüri ve yönetici görür (önizleme)
      const k = sessionOf(req);
      const allowed = row && (isPublic(row) || k === '@admin' || k === `t:${row.id}` || (k && k.startsWith('s:') && OQ.get.get(k.slice(2))?.takim === row.id) || (k && k.startsWith('j:') && row.yayinda) ||
        (k && k.startsWith('m:') && isAssigned(k.slice(2), row.id)));
      if (!allowed) return json(res, 404, { error: 'Ürün bulunamadı' });
      return json(res, 200, { urun: productOf(row), event: pubEvent(), tema: CFG.tema });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/oyunlar/')) return serveGame(req, res, url, false);
    if (req.method === 'GET' && url.pathname.startsWith('/dosya/')) return serveTeamFile(req, res, url);

    if (req.method === 'GET') {
      // /oyun/<id> ürün sayfası (sayfa içinde <base href="../"> var)
      const file = /^\/oyun\/[a-z0-9]+$/.test(url.pathname) ? '/urun.html' : PAGES[url.pathname] || decodeURIComponent(url.pathname);
      const full = path.normalize(path.join(PUBLIC_DIR, file));
      if (!full.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'Yasak' });
      return servePublic(req, res, full);
    }

    json(res, 404, { error: 'Bulunamadı' });
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e.http) return json(res, e.http, { error: e.message, ...e.extra });
    console.error(e);
    json(res, 500, { error: 'Sunucu hatası' });
  }
});
server.requestTimeout = 30 * 60 * 1000; // büyük dosya yüklemeleri yavaş bağlantıda uzun sürebilir

if (!adminConfigured()) console.warn('Uyarı: ADMIN_SIFRE tanımlı değil; yönetim paneline giriş kapalı. .env dosyasına ekleyin.');

server.listen(PORT, HOST, () => {
  console.log(`\nEğitiJAM platformu çalışıyor:`);
  console.log(`  Vitrin (herkese açık): http://localhost:${PORT}/`);
  console.log(`  Takım paneli         : http://localhost:${PORT}/takim`);
  console.log(`  Mentör paneli        : http://localhost:${PORT}/mentor`);
  console.log(`  Jüri paneli          : http://localhost:${PORT}/juri`);
  console.log(`  Yönetim paneli       : http://localhost:${PORT}/yonetim`);
  if (HOST === '0.0.0.0') {
    try {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Ağdaki cihazlar      : http://${n.address}:${PORT}/`);
      }
    } catch (_) { /* ağ arayüzleri okunamadı */ }
  }
  console.log('');
});
