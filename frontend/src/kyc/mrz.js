// ICAO 9303 MRZ reader — the same rules as the server (backend/aw/kyc.py), used for instant feedback while scanning.
const W = [7, 3, 1];
const DIGIT_FIX = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', B: '8', T: '7' };
const ALPHA_FIX = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 8: 'B' };
const LEN = { TD1: 30, TD2: 36, TD3: 44 };

export function checkDigit(s) {
  let t = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    const v = c >= '0' && c <= '9' ? +c : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 55 : 0;
    t += v * W[i % 3];
  }
  return String(t % 10);
}

const digits = (s) => s.replace(/[OQDILZSGBT]/g, (c) => DIGIT_FIX[c]);
const alpha = (s) => s.replace(/[012568]/g, (c) => ALPHA_FIX[c]);
const names = (f) => {
  const [sur, ...rest] = f.split(/<{3,}/)[0].split('<<'); // anything after a long filler run is OCR noise
  const clean = (x) => x.replace(/[012568]/g, (c) => ALPHA_FIX[c]).replace(/<+/g, ' ').trim();
  return [clean(sur), clean(rest.join('<<'))];
};

function date(yymmdd, kind) {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = +yymmdd.slice(0, 2);
  const now = new Date().getFullYear() % 100;
  const century = kind === 'birth' ? (yy > now ? 1900 : 2000) : (yy < 70 ? 2000 : 1900);
  const iso = `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4)}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Clean raw OCR text into MRZ candidate lines (A–Z, 0–9 and '<' only). */
export function mrzLines(text) {
  return String(text || '').toUpperCase().replace(/«/g, '<').split(/\n+/)
    .map((l) => l.replace(/\s+/g, '').replace(/[KC]{3,}/g, (m) => '<'.repeat(m.length)).replace(/[^A-Z0-9<]/g, ''))
    .filter((l) => l.length >= 26);
}

const fit = (l, n) => (l.length >= n ? l.slice(0, n) : l + '<'.repeat(n - l.length));

export function parseMrz(input) {
  const ls = Array.isArray(input) ? input : mrzLines(input);
  let fmt = null;
  let lines = [];
  const near = (l, n) => Math.abs(l.length - n) <= 2;
  if (ls.length >= 3 && ls.slice(-3).every((l) => near(l, 30))) { fmt = 'TD1'; lines = ls.slice(-3); }
  else if (ls.length >= 2 && ls.slice(-2).every((l) => near(l, 44))) { fmt = 'TD3'; lines = ls.slice(-2); }
  else if (ls.length >= 2 && ls.slice(-2).every((l) => near(l, 36))) { fmt = 'TD2'; lines = ls.slice(-2); }
  if (!fmt) return { valid: false, format: null };
  lines = lines.map((l) => fit(l, LEN[fmt]));
  let num; let numCd; let birth; let birthCd; let exp; let expCd; let comp; let compCd; let sur; let given; let nat; let issuer; let sex;
  if (fmt === 'TD1') {
    const [l1, l2, l3] = lines;
    num = l1.slice(5, 14); numCd = digits(l1[14]);
    const opt = l1.slice(15, 30);
    if (numCd === '<' && opt) { const ext = opt.split('<')[0]; num += ext.slice(0, -1); numCd = digits(ext.slice(-1)); }
    birth = digits(l2.slice(0, 6)); birthCd = digits(l2[6]); exp = digits(l2.slice(8, 14)); expCd = digits(l2[14]);
    comp = l1.slice(5, 30) + digits(l2.slice(0, 7)) + digits(l2.slice(8, 15)) + l2.slice(18, 29); compCd = digits(l2[29]);
    [sur, given] = names(l3); nat = l2.slice(15, 18); issuer = l1.slice(2, 5); sex = l2[7];
  } else {
    const [l1, l2] = lines;
    const end = fmt === 'TD3' ? 43 : 35;
    num = l2.slice(0, 9); numCd = digits(l2[9]);
    birth = digits(l2.slice(13, 19)); birthCd = digits(l2[19]); exp = digits(l2.slice(21, 27)); expCd = digits(l2[27]);
    comp = l2.slice(0, 10) + digits(l2.slice(13, 20)) + digits(l2.slice(21, 28)) + l2.slice(28, end); compCd = digits(l2[end]);
    [sur, given] = names(l1.slice(5)); nat = l2.slice(10, 13); issuer = l1.slice(2, 5); sex = l2[20];
  }
  const checks = { number: checkDigit(num) === numCd, birth: checkDigit(birth) === birthCd, expiry: checkDigit(exp) === expCd, composite: checkDigit(comp) === compCd };
  return {
    valid: Object.values(checks).every(Boolean), format: fmt, checks, lines,
    doc_number: num.replace(/</g, ''), surname: sur, given_names: given, nationality: alpha(nat).replace(/</g, ''), issuer: alpha(issuer).replace(/</g, ''),
    sex: sex === 'M' || sex === 'F' ? sex : 'X', birth_date: date(birth, 'birth'), expiry_date: date(exp, 'expiry'),
  };
}
