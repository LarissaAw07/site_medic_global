/* Guia médico (igual a extremamedic.com/manual): Tipo de guia → Estado → Cidade → "Visualizar manual".
   Cidades carregadas AO VIVO (manual/buscacidade.php) e o manual gerado AO VIVO (manual.php), tudo via
   proxy same-origin /guia-api/ (serve.js local; nginx em produção) — o sistema antigo não libera CORS.

   O manual.php oficial só gera guia de UMA cidade (cidade=Todas/estado=Todos vêm vazios da origem). Para
   permitir "Todas as cidades" e "Todos os estados", agregamos no cliente: buscamos o manual de cada cidade,
   extraímos o bloco (título da cidade + conteúdo) e montamos um documento único (uma capa, os blocos de todas
   as cidades, uma legenda e um rodapé), exibido no <iframe> via srcdoc. */
(function () {
  "use strict";
  var app = document.querySelector("[data-guia-medico]");
  var manual = document.querySelector("[data-gm-manual]");
  if (!app || !manual) return;
  var API = "/guia-api/";
  var ALL = "__TODAS__"; // valor da opção "Todas as cidades"

  var tipos = app.querySelectorAll('input[name="tipo"]'), estado = app.querySelector("#gm-estado"), cidade = app.querySelector("#gm-cidade");
  var go = app.querySelector(".gm-go");
  var frame = manual.querySelector(".gm-frame"), load = manual.querySelector(".gm-frame-load");
  var titleEl = manual.querySelector(".gm-manual-t"), printBtn = manual.querySelector(".gm-print"), newtabBtn = manual.querySelector(".gm-newtab");

  var txt = function (sel) { return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : ""; };
  var refresh = function (sel) { sel.dispatchEvent(new Event("dd:refresh")); };
  var tipoSel = function () { return app.querySelector('input[name="tipo"]:checked'); };
  var step = function (k, done) { var li = app.querySelector('[data-step="' + k + '"]'); if (li) li.classList.toggle("is-done", !!done); };
  var SMALL = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1 };
  function titleCase(s) {
    return (s || "").toLowerCase().replace(/[^\s/\-]+/g, function (w, i) { return i && SMALL[w] ? w : w.charAt(0).toUpperCase() + w.slice(1); });
  }

  /* ---------- Cidades (ao vivo, com cache por estado) ---------- */
  var CITY_CACHE = {};
  function fetchCities(uf) {
    if (CITY_CACHE[uf]) return Promise.resolve(CITY_CACHE[uf]);
    return fetch(API + "buscacidade.php?estado=" + encodeURIComponent(uf)).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (html) {
      var out = [], re = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g, m;
      while ((m = re.exec(html))) if (/^\d+$/.test(m[1].trim())) out.push({ estado: uf, id: m[1].trim(), nome: titleCase(m[2].replace(/\s+/g, " ").trim()) });
      CITY_CACHE[uf] = out; return out;
    });
  }
  function fillCidades() {
    var uf = estado.value;
    if (!uf) { cidade.innerHTML = '<option value="">Selecione o estado primeiro</option>'; cidade.disabled = true; refresh(cidade); update(); return; }
    if (uf === "0") { // Todos os estados → só "Todas as cidades" (agrega MG + SP)
      cidade.innerHTML = '<option value="' + ALL + '">Todas as cidades</option>';
      cidade.disabled = false; cidade.value = ALL; refresh(cidade); update(); return;
    }
    cidade.innerHTML = '<option value="">Carregando…</option>'; cidade.disabled = true; refresh(cidade);
    fetchCities(uf).then(function (cs) {
      cidade.innerHTML = '<option value="">Selecione</option>' + '<option value="' + ALL + '">Todas as cidades</option>' +
        cs.map(function (c) { return '<option value="' + c.id + '">' + c.nome + "</option>"; }).join("");
      cidade.disabled = false; refresh(cidade); update();
    }).catch(function () { cidade.innerHTML = '<option value="">Não foi possível carregar as cidades</option>'; cidade.disabled = true; refresh(cidade); update(); });
  }

  function update() {
    var t = tipoSel();
    estado.disabled = !t;
    if (!t) { estado.value = ""; }
    refresh(estado);
    step("tipo", t); step("estado", !!estado.value); step("cidade", !!cidade.value);
    go.disabled = !(t && estado.value && cidade.value);
  }

  /* ---------- Geração do manual ---------- */
  function fetchManual(tipo, uf, cid) {
    return fetch(API + "manual.php", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "tipo=" + encodeURIComponent(tipo) + "&estado=" + encodeURIComponent(uf) + "&cidade=" + encodeURIComponent(cid)
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).catch(function () { return ""; });
  }
  // Extrai o bloco de uma cidade (do título até antes da legenda); "" se vazio/sem resultado.
  function cityBlock(html) {
    if (!html) return "";
    var s = html.search(/<table[^>]*class="tabela-titulo-cidade"/i);
    var e = html.search(/<div[^>]*class="legenda-section"/i);
    if (s < 0 || e < 0 || e <= s) return "";
    var b = html.slice(s, e);
    if (/não obteve resultado/i.test(b) || !/(tabela-prestador|profissionais-grid)/i.test(b)) return "";
    return b;
  }
  // Combina os manuais de várias cidades num só documento (capa+legenda+rodapé do 1º, com todos os blocos).
  function combine(htmls) {
    var blocks = htmls.map(cityBlock).filter(Boolean);
    if (!blocks.length) return "";
    var template = htmls.filter(function (h) { return h && /legenda-section/i.test(h); })[0] || htmls.filter(Boolean)[0];
    var li = template.search(/<div[^>]*class="legenda-section"/i);
    var prefix = li >= 0 ? template.slice(0, li) : template;
    var cut = prefix.search(/<table[^>]*class="tabela-titulo-cidade"/i); // remove o bloco de cidade do próprio template
    var headCover = cut >= 0 ? prefix.slice(0, cut) : prefix;
    var tail = li >= 0 ? template.slice(li) : "";
    return headCover + blocks.join("\n") + tail;
  }

  var lastCombined = "", lastBlobURL = "";
  function render(tipo, list, label) {
    manual.hidden = false; load.hidden = false; load.textContent = list.length > 1 ? "Gerando o manual (" + list.length + " cidades)…" : "Gerando o manual…";
    titleEl.textContent = label;
    manual.scrollIntoView({ behavior: "smooth", block: "start" });
    newtabBtn.setAttribute("aria-disabled", "true");
    Promise.all(list.map(function (c) { return fetchManual(tipo, c.estado, c.id); })).then(function (htmls) {
      var doc = list.length > 1 ? combine(htmls) : (cityBlock(htmls[0]) ? htmls[0] : "");
      if (!doc) { load.hidden = false; load.textContent = "Nenhum resultado para esta seleção."; frame.removeAttribute("srcdoc"); lastCombined = ""; return; }
      lastCombined = doc;
      frame.srcdoc = doc;
      newtabBtn.removeAttribute("aria-disabled");
    }).catch(function () { load.hidden = false; load.textContent = "Não foi possível gerar o manual agora."; });
  }

  // Monta a lista de cidades da seleção (uma, todas de um estado, ou todas dos dois estados).
  function selectionCities() {
    var uf = estado.value, cid = cidade.value;
    if (uf === "0") return fetchCities("MG").then(function (mg) { return fetchCities("SP").then(function (sp) { return mg.concat(sp); }); });
    if (cid === ALL) return fetchCities(uf);
    return Promise.resolve([{ estado: uf, id: cid }]);
  }
  function selectionLabel() {
    var t = tipoSel().parentNode.querySelector("strong").textContent;
    if (estado.value === "0") return t + " · Todas as cidades (MG e SP)";
    if (cidade.value === ALL) return t + " · Todas as cidades de " + txt(estado);
    return t + " · " + txt(cidade) + "/" + estado.value;
  }

  Array.prototype.forEach.call(tipos, function (r) { r.addEventListener("change", update); });
  estado.addEventListener("change", fillCidades);
  cidade.addEventListener("change", update);

  app.querySelector(".gm-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (go.disabled) return;
    var t = tipoSel();
    var label = selectionLabel();
    (window.mgTrack || function () {})("guia_medico", { tipo: t.value, estado: estado.value, cidade: cidade.value });
    selectionCities().then(function (list) { render(t.value, list, label); });
  });

  frame.addEventListener("load", function () { if (frame.getAttribute("srcdoc")) load.hidden = true; });
  printBtn.addEventListener("click", function () { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) {} });
  newtabBtn.addEventListener("click", function (e) {
    e.preventDefault();
    if (!lastCombined) return;
    if (lastBlobURL) URL.revokeObjectURL(lastBlobURL);
    lastBlobURL = URL.createObjectURL(new Blob([lastCombined], { type: "text/html" }));
    window.open(lastBlobURL, "_blank", "noopener");
  });

  update();
})();
