/* CMS — tradução automática PT → EN do que é editado no painel.
   Serviço: DeepL se CMS_DEEPL_KEY estiver definida; senão, o tradutor público do Google (sem chave).
   Os textos vão em modo HTML: a frase é traduzida inteira e a marcação (<em>, <strong>, <br>) volta no lugar.
   Tokens {{...}} (dados compartilhados, ícones) vão protegidos com translate="no" e nunca são alterados.
   Cada trecho traduzido fica guardado em <dados>/translations.json: o mesmo texto nunca é enviado duas vezes. */
const crypto = require("crypto");
const store = require("./store");

const FILE = "translations.json";
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);
let cache = null;
const mem = () => (cache = cache || store.read(FILE, {}));

// termos do glossário (src/en/GLOSSARY.md) que os tradutores automáticos costumam errar
const keepCase = (src, to) => (/^[A-Z]/.test(src) ? to.charAt(0).toUpperCase() + to.slice(1) : to);
const GLOSSARY = [
  [/\bbeneficiar(y|ies)\b/gi, (m, s) => keepCase(m, s.toLowerCase() === "y" ? "member" : "members")],
  [/\b(accredited|credentialed) network\b/gi, (m) => keepCase(m, "provider network")],
  [/\bmedical guide\b/gi, (m) => keepCase(m, "provider directory")],
  [/\bombudsman(['’]s)? office\b/gi, (m) => keepCase(m, "Ombudsman")],
];
const polish = (s) => GLOSSARY.reduce((a, [re, fn]) => a.replace(re, fn), s);

async function google(list) {
  const r = await fetch("https://translate.googleapis.com/translate_a/t?client=gtx&sl=pt&tl=en&format=html", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: list.map((q) => "q=" + encodeURIComponent(q)).join("&"), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("o tradutor respondeu " + r.status);
  let j = await r.json();
  if (!Array.isArray(j)) j = [j];
  j = j.map((x) => (Array.isArray(x) ? x[0] : x));
  if (j.length !== list.length) throw new Error("resposta do tradutor fora do formato");
  return j;
}
async function deepl(list) {
  const key = process.env.CMS_DEEPL_KEY;
  const r = await fetch(`https://${/:fx$/.test(key) ? "api-free.deepl.com" : "api.deepl.com"}/v2/translate`, {
    method: "POST", headers: { Authorization: "DeepL-Auth-Key " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: list, source_lang: "PT", target_lang: "EN-US", tag_handling: "html" }), signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("o DeepL respondeu " + r.status);
  return (await r.json()).translations.map((t) => t.text);
}

const protect = (h) => h.replace(/\{\{[^}]+\}\}/g, (t) => `<span translate="no">${t}</span>`);
const unprotect = (h) => h.replace(/<span translate="no">\s*(\{\{[^}]+\}\})\s*<\/span>/g, "$1");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const hasWords = (h) => /\p{L}/u.test(h.replace(/\{\{[^}]+\}\}|<[^>]+>|&[#\w]+;/g, ""));

// traduz HTMLs de texto (usa o cache e manda o resto em lotes)
async function many(htmls) {
  const c = mem(), todo = [...new Set(htmls.filter((t) => hasWords(t) && c[hash(t)] === undefined))];
  for (let i = 0; i < todo.length;) {
    const batch = [];
    let size = 0;
    while (i < todo.length && batch.length < 40 && size + todo[i].length < 4000) { size += todo[i].length + 3; batch.push(todo[i++]); }
    if (!batch.length) batch.push(todo[i++]);
    const res = await (process.env.CMS_DEEPL_KEY ? deepl : google)(batch.map(protect));
    batch.forEach((t, k) => { c[hash(t)] = polish(unprotect(String(res[k] || "")).replace(/<br>\s+/g, "<br>").trim()); });
  }
  if (todo.length) store.write(FILE, c);
  return htmls.map((t) => (hasWords(t) ? c[hash(t)] : t));
}

/* Traduz vários itens de uma vez. Cada item: { html } (texto com marcação) ou { text } (texto simples).
   Devolve a lista na mesma ordem, com { html } ou { text } traduzidos. */
async function translateItems(items) {
  const tr = await many(items.map((it) => (it.html !== undefined ? String(it.html).trim() : esc(it.text || ""))));
  return items.map((it, i) => (it.html !== undefined ? { html: tr[i] } : { text: decode(tr[i]) }));
}
const text = async (s) => (await translateItems([{ text: s }]))[0].text;

module.exports = { translateItems, text, provider: () => (process.env.CMS_DEEPL_KEY ? "DeepL" : "Google Tradutor") };
