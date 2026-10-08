/* Gera src/pages/mapa-de-migracao.html a partir de src/data/migracao.tsv (executado por build.js). */
const fs = require("fs");
const path = require("path");
module.exports = function () {
  const rows = fs.readFileSync(path.join(__dirname, "data", "migracao.tsv"), "utf8").trim().split(/\r?\n/).map((l) => l.split("\t"));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const needs = (r) => r[6].startsWith("Sim");
  const td = (c, cls = "") => `<td style="text-align:left"${cls ? ` class="${cls}"` : ""}>${c}</td>`;
  const body = rows.map((r) => `<tr data-acao="${r[4].toLowerCase()}" data-rev="${needs(r) ? "sim" : "nao"}">${td(esc(r[0]))}${td(esc(r[1]), "xs muted")}${td(esc(r[2]))}${td(esc(r[3]))}${td(`<span class="badge">${r[4]}</span>`)}${td(esc(r[5]), "small")}${td(needs(r) ? `<span class="review-flag">${esc(r[6])}</span>` : esc(r[6]), "small")}</tr>`).join("\n");
  const acoes = ["MANTER", "REESCREVER", "REORGANIZAR", "ATUALIZAR", "VALIDAR", "ARQUIVAR"];
  const cnt = (a) => rows.filter((r) => r[4] === a).length;
  const meta = { title: "Mapa de migração de conteúdo | MedicGLOBAL 2.0", description: "Inventário interno do conteúdo atual e destino na nova arquitetura.", noindex: true, crumbs: [["Mapa de migração", "mapa-de-migracao.html"]] };
  const html = `<!--@${JSON.stringify(meta)}@-->
<section class="page-hero" style="padding-bottom:40px"><div class="wrap">{{crumbs}}<span class="eyebrow">Documento interno · não indexado</span><h1 class="balance" style="font-size:var(--t-h2)">Mapa de migração de conteúdo</h1><p class="lead">Inventário do site atual (medicglobal.com.br e extremamedic.com, levantado em 08/10/2026) e o destino de cada item na nova arquitetura: <strong>${rows.length} itens</strong>, dos quais ${rows.filter(needs).length} precisam de revisão ou validação.</p></div></section>
<section class="section section--flush-top" data-filter data-filter-items="#mig tbody tr"><div class="wrap wrap--wide">
<div class="flex-between mb-6"><div class="type-pills"><button class="pill" type="button" data-filter-group="acao" data-value="all" aria-pressed="true">Todos (${rows.length})</button>${acoes.map((a) => `<button class="pill" type="button" data-filter-group="acao" data-value="${a.toLowerCase()}" aria-pressed="false">${a} (${cnt(a)})</button>`).join("")}</div>
<div class="type-pills"><button class="pill" type="button" data-filter-group="rev" data-value="all" aria-pressed="true">Todas</button><button class="pill" type="button" data-filter-group="rev" data-value="sim" aria-pressed="false">Necessita revisão</button></div></div>
<div class="field mb-6" style="max-width:420px"><label for="mq">Buscar</label><input id="mq" type="search" data-filter-search></div>
<div class="matrix-wrap" id="mig"><table class="matrix" style="min-width:1100px"><thead><tr>${["Conteúdo atual", "Origem / URL", "Nova página", "Nova seção", "Classificação", "Status da copy", "Necessita revisão?"].map((h) => `<th scope="col" style="text-align:left">${h}</th>`).join("")}</tr></thead><tbody>
${body}
</tbody></table></div></div></section>
`;
  fs.writeFileSync(path.join(__dirname, "pages", "mapa-de-migracao.html"), html);
};
