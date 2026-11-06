<?php
/* DIAGNOSTICO temporario — subir na raiz do site, abrir no navegador e ler a saida.
   APAGAR depois. Testa PHP, cURL e a saida HTTPS para extremamedic.com. */
header('Content-Type: text/plain; charset=utf-8');

echo "PHP versao........: " . PHP_VERSION . "\n";
echo "cURL carregado....: " . (function_exists('curl_init') ? 'SIM' : 'NAO (precisa habilitar a extensao cURL)') . "\n";
echo "OpenSSL carregado.: " . (extension_loaded('openssl') ? 'SIM' : 'NAO (HTTPS nao vai funcionar)') . "\n";
echo "allow_url_fopen...: " . ini_get('allow_url_fopen') . "\n";
echo "REQUEST_URI.......: " . (isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '') . "\n";
echo "QUERY_STRING......: " . (isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '') . "\n";
echo str_repeat('-', 50) . "\n";

echo "Teste de saida HTTPS -> https://extremamedic.com/manual/buscacidade.php?estado=MG\n\n";
if (!function_exists('curl_init')) {
  echo "cURL indisponivel: os proxies rede-api.php/guia-api.php NAO vao funcionar.\n";
  exit;
}
$ch = curl_init('https://extremamedic.com/manual/buscacidade.php?estado=MG');
curl_setopt_array($ch, array(
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT        => 20,
  CURLOPT_HTTPHEADER     => array('X-Requested-With: ajax'),
));
$r = curl_exec($ch);
if ($r === false) {
  echo "ERRO cURL: " . curl_error($ch) . "\n";
  echo "(provavel: saida de rede bloqueada pela hospedagem, ou sem OpenSSL)\n";
} else {
  echo "HTTP " . curl_getinfo($ch, CURLINFO_HTTP_CODE) . " — " . strlen($r) . " bytes recebidos\n\n";
  echo "Primeiros 400 caracteres da resposta:\n" . substr($r, 0, 400) . "\n";
}
curl_close($ch);
