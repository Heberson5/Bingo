const { PrismaClient } = require('@prisma/client');

// Uma unica instancia reaproveitada por toda a API (padrao recomendado
// pelo proprio Prisma) em vez de um "new PrismaClient()" por arquivo.
const prisma = new PrismaClient();

module.exports = prisma;
