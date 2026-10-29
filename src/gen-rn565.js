/* Gera a página da RN 565 (rn565.html) e uma página interna por agrupamento (rn565-agrupamento-AAAA.html)
   a partir de src/data/rn565.json (executado por build.js), em português e em inglês.
   Os dados foram transcritos do site antigo (extremamedic.com/agrupamento.php e agrupamento_detalhe.php?ano=AAAA):
   descrição, percentual, período e a relação de contratos (contrato, plano, registro ANS) de cada ano.
   Anos sem relação de contratos no site antigo (2013 e 2014) têm só o PDF (site.json → docs.rn309_AAAA). */
const fs = require("fs");
const path = require("path");

const UI = {
  pt: {
    crumbsBase: [["MedicGLOBAL", "medicglobal.html"], ["Documentos", "documentos.html"]],
    pageTitle: "RN 565 — Percentual de reajuste",
    eyebrow: "RN 565",
    h1: "Percentual de reajuste",
    sub: "Histórico dos percentuais de reajuste",
    lead: "Percentuais aplicados ao agrupamento de contratos coletivos com até 30 vidas, por período de aplicação. Em cada ano, consulte a relação completa de contratos do agrupamento.",
    metaDesc: "RN 565 MedicGLOBAL: histórico dos percentuais de reajuste do agrupamento de contratos com até 30 vidas, de 2013 a 2026, com a relação de contratos de cada ano.",
    cat: "Agrupamento de contratos · até 30 vidas",
    current: "Vigente",
    period: "Período de aplicação",
    pct: "Percentual",
    year: "Ano",
    desc: "Descrição",
    jump: "Ir para o ano",
    older: "Anos anteriores",
    olderShort: "Anteriores",
    pickYear: "Selecionar ano",
    allYears: "Todos os anos",
    olderRange: (l) => `${l[l.length - 1].ano} a ${l[0].ano} · ${l.length} anos`,
    view: "Ver agrupamento",
    download: "Baixar agrupamento",
    pdfLabel: "Empresas do agrupamento (RN 309) — PDF",
    noPct: "Percentual não informado na publicação original",
    noPctShort: "Não informado",
    newTab: " (abre em nova aba)",
    docsBack: "Voltar para a central de documentos",
    help: `Dúvidas sobre o reajuste do seu contrato? Fale com a <a href="atendimento.html">central de atendimento</a>.`,
    // página interna
    agrTitle: (y) => `Agrupamento de contratos RN 565 — ${y}`,
    agrCrumb: (y) => `Agrupamento ${y}`,
    agrMetaDesc: (a) => `Relação de contratos do agrupamento RN 565 de ${a.ano} (até 30 vidas), com plano e registro ANS. Período de aplicação: ${a.inicio} a ${a.fim}.`,
    back: "Voltar para o histórico da RN 565",
    validity: (a) => `${a.inicio} a ${a.fim}`,
    coverAlt: "",
    stats: { pct: "Percentual de reajuste", period: "Período de aplicação", contracts: "Contratos no agrupamento", plans: "Planos no agrupamento" },
    tblTitle: "Contratos do agrupamento",
    tblSearch: "Buscar contrato, plano ou registro ANS",
    tblSearchPh: "Ex.: 9687 ou BLUE 200",
    tblCount: "contratos",
    tblNone: "Nenhum contrato encontrado para essa busca.",
    cols: ["Contrato", "Plano", "Registro ANS"],
    plansTitle: "Planos deste agrupamento",
    plansCount: (n) => `${n} ${n === 1 ? "contrato" : "contratos"}`,
    otherYears: "Outros anos",
    prev: "Ano anterior",
    next: "Ano seguinte",
    descricao: (a) => a.descricao,
  },
  en: {
    crumbsBase: [["MedicGLOBAL", "medicglobal.html"], ["Documents", "documentos.html"]],
    pageTitle: "RN 565 — Adjustment percentage",
    eyebrow: "RN 565",
    h1: "Adjustment percentage",
    sub: "History of adjustment percentages",
    lead: "Percentages applied to the pool of group contracts with up to 30 lives (members), by application period. For each year, see the full list of contracts in the pool.",
    metaDesc: "MedicGLOBAL RN 565: history of the adjustment percentages for the pool of contracts with up to 30 lives, from 2013 to 2026, with the list of contracts for each year.",
    cat: "Contract pool · up to 30 lives",
    current: "Current",
    period: "Application period",
    pct: "Percentage",
    year: "Year",
    desc: "Description",
    jump: "Go to year",
    older: "Previous years",
    olderShort: "Earlier",
    pickYear: "Select year",
    allYears: "All years",
    olderRange: (l) => `${l[l.length - 1].ano} to ${l[0].ano} · ${l.length} years`,
    view: "View contract pool",
    download: "Download contract pool",
    pdfLabel: "Companies in the pool (RN 309) — PDF (in Portuguese)",
    noPct: "Percentage not stated in the original publication",
    noPctShort: "Not stated",
    newTab: " (opens in a new tab)",
    docsBack: "Back to the document center",
    help: `Questions about your contract's adjustment? Contact our <a href="atendimento.html">customer service</a>.`,
    agrTitle: (y) => `RN 565 contract pool — ${y}`,
    agrCrumb: (y) => `Contract pool ${y}`,
    agrMetaDesc: (a) => `List of contracts in the ${a.ano} RN 565 pool (up to 30 lives), with plan and ANS registration. Application period: ${en(a.inicio)} to ${en(a.fim)}.`,
    back: "Back to the RN 565 history",
    validity: (a) => `${en(a.inicio)} to ${en(a.fim)}`,
    stats: { pct: "Adjustment percentage", period: "Application period", contracts: "Contracts in the pool", plans: "Plans in the pool" },
    tblTitle: "Contracts in the pool",
    tblSearch: "Search contract, plan or ANS registration",
    tblSearchPh: "E.g.: 9687 or BLUE 200",
    tblCount: "contracts",
    tblNone: "No contracts match your search.",
    cols: ["Contract", "Plan", "ANS registration"],
    plansTitle: "Plans in this pool",
    plansCount: (n) => `${n} ${n === 1 ? "contract" : "contracts"}`,
    otherYears: "Other years",
    prev: "Previous year",
    next: "Next year",
    descricao: (a) => `Adjustment percentage applied to the pool of contracts with up to 30 lives, for the period from ${en(a.inicio)} to ${en(a.fim)}` + (a.percentual ? `: ${a.percentual.replace(",", ".")}` : "."),
  },
};
// datas no padrão americano (MM/DD/AAAA) e percentual com ponto na versão em inglês
function en(d) { const [dd, mm, y] = d.split("/"); return `${mm}/${dd}/${y}`; }

module.exports = function (fs = require("fs")) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "rn565.json"), "utf8"));
  const anos = data.anos.slice().sort((a, b) => b.ano - a.ano);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const file = (a) => `rn565-agrupamento-${a.ano}.html`;
  const atual = anos[0];

  for (const lang of ["pt", "en"]) {
    const U = UI[lang];
    const pages = path.join(__dirname, ...(lang === "pt" ? [] : ["en"]), "pages");
    const pct = (a) => (a.percentual ? (lang === "en" ? a.percentual.replace(",", ".") : a.percentual) : null);
    for (const f of fs.readdirSync(pages)) if (/^rn565-agrupamento-\d{4}\.html$/.test(f)) fs.unlinkSync(path.join(pages, f));

    // ---------- Página principal: histórico de todos os anos ----------
    const acao = (a, cls = "btn btn--sm") => a.contratos
      ? `<a class="${cls}" href="${file(a)}">{{i:eye}} ${U.view}</a>`
      : `<a class="${cls}" href="{{L.docs.${a.pdf}}}" target="_blank" rel="noopener" download data-doc="RN309 ${a.ano}">{{i:download}} ${U.download}<span class="sr-only">${U.newTab}</span></a>`;
    const row = (a) => `        <li class="rj-row${a === atual ? " is-current" : ""}" id="ano-${a.ano}">
          <span class="rj-year">${a.ano}</span>
          <div class="rj-info">
            <span class="rj-cat">${U.cat}${a === atual ? `<span class="rj-badge">${U.current}</span>` : ""}</span>
            <span class="rj-period">{{i:calendar}}<span class="sr-only">${U.period}: </span>${U.validity(a)}</span>
            <p class="rj-desc">${esc(U.descricao(a))}</p>${a.contratos ? "" : `
            <span class="rj-docs"><span class="rj-doc rj-doc--static">{{i:doc}} ${U.pdfLabel}</span></span>`}
          </div>
          <span class="rj-pct"><span class="sr-only">${U.pct}: </span>${pct(a) || `<span class="review-flag">${U.noPctShort}</span>`}</span>
          <span class="rj-act">${acao(a)}</span>
        </li>`;
    // como na Central de Documentos: anos recentes à mostra, os 10 anteriores recolhidos em "Anos anteriores"
    const recentes = anos.slice(0, anos.length - 10), anteriores = anos.slice(-10);
    const meta = {
      title: `${U.pageTitle} | MedicGLOBAL`,
      description: U.metaDesc,
      active: "institucional",
      og: "old_rn565_banner",
      crumbs: [...U.crumbsBase, ["RN 565", "rn565.html"]],
    };
    fs.writeFileSync(path.join(pages, "rn565.html"), `<!--@${JSON.stringify(meta, null, 2)}@-->

<section class="page-hero rn-hero" aria-labelledby="t">
  <div class="rn-hero-bg" aria-hidden="true">{{pic:old_rn565_banner||1600|100vw|eager}}</div>
  <div class="wrap">
    {{crumbs}}
    <div class="grid" style="align-items:end">
      <div class="c-1-7">
        <span class="eyebrow">${U.eyebrow}</span>
        <h1 id="t" class="balance">${U.h1}</h1>
        <p class="lead">${U.sub}. ${U.lead}</p>
      </div>
      <div class="c-8-13">
        <a class="rn-current" href="${file(atual)}">
          <span class="rn-current-top"><span class="rj-badge">${U.current}</span><span>${atual.ano}</span></span>
          <span class="rn-current-pct">${pct(atual)}</span>
          <span class="rn-current-period">{{i:calendar}} ${U.validity(atual)}</span>
          <span class="rn-current-go">${U.view} {{i:arrow-right}}</span>
        </a>
      </div>
    </div>
  </div>
</section>

<section class="section section--tight" aria-labelledby="rn-hist">
  <div class="wrap">
    <div class="flex-between mb-6" style="align-items:end;gap:16px">
      <h2 id="rn-hist" style="font-size:var(--t-h3)">${U.sub}</h2>
      <nav class="rn-years" aria-label="${U.jump}">
        <span class="rn-years-label">${U.jump}</span>
        <div class="rn-years-seg">
          <details class="rn-years-more">
            <summary>${U.pickYear} {{i:chevron-down}}</summary>
            <div class="rn-years-pop">
              <span class="rn-years-pop-title">${U.allYears} · ${U.olderRange(anos)}</span>
              <div class="rn-years-grid">${anos.map((a) => `<a href="#ano-${a.ano}">${a.ano}</a>`).join("")}</div>
            </div>
          </details>
        </div>
      </nav>
    </div>
    <div class="rj rj--agr">
      <div class="rj-head" aria-hidden="true"><span>${U.year}</span><span>${U.desc}</span><span>${U.pct}</span><span></span></div>
      <ol class="rj-list" aria-label="${U.sub}">
${recentes.map(row).join("\n")}
      </ol>
      <details class="rj-older">
        <summary><span class="rj-older-title">{{i:layers}} ${U.older} <small>${U.olderRange(anteriores)}</small></span><span class="rj-chev">{{i:chevron-down}}</span></summary>
        <ol class="rj-list" aria-label="${U.older}">
${anteriores.map((a) => row(a).replace(/^ {8}/gm, "          ")).join("\n")}
        </ol>
      </details>
    </div>
    <p class="small mt-7">${U.help}</p>
    <a class="news-back mt-6" href="documentos.html">{{i:chevron-left}} ${U.docsBack}</a>
  </div>
</section>
`);

    // ---------- Páginas internas: um agrupamento por ano ----------
    const comContratos = anos.filter((a) => a.contratos);
    comContratos.forEach((a, i) => {
      const newer = comContratos[i - 1], older = comContratos[i + 1];
      const planos = [];
      a.contratos.forEach((c) => {
        let p = planos.find((x) => x.plano === c.plano && x.registro === c.registro);
        if (!p) planos.push((p = { plano: c.plano, registro: c.registro, n: 0 }));
        p.n++;
      });
      planos.sort((x, y) => y.n - x.n);
      const meta = {
        title: `${U.agrTitle(a.ano)} | MedicGLOBAL`,
        description: U.agrMetaDesc(a),
        active: "institucional",
        og: "old_rn565_banner",
        crumbs: [...U.crumbsBase, ["RN 565", "rn565.html"], [U.agrCrumb(a.ano), file(a)]],
      };
      const html = `<!--@${JSON.stringify(meta, null, 2)}@-->

<article class="news agr">
  <header class="page-hero" style="padding-bottom:0">
    <div class="wrap">
      {{crumbs}}
      <a class="news-back" href="rn565.html#ano-${a.ano}">{{i:chevron-left}} ${U.back}</a>
      <div class="post-meta mb-6"><span class="cat">RN 565</span><span>${U.cat}</span>${a === atual ? `<span class="src-tag">${U.current}</span>` : ""}</div>
    </div>
  </header>
  <!-- Título fixo: fica logo abaixo do menu durante toda a leitura (compacto ao fixar; ver main.js) -->
  <div class="agr-titlebar" data-agr-titlebar>
    <div class="wrap"><h1 class="balance agr-title">${U.agrTitle(a.ano)}</h1></div>
  </div>
  <div class="wrap">
    <figure class="news-figure">
      <div class="img-round agr-cover">
        {{pic:old_rn565_banner||2000|(min-width:1360px) 1300px, 100vw|eager}}
        <div class="agr-cover-txt" aria-hidden="true">
          <span class="agr-cover-eyebrow">RN 565 · ${U.cat}</span>
          <span class="agr-cover-year">${a.ano}</span>
          <span class="agr-cover-pct">${pct(a) || U.noPctShort}</span>
        </div>
      </div>
    </figure>
  </div>
  <div class="section section--tight">
    <div class="wrap">
      <div class="news-body">
        <dl class="agr-stats">
          <div><dt>${U.stats.pct}</dt><dd>${pct(a) || `<span class="review-flag">${U.noPct}</span>`}</dd></div>
          <div><dt>${U.stats.period}</dt><dd>${U.validity(a)}</dd></div>
          <div><dt>${U.stats.contracts}</dt><dd>${a.contratos.length}</dd></div>
          <div><dt>${U.stats.plans}</dt><dd>${planos.length}</dd></div>
        </dl>
        <p class="lead mt-7">${esc(U.descricao(a))}</p>

        <section class="mt-8" aria-labelledby="agr-t" data-filter data-filter-items="#agr-rows tr" data-filter-empty="#agr-none">
          <div class="agr-tools">
            <h2 id="agr-t" style="font-size:var(--t-h3)">${U.tblTitle}</h2>
            <div class="field agr-search"><label class="sr-only" for="agr-q">${U.tblSearch}</label><div class="doc-search-box">{{i:search}}<input id="agr-q" type="search" data-filter-search placeholder="${U.tblSearchPh}" aria-describedby="agr-count"></div></div>
          </div>
          <p class="small muted" id="agr-count" aria-live="polite"><span data-filter-count>${a.contratos.length}</span> ${U.tblCount}</p>
          <div class="agr-tbl-wrap">
            <table class="agr-tbl">
              <thead><tr>${U.cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
              <tbody id="agr-rows">
${a.contratos.map((c) => `                <tr><td>${esc(c.contrato)}</td><td>${esc(c.plano)}</td><td>${esc(c.registro)}</td></tr>`).join("\n")}
              </tbody>
            </table>
          </div>
          <p id="agr-none" class="muted mt-5" hidden>${U.tblNone}</p>
        </section>

        <section class="mt-8" aria-labelledby="agr-p">
          <h2 id="agr-p" class="mb-6" style="font-size:var(--t-h4)">${U.plansTitle}</h2>
          <ul class="agr-plans">
${planos.map((p) => `            <li><strong>${esc(p.plano)}</strong><span>${U.cols[2]} ${esc(p.registro)}</span><span class="agr-plans-n">${U.plansCount(p.n)}</span></li>`).join("\n")}
          </ul>
        </section>

        <nav class="agr-nav mt-8" aria-label="${U.otherYears}">
          ${older ? `<a class="agr-nav-step" href="${file(older)}" rel="prev">{{i:chevron-left}}<span><small>${U.prev}</small>${older.ano}</span></a>` : "<span></span>"}
          ${newer ? `<a class="agr-nav-step agr-nav-step--next" href="${file(newer)}" rel="next"><span><small>${U.next}</small>${newer.ano}</span>{{i:chevron-right}}</a>` : "<span></span>"}
        </nav>
        <div class="agr-years mt-6"><span class="agr-years-label">${U.otherYears}:</span>${anos.map((o) => o === a ? `<span aria-current="page">${o.ano}</span>` : `<a href="${o.contratos ? file(o) : "rn565.html#ano-" + o.ano}">${o.ano}</a>`).join("")}</div>
        <p class="small mt-7">${U.help}</p>
        <a class="news-back mt-6" href="rn565.html#ano-${a.ano}">{{i:chevron-left}} ${U.back}</a>
      </div>
    </div>
  </div>
</article>
`;
      fs.writeFileSync(path.join(pages, file(a)), html);
    });
  }
};
