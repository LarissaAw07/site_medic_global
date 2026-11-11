# Painel administrativo em PHP (`/admin`)

Versão do painel em **PHP + MySQL** que roda na própria hospedagem (IIS/Windows), sem Node.
Edita o conteúdo das páginas **`.html` já publicadas** — textos, links/CTAs, imagens, campos de
formulário e SEO (título e descrição) — com login, **backup de cada alteração** e **auditoria**.

> Não edita o menu nem o rodapé (fazem parte do layout global do site), e não gera o site a partir
> de `src/` (isso continua sendo o fluxo Node/`build.js`, opcional). Aqui você altera direto o HTML no ar.

## O que subir

Na pasta pública do site (onde já ficam `index.html`, `planos.html`, `en/`, `assets/` …), envie a pasta:

```
admin/
├─ index.php            roteador + telas do painel
├─ web.config           IIS: index.php como padrão + bloqueia config.php e lib/
├─ config.sample.php    modelo de configuração (NÃO guarda credenciais)
├─ lib/                 html.php (motor de edição), boot.php, auth.php, store.php
└─ ui/                  app.css, app.js
```

Você **não** sobe o `config.php` — ele é criado no servidor (passo 2) e contém a senha do banco.

## Passo a passo

1. **Crie um banco MySQL** no painel da hospedagem (ex.: cPanel/Plesk) e anote host, nome, usuário e senha.
   As tabelas do painel (`mg_admin_users`, `mg_admin_audit`, `mg_admin_backup`, `mg_admin_login_attempt`)
   são criadas **automaticamente** no primeiro acesso — não precisa importar SQL.

2. **Configure:** na pasta `admin/`, copie `config.sample.php` para **`config.php`** e preencha o bloco `db`:

   ```php
   'db' => [
     'host' => 'localhost',   // ou o host que a hospedagem informar
     'name' => 'seu_banco',
     'user' => 'seu_usuario',
     'pass' => 'sua_senha',
     'charset' => 'utf8mb4',
     'prefix' => 'mg_admin_',
   ],
   ```

3. **Acesse `https://seusite/admin/`.**
   - No primeiro acesso ele pede para **criar o administrador** (e-mail + senha).
   - Depois é só entrar, escolher a página e editar. Cada "Salvar e publicar" grava no `.html` e guarda a versão anterior em **Backups**.

## Requisitos da hospedagem

- **PHP 8.0+** com as extensões **`pdo_mysql`** e **`mbstring`** (padrão na maioria das hospedagens).
- **Permissão de escrita** do PHP na pasta pública do site (para salvar os `.html` e as imagens enviadas,
  que vão para `assets/img/uploads/`). Em IIS, o usuário do pool de aplicativos precisa de escrita nessa pasta.
- MySQL acessível com as credenciais do `config.php`.

## Segurança embutida

- Senha com hash (`password_hash`), sessão com cookie **HttpOnly/SameSite=Strict**, token **anti-CSRF** em todo formulário.
- **Bloqueio por IP** após 5 tentativas erradas (15 min).
- `web.config` bloqueia o download de `config.php` e o acesso à pasta `lib/`.
- Links são validados (http/https, mailto, tel, âncora ou `pagina.html`); `javascript:` e afins são recusados.
- Cada alteração guarda **antes → depois** por campo na auditoria, e a versão anterior do arquivo vai para Backups (30 por página).

## Limitações desta versão (v1)

- Edita o HTML **publicado**; não regenera `src/` nem traduz automaticamente para `/en/`
  (as páginas em inglês aparecem na lista e são editadas à parte).
- Não edita menu/rodapé (layout global) nem o conteúdo "rico" das páginas de RN 565/IDSS gerado por dados.
