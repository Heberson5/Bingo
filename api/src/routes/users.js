const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma');
const { publicUser, requireAuth, requireMaster } = require('../auth');

const router = express.Router();

// Tudo aqui exige estar logado E ser master — ver requireMaster.
router.use(requireAuth, requireMaster);

router.get('/', async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ users: users.map(publicUser) });
});

router.post('/', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6) return res.status(400).json({ error: 'invalid_request' });

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) return res.status(409).json({ error: 'email_taken' });

  const passwordHash = await bcrypt.hash(password, 12);
  // mustChangePassword: true — a senha provisoria dada pelo Master
  // precisa ser trocada no primeiro login do novo usuario.
  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash, mustChangePassword: true },
  });
  res.status(201).json({ user: publicUser(user) });
});

router.patch('/:id', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot_modify_self' });
  const { active } = req.body || {};
  const data = {};
  if (typeof active === 'boolean') data.active = active;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'invalid_request' });

  const user = await prisma.user.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json({ user: publicUser(user) });
});

router.patch('/:id/password', async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'weak_password' });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const user = await prisma.user
    .update({ where: { id: req.params.id }, data: { passwordHash, mustChangePassword: true } })
    .catch(() => null);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
