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
- `src/data/migracao.tsv`: inventário de migração; gera `mapa-de-migracao.html` (interno, noindex)
- `assets/css/main.css`: design system (tokens, grid 4/8/12, componentes)
- `assets/js/main.js`: navegação por necessidade, busca (Ctrl+K), filtros, formulários, consentimento LGPD, eventos GA4
- `assets/js/rede.js`: mapa da área de atuação (Leaflet + OpenStreetMap)
- `assets/js/rede-busca.js`: Busca combinada e Busca avançada da rede credenciada, sobre `assets/data/rede.json`
- `src/rede-sync.js`: baixa a rede do sistema oficial (extremamedic.com) e gera `assets/data/rede.json` (roda no deploy; local: `node src/rede-sync.js`)

## Pendências antes de publicar (detalhes em `mapa-de-migracao.html`)

1. Razão social e CNPJ (o rodapé tem um espaço reservado, sinalizado).
2. Vetor oficial do logo e arquivos WOFF2 da Agenor Neue.
3. Planos: diferença entre BLUE 300 e 400, segmentação, contratação e nº de registro de cada produto.
4. Canal comercial: o número exibido (35) 3435-4442 é diferente do WhatsApp (35) 98826-9853.
5. E-mail da ouvidoria no domínio antigo; nome e contato do DPO.
6. Política de Privacidade: texto-modelo, precisa de validação jurídica.
7. Programas de saúde, nomes dos 5 hospitais e textos dos posts marcados "Em atualização".
8. Integração dos formulários (CRM/e-mail) e ID do GTM (`GTM-XXXXXXX`).
9. Fotos provisórias (Unsplash): substituir por um banco de imagens próprio ou licenciado.
10. Portais em IP sem HTTPS (beneficiário legado, empresa, autorizador, boleto): avaliar migração.
