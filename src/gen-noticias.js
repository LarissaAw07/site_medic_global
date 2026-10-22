/* Gera as páginas internas de notícias (src/pages/noticia-*.html) e os cards da listagem
   (src/partials/noticias-cards.html) a partir de src/data/noticias.json (executado por build.js).
   Notícia sem "foto" recebe automaticamente o fundo dos banners (partial globe-art) no card e na página.
   São referências informativas de fontes oficiais (ANS, Ministério da Saúde): resumos próprios, com
   crédito e link para a publicação original — não são comunicados da MedicGLOBAL. */
const fs = require("fs");
const path = require("path");
module.exports = function () {
  const ROOT = path.join(__dirname, "..");
  const pages = path.join(__dirname, "pages");
  const news = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "noticias.json"), "utf8"))
    .sort((a, b) => b.data.localeCompare(a.data));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const br = (d) => d.split("-").reverse().join("/");
  const catName = { noticias: "Notícias", comunicados: "Comunicados" };
  const file = (n) => `noticia-${n.slug}.html`;

  // remove páginas geradas antes (inclusive as de notícias que saíram da lista)
  const keep = new Set(news.map(file));
  for (const dir of [pages, ROOT]) {
    for (const f of fs.readdirSync(dir)) if (/^noticia-.+\.html$/.test(f) && !(dir === ROOT && keep.has(f))) fs.unlinkSync(path.join(dir, f));
  }

  const card = (n, sizes = "(min-width:1100px) 30vw, 100vw") =>
    `<a class="card-post card-post--ext" data-cat="${n.cat}" href="${file(n)}">${n.foto ? `<div class="img">{{pic:${n.foto}||800|${sizes}}}</div>` : `<div class="img img--globe">{{> globe-art}}</div>`}` +
    `<div class="post-meta"><span class="cat">${catName[n.cat]}</span><time datetime="${n.data}">${br(n.data)}</time><span class="src-tag">${esc(n.orgao)}</span></div>` +
    `<h3>${esc(n.titulo)}</h3><p>${esc(n.resumo)}</p></a>`;

  fs.writeFileSync(path.join(__dirname, "partials", "noticias-cards.html"), news.map((n) => card(n)).join("\n") + "\n");

  news.forEach((n) => {
    const others = news.filter((o) => o !== n).sort((a, b) => (b.cat === n.cat) - (a.cat === n.cat)).slice(0, 3);
    const meta = {
      title: `${n.titulo} | Conteúdos | MedicGLOBAL`,
      description: n.resumo,
      active: "conteudos",
      og: n.foto || "old_hsl_fachada",
      crumbs: [["Conteúdos", "conteudos.html"], [catName[n.cat], `conteudos.html#cat=${n.cat}`], [n.migalha, file(n)]],
      jsonld: [{ "@context": "https://schema.org", "@type": "NewsArticle", headline: n.titulo, datePublished: n.data, isBasedOn: n.fonteUrl, author: { "@type": "Organization", name: "MedicGLOBAL" }, publisher: { "@type": "Organization", name: "MedicGLOBAL" } }],
    };
    const secoes = n.secoes.map((s) => `        <h2>${esc(s.h)}</h2>\n${s.p.map((p) => `        <p>${esc(p)}</p>`).join("\n")}`).join("\n");
    const html = `<!--@${JSON.stringify(meta, null, 2)}@-->

<article class="news">
  <header class="page-hero" style="padding-bottom:48px">
    <div class="wrap">
      {{crumbs}}
      <a class="news-back" href="conteudos.html#cat=${n.cat}">{{i:chevron-left}} Voltar para ${catName[n.cat].toLowerCase()}</a>
      <div class="post-meta mb-6"><span class="cat">${catName[n.cat]}</span><time datetime="${n.data}">${br(n.data)}</time><span>${esc(n.tema)}</span><span>Leitura de ${n.leitura} min</span></div>
      <h1 class="balance news-title">${esc(n.titulo)}</h1>
      <p class="news-src-line">Referência informativa · Fonte: <a href="${esc(n.fonteUrl)}" target="_blank" rel="noopener">${esc(n.orgao)}<span class="sr-only"> (abre em nova aba)</span></a></p>
    </div>
  </header>
  <div class="wrap"><figure class="news-figure">${n.foto ? `<div class="img-round" style="aspect-ratio:21/9">{{pic:${n.foto}|${esc(n.alt)}|2000|(min-width:1360px) 1300px, 100vw|eager}}</div><figcaption>Imagem ilustrativa.</figcaption>` : `<div class="img-round img--globe" style="aspect-ratio:21/9">{{> globe-art}}</div>`}</figure></div>
  <div class="section section--tight">
    <div class="wrap">
      <div class="prose news-body">
        <p class="lead">${esc(n.intro)}</p>
${secoes}
        <div class="news-source">
          <p class="news-source-label">Fonte original</p>
          <p><strong>${esc(n.orgao)}</strong> — “${esc(n.fonteTitulo)}”, publicado em ${br(n.data)}.</p>
          <a class="btn btn--sm" href="${esc(n.fonteUrl)}" target="_blank" rel="noopener">Ler a publicação oficial {{i:external}}<span class="sr-only"> (abre em nova aba)</span></a>
          <p class="xs muted">Resumo elaborado pela MedicGLOBAL a partir da publicação oficial, como referência informativa. Não se trata de comunicado da MedicGLOBAL. Em caso de divergência, prevalece o texto da fonte.</p>
        </div>
        <p class="small mt-7">Dúvidas sobre o seu plano? Fale com a <a href="atendimento.html">central de atendimento</a>.</p>
        <a class="news-back mt-6" href="conteudos.html#cat=${n.cat}">{{i:chevron-left}} Voltar para ${catName[n.cat].toLowerCase()}</a>
      </div>
    </div>
  </div>
</article>

<section class="section mist" aria-labelledby="rel-t">
  <div class="wrap">
    <div class="flex-between mb-7"><h2 id="rel-t" style="font-size:var(--t-h3)">Leia também</h2><a class="link" href="conteudos.html#todos">Todos os conteúdos</a></div>
    <div class="card-grid">
${others.map((o) => "      " + card(o)).join("\n")}
    </div>
  </div>
</section>
`;
    fs.writeFileSync(path.join(pages, file(n)), html);
  });
};
