<?php
/* Copia a interface do painel em Node (cms/admin) para o painel PHP (admin/), trocando só os endereços da API.
   Uso (na raiz do projeto): php admin/tools/sync-ui.php   — rode sempre que cms/admin/app.js ou app.css mudarem. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$root = dirname(__DIR__, 2);
$js = file_get_contents("$root/cms/admin/app.js");
$js = str_replace(['"/api/admin/', '"/admin/media/', '"/admin/preview/'], ['"/admin/api.php/', '"/admin/api.php/media/', '"/admin/api.php/preview/'], $js);
$head = "/* Gerado a partir de cms/admin/app.js (painel em Node), sem nenhuma outra mudança além dos endereços:\n   /api/admin/ → /admin/api.php/  ·  /admin/media/ → /admin/api.php/media/  ·  /admin/preview/ → /admin/api.php/preview/\n   Para atualizar: php admin/tools/sync-ui.php */\n";
file_put_contents("$root/admin/app.js", $head . $js);
foreach (['app.css', 'logo.png', 'favicon.svg'] as $f) copy("$root/cms/admin/$f", "$root/admin/$f");
echo "Interface do painel atualizada em admin/.\n";
