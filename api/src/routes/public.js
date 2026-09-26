const express = require('express');
const prisma = require('../prisma');

const router = express.Router();

/**
 * Reads the ball display data for a given user, with no authentication
 * at all — this is the route the fullscreen "tela de acompanhamento"
 * (display.html) calls, and it's meant to be opened on a DIFFERENT
 * device/browser than the one running the draw (no session, no token
 * available there). Exposes only what that screen actually needs
 * (numbers + suspense/reveal state), never cards, names or history.
 *
 * :userId is a UUID (not sequential/guessable) — acceptable exposure
 * for a private single-organizer event tool, not a public multi-tenant
 * service.
 */
router.get('/display/:userId', async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active || !user.activeSessionSince) {
    return res.json({ active: false });
  }

  const [gameRow, configRow] = await Promise.all([
    prisma.userState.findUnique({ where: { userId_key: { userId, key: 'game' } } }),
    prisma.userState.findUnique({ where: { userId_key: { userId, key: 'config' } } }),
  ]);
  const game = gameRow && gameRow.value ? gameRow.value : {};
  const config = configRow && configRow.value ? configRow.value : {};

  res.json({
    active: true,
    drawnNumbers: Array.isArray(game.drawnNumbers) ? game.drawnNumbers : [],
    revealedCount: typeof game.revealedCount === 'number' ? game.revealedCount : 0,
    min: typeof config.min === 'number' ? config.min : 1,
    max: typeof config.max === 'number' ? config.max : 75,
    suspenseMode: !!config.suspenseMode,
  });
});

module.exports = router;
