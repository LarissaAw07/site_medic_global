<?php
/* Autenticação (equivale a cms/auth.js): senhas com hash forte (Argon2id, ou bcrypt se indisponível), sessões no
   servidor (cookie HttpOnly + SameSite=Strict), token anti-CSRF por sessão e bloqueio progressivo de tentativas. */

final class Auth {
  const IDLE = 2 * 60 * 60 * 1000;      // sessão expira após 2 h sem uso
  const ABSOLUTE = 12 * 60 * 60 * 1000; // e no máximo 12 h depois do login
  const MAX_USERS = 3;
  const PERMS = [
    'pages' => 'Páginas do site',
    'news' => 'Notícias',
    'identity' => 'Identidade visual',
    'forms' => 'Formulários',
    'submissions' => 'Envios recebidos (dados pessoais)',
    'analytics' => 'Google Analytics',
    'audit' => 'Auditoria',
    'publish' => 'Publicar alterações no site',
    'users' => 'Gerenciar usuários',
  ];

  static function hashPassword($pw) {
    return defined('PASSWORD_ARGON2ID') ? password_hash((string)$pw, PASSWORD_ARGON2ID) : password_hash(hash('sha256', (string)$pw), PASSWORD_BCRYPT, ['cost' => 12]);
  }
  static function verifyPassword($pw, $stored) {
    $stored = (string)$stored;
    if ($stored === '') return false;
    if (str_starts_with($stored, '$argon2')) return password_verify((string)$pw, $stored);
    return password_verify(hash('sha256', (string)$pw), $stored);
  }
  // regras da senha: 12+ caracteres, com letras maiúsculas, minúsculas, números e símbolos
  static function passwordProblem($pw, $email = '') {
    $pw = (string)($pw ?? '');
    $len = mb_strlen($pw);
    if ($len < 12) return 'A senha precisa ter pelo menos 12 caracteres.';
    if ($len > 128) return 'A senha pode ter no máximo 128 caracteres.';
    if (!preg_match('/[a-z]/', $pw) || !preg_match('/[A-Z]/', $pw) || !preg_match('/\d/', $pw) || !preg_match('/[^A-Za-z0-9]/', $pw)) return 'Use letras maiúsculas, minúsculas, números e pelo menos um símbolo.';
    if ($email && str_contains(mb_strtolower($pw), mb_strtolower(explode('@', (string)$email)[0]))) return 'A senha não pode conter o seu usuário.';
    return '';
  }
  static function can($u, $perm) { return $u && (($u['role'] ?? '') === 'admin' || in_array($perm, $u['perms'] ?? [], true)); }
  static function permsOf($u) { return ($u['role'] ?? '') === 'admin' ? array_keys(self::PERMS) : array_values(array_filter($u['perms'] ?? [], fn($p) => isset(self::PERMS[$p]))); }

  /* ---------- usuários (no máximo MAX_USERS; o primeiro é o administrador principal) ---------- */
  static function all() { $l = kv_read('users', []); return is_array($l) ? $l : []; }
  static function find($email) { $e = mb_strtolower(trim((string)$email)); foreach (self::all() as $u) if ($u['email'] === $e) return $u; return null; }
  static function save($list) { kv_write('users', array_values($list)); }
  static function upsert($email, $password, $opts = []) {
    $email = mb_strtolower(trim((string)$email));
    $list = self::all(); $i = null;
    foreach ($list as $k => $x) if ($x['email'] === $email) $i = $k;
    if ($i === null) {
      if (count($list) >= self::MAX_USERS) throw new ApiError(422, 'Limite de ' . self::MAX_USERS . ' usuários atingido.');
      $list[] = ['email' => $email, 'name' => ($opts['name'] ?? '') ?: 'Administrador', 'role' => $list ? 'editor' : 'admin', 'perms' => [], 'createdAt' => iso_now()];
      $i = count($list) - 1;
    }
    $u = &$list[$i];
    if (!empty($opts['name'])) $u['name'] = $opts['name'];
    if (isset($opts['perms']) && $u['role'] !== 'admin') $u['perms'] = array_values(array_filter($opts['perms'], fn($p) => isset(self::PERMS[$p])));
    if (!empty($opts['by'])) $u['createdBy'] = ($u['createdBy'] ?? '') ?: $opts['by'];
    $u['hash'] = self::hashPassword($password);
    $u['mustChange'] = !empty($opts['mustChange']);
    $u['passwordChangedAt'] = iso_now();
    $u['failed'] = 0; $u['lockedUntil'] = 0;
    $out = $u; unset($u);
    self::save($list);
    return $out;
  }
  static function update($email, $fields) {
    $list = self::all();
    foreach ($list as $k => $u) if ($u['email'] === $email) {
      if (array_key_exists('name', $fields)) $list[$k]['name'] = $fields['name'];
      if (isset($fields['perms']) && $u['role'] !== 'admin') $list[$k]['perms'] = array_values(array_filter($fields['perms'], fn($p) => isset(self::PERMS[$p])));
      self::save($list);
      return $list[$k];
    }
    return null;
  }
  static function remove($email) {
    self::save(array_filter(self::all(), fn($x) => $x['email'] !== $email));
    DB::q("DELETE FROM " . DB::t('sessions') . " WHERE email=?", [$email]);
  }
  // senha provisória forte (cumpre as regras de passwordProblem)
  static function tempPassword() {
    $pick = function ($set, $n) { $s = ''; for ($i = 0; $i < $n; $i++) $s .= $set[ord(random_bytes(1)) % strlen($set)]; return $s; };
    for (;;) {
      $s = $pick('ABCDEFGHJKLMNPQRSTUVWXYZ', 3) . $pick('abcdefghijkmnpqrstuvwxyz', 5) . $pick('23456789', 3) . $pick('#%@!*+=?', 2) . $pick('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', 3);
      $a = str_split($s);
      for ($i = count($a) - 1; $i > 0; $i--) { $j = random_int(0, $i); [$a[$i], $a[$j]] = [$a[$j], $a[$i]]; }
      return implode('', $a);
    }
  }

  /* ---------- limite de tentativas ----------
     Por rede (IP): 20 erros em 15 min bloqueiam a rede. Por conta: o bloqueio progressivo vale só para a rede de
     onde vieram os erros, assim quem erra a senha de outro lugar não consegue trancar o acesso do administrador. */
  private static function accKey($email, $ip) { return mb_strtolower(trim((string)$email)) . '|' . $ip; }
  private static function lockedFor($email, $ip) {
    $r = DB::q("SELECT until_ms FROM " . DB::t('locks') . " WHERE k=?", [self::accKey($email, $ip)])->fetch();
    return $r && $r['until_ms'] > now_ms() ? (int)$r['until_ms'] : 0;
  }
  static function isLocked($email) { return (bool) DB::q("SELECT 1 FROM " . DB::t('locks') . " WHERE k LIKE ? AND until_ms > ? LIMIT 1", [addcslashes($email, '%_') . '|%', now_ms()])->fetch(); }
  static function unlock($email) { DB::q("DELETE FROM " . DB::t('locks') . " WHERE k LIKE ?", [addcslashes($email, '%_') . '|%']); }
  private static function ipBlocked($ip) {
    $n = DB::q("SELECT COUNT(*) c FROM " . DB::t('hits') . " WHERE kind='login_ip' AND k=? AND at > ?", [$ip, now_ms() - 15 * 60 * 1000])->fetch()['c'];
    return $n >= 20;
  }
  private static function cleanup() {
    if (random_int(1, 20) !== 1) return;
    DB::q("DELETE FROM " . DB::t('hits') . " WHERE at < ?", [now_ms() - 24 * 3600 * 1000]);
    DB::q("DELETE FROM " . DB::t('locks') . " WHERE until_ms < ? AND last_ms < ?", [now_ms(), now_ms() - 24 * 3600 * 1000]);
    DB::q("DELETE FROM " . DB::t('sessions') . " WHERE seen < ? OR created < ?", [now_ms() - self::IDLE, now_ms() - self::ABSOLUTE]);
  }

  static function login($email, $password, $ip) {
    self::cleanup();
    if (self::ipBlocked($ip)) return ['error' => 'Muitas tentativas a partir desta rede. Aguarde 15 minutos e tente novamente.', 'status' => 429];
    $until = self::lockedFor($email, $ip);
    if ($until) {
      $min = (int) ceil(($until - now_ms()) / 60000);
      return ['error' => "Acesso bloqueado temporariamente por tentativas incorretas. Tente novamente em $min min.", 'status' => 429];
    }
    $found = self::find($email);
    // e-mail inexistente: o hash é calculado do mesmo jeito (a resposta leva o mesmo tempo)
    $ok = self::verifyPassword($password, $found ? $found['hash'] : self::hashPassword(bin2hex(random_bytes(8)))) && $found;
    if (!$ok) {
      DB::q("INSERT INTO " . DB::t('hits') . " (kind, k, at) VALUES ('login_ip', ?, ?)", [$ip, now_ms()]);
      if ($found) {
        $k = self::accKey($email, $ip);
        $a = DB::q("SELECT failed FROM " . DB::t('locks') . " WHERE k=?", [$k])->fetch();
        $failed = ($a ? (int)$a['failed'] : 0) + 1;
        // a partir de 5 erros seguidos desta rede: bloqueio de 15 min para esta rede (dobrando a cada novo erro, até 24 h)
        $until = $failed >= 5 ? now_ms() + (int) min(15 * 60 * 1000 * 2 ** ($failed - 5), 24 * 3600 * 1000) : 0;
        DB::q("INSERT INTO " . DB::t('locks') . " (k, failed, until_ms, last_ms) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE failed=VALUES(failed), until_ms=VALUES(until_ms), last_ms=VALUES(last_ms)", [$k, $failed, $until, now_ms()]);
      }
      audit($email, 'login_falhou', $ip);
      return ['error' => 'E-mail ou senha incorretos.', 'status' => 401];
    }
    DB::q("DELETE FROM " . DB::t('locks') . " WHERE k=?", [self::accKey($email, $ip)]);
    $list = self::all(); $u = null;
    foreach ($list as $k => $x) if ($x['email'] === $found['email']) { $list[$k]['failed'] = 0; $list[$k]['lockedUntil'] = 0; $list[$k]['lastLogin'] = iso_now(); $u = $list[$k]; }
    if (!$u) return ['error' => 'E-mail ou senha incorretos.', 'status' => 401];
    self::save($list);
    $b64 = fn($n) => rtrim(strtr(base64_encode(random_bytes($n)), '+/', '-_'), '=');
    $s = ['sid' => $b64(32), 'email' => $u['email'], 'csrf' => $b64(24), 'created' => now_ms(), 'seen' => now_ms(), 'ip' => $ip, 'pwFails' => 0];
    DB::q("INSERT INTO " . DB::t('sessions') . " (sid, email, csrf, created, seen, ip) VALUES (?, ?, ?, ?, ?, ?)", [$s['sid'], $s['email'], $s['csrf'], $s['created'], $s['seen'], $ip]);
    audit($u['email'], 'login', $ip);
    return ['session' => $s, 'user' => $u];
  }
  static function session($sid) {
    if (!$sid || !is_string($sid)) return null;
    $r = DB::q("SELECT * FROM " . DB::t('sessions') . " WHERE sid=?", [$sid])->fetch();
    if (!$r) return null;
    $now = now_ms();
    if ($now - $r['seen'] > self::IDLE || $now - $r['created'] > self::ABSOLUTE || !self::find($r['email'])) { self::logout($sid); return null; }
    DB::q("UPDATE " . DB::t('sessions') . " SET seen=? WHERE sid=?", [$now, $sid]);
    return ['sid' => $r['sid'], 'email' => $r['email'], 'csrf' => $r['csrf'], 'created' => (int)$r['created'], 'seen' => $now, 'ip' => $r['ip'], 'pwFails' => (int)$r['pw_fails']];
  }
  static function setPwFails($sid, $n) { DB::q("UPDATE " . DB::t('sessions') . " SET pw_fails=? WHERE sid=?", [$n, $sid]); }
  static function logout($sid) { DB::q("DELETE FROM " . DB::t('sessions') . " WHERE sid=?", [$sid]); }
  // troca de senha encerra as outras sessões do usuário
  static function dropOtherSessions($email, $keep) { DB::q("DELETE FROM " . DB::t('sessions') . " WHERE email=? AND sid<>?", [$email, (string)$keep]); }
}
