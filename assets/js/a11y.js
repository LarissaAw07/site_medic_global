/* MedicGLOBAL 2.0 — central de acessibilidade
   Botão lateral fixo + painel com ajustes visuais, leitura em voz alta e tradução para Libras (VLibras).
   Os ajustes viram classes em <html> (a11y-*) e ficam salvos em localStorage ("mg-a11y");
   o <head> do layout reaplica as classes antes de desenhar a página, sem "piscar". */
(function () {
  "use strict";
  var doc = document.documentElement, KEY = "mg-a11y";
  var root = document.getElementById("a11y");
  if (!root) return;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var panel = $("#a11y-panel"), fab = $(".a11y-fab", root), title = $("#a11y-title");
  var statusEl = $("#a11y-status"), sizeOut = $("#a11y-size-out"), guideBar = $(".a11y-guide-bar");
  var toggles = $$("[data-a11y-toggle]", root);
  var SIZES = { "-1": 90, "0": 100, "1": 112.5, "2": 125, "3": 137.5, "4": 150 }, MIN = -1, MAX = 4;

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "{}");
      return { size: Math.max(MIN, Math.min(MAX, +s.size || 0)), on: Array.isArray(s.on) ? s.on : [], libras: !!s.libras };
    } catch (e) { return { size: 0, on: [], libras: false }; }
  }
  var state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function say(msg) { statusEl.textContent = ""; setTimeout(function () { statusEl.textContent = msg; }, 60); }

  /* Fonte legível (Atkinson Hyperlegible) só é baixada quando o recurso é ligado */
  function ensureFont() {
    if ($("#a11y-font-css")) return;
    var l = document.createElement("link");
    l.id = "a11y-font-css"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap";
    document.head.appendChild(l);
  }

  function apply() {
    if (state.size) doc.setAttribute("data-a11y-size", state.size); else doc.removeAttribute("data-a11y-size");
    sizeOut.textContent = String(SIZES[state.size]).replace(".", ",") + "%";
    $("[data-a11y-size='-1']", root).disabled = state.size <= MIN;
    $("[data-a11y-size='1']", root).disabled = state.size >= MAX;
    toggles.forEach(function (b) {
      var k = b.getAttribute("data-a11y-toggle"), on = state.on.indexOf(k) > -1;
      doc.classList.toggle("a11y-" + k, on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (state.on.indexOf("font") > -1) ensureFont();
    document.dispatchEvent(new CustomEvent("a11y:change"));
  }

  /* ---------- Painel ---------- */
  function isOpen() { return !panel.hidden; }
  function open() {
    panel.hidden = false; fab.setAttribute("aria-expanded", "true"); root.classList.add("is-open");
    title.focus();
  }
  function close(returnFocus) {
    if (!isOpen()) return;
    var hadFocus = panel.contains(document.activeElement);
    panel.hidden = true; fab.setAttribute("aria-expanded", "false"); root.classList.remove("is-open");
    if (returnFocus !== false && hadFocus) fab.focus();
  }
  fab.addEventListener("click", function () { isOpen() ? close() : open(); });
  $("[data-a11y-close]", root).addEventListener("click", function () { close(); });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen()) { e.preventDefault(); close(); fab.focus(); } });
  document.addEventListener("click", function (e) { if (isOpen() && !root.contains(e.target)) close(false); });

  /* ---------- Ajustes ---------- */
  toggles.forEach(function (b) {
    b.addEventListener("click", function () {
      var k = b.getAttribute("data-a11y-toggle"), i = state.on.indexOf(k);
      if (i > -1) state.on.splice(i, 1); else state.on.push(k);
      save(); apply();
      say(b.textContent.trim() + (i > -1 ? " desativado" : " ativado"));
    });
  });
  $$("[data-a11y-size]", root).forEach(function (b) {
    b.addEventListener("click", function () {
      state.size = Math.max(MIN, Math.min(MAX, state.size + +b.getAttribute("data-a11y-size")));
      save(); apply();
      say("Tamanho do texto " + sizeOut.textContent);
    });
  });
  $("[data-a11y-reset]", root).addEventListener("click", function () {
    stopReading();
    state = { size: 0, on: [], libras: false };
    save(); apply();
    say("Configurações de acessibilidade restauradas");
  });

  /* ---------- Guia de leitura: faixa que acompanha o cursor (ou o elemento com foco) ---------- */
  function moveGuide(y) { if (guideBar) guideBar.style.transform = "translateY(" + Math.round(y - 22) + "px)"; }
  document.addEventListener("mousemove", function (e) { if (doc.classList.contains("a11y-guide")) moveGuide(e.clientY); }, { passive: true });
  document.addEventListener("focusin", function (e) {
    if (!doc.classList.contains("a11y-guide") || root.contains(e.target)) return;
    var r = e.target.getBoundingClientRect(); moveGuide(r.top + r.height / 2);
  });

  /* ---------- Leitura em voz alta (Web Speech API, voz em português) ---------- */
  var synth = window.speechSynthesis, readBtn = $("[data-a11y-read]", root), readBar = $("[data-a11y-reading]", root);
  var pauseBtn = $("[data-a11y-read-pause]", root), queue = [], current = null, reading = false;
  function voice() {
    var vs = synth.getVoices();
    for (var i = 0; i < vs.length; i++) if (/^pt(-|_)BR/i.test(vs[i].lang)) return vs[i];
    for (i = 0; i < vs.length; i++) if (/^pt/i.test(vs[i].lang)) return vs[i];
    return null;
  }
  function visible(el) {
    if (!el.getClientRects().length) return false;
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (n.getAttribute("aria-hidden") === "true" || n.inert || n.hidden) return false;
    }
    return true;
  }
  // Divide textos longos em frases (o Chrome interrompe falas muito longas)
  function pieces(text) {
    var out = [], parts = text.replace(/\s+/g, " ").trim().match(/[^.!?;:]+[.!?;:]*\s*/g) || [];
    var buf = "";
    parts.forEach(function (p) { if ((buf + p).length > 220 && buf) { out.push(buf); buf = p; } else buf += p; });
    if (buf.trim()) out.push(buf);
    return out;
  }
  function collect() {
    var sel = window.getSelection && String(window.getSelection()).trim();
    if (sel && !root.contains(window.getSelection().anchorNode)) return pieces(sel).map(function (t) { return { text: t, el: null }; });
    var main = $("#conteudo") || document.body, items = [];
    var blocks = $$("h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dt, dd, th, td, .eyebrow, .lead", main);
    blocks.forEach(function (el) {
      if (!visible(el)) return;
      for (var a = el.parentElement; a && a !== main; a = a.parentElement) if (blocks.indexOf(a) > -1) return; // evita ler duas vezes
      var t = (el.innerText || el.textContent || "").trim();
      if (t) pieces(t).forEach(function (p) { items.push({ text: p, el: el }); });
    });
    return items;
  }
  function mark(el) {
    $$(".a11y-speaking").forEach(function (x) { x.classList.remove("a11y-speaking"); });
    if (!el) return;
    el.classList.add("a11y-speaking");
    var r = el.getBoundingClientRect();
    if (r.top < 120 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: "center", behavior: doc.classList.contains("a11y-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function setReading(on) {
    reading = on;
    readBtn.setAttribute("aria-pressed", on ? "true" : "false");
    readBar.hidden = !on;
    pauseBtn.setAttribute("aria-label", "Pausar leitura"); pauseBtn.classList.remove("is-paused");
    if (!on) mark(null);
  }
  function next() {
    if (!reading) return;
    current = queue.shift();
    if (!current) { setReading(false); say("Leitura concluída"); return; }
    var u = new SpeechSynthesisUtterance(current.text), v = voice();
    u.lang = v ? v.lang : "pt-BR"; if (v) u.voice = v; u.rate = 1;
    u.onend = next;
    u.onerror = function (e) { if (e.error !== "interrupted" && e.error !== "canceled") next(); };
    if (current.el) mark(current.el);
    synth.speak(u);
  }
  function startReading() {
    queue = collect();
    if (!queue.length) { say("Não há texto para ler nesta página"); return; }
    synth.cancel(); setReading(true); next();
  }
  function stopReading() {
    if (!synth) return;
    reading = false; queue = []; synth.cancel(); setReading(false);
  }
  if (!synth || !window.SpeechSynthesisUtterance) {
    readBtn.disabled = true;
    readBtn.title = "Leitura em voz alta indisponível neste navegador";
  } else {
    readBtn.addEventListener("click", function () {
      if (reading) { stopReading(); say("Leitura interrompida"); } else startReading();
    });
    $("[data-a11y-read-stop]", root).addEventListener("click", function () { stopReading(); say("Leitura interrompida"); readBtn.focus(); });
    pauseBtn.addEventListener("click", function () {
      if (synth.paused) { synth.resume(); pauseBtn.setAttribute("aria-label", "Pausar leitura"); pauseBtn.classList.remove("is-paused"); }
      else { synth.pause(); pauseBtn.setAttribute("aria-label", "Continuar leitura"); pauseBtn.classList.add("is-paused"); }
    });
    window.addEventListener("pagehide", function () { synth.cancel(); });
  }

  /* ---------- Libras: VLibras (Governo Federal), carregado só quando a pessoa pede ---------- */
  var VL = "https://vlibras.gov.br/app", vlLoading = false;
  function loadVLibras(cb) {
    if (window.VLibrasWidget && window.VLibrasWidget.open) { cb && cb(); return; }
    if (vlLoading) return;
    vlLoading = true;
    var s = document.createElement("script");
    s.src = VL + "/vlibras-plugin.js"; s.async = true;
    s.onload = function () {
      try { new window.VLibras.Widget(VL); } catch (e) {}
      var tries = 0;
      (function wait() {
        if (window.VLibrasWidget && window.VLibrasWidget.open) { vlLoading = false; cb && cb(); return; }
        if (++tries > 60) { vlLoading = false; say("Não foi possível iniciar o tradutor de Libras"); return; }
        setTimeout(wait, 50);
      })();
    };
    s.onerror = function () { vlLoading = false; say("Não foi possível carregar o tradutor de Libras. Verifique sua conexão."); };
    document.body.appendChild(s);
  }
  $$("[data-a11y-libras]", root).forEach(function (b) {
    b.addEventListener("click", function () {
      close(false);
      say("Abrindo o tradutor de Libras. Clique em um texto da página para traduzi-lo.");
      state.libras = true; save();
      loadVLibras(function () { window.VLibrasWidget.open(); watchVLibras(); });
    });
  });
  // Enquanto a janela do VLibras está aberta, a aba da central desce para não ficar coberta por ela
  function watchVLibras() {
    var tries = 0;
    (function find() {
      var r = document.getElementById("vlibras-app-root");
      if (!r) { if (++tries < 80) setTimeout(find, 250); return; }
      var sync = function () { doc.classList.toggle("a11y-libras-open", r.dataset.active === "true"); };
      new MutationObserver(sync).observe(r, { attributes: true, attributeFilter: ["data-active"] });
      sync();
    })();
  }
  // Se a pessoa já usou o VLibras, ele é carregado nas próximas páginas e se reabre sozinho
  if (state.libras) loadVLibras(watchVLibras);

  apply();
})();
