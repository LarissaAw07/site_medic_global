/* MedicGLOBAL 2.0 — gerador estático sem dependências.
   Uso: node build.js
   Lê src/partials + src/pages e grava as páginas HTML na raiz do projeto.
   Toda informação operacional (links, telefones, registros) vive em src/data/site.json,
   para que atualizações regulatórias e de canais sejam feitas em um único lugar.
   O painel (cms/) chama build({ content, outDir }): o conteúdo editado no painel é aplicado por cima de src/
   em memória (src/ nunca é alterado por ele) e o site é gravado em outDir. */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const icons = require("./src/data/icons.js");
const cms = require("./cms/html.js");
// Idiomas: português na raiz, inglês em /en/. Um partial em src/en/partials substitui o de src/partials na versão em inglês.
const LANGS = {
  pt: { dir: "", pages: path.join(SRC, "pages"), html: "pt-BR", og: "pt_BR", home: "Início", crumbsLabel: "Você está em", ldLang: "Portuguese" },
  en: { dir: "en", pages: path.join(SRC, "en", "pages"), html: "en", og: "en_US", home: "Home", crumbsLabel: "You are here", ldLang: "English" },
};
// páginas que os geradores (src/gen-*.js) recriam a cada build
const GENERATED = /^(noticia-.+|rn565(-agrupamento-\d{4})?|idss(-\d{4})?|mapa-de-migracao)\.html$/;

/* Sistema de arquivos "por cima" de src/: no build do painel, o que os geradores gravam em src/ fica em memória,
   e os dados editados (site.json, noticias.json) substituem os do repositório só neste build. */
function overlayFs(dataFiles) {
  const files = new Map(), gone = new Set();
  const key = (p) => path.resolve(p);
  const inSrc = (p) => key(p).startsWith(SRC + path.sep);
  const o = {
    readFileSync(p, enc) {
      const k = key(p);
      if (files.has(k)) return files.get(k);
      if (dataFiles[k] !== undefined) return dataFiles[k];
      if (gone.has(k)) throw new Error("ENOENT " + p);
      return fs.readFileSync(p, enc);
    },
    writeFileSync(p, s) { if (!inSrc(p)) throw new Error("Gravação fora de src/ no build do painel: " + p); files.set(key(p), String(s)); gone.delete(key(p)); },
    existsSync(p) { const k = key(p); return files.has(k) || (!gone.has(k) && fs.existsSync(p)); },
    mkdirSync() {},
    unlinkSync(p) { const k = key(p); files.delete(k); if (inSrc(p)) gone.add(k); },
    readdirSync(d) {
      const k = key(d);
      const real = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => !gone.has(path.join(k, f))) : [];
      const extra = [...files.keys()].filter((f) => path.dirname(f) === k).map((f) => path.basename(f));
      return [...new Set([...real, ...extra])].sort();
    },
  };
  return o;
}

const deepMerge = (a, b) => {
  if (!b || typeof b !== "object" || Array.isArray(b)) return b === undefined ? a : b;
  const out = Object.assign({}, a);
  for (const k of Object.keys(b)) out[k] = a && typeof a[k] === "object" && !Array.isArray(a[k]) ? deepMerge(a[k], b[k]) : b[k];
  return out;
};

/* Fontes do site já com o conteúdo do painel: usado pelo build e pelo painel (para listar os campos editáveis). */
function loadSources(content) {
  content = content || {};
  const baseSite = JSON.parse(fs.readFileSync(path.join(SRC, "data", "site.json"), "utf8"));
  const site = deepMerge(baseSite, content.site || {});
  const dataFiles = {};
  if (content.noticias) dataFiles[path.join(SRC, "data", "noticias.json")] = JSON.stringify(content.noticias);
  const vfs = content.virtual === false ? fs : overlayFs(dataFiles);
  // os geradores gravam as páginas deles em src/pages (em memória no build do painel)
  require("./src/gen-migracao.js")(vfs);
  require("./src/gen-noticias.js")(vfs);
  require("./src/gen-rn565.js")(vfs);
  require("./src/gen-idss.js")(vfs);
  return { site, vfs };
}

function build(opts = {}) {
  const content = opts.content || null;
  const outDir = opts.outDir || ROOT;
  const log = opts.log || console.log;
  const only = opts.only || null; // [lang, file] — visualização de uma página só
  const { site, vfs } = loadSources(content ? Object.assign({}, content, { virtual: true }) : { virtual: false });
  const pagesEdit = (content && content.pages) || {};
  const identity = (content && content.identity) || {};
  const report = { orphans: {} };
  let LANG = "pt";

  // aplica as edições do painel a um template (página ou partial)
  const withEdits = (key, raw) => {
    const e = pagesEdit[key];
    if (!e || !e.edits || !Object.keys(e.edits).length) return raw;
    const r = cms.apply(raw, e.edits);
    if (r.orphans.length) report.orphans[key] = r.orphans;
    return r.html;
  };
  const partial = (n) => {
    const en = path.join(SRC, "en", "partials", n + ".html");
    const useEn = LANG === "en" && vfs.existsSync(en);
    const raw = vfs.readFileSync(useEn ? en : path.join(SRC, "partials", n + ".html"), "utf8");
    return withEdits(`partial/${useEn ? "en" : "pt"}/${n}`, raw);
  };

  const photoPath = (key) => (key.startsWith("up:") ? "assets/uploads/" + key.slice(3) : site.photos[key]);
  function pic(spec) {
    // {{pic:chave|alt|largura máx.|sizes|eager}} — chave do site.json → photos, ou "up:arquivo" (imagem enviada pelo painel)
    const [key, alt = "", w = "1400", sizes = "100vw", eager] = spec.split("|");
    const id = photoPath(key);
    if (!id) throw new Error("Foto desconhecida: " + key);
    // Fotos locais (ex.: provisórias do site antigo em assets/img/provisorio/): arquivo único, sem srcset
    if (id.startsWith("assets/")) return `<img src="${id}" alt="${alt}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
    const max = parseInt(w, 10);
    const widths = [480, 800, 1200, 1600, 2000].filter((x) => x <= max);
    if (!widths.includes(max)) widths.push(max);
    const u = (x) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${x}&q=72`;
    return `<img src="${u(Math.min(max, 1200))}" srcset="${widths.map((x) => `${u(x)} ${x}w`).join(", ")}" sizes="${sizes}" alt="${alt}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  }

  // Versão nos endereços de CSS/JS locais (?v=hash do conteúdo): o servidor manda o navegador guardar esses
  // arquivos por anos, então sem isso a versão nova do estilo/script não chegaria a quem já visitou o site.
  const _ver = {};
  function bust(html) {
    return html.replace(/(href|src)="(assets\/(?:css|js)\/[\w.-]+\.(?:css|js))"/g, (_, attr, file) => {
      if (!_ver[file]) _ver[file] = require("crypto").createHash("md5").update(fs.readFileSync(path.join(ROOT, file))).digest("hex").slice(0, 8);
      return `${attr}="${file}?v=${_ver[file]}"`;
    });
  }

  // Imagem de compartilhamento: fotos locais (site antigo) saem com o endereço do domínio; as do Unsplash, recortadas em 1200×630
  function ogImage(key) {
    const id = photoPath(key);
    if (!id) throw new Error("Foto desconhecida (og): " + key);
    return id.startsWith("assets/") ? site.domain + id : `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&h=630&q=70`;
  }

  function render(tpl, ctx) {
    let out = tpl;
    for (let i = 0; i < 4; i++) {
      out = out
        .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, n) => partial(n))
        .replace(/\{\{i:([\w-]+)\}\}/g, (_, n) => {
          if (!icons[n]) throw new Error("Ícone desconhecido: " + n);
          return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[n]}</svg>`;
        })
        .replace(/\{\{pic:([^}]+)\}\}/g, (_, s) => pic(s))
        .replace(/\{\{photo:([\w-]+):(\d+)\}\}/g, (_, k, w) => `https://images.unsplash.com/photo-${site.photos[k]}?auto=format&fit=crop&w=${w}&q=70`)
        .replace(/\{\{act:([\w-]+)\}\}/g, (_, k) => (ctx.active === k ? " is-active" : ""))
        .replace(/\{\{cur:([\w-]+)\}\}/g, (_, k) => (ctx.active === k ? ' aria-current="page"' : ""))
        .replace(/\{\{L\.([\w.]+)\}\}/g, (_, k) => get(site, k))
        .replace(/\{\{([\w]+)\}\}/g, (m, k) => (ctx[k] !== undefined ? ctx[k] : m));
    }
    const left = out.match(/\{\{[^}]+\}\}/);
    if (left) throw new Error(`Token não resolvido em ${ctx.file}: ${left[0]}`);
    return out;
  }
  function get(o, k) {
    // na versão em inglês, site.json → "en" tem prioridade para textos (horários, avisos)
    const pick = (src) => k.split(".").reduce((a, p) => (a == null ? a : a[p]), src);
    const v = LANG === "en" && o === site && pick(site.en) !== undefined ? pick(site.en) : pick(o);
    if (v === undefined) throw new Error("Dado ausente em site.json: " + k);
    return v;
  }

  // identidade visual e integrações configuradas no painel (logo, favicon, Google Analytics, envio de formulários)
  function finish(html) {
    if (identity.logo) html = html.replace(/(<img class="logo-img logo-img--pos" src=")[^"]+(" )width="\d+" height="\d+"/g, `$1${identity.logo.path}$2width="${identity.logo.w}" height="${identity.logo.h}"`);
    if (identity.logoNeg) html = html.replace(/(<img class="logo-img logo-img--neg" src=")[^"]+(" )width="\d+" height="\d+"/g, `$1${identity.logoNeg.path}$2width="${identity.logoNeg.w}" height="${identity.logoNeg.h}"`);
    if (identity.favicon) html = html.replace(/<link rel="icon" href="[^"]+" type="[^"]+">/, `<link rel="icon" href="${identity.favicon.path}" type="${identity.favicon.type}">`);
    if (identity.faviconPng) html = html.replace(/<link rel="apple-touch-icon" href="[^"]+">/, `<link rel="apple-touch-icon" href="${identity.faviconPng.path}">`);
    if (content) {
      // na visualização do rascunho não há coleta nem envio de formulários
      const a = content.analytics || {}, live = !content.preview;
      const cfg = { ga: live && a.enabled && a.measurementId ? a.measurementId : "", gtm: live && a.enabled && a.gtmId ? a.gtmId : "", forms: live };
      // limite do anexo (Trabalhe conosco) definido no painel; o servidor aplica o mesmo limite
      const mb = (content.forms && content.forms.trabalhe_conosco && content.forms.trabalhe_conosco.maxUploadMB) || 10;
      html = html.replace(/data-max-bytes="\d+"/g, `data-max-bytes="${mb * 1048576}"`);
      html = html.replace("</head>", `<script>window.MG_CFG=${JSON.stringify(cfg)}</script>\n</head>`);
    }
    return html;
  }

  const sitemap = [];
  const pageUrl = (lang, file) => site.domain + (LANGS[lang].dir ? LANGS[lang].dir + "/" : "") + (file === "index.html" ? "" : file.replace(/.html$/, "/"));
  const hasPage = (lang, file) => vfs.existsSync(path.join(LANGS[lang].pages, file));
  const written = new Set();

  for (const lang of Object.keys(LANGS)) {
    LANG = lang;
    const L = LANGS[lang], other = lang === "pt" ? "en" : "pt";
    if (only && only[0] !== lang) continue;
    const langOut = path.join(outDir, L.dir);
    if (!fs.existsSync(langOut)) fs.mkdirSync(langOut, { recursive: true });
    const files = vfs.existsSync(L.pages) ? vfs.readdirSync(L.pages).filter((f) => f.endsWith(".html")) : [];
    // remove páginas em inglês que deixaram de existir na fonte
    if (L.dir && !only) for (const f of fs.readdirSync(langOut)) if (f.endsWith(".html") && !files.includes(f)) fs.unlinkSync(path.join(langOut, f));

    for (const file of files) {
      if (only && only[1] !== file) continue;
      if (content && file === "mapa-de-migracao.html") continue; // interno, não vai para o site publicado
      const raw = vfs.readFileSync(path.join(L.pages, file), "utf8");
      const m = raw.match(/^<!--@([\s\S]*?)@-->\s*/);
      if (!m) throw new Error("Página sem cabeçalho de metadados: " + lang + "/" + file);
      const pageKey = `${lang}/${file}`;
      const meta = Object.assign(JSON.parse(m[1]), (pagesEdit[pageKey] && pagesEdit[pageKey].meta) || {});
      const body = withEdits(pageKey, raw.slice(m[0].length));
      const url = pageUrl(lang, file);
      const twin = hasPage(other, file);
      // link para a mesma página no outro idioma (ou para a inicial dele, se a página não existir lá)
      const toOther = (lang === "pt" ? "en/" : "../") + (twin ? file : "index.html");
      const hrefPt = lang === "pt" ? file : toOther, hrefEn = lang === "en" ? file : toOther;
      const alternates = twin && !meta.noindex
        ? [["pt-BR", pageUrl("pt", file)], ["en", pageUrl("en", file)], ["x-default", pageUrl("pt", file)]].map(([h, u]) => `<link rel="alternate" hreflang="${h}" href="${u}">`).join("\n")
        : "";

      const crumbs = meta.crumbs || [];
      const crumbHtml = crumbs.length
        ? `<nav aria-label="${L.crumbsLabel}"><ol class="crumbs"><li><a href="index.html">${L.home}</a></li>${crumbs
            .map((c, i) => (i === crumbs.length - 1 ? `<li><span aria-current="page">${c[0]}</span></li>` : `<li><a href="${c[1]}">${c[0]}</a></li>`))
            .join("")}</ol></nav>`
        : "";

      const ld = [
        {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "MedicGLOBAL",
          alternateName: ["Medic Global", "Medic Global Saúde", "Extremamedic"],
          url: site.domain,
          logo: site.domain + (identity.logo ? identity.logo.path : "assets/img/brand/logo-medicglobal-saude.png"),
          address: Object.values(site.address).map((a) => ({ "@type": "PostalAddress", streetAddress: a.street + (a.district ? " - " + a.district : ""), addressLocality: a.city, addressRegion: a.state, postalCode: a.zip, addressCountry: "BR" })),
          contactPoint: [{ "@type": "ContactPoint", telephone: site.phones.central.e164, contactType: "customer service", areaServed: "BR", availableLanguage: ["Portuguese"] }],
        },
      ];
      if (crumbs.length) {
        ld.push({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [[L.home, ""], ...crumbs].map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c[0], item: site.domain + (L.dir ? L.dir + "/" : "") + (c[1] ? c[1].replace(/\.html.*$/, "/") : "") })),
        });
      }
      if (meta.jsonld) ld.push(...meta.jsonld);

      const ctx = {
        file,
        lang,
        htmlLang: L.html,
        ogLocale: L.og,
        ogLocaleAlt: LANGS[other].og,
        alternates,
        hrefPt,
        hrefEn,
        // a preferência de idioma salva só leva à outra versão quando a mesma página existe nela
        langRedirect: twin ? `<script>try{var l=localStorage.getItem("mg-lang");if(l&&l!=="${lang}")location.replace("${toOther}"+location.hash)}catch(e){}</script>` : "",
        active: meta.active || "",
        title: meta.title,
        description: meta.description,
        canonical: url,
        ogImage: ogImage(meta.og || "old_familia"),
        crumbs: crumbHtml,
        headerClass: meta.headerDark ? " on-dark" : "",
        bodyClass: meta.bodyClass || "",
        jsonld: `<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld)}</script>`,
        extraHead: meta.extraHead || "",
        extraScripts: meta.extraScripts || "",
        year: String(new Date().getFullYear()),
        robots: meta.noindex ? "noindex, nofollow" : "index, follow",
      };
      let html = finish(bust(render(partial("layout"), Object.assign({}, ctx, { content: body }))));
      // em /en/ os arquivos estáticos ficam um nível acima
      if (L.dir) html = html.replace(/(href|src)="assets\//g, '$1="../assets/');
      fs.writeFileSync(path.join(langOut, file), html);
      written.add(path.join(L.dir, file));
      if (!meta.noindex) sitemap.push(url);
      if (!opts.quiet) log("✓", (L.dir ? L.dir + "/" : "") + file);
    }
  }
  if (only) return report;
  LANG = "pt";

  // no build do painel, a pasta publicada só tem o que o build acabou de gerar (notícia removida some do site)
  if (outDir !== ROOT) for (const f of fs.readdirSync(outDir)) if (f.endsWith(".html") && !written.has(f)) fs.unlinkSync(path.join(outDir, f));

  fs.writeFileSync(
    path.join(outDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`
  );
  fs.writeFileSync(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /mapa-de-migracao.html\nDisallow: /admin\nSitemap: ${site.domain}sitemap.xml\n`);
  if (!opts.quiet) log("✓ sitemap.xml, robots.txt");
  return report;
}

module.exports = build;
module.exports.loadSources = loadSources;
module.exports.LANGS = LANGS;
module.exports.GENERATED = GENERATED;
if (require.main === module) build();
