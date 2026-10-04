const prisma = require('./prisma');
const { getPrivacy, anonymizeUser } = require('./privacy');

/**
 * Rotina diária de retenção (LGPD art. 15 e 16: dado pessoal não fica
 * guardado além do necessário):
 *  - apaga os nomes de participantes de partidas encerradas há mais de
 *    `retentionDays` dias;
 *  - apaga do registro de atividades o que passou de `auditRetentionDays`.
 */
async function runRetention() {
  const privacy = await getPrivacy();
  let names = 0;
  if (privacy.retentionDays > 0) {
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const u of users) names += await anonymizeUser(u.id, privacy.retentionDays);
  }
  const auditCutoff = new Date(Date.now() - privacy.auditRetentionDays * 86400000);
  const { count: logs } = await prisma.auditLog.deleteMany({ where: { at: { lt: auditCutoff } } });
  if (names || logs) console.log(`[retencao] ${names} nome(s) de participante apagado(s), ${logs} registro(s) de atividade antigo(s) removido(s).`);
  return { names, logs };
}

function scheduleRetention() {
  const run = () => runRetention().catch((err) => console.error('[retencao] falhou:', err.message));
  setTimeout(run, 30 * 1000); // logo depois de subir
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = { runRetention, scheduleRetention };
