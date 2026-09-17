/**
 * Cria (ou, com SEED_MASTER_FORCE_RESET=true, redefine a senha d)o
 * usuario master a partir de variaveis de ambiente — nunca de um valor
 * fixo no codigo. Roda toda vez que o container da API sobe; se as
 * variaveis nao estiverem definidas ou o master ja existir (sem force
 * reset), simplesmente nao faz nada.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_MASTER_EMAIL || '').toLowerCase().trim();
  const password = process.env.SEED_MASTER_PASSWORD || '';
  const forceReset = process.env.SEED_MASTER_FORCE_RESET === 'true';

  if (!email || !password) {
    console.log('[seed] SEED_MASTER_EMAIL/SEED_MASTER_PASSWORD nao definidos — nenhum usuario master criado.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    if (forceReset) {
      await prisma.user.update({
        where: { email },
        data: { passwordHash, role: 'master', active: true, mustChangePassword: false },
      });
      console.log(`[seed] Senha do master ${email} redefinida.`);
    } else {
      console.log(`[seed] Usuario ${email} ja existe — nada alterado (use SEED_MASTER_FORCE_RESET=true para redefinir a senha).`);
    }
    return;
  }

  await prisma.user.create({
    data: { email, passwordHash, role: 'master', mustChangePassword: false },
  });
  console.log(`[seed] Usuario master ${email} criado.`);
}

main()
  .catch((err) => {
    console.error('[seed] Falhou:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
