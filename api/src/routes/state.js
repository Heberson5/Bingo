const express = require('express');
const prisma = require('../prisma');
const { requireAuth, requireMaster } = require('../auth');

const router = express.Router();

// Exatamente as 4 chaves que js/state.js grava no localStorage hoje —
// ver STORAGE_KEYS nesse arquivo. Qualquer chave fora dessa lista é
// rejeitada, então o backend nunca vira um "storage genérico" aberto.
const STATE_KEYS = ['config', 'game', 'cards', 'history'];

/**
 * Resolve de quem é o estado sendo pedido: o próprio usuário logado,
 * ou — só para o master, e só leitura — outro usuário via ?as=<id>.
 */
function resolveTarget(req) {
  const asUserId = req.query.as;
  if (asUserId && req.user.role === 'master') {
    return { userId: String(asUserId), readOnly: String(asUserId) !== req.user.id };
  }
  return { userId: req.user.id, readOnly: false };
}

router.get('/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  if (!STATE_KEYS.includes(key)) return res.status(404).json({ error: 'not_found' });

  const { userId } = resolveTarget(req);
  const row = await prisma.userState.findUnique({ where: { userId_key: { userId, key } } });
  res.json({ value: row ? row.value : null });
});

router.put('/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  if (!STATE_KEYS.includes(key)) return res.status(404).json({ error: 'not_found' });

  const { userId, readOnly } = resolveTarget(req);
  if (readOnly) return res.status(403).json({ error: 'read_only' });

  if (!('value' in (req.body || {}))) return res.status(400).json({ error: 'invalid_request' });
  const { value } = req.body;

  await prisma.userState.upsert({
    where: { userId_key: { userId, key } },
    update: { value },
    create: { userId, key, value },
  });
  res.json({ ok: true });
});

/**
 * Master-only: every user's finished-games history at once, each game
 * tagged with whose it is — the per-user GET /history above only ever
 * returns whichever single user Session.viewingUserId points at.
 */
router.get('/history/all', requireAuth, requireMaster, async (req, res) => {
  const [users, rows] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    prisma.userState.findMany({ where: { key: 'history' } }),
  ]);
  const historyByUser = new Map(rows.map((r) => [r.userId, Array.isArray(r.value) ? r.value : []]));
  const users_ = users.map((u) => ({
    userId: u.id,
    userName: u.name,
    userEmail: u.email,
    games: historyByUser.get(u.id) || [],
  }));
  res.json({ users: users_ });
});

/**
 * Master-only: delete one finished game from a given user's history.
 * Matched by gameId, since that's the number ("Jogo #N") the operator
 * actually recognizes it by — there's no separate row-level id for
 * history entries (see js/state.js endGame()).
 */
router.delete('/history/:userId/:gameId', requireAuth, requireMaster, async (req, res) => {
  const { userId, gameId } = req.params;
  const row = await prisma.userState.findUnique({ where: { userId_key: { userId, key: 'history' } } });
  const history = row && Array.isArray(row.value) ? row.value : [];
  const filtered = history.filter((g) => String(g.gameId) !== String(gameId));
  if (filtered.length === history.length) return res.status(404).json({ error: 'not_found' });

  await prisma.userState.upsert({
    where: { userId_key: { userId, key: 'history' } },
    update: { value: filtered },
    create: { userId, key: 'history', value: filtered },
  });
  res.json({ ok: true });
});

/**
 * Master-only: fixes up a user's live "Jogo #N" counter to continue
 * right after the highest game number still saved in their history —
 * useful after deleting one or more games above, so the next round
 * doesn't reuse (or leave a gap after) a number that no longer exists.
 * Each user's numbering is independent (see js/state.js DEFAULT_GAME /
 * endGame) — this only ever touches the one user given.
 */
router.post('/reset-counter/:userId', requireAuth, requireMaster, async (req, res) => {
  const { userId } = req.params;
  const [historyRow, gameRow] = await Promise.all([
    prisma.userState.findUnique({ where: { userId_key: { userId, key: 'history' } } }),
    prisma.userState.findUnique({ where: { userId_key: { userId, key: 'game' } } }),
  ]);
  const history = historyRow && Array.isArray(historyRow.value) ? historyRow.value : [];
  const maxId = history.reduce((max, g) => Math.max(max, Number(g.gameId) || 0), 0);
  const nextId = maxId + 1;

  const game = gameRow && gameRow.value ? gameRow.value : {
    drawnNumbers: [], firstNumber: null, startedAt: null, closedCriteria: {}, prizes: [], revealedCount: 0,
  };
  game.id = nextId;

  await prisma.userState.upsert({
    where: { userId_key: { userId, key: 'game' } },
    update: { value: game },
    create: { userId, key: 'game', value: game },
  });
  res.json({ ok: true, nextId });
});

module.exports = router;
