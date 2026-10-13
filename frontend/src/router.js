import { useEffect, useState } from 'react';

// Hash router: works inside Telegram's WebView without server rewrites and keeps deep links (/#/tx/AW…) shareable.
export function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  return h.startsWith('/') ? h : `/${h}`;
}

export function go(path, replace = false) {
  const target = `#${path}`;
  if (replace) history.replaceState(null, '', target);
  else history.pushState(null, '', target);
  window.dispatchEvent(new Event('aw:route'));
  window.scrollTo(0, 0);
}

export function back(fallback = '/') {
  if (history.length > 1 && sessionStorage.getItem('aw_nav') === '1') history.back();
  else go(fallback, true);
}

export function useRoute() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => {
      sessionStorage.setItem('aw_nav', '1');
      setPath(currentPath());
    };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    window.addEventListener('aw:route', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
      window.removeEventListener('aw:route', on);
    };
  }, []);
  const [pathname, query = ''] = path.split('?');
  return { path: pathname, query: Object.fromEntries(new URLSearchParams(query)) };
}

/** match('/tx/:id', '/tx/AW123') → { id: 'AW123' } */
export function match(pattern, path) {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const out = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) out[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return out;
}
