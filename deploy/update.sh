#!/usr/bin/env bash
# Pull the latest code, install dependencies, rebuild the apps, refresh nginx, restart. Settings, wallet and data stay.
# The whole script is one function, so bash has read all of it before `git reset` replaces this file; after pulling it
# re-runs the NEW version of itself, so every update always runs with the newest steps.
set -euo pipefail

main() {
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  APP_USER="awwallet"
  LOG="/var/log/aw-wallet-update.log"
  B=$'\e[1m'; G=$'\e[32m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'
  step() { echo "${B}▸ $*${N}"; }
  fail() { echo "${R}✗ $*${N}"; echo "${D}Full log: $LOG${N}"; tail -n 40 "$LOG" 2>/dev/null || true; exit 1; }
  : > "$LOG"

  # Download the build GitHub Actions made for exactly this commit into $1. Waits up to 10 min for it to finish.
  fetch_build() {
    local dest="$1" url branch sha tmp i got
    url="$(git -C "$APP_DIR" remote get-url origin | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##; s#https://[^@/]*@#https://#')"
    case "$url" in https://github.com/*) ;; *) return 1 ;; esac
    branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"; sha="$(git -C "$APP_DIR" rev-parse HEAD)"
    url="$url/releases/download/web-${branch//\//-}"
    tmp="$(mktemp -d)"
    step "downloading the app built on GitHub (${sha:0:7})"
    for i in $(seq 1 40); do
      if curl -fsSL --retry 2 -o "$tmp/b.tgz" "$url/web-dist.tar.gz" 2>>"$LOG" \
         && curl -fsSL -o "$tmp/b.sha" "$url/web-dist.sha256" 2>>"$LOG" \
         && [ "$(sha256sum "$tmp/b.tgz" | cut -d' ' -f1)" = "$(tr -d '[:space:]' < "$tmp/b.sha")" ]; then
        got="$(tar -xzOf "$tmp/b.tgz" ./commit.txt 2>/dev/null | tr -d '[:space:]')"
        if [ "$got" = "$sha" ]; then
          mkdir -p "$dest" && tar -xzf "$tmp/b.tgz" -C "$dest" && rm -rf "$tmp" && return 0
        fi
        [ "$i" = 1 ] && echo "  waiting for GitHub to finish building ${sha:0:7} (Actions → Web build)…"
      fi
      sleep 15
    done
    echo "${D}  GitHub build not found — building here instead${N}"
    rm -rf "$tmp" "$dest"; return 1
  }

  if [ "${1:-}" != "--pulled" ]; then
    BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
    BEFORE="$(git -C "$APP_DIR" rev-parse --short HEAD)"
    step "backup"; /usr/local/bin/aw-wallet backup >>"$LOG" 2>&1 || echo "${D}  (backup skipped)${N}"
    step "downloading the latest version ($BRANCH)"
    git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
    git -C "$APP_DIR" fetch -q origin "$BRANCH" >>"$LOG" 2>&1 || fail "git fetch failed (network or repository access)"
    git -C "$APP_DIR" reset -q --hard "origin/$BRANCH" >>"$LOG" 2>&1 || fail "git reset failed"
    AFTER="$(git -C "$APP_DIR" rev-parse --short HEAD)"
    if [ "$BEFORE" = "$AFTER" ]; then echo "  already on $AFTER — rebuilding anyway"; else echo "  $BEFORE → $AFTER"; fi
    exec bash "$APP_DIR/deploy/update.sh" --pulled
  fi

  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  step "backend dependencies"
  UV_PYTHON_INSTALL_DIR="$APP_DIR/.python" uv pip install -q --python "$APP_DIR/.venv/bin/python" -r "$APP_DIR/backend/requirements.txt" >>"$LOG" 2>&1 \
    || fail "installing Python packages failed"

  # The app is built on GitHub Actions (.github/workflows/web.yml) and downloaded here; the server only builds it
  # itself when that download is not possible (AW_LOCAL_BUILD=1 forces it). The new build goes to dist.new and is
  # swapped in with two renames, so the live app never disappears while updating.
  FRONT="$APP_DIR/frontend"; NEW="$FRONT/dist.new"; rm -rf "$NEW" "$FRONT/dist.old"
  if [ "${AW_LOCAL_BUILD:-0}" != "1" ] && fetch_build "$NEW"; then :
  else
    step "building the app on this server (slow — GitHub build not available)"
    sudo -u "$APP_USER" -H bash -c "cd '$FRONT' && (npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error) && npm run build -- --outDir dist.new --emptyOutDir" >>"$LOG" 2>&1 \
      || fail "the frontend build failed"
  fi
  [ -f "$NEW/index.html" ] || fail "build produced no index.html"
  chmod -R o+rX "$NEW"
  [ -d "$FRONT/dist" ] && mv "$FRONT/dist" "$FRONT/dist.old"
  mv "$NEW" "$FRONT/dist"
  rm -rf "$FRONT/dist.old"
  mkdir -p "$APP_DIR/releases" && chown "$APP_USER:$APP_USER" "$APP_DIR/releases" && chmod 755 "$APP_DIR/releases"

  step "web server"
  ENV_FILE="$APP_DIR/backend/.env"
  DOMAIN="$(grep -E '^WEBAPP_URL=' "$ENV_FILE" | head -1 | sed -E 's#^WEBAPP_URL=https?://##; s#/.*##')"
  PORT="$(grep -E '^AW_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2)"; PORT="${PORT:-8000}"
  SITE=/etc/nginx/sites-available/aw-wallet.conf
  if [ -n "$DOMAIN" ] && [ -f "$SITE" ]; then
    cp "$SITE" "$SITE.bak"
    sed "s#__DOMAIN__#$DOMAIN#g; s#__APP_DIR__#$APP_DIR#g; s#__PORT__#$PORT#g" "$APP_DIR/deploy/nginx.conf" > "$SITE"
    [ -d "/etc/letsencrypt/live/$DOMAIN" ] && { certbot install --nginx --cert-name "$DOMAIN" --redirect -n >>"$LOG" 2>&1 || true; }
    if nginx -t >>"$LOG" 2>&1; then systemctl reload nginx; rm -f "$SITE.bak"
    else echo "${R}  new nginx config failed its test — kept the previous one${N}"; mv "$SITE.bak" "$SITE"; systemctl reload nginx || true; fi
  fi

  install -m 755 "$APP_DIR/deploy/aw-wallet" /usr/local/bin/aw-wallet
  sed -i "s#^APP_DIR=.*#APP_DIR=\"$APP_DIR\"#" /usr/local/bin/aw-wallet

  step "restarting"
  systemctl restart aw-wallet aw-wallet-worker
  for i in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 1
    [ "$i" = 30 ] && fail "the API did not come back — see: aw-wallet logs"
  done

  BUILD="$(cat "$APP_DIR/frontend/dist/version.json" 2>/dev/null || echo '?')"
  echo "${G}✓ updated to $(git -C "$APP_DIR" log -1 --format='%h · %s' | cut -c1-90)${N}"
  echo "  app build: $BUILD"
  [ -n "$DOMAIN" ] && echo "  check: https://$DOMAIN/version.json should show the same build"
  echo "  Telegram keeps the old screen open until you close the Mini App and open it again."
}

main "$@"
