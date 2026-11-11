# Publicar em hospedagem HTML + PHP (IIS / Windows — web.config)

O site é estático; só a **busca da rede** e o **guia médico** precisam de PHP
(proxies para `extremamedic.com`, que não libera CORS).

> **Painel de edição nesta hospedagem:** há uma versão do `/admin` em **PHP + MySQL** que roda
> aqui mesmo, editando o conteúdo das páginas `.html` já publicadas. Veja `deploy/PAINEL-ADMIN-PHP.md`.
> (O painel `/admin` original, em Node, continua existindo para quem roda numa VPS com `build.js`.)

> Hospedagem **IIS (Windows)**: o roteamento fica em `web.config` (módulo URL Rewrite).
> Não use `.htaccess` (é do Apache).

## 1. Gerar o site
```bash
node build.js
```

## 2. Subir para a pasta pública (ex.: `public_html/`)
Envie, da raiz do projeto:

- Todos os arquivos `*.html` da raiz (index.html, planos.html, …)
- `assets/`  `en/`  `cms/admin/` (só se quiser os ícones) 
- `robots.txt`  `sitemap.xml`
- **`_proxy.php`** + as pastas **`rede-api/`** e **`guia-api/`**  ← habilitam rede e guia
- `web.config` (opcional: só página 404 + MIME de fontes)

Não precisa subir: `src/`, `cms/` (exceto admin estático), `deploy/`, `build.js`,
`serve.js`, `node_modules/`, `.git/`, `.htaccess`, `diag.php`.

## 3. Requisitos na hospedagem
- **PHP habilitado (FastCGI) com extensão `cURL`** e conexões HTTPS de saída liberadas
- **NÃO precisa de URL Rewrite**: `rede-api/` e `guia-api/` são pastas reais com um
  `.php` por endpoint, que reencaminham para `extremamedic.com` via `_proxy.php`.
- O `web.config` é opcional — se a hospedagem reclamar, pode removê-lo que o site funciona
  (só perde a página 404 personalizada e os MIME de fontes WOFF2).

## 4. Testar
- Abrir `/` — navegação e links (`.html`) funcionam sem rewrite
- `rede-credenciada.html` → fazer uma busca (chama `/rede-api/…`)
- `guia-medico.html` → escolher tipo/estado/cidade → "Visualizar manual" (`/guia-api/…`)
- Uma URL inexistente deve cair no `404.html`

Se a rede/guia falharem, geralmente é cURL desabilitado ou saída HTTPS bloqueada
na hospedagem.
