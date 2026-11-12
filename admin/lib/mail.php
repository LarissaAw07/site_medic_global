<?php
/* Cliente SMTP mínimo (equivale a cms/mail.js): TLS direto (porta 465) e STARTTLS (587/25), com AUTH PLAIN. */

function mail_send($cfg, $msg) {
  $port = (int)($cfg['port'] ?? 0) ?: 587;
  $implicit = ($cfg['secure'] ?? null) === true || $port === 465;
  $verify = ($cfg['allowInsecure'] ?? null) !== true;
  $ctx = stream_context_create(['ssl' => ['verify_peer' => $verify, 'verify_peer_name' => $verify, 'peer_name' => $cfg['host'], 'SNI_enabled' => true]]);
  $errno = 0; $errstr = '';
  $sock = @stream_socket_client(($implicit ? 'ssl://' : 'tcp://') . $cfg['host'] . ':' . $port, $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $ctx);
  if (!$sock) throw new RuntimeException($errstr ?: 'Falha na conexão SMTP');
  stream_set_timeout($sock, 20);
  $read = function () use ($sock) {
    $res = '';
    while (($line = fgets($sock, 4096)) !== false) {
      $res .= $line;
      if (preg_match('/^\d{3} /', $line)) return $res;
      $meta = stream_get_meta_data($sock);
      if ($meta['timed_out']) break;
    }
    if (stream_get_meta_data($sock)['timed_out']) throw new RuntimeException('Tempo esgotado na conexão SMTP');
    return $res;
  };
  $cmd = function ($line, $ok) use ($sock, $read) {
    if ($line !== null) fwrite($sock, $line . "\r\n");
    $res = $read();
    $lines = explode("\r\n", trim($res));
    $last = end($lines);
    $code = (int) substr($last, 0, 3);
    if (!in_array($code, $ok, true)) throw new RuntimeException('SMTP ' . ($line ? explode(' ', $line)[0] : 'conexão') . ': ' . $last);
    return $res;
  };
  try {
    $cmd(null, [220]);
    $host = 'medicglobal-cms';
    $ehlo = $cmd("EHLO $host", [250]);
    if (!$implicit && preg_match('/STARTTLS/i', $ehlo)) {
      $cmd('STARTTLS', [220]);
      if (!stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('Falha ao iniciar TLS no SMTP');
      $ehlo = $cmd("EHLO $host", [250]);
    } elseif (!$implicit && !empty($cfg['user']) && ($cfg['allowInsecure'] ?? null) !== true) {
      throw new RuntimeException('O servidor SMTP não oferece STARTTLS; a senha não será enviada sem criptografia.');
    }
    if (!empty($cfg['user'])) $cmd('AUTH PLAIN ' . base64_encode("\0{$cfg['user']}\0{$cfg['pass']}"), [235]);
    $cmd("MAIL FROM:<{$cfg['from']}>", [250]);
    foreach ($msg['to'] as $to) $cmd("RCPT TO:<$to>", [250, 251]);
    $cmd('DATA', [354]);
    $b64 = fn($s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
    $body = rtrim(chunk_split(base64_encode($msg['text']), 76, "\r\n"), "\r\n");
    $lines = [
      'From: ' . $b64(($cfg['fromName'] ?? '') ?: 'Site MedicGLOBAL') . " <{$cfg['from']}>",
      'To: ' . implode(', ', $msg['to']),
      !empty($msg['replyTo']) ? "Reply-To: <{$msg['replyTo']}>" : '',
      'Subject: ' . $b64($msg['subject']),
      'Date: ' . gmdate('D, d M Y H:i:s') . ' GMT',
      'Message-ID: <' . bin2hex(random_bytes(12)) . '@medicglobal-cms>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      $body,
    ];
    $data = implode("\r\n", array_values(array_filter($lines, fn($l, $i) => $l !== '' || $i > 8, ARRAY_FILTER_USE_BOTH)));
    $cmd($data . "\r\n.", [250]);
    fwrite($sock, "QUIT\r\n");
  } finally { fclose($sock); }
  return true;
}
