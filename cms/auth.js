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

/* ---------- limite de tentativas ---------- */
const ipFails = new Map(); // ip → [timestamps]
function ipBlocked(ip) {
  const now = Date.now(), list = (ipFails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  ipFails.set(ip, list);
  return list.length >= 20;
}

function login(email, password, ip) {
  if (ipBlocked(ip)) return { error: "Muitas tentativas a partir desta rede. Aguarde 15 minutos e tente novamente.", status: 429 };
  const list = users.all();
  const u = list.find((x) => x.email === String(email || "").trim().toLowerCase());
  if (u && u.lockedUntil > Date.now()) {
    const min = Math.ceil((u.lockedUntil - Date.now()) / 60000);
    return { error: `Acesso bloqueado temporariamente por tentativas incorretas. Tente novamente em ${min} min.`, status: 429 };
  }
  const ok = verifyPassword(password, u ? u.hash : DUMMY) && !!u;
  if (!ok) {
    ipFails.get(ip).push(Date.now());
    if (u) {
      u.failed = (u.failed || 0) + 1;
      // a partir de 5 erros seguidos: bloqueio de 15 min (dobrando a cada novo erro, até 24 h)
      if (u.failed >= 5) u.lockedUntil = Date.now() + Math.min(15 * 60 * 1000 * 2 ** (u.failed - 5), 24 * 3600 * 1000);
      users.save(list);
    }
    store.audit(email, "login_falhou", ip);
    return { error: "E-mail ou senha incorretos.", status: 401 };
  }
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

module.exports = { hashPassword, verifyPassword, passwordProblem, users, login, session, logout, dropOtherSessions, tempPassword, IDLE, MAX_USERS, PERMS, can, permsOf };
