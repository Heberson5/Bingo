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
  $$('.bottom-nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === name));
  if (name === 'sorteio') renderSorteio();
  if (name === 'cartelas') renderCartelas();
  if (name === 'config') renderConfigForm();
}

$$('.bottom-nav__item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.nav));
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

  const noMore = availableNumbers().length === 0;
  $('#btnSortear').disabled = noMore;
  $('#btnSortear').textContent = noMore ? 'Todos os números já saíram' : 'Sortear número';
}

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
      html += `<div class="board-num ${drawn ? 'is-drawn' : ''}">${num}</div>`;
    }
  }
  board.innerHTML = html;
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
            <div class="card-item__meta">${markedCount}/${total} marcados${won ? ' · 🏆 ' + c.achievements.join(', ') : ''}</div>
          </div>
        </div>`;
    })
    .join('');
}

$('#btnSortear').addEventListener('click', () => {
  const num = drawNumber();
  if (num === null) { showToast('Todos os números já foram sorteados.'); return; }

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
  }
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
        <div class="card-item ${c.achievements.length ? 'is-winner' : ''}">
          <div>
            <div class="card-item__name">${escapeHtml(c.name)}</div>
            <div class="card-item__meta">Jogo #${c.gameId}${c.achievements.length ? ' · 🏆 ' + c.achievements.join(', ') : ''}</div>
          </div>
        </div>`).join('')
    : '<span class="empty-hint">Nenhuma cartela ativa.</span>';

  const used = Store.cards.filter((c) => c.status === 'used');
  const hist = $('#cartelasHistoricoList');
  hist.innerHTML = used.length
    ? used.slice().reverse().map((c) => `
        <div class="card-item is-used">
          <div>
            <div class="card-item__name">${escapeHtml(c.name)}</div>
            <div class="card-item__meta">Jogo #${c.gameId} · ${c.achievements.length ? '🏆 ' + c.achievements.join(', ') : 'sem vitória'}</div>
          </div>
        </div>`).join('')
    : '<span class="empty-hint">Nenhum histórico ainda.</span>';
}

$('#toggleHistorico').addEventListener('click', () => {
  const list = $('#cartelasHistoricoList');
  const chevron = $('#toggleHistorico .chevron');
  list.hidden = !list.hidden;
  chevron.classList.toggle('is-open', !list.hidden);
});

/* ---------------- Card modal (scan / manual) ---------------- */

function buildLettersRow() {
  $('#lettersRow').innerHTML = LETTERS.map((l) => `<div>${l}</div>`).join('');
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
let cropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

const CAPTURE_HINT = 'Alinhe as bordas da cartela com o quadro e as linhas guia antes de capturar.';
const REVIEW_HINT = 'Arraste as bolinhas para o retângulo cobrir só a grade de números (sem o cabeçalho BINGO nem a borda da cartela). Gire a foto se estiver de lado. Depois toque em "Reconhecer números".';

function showCapturePhase() {
  currentPhotoDataUrl = null;
  $('#cameraBox').hidden = false;
  $('#capturedWrap').hidden = true;
  $('#captureControls').hidden = false;
  $('#reviewControls').hidden = true;
  $('#scanHint').textContent = CAPTURE_HINT;
  $('#ocrStatus').textContent = '';
}

function showReviewPhase() {
  $('#cameraBox').hidden = true;
  $('#capturedWrap').hidden = false;
  $('#captureControls').hidden = true;
  $('#reviewControls').hidden = false;
  $('#scanHint').textContent = REVIEW_HINT;
  $('#capturedPreview').src = currentPhotoDataUrl;
  cropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  applyCropRectStyle();
}

/* ---------------- Crop rectangle (drag to mark the number grid) ---------------- */

function applyCropRectStyle() {
  const el = $('#cropRect');
  el.style.left = cropRect.x * 100 + '%';
  el.style.top = cropRect.y * 100 + '%';
  el.style.width = cropRect.w * 100 + '%';
  el.style.height = cropRect.h * 100 + '%';
}

const MIN_CROP_SIZE = 0.15;

function clampCropRect() {
  cropRect.w = Math.min(Math.max(cropRect.w, MIN_CROP_SIZE), 1);
  cropRect.h = Math.min(Math.max(cropRect.h, MIN_CROP_SIZE), 1);
  cropRect.x = Math.min(Math.max(cropRect.x, 0), 1 - cropRect.w);
  cropRect.y = Math.min(Math.max(cropRect.y, 0), 1 - cropRect.h);
}

function setupCropInteractions() {
  const wrap = $('#capturedWrap');
  const rectEl = $('#cropRect');

  function dragFraction(startEvent, onMove) {
    const bounds = wrap.getBoundingClientRect();
    const start = { x: startEvent.clientX, y: startEvent.clientY };
    const startRect = { ...cropRect };
    const pointerId = startEvent.pointerId;

    function onPointerMove(e) {
      const dx = (e.clientX - start.x) / bounds.width;
      const dy = (e.clientY - start.y) / bounds.height;
      onMove(dx, dy, startRect);
      clampCropRect();
      applyCropRectStyle();
    }
    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    startEvent.preventDefault();
  }

  rectEl.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('crop-handle')) return;
    dragFraction(e, (dx, dy, start) => {
      cropRect.x = start.x + dx;
      cropRect.y = start.y + dy;
    });
  });

  $$('.crop-handle', rectEl).forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const corner = handle.dataset.corner;
      dragFraction(e, (dx, dy, start) => {
        if (corner === 'se') {
          cropRect.w = start.w + dx;
          cropRect.h = start.h + dy;
        } else if (corner === 'nw') {
          cropRect.x = start.x + dx;
          cropRect.y = start.y + dy;
          cropRect.w = start.w - dx;
          cropRect.h = start.h - dy;
        } else if (corner === 'ne') {
          cropRect.y = start.y + dy;
          cropRect.w = start.w + dx;
          cropRect.h = start.h - dy;
        } else if (corner === 'sw') {
          cropRect.x = start.x + dx;
          cropRect.w = start.w - dx;
          cropRect.h = start.h + dy;
        }
      });
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
      $('#ocrStatus').textContent = 'Câmera indisponível (' + err.message + '). Preencha manualmente abaixo.';
      $('#captureControls').hidden = true;
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
setupCropInteractions();

$('#btnCapture').addEventListener('click', () => {
  currentPhotoDataUrl = Ocr.capture($('#cameraVideo'), $('#cameraCanvas'));
  Ocr.stopCamera();
  showReviewPhase();
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
    const recognizedGrid = await Ocr.recognizeGrid(currentPhotoDataUrl, Store.config.freeCenter, cropRect, (pct) => {
      $('#ocrStatus').textContent = `Reconhecendo números da cartela... ${pct}%`;
    });
    const count = fillGridFromCells(recognizedGrid);
    const total = Store.config.freeCenter ? 24 : 25;
    if (count === 0) {
      $('#ocrStatus').textContent = 'Não foi possível reconhecer os números automaticamente. Preencha manualmente abaixo, ou gire a foto e tente de novo.';
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
    Store.saveConfig();

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

switchView('sorteio');
