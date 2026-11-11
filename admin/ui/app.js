/* Painel MedicGLOBAL — melhorias de edição: autoajuste dos textos, envio de imagem e aviso de alterações não salvas. */
(function () {
  // auto-altura dos textareas
  function grow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  document.querySelectorAll('textarea.auto').forEach(function (t) { grow(t); t.addEventListener('input', function () { grow(t); }); });

  var form = document.getElementById('editor');
  if (!form) return;
  var csrf = (form.querySelector('[name=csrf]') || {}).value || '';
  var enPrefix = form.dataset.enprefix || '';

  // envio de imagem
  document.querySelectorAll('.upload').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var fields = btn.closest('.imgfields');
      var input = fields.querySelector('[data-img]');
      var thumb = btn.closest('.imgrow').querySelector('.thumb');
      var file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.onchange = function () {
        if (!file.files[0]) return;
        var fd = new FormData();
        fd.append('img', file.files[0]);
        fd.append('csrf', csrf);
        btn.disabled = true; btn.textContent = 'Enviando…';
        fetch('?p=upload', { method: 'POST', body: fd })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            btn.disabled = false; btn.textContent = 'Enviar nova imagem…';
            if (!j.ok) { alert(j.error || 'Falha no envio.'); return; }
            input.value = enPrefix + j.path;
            thumb.src = enPrefix + j.path; thumb.style.visibility = 'visible';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          })
          .catch(function () { btn.disabled = false; btn.textContent = 'Enviar nova imagem…'; alert('Falha no envio.'); });
      };
      file.click();
    });
  });

  // aviso de alterações não salvas
  var dirty = false;
  form.addEventListener('input', function () { dirty = true; });
  form.addEventListener('submit', function () { dirty = false; });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
})();
