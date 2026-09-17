const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../auth');

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

module.exports = router;
