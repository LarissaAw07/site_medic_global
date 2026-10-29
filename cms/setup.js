/* Cria (ou redefine) o acesso de administrador do painel.
   Uso: node cms/setup.js [email]
   - Sem CMS_ADMIN_PASSWORD no ambiente, gera uma senha provisória forte e mostra UMA vez no terminal.
   - A senha nunca é gravada em texto: só o hash scrypt vai para <CMS_DATA_DIR>/users.json.
   - O primeiro login exige a troca da senha provisória. */
const crypto = require("crypto");
const auth = require("./auth");
const store = require("./store");

const email = (process.argv[2] || process.env.CMS_ADMIN_EMAIL || "admin@medicglobal.com.br").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("E-mail inválido:", email); process.exit(1); }

let pw = process.env.CMS_ADMIN_PASSWORD;
if (pw) {
  const p = auth.passwordProblem(pw, email);
  if (p) { console.error("CMS_ADMIN_PASSWORD fraca:", p); process.exit(1); }
} else {
  // 16 caracteres sem símbolos ambíguos, garantindo maiúscula, minúscula, número e símbolo
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "#%+=@!?"];
  const all = sets.join("");
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = sets.map(pick);
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  pw = chars.join("");
}

auth.users.upsert(email, pw, { mustChange: true });
store.audit("setup", "admin_definido", email);
console.log("\nAcesso de administrador configurado em", store.DATA);
console.log("  Usuário (e-mail):", email);
if (!process.env.CMS_ADMIN_PASSWORD) console.log("  Senha provisória:", pw, "\n  (anote agora: ela não fica gravada em lugar nenhum; será pedida a troca no primeiro acesso)\n");
else console.log("  Senha: a definida em CMS_ADMIN_PASSWORD (troca obrigatória no primeiro acesso)\n");
