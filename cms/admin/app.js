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
  };
  function icon(n) { var s = h("span", { class: "ico", "aria-hidden": "true" }); s.innerHTML = '<svg viewBox="0 0 24 24">' + ICONS[n] + "</svg>"; return s; }
  var NAV = [
    ["Conteúdo do site", [["", "Visão geral", "home"], ["pages", "Páginas do site", "pages"], ["news", "Notícias", "news"], ["media", "Biblioteca de mídia", "image"]]],
    ["Configurações", [["site", "Dados gerais", "info"], ["identity", "Identidade visual", "brand"], ["forms", "Formulários", "form"], ["analytics", "Google Analytics", "chart"]]],
    ["Acompanhamento", [["inbox", "Mensagens recebidas", "inbox"], ["history", "Publicações", "history"], ["account", "Minha conta", "user"]]],
  ];
  var TITLES = {}; NAV.forEach(function (g) { g[1].forEach(function (n) { TITLES[n[0]] = n[1]; }); });
  TITLES.page = TITLES.pages;
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
        return [h("div", { class: "side-group", text: g[0] }), g[1].map(function (n) { return h("a", { class: "nav", href: "#/" + n[0], "data-nav": n[0] }, icon(n[2]), n[1]); })];
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
      h("button", { class: "btn btn--sm", type: "button", id: "pubbtn", onclick: publish }, icon("send"), h("span", { text: "Publicar" })));
    var main = h("div", { class: "main" }, top, h("main", { class: "content", id: "view" }));
    var shell = h("div", { class: "shell" }, side, main);
    side.addEventListener("click", function (e) { if (e.target.closest("a")) shell.classList.remove("nav-open"); });
    app.replaceChildren(shell);
    refreshStatus();
    route();
  }
  function refreshStatus() {
    return api("GET", "/api/admin/status").then(function (s) {
      S.status = s;
      var el = $("#pubstatus"); if (!el) return;
      var n = s.pending.length;
      el.replaceChildren(h("span", { class: "dot" + (n ? " dot--warn" : "") }), n ? n + (n === 1 ? " alteração para publicar" : " alterações para publicar") : "Tudo publicado");
      el.title = s.lastPublish ? "Última publicação: " + fmtDate(s.lastPublish) : "";
      $("#pubbtn").disabled = !n;
    }).catch(fail);
  }
  function preview(key) {
    var w = window.open("about:blank", "_blank");
    api("POST", "/api/admin/preview", { key: key }).then(function (j) {
      if (w) w.location = j.url; else location.href = j.url;
      if (Object.keys(j.orphans || {}).length) toast("Algumas edições antigas não encontraram o elemento original (o código da página mudou). Revise a página.", "err");
    }).catch(function (e) { if (w) w.close(); fail(e); });
  }
  function publish() {
    var pend = (S.status && S.status.pending) || [];
    var names = { site: "Dados gerais", noticias: "Notícias", identity: "Identidade visual", analytics: "Google Analytics", forms: "Formulários (limite de anexo)" };
    var list = h("ul", { class: "small" }, pend.map(function (p) { return h("li", { text: p.area === "page" ? "Página: " + p.key : names[p.area] || p.area }); }));
    if (dirty && dirty()) { toast("Salve ou cancele as alterações desta tela antes de publicar.", "err"); return; }
    confirmDialog("Publicar alterações?", h("div", {}, h("p", { class: "muted", text: "O conteúdo abaixo vai para o site público agora. A versão atual fica guardada em Publicações e pode ser restaurada." }), list), "Publicar agora").then(function (ok) {
      if (!ok) return;
      var b = $("#pubbtn"), t = b.querySelector("span:last-child"); b.disabled = true; t.textContent = "Publicando…";
      api("POST", "/api/admin/publish").then(function (j) {
        toast("Site publicado com sucesso (" + j.ms + " ms).", "ok");
        if (Object.keys(j.orphans || {}).length) toast("Atenção: algumas edições não encontraram o elemento original e não foram aplicadas.", "err");
      }).catch(fail).then(function () { t.textContent = "Publicar"; refreshStatus(); route(); });
    });
  }

  var VIEWS = {};
  var lastHash = location.hash;
  function route() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    var name = parts[0] || "";
    document.querySelectorAll("[data-nav]").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-nav") === name || (name === "page" && a.getAttribute("data-nav") === "pages")); });
    var view = $("#view");
    if (!view) return;
    dirty = null; S.currentKey = null;
    setCrumbs(name ? [[TITLES[name] || "Painel"]] : [["Visão geral"]]);
    fill(view, h("p", { class: "muted", text: "Carregando…" }));
    (VIEWS[name] || VIEWS[""])(view, parts.slice(1));
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
  // progresso da revisão das páginas do site (português)
  function reviewProgress(pages) {
    var main = pages.filter(function (p) { return p.lang === "pt" && p.group === "Páginas do site"; });
    var done = main.filter(function (p) { return p.reviewed; }).length;
    var next = main.find(function (p) { return !p.reviewed; });
    return { done: done, total: main.length, next: next,
      el: h("div", { class: "progress" }, h("div", { class: "progress-top" }, h("span", {}, h("b", { text: done + " de " + main.length }), " páginas do site revisadas"), h("span", { text: Math.round(done / Math.max(1, main.length) * 100) + "%" })),
        h("div", { class: "bar" }, (function () { var i = h("i"); i.style.width = (done / Math.max(1, main.length) * 100) + "%"; return i; })())) };
  }

  /* ---------- visão geral ---------- */
  VIEWS[""] = function (view) {
    Promise.all([api("GET", "/api/admin/status"), api("GET", "/api/admin/pages"), api("GET", "/api/admin/forms")]).then(function (r) {
      var st = r[0], pages = r[1].pages, fm = r[2].forms;
      var msgs = fm.reduce(function (a, f) { return a + f.count; }, 0);
      var pr = reviewProgress(pages);
      function stat(ic, val, label, small) { return h("div", { class: "stat" }, icon(ic), h("b", { class: small ? "small" : null, text: val }), h("span", { text: label })); }
      fill(view,
        head("Olá" + (S.user && S.user.name ? ", " + S.user.name : "") + "!", "Tudo o que dá para editar no site, organizado na mesma ordem em que aparece para o visitante."),
        h("div", { class: "stats" },
          stat("pages", pages.filter(function (p) { return p.lang === "pt" && p.group === "Páginas do site"; }).length, "páginas do site (também em inglês)"),
          stat("edit", st.pending.length, "alterações aguardando publicação"),
          stat("inbox", msgs, "mensagens recebidas pelos formulários"),
          stat("history", st.lastPublish ? fmtDate(st.lastPublish) : "Ainda não", "última publicação" + (st.lastPublishBy ? " · " + st.lastPublishBy : ""), true)),
        h("div", { class: "card" }, h("div", { class: "page-head" }, h("div", {}, h("h2", { text: "Revisão do site, página por página" }), h("p", { text: "Siga a ordem do menu do site e marque cada página como revisada ao terminar." })),
          pr.next ? h("a", { class: "btn", href: "#/page/" + pr.next.key }, "Continuar: " + pr.next.title, icon("chev")) : h("span", { class: "badge badge--ok", text: "Todas revisadas" })), pr.el),
        h("div", { class: "card" }, h("h2", { text: "Como funciona" }), h("p", { class: "desc", text: "Nada vai para o ar sem a sua confirmação." }),
          h("ol", { class: "steps" },
            h("li", {}, h("b", { text: "Edite" }), "Textos, imagens, botões e links de cada seção."),
            h("li", {}, h("b", { text: "Salve o rascunho" }), "O site público ainda não muda."),
            h("li", {}, h("b", { text: "Visualize" }), "Confira a página com as mudanças."),
            h("li", {}, h("b", { text: "Publique" }), "O site é atualizado em segundos; dá para desfazer em Publicações."))),
        h("div", { class: "card" }, h("h2", { text: "Atalhos" }), h("p", { class: "desc", text: "Tarefas mais comuns." }), h("div", { class: "shortcuts" },
          h("a", { class: "shortcut", href: "#/page/pt/index.html" }, icon("home"), "Editar a página inicial"),
          h("a", { class: "shortcut", href: "#/news/nova" }, icon("news"), "Publicar uma notícia"),
          h("a", { class: "shortcut", href: "#/inbox" }, icon("inbox"), "Ver mensagens recebidas"),
          h("a", { class: "shortcut", href: "#/analytics" }, icon("chart"), "Configurar o Google Analytics"))));
    }).catch(fail);
  };

  /* ---------- lista de páginas (na ordem do site) ---------- */
  var pagesLang = "pt";
  VIEWS.pages = function (view) {
    api("GET", "/api/admin/pages").then(function (r) {
      var q = inp({ type: "search", class: "input", placeholder: "Buscar página…", "aria-label": "Buscar página" });
      var list = h("div", {});
      var seg = h("div", { class: "seg", role: "group", "aria-label": "Idioma" });
      [["pt", "Português"], ["en", "Inglês"]].forEach(function (l) { seg.appendChild(h("button", { type: "button", "aria-pressed": String(pagesLang === l[0]), text: l[1], onclick: function () { pagesLang = l[0]; seg.querySelectorAll("button").forEach(function (b, i) { b.setAttribute("aria-pressed", String(i === (pagesLang === "pt" ? 0 : 1))); }); draw(); } })); });
      var DESC = { "Páginas do site": "Na ordem do menu do site", "Componentes compartilhados": "Blocos que aparecem em mais de uma página", "Documentos regulatórios": "RN 565 e IDSS (gerados a partir dos dados oficiais)", "Outras": "" };
      function row(p, n) {
        return h("a", { class: "prow" + (p.reviewed ? " is-reviewed" : ""), href: "#/page/" + p.key },
          h("span", { class: "num", text: p.reviewed ? "✓" : pad(n) }),
          h("div", {}, h("div", { class: "t", text: p.title }), h("div", { class: "f" }, h("span", { text: p.partial ? "Usado em várias páginas" : (p.lang === "en" ? "/en/" : "/") + p.file }), p.area && !p.partial ? h("span", { class: "badge badge--line", text: p.area }) : null)),
          h("div", { class: "tags" },
            p.pending ? h("span", { class: "badge badge--warn", text: "não publicado" }) : null,
            p.edits ? h("span", { class: "badge", text: p.edits + (p.edits === 1 ? " alteração" : " alterações") }) : null,
            p.reviewed ? h("span", { class: "badge badge--ok", text: "Revisada" }) : null),
          h("span", { class: "go" }, icon("chev")));
      }
      function draw() {
        var term = q.value.toLowerCase(), groups = {};
        r.pages.filter(function (p) { return p.lang === pagesLang && (p.title + " " + p.file + " " + (p.area || "")).toLowerCase().indexOf(term) >= 0; }).forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });
        list.replaceChildren();
        r.groups.forEach(function (g) {
          var items = groups[g];
          if (!items) return;
          var done = items.filter(function (p) { return p.reviewed; }).length;
          var title = h("h3", {}, g, h("span", { class: "badge badge--line", text: done + "/" + items.length + " revisadas" }), DESC[g] ? h("span", { class: "xs muted", text: "· " + DESC[g] }) : null);
          var rows = h("div", { class: "plist" }, items.map(function (p, i) { return row(p, i + 1); }));
          // documentos regulatórios: muitas páginas parecidas, ficam recolhidos
          if (g === "Documentos regulatórios" && !term) list.appendChild(h("details", { class: "plist-group" }, h("summary", { class: "small muted", text: "Mostrar " + items.length + " páginas de documentos regulatórios (RN 565 e IDSS)" }), title, rows));
          else list.appendChild(h("div", { class: "plist-group" }, title, rows));
        });
        if (!list.children.length) list.appendChild(h("p", { class: "muted", text: "Nenhuma página encontrada." }));
      }
      q.addEventListener("input", draw);
      var pr = reviewProgress(r.pages);
      fill(view, head("Páginas do site", "As páginas estão na mesma ordem do menu do site. Abra uma, edite seção por seção e marque como revisada para seguir para a próxima."),
        h("div", { class: "card" }, pr.el), h("div", { class: "toolbar" }, q, seg), list);
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
    setCrumbs([[TITLES.pages, "#/pages"], [P.title + (P.lang === "en" ? " (inglês)" : "")]]);
    var changes = {}, metaChanges = {}, fields = {};
    var byId = {}; P.units.forEach(function (u) { byId[u.id] = u; });
    var unitSec = {}; P.sections.forEach(function (s) { s.units.forEach(function (id) { unitSec[id] = s.id; }); });
    var savebar = h("div", { class: "savebar hidden" });
    var saveInfo = h("span", { class: "grow" });
    var saveBtn = h("button", { class: "btn", type: "button", text: "Salvar rascunho", onclick: save });
    savebar.append(saveInfo, h("button", { class: "btn btn--ghost", type: "button", text: "Cancelar", onclick: cancel }), saveBtn);
    dirty = function () { return Object.keys(changes).length + Object.keys(metaChanges).length > 0; };
    var marks = {}; // bolinha de cada seção no índice
    function mark() {
      var n = Object.keys(changes).length + Object.keys(metaChanges).length;
      savebar.classList.toggle("hidden", !n);
      saveInfo.textContent = n + (n === 1 ? " campo alterado, ainda não salvo" : " campos alterados, ainda não salvos");
      var unsaved = {}; Object.keys(changes).forEach(function (id) { unsaved[unitSec[id]] = true; });
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
      api("PUT", "/api/admin/page?key=" + encodeURIComponent(P.key), { edits: changes, meta: metaChanges }).then(function (np) {
        toast("Rascunho salvo. Use Visualizar para conferir e Publicar para colocar no ar.", "ok");
        changes = {}; metaChanges = {};
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
      confirmDialog("Descartar as alterações não salvas?", "Os campos voltam ao último rascunho salvo.", "Descartar", true).then(function (ok) { if (ok) { changes = {}; metaChanges = {}; pageEditor(view, P); } });
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
        wrap = field(label, ed, { limit: limit, measure: function () { return plainLen(ed.innerHTML); }, hint: "Use “Destaque” para o trecho colorido. Trechos entre {{ }} são dados automáticos (Dados gerais)." });
        wrap.querySelector("label").insertBefore(bar, wrap.querySelector(".counter"));
      } else {
        var long = limit > 160 || /^(p|li|dd|blockquote|td)$/.test(u.tag);
        var el = inp({ tag: long ? "textarea" : "input", type: long ? null : "text", value: decode(html), rows: long ? Math.min(8, Math.ceil(decode(html).length / 90) + 1) : null });
        el.addEventListener("input", function () { var o = {}; o[key] = escHtml(el.value); set(u, o); });
        wrap = field(label, el, { limit: limit, measure: function () { return el.value.replace(/\s+/g, " ").trim().length; }, hint: /\{\{L\./.test(html) ? "Trechos entre {{ }} são dados automáticos, editados em Dados gerais." : null });
      }
      return wrap;
    }
    function renderUnit(u) {
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
        box.append(field("Destino (para onde o clique leva)", href, { hint: u.linkedData ? "Vinculado a Dados gerais (" + u.linkedData + "). Alterar aqui substitui o vínculo só neste botão." : "Ex.: planos.html, https://…, tel:+55…, mailto:… ou #secao" }),
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

    // ---- cabeçalho: onde estou, revisão e navegação em sequência ----
    var pl = P.place || {};
    var reviewed = !!pl.reviewed;
    var rv = h("button", { class: "review-toggle", type: "button", "aria-pressed": String(reviewed), onclick: function () {
      api("POST", "/api/admin/review", { key: P.key, done: !reviewed }).then(function (j) {
        reviewed = !!j.reviewed; rv.setAttribute("aria-pressed", String(reviewed));
        rv.lastChild.textContent = reviewed ? "Página revisada" : "Marcar página como revisada";
        toast(reviewed ? "Página marcada como revisada." + (pl.next ? " Próxima: " + pl.next.title + "." : "") : "Marcação de revisão removida.", "ok");
      }).catch(fail);
    } }, h("span", { class: "box" }, icon("check")), h("span", { text: reviewed ? "Página revisada" : "Marcar página como revisada" }));
    var where = P.partial ? "Componente compartilhado" : pl.group === "Páginas do site" ? "Página " + pl.pos + " de " + pl.total + " · " + pl.area : (pl.area || pl.group) + " · " + pl.pos + " de " + pl.total;
    var headCard = h("div", { class: "ed-head" },
      h("div", { class: "ed-head-top" },
        h("div", {}, h("div", { class: "eyebrow" }, where, P.lang === "en" ? h("span", { class: "badge", text: "Inglês" }) : null), h("h1", { text: P.title }),
          h("div", { class: "url", text: P.partial ? "A alteração vale para todas as páginas que usam este bloco." : "/" + P.url })),
        h("div", { class: "actions" },
          P.url ? h("a", { class: "btn btn--quiet btn--sm", href: "/" + P.url, target: "_blank", rel: "noopener" }, icon("ext"), "Abrir no site") : null,
          h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: function () { if (dirty()) toast("Salve o rascunho antes de visualizar.", "err"); else preview(P.key); } }, icon("eye"), "Visualizar rascunho"))),
      h("div", { class: "ed-head-bottom" }, rv,
        h("div", { class: "actions" },
          pl.prev ? h("a", { class: "btn btn--quiet btn--sm", href: "#/page/" + pl.prev.key, title: pl.prev.title }, icon("left"), "Anterior") : null,
          pl.next ? h("a", { class: "btn btn--ghost btn--sm", href: "#/page/" + pl.next.key, title: pl.next.title }, "Próxima: " + pl.next.title, icon("chev")) : null)));
    var pager = h("div", { class: "pager" },
      pl.prev ? h("a", { href: "#/page/" + pl.prev.key }, h("small", { text: "← Página anterior" }), h("b", { text: pl.prev.title })) : null,
      pl.next ? h("a", { class: "next", href: "#/page/" + pl.next.key }, h("small", { text: "Próxima página →" }), h("b", { text: pl.next.title })) : null);

    fill(view,
      headCard,
      P.generated ? h("div", { class: "alert alert--info", text: "Página gerada automaticamente a partir dos dados regulatórios. As edições aqui ficam por cima desses dados." }) : null,
      P.orphans.length ? h("div", { class: "alert alert--warn", text: P.orphans.length + " edição(ões) antiga(s) não foram aplicadas porque o código desta página mudou desde então. Revise os campos e salve de novo." }) : null,
      h("div", { class: "ed-layout" }, outline,
        h("div", {}, h("div", { class: "toolbar" }, q), seo, secs, pager, savebar)));
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
          h("thead", {}, h("tr", {}, h("th", { text: "Título" }), h("th", { text: "Categoria" }), h("th", { text: "Data" }), h("th", { text: "Inglês" }), h("th", {}))),
          h("tbody", {}, rows.map(function (x) {
            var n = x[0], i = x[1];
            return h("tr", {}, h("td", {}, h("a", { href: "#/news/" + i, text: n.titulo })), h("td", { text: n.cat === "comunicados" ? "Comunicado" : "Notícia" }), h("td", { text: n.data.split("-").reverse().join("/") }), h("td", { text: n.en ? "Sim" : "—" }),
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
    var enBox = h("div", {});
    function drawEn() {
      enBox.replaceChildren();
      if (!n.en) { enBox.appendChild(h("div", { class: "card" }, h("h2", { text: "Versão em inglês" }), h("p", { class: "desc", text: "Sem versão em inglês, a notícia não aparece no site em inglês." }), h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "+ Adicionar versão em inglês", onclick: function () { n.en = { titulo: "", resumo: "", alt: "", intro: "", tema: "", migalha: "", secoes: [{ h: "", p: [] }] }; changed = true; drawEn(); } }))); return; }
      enBox.append(h("div", { class: "card" }, h("h2", { text: "Versão em inglês" }), txt(n.en, "titulo", "Title", 140), txt(n.en, "resumo", "Summary", 300, { area: true }), h("div", { class: "grid2" }, txt(n.en, "tema", "Topic", 60), txt(n.en, "migalha", "Breadcrumb", 60)), txt(n.en, "intro", "Intro", 1200, { area: true, rows: 4 }), txt(n.en, "alt", "Image alt text", 160),
        h("button", { class: "link-btn", type: "button", text: "Remover versão em inglês", onclick: function () { delete n.en; changed = true; drawEn(); } })), secoesBox(n.en, "Sections (English)"));
    }
    drawEn();
    var alert = h("div", { class: "alert alert--err hidden", role: "alert" });
    var saveBtn = h("button", { class: "btn", type: "button", text: "Salvar rascunho", onclick: function () {
      var nl = list.slice(); if (idx >= 0) nl[idx] = n; else nl.push(n);
      saveBtn.disabled = true; alert.classList.add("hidden");
      api("PUT", "/api/admin/noticias", { noticias: nl }).then(function () { changed = false; toast("Notícia salva no rascunho.", "ok"); refreshStatus(); location.hash = "#/news"; })
        .catch(function (e) { alert.replaceChildren(h("strong", { text: "Não foi possível salvar:" }), h("ul", {}, (e.list || [e.message]).map(function (x) { return h("li", { text: x }); }))); alert.classList.remove("hidden"); alert.scrollIntoView({ block: "center" }); })
        .then(function () { saveBtn.disabled = false; });
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
      enBox,
      h("div", { class: "savebar" }, h("span", { class: "grow", text: "As alterações entram no site após Publicar." }), h("a", { class: "btn btn--ghost", href: "#/news", text: "Cancelar" }), saveBtn));
  }

  /* ---------- dados gerais ---------- */
  VIEWS.site = function (view) {
    api("GET", "/api/admin/site").then(function (r) {
      var vals = {}, F = {};
      dirty = function () { return Object.keys(vals).length > 0; };
      var groups = {};
      r.fields.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
      var LABELS = { label: "Texto exibido", tel: "Link de discagem", e164: "Formato internacional", url: "Endereço (URL)", full: "Endereço completo (exibido)", street: "Rua e número", district: "Bairro", city: "Cidade", state: "UF", zip: "CEP", maps: "Link do Google Maps", embed: "Mapa incorporado", razao: "Razão social", cnpj: "CNPJ", ouvidoriaHours: "Horário da ouvidoria" };
      var cards = Object.keys(groups).map(function (g) {
        return h("details", { class: "sec" }, h("summary", {}, g, h("span", { class: "count", text: groups[g].length + " campos" })), h("div", { class: "sec-body" }, groups[g].map(function (f) {
          var last = f.path.split(".").pop(), parent = f.path.split(".").slice(-2, -1)[0];
          var label = (parent && f.path.split(".").length > 2 ? parent + " · " : "") + (LABELS[last] || last);
          var el = inp({ type: f.type === "email" ? "email" : "text", value: f.value, spellcheck: f.type === "text" ? "true" : "false" });
          el.addEventListener("input", function () { if (el.value === f.value) delete vals[f.path]; else vals[f.path] = el.value; });
          var fl = field(label, el, { limit: 500, hint: f.path + (f.value !== f.base ? " · alterado (original: " + f.base + ")" : "") });
          F[f.path] = fl;
          return fl;
        })));
      });
      var btn = h("button", { class: "btn", type: "button", text: "Salvar rascunho", onclick: function () {
        btn.disabled = true;
        Object.keys(F).forEach(function (k) { F[k].setError(""); });
        api("PUT", "/api/admin/site", { values: vals }).then(function () { vals = {}; toast("Dados gerais salvos no rascunho.", "ok"); refreshStatus(); route(); })
          .catch(function (e) { fail(e); Object.keys(e.fields || {}).forEach(function (k) { if (F[k]) { F[k].setError(e.fields[k]); F[k].closest("details").open = true; } }); })
          .then(function () { btn.disabled = false; });
      } });
      fill(view, head("Dados gerais", "Telefones, WhatsApp, endereços, links de sistemas e documentos usados em todo o site (inclusive no menu e no rodapé, que não têm edição direta)."),
        h("div", { class: "alert alert--info", text: "Cada valor aparece em vários lugares do site: ao alterar aqui, todas as ocorrências mudam juntas na próxima publicação." }),
        cards, h("div", { class: "savebar" }, h("span", { class: "grow" }), btn));
    }).catch(fail);
  };

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

  /* ---------- biblioteca de mídia ---------- */
  VIEWS.media = function (view) {
    api("GET", "/api/admin/media").then(function (r) {
      var fileIn = h("input", { type: "file", accept: ".jpg,.jpeg,.png,.webp", class: "sr-only", id: "f" + (++uid), multiple: true });
      var err = h("div", { class: "alert alert--err hidden", role: "alert" });
      fileIn.addEventListener("change", function () {
        var files = Array.prototype.slice.call(fileIn.files), msgs = [];
        files.reduce(function (p, f) { return p.then(function () { return uploadFile(f, "photo").catch(function (e) { msgs.push(f.name + ": " + e.message); }); }); }, Promise.resolve()).then(function () {
          if (msgs.length) { err.textContent = msgs.join(" · "); err.classList.remove("hidden"); } else toast("Imagens enviadas.", "ok");
          VIEWS.media(view);
        });
      });
      var R = r.rules.photo;
      fill(view, head("Biblioteca de mídia", "Imagens enviadas pelo painel. Para usar uma imagem, troque-a no campo da página, notícia ou identidade visual."),
        err, h("label", { class: "drop", for: fileIn.id }, h("strong", { text: "Enviar fotos" }), h("div", { class: "small", text: "JPG, PNG ou WebP · até " + R.maxBytes / 1048576 + " MB · de " + R.minW + "×" + R.minH + " a " + R.maxW + "×" + R.maxH + " px" })), fileIn,
        h("div", { class: "media-grid mt" }, r.files.length ? r.files.map(function (f) {
          return h("a", { class: "media-item", href: f.url, target: "_blank", rel: "noopener" }, h("div", { class: "thumb" + (f.purpose !== "photo" ? " thumb--contain" : "") }, h("img", { src: f.url, alt: "", loading: "lazy" })),
            h("small", { text: (f.original || f.name) }), h("small", { text: ({ photo: "Foto", logo: "Logotipo", favicon: "Favicon" }[f.purpose] || "") + " · " + f.w + "×" + f.h + " · " + fmtSize(f.size || 0) }));
        }) : h("p", { class: "muted", text: "Nenhuma imagem enviada ainda." })));
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

  /* ---------- publicações (histórico) ---------- */
  VIEWS.history = function (view) {
    api("GET", "/api/admin/status").then(function (s) {
      fill(view, head("Publicações", "Cada publicação guarda a versão anterior. Restaurar coloca a versão escolhida no rascunho para você revisar e publicar."),
        s.pending.length ? h("div", { class: "card" }, h("h2", { text: "Rascunho atual" }), h("p", { class: "desc", text: s.pending.length + " alteração(ões) ainda não publicada(s)." }),
          h("div", { class: "actions" }, h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Descartar rascunho", onclick: function () {
            confirmDialog("Descartar todo o rascunho?", "Todas as alterações não publicadas serão perdidas; o painel volta ao que está no ar.", "Descartar", true).then(function (ok) { if (ok) api("POST", "/api/admin/discard").then(function () { toast("Rascunho descartado.", "ok"); refreshStatus(); route(); }).catch(fail); });
          } }))) : null,
        h("div", { class: "card" }, h("h2", { text: "No ar" }), h("p", { class: "desc", text: s.lastPublish ? "Publicado em " + fmtDate(s.lastPublish) + (s.lastPublishBy ? " por " + s.lastPublishBy : "") : "Ainda não houve publicação pelo painel: o site está com o conteúdo original." })),
        h("div", { class: "card" }, h("h2", { text: "Versões anteriores" }), s.history.length ? h("table", { class: "table" }, h("tbody", {}, s.history.map(function (v) {
          return h("tr", {}, h("td", { text: fmtDate(v.at) }), h("td", { text: v.by || "conteúdo original" }), h("td", {}, h("button", { class: "link-btn", type: "button", text: "Restaurar no rascunho", onclick: function () {
            confirmDialog("Restaurar esta versão?", "O rascunho atual será substituído por esta versão. Depois é só revisar e publicar.", "Restaurar").then(function (ok) { if (ok) api("POST", "/api/admin/rollback", { id: v.id }).then(function () { toast("Versão restaurada no rascunho. Revise e publique.", "ok"); refreshStatus(); }).catch(fail); });
          } })));
        }))) : h("p", { class: "muted small", text: "Nenhuma versão anterior ainda." })));
    }).catch(fail);
  };

  /* ---------- minha conta ---------- */
  VIEWS.account = function (view) {
    fill(view, head("Minha conta", S.user ? S.user.email : ""), h("div", { class: "card" }, h("h2", { text: "Trocar senha" }), h("p", { class: "desc", text: "Ao trocar a senha, as outras sessões abertas com este usuário são encerradas." }), passwordForm(false, function () { route(); })));
  };

  /* ---------- início ---------- */
  fetch("/api/admin/me", { credentials: "same-origin" }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
    if (!x.ok) return renderLogin();
    S.csrf = x.j.csrf; S.user = x.j.user;
    if (x.j.mustChange) renderChangePassword(true); else start();
  }).catch(function () { renderLogin("Não foi possível conectar ao servidor."); });
})();
