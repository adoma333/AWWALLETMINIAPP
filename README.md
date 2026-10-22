<p align="center"><img src="brand/logo-wordmark-on-black.png" alt="ZOHRA WALLET" width="420"></p>

<p align="center"><b>A multi-chain crypto wallet inside Telegram</b> — 10 networks · free instant transfers · gifts · swap · P2P with escrow · Zohra AI · full admin panel</p>

---

## ⚡ التثبيت بأمر واحد · One-command install

On a fresh **Ubuntu 22.04/24.04 or Debian 12** server, with a domain (or sub-domain) pointing to it:

```bash
curl -fsSL https://raw.githubusercontent.com/adoma333/AWWALLETMINIAPP/claude/aw-wallet-telegram-mini-app-9c2043/setup.sh | sudo bash
```

The installer asks for:

1. the bot token from @BotFather;
2. your Telegram ID (admin);
3. the domain;
4. an e-mail for HTTPS;
5. an optional Anthropic API key for Zohra AI;
6. whether to create a new master wallet or import one.

It then installs everything (Python, Node, nginx, a Let's Encrypt certificate, and systemd services), builds the app and starts the bot. Run it again at any time to update. Your settings and wallet are kept.

> After this branch is merged into `main`, replace the branch name in the URL with `main` and set `AW_BRANCH=main`.
> If the repository is private, clone it yourself into `/opt/aw-wallet` (with a token) and then run `sudo bash /opt/aw-wallet/setup.sh`.

### بالعربية

1. **أنشئ البوت.** أنشئ بوتًا من ‎@BotFather بالأمر ‎/newbot وانسخ التوكن.
2. **اربط الدومين.** وجّه دومينًا أو ساب‌دومين إلى IP الخادم بسجل A.
3. **شغّل أمر التثبيت.** شغّل الأمر أعلاه على الخادم وأجب عن الأسئلة: التوكن، رقم حسابك في تيليجرام، الدومين، البريد، ومفتاح Claude الاختياري.
4. **احفظ العبارة السرية.** عند إنشاء المحفظة ستظهر **24 كلمة مرة واحدة فقط**. اكتبها على ورق واحفظها بعيدًا عن الإنترنت، فهي تتحكم بكل الأموال.
5. **افتح البوت.** افتح البوت واضغط Start، فزر المحفظة يظهر في القائمة.
6. **ادخل لوحة الإدارة.** أرسل ‎/admin للبوت لتحصل على رابط دخول لمرة واحدة.
7. **موّل المحافظ الساخنة قبل السحب التلقائي.** السحب يبدأ **يدويًا** على كل الشبكات، أي أنك توافق على كل طلب وتدفعه بنفسك. اجعل الشبكة «تلقائي» من «العملات والشبكات» فقط بعد تمويل محافظ الخزينة بعملة الرسوم (gas). عناوين هذه المحافظ تجدها في صفحة الخزينة أو بالأمر `aw-wallet hot-wallets`.

### Management

```
aw-wallet status | logs | restart | update | doctor | backup | hot-wallets | ledger-audit | add-admin <id> <role> | env
```

A database backup runs every day at 03:17 and is kept for 14 days. **To restore the wallet you need both** `backend/.env` (`SECRETS_KEY`) and `data/keys/master.enc`, or the 24 words.

---

## Features

**Wallet**
- One HD master seed (BIP-39/44/84) with a personal deposit address per user.
- Each user has **one EVM address shared by Ethereum, BNB Chain, Polygon, Arbitrum, Base and Avalanche**, plus TRON, Solana and Bitcoin (SegWit) addresses.
- TON uses one wallet with a personal memo.
- 10 networks with native coins and major tokens: USDT, USDC, DAI, FDUSD and more, on every network where they exist.
- Unknown tokens are detected, held, and credited automatically once the admin lists the contract.

**Transfers**
- Instant, free transfers to `@username` or a Telegram ID.
- Native Telegram **contact picker**.
- Sending to another user's deposit address becomes an internal free transfer automatically.

**Gifts**
- Links locked to one person, to a `@username`, to a secret word, or open group red packets.
- Delivered as the sender's own personal message (Bot API `savePreparedInlineMessage` / `shareMessage`).

**TON Connect**
- Deposit directly from Tonkeeper, Telegram Wallet and other TON wallets.
- Withdraw to the connected wallet in one tap.

**Swap**
- Firm quotes with a countdown.
- Best-for-platform price from Binance, OKX, Bybit, KuCoin and CoinGecko, with a deviation guard.
- Spread controlled by the admin.
- Inventory guard.

**P2P**
- Escrow, payment windows, and seller terms with counterparty conditions (verified phone, minimum orders, account age).
- Chat with proof uploads.
- Appeals with **human arbitration**: the admin decides with an AI summary of the dispute in front of them.
- Reviews and merchant stats.

**Fees**
- Rules with precedence *user → role → pair → coin-on-network → network → coin → global*.
- VIP tiers by 30-day volume.
- Time-boxed promotions and fee-free vouchers.
- Controllable badges ("no fees", "instant").

**Growth**
- Two-level referral with commission tiers.
- Welcome and first-transaction vouchers, daily check-in streaks, missions.

**Zohra AI**
- Built on Claude.
- Reads the user's own balances, deposits and withdrawals in real time.
- Guides step by step and shows suggestion chips.
- Includes a "suggest a payment method" form.
- Escalates to a human ticket.
- Falls back to built-in FAQ mode without an API key.

**Security**
- Telegram `initData` HMAC verification.
- 6-digit PIN plus biometrics, with lockouts.
- 24-hour hold after a PIN reset.
- Address whitelist mode.
- Risk engine that routes risky withdrawals to review.
- Daily auto-payout circuit breaker.
- Encrypted master seed and sensitive fields.
- Append-only ledger with self-audit.
- Every admin action is audited.

**UX**
- Zero-input sign-up showing the Telegram name and photo.
- Automatic language from the device: **14 languages** (en, ar, ru, tr, fa, fr, es, pt, de, id, hi, zh, uk, uz), with RTL support.
- Haptics, signed shareable receipts.
- Opened outside Telegram, it shows a QR code and a link into the bot.

**Admin panel** (`/admin/`)
- Dashboard.
- Users: freeze, limits, VIP, vouchers, balance adjustments, messages.
- Withdrawal queue: approve, reject, mark paid, retry.
- Deposits needing attention.
- Treasury and solvency, sweeps, revenue.
- P2P arbitration.
- Support tickets, forms and KYC.
- Coins, networks and tokens (enable or disable, payout mode, RPC).
- Fees, VIP levels and promotions.
- Every setting section (multilingual texts, badges, banners).
- Icon uploads, broadcasts, team roles, audit log, system health.

## Project layout

```
setup.sh               one-command installer
deploy/                systemd units, nginx, aw-wallet CLI, update/doctor
backend/aw/            FastAPI app, worker, chain adapters (chains/), ledger, fees, swap, p2p, AI …
backend/tests/         47 tests (flows, ledger invariants, chain signing)
frontend/src/          Telegram Mini App (React + Vite), locales/*.json
frontend/admin/        admin panel (second page of the same build)
brand/                 logo files
```

## Development

```bash
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt
pytest -q                                   # 47 tests
cp .env.example .env                        # fill in, then:
uvicorn aw.main:app --reload                # API on :8000
python -m aw.worker                         # background jobs
cd ../frontend && npm install && npm run dev   # mini app on :5173, admin on :5173/admin/
npm run check:i18n                          # every language has every key
```

## ⚠️ Honest status — read before handling real money

- The ledger, fees, swap, transfers, gifts, P2P escrow, referral and rewards logic are covered by automated tests, and the ledger audits itself.
- **The blockchain integrations have not been tested against live networks yet.** They were built from the protocols and verified with mocks and independent signature checks. This covers deposit scanning, signing and broadcasting on EVM, TRON, Solana, Bitcoin and TON. The development environment had no network access to RPC nodes.
- Before going live:
  1. Test deposits and withdrawals with **small amounts on every network**.
  2. Keep networks in **manual** payout mode until each one is confirmed.
  3. Use private RPC endpoints, such as Alchemy, QuickNode, a TronGrid key or a Toncenter key, set in `aw-wallet env`.
- A custodial wallet may require a licence where you operate. Check the local regulations.
