/* ===================================================================
   BINGO — recursos extras
   Privacidade (LGPD), registro de atividades, QR Code do telão e da
   "Minha cartela", locução, relatórios (CSV/impressão) e os desenhos
   dos formatos de vitória. Carregado depois de js/ui.js; só usa as
   funções globais de lá e de js/state.js / js/api.js.
=================================================================== */
(function () {
  const wrapFn = (name, after) => {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) {
      const result = original.apply(this, args);
      try { after(...args); } catch (e) { console.error('[extras]', name, e); }
      return result;
    };
  };

  function downloadBlob(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const today = () => new Date().toISOString().slice(0, 10);

  /* ---------------- Formatos de vitória (mini desenho 5x5) ---------------- */
  $$('.pattern-mini').forEach((el) => {
    const def = PATTERNS[el.dataset.pattern];
    if (!def) return;
    const on = new Set(def.cells.map(([r, c]) => r * 5 + c));
    el.innerHTML = Array.from({ length: 25 }, (_, i) => `<b class="${on.has(i) ? 'on' : ''}"></b>`).join('');
  });

  /* ---------------- Locução ---------------- */
  $('#btnTestVoice').addEventListener('click', () => {
    if (!Voice.supported()) { showToast('Este navegador não tem voz disponível.'); return; }
    Voice.number(42, 'N');
  });

  // Anuncia o ganhador por voz no aparelho do operador ao confirmar.
  wrapFn('confirmAchievement', (cardId, key, prize) => {
    const v = Store.config.voice || {};
    if (!v.operador || !v.ganhador) return;
    const card = Store.cards.find((c) => c.id === cardId);
    const a = card && card.achievements.find((x) => x.key === key);
    if (card && a) Voice.winner(card.name, a.label, prize);
  });

  /* ---------------- Links, QR Code e menu do telão ---------------- */
  // Links públicos (sem login). "part" = modo participante do telão:
  // sem QR Code e sem voz, ideal para o celular de quem acompanha.
  function publicUrl(page, extra) {
    const uid = Session.viewingUserId || (Session.user && Session.user.id);
    const url = new URL(page, window.location.href);
    url.search = `?u=${encodeURIComponent(uid || '')}${extra ? '&' + extra : ''}`;
    return url.href;
  }
  const telaoLink = () => publicUrl('display.html');
  const followLink = () => publicUrl('display.html', 'm=part');
  const cardLink = () => publicUrl('cartela.html');

  function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(okMessage);
    } catch (e) {
      // Sem permissão de área de transferência (comum em http/IP): mostra o link para copiar à mão.
      window.prompt('Copie o link:', text);
    }
  }

  function openQrModal() {
    $('#qrTelao').innerHTML = qrSvg(followLink());
    $('#qrCartela').innerHTML = qrSvg(cardLink());
    $('#qrTelaoLink').value = followLink();
    $('#qrCartelaLink').value = cardLink();
    $('#qrModal').hidden = false;
  }

  const menu = $('#telaoMenu');
  const menuBtn = $('#btnTelaoMenu');

  function syncTelaoMenu() {
    const qr = Store.config.telaoQr || 'off';
    const radio = document.querySelector(`input[name="telaoQr"][value="${qr}"]`);
    if (radio) radio.checked = true;
    $('#menuVoiceTelao').checked = !!(Store.config.voice && Store.config.voice.telao);
    $('#menuOpenDisplay').href = telaoLink();
  }
  function setTelaoMenu(open) {
    if (open) syncTelaoMenu();
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setTelaoMenu(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !$('#telaoSplit').contains(e.target)) setTelaoMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setTelaoMenu(false); menuBtn.focus(); } });
  $('#menuOpenDisplay').addEventListener('click', () => setTelaoMenu(false));

  $('#btnCopyTelaoLink').addEventListener('click', () => { setTelaoMenu(false); copyText(telaoLink(), 'Link do telão copiado — cole em outra tela.'); });
  $('#btnCopyFollowLink').addEventListener('click', () => { setTelaoMenu(false); copyText(followLink(), 'Link para os participantes copiado.'); });
  $('#btnShareQr').addEventListener('click', () => { setTelaoMenu(false); openQrModal(); });

  const QR_MESSAGES = {
    off: 'QR Code removido do telão.',
    acompanhar: 'QR Code para acompanhar o sorteio aparece no telão.',
    cartela: 'QR Code da Minha cartela aparece no telão.',
    ambos: 'Os dois QR Codes aparecem no telão.',
  };
  $$('input[name="telaoQr"]').forEach((r) => r.addEventListener('change', () => {
    if (Session.isObserving()) { showToast('Somente leitura enquanto você visualiza outro usuário.'); syncTelaoMenu(); return; }
    Store.config.telaoQr = r.value;
    Store.saveConfig();
    showToast(QR_MESSAGES[r.value]);
  }));

  $('#menuVoiceTelao').addEventListener('change', (e) => {
    if (Session.isObserving()) { showToast('Somente leitura enquanto você visualiza outro usuário.'); syncTelaoMenu(); return; }
    Store.config.voice = { ...(Store.config.voice || {}), telao: e.target.checked };
    Store.saveConfig();
    showToast(e.target.checked ? 'Voz do telão ligada — toque em "ativar a voz" na tela do telão.' : 'Voz do telão desligada.');
  });

  $$('[data-close-qr]').forEach((el) => el.addEventListener('click', () => { $('#qrModal').hidden = true; }));
  $$('[data-copy]').forEach((btn) => btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.copy);
    copyText(input.value, 'Link copiado.');
  }));

  /* ---------------- Voz do operador: botão rápido ---------------- */
  function renderVoiceChip() {
    const on = !!(Store.config.voice && Store.config.voice.operador);
    const btn = $('#btnToggleVoice');
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    $('#voiceLabel').textContent = on ? 'Voz: ligada' : 'Voz: desligada';
  }
  wrapFn('renderSorteio', renderVoiceChip);

  $('#btnToggleVoice').addEventListener('click', () => {
    if (Session.isObserving()) { showToast('Somente leitura enquanto você visualiza outro usuário.'); return; }
    if (!Voice.supported()) { showToast('Este navegador não tem voz disponível. Tente o Chrome ou o Edge.'); return; }
    const on = !(Store.config.voice && Store.config.voice.operador);
    Store.config.voice = { ...(Store.config.voice || {}), operador: on };
    Store.saveConfig();
    renderVoiceChip();
    // O toque no botão libera o áudio do navegador; já fala uma amostra.
    if (on) Voice.number(42, 'N');
    else Voice.stop();
    showToast(on ? 'Voz ligada: cada bola sorteada será narrada neste aparelho.' : 'Voz desligada.');
  });

  /* ---------------- Privacidade (LGPD) ---------------- */
  async function renderPrivacy() {
    const master = Session.isMaster();
    $('#privacyMasterFields').hidden = !master;
    $('#btnAnonymizeAll').hidden = !master;
    $('#privacySaveHint').hidden = true;
    if (!master) return;
    const p = await Api.fetchPrivacy();
    if (!p) return;
    $('#privOrgName').value = p.orgName || '';
    $('#privDpoName').value = p.dpoName || '';
    $('#privDpoEmail').value = p.dpoEmail || '';
    const radio = document.querySelector(`input[name="privTelaoName"][value="${p.telaoName}"]`);
    if (radio) radio.checked = true;
    $('#privRetention').value = String(p.retentionDays);
    $('#privAuditRetention').value = String(p.auditRetentionDays);
  }
  wrapFn('renderConfigForm', renderPrivacy);

  $('#btnSavePrivacy').addEventListener('click', async () => {
    const telao = document.querySelector('input[name="privTelaoName"]:checked');
    try {
      await Api.savePrivacy({
        orgName: $('#privOrgName').value,
        dpoName: $('#privDpoName').value,
        dpoEmail: $('#privDpoEmail').value,
        telaoName: telao ? telao.value : 'primeiro',
        retentionDays: Number($('#privRetention').value),
        auditRetentionDays: Number($('#privAuditRetention').value),
      });
      $('#privacySaveHint').hidden = false;
      showToast('Privacidade salva.');
    } catch (e) {
      showToast('Não foi possível salvar a privacidade.');
    }
  });

  $('#btnExportMyData').addEventListener('click', async () => {
    try {
      const data = await Api.exportMyData();
      downloadBlob(JSON.stringify(data, null, 2), 'application/json', `bingo-meus-dados-${today()}.json`);
      showToast('Arquivo com seus dados baixado.');
    } catch (e) {
      showToast('Não foi possível exportar seus dados.');
    }
  });

  function anonymize(scope) {
    openConfirm(
      scope === 'all' ? 'Apagar nomes de todos os usuários?' : 'Apagar nomes das partidas encerradas?',
      'Os nomes dos participantes e ganhadores das partidas já encerradas serão apagados. Números, prêmios e estatísticas continuam. Isso não pode ser desfeito.',
      async () => {
        try {
          const { count } = await Api.anonymizeParticipants(scope);
          await Store.hydrate();
          showToast(count ? `${count} nome(s) apagado(s).` : 'Não havia nomes para apagar.');
        } catch (e) {
          showToast('Não foi possível apagar os nomes.');
        }
      }
    );
  }
  $('#btnAnonymizeMine').addEventListener('click', () => anonymize('me'));
  $('#btnAnonymizeAll').addEventListener('click', () => anonymize('all'));

  /* ---------------- Registro de atividades (Master) ---------------- */
  const AUDIT_LABELS = {
    login: 'Entrou',
    login_failed: 'Tentativa de login falhou',
    logout: 'Saiu',
    password_change: 'Trocou a própria senha',
    user_create: 'Criou usuário',
    user_update: 'Alterou usuário',
    user_delete: 'Excluiu usuário',
    user_password_reset: 'Redefiniu senha de usuário',
    permissions_update: 'Alterou permissões',
    privacy_settings_update: 'Alterou privacidade',
    view_user_data: 'Visualizou dados de outro usuário',
    game_delete: 'Excluiu partida do histórico',
    game_counter_reset: 'Redefiniu contagem de jogos',
    data_export: 'Baixou os próprios dados',
    anonymize_participants: 'Apagou nomes de participantes',
  };

  function auditDetail(e) {
    const d = e.details || {};
    if (e.action === 'game_delete') return `Jogo #${d.gameId}`;
    if (e.action === 'anonymize_participants') return `${d.count || 0} nome(s) · ${d.scope === 'all' ? 'todos os usuários' : 'próprio'}`;
    if (e.action === 'user_update' && d.fields) return d.fields.join(', ');
    if (e.action === 'privacy_settings_update') return `telão: ${d.telaoName}, retenção: ${d.retentionDays ? d.retentionDays + ' dias' : 'nunca'}`;
    const u = (typeof cachedUsers !== 'undefined' ? cachedUsers : []).find((x) => x.id === e.target);
    if (u) return u.name || u.email;
    return e.target || '';
  }

  async function renderAudit() {
    const tbody = $('#auditList');
    if (!Session.isMaster()) return;
    const entries = await Api.fetchAudit(150);
    tbody.innerHTML = entries.length
      ? entries.map((e) => `
          <tr class="${e.action === 'login_failed' ? 'is-warn' : ''}">
            <td>${escapeHtml(formatDateTime(e.at))}</td>
            <td>${escapeHtml(e.actorEmail || '—')}</td>
            <td>${escapeHtml(AUDIT_LABELS[e.action] || e.action)}</td>
            <td>${escapeHtml(auditDetail(e))}</td>
            <td class="muted">${escapeHtml(e.ip || '')}</td>
          </tr>`).join('')
      : '<tr><td colspan="5" class="empty-hint">Nenhuma atividade registrada ainda.</td></tr>';
  }
  wrapFn('switchView', (name) => { if (name === 'usuarios') renderAudit(); });
  $('#btnRefreshAudit').addEventListener('click', renderAudit);

  /* ---------------- Relatórios ---------------- */
  function reportRows(includeNames) {
    const rows = [];
    for (const g of Store.history) {
      const base = {
        jogo: g.gameId,
        inicio: g.startedAt ? formatDateTime(g.startedAt) : '',
        fim: g.endedAt ? formatDateTime(g.endedAt) : '',
        duracao: formatGameDuration(g),
        bolas: (g.drawnNumbers || []).length,
        cartelas: g.cardsCount || 0,
      };
      const winners = g.winners || [];
      if (!winners.length) rows.push({ ...base, ganhador: '', cartela: '', criterio: '', premio: '', confirmado: '' });
      for (const w of winners) {
        rows.push({
          ...base,
          ganhador: includeNames ? (w.name || (w.anonymized ? '(nome apagado)' : '')) : '',
          cartela: w.cardNumber || '',
          criterio: w.criterion || '',
          premio: w.prize || '',
          confirmado: w.confirmed ? 'Sim' : 'Não',
        });
      }
    }
    return rows;
  }

  const CSV_HEADERS = [
    ['jogo', 'Jogo'], ['inicio', 'Início'], ['fim', 'Fim'], ['duracao', 'Duração'], ['bolas', 'Bolas sorteadas'],
    ['cartelas', 'Cartelas em jogo'], ['ganhador', 'Ganhador'], ['cartela', 'Cartela nº'], ['criterio', 'Critério'],
    ['premio', 'Prêmio'], ['confirmado', 'Confirmado'],
  ];

  $('#btnExportCsv').addEventListener('click', () => {
    if (!Store.history.length) { showToast('Ainda não há partidas encerradas.'); return; }
    const includeNames = $('#reportIncludeNames').checked;
    const esc = (v) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [CSV_HEADERS.map(([, h]) => h).join(';')];
    for (const r of reportRows(includeNames)) lines.push(CSV_HEADERS.map(([k]) => esc(r[k])).join(';'));
    // BOM + ";" = abre certinho no Excel em português.
    downloadBlob('﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8', `bingo-relatorio-${today()}.csv`);
  });

  $('#btnPrintReport').addEventListener('click', () => {
    if (!Store.history.length) { showToast('Ainda não há partidas encerradas.'); return; }
    const includeNames = $('#reportIncludeNames').checked;
    const stats = dashboardStats();
    const rows = reportRows(includeNames);
    const appName = (Store.config.branding && Store.config.branding.appName) || 'Bingo';
    const operator = Session.user ? (Session.user.name || Session.user.email) : '';
    $('#printArea').innerHTML = `
      <section class="report">
        <header class="report__head">
          <h1>${escapeHtml(appName)} — Relatório de partidas</h1>
          <p>Gerado em ${escapeHtml(formatDateTime(new Date().toISOString()))}${operator ? ' por ' + escapeHtml(operator) : ''}</p>
        </header>
        <div class="report__stats">
          <div><strong>${stats.totalGames}</strong><span>partidas</span></div>
          <div><strong>${escapeHtml(formatDurationMs(stats.avgDurationMs))}</strong><span>duração média</span></div>
          <div><strong>${stats.totalCards}</strong><span>cartelas em jogo</span></div>
          <div><strong>${stats.totalConfirmedPrizes}</strong><span>prêmios confirmados</span></div>
        </div>
        <table class="report__table">
          <thead><tr>${CSV_HEADERS.filter(([k]) => includeNames || k !== 'ganhador').map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((r) => `<tr>${CSV_HEADERS.filter(([k]) => includeNames || k !== 'ganhador').map(([k]) => `<td>${escapeHtml(String(r[k] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
        <p class="report__foot">${includeNames ? 'Contém nomes de participantes (dado pessoal, LGPD): compartilhe só com quem precisa.' : 'Relatório sem nomes de participantes.'}</p>
      </section>`;
    window.print();
  });
})();
