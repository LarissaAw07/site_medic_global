<?php
/* Bootstrap do painel: configuração, conexão MySQL (com criação automática das tabelas), sessão e utilidades. */
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
mb_internal_encoding('UTF-8');

require __DIR__.'/html.php';

class Config {
  static $c = null;
  static function get() {
    if (self::$c === null) {
      $f = __DIR__.'/../config.php';
      self::$c = file_exists($f) ? (require $f) : false;
    }
    return self::$c;
  }
  static function ok() { $c = self::get(); return $c && !empty($c['db']['name']); }
  static function prefix() { $c = self::get(); return $c['db']['prefix'] ?? 'mg_admin_'; }
  static function siteRoot() { $c = self::get(); return rtrim($c['site_root'] ?? dirname(__DIR__,2), '/\\'); }
  static function uploadsDir() { $c = self::get(); return trim($c['uploads_dir'] ?? 'assets/img/uploads', '/\\'); }
}

class DB {
  static $pdo = null;
  static function conn() {
    if (self::$pdo) return self::$pdo;
    $c = Config::get()['db'];
    $dsn = "mysql:host={$c['host']};dbname={$c['name']};charset=".($c['charset'] ?? 'utf8mb4');
    self::$pdo = new PDO($dsn, $c['user'], $c['pass'], [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    self::migrate();
    return self::$pdo;
  }
  static function migrate() {
    $p = Config::prefix();
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS {$p}users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      pass_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'admin',
      must_change TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      last_login DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS {$p}audit (
      id INT AUTO_INCREMENT PRIMARY KEY,
      at DATETIME NOT NULL,
      user_email VARCHAR(190),
      action VARCHAR(40),
      detail VARCHAR(255),
      changes MEDIUMTEXT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS {$p}backup (
      id INT AUTO_INCREMENT PRIMARY KEY,
      at DATETIME NOT NULL,
      user_email VARCHAR(190),
      file VARCHAR(255) NOT NULL,
      html LONGTEXT NOT NULL,
      KEY file_at (file, at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    self::$pdo->exec("CREATE TABLE IF NOT EXISTS {$p}login_attempt (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ip VARCHAR(64) NOT NULL,
      at DATETIME NOT NULL,
      KEY ip_at (ip, at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  }
  static function t($name) { return Config::prefix().$name; }
}

/* ---------- utilidades ---------- */
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function redirect($to) { header('Location: '.$to); exit; }
function client_ip() { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }

function start_session() {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  session_name('mg_admin');
  session_set_cookie_params(['httponly'=>true, 'samesite'=>'Strict', 'secure'=>(($_SERVER['HTTPS'] ?? '')!=='')]);
  session_start();
}

function csrf_token() {
  if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
  return $_SESSION['csrf'];
}
function csrf_check() {
  $t = $_POST['csrf'] ?? '';
  if (!$t || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $t)) { http_response_code(400); die('Token inválido. Recarregue a página e tente de novo.'); }
}
