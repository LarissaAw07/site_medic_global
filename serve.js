/* Servidor estático local para visualizar o site: node serve.js  →  http://localhost:8080 */
const http = require("http"), https = require("https"), fs = require("fs"), path = require("path");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain", ".woff2": "font/woff2" };
const port = process.env.PORT || 8080;
/* Proxies para o sistema oficial (extremamedic.com), que não libera CORS: a busca ao vivo e o guia médico
   passam por caminhos same-origin (os mesmos existem em produção, via nginx — ver deploy/nginx-medicglobal-*.conf).
     /rede-api/<x>  → https://extremamedic.com/ajax/<x>     (rede credenciada)
     /guia-api/<x>  → https://extremamedic.com/manual/<x>   (guia médico; manual.php é embutido em <iframe>) */
const PROXIES = [
  { prefix: "/rede-api/", base: "https://extremamedic.com/ajax/" },
  { prefix: "/guia-api/", base: "https://extremamedic.com/manual/", frame: true }
];
function proxy(req, res, pfx) {
  const target = new URL(pfx.base + req.url.slice(pfx.prefix.length));
  const headers = Object.assign({}, req.headers, { host: target.host, "x-requested-with": "ajax", "accept-encoding": "identity" });
  // manual.php: embutido em iframe no nosso domínio → precisa buffer para injetar <base> e remover X-Frame-Options
  const transform = pfx.frame && /manual\.php(\?|$)/i.test(req.url.slice(pfx.prefix.length));
  const up = https.request(target, { method: req.method, headers: headers }, (r) => {
    const h = Object.assign({}, r.headers);
    delete h["x-frame-options"]; delete h["content-security-policy"]; delete h["content-length"];
    h["access-control-allow-origin"] = "*"; h["cache-control"] = "no-cache";
    if (!transform) { res.writeHead(r.statusCode || 502, h); return r.pipe(res); }
    const chunks = [];
    r.on("data", (c) => chunks.push(c));
    r.on("end", () => {
      let html = Buffer.concat(chunks).toString("utf8");
      if (!/<base\s/i.test(html)) html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + pfx.base + '">');
      res.writeHead(r.statusCode || 502, h); res.end(html);
    });
  });
  up.on("error", (e) => { res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }); res.end("proxy error: " + e.message); });
  req.pipe(up); // repassa o corpo (POST do manual.php); em GET encerra sem corpo
}
http.createServer((req, res) => {
  const pfx = PROXIES.find((x) => req.url.startsWith(x.prefix));
  if (pfx) return proxy(req, res, pfx);
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let file = path.join(__dirname, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": types[".html"] }); return fs.createReadStream(path.join(__dirname, "404.html")).pipe(res);
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log("MedicGLOBAL 2.0 em http://localhost:" + port));
