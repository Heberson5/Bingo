#!/bin/sh
# Liga o HTTPS sozinho quando o certificado do domínio já existe.
# O nginx do container sobe normalmente sem ele (acesso por http/IP);
# depois de emitir o certificado com o Certbot no host (ver README),
# basta reiniciar o container para este bloco entrar.
set -e
DOMAIN="${BINGO_DOMAIN:-bingo.sauberlich.com.br}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
CONF="/etc/nginx/conf.d/bingo-https.conf"

if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
  cat > "${CONF}" <<NGINX
server {
    listen 443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:BingoSSL:5m;

    include /etc/nginx/snippets/bingo-common.conf;
}
NGINX
  echo "[bingo] HTTPS ativado para ${DOMAIN}"
else
  rm -f "${CONF}"
  echo "[bingo] Certificado de ${DOMAIN} não encontrado — servindo só HTTP (veja a seção HTTPS do README)."
fi
