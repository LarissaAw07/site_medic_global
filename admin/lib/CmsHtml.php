<?php
/* CMS — port fiel de cms/html.js (Node) para PHP 8.
   parse / extract / apply / resolve / sanitizeHtml / sanitizeRich / validHref / plain / decode / esc / limitFor.
   Posições são em BYTES (no Node, unidades UTF-16); todo o resto tem o mesmo comportamento do original. */

final class CmsHtml
{
    private const VOID = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'];
    private const RAW = ['script', 'style', 'svg', 'template', 'textarea'];
    private const INLINE = ['em', 'strong', 'b', 'i', 'br', 'u', 'mark', 'sup', 'sub'];
    private const TEXT_SKIP = ['script', 'style', 'svg', 'template', 'select', 'textarea', 'option', 'noscript'];

    // classe \s do JavaScript
    private const WS = '[\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]';
    private static ?array $wsChars = null;

    private const LIMITS = ['h1' => 90, 'h2' => 120, 'h3' => 120, 'h4' => 140, 'h5' => 140, 'h6' => 140, 'p' => 700, 'li' => 400, 'td' => 300, 'th' => 120, 'dt' => 160, 'dd' => 500, 'blockquote' => 700, 'figcaption' => 240, 'label' => 140, 'summary' => 200, 'legend' => 120, 'button' => 60, 'a' => 90, 'span' => 120, 'small' => 160, 'strong' => 160, 'b' => 160, 'em' => 160, 'caption' => 200];
    private const TAG_NAMES = ['h1' => 'Título principal', 'h2' => 'Título', 'h3' => 'Subtítulo', 'h4' => 'Subtítulo', 'h5' => 'Subtítulo', 'h6' => 'Subtítulo', 'p' => 'Parágrafo', 'li' => 'Item de lista', 'td' => 'Célula', 'th' => 'Cabeçalho de tabela', 'dt' => 'Termo', 'dd' => 'Descrição', 'blockquote' => 'Citação', 'figcaption' => 'Legenda', 'label' => 'Rótulo do campo', 'summary' => 'Pergunta / título do bloco', 'legend' => 'Título do grupo', 'button' => 'Botão', 'small' => 'Texto de apoio', 'strong' => 'Destaque', 'b' => 'Destaque', 'span' => 'Texto', 'caption' => 'Legenda da tabela'];
    private const RICH = ['p' => [], 'h2' => [], 'h3' => [], 'h4' => [], 'strong' => [], 'em' => [], 'a' => ['href', 'target'], 'ul' => [], 'ol' => [], 'li' => [], 'blockquote' => [], 'table' => [], 'thead' => [], 'tbody' => [], 'tr' => [], 'th' => ['colspan', 'rowspan'], 'td' => ['colspan', 'rowspan'], 'figure' => [], 'img' => ['src', 'alt'], 'figcaption' => [], 'br' => [], 'hr' => []];
    private const RICH_RENAME = ['b' => 'strong', 'i' => 'em', 'h1' => 'h2', 'h5' => 'h4', 'h6' => 'h4', 'div' => 'p'];
    private const RICH_VOID = ['br', 'hr', 'img'];
    private const RICH_CLASSES = '/^(al-left|al-center|al-right|al-justify|img-half)$/D';

    /* ---------- utilitários de semântica JS ---------- */

    private static function wsSet(): array
    {
        if (self::$wsChars === null) {
            $cps = [9, 10, 11, 12, 13, 32, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF];
            for ($c = 0x2000; $c <= 0x200A; $c++) $cps[] = $c;
            self::$wsChars = [];
            foreach ($cps as $c) self::$wsChars[mb_chr($c, 'UTF-8')] = true;
        }
        return self::$wsChars;
    }
    // tamanho (bytes) do caractere de espaço (\s do JS) que começa em $i, ou 0
    private static function wsAt(string $s, int $i): int
    {
        if ($i < 0 || $i >= strlen($s)) return 0;
        $set = self::wsSet();
        for ($l = 1; $l <= 3; $l++) if (isset($set[substr($s, $i, $l)]) && $i + $l <= strlen($s)) return $l;
        return 0;
    }
    // tamanho do caractere de espaço que termina em $e, ou 0
    private static function wsBefore(string $s, int $e): int
    {
        $set = self::wsSet();
        for ($l = 1; $l <= 3; $l++) if ($e - $l >= 0 && isset($set[substr($s, $e - $l, $l)])) return $l;
        return 0;
    }
    private static function idx(string $s, string $needle, int $from = 0): int
    {
        if ($from < 0) $from = 0;
        if ($from > strlen($s)) return -1;
        $p = strpos($s, $needle, $from);
        return $p === false ? -1 : $p;
    }
    private static function slice(string $s, int $a, ?int $b = null): string
    {
        $L = strlen($s);
        if ($b === null) $b = $L;
        if ($a < 0) $a = max($L + $a, 0);
        if ($b < 0) $b = max($L + $b, 0);
        $a = min($a, $L);
        $b = min($b, $L);
        return $b > $a ? substr($s, $a, $b - $a) : '';
    }
    private static function len16(string $s): int
    {
        if ($s === '') return 0;
        return intdiv(strlen(mb_convert_encoding($s, 'UTF-16LE', 'UTF-8')), 2);
    }
    // String.prototype.slice(a, b) em unidades UTF-16 (a, b >= 0)
    private static function slice16(string $s, int $a, int $b): string
    {
        if ($s === '') return '';
        $u = mb_convert_encoding($s, 'UTF-16LE', 'UTF-8');
        $n = intdiv(strlen($u), 2);
        if ($a >= $n || $b <= $a) return '';
        if ($a === 0 && $b >= $n) return $s;
        return mb_convert_encoding(substr($u, 2 * $a, 2 * (min($b, $n) - $a)), 'UTF-8', 'UTF-16LE');
    }
    private static function trim(string $s): string
    {
        return preg_replace('/^' . self::WS . '+|' . self::WS . '+$/uD', '', $s) ?? $s;
    }
    private static function lower(string $s): string { return mb_strtolower($s, 'UTF-8'); }
    private static function truthy($v): bool
    {
        if ($v === null || $v === false || $v === '' || $v === 0) return false;
        if (is_float($v)) return !($v == 0.0 || is_nan($v));
        return true; // arrays/objetos (mesmo vazios) são verdadeiros no JS
    }
    private static function str($v): string
    {
        if (is_string($v)) return $v;
        if ($v === null) return 'null';
        if ($v === true) return 'true';
        if ($v === false) return 'false';
        if (is_int($v)) return (string)$v;
        if (is_float($v)) {
            if (is_nan($v)) return 'NaN';
            if (is_infinite($v)) return $v > 0 ? 'Infinity' : '-Infinity';
            if ($v == floor($v) && abs($v) < 1e21) return sprintf('%.0f', $v);
            $j = json_encode($v);
            return str_replace(['e+', '.0e'], ['e+', 'e'], $j);
        }
        if (is_array($v)) {
            if (array_is_list($v)) return implode(',', array_map(fn($x) => $x === null ? '' : self::str($x), $v));
            return '[object Object]';
        }
        return '[object Object]';
    }
    private static function num(string $s): float
    {
        $t = self::trim($s);
        if ($t === '') return 0.0;
        if (preg_match('/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)$/D', $t)) return (float)$t;
        if (preg_match('/^([+-]?)Infinity$/D', $t, $m)) return $m[1] === '-' ? -INF : INF;
        if (preg_match('/^0[xX]([0-9a-fA-F]+)$/D', $t, $m)) return (float)hexdec($m[1]);
        if (preg_match('/^0[oO]([0-7]+)$/D', $t, $m)) return (float)octdec($m[1]);
        if (preg_match('/^0[bB]([01]+)$/D', $t, $m)) return (float)bindec($m[1]);
        return NAN;
    }
    private static function jsonKey($v): string
    {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS | JSON_INVALID_UTF8_SUBSTITUTE);
    }
    private static function toArr($v)
    {
        if ($v instanceof stdClass) $v = get_object_vars($v);
        if (is_array($v)) foreach ($v as $k => $x) $v[$k] = self::toArr($x);
        return $v;
    }
    private static function fromCharCode(string $digits, int $base): string
    {
        // ToUint16 do número; números enormes (Infinity no JS) viram 0
        if ($base === 10 && strlen(ltrim($digits, '0')) > 309) return mb_chr(0, 'UTF-8');
        $v = $base === 10 ? (float)$digits : (float)hexdec($digits);
        if ($v >= 9007199254740992.0) $code = (int)fmod($v, 65536.0);
        else { $code = 0; foreach (str_split(strtolower($digits)) as $d) $code = ($code * $base + intval($d, 16)) % 65536; }
        if ($code >= 0xD800 && $code <= 0xDFFF) return "\u{FFFD}";
        return mb_chr($code, 'UTF-8');
    }

    /* ---------- parse ---------- */

    public static function parse($src)
    {
        $src = (string)$src;
        $L = strlen($src);
        $root = (object)['type' => 'el', 'tag' => '#root', 'attrs' => [], 'children' => [], 'start' => 0, 'openEnd' => 0, 'closeStart' => $L, 'end' => $L, 'parent' => null];
        $stack = [$root];
        $i = 0;
        $textStart = 0;
        $lowerSrc = null;
        $flush = function ($end) use (&$stack, &$textStart) {
            if ($end > $textStart) $stack[count($stack) - 1]->children[] = (object)['type' => 'text', 'start' => $textStart, 'end' => $end];
        };
        while ($i < $L) {
            $c = $src[$i];
            if ($c === '{' && ($src[$i + 1] ?? '') === '{') { $e = self::idx($src, '}}', $i); $i = $e < 0 ? $L : $e + 2; continue; }
            if ($c !== '<') { $i++; continue; }
            if (substr($src, $i, 4) === '<!--') {
                $flush($i);
                $e = self::idx($src, '-->', $i + 4);
                $end = $e < 0 ? $L : $e + 3;
                $stack[count($stack) - 1]->children[] = (object)['type' => 'comment', 'start' => $i, 'end' => $end, 'text' => self::slice($src, $i + 4, $end - 3)];
                $i = $textStart = $end;
                continue;
            }
            $close = ($src[$i + 1] ?? '') === '/';
            $off = $i + ($close ? 2 : 1);
            $max = ($close ? 38 : 39) - 1;
            if ($off >= $L || !preg_match('/\G[a-zA-Z][\w-]{0,' . $max . '}/', $src, $m, 0, $off)) { $i++; continue; }
            $tag = strtolower($m[0]);
            if ($close) {
                $flush($i);
                $end = self::idx($src, '>', $i) + 1;
                if ($end === 0) $end = $L;
                for ($k = count($stack) - 1; $k > 0; $k--) if ($stack[$k]->tag === $tag) {
                    while (count($stack) > $k + 1) { $x = array_pop($stack); $x->closeStart = $x->end = $i; }
                    $el = array_pop($stack);
                    $el->closeStart = $i;
                    $el->end = $end;
                    break;
                }
                $i = $textStart = $end;
                continue;
            }
            $flush($i);
            $j = $i + 1 + strlen($tag);
            $attrs = [];
            while ($j < $L && $src[$j] !== '>' && !($src[$j] === '/' && ($src[$j + 1] ?? '') === '>')) {
                if ($w = self::wsAt($src, $j)) { $j += $w; continue; }
                if ($src[$j] === '{' && ($src[$j + 1] ?? '') === '{') { $j = self::idx($src, '}}', $j) + 2; continue; }
                if (!preg_match('/\G[^\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}=>\/]{1,200}/u', $src, $am, 0, $j)) { $j++; continue; }
                $a = (object)['name' => self::lower($am[0]), 'start' => $j, 'value' => null, 'vStart' => -1, 'vEnd' => -1];
                $j += strlen($am[0]);
                if (($src[$j] ?? '') === '=') {
                    $j++;
                    $q = $src[$j] ?? '';
                    if ($q === '"' || $q === "'") { $a->vStart = $j + 1; $a->vEnd = self::idx($src, $q, $j + 1); $j = $a->vEnd + 1; }
                    else {
                        $a->vStart = $j;
                        if ($j < $L && preg_match('/\G[^\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}>]*/u', $src, $vm, 0, $j)) $j += strlen($vm[0]);
                        $a->vEnd = $j;
                    }
                    $a->value = self::slice($src, $a->vStart, $a->vEnd);
                }
                $a->end = $j;
                $attrs[] = $a;
            }
            $selfClose = ($src[$j] ?? '') === '/';
            $openEnd = self::idx($src, '>', $j) + 1;
            $el = (object)['type' => 'el', 'tag' => $tag, 'attrs' => $attrs, 'children' => [], 'start' => $i, 'openEnd' => $openEnd, 'insertAt' => $selfClose ? $j : $openEnd - 1, 'closeStart' => $openEnd, 'end' => $openEnd, 'parent' => $stack[count($stack) - 1]];
            $stack[count($stack) - 1]->children[] = $el;
            $i = $textStart = $openEnd;
            if (in_array($tag, self::VOID, true) || $selfClose) continue;
            if (in_array($tag, self::RAW, true)) {
                if ($lowerSrc === null) $lowerSrc = strtolower($src);
                $e = self::idx($lowerSrc, '</' . $tag, $openEnd);
                $el->closeStart = $e < 0 ? $L : $e;
                $el->end = $e < 0 ? $L : self::idx($src, '>', $e) + 1;
                if ($tag === 'textarea') $el->children[] = (object)['type' => 'text', 'start' => $openEnd, 'end' => $el->closeStart];
                $i = $textStart = $el->end;
                continue;
            }
            $stack[] = $el;
        }
        $flush($L);
        return $root;
    }

    private static function attr($el, string $n)
    {
        foreach ($el->attrs ?? [] as $a) if ($a->name === $n) return $a;
        return null;
    }
    private static function attrVal($el, string $n)
    {
        $a = self::attr($el, $n);
        return $a ? $a->value : null;
    }
    private static function hasClass($el, string $c): bool
    {
        $v = self::attrVal($el, 'class');
        return str_contains(' ' . ($v === null || $v === '' ? '' : $v) . ' ', ' ' . $c . ' ');
    }

    /* ---------- texto ---------- */

    public static function plain($s)
    {
        $s = self::str($s);
        $s = preg_replace('/\{\{(?:i:|>|pic:)[^}]*\}\}/', '', $s);
        $s = preg_replace('/<[^>]*>/', '', $s);
        $s = preg_replace('/' . self::WS . '+/u', ' ', self::decode($s)) ?? $s;
        return self::trim($s);
    }
    public static function decode($s)
    {
        $s = self::str($s);
        $s = str_replace(['&nbsp;'], [' '], $s);
        $s = str_replace('&amp;', '&', $s);
        $s = str_replace('&lt;', '<', $s);
        $s = str_replace('&gt;', '>', $s);
        $s = str_replace('&quot;', '"', $s);
        $s = str_replace('&#39;', "'", $s);
        $s = preg_replace_callback('/&#(\d+);/', fn($m) => self::fromCharCode($m[1], 10), $s);
        $s = preg_replace_callback('/&#x([\da-f]+);/i', fn($m) => self::fromCharCode($m[1], 16), $s);
        return $s;
    }
    private static function hasWords(string $s): bool
    {
        return preg_match('/[\p{L}\p{N}]/u', self::plain(preg_replace('/\{\{L\.[\w.]+\}\}/', '', $s))) === 1;
    }

    private static function isIcon(string $src, $n): bool
    {
        if ($n->type === 'comment') return true;
        if ($n->type === 'text') {
            $t = self::slice($src, $n->start, $n->end);
            return preg_match('/^' . self::WS . '*(\{\{(?:i:[\w-]+|>' . self::WS . '*[\w-]+)\}\}' . self::WS . '*)+$/uD', $t) === 1 && self::trim($t) !== '';
        }
        if ($n->tag === 'svg') return true;
        if ($n->tag === 'i' || $n->tag === 'span') {
            if (!count($n->children)) return false;
            foreach ($n->children as $c) if (!(self::isIcon($src, $c) || ($c->type === 'text' && self::trim(self::slice($src, $c->start, $c->end)) === ''))) return false;
            return true;
        }
        return false;
    }
    private static function isBlank(string $src, $n): bool
    {
        return $n->type === 'text' && self::trim(self::slice($src, $n->start, $n->end)) === '';
    }
    private static function okNode(string $src, $n): bool
    {
        if ($n->type === 'text') return !preg_match('/\{\{(?:i:|>|pic:)/', self::slice($src, $n->start, $n->end));
        if (!($n->type === 'el' && in_array($n->tag, self::INLINE, true) && !($n->tag === 'i' && self::isIcon($src, $n)))) return false;
        foreach ($n->attrs as $x) if ($x->name !== 'class') return false;
        foreach ($n->children as $c) if (!self::okNode($src, $c)) return false;
        return true;
    }
    private static function inlineRange(string $src, $el): ?array
    {
        $kids = $el->children;
        $a = 0;
        $b = count($kids);
        while ($a < $b && (self::isIcon($src, $kids[$a]) || self::isBlank($src, $kids[$a]))) $a++;
        while ($b > $a && (self::isIcon($src, $kids[$b - 1]) || self::isBlank($src, $kids[$b - 1]))) $b--;
        if ($a >= $b) return null;
        for ($k = $a; $k < $b; $k++) if (!self::okNode($src, $kids[$k])) return null;
        $s = $kids[$a]->start;
        $e = $kids[$b - 1]->end;
        while ($s < $e && ($w = self::wsAt($src, $s))) $s += $w;
        while ($e > $s && ($w = self::wsBefore($src, $e))) $e -= $w;
        return [$s, $e];
    }

    public static function limitFor($kind, $tag, $baseText)
    {
        if ($kind === 'alt') return 160;
        if ($kind === 'placeholder') return 90;
        if ($kind === 'href') return 500;
        $d = (is_string($tag) || is_int($tag)) && isset(self::LIMITS[$tag]) ? self::LIMITS[$tag] : 300;
        $len = self::truthy($baseText) ? self::len16(self::str($baseText)) : 0;
        return max($d, (int)ceil($len * 1.3));
    }

    /* ---------- extract ---------- */

    public static function extract($src, array $opts = [])
    {
        $src = (string)$src;
        $root = self::parse($src);
        $X = (object)['src' => $src, 'root' => $root, 'units' => [], 'n' => 0, 'sections' => [], 'section' => null, 'pending' => null, 'curLink' => null, 'nodeOf' => []];
        self::walk($X, $root, 0);
        $units = $X->units;
        $chain = [];
        $dc = $opts['dataClasses'] ?? null;
        foreach ($units as $u) {
            $a = [];
            for ($n = $X->nodeOf[$u->id]; $n; $n = $n->parent) array_unshift($a, $n);
            $chain[$u->id] = $a;
            foreach ($a as $n) if (self::hasClass($n, 'sr-only')) { $u->sr = true; break; }
            if (self::truthy($dc) && is_array($dc)) {
                $hit = false;
                foreach ($a as $n) { foreach ($dc as $c) if (self::hasClass($n, self::str($c))) { $hit = true; break 2; } }
                if ($hit) $u->data = true;
            }
        }
        foreach ($units as $u) {
            $u->label = self::unitLabel($u);
            if ($u->kind === 'text' && !isset($u->limits)) $u->limits = (object)['html' => self::limitFor('text', $u->tag, self::plain($u->base->html))];
            if (isset($u->el)) { $u->openStart = $u->el->start; $u->openEnd = $u->el->openEnd; }
        }
        $out = array_values(array_filter($X->sections, fn($s) => count($s->units) > 0));
        foreach ($out as $i => $s) {
            $s->parts = self::partsOf($s->el, $s->units, $chain);
            $inner = self::slice($src, $s->el->start, $s->el->end);
            if ($i > 0) {
                $all = true;
                foreach ($s->units as $id) {
                    $u = $units[(int)substr($id, 1) - 1];
                    if (!($u->kind === 'link' && preg_match('/^#/', self::str($u->base->href)))) { $all = false; break; }
                }
                if ($all) $s->join = true;
            }
            if ($i === 0 && preg_match('/\b(hero|page-hero)\b/', self::str(self::attrVal($s->el, 'class') ?: '')) && preg_match('/<h1\b/', $inner)) $s->label = 'Banner principal';
            preg_match_all('/\{\{>' . self::WS . '*([\w-]+)' . self::WS . '*\}\}/u', $inner, $mm);
            if (count($mm[1])) $s->includes = array_values(array_unique($mm[1]));
            unset($s->el);
        }
        return ['units' => self::toArr($units), 'sections' => self::toArr($out)];
    }

    private static function push($X, $u, $node): void
    {
        if ($X->curLink !== null && !isset($u->link)) $u->link = $X->curLink;
        if (!$X->section) { $X->section = (object)['id' => 's0', 'label' => 'Conteúdo', 'units' => [], 'el' => $X->root]; $X->sections[] = $X->section; }
        $u->id = 'u' . (++$X->n);
        $X->units[] = $u;
        $X->section->units[] = $u->id;
        $X->nodeOf[$u->id] = $node;
    }

    private static function picTokens($X, $t, $node): void
    {
        $txt = self::slice($X->src, $t->start, $t->end);
        preg_match_all('/\{\{pic:([^}]+)\}\}/', $txt, $ms, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        foreach ($ms as $m) {
            $parts = explode('|', $m[1][0]);
            $key = $parts[0];
            $alt = $parts[1] ?? '';
            $at = $t->start + $m[0][1];
            self::push($X, (object)['kind' => 'pic', 'tag' => 'img', 'range' => [$at, $at + strlen($m[0][0])], 'token' => $m[1][0], 'base' => (object)['image' => $key, 'alt' => $alt], 'limits' => (object)['alt' => 160]], $node);
        }
    }

    private static function walk($X, $el, int $depth): void
    {
        $src = $X->src;
        foreach ($el->children as $ch) {
            if ($depth === 0) {
                if ($ch->type === 'comment') { $X->pending = $ch->text; continue; }
                if ($ch->type === 'el') {
                    $label = self::sectionLabel($src, $ch, $X->pending);
                    $X->section = (object)['id' => 's' . (count($X->sections) + 1), 'label' => $label, 'units' => [], 'el' => $ch];
                    $X->sections[] = $X->section;
                    $X->pending = null;
                }
            }
            if ($ch->type === 'text') {
                self::picTokens($X, $ch, $el);
                if ($depth > 0) {
                    $t = self::slice($src, $ch->start, $ch->end);
                    if (self::hasWords($t) && $el->tag !== '#root') {
                        preg_match_all('/\{\{(?:i:|>|pic:)[^}]*\}\}/', $t, $ms, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
                        $segs = [];
                        $last = 0;
                        foreach ($ms as $m) { $segs[] = [$last, $m[0][1]]; $last = $m[0][1] + strlen($m[0][0]); }
                        $segs[] = [$last, strlen($t)];
                        foreach ($segs as [$a, $b]) {
                            $s = $ch->start + $a;
                            $e = $ch->start + $b;
                            while ($s < $e && ($w = self::wsAt($src, $s))) $s += $w;
                            while ($e > $s && ($w = self::wsBefore($src, $e))) $e -= $w;
                            if ($e > $s && self::hasWords(self::slice($src, $s, $e))) self::push($X, (object)['kind' => 'text', 'tag' => $el->tag, 'cls' => self::attrVal($el, 'class') ?: '', 'range' => [$s, $e], 'base' => (object)['html' => self::slice($src, $s, $e)], 'partial' => true], $el);
                        }
                    }
                }
                continue;
            }
            if ($ch->type !== 'el') continue;
            self::walkEl($X, $ch, $depth + 1);
        }
    }

    private static function walkEl($X, $el, int $depth): void
    {
        $src = $X->src;
        $tag = $el->tag;
        if ($tag === 'img') {
            $srcA = self::attr($el, 'src');
            if ($srcA && !preg_match('/\{\{/', (string)($srcA->value ?? ''))) self::push($X, (object)['kind' => 'image', 'tag' => $tag, 'el' => self::elRef($el), 'base' => (object)['image' => $srcA->value, 'alt' => self::attrVal($el, 'alt') ?: ''], 'limits' => (object)['alt' => 160], 'decorative' => self::attrVal($el, 'aria-hidden') === 'true'], $el);
            return;
        }
        if ($tag === 'input' || $tag === 'select' || $tag === 'textarea') {
            $name = self::attrVal($el, 'name');
            $type = self::lower(self::attrVal($el, 'type') ?: $tag);
            if ($name !== null && $name !== '' && !in_array($type, ['hidden', 'submit', 'button'], true) && !preg_match('/^(website|empresa_site|hp_)/', $name)) {
                $form = self::closest($el, 'form');
                self::push($X, (object)['kind' => 'field', 'tag' => $tag, 'el' => self::elRef($el), 'form' => $form ? (self::attrVal($form, 'data-validate') ?: '') : '', 'name' => $name, 'type' => $type,
                    'base' => (object)['placeholder' => self::attrVal($el, 'placeholder') ?: '', 'required' => (bool)self::attr($el, 'required'), 'maxlength' => self::attrVal($el, 'maxlength') ?: ''], 'limits' => (object)['placeholder' => 90],
                    'hasPlaceholder' => $tag !== 'select' && !in_array($type, ['checkbox', 'radio', 'file'], true)], $el);
            }
            return;
        }
        if (in_array($tag, self::TEXT_SKIP, true)) return;
        if ($tag === 'a' && self::attr($el, 'href')) {
            $range = self::inlineRange($src, $el);
            $href = self::attrVal($el, 'href');
            $u = (object)['kind' => 'link', 'tag' => $tag, 'cls' => self::attrVal($el, 'class') ?: '', 'el' => self::elRef($el),
                'base' => (object)['href' => $href, 'newTab' => self::attrVal($el, 'target') === '_blank'], 'limits' => (object)['href' => 500]];
            if ($range && self::hasWords(self::slice($src, $range[0], $range[1]))) {
                $u->range = $range;
                $u->base->html = self::slice($src, $range[0], $range[1]);
                $u->limits->html = self::limitFor('text', 'a', self::plain($u->base->html));
                self::push($X, $u, $el);
                return;
            }
            self::push($X, $u, $el);
            $prev = $X->curLink;
            $X->curLink = $u->id;
            self::walk($X, $el, $depth);
            $X->curLink = $prev;
            return;
        }
        $range = self::inlineRange($src, $el);
        if ($range && self::hasWords(self::slice($src, $range[0], $range[1]))) {
            $html = self::slice($src, $range[0], $range[1]);
            self::push($X, (object)['kind' => 'text', 'tag' => $tag, 'cls' => self::attrVal($el, 'class') ?: '', 'range' => $range, 'base' => (object)['html' => $html], 'limits' => (object)['html' => self::limitFor('text', $tag, self::plain($html))]], $el);
            return;
        }
        self::walk($X, $el, $depth);
    }

    private static function sigOf($el): string
    {
        $parts = preg_split('/' . self::WS . '+/u', self::str(self::attrVal($el, 'class') ?: ''));
        return $el->tag . '.' . ($parts[0] ?? '');
    }

    private static function partsOf($el, array $ids, array $chain): array
    {
        $out = [];
        $fields = function (array $seg) use (&$out) {
            $l = $out ? $out[count($out) - 1] : null;
            if ($l && isset($l->ids)) array_push($l->ids, ...$seg); else $out[] = (object)['ids' => $seg];
        };
        $rec = function ($el, array $ids) use (&$rec, &$out, $fields, $chain) {
            $kidOf = function ($id) use ($chain, $el) {
                $a = $chain[$id];
                $k = array_search($el, $a, true);
                return $k !== false ? ($a[$k + 1] ?? null) : null;
            };
            $segs = [];
            foreach ($ids as $id) {
                $k = $kidOf($id);
                $l = $segs ? $segs[count($segs) - 1] : null;
                if ($l && $l->k === $k) $l->ids[] = $id; else $segs[] = (object)['k' => $k, 'ids' => [$id]];
            }
            $count = [];
            foreach ($segs as $g) if ($g->k && count($g->ids) >= 2) { $sg = self::sigOf($g->k); $count[$sg] = ($count[$sg] ?? 0) + 1; }
            $cand = [];
            foreach ($count as $sg => $c) {
                $sg = (string)$sg;
                if ($c >= 3 || ($c >= 2 && (preg_match('/^(article|li|a|details|figure|tr|dl|label)$/D', explode('.', $sg)[0]) || preg_match('/card|slide|item|doc|row|step|faq|col/', $sg)))) $cand[] = $sg;
            }
            usort($cand, fn($a, $b) => $count[$b] - $count[$a]);
            $list = $cand[0] ?? null;
            foreach ($segs as $g) {
                if (!$g->k) { $fields($g->ids); continue; }
                if ($list !== null && self::sigOf($g->k) === $list) {
                    $l = $out ? $out[count($out) - 1] : null;
                    if ($l && isset($l->items) && ($l->sig ?? null) === $list) $l->items[] = (object)['ids' => $g->ids];
                    else $out[] = (object)['sig' => $list, 'items' => [(object)['ids' => $g->ids]]];
                    continue;
                }
                $rec($g->k, $g->ids);
            }
        };
        $rec($el, $ids);
        $res = [];
        foreach ($out as $p) {
            if (isset($p->items) && count($p->items) < 2) $p = (object)['ids' => $p->items[0]->ids];
            unset($p->sig);
            $l = $res ? $res[count($res) - 1] : null;
            if (isset($p->ids) && $l && isset($l->ids)) array_push($l->ids, ...$p->ids); else $res[] = $p;
        }
        return $res;
    }

    private static function elRef($el)
    {
        $attrs = [];
        foreach ($el->attrs as $a) $attrs[] = (object)['name' => $a->name, 'start' => $a->start, 'end' => $a->end, 'vStart' => $a->vStart, 'vEnd' => $a->vEnd, 'value' => $a->value];
        return (object)['start' => $el->start, 'openEnd' => $el->openEnd, 'insertAt' => $el->insertAt, 'attrs' => $attrs];
    }
    private static function closest($el, string $tag)
    {
        for ($p = $el->parent; $p; $p = $p->parent) if ($p->tag === $tag) return $p;
        return null;
    }

    private static function sectionLabel(string $src, $el, $comment): string
    {
        $W = self::WS;
        if ($comment !== null && $comment !== '') {
            $t = self::trim(preg_replace('/' . $W . '+/u', ' ', $comment) ?? $comment);
            $t = preg_replace('/^\d+' . $W . '*·' . $W . '*/u', '', $t) ?? $t;
            $first = self::trim(preg_split('/ — | – |\.|:|\(/u', $t)[0]);
            $NAMES = ['Hero' => 'Banner principal', 'Page hero' => 'Topo da página', 'Medicglobal' => 'Sobre a MedicGLOBAL', 'Cta final' => 'Chamada final'];
            if (preg_match('/^banner\b/i', $first)) return 'Banner principal';
            if ($first !== '' && self::len16($first) < 70 && !preg_match('/\/|conforme|molde/i', $first)) { $c = self::cap($first); return $NAMES[$c] ?? $c; }
        }
        $al = self::attrVal($el, 'aria-label');
        if ($al !== null && $al !== '') return $al;
        $lb = self::attrVal($el, 'aria-labelledby');
        if ($lb !== null && $lb !== '') {
            $r = @preg_match("\x01id=[\"']" . $lb . "[\"'][^>]*>([\\s\\S]*?)</\x01u", $src, $m);
            if ($r) return self::slice16(self::plain($m[1]), 0, 70);
        }
        $inner = self::slice($src, $el->start, $el->end);
        if (preg_match('/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/', $inner, $h) && self::plain($h[1]) !== '') return self::slice16(self::plain($h[1]), 0, 70);
        if (preg_match('/aria-label="([^"]{3,70})"/u', $inner, $al2)) return preg_replace('/s*([^\n\r\x{2028}\x{2029}]*)$/uD', '', $al2[1], 1);
        $txt = self::plain(preg_replace('/^<[^>]*>/', '', $inner));
        if ($txt !== '') return self::slice16($txt, 0, 60);
        $cls = self::attrVal($el, 'class');
        return self::cap($el->tag) . ($cls !== null && $cls !== '' ? ' · ' . explode(' ', $cls)[0] : '');
    }
    private static function cap(string $s): string
    {
        if ($s === '') return '';
        $first = mb_substr($s, 0, 1, 'UTF-8');
        $rest = mb_substr($s, 1, null, 'UTF-8');
        return mb_strtoupper($s, 'UTF-8') === $s ? $first . mb_strtolower($rest, 'UTF-8') : mb_strtoupper($first, 'UTF-8') . $rest;
    }
    private static function unitLabel($u): string
    {
        if ($u->kind === 'image' || $u->kind === 'pic') return !empty($u->decorative) ? 'Imagem (decorativa)' : 'Imagem';
        if ($u->kind === 'field') return 'Campo do formulário · ' . $u->name;
        if ($u->kind === 'link') return preg_match('/\bbtn\b/', $u->cls) ? 'Botão (CTA)' : 'Link';
        if (preg_match('/\beyebrow\b/', $u->cls)) return 'Chapéu';
        if (preg_match('/\blead\b/', $u->cls)) return 'Texto de abertura';
        return self::TAG_NAMES[$u->tag] ?? 'Texto';
    }

    /* ---------- validação e saneamento ---------- */

    public static function esc($s)
    {
        return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], self::str($s));
    }
    private static function escAttr($s): string
    {
        return str_replace(["'", '{', '}'], ['&#39;', '&#123;', '&#125;'], self::esc($s));
    }

    public static function sanitizeHtml($html, ?callable $validToken = null)
    {
        $html = self::str($html);
        $html = preg_replace('/<div>|<p>/i', '<br>', $html);
        $html = preg_replace('/<\/div>|<\/p>/i', '', $html);
        $out = [];
        $open = [];
        preg_match_all('/<\/?([a-zA-Z][\w-]*)[^>]*>|\{\{' . self::WS . '*L\.([\w.]+)' . self::WS . '*\}\}|[^<{]+|[<{]/u', $html, $ms, PREG_SET_ORDER);
        foreach ($ms as $m) {
            $t = $m[0];
            if (($m[1] ?? '') !== '') {
                $tag = strtolower($m[1]);
                if ($tag === 'b') $tag = 'strong';
                if ($tag === 'i') $tag = 'em';
                if (!in_array($tag, self::INLINE, true)) continue;
                if ($tag === 'br') { $out[] = '<br>'; continue; }
                if ($t[1] === '/') {
                    $k = array_search($tag, array_reverse($open, true), true);
                    if ($k !== false) { for ($x = count($open) - 1; $x >= $k; $x--) $out[] = '</' . $open[$x] . '>'; $open = array_slice($open, 0, $k); }
                } else { $open[] = $tag; $out[] = '<' . $tag . '>'; }
            } elseif (($m[2] ?? '') !== '') {
                $out[] = $validToken && self::truthy($validToken($m[2])) ? '{{L.' . $m[2] . '}}' : str_replace('{', '&#123;', self::esc($t));
            } else {
                $out[] = str_replace(["{", "\u{a0}"], ['&#123;', '&nbsp;'], self::esc(self::decode($t)));
            }
        }
        for ($x = count($open) - 1; $x >= 0; $x--) $out[] = '</' . $open[$x] . '>';
        $r = implode('', $out);
        $r = preg_replace('/(<br>)+$/D', '', $r);
        $r = preg_replace('/^(' . self::WS . '|<br>)+/u', '', $r) ?? $r;
        return self::trim($r);
    }

    public static function validHref($h, ?callable $validToken = null)
    {
        $h = self::trim(self::truthy($h) ? self::str($h) : '');
        if ($h === '') return false;
        if (preg_match('/^\{\{L\.([\w.]+)\}\}$/D', $h, $tok)) return (bool)($validToken && self::truthy($validToken($tok[1])));
        if (preg_match('/^(https?:\/\/)[^\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}<>"\']+$/iuD', $h)) return true;
        if (preg_match('/^(mailto:|tel:)\{\{L\.([\w.]+)\}\}$/iD', $h, $pre)) return (bool)($validToken && self::truthy($validToken($pre[2])));
        if (preg_match('/^mailto:[^\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}<>"\']+@[^\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}<>"\']+$/iuD', $h)) return true;
        if (preg_match('/^tel:\+?[\d-]{6,20}$/iD', $h)) return true;
        if (preg_match('/^#[\w-]*$/D', $h)) return true;
        if (preg_match('/^(\.\.\/)?[\w-]+\.html(\?[\w\-=&%.+]*)?(#[\w-]*)?$/D', $h)) return true;
        return false;
    }

    public static function sanitizeRich($html, ?callable $imgOk = null)
    {
        $W = self::WS;
        $NW = '[^\t\n\x0B\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}';
        $src = self::truthy($html) ? self::str($html) : '';
        $src = preg_replace('/<(script|style|iframe|object|embed|svg|template|noscript|title|head)\b[\s\S]*?<\/\1' . $W . '*>/iu', '', $src) ?? $src;
        $out = [];
        $open = [];
        preg_match_all('/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:' . $W . '+' . $NW . '=>\/]+(?:' . $W . '*=' . $W . '*(?:"[^"]*"|\'[^\']*\'|' . $NW . '>]+))?)*)' . $W . '*\/?>|[^<]+|</u', $src, $ms, PREG_SET_ORDER);
        foreach ($ms as $m) {
            $t = $m[0];
            if (str_starts_with($t, '<!--')) continue;
            if (($m[2] ?? '') === '') { $out[] = $t === '<' ? '&lt;' : str_replace(['{', '}'], ['&#123;', '&#125;'], self::esc(self::decode($t))); continue; }
            $tag = self::lower($m[2]);
            $tag = self::RICH_RENAME[$tag] ?? $tag;
            if (!isset(self::RICH[$tag])) continue;
            if (($m[1] ?? '') !== '') {
                $k = array_search($tag, array_reverse($open, true), true);
                if ($k !== false) { for ($x = count($open) - 1; $x >= $k; $x--) $out[] = '</' . $open[$x] . '>'; $open = array_slice($open, 0, $k); }
                continue;
            }
            $attrs = [];
            preg_match_all('/(' . $NW . '=]+)(?:' . $W . '*=' . $W . '*(?:"([^"]*)"|\'([^\']*)\'|(' . $NW . '>]+)))?/u', $m[3] ?? '', $as, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
            foreach ($as as $a) $attrs[self::lower($a[1])] = self::decode($a[2] ?? $a[3] ?? $a[4] ?? '');
            $keep = [];
            if ($tag === 'a') {
                $href = self::trim(self::truthy($attrs['href'] ?? null) ? $attrs['href'] : '');
                if ($href !== '' && self::validHref($href, null)) $keep[] = 'href="' . self::escAttr($href) . '"';
                if (($attrs['target'] ?? null) === '_blank') $keep[] = 'target="_blank" rel="noopener"';
            }
            if ($tag === 'img') {
                $s = self::trim($attrs['src'] ?? '');
                if (!$imgOk || !self::truthy($imgOk($s))) continue;
                $keep[] = 'src="' . self::escAttr($s) . '"';
                $keep[] = 'alt="' . self::escAttr(self::slice16(preg_replace('/[<>{}|]/', '', $attrs['alt'] ?? ''), 0, 160)) . '"';
            }
            if ($tag === 'th' || $tag === 'td') foreach (['colspan', 'rowspan'] as $k) if (preg_match('/^[2-9]$/D', $attrs[$k] ?? '')) $keep[] = $k . '="' . $attrs[$k] . '"';
            $cls = array_values(array_filter(preg_split('/' . $W . '+/u', $attrs['class'] ?? ''), fn($c) => preg_match(self::RICH_CLASSES, $c) === 1));
            if ($cls) $keep[] = 'class="' . implode(' ', $cls) . '"';
            $out[] = '<' . $tag . ($keep ? ' ' . implode(' ', $keep) : '') . '>';
            if (!in_array($tag, self::RICH_VOID, true)) $open[] = $tag;
        }
        for ($x = count($open) - 1; $x >= 0; $x--) $out[] = '</' . $open[$x] . '>';
        $r = implode('', $out);
        $r = preg_replace('/<(p|h2|h3|h4|li|blockquote|figcaption)>(' . $W . '|&nbsp;|<br>)*<\/\1>/u', '', $r) ?? $r;
        $r = preg_replace('/<figure( class="[^"]*")?>' . $W . '*<\/figure>/u', '', $r) ?? $r;
        $r = preg_replace('/<a( [^>]*)?>' . $W . '*<\/a>/u', '', $r) ?? $r;
        $r = preg_replace('/<a>([\s\S]*?)<\/a>/', '$1', $r);
        return self::trim($r);
    }

    /* ---------- aplicação das edições ---------- */

    public static function resolve($units, $edits)
    {
        $map = [];
        $orphans = [];
        $edits = is_array($edits) ? $edits : [];
        // ordem de Object.entries: chaves de índice inteiro primeiro (crescente), depois as demais na ordem de inserção
        $intKeys = [];
        $other = [];
        foreach ($edits as $k => $v) {
            if (is_int($k) && $k >= 0 && $k < 4294967295) $intKeys[] = $k; else $other[] = $k;
        }
        sort($intKeys);
        $baseKey = function ($u) { return self::jsonKey($u['base'] ?? null); };
        foreach (array_merge($intKeys, $other) as $key) {
            $ed = $edits[$key];
            $id = (string)$key;
            $kind = is_array($ed) ? ($ed['kind'] ?? null) : null;
            $hasBase = is_array($ed) && array_key_exists('base', $ed);
            $eb = $hasBase ? self::jsonKey($ed['base']) : null;
            $same = fn($x) => $hasBase && $kind !== null && ($x['kind'] ?? null) === $kind && $baseKey($x) === $eb;
            $u = null;
            foreach ($units as $x) if (($x['id'] ?? null) === $id && $same($x)) { $u = $x; break; }
            if (!$u) {
                $idx = self::num(substr($id, 1));
                $cands = [];
                foreach ($units as $x) if ($same($x) && !isset($map[$x['id']])) $cands[] = $x;
                usort($cands, function ($a, $b) use ($idx) {
                    $d = abs(self::num(substr($a['id'], 1)) - $idx) - abs(self::num(substr($b['id'], 1)) - $idx);
                    if (is_nan($d)) return 0;
                    return $d <=> 0;
                });
                $u = $cands[0] ?? null;
            }
            if ($u && !isset($map[$u['id']])) $map[$u['id']] = ['unit' => $u, 'edit' => $ed]; else $orphans[] = $id;
        }
        return ['map' => $map, 'orphans' => $orphans];
    }

    private static function findAttr(array $u, string $name): ?array
    {
        foreach ($u['el']['attrs'] as $a) if ($a['name'] === $name) return $a;
        return null;
    }
    private static function attrSplice(array &$splices, array $u, string $name, $value): void
    {
        $a = self::findAttr($u, $name);
        if ($value === null) { if ($a) $splices[] = [$a['start'] - 1, $a['end'], '']; return; }
        if ($a && $a['vStart'] >= 0) $splices[] = [$a['vStart'], $a['vEnd'], self::esc($value)];
        elseif ($a) $splices[] = [$a['start'], $a['end'], $name . '="' . self::esc($value) . '"'];
        else $splices[] = [$u['el']['insertAt'], $u['el']['insertAt'], ' ' . $name . '="' . self::esc($value) . '"'];
    }
    private static function boolAttr(array &$splices, array $u, string $name, bool $on): void
    {
        $a = self::findAttr($u, $name);
        if ($on && !$a) $splices[] = [$u['el']['insertAt'], $u['el']['insertAt'], ' ' . $name];
        if (!$on && $a) $splices[] = [$a['start'] - 1, $a['end'], ''];
    }

    public static function apply($src, $edits)
    {
        $src = (string)$src;
        $units = self::extract($src)['units'];
        $r = self::resolve($units, $edits);
        $splices = [];
        foreach ($r['map'] as $entry) {
            $u = $entry['unit'];
            $edit = $entry['edit'];
            $v = is_array($edit) && self::truthy($edit['value'] ?? null) && is_array($edit['value']) ? $edit['value'] : [];
            $has = fn($k) => array_key_exists($k, $v);
            if (($u['kind'] === 'text' || $u['kind'] === 'link') && $has('html') && isset($u['range'])) $splices[] = [$u['range'][0], $u['range'][1], self::str($v['html'])];
            if ($u['kind'] === 'link') {
                if ($has('href')) self::attrSplice($splices, $u, 'href', $v['href']);
                if ($has('newTab') && $v['newTab'] !== $u['base']['newTab']) {
                    if (self::truthy($v['newTab'])) {
                        self::attrSplice($splices, $u, 'target', '_blank');
                        if (!self::findAttr($u, 'rel')) self::attrSplice($splices, $u, 'rel', 'noopener');
                    } else self::attrSplice($splices, $u, 'target', null);
                }
            }
            if ($u['kind'] === 'image') {
                if ($has('image')) self::attrSplice($splices, $u, 'src', $v['image']);
                if ($has('alt')) self::attrSplice($splices, $u, 'alt', $v['alt']);
                if ($has('image') && $v['image'] !== $u['base']['image']) {
                    foreach (['width', 'height', 'srcset'] as $n) if (self::findAttr($u, $n)) self::attrSplice($splices, $u, $n, null);
                }
            }
            if ($u['kind'] === 'pic') {
                $parts = explode('|', $u['token']);
                if ($has('image')) $parts[0] = $v['image'];
                if ($has('alt')) $parts[1] = preg_replace('/[|}]/', '', self::str($v['alt']));
                $max = max(array_keys($parts));
                $j = [];
                for ($k = 0; $k <= $max; $k++) $j[] = isset($parts[$k]) ? self::str($parts[$k]) : '';
                $splices[] = [$u['range'][0], $u['range'][1], '{{pic:' . implode('|', $j) . '}}'];
            }
            if ($u['kind'] === 'field') {
                if ($has('placeholder') && $u['hasPlaceholder']) self::attrSplice($splices, $u, 'placeholder', self::truthy($v['placeholder']) ? $v['placeholder'] : null);
                if ($has('required')) self::boolAttr($splices, $u, 'required', self::truthy($v['required']));
                if ($has('maxlength')) self::attrSplice($splices, $u, 'maxlength', self::truthy($v['maxlength']) ? self::str($v['maxlength']) : null);
            }
        }
        usort($splices, fn($a, $b) => ($b[0] - $a[0]) ?: ($b[1] - $a[1]));
        $out = $src;
        foreach ($splices as [$s, $e, $rep]) $out = self::slice($out, 0, $s) . $rep . self::slice($out, $e);
        return ['html' => $out, 'orphans' => $r['orphans'], 'applied' => count($r['map'])];
    }
}
