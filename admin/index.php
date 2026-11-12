<?php
/* MedicGLOBAL — painel administrativo em PHP (/admin).
   Edita o conteúdo das páginas .html já publicadas (textos, links/CTAs, imagens, campos de formulário e SEO),
   com login, backup de cada alteração e registro de auditoria no MySQL. */
require __DIR__.'/lib/boot.php';

/* ---------- sem configuração: instruções ---------- */
if (!Config::ok()) { render_setup_config(); exit; }
require __DIR__.'/lib/auth.php';
require __DIR__.'/lib/store.php';

try { DB::conn(); }
catch (Throwable $e) { render_db_error($e); exit; }

start_session();
$p = $_GET['p'] ?? 'home';

/* ---------- primeiro acesso: criar administrador ---------- */
if (Auth::userCount() === 0 && $p !== 'setup') redirect('?p=setup');

switch ($p) {
  case 'setup':   route_setup(); break;
  case 'login':   route_login(); break;
  case 'logout':  Auth::logout(); redirect('?p=login'); break;
  case 'save':    route_save(); break;
  case 'upload':  route_upload(); break;
  case 'restore': route_restore(); break;
  case 'edit':    route_edit(); break;
  case 'history': route_history(); break;
  case 'audit':   route_audit(); break;
  case 'account': route_account(); break;
  case 'home':
  default:        route_home(); break;
}

/* ================= ROTAS ================= */

function route_setup() {
  if (Auth::userCount() > 0) { Auth::requireLogin(); }
  $err = '';
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $email = trim($_POST['email'] ?? ''); $pass = $_POST['password'] ?? ''; $pass2 = $_POST['password2'] ?? '';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $err = 'Informe um e-mail válido.';
    elseif (strlen($pass) < 8) $err = 'A senha precisa ter ao menos 8 caracteres.';
    elseif ($pass !== $pass2) $err = 'As senhas não conferem.';
    elseif (Auth::byEmail($email)) $err = 'Já existe um usuário com esse e-mail.';
    else {
      $id = Auth::create($email, $pass, 'admin');
      Store::audit($email, 'setup', 'Administrador criado');
      $_SESSION['uid'] = $id;
      redirect('?p=home');
    }
  }
  layout('Primeiro acesso', function() use ($err) { ?>
    <div class="login-card">
      <div class="brandmark"><b>MedicGLOBAL</b> <span class="badge">painel</span></div>
      <h1>Criar administrador</h1>
      <p class="lead">Este é o primeiro acesso. Crie o usuário administrador do painel.</p>
      <?php if ($err) echo '<p class="alert err">'.h($err).'</p>'; ?>
      <form method="post">
        <?php csrf_field(); ?>
        <label>E-mail <input type="email" name="email" required value="<?=h($_POST['email']??'')?>"></label>
        <label>Senha (mín. 8 caracteres) <input type="password" name="password" required minlength="8"></label>
        <label>Repita a senha <input type="password" name="password2" required></label>
        <button class="btn" type="submit">Criar e entrar</button>
      </form>
    </div>
  <?php }, false); }

function route_login() {
  if (Auth::current()) redirect('?p=home');
  $err = '';
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    [$ok, $msg] = Auth::login($_POST['email'] ?? '', $_POST['password'] ?? '');
    if ($ok) redirect('?p=home');
    $err = $msg;
  }
  layout('Entrar', function() use ($err) { ?>
    <div class="login-card">
      <div class="brandmark"><b>MedicGLOBAL</b> <span class="badge">painel</span></div>
      <h1>Entrar</h1>
      <p class="lead">Acesse para editar o conteúdo do site.</p>
      <?php if ($err) echo '<p class="alert err">'.h($err).'</p>'; ?>
      <form method="post">
        <?php csrf_field(); ?>
        <label>E-mail <input type="email" name="email" required autofocus value="<?=h($_POST['email']??'')?>"></label>
        <label>Senha <input type="password" name="password" required></label>
        <button class="btn" type="submit">Entrar</button>
      </form>
    </div>
  <?php }, false); }

function route_home() {
  $u = Auth::requireLogin();
  $pages = Store::pages();
  $pt = array_filter($pages, fn($p)=>$p['lang']==='pt');
  $en = array_filter($pages, fn($p)=>$p['lang']==='en');
  layout('Páginas', function() use ($pt, $en) { ?>
    <div class="page-head">
      <div>
        <div class="eyebrow">Conteúdo</div>
        <h1>Páginas do site</h1>
        <p>Escolha uma página para editar textos, links, imagens e SEO. O menu e o rodapé do site não são editados aqui.</p>
      </div>
    </div>
    <div class="plist-group">
      <h3>Português</h3>
      <div class="plist"><?php $i=0; foreach ($pt as $p) page_card($p, ++$i); ?></div>
    </div>
    <?php if ($en): ?>
    <div class="plist-group">
      <h3>Inglês (/en)</h3>
      <div class="plist"><?php $i=0; foreach ($en as $p) page_card($p, ++$i); ?></div>
    </div>
    <?php endif; ?>
  <?php }); }

function route_edit() {
  $u = Auth::requireLogin();
  $file = $_GET['file'] ?? '';
  $html = Store::read($file);
  if ($html === null) { http_response_code(404); layout('Não encontrada', fn()=>print('<div class="card"><p>Página não encontrada.</p><a class="btn" href="?p=home">Voltar</a></div>')); return; }
  $ex  = Html::extract($html);
  $seo = Store::seoGet($html);
  $byId = []; foreach ($ex['units'] as $unit) $byId[$unit->id] = $unit;
  $meta = Store::meta($file, strpos($file,'en/')===0?'en':'pt');
  $hash = sha1($html);
  $saved = isset($_GET['ok']);
  $enPrefix = strpos($file, 'en/') === 0 ? '../' : '';

  $crumbs = [['Páginas','?p=home'], [$meta['label'], '']];
  layout('Editar · '.$meta['label'], function() use ($ex, $byId, $seo, $meta, $file, $hash, $saved, $enPrefix) { ?>
    <?php if ($saved) echo '<p class="alert ok">Alterações salvas e publicadas.</p>'; ?>
    <?php if (!empty($_GET['err'])) echo '<p class="alert err">'.h($_GET['err']).'</p>'; ?>

    <div class="ed-head">
      <div>
        <div class="eyebrow">Editando página</div>
        <h1><?=h($meta['label'])?></h1>
        <div class="url"><?=h($meta['base'])?></div>
      </div>
      <div class="actions">
        <a class="btn ghost" href="<?=h($enPrefix.$meta['base'])?>" target="_blank" rel="noopener">Ver página ↗</a>
        <a class="btn ghost" href="?p=history&file=<?=urlencode($file)?>">Backups</a>
      </div>
    </div>

    <form method="post" action="?p=save" id="editor" data-enprefix="<?=h($enPrefix)?>">
      <?php csrf_field(); ?>
      <input type="hidden" name="file" value="<?=h($file)?>">
      <input type="hidden" name="h" value="<?=h($hash)?>">

      <details class="sec" open>
        <summary><span class="snum">SEO</span><span class="stitle">Busca e redes sociais</span><span class="chev">›</span></summary>
        <div class="sec-body">
          <div class="unit">
            <label class="flabel">Título da aba / Google (title)</label>
            <input type="text" name="seo[title]" maxlength="70" value="<?=h($seo['title'])?>">
          </div>
          <div class="unit">
            <label class="flabel">Descrição para o Google (meta description)</label>
            <textarea name="seo[desc]" rows="2" maxlength="180" class="auto"><?=h($seo['desc'])?></textarea>
          </div>
        </div>
      </details>

      <?php $sn=0; foreach ($ex['sections'] as $s): $sn++; ?>
        <details class="sec" open>
          <summary><span class="snum"><?=$sn?></span><span class="stitle"><?=h($s->label)?></span><span class="chev">›</span></summary>
          <div class="sec-body">
            <?php foreach ($s->units as $id): field_editor($byId[$id], $enPrefix); endforeach; ?>
          </div>
        </details>
      <?php endforeach; ?>

      <div class="savebar">
        <button class="btn" type="submit">Salvar e publicar</button>
        <a class="btn ghost" href="?p=home">Cancelar</a>
      </div>
    </form>
  <?php }, true, $crumbs); }

function route_save() {
  $u = Auth::requireLogin();
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') redirect('?p=home');
  csrf_check();
  $file = $_POST['file'] ?? '';
  $html = Store::read($file);
  if ($html === null) redirect('?p=home');
  $back = '?p=edit&file='.urlencode($file);
  if (sha1($html) !== ($_POST['h'] ?? '')) redirect($back.'&err='.rawurlencode('A página mudou desde que você abriu. Recarregue e refaça a edição.'));

  $ex = Html::extract($html);
  $byId = []; foreach ($ex['units'] as $unit) $byId[$unit->id] = $unit;

  $edits = []; $changes = []; $errs = [];
  foreach (($_POST['e'] ?? []) as $id => $vals) {
    $unit = $byId[$id] ?? null; if (!$unit) continue;
    $val = [];
    if ($unit->kind === 'text' || $unit->kind === 'link') {
      if (isset($vals['html'])) { $new = Html::sanitizeHtml($vals['html']); if ($new !== ($unit->base->html ?? '')) { $val['html']=$new; $changes[]=chg($unit,'Texto',$unit->base->html??'',$new); } }
    }
    if ($unit->kind === 'link') {
      if (isset($vals['href'])) { $hv = trim($vals['href']); if ($hv !== $unit->base->href) { if (Html::validHref($hv)) { $val['href']=$hv; $changes[]=chg($unit,'Destino do link',$unit->base->href,$hv); } else $errs[]='Link inválido em "'.Html::plain($unit->base->html??$unit->base->href).'".'; } }
      $nt = !empty($vals['newTab']); if ($nt !== (bool)$unit->base->newTab) $val['newTab']=$nt;
    }
    if ($unit->kind === 'image') {
      if (isset($vals['image'])) { $iv = trim($vals['image']); if ($iv !== $unit->base->image && $iv!=='') { $val['image']=$iv; $changes[]=chg($unit,'Imagem',$unit->base->image,$iv); } }
      if (isset($vals['alt'])) { $av = trim($vals['alt']); if ($av !== $unit->base->alt) $val['alt']=$av; }
    }
    if ($unit->kind === 'field') {
      if (isset($vals['placeholder']) && $unit->hasPlaceholder) { $pv=trim($vals['placeholder']); if ($pv !== $unit->base->placeholder) $val['placeholder']=$pv; }
      $rq = !empty($vals['required']); if ($rq !== (bool)$unit->base->required) $val['required']=$rq;
      if (isset($vals['maxlength'])) { $mv=preg_replace('/\D/','',$vals['maxlength']); if ($mv !== (string)$unit->base->maxlength) $val['maxlength']=$mv; }
    }
    if ($val) $edits[$id] = ['kind'=>$unit->kind, 'base'=>$unit->base, 'value'=>$val];
  }

  $new = $html;
  if ($edits) { $r = Html::apply($new, $edits); $new = $r['html']; }

  // SEO
  $seo = Store::seoGet($html);
  $nt = $_POST['seo']['title'] ?? null; $nd = $_POST['seo']['desc'] ?? null;
  $seoT = ($nt !== null && trim($nt) !== $seo['title']) ? trim($nt) : null;
  $seoD = ($nd !== null && trim($nd) !== $seo['desc']) ? trim($nd) : null;
  if ($seoT !== null || $seoD !== null) {
    $new = Store::seoSet($new, $seoT, $seoD);
    if ($seoT !== null) $changes[] = ['field'=>'SEO · título','before'=>$seo['title'],'after'=>$seoT];
    if ($seoD !== null) $changes[] = ['field'=>'SEO · descrição','before'=>$seo['desc'],'after'=>$seoD];
  }

  if ($errs && !$changes) redirect($back.'&err='.rawurlencode(implode(' ', $errs)));

  if ($new !== $html) {
    Store::backup($file, $html, $u['email']);
    Store::write($file, $new);
    Store::audit($u['email'], 'edit', 'Editou '.$file, $changes);
  }
  $msg = $errs ? '&err='.rawurlencode('Salvo, mas alguns campos foram ignorados: '.implode(' ', $errs)) : '&ok=1';
  redirect($back.$msg);
}

function route_upload() {
  $u = Auth::requireLogin();
  header('Content-Type: application/json; charset=utf-8');
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') { echo json_encode(['ok'=>false,'error'=>'método']); return; }
  csrf_check();
  if (empty($_FILES['img']) || $_FILES['img']['error'] !== UPLOAD_ERR_OK) { echo json_encode(['ok'=>false,'error'=>'Falha no envio.']); return; }
  $f = $_FILES['img'];
  if ($f['size'] > 6*1024*1024) { echo json_encode(['ok'=>false,'error'=>'Imagem acima de 6 MB.']); return; }
  $ext = strtolower(pathinfo($f['name'], PATHINFO_EXTENSION));
  $okExt = ['jpg'=>'image/jpeg','jpeg'=>'image/jpeg','png'=>'image/png','webp'=>'image/webp','gif'=>'image/gif','avif'=>'image/avif'];
  $info = @getimagesize($f['tmp_name']);
  if (!isset($okExt[$ext]) || !$info) { echo json_encode(['ok'=>false,'error'=>'Formato não suportado (use JPG, PNG, WEBP, GIF ou AVIF).']); return; }
  $dir = Config::siteRoot().'/'.Config::uploadsDir();
  if (!is_dir($dir)) @mkdir($dir, 0775, true);
  $safe = preg_replace('/[^a-z0-9]+/','-', strtolower(pathinfo($f['name'], PATHINFO_FILENAME)));
  $safe = trim(substr($safe,0,40),'-') ?: 'img';
  $name = $safe.'-'.substr(bin2hex(random_bytes(4)),0,8).'.'.$ext;
  if (!move_uploaded_file($f['tmp_name'], $dir.'/'.$name)) { echo json_encode(['ok'=>false,'error'=>'Não foi possível salvar.']); return; }
  Store::audit($u['email'], 'upload', 'Enviou '.Config::uploadsDir().'/'.$name);
  echo json_encode(['ok'=>true, 'path'=>Config::uploadsDir().'/'.$name]);
}

function route_history() {
  $u = Auth::requireLogin();
  $file = $_GET['file'] ?? '';
  if (!Store::path($file)) redirect('?p=home');
  $meta = Store::meta($file, strpos($file,'en/')===0?'en':'pt');
  $list = Store::backups($file);
  layout('Backups · '.$meta['label'], function() use ($list, $file, $meta) { ?>
    <div class="page-head"><div><a class="back" href="?p=edit&file=<?=urlencode($file)?>">← Editar</a><h1>Backups — <?=h($meta['label'])?></h1></div></div>
    <p class="muted">Cada vez que você salva, a versão anterior fica guardada aqui. É possível restaurá-la.</p>
    <?php if (!$list): ?><div class="card"><p>Nenhum backup ainda.</p></div><?php else: ?>
    <table class="table">
      <thead><tr><th>Quando</th><th>Por</th><th></th></tr></thead>
      <tbody><?php foreach ($list as $b): ?>
        <tr><td><?=h($b['at'])?></td><td><?=h($b['user_email'])?></td>
        <td><form method="post" action="?p=restore" onsubmit="return confirm('Restaurar esta versão? A versão atual vira um novo backup.')">
          <?php csrf_field(); ?><input type="hidden" name="file" value="<?=h($file)?>"><input type="hidden" name="id" value="<?=h($b['id'])?>">
          <button class="btn ghost small" type="submit">Restaurar</button></form></td></tr>
      <?php endforeach; ?></tbody>
    </table>
    <?php endif; ?>
  <?php }); }

function route_restore() {
  $u = Auth::requireLogin();
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') redirect('?p=home');
  csrf_check();
  $file = $_POST['file'] ?? ''; $id = (int)($_POST['id'] ?? 0);
  $b = Store::backupHtml($id);
  $cur = Store::read($file);
  if ($b && $cur !== null && $b['file'] === $file) {
    Store::backup($file, $cur, $u['email']);
    Store::write($file, $b['html']);
    Store::audit($u['email'], 'restore', 'Restaurou '.$file.' (backup #'.$id.')');
  }
  redirect('?p=edit&file='.urlencode($file).'&ok=1');
}

function route_audit() {
  Auth::requireLogin();
  $log = Store::auditLog();
  layout('Auditoria', function() use ($log) { ?>
    <div class="page-head"><div><a class="back" href="?p=home">← Páginas</a><h1>Auditoria</h1></div></div>
    <p class="muted">Quem alterou o quê, e quando.</p>
    <table class="table">
      <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th><th>Mudanças</th></tr></thead>
      <tbody><?php foreach ($log as $e): $ch = $e['changes'] ? json_decode($e['changes'], true) : []; ?>
        <tr><td class="nowrap"><?=h($e['at'])?></td><td><?=h($e['user_email'])?></td><td><?=h($e['action'])?></td><td><?=h($e['detail'])?></td>
        <td><?php if ($ch): ?><details><summary><?=count($ch)?> campo(s)</summary><ul class="diff">
          <?php foreach ($ch as $c): ?><li><b><?=h($c['field']??'')?>:</b> <span class="was"><?=h(mb_strimwidth(Html::plain($c['before']??''),0,60,'…'))?></span> → <span class="now"><?=h(mb_strimwidth(Html::plain($c['after']??''),0,60,'…'))?></span></li><?php endforeach; ?>
        </ul></details><?php endif; ?></td></tr>
      <?php endforeach; ?></tbody>
    </table>
  <?php }); }

function route_account() {
  $u = Auth::requireLogin();
  $msg = ''; $err = '';
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $cur = $_POST['current'] ?? ''; $new = $_POST['password'] ?? ''; $new2 = $_POST['password2'] ?? '';
    if (!password_verify($cur, $u['pass_hash'])) $err = 'Senha atual incorreta.';
    elseif (strlen($new) < 8) $err = 'A nova senha precisa ter ao menos 8 caracteres.';
    elseif ($new !== $new2) $err = 'As senhas não conferem.';
    else { Auth::setPassword($u['id'], $new); Store::audit($u['email'],'password','Trocou a própria senha'); $msg = 'Senha atualizada.'; }
  }
  layout('Minha conta', function() use ($u, $msg, $err) { ?>
    <div class="page-head"><div><a class="back" href="?p=home">← Páginas</a><h1>Minha conta</h1></div></div>
    <div class="card narrow">
      <p class="muted"><?=h($u['email'])?></p>
      <?php if ($msg) echo '<p class="alert ok">'.h($msg).'</p>'; if ($err) echo '<p class="alert err">'.h($err).'</p>'; ?>
      <form method="post"><?php csrf_field(); ?>
        <label>Senha atual <input type="password" name="current" required></label>
        <label>Nova senha <input type="password" name="password" required minlength="8"></label>
        <label>Repita a nova senha <input type="password" name="password2" required></label>
        <button class="btn" type="submit">Trocar senha</button>
      </form>
    </div>
  <?php }); }

/* ================= COMPONENTES ================= */

function chg($unit, $label, $before, $after) { return ['field'=>$label.' · '.$unit->label, 'before'=>$before, 'after'=>$after]; }

function csrf_field() { echo '<input type="hidden" name="csrf" value="'.h(csrf_token()).'">'; }

function page_card($p, $n = 1) {
  $href = '?p=edit&file='.urlencode($p['file']); ?>
  <a class="prow" href="<?=$href?>">
    <span class="num"><?=$n?></span>
    <span><span class="t"><?=h($p['label'])?></span><span class="f"><?=h($p['base'])?></span></span>
    <span class="go">›</span>
  </a>
<?php }

function field_editor($u, $enPrefix) {
  $name = 'e['.$u->id.']';
  $sr = $u->sr ?? false;
  $limit = $u->limits->html ?? ($u->limits->placeholder ?? 300);
  echo '<div class="unit">';
  echo '<label class="flabel">'.h($u->label).($sr ? ' <span class="tag">leitores de tela</span>' : '').'</label>';

  if ($u->kind === 'text' || ($u->kind === 'link' && isset($u->base->html))) {
    $val = $u->base->html ?? '';
    $long = mb_strlen(Html::plain($val)) > 70 || in_array($u->tag, ['p','li','dd','blockquote']);
    if ($long) echo '<textarea name="'.$name.'[html]" rows="2" maxlength="'.(int)$limit.'" class="auto">'.h($val).'</textarea>';
    else echo '<input type="text" name="'.$name.'[html]" maxlength="'.(int)$limit.'" value="'.h($val).'">';
  }
  if ($u->kind === 'link') {
    echo '<div class="linkbox"><div class="row">';
    echo '<label class="sub">Destino (URL ou página.html)<input type="text" name="'.$name.'[href]" value="'.h($u->base->href).'"></label>';
    echo '<label class="chk"><input type="checkbox" name="'.$name.'[newTab]" '.($u->base->newTab?'checked':'').'> Abrir em nova aba</label>';
    echo '</div></div>';
  }
  if ($u->kind === 'image') {
    $src = $u->base->image;
    $preview = preg_match('#^https?://#', $src) ? $src : $enPrefix.ltrim($src,'/');
    echo '<div class="imgrow">';
    echo '<img class="thumb" src="'.h($preview).'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
    echo '<div class="imgfields">';
    echo '<label class="sub">Arquivo da imagem<input type="text" name="'.$name.'[image]" value="'.h($src).'" data-img></label>';
    echo '<label class="sub">Texto alternativo (alt)<input type="text" name="'.$name.'[alt]" maxlength="160" value="'.h($u->base->alt).'"></label>';
    echo '<button type="button" class="btn ghost small upload">Enviar nova imagem…</button>';
    echo '</div></div>';
  }
  if ($u->kind === 'field') {
    echo '<div class="row">';
    if ($u->hasPlaceholder) echo '<label class="sub">Texto de exemplo (placeholder)<input type="text" name="'.$name.'[placeholder]" maxlength="90" value="'.h($u->base->placeholder).'"></label>';
    echo '<label class="chk"><input type="checkbox" name="'.$name.'[required]" '.($u->base->required?'checked':'').'> Obrigatório</label>';
    echo '</div>';
  }
  echo '</div>';
}

/* ================= LAYOUT ================= */

function layout($title, $body, $chrome = true, $crumbs = null) {
  $u = class_exists('Auth') ? Auth::current() : null;
  $active = $_GET['p'] ?? 'home';
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: same-origin'); ?>
<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?=h($title)?> · Painel MedicGLOBAL</title>
<link rel="icon" href="../assets/img/brand/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Poppins:wght@400;500;600&display=swap">
<link rel="stylesheet" href="ui/app.css">
</head><body>
<?php if ($chrome && $u): ?>
<div class="shell">
  <aside class="side">
    <a class="side-logo" href="?p=home"><b>MedicGLOBAL</b> <span class="badge">painel</span></a>
    <div class="side-group">Conteúdo</div>
    <a class="nav <?=$active==='home'||$active==='edit'?'is-active':''?>" href="?p=home">Páginas</a>
    <div class="side-group">Registros</div>
    <a class="nav <?=$active==='audit'?'is-active':''?>" href="?p=audit">Auditoria</a>
    <a class="nav <?=$active==='account'?'is-active':''?>" href="?p=account">Minha conta</a>
    <a class="nav" href="?p=logout">Sair</a>
    <div class="side-user">
      <span class="avatar"><?=h(strtoupper(mb_substr($u['email'],0,1)))?></span>
      <span class="who"><b><?=h(explode('@',$u['email'])[0])?></b><span><?=h($u['email'])?></span></span>
    </div>
  </aside>
  <div class="main">
    <header class="top"><nav class="crumbs"><?php if ($crumbs) { $last=count($crumbs)-1; foreach ($crumbs as $i=>$c){ if($i) echo '<span class="sep">/</span>'; if($i===$last||empty($c[1])) echo '<b>'.h($c[0]).'</b>'; else echo '<a href="'.h($c[1]).'">'.h($c[0]).'</a>'; } } else echo '<b>'.h($title).'</b>'; ?></nav></header>
    <main class="content"><?php $body(); ?></main>
  </div>
</div>
<?php else: ?>
<div class="login"><?php $body(); ?></div>
<?php endif; ?>
<script src="ui/app.js"></script>
</body></html><?php }

function render_setup_config() { ?>
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Configurar painel</title><link rel="stylesheet" href="ui/app.css"></head>
<body><main class="wrap"><div class="card"><h1>Configurar o painel</h1>
<p>Falta criar o arquivo de configuração com os dados do MySQL.</p>
<ol class="steps">
<li>Na pasta <code>admin/</code>, copie <code>config.sample.php</code> para <code>config.php</code>.</li>
<li>Abra <code>config.php</code> e preencha <b>host, nome do banco, usuário e senha</b> do MySQL da hospedagem.</li>
<li>Recarregue esta página. As tabelas do painel são criadas sozinhas e você poderá cadastrar o administrador.</li>
</ol></div></main></body></html><?php }

function render_db_error($e) { ?>
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Erro de banco</title><link rel="stylesheet" href="ui/app.css"></head>
<body><main class="wrap"><div class="card"><h1>Não foi possível conectar ao MySQL</h1>
<p class="alert err"><?=h($e->getMessage())?></p>
<p class="muted">Confira host, nome do banco, usuário e senha em <code>admin/config.php</code>.</p></div></main></body></html><?php }
