const express = require('express');
const prisma = require('../prisma');
const { publicUser, requireAuth, requireMaster } = require('../auth');
const { logAudit } = require('../audit');
const { sanitizePrivacy, getPrivacy, anonymizeUser } = require('../privacy');

const router = express.Router();
router.use(requireAuth);

router.get('/settings', async (req, res) => {
  res.json({ value: await getPrivacy() });
});

router.put('/settings', requireMaster, async (req, res) => {
  const value = sanitizePrivacy((req.body || {}).value);
  await prisma.appSetting.upsert({
    where: { key: 'privacy' },
    update: { value },
    create: { key: 'privacy', value },
  });
  await logAudit(req, 'privacy_settings_update', { details: { telaoName: value.telaoName, retentionDays: value.retentionDays } });
  res.json({ value });
});

/**
 * Portabilidade / acesso (LGPD art. 18, II e V): tudo o que o sistema
 * guarda sobre o próprio usuário, num JSON só.
 */
router.get('/export', async (req, res) => {
  const states = await prisma.userState.findMany({ where: { userId: req.user.id } });
  const byKey = Object.fromEntries(states.map((s) => [s.key, s.value]));
  const logs = await prisma.auditLog.findMany({
    where: { actorId: req.user.id },
    orderBy: { at: 'desc' },
    take: 500,
    select: { at: true, action: true, target: true, ip: true },
  });
  await logAudit(req, 'data_export');
  res.setHeader('Content-Disposition', `attachment; filename="bingo-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    account: { ...publicUser(req.user), createdAt: req.user.createdAt },
    config: byKey.config ?? null,
    game: byKey.game ?? null,
    cards: byKey.cards ?? [],
    history: byKey.history ?? [],
    activityLog: logs,
  });
});

/**
 * Eliminação (LGPD art. 18, VI): apaga agora os nomes de participantes
 * de todas as partidas já encerradas. scope 'all' (só Master) faz isso
 * para todos os usuários.
 */
router.post('/anonymize', async (req, res) => {
  const scope = (req.body || {}).scope === 'all' ? 'all' : 'me';
  if (scope === 'all' && req.user.role !== 'master') return res.status(403).json({ error: 'forbidden' });
  const users = scope === 'all' ? await prisma.user.findMany({ select: { id: true } }) : [{ id: req.user.id }];
  let count = 0;
  for (const u of users) count += await anonymizeUser(u.id, 0);
  await logAudit(req, 'anonymize_participants', { details: { scope, count } });
  res.json({ ok: true, count });
});

module.exports = router;
