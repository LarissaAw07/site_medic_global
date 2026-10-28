/* Busca da rede credenciada (Busca combinada e Busca avançada, no molde do sistema antigo).
   Os dados vêm de assets/data/rede.json, gerado por src/rede-sync.js a partir do sistema oficial. */
(function () {
  "use strict";
  var app = document.querySelector("[data-rede-busca]");
  if (!app) return;
  var T = window.mgT || function (pt) { return pt; };
  var $ = function (s, r) { return (r || app).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || app).querySelectorAll(s)); };
  var norm = function (s) { return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
  var track = window.mgTrack || function () {};
  var PAGE = 20;

  /* ---------- Texto: o sistema antigo grava tudo em maiúsculas e sem acento ---------- */
  var ACC = {
    sao: "são", joao: "joão", jose: "josé", simoes: "simões", capitao: "capitão", goncalves: "gonçalves", magalhaes: "magalhães",
    guimaraes: "guimarães", assuncao: "assunção", ribeirao: "ribeirão", medicas: "médicas", medicos: "médicos", sebastiao: "sebastião", conceicao: "conceição", antonio: "antônio", praca: "praça",
    braganca: "bragança", itajuba: "itajubá", paraisopolis: "paraisópolis", cambui: "cambuí", ipuiuna: "ipuiúna", sapucai: "sapucaí",
    cirurgica: "cirúrgica", cirurgico: "cirúrgico", pediatrica: "pediátrica", bariatrica: "bariátrica", cardiaca: "cardíaca", cabeca: "cabeça",
    toracica: "torácica", clinica: "clínica", clinicas: "clínicas", clinico: "clínico", plastica: "plástica", medica: "médica", medico: "médico",
    diagnostica: "diagnóstica", audiometricos: "audiométricos", respiratoria: "respiratória", urologica: "urológica", familia: "família",
    nutricao: "nutrição", infancia: "infância", adolescencia: "adolescência", ergometrico: "ergométrico", morbida: "mórbida",
    urodinamica: "urodinâmica", obstetricia: "obstetrícia", diagnostico: "diagnóstico", saude: "saúde", laboratorio: "laboratório",
    analises: "análises", odontologica: "odontológica", farmacia: "farmácia", nucleo: "núcleo", servico: "serviço", servicos: "serviços", consultorio: "consultório", pediasuit: "PediaSuit", aba: "ABA"
  };
  var SMALL = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, em: 1, a: 1, o: 1, para: 1, com: 1 };
  function nice(s) {
    if (!s) return "";
    if (/^[A-Z]\.[A-Z.]+$/.test(s)) return s; // siglas como M.A.P.A
    return s.toLowerCase().replace(/[^\s\/()\-]+/g, function (w, i) {
      var b = norm(w), r = ACC[b] || w;
      if (r !== r.toLowerCase()) return r;
      if (i && SMALL[b]) return r;
      return r.charAt(0).toUpperCase() + r.slice(1);
    });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // Telefones: vêm só com dígitos, às vezes dois separados por " - " e às vezes sem DDD
  function phones(e) {
    var ddd = e.uf === "SP" ? "11" : "35", seen = {};
    return (e.fone || "").split(/\s+-\s+|\//).map(function (p) { return p.replace(/\D/g, ""); }).filter(function (d) {
      if (d.length < 8 || seen[d]) return false; seen[d] = 1; return true;
    }).map(function (d) {
      if (d.length === 8 || d.length === 9) d = ddd + d;
      var label = /^0800/.test(d) ? d.replace(/^(\d{4})(\d{3})(\d+)$/, "$1 $2 $3")
        : d.length === 11 ? d.replace(/^(\d{2})(\d)(\d{4})(\d{4})$/, "($1) $2 $3-$4")
        : d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
      return { label: label, tel: "tel:" + (/^0800/.test(d) ? d : "+55" + d) };
    });
  }

  /* ---------- Estado ---------- */
  var DB = null, items = [], shown = 0, modo = "profissional";
  var list = $(".rb-list"), more = $(".rb-more"), head = $(".rb-head"), start = $(".rb-start");
  var planoNome = {};

  function fill(sel, values, placeholder, label) {
    if (!sel) return;
    var cur = sel.value, html = '<option value="">' + esc(placeholder) + "</option>";
    values.forEach(function (v) { var val = typeof v === "object" ? v.v : v, txt = typeof v === "object" ? v.t : (label ? label(v) : nice(v)); html += '<option value="' + esc(val) + '">' + esc(txt) + "</option>"; });
    sel.innerHTML = html;
    sel.value = values.some(function (v) { return (typeof v === "object" ? v.v : v) === cur; }) ? cur : "";
    sel.dispatchEvent(new Event("dd:refresh"));
  }
  function uniq(arr, fn) {
    var m = {}; arr.forEach(function (e) { [].concat(fn(e)).forEach(function (v) { if (v) m[v] = 1; }); });
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });
  }
  var UF = { MG: "Minas Gerais", SP: "São Paulo" };
  var hasPlano = function (e, p) { return !p || !e.planos || e.planos.indexOf(p) > -1; };
  var cidadeKey = function (e) { return e.cidade + "/" + e.uf; };
  var cidadeLabel = function (v) { var p = v.split("/"); return nice(p[0]) + "/" + p[1]; };

  /* ---------- Busca combinada: cada filtro limita as opções dos seguintes ---------- */
  var C = {
    plano: $("#rb-plano"), tipo: $("#rb-tipo"), estado: $("#rb-estado"), cidade: $("#rb-cidade"),
    bairro: $("#rb-bairro"), esp: $("#rb-esp"), nome: $("#rb-nome")
  };
  var ORDER = ["plano", "tipo", "estado", "cidade", "bairro", "esp"];
  var TEST = {
    plano: function (e, v) { return hasPlano(e, v); },
    tipo: function (e, v) { return e.tipo === v; },
    estado: function (e, v) { return e.uf === v; },
    cidade: function (e, v) { return cidadeKey(e) === v; },
    bairro: function (e, v) { return e.bairro === v; },
    esp: function (e, v) { return e.especialidades.indexOf(v) > -1; }
  };
  function combBase(upTo) {
    return DB.itens.filter(function (e) {
      if (e.modo !== modo) return false;
      for (var i = 0; i < upTo; i++) { var k = ORDER[i], v = C[k].value; if (v && !TEST[k](e, v)) return false; }
      return true;
    });
  }
  function cascade() {
    fill(C.tipo, uniq(combBase(1), function (e) { return e.tipo; }), T("Todos os tipos", "All types"));
    fill(C.estado, uniq(combBase(2), function (e) { return e.uf; }).map(function (u) { return { v: u, t: UF[u] || u }; }), T("Todos os estados", "All states"));
    fill(C.cidade, uniq(combBase(3), cidadeKey), T("Todas as cidades", "All cities"), cidadeLabel);
    fill(C.bairro, uniq(combBase(4), function (e) { return e.bairro; }), T("Todos os bairros", "All districts"));
    fill(C.esp, uniq(combBase(5), function (e) { return e.especialidades; }), T("Todas as especialidades", "All specialties"));
  }
  function setModo(m) {
    modo = m;
    $$("[data-modo]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-modo") === m ? "true" : "false"); });
    C.esp.closest(".field").hidden = m !== "profissional";
    cascade();
  }

  /* ---------- Busca avançada: um único critério ---------- */
  var A = {
    metodo: $("#rb-metodo"), plano: $("#rba-plano"), nome: $("#rba-nome"), tipo: $("#rba-tipo"), esp: $("#rba-esp"),
    estado: $("#rba-estado"), cidade: $("#rba-cidade"), bairro: $("#rba-bairro"), qual: $("#rba-qual")
  };
  function showMetodo() {
    var m = A.metodo.value;
    $$("[data-metodo]").forEach(function (g) { g.hidden = g.getAttribute("data-metodo") !== m; });
  }
  function regiao() {
    var est = A.estado.value;
    fill(A.cidade, uniq(DB.itens.filter(function (e) { return !est || e.uf === est; }), cidadeKey), T("Todas as cidades", "All cities"), cidadeLabel);
    var cid = A.cidade.value;
    fill(A.bairro, uniq(DB.itens.filter(function (e) { return (!est || e.uf === est) && (!cid || cidadeKey(e) === cid); }), function (e) { return e.bairro; }), T("Todos os bairros", "All districts"));
  }

  /* ---------- Resultados ---------- */
  function card(e) {
    var tel = phones(e), addr = [nice(e.endereco), [nice(e.bairro), e.cep && "CEP " + e.cep].filter(Boolean).join(" · "), nice(e.cidade) + "/" + e.uf];
    var q = (e.quals || []).map(function (l) { var d = DB.qualMap[l]; return '<span class="rb-q" title="' + esc(d || l) + '" aria-label="' + esc(d || l) + '">' + l + "</span>"; }).join("");
    var maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([e.endereco, e.bairro, e.cidade + " - " + e.uf, e.cep].filter(Boolean).join(", "));
    return '<li class="rb-item">' +
      '<div class="rb-item-top"><span class="rb-kind">' + (e.modo === "profissional" ? T("Profissional", "Professional") : T("Prestador", "Provider")) + " · " + esc(nice(e.tipo)) + "</span>" +
      (e.urgencia ? '<span class="badge rb-urg">' + T("Urgência e emergência", "Urgent and emergency care") + "</span>" : "") + (q ? '<span class="rb-qs">' + q + "</span>" : "") + "</div>" +
      "<h3>" + esc(nice(e.nome)) + "</h3>" + (e.registro ? '<p class="rb-reg">' + esc(e.registro) + "</p>" : "") +
      (e.especialidades.length ? '<p class="rb-esp">' + e.especialidades.map(function (s) { return esc(nice(s)); }).join(" · ") + "</p>" : "") +
      '<p class="rb-addr">' + (e.local ? "<strong>" + esc(nice(e.local)) + "</strong><br>" : "") + addr.filter(Boolean).map(esc).join("<br>") + "</p>" +
      '<div class="rb-actions"><a class="btn btn--sm" href="' + maps + '" target="_blank" rel="noopener">' + T("Como chegar", "Directions") + "</a>" +
      tel.map(function (p) { return '<a class="btn btn--ghost btn--sm" href="' + p.tel + '" data-track="click_telefone">' + esc(p.label) + "</a>"; }).join("") + "</div></li>";
  }
  function page() {
    var next = items.slice(shown, shown + PAGE);
    list.insertAdjacentHTML("beforeend", next.map(card).join(""));
    shown += next.length;
    more.hidden = shown >= items.length;
    more.textContent = T("Carregar mais", "Load more") + " (" + (items.length - shown) + ")";
  }
  function show(res, params) {
    items = res; shown = 0; list.innerHTML = "";
    start.hidden = true;
    var n = res.length;
    head.hidden = false;
    head.innerHTML = '<p class="rb-count"><strong>' + n + "</strong> " + (n === 1 ? T("resultado", "result") : T("resultados", "results")) + "</p>" +
      (params.length ? '<ul class="rb-params" aria-label="' + T("Parâmetros de busca", "Search parameters") + '">' + params.map(function (p) { return "<li><span>" + esc(p[0]) + "</span> " + esc(p[1]) + "</li>"; }).join("") + "</ul>" : "");
    if (!n) list.innerHTML = '<li class="rb-none">' + T("Nenhum resultado com esses filtros. Tente remover algum critério.", "No results with these filters. Try removing a criterion.") + "</li>";
    page();
    track("busca_rede", { params: params.map(function (p) { return p[0] + ":" + p[1]; }).join("|"), resultados: n });
    if (window.matchMedia("(max-width: 1099px)").matches) head.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  var txt = function (sel) { return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : ""; };
  function runComb() {
    var q = norm(C.nome.value.trim()), base = combBase(ORDER.length);
    var res = q ? base.filter(function (e) { return norm(e.nome + " " + e.local).indexOf(q) > -1; }) : base;
    var params = [[T("Busca", "Search"), modo === "profissional" ? T("Profissional", "Professional") : T("Prestadores", "Providers")]];
    ORDER.forEach(function (k) { if (C[k].value) params.push([C[k].closest(".field").querySelector("label").textContent, txt(C[k])]); });
    if (q) params.push([T("Nome", "Name"), C.nome.value.trim()]);
    show(res, params);
  }
  function runAv() {
    var m = A.metodo.value, res = DB.itens, params = [];
    var label = function (sel) { return sel.closest(".field").querySelector("label").textContent; };
    if (m === "plano" && A.plano.value) { res = res.filter(function (e) { return hasPlano(e, A.plano.value); }); params.push([label(A.plano), txt(A.plano)]); }
    if (m === "nome") {
      var q = norm(A.nome.value.trim());
      if (q) { res = res.filter(function (e) { return norm(e.nome + " " + e.local).indexOf(q) > -1; }); params.push([label(A.nome), A.nome.value.trim()]); }
    }
    if (m === "tipo" && A.tipo.value) { res = res.filter(function (e) { return e.tipo === A.tipo.value; }); params.push([label(A.tipo), txt(A.tipo)]); }
    if (m === "especialidade" && A.esp.value) { res = res.filter(function (e) { return e.especialidades.indexOf(A.esp.value) > -1; }); params.push([label(A.esp), txt(A.esp)]); }
    if (m === "regiao") {
      [A.estado, A.cidade, A.bairro].forEach(function (s, i) {
        if (!s.value) return;
        res = res.filter(function (e) { return i === 0 ? e.uf === s.value : i === 1 ? cidadeKey(e) === s.value : e.bairro === s.value; });
        params.push([label(s), txt(s)]);
      });
    }
    if (m === "qualificacao" && A.qual.value) { res = res.filter(function (e) { return (e.quals || []).indexOf(A.qual.value) > -1; }); params.push([label(A.qual), txt(A.qual)]); }
    if (m === "urgencia") { res = res.filter(function (e) { return e.urgencia; }); params.push([T("Busca", "Search"), T("Urgência e emergência", "Urgent and emergency care")]); }
    if (!m) { A.metodo.focus(); return; }
    show(res, params);
  }

  /* ---------- Atalhos externos (links ?tipo=, pílulas de especialidade, mapa) ---------- */
  var TIPO_URL = { hospital: "HOSPITAL", clinica: "CLÍNICA/CONSULTÓRIO", laboratorio: "SERVICO AUXILIAR DE DIAGNOSE E TERAPIA" };
  function openTab(id) { var t = document.getElementById(id); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }
  function av(metodo, set) {
    openTab("rb-tab-av");
    A.metodo.value = metodo; A.metodo.dispatchEvent(new Event("dd:refresh")); showMetodo();
    if (set) set();
    runAv();
  }
  var api = {
    tipo: function (v) { av("tipo", function () { A.tipo.value = v; A.tipo.dispatchEvent(new Event("dd:refresh")); }); },
    especialidade: function (v) { av("especialidade", function () { A.esp.value = v; A.esp.dispatchEvent(new Event("dd:refresh")); }); },
    urgencia: function () { av("urgencia"); },
    cidade: function (name) { // "Extrema/MG"
      var p = name.split("/"), key = DB.itens.map(cidadeKey).filter(function (k) { return norm(k) === norm(p[0]) + "/" + norm(p[1]); })[0];
      if (!key) return;
      av("regiao", function () { A.estado.value = p[1]; regiao(); A.cidade.value = key; regiao(); [A.estado, A.cidade].forEach(function (s) { s.dispatchEvent(new Event("dd:refresh")); }); });
    }
  };
  window.mgRede = function (fn, v) { if (!DB) { pending = [fn, v]; return; } if (api[fn]) api[fn](v); document.getElementById("buscar").scrollIntoView({ behavior: "smooth", block: "start" }); };
  var pending = null;
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-rb-fn]"); if (!a) return;
    e.preventDefault(); window.mgRede(a.getAttribute("data-rb-fn"), a.getAttribute("data-rb"));
  });

  /* ---------- Início ---------- */
  var src = (document.currentScript && document.currentScript.src || "").replace(/js\/rede-busca\.js.*$/, "data/rede.json") || "assets/data/rede.json";
  fetch(src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    DB = d; DB.qualMap = {};
    d.qualificacoes.forEach(function (q) { DB.qualMap[q.letra] = nice(q.nome); });
    d.planos.forEach(function (p) { planoNome[p.id] = p.nome; });
    var planos = d.planos.map(function (p) { return { v: p.id, t: p.nome }; });
    fill(C.plano, planos, T("Todos os planos", "All plans"));
    fill(A.plano, planos, T("Selecione o plano", "Select the plan"));
    fill(A.tipo, uniq(d.itens, function (e) { return e.tipo; }), T("Selecione o tipo", "Select the type"));
    fill(A.esp, uniq(d.itens, function (e) { return e.especialidades; }), T("Selecione a especialidade", "Select the specialty"));
    fill(A.estado, ["MG", "SP"].map(function (u) { return { v: u, t: UF[u] }; }), T("Todos os estados", "All states"));
    fill(A.qual, d.qualificacoes.map(function (q) { return { v: q.letra, t: nice(q.nome) }; }), T("Selecione a qualificação", "Select the qualification"));
    var dl = $("#rba-nomes"); if (dl) dl.innerHTML = uniq(d.itens, function (e) { return e.nome; }).map(function (n) { return '<option value="' + esc(nice(n)) + '">'; }).join("");
    regiao(); setModo("profissional");
    var n = function (m) { return d.itens.filter(function (e) { return e.modo === m; }).length; };
    var stat = $(".rb-stat"); if (stat) stat.innerHTML = T("<strong>" + n("profissional") + "</strong> profissionais e <strong>" + n("prestador") + "</strong> prestadores em <strong>" + uniq(d.itens, cidadeKey).length + "</strong> cidades.", "<strong>" + n("profissional") + "</strong> professionals and <strong>" + n("prestador") + "</strong> providers in <strong>" + uniq(d.itens, cidadeKey).length + "</strong> cities.");
    var upd = $(".rb-updated"); if (upd) upd.textContent = d.atualizado.split("-").reverse().join("/");
    app.classList.add("is-ready");
    // links vindos de outras páginas: ?tipo=hospital|clinica|laboratorio|profissional|especialidade · ?esp=CARDIOLOGIA
    var qs = new URLSearchParams(location.search), t = qs.get("tipo"), esp = qs.get("esp");
    if (esp) api.especialidade(esp.toUpperCase());
    else if (TIPO_URL[t]) api.tipo(TIPO_URL[t]);
    else if (t === "especialidade") { openTab("rb-tab-av"); A.metodo.value = "especialidade"; A.metodo.dispatchEvent(new Event("dd:refresh")); showMetodo(); }
    if (pending) { window.mgRede(pending[0], pending[1]); pending = null; }
  }).catch(function () {
    app.classList.add("is-error");
  });

  $$("[data-modo]").forEach(function (b) { b.addEventListener("click", function () { if (DB) setModo(b.getAttribute("data-modo")); }); });
  ORDER.forEach(function (k, i) { C[k].addEventListener("change", function () { if (DB && i < ORDER.length - 1) cascade(); }); });
  A.metodo.addEventListener("change", showMetodo);
  A.estado.addEventListener("change", function () { A.cidade.value = ""; regiao(); });
  A.cidade.addEventListener("change", regiao);
  $("#rb-comb").addEventListener("submit", function (e) { e.preventDefault(); if (DB) runComb(); });
  $("#rb-comb").addEventListener("reset", function () { setTimeout(function () { if (DB) { setModo(modo); } }, 0); });
  $("#rb-av").addEventListener("submit", function (e) { e.preventDefault(); if (DB) runAv(); });
  more.addEventListener("click", page);
  // Desktop: com o mouse sobre os filtros, a roda rola só o painel (ou a lista aberta) e nunca a página/resultados
  var side = $(".rb-side"), desk = window.matchMedia("(min-width: 1100px)");
  side.addEventListener("wheel", function (e) {
    if (!desk.matches) return;
    var el = e.target.closest(".dd-list") || side, d = e.deltaY;
    var noScroll = el.scrollHeight <= el.clientHeight;
    var atTop = d < 0 && el.scrollTop <= 0, atEnd = d > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if (noScroll || atTop || atEnd) e.preventDefault();
  }, { passive: false });
  // Lista aberta perto do fim do painel: rola o painel até ela ficar visível
  side.addEventListener("click", function (e) {
    var btn = e.target.closest(".dd-btn"); if (!btn || !desk.matches) return;
    requestAnimationFrame(function () { var l = btn.parentNode.querySelector(".dd-list"); if (btn.getAttribute("aria-expanded") === "true" && l) l.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
  });
  showMetodo();
})();
