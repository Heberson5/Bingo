/* ================================================================
   Redesign v2 — camada de interface
   ----------------------------------------------------------------
   Só cuida de apresentação: título da página no topo, painel "hero"
   do sorteio, abas no celular, KPIs das cartelas, cartão do usuário no
   menu lateral e navegação das Configurações. Toda a regra do jogo
   continua em js/state.js e js/ui.js — aqui apenas "embrulhamos" as
   funções de render de lá para atualizar os elementos novos depois
   que elas rodam, sem mudar o que elas fazem.
================================================================ */
(function () {
  const PAGE_META = {
    sorteio: { title: 'Sorteio', subtitle: () => `Jogo #${Store.game.id}` },
    cartelas: { title: 'Cartelas', subtitle: () => 'Cadastro, estoque e entrega' },
    historico: { title: 'Histórico', subtitle: () => 'Partidas encerradas' },
    dashboard: { title: 'Dashboard', subtitle: () => 'Visão geral das partidas' },
    config: { title: 'Configurações', subtitle: () => 'Conta, aparência e regras do jogo' },
    usuarios: { title: 'Usuários', subtitle: () => 'Logins dos operadores' },
    permissoes: { title: 'Permissões', subtitle: () => 'O que cada papel pode ver' },
  };

  function wrap(name, after) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) {
      const result = original.apply(this, args);
      try { after(...args); } catch (e) { console.error('[redesign]', name, e); }
      return result;
    };
  }

  function initialsFor(text) {
    if (typeof initialsOf === 'function') return initialsOf(text);
    return String(text || '?').slice(0, 2).toUpperCase();
  }

  /* ---------- Topo: título da página + cartão do usuário ---------- */
  function renderChrome(view) {
    const meta = PAGE_META[view];
    if (meta) {
      $('#pageTitle').textContent = meta.title;
      $('#pageSubtitle').textContent = meta.subtitle();
      document.body.dataset.view = view;
    }
    const u = Session.user;
    if (u) {
      const label = u.name || u.email;
      $('#sideUserAvatar').textContent = initialsFor(label);
      $('#sideUserName').textContent = label;
      $('#sideUserRole').textContent = Session.isMaster() ? 'Master' : 'Usuário';
      $('#accountAvatar').textContent = initialsFor(label);
    }
    $('#masterFilterWrap').hidden = $('#masterUserFilter').hidden;
  }

  wrap('switchView', (name) => renderChrome(name));

  $('#btnLogoutSide').addEventListener('click', () => {
    openConfirm('Sair?', 'Você vai precisar entrar de novo com seu e-mail e senha.', performLogout);
  });

  new MutationObserver(() => { $('#masterFilterWrap').hidden = $('#masterUserFilter').hidden; })
    .observe($('#masterUserFilter'), { attributes: true, attributeFilter: ['hidden'] });

  /* ---------- Sorteio: painel principal (hero) ---------- */
  function formatElapsed(startIso) {
    if (!startIso) return 'Não iniciado';
    const min = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 60000));
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  }

  function renderHero() {
    const drawn = Store.game.drawnNumbers.length;
    const total = Store.config.max - Store.config.min + 1;
    const cards = activeCards().length;
    const pending = pendingAchievements().length;

    $('#heroDrawn').textContent = drawn;
    $('#heroTotal').textContent = total;
    $('#heroProgress').style.width = `${total ? Math.min(100, drawn / total * 100) : 0}%`;
    $('#heroStatus').textContent = drawn === 0 ? 'Pronto para começar' : (availableNumbers().length === 0 ? 'Todas as bolas saíram' : 'Partida em andamento');
    $('.hero').classList.toggle('is-live', drawn > 0);
    $('#heroElapsed').textContent = formatElapsed(Store.game.startedAt);
    $('#heroCards').textContent = `${cards} cartela${cards === 1 ? '' : 's'}`;

    const badge = $('#tabWinnersBadge');
    badge.hidden = pending === 0;
    badge.textContent = pending;
    $('#tabCardsCount').textContent = cards;

    const ball = $('#currentBall');
    const letter = $('#currentBallLetter').textContent.trim().toLowerCase();
    ball.dataset.letter = /^[bingo]$/.test(letter) ? letter : '';
    if (PAGE_META.sorteio && document.body.dataset.view === 'sorteio') {
      $('#pageSubtitle').textContent = PAGE_META.sorteio.subtitle();
    }
  }

  wrap('renderSorteio', renderHero);
  setInterval(() => { if (document.body.dataset.view === 'sorteio') $('#heroElapsed').textContent = formatElapsed(Store.game.startedAt); }, 30000);

  /* ---------- Abas (só mudam o que aparece no celular) ---------- */
  function setupTabs(containerSel, attr, viewSel, onChange) {
    const view = $(viewSel);
    const buttons = $$(`${containerSel} [data-${attr}-tab]`);
    function select(name) {
      buttons.forEach((b) => b.classList.toggle('is-active', b.dataset[`${attr}Tab`] === name));
      view.dataset.activePane = name;
      if (onChange) onChange(name);
    }
    buttons.forEach((b) => b.addEventListener('click', () => select(b.dataset[`${attr}Tab`])));
    select(buttons[0].dataset[`${attr}Tab`]);
    return select;
  }

  const selectSorteioTab = setupTabs('#sorteioTabs', 'sorteio', '#view-sorteio');
  // Ao ligar o modo Manual no celular, o painel de números precisa estar
  // visível — é nele que o operador toca o número.
  $('#btnMarcarManual').addEventListener('click', () => selectSorteioTab('painel'));

  setupTabs('#cartelasTabs', 'cartelas', '#view-cartelas', (name) => {
    if (name === 'historico') {
      $('#cartelasHistoricoList').hidden = false;
      const chevron = $('#toggleHistorico .chevron');
      if (chevron) chevron.classList.add('is-open');
    }
  });

  /* ---------- Cartelas: KPIs ---------- */
  function renderCartelasKpis() {
    const stock = stockCards().length;
    const active = activeCards().length;
    const used = Store.cards.filter((c) => c.status === 'used').length;
    $('#kpiEstoque').textContent = stock;
    $('#kpiAtivas').textContent = active;
    $('#kpiUsadas').textContent = used;
    $('#kpiTotal').textContent = Store.cards.length;
    $('#tabEstoqueCount').textContent = stock;
    $('#tabAtivasCount').textContent = active;
  }
  wrap('renderCartelas', renderCartelasKpis);
  wrap('renderEstoque', renderCartelasKpis);

  // Menu "Imprimir": fecha ao escolher uma opção ou clicar fora.
  $$('details.dropdown').forEach((dd) => {
    dd.addEventListener('click', (e) => { if (e.target.closest('.dropdown__item')) dd.open = false; });
  });
  document.addEventListener('click', (e) => {
    $$('details.dropdown[open]').forEach((dd) => { if (!dd.contains(e.target)) dd.open = false; });
  });

  /* ---------- Configurações: navegação lateral ---------- */
  const settingsLinks = $$('.settings-nav__link');
  settingsLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      settingsLinks.forEach((l) => l.classList.toggle('is-active', l === link));
    });
  });

  function syncSettingsNav() {
    // Esconde do menu as seções que o papel atual não pode ver.
    settingsLinks.forEach((link) => {
      const target = document.querySelector(link.getAttribute('href'));
      link.hidden = !target || target.classList.contains('is-perm-hidden');
    });
  }
  wrap('renderConfigForm', syncSettingsNav);

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = `#${entry.target.id}`;
        settingsLinks.forEach((l) => l.classList.toggle('is-active', l.getAttribute('href') === id));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    settingsLinks.forEach((link) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) io.observe(target);
    });
  }

  // Caso o app já tenha iniciado antes deste arquivo carregar.
  const current = $$('.view').find((v) => !v.hidden);
  if (current && Session.user) renderChrome(current.dataset.view);
})();
