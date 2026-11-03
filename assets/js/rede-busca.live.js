/* Busca da rede credenciada — CONSULTA AO VIVO (igual ao sistema oficial de prod).
   Em vez do retrato estático (rede.json), cada busca consulta os endpoints de extremamedic.com
   através do proxy /rede-api/ (serve.js local; nginx em produção, pois o sistema antigo não libera CORS).
   Endpoint universal de resultados: ajax_combinada_resultado.php (plano, estado, cidade[id], bairro[id],
   especialidade[nome], estabelecimento[tipo id], nome[texto], modo). Qualificação e urgência têm endpoints próprios.
   O parsing dos blocos de resultado é o mesmo de src/rede-sync.js, portado para o navegador. */
(function () {
  "use strict";
  var app = document.querySelector("[data-rede-busca]");
  if (!app) return;
  var T = window.mgT || function (pt) { return pt; };
  var track = window.mgTrack || function () {};
  var $ = function (s, r) { return (r || app).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || app).querySelectorAll(s)); };
  var norm = function (s) { return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
  var PAGE = 20;
  var API = "/rede-api/"; // proxy same-origin para extremamedic.com/ajax/

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

  /* ---------- Parsing dos blocos (mesmo algoritmo de src/rede-sync.js) ---------- */
  var ENT = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  function clean(s) {
    return (s || "").replace(/<[^>]+>/g, " ").replace(/&(#\d+|\w+);/g, function (m, e) { return e[0] === "#" ? String.fromCharCode(+e.slice(1)) : (ENT[e] != null ? ENT[e] : m); }).replace(/\s+/g, " ").trim();
  }
  function optionsOf(html) {
    var out = [], re = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g, m;
    while ((m = re.exec(html))) out.push({ v: m[1].trim(), t: clean(m[2]) });
    return out;
  }
  function parseBlock(block) {
    var title = clean((block.match(/<h3 class="title">([\s\S]*?)<\/h3>/) || [])[1] || "").replace(/^\d+\.\s*/, "");
    if (!title || /não obteve resultado/i.test(title)) return null;
    var doc = title.match(/\(?\s*(CRM|CRO|CRP|CRN|CREFITO|COREN|CRFA|CRF|CRBM|CNPJ)\s*:?\s*([^)]*)\)?\s*$/i);
    var nome = (doc ? title.slice(0, doc.index) : title).replace(/[-\s]+$/, "").trim();
    var e = {
      nome: nome,
      registro: doc ? (doc[1].toUpperCase() + " " + doc[2].trim()).trim() : "",
      tipo: clean((block.match(/Tipo de Estabelecimento:\s*([^<]*)/i) || [])[1] || ""),
      especialidades: [],
      local: "", endereco: "", bairro: "", cep: "", fone: "", cidade: "", uf: "",
      quals: (function () { var m, set = {}, re = /qualificacao\/LOGO_\w*?_?([A-Z])\.jpg/gi; while ((m = re.exec(block))) set[m[1].toUpperCase()] = 1; return Object.keys(set); })()
    };
    var ps = (block.match(/<p[^>]*>[\s\S]*?<\/p>/g) || []).map(function (p) { return p.replace(/^<p[^>]*>/, "").replace(/<\/p>$/, ""); }).filter(function (p) { return clean(p) && !/Tipo de Estabelecimento/i.test(p); });
    var esp = null;
    for (var i = 0; i < ps.length; i++) { if (/^\s*\[[^\]]+\]\s*$/.test(clean(ps[i]))) { esp = ps[i]; break; } }
    if (esp) e.especialidades = clean(esp).slice(1, -1).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var lines = ps.filter(function (p) { return p !== esp; }).join("<br>").split(/<br\s*\/?>/i).map(clean).filter(Boolean);
    lines.forEach(function (l) {
      var m;
      if ((m = l.match(/^\[(.+)\]$/))) e.local = m[1].trim();
      else if ((m = l.match(/^(.*?)\s*-\s*CEP\.?:?\s*([\d-]+)/i))) { e.bairro = m[1].trim(); e.cep = m[2]; }
      else if ((m = l.match(/^FONE:?\s*(.*)$/i))) e.fone = m[1].trim();
      else if ((m = l.match(/^(.+?)\s*-\s*([A-Z]{2})$/i)) && !e.cidade) { e.cidade = m[1].trim().toUpperCase(); e.uf = m[2].toUpperCase(); }
      else if (!e.endereco) e.endereco = l;
    });
    return e;
  }
  function blocksOf(html) {
    return html.split(/<div class="col-lg-12"[^>]*>(?=\s*<div class="listing-bx)/).slice(1).map(parseBlock).filter(Boolean);
  }
  var inferModo = function (e) { return /CNPJ/i.test(e.registro) ? "prestador" : "profissional"; };

  /* ---------- Acesso ao proxy ---------- */
  function apiGet(pathq) {
    return fetch(API + pathq).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
  }
  // Consulta de resultado: devolve itens já com modo/urgência. knownModo força o rótulo; senão é inferido.
  function query(pathq, knownModo, urg) {
    return apiGet(pathq).then(function (html) {
      return blocksOf(html).map(function (e) { e.modo = knownModo || inferModo(e); e.urgencia = !!urg; return e; });
    });
  }
  var qs = function (o) { return Object.keys(o).map(function (k) { return k + "=" + encodeURIComponent(o[k] == null ? "" : o[k]); }).join("&"); };
  // Resultado pelo endpoint universal, nos dois modos (profissional + prestador), concatenado.
  function combinedBoth(params) {
    return Promise.all([
      query("ajax_combinada_resultado.php?" + qs(Object.assign({}, params, { modo: "medico" })), "profissional"),
      query("ajax_combinada_resultado.php?" + qs(Object.assign({}, params, { modo: "servico" })), "prestador")
    ]).then(function (r) { return r[0].concat(r[1]); });
  }

  /* ---------- Preenchimento de selects (usa o componente de dropdown via dd:refresh) ---------- */
  function fill(sel, values, placeholder, label) {
    if (!sel) return;
    var cur = sel.value, html = '<option value="">' + esc(placeholder) + "</option>";
    values.forEach(function (v) {
      var val = typeof v === "object" ? v.v : v, txt = typeof v === "object" ? v.t : (label ? label(v) : nice(v));
      html += '<option value="' + esc(val) + '">' + esc(txt) + "</option>";
    });
    sel.innerHTML = html;
    sel.value = values.some(function (v) { return (typeof v === "object" ? v.v : v) === cur; }) ? cur : "";
    sel.dispatchEvent(new Event("dd:refresh"));
  }

  /* ---------- Estado e DOM ---------- */
  var modo = "profissional"; // combinada: profissional | prestador
  var qualMap = {};          // letra -> nome (legenda das qualificações)
  var espNames = [];         // nomes de especialidade (para o datalist)
  var tipoById = {};         // id -> nome do tipo de estabelecimento
  var tipoByName = {};       // nome normalizado -> id (atalhos/pills)
  var items = [], shown = 0, busy = false;
  var list = $(".rb-list"), more = $(".rb-more"), head = $(".rb-head"), start = $(".rb-start");
  var UF = { MG: "Minas Gerais", SP: "São Paulo" };

  var C = { plano: $("#rb-plano"), tipo: $("#rb-tipo"), estado: $("#rb-estado"), cidade: $("#rb-cidade"), bairro: $("#rb-bairro"), esp: $("#rb-esp"), nome: $("#rb-nome") };
  var A = { metodo: $("#rb-metodo"), plano: $("#rba-plano"), nome: $("#rba-nome"), tipo: $("#rba-tipo"), esp: $("#rba-esp"), estado: $("#rba-estado"), cidade: $("#rba-cidade"), bairro: $("#rba-bairro"), qual: $("#rba-qual") };
  var txt = function (sel) { return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : ""; };

  function setModo(m) {
    modo = m;
    $$("[data-modo]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-modo") === m ? "true" : "false"); });
    if (C.esp.closest(".field")) C.esp.closest(".field").hidden = m !== "profissional";
  }

  /* ---------- Resultados (renderização idêntica à versão estática) ---------- */
  function card(e) {
    var tel = phones(e), addr = [nice(e.endereco), [nice(e.bairro), e.cep && "CEP " + e.cep].filter(Boolean).join(" · "), nice(e.cidade) + "/" + e.uf];
    var q = (e.quals || []).map(function (l) { var d = qualMap[l]; return '<span class="rb-q" title="' + esc(d || l) + '" aria-label="' + esc(d || l) + '">' + l + "</span>"; }).join("");
    var maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([e.endereco, e.bairro, e.cidade + " - " + e.uf, e.cep].filter(Boolean).join(", "));
    return '<li class="rb-item">' +
      '<div class="rb-item-top"><span class="rb-kind">' + (e.modo === "profissional" ? T("Profissional", "Professional") : T("Prestador", "Provider")) + (e.tipo ? " · " + esc(nice(e.tipo)) : "") + "</span>" +
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
  // dedup por nome+registro+local+cidade (resultados dos dois modos podem repetir)
  function dedup(arr) {
    var seen = {}, out = [];
    arr.forEach(function (e) { var k = [e.nome, e.registro, e.local, e.endereco, e.cidade].join("|"); if (!seen[k]) { seen[k] = 1; out.push(e); } });
    return out;
  }
  function setBusy(on) {
    busy = on;
    app.classList.toggle("is-loading", on);
    head.setAttribute("aria-busy", on ? "true" : "false");
  }
  function searching(params) {
    start.hidden = true; head.hidden = false; list.innerHTML = ""; more.hidden = true;
    head.innerHTML = '<p class="rb-count">' + T("Buscando na rede oficial…", "Searching the official network…") + "</p>";
    setBusy(true);
  }
  function fail() {
    setBusy(false);
    list.innerHTML = '<li class="rb-none">' + T("Não foi possível consultar a rede agora. Tente novamente.", "Could not query the network right now. Please try again.") + "</li>";
    head.innerHTML = '<p class="rb-count">' + T("Falha na consulta", "Query failed") + "</p>";
  }
  function show(res, params) {
    setBusy(false);
    items = dedup(res); shown = 0; list.innerHTML = "";
    start.hidden = true; head.hidden = false;
    var n = items.length;
    head.innerHTML = '<p class="rb-count"><strong>' + n + "</strong> " + (n === 1 ? T("resultado", "result") : T("resultados", "results")) + "</p>" +
      (params && params.length ? '<ul class="rb-params" aria-label="' + T("Parâmetros de busca", "Search parameters") + '">' + params.map(function (p) { return "<li><span>" + esc(p[0]) + "</span> " + esc(p[1]) + "</li>"; }).join("") + "</ul>" : "");
    if (!n) list.innerHTML = '<li class="rb-none">' + T("Nenhum resultado com esses filtros. Tente remover algum critério.", "No results with these filters. Try removing a criterion.") + "</li>";
    page();
    track("busca_rede", { params: (params || []).map(function (p) { return p[0] + ":" + p[1]; }).join("|"), resultados: n });
    if (window.matchMedia("(max-width: 1099px)").matches) head.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // executa uma promessa de busca com tratamento de loading/erro
  function run(promise, params) {
    if (busy) return;
    searching(params);
    promise.then(function (res) { show(res, params); }).catch(fail);
  }

  /* ---------- Busca combinada (resultado ao vivo pelo endpoint universal) ---------- */
  function runComb() {
    var m = modo === "profissional" ? "medico" : "servico";
    var params = [[T("Busca", "Search"), modo === "profissional" ? T("Profissional", "Professional") : T("Prestadores", "Providers")]];
    var p = { plano: C.plano.value, estado: C.estado.value, cidade: C.cidade.value, bairro: C.bairro.value, especialidade: modo === "profissional" ? C.esp.value : "", nome: C.nome.value.trim(), modo: m, estabelecimento: C.tipo.value };
    [["plano", C.plano], ["tipo", C.tipo], ["estado", C.estado], ["cidade", C.cidade], ["bairro", C.bairro], ["esp", C.esp]].forEach(function (pair) {
      var sel = pair[1]; if (sel.value && !(sel === C.esp && modo !== "profissional")) params.push([sel.closest(".field").querySelector("label").textContent, txt(sel)]);
    });
    if (p.nome) params.push([T("Nome", "Name"), p.nome]);
    run(query("ajax_combinada_resultado.php?" + qs(p), modo), params);
  }

  /* ---------- Busca avançada (um único critério) ---------- */
  function showMetodo() {
    var m = A.metodo.value;
    $$("[data-metodo]").forEach(function (g) { g.hidden = g.getAttribute("data-metodo") !== m; });
  }
  function loadCidadesAv() {
    var uf = A.estado.value;
    if (!uf) { fill(A.cidade, [], T("Todas as cidades", "All cities")); fill(A.bairro, [], T("Todos os bairros", "All districts")); return Promise.resolve(); }
    return apiGet("por-regiao-busca-cidade.php?estado=" + uf).then(function (h) {
      fill(A.cidade, optionsOf(h).filter(function (o) { return o.v && o.v !== "0"; }), T("Todas as cidades", "All cities"));
      fill(A.bairro, [], T("Todos os bairros", "All districts"));
    });
  }
  function loadBairrosAv() {
    var uf = A.estado.value, cid = A.cidade.value;
    if (!uf || !cid) { fill(A.bairro, [], T("Todos os bairros", "All districts")); return Promise.resolve(); }
    return apiGet("por-regiao-busca-bairro.php?estado=" + uf + "&cidade=" + cid).then(function (h) {
      fill(A.bairro, optionsOf(h).filter(function (o) { return o.v && o.v !== "0"; }), T("Todos os bairros", "All districts"));
    });
  }
  function runAv() {
    var m = A.metodo.value;
    if (!m) { A.metodo.focus(); return; }
    var label = function (sel) { return sel.closest(".field").querySelector("label").textContent; };
    if (m === "plano") {
      if (!A.plano.value) { A.plano.focus(); return; }
      // endpoint dedicado da isolada (igual prod): já traz profissionais + prestadores do plano
      run(query("ajax_isolada_resultado_plano.php?plano=" + encodeURIComponent(A.plano.value)), [[label(A.plano), txt(A.plano)]]);
    } else if (m === "nome") {
      var q = A.nome.value.trim(); if (!q) { A.nome.focus(); return; }
      run(combinedBoth({ nome: q }), [[T("Nome", "Name"), q]]);
    } else if (m === "tipo") {
      if (!A.tipo.value) { A.tipo.focus(); return; }
      // o endpoint universal ignora o tipo no modo profissional; o dedicado da isolada traz os prestadores do tipo (igual prod)
      run(query("ajax_isolada_resultado_tipo_estabelecimento.php?estabelecimento=" + encodeURIComponent(A.tipo.value)), [[label(A.tipo), txt(A.tipo)]]);
    } else if (m === "especialidade") {
      if (!A.esp.value) { A.esp.focus(); return; }
      run(query("ajax_isolada_resultado_especialidade.php?especialidade=" + encodeURIComponent(A.esp.value)), [[label(A.esp), txt(A.esp)]]);
    } else if (m === "regiao") {
      if (!A.estado.value) { A.estado.focus(); return; }
      var params = [[label(A.estado), txt(A.estado)]];
      if (A.cidade.value) params.push([label(A.cidade), txt(A.cidade)]);
      if (A.bairro.value) params.push([label(A.bairro), txt(A.bairro)]);
      run(combinedBoth({ estado: A.estado.value, cidade: A.cidade.value, bairro: A.bairro.value }), params);
    } else if (m === "qualificacao") {
      if (!A.qual.value) { A.qual.focus(); return; }
      run(query("ajax_isolada_resultado_qualificacao.php?qualificacao=" + encodeURIComponent(A.qual.value)), [[label(A.qual), txt(A.qual)]]);
    } else if (m === "urgencia") {
      run(query("ajax_isolada_resultado_urgencia.php", "prestador", true), [[T("Busca", "Search"), T("Urgência e emergência", "Urgent and emergency care")]]);
    }
  }

  /* ---------- Atalhos externos (pills, marquee de especialidades, mapa) ---------- */
  function openTab(id) { var t = document.getElementById(id); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }
  function toAv(metodo, set) {
    openTab("rb-tab-av");
    A.metodo.value = metodo; A.metodo.dispatchEvent(new Event("dd:refresh")); showMetodo();
    Promise.resolve(set && set()).then(runAv);
  }
  var api = {
    tipo: function (name) { var id = tipoByName[norm(name)]; toAv("tipo", function () { if (id) { A.tipo.value = id; A.tipo.dispatchEvent(new Event("dd:refresh")); } }); },
    especialidade: function (name) { toAv("especialidade", function () { A.esp.value = name; A.esp.dispatchEvent(new Event("dd:refresh")); }); },
    urgencia: function () { toAv("urgencia"); },
    cidade: function (name) { // "Extrema/MG"
      var p = name.split("/"), uf = (p[1] || "").toUpperCase(), alvo = norm(p[0]);
      toAv("regiao", function () {
        A.estado.value = uf; A.estado.dispatchEvent(new Event("dd:refresh"));
        return loadCidadesAv().then(function () {
          var opt = Array.prototype.slice.call(A.cidade.options).filter(function (o) { return norm(o.text) === alvo; })[0];
          if (opt) { A.cidade.value = opt.value; A.cidade.dispatchEvent(new Event("dd:refresh")); }
        });
      });
    }
  };
  var pending = null;
  window.mgRede = function (fn, v) {
    if (!ready) { pending = [fn, v]; return; }
    if (api[fn]) api[fn](v);
    var buscar = document.getElementById("buscar"); if (buscar) buscar.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-rb-fn]"); if (!a) return;
    e.preventDefault(); window.mgRede(a.getAttribute("data-rb-fn"), a.getAttribute("data-rb"));
  });

  /* ---------- Início: carrega as opções dos filtros ao vivo ---------- */
  var ready = false;
  function initFilters() {
    return Promise.all([
      apiGet("ajax_isolada_filtro_plano.php").then(function (h) { return optionsOf(h).filter(function (o) { return o.v && o.v !== "0"; }); }),
      apiGet("ajax_isolada_filtro_tipo_estabelecimento.php").then(function (h) { return optionsOf(h).filter(function (o) { return o.v && o.v !== "0" && o.t !== "Todos"; }); }),
      apiGet("ajax_isolada_filtro_especialidade.php").then(function (h) { return optionsOf(h).filter(function (o) { return o.v && !/^Todas$/i.test(o.v); }); }),
      apiGet("ajax_isolada_filtro_qualificacao.php").then(function (h) { return optionsOf(h).filter(function (o) { return o.v && o.v !== "0"; }); })
    ]).then(function (r) {
      var planos = r[0].map(function (o) { return { v: o.v, t: o.t }; });
      var tipos = r[1].map(function (o) { tipoById[o.v] = o.t; tipoByName[norm(o.t)] = o.v; return { v: o.v, t: nice(o.t) }; });
      var esps = r[2]; espNames = esps.map(function (o) { return o.t; });
      var quals = r[3].map(function (o) { var letra = (o.t.match(/-\s*([A-Z])\s*$/) || [])[1] || ""; var nome = o.t.replace(/\s*-\s*[A-Z]\s*$/, "").replace(/\.$/, ""); if (letra) qualMap[letra] = nice(nome); return { v: o.v, t: nice(nome) }; });
      var estados = ["MG", "SP"].map(function (u) { return { v: u, t: UF[u] }; });

      // Combinada
      fill(C.plano, planos, T("Todos os planos", "All plans"));
      fill(C.tipo, tipos, T("Todos os tipos", "All types"));
      fill(C.estado, estados, T("Todos os estados", "All states"));
      fill(C.cidade, [], T("Todas as cidades", "All cities"));
      fill(C.bairro, [], T("Todos os bairros", "All districts"));
      fill(C.esp, esps.map(function (o) { return { v: o.v, t: nice(o.t) }; }), T("Todas as especialidades", "All specialties"));
      // Avançada
      fill(A.plano, planos, T("Selecione o plano", "Select the plan"));
      fill(A.tipo, tipos, T("Selecione o tipo", "Select the type"));
      fill(A.esp, esps.map(function (o) { return { v: o.v, t: nice(o.t) }; }), T("Selecione a especialidade", "Select the specialty"));
      fill(A.estado, estados, T("Selecione o estado", "Select the state"));
      fill(A.cidade, [], T("Selecione a cidade", "Select the city"));
      fill(A.bairro, [], T("Selecione o bairro", "Select the district"));
      fill(A.qual, quals, T("Selecione a qualificação", "Select the qualification"));
      var dl = $("#rba-nomes"); if (dl) dl.innerHTML = ""; // nome é texto livre no modo ao vivo
    });
  }

  // cascata de cidade/bairro na combinada (por região, sem depender de plano)
  function loadCidadesComb() {
    var uf = C.estado.value;
    if (!uf) { fill(C.cidade, [], T("Todas as cidades", "All cities")); fill(C.bairro, [], T("Todos os bairros", "All districts")); return; }
    apiGet("por-regiao-busca-cidade.php?estado=" + uf).then(function (h) {
      fill(C.cidade, optionsOf(h).filter(function (o) { return o.v && o.v !== "0"; }), T("Todas as cidades", "All cities"));
      fill(C.bairro, [], T("Todos os bairros", "All districts"));
    });
  }
  function loadBairrosComb() {
    var uf = C.estado.value, cid = C.cidade.value;
    if (!uf || !cid) { fill(C.bairro, [], T("Todos os bairros", "All districts")); return; }
    apiGet("por-regiao-busca-bairro.php?estado=" + uf + "&cidade=" + cid).then(function (h) {
      fill(C.bairro, optionsOf(h).filter(function (o) { return o.v && o.v !== "0"; }), T("Todos os bairros", "All districts"));
    });
  }

  initFilters().then(function () {
    ready = true;
    setModo("profissional");
    var stat = $(".rb-stat"); if (stat) stat.innerHTML = T("Busca conectada ao sistema oficial — resultados ao vivo.", "Connected to the official system — live results.");
    var upd = $(".rb-updated"); if (upd) upd.textContent = T("consulta ao vivo", "live query");
    app.classList.add("is-ready");
    // deep-links por querystring (?tipo=hospital|clinica|laboratorio|especialidade · ?esp=CARDIOLOGIA · ?busca=combinada|avancada)
    var TIPO_URL = { hospital: "HOSPITAL", clinica: "CLÍNICA/CONSULTÓRIO", laboratorio: "SERVICO AUXILIAR DE DIAGNOSE E TERAPIA" };
    var sp = new URLSearchParams(location.search), t = sp.get("tipo"), espq = sp.get("esp"), busca = sp.get("busca");
    if (espq) api.especialidade(espq.toUpperCase());
    else if (TIPO_URL[t]) api.tipo(TIPO_URL[t]);
    else if (t === "especialidade") { openTab("rb-tab-av"); A.metodo.value = "especialidade"; A.metodo.dispatchEvent(new Event("dd:refresh")); showMetodo(); }
    if (busca === "avancada") openTab("rb-tab-av"); else if (busca === "combinada") openTab("rb-tab-comb");
    if (pending) { window.mgRede(pending[0], pending[1]); pending = null; }
  }).catch(function () { app.classList.add("is-error"); });

  /* ---------- Eventos ---------- */
  $$("[data-modo]").forEach(function (b) { b.addEventListener("click", function () { if (ready) setModo(b.getAttribute("data-modo")); }); });
  C.estado.addEventListener("change", function () { if (ready) loadCidadesComb(); });
  C.cidade.addEventListener("change", function () { if (ready) loadBairrosComb(); });
  A.metodo.addEventListener("change", showMetodo);
  A.estado.addEventListener("change", function () { if (ready) loadCidadesAv(); });
  A.cidade.addEventListener("change", function () { if (ready) loadBairrosAv(); });
  $("#rb-comb").addEventListener("submit", function (e) { e.preventDefault(); if (ready) runComb(); });
  $("#rb-comb").addEventListener("reset", function () { setTimeout(function () { if (ready) { setModo(modo); fill(C.cidade, [], T("Todas as cidades", "All cities")); fill(C.bairro, [], T("Todos os bairros", "All districts")); } }, 0); });
  $("#rb-av").addEventListener("submit", function (e) { e.preventDefault(); if (ready) runAv(); });
  more.addEventListener("click", page);
  // Desktop: roda do mouse sobre o painel de filtros não rola a página
  var side = $(".rb-side"), desk = window.matchMedia("(min-width: 1100px)");
  if (side) side.addEventListener("wheel", function (e) {
    if (!desk.matches) return;
    var el = e.target.closest(".dd-list") || side, d = e.deltaY;
    var noScroll = el.scrollHeight <= el.clientHeight;
    var atTop = d < 0 && el.scrollTop <= 0, atEnd = d > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if (noScroll || atTop || atEnd) e.preventDefault();
  }, { passive: false });
  showMetodo();
})();
