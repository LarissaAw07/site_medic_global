<?php
/* Autenticação: usuários no MySQL, senha com hash (password_hash), sessão, bloqueio após tentativas erradas. */

class Auth {
  const MAX_FAILS = 5;       // tentativas antes do bloqueio
  const WINDOW_MIN = 15;     // janela / duração do bloqueio, em minutos

  static function userCount() {
    return (int) DB::conn()->query("SELECT COUNT(*) c FROM ".DB::t('users'))->fetch()['c'];
  }
  static function byEmail($email) {
    $st = DB::conn()->prepare("SELECT * FROM ".DB::t('users')." WHERE email=? LIMIT 1");
    $st->execute([strtolower(trim($email))]);
    return $st->fetch() ?: null;
  }
  static function current() {
    if (empty($_SESSION['uid'])) return null;
    $st = DB::conn()->prepare("SELECT * FROM ".DB::t('users')." WHERE id=? LIMIT 1");
    $st->execute([$_SESSION['uid']]);
    return $st->fetch() ?: null;
  }
  static function requireLogin() {
    $u = self::current();
    if (!$u) redirect('?p=login');
    return $u;
  }

  static function create($email, $password, $role='admin', $mustChange=0) {
    $st = DB::conn()->prepare("INSERT INTO ".DB::t('users')." (email,pass_hash,role,must_change,created_at) VALUES (?,?,?,?,NOW())");
    $st->execute([strtolower(trim($email)), password_hash($password, PASSWORD_DEFAULT), $role, $mustChange ? 1 : 0]);
    return DB::conn()->lastInsertId();
  }
  static function setPassword($id, $password) {
    $st = DB::conn()->prepare("UPDATE ".DB::t('users')." SET pass_hash=?, must_change=0 WHERE id=?");
    $st->execute([password_hash($password, PASSWORD_DEFAULT), $id]);
  }

  /* ---------- bloqueio por IP ---------- */
  static function recentFails($ip) {
    $st = DB::conn()->prepare("SELECT COUNT(*) c FROM ".DB::t('login_attempt')." WHERE ip=? AND at > (NOW() - INTERVAL ".self::WINDOW_MIN." MINUTE)");
    $st->execute([$ip]);
    return (int) $st->fetch()['c'];
  }
  static function isLocked($ip) { return self::recentFails($ip) >= self::MAX_FAILS; }
  static function recordFail($ip) {
    DB::conn()->prepare("INSERT INTO ".DB::t('login_attempt')." (ip,at) VALUES (?,NOW())")->execute([$ip]);
  }
  static function clearFails($ip) {
    DB::conn()->prepare("DELETE FROM ".DB::t('login_attempt')." WHERE ip=?")->execute([$ip]);
  }

  /* devolve [ok, mensagem]; em caso de sucesso inicia a sessão */
  static function login($email, $password) {
    $ip = client_ip();
    if (self::isLocked($ip)) return [false, 'Muitas tentativas. Aguarde '.self::WINDOW_MIN.' minutos e tente novamente.'];
    $u = self::byEmail($email);
    if (!$u || !password_verify($password, $u['pass_hash'])) {
      self::recordFail($ip);
      $left = max(0, self::MAX_FAILS - self::recentFails($ip));
      return [false, 'E-mail ou senha incorretos.'.($left && $left<=3 ? " Restam $left tentativa(s)." : '')];
    }
    self::clearFails($ip);
    if (session_status() === PHP_SESSION_ACTIVE) session_regenerate_id(true);
    $_SESSION['uid'] = $u['id'];
    DB::conn()->prepare("UPDATE ".DB::t('users')." SET last_login=NOW() WHERE id=?")->execute([$u['id']]);
    return [true, ''];
  }
  static function logout() {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) { $p = session_get_cookie_params(); setcookie(session_name(),'',time()-42000,$p['path'],$p['domain'],$p['secure'],$p['httponly']); }
    session_destroy();
  }
}
