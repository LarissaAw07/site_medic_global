/* CMS — autenticação: senhas com scrypt (sal individual), sessões no servidor (cookie HttpOnly + SameSite=Strict),
   token anti-CSRF por sessão e bloqueio progressivo contra tentativas repetidas. */
const crypto = require("crypto");
const store = require("./store");

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const IDLE = 2 * 60 * 60 * 1000;      // sessão expira após 2 h sem uso
const ABSOLUTE = 12 * 60 * 60 * 1000; // e no máximo 12 h depois do login
const sessions = new Map();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, got);
}
// versão assíncrona (login e troca de senha): o cálculo pesado não trava o servidor enquanto roda.
// No máximo 4 verificações ao mesmo tempo; com muitas tentativas simultâneas, as excedentes são recusadas (429).
let running = 0; const waiting = [];
const MAX_RUNNING = 4, MAX_WAITING = 40;
function slot() {
  if (running < MAX_RUNNING) { running++; return Promise.resolve(); }
  if (waiting.length >= MAX_WAITING) return Promise.reject(Object.assign(new Error("Muitas tentativas de acesso neste momento. Aguarde um minuto e tente novamente."), { status: 429 }));
  return new Promise((r) => waiting.push(r));
}
function release() { const next = waiting.shift(); if (next) next(); else running--; }
async function verifyPasswordAsync(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  await slot();
  try {
    const got = await new Promise((ok, fail) => crypto.scrypt(String(pw), Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem }, (e, k) => (e ? fail(e) : ok(k))));
    return crypto.timingSafeEqual(expected, got);
  } finally { release(); }
}
// usado quando o e-mail não existe, para a resposta levar o mesmo tempo (não revela quais e-mails são válidos)
const DUMMY = hashPassword(crypto.randomBytes(16).toString("hex"));

// regras da senha: 12+ caracteres, com letras maiúsculas, minúsculas, números e símbolos
function passwordProblem(pw, email) {
  pw = String(pw || "");
  if (pw.length < 12) return "A senha precisa ter pelo menos 12 caracteres.";
  if (pw.length > 128) return "A senha pode ter no máximo 128 caracteres.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return "Use letras maiúsculas, minúsculas, números e pelo menos um símbolo.";
  if (email && pw.toLowerCase().includes(String(email).split("@")[0].toLowerCase())) return "A senha não pode conter o seu usuário.";
  return "";
}

/* Usuários: no máximo MAX_USERS. O administrador principal (role "admin") vê e faz tudo;
   os demais (role "editor") só veem as áreas marcadas em perms. */
const MAX_USERS = 3;
const PERMS = {
  pages: "Páginas do site",
  news: "Notícias",
  identity: "Identidade visual",
  forms: "Formulários",
  submissions: "Envios recebidos (dados pessoais)",
  analytics: "Google Analytics",
  audit: "Auditoria",
  publish: "Publicar alterações no site",
  users: "Gerenciar usuários",
};
const can = (u, perm) => !!u && (u.role === "admin" || (u.perms || []).includes(perm));
const permsOf = (u) => (u.role === "admin" ? Object.keys(PERMS) : (u.perms || []).filter((p) => PERMS[p]));

const users = {
  all: () => store.read("users.json", []),
  find: (email) => users.all().find((u) => u.email === String(email || "").trim().toLowerCase()),
  save: (list) => store.write("users.json", list),
  upsert(email, password, opts = {}) {
    email = String(email).trim().toLowerCase();
    const list = users.all();
    let u = list.find((x) => x.email === email);
    if (!u) {
      if (list.length >= MAX_USERS) throw Object.assign(new Error(`Limite de ${MAX_USERS} usuários atingido.`), { status: 422 });
      // o primeiro usuário é o administrador principal
      u = { email, name: opts.name || "Administrador", role: list.length ? "editor" : "admin", perms: [], createdAt: new Date().toISOString() };
      list.push(u);
    }
    if (opts.name) u.name = opts.name;
    if (opts.perms && u.role !== "admin") u.perms = opts.perms.filter((p) => PERMS[p]);
    if (opts.by) u.createdBy = u.createdBy || opts.by;
    u.hash = hashPassword(password);
    u.mustChange = !!opts.mustChange;
    u.passwordChangedAt = new Date().toISOString();
    u.failed = 0; u.lockedUntil = 0;
    users.save(list);
    return u;
  },
  update(email, fields) {
    const list = users.all(), u = list.find((x) => x.email === email);
    if (!u) return null;
    if (fields.name !== undefined) u.name = fields.name;
    if (fields.perms && u.role !== "admin") u.perms = fields.perms.filter((p) => PERMS[p]);
    users.save(list);
    return u;
  },
  remove(email) {
    users.save(users.all().filter((x) => x.email !== email));
    for (const [k, s] of sessions) if (s.email === email) sessions.delete(k);
  },
};
// senha provisória forte (cumpre as regras de passwordProblem)
function tempPassword() {
  const pick = (set, n) => Array.from(crypto.randomBytes(n), (b) => set[b % set.length]).join("");
  const s = pick("ABCDEFGHJKLMNPQRSTUVWXYZ", 3) + pick("abcdefghijkmnpqrstuvwxyz", 5) + pick("23456789", 3) + pick("#%@!*+=?", 2) + pick("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", 3);
  return Array.from(s).sort(() => crypto.randomBytes(1)[0] - 128).join("");
}

/* ---------- limite de tentativas ----------
   Por rede (IP): 20 erros em 15 min bloqueiam a rede. Por conta: o bloqueio progressivo vale só para a rede de
   onde vieram os erros, assim quem erra a senha de outro lugar não consegue trancar o acesso do administrador. */
const ipFails = new Map(); // ip → [timestamps]
const accFails = new Map(); // "email|ip" → { failed, until, last }
const accKey = (email, ip) => String(email || "").trim().toLowerCase() + "|" + ip;
function lockedFor(email, ip) { const a = accFails.get(accKey(email, ip)); return a && a.until > Date.now() ? a.until : 0; }
// alguma rede está bloqueada para esta conta? (aviso na tela de usuários)
function isLocked(email) { const now = Date.now(); for (const [k, a] of accFails) if (k.startsWith(email + "|") && a.until > now) return true; return false; }
function unlock(email) { for (const k of [...accFails.keys()]) if (k.startsWith(email + "|")) accFails.delete(k); }
// limpeza periódica para os mapas não crescerem sem fim
setInterval(() => {
  const now = Date.now();
  for (const [ip, l] of ipFails) if (!l.some((t) => now - t < 15 * 60 * 1000)) ipFails.delete(ip);
  for (const [k, a] of accFails) if (a.until < now && now - (a.last || 0) > 24 * 3600 * 1000) accFails.delete(k);
}, 30 * 60 * 1000).unref();
function ipBlocked(ip) {
  const now = Date.now(), list = (ipFails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  ipFails.set(ip, list);
  return list.length >= 20;
}

async function login(email, password, ip) {
  if (ipBlocked(ip)) return { error: "Muitas tentativas a partir desta rede. Aguarde 15 minutos e tente novamente.", status: 429 };
  const until = lockedFor(email, ip);
  if (until) {
    const min = Math.ceil((until - Date.now()) / 60000);
    return { error: `Acesso bloqueado temporariamente por tentativas incorretas. Tente novamente em ${min} min.`, status: 429 };
  }
  const found = users.find(email);
  let ok;
  try { ok = (await verifyPasswordAsync(password, found ? found.hash : DUMMY)) && !!found; }
  catch (e) { return { error: e.message, status: e.status || 500 }; }
  if (!ok) {
    ipFails.get(ip).push(Date.now());
    if (found) {
      const k = accKey(email, ip), a = accFails.get(k) || { failed: 0, until: 0 };
      a.failed++; a.last = Date.now();
      // a partir de 5 erros seguidos desta rede: bloqueio de 15 min para esta rede (dobrando a cada novo erro, até 24 h)
      if (a.failed >= 5) a.until = Date.now() + Math.min(15 * 60 * 1000 * 2 ** (a.failed - 5), 24 * 3600 * 1000);
      accFails.set(k, a);
    }
    store.audit(email, "login_falhou", ip);
    return { error: "E-mail ou senha incorretos.", status: 401 };
  }
  accFails.delete(accKey(email, ip));
  // relê a lista depois da verificação (outra gravação pode ter acontecido enquanto a senha era conferida)
  const list = users.all(), u = list.find((x) => x.email === found.email);
  if (!u) return { error: "E-mail ou senha incorretos.", status: 401 };
  u.failed = 0; u.lockedUntil = 0; u.lastLogin = new Date().toISOString();
  users.save(list);
  const sid = crypto.randomBytes(32).toString("base64url");
  const s = { sid, email: u.email, csrf: crypto.randomBytes(24).toString("base64url"), created: Date.now(), seen: Date.now(), ip };
  sessions.set(sid, s);
  store.audit(u.email, "login", ip);
  return { session: s, user: u };
}

function session(sid) {
  const s = sid && sessions.get(sid);
  if (!s) return null;
  const now = Date.now();
  if (now - s.seen > IDLE || now - s.created > ABSOLUTE || !users.find(s.email)) { sessions.delete(sid); return null; }
  s.seen = now;
  return s;
}
const logout = (sid) => sessions.delete(sid);
// troca de senha encerra as outras sessões do usuário
function dropOtherSessions(email, keep) { for (const [k, s] of sessions) if (s.email === email && k !== keep) sessions.delete(k); }

module.exports = { isLocked, unlock, verifyPasswordAsync, hashPassword, verifyPassword, passwordProblem, users, login, session, logout, dropOtherSessions, tempPassword, IDLE, MAX_USERS, PERMS, can, permsOf };
