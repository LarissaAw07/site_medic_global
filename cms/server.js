/* MedicGLOBAL — servidor do painel administrativo (/admin) e da API (/api), sem dependências.
   Uso: node cms/server.js   (porta: CMS_PORT, padrão 8788)
   - /admin            painel (login obrigatório)
   - /api/admin/*      API do painel (sessão + token anti-CSRF)
   - /api/forms/:nome  recebe os formulários do site
   - demais caminhos   site publicado (CMS_PUBLIC_DIR) — em produção o nginx serve esses arquivos direto
   Ao iniciar, o site é gerado de novo com o conteúdo publicado: um deploy de código nunca apaga as edições do painel. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const html = require("./html");
const images = require("./images");
const forms = require("./forms");
const ga = require("./ga");
const translate = require("./translate");
const build = require("../build.js");

const PORT = +process.env.CMS_PORT || 8788;
const ROOT = store.ROOT;
const ADMIN_UI = path.join(__dirname, "admin");
const COOKIE = "mg_admin";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".pdf": "application/pdf" };
// partials editáveis (componentes repetidos em várias páginas). Menu e rodapé (layout) ficam fora, por definição.
const PARTIALS = { "plan-cards": "Cards dos planos", "store-buttons": "Botões das lojas de aplicativo" };
// ordem do site (sequência do menu principal), usada na lista de páginas e no "anterior/próxima" do editor
const SITE_ORDER = [
  ["index.html", "Início"], ["beneficiario.html", "Para você"], ["planos.html", "Planos"], ["rede-credenciada.html", "Rede de cuidado"], ["guia-medico.html", "Rede de cuidado"],
  ["telemedicina.html", "Serviços"], ["servicos.html", "Serviços"], ["atendimento.html", "Atendimento"], ["contato.html", "Atendimento"],
  ["medicglobal.html", "MedicGLOBAL"], ["trabalhe-conosco.html", "MedicGLOBAL"], ["documentos.html", "MedicGLOBAL"],
  ["conteudos.html", "Conteúdos"], ["artigo-reajuste-2020.html", "Conteúdos"], ["privacidade.html", "Rodapé"], ["404.html", "Página de erro"],
];
function pageRank(p) {
  if (p.partial) return { group: "Componentes compartilhados", n: 0, area: "Usado em várias páginas" };
  const i = SITE_ORDER.findIndex(([f]) => f === p.file);
  if (i >= 0) return { group: "Páginas do site", n: i, area: SITE_ORDER[i][1] };
  const m = /^(rn565|idss)(?:-agrupamento)?(?:-(\d{4}))?\.html$/.exec(p.file);
  if (m) return { group: m[1] === "rn565" ? DOC_GROUPS.rn565 : DOC_GROUPS.idss, n: m[2] ? 3000 - +m[2] : 0, area: m[1] === "rn565" ? "RN 565" : "IDSS" };
  return { group: "Outras", n: 9999, area: "" };
}
// documentos renovados todo ano: cada um tem o seu menu e o cadastro de um novo ano
const DOC_GROUPS = { rn565: "Reajuste de contratos (RN 565)", idss: "IDSS" };
const GROUP_ORDER = ["Páginas do site", "Componentes compartilhados", DOC_GROUPS.rn565, DOC_GROUPS.idss, "Outras"];
function orderedPages(pages, lang) {
  return Object.values(pages).filter((p) => p.lang === lang && !/^noticia-/.test(p.file))
    .map((p) => Object.assign({ p }, pageRank(p)))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.n - b.n || a.p.file.localeCompare(b.p.file));
}

/* ---------- rotas do painel (registradas ao longo do arquivo) ---------- */
const routes = {};
const on = (method, p, fn, opts = {}) => (routes[method + " " + p] = Object.assign(fn, opts));

/* ---------- utilidades HTTP ---------- */
function headers(res, extra) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  for (const [k, v] of Object.entries(extra || {})) res.setHeader(k, v);
}
function json(res, status, body) {
  headers(res, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.writeHead(status);
  res.end(JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    const tooBig = () => Object.assign(new Error(`Arquivo ou conteúdo grande demais (máximo de ${(limit / 1048576).toFixed(1).replace(".", ",")} MB).`), { status: 413 });
    // passou do limite: descarta o resto (até 4× o limite, para conseguir responder com a mensagem); acima disso, corta a conexão
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; if (size > limit * 4 + 1048576) { reject(tooBig()); req.destroy(); } }
      else chunks.push(c);
    });
    req.on("end", () => (over ? reject(tooBig()) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
async function readJson(req, limit = 4 * 1024 * 1024) {
  const b = await readBody(req, limit);
  try { return JSON.parse(b.toString("utf8") || "{}"); } catch (e) { throw Object.assign(new Error("JSON inválido."), { status: 400 }); }
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const clientIp = (req) => (process.env.CMS_TRUST_PROXY === "1" && (req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "";
const isHttps = (req) => req.socket.encrypted || (process.env.CMS_TRUST_PROXY === "1" && req.headers["x-forwarded-proto"] === "https");
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return req.method === "GET";
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
function sendFile(res, file, cache) {
  const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  headers(res, { "Content-Type": type, "Cache-Control": cache || "no-cache" });
  if (type === "image/svg+xml") res.setHeader("Content-Security-Policy", "script-src 'none'");
  res.writeHead(200);
  fs.createReadStream(file).pipe(res);
}
// caminho seguro dentro de uma pasta (sem "..", sem arquivos ocultos)
function safeJoin(base, rel) {
  rel = decodeURIComponent(rel).replace(/\\/g, "/");
  if (rel.split("/").some((p) => p.startsWith("."))) return null;
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

/* ---------- fontes e campos editáveis ---------- */
let srcCache = { key: "", data: null };
function sources(content) {
  const key = crypto.createHash("md5").update(JSON.stringify([content.site, content.noticias, content.rn565, content.idss])).digest("hex");
  if (srcCache.key === key) return srcCache.data;
  const { site, vfs } = build.loadSources(Object.assign({}, content, { virtual: true }));
  const pages = {};
  for (const [lang, L] of Object.entries(build.LANGS)) {
    for (const file of vfs.readdirSync(L.pages).filter((f) => f.endsWith(".html"))) {
      if (file === "mapa-de-migracao.html") continue;
      const raw = vfs.readFileSync(path.join(L.pages, file), "utf8");
      const m = raw.match(/^<!--@([\s\S]*?)@-->\s*/);
      const meta = JSON.parse(m[1]);
      pages[`${lang}/${file}`] = { key: `${lang}/${file}`, lang, file, meta, src: raw.slice(m[0].length), generated: build.GENERATED.test(file) };
    }
  }
  for (const [n, title] of Object.entries(PARTIALS)) for (const lang of ["pt", "en"]) {
    const p = lang === "en" && vfs.existsSync(path.join(ROOT, "src/en/partials", n + ".html")) ? path.join(ROOT, "src/en/partials", n + ".html") : lang === "pt" ? path.join(ROOT, "src/partials", n + ".html") : null;
    if (p) pages[`partial/${lang}/${n}`] = { key: `partial/${lang}/${n}`, lang, file: n, partial: true, meta: { title }, src: vfs.readFileSync(p, "utf8") };
  }
  srcCache = { key, data: { site, pages } };
  return srcCache.data;
}
// nomes das páginas no painel (as demais usam o título da própria página)
const PAGE_NAMES = { "index.html": "Página inicial", "planos.html": "Planos", "rede-credenciada.html": "Rede credenciada", "guia-medico.html": "Guia médico", "telemedicina.html": "Telemedicina", "servicos.html": "Serviços", "beneficiario.html": "Área do beneficiário", "atendimento.html": "Atendimento e ouvidoria", "contato.html": "Contato", "medicglobal.html": "Institucional (MedicGLOBAL)", "conteudos.html": "Conteúdos", "documentos.html": "Documentos", "trabalhe-conosco.html": "Trabalhe conosco", "privacidade.html": "Política de privacidade", "404.html": "Página não encontrada (404)", "rn565.html": "Histórico de reajustes", "idss.html": "Histórico do IDSS" };
const pageTitle = (p) => {
  if (p.partial) return p.meta.title;
  if (PAGE_NAMES[p.file]) return PAGE_NAMES[p.file];
  const m = /^(?:rn565-agrupamento|idss)-(\d{4})\.html$/.exec(p.file);
  if (m) return (p.file.startsWith("idss") ? "IDSS " : "Agrupamento ") + m[1];
  return String(p.meta.title || p.file).split("|")[0].trim();
};

// token {{L.x}} existe em site.json?
const tokenCheck = (site) => (k) => k.split(".").reduce((a, p) => (a == null ? a : a[p]), site) !== undefined;

// valor de exibição de uma imagem (para a miniatura no painel)
function imageUrl(site, ref) {
  if (!ref) return "";
  if (ref.startsWith("up:")) return "/admin/media/" + ref.slice(3);
  if (ref.startsWith("assets/uploads/")) return "/admin/media/" + ref.slice(15);
  if (ref.startsWith("assets/")) return "/admin/site-assets/" + ref.slice(7);
  const id = site.photos[ref];
  if (!id) return "";
  return id.startsWith("assets/") ? "/admin/site-assets/" + id.slice(7) : `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=480&q=60`;
}
const uploadExists = (name) => /^[\w.-]+$/.test(name) && fs.existsSync(path.join(store.dirs.uploads, name)) && !name.endsWith(".json");
const uploadMeta = (name) => { try { return JSON.parse(fs.readFileSync(path.join(store.dirs.uploads, name + ".json"), "utf8")); } catch (e) { return null; } };

const DOC_DATA = ["rj-row", "rn-years", "rn-current", "rj-older-title", "agr-title", "agr-sub", "agr-cover", "agr-stats", "agr-tbl", "agr-plans", "agr-nav", "agr-years", "idss-dims", "idss-orig", "src-tag"];
function pageView(content, live, key) {
  const { site, pages } = sources(content);
  const p = pages[key];
  if (!p) return null;
  // nas páginas montadas a partir do cadastro de anos (RN 565 / IDSS), os dados de cada ano são editados no cadastro
  const { units, sections } = html.extract(p.src, p.generated && /^(rn565|idss)/.test(p.file) ? { dataClasses: DOC_DATA } : {});
  sections.forEach((s) => { if (s.includes) s.includes = s.includes.filter((n) => PARTIALS[n] && pages["partial/" + p.lang + "/" + n]).map((n) => ({ key: "partial/" + p.lang + "/" + n, title: PARTIALS[n] })); });
  const draftEdits = (content.pages[key] && content.pages[key].edits) || {};
  const liveEdits = (live.pages[key] && live.pages[key].edits) || {};
  const { map, orphans } = html.resolve(units, draftEdits);
  const liveMap = html.resolve(units, liveEdits).map;
  const out = units.map((u) => {
    const d = map.get(u.id), l = liveMap.get(u.id);
    const base = Object.assign({}, u.base);
    if (base.alt !== undefined) base.alt = decodeAttr(base.alt);
    if (base.placeholder !== undefined) base.placeholder = decodeAttr(base.placeholder);
    const value = Object.assign({}, base, d ? d.edit.value : {});
    const r = { id: u.id, kind: u.kind, label: u.label, sr: !!u.sr, data: !!u.data, tag: u.tag, cls: u.cls, base, value, edited: !!d, pending: JSON.stringify(d ? d.edit.value : null) !== JSON.stringify(l ? l.edit.value : null), limits: u.limits, link: u.link, partialText: !!u.partial };
    if (u.kind === "image" || u.kind === "pic") { r.preview = imageUrl(site, value.image); r.basePreview = imageUrl(site, base.image); r.decorative = !!u.decorative; }
    if (u.kind === "field") Object.assign(r, { form: u.form, name: u.name, type: u.type, hasPlaceholder: u.hasPlaceholder });
    if (u.kind === "link" && /^\{\{L\.[\w.]+\}\}$/.test(u.base.href)) r.linkedData = u.base.href.slice(4, -2);
    r.shared = [...new Set(tokensIn(value.html).concat(tokensIn(value.href)))];
    if (!p.generated) { const el = elsewhere(content, key, u); if (el.length) r.elsewhere = el.slice(0, 30).map((x) => x.title + (x.section ? " › " + x.section : "")); r.elsewhereCount = el.length; }
    return r;
  });
  const shared = sharedInfo(content, out.flatMap((u) => u.shared).concat(tokensIn(JSON.stringify(p.meta))));
  const metaEdit = (content.pages[key] && content.pages[key].meta) || {};
  const meta = p.partial ? null : {
    base: { title: p.meta.title || "", description: p.meta.description || "", og: p.meta.og || "old_familia" },
    value: Object.assign({ title: p.meta.title || "", description: p.meta.description || "", og: p.meta.og || "old_familia" }, metaEdit),
  };
  if (meta) { meta.ogPreview = imageUrl(site, meta.value.og); meta.limits = { title: Math.max(70, meta.base.title.length), description: Math.max(170, meta.base.description.length) }; }
  // posição na sequência do site e páginas vizinhas (para seguir a edição em ordem)
  const seq = orderedPages(pages, p.lang), rank = seq.find((x) => x.p.key === key);
  const same = seq.filter((x) => x.group === rank.group), pos = same.findIndex((x) => x.p.key === key);
  const nav = (x) => (x ? { key: x.p.key, title: pageTitle(x.p) } : null);
  const place = { group: rank.group, area: rank.area, pos: pos + 1, total: same.length, prev: nav(same[pos - 1]), next: nav(same[pos + 1]) };
  const ek = enKeyOf(key);
  const english = ek && pages[ek] ? { url: p.partial ? null : "en/" + p.file, pending: !!(content.enPending || {})[key], fields: Object.keys(((content.pages[ek] || {}).edits) || {}).length } : null;
  return { key, title: pageTitle(p), place, lang: p.lang, file: p.file, partial: !!p.partial, generated: p.generated, url: p.partial ? null : (p.lang === "en" ? "en/" : "") + p.file, meta, sections, units: out, orphans, shared, english };
}
const decodeAttr = (s) => String(s || "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/* Valida e grava no rascunho as alterações de uma página. Nada é gravado se algum campo for inválido. */
function savePage(content, key, body) {
  const { site, pages } = sources(content);
  const p = pages[key];
  if (!p) return { status: 404, error: "Página não encontrada." };
  const { units, sections } = html.extract(p.src);
  const entry = content.pages[key] || { edits: {}, meta: {} };
  entry.edits = entry.edits || {}; entry.meta = entry.meta || {};
  const current = html.resolve(units, entry.edits).map;
  // o que mudou, para a auditoria: [{ field, before, after }]
  const changes = [];
  const secOf = (id) => { const s = sections.find((x) => x.units.includes(id)); return s ? s.label + " › " : ""; };
  const note = (u, prev, next) => {
    for (const k of Object.keys(Object.assign({}, prev, next))) {
      if (String(prev[k] == null ? "" : prev[k]) === String(next[k] == null ? "" : next[k])) continue;
      changes.push({ field: secOf(u.id) + u.label + (VALUE_NAMES[k] ? " (" + VALUE_NAMES[k] + ")" : ""), before: summarize(k, prev[k]), after: summarize(k, next[k]) });
    }
  };
  // edição atual de cada campo indexada pelo id do campo no template de hoje
  const editsByUnit = {};
  for (const [uid, { edit }] of current) editsByUnit[uid] = edit;
  const errors = {};
  const valid = tokenCheck(site);
  const len = (s) => html.plain(String(s || "")).length;

  for (const [id, raw] of Object.entries(body.edits || {})) {
    const u = units.find((x) => x.id === id);
    if (!u) { errors[id] = "Campo não encontrado (a página pode ter sido atualizada; recarregue)."; continue; }
    const prevValue = editsByUnit[id] ? editsByUnit[id].value : baseValue(u);
    if (raw === null) { note(u, prevValue, baseValue(u)); delete editsByUnit[id]; continue; } // restaurar o original
    const v = {}, e = [];
    if (u.kind === "text" || (u.kind === "link" && u.range)) {
      const h = html.sanitizeHtml(raw.html, valid);
      if (!html.plain(h)) e.push("O texto não pode ficar vazio.");
      if (len(h) > u.limits.html) e.push(`Máximo de ${u.limits.html} caracteres (atual: ${len(h)}).`);
      v.html = h;
    }
    if (u.kind === "link") {
      const href = String(raw.href || "").trim();
      if (!html.validHref(href, valid)) e.push("Destino inválido. Use https://…, mailto:, tel:, #âncora ou uma página do site (ex.: planos.html).");
      if (href.length > 500) e.push("Endereço longo demais (máx. 500).");
      v.href = href; v.newTab = !!raw.newTab;
    }
    if (u.kind === "image" || u.kind === "pic") {
      const img = String(raw.image || "");
      const alt = String(raw.alt == null ? "" : raw.alt).trim();
      if (u.kind === "pic" && !(img === u.base.image || site.photos[img] || (img.startsWith("up:") && uploadExists(img.slice(3))))) e.push("Imagem inválida: envie um arquivo pela biblioteca de mídia.");
      if (u.kind === "image" && !(img === u.base.image || (img.startsWith("assets/uploads/") && uploadExists(img.slice(15))))) e.push("Imagem inválida: envie um arquivo pela biblioteca de mídia.");
      if (alt.length > 160) e.push("Texto alternativo: máximo de 160 caracteres.");
      if (!alt && !u.decorative && u.base.alt) e.push("Descreva a imagem (texto alternativo) para acessibilidade.");
      if (/[|{}<>]/.test(alt)) e.push("O texto alternativo não pode conter | { } < >.");
      v.image = img; v.alt = alt;
    }
    if (u.kind === "field") {
      const ph = String(raw.placeholder || "").trim();
      if (ph.length > 90) e.push("Texto de exemplo: máximo de 90 caracteres.");
      const ml = raw.maxlength === "" || raw.maxlength == null ? "" : +raw.maxlength;
      if (ml !== "" && (!Number.isInteger(ml) || ml < 1 || ml > 10000)) e.push("Tamanho máximo: número inteiro entre 1 e 10000.");
      v.placeholder = ph; v.required = !!raw.required; v.maxlength = ml === "" ? "" : String(ml);
    }
    if (e.length) { errors[id] = e.join(" "); continue; }
    // igual ao original: não guarda edição
    const base = baseValue(u);
    const same = Object.keys(v).every((k) => String(v[k]) === String(base[k]));
    note(u, prevValue, Object.assign({}, base, v));
    if (same) delete editsByUnit[id]; else editsByUnit[id] = { kind: u.kind, base: u.base, value: v };
  }
  if (body.meta && !p.partial) {
    const m = body.meta, base = p.meta;
    const lim = { title: Math.max(70, (base.title || "").length), description: Math.max(170, (base.description || "").length) };
    const META_NAMES = { title: "Título da página", description: "Descrição no Google", og: "Imagem de compartilhamento" };
    const noteMeta = (k, s) => { const prev = entry.meta[k] !== undefined ? entry.meta[k] : base[k] || (k === "og" ? "old_familia" : ""); if (prev !== s) changes.push({ field: "Google e compartilhamento › " + META_NAMES[k], before: prev, after: s }); };
    for (const k of ["title", "description"]) if (m[k] !== undefined) {
      const s = String(m[k]).trim();
      const badTok = (s.match(/\{\{\s*L\.([\w.]+)\s*\}\}/g) || []).find((t) => !valid(t.replace(/^\{\{\s*L\.|\s*\}\}$/g, "")));
      if (!s) errors["meta." + k] = "Campo obrigatório.";
      else if (s.length > lim[k]) errors["meta." + k] = `Máximo de ${lim[k]} caracteres (atual: ${s.length}).`;
      else if (/[<>]/.test(s)) errors["meta." + k] = "Não use < ou >.";
      else if (badTok || /\{\{(?!\s*L\.)/.test(s)) errors["meta." + k] = "Trecho entre {{ }} inválido.";
      else { noteMeta(k, s); if (s === base[k]) delete entry.meta[k]; else entry.meta[k] = s; }
    }
    if (m.og !== undefined) {
      if (!(site.photos[m.og] || (m.og.startsWith("up:") && uploadExists(m.og.slice(3))))) errors["meta.og"] = "Imagem de compartilhamento inválida.";
      else { noteMeta("og", m.og); if (m.og === (base.og || "old_familia")) delete entry.meta.og; else entry.meta.og = m.og; }
    }
  }
  if (Object.keys(errors).length) return { status: 422, error: "Alguns campos não foram salvos. Corrija os itens destacados.", fields: errors };
  entry.edits = editsByUnit;
  if (!Object.keys(entry.edits).length && !Object.keys(entry.meta).length) delete content.pages[key]; else content.pages[key] = entry;
  return { ok: true, changes };
}
const baseValue = (u) => {
  const b = Object.assign({}, u.base);
  if (b.alt !== undefined) b.alt = decodeAttr(b.alt);
  if (b.placeholder !== undefined) b.placeholder = decodeAttr(b.placeholder);
  return b;
};
const VALUE_NAMES = { href: "destino", newTab: "nova aba", image: "imagem", alt: "texto alternativo", placeholder: "texto de exemplo", required: "obrigatório", maxlength: "máximo de caracteres" };
function summarize(k, v) {
  if (v == null || v === "") return "";
  if (k === "html") return html.plain(String(v)).slice(0, 400);
  if (k === "newTab" || k === "required") return v ? "sim" : "não";
  if (k === "image") return String(v).replace(/^up:|^assets\/uploads\//, "");
  return String(v).slice(0, 400);
}

/* ---------- dados compartilhados ({{L.x}}): um valor, vários lugares do site ---------- */
const SHARED_NAMES = {
  address: "Endereço", pousoAlegre: "Sede Pouso Alegre", extrema: "Sede Extrema", street: "Rua e número", district: "Bairro", city: "Cidade", state: "UF", zip: "CEP",
  phones: "Telefone", central: "Central de atendimento", abramge: "ABRAMGE", label: "número exibido", tel: "número para discagem", e164: "formato internacional", ouvidoriaHours: "Horário da ouvidoria",
  wa: "WhatsApp", autorizacoes: "Autorizações", faturamento: "Faturamento", financeiro: "Financeiro", comercial: "Comercial", geral: "Geral", url: "link",
  mail: "E-mail", ouvidoria: "Ouvidoria", links: "Link", docs: "Documento (PDF)", legal: "Dados da empresa", razao: "Razão social", cnpj: "CNPJ", ans: "Registro ANS", domain: "Domínio do site",
};
// derivados do endereço (montados a partir de rua, bairro, cidade, UF e CEP): não são editados direto
const DERIVED = /^address\.\w+\.(full|maps|embed)$/;
const sharedLabel = (p) => p.split(".").map((k) => SHARED_NAMES[k] || k).join(" · ");
const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split("."), last = ks.pop();
  let cur = o;
  for (const k of ks) cur = cur[k] = cur[k] && typeof cur[k] === "object" ? cur[k] : {};
  if (v === undefined) delete cur[last]; else cur[last] = v;
}
const baseSite = () => JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/site.json"), "utf8"));
const tokensIn = (s) => [...String(s || "").matchAll(/\{\{L\.([\w.]+)\}\}/g)].map((m) => m[1]);
// quantas vezes cada dado aparece no site (páginas em português, componentes e menu/rodapé)
let tokenUses = { key: "", map: null };
function sharedUses(content) {
  const { pages } = sources(content);
  if (tokenUses.key === srcCache.key) return tokenUses.map;
  const map = {};
  const count = (src) => tokensIn(src).forEach((t) => (map[t] = (map[t] || 0) + 1));
  Object.values(pages).filter((p) => p.lang === "pt").forEach((p) => { count(p.src); count(JSON.stringify(p.meta)); });
  count(fs.readFileSync(path.join(ROOT, "src/partials/layout.html"), "utf8"));
  tokenUses = { key: srcCache.key, map };
  return map;
}
function sharedInfo(content, paths) {
  const base = baseSite(), { site } = sources(content), uses = sharedUses(content), out = {};
  for (const p of new Set(paths)) {
    const b = getPath(base, p);
    if (b === undefined || typeof b === "object" || p.startsWith("en.") || p.startsWith("photos.")) continue;
    // partes do endereço também contam onde aparecem o endereço completo e os links do mapa
    const part = /^(address\.\w+)\.(street|district|city|state|zip)$/.exec(p);
    const n = (uses[p] || 0) + (part ? ["full", "maps", "embed"].reduce((a, k) => a + (uses[part[1] + "." + k] || 0), 0) : 0);
    out[p] = { label: sharedLabel(p), value: String(getPath(site, p)), base: String(b), type: fieldType(p, String(b)), uses: n || 1, derived: DERIVED.test(p) };
  }
  return out;
}
// grava no rascunho os dados compartilhados alterados; textos com versão em inglês (site.json → en) são traduzidos
async function saveShared(content, values, changes) {
  const base = baseSite(), errors = {}, toTranslate = [];
  const over = JSON.parse(JSON.stringify(content.site || {}));
  for (const [p, raw] of Object.entries(values || {})) {
    const b = getPath(base, p);
    if (b === undefined || typeof b === "object" || DERIVED.test(p) || /^(en|photos)\./.test(p)) { errors["shared." + p] = "Dado não editável."; continue; }
    const v = String(raw).trim(), prev = String(getPath(over, p) !== undefined ? getPath(over, p) : b);
    const e = validSiteValue(fieldType(p, String(b)), v);
    if (e) { errors["shared." + p] = e; continue; }
    if (v === prev) continue;
    changes.push({ field: "Dado compartilhado › " + sharedLabel(p), before: prev, after: v });
    setPath(over, p, v === String(b) ? undefined : v);
    if (getPath(base.en || {}, p) !== undefined) toTranslate.push(p);
  }
  if (Object.keys(errors).length) return { errors };
  let warn = "";
  if (toTranslate.length) {
    try {
      const tr = await translate.translateItems(toTranslate.map((p) => ({ text: String(getPath(over, p) !== undefined ? getPath(over, p) : getPath(base, p)) })));
      toTranslate.forEach((p, i) => setPath(over, "en." + p, getPath(over, p) === undefined ? undefined : tr[i].text));
    } catch (e) { warn = "O texto em inglês deste dado não pôde ser traduzido agora (" + e.message + ")."; }
  }
  content.site = over;
  return { warn };
}

/* ---------- textos repetidos: o mesmo conteúdo em vários lugares do site ---------- */
const dupSig = (u) => (u.kind === "text" || (u.kind === "link" && u.range)) && html.plain(u.base.html || "").length >= 3 ? u.kind + "|" + JSON.stringify(u.base) : null;
let dupCache = { key: "", map: null };
function dupIndex(content) {
  const { pages } = sources(content);
  if (dupCache.key === srcCache.key) return dupCache.map;
  const map = new Map();
  for (const p of Object.values(pages)) {
    if (p.lang !== "pt") continue;
    const { units, sections } = html.extract(p.src);
    for (const u of units) {
      const sig = dupSig(u);
      if (!sig) continue;
      if (!map.has(sig)) map.set(sig, []);
      const sec = sections.find((s) => s.units.includes(u.id));
      map.get(sig).push({ key: p.key, id: u.id, title: pageTitle(p), section: sec ? sec.label : "" });
    }
  }
  dupCache = { key: srcCache.key, map };
  return map;
}
const elsewhere = (content, key, u) => { const sig = dupSig(u); return sig ? (dupIndex(content).get(sig) || []).filter((x) => !(x.key === key && x.id === u.id)) : []; };

/* ---------- versão em inglês: gerada a partir das edições em português ---------- */
const enKeyOf = (k) => (k.startsWith("partial/pt/") ? "partial/en/" + k.slice(11) : k.startsWith("pt/") ? "en/" + k.slice(3) : null);
// casa os campos das duas versões pela estrutura (as páginas em inglês têm a mesma marcação das em português)
function alignUnits(a, b) {
  const sig = (u) => u.kind + "|" + u.tag + "|" + (u.cls || "") + "|" + (u.range ? 1 : 0);
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = sig(a[i]) === sig(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = new Map();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (sig(a[i]) === sig(b[j])) { out.set(a[i].id, b[j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return out;
}
/* Recalcula a versão em inglês das páginas indicadas (chaves em português). Só os campos alterados em português
   ganham tradução; o restante do inglês continua o original do site. Falha do tradutor: o português fica salvo,
   e a página entra em content.enPending para nova tentativa (no próximo salvamento ou na publicação). */
async function syncEnglish(content, ptKeys) {
  const { pages } = sources(content);
  const plans = [], items = [];
  const ask = (it) => items.push(it) - 1;
  for (const ptKey of new Set(ptKeys)) {
    const enKey = enKeyOf(ptKey), pt = pages[ptKey], en = enKey && pages[enKey];
    if (!pt || !en) continue;
    const ptUnits = html.extract(pt.src).units, enUnits = html.extract(en.src).units;
    const align = alignUnits(ptUnits, enUnits);
    const ptEntry = content.pages[ptKey] || {};
    const edits = [];
    for (const { unit: u, edit } of html.resolve(ptUnits, ptEntry.edits || {}).map.values()) {
      const eu = align.get(u.id);
      if (!eu) continue;
      const v = edit.value, pb = baseValue(u), eb = baseValue(eu), out = {}, tr = {};
      for (const k of Object.keys(v)) {
        const changed = String(v[k]) !== String(pb[k]);
        if (!changed) { out[k] = eb[k] !== undefined ? eb[k] : v[k]; continue; }
        if (k === "html") tr.html = ask({ html: v.html });
        else if (k === "alt" || k === "placeholder") tr[k] = ask({ text: v[k] });
        else out[k] = v[k];
      }
      edits.push({ eu, out, tr });
    }
    const meta = {}, metaTr = {};
    for (const [k, val] of Object.entries(ptEntry.meta || {})) { if (k === "og") meta.og = val; else metaTr[k] = ask({ text: val }); }
    plans.push({ ptKey, enKey, edits, meta, metaTr });
  }
  let res = [];
  try { res = items.length ? await translate.translateItems(items) : []; }
  catch (e) {
    content.enPending = Object.assign(content.enPending || {}, Object.fromEntries(plans.map((p) => [p.ptKey, true])));
    return { error: "A versão em inglês não pôde ser traduzida agora (" + e.message + "). O português foi salvo; a tradução será tentada de novo ao salvar ou publicar." };
  }
  const got = (i) => res[i].html !== undefined ? res[i].html : res[i].text;
  for (const p of plans) {
    const edits = {};
    for (const { eu, out, tr } of p.edits) {
      const value = Object.assign({}, out);
      for (const [k, i] of Object.entries(tr)) value[k] = k === "html" ? html.sanitizeHtml(got(i), tokenCheck(sources(content).site)) : got(i).replace(/[|{}<>]/g, "");
      edits[eu.id] = { kind: eu.kind, base: eu.base, value, auto: true };
    }
    const meta = Object.assign({}, p.meta);
    for (const [k, i] of Object.entries(p.metaTr)) meta[k] = got(i).replace(/[<>]/g, "");
    if (Object.keys(edits).length || Object.keys(meta).length) content.pages[p.enKey] = { edits, meta, auto: true }; else delete content.pages[p.enKey];
    if (content.enPending) delete content.enPending[p.ptKey];
  }
  if (content.enPending && !Object.keys(content.enPending).length) delete content.enPending;
  return { ok: true };
}
// nomes das páginas (para a auditoria)
const pageNames = () => { const { pages } = sources(store.content.draft()); return Object.fromEntries(Object.values(pages).map((p) => [p.key, pageTitle(p) + (p.lang === "en" ? " (inglês)" : "")])); };

/* ---------- dados do site.json: tipo e validação ---------- */
function fieldType(p, v) {
  if (/^https?:\/\//.test(v) || /\.(url|maps|embed)$/.test(p) || /^(links|docs)\./.test(p) || p === "domain") return "url";
  if (/^tel:/.test(v)) return "tel";
  if (/^mail\./.test(p)) return "email";
  return "text";
}
function validSiteValue(type, v, base) {
  if (v.length > 500) return "Máximo de 500 caracteres.";
  if (!v.trim()) return "Campo obrigatório.";
  if (type === "url" && !(/^https?:\/\/[^\s<>"]+$/.test(v) || /^[\w-]+\.html$/.test(v))) return "Use um endereço completo (https://…).";
  if (type === "tel" && !/^tel:\+?\d{6,15}$/.test(v)) return "Use o formato tel:+5535999999999.";
  if (type === "email" && !forms.EMAIL.test(v)) return "E-mail inválido.";
  if (/[<>{}]/.test(v)) return "Não use < > { }.";
  return "";
}

/* ---------- Notícias ---------- */
function validateNews(list, site) {
  const errs = [];
  if (!Array.isArray(list)) return ["Formato inválido."];
  const slugs = new Set();
  const txt = (n, k, max, req = true) => { const v = n[k]; if ((v == null || String(v).trim() === "") ? req : String(v).length > max || /[<>]/.test(v)) errs.push(`"${n.titulo || n.slug || "?"}": ${k} ${v ? `tem mais de ${max} caracteres ou usa < >` : "é obrigatório"}.`); };
  list.forEach((n) => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n.slug || "") || n.slug.length > 90) errs.push(`Endereço (slug) inválido: "${n.slug}". Use letras minúsculas, números e hífens.`);
    if (slugs.has(n.slug)) errs.push(`Endereço repetido: ${n.slug}`); slugs.add(n.slug);
    if (!["noticias", "comunicados"].includes(n.cat)) errs.push(`"${n.titulo}": categoria inválida.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.data || "")) errs.push(`"${n.titulo}": data inválida.`);
    if (!(Number.isInteger(+n.leitura) && +n.leitura >= 1 && +n.leitura <= 60)) errs.push(`"${n.titulo}": tempo de leitura entre 1 e 60 min.`);
    txt(n, "titulo", 140); txt(n, "resumo", 300); txt(n, "intro", 1200); txt(n, "orgao", 60); txt(n, "tema", 60); txt(n, "migalha", 60); txt(n, "fonteTitulo", 220);
    if (!/^https:\/\/[^\s<>"]+$/.test(n.fonteUrl || "")) errs.push(`"${n.titulo}": link da fonte precisa começar com https://.`);
    if (n.foto && !(site.photos[n.foto] || (n.foto.startsWith("up:") && uploadExists(n.foto.slice(3))))) errs.push(`"${n.titulo}": imagem inválida.`);
    if (n.foto) txt(n, "alt", 160);
    const secs = (x) => { if (!Array.isArray(x.secoes) || x.secoes.length > 15) return errs.push(`"${n.titulo}": seções inválidas.`); x.secoes.forEach((s) => { if (!s.h || String(s.h).length > 140 || /[<>]/.test(s.h)) errs.push(`"${n.titulo}": título de seção vazio ou longo demais.`); if (!Array.isArray(s.p) || !s.p.length || s.p.some((p) => !String(p).trim() || String(p).length > 2000 || /[<>]/.test(p))) errs.push(`"${n.titulo}": parágrafos vazios, longos demais (2000) ou com < >.`); }); };
    secs(n);
    if (n.en) { for (const k of ["titulo", "resumo", "intro", "tema", "migalha"]) if (!n.en[k]) errs.push(`"${n.titulo}" (inglês): ${k} é obrigatório — ou remova a versão em inglês.`); if (n.en.secoes) secs(n.en); }
  });
  return errs;
}

/* Versão em inglês das notícias: só o que mudou em português é traduzido de novo (o resto do inglês fica como estava). */
const NEWS_TEXT = ["titulo", "resumo", "intro", "tema", "migalha", "alt"];
async function newsEnglish(list, prev) {
  const items = [], jobs = [];
  const ask = (text, set) => { jobs.push(set); items.push({ text }); };
  for (const n of list) {
    const p = prev.find((x) => x.slug === n.slug);
    const old = p && p.en ? JSON.parse(JSON.stringify(p.en)) : null;
    const oldSecs = (old && old.secoes) || [];
    const en = n.en = old || {};
    for (const k of NEWS_TEXT) {
      if (!n[k]) { delete en[k]; continue; }
      if (!(old && p[k] === n[k] && old[k])) ask(n[k], (v) => (en[k] = v));
    }
    en.secoes = [];
    n.secoes.forEach((sec, i) => {
      const ps = p && p.secoes[i], os = oldSecs[i];
      const es = en.secoes[i] = { h: "", p: [] };
      if (os && ps.h === sec.h) es.h = os.h; else ask(sec.h, (v) => (es.h = v));
      sec.p.forEach((t, j) => { if (os && ps.p[j] === t && os.p[j]) es.p[j] = os.p[j]; else ask(t, (v) => (es.p[j] = v)); });
    });
  }
  try { (items.length ? await translate.translateItems(items) : []).forEach((r, i) => jobs[i](r.text.replace(/[<>]/g, ""))); }
  catch (e) { return { error: "A notícia não foi salva porque a tradução automática para o inglês falhou (" + e.message + "). Tente de novo em instantes." }; }
  return { ok: true };
}
const NEWS_NAMES = { titulo: "Título", resumo: "Resumo", intro: "Parágrafo de abertura", tema: "Tema", migalha: "Nome curto", alt: "Texto alternativo da imagem", foto: "Imagem", cat: "Categoria", data: "Data", leitura: "Leitura (min)", orgao: "Órgão / fonte", fonteTitulo: "Título da fonte", fonteUrl: "Link da fonte", slug: "Endereço da página" };
function newsAudit(user, prev, list) {
  for (const n of list) {
    const p = prev.find((x) => x.slug === n.slug);
    if (!p) { store.audit(user, "noticia_criada", n.titulo, [{ field: "Título", before: "", after: n.titulo }]); continue; }
    const ch = Object.keys(NEWS_NAMES).filter((k) => String(p[k] == null ? "" : p[k]) !== String(n[k] == null ? "" : n[k])).map((k) => ({ field: NEWS_NAMES[k], before: String(p[k] == null ? "" : p[k]), after: String(n[k] == null ? "" : n[k]) }));
    n.secoes.forEach((sec, i) => {
      const ps = p.secoes[i] || { h: "", p: [] };
      if (ps.h !== sec.h) ch.push({ field: `Seção ${i + 1} › título`, before: ps.h, after: sec.h });
      if (ps.p.join("\n\n") !== sec.p.join("\n\n")) ch.push({ field: `Seção ${i + 1} › parágrafos`, before: ps.p.join(" ¶ ").slice(0, 400), after: sec.p.join(" ¶ ").slice(0, 400) });
    });
    for (let i = n.secoes.length; i < p.secoes.length; i++) ch.push({ field: `Seção ${i + 1}`, before: p.secoes[i].h, after: "(removida)" });
    if (ch.length) store.audit(user, "noticia_alterada", n.titulo, ch);
  }
  for (const p of prev) if (!list.find((x) => x.slug === p.slug)) store.audit(user, "noticia_removida", p.titulo, [{ field: "Título", before: p.titulo, after: "" }]);
}

/* ---------- documentos renovados todo ano: RN 565 (reajuste) e IDSS ----------
   O painel cadastra, edita e remove anos. Os textos em inglês dessas páginas são montados pelos geradores
   (src/gen-rn565.js, src/gen-idss.js) a partir dos números, então não dependem de tradução. */
const DOCS = {
  rn565: { file: "rn565.json", list: "anos" },
  idss: { file: "idss.json", list: "registros" },
};
const docsData = (content, type) => content[type] || JSON.parse(fs.readFileSync(path.join(ROOT, "src/data", DOCS[type].file), "utf8"));
const DATE = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(20\d\d)$/;
const SCORE = /^[01],\d{4}$/;
const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const isDocFile = (p) => /^assets\/img\/idss\/[\w.-]+$/.test(p) ? fs.existsSync(path.join(ROOT, p)) : /^assets\/uploads\/[\w.-]+$/.test(p) && uploadExists(p.slice(15));
// RN 565: um ano = percentual, período e a relação de contratos (ou um PDF com a relação)
function rnYear(b, prev, errors) {
  const ano = +b.ano;
  const a = Object.assign({}, prev || {}, {
    ano, percentual: clean(b.percentual, 12), inicio: clean(b.inicio, 10), fim: clean(b.fim, 10),
    botaoOriginal: (prev && prev.botaoOriginal) || "Ver Agrupamento", linkOriginal: (prev && prev.linkOriginal) || "",
  });
  if (a.percentual && !/^\d{1,3}(,\d{1,2})?%$/.test(a.percentual)) errors.percentual = "Use o formato 8,70%.";
  if (!DATE.test(a.inicio)) errors.inicio = "Data no formato DD/MM/AAAA.";
  if (!DATE.test(a.fim)) errors.fim = "Data no formato DD/MM/AAAA.";
  a.descricao = `Percentual de reajuste a ser aplicado ao agrupamento de contratos com até 30 vidas, no período de ${a.inicio} a ${a.fim}` + (a.percentual ? `: ${a.percentual}` : "");
  const rows = Array.isArray(b.contratos) ? b.contratos : [];
  if (rows.length > 5000) errors.contratos = "No máximo 5000 contratos.";
  a.contratos = rows.map((c) => ({ contrato: clean(c.contrato, 20), plano: clean(c.plano, 120), registro: clean(c.registro, 20) })).filter((c) => c.contrato || c.plano);
  if (a.contratos.some((c) => !c.contrato || !c.plano || /[<>{}]/.test(c.contrato + c.plano + c.registro))) errors.contratos = "Cada linha precisa de contrato e plano (sem < > { }).";
  if (b.pdfFile !== undefined) a.pdfFile = b.pdfFile || undefined;
  if (a.pdfFile && !(/^assets\/uploads\/[\w-]+\.pdf$/.test(a.pdfFile) && uploadExists(a.pdfFile.slice(15)))) errors.pdfFile = "Envie o PDF pelo botão deste campo.";
  if (!a.contratos.length) delete a.contratos;
  if (!a.contratos && !a.pdfFile && !a.pdf) errors.contratos = "Informe a relação de contratos ou envie o PDF do agrupamento.";
  return a;
}
// IDSS: um ano = nota geral, notas por dimensão e as imagens do resultado divulgado pela ANS
function idssYear(b, prev, latest, errors) {
  const ano = +b.ano, anoBase = +b.anoBase || ano - 1;
  const r = Object.assign({}, prev || {}, { ano, anoBase, descricao: `IDSS Referente a ${ano} (Ano Base ${anoBase})`, titulo: `IDSS ANO ${ano}`, subtitulo: `IDSS Referente a ${ano} (Ano Base ${anoBase})` });
  r.botaoOriginal = r.botaoOriginal || "Visualizar"; r.origem = r.origem || "";
  const res = b.resultado || {};
  r.resultado = { nota: clean(res.nota, 6), dim: [0, 1, 2, 3].map((i) => clean((res.dim || [])[i], 6)), acred: clean(res.acred, 120) || "Operadora não bonificada", bonus: clean(res.bonus, 120) || "0,0000 · Operadora não bonificada" };
  if (!SCORE.test(r.resultado.nota)) errors.nota = "Nota no formato 0,4859.";
  if (r.resultado.dim.some((d) => !SCORE.test(d))) errors.dim = "As quatro notas por dimensão no formato 0,2715.";
  if (/[<>{}]/.test(r.resultado.acred + r.resultado.bonus)) errors.acred = "Não use < > { }.";
  const imgs = (Array.isArray(b.imagens) ? b.imagens : []).map(String);
  if (!imgs.length) errors.imagens = "Envie ao menos uma imagem do resultado divulgado pela ANS.";
  if (imgs.length > 20) errors.imagens = "No máximo 20 imagens.";
  if (imgs.some((p) => !isDocFile(p))) errors.imagens = "Imagem inválida: envie pelo botão deste campo.";
  // textos: os do ano anterior (apresentação do IDSS e link do programa) + a frase com o resultado
  const base = (prev || latest).blocos.filter((x) => x.h2 || (x.p && !/^(O Resultado|A nota)/.test(x.p)));
  r.blocos = [...base, { p: `O Resultado da Medic Global foi: <strong><u>${r.resultado.nota}</u></strong>` }, ...imgs.map((img) => ({ img }))];
  return r;
}
const docSummary = (type, x) => type === "rn565"
  ? { ano: x.ano, percentual: x.percentual, inicio: x.inicio, fim: x.fim, contratos: x.contratos || [], pdfFile: x.pdfFile || "", pdf: x.pdf || "" }
  : { ano: x.ano, anoBase: x.anoBase, resultado: x.resultado, imagens: x.blocos.filter((b) => b.img).map((b) => b.img), preview: x.blocos.filter((b) => b.img).map((b) => "/admin/" + (b.img.startsWith("assets/uploads/") ? "media/" + b.img.slice(15) : "site-assets/" + b.img.slice(7))) };
on("GET", "/api/admin/docs", async (req, res, s, url) => {
  const type = url.searchParams.get("type");
  if (!DOCS[type]) return json(res, 404, { error: "Documento não encontrado." });
  const list = docsData(store.content.draft(), type)[DOCS[type].list].slice().sort((a, b) => b.ano - a.ano);
  json(res, 200, { type, title: DOC_GROUPS[type], items: list.map((x) => docSummary(type, x)) });
}, { perm: "pages" });
// grava um ano (novo ou existente) ou remove (remove: true)
on("PUT", "/api/admin/docs", async (req, res, s, url) => {
  const type = url.searchParams.get("type");
  if (!DOCS[type]) return json(res, 404, { error: "Documento não encontrado." });
  const b = await readJson(req, 2 * 1024 * 1024);
  const draft = store.content.draft();
  const data = JSON.parse(JSON.stringify(docsData(draft, type))), key = DOCS[type].list;
  const list = data[key], orig = +b.original || null, ano = +b.ano;
  const idx = orig ? list.findIndex((x) => x.ano === orig) : -1;
  if (orig && idx < 0) return json(res, 404, { error: "Ano não encontrado." });
  const label = (type === "rn565" ? "Reajuste RN 565 " : "IDSS ") + (orig || ano);
  if (b.remove) {
    if (list.length <= 1) return json(res, 422, { error: "É preciso manter pelo menos um ano." });
    list.splice(idx, 1);
    draft[type] = data;
    store.content.saveDraft(draft);
    store.audit(s.email, "documento_ano_removido", label, [{ field: "Ano", before: String(orig), after: "" }]);
    return json(res, 200, { ok: true });
  }
  const errors = {};
  if (!(Number.isInteger(ano) && ano >= 2000 && ano <= 2100)) errors.ano = "Ano inválido.";
  else if (list.some((x, i) => x.ano === ano && i !== idx)) errors.ano = "Este ano já está cadastrado.";
  const latest = list.slice().sort((x, y) => y.ano - x.ano)[0];
  const item = type === "rn565" ? rnYear(b, list[idx], errors) : idssYear(b, list[idx], latest, errors);
  if (Object.keys(errors).length) return json(res, 422, { error: "Corrija os campos destacados.", fields: errors });
  // o que mudou, para a auditoria
  const before = idx >= 0 ? docSummary(type, list[idx]) : null, after = docSummary(type, item);
  const show = (k, v) => (k === "contratos" ? (v || []).length + " contratos" : k === "imagens" ? (v || []).length + " imagem(ns)" : k === "resultado" ? `nota ${v.nota} · dimensões ${v.dim.join(" / ")}` : String(v == null ? "" : v));
  const NAMES = { ano: "Ano", anoBase: "Ano-base", percentual: "Percentual", inicio: "Início", fim: "Fim", contratos: "Relação de contratos", pdfFile: "PDF do agrupamento", resultado: "Resultado", imagens: "Imagens do resultado" };
  const changes = Object.keys(NAMES).filter((k) => k in after && JSON.stringify(before ? before[k] : undefined) !== JSON.stringify(after[k]) && (before || after[k] !== "")).map((k) => ({ field: NAMES[k], before: before ? show(k, before[k]) : "", after: show(k, after[k]) }));
  if (idx >= 0) list[idx] = item; else list.push(item);
  data[key] = list.sort((x, y) => y.ano - x.ano);
  draft[type] = data;
  try { sources(draft); } catch (e) { return json(res, 422, { error: "Não foi possível gerar as páginas com estes dados: " + e.message }); }
  store.content.saveDraft(draft);
  store.audit(s.email, idx >= 0 ? "documento_ano_alterado" : "documento_ano_cadastrado", label, changes);
  json(res, 200, { ok: true, key: `pt/${type === "rn565" ? "rn565-agrupamento-" : "idss-"}${ano}.html` });
}, { perm: "pages" });

/* ---------- publicação ---------- */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else if (!e.name.endsWith(".json") || from !== store.dirs.uploads) {
      const sa = fs.statSync(a);
      if (!fs.existsSync(b) || fs.statSync(b).size !== sa.size || fs.statSync(b).mtimeMs < sa.mtimeMs) fs.copyFileSync(a, b);
    }
  }
}
function publishSite(content) {
  const t = Date.now();
  const report = build({ content, outDir: store.PUBLIC, quiet: true });
  if (path.resolve(store.PUBLIC) !== path.resolve(ROOT)) copyDir(path.join(ROOT, "assets"), path.join(store.PUBLIC, "assets"));
  copyDir(store.dirs.uploads, path.join(store.PUBLIC, "assets", "uploads"));
  return { ms: Date.now() - t, orphans: report.orphans };
}
function previewSite(content) {
  fs.rmSync(store.dirs.preview, { recursive: true, force: true });
  fs.mkdirSync(store.dirs.preview, { recursive: true });
  return build({ content: Object.assign({}, content, { preview: true }), outDir: store.dirs.preview, quiet: true });
}

// resumo do que está no rascunho e ainda não foi publicado
function pendingSummary(draft, live) {
  const ch = [];
  const keys = new Set([...Object.keys(draft.pages), ...Object.keys(live.pages)]);
  for (const k of keys) if (JSON.stringify(draft.pages[k] || null) !== JSON.stringify(live.pages[k] || null)) ch.push({ area: "page", key: k });
  for (const a of ["site", "noticias", "rn565", "idss", "identity", "analytics", "forms"]) if (JSON.stringify(draft[a] || null) !== JSON.stringify(live[a] || null)) ch.push({ area: a });
  return ch;
}

/* ---------- login e sessão ---------- */

on("POST", "/api/admin/login", async (req, res) => {
  if (!sameOrigin(req)) return json(res, 403, { error: "Origem não permitida." });
  const b = await readJson(req, 10000);
  if (!b.email || !b.password) return json(res, 400, { error: "Informe o e-mail e a senha." });
  const r = auth.login(b.email, b.password, clientIp(req));
  if (r.error) return json(res, r.status, { error: r.error });
  res.setHeader("Set-Cookie", `${COOKIE}=${r.session.sid}; HttpOnly; SameSite=Strict; Path=/${isHttps(req) ? "; Secure" : ""}; Max-Age=${12 * 3600}`);
  json(res, 200, { csrf: r.session.csrf, user: userInfo(r.user), mustChange: !!r.user.mustChange });
}, { public: true });
const userInfo = (u) => ({ email: u.email, name: u.name, role: u.role, perms: auth.permsOf(u), lastLogin: u.lastLogin });

on("POST", "/api/admin/logout", async (req, res, s) => {
  auth.logout(s.sid);
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  store.audit(s.email, "logout");
  json(res, 200, { ok: true });
}, { allowMustChange: true });

on("GET", "/api/admin/me", async (req, res, s) => {
  const u = auth.users.find(s.email);
  json(res, 200, { csrf: s.csrf, user: userInfo(u), mustChange: !!u.mustChange, idleMinutes: auth.IDLE / 60000 });
}, { allowMustChange: true });

/* ---------- usuários (até auth.MAX_USERS) ---------- */
const usersView = () => ({
  max: auth.MAX_USERS, perms: auth.PERMS,
  users: auth.users.all().map((u) => Object.assign(userInfo(u), { createdAt: u.createdAt, mustChange: !!u.mustChange, locked: u.lockedUntil > Date.now() })),
});
function userFields(b, errors) {
  const name = String(b.name || "").trim();
  if (!name) errors.name = "Informe o nome.";
  else if (name.length > 60 || /[<>{}]/.test(name)) errors.name = "Nome com até 60 caracteres, sem < > { }.";
  const perms = Array.isArray(b.perms) ? b.perms.filter((p) => auth.PERMS[p]) : [];
  if (!perms.length) errors.perms = "Marque pelo menos uma área que o usuário poderá ver.";
  return { name, perms };
}
on("GET", "/api/admin/users", async (req, res) => json(res, 200, usersView()), { perm: "users" });
on("POST", "/api/admin/users", async (req, res, s) => {
  const b = await readJson(req, 10000);
  const errors = {};
  const { name, perms } = userFields(b, errors);
  const email = String(b.email || "").trim().toLowerCase();
  if (!forms.EMAIL.test(email)) errors.email = "E-mail inválido.";
  else if (auth.users.find(email)) errors.email = "Já existe um usuário com este e-mail.";
  if (auth.users.all().length >= auth.MAX_USERS) return json(res, 422, { error: `O painel permite no máximo ${auth.MAX_USERS} usuários. Remova um para cadastrar outro.` });
  const pw = b.password ? String(b.password) : auth.tempPassword();
  const prob = auth.passwordProblem(pw, email);
  if (prob) errors.password = prob;
  if (Object.keys(errors).length) return json(res, 422, { error: "Corrija os campos destacados.", fields: errors });
  auth.users.upsert(email, pw, { name, perms, mustChange: true, by: s.email });
  store.audit(s.email, "usuario_criado", email, [{ field: "Áreas liberadas", before: "", after: perms.map((p) => auth.PERMS[p]).join(", ") }]);
  json(res, 200, Object.assign(usersView(), { created: email, password: b.password ? null : pw }));
}, { perm: "users" });
on("PUT", "/api/admin/users", async (req, res, s) => {
  const b = await readJson(req, 10000);
  const u = auth.users.find(b.email);
  if (!u) return json(res, 404, { error: "Usuário não encontrado." });
  const errors = {};
  const { name, perms } = userFields(Object.assign({ perms: u.role === "admin" ? ["pages"] : u.perms }, b), errors);
  if (u.email === s.email && u.role !== "admin" && !perms.includes("users")) errors.perms = "Você não pode tirar de si mesmo a permissão de gerenciar usuários.";
  if (Object.keys(errors).length) return json(res, 422, { error: "Corrija os campos destacados.", fields: errors });
  const before = { name: u.name, perms: auth.permsOf(u).map((p) => auth.PERMS[p]).join(", ") };
  const nu = auth.users.update(u.email, { name, perms });
  const after = { name: nu.name, perms: auth.permsOf(nu).map((p) => auth.PERMS[p]).join(", ") };
  store.audit(s.email, "usuario_alterado", u.email, [["name", "Nome"], ["perms", "Áreas liberadas"]].filter(([k]) => before[k] !== after[k]).map(([k, l]) => ({ field: l, before: before[k], after: after[k] })));
  json(res, 200, usersView());
}, { perm: "users" });
// redefine a senha de outro usuário: senha provisória (troca obrigatória no próximo acesso), desbloqueia e encerra as sessões dele
on("POST", "/api/admin/users/reset", async (req, res, s) => {
  const b = await readJson(req, 10000);
  const u = auth.users.find(b.email);
  if (!u) return json(res, 404, { error: "Usuário não encontrado." });
  if (u.email === s.email) return json(res, 422, { error: "Para a sua própria senha, use “Trocar a minha senha”." });
  const pw = b.password ? String(b.password) : auth.tempPassword();
  const prob = auth.passwordProblem(pw, u.email);
  if (prob) return json(res, 422, { error: prob, fields: { password: prob } });
  auth.users.upsert(u.email, pw, { mustChange: true });
  auth.dropOtherSessions(u.email, null);
  store.audit(s.email, "senha_redefinida", u.email);
  json(res, 200, Object.assign(usersView(), { password: b.password ? null : pw }));
}, { perm: "users" });
on("DELETE", "/api/admin/users", async (req, res, s, url) => {
  const u = auth.users.find(url.searchParams.get("email"));
  if (!u) return json(res, 404, { error: "Usuário não encontrado." });
  if (u.email === s.email) return json(res, 422, { error: "Você não pode remover o seu próprio usuário." });
  if (u.role === "admin") return json(res, 422, { error: "O administrador principal não pode ser removido." });
  auth.users.remove(u.email);
  store.audit(s.email, "usuario_removido", u.email);
  json(res, 200, usersView());
}, { perm: "users" });

/* ---------- auditoria ---------- */
on("GET", "/api/admin/audit", async (req, res, s, url) => {
  const q = (url.searchParams.get("q") || "").toLowerCase(), who = url.searchParams.get("user") || "", from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
  const access = url.searchParams.get("access") === "1";
  const page = Math.max(0, +url.searchParams.get("page") || 0), size = 50;
  const ACCESS = /^(login|logout|login_falhou)$/;
  const list = store.auditLog().filter((e) => (access || !ACCESS.test(e.action)) && (!who || e.user === who)
    && (!from || e.at.slice(0, 10) >= from) && (!to || e.at.slice(0, 10) <= to)
    && (!q || JSON.stringify(e).toLowerCase().includes(q)));
  const names = {}; auth.users.all().forEach((u) => (names[u.email] = u.name));
  json(res, 200, { total: list.length, page, size, items: list.slice(page * size, page * size + size), users: Object.entries(names).map(([email, name]) => ({ email, name })), names, pageNames: pageNames() });
}, { perm: "audit" });

on("POST", "/api/admin/password", async (req, res, s) => {
  const b = await readJson(req, 10000);
  const list = auth.users.all(), u = list.find((x) => x.email === s.email);
  if (!auth.verifyPassword(b.current || "", u.hash)) return json(res, 400, { error: "A senha atual está incorreta.", fields: { current: "Senha atual incorreta." } });
  const prob = auth.passwordProblem(b.next, u.email);
  if (prob) return json(res, 422, { error: prob, fields: { next: prob } });
  if (b.next === b.current) return json(res, 422, { error: "A nova senha precisa ser diferente da atual.", fields: { next: "Use uma senha diferente da atual." } });
  if (b.next !== b.confirm) return json(res, 422, { error: "A confirmação não confere.", fields: { confirm: "A confirmação não confere." } });
  auth.users.upsert(u.email, b.next, { mustChange: false });
  auth.dropOtherSessions(u.email, s.sid);
  store.audit(s.email, "senha_alterada");
  json(res, 200, { ok: true });
}, { allowMustChange: true });

on("GET", "/api/admin/status", async (req, res) => {
  const draft = store.content.draft(), live = store.content.live();
  json(res, 200, { pending: pendingSummary(draft, live), enPending: Object.keys(draft.enPending || {}), lastPublish: live._at || null, lastPublishBy: live._by || null, history: store.content.history().slice(0, 15) });
});

// páginas em português (a versão em inglês é gerada automaticamente)
on("GET", "/api/admin/pages", async (req, res) => {
  const draft = store.content.draft(), live = store.content.live();
  const { pages } = sources(draft);
  const changed = (k) => JSON.stringify(draft.pages[k] || null) !== JSON.stringify(live.pages[k] || null);
  const list = orderedPages(pages, "pt").map(({ p, group, area }) => ({
    key: p.key, lang: p.lang, file: p.file, title: pageTitle(p), partial: !!p.partial, group, area,
    edits: draft.pages[p.key] ? Object.keys(draft.pages[p.key].edits || {}).length + Object.keys(draft.pages[p.key].meta || {}).length : 0,
    pending: changed(p.key) || (!!enKeyOf(p.key) && changed(enKeyOf(p.key))), enPending: !!(draft.enPending || {})[p.key],
  }));
  json(res, 200, { pages: list, groups: GROUP_ORDER, docGroups: DOC_GROUPS });
}, { perm: "pages" });

on("GET", "/api/admin/page", async (req, res, s, url) => {
  const key = url.searchParams.get("key") || "";
  if (!/^(pt\/|partial\/pt\/)/.test(key)) return json(res, 404, { error: "A versão em inglês é traduzida automaticamente a partir do português." });
  const v = pageView(store.content.draft(), store.content.live(), key);
  v ? json(res, 200, v) : json(res, 404, { error: "Página não encontrada." });
}, { perm: "pages" });

/* Salva uma página em português: os campos, os dados compartilhados ({{L.x}}), os mesmos textos em outros
   lugares do site (quando marcados) e, por fim, a tradução automática para o inglês de tudo o que mudou. */
on("PUT", "/api/admin/page", async (req, res, s, url) => {
  const key = url.searchParams.get("key") || "";
  if (!/^(pt\/|partial\/pt\/)/.test(key)) return json(res, 404, { error: "A versão em inglês é traduzida automaticamente a partir do português." });
  const body = await readJson(req);
  const draft = store.content.draft();
  const changes = [];
  const sh = await saveShared(draft, body.shared, changes);
  if (sh.errors) return json(res, 422, { error: "Alguns campos não foram salvos. Corrija os itens destacados.", fields: sh.errors });
  const r = savePage(draft, key, body);
  if (!r.ok) return json(res, r.status, r);
  changes.push(...r.changes);
  // o mesmo texto em outros lugares do site
  const touched = new Set([key]), also = [];
  const { pages } = sources(draft);
  const units = html.extract(pages[key].src).units;
  for (const id of body.propagate || []) {
    if (body.edits === undefined || body.edits[id] === undefined) continue;
    const u = units.find((x) => x.id === id);
    if (!u) continue;
    for (const t of elsewhere(draft, key, u)) {
      const rr = savePage(draft, t.key, { edits: { [t.id]: body.edits[id] } });
      if (rr.ok && rr.changes.length) { touched.add(t.key); also.push(t.title + (t.section ? " › " + t.section : "")); }
    }
  }
  if (also.length) changes.push({ field: "Mesmo texto atualizado também em", before: "", after: [...new Set(also)].join("; ") });
  // tradução (inclui páginas que ficaram pendentes antes)
  const tr = await syncEnglish(draft, [...touched, ...Object.keys(draft.enPending || {})]);
  store.content.saveDraft(draft);
  if (changes.length) store.audit(s.email, "rascunho_pagina", key, changes);
  json(res, 200, Object.assign(pageView(draft, store.content.live(), key), { saved: { also: [...new Set(also)], warn: [sh.warn, tr.error].filter(Boolean).join(" ") } }));
}, { perm: "pages" });

// fotos do site (para o seletor de imagens)
on("GET", "/api/admin/site", async (req, res) => {
  const base = baseSite();
  const { site } = sources(store.content.draft());
  json(res, 200, { photos: Object.keys(base.photos).filter((k) => !k.startsWith("_")).map((k) => ({ key: k, url: imageUrl(site, k) })) });
}, { perm: ["pages", "news", "identity"] });

on("GET", "/api/admin/noticias", async (req, res) => {
  const draft = store.content.draft();
  const list = draft.noticias || JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/noticias.json"), "utf8"));
  const { site } = sources(draft);
  json(res, 200, { noticias: list.map((n) => Object.assign({}, n, { _preview: n.foto ? imageUrl(site, n.foto) : "" })) });
}, { perm: "news" });
on("PUT", "/api/admin/noticias", async (req, res, s) => {
  const b = await readJson(req);
  const draft = store.content.draft();
  const { site } = sources(draft);
  const prev = draft.noticias || JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/noticias.json"), "utf8"));
  const list = (b.noticias || []).map((n) => { const c = Object.assign({}, n); delete c._preview; delete c.en; c.leitura = +c.leitura; if (!c.foto) { delete c.foto; delete c.alt; } return c; });
  const errs = validateNews(list, site);
  if (errs.length) return json(res, 422, { error: errs.slice(0, 8).join(" "), list: errs });
  const tr = await newsEnglish(list, prev);
  if (tr.error) return json(res, 502, { error: tr.error });
  draft.noticias = list;
  store.content.saveDraft(draft);
  newsAudit(s.email, prev, list);
  json(res, 200, { ok: true });
}, { perm: "news" });

/* mídia */
const PDF_MAX = 15 * 1024 * 1024;
on("POST", "/api/admin/upload", async (req, res, s, url) => {
  const purpose = url.searchParams.get("purpose") || "photo";
  if (!images.RULES[purpose] && purpose !== "pdf") return json(res, 400, { error: "Uso do arquivo inválido." });
  const buf = await readBody(req, purpose === "pdf" ? PDF_MAX + 1 : images.RULES[purpose].maxBytes + 1);
  // PDF (documentos anuais): só confere a assinatura do formato e o tamanho
  const v = purpose === "pdf" ? (buf.length > PDF_MAX ? { error: "PDF grande demais (máximo de 15 MB)." } : buf.subarray(0, 5).toString() !== "%PDF-" ? { error: "O arquivo não é um PDF válido." } : { info: { type: "pdf", mime: "application/pdf", w: 0, h: 0 } }) : images.validate(buf, purpose);
  if (v.error) return json(res, 422, { error: v.error });
  const name = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 20) + "." + v.info.type;
  fs.writeFileSync(path.join(store.dirs.uploads, name), buf, { mode: 0o644 });
  const original = String(url.searchParams.get("name") || "").replace(/[^\w.\- ]/g, "_").slice(0, 100);
  fs.writeFileSync(path.join(store.dirs.uploads, name + ".json"), JSON.stringify({ purpose, w: v.info.w, h: v.info.h, type: v.info.mime, size: buf.length, original, at: new Date().toISOString(), by: s.email }));
  store.audit(s.email, "upload", name);
  json(res, 200, { name, ref: "up:" + name, path: "assets/uploads/" + name, url: "/admin/media/" + name, w: v.info.w, h: v.info.h, type: v.info.mime, size: buf.length });
}, { perm: ["pages", "news", "identity"] });
on("GET", "/api/admin/media", async (req, res) => {
  const files = fs.readdirSync(store.dirs.uploads).filter((f) => !f.endsWith(".json")).map((f) => Object.assign({ name: f, ref: "up:" + f, path: "assets/uploads/" + f, url: "/admin/media/" + f }, uploadMeta(f) || {})).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  json(res, 200, { files, rules: images.RULES });
}, { perm: ["pages", "news", "identity"] });

/* identidade visual */
on("GET", "/api/admin/identity", async (req, res) => {
  const d = store.content.draft().identity || {};
  json(res, 200, { identity: d, defaults: { logo: "/admin/site-assets/img/brand/logo-medicglobal-saude.png", logoNeg: "/admin/site-assets/img/brand/logo-medicglobal-saude-branco.png", favicon: "/admin/site-assets/img/brand/favicon.svg", faviconPng: "/admin/site-assets/img/brand/favicon.png" } });
}, { perm: "identity" });
on("PUT", "/api/admin/identity", async (req, res, s) => {
  const b = await readJson(req);
  const draft = store.content.draft();
  const out = {}, errors = {};
  const want = { logo: "logo", logoNeg: "logo", favicon: "favicon", faviconPng: "favicon" };
  for (const [k, purpose] of Object.entries(want)) {
    const name = b[k];
    if (!name) continue;
    const m = uploadExists(name) && uploadMeta(name);
    if (!m || m.purpose !== purpose) { errors[k] = "Envie a imagem por este campo (formato e tamanho validados para " + (purpose === "logo" ? "logotipo" : "favicon") + ")."; continue; }
    if (k === "faviconPng" && m.type !== "image/png") { errors[k] = "O ícone para celulares precisa ser PNG."; continue; }
    out[k] = { path: "assets/uploads/" + name, w: m.w, h: m.h, type: m.type, name };
  }
  if (Object.keys(errors).length) return json(res, 422, { error: "Corrija os campos destacados.", fields: errors });
  draft.identity = out;
  store.content.saveDraft(draft);
  store.audit(s.email, "rascunho_identidade");
  json(res, 200, { ok: true, identity: out });
}, { perm: "identity" });

/* Google Analytics */
function gaView() {
  const draft = store.content.draft(), set = forms.settings();
  const g = set.ga || {};
  let saEmail = "";
  if (g.serviceAccount) { try { saEmail = JSON.parse(store.open(g.serviceAccount)).client_email; } catch (e) {} }
  return Object.assign({ enabled: false, measurementId: "", gtmId: "", propertyId: "" }, draft.analytics, { serviceAccountEmail: saEmail, apiSecret: g.apiSecret ? store.mask(store.open(g.apiSecret)) : "", lastCheck: g.lastCheck || null });
}
on("GET", "/api/admin/analytics", async (req, res) => json(res, 200, gaView()), { perm: "analytics" });
on("PUT", "/api/admin/analytics", async (req, res, s) => {
  const b = await readJson(req, 64 * 1024);
  const errors = {};
  const mid = String(b.measurementId || "").trim().toUpperCase(), gtm = String(b.gtmId || "").trim().toUpperCase(), pid = String(b.propertyId || "").trim();
  if (mid && !ga.RE.measurementId.test(mid)) errors.measurementId = "Formato esperado: G-XXXXXXXXXX.";
  if (gtm && !ga.RE.gtmId.test(gtm)) errors.gtmId = "Formato esperado: GTM-XXXXXXX.";
  if (pid && !ga.RE.propertyId.test(pid)) errors.propertyId = "O ID da propriedade tem só números (ex.: 412345678).";
  if (b.enabled && !mid && !gtm) errors.measurementId = "Informe o ID de medição (ou o GTM) para ativar a coleta.";
  const set = forms.settings(); set.ga = set.ga || {};
  if (b.serviceAccount) { const sa = ga.parseServiceAccount(b.serviceAccount); if (sa.error) errors.serviceAccount = sa.error; }
  if (b.apiSecret && !/^[\w-]{10,64}$/.test(b.apiSecret)) errors.apiSecret = "API secret inválido.";
  if (Object.keys(errors).length) return json(res, 422, { error: "Corrija os campos destacados.", fields: errors });
  if (b.serviceAccount) set.ga.serviceAccount = store.seal(b.serviceAccount);
  if (b.clearServiceAccount) delete set.ga.serviceAccount;
  if (b.apiSecret) set.ga.apiSecret = store.seal(b.apiSecret);
  if (b.clearApiSecret) delete set.ga.apiSecret;
  forms.saveSettings(set);
  const draft = store.content.draft();
  draft.analytics = { enabled: !!b.enabled, measurementId: mid, gtmId: gtm, propertyId: pid };
  store.content.saveDraft(draft);
  store.audit(s.email, "analytics_config");
  json(res, 200, gaView());
}, { perm: "analytics" });
on("POST", "/api/admin/analytics/verify", async (req, res, s) => {
  const set = forms.settings(), g = set.ga || {};
  const cfg = Object.assign({}, store.content.draft().analytics);
  let published = "";
  try { published = fs.readFileSync(path.join(store.PUBLIC, "index.html"), "utf8"); } catch (e) {}
  const checks = await ga.verify(cfg, { serviceAccount: g.serviceAccount ? store.open(g.serviceAccount) : "", apiSecret: g.apiSecret ? store.open(g.apiSecret) : "" }, published);
  set.ga = Object.assign(g, { lastCheck: { at: new Date().toISOString(), checks } });
  forms.saveSettings(set);
  store.audit(s.email, "analytics_verificacao");
  json(res, 200, { checks, at: set.ga.lastCheck.at });
}, { perm: "analytics" });

/* formulários */
function formsView() {
  const draft = store.content.draft(), set = forms.settings();
  const { pages } = sources(draft);
  const srcs = Object.values(pages).filter((p) => p.lang === "pt" && !p.partial).map((p) => ({ key: p.key, src: draftPageSrc(draft, p) }));
  const defs = forms.definitions(srcs);
  const list = Object.values(defs).map((d) => {
    const c = (set.forms && set.forms[d.name]) || {};
    const view = pageView(draft, store.content.live(), d.page);
    return Object.assign({}, d, {
      enabled: c.enabled !== false, emails: c.emails || [], webhook: c.webhook ? store.mask(store.open(c.webhook)) : "",
      maxUploadMB: (draft.forms[d.name] && draft.forms[d.name].maxUploadMB) || 10,
      count: forms.list(d.name).length, pageTitle: view.title,
      fieldUnits: view.units.filter((u) => u.kind === "field" && u.form === d.name),
    });
  });
  const sm = set.smtp || {};
  return { forms: list, smtp: { host: sm.host || "", port: sm.port || 587, user: sm.user || "", from: sm.from || "", fromName: sm.fromName || "", pass: sm.pass ? store.mask(store.open(sm.pass)) : "" } };
}
const draftPageSrc = (content, p) => html.apply(p.src, (content.pages[p.key] && content.pages[p.key].edits) || {}).html;
on("GET", "/api/admin/forms", async (req, res) => json(res, 200, formsView()), { perm: ["forms", "inbox"] });
on("PUT", "/api/admin/forms", async (req, res, s, url) => {
  const name = url.searchParams.get("name");
  const b = await readJson(req, 64 * 1024);
  const view = formsView();
  if (!view.forms.find((f) => f.name === name)) return json(res, 404, { error: "Formulário não encontrado." });
  const errors = {};
  const emails = (Array.isArray(b.emails) ? b.emails : String(b.emails || "").split(/[,;\s]+/)).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length > 10) errors.emails = "No máximo 10 destinatários.";
  const bad = emails.filter((e) => !forms.EMAIL.test(e));
  if (bad.length) errors.emails = "E-mail inválido: " + bad.join(", ");
  if (b.webhook && !/^https:\/\/[^\s<>"]+$/.test(b.webhook)) errors.webhook = "O webhook precisa ser um endereço https://.";
  const mb = +b.maxUploadMB;
  if (b.maxUploadMB !== undefined && !(Number.isInteger(mb) && mb >= 1 && mb <= 50)) errors.maxUploadMB = "Entre 1 e 50 MB.";
  if (Object.keys(errors).length) return json(res, 422, { error: "Corrija os campos destacados.", fields: errors });
  const set = forms.settings(); set.forms = set.forms || {};
  const c = set.forms[name] = set.forms[name] || {};
  c.enabled = b.enabled !== false; c.emails = emails;
  if (b.webhook) c.webhook = store.seal(b.webhook);
  if (b.clearWebhook) delete c.webhook;
  forms.saveSettings(set);
  if (b.maxUploadMB !== undefined) { const d = store.content.draft(); d.forms[name] = { maxUploadMB: mb }; store.content.saveDraft(d); }
  store.audit(s.email, "formulario_config", name);
  json(res, 200, formsView());
}, { perm: "forms" });
on("PUT", "/api/admin/smtp", async (req, res, s) => {
  const b = await readJson(req, 64 * 1024);
  const errors = {};
  if (b.host && !/^[\w.-]+$/.test(b.host)) errors.host = "Servidor inválido.";
  if (!(+b.port >= 1 && +b.port <= 65535)) errors.port = "Porta inválida.";
  if (b.from && !forms.EMAIL.test(b.from)) errors.from = "E-mail do remetente inválido.";
  if (b.host && !b.from) errors.from = "Informe o remetente.";
  if (Object.keys(errors).length) return json(res, 422, { error: "Corrija os campos destacados.", fields: errors });
  const set = forms.settings();
  const prev = set.smtp || {};
  set.smtp = { host: b.host || "", port: +b.port, user: b.user || "", from: b.from || "", fromName: String(b.fromName || "").slice(0, 60), pass: b.pass ? store.seal(b.pass) : prev.pass || "" };
  if (b.clearPass) set.smtp.pass = "";
  forms.saveSettings(set);
  store.audit(s.email, "smtp_config");
  json(res, 200, formsView());
}, { perm: "forms" });
on("POST", "/api/admin/smtp/test", async (req, res, s) => {
  const b = await readJson(req, 10000);
  const sm = forms.settings().smtp;
  if (!sm || !sm.host) return json(res, 400, { error: "Configure o servidor SMTP primeiro." });
  if (!forms.EMAIL.test(b.to || "")) return json(res, 422, { error: "Informe um e-mail válido para o teste." });
  try {
    await require("./mail").send(Object.assign({}, sm, { pass: store.open(sm.pass) }), { to: [b.to], subject: "Teste do painel MedicGLOBAL", text: "Se você recebeu esta mensagem, o envio de e-mails dos formulários está funcionando." });
    json(res, 200, { ok: true });
  } catch (e) { json(res, 502, { error: "Falha no envio: " + e.message }); }
}, { perm: "forms" });
on("POST", "/api/admin/webhook/test", async (req, res, s, url) => {
  const c = ((forms.settings().forms || {})[url.searchParams.get("name")]) || {};
  if (!c.webhook) return json(res, 400, { error: "Nenhum webhook configurado para este formulário." });
  try { await forms.postJson(store.open(c.webhook), { teste: true, origem: "painel MedicGLOBAL", em: new Date().toISOString() }); json(res, 200, { ok: true }); }
  catch (e) { json(res, 502, { error: "Falha no webhook: " + e.message }); }
}, { perm: "forms" });
on("GET", "/api/admin/submissions", async (req, res, s, url) => {
  const name = url.searchParams.get("form") || "";
  json(res, 200, { items: forms.list(name).map((r) => Object.assign({}, r)) });
}, { perm: "inbox" });
on("GET", "/api/admin/submissions/file", async (req, res, s, url) => {
  const stored = url.searchParams.get("f") || "";
  const p = /^[\w.\- ]+$/.test(stored) && path.join(store.dirs.attachments, stored);
  if (!p || !fs.existsSync(p)) return json(res, 404, { error: "Arquivo não encontrado." });
  store.audit(s.email, "anexo_baixado", stored);
  headers(res, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${stored.replace(/^[\w-]+?-[0-9a-f]{12}-/, "")}"`, "Cache-Control": "no-store" });
  res.writeHead(200); fs.createReadStream(p).pipe(res);
}, { perm: "inbox" });
on("GET", "/api/admin/submissions/csv", async (req, res, s, url) => {
  const name = url.searchParams.get("form") || "";
  const items = forms.list(name);
  const cols = [...new Set(items.flatMap((i) => Object.keys(i.data)))];
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const csv = "﻿" + [["protocolo", "data", ...cols, "anexos"].map(q).join(";"), ...items.map((i) => [i.id, i.at, ...cols.map((c) => i.data[c]), i.files.map((f) => f.filename).join(", ")].map(q).join(";"))].join("\r\n");
  store.audit(s.email, "csv_exportado", name);
  headers(res, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" });
  res.writeHead(200); res.end(csv);
}, { perm: "inbox" });

/* rascunho → visualização → publicação */
on("POST", "/api/admin/preview", async (req, res) => {
  const b = await readJson(req, 10000);
  try {
    const r = previewSite(store.content.draft());
    const key = String(b.key || "pt/index.html");
    const [lang, file] = key.startsWith("partial/") ? ["pt", "index.html"] : key.split("/");
    json(res, 200, { url: "/admin/preview/" + (lang === "en" ? "en/" : "") + file, orphans: r.orphans });
  } catch (e) { json(res, 500, { error: "Não foi possível gerar a visualização: " + e.message }); }
});
on("POST", "/api/admin/publish", async (req, res, s) => {
  const b = await readJson(req, 10000);
  const draft = store.content.draft();
  // traduções que ficaram pendentes: nova tentativa antes de publicar
  if (draft.enPending) {
    const tr = await syncEnglish(draft, Object.keys(draft.enPending));
    store.content.saveDraft(draft);
    if (tr.error && !b.force) return json(res, 409, { error: tr.error, enPending: true });
  }
  try { previewSite(draft); } catch (e) { return json(res, 422, { error: "O rascunho tem um problema e não foi publicado: " + e.message }); }
  const names = pageNames(), AREAS = { site: "Dados compartilhados", noticias: "Notícias", rn565: "Reajuste RN 565", idss: "IDSS", identity: "Identidade visual", analytics: "Google Analytics", forms: "Formulários" };
  const what = pendingSummary(draft, store.content.live()).map((p) => (p.area === "page" ? names[p.key] || p.key : AREAS[p.area] || p.area));
  const live = store.content.publish(draft, s.email);
  const r = publishSite(live);
  store.audit(s.email, "publicado", `${r.ms} ms`, what.length ? [{ field: "Itens publicados", before: "", after: what.join("; ") }] : null);
  json(res, 200, { ok: true, at: live._at, ms: r.ms, orphans: r.orphans });
}, { perm: "publish" });
on("POST", "/api/admin/discard", async (req, res, s) => {
  store.content.saveDraft(store.content.live());
  store.audit(s.email, "rascunho_descartado");
  json(res, 200, { ok: true });
}, { perm: "publish" });
on("POST", "/api/admin/rollback", async (req, res, s) => {
  const b = await readJson(req, 10000);
  const v = store.content.version(String(b.id || ""));
  if (!v) return json(res, 404, { error: "Versão não encontrada." });
  delete v._at; delete v._by;
  store.content.saveDraft(v);
  store.audit(s.email, "versao_restaurada_no_rascunho", b.id);
  json(res, 200, { ok: true });
}, { perm: "publish" });

/* ---------- formulário público ---------- */
let defsCache = { at: "", defs: null };
function liveDefs() {
  const live = store.content.live();
  if (defsCache.at === (live._at || "-") && defsCache.defs) return defsCache.defs;
  const { pages } = sources(live);
  defsCache = { at: live._at || "-", defs: forms.definitions(Object.values(pages).filter((p) => p.lang === "pt" && !p.partial).map((p) => ({ key: p.key, src: draftPageSrc(live, p) }))) };
  return defsCache.defs;
}
async function publicForm(req, res, name) {
  if (!sameOrigin(req)) return json(res, 403, { ok: false, error: "Origem não permitida." });
  const def = liveDefs()[name];
  if (!def) return json(res, 404, { ok: false, error: "Formulário não encontrado." });
  const live = store.content.live();
  const maxMB = (live.forms[name] && live.forms[name].maxUploadMB) || 10;
  const ct = req.headers["content-type"] || "";
  const buf = await readBody(req, (maxMB + 1) * 1024 * 1024);
  let fields = {}, files = [];
  if (/multipart\/form-data/.test(ct)) {
    const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
    if (!b) return json(res, 400, { ok: false, error: "Envio inválido." });
    ({ fields, files } = forms.parseMultipart(buf, b[1] || b[2]));
  } else if (/application\/x-www-form-urlencoded/.test(ct)) fields = Object.fromEntries(new URLSearchParams(buf.toString("utf8")));
  else if (/application\/json/.test(ct)) { try { fields = JSON.parse(buf.toString("utf8")); } catch (e) { return json(res, 400, { ok: false, error: "Envio inválido." }); } }
  const r = await forms.submit(def, fields, files, clientIp(req));
  json(res, r.status, r.body);
}

/* ---------- servidor ---------- */
const ADMIN_CSP = "default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p.startsWith("/api/admin/")) {
    const fn = routes[req.method + " " + p];
    if (!fn) return json(res, 404, { error: "Rota não encontrada." });
    let s = null;
    if (!fn.public) {
      s = auth.session(cookies(req)[COOKIE]);
      if (!s) return json(res, 401, { error: "Sessão expirada. Entre novamente.", auth: false });
      if (req.method !== "GET" && (req.headers["x-csrf-token"] !== s.csrf || !sameOrigin(req))) return json(res, 403, { error: "Requisição recusada (token de segurança inválido). Recarregue a página." });
      const u = auth.users.find(s.email);
      if (u.mustChange && !fn.allowMustChange) return json(res, 403, { error: "Troque a senha provisória para continuar.", mustChange: true });
      // permissão da área (basta uma das listadas)
      if (fn.perm && ![].concat(fn.perm).some((p) => auth.can(u, p))) return json(res, 403, { error: "Seu usuário não tem permissão para esta área." });
      s.user = u;
    }
    return fn(req, res, s, url);
  }
  const fm = /^\/api\/forms\/([\w-]+)$/.exec(p);
  if (fm && req.method === "POST") return publicForm(req, res, fm[1]);

  if (p === "/admin" || p === "/admin/" || p === "/admin/index.html") {
    headers(res, { "Content-Security-Policy": ADMIN_CSP, "X-Frame-Options": "DENY", "Cache-Control": "no-store" });
    return sendFile(res, path.join(ADMIN_UI, "index.html"), "no-store");
  }
  if (p.startsWith("/admin/")) {
    const rest = p.slice(7);
    // arquivos do próprio painel (sem dados): liberados
    if (/^(app\.js|app\.css|logo\.png|favicon\.svg)$/.test(rest)) { headers(res, { "Content-Security-Policy": ADMIN_CSP }); return sendFile(res, path.join(ADMIN_UI, rest), "no-cache"); }
    const s = auth.session(cookies(req)[COOKIE]);
    if (!s) { headers(res); res.writeHead(302, { Location: "/admin" }); return res.end(); }
    if (rest.startsWith("media/")) { const f = rest.slice(6); return uploadExists(f) ? sendFile(res, path.join(store.dirs.uploads, f)) : notFound(res); }
    if (rest.startsWith("site-assets/")) { const f = safeJoin(path.join(ROOT, "assets"), rest.slice(12)); return f && fs.existsSync(f) && fs.statSync(f).isFile() ? sendFile(res, f) : notFound(res); }
    if (rest.startsWith("preview/")) {
      let r = rest.slice(8) || "index.html";
      if (r.endsWith("/")) r += "index.html";
      let f;
      if (r.startsWith("assets/uploads/")) f = uploadExists(r.slice(15)) && path.join(store.dirs.uploads, r.slice(15));
      else if (r.startsWith("assets/")) f = safeJoin(path.join(ROOT, "assets"), r.slice(7));
      else f = safeJoin(store.dirs.preview, r);
      if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return notFound(res);
      if (f.endsWith(".html")) {
        // faixa de aviso no topo da visualização
        const page = fs.readFileSync(f, "utf8").replace(/<body([^>]*)>/, `<body$1><div style="position:sticky;top:0;z-index:9999;background:#1d2b36;color:#fff;font:600 13px/1.2 system-ui,sans-serif;padding:10px 16px;text-align:center">Pré-visualização do rascunho — ainda não publicado</div>`);
        headers(res, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN" });
        res.writeHead(200); return res.end(page);
      }
      return sendFile(res, f);
    }
    return notFound(res);
  }

  // site publicado
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  let rel = p.endsWith("/") ? p + "index.html" : p;
  let f = safeJoin(store.PUBLIC, rel.slice(1));
  if (f && !fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
  if (f && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f || !fs.existsSync(f)) return notFound(res);
  sendFile(res, f, /\/assets\//.test(f.replace(/\\/g, "/")) ? "public, max-age=3600" : "no-cache");
}
function notFound(res) {
  const f = path.join(store.PUBLIC, "404.html");
  headers(res, { "Content-Type": TYPES[".html"] });
  res.writeHead(404);
  fs.existsSync(f) ? fs.createReadStream(f).pipe(res) : res.end("Não encontrado");
}

if (require.main === module) {
  if (!auth.users.all().length) {
    if (process.env.CMS_ADMIN_EMAIL && process.env.CMS_ADMIN_PASSWORD) {
      const prob = auth.passwordProblem(process.env.CMS_ADMIN_PASSWORD, process.env.CMS_ADMIN_EMAIL);
      if (prob) { console.error("CMS_ADMIN_PASSWORD fraca:", prob); process.exit(1); }
      auth.users.upsert(process.env.CMS_ADMIN_EMAIL, process.env.CMS_ADMIN_PASSWORD, { mustChange: true });
      console.log("Administrador criado a partir de CMS_ADMIN_EMAIL/CMS_ADMIN_PASSWORD:", process.env.CMS_ADMIN_EMAIL);
    } else console.warn("Nenhum administrador configurado. Rode: node cms/setup.js seu-email@dominio");
  }
  // regenera o site com o conteúdo publicado (o deploy de código não apaga as edições)
  const r = publishSite(store.content.live());
  console.log(`Site gerado em ${store.PUBLIC} (${r.ms} ms)`);
  if (Object.keys(r.orphans).length) console.warn("Edições que não encontraram o elemento original (o código da página mudou):", JSON.stringify(r.orphans));
  http.createServer((req, res) => handle(req, res).catch((e) => {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : "Erro interno." });
    if (!e.status) console.error(e);
  })).listen(PORT, process.env.CMS_HOST || "127.0.0.1", () => console.log(`Painel MedicGLOBAL em http://127.0.0.1:${PORT}/admin`));
}

module.exports = { handle, savePage, pageView, sources };
