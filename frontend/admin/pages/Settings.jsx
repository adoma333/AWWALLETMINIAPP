import { useMemo, useState } from 'react';
import { ActBtn, Btn, can, Card, fileToDataUrl, Input, JsonEdit, Loading, post, put, Tabs, Toggle, useAction, useLoad } from '../lib.jsx';

const LANGS = ['en', 'ar', 'ru', 'tr', 'fa', 'fr', 'es', 'pt', 'de', 'id', 'hi', 'zh', 'uk', 'uz'];

const SECTIONS = [
  ['general', 'General', 'App name, maintenance mode, links, languages, feature switches, home badges and banners.'],
  ['limits', 'Limits & review', 'Per-verification-level USD limits and when withdrawals go to manual review.'],
  ['security', 'Security', 'PIN rules, lockouts, holds after security changes, rate limits.'],
  ['swap', 'Swap & spread', 'The spread (your margin inside the rate), quote lifetime, price sources and safety guards.'],
  ['transfers', 'Transfers', 'Internal transfers between users (free by default).'],
  ['gifts', 'Gifts', 'Gift links and group red packets.'],
  ['p2p', 'P2P', 'Fiat currencies, coins, maker/taker fees, payment windows, merchant criteria, cancellation bans.'],
  ['referral', 'Referral', 'Commission shares, tiers, duration and the welcome bonus for invited friends.'],
  ['rewards', 'Rewards', 'Daily check-in, first-transaction bonus, welcome voucher and missions.'],
  ['ai', 'Zohra AI assistant', 'Assistant name, effort, daily limit, extra instructions, known issues and suggestion chips.'],
  ['branding', 'Branding', 'Brand colours, logo and welcome text.'],
  ['ton_connect', 'TON Connect', 'Direct deposits from the user\'s own TON wallet.'],
  ['notifications', 'Admin alerts', 'When the admin channel gets alerts.'],
];

// short explanations shown next to well-known keys
const HELP = {
  maintenance: 'Shows a maintenance screen to all users (admins still get in).',
  spread_pct: 'Your margin built into every swap rate, in %. Users see one clean rate.',
  fee_pct: 'Optional fee on top, shown separately.',
  quote_ttl_sec: 'How long a quoted rate stays locked.',
  price_mode: 'median | best_for_platform | best_for_user',
  max_source_deviation_pct: 'Pause a coin when price sources disagree by more than this.',
  inventory_guard: 'Refuse swaps that would exceed hot-wallet inventory.',
  auto_approve_usd: 'Automatic payouts up to this value (networks in auto mode).',
  first_withdraw_review: 'A user\'s first withdrawal always waits for review.',
  new_address_review_usd: 'First withdrawal to a new address above this → review.',
  daily_auto_cap_usd: 'Platform-wide cap on automatic payouts per day (circuit breaker).',
  level1_pct: 'Share of the platform revenue from a direct referral.',
  level2_pct: 'Share from friends of friends.',
  maker_fee_pct: 'Fee charged to the ad owner (seller side) per completed order.',
  taker_fee_pct: 'Fee charged to the order taker.',
  price_guard_pct: 'Ads must be within ± this % of the market price.',
  auto_release_hours: '0 = never release automatically.',
  effort: 'low | medium | high — deeper answers cost more.',
  extra_instructions: 'Extra rules appended to the assistant\'s instructions.',
  model: 'Empty = AI_MODEL from the server .env',
  pin_required: 'Actions that require PIN/biometrics.',
  transfer_pin_threshold_usd: '0 = always ask for the PIN on transfers.',
};

const TEMPLATES = {
  'general.badges': { key: 'new', enabled: true, icon: 'bolt', text: { en: '' } },
  'general.banners': { id: '', image: '', title: { en: '' }, body: { en: '' }, link: '', enabled: true, until: 0 },
  'ai.known_issues': { title: { en: '' }, answer: { en: '' } },
  'ai.suggestions': { key: '', text: { en: '' } },
  'referral.tiers': { min_friends: 0, level1_pct: '30' },
  'rewards.missions': { id: '', event: 'deposit', target: 1, reward: { kind: 'fee_free', kinds: ['withdraw'], uses: 1, days: 30 }, title: { en: '' } },
};

const isLangText = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'en' in v && Object.keys(v).every((k) => LANGS.includes(k));
const label = (k) => k.replace(/_/g, ' ').replace(/\busd\b/i, 'USD').replace(/\bpct\b/, '%');

function blank(v) {
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
  if (typeof v === 'boolean') return false;
  if (typeof v === 'number') return 0;
  return '';
}

function LangText({ value, onChange }) {
  const [all, setAll] = useState(false);
  const shown = all ? LANGS : LANGS.filter((l) => l === 'en' || l === 'ar' || value[l]);
  return (
    <div className="lang-text">
      {shown.map((l) => (
        <div key={l} className="row gap"><span className="lang-tag">{l}</span>
          <Input value={value[l] || ''} dir={l === 'ar' || l === 'fa' ? 'rtl' : 'ltr'}
            onChange={(v) => { const n = { ...value, [l]: v }; if (!v && l !== 'en') delete n[l]; onChange(n); }} />
        </div>
      ))}
      {!all && <button type="button" className="link" onClick={() => setAll(true)}>+ all {LANGS.length} languages</button>}
    </div>
  );
}

function ImageInput({ value, onChange }) {
  const act = useAction();
  return (
    <div className="row gap">
      {value && <img src={value} alt="" className="thumb" />}
      <Input value={value} onChange={onChange} placeholder="https://… or upload" />
      <label className="btn ghost sm">Upload<input type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const r = await act(async () => post('/upload', { data: await fileToDataUrl(f), folder: 'banners' }), { ok: 'Uploaded' });
        if (r?.url) onChange(r.url);
      }} /></label>
    </div>
  );
}

function Value({ path, k, value, onChange }) {
  if (typeof value === 'boolean') return <Toggle on={value} onChange={onChange} />;
  if (typeof value === 'number') return <Input type="number" value={value} onChange={(v) => onChange(v === '' ? 0 : Number(v))} />;
  if (typeof value === 'string') {
    if (['image', 'logo_url', 'icon_url'].includes(k)) return <ImageInput value={value} onChange={onChange} />;
    if (k === 'extra_instructions') return <textarea className="inp" rows={4} value={value} onChange={(e) => onChange(e.target.value)} />;
    return <Input value={value} onChange={onChange} />;
  }
  if (isLangText(value)) return <LangText value={value} onChange={onChange} />;
  if (Array.isArray(value)) {
    const tpl = TEMPLATES[path];
    if (tpl || (value.length && typeof value[0] === 'object')) return <List path={path} value={value} onChange={onChange} tpl={tpl || blank(value[0])} />;
    const nums = value.length && typeof value[0] === 'number';
    return <Input value={value.join(', ')} onChange={(v) => onChange(v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (nums ? Number(x) : x)))} />;
  }
  if (value && typeof value === 'object' && Object.keys(value).length) return <Obj path={path} value={value} onChange={onChange} />;
  return <JsonEdit value={value} onChange={onChange} rows={3} />;
}

function Obj({ path, value, onChange }) {
  return (
    <div className="obj">
      {Object.entries(value).map(([k, v]) => {
        const p = path ? `${path}.${k}` : k;
        const inline = typeof v !== 'object' || v === null;
        return (
          <div key={k} className={'set-row' + (inline ? '' : ' block')}>
            <div className="set-k"><b>{label(k)}</b>{HELP[k] && <span className="dim small">{HELP[k]}</span>}</div>
            <div className="set-v"><Value path={p} k={k} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} /></div>
          </div>
        );
      })}
    </div>
  );
}

function List({ path, value, onChange, tpl }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="list-ed">
      <div className="row gap"><button type="button" className="link" onClick={() => setRaw(!raw)}>{raw ? 'Form view' : 'JSON view'}</button></div>
      {raw ? <JsonEdit value={value} onChange={onChange} rows={10} /> : value.map((item, i) => (
        <div key={i} className="list-item">
          <div className="list-h"><span className="dim">#{i + 1}</span>
            <div className="row gap">
              {i > 0 && <Btn small onClick={() => { const n = [...value]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>↑</Btn>}
              <Btn small onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Btn>
            </div>
          </div>
          {item && typeof item === 'object' ? <Obj path={path + '[]'} value={item} onChange={(nv) => onChange(value.map((x, j) => (j === i ? nv : x)))} />
            : <Input value={item} onChange={(nv) => onChange(value.map((x, j) => (j === i ? nv : x)))} />}
        </div>
      ))}
      {!raw && <Btn small onClick={() => onChange([...value, JSON.parse(JSON.stringify(tpl))])}>+ Add</Btn>}
    </div>
  );
}

export default function Settings({ me, sub }) {
  const { data, error, reload } = useLoad('/settings');
  const [sec, setSec] = useState(sub[0] || 'general');
  const [draft, setDraft] = useState({});
  const value = useMemo(() => draft[sec] ?? data?.settings?.[sec], [draft, sec, data]);
  if (!data) return <Loading error={error} reload={reload} />;
  const edit = can(me, 'settings');
  const dirty = draft[sec] !== undefined;
  const info = SECTIONS.find((s) => s[0] === sec);

  return (
    <div className="stack">
      <Tabs value={sec} onChange={(v) => { setSec(v); window.history.replaceState(null, '', '#/settings/' + v); }}
        items={SECTIONS.filter((s) => data.settings[s[0]]).map((s) => [s[0], s[1], draft[s[0]] ? '•' : null])} />
      <Card title={info?.[1]} right={edit && <>
        <ActBtn small ok="Reset to defaults" confirm="Discard all overrides of this section and use the built-in defaults?" onDone={() => { setDraft((d) => ({ ...d, [sec]: undefined })); reload(); }}
          run={() => put('/settings/' + sec, { value: {} })}>Reset defaults</ActBtn>
        {dirty && <Btn small onClick={() => setDraft((d) => ({ ...d, [sec]: undefined }))}>Discard</Btn>}
        <ActBtn small kind="primary" disabled={!dirty} ok="Saved — live within 5 seconds" onDone={() => { setDraft((d) => ({ ...d, [sec]: undefined })); reload(); }}
          run={() => put('/settings/' + sec, { value })}>Save</ActBtn>
      </>}>
        <p className="dim small">{info?.[2]}</p>
        <fieldset disabled={!edit} className="plain">
          {value && <Obj path={sec} value={value} onChange={(v) => setDraft((d) => ({ ...d, [sec]: v }))} />}
        </fieldset>
      </Card>
    </div>
  );
}
