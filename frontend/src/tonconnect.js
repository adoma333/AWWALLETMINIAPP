// TON Connect (Telegram Wallet, Tonkeeper, MyTonWallet…) — loaded on demand to keep the first screen fast.
import { api } from './api';

let ui = null;

export async function getTC() {
  if (ui) return ui;
  const { TonConnectUI } = await import('@tonconnect/ui');
  ui = new TonConnectUI({ manifestUrl: `${location.origin}/tonconnect-manifest.json` });
  ui.onStatusChange(async (w) => {
    if (w?.account?.address) {
      try { await api.post('/api/ton/connect', { address: w.account.address, app: w.device?.appName || w.name || '' }); } catch { /* */ }
    }
  });
  return ui;
}

export async function connectTon() {
  const tc = await getTC();
  if (tc.connected) return tc.account?.address;
  await tc.openModal();
  return new Promise((resolve) => {
    const off = tc.onStatusChange((w) => { off(); resolve(w?.account?.address || null); });
    tc.onModalStateChange?.((s) => { if (s.status === 'closed' && !tc.connected) { off(); resolve(null); } });
  });
}

export async function disconnectTon() {
  const tc = await getTC();
  if (tc.connected) await tc.disconnect();
  await api.del('/api/ton/connect');
}

/** Build the deposit on the server (memo baked in) and ask the connected wallet to sign it. */
export async function depositFromTon(asset, amount) {
  const tc = await getTC();
  let sender = tc.account?.address;
  if (!sender) sender = await connectTon();
  if (!sender) return false;
  const msg = await api.post('/api/ton/deposit', { asset, amount, sender });
  await tc.sendTransaction({ validUntil: msg.valid_until, messages: msg.messages });
  return true;
}
