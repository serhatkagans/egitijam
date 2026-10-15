// Platform içi mesajlaşma (Discord yerine): Duyurular, Genel sohbet, Mentör odası ve her takımın kendi kanalı.
// Takım, mentör ve yönetim panelleri aynı bileşeni kullanır:
//   const s = EJSohbet({ kok: element, rol: 'takim' | 'mentor' | 'juri' | 'yonetim', degisti: (okunmamis, yardim) => … });
//   s.goster(true)  // görünür olduğunda kanal açılır ve okundu sayılır
//   s.ac('t:takimid')
// odaklan (isteğe bağlı): masaüstü bildirimine tıklanınca panelin mesaj görünümünü açar.
// Yeni mesajlar birkaç saniyede bir sorgulanır; sayfa arka plandayken seyrekleşir.
// Discord'daki gibi: yanıtla, emoji tepkisi, düzenleme, biçimlendirme (**kalın** *italik* `kod` …),
// @bahsetme, dosya/görsel eki ve çevrimiçi üye listesi.
function EJSohbet({ kok, rol, degisti, odaklan }) {
  const { esc, ik, api, bildir, boyut } = EJ;
  // Sunucudaki EMOJILER ile aynı liste
  const EMOJILER = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏', '👏', '🔥', '✅', '👀', '💯', '🤔', '😍', '😎', '🥳', '🚀', '⭐', '💡', '🎮',
    '🏆', '👋', '🙌', '😅', '🤝', '⚡', '🐛', '👎', '❌', '😡'];
  const HIZLI = ['👍', '❤️', '😂'];
  const MAX_EK = 10;
  let kanallar = [], ben = null, secili = null, mesajlar = [], sonId = 0, surum = 0, dahaVar = false;
  let gorunur = false, zamanlayici = null, istekte = false, filtre = '', kapali = false, sorgu = 0;
  let uyeler = [], uyeKanal = null, yanitlanan = null, duzenlenen = null, ekler = [], alttaMi = true;
  let uyePanel = true, bildirimAcik = true, oncekiDurum = null;
  try { bildirimAcik = localStorage.getItem('ejBildirim') !== '0'; } catch {}
  try { uyePanel = localStorage.getItem('ejUyePanel') !== '0' && innerWidth > 1100; } catch {}
  const anahtar = 'ejKanal-' + rol;

  kok.classList.add('sohbet');
  kok.innerHTML = `
    <aside class="s-kanallar">
      <div class="s-ara"><input type="search" placeholder="Kanal ara" aria-label="Kanal ara"></div>
      <nav class="s-liste" aria-label="Kanallar"></nav>
    </aside>
    <section class="s-akis">
      <header class="s-bas"></header>
      <div class="s-mesajlar" aria-live="polite"></div>
      <button type="button" class="s-yeni hidden">${ik('arrow-down')} Yeni mesajlar</button>
      <form class="s-yaz">
        <div class="s-yanit-cubuk hidden"></div>
        <div class="s-ek-on hidden"></div>
        <div class="s-oneri hidden" role="listbox"></div>
        <div class="s-yaz-kutu">
          <button type="button" class="ikbtn s-ek-ekle" title="Dosya ya da görsel ekle">${ik('paperclip')}</button>
          <textarea rows="1" maxlength="2000" placeholder="Mesaj yazın…" aria-label="Mesaj"></textarea>
          <button type="button" class="ikbtn s-emoji-ac" title="Emoji">${ik('smile-plus')}</button>
        </div>
        <div class="s-yaz-alt">
          <label class="s-yazan hidden">${ik('user-check')} Yazan: <select aria-label="Mesajı yazan öğrenci"></select></label>
          <label class="s-yardim hidden"><input type="checkbox"> ${ik('life-buoy')} Yardım istiyorum <small>(mentörlere bildirilir)</small></label>
          <span class="s-ipucu">**kalın** *italik* \`kod\` · @ ile bahset · Enter: gönder · Shift+Enter: yeni satır</span>
          <button class="btn sm" type="submit">${ik('send')} Gönder</button>
        </div>
      </form>
      <div class="s-salt hidden"></div>
      <div class="s-surukle hidden">${ik('upload')}<b>Dosyaları bırakın</b></div>
    </section>
    <aside class="s-uyeler" aria-label="Üyeler"></aside>
    <div class="s-emoji hidden" role="dialog" aria-label="Emoji seç">${EMOJILER.map(e => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
    <input type="file" class="s-dosya" multiple hidden>`;
  const $ = s => kok.querySelector(s);
  const liste = $('.s-liste'), akis = $('.s-mesajlar'), form = $('.s-yaz'), metinAlan = form.querySelector('textarea');
  const oneri = $('.s-oneri'), emojiKutu = $('.s-emoji'), uyeKutu = $('.s-uyeler');
  kok.classList.toggle('uyeli', uyePanel);

  // ---- Kanal listesi ----
  function kanalIk(k) {
    if (k.kanal === 'duyuru') return 'megaphone';
    if (k.kanal === 'genel') return 'hash';
    if (k.kanal === 'mentor') return 'graduation-cap';
    if (k.kanal === 'juri') return 'vote';
    if (k.kanal.startsWith('oda:')) return 'door-open';
    return rol === 'takim' ? 'message-square' : 'hash';
  }
  function kanalSatir(k) {
    const alt = k.takim && rol !== 'takim' ? [k.il, k.okul].filter(Boolean).join(' · ') : '';
    const rozet = k.bahsetme ? `<span class="s-rozet b" title="Sizden bahsedildi">@${k.bahsetme > 99 ? '99+' : k.bahsetme}</span>`
      : k.okunmamis ? `<span class="s-rozet">${k.okunmamis > 99 ? '99+' : k.okunmamis}</span>` : '';
    return `<button type="button" class="s-kanal ${k.kanal === secili ? 'secili' : ''} ${k.okunmamis ? 'yeni' : ''}" data-kanal="${esc(k.kanal)}" title="${esc(alt || k.ad)}">
      ${ik(kanalIk(k))}<span class="ad">${esc(k.ad)}</span>
      ${k.yardim && rol !== 'takim' ? `<span class="s-rozet y" title="Yardım bekliyor">${ik('life-buoy')}</span>` : ''}${rozet}</button>`;
  }
  function listeCiz() {
    const q = filtre.toLocaleLowerCase('tr');
    const uy = k => !q || [k.ad, k.il, k.okul, k.takim].join(' ').toLocaleLowerCase('tr').includes(q);
    const sirala = l => l.sort((a, b) => (b.son - a.son) || a.ad.localeCompare(b.ad, 'tr'));
    const genel = kanallar.filter(k => !k.takim), takim = kanallar.filter(k => k.takim && uy(k));
    const grup = (bas, l, bosMetin) => l.length || bosMetin ? `<div class="s-grup">${esc(bas)}</div>${l.length ? l.map(kanalSatir).join('') : `<div class="s-bos">${bosMetin}</div>`}` : '';
    let h = grup('Genel', genel);
    if (rol === 'juri') { /* jüri yalnızca genel kanalları görür */ }
    else if (rol === 'takim') h += grup('Takımımız', takim);
    else {
      const yardim = takim.filter(k => k.yardim);
      h += grup('Yardım bekleyenler', sirala(yardim));
      if (rol === 'mentor') {
        h += grup('Takımlarım', sirala(takim.filter(k => k.benim && !k.yardim)), q ? '' : 'Size atanmış takım yok');
        h += grup('Diğer takımlar', sirala(takim.filter(k => !k.benim && !k.yardim)));
      } else h += grup('Takımlar', sirala(takim.filter(k => !k.yardim)), q ? 'Eşleşen takım yok' : 'Henüz takım yok');
    }
    liste.innerHTML = h;
    $('.s-ara').classList.toggle('hidden', kanallar.length < 8);
  }
  liste.onclick = e => { const b = e.target.closest('[data-kanal]'); if (b) ac(b.dataset.kanal); };
  $('.s-ara input').oninput = e => { filtre = e.target.value.trim(); listeCiz(); };

  // ---- Biçimlendirme ----
  const RENK = { admin: 'var(--renk-birincil)', mentor: '#2563eb', takim: '#0f8a5f', juri: '#7c3aed' };
  const ROL_AD = { admin: 'Yönetim', mentor: 'Mentör', takim: 'Takım', juri: 'Jüri' };
  const BAHIS = /<@(herkes|@admin|[mtj]:[a-z0-9]+)>/g;
  const harf = ad => ad.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toLocaleUpperCase('tr') || '?';
  const saat = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const tamZaman = t => new Date(t).toLocaleString('tr-TR');
  const ekAdres = e => `ek/${encodeURIComponent(e.id)}/${encodeURIComponent(e.ad)}`;
  function gun(t) {
    const d = new Date(t), b = new Date(); b.setHours(0, 0, 0, 0);
    const fark = Math.round((b - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    return fark === 0 ? 'Bugün' : fark === 1 ? 'Dün' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: d.getFullYear() === b.getFullYear() ? undefined : 'numeric' });
  }
  const kisiAdi = (kim, kisiler) => kim === ben?.kim ? ben.ad : kisiler?.[kim] || uyeler.find(u => u.kim === kim)?.ad || 'bilinmeyen';
  const benimIcin = kim => kim === 'herkes' || kim === ben?.kim;
  // Satır içi: **kalın**, __altı çizili__, *italik* / _italik_, ~~üstü çizili~~, ||sürpriz||
  const satirIci = s => s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<u>$1</u>')
    .replace(/\*(?=\S)([^*]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
    .replace(/\|\|(?=\S)([\s\S]*?\S)\|\|/g, '<span class="s-surpriz" title="Göstermek için tıklayın">$1</span>');
  function bicim(metin, kisiler) {
    const yer = [], tut = h => `\u0000${yer.push(h) - 1}\u0000`;
    let s = String(metin || '')
      .replace(/```(?:[\w+#-]*\n)?([\s\S]*?)```/g, (_, k) => tut(`<pre class="s-kod"><code>${esc(k.replace(/^\n+|\n+$/g, ''))}</code></pre>`))
      .replace(/`([^`\n]+)`/g, (_, k) => tut(`<code>${esc(k)}</code>`))
      .replace(BAHIS, (_, kim) => tut(`<span class="s-bahis ${benimIcin(kim) ? 'ben' : ''}">@${esc(kim === 'herkes' ? 'herkes' : kisiAdi(kim, kisiler))}</span>`))
      .replace(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'*_~|]/g, u => tut(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
    // Satır biçimleri: başlık (#), alıntı (>), liste (- ya da *)
    const satirlar = esc(s).split('\n'), cikti = [];
    for (let i = 0; i < satirlar.length; i++) {
      const l = satirlar[i]; let m;
      if ((m = l.match(/^(#{1,3}) (.+)/))) cikti.push({ blok: `<div class="s-h${m[1].length}">${satirIci(m[2])}</div>` });
      else if (/^&gt; ?/.test(l)) {
        const grup = [];
        while (i < satirlar.length && /^&gt; ?/.test(satirlar[i])) grup.push(satirIci(satirlar[i++].replace(/^&gt; ?/, '')));
        i--; cikti.push({ blok: `<blockquote>${grup.join('<br>')}</blockquote>` });
      } else if (/^[-*] /.test(l)) {
        const grup = [];
        while (i < satirlar.length && /^[-*] /.test(satirlar[i])) grup.push(`<li>${satirIci(satirlar[i++].slice(2))}</li>`);
        i--; cikti.push({ blok: `<ul>${grup.join('')}</ul>` });
      } else cikti.push({ satir: satirIci(l) });
    }
    let h = '';
    cikti.forEach((c, i) => { h += c.blok || c.satir + (cikti[i + 1]?.satir !== undefined ? '<br>' : ''); });
    return h.replace(/\u0000(\d+)\u0000/g, (_, n) => yer[n]);
  }
  // Yanıt önizlemesi için tek satır düz metin
  const duzMetin = (metin, kisiler) => String(metin || '').replace(BAHIS, (_, kim) => '@' + (kim === 'herkes' ? 'herkes' : kisiAdi(kim, kisiler)))
    .replace(/```[\w+#-]*\n?|[*_~`|]{2,}|[*_`]/g, '').replace(/\s+/g, ' ').trim();
  const sadeceEmoji = s => s && s.length <= 30 && /^(?:\p{Extended_Pictographic}|️|‍|\s)+$/u.test(s);
  // Düzenleme alanı: <@kim> → @Ad
  const tokenCoz = (metin, kisiler) => String(metin || '').replace(BAHIS, (_, kim) => '@' + (kim === 'herkes' ? 'herkes' : kisiAdi(kim, kisiler)));
  // Gönderirken @Ad → <@kim> (kanaldaki üyelerden, uzun adlar önce)
  function tokenla(metin) {
    if (!metin.includes('@')) return metin;
    const adaylar = uyeler.filter(u => metin.includes('@' + u.ad)).sort((a, b) => b.ad.length - a.ad.length);
    for (const u of adaylar) {
      const re = new RegExp('@' + u.ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'gu');
      metin = metin.replace(re, `<@${u.kim}>`);
    }
    if (ben && ben.rol !== 'takim') metin = metin.replace(/@herkes(?![\p{L}\p{N}])/gu, '<@herkes>');
    return metin;
  }

  // ---- Mesajlar ----
  const kanal = () => kanallar.find(x => x.kanal === secili);
  function eklerHtml(m) {
    if (!m.ekler?.length) return '';
    return `<div class="s-ekler">${m.ekler.map(e => e.gorsel
      ? `<a class="s-ek-gorsel" href="${ekAdres(e)}" target="_blank" rel="noopener"><img src="${ekAdres(e)}" alt="${esc(e.ad)}" loading="lazy"></a>`
      : `<a class="s-ek-dosya" href="${ekAdres(e)}" download="${esc(e.ad)}">${ik('file')}<span><b>${esc(e.ad)}</b><small>${boyut(e.boyut)}</small></span>${ik('download')}</a>`).join('')}</div>`;
  }
  function tepkilerHtml(m) {
    if (!m.tepkiler?.length) return '';
    return `<div class="s-tepkiler">${m.tepkiler.map(t => {
      const kim = t.adlar.join(', ') + (t.n > t.adlar.length ? ` ve ${t.n - t.adlar.length} kişi daha` : '');
      return `<button type="button" class="s-tepki ${t.ben ? 'ben' : ''}" data-tepki="${t.e}" title="${esc(kim)} ${t.e} ile tepki verdi">${t.e}<span>${t.n}</span></button>`;
    }).join('')}<button type="button" class="s-tepki ekle" data-emoji-ac title="Tepki ekle">${ik('smile-plus')}</button></div>`;
  }
  function yanitHtml(m) {
    const y = m.yanit;
    if (!y) return '';
    if (y.silindi) return `<div class="s-yanit-satir"><span class="s-mini-av yok"></span><i>Asıl mesaj silindi</i></div>`;
    const metin = duzMetin(y.metin, m.kisiler);
    return `<div class="s-yanit-satir" data-git="${y.id}" title="Mesaja git">
      <span class="s-mini-av" style="background:${RENK[y.rol]}">${esc(harf(y.uye || y.ad))}</span><b>${esc(y.uye || y.ad)}</b>
      <span class="s-yanit-metin">${metin ? esc(metin) : `<i>${ik('paperclip')} Ek dosya</i>`}</span></div>`;
  }
  function mesajlariCiz(altaKay, yeniGeldi = altaKay) {
    const k = kanal();
    if (!mesajlar.length) {
      akis.innerHTML = `<div class="s-bos-akis">${ik(k ? kanalIk(k) : 'message-square')}<b>Henüz mesaj yok</b><span>${esc(bosAciklama(k))}</span></div>`;
      return;
    }
    // Düzenleme kutusunun odağı ve imleci yeniden çizimden sonra korunur
    const eskiEditor = akis.querySelector('.s-duzen textarea'), odakta = eskiEditor && document.activeElement === eskiEditor;
    const imlec = odakta ? [eskiEditor.selectionStart, eskiEditor.selectionEnd] : null;
    const yazabilir = !!k?.yazar;
    let h = dahaVar ? '<button type="button" class="btn ghost sm s-eski">Daha eski mesajlar</button>' : '', onceki = null, sonGun = '';
    for (const m of mesajlar) {
      const g = gun(m.zaman);
      if (g !== sonGun) { h += `<div class="s-gun"><span>${g}</span></div>`; sonGun = g; onceki = null; }
      const birlesik = onceki && onceki.kim === m.kim && onceki.uye === m.uye && m.zaman - onceki.zaman < 5 * 60e3 && !m.yardim && !m.yanit;
      const gorunenAd = m.uye || m.ad;
      const benim = m.kim === ben?.kim;
      const silebilir = ben && (ben.rol === 'admin' || benim);
      const bahsedildi = !benim && ([...String(m.metin).matchAll(BAHIS)].some(x => benimIcin(x[1])) || (m.yanit && m.yanit.kim === ben?.kim));
      const etiket = m.rol === 'mentor' ? `Mentör${m.alan ? ' · ' + esc(m.alan) : ''}` : m.rol === 'takim' && m.uye ? `Takım · ${esc(m.ad)}` : ROL_AD[m.rol];
      const yonetici = ben?.rol === 'admin';
      const duzenleniyor = duzenlenen?.id === m.id;
      const duzenNotu = m.duzenlendi ? `<span class="s-duzenlendi" title="${tamZaman(m.duzenlendi)}">(düzenlendi)</span>` : '';
      const govdeMetin = duzenleniyor
        ? `<div class="s-duzen"><textarea rows="1" maxlength="2000" aria-label="Mesajı düzenle">${esc(duzenlenen.metin)}</textarea>
           <small>Esc: <a href="#" data-duzen-iptal>vazgeç</a> · Enter: <a href="#" data-duzen-kaydet>kaydet</a></small></div>`
        : m.metin ? `<div class="s-metin ${sadeceEmoji(m.metin) ? 'jumbo' : ''}">${bicim(m.metin, m.kisiler)} ${duzenNotu}</div>` : '';
      h += `<div class="s-msj ${birlesik ? 'birlesik' : ''} ${m.yardim ? 'yardim' : ''} ${benim ? 'benim' : ''} ${bahsedildi ? 'bahsedildi' : ''} ${duzenleniyor ? 'duzende' : ''}" data-id="${m.id}">
        ${yanitHtml(m)}
        ${birlesik ? `<time class="s-saat-k" title="${tamZaman(m.zaman)}">${saat(m.zaman)}</time>`
          : `<span class="s-avatar" style="background:${RENK[m.rol]}">${esc(harf(gorunenAd))}</span>`}
        <div class="s-govde">
          ${birlesik ? '' : `<div class="s-ust"><b>${esc(gorunenAd)}</b><span class="s-rol ${m.rol}">${etiket}</span><time title="${tamZaman(m.zaman)}">${saat(m.zaman)}</time></div>`}
          ${m.yardim ? `<div class="s-yardim-et">${ik('life-buoy')} Yardım çağrısı</div>` : ''}
          ${govdeMetin}${eklerHtml(m)}${tepkilerHtml(m)}
        </div>
        ${duzenleniyor ? '' : `<div class="s-arac" role="toolbar" aria-label="Mesaj işlemleri">
          ${HIZLI.map(e => `<button type="button" data-tepki="${e}" title="${e} tepkisi">${e}</button>`).join('')}
          <button type="button" data-emoji-ac title="Tepki ekle">${ik('smile-plus')}</button>
          ${yazabilir ? `<button type="button" data-yanitla title="Yanıtla">${ik('reply')}</button>` : ''}
          ${benim ? `<button type="button" data-duzenle title="Düzenle">${ik('pencil')}</button>` : ''}
          ${!benim && !yonetici ? `<button type="button" data-bildir title="Yönetime bildir">${ik('flag')}</button>` : ''}
          ${!benim && yonetici && m.rol !== 'admin' ? `<button type="button" data-sustur title="Yazanı sustur">${ik('ban')}</button>` : ''}
          ${silebilir ? `<button type="button" class="tehlike" data-sil title="Mesajı sil">${ik('trash-2')}</button>` : ''}
        </div>`}
      </div>`;
      onceki = m;
    }
    const ust = akis.scrollTop, altta = akis.scrollHeight - akis.scrollTop - akis.clientHeight < 80;
    akis.innerHTML = h;
    if (altaKay || altta) { akis.scrollTop = akis.scrollHeight; alttaMi = true; $('.s-yeni').classList.add('hidden'); }
    else { akis.scrollTop = ust; if (yeniGeldi) $('.s-yeni').classList.remove('hidden'); }
    const ed = akis.querySelector('.s-duzen textarea');
    if (ed) {
      boyutla(ed);
      if (odakta || duzenlenen.yeni) {
        ed.focus({ preventScroll: true });
        const n = ed.value.length;
        ed.setSelectionRange(...(imlec || [n, n]));
        if (duzenlenen.yeni) ed.closest('.s-msj').scrollIntoView({ block: 'nearest' });
        duzenlenen.yeni = false;
      }
    }
  }
  function bosAciklama(k) {
    if (!k) return '';
    if (k.kanal === 'duyuru') return rol === 'takim' || rol === 'juri' ? 'Yönetim ve mentörlerin duyuruları burada görünür.' : 'Buraya yazdığınız mesajı tüm takımlar, mentörler ve jüriler görür.';
    if (k.kanal === 'genel') return 'Tüm takımlar, mentörler ve yönetim burada sohbet eder. Jüriler göremez.';
    if (k.kanal === 'mentor') return 'Yalnızca mentörler ve yönetim görür.';
    if (k.kanal === 'juri') return 'Tüm jüriler ve yönetim görür. Takımlar ve mentörler göremez.';
    if (k.kanal.startsWith('oda:')) return 'Yalnızca bu odanın jürileri ve yönetim görür.';
    return rol === 'takim' ? 'Sorularınızı buraya yazın; mentörleriniz ve yönetim görür. Takılırsanız "Yardım istiyorum" kutusunu işaretleyin.'
      : 'Bu kanalı takım, mentörleri ve yönetim görür.';
  }
  akis.onscroll = () => {
    alttaMi = akis.scrollHeight - akis.scrollTop - akis.clientHeight < 80;
    if (alttaMi) $('.s-yeni').classList.add('hidden');
  };
  // Görseller yüklendikçe en alttaysak altta kalınır
  akis.addEventListener('load', e => { if (e.target.tagName === 'IMG' && alttaMi) akis.scrollTop = akis.scrollHeight; }, true);
  $('.s-yeni').onclick = () => { akis.scrollTop = akis.scrollHeight; $('.s-yeni').classList.add('hidden'); };

  akis.onclick = async e => {
    const t = e.target;
    if (t.closest('.s-eski')) return eskileriYukle();
    const surpriz = t.closest('.s-surpriz');
    if (surpriz) return surpriz.classList.add('acik');
    const msjEl = t.closest('.s-msj'), id = msjEl && +msjEl.dataset.id, m = id && mesajlar.find(x => x.id === id);
    const git = t.closest('[data-git]');
    if (git) { e.preventDefault(); return mesajaGit(+git.dataset.git); }
    if (t.closest('[data-duzen-iptal]')) { e.preventDefault(); return duzenIptal(); }
    if (t.closest('[data-duzen-kaydet]')) { e.preventDefault(); return duzenKaydet(); }
    if (!m) return;
    const tepki = t.closest('[data-tepki]');
    if (tepki) return tepkiVer(m, tepki.dataset.tepki);
    const emo = t.closest('[data-emoji-ac]');
    if (emo) return emojiAc(emo, { mesaj: m.id });
    if (t.closest('[data-yanitla]')) return yanitla(m);
    if (t.closest('[data-duzenle]')) return duzenle(m);
    if (t.closest('[data-bildir]')) {
      const neden = prompt('Bu mesajı neden yönetime bildiriyorsunuz? (isteğe bağlı)\nÖrn. küfür, hakaret, kişisel bilgi, spam');
      if (neden === null) return;
      try { await api('POST', 'api/mesaj/bildir', { id: m.id, neden }, rol); bildir('Mesaj yönetime bildirildi. Teşekkürler.', 'o'); }
      catch (err) { bildir(err.message, 'h'); }
      return;
    }
    if (t.closest('[data-sustur]')) return susturSor(m.kim, m.ad);
    if (t.closest('[data-sil]')) {
      if (!confirm('Mesaj silinsin mi?')) return;
      try {
        await api('DELETE', 'api/mesaj?id=' + m.id, undefined, rol);
        mesajlar = mesajlar.filter(x => x.id !== m.id);
        if (yanitlanan?.id === m.id) yanitIptal();
        mesajlariCiz();
      } catch (err) { bildir(err.message, 'h'); }
      return;
    }
    // Dokunmatik ekranda mesaja dokununca araç çubuğu açılır
    if (matchMedia('(hover: none)').matches && !t.closest('a, button, textarea')) {
      const acik = msjEl.classList.contains('acik');
      akis.querySelectorAll('.s-msj.acik').forEach(x => x.classList.remove('acik'));
      msjEl.classList.toggle('acik', !acik);
    }
  };
  async function susturSor(kim, ad) {
    const dk = prompt(`${ad} kaç dakika susturulsun?\nSusturulan kişi mesaj yazamaz, dosya gönderemez, tepki veremez.\nÖrn. 10, 60, 1440 (1 gün). Kaldırmak için 0 yazın.`, '60');
    if (dk === null || dk.trim() === '') return;
    const neden = +dk ? prompt('Neden? (kişiye gösterilir, isteğe bağlı)', '') : '';
    if (neden === null) return;
    try {
      await api('POST', 'api/mesaj/sustur', { kim, dakika: +dk, neden }, rol);
      bildir(+dk ? `${ad} ${dk} dakika susturuldu` : `${ad} için susturma kaldırıldı`, 'o');
    } catch (err) { bildir(err.message, 'h'); }
  }
  function mesajaGit(id) {
    const el = akis.querySelector(`.s-msj[data-id="${id}"]`);
    if (!el) return bildir('Mesaj daha eski; yukarı kaydırıp "Daha eski mesajlar" ile yükleyin');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('vurgu'); void el.offsetWidth; el.classList.add('vurgu');
  }

  // ---- Tepkiler ----
  async function tepkiVer(m, emoji) {
    // Önce ekranda güncellenir, sonra sunucuya gönderilir
    const t = m.tepkiler.find(x => x.e === emoji);
    if (t && t.ben) { t.n--; t.ben = false; t.adlar = t.adlar.filter(a => a !== ben.ad); if (!t.n) m.tepkiler = m.tepkiler.filter(x => x !== t); }
    else if (t) { t.n++; t.ben = true; t.adlar.push(ben.ad); }
    else m.tepkiler.push({ e: emoji, n: 1, ben: true, adlar: [ben.ad] });
    mesajlariCiz();
    try { await api('POST', 'api/mesaj/tepki', { id: m.id, emoji }, rol); }
    catch (err) { bildir(err.message, 'h'); getir(true); }
  }
  let emojiHedef = null;
  function emojiAc(dugme, hedef) {
    if (!emojiKutu.classList.contains('hidden') && emojiHedef && emojiHedef.dugme === dugme) return emojiKapat();
    emojiHedef = { ...hedef, dugme };
    emojiKutu.classList.remove('hidden');
    const k = kok.getBoundingClientRect(), d = dugme.getBoundingClientRect(), w = emojiKutu.offsetWidth, h = emojiKutu.offsetHeight;
    let x = d.right - k.left - w, y = d.top - k.top - h - 6;
    if (y < 4) y = d.bottom - k.top + 6;
    emojiKutu.style.left = Math.max(4, Math.min(x, k.width - w - 4)) + 'px';
    emojiKutu.style.top = Math.max(4, Math.min(y, k.height - h - 4)) + 'px';
  }
  function emojiKapat() { emojiKutu.classList.add('hidden'); emojiHedef = null; }
  emojiKutu.onclick = e => {
    const b = e.target.closest('[data-e]');
    if (!b || !emojiHedef) return;
    const hedef = emojiHedef; emojiKapat();
    if (hedef.mesaj) { const m = mesajlar.find(x => x.id === hedef.mesaj); if (m) tepkiVer(m, b.dataset.e); }
    else imleceEkle(b.dataset.e);
  };
  document.addEventListener('mousedown', e => {
    if (!emojiKutu.classList.contains('hidden') && !emojiKutu.contains(e.target) && !e.target.closest('[data-emoji-ac], .s-emoji-ac')) emojiKapat();
    if (!oneri.contains(e.target) && e.target !== metinAlan) oneriKapat();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !emojiKutu.classList.contains('hidden')) emojiKapat(); });
  $('.s-emoji-ac').onclick = e => emojiAc(e.currentTarget, { yaz: true });
  function imleceEkle(s) {
    const a = metinAlan.selectionStart ?? metinAlan.value.length, b = metinAlan.selectionEnd ?? a;
    metinAlan.value = metinAlan.value.slice(0, a) + s + metinAlan.value.slice(b);
    metinAlan.focus(); metinAlan.setSelectionRange(a + s.length, a + s.length); boyutla();
  }

  // ---- Yanıtla ----
  function yanitla(m) {
    if (!kanal()?.yazar) return;
    yanitlanan = m;
    const c = $('.s-yanit-cubuk');
    c.innerHTML = `${ik('reply')}<span><b>${esc(m.uye || m.ad)}</b> kişisine yanıt veriliyor</span><button type="button" class="ikbtn" title="Yanıtı iptal et">${ik('x')}</button>`;
    c.classList.remove('hidden');
    c.querySelector('button').onclick = yanitIptal;
    metinAlan.focus();
  }
  function yanitIptal() { yanitlanan = null; $('.s-yanit-cubuk').classList.add('hidden'); }

  // ---- Düzenleme ----
  function duzenle(m) {
    duzenlenen = { id: m.id, metin: tokenCoz(m.metin, m.kisiler), yeni: true };
    mesajlariCiz();
  }
  function duzenIptal() { duzenlenen = null; mesajlariCiz(); metinAlan.focus({ preventScroll: true }); }
  async function duzenKaydet() {
    const ed = akis.querySelector('.s-duzen textarea');
    if (!duzenlenen || !ed) return;
    const m = mesajlar.find(x => x.id === duzenlenen.id), metin = ed.value.trim();
    if (!m) return duzenIptal();
    if (!metin && !m.ekler?.length) {
      if (!confirm('Mesaj boş kaldı. Silinsin mi?')) return;
      try { await api('DELETE', 'api/mesaj?id=' + m.id, undefined, rol); mesajlar = mesajlar.filter(x => x !== m); }
      catch (err) { return bildir(err.message, 'h'); }
      return duzenIptal();
    }
    const yeni = tokenla(metin);
    if (yeni !== m.metin) {
      try { await api('PUT', 'api/mesaj', { id: m.id, metin: yeni }, rol); }
      catch (err) { return bildir(err.message, 'h'); }
      m.metin = yeni; m.duzenlendi = Date.now();
    }
    duzenIptal();
  }
  akis.addEventListener('input', e => {
    if (e.target.matches('.s-duzen textarea')) { duzenlenen.metin = e.target.value; boyutla(e.target); }
  });
  akis.addEventListener('keydown', e => {
    if (!e.target.matches('.s-duzen textarea')) return;
    if (e.key === 'Escape') { e.preventDefault(); duzenIptal(); }
    else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); duzenKaydet(); }
  });

  // ---- Üye listesi ----
  const ROL_GRUP = [['admin', 'Yönetim'], ['mentor', 'Mentörler'], ['juri', 'Jüri'], ['takim', 'Takımlar']];
  function uyeSatir(u) {
    return `<button type="button" class="s-uye ${u.cevrimici ? '' : 'kapali'}" data-uye="${esc(u.kim)}" title="${esc(u.ad)}${u.alan ? ' · ' + esc(u.alan) : ''}">
      <span class="s-avatar k" style="background:${RENK[u.rol]}">${esc(harf(u.ad))}<i class="s-durum ${u.cevrimici ? 'acik' : ''}"></i></span>
      <span class="ad">${esc(u.ad)}${u.kim === ben?.kim ? ' <small>(siz)</small>' : ''}${u.alan ? `<small>${esc(u.alan)}</small>` : ''}</span></button>`;
  }
  function uyeleriCiz() {
    if (!uyePanel) return;
    if (uyeKanal !== secili) { uyeKutu.innerHTML = '<div class="s-bos">Yükleniyor…</div>'; return; }
    const sira = (a, b) => a.ad.localeCompare(b.ad, 'tr');
    const acik = uyeler.filter(u => u.cevrimici), kapali = uyeler.filter(u => !u.cevrimici).sort(sira);
    let h = `<div class="s-uye-bas">${ik('users')} Üyeler <span>${uyeler.length}</span></div>`;
    for (const [r, ad] of ROL_GRUP) {
      const l = acik.filter(u => u.rol === r).sort(sira);
      if (l.length) h += `<div class="s-grup">${ad} — ${l.length}</div>` + l.map(uyeSatir).join('');
    }
    if (kapali.length) {
      h += `<div class="s-grup">Çevrimdışı — ${kapali.length}</div>` + kapali.slice(0, 150).map(uyeSatir).join('');
      if (kapali.length > 150) h += `<div class="s-bos">ve ${kapali.length - 150} kişi daha</div>`;
    }
    uyeKutu.innerHTML = h;
  }
  uyeKutu.onclick = e => {
    const b = e.target.closest('[data-uye]');
    const u = b && uyeler.find(x => x.kim === b.dataset.uye);
    if (!u || !kanal()?.yazar || u.kim === ben?.kim) return;
    const once = metinAlan.value && !/\s$/.test(metinAlan.value) ? ' ' : '';
    metinAlan.value += `${once}@${u.ad} `;
    metinAlan.focus(); boyutla();
    if (innerWidth <= 1100) uyePaneliAc(false);
  };
  function uyePaneliAc(v) {
    uyePanel = v;
    kok.classList.toggle('uyeli', v);
    try { localStorage.setItem('ejUyePanel', v ? '1' : '0'); } catch {}
    $('.s-uye-ac')?.classList.toggle('secili', v);
    if (v) { uyeleriCiz(); if (uyeKanal !== secili) getir(false, true); }
  }

  // ---- @bahsetme önerileri ----
  let oneriler = [], oneriSecili = 0, oneriBas = -1;
  function oneriGuncelle() {
    const a = metinAlan.selectionStart, once = metinAlan.value.slice(0, a);
    const m = once.match(/(?:^|\s)@([^\s@][^@\n]{0,29}|)$/);
    if (!m || !kanal()?.yazar) return oneriKapat();
    const q = m[1].toLocaleLowerCase('tr');
    oneriBas = a - m[1].length - 1;
    const aday = uyeler.filter(u => u.kim !== ben?.kim);
    const bas = aday.filter(u => u.ad.toLocaleLowerCase('tr').startsWith(q));
    const ic = aday.filter(u => !bas.includes(u) && u.ad.toLocaleLowerCase('tr').includes(q));
    oneriler = [...bas, ...ic].slice(0, 8);
    if (ben && ben.rol !== 'takim' && 'herkes'.startsWith(q)) oneriler.push({ kim: 'herkes', ad: 'herkes', rol: 'admin', herkes: true });
    if (!oneriler.length) return oneriKapat();
    oneriSecili = Math.min(oneriSecili, oneriler.length - 1);
    oneri.innerHTML = `<div class="s-oneri-bas">Üyeler${q ? ` — "${esc(m[1])}"` : ''}</div>` + oneriler.map((u, i) =>
      `<button type="button" class="${i === oneriSecili ? 'secili' : ''}" data-i="${i}" role="option">
        ${u.herkes ? `<span class="s-avatar k">${ik('at-sign')}</span><b>@herkes</b><small>Kanaldaki herkese bildirir</small>`
          : `<span class="s-avatar k" style="background:${RENK[u.rol]}">${esc(harf(u.ad))}<i class="s-durum ${u.cevrimici ? 'acik' : ''}"></i></span><b>${esc(u.ad)}</b><small>${esc(u.alan || ROL_AD[u.rol])}</small>`}
      </button>`).join('');
    oneri.classList.remove('hidden');
  }
  function oneriKapat() { oneri.classList.add('hidden'); oneriler = []; oneriSecili = 0; }
  function oneriSec(i) {
    const u = oneriler[i];
    if (!u) return;
    const a = metinAlan.selectionStart, ek = `@${u.ad} `;
    metinAlan.value = metinAlan.value.slice(0, oneriBas) + ek + metinAlan.value.slice(a);
    const yeni = oneriBas + ek.length;
    metinAlan.setSelectionRange(yeni, yeni); metinAlan.focus();
    oneriKapat(); boyutla();
  }
  oneri.onmousedown = e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); oneriSec(+b.dataset.i); } };

  function basCiz() {
    const k = kanal();
    if (!k) return;
    let ek = '';
    if (k.takim && rol !== 'takim') {
      const yer = [k.il, k.okul].filter(Boolean).join(' · ');
      const duzenle = rol === 'yonetim' ? `takim?takim=${encodeURIComponent(k.takim)}` : k.benim ? `takim?takim=${encodeURIComponent(k.takim)}&rol=mentor` : '';
      ek = `<small>${esc(yer)}${k.mentorler?.length ? ` · ${k.mentorler.length} mentör` : ' · mentör atanmamış'}</small>
        <span class="s-bas-eylem"><a class="btn ghost sm" href="oyun/${encodeURIComponent(k.takim)}" target="_blank">${ik('eye')} Sayfası</a>
        ${duzenle ? `<a class="btn ghost sm" href="${duzenle}">${ik('pencil')} Düzenle</a>` : ''}</span>`;
    } else ek = `<small>${esc(bosAciklama(k))}</small>`;
    $('.s-bas').innerHTML = `<button type="button" class="ikbtn s-geri" title="Kanallar">${ik('arrow-left')}</button>
      <div class="s-bas-ad">${ik(kanalIk(k))}<b>${esc(k.ad)}</b></div>${ek}
      <span class="s-bas-sag"><button type="button" class="ikbtn s-bildirim-ac" title="${bildirimAcik ? 'Bildirimler açık (sizden bahsedilince, yanıt gelince sesli uyarı)' : 'Bildirimler kapalı'}">${ik(bildirimAcik ? 'bell' : 'bell-off')}</button>
      <button type="button" class="ikbtn s-uye-ac ${uyePanel ? 'secili' : ''}" title="Üye listesi">${ik('users')}</button></span>`;
    $('.s-bas .s-bildirim-ac').onclick = bildirimDegistir;
    $('.s-bas .s-geri').onclick = () => kok.classList.remove('kanalda');
    $('.s-bas .s-uye-ac').onclick = () => uyePaneliAc(!uyePanel);
    const sus = ben?.susturma, yazar = k.yazar && !sus;
    form.classList.toggle('hidden', !yazar);
    $('.s-yardim').classList.toggle('hidden', !(rol === 'takim' && k.takim));
    yazanCiz();
    const salt = $('.s-salt');
    salt.classList.toggle('hidden', yazar);
    salt.textContent = yazar ? '' : sus ? `Yönetim sizi ${new Date(sus.bitis).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} saatine kadar susturdu${sus.neden ? ': ' + sus.neden : ''}. Bu sürede mesaj yazamaz ve tepki veremezsiniz.`
      : k.kanal === 'genel' ? 'Genel sohbet yönetim tarafından şimdilik kapatıldı. Mesajlara tepki verebilirsiniz.'
      : 'Bu kanala yalnızca yönetim ve mentörler yazar. Mesajlara tepki verebilirsiniz.';
  }

  // ---- Takım mesajını yazan öğrenci ----
  // Takım tek hesapla girer; mesajı hangi öğrencinin yazdığı seçilir (tarayıcıda hatırlanır)
  const yazanSec = $('.s-yazan select');
  const yazanAnahtar = () => 'ejYazan-' + (ben?.kim || '');
  function yazanCiz() {
    const uyeler = rol === 'takim' ? ben?.uyeler || [] : [];
    $('.s-yazan').classList.toggle('hidden', !uyeler.length);
    if (!uyeler.length) return;
    const imza = uyeler.join('\n');
    if (yazanSec.dataset.imza !== imza) {
      let kayitli = ''; try { kayitli = localStorage.getItem(yazanAnahtar()) || ''; } catch {}
      const deger = uyeler.includes(yazanSec.value) ? yazanSec.value : uyeler.includes(kayitli) ? kayitli : '';
      yazanSec.innerHTML = '<option value="">Kim yazıyor?</option>' + uyeler.map(u => `<option>${esc(u)}</option>`).join('');
      yazanSec.value = deger; yazanSec.dataset.imza = imza;
    }
  }
  yazanSec.onchange = () => { try { localStorage.setItem(yazanAnahtar(), yazanSec.value); } catch {} metinAlan.focus(); };

  // ---- Bildirimler: bahsetme, takıma gelen yanıt, yardım çağrısı ----
  function bildirimDegistir() {
    bildirimAcik = !bildirimAcik;
    try { localStorage.setItem('ejBildirim', bildirimAcik ? '1' : '0'); } catch {}
    if (bildirimAcik && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    if (bildirimAcik) ses();
    bildir(bildirimAcik ? 'Bildirimler açık: sizden bahsedilince ya da yanıt gelince sesli uyarı alırsınız' : 'Bildirimler kapatıldı', 'o');
    basCiz();
  }
  // İlk tıklamada tarayıcı bildirim izni istenir (izin yalnızca kullanıcı etkileşimiyle istenebilir)
  kok.addEventListener('click', () => {
    if (bildirimAcik && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, { once: true });
  let sesBaglam = null;
  function ses() {
    try {
      sesBaglam ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = sesBaglam.currentTime;
      [[880, 0], [1320, .12]].forEach(([hz, d]) => {
        const o = sesBaglam.createOscillator(), g = sesBaglam.createGain();
        o.frequency.value = hz; o.type = 'sine';
        g.gain.setValueAtTime(.0001, t + d); g.gain.exponentialRampToValueAtTime(.18, t + d + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d + .25);
        o.connect(g).connect(sesBaglam.destination); o.start(t + d); o.stop(t + d + .3);
      });
    } catch {}
  }
  function uyar(baslik, govde, kn) {
    if (!bildirimAcik) return;
    ses();
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    try {
      const n = new Notification(baslik, { body: govde, icon: 'icon.png', tag: 'ej-' + kn });
      n.onclick = () => { window.focus(); if (odaklan) odaklan(); ac(kn); n.close(); };
    } catch {}
  }
  // Önceki sorguya göre artan bahsetme, takıma gelen yeni mesaj ve yeni yardım çağrısı uyarılır.
  // Kişi o kanala zaten bakıyorsa uyarı verilmez.
  function bildirimKontrol() {
    const simdi = Object.fromEntries(kanallar.map(k => [k.kanal, k]));
    if (oncekiDurum) {
      const bakiyor = kn => gorunur && kn === secili && !document.hidden;
      for (const k of kanallar) {
        const o = oncekiDurum[k.kanal];
        if (!o || bakiyor(k.kanal)) continue;
        if (k.bahsetme > o.bahsetme) { uyar(`${k.ad}: sizden bahsedildi`, 'Yeni mesajı görmek için tıklayın', k.kanal); break; }
        if (rol === 'takim' && k.takim && k.okunmamis > o.okunmamis) { uyar('Mentörlerinizden yeni mesaj', `${k.okunmamis} okunmamış mesaj`, k.kanal); break; }
        if (rol !== 'takim' && k.yardim && !o.yardim && (rol !== 'mentor' || k.benim)) { uyar(`${k.ad} yardım istiyor`, 'Takımın kanalını açmak için tıklayın', k.kanal); break; }
      }
    }
    oncekiDurum = simdi;
  }

  // ---- Sunucuyla eşitleme ----
  // Bir istek sürerken kanal değişirse, yanıt eski kanala aitse atılır ve yeni kanal baştan yüklenir
  let tekrarSifirdan = false;
  async function getir(sifirdan, uyeIste) {
    if (istekte) { if (sifirdan) tekrarSifirdan = true; return; }
    istekte = true;
    const kn = secili;
    try {
      let q = '';
      if (gorunur && kn) {
        q = `?kanal=${encodeURIComponent(kn)}${sifirdan ? '' : `&sonra=${sonId}&surum=${surum}`}`;
        // Üye listesi kanal açılınca ve 30 sn'de bir (çevrimiçi durumu için) istenir
        if (sifirdan || uyeIste || uyeKanal !== kn || (uyePanel && ++sorgu % 6 === 0)) q += '&uyeler=1';
      }
      const d = await api('GET', 'api/mesaj' + q, undefined, rol);
      ben = d.ben; kanallar = d.kanallar;
      if (!secili || !kanallar.some(k => k.kanal === secili)) {
        let kayitli = null; try { kayitli = sessionStorage.getItem(anahtar); } catch {}
        const varsayilan = kanallar.find(k => k.kanal === kayitli) || (rol === 'takim' ? kanallar.find(k => k.takim) : rol === 'juri' ? kanallar.find(k => k.kanal === 'juri') : null)
          || kanallar.find(k => k.yardim) || kanallar.find(k => k.okunmamis) || kanallar[0];
        if (varsayilan) { secili = varsayilan.kanal; mesajlar = []; sonId = 0; tekrarSifirdan = gorunur; }
      }
      if (kn === secili && q.includes('uyeler=1')) {
        uyeKanal = kn; uyeler = d.uyeler || [];
        if (d.uyeler) uyeleriCiz();
        else if (uyePanel) uyeKutu.innerHTML = '<div class="s-bos" style="padding-top:18px">Üye listesi alınamadı. Sunucu güncel değilse yeniden başlatın.</div>';
      }
      if (d.mesajlar && kn === secili) {
        let cizilecek = false;
        if (sifirdan) { mesajlar = d.mesajlar; dahaVar = !!d.dahaVar; cizilecek = true; }
        else {
          const yeni = d.mesajlar.filter(m => m.id > sonId);
          if (yeni.length) { mesajlar = mesajlar.concat(yeni); cizilecek = true; }
          for (const g of d.degisen || []) {
            const i = mesajlar.findIndex(x => x.id === g.id);
            if (i < 0) continue;
            if (g.silindi) { mesajlar.splice(i, 1); if (duzenlenen?.id === g.id) duzenlenen = null; if (yanitlanan?.id === g.id) yanitIptal(); }
            else mesajlar[i] = g;
            cizilecek = true;
          }
          if (yeni.length) sonId = yeni[yeni.length - 1].id;
          if (cizilecek) mesajlariCiz(false, yeni.length > 0);
        }
        if (mesajlar.length) sonId = Math.max(sonId, mesajlar[mesajlar.length - 1].id);
        surum = d.surum;
        if (sifirdan) mesajlariCiz(true);
      }
      listeCiz(); basCiz(); bildirimGuncelle(d.bildirimSayisi); bildirimKontrol();
    } catch (e) {
      if (e.status === 401) { durdur(); bildir('Oturum sona erdi, yeniden giriş yapın', 'h'); }
    } finally {
      istekte = false;
      if (tekrarSifirdan) { tekrarSifirdan = false; getir(true); }
    }
  }
  async function eskileriYukle() {
    if (!mesajlar.length) return;
    try {
      const d = await api('GET', `api/mesaj?kanal=${encodeURIComponent(secili)}&once=${mesajlar[0].id}`, undefined, rol);
      const yukseklik = akis.scrollHeight;
      mesajlar = d.mesajlar.concat(mesajlar); dahaVar = !!d.dahaVar;
      mesajlariCiz();
      akis.scrollTop = akis.scrollHeight - yukseklik;
    } catch (e) { bildir(e.message, 'h'); }
  }
  let sonBildirimSayisi = 0;
  function bildirimGuncelle(bildirimSayisi = sonBildirimSayisi) {
    sonBildirimSayisi = bildirimSayisi || 0;
    const okunmamis = kanallar.reduce((a, k) => a + (gorunur && k.kanal === secili ? 0 : k.okunmamis), 0);
    const yardim = kanallar.filter(k => k.yardim).length;
    if (degisti) degisti(okunmamis, rol === 'takim' ? 0 : yardim, sonBildirimSayisi);
  }
  function planla() {
    clearTimeout(zamanlayici);
    if (kapali) return;
    zamanlayici = setTimeout(async () => { await getir(false); planla(); }, document.hidden ? 30e3 : gorunur ? 5e3 : 15e3);
  }
  function durdur() { kapali = true; clearTimeout(zamanlayici); zamanlayici = null; }
  document.addEventListener('visibilitychange', () => { if (zamanlayici !== null && !document.hidden) { getir(false); planla(); } });

  function ac(kn) {
    if (kn !== secili) {
      secili = kn; mesajlar = []; sonId = 0; surum = 0; dahaVar = false; akis.innerHTML = '';
      duzenlenen = null; yanitIptal(); ekleriTemizle(); oneriKapat(); emojiKapat();
      uyeKanal = null; uyeler = []; uyeleriCiz();
    }
    try { sessionStorage.setItem(anahtar, kn); } catch {}
    kok.classList.add('kanalda');
    listeCiz(); basCiz();
    if (gorunur) { getir(true); metinAlan.focus({ preventScroll: true }); }
  }

  // ---- Dosya ekleri ----
  const dosyaSec = $('.s-dosya');
  $('.s-ek-ekle').onclick = () => dosyaSec.click();
  dosyaSec.onchange = () => { dosyalariEkle([...dosyaSec.files]); dosyaSec.value = ''; };
  function dosyalariEkle(liste) {
    if (!kanal()?.yazar) return;
    for (const f of liste) {
      if (ekler.length >= MAX_EK) { bildir(`Bir mesaja en fazla ${MAX_EK} dosya eklenebilir`, 'h'); break; }
      const e = { yerel: Math.random().toString(36).slice(2), ad: f.name, boyut: f.size, gorsel: /^image\/(png|jpeg|gif|webp)$/.test(f.type),
        onizleme: /^image\//.test(f.type) ? URL.createObjectURL(f) : null, oran: 0, kanal: secili };
      ekler.push(e);
      EJ.yukle(`api/mesaj/dosya?kanal=${encodeURIComponent(secili)}&ad=${encodeURIComponent(f.name || 'gorsel.png')}`, f, rol, o => { e.oran = o; ekleriCiz(); })
        .then(d => { e.id = d.id; e.ad = d.ad; if (!ekler.includes(e)) ekSunucudanSil(e); ekleriCiz(); })
        .catch(err => { bildir(`${f.name}: ${err.message}`, 'h'); ekCikar(e); });
    }
    ekleriCiz();
  }
  function ekleriCiz() {
    const k = $('.s-ek-on');
    k.classList.toggle('hidden', !ekler.length);
    k.innerHTML = ekler.map(e => `<div class="s-ek-kart ${e.id ? '' : 'yukleniyor'}" data-yerel="${e.yerel}" title="${esc(e.ad)}">
      ${e.onizleme ? `<img src="${e.onizleme}" alt="">` : `<span class="s-ek-ik">${ik('file')}</span>`}
      <span class="ad">${esc(e.ad)}</span><small>${e.id ? boyut(e.boyut) : `%${Math.round(e.oran * 100)}`}</small>
      ${e.id ? '' : `<i class="s-ek-cubuk" style="width:${Math.round(e.oran * 100)}%"></i>`}
      <button type="button" class="ikbtn" data-ek-sil title="Kaldır">${ik('x')}</button></div>`).join('');
    form.querySelector('button[type=submit]').disabled = ekler.some(e => !e.id);
  }
  $('.s-ek-on').onclick = e => {
    const b = e.target.closest('[data-ek-sil]');
    if (!b) return;
    const ek = ekler.find(x => x.yerel === b.closest('[data-yerel]').dataset.yerel);
    if (ek) { ekCikar(ek); ekSunucudanSil(ek); }
  };
  function ekCikar(e) { ekler = ekler.filter(x => x !== e); if (e.onizleme) URL.revokeObjectURL(e.onizleme); ekleriCiz(); }
  function ekSunucudanSil(e) { if (e.id) api('DELETE', 'api/mesaj/dosya?id=' + encodeURIComponent(e.id), undefined, rol).catch(() => {}); }
  function ekleriTemizle(sunucudan = true) {
    for (const e of ekler) { if (sunucudan) ekSunucudanSil(e); if (e.onizleme) URL.revokeObjectURL(e.onizleme); }
    ekler = []; ekleriCiz();
  }
  // Panodan görsel yapıştırma ve sürükle-bırak
  metinAlan.addEventListener('paste', e => {
    const f = [...(e.clipboardData?.files || [])];
    if (f.length) { e.preventDefault(); dosyalariEkle(f); }
  });
  const akisBolum = $('.s-akis'), surukle = $('.s-surukle');
  let surukleSay = 0;
  akisBolum.addEventListener('dragenter', e => { if (kanal()?.yazar && e.dataTransfer?.types.includes('Files')) { surukleSay++; surukle.classList.remove('hidden'); } });
  akisBolum.addEventListener('dragleave', () => { if (--surukleSay <= 0) { surukleSay = 0; surukle.classList.add('hidden'); } });
  akisBolum.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  akisBolum.addEventListener('drop', e => {
    surukleSay = 0; surukle.classList.add('hidden');
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault(); dosyalariEkle([...e.dataTransfer.files]);
  });

  // ---- Gönderme ----
  async function gonder() {
    const metin = metinAlan.value.trim();
    if ((!metin && !ekler.length) || !secili || ekler.some(e => !e.id)) return;
    const yardimKutu = $('.s-yardim input');
    const btn = form.querySelector('button[type=submit]');
    const uye = $('.s-yazan').classList.contains('hidden') ? null : yazanSec.value;
    if (uye === '') { bildir('Önce mesajı kimin yazdığını seçin', 'h'); yazanSec.focus(); return; }
    btn.disabled = true;
    try {
      await api('POST', 'api/mesaj', {
        kanal: secili, metin: tokenla(metin), yanit: yanitlanan?.id || null, ekler: ekler.map(e => e.id), uye,
        yardim: !$('.s-yardim').classList.contains('hidden') && yardimKutu.checked
      }, rol);
      metinAlan.value = ''; yardimKutu.checked = false; boyutla();
      yanitIptal(); ekleriTemizle(false); oneriKapat();
      while (istekte) await new Promise(r => setTimeout(r, 50));
      await getir(false);
      akis.scrollTop = akis.scrollHeight;
    } catch (e) { bildir(e.message, 'h'); }
    finally { btn.disabled = false; metinAlan.focus(); }
  }
  form.onsubmit = e => { e.preventDefault(); gonder(); };
  metinAlan.onkeydown = e => {
    if (!oneri.classList.contains('hidden') && oneriler.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        oneriSecili = (oneriSecili + (e.key === 'ArrowDown' ? 1 : oneriler.length - 1)) % oneriler.length;
        return oneriGuncelle();
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); return oneriSec(oneriSecili); }
      if (e.key === 'Escape') { e.preventDefault(); return oneriKapat(); }
    }
    if (e.key === 'Escape' && yanitlanan) { e.preventDefault(); return yanitIptal(); }
    // Boş kutuda yukarı ok: son mesajınızı düzenler
    if (e.key === 'ArrowUp' && !metinAlan.value) {
      const son = [...mesajlar].reverse().find(m => m.kim === ben?.kim && m.metin);
      if (son) { e.preventDefault(); return duzenle(son); }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); gonder(); }
  };
  function boyutla(alan = metinAlan) {
    alan.style.height = 'auto';
    alan.style.height = Math.min(alan.scrollHeight + 2, 200) + 'px';
    alan.style.overflowY = alan.scrollHeight > 200 ? 'auto' : 'hidden';
  }
  metinAlan.oninput = () => { boyutla(); oneriGuncelle(); };
  metinAlan.onclick = oneriGuncelle;

  boyutla();
  getir(false).then(planla);
  return {
    goster(v) { gorunur = v; if (v) { getir(true); planla(); } else bildirimGuncelle(); },
    ac(kn) { gorunur = true; ac(kn); planla(); },
    mesajaGit(kn, id) { gorunur = true; ac(kn); planla(); setTimeout(function bekle(n = 0) { if (akis.querySelector(`[data-id="${id}"]`)) mesajaGit(id); else if (n < 20) setTimeout(() => bekle(n + 1), 250); }, 300); },
    susturSor,
    durdur
  };
}
