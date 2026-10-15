// Her rol için birer deneme hesabı açar (sunucu açıkken): test-hesaplari.bat
//   Takım:  denemetakim   (Deneme Takımı)
//   Mentör: denementor    (Deneme Mentör, Deneme Takımı'na atanır)
//   Jüri:   denemejuri    (Deneme Jüri, kendine özel şifreyle)
// Yönetici için .env'deki ADMIN_SIFRE kullanılır. Hesaplar zaten varsa şifreleri yenilenir.
// Giriş bilgileri proje klasöründeki test-hesaplari.txt dosyasına yazılır (git'e girmez).
// Kaldırmak için: Yönetim > Takımlar / Mentörler / Jüriler'den silin.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3100;
const B = `http://localhost:${PORT}/`;
const DOSYA = path.join(__dirname, '..', 'test-hesaplari.txt');
let TOKEN;

async function api(yontem, yol, govde) {
  const h = { Authorization: 'Bearer ' + TOKEN };
  if (govde !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(B + yol, { method: yontem, headers: h, body: govde === undefined ? undefined : JSON.stringify(govde) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${yol}: ${d.error || r.status}`);
  return d;
}
const sifreUret = () => Array.from(crypto.randomBytes(8), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

(async () => {
  if (!process.env.ADMIN_SIFRE) throw new Error('.env dosyasında ADMIN_SIFRE yok. Önce baslat.bat ile kurulumu yapın.');
  try {
    const r = await fetch(B + 'api/admin/giris', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sifre: process.env.ADMIN_SIFRE }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    TOKEN = d.token;
  } catch (e) {
    if (e.cause || /fetch failed/.test(e.message)) throw new Error(`Sunucuya bağlanılamadı (${B}). Önce baslat.bat ile sunucuyu açın.`);
    throw new Error(`Yönetici girişi başarısız: ${e.message}. Şifre panelden değiştirildiyse .env'deki ADMIN_SIFRE artık geçerli değildir.`);
  }
  let d = await api('GET', 'api/admin/durum');

  // Takım
  let takim;
  if (d.teams.some(t => t.id === 'denemetakim')) takim = (await api('POST', 'api/admin/takim-sifre', { id: 'denemetakim' })).yeni[0];
  else takim = (await api('POST', 'api/admin/takim', { ad: 'Deneme Takımı', il: 'Ankara', okul: 'Deneme Ortaokulu', danisman: 'Deneme Öğretmen', kullanici: 'denemetakim' })).yeni[0];

  // Mentör (deneme takımına atanır)
  let mentor;
  d = await api('GET', 'api/admin/durum');
  const varM = d.mentors.find(m => m.id === 'denementor');
  if (varM) {
    mentor = (await api('POST', 'api/admin/mentor-sifre', { id: 'denementor' })).yeni[0];
    if (!varM.takimlar.includes(takim.id)) await api('PUT', 'api/admin/mentor', { id: varM.id, ad: varM.ad, alan: varM.alan, takimlar: [...varM.takimlar, takim.id] });
  } else {
    mentor = (await api('POST', 'api/admin/mentor', { ad: 'Deneme Mentör', alan: 'Programlama', kullanici: 'denementor', takimlar: [takim.id] })).yeni[0];
  }

  // Jüri: mevcut jüri listesi korunur, deneme jürisi eklenir; kendine özel şifre verilir
  d = await api('GET', 'api/admin/durum');
  if (!d.juries.some(j => j.id === 'denemejuri')) {
    await api('PUT', 'api/admin/juriler', { list: [...d.juries.map(j => ({ name: j.name, id: j.id, eski: j.id })), { name: 'Deneme Jüri', id: 'denemejuri' }] });
  }
  const juriSifre = sifreUret();
  await api('PUT', 'api/admin/sifre', { tur: 'juri', juri: 'denemejuri', sifre: juriSifre });
  d = await api('GET', 'api/admin/durum');

  const satir = (rol, adres, kul, sifre, not) => `${rol}\n  Adres:         ${B}${adres}\n  Kullanıcı adı: ${kul}\n  Şifre:         ${sifre}\n${not ? '  Not:           ' + not + '\n' : ''}`;
  const metin = [
    `EğitiJAM deneme hesapları (${new Date().toLocaleString('tr-TR')})`,
    'Bu dosyayı paylaşmayın. Hesapları Yönetim panelinden silebilirsiniz.\n',
    satir('YÖNETİCİ', 'yonetim', '(kullanıcı adı yok)', '.env dosyasındaki ADMIN_SIFRE'),
    satir('TAKIM · Deneme Takımı', 'takim', takim.id, takim.sifre, 'Oyun sayfasını doldurun, "Mesajlar"dan mentöre yazın.'),
    satir('MENTÖR · Deneme Mentör', 'mentor', mentor.id, mentor.sifre, 'Deneme Takımı size atandı; takımın sayfasını düzenleyebilir, mesajlarına yanıt verebilirsiniz.'),
    satir('JÜRİ · Deneme Jüri', 'juri', 'denemejuri', juriSifre,
      (d.oylamaAcik ? 'Oylama açık.' : 'Oylama şu an kapalı: puan vermek için Yönetim > Genel bakış > "Oylama açık".')
      + ' Jüri, vitrinden kaldırılmamış tüm takımları görür; oyun adı girilmemiş olanlar "İsimsiz ürün" olarak listelenir.'
      + (d.odalar.length ? ' Jüri odaları var: Yönetim > Jüri odaları\'ndan bu jüriyi bir odaya atayın.' : ''))
  ].join('\n');
  fs.writeFileSync(DOSYA, '﻿' + metin.replace(/\n/g, '\r\n'));
  console.log('Deneme hesapları hazır: denemetakim (takım), denementor (mentör), denemejuri (jüri).');
  console.log('Giriş bilgileri: ' + DOSYA);
})().catch(e => { console.error('\nHata: ' + e.message); process.exitCode = 1; });
