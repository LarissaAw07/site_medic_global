<?php
/* MedicGLOBAL — painel PHP: leitura e edição do HTML JÁ PUBLICADO (sem dependências).
   Port do núcleo de cms/html.js (Node), adaptado para HTML final (sem tokens {{...}}):
     parse()   — árvore mínima com as posições (em bytes) de cada trecho;
     extract() — lista os campos editáveis de uma página (texto, links/CTAs, imagens, campos de formulário),
                 agrupados pelas seções de <main>;
     apply()   — grava as edições de volta no HTML, trecho a trecho, sem tocar no resto.
   Trabalha com posições em BYTES (substr/strpos do PHP) do começo ao fim — consistente com UTF-8. */

class Html {
  static $VOID  = ['area'=>1,'base'=>1,'br'=>1,'col'=>1,'embed'=>1,'hr'=>1,'img'=>1,'input'=>1,'link'=>1,'meta'=>1,'source'=>1,'track'=>1,'wbr'=>1];
  static $RAW   = ['script'=>1,'style'=>1,'svg'=>1,'template'=>1,'textarea'=>1];
  static $INLINE= ['em'=>1,'strong'=>1,'b'=>1,'i'=>1,'br'=>1,'u'=>1,'mark'=>1,'sup'=>1,'sub'=>1];
  static $TEXT_SKIP = ['script'=>1,'style'=>1,'svg'=>1,'template'=>1,'select'=>1,'textarea'=>1,'option'=>1,'noscript'=>1];
  static $LIMITS = ['h1'=>90,'h2'=>120,'h3'=>120,'h4'=>140,'h5'=>140,'h6'=>140,'p'=>700,'li'=>400,'td'=>300,'th'=>120,'dt'=>160,'dd'=>500,'blockquote'=>700,'figcaption'=>240,'label'=>140,'summary'=>200,'legend'=>120,'button'=>60,'a'=>90,'span'=>120,'small'=>160,'strong'=>160,'b'=>160,'em'=>160,'caption'=>200];
  static $TAG_NAMES = ['h1'=>'Título principal','h2'=>'Título','h3'=>'Subtítulo','h4'=>'Subtítulo','h5'=>'Subtítulo','h6'=>'Subtítulo','p'=>'Parágrafo','li'=>'Item de lista','td'=>'Célula','th'=>'Cabeçalho de tabela','dt'=>'Termo','dd'=>'Descrição','blockquote'=>'Citação','figcaption'=>'Legenda','label'=>'Rótulo do campo','summary'=>'Pergunta / título do bloco','legend'=>'Título do grupo','button'=>'Botão','small'=>'Texto de apoio','strong'=>'Destaque','b'=>'Destaque','span'=>'Texto','caption'=>'Legenda da tabela'];

  static function node($tag, $start, $openEnd) {
    $n = new stdClass; $n->type='el'; $n->tag=$tag; $n->attrs=[]; $n->children=[];
    $n->start=$start; $n->openEnd=$openEnd; $n->insertAt=$openEnd; $n->closeStart=$openEnd; $n->end=$openEnd; $n->parent=null;
    return $n;
  }

  /* ---------- parser ---------- */
  static function parse($src) {
    $len = strlen($src);
    $root = self::node('#root', 0, 0); $root->closeStart=$len; $root->end=$len;
    $stack = [$root]; $i=0; $textStart=0;
    $flush = function($end) use (&$stack, &$textStart) {
      if ($end > $textStart) { $t=new stdClass; $t->type='text'; $t->start=$textStart; $t->end=$end; $stack[count($stack)-1]->children[]=$t; }
    };
    while ($i < $len) {
      $c = $src[$i];
      if ($c !== '<') { $i++; continue; }
      if (substr($src,$i,4) === '<!--') {
        $flush($i);
        $e = strpos($src,'-->',$i+4); $end = $e===false ? $len : $e+3;
        $cm=new stdClass; $cm->type='comment'; $cm->start=$i; $cm->end=$end; $cm->text=substr($src,$i+4,($end-3)-($i+4));
        $stack[count($stack)-1]->children[]=$cm;
        $i=$textStart=$end; continue;
      }
      $close = ($i+1<$len && $src[$i+1]==='/');
      if (!preg_match('/^[a-zA-Z][\w-]*/', substr($src,$i+($close?2:1),39), $m)) { $i++; continue; }
      $tag = strtolower($m[0]);
      if ($close) {
        $flush($i);
        $gt = strpos($src,'>',$i); $end = $gt===false ? $len : $gt+1;
        for ($k=count($stack)-1; $k>0; $k--) if ($stack[$k]->tag===$tag) {
          while (count($stack) > $k+1) { $x=array_pop($stack); $x->closeStart=$x->end=$i; }
          $el=array_pop($stack); $el->closeStart=$i; $el->end=$end; break;
        }
        $i=$textStart=$end; continue;
      }
      $flush($i);
      $j = $i+1+strlen($tag);
      $attrs = [];
      while ($j<$len && $src[$j]!=='>' && !($src[$j]==='/' && $j+1<$len && $src[$j+1]==='>')) {
        if (ctype_space($src[$j])) { $j++; continue; }
        if (!preg_match('/^[^\s=>\/]+/', substr($src,$j,200), $am)) { $j++; continue; }
        $a=new stdClass; $a->name=strtolower($am[0]); $a->start=$j; $a->value=null; $a->vStart=-1; $a->vEnd=-1;
        $j += strlen($am[0]);
        if ($j<$len && $src[$j]==='=') {
          $j++;
          $q = $j<$len ? $src[$j] : '';
          if ($q==='"' || $q==="'") { $a->vStart=$j+1; $qe=strpos($src,$q,$j+1); $a->vEnd = $qe===false ? $len : $qe; $j=$a->vEnd+1; }
          else { $a->vStart=$j; while ($j<$len && !preg_match('/[\s>]/',$src[$j])) $j++; $a->vEnd=$j; }
          $a->value = substr($src,$a->vStart,$a->vEnd-$a->vStart);
        }
        $a->end=$j; $attrs[]=$a;
      }
      $selfClose = ($j<$len && $src[$j]==='/');
      $gt = strpos($src,'>',$j); $openEnd = $gt===false ? $len : $gt+1;
      $el = self::node($tag,$i,$openEnd);
      $el->attrs=$attrs; $el->insertAt = $selfClose ? $j : $openEnd-1; $el->closeStart=$openEnd; $el->end=$openEnd; $el->parent=$stack[count($stack)-1];
      $stack[count($stack)-1]->children[]=$el;
      $i=$textStart=$openEnd;
      if (isset(self::$VOID[$tag]) || $selfClose) continue;
      if (isset(self::$RAW[$tag])) {
        $e = stripos($src,'</'.$tag,$openEnd);
        $el->closeStart = $e===false ? $len : $e;
        $el->end = $e===false ? $len : (strpos($src,'>',$e)+1);
        if ($tag==='textarea') { $t=new stdClass; $t->type='text'; $t->start=$openEnd; $t->end=$el->closeStart; $el->children[]=$t; }
        $i=$textStart=$el->end; continue;
      }
      $stack[]=$el;
    }
    $flush($len);
    return $root;
  }

  /* ---------- utilidades de árvore ---------- */
  static function attr($el,$n){ foreach($el->attrs as $a) if($a->name===$n) return $a; return null; }
  static function attrVal($el,$n){ $a=self::attr($el,$n); return $a? $a->value : null; }
  static function hasClass($el,$c){ return strpos(' '.(self::attrVal($el,'class')??'').' ', ' '.$c.' ')!==false; }
  static function findTag($node,$tag){ foreach($node->children as $c){ if($c->type!=='el') continue; if($c->tag===$tag) return $c; $r=self::findTag($c,$tag); if($r) return $r; } return null; }
  static function closest($el,$tag){ for($p=$el->parent??null;$p;$p=($p->parent??null)) if($p->tag===$tag) return $p; return null; }

  static function decode($s){
    $s = str_replace(['&nbsp;','&amp;','&lt;','&gt;','&quot;','&#39;'], [' ','&','<','>','"',"'"], $s);
    $s = preg_replace_callback('/&#(\d+);/', fn($m)=>mb_chr((int)$m[1],'UTF-8'), $s);
    $s = preg_replace_callback('/&#x([\da-f]+);/i', fn($m)=>mb_chr(hexdec($m[1]),'UTF-8'), $s);
    return $s;
  }
  static function plain($s){ $s = preg_replace('/<[^>]*>/','',$s); return trim(preg_replace('/\s+/',' ', self::decode($s))); }
  static function hasWords($s){ return (bool)preg_match('/[\p{L}\p{N}]/u', self::plain($s)); }

  static function isIcon($src,$n){
    if ($n->type==='comment') return true;
    if ($n->type==='text') return false;
    if ($n->tag==='svg') return true;
    if ($n->tag==='i' || $n->tag==='span') {
      if (count($n->children)===0) return false;
      foreach ($n->children as $c) if (!(self::isIcon($src,$c) || ($c->type==='text' && trim(substr($src,$c->start,$c->end-$c->start))===''))) return false;
      return true;
    }
    return false;
  }
  static function isBlank($src,$n){ return $n->type==='text' && trim(substr($src,$n->start,$n->end-$n->start))===''; }

  static function inlineRange($src,$el){
    $kids=$el->children; $a=0; $b=count($kids);
    while ($a<$b && (self::isIcon($src,$kids[$a])||self::isBlank($src,$kids[$a]))) $a++;
    while ($b>$a && (self::isIcon($src,$kids[$b-1])||self::isBlank($src,$kids[$b-1]))) $b--;
    if ($a>=$b) return null;
    $ok = function($n) use (&$ok,$src){
      if ($n->type==='text') return true;
      if ($n->type==='el' && isset(self::$INLINE[$n->tag]) && !($n->tag==='i' && self::isIcon($src,$n))) {
        foreach ($n->attrs as $x) if ($x->name!=='class') return false;
        foreach ($n->children as $c) if (!$ok($c)) return false;
        return true;
      }
      return false;
    };
    for ($k=$a;$k<$b;$k++) if (!$ok($kids[$k])) return null;
    $s=$kids[$a]->start; $e=$kids[$b-1]->end;
    while ($s<$e && ctype_space($src[$s])) $s++;
    while ($e>$s && ctype_space($src[$e-1])) $e--;
    return [$s,$e];
  }

  static function limitFor($kind,$tag,$baseText){
    if ($kind==='alt') return 160; if ($kind==='placeholder') return 90; if ($kind==='href') return 500;
    $d = self::$LIMITS[$tag] ?? 300;
    return max($d, (int)ceil(strlen($baseText??'')*1.3));
  }

  static function elRef($el){
    $o=new stdClass; $o->start=$el->start; $o->openEnd=$el->openEnd; $o->insertAt=$el->insertAt; $o->attrs=[];
    foreach ($el->attrs as $a){ $b=new stdClass; $b->name=$a->name; $b->start=$a->start; $b->end=$a->end; $b->vStart=$a->vStart; $b->vEnd=$a->vEnd; $b->value=$a->value; $o->attrs[]=$b; }
    return $o;
  }
  static function findAttr($u,$name){ foreach($u->el->attrs as $a) if($a->name===$name) return $a; return null; }

  static function cap($s){ if(strtoupper($s)===$s) return substr($s,0,1).strtolower(substr($s,1)); return strtoupper(substr($s,0,1)).substr($s,1); }

  static function sectionLabel($src,$el,$comment){
    if ($comment) {
      $t = trim(preg_replace('/\s+/',' ',$comment));
      $t = preg_replace('/^\d+\s*·\s*/','',$t);
      $parts = preg_split('/ — | – |\.|:|\(/',$t);
      $first = trim($parts[0]);
      $NAMES = ['Hero'=>'Banner principal','Page hero'=>'Topo da página','Medicglobal'=>'Sobre a MedicGLOBAL','Cta final'=>'Chamada final'];
      if (preg_match('/^banner\b/i',$first)) return 'Banner principal';
      if ($first!=='' && strlen($first)<70 && !preg_match('#/|conforme|molde#i',$first)) { $c=self::cap($first); return $NAMES[$c] ?? $c; }
    }
    $al = self::attrVal($el,'aria-label'); if ($al) return $al;
    $lb = self::attrVal($el,'aria-labelledby');
    if ($lb && preg_match('/id=["\']'.preg_quote($lb,'/').'["\'][^>]*>([\s\S]*?)<\//',$src,$m)) return substr(self::plain($m[1]),0,70);
    if (preg_match('/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/',substr($src,$el->start,$el->end-$el->start),$h) && self::plain($h[1])!=='') return substr(self::plain($h[1]),0,70);
    $inner = substr($src,$el->start,$el->end-$el->start);
    if (preg_match('/aria-label="([^"]{3,70})"/',$inner,$al2)) return $al2[1];
    $txt = self::plain(preg_replace('/^<[^>]*>/','',$inner));
    if ($txt!=='') return substr($txt,0,60);
    return self::cap($el->tag).(self::attrVal($el,'class') ? ' · '.explode(' ',self::attrVal($el,'class'))[0] : '');
  }

  static function unitLabel($u){
    if ($u->kind==='image' || $u->kind==='pic') return !empty($u->decorative) ? 'Imagem (decorativa)' : 'Imagem';
    if ($u->kind==='field') return 'Campo do formulário · '.$u->name;
    if ($u->kind==='link') return preg_match('/\bbtn\b/',$u->cls) ? 'Botão (CTA)' : 'Link';
    if (preg_match('/\beyebrow\b/',$u->cls)) return 'Chapéu';
    if (preg_match('/\blead\b/',$u->cls)) return 'Texto de abertura';
    return self::$TAG_NAMES[$u->tag] ?? 'Texto';
  }

  /* ---------- extração dos campos editáveis ---------- */
  static function extract($src, $opts=[]) {
    $root = self::parse($src);
    $container = self::findTag($root,'main') ?: (self::findTag($root,'body') ?: $root);
    $units=[]; $n=0; $sections=[]; $section=null; $pendingComment=null; $curLink=null; $nodeOf=[];

    $add = function($u) use (&$units,&$n){ $n++; $u->id='u'.$n; $units[]=$u; return $u; };
    $startSection = function($el) use (&$sections,&$section,&$pendingComment,$src){
      $s=new stdClass; $s->id='s'.(count($sections)+1); $s->label=self::sectionLabel($src,$el,$pendingComment); $s->units=[]; $s->el=$el;
      $sections[]=$s; $section=$s; $pendingComment=null;
    };
    $push = function($u,$node) use (&$curLink,&$section,&$sections,&$add,&$nodeOf,$root){
      if ($curLink && empty($u->link)) $u->link=$curLink;
      if ($section===null){ $s=new stdClass; $s->id='s0'; $s->label='Conteúdo'; $s->units=[]; $s->el=$root; $sections[]=$s; $section=$s; }
      $added=$add($u); $section->units[]=$added->id; $nodeOf[$added->id]=$node;
    };

    $walk=null; $walkEl=null;
    $walk = function($el,$depth,$ctx) use (&$walk,&$walkEl,&$pendingComment,&$startSection,&$push,$src){
      foreach ($el->children as $ch) {
        if ($depth===0) {
          if ($ch->type==='comment') { $pendingComment=$ch->text; continue; }
          if ($ch->type==='el') $startSection($ch);
        }
        if ($ch->type==='text') {
          if ($depth>0 && $el->tag!=='#root') {
            $s=$ch->start; $e=$ch->end;
            while ($s<$e && ctype_space($src[$s])) $s++;
            while ($e>$s && ctype_space($src[$e-1])) $e--;
            if ($e>$s && self::hasWords(substr($src,$s,$e-$s))) {
              $u=new stdClass; $u->kind='text'; $u->tag=$el->tag; $u->cls=self::attrVal($el,'class')??''; $u->range=[$s,$e]; $u->base=(object)['html'=>substr($src,$s,$e-$s)]; $u->partial=true;
              $push($u,$el);
            }
          }
          continue;
        }
        if ($ch->type!=='el') continue;
        $walkEl($ch,$depth+1,$ctx);
      }
    };
    $walkEl = function($el,$depth,$ctx) use (&$walk,&$walkEl,&$push,&$curLink,$src){
      $tag=$el->tag;
      if ($tag==='img') {
        $srcA=self::attr($el,'src');
        if ($srcA && $srcA->value!==null) {
          $u=new stdClass; $u->kind='image'; $u->tag=$tag; $u->el=self::elRef($el);
          $u->base=(object)['image'=>$srcA->value,'alt'=>self::attrVal($el,'alt')??'']; $u->limits=(object)['alt'=>160];
          $u->decorative=(self::attrVal($el,'aria-hidden')==='true');
          $push($u,$el);
        }
        return;
      }
      if ($tag==='input'||$tag==='select'||$tag==='textarea') {
        $name=self::attrVal($el,'name'); $type=strtolower(self::attrVal($el,'type')??$tag);
        if ($name && !in_array($type,['hidden','submit','button']) && !preg_match('/^(website|empresa_site|hp_)/',$name)) {
          $form=self::closest($el,'form');
          $u=new stdClass; $u->kind='field'; $u->tag=$tag; $u->el=self::elRef($el);
          $u->form=$form ? (self::attrVal($form,'data-validate')??'') : ''; $u->name=$name; $u->type=$type;
          $u->base=(object)['placeholder'=>self::attrVal($el,'placeholder')??'','required'=>(self::attr($el,'required')!==null),'maxlength'=>self::attrVal($el,'maxlength')??''];
          $u->limits=(object)['placeholder'=>90];
          $u->hasPlaceholder=($tag!=='select' && !in_array($type,['checkbox','radio','file']));
          $push($u,$el);
        }
        return;
      }
      if (isset(self::$TEXT_SKIP[$tag])) return;
      if ($tag==='a' && self::attr($el,'href')) {
        $range=self::inlineRange($src,$el); $href=self::attrVal($el,'href');
        $u=new stdClass; $u->kind='link'; $u->tag=$tag; $u->cls=self::attrVal($el,'class')??''; $u->el=self::elRef($el);
        $u->base=(object)['href'=>$href,'newTab'=>(self::attrVal($el,'target')==='_blank')]; $u->limits=(object)['href'=>500];
        if ($range && self::hasWords(substr($src,$range[0],$range[1]-$range[0]))) {
          $u->range=$range; $u->base->html=substr($src,$range[0],$range[1]-$range[0]); $u->limits->html=self::limitFor('text','a',self::plain($u->base->html));
          $push($u,$el); return;
        }
        $push($u,$el);
        $prev=$curLink; $curLink=$u->id; $walk($el,$depth,$ctx); $curLink=$prev;
        return;
      }
      $range=self::inlineRange($src,$el);
      if ($range && self::hasWords(substr($src,$range[0],$range[1]-$range[0]))) {
        $html=substr($src,$range[0],$range[1]-$range[0]);
        $u=new stdClass; $u->kind='text'; $u->tag=$tag; $u->cls=self::attrVal($el,'class')??''; $u->range=$range; $u->base=(object)['html'=>$html]; $u->limits=(object)['html'=>self::limitFor('text',$tag,self::plain($html))];
        $push($u,$el); return;
      }
      $walk($el,$depth,$ctx);
    };

    $walk($container,0,[]);

    foreach ($units as $u) {
      for ($node=$nodeOf[$u->id]??null; $node; $node=($node->parent??null)) if (self::hasClass($node,'sr-only')) { $u->sr=true; break; }
      $u->label=self::unitLabel($u);
      if (isset($u->el)) { $u->openStart=$u->el->start; $u->openEnd=$u->el->openEnd; }
    }
    $out=[];
    foreach ($sections as $s) { if (count($s->units)) { unset($s->el); $out[]=$s; } }
    return ['units'=>$units,'sections'=>$out];
  }

  /* ---------- saneamento ---------- */
  static function esc($s){ return str_replace(['&','<','>','"'], ['&amp;','&lt;','&gt;','&quot;'], (string)$s); }

  // HTML de texto: só as tags de ênfase (sem atributos); o resto vira texto escapado
  static function sanitizeHtml($html){
    $html=(string)$html;
    $html=preg_replace(['/<div[^>]*>|<p[^>]*>/i','/<\/div>|<\/p>/i'],['<br>',''],$html);
    $html=preg_replace('/&(?![a-zA-Z#][a-zA-Z0-9]{0,8};)/','&amp;',$html);
    $html=strip_tags($html,'<em><strong><b><i><br><u><mark><sup><sub>');
    $html=preg_replace_callback('/<(\/?)([a-zA-Z][\w-]*)[^>]*>/', function($m){
      $slash=$m[1]; $tag=strtolower($m[2]); $map=['b'=>'strong','i'=>'em']; $tag=$map[$tag]??$tag;
      if (!in_array($tag,['em','strong','br','u','mark','sup','sub'])) return '';
      return $tag==='br' ? '<br>' : '<'.$slash.$tag.'>';
    }, $html);
    $html=preg_replace('/(<br>)+$/','',$html);
    $html=preg_replace('/^(\s|<br>)+/','',$html);
    return trim($html);
  }

  // destino de link aceito: http(s), mailto, tel, âncora ou página interna .html
  static function validHref($h){
    $h=trim((string)$h);
    if ($h==='') return false;
    if (preg_match('#^https?://[^\s<>"\']+$#i',$h)) return true;
    if (preg_match('/^mailto:[^\s<>"\']+@[^\s<>"\']+$/i',$h)) return true;
    if (preg_match('/^tel:\+?[\d-]{6,20}$/i',$h)) return true;
    if (preg_match('/^#[\w-]*$/',$h)) return true;
    if (preg_match('~^(\.\./)?[\w-]+\.html(\?[\w\-=&%.+]*)?(#[\w-]*)?$~',$h)) return true;
    return false;
  }

  /* ---------- aplicação das edições ---------- */
  static function sameBase($a,$b){
    $norm=function($x) use (&$norm){ $x=json_decode(json_encode($x),true); if(is_array($x)) ksort($x); return $x; };
    return json_encode($norm($a))===json_encode($norm($b));
  }
  static function resolve($units,$edits){
    $map=[]; $orphans=[]; $used=[];
    foreach ($edits as $id=>$ed) {
      $u=null;
      foreach ($units as $x) if ($x->id===$id && $x->kind===$ed['kind'] && self::sameBase($x->base,$ed['base'])) { $u=$x; break; }
      if (!$u) {
        $idx=(int)substr($id,1); $cands=[];
        foreach ($units as $x) if ($x->kind===$ed['kind'] && self::sameBase($x->base,$ed['base']) && !isset($used[$x->id])) $cands[]=$x;
        usort($cands, fn($a,$b)=>abs((int)substr($a->id,1)-$idx)-abs((int)substr($b->id,1)-$idx));
        $u=$cands[0]??null;
      }
      if ($u && !isset($used[$u->id])) { $used[$u->id]=true; $map[]=['unit'=>$u,'edit'=>$ed]; } else $orphans[]=$id;
    }
    return ['map'=>$map,'orphans'=>$orphans];
  }

  static function attrSplice(&$splices,$u,$name,$value){
    $a=self::findAttr($u,$name);
    if ($value===null) { if ($a) $splices[]=[$a->start-1,$a->end,'']; return; }
    if ($a && $a->vStart>=0) $splices[]=[$a->vStart,$a->vEnd,self::esc($value)];
    elseif ($a) $splices[]=[$a->start,$a->end,$name.'="'.self::esc($value).'"'];
    else $splices[]=[$u->el->insertAt,$u->el->insertAt,' '.$name.'="'.self::esc($value).'"'];
  }
  static function boolAttr(&$splices,$u,$name,$on){
    $a=self::findAttr($u,$name);
    if ($on && !$a) $splices[]=[$u->el->insertAt,$u->el->insertAt,' '.$name];
    if (!$on && $a) $splices[]=[$a->start-1,$a->end,''];
  }

  static function apply($src,$edits){
    $ex=self::extract($src); $units=$ex['units'];
    $r=self::resolve($units,$edits); $map=$r['map']; $orphans=$r['orphans'];
    $splices=[];
    foreach ($map as $pair) {
      $u=$pair['unit']; $v=(array)($pair['edit']['value']??[]);
      if (($u->kind==='text'||$u->kind==='link') && array_key_exists('html',$v) && !empty($u->range)) $splices[]=[$u->range[0],$u->range[1],$v['html']];
      if ($u->kind==='link') {
        if (array_key_exists('href',$v)) self::attrSplice($splices,$u,'href',$v['href']);
        if (array_key_exists('newTab',$v) && (bool)$v['newTab']!==(bool)$u->base->newTab) {
          if ($v['newTab']) { self::attrSplice($splices,$u,'target','_blank'); if (!self::findAttr($u,'rel')) self::attrSplice($splices,$u,'rel','noopener'); }
          else self::attrSplice($splices,$u,'target',null);
        }
      }
      if ($u->kind==='image') {
        if (array_key_exists('image',$v)) self::attrSplice($splices,$u,'src',$v['image']);
        if (array_key_exists('alt',$v)) self::attrSplice($splices,$u,'alt',$v['alt']);
        if (array_key_exists('image',$v) && $v['image']!==$u->base->image) foreach (['width','height','srcset'] as $nn) if (self::findAttr($u,$nn)) self::attrSplice($splices,$u,$nn,null);
      }
      if ($u->kind==='field') {
        if (array_key_exists('placeholder',$v) && $u->hasPlaceholder) self::attrSplice($splices,$u,'placeholder',$v['placeholder']?:null);
        if (array_key_exists('required',$v)) self::boolAttr($splices,$u,'required',(bool)$v['required']);
        if (array_key_exists('maxlength',$v)) self::attrSplice($splices,$u,'maxlength',$v['maxlength']?(string)$v['maxlength']:null);
      }
    }
    usort($splices, fn($a,$b)=>($b[0]-$a[0]) ?: ($b[1]-$a[1]));
    $out=$src;
    foreach ($splices as $sp) { [$s,$e,$rep]=$sp; $out=substr($out,0,$s).$rep.substr($out,$e); }
    return ['html'=>$out,'orphans'=>$orphans,'applied'=>count($map)];
  }
}
