/* Gera as páginas internas de notícias (noticia-*.html) e os cards da listagem (partial noticias-cards)
   a partir de src/data/noticias.json (executado por build.js), em português (src/pages, src/partials)
   e em inglês (src/en/pages, src/en/partials).
   Notícia sem "foto" recebe automaticamente o fundo dos banners (partial globe-art) no card e na página.
   Notícia sem o bloco "en" não entra na versão em inglês (nem card, nem página), para não misturar idiomas.
   São referências informativas de fontes oficiais (ANS, Ministério da Saúde): resumos próprios, com
   crédito e link para a publicação original — não são comunicados da MedicGLOBAL. */
const fs = require("fs");
const path = require("path");

const UI = {
  pt: {
    cat: { noticias: "Notícias", comunicados: "Comunicados" },
    org: (o) => o,
    date: (d) => d.split("-").reverse().join("/"),
    contents: "Conteúdos",
    back: (c) => `Voltar para ${c.toLowerCase()}`,
    read: (m) => `Leitura de ${m} min`,
    ref: "Referência informativa · Fonte:",
    newTab: " (abre em nova aba)",
    caption: "Imagem ilustrativa.",
    srcLabel: "Fonte original",
    srcLine: (o, t, d) => `<strong>${o}</strong> — “${t}”, publicado em ${d}.`,
    srcBtn: "Ler a publicação oficial",
    disclaimer: "Resumo elaborado pela MedicGLOBAL a partir da publicação oficial, como referência informativa. Não se trata de comunicado da MedicGLOBAL. Em caso de divergência, prevalece o texto da fonte.",
    help: `Dúvidas sobre o seu plano? Fale com a <a href="atendimento.html">central de atendimento</a>.`,
    share: "Compartilhar",
    shareBar: "<div class=\"share-bar mt-7\"><span class=\"share-bar-label\">Compartilhar:</span><div class=\"share-bar-nets\"><a class=\"share-net\" data-share-net=\"facebook\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"Facebook (abre em nova aba)\">{{i:facebook}}</a><a class=\"share-net\" data-share-net=\"x\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"X (abre em nova aba)\">{{i:x}}</a><a class=\"share-net\" data-share-net=\"linkedin\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"LinkedIn (abre em nova aba)\">{{i:linkedin}}</a><a class=\"share-net\" data-share-net=\"whatsapp\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"WhatsApp (abre em nova aba)\">{{i:whatsapp}}</a><a class=\"share-net\" data-share-net=\"email\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"E-mail\">{{i:mail}}</a><button class=\"share-net\" type=\"button\" data-share-copy aria-label=\"Copiar link\">{{i:link-mark}}</button></div><button class=\"btn btn--sm\" type=\"button\" data-share>{{i:share}} Compartilhar</button><span class=\"news-share-ok small\" role=\"status\"></span></div>",
    related: "Leia também",
    all: "Todos os conteúdos",
  },
  en: {
    cat: { noticias: "News", comunicados: "Notices" },
    org: (o) => ({ "Ministério da Saúde": "Ministry of Health (Brazil)" })[o] || o,
    date: (d) => { const [y, m, dd] = d.split("-"); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m - 1]} ${+dd}, ${y}`; },
    contents: "Content",
    back: (c) => `Back to ${c.toLowerCase()}`,
    read: (m) => `${m} min read`,
    ref: "Informational reference · Source:",
    newTab: " (opens in a new tab)",
    caption: "Illustrative image.",
    srcLabel: "Original source",
    srcLine: (o, t, d) => `<strong>${o}</strong> — “${t}” (in Portuguese), published on ${d}.`,
    srcBtn: "Read the official publication",
    disclaimer: "Summary prepared by MedicGLOBAL from the official publication, for information purposes only. This is not a MedicGLOBAL notice. In case of any discrepancy, the source text prevails.",
    share: "Share",
    shareBar: "<div class=\"share-bar mt-7\"><span class=\"share-bar-label\">Share:</span><div class=\"share-bar-nets\"><a class=\"share-net\" data-share-net=\"facebook\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"Facebook (opens in a new tab)\">{{i:facebook}}</a><a class=\"share-net\" data-share-net=\"x\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"X (opens in a new tab)\">{{i:x}}</a><a class=\"share-net\" data-share-net=\"linkedin\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"LinkedIn (opens in a new tab)\">{{i:linkedin}}</a><a class=\"share-net\" data-share-net=\"whatsapp\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"WhatsApp (opens in a new tab)\">{{i:whatsapp}}</a><a class=\"share-net\" data-share-net=\"email\" href=\"#\" target=\"_blank\" rel=\"noopener\" aria-label=\"Email\">{{i:mail}}</a><button class=\"share-net\" type=\"button\" data-share-copy aria-label=\"Copy link\">{{i:link-mark}}</button></div><button class=\"btn btn--sm\" type=\"button\" data-share>{{i:share}} Share</button><span class=\"news-share-ok small\" role=\"status\"></span></div>",
    help: `Questions about your plan? Contact our <a href="atendimento.html">customer service</a>.`,
    related: "Read also",
    all: "All content",
  },
};

module.exports = function () {
  const ROOT = path.join(__dirname, "..");
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "noticias.json"), "utf8"))
    .sort((a, b) => b.data.localeCompare(a.data));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const file = (n) => `noticia-${n.slug}.html`;

  for (const lang of ["pt", "en"]) {
    const U = UI[lang];
    const base = lang === "pt" ? __dirname : path.join(__dirname, "en");
    const pages = path.join(base, "pages"), partials = path.join(base, "partials");
    for (const d of [pages, partials]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    // texto da notícia no idioma (em inglês, os campos do bloco "en" substituem os em português)
    const news = all.filter((n) => lang === "pt" || n.en).map((n) => (lang === "pt" ? n : Object.assign({}, n, n.en)));

    // remove páginas geradas antes (inclusive as de notícias que saíram da lista)
    const keep = new Set(news.map(file));
    for (const f of fs.readdirSync(pages)) if (/^noticia-.+\.html$/.test(f)) fs.unlinkSync(path.join(pages, f));
    if (lang === "pt") for (const f of fs.readdirSync(ROOT)) if (/^noticia-.+\.html$/.test(f) && !keep.has(f)) fs.unlinkSync(path.join(ROOT, f));

    const card = (n, sizes = "(min-width:1100px) 30vw, 100vw") =>
      `<a class="card-post card-post--ext" data-cat="${n.cat}" href="${file(n)}">${n.foto ? `<div class="img">{{pic:${n.foto}||800|${sizes}}}</div>` : `<div class="img img--globe">{{> globe-art}}</div>`}` +
      `<div class="post-meta"><span class="cat">${U.cat[n.cat]}</span><time datetime="${n.data}">${U.date(n.data)}</time><span class="src-tag">${esc(U.org(n.orgao))}</span></div>` +
      `<h3>${esc(n.titulo)}</h3><p>${esc(n.resumo)}</p></a>`;

    fs.writeFileSync(path.join(partials, "noticias-cards.html"), news.map((n) => card(n)).join("\n") + "\n");

    news.forEach((n) => {
      const others = news.filter((o) => o !== n).sort((a, b) => (b.cat === n.cat) - (a.cat === n.cat)).slice(0, 3);
      const cat = U.cat[n.cat], org = esc(U.org(n.orgao));
      const meta = {
        title: `${n.titulo} | ${U.contents} | MedicGLOBAL`,
        description: n.resumo,
        active: "conteudos",
        og: n.foto || "old_hsl_fachada",
        crumbs: [[U.contents, "conteudos.html"], [cat, `conteudos.html#cat=${n.cat}`], [n.migalha, file(n)]],
        jsonld: [{ "@context": "https://schema.org", "@type": "NewsArticle", headline: n.titulo, inLanguage: lang === "pt" ? "pt-BR" : "en", datePublished: n.data, isBasedOn: n.fonteUrl, author: { "@type": "Organization", name: "MedicGLOBAL" }, publisher: { "@type": "Organization", name: "MedicGLOBAL" } }],
      };
      const secoes = n.secoes.map((s) => `        <h2>${esc(s.h)}</h2>\n${s.p.map((p) => `        <p>${esc(p)}</p>`).join("\n")}`).join("\n");
      const html = `<!--@${JSON.stringify(meta, null, 2)}@-->

<article class="news">
  <header class="page-hero" style="padding-bottom:48px">
    <div class="wrap">
      {{crumbs}}
      <a class="news-back" href="conteudos.html#cat=${n.cat}">{{i:chevron-left}} ${U.back(cat)}</a>
      <div class="post-meta mb-6"><span class="cat">${cat}</span><time datetime="${n.data}">${U.date(n.data)}</time><span>${esc(n.tema)}</span><span>${U.read(n.leitura)}</span></div>
      <h1 class="balance news-title">${esc(n.titulo)}</h1>
      <p class="news-src-line">${U.ref} <a href="${esc(n.fonteUrl)}" target="_blank" rel="noopener">${org}<span class="sr-only">${U.newTab}</span></a></p>
    </div>
  </header>
  <div class="wrap"><figure class="news-figure">${n.foto ? `<div class="img-round" style="aspect-ratio:21/9">{{pic:${n.foto}|${esc(n.alt)}|2000|(min-width:1360px) 1300px, 100vw|eager}}</div><figcaption>${U.caption}</figcaption>` : `<div class="img-round img--globe" style="aspect-ratio:21/9">{{> globe-art}}</div>`}</figure></div>
  <div class="section section--tight">
    <div class="wrap">
      <div class="prose news-body">
        <p class="lead">${esc(n.intro)}</p>
${secoes}
        <div class="news-source">
          <p class="news-source-label">${U.srcLabel}</p>
          <p>${U.srcLine(org, esc(n.fonteTitulo), U.date(n.data))}</p>
          <a class="btn btn--sm" href="${esc(n.fonteUrl)}" target="_blank" rel="noopener">${U.srcBtn}<span class="sr-only">${U.newTab}</span></a>
          <p class="xs muted">${U.disclaimer}</p>
        </div>
        ${U.shareBar}
        <p class="small mt-7">${U.help}</p>
        <a class="news-back mt-6" href="conteudos.html#cat=${n.cat}">{{i:chevron-left}} ${U.back(cat)}</a>
      </div>
    </div>
  </div>
</article>

<section class="section mist" aria-labelledby="rel-t">
  <div class="wrap">
    <div class="flex-between mb-7"><h2 id="rel-t" style="font-size:var(--t-h3)">${U.related}</h2><a class="link" href="conteudos.html#todos">${U.all}</a></div>
    <div class="card-grid">
${others.map((o) => "      " + card(o)).join("\n")}
    </div>
  </div>
</section>
`;
      fs.writeFileSync(path.join(pages, file(n)), html);
    });
  }
};
