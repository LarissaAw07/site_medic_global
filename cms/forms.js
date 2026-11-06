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

/* multipart lido em fluxo: os arquivos vão direto para o disco (anexos de até 1 GB sem ocupar a memória).
   Devolve { fields, files: [{ field, filename, type, path, size, head }] } ou rejeita com status 413/400.
   Quem chama apaga os arquivos temporários (cleanup) se o envio não for aceito. */
const DEFAULT_UPLOAD_MB = 1024;
function parseMultipartStream(req, boundary, limit, tmpDir, label) {
  return new Promise((resolve, reject) => {
    const delim = Buffer.from("\r\n--" + boundary);
    const fields = {}, files = [];
    let buf = Buffer.from("\r\n"), state = "start", total = 0, cur = null, done = false;
    const fail = (status, msg) => { if (done) return; done = true; if (cur && cur.fd != null) fs.closeSync(cur.fd); if (cur && cur.path) fs.rmSync(cur.path, { force: true }); cleanup(files); req.resume(); reject(Object.assign(new Error(msg), { status })); };
    const emit = (chunk) => {
      if (!cur || !chunk.length) return;
      if (cur.file) { if (cur.fd != null) { fs.writeSync(cur.fd, chunk); cur.size += chunk.length; if (cur.head.length < 8) cur.head = Buffer.concat([cur.head, chunk.subarray(0, 8)]).subarray(0, 8); } }
      else { cur.data.push(chunk); cur.size += chunk.length; if (cur.size > 64 * 1024) fail(400, "Campo grande demais."); }
    };
    const endPart = () => {
      if (!cur) return;
      if (cur.file) { if (cur.fd != null) { fs.closeSync(cur.fd); cur.fd = null; files.push({ field: cur.name, filename: cur.filename, type: cur.type, path: cur.path, size: cur.size, head: cur.head }); } }
      else fields[cur.name] = Buffer.concat(cur.data).toString("utf8");
      cur = null;
    };
    const step = () => {
      for (;;) {
        if (state === "start" || state === "body") {
          const i = buf.indexOf(delim);
          if (i < 0) { const keep = Math.max(0, buf.length - delim.length); if (state === "body") emit(buf.subarray(0, keep)); buf = buf.subarray(keep); return; }
          if (state === "body") { emit(buf.subarray(0, i)); endPart(); }
          if (buf.length < i + delim.length + 2) { buf = buf.subarray(i); state = state === "body" ? "start" : state; return; }
          const tail = buf.subarray(i + delim.length, i + delim.length + 2).toString();
          if (tail === "--") { state = "end"; return; }
          buf = buf.subarray(i + delim.length + 2); state = "head";
        } else if (state === "head") {
          const he = buf.indexOf("\r\n\r\n");
          if (he < 0) { if (buf.length > 8192) fail(400, "Envio inválido."); return; }
          const head = buf.subarray(0, he).toString("utf8"); buf = buf.subarray(he + 4); state = "body";
          const name = /name="([^"]*)"/i.exec(head), file = /filename="([^"]*)"/i.exec(head), ct = /content-type:\s*([^\r\n]+)/i.exec(head);
          cur = { name: name ? name[1] : "", file: !!file, filename: file ? file[1] : "", type: ct ? ct[1].trim() : "", size: 0, data: [], head: Buffer.alloc(0) };
          if (cur.file && cur.filename && cur.name) { cur.path = path.join(tmpDir, "tmp-" + crypto.randomBytes(10).toString("hex")); cur.fd = fs.openSync(cur.path, "w", 0o600); }
          if (!cur.name) cur = null;
        } else return;
      }
    };
    req.on("data", (c) => {
      if (done) return;
      total += c.length;
      if (total > limit) return fail(413, `O arquivo passa do limite de ${label || Math.round(limit / 1048576) + " MB"}.`);
      buf = Buffer.concat([buf, c]);
      try { step(); } catch (e) { fail(400, "Envio inválido."); }
    });
    req.on("end", () => { if (done) return; done = true; if (cur && cur.fd != null) fs.closeSync(cur.fd); if (state !== "end") { cleanup(files); if (cur && cur.path) fs.rmSync(cur.path, { force: true }); return reject(Object.assign(new Error("Envio incompleto."), { status: 400 })); } resolve({ fields, files }); });
    req.on("error", (e) => fail(400, "Envio interrompido."));
  });
}
const cleanup = (files) => (files || []).forEach((f) => { if (f.path) fs.rmSync(f.path, { force: true }); });

/* ---------- envio ---------- */
// por IP, em 10 minutos: até 6 envios aceitos e até 30 tentativas (inclusive as recusadas pela validação)
const rate = { ok: new Map(), any: new Map() };
function hits(map, ip) { const now = Date.now(), l = (map.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000); map.set(ip, l); return l; }
const limited = (ip) => hits(rate.ok, ip).length >= 6 || hits(rate.any, ip).push(Date.now()) > 30;
// conferido ANTES de receber um anexo: a mesma regra, sem contar a tentativa (ela é contada depois, em submit)
const overLimit = (ip) => hits(rate.ok, ip).length >= 6 || hits(rate.any, ip).length >= 30;

/* Envios com anexo em andamento: no máximo 1 por IP e 3 no total ao mesmo tempo, e só se o disco tiver espaço
   para o anexo mais uma reserva de 2 GB (um robô não consegue encher o disco do servidor). */
const uploading = new Map(); let uploadingTotal = 0;
const MAX_UPLOADS = 3, DISK_RESERVE = 2 * 1024 * 1024 * 1024;
function startUpload(ip, bytesNeeded, dir) {
  if ((uploading.get(ip) || 0) >= 1) return { status: 429, error: "Já existe um envio em andamento a partir desta rede. Aguarde ele terminar." };
  if (uploadingTotal >= MAX_UPLOADS) return { status: 503, error: "Muitos envios de arquivo neste momento. Tente novamente em alguns minutos." };
  try {
    const st = fs.statfsSync(dir);
    if (st.bavail * st.bsize < bytesNeeded + DISK_RESERVE) return { status: 503, error: "Envio de arquivos temporariamente indisponível. Tente novamente mais tarde ou use outro canal de contato." };
  } catch (e) {}
  uploading.set(ip, (uploading.get(ip) || 0) + 1); uploadingTotal++;
  let done = false;
  return { end() { if (done) return; done = true; uploadingTotal--; const v = (uploading.get(ip) || 1) - 1; if (v) uploading.set(ip, v); else uploading.delete(ip); } };
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
function validateSubmission(def, fields, files, maxMB) {
  const errors = {}, clean = {};
  const maxFileBytes = maxMB * 1024 * 1024, maxLabel = maxMB >= 1024 && maxMB % 1024 === 0 ? maxMB / 1024 + " GB" : maxMB + " MB";
  for (const f of def.fields) {
    if (f.type === "file") {
      const file = files.find((x) => x.field === f.name);
      if (!file) { if (f.required) errors[f.name] = "Anexe o arquivo."; continue; }
      if (file.size > maxFileBytes) { errors[f.name] = `O arquivo passa do limite de ${maxLabel}.`; continue; }
      if (/pdf/.test(f.accept) && file.head.subarray(0, 5).toString("ascii") !== "%PDF-") { errors[f.name] = "Envie um arquivo PDF."; continue; }
      clean[f.name] = { file: true, filename: path.basename(file.filename).replace(/[^\w.\- ]/g, "_").slice(0, 120), size: file.size, tmp: file.path };
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

async function submit(def, fields, files, ip, maxMB) {
  const s = settings(), cfg = (s.forms && s.forms[def.name]) || {};
  if (cfg.enabled === false) return { status: 403, body: { ok: false, error: "Este formulário está temporariamente desativado." } };
  // armadilha para robôs: campo invisível preenchido ou envio rápido demais
  if (fields._hp) { cleanup(files); return { status: 200, body: { ok: true } }; }
  if (limited(ip)) { cleanup(files); return { status: 429, body: { ok: false, error: "Muitos envios em sequência. Aguarde alguns minutos." } }; }
  const { errors, clean } = validateSubmission(def, fields, files, maxMB || DEFAULT_UPLOAD_MB);
  // arquivos que não serão guardados (recusados ou não pedidos pelo formulário) saem do disco
  const kept = new Set(Object.values(clean).filter((v) => v && v.file).map((v) => v.tmp));
  cleanup(files.filter((f) => !kept.has(f.path)));
  if (Object.keys(errors).length) { cleanup(files); return { status: 422, body: { ok: false, error: "Revise os campos destacados.", fields: errors } }; }

  hits(rate.ok, ip).push(Date.now());
  const id = new Date().toISOString().slice(0, 10) + "-" + crypto.randomBytes(6).toString("hex");
  const record = { id, form: def.name, at: new Date().toISOString(), page: String(fields._page || "").slice(0, 200), data: {}, files: [], notify: [] };
  for (const [k, v] of Object.entries(clean)) {
    if (v && v.file) {
      const stored = id + "-" + v.filename;
      fs.renameSync(v.tmp, path.join(store.dirs.attachments, stored));
      record.files.push({ field: k, filename: v.filename, stored, size: v.size });
    } else record.data[k] = v;
  }
  const label = (n) => (def.fields.find((f) => f.name === n) || {}).label || n;
  const text = `Novo envio do formulário "${def.title}" no site MedicGLOBAL\n${record.at}\n\n` +
    Object.entries(record.data).map(([k, v]) => `${label(k)}: ${v}`).join("\n") +
    (record.files.length ? `\n\nAnexos (disponíveis no painel, em Envios recebidos, por ${RETENTION_MONTHS} meses): ${record.files.map((f) => f.filename).join(", ")}` : "") + `\n\nProtocolo: ${id}`;

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

/* ---------- envios recebidos: guarda por tempo limitado (LGPD), consulta, download do anexo e exclusão ---------- */
const RETENTION_MONTHS = 6;
const validName = (n) => /^[\w-]+$/.test(String(n || ""));
const fileOf = (name) => path.join(store.dirs.submissions, name + ".jsonl");
function writeList(name, newestFirst) {
  const lines = newestFirst.slice().reverse().map((r) => JSON.stringify(r) + "\n").join("");
  const tmp = fileOf(name) + ".tmp";
  fs.writeFileSync(tmp, lines, { mode: 0o600 });
  fs.renameSync(tmp, fileOf(name));
}
const dropFiles = (r) => (r.files || []).forEach((f) => { if (/^[\w.\- ]+$/.test(f.stored)) fs.rmSync(path.join(store.dirs.attachments, f.stored), { force: true }); });
// apaga envios (e anexos) com mais de RETENTION_MONTHS meses e restos de envios interrompidos; devolve quantos saíram
function purge() {
  const limit = new Date(); limit.setMonth(limit.getMonth() - RETENTION_MONTHS);
  let removed = 0;
  for (const f of fs.readdirSync(store.dirs.submissions)) {
    if (!f.endsWith(".jsonl")) continue;
    const name = f.slice(0, -6), all = list(name), keep = all.filter((r) => new Date(r.at) >= limit);
    if (keep.length === all.length) continue;
    all.filter((r) => new Date(r.at) < limit).forEach(dropFiles);
    removed += all.length - keep.length;
    writeList(name, keep);
  }
  // anexos sem envio correspondente (envio interrompido) com mais de 1 dia
  const day = Date.now() - 24 * 3600 * 1000;
  for (const f of fs.readdirSync(store.dirs.attachments)) {
    const p = path.join(store.dirs.attachments, f);
    try { const st = fs.statSync(p); if (f.startsWith("tmp-") && st.mtimeMs < day) fs.rmSync(p, { force: true }); else if (st.mtimeMs < limit.getTime()) fs.rmSync(p, { force: true }); } catch (e) {}
  }
  return removed;
}
function removeSubmission(name, id) {
  if (!validName(name)) return null;
  const all = list(name), r = all.find((x) => x.id === id);
  if (!r) return null;
  dropFiles(r);
  writeList(name, all.filter((x) => x !== r));
  return r;
}
// caminho do anexo, só se ele pertencer ao envio indicado
function attachmentPath(name, id, stored) {
  if (!validName(name)) return null;
  const r = list(name).find((x) => x.id === id);
  const f = r && (r.files || []).find((x) => x.stored === stored);
  if (!f || !/^[\w.\- ]+$/.test(f.stored)) return null;
  const p = path.join(store.dirs.attachments, f.stored);
  return fs.existsSync(p) ? { path: p, filename: f.filename } : null;
}

module.exports = { RETENTION_MONTHS, purge, removeSubmission, attachmentPath, overLimit, startUpload, definitions, settings, saveSettings, parseMultipart, parseMultipartStream, cleanup, DEFAULT_UPLOAD_MB, submit, list, postJson, NAMES, EMAIL };
