/* CMS — formulários do site: definição (lida dos próprios templates, já com as edições do painel),
   validação no servidor, armazenamento das mensagens e aviso por e-mail e/ou webhook. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const html = require("./html");
const store = require("./store");
const mail = require("./mail");

const NAMES = { contato: "Fale conosco", ouvidoria: "Ouvidoria", newsletter: "Newsletter", proposta_planos: "Proposta de planos", trabalhe_conosco: "Trabalhe conosco" };

/* Lê os formulários (form[data-validate]) das páginas em português, com as edições do rascunho/publicado aplicadas. */
function definitions(sources) {
  const defs = {};
  for (const { key, src } of sources) {
    const root = html.parse(src);
    const walk = (n, form) => {
      for (const c of n.children || []) {
        if (c.type !== "el") continue;
        const a = (k) => { const x = c.attrs.find((y) => y.name === k); return x ? (x.value === null ? "" : x.value) : null; };
        if (c.tag === "form" && a("data-validate")) {
          const name = a("data-validate");
          form = defs[name] = defs[name] || { name, title: NAMES[name] || name, page: key, fields: [], consent: false };
        }
        if (form && ["input", "select", "textarea"].includes(c.tag)) {
          const type = (a("type") || c.tag).toLowerCase();
          const fname = a("name");
          if (type === "checkbox" && !fname && a("required") !== null) form.consent = true;
          else if (fname && !["submit", "button"].includes(type)) {
            let f = form.fields.find((x) => x.name === fname);
            if (!f) {
              f = { name: fname, type, required: a("required") !== null, maxlength: +a("maxlength") || 0, options: [], label: labelFor(src, root, a("id")) || fname };
              if (type === "file") { f.accept = a("accept") || ""; f.maxBytes = +a("data-max-bytes") || 0; }
              form.fields.push(f);
            }
            if (type === "radio") { f.options.push(a("value")); if (a("required") !== null) f.required = true; }
            if (c.tag === "select") {
              f.type = "select";
              const inner = src.slice(c.openEnd, c.closeStart);
              const re = /<option([^>]*)>([\s\S]*?)<\/option>/g; let m;
              while ((m = re.exec(inner))) { const v = /value="([^"]*)"/.exec(m[1]); f.options.push(v ? v[1] : html.plain(m[2])); }
            }
          }
        }
        walk(c, form);
      }
    };
    walk(root, null);
  }
  return defs;
}
function labelFor(src, root, id) {
  if (!id) return "";
  const m = new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(src);
  return m ? html.plain(m[1]).replace(/\s*\(opcional\)\s*/i, "").replace(/\s*\*.*$/, "").slice(0, 80) : "";
}

/* ---------- configurações de destino (guardadas fora do conteúdo público; webhook e senha SMTP cifrados) ---------- */
const settings = () => store.read("settings.json", {});
const saveSettings = (s) => store.write("settings.json", s);

/* ---------- multipart/form-data (para o anexo do Trabalhe conosco) ---------- */
function parseMultipart(buf, boundary) {
  const fields = {}, files = [];
  const sep = Buffer.from("--" + boundary);
  let pos = buf.indexOf(sep);
  while (pos >= 0) {
    const next = buf.indexOf(sep, pos + sep.length);
    if (next < 0) break;
    const part = buf.subarray(pos + sep.length + 2, next - 2);
    const he = part.indexOf("\r\n\r\n");
    if (he > 0) {
      const head = part.subarray(0, he).toString("utf8"), body = part.subarray(he + 4);
      const name = /name="([^"]*)"/i.exec(head), file = /filename="([^"]*)"/i.exec(head), ct = /content-type:\s*([^\r\n]+)/i.exec(head);
      if (name) {
        if (file) { if (file[1]) files.push({ field: name[1], filename: file[1], type: ct ? ct[1].trim() : "", data: body }); }
        else fields[name[1]] = body.toString("utf8");
      }
    }
    pos = next;
  }
  return { fields, files };
}

/* ---------- envio ---------- */
// por IP, em 10 minutos: até 6 envios aceitos e até 30 tentativas (inclusive as recusadas pela validação)
const rate = { ok: new Map(), any: new Map() };
function hits(map, ip) { const now = Date.now(), l = (map.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000); map.set(ip, l); return l; }
const limited = (ip) => hits(rate.ok, ip).length >= 6 || hits(rate.any, ip).push(Date.now()) > 30;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
function validateSubmission(def, fields, files, cfg) {
  const errors = {}, clean = {};
  const maxFileBytes = (cfg.maxUploadMB || 10) * 1024 * 1024;
  for (const f of def.fields) {
    if (f.type === "file") {
      const file = files.find((x) => x.field === f.name);
      if (!file) { if (f.required) errors[f.name] = "Anexe o arquivo."; continue; }
      if (file.data.length > maxFileBytes) { errors[f.name] = `O arquivo passa do limite de ${cfg.maxUploadMB || 10} MB.`; continue; }
      if (/pdf/.test(f.accept) && file.data.subarray(0, 5).toString("ascii") !== "%PDF-") { errors[f.name] = "Envie um arquivo PDF."; continue; }
      clean[f.name] = { file: true, filename: path.basename(file.filename).replace(/[^\w.\- ]/g, "_").slice(0, 120), size: file.data.length, data: file.data };
      continue;
    }
    const v = String(fields[f.name] == null ? "" : fields[f.name]).replace(/\r\n/g, "\n").trim();
    const max = f.maxlength || (f.type === "textarea" ? 5000 : 200);
    if (!v) { if (f.required) errors[f.name] = "Campo obrigatório."; continue; }
    if (v.length > max) { errors[f.name] = `Máximo de ${max} caracteres.`; continue; }
    if (f.type === "email" && !EMAIL.test(v)) { errors[f.name] = "E-mail inválido."; continue; }
    if (f.type === "tel" && !/^[\d\s()+\-.]{8,20}$/.test(v)) { errors[f.name] = "Telefone inválido."; continue; }
    if ((f.type === "select" || f.type === "radio") && f.options.length && !f.options.includes(v)) { errors[f.name] = "Opção inválida."; continue; }
    clean[f.name] = v;
  }
  if (def.consent && fields._lgpd !== "1") errors._lgpd = "É necessário autorizar o uso dos dados.";
  return { errors, clean };
}

async function submit(def, fields, files, ip) {
  const s = settings(), cfg = (s.forms && s.forms[def.name]) || {};
  if (cfg.enabled === false) return { status: 403, body: { ok: false, error: "Este formulário está temporariamente desativado." } };
  // armadilha para robôs: campo invisível preenchido ou envio rápido demais
  if (fields._hp) return { status: 200, body: { ok: true } };
  if (limited(ip)) return { status: 429, body: { ok: false, error: "Muitos envios em sequência. Aguarde alguns minutos." } };
  const { errors, clean } = validateSubmission(def, fields, files, cfg);
  if (Object.keys(errors).length) return { status: 422, body: { ok: false, error: "Revise os campos destacados.", fields: errors } };

  hits(rate.ok, ip).push(Date.now());
  const id = new Date().toISOString().slice(0, 10) + "-" + crypto.randomBytes(6).toString("hex");
  const record = { id, form: def.name, at: new Date().toISOString(), page: String(fields._page || "").slice(0, 200), data: {}, files: [], notify: [] };
  for (const [k, v] of Object.entries(clean)) {
    if (v && v.file) {
      const stored = id + "-" + v.filename;
      fs.writeFileSync(path.join(store.dirs.attachments, stored), v.data, { mode: 0o600 });
      record.files.push({ field: k, filename: v.filename, stored, size: v.size });
    } else record.data[k] = v;
  }
  const label = (n) => (def.fields.find((f) => f.name === n) || {}).label || n;
  const text = `Novo envio do formulário "${def.title}" no site MedicGLOBAL\n${record.at}\n\n` +
    Object.entries(record.data).map(([k, v]) => `${label(k)}: ${v}`).join("\n") +
    (record.files.length ? `\n\nAnexos (disponíveis no painel): ${record.files.map((f) => f.filename).join(", ")}` : "") + `\n\nProtocolo: ${id}`;

  // destinos: e-mail (SMTP configurado no painel) e webhook (CRM/automação)
  if (cfg.emails && cfg.emails.length && s.smtp && s.smtp.host) {
    try {
      await mail.send(Object.assign({}, s.smtp, { pass: store.open(s.smtp.pass) }), { to: cfg.emails, subject: `[Site] ${def.title} — ${record.data.nome || record.data.email || id}`, text, replyTo: EMAIL.test(record.data.email || "") ? record.data.email : "" });
      record.notify.push({ via: "email", ok: true });
    } catch (e) { record.notify.push({ via: "email", ok: false, error: e.message }); }
  }
  if (cfg.webhook) {
    try { await postJson(store.open(cfg.webhook), { protocolo: id, formulario: def.name, titulo: def.title, recebidoEm: record.at, pagina: record.page, campos: record.data, anexos: record.files.map((f) => f.filename) }); record.notify.push({ via: "webhook", ok: true }); }
    catch (e) { record.notify.push({ via: "webhook", ok: false, error: e.message }); }
  }
  fs.appendFileSync(path.join(store.dirs.submissions, def.name + ".jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 });
  return { status: 200, body: { ok: true, protocolo: id } };
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== "https:") return reject(new Error("O webhook precisa usar https."));
    const body = Buffer.from(JSON.stringify(data));
    const req = https.request(u, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length, "User-Agent": "MedicGLOBAL-CMS" }, timeout: 10000 }, (res) => {
      res.resume();
      res.on("end", () => (res.statusCode < 300 ? resolve(res.statusCode) : reject(new Error("Webhook respondeu HTTP " + res.statusCode))));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado no webhook")));
    req.on("error", reject);
    req.end(body);
  });
}

function list(name) {
  const p = path.join(store.dirs.submissions, name + ".jsonl");
  if (!/^[\w-]+$/.test(name) || !fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse();
}

module.exports = { definitions, settings, saveSettings, parseMultipart, submit, list, postJson, NAMES, EMAIL };
