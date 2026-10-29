/* CMS — validação de imagens enviadas: formato real (pelos bytes, não pela extensão), dimensões e tamanho. */

function dims(buf) {
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: "png", mime: "image/png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // JPEG: percorre os marcadores até um SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: "jpg", mime: "image/jpeg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  // WebP (VP8, VP8L, VP8X)
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const f = buf.toString("ascii", 12, 16);
    if (f === "VP8 ") return { type: "webp", mime: "image/webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (f === "VP8L") { const b = buf.readUInt32LE(21); return { type: "webp", mime: "image/webp", w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (f === "VP8X") return { type: "webp", mime: "image/webp", w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  }
  // SVG (só para logotipo e favicon; conteúdo ativo é recusado)
  const head = buf.toString("utf8", 0, Math.min(buf.length, 4096));
  if (/<svg[\s>]/i.test(head)) {
    const s = buf.toString("utf8");
    if (/<script|<foreignObject|\bon\w+\s*=|javascript:|<iframe|<embed|<object|xlink:href\s*=\s*["']\s*(?:https?:|data:)/i.test(s)) return { type: "svg-unsafe" };
    const vb = /viewBox\s*=\s*["'][\d.\-]+[\s,]+[\d.\-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(s), h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(s);
    return { type: "svg", mime: "image/svg+xml", w: Math.round(w ? +w[1] : vb ? +vb[1] : 0), h: Math.round(h ? +h[1] : vb ? +vb[2] : 0) };
  }
  return null;
}

// regras por uso da imagem
const RULES = {
  photo:   { label: "Foto de conteúdo", types: ["jpg", "png", "webp"], maxBytes: 5 * 1024 * 1024, minW: 400, minH: 300, maxW: 6000, maxH: 6000 },
  logo:    { label: "Logotipo", types: ["png", "webp", "svg"], maxBytes: 1024 * 1024, minW: 120, minH: 40, maxW: 3000, maxH: 1500 },
  favicon: { label: "Favicon", types: ["png", "svg"], maxBytes: 512 * 1024, minW: 32, minH: 32, maxW: 1024, maxH: 1024, square: true },
};

function validate(buf, purpose) {
  const r = RULES[purpose];
  if (!r) return { error: "Tipo de imagem desconhecido." };
  if (!buf || !buf.length) return { error: "Arquivo vazio." };
  if (buf.length > r.maxBytes) return { error: `Arquivo muito grande (${(buf.length / 1048576).toFixed(1)} MB). Máximo para ${r.label.toLowerCase()}: ${(r.maxBytes / 1048576).toFixed(r.maxBytes < 1048576 ? 1 : 0)} MB.` };
  const d = dims(buf);
  if (!d) return { error: `Formato não reconhecido. Aceitos: ${r.types.map((t) => t.toUpperCase()).join(", ")}.` };
  if (d.type === "svg-unsafe") return { error: "O SVG contém scripts ou conteúdo externo e foi recusado por segurança." };
  if (!r.types.includes(d.type)) return { error: `Formato ${d.type.toUpperCase()} não aceito para ${r.label.toLowerCase()}. Aceitos: ${r.types.map((t) => t.toUpperCase()).join(", ")}.` };
  if (d.type !== "svg" || (d.w && d.h)) {
    if (d.w < r.minW || d.h < r.minH) return { error: `Imagem pequena demais (${d.w}×${d.h} px). Mínimo: ${r.minW}×${r.minH} px.` };
    if (d.w > r.maxW || d.h > r.maxH) return { error: `Imagem grande demais (${d.w}×${d.h} px). Máximo: ${r.maxW}×${r.maxH} px.` };
    if (r.square && Math.abs(d.w - d.h) > 1) return { error: `O favicon precisa ser quadrado (recebido ${d.w}×${d.h} px).` };
  }
  return { ok: true, info: d };
}

module.exports = { dims, validate, RULES };
