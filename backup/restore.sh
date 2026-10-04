#!/bin/sh
# Restaura uma cópia: docker compose exec backup restore.sh bingo_AAAA-MM-DD_HHMM.sql.gz.enc
# ATENÇÃO: substitui todo o conteúdo atual do banco pelo da cópia.
set -eu
FILE="${BACKUP_DIR:-/backups}/${1:?informe o arquivo, ex: bingo_2026-10-04_0300.sql.gz.enc}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"
[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "BACKUP_PASSPHRASE não definido"; exit 1; }
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | gunzip \
  | psql -h "${PGHOST:-postgres}" -U bingo -d bingo -v ON_ERROR_STOP=1 -q
echo "Restaurado: $FILE"
