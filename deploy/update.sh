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
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/frontend' && (npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error) && npm run -s build" >/dev/null
chmod -R o+rX "$APP_DIR/frontend/dist"
install -m 755 "$APP_DIR/deploy/aw-wallet" /usr/local/bin/aw-wallet
sed -i "s#^APP_DIR=.*#APP_DIR=\"$APP_DIR\"#" /usr/local/bin/aw-wallet
systemctl restart aw-wallet aw-wallet-worker
echo "✓ updated to $(git -C "$APP_DIR" log -1 --format='%h %s')"
