# Backup diário do Postgres: pg_dump compactado e criptografado (AES-256).
FROM postgres:16-alpine
RUN apk add --no-cache openssl
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
CMD ["/usr/local/bin/backup.sh"]
