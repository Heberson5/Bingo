/* Preenche a Política de Privacidade com os dados configurados pelo
   Master (Configurações › Privacidade), via /api/public/privacy. */
(function () {
  function set(name, value) {
    document.querySelectorAll('[data-fill="' + name + '"]').forEach(function (el) { if (value) el.textContent = value; });
  }
  function days(n) {
    if (!n) return 'nunca (apagamento só quando solicitado)';
    if (n === 365) return '1 ano';
    return n + ' dias';
  }
  fetch('/api/public/privacy', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (p) {
      if (!p) return;
      set('orgName', p.orgName);
      set('dpoName', p.dpoName);
      set('retentionText', days(p.retentionDays));
      set('auditText', days(p.auditRetentionDays));
      set('telaoNameText', { primeiro: 'o primeiro nome e a inicial do sobrenome', cartela: 'apenas o número da cartela', completo: 'o nome do ganhador' }[p.telaoName]);
      document.querySelectorAll('[data-fill-mail="dpoEmail"]').forEach(function (a) {
        a.textContent = p.dpoEmail;
        a.href = 'mailto:' + p.dpoEmail;
      });
      document.querySelectorAll('[data-show]').forEach(function (el) {
        var key = el.dataset.show;
        el.hidden = key === 'dpo' ? !p.dpoName : !p[key];
      });
      document.querySelectorAll('[data-hide]').forEach(function (el) { el.hidden = !!p[el.dataset.hide]; });
    })
    .catch(function () { /* mantém o texto padrão */ });
  // Sem a API (ex.: abrindo o arquivo direto), esconde os blocos condicionais.
  document.querySelectorAll('[data-show]').forEach(function (el) { el.hidden = true; });
})();
