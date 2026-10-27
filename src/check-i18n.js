/* Verifica as traduções: node src/check-i18n.js [arquivo.html ...]
   Para cada página/partial em src/en, compara com o original em português:
   1) estrutura idêntica — mesmas tags, na mesma ordem, com os mesmos atributos e valores
      (exceto os de texto: alt, aria-label, placeholder, title, content, data-label);
   2) mesmos tokens do build ({{...}}) e mesmos campos não textuais no cabeçalho de metadados;
   3) sobras de português no texto em inglês (lista de palavras típicas; nomes próprios liberados abaixo).
   Sai com código 1 se houver erro de estrutura. */
const fs = require("fs");
const path = require("path");
const SRC = __dirname;
const TEXT_ATTRS = new Set(["alt", "aria-label", "placeholder", "title", "content", "data-label", "aria-description"]);
// nomes próprios e termos que ficam no original
const ALLOW = /São Lucas|São Paulo|Bragança Paulista|Pouso Alegre|Cambuí|Extrema|Renascentista|Santa Casa|Alcebíades Wohlers|Porfírio Ribeiro de Andrade|Ponte Alta|Rua Teste|Bairro Medic Global|Cidade Teste|Extremamedic|Medic ?GLOBAL|EMED GLOBAL BLUE|ABRAMGE|Libras|VLibras|LGPD|boleto|Rol|Cosaúde|Dignidade Menstrual|Papo de Mulher|Governo Federal|Núcleos|Fale Conosco|Ministério da Saúde|Sistema Único de Saúde|Diário Oficial da União|Recomposição|Atualização|Agrupamento/g;
const PT_WORDS = /\b(de|do|da|dos|das|para|com|você|não|são|uma|seu|sua|nossa|nosso|pelo|pela|mais|ou|em|no|na|os|as|ao|à|é|também|aqui|atendimento|plano|planos|saúde|rede|serviços|beneficiário|consulte|acessar|ver|saiba)\b|[ãõç]|ção\b|ções\b/i;

function parse(html) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|\{\{[^}]+\}\}/g;
  let m, last = 0, text = [];
  while ((m = re.exec(html))) {
    text.push(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[0].startsWith("<!--")) continue;
    // no {{pic:chave|ALT|...}} o texto alternativo é traduzível
    if (m[0].startsWith("{{")) { out.push(m[0].replace(/^(\{\{pic:[^|]*\|)[^|]*/, "$1*")); continue; }
    const attrs = [];
    const ar = /([^\s=>\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
    let a;
    while ((a = ar.exec(m[3] || ""))) {
      const k = a[1].toLowerCase();
      let v = a[2] ? a[2].replace(/^["']|["']$/g, "") : "";
      if (TEXT_ATTRS.has(k)) v = "*";
      attrs.push(k + "=" + v);
    }
    out.push("<" + m[1] + m[2].toLowerCase() + (attrs.length ? " " + attrs.join(" ") : "") + ">");
  }
  text.push(html.slice(last));
  return { seq: out, text: text.join(" ") };
}
function split(raw) {
  const m = raw.match(/^<!--@([\s\S]*?)@-->\s*/);
  return m ? { meta: JSON.parse(m[1]), body: raw.slice(m[0].length) } : { meta: null, body: raw };
}
function plainText(body) {
  return body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/\{\{[^}]+\}\}/g, " ").replace(/&[a-z]+;/g, " ")
    .replace(ALLOW, " ").replace(/\s+/g, " ");
}

const targets = [];
for (const kind of ["pages", "partials"]) {
  const dir = path.join(SRC, "en", kind);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".html") && !/^noticia-|noticias-cards|lang-switch/.test(f)) targets.push([kind, f]);
}
const only = process.argv.slice(2);
let errors = 0;
for (const [kind, f] of targets) {
  if (only.length && !only.includes(f)) continue;
  const ptFile = path.join(SRC, kind, f);
  if (!fs.existsSync(ptFile)) { console.log(`✗ ${kind}/${f}: não existe original em português`); errors++; continue; }
  const pt = split(fs.readFileSync(ptFile, "utf8")), en = split(fs.readFileSync(path.join(SRC, "en", kind, f), "utf8"));
  const problems = [];
  if (pt.meta) {
    for (const k of Object.keys(pt.meta)) {
      if (!(k in en.meta)) problems.push(`metadados: falta "${k}"`);
      else if (["active", "og", "headerDark", "bodyClass", "noindex", "extraScripts", "extraHead"].includes(k) && JSON.stringify(pt.meta[k]) !== JSON.stringify(en.meta[k])) problems.push(`metadados: "${k}" difere do original`);
    }
    if (pt.meta.crumbs && JSON.stringify(pt.meta.crumbs.map((c) => c[1])) !== JSON.stringify((en.meta.crumbs || []).map((c) => c[1]))) problems.push("metadados: links das migalhas diferem");
  }
  // o layout difere de propósito (idioma marcado no seletor; ASL no lugar do VLibras): só a verificação de português vale para ele
  const a = f === "layout.html" ? [] : parse(pt.body).seq, b = f === "layout.html" ? [] : parse(en.body).seq;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) { problems.push(`estrutura difere no item ${i + 1}:\n     pt: ${a[i]}\n     en: ${b[i]}`); break; }
  }
  const leftovers = plainText(en.body).split(/(?<=[.!?:;])\s+|\s{2,}/).filter((s) => PT_WORDS.test(s)).slice(0, 8);
  if (problems.length) { errors++; console.log(`✗ ${kind}/${f}\n   ` + problems.join("\n   ")); }
  else console.log(`✓ ${kind}/${f}`);
  if (leftovers.length) console.log(`   ⚠ possível português restante:\n     – ` + leftovers.map((s) => s.trim().slice(0, 140)).join("\n     – "));
}
process.exit(errors ? 1 : 0);
