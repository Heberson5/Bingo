const prisma = require('./prisma');

/**
 * IP com o último bloco zerado (IPv4 "200.1.2.0", IPv6 com os 4 últimos
 * grupos zerados): basta para investigar abuso (de qual rede veio) sem
 * guardar o endereço exato da pessoa — minimização de dados (LGPD art. 6º, III).
 */
function truncateIp(ip) {
  if (!ip) return null;
  const clean = String(ip).replace(/^::ffff:/, '');
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (clean.includes(':')) return clean.split(':').slice(0, 4).join(':') + '::';
  return null;
}

/**
 * Grava uma linha no registro de atividades. Nunca derruba a requisição
 * por causa disso: se o banco falhar aqui, só loga no console.
 */
async function logAudit(req, action, { target = null, details = null, actor = null } = {}) {
  const user = actor || (req && req.user) || null;
  try {
    await prisma.auditLog.create({
      data: {
        action,
        target: target ? String(target) : null,
        details: details || undefined,
        actorId: user ? user.id : null,
        actorEmail: user ? user.email : null,
        ip: req ? truncateIp(req.ip) : null,
      },
    });
  } catch (err) {
    console.error('[audit] falha ao registrar', action, err.message);
  }
}

module.exports = { logAudit, truncateIp };
