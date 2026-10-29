# MedicGLOBAL 2.0 — novo site institucional

Site estático (HTML/CSS/JS sem framework), mobile first, gerado a partir de `src/`.

## Como usar

```bash
node build.js   # gera as páginas .html na raiz a partir de src/
node serve.js   # abre em http://localhost:8080
```

- `src/pages/*.html`: conteúdo de cada página (metadados SEO no cabeçalho `<!--@{...}@-->`)
- `src/partials/`: layout global (header, mega menus, rodapé, cookies), logo, cards de planos, mockup do app
- `src/data/site.json`: **fonte única** de telefones, WhatsApp, links de sistemas, PDFs e registro ANS
- `src/data/rn565.json`: histórico da RN 565 transcrito do site antigo; gera `rn565.html` e `rn565-agrupamento-AAAA.html` (via `src/gen-rn565.js`)
- `src/data/idss.json`: histórico do IDSS transcrito do site antigo (textos, notas e imagens em `assets/img/idss/`); gera `idss.html` e `idss-AAAA.html` (via `src/gen-idss.js`)
- `src/data/migracao.tsv`: inventário de migração; gera `mapa-de-migracao.html` (interno, noindex)
- `assets/css/main.css`: design system (tokens, grid 4/8/12, componentes)
- `assets/js/main.js`: navegação por necessidade, busca (Ctrl+K), filtros, formulários, consentimento LGPD, eventos GA4
- `assets/js/rede.js`: mapa da área de atuação (Leaflet + OpenStreetMap)
- `assets/js/rede-busca.js`: Busca combinada e Busca avançada da rede credenciada, sobre `assets/data/rede.json`
- `src/rede-sync.js`: baixa a rede do sistema oficial (extremamedic.com) e gera `assets/data/rede.json` (roda no deploy; local: `node src/rede-sync.js`)

## Painel administrativo (`/admin`)

Servidor Node sem dependências (`cms/`) que permite editar o conteúdo sem mexer no código: textos, títulos, imagens, links e CTAs de todas as páginas (PT e EN), SEO, notícias, dados gerais (`site.json`), logotipo/favicon, formulários (campos, destinos, mensagens recebidas) e Google Analytics. **Menu principal e rodapé (`src/partials/layout.html`) não são editáveis pelo painel.**

- As edições ficam em `CMS_DATA_DIR` (fora do repositório): `src/` nunca é alterado pelo painel e um deploy de código não apaga o que foi editado.
- Fluxo: salvar rascunho → visualizar → publicar (gera o site em `CMS_PUBLIC_DIR`). Cada publicação guarda a versão anterior.
- Cada edição guarda o valor original do campo: se o template mudar depois, ela só é aplicada se o elemento ainda existir (senão o painel avisa).
- Segurança: senha com hash scrypt, sessão no servidor (cookie HttpOnly/SameSite=Strict), token anti-CSRF, bloqueio após 5 erros, troca obrigatória da senha provisória, segredos (GA, SMTP, webhooks) cifrados com `CMS_SECRET_KEY`.

### Local

```bash
node cms/setup.js admin@medicglobal.com.br   # cria o administrador e mostra a senha provisória uma única vez
node cms/server.js                           # http://127.0.0.1:8788/admin (site com o conteúdo do painel em http://127.0.0.1:8788/)
```

### Produção (VPS) — uma vez

1. Node 18+ na VPS; usuário de sistema `medicglobal`; pastas `/opt/medicglobal/app` (código), `/var/lib/medicglobal-cms` (dados, permissão 700) e a pasta atual do nginx (`VPS_PATH`) com escrita para `medicglobal`.
2. `/etc/medicglobal-cms.env` a partir de `deploy/medicglobal-cms.env.example` (gerar `CMS_SECRET_KEY` com `openssl rand -hex 32`).
3. Serviço: `deploy/medicglobal-cms.service` → `systemctl enable --now medicglobal-cms`.
4. nginx: incluir `deploy/nginx-medicglobal-cms.conf` no `server {}` do site.
5. Administrador: `sudo -u medicglobal env $(cat /etc/medicglobal-cms.env | xargs) node /opt/medicglobal/app/cms/setup.js email@dominio` (anote a senha provisória exibida).
6. GitHub: segredo `VPS_APP_PATH=/opt/medicglobal/app`, variável `CMS_ENABLED=true` e permissão para o usuário do deploy rodar `sudo systemctl restart medicglobal-cms` sem senha. Com isso, o deploy envia o código e reinicia o serviço (que regera o site com o conteúdo do painel). Sem `CMS_ENABLED`, o deploy continua 100% estático, como antes.

## Pendências antes de publicar (detalhes em `mapa-de-migracao.html`)

1. Razão social e CNPJ (o rodapé tem um espaço reservado, sinalizado).
2. Vetor oficial do logo e arquivos WOFF2 da Agenor Neue.
3. Planos: diferença entre BLUE 300 e 400, segmentação, contratação e nº de registro de cada produto.
4. Telefones: todos os canais (central, autorizações, financeiro, comercial) usam o número único (35) 3435-4442, definido em `src/data/site.json`.
5. E-mail da ouvidoria no domínio antigo; nome e contato do DPO.
6. Política de Privacidade: texto-modelo, precisa de validação jurídica.
7. Programas de saúde, nomes dos 5 hospitais e textos dos posts marcados "Em atualização".
8. Destinos dos formulários (e-mail/webhook) e ID do GA4/GTM: configurar no painel (`/admin` › Formulários e Google Analytics).
9. Fotos provisórias (Unsplash): substituir por um banco de imagens próprio ou licenciado.
10. Portais em IP sem HTTPS (beneficiário legado, empresa, autorizador, boleto): avaliar migração.
