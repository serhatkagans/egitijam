// EğitiJAM sayfalarının ortak yardımcıları
const EJ = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ik = (ad, cls = '') => `<svg class="ik ${cls}" aria-hidden="true"><use href="ikonlar.svg#${ad}"/></svg>`;

  // Oturum jetonları: her rol ayrı anahtarda
  const JETON = { takim: 'ejTakim', juri: 'ejJuri', yonetim: 'ejYonetim', mentor: 'ejMentor' };
  const jeton = rol => { try { return localStorage.getItem(JETON[rol]); } catch { return null; } };
  const jetonYaz = (rol, t) => { try { t ? localStorage.setItem(JETON[rol], t) : localStorage.removeItem(JETON[rol]); } catch {} };

  async function api(yontem, yol, govde, rol) {
    const h = {};
    const t = rol && jeton(rol);
    if (t) h.Authorization = 'Bearer ' + t;
    if (govde !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(yol, { method: yontem, headers: h, body: govde === undefined ? undefined : JSON.stringify(govde) });
    let d = {};
    try { d = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error(d.error || `İstek başarısız (${r.status})`), { status: r.status });
    return d;
  }

  // Dosya yükleme: ilerleme yüzdesi için XHR
  function yukle(yol, dosya, rol, ilerle) {
    return new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open('POST', yol);
      const t = jeton(rol);
      if (t) x.setRequestHeader('Authorization', 'Bearer ' + t);
      x.upload.onprogress = e => e.lengthComputable && ilerle && ilerle(e.loaded / e.total);
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch {}
        x.status < 300 ? ok(d) : no(Object.assign(new Error(d.error || `Yükleme başarısız (${x.status})`), { status: x.status }));
      };
      x.onerror = () => no(new Error('Bağlantı kesildi, yükleme tamamlanamadı'));
      x.send(dosya);
    });
  }

  const boyut = b => b >= 1048576 ? (b / 1048576).toFixed(b >= 1048576 * 100 ? 0 : 1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const zaman = t => t ? new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  const dosya = (id, ad) => `dosya/${encodeURIComponent(id)}/${encodeURIComponent(ad)}`;
  const sayi = n => String(Math.round(n * 10) / 10).replace('.', ',');

  // Düz metni paragraflara böler, bağlantıları tıklanabilir yapar (HTML kabul edilmez)
  function metin(s) {
    return String(s || '').split(/\n{2,}/).map(p => '<p>' + esc(p).replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>') + '</p>').join('');
  }

  function ytId(u) {
    const m = String(u || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  let bt;
  function bildir(msj, tur = '') {
    let el = document.getElementById('bildirim');
    if (!el) { el = document.createElement('div'); el.id = 'bildirim'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msj;
    el.className = 'acik ' + tur;
    clearTimeout(bt);
    bt = setTimeout(() => el.className = tur, tur === 'h' ? 5000 : 2600);
  }

  // Ürün kartı (vitrin ve jüri)
  function kart(u, href, ekRozet = '') {
    const kapak = u.kapak ? `<img src="${dosya(u.id, u.kapak)}" alt="" loading="lazy">` : `<div class="yok">${ik('gamepad-2')}</div>`;
    const rozet = u.rozet ? `<span class="etiket rozet">${ik('trophy')} ${esc(u.rozet)}</span>` : '';
    const yer = [u.il, u.okul].filter(Boolean).join(' · ');
    return `<a class="urun kart" href="${href}">
      <div class="kapak">${kapak}<div class="rozetler">${rozet}${ekRozet}</div></div>
      <div class="govde">
        <h3>${esc(u.baslik || 'İsimsiz ürün')}</h3>
        <div class="tk">${esc(u.takim)}</div>
        ${u.kisa ? `<p class="ks">${esc(u.kisa)}</p>` : ''}
        <div class="alt">
          ${u.oyun ? `<span class="etiket k">${ik('play')} Tarayıcıda oyna</span>` : ''}
          ${u.indir ? `<span class="etiket">${ik('download')} İndir</span>` : ''}
          ${yer ? `<span title="${esc(yer)}">${ik('map-pin')} ${esc(u.il || u.okul)}</span>` : ''}
        </div>
      </div></a>`;
  }

  // Geri sayım: e.baslangic / e.bitis (ms). simdi: sunucu saati; ziyaretçinin saati yanlışsa fark düzeltilir.
  // Başlamadan önce başlangıca, sürerken bitişe sayar; bitince öğe gizlenir. kisa: tek satırlık gösterim.
  function geriSayim(el, e, simdi, { kisa = false, once = 'Başlamasına kalan', sure = 'Teslime kalan' } = {}) {
    const fark = simdi ? simdi - Date.now() : 0, iki = n => String(n).padStart(2, '0');
    let z = null, bitti = false;
    function ciz() {
      const t = Date.now() + fark;
      let hedef, etiket;
      if (e.baslangic && t < e.baslangic) { hedef = e.baslangic; etiket = once; }
      else if (e.bitis && t < e.bitis) { hedef = e.bitis; etiket = sure; }
      else { el.classList.add('hidden'); bitti = true; clearInterval(z); return; }
      el.classList.remove('hidden');
      let k = Math.floor((hedef - t) / 1000);
      const g = Math.floor(k / 86400); k %= 86400;
      const s = Math.floor(k / 3600); k %= 3600;
      const d = Math.floor(k / 60), sn = k % 60;
      const tarih = new Date(hedef).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', weekday: 'long', hour: '2-digit', minute: '2-digit' });
      el.innerHTML = kisa
        ? `${ik('calendar-days')} ${etiket}: <b>${g ? g + ' gün ' : ''}${iki(s)}:${iki(d)}:${iki(sn)}</b> <small>(${tarih})</small>`
        : `<small class="gs-et">${etiket}</small>
           <div class="gs-kutu">${[[g, 'gün'], [s, 'saat'], [d, 'dakika'], [sn, 'saniye']].map(([n, a], i) => `<div><b>${i ? iki(n) : n}</b><span>${a}</span></div>`).join('')}</div>
           <small class="gs-tarih">${tarih}</small>`;
    }
    ciz();
    if (!bitti) z = setInterval(ciz, 1000);
    return () => clearInterval(z);
  }

  // Herkese açık sayfalarda (vitrin, oyun sayfası) giriş yapmış kişinin menüsü. Giriş yapılınca üst menü her sayfada
  // aynı kalır: buradaki bağlantılar kişinin kendi panelindeki menüyle birebir aynıdır (takim.html, mentor.html, juri.html).
  // Oturum sunucuda geçersizse jeton silinir ve sayfanın kendi (girişsiz) menüsü geri gelir.
  const PANEL = {
    takim: { api: 'takim', baglantilar: id => [['./', 'Vitrin'], ['takim', 'Oyun sayfası'], ['takim#mesajlar', 'Mesajlar', true], [`oyun/${encodeURIComponent(id)}`, 'Sayfamı görüntüle', false, true], ['takim#sifre', 'Şifre değiştir']] },
    mentor: { api: 'mentor', baglantilar: () => [['./', 'Vitrin'], ['mentor#takimlar', 'Takımlarım'], ['mentor#mesajlar', 'Mesajlar', true], ['mentor#sifre', 'Şifre değiştir']] },
    juri: { api: 'juri', baglantilar: () => [['./', 'Vitrin'], ['juri', 'Puanlama'], ['juri#mesajlar', 'Mesajlar', true]] },
    yonetim: { api: 'admin', baglantilar: () => [['./', 'Vitrin'], ['yonetim', 'Yönetim paneli'], ['yonetim#mesajlar', 'Mesajlar', true]] }
  };
  async function oturumMenu(nav, { vitrin = false } = {}) {
    const giris = [...nav.children];
    const roller = Object.keys(PANEL).filter(r => jeton(r));
    if (!roller.length) return;
    giris.forEach(a => a.classList.add('hidden')); // girişsiz menü kısa süre de olsa görünmesin
    for (const rol of roller) {
      let d;
      try { d = await api('GET', 'api/mesaj', undefined, rol); }
      catch (e) { if (e.status === 401) jetonYaz(rol, null); continue; }
      const okunmamis = d.kanallar.reduce((a, k) => a + k.okunmamis, 0);
      const id = d.ben.kim.replace(/^[a-z]:/, '');
      const html = PANEL[rol].baglantilar(id).map(([href, ad, sayac, yeniSekme]) =>
        `<a href="${href}" data-oturum${yeniSekme ? ' target="_blank"' : ''}${vitrin && href === './' ? ' class="secili"' : ''}>${esc(ad)}${sayac && okunmamis ? `<span class="sayac-rozet">${okunmamis > 99 ? '99+' : okunmamis}</span>` : ''}</a>`).join('')
        + `<a href="#" data-oturum data-cikis title="${esc(d.ben.ad)} oturumunu kapat">Çıkış</a>`
        + `<span class="oturum-ad" data-oturum title="Giriş yapılan hesap">${ik(rol === 'takim' ? 'users' : rol === 'mentor' ? 'graduation-cap' : rol === 'juri' ? 'vote' : 'shield-check')}${d.ben.uye ? esc(d.ben.uye) + ' · ' : ''}${esc(d.ben.ad)}</span>`;
      giris.forEach(a => a.remove());
      nav.insertAdjacentHTML('beforeend', html);
      // Yönetim paneli Mesajlar sekmesini sessionStorage'dan açar
      if (rol === 'yonetim') nav.querySelector('a[href="yonetim#mesajlar"]').onclick = () => { try { sessionStorage.setItem('ejSekme', 'mesajlar'); } catch {} };
      nav.querySelector('[data-cikis]').onclick = async e => {
        e.preventDefault();
        try { await api('POST', `api/${PANEL[rol].api}/cikis`, {}, rol); } catch {}
        jetonYaz(rol, null); location.reload();
      };
      return;
    }
    giris.forEach(a => a.classList.remove('hidden'));
  }

  // Üst menüdeki marka: "EğitiJAM 2026" -> "Eğiti" + kırmızı "JAM 2026" (vitrinle aynı). Yanındaki küçük etiket (Mentör, Jüri) korunur.
  function marka(ad) {
    const el = document.querySelector('.ust .ej'), m = String(ad || '').match(/^(.*?)(JAM.*)$/i);
    if (!el || !m) return;
    const etiket = el.querySelector('small');
    el.innerHTML = `${esc(m[1])}<span>${esc(m[2])}</span>` + (etiket ? ' ' + etiket.outerHTML : '');
  }

  return { esc, ik, api, yukle, jeton, jetonYaz, boyut, zaman, dosya, sayi, metin, ytId, bildir, kart, geriSayim, oturumMenu, marka };
})();
