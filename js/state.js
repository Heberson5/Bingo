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
  cameraDeviceId: '', // '' = automatic (facingMode: environment)
  suspenseMode: false,
  display: {
    boardCellSize: 56,
    boardFontSize: 14,
    boardBold: false,
    ballLetterSize: 22,
    ballNumberSize: 48,
    ballBold: true,
  },
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
  game: loadJSON(STORAGE_KEYS.game, { id: 1, drawnNumbers: [], firstNumber: null, startedAt: null, closedCriteria: {}, prizes: [], revealedCount: 0 }),
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

/**
 * Registering a physical card doesn't have to happen at the exact
 * moment it's handed to someone — a batch of cards can be scanned in
 * ahead of time and kept as unnamed "stock", to be assigned a
 * participant's name later, one at a time, as each card is actually
 * given out. A card saved without a name becomes stock (not tied to
 * any game); one saved with a name behaves as before.
 */
function addCard(name, grid, cardNumber) {
  const trimmedName = (name || '').trim();
  const card = {
    id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: trimmedName,
    cardNumber: (cardNumber || '').trim(),
    grid,
    gameId: trimmedName ? Store.game.id : null,
    status: trimmedName ? 'active' : 'stock', // stock | active | used
    achievements: [], // { key, label, drawIndex, drawnNumber, confirmed }
    createdAt: new Date().toISOString(),
  };
  Store.cards.push(card);
  Store.saveCards();
  // Apply any numbers already drawn in the current game.
  if (card.status === 'active') applyDrawnNumbersToCard(card);
  Store.saveCards();
  return card;
}

function deleteCard(id) {
  Store.cards = Store.cards.filter((c) => c.id !== id);
  Store.saveCards();
}

function deleteCards(ids) {
  const idSet = new Set(ids);
  Store.cards = Store.cards.filter((c) => !idSet.has(c.id));
  Store.saveCards();
}

function activeCards() {
  return Store.cards.filter((c) => c.status === 'active' && c.gameId === Store.game.id);
}

function stockCards() {
  return Store.cards.filter((c) => c.status === 'stock');
}

/**
 * Hands a stock card to a participant: attaches their name and folds
 * it into the current game as a normal active card, picking up
 * whatever numbers have already been drawn.
 */
function assignCardName(id, name) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) return false;
  const card = Store.cards.find((c) => c.id === id && c.status === 'stock');
  if (!card) return false;
  card.name = trimmedName;
  card.status = 'active';
  card.gameId = Store.game.id;
  applyDrawnNumbersToCard(card);
  Store.saveCards();
  return true;
}

/**
 * Finds any card (stock, active, or already used/archived, from any
 * game) that's the same physical card as the one being registered —
 * used to prevent registering the same card twice, and to block
 * reusing a card that already played a previous game. Two cards count
 * as the same if they share a printed card number OR the exact same
 * set of numbers; checking both matters because a typo'd/missing card
 * number shouldn't defeat the grid check, and a misread OCR digit
 * (producing a slightly different grid) shouldn't defeat the number
 * check when the card number was read correctly.
 */
function findDuplicateCard(grid, cardNumber) {
  const flat = flattenValues(grid);
  const trimmedNumber = (cardNumber || '').trim();
  return Store.cards.find((c) => {
    if (trimmedNumber && c.cardNumber && c.cardNumber === trimmedNumber) return true;
    return sameValues(flattenValues(c.grid), flat);
  }) || null;
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

/**
 * Same column-range check as the manual/scan entry form, but against a
 * plain in-memory grid instead of the DOM inputs — used by CSV import,
 * where there's no card-entry form to read from.
 */
function invalidCellsInPlainGrid(grid) {
  const ranges = getColumnRanges(Store.config.min, Store.config.max);
  const invalid = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = grid[r][c];
      if (cell.free) continue;
      const value = Number(cell.value);
      const [min, max] = ranges[c];
      if (value < min || value > max) invalid.push({ r, c, value, letter: LETTERS[c], min, max });
    }
  }
  return invalid;
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

/**
 * A win only really counts if it's called out before the next ball
 * comes out — that's what "vale o último número" means in practice.
 * So the moment a new number is drawn, any achievement still awaiting
 * confirmation from an earlier draw is stale: the card "passou batido"
 * and that particular claim no longer counts, even though the game
 * keeps going and the criterion could still be won again by another
 * card's next completed line.
 */
function expireStalePending() {
  let changed = false;
  for (const card of activeCards()) {
    for (const a of card.achievements) {
      if (!a.confirmed && !a.expired) { a.expired = true; changed = true; }
    }
  }
  if (changed) Store.saveCards();
}

/**
 * Records `num` as drawn (whether it came from the app's random draw or
 * was typed in manually because the operator is calling numbers from a
 * physical globe/cage) and marks it on every active card.
 */
function commitDrawnNumber(num) {
  expireStalePending();

  Store.game.drawnNumbers.push(num);
  if (Store.game.firstNumber === null) Store.game.firstNumber = num;
  if (!Store.game.startedAt) Store.game.startedAt = new Date().toISOString();
  // With suspense mode off, the public display should update the moment
  // the number is drawn, same as always — so it's marked "revealed"
  // immediately. With it on, this is deliberately left lagging behind
  // drawnNumbers; see revealPendingNumber().
  if (!isSuspenseModeOn()) Store.game.revealedCount = Store.game.drawnNumbers.length;
  Store.saveGame();

  for (const card of activeCards()) {
    for (const row of card.grid) {
      for (const cell of row) {
        if (!cell.free && Number(cell.value) === num) cell.marked = true;
      }
    }
  }
  Store.saveCards();
}

/* ---------------- Suspense mode (delayed reveal on the public display) ----------------
   Drawing a number always runs the game logic immediately (marking
   cards, evaluating winners) — suspense only holds back what the
   separate fullscreen display (a different tab/window reading the same
   localStorage) shows as the "current" ball, so the operator can build
   anticipation before tapping the ball to reveal it to the audience. */

function isSuspenseModeOn() {
  return !!Store.config.suspenseMode;
}

function setSuspenseMode(on) {
  Store.config.suspenseMode = on;
  Store.saveConfig();
  if (!on) {
    // Turning it off should never leave the display stuck behind —
    // catch it up immediately.
    revealPendingNumber();
  } else if ((Store.game.revealedCount || 0) < Store.game.drawnNumbers.length) {
    // Turning it on shouldn't retroactively hide numbers the audience
    // already saw — only draws from this point on get held back.
    Store.game.revealedCount = Store.game.drawnNumbers.length;
    Store.saveGame();
  }
}

function hasUnrevealedNumber() {
  return isSuspenseModeOn() && (Store.game.revealedCount || 0) < Store.game.drawnNumbers.length;
}

function revealPendingNumber() {
  Store.game.revealedCount = Store.game.drawnNumbers.length;
  Store.saveGame();
}

function drawNumber() {
  const pool = availableNumbers();
  if (pool.length === 0) return null;
  const num = pool[Math.floor(Math.random() * pool.length)];
  commitDrawnNumber(num);
  return num;
}

/**
 * Registers a number called manually (e.g. from a physical bingo
 * globe) instead of the app's own random draw. Returns false without
 * changing state if the number is out of range or already drawn.
 */
function markNumberManually(num) {
  if (!Number.isInteger(num) || num < Store.config.min || num > Store.config.max) return false;
  if (Store.game.drawnNumbers.includes(num)) return false;
  commitDrawnNumber(num);
  return true;
}

/* ---------------- Win checking ---------------- */

function isMarked(cell) {
  return cell.free || cell.marked;
}

function rowCells(grid, r) {
  return grid[r];
}
function colCells(grid, c) {
  return grid.map((row) => row[c]);
}
function diagCells(grid, which) {
  const cells = [];
  for (let i = 0; i < 5; i++) cells.push(which === 0 ? grid[i][i] : grid[i][4 - i]);
  return cells;
}

function checkRow(grid, r) {
  return rowCells(grid, r).every(isMarked);
}
function checkCol(grid, c) {
  return colCells(grid, c).every(isMarked);
}
function checkDiagonals(grid) {
  return diagCells(grid, 0).every(isMarked) || diagCells(grid, 1).every(isMarked);
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
  return grid.flat().every(isMarked);
}

function checkFourCorners(grid) {
  return isMarked(grid[0][0]) && isMarked(grid[0][4]) && isMarked(grid[4][0]) && isMarked(grid[4][4]);
}

/**
 * Which criteria are enabled in Config right now, in display order.
 */
function activeCriteriaKeys() {
  const cfg = Store.config;
  const keys = [];
  if (cfg.criteria.cheia) keys.push('cheia');
  if (cfg.criteria.quatroPontas) keys.push('quatroPontas');
  if (cfg.criteria.quinaPrimeiraLetra) keys.push('quinaPrimeiraLetra');
  if (cfg.criteria.quina) keys.push('quina');
  return keys;
}

function criterionLabel(key) {
  if (key === 'cheia') return 'Cartela Cheia';
  if (key === 'quatroPontas') return 'Quatro Pontas';
  if (key === 'quina') return 'Quina';
  if (key === 'quinaPrimeiraLetra') {
    if (Store.game.firstNumber !== null) {
      const colIdx = columnIndexForNumber(Store.game.firstNumber, Store.config.min, Store.config.max);
      if (colIdx !== null) return `Quina da letra ${LETTERS[colIdx]} (primeira sorteada)`;
    }
    return 'Quina da primeira letra sorteada';
  }
  return key;
}

/**
 * A criterion can be "dado baixa" (closed) mid-round once its prize has
 * already been awarded, without ending the whole game — the numbers
 * keep being drawn for the remaining prizes, but this criterion stops
 * being evaluated, stops showing near-misses, and any of its still-
 * pending (unconfirmed) claims stop being shown too. Resets to open for
 * every criterion whenever a new game starts (see endGame/restartAllCards).
 */
function isCriterionClosed(key) {
  return !!(Store.game.closedCriteria && Store.game.closedCriteria[key]);
}

function setCriterionClosed(key, closed) {
  if (!Store.game.closedCriteria) Store.game.closedCriteria = {};
  Store.game.closedCriteria[key] = closed;
  Store.saveGame();
}

/**
 * A round can have more than one prize on the table at once (1º prêmio,
 * 2º prêmio, a raffle item, ...), so prizes are registered by name into
 * a small per-game list instead of being free text typed fresh at every
 * confirmation — the operator adds each prize once, then picks which
 * one is "active" in the UI before confirming whichever card(s) just
 * won it. Resets with the rest of the round state in endGame().
 */
function gamePrizes() {
  return Store.game.prizes || [];
}

function addPrize(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  if (!Store.game.prizes) Store.game.prizes = [];
  if (Store.game.prizes.includes(trimmed)) return false;
  Store.game.prizes.push(trimmed);
  Store.saveGame();
  return true;
}

function removePrize(name) {
  if (!Store.game.prizes) return;
  Store.game.prizes = Store.game.prizes.filter((p) => p !== name);
  Store.saveGame();
}

/**
 * Returns the newly-achieved criteria for this card (ones not already
 * recorded in card.achievements), tagging each with which draw (index
 * + number) completed it. That record is what lets the operator later
 * work out who *really* won first if a card "passou batido" (the
 * player missed calling it out) and more than one card is in play for
 * the same prize — only the last-drawn number's completion counts.
 */
function evaluateCard(card) {
  const cfg = Store.config;
  const found = [];

  if (cfg.criteria.cheia && !isCriterionClosed('cheia') && checkFullCard(card.grid)) {
    found.push({ key: 'cheia', label: criterionLabel('cheia') });
  }

  if (cfg.criteria.quatroPontas && !isCriterionClosed('quatroPontas') && checkFourCorners(card.grid)) {
    found.push({ key: 'quatroPontas', label: criterionLabel('quatroPontas') });
  }

  if (cfg.criteria.quinaPrimeiraLetra && !isCriterionClosed('quinaPrimeiraLetra') && Store.game.firstNumber !== null) {
    const colIdx = columnIndexForNumber(Store.game.firstNumber, cfg.min, cfg.max);
    if (colIdx !== null && checkCol(card.grid, colIdx)) {
      found.push({ key: 'quinaPrimeiraLetra', label: criterionLabel('quinaPrimeiraLetra') });
    }
  }

  if (cfg.criteria.quina && !isCriterionClosed('quina') && checkQuina(card.grid, cfg.quinaTipo)) {
    found.push({ key: 'quina', label: criterionLabel('quina') });
  }

  const existingKeys = card.achievements.map((a) => a.key);
  const newOnes = found.filter((f) => !existingKeys.includes(f.key));
  const drawIndex = Store.game.drawnNumbers.length;
  const drawnNumber = Store.game.drawnNumbers[drawIndex - 1] ?? null;

  for (const f of newOnes) {
    card.achievements.push({ key: f.key, label: f.label, drawIndex, drawnNumber, confirmed: false, expired: false });
  }

  return newOnes.map((f) => ({ key: f.key, label: f.label, drawIndex, drawnNumber }));
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

/**
 * Marks a card's achievement as confirmed (the prize was actually
 * handed out). Until this happens the win stays "pending" — the game
 * keeps going and the card keeps appearing as a winner, since a
 * pending win might turn out to not be the legitimate one once
 * compared against other cards' draw order (see evaluateCard).
 *
 * `prize` is a free-text description of what was awarded (e.g. "1º
 * prêmio - Liquidificador"). Confirming several achievements with the
 * same prize text is exactly how more than one simultaneous winner
 * gets linked to a single prize — there's no separate "prize" entity,
 * just a shared label written onto each winning achievement.
 */
function confirmAchievement(cardId, key, prize) {
  const card = Store.cards.find((c) => c.id === cardId);
  if (!card) return;
  const achievement = card.achievements.find((a) => a.key === key);
  if (!achievement) return;
  achievement.confirmed = true;
  achievement.prize = (prize || '').trim();
  Store.saveCards();
}

/**
 * Achievements still within their window to be confirmed — completed
 * on the number that was JUST drawn, not yet superseded by a later
 * draw. Sorted so the earliest completion (the fairest winner, if more
 * than one card ties) shows first.
 */
function pendingAchievements() {
  const list = [];
  for (const card of activeCards()) {
    for (const a of card.achievements) {
      if (!a.confirmed && !a.expired && !isCriterionClosed(a.key)) list.push({ card, ...a });
    }
  }
  list.sort((a, b) => a.drawIndex - b.drawIndex);
  return list;
}

/**
 * Achievements that were never confirmed before another number was
 * drawn — the card "passou batido" for that criterion and it no longer
 * counts. Kept as a visible log (most recent first) so the operator can
 * see who missed their moment.
 */
function expiredAchievements() {
  const list = [];
  for (const card of activeCards()) {
    for (const a of card.achievements) {
      if (!a.confirmed && a.expired && !isCriterionClosed(a.key)) list.push({ card, ...a });
    }
  }
  list.sort((a, b) => b.drawIndex - a.drawIndex);
  return list;
}

/* ---------------- Near-miss ("faltando 1 número") ---------------- */

function unmarkedValue(cells) {
  const unmarked = cells.filter((c) => !isMarked(c));
  if (unmarked.length === 1) return Number(unmarked[0].value);
  return null;
}

/**
 * Returns every criterion this card is exactly one number away from
 * completing, so the operator can watch for it live instead of only
 * finding out after someone shouts "Bingo!".
 */
function evaluateNearMiss(card) {
  const cfg = Store.config;
  const grid = card.grid;
  const results = [];

  if (cfg.criteria.cheia && !isCriterionClosed('cheia')) {
    const val = unmarkedValue(grid.flat());
    if (val !== null) results.push({ label: 'Cartela Cheia', neededNumber: val });
  }

  if (cfg.criteria.quatroPontas && !isCriterionClosed('quatroPontas')) {
    const corners = [grid[0][0], grid[0][4], grid[4][0], grid[4][4]];
    const val = unmarkedValue(corners);
    if (val !== null) results.push({ label: 'Quatro Pontas', neededNumber: val });
  }

  if (cfg.criteria.quinaPrimeiraLetra && !isCriterionClosed('quinaPrimeiraLetra') && Store.game.firstNumber !== null) {
    const colIdx = columnIndexForNumber(Store.game.firstNumber, cfg.min, cfg.max);
    if (colIdx !== null) {
      const val = unmarkedValue(colCells(grid, colIdx));
      if (val !== null) results.push({ label: `Quina da letra ${LETTERS[colIdx]}`, neededNumber: val });
    }
  }

  if (cfg.criteria.quina && !isCriterionClosed('quina')) {
    const tipo = cfg.quinaTipo;
    const lines = [];
    if (tipo === 'horizontal' || tipo === 'todos') {
      for (let r = 0; r < 5; r++) lines.push({ cells: rowCells(grid, r), label: 'Quina (linha)' });
    }
    if (tipo === 'transversal' || tipo === 'todos') {
      for (let c = 0; c < 5; c++) lines.push({ cells: colCells(grid, c), label: `Quina (coluna ${LETTERS[c]})` });
    }
    if (tipo === 'diagonal' || tipo === 'todos') {
      lines.push({ cells: diagCells(grid, 0), label: 'Quina (diagonal)' });
      lines.push({ cells: diagCells(grid, 1), label: 'Quina (diagonal)' });
    }
    for (const line of lines) {
      const val = unmarkedValue(line.cells);
      if (val !== null) results.push({ label: line.label, neededNumber: val });
    }
  }

  return results;
}

function findNearMisses() {
  const list = [];
  for (const card of activeCards()) {
    for (const miss of evaluateNearMiss(card)) list.push({ card, ...miss });
  }
  return list;
}

/**
 * A card one number away from TWO different criteria at once still
 * counts as a single card — this is what should drive any "how many
 * cards are close to winning" count, as opposed to the raw near-miss
 * list length, which is naturally the sum across criteria.
 */
function distinctNearMissCardCount() {
  return new Set(findNearMisses().map((m) => m.card.id)).size;
}

/* ---------------- End game ---------------- */

function endGame() {
  const finishedGameId = Store.game.id;
  const cardsInGame = Store.cards.filter((c) => c.gameId === finishedGameId);
  const winners = [];
  for (const card of cardsInGame) {
    card.status = 'used';
    for (const a of card.achievements) {
      winners.push({
        name: card.name,
        cardNumber: card.cardNumber,
        criterion: a.label,
        prize: a.prize || '',
        confirmed: a.confirmed,
      });
    }
  }
  Store.saveCards();

  Store.history.push({
    gameId: finishedGameId,
    startedAt: Store.game.startedAt,
    endedAt: new Date().toISOString(),
    drawnNumbers: Store.game.drawnNumbers.slice(),
    cardsCount: cardsInGame.length,
    winners,
  });
  Store.saveHistory();

  Store.game = { id: finishedGameId + 1, drawnNumbers: [], firstNumber: null, startedAt: null, closedCriteria: {}, prizes: [], revealedCount: 0 };
  Store.saveGame();
}

/**
 * The only way a card that's already been used (or is mid-game) can
 * ever become available again — every card, regardless of its current
 * status, goes back to stock with no participant, ready to be handed
 * out again via "Entregar". The card's own identity (its numbers and
 * printed card number) is never touched, only its game/participant
 * state — registering a card is a one-time action forever, but
 * *playing* a card can restart. Whatever game is in progress gets
 * archived to history first, same as ending it normally, so no draws
 * or winners are silently lost.
 */
function restartAllCards() {
  const hasGameInProgress = Store.game.drawnNumbers.length > 0 || Store.cards.some((c) => c.gameId === Store.game.id);
  if (hasGameInProgress) endGame();

  for (const card of Store.cards) {
    card.status = 'stock';
    card.gameId = null;
    card.name = '';
    card.achievements = [];
    for (const row of card.grid) {
      for (const cell of row) {
        cell.marked = cell.free;
      }
    }
  }
  Store.saveCards();
}

/* ---------------- Dashboard ---------------- */

/**
 * Turns the flat game history into the counts a dashboard actually
 * needs: how long games took, and how many finished per day/month/year
 * (keyed as 'YYYY-MM-DD' / 'YYYY-MM' / 'YYYY' so callers can sort and
 * format them without re-parsing dates).
 */
function dashboardStats() {
  const games = Store.history;
  const durationsMs = [];
  const byDay = new Map();
  const byMonth = new Map();
  const byYear = new Map();

  for (const g of games) {
    if (g.startedAt && g.endedAt) {
      const ms = new Date(g.endedAt) - new Date(g.startedAt);
      if (ms > 0) durationsMs.push(ms);
    }
    if (!g.endedAt) continue;
    const iso = g.endedAt;
    const dayKey = iso.slice(0, 10);
    const monthKey = iso.slice(0, 7);
    const yearKey = iso.slice(0, 4);
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + 1);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
    byYear.set(yearKey, (byYear.get(yearKey) || 0) + 1);
  }

  const avgDurationMs = durationsMs.length
    ? durationsMs.reduce((sum, v) => sum + v, 0) / durationsMs.length
    : 0;
  const totalCards = games.reduce((sum, g) => sum + g.cardsCount, 0);
  const totalConfirmedPrizes = games.reduce(
    (sum, g) => sum + g.winners.filter((w) => w.confirmed).length, 0
  );

  return { totalGames: games.length, avgDurationMs, totalCards, totalConfirmedPrizes, byDay, byMonth, byYear };
}
