/* Gera a página do IDSS (idss.html) e uma página interna por ano (idss-AAAA.html) a partir de src/data/idss.json
   (executado por build.js), em português e em inglês, no mesmo modelo da RN 565 (componentes rj-*, rn-*, agr-*).
   Conteúdo transcrito do site antigo (extremamedic.com/idss_historico.php e idss_detalhe.php?id=N): título, descrição,
   textos e imagens de cada registro. As imagens estão em assets/img/idss/. As notas por dimensão ("resultado") foram
   transcritas das imagens do painel da ANS publicadas em cada registro.
   Imagens que o site antigo publicou com endereço temporário (blob:) não podem ser recuperadas: aparecem sinalizadas. */
const fs = require("fs");
const path = require("path");

const DIMS = {
  pt: [
    ["IDQS", "Qualidade em Atenção à Saúde", "Avaliação do conjunto de ações em saúde que contribuem para o atendimento das necessidades de saúde dos beneficiários, com ênfase nas ações de promoção, prevenção e assistência à saúde prestada."],
    ["IDGA", "Garantia de Acesso", "Condições relacionadas à rede assistencial que possibilitam a garantia de acesso, abrangendo a oferta de rede de prestadores."],
    ["IDSM", "Sustentabilidade no Mercado", "Monitoramento da sustentabilidade da operadora, considerando seu equilíbrio econômico-financeiro, passando pela satisfação do beneficiário e compromissos com prestadores."],
    ["IDGR", "Gestão de Processos e Regulação", "Entre outros indicadores, essa dimensão afere o cumprimento das obrigações técnicas e cadastrais das operadoras junto à ANS."],
  ],
  en: [
    ["IDQS", "Quality of Health Care", "Assessment of the set of health actions that help meet members' health needs, with emphasis on health promotion, prevention and care provided."],
    ["IDGA", "Guaranteed Access", "Conditions related to the care network that ensure access, including the range of providers in the network."],
    ["IDSM", "Market Sustainability", "Monitoring of the operator's sustainability, considering its economic and financial balance, member satisfaction and commitments to providers."],
    ["IDGR", "Process Management and Regulation", "Among other indicators, this dimension measures compliance with the operator's technical and registration obligations to the ANS."],
  ],
};

const UI = {
  pt: {
    crumbsBase: [["MedicGLOBAL", "medicglobal.html"], ["Documentos", "documentos.html"]],
    metaTitle: "IDSS — Índice de Desempenho da Saúde Suplementar | MedicGLOBAL",
    metaDesc: "Histórico do IDSS da MedicGLOBAL (Extremamedic), de 2018 a 2025: nota geral, notas por dimensão e os resultados divulgados pela ANS em cada ano.",
    eyebrow: "ANS · Programa de Qualificação de Operadoras",
    sub: "Índice de Desempenho da Saúde Suplementar",
    latest: "Mais recente",
    baseYear: (y) => `Ano-base ${y}`,
    view: "Visualizar",
    hist: "Histórico do IDSS",
    jump: "Ir para o ano",
    olderShort: "Anteriores",
    pickYear: "Selecionar ano",
    allYears: "Todos os anos",
    older: "Anos anteriores",
    olderRange: (l) => `${l[l.length - 1].ano} a ${l[0].ano} · ${l.length} anos`,
    cols: ["Ano", "Descrição", "Nota IDSS", ""],
    rowCat: "Índice de Desempenho da Saúde Suplementar",
    score: "Nota IDSS",
    docsBack: "Voltar para a central de documentos",
    help: `Dúvidas sobre o IDSS? Fale com a <a href="atendimento.html">central de atendimento</a>.`,
    // página interna
    title: (r) => r.titulo.replace(/^IDSS ANO/, "IDSS ano"),
    crumb: (r) => `IDSS ${r.ano}`,
    agrMetaDesc: (r) => `${r.subtitulo}: nota ${r.resultado.nota} da MedicGLOBAL no Índice de Desempenho da Saúde Suplementar, notas por dimensão e resultado divulgado pela ANS.`,
    back: "Voltar para o histórico do IDSS",
    stats: { nota: "Nota IDSS", base: "Ano-base", acred: "Pontuação para operadora acreditada", bonus: "Indicador bônus" },
    notInImages: "Não consta nas imagens recuperadas",
    dimsTitle: "Notas por dimensão",
    dimsNote: "Valores transcritos do resultado divulgado pela ANS, reproduzido integralmente abaixo. Escala de 0 (pior) a 1 (melhor).",
    resultTitle: "Resultado divulgado pela ANS",
    imgAlt: (r, n, t) => `Resultado do IDSS ${r.ano} (ano-base ${r.anoBase}) da operadora divulgado pela ANS — imagem ${n} de ${t}`,
    imgCap: (n, t) => `Imagem ${n} de ${t} · clique para ampliar`,
    newTab: " (abre em nova aba)",
    missing: "Imagem não disponível. No site antigo, esta imagem foi publicada com um endereço temporário (blob:) e não pôde ser recuperada.",
    truncated: "Imagem incompleta no site antigo: o final do arquivo (legenda “Faixas de notas de avaliação”) estava corrompido e foi omitido.",
    otherYears: "Outros anos",
    prev: "Ano anterior",
    next: "Ano seguinte",
    blocks: (r) => r.blocos,
  },
  en: {
    crumbsBase: [["MedicGLOBAL", "medicglobal.html"], ["Documents", "documentos.html"]],
    metaTitle: "IDSS — Supplementary Health Performance Index | MedicGLOBAL",
    metaDesc: "MedicGLOBAL (Extremamedic) IDSS history from 2018 to 2025: overall score, scores by dimension and the results published by the ANS each year.",
    eyebrow: "ANS · Operator Qualification Program",
    sub: "Supplementary Health Performance Index",
    latest: "Latest",
    baseYear: (y) => `Base year ${y}`,
    view: "View",
    hist: "IDSS history",
    jump: "Go to year",
    olderShort: "Earlier",
    pickYear: "Select year",
    allYears: "All years",
    older: "Previous years",
    olderRange: (l) => `${l[l.length - 1].ano} to ${l[0].ano} · ${l.length} years`,
    cols: ["Year", "Description", "IDSS score", ""],
    rowCat: "Supplementary Health Performance Index",
    score: "IDSS score",
    docsBack: "Back to the document center",
    help: `Questions about the IDSS? Contact our <a href="atendimento.html">customer service</a>.`,
    title: (r) => `IDSS ${r.ano}`,
    crumb: (r) => `IDSS ${r.ano}`,
    agrMetaDesc: (r) => `IDSS ${r.ano} (base year ${r.anoBase}): MedicGLOBAL's score of ${dot(r.resultado.nota)} in the Supplementary Health Performance Index, scores by dimension and the result published by the ANS.`,
    back: "Back to the IDSS history",
    stats: { nota: "IDSS score", base: "Base year", acred: "Score for accredited operator", bonus: "Bonus indicator" },
    notInImages: "Not shown in the recovered images",
    dimsTitle: "Scores by dimension",
    dimsNote: "Values transcribed from the result published by the ANS, reproduced in full below. Scale from 0 (worst) to 1 (best).",
    resultTitle: "Result published by the ANS",
    imgAlt: (r, n, t) => `Operator's IDSS ${r.ano} result (base year ${r.anoBase}) published by the ANS — image ${n} of ${t} (in Portuguese)`,
    imgCap: (n, t) => `Image ${n} of ${t} (in Portuguese) · click to enlarge`,
    newTab: " (opens in a new tab)",
    missing: "Image not available. On the old website, this image was published with a temporary address (blob:) and could not be recovered.",
    truncated: "Incomplete image on the old website: the end of the file (the “score ranges” legend) was corrupted and has been left out.",
    otherYears: "Other years",
    prev: "Previous year",
    next: "Next year",
    // tradução dos blocos de texto do registro original (as imagens seguem as mesmas)
    blocks: (r) => r.blocos.map((b) => {
      if (b.h2) return { h2: "Supplementary Health Performance Index – IDSS" };
      if (!b.p) return b;
      if (/^O Índice/.test(b.p)) return { p: "The Supplementary Health Performance Index (IDSS) is part of the Operator Qualification Program (PQO), an initiative developed by the National Supplementary Health Agency (ANS) for the annual assessment of the performance of health plan operators. The IDSS is a composite index made up of a set of indicators grouped into four dimensions, and is calculated from data extracted from the Agency's information systems or collected from national health information systems." };
      if (/clique/.test(b.p)) return { p: `"To access the Operator Qualification Program, click <a href="${b.p.match(/href="([^"]*)"/)[1]}">here</a>." (in Portuguese)` };
      if (/^A nota/.test(b.p)) return { p: `Extremamedic's score in the IDSS ${r.ano} (base year ${r.anoBase}) was ${/<strong>/.test(b.p) ? `<strong>${dot(r.resultado.nota)}</strong>` : dot(r.resultado.nota)}, as published by the ANS:` };
      if (/^O Resultado/.test(b.p)) return { p: `Medic Global's result was: <strong><u>${dot(r.resultado.nota)}</u></strong>` };
      throw new Error("Bloco sem tradução (IDSS " + r.ano + "): " + b.p);
    }),
  },
};
function dot(n) { return n.replace(",", "."); }

module.exports = function (fs = require("fs")) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "idss.json"), "utf8"));
  const regs = data.registros.slice().sort((a, b) => b.ano - a.ano);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const file = (r) => `idss-${r.ano}.html`;
  const atual = regs[0];
  const recentes = regs.slice(0, 4), anteriores = regs.slice(4);

  for (const lang of ["pt", "en"]) {
    const U = UI[lang], D = DIMS[lang];
    const num = (n) => (lang === "en" ? dot(n) : n);
    const pages = path.join(__dirname, ...(lang === "pt" ? [] : ["en"]), "pages");
    for (const f of fs.readdirSync(pages)) if (/^idss-\d{4}\.html$/.test(f)) fs.unlinkSync(path.join(pages, f));
    const intro = U.blocks(atual).filter((b) => b.p);

    // ---------- Página principal: histórico ----------
    const row = (r, ind = "        ") => `${ind}<li class="rj-row${r === atual ? " is-current" : ""}" id="ano-${r.ano}">
${ind}  <span class="rj-year">${r.ano}</span>
${ind}  <div class="rj-info">
${ind}    <span class="rj-cat">${U.rowCat}${r === atual ? `<span class="rj-badge">${U.latest}</span>` : ""}</span>
${ind}    <span class="rj-period">{{i:calendar}}${U.baseYear(r.anoBase)}</span>
${ind}    <p class="rj-desc">${lang === "pt" ? esc(r.descricao) : `IDSS for ${r.ano} (base year ${r.anoBase})`}</p>
${ind}  </div>
${ind}  <span class="rj-pct"><span class="sr-only">${U.score}: </span>${num(r.resultado.nota)}</span>
${ind}  <span class="rj-act"><a class="btn btn--sm" href="${file(r)}">{{i:eye}} ${U.view}</a></span>
${ind}</li>`;
    const meta = { title: U.metaTitle, description: U.metaDesc, active: "institucional", og: "old_rn565_banner", crumbs: [...U.crumbsBase, ["IDSS", "idss.html"]] };
    fs.writeFileSync(path.join(pages, "idss.html"), `<!--@${JSON.stringify(meta, null, 2)}@-->

<section class="page-hero rn-hero" aria-labelledby="t">
  <div class="rn-hero-bg" aria-hidden="true">{{pic:old_rn565_banner||1600|100vw|eager}}</div>
  <div class="wrap">
    {{crumbs}}
    <div class="grid" style="align-items:end">
      <div class="c-1-7">
        <span class="eyebrow">${U.eyebrow}</span>
        <h1 id="t" class="balance">IDSS</h1>
        <p class="lead">${U.sub}.</p>
        <p class="idss-intro">${intro[0].p}</p>
        <p class="idss-intro">${intro[1].p.replace("<a ", '<a class="accent" target="_blank" rel="noopener" ')}</p>
      </div>
      <div class="c-8-13">
        <a class="rn-current" href="${file(atual)}">
          <span class="rn-current-top"><span class="rj-badge">${U.latest}</span><span>IDSS ${atual.ano}</span></span>
          <span class="rn-current-pct">${num(atual.resultado.nota)}</span>
          <span class="rn-current-period">{{i:calendar}} ${U.baseYear(atual.anoBase)}</span>
          <span class="rn-current-go">${U.view} {{i:arrow-right}}</span>
        </a>
      </div>
    </div>
  </div>
</section>

<section class="section section--tight" aria-labelledby="idss-hist">
  <div class="wrap">
    <div class="flex-between mb-6" style="align-items:end;gap:16px">
      <h2 id="idss-hist" style="font-size:var(--t-h3)">${U.hist}</h2>
      <nav class="rn-years" aria-label="${U.jump}">
        <span class="rn-years-label">${U.jump}</span>
        <div class="rn-years-seg">
          <details class="rn-years-more">
            <summary>${U.pickYear} {{i:chevron-down}}</summary>
            <div class="rn-years-pop">
              <span class="rn-years-pop-title">${U.allYears} · ${U.olderRange(regs)}</span>
              <div class="rn-years-grid">${regs.map((r) => `<a href="#ano-${r.ano}">${r.ano}</a>`).join("")}</div>
            </div>
          </details>
        </div>
      </nav>
    </div>
    <div class="rj rj--agr">
      <div class="rj-head" aria-hidden="true">${U.cols.map((c) => `<span>${c}</span>`).join("")}</div>
      <ol class="rj-list" aria-label="${U.hist}">
${recentes.map((r) => row(r)).join("\n")}
      </ol>
      <details class="rj-older">
        <summary><span class="rj-older-title">{{i:layers}} ${U.older} <small>${U.olderRange(anteriores)}</small></span><span class="rj-chev">{{i:chevron-down}}</span></summary>
        <ol class="rj-list" aria-label="${U.older}">
${anteriores.map((r) => row(r, "          ")).join("\n")}
        </ol>
      </details>
    </div>
    <p class="small mt-7">${U.help}</p>
    <a class="news-back mt-6" href="documentos.html">{{i:chevron-left}} ${U.docsBack}</a>
  </div>
</section>
`);

    // ---------- Páginas internas: um registro por ano ----------
    regs.forEach((r, i) => {
      const newer = regs[i - 1], older = regs[i + 1];
      const res = r.resultado;
      const blocos = U.blocks(r);
      const total = blocos.filter((b) => b.img || b.faltando).length;
      let n = 0;
      const corpo = blocos.map((b) => {
        if (b.h2) return `        <h2 class="idss-h2">${esc(b.h2)}</h2>`;
        if (b.p) return `        <p>${b.p.replace(/<a /g, '<a target="_blank" rel="noopener" ')}</p>`;
        n++;
        if (b.faltando) return `        <div class="idss-missing" role="note">{{i:info}}<p><strong>${U.imgCap(n, total).split(" · ")[0]}</strong> — ${U.missing}</p></div>`;
        const src = b.img, alt = U.imgAlt(r, n, total);
        return `        <figure class="idss-fig">
          <a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${alt}" loading="${n === 1 ? "eager" : "lazy"}" decoding="async"><span class="sr-only">${U.newTab}</span></a>
          <figcaption>${U.imgCap(n, total)}</figcaption>${b.truncada ? `
          <div class="idss-missing idss-missing--sm" role="note">{{i:info}}<p>${U.truncated}</p></div>` : ""}
        </figure>`;
      });
      // o primeiro bloco de imagem ganha o título da seção de resultado
      const firstImg = blocos.findIndex((b) => b.img || b.faltando);
      corpo.splice(firstImg, 0, `        <h3 class="idss-h3">${U.resultTitle}</h3>`);
      const meta = {
        title: `${U.title(r)} — ${U.sub} | MedicGLOBAL`,
        description: U.agrMetaDesc(r),
        active: "institucional",
        og: "old_rn565_banner",
        crumbs: [...U.crumbsBase, ["IDSS", "idss.html"], [U.crumb(r), file(r)]],
      };
      const flag = (v) => (v ? esc(v) : `<span class="review-flag">${U.notInImages}</span>`);
      const html = `<!--@${JSON.stringify(meta, null, 2)}@-->

<article class="news agr idss">
  <header class="page-hero" style="padding-bottom:0">
    <div class="wrap">
      {{crumbs}}
      <a class="news-back" href="idss.html#ano-${r.ano}">{{i:chevron-left}} ${U.back}</a>
      <div class="post-meta mb-6"><span class="cat">IDSS</span><span>${U.sub}</span>${r === atual ? `<span class="src-tag">${U.latest}</span>` : ""}</div>
    </div>
  </header>
  <!-- Título fixo: fica logo abaixo do menu durante toda a leitura (compacto ao fixar; ver main.js) -->
  <div class="agr-titlebar" data-agr-titlebar>
    <div class="wrap"><h1 class="balance agr-title">${U.title(r)}</h1><p class="agr-sub">${lang === "pt" ? esc(r.subtitulo) : `IDSS for ${r.ano} (base year ${r.anoBase})`}</p></div>
  </div>
  <div class="wrap">
    <figure class="news-figure">
      <div class="img-round agr-cover">
        {{pic:old_rn565_banner||2000|(min-width:1360px) 1300px, 100vw|eager}}
        <div class="agr-cover-txt" aria-hidden="true">
          <span class="agr-cover-eyebrow">IDSS · ${U.baseYear(r.anoBase)}</span>
          <span class="agr-cover-year">${r.ano}</span>
          <span class="agr-cover-pct">${U.score} ${num(res.nota)}</span>
        </div>
      </div>
    </figure>
  </div>
  <div class="section section--tight">
    <div class="wrap">
      <div class="news-body">
        <dl class="agr-stats">
          <div><dt>${U.stats.nota}</dt><dd>${num(res.nota)}</dd></div>
          <div><dt>${U.stats.base}</dt><dd>${r.anoBase}</dd></div>
          <div><dt>${U.stats.acred}</dt><dd class="idss-dd-sm">${flag(lang === "en" && res.acred ? res.acred.replace("Operadora não Acreditada", "Non-accredited operator").replace("Operadora não bonificada", "Operator without bonus") : res.acred)}</dd></div>
          <div><dt>${U.stats.bonus}</dt><dd class="idss-dd-sm">${flag(lang === "en" && res.bonus ? res.bonus.replace("Operadora não pontuada", "Operator not scored").replace("Operadora não bonificada", "Operator without bonus").replace(",", ".") : res.bonus)}</dd></div>
        </dl>

        <section class="mt-8" aria-labelledby="dim-t">
          <h2 id="dim-t" class="mb-6" style="font-size:var(--t-h3)">${U.dimsTitle}</h2>
          <ol class="idss-dims">
${D.map((d, k) => `            <li><span class="idss-dim-n">${k + 1}</span><div><strong>${d[0]} · ${d[1]}</strong><p>${d[2]}</p></div><span class="idss-dim-v">${num(res.dim[k])}</span></li>`).join("\n")}
          </ol>
          <p class="xs muted mt-5">${U.dimsNote}</p>
        </section>

        <div class="idss-orig mt-8">
${corpo.join("\n")}
        </div>

        <nav class="agr-nav mt-8" aria-label="${U.otherYears}">
          ${older ? `<a class="agr-nav-step" href="${file(older)}" rel="prev">{{i:chevron-left}}<span><small>${U.prev}</small>${older.ano}</span></a>` : "<span></span>"}
          ${newer ? `<a class="agr-nav-step agr-nav-step--next" href="${file(newer)}" rel="next"><span><small>${U.next}</small>${newer.ano}</span>{{i:chevron-right}}</a>` : "<span></span>"}
        </nav>
        <div class="agr-years mt-6"><span class="agr-years-label">${U.otherYears}:</span>${regs.map((o) => (o === r ? `<span aria-current="page">${o.ano}</span>` : `<a href="${file(o)}">${o.ano}</a>`)).join("")}</div>
        <p class="small mt-7">${U.help}</p>
        <a class="news-back mt-6" href="idss.html#ano-${r.ano}">{{i:chevron-left}} ${U.back}</a>
      </div>
    </div>
  </div>
</article>
`;
      fs.writeFileSync(path.join(pages, file(r)), html);
    });
  }
};
