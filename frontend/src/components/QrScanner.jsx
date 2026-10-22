import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { haptic } from '../telegram';
import Icon from './Icon';

// In-app QR scanner: used wherever Telegram's native scanner is missing (Desktop, macOS, web, standalone apps).
// Camera frames are decoded with the browser's BarcodeDetector when it exists, otherwise with jsQR (loaded on demand).
// A photo of a QR code can be picked instead of using the camera.

let pending = null;
export function openScanner(text) {
  return new Promise((resolve) => {
    pending = resolve;
    window.dispatchEvent(new CustomEvent('aw:scan', { detail: { text } }));
  });
}

async function decoder() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) {
        const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (src) => (await bd.detect(src))[0]?.rawValue || null;
      }
    } catch { /* fall through */ }
  }
  const jsQR = (await import('jsqr')).default;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return async (src) => {
    const w = src.videoWidth || src.naturalWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) return null;
    const k = Math.min(1, 720 / Math.max(w, h));
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
  };
}

export function QrScannerHost() {
  const { t } = useI18n();
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const video = useRef(null);
  const stream = useRef(null);
  const file = useRef(null);

  useEffect(() => {
    const on = (e) => { setErr(''); setOpen(e.detail || {}); };
    window.addEventListener('aw:scan', on);
    return () => window.removeEventListener('aw:scan', on);
  }, []);

  const finish = (value) => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    setOpen(null);
    const r = pending; pending = null;
    r?.(value);
  };

  useEffect(() => {
    if (!open) return undefined;
    let stop = false;
    (async () => {
      const detect = await decoder();
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      } catch {
        setErr(t('camera_denied'));
        return;
      }
      if (stop) { stream.current.getTracks().forEach((tr) => tr.stop()); return; }
      const v = video.current;
      v.srcObject = stream.current;
      await v.play().catch(() => {});
      const tick = async () => {
        if (stop || !stream.current) return;
        try {
          const value = v.readyState >= 2 ? await detect(v) : null;
          if (value) { haptic.success(); finish(value); return; }
        } catch { /* keep scanning */ }
        setTimeout(tick, 180);
      };
      tick();
    })();
    return () => { stop = true; stream.current?.getTracks().forEach((tr) => tr.stop()); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromFile = async (f) => {
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode().catch(() => {});
    const value = await (await decoder())(img).catch(() => null);
    URL.revokeObjectURL(img.src);
    if (value) { haptic.success(); finish(value); } else { haptic.error(); setErr(t('scan_no_code')); }
  };

  if (!open) return null;
  return (
    <div className="scanner qr-scan" role="dialog" aria-modal="true">
      <video ref={video} playsInline muted />
      <div className="scan-shade"><div className="qr-frame"><i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" /><span className="qr-line" /></div></div>
      <div className="scan-top">
        <button type="button" className="ic n" onClick={() => finish(null)} aria-label={t('close')}><Icon name="x" size={20} /></button>
        <b style={{ fontSize: 16 }}>{open.text || t('scan')}</b><span />
      </div>
      <div className="scan-bottom">
        <div className="scan-msg">{err || t('scan_hint_qr')}</div>
        <button type="button" className="btn s sm" style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }} onClick={() => file.current?.click()}>
          <Icon name="image" size={17} />{t('scan_from_photo')}</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}
