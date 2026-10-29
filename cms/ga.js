/* CMS — Google Analytics 4: verificação da configuração, das permissões e da coleta.
   - ID de medição (G-...) e/ou contêiner do GTM: vão para as páginas públicas (são públicos por natureza).
   - Chave da conta de serviço (JSON) e "API secret" do Measurement Protocol: ficam só no servidor, cifrados;
     o painel nunca devolve esses valores ao navegador (só um final mascarado). */
const https = require("https");
const crypto = require("crypto");

const RE = { measurementId: /^G-[A-Z0-9]{4,15}$/, gtmId: /^GTM-[A-Z0-9]{4,12}$/, propertyId: /^\d{6,12}$/ };

function request(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = https.request(url, { method, timeout: 15000, headers: Object.assign({ "User-Agent": "MedicGLOBAL-CMS" }, data ? { "Content-Length": data.length } : {}, headers) }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function parseServiceAccount(raw) {
  let j;
  try { j = JSON.parse(raw); } catch (e) { return { error: "O arquivo da conta de serviço não é um JSON válido." }; }
  if (j.type !== "service_account" || !j.client_email || !j.private_key) return { error: "O JSON não é de uma conta de serviço do Google Cloud (faltam type/client_email/private_key)." };
  try { crypto.createPrivateKey(j.private_key); } catch (e) { return { error: "A chave privada da conta de serviço é inválida." }; }
  return { ok: true, email: j.client_email, project: j.project_id || "" };
}

// token OAuth da conta de serviço (JWT assinado com RS256)
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key).toString("base64url");
  const r = await request("POST", "https://oauth2.googleapis.com/token", { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${sig}` });
  if (r.status !== 200 || !r.json || !r.json.access_token) throw new Error("O Google recusou a conta de serviço: " + ((r.json && (r.json.error_description || r.json.error)) || "HTTP " + r.status));
  return r.json.access_token;
}

/* Executa as verificações e devolve uma lista de itens { id, label, status: ok|warn|fail|skip, detail }. */
async function verify(cfg, secrets, publishedHtml) {
  const out = [];
  const add = (id, label, status, detail) => out.push({ id, label, status, detail });

  if (!cfg.measurementId && !cfg.gtmId) { add("ids", "ID de medição / GTM", "fail", "Informe o ID de medição do GA4 (G-XXXXXXX) ou o contêiner do GTM."); return out; }
  add("ids", "Formato dos identificadores", (!cfg.measurementId || RE.measurementId.test(cfg.measurementId)) && (!cfg.gtmId || RE.gtmId.test(cfg.gtmId)) ? "ok" : "fail",
    [cfg.measurementId && `GA4: ${cfg.measurementId}`, cfg.gtmId && `GTM: ${cfg.gtmId}`].filter(Boolean).join(" · "));

  // a tag está no site publicado?
  const tagOk = publishedHtml && cfg.enabled && (!cfg.measurementId || publishedHtml.includes(`"ga":"${cfg.measurementId}"`)) && (!cfg.gtmId || publishedHtml.includes(`"gtm":"${cfg.gtmId}"`));
  add("tag", "Tag instalada no site publicado", !cfg.enabled ? "warn" : tagOk ? "ok" : "warn",
    !cfg.enabled ? "A coleta está desativada no painel." : tagOk ? "As páginas publicadas carregam a tag após o consentimento de cookies (LGPD)." : "Publique o site para que a configuração atual chegue às páginas.");

  // permissões e vínculo com a propriedade (Admin API) + coleta em tempo real (Data API)
  if (secrets.serviceAccount && cfg.propertyId) {
    let token = null;
    try { token = await accessToken(JSON.parse(secrets.serviceAccount)); add("auth", "Autenticação da conta de serviço", "ok", "Token de acesso obtido."); }
    catch (e) { add("auth", "Autenticação da conta de serviço", "fail", e.message); }
    if (token) {
      const h = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
      const ds = await request("GET", `https://analyticsadmin.googleapis.com/v1beta/properties/${cfg.propertyId}/dataStreams`, { headers: h }).catch((e) => ({ status: 0, text: e.message }));
      if (ds.status === 200) {
        const streams = (ds.json && ds.json.dataStreams) || [];
        const match = streams.find((s) => s.webStreamData && s.webStreamData.measurementId === cfg.measurementId);
        add("perm", "Permissão de leitura na propriedade", "ok", `Acesso confirmado à propriedade ${cfg.propertyId} (${streams.length} fluxo(s) de dados).`);
        if (cfg.measurementId) add("link", "ID de medição pertence à propriedade", match ? "ok" : "fail", match ? `Fluxo "${match.displayName}" · ${match.webStreamData.defaultUri || ""}` : `Nenhum fluxo web da propriedade ${cfg.propertyId} usa ${cfg.measurementId}.`);
      } else if (ds.status === 403) add("perm", "Permissão de leitura na propriedade", "fail", "A conta de serviço não tem acesso. No GA4: Administrador › Gerenciamento de acesso à propriedade › adicionar o e-mail da conta de serviço como Leitor. Confira também se a Google Analytics Admin API está ativada no projeto do Google Cloud.");
      else if (ds.status === 404) add("perm", "Permissão de leitura na propriedade", "fail", `Propriedade ${cfg.propertyId} não encontrada.`);
      else add("perm", "Permissão de leitura na propriedade", "fail", `Resposta inesperada do Google (HTTP ${ds.status}): ${((ds.json && ds.json.error && ds.json.error.message) || ds.text || "").slice(0, 200)}`);

      const rt = await request("POST", `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runRealtimeReport`, { headers: h, body: { metrics: [{ name: "activeUsers" }, { name: "eventCount" }] } }).catch((e) => ({ status: 0, text: e.message }));
      if (rt.status === 200) {
        const row = rt.json.rows && rt.json.rows[0];
        const users = row ? +row.metricValues[0].value : 0, events = row ? +row.metricValues[1].value : 0;
        add("realtime", "Coleta de dados (últimos 30 min)", events > 0 ? "ok" : "warn", events > 0 ? `${users} usuário(s) ativo(s), ${events} evento(s) recebidos.` : "Nenhum evento nos últimos 30 minutos. Abra o site, aceite os cookies e verifique novamente.");
      } else add("realtime", "Coleta de dados (últimos 30 min)", "fail", `Não foi possível ler o relatório em tempo real (HTTP ${rt.status}). Confira se a Google Analytics Data API está ativada. ${((rt.json && rt.json.error && rt.json.error.message) || "").slice(0, 160)}`);
    }
  } else add("perm", "Permissões e coleta (API do Google)", "skip", "Para validar permissões e a coleta, informe o ID da propriedade e envie a chave JSON de uma conta de serviço com acesso de Leitor.");

  // Measurement Protocol: valida o "API secret" e envia um evento de teste
  if (secrets.apiSecret && cfg.measurementId) {
    const qs = `measurement_id=${encodeURIComponent(cfg.measurementId)}&api_secret=${encodeURIComponent(secrets.apiSecret)}`;
    const ev = { client_id: "cms." + Date.now(), events: [{ name: "cms_verificacao", params: { origem: "painel_medicglobal", engagement_time_msec: 1 } }] };
    const dbg = await request("POST", "https://www.google-analytics.com/debug/mp/collect?" + qs, { headers: { "Content-Type": "application/json" }, body: ev }).catch((e) => ({ status: 0, text: e.message }));
    const msgs = (dbg.json && dbg.json.validationMessages) || [];
    if (dbg.status === 200 && !msgs.length) {
      const sent = await request("POST", "https://www.google-analytics.com/mp/collect?" + qs, { headers: { "Content-Type": "application/json" }, body: ev }).catch((e) => ({ status: 0 }));
      // o Google aceita qualquer ID/secret nesse endpoint: a confirmação real vem do relatório em tempo real
      add("mp", "Evento de teste (Measurement Protocol)", "warn", sent.status < 300 ? 'O Google aceitou o formato do evento "cms_verificacao", mas não confirma se o ID e o API secret estão corretos. Confira o evento em GA4 › Relatórios › Tempo real (ou use a validação pela conta de serviço, acima).' : "O envio do evento de teste falhou (HTTP " + sent.status + ").");
    } else add("mp", "Evento de teste (Measurement Protocol)", "fail", dbg.status ? msgs.map((m) => m.description).join(" ") || "HTTP " + dbg.status : "Sem conexão com o Google: " + dbg.text);
  }
  return out;
}

module.exports = { RE, verify, parseServiceAccount, accessToken };
