<?php
/* Painel MedicGLOBAL — página do painel (mesma interface do painel em Node: cms/admin/index.html).
   Sem administrador cadastrado, leva ao primeiro acesso (setup.php), que faz o papel do "node cms/setup.js". */
require __DIR__ . '/lib/boot.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/auth.php';

if (!Cfg::ok()) { http_response_code(503); header('Content-Type: text/plain; charset=utf-8'); echo "Painel não configurado: copie admin/config.sample.php para admin/config.php e preencha os dados do MySQL."; exit; }
try { $none = !Auth::all(); }
catch (Throwable $e) { http_response_code(503); header('Content-Type: text/plain; charset=utf-8'); echo "Não foi possível conectar ao banco de dados MySQL. Confira os dados em admin/config.php."; exit; }
if ($none) { header('Location: /admin/setup.php', true, 302); exit; }

header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Content-Type: text/html; charset=utf-8');
$v = fn($f) => substr(md5_file(__DIR__ . "/$f"), 0, 8);
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Painel MedicGLOBAL</title>
<link rel="icon" href="/admin/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Poppins:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/admin/app.css?v=<?= $v('app.css') ?>">
</head>
<body>
<div id="app" aria-live="polite"><div class="boot">Carregando…</div></div>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
<script src="/admin/app.js?v=<?= $v('app.js') ?>"></script>
</body>
</html>
