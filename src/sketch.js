/**
 * Sketch engine. Only the AI RESULT is ever drawn (the captured photo is never shown).
 *
 *  wait    : loading page (HTML) while the result is generated, then the result is analysed:
 *            the person is detected (background flood-fill), outline + detail lines are extracted.
 *  redraw  : a thin black pen draws the person on a plain white page, stroke by stroke.
 *  color   : a marker colours the person in, lane by lane, like someone colouring by hand.
 *  final   : the complete result (with background) fades in.
 */
import { CONFIG } from './config.js';

const { anim, colors, brush } = CONFIG;

/* ----------------------------- helpers ----------------------------- */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const ease = (t) => { t = clamp01(t); return 0.15 * t + 0.85 * smooth(t); };
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Draw any image/video/canvas into (0,0,W,H) using object-fit: cover. */
export function drawCover(ctx, src, W, H) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const s = Math.max(W / sw, H / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/** Draw the whole image inside (0,0,W,H) (object-fit: contain). Returns the rect used. */
export function drawFit(ctx, src, W, H) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const s = Math.min(W / sw, H / sh);
  const dw = sw * s, dh = sh * s;
  const x = (W - dw) / 2, y = (H - dh) / 2;
  ctx.drawImage(src, x, y, dw, dh);
  return { x, y, w: dw, h: dh };
}

/**
 * Scale image so its HEIGHT fills H exactly, centered horizontally.
 * Full height always visible — no top/bottom crop ever.
 * Width: if wider than W the sides are cropped; if narrower there are side gaps.
 */
export function drawFitHeight(ctx, src, W, H) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const s = H / sh;              // scale so height fills exactly
  const dw = sw * s;
  ctx.drawImage(src, (W - dw) / 2, 0, dw, H);
}



function boxBlur(g, w, h, r) {
  if (r < 1) return g;
  const tmp = new Float32Array(g.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += g[y * w + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += g[y * w + Math.min(w - 1, x + r + 1)] - g[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      g[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return g;
}

function erode(m, W, H, n) {
  let cur = m, nxt = new Uint8Array(m.length);
  for (let k = 0; k < n; k++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        nxt[i] = cur[i] && x > 0 && y > 0 && x < W - 1 && y < H - 1 && cur[i - 1] && cur[i + 1] && cur[i - W] && cur[i + W] ? 1 : 0;
      }
    }
    const t = cur; cur = nxt; nxt = (t === m) ? new Uint8Array(m.length) : t;
  }
  return cur;
}

/* ----------------------------- person detection ----------------------------- */

/**
 * Finds the person in the (white-padded) result image: the background is the region connected to the
 * top corners through smooth colour; everything else is the subject. Works at half resolution.
 * Returns { half: Uint8Array(hw*hh), hw, hh }.
 */
export function detectPerson(fitC, rect, W, H) {
  const hw = W >> 1, hh = H >> 1, N = hw * hh;
  const hc = makeCanvas(hw, hh);
  const hx = hc.getContext('2d', { willReadFrequently: true });
  hx.drawImage(fitC, 0, 0, hw, hh);
  const d = hx.getImageData(0, 0, hw, hh).data;
  const ch = [0, 1, 2].map((c) => {
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = d[i * 4 + c];
    return boxBlur(a, hw, hh, 1);
  });

  const rx0 = Math.max(0, Math.ceil(rect.x / 2) + 1), ry0 = Math.max(0, Math.ceil(rect.y / 2) + 1);
  const rx1 = Math.min(hw - 1, Math.floor((rect.x + rect.w) / 2) - 2), ry1 = Math.min(hh - 1, Math.floor((rect.y + rect.h) / 2) - 2);

  // Find face region (skin tone) to anchor and protect the head & hair from background flood-fill
  let faceX0 = hw, faceX1 = 0, faceY0 = hh, faceY1 = 0, skinCount = 0;
  for (let y = Math.floor(hh * 0.15); y < Math.floor(hh * 0.75); y++) {
    for (let x = Math.floor(hw * 0.15); x < Math.floor(hw * 0.85); x++) {
      const i = y * hw + x;
      const r = ch[0][i], g = ch[1][i], b = ch[2][i];
      if (r > 60 && g > 40 && b > 20 && r > g && g >= b && (r - b) > 15 && (r - g) < 95) {
        skinCount++;
        if (x < faceX0) faceX0 = x; if (x > faceX1) faceX1 = x;
        if (y < faceY0) faceY0 = y; if (y > faceY1) faceY1 = y;
      }
    }
  }

  // Head boundary protection zone: background flood-fill CANNOT enter here
  const headX0 = skinCount > 50 ? Math.max(rx0, faceX0 - 30) : Math.floor(hw * 0.28);
  const headX1 = skinCount > 50 ? Math.min(rx1, faceX1 + 30) : Math.floor(hw * 0.72);
  const headYTop = skinCount > 50 ? Math.max(ry0, Math.floor(faceY0 - (faceY1 - faceY0) * 0.70)) : Math.floor(hh * 0.12);
  const headYBot = skinCount > 50 ? faceY1 : Math.floor(hh * 0.60);

  const isProtectedHead = (x, y) => x >= headX0 && x <= headX1 && y >= headYTop && y <= headYBot;

  const bg = new Uint8Array(N);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  const seed = (x, y) => {
    const i = y * hw + x;
    if (!bg[i] && !isProtectedHead(x, y)) { bg[i] = 1; q[qt++] = i; }
  };
  for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) { seed(rx0 + dx, ry0 + dy); seed(rx1 - dx, ry0 + dy); }

  const STEP = 32;  // Strict step difference so flood-fill doesn't leak into hair highlights
  const DIST = 75;  // Max distance from row edge colors
  const L = new Float32Array(hh * 3), R = new Float32Array(hh * 3);
  for (let y = 0; y < hh; y++) for (let c = 0; c < 3; c++) {
    let sl = 0, sr = 0;
    for (let k = 2; k < 8; k++) { sl += ch[c][y * hw + Math.min(hw - 1, rx0 + k)]; sr += ch[c][y * hw + Math.max(0, rx1 - k)]; }
    L[y * 3 + c] = sl / 6; R[y * 3 + c] = sr / 6;
  }
  const span = Math.max(1, rx1 - rx0);
  const near = (i) => {
    const x = i % hw, y = (i / hw) | 0, t = clamp01((x - rx0) / span);
    let s = 0;
    for (let c = 0; c < 3; c++) s += Math.abs(ch[c][i] - (L[y * 3 + c] * (1 - t) + R[y * 3 + c] * t));
    return s < DIST;
  };
  const same = (i, j) => {
    const x = j % hw, y = (j / hw) | 0;
    if (isProtectedHead(x, y)) return false;
    return Math.abs(ch[0][i] - ch[0][j]) + Math.abs(ch[1][i] - ch[1][j]) + Math.abs(ch[2][i] - ch[2][j]) < STEP && near(j);
  };

  while (qh < qt) {
    const i = q[qh++], x = i % hw, y = (i / hw) | 0;
    if (x > rx0 && !bg[i - 1] && same(i, i - 1)) { bg[i - 1] = 1; q[qt++] = i - 1; }
    if (x < rx1 && !bg[i + 1] && same(i, i + 1)) { bg[i + 1] = 1; q[qt++] = i + 1; }
    if (y > ry0 && !bg[i - hw] && same(i, i - hw)) { bg[i - hw] = 1; q[qt++] = i - hw; }
    if (y < ry1 && !bg[i + hw] && same(i, i + hw)) { bg[i + hw] = 1; q[qt++] = i + hw; }
  }

  // Subject = inside image rect and not background (or inside protected head)
  const person = new Uint8Array(N);
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      const i = y * hw + x;
      if (!bg[i] || isProtectedHead(x, y)) person[i] = 1;
    }
  }

  // Vertical scanline hole-filling: fill ANY hole between top and bottom of each column
  for (let x = rx0; x <= rx1; x++) {
    let yTop = -1, yBot = -1;
    for (let y = ry0; y <= ry1; y++) {
      if (person[y * hw + x]) {
        if (yTop < 0) yTop = y;
        yBot = y;
      }
    }
    if (yTop >= 0 && yBot > yTop) {
      for (let y = yTop; y <= yBot; y++) {
        person[y * hw + x] = 1;
      }
    }
  }

  // Keep only the biggest connected blob
  const lab = new Int32Array(N);
  let best = 0, bestId = 0, id = 0;
  for (let s = 0; s < N; s++) {
    if (!person[s] || lab[s]) continue;
    id++; let n = 0; qh = 0; qt = 0; q[qt++] = s; lab[s] = id;
    while (qh < qt) {
      const i = q[qh++]; n++;
      const x = i % hw, y = (i / hw) | 0;
      if (x > 0 && person[i - 1] && !lab[i - 1]) { lab[i - 1] = id; q[qt++] = i - 1; }
      if (x < hw - 1 && person[i + 1] && !lab[i + 1]) { lab[i + 1] = id; q[qt++] = i + 1; }
      if (y > 0 && person[i - hw] && !lab[i - hw]) { lab[i - hw] = id; q[qt++] = i - hw; }
      if (y < hh - 1 && person[i + hw] && !lab[i + hw]) { lab[i + hw] = id; q[qt++] = i + hw; }
    }
    if (n > best) { best = n; bestId = id; }
  }

  // Smooth the silhouette (blur + threshold)
  const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = lab[i] === bestId ? 1 : 0;
  boxBlur(f, hw, hh, 3);
  const half = new Uint8Array(N);
  for (let i = 0; i < N; i++) half[i] = f[i] > 0.4 ? 1 : 0;

  // Final hole-fill pass on half mask: ensure no interior voids remain
  for (let x = 0; x < hw; x++) {
    let yTop = -1, yBot = -1;
    for (let y = 0; y < hh; y++) {
      if (half[y * hw + x]) {
        if (yTop < 0) yTop = y;
        yBot = y;
      }
    }
    if (yTop >= 0 && yBot > yTop) {
      for (let y = yTop; y <= yBot; y++) half[y * hw + x] = 1;
    }
  }

  return { half, hw, hh };
}

/** Full-res person mask: { canvas (soft alpha), pm (0/1 Uint8Array) } */
export function upscaleMask(det, W, H) {
  const { half, hw, hh } = det;
  const sc = makeCanvas(hw, hh);
  const sx = sc.getContext('2d');
  const id = sx.createImageData(hw, hh);
  for (let i = 0; i < half.length; i++) { id.data[i * 4 + 3] = half[i] ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; }
  sx.putImageData(id, 0, 0);
  const canvas = makeCanvas(W, H);
  const cx = canvas.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(sc, 0, 0, W, H);
  const a = cx.getImageData(0, 0, W, H).data;
  const pm = new Uint8Array(W * H);
  for (let i = 0; i < pm.length; i++) pm[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  return { canvas, pm };
}

/* ----------------------------- line extraction ----------------------------- */

/**
 * Pen lines for the subject only: silhouette + dark detail (brows, eyes, mouth, hair edge)
 * + the strongest thin edges inside (nose, lips, ears, collar...).
 */
export function buildLines(fitC, pm, W, H, rect) {
  const px = fitC.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  let area = 0;
  for (let i = 0; i < g.length; i++) { g[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; area += pm[i]; }
  const bl = boxBlur(Float32Array.from(g), W, H, 5);
  const g1 = boxBlur(Float32Array.from(g), W, H, 1);
  const inner = erode(pm, W, H, 5);
  const A = new Uint8Array(W * H);

  // 1) silhouette
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (pm[i] && !(pm[i - 1] && pm[i + 1] && pm[i - W] && pm[i + W])) {
      // no outline along the picture's own cut-off edges (e.g. shoulders running out of frame)
      const edgeCut = rect && (x < rect.x + 7 || x > rect.x + rect.w - 8 || y < rect.y + 7 || y > rect.y + rect.h - 8);
      if (!edgeCut) A[i] = 255;
    }
  }
  // 2) dark detail
  for (let i = 0; i < A.length; i++) if (inner[i]) {
    const v = Math.round(clamp01((bl[i] - g[i] - 0.07) / 0.12) * 255);
    if (v > A[i]) A[i] = v;
  }
  // 3) thin strong edges (Sobel + non-maximum suppression)
  const mag = new Float32Array(W * H), horiz = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!inner[i]) continue;
    const gx = -g1[i - W - 1] - 2 * g1[i - 1] - g1[i + W - 1] + g1[i - W + 1] + 2 * g1[i + 1] + g1[i + W + 1];
    const gy = -g1[i - W - 1] - 2 * g1[i - W] - g1[i - W + 1] + g1[i + W - 1] + 2 * g1[i + W] + g1[i + W + 1];
    mag[i] = Math.hypot(gx, gy); horiz[i] = Math.abs(gx) > Math.abs(gy) ? 1 : 0;
  }
  const keep = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x, m = mag[i];
    if (m <= 0) continue;
    const a = horiz[i] ? mag[i - 1] : mag[i - W], b = horiz[i] ? mag[i + 1] : mag[i + W];
    if (m >= a && m >= b) keep.push(i);
  }
  if (keep.length) {
    const vals = Float32Array.from(keep, (i) => mag[i]).sort();
    const target = Math.min(vals.length - 1, Math.floor(area * 0.03));
    const thr = vals[Math.max(0, vals.length - 1 - target)];
    for (const i of keep) if (mag[i] >= thr) A[i] = 255;
  }
  return A;
}

/** Order line pixels like a pen: follow connected strokes, then hop to the nearest loose end. */
export function traceOrder(A, W, H) {
  const N = W * H, vis = new Uint8Array(N);
  const scan = [];
  for (let i = 0; i < N; i++) if (A[i] > 8) scan.push(i);
  scan.sort((a, b) => {
    const ya = (a / W) | 0, yb = (b / W) | 0;
    return (Math.floor(ya / 90) - Math.floor(yb / 90)) || ((a % W) - (b % W)) || (ya - yb);
  });
  const out = new Uint32Array(scan.length);
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  let n = 0, sp = 0, cur = -1, dx = 0, dy = 0;
  while (n < scan.length) {
    if (cur < 0) {
      while (sp < scan.length && vis[scan[sp]]) sp++;
      if (sp >= scan.length) break;
      cur = scan[sp]; dx = dy = 0;
    }
    vis[cur] = 1; out[n++] = cur;
    const x = cur % W, y = (cur / W) | 0;
    let best = -1, bs = -9, bdx = 0, bdy = 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (vis[j] || A[j] <= 8) continue;
      const s = dx * DX[k] + dy * DY[k] + Math.random() * 0.1;
      if (s > bs) { bs = s; best = j; bdx = DX[k]; bdy = DY[k]; }
    }
    if (best >= 0) { cur = best; dx = bdx; dy = bdy; continue; }
    let found = -1;
    for (let r = 2; r <= 22 && found < 0; r++) {
      let bd = 1e9;
      for (let yy = -r; yy <= r; yy++) {
        const ny = y + yy; if (ny < 0 || ny >= H) continue;
        const fullRow = Math.abs(yy) === r;
        for (let xx = -r; xx <= r; xx += fullRow ? 1 : 2 * r) {
          const nx = x + xx; if (nx < 0 || nx >= W) continue;
          const j = ny * W + nx;
          if (vis[j] || A[j] <= 8) continue;
          const dd = xx * xx + yy * yy;
          if (dd < bd) { bd = dd; found = j; }
        }
      }
    }
    if (found >= 0) { cur = found; dx = dy = 0; } else cur = -1;
  }
  return out.subarray(0, n);
}

/* ----------------------------- pen layer ----------------------------- */

/** Line pixels revealed in pen order; only the changed rectangle is uploaded each frame. */
class InkLayer {
  constructor(A, order, W, H, ink) {
    this.A = A; this.order = order; this.W = W; this.H = H; this.ink = ink;
    this.canvas = makeCanvas(W, H);
    this.cx = this.canvas.getContext('2d');
    this.img = this.cx.createImageData(W, H);
    this.ptr = 0; this.lastIdx = -1; this.lastMove = -1e9;
  }
  update(p, now) {
    const { order, A, img, W, H, ink } = this;
    const d = img.data;
    const target = p >= 1 ? order.length : Math.floor(p * order.length);
    if (target <= this.ptr) return;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    const put = (j, a) => { d[j * 4] = ink[0]; d[j * 4 + 1] = ink[1]; d[j * 4 + 2] = ink[2]; if (a > d[j * 4 + 3]) d[j * 4 + 3] = a; };
    for (let k = this.ptr; k < target; k++) {
      const i = order[k], x = i % W, y = (i / W) | 0, a = A[i];
      put(i, a);
      if (x + 1 < W) put(i + 1, a * 0.7);        // slightly fuller pen tip (2px line)
      if (y + 1 < H) put(i + W, a * 0.7);
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
    this.cx.putImageData(img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.lastIdx = order[target - 1]; this.lastMove = now; this.ptr = target;
  }
  tip(now) {
    if (this.lastIdx < 0 || now - this.lastMove > 160) return null;
    return { x: this.lastIdx % this.W, y: (this.lastIdx / this.W) | 0 };
  }
}

/* ----------------------------- animator ----------------------------- */

export class Animator {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.raf = 0;
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.running = false; }

  /**
   * @param {Promise<CanvasImageSource>} resultPromise  final caricature image
   * @param {(stage:string)=>void} onStage
   * @returns {Promise<void>} resolves when the final crisp image is on screen
   */
  run({ resultPromise, onStage }) {
    this.stop();
    return new Promise((resolve, reject) => {
      this.resolve = resolve; this.reject = reject; this.onStage = onStage || (() => {});
      const W = (this.W = 1080), H = (this.H = 1920);
      this.canvas.width = W; this.canvas.height = H;
      this.phase = 'wait';
      this.t0 = performance.now();
      this.phaseStart = this.t0;
      this.resultReady = false;
      this.preparing = false;
      this.resultImg = null;
      this.resultLines = null;
      this.markerPos = null;
      this.tipPos = { x: W / 2, y: H / 2, vis: 0 };
      this.onStage('sketch');

      resultPromise.then((img) => { this.resultImg = img; }, (err) => this.fail(err));

      this.running = true;
      const loop = (now) => {
        if (!this.running) return;
        try { this.tick(now); } catch (err) { this.fail(err); return; }
        if (this.running) this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    });
  }

  fail(err) { if (!this.running && !this.reject) return; this.stop(); this.reject && this.reject(err); }

  /** Analyse the result in small steps (yielding between them so the loading page keeps animating). */
  async prepareResult() {
    const { W, H } = this;
    const img = this.resultImg;

    this.fitC = makeCanvas(W, H);
    const fx = this.fitC.getContext('2d', { willReadFrequently: true });
    fx.fillStyle = '#fff'; fx.fillRect(0, 0, W, H);
    const rect = drawFit(fx, img, W, H);
    this.rect = rect;
    await nextFrame();

    const det = detectPerson(this.fitC, rect, W, H);
    await nextFrame();
    const { canvas: maskCanvas, pm } = upscaleMask(det, W, H);
    await nextFrame();

    const A = buildLines(this.fitC, pm, W, H, rect);
    await nextFrame();
    const order = traceOrder(A, W, H);
    this.resultLines = new InkLayer(A, order, W, H, colors.resultInk);
    await nextFrame();

    // person cut-out: the colour source for the marker (transparent outside the subject)
    this.personC = makeCanvas(W, H);
    const px = this.personC.getContext('2d');
    px.drawImage(this.fitC, 0, 0);
    px.globalCompositeOperation = 'destination-in';
    px.drawImage(maskCanvas, 0, 0);
    px.globalCompositeOperation = 'source-over';
    this.colorC = makeCanvas(W, H);
    this.colorX = this.colorC.getContext('2d');
    this.colorX.lineCap = 'round'; this.colorX.lineJoin = 'round';
    this.colorX.lineWidth = brush.width * 1.25;
    this.colorX.strokeStyle = this.colorX.createPattern(this.personC, 'no-repeat');

    // colour lookup for the marker tip
    const cell = 24, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const small = makeCanvas(gw, gh);
    const sx = small.getContext('2d', { willReadFrequently: true });
    sx.drawImage(this.fitC, 0, 0, gw, gh);
    const col = sx.getImageData(0, 0, gw, gh).data;

    // ---- Organic artistic colouring path ----
    // Mirrors the drawing method:
    // 1) First pass: outlines the caricature's contours & features in rich color (tracing along order)
    // 2) Second pass: colors feature by feature (Hair -> Face/Skin -> Clothing/Torso) using smooth, natural artist brush strokes
    const { half, hw, hh } = det;
    const bw = brush.width;
    const pts = [];

    // Pass 1: Contour & Feature tracing with color marker
    if (order && order.length > 0) {
      let lastX = -999, lastY = -999;
      const stepDist = 14;
      const maxJump = 28;
      for (let k = 0; k < order.length; k += 2) {
        const idx = order[k];
        const x = idx % W, y = (idx / W) | 0;
        const d = Math.hypot(x - lastX, y - lastY);
        if (d > maxJump) {
          pts.push({ x, y, jump: true });
          lastX = x; lastY = y;
        } else if (d >= stepDist) {
          pts.push({ x, y, jump: false });
          lastX = x; lastY = y;
        }
      }
    }

    // Pass 2: Feature & Region filling (Hair -> Face -> Clothing)
    let yMin = hh, yMax = 0;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        if (half[y * hw + x]) {
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
      }
    }
    const hTotal = Math.max(10, yMax - yMin);
    const regions = [
      { name: 'hair', y0: yMin, y1: yMin + hTotal * 0.38, angle: -50 * Math.PI / 180 },
      { name: 'face', y0: yMin + hTotal * 0.22, y1: yMin + hTotal * 0.65, angle: -25 * Math.PI / 180 },
      { name: 'body', y0: yMin + hTotal * 0.58, y1: yMax, angle: 35 * Math.PI / 180 },
    ];

    const stepHalf = (bw * 0.70) / 2; // step in half-res units
    for (const reg of regions) {
      const cos = Math.cos(reg.angle), sin = Math.sin(reg.angle);
      let uMin = 1e9, uMax = -1e9;
      const regMask = new Uint8Array(hw * hh);
      let count = 0;
      const ry0 = Math.max(0, Math.floor(reg.y0)), ry1 = Math.min(hh - 1, Math.ceil(reg.y1));
      for (let y = ry0; y <= ry1; y++) {
        for (let x = 0; x < hw; x++) {
          const i = y * hw + x;
          if (half[i]) {
            regMask[i] = 1;
            count++;
            const u = -x * sin + y * cos;
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
          }
        }
      }
      if (count === 0) continue;

      let dir = 1;
      for (let u = uMin; u <= uMax; u += stepHalf) {
        let inSeg = false, vStart = 0;
        const segs = [];
        for (let v = -hh; v <= hw + hh; v += 4) {
          const x = Math.round(v * cos - u * sin);
          const y = Math.round(v * sin + u * cos);
          const inside = x >= 0 && x < hw && y >= 0 && y < hh && regMask[y * hw + x];
          if (inside && !inSeg) {
            inSeg = true;
            vStart = v;
          } else if (!inside && inSeg) {
            inSeg = false;
            if (v - vStart >= 6) segs.push([vStart, v]);
          }
        }
        if (inSeg && (hw + hh - vStart >= 6)) segs.push([vStart, hw + hh]);

        if (!segs.length) continue;
        if (dir < 0) segs.reverse();

        for (const [va, vb] of segs) {
          const strokePts = [];
          for (let v = va; v <= vb; v += 8) {
            const x = (v * cos - u * sin) * 2;
            const y = (v * sin + u * cos) * 2;
            strokePts.push({ x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)) });
          }
          if (dir < 0) strokePts.reverse();
          if (strokePts.length > 0) {
            strokePts[0].jump = true;
            for (const p of strokePts) pts.push(p);
          }
        }
        dir = -dir;
      }
    }
    this.brushPlan = { pts, ptr: 0, gw, cell, col };
    this.resultReady = true;
  }

  tick(now) {
    const A = anim;
    const total = now - this.t0;
    let tipLayer = null, tipCol = null;
    let colorOn = false, finalA = 0;

    if (this.phase === 'wait') {
      if (this.resultImg && !this.preparing) {
        this.preparing = true;
        this.prepareResult().catch((e) => this.fail(e));
      }
      if (this.resultReady) { this.phase = 'redraw'; this.phaseStart = now; this.onStage('redraw'); }
    }
    if (this.phase === 'redraw') {
      const p = (now - this.phaseStart) / A.redrawDuration;
      this.resultLines.update(ease(p), now);
      tipLayer = this.resultLines;
      if (p >= 1) { this.resultLines.update(1, now); this.phase = 'color'; this.phaseStart = now; this.onStage('color'); }
    }
    if (this.phase === 'color') {
      const p = clamp01((now - this.phaseStart) / A.colorDuration);
      const bp = this.brushPlan, m = this.colorX;
      const target = p >= 1 ? bp.pts.length : Math.floor(p * bp.pts.length);
      let last = null;
      while (bp.ptr < target) {
        const q = bp.pts[bp.ptr], prev = bp.pts[bp.ptr - 1];
        if (!q.jump && prev) { m.beginPath(); m.moveTo(prev.x, prev.y); m.lineTo(q.x, q.y); m.stroke(); }
        bp.ptr++;
        last = q;
      }
      if (last) {
        const cx = Math.min(bp.gw - 1, Math.max(0, Math.floor(last.x / bp.cell)));
        const cy = Math.min(Math.ceil(this.H / bp.cell) - 1, Math.max(0, Math.floor(last.y / bp.cell)));
        const o = (cy * bp.gw + cx) * 4;
        this.markerPos = { x: last.x, y: last.y, t: now };
        this.markerCol = `rgb(${bp.col[o] || 200},${bp.col[o + 1] || 200},${bp.col[o + 2] || 200})`;
      }
      colorOn = true;
      if (this.markerPos && now - this.markerPos.t < 160) tipCol = this.markerCol;
      if (p >= 1) { this.phase = 'final'; this.phaseStart = now; this.onStage('final'); }
    }
    if (this.phase === 'final') {
      colorOn = true;
      finalA = ease((now - this.phaseStart) / A.finalFade);
      if (finalA >= 1) { this.render({ colorOn: false, finalA: 1, now }); this.stop(); this.resolve(); return; }
    }
    this.render({ colorOn, finalA, now, tipLayer, tipCol, total });
  }

  render({ colorOn, finalA, now, tipLayer, tipCol }) {
    const { ctx, W, H } = this;
    ctx.globalAlpha = 1;
    ctx.fillStyle = CONFIG.colors?.paper || '#faf4ed';
    ctx.fillRect(0, 0, W, H);

    if (this.resultReady && colorOn) ctx.drawImage(this.colorC, 0, 0);
    if (this.resultLines && this.phase !== 'wait') {
      ctx.globalAlpha = 1 - finalA;
      ctx.drawImage(this.resultLines.canvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (finalA > 0) { ctx.globalAlpha = finalA; ctx.drawImage(this.fitC, 0, 0); ctx.globalAlpha = 1; }

    // Pen / marker tip following the leading edge
    let target = null;
    if (tipLayer) { const t = tipLayer.tip(now); if (t) target = { x: t.x, y: t.y }; }
    else if (tipCol && this.markerPos) target = { x: this.markerPos.x, y: this.markerPos.y };
    const tp = this.tipPos;
    if (target) {
      if (tp.vis < 0.05) { tp.x = target.x; tp.y = target.y; }
      tp.x += (target.x - tp.x) * 0.15; tp.y += (target.y - tp.y) * 0.15;
      tp.vis += (1 - tp.vis) * 0.1;
    } else tp.vis *= 0.85;
    if (tp.vis > 0.03) this.drawPen(tp, tipCol);
  }

  /** Small pen / marker, tip at (x,y), tilted. */
  drawPen(tp, color) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = tp.vis;
    ctx.translate(tp.x, tp.y);
    ctx.rotate(-0.95);
    ctx.scale(0.6, 0.6);
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#17181d';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -26); ctx.lineTo(7, -26); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = color || '#d9d3c4';
    ctx.beginPath(); ctx.moveTo(-6.5, -22); ctx.lineTo(6.5, -22); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#17181d'; ctx.fillRect(-7, -26, 14, 110);
    ctx.fillStyle = '#f2efe8'; ctx.fillRect(-7, 22, 14, 3);
    ctx.restore();
  }
}
