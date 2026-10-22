// Thin, defensive wrapper over Telegram.WebApp (every call degrades gracefully on old clients / browsers).
export const tg = window.Telegram?.WebApp;
export const initData = tg?.initData || '';
export const tgUser = tg?.initDataUnsafe?.user || null;
export const startParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('tgWebAppStartParam') || '';
export const inTelegram = Boolean(initData);
const ver = (v) => Boolean(tg?.isVersionAtLeast?.(v));

export function setupTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (ver('7.7')) tg.disableVerticalSwipes?.();
  } catch { /* old client */ }
}

export const haptic = {
  tap: () => { try { tg?.HapticFeedback?.impactOccurred('light'); } catch { /* */ } },
  select: () => { try { tg?.HapticFeedback?.selectionChanged(); } catch { /* */ } },
  success: () => { try { tg?.HapticFeedback?.notificationOccurred('success'); } catch { /* */ } },
  error: () => { try { tg?.HapticFeedback?.notificationOccurred('error'); } catch { /* */ } },
  warn: () => { try { tg?.HapticFeedback?.notificationOccurred('warning'); } catch { /* */ } },
};

export function setColors(bg) {
  try {
    tg?.setHeaderColor?.(bg);
    tg?.setBackgroundColor?.(bg);
    if (ver('7.10')) tg?.setBottomBarColor?.(bg);
  } catch { /* */ }
}

export function backButton(show, onClick) {
  const b = tg?.BackButton;
  if (!b) return () => {};
  if (show) {
    b.show();
    b.onClick(onClick);
  } else b.hide();
  return () => { try { b.offClick(onClick); } catch { /* */ } };
}

export function openLink(url) {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function openTelegramLink(url) {
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function shareUrl(url, text = '') {
  openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

// Bot API 8.0: share a prepared inline message as the user (personal message with a button)
export function shareMessage(id) {
  return new Promise((resolve) => {
    if (!tg?.shareMessage || !ver('8.0')) return resolve(false);
    try { tg.shareMessage(id, (ok) => resolve(Boolean(ok))); } catch { resolve(false); }
  });
}

// Telegram's own scanner exists only in the phone apps; Desktop, macOS and the web get the in-app camera scanner.
const NATIVE_SCAN = new Set(['ios', 'android', 'android_x']);
export function scanQr(text) {
  return new Promise((resolve) => {
    const fallback = () => import('./components/QrScanner').then((m) => m.openScanner(text)).then(resolve);
    if (!tg?.showScanQrPopup || !NATIVE_SCAN.has(tg.platform) || !ver('6.4')) return fallback();
    try {
      tg.showScanQrPopup({ text }, (value) => {
        resolve(value);
        return true; // close after first scan
      });
    } catch { fallback(); }
  });
}

export function confirmPopup(message) {
  return new Promise((resolve) => {
    if (!tg?.showConfirm) return resolve(window.confirm(message));
    tg.showConfirm(message, (ok) => resolve(ok));
  });
}

export async function readClipboard() {
  if (tg?.readTextFromClipboard && ver('6.4')) {
    return new Promise((resolve) => tg.readTextFromClipboard((t) => resolve(t || '')));
  }
  try { return await navigator.clipboard.readText(); } catch { return ''; }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(el);
    return ok;
  }
}

export function closeApp() { tg?.close?.(); }

// ── Biometrics (Bot API 7.2+): a random token lives in the device's secure biometric storage ──
const bio = () => tg?.BiometricManager;
export function bioInit() {
  return new Promise((resolve) => {
    const b = bio();
    if (!b || !ver('7.2')) return resolve(null);
    if (b.isInited) return resolve(b);
    try { b.init(() => resolve(b)); } catch { resolve(null); }
  });
}
export async function bioAvailable() {
  const b = await bioInit();
  return Boolean(b?.isBiometricAvailable);
}
export async function bioEnable(reason) {
  const b = await bioInit();
  if (!b?.isBiometricAvailable) return null;
  const granted = await new Promise((r) => (b.isAccessGranted ? r(true) : b.requestAccess({ reason }, (ok) => r(ok))));
  if (!granted) return null;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, '0')).join('');
  const ok = await new Promise((r) => b.updateBiometricToken(token, (res) => r(res)));
  return ok ? token : null;
}
export async function bioAuth(reason) {
  const b = await bioInit();
  if (!b?.isBiometricAvailable || !b.isAccessGranted || !b.isBiometricTokenSaved) return null;
  return new Promise((r) => b.authenticate({ reason }, (ok, token) => r(ok ? token : null)));
}
export async function bioClear() {
  const b = await bioInit();
  if (b?.isBiometricTokenSaved) await new Promise((r) => b.updateBiometricToken('', () => r()));
}
