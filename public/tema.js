// Ekran teması (yönetim panelinden seçilir). <head> içinde, CSS'ten hemen sonra yüklenir:
// son bilinen tema anında uygulanır (renk atlaması olmasın), sonra sunucudaki değerle güncellenir.
(function () {
  const root = document.documentElement;
  const uygula = t => {
    t = t === 'b' ? 'b' : 'd';
    root.dataset.tema = t;
    try { localStorage.setItem('ejTema', t); } catch {}
  };
  try { const t = localStorage.getItem('ejTema'); if (t) root.dataset.tema = t; } catch {}
  window.temaUygula = t => { if (t) uygula(t); };
  fetch('api/durum').then(r => r.json()).then(d => window.temaUygula(d.tema)).catch(() => {});
})();
