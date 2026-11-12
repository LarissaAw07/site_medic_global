<?php
/* Roteador do servidor embutido do PHP (só para rodar localmente):
     php -S 127.0.0.1:8000 -t . admin/tools/router-local.php
   O "php -S" ignora web.config e .htaccess; aqui ficam os mesmos bloqueios da hospedagem: configuração,
   bibliotecas, dados e ferramentas do painel, dados do painel em Node e arquivos ocultos. */
if (PHP_SAPI !== 'cli-server') { http_response_code(404); exit; }
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
$blocked = '#^/(admin/(lib|data|tools)(/|$)|admin/config(\.sample)?\.php$|\.cms-data(/|$)|\.git(/|$)|node_modules(/|$))#i';
if (preg_match($blocked, $path) || preg_match('#/\.#', $path)) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Não encontrado';
  return true;
}
return false; // o resto segue o comportamento normal do servidor embutido
