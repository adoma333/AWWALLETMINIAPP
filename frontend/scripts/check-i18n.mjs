// Verifies every locale has exactly the English keys and the same {placeholders}. Exit 1 on any problem.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(new URL('.', import.meta.url).pathname, '..', 'src', 'locales');
const en = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8'));
const ph = (s) => (String(s).match(/\{[a-z_]+\}/g) || []).sort().join(',');
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'en.json')) {
  const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const missing = Object.keys(en).filter((k) => !(k in d));
  const extra = Object.keys(d).filter((k) => !(k in en));
  const phErr = Object.keys(en).filter((k) => k in d && ph(en[k]) !== ph(d[k]));
  const same = Object.keys(en).filter((k) => k in d && d[k] === en[k] && /[a-z]{4,}/i.test(en[k]) && !/^(AW|P2P|IBAN|Revtag|RIP|VIP|TON|USDT)/.test(en[k]));
  if (missing.length || extra.length || phErr.length) bad += 1;
  console.log(`${f}: ${Object.keys(d).length} keys` + (missing.length ? ` · MISSING ${missing.join(', ')}` : '') + (extra.length ? ` · EXTRA ${extra.join(', ')}` : '')
    + (phErr.length ? ` · PLACEHOLDERS ${phErr.join(', ')}` : '') + (same.length > 25 ? ` · (${same.length} untranslated-looking)` : ''));
}
process.exit(bad ? 1 : 0);
