#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AW WALLET — one-command installer
#
#    curl -fsSL https://raw.githubusercontent.com/adoma333/AWWALLETMINIAPP/claude/aw-wallet-telegram-mini-app-9c2043/setup.sh | sudo bash
#
#  Fresh Ubuntu 22.04 / 24.04 or Debian 12 server with a domain pointing to it.
#  Asks for: bot token, admin Telegram ID(s), domain, e-mail (for HTTPS), optional Claude API key,
#  then installs everything (Python, Node, nginx, HTTPS, systemd services), creates or imports the
#  master wallet and starts the bot. Safe to run again: it updates the code and keeps your settings.
#
#  Every answer can be preset as an environment variable to run unattended:
#    BOT_TOKEN ADMIN_IDS DOMAIN EMAIL ANTHROPIC_API_KEY WALLET_MODE(generate|import|skip) AW_BRANCH
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="${AW_REPO:-https://github.com/adoma333/AWWALLETMINIAPP.git}"
BRANCH="${AW_BRANCH:-claude/aw-wallet-telegram-mini-app-9c2043}"
APP_DIR="${AW_DIR:-/opt/aw-wallet}"
APP_USER="awwallet"
ENV_FILE="$APP_DIR/backend/.env"

O=$'\e[38;5;208m'; G=$'\e[32m'; R=$'\e[31m'; D=$'\e[2m'; B=$'\e[1m'; N=$'\e[0m'
say()  { echo -e "${O}▸${N} $*"; }
ok()   { echo -e "${G}✓${N} $*"; }
warn() { echo -e "${O}!${N} $*"; }
die()  { echo -e "${R}✗ $*${N}" >&2; exit 1; }
TTY=/dev/tty
ask() {  # ask VAR "Question" [default] [secret]
  local var="$1" q="$2" def="${3:-}" secret="${4:-}" ans=""
  if [ -n "${!var:-}" ]; then return; fi
  [ -r "$TTY" ] || die "No terminal to ask \"$q\" — set $var=... in the environment."
  if [ -n "$def" ]; then q="$q ${D}[$def]${N}"; fi
  if [ -n "$secret" ]; then read -rsp "  $q: " ans < "$TTY"; echo; else read -rp "  $q: " ans < "$TTY"; fi
  printf -v "$var" '%s' "${ans:-$def}"
}
env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' || true; }

cat <<'BANNER'

     ▄▀█ █░█░█   █░█░█ ▄▀█ █░░ █░░ █▀▀ ▀█▀
     █▀█ ▀▄▀▄▀   ▀▄▀▄▀ █▀█ █▄▄ █▄▄ ██▄ ░█░     installer

BANNER

[ "$(id -u)" -eq 0 ] || die "Run as root:  curl -fsSL …/setup.sh | sudo bash"
command -v apt-get >/dev/null || die "This installer supports Ubuntu / Debian (apt)."

# ─────────────────────────── questions ───────────────────────────
FIRST_RUN=1
if [ -f "$ENV_FILE" ]; then
  FIRST_RUN=0
  ok "Existing installation found in $APP_DIR — updating (your settings are kept)."
  BOT_TOKEN="${BOT_TOKEN:-$(env_get BOT_TOKEN)}"
  ADMIN_IDS="${ADMIN_IDS:-$(env_get ADMIN_IDS)}"
  DOMAIN="${DOMAIN:-$(env_get WEBAPP_URL | sed -E 's#^https?://##; s#/.*$##')}"
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY-$(env_get ANTHROPIC_API_KEY)}"
  WALLET_MODE="${WALLET_MODE:-skip}"
  EMAIL="${EMAIL:-skip}"
else
  echo -e "${B}A few questions (about one minute):${N}\n"
  echo -e "  ${D}1. Bot token — create a bot with @BotFather → /newbot, copy the token.${N}"
  ask BOT_TOKEN "Bot token"
  echo -e "  ${D}2. Your Telegram numeric ID (send /start to @userinfobot). Several: comma-separated.${N}"
  ask ADMIN_IDS "Admin Telegram ID(s)"
  # no domain? a free sslip.io name that always resolves to this server's IP works with Telegram + Let's Encrypt
  PUBLIC_IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)"
  AUTO_DOMAIN=""
  [[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && AUTO_DOMAIN="wallet.${PUBLIC_IP//./-}.sslip.io"
  echo -e "  ${D}3. Domain pointing to this server (e.g. wallet.example.com).${N}"
  [ -n "$AUTO_DOMAIN" ] && echo -e "  ${D}   No domain? Press Enter to use the free address ${N}${B}$AUTO_DOMAIN${N}"
  ask DOMAIN "Domain" "$AUTO_DOMAIN"
  echo -e "  ${D}4. E-mail for the free HTTPS certificate (Let's Encrypt).${N}"
  ask EMAIL "E-mail"
  echo -e "  ${D}5. Optional: Anthropic API key — powers the AW AI assistant (press Enter to skip; FAQ mode is used).${N}"
  ask ANTHROPIC_API_KEY "Anthropic API key" "" secret
  echo -e "  ${D}6. Master wallet: [1] generate a new 24-word seed (recommended)  [2] import an existing seed${N}"
  [ -n "${WALLET_MODE:-}" ] || ask WALLET_CHOICE "Choose 1 or 2" "1"
  case "${WALLET_MODE:-${WALLET_CHOICE:-1}}" in 2|import) WALLET_MODE=import ;; skip) WALLET_MODE=skip ;; *) WALLET_MODE=generate ;; esac
fi
BOT_TOKEN="$(echo "$BOT_TOKEN" | tr -d '[:space:]')"
ADMIN_IDS="$(echo "$ADMIN_IDS" | tr -d '[:space:]')"
DOMAIN="$(echo "$DOMAIN" | tr -d '[:space:]' | sed -E 's#^https?://##; s#/.*$##')"
[[ "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || die "That doesn't look like a bot token."
[[ "$ADMIN_IDS" =~ ^-?[0-9]+(,-?[0-9]+)*$ ]] || die "Admin IDs must be numbers (comma-separated)."
[ -n "$DOMAIN" ] || die "A domain is required (Telegram Mini Apps need HTTPS)."

# ─────────────────────────── system packages ───────────────────────────
say "Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg openssl sqlite3 python3 python3-venv python3-dev build-essential \
  libffi-dev libssl-dev pkg-config nginx certbot python3-certbot-nginx >/dev/null
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  say "Installing Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "System packages ready (python $(python3 -V | cut -d' ' -f2), node $(node -v))"

# the API gets its own local port (default 8710); never collide with other apps on this server
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
AW_PORT="${AW_PORT:-$(env_get AW_PORT)}"
if [ -z "$AW_PORT" ]; then
  AW_PORT=8710
  while port_busy "$AW_PORT"; do AW_PORT=$((AW_PORT + 1)); done
elif port_busy "$AW_PORT" && ! systemctl is-active -q aw-wallet; then
  die "Port $AW_PORT is used by another program on this server. Set AW_PORT=<free port> and re-run."
fi
ok "API port: $AW_PORT"

# validate the token now so typos fail fast
BOT_JSON="$(curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getMe" || true)"
BOT_USERNAME="$(echo "$BOT_JSON" | sed -nE 's/.*"username":"([^"]+)".*/\1/p')"
[ -n "$BOT_USERNAME" ] || die "Telegram rejected the bot token. Check it in @BotFather."
ok "Bot @$BOT_USERNAME verified"

# ─────────────────────────── code ───────────────────────────
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/var/lib/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  say "Updating code ($BRANCH)…"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  say "Downloading AW Wallet ($BRANCH)…"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$APP_DIR/data/keys" "$APP_DIR/data/uploads" "$APP_DIR/data/backups"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

say "Installing Python dependencies…"
[ -d "$APP_DIR/.venv" ] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip wheel
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"
ok "Backend dependencies installed"

# ─────────────────────────── configuration ───────────────────────────
if [ "$FIRST_RUN" = 1 ]; then
  say "Writing configuration (backend/.env)…"
  umask 077
  cat > "$ENV_FILE" <<EOF
# AW Wallet configuration — written by setup.sh. Edit, then: aw-wallet restart
BOT_TOKEN=$BOT_TOKEN
BOT_USERNAME=$BOT_USERNAME
WEBAPP_URL=https://$DOMAIN
WEBHOOK_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
# SECRETS_KEY encrypts the master seed file — back it up together with data/keys/master.enc (or keep the 24 words)
SECRETS_KEY=$(openssl rand -hex 32)
ADMIN_IDS=$ADMIN_IDS
ADMIN_CHANNEL_ID=
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
AI_MODEL=claude-opus-5-5
AW_DATA_DIR=$APP_DIR/data
AW_PORT=$AW_PORT
# Optional private RPC endpoints / API keys (public endpoints are used when empty)
RPC_ETH=
RPC_BSC=
RPC_POLYGON=
RPC_ARBITRUM=
RPC_BASE=
RPC_AVAX=
RPC_SOL=
TRON_API_KEY=
TONCENTER_API_KEY=
EOF
  umask 022
fi
grep -q "^AW_PORT=" "$ENV_FILE" || echo "AW_PORT=$AW_PORT" >> "$ENV_FILE"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$ENV_FILE"
chmod 700 "$APP_DIR/data" "$APP_DIR/data/keys"

run_cli() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/backend' && '$APP_DIR/.venv/bin/python' -m aw.cli $*"; }
run_cli seed-catalog >/dev/null

# ─────────────────────────── master wallet ───────────────────────────
if [ -f "$APP_DIR/data/keys/master.enc" ]; then
  ok "Master wallet already present — kept as is"
elif [ "$WALLET_MODE" = import ]; then
  echo -e "\n  ${B}Paste your 24-word recovery phrase${N} (input hidden):"
  read -rs SEED < "$TTY"; echo
  echo "$SEED" | sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/backend' && '$APP_DIR/.venv/bin/python' -m aw.cli import-wallet" || die "Import failed."
  unset SEED
  ok "Master wallet imported"
elif [ "$WALLET_MODE" = generate ]; then
  echo
  run_cli init-wallet
  if [ -r "$TTY" ]; then
    while true; do
      read -rp "  Type ${B}SAVED${N} once the 24 words are written down on paper: " A < "$TTY"
      [ "$A" = "SAVED" ] && break
    done
    clear 2>/dev/null || true
  fi
  ok "Master wallet created"
else
  warn "No master wallet yet — run:  aw-wallet init-wallet"
fi

# ─────────────────────────── frontend (mini app + admin) ───────────────────────────
say "Building the Mini App and admin panel…"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR/frontend' && (npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error) && npm run -s build" >/dev/null
ok "Frontend built"

# ─────────────────────────── services ───────────────────────────
say "Installing services…"
install -m 644 "$APP_DIR/deploy/aw-wallet.service" /etc/systemd/system/aw-wallet.service
install -m 644 "$APP_DIR/deploy/aw-wallet-worker.service" /etc/systemd/system/aw-wallet-worker.service
sed -i "s#/opt/aw-wallet#$APP_DIR#g; s#User=awwallet#User=$APP_USER#; s#Group=awwallet#Group=$APP_USER#; s#__PORT__#$AW_PORT#g" \
  /etc/systemd/system/aw-wallet.service /etc/systemd/system/aw-wallet-worker.service
install -m 755 "$APP_DIR/deploy/aw-wallet" /usr/local/bin/aw-wallet
sed -i "s#^APP_DIR=.*#APP_DIR=\"$APP_DIR\"#" /usr/local/bin/aw-wallet
cat > /etc/cron.d/aw-wallet-backup <<EOF
# daily database backup at 03:17, keeps 14 days
17 3 * * * root /usr/local/bin/aw-wallet backup >/dev/null 2>&1
EOF
systemctl daemon-reload
systemctl enable -q aw-wallet aw-wallet-worker

# ─────────────────────────── nginx + HTTPS ───────────────────────────
say "Configuring nginx for $DOMAIN…"
sed "s#__DOMAIN__#$DOMAIN#g; s#__APP_DIR__#$APP_DIR#g; s#__PORT__#$AW_PORT#g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/aw-wallet.conf
ln -sf /etc/nginx/sites-available/aw-wallet.conf /etc/nginx/sites-enabled/aw-wallet.conf
# other sites on this server (including nginx's default site) are left untouched
chmod o+x "$APP_DIR" "$APP_DIR/frontend" 2>/dev/null || true
chmod -R o+rX "$APP_DIR/frontend/dist"
nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx configuration test failed"; }
systemctl reload nginx || systemctl restart nginx
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full' >/dev/null; ufw allow OpenSSH >/dev/null; fi

if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  if [ "${EMAIL:-skip}" = skip ] || [ -z "${EMAIL:-}" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect >/dev/null 2>&1 \
      || warn "HTTPS certificate failed — check that $DOMAIN points to this server, then run: certbot --nginx -d $DOMAIN"
  else
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect >/dev/null 2>&1 \
      || warn "HTTPS certificate failed — check that $DOMAIN points to this server, then run: certbot --nginx -d $DOMAIN"
  fi
else
  certbot install --nginx --cert-name "$DOMAIN" --redirect --non-interactive >/dev/null 2>&1 || true
fi
[ -d "/etc/letsencrypt/live/$DOMAIN" ] && ok "HTTPS enabled for https://$DOMAIN"

# ─────────────────────────── start ───────────────────────────
say "Starting AW Wallet…"
systemctl restart aw-wallet aw-wallet-worker
for _ in $(seq 1 40); do curl -fsS -o /dev/null http://127.0.0.1:$AW_PORT/api/health 2>/dev/null && break; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:$AW_PORT/api/health 2>/dev/null && ok "API is up" || warn "API not answering yet — see: aw-wallet logs"

echo
echo -e "${O}═══════════════════════════════════════════════════════════════${N}"
echo -e "  ${B}AW WALLET is live${N}"
echo -e "  Bot:          https://t.me/$BOT_USERNAME   (press Start — the wallet button is in the menu)"
echo -e "  Mini App:     https://$DOMAIN"
echo -e "  Admin panel:  send ${B}/admin${N} to the bot → one-time login link"
echo
echo -e "  ${B}Hot wallets${N} (fund with gas coins before switching a network to automatic payouts):"
run_cli hot-wallets 2>/dev/null | sed 's/^/    /' || true
echo
echo -e "  Recommended in @BotFather:  /setinline (enable inline mode, used for gift messages)"
echo -e "                              /newapp     (optional: t.me/$BOT_USERNAME/wallet direct link → https://$DOMAIN)"
echo -e "  Manage:  aw-wallet status | logs | restart | update | backup | doctor | hot-wallets"
echo -e "${O}═══════════════════════════════════════════════════════════════${N}"
