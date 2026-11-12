# Painel administrativo em PHP (`/admin`)

Versão **PHP + MySQL** do painel em Node (`cms/`), para hospedagens sem Node (IIS/Windows ou Apache).
É uma reprodução fiel: **a mesma interface** (o `admin/app.js` e o `admin/app.css` são cópias de `cms/admin/`,
só com os endereços da API trocados), **a mesma API** e **as mesmas regras**. Tudo o que o painel em Node faz,
este faz:

- Páginas do site: textos, títulos, banners, seções, links/CTAs, imagens, campos de formulário e SEO
  (título, descrição, imagem de compartilhamento), componentes compartilhados (cards dos planos, botões das lojas),
  dados compartilhados (endereços, telefones, e-mails, links) e "o mesmo texto em outras páginas".
- Versão em inglês traduzida automaticamente (Google Tradutor; DeepL com `deepl_key`).
- Notícias, documentos anuais (RN 565 e IDSS, com editor de conteúdo, imagens e PDF), identidade visual
  (logotipos e favicon), Google Analytics (com verificação), formulários (destinos por e-mail/SMTP e webhook,
  limite de anexo) e envios recebidos (guarda de 6 meses).
- Rascunho → visualização → publicação, versões anteriores (30) com restauração, descartar rascunho.
- Usuários (até 3, com áreas liberadas), auditoria (antes → depois), bloqueio de tentativas, troca obrigatória
  da senha provisória.

O "Publicar" gera o site a partir de `src/` com o mesmo gerador do `build.js` (portado para PHP em
`admin/lib/build.php` e `admin/lib/generators.php`): a saída é idêntica à do Node, byte a byte.

## O que subir

Além do site publicado (páginas `.html`, `assets/`, `en/`, `robots.txt`, `sitemap.xml`, `_proxy.php`,
`rede-api/`, `guia-api/`), o painel precisa de:

```
admin/          painel (index.php, api.php, setup.php, app.js, app.css, lib/, tools/, web.config, .htaccess)
src/            fontes do site (páginas, partials e dados) — o painel gera o site a partir delas
```

Você **não** sobe `admin/config.php` (é criado no servidor, passo 2) nem `admin/data/` (criada sozinha).

## Passo a passo

1. **Crie um banco MySQL** no painel da hospedagem e anote host, nome, usuário e senha.
   As tabelas (`mg_cms_*`) são criadas **automaticamente** no primeiro acesso.
2. **Configure:** em `admin/`, copie `config.sample.php` para **`config.php`** e preencha o bloco `db`.
   Na hospedagem, deixe `public_dir` como a raiz do site (`dirname(__DIR__)`, o padrão).
   Se possível, aponte `data_dir` para uma pasta **fora** da pasta pública.
3. **Acesse `https://seusite/admin/`.** No primeiro acesso aparece a tela **Primeiro acesso**: informe o e-mail do
   administrador principal e a **senha do banco de dados** (a do `config.php`, que prova que é você quem administra o
   servidor); uma senha provisória forte é mostrada uma única vez e a troca é obrigatória no login
   (o mesmo que o `node cms/setup.js` faz no Node).
4. Edite, visualize e **Publicar**: o site da raiz é regenerado com o conteúdo do painel.

## Requisitos da hospedagem

- **PHP 8.1+** com `pdo_mysql`, `mbstring`, `openssl` e `curl` (tradução, Google Analytics e webhooks).
- **Permissão de escrita** do PHP na raiz do site (o "Publicar" grava as páginas `.html`, `sitemap.xml`,
  `robots.txt`, `en/` e `assets/uploads/`) e em `admin/data/`. No IIS, o usuário do pool de aplicativos precisa de
  escrita nessas pastas.
- **Não precisa de URL Rewrite**: a API fica em `/admin/api.php/<rota>` (o PHP no IIS aceita o caminho depois do
  `.php`). Os formulários do site enviam para `/admin/api.php/forms/<nome>`: o endereço vai nas páginas
  publicadas pelo painel (`window.MG_CFG.formsUrl`, lido por `assets/js/main.js`).
- Limites de envio do PHP: `upload_max_filesize` e `post_max_size` de pelo menos **16M** (imagens e PDFs do painel).
  Para anexos grandes no Trabalhe conosco, aumente os dois até o limite configurado no painel.
- Sem o pacote de certificados no PHP (`curl.cainfo`), o painel usa os certificados do sistema operacional.

## Segurança embutida

As mesmas proteções do painel em Node: hash de senha forte (Argon2id ou bcrypt), sessão no servidor com cookie
**HttpOnly/SameSite=Strict**, token **anti-CSRF** e conferência de origem em toda alteração, bloqueio por rede
(20 erros em 15 min) e por conta (progressivo, a partir de 5 erros), senha atual errada 5 vezes encerra a sessão,
CSP no painel, SVG só pelo administrador principal e sem conteúdo ativo, segredos (SMTP, webhooks, chaves do Google)
cifrados com AES-256-GCM (chave no config.php ou no banco, nunca em arquivo público), anexos com nome
impossível de adivinhar, aspas escapadas no título/descrição das páginas e recusadas nos dados compartilhados, `web.config`/`.htaccess` bloqueando `config.php`, `lib/`, `data/` e `tools/`.

## Manutenção

- Mudou a interface do painel em Node (`cms/admin/app.js`, `app.css`)? Rode `php admin/tools/sync-ui.php`
  para copiar para o painel PHP.
- O painel em Node continua funcionando para quem roda numa VPS com Node; os dois não compartilham dados.

## Rodar localmente

```bash
php -S 127.0.0.1:8000 -t . admin/tools/router-local.php   # na raiz do projeto (pdo_mysql, mbstring, openssl, curl)
# o roteador aplica os mesmos bloqueios do web.config (o php -S ignora web.config e .htaccess)
# http://127.0.0.1:8000/admin/
```

Localmente, use `'public_dir' => __DIR__ . '/data/public'` no `config.php` para o "Publicar" não sobrescrever os
`.html` versionados (o painel em Node faz o mesmo com `.cms-data/public`).
