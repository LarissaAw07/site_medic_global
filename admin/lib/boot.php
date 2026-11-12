<?php
/* Painel MedicGLOBAL (PHP) — configuração, banco MySQL (tabelas criadas automaticamente) e utilidades comuns.
   Versão PHP do painel em Node (cms/): mesma interface (cms/admin → admin/), mesma API e mesmas regras. */
error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('display_errors', '0');
mb_internal_encoding('UTF-8');
date_default_timezone_set('UTC');

final class Cfg {
  private static $c = null;
  static function all() {
    if (self::$c === null) {
      $f = __DIR__ . '/../config.php';
      self::$c = is_file($f) ? (require $f) : [];
    }
    return self::$c;
  }
  static function get($k, $def = null) { $c = self::all(); return array_key_exists($k, $c) ? $c[$k] : $def; }
  static function ok() { $c = self::all(); return !empty($c['db']['name']); }
}

define('MG_ROOT', rtrim(str_replace('\\', '/', Cfg::get('root', dirname(__DIR__, 2))), '/'));
define('MG_PUBLIC', rtrim(str_replace('\\', '/', Cfg::get('public_dir', MG_ROOT)), '/'));
define('MG_DATA', rtrim(str_replace('\\', '/', Cfg::get('data_dir', dirname(__DIR__) . '/data')), '/'));
// endereços do painel (o painel em Node usa /api/admin/*, /admin/media/* …; aqui tudo passa por /admin/api.php,
// que funciona sem URL Rewrite no IIS)
define('MG_API', '/admin/api.php');

const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS;
function je($v, $pretty = false) { return json_encode($v, JSON_FLAGS | ($pretty ? JSON_PRETTY_PRINT : 0)); }
function jd($s, $def = null) { if ($s === null || $s === '') return $def; $v = json_decode($s, true); return $v === null && trim($s) !== 'null' ? $def : $v; }
// data/hora no formato do toISOString() do JavaScript
function iso_now() { $t = microtime(true); return gmdate('Y-m-d\TH:i:s', (int)$t) . sprintf('.%03dZ', (int)(($t - floor($t)) * 1000)); }
function now_ms() { return (int) round(microtime(true) * 1000); }
function iso_of_ms($ms) { return gmdate('Y-m-d\TH:i:s', intdiv($ms, 1000)) . sprintf('.%03dZ', $ms % 1000); }
function ms_of_iso($s) { $t = strtotime((string)$s); return $t === false ? 0 : $t * 1000; }
function mg_dirs() {
  static $d = null;
  if ($d) return $d;
  $d = ['data' => MG_DATA, 'uploads' => MG_DATA . '/uploads', 'preview' => MG_DATA . '/preview', 'attachments' => MG_DATA . '/anexos', 'cache' => MG_DATA . '/cache'];
  foreach ($d as $p) if (!is_dir($p)) @mkdir($p, 0700, true);
  // a pasta de dados nunca é servida direto (IIS e Apache)
  if (!is_file(MG_DATA . '/web.config')) @file_put_contents(MG_DATA . '/web.config', "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization><security><requestFiltering><hiddenSegments><add segment=\"uploads\" /><add segment=\"preview\" /><add segment=\"anexos\" /><add segment=\"cache\" /></hiddenSegments></requestFiltering></security></system.webServer></configuration>\n");
  if (!is_file(MG_DATA . '/.htaccess')) @file_put_contents(MG_DATA . '/.htaccess', "Require all denied\nDeny from all\n");
  return $d;
}

/* ---------- MySQL ---------- */
final class DB {
  private static $pdo = null;
  static function t($n) { $c = Cfg::get('db'); return ($c['prefix'] ?? 'mg_cms_') . $n; }
  static function conn() {
    if (self::$pdo) return self::$pdo;
    $c = Cfg::get('db');
    $dsn = 'mysql:host=' . $c['host'] . (!empty($c['port']) ? ';port=' . (int)$c['port'] : '') . ';dbname=' . $c['name'] . ';charset=' . ($c['charset'] ?? 'utf8mb4');
    self::$pdo = new PDO($dsn, $c['user'], $c['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    self::$pdo->exec("SET time_zone = '+00:00'");
    self::migrate();
    return self::$pdo;
  }
  private static function migrate() {
    $kv = self::t('kv');
    $have = self::$pdo->query("SHOW TABLES LIKE " . self::$pdo->quote($kv))->fetch();
    if ($have) return;
    $o = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    // documentos JSON do painel: rascunho, publicado, usuários, configurações, traduções
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS $kv (k VARCHAR(64) PRIMARY KEY, v LONGTEXT NOT NULL, updated_at DATETIME(3) NOT NULL) $o");
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS " . self::t('audit') . " (id BIGINT AUTO_INCREMENT PRIMARY KEY, at VARCHAR(30) NOT NULL, user VARCHAR(190) NOT NULL, action VARCHAR(60) NOT NULL, detail TEXT NULL, changes LONGTEXT NULL, KEY at_idx (at)) $o");
    // versões publicadas anteriores (as 30 últimas)
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS " . self::t('history') . " (id VARCHAR(40) PRIMARY KEY, at VARCHAR(30) NOT NULL, by_user VARCHAR(190) NOT NULL, content LONGTEXT NOT NULL) $o");
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS " . self::t('sessions') . " (sid VARCHAR(64) PRIMARY KEY, email VARCHAR(190) NOT NULL, csrf VARCHAR(64) NOT NULL, created BIGINT NOT NULL, seen BIGINT NOT NULL, ip VARCHAR(64) NOT NULL, pw_fails INT NOT NULL DEFAULT 0, KEY email_idx (email)) $o");
    // tentativas de login (por rede e por conta+rede) e limite de envios dos formulários
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS " . self::t('hits') . " (id BIGINT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(20) NOT NULL, k VARCHAR(255) NOT NULL, at BIGINT NOT NULL, KEY kind_k (kind, k, at)) $o");
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS " . self::t('locks') . " (k VARCHAR(255) PRIMARY KEY, failed INT NOT NULL, until_ms BIGINT NOT NULL, last_ms BIGINT NOT NULL) $o");
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS " . self::t('submissions') . " (id VARCHAR(40) PRIMARY KEY, form VARCHAR(60) NOT NULL, at VARCHAR(30) NOT NULL, record LONGTEXT NOT NULL, KEY form_at (form, at)) $o");
  }
  static function q($sql, $args = []) { $st = self::conn()->prepare($sql); $st->execute($args); return $st; }
}

/* armazenamento chave → JSON (equivale aos arquivos .json da pasta de dados do painel em Node) */
function kv_read($k, $def = null) {
  $r = DB::q("SELECT v FROM " . DB::t('kv') . " WHERE k=?", [$k])->fetch();
  return $r ? jd($r['v'], $def) : $def;
}
function kv_write($k, $v) {
  DB::q("INSERT INTO " . DB::t('kv') . " (k, v, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE v=VALUES(v), updated_at=VALUES(updated_at)", [$k, je($v)]);
}

/* ---------- utilidades de texto (comportamento igual ao do JavaScript) ---------- */
// encodeURIComponent
function enc_uri($s) { return strtr(rawurlencode((string)$s), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']); }
// String(v) do JavaScript para valores vindos do JSON
function js_str($v) {
  if ($v === null) return 'null';
  if ($v === true) return 'true';
  if ($v === false) return 'false';
  if (is_array($v)) return is_list_arr($v) ? implode(',', array_map(fn($x) => $x === null ? '' : js_str($x), $v)) : '[object Object]';
  if (is_float($v)) { if (floor($v) == $v && abs($v) < 1e21) return (string)(int)$v; return rtrim(rtrim(sprintf('%.15g', $v), '0'), '.'); }
  return (string)$v;
}
function is_list_arr($a) { return is_array($a) && array_is_list($a); }
function str_or($v) { return $v === null ? '' : js_str($v); }
// caminho a.b.c em arrays associativos
function get_path($o, $p) { foreach (explode('.', $p) as $k) { if (!is_array($o) || !array_key_exists($k, $o)) return null; $o = $o[$k]; } return $o; }
function has_path($o, $p) { foreach (explode('.', $p) as $k) { if (!is_array($o) || !array_key_exists($k, $o)) return false; $o = $o[$k]; } return true; }
function set_path(&$o, $p, $v, $unset = false) {
  $ks = explode('.', $p); $last = array_pop($ks); $cur = &$o;
  foreach ($ks as $k) { if (!isset($cur[$k]) || !is_array($cur[$k])) $cur[$k] = []; $cur = &$cur[$k]; }
  if ($unset) unset($cur[$last]); else $cur[$last] = $v;
}
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

/* cURL: sem um pacote de certificados configurado no PHP (curl.cainfo), usa os certificados do sistema
   (Windows/IIS costuma vir sem o pacote; sem isso as chamadas HTTPS ao tradutor e ao Google falham). */
function mg_curl($ch) {
  if (!ini_get('curl.cainfo') && !ini_get('openssl.cafile') && defined('CURLSSLOPT_NATIVE_CA')) curl_setopt($ch, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
  return $ch;
}
