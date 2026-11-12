<?php
/* Validação de imagens enviadas (equivale a cms/images.js): formato real (pelos bytes), dimensões e tamanho. */

final class Images {
  // regras por uso da imagem
  const RULES = [
    'photo'   => ['label' => 'Foto de conteúdo', 'types' => ['jpg', 'png', 'webp'], 'maxBytes' => 2097152, 'minW' => 400, 'minH' => 300, 'maxW' => 6000, 'maxH' => 6000],
    'logo'    => ['label' => 'Logotipo', 'types' => ['png', 'webp', 'svg'], 'maxBytes' => 512000, 'minW' => 120, 'minH' => 40, 'maxW' => 3000, 'maxH' => 1500],
    'favicon' => ['label' => 'Favicon', 'types' => ['png', 'svg'], 'maxBytes' => 204800, 'minW' => 32, 'minH' => 32, 'maxW' => 1024, 'maxH' => 1024, 'square' => true],
    // capturas de resultados (IDSS): costumam ser faixas largas e baixas
    'doc'     => ['label' => 'Imagem de documento', 'types' => ['jpg', 'png', 'webp'], 'maxBytes' => 2097152, 'minW' => 200, 'minH' => 60, 'maxW' => 6000, 'maxH' => 8000],
  ];

  static function dims($b) {
    $n = strlen($b);
    $u32be = fn($i) => unpack('N', substr($b, $i, 4))[1];
    $u16be = fn($i) => unpack('n', substr($b, $i, 2))[1];
    $u16le = fn($i) => unpack('v', substr($b, $i, 2))[1];
    if ($n > 24 && $u32be(0) === 0x89504e47) return ['type' => 'png', 'mime' => 'image/png', 'w' => $u32be(16), 'h' => $u32be(20)];
    if ($n > 2 && ord($b[0]) === 0xff && ord($b[1]) === 0xd8) {
      $i = 2;
      while ($i + 9 < $n) {
        if (ord($b[$i]) !== 0xff) { $i++; continue; }
        $m = ord($b[$i + 1]);
        if ($m >= 0xc0 && $m <= 0xcf && !in_array($m, [0xc4, 0xc8, 0xcc], true)) return ['type' => 'jpg', 'mime' => 'image/jpeg', 'h' => $u16be($i + 5), 'w' => $u16be($i + 7)];
        $i += 2 + $u16be($i + 2);
      }
      return null;
    }
    if ($n > 30 && substr($b, 0, 4) === 'RIFF' && substr($b, 8, 4) === 'WEBP') {
      $f = substr($b, 12, 4);
      if ($f === 'VP8 ') return ['type' => 'webp', 'mime' => 'image/webp', 'w' => $u16le(26) & 0x3fff, 'h' => $u16le(28) & 0x3fff];
      if ($f === 'VP8L') { $x = unpack('V', substr($b, 21, 4))[1]; return ['type' => 'webp', 'mime' => 'image/webp', 'w' => ($x & 0x3fff) + 1, 'h' => (($x >> 14) & 0x3fff) + 1]; }
      if ($f === 'VP8X') { $w = unpack('V', substr($b, 24, 3) . "\0")[1]; $h = unpack('V', substr($b, 27, 3) . "\0")[1]; return ['type' => 'webp', 'mime' => 'image/webp', 'w' => 1 + $w, 'h' => 1 + $h]; }
    }
    // SVG (só para logotipo e favicon; conteúdo ativo é recusado)
    $head = substr($b, 0, min($n, 4096));
    if (preg_match('/<svg[\s>]/i', $head)) {
      $s = $b;
      if (preg_match('/<script|<foreignObject|\bon\w+\s*=|javascript:|vbscript:|<iframe|<embed|<object|<set\b|<animate|<handler|<!ENTITY|<\?xml-stylesheet|@import|url\(\s*["\']?\s*(?:https?:|data:|\/\/)|&#/i', $s)) return ['type' => 'svg-unsafe'];
      if (preg_match('/\b(?:xlink:)?href\s*=\s*["\']\s*(?!#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i', $s)) return ['type' => 'svg-unsafe'];
      $vb = preg_match('/viewBox\s*=\s*["\'][\d.\-]+[\s,]+[\d.\-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i', $s, $mv) ? $mv : null;
      $w = preg_match('/<svg[^>]*\swidth\s*=\s*["\']([\d.]+)/i', $s, $mw) ? $mw : null;
      $h = preg_match('/<svg[^>]*\sheight\s*=\s*["\']([\d.]+)/i', $s, $mh) ? $mh : null;
      return ['type' => 'svg', 'mime' => 'image/svg+xml', 'w' => (int) round($w ? +$w[1] : ($vb ? +$vb[1] : 0)), 'h' => (int) round($h ? +$h[1] : ($vb ? +$vb[2] : 0))];
    }
    return null;
  }

  static function mb1($bytes) { return str_replace('.', '.', number_format($bytes / 1048576, 1, '.', '')); }
  static function validate($buf, $purpose) {
    $r = self::RULES[$purpose] ?? null;
    if (!$r) return ['error' => 'Tipo de imagem desconhecido.'];
    if ($buf === null || $buf === '') return ['error' => 'Arquivo vazio.'];
    $len = strlen($buf);
    $types = implode(', ', array_map('strtoupper', $r['types']));
    if ($len > $r['maxBytes']) {
      $max = $r['maxBytes'] < 1048576 ? round($r['maxBytes'] / 1024) . ' KB' : ($r['maxBytes'] / 1048576) . ' MB';
      return ['error' => 'Arquivo muito grande (' . self::mb1($len) . ' MB). Máximo para ' . mb_strtolower($r['label']) . ": $max. Reduza ou comprima a imagem antes de enviar."];
    }
    $d = self::dims($buf);
    if (!$d) return ['error' => "Formato não reconhecido. Aceitos: $types."];
    if ($d['type'] === 'svg-unsafe') return ['error' => 'O SVG contém scripts ou conteúdo externo e foi recusado por segurança.'];
    if (!in_array($d['type'], $r['types'], true)) return ['error' => 'Formato ' . strtoupper($d['type']) . ' não aceito para ' . mb_strtolower($r['label']) . ". Aceitos: $types."];
    if ($d['type'] !== 'svg' || ($d['w'] && $d['h'])) {
      if ($d['w'] < $r['minW'] || $d['h'] < $r['minH']) return ['error' => "Imagem pequena demais ({$d['w']}×{$d['h']} px). Mínimo: {$r['minW']}×{$r['minH']} px."];
      if ($d['w'] > $r['maxW'] || $d['h'] > $r['maxH']) return ['error' => "Imagem grande demais ({$d['w']}×{$d['h']} px). Máximo: {$r['maxW']}×{$r['maxH']} px."];
      if (!empty($r['square']) && abs($d['w'] - $d['h']) > 1) return ['error' => "O favicon precisa ser quadrado (recebido {$d['w']}×{$d['h']} px)."];
    }
    return ['ok' => true, 'info' => $d];
  }
}
