<?php
/* Painel MedicGLOBAL — API e arquivos protegidos (equivale às rotas de cms/server.js).
   Endereços (funcionam sem URL Rewrite: o caminho vem depois de api.php):
   - /admin/api.php/<rota>           API do painel (sessão + token anti-CSRF) — no Node: /api/admin/<rota>
   - /admin/api.php/forms/<nome>     recebe os formulários do site          — no Node: /api/forms/<nome>
   - /admin/api.php/media/…          imagens enviadas pelo painel            — no Node: /admin/media/…
   - /admin/api.php/site-assets/…    arquivos de assets/ do site             — no Node: /admin/site-assets/…
   - /admin/api.php/preview/…        visualização do rascunho               — no Node: /admin/preview/… */
require __DIR__ . '/lib/boot.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/images.php';
require __DIR__ . '/lib/translate.php';
require __DIR__ . '/lib/forms.php';
require __DIR__ . '/lib/ga.php';
require __DIR__ . '/lib/build.php';
require __DIR__ . '/lib/content.php';

final class ApiError extends Exception { public $status, $extra; function __construct($status, $msg, $extra = []) { parent::__construct($msg); $this->status = $status; $this->extra = $extra; } }

const COOKIE = 'mg_admin';
const ADMIN_CSP = "default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const TYPES = ['html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'json' => 'application/json', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif', 'ico' => 'image/x-icon', 'xml' => 'application/xml', 'txt' => 'text/plain; charset=utf-8', 'woff2' => 'font/woff2', 'pdf' => 'application/pdf'];

/* ---------- utilidades HTTP ---------- */
function base_headers($extra = []) {
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: same-origin');
  foreach ($extra as $k => $v) header("$k: $v");
}
function json_out($status, $body) {
  if (!headers_sent()) { http_response_code($status); base_headers(['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store']); }
  echo je($body);
  exit;
}
function raw_body($limit) {
  $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
  $tooBig = fn() => new ApiError(413, 'Arquivo ou conteúdo grande demais (máximo de ' . str_replace('.', ',', number_format($limit / 1048576, 1, '.', '')) . ' MB).');
  if ($len > $limit) throw $tooBig();
  $b = file_get_contents('php://input', false, null, 0, $limit + 1);
  if ($b === false) $b = '';
  if (strlen($b) > $limit) throw $tooBig();
  if ($len > 0 && $b === '') throw new ApiError(413, 'O servidor recusou o envio (limite post_max_size do PHP). Peça para aumentar o limite na hospedagem.');
  return $b;
}
function read_json($limit = 4 * 1024 * 1024) {
  $b = raw_body($limit);
  if (trim($b) === '') return [];
  $j = json_decode($b, true);
  if ($j === null && trim($b) !== 'null') throw new ApiError(400, 'JSON inválido.');
  return is_array($j) ? $j : [];
}
function client_ip() {
  if (Cfg::get('trust_proxy') && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
  return $_SERVER['REMOTE_ADDR'] ?? '';
}
function is_https() { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (Cfg::get('trust_proxy') && ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'); }
function same_origin() {
  $o = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($o === '') return $_SERVER['REQUEST_METHOD'] === 'GET';
  $h = parse_url($o, PHP_URL_HOST); $p = parse_url($o, PHP_URL_PORT);
  return $h !== null && ($h . ($p ? ":$p" : '')) === ($_SERVER['HTTP_HOST'] ?? '');
}
function send_file($file, $cache = 'no-cache') {
  $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
  $type = TYPES[$ext] ?? 'application/octet-stream';
  base_headers(['Content-Type' => $type, 'Cache-Control' => $cache, 'Content-Length' => (string)filesize($file)]);
  if ($type === 'image/svg+xml') header("Content-Security-Policy: script-src 'none'");
  readfile($file);
  exit;
}
function not_found() {
  http_response_code(404);
  $f = MG_PUBLIC . '/404.html';
  base_headers(['Content-Type' => TYPES['html']]);
  if (is_file($f)) readfile($f); else echo 'Não encontrado';
  exit;
}
// caminho seguro dentro de uma pasta (sem "..", sem arquivos ocultos)
function safe_join($base, $rel) {
  $rel = str_replace('\\', '/', rawurldecode($rel));
  foreach (explode('/', $rel) as $p) if (str_starts_with($p, '.')) return null;
  $p = norm_path($base . '/' . $rel);
  return str_starts_with($p, norm_path($base) . '/') || $p === norm_path($base) ? $p : null;
}
function q($k, $def = '') { $v = $_GET[$k] ?? $def; return is_string($v) ? $v : $def; }

/* ---------- rotas ---------- */
$ROUTES = [];
function on($method, $path, $fn, $opts = []) { global $ROUTES; $ROUTES["$method $path"] = [$fn, $opts]; }
function user_info($u) { return ['email' => $u['email'], 'name' => $u['name'] ?? '', 'role' => $u['role'], 'perms' => Auth::permsOf($u), 'lastLogin' => $u['lastLogin'] ?? null]; }

/* login e sessão */
on('POST', '/login', function () {
  if (!same_origin()) json_out(403, ['error' => 'Origem não permitida.']);
  $b = read_json(10000);
  if (empty($b['email']) || empty($b['password'])) json_out(400, ['error' => 'Informe o e-mail e a senha.']);
  $r = Auth::login(js_str($b['email']), js_str($b['password']), client_ip());
  if (isset($r['error'])) json_out($r['status'], ['error' => $r['error']]);
  setcookie(COOKIE, $r['session']['sid'], ['expires' => time() + 12 * 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict', 'secure' => is_https()]);
  json_out(200, ['csrf' => $r['session']['csrf'], 'user' => user_info($r['user']), 'mustChange' => !empty($r['user']['mustChange'])]);
}, ['public' => true]);
on('POST', '/logout', function ($s) {
  Auth::logout($s['sid']);
  setcookie(COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict', 'secure' => is_https()]);
  audit($s['email'], 'logout');
  json_out(200, ['ok' => true]);
}, ['allowMustChange' => true]);
on('GET', '/me', function ($s) {
  $u = Auth::find($s['email']);
  json_out(200, ['csrf' => $s['csrf'], 'user' => user_info($u), 'mustChange' => !empty($u['mustChange']), 'idleMinutes' => Auth::IDLE / 60000]);
}, ['allowMustChange' => true]);

/* usuários (até Auth::MAX_USERS) */
function users_view() {
  return ['max' => Auth::MAX_USERS, 'perms' => Auth::PERMS, 'users' => array_map(fn($u) => array_merge(user_info($u), ['createdAt' => $u['createdAt'] ?? null, 'mustChange' => !empty($u['mustChange']), 'locked' => Auth::isLocked($u['email'])]), Auth::all())];
}
function user_fields($b, &$errors) {
  $name = trim(str_or($b['name'] ?? ''));
  if ($name === '') $errors['name'] = 'Informe o nome.';
  elseif (mb_strlen($name) > 60 || preg_match('/[<>{}]/', $name)) $errors['name'] = 'Nome com até 60 caracteres, sem < > { }.';
  $perms = is_array($b['perms'] ?? null) ? array_values(array_filter($b['perms'], fn($p) => is_string($p) && isset(Auth::PERMS[$p]))) : [];
  if (!$perms) $errors['perms'] = 'Marque pelo menos uma área que o usuário poderá ver.';
  return [$name, $perms];
}
on('GET', '/users', fn() => json_out(200, users_view()), ['perm' => 'users']);
on('POST', '/users', function ($s) {
  $b = read_json(10000); $errors = [];
  [$name, $perms] = user_fields($b, $errors);
  $email = mb_strtolower(trim(str_or($b['email'] ?? '')));
  if (!preg_match(Forms::EMAIL, $email)) $errors['email'] = 'E-mail inválido.';
  elseif (Auth::find($email)) $errors['email'] = 'Já existe um usuário com este e-mail.';
  if (count(Auth::all()) >= Auth::MAX_USERS) json_out(422, ['error' => 'O painel permite no máximo ' . Auth::MAX_USERS . ' usuários. Remova um para cadastrar outro.']);
  $pw = !empty($b['password']) ? js_str($b['password']) : Auth::tempPassword();
  $prob = Auth::passwordProblem($pw, $email);
  if ($prob) $errors['password'] = $prob;
  if ($errors) json_out(422, ['error' => 'Corrija os campos destacados.', 'fields' => $errors]);
  Auth::upsert($email, $pw, ['name' => $name, 'perms' => $perms, 'mustChange' => true, 'by' => $s['email']]);
  audit($s['email'], 'usuario_criado', $email, [['field' => 'Áreas liberadas', 'before' => '', 'after' => implode(', ', array_map(fn($p) => Auth::PERMS[$p], $perms))]]);
  json_out(200, array_merge(users_view(), ['created' => $email, 'password' => !empty($b['password']) ? null : $pw]));
}, ['perm' => 'users']);
on('PUT', '/users', function ($s) {
  $b = read_json(10000);
  $u = Auth::find($b['email'] ?? '');
  if (!$u) json_out(404, ['error' => 'Usuário não encontrado.']);
  if ($u['role'] === 'admin' && $s['user']['role'] !== 'admin') json_out(403, ['error' => 'Só o administrador principal pode alterar a própria conta.']);
  $errors = [];
  [$name, $perms] = user_fields(array_merge(['perms' => $u['role'] === 'admin' ? ['pages'] : ($u['perms'] ?? [])], $b), $errors);
  if ($u['email'] === $s['email'] && $u['role'] !== 'admin' && !in_array('users', $perms, true)) $errors['perms'] = 'Você não pode tirar de si mesmo a permissão de gerenciar usuários.';
  if ($errors) json_out(422, ['error' => 'Corrija os campos destacados.', 'fields' => $errors]);
  $areas = fn($x) => implode(', ', array_map(fn($p) => Auth::PERMS[$p], Auth::permsOf($x)));
  $before = ['name' => $u['name'] ?? '', 'perms' => $areas($u)];
  $nu = Auth::update($u['email'], ['name' => $name, 'perms' => $perms]);
  $after = ['name' => $nu['name'] ?? '', 'perms' => $areas($nu)];
  $ch = [];
  foreach ([['name', 'Nome'], ['perms', 'Áreas liberadas']] as [$k, $l]) if ($before[$k] !== $after[$k]) $ch[] = ['field' => $l, 'before' => $before[$k], 'after' => $after[$k]];
  audit($s['email'], 'usuario_alterado', $u['email'], $ch);
  json_out(200, users_view());
}, ['perm' => 'users']);
// redefine a senha de outro usuário: senha provisória, desbloqueia e encerra as sessões dele
on('POST', '/users/reset', function ($s) {
  $b = read_json(10000);
  $u = Auth::find($b['email'] ?? '');
  if (!$u) json_out(404, ['error' => 'Usuário não encontrado.']);
  if ($u['email'] === $s['email']) json_out(422, ['error' => 'Para a sua própria senha, use “Trocar a minha senha”.']);
  if ($u['role'] === 'admin') json_out(403, ['error' => 'A senha do administrador principal só pode ser trocada por ele mesmo, em “Trocar a minha senha”.']);
  $pw = !empty($b['password']) ? js_str($b['password']) : Auth::tempPassword();
  $prob = Auth::passwordProblem($pw, $u['email']);
  if ($prob) json_out(422, ['error' => $prob, 'fields' => ['password' => $prob]]);
  Auth::upsert($u['email'], $pw, ['mustChange' => true]);
  Auth::unlock($u['email']);
  Auth::dropOtherSessions($u['email'], null);
  audit($s['email'], 'senha_redefinida', $u['email']);
  json_out(200, array_merge(users_view(), ['password' => !empty($b['password']) ? null : $pw]));
}, ['perm' => 'users']);
on('DELETE', '/users', function ($s) {
  $u = Auth::find(q('email'));
  if (!$u) json_out(404, ['error' => 'Usuário não encontrado.']);
  if ($u['email'] === $s['email']) json_out(422, ['error' => 'Você não pode remover o seu próprio usuário.']);
  if ($u['role'] === 'admin') json_out(422, ['error' => 'O administrador principal não pode ser removido.']);
  Auth::remove($u['email']);
  audit($s['email'], 'usuario_removido', $u['email']);
  json_out(200, users_view());
}, ['perm' => 'users']);

/* auditoria */
on('GET', '/audit', function () {
  $qq = mb_strtolower(q('q')); $who = q('user'); $from = q('from'); $to = q('to');
  $access = q('access') === '1';
  $page = max(0, (int) q('page', '0')); $size = 50;
  $list = array_values(array_filter(audit_log(), function ($e) use ($access, $who, $from, $to, $qq) {
    return ($access || !preg_match('/^(login|logout|login_falhou)$/', $e['action'])) && (!$who || $e['user'] === $who)
      && (!$from || substr($e['at'], 0, 10) >= $from) && (!$to || substr($e['at'], 0, 10) <= $to)
      && (!$qq || str_contains(mb_strtolower(je($e)), $qq));
  }));
  $names = []; foreach (Auth::all() as $u) $names[$u['email']] = $u['name'] ?? '';
  json_out(200, ['total' => count($list), 'page' => $page, 'size' => $size, 'items' => array_slice($list, $page * $size, $size),
    'users' => array_map(fn($e, $n) => ['email' => $e, 'name' => $n], array_keys($names), $names), 'names' => (object)$names, 'pageNames' => (object)page_names()]);
}, ['perm' => 'audit']);

on('POST', '/password', function ($s) {
  $b = read_json(10000);
  $u = Auth::find($s['email']);
  if (!Auth::verifyPassword(js_str($b['current'] ?? ''), $u['hash'] ?? '')) {
    // 5 erros da senha atual na mesma sessão: a sessão é encerrada
    $n = $s['pwFails'] + 1; Auth::setPwFails($s['sid'], $n);
    audit($s['email'], 'senha_atual_incorreta');
    if ($n >= 5) { Auth::logout($s['sid']); json_out(401, ['error' => 'Muitas tentativas com a senha atual incorreta. Entre novamente.', 'auth' => false]); }
    json_out(400, ['error' => 'A senha atual está incorreta.', 'fields' => ['current' => 'Senha atual incorreta.']]);
  }
  $next = js_str($b['next'] ?? '');
  $prob = Auth::passwordProblem($next, $u['email']);
  if ($prob) json_out(422, ['error' => $prob, 'fields' => ['next' => $prob]]);
  if ($next === js_str($b['current'] ?? '')) json_out(422, ['error' => 'A nova senha precisa ser diferente da atual.', 'fields' => ['next' => 'Use uma senha diferente da atual.']]);
  if ($next !== js_str($b['confirm'] ?? '')) json_out(422, ['error' => 'A confirmação não confere.', 'fields' => ['confirm' => 'A confirmação não confere.']]);
  Auth::upsert($u['email'], $next, ['mustChange' => false]);
  Auth::dropOtherSessions($u['email'], $s['sid']);
  audit($s['email'], 'senha_alterada');
  json_out(200, ['ok' => true]);
}, ['allowMustChange' => true]);

on('GET', '/status', function ($s) {
  $draft = content_draft(); $live = content_live();
  $any = false; foreach (['pages', 'news', 'identity', 'forms', 'analytics', 'publish'] as $p) if (Auth::can($s['user'], $p)) $any = true;
  if (!$any) json_out(200, ['pending' => [], 'enPending' => [], 'lastPublish' => $live['_at'] ?? null, 'lastPublishBy' => null, 'history' => []]);
  json_out(200, ['pending' => pending_summary($draft, $live), 'enPending' => array_map('strval', array_keys($draft['enPending'] ?? [])), 'lastPublish' => $live['_at'] ?? null, 'lastPublishBy' => $live['_by'] ?? null, 'history' => array_slice(content_history(), 0, 15)]);
});

/* páginas em português (a versão em inglês é gerada automaticamente) */
on('GET', '/pages', function () {
  $draft = content_draft(); $live = content_live();
  $pages = sources($draft)['pages'];
  $changed = fn($k) => je($draft['pages'][$k] ?? null) !== je($live['pages'][$k] ?? null);
  $list = array_map(function ($x) use ($draft, $changed) {
    $p = $x['p']; $e = $draft['pages'][$p['key']] ?? null;
    return ['key' => $p['key'], 'lang' => $p['lang'], 'file' => $p['file'], 'title' => page_title($p), 'partial' => !empty($p['partial']), 'group' => $x['group'], 'area' => $x['area'],
      'edits' => $e ? count($e['edits'] ?? []) + count($e['meta'] ?? []) : 0,
      'pending' => $changed($p['key']) || (en_key_of($p['key']) && $changed(en_key_of($p['key']))), 'enPending' => !empty($draft['enPending'][$p['key']])];
  }, ordered_pages($pages, 'pt'));
  json_out(200, ['pages' => $list, 'groups' => GROUP_ORDER, 'docGroups' => DOC_GROUPS]);
}, ['perm' => 'pages']);
on('GET', '/page', function () {
  $key = q('key');
  if (!preg_match('/^(pt\/|partial\/pt\/)/', $key)) json_out(404, ['error' => 'A versão em inglês é traduzida automaticamente a partir do português.']);
  $v = page_view(content_draft(), content_live(), $key);
  $v ? json_out(200, $v) : json_out(404, ['error' => 'Página não encontrada.']);
}, ['perm' => 'pages']);
/* Salva uma página em português: campos, dados compartilhados, mesmos textos em outros lugares e a tradução. */
on('PUT', '/page', function ($s) {
  $key = q('key');
  if (!preg_match('/^(pt\/|partial\/pt\/)/', $key)) json_out(404, ['error' => 'A versão em inglês é traduzida automaticamente a partir do português.']);
  $body = read_json();
  $draft = content_draft();
  $changes = [];
  $sh = save_shared($draft, $body['shared'] ?? null, $changes);
  if (isset($sh['errors'])) json_out(422, ['error' => 'Alguns campos não foram salvos. Corrija os itens destacados.', 'fields' => $sh['errors']]);
  $r = save_page($draft, $key, $body);
  if (empty($r['ok'])) json_out($r['status'], $r);
  array_push($changes, ...$r['changes']);
  $touched = [$key]; $also = [];
  $pages = sources($draft)['pages'];
  $units = []; foreach (extract_of($pages[$key]['src'])['units'] as $u) $units[$u['id']] = $u;
  foreach (($body['propagate'] ?? []) as $id) {
    if (!isset($body['edits']) || !array_key_exists($id, $body['edits'])) continue;
    $u = $units[$id] ?? null;
    if (!$u) continue;
    foreach (elsewhere($draft, $key, $u) as $t) {
      $rr = save_page($draft, $t['key'], ['edits' => [$t['id'] => $body['edits'][$id]]]);
      if (!empty($rr['ok']) && $rr['changes']) { $touched[] = $t['key']; $also[] = $t['title'] . ($t['section'] ? ' › ' . $t['section'] : ''); }
    }
  }
  $also = array_values(array_unique($also));
  if ($also) $changes[] = ['field' => 'Mesmo texto atualizado também em', 'before' => '', 'after' => implode('; ', $also)];
  $tr = sync_english($draft, array_merge(array_unique($touched), array_map('strval', array_keys($draft['enPending'] ?? []))));
  content_save_draft($draft);
  if ($changes) audit($s['email'], 'rascunho_pagina', $key, $changes);
  json_out(200, array_merge(page_view($draft, content_live(), $key), ['saved' => ['also' => $also, 'warn' => implode(' ', array_filter([$sh['warn'] ?? '', $tr['error'] ?? '']))]]));
}, ['perm' => 'pages']);

// fotos do site (para o seletor de imagens)
on('GET', '/site', function () {
  $site = sources(content_draft())['site'];
  json_out(200, ['photos' => array_values(array_map(fn($k) => ['key' => (string)$k, 'url' => image_url($site, (string)$k)], array_filter(array_keys(base_site()['photos']), fn($k) => !str_starts_with((string)$k, '_'))))]);
}, ['perm' => ['pages', 'news', 'identity']]);

on('GET', '/noticias', function () {
  $draft = content_draft();
  $list = $draft['noticias'] ?? json_decode(file_get_contents(MG_ROOT . '/src/data/noticias.json'), true);
  $site = sources($draft)['site'];
  json_out(200, ['noticias' => array_map(fn($n) => array_merge($n, ['_preview' => !empty($n['foto']) ? image_url($site, $n['foto']) : '']), $list)]);
}, ['perm' => 'news']);
on('PUT', '/noticias', function ($s) {
  $b = read_json();
  $draft = content_draft();
  $site = sources($draft)['site'];
  $prev = $draft['noticias'] ?? json_decode(file_get_contents(MG_ROOT . '/src/data/noticias.json'), true);
  $list = array_map(function ($n) {
    unset($n['_preview'], $n['en'], $n['alt'], $n['orgao']);
    $n['leitura'] = is_numeric($n['leitura'] ?? null) ? +$n['leitura'] : ($n['leitura'] ?? null);
    if (empty($n['foto'])) unset($n['foto']);
    if (empty($n['fonteUrl'])) unset($n['fonteUrl'], $n['fonteTitulo']);
    return $n;
  }, is_array($b['noticias'] ?? null) ? $b['noticias'] : []);
  $errs = validate_news($list, $site);
  if ($errs) json_out(422, ['error' => implode(' ', array_slice($errs, 0, 8)), 'list' => $errs]);
  $tr = news_english($list, $prev);
  if (isset($tr['error'])) json_out(502, ['error' => $tr['error']]);
  $draft['noticias'] = $list;
  content_save_draft($draft);
  news_audit($s['email'], $prev, $list);
  json_out(200, ['ok' => true]);
}, ['perm' => 'news']);

/* documentos anuais (RN 565 e IDSS) */
on('GET', '/docs', function () {
  $type = q('type');
  if (!isset(DOCS[$type])) json_out(404, ['error' => 'Documento não encontrado.']);
  $list = docs_data(content_draft(), $type)[DOCS[$type]['list']];
  usort($list, fn($a, $b) => $b['ano'] - $a['ano']);
  json_out(200, ['type' => $type, 'title' => DOC_GROUPS[$type], 'items' => array_map(fn($x) => doc_summary($type, $x), $list)]);
}, ['perm' => 'pages']);
on('PUT', '/docs', function ($s) {
  $type = q('type');
  if (!isset(DOCS[$type])) json_out(404, ['error' => 'Documento não encontrado.']);
  $b = read_json(2 * 1024 * 1024);
  $draft = content_draft();
  $data = docs_data($draft, $type); $key = DOCS[$type]['list'];
  $list = $data[$key]; $orig = (int) +($b['original'] ?? 0) ?: null; $ano = is_numeric($b['ano'] ?? null) ? +$b['ano'] : NAN;
  $idx = -1; if ($orig) foreach ($list as $i => $x) if ($x['ano'] === $orig) { $idx = $i; break; }
  if ($orig && $idx < 0) json_out(404, ['error' => 'Ano não encontrado.']);
  $label = ($type === 'rn565' ? 'Reajuste RN 565 ' : 'IDSS ') . ($orig ?: js_str($b['ano'] ?? ''));
  if (!empty($b['remove'])) {
    if (count($list) <= 1) json_out(422, ['error' => 'É preciso manter pelo menos um ano.']);
    array_splice($list, $idx, 1);
    $data[$key] = $list; $draft[$type] = $data;
    content_save_draft($draft);
    audit($s['email'], 'documento_ano_removido', $label, [['field' => 'Ano', 'before' => (string)$orig, 'after' => '']]);
    json_out(200, ['ok' => true]);
  }
  $errors = [];
  if (!(is_numeric($ano) && floor($ano) == $ano && $ano >= 2000 && $ano <= 2100)) $errors['ano'] = 'Ano inválido.';
  else foreach ($list as $i => $x) if ($x['ano'] === (int)$ano && $i !== $idx) $errors['ano'] = 'Este ano já está cadastrado.';
  $sorted = $list; usort($sorted, fn($x, $y) => $y['ano'] - $x['ano']); $latest = $sorted[0];
  $prevItem = $idx >= 0 ? $list[$idx] : null;
  $item = $type === 'rn565' ? rn_year($b, $prevItem, $errors) : idss_year($b, $prevItem, $latest, $errors);
  if ($errors) json_out(422, ['error' => 'Corrija os campos destacados.', 'fields' => $errors]);
  if (!empty($item['conteudo']) && empty($item['conteudoEn'])) {
    try { $item['conteudoEn'] = translate_rich($item['conteudo']); }
    catch (Throwable $e) { json_out(502, ['error' => 'O ano não foi salvo porque a tradução automática do conteúdo para o inglês falhou (' . $e->getMessage() . '). Tente de novo em instantes.']); }
  }
  $before = $idx >= 0 ? doc_summary($type, $list[$idx]) : null; $after = doc_summary($type, $item);
  $show = function ($k, $v) {
    if ($k === 'contratos') return count($v ?: []) . ' contratos';
    if ($k === 'imagens') return count($v ?: []) . ' imagem(ns)';
    if ($k === 'resultado') return "nota {$v['nota']} · dimensões " . implode(' / ', $v['dim']);
    if ($k === 'conteudo') { $n = preg_match_all('/<img /', js_str($v ?? '')); return mb_substr(CmsHtml::plain(js_str($v ?? '')), 0, 400) . ($n ? " [$n imagem(ns)]" : ''); }
    return str_or($v);
  };
  $NAMES = ['ano' => 'Ano', 'anoBase' => 'Ano-base', 'percentual' => 'Percentual', 'inicio' => 'Início', 'fim' => 'Fim', 'contratos' => 'Relação de contratos', 'pdfFile' => 'PDF do agrupamento', 'resultado' => 'Resultado', 'imagens' => 'Imagens do resultado', 'conteudo' => 'Conteúdo da página'];
  $changes = [];
  foreach ($NAMES as $k => $l) if (array_key_exists($k, $after) && je($before ? $before[$k] : null) !== je($after[$k]) && ($before || $after[$k] !== '')) $changes[] = ['field' => $l, 'before' => $before ? $show($k, $before[$k]) : '', 'after' => $show($k, $after[$k])];
  if ($idx >= 0) $list[$idx] = $item; else $list[] = $item;
  usort($list, fn($x, $y) => $y['ano'] - $x['ano']);
  $data[$key] = $list; $draft[$type] = $data;
  try { sources($draft); } catch (Throwable $e) { json_out(422, ['error' => 'Não foi possível gerar as páginas com estes dados: ' . $e->getMessage()]); }
  content_save_draft($draft);
  audit($s['email'], $idx >= 0 ? 'documento_ano_alterado' : 'documento_ano_cadastrado', $label, $changes);
  json_out(200, ['ok' => true, 'key' => 'pt/' . ($type === 'rn565' ? 'rn565-agrupamento-' : 'idss-') . (int)$ano . '.html']);
}, ['perm' => 'pages']);

/* mídia */
const PDF_MAX = 15 * 1024 * 1024;
on('POST', '/upload', function ($s) {
  $purpose = q('purpose', 'photo') ?: 'photo';
  if (!isset(Images::RULES[$purpose]) && $purpose !== 'pdf') json_out(400, ['error' => 'Uso do arquivo inválido.']);
  $buf = raw_body($purpose === 'pdf' ? PDF_MAX + 1 : Images::RULES[$purpose]['maxBytes'] + 1);
  if ($purpose === 'pdf') $v = strlen($buf) > PDF_MAX ? ['error' => 'PDF grande demais (máximo de 15 MB).'] : (substr($buf, 0, 5) !== '%PDF-' ? ['error' => 'O arquivo não é um PDF válido.'] : ['info' => ['type' => 'pdf', 'mime' => 'application/pdf', 'w' => 0, 'h' => 0]]);
  else $v = Images::validate($buf, $purpose);
  if (isset($v['error'])) json_out(422, ['error' => $v['error']]);
  if ($v['info']['type'] === 'svg' && $s['user']['role'] !== 'admin') json_out(403, ['error' => 'Por segurança, só o administrador principal pode enviar SVG. Envie o logotipo em PNG ou WebP.']);
  $name = substr(hash('sha256', $buf), 0, 20) . '.' . $v['info']['type'];
  $dir = mg_dirs()['uploads'];
  file_put_contents("$dir/$name", $buf); @chmod("$dir/$name", 0644);
  $original = mb_substr(preg_replace('/[^\w.\- ]/', '_', q('name')), 0, 100);
  file_put_contents("$dir/$name.json", je(['purpose' => $purpose, 'w' => $v['info']['w'], 'h' => $v['info']['h'], 'type' => $v['info']['mime'], 'size' => strlen($buf), 'original' => $original, 'at' => iso_now(), 'by' => $s['email']]));
  audit($s['email'], 'upload', $name);
  json_out(200, ['name' => $name, 'ref' => "up:$name", 'path' => "assets/uploads/$name", 'url' => MG_API . "/media/$name", 'w' => $v['info']['w'], 'h' => $v['info']['h'], 'type' => $v['info']['mime'], 'size' => strlen($buf)]);
}, ['perm' => ['pages', 'news', 'identity']]);
on('GET', '/media', function () {
  $dir = mg_dirs()['uploads']; $files = [];
  foreach (array_diff(scandir($dir), ['.', '..']) as $f) if (!str_ends_with($f, '.json') && is_file("$dir/$f")) $files[] = array_merge(['name' => $f, 'ref' => "up:$f", 'path' => "assets/uploads/$f", 'url' => MG_API . "/media/$f"], upload_meta($f) ?: []);
  usort($files, fn($a, $b) => strcmp(js_str($b['at'] ?? 'undefined'), js_str($a['at'] ?? 'undefined')));
  json_out(200, ['files' => $files, 'rules' => Images::RULES]);
}, ['perm' => ['pages', 'news', 'identity']]);

/* identidade visual */
on('GET', '/identity', function () {
  $d = content_draft()['identity'] ?? [];
  $sa = MG_API . '/site-assets/img/brand/';
  json_out(200, ['identity' => (object)$d, 'defaults' => ['logo' => $sa . 'logo-medicglobal-saude.png', 'logoNeg' => $sa . 'logo-medicglobal-saude-branco.png', 'favicon' => $sa . 'favicon.svg', 'faviconPng' => $sa . 'favicon.png']]);
}, ['perm' => 'identity']);
on('PUT', '/identity', function ($s) {
  $b = read_json();
  $draft = content_draft(); $out = []; $errors = [];
  foreach (['logo' => 'logo', 'logoNeg' => 'logo', 'favicon' => 'favicon', 'faviconPng' => 'favicon'] as $k => $purpose) {
    $name = $b[$k] ?? null;
    if (!$name) continue;
    $m = upload_exists($name) ? upload_meta($name) : null;
    if (!$m || ($m['purpose'] ?? '') !== $purpose) { $errors[$k] = 'Envie a imagem por este campo (formato e tamanho validados para ' . ($purpose === 'logo' ? 'logotipo' : 'favicon') . ').'; continue; }
    if ($k === 'faviconPng' && $m['type'] !== 'image/png') { $errors[$k] = 'O ícone para celulares precisa ser PNG.'; continue; }
    $out[$k] = ['path' => "assets/uploads/$name", 'w' => $m['w'], 'h' => $m['h'], 'type' => $m['type'], 'name' => $name];
  }
  if ($errors) json_out(422, ['error' => 'Corrija os campos destacados.', 'fields' => $errors]);
  $draft['identity'] = $out;
  content_save_draft($draft);
  audit($s['email'], 'rascunho_identidade');
  json_out(200, ['ok' => true, 'identity' => (object)$out]);
}, ['perm' => 'identity']);

/* Google Analytics */
function ga_view() {
  $draft = content_draft(); $g = Forms::settings()['ga'] ?? [];
  $saEmail = '';
  if (!empty($g['serviceAccount'])) { try { $saEmail = json_decode(open_secret($g['serviceAccount']), true)['client_email'] ?? ''; } catch (Throwable $e) {} }
  $api = ''; if (!empty($g['apiSecret'])) { try { $api = mask(open_secret($g['apiSecret'])); } catch (Throwable $e) {} }
  return array_merge(['enabled' => false, 'measurementId' => '', 'gtmId' => '', 'propertyId' => ''], $draft['analytics'] ?: [], ['serviceAccountEmail' => $saEmail, 'apiSecret' => $api, 'lastCheck' => $g['lastCheck'] ?? null]);
}
on('GET', '/analytics', fn() => json_out(200, ga_view()), ['perm' => 'analytics']);
on('PUT', '/analytics', function ($s) {
  $b = read_json(64 * 1024); $errors = [];
  $mid = strtoupper(trim(str_or($b['measurementId'] ?? ''))); $gtm = strtoupper(trim(str_or($b['gtmId'] ?? ''))); $pid = trim(str_or($b['propertyId'] ?? ''));
  if ($mid && !preg_match(GA::RE['measurementId'], $mid)) $errors['measurementId'] = 'Formato esperado: G-XXXXXXXXXX.';
  if ($gtm && !preg_match(GA::RE['gtmId'], $gtm)) $errors['gtmId'] = 'Formato esperado: GTM-XXXXXXX.';
  if ($pid && !preg_match(GA::RE['propertyId'], $pid)) $errors['propertyId'] = 'O ID da propriedade tem só números (ex.: 412345678).';
  if (!empty($b['enabled']) && !$mid && !$gtm) $errors['measurementId'] = 'Informe o ID de medição (ou o GTM) para ativar a coleta.';
  $set = Forms::settings(); $set['ga'] = $set['ga'] ?? [];
  if (!empty($b['serviceAccount'])) { $sa = GA::parseServiceAccount($b['serviceAccount']); if (isset($sa['error'])) $errors['serviceAccount'] = $sa['error']; }
  if (!empty($b['apiSecret']) && !preg_match('/^[\w-]{10,64}$/', $b['apiSecret'])) $errors['apiSecret'] = 'API secret inválido.';
  if ($errors) json_out(422, ['error' => 'Corrija os campos destacados.', 'fields' => $errors]);
  if (!empty($b['serviceAccount'])) $set['ga']['serviceAccount'] = seal($b['serviceAccount']);
  if (!empty($b['clearServiceAccount'])) unset($set['ga']['serviceAccount']);
  if (!empty($b['apiSecret'])) $set['ga']['apiSecret'] = seal($b['apiSecret']);
  if (!empty($b['clearApiSecret'])) unset($set['ga']['apiSecret']);
  Forms::saveSettings($set);
  $draft = content_draft();
  $draft['analytics'] = ['enabled' => !empty($b['enabled']), 'measurementId' => $mid, 'gtmId' => $gtm, 'propertyId' => $pid];
  content_save_draft($draft);
  audit($s['email'], 'analytics_config');
  json_out(200, ga_view());
}, ['perm' => 'analytics']);
on('POST', '/analytics/verify', function ($s) {
  $set = Forms::settings(); $g = $set['ga'] ?? [];
  $cfg = content_draft()['analytics'] ?: [];
  $published = @file_get_contents(MG_PUBLIC . '/index.html') ?: '';
  $checks = GA::verify($cfg, ['serviceAccount' => !empty($g['serviceAccount']) ? open_secret($g['serviceAccount']) : '', 'apiSecret' => !empty($g['apiSecret']) ? open_secret($g['apiSecret']) : ''], $published);
  $g['lastCheck'] = ['at' => iso_now(), 'checks' => $checks]; $set['ga'] = $g;
  Forms::saveSettings($set);
  audit($s['email'], 'analytics_verificacao');
  json_out(200, ['checks' => $checks, 'at' => $g['lastCheck']['at']]);
}, ['perm' => 'analytics']);

/* formulários */
function draft_page_src($content, $p) { return CmsHtml::apply($p['src'], $content['pages'][$p['key']]['edits'] ?? [])['html']; }
function form_sources($content) { $o = []; foreach (sources($content)['pages'] as $p) if ($p['lang'] === 'pt' && empty($p['partial'])) $o[] = ['key' => $p['key'], 'src' => draft_page_src($content, $p)]; return $o; }
function forms_view() {
  $draft = content_draft(); $set = Forms::settings(); $live = content_live();
  $defs = Forms::definitions(form_sources($draft));
  $list = [];
  foreach ($defs as $d) {
    $c = $set['forms'][$d['name']] ?? [];
    $view = page_view($draft, $live, $d['page']);
    $wh = ''; if (!empty($c['webhook'])) { try { $wh = mask(open_secret($c['webhook'])); } catch (Throwable $e) {} }
    $list[] = array_merge($d, ['enabled' => ($c['enabled'] ?? null) !== false, 'emails' => $c['emails'] ?? [], 'webhook' => $wh,
      'maxUploadMB' => ($draft['forms'][$d['name']]['maxUploadMB'] ?? null) ?: Forms::DEFAULT_UPLOAD_MB,
      'count' => count(Forms::list($d['name'])), 'pageTitle' => $view['title'],
      'fieldUnits' => array_values(array_filter($view['units'], fn($u) => $u['kind'] === 'field' && $u['form'] === $d['name']))]);
  }
  $sm = $set['smtp'] ?? [];
  $pass = ''; if (!empty($sm['pass'])) { try { $pass = mask(open_secret($sm['pass'])); } catch (Throwable $e) {} }
  return ['forms' => $list, 'smtp' => ['host' => $sm['host'] ?? '', 'port' => ($sm['port'] ?? 0) ?: 587, 'user' => $sm['user'] ?? '', 'from' => $sm['from'] ?? '', 'fromName' => $sm['fromName'] ?? '', 'pass' => $pass]];
}
on('GET', '/forms', fn() => json_out(200, forms_view()), ['perm' => 'forms']);
on('PUT', '/forms', function ($s) {
  $name = q('name');
  $b = read_json(64 * 1024);
  $view = forms_view();
  if (!in_array($name, array_column($view['forms'], 'name'), true)) json_out(404, ['error' => 'Formulário não encontrado.']);
  $errors = [];
  $raw = is_array($b['emails'] ?? null) ? $b['emails'] : preg_split('/[,;\s]+/', str_or($b['emails'] ?? ''));
  $emails = array_values(array_filter(array_map(fn($e) => mb_strtolower(trim(js_str($e))), $raw), fn($e) => $e !== ''));
  if (count($emails) > 10) $errors['emails'] = 'No máximo 10 destinatários.';
  $bad = array_filter($emails, fn($e) => !preg_match(Forms::EMAIL, $e));
  if ($bad) $errors['emails'] = 'E-mail inválido: ' . implode(', ', $bad);
  if (!empty($b['webhook']) && !preg_match('#^https://[^\s<>"]+$#', $b['webhook'])) $errors['webhook'] = 'O webhook precisa ser um endereço https://.';
  $hasMb = array_key_exists('maxUploadMB', $b);
  $mb = $hasMb && is_numeric($b['maxUploadMB']) ? +$b['maxUploadMB'] : NAN;
  if ($hasMb && !(is_numeric($b['maxUploadMB']) && floor($mb) == $mb && $mb >= 1 && $mb <= 10240)) $errors['maxUploadMB'] = 'Entre 1 e 10240 MB (10 GB).';
  if ($errors) json_out(422, ['error' => 'Corrija os campos destacados.', 'fields' => $errors]);
  $set = Forms::settings(); $set['forms'] = $set['forms'] ?? [];
  $c = $set['forms'][$name] ?? [];
  $c['enabled'] = ($b['enabled'] ?? null) !== false; $c['emails'] = $emails;
  if (!empty($b['webhook'])) $c['webhook'] = seal($b['webhook']);
  if (!empty($b['clearWebhook'])) unset($c['webhook']);
  $set['forms'][$name] = $c;
  Forms::saveSettings($set);
  if ($hasMb) { $d = content_draft(); $d['forms'][$name] = ['maxUploadMB' => (int)$mb]; content_save_draft($d); }
  audit($s['email'], 'formulario_config', $name);
  json_out(200, forms_view());
}, ['perm' => 'forms']);
on('PUT', '/smtp', function ($s) {
  $b = read_json(64 * 1024); $errors = [];
  $port = is_numeric($b['port'] ?? null) ? +$b['port'] : 0;
  if (!empty($b['host']) && !preg_match('/^[\w.-]+$/', $b['host'])) $errors['host'] = 'Servidor inválido.';
  if (!($port >= 1 && $port <= 65535)) $errors['port'] = 'Porta inválida.';
  if (!empty($b['from']) && !preg_match(Forms::EMAIL, $b['from'])) $errors['from'] = 'E-mail do remetente inválido.';
  if (!empty($b['host']) && empty($b['from'])) $errors['from'] = 'Informe o remetente.';
  if ($errors) json_out(422, ['error' => 'Corrija os campos destacados.', 'fields' => $errors]);
  $set = Forms::settings(); $prev = $set['smtp'] ?? [];
  $set['smtp'] = ['host' => $b['host'] ?? '', 'port' => (int)$port, 'user' => $b['user'] ?? '', 'from' => $b['from'] ?? '', 'fromName' => mb_substr(str_or($b['fromName'] ?? ''), 0, 60), 'pass' => !empty($b['pass']) ? seal($b['pass']) : ($prev['pass'] ?? '')];
  if (!empty($b['clearPass'])) $set['smtp']['pass'] = '';
  Forms::saveSettings($set);
  audit($s['email'], 'smtp_config');
  json_out(200, forms_view());
}, ['perm' => 'forms']);
on('POST', '/smtp/test', function ($s) {
  $b = read_json(10000);
  $sm = Forms::settings()['smtp'] ?? null;
  if (!$sm || empty($sm['host'])) json_out(400, ['error' => 'Configure o servidor SMTP primeiro.']);
  if (!preg_match(Forms::EMAIL, str_or($b['to'] ?? ''))) json_out(422, ['error' => 'Informe um e-mail válido para o teste.']);
  try {
    mail_send(array_merge($sm, ['pass' => open_secret($sm['pass'] ?? '')]), ['to' => [$b['to']], 'subject' => 'Teste do painel MedicGLOBAL', 'text' => 'Se você recebeu esta mensagem, o envio de e-mails dos formulários está funcionando.']);
    json_out(200, ['ok' => true]);
  } catch (Throwable $e) { json_out(502, ['error' => 'Falha no envio: ' . $e->getMessage()]); }
}, ['perm' => 'forms']);
on('POST', '/webhook/test', function ($s) {
  $c = Forms::settings()['forms'][q('name')] ?? [];
  if (empty($c['webhook'])) json_out(400, ['error' => 'Nenhum webhook configurado para este formulário.']);
  try { Forms::postJson(open_secret($c['webhook']), ['teste' => true, 'origem' => 'painel MedicGLOBAL', 'em' => iso_now()]); json_out(200, ['ok' => true]); }
  catch (Throwable $e) { json_out(502, ['error' => 'Falha no webhook: ' . $e->getMessage()]); }
}, ['perm' => 'forms']);

/* rascunho → visualização → publicação */
on('POST', '/preview', function () {
  $b = read_json(10000);
  try {
    $r = preview_site(content_draft());
    $key = js_str($b['key'] ?? 'pt/index.html') ?: 'pt/index.html';
    [$lang, $file] = str_starts_with($key, 'partial/') ? ['pt', 'index.html'] : array_pad(explode('/', $key), 2, '');
    json_out(200, ['url' => MG_API . '/preview/' . ($lang === 'en' ? 'en/' : '') . $file, 'orphans' => (object)$r['orphans']]);
  } catch (ApiError $e) { throw $e; }
  catch (Throwable $e) { log_error($e); json_out(500, ['error' => 'Não foi possível gerar a visualização. Tente novamente; se continuar, avise o suporte.']); }
}, ['perm' => ['pages', 'news', 'identity', 'publish']]);
on('POST', '/publish', function ($s) {
  $b = read_json(10000);
  $draft = content_draft();
  if (!empty($draft['enPending'])) {
    $tr = sync_english($draft, array_map('strval', array_keys($draft['enPending'])));
    content_save_draft($draft);
    if (isset($tr['error']) && empty($b['force'])) json_out(409, ['error' => $tr['error'], 'enPending' => true]);
  }
  try { preview_site($draft); } catch (Throwable $e) { json_out(422, ['error' => 'O rascunho tem um problema e não foi publicado: ' . $e->getMessage()]); }
  $names = page_names();
  $AREAS = ['site' => 'Dados compartilhados', 'noticias' => 'Notícias', 'rn565' => 'Reajuste RN 565', 'idss' => 'IDSS', 'identity' => 'Identidade visual', 'analytics' => 'Google Analytics', 'forms' => 'Formulários'];
  $what = array_map(fn($p) => $p['area'] === 'page' ? ($names[$p['key']] ?? $p['key']) : ($AREAS[$p['area']] ?? $p['area']), pending_summary($draft, content_live()));
  $live = content_publish($draft, $s['email']);
  $r = publish_site($live);
  audit($s['email'], 'publicado', $r['ms'] . ' ms', $what ? [['field' => 'Itens publicados', 'before' => '', 'after' => implode('; ', $what)]] : null);
  json_out(200, ['ok' => true, 'at' => $live['_at'], 'ms' => $r['ms'], 'orphans' => $r['orphans']]);
}, ['perm' => 'publish']);
on('POST', '/discard', function ($s) {
  content_save_draft(content_live());
  audit($s['email'], 'rascunho_descartado');
  json_out(200, ['ok' => true]);
}, ['perm' => 'publish']);
on('POST', '/rollback', function ($s) {
  $b = read_json(10000);
  $v = content_version(js_str($b['id'] ?? ''));
  if (!$v) json_out(404, ['error' => 'Versão não encontrada.']);
  unset($v['_at'], $v['_by']);
  content_save_draft($v);
  audit($s['email'], 'versao_restaurada_no_rascunho', js_str($b['id'] ?? ''));
  json_out(200, ['ok' => true]);
}, ['perm' => 'publish']);

/* envios recebidos pelos formulários (dados pessoais: permissão própria, guarda de 6 meses) */
function live_defs() { return Forms::definitions(form_sources(content_live())); }
on('GET', '/submissions', function () {
  $defs = live_defs();
  $names = array_values(array_unique(array_merge(array_keys($defs), Forms::formNames())));
  $list = array_map(fn($n) => ['name' => $n, 'title' => $defs[$n]['title'] ?? (Forms::NAMES[$n] ?? $n), 'count' => count(Forms::list($n))], $names);
  $name = q('form');
  if ($name === '') { foreach ($list as $x) if ($x['count']) { $name = $x['name']; break; } if ($name === '' && $list) $name = $list[0]['name']; }
  $labels = []; foreach (($defs[$name]['fields'] ?? []) as $f) $labels[$f['name']] = $f['label'];
  $items = $name !== '' ? array_map(fn($r) => ['id' => $r['id'], 'at' => $r['at'], 'page' => $r['page'], 'data' => (object)$r['data'], 'files' => array_map(fn($f) => ['filename' => $f['filename'], 'stored' => $f['stored'], 'size' => $f['size']], $r['files'] ?? [])], array_slice(Forms::list($name), 0, 500)) : [];
  json_out(200, ['forms' => $list, 'form' => $name, 'labels' => (object)$labels, 'items' => $items, 'retentionMonths' => Forms::RETENTION_MONTHS]);
}, ['perm' => 'submissions']);
on('GET', '/submissions/file', function ($s) {
  $f = Forms::attachmentPath(q('form'), q('id'), q('file'));
  if (!$f) json_out(404, ['error' => 'Arquivo não encontrado (pode ter sido excluído).']);
  audit($s['email'], 'anexo_baixado', $f['filename']);
  base_headers(['Content-Type' => 'application/pdf', 'Content-Disposition' => 'attachment; filename="' . preg_replace('/[^\w.\- ]/', '_', $f['filename']) . '"', 'Cache-Control' => 'no-store', 'Content-Length' => (string)filesize($f['path'])]);
  readfile($f['path']);
  exit;
}, ['perm' => 'submissions']);
on('DELETE', '/submissions', function ($s) {
  $name = q('form'); $r = Forms::removeSubmission($name, q('id'));
  if (!$r) json_out(404, ['error' => 'Envio não encontrado.']);
  audit($s['email'], 'envio_excluido', (Forms::NAMES[$name] ?? $name) . ' · protocolo ' . $r['id']);
  json_out(200, ['ok' => true]);
}, ['perm' => 'submissions']);

/* ---------- formulário público ---------- */
function public_form($name) {
  if (!same_origin()) json_out(403, ['ok' => false, 'error' => 'Origem não permitida.']);
  $defs = live_defs(); $def = $defs[$name] ?? null;
  if (!$def) json_out(404, ['ok' => false, 'error' => 'Formulário não encontrado.']);
  $live = content_live();
  $maxMB = ($live['forms'][$name]['maxUploadMB'] ?? null) ?: Forms::DEFAULT_UPLOAD_MB;
  $ct = $_SERVER['CONTENT_TYPE'] ?? '';
  $fields = []; $files = [];
  $label = $maxMB >= 1024 && $maxMB % 1024 === 0 ? ($maxMB / 1024) . ' GB' : $maxMB . ' MB';
  if (preg_match('/multipart\/form-data/', $ct)) {
    $declared = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($declared > ($maxMB + 1) * 1048576) json_out(413, ['ok' => false, 'error' => "O arquivo passa do limite de $label."]);
    if (Forms::overLimit(client_ip())) json_out(429, ['ok' => false, 'error' => 'Muitos envios em sequência. Aguarde alguns minutos.']);
    if ($declared > 0 && !$_POST && !$_FILES) json_out(413, ['ok' => false, 'error' => 'O arquivo passa do limite de envio do servidor. Envie um arquivo menor.']);
    $fields = array_map(fn($v) => is_string($v) ? $v : '', $_POST);
    foreach ($_FILES as $field => $f) {
      if (is_array($f['name']) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE || $f['name'] === '') continue;
      if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) json_out(413, ['ok' => false, 'error' => 'O arquivo passa do limite de envio do servidor. Envie um arquivo menor.']);
      if ($f['error'] !== UPLOAD_ERR_OK) json_out(400, ['ok' => false, 'error' => 'Envio interrompido.']);
      $fh = fopen($f['tmp_name'], 'rb'); $head = fread($fh, 8); fclose($fh);
      $files[] = ['field' => $field, 'filename' => $f['name'], 'type' => $f['type'], 'path' => $f['tmp_name'], 'size' => $f['size'], 'head' => $head];
    }
  } else {
    $buf = raw_body(1024 * 1024);
    if (preg_match('/application\/x-www-form-urlencoded/', $ct)) parse_str($buf, $fields);
    elseif (preg_match('/application\/json/', $ct)) { $fields = json_decode($buf, true); if (!is_array($fields)) json_out(400, ['ok' => false, 'error' => 'Envio inválido.']); }
  }
  [$status, $body] = Forms::submit($def, $fields, $files, client_ip(), $maxMB);
  json_out($status, $body);
}

function log_error($e) { @file_put_contents(mg_dirs()['data'] . '/error.log', '[' . iso_now() . '] ' . $e . "\n", FILE_APPEND); }
// guarda limitada dos envios dos formulários (LGPD): limpeza a cada 12 h
function maybe_purge() {
  $last = kv_read('purge_at', 0);
  if (now_ms() - (int)$last < 12 * 3600 * 1000) return;
  kv_write('purge_at', now_ms());
  $n = Forms::purge();
  if ($n) audit('sistema', 'envios_expirados', (string)$n);
}

/* ---------- despacho ---------- */
function path_info() {
  if (isset($_SERVER['PATH_INFO']) && $_SERVER['PATH_INFO'] !== '') return $_SERVER['PATH_INFO'];
  $uri = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '');
  $i = strpos($uri, '/api.php');
  return $i === false ? '/' : (substr($uri, $i + 8) ?: '/');
}
function session_from_cookie() { return Auth::session($_COOKIE[COOKIE] ?? null); }

try {
  if (!Cfg::ok()) json_out(503, ['error' => 'Painel não configurado: crie o admin/config.php a partir do config.sample.php.']);
  mg_dirs();
  $p = path_info();
  $method = $_SERVER['REQUEST_METHOD'];
  try { maybe_purge(); } catch (Throwable $e) { log_error($e); }

  if (preg_match('#^/forms/([\w-]+)$#', $p, $fm) && $method === 'POST') public_form($fm[1]);

  // arquivos protegidos do painel: exigem sessão
  if (preg_match('#^/(media|site-assets|preview)(/.*)$#', $p, $pm)) {
    if (!session_from_cookie()) { base_headers(); header('Location: /admin/', true, 302); exit; }
    $rest = ltrim($pm[2] ?? '', '/');
    if ($pm[1] === 'media') { if (upload_exists($rest)) send_file(mg_dirs()['uploads'] . "/$rest"); not_found(); }
    if ($pm[1] === 'site-assets') { $f = safe_join(MG_ROOT . '/assets', $rest); if ($f && is_file($f)) send_file($f); not_found(); }
    $r = $rest === '' ? 'index.html' : $rest;
    if (str_ends_with($r, '/')) $r .= 'index.html';
    if (str_starts_with($r, 'assets/uploads/')) $f = upload_exists(substr($r, 15)) ? mg_dirs()['uploads'] . '/' . substr($r, 15) : null;
    elseif (str_starts_with($r, 'assets/')) $f = safe_join(MG_ROOT . '/assets', substr($r, 7));
    else $f = safe_join(mg_dirs()['preview'], $r);
    if (!$f || !is_file($f)) not_found();
    if (str_ends_with($f, '.html')) {
      // faixa de aviso no topo da visualização
      $page = preg_replace('/<body([^>]*)>/', '<body$1><div style="position:sticky;top:0;z-index:9999;background:#1d2b36;color:#fff;font:600 13px/1.2 system-ui,sans-serif;padding:10px 16px;text-align:center">Pré-visualização do rascunho — ainda não publicado</div>', file_get_contents($f), 1);
      base_headers(['Content-Type' => TYPES['html'], 'Cache-Control' => 'no-store', 'X-Frame-Options' => 'SAMEORIGIN']);
      echo $page; exit;
    }
    send_file($f);
  }

  $route = $ROUTES["$method $p"] ?? null;
  if (!$route) json_out(404, ['error' => 'Rota não encontrada.']);
  [$fn, $opts] = $route;
  $s = null;
  if (empty($opts['public'])) {
    $s = session_from_cookie();
    if (!$s) json_out(401, ['error' => 'Sessão expirada. Entre novamente.', 'auth' => false]);
    if ($method !== 'GET' && (!hash_equals($s['csrf'], (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) || !same_origin())) json_out(403, ['error' => 'Requisição recusada (token de segurança inválido). Recarregue a página.']);
    $u = Auth::find($s['email']);
    if (!empty($u['mustChange']) && empty($opts['allowMustChange'])) json_out(403, ['error' => 'Troque a senha provisória para continuar.', 'mustChange' => true]);
    if (!empty($opts['perm'])) { $ok = false; foreach ((array)$opts['perm'] as $pp) if (Auth::can($u, $pp)) $ok = true; if (!$ok) json_out(403, ['error' => 'Seu usuário não tem permissão para esta área.']); }
    $s['user'] = $u;
  }
  $fn($s);
} catch (ApiError $e) {
  json_out($e->status, array_merge(['error' => $e->getMessage()], $e->extra));
} catch (Throwable $e) {
  log_error($e);
  json_out(500, ['error' => 'Erro interno.']);
}
