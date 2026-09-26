const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma');
const { REFRESH_SECRET, publicUser, signAccessToken, signRefreshToken, requireAuth } = require('../auth');
const { isPasswordStrong } = require('../passwordPolicy');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'invalid_request' });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  // Mesma mensagem de erro tanto para "nao existe" quanto para "senha
  // errada" — nao da pra um atacante descobrir quais e-mails tem conta.
  if (!user || !user.active) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  // Marca a sessão como ativa — é isto que a tela de acompanhamento
  // pública (ver routes/public.js) usa para saber se ainda há alguém
  // logado rodando esse jogo.
  await prisma.user.update({ where: { id: user.id }, data: { activeSessionSince: new Date() } });

  res.json({
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
    user: publicUser(user),
  });
});

/**
 * Chamado no logoff (manual ou automático por inatividade — ver
 * stopInactivityWatcher/performLogout em js/ui.js). Identifica o
 * usuário pelo refresh token em vez de exigir um access token válido,
 * porque o access token já pode ter expirado (15min) quando o logoff
 * acontece; o refresh token (30 dias) é o que realisticamente ainda
 * está disponível no cliente nesse momento.
 */
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.json({ ok: true }); // nada pra limpar
  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);
    await prisma.user.update({ where: { id: payload.sub }, data: { activeSessionSince: null } });
  } catch (err) {
    // Token inválido/expirado — não há sessão pra invalidar mesmo.
  }
  res.json({ ok: true });
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'invalid_request' });
  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);
    if (payload.typ !== 'refresh') throw new Error('wrong token type');
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) return res.status(401).json({ error: 'unauthorized' });
    res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!isPasswordStrong(newPassword)) return res.status(400).json({ error: 'weak_password' });

  // Se a troca nao foi forcada pelo Master (mustChangePassword), exige
  // a senha atual antes de aceitar a nova.
  if (!req.user.mustChangePassword) {
    const ok = currentPassword && (await bcrypt.compare(currentPassword, req.user.passwordHash));
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  res.json({ ok: true });
});

module.exports = router;
