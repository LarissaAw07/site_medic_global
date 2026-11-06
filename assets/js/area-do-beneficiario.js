/* Área do Beneficiário (area-do-beneficiario.html): mostrar/ocultar senha, lembrar matrícula e validação.
   Por enquanto só a parte visual: a ligação com o sistema de login será feita depois. */
(function () {
  "use strict";
  var app = document.querySelector("[data-area-beneficiario]");
  if (!app) return;
  var form = app.querySelector(".ab-form"), mat = app.querySelector("#ab-mat"), senha = app.querySelector("#ab-senha");
  var eye = app.querySelector(".ab-eye"), lembrar = form.querySelector('input[name="lembrar"]'), status = app.querySelector(".ab-status");
  var KEY = "mg-ab-matricula";

  try { var salvo = localStorage.getItem(KEY); if (salvo) { mat.value = salvo; lembrar.checked = true; } } catch (e) {}

  eye.addEventListener("click", function () {
    var show = senha.type === "password";
    senha.type = show ? "text" : "password";
    eye.textContent = show ? "Ocultar" : "Mostrar";
    eye.setAttribute("aria-pressed", String(show));
    senha.focus();
  });

  function check(input) {
    var ok = !!input.value.trim();
    input.setAttribute("aria-invalid", ok ? "false" : "true");
    document.getElementById(input.getAttribute("aria-describedby")).classList.toggle("is-visible", !ok);
    return ok;
  }
  [mat, senha].forEach(function (i) { i.addEventListener("input", function () { if (i.getAttribute("aria-invalid") === "true") check(i); }); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ok = check(mat) & check(senha);
    if (!ok) { (mat.getAttribute("aria-invalid") === "true" ? mat : senha).focus(); return; }
    try { if (lembrar.checked) localStorage.setItem(KEY, mat.value.trim()); else localStorage.removeItem(KEY); } catch (e2) {}
    status.hidden = false;
    status.textContent = "Tela em fase de aprovação: o acesso ao sistema será ligado em breve.";
  });
})();
