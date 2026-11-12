<?php
/* MedicGLOBAL — painel /admin (PHP + MySQL), versão PHP do painel em Node (cms/).
   COPIE este arquivo para "config.php" na mesma pasta e preencha os dados do MySQL da hospedagem.
   NUNCA deixe config.php público: o web.config desta pasta já bloqueia o acesso direto a ele. */
return [
  'db' => [
    'host'    => 'localhost',   // normalmente localhost (ou o host do banco que a hospedagem informar)
    'port'    => 3306,
    'name'    => '',            // nome do banco de dados MySQL
    'user'    => '',            // usuário do banco
    'pass'    => '',            // senha do banco
    'charset' => 'utf8mb4',
    'prefix'  => 'mg_cms_',     // prefixo das tabelas do painel (criadas automaticamente)
  ],
  // Pasta do projeto (onde ficam src/, assets/ e build.js). Por padrão, a pasta acima de /admin.
  'root' => dirname(__DIR__),
  // Pasta servida ao público, onde o "Publicar" grava o site gerado. Por padrão, a própria raiz do site.
  'public_dir' => dirname(__DIR__),
  // Arquivos do painel: imagens enviadas, visualização do rascunho e anexos dos formulários.
  // De preferência FORA da pasta pública; se ficar dentro, o web.config bloqueia o acesso direto a "data".
  'data_dir' => __DIR__ . '/data',
  // Chave (64 caracteres hexadecimais) que cifra senhas e tokens de integrações (SMTP, webhooks, Google).
  // Vazia: uma chave é criada automaticamente em <data_dir>/secret.key.
  'secret_key' => '',
  // Tradução automática PT → EN: vazio usa o Google Tradutor (sem chave); com chave, usa o DeepL.
  'deepl_key' => '',
  // true só se o site estiver atrás de um proxy que envia X-Forwarded-For / X-Forwarded-Proto.
  'trust_proxy' => false,
];
