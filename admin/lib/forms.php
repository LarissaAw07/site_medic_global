<?php
/* Formulários do site (equivale a cms/forms.js): definição lida dos próprios templates (já com as edições do painel),
   validação no servidor, armazenamento dos envios (MySQL) e aviso por e-mail e/ou webhook. */
require_once __DIR__ . '/mail.php';

final class Forms {
  const NAMES = ['contato' => 'Fale conosco', 'ouvidoria' => 'Ouvidoria', 'newsletter' => 'Newsletter', 'proposta_planos' => 'Proposta de planos', 'trabalhe_conosco' => 'Trabalhe conosco'];
  const EMAIL = '/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/u';
  const DEFAULT_UPLOAD_MB = 1024;
  const RETENTION_MONTHS = 6;

  /* Lê os formulários (form[data-validate]) das páginas em português. sources: [['key'=>…, 'src'=>…]] */
  static function definitions($sources) {
    $defs = [];
    foreach ($sources as $s) {
      $src = $s['src']; $key = $s['key'];
      $root = CmsHtml::parse($src);
      $walk = function ($n, $form) use (&$walk, &$defs, $src, $root, $key) {
        foreach (self::kids($n) as $c) {
          if (self::nv($c, 'type') !== 'el') continue;
          $a = function ($k) use ($c) { foreach (self::nv($c, 'attrs') ?: [] as $x) if (self::nv($x, 'name') === $k) { $v = self::nv($x, 'value'); return $v === null ? '' : $v; } return null; };
          $tag = self::nv($c, 'tag');
          if ($tag === 'form' && $a('data-validate')) {
            $name = $a('data-validate');
            if (!isset($defs[$name])) $defs[$name] = ['name' => $name, 'title' => self::NAMES[$name] ?? $name, 'page' => $key, 'fields' => [], 'consent' => false];
            $form = $name;
          }
          if ($form !== null && in_array($tag, ['input', 'select', 'textarea'], true)) {
            $type = strtolower($a('type') ?? $tag);
            $fname = $a('name');
            if ($type === 'checkbox' && !$fname && $a('required') !== null) $defs[$form]['consent'] = true;
            elseif ($fname && !in_array($type, ['submit', 'button'], true)) {
              $fi = null;
              foreach ($defs[$form]['fields'] as $i => $x) if ($x['name'] === $fname) $fi = $i;
              if ($fi === null) {
                $f = ['name' => $fname, 'type' => $type, 'required' => $a('required') !== null, 'maxlength' => (int)(+($a('maxlength') ?? 0)) ?: 0, 'options' => [], 'label' => self::labelFor($src, $a('id')) ?: $fname];
                if ($type === 'file') { $f['accept'] = $a('accept') ?? ''; $f['maxBytes'] = (int)(+($a('data-max-bytes') ?? 0)); }
                $defs[$form]['fields'][] = $f; $fi = count($defs[$form]['fields']) - 1;
              }
              $f = &$defs[$form]['fields'][$fi];
              if ($type === 'radio') { $f['options'][] = $a('value'); if ($a('required') !== null) $f['required'] = true; }
              if ($tag === 'select') {
                $f['type'] = 'select';
                $inner = substr($src, self::nv($c, 'openEnd'), self::nv($c, 'closeStart') - self::nv($c, 'openEnd'));
                preg_match_all('/<option([^>]*)>([\s\S]*?)<\/option>/', $inner, $mm, PREG_SET_ORDER);
                foreach ($mm as $m) $f['options'][] = preg_match('/value="([^"]*)"/', $m[1], $v) ? $v[1] : CmsHtml::plain($m[2]);
              }
              unset($f);
            }
          }
          $walk($c, $form);
        }
      };
      $walk($root, null);
    }
    return $defs;
  }
  // acesso aos nós da árvore do CmsHtml::parse (arrays ou objetos)
  private static function nv($n, $k) { return is_array($n) ? ($n[$k] ?? null) : ($n->$k ?? null); }
  private static function kids($n) { return self::nv($n, 'children') ?: []; }
  private static function labelFor($src, $id) {
    if (!$id) return '';
    if (!preg_match('/<label[^>]*for="' . preg_quote($id, '/') . '"[^>]*>([\s\S]*?)<\/label>/', $src, $m)) return '';
    return mb_substr(preg_replace('/\s*\*.*$/su', '', preg_replace('/\s*\(opcional\)\s*/iu', '', CmsHtml::plain($m[1]), 1), 1), 0, 80);
  }

  /* ---------- configurações de destino (webhook e senha SMTP cifrados) ---------- */
  static function settings() { $s = kv_read('settings', []); return is_array($s) ? $s : []; }
  static function saveSettings($s) { kv_write('settings', $s); }

  /* ---------- limite de envios por IP, em 10 minutos: até 6 aceitos e até 30 tentativas ---------- */
  private static function count($kind, $ip) { return (int) DB::q("SELECT COUNT(*) c FROM " . DB::t('hits') . " WHERE kind=? AND k=? AND at > ?", [$kind, $ip, now_ms() - 600000])->fetch()['c']; }
  private static function hit($kind, $ip) { DB::q("INSERT INTO " . DB::t('hits') . " (kind, k, at) VALUES (?, ?, ?)", [$kind, $ip, now_ms()]); }
  static function limited($ip) { if (self::count('form_ok', $ip) >= 6) return true; self::hit('form_any', $ip); return self::count('form_any', $ip) > 30; }
  static function overLimit($ip) { return self::count('form_ok', $ip) >= 6 || self::count('form_any', $ip) >= 30; }

  static function validateSubmission($def, $fields, $files, $maxMB) {
    $errors = []; $clean = [];
    $maxFileBytes = $maxMB * 1048576; $maxLabel = $maxMB >= 1024 && $maxMB % 1024 === 0 ? ($maxMB / 1024) . ' GB' : $maxMB . ' MB';
    foreach ($def['fields'] as $f) {
      if ($f['type'] === 'file') {
        $file = null; foreach ($files as $x) if ($x['field'] === $f['name']) { $file = $x; break; }
        if (!$file) { if ($f['required']) $errors[$f['name']] = 'Anexe o arquivo.'; continue; }
        if ($file['size'] > $maxFileBytes) { $errors[$f['name']] = "O arquivo passa do limite de $maxLabel."; continue; }
        if (str_contains($f['accept'] ?? '', 'pdf') && substr($file['head'], 0, 5) !== '%PDF-') { $errors[$f['name']] = 'Envie um arquivo PDF.'; continue; }
        $clean[$f['name']] = ['file' => true, 'filename' => mb_substr(preg_replace('/[^\w.\- ]/', '_', basename(str_replace('\\', '/', $file['filename']))), 0, 120), 'size' => $file['size'], 'tmp' => $file['path']];
        continue;
      }
      $v = trim(str_replace("\r\n", "\n", js_str($fields[$f['name']] ?? '')));
      $max = $f['maxlength'] ?: ($f['type'] === 'textarea' ? 5000 : 200);
      if ($v === '') { if ($f['required']) $errors[$f['name']] = 'Campo obrigatório.'; continue; }
      if (mb_strlen($v) > $max) { $errors[$f['name']] = "Máximo de $max caracteres."; continue; }
      if ($f['type'] === 'email' && !preg_match(self::EMAIL, $v)) { $errors[$f['name']] = 'E-mail inválido.'; continue; }
      if ($f['type'] === 'tel' && !preg_match('/^[\d\s()+\-.]{8,20}$/', $v)) { $errors[$f['name']] = 'Telefone inválido.'; continue; }
      if (($f['type'] === 'select' || $f['type'] === 'radio') && $f['options'] && !in_array($v, $f['options'], true)) { $errors[$f['name']] = 'Opção inválida.'; continue; }
      $clean[$f['name']] = $v;
    }
    if ($def['consent'] && ($fields['_lgpd'] ?? null) !== '1') $errors['_lgpd'] = 'É necessário autorizar o uso dos dados.';
    return ['errors' => $errors, 'clean' => $clean];
  }

  private static function cleanup($files) { foreach ($files as $f) if (!empty($f['path']) && is_file($f['path']) && !is_uploaded_file($f['path'])) @unlink($f['path']); }

  static function submit($def, $fields, $files, $ip, $maxMB) {
    $s = self::settings(); $cfg = $s['forms'][$def['name']] ?? [];
    if (($cfg['enabled'] ?? null) === false) return [403, ['ok' => false, 'error' => 'Este formulário está temporariamente desativado.']];
    // armadilha para robôs: campo invisível preenchido
    if (!empty($fields['_hp'])) return [200, ['ok' => true]];
    if (self::limited($ip)) return [429, ['ok' => false, 'error' => 'Muitos envios em sequência. Aguarde alguns minutos.']];
    $r = self::validateSubmission($def, $fields, $files, $maxMB ?: self::DEFAULT_UPLOAD_MB);
    if ($r['errors']) return [422, ['ok' => false, 'error' => 'Revise os campos destacados.', 'fields' => $r['errors']]];

    self::hit('form_ok', $ip);
    $id = gmdate('Y-m-d') . '-' . bin2hex(random_bytes(6));
    $record = ['id' => $id, 'form' => $def['name'], 'at' => iso_now(), 'page' => mb_substr(js_str($fields['_page'] ?? ''), 0, 200), 'data' => [], 'files' => [], 'notify' => []];
    foreach ($r['clean'] as $k => $v) {
      if (is_array($v) && !empty($v['file'])) {
        // nome impossível de adivinhar: o anexo (dado pessoal) não fica acessível pelo endereço mesmo se o
        // servidor ignorar o bloqueio da pasta de dados
        $stored = $id . '-' . bin2hex(random_bytes(16)) . '-' . $v['filename'];
        $dest = mg_dirs()['attachments'] . '/' . $stored;
        if (!(is_uploaded_file($v['tmp']) ? move_uploaded_file($v['tmp'], $dest) : rename($v['tmp'], $dest))) return [500, ['ok' => false, 'error' => 'Não foi possível guardar o anexo.']];
        @chmod($dest, 0600);
        $record['files'][] = ['field' => $k, 'filename' => $v['filename'], 'stored' => $stored, 'size' => $v['size']];
      } else $record['data'][$k] = $v;
    }
    $label = function ($n) use ($def) { foreach ($def['fields'] as $f) if ($f['name'] === $n) return $f['label'] ?: $n; return $n; };
    $lines = []; foreach ($record['data'] as $k => $v) $lines[] = $label($k) . ': ' . $v;
    $text = "Novo envio do formulário \"{$def['title']}\" no site MedicGLOBAL\n{$record['at']}\n\n" . implode("\n", $lines)
      . ($record['files'] ? "\n\nAnexos (disponíveis no painel, em Envios recebidos, por " . self::RETENTION_MONTHS . ' meses): ' . implode(', ', array_map(fn($f) => $f['filename'], $record['files'])) : '') . "\n\nProtocolo: $id";
    if (!empty($cfg['emails']) && !empty($s['smtp']['host'])) {
      try {
        mail_send(array_merge($s['smtp'], ['pass' => open_secret($s['smtp']['pass'] ?? '')]), ['to' => $cfg['emails'], 'subject' => "[Site] {$def['title']} — " . (($record['data']['nome'] ?? '') ?: (($record['data']['email'] ?? '') ?: $id)), 'text' => $text, 'replyTo' => preg_match(self::EMAIL, $record['data']['email'] ?? '') ? $record['data']['email'] : '']);
        $record['notify'][] = ['via' => 'email', 'ok' => true];
      } catch (Throwable $e) { $record['notify'][] = ['via' => 'email', 'ok' => false, 'error' => $e->getMessage()]; }
    }
    if (!empty($cfg['webhook'])) {
      try { self::postJson(open_secret($cfg['webhook']), ['protocolo' => $id, 'formulario' => $def['name'], 'titulo' => $def['title'], 'recebidoEm' => $record['at'], 'pagina' => $record['page'], 'campos' => (object)$record['data'], 'anexos' => array_map(fn($f) => $f['filename'], $record['files'])]); $record['notify'][] = ['via' => 'webhook', 'ok' => true]; }
      catch (Throwable $e) { $record['notify'][] = ['via' => 'webhook', 'ok' => false, 'error' => $e->getMessage()]; }
    }
    DB::q("INSERT INTO " . DB::t('submissions') . " (id, form, at, record) VALUES (?, ?, ?, ?)", [$id, $def['name'], $record['at'], je($record)]);
    return [200, ['ok' => true, 'protocolo' => $id]];
  }

  static function postJson($url, $data) {
    if (!preg_match('#^https://#i', $url)) throw new RuntimeException('O webhook precisa usar https.');
    $ch = mg_curl(curl_init($url));
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => je($data), CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'User-Agent: MedicGLOBAL-CMS'], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
    $res = curl_exec($ch);
    if ($res === false) { $e = curl_error($ch); curl_close($ch); throw new RuntimeException(str_contains($e, 'timed out') ? 'Tempo esgotado no webhook' : $e); }
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    if ($code >= 300) throw new RuntimeException('Webhook respondeu HTTP ' . $code);
    return $code;
  }

  // envios de um formulário, do mais recente para o mais antigo
  static function list($name) {
    if (!preg_match('/^[\w-]+$/', (string)$name)) return [];
    return array_map(fn($r) => jd($r['record']), DB::q("SELECT record FROM " . DB::t('submissions') . " WHERE form=? ORDER BY at DESC, id DESC", [$name])->fetchAll());
  }
  static function formNames() { return array_column(DB::q("SELECT DISTINCT form FROM " . DB::t('submissions'))->fetchAll(), 'form'); }
  private static function dropFiles($r) { foreach ($r['files'] ?? [] as $f) if (preg_match('/^[\w.\- ]+$/', $f['stored'])) @unlink(mg_dirs()['attachments'] . '/' . $f['stored']); }
  // apaga envios (e anexos) com mais de RETENTION_MONTHS meses; devolve quantos saíram
  static function purge() {
    $limit = (new DateTime('now', new DateTimeZone('UTC')))->modify('-' . self::RETENTION_MONTHS . ' months');
    $iso = $limit->format('Y-m-d\TH:i:s.v\Z');
    $old = DB::q("SELECT id, record FROM " . DB::t('submissions') . " WHERE at < ?", [$iso])->fetchAll();
    foreach ($old as $r) { self::dropFiles(jd($r['record'], [])); DB::q("DELETE FROM " . DB::t('submissions') . " WHERE id=?", [$r['id']]); }
    foreach (glob(mg_dirs()['attachments'] . '/*') ?: [] as $p) if (is_file($p) && filemtime($p) < $limit->getTimestamp()) @unlink($p);
    return count($old);
  }
  static function removeSubmission($name, $id) {
    if (!preg_match('/^[\w-]+$/', (string)$name)) return null;
    $row = DB::q("SELECT record FROM " . DB::t('submissions') . " WHERE form=? AND id=?", [$name, (string)$id])->fetch();
    if (!$row) return null;
    $r = jd($row['record']);
    self::dropFiles($r);
    DB::q("DELETE FROM " . DB::t('submissions') . " WHERE form=? AND id=?", [$name, (string)$id]);
    return $r;
  }
  // caminho do anexo, só se ele pertencer ao envio indicado
  static function attachmentPath($name, $id, $stored) {
    if (!preg_match('/^[\w-]+$/', (string)$name)) return null;
    $row = DB::q("SELECT record FROM " . DB::t('submissions') . " WHERE form=? AND id=?", [$name, (string)$id])->fetch();
    if (!$row) return null;
    foreach (jd($row['record'])['files'] ?? [] as $f) if ($f['stored'] === $stored && preg_match('/^[\w.\- ]+$/', $f['stored'])) {
      $p = mg_dirs()['attachments'] . '/' . $f['stored'];
      return is_file($p) ? ['path' => $p, 'filename' => $f['filename']] : null;
    }
    return null;
  }
}
