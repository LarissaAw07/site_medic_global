<?php
/* Páginas do site, backups no MySQL, auditoria e SEO (title/description). O conteúdo continua nos .html do site. */

class Store {
  // nomes amigáveis das páginas (o resto usa o próprio nome do arquivo)
  static $NAMES = [
    'index.html'=>'Início', 'beneficiario.html'=>'Para você', 'planos.html'=>'Planos',
    'rede-credenciada.html'=>'Rede credenciada', 'area-do-beneficiario.html'=>'Área do beneficiário',
    'guia-medico.html'=>'Guia médico', 'telemedicina.html'=>'Telemedicina', 'servicos.html'=>'Serviços',
    'atendimento.html'=>'Atendimento', 'contato.html'=>'Contato', 'medicglobal.html'=>'Sobre a MedicGLOBAL',
    'trabalhe-conosco.html'=>'Trabalhe conosco', 'documentos.html'=>'Documentos', 'conteudos.html'=>'Conteúdos',
    'privacidade.html'=>'Política de privacidade', '404.html'=>'Página de erro (404)',
    'rn565.html'=>'RN 565', 'idss.html'=>'IDSS',
  ];

  // Lista as páginas editáveis: *.html da raiz e de en/. Devolve [ ['file'=>..,'label'=>..,'lang'=>..], ... ]
  static function pages() {
    $root = Config::siteRoot();
    $out = [];
    foreach (self::scan($root, '') as $f) $out[] = self::meta($f, 'pt');
    foreach (self::scan($root.'/en', 'en/') as $f) $out[] = self::meta($f, 'en');
    return $out;
  }
  static function scan($dir, $prefix) {
    if (!is_dir($dir)) return [];
    $files = [];
    foreach (scandir($dir) as $f) if (preg_match('/\.html$/i', $f) && is_file($dir.'/'.$f)) $files[] = $prefix.$f;
    sort($files);
    return $files;
  }
  static function meta($file, $lang) {
    $base = basename($file);
    $label = self::$NAMES[$base] ?? ucfirst(preg_replace(['/\.html$/','/[-_]/'],['',' '],$base));
    return ['file'=>$file, 'label'=>$label, 'lang'=>$lang, 'base'=>$base];
  }

  // Caminho absoluto seguro para um arquivo da lista (impede path traversal)
  static function path($file) {
    foreach (self::pages() as $p) if ($p['file'] === $file) return Config::siteRoot().'/'.$file;
    return null;
  }
  static function read($file) { $p = self::path($file); return $p && is_file($p) ? file_get_contents($p) : null; }
  static function write($file, $html) {
    $p = self::path($file); if (!$p) return false;
    $tmp = $p.'.'.getmypid().'.tmp';
    file_put_contents($tmp, $html, LOCK_EX);
    return rename($tmp, $p);
  }

  /* ---------- backup / restauração (MySQL) ---------- */
  static function backup($file, $html, $userEmail) {
    DB::conn()->prepare("INSERT INTO ".DB::t('backup')." (at,user_email,file,html) VALUES (NOW(),?,?,?)")->execute([$userEmail, $file, $html]);
    // mantém os 30 backups mais recentes por arquivo
    $ids = DB::conn()->prepare("SELECT id FROM ".DB::t('backup')." WHERE file=? ORDER BY id DESC LIMIT 1000 OFFSET 30");
    $ids->execute([$file]);
    $old = $ids->fetchAll(PDO::FETCH_COLUMN);
    if ($old) DB::conn()->exec("DELETE FROM ".DB::t('backup')." WHERE id IN (".implode(',', array_map('intval',$old)).")");
  }
  static function backups($file) {
    $st = DB::conn()->prepare("SELECT id,at,user_email FROM ".DB::t('backup')." WHERE file=? ORDER BY id DESC");
    $st->execute([$file]);
    return $st->fetchAll();
  }
  static function backupHtml($id) {
    $st = DB::conn()->prepare("SELECT file,html FROM ".DB::t('backup')." WHERE id=? LIMIT 1");
    $st->execute([$id]);
    return $st->fetch() ?: null;
  }

  /* ---------- auditoria ---------- */
  static function audit($userEmail, $action, $detail='', $changes=null) {
    DB::conn()->prepare("INSERT INTO ".DB::t('audit')." (at,user_email,action,detail,changes) VALUES (NOW(),?,?,?,?)")
      ->execute([$userEmail, $action, mb_substr($detail,0,255), $changes ? json_encode($changes, JSON_UNESCAPED_UNICODE) : null]);
  }
  static function auditLog($limit=200) {
    $st = DB::conn()->query("SELECT * FROM ".DB::t('audit')." ORDER BY id DESC LIMIT ".(int)$limit);
    return $st->fetchAll();
  }

  /* ---------- SEO (title + meta description, espelhados em og/twitter) ---------- */
  static function seoGet($html) {
    $title = preg_match('/<title[^>]*>([\s\S]*?)<\/title>/i', $html, $m) ? html_entity_decode(trim($m[1]), ENT_QUOTES, 'UTF-8') : '';
    $desc  = preg_match('/<meta\s+[^>]*name=["\']description["\'][^>]*content=["\']([^"\']*)["\']/i', $html, $m) ? html_entity_decode($m[1], ENT_QUOTES, 'UTF-8') : '';
    return ['title'=>$title, 'desc'=>$desc];
  }
  static function seoSet($html, $title, $desc) {
    $t = Html::esc($title); $d = Html::esc($desc);
    if ($title !== null) {
      $html = preg_replace('/(<title[^>]*>)([\s\S]*?)(<\/title>)/i', '${1}'.self::rep($t).'$3', $html, 1);
      $html = self::setMeta($html, 'property', 'og:title', $t);
      $html = self::setMeta($html, 'name', 'twitter:title', $t);
    }
    if ($desc !== null) {
      $html = self::setMeta($html, 'name', 'description', $d);
      $html = self::setMeta($html, 'property', 'og:description', $d);
      $html = self::setMeta($html, 'name', 'twitter:description', $d);
    }
    return $html;
  }
  // atualiza o content="" de uma <meta name|property="key">, se existir
  static function setMeta($html, $attr, $key, $value) {
    $re = '/(<meta\s+[^>]*'.$attr.'=["\']'.preg_quote($key,'/').'["\'][^>]*content=["\'])([^"\']*)(["\'])/i';
    return preg_replace($re, '${1}'.self::rep($value).'$3', $html, 1);
  }
  static function rep($s) { return str_replace(['\\','$'], ['\\\\','\\$'], $s); } // neutraliza refs de backreference no replacement
}
