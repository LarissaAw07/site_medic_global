<?php
/* Leitura e edição do conteúdo das páginas (parte de cms/server.js): fontes e campos editáveis, gravação do rascunho,
   dados compartilhados ({{L.x}}), textos repetidos, versão em inglês, notícias e documentos anuais (RN 565 / IDSS). */

// partials editáveis (componentes repetidos em várias páginas). Menu e rodapé (layout) ficam fora, por definição.
const PARTIALS = ['plan-cards' => 'Cards dos planos', 'store-buttons' => 'Botões das lojas de aplicativo'];
// ordem do site (sequência do menu principal)
const SITE_ORDER = [
  ['index.html', 'Início'], ['beneficiario.html', 'Para você'], ['planos.html', 'Planos'], ['rede-credenciada.html', 'Rede de cuidado'], ['area-do-beneficiario.html', 'Para você'], ['guia-medico.html', 'Rede de cuidado'],
  ['telemedicina.html', 'Serviços'], ['servicos.html', 'Serviços'], ['atendimento.html', 'Atendimento'], ['contato.html', 'Atendimento'],
  ['medicglobal.html', 'MedicGLOBAL'], ['trabalhe-conosco.html', 'MedicGLOBAL'], ['documentos.html', 'MedicGLOBAL'],
  ['conteudos.html', 'Conteúdos'], ['artigo-reajuste-2020.html', 'Conteúdos'], ['privacidade.html', 'Rodapé'], ['404.html', 'Página de erro'],
];
const DOC_GROUPS = ['rn565' => 'Reajuste de contratos (RN 565)', 'idss' => 'IDSS'];
const GROUP_ORDER = ['Páginas do site', 'Componentes compartilhados', 'Reajuste de contratos (RN 565)', 'IDSS', 'Outras'];
const PAGE_NAMES = ['index.html' => 'Página inicial', 'planos.html' => 'Planos', 'rede-credenciada.html' => 'Rede credenciada', 'guia-medico.html' => 'Guia médico', 'telemedicina.html' => 'Telemedicina', 'servicos.html' => 'Serviços', 'beneficiario.html' => 'Área do beneficiário', 'area-do-beneficiario.html' => 'Acesso à Área do Beneficiário', 'atendimento.html' => 'Atendimento e ouvidoria', 'contato.html' => 'Contato', 'medicglobal.html' => 'Institucional (MedicGLOBAL)', 'conteudos.html' => 'Conteúdos', 'documentos.html' => 'Documentos', 'trabalhe-conosco.html' => 'Trabalhe conosco', 'privacidade.html' => 'Política de privacidade', '404.html' => 'Página não encontrada (404)', 'rn565.html' => 'Histórico de reajustes', 'idss.html' => 'Histórico do IDSS'];
const DOC_DATA = ['rj-row', 'rn-years', 'rn-current', 'rj-older-title', 'agr-title', 'agr-sub', 'agr-cover', 'agr-stats', 'agr-tbl', 'agr-plans', 'agr-nav', 'agr-years', 'idss-dims', 'idss-orig', 'src-tag', 'doc-rich'];
const VALUE_NAMES = ['href' => 'destino', 'newTab' => 'nova aba', 'image' => 'imagem', 'alt' => 'texto alternativo', 'placeholder' => 'texto de exemplo', 'required' => 'obrigatório', 'maxlength' => 'máximo de caracteres'];
const SHARED_NAMES = [
  'address' => 'Endereço', 'pousoAlegre' => 'Sede Pouso Alegre', 'extrema' => 'Sede Extrema', 'street' => 'Rua e número', 'district' => 'Bairro', 'city' => 'Cidade', 'state' => 'UF', 'zip' => 'CEP',
  'phones' => 'Telefone', 'central' => 'Central de atendimento', 'abramge' => 'ABRAMGE', 'label' => 'número exibido', 'tel' => 'número para discagem', 'e164' => 'formato internacional', 'ouvidoriaHours' => 'Horário da ouvidoria',
  'wa' => 'WhatsApp', 'autorizacoes' => 'Autorizações', 'faturamento' => 'Faturamento', 'financeiro' => 'Financeiro', 'comercial' => 'Comercial', 'geral' => 'Geral', 'url' => 'link',
  'mail' => 'E-mail', 'ouvidoria' => 'Ouvidoria', 'links' => 'Link', 'docs' => 'Documento (PDF)', 'legal' => 'Dados da empresa', 'razao' => 'Razão social', 'cnpj' => 'CNPJ', 'ans' => 'Registro ANS', 'domain' => 'Domínio do site',
];
const DERIVED = '/^address\.\w+\.(full|maps|embed)$/';

function page_rank($p) {
  if (!empty($p['partial'])) return ['group' => 'Componentes compartilhados', 'n' => 0, 'area' => 'Usado em várias páginas'];
  foreach (SITE_ORDER as $i => $x) if ($x[0] === $p['file']) return ['group' => 'Páginas do site', 'n' => $i, 'area' => $x[1]];
  if (preg_match('/^(rn565|idss)(?:-agrupamento)?(?:-(\d{4}))?\.html$/', $p['file'], $m)) return ['group' => $m[1] === 'rn565' ? DOC_GROUPS['rn565'] : DOC_GROUPS['idss'], 'n' => !empty($m[2]) ? 3000 - (int)$m[2] : 0, 'area' => $m[1] === 'rn565' ? 'RN 565' : 'IDSS'];
  return ['group' => 'Outras', 'n' => 9999, 'area' => ''];
}
function ordered_pages($pages, $lang) {
  $l = [];
  foreach ($pages as $p) if ($p['lang'] === $lang && !preg_match('/^noticia-/', $p['file'])) $l[] = array_merge(['p' => $p], page_rank($p));
  usort($l, fn($a, $b) => (array_search($a['group'], GROUP_ORDER) - array_search($b['group'], GROUP_ORDER)) ?: ($a['n'] - $b['n']) ?: strcmp($a['p']['file'], $b['p']['file']));
  return $l;
}
function page_title($p) {
  if (!empty($p['partial'])) return $p['meta']['title'];
  if (isset(PAGE_NAMES[$p['file']])) return PAGE_NAMES[$p['file']];
  if (preg_match('/^(?:rn565-agrupamento|idss)-(\d{4})\.html$/', $p['file'], $m)) return (str_starts_with($p['file'], 'idss') ? 'IDSS ' : 'Agrupamento ') . $m[1];
  return trim(explode('|', js_str(($p['meta']['title'] ?? '') ?: $p['file']))[0]);
}

/* ---------- fontes e campos editáveis ---------- */
function src_signature() {
  static $sig = null;
  if ($sig !== null) return $sig;
  $parts = [];
  foreach (['/src/pages', '/src/en/pages', '/src/partials', '/src/en/partials', '/src/data'] as $d) foreach (glob(MG_ROOT . $d . '/*') ?: [] as $f) $parts[] = basename($f) . ':' . filemtime($f) . ':' . filesize($f);
  $parts[] = filemtime(__DIR__ . '/CmsHtml.php') . ':' . filemtime(__FILE__);
  return $sig = md5(implode('|', $parts));
}
function sources($content) {
  static $cache = ['key' => '', 'data' => null];
  $key = md5(je([$content['site'] ?? [], $content['noticias'] ?? null, $content['rn565'] ?? null, $content['idss'] ?? null]) . src_signature());
  if ($cache['key'] === $key) return $cache['data'];
  $r = load_sources(array_merge($content, ['virtual' => true]));
  $vfs = $r['vfs']; $pages = [];
  foreach (MG_LANGS as $lang => $L) {
    foreach (array_filter($vfs->readdirSync(lang_pages($lang)), fn($f) => str_ends_with($f, '.html')) as $file) {
      if ($file === 'mapa-de-migracao.html') continue;
      $raw = $vfs->readFileSync(lang_pages($lang) . '/' . $file);
      preg_match('/^<!--@([\s\S]*?)@-->\s*/', $raw, $m);
      $pages["$lang/$file"] = ['key' => "$lang/$file", 'lang' => $lang, 'file' => $file, 'meta' => json_decode($m[1], true), 'src' => substr($raw, strlen($m[0])), 'generated' => (bool) preg_match(MG_GENERATED, $file)];
    }
  }
  foreach (PARTIALS as $n => $title) foreach (['pt', 'en'] as $lang) {
    $en = MG_ROOT . "/src/en/partials/$n.html";
    $p = $lang === 'en' && $vfs->existsSync($en) ? $en : ($lang === 'pt' ? MG_ROOT . "/src/partials/$n.html" : null);
    if ($p) $pages["partial/$lang/$n"] = ['key' => "partial/$lang/$n", 'lang' => $lang, 'file' => $n, 'partial' => true, 'meta' => ['title' => $title], 'src' => $vfs->readFileSync($p)];
  }
  $cache = ['key' => $key, 'data' => ['site' => $r['site'], 'pages' => $pages, 'key' => $key]];
  return $cache['data'];
}
// extract() com cache por requisição
function extract_of($src, $opts = []) {
  static $c = [];
  $k = md5($src) . je($opts);
  return $c[$k] ??= CmsHtml::extract($src, $opts);
}
function token_check($site) { return fn($k) => has_path($site, $k); }
function decode_attr($s) { return str_replace('&amp;', '&', str_replace(['&quot;', '&#39;', '&lt;', '&gt;'], ['"', "'", '<', '>'], (string)($s ?? ''))); }
function base_value($u) {
  $b = $u['base'];
  if (array_key_exists('alt', $b)) $b['alt'] = decode_attr($b['alt']);
  if (array_key_exists('placeholder', $b)) $b['placeholder'] = decode_attr($b['placeholder']);
  return $b;
}

// endereço de exibição de uma imagem (miniatura no painel)
function image_url($site, $ref) {
  if (!$ref) return '';
  if (str_starts_with($ref, 'up:')) return MG_API . '/media/' . substr($ref, 3);
  if (str_starts_with($ref, 'assets/uploads/')) return MG_API . '/media/' . substr($ref, 15);
  if (str_starts_with($ref, 'assets/')) return MG_API . '/site-assets/' . substr($ref, 7);
  $id = $site['photos'][$ref] ?? null;
  if (!$id) return '';
  return str_starts_with($id, 'assets/') ? MG_API . '/site-assets/' . substr($id, 7) : "https://images.unsplash.com/photo-$id?auto=format&fit=crop&w=480&q=60";
}
function upload_exists($name) { return preg_match('/^[\w.-]+$/', (string)$name) && is_file(mg_dirs()['uploads'] . '/' . $name) && !str_ends_with($name, '.json'); }
function upload_meta($name) { $s = @file_get_contents(mg_dirs()['uploads'] . '/' . $name . '.json'); return $s === false ? null : json_decode($s, true); }
function tokens_in($s) { if (!is_string($s)) return []; preg_match_all('/\{\{L\.([\w.]+)\}\}/', $s, $m); return $m[1]; }
function plain_len($s) { return mb_strlen(CmsHtml::plain(js_str($s ?? ''))); }

function page_view($content, $live, $key) {
  $S = sources($content); $site = $S['site']; $pages = $S['pages'];
  $p = $pages[$key] ?? null;
  if (!$p) return null;
  $ex = extract_of($p['src'], $p['generated'] && preg_match('/^(rn565|idss)/', $p['file']) ? ['dataClasses' => DOC_DATA] : []);
  $units = $ex['units']; $sections = $ex['sections'];
  foreach ($sections as &$s) if (isset($s['includes'])) $s['includes'] = array_values(array_map(fn($n) => ['key' => 'partial/' . $p['lang'] . '/' . $n, 'title' => PARTIALS[$n]], array_filter($s['includes'], fn($n) => isset(PARTIALS[$n]) && isset($pages['partial/' . $p['lang'] . '/' . $n]))));
  unset($s);
  $draftEdits = $content['pages'][$key]['edits'] ?? [];
  $liveEdits = $live['pages'][$key]['edits'] ?? [];
  $res = CmsHtml::resolve($units, $draftEdits); $map = $res['map']; $orphans = $res['orphans'];
  $liveMap = CmsHtml::resolve($units, $liveEdits)['map'];
  $out = []; $allShared = [];
  foreach ($units as $u) {
    $d = $map[$u['id']] ?? null; $l = $liveMap[$u['id']] ?? null;
    $base = base_value($u);
    $value = array_merge($base, $d ? ($d['edit']['value'] ?? []) : []);
    $r = ['id' => $u['id'], 'kind' => $u['kind'], 'label' => $u['label'], 'sr' => !empty($u['sr']), 'data' => !empty($u['data']), 'tag' => $u['tag'] ?? null, 'cls' => $u['cls'] ?? null, 'base' => $base, 'value' => $value, 'edited' => (bool)$d,
      'pending' => je($d ? $d['edit']['value'] : null) !== je($l ? $l['edit']['value'] : null), 'limits' => $u['limits'] ?? null, 'link' => $u['link'] ?? null, 'partialText' => !empty($u['partial'])];
    if ($u['kind'] === 'image' || $u['kind'] === 'pic') { $r['preview'] = image_url($site, $value['image'] ?? ''); $r['basePreview'] = image_url($site, $base['image'] ?? ''); $r['decorative'] = !empty($u['decorative']); }
    if ($u['kind'] === 'field') $r += ['form' => $u['form'], 'name' => $u['name'], 'type' => $u['type'], 'hasPlaceholder' => $u['hasPlaceholder']];
    if ($u['kind'] === 'link' && preg_match('/^\{\{L\.[\w.]+\}\}$/', (string)$u['base']['href'])) $r['linkedData'] = substr($u['base']['href'], 4, -2);
    $r['shared'] = array_values(array_unique(array_merge(tokens_in($value['html'] ?? null), tokens_in($value['href'] ?? null))));
    if (!$p['generated']) { $el = elsewhere($content, $key, $u); if ($el) $r['elsewhere'] = array_map(fn($x) => $x['title'] . ($x['section'] ? ' › ' . $x['section'] : ''), array_slice($el, 0, 30)); $r['elsewhereCount'] = count($el); }
    $allShared = array_merge($allShared, $r['shared']);
    $out[] = $r;
  }
  $shared = shared_info($content, array_merge($allShared, tokens_in(je($p['meta']))));
  $metaEdit = $content['pages'][$key]['meta'] ?? [];
  $meta = null;
  if (empty($p['partial'])) {
    $mb = ['title' => js_str($p['meta']['title'] ?? ''), 'description' => js_str($p['meta']['description'] ?? ''), 'og' => ($p['meta']['og'] ?? '') ?: 'old_familia'];
    $meta = ['base' => $mb, 'value' => array_merge($mb, $metaEdit)];
    $meta['ogPreview'] = image_url($site, $meta['value']['og']);
    $meta['limits'] = ['title' => max(70, mb_strlen($mb['title'])), 'description' => max(170, mb_strlen($mb['description']))];
  }
  $seq = ordered_pages($pages, $p['lang']); $rank = null;
  foreach ($seq as $x) if ($x['p']['key'] === $key) $rank = $x;
  $same = array_values(array_filter($seq, fn($x) => $x['group'] === $rank['group'])); $pos = 0;
  foreach ($same as $i => $x) if ($x['p']['key'] === $key) $pos = $i;
  $nav = fn($x) => $x ? ['key' => $x['p']['key'], 'title' => page_title($x['p'])] : null;
  $place = ['group' => $rank['group'], 'area' => $rank['area'], 'pos' => $pos + 1, 'total' => count($same), 'prev' => $nav($same[$pos - 1] ?? null), 'next' => $nav($same[$pos + 1] ?? null)];
  $ek = en_key_of($key);
  $english = $ek && isset($pages[$ek]) ? ['url' => !empty($p['partial']) ? null : 'en/' . $p['file'], 'pending' => !empty($content['enPending'][$key]), 'fields' => count($content['pages'][$ek]['edits'] ?? [])] : null;
  $view = ['key' => $key, 'title' => page_title($p), 'place' => $place, 'lang' => $p['lang'], 'file' => $p['file'], 'partial' => !empty($p['partial']), 'generated' => $p['generated'] ?? null,
    'url' => !empty($p['partial']) ? null : ($p['lang'] === 'en' ? 'en/' : '') . $p['file'], 'meta' => $meta, 'sections' => $sections, 'units' => $out, 'orphans' => $orphans, 'shared' => (object)$shared, 'english' => $english];
  if ($view['generated'] === null) unset($view['generated']); // componentes: sem a marca (como no Node)
  return $view;
}

function summarize($k, $v) {
  if ($v === null || $v === '') return '';
  if ($k === 'html') return mb_substr(CmsHtml::plain(js_str($v)), 0, 400);
  if ($k === 'newTab' || $k === 'required') return $v ? 'sim' : 'não';
  if ($k === 'image') return preg_replace('/^up:|^assets\/uploads\//', '', js_str($v), 1);
  return mb_substr(js_str($v), 0, 400);
}

/* Valida e grava no rascunho as alterações de uma página. Nada é gravado se algum campo for inválido. */
function save_page(&$content, $key, $body) {
  $S = sources($content); $site = $S['site']; $p = $S['pages'][$key] ?? null;
  if (!$p) return ['status' => 404, 'error' => 'Página não encontrada.'];
  $ex = extract_of($p['src']); $units = $ex['units']; $sections = $ex['sections'];
  $byId = []; foreach ($units as $u) $byId[$u['id']] = $u;
  $entry = $content['pages'][$key] ?? ['edits' => [], 'meta' => []];
  $entry['edits'] = $entry['edits'] ?? []; $entry['meta'] = $entry['meta'] ?? [];
  $current = CmsHtml::resolve($units, $entry['edits'])['map'];
  $changes = [];
  $secOf = function ($id) use ($sections) { foreach ($sections as $s) if (in_array($id, $s['units'], true)) return $s['label'] . ' › '; return ''; };
  $note = function ($u, $prev, $next) use (&$changes, $secOf) {
    foreach (array_keys(array_merge($prev, $next)) as $k) {
      if (str_or($prev[$k] ?? null) === str_or($next[$k] ?? null)) continue;
      $changes[] = ['field' => $secOf($u['id']) . $u['label'] . (isset(VALUE_NAMES[$k]) ? ' (' . VALUE_NAMES[$k] . ')' : ''), 'before' => summarize($k, $prev[$k] ?? null), 'after' => summarize($k, $next[$k] ?? null)];
    }
  };
  $editsByUnit = [];
  foreach ($current as $uid => $x) $editsByUnit[$uid] = $x['edit'];
  $errors = []; $valid = token_check($site);
  foreach (($body['edits'] ?? []) as $id => $raw) {
    $u = $byId[$id] ?? null;
    if (!$u) { $errors[$id] = 'Campo não encontrado (a página pode ter sido atualizada; recarregue).'; continue; }
    $prevValue = isset($editsByUnit[$id]) ? $editsByUnit[$id]['value'] : base_value($u);
    if ($raw === null) { $note($u, $prevValue, base_value($u)); unset($editsByUnit[$id]); continue; }
    $v = []; $e = [];
    if ($u['kind'] === 'text' || ($u['kind'] === 'link' && isset($u['range']))) {
      $hh = CmsHtml::sanitizeHtml(array_key_exists('html', $raw) ? js_str($raw['html']) : 'undefined', $valid);
      if (CmsHtml::plain($hh) === '') $e[] = 'O texto não pode ficar vazio.';
      $len = plain_len($hh);
      if ($len > $u['limits']['html']) $e[] = "Máximo de {$u['limits']['html']} caracteres (atual: $len).";
      $v['html'] = $hh;
    }
    if ($u['kind'] === 'link') {
      $href = trim(str_or($raw['href'] ?? ''));
      if ($href !== $u['base']['href'] && !CmsHtml::validHref($href, $valid)) $e[] = 'Destino inválido. Use https://…, mailto:, tel:, #âncora ou uma página do site (ex.: planos.html).';
      if (mb_strlen($href) > 500) $e[] = 'Endereço longo demais (máx. 500).';
      $v['href'] = $href; $v['newTab'] = !empty($raw['newTab']);
    }
    if ($u['kind'] === 'image' || $u['kind'] === 'pic') {
      $img = str_or($raw['image'] ?? '');
      $alt = trim(($raw['alt'] ?? null) === null ? '' : js_str($raw['alt']));
      if ($u['kind'] === 'pic' && !($img === $u['base']['image'] || !empty($site['photos'][$img]) || (str_starts_with($img, 'up:') && upload_exists(substr($img, 3))))) $e[] = 'Imagem inválida: envie um arquivo pela biblioteca de mídia.';
      if ($u['kind'] === 'image' && !($img === $u['base']['image'] || (str_starts_with($img, 'assets/uploads/') && upload_exists(substr($img, 15))))) $e[] = 'Imagem inválida: envie um arquivo pela biblioteca de mídia.';
      $v['image'] = $img; $v['alt'] = mb_strlen($alt) > 160 || preg_match('/[|{}<>]/', $alt) ? ($u['base']['alt'] ?? '') : $alt;
    }
    if ($u['kind'] === 'field') {
      $ph = trim(str_or($raw['placeholder'] ?? ''));
      if (mb_strlen($ph) > 90) $e[] = 'Texto de exemplo: máximo de 90 caracteres.';
      $mlRaw = $raw['maxlength'] ?? null;
      $ml = ($mlRaw === '' || $mlRaw === null) ? '' : (is_numeric($mlRaw) ? $mlRaw + 0 : NAN);
      $isInt = $ml !== '' && !is_nan((float)$ml) && floor((float)$ml) == (float)$ml;
      if ($ml !== '' && (!$isInt || $ml < 1 || $ml > 10000)) $e[] = 'Tamanho máximo: número inteiro entre 1 e 10000.';
      $v['placeholder'] = $ph; $v['required'] = !empty($raw['required']); $v['maxlength'] = $ml === '' ? '' : (string)(int)$ml;
    }
    if ($e) { $errors[$id] = implode(' ', $e); continue; }
    $base = base_value($u);
    $same = true; foreach ($v as $k => $x) if (js_str($x) !== str_or_undef($base, $k)) $same = false;
    $note($u, $prevValue, array_merge($base, $v));
    if ($same) unset($editsByUnit[$id]); else $editsByUnit[$id] = ['kind' => $u['kind'], 'base' => $u['base'], 'value' => $v];
  }
  if (!empty($body['meta']) && empty($p['partial'])) {
    $m = $body['meta']; $base = $p['meta'];
    $lim = ['title' => max(70, mb_strlen(js_str($base['title'] ?? ''))), 'description' => max(170, mb_strlen(js_str($base['description'] ?? '')))];
    $META_NAMES = ['title' => 'Título da página', 'description' => 'Descrição no Google', 'og' => 'Imagem de compartilhamento'];
    $noteMeta = function ($k, $s) use (&$changes, &$entry, $base, $META_NAMES) {
      $prev = array_key_exists($k, $entry['meta']) ? $entry['meta'][$k] : (($base[$k] ?? '') ?: ($k === 'og' ? 'old_familia' : ''));
      if ($prev !== $s) $changes[] = ['field' => 'Google e compartilhamento › ' . $META_NAMES[$k], 'before' => $prev, 'after' => $s];
    };
    foreach (['title', 'description'] as $k) if (array_key_exists($k, $m)) {
      $s = trim(js_str($m[$k]));
      preg_match_all('/\{\{\s*L\.([\w.]+)\s*\}\}/', $s, $toks);
      $badTok = false; foreach ($toks[1] as $t) if (!$valid($t)) $badTok = true;
      if ($s === '') $errors["meta.$k"] = 'Campo obrigatório.';
      elseif (mb_strlen($s) > $lim[$k]) $errors["meta.$k"] = "Máximo de {$lim[$k]} caracteres (atual: " . mb_strlen($s) . ').';
      elseif (preg_match('/[<>]/', $s)) $errors["meta.$k"] = 'Não use < ou >.';
      elseif ($badTok || preg_match('/\{\{(?!\s*L\.)/', $s)) $errors["meta.$k"] = 'Trecho entre {{ }} inválido.';
      else { $noteMeta($k, $s); if ($s === ($base[$k] ?? null)) unset($entry['meta'][$k]); else $entry['meta'][$k] = $s; }
    }
    if (array_key_exists('og', $m)) {
      $og = js_str($m['og']);
      if (!(!empty($site['photos'][$og]) || (str_starts_with($og, 'up:') && upload_exists(substr($og, 3))))) $errors['meta.og'] = 'Imagem de compartilhamento inválida.';
      else { $noteMeta('og', $og); if ($og === (($base['og'] ?? '') ?: 'old_familia')) unset($entry['meta']['og']); else $entry['meta']['og'] = $og; }
    }
  }
  if ($errors) return ['status' => 422, 'error' => 'Alguns campos não foram salvos. Corrija os itens destacados.', 'fields' => $errors];
  $entry['edits'] = $editsByUnit;
  if (!$entry['edits'] && !$entry['meta']) unset($content['pages'][$key]); else $content['pages'][$key] = $entry;
  return ['ok' => true, 'changes' => $changes];
}
function str_or_undef($arr, $k) { return array_key_exists($k, $arr) ? js_str($arr[$k]) : 'undefined'; }

/* ---------- dados compartilhados ({{L.x}}) ---------- */
function shared_label($p) { return implode(' · ', array_map(fn($k) => SHARED_NAMES[$k] ?? $k, explode('.', $p))); }
function field_type($p, $v) {
  if (preg_match('#^https?://#', $v) || preg_match('/\.(url|maps|embed)$/', $p) || preg_match('/^(links|docs)\./', $p) || $p === 'domain') return 'url';
  if (preg_match('/^tel:/', $v)) return 'tel';
  if (preg_match('/^mail\./', $p)) return 'email';
  return 'text';
}
function valid_site_value($type, $v) {
  if (mb_strlen($v) > 500) return 'Máximo de 500 caracteres.';
  if (trim($v) === '') return 'Campo obrigatório.';
  if ($type === 'url' && !(preg_match('#^https?://[^\s<>"]+$#', $v) || preg_match('/^[\w-]+\.html$/', $v))) return 'Use um endereço completo (https://…).';
  if ($type === 'tel' && !preg_match('/^tel:\+?\d{6,15}$/', $v)) return 'Use o formato tel:+5535999999999.';
  if ($type === 'email' && !preg_match(Forms::EMAIL, $v)) return 'E-mail inválido.';
  // aspas também: estes dados entram em atributos do HTML (ex.: aria-label, href)
  if (preg_match('/[<>{}"]/', $v)) return 'Não use < > { } ou aspas (").';
  return '';
}
// quantas vezes cada dado aparece no site (páginas em português, componentes e menu/rodapé)
function shared_uses($content) {
  $S = sources($content);
  return disk_cache('uses-' . $S['key'], function () use ($S) {
    $map = [];
    $count = function ($src) use (&$map) { foreach (tokens_in($src) as $t) $map[$t] = ($map[$t] ?? 0) + 1; };
    foreach ($S['pages'] as $p) if ($p['lang'] === 'pt') { $count($p['src']); $count(je($p['meta'])); }
    $count(file_get_contents(MG_ROOT . '/src/partials/layout.html'));
    return $map;
  });
}
function shared_info($content, $paths) {
  $base = base_site(); $site = sources($content)['site']; $uses = shared_uses($content); $out = [];
  foreach (array_unique($paths) as $p) {
    if (!has_path($base, $p)) continue;
    $b = get_path($base, $p);
    if (is_array($b) || str_starts_with($p, 'en.') || str_starts_with($p, 'photos.')) continue;
    $n = $uses[$p] ?? 0;
    if (preg_match('/^(address\.\w+)\.(street|district|city|state|zip)$/', $p, $part)) foreach (['full', 'maps', 'embed'] as $k) $n += $uses[$part[1] . '.' . $k] ?? 0;
    $out[$p] = ['label' => shared_label($p), 'value' => js_str(get_path($site, $p)), 'base' => js_str($b), 'type' => field_type($p, js_str($b)), 'uses' => $n ?: 1, 'derived' => (bool) preg_match(DERIVED, $p)];
  }
  return $out;
}
// grava no rascunho os dados compartilhados alterados; textos com versão em inglês (site.json → en) são traduzidos
function save_shared(&$content, $values, &$changes) {
  $base = base_site(); $errors = []; $toTranslate = [];
  $over = $content['site'] ?? [];
  foreach (($values ?: []) as $p => $raw) {
    $p = (string)$p;
    $b = has_path($base, $p) ? get_path($base, $p) : null;
    if (!has_path($base, $p) || is_array($b) || preg_match(DERIVED, $p) || preg_match('/^(en|photos)\./', $p)) { $errors["shared.$p"] = 'Dado não editável.'; continue; }
    $v = trim(js_str($raw)); $prev = has_path($over, $p) ? js_str(get_path($over, $p)) : js_str($b);
    $e = valid_site_value(field_type($p, js_str($b)), $v);
    if ($e) { $errors["shared.$p"] = $e; continue; }
    if ($v === $prev) continue;
    $changes[] = ['field' => 'Dado compartilhado › ' . shared_label($p), 'before' => $prev, 'after' => $v];
    if ($v === js_str($b)) set_path($over, $p, null, true); else set_path($over, $p, $v);
    if (has_path($base['en'] ?? [], $p)) $toTranslate[] = $p;
  }
  if ($errors) return ['errors' => $errors];
  $warn = '';
  if ($toTranslate) {
    try {
      $tr = Translate::items(array_map(fn($p) => ['text' => js_str(has_path($over, $p) ? get_path($over, $p) : get_path($base, $p))], $toTranslate));
      foreach ($toTranslate as $i => $p) { if (has_path($over, $p)) set_path($over, "en.$p", $tr[$i]['text']); else set_path($over, "en.$p", null, true); }
    } catch (Throwable $e) { $warn = 'O texto em inglês deste dado não pôde ser traduzido agora (' . $e->getMessage() . ').'; }
  }
  $content['site'] = $over;
  return ['warn' => $warn];
}

/* ---------- textos repetidos: o mesmo conteúdo em vários lugares do site ---------- */
function dup_sig($u) { return ($u['kind'] === 'text' || ($u['kind'] === 'link' && isset($u['range']))) && mb_strlen(CmsHtml::plain($u['base']['html'] ?? '')) >= 3 ? $u['kind'] . '|' . je($u['base']) : null; }
function dup_index($content) {
  $S = sources($content);
  return disk_cache('dup-' . $S['key'], function () use ($S) {
    $map = [];
    foreach ($S['pages'] as $p) {
      if ($p['lang'] !== 'pt') continue;
      $ex = extract_of($p['src']);
      foreach ($ex['units'] as $u) {
        $sig = dup_sig($u);
        if (!$sig) continue;
        $sec = ''; foreach ($ex['sections'] as $s) if (in_array($u['id'], $s['units'], true)) { $sec = $s['label']; break; }
        $map[$sig][] = ['key' => $p['key'], 'id' => $u['id'], 'title' => page_title($p), 'section' => $sec];
      }
    }
    return $map;
  });
}
function elsewhere($content, $key, $u) { $sig = dup_sig($u); return $sig ? array_values(array_filter(dup_index($content)[$sig] ?? [], fn($x) => !($x['key'] === $key && $x['id'] === $u['id']))) : []; }
function disk_cache($name, $fn) {
  static $mem = [];
  if (isset($mem[$name])) return $mem[$name];
  $f = mg_dirs()['cache'] . '/' . $name . '.json';
  $v = is_file($f) ? json_decode(file_get_contents($f), true) : null;
  if (!is_array($v)) {
    $v = $fn();
    foreach (glob(mg_dirs()['cache'] . '/' . explode('-', $name)[0] . '-*.json') ?: [] as $old) @unlink($old);
    @file_put_contents($f, je($v));
  }
  return $mem[$name] = $v;
}

/* ---------- versão em inglês: gerada a partir das edições em português ---------- */
function en_key_of($k) { return str_starts_with($k, 'partial/pt/') ? 'partial/en/' . substr($k, 11) : (str_starts_with($k, 'pt/') ? 'en/' . substr($k, 3) : null); }
// casa os campos das duas versões pela estrutura (as páginas em inglês têm a mesma marcação das em português)
function align_units($a, $b) {
  $sig = fn($u) => $u['kind'] . '|' . ($u['tag'] ?? 'undefined') . '|' . ($u['cls'] ?? '') . '|' . (isset($u['range']) ? 1 : 0);
  $sa = array_map($sig, $a); $sb = array_map($sig, $b);
  $n = count($a); $m = count($b);
  $L = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));
  for ($i = $n - 1; $i >= 0; $i--) for ($j = $m - 1; $j >= 0; $j--) $L[$i][$j] = $sa[$i] === $sb[$j] ? $L[$i + 1][$j + 1] + 1 : max($L[$i + 1][$j], $L[$i][$j + 1]);
  $out = [];
  for ($i = 0, $j = 0; $i < $n && $j < $m;) {
    if ($sa[$i] === $sb[$j]) { $out[$a[$i]['id']] = $b[$j]; $i++; $j++; } elseif ($L[$i + 1][$j] >= $L[$i][$j + 1]) $i++; else $j++;
  }
  return $out;
}
/* Recalcula a versão em inglês das páginas indicadas (chaves em português). Falha do tradutor: o português fica
   salvo e a página entra em content.enPending para nova tentativa (no próximo salvamento ou na publicação). */
function sync_english(&$content, $ptKeys) {
  $pages = sources($content)['pages'];
  $plans = []; $items = [];
  $ask = function ($it) use (&$items) { $items[] = $it; return count($items) - 1; };
  foreach (array_unique($ptKeys) as $ptKey) {
    $enKey = en_key_of($ptKey); $pt = $pages[$ptKey] ?? null; $en = $enKey ? ($pages[$enKey] ?? null) : null;
    if (!$pt || !$en) continue;
    $ptUnits = extract_of($pt['src'])['units']; $enUnits = extract_of($en['src'])['units'];
    $align = align_units($ptUnits, $enUnits);
    $ptEntry = $content['pages'][$ptKey] ?? [];
    $edits = [];
    foreach (CmsHtml::resolve($ptUnits, $ptEntry['edits'] ?? [])['map'] as $x) {
      $u = $x['unit']; $edit = $x['edit'];
      $eu = $align[$u['id']] ?? null;
      if (!$eu) continue;
      $v = $edit['value'] ?? []; $pb = base_value($u); $eb = base_value($eu); $out = []; $tr = [];
      foreach ($v as $k => $val) {
        $changed = js_str($val) !== str_or_undef($pb, $k);
        if (!$changed) { $out[$k] = array_key_exists($k, $eb) ? $eb[$k] : $val; continue; }
        if ($k === 'html') $tr['html'] = $ask(['html' => $val]);
        elseif ($k === 'alt' || $k === 'placeholder') $tr[$k] = $ask(['text' => $val]);
        else $out[$k] = $val;
      }
      $edits[] = ['eu' => $eu, 'out' => $out, 'tr' => $tr];
    }
    $meta = []; $metaTr = [];
    foreach (($ptEntry['meta'] ?? []) as $k => $val) { if ($k === 'og') $meta['og'] = $val; else $metaTr[$k] = $ask(['text' => $val]); }
    $plans[] = ['ptKey' => $ptKey, 'enKey' => $enKey, 'edits' => $edits, 'meta' => $meta, 'metaTr' => $metaTr];
  }
  try { $res = $items ? Translate::items($items) : []; }
  catch (Throwable $e) {
    foreach ($plans as $p) $content['enPending'][$p['ptKey']] = true;
    return ['error' => 'A versão em inglês não pôde ser traduzida agora (' . $e->getMessage() . '). O português foi salvo; a tradução será tentada de novo ao salvar ou publicar.'];
  }
  $got = fn($i) => array_key_exists('html', $res[$i]) ? $res[$i]['html'] : $res[$i]['text'];
  $valid = token_check(sources($content)['site']);
  foreach ($plans as $p) {
    $edits = [];
    foreach ($p['edits'] as $x) {
      $value = $x['out'];
      foreach ($x['tr'] as $k => $i) $value[$k] = $k === 'html' ? CmsHtml::sanitizeHtml($got($i), $valid) : preg_replace('/[|{}<>]/', '', $got($i));
      $edits[$x['eu']['id']] = ['kind' => $x['eu']['kind'], 'base' => $x['eu']['base'], 'value' => $value, 'auto' => true];
    }
    $meta = $p['meta'];
    foreach ($p['metaTr'] as $k => $i) $meta[$k] = preg_replace('/[<>]/', '', $got($i));
    if ($edits || $meta) $content['pages'][$p['enKey']] = ['edits' => $edits, 'meta' => $meta, 'auto' => true]; else unset($content['pages'][$p['enKey']]);
    unset($content['enPending'][$p['ptKey']]);
  }
  if (isset($content['enPending']) && !$content['enPending']) unset($content['enPending']);
  return ['ok' => true];
}
// nomes das páginas (para a auditoria)
function page_names() { $o = []; foreach (sources(content_draft())['pages'] as $p) $o[$p['key']] = page_title($p) . ($p['lang'] === 'en' ? ' (inglês)' : ''); return $o; }

/* ---------- Notícias ---------- */
const NEWS_NAMES = ['titulo' => 'Título', 'resumo' => 'Resumo', 'intro' => 'Parágrafo de abertura', 'tema' => 'Tema', 'migalha' => 'Nome curto', 'foto' => 'Imagem', 'cat' => 'Categoria', 'data' => 'Data', 'leitura' => 'Leitura (min)', 'fonteTitulo' => 'Título da fonte', 'fonteUrl' => 'Link da fonte', 'slug' => 'Endereço da página'];
function validate_news($list, $site) {
  $errs = [];
  if (!is_array($list) || !array_is_list($list)) return ['Formato inválido.'];
  $slugs = [];
  $txt = function ($n, $k, $max, $req = true) use (&$errs) {
    $v = $n[$k] ?? null;
    $empty = $v === null || trim(js_str($v)) === '';
    if ($empty ? $req : (mb_strlen(js_str($v)) > $max || preg_match('/[<>]/', js_str($v))))
      $errs[] = (!empty($n['titulo']) ? '"' . $n['titulo'] . '": ' : '') . (NEWS_NAMES[$k] ?? $k) . ' ' . ($v ? "tem mais de $max caracteres ou usa < >" : 'é obrigatório') . '.';
  };
  foreach ($list as $n) {
    $slug = js_str($n['slug'] ?? '');
    $t = $n['titulo'] ?? '';
    if (!preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $slug) || strlen($slug) > 90) $errs[] = $slug !== '' ? "Endereço da página inválido: \"$slug\". Use letras minúsculas, números e hífens." : 'Endereço da página é obrigatório.';
    if (isset($slugs[$slug])) $errs[] = "Endereço repetido: $slug"; $slugs[$slug] = true;
    if (!in_array($n['cat'] ?? null, ['noticias', 'comunicados'], true)) $errs[] = "\"$t\": categoria inválida.";
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', js_str($n['data'] ?? ''))) $errs[] = "\"$t\": data inválida.";
    $lei = $n['leitura'] ?? null;
    if (!(is_numeric($lei) && floor(+$lei) == +$lei && +$lei >= 1 && +$lei <= 60)) $errs[] = "\"$t\": tempo de leitura entre 1 e 60 min.";
    $txt($n, 'titulo', 140); $txt($n, 'resumo', 300); $txt($n, 'intro', 1200); $txt($n, 'tema', 60, false); $txt($n, 'migalha', 60, false); $txt($n, 'fonteTitulo', 220, false);
    if (!empty($n['fonteUrl']) && !preg_match('#^https://[^\s<>"]+$#', $n['fonteUrl'])) $errs[] = "\"$t\": link da fonte precisa começar com https://.";
    if (!empty($n['fonteTitulo']) && empty($n['fonteUrl'])) $errs[] = "\"$t\": informe o link da fonte ou deixe o título da fonte em branco.";
    if (!empty($n['foto']) && !(!empty($site['photos'][$n['foto']]) || (str_starts_with($n['foto'], 'up:') && upload_exists(substr($n['foto'], 3))))) $errs[] = "\"$t\": imagem inválida.";
    $secs = function ($x) use (&$errs, $t) {
      if (!is_array($x['secoes'] ?? null) || !array_is_list($x['secoes']) || count($x['secoes']) > 15) { $errs[] = "\"$t\": seções inválidas."; return; }
      foreach ($x['secoes'] as $s) {
        $h = $s['h'] ?? '';
        if (!$h || mb_strlen(js_str($h)) > 140 || preg_match('/[<>]/', js_str($h))) $errs[] = 'Subtítulo de uma das partes do texto está vazio ou passa de 140 caracteres.';
        $ps = $s['p'] ?? null; $bad = !is_array($ps) || !$ps;
        if (!$bad) foreach ($ps as $pp) if (trim(js_str($pp)) === '' || mb_strlen(js_str($pp)) > 2000 || preg_match('/[<>]/', js_str($pp))) $bad = true;
        if ($bad) $errs[] = 'Parágrafos de uma das partes do texto estão vazios, passam de 2000 caracteres ou usam < >.';
      }
    };
    $secs($n);
    if (!empty($n['en'])) { foreach (['titulo', 'resumo', 'intro'] as $k) if (empty($n['en'][$k])) $errs[] = "\"$t\" (inglês): $k é obrigatório — ou remova a versão em inglês."; if (!empty($n['en']['secoes'])) $secs($n['en']); }
  }
  return $errs;
}
/* Versão em inglês das notícias: só o que mudou em português é traduzido de novo. */
function news_english(&$list, $prev) {
  $items = []; $jobs = [];
  foreach ($list as $ni => $n) {
    $p = null; foreach ($prev as $x) if (($x['slug'] ?? null) === $n['slug']) { $p = $x; break; }
    $old = $p && !empty($p['en']) ? $p['en'] : null;
    $oldSecs = $old['secoes'] ?? [];
    $list[$ni]['en'] = $old ?: [];
    foreach (['titulo', 'resumo', 'intro', 'tema', 'migalha'] as $k) {
      if (empty($n[$k])) { unset($list[$ni]['en'][$k]); continue; }
      if (!($old && ($p[$k] ?? null) === $n[$k] && !empty($old[$k]))) { $jobs[] = [$ni, [$k]]; $items[] = ['text' => $n[$k]]; }
    }
    $list[$ni]['en']['secoes'] = [];
    foreach ($n['secoes'] as $si => $sec) {
      $ps = $p['secoes'][$si] ?? null; $os = $oldSecs[$si] ?? null;
      $list[$ni]['en']['secoes'][$si] = ['h' => '', 'p' => []];
      if ($os && $ps && $ps['h'] === $sec['h']) $list[$ni]['en']['secoes'][$si]['h'] = $os['h']; else { $jobs[] = [$ni, ['secoes', $si, 'h']]; $items[] = ['text' => $sec['h']]; }
      foreach ($sec['p'] as $pj => $tx) {
        if ($os && $ps && ($ps['p'][$pj] ?? null) === $tx && !empty($os['p'][$pj])) $list[$ni]['en']['secoes'][$si]['p'][$pj] = $os['p'][$pj];
        else { $jobs[] = [$ni, ['secoes', $si, 'p', $pj]]; $items[] = ['text' => $tx]; }
      }
    }
  }
  try { $res = $items ? Translate::items($items) : []; }
  catch (Throwable $e) { return ['error' => 'A notícia não foi salva porque a tradução automática para o inglês falhou (' . $e->getMessage() . '). Tente de novo em instantes.']; }
  foreach ($res as $i => $r) {
    [$ni, $path] = $jobs[$i];
    $ref = &$list[$ni]['en']; foreach ($path as $k) $ref = &$ref[$k];
    $ref = preg_replace('/[<>]/', '', $r['text']); unset($ref);
  }
  foreach ($list as $ni => $n) foreach ($list[$ni]['en']['secoes'] as $si => $s) ksort($list[$ni]['en']['secoes'][$si]['p']);
  return ['ok' => true];
}
function news_audit($user, $prev, $list) {
  foreach ($list as $n) {
    $p = null; foreach ($prev as $x) if (($x['slug'] ?? null) === $n['slug']) { $p = $x; break; }
    if (!$p) { audit($user, 'noticia_criada', $n['titulo'], [['field' => 'Título', 'before' => '', 'after' => $n['titulo']]]); continue; }
    $ch = [];
    foreach (NEWS_NAMES as $k => $label) if (str_or($p[$k] ?? null) !== str_or($n[$k] ?? null)) $ch[] = ['field' => $label, 'before' => str_or($p[$k] ?? null), 'after' => str_or($n[$k] ?? null)];
    foreach ($n['secoes'] as $i => $sec) {
      $ps = $p['secoes'][$i] ?? ['h' => '', 'p' => []];
      if ($ps['h'] !== $sec['h']) $ch[] = ['field' => 'Seção ' . ($i + 1) . ' › título', 'before' => $ps['h'], 'after' => $sec['h']];
      if (implode("\n\n", $ps['p']) !== implode("\n\n", $sec['p'])) $ch[] = ['field' => 'Seção ' . ($i + 1) . ' › parágrafos', 'before' => mb_substr(implode(' ¶ ', $ps['p']), 0, 400), 'after' => mb_substr(implode(' ¶ ', $sec['p']), 0, 400)];
    }
    for ($i = count($n['secoes']); $i < count($p['secoes'] ?? []); $i++) $ch[] = ['field' => 'Seção ' . ($i + 1), 'before' => $p['secoes'][$i]['h'], 'after' => '(removida)'];
    if ($ch) audit($user, 'noticia_alterada', $n['titulo'], $ch);
  }
  foreach ($prev as $p) { $found = false; foreach ($list as $x) if ($x['slug'] === ($p['slug'] ?? null)) $found = true; if (!$found) audit($user, 'noticia_removida', $p['titulo'], [['field' => 'Título', 'before' => $p['titulo'], 'after' => '']]); }
}

/* ---------- documentos renovados todo ano: RN 565 (reajuste) e IDSS ---------- */
const DOCS = ['rn565' => ['file' => 'rn565.json', 'list' => 'anos'], 'idss' => ['file' => 'idss.json', 'list' => 'registros']];
const RE_DATE = '/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(20\d\d)$/';
const RE_SCORE = '/^[01],\d{4}$/';
const RICH_MAX = 200000;
function docs_data($content, $type) { return $content[$type] ?? json_decode(file_get_contents(MG_ROOT . '/src/data/' . DOCS[$type]['file']), true); }
function clean_s($v, $max) { return mb_substr(trim(preg_replace('/\s+/u', ' ', $v === null ? '' : js_str($v))), 0, $max); }
function is_doc_file($p) { return preg_match('/^assets\/img\/idss\/[\w.-]+$/', $p) ? file_exists(MG_ROOT . '/' . $p) : (preg_match('/^assets\/uploads\/[\w.-]+$/', $p) && upload_exists(substr($p, 15))); }
function rich_img_ok($s) { return (preg_match('/^assets\/uploads\/[\w.-]+$/', $s) && upload_exists(substr($s, 15))) || (preg_match('/^assets\/img\/[\w\/.-]+$/', $s) && !str_contains($s, '..') && file_exists(MG_ROOT . '/' . $s)); }
// no painel as imagens do conteúdo aparecem pelo endereço do painel; no site, por assets/…
function rich_in($h) {
  $h = mb_substr(js_str($h ?? ''), 0, RICH_MAX * 2);
  foreach (['/admin/media/', MG_API . '/media/'] as $pre) $h = preg_replace('/(src=["\'])' . preg_quote($pre, '/') . '/', '$1assets/uploads/', $h);
  foreach (['/admin/site-assets/', MG_API . '/site-assets/'] as $pre) $h = preg_replace('/(src=["\'])' . preg_quote($pre, '/') . '/', '$1assets/', $h);
  return CmsHtml::sanitizeRich($h, 'rich_img_ok');
}
function rich_out($h) { return str_replace('src="assets/', 'src="' . MG_API . '/site-assets/', str_replace('src="assets/uploads/', 'src="' . MG_API . '/media/', js_str($h ?? ''))); }
function set_rich(&$item, $b, $prev, &$errors) {
  if (!array_key_exists('conteudo', $b)) return;
  $c = rich_in($b['conteudo']);
  if (mb_strlen($c) > RICH_MAX) { $errors['conteudo'] = 'Conteúdo grande demais. Divida o texto ou use menos tabelas.'; return; }
  if ($c !== '') $item['conteudo'] = $c; else { unset($item['conteudo'], $item['conteudoEn']); }
  if (!$prev || ($prev['conteudo'] ?? null) !== ($item['conteudo'] ?? null)) unset($item['conteudoEn']);
}
/* Tradução do conteúdo livre: bloco a bloco, com as imagens fora do tradutor; o alt de cada imagem à parte. */
function translate_rich($h) {
  $segs = [];
  $LEAF = ['p', 'h2', 'h3', 'h4', 'li', 'th', 'td', 'blockquote', 'figcaption'];
  $walk = function ($el) use (&$walk, &$segs, $LEAF) {
    foreach ($el->children as $ch) {
      if ($ch->type !== 'el') continue;
      if (in_array($ch->tag, $LEAF, true)) { if ($ch->closeStart > $ch->openEnd) $segs[] = [$ch->openEnd, $ch->closeStart]; }
      elseif (!in_array($ch->tag, ['img', 'br', 'hr'], true)) $walk($ch);
    }
  };
  $walk(CmsHtml::parse($h));
  $items = array_map(fn($s) => ['html' => preg_replace('/<img [^>]*>/', '', substr($h, $s[0], $s[1] - $s[0]))], $segs);
  preg_match_all('/<img [^>]*alt="([^"]*)"[^>]*>/', $h, $am);
  $alts = array_map('decode_attr', $am[1]);
  $res = Translate::items(array_merge($items, array_map(fn($t) => ['text' => $t], $alts)));
  $out = $h;
  for ($k = count($segs) - 1; $k >= 0; $k--) {
    [$a, $b] = $segs[$k];
    preg_match_all('/<img [^>]*>/', substr($h, $a, $b - $a), $im);
    $out = substr($out, 0, $a) . $res[$k]['html'] . implode('', $im[0]) . substr($out, $b);
  }
  $n = 0; $ns = count($segs);
  $out = preg_replace_callback('/(<img [^>]*alt=")([^"]*)("[^>]*>)/', function ($m) use (&$n, $ns, $res) { $r = $res[$ns + $n++] ?? null; return $m[1] . CmsHtml::esc($r ? $r['text'] : $m[2]) . $m[3]; }, $out);
  return CmsHtml::sanitizeRich($out, 'rich_img_ok');
}
// RN 565: um ano = percentual, período e a relação de contratos (ou um PDF com a relação)
function rn_year($b, $prev, &$errors) {
  $ano = (int) +($b['ano'] ?? 0);
  $a = array_merge($prev ?: [], ['ano' => $ano, 'percentual' => clean_s($b['percentual'] ?? null, 12), 'inicio' => clean_s($b['inicio'] ?? null, 10), 'fim' => clean_s($b['fim'] ?? null, 10),
    'botaoOriginal' => ($prev['botaoOriginal'] ?? '') ?: 'Ver Agrupamento', 'linkOriginal' => ($prev['linkOriginal'] ?? '') ?: '']);
  if ($a['percentual'] && !preg_match('/^\d{1,3}(,\d{1,2})?%$/', $a['percentual'])) $errors['percentual'] = 'Use o formato 8,70%.';
  if (!preg_match(RE_DATE, $a['inicio'])) $errors['inicio'] = 'Data no formato DD/MM/AAAA.';
  if (!preg_match(RE_DATE, $a['fim'])) $errors['fim'] = 'Data no formato DD/MM/AAAA.';
  $a['descricao'] = "Percentual de reajuste a ser aplicado ao agrupamento de contratos com até 30 vidas, no período de {$a['inicio']} a {$a['fim']}" . ($a['percentual'] ? ": {$a['percentual']}" : '');
  $rows = is_array($b['contratos'] ?? null) ? $b['contratos'] : [];
  if (count($rows) > 5000) $errors['contratos'] = 'No máximo 5000 contratos.';
  $a['contratos'] = array_values(array_filter(array_map(fn($c) => ['contrato' => clean_s($c['contrato'] ?? null, 20), 'plano' => clean_s($c['plano'] ?? null, 120), 'registro' => clean_s($c['registro'] ?? null, 20)], $rows), fn($c) => $c['contrato'] !== '' || $c['plano'] !== ''));
  foreach ($a['contratos'] as $c) if ($c['contrato'] === '' || $c['plano'] === '' || preg_match('/[<>{}]/', $c['contrato'] . $c['plano'] . $c['registro'])) { $errors['contratos'] = 'Cada linha precisa de contrato e plano (sem < > { }).'; break; }
  if (array_key_exists('pdfFile', $b)) { if ($b['pdfFile']) $a['pdfFile'] = $b['pdfFile']; else unset($a['pdfFile']); }
  if (!empty($a['pdfFile']) && !(preg_match('/^assets\/uploads\/[\w-]+\.pdf$/', $a['pdfFile']) && upload_exists(substr($a['pdfFile'], 15)))) $errors['pdfFile'] = 'Envie o PDF pelo botão deste campo.';
  if (!$a['contratos']) unset($a['contratos']);
  if (empty($a['contratos']) && empty($a['pdfFile']) && empty($a['pdf'])) $errors['contratos'] = 'Informe a relação de contratos ou envie o PDF do agrupamento.';
  set_rich($a, $b, $prev, $errors);
  return $a;
}
// IDSS: um ano = nota geral, notas por dimensão e as imagens do resultado divulgado pela ANS
function idss_year($b, $prev, $latest, &$errors) {
  $ano = (int) +($b['ano'] ?? 0); $anoBase = (int) +($b['anoBase'] ?? 0) ?: $ano - 1;
  $r = array_merge($prev ?: [], ['ano' => $ano, 'anoBase' => $anoBase, 'descricao' => "IDSS Referente a $ano (Ano Base $anoBase)", 'titulo' => "IDSS ANO $ano", 'subtitulo' => "IDSS Referente a $ano (Ano Base $anoBase)"]);
  $r['botaoOriginal'] = ($r['botaoOriginal'] ?? '') ?: 'Visualizar'; $r['origem'] = ($r['origem'] ?? '') ?: '';
  $res = $b['resultado'] ?? [];
  $r['resultado'] = ['nota' => clean_s($res['nota'] ?? null, 6), 'dim' => array_map(fn($i) => clean_s($res['dim'][$i] ?? null, 6), [0, 1, 2, 3]), 'acred' => clean_s($res['acred'] ?? null, 120) ?: 'Operadora não bonificada', 'bonus' => clean_s($res['bonus'] ?? null, 120) ?: '0,0000 · Operadora não bonificada'];
  if (!preg_match(RE_SCORE, $r['resultado']['nota'])) $errors['nota'] = 'Nota no formato 0,4859.';
  foreach ($r['resultado']['dim'] as $d) if (!preg_match(RE_SCORE, $d)) { $errors['dim'] = 'As quatro notas por dimensão no formato 0,2715.'; break; }
  if (preg_match('/[<>{}]/', $r['resultado']['acred'] . $r['resultado']['bonus'])) $errors['acred'] = 'Não use < > { }.';
  $imgs = array_map('js_str', is_array($b['imagens'] ?? null) ? $b['imagens'] : []);
  if (!$imgs) $errors['imagens'] = 'Envie ao menos uma imagem do resultado divulgado pela ANS.';
  if (count($imgs) > 20) $errors['imagens'] = 'No máximo 20 imagens.';
  foreach ($imgs as $p) if (!is_doc_file($p)) { $errors['imagens'] = 'Imagem inválida: envie pelo botão deste campo.'; break; }
  $base = array_values(array_filter(($prev ?: $latest)['blocos'], fn($x) => !empty($x['h2']) || (!empty($x['p']) && !preg_match('/^(O Resultado|A nota)/', $x['p']))));
  $r['blocos'] = array_merge($base, [['p' => "O Resultado da Medic Global foi: <strong><u>{$r['resultado']['nota']}</u></strong>"]], array_map(fn($img) => ['img' => $img], $imgs));
  set_rich($r, $b, $prev, $errors);
  return $r;
}
function doc_summary($type, $x) {
  if ($type === 'rn565') return ['ano' => $x['ano'], 'percentual' => $x['percentual'] ?? null, 'inicio' => $x['inicio'] ?? null, 'fim' => $x['fim'] ?? null, 'contratos' => $x['contratos'] ?? [], 'pdfFile' => $x['pdfFile'] ?? '', 'pdf' => $x['pdf'] ?? '', 'conteudo' => rich_out($x['conteudo'] ?? null)];
  $imgs = array_values(array_map(fn($b) => $b['img'], array_filter($x['blocos'], fn($b) => !empty($b['img']))));
  return ['ano' => $x['ano'], 'anoBase' => $x['anoBase'] ?? null, 'resultado' => $x['resultado'] ?? null, 'imagens' => $imgs,
    'preview' => array_map(fn($i) => MG_API . '/' . (str_starts_with($i, 'assets/uploads/') ? 'media/' . substr($i, 15) : 'site-assets/' . substr($i, 7)), $imgs), 'conteudo' => rich_out($x['conteudo'] ?? null)];
}

/* ---------- rascunho → visualização → publicação ---------- */
function copy_dir($from, $to, $skipJson = false) {
  if (!is_dir($to)) mkdir($to, 0755, true);
  foreach (array_diff(scandir($from), ['.', '..']) as $e) {
    $a = "$from/$e"; $b = "$to/$e";
    if (is_dir($a)) copy_dir($a, $b, false);
    elseif (!$skipJson || !str_ends_with($e, '.json')) { if (!is_file($b) || filesize($b) !== filesize($a) || filemtime($b) < filemtime($a)) copy($a, $b); }
  }
}
function rm_tree($d) { if (!is_dir($d)) return; foreach (array_diff(scandir($d), ['.', '..']) as $e) { $p = "$d/$e"; is_dir($p) ? rm_tree($p) : @unlink($p); } @rmdir($d); }
function publish_site($content) {
  $t = microtime(true);
  @set_time_limit(300);
  $report = SiteBuild::run(['content' => $content, 'outDir' => MG_PUBLIC]);
  if (realpath(MG_PUBLIC) !== realpath(MG_ROOT)) copy_dir(MG_ROOT . '/assets', MG_PUBLIC . '/assets');
  copy_dir(mg_dirs()['uploads'], MG_PUBLIC . '/assets/uploads', true);
  return ['ms' => (int) round((microtime(true) - $t) * 1000), 'orphans' => (object)$report['orphans']];
}
function preview_site($content) {
  $d = mg_dirs()['preview'];
  rm_tree($d); mkdir($d, 0700, true);
  return SiteBuild::run(['content' => array_merge($content, ['preview' => true]), 'outDir' => $d]);
}
// resumo do que está no rascunho e ainda não foi publicado
function pending_summary($draft, $live) {
  $ch = [];
  $keys = array_unique(array_merge(array_keys($draft['pages'] ?? []), array_keys($live['pages'] ?? [])));
  foreach ($keys as $k) if (je($draft['pages'][$k] ?? null) !== je($live['pages'][$k] ?? null)) $ch[] = ['area' => 'page', 'key' => (string)$k];
  foreach (['site', 'noticias', 'rn565', 'idss', 'identity', 'analytics', 'forms'] as $a) if (je(norm_empty($draft[$a] ?? null)) !== je(norm_empty($live[$a] ?? null))) $ch[] = ['area' => $a];
  return $ch;
}
function norm_empty($v) { return $v === [] ? null : $v; }
