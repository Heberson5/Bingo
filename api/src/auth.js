const jwt = require('jsonwebtoken');
const prisma = require('./prisma');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  // Falha alto e cedo: sem esses segredos qualquer token seria
  // assinado/verificado com "undefined", o que é inseguro e confuso.
  throw new Error('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET precisam estar definidos no ambiente.');
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    active: user.active,
  };
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, typ: 'refresh' }, REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

/** Exige um access token valido; anexa o usuario carregado do banco em req.user. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

/** Usar depois de requireAuth — bloqueia quem nao for master. */
function requireMaster(req, res, next) {
  if (req.user.role !== 'master') return res.status(403).json({ error: 'forbidden' });
  next();
}

module.exports = {
  ACCESS_SECRET,
  REFRESH_SECRET,
  publicUser,
  signAccessToken,
  signRefreshToken,
  requireAuth,
  requireMaster,
};
