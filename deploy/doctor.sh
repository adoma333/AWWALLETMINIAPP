#!/usr/bin/env bash
# Health check: services, API, HTTPS, Telegram webhook, worker heartbeat, wallet, ledger.
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$APP_DIR/backend/.env"
g() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//'; }
pass() { echo -e "\e[32m✓\e[0m $*"; }
fail() { echo -e "\e[31m✗\e[0m $*"; }
for s in aw-wallet aw-wallet-worker nginx; do systemctl is-active -q "$s" && pass "$s running" || fail "$s not running (journalctl -u $s -n 50)"; done
curl -fsS -o /dev/null http://127.0.0.1:8000/api/health && pass "API answers locally" || fail "API not answering on 127.0.0.1:8000"
URL="$(g WEBAPP_URL)"
curl -fsS -o /dev/null "$URL/api/health" && pass "public HTTPS ok ($URL)" || fail "$URL/api/health not reachable — DNS / certificate?"
TOKEN="$(g BOT_TOKEN)"
WH="$(curl -fsS "https://api.telegram.org/bot$TOKEN/getWebhookInfo")"
echo "$WH" | grep -q "\"url\":\"$URL/api/tg/webhook\"" && pass "Telegram webhook set" || fail "webhook not set: $WH"
echo "$WH" | grep -q '"last_error_message"' && echo "   last webhook error: $(echo "$WH" | sed -nE 's/.*"last_error_message":"([^"]+)".*/\1/p')"
DB="$(g AW_DATA_DIR)/aw_wallet.db"
HB="$(sqlite3 "$DB" "SELECT value FROM scan_state WHERE key='worker:heartbeat'" 2>/dev/null)"
[ -n "$HB" ] && [ $(( $(date +%s) - ${HB%.*} )) -lt 180 ] && pass "worker heartbeat fresh" || fail "worker heartbeat stale/missing"
[ -f "$(g AW_DATA_DIR)/keys/master.enc" ] && pass "master wallet present" || fail "no master wallet — aw-wallet init-wallet"
/usr/local/bin/aw-wallet ledger-audit >/dev/null 2>&1 && pass "ledger consistent" || fail "ledger audit reported mismatches — aw-wallet ledger-audit"
