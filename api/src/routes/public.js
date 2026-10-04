const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const { getPrivacy, publicWinnerName } = require('../privacy');

const router = express.Router();

/*
 * Rotas SEM login — usadas pelo telão (display.html), pela "Minha
 * cartela" (cartela.html) e pela Política de Privacidade. Por serem
 * públicas, expõem só o mínimo necessário (LGPD art. 6º, III):
 * números, estado do sorteio e, no anúncio de ganhador, o nome já
 * reduzido conforme a configuração de privacidade — nunca a lista de
 * cartelas, nomes de participantes ou histórico.
 *
 * :userId é um UUID (não sequencial/adivinhável).
 */

async function loadLive(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active || !user.activeSessionSince) return null;
  const rows = await prisma.userState.findMany({ where: { userId, key: { in: ['game', 'config', 'cards'] } } });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const game = byKey.game || {};
  const config = byKey.config || {};
  const drawn = Array.isArray(game.drawnNumbers) ? game.drawnNumbers : [];
  const revealedCount = typeof game.revealedCount === 'number' ? game.revealedCount : 0;
  const revealed = config.suspenseMode ? drawn.slice(0, Math.min(revealedCount, drawn.length)) : drawn;
  return { game, config, cards: Array.isArray(byKey.cards) ? byKey.cards : [], drawn, revealedCount, revealed };
}

router.get('/display/:userId', async (req, res) => {
  const live = await loadLive(req.params.userId);
  if (!live) return res.json({ active: false });
  const { game, config } = live;

  let announcement = null;
  const a = game.announcement;
  if (a && a.id) {
    const privacy = await getPrivacy();
    announcement = {
      id: String(a.id),
      at: a.at || null,
      name: publicWinnerName(a.name, a.cardNumber, privacy.telaoName),
      cardNumber: a.cardNumber || '',
      criterion: a.criterion || '',
      prize: a.prize || '',
      grid: Array.isArray(a.grid) ? a.grid : null,
    };
  }

  res.json({
    active: true,
    drawnNumbers: live.drawn,
    revealedCount: live.revealedCount,
    min: typeof config.min === 'number' ? config.min : 1,
    max: typeof config.max === 'number' ? config.max : 75,
    suspenseMode: !!config.suspenseMode,
    telaoMode: config.telaoMode === 'bola' ? 'bola' : 'completo',
    voice: !!(config.voice && config.voice.telao),
    prize: typeof game.activePrize === 'string' ? game.activePrize : '',
    gameId: game.id || null,
    announcement,
  });
});

// "Minha cartela": consulta por número da cartela. Limite próprio para
// ninguém varrer todos os números (a resposta não tem nome, mas ainda
// assim não há motivo para permitir isso).
const cardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

const normalizeNumber = (s) => String(s || '').trim().replace(/^0+(?=\d)/, '');

router.get('/card/:userId/:cardNumber', cardLimiter, async (req, res) => {
  const live = await loadLive(req.params.userId);
  if (!live) return res.json({ active: false });
  const wanted = normalizeNumber(req.params.cardNumber).slice(0, 12);
  const card = live.cards.find((c) => c.status === 'active' && c.cardNumber && normalizeNumber(c.cardNumber) === wanted);
  if (!wanted || !card || !Array.isArray(card.grid)) return res.json({ active: true, found: false, drawnCount: live.revealed.length });

  const revealed = new Set(live.revealed);
  const grid = card.grid.map((row) => row.map((cell) => ({
    value: cell.free ? null : cell.value,
    free: !!cell.free,
    marked: !!cell.free || revealed.has(cell.value),
  })));
  const flat = grid.flat();
  res.json({
    active: true,
    found: true,
    cardNumber: card.cardNumber,
    min: typeof live.config.min === 'number' ? live.config.min : 1,
    max: typeof live.config.max === 'number' ? live.config.max : 75,
    grid,
    marked: flat.filter((c) => c.marked).length,
    total: flat.length,
    drawnCount: live.revealed.length,
    lastNumber: live.revealed.length ? live.revealed[live.revealed.length - 1] : null,
    achievements: (card.achievements || []).filter((x) => !x.expired).map((x) => ({ label: x.label, confirmed: !!x.confirmed })),
  });
});

// Dados para a página de Política de Privacidade.
router.get('/privacy', async (req, res) => {
  const p = await getPrivacy();
  res.json({
    orgName: p.orgName,
    dpoName: p.dpoName,
    dpoEmail: p.dpoEmail,
    retentionDays: p.retentionDays,
    auditRetentionDays: p.auditRetentionDays,
    telaoName: p.telaoName,
  });
});

module.exports = router;
