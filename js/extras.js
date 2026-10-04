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

  /* ---------------- QR Code ---------------- */
  function publicUrl(page) {
    const uid = Session.viewingUserId || (Session.user && Session.user.id);
    const base = new URL(page, window.location.href);
    base.search = `?u=${encodeURIComponent(uid || '')}`;
    return base.href;
  }

  function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function openQrModal() {
    const telao = publicUrl('display.html');
    const cartela = publicUrl('cartela.html');
    $('#qrTelao').innerHTML = qrSvg(telao);
    $('#qrCartela').innerHTML = qrSvg(cartela);
    $('#qrTelaoLink').value = telao;
    $('#qrCartelaLink').value = cartela;
    $('#qrModal').hidden = false;
  }
  $('#btnShareQr').addEventListener('click', openQrModal);
  $$('[data-close-qr]').forEach((el) => el.addEventListener('click', () => { $('#qrModal').hidden = true; }));
  $$('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const input = document.getElementById(btn.dataset.copy);
    try {
      await navigator.clipboard.writeText(input.value);
      showToast('Link copiado.');
    } catch (e) {
      input.select();
      showToast('Selecione e copie o link.');
    }
  }));

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
