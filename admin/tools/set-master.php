<?php
/* Cria ou atualiza o usuário master (conta única, acesso a todas as áreas, fora do limite de usuários).
   Uso (na raiz do projeto): php admin/tools/set-master.php email@dominio senha
   Se já existir um master com outro e-mail, o e-mail dele é trocado pelo informado. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/lib/boot.php';
require dirname(__DIR__) . '/lib/store.php';
require dirname(__DIR__) . '/lib/auth.php';
final class ApiError extends Exception { public $status; function __construct($s, $m) { parent::__construct($m); $this->status = $s; } }

[, $email, $pw] = array_pad($argv, 3, '');
$email = mb_strtolower(trim($email));
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $pw === '') { fwrite(STDERR, "Uso: php admin/tools/set-master.php email senha\n"); exit(1); }
if (!Cfg::ok()) { fwrite(STDERR, "Painel não configurado (admin/config.php).\n"); exit(1); }

$list = Auth::all();
foreach ($list as $u) if ($u['email'] === $email && !Auth::isMaster($u)) { fwrite(STDERR, "Já existe um usuário comum com este e-mail.\n"); exit(1); }
$old = Auth::master();
if ($old && $old['email'] !== $email) {
  foreach ($list as $k => $u) if (Auth::isMaster($u)) $list[$k]['email'] = $email;
  Auth::save($list);
  DB::q("DELETE FROM " . DB::t('sessions') . " WHERE email=?", [$old['email']]);
}
Auth::upsert($email, $pw, ['master' => true, 'name' => 'Master', 'mustChange' => false]);
Auth::unlock($email);
audit('sistema', 'usuario_master_definido', $email);
echo "Usuário master pronto: $email\n";
