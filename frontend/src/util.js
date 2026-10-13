// Recognise what was scanned/pasted: an AW gift/deep link, a payment URI, or a raw address of a known family.
export function detectFamily(a) {
  const s = String(a || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return 'evm';
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return 'tron';
  if (/^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i.test(s)) return 'btc';
  if (/^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(s) || /^-?\d:[0-9a-fA-F]{64}$/.test(s)) return 'ton';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return 'sol';
  return null;
}

export const FAMILY_NETWORKS = { evm: ['bsc', 'eth', 'polygon', 'arbitrum', 'base', 'avax'], tron: ['tron'], btc: ['btc'], ton: ['ton'], sol: ['sol'] };

export function parseScan(raw) {
  const s = String(raw || '').trim();
  const gift = s.match(/startapp=g_([A-Za-z0-9]+)/);
  if (gift) return { route: `/gift/${gift[1]}` };
  const tonUri = s.match(/^ton:\/\/transfer\/([^?]+)(\?.*)?$/);
  if (tonUri) {
    const q = new URLSearchParams(tonUri[2] || '');
    return { address: tonUri[1], network: 'ton', memo: q.get('text') || '' };
  }
  const uri = s.match(/^(ethereum|bitcoin|tron|solana):([^?@]+)/i);
  if (uri) return { address: uri[2], family: detectFamily(uri[2]) };
  const fam = detectFamily(s);
  if (fam) return { address: s, family: fam };
  const user = s.match(/^@?([A-Za-z0-9_]{5,32})$/);
  if (user) return { route: `/send/user?to=${user[1]}` };
  return null;
}
