/* ===================================================================
   BINGO — interface: navegação, renderização e eventos
=================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let winnerQueue = [];
let cardGridCells = []; // [[{el, isFree}]]
let confirmCallback = null;

/* ---------------- Toast ---------------- */
let toastTimer = null;
function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------- Navigation ---------------- */
function switchView(name) {
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('.bottom-nav__item, .side-nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === name));
  if (name === 'sorteio') renderSorteio();
  if (name === 'cartelas') renderCartelas();
  if (name === 'historico') renderHistorico();
  if (name === 'dashboard') renderDashboard();
  if (name === 'config') renderConfigForm();
}

$$('.bottom-nav__item, .side-nav__item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.nav));
});

/* ---------------- Desktop sidebar (collapse/expand) ---------------- */
const SIDEBAR_COLLAPSED_KEY = 'bingo_sidebar_collapsed_v1';

function applySidebarState() {
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  $('#sideNav').classList.toggle('is-collapsed', collapsed);
  $('#sideNavToggle').textContent = collapsed ? '›' : '‹';
}

$('#sideNavToggle').addEventListener('click', () => {
  const collapsed = $('#sideNav').classList.toggle('is-collapsed');
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  $('#sideNavToggle').textContent = collapsed ? '›' : '‹';
});

applySidebarState();

/* ---------------- Fullscreen draw display (separate window/tab) ----------------
   On the real deployed site this just opens the sibling display.html file.
   The single-file Artifact bundle has no second file to link to, so its
   build embeds the same page's markup as window.BINGO_DISPLAY_HTML and
   this opens it from a Blob URL instead — same shared code either way. */
$('#btnOpenDisplay').addEventListener('click', () => {
  if (window.BINGO_DISPLAY_HTML) {
    const blob = new Blob([window.BINGO_DISPLAY_HTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
  } else {
    window.open('display.html', '_blank', 'noopener');
  }
});

/* ---------------- Confirm dialog ---------------- */
function openConfirm(title, message, onConfirm) {
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  confirmCallback = onConfirm;
  $('#confirmModal').hidden = false;
}
$('#confirmCancel').addEventListener('click', () => { $('#confirmModal').hidden = true; confirmCallback = null; });
$('#confirmOk').addEventListener('click', () => {
  $('#confirmModal').hidden = true;
  const cb = confirmCallback;
  confirmCallback = null;
  if (cb) cb();
});

/* ================================================================
   SORTEIO
================================================================ */

function renderSorteio() {
  $('#gameLabel').textContent = `Jogo #${Store.game.id}`;

  const last = Store.game.drawnNumbers[Store.game.drawnNumbers.length - 1];
  $('#currentBallLetter').textContent = last !== undefined ? letterForNumber(last) : '-';
  $('#currentBallNumber').textContent = last !== undefined ? last : '--';

  const total = Store.config.max - Store.config.min + 1;
  $('#drawStats').textContent = `${Store.game.drawnNumbers.length} de ${total} números sorteados`;

  renderLastBalls();
  renderDrawBoard();
  renderActiveCardsSummary();
  renderCriteriaFlags();
  renderNearMisses();
  renderPrizes();
  renderPendingPrizes();

  const noMore = availableNumbers().length === 0;
  $('#btnSortear').disabled = noMore;
  $('#btnSortear').textContent = noMore ? 'Todos os números já saíram' : 'Sortear número';
  $('#btnMarcarManual').disabled = noMore;
}

/**
 * The prize list is registered ahead of time (there can be more than
 * one prize on the table in the same round — 1º prêmio, 2º prêmio, a
 * raffle item) instead of being retyped at confirmation time. Clicking
 * a chip makes it "active"; that's the prize name confirmAchievement()
 * gets called with, whether confirming one card or several at once.
 */
let activePrizeName = '';

function renderPrizes() {
  const prizes = gamePrizes();
  if (!prizes.includes(activePrizeName)) activePrizeName = prizes[0] || '';

  $('#prizeList').innerHTML = prizes.length
    ? prizes.map((p) => `
        <div class="prize-chip ${p === activePrizeName ? 'is-active' : ''}" data-prize="${escapeHtml(p)}">
          <button type="button" class="prize-chip__select" data-select-prize-name>${p === activePrizeName ? '✓ ' : ''}${escapeHtml(p)}</button>
          <button type="button" class="prize-chip__remove" data-remove-prize aria-label="Remover prêmio">✕</button>
        </div>`).join('')
    : '<span class="empty-hint">Nenhum prêmio cadastrado ainda.</span>';

  $('#prizeActiveHint').textContent = activePrizeName
    ? `Vinculando ao prêmio selecionado: ${activePrizeName}`
    : (prizes.length ? 'Toque em um prêmio acima para selecioná-lo.' : 'Cadastre um prêmio para vincular aos ganhadores (opcional).');
}

$('#btnAddPrize').addEventListener('click', () => {
  const name = $('#prizeNameInput').value.trim();
  if (!name) { showToast('Digite o nome do prêmio.'); return; }
  if (!addPrize(name)) { showToast('Esse prêmio já está cadastrado.'); return; }
  activePrizeName = name;
  $('#prizeNameInput').value = '';
  renderPrizes();
  showToast('Prêmio adicionado.');
});

$('#prizeNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#btnAddPrize').click(); }
});

$('#prizeList').addEventListener('click', (e) => {
  const selectBtn = e.target.closest('[data-select-prize-name]');
  if (selectBtn) {
    activePrizeName = selectBtn.closest('[data-prize]').dataset.prize;
    renderPrizes();
    return;
  }
  const removeBtn = e.target.closest('[data-remove-prize]');
  if (removeBtn) {
    const name = removeBtn.closest('[data-prize]').dataset.prize;
    removePrize(name);
    if (activePrizeName === name) activePrizeName = '';
    renderPrizes();
  }
});

/**
 * A checkbox per active winning criterion, right by the number panel,
 * so the operator can "dar baixa" (close) a prize the moment it's been
 * awarded — without ending the whole game — and stop that criterion
 * from generating (or still showing) any further claims for the rest
 * of the round.
 */
function renderCriteriaFlags() {
  const keys = activeCriteriaKeys();
  $('#criteriaFlagsCard').hidden = keys.length === 0;
  $('#criteriaFlagsList').innerHTML = keys
    .map((key) => `
      <label class="field field--check">
        <input type="checkbox" data-criterion-flag="${key}" ${isCriterionClosed(key) ? 'checked' : ''}>
        <span>${escapeHtml(criterionLabel(key))}${isCriterionClosed(key) ? ' — baixado' : ''}</span>
      </label>`)
    .join('');
}

$('#criteriaFlagsList').addEventListener('change', (e) => {
  const input = e.target.closest('[data-criterion-flag]');
  if (!input) return;
  setCriterionClosed(input.dataset.criterionFlag, input.checked);
  renderSorteio();
  showToast(input.checked ? 'Critério baixado — não aparecerá mais nos painéis.' : 'Critério reaberto.');
});

function renderNearMisses() {
  const misses = findNearMisses();
  const cardCount = distinctNearMissCardCount();

  $('#nearMissCount').textContent = cardCount;
  $('#nearMissCard').hidden = misses.length === 0;
  $('#nearMissList').innerHTML = misses
    .map((m) => `
      <div class="card-item">
        <div>
          <div class="card-item__name">${escapeHtml(m.card.name)}</div>
          <div class="card-item__meta">Concorrendo: ${escapeHtml(m.label)} · falta o <strong>${m.neededNumber}</strong> (${letterForNumber(m.neededNumber)})</div>
        </div>
      </div>`)
    .join('');

  const stat = $('#nearMissStat');
  stat.hidden = cardCount === 0;
  stat.textContent = cardCount > 0 ? `${cardCount} cartela${cardCount > 1 ? 's' : ''} a 1 número de ganhar` : '';
}

function renderPendingPrizes() {
  const pending = pendingAchievements();
  const expired = expiredAchievements();

  $('#pendingPrizesCard').hidden = pending.length === 0 && expired.length === 0;

  $('#pendingPrizesWrap').hidden = pending.length === 0;
  $('#pendingPrizesCount').textContent = pending.length;
  $('#pendingPrizesList').innerHTML = pending
    .map((p) => `
      <div class="card-item is-winner">
        <div class="card-item__main">
          <label class="card-item__check">
            <input type="checkbox" data-select-prize data-card-id="${p.card.id}" data-key="${p.key}">
          </label>
          <div>
            <div class="card-item__name">${escapeHtml(p.card.name)}</div>
            <div class="card-item__meta">Concorrendo: ${escapeHtml(p.label)} · completou com a bola nº ${p.drawIndex} (${p.drawnNumber})${cardNumberSuffix(p.card)}</div>
          </div>
        </div>
        <button class="btn btn--secondary btn--small" data-confirm-prize data-card-id="${p.card.id}" data-key="${p.key}">Confirmar</button>
      </div>`)
    .join('');
  $('#btnConfirmSelectedPrizes').hidden = true;

  $('#expiredPrizesWrap').hidden = expired.length === 0;
  $('#expiredPrizesCount').textContent = expired.length;
  $('#expiredPrizesList').innerHTML = expired
    .map((p) => `
      <div class="card-item card-item--expired">
        <div>
          <div class="card-item__name">${escapeHtml(p.card.name)}</div>
          <div class="card-item__meta">${escapeHtml(p.label)} · bola nº ${p.drawIndex} (${p.drawnNumber}) · passou batido, não vale mais</div>
        </div>
      </div>`)
    .join('');
}

$('#pendingPrizesList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-confirm-prize]');
  if (!btn) return;
  confirmAchievement(btn.dataset.cardId, btn.dataset.key, activePrizeName);
  renderSorteio();
  showToast('Prêmio confirmado.');
});

$('#pendingPrizesList').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-select-prize]');
  if (!cb) return;
  $('#btnConfirmSelectedPrizes').hidden = $$('[data-select-prize]:checked', $('#pendingPrizesList')).length === 0;
});

$('#btnConfirmSelectedPrizes').addEventListener('click', () => {
  const checked = $$('[data-select-prize]:checked', $('#pendingPrizesList'));
  if (checked.length === 0) return;
  checked.forEach((cb) => confirmAchievement(cb.dataset.cardId, cb.dataset.key, activePrizeName));
  renderSorteio();
  showToast(`${checked.length} prêmio(s) confirmado(s)${activePrizeName ? ' — ' + activePrizeName : ''}.`);
});

function renderLastBalls() {
  const row = $('#lastBallsRow');
  const n = Store.config.lastCount || 15;
  const nums = Store.game.drawnNumbers.slice(-n).reverse();
  if (nums.length === 0) {
    row.innerHTML = '<span class="empty-hint">Nenhum número sorteado ainda.</span>';
    return;
  }
  row.innerHTML = nums
    .map((num, i) => `
      <div class="chip ${i === 0 ? 'chip--latest' : ''}">
        <small>${letterForNumber(num)}</small>${num}
      </div>`)
    .join('');
}

/**
 * Each letter is rendered as its own row/column group (label + that
 * letter's numbers) rather than one flat grid, so CSS alone can reflow
 * the same markup into the classic side-by-side "bingo card" columns
 * on mobile, or into wide horizontal rows (one per letter) on desktop
 * — no JS branching needed for the different screen shapes.
 */
function renderDrawBoard() {
  const board = $('#drawBoard');
  const { min, max } = Store.config;
  const ranges = getColumnRanges(min, max);
  const drawnSet = new Set(Store.game.drawnNumbers);

  let html = '';
  for (let col = 0; col < 5; col++) {
    const [s, e] = ranges[col];
    let numsHtml = '';
    for (let num = s; num <= e; num++) {
      const drawn = drawnSet.has(num);
      numsHtml += `<div class="board-num ${drawn ? 'is-drawn' : ''}" data-num="${num}">${num}</div>`;
    }
    html += `
      <div class="board-row">
        <div class="board-row__label">${LETTERS[col]}</div>
        <div class="board-row__nums">${numsHtml}</div>
      </div>`;
  }
  board.innerHTML = html;
}

$('#drawBoard').addEventListener('click', (e) => {
  const el = e.target.closest('[data-num]');
  if (!el) return;
  if (!manualModeActive) {
    showToast('Ative o modo Manual para marcar números diretamente no painel.');
    return;
  }
  const num = Number(el.dataset.num);
  if (Store.game.drawnNumbers.includes(num)) {
    showToast('Esse número já foi sorteado.');
    return;
  }
  markNumberManually(num);
  afterNumberDrawn();
});

function achievementSummary(achievements) {
  return achievements.map((a) => {
    const icon = a.confirmed ? '✅' : a.expired ? '❌' : '⏳';
    const prize = a.confirmed && a.prize ? ` (${a.prize})` : '';
    return `${icon} ${a.label}${prize}`;
  }).join(', ');
}

function renderActiveCardsSummary() {
  const cards = activeCards();
  $('#activeCardsCount').textContent = cards.length;
  const wrap = $('#activeCardsSummary');
  if (cards.length === 0) {
    wrap.innerHTML = '<span class="empty-hint">Nenhuma cartela cadastrada para este jogo. Vá em "Cartelas" para escanear.</span>';
    return;
  }
  wrap.innerHTML = cards
    .map((c) => {
      const markedCount = c.grid.flat().filter((cell) => cell.marked).length;
      const total = c.grid.flat().length;
      const won = c.achievements.length > 0;
      return `
        <div class="card-item ${won ? 'is-winner' : ''}">
          <div>
            <div class="card-item__name">${escapeHtml(c.name)}</div>
            <div class="card-item__meta">${markedCount}/${total} marcados${cardNumberSuffix(c)}${won ? ' · ' + achievementSummary(c.achievements) : ''}</div>
          </div>
        </div>`;
    })
    .join('');
}

/**
 * Bounces the ball, re-renders the sorteio screen and checks for new
 * winners — shared by the random draw and by manually recording a
 * number called from a physical globe, since both should behave
 * identically from that point on.
 */
function afterNumberDrawn() {
  const ball = $('#currentBall');
  ball.classList.remove('is-bouncing');
  void ball.offsetWidth;
  ball.classList.add('is-bouncing');

  renderSorteio();

  const winners = evaluateAllActiveCards();
  if (winners.length) {
    winnerQueue.push(...winners);
    showNextWinner();
    renderActiveCardsSummary();
    renderPendingPrizes();
  }
}

$('#btnSortear').addEventListener('click', () => {
  if (manualModeActive) setManualMode(false);
  const num = drawNumber();
  if (num === null) { showToast('Todos os números já foram sorteados.'); return; }
  afterNumberDrawn();
});

/**
 * The "Manual" button doesn't open a dialog — it just toggles a mode
 * that lets the operator mark numbers by tapping them directly on the
 * "Painel de números" below, for when a physical bingo globe/cage is
 * calling the numbers instead of the app's own random draw.
 */
let manualModeActive = false;
function setManualMode(active) {
  manualModeActive = active;
  $('#btnMarcarManual').classList.toggle('is-active', active);
  $('#btnMarcarManual').textContent = active ? 'Manual ✓' : 'Manual';
  $('#manualModeHint').hidden = !active;
  $('#drawBoard').closest('.card').classList.toggle('is-manual-target', active);
}

$('#btnMarcarManual').addEventListener('click', () => {
  setManualMode(!manualModeActive);
});

function showNextWinner() {
  if ($('#winnerModal').hidden === false) return;
  const next = winnerQueue.shift();
  if (!next) return;
  $('#winnerName').textContent = next.card.name;
  $('#winnerReason').textContent = `Critério: ${next.label}`;
  $('#winnerModal').hidden = false;
}
$('#btnCloseWinner').addEventListener('click', () => {
  $('#winnerModal').hidden = true;
  setTimeout(showNextWinner, 250);
});

$('#btnEncerrar').addEventListener('click', () => {
  if (Store.game.drawnNumbers.length === 0 && activeCards().length === 0) {
    showToast('Não há jogo em andamento para encerrar.');
    return;
  }
  openConfirm(
    'Encerrar jogo?',
    'As cartelas desta partida serão arquivadas e não poderão ser reutilizadas. Um novo jogo será iniciado.',
    () => {
      endGame();
      renderSorteio();
      renderCartelas();
      showToast('Jogo encerrado. Cartelas arquivadas.');
    }
  );
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ================================================================
   CARTELAS
================================================================ */

function cardNumberSuffix(c) {
  return c.cardNumber ? ` · Cartela nº ${escapeHtml(c.cardNumber)}` : '';
}

function renderCartelas() {
  renderEstoque();

  const active = activeCards();
  $('#cartelasAtivasCount').textContent = active.length;
  const list = $('#cartelasAtivasList');
  list.innerHTML = active.length
    ? active.map((c) => `
        <div class="card-item ${c.achievements.length ? 'is-winner' : ''}" data-card-id="${c.id}">
          <div>
            <div class="card-item__name">${escapeHtml(c.name)}</div>
            <div class="card-item__meta">Jogo #${c.gameId}${cardNumberSuffix(c)}${c.achievements.length ? ' · ' + achievementSummary(c.achievements) : ''}</div>
          </div>
          <button class="card-item__delete" data-delete-card aria-label="Excluir cartela">🗑️</button>
        </div>`).join('')
    : '<span class="empty-hint">Nenhuma cartela ativa.</span>';

  const used = Store.cards.filter((c) => c.status === 'used');
  const hist = $('#cartelasHistoricoList');
  hist.innerHTML = used.length
    ? used.slice().reverse().map((c) => `
        <div class="card-item is-used" data-card-id="${c.id}">
          <div>
            <div class="card-item__name">${escapeHtml(c.name)}</div>
            <div class="card-item__meta">Jogo #${c.gameId}${cardNumberSuffix(c)} · ${c.achievements.length ? achievementSummary(c.achievements) : 'sem vitória'}</div>
          </div>
          <button class="card-item__delete" data-delete-card aria-label="Excluir cartela">🗑️</button>
        </div>`).join('')
    : '<span class="empty-hint">Nenhum histórico ainda.</span>';
}

let assigningCardId = null;

/**
 * The stock list is meant to hold hundreds/thousands of pre-registered
 * cards (a whole manufacturer batch imported via CSV), so it can't be
 * rendered as one long DOM list — that's what made the print button
 * unreachable after importing 1000 cards. It's browsed in fixed-size
 * blocks instead, filterable by the printed card number, with a
 * selection that survives page changes so "select all" + bulk delete
 * can act on every match, not just the ones currently on screen.
 */
const ESTOQUE_PAGE_SIZE = 50;
let estoqueSearchQuery = '';
let estoquePage = 1;
let estoqueSelected = new Set();

function filteredStockCards() {
  const stock = stockCards();
  const query = estoqueSearchQuery.trim().toLowerCase();
  if (!query) return stock;
  return stock.filter((c) => (c.cardNumber || '').toLowerCase().includes(query));
}

function updateEstoqueSelectionUi(filtered) {
  const list = filtered || filteredStockCards();
  $('#estoqueBulkBar').hidden = estoqueSelected.size === 0;
  $('#estoqueBulkCount').textContent = estoqueSelected.size;
  const selectAll = $('#estoqueSelectAll');
  selectAll.checked = list.length > 0 && list.every((c) => estoqueSelected.has(c.id));
}

function renderEstoque() {
  const all = stockCards();
  const validIds = new Set(all.map((c) => c.id));
  for (const id of Array.from(estoqueSelected)) if (!validIds.has(id)) estoqueSelected.delete(id);

  const filtered = filteredStockCards();
  const totalPages = Math.max(1, Math.ceil(filtered.length / ESTOQUE_PAGE_SIZE));
  if (estoquePage > totalPages) estoquePage = totalPages;
  const start = (estoquePage - 1) * ESTOQUE_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + ESTOQUE_PAGE_SIZE);

  $('#estoqueCount').textContent = all.length;
  $('#estoqueList').innerHTML = pageItems.length
    ? pageItems.map((c) => `
        <div class="card-item" data-card-id="${c.id}">
          <div class="card-item__main">
            <label class="card-item__check">
              <input type="checkbox" data-select-card ${estoqueSelected.has(c.id) ? 'checked' : ''}>
            </label>
            <div>
              <div class="card-item__name">${c.cardNumber ? 'Cartela nº ' + escapeHtml(c.cardNumber) : 'Cartela sem número'}</div>
              <div class="card-item__meta">Aguardando entrega</div>
            </div>
          </div>
          <div class="card-item__actions">
            <button class="btn btn--secondary btn--small" data-assign-card>Entregar</button>
            <button class="card-item__delete" data-delete-card aria-label="Excluir cartela">🗑️</button>
          </div>
        </div>`).join('')
    : `<span class="empty-hint">${estoqueSearchQuery ? 'Nenhuma cartela encontrada para essa busca.' : 'Nenhuma cartela em estoque.'}</span>`;

  $('#estoquePagination').hidden = filtered.length <= ESTOQUE_PAGE_SIZE;
  $('#estoquePageInfo').textContent = `Página ${estoquePage} de ${totalPages} · ${filtered.length} cartela(s)`;
  $('#estoquePrev').disabled = estoquePage <= 1;
  $('#estoqueNext').disabled = estoquePage >= totalPages;

  updateEstoqueSelectionUi(filtered);
}

$('#estoqueSearchInput').addEventListener('input', (e) => {
  estoqueSearchQuery = e.target.value;
  estoquePage = 1;
  renderEstoque();
});

$('#estoquePrev').addEventListener('click', () => { estoquePage--; renderEstoque(); });
$('#estoqueNext').addEventListener('click', () => { estoquePage++; renderEstoque(); });

$('#estoqueSelectAll').addEventListener('change', (e) => {
  const filtered = filteredStockCards();
  if (e.target.checked) filtered.forEach((c) => estoqueSelected.add(c.id));
  else filtered.forEach((c) => estoqueSelected.delete(c.id));
  renderEstoque();
});

$('#estoqueList').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-select-card]');
  if (!cb) return;
  const item = e.target.closest('[data-card-id]');
  if (cb.checked) estoqueSelected.add(item.dataset.cardId);
  else estoqueSelected.delete(item.dataset.cardId);
  updateEstoqueSelectionUi();
});

$('#btnDeleteSelectedEstoque').addEventListener('click', () => {
  const count = estoqueSelected.size;
  if (count === 0) return;
  openConfirm(
    'Excluir cartelas selecionadas?',
    `${count} cartela(s) do estoque serão excluídas permanentemente. Essa ação não pode ser desfeita.`,
    () => {
      deleteCards(Array.from(estoqueSelected));
      estoqueSelected.clear();
      renderCartelas();
      renderSorteio();
      showToast(`${count} cartela(s) excluída(s).`);
    }
  );
});

function openAssignModal(card) {
  assigningCardId = card.id;
  $('#assignCardMeta').textContent = card.cardNumber ? `Cartela nº ${card.cardNumber}` : 'Cartela sem número registrado';
  $('#assignNameInput').value = '';
  $('#assignNameModal').hidden = false;
  setTimeout(() => $('#assignNameInput').focus(), 50);
}

$('#estoqueList').addEventListener('click', (e) => {
  const assignBtn = e.target.closest('[data-assign-card]');
  if (assignBtn) {
    const item = e.target.closest('[data-card-id]');
    const card = Store.cards.find((c) => c.id === item.dataset.cardId);
    if (card) openAssignModal(card);
    return;
  }
  handleCardListClick(e);
});

$$('[data-close-assign-modal]').forEach((el) => el.addEventListener('click', () => {
  $('#assignNameModal').hidden = true;
  assigningCardId = null;
}));

$('#assignNameConfirm').addEventListener('click', () => {
  const name = $('#assignNameInput').value.trim();
  if (!name) { showToast('Informe o nome do participante.'); return; }
  if (!assigningCardId) { $('#assignNameModal').hidden = true; return; }
  assignCardName(assigningCardId, name);
  $('#assignNameModal').hidden = true;
  assigningCardId = null;
  showToast('Cartela entregue!');
  renderCartelas();
  renderSorteio();
});

function handleCardListClick(e) {
  const btn = e.target.closest('[data-delete-card]');
  if (!btn) return;
  const item = e.target.closest('[data-card-id]');
  const id = item.dataset.cardId;
  const card = Store.cards.find((c) => c.id === id);
  if (!card) return;
  const label = card.name || (card.cardNumber ? `nº ${card.cardNumber}` : 'sem nome');
  openConfirm(
    'Excluir cartela?',
    `A cartela de ${label} será excluída permanentemente. Essa ação não pode ser desfeita.`,
    () => {
      deleteCard(id);
      renderCartelas();
      renderSorteio();
      showToast('Cartela excluída.');
    }
  );
}
$('#cartelasAtivasList').addEventListener('click', handleCardListClick);
$('#cartelasHistoricoList').addEventListener('click', handleCardListClick);

$('#toggleHistorico').addEventListener('click', () => {
  const list = $('#cartelasHistoricoList');
  const chevron = $('#toggleHistorico .chevron');
  list.hidden = !list.hidden;
  chevron.classList.toggle('is-open', !list.hidden);
});

$('#btnReiniciarCartelas').addEventListener('click', () => {
  if (Store.cards.length === 0) {
    showToast('Não há cartelas cadastradas.');
    return;
  }
  openConfirm(
    'Reiniciar cartelas?',
    'Todas as cartelas cadastradas, mesmo as já usadas em jogos anteriores, voltarão para o estoque sem participante, prontas para serem entregues novamente. O jogo atual em andamento será encerrado e arquivado no histórico antes disso. Essa ação não pode ser desfeita.',
    () => {
      restartAllCards();
      renderCartelas();
      renderSorteio();
      showToast('Cartelas reiniciadas — todas voltaram para o estoque.');
    }
  );
});

/* ---------------- Card modal (scan / manual) ---------------- */

function buildLettersRow() {
  const ranges = getColumnRanges(Store.config.min, Store.config.max);
  $('#lettersRow').innerHTML = LETTERS
    .map((l, i) => `<div>${l}<br><small>${ranges[i][0]}–${ranges[i][1]}</small></div>`)
    .join('');
}

function buildCardGridInputs() {
  const wrap = $('#cardGridInputs');
  wrap.innerHTML = '';
  cardGridCells = [];
  const freeCenter = Store.config.freeCenter;
  for (let r = 0; r < 5; r++) {
    const row = [];
    for (let c = 0; c < 5; c++) {
      if (freeCenter && r === 2 && c === 2) {
        const div = document.createElement('div');
        div.className = 'free-cell';
        div.textContent = 'LIVRE';
        wrap.appendChild(div);
        row.push({ el: null, isFree: true });
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.maxLength = 3;
        input.dataset.r = r;
        input.dataset.c = c;
        wrap.appendChild(input);
        row.push({ el: input, isFree: false });
      }
    }
    cardGridCells.push(row);
  }
}

function fillGridFromCells(recognizedGrid) {
  let count = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = cardGridCells[r][c];
      if (cell.isFree) continue;
      const value = recognizedGrid[r][c];
      cell.el.value = value !== null && value !== undefined ? value : '';
      if (value !== null && value !== undefined) count++;
    }
  }
  return count;
}

/**
 * Every column has a fixed valid range (B 1-15, I 16-30, N 31-45, G
 * 46-60, O 61-75, or the equivalent split for a custom configured
 * range) — a recognized or typed number that falls outside its own
 * column's range is definitely wrong and must never be silently
 * accepted, since OCR misreads (and typos) are common.
 */
function invalidCellsInGrid() {
  const ranges = getColumnRanges(Store.config.min, Store.config.max);
  const invalid = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = cardGridCells[r][c];
      if (cell.isFree) continue;
      const raw = cell.el.value.trim();
      if (raw === '') continue;
      const value = Number(raw);
      if (Number.isNaN(value)) continue;
      const [min, max] = ranges[c];
      if (value < min || value > max) {
        invalid.push({ r, c, value, letter: LETTERS[c], min, max });
      }
    }
  }
  return invalid;
}

function highlightInvalidCells() {
  const invalid = invalidCellsInGrid();
  const invalidSet = new Set(invalid.map((i) => `${i.r}-${i.c}`));
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = cardGridCells[r][c];
      if (cell.isFree) continue;
      cell.el.classList.toggle('is-invalid', invalidSet.has(`${r}-${c}`));
    }
  }
  return invalid;
}

$('#cardGridInputs').addEventListener('input', () => highlightInvalidCells());

function readGridFromInputs() {
  const grid = [];
  for (let r = 0; r < 5; r++) {
    const row = [];
    for (let c = 0; c < 5; c++) {
      const cell = cardGridCells[r][c];
      if (cell.isFree) {
        row.push({ value: null, free: true, marked: true });
      } else {
        row.push({ value: cell.el.value.trim(), free: false, marked: false });
      }
    }
    grid.push(row);
  }
  return grid;
}

let currentModalMode = 'manual';
let currentPhotoDataUrl = null;

function defaultQuad() {
  return {
    nw: { x: 0.1, y: 0.1 },
    ne: { x: 0.9, y: 0.1 },
    se: { x: 0.9, y: 0.9 },
    sw: { x: 0.1, y: 0.9 },
  };
}
let quad = defaultQuad();

const CAPTURE_HINT = 'Alinhe as bordas da cartela com o quadro e as linhas guia antes de capturar.';
const REVIEW_HINT = 'Arraste cada bolinha para o canto correspondente da grade de números (sem o cabeçalho BINGO nem a borda da cartela) — funciona mesmo se a foto estiver em ângulo. Gire a foto se estiver de lado. Depois toque em "Reconhecer números".';

function showCapturePhase() {
  currentPhotoDataUrl = null;
  $('#cameraBox').hidden = false;
  $('#capturedWrap').hidden = true;
  $('#captureControls').hidden = false;
  $('#btnCapture').hidden = false;
  $('#reviewControls').hidden = true;
  $('#scanHint').textContent = CAPTURE_HINT;
  $('#ocrStatus').textContent = '';
}

function showReviewPhase() {
  $('#cameraBox').hidden = true;
  $('#capturedWrap').hidden = false;
  $('#captureControls').hidden = true;
  $('#reviewControls').hidden = false;
  $('#capturedPreview').src = currentPhotoDataUrl;
  quad = defaultQuad();
  applyQuadStyle();
  $('#scanHint').textContent = REVIEW_HINT;
}

/* ---------------- Quad corners (drag to mark the number grid) ---------------- */

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pointOnQuad(u, v) {
  const top = lerpPoint(quad.nw, quad.ne, u);
  const bottom = lerpPoint(quad.sw, quad.se, u);
  return lerpPoint(top, bottom, v);
}

function applyQuadStyle() {
  const poly = $('#quadPolygon');
  poly.setAttribute('points', ['nw', 'ne', 'se', 'sw'].map((k) => `${quad[k].x * 100},${quad[k].y * 100}`).join(' '));

  const lines = [];
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const a = pointOnQuad(t, 0);
    const b = pointOnQuad(t, 1);
    lines.push(`<line x1="${a.x * 100}" y1="${a.y * 100}" x2="${b.x * 100}" y2="${b.y * 100}" />`);
    const c = pointOnQuad(0, t);
    const d = pointOnQuad(1, t);
    lines.push(`<line x1="${c.x * 100}" y1="${c.y * 100}" x2="${d.x * 100}" y2="${d.y * 100}" />`);
  }
  $('#quadGridLines').innerHTML = lines.join('');

  $$('.quad-handle').forEach((handle) => {
    const corner = quad[handle.dataset.corner];
    handle.style.left = corner.x * 100 + '%';
    handle.style.top = corner.y * 100 + '%';
  });
}

function setupQuadInteractions() {
  const wrap = $('#capturedWrap');

  $$('.quad-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const corner = handle.dataset.corner;
      const bounds = wrap.getBoundingClientRect();

      function onPointerMove(ev) {
        const x = Math.min(Math.max((ev.clientX - bounds.left) / bounds.width, 0), 1);
        const y = Math.min(Math.max((ev.clientY - bounds.top) / bounds.height, 0), 1);
        quad[corner] = { x, y };
        applyQuadStyle();
      }
      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  });
}

function openCardModal(mode) {
  currentModalMode = mode;
  $('#cardModalTitle').textContent = mode === 'scan' ? 'Escanear cartela' : 'Cadastrar cartela manualmente';
  $('#cardParticipant').value = '';
  $('#cardNumberInput').value = '';
  $('#scanSection').hidden = mode !== 'scan';
  showCapturePhase();
  buildLettersRow();
  buildCardGridInputs();
  $('#cardModal').hidden = false;

  if (mode === 'scan') {
    Ocr.startCamera($('#cameraVideo'), Store.config.cameraDeviceId).catch((err) => {
      $('#ocrStatus').textContent = 'Câmera indisponível (' + err.message + '). Use "Escolher da galeria" ou cadastre manualmente.';
      $('#btnCapture').hidden = true;
    });
  }
}

function closeCardModal() {
  $('#cardModal').hidden = true;
  Ocr.stopCamera();
}

$('#btnScan').addEventListener('click', () => openCardModal('scan'));
$('#btnManual').addEventListener('click', () => openCardModal('manual'));
$$('[data-close-modal]').forEach((el) => el.addEventListener('click', closeCardModal));
setupQuadInteractions();

$('#btnCapture').addEventListener('click', () => {
  currentPhotoDataUrl = Ocr.capture($('#cameraVideo'), $('#cameraCanvas'));
  Ocr.stopCamera();
  showReviewPhase();
});

$('#btnGallery').addEventListener('click', () => $('#galleryInput').click());

$('#galleryInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // allow picking the same file again later
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    currentPhotoDataUrl = reader.result;
    Ocr.stopCamera();
    showReviewPhase();
  };
  reader.readAsDataURL(file);
});

$('#btnRotate').addEventListener('click', async () => {
  currentPhotoDataUrl = await Ocr.rotate90(currentPhotoDataUrl);
  $('#capturedPreview').src = currentPhotoDataUrl;
});

$('#btnRetake').addEventListener('click', () => {
  showCapturePhase();
  Ocr.startCamera($('#cameraVideo'), Store.config.cameraDeviceId).catch((err) => {
    $('#ocrStatus').textContent = 'Câmera indisponível (' + err.message + ').';
  });
});

$('#btnRecognize').addEventListener('click', async () => {
  $('#ocrStatus').textContent = 'Reconhecendo números da cartela... 0%';
  try {
    const recognizedGrid = await Ocr.recognizeGrid(currentPhotoDataUrl, Store.config.freeCenter, quad, (pct) => {
      $('#ocrStatus').textContent = `Reconhecendo números da cartela... ${pct}%`;
    });
    const count = fillGridFromCells(recognizedGrid);
    const total = Store.config.freeCenter ? 24 : 25;
    const invalid = highlightInvalidCells();
    if (count === 0) {
      $('#ocrStatus').textContent = 'Não foi possível reconhecer os números automaticamente. Preencha manualmente abaixo, ou gire a foto e tente de novo.';
    } else if (invalid.length > 0) {
      $('#ocrStatus').textContent = `${count} de ${total} números reconhecidos, mas ${invalid.length} ficaram fora da faixa da coluna (em vermelho) — corrija antes de salvar.`;
    } else {
      $('#ocrStatus').textContent = `${count} de ${total} números reconhecidos. Confira e corrija antes de salvar — dá pra tocar em qualquer casa e ajustar.`;
    }
  } catch (err) {
    $('#ocrStatus').textContent = 'Falha no reconhecimento automático. Preencha manualmente. (' + err.message + ')';
  }
});

$('#btnSaveCard').addEventListener('click', () => {
  const name = $('#cardParticipant').value.trim();
  const cardNumber = $('#cardNumberInput').value.trim();

  const grid = readGridFromInputs();
  const flatCells = grid.flat().filter((c) => !c.free);
  const hasEmpty = flatCells.some((c) => c.value === '' || Number.isNaN(Number(c.value)));
  if (hasEmpty) { showToast('Preencha todos os números da cartela.'); return; }

  const invalid = highlightInvalidCells();
  if (invalid.length > 0) {
    const first = invalid[0];
    showToast(`O número ${first.value} não pertence à coluna ${first.letter} (${first.min}–${first.max}). Corrija os campos em vermelho.`);
    return;
  }

  const numericGrid = grid.map((row) => row.map((cell) => ({
    ...cell,
    value: cell.free ? null : Number(cell.value),
  })));

  const dup = findDuplicateCard(numericGrid, cardNumber);
  if (dup) {
    if (dup.status === 'used') {
      showToast('Esta cartela já foi usada em um jogo encerrado e não pode ser reutilizada.');
    } else if (dup.status === 'stock') {
      showToast('Esta cartela já está no estoque, aguardando ser entregue.');
    } else {
      showToast('Esta cartela já está cadastrada na partida atual.');
    }
    return;
  }

  addCard(name, numericGrid, cardNumber);
  closeCardModal();
  showToast(name ? 'Cartela salva com sucesso!' : 'Cartela adicionada ao estoque — atribua um nome ao entregá-la.');
  renderCartelas();
  renderSorteio();
});

/* ---------------- CSV import ----------------
   One card per line: card number, name (both optional), then the 25
   grid values in a fixed column order — B1-B5, I1-I5, N1-N5, G1-G5,
   O1-O5 (reading each letter's column top-to-bottom) — matching the
   downloadable template. N3 is the free-center cell and is ignored
   when the card has a free center. */

const CSV_GRID_START_COL = 2;

function splitCsvLine(line, delimiter) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsvText(text) {
  const stripped = text.replace(/^﻿/, ''); // Excel BOM
  const lines = stripped.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  // Excel in pt-BR locales exports CSV with ";" (since "," is the decimal
  // separator there) — pick whichever delimiter actually shows up more.
  const semicolons = (lines[0].match(/;/g) || []).length;
  const commas = (lines[0].match(/,/g) || []).length;
  const delimiter = semicolons > commas ? ';' : ',';
  return lines.map((line) => splitCsvLine(line, delimiter));
}

function rowLooksLikeHeader(cells) {
  const first = (cells[0] || '').trim().toLowerCase();
  return ['numero', 'número', 'card', 'cartela', 'id'].includes(first);
}

function buildGridFromCsvRow(cells) {
  const grid = createEmptyGrid(Store.config.freeCenter);
  for (let colIdx = 0; colIdx < 5; colIdx++) {
    for (let rowIdx = 0; rowIdx < 5; rowIdx++) {
      const cell = grid[rowIdx][colIdx];
      if (cell.free) continue;
      const raw = (cells[CSV_GRID_START_COL + colIdx * 5 + rowIdx] || '').trim();
      cell.value = raw;
    }
  }
  return grid;
}

function importCardsFromCsvText(text) {
  const rows = parseCsvText(text);
  const hasHeader = rows.length > 0 && rowLooksLikeHeader(rows[0]);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const result = { imported: 0, duplicates: 0, invalidRows: [] };

  dataRows.forEach((cells, i) => {
    if (cells.every((c) => c === '')) return; // blank line
    const lineNumber = i + (hasHeader ? 2 : 1);

    const cardNumber = (cells[0] || '').trim();
    const name = (cells[1] || '').trim();
    const grid = buildGridFromCsvRow(cells);

    const flatCells = grid.flat().filter((c) => !c.free);
    const hasEmpty = flatCells.some((c) => c.value === '' || Number.isNaN(Number(c.value)));
    if (hasEmpty) {
      result.invalidRows.push(`linha ${lineNumber}: números incompletos ou inválidos`);
      return;
    }

    const invalid = invalidCellsInPlainGrid(grid);
    if (invalid.length > 0) {
      const first = invalid[0];
      result.invalidRows.push(`linha ${lineNumber}: número ${first.value} fora da faixa da coluna ${first.letter} (${first.min}–${first.max})`);
      return;
    }

    const numericGrid = grid.map((row) => row.map((cell) => ({
      ...cell,
      value: cell.free ? null : Number(cell.value),
    })));

    // Cards imported earlier in this same file are already in Store.cards
    // by this point, so this also catches duplicates within the batch.
    const dup = findDuplicateCard(numericGrid, cardNumber);
    if (dup) { result.duplicates++; return; }

    addCard(name, numericGrid, cardNumber);
    result.imported++;
  });

  return result;
}

$('#btnImportCsv').addEventListener('click', () => $('#csvFileInput').click());

$('#csvFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // allow picking the same file again later
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const result = importCardsFromCsvText(reader.result);
    const parts = [`${result.imported} cartela(s) importada(s)`];
    if (result.duplicates) parts.push(`${result.duplicates} ignorada(s) por já estarem cadastradas`);
    if (result.invalidRows.length) parts.push(`${result.invalidRows.length} linha(s) inválida(s)`);
    let statusText = parts.join(' · ');
    if (result.invalidRows.length) statusText += ': ' + result.invalidRows.slice(0, 5).join('; ');
    $('#csvImportStatus').textContent = statusText;
    renderCartelas();
    renderSorteio();
    showToast(`${result.imported} cartela(s) importada(s) para o estoque.`);
  };
  reader.readAsText(file, 'UTF-8');
});

$('#btnDownloadCsvTemplate').addEventListener('click', () => {
  const header = 'numero,nome,B1,B2,B3,B4,B5,I1,I2,I3,I4,I5,N1,N2,N3,N4,N5,G1,G2,G3,G4,G5,O1,O2,O3,O4,O5';
  const example = Store.config.freeCenter
    ? '0001,,1,2,3,4,5,16,17,18,19,20,31,32,,34,35,46,47,48,49,50,61,62,63,64,65'
    : '0001,,1,2,3,4,5,16,17,18,19,20,31,32,33,34,35,46,47,48,49,50,61,62,63,64,65';
  const csv = header + '\n' + example + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-cartelas.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* ---------------- Print cards (A4, 2/4/6 per page) ---------------- */

function buildPrintableCardHtml(card) {
  const cellsHtml = card.grid.flat()
    .map((cell) => cell.free
      ? '<div class="print-card__cell print-card__cell--free">LIVRE</div>'
      : `<div class="print-card__cell">${cell.value}</div>`)
    .join('');
  const meta = [card.cardNumber ? `Nº ${escapeHtml(card.cardNumber)}` : null, card.name ? escapeHtml(card.name) : 'Sem participante']
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="print-card">
      <div class="print-card__header">${meta}</div>
      <div class="print-card__letters">${LETTERS.map((l) => `<span>${l}</span>`).join('')}</div>
      <div class="print-card__grid">${cellsHtml}</div>
    </div>`;
}

function printCards(perPage) {
  const cards = Store.cards.filter((c) => c.status !== 'used');
  if (cards.length === 0) {
    showToast('Não há cartelas para imprimir.');
    return;
  }

  const pages = [];
  for (let i = 0; i < cards.length; i += perPage) pages.push(cards.slice(i, i + perPage));

  $('#printArea').innerHTML = pages
    .map((pageCards) => `<div class="print-page print-page--${perPage}">${pageCards.map(buildPrintableCardHtml).join('')}</div>`)
    .join('');

  window.print();
}

$$('[data-print-cards]').forEach((btn) => btn.addEventListener('click', () => printCards(Number(btn.dataset.printCards))));

/* ================================================================
   HISTÓRICO DE PARTIDAS
================================================================ */

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDurationMs(ms) {
  if (!ms || ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

function formatGameDuration(game) {
  if (!game.startedAt || !game.endedAt) return '—';
  return formatDurationMs(new Date(game.endedAt) - new Date(game.startedAt));
}

function renderHistorico() {
  const games = Store.history.slice().reverse();
  $('#historicoCount').textContent = games.length;
  $('#historicoList').innerHTML = games.length
    ? games.map((g) => `
        <div class="card history-card">
          <div class="card__header">
            <h2>Jogo #${g.gameId}</h2>
            <span class="card-item__meta">${formatDateTime(g.endedAt)} · ${formatGameDuration(g)}</span>
          </div>
          <div class="card-item__meta">${g.cardsCount} cartela(s) em jogo</div>
          ${g.winners.length
            ? `<div class="cards-summary">${g.winners.map((w) => `
                <div class="card-item ${w.confirmed ? 'is-winner' : 'card-item--expired'}">
                  <div>
                    <div class="card-item__name">${escapeHtml(w.name || 'Sem nome')}</div>
                    <div class="card-item__meta">${escapeHtml(w.criterion)}${w.cardNumber ? ' · Cartela nº ' + escapeHtml(w.cardNumber) : ''}${w.prize ? ' · Prêmio: ' + escapeHtml(w.prize) : ''}${!w.confirmed ? ' · não confirmado' : ''}</div>
                  </div>
                </div>`).join('')}</div>`
            : '<span class="empty-hint">Nenhum ganhador registrado.</span>'}
        </div>`).join('')
    : '<span class="empty-hint">Nenhuma partida encerrada ainda.</span>';
}

/* ================================================================
   DASHBOARD
================================================================ */

function renderBarList(el, entries) {
  if (entries.length === 0) {
    el.innerHTML = '<span class="empty-hint">Sem dados ainda.</span>';
    return;
  }
  const max = Math.max(...entries.map(([, v]) => v));
  el.innerHTML = entries.map(([label, value]) => `
    <div class="bar-row">
      <span class="bar-row__label">${escapeHtml(label)}</span>
      <div class="bar-row__track"><div class="bar-row__fill" style="width:${max ? (value / max * 100) : 0}%"></div></div>
      <span class="bar-row__value">${value}</span>
    </div>`).join('');
}

function sortedEntries(map) {
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function formatDayLabel(key) {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}
function formatMonthLabel(key) {
  const [y, m] = key.split('-');
  return `${m}/${y}`;
}

function renderDashboard() {
  const stats = dashboardStats();
  $('#dashTotalGames').textContent = stats.totalGames;
  $('#dashAvgDuration').textContent = formatDurationMs(stats.avgDurationMs);
  $('#dashTotalCards').textContent = stats.totalCards;
  $('#dashTotalWinners').textContent = stats.totalConfirmedPrizes;

  renderBarList($('#dashByDay'), sortedEntries(stats.byDay).slice(-14).map(([k, v]) => [formatDayLabel(k), v]));
  renderBarList($('#dashByMonth'), sortedEntries(stats.byMonth).slice(-12).map(([k, v]) => [formatMonthLabel(k), v]));
  renderBarList($('#dashByYear'), sortedEntries(stats.byYear));
}

/* ================================================================
   CONFIGURAÇÕES
================================================================ */

/**
 * Board/ball sizing and boldness are exposed as CSS custom properties
 * on the document root, so the same slider values drive both the live
 * game screen and (once saved) whatever the operator sees next time —
 * no per-element style rewrites needed.
 */
function applyDisplaySettings(cfg) {
  const d = cfg.display;
  const root = document.documentElement.style;
  root.setProperty('--board-cell-size', d.boardCellSize + 'px');
  root.setProperty('--board-font-size', d.boardFontSize + 'px');
  root.setProperty('--board-font-weight', d.boardBold ? '800' : '500');
  root.setProperty('--ball-letter-size', d.ballLetterSize + 'px');
  root.setProperty('--ball-number-size', d.ballNumberSize + 'px');
  root.setProperty('--ball-font-weight', d.ballBold ? '800' : '600');
}

function readDisplayForm() {
  return {
    boardCellSize: Number($('#cfgBoardCellSize').value),
    boardFontSize: Number($('#cfgBoardFontSize').value),
    boardBold: $('#cfgBoardBold').checked,
    ballLetterSize: Number($('#cfgBallLetterSize').value),
    ballNumberSize: Number($('#cfgBallNumberSize').value),
    ballBold: $('#cfgBallBold').checked,
  };
}

function updateDisplayOutputs() {
  $('#outBoardFontSize').textContent = $('#cfgBoardFontSize').value + 'px';
  $('#outBoardCellSize').textContent = $('#cfgBoardCellSize').value + 'px';
  $('#outBallLetterSize').textContent = $('#cfgBallLetterSize').value + 'px';
  $('#outBallNumberSize').textContent = $('#cfgBallNumberSize').value + 'px';
}

function previewDisplaySettings() {
  updateDisplayOutputs();
  applyDisplaySettings({ display: readDisplayForm() });
}

$$('#cfgBoardFontSize, #cfgBoardCellSize, #cfgBallLetterSize, #cfgBallNumberSize, #cfgBoardBold, #cfgBallBold')
  .forEach((el) => el.addEventListener('input', previewDisplaySettings));

/**
 * Fills the "Selecionar câmera" dropdown with whatever video input
 * devices the browser can see — mainly useful on a computer, where
 * several webcams may be available and there's no "front/back"
 * facingMode to rely on like there is on a phone. Device labels only
 * show up once camera permission has been granted at least once.
 */
async function populateCameraOptions() {
  const select = $('#cfgCamera');
  const current = Store.config.cameraDeviceId;
  try {
    const cameras = await Ocr.listCameras();
    select.innerHTML = '<option value="">Automática</option>' + cameras
      .map((cam, i) => `<option value="${cam.deviceId}">${escapeHtml(cam.label || `Câmera ${i + 1}`)}</option>`)
      .join('');
    select.value = current;
    if (select.value !== current) select.value = ''; // saved device no longer exists
  } catch (err) {
    select.innerHTML = '<option value="">Automática</option>';
  }
}

function renderConfigForm() {
  const cfg = Store.config;
  populateCameraOptions();
  $('#cfgMin').value = cfg.min;
  $('#cfgMax').value = cfg.max;
  $('#cfgLastCount').value = cfg.lastCount;
  $('#cfgFreeCenter').checked = cfg.freeCenter;
  $('#cfgCheia').checked = cfg.criteria.cheia;
  $('#cfgQuatroPontas').checked = cfg.criteria.quatroPontas;
  $('#cfgQuinaPrimeiraLetra').checked = cfg.criteria.quinaPrimeiraLetra;
  $('#cfgQuina').checked = cfg.criteria.quina;
  $('#cfgQuinaTipo').value = cfg.quinaTipo;
  $('#quinaTipoWrap').style.display = cfg.criteria.quina ? '' : 'none';

  const d = cfg.display;
  $('#cfgBoardFontSize').value = d.boardFontSize;
  $('#cfgBoardCellSize').value = d.boardCellSize;
  $('#cfgBoardBold').checked = d.boardBold;
  $('#cfgBallLetterSize').value = d.ballLetterSize;
  $('#cfgBallNumberSize').value = d.ballNumberSize;
  $('#cfgBallBold').checked = d.ballBold;
  updateDisplayOutputs();

  $('#configSaveHint').hidden = true;
}

$('#cfgQuina').addEventListener('change', (e) => {
  $('#quinaTipoWrap').style.display = e.target.checked ? '' : 'none';
});

$('#formConfig').addEventListener('submit', (e) => {
  e.preventDefault();
  const min = parseInt($('#cfgMin').value, 10);
  const max = parseInt($('#cfgMax').value, 10);
  const lastCount = parseInt($('#cfgLastCount').value, 10);

  if (Number.isNaN(min) || Number.isNaN(max) || min >= max) {
    showToast('O número final deve ser maior que o inicial.');
    return;
  }
  if (Number.isNaN(lastCount) || lastCount < 1) {
    showToast('Informe uma quantidade válida de últimas bolas.');
    return;
  }

  const apply = () => {
    Store.config.min = min;
    Store.config.max = max;
    Store.config.lastCount = lastCount;
    Store.config.freeCenter = $('#cfgFreeCenter').checked;
    Store.config.criteria.cheia = $('#cfgCheia').checked;
    Store.config.criteria.quatroPontas = $('#cfgQuatroPontas').checked;
    Store.config.criteria.quinaPrimeiraLetra = $('#cfgQuinaPrimeiraLetra').checked;
    Store.config.criteria.quina = $('#cfgQuina').checked;
    Store.config.quinaTipo = $('#cfgQuinaTipo').value;
    Store.config.cameraDeviceId = $('#cfgCamera').value;
    Store.config.display = readDisplayForm();
    Store.saveConfig();
    applyDisplaySettings(Store.config);

    $('#configSaveHint').hidden = false;
    showToast('Configurações salvas.');
    renderSorteio();
  };

  const rangeChangedMidGame = Store.game.drawnNumbers.length > 0 && (min !== Store.config.min || max !== Store.config.max);
  if (rangeChangedMidGame) {
    openConfirm(
      'Alterar intervalo do sorteio?',
      'Já existem números sorteados no jogo atual. Alterar o intervalo pode afetar a partida em andamento.',
      apply
    );
  } else {
    apply();
  }
});

/* ================================================================
   INIT
================================================================ */

applyDisplaySettings(Store.config);
switchView('sorteio');
