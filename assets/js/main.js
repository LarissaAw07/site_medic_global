/* MedicGLOBAL 2.0 — interações
   JavaScript mínimo, progressivo: tudo funciona sem JS (links e formulários),
   aqui só adicionamos conforto. */
(function () {
  "use strict";
  var doc = document.documentElement;
  doc.classList.add("js");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var norm = function (s) { return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };

  /* ---------- Analytics (GA4 / GTM via dataLayer) ---------- */
  window.dataLayer = window.dataLayer || [];
  function track(event, params) {
    var payload = Object.assign({ event: event }, params || {});
    window.dataLayer.push(payload);
  }
  window.mgTrack = track;
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-track]");
    if (el) track(el.getAttribute("data-track"), { label: (el.textContent || "").trim().slice(0, 80), href: el.getAttribute("href") || "" });
    var a = e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (/^tel:/.test(href)) track("click_telefone", { href: href });
    else if (/wa\.me|whatsapp/.test(href)) track("click_whatsapp", { href: href });
    else if (/\.pdf($|\?)/i.test(href)) track("download_documento", { href: href, name: a.getAttribute("data-doc") || "" });
  });

  /* ---------- Header ---------- */
  var header = $(".site-header");
  var dock = $(".dock");
  function onScroll() {
    var y = window.scrollY;
    if (header) header.classList.toggle("is-scrolled", y > 24);
    if (dock) dock.classList.toggle("is-visible", y > 420);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Mega menu */
  var triggers = $$(".nav-trigger[aria-controls]");
  var closeTimer;
  function closeAll(except) {
    triggers.forEach(function (t) {
      if (t === except) return;
      t.setAttribute("aria-expanded", "false");
      var p = document.getElementById(t.getAttribute("aria-controls"));
      if (p) p.classList.remove("is-open");
    });
    if (!except && header) header.classList.remove("is-open");
  }
  function open(t) {
    closeAll(t);
    t.setAttribute("aria-expanded", "true");
    var p = document.getElementById(t.getAttribute("aria-controls"));
    if (p) p.classList.add("is-open");
    header.classList.add("is-open");
  }
  triggers.forEach(function (t) {
    var panel = document.getElementById(t.getAttribute("aria-controls"));
    t.addEventListener("click", function () {
      t.getAttribute("aria-expanded") === "true" ? closeAll() : open(t);
    });
    var li = t.parentElement;
    li.addEventListener("mouseenter", function () { if (window.matchMedia("(hover: hover)").matches) { clearTimeout(closeTimer); open(t); } });
    li.addEventListener("mouseleave", function () { closeTimer = setTimeout(closeAll, 180); });
    if (panel) {
      panel.addEventListener("mouseenter", function () { clearTimeout(closeTimer); });
      panel.addEventListener("mouseleave", function () { closeTimer = setTimeout(closeAll, 180); });
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var openT = triggers.filter(function (t) { return t.getAttribute("aria-expanded") === "true"; })[0];
      closeAll(); closeSearch(); toggleDrawer(false);
      if (openT) openT.focus();
    }
  });
  document.addEventListener("click", function (e) { if (!e.target.closest(".site-header")) closeAll(); });

  /* Drawer mobile */
  var toggle = $(".menu-toggle");
  var drawer = $(".drawer");
  function toggleDrawer(force) {
    if (!toggle || !drawer) return;
    var willOpen = typeof force === "boolean" ? force : toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(willOpen));
    toggle.setAttribute("aria-label", willOpen ? "Fechar menu" : "Abrir menu");
    drawer.classList.toggle("is-open", willOpen);
    header.classList.toggle("is-open", willOpen);
    document.body.style.overflow = willOpen ? "hidden" : "";
    if (willOpen) drawer.removeAttribute("inert"); else drawer.setAttribute("inert", "");
  }
  if (toggle) toggle.addEventListener("click", function () { toggleDrawer(); });

  /* ---------- Navegação por necessidade: índice ---------- */
  var INDEX = [
    { t: "Área do Beneficiário", d: "Carteirinha, dados do plano, boletos e serviços", u: "beneficiario.html", k: "beneficiario cliente login entrar acessar area carteirinha app", tag: "Beneficiário" },
    { t: "Segunda via de boleto", d: "Emita o boleto do seu plano", u: "beneficiario.html#boleto", k: "boleto pagar pagamento mensalidade segunda via fatura", tag: "Beneficiário" },
    { t: "Encontrar atendimento", d: "Médicos, clínicas, hospitais e laboratórios", u: "rede-credenciada.html", k: "consulta medico medica rede credenciada hospital clinica laboratorio exame especialidade guia medico perto", tag: "Rede" },
    { t: "Telemedicina", d: "Fale com um profissional de saúde a distância", u: "telemedicina.html", k: "telemedicina teleconsulta online video consulta virtual falar com medico", tag: "Serviço" },
    { t: "Autorizações", d: "Consulte e solicite autorizações de procedimentos", u: "servicos.html#autorizacoes", k: "autorizacao autorizar exame procedimento guia liberacao cirurgia", tag: "Serviço" },
    { t: "Conheça os planos", d: "EMED GLOBAL BLUE 100, 200, 300 e 400", u: "planos.html", k: "planos contratar plano quero ser cliente preco valor proposta blue emed", tag: "Planos" },
    { t: "Comparar planos", d: "Abrangência e características lado a lado", u: "planos.html#comparar", k: "comparar comparativo diferenca abrangencia cidades", tag: "Planos" },
    { t: "Solicitar proposta", d: "Fale com o time comercial", u: "planos.html#contato", k: "proposta cotacao orcamento comercial vendas empresa", tag: "Planos" },
    { t: "Urgência e emergência", d: "Onde buscar atendimento imediato", u: "servicos.html#urgencia", k: "urgencia emergencia pronto socorro pronto atendimento", tag: "Serviço" },
    { t: "ABRAMGE — atendimento em trânsito", d: "Atendimento de urgência fora da sua região", u: "servicos.html#abramge", k: "abramge transito viagem fora da cidade outro estado", tag: "Serviço" },
    { t: "Programas de saúde", d: "Acompanhamento e prevenção", u: "servicos.html#programas", k: "programas saude prevencao acompanhamento cronico gestante", tag: "Serviço" },
    { t: "Aplicativo MedicGLOBAL", d: "Rede, favoritos e contato com prestadores", u: "servicos.html#aplicativo", k: "app aplicativo celular android ios baixar", tag: "Serviço" },
    { t: "Central de atendimento", d: "Telefones, WhatsApp e e-mails por setor", u: "atendimento.html", k: "atendimento telefone whatsapp email contato sac falar ajuda", tag: "Atendimento" },
    { t: "Ouvidoria", d: "Registre manifestações em segunda instância", u: "atendimento.html#ouvidoria", k: "ouvidoria reclamacao manifestacao", tag: "Atendimento" },
    { t: "Contato e endereço", d: "Onde estamos, horários e mapa", u: "contato.html", k: "endereco onde fica sede mapa horario contato", tag: "Atendimento" },
    { t: "Nossa história", d: "De Extremamedic a MedicGLOBAL", u: "medicglobal.html", k: "historia extremamedic empresa sobre quem somos institucional", tag: "Institucional" },
    { t: "Documentos e informações regulatórias", d: "ANS, IDSS, TISS, guias e manuais", u: "documentos.html", k: "documentos ans idss tiss fator qualidade cid guia manual sp sadt regulatorio rn", tag: "Documentos" },
    { t: "Prestador — guias e TISS", d: "Informações operacionais para prestadores", u: "documentos.html#tiss", k: "prestador tiss guias faturamento credenciado", tag: "Prestador" },
    { t: "Conteúdos de saúde", d: "Notícias, comunicados e artigos", u: "conteudos.html", k: "noticias blog artigos comunicados saude conteudo", tag: "Conteúdos" },
    { t: "Trabalhe conosco", d: "Envie seu currículo", u: "trabalhe-conosco.html", k: "trabalhe conosco vaga emprego curriculo carreira", tag: "Institucional" },
    { t: "Privacidade e LGPD", d: "Política de privacidade, cookies e seus direitos", u: "privacidade.html", k: "privacidade lgpd dados cookies termos encarregado dpo", tag: "Legal" }
  ];
  function searchIndex(q) {
    q = norm(q).trim();
    if (!q) return INDEX.slice(0, 7);
    var terms = q.split(/\s+/);
    return INDEX.map(function (it) {
      var hay = norm(it.t + " " + it.d + " " + it.k);
      var score = 0;
      terms.forEach(function (w) { if (hay.indexOf(w) > -1) score += norm(it.t).indexOf(w) > -1 ? 3 : 1; });
      return { it: it, s: score };
    }).filter(function (r) { return r.s > 0; }).sort(function (a, b) { return b.s - a.s; }).map(function (r) { return r.it; });
  }

  /* Busca global */
  var overlay = $(".search-overlay");
  var sInput = $("#global-search");
  var sResults = $(".search-results");
  var lastFocus;
  function renderResults(list) {
    if (!sResults) return;
    sResults.innerHTML = list.length ? list.map(function (it) {
      return '<a href="' + it.u + '"><div><strong>' + it.t + "</strong><span>" + it.d + '</span></div><span class="tag">' + it.tag + "</span></a>";
    }).join("") : '<p class="search-hint">Nada encontrado. Tente “boleto”, “consulta” ou “telemedicina” — ou <a class="link" href="atendimento.html">fale com a MedicGLOBAL</a>.</p>';
  }
  function openSearch() {
    if (!overlay) return;
    lastFocus = document.activeElement;
    overlay.classList.add("is-open"); overlay.removeAttribute("inert");
    renderResults(searchIndex(""));
    setTimeout(function () { sInput && sInput.focus(); }, 50);
    track("abrir_busca");
  }
  function closeSearch() {
    if (!overlay || !overlay.classList.contains("is-open")) return;
    overlay.classList.remove("is-open"); overlay.setAttribute("inert", "");
    if (lastFocus) lastFocus.focus();
  }
  $$("[data-open-search]").forEach(function (b) { b.addEventListener("click", openSearch); });
  if (overlay) overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSearch(); });
  if (sInput) {
    sInput.addEventListener("input", function () { renderResults(searchIndex(sInput.value)); });
    sInput.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var r = searchIndex(sInput.value)[0];
      track("busca_global", { termo: sInput.value });
      if (r) location.href = r.u;
    });
  }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
  });

  /* Busca por intenção (home) */
  $$("[data-intent]").forEach(function (form) {
    var input = $("input", form), box = $(".intent-suggest", form), active = -1, current = [];
    function draw() {
      current = searchIndex(input.value).slice(0, 5);
      box.innerHTML = current.map(function (it, i) { return '<a role="option" href="' + it.u + '"' + (i === active ? ' class="is-active" aria-selected="true"' : "") + ">" + it.t + "<span>" + it.tag + "</span></a>"; }).join("");
      box.classList.toggle("is-open", !!input.value && current.length > 0);
      input.setAttribute("aria-expanded", box.classList.contains("is-open"));
    }
    input.addEventListener("input", function () { active = -1; draw(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, current.length - 1); draw(); }
      if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { box.classList.remove("is-open"); }, 150); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var r = current[active > -1 ? active : 0] || searchIndex(input.value)[0];
      track("busca_necessidade", { termo: input.value });
      location.href = r ? r.u : "atendimento.html";
    });
  });

  /* ---------- Revelação ao rolar ---------- */
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -10% 0px", threshold: .12 }) : null;
  $$(".reveal, .steps, .t-item, [data-count]").forEach(function (el) { io ? io.observe(el) : el.classList.add("is-in"); });

  /* Contagem */
  $$("[data-count]").forEach(function (el) {
    var target = parseFloat(el.getAttribute("data-count")), suffix = el.getAttribute("data-suffix") || "", prefix = el.getAttribute("data-prefix") || "";
    var done = false;
    function run() {
      if (done) return; done = true;
      if (reduce) { el.textContent = prefix + target + suffix; return; }
      var t0 = performance.now(), dur = 1600;
      (function step(t) {
        var p = Math.min(1, (t - t0) / dur), v = Math.round(target * (1 - Math.pow(1 - p, 3)));
        el.textContent = prefix + v + suffix;
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    }
    if (!io) return run();
    new IntersectionObserver(function (en, o) { if (en[0].isIntersecting) { run(); o.disconnect(); } }, { threshold: .5 }).observe(el);
  });

  /* Timeline */
  var tl = $(".timeline"), tlBar = $(".timeline-progress");
  if (tl && tlBar) {
    var tItems = $$(".t-item", tl), tlTick = false;
    var upd = function () {
      tlTick = false;
      var r = tl.getBoundingClientRect(), vh = window.innerHeight;
      var p = Math.min(1, Math.max(0, (vh * .6 - r.top) / r.height));
      tlBar.style.height = (p * (r.height - 16)) + "px";
      /* Foco na rolagem: o item mais perto da linha de leitura fica nítido; os demais esmaecem */
      var best = null, bestD = Infinity;
      tItems.forEach(function (it) {
        var b = it.getBoundingClientRect(), c = b.top + Math.min(b.height, 160) / 2;
        var d = (c - vh * .6) / (vh * .45), ad = Math.min(1, Math.abs(d));
        it.style.setProperty("--tf", (1 - ad).toFixed(3));
        it.classList.toggle("is-past", d < 0);
        if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = it; }
      });
      tItems.forEach(function (it) { it.classList.toggle("is-active", it === best && bestD < 1); });
    };
    window.addEventListener("scroll", function () { if (!tlTick) { tlTick = true; requestAnimationFrame(upd); } }, { passive: true });
    window.addEventListener("resize", upd); upd();
  }

  /* Comparação arrastável */
  $$(".wipe").forEach(function (w) {
    var r = $("input[type=range]", w);
    var set = function (v) { w.style.setProperty("--pos", v + "%"); };
    r.addEventListener("input", function () { set(r.value); });
    set(r.value);
  });

  /* Mosaico de ícones */
  $$(".mosaic-grid").forEach(function (g) {
    var cells = $$(".has", g);
    if (reduce || !cells.length) return;
    setInterval(function () {
      cells.forEach(function (c) { c.classList.remove("lit"); });
      for (var i = 0; i < 3; i++) cells[Math.floor(Math.random() * cells.length)].classList.add("lit");
    }, 2200);
  });

  /* ---------- Filtros genéricos (planos, documentos, conteúdos, FAQ, atendimento) ---------- */
  function setupFilter(root) {
    var items = $$(root.getAttribute("data-filter-items"), document);
    var groups = {};
    var q = $("[data-filter-search]", root);
    var empty = $(root.getAttribute("data-filter-empty") || "#none-x");
    var mode = root.getAttribute("data-filter-mode") || "hide"; // hide | dim
    function apply() {
      var term = q ? norm(q.value).trim() : "";
      var shown = 0;
      items.forEach(function (it) {
        var ok = Object.keys(groups).every(function (g) {
          var v = groups[g]; if (!v || v === "all") return true;
          return (" " + (it.getAttribute("data-" + g) || "") + " ").indexOf(" " + v + " ") > -1;
        });
        if (ok && term) ok = norm(it.textContent).indexOf(term) > -1;
        if (mode === "dim") it.classList.toggle("is-dim", !ok); else it.hidden = !ok;
        if (ok) shown++;
      });
      if (empty) empty.hidden = shown > 0;
      $$("[data-filter-count]", root).forEach(function (c) { c.textContent = shown; });
    }
    $$("[data-filter-group]", root).forEach(function (btn) {
      var g = btn.getAttribute("data-filter-group");
      if (btn.getAttribute("aria-pressed") === "true") groups[g] = btn.getAttribute("data-value");
      btn.addEventListener("click", function () {
        $$('[data-filter-group="' + g + '"]', root).forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
        btn.setAttribute("aria-pressed", "true");
        groups[g] = btn.getAttribute("data-value");
        apply();
        track("filtro", { grupo: g, valor: groups[g] });
      });
    });
    if (q) q.addEventListener("input", apply);
    // contagem por categoria
    $$("[data-count-for]", root).forEach(function (c) {
      var v = c.getAttribute("data-count-for"), g = c.getAttribute("data-count-group");
      c.textContent = v === "all" ? items.length : items.filter(function (it) { return (" " + it.getAttribute("data-" + g) + " ").indexOf(" " + v + " ") > -1; }).length;
    });
    // pré-seleção pelo hash (#cat=...)
    var m = location.hash.match(/(\w+)=([\w-]+)/);
    var anc = $('[data-anchor="' + location.hash.slice(1) + '"]', root);
    if (anc) { anc.click(); setTimeout(function () { root.scrollIntoView(); }, 50); }
    if (m) { var b = $('[data-filter-group="' + m[1] + '"][data-value="' + m[2] + '"]', root); if (b) b.click(); }
    apply();
  }
  $$("[data-filter]").forEach(setupFilter);

  /* Tabs acessíveis */
  $$(".tabs").forEach(function (t) {
    var tabs = $$("[role=tab]", t);
    function sel(tab) {
      tabs.forEach(function (x) {
        var on = x === tab;
        x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1;
        document.getElementById(x.getAttribute("aria-controls")).hidden = !on;
      });
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { sel(tab); });
      tab.addEventListener("keydown", function (e) {
        var n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (n) { var nx = tabs[(i + n + tabs.length) % tabs.length]; sel(nx); nx.focus(); }
      });
    });
  });

  /* Subnav ativa */
  var sub = $$(".subnav a[href^='#']");
  if (sub.length && io) {
    var so = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (e.isIntersecting) sub.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id); });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    sub.forEach(function (a) { var s = document.getElementById(a.getAttribute("href").slice(1)); if (s) so.observe(s); });
  }

  /* Carrossel de fotos (contato) */
  $$("[data-carousel]").forEach(function (c) {
    var imgs = $$("img", c), i = 0, out = $("[data-carousel-index]", c);
    function go(n) {
      imgs[i].classList.remove("is-active");
      i = (n + imgs.length) % imgs.length;
      imgs[i].classList.add("is-active");
      if (out) out.textContent = String(i + 1).padStart(2, "0");
    }
    $$("[data-carousel-prev]", c).forEach(function (b) { b.addEventListener("click", function () { go(i - 1); }); });
    $$("[data-carousel-next]", c).forEach(function (b) { b.addEventListener("click", function () { go(i + 1); }); });
  });

  /* Carrossel do hero (home): troca a cada 8s, inclusive com o cursor sobre o banner.
     Os traços ficam sobre a imagem de cada slide (uma cópia por slide, todas sincronizadas).
     Só pausa enquanto o foco do teclado está dentro do banner, para não trocar o conteúdo durante a leitura. */
  $$("[data-hero-slider]").forEach(function (s) {
    var slides = $$(".hero-slide", s), dots = $$("[data-slide-to]", s);
    var i = 0, timer = null, focused = false;
    function go(n) {
      i = (n + slides.length) % slides.length;
      slides.forEach(function (el, k) {
        var on = k === i;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-hidden", on ? "false" : "true");
        if ("inert" in el) el.inert = !on;
      });
      dots.forEach(function (d) { if (+d.getAttribute("data-slide-to") === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
    }
    function schedule() {
      clearTimeout(timer);
      if (!reduce && !focused) timer = setTimeout(function () { go(i + 1); schedule(); }, 8000);
    }
    dots.forEach(function (d) {
      d.addEventListener("click", function () {
        var n = +d.getAttribute("data-slide-to"), hadFocus = document.activeElement === d;
        go(n); schedule();
        // O foco passa para o traço equivalente no slide que entrou
        if (hadFocus) { var t = $('[data-slide-to="' + n + '"]', slides[i]); if (t) t.focus(); }
      });
    });
    s.addEventListener("focusin", function () { focused = true; schedule(); });
    s.addEventListener("focusout", function (e) { if (!s.contains(e.relatedTarget)) { focused = false; schedule(); } });
    go(0);
    schedule();
  });

  /* ---------- Formulários (validação acessível + LGPD) ---------- */
  $$("form[data-validate]").forEach(function (f) {
    f.setAttribute("novalidate", "");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = true, first;
      $$("[required]", f).forEach(function (field) {
        var valid = field.type === "checkbox" ? field.checked : field.checkValidity() && field.value.trim() !== "";
        field.setAttribute("aria-invalid", String(!valid));
        var err = document.getElementById(field.getAttribute("aria-describedby") && field.getAttribute("aria-describedby").split(" ").filter(function (id) { return /-err$/.test(id); })[0]);
        if (err) err.classList.toggle("is-visible", !valid);
        if (!valid) { ok = false; first = first || field; }
      });
      if (!ok) { first.focus(); return; }
      var name = f.getAttribute("data-validate");
      track("envio_formulario", { formulario: name });
      // Integração: substituir por envio real (endpoint/CRM) após validação jurídica e de LGPD.
      var okBox = $(".form-ok", f);
      if (okBox) { okBox.classList.add("is-visible"); okBox.focus(); }
      f.reset();
    });
  });

  /* Dropdown no padrão do site (Rede de cuidado da home). O <select> original continua no
     formulário (oculto) e recebe o valor; em telas de toque fica a lista nativa do aparelho. */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) $$("select[data-dropdown]").forEach(function (sel) {
    var field = sel.parentNode, opts = Array.prototype.slice.call(sel.options), active = sel.selectedIndex, typed = "", typedT;
    var btn = document.createElement("button"), list = document.createElement("ul"), lbl = $("label[for='" + sel.id + "']", field);
    btn.type = "button"; btn.className = "dd-btn"; btn.id = sel.id + "-dd";
    btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", sel.id + "-list");
    list.className = "dd-list"; list.id = sel.id + "-list"; list.setAttribute("role", "listbox"); list.tabIndex = -1;
    if (lbl) { lbl.id = lbl.id || sel.id + "-lbl"; lbl.htmlFor = btn.id; list.setAttribute("aria-labelledby", lbl.id); btn.setAttribute("aria-labelledby", lbl.id + " " + btn.id); }
    opts.forEach(function (o, k) {
      var li = document.createElement("li");
      li.id = sel.id + "-opt-" + k; li.setAttribute("role", "option"); li.textContent = o.text;
      li.addEventListener("mousedown", function (e) { e.preventDefault(); });
      li.addEventListener("click", function () { choose(k); close(); btn.focus(); });
      li.addEventListener("mousemove", function () { setActive(k); });
      list.appendChild(li);
    });
    var items = $$("li", list);
    function render() {
      btn.textContent = opts[sel.selectedIndex].text;
      items.forEach(function (li, k) { li.setAttribute("aria-selected", k === sel.selectedIndex ? "true" : "false"); });
    }
    function setActive(k) {
      active = Math.max(0, Math.min(items.length - 1, k));
      items.forEach(function (li, j) { li.classList.toggle("is-active", j === active); });
      btn.setAttribute("aria-activedescendant", items[active].id);
      items[active].scrollIntoView({ block: "nearest" });
    }
    function choose(k) {
      if (sel.selectedIndex !== k) { sel.selectedIndex = k; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      render();
    }
    function isOpen() { return field.classList.contains("is-open"); }
    function open() {
      $$(".field-dark.is-open").forEach(function (f) { if (f !== field) f.classList.remove("is-open"); });
      field.classList.add("is-open"); btn.setAttribute("aria-expanded", "true"); setActive(sel.selectedIndex);
    }
    function close() { field.classList.remove("is-open"); btn.setAttribute("aria-expanded", "false"); btn.removeAttribute("aria-activedescendant"); }
    btn.addEventListener("click", function () { isOpen() ? close() : open(); });
    btn.addEventListener("keydown", function (e) {
      var k = e.key;
      if (!isOpen()) {
        if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") { e.preventDefault(); open(); }
        return;
      }
      if (k === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (k === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (k === "Home") { e.preventDefault(); setActive(0); }
      else if (k === "End") { e.preventDefault(); setActive(items.length - 1); }
      else if (k === "Enter" || k === " ") { e.preventDefault(); choose(active); close(); }
      else if (k === "Escape") { e.preventDefault(); close(); }
      else if (k === "Tab") { close(); }
      else if (k.length === 1) {
        // Digitar letras leva à primeira opção que começa com elas
        clearTimeout(typedT); typed += norm(k); typedT = setTimeout(function () { typed = ""; }, 600);
        for (var j = 0; j < opts.length; j++) if (norm(opts[j].text).indexOf(typed) === 0) { setActive(j); break; }
      }
    });
    document.addEventListener("click", function (e) { if (isOpen() && !field.contains(e.target)) close(); });
    sel.addEventListener("change", render);
    sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
    field.classList.add("has-dd");
    field.appendChild(btn); field.appendChild(list);
    render();
  });

  /* Busca na rede (home e página da rede) */
  $$("form[data-rede]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      var data = {};
      $$("input, select", f).forEach(function (i) { if (i.name) data[i.name] = i.value; });
      track("busca_rede", data);
      var ext = f.getAttribute("data-external");
      if (ext) { e.preventDefault(); window.open(ext, "_blank", "noopener"); }
    });
  });

  /* Tipo de atendimento (pills que preenchem um campo oculto) */
  $$("[data-pill-target]").forEach(function (wrap) {
    var input = document.getElementById(wrap.getAttribute("data-pill-target"));
    $$(".pill", wrap).forEach(function (p) {
      p.addEventListener("click", function () {
        $$(".pill", wrap).forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        p.setAttribute("aria-pressed", "true");
        if (input) input.value = p.getAttribute("data-value");
      });
    });
  });

  /* ---------- Consentimento de cookies (LGPD) ---------- */
  var cookie = $(".cookie");
  var KEY = "mg-consent";
  function getConsent() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function applyConsent(v) {
    window.dataLayer.push({ event: "consent_update", analytics_storage: v === "all" ? "granted" : "denied" });
    // GTM: carregar o container somente após consentimento.
    // if (v === "all") { (function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-XXXXXXX'); }
  }
  var c = getConsent();
  if (c) applyConsent(c); else if (cookie) cookie.classList.add("is-visible");
  $$("[data-consent]").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-consent");
      setConsent(v); applyConsent(v);
      if (cookie) cookie.classList.remove("is-visible");
    });
  });
  $$("[data-cookie-prefs]").forEach(function (b) { b.addEventListener("click", function () { cookie && cookie.classList.add("is-visible"); }); });

  /* Pré-preenchimento por parâmetro de URL (ex.: ?plano=BLUE%20300, ?tipo=hospital) */
  try {
    new URLSearchParams(location.search).forEach(function (v, k) {
      $('[name="' + k + '"]').forEach(function (f) { if (f.tagName === 'SELECT' || f.tagName === 'INPUT') f.value = v; });
      $('[data-pill-target="' + k + '"] .pill[data-value="' + v + '"]').forEach(function (b) { b.click(); });
    });
  } catch (e) {}

  /* Ano no rodapé */
  $$("[data-year]").forEach(function (y) { y.textContent = new Date().getFullYear(); });
})();
