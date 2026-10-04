#!/bin/sh
# Cópia de segurança diária do banco do Bingo.
#  - pg_dump | gzip | openssl (AES-256-CBC, chave derivada com PBKDF2)
#  - grava em /backups (pasta ./backups no host)
#  - apaga cópias mais antigas que BACKUP_KEEP_DAYS
# Sem BACKUP_PASSPHRASE não grava nada: a cópia tem dados pessoais
# (nomes de participantes, e-mails) e, pela LGPD, não pode ficar aberta.
set -u
HOUR="${BACKUP_HOUR:-3}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
DIR="${BACKUP_DIR:-/backups}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

run_backup() {
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "[backup] BACKUP_PASSPHRASE não definido no .env — backup NÃO feito (veja o README)."
    return 1
  fi
  mkdir -p "$DIR"
  STAMP=$(date +%Y-%m-%d_%H%M)
  OUT="$DIR/bingo_${STAMP}.sql.gz.enc"
  if pg_dump -h "${PGHOST:-postgres}" -U bingo -d bingo --no-owner --clean --if-exists \
      | gzip -9 \
      | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -out "$OUT.tmp"; then
    mv "$OUT.tmp" "$OUT"
    chmod 600 "$OUT"
    echo "[backup] ok: $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
    find "$DIR" -name 'bingo_*.sql.gz.enc' -type f -mtime +"$KEEP" -print -delete | sed 's/^/[backup] removido (antigo): /'
  else
    rm -f "$OUT.tmp"
    echo "[backup] FALHOU — o banco está no ar?"
    return 1
  fi
}

# Espera o Postgres aceitar conexões, faz uma cópia logo ao subir e
# depois uma por dia no horário BACKUP_HOUR (horário do container, UTC
# se TZ não for definido).
until pg_isready -h "${PGHOST:-postgres}" -U bingo -q; do sleep 3; done
run_backup
while true; do
  NOW=$(date +%s)
  NEXT=$(date -d "$(date +%Y-%m-%d) $(printf %02d "$HOUR"):00:00" +%s 2>/dev/null || echo 0)
  [ "$NEXT" -le "$NOW" ] && NEXT=$((NEXT + 86400))
  [ "$NEXT" -le "$NOW" ] && NEXT=$((NOW + 86400))
  sleep $((NEXT - NOW))
  run_backup
done
