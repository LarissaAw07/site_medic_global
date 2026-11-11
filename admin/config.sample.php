<?php
/* MedicGLOBAL — painel /admin (PHP).
   COPIE este arquivo para "config.php" na mesma pasta e preencha os dados do MySQL da hospedagem.
   NUNCA deixe config.php público: o web.config desta pasta já bloqueia o acesso direto a ele. */
return [
  'db' => [
    'host'    => 'localhost',   // normalmente localhost (ou o host do banco que a hospedagem informar)
    'name'    => '',            // nome do banco de dados MySQL
    'user'    => '',            // usuário do banco
    'pass'    => '',            // senha do banco
    'charset' => 'utf8mb4',
    'prefix'  => 'mg_admin_',   // prefixo das tabelas do painel
  ],
  // Raiz pública do site (onde ficam index.html, planos.html, en/ ...). Por padrão, a pasta acima de /admin.
  'site_root' => dirname(__DIR__),
  // Pasta (dentro do site) onde as imagens enviadas pelo painel são guardadas.
  'uploads_dir' => 'assets/img/uploads',
];
