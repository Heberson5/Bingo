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
  renderNearMisses();
  renderPendingPrizes();

  const noMore = availableNumbers().length === 0;
  $('#btnSortear').disabled = noMore;
  $('#btnSortear').textContent = noMore ? 'Todos os números já saíram' : 'Sortear número';
  $('#btnMarcarManual').disabled = noMore;
}

function renderNearMisses() {
  const misses = findNearMisses();
  $('#nearMissCount').textContent = misses.length;
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
        <div>
          <div class="card-item__name">${escapeHtml(p.card.name)}</div>
          <div class="card-item__meta">Concorrendo: ${escapeHtml(p.label)} · completou com a bola nº ${p.drawIndex} (${p.drawnNumber})</div>
        </div>
        <button class="btn btn--secondary btn--small" data-confirm-prize data-card-id="${p.card.id}" data-key="${p.key}">Confirmar prêmio</button>
      </div>`)
    .join('');

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
  confirmAchievement(btn.dataset.cardId, btn.dataset.key);
  renderSorteio();
  showToast('Prêmio confirmado.');
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

function renderDrawBoard() {
  const board = $('#drawBoard');
  const { min, max } = Store.config;
  const ranges = getColumnRanges(min, max);
  const drawnSet = new Set(Store.game.drawnNumbers);

  let html = '';
  LETTERS.forEach((l) => { html += `<div class="board-col-label">${l}</div>`; });

  const maxRows = Math.max(...ranges.map(([s, e]) => e - s + 1));
  for (let row = 0; row < maxRows; row++) {
    for (let col = 0; col < 5; col++) {
      const [s, e] = ranges[col];
      const num = s + row;
      if (num > e) { html += '<div></div>'; continue; }
      const drawn = drawnSet.has(num);
      html += `<div class="board-num ${drawn ? 'is-drawn' : ''}" data-num="${num}">${num}</div>`;
    }
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
  return achievements.map((a) => `${a.confirmed ? '✅' : a.expired ? '❌' : '⏳'} ${a.label}`).join(', ');
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
            <div class="card-item__meta">${markedCount}/${total} marcados${won ? ' · ' + achievementSummary(c.achievements) : ''}</div>
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

function renderCartelas() {
  const active = activeCards();
  $('#cartelasAtivasCount').textContent = active.length;
  const list = $('#cartelasAtivasList');
  list.innerHTML = active.length
    ? active.map((c) => `
        <div class="card-item ${c.achievements.length ? 'is-winner' : ''}" data-card-id="${c.id}">
          <div>
            <div class="card-item__name">${escapeHtml(c.name)}</div>
            <div class="card-item__meta">Jogo #${c.gameId}${c.achievements.length ? ' · ' + achievementSummary(c.achievements) : ''}</div>
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
            <div class="card-item__meta">Jogo #${c.gameId} · ${c.achievements.length ? achievementSummary(c.achievements) : 'sem vitória'}</div>
          </div>
          <button class="card-item__delete" data-delete-card aria-label="Excluir cartela">🗑️</button>
        </div>`).join('')
    : '<span class="empty-hint">Nenhum histórico ainda.</span>';
}

function handleCardListClick(e) {
  const btn = e.target.closest('[data-delete-card]');
  if (!btn) return;
  const item = e.target.closest('[data-card-id]');
  const id = item.dataset.cardId;
  const card = Store.cards.find((c) => c.id === id);
  if (!card) return;
  openConfirm(
    'Excluir cartela?',
    `A cartela de ${card.name} será excluída permanentemente. Essa ação não pode ser desfeita.`,
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
  $('#scanSection').hidden = mode !== 'scan';
  showCapturePhase();
  buildLettersRow();
  buildCardGridInputs();
  $('#cardModal').hidden = false;

  if (mode === 'scan') {
    Ocr.startCamera($('#cameraVideo')).catch((err) => {
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
  Ocr.startCamera($('#cameraVideo')).catch((err) => {
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
  if (!name) { showToast('Informe o nome do participante.'); return; }

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

  const dup = findDuplicateCard(numericGrid);
  if (dup) {
    if (dup.status === 'used') {
      showToast('Esta cartela já foi usada em um jogo encerrado e não pode ser reutilizada.');
    } else {
      showToast('Esta cartela já está cadastrada na partida atual.');
    }
    return;
  }

  addCard(name, numericGrid);
  closeCardModal();
  showToast('Cartela salva com sucesso!');
  renderCartelas();
  renderSorteio();
});

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

function renderConfigForm() {
  const cfg = Store.config;
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
