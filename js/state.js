/* ===================================================================
   BINGO — camada de estado e regras do jogo
   Tudo é persistido em localStorage. Não há backend nem login.
=================================================================== */

const LETTERS = ['B', 'I', 'N', 'G', 'O'];

const STORAGE_KEYS = {
  config: 'bingo_config_v1',
  game: 'bingo_game_v1',
  cards: 'bingo_cards_v1',
  history: 'bingo_history_v1',
};

const DEFAULT_CONFIG = {
  min: 1,
  max: 75,
  lastCount: 15,
  freeCenter: true,
  criteria: {
    cheia: true,
    quatroPontas: false,
    quinaPrimeiraLetra: false,
    quina: true,
  },
  quinaTipo: 'todos', // horizontal | transversal | diagonal | todos
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    return { ...structuredClone(fallback), ...JSON.parse(raw) };
  } catch (e) {
    return structuredClone(fallback);
  }
}

function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Store = {
  config: loadJSON(STORAGE_KEYS.config, DEFAULT_CONFIG),
  game: loadJSON(STORAGE_KEYS.game, { id: 1, drawnNumbers: [], firstNumber: null }),
  cards: loadArray(STORAGE_KEYS.cards),
  history: loadArray(STORAGE_KEYS.history),

  saveConfig() { save(STORAGE_KEYS.config, this.config); },
  saveGame() { save(STORAGE_KEYS.game, this.game); },
  saveCards() { save(STORAGE_KEYS.cards, this.cards); },
  saveHistory() { save(STORAGE_KEYS.history, this.history); },
};

/* ---------------- Column ranges (B I N G O) ---------------- */

function getColumnRanges(min, max) {
  const total = max - min + 1;
  const size = Math.floor(total / 5);
  const ranges = [];
  let start = min;
  for (let i = 0; i < 5; i++) {
    const end = i === 4 ? max : start + size - 1;
    ranges.push([start, end]);
    start = end + 1;
  }
  return ranges;
}

function columnIndexForNumber(num, min, max) {
  const ranges = getColumnRanges(min, max);
  for (let i = 0; i < ranges.length; i++) {
    if (num >= ranges[i][0] && num <= ranges[i][1]) return i;
  }
  return null;
}

function letterForNumber(num) {
  const idx = columnIndexForNumber(num, Store.config.min, Store.config.max);
  return idx === null ? '' : LETTERS[idx];
}

/* ---------------- Cards ---------------- */

function isCenterCell(r, c) {
  return r === 2 && c === 2;
}

function createEmptyGrid(freeCenter) {
  const grid = [];
  for (let r = 0; r < 5; r++) {
    const row = [];
    for (let c = 0; c < 5; c++) {
      row.push({
        value: freeCenter && isCenterCell(r, c) ? null : '',
        free: freeCenter && isCenterCell(r, c),
        marked: freeCenter && isCenterCell(r, c),
      });
    }
    grid.push(row);
  }
  return grid;
}

function addCard(name, grid) {
  const card = {
    id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: name.trim(),
    grid,
    gameId: Store.game.id,
    status: 'active', // active | used
    achievements: [],
    createdAt: new Date().toISOString(),
  };
  Store.cards.push(card);
  Store.saveCards();
  // Apply any numbers already drawn in the current game.
  applyDrawnNumbersToCard(card);
  Store.saveCards();
  return card;
}

function activeCards() {
  return Store.cards.filter((c) => c.status === 'active' && c.gameId === Store.game.id);
}

/**
 * Finds any card (active or already used/archived, from any game) that
 * has the exact same set of numbers as the given grid. Used to prevent
 * registering the same physical card twice, and to block reusing a
 * card that already played (and finished) a previous game.
 */
function findDuplicateCard(grid) {
  const flat = flattenValues(grid);
  return Store.cards.find((c) => sameValues(flattenValues(c.grid), flat)) || null;
}

function flattenValues(grid) {
  const values = [];
  for (const row of grid) for (const cell of row) if (!cell.free) values.push(Number(cell.value));
  return values.slice().sort((a, b) => a - b);
}

function sameValues(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function applyDrawnNumbersToCard(card) {
  for (const row of card.grid) {
    for (const cell of row) {
      if (!cell.free && cell.value !== '' && Store.game.drawnNumbers.includes(Number(cell.value))) {
        cell.marked = true;
      }
    }
  }
}

/* ---------------- Draw ---------------- */

function availableNumbers() {
  const { min, max } = Store.config;
  const drawn = new Set(Store.game.drawnNumbers);
  const pool = [];
  for (let n = min; n <= max; n++) if (!drawn.has(n)) pool.push(n);
  return pool;
}

function drawNumber() {
  const pool = availableNumbers();
  if (pool.length === 0) return null;
  const num = pool[Math.floor(Math.random() * pool.length)];
  Store.game.drawnNumbers.push(num);
  if (Store.game.firstNumber === null) Store.game.firstNumber = num;
  Store.saveGame();

  for (const card of activeCards()) {
    for (const row of card.grid) {
      for (const cell of row) {
        if (!cell.free && Number(cell.value) === num) cell.marked = true;
      }
    }
  }
  Store.saveCards();
  return num;
}

/* ---------------- Win checking ---------------- */

function isMarked(cell) {
  return cell.free || cell.marked;
}

function checkRow(grid, r) {
  for (let c = 0; c < 5; c++) if (!isMarked(grid[r][c])) return false;
  return true;
}
function checkCol(grid, c) {
  for (let r = 0; r < 5; r++) if (!isMarked(grid[r][c])) return false;
  return true;
}
function checkDiagonals(grid) {
  let d1 = true, d2 = true;
  for (let i = 0; i < 5; i++) {
    if (!isMarked(grid[i][i])) d1 = false;
    if (!isMarked(grid[i][4 - i])) d2 = false;
  }
  return d1 || d2;
}

function checkQuina(grid, tipo) {
  if (tipo === 'horizontal') {
    for (let r = 0; r < 5; r++) if (checkRow(grid, r)) return true;
    return false;
  }
  if (tipo === 'transversal') {
    for (let c = 0; c < 5; c++) if (checkCol(grid, c)) return true;
    return false;
  }
  if (tipo === 'diagonal') {
    return checkDiagonals(grid);
  }
  // todos
  for (let r = 0; r < 5; r++) if (checkRow(grid, r)) return true;
  for (let c = 0; c < 5; c++) if (checkCol(grid, c)) return true;
  return checkDiagonals(grid);
}

function checkFullCard(grid) {
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (!isMarked(grid[r][c])) return false;
  return true;
}

function checkFourCorners(grid) {
  return isMarked(grid[0][0]) && isMarked(grid[0][4]) && isMarked(grid[4][0]) && isMarked(grid[4][4]);
}

/**
 * Returns a list of newly-achieved win descriptions for this card
 * (criteria not already present in card.achievements).
 */
function evaluateCard(card) {
  const cfg = Store.config;
  const found = [];

  if (cfg.criteria.cheia && checkFullCard(card.grid)) found.push({ key: 'cheia', label: 'Cartela Cheia' });

  if (cfg.criteria.quatroPontas && checkFourCorners(card.grid)) {
    found.push({ key: 'quatroPontas', label: 'Quatro Pontas' });
  }

  if (cfg.criteria.quinaPrimeiraLetra && Store.game.firstNumber !== null) {
    const colIdx = columnIndexForNumber(Store.game.firstNumber, cfg.min, cfg.max);
    if (colIdx !== null && checkCol(card.grid, colIdx)) {
      found.push({ key: 'quinaPrimeiraLetra', label: `Quina da letra ${LETTERS[colIdx]} (primeira sorteada)` });
    }
  }

  if (cfg.criteria.quina && checkQuina(card.grid, cfg.quinaTipo)) {
    found.push({ key: 'quina', label: 'Quina' });
  }

  const newOnes = found.filter((f) => !card.achievements.includes(f.key));
  for (const f of newOnes) card.achievements.push(f.key);
  return newOnes;
}

function evaluateAllActiveCards() {
  const winners = [];
  for (const card of activeCards()) {
    const newOnes = evaluateCard(card);
    for (const w of newOnes) winners.push({ card, ...w });
  }
  if (winners.length) Store.saveCards();
  return winners;
}

/* ---------------- End game ---------------- */

function endGame() {
  const finishedGameId = Store.game.id;
  const cardsInGame = Store.cards.filter((c) => c.gameId === finishedGameId);
  const winners = [];
  for (const card of cardsInGame) {
    card.status = 'used';
    for (const key of card.achievements) winners.push({ name: card.name, criterion: key });
  }
  Store.saveCards();

  Store.history.push({
    gameId: finishedGameId,
    endedAt: new Date().toISOString(),
    drawnNumbers: Store.game.drawnNumbers.slice(),
    cardsCount: cardsInGame.length,
    winners,
  });
  Store.saveHistory();

  Store.game = { id: finishedGameId + 1, drawnNumbers: [], firstNumber: null };
  Store.saveGame();
}
