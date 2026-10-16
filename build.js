/* MedicGLOBAL 2.0 — gerador estático sem dependências.
   Uso: node build.js
   Lê src/partials + src/pages e grava as páginas HTML na raiz do projeto.
   Toda informação operacional (links, telefones, registros) vive em src/data/site.json,
   para que atualizações regulatórias e de canais sejam feitas em um único lugar. */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const site = JSON.parse(fs.readFileSync(path.join(SRC, "data", "site.json"), "utf8"));
const icons = require("./src/data/icons.js");
const partial = (n) => fs.readFileSync(path.join(SRC, "partials", n + ".html"), "utf8");

function pic(spec) {
  // {{pic:chave|alt|largura máx.|sizes|eager}}
  const [key, alt = "", w = "1400", sizes = "100vw", eager] = spec.split("|");
  const id = site.photos[key];
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
  const v = k.split(".").reduce((a, p) => (a == null ? a : a[p]), o);
  if (v === undefined) throw new Error("Dado ausente em site.json: " + k);
  return v;
}

require("./src/gen-migracao.js")();
const pagesDir = path.join(SRC, "pages");
const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html"));
const sitemap = [];

for (const file of files) {
  const raw = fs.readFileSync(path.join(pagesDir, file), "utf8");
  const m = raw.match(/^<!--@([\s\S]*?)@-->\s*/);
  if (!m) throw new Error("Página sem cabeçalho de metadados: " + file);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const slug = file;
  const url = site.domain + (slug === "index.html" ? "" : slug.replace(/\.html$/, "/"));

  const crumbs = meta.crumbs || [];
  const crumbHtml = crumbs.length
    ? `<nav aria-label="Você está em"><ol class="crumbs"><li><a href="index.html">Início</a></li>${crumbs
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
      logo: site.domain + "assets/img/brand/logo-medicglobal.svg",
      address: { "@type": "PostalAddress", streetAddress: site.address.street, addressLocality: site.address.city, addressRegion: site.address.state, postalCode: site.address.zip, addressCountry: "BR" },
      contactPoint: [{ "@type": "ContactPoint", telephone: site.phones.central.e164, contactType: "customer service", areaServed: "BR", availableLanguage: "Portuguese" }],
    },
  ];
  if (crumbs.length) {
    ld.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [["Início", ""], ...crumbs].map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c[0], item: site.domain + (c[1] ? c[1].replace(/\.html.*$/, "/") : "") })),
    });
  }
  if (meta.jsonld) ld.push(...meta.jsonld);

  const ctx = {
    file,
    active: meta.active || "",
    title: meta.title,
    description: meta.description,
    canonical: url,
    ogImage: `https://images.unsplash.com/photo-${site.photos[meta.og || "family"]}?auto=format&fit=crop&w=1200&h=630&q=70`,
    crumbs: crumbHtml,
    headerClass: meta.headerDark ? " on-dark" : "",
    bodyClass: meta.bodyClass || "",
    jsonld: `<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld)}</script>`,
    extraHead: meta.extraHead || "",
    extraScripts: meta.extraScripts || "",
    year: String(new Date().getFullYear()),
    robots: meta.noindex ? "noindex, nofollow" : "index, follow",
  };
  const html = bust(render(partial("layout"), Object.assign({}, ctx, { content: body })));
  fs.writeFileSync(path.join(ROOT, file), html);
  if (!meta.noindex) sitemap.push(url);
  console.log("✓", file);
}

fs.writeFileSync(
  path.join(ROOT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`
);
fs.writeFileSync(path.join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /mapa-de-migracao.html\nSitemap: ${site.domain}sitemap.xml\n`);
console.log("✓ sitemap.xml, robots.txt");
