/* Servidor estático local para visualizar o site: node serve.js  →  http://localhost:8080 */
const http = require("http"), fs = require("fs"), path = require("path");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain", ".woff2": "font/woff2" };
const port = process.env.PORT || 8080;
http.createServer((req, res) => {
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
