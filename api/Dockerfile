# API do Bingo: Express + Prisma. Sem etapa de build (JS puro) — só
# instala dependências, gera o client do Prisma e roda.
FROM node:20-alpine

WORKDIR /app

# node:20-alpine não vem com OpenSSL — sem ele o Prisma não consegue
# detectar a versão certa do "schema engine" e a migração falha em
# silêncio (erro genérico de parsing, nada óbvio nos logs).
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --omit=optional

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

EXPOSE 4000

# Cada start do container: aplica migrações pendentes, garante/atualiza
# o usuário master (seed é idempotente — não faz nada se já existir e
# SEED_MASTER_FORCE_RESET não estiver "true") e só então sobe a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js && node src/index.js"]
