<?php
/* Armazenamento do painel (equivale a cms/store.js): rascunho e publicado, versões anteriores, auditoria e
   segredos cifrados (AES-256-GCM). No Node isso fica em arquivos; aqui, no MySQL. */

/* ---------- segredos ---------- */
function secret_key() {
  static $key = null;
  if ($key !== null) return $key;
  $env = (string) Cfg::get('secret_key', '');
  if ($env !== '') {
    if (!preg_match('/^[0-9a-f]{64}$/i', $env)) throw new RuntimeException('secret_key deve ter 64 caracteres hexadecimais (32 bytes).');
    return $key = hex2bin($env);
  }
  // sem chave no config.php: chave gerada e guardada no banco (nunca em arquivo dentro da pasta pública)
  $hex = kv_read('secret_key', null);
  if (!is_string($hex) || !preg_match('/^[0-9a-f]{64}$/', $hex)) {
    $old = mg_dirs()['data'] . '/secret.key'; // versão anterior guardava em arquivo: migra e apaga
    $hex = is_file($old) && preg_match('/^[0-9a-f]{64}$/', trim(file_get_contents($old))) ? trim(file_get_contents($old)) : bin2hex(random_bytes(32));
    kv_write('secret_key', $hex);
    @unlink($old);
  }
  return $key = hex2bin($hex);
}
function seal($plain) {
  if ($plain === null || $plain === '') return '';
  $iv = random_bytes(12); $tag = '';
  $enc = openssl_encrypt((string)$plain, 'aes-256-gcm', secret_key(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
  return 'enc:' . base64_encode($iv . $tag . $enc);
}
function open_secret($sealed) {
  if (!$sealed) return '';
  $b = base64_decode(preg_replace('/^enc:/', '', (string)$sealed));
  $out = openssl_decrypt(substr($b, 28), 'aes-256-gcm', secret_key(), OPENSSL_RAW_DATA, substr($b, 0, 12), substr($b, 12, 16));
  if ($out === false) throw new RuntimeException('Não foi possível decifrar um segredo (chave alterada?).');
  return $out;
}
// para mostrar no painel sem revelar: "••••a1b2"
function mask($s) { return $s ? '••••' . mb_substr((string)$s, -4) : ''; }

/* ---------- conteúdo: rascunho (draft) e publicado (live) ---------- */
function content_empty() { return ['pages' => [], 'site' => [], 'noticias' => null, 'identity' => [], 'analytics' => [], 'forms' => []]; }
function content_live() { $v = kv_read('live', []); return array_merge(content_empty(), is_array($v) ? $v : []); }
function content_draft() { $v = kv_read('draft', null); if ($v === null) $v = kv_read('live', []); return array_merge(content_empty(), is_array($v) ? $v : []); }
function content_save_draft($c) { kv_write('draft', $c); }
function content_publish($c, $user) {
  $live = kv_read('live', null);
  if ($live) {
    $id = str_replace([':', '.'], '-', iso_now());
    DB::q("INSERT INTO " . DB::t('history') . " (id, at, by_user, content) VALUES (?, ?, ?, ?)", [$id, $live['_at'] ?? iso_now(), $live['_by'] ?? '', je($live)]);
    // guarda as 30 últimas versões publicadas
    $old = DB::q("SELECT id FROM " . DB::t('history') . " ORDER BY id DESC LIMIT 1000 OFFSET 30")->fetchAll();
    foreach ($old as $r) DB::q("DELETE FROM " . DB::t('history') . " WHERE id=?", [$r['id']]);
  }
  $c['_by'] = $user; $c['_at'] = iso_now();
  kv_write('live', $c);
  kv_write('draft', $c);
  return $c;
}
function content_history() {
  return array_map(fn($r) => ['id' => $r['id'], 'at' => $r['at'], 'by' => $r['by_user']], DB::q("SELECT id, at, by_user FROM " . DB::t('history') . " ORDER BY id DESC")->fetchAll());
}
function content_version($id) {
  if (!preg_match('/^[\w-]+$/', $id)) return null;
  $r = DB::q("SELECT content FROM " . DB::t('history') . " WHERE id=?", [$id])->fetch();
  return $r ? jd($r['content']) : null;
}

/* ---------- auditoria: quem fez o quê e quando; changes: [{ field, before, after }] ---------- */
function audit($user, $action, $detail = '', $changes = null) {
  DB::q("INSERT INTO " . DB::t('audit') . " (at, user, action, detail, changes) VALUES (?, ?, ?, ?, ?)",
    [iso_now(), $user ?: '-', $action, (string)($detail ?? ''), $changes ? je(array_values($changes)) : null]);
}
// registro completo, do mais recente para o mais antigo
function audit_log() {
  $out = [];
  foreach (DB::q("SELECT at, user, action, detail, changes FROM " . DB::t('audit') . " ORDER BY id DESC")->fetchAll() as $r) {
    $e = ['at' => $r['at'], 'user' => $r['user'], 'action' => $r['action'], 'detail' => $r['detail'] ?? ''];
    if ($r['changes']) $e['changes'] = jd($r['changes'], []);
    $out[] = $e;
  }
  return $out;
}
