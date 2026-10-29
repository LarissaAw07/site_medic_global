/* Guia médico (no molde de extremamedic.com/manual): Tipo de guia → Estado → Cidade → Visualizar manual.
   Só os filtros por enquanto; a geração do manual será integrada depois.
   Cidades com os códigos do sistema antigo (manual/buscacidade.php). */
(function () {
  "use strict";
  var app = document.querySelector("[data-guia-medico]");
  if (!app) return;
  var CIDADES = {
    MG: [["3451", "Camanducaia"], ["3452", "Cambuí"], ["1394", "Extrema"], ["1482", "Itajubá"], ["1494", "Itapeva"], ["1667", "Paraisópolis"], ["1728", "Pouso Alegre"], ["1809", "Santa Rita do Sapucaí"]],
    SP: [["2183", "Atibaia"], ["2222", "Bragança Paulista"], ["3889", "Vargem"]]
  };
  var tipos = app.querySelectorAll('input[name="tipo"]'), estado = app.querySelector("#gm-estado"), cidade = app.querySelector("#gm-cidade");
  var go = app.querySelector(".gm-go"), result = app.querySelector(".gm-result");
  var txt = function (sel) { return sel.options[sel.selectedIndex].text; };
  var refresh = function (sel) { sel.dispatchEvent(new Event("dd:refresh")); };
  var tipoSel = function () { return app.querySelector('input[name="tipo"]:checked'); };
  var step = function (k, done) { var li = app.querySelector('[data-step="' + k + '"]'); if (li) li.classList.toggle("is-done", !!done); };

  function fillCidades() {
    var uf = estado.value, list = uf === "0" ? CIDADES.MG.concat(CIDADES.SP).sort(function (a, b) { return a[1].localeCompare(b[1], "pt-BR"); }) : CIDADES[uf] || [];
    cidade.innerHTML = '<option value="">Selecione</option>' + (uf ? '<option value="Todas">Todas</option>' : "") +
      list.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + "</option>"; }).join("");
    cidade.disabled = !uf;
    refresh(cidade);
  }
  function update() {
    var t = tipoSel();
    estado.disabled = !t;
    if (!t) { estado.value = ""; fillCidades(); }
    refresh(estado);
    step("tipo", t); step("estado", estado.value); step("cidade", cidade.value);
    go.disabled = !(t && estado.value && cidade.value);
    result.hidden = true;
  }

  Array.prototype.forEach.call(tipos, function (r) { r.addEventListener("change", update); });
  estado.addEventListener("change", function () { fillCidades(); update(); });
  cidade.addEventListener("change", update);
  app.querySelector(".gm-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (go.disabled) return;
    var t = tipoSel();
    var onde = cidade.value === "Todas" ? txt(estado) === "Todos" ? "todas as cidades" : txt(estado) : txt(cidade) + (estado.value === "0" ? "" : "/" + estado.value);
    app.querySelector(".gm-result-t").textContent = t.parentNode.querySelector("strong").textContent + " · " + onde + ".";
    result.hidden = false;
    (window.mgTrack || function () {})("guia_medico", { tipo: t.value, estado: estado.value, cidade: cidade.value });
  });
  update();
})();
