#!/usr/bin/env bash
# Pull the latest code, install dependencies, rebuild the frontend, restart. Settings, wallet and data are untouched.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="awwallet"
BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
echo "▸ backup first"; /usr/local/bin/aw-wallet backup || true
echo "▸ updating $BRANCH"
git -C "$APP_DIR" fetch -q origin "$BRANCH"
git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
UV_PYTHON_INSTALL_DIR="$APP_DIR/.python" uv pip install -q --python "$APP_DIR/.venv/bin/python" -r "$APP_DIR/backend/requirements.txt"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/frontend' && (npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error) && npm run -s build" >/dev/null
chmod -R o+rX "$APP_DIR/frontend/dist"
mkdir -p "$APP_DIR/releases" && chown "$APP_USER:$APP_USER" "$APP_DIR/releases" && chmod 755 "$APP_DIR/releases"

# refresh the nginx site (new routes ship with updates), keep the HTTPS certificate, roll back if the test fails
ENV_FILE="$APP_DIR/backend/.env"
DOMAIN="$(grep -E '^WEBAPP_URL=' "$ENV_FILE" | head -1 | sed -E 's#^WEBAPP_URL=https?://##; s#/.*##')"
PORT="$(grep -E '^AW_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2)"; PORT="${PORT:-8000}"
SITE=/etc/nginx/sites-available/aw-wallet.conf
if [ -n "$DOMAIN" ] && [ -f "$SITE" ]; then
  cp "$SITE" "$SITE.bak"
  sed "s#__DOMAIN__#$DOMAIN#g; s#__APP_DIR__#$APP_DIR#g; s#__PORT__#$PORT#g" "$APP_DIR/deploy/nginx.conf" > "$SITE"
  if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    certbot install --nginx --cert-name "$DOMAIN" --redirect -n >/dev/null 2>&1 || true
  fi
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; rm -f "$SITE.bak"
  else echo "! new nginx config failed its test — keeping the previous one"; mv "$SITE.bak" "$SITE"; systemctl reload nginx || true; fi
fi

install -m 755 "$APP_DIR/deploy/aw-wallet" /usr/local/bin/aw-wallet
sed -i "s#^APP_DIR=.*#APP_DIR=\"$APP_DIR\"#" /usr/local/bin/aw-wallet
systemctl restart aw-wallet aw-wallet-worker
echo "✓ updated to $(git -C "$APP_DIR" log -1 --format='%h %s')"
