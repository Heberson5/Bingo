const prisma = require('./prisma');

/**
 * Configurações de privacidade da organização (uma só, definida pelo
 * Master) — ficam em AppSetting "privacy".
 *  - telaoName: como o nome do ganhador aparece em telas públicas
 *    ('primeiro' = "Maria S.", 'cartela' = só o número da cartela,
 *    'completo' = nome inteiro).
 *  - retentionDays: depois de quantos dias do fim da partida os nomes
 *    dos participantes são apagados (0 = nunca).
 *  - orgName / dpoName / dpoEmail: aparecem na Política de Privacidade.
 */
const DEFAULT_PRIVACY = {
  telaoName: 'primeiro',
  retentionDays: 90,
  auditRetentionDays: 180,
  orgName: '',
  dpoName: '',
  dpoEmail: '',
};

const TELAO_NAME_MODES = ['primeiro', 'cartela', 'completo'];

function sanitizePrivacy(value) {
  const v = value && typeof value === 'object' ? value : {};
  const str = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
  const days = (n, fallback, allowed) => {
    const x = Number(n);
    return Number.isInteger(x) && allowed.includes(x) ? x : fallback;
  };
  return {
    telaoName: TELAO_NAME_MODES.includes(v.telaoName) ? v.telaoName : DEFAULT_PRIVACY.telaoName,
    retentionDays: days(v.retentionDays, DEFAULT_PRIVACY.retentionDays, [0, 7, 30, 90, 180, 365]),
    auditRetentionDays: days(v.auditRetentionDays, DEFAULT_PRIVACY.auditRetentionDays, [90, 180, 365]),
    orgName: str(v.orgName, 120),
    dpoName: str(v.dpoName, 120),
    dpoEmail: str(v.dpoEmail, 160),
  };
}

async function getPrivacy() {
  const row = await prisma.appSetting.findUnique({ where: { key: 'privacy' } });
  return sanitizePrivacy(row ? row.value : null);
}

/** Nome do ganhador como pode aparecer em público (telão), conforme a configuração. */
function publicWinnerName(name, cardNumber, mode) {
  const card = cardNumber ? `Cartela nº ${cardNumber}` : 'Cartela premiada';
  const clean = String(name || '').trim();
  if (mode === 'cartela' || !clean) return card;
  if (mode === 'completo') return clean;
  const parts = clean.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

const ANON = '';

/**
 * Apaga os nomes de participantes de partidas encerradas há mais de
 * `olderThanDays` dias (0 = todas as encerradas). Mantém números,
 * prêmios e estatísticas — só o dado pessoal sai. Devolve quantos nomes
 * foram apagados.
 */
async function anonymizeUser(userId, olderThanDays) {
  const [historyRow, cardsRow] = await Promise.all([
    prisma.userState.findUnique({ where: { userId_key: { userId, key: 'history' } } }),
    prisma.userState.findUnique({ where: { userId_key: { userId, key: 'cards' } } }),
  ]);
  const cutoff = Date.now() - olderThanDays * 86400000;
  let count = 0;

  const history = historyRow && Array.isArray(historyRow.value) ? historyRow.value : [];
  const oldGameIds = new Set();
  for (const g of history) {
    const ended = g.endedAt ? new Date(g.endedAt).getTime() : 0;
    if (olderThanDays > 0 && !(ended && ended < cutoff)) continue;
    oldGameIds.add(String(g.gameId));
    for (const w of g.winners || []) {
      if (w.name) { w.name = ANON; w.anonymized = true; count++; }
    }
  }

  const cards = cardsRow && Array.isArray(cardsRow.value) ? cardsRow.value : [];
  for (const c of cards) {
    if (c.status !== 'used') continue;
    const created = c.createdAt ? new Date(c.createdAt).getTime() : 0;
    const old = oldGameIds.has(String(c.gameId)) || (olderThanDays > 0 ? created && created < cutoff : true);
    if (old && c.name) { c.name = ANON; c.anonymized = true; count++; }
  }

  if (count > 0) {
    await prisma.$transaction([
      ...(historyRow ? [prisma.userState.update({ where: { userId_key: { userId, key: 'history' } }, data: { value: history } })] : []),
      ...(cardsRow ? [prisma.userState.update({ where: { userId_key: { userId, key: 'cards' } }, data: { value: cards } })] : []),
    ]);
  }
  return count;
}

module.exports = { DEFAULT_PRIVACY, sanitizePrivacy, getPrivacy, publicWinnerName, anonymizeUser };
