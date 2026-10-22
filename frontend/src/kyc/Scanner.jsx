import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { useI18n } from '../i18n';
import { haptic } from '../telegram';

// Live camera with a document (or face) guide. Each ~200 ms it measures sharpness (Laplacian variance) and motion
// (frame difference) inside the guide; when the picture stays sharp and still the "steady" bar fills and the frame is
// captured automatically. A manual shutter and a photo-library fallback are always available.

const ASPECT = { card: 85.6 / 54, passport: 125 / 88, face: 3 / 4 };
const STEADY_MS = 900;

function measure(ctx, w, h, prev) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let s = 0; let s2 = 0; let n = 0; let diff = 0; let bright = 0; let blown = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const k = y * w + x;
      const lap = 4 * g[k] - g[k - 1] - g[k + 1] - g[k - w] - g[k + w];
      s += lap; s2 += lap * lap; n += 1;
    }
  }
  for (let k = 0; k < g.length; k += 1) { bright += g[k]; if (g[k] > 250) blown += 1; if (prev) diff += Math.abs(g[k] - prev[k]); }
  const mean = s / n;
  return { sharp: s2 / n - mean * mean, motion: prev ? diff / g.length : 99, light: bright / g.length, glare: blown / g.length, gray: g };
}

export default function Scanner({ mode = 'card', facing = 'environment', title, hint, onCapture, onClose, analyse }) {
  const { t } = useI18n();
  const video = useRef(null);
  const probe = useRef(null);
  const stream = useRef(null);
  const state = useRef({ prev: null, steadySince: 0, busy: false, done: false });
  const [err, setErr] = useState(null);
  const [steady, setSteady] = useState(0);
  const [tip, setTip] = useState('');
  const [reading, setReading] = useState(false);
  const aspect = ASPECT[mode] || ASPECT.card;

  // the guide rectangle in video pixels
  const guide = useCallback(() => {
    const v = video.current;
    const vw = v.videoWidth; const vh = v.videoHeight;
    const rect = v.getBoundingClientRect();
    const scale = Math.max(rect.width / vw, rect.height / vh); // object-fit: cover
    const gw = Math.min(rect.width * (mode === 'face' ? 0.7 : 0.9), rect.height * 0.8 * aspect);
    const gh = gw / aspect;
    const cx = vw / 2; const cy = vh / 2;
    const w = gw / scale; const h = gh / scale;
    return { x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), w: Math.min(vw, w), h: Math.min(vh, h) };
  }, [aspect, mode]);

  const grab = useCallback(async () => {
    const v = video.current;
    if (!v || state.current.busy || state.current.done) return;
    state.current.busy = true;
    const r = guide();
    const out = document.createElement('canvas');
    const maxW = 1800;
    const s = Math.min(1, maxW / r.w);
    out.width = Math.round(r.w * s); out.height = Math.round(r.h * s);
    const g = out.getContext('2d');
    if (facing === 'user') { g.translate(out.width, 0); g.scale(-1, 1); }
    g.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
    try {
      if (analyse) {
        setReading(true);
        const ok = await analyse(out);
        setReading(false);
        if (!ok) { state.current.busy = false; state.current.steadySince = 0; setSteady(0); return; } // keep scanning
      }
      state.current.done = true;
      haptic.success();
      onCapture(out.toDataURL('image/jpeg', 0.88), out);
    } catch {
      setReading(false);
      state.current.busy = false;
    }
  }, [analyse, facing, guide, onCapture]);

  useEffect(() => {
    let timer = null;
    let alive = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (!alive) { s.getTracks().forEach((x) => x.stop()); return; }
        stream.current = s;
        const v = video.current;
        v.srcObject = s;
        await v.play();
        const track = s.getVideoTracks()[0];
        try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* not supported */ }
      } catch (e) {
        setErr(e?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
        return;
      }
      const c = probe.current;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      timer = setInterval(() => {
        const v = video.current;
        if (!v || !v.videoWidth || state.current.busy || state.current.done) return;
        const r = guide();
        c.width = 96; c.height = Math.round(96 / aspect);
        ctx.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
        const m = measure(ctx, c.width, c.height, state.current.prev);
        state.current.prev = m.gray;
        const sharpOk = m.sharp > (mode === 'face' ? 40 : 160);
        const still = m.motion < (mode === 'face' ? 9 : 6);
        const lightOk = m.light > 40; // glare is only advised: the MRZ check digits decide whether a frame is usable
        setTip(!lightOk ? 'scan_tip_dark' : m.glare > 0.3 && !still ? 'scan_tip_glare' : !still ? 'scan_tip_still' : !sharpOk ? 'scan_tip_focus' : '');
        const now = performance.now();
        if (sharpOk && still && lightOk) {
          if (!state.current.steadySince) state.current.steadySince = now;
          const p = Math.min(1, (now - state.current.steadySince) / STEADY_MS);
          setSteady(p);
          if (p >= 1) grab();
        } else {
          state.current.steadySince = 0;
          setSteady(0);
        }
      }, 200);
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      stream.current?.getTracks().forEach((x) => x.stop());
    };
  }, [aspect, facing, grab, guide, mode]);

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas');
      const s = Math.min(1, 1800 / img.width);
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      if (analyse) { setReading(true); await analyse(c).catch(() => false); setReading(false); }
      onCapture(c.toDataURL('image/jpeg', 0.88), c);
    };
    img.src = URL.createObjectURL(f);
  };

  return (
    <div className={`scanner ${mode}`}>
      <video ref={video} playsInline muted className={facing === 'user' ? 'mirror' : ''} />
      <canvas ref={probe} hidden />
      <div className="scan-shade">
        <div className={`scan-guide ${steady > 0 ? 'locking' : ''}`} style={{ aspectRatio: String(aspect) }}>
          {mode !== 'face' && <><i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" /></>}
          {mode !== 'face' && <span className="mrz-hint">{'<<<<<<<<<<<<<<<<<<<<<<'}</span>}
        </div>
      </div>
      <header className="scan-top">
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('cancel')}><Icon name="close" size={22} /></button>
        <b>{title}</b>
        <span />
      </header>
      <footer className="scan-bottom">
        {err ? <p className="scan-msg">{t(err === 'denied' ? 'scan_camera_denied' : 'scan_camera_unavailable')}</p> : (
          <>
            <p className="scan-msg">{reading ? t('scan_reading') : tip ? t(tip) : hint}</p>
            <div className="fill-bar scan-steady"><i style={{ width: `${Math.round((reading ? 1 : steady) * 100)}%` }} /></div>
          </>
        )}
        <div className="scan-actions">
          <label className="btn ghost small">
            <Icon name="image" size={18} /> {t('scan_from_photos')}
            <input type="file" accept="image/*" hidden onChange={pickFile} />
          </label>
          {!err && <button type="button" className="shutter" aria-label={t('scan_take')} onClick={grab} disabled={reading} />}
          <span className="scan-spacer" />
        </div>
      </footer>
    </div>
  );
}
