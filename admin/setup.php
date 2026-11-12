<?php
/* Primeiro acesso: cria o administrador principal (equivale ao "node cms/setup.js email").
   Gera uma senha provisória forte, mostrada UMA vez; a troca é obrigatória no primeiro login.
   Só funciona enquanto não houver nenhum usuário cadastrado. */
require __DIR__ . '/lib/boot.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/forms.php';
final class ApiError extends Exception { public $status; function __construct($s, $m) { parent::__construct($m); $this->status = $s; } }

if (!Cfg::ok()) { http_response_code(503); header('Content-Type: text/plain; charset=utf-8'); echo "Painel não configurado: copie admin/config.sample.php para admin/config.php e preencha os dados do MySQL."; exit; }
if (Auth::all()) { header('Location: /admin/', true, 302); exit; }

header("Content-Security-Policy: default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
header('Content-Type: text/html; charset=utf-8');

// token anti-CSRF (cookie + campo do formulário)
$token = $_COOKIE['mg_setup'] ?? '';
if (!preg_match('/^[a-f0-9]{32}$/', $token)) { $token = bin2hex(random_bytes(16)); setcookie('mg_setup', $token, ['path' => '/admin/', 'httponly' => true, 'samesite' => 'Strict']); }
$error = ''; $done = null; $email = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $email = mb_strtolower(trim((string)($_POST['email'] ?? '')));
  if (!hash_equals($token, (string)($_POST['t'] ?? ''))) $error = 'Sessão inválida. Recarregue a página e tente de novo.';
  // prova de acesso ao servidor: a senha do banco de dados que está no config.php (impede que outra pessoa
  // crie o administrador entre a publicação dos arquivos e o primeiro acesso de vocês)
  elseif (!hash_equals((string)(Cfg::get('db')['pass'] ?? ''), (string)($_POST['dbpass'] ?? '')) || (string)(Cfg::get('db')['pass'] ?? '') === '') { $error = 'Senha do banco de dados incorreta.'; usleep(800000); }
  elseif (!preg_match(Forms::EMAIL, $email)) $error = 'E-mail inválido.';
  else {
    // 16 caracteres sem símbolos ambíguos, com maiúscula, minúscula, número e símbolo
    $sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '#%+=@!?'];
    $all = implode('', $sets);
    $chars = array_map(fn($s) => $s[random_int(0, strlen($s) - 1)], $sets);
    while (count($chars) < 16) $chars[] = $all[random_int(0, strlen($all) - 1)];
    for ($i = count($chars) - 1; $i > 0; $i--) { $j = random_int(0, $i); [$chars[$i], $chars[$j]] = [$chars[$j], $chars[$i]]; }
    $pw = implode('', $chars);
    Auth::upsert($email, $pw, ['mustChange' => true]);
    audit('setup', 'admin_definido', $email);
    $done = ['email' => $email, 'pw' => $pw];
  }
}
$css = substr(md5_file(__DIR__ . '/app.css'), 0, 8);
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Primeiro acesso · Painel MedicGLOBAL</title>
<link rel="icon" href="/admin/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Poppins:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/admin/app.css?v=<?= $css ?>">
</head>
<body>
<div id="app"><div class="login"><div>
  <main class="login-card">
    <img src="/admin/logo.png" alt="MedicGLOBAL Saúde">
    <h1>Primeiro acesso</h1>
<?php if ($done): ?>
    <p class="lead">Administrador principal criado. Anote a senha provisória agora: ela não fica gravada em lugar nenhum e será pedida a troca no primeiro acesso.</p>
    <div class="alert alert--info" role="status"><strong>Usuário:</strong> <?= h($done['email']) ?><br><strong>Senha provisória:</strong> <code><?= h($done['pw']) ?></code></div>
    <a class="btn btn--block" href="/admin/">Ir para o login</a>
<?php else: ?>
    <p class="lead">Nenhum administrador cadastrado ainda. Informe o e-mail do administrador principal; uma senha provisória forte será gerada.</p>
    <?php if ($error): ?><div class="alert alert--err" role="alert"><?= h($error) ?></div><?php endif; ?>
    <form method="post" action="/admin/setup.php" novalidate>
      <input type="hidden" name="t" value="<?= h($token) ?>">
      <div class="field"><label for="email"><span>E-mail<span class="req" title="Campo obrigatório"> *</span></span></label><input id="email" name="email" type="email" autocomplete="username" required value="<?= h($email) ?>" placeholder="seu.email@medicglobal.com.br"></div>
      <div class="field"><label for="dbpass"><span>Senha do banco de dados<span class="req" title="Campo obrigatório"> *</span></span></label><input id="dbpass" name="dbpass" type="password" autocomplete="off" required><span class="hint">A mesma que está em admin/config.php (confirma que é você quem administra o servidor).</span></div>
      <button class="btn btn--block" type="submit">Criar administrador</button>
    </form>
<?php endif; ?>
  </main>
  <p class="login-foot">Esta página só funciona enquanto não houver nenhum usuário cadastrado.</p>
</div></div></div>
</body>
</html>
