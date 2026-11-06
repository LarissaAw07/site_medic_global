<?php
/* Biblioteca compartilhada dos proxies da rede credenciada e do guia medico.
   Usada pelos arquivos dentro de rede-api/ e guia-api/ (pastas reais — NAO precisa de URL Rewrite).
   Cada stub chama: run_proxy('<base do sistema oficial>/', __FILE__[, $transform]).
   O destino e a mesma base + o nome do proprio arquivo (ex.: rede-api/buscacidade.php -> .../manual? nao:
   o stub informa a base correta). Preserva a query string e o corpo POST.
   Requer a extensao cURL do PHP. */

function run_proxy($base, $file, $transform = false) {
  $name  = basename($file);
  $query = isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '';
  $url   = $base . $name . ($query !== '' ? '?' . $query : '');

  if (!function_exists('curl_init')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'cURL indisponivel no PHP';
    return;
  }

  $ch = curl_init($url);
  $headers = array('X-Requested-With: ajax', 'User-Agent: MedicGLOBAL proxy');
  curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT        => 60,
    CURLOPT_ENCODING       => 'identity',
  ));
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
    if (!empty($_SERVER['CONTENT_TYPE'])) $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
  }
  curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

  $body  = curl_exec($ch);
  $ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
  $code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);

  if ($body === false) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'proxy error: ' . curl_error($ch);
    curl_close($ch);
    return;
  }
  curl_close($ch);

  // manual.php: embutido em iframe no nosso dominio -> injeta <base> para os assets relativos
  // e NAO repassa X-Frame-Options/CSP (nao copiamos os headers de origem).
  if ($transform && stripos((string)$ctype, 'text/html') !== false && !preg_match('/<base\s/i', $body)) {
    $body = preg_replace('/<head([^>]*)>/i', '<head$1><base href="' . $base . '">', $body, 1);
  }

  http_response_code($code ? $code : 502);
  if ($ctype) header('Content-Type: ' . $ctype);
  header('Access-Control-Allow-Origin: *');
  header('Cache-Control: no-cache');
  echo $body;
}
