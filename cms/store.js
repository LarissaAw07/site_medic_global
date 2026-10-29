/* CMS — armazenamento em arquivos (pasta de dados fora do repositório e fora da pasta publicada).
   CMS_DATA_DIR: dados do painel (usuários, conteúdo, uploads, mensagens dos formulários). Padrão: .cms-data/ no projeto (local).
   CMS_PUBLIC_DIR: pasta servida ao público (raiz do nginx). Padrão: <dados>/public.
   CMS_SECRET_KEY: chave (64 caracteres hex) que cifra tokens e senhas de integrações. Sem ela, uma chave é criada
   em <dados>/secret.key com permissão restrita ao dono. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DATA = path.resolve(process.env.CMS_DATA_DIR || path.join(ROOT, ".cms-data"));
const PUBLIC = path.resolve(process.env.CMS_PUBLIC_DIR || path.join(DATA, "public"));
const dirs = { data: DATA, public: PUBLIC, uploads: path.join(DATA, "uploads"), preview: path.join(DATA, "preview"), history: path.join(DATA, "history"), submissions: path.join(DATA, "submissions"), attachments: path.join(DATA, "submissions", "anexos") };
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });

function read(name, fallback) {
  const p = path.join(DATA, name);
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}
// gravação atômica: arquivo temporário + rename (um erro no meio nunca deixa o JSON pela metade)
function write(name, value) {
  const p = path.join(DATA, name), tmp = p + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

/* ---------- segredos (cifrados com AES-256-GCM) ---------- */
function secretKey() {
  const env = process.env.CMS_SECRET_KEY;
  if (env) {
    if (!/^[0-9a-f]{64}$/i.test(env)) throw new Error("CMS_SECRET_KEY deve ter 64 caracteres hexadecimais (32 bytes).");
    return Buffer.from(env, "hex");
  }
  const p = path.join(DATA, "secret.key");
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(p, "utf8").trim(), "hex");
}
const KEY = secretKey();
function seal(plain) {
  if (plain == null || plain === "") return "";
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return "enc:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
function open(sealed) {
  if (!sealed) return "";
  const b = Buffer.from(String(sealed).replace(/^enc:/, ""), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
// para mostrar no painel sem revelar: "••••a1b2"
const mask = (s) => (s ? "••••" + String(s).slice(-4) : "");

/* ---------- conteúdo: rascunho (draft) e publicado (live) ---------- */
const EMPTY = () => ({ pages: {}, site: {}, noticias: null, identity: {}, analytics: {}, forms: {} });
const content = {
  live: () => Object.assign(EMPTY(), read("live.json", {})),
  draft: () => Object.assign(EMPTY(), read("draft.json", null) || read("live.json", {})),
  saveDraft: (c) => write("draft.json", c),
  publish(c, user) {
    const live = read("live.json", null);
    if (live) {
      const id = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(dirs.history, id + ".json"), JSON.stringify({ at: new Date().toISOString(), by: live._by || "", content: live }), { mode: 0o600 });
      // guarda as 30 últimas versões publicadas
      const old = fs.readdirSync(dirs.history).sort().slice(0, -30);
      for (const f of old) fs.unlinkSync(path.join(dirs.history, f));
    }
    c = Object.assign({}, c, { _by: user, _at: new Date().toISOString() });
    write("live.json", c);
    write("draft.json", c);
    return c;
  },
  history: () => fs.readdirSync(dirs.history).filter((f) => f.endsWith(".json")).sort().reverse().map((f) => {
    const h = JSON.parse(fs.readFileSync(path.join(dirs.history, f), "utf8"));
    return { id: f.replace(/\.json$/, ""), at: h.content._at || h.at, by: h.content._by || "" };
  }),
  version: (id) => {
    if (!/^[\w-]+$/.test(id)) return null;
    const p = path.join(dirs.history, id + ".json");
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).content : null;
  },
};

// registro de ações (quem fez o quê e quando)
function audit(user, action, detail) {
  const line = JSON.stringify({ at: new Date().toISOString(), user: user || "-", action, detail: detail || "" }) + "\n";
  fs.appendFileSync(path.join(DATA, "audit.log"), line, { mode: 0o600 });
}

module.exports = { ROOT, DATA, PUBLIC, dirs, read, write, seal, open, mask, content, audit };
