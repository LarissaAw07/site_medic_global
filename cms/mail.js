/* CMS — cliente SMTP mínimo (sem dependências) para avisar por e-mail os envios dos formulários.
   Suporta TLS direto (porta 465) e STARTTLS (587/25), com AUTH PLAIN. */
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

function send(cfg, msg) {
  return new Promise((resolve, reject) => {
    const port = +cfg.port || 587;
    const implicit = cfg.secure === true || port === 465;
    let sock = implicit ? tls.connect({ host: cfg.host, port, servername: cfg.host, rejectUnauthorized: cfg.allowInsecure !== true }) : net.connect({ host: cfg.host, port });
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error("Tempo esgotado na conexão SMTP")); });
    sock.on("error", reject);
    let buf = "", waiting = null;
    const onData = (d) => {
      buf += d.toString("utf8");
      // resposta completa: última linha "NNN texto" (sem hífen)
      const lines = buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) { const res = buf; buf = lines.slice(i + 1).join("\r\n"); const w = waiting; waiting = null; if (w) w(res); return; }
      }
    };
    sock.on("data", onData);
    const read = () => new Promise((r) => { waiting = r; if (buf) onData(""); });
    const cmd = async (line, ok) => {
      if (line !== null) sock.write(line + "\r\n");
      const res = await read();
      const code = +res.trim().split("\r\n").pop().slice(0, 3);
      if (!ok.includes(code)) throw new Error(`SMTP ${line ? line.split(" ")[0] : "conexão"}: ${res.trim().split("\r\n").pop()}`);
      return res;
    };
    (async () => {
      await cmd(null, [220]);
      const host = "medicglobal-cms";
      let ehlo = await cmd("EHLO " + host, [250]);
      if (!implicit && /STARTTLS/i.test(ehlo)) {
        await cmd("STARTTLS", [220]);
        sock.removeListener("data", onData);
        sock = tls.connect({ socket: sock, servername: cfg.host, rejectUnauthorized: cfg.allowInsecure !== true });
        sock.on("data", onData);
        sock.on("error", reject);
        await new Promise((r) => sock.once("secureConnect", r));
        ehlo = await cmd("EHLO " + host, [250]);
      } else if (!implicit && cfg.user && cfg.allowInsecure !== true) {
        throw new Error("O servidor SMTP não oferece STARTTLS; a senha não será enviada sem criptografia.");
      }
      if (cfg.user) await cmd("AUTH PLAIN " + Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString("base64"), [235]);
      await cmd(`MAIL FROM:<${cfg.from}>`, [250]);
      for (const to of msg.to) await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd("DATA", [354]);
      const b64 = (s) => "=?UTF-8?B?" + Buffer.from(s).toString("base64") + "?=";
      const body = Buffer.from(msg.text, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
      const data = [
        `From: ${b64(cfg.fromName || "Site MedicGLOBAL")} <${cfg.from}>`,
        `To: ${msg.to.join(", ")}`,
        msg.replyTo ? `Reply-To: <${msg.replyTo}>` : "",
        `Subject: ${b64(msg.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${crypto.randomBytes(12).toString("hex")}@medicglobal-cms>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        body,
      ].filter((l, i) => l !== "" || i > 8).join("\r\n");
      await cmd(data + "\r\n.", [250]);
      sock.write("QUIT\r\n");
      sock.end();
      resolve(true);
    })().catch((e) => { sock.destroy(); reject(e); });
  });
}

module.exports = { send };
