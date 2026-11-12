<?php
/* Gerador do site (equivale a build.js): lê src/partials + src/pages, aplica o conteúdo do painel por cima
   (em memória: src/ nunca é alterado) e grava as páginas HTML em outDir. Mesma saída do build.js. */
require_once __DIR__ . '/CmsHtml.php';
require_once __DIR__ . '/generators.php';

const MG_LANGS = [
  'pt' => ['dir' => '', 'pages' => '/src/pages', 'html' => 'pt-BR', 'og' => 'pt_BR', 'home' => 'Início', 'crumbsLabel' => 'Você está em', 'ldLang' => 'Portuguese'],
  'en' => ['dir' => 'en', 'pages' => '/src/en/pages', 'html' => 'en', 'og' => 'en_US', 'home' => 'Home', 'crumbsLabel' => 'You are here', 'ldLang' => 'English'],
];
// páginas que os geradores recriam a cada build
const MG_GENERATED = '/^(noticia-.+|rn565(-agrupamento-\d{4})?|idss(-\d{4})?|mapa-de-migracao)\.html$/';
function lang_pages($lang) { return MG_ROOT . MG_LANGS[$lang]['pages']; }

function norm_path($p) {
  $p = str_replace('\\', '/', $p);
  $out = [];
  foreach (explode('/', $p) as $i => $seg) {
    if ($seg === '..') { array_pop($out); continue; }
    if ($seg === '.' || ($seg === '' && $i > 0)) continue;
    $out[] = $seg;
  }
  return implode('/', $out);
}

/* Sistema de arquivos "por cima" de src/: o que os geradores gravam em src/ fica em memória, e os dados editados
   (noticias.json, rn565.json, idss.json) substituem os do repositório só neste build. */
final class OverlayFs {
  private $files = [], $gone = [], $data;
  function __construct($dataFiles) { $this->data = []; foreach ($dataFiles as $k => $v) $this->data[norm_path($k)] = $v; }
  private function inSrc($k) { return str_starts_with($k, norm_path(MG_ROOT . '/src') . '/'); }
  function readFileSync($p, $enc = null) {
    $k = norm_path($p);
    if (array_key_exists($k, $this->files)) return $this->files[$k];
    if (array_key_exists($k, $this->data)) return $this->data[$k];
    if (isset($this->gone[$k])) throw new RuntimeException('ENOENT ' . $p);
    $s = @file_get_contents($p);
    if ($s === false) throw new RuntimeException('ENOENT ' . $p);
    return $s;
  }
  function writeFileSync($p, $s) { $k = norm_path($p); if (!$this->inSrc($k)) throw new RuntimeException('Gravação fora de src/ no build do painel: ' . $p); $this->files[$k] = (string)$s; unset($this->gone[$k]); }
  function existsSync($p) { $k = norm_path($p); return array_key_exists($k, $this->files) || (!isset($this->gone[$k]) && file_exists($p)); }
  function mkdirSync($p, $o = null) {}
  function unlinkSync($p) { $k = norm_path($p); unset($this->files[$k]); if ($this->inSrc($k)) $this->gone[$k] = true; }
  function readdirSync($d) {
    $k = norm_path($d);
    $real = is_dir($d) ? array_values(array_filter(array_diff(scandir($d), ['.', '..']), fn($f) => !isset($this->gone[$k . '/' . $f]))) : [];
    $extra = [];
    foreach (array_keys($this->files) as $f) if (dirname($f) === $k) $extra[] = basename($f);
    $all = array_values(array_unique(array_merge($real, $extra)));
    usort($all, 'js_cmp');
    return $all;
  }
}
// sistema de arquivos real (build sem painel)
final class RealFs {
  function readFileSync($p, $enc = null) { $s = @file_get_contents($p); if ($s === false) throw new RuntimeException('ENOENT ' . $p); return $s; }
  function writeFileSync($p, $s) { file_put_contents($p, (string)$s); }
  function existsSync($p) { return file_exists($p); }
  function mkdirSync($p, $o = null) { if (!is_dir($p)) mkdir($p, 0777, true); }
  function unlinkSync($p) { @unlink($p); }
  function readdirSync($d) { $l = array_values(array_diff(scandir($d), ['.', '..'])); usort($l, 'js_cmp'); return $l; }
}
// ordenação padrão do Array.sort do JavaScript (por unidades UTF-16; para nomes de arquivo ASCII = strcmp)
function js_cmp($a, $b) { return strcmp(mb_convert_encoding((string)$a, 'UTF-16BE', 'UTF-8'), mb_convert_encoding((string)$b, 'UTF-16BE', 'UTF-8')); }

// mesclagem do build.js (deepMerge): objetos são mesclados; listas e valores simples substituem
function deep_merge($a, $b) {
  if (!is_array($b) || ($b !== [] && array_is_list($b))) return $b;
  $out = is_array($a) ? $a : [];
  foreach ($b as $k => $v) $out[$k] = (is_array($a) && isset($a[$k]) && is_array($a[$k]) && ($a[$k] === [] || !array_is_list($a[$k]))) ? deep_merge($a[$k], $v) : $v;
  return $out;
}

/* Endereço: rua, bairro, cidade, UF e CEP são a fonte; quando o painel muda uma dessas partes, o texto completo
   (rodapé) e os links do mapa são remontados. */
function derive_addresses(&$site, $over) {
  foreach (($site['address'] ?? []) as $k => $a) {
    $o = $over['address'][$k] ?? [];
    $any = false; foreach (['street', 'district', 'city', 'state', 'zip'] as $p) if (array_key_exists($p, $o)) $any = true;
    if (!$any) continue;
    $q = "{$a['street']} - " . (!empty($a['district']) ? $a['district'] . ', ' : '') . "{$a['city']}, {$a['state']}, {$a['zip']}";
    if (!array_key_exists('full', $o)) $site['address'][$k]['full'] = implode(' · ', array_filter([$a['street'], $a['district'] ?? '', "{$a['city']}/{$a['state']}", "CEP {$a['zip']}"], fn($x) => $x !== '' && $x !== null));
    if (!array_key_exists('maps', $o)) $site['address'][$k]['maps'] = 'https://www.google.com/maps/search/?api=1&query=' . str_replace('%20', '+', enc_uri($q));
    if (!array_key_exists('embed', $o)) $site['address'][$k]['embed'] = 'https://www.google.com/maps?q=' . str_replace(['%20', '%2C'], ['+', ','], enc_uri($q)) . '&output=embed';
  }
}

function base_site() { static $s = null; return $s ??= json_decode(file_get_contents(MG_ROOT . '/src/data/site.json'), true); }

/* Fontes do site já com o conteúdo do painel: usado pelo build e pelo painel (para listar os campos editáveis). */
function load_sources($content) {
  $content = $content ?: [];
  $site = deep_merge(base_site(), $content['site'] ?? []);
  derive_addresses($site, $content['site'] ?? []);
  $dataFiles = [];
  if (!empty($content['noticias'])) $dataFiles[MG_ROOT . '/src/data/noticias.json'] = je($content['noticias']);
  if (!empty($content['rn565'])) $dataFiles[MG_ROOT . '/src/data/rn565.json'] = je($content['rn565']);
  if (!empty($content['idss'])) $dataFiles[MG_ROOT . '/src/data/idss.json'] = je($content['idss']);
  $vfs = ($content['virtual'] ?? null) === false ? new RealFs() : new OverlayFs($dataFiles);
  gen_migracao($vfs);
  gen_noticias($vfs);
  gen_rn565($vfs);
  gen_idss($vfs);
  return ['site' => $site, 'vfs' => $vfs];
}

function mg_icons() {
  static $icons = null;
  if ($icons !== null) return $icons;
  $icons = [];
  preg_match_all("/^\s*(?:\"([\w-]+)\"|([\w-]+))\s*:\s*'([^']*)',?\s*$/m", file_get_contents(MG_ROOT . '/src/data/icons.js'), $m, PREG_SET_ORDER);
  foreach ($m as $x) $icons[$x[1] !== '' ? $x[1] : $x[2]] = $x[3];
  return $icons;
}

// largura de um JPEG (lê o cabeçalho SOF), para o srcset das fotos locais
function jpeg_width($file) {
  $b = @file_get_contents($file);
  if ($b === false || strlen($b) < 4 || ord($b[0]) !== 0xff || ord($b[1]) !== 0xd8) return null;
  for ($i = 2; $i + 9 < strlen($b);) {
    if (ord($b[$i]) !== 0xff) return null;
    $m = ord($b[$i + 1]); $len = unpack('n', substr($b, $i + 2, 2))[1];
    if ($m >= 0xc0 && $m <= 0xcf && $m !== 0xc4 && $m !== 0xc8 && $m !== 0xcc) return unpack('n', substr($b, $i + 7, 2))[1];
    $i += 2 + $len;
  }
  return null;
}

final class SiteBuild {
  private $content, $site, $vfs, $pagesEdit, $identity, $report = ['orphans' => []], $LANG = 'pt', $ver = [];

  /* opts: content (conteúdo do painel ou null), outDir, only ([lang, file]) */
  static function run($opts = []) { return (new self())->build($opts); }

  private function withEdits($key, $raw) {
    $e = $this->pagesEdit[$key] ?? null;
    if (!$e || empty($e['edits'])) return $raw;
    $r = CmsHtml::apply($raw, $e['edits']);
    if ($r['orphans']) $this->report['orphans'][$key] = $r['orphans'];
    return $r['html'];
  }
  private function partial($n) {
    $en = MG_ROOT . "/src/en/partials/$n.html";
    $useEn = $this->LANG === 'en' && $this->vfs->existsSync($en);
    $raw = $this->vfs->readFileSync($useEn ? $en : MG_ROOT . "/src/partials/$n.html");
    return $this->withEdits('partial/' . ($useEn ? 'en' : 'pt') . "/$n", $raw);
  }
  private function photoPath($key) { return str_starts_with($key, 'up:') ? 'assets/uploads/' . substr($key, 3) : ($this->site['photos'][$key] ?? null); }
  private function pic($spec) {
    $p = explode('|', $spec);
    $key = $p[0]; $alt = $p[1] ?? ''; $w = $p[2] ?? '1400'; $sizes = $p[3] ?? '100vw'; $eager = $p[4] ?? '';
    $id = $this->photoPath($key);
    if (!$id) throw new RuntimeException('Foto desconhecida: ' . $key);
    $load = $eager !== '' ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    if (str_starts_with($id, 'assets/')) {
      $small = preg_replace('/(\.\w+)$/', '-800$1', $id, 1);
      $natural = file_exists(MG_ROOT . '/' . $small) ? jpeg_width(MG_ROOT . '/' . $id) : null;
      $set = $natural ? " srcset=\"$small 800w, $id {$natural}w\" sizes=\"$sizes\"" : '';
      return "<img src=\"$id\"$set alt=\"$alt\" $load decoding=\"async\">";
    }
    $max = (int) $w;
    $widths = array_values(array_filter([480, 800, 1200, 1600, 2000], fn($x) => $x <= $max));
    if (!in_array($max, $widths, true)) $widths[] = $max;
    $u = fn($x) => "https://images.unsplash.com/photo-$id?auto=format&fit=crop&w=$x&q=72";
    return '<img src="' . $u(min($max, 1200)) . '" srcset="' . implode(', ', array_map(fn($x) => $u($x) . " {$x}w", $widths)) . "\" sizes=\"$sizes\" alt=\"$alt\" $load decoding=\"async\">";
  }
  // versão nos endereços de CSS/JS locais (?v=hash do conteúdo)
  private function bust($html) {
    return preg_replace_callback('/(href|src)="(assets\/(?:css|js)\/[\w.-]+\.(?:css|js))"/', function ($m) {
      $file = $m[2];
      if (!isset($this->ver[$file])) $this->ver[$file] = substr(md5_file(MG_ROOT . '/' . $file), 0, 8);
      return "{$m[1]}=\"$file?v={$this->ver[$file]}\"";
    }, $html);
  }
  private function ogImage($key) {
    $id = $this->photoPath($key);
    if (!$id) throw new RuntimeException('Foto desconhecida (og): ' . $key);
    return str_starts_with($id, 'assets/') ? $this->site['domain'] . $id : "https://images.unsplash.com/photo-$id?auto=format&fit=crop&w=1200&h=630&q=70";
  }
  private function get($k) {
    $pick = function ($src) use ($k) { foreach (explode('.', $k) as $p) { if (!is_array($src) || !array_key_exists($p, $src)) return [false, null]; $src = $src[$p]; } return [true, $src]; };
    [$okEn, $vEn] = $this->LANG === 'en' ? $pick($this->site['en'] ?? null) : [false, null];
    [$ok, $v] = $okEn ? [true, $vEn] : $pick($this->site);
    if (!$ok) throw new RuntimeException('Dado ausente em site.json: ' . $k);
    return js_str($v);
  }
  private function render($tpl, $ctx) {
    $out = $tpl; $icons = mg_icons();
    for ($i = 0; $i < 4; $i++) {
      $out = preg_replace_callback('/\{\{>\s*([\w-]+)\s*\}\}/', fn($m) => $this->partial($m[1]), $out);
      $out = preg_replace_callback('/\{\{i:([\w-]+)\}\}/', function ($m) use ($icons) {
        if (!isset($icons[$m[1]])) throw new RuntimeException('Ícone desconhecido: ' . $m[1]);
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' . $icons[$m[1]] . '</svg>';
      }, $out);
      $out = preg_replace_callback('/\{\{pic:([^}]+)\}\}/', fn($m) => $this->pic($m[1]), $out);
      $out = preg_replace_callback('/\{\{photo:([\w-]+):(\d+)\}\}/', fn($m) => 'https://images.unsplash.com/photo-' . js_str($this->site['photos'][$m[1]] ?? null) . "?auto=format&fit=crop&w={$m[2]}&q=70", $out);
      $out = preg_replace_callback('/\{\{act:([\w-]+)\}\}/', fn($m) => ($ctx['active'] === $m[1] ? ' is-active' : ''), $out);
      $out = preg_replace_callback('/\{\{cur:([\w-]+)\}\}/', fn($m) => ($ctx['active'] === $m[1] ? ' aria-current="page"' : ''), $out);
      $out = preg_replace_callback('/\{\{L\.([\w.]+)\}\}/', fn($m) => $this->get($m[1]), $out);
      $out = preg_replace_callback('/\{\{([\w]+)\}\}/', fn($m) => array_key_exists($m[1], $ctx) ? $ctx[$m[1]] : $m[0], $out);
    }
    if (preg_match('/\{\{[^}]+\}\}/', $out, $left)) throw new RuntimeException("Token não resolvido em {$ctx['file']}: {$left[0]}");
    return $out;
  }
  // identidade visual e integrações configuradas no painel (logo, favicon, Google Analytics, envio de formulários)
  private function finish($html) {
    $id = $this->identity;
    if (!empty($id['logo'])) $html = preg_replace('/(<img class="logo-img logo-img--pos" src=")[^"]+(" )width="\d+" height="\d+"/', '${1}' . $id['logo']['path'] . '${2}width="' . $id['logo']['w'] . '" height="' . $id['logo']['h'] . '"', $html);
    if (!empty($id['logoNeg'])) $html = preg_replace('/(<img class="logo-img logo-img--neg" src=")[^"]+(" )width="\d+" height="\d+"/', '${1}' . $id['logoNeg']['path'] . '${2}width="' . $id['logoNeg']['w'] . '" height="' . $id['logoNeg']['h'] . '"', $html);
    if (!empty($id['favicon'])) $html = preg_replace('/<link rel="icon" href="[^"]+" type="[^"]+">/', str_replace('$', '\$', '<link rel="icon" href="' . $id['favicon']['path'] . '" type="' . $id['favicon']['type'] . '">'), $html, 1);
    if (!empty($id['faviconPng'])) $html = preg_replace('/<link rel="apple-touch-icon" href="[^"]+">/', str_replace('$', '\$', '<link rel="apple-touch-icon" href="' . $id['faviconPng']['path'] . '">'), $html, 1);
    if ($this->content) {
      // na visualização do rascunho não há coleta nem envio de formulários
      $a = $this->content['analytics'] ?? []; $live = empty($this->content['preview']);
      $cfg = ['ga' => $live && !empty($a['enabled']) && !empty($a['measurementId']) ? $a['measurementId'] : '', 'gtm' => $live && !empty($a['enabled']) && !empty($a['gtmId']) ? $a['gtmId'] : '', 'forms' => $live,
        // hospedagem PHP: os formulários são enviados para o painel em /admin/api.php/forms/<nome> (sem URL Rewrite)
        'formsUrl' => MG_API . '/forms/'];
      $mb = ($this->content['forms']['trabalhe_conosco']['maxUploadMB'] ?? null) ?: 1024;
      $html = preg_replace('/data-max-bytes="\d+"/', 'data-max-bytes="' . ($mb * 1048576) . '"', $html);
      $pos = strpos($html, '</head>');
      if ($pos !== false) $html = substr_replace($html, '<script>window.MG_CFG=' . je($cfg) . "</script>\n</head>", $pos, 7);
    }
    return $html;
  }

  private function build($opts) {
    $this->content = $opts['content'] ?? null;
    $outDir = rtrim(str_replace('\\', '/', $opts['outDir'] ?? MG_ROOT), '/');
    $only = $opts['only'] ?? null;
    $src = load_sources($this->content ? array_merge($this->content, ['virtual' => true]) : ['virtual' => false]);
    $this->site = $src['site']; $this->vfs = $vfs = $src['vfs'];
    $this->pagesEdit = $this->content['pages'] ?? [];
    $this->identity = $this->content['identity'] ?? [];
    $site = $this->site;
    $sitemap = []; $written = [];
    $pageUrl = fn($lang, $file) => $site['domain'] . (MG_LANGS[$lang]['dir'] ? MG_LANGS[$lang]['dir'] . '/' : '') . ($file === 'index.html' ? '' : preg_replace('/.html$/', '/', $file, 1));
    $hasPage = fn($lang, $file) => $vfs->existsSync(lang_pages($lang) . '/' . $file);

    foreach (array_keys(MG_LANGS) as $lang) {
      $this->LANG = $lang;
      $L = MG_LANGS[$lang]; $other = $lang === 'pt' ? 'en' : 'pt';
      if ($only && $only[0] !== $lang) continue;
      $langOut = $outDir . ($L['dir'] ? '/' . $L['dir'] : '');
      if (!is_dir($langOut)) mkdir($langOut, 0777, true);
      $files = $vfs->existsSync(lang_pages($lang)) ? array_values(array_filter($vfs->readdirSync(lang_pages($lang)), fn($f) => str_ends_with($f, '.html'))) : [];
      // remove páginas em inglês que deixaram de existir na fonte
      if ($L['dir'] && !$only) foreach (scandir($langOut) as $f) if (str_ends_with($f, '.html') && !in_array($f, $files, true)) @unlink("$langOut/$f");

      foreach ($files as $file) {
        if ($only && $only[1] !== $file) continue;
        if ($this->content && $file === 'mapa-de-migracao.html') continue; // interno, não vai para o site publicado
        $raw = $vfs->readFileSync(lang_pages($lang) . '/' . $file);
        if (!preg_match('/^<!--@([\s\S]*?)@-->\s*/', $raw, $m)) throw new RuntimeException("Página sem cabeçalho de metadados: $lang/$file");
        $pageKey = "$lang/$file";
        $meta = array_merge(json_decode($m[1], true), $this->pagesEdit[$pageKey]['meta'] ?? []);
        $body = $this->withEdits($pageKey, substr($raw, strlen($m[0])));
        $url = $pageUrl($lang, $file);
        $twin = $hasPage($other, $file);
        $toOther = ($lang === 'pt' ? 'en/' : '../') . ($twin ? $file : 'index.html');
        $hrefPt = $lang === 'pt' ? $file : $toOther; $hrefEn = $lang === 'en' ? $file : $toOther;
        $alternates = $twin && empty($meta['noindex'])
          ? implode("\n", array_map(fn($x) => "<link rel=\"alternate\" hreflang=\"{$x[0]}\" href=\"{$x[1]}\">", [['pt-BR', $pageUrl('pt', $file)], ['en', $pageUrl('en', $file)], ['x-default', $pageUrl('pt', $file)]]))
          : '';
        $crumbs = $meta['crumbs'] ?? [];
        $crumbHtml = $crumbs
          ? "<nav aria-label=\"{$L['crumbsLabel']}\"><ol class=\"crumbs\"><li><a href=\"index.html\">{$L['home']}</a></li>" . implode('', array_map(fn($c, $i) => $i === count($crumbs) - 1 ? "<li><span aria-current=\"page\">{$c[0]}</span></li>" : "<li><a href=\"{$c[1]}\">{$c[0]}</a></li>", $crumbs, array_keys($crumbs))) . '</ol></nav>'
          : '';
        $ld = [[
          '@context' => 'https://schema.org',
          '@type' => 'Organization',
          'name' => 'MedicGLOBAL',
          'alternateName' => ['Medic Global', 'Medic Global Saúde', 'Extremamedic'],
          'url' => $site['domain'],
          'logo' => $site['domain'] . (!empty($this->identity['logo']) ? $this->identity['logo']['path'] : 'assets/img/brand/logo-medicglobal-saude.png'),
          'address' => array_values(array_map(fn($a) => ['@type' => 'PostalAddress', 'streetAddress' => $a['street'] . (!empty($a['district']) ? ' - ' . $a['district'] : ''), 'addressLocality' => $a['city'], 'addressRegion' => $a['state'], 'postalCode' => $a['zip'], 'addressCountry' => 'BR'], $site['address'])),
          'contactPoint' => [['@type' => 'ContactPoint', 'telephone' => $site['phones']['central']['e164'], 'contactType' => 'customer service', 'areaServed' => 'BR', 'availableLanguage' => ['Portuguese']]],
        ]];
        if ($crumbs) {
          $items = array_merge([[$L['home'], '']], $crumbs);
          $ld[] = ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => array_map(fn($c, $i) => ['@type' => 'ListItem', 'position' => $i + 1, 'name' => $c[0], 'item' => $site['domain'] . ($L['dir'] ? $L['dir'] . '/' : '') . (!empty($c[1]) ? preg_replace('/\.html.*$/s', '/', $c[1], 1) : '')], $items, array_keys($items))];
        }
        if (!empty($meta['jsonld'])) foreach ($meta['jsonld'] as $x) $ld[] = $x;
        $ctx = [
          'file' => $file, 'lang' => $lang, 'htmlLang' => $L['html'], 'ogLocale' => $L['og'], 'ogLocaleAlt' => MG_LANGS[$other]['og'],
          'alternates' => $alternates, 'hrefPt' => $hrefPt, 'hrefEn' => $hrefEn,
          'langRedirect' => $twin ? "<script>try{var l=localStorage.getItem(\"mg-lang\");if(l&&l!==\"$lang\")location.replace(\"$toOther\"+location.hash)}catch(e){}</script>" : '',
          'active' => js_str($meta['active'] ?? ''), // título e descrição entram em atributos (content="…"): aspas escapadas (vale para o SEO editado no painel e para as notícias)
          'title' => str_replace('"', '&quot;', js_str($meta['title'] ?? null)), 'description' => str_replace('"', '&quot;', js_str($meta['description'] ?? null)),
          'canonical' => $url, 'ogImage' => $this->ogImage(($meta['og'] ?? '') ?: 'old_familia'), 'crumbs' => $crumbHtml,
          'headerClass' => !empty($meta['headerDark']) ? ' on-dark' : '', 'bodyClass' => js_str($meta['bodyClass'] ?? ''),
          'jsonld' => '<script type="application/ld+json">' . je(count($ld) === 1 ? $ld[0] : $ld) . '</script>',
          'extraHead' => js_str($meta['extraHead'] ?? ''), 'extraScripts' => js_str($meta['extraScripts'] ?? ''),
          'year' => date('Y'), 'robots' => !empty($meta['noindex']) ? 'noindex, nofollow' : 'index, follow',
        ];
        $html = $this->finish($this->bust($this->render($this->partial('layout'), array_merge($ctx, ['content' => $body]))));
        // em /en/ os arquivos estáticos ficam um nível acima
        if ($L['dir']) {
          $html = preg_replace('/(href|src)="assets\//', '$1="../assets/', $html);
          $html = preg_replace_callback('/srcset="([^"]*)"/', fn($mm) => 'srcset="' . preg_replace('/(^|,\s*)assets\//', '$1../assets/', $mm[1]) . '"', $html);
        }
        file_put_contents("$langOut/$file", $html);
        $written[($L['dir'] ? $L['dir'] . '/' : '') . $file] = true;
        if (empty($meta['noindex'])) $sitemap[] = $url;
      }
    }
    if ($only) return $this->report;
    $this->LANG = 'pt';
    // no build do painel para outra pasta, ela só tem o que o build acabou de gerar (notícia removida some do site)
    $sameAsRoot = realpath($outDir) === realpath(MG_ROOT);
    if (!$sameAsRoot) foreach (scandir($outDir) as $f) if (str_ends_with($f, '.html') && !isset($written[$f])) @unlink("$outDir/$f");
    // publicando na própria raiz do projeto: notícias/anos removidos no painel também saem do site
    if ($sameAsRoot && $this->content) foreach (scandir($outDir) as $f) if (preg_match(MG_GENERATED, $f) && $f !== 'mapa-de-migracao.html' && !isset($written[$f])) @unlink("$outDir/$f");
    file_put_contents("$outDir/sitemap.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" . implode("\n", array_map(fn($u) => "  <url><loc>$u</loc></url>", $sitemap)) . "\n</urlset>\n");
    file_put_contents("$outDir/robots.txt", "User-agent: *\nAllow: /\nDisallow: /mapa-de-migracao.html\nDisallow: /admin\nSitemap: {$site['domain']}sitemap.xml\n");
    return $this->report;
  }
}
