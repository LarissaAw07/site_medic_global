<?php
/* Google Analytics 4 (equivale a cms/ga.js): verificação da configuração, das permissões e da coleta.
   A chave da conta de serviço e o "API secret" ficam só no servidor, cifrados; o painel nunca os devolve. */

final class GA {
  const RE = ['measurementId' => '/^G-[A-Z0-9]{4,15}$/', 'gtmId' => '/^GTM-[A-Z0-9]{4,12}$/', 'propertyId' => '/^\d{6,12}$/'];

  static function request($method, $url, $headers = [], $body = null) {
    $ch = mg_curl(curl_init($url));
    $h = ['User-Agent: MedicGLOBAL-CMS'];
    foreach ($headers as $k => $v) $h[] = "$k: $v";
    $opts = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_HTTPHEADER => $h];
    if ($body !== null) $opts[CURLOPT_POSTFIELDS] = is_string($body) ? $body : je($body);
    curl_setopt_array($ch, $opts);
    $text = curl_exec($ch);
    if ($text === false) { $e = curl_error($ch); curl_close($ch); return ['status' => 0, 'json' => null, 'text' => $e]; }
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    return ['status' => $status, 'json' => json_decode($text, true), 'text' => $text];
  }
  static function parseServiceAccount($raw) {
    $j = json_decode((string)$raw, true);
    if (!is_array($j)) return ['error' => 'O arquivo da conta de serviço não é um JSON válido.'];
    if (($j['type'] ?? '') !== 'service_account' || empty($j['client_email']) || empty($j['private_key'])) return ['error' => 'O JSON não é de uma conta de serviço do Google Cloud (faltam type/client_email/private_key).'];
    if (!openssl_pkey_get_private($j['private_key'])) return ['error' => 'A chave privada da conta de serviço é inválida.'];
    return ['ok' => true, 'email' => $j['client_email'], 'project' => $j['project_id'] ?? ''];
  }
  private static function b64url($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
  // token OAuth da conta de serviço (JWT assinado com RS256)
  static function accessToken($sa) {
    $now = time();
    $unsigned = self::b64url(je(['alg' => 'RS256', 'typ' => 'JWT'])) . '.' . self::b64url(je(['iss' => $sa['client_email'], 'scope' => 'https://www.googleapis.com/auth/analytics.readonly', 'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600]));
    $sig = '';
    if (!openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) throw new RuntimeException('A chave privada da conta de serviço é inválida.');
    $r = self::request('POST', 'https://oauth2.googleapis.com/token', ['Content-Type' => 'application/x-www-form-urlencoded'], 'grant_type=' . enc_uri('urn:ietf:params:oauth:grant-type:jwt-bearer') . '&assertion=' . $unsigned . '.' . self::b64url($sig));
    if ($r['status'] !== 200 || empty($r['json']['access_token'])) throw new RuntimeException('O Google recusou a conta de serviço: ' . (($r['json']['error_description'] ?? null) ?: (($r['json']['error'] ?? null) ?: 'HTTP ' . $r['status'])));
    return $r['json']['access_token'];
  }

  /* Executa as verificações e devolve [{ id, label, status: ok|warn|fail|skip, detail }]. */
  static function verify($cfg, $secrets, $publishedHtml) {
    $out = [];
    $add = function ($id, $label, $status, $detail) use (&$out) { $out[] = ['id' => $id, 'label' => $label, 'status' => $status, 'detail' => $detail]; };
    $mid = $cfg['measurementId'] ?? ''; $gtm = $cfg['gtmId'] ?? ''; $pid = $cfg['propertyId'] ?? ''; $enabled = !empty($cfg['enabled']);
    if (!$mid && !$gtm) { $add('ids', 'ID de medição / GTM', 'fail', 'Informe o ID de medição do GA4 (G-XXXXXXX) ou o contêiner do GTM.'); return $out; }
    $add('ids', 'Formato dos identificadores', ((!$mid || preg_match(self::RE['measurementId'], $mid)) && (!$gtm || preg_match(self::RE['gtmId'], $gtm))) ? 'ok' : 'fail',
      implode(' · ', array_filter([$mid ? "GA4: $mid" : '', $gtm ? "GTM: $gtm" : ''])));

    $tagOk = $publishedHtml && $enabled && (!$mid || str_contains($publishedHtml, "\"ga\":\"$mid\"")) && (!$gtm || str_contains($publishedHtml, "\"gtm\":\"$gtm\""));
    $add('tag', 'Tag instalada no site publicado', !$enabled ? 'warn' : ($tagOk ? 'ok' : 'warn'),
      !$enabled ? 'A coleta está desativada no painel.' : ($tagOk ? 'As páginas publicadas carregam a tag após o consentimento de cookies (LGPD).' : 'Publique o site para que a configuração atual chegue às páginas.'));

    if (!empty($secrets['serviceAccount']) && $pid) {
      $token = null;
      try { $token = self::accessToken(json_decode($secrets['serviceAccount'], true)); $add('auth', 'Autenticação da conta de serviço', 'ok', 'Token de acesso obtido.'); }
      catch (Throwable $e) { $add('auth', 'Autenticação da conta de serviço', 'fail', $e->getMessage()); }
      if ($token) {
        $h = ['Authorization' => 'Bearer ' . $token, 'Content-Type' => 'application/json'];
        $ds = self::request('GET', "https://analyticsadmin.googleapis.com/v1beta/properties/$pid/dataStreams", $h);
        if ($ds['status'] === 200) {
          $streams = $ds['json']['dataStreams'] ?? [];
          $match = null; foreach ($streams as $s) if (($s['webStreamData']['measurementId'] ?? null) === $mid && isset($s['webStreamData'])) { $match = $s; break; }
          $add('perm', 'Permissão de leitura na propriedade', 'ok', "Acesso confirmado à propriedade $pid (" . count($streams) . ' fluxo(s) de dados).');
          if ($mid) $add('link', 'ID de medição pertence à propriedade', $match ? 'ok' : 'fail', $match ? "Fluxo \"{$match['displayName']}\" · " . ($match['webStreamData']['defaultUri'] ?? '') : "Nenhum fluxo web da propriedade $pid usa $mid.");
        } elseif ($ds['status'] === 403) $add('perm', 'Permissão de leitura na propriedade', 'fail', 'A conta de serviço não tem acesso. No GA4: Administrador › Gerenciamento de acesso à propriedade › adicionar o e-mail da conta de serviço como Leitor. Confira também se a Google Analytics Admin API está ativada no projeto do Google Cloud.');
        elseif ($ds['status'] === 404) $add('perm', 'Permissão de leitura na propriedade', 'fail', "Propriedade $pid não encontrada.");
        else $add('perm', 'Permissão de leitura na propriedade', 'fail', "Resposta inesperada do Google (HTTP {$ds['status']}): " . mb_substr((($ds['json']['error']['message'] ?? null) ?: ($ds['text'] ?? '')), 0, 200));

        $rt = self::request('POST', "https://analyticsdata.googleapis.com/v1beta/properties/$pid:runRealtimeReport", $h, ['metrics' => [['name' => 'activeUsers'], ['name' => 'eventCount']]]);
        if ($rt['status'] === 200) {
          $row = $rt['json']['rows'][0] ?? null;
          $users = $row ? +$row['metricValues'][0]['value'] : 0; $events = $row ? +$row['metricValues'][1]['value'] : 0;
          $add('realtime', 'Coleta de dados (últimos 30 min)', $events > 0 ? 'ok' : 'warn', $events > 0 ? "$users usuário(s) ativo(s), $events evento(s) recebidos." : 'Nenhum evento nos últimos 30 minutos. Abra o site, aceite os cookies e verifique novamente.');
        } else $add('realtime', 'Coleta de dados (últimos 30 min)', 'fail', "Não foi possível ler o relatório em tempo real (HTTP {$rt['status']}). Confira se a Google Analytics Data API está ativada. " . mb_substr($rt['json']['error']['message'] ?? '', 0, 160));
      }
    } else $add('perm', 'Permissões e coleta (API do Google)', 'skip', 'Para validar permissões e a coleta, informe o ID da propriedade e envie a chave JSON de uma conta de serviço com acesso de Leitor.');

    if (!empty($secrets['apiSecret']) && $mid) {
      $qs = 'measurement_id=' . enc_uri($mid) . '&api_secret=' . enc_uri($secrets['apiSecret']);
      $ev = ['client_id' => 'cms.' . now_ms(), 'events' => [['name' => 'cms_verificacao', 'params' => ['origem' => 'painel_medicglobal', 'engagement_time_msec' => 1]]]];
      $dbg = self::request('POST', 'https://www.google-analytics.com/debug/mp/collect?' . $qs, ['Content-Type' => 'application/json'], $ev);
      $msgs = $dbg['json']['validationMessages'] ?? [];
      if ($dbg['status'] === 200 && !$msgs) {
        $sent = self::request('POST', 'https://www.google-analytics.com/mp/collect?' . $qs, ['Content-Type' => 'application/json'], $ev);
        $add('mp', 'Evento de teste (Measurement Protocol)', 'warn', $sent['status'] < 300 ? 'O Google aceitou o formato do evento "cms_verificacao", mas não confirma se o ID e o API secret estão corretos. Confira o evento em GA4 › Relatórios › Tempo real (ou use a validação pela conta de serviço, acima).' : 'O envio do evento de teste falhou (HTTP ' . $sent['status'] . ').');
      } else $add('mp', 'Evento de teste (Measurement Protocol)', 'fail', $dbg['status'] ? (implode(' ', array_map(fn($m) => $m['description'], $msgs)) ?: 'HTTP ' . $dbg['status']) : 'Sem conexão com o Google: ' . $dbg['text']);
    }
    return $out;
  }
}
