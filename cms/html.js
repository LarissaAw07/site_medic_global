/* CMS — leitura e edição dos templates de src/ sem dependências.
   1) parse(): árvore mínima do HTML (com os tokens {{...}} do build.js preservados como texto);
   2) extract(): lista os campos editáveis de uma página (textos, links/CTAs, imagens, campos de formulário),
      agrupados pelas seções de primeiro nível;
   3) apply(): grava as edições de volta no template, trecho a trecho, sem tocar no resto do código.
   Cada edição guarda o valor original ("base"): se o template mudar depois (deploy de código),
   a edição só é aplicada ao elemento que ainda tem aquele valor — nunca cai no elemento errado. */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "svg", "template", "textarea"]);
// marcação de texto que o editor aceita dentro de um campo (o resto é estrutura e não é editável por aqui)
const INLINE = new Set(["em", "strong", "b", "i", "br", "u", "mark", "sup", "sub"]);
const TEXT_SKIP = new Set(["script", "style", "svg", "template", "select", "textarea", "option", "noscript"]);

function parse(src) {
  const root = { type: "el", tag: "#root", attrs: [], children: [], start: 0, openEnd: 0, closeStart: src.length, end: src.length };
  const stack = [root];
  let i = 0, textStart = 0;
  const top = () => stack[stack.length - 1];
  const flushText = (end) => { if (end > textStart) top().children.push({ type: "text", start: textStart, end }); };
  while (i < src.length) {
    const c = src[i];
    if (c === "{" && src[i + 1] === "{") { const e = src.indexOf("}}", i); i = e < 0 ? src.length : e + 2; continue; }
    if (c !== "<") { i++; continue; }
    if (src.startsWith("<!--", i)) {
      flushText(i);
      const e = src.indexOf("-->", i + 4), end = e < 0 ? src.length : e + 3;
      top().children.push({ type: "comment", start: i, end, text: src.slice(i + 4, end - 3) });
      i = textStart = end; continue;
    }
    const close = src[i + 1] === "/";
    const m = /^[a-zA-Z][\w-]*/.exec(src.slice(i + (close ? 2 : 1), i + 40));
    if (!m) { i++; continue; }
    const tag = m[0].toLowerCase();
    if (close) {
      flushText(i);
      const end = src.indexOf(">", i) + 1 || src.length;
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) {
        while (stack.length > k + 1) { const x = stack.pop(); x.closeStart = x.end = i; }
        const el = stack.pop(); el.closeStart = i; el.end = end; break;
      }
      i = textStart = end; continue;
    }
    flushText(i);
    // atributos (aspas e tokens {{...}} dentro da tag não fecham a tag)
    let j = i + 1 + tag.length;
    const attrs = [];
    while (j < src.length && src[j] !== ">" && !(src[j] === "/" && src[j + 1] === ">")) {
      if (/\s/.test(src[j])) { j++; continue; }
      if (src[j] === "{" && src[j + 1] === "{") { j = src.indexOf("}}", j) + 2; continue; }
      const am = /^[^\s=>/]+/.exec(src.slice(j, j + 200));
      if (!am) { j++; continue; }
      const a = { name: am[0].toLowerCase(), start: j, value: null, vStart: -1, vEnd: -1 };
      j += am[0].length;
      if (src[j] === "=") {
        j++;
        const q = src[j];
        if (q === '"' || q === "'") { a.vStart = j + 1; a.vEnd = src.indexOf(q, j + 1); j = a.vEnd + 1; }
        else { a.vStart = j; while (j < src.length && !/[\s>]/.test(src[j])) j++; a.vEnd = j; }
        a.value = src.slice(a.vStart, a.vEnd);
      }
      a.end = j;
      attrs.push(a);
    }
    const selfClose = src[j] === "/";
    const openEnd = src.indexOf(">", j) + 1;
    const el = { type: "el", tag, attrs, children: [], start: i, openEnd, insertAt: selfClose ? j : openEnd - 1, closeStart: openEnd, end: openEnd, parent: top() };
    top().children.push(el);
    i = textStart = openEnd;
    if (VOID.has(tag) || selfClose) continue;
    if (RAW.has(tag)) {
      const e = src.toLowerCase().indexOf("</" + tag, openEnd);
      el.closeStart = e < 0 ? src.length : e;
      el.end = e < 0 ? src.length : src.indexOf(">", e) + 1;
      if (tag === "textarea") el.children.push({ type: "text", start: openEnd, end: el.closeStart });
      i = textStart = el.end; continue;
    }
    stack.push(el);
  }
  flushText(src.length);
  return root;
}

const attr = (el, n) => el.attrs && el.attrs.find((a) => a.name === n);
const attrVal = (el, n) => { const a = attr(el, n); return a ? a.value : null; };
const hasClass = (el, c) => (" " + (attrVal(el, "class") || "") + " ").includes(" " + c + " ");

// texto "humano" de um trecho: sem tags, sem tokens de ícone/partial, entidades básicas resolvidas
function plain(s) {
  return decode(s.replace(/\{\{(?:i:|>|pic:)[^}]*\}\}/g, "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}
function decode(s) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
const hasWords = (s) => /[\p{L}\p{N}]/u.test(plain(s.replace(/\{\{L\.[\w.]+\}\}/g, "")));

// nó que é só ícone/arte (fica preservado nas bordas do campo de texto)
function isIcon(src, n) {
  if (n.type === "comment") return true;
  if (n.type === "text") { const t = src.slice(n.start, n.end); return /^\s*(\{\{(?:i:[\w-]+|>\s*[\w-]+)\}\}\s*)+$/.test(t) && !!t.trim(); }
  if (n.tag === "svg") return true;
  if (n.tag === "i" || n.tag === "span") return n.children.length > 0 && n.children.every((c) => isIcon(src, c) || (c.type === "text" && !src.slice(c.start, c.end).trim()));
  return false;
}
const isBlank = (src, n) => n.type === "text" && !src.slice(n.start, n.end).trim();

// elemento cujo conteúdo é só texto + marcação de texto (pode ter ícones nas pontas)
function inlineRange(src, el) {
  const kids = el.children;
  let a = 0, b = kids.length;
  while (a < b && (isIcon(src, kids[a]) || isBlank(src, kids[a]))) a++;
  while (b > a && (isIcon(src, kids[b - 1]) || isBlank(src, kids[b - 1]))) b--;
  if (a >= b) return null;
  const ok = (n) => n.type === "text" ? !/\{\{(?:i:|>|pic:)/.test(src.slice(n.start, n.end))
    : n.type === "el" && INLINE.has(n.tag) && !(n.tag === "i" && isIcon(src, n)) && n.attrs.filter((x) => x.name !== "class").length === 0 && n.children.every(ok);
  for (let k = a; k < b; k++) if (!ok(kids[k])) return null;
  // espaços nas pontas ficam fora do campo
  let s = kids[a].start, e = kids[b - 1].end;
  while (s < e && /\s/.test(src[s])) s++;
  while (e > s && /\s/.test(src[e - 1])) e--;
  return [s, e];
}

const LIMITS = { h1: 90, h2: 120, h3: 120, h4: 140, h5: 140, h6: 140, p: 700, li: 400, td: 300, th: 120, dt: 160, dd: 500, blockquote: 700, figcaption: 240, label: 140, summary: 200, legend: 120, button: 60, a: 90, span: 120, small: 160, strong: 160, b: 160, em: 160, caption: 200 };
function limitFor(kind, tag, baseText) {
  if (kind === "alt") return 160;
  if (kind === "placeholder") return 90;
  if (kind === "href") return 500;
  const d = LIMITS[tag] || 300;
  return Math.max(d, Math.ceil((baseText || "").length * 1.3));
}

/* Campos editáveis de um template.
   Tipos: text (HTML de texto), link (href/alvo + texto quando o link é só texto), image (<img>), pic (token {{pic:...}}),
   field (placeholder/obrigatório/tamanho máximo de um campo de formulário). */
function extract(src) {
  const root = parse(src);
  const units = [];
  let n = 0;
  const add = (u) => { u.id = "u" + (++n); units.push(u); return u; };
  const sections = [];
  let section = null, pendingComment = null;

  const startSection = (el) => {
    const label = sectionLabel(src, el, pendingComment);
    section = { id: "s" + (sections.length + 1), label, units: [] };
    sections.push(section);
    pendingComment = null;
  };
  let curLink = null;
  const push = (u) => { if (curLink && !u.link) u.link = curLink; if (!section) { section = { id: "s0", label: "Conteúdo", units: [] }; sections.push(section); } section.units.push(add(u).id); };

  function picTokens(t) {
    const re = /\{\{pic:([^}]+)\}\}/g; let m;
    const txt = src.slice(t.start, t.end);
    while ((m = re.exec(txt))) {
      const [key, alt = ""] = m[1].split("|");
      push({ kind: "pic", tag: "img", range: [t.start + m.index, t.start + m.index + m[0].length], token: m[1], base: { image: key, alt }, limits: { alt: 160 } });
    }
  }

  function walk(el, depth, ctx) {
    for (const ch of el.children) {
      if (depth === 0) {
        if (ch.type === "comment") { pendingComment = ch.text; continue; }
        if (ch.type === "el") startSection(ch);
      }
      if (ch.type === "text") {
        picTokens(ch);
        if (depth > 0 && !ctx.inlineDone) {
          const t = src.slice(ch.start, ch.end);
          if (hasWords(t) && !/\{\{(?:i:|>|pic:)/.test(t) && el.tag !== "#root") {
            let s = ch.start, e = ch.end;
            while (s < e && /\s/.test(src[s])) s++;
            while (e > s && /\s/.test(src[e - 1])) e--;
            push({ kind: "text", tag: el.tag, cls: attrVal(el, "class") || "", range: [s, e], base: { html: src.slice(s, e) }, partial: true });
          }
        }
        continue;
      }
      if (ch.type !== "el") continue;
      walkEl(ch, depth + 1, ctx);
    }
  }

  function walkEl(el, depth, ctx) {
    const tag = el.tag;
    if (tag === "img") {
      const srcA = attr(el, "src");
      if (srcA && !/\{\{/.test(srcA.value || "")) push({ kind: "image", tag, el: elRef(el), base: { image: srcA.value, alt: attrVal(el, "alt") || "" }, limits: { alt: 160 }, decorative: attrVal(el, "aria-hidden") === "true" });
      return;
    }
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const name = attrVal(el, "name"), type = (attrVal(el, "type") || tag).toLowerCase();
      if (name && !["hidden", "submit", "button"].includes(type) && !/^(website|empresa_site|hp_)/.test(name)) {
        const form = closest(el, "form");
        push({ kind: "field", tag, el: elRef(el), form: form ? attrVal(form, "data-validate") || "" : "", name, type,
          base: { placeholder: attrVal(el, "placeholder") || "", required: !!attr(el, "required"), maxlength: attrVal(el, "maxlength") || "" }, limits: { placeholder: 90 },
          hasPlaceholder: tag !== "select" && !["checkbox", "radio", "file"].includes(type) });
      }
      if (tag === "textarea") return;
      if (tag === "select") return;
      return;
    }
    if (TEXT_SKIP.has(tag)) return;
    if (tag === "a" && attr(el, "href")) {
      const range = inlineRange(src, el);
      const href = attrVal(el, "href");
      const u = { kind: "link", tag, cls: attrVal(el, "class") || "", el: elRef(el),
        base: { href, newTab: attrVal(el, "target") === "_blank" }, limits: { href: 500 } };
      if (range && hasWords(src.slice(range[0], range[1]))) {
        u.range = range; u.base.html = src.slice(range[0], range[1]);
        u.limits.html = limitFor("text", "a", plain(u.base.html));
        push(u);
        return;
      }
      push(u);
      const prev = curLink; curLink = u.id;
      walk(el, depth, ctx);
      curLink = prev;
      return;
    }
    const range = inlineRange(src, el);
    if (range && hasWords(src.slice(range[0], range[1]))) {
      const html = src.slice(range[0], range[1]);
      push({ kind: "text", tag, cls: attrVal(el, "class") || "", range, base: { html }, limits: { html: limitFor("text", tag, plain(html)) } });
      return;
    }
    walk(el, depth, ctx);
  }

  walk(root, 0, {});
  for (const u of units) {
    u.label = unitLabel(u);
    if (u.kind === "text" && !u.limits) u.limits = { html: limitFor("text", u.tag, plain(u.base.html)) };
    if (u.el) { u.openStart = u.el.start; u.openEnd = u.el.openEnd; }
  }
  return { units, sections: sections.filter((s) => s.units.length) };
}

// referência leve ao elemento (posições no texto), sem a árvore inteira
const elRef = (el) => ({ start: el.start, openEnd: el.openEnd, insertAt: el.insertAt, attrs: el.attrs.map(({ name, start, end, vStart, vEnd, value }) => ({ name, start, end, vStart, vEnd, value })) });
function closest(el, tag) { for (let p = el.parent; p; p = p.parent) if (p.tag === tag) return p; return null; }

function sectionLabel(src, el, comment) {
  if (comment) {
    const t = comment.replace(/\s+/g, " ").trim().replace(/^\d+\s*·\s*/, "");
    const first = t.split(/ — | – |\.|:|\(/)[0].trim();
    // comentários técnicos do código ("Banner no mesmo molde…", "conforme página /planos/") não servem de nome
    const NAMES = { Hero: "Banner principal", "Page hero": "Topo da página", Medicglobal: "Sobre a MedicGLOBAL", "Cta final": "Chamada final" };
    if (/^banner\b/i.test(first)) return "Banner principal";
    if (first && first.length < 70 && !/\/|conforme|molde/i.test(first)) return NAMES[cap(first)] || cap(first);
  }
  const al = attrVal(el, "aria-label");
  if (al) return al;
  const lb = attrVal(el, "aria-labelledby");
  if (lb) {
    const m = new RegExp(`id=["']${lb}["'][^>]*>([\\s\\S]*?)</`).exec(src);
    if (m) return plain(m[1]).slice(0, 70);
  }
  const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/.exec(src.slice(el.start, el.end));
  if (h && plain(h[1])) return plain(h[1]).slice(0, 70);
  // sem título: rótulo acessível de dentro do bloco (ex.: botões das lojas) ou o começo do texto
  const inner = src.slice(el.start, el.end);
  const al2 = /aria-label="([^"]{3,70})"/.exec(inner);
  if (al2) return al2[1].replace(/s*(.*)$/, "");
  const txt = plain(inner.replace(/^<[^>]*>/, ""));
  if (txt) return txt.slice(0, 60);
  return cap(el.tag) + (attrVal(el, "class") ? " · " + attrVal(el, "class").split(" ")[0] : "");
}
const cap = (s) => (s.toUpperCase() === s ? s.charAt(0) + s.slice(1).toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1));

const TAG_NAMES = { h1: "Título principal", h2: "Título", h3: "Subtítulo", h4: "Subtítulo", h5: "Subtítulo", h6: "Subtítulo", p: "Parágrafo", li: "Item de lista", td: "Célula", th: "Cabeçalho de tabela", dt: "Termo", dd: "Descrição", blockquote: "Citação", figcaption: "Legenda", label: "Rótulo do campo", summary: "Pergunta / título do bloco", legend: "Título do grupo", button: "Botão", small: "Texto de apoio", strong: "Destaque", b: "Destaque", span: "Texto", caption: "Legenda da tabela" };
function unitLabel(u) {
  if (u.kind === "image" || u.kind === "pic") return u.decorative ? "Imagem (decorativa)" : "Imagem";
  if (u.kind === "field") return "Campo do formulário · " + u.name;
  if (u.kind === "link") return /\bbtn\b/.test(u.cls) ? "Botão (CTA)" : "Link";
  if (/\beyebrow\b/.test(u.cls)) return "Chapéu";
  if (/\blead\b/.test(u.cls)) return "Texto de abertura";
  return TAG_NAMES[u.tag] || "Texto";
}

/* ---------- validação e saneamento dos valores enviados pelo painel ---------- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// HTML de texto: só as tags de INLINE, sem atributos; tokens {{L.x}} válidos ficam, qualquer outro {{ é neutralizado
function sanitizeHtml(html, validToken) {
  const out = [];
  const re = /<\/?([a-zA-Z][\w-]*)[^>]*>|\{\{\s*L\.([\w.]+)\s*\}\}|[^<{]+|[<{]/g;
  const open = [];
  let m;
  html = String(html).replace(/<div>|<p>/gi, "<br>").replace(/<\/div>|<\/p>/gi, "");
  while ((m = re.exec(html))) {
    const t = m[0];
    if (m[1]) {
      let tag = m[1].toLowerCase();
      if (tag === "b") tag = "strong";
      if (tag === "i") tag = "em";
      if (!INLINE.has(tag)) continue;
      if (tag === "br") { out.push("<br>"); continue; }
      if (t[1] === "/") { const k = open.lastIndexOf(tag); if (k >= 0) { for (let x = open.length - 1; x >= k; x--) out.push(`</${open[x]}>`); open.length = k; } }
      else { open.push(tag); out.push(`<${tag}>`); }
    } else if (m[2]) {
      out.push(validToken && validToken(m[2]) ? `{{L.${m[2]}}}` : esc(t).replace(/\{/g, "&#123;"));
    } else {
      out.push(esc(decode(t)).replace(/\{/g, "&#123;").replace(/ /g, "&nbsp;"));
    }
  }
  for (let x = open.length - 1; x >= 0; x--) out.push(`</${open[x]}>`);
  return out.join("").replace(/(<br>)+$/, "").replace(/^(\s|<br>)+/, "").trim();
}

// destino de link aceito: http(s), mailto, tel, âncora, página interna ou token de Dados gerais
function validHref(h, validToken) {
  h = String(h || "").trim();
  if (!h) return false;
  const tok = /^\{\{L\.([\w.]+)\}\}$/.exec(h);
  if (tok) return !!(validToken && validToken(tok[1]));
  if (/^(https?:\/\/)[^\s<>"']+$/i.test(h)) return true;
  if (/^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(h)) return true;
  if (/^tel:\+?[\d-]{6,20}$/i.test(h)) return true;
  if (/^#[\w-]*$/.test(h)) return true;
  if (/^(\.\.\/)?[\w-]+\.html([?#][\w\-=&%.]*)?$/.test(h)) return true;
  return false;
}

/* ---------- aplicação das edições ---------- */
// casa cada edição salva com o campo atual do template (mesmo id e mesmo valor original; senão, o campo com o mesmo valor original)
function resolve(units, edits) {
  const map = new Map(), orphans = [];
  const sameBase = (u, b) => JSON.stringify(u.base) === JSON.stringify(b);
  for (const [id, ed] of Object.entries(edits || {})) {
    let u = units.find((x) => x.id === id && x.kind === ed.kind && sameBase(x, ed.base));
    if (!u) {
      const idx = +id.slice(1);
      u = units.filter((x) => x.kind === ed.kind && sameBase(x, ed.base) && !map.has(x.id))
        .sort((a, b) => Math.abs(+a.id.slice(1) - idx) - Math.abs(+b.id.slice(1) - idx))[0];
    }
    if (u && !map.has(u.id)) map.set(u.id, { unit: u, edit: ed }); else orphans.push(id);
  }
  return { map, orphans };
}

function attrSplice(splices, u, name, value) {
  const a = u.el.attrs.find((x) => x.name === name);
  if (value === null) { if (a) splices.push([a.start - (/\s/.test(" ") ? 1 : 0), a.end, ""]); return; }
  if (a && a.vStart >= 0) splices.push([a.vStart, a.vEnd, esc(value)]);
  else if (a) splices.push([a.start, a.end, `${name}="${esc(value)}"`]);
  else splices.push([u.el.insertAt, u.el.insertAt, ` ${name}="${esc(value)}"`]);
}
function boolAttr(splices, u, name, on) {
  const a = u.el.attrs.find((x) => x.name === name);
  if (on && !a) splices.push([u.el.insertAt, u.el.insertAt, " " + name]);
  if (!on && a) splices.push([a.start - 1, a.end, ""]);
}

// picRef: transforma o arquivo de imagem escolhido no valor do token {{pic:...}} (chave do site.json ou "up:arquivo")
function apply(src, edits) {
  const { units } = extract(src);
  const { map, orphans } = resolve(units, edits);
  const splices = [];
  for (const { unit: u, edit } of map.values()) {
    const v = edit.value || {};
    if ((u.kind === "text" || u.kind === "link") && v.html !== undefined && u.range) splices.push([u.range[0], u.range[1], v.html]);
    if (u.kind === "link") {
      if (v.href !== undefined) attrSplice(splices, u, "href", v.href);
      if (v.newTab !== undefined && v.newTab !== u.base.newTab) {
        if (v.newTab) { attrSplice(splices, u, "target", "_blank"); if (!u.el.attrs.find((x) => x.name === "rel")) attrSplice(splices, u, "rel", "noopener"); }
        else attrSplice(splices, u, "target", null);
      }
    }
    if (u.kind === "image") {
      if (v.image !== undefined) attrSplice(splices, u, "src", v.image);
      if (v.alt !== undefined) attrSplice(splices, u, "alt", v.alt);
      if (v.image !== undefined && v.image !== u.base.image) { for (const n of ["width", "height", "srcset"]) if (u.el.attrs.find((x) => x.name === n)) attrSplice(splices, u, n, null); }
    }
    if (u.kind === "pic") {
      const parts = u.token.split("|");
      if (v.image !== undefined) parts[0] = v.image;
      if (v.alt !== undefined) parts[1] = v.alt.replace(/[|}]/g, "");
      splices.push([u.range[0], u.range[1], `{{pic:${parts.join("|")}}}`]);
    }
    if (u.kind === "field") {
      if (v.placeholder !== undefined && u.hasPlaceholder) attrSplice(splices, u, "placeholder", v.placeholder || null);
      if (v.required !== undefined) boolAttr(splices, u, "required", !!v.required);
      if (v.maxlength !== undefined) attrSplice(splices, u, "maxlength", v.maxlength ? String(v.maxlength) : null);
    }
  }
  splices.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = src;
  for (const [s, e, r] of splices) out = out.slice(0, s) + r + out.slice(e);
  return { html: out, orphans, applied: map.size };
}

module.exports = { parse, extract, apply, resolve, sanitizeHtml, validHref, plain, esc, limitFor };
