<?php
/* Port PHP 8 dos geradores src/gen-migracao.js, src/gen-noticias.js, src/gen-rn565.js e src/gen-idss.js.
   Saída idêntica byte a byte à versão Node. Cada função recebe um objeto $fs com readFileSync, writeFileSync,
   existsSync, readdirSync, unlinkSync e mkdirSync (caminhos absolutos com barras normais) e usa a constante
   MG_ROOT (raiz do projeto, sem barra final), definida por quem chama. */

/* ---------------- helpers (semântica JS) ---------------- */

// truthiness de JS: "0" e [] são verdadeiros
function gen_truthy($v): bool {
  return !($v === null || $v === false || $v === '' || $v === 0 || $v === 0.0 || (is_float($v) && is_nan($v)));
}

// String(v) / interpolação de template literal
function gen_s($v): string {
  if ($v === null) return 'undefined';
  if ($v === true) return 'true';
  if ($v === false) return 'false';
  if (is_int($v)) return (string)$v;
  if (is_float($v)) {
    if (is_nan($v)) return 'NaN';
    if (is_infinite($v)) return $v > 0 ? 'Infinity' : '-Infinity';
    if ($v == floor($v) && abs($v) < 1e21) return sprintf('%.0f', $v);
    return rtrim(json_encode($v), '');
  }
  if (is_array($v)) {
    if (array_is_list($v)) return implode(',', array_map(fn($x) => $x === null ? '' : gen_s($x), $v));
    return '[object Object]';
  }
  return (string)$v;
}

function gen_g(array $a, string $k) { return $a[$k] ?? null; }

// String.prototype.replace com padrão string: só a primeira ocorrência
function gen_replace1(string $s, string $find, string $rep): string {
  $p = strpos($s, $find);
  return $p === false ? $s : substr($s, 0, $p) . $rep . substr($s, $p + strlen($find));
}

// Array.prototype.slice
function gen_slice(array $a, int $start, ?int $end = null): array {
  $n = count($a);
  if ($start < 0) $start = max(0, $n + $start); else $start = min($start, $n);
  if ($end === null) $end = $n; elseif ($end < 0) $end = max(0, $n + $end); else $end = min($end, $n);
  return $end > $start ? array_slice($a, $start, $end - $start) : [];
}

function gen_esc($s): string {
  return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], gen_s($s));
}

function gen_lower($s): string { return mb_strtolower(gen_s($s), 'UTF-8'); }

function gen_num_cmp($a, $b): int {
  $x = is_numeric($a) ? +$a : NAN; $y = is_numeric($b) ? +$b : NAN;
  if (is_nan($x) || is_nan($y)) return 0;
  return $x <=> $y;
}

// JSON.stringify (compacto ou com indentação, como JSON.stringify(x, null, 2))
function gen_json($v, string $ind = '', ?string $step = null): string {
  if ($v === null) return 'null';
  if (is_bool($v)) return $v ? 'true' : 'false';
  if (is_int($v)) return (string)$v;
  if (is_float($v)) return is_finite($v) ? gen_s($v) : 'null';
  if (is_string($v)) return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS);
  $list = array_is_list($v);
  if (!count($v)) return $list ? '[]' : '{}';
  $parts = [];
  $in = $step === null ? '' : $ind . $step;
  foreach ($v as $k => $x) {
    $val = gen_json($x, $in, $step);
    $parts[] = $list ? $val : gen_json((string)$k) . ($step === null ? ':' : ': ') . $val;
  }
  [$o, $c] = $list ? ['[', ']'] : ['{', '}'];
  if ($step === null) return $o . implode(',', $parts) . $c;
  return $o . "\n" . $in . implode(",\n" . $in, $parts) . "\n" . $ind . $c;
}
function gen_json2($v): string { return gen_json($v, '', '  '); }

function gen_ensure_dir($fs, string $d): void { if (!$fs->existsSync($d)) $fs->mkdirSync($d); }

/* ---------------- gen-migracao ---------------- */

function gen_migracao($fs): void {
  $txt = $fs->readFileSync(MG_ROOT . '/src/data/migracao.tsv');
  $ws = '[\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';
  $txt = preg_replace('/^' . $ws . '+|' . $ws . '+$/u', '', $txt);
  $rows = array_map(fn($l) => explode("\t", $l), preg_split('/\r?\n/', $txt));
  $esc = fn($s) => str_replace(['&', '<'], ['&amp;', '&lt;'], gen_s($s));
  $needs = fn($r) => str_starts_with(gen_s($r[6] ?? null), 'Sim');
  $td = fn($c, $cls = '') => '<td style="text-align:left"' . ($cls !== '' ? ' class="' . $cls . '"' : '') . '>' . $c . '</td>';
  $body = implode("\n", array_map(fn($r) => '<tr data-acao="' . gen_lower($r[4] ?? null) . '" data-rev="' . ($needs($r) ? 'sim' : 'nao') . '">'
    . $td($esc($r[0])) . $td($esc($r[1] ?? null), 'xs muted') . $td($esc($r[2] ?? null)) . $td($esc($r[3] ?? null))
    . $td('<span class="badge">' . gen_s($r[4] ?? null) . '</span>') . $td($esc($r[5] ?? null), 'small')
    . $td($needs($r) ? '<span class="review-flag">' . $esc($r[6]) . '</span>' : $esc($r[6] ?? null), 'small') . '</tr>', $rows));
  $acoes = ['MANTER', 'REESCREVER', 'REORGANIZAR', 'ATUALIZAR', 'VALIDAR', 'ARQUIVAR'];
  $cnt = fn($a) => count(array_filter($rows, fn($r) => ($r[4] ?? null) === $a));
  $meta = ['title' => 'Mapa de migração de conteúdo | MedicGLOBAL 2.0', 'description' => 'Inventário interno do conteúdo atual e destino na nova arquitetura.', 'noindex' => true, 'crumbs' => [['Mapa de migração', 'mapa-de-migracao.html']]];
  $n = count($rows);
  $html = '<!--@' . gen_json($meta) . '@-->
<section class="page-hero" style="padding-bottom:40px"><div class="wrap">{{crumbs}}<span class="eyebrow">Documento interno · não indexado</span><h1 class="balance" style="font-size:var(--t-h2)">Mapa de migração de conteúdo</h1><p class="lead">Inventário do site atual (medicglobal.com.br e extremamedic.com, levantado em 08/10/2026) e o destino de cada item na nova arquitetura: <strong>' . $n . ' itens</strong>, dos quais ' . count(array_filter($rows, $needs)) . ' precisam de revisão ou validação.</p></div></section>
<section class="section section--flush-top" data-filter data-filter-items="#mig tbody tr"><div class="wrap wrap--wide">
<div class="flex-between mb-6"><div class="type-pills"><button class="pill" type="button" data-filter-group="acao" data-value="all" aria-pressed="true">Todos (' . $n . ')</button>' . implode('', array_map(fn($a) => '<button class="pill" type="button" data-filter-group="acao" data-value="' . strtolower($a) . '" aria-pressed="false">' . $a . ' (' . $cnt($a) . ')</button>', $acoes)) . '</div>
<div class="type-pills"><button class="pill" type="button" data-filter-group="rev" data-value="all" aria-pressed="true">Todas</button><button class="pill" type="button" data-filter-group="rev" data-value="sim" aria-pressed="false">Necessita revisão</button></div></div>
<div class="field mb-6" style="max-width:420px"><label for="mq">Buscar</label><input id="mq" type="search" data-filter-search></div>
<div class="matrix-wrap" id="mig"><table class="matrix" style="min-width:1100px"><thead><tr>' . implode('', array_map(fn($h) => '<th scope="col" style="text-align:left">' . $h . '</th>', ['Conteúdo atual', 'Origem / URL', 'Nova página', 'Nova seção', 'Classificação', 'Status da copy', 'Necessita revisão?'])) . '</tr></thead><tbody>
' . $body . '
</tbody></table></div></div></section>
';
  $fs->writeFileSync(MG_ROOT . '/src/pages/mapa-de-migracao.html', $html);
}

/* ---------------- gen-noticias ---------------- */

function gen_noticias_ui(string $lang): array {
  if ($lang === 'pt') return [
    'cat' => ['noticias' => 'Notícias', 'comunicados' => 'Comunicados'],
    'date' => fn($d) => implode('/', array_reverse(explode('-', gen_s($d)))),
    'contents' => 'Conteúdos',
    'back' => fn($c) => 'Voltar para ' . gen_lower($c),
    'read' => fn($m) => 'Leitura de ' . gen_s($m) . ' min',
    'ref' => 'Referência informativa ·',
    'refLink' => 'ver publicação original',
    'newTab' => ' (abre em nova aba)',
    'caption' => 'Imagem ilustrativa.',
    'srcLabel' => 'Fonte original',
    'srcLine' => fn($t, $d) => ($t !== '' ? '“' . $t . '”, p' : 'P') . 'ublicado em ' . $d . '.',
    'srcBtn' => 'Ler a publicação oficial',
    'disclaimer' => 'Resumo elaborado pela MedicGLOBAL a partir da publicação oficial, como referência informativa. Não se trata de comunicado da MedicGLOBAL. Em caso de divergência, prevalece o texto da fonte.',
    'help' => 'Dúvidas sobre o seu plano? Fale com a <a href="atendimento.html">central de atendimento</a>.',
    'share' => 'Compartilhar',
    'shareBar' => '<div class="share-bar mt-7"><span class="share-bar-label">Compartilhar:</span><div class="share-bar-nets"><a class="share-net" data-share-net="facebook" href="#" target="_blank" rel="noopener" aria-label="Facebook (abre em nova aba)">{{i:facebook}}</a><a class="share-net" data-share-net="x" href="#" target="_blank" rel="noopener" aria-label="X (abre em nova aba)">{{i:x}}</a><a class="share-net" data-share-net="linkedin" href="#" target="_blank" rel="noopener" aria-label="LinkedIn (abre em nova aba)">{{i:linkedin}}</a><a class="share-net" data-share-net="whatsapp" href="#" target="_blank" rel="noopener" aria-label="WhatsApp (abre em nova aba)">{{i:whatsapp}}</a><a class="share-net" data-share-net="email" href="#" target="_blank" rel="noopener" aria-label="E-mail">{{i:mail}}</a><button class="share-net" type="button" data-share-copy aria-label="Copiar link">{{i:link-mark}}</button></div><button class="btn btn--sm" type="button" data-share>{{i:share}} Compartilhar</button><span class="news-share-ok small" role="status"></span></div>',
    'related' => 'Leia também',
    'all' => 'Todos os conteúdos',
  ];
  return [
    'cat' => ['noticias' => 'News', 'comunicados' => 'Notices'],
    'date' => function ($d) {
      $p = explode('-', gen_s($d));
      $m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(int)($p[1] ?? 0) - 1] ?? 'undefined';
      return $m . ' ' . (int)($p[2] ?? 0) . ', ' . $p[0];
    },
    'contents' => 'Content',
    'back' => fn($c) => 'Back to ' . gen_lower($c),
    'read' => fn($m) => gen_s($m) . ' min read',
    'ref' => 'Informational reference ·',
    'refLink' => 'see the original publication',
    'newTab' => ' (opens in a new tab)',
    'caption' => 'Illustrative image.',
    'srcLabel' => 'Original source',
    'srcLine' => fn($t, $d) => ($t !== '' ? '“' . $t . '” (in Portuguese), p' : 'P') . 'ublished on ' . $d . '.',
    'srcBtn' => 'Read the official publication',
    'disclaimer' => 'Summary prepared by MedicGLOBAL from the official publication, for information purposes only. This is not a MedicGLOBAL notice. In case of any discrepancy, the source text prevails.',
    'share' => 'Share',
    'shareBar' => '<div class="share-bar mt-7"><span class="share-bar-label">Share:</span><div class="share-bar-nets"><a class="share-net" data-share-net="facebook" href="#" target="_blank" rel="noopener" aria-label="Facebook (opens in a new tab)">{{i:facebook}}</a><a class="share-net" data-share-net="x" href="#" target="_blank" rel="noopener" aria-label="X (opens in a new tab)">{{i:x}}</a><a class="share-net" data-share-net="linkedin" href="#" target="_blank" rel="noopener" aria-label="LinkedIn (opens in a new tab)">{{i:linkedin}}</a><a class="share-net" data-share-net="whatsapp" href="#" target="_blank" rel="noopener" aria-label="WhatsApp (opens in a new tab)">{{i:whatsapp}}</a><a class="share-net" data-share-net="email" href="#" target="_blank" rel="noopener" aria-label="Email">{{i:mail}}</a><button class="share-net" type="button" data-share-copy aria-label="Copy link">{{i:link-mark}}</button></div><button class="btn btn--sm" type="button" data-share>{{i:share}} Share</button><span class="news-share-ok small" role="status"></span></div>',
    'help' => 'Questions about your plan? Contact our <a href="atendimento.html">customer service</a>.',
    'related' => 'Read also',
    'all' => 'All content',
  ];
}

function gen_noticias($fs): void {
  $ROOT = MG_ROOT;
  $all = json_decode($fs->readFileSync(MG_ROOT . '/src/data/noticias.json'), true, 512, JSON_THROW_ON_ERROR);
  usort($all, fn($a, $b) => strcmp(gen_s($b['data'] ?? null), gen_s($a['data'] ?? null)) <=> 0);
  $file = fn($n) => 'noticia-' . gen_s($n['slug'] ?? null) . '.html';

  foreach (['pt', 'en'] as $lang) {
    $U = gen_noticias_ui($lang);
    $base = $lang === 'pt' ? MG_ROOT . '/src' : MG_ROOT . '/src/en';
    $pages = $base . '/pages'; $partials = $base . '/partials';
    gen_ensure_dir($fs, $pages); gen_ensure_dir($fs, $partials);
    $news = [];
    foreach ($all as $n) {
      if ($lang === 'pt') { $news[] = $n; continue; }
      if (!gen_truthy($n['en'] ?? null)) continue;
      $m = $n;
      if (is_array($n['en'])) foreach ($n['en'] as $k => $v) $m[$k] = $v;
      $news[] = $m;
    }

    $keep = array_flip(array_map($file, $news));
    foreach ($fs->readdirSync($pages) as $f) if (preg_match('/^noticia-.+\.html$/', $f)) $fs->unlinkSync($pages . '/' . $f);
    if ($lang === 'pt') foreach ($fs->readdirSync($ROOT) as $f) if (preg_match('/^noticia-.+\.html$/', $f) && !isset($keep[$f])) $fs->unlinkSync($ROOT . '/' . $f);

    $catName = fn($c) => $U['cat'][gen_s($c)] ?? null;
    $card = fn($n, $sizes = '(min-width:1100px) 30vw, 100vw') =>
      '<a class="card-post card-post--ext" data-cat="' . gen_s($n['cat'] ?? null) . '" href="' . $file($n) . '">' . (gen_truthy($n['foto'] ?? null) ? '<div class="img">{{pic:' . gen_s($n['foto']) . '||800|' . $sizes . '}}</div>' : '<div class="img img--globe">{{> globe-art}}</div>')
      . '<div class="post-meta"><span class="cat">' . gen_s($catName($n['cat'] ?? null)) . '</span><time datetime="' . gen_s($n['data'] ?? null) . '">' . $U['date']($n['data'] ?? null) . '</time></div>'
      . '<h3>' . gen_esc($n['titulo'] ?? null) . '</h3><p>' . gen_esc($n['resumo'] ?? null) . '</p></a>';

    $fs->writeFileSync($partials . '/noticias-cards.html', implode("\n", array_map(fn($n) => $card($n), $news)) . "\n");

    foreach ($news as $idx => $n) {
      $others = [];
      foreach ($news as $j => $o) if ($j !== $idx) $others[] = $o;
      $nc = $n['cat'] ?? null;
      usort($others, fn($a, $b) => (int)(($b['cat'] ?? null) === $nc) - (int)(($a['cat'] ?? null) === $nc));
      $others = array_slice($others, 0, 3);
      $cat = $catName($nc); $src = gen_truthy($n['fonteUrl'] ?? null);
      $ld = ['@context' => 'https://schema.org', '@type' => 'NewsArticle', 'headline' => $n['titulo'] ?? null, 'inLanguage' => $lang === 'pt' ? 'pt-BR' : 'en', 'datePublished' => $n['data'] ?? null];
      if ($src) $ld['isBasedOn'] = $n['fonteUrl'];
      $ld['author'] = ['@type' => 'Organization', 'name' => 'MedicGLOBAL'];
      $ld['publisher'] = ['@type' => 'Organization', 'name' => 'MedicGLOBAL'];
      $meta = [
        'title' => gen_s($n['titulo'] ?? null) . ' | ' . $U['contents'] . ' | MedicGLOBAL',
        'description' => $n['resumo'] ?? null,
        'active' => 'conteudos',
        'og' => gen_truthy($n['foto'] ?? null) ? $n['foto'] : 'old_hsl_fachada',
        'crumbs' => [[$U['contents'], 'conteudos.html'], [$cat, 'conteudos.html#cat=' . gen_s($nc)], [$n['migalha'] ?? null, $file($n)]],
        'jsonld' => [$ld],
      ];
      $meta = array_filter($meta, fn($v) => $v !== null); // JSON.stringify omite undefined
      $secoes = implode("\n", array_map(fn($s) => '        <h2>' . gen_esc($s['h'] ?? null) . "</h2>\n" . implode("\n", array_map(fn($p) => '        <p>' . gen_esc($p) . '</p>', $s['p'] ?? [])), $n['secoes'] ?? []));
      $ncs = gen_s($nc);
      $date = $U['date']($n['data'] ?? null);
      $html = '<!--@' . gen_json2($meta) . '@-->

<article class="news">
  <header class="page-hero" style="padding-bottom:48px">
    <div class="wrap">
      {{crumbs}}
      <a class="news-back" href="conteudos.html#cat=' . $ncs . '">{{i:chevron-left}} ' . $U['back']($cat) . '</a>
      <div class="post-meta mb-6"><span class="cat">' . gen_s($cat) . '</span><time datetime="' . gen_s($n['data'] ?? null) . '">' . $date . '</time><span>' . gen_esc($n['tema'] ?? null) . '</span><span>' . $U['read']($n['leitura'] ?? null) . '</span></div>
      <h1 class="balance news-title">' . gen_esc($n['titulo'] ?? null) . '</h1>
' . ($src ? '      <p class="news-src-line">' . $U['ref'] . ' <a href="' . gen_esc($n['fonteUrl']) . '" target="_blank" rel="noopener">' . $U['refLink'] . '<span class="sr-only">' . $U['newTab'] . "</span></a></p>\n" : '') . '    </div>
  </header>
  <div class="wrap"><figure class="news-figure">' . (gen_truthy($n['foto'] ?? null) ? '<div class="img-round" style="aspect-ratio:21/9">{{pic:' . gen_s($n['foto']) . '|' . preg_replace('/[|{}]/', '', gen_esc($n['titulo'] ?? null)) . '|2000|(min-width:1360px) 1300px, 100vw|eager}}</div><figcaption>' . $U['caption'] . '</figcaption>' : '<div class="img-round img--globe" style="aspect-ratio:21/9">{{> globe-art}}</div>') . '</figure></div>
  <div class="section section--tight">
    <div class="wrap">
      <div class="prose news-body">
        <p class="lead">' . gen_esc($n['intro'] ?? null) . '</p>
' . $secoes . '
' . ($src ? '        <div class="news-source">
          <p class="news-source-label">' . $U['srcLabel'] . '</p>
          <p>' . $U['srcLine'](gen_esc(gen_truthy($n['fonteTitulo'] ?? null) ? $n['fonteTitulo'] : ''), $date) . '</p>
          <a class="btn btn--sm" href="' . gen_esc($n['fonteUrl']) . '" target="_blank" rel="noopener">' . $U['srcBtn'] . '<span class="sr-only">' . $U['newTab'] . '</span></a>
          <p class="xs muted">' . $U['disclaimer'] . '</p>
        </div>
' : '') . '        ' . $U['shareBar'] . '
        <p class="small mt-7">' . $U['help'] . '</p>
        <a class="news-back mt-6" href="conteudos.html#cat=' . $ncs . '">{{i:chevron-left}} ' . $U['back']($cat) . '</a>
      </div>
    </div>
  </div>
</article>

<section class="section mist" aria-labelledby="rel-t">
  <div class="wrap">
    <div class="flex-between mb-7"><h2 id="rel-t" style="font-size:var(--t-h3)">' . $U['related'] . '</h2><a class="link" href="conteudos.html#todos">' . $U['all'] . '</a></div>
    <div class="card-grid">
' . implode("\n", array_map(fn($o) => '      ' . $card($o), $others)) . '
    </div>
  </div>
</section>
';
      $fs->writeFileSync($pages . '/' . $file($n), $html);
    }
  }
}

/* ---------------- gen-rn565 ---------------- */

// datas no padrão americano (MM/DD/AAAA)
function gen_en_date($d): string {
  $p = explode('/', gen_s($d));
  return gen_s($p[1] ?? null) . '/' . gen_s($p[0]) . '/' . gen_s($p[2] ?? null);
}

function gen_rn565_ui(string $lang): array {
  $olderRange = fn($sep, $yrs) => fn($l) => gen_nonempty($l) . gen_s($l[count($l) - 1]['ano'] ?? null) . $sep . gen_s($l[0]['ano'] ?? null) . ' · ' . count($l) . $yrs;
  if ($lang === 'pt') return [
    'crumbsBase' => [['MedicGLOBAL', 'medicglobal.html'], ['Documentos', 'documentos.html']],
    'pageTitle' => 'RN 565 — Percentual de reajuste',
    'eyebrow' => 'RN 565',
    'h1' => 'Percentual de reajuste',
    'sub' => 'Histórico dos percentuais de reajuste',
    'lead' => 'Percentuais aplicados ao agrupamento de contratos coletivos com até 30 vidas, por período de aplicação. Em cada ano, consulte a relação completa de contratos do agrupamento.',
    'metaDesc' => fn($a, $b) => 'RN 565 MedicGLOBAL: histórico dos percentuais de reajuste do agrupamento de contratos com até 30 vidas, de ' . gen_s($a) . ' a ' . gen_s($b) . ', com a relação de contratos de cada ano.',
    'cat' => 'Agrupamento de contratos · até 30 vidas',
    'current' => 'Vigente',
    'period' => 'Período de aplicação',
    'pct' => 'Percentual',
    'year' => 'Ano',
    'desc' => 'Descrição',
    'jump' => 'Ir para o ano',
    'older' => 'Anos anteriores',
    'pickYear' => 'Selecionar ano',
    'allYears' => 'Todos os anos',
    'olderRange' => $olderRange(' a ', ' anos'),
    'view' => 'Ver agrupamento',
    'download' => 'Baixar agrupamento',
    'pdfLabel' => 'Empresas do agrupamento (RN 309) — PDF',
    'pdfLabelNew' => 'Relação de contratos do agrupamento — PDF',
    'noPct' => 'Percentual não informado na publicação original',
    'noPctShort' => 'Não informado',
    'newTab' => ' (abre em nova aba)',
    'docsBack' => 'Voltar para a central de documentos',
    'pdfTitle' => 'Relação de contratos',
    'help' => 'Dúvidas sobre o reajuste do seu contrato? Fale com a <a href="atendimento.html">central de atendimento</a>.',
    'agrTitle' => fn($y) => 'Agrupamento de contratos RN 565 — ' . gen_s($y),
    'agrCrumb' => fn($y) => 'Agrupamento ' . gen_s($y),
    'agrMetaDesc' => fn($a) => 'Relação de contratos do agrupamento RN 565 de ' . gen_s($a['ano'] ?? null) . ' (até 30 vidas), com plano e registro ANS. Período de aplicação: ' . gen_s($a['inicio'] ?? null) . ' a ' . gen_s($a['fim'] ?? null) . '.',
    'back' => 'Voltar para o histórico da RN 565',
    'validity' => fn($a) => gen_s($a['inicio'] ?? null) . ' a ' . gen_s($a['fim'] ?? null),
    'stats' => ['pct' => 'Percentual de reajuste', 'period' => 'Período de aplicação', 'contracts' => 'Contratos no agrupamento', 'plans' => 'Planos no agrupamento'],
    'tblTitle' => 'Contratos do agrupamento',
    'tblSearch' => 'Buscar contrato, plano ou registro ANS',
    'tblSearchPh' => 'Ex.: 9687 ou BLUE 200',
    'tblCount' => 'contratos',
    'tblNone' => 'Nenhum contrato encontrado para essa busca.',
    'cols' => ['Contrato', 'Plano', 'Registro ANS'],
    'plansTitle' => 'Planos deste agrupamento',
    'plansCount' => fn($n) => $n . ' ' . ($n === 1 ? 'contrato' : 'contratos'),
    'otherYears' => 'Outros anos',
    'prev' => 'Ano anterior',
    'next' => 'Ano seguinte',
    'descricao' => fn($a) => $a['descricao'] ?? null,
  ];
  return [
    'crumbsBase' => [['MedicGLOBAL', 'medicglobal.html'], ['Documents', 'documentos.html']],
    'pageTitle' => 'RN 565 — Adjustment percentage',
    'eyebrow' => 'RN 565',
    'h1' => 'Adjustment percentage',
    'sub' => 'History of adjustment percentages',
    'lead' => 'Percentages applied to the pool of group contracts with up to 30 lives (members), by application period. For each year, see the full list of contracts in the pool.',
    'metaDesc' => fn($a, $b) => 'MedicGLOBAL RN 565: history of the adjustment percentages for the pool of contracts with up to 30 lives, from ' . gen_s($a) . ' to ' . gen_s($b) . ', with the list of contracts for each year.',
    'cat' => 'Contract pool · up to 30 lives',
    'current' => 'Current',
    'period' => 'Application period',
    'pct' => 'Percentage',
    'year' => 'Year',
    'desc' => 'Description',
    'jump' => 'Go to year',
    'older' => 'Previous years',
    'pickYear' => 'Select year',
    'allYears' => 'All years',
    'olderRange' => $olderRange(' to ', ' years'),
    'view' => 'View contract pool',
    'download' => 'Download contract pool',
    'pdfLabel' => 'Companies in the pool (RN 309) — PDF (in Portuguese)',
    'pdfLabelNew' => 'List of contracts in the pool — PDF (in Portuguese)',
    'noPct' => 'Percentage not stated in the original publication',
    'noPctShort' => 'Not stated',
    'newTab' => ' (opens in a new tab)',
    'docsBack' => 'Back to the document center',
    'pdfTitle' => 'List of contracts',
    'help' => 'Questions about your contract\'s adjustment? Contact our <a href="atendimento.html">customer service</a>.',
    'agrTitle' => fn($y) => 'RN 565 contract pool — ' . gen_s($y),
    'agrCrumb' => fn($y) => 'Contract pool ' . gen_s($y),
    'agrMetaDesc' => fn($a) => 'List of contracts in the ' . gen_s($a['ano'] ?? null) . ' RN 565 pool (up to 30 lives), with plan and ANS registration. Application period: ' . gen_en_date($a['inicio'] ?? null) . ' to ' . gen_en_date($a['fim'] ?? null) . '.',
    'back' => 'Back to the RN 565 history',
    'validity' => fn($a) => gen_en_date($a['inicio'] ?? null) . ' to ' . gen_en_date($a['fim'] ?? null),
    'stats' => ['pct' => 'Adjustment percentage', 'period' => 'Application period', 'contracts' => 'Contracts in the pool', 'plans' => 'Plans in the pool'],
    'tblTitle' => 'Contracts in the pool',
    'tblSearch' => 'Search contract, plan or ANS registration',
    'tblSearchPh' => 'E.g.: 9687 or BLUE 200',
    'tblCount' => 'contracts',
    'tblNone' => 'No contracts match your search.',
    'cols' => ['Contract', 'Plan', 'ANS registration'],
    'plansTitle' => 'Plans in this pool',
    'plansCount' => fn($n) => $n . ' ' . ($n === 1 ? 'contract' : 'contracts'),
    'otherYears' => 'Other years',
    'prev' => 'Previous year',
    'next' => 'Next year',
    'descricao' => fn($a) => 'Adjustment percentage applied to the pool of contracts with up to 30 lives, for the period from ' . gen_en_date($a['inicio'] ?? null) . ' to ' . gen_en_date($a['fim'] ?? null)
      . (gen_truthy($a['percentual'] ?? null) ? ': ' . gen_replace1(gen_s($a['percentual']), ',', '.') : '.'),
  ];
}

function gen_rn565($fs): void {
  $data = json_decode($fs->readFileSync(MG_ROOT . '/src/data/rn565.json'), true, 512, JSON_THROW_ON_ERROR);
  $anos = $data['anos'];
  usort($anos, fn($a, $b) => gen_num_cmp($b['ano'] ?? null, $a['ano'] ?? null));
  $file = fn($a) => 'rn565-agrupamento-' . gen_s($a['ano'] ?? null) . '.html';
  $NA = count($anos);

  foreach (['pt', 'en'] as $lang) {
    $U = gen_rn565_ui($lang);
    $pages = MG_ROOT . '/src' . ($lang === 'pt' ? '' : '/en') . '/pages';
    $pct = fn($a) => gen_truthy($a['percentual'] ?? null) ? ($lang === 'en' ? gen_replace1(gen_s($a['percentual']), ',', '.') : gen_s($a['percentual'])) : null;
    $temPagina = fn($a) => gen_truthy($a['contratos'] ?? null) || gen_truthy($a['conteudo'] ?? null);
    $rich = function ($a) use ($lang) {
      $h = $lang === 'en' ? (gen_truthy($a['conteudoEn'] ?? null) ? $a['conteudoEn'] : ($a['conteudo'] ?? null)) : ($a['conteudo'] ?? null);
      return gen_truthy($h) ? "\n        <div class=\"doc-rich mt-8\">\n" . gen_s($h) . "\n        </div>" : '';
    };
    $pdfHref = fn($a) => gen_truthy($a['pdfFile'] ?? null) ? gen_s($a['pdfFile']) : '{{L.docs.' . gen_s($a['pdf'] ?? null) . '}}';
    foreach ($fs->readdirSync($pages) as $f) if (preg_match('/^rn565-agrupamento-\d{4}\.html$/', $f)) $fs->unlinkSync($pages . '/' . $f);

    $acao = fn($a, $cls = 'btn btn--sm') => $temPagina($a)
      ? '<a class="' . $cls . '" href="' . $file($a) . '">{{i:eye}} ' . $U['view'] . '</a>'
      : '<a class="' . $cls . '" href="' . $pdfHref($a) . '" target="_blank" rel="noopener" download data-doc="' . (gen_truthy($a['pdfFile'] ?? null) ? 'RN565' : 'RN309') . ' ' . gen_s($a['ano'] ?? null) . '">{{i:download}} ' . $U['download'] . '<span class="sr-only">' . $U['newTab'] . '</span></a>';
    $row = fn($a, $isCur) => '        <li class="rj-row' . ($isCur ? ' is-current' : '') . '" id="ano-' . gen_s($a['ano'] ?? null) . '">
          <span class="rj-year">' . gen_s($a['ano'] ?? null) . '</span>
          <div class="rj-info">
            <span class="rj-cat">' . $U['cat'] . ($isCur ? '<span class="rj-badge">' . $U['current'] . '</span>' : '') . '</span>
            <span class="rj-period">{{i:calendar}}<span class="sr-only">' . $U['period'] . ': </span>' . $U['validity']($a) . '</span>
            <p class="rj-desc">' . gen_esc($U['descricao']($a)) . '</p>' . (gen_truthy($a['contratos'] ?? null) ? '' : '
            <span class="rj-docs"><span class="rj-doc rj-doc--static">{{i:doc}} ' . (gen_truthy($a['pdfFile'] ?? null) ? $U['pdfLabelNew'] : $U['pdfLabel']) . '</span></span>') . '
          </div>
          <span class="rj-pct"><span class="sr-only">' . $U['pct'] . ': </span>' . (gen_truthy($pct($a)) ? $pct($a) : '<span class="review-flag">' . $U['noPctShort'] . '</span>') . '</span>
          <span class="rj-act">' . $acao($a) . '</span>
        </li>';
    $idxs = array_keys($anos);
    $recentes = gen_slice($idxs, 0, $NA - 10); $anteriores = gen_slice($idxs, -10);
    $pick = fn($ix) => array_map(fn($i) => $anos[$i], $ix);
    $atual = $anos[0];
    $meta = [
      'title' => $U['pageTitle'] . ' | MedicGLOBAL',
      'description' => $U['metaDesc']($anos[$NA - 1]['ano'] ?? null, $anos[0]['ano'] ?? null),
      'active' => 'institucional',
      'og' => 'old_rn565_banner',
      'crumbs' => array_merge($U['crumbsBase'], [['RN 565', 'rn565.html']]),
    ];
    $fs->writeFileSync($pages . '/rn565.html', '<!--@' . gen_json2($meta) . '@-->

<section class="page-hero rn-hero" aria-labelledby="t">
  <div class="rn-hero-bg" aria-hidden="true">{{pic:old_rn565_banner||1600|100vw|eager}}</div>
  <div class="wrap">
    {{crumbs}}
    <div class="grid" style="align-items:end">
      <div class="c-1-7">
        <span class="eyebrow">' . $U['eyebrow'] . '</span>
        <h1 id="t" class="balance">' . $U['h1'] . '</h1>
        <p class="lead">' . $U['sub'] . '. ' . $U['lead'] . '</p>
      </div>
      <div class="c-8-13">
        <a class="rn-current" href="' . $file($atual) . '">
          <span class="rn-current-top"><span class="rj-badge">' . $U['current'] . '</span><span>' . gen_s($atual['ano'] ?? null) . '</span></span>
          <span class="rn-current-pct">' . gen_s($pct($atual)) . '</span>
          <span class="rn-current-period">{{i:calendar}} ' . $U['validity']($atual) . '</span>
          <span class="rn-current-go">' . $U['view'] . ' {{i:arrow-right}}</span>
        </a>
      </div>
    </div>
  </div>
</section>

<section class="section section--tight" aria-labelledby="rn-hist">
  <div class="wrap">
    <div class="flex-between mb-6" style="align-items:end;gap:16px">
      <h2 id="rn-hist" style="font-size:var(--t-h3)">' . $U['sub'] . '</h2>
      <nav class="rn-years" aria-label="' . $U['jump'] . '">
        <span class="rn-years-label">' . $U['jump'] . '</span>
        <div class="rn-years-seg">
          <details class="rn-years-more">
            <summary>' . $U['pickYear'] . ' {{i:chevron-down}}</summary>
            <div class="rn-years-pop">
              <span class="rn-years-pop-title">' . $U['allYears'] . ' · ' . $U['olderRange']($anos) . '</span>
              <div class="rn-years-grid">' . implode('', array_map(fn($a) => '<a href="#ano-' . gen_s($a['ano'] ?? null) . '">' . gen_s($a['ano'] ?? null) . '</a>', $anos)) . '</div>
            </div>
          </details>
        </div>
      </nav>
    </div>
    <div class="rj rj--agr">
      <div class="rj-head" aria-hidden="true"><span>' . $U['year'] . '</span><span>' . $U['desc'] . '</span><span>' . $U['pct'] . '</span><span></span></div>
      <ol class="rj-list" aria-label="' . $U['sub'] . '">
' . implode("\n", array_map(fn($i) => $row($anos[$i], $i === 0), $recentes)) . '
      </ol>
      <details class="rj-older">
        <summary><span class="rj-older-title">{{i:layers}} ' . $U['older'] . ' <small>' . $U['olderRange']($pick($anteriores)) . '</small></span><span class="rj-chev">{{i:chevron-down}}</span></summary>
        <ol class="rj-list" aria-label="' . $U['older'] . '">
' . implode("\n", array_map(fn($i) => preg_replace('/^ {8}/m', '          ', $row($anos[$i], $i === 0)), $anteriores)) . '
        </ol>
      </details>
    </div>
    <p class="small mt-7">' . $U['help'] . '</p>
    <a class="news-back mt-6" href="documentos.html">{{i:chevron-left}} ' . $U['docsBack'] . '</a>
  </div>
</section>
');

    // ---------- Páginas internas ----------
    $com = array_values(array_filter($idxs, fn($i) => $temPagina($anos[$i])));
    foreach ($com as $i => $ai) {
      $a = $anos[$ai];
      $newer = $i > 0 ? $anos[$com[$i - 1]] : null;
      $older = isset($com[$i + 1]) ? $anos[$com[$i + 1]] : null;
      $isCur = $ai === 0;
      $contratos = gen_truthy($a['contratos'] ?? null) ? $a['contratos'] : null;
      $planos = [];
      foreach (($contratos ?? []) as $c) {
        $found = false;
        foreach ($planos as $k => $p) if ($p['plano'] === ($c['plano'] ?? null) && $p['registro'] === ($c['registro'] ?? null)) { $planos[$k]['n']++; $found = true; break; }
        if (!$found) $planos[] = ['plano' => $c['plano'] ?? null, 'registro' => $c['registro'] ?? null, 'n' => 1];
      }
      usort($planos, fn($x, $y) => $y['n'] <=> $x['n']);
      $meta = [
        'title' => $U['agrTitle']($a['ano'] ?? null) . ' | MedicGLOBAL',
        'description' => $U['agrMetaDesc']($a),
        'active' => 'institucional',
        'og' => 'old_rn565_banner',
        'crumbs' => array_merge($U['crumbsBase'], [['RN 565', 'rn565.html'], [$U['agrCrumb']($a['ano'] ?? null), $file($a)]]),
      ];
      $ano = gen_s($a['ano'] ?? null);
      $html = '<!--@' . gen_json2($meta) . '@-->

<article class="news agr">
  <header class="page-hero" style="padding-bottom:0">
    <div class="wrap">
      {{crumbs}}
      <a class="news-back" href="rn565.html#ano-' . $ano . '">{{i:chevron-left}} ' . $U['back'] . '</a>
      <div class="post-meta mb-6"><span class="cat">RN 565</span><span>' . $U['cat'] . '</span>' . ($isCur ? '<span class="src-tag">' . $U['current'] . '</span>' : '') . '</div>
    </div>
  </header>
  <!-- Título fixo: fica logo abaixo do menu durante toda a leitura (compacto ao fixar; ver main.js) -->
  <div class="agr-titlebar" data-agr-titlebar>
    <div class="wrap"><h1 class="balance agr-title">' . $U['agrTitle']($a['ano'] ?? null) . '</h1></div>
  </div>
  <div class="wrap">
    <figure class="news-figure">
      <div class="img-round agr-cover">
        {{pic:old_rn565_banner||2000|(min-width:1360px) 1300px, 100vw|eager}}
        <div class="agr-cover-txt" aria-hidden="true">
          <span class="agr-cover-eyebrow">RN 565 · ' . $U['cat'] . '</span>
          <span class="agr-cover-year">' . $ano . '</span>
          <span class="agr-cover-pct">' . (gen_truthy($pct($a)) ? $pct($a) : $U['noPctShort']) . '</span>
        </div>
      </div>
    </figure>
  </div>
  <div class="section section--tight">
    <div class="wrap">
      <div class="news-body">
        <dl class="agr-stats">
          <div><dt>' . $U['stats']['pct'] . '</dt><dd>' . (gen_truthy($pct($a)) ? $pct($a) : '<span class="review-flag">' . $U['noPct'] . '</span>') . '</dd></div>
          <div><dt>' . $U['stats']['period'] . '</dt><dd>' . $U['validity']($a) . '</dd></div>' . ($contratos !== null ? '
          <div><dt>' . $U['stats']['contracts'] . '</dt><dd>' . count($contratos) . '</dd></div>
          <div><dt>' . $U['stats']['plans'] . '</dt><dd>' . count($planos) . '</dd></div>' : '') . '
        </dl>
        <p class="lead mt-7">' . gen_esc($U['descricao']($a)) . '</p>' . $rich($a) . '
' . ($contratos !== null ? '
        <section class="mt-8" aria-labelledby="agr-t" data-filter data-filter-items="#agr-rows tr" data-filter-empty="#agr-none">
          <div class="agr-tools">
            <h2 id="agr-t" style="font-size:var(--t-h3)">' . $U['tblTitle'] . '</h2>
            <div class="field agr-search"><label class="sr-only" for="agr-q">' . $U['tblSearch'] . '</label><div class="doc-search-box">{{i:search}}<input id="agr-q" type="search" data-filter-search placeholder="' . $U['tblSearchPh'] . '" aria-describedby="agr-count"></div></div>
          </div>
          <p class="small muted" id="agr-count" aria-live="polite"><span data-filter-count>' . count($contratos) . '</span> ' . $U['tblCount'] . '</p>
          <div class="agr-tbl-wrap">
            <table class="agr-tbl">
              <thead><tr>' . implode('', array_map(fn($c) => '<th scope="col">' . $c . '</th>', $U['cols'])) . '</tr></thead>
              <tbody id="agr-rows">
' . implode("\n", array_map(fn($c) => '                <tr><td>' . gen_esc($c['contrato'] ?? null) . '</td><td>' . gen_esc($c['plano'] ?? null) . '</td><td>' . gen_esc($c['registro'] ?? null) . '</td></tr>', $contratos)) . '
              </tbody>
            </table>
          </div>
          <p id="agr-none" class="muted mt-5" hidden>' . $U['tblNone'] . '</p>
        </section>

        <section class="mt-8" aria-labelledby="agr-p">
          <h2 id="agr-p" class="mb-6" style="font-size:var(--t-h4)">' . $U['plansTitle'] . '</h2>
          <ul class="agr-plans">
' . implode("\n", array_map(fn($p) => '            <li><strong>' . gen_esc($p['plano']) . '</strong><span>' . $U['cols'][2] . ' ' . gen_esc($p['registro']) . '</span><span class="agr-plans-n">' . $U['plansCount']($p['n']) . '</span></li>', $planos)) . '
          </ul>
        </section>
' : '
        <section class="mt-8" aria-labelledby="agr-pdf">
          <h2 id="agr-pdf" class="mb-6" style="font-size:var(--t-h3)">' . $U['pdfTitle'] . '</h2>
          <a class="btn" href="' . $pdfHref($a) . '" target="_blank" rel="noopener" download data-doc="' . (gen_truthy($a['pdfFile'] ?? null) ? 'RN565' : 'RN309') . ' ' . $ano . '">{{i:download}} ' . $U['download'] . '<span class="sr-only">' . $U['newTab'] . '</span></a>
        </section>
') . '
        <nav class="agr-nav mt-8" aria-label="' . $U['otherYears'] . '">
          ' . ($older !== null ? '<a class="agr-nav-step" href="' . $file($older) . '" rel="prev">{{i:chevron-left}}<span><small>' . $U['prev'] . '</small>' . gen_s($older['ano'] ?? null) . '</span></a>' : '<span></span>') . '
          ' . ($newer !== null ? '<a class="agr-nav-step agr-nav-step--next" href="' . $file($newer) . '" rel="next"><span><small>' . $U['next'] . '</small>' . gen_s($newer['ano'] ?? null) . '</span>{{i:chevron-right}}</a>' : '<span></span>') . '
        </nav>
        <div class="agr-years mt-6"><span class="agr-years-label">' . $U['otherYears'] . ':</span>' . implode('', array_map(fn($oi) => $oi === $ai ? '<span aria-current="page">' . gen_s($anos[$oi]['ano'] ?? null) . '</span>' : '<a href="' . ($temPagina($anos[$oi]) ? $file($anos[$oi]) : 'rn565.html#ano-' . gen_s($anos[$oi]['ano'] ?? null)) . '">' . gen_s($anos[$oi]['ano'] ?? null) . '</a>', $idxs)) . '</div>
        <p class="small mt-7">' . $U['help'] . '</p>
        <a class="news-back mt-6" href="rn565.html#ano-' . $ano . '">{{i:chevron-left}} ' . $U['back'] . '</a>
      </div>
    </div>
  </div>
</article>
';
      $fs->writeFileSync($pages . '/' . $file($a), $html);
    }
  }
}

/* ---------------- gen-idss ---------------- */

function gen_dot($n): string { return gen_replace1(gen_s($n), ',', '.'); }

function gen_idss_dims(string $lang): array {
  if ($lang === 'pt') return [
    ['IDQS', 'Qualidade em Atenção à Saúde', 'Avaliação do conjunto de ações em saúde que contribuem para o atendimento das necessidades de saúde dos beneficiários, com ênfase nas ações de promoção, prevenção e assistência à saúde prestada.'],
    ['IDGA', 'Garantia de Acesso', 'Condições relacionadas à rede assistencial que possibilitam a garantia de acesso, abrangendo a oferta de rede de prestadores.'],
    ['IDSM', 'Sustentabilidade no Mercado', 'Monitoramento da sustentabilidade da operadora, considerando seu equilíbrio econômico-financeiro, passando pela satisfação do beneficiário e compromissos com prestadores.'],
    ['IDGR', 'Gestão de Processos e Regulação', 'Entre outros indicadores, essa dimensão afere o cumprimento das obrigações técnicas e cadastrais das operadoras junto à ANS.'],
  ];
  return [
    ['IDQS', 'Quality of Health Care', 'Assessment of the set of health actions that help meet members\' health needs, with emphasis on health promotion, prevention and care provided.'],
    ['IDGA', 'Guaranteed Access', 'Conditions related to the care network that ensure access, including the range of providers in the network.'],
    ['IDSM', 'Market Sustainability', 'Monitoring of the operator\'s sustainability, considering its economic and financial balance, member satisfaction and commitments to providers.'],
    ['IDGR', 'Process Management and Regulation', 'Among other indicators, this dimension measures compliance with the operator\'s technical and registration obligations to the ANS.'],
  ];
}

function gen_idss_ui(string $lang): array {
  $olderRange = fn($sep, $yrs) => fn($l) => gen_nonempty($l) . gen_s($l[count($l) - 1]['ano'] ?? null) . $sep . gen_s($l[0]['ano'] ?? null) . ' · ' . count($l) . $yrs;
  if ($lang === 'pt') return [
    'crumbsBase' => [['MedicGLOBAL', 'medicglobal.html'], ['Documentos', 'documentos.html']],
    'metaTitle' => 'IDSS — Índice de Desempenho da Saúde Suplementar | MedicGLOBAL',
    'metaDesc' => fn($a, $b) => 'Histórico do IDSS da MedicGLOBAL (Extremamedic), de ' . gen_s($a) . ' a ' . gen_s($b) . ': nota geral, notas por dimensão e os resultados divulgados pela ANS em cada ano.',
    'eyebrow' => 'ANS · Programa de Qualificação de Operadoras',
    'sub' => 'Índice de Desempenho da Saúde Suplementar',
    'latest' => 'Mais recente',
    'baseYear' => fn($y) => 'Ano-base ' . gen_s($y),
    'view' => 'Visualizar',
    'hist' => 'Histórico do IDSS',
    'jump' => 'Ir para o ano',
    'pickYear' => 'Selecionar ano',
    'allYears' => 'Todos os anos',
    'older' => 'Anos anteriores',
    'olderRange' => $olderRange(' a ', ' anos'),
    'cols' => ['Ano', 'Descrição', 'Nota IDSS', ''],
    'rowCat' => 'Índice de Desempenho da Saúde Suplementar',
    'score' => 'Nota IDSS',
    'docsBack' => 'Voltar para a central de documentos',
    'help' => 'Dúvidas sobre o IDSS? Fale com a <a href="atendimento.html">central de atendimento</a>.',
    'title' => fn($r) => preg_replace('/^IDSS ANO/', 'IDSS ano', gen_s($r['titulo'] ?? null), 1),
    'crumb' => fn($r) => 'IDSS ' . gen_s($r['ano'] ?? null),
    'agrMetaDesc' => fn($r) => gen_s($r['subtitulo'] ?? null) . ': nota ' . gen_s($r['resultado']['nota'] ?? null) . ' da MedicGLOBAL no Índice de Desempenho da Saúde Suplementar, notas por dimensão e resultado divulgado pela ANS.',
    'back' => 'Voltar para o histórico do IDSS',
    'stats' => ['nota' => 'Nota IDSS', 'base' => 'Ano-base', 'acred' => 'Pontuação para operadora acreditada', 'bonus' => 'Indicador bônus'],
    'notInImages' => 'Não consta nas imagens recuperadas',
    'dimsTitle' => 'Notas por dimensão',
    'dimsNote' => 'Valores transcritos do resultado divulgado pela ANS, reproduzido integralmente abaixo. Escala de 0 (pior) a 1 (melhor).',
    'resultTitle' => 'Resultado divulgado pela ANS',
    'imgAlt' => fn($r, $n, $t) => 'Resultado do IDSS ' . gen_s($r['ano'] ?? null) . ' (ano-base ' . gen_s($r['anoBase'] ?? null) . ') da operadora divulgado pela ANS — imagem ' . $n . ' de ' . $t,
    'imgCap' => fn($n, $t) => 'Imagem ' . $n . ' de ' . $t . ' · clique para ampliar',
    'newTab' => ' (abre em nova aba)',
    'missing' => 'Imagem não disponível. No site antigo, esta imagem foi publicada com um endereço temporário (blob:) e não pôde ser recuperada.',
    'truncated' => 'Imagem incompleta no site antigo: o final do arquivo (legenda “Faixas de notas de avaliação”) estava corrompido e foi omitido.',
    'otherYears' => 'Outros anos',
    'prev' => 'Ano anterior',
    'next' => 'Ano seguinte',
    'blocks' => fn($r) => $r['blocos'] ?? [],
  ];
  return [
    'crumbsBase' => [['MedicGLOBAL', 'medicglobal.html'], ['Documents', 'documentos.html']],
    'metaTitle' => 'IDSS — Supplementary Health Performance Index | MedicGLOBAL',
    'metaDesc' => fn($a, $b) => 'MedicGLOBAL (Extremamedic) IDSS history from ' . gen_s($a) . ' to ' . gen_s($b) . ': overall score, scores by dimension and the results published by the ANS each year.',
    'eyebrow' => 'ANS · Operator Qualification Program',
    'sub' => 'Supplementary Health Performance Index',
    'latest' => 'Latest',
    'baseYear' => fn($y) => 'Base year ' . gen_s($y),
    'view' => 'View',
    'hist' => 'IDSS history',
    'jump' => 'Go to year',
    'pickYear' => 'Select year',
    'allYears' => 'All years',
    'older' => 'Previous years',
    'olderRange' => $olderRange(' to ', ' years'),
    'cols' => ['Year', 'Description', 'IDSS score', ''],
    'rowCat' => 'Supplementary Health Performance Index',
    'score' => 'IDSS score',
    'docsBack' => 'Back to the document center',
    'help' => 'Questions about the IDSS? Contact our <a href="atendimento.html">customer service</a>.',
    'title' => fn($r) => 'IDSS ' . gen_s($r['ano'] ?? null),
    'crumb' => fn($r) => 'IDSS ' . gen_s($r['ano'] ?? null),
    'agrMetaDesc' => fn($r) => 'IDSS ' . gen_s($r['ano'] ?? null) . ' (base year ' . gen_s($r['anoBase'] ?? null) . '): MedicGLOBAL\'s score of ' . gen_dot($r['resultado']['nota'] ?? null) . ' in the Supplementary Health Performance Index, scores by dimension and the result published by the ANS.',
    'back' => 'Back to the IDSS history',
    'stats' => ['nota' => 'IDSS score', 'base' => 'Base year', 'acred' => 'Score for accredited operator', 'bonus' => 'Bonus indicator'],
    'notInImages' => 'Not shown in the recovered images',
    'dimsTitle' => 'Scores by dimension',
    'dimsNote' => 'Values transcribed from the result published by the ANS, reproduced in full below. Scale from 0 (worst) to 1 (best).',
    'resultTitle' => 'Result published by the ANS',
    'imgAlt' => fn($r, $n, $t) => 'Operator\'s IDSS ' . gen_s($r['ano'] ?? null) . ' result (base year ' . gen_s($r['anoBase'] ?? null) . ') published by the ANS — image ' . $n . ' of ' . $t . ' (in Portuguese)',
    'imgCap' => fn($n, $t) => 'Image ' . $n . ' of ' . $t . ' (in Portuguese) · click to enlarge',
    'newTab' => ' (opens in a new tab)',
    'missing' => 'Image not available. On the old website, this image was published with a temporary address (blob:) and could not be recovered.',
    'truncated' => 'Incomplete image on the old website: the end of the file (the “score ranges” legend) was corrupted and has been left out.',
    'otherYears' => 'Other years',
    'prev' => 'Previous year',
    'next' => 'Next year',
    'blocks' => function ($r) {
      $out = [];
      foreach (($r['blocos'] ?? []) as $b) {
        if (gen_truthy($b['h2'] ?? null)) { $out[] = ['h2' => 'Supplementary Health Performance Index – IDSS']; continue; }
        if (!gen_truthy($b['p'] ?? null)) { $out[] = $b; continue; }
        $p = gen_s($b['p']);
        $nota = gen_dot($r['resultado']['nota'] ?? null);
        if (preg_match('/^O Índice/u', $p)) { $out[] = ['p' => 'The Supplementary Health Performance Index (IDSS) is part of the Operator Qualification Program (PQO), an initiative developed by the National Supplementary Health Agency (ANS) for the annual assessment of the performance of health plan operators. The IDSS is a composite index made up of a set of indicators grouped into four dimensions, and is calculated from data extracted from the Agency\'s information systems or collected from national health information systems.']; continue; }
        if (preg_match('/clique/u', $p)) {
          if (!preg_match('/href="([^"]*)"/u', $p, $m)) throw new Error("Cannot read properties of null (reading '1')");
          $out[] = ['p' => '"To access the Operator Qualification Program, click <a href="' . $m[1] . '">here</a>." (in Portuguese)']; continue;
        }
        if (preg_match('/^A nota/u', $p)) { $out[] = ['p' => 'Extremamedic\'s score in the IDSS ' . gen_s($r['ano'] ?? null) . ' (base year ' . gen_s($r['anoBase'] ?? null) . ') was ' . (preg_match('/<strong>/', $p) ? '<strong>' . $nota . '</strong>' : $nota) . ', as published by the ANS:']; continue; }
        if (preg_match('/^O Resultado/u', $p)) { $out[] = ['p' => 'Medic Global\'s result was: <strong><u>' . $nota . '</u></strong>']; continue; }
        throw new Exception('Bloco sem tradução (IDSS ' . gen_s($r['ano'] ?? null) . '): ' . $p);
      }
      return $out;
    },
  ];
}

function gen_idss($fs): void {
  $data = json_decode($fs->readFileSync(MG_ROOT . '/src/data/idss.json'), true, 512, JSON_THROW_ON_ERROR);
  $regs = $data['registros'];
  usort($regs, fn($a, $b) => gen_num_cmp($b['ano'] ?? null, $a['ano'] ?? null));
  $file = fn($r) => 'idss-' . gen_s($r['ano'] ?? null) . '.html';
  $NR = count($regs);
  $idxs = array_keys($regs);
  $recentes = gen_slice($idxs, 0, 4); $anteriores = gen_slice($idxs, 4);
  $atual = $regs[0];

  foreach (['pt', 'en'] as $lang) {
    $U = gen_idss_ui($lang); $D = gen_idss_dims($lang);
    $num = fn($n) => $lang === 'en' ? gen_dot($n) : gen_s($n);
    $pages = MG_ROOT . '/src' . ($lang === 'pt' ? '' : '/en') . '/pages';
    foreach ($fs->readdirSync($pages) as $f) if (preg_match('/^idss-\d{4}\.html$/', $f)) $fs->unlinkSync($pages . '/' . $f);
    $intro = array_values(array_filter($U['blocks']($atual), fn($b) => gen_truthy($b['p'] ?? null)));

    $row = function ($i, $ind = '        ') use ($regs, $U, $lang, $num, $file) {
      $r = $regs[$i]; $cur = $i === 0;
      return $ind . '<li class="rj-row' . ($cur ? ' is-current' : '') . '" id="ano-' . gen_s($r['ano'] ?? null) . '">
' . $ind . '  <span class="rj-year">' . gen_s($r['ano'] ?? null) . '</span>
' . $ind . '  <div class="rj-info">
' . $ind . '    <span class="rj-cat">' . $U['rowCat'] . ($cur ? '<span class="rj-badge">' . $U['latest'] . '</span>' : '') . '</span>
' . $ind . '    <span class="rj-period">{{i:calendar}}' . $U['baseYear']($r['anoBase'] ?? null) . '</span>
' . $ind . '    <p class="rj-desc">' . ($lang === 'pt' ? gen_esc($r['descricao'] ?? null) : 'IDSS for ' . gen_s($r['ano'] ?? null) . ' (base year ' . gen_s($r['anoBase'] ?? null) . ')') . '</p>
' . $ind . '  </div>
' . $ind . '  <span class="rj-pct"><span class="sr-only">' . $U['score'] . ': </span>' . $num($r['resultado']['nota'] ?? null) . '</span>
' . $ind . '  <span class="rj-act"><a class="btn btn--sm" href="' . $file($r) . '">{{i:eye}} ' . $U['view'] . '</a></span>
' . $ind . '</li>';
    };
    $meta = ['title' => $U['metaTitle'], 'description' => $U['metaDesc']($regs[$NR - 1]['ano'] ?? null, $regs[0]['ano'] ?? null), 'active' => 'institucional', 'og' => 'old_rn565_banner', 'crumbs' => array_merge($U['crumbsBase'], [['IDSS', 'idss.html']])];
    $fs->writeFileSync($pages . '/idss.html', '<!--@' . gen_json2($meta) . '@-->

<section class="page-hero rn-hero" aria-labelledby="t">
  <div class="rn-hero-bg" aria-hidden="true">{{pic:old_rn565_banner||1600|100vw|eager}}</div>
  <div class="wrap">
    {{crumbs}}
    <div class="grid" style="align-items:end">
      <div class="c-1-7">
        <span class="eyebrow">' . $U['eyebrow'] . '</span>
        <h1 id="t" class="balance">IDSS</h1>
        <p class="lead">' . $U['sub'] . '.</p>
        <p class="idss-intro">' . gen_s($intro[0]['p']) . '</p>
        <p class="idss-intro">' . gen_replace1(gen_s($intro[1]['p']), '<a ', '<a class="accent" target="_blank" rel="noopener" ') . '</p>
      </div>
      <div class="c-8-13">
        <a class="rn-current" href="' . $file($atual) . '">
          <span class="rn-current-top"><span class="rj-badge">' . $U['latest'] . '</span><span>IDSS ' . gen_s($atual['ano'] ?? null) . '</span></span>
          <span class="rn-current-pct">' . $num($atual['resultado']['nota'] ?? null) . '</span>
          <span class="rn-current-period">{{i:calendar}} ' . $U['baseYear']($atual['anoBase'] ?? null) . '</span>
          <span class="rn-current-go">' . $U['view'] . ' {{i:arrow-right}}</span>
        </a>
      </div>
    </div>
  </div>
</section>

<section class="section section--tight" aria-labelledby="idss-hist">
  <div class="wrap">
    <div class="flex-between mb-6" style="align-items:end;gap:16px">
      <h2 id="idss-hist" style="font-size:var(--t-h3)">' . $U['hist'] . '</h2>
      <nav class="rn-years" aria-label="' . $U['jump'] . '">
        <span class="rn-years-label">' . $U['jump'] . '</span>
        <div class="rn-years-seg">
          <details class="rn-years-more">
            <summary>' . $U['pickYear'] . ' {{i:chevron-down}}</summary>
            <div class="rn-years-pop">
              <span class="rn-years-pop-title">' . $U['allYears'] . ' · ' . $U['olderRange']($regs) . '</span>
              <div class="rn-years-grid">' . implode('', array_map(fn($r) => '<a href="#ano-' . gen_s($r['ano'] ?? null) . '">' . gen_s($r['ano'] ?? null) . '</a>', $regs)) . '</div>
            </div>
          </details>
        </div>
      </nav>
    </div>
    <div class="rj rj--agr">
      <div class="rj-head" aria-hidden="true">' . implode('', array_map(fn($c) => '<span>' . $c . '</span>', $U['cols'])) . '</div>
      <ol class="rj-list" aria-label="' . $U['hist'] . '">
' . implode("\n", array_map(fn($i) => $row($i), $recentes)) . '
      </ol>
      <details class="rj-older">
        <summary><span class="rj-older-title">{{i:layers}} ' . $U['older'] . ' <small>' . $U['olderRange'](array_map(fn($i) => $regs[$i], $anteriores)) . '</small></span><span class="rj-chev">{{i:chevron-down}}</span></summary>
        <ol class="rj-list" aria-label="' . $U['older'] . '">
' . implode("\n", array_map(fn($i) => $row($i, '          '), $anteriores)) . '
        </ol>
      </details>
    </div>
    <p class="small mt-7">' . $U['help'] . '</p>
    <a class="news-back mt-6" href="documentos.html">{{i:chevron-left}} ' . $U['docsBack'] . '</a>
  </div>
</section>
');

    foreach ($regs as $i => $r) {
      $newer = $i > 0 ? $regs[$i - 1] : null;
      $older = $regs[$i + 1] ?? null;
      $res = $r['resultado'] ?? [];
      $blocos = $U['blocks']($r);
      $isImg = fn($b) => gen_truthy($b['img'] ?? null) || gen_truthy($b['faltando'] ?? null);
      $total = count(array_filter($blocos, $isImg));
      $n = 0;
      $corpo = [];
      foreach ($blocos as $b) {
        if (gen_truthy($b['h2'] ?? null)) { $corpo[] = '        <h2 class="idss-h2">' . gen_esc($b['h2']) . '</h2>'; continue; }
        if (gen_truthy($b['p'] ?? null)) { $corpo[] = '        <p>' . str_replace('<a ', '<a target="_blank" rel="noopener" ', gen_s($b['p'])) . '</p>'; continue; }
        $n++;
        if (gen_truthy($b['faltando'] ?? null)) { $corpo[] = '        <div class="idss-missing" role="note">{{i:info}}<p><strong>' . explode(' · ', $U['imgCap']($n, $total))[0] . '</strong> — ' . $U['missing'] . '</p></div>'; continue; }
        $src = gen_s($b['img'] ?? null); $alt = $U['imgAlt']($r, $n, $total);
        $corpo[] = '        <figure class="idss-fig">
          <a href="' . $src . '" target="_blank" rel="noopener"><img src="' . $src . '" alt="' . $alt . '" loading="' . ($n === 1 ? 'eager' : 'lazy') . '" decoding="async"><span class="sr-only">' . $U['newTab'] . '</span></a>
          <figcaption>' . $U['imgCap']($n, $total) . '</figcaption>' . (gen_truthy($b['truncada'] ?? null) ? '
          <div class="idss-missing idss-missing--sm" role="note">{{i:info}}<p>' . $U['truncated'] . '</p></div>' : '') . '
        </figure>';
      }
      $firstImg = -1;
      foreach ($blocos as $k => $b) if ($isImg($b)) { $firstImg = $k; break; }
      $at = $firstImg >= 0 ? $firstImg : max(0, count($corpo) - 1); // splice(-1, 0, x) do JS
      array_splice($corpo, $at, 0, ['        <h3 class="idss-h3">' . $U['resultTitle'] . '</h3>']);
      $meta = [
        'title' => $U['title']($r) . ' — ' . $U['sub'] . ' | MedicGLOBAL',
        'description' => $U['agrMetaDesc']($r),
        'active' => 'institucional',
        'og' => 'old_rn565_banner',
        'crumbs' => array_merge($U['crumbsBase'], [['IDSS', 'idss.html'], [$U['crumb']($r), $file($r)]]),
      ];
      $flag = fn($v) => gen_truthy($v) ? gen_esc($v) : '<span class="review-flag">' . $U['notInImages'] . '</span>';
      $acred = $res['acred'] ?? null; $bonus = $res['bonus'] ?? null;
      if ($lang === 'en' && gen_truthy($acred)) $acred = gen_replace1(gen_replace1(gen_s($acred), 'Operadora não Acreditada', 'Non-accredited operator'), 'Operadora não bonificada', 'Operator without bonus');
      if ($lang === 'en' && gen_truthy($bonus)) $bonus = gen_replace1(gen_replace1(gen_replace1(gen_s($bonus), 'Operadora não pontuada', 'Operator not scored'), 'Operadora não bonificada', 'Operator without bonus'), ',', '.');
      $h = $lang === 'en' ? (gen_truthy($r['conteudoEn'] ?? null) ? $r['conteudoEn'] : ($r['conteudo'] ?? null)) : ($r['conteudo'] ?? null);
      $richHtml = gen_truthy($h) ? "        <div class=\"doc-rich mt-8\">\n" . gen_s($h) . "\n        </div>\n" : '';
      $ano = gen_s($r['ano'] ?? null);
      $html = '<!--@' . gen_json2($meta) . '@-->

<article class="news agr idss">
  <header class="page-hero" style="padding-bottom:0">
    <div class="wrap">
      {{crumbs}}
      <a class="news-back" href="idss.html#ano-' . $ano . '">{{i:chevron-left}} ' . $U['back'] . '</a>
      <div class="post-meta mb-6"><span class="cat">IDSS</span><span>' . $U['sub'] . '</span>' . ($i === 0 ? '<span class="src-tag">' . $U['latest'] . '</span>' : '') . '</div>
    </div>
  </header>
  <!-- Título fixo: fica logo abaixo do menu durante toda a leitura (compacto ao fixar; ver main.js) -->
  <div class="agr-titlebar" data-agr-titlebar>
    <div class="wrap"><h1 class="balance agr-title">' . $U['title']($r) . '</h1><p class="agr-sub">' . ($lang === 'pt' ? gen_esc($r['subtitulo'] ?? null) : 'IDSS for ' . $ano . ' (base year ' . gen_s($r['anoBase'] ?? null) . ')') . '</p></div>
  </div>
  <div class="wrap">
    <figure class="news-figure">
      <div class="img-round agr-cover">
        {{pic:old_rn565_banner||2000|(min-width:1360px) 1300px, 100vw|eager}}
        <div class="agr-cover-txt" aria-hidden="true">
          <span class="agr-cover-eyebrow">IDSS · ' . $U['baseYear']($r['anoBase'] ?? null) . '</span>
          <span class="agr-cover-year">' . $ano . '</span>
          <span class="agr-cover-pct">' . $U['score'] . ' ' . $num($res['nota'] ?? null) . '</span>
        </div>
      </div>
    </figure>
  </div>
  <div class="section section--tight">
    <div class="wrap">
      <div class="news-body">
        <dl class="agr-stats">
          <div><dt>' . $U['stats']['nota'] . '</dt><dd>' . $num($res['nota'] ?? null) . '</dd></div>
          <div><dt>' . $U['stats']['base'] . '</dt><dd>' . gen_s($r['anoBase'] ?? null) . '</dd></div>
          <div><dt>' . $U['stats']['acred'] . '</dt><dd class="idss-dd-sm">' . $flag($acred) . '</dd></div>
          <div><dt>' . $U['stats']['bonus'] . '</dt><dd class="idss-dd-sm">' . $flag($bonus) . '</dd></div>
        </dl>

        <section class="mt-8" aria-labelledby="dim-t">
          <h2 id="dim-t" class="mb-6" style="font-size:var(--t-h3)">' . $U['dimsTitle'] . '</h2>
          <ol class="idss-dims">
' . implode("\n", array_map(fn($d, $k) => '            <li><span class="idss-dim-n">' . ($k + 1) . '</span><div><strong>' . $d[0] . ' · ' . $d[1] . '</strong><p>' . $d[2] . '</p></div><span class="idss-dim-v">' . $num($res['dim'][$k] ?? null) . '</span></li>', $D, array_keys($D))) . '
          </ol>
          <p class="xs muted mt-5">' . $U['dimsNote'] . '</p>
        </section>

' . $richHtml . '        <div class="idss-orig mt-8">
' . implode("\n", $corpo) . '
        </div>

        <nav class="agr-nav mt-8" aria-label="' . $U['otherYears'] . '">
          ' . ($older !== null ? '<a class="agr-nav-step" href="' . $file($older) . '" rel="prev">{{i:chevron-left}}<span><small>' . $U['prev'] . '</small>' . gen_s($older['ano'] ?? null) . '</span></a>' : '<span></span>') . '
          ' . ($newer !== null ? '<a class="agr-nav-step agr-nav-step--next" href="' . $file($newer) . '" rel="next"><span><small>' . $U['next'] . '</small>' . gen_s($newer['ano'] ?? null) . '</span>{{i:chevron-right}}</a>' : '<span></span>') . '
        </nav>
        <div class="agr-years mt-6"><span class="agr-years-label">' . $U['otherYears'] . ':</span>' . implode('', array_map(fn($oi) => $oi === $i ? '<span aria-current="page">' . gen_s($regs[$oi]['ano'] ?? null) . '</span>' : '<a href="' . $file($regs[$oi]) . '">' . gen_s($regs[$oi]['ano'] ?? null) . '</a>', $idxs)) . '</div>
        <p class="small mt-7">' . $U['help'] . '</p>
        <a class="news-back mt-6" href="idss.html#ano-' . $ano . '">{{i:chevron-left}} ' . $U['back'] . '</a>
      </div>
    </div>
  </div>
</article>
';
      $fs->writeFileSync($pages . '/' . $file($r), $html);
    }
  }
}

// o original (JS) falha com lista vazia em olderRange (l[l.length - 1].ano): mantém o mesmo comportamento
function gen_nonempty(array $l): string {
  if (!count($l)) throw new Error("Cannot read properties of undefined (reading 'ano')");
  return '';
}
