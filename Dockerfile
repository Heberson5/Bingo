# Static site (plain HTML/CSS/JS, no build step, no back-end) served by Nginx.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-common.conf /etc/nginx/snippets/bingo-common.conf
COPY nginx-security-headers.conf /etc/nginx/snippets/bingo-security-headers.conf

COPY index.html /usr/share/nginx/html/index.html
COPY display.html /usr/share/nginx/html/display.html
COPY manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY sw.js /usr/share/nginx/html/sw.js
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY icons/ /usr/share/nginx/html/icons/

# Browsers cache css/js for 1h (see nginx.conf) — without this, a
# redeploy can sit invisible behind a stale cached copy of js/ui.js for
# up to an hour, and *only* for people who already had the app open
# before the deploy (which is exactly what happened testing the
# previous fix: the server was already updated, but the browser kept
# running old JS from cache). Stamping index.html's own css/js
# references with a build-time timestamp forces the browser to fetch
# fresh copies on the very next load, with no manual version bump to
# remember. This RUN sits right after COPYing the files it stamps, so
# Docker's layer cache reruns it (and generates a fresh stamp) exactly
# when those files' content actually changed.
RUN STAMP=$(date +%s) && \
    sed -i "s#\(href=\"css/[^\"]*\)\"#\1?v=${STAMP}\"#g; s#\(src=\"js/[^\"]*\)\"#\1?v=${STAMP}\"#g" \
    /usr/share/nginx/html/index.html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
