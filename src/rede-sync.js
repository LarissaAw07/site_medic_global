/* Sincroniza a rede credenciada a partir do sistema oficial (extremamedic.com) e grava assets/data/rede.json.
   O sistema antigo não libera CORS, então a busca do site novo usa este retrato gerado no deploy.
   Uso: node src/rede-sync.js   (se o sistema estiver fora do ar, o rede.json anterior é mantido) */
const fs = require("fs");
const path = require("path");

const BASE = "https://extremamedic.com/ajax/";
const OUT = path.join(__dirname, "..", "assets", "data", "rede.json");
const MODOS = { medico: "profissional", servico: "prestador" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(BASE + url, { signal: ctl.signal, headers: { "User-Agent": "MedicGLOBAL rede-sync" } });
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      if (i >= tries) throw new Error(url + ": " + e.message);
      await sleep(800 * i);
    }
  }
}
// executa as tarefas com no máximo `n` requisições simultâneas
async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); }
  }));
  return out;
}

const ENT = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
const clean = (s) => s.replace(/<[^>]+>/g, " ").replace(/&(#\d+|\w+);/g, (m, e) => e[0] === "#" ? String.fromCharCode(+e.slice(1)) : (ENT[e] ?? m)).replace(/\s+/g, " ").trim();
const options = (html) => [...html.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g)].map((m) => ({ v: m[1].trim(), t: clean(m[2]) }));

/* Lê um bloco de resultado (os formatos variam entre profissional, prestador e as buscas isoladas) */
function parse(block) {
  const title = clean((block.match(/<h3 class="title">([\s\S]*?)<\/h3>/) || [])[1] || "").replace(/^\d+\.\s*/, "");
  if (!title) return null;
  const doc = title.match(/\(?\s*(CRM|CRO|CRP|CRN|CREFITO|COREN|CRFA|CRF|CRBM|CNPJ)\s*:?\s*([^)]*)\)?\s*$/i);
  const nome = (doc ? title.slice(0, doc.index) : title).replace(/[-\s]+$/, "").trim();
  const e = {
    nome,
    registro: doc ? (doc[1].toUpperCase() + " " + doc[2].trim()).trim() : "",
    tipo: clean((block.match(/Tipo de Estabelecimento:\s*([^<]*)/i) || [])[1] || ""),
    especialidades: [],
    local: "", endereco: "", bairro: "", cep: "", fone: "", cidade: "", uf: "",
    quals: [...new Set([...block.matchAll(/qualificacao\/LOGO_\w*?_?([A-Z])\.jpg/gi)].map((m) => m[1].toUpperCase()))],
  };
  const ps = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]).filter((p) => clean(p) && !/Tipo de Estabelecimento/i.test(p));
  const esp = ps.find((p) => /^\s*\[[^\]]+\]\s*$/.test(clean(p)));
  if (esp) e.especialidades = clean(esp).slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
  // linhas de endereço: [LOCAL] / rua / bairro - CEP / FONE / cidade - UF (às vezes em <p> separados)
  const lines = ps.filter((p) => p !== esp).join("<br>").split(/<br\s*\/?>/i).map(clean).filter(Boolean);
  for (const l of lines) {
    let m;
    if ((m = l.match(/^\[(.+)\]$/))) e.local = m[1].trim();
    else if ((m = l.match(/^(.*?)\s*-\s*CEP\.?:?\s*([\d-]+)/i))) { e.bairro = m[1].trim(); e.cep = m[2]; }
    else if ((m = l.match(/^FONE:?\s*(.*)$/i))) e.fone = m[1].trim();
    else if ((m = l.match(/^(.+?)\s*-\s*([A-Z]{2})$/i)) && !e.cidade) { e.cidade = m[1].trim().toUpperCase(); e.uf = m[2].toUpperCase(); }
    else if (!e.endereco) e.endereco = l;
  }
  return e;
}
const blocks = (html) => html.split(/<div class="col-lg-12"[^>]*>(?=\s*<div class="listing-bx)/).slice(1).map(parse).filter(Boolean);
const keyOf = (e) => [e.modo, e.nome, e.registro, e.local, e.endereco, e.cidade].join("|");

async function main() {
  const planos = options(await get("ajax_isolada_filtro_plano.php")).filter((o) => o.v && o.v !== "0");
  const tipos = options(await get("ajax_isolada_filtro_tipo_estabelecimento.php")).filter((o) => o.v);
  const quals = options(await get("ajax_isolada_filtro_qualificacao.php")).filter((o) => o.v)
    .map((o) => ({ id: o.v, letra: (o.t.match(/-\s*([A-Z])\s*$/) || [])[1] || "", nome: o.t.replace(/\s*-\s*[A-Z]\s*$/, "").replace(/\.$/, "") }));
  console.log(`${planos.length} planos · ${tipos.length} tipos de estabelecimento`);

  // 1) para cada modo × plano, os tipos de estabelecimento disponíveis
  const combos = [];
  for (const modo of Object.keys(MODOS)) for (const p of planos) combos.push({ modo, p });
  const tiposPorCombo = await pool(combos.map((c) => async () =>
    options(await get(`buscatipoestabelecimento.php?plano=${c.p.v}&empresa=0&modo=${c.modo}`)).filter((o) => o.v && o.v !== "Todos")), 6);

  // 2) resultados por modo × plano × tipo (dá o plano e o tipo de cada registro)
  const jobs = [];
  combos.forEach((c, i) => tiposPorCombo[i].forEach((t) => jobs.push({ ...c, t })));
  console.log(`${jobs.length} consultas de resultado…`);
  const res = await pool(jobs.map((j) => async () =>
    blocks(await get(`ajax_combinada_resultado.php?plano=${j.p.v}&estado=&cidade=&bairro=&especialidade=&nome=&modo=${j.modo}&estabelecimento=${j.t.v}`))), 6);

  const map = new Map();
  jobs.forEach((j, i) => res[i].forEach((e) => {
    e.modo = MODOS[j.modo];
    const k = keyOf(e);
    const cur = map.get(k) || Object.assign(e, { tipo: e.tipo || j.t.t, planos: [], urgencia: false });
    if (!cur.planos.includes(j.p.v)) cur.planos.push(j.p.v);
    if (!cur.tipo) cur.tipo = j.t.t;
    map.set(k, cur);
  }));

  // 3) urgência/emergência
  const urg = blocks(await get("ajax_isolada_resultado_urgencia.php"));
  const urgNomes = new Set(urg.map((u) => u.nome + "|" + u.cidade));
  for (const e of map.values()) if (e.modo === "prestador" && urgNomes.has(e.nome + "|" + e.cidade)) e.urgencia = true;

  const itens = [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  // quem atende todos os planos fica sem a lista (o arquivo cai para menos da metade)
  for (const e of itens) if (e.planos.length === planos.length) delete e.planos;
  if (itens.length < 50) throw new Error(`apenas ${itens.length} registros: resposta suspeita, rede.json mantido`);
  const data = {
    atualizado: new Date().toISOString().slice(0, 10),
    fonte: "https://extremamedic.com/rede_credenciada.php",
    planos: planos.map((p) => ({ id: p.v, nome: p.t })),
    tipos: tipos.map((t) => t.t),
    qualificacoes: quals,
    itens,
  };
  fs.writeFileSync(OUT, JSON.stringify(data));
  const n = (m) => itens.filter((e) => e.modo === m).length;
  console.log(`✓ ${path.relative(process.cwd(), OUT)}: ${n("profissional")} profissionais, ${n("prestador")} prestadores, ${itens.filter((e) => e.urgencia).length} com urgência`);
}

main().catch((e) => {
  console.error("⚠ rede-sync: " + e.message + (fs.existsSync(OUT) ? " (mantido o rede.json anterior)" : ""));
  process.exit(fs.existsSync(OUT) ? 0 : 1);
});
