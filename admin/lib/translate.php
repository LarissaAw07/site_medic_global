<?php
/* Tradução automática PT → EN do que é editado no painel (equivale a cms/translate.js).
   Serviço: DeepL se 'deepl_key' estiver no config.php; senão, o tradutor público do Google (sem chave).
   Tokens {{...}} vão protegidos com translate="no"; cada trecho traduzido fica em cache no banco. */

final class Translate {
  private static $cache = null;
  private static function mem() { if (self::$cache === null) { self::$cache = kv_read('translations', []); if (!is_array(self::$cache)) self::$cache = []; } return self::$cache; }
  private static function hash($s) { return substr(sha1($s), 0, 20); }
  private static function keepCase($src, $to) { return preg_match('/^[A-Z]/', $src) ? mb_strtoupper(mb_substr($to, 0, 1)) . mb_substr($to, 1) : $to; }
  // termos do glossário (src/en/GLOSSARY.md) que os tradutores automáticos costumam errar
  private static function polish($s) {
    $s = preg_replace_callback('/\bbeneficiar(y|ies)\b/i', fn($m) => self::keepCase($m[0], strtolower($m[1]) === 'y' ? 'member' : 'members'), $s);
    $s = preg_replace_callback('/\b(accredited|credentialed) network\b/i', fn($m) => self::keepCase($m[0], 'provider network'), $s);
    $s = preg_replace_callback('/\bmedical guide\b/i', fn($m) => self::keepCase($m[0], 'provider directory'), $s);
    $s = preg_replace_callback('/\bombudsman([\'’]s)? office\b/iu', fn($m) => self::keepCase($m[0], 'Ombudsman'), $s);
    return $s;
  }
  static function provider() { return Cfg::get('deepl_key') ? 'DeepL' : 'Google Tradutor'; }

  private static function post($url, $headers, $body) {
    $ch = mg_curl(curl_init($url));
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10]);
    $res = curl_exec($ch);
    if ($res === false) { $e = curl_error($ch); curl_close($ch); throw new RuntimeException($e ?: 'sem conexão com o tradutor'); }
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    return [$code, $res];
  }
  private static function google($list) {
    [$code, $res] = self::post('https://translate.googleapis.com/translate_a/t?client=gtx&sl=pt&tl=en&format=html', ['Content-Type: application/x-www-form-urlencoded;charset=UTF-8'],
      implode('&', array_map(fn($q) => 'q=' . enc_uri($q), $list)));
    if ($code < 200 || $code >= 300) throw new RuntimeException('o tradutor respondeu ' . $code);
    $j = json_decode($res, true);
    if (!is_array($j) || !array_is_list($j)) $j = [$j];
    $j = array_map(fn($x) => is_array($x) ? $x[0] : $x, $j);
    if (count($j) !== count($list)) throw new RuntimeException('resposta do tradutor fora do formato');
    return $j;
  }
  private static function deepl($list) {
    $key = Cfg::get('deepl_key');
    $host = preg_match('/:fx$/', $key) ? 'api-free.deepl.com' : 'api.deepl.com';
    [$code, $res] = self::post("https://$host/v2/translate", ['Authorization: DeepL-Auth-Key ' . $key, 'Content-Type: application/json'],
      je(['text' => $list, 'source_lang' => 'PT', 'target_lang' => 'EN-US', 'tag_handling' => 'html']));
    if ($code < 200 || $code >= 300) throw new RuntimeException('o DeepL respondeu ' . $code);
    return array_map(fn($t) => $t['text'], json_decode($res, true)['translations']);
  }
  private static function protect($h) { return preg_replace_callback('/\{\{[^}]+\}\}/', fn($m) => '<span translate="no">' . $m[0] . '</span>', $h); }
  private static function unprotect($h) { return preg_replace('/<span translate="no">\s*(\{\{[^}]+\}\})\s*<\/span>/u', '$1', $h); }
  private static function esc($s) { return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], (string)$s); }
  private static function decode($s) { return str_replace('&amp;', '&', str_replace(['&nbsp;', '&lt;', '&gt;', '&quot;', '&#39;'], [' ', '<', '>', '"', "'"], preg_replace('/<[^>]+>/', '', $s))); }
  private static function hasWords($h) { return (bool) preg_match('/\p{L}/u', preg_replace('/\{\{[^}]+\}\}|<[^>]+>|&[#\w]+;/u', '', $h)); }

  // traduz HTMLs de texto (usa o cache e manda o resto em lotes)
  private static function many($htmls) {
    $c = self::mem();
    $todo = array_values(array_unique(array_filter($htmls, fn($t) => self::hasWords($t) && !array_key_exists(self::hash($t), $c))));
    for ($i = 0; $i < count($todo);) {
      $batch = []; $size = 0;
      while ($i < count($todo) && count($batch) < 40 && $size + mb_strlen($todo[$i]) < 4000) { $size += mb_strlen($todo[$i]) + 3; $batch[] = $todo[$i++]; }
      if (!$batch) $batch[] = $todo[$i++];
      $res = Cfg::get('deepl_key') ? self::deepl(array_map([self::class, 'protect'], $batch)) : self::google(array_map([self::class, 'protect'], $batch));
      foreach ($batch as $k => $t) $c[self::hash($t)] = self::polish(trim(preg_replace('/<br>\s+/u', '<br>', self::unprotect((string)($res[$k] ?? '')))));
    }
    if ($todo) { self::$cache = $c; kv_write('translations', $c); }
    return array_map(fn($t) => self::hasWords($t) ? $c[self::hash($t)] : $t, $htmls);
  }
  /* Cada item: ['html' => …] (texto com marcação) ou ['text' => …]. Devolve a lista na mesma ordem. */
  static function items($items) {
    $tr = self::many(array_map(fn($it) => array_key_exists('html', $it) ? trim((string)$it['html']) : self::esc($it['text'] ?? ''), $items));
    $out = [];
    foreach ($items as $i => $it) $out[] = array_key_exists('html', $it) ? ['html' => $tr[$i]] : ['text' => self::decode($tr[$i])];
    return $out;
  }
}
