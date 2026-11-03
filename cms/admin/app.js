/* Painel MedicGLOBAL — interface (JavaScript puro, sem dependências; compatível com CSP sem "unsafe-inline"). */
(function () {
  "use strict";
  var S = { csrf: null, user: null, status: null, siteData: null };
  var app = document.getElementById("app");

  /* ---------- utilidades ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  // esvazia o elemento e insere o conteúdo (aceita listas e ignora null/false)
  function fill(el) { el.replaceChildren(); for (var i = 1; i < arguments.length; i++) add(el, arguments[i]); return el; }
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var decodeEl = document.createElement("textarea");
  function decode(s) { decodeEl.innerHTML = String(s || ""); return decodeEl.value; }
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function plainLen(html) { var d = document.createElement("div"); d.innerHTML = cleanInline(html); return d.textContent.replace(/\s+/g, " ").trim().length; }
  // só a marcação de texto aceita pelo servidor (o servidor saneia de novo)
  var INLINE = { EM: "em", STRONG: "strong", B: "strong", I: "em", BR: "br", U: "u", MARK: "mark", SUP: "sup", SUB: "sub" };
  function cleanInline(html) {
    var doc = new DOMParser().parseFromString("<div>" + String(html || "") + "</div>", "text/html");
    function walk(n) {
      var out = "";
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) out += escHtml(c.nodeValue);
        else if (c.nodeType === 1) {
          var t = INLINE[c.tagName];
          if (t === "br") out += "<br>";
          else if (t) out += "<" + t + ">" + walk(c) + "</" + t + ">";
          else if (c.tagName === "DIV" || c.tagName === "P") out += (out ? "<br>" : "") + walk(c);
          else out += walk(c);
        }
      });
      return out;
    }
    return walk(doc.body.firstChild).replace(/(<br>)+$/, "");
  }
  function fmtDate(iso) { if (!iso) return "—"; var d = new Date(iso); return d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB"; }

  function toast(msg, type) {
    var t = h("div", { class: "toast" + (type ? " toast--" + type : "") }, h("span", { text: msg }));
    $("#toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, type === "err" ? 7000 : 4000);
  }
  function modal(content, opts) {
    opts = opts || {};
    var bg = h("div", { class: "modal-bg" });
    var box = h("div", { class: "modal" + (opts.wide ? " modal--wide" : ""), role: "dialog", "aria-modal": "true" }, content);
    bg.appendChild(box);
    var close = function () { bg.remove(); document.removeEventListener("keydown", esc); if (opts.onClose) opts.onClose(); };
    var esc = function (e) { if (e.key === "Escape") close(); };
    bg.addEventListener("mousedown", function (e) { if (e.target === bg) close(); });
    document.addEventListener("keydown", esc);
    document.body.appendChild(bg);
    var f = box.querySelector("input, button, textarea, select");
    if (f) f.focus();
    return { close: close, box: box };
  }
  function confirmDialog(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var m;
      var ok = h("button", { class: "btn" + (danger ? " btn--danger" : ""), type: "button", text: okLabel || "Confirmar", onclick: function () { resolve(true); m.close(); } });
      m = modal([h("h2", { text: title }), typeof text === "string" ? h("p", { class: "muted", text: text }) : text,
        h("div", { class: "actions" }, h("button", { class: "btn btn--ghost", type: "button", text: "Cancelar", onclick: function () { m.close(); } }), ok)], { onClose: function () { resolve(false); } });
      ok.focus();
    });
  }

  function api(method, url, body) {
    var isBlob = body instanceof Blob;
    var headers = { "X-CSRF-Token": S.csrf || "" };
    if (body && !isBlob) headers["Content-Type"] = "application/json";
    return fetch(url, { method: method, headers: headers, body: isBlob ? body : body ? JSON.stringify(body) : undefined, credentials: "same-origin" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && url !== "/api/admin/login") { S.csrf = null; renderLogin("Sua sessão expirou. Entre novamente."); throw Object.assign(new Error(j.error || "Sessão expirada"), { silent: true }); }
          if (r.status === 403 && j.mustChange) { renderChangePassword(true); throw Object.assign(new Error(j.error), { silent: true }); }
          if (!r.ok) throw Object.assign(new Error(j.error || "Erro " + r.status), { fields: j.fields, status: r.status, list: j.list });
          return j;
        });
      }, function () { throw new Error("Sem conexão com o servidor."); });
  }
  function fail(e) { if (!e.silent) toast(e.message, "err"); }

  // campo com rótulo, contador e mensagem de erro
  function field(label, input, o) {
    o = o || {};
    var err = h("span", { class: "err", role: "alert" });
    var counter = o.limit ? h("span", { class: "counter" }) : null;
    var wrap = h("div", { class: "field" + (o.class ? " " + o.class : "") }, h("label", { for: input.id || null }, h("span", { text: label }), counter), input, o.hint ? h("span", { class: "hint", text: o.hint }) : null, err);
    wrap.setError = function (m) { err.textContent = m || ""; wrap.classList.toggle("has-error", !!m); };
    wrap.update = function (len) {
      if (!counter) return;
      counter.textContent = len + " / " + o.limit;
      counter.classList.toggle("over", len > o.limit);
      wrap.setError(len > o.limit ? "Passou do limite de " + o.limit + " caracteres." : "");
    };
    if (counter) {
      var measure = o.measure || function () { return (input.value || "").length; };
      var upd = function () { wrap.update(measure()); };
      input.addEventListener("input", upd);
      setTimeout(upd);
    }
    return wrap;
  }
  var uid = 0;
  function inp(attrs) { attrs = attrs || {}; attrs.id = attrs.id || "f" + (++uid); var el = h(attrs.tag || "input", Object.assign({}, attrs, { tag: null, value: null })); if (attrs.value != null) el.value = attrs.value; return el; }

  /* ---------- login ---------- */
  function renderLogin(msg) {
    var email = inp({ type: "email", autocomplete: "username", required: true, placeholder: "seu.email@medicglobal.com.br" });
    var pw = inp({ type: "password", autocomplete: "current-password", required: true });
    var alert = h("div", { class: "alert alert--err" + (msg ? "" : " hidden"), role: "alert", text: msg || "" });
    if (msg && /expirou/.test(msg)) alert.className = "alert alert--info";
    var btn = h("button", { class: "btn btn--block", type: "submit", text: "Entrar" });
    var toggle = h("button", { class: "pw-toggle", type: "button", text: "Mostrar", "aria-label": "Mostrar senha", onclick: function () { var s = pw.type === "password"; pw.type = s ? "text" : "password"; toggle.textContent = s ? "Ocultar" : "Mostrar"; } });
    var form = h("form", { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      if (!email.value.trim() || !pw.value) { alert.className = "alert alert--err"; alert.textContent = "Informe o e-mail e a senha."; return; }
      btn.disabled = true; btn.textContent = "Entrando…";
      api("POST", "/api/admin/login", { email: email.value, password: pw.value }).then(function (j) {
        S.csrf = j.csrf; S.user = j.user;
        if (j.mustChange) renderChangePassword(true); else start();
      }).catch(function (e) {
        alert.className = "alert alert--err"; alert.textContent = e.message;
        btn.disabled = false; btn.textContent = "Entrar"; pw.value = ""; pw.focus();
      });
    } },
      field("E-mail", email),
      field("Senha", h("div", { class: "pw-wrap" }, pw, toggle)),
      btn);
    // o rótulo "Senha" aponta para o campo dentro do invólucro
    form.querySelectorAll("label")[1].setAttribute("for", pw.id);
    app.replaceChildren(h("div", { class: "login" },
      h("div", {},
        h("main", { class: "login-card" },
          h("img", { src: "/admin/logo.png", alt: "MedicGLOBAL Saúde" }),
          h("h1", { text: "Painel administrativo" }),
          h("p", { class: "lead", text: "Acesso restrito à equipe responsável pelo conteúdo do site." }),
          alert, form),
        h("p", { class: "login-foot", text: "Conexão protegida · após 5 tentativas incorretas o acesso é bloqueado temporariamente" }))));
    email.focus();
  }

  /* ---------- troca de senha ---------- */
  function passwordForm(forced, done) {
    var cur = inp({ type: "password", autocomplete: "current-password" });
    var nw = inp({ type: "password", autocomplete: "new-password" });
    var cf = inp({ type: "password", autocomplete: "new-password" });
    var rules = [["12 caracteres ou mais", function (v) { return v.length >= 12; }], ["letra maiúscula e minúscula", function (v) { return /[a-z]/.test(v) && /[A-Z]/.test(v); }], ["número", function (v) { return /\d/.test(v); }], ["símbolo (ex.: # % @ !)", function (v) { return /[^A-Za-z0-9]/.test(v); }]];
    var list = h("ul", { class: "checklist" }, rules.map(function (r) { return h("li", { text: r[0] }); }));
    nw.addEventListener("input", function () { rules.forEach(function (r, i) { list.children[i].classList.toggle("ok", r[1](nw.value)); }); });
    var fCur = field(forced ? "Senha provisória (atual)" : "Senha atual", cur), fNw = field("Nova senha", nw), fCf = field("Confirme a nova senha", cf);
    fNw.appendChild(list);
    var alert = h("div", { class: "alert alert--err hidden", role: "alert" });
    var btn = h("button", { class: "btn", type: "submit", text: "Salvar nova senha" });
    return h("form", { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      [fCur, fNw, fCf].forEach(function (f) { f.setError(""); });
      alert.classList.add("hidden");
      if (nw.value !== cf.value) { fCf.setError("A confirmação não confere."); return; }
      btn.disabled = true;
      api("POST", "/api/admin/password", { current: cur.value, next: nw.value, confirm: cf.value }).then(function () {
        toast("Senha alterada com sucesso.", "ok"); done();
      }).catch(function (e) {
        var f = e.fields || {};
        if (f.current) fCur.setError(f.current); if (f.next) fNw.setError(f.next); if (f.confirm) fCf.setError(f.confirm);
        if (!e.fields) { alert.textContent = e.message; alert.classList.remove("hidden"); }
      }).then(function () { btn.disabled = false; });
    } }, alert, fCur, fNw, fCf, h("div", { class: "actions" }, btn));
  }
  function renderChangePassword(forced) {
    app.replaceChildren(h("div", { class: "login" }, h("div", {}, h("main", { class: "login-card" },
      h("img", { src: "/admin/logo.png", alt: "MedicGLOBAL Saúde" }),
      h("h1", { text: "Crie a sua senha" }),
      h("p", { class: "lead", text: "Por segurança, troque a senha provisória antes de usar o painel." }),
      passwordForm(forced, start),
      h("p", { class: "small" }, h("button", { class: "link-btn", type: "button", text: "Sair", onclick: logout }))))));
  }
  function logout() { api("POST", "/api/admin/logout").catch(function () {}).then(function () { S.csrf = null; location.hash = ""; renderLogin(); }); }

  /* ---------- estrutura ---------- */
  var ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    pages: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    news: '<path d="M5 4h12v16H6a2 2 0 0 1-2-2V5"/><path d="M17 8h3v10a2 2 0 0 1-2 2"/><path d="M8 8h6M8 12h6M8 16h4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    info: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h7M16 10h1"/>',
    brand: '<circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M3 12h18"/>',
    form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h3"/><path d="m11 17 2 2 4-4"/>',
    chart: '<path d="M4 20V11M10 20V5M16 20v-7M21 20H3"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    ext: '<path d="M14 4h6v6M20 4 10 14M18 14v6H4V6h6"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  var SHARED_HINT = "Trechos entre {{ }} são dados compartilhados: edite o valor logo abaixo e ele muda em todo o site.";
  function icon(n) { var s = h("span", { class: "ico", "aria-hidden": "true" }); s.innerHTML = '<svg viewBox="0 0 24 24">' + ICONS[n] + "</svg>"; return s; }
  // [rota, nome, ícone, permissão necessária]
  var NAV = [
    ["Conteúdo do site", [["", "Visão geral", "home"], ["pages", "Páginas", "pages", "pages"], ["news", "Notícias", "news", "news"]]],
    ["Configurações", [["identity", "Identidade visual", "brand", "identity"], ["forms", "Formulários", "form", "forms"], ["analytics", "Google Analytics", "chart", "analytics"]]],
    ["Acompanhamento", [["inbox", "Mensagens recebidas", "inbox", "inbox"], ["audit", "Auditoria", "history", "audit"], ["users", "Usuários", "user"]]],
  ];
  var TITLES = {}, NEED = {}; NAV.forEach(function (g) { g[1].forEach(function (n) { TITLES[n[0]] = n[1]; NEED[n[0]] = n[3]; }); });
  TITLES.page = TITLES.pages; NEED.page = "pages"; TITLES.docs = "Documentos anuais"; NEED.docs = "pages";
  function can(p) { return !p || !!(S.user && (S.user.role === "admin" || (S.user.perms || []).indexOf(p) >= 0)); }
  var dirty = null; // função que diz se a tela atual tem alterações não salvas
  // trilha "onde estou" no topo: [["Páginas do site", "#/pages"], ["Página inicial"]]
  function setCrumbs(list) {
    var c = $("#crumbs"); if (!c) return;
    c.replaceChildren();
    list.forEach(function (it, i) {
      if (i) c.appendChild(h("span", { class: "sep", text: "›" }));
      c.appendChild(it[1] && i < list.length - 1 ? h("a", { href: it[1], text: it[0] }) : h("b", { text: it[0] }));
    });
  }
  function start() {
    var initials = (S.user && (S.user.name || S.user.email) || "?").split(/[\s@.]+/).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join("");
    var side = h("nav", { class: "side", "aria-label": "Menu do painel" },
      h("a", { class: "side-logo", href: "#/" }, h("img", { src: "/admin/logo.png", alt: "MedicGLOBAL" }), h("span", { text: "Painel" })),
      NAV.map(function (g) {
        var items = g[1].filter(function (n) { return can(n[3]); });
        if (!items.length) return null;
        return [h("div", { class: "side-group", text: g[0] }), items.map(function (n) { return n[0] === "pages" ? menusNav() : h("a", { class: "nav", href: "#/" + n[0], "data-nav": n[0] }, icon(n[2]), n[1]); })];
      }),
      h("div", { class: "side-user" }, h("span", { class: "avatar", text: initials }),
        h("div", { class: "who" }, h("b", { text: (S.user && S.user.name) || "Administrador" }), h("span", { text: S.user ? S.user.email : "" })),
        h("button", { class: "btn btn--quiet btn--sm", type: "button", title: "Sair", "aria-label": "Sair", onclick: logout }, icon("logout"))));
    var top = h("header", { class: "top" },
      h("button", { class: "btn btn--quiet btn--sm menu-btn", type: "button", "aria-label": "Abrir menu", onclick: function () { shell.classList.toggle("nav-open"); } }, icon("menu")),
      h("nav", { class: "crumbs grow", id: "crumbs", "aria-label": "Você está em" }),
      h("span", { class: "status-chip hide-sm", id: "pubstatus" }),
      h("a", { class: "btn btn--quiet btn--sm hide-sm", href: "/", target: "_blank", rel: "noopener" }, icon("ext"), "Ver site"),
      h("button", { class: "btn btn--ghost btn--sm hide-sm", type: "button", onclick: function () { preview(S.currentKey || "pt/index.html"); } }, icon("eye"), "Visualizar rascunho"),
      can("publish") ? h("button", { class: "btn btn--sm", type: "button", id: "pubbtn", onclick: function () { publish(); } }, icon("send"), h("span", { text: "Publicar" })) : null);
    var main = h("div", { class: "main" }, top, h("main", { class: "content", id: "view" }));
    var shell = h("div", { class: "shell" }, side, main);
    side.addEventListener("click", function (e) { if (e.target.closest("a")) shell.classList.remove("nav-open"); });
    app.replaceChildren(shell);
    refreshStatus();
    route();
  }

  /* ---------- menus suspensos: páginas do site, componentes e documentos anuais (RN 565, IDSS) ---------- */
  // [id, nome no menu, ícone, grupo de páginas no servidor, tipo de documento anual]
  var DD = [
    ["site", "Páginas", "pages", "Páginas do site"],
    ["comp", "Componentes compartilhados", "layers", "Componentes compartilhados"],
    ["rn565", "Reajuste (RN 565)", "percent", "Reajuste de contratos (RN 565)", "rn565"],
    ["idss", "IDSS", "chart", "IDSS", "idss"],
  ];
  var navPages = null;
  function menusNav() {
    return DD.map(function (d) {
      var list = h("div", { class: "dd", id: "dd-" + d[0], hidden: true });
      var btn = h("button", { class: "nav nav--dd", type: "button", "data-dd": d[0], "aria-expanded": "false", "aria-controls": "dd-" + d[0], onclick: function () { toggleDd(d[0]); } },
        icon(d[2]), h("span", { class: "grow", text: d[1] }), h("span", { class: "dd-chev" }, icon("chev")));
      return h("div", { class: "dd-wrap" }, btn, list);
    });
  }
  function toggleDd(id, open) {
    var list = $("#dd-" + id), btn = $('[data-dd="' + id + '"]');
    if (!list) return;
    var show = open === undefined ? list.hidden : open;
    list.hidden = !show; btn.setAttribute("aria-expanded", String(show));
    if (show && !navPages) refreshPagesNav();
  }
  function refreshPagesNav() {
    if (!can("pages")) return;
    return api("GET", "/api/admin/pages").then(function (r) {
      navPages = r.pages;
      DD.forEach(function (d) {
        var list = $("#dd-" + d[0]); if (!list) return;
        var items = r.pages.filter(function (p) { return p.group === d[3]; });
        fill(list, items.map(function (p) {
          return h("a", { class: "dd-item", href: "#/page/" + p.key, "data-key": p.key }, h("span", { class: "lbl", text: p.title }), p.pending ? h("i", { class: "mark on", title: "Alterações ainda não publicadas" }) : null);
        }), d[4] ? h("a", { class: "dd-item dd-add", href: "#/docs/" + d[4] + "/novo", "data-doc": d[4] }, h("span", { class: "lbl", text: "+ Cadastrar novo ano" })) : null);
      });
      markDd();
    }).catch(fail);
  }
  // destaca o item aberto e abre o menu em que ele está
  function markDd() {
    document.querySelectorAll(".dd-item[data-key]").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-key") === S.openKey); });
    document.querySelectorAll(".dd-add").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-doc") === S.openDoc); });
    document.querySelectorAll(".nav--dd").forEach(function (b) { b.classList.toggle("is-active", !!document.querySelector("#" + b.getAttribute("aria-controls") + " .dd-item.is-active")); });
    var cur = document.querySelector(".dd-item.is-active");
    if (cur) toggleDd(cur.closest(".dd").id.slice(3), true);
  }
  // em qual menu fica uma página (antes de a lista chegar do servidor)
  function ddOf(key) { return /^pt\/rn565/.test(key) ? "rn565" : /^pt\/idss/.test(key) ? "idss" : /^partial\//.test(key) ? "comp" : "site"; }
  function refreshStatus() {
    return api("GET", "/api/admin/status").then(function (s) {
      S.status = s;
      var el = $("#pubstatus"); if (!el) return;
      var n = s.pending.length;
      el.replaceChildren(h("span", { class: "dot" + (n ? " dot--warn" : "") }), n ? n + (n === 1 ? " alteração para publicar" : " alterações para publicar") : "Tudo publicado");
      el.title = s.lastPublish ? "Última publicação: " + fmtDate(s.lastPublish) : "";
      if ($("#pubbtn")) $("#pubbtn").disabled = !n;
    }).catch(fail);
  }
  function preview(key) {
    var w = window.open("about:blank", "_blank");
    api("POST", "/api/admin/preview", { key: key }).then(function (j) {
      if (w) w.location = j.url; else location.href = j.url;
      if (Object.keys(j.orphans || {}).length) toast("Algumas edições antigas não encontraram o elemento original (o código da página mudou). Revise a página.", "err");
    }).catch(function (e) { if (w) w.close(); fail(e); });
  }
  function publish(force) {
    var pend = (S.status && S.status.pending) || [];
    var names = { site: "Dados compartilhados (endereços, telefones…)", noticias: "Notícias", identity: "Identidade visual", analytics: "Google Analytics", forms: "Formulários (limite de anexo)" };
    var titles = {}; (navPages || []).forEach(function (p) { titles[p.key] = p.title; });
    var seen = {};
    var rows = pend.map(function (p) {
      if (p.area !== "page") return names[p.area] || p.area;
      var pt = p.key.replace(/^en\//, "pt/").replace(/^partial\/en\//, "partial/pt/");
      if (seen[pt]) return null; seen[pt] = true;
      return "Página: " + (titles[pt] || pt.replace(/^(partial\/)?pt\//, "")) + " (português e inglês)";
    }).filter(Boolean);
    var list = h("ul", { class: "small" }, rows.map(function (t) { return h("li", { text: t }); }));
    if (dirty && dirty()) { toast("Salve ou cancele as alterações desta tela antes de publicar.", "err"); return; }
    (force ? Promise.resolve(true) : confirmDialog("Publicar alterações?", h("div", {}, h("p", { class: "muted", text: "O conteúdo abaixo vai para o site público agora, em português e em inglês. A versão atual fica guardada e pode ser restaurada em Auditoria." }), list), "Publicar agora")).then(function (ok) {
      if (!ok) return;
      var b = $("#pubbtn"), t = b.querySelector("span:last-child"); b.disabled = true; t.textContent = "Publicando…";
      api("POST", "/api/admin/publish", { force: !!force }).then(function (j) {
        toast("Site publicado com sucesso (" + j.ms + " ms).", "ok");
        if (Object.keys(j.orphans || {}).length) toast("Atenção: algumas edições não encontraram o elemento original e não foram aplicadas.", "err");
      }).catch(function (e) {
        if (e.status !== 409) return fail(e);
        confirmDialog("Tradução para o inglês pendente", e.message + " Você pode publicar agora (o inglês dessas páginas fica com a versão anterior) ou esperar e tentar de novo.", "Publicar mesmo assim").then(function (ok2) { if (ok2) publish(true); });
      }).then(function () { t.textContent = "Publicar"; refreshStatus(); refreshPagesNav(); route(); });
    });
  }

  var VIEWS = {};
  var lastHash = location.hash;
  function route() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    var name = parts[0] || "";
    if (!VIEWS[name] || !can(NEED[name])) name = "";
    document.querySelectorAll("[data-nav]").forEach(function (a) { var n = a.getAttribute("data-nav"); a.classList.toggle("is-active", n === name); });
    S.openKey = name === "page" ? parts.slice(1).join("/") : null;
    S.openDoc = name === "docs" && parts[2] === "novo" ? parts[1] : null;
    if (S.openKey) toggleDd(ddOf(S.openKey), true);
    if (name === "docs" && parts[1]) toggleDd(parts[1], true);
    markDd();
    var view = $("#view");
    if (!view) return;
    dirty = null; S.currentKey = null;
    setCrumbs(name ? [[TITLES[name] || "Painel"]] : [["Visão geral"]]);
    fill(view, h("p", { class: "muted", text: "Carregando…" }));
    VIEWS[name](view, name ? parts.slice(1) : []);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", function () {
    if (dirty && dirty() && location.hash !== lastHash) {
      var target = location.hash;
      history.replaceState(null, "", lastHash);
      confirmDialog("Sair sem salvar?", "As alterações desta tela ainda não foram salvas e serão perdidas.", "Sair sem salvar", true).then(function (ok) { if (ok) { dirty = null; location.hash = target; } });
      return;
    }
    lastHash = location.hash;
    route();
  });
  window.addEventListener("beforeunload", function (e) { if (dirty && dirty()) { e.preventDefault(); e.returnValue = ""; } });

  function head(title, desc, actions) { return h("div", { class: "page-head" }, h("div", {}, h("h1", { text: title }), desc ? h("p", { text: desc }) : null), actions ? h("div", { class: "actions" }, actions) : null); }
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  /* ---------- visão geral ---------- */
  VIEWS[""] = function (view) {
    var none = Promise.resolve(null);
    Promise.all([api("GET", "/api/admin/status"), can("pages") ? api("GET", "/api/admin/pages") : none, can("inbox") ? api("GET", "/api/admin/forms") : none]).then(function (r) {
      var st = r[0], pages = r[1] && r[1].pages, fm = r[2] && r[2].forms;
      function stat(ic, val, label, small) { return h("div", { class: "stat" }, icon(ic), h("b", { class: small ? "small" : null, text: val }), h("span", { text: label })); }
      var shortcuts = [["pages", "#/page/pt/index.html", "home", "Editar a página inicial"], ["news", "#/news/nova", "news", "Publicar uma notícia"], ["inbox", "#/inbox", "inbox", "Ver mensagens recebidas"], ["audit", "#/audit", "history", "Ver quem alterou o quê"], ["analytics", "#/analytics", "chart", "Configurar o Google Analytics"]].filter(function (x) { return can(x[0]); });
      fill(view,
        head("Olá" + (S.user && S.user.name ? ", " + S.user.name : "") + "!", "Tudo o que dá para editar no site, organizado na mesma ordem em que aparece para o visitante."),
        h("div", { class: "stats" },
          pages ? stat("pages", pages.filter(function (p) { return p.group === "Páginas do site"; }).length, "páginas do site (inglês traduzido automaticamente)") : null,
          stat("edit", st.pending.length, "alterações aguardando publicação"),
          fm ? stat("inbox", fm.reduce(function (a, f) { return a + f.count; }, 0), "mensagens recebidas pelos formulários") : null,
          stat("history", st.lastPublish ? fmtDate(st.lastPublish) : "Ainda não", "última publicação" + (st.lastPublishBy ? " · " + st.lastPublishBy : ""), true)),
        h("div", { class: "card" }, h("h2", { text: "Como funciona" }), h("p", { class: "desc", text: "Nada vai para o ar sem confirmação." }),
          h("ol", { class: "steps" },
            h("li", {}, h("b", { text: "Edite em português" }), "Textos, imagens, botões e links de cada seção. O inglês é traduzido automaticamente."),
            h("li", {}, h("b", { text: "Salve o rascunho" }), "O site público ainda não muda."),
            h("li", {}, h("b", { text: "Visualize" }), "Confira a página com as mudanças."),
            h("li", {}, h("b", { text: "Publique" }), "O site é atualizado em segundos; tudo fica registrado na Auditoria."))),
        shortcuts.length ? h("div", { class: "card" }, h("h2", { text: "Atalhos" }), h("p", { class: "desc", text: "Tarefas mais comuns." }), h("div", { class: "shortcuts" },
          shortcuts.map(function (x) { return h("a", { class: "shortcut", href: x[1] }, icon(x[2]), x[3]); }))) : null);
    }).catch(fail);
  };

  /* ---------- lista de páginas (na ordem do site) ---------- */
  VIEWS.pages = function (view) {
    api("GET", "/api/admin/pages").then(function (r) {
      var q = inp({ type: "search", class: "input", placeholder: "Buscar página…", "aria-label": "Buscar página" });
      var list = h("div", {});
      var DESC = { "Páginas do site": "Na ordem do menu do site", "Componentes compartilhados": "Blocos que aparecem em mais de uma página", "Reajuste de contratos (RN 565)": "Um agrupamento por ano", "IDSS": "Um resultado por ano", "Outras": "" };
      function row(p, n) {
        return h("a", { class: "prow", href: "#/page/" + p.key },
          h("span", { class: "num", text: pad(n) }),
          h("div", {}, h("div", { class: "t", text: p.title }), h("div", { class: "f" }, h("span", { text: p.partial ? "Usado em várias páginas" : "/" + p.file }), p.area && !p.partial ? h("span", { class: "badge badge--line", text: p.area }) : null)),
          h("div", { class: "tags" },
            p.enPending ? h("span", { class: "badge badge--err", text: "tradução pendente" }) : null,
            p.pending ? h("span", { class: "badge badge--warn", text: "não publicado" }) : null,
            p.edits ? h("span", { class: "badge", text: p.edits + (p.edits === 1 ? " alteração" : " alterações") }) : null),
          h("span", { class: "go" }, icon("chev")));
      }
      function draw() {
        var term = q.value.toLowerCase(), groups = {};
        r.pages.filter(function (p) { return (p.title + " " + p.file + " " + (p.area || "")).toLowerCase().indexOf(term) >= 0; }).forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });
        list.replaceChildren();
        r.groups.forEach(function (g) {
          var items = groups[g];
          if (!items) return;
          var title = h("h3", {}, g, h("span", { class: "badge badge--line", text: items.length + (items.length === 1 ? " página" : " páginas") }), DESC[g] ? h("span", { class: "xs muted", text: "· " + DESC[g] }) : null);
          var rows = h("div", { class: "plist" }, items.map(function (p, i) { return row(p, i + 1); }));
          list.appendChild(h("div", { class: "plist-group" }, title, rows));
        });
        if (!list.children.length) list.appendChild(h("p", { class: "muted", text: "Nenhuma página encontrada." }));
      }
      q.addEventListener("input", draw);
      fill(view, head("Páginas do site", "As páginas estão na mesma ordem do menu do site (e também no menu lateral, em Páginas). Edite em português: a versão em inglês é traduzida automaticamente."),
        h("div", { class: "toolbar" }, q), list);
      draw();
    }).catch(fail);
  };

  /* ---------- editor de página ---------- */
  VIEWS.page = function (view, parts) {
    var key = parts.join("/");
    api("GET", "/api/admin/page?key=" + encodeURIComponent(key)).then(function (p) { pageEditor(view, p); }).catch(fail);
  };
  function pageEditor(view, P) {
    S.currentKey = P.partial ? null : P.key;
    setCrumbs([[TITLES.pages, "#/pages"], [P.title]]);
    var changes = {}, metaChanges = {}, fields = {}, shared = {}, propagate = {}, sharedInputs = {};
    var byId = {}; P.units.forEach(function (u) { byId[u.id] = u; });
    var unitSec = {}; P.sections.forEach(function (s) { s.units.forEach(function (id) { unitSec[id] = s.id; }); });
    var savebar = h("div", { class: "savebar hidden" });
    var saveInfo = h("span", { class: "grow" });
    var saveBtn = h("button", { class: "btn", type: "button", text: "Salvar rascunho", onclick: save });
    savebar.append(saveInfo, h("button", { class: "btn btn--ghost", type: "button", text: "Cancelar", onclick: cancel }), saveBtn);
    var nChanged = function () { return Object.keys(changes).length + Object.keys(metaChanges).length + Object.keys(shared).length; };
    dirty = function () { return nChanged() > 0; };
    var marks = {}; // bolinha de cada seção no índice
    function mark() {
      var n = nChanged();
      savebar.classList.toggle("hidden", !n);
      saveInfo.textContent = n + (n === 1 ? " campo alterado, ainda não salvo" : " campos alterados, ainda não salvos");
      var unsaved = {}; Object.keys(changes).forEach(function (id) { unsaved[unitSec[id]] = true; });
      Object.keys(shared).forEach(function (p) { P.units.forEach(function (u) { if (u.shared.indexOf(p) >= 0) unsaved[unitSec[u.id]] = true; }); });
      if (Object.keys(metaChanges).length) unsaved.seo = true;
      Object.keys(marks).forEach(function (sid) { marks[sid].classList.toggle("on", !!unsaved[sid]); });
    }
    function set(u, value) {
      var next = Object.assign({}, changes[u.id] || u.value, value);
      if (JSON.stringify(next) === JSON.stringify(u.value)) delete changes[u.id]; else changes[u.id] = next;
      var el = fields[u.id]; if (el) el.classList.toggle("is-dirty", !!changes[u.id]);
      mark();
    }
    function restore(u) {
      confirmDialog("Restaurar o conteúdo original?", "Este campo volta ao texto/imagem original do site (é preciso publicar depois).", "Restaurar").then(function (ok) {
        if (!ok) return;
        changes[u.id] = null; mark();
        save();
      });
    }
    function save() {
      var bad = view.querySelector(".counter.over");
      if (bad) { toast("Há campos acima do limite de caracteres.", "err"); bad.closest(".field").scrollIntoView({ block: "center" }); return; }
      saveBtn.disabled = true; saveBtn.textContent = "Salvando…";
      var prop = Object.keys(changes).filter(function (id) { return propagate[id]; });
      api("PUT", "/api/admin/page?key=" + encodeURIComponent(P.key), { edits: changes, meta: metaChanges, shared: shared, propagate: prop }).then(function (np) {
        var sv = np.saved || {}, n = (sv.also || []).length;
        toast("Rascunho salvo" + (n ? " e aplicado também em " + n + (n === 1 ? " outro lugar" : " outros lugares") : "") + ". O inglês foi traduzido automaticamente. Use Visualizar para conferir e Publicar para colocar no ar.", "ok");
        if (sv.warn) toast(sv.warn, "err");
        changes = {}; metaChanges = {}; shared = {};
        refreshPagesNav();
        var open = Array.prototype.map.call(view.querySelectorAll("details.sec[open]"), function (d) { return d.getAttribute("data-sec"); });
        var y = window.scrollY;
        pageEditor(view, np);
        open.forEach(function (id) { var d = view.querySelector('details[data-sec="' + id + '"]'); if (d) d.open = true; });
        window.scrollTo(0, y);
        refreshStatus();
      }).catch(function (e) {
        fail(e);
        Object.keys(e.fields || {}).forEach(function (id) {
          var el = fields[id]; if (!el) return;
          var f = el.querySelector(".field"); if (f && f.setError) f.setError(e.fields[id]);
          var sec = el.closest("details"); if (sec) sec.open = true;
        });
        var first = view.querySelector(".has-error"); if (first) first.scrollIntoView({ block: "center" });
      }).then(function () { saveBtn.disabled = false; saveBtn.textContent = "Salvar rascunho"; });
    }
    function cancel() {
      confirmDialog("Descartar as alterações não salvas?", "Os campos voltam ao último rascunho salvo.", "Descartar", true).then(function (ok) { if (ok) { changes = {}; metaChanges = {}; shared = {}; pageEditor(view, P); } });
    }

    // ---- campos ----
    function unitHead(u, title) {
      return h("div", { class: "unit-head" }, h("span", { class: "k", text: title || u.label }), h("span", { class: "grow" }),
        u.pending ? h("span", { class: "badge badge--warn", text: "não publicado" }) : u.edited ? h("span", { class: "badge", text: "alterado" }) : null,
        u.edited ? h("button", { class: "link-btn", type: "button", text: "Restaurar original", onclick: function () { restore(u); } }) : null);
    }
    function textInput(u, key, label) {
      var html = u.value[key], limit = u.limits[key];
      var rich = /<(em|strong|b|i|br|u|mark|sup|sub)\b/i.test(u.base[key] || "") || /<(em|strong|br)\b/.test(html);
      var wrap;
      if (rich) {
        var ed = h("div", { class: "rich", contenteditable: "true", role: "textbox", "aria-multiline": "true", id: "f" + (++uid) });
        ed.innerHTML = cleanInline(html);
        var bar = h("span", { class: "rich-bar" },
          h("button", { type: "button", text: "Destaque", title: "Texto em destaque (cor da marca)", onmousedown: function (e) { e.preventDefault(); document.execCommand("italic"); ed.dispatchEvent(new Event("input")); } }),
          h("button", { type: "button", text: "Negrito", onmousedown: function (e) { e.preventDefault(); document.execCommand("bold"); ed.dispatchEvent(new Event("input")); } }));
        ed.addEventListener("paste", function (e) { e.preventDefault(); document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain")); });
        ed.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (u.tag !== "h1" && u.tag !== "h2") document.execCommand("insertLineBreak"); } });
        ed.addEventListener("input", function () { var o = {}; o[key] = cleanInline(ed.innerHTML); set(u, o); });
        wrap = field(label, ed, { limit: limit, measure: function () { return plainLen(ed.innerHTML); }, hint: "Use “Destaque” para o trecho colorido." + (/\{\{L\./.test(html) ? " " + SHARED_HINT : "") });
        wrap.querySelector("label").insertBefore(bar, wrap.querySelector(".counter"));
      } else {
        var long = limit > 160 || /^(p|li|dd|blockquote|td)$/.test(u.tag);
        var el = inp({ tag: long ? "textarea" : "input", type: long ? null : "text", value: decode(html), rows: long ? Math.min(8, Math.ceil(decode(html).length / 90) + 1) : null });
        el.addEventListener("input", function () { var o = {}; o[key] = escHtml(el.value); set(u, o); });
        wrap = field(label, el, { limit: limit, measure: function () { return el.value.replace(/\s+/g, " ").trim().length; }, hint: /\{\{L\./.test(html) ? SHARED_HINT : null });
      }
      return wrap;
    }
    // dados compartilhados ({{L.x}}) usados no campo: o valor é um só para o site todo
    function sharedBox(u) {
      var paths = u.shared.filter(function (p) { return P.shared[p]; });
      if (!paths.length) return null;
      return h("div", { class: "shared" }, h("div", { class: "shared-title" }, icon("link"), "Dados compartilhados neste campo"), paths.map(function (p) {
        var d = P.shared[p];
        if (d.derived) return h("p", { class: "xs muted", text: d.label + ": montado automaticamente a partir da rua, bairro, cidade, UF e CEP." });
        var el = inp({ type: "text", value: shared[p] !== undefined ? shared[p] : d.value, spellcheck: d.type === "text" ? "true" : "false" });
        (sharedInputs[p] = sharedInputs[p] || []).push(el);
        el.addEventListener("input", function () {
          if (el.value === d.value) delete shared[p]; else shared[p] = el.value;
          sharedInputs[p].forEach(function (o) { if (o !== el) o.value = el.value; });
          mark();
        });
        return field(d.label, el, { hint: "Aparece em " + d.uses + (d.uses === 1 ? " lugar" : " lugares") + " do site — muda em todos ao salvar." + (d.value !== d.base ? " Original: " + d.base : ""), class: "field--shared" });
      }));
    }
    // o mesmo texto existe em outras páginas: opção de atualizar todos juntos
    function elsewhereBox(u) {
      if (!u.elsewhereCount) return null;
      var len = plainOf(u.base.html || "").length;
      propagate[u.id] = len >= 12; // rótulos curtos ("Saiba mais") começam desmarcados
      var cb = h("input", { type: "checkbox" }); cb.checked = propagate[u.id];
      cb.addEventListener("change", function () { propagate[u.id] = cb.checked; });
      return h("div", { class: "elsewhere" }, h("label", { class: "check" }, cb, "Aplicar a mudança também nos outros " + u.elsewhereCount + (u.elsewhereCount === 1 ? " lugar" : " lugares") + " onde este mesmo texto aparece"),
        h("details", { class: "xs" }, h("summary", { text: "Ver onde" }), h("ul", {}, u.elsewhere.map(function (t) { return h("li", { text: t }); }))));
    }
    function renderUnit(u) {
      var box = renderUnitBody(u);
      [sharedBox(u), elsewhereBox(u)].forEach(function (x) { if (x) box.appendChild(x); });
      return box;
    }
    function renderUnitBody(u) {
      var box = h("div", { class: "unit", "data-unit": u.id });
      fields[u.id] = box;
      if (u.kind === "text") {
        box.append(unitHead(u), textInput(u, "html", u.partialText ? "Trecho de texto" : "Texto"));
      } else if (u.kind === "link") {
        box.className = "unit linkbox";
        box.append(unitHead(u, u.label));
        if (u.value.html !== undefined) box.appendChild(textInput(u, "html", "Texto do " + (/Botão/.test(u.label) ? "botão" : "link")));
        var href = inp({ type: "text", value: u.value.href, spellcheck: "false", autocomplete: "off" });
        href.addEventListener("input", function () { set(u, { href: href.value.trim() }); });
        var nt = h("input", { type: "checkbox" }); nt.checked = !!u.value.newTab;
        nt.addEventListener("change", function () { set(u, { newTab: nt.checked }); });
        box.append(field("Destino (para onde o clique leva)", href, { hint: u.linkedData ? "Vinculado a um dado compartilhado (abaixo). Para mudar em todo o site, edite o dado; alterar aqui troca o destino só neste botão." :"Ex.: planos.html, https://…, tel:+55…, mailto:… ou #secao" }),
          h("label", { class: "check" }, nt, "Abrir em nova aba"));
        var kids = P.units.filter(function (x) { return x.link === u.id; });
        if (kids.length) box.appendChild(h("div", { class: "mt" }, kids.map(renderUnit)));
      } else if (u.kind === "image" || u.kind === "pic") {
        var th = h("div", { class: "thumb" }, u.preview ? h("img", { src: u.preview, alt: "" }) : "sem prévia");
        var alt = inp({ type: "text", value: u.value.alt });
        alt.addEventListener("input", function () { set(u, { alt: alt.value }); });
        box.append(unitHead(u), h("div", { class: "imgrow" },
          h("div", {}, th, h("button", { class: "btn btn--ghost btn--sm btn--block", type: "button", onclick: function () {
            pickImage({ purpose: "photo", sitePhotos: u.kind === "pic" }).then(function (sel) {
              if (!sel) return;
              set(u, { image: u.kind === "pic" ? sel.ref : sel.path });
              th.replaceChildren(h("img", { src: sel.url, alt: "" }));
            });
          } }, icon("image"), "Trocar imagem")),
          h("div", {}, u.decorative ? h("p", { class: "small muted", text: "Imagem decorativa (sem texto alternativo)." }) : field("Texto alternativo (acessibilidade e SEO)", alt, { limit: 160, hint: "Descreva o que aparece na imagem." }))));
      } else if (u.kind === "field") {
        box.append(unitHead(u, "Campo “" + u.name + "” do formulário"));
        var row = h("div", { class: "grid2" });
        if (u.hasPlaceholder) { var ph = inp({ type: "text", value: decode(u.value.placeholder) }); ph.addEventListener("input", function () { set(u, { placeholder: ph.value }); }); row.appendChild(field("Texto de exemplo (placeholder)", ph, { limit: 90 })); }
        var ml = inp({ type: "number", min: 1, max: 10000, value: u.value.maxlength });
        ml.addEventListener("input", function () { set(u, { maxlength: ml.value }); });
        if (u.type !== "select" && u.type !== "radio" && u.type !== "checkbox" && u.type !== "file") row.appendChild(field("Máximo de caracteres", ml, { hint: "Em branco: padrão do servidor (200; mensagem: 5000)." }));
        var rq = h("input", { type: "checkbox" }); rq.checked = !!u.value.required;
        rq.addEventListener("change", function () { set(u, { required: rq.checked }); });
        box.append(row, h("label", { class: "check" }, rq, "Preenchimento obrigatório"));
      }
      return box;
    }
    // dentro de cada seção, os campos são agrupados em blocos que começam em cada título (na ordem da página)
    var plainOf = function (s) { return decode(String(s || "").replace(/<[^>]*>/g, "")).replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ").trim(); };
    var isEyebrow = function (u) { return u.kind === "text" && /\beyebrow\b/.test(u.cls || ""); };
    var isHeading = function (u) { return u.kind === "text" && /^h[1-4]$/.test(u.tag); };
    function blocks(ids) {
      var out = [], cur = null;
      ids.forEach(function (id) {
        var u = byId[id];
        if (!cur || ((isHeading(u) || isEyebrow(u)) && cur.ids.some(function (x) { return !isEyebrow(byId[x]); }))) { cur = { ids: [] }; out.push(cur); }
        cur.ids.push(id);
      });
      out.forEach(function (b) {
        var hd = b.ids.map(function (id) { return byId[id]; }).find(isHeading) || b.ids.map(function (id) { return byId[id]; }).find(isEyebrow);
        b.title = hd ? plainOf(hd.value.html).slice(0, 80) : "";
      });
      return out;
    }

    // ---- índice "Nesta página" ----
    var outlineList = h("div", { class: "outline-list" });
    var outline = h("aside", { class: "outline", "aria-label": "Seções desta página" }, h("h3", { text: "Nesta página" }), outlineList,
      h("div", { class: "outline-legend" }, h("span", {}, h("i", { class: "mark on" }), "alterado, ainda não salvo"), h("span", {}, h("i", { class: "mark saved" }), "alterado no rascunho")));
    var allSecs = [];
    function addOutline(det, num, label, saved) {
      var m = h("i", { class: "mark" + (saved ? " saved" : "") });
      marks[det.getAttribute("data-sec")] = m;
      var b = h("button", { type: "button", onclick: function () { det.open = true; det.scrollIntoView({ behavior: "smooth", block: "start" }); } }, h("span", { class: "n", text: num }), h("span", { class: "lbl", text: label }), m);
      det.outlineBtn = b;
      outlineList.appendChild(b);
      allSecs.push(det);
    }
    function secCard(id, num, title, sub, tags, body, onOpen) {
      var det = h("details", { class: "sec", "data-sec": id, id: "sec-" + id },
        h("summary", { class: "g" }, h("span", { class: "snum", text: num }), h("span", {}, h("span", { class: "stitle", text: title }), sub ? h("span", { class: "ssub", text: sub }) : null), h("span", { class: "stags" }, tags), h("span", { class: "chev" }, icon("chev"))), body);
      if (onOpen) det.addEventListener("toggle", function () { if (det.open) onOpen(); });
      return det;
    }

    // ---- SEO ----
    var seo = null;
    if (P.meta) {
      var t = inp({ type: "text", value: P.meta.value.title }), d = inp({ tag: "textarea", rows: 3, value: P.meta.value.description });
      t.addEventListener("input", function () { if (t.value === P.meta.value.title) delete metaChanges.title; else metaChanges.title = t.value; mark(); });
      d.addEventListener("input", function () { if (d.value === P.meta.value.description) delete metaChanges.description; else metaChanges.description = d.value; mark(); });
      var ogTh = h("div", { class: "thumb" }, P.meta.ogPreview ? h("img", { src: P.meta.ogPreview, alt: "" }) : "");
      var metaEdited = JSON.stringify(P.meta.value) !== JSON.stringify(P.meta.base);
      seo = secCard("seo", "SEO", "Google e compartilhamento", "Título da aba, descrição nos resultados de busca e imagem ao compartilhar", metaEdited ? h("span", { class: "badge", text: "alterado" }) : null,
        h("div", { class: "sec-body" }, h("div", { class: "block" },
          field("Título da página (aba do navegador e Google)", t, { limit: P.meta.limits.title }),
          field("Descrição (resultado do Google)", d, { limit: P.meta.limits.description }),
          h("div", { class: "imgrow" }, h("div", {}, ogTh, h("button", { class: "btn btn--ghost btn--sm btn--block", type: "button", onclick: function () {
            pickImage({ purpose: "photo", sitePhotos: true }).then(function (sel) { if (!sel) return; metaChanges.og = sel.ref; ogTh.replaceChildren(h("img", { src: sel.url, alt: "" })); mark(); });
          } }, icon("image"), "Trocar imagem")), h("p", { class: "small muted", text: "Imagem exibida quando a página é compartilhada (WhatsApp, redes sociais). Ideal: 1200×630 px." })))));
      seo.querySelector(".snum").classList.add("xs");
      addOutline(seo, "—", "Google e compartilhamento", metaEdited);
    }

    // ---- seções, numeradas na ordem em que aparecem na página (o conteúdo é montado ao abrir) ----
    var secs = P.sections.map(function (s, i) {
      var ids = s.units.filter(function (id) { var u = byId[id]; return !(u.link && s.units.indexOf(u.link) >= 0); });
      var us = s.units.map(function (id) { return byId[id]; });
      var edited = us.filter(function (u) { return u.edited; }).length, pending = us.some(function (u) { return u.pending; });
      var firstHead = us.find(isHeading);
      var sub = firstHead ? plainOf(firstHead.value.html) : us[0] && us[0].value.html ? plainOf(us[0].value.html) : "";
      var body = h("div", { class: "sec-body" });
      var det = secCard(s.id, pad(i + 1), s.label, sub && sub !== s.label ? "“" + sub.slice(0, 90) + "”" : s.units.length + " campos",
        [edited ? h("span", { class: "badge", text: edited + (edited === 1 ? " alterado" : " alterados") }) : null, pending ? h("span", { class: "badge badge--warn", text: "não publicado" }) : null, h("span", { class: "badge badge--line", text: s.units.length + " campos" })],
        body, function () {
          if (body.children.length) return;
          var bl = blocks(ids);
          bl.forEach(function (b) { body.appendChild(h("div", { class: "block" }, bl.length > 1 && b.title ? h("div", { class: "block-title", text: b.title }) : null, b.ids.map(function (id) { return renderUnit(byId[id]); }))); });
        });
      det.searchText = us.map(function (u) { return (u.value.html || "") + " " + (u.value.alt || "") + " " + (u.value.href || ""); }).join(" ").toLowerCase();
      addOutline(det, pad(i + 1), s.label, edited > 0);
      return det;
    });
    if (secs.length === 1) secs[0].open = true;

    // destaca no índice a seção que está na tela (a última cujo topo já passou da barra superior)
    var spyLock = 0;
    function setCurrent(det) { allSecs.forEach(function (d) { d.outlineBtn.classList.toggle("is-current", d === det); }); }
    function spy() {
      if (Date.now() < spyLock || !document.body.contains(outline)) return;
      var cur = allSecs[0];
      allSecs.forEach(function (d) { if (!d.classList.contains("hidden") && d.getBoundingClientRect().top <= 140) cur = d; });
      setCurrent(cur);
    }
    window.addEventListener("scroll", function onScroll() { if (!document.body.contains(outline)) return window.removeEventListener("scroll", onScroll); spy(); }, { passive: true });
    allSecs.forEach(function (d) { d.outlineBtn.addEventListener("click", function () { setCurrent(d); spyLock = Date.now() + 900; }); });
    setTimeout(spy);
    var q = inp({ type: "search", class: "input", placeholder: "Buscar um texto nesta página…", "aria-label": "Buscar texto nesta página" });
    q.addEventListener("input", function () {
      var t = q.value.toLowerCase().trim();
      secs.forEach(function (d) { var hit = !t || d.searchText.indexOf(t) >= 0; d.classList.toggle("hidden", !hit); d.outlineBtn.classList.toggle("hidden", !hit); if (t && hit) d.open = true; });
    });

    // ---- cabeçalho: onde estou e navegação em sequência ----
    var dm = /^pt\/(rn565|idss)(?:-agrupamento)?(?:-(\d{4}))?\.html$/.exec(P.key);
    var docBtns = dm && can("pages") ? [dm[2] ? h("a", { class: "btn btn--ghost btn--sm", href: "#/docs/" + dm[1] + "/" + dm[2] }, icon("edit"), "Editar dados de " + dm[2]) : h("a", { class: "btn btn--ghost btn--sm", href: "#/docs/" + dm[1] }, icon("edit"), "Gerenciar anos"),
      h("a", { class: "btn btn--sm", href: "#/docs/" + dm[1] + "/novo" }, "+ Cadastrar novo ano")] : null;
    var pl = P.place || {};
    var where = P.partial ? "Componente compartilhado" : pl.group === "Páginas do site" ? "Página " + pl.pos + " de " + pl.total + " · " + pl.area : (pl.area || pl.group) + " · " + pl.pos + " de " + pl.total;
    var headCard = h("div", { class: "ed-head" },
      h("div", { class: "ed-head-top" },
        h("div", {}, h("div", { class: "eyebrow" }, where), h("h1", { text: P.title }),
          h("div", { class: "url", text: P.partial ? "A alteração vale para todas as páginas que usam este bloco." : "/" + P.url }),
          P.english ? h("div", { class: "en-status" + (P.english.pending ? " is-pending" : "") }, icon("globe"),
            P.english.pending ? "Tradução para o inglês pendente: será tentada de novo ao salvar ou publicar."
              : "Versão em inglês traduzida automaticamente" + (P.english.fields ? " (" + P.english.fields + (P.english.fields === 1 ? " campo alterado" : " campos alterados") + ")" : "") + ".",
            P.english.url ? h("a", { href: "/admin/preview/" + P.english.url, onclick: function (e) { e.preventDefault(); if (dirty()) toast("Salve o rascunho antes de visualizar.", "err"); else preview("en/" + P.file); } }, "Ver em inglês") : null) : null),
        h("div", { class: "actions" },
          P.url ? h("a", { class: "btn btn--quiet btn--sm", href: "/" + P.url, target: "_blank", rel: "noopener" }, icon("ext"), "Abrir no site") : null,
          h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: function () { if (dirty()) toast("Salve o rascunho antes de visualizar.", "err"); else preview(P.key); } }, icon("eye"), "Visualizar rascunho"))),
      h("div", { class: "ed-head-bottom" }, h("div", { class: "actions" }, docBtns),
        h("div", { class: "actions" },
          pl.prev ? h("a", { class: "btn btn--quiet btn--sm", href: "#/page/" + pl.prev.key, title: pl.prev.title }, icon("left"), "Anterior") : null,
          pl.next ? h("a", { class: "btn btn--ghost btn--sm", href: "#/page/" + pl.next.key, title: pl.next.title }, "Próxima: " + pl.next.title, icon("chev")) : null)));
    var pager = h("div", { class: "pager" },
      pl.prev ? h("a", { href: "#/page/" + pl.prev.key }, h("small", { text: "← Página anterior" }), h("b", { text: pl.prev.title })) : null,
      pl.next ? h("a", { class: "next", href: "#/page/" + pl.next.key }, h("small", { text: "Próxima página →" }), h("b", { text: pl.next.title })) : null);

    fill(view,
      headCard,
      P.generated ? h("div", { class: "alert alert--info", text: dm ? "Página gerada a partir dos dados do ano (percentual, período, contratos, notas e imagens): para mudar esses dados use “Editar dados” acima. Aqui ficam só os ajustes de texto." : "Página gerada automaticamente. As edições aqui ficam por cima dos dados." }) : null,
      P.orphans.length ? h("div", { class: "alert alert--warn", text: P.orphans.length + " edição(ões) antiga(s) não foram aplicadas porque o código desta página mudou desde então. Revise os campos e salve de novo." }) : null,
      h("div", { class: "ed-layout" }, outline,
        h("div", {}, h("div", { class: "toolbar" }, q), seo, secs, pager, savebar)));
  }

  /* ---------- documentos anuais: RN 565 (reajuste) e IDSS ---------- */
  var DOC_INFO = {
    rn565: { title: "Reajuste de contratos (RN 565)", unit: "agrupamento", page: function (a) { return "pt/rn565-agrupamento-" + a + ".html"; }, main: "pt/rn565.html" },
    idss: { title: "IDSS", unit: "resultado", page: function (a) { return "pt/idss-" + a + ".html"; }, main: "pt/idss.html" },
  };
  VIEWS.docs = function (view, parts) {
    var type = parts[0], D = DOC_INFO[type];
    if (!D) { location.hash = "#/"; return; }
    api("GET", "/api/admin/docs?type=" + type).then(function (r) {
      if (parts[1]) {
        var cur = parts[1] === "novo" ? null : r.items.find(function (x) { return String(x.ano) === parts[1]; });
        if (parts[1] !== "novo" && !cur) { location.hash = "#/docs/" + type; return; }
        return docForm(view, type, r, cur);
      }
      setCrumbs([[D.title, "#/page/" + D.main], ["Anos cadastrados"]]);
      fill(view, head(D.title, "Cada ano gera a sua página (em português e em inglês) e entra no histórico. Cadastre o novo ano quando o documento for renovado.", h("a", { class: "btn", href: "#/docs/" + type + "/novo" }, "+ Cadastrar novo ano")),
        h("div", { class: "card" }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, ["Ano", type === "rn565" ? "Percentual" : "Nota IDSS", type === "rn565" ? "Período de aplicação" : "Ano-base", type === "rn565" ? "Relação" : "Imagens", ""].map(function (t) { return h("th", { text: t }); }))),
          h("tbody", {}, r.items.map(function (x) {
            return h("tr", {}, h("td", {}, h("b", { text: x.ano })),
              h("td", { text: type === "rn565" ? x.percentual || "não informado" : x.resultado.nota }),
              h("td", { text: type === "rn565" ? x.inicio + " a " + x.fim : String(x.anoBase) }),
              h("td", { text: type === "rn565" ? (x.contratos.length ? x.contratos.length + " contratos" : "PDF") : x.imagens.length + " imagem(ns)" }),
              h("td", {}, h("div", { class: "actions" },
                h("a", { class: "btn btn--ghost btn--sm", href: "#/docs/" + type + "/" + x.ano }, icon("edit"), "Editar dados"),
                type === "idss" || x.contratos.length ? h("a", { class: "btn btn--quiet btn--sm", href: "#/page/" + D.page(x.ano) }, "Textos da página") : null)));
          }))))));
    }).catch(fail);
  };
  function docForm(view, type, r, cur) {
    var D = DOC_INFO[type], isNew = !cur, latest = r.items[0];
    setCrumbs([[D.title, "#/docs/" + type], [isNew ? "Novo ano" : "Ano " + cur.ano]]);
    var changed = false; dirty = function () { return changed; };
    var F = {}, touch = function () { changed = true; };
    var mk = function (k, label, value, o) { o = o || {}; var el = inp({ type: "text", value: value == null ? "" : value, placeholder: o.ph || null, inputmode: o.num ? "decimal" : null }); el.addEventListener("input", touch); F[k] = field(label, el, { hint: o.hint }); F[k].input = el; return F[k]; };
    var nextYear = latest ? latest.ano + 1 : new Date().getFullYear();
    var ano = mk("ano", "Ano", cur ? cur.ano : nextYear, { num: true });
    var body, collect;
    if (type === "rn565") {
      var ini = mk("inicio", "Início da aplicação", cur ? cur.inicio : "01/05/" + nextYear, { ph: "DD/MM/AAAA" });
      var fim = mk("fim", "Fim da aplicação", cur ? cur.fim : "30/04/" + (nextYear + 1), { ph: "DD/MM/AAAA" });
      var pct = mk("percentual", "Percentual de reajuste", cur ? cur.percentual : "", { ph: "8,70%", hint: "Em branco: aparece “não informado”." });
      ano.input.addEventListener("input", function () { var y = +ano.input.value; if (isNew && y > 1999) { ini.input.value = "01/05/" + y; fim.input.value = "30/04/" + (y + 1); } });
      var rows = cur ? cur.contratos.slice() : [];
      var pdfFile = cur ? cur.pdfFile : "";
      var area = inp({ tag: "textarea", rows: 8, spellcheck: "false", placeholder: "Contrato;Plano;Registro ANS\n16;PLANO COL EMP AMB COM COPARTIC;470013139" });
      area.value = rows.map(function (c) { return [c.contrato, c.plano, c.registro].join(";"); }).join("\n");
      var count = h("span", { class: "small muted" });
      var parse = function () {
        rows = area.value.split(/\r?\n/).map(function (l) { return l.split(/\t|;|,(?=\s*\S)/).map(function (x) { return x.trim().replace(/^"|"$/g, ""); }); })
          .filter(function (c) { return c[0] && /\d/.test(c[0]) && c[1]; }).map(function (c) { return { contrato: c[0], plano: c[1], registro: c[2] || "" }; });
        count.textContent = rows.length + (rows.length === 1 ? " contrato reconhecido" : " contratos reconhecidos");
      };
      area.addEventListener("input", function () { touch(); parse(); });
      parse();
      var csvIn = h("input", { type: "file", accept: ".csv,.txt", class: "sr-only", id: "f" + (++uid) });
      csvIn.addEventListener("change", function () { var f = csvIn.files[0]; if (!f) return; f.text().then(function (t) { area.value = t; touch(); parse(); toast("Planilha importada: confira a contagem abaixo.", "ok"); }); });
      var pdfBox = h("div", {});
      var pdfIn = h("input", { type: "file", accept: ".pdf,application/pdf", class: "sr-only", id: "f" + (++uid) });
      var drawPdf = function () {
        fill(pdfBox, pdfFile ? h("p", { class: "small" }, icon("check"), " PDF enviado: ", h("a", { href: "/admin/media/" + pdfFile.slice(15), target: "_blank", rel: "noopener", text: "abrir" }), " · ", h("button", { class: "link-btn", type: "button", text: "Remover PDF", onclick: function () { pdfFile = ""; touch(); drawPdf(); } })) : null,
          h("label", { class: "btn btn--ghost btn--sm", for: pdfIn.id }, pdfFile ? "Trocar PDF" : "Enviar PDF do agrupamento"));
      };
      pdfIn.addEventListener("change", function () {
        var f = pdfIn.files[0]; if (!f) return;
        uploadFile(f, "pdf").then(function (j) { pdfFile = j.path; touch(); drawPdf(); toast("PDF enviado.", "ok"); }).catch(fail);
      });
      drawPdf();
      F.contratos = field("Relação de contratos", area, { hint: "Uma linha por contrato: contrato; plano; registro ANS (separados por ponto e vírgula ou tabulação — dá para colar direto do Excel)." });
      F.pdfFile = h("div", {});
      body = [h("div", { class: "card" }, h("h2", { text: "Dados do reajuste" }), h("div", { class: "grid2" }, ano, pct, ini, fim)),
        h("div", { class: "card" }, h("h2", { text: "Contratos do agrupamento" }), h("p", { class: "desc", text: "Cole a relação de contratos ou importe uma planilha salva em CSV. Se o agrupamento só existir em PDF, envie o arquivo abaixo." }),
          h("div", { class: "actions" }, h("label", { class: "btn btn--ghost btn--sm", for: csvIn.id }, "Importar planilha (CSV)"), latest && latest.contratos.length && isNew ? h("button", { class: "btn btn--quiet btn--sm", type: "button", text: "Copiar a relação de " + latest.ano, onclick: function () { area.value = latest.contratos.map(function (c) { return [c.contrato, c.plano, c.registro].join(";"); }).join("\n"); touch(); parse(); } }) : null, count), csvIn,
          h("div", { class: "mt" }), F.contratos, h("h3", { class: "mt", text: "Ou: PDF do agrupamento" }), pdfIn, pdfBox, F.pdfFile)];
      collect = function () { return { ano: +ano.input.value, percentual: pct.input.value, inicio: ini.input.value, fim: fim.input.value, contratos: rows, pdfFile: pdfFile || "" }; };
    } else {
      var res = cur ? cur.resultado : { nota: "", dim: ["", "", "", ""], acred: "Operadora não bonificada", bonus: "0,0000 · Operadora não bonificada" };
      var base = mk("anoBase", "Ano-base", cur ? cur.anoBase : nextYear - 1, { num: true });
      ano.input.addEventListener("input", function () { if (isNew && +ano.input.value > 1999) base.input.value = +ano.input.value - 1; });
      var nota = mk("nota", "Nota IDSS", res.nota, { ph: "0,4859", num: true });
      var DIMS = [["IDQS", "Qualidade em Atenção à Saúde"], ["IDGA", "Garantia de Acesso"], ["IDSM", "Sustentabilidade no Mercado"], ["IDGR", "Gestão de Processos e Regulação"]];
      var dims = DIMS.map(function (d, i) { return mk("dim" + i, d[0] + " · " + d[1], res.dim[i], { ph: "0,0000", num: true }); });
      var acred = mk("acred", "Pontuação para operadora acreditada", res.acred), bonus = mk("bonus", "Indicador bônus", res.bonus);
      var imgs = cur ? cur.imagens.map(function (p, i) { return { path: p, url: cur.preview[i] }; }) : [];
      var grid = h("div", { class: "doc-imgs" });
      var imgIn = h("input", { type: "file", accept: ".jpg,.jpeg,.png,.webp", multiple: true, class: "sr-only", id: "f" + (++uid) });
      var drawImgs = function () {
        fill(grid, imgs.map(function (im, i) {
          return h("div", { class: "doc-img" }, h("div", { class: "thumb" }, h("img", { src: im.url, alt: "" })), h("div", { class: "actions" },
            h("span", { class: "xs muted", text: "Imagem " + (i + 1) }),
            i ? h("button", { class: "link-btn", type: "button", text: "↑", title: "Mover para cima", onclick: function () { imgs.splice(i - 1, 0, imgs.splice(i, 1)[0]); touch(); drawImgs(); } }) : null,
            i < imgs.length - 1 ? h("button", { class: "link-btn", type: "button", text: "↓", title: "Mover para baixo", onclick: function () { imgs.splice(i + 1, 0, imgs.splice(i, 1)[0]); touch(); drawImgs(); } }) : null,
            h("button", { class: "link-btn", type: "button", text: "Remover", onclick: function () { imgs.splice(i, 1); touch(); drawImgs(); } })));
        }), h("label", { class: "drop doc-add", for: imgIn.id }, h("strong", { text: "+ Enviar imagens" }), h("div", { class: "xs", text: "JPG, PNG ou WebP · até 5 MB cada" })));
      };
      imgIn.addEventListener("change", function () {
        var files = Array.prototype.slice.call(imgIn.files), errs = [];
        files.reduce(function (p, f) { return p.then(function () { return uploadFile(f, "doc").then(function (j) { imgs.push({ path: j.path, url: j.url }); }).catch(function (e) { errs.push(f.name + ": " + e.message); }); }); }, Promise.resolve())
          .then(function () { touch(); drawImgs(); if (errs.length) toast(errs.join(" · "), "err"); else toast("Imagens enviadas.", "ok"); imgIn.value = ""; });
      });
      drawImgs();
      F.imagens = h("div", { class: "field" }, h("span", { class: "err", role: "alert" }));
      F.imagens.setError = function (m) { F.imagens.firstChild.textContent = m || ""; };
      F.dim = h("div", { class: "field" }, h("span", { class: "err", role: "alert" }));
      F.dim.setError = function (m) { F.dim.firstChild.textContent = m || ""; };
      body = [h("div", { class: "card" }, h("h2", { text: "Resultado divulgado pela ANS" }), h("div", { class: "grid3" }, ano, base, nota), h("div", { class: "grid2" }, dims), F.dim, h("div", { class: "grid2" }, acred, bonus)),
        h("div", { class: "card" }, h("h2", { text: "Imagens do resultado" }), h("p", { class: "desc", text: "Capturas do painel da ANS com o resultado do ano, na ordem em que devem aparecer na página." }), imgIn, grid, F.imagens)];
      collect = function () { return { ano: +ano.input.value, anoBase: +base.input.value, resultado: { nota: nota.input.value.trim(), dim: dims.map(function (d) { return d.input.value.trim(); }), acred: acred.input.value, bonus: bonus.input.value }, imagens: imgs.map(function (i) { return i.path; }) }; };
    }
    var alert = h("div", { class: "alert alert--err hidden", role: "alert" });
    var saveBtn = h("button", { class: "btn", type: "button", text: isNew ? "Cadastrar ano" : "Salvar alterações", onclick: function () {
      Object.keys(F).forEach(function (k) { if (F[k].setError) F[k].setError(""); }); alert.classList.add("hidden");
      var b = Object.assign(collect(), cur ? { original: cur.ano } : {});
      saveBtn.disabled = true;
      api("PUT", "/api/admin/docs?type=" + type, b).then(function (j) {
        changed = false; toast((isNew ? "Ano " + b.ano + " cadastrado" : "Dados de " + b.ano + " salvos") + " no rascunho. Publique para colocar no ar.", "ok");
        refreshStatus(); navPages = null; refreshPagesNav();
        location.hash = type === "rn565" && !b.contratos.length ? "#/page/" + D.main : "#/page/" + j.key;
      }).catch(function (e) {
        var f = e.fields || {};
        Object.keys(f).forEach(function (k) { var t = F[k] || (k === "nota" ? F.nota : null); if (t && t.setError) t.setError(f[k]); });
        alert.textContent = e.message; alert.classList.remove("hidden"); alert.scrollIntoView({ block: "center" });
      }).then(function () { saveBtn.disabled = false; });
    } });
    var del = !isNew ? h("button", { class: "btn btn--quiet", type: "button", onclick: function () {
      confirmDialog("Remover o ano " + cur.ano + "?", "A página deste ano sai do site (português e inglês) na próxima publicação.", "Remover", true).then(function (ok) {
        if (ok) api("PUT", "/api/admin/docs?type=" + type, { original: cur.ano, remove: true }).then(function () { changed = false; toast("Ano removido do rascunho.", "ok"); refreshStatus(); navPages = null; refreshPagesNav(); location.hash = "#/docs/" + type; }).catch(fail);
      });
    } }, icon("trash"), "Remover este ano") : null;
    fill(view, h("div", { class: "toolbar" }, h("a", { class: "btn btn--quiet btn--sm", href: "#/docs/" + type, text: "← Anos cadastrados" })),
      head(isNew ? "Cadastrar novo ano · " + D.title : D.title + " · " + cur.ano, "A página do ano é gerada automaticamente em português e em inglês, no mesmo modelo dos anos anteriores, e entra no histórico."),
      alert, body,
      h("div", { class: "savebar" }, h("span", { class: "grow", text: "As alterações entram no site após Publicar." }), del, h("a", { class: "btn btn--ghost", href: "#/docs/" + type, text: "Cancelar" }), saveBtn));
  }

  /* ---------- seletor de imagem (envio com validação + biblioteca) ---------- */
  function uploadFile(file, purpose) {
    return api("POST", "/api/admin/upload?purpose=" + purpose + "&name=" + encodeURIComponent(file.name), file);
  }
  function pickImage(o) {
    return new Promise(function (resolve) {
      var m, chosen = null;
      var err = h("div", { class: "alert alert--err hidden", role: "alert" });
      var grid = h("div", { class: "media-grid" });
      var fileIn = h("input", { type: "file", accept: o.purpose === "favicon" ? ".png,.svg" : o.purpose === "logo" ? ".png,.webp,.svg" : ".jpg,.jpeg,.png,.webp", class: "sr-only", id: "f" + (++uid) });
      var rules = { photo: "JPG, PNG ou WebP · até 5 MB · mínimo 400×300 px, máximo 6000×6000 px", logo: "PNG, WebP ou SVG · até 1 MB · mínimo 120×40 px", favicon: "PNG ou SVG quadrado · até 512 KB · de 32 a 1024 px" }[o.purpose];
      var drop = h("label", { class: "drop", for: fileIn.id }, h("strong", { text: "Enviar nova imagem" }), h("div", { class: "small", text: "Clique ou arraste o arquivo aqui · " + rules }));
      function send(file) {
        err.classList.add("hidden");
        drop.classList.add("is-over");
        uploadFile(file, o.purpose).then(function (j) { toast("Imagem enviada (" + j.w + "×" + j.h + " px).", "ok"); m.close(); resolve(j); })
          .catch(function (e) { err.textContent = e.message; err.classList.remove("hidden"); }).then(function () { drop.classList.remove("is-over"); });
      }
      fileIn.addEventListener("change", function () { if (fileIn.files[0]) send(fileIn.files[0]); });
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("is-over"); });
      drop.addEventListener("drop", function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); });
      function item(sel, label) {
        return h("button", { class: "media-item", type: "button", onclick: function () { chosen = sel; m.close(); } }, h("div", { class: "thumb" + (o.purpose !== "photo" ? " thumb--contain" : "") }, h("img", { src: sel.url, alt: "", loading: "lazy" })), h("small", { text: label }));
      }
      m = modal([h("h2", { text: "Escolher imagem" }), err, fileIn, drop, h("h3", { class: "mt", text: o.sitePhotos ? "Imagens disponíveis" : "Já enviadas" }), grid], { wide: true, onClose: function () { resolve(chosen); } });
      api("GET", "/api/admin/media").then(function (r) {
        r.files.filter(function (f) { return f.purpose === o.purpose; }).forEach(function (f) { grid.appendChild(item(f, (f.original || f.name) + " · " + f.w + "×" + f.h)); });
        if (o.sitePhotos) return api("GET", "/api/admin/site").then(function (s) { s.photos.forEach(function (p) { grid.appendChild(item({ ref: p.key, url: p.url, path: null }, "Foto do site: " + p.key)); }); });
      }).then(function () { if (!grid.children.length) grid.appendChild(h("p", { class: "muted small", text: "Nenhuma imagem enviada ainda." })); }).catch(fail);
    });
  }

  /* ---------- notícias ---------- */
  VIEWS.news = function (view, parts) {
    api("GET", "/api/admin/noticias").then(function (r) {
      var list = r.noticias;
      if (parts[0] !== undefined) return newsEditor(view, list, parts[0] === "nova" ? -1 : +parts[0]);
      var rows = list.slice().map(function (n, i) { return [n, i]; }).sort(function (a, b) { return b[0].data.localeCompare(a[0].data); });
      fill(view, head("Notícias", "Notícias e comunicados exibidos em Conteúdos e na página inicial. Cada notícia gera a própria página.", h("a", { class: "btn", href: "#/news/nova", text: "+ Nova notícia" })),
        h("div", { class: "card" }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
          h("thead", {}, h("tr", {}, h("th", { text: "Título" }), h("th", { text: "Categoria" }), h("th", { text: "Data" }), h("th", {}))),
          h("tbody", {}, rows.map(function (x) {
            var n = x[0], i = x[1];
            return h("tr", {}, h("td", {}, h("a", { href: "#/news/" + i, text: n.titulo })), h("td", { text: n.cat === "comunicados" ? "Comunicado" : "Notícia" }), h("td", { text: n.data.split("-").reverse().join("/") }),
              h("td", {}, h("button", { class: "link-btn", type: "button", text: "Excluir", onclick: function () {
                confirmDialog("Excluir esta notícia?", "“" + n.titulo + "” sai do site na próxima publicação.", "Excluir", true).then(function (ok) {
                  if (!ok) return;
                  var nl = list.slice(); nl.splice(i, 1);
                  api("PUT", "/api/admin/noticias", { noticias: nl }).then(function () { toast("Notícia removida do rascunho.", "ok"); refreshStatus(); route(); }).catch(fail);
                });
              } })));
          }))))));
    }).catch(fail);
  };
  function newsEditor(view, list, idx) {
    setCrumbs([[TITLES.news, "#/news"], [idx >= 0 ? list[idx].titulo : "Nova notícia"]]);
    var n = idx >= 0 ? JSON.parse(JSON.stringify(list[idx])) : { slug: "", cat: "noticias", orgao: "ANS", data: new Date().toISOString().slice(0, 10), tema: "", migalha: "", leitura: 3, titulo: "", resumo: "", intro: "", secoes: [{ h: "", p: [""] }], fonteTitulo: "", fonteUrl: "" };
    var changed = false;
    dirty = function () { return changed; };
    var F = {};
    function txt(obj, k, label, limit, o) {
      o = o || {};
      var el = inp({ tag: o.area ? "textarea" : "input", type: o.type || (o.area ? null : "text"), value: obj[k] == null ? "" : obj[k], rows: o.rows || null });
      el.addEventListener("input", function () { obj[k] = o.type === "number" ? +el.value : el.value; changed = true; if (k === "titulo" && obj === n && idx < 0 && !slugTouched) { n.slug = slugify(el.value); F.slug.querySelector("input").value = n.slug; } });
      var f = field(label, el, { limit: limit, hint: o.hint });
      if (obj === n) F[k] = f;
      return f;
    }
    var slugTouched = false;
    function slugify(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80); }
    var cat = inp({ tag: "select" }); [["noticias", "Notícia"], ["comunicados", "Comunicado"]].forEach(function (c) { cat.appendChild(h("option", { value: c[0], text: c[1] })); }); cat.value = n.cat;
    cat.addEventListener("change", function () { n.cat = cat.value; changed = true; });
    var th = h("div", { class: "thumb" }, n._preview ? h("img", { src: n._preview, alt: "" }) : "Sem foto (usa a arte padrão)");
    function secoesBox(obj, title) {
      var box = h("div", {});
      function draw() {
        box.replaceChildren();
        obj.secoes.forEach(function (s, i) {
          var pTxt = inp({ tag: "textarea", rows: 5, value: s.p.join("\n\n") });
          pTxt.addEventListener("input", function () { s.p = pTxt.value.split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean); changed = true; });
          box.appendChild(h("div", { class: "news-sec" }, txt(s, "h", "Título da seção " + (i + 1), 140), field("Parágrafos (separe com uma linha em branco)", pTxt),
            h("p", {}, h("button", { class: "link-btn", type: "button", text: "Remover seção", onclick: function () { obj.secoes.splice(i, 1); changed = true; draw(); } }))));
        });
        box.appendChild(h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "+ Adicionar seção", onclick: function () { obj.secoes.push({ h: "", p: [] }); changed = true; draw(); } }));
      }
      draw();
      return h("div", { class: "card" }, h("h2", { text: title }), box);
    }
    var alert = h("div", { class: "alert alert--err hidden", role: "alert" });
    var saveBtn = h("button", { class: "btn", type: "button", text: "Salvar rascunho", onclick: function () {
      var nl = list.slice(); if (idx >= 0) nl[idx] = n; else nl.push(n);
      saveBtn.disabled = true; saveBtn.textContent = "Salvando e traduzindo…"; alert.classList.add("hidden");
      api("PUT", "/api/admin/noticias", { noticias: nl }).then(function () { changed = false; toast("Notícia salva no rascunho, com a versão em inglês.", "ok"); refreshStatus(); location.hash = "#/news"; })
        .catch(function (e) { alert.replaceChildren(h("strong", { text: "Não foi possível salvar:" }), h("ul", {}, (e.list || [e.message]).map(function (x) { return h("li", { text: x }); }))); alert.classList.remove("hidden"); alert.scrollIntoView({ block: "center" }); })
        .then(function () { saveBtn.disabled = false; saveBtn.textContent = "Salvar rascunho"; });
    } });
    var slugF = txt(n, "slug", "Endereço da página", 80, { hint: "Fica noticia-ENDERECO.html. Só letras minúsculas, números e hífens." });
    slugF.querySelector("input").addEventListener("input", function () { slugTouched = true; });
    fill(view, h("div", { class: "toolbar" }, h("a", { class: "btn btn--quiet btn--sm", href: "#/news", text: "← Notícias" })),
      head(idx >= 0 ? "Editar notícia" : "Nova notícia", "Resumo próprio de publicação oficial, com crédito e link para a fonte."), alert,
      h("div", { class: "card" }, h("h2", { text: "Principal" }), txt(n, "titulo", "Título", 140), slugF,
        h("div", { class: "grid3" }, field("Categoria", cat), txt(n, "data", "Data", null, { type: "date" }), txt(n, "leitura", "Leitura (min)", null, { type: "number" })),
        h("div", { class: "grid3" }, txt(n, "orgao", "Órgão / fonte", 60), txt(n, "tema", "Tema", 60), txt(n, "migalha", "Nome curto (migalha)", 60)),
        txt(n, "resumo", "Resumo (cards e Google)", 300, { area: true }), txt(n, "intro", "Parágrafo de abertura", 1200, { area: true, rows: 4 })),
      h("div", { class: "card" }, h("h2", { text: "Imagem" }), h("div", { class: "imgrow" }, h("div", {}, th,
        h("button", { class: "btn btn--ghost btn--sm btn--block", type: "button", text: "Trocar imagem", onclick: function () { pickImage({ purpose: "photo", sitePhotos: true }).then(function (s) { if (!s) return; n.foto = s.ref; changed = true; th.replaceChildren(h("img", { src: s.url, alt: "" })); }); } }),
        h("button", { class: "link-btn", type: "button", text: "Sem foto", onclick: function () { delete n.foto; n.alt = ""; changed = true; th.replaceChildren("Sem foto (usa a arte padrão)"); } })),
        txt(n, "alt", "Texto alternativo da imagem", 160))),
      secoesBox(n, "Conteúdo"),
      h("div", { class: "card" }, h("h2", { text: "Fonte oficial" }), txt(n, "fonteTitulo", "Título da publicação original", 220), txt(n, "fonteUrl", "Link da publicação original", 500, { type: "url", hint: "Precisa começar com https://" })),
      h("div", { class: "alert alert--info", text: "A versão em inglês desta notícia é traduzida automaticamente ao salvar. Só o que mudar em português é traduzido de novo." }),
      h("div", { class: "savebar" }, h("span", { class: "grow", text: "As alterações entram no site após Publicar." }), h("a", { class: "btn btn--ghost", href: "#/news", text: "Cancelar" }), saveBtn));
  }

  /* ---------- identidade visual ---------- */
  VIEWS.identity = function (view) {
    api("GET", "/api/admin/identity").then(function (r) {
      var cur = {}; Object.keys(r.identity || {}).forEach(function (k) { cur[k] = r.identity[k].name; });
      var changed = false; dirty = function () { return changed; };
      var items = [["logo", "Logotipo (fundo claro)", "logo", "Cabeçalho e rodapé. PNG/WebP com fundo transparente ou SVG."], ["logoNeg", "Logotipo (fundo escuro)", "logo", "Versão branca, usada sobre fotos e fundos escuros."], ["favicon", "Favicon", "favicon", "Ícone da aba do navegador (SVG ou PNG quadrado)."], ["faviconPng", "Ícone para celulares", "favicon", "PNG quadrado, recomendado 180×180 px ou maior."]];
      var cards = items.map(function (it) {
        var k = it[0], th = h("div", { class: "thumb thumb--contain" }, h("img", { src: r.identity[k] ? "/admin/media/" + r.identity[k].name : r.defaults[k], alt: "" }));
        return h("div", { class: "card" }, h("h2", { text: it[1] }), h("p", { class: "desc", text: it[3] }), h("div", { class: "imgrow" }, th, h("div", { class: "actions" },
          h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Enviar nova versão", onclick: function () { pickImage({ purpose: it[2] }).then(function (s) { if (!s) return; cur[k] = s.name; changed = true; th.replaceChildren(h("img", { src: s.url, alt: "" })); }); } }),
          r.identity[k] ? h("button", { class: "btn btn--quiet btn--sm", type: "button", text: "Voltar ao original", onclick: function () { delete cur[k]; changed = true; th.replaceChildren(h("img", { src: r.defaults[k], alt: "" })); } }) : null)));
      });
      var btn = h("button", { class: "btn", type: "button", text: "Salvar rascunho", onclick: function () {
        api("PUT", "/api/admin/identity", cur).then(function () { changed = false; toast("Identidade visual salva no rascunho.", "ok"); refreshStatus(); route(); }).catch(function (e) { fail(e); });
      } });
      fill(view, head("Identidade visual", "Logotipo e favicon do site. As imagens são validadas (formato, tamanho e dimensões) no envio."), cards, h("div", { class: "savebar" }, h("span", { class: "grow" }), btn));
    }).catch(fail);
  };

  /* ---------- formulários ---------- */
  VIEWS.forms = function (view) {
    api("GET", "/api/admin/forms").then(function (r) { formsView(view, r); }).catch(fail);
  };
  function formsView(view, r) {
    var cards = r.forms.map(function (f) {
      var en = h("input", { type: "checkbox" }); en.checked = f.enabled;
      var emails = inp({ type: "text", value: f.emails.join(", "), placeholder: "atendimento@medicglobal.com.br, outro@…" });
      var hook = inp({ type: "url", value: "", placeholder: f.webhook ? "Configurado (" + f.webhook + ") — preencha para trocar" : "https://… (opcional: CRM, planilha, automação)" });
      var mb = inp({ type: "number", min: 1, max: 50, value: f.maxUploadMB });
      var fe = field("Enviar aviso por e-mail para", emails, { hint: "Separe vários e-mails por vírgula. Requer o servidor de e-mail (SMTP) configurado abaixo." });
      var fh = field("Webhook (envio automático dos dados)", hook, { hint: "Recebe um POST em JSON a cada envio. O endereço fica cifrado no servidor." });
      var fm = field("Tamanho máximo do anexo (MB)", mb, { hint: "Vale para o site e para o servidor. Atualize também o texto do rótulo do campo na página." });
      var hasFile = f.fields.some(function (x) { return x.type === "file"; });
      var save = h("button", { class: "btn btn--sm", type: "button", text: "Salvar destinos", onclick: function () {
        [fe, fh, fm].forEach(function (x) { x.setError(""); });
        var body = { enabled: en.checked, emails: emails.value };
        if (hook.value) body.webhook = hook.value;
        if (hasFile) body.maxUploadMB = +mb.value;
        api("PUT", "/api/admin/forms?name=" + f.name, body).then(function (nr) { toast("Configurações de “" + f.title + "” salvas." + (hasFile ? " O limite do anexo entra no site após Publicar." : ""), "ok"); formsView(view, nr); refreshStatus(); })
          .catch(function (e) { fail(e); var x = e.fields || {}; if (x.emails) fe.setError(x.emails); if (x.webhook) fh.setError(x.webhook); if (x.maxUploadMB) fm.setError(x.maxUploadMB); });
      } });
      var units = f.fieldUnits;
      var fieldRows = f.fields.map(function (x) {
        var u = units.find(function (y) { return y.name === x.name; });
        return h("tr", {}, h("td", { text: x.label }), h("td", { text: x.name }), h("td", { text: { email: "E-mail", tel: "Telefone", textarea: "Texto longo", select: "Lista", radio: "Opções", file: "Arquivo", text: "Texto" }[x.type] || x.type }), h("td", { text: x.required ? "Sim" : "Não" }), h("td", { text: x.options.length ? x.options.join(" · ") : x.maxlength ? "máx. " + x.maxlength : "" }));
      });
      return h("div", { class: "card" },
        h("div", { class: "page-head" }, h("div", {}, h("h2", { text: f.title }), h("p", { text: "Página: " + f.pageTitle + " · " + f.count + " mensagem(ns) recebida(s)" })),
          h("div", { class: "actions" }, h("a", { class: "btn btn--ghost btn--sm", href: "#/inbox/" + f.name, text: "Ver mensagens" }), h("a", { class: "btn btn--ghost btn--sm", href: "#/page/" + f.page, text: "Editar textos e campos" }))),
        h("label", { class: "check" }, en, "Formulário ativo"), h("div", { class: "xs muted", text: "Desativado, o servidor recusa os envios e o visitante vê a mensagem de envio indisponível." }), h("div", { class: "mt" }),
        fe, fh, f.webhook ? h("p", { class: "small" }, h("button", { class: "link-btn", type: "button", text: "Testar webhook", onclick: function () { api("POST", "/api/admin/webhook/test?name=" + f.name).then(function () { toast("Webhook respondeu com sucesso.", "ok"); }).catch(fail); } }), " · ",
          h("button", { class: "link-btn", type: "button", text: "Remover webhook", onclick: function () { api("PUT", "/api/admin/forms?name=" + f.name, { enabled: en.checked, emails: emails.value, clearWebhook: true }).then(function (nr) { toast("Webhook removido.", "ok"); formsView(view, nr); }).catch(fail); } })) : null,
        hasFile ? fm : null,
        h("details", { class: "mt" }, h("summary", { class: "small", text: "Campos do formulário (" + f.fields.length + ")" + (f.consent ? " + autorização LGPD obrigatória" : "") }),
          h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", {}, h("tr", {}, ["Rótulo", "Nome", "Tipo", "Obrigatório", "Regras"].map(function (t) { return h("th", { text: t }); }))), h("tbody", {}, fieldRows))),
          h("p", { class: "small muted", text: "Rótulos, textos de exemplo, obrigatoriedade e tamanho máximo são editados em “Editar textos e campos”. O servidor valida cada envio com as mesmas regras." })),
        h("div", { class: "actions mt" }, save));
    });
    var s = r.smtp;
    var host = inp({ type: "text", value: s.host, placeholder: "smtp.seudominio.com.br" }), port = inp({ type: "number", value: s.port }), user = inp({ type: "text", value: s.user, autocomplete: "off" }), pass = inp({ type: "password", value: "", autocomplete: "new-password", placeholder: s.pass ? "Configurada (" + s.pass + ") — preencha para trocar" : "" }), from = inp({ type: "email", value: s.from }), fromName = inp({ type: "text", value: s.fromName || "Site MedicGLOBAL" });
    var SF = { host: field("Servidor SMTP", host), port: field("Porta", port, { hint: "587 (STARTTLS) ou 465 (SSL)" }), user: field("Usuário", user), pass: field("Senha", pass, { hint: "Fica cifrada no servidor e nunca é exibida." }), from: field("E-mail remetente", from), fromName: field("Nome do remetente", fromName) };
    var smtp = h("div", { class: "card" }, h("h2", { text: "Servidor de e-mail (SMTP)" }), h("p", { class: "desc", text: "Usado para avisar por e-mail os envios dos formulários." }),
      h("div", { class: "grid2" }, SF.host, SF.port, SF.user, SF.pass, SF.from, SF.fromName),
      h("div", { class: "actions" },
        h("button", { class: "btn btn--sm", type: "button", text: "Salvar SMTP", onclick: function () {
          Object.keys(SF).forEach(function (k) { SF[k].setError(""); });
          api("PUT", "/api/admin/smtp", { host: host.value.trim(), port: +port.value, user: user.value.trim(), pass: pass.value, from: from.value.trim(), fromName: fromName.value }).then(function (nr) { toast("Servidor de e-mail salvo.", "ok"); formsView(view, nr); })
            .catch(function (e) { fail(e); Object.keys(e.fields || {}).forEach(function (k) { if (SF[k]) SF[k].setError(e.fields[k]); }); });
        } }),
        h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Enviar e-mail de teste", onclick: function () {
          var to = inp({ type: "email", value: S.user ? S.user.email : "" });
          var m = modal([h("h2", { text: "E-mail de teste" }), field("Enviar para", to), h("div", { class: "actions" }, h("button", { class: "btn", type: "button", text: "Enviar", onclick: function () { api("POST", "/api/admin/smtp/test", { to: to.value }).then(function () { toast("E-mail de teste enviado.", "ok"); m.close(); }).catch(fail); } }))]);
        } })));
    fill(view, head("Formulários", "Destinos de envio, ativação e regras de cada formulário do site. Todas as mensagens ficam guardadas em Mensagens recebidas."), cards, smtp);
  }

  /* ---------- mensagens recebidas ---------- */
  VIEWS.inbox = function (view, parts) {
    api("GET", "/api/admin/forms").then(function (r) {
      var name = parts[0] || (r.forms[0] && r.forms[0].name);
      var sel = inp({ tag: "select", "aria-label": "Formulário" });
      r.forms.forEach(function (f) { sel.appendChild(h("option", { value: f.name, text: f.title + " (" + f.count + ")" })); });
      sel.value = name;
      sel.addEventListener("change", function () { location.hash = "#/inbox/" + sel.value; });
      api("GET", "/api/admin/submissions?form=" + encodeURIComponent(name)).then(function (s) {
        var def = r.forms.find(function (f) { return f.name === name; }) || { fields: [] };
        var label = function (k) { var f = def.fields.find(function (x) { return x.name === k; }); return f ? f.label : k; };
        fill(view, head("Mensagens recebidas", "Envios dos formulários do site (dados pessoais: acesso restrito, siga a LGPD)."),
          h("div", { class: "toolbar" }, sel, s.items.length ? h("a", { class: "btn btn--ghost btn--sm", href: "/api/admin/submissions/csv?form=" + encodeURIComponent(name), text: "Exportar CSV" }) : null),
          s.items.length ? s.items.map(function (it) {
            return h("details", { class: "sec" }, h("summary", {}, (it.data.nome || it.data.email || it.id), h("span", { class: "count", text: fmtDate(it.at) })),
              h("div", { class: "sec-body" }, Object.keys(it.data).map(function (k) { return h("div", { class: "sub" }, h("span", { class: "xs muted", text: label(k) }), h("span", { text: it.data[k] })); }),
                it.files.map(function (f) { return h("div", { class: "sub" }, h("span", { class: "xs muted", text: "Anexo" }), h("a", { href: "/api/admin/submissions/file?f=" + encodeURIComponent(f.stored), text: f.filename + " (" + fmtSize(f.size) + ")" })); }),
                h("p", { class: "xs muted", text: "Protocolo " + it.id + (it.page ? " · enviado em " + it.page : "") + (it.notify.length ? " · " + it.notify.map(function (n) { return n.via + ": " + (n.ok ? "ok" : "falhou (" + n.error + ")"); }).join(", ") : " · sem destino configurado (só no painel)") })));
          }) : h("div", { class: "card" }, h("p", { class: "muted", text: "Nenhuma mensagem recebida neste formulário." })));
      }).catch(fail);
    }).catch(fail);
  };

  /* ---------- Google Analytics ---------- */
  VIEWS.analytics = function (view) {
    api("GET", "/api/admin/analytics").then(function (g) { gaView(view, g); }).catch(fail);
  };
  function gaView(view, g) {
    var en = h("input", { type: "checkbox" }); en.checked = !!g.enabled;
    var mid = inp({ type: "text", value: g.measurementId, placeholder: "G-XXXXXXXXXX", spellcheck: "false" });
    var gtm = inp({ type: "text", value: g.gtmId, placeholder: "GTM-XXXXXXX (opcional)", spellcheck: "false" });
    var pid = inp({ type: "text", value: g.propertyId, placeholder: "Ex.: 412345678", inputmode: "numeric" });
    var sec = inp({ type: "password", value: "", autocomplete: "off", placeholder: g.apiSecret ? "Configurado (" + g.apiSecret + ") — preencha para trocar" : "Opcional" });
    var saFile = h("input", { type: "file", accept: ".json,application/json" });
    var saText = "";
    saFile.addEventListener("change", function () { var f = saFile.files[0]; if (!f) return; if (f.size > 20000) { toast("Arquivo grande demais para uma chave de conta de serviço.", "err"); return; } f.text().then(function (t) { saText = t; }); });
    var F = { measurementId: field("ID de medição do GA4", mid, { hint: "GA4 › Administrador › Fluxos de dados › Web." }), gtmId: field("Contêiner do Google Tag Manager", gtm, { hint: "Use só se a empresa já trabalha com GTM." }), propertyId: field("ID da propriedade (números)", pid, { hint: "GA4 › Administrador › Detalhes da propriedade." }), apiSecret: field("API secret do Measurement Protocol", sec, { hint: "Fluxo de dados › Chaves secretas da API. Permite enviar um evento de teste." }), serviceAccount: field("Chave JSON da conta de serviço", saFile, { hint: g.serviceAccountEmail ? "Configurada: " + g.serviceAccountEmail + ". Envie outro arquivo para trocar." : "Google Cloud › IAM › Contas de serviço › Chaves. A chave fica cifrada no servidor." }) };
    var results = h("div", {});
    function showChecks(list, at) {
      results.replaceChildren(h("h3", { class: "mt", text: "Resultado da verificação" + (at ? " · " + fmtDate(at) : "") }), h("ul", { class: "checks" }, list.map(function (c) {
        return h("li", { class: c.status }, h("span", { class: "ic", text: { ok: "✓", warn: "!", fail: "×", skip: "–" }[c.status] }), h("div", {}, h("b", { text: c.label }), h("span", { text: c.detail })));
      })));
    }
    if (g.lastCheck) showChecks(g.lastCheck.checks, g.lastCheck.at);
    var verify = h("button", { class: "btn btn--ghost", type: "button", text: "Verificar integração", onclick: function () {
      verify.disabled = true; verify.textContent = "Verificando…";
      api("POST", "/api/admin/analytics/verify").then(function (r) { showChecks(r.checks, r.at); }).catch(fail).then(function () { verify.disabled = false; verify.textContent = "Verificar integração"; });
    } });
    var save = h("button", { class: "btn", type: "button", text: "Salvar", onclick: function () {
      Object.keys(F).forEach(function (k) { F[k].setError(""); });
      var body = { enabled: en.checked, measurementId: mid.value, gtmId: gtm.value, propertyId: pid.value };
      if (sec.value) body.apiSecret = sec.value;
      if (saText) body.serviceAccount = saText;
      api("PUT", "/api/admin/analytics", body).then(function (ng) { toast("Configuração salva. Publique o site para ativar a tag nas páginas.", "ok"); refreshStatus(); gaView(view, ng); })
        .catch(function (e) { fail(e); Object.keys(e.fields || {}).forEach(function (k) { if (F[k]) F[k].setError(e.fields[k]); }); });
    } });
    var clear = [];
    if (g.serviceAccountEmail) clear.push(h("button", { class: "link-btn", type: "button", text: "Remover chave da conta de serviço", onclick: function () { api("PUT", "/api/admin/analytics", { enabled: en.checked, measurementId: mid.value, gtmId: gtm.value, propertyId: pid.value, clearServiceAccount: true }).then(function (ng) { toast("Chave removida.", "ok"); gaView(view, ng); }).catch(fail); } }));
    if (g.apiSecret) clear.push(h("button", { class: "link-btn", type: "button", text: "Remover API secret", onclick: function () { api("PUT", "/api/admin/analytics", { enabled: en.checked, measurementId: mid.value, gtmId: gtm.value, propertyId: pid.value, clearApiSecret: true }).then(function (ng) { toast("API secret removido.", "ok"); gaView(view, ng); }).catch(fail); } }));
    fill(view, head("Google Analytics", "Vincule a propriedade GA4 do cliente, valide as permissões e confira se a coleta está funcionando."),
      h("div", { class: "card" }, h("h2", { text: "Coleta no site" }), h("p", { class: "desc", text: "A tag só é carregada depois que o visitante aceita os cookies (LGPD). Os eventos do site (cliques em WhatsApp, telefone, planos, envios de formulário etc.) seguem para o GA4." }),
        h("label", { class: "check" }, en, "Ativar a coleta do Google Analytics no site"), h("div", { class: "mt" }),
        h("div", { class: "grid2" }, F.measurementId, F.gtmId)),
      h("div", { class: "card" }, h("h2", { text: "Validação de permissões e da coleta" }), h("p", { class: "desc", text: "Opcional, mas recomendado: com uma conta de serviço com acesso de Leitor na propriedade, o painel confirma que o ID pertence à propriedade do cliente e lê o relatório em tempo real. Os dados sensíveis ficam só no servidor, cifrados." }),
        h("div", { class: "grid2" }, F.propertyId, F.apiSecret), F.serviceAccount, clear.length ? h("p", { class: "small" }, clear) : null,
        h("details", { class: "small" }, h("summary", { text: "Como dar acesso à conta de serviço" }), h("ol", {},
          h("li", { text: "No Google Cloud, ative a Google Analytics Admin API e a Google Analytics Data API." }),
          h("li", { text: "Crie uma conta de serviço e gere uma chave JSON (envie o arquivo acima)." }),
          h("li", { text: "No GA4: Administrador › Gerenciamento de acesso à propriedade › adicione o e-mail da conta de serviço com o papel Leitor." })))),
      h("div", { class: "actions" }, save, verify), results);
  }

  /* ---------- auditoria: quem alterou o quê, e quando ---------- */
  var ACTIONS = {
    rascunho_pagina: "Editou uma página", noticia_criada: "Criou uma notícia", noticia_alterada: "Editou uma notícia", noticia_removida: "Removeu uma notícia", rascunho_noticias: "Editou as notícias",
    publicado: "Publicou o site", rascunho_descartado: "Descartou o rascunho", versao_restaurada_no_rascunho: "Restaurou uma versão anterior no rascunho",
    rascunho_identidade: "Alterou a identidade visual", analytics_config: "Alterou o Google Analytics", analytics_verificacao: "Verificou o Google Analytics",
    formulario_config: "Alterou um formulário", smtp_config: "Alterou o servidor de e-mail", upload: "Enviou uma imagem", anexo_baixado: "Baixou um anexo", csv_exportado: "Exportou mensagens (CSV)",
    pagina_revisada: "Marcou página como revisada", pagina_nao_revisada: "Desmarcou página revisada", rascunho_dados_gerais: "Alterou dados gerais",
    usuario_criado: "Cadastrou um usuário", usuario_alterado: "Alterou um usuário", usuario_removido: "Removeu um usuário", senha_redefinida: "Redefiniu a senha de um usuário", senha_alterada: "Trocou a própria senha",
    setup: "Configuração inicial", admin_definido: "Definiu o administrador", login: "Entrou no painel", logout: "Saiu do painel", login_falhou: "Tentativa de acesso com senha incorreta",
  };
  var auditQ = { q: "", user: "", from: "", to: "", access: false, page: 0 };
  VIEWS.audit = function (view) {
    var qs = "?q=" + encodeURIComponent(auditQ.q) + "&user=" + encodeURIComponent(auditQ.user) + "&from=" + auditQ.from + "&to=" + auditQ.to + "&page=" + auditQ.page + (auditQ.access ? "&access=1" : "");
    Promise.all([api("GET", "/api/admin/audit" + qs), can("publish") ? api("GET", "/api/admin/status") : Promise.resolve(null)]).then(function (rs) {
      var r = rs[0], st = rs[1];
      var detail = function (e) { return r.pageNames[e.detail] || (e.action === "publicado" ? "" : e.detail); };
      var q = inp({ type: "search", class: "input", value: auditQ.q, placeholder: "Buscar (página, texto, usuário…)", "aria-label": "Buscar na auditoria" });
      var us = inp({ tag: "select", class: "input", "aria-label": "Usuário" });
      us.appendChild(h("option", { value: "", text: "Todos os usuários" }));
      r.users.forEach(function (u) { us.appendChild(h("option", { value: u.email, text: u.name + " · " + u.email })); });
      us.value = auditQ.user;
      var from = inp({ type: "date", class: "input", value: auditQ.from, "aria-label": "De" }), to = inp({ type: "date", class: "input", value: auditQ.to, "aria-label": "Até" });
      var acc = h("input", { type: "checkbox" }); acc.checked = auditQ.access;
      var apply = function () { auditQ = { q: q.value.trim(), user: us.value, from: from.value, to: to.value, access: acc.checked, page: 0 }; VIEWS.audit(view); };
      q.addEventListener("keydown", function (e) { if (e.key === "Enter") apply(); });
      [us, from, to, acc].forEach(function (el) { el.addEventListener("change", apply); });
      var pages = Math.ceil(r.total / r.size);
      var rows = r.items.map(function (e) {
        var ch = e.changes || [];
        return h("tr", {},
          h("td", { class: "nowrap" }, h("b", { text: new Date(e.at).toLocaleDateString("pt-BR") }), h("div", { class: "xs muted", text: new Date(e.at).toLocaleTimeString("pt-BR") })),
          h("td", {}, h("b", { text: r.names[e.user] || e.user }), r.names[e.user] ? h("div", { class: "xs muted", text: e.user }) : null),
          h("td", {}, h("b", { text: ACTIONS[e.action] || e.action }), detail(e) ? h("div", { class: "small muted", text: detail(e) }) : null,
            ch.length ? h("ul", { class: "changes" }, ch.map(function (c) {
              return h("li", {}, h("span", { class: "cf", text: c.field }),
                c.before || c.after ? h("span", { class: "cv" }, c.before ? h("del", { text: c.before }) : null, c.before && c.after ? h("span", { class: "arrow", text: "→" }) : null, c.after ? h("ins", { text: c.after }) : null) : null);
            })) : null));
      });
      fill(view, head("Auditoria", "Registro de todas as alterações feitas no painel: quem fez, o que mudou (antes e depois) e em que data e horário."),
        h("div", { class: "toolbar audit-filters" }, q, us, h("label", { class: "xs muted" }, "De ", from), h("label", { class: "xs muted" }, "até ", to), h("label", { class: "check small" }, acc, "Incluir acessos (entradas e saídas)")),
        h("div", { class: "card" }, h("p", { class: "small muted", text: r.total + (r.total === 1 ? " registro" : " registros") }),
          r.items.length ? h("div", { class: "table-wrap" }, h("table", { class: "table audit" }, h("thead", {}, h("tr", {}, h("th", { text: "Data e hora" }), h("th", { text: "Usuário" }), h("th", { text: "O que foi feito" }))), h("tbody", {}, rows)))
            : h("p", { class: "muted", text: "Nenhum registro encontrado." }),
          pages > 1 ? h("div", { class: "actions mt" },
            h("button", { class: "btn btn--ghost btn--sm", type: "button", disabled: r.page === 0, text: "← Mais recentes", onclick: function () { auditQ.page--; VIEWS.audit(view); } }),
            h("span", { class: "small muted", text: "Página " + (r.page + 1) + " de " + pages }),
            h("button", { class: "btn btn--ghost btn--sm", type: "button", disabled: r.page >= pages - 1, text: "Mais antigos →", onclick: function () { auditQ.page++; VIEWS.audit(view); } })) : null),
        st ? versionsCard(st) : null);
    }).catch(fail);
  };
  // versões publicadas: descartar o rascunho ou restaurar uma versão anterior
  function versionsCard(s) {
    return h("details", { class: "card versions" }, h("summary", {}, h("b", { text: "Versões publicadas" }), h("span", { class: "small muted", text: " · restaurar uma versão anterior ou descartar o rascunho" })),
      h("p", { class: "desc mt", text: s.lastPublish ? "No ar desde " + fmtDate(s.lastPublish) + (s.lastPublishBy ? " (publicado por " + s.lastPublishBy + ")" : "") + "." : "Ainda não houve publicação pelo painel: o site está com o conteúdo original." }),
      s.pending.length ? h("p", {}, h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Descartar o rascunho (" + s.pending.length + " alteração(ões) não publicada(s))", onclick: function () {
        confirmDialog("Descartar todo o rascunho?", "Todas as alterações não publicadas serão perdidas; o painel volta ao que está no ar.", "Descartar", true).then(function (ok) { if (ok) api("POST", "/api/admin/discard").then(function () { toast("Rascunho descartado.", "ok"); refreshStatus(); refreshPagesNav(); route(); }).catch(fail); });
      } })) : null,
      s.history.length ? h("table", { class: "table" }, h("tbody", {}, s.history.map(function (v) {
        return h("tr", {}, h("td", { text: fmtDate(v.at) }), h("td", { text: v.by || "conteúdo original" }), h("td", {}, h("button", { class: "link-btn", type: "button", text: "Restaurar no rascunho", onclick: function () {
          confirmDialog("Restaurar esta versão?", "O rascunho atual será substituído por esta versão. Depois é só revisar e publicar.", "Restaurar").then(function (ok) { if (ok) api("POST", "/api/admin/rollback", { id: v.id }).then(function () { toast("Versão restaurada no rascunho. Revise e publique.", "ok"); refreshStatus(); }).catch(fail); });
        } })));
      }))) : h("p", { class: "muted small", text: "Nenhuma versão anterior ainda." }));
  }

  /* ---------- usuários ---------- */
  function showPassword(title, email, pw) {
    var m = modal([h("h2", { text: title }), h("p", { class: "muted", text: "Senha provisória de " + email + ". Anote ou copie agora: ela não será exibida de novo. No primeiro acesso o painel pede para trocá-la." }), h("code", { class: "pw-show", text: pw }),
      h("div", { class: "actions" },
        h("button", { class: "btn btn--ghost", type: "button", text: "Copiar", onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(pw).then(function () { toast("Senha copiada.", "ok"); }); } }),
        h("button", { class: "btn", type: "button", text: "Pronto", onclick: function () { m.close(); } }))]);
  }
  var PERM_DESC = { pages: "Editar textos, imagens e links das páginas", news: "Criar e editar notícias", identity: "Logotipo e favicon", forms: "Destinos e regras dos formulários", analytics: "Configuração do GA4", inbox: "Ler mensagens dos formulários (dados pessoais)", audit: "Ver o registro de alterações", publish: "Colocar as alterações no ar e restaurar versões", users: "Cadastrar, editar e remover usuários" };
  function userForm(r, u, done) {
    var isNew = !u, isMain = !!u && u.role === "admin";
    var name = inp({ type: "text", value: u ? u.name : "", maxlength: 60 });
    var email = inp({ type: "email", value: u ? u.email : "", disabled: !isNew || null, autocomplete: "off" });
    var pw = inp({ type: "text", value: "", autocomplete: "off", placeholder: "Em branco: o painel gera uma senha forte" });
    var F = { name: field("Nome", name), email: field("E-mail (usado para entrar)", email), password: field("Senha provisória", pw, { hint: "12+ caracteres, com maiúsculas, minúsculas, números e símbolo. O usuário troca no primeiro acesso." }) };
    var boxes = {};
    var permList = h("div", { class: "perm-grid" }, Object.keys(r.perms).map(function (p) {
      var cb = h("input", { type: "checkbox", disabled: isMain || null }); cb.checked = isMain || (u ? u.perms.indexOf(p) >= 0 : false);
      boxes[p] = cb;
      return h("label", { class: "check perm" }, cb, h("span", {}, r.perms[p], h("small", { text: PERM_DESC[p] || "" })));
    }));
    var permErr = h("span", { class: "err", role: "alert" });
    var alert = h("div", { class: "alert alert--err hidden", role: "alert" });
    var btn = h("button", { class: "btn", type: "submit", text: isNew ? "Cadastrar usuário" : "Salvar alterações" });
    var m;
    var form = h("form", { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      Object.keys(F).forEach(function (k) { F[k].setError(""); }); permErr.textContent = ""; alert.classList.add("hidden");
      var body = { name: name.value, email: isNew ? email.value : u.email, perms: Object.keys(boxes).filter(function (p) { return boxes[p].checked; }) };
      if (isNew && pw.value) body.password = pw.value;
      btn.disabled = true;
      api(isNew ? "POST" : "PUT", "/api/admin/users", body).then(function (nr) {
        m.close(); toast(isNew ? "Usuário cadastrado." : "Usuário atualizado.", "ok");
        if (nr.password) showPassword("Usuário cadastrado", body.email, nr.password);
        if (!isNew && S.user && u.email === S.user.email) S.user.name = body.name;
        done();
      }).catch(function (er) {
        var f = er.fields || {};
        Object.keys(f).forEach(function (k) { if (F[k]) F[k].setError(f[k]); });
        if (f.perms) permErr.textContent = f.perms;
        if (!er.fields) { alert.textContent = er.message; alert.classList.remove("hidden"); }
      }).then(function () { btn.disabled = false; });
    } }, alert, h("div", { class: "grid2" }, F.name, F.email), isNew ? F.password : null,
      h("h3", { class: "mt", text: "O que este usuário pode ver no painel" }),
      h("p", { class: "small muted", text: isMain ? "Administrador principal: acesso a todas as áreas." : "Visão geral e Usuários (para trocar a própria senha) aparecem sempre. As demais áreas só aparecem se marcadas." }),
      permList, h("div", { class: "field" }, permErr),
      h("div", { class: "actions" }, h("button", { class: "btn btn--ghost", type: "button", text: "Cancelar", onclick: function () { m.close(); } }), btn));
    m = modal([h("h2", { text: isNew ? "Novo usuário" : "Editar " + u.name }), form], { wide: true });
  }
  VIEWS.users = function (view) {
    var mine = h("div", { class: "card" }, h("h2", { text: "Trocar a minha senha" }), h("p", { class: "desc", text: (S.user ? S.user.name + " · " + S.user.email + ". " : "") + "Ao trocar a senha, as outras sessões abertas com este usuário são encerradas." }), passwordForm(false, function () { route(); }));
    if (!can("users")) { fill(view, head("Usuários", "Sua conta de acesso ao painel."), mine); return; }
    api("GET", "/api/admin/users").then(function (r) {
      var full = r.users.length >= r.max;
      var reload = function () { VIEWS.users(view); };
      var initials = function (u) { return (u.name || u.email).split(/[\s@.]+/).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join(""); };
      var cards = r.users.map(function (u) {
        var me = !!S.user && u.email === S.user.email;
        return h("div", { class: "ucard" },
          h("div", { class: "ucard-top" }, h("span", { class: "avatar", text: initials(u) }),
            h("div", { class: "grow" }, h("b", { text: u.name }), h("div", { class: "small muted", text: u.email }),
              u.role === "admin" || me ? h("div", { class: "ucard-badges" }, u.role === "admin" ? h("span", { class: "badge", text: "Administrador principal" }) : null, me ? h("span", { class: "badge badge--line", text: "Você" }) : null) : null)),
          h("div", { class: "ucard-perms" }, u.role === "admin" ? h("span", { class: "badge badge--ok", text: "Todas as áreas" }) : u.perms.map(function (p) { return h("span", { class: "badge badge--line", text: r.perms[p] }); })),
          h("div", { class: "xs muted" }, "Último acesso: " + fmtDate(u.lastLogin), u.mustChange ? " · aguardando troca da senha provisória" : "", u.locked ? " · bloqueado por tentativas incorretas" : ""),
          h("div", { class: "actions" },
            h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: function () { userForm(r, u, reload); } }, icon("edit"), u.role === "admin" ? "Editar nome" : "Editar permissões"),
            !me ? h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: function () {
              confirmDialog("Redefinir a senha de " + u.name + "?", "Uma senha provisória será criada agora. As sessões abertas desse usuário são encerradas e ele precisará trocar a senha ao entrar.", "Redefinir senha").then(function (ok) {
                if (ok) api("POST", "/api/admin/users/reset", { email: u.email }).then(function (nr) { showPassword("Senha redefinida", u.email, nr.password); reload(); }).catch(fail);
              });
            } }, icon("key"), "Redefinir senha") : null,
            !me && u.role !== "admin" ? h("button", { class: "btn btn--quiet btn--sm", type: "button", onclick: function () {
              confirmDialog("Remover " + u.name + "?", "O acesso de " + u.email + " ao painel é encerrado na hora. O histórico dele continua na Auditoria.", "Remover", true).then(function (ok) {
                if (ok) api("DELETE", "/api/admin/users?email=" + encodeURIComponent(u.email)).then(function () { toast("Usuário removido.", "ok"); reload(); }).catch(fail);
              });
            } }, icon("trash"), "Remover") : null));
      });
      fill(view, head("Usuários", "Até " + r.max + " pessoas com acesso ao painel. Cada uma vê só as áreas liberadas para ela.",
        h("button", { class: "btn", type: "button", disabled: full || null, title: full ? "Limite de " + r.max + " usuários atingido" : null, onclick: function () { userForm(r, null, reload); } }, "+ Novo usuário")),
        full ? h("div", { class: "alert alert--info", text: "Limite de " + r.max + " usuários atingido. Para cadastrar outra pessoa, remova um usuário." }) : null,
        h("div", { class: "ucards" }, cards), h("p", { class: "small muted", text: r.users.length + " de " + r.max + " usuários cadastrados" }), mine);
    }).catch(fail);
  };

  /* ---------- início ---------- */
  fetch("/api/admin/me", { credentials: "same-origin" }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
    if (!x.ok) return renderLogin();
    S.csrf = x.j.csrf; S.user = x.j.user;
    if (x.j.mustChange) renderChangePassword(true); else start();
  }).catch(function () { renderLogin("Não foi possível conectar ao servidor."); });
})();
