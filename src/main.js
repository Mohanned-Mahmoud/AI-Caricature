import './style.css';
import QRCode from 'qrcode';
import { CONFIG } from './config.js';
import { Animator, drawCover, drawFit, drawFitHeight } from './sketch.js';

// Raw SVG imports (DOM Injection preserving all vector layers & groups)
import cameraSvgRaw from './assets/screens/2.svg?raw';
import countdownSvgRaw from './assets/screens/3.svg?raw';
import loadingSvgRaw from './assets/screens/4.svg?raw';
import drawingSvgRaw from './assets/screens/5.svg?raw';
import finalSvgRaw from './assets/screens/6.svg?raw';

let cachedPrintTemplate = null;
async function getPrintTemplate() {
  if (!cachedPrintTemplate) {
    const mod = await import('./assets/print-template.svg?raw');
    cachedPrintTemplate = mod.default;
  }
  return cachedPrintTemplate;
}

const $ = (id) => document.getElementById(id);

// -------------------------------------------------------------
// INJECT SVG ARTWORK DIRECTLY INTO DOM
// Every <g>, <path>, <image>, <mask id="...">, <clipPath id="...">
// becomes a live, accessible SVG DOM element in the document.
// -------------------------------------------------------------
function injectSvgDom() {
  if ($('art-camera')) $('art-camera').innerHTML = cameraSvgRaw;
  if ($('art-countdown')) $('art-countdown').innerHTML = countdownSvgRaw;
  if ($('art-loading')) $('art-loading').innerHTML = loadingSvgRaw;
  if ($('art-drawing')) $('art-drawing').innerHTML = drawingSvgRaw;
  if ($('art-final')) $('art-final').innerHTML = finalSvgRaw;
}
injectSvgDom();

// Frame aperture dimensions in official print template: x=345, y=660, w=2205, h=2480 (ratio: 0.8891)
const FRAME_APERTURE_W = 2205;
const FRAME_APERTURE_H = 2480;
const FRAME_RATIO = FRAME_APERTURE_W / FRAME_APERTURE_H; // ~0.8891129

let currentPrintDataUrl = null;
let uploadedQrUrl = null;
let isUploadingQr = false;

/**
 * Prepares the high-resolution photo print by rendering the official
 * Canva SVG print template + user caricature onto a single flattened canvas,
 * exporting a crisp image for the browser print dialog.
 * This completely avoids browser print PDF bugs with SVG masks and multi-page spills.
 */
async function preparePrintImage() {
  const printArea = $('print-area');
  if (!printArea || !resultSrc) return;

  try {
    const rawTemplate = await getPrintTemplate();
    const caricatureImg = await loadImage(resultSrc);

    // Create an exact-fit composite canvas matching the frame aperture (2205 x 2480)
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = FRAME_APERTURE_W;
    frameCanvas.height = FRAME_APERTURE_H;
    const fCtx = frameCanvas.getContext('2d');

    // Fill with solid white backing to prevent transparent gaps from turning black in JPEG
    fCtx.fillStyle = '#ffffff';
    fCtx.fillRect(0, 0, FRAME_APERTURE_W, FRAME_APERTURE_H);

    // Scale to fill HEIGHT exactly — full portrait always visible, sides may crop if wider
    drawFitHeight(fCtx, caricatureImg, FRAME_APERTURE_W, FRAME_APERTURE_H);

    // PNG ensures clean alpha blending without any black border artifacts
    const fittedCaricatureDataUrl = frameCanvas.toDataURL('image/png');

    const svgText = rawTemplate.replace(
      /href="" xlink:href=""/g,
      `href="${fittedCaricatureDataUrl}" xlink:href="${fittedCaricatureDataUrl}"`
    );

    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = url;
    });

    // Native SVG template resolution (2891 x 4309) perfectly matching 102x152mm (0.671 ratio)
    const canvas = document.createElement('canvas');
    canvas.width = 2891;
    canvas.height = 4309;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    const printDataUrl = canvas.toDataURL('image/jpeg', 0.98);
    currentPrintDataUrl = printDataUrl;
    printArea.innerHTML = `<img id="print-composite-img" src="${printDataUrl}" alt="Photobooth Print" />`;
  } catch (err) {
    console.error('Failed to prepare print image:', err);
  }
}

// DOM references
const welcomeVideo = $('welcome-video');
const video = $('video');
const videoCountdown = $('video-countdown');
const stage = $('stage');
const caption = $('caption');
const countdownEl = $('countdown');
const select = $('camera-select');
const idleBar = $('idle-bar');
const progressBarFill = $('progress-bar-fill');
const finalResultImg = $('final-result-img');
const sub = $('ld-sub');

// Indicators on Screen 5 (Easel Live Drawing)
const indOutline = $('ind-outline');
const indColor = $('ind-color');
const indFinish = $('ind-finish');

// Set canvas buffer resolution for crisp rendering on easel matching frame ratio
stage.width = 1080;
stage.height = Math.round(1080 / FRAME_RATIO); // 1215px
const animator = new Animator(stage);

// -------------------------------------------------------------
// UNIFORM KIOSK SCALING SYSTEM
// The logical stage is always fixed at 1080x1920 (9:16).
// Scaled proportionally to fit any window/display without distortion.
// -------------------------------------------------------------
const DESIGN_WIDTH = 1080;
const DESIGN_HEIGHT = 1920;

function getKioskScale() {
  return Math.min(
    window.innerWidth / DESIGN_WIDTH,
    window.innerHeight / DESIGN_HEIGHT
  );
}

function updateKioskScale() {
  const scale = getKioskScale();
  document.documentElement.style.setProperty('--kiosk-scale', scale);
}
window.addEventListener('resize', updateKioskScale);
updateKioskScale();

let stream = null;
let photo = null;          // captured canvas
let resultSrc = null;      // url/dataURL of final caricature
let idleTimer = 0;
let sessionId = 0;         // invalidates stale async work after a reset
const NOCAM = new URLSearchParams(location.search).has('nocam'); // dev: skip camera, use test image

const CAPTIONS = {
  sketch: 'Studying your features\u2026',
  redraw: 'Inking the outlines\u2026',
  color: 'Bringing in the colours\u2026',
};

/* ------------------------------- state management ------------------------------- */

function setState(s) {
  document.body.dataset.state = s;
  clearTimeout(idleTimer);
  if (idleBar) idleBar.classList.remove('run');
  if (s === 'final') startIdle();
  if (s === 'loading') {
    startLoadingProgress();
  } else {
    stopLoadingProgress();
  }

  // Manage welcome looping video playback and decoding
  if (s === 'welcome') {
    if (welcomeVideo) {
      welcomeVideo.currentTime = 0;
      welcomeVideo.play().catch(() => {});
    }
  } else {
    if (welcomeVideo) {
      welcomeVideo.pause();
    }
  }
}

function setDrawingStage(stageName) {
  if (indOutline) indOutline.classList.toggle('active', stageName === 'outline');
  if (indColor) indColor.classList.toggle('active', stageName === 'color');
  if (indFinish) indFinish.classList.toggle('active', stageName === 'finish');
}

const LOADING_LINES = [
  'Studying your smile\u2026',
  'Sharpening the pencils\u2026',
  'Exaggerating just the right amount\u2026',
  'Mixing the colours\u2026',
  'Adding the final touches\u2026'
];
let loadingTimer = 0;
let progressTimer = 0;

function startLoadingProgress() {
  clearInterval(loadingTimer);
  clearInterval(progressTimer);

  if (sub) {
    let i = 0;
    sub.textContent = LOADING_LINES[0];
    loadingTimer = setInterval(() => {
      sub.classList.add('swap');
      setTimeout(() => {
        i = (i + 1) % LOADING_LINES.length;
        sub.textContent = LOADING_LINES[i];
        sub.classList.remove('swap');
      }, 350);
    }, 2800);
  }

  if (progressBarFill) {
    let p = 10;
    progressBarFill.style.width = p + '%';
    progressTimer = setInterval(() => {
      if (p < 40) p += 5;
      else if (p < 75) p += 2.5;
      else if (p < 92) p += 0.8;
      progressBarFill.style.width = p + '%';
    }, 400);
  }
}

function stopLoadingProgress() {
  clearInterval(loadingTimer);
  clearInterval(progressTimer);
}

function setCaption(text) {
  if (!caption) return;
  caption.classList.remove('on');
  if (!text) return;
  setTimeout(() => {
    caption.textContent = text;
    caption.classList.add('on');
  }, 250);
}

/* ------------------------------- idle reset ------------------------------- */

function goToWelcome() {
  sessionId++;
  animator.stop();
  setCaption('');
  countdownEl.innerHTML = '';
  setDrawingStage('');
  closeQrModal();
  uploadedQrUrl = null;
  currentPrintDataUrl = null;
  setState('welcome');
}

function startIdle() {
  const ms = CONFIG.idleTimeoutMs;
  if (!idleBar) return;
  idleBar.style.transitionDuration = ms + 'ms';
  void idleBar.offsetWidth;
  idleBar.classList.add('run');
  idleTimer = setTimeout(goToWelcome, ms);
}

window.addEventListener('pointerdown', () => {
  if (document.body.dataset.state === 'final') {
    clearTimeout(idleTimer);
    if (idleBar) {
      idleBar.classList.remove('run');
      void idleBar.offsetWidth;
    }
    startIdle();
  }
});

/* ------------------------------- camera ------------------------------- */

async function startCamera(deviceId) {
  stopCamera();
  // Standard webcam 16:9 constraints so driver streams natively at 30+ FPS without software stutter
  const base = {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 60 }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: 'user' },
      audio: false,
    });
  } catch (e) {
    if (deviceId && e.name !== 'NotAllowedError') {
      localStorage.removeItem('camId');
      return startCamera();
    }
    throw e;
  }

  video.srcObject = stream;
  video.classList.toggle('mirror', CONFIG.mirrorPreview);
  await video.play().catch(() => {});
  await listCameras();
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (video) video.srcObject = null;
  if (videoCountdown) videoCountdown.srcObject = null;
}

async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    select.innerHTML = '';
    devs.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`;
      if (d.deviceId === current) o.selected = true;
      select.appendChild(o);
    });
    const wrap = $('screen-camera')?.querySelector('.cam-select-wrap');
    if (wrap) wrap.style.display = devs.length > 1 ? '' : 'none';
  } catch (err) {
    console.warn('Could not enumerate cameras:', err);
  }
}

select?.addEventListener('change', async () => {
  localStorage.setItem('camId', select.value);
  try {
    await startCamera(select.value);
  } catch {
    showError('camera');
  }
});

// Flip camera button
$('btn-flip')?.addEventListener('click', async () => {
  if (!select || select.options.length < 2) return;
  const nextIdx = (select.selectedIndex + 1) % select.options.length;
  select.selectedIndex = nextIdx;
  localStorage.setItem('camId', select.value);
  try {
    await startCamera(select.value);
  } catch {
    showError('camera');
  }
});

// Effects toggle button
const EFFECTS = ['', 'effect-warm', 'effect-bw', 'effect-cool'];
let effectIdx = 0;
$('btn-effects')?.addEventListener('click', () => {
  if (EFFECTS[effectIdx]) {
    video.classList.remove(EFFECTS[effectIdx]);
    if (videoCountdown) videoCountdown.classList.remove(EFFECTS[effectIdx]);
  }
  effectIdx = (effectIdx + 1) % EFFECTS.length;
  if (EFFECTS[effectIdx]) {
    video.classList.add(EFFECTS[effectIdx]);
    if (videoCountdown) videoCountdown.classList.add(EFFECTS[effectIdx]);
  }
});

/* ------------------------------- capture flow ------------------------------- */

function countdown() {
  return new Promise((resolve) => {
    let n = CONFIG.countdownSeconds;
    const step = () => {
      if (n === 0) {
        countdownEl.innerHTML = '';
        return resolve();
      }
      countdownEl.innerHTML = `<span>${n}</span>`;
      n--;
      setTimeout(step, 1000);
    };
    step();
  });
}

function capture() {
  const c = document.createElement('canvas');
  // High-resolution capture precisely matching the print frame aperture ratio (0.8891)
  c.width = 1080;
  c.height = Math.round(1080 / FRAME_RATIO); // 1215px
  const x = c.getContext('2d');
  if (CONFIG.mirrorCapture) {
    x.translate(c.width, 0);
    x.scale(-1, 1);
  }
  drawCover(x, NOCAM ? nocamImage : video, c.width, c.height);
  return c;
}

let nocamImage = null;

async function onShutter() {
  const id = ++sessionId;
  if (videoCountdown && stream) {
    videoCountdown.srcObject = stream;
    videoCountdown.classList.toggle('mirror', CONFIG.mirrorPreview);
    videoCountdown.play().catch(() => {});
  }
  setState('countdown');
  if (!NOCAM) {
    await countdown();
  } else {
    await new Promise((r) => setTimeout(r, 600));
  }
  if (id !== sessionId) return;

  photo = capture();
  if (videoCountdown) {
    videoCountdown.pause();
    videoCountdown.srcObject = null;
  }
  const f = $('flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');

  runSession(id);
}

/* ------------------------------- result sources ------------------------------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load'));
    img.src = src;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function testResult() {
  const [lo, hi] = CONFIG.testDelayMs;
  const delay = CONFIG.testDelayFixed ?? lo + Math.random() * (hi - lo);
  const [img] = await Promise.all([loadImage(CONFIG.testImage), sleep(delay)]);
  resultSrc = CONFIG.testImage;
  return img;
}

async function aiResult() {
  // Downscale before upload for speed
  const s = Math.min(1, CONFIG.apiMaxSide / Math.max(photo.width, photo.height));
  const c = document.createElement('canvas');
  c.width = Math.round(photo.width * s);
  c.height = Math.round(photo.height * s);
  c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height);
  const image = c.toDataURL('image/jpeg', CONFIG.apiJpegQuality);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.apiTimeoutMs);
  try {
    const r = await fetch('/api/caricature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.image) {
      const e = new Error(data.error || 'api');
      e.code = data.error || 'api';
      throw e;
    }
    resultSrc = data.image;
    return await loadImage(data.image);
  } catch (e) {
    if (e.name === 'AbortError') e.code = 'timeout';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- session execution ------------------------------- */

async function runSession(id) {
  setState('loading');
  setCaption('');

  const resultPromise = CONFIG.mode === 'test' ? testResult() : aiResult();
  resultPromise.catch(() => {}); // handled by animator

  try {
    await animator.run({
      photo,
      resultPromise,
      onStage: (st) => {
        if (id !== sessionId) return;
        if (st === 'redraw') {
          if (progressBarFill) progressBarFill.style.width = '100%';
          setState('drawing');
          setDrawingStage('outline');
          if (CAPTIONS.redraw) setCaption(CAPTIONS.redraw);
        } else if (st === 'color') {
          setDrawingStage('color');
          if (CAPTIONS.color) setCaption(CAPTIONS.color);
        } else if (st === 'final') {
          setDrawingStage('finish');
          setCaption('');
        }
      },
    });

    if (id !== sessionId) return;

    setCaption('');
    if (finalResultImg) finalResultImg.src = resultSrc;
    if ($('btn-save')) {
      $('btn-save').style.display = CONFIG.enableDownload ? '' : 'none';
    }
    preparePrintImage();
    setState('final');
  } catch (e) {
    if (id !== sessionId) return;
    console.error('Session error:', e);
    showError(e.code === 'timeout' ? 'timeout' : e.code === 'rate_limited' ? 'busy' : 'api');
  }
}

/* ------------------------------- errors ------------------------------- */

const ERRORS = {
  camera: ['We can\u2019t see you yet', 'Please allow camera access in your browser, make sure no other app is using it, then try again.'],
  timeout: ['That took too long', 'The artist is running behind today. Let\u2019s give it another go.'],
  busy: ['A little busy right now', 'Lots of portraits in the queue. Please wait a moment and try again.'],
  api: ['The pencil snapped', 'We couldn\u2019t finish your caricature. Please try again.'],
};

let lastError = 'api';
function showError(kind) {
  lastError = kind;
  animator.stop();
  setCaption('');
  const [t, p] = ERRORS[kind] || ERRORS.api;
  $('error-title').textContent = t;
  $('error-text').textContent = p;
  setState('error');
}

/* ------------------------------- user actions ------------------------------- */

async function restart() {
  sessionId++;
  animator.stop();
  setCaption('');
  countdownEl.innerHTML = '';
  setDrawingStage('');
  closeQrModal();
  uploadedQrUrl = null;
  currentPrintDataUrl = null;

  if (!NOCAM && !stream) {
    try {
      await startCamera(localStorage.getItem('camId') || undefined);
    } catch {
      return showError('camera');
    }
  }
  setState('camera');
}

// Welcome Screen: Tap anywhere to start
async function handleWelcomeStart() {
  if (document.body.dataset.state !== 'welcome') return;
  if (welcomeVideo) {
    welcomeVideo.pause();
  }
  if (NOCAM) {
    return setState('camera');
  }
  try {
    if (!stream) {
      await startCamera(localStorage.getItem('camId') || undefined);
    }
    setState('camera');
  } catch (e) {
    console.warn(e);
    showError('camera');
  }
}

$('btn-start')?.addEventListener('click', handleWelcomeStart);
$('screen-welcome')?.addEventListener('click', handleWelcomeStart);

// Shutter button
$('shutter')?.addEventListener('click', onShutter);
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && document.body.dataset.state === 'camera') {
    e.preventDefault();
    onShutter();
  }
});

// Final Screen: Print button
$('btn-print')?.addEventListener('click', async () => {
  if (!$('print-composite-img')) {
    await preparePrintImage();
  }
  if (window.electronAPI && typeof window.electronAPI.silentPrint === 'function') {
    window.electronAPI.silentPrint();
  } else {
    window.print();
  }
});

// Final Screen: Save / Download via QR Modal
$('btn-save')?.addEventListener('click', () => {
  showQrModal();
});

// QR Code Modal action listeners
$('btn-qr-close')?.addEventListener('click', closeQrModal);
$('btn-qr-done')?.addEventListener('click', closeQrModal);
$('qr-modal-backdrop')?.addEventListener('click', closeQrModal);
$('btn-qr-retry')?.addEventListener('click', uploadAndGenerateQr);

/* ------------------------------- QR Code Download ------------------------------- */

async function showQrModal() {
  const modal = $('qr-modal');
  if (!modal) return;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  // Pause idle timer while user is viewing/scanning the QR code
  clearTimeout(idleTimer);
  if (idleBar) idleBar.classList.remove('run');

  if (uploadedQrUrl) {
    showQrCode(uploadedQrUrl);
    return;
  }

  await uploadAndGenerateQr();
}

async function uploadAndGenerateQr() {
  const loading = $('qr-loading');
  const ready = $('qr-ready');
  const errBox = $('qr-error');

  if (loading) loading.style.display = 'flex';
  if (ready) ready.style.display = 'none';
  if (errBox) errBox.style.display = 'none';

  try {
    // If print composite image is still preparing, wait for it
    if (!currentPrintDataUrl && !$('print-composite-img')) {
      await preparePrintImage();
    }

    const printImg = $('print-composite-img');
    const imageToUpload = printImg?.src || currentPrintDataUrl || resultSrc;
    if (!imageToUpload) throw new Error('No image available');

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageToUpload }),
    });

    const data = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.message || data.error || 'Upload failed');
    }

    uploadedQrUrl = data.url;
    await showQrCode(data.url);
  } catch (err) {
    console.error('Failed to upload image for QR:', err);
    if (loading) loading.style.display = 'none';
    if (ready) ready.style.display = 'none';
    if (errBox) errBox.style.display = 'flex';
  }
}

async function showQrCode(url) {
  const loading = $('qr-loading');
  const ready = $('qr-ready');
  const errBox = $('qr-error');
  const canvas = $('qr-canvas');

  if (!canvas) return;

  await QRCode.toCanvas(canvas, url, {
    width: 340,
    margin: 2,
    color: {
      dark: '#092d5d',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'M',
  });

  if (loading) loading.style.display = 'none';
  if (ready) ready.style.display = 'flex';
  if (errBox) errBox.style.display = 'none';
}

function closeQrModal() {
  const modal = $('qr-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');

  if (document.body.dataset.state === 'final') {
    startIdle();
  }
}

// Final Screen: Retake / New Photo button
$('btn-retake')?.addEventListener('click', restart);

// Error Screen buttons
$('btn-restart')?.addEventListener('click', restart);
$('btn-retry')?.addEventListener('click', () => {
  if (lastError === 'camera' || !photo) return restart();
  const id = ++sessionId;
  runSession(id);
});

/* ------------------------------- boot ------------------------------- */

(async function boot() {
  const testScreen = new URLSearchParams(location.search).get('screen');
  if (testScreen) {
    if (testScreen === 'countdown') {
      countdownEl.innerHTML = '<span>3</span>';
    } else if (testScreen === 'drawing') {
      setDrawingStage('color');
      if (caption) {
        caption.textContent = CAPTIONS.color;
        caption.classList.add('on');
      }
      const sample = await loadImage(CONFIG.testImage).catch(() => null);
      if (sample) {
        const ctx = stage.getContext('2d');
        ctx.fillStyle = CONFIG.colors?.paper || '#faf4ed';
        ctx.fillRect(0, 0, stage.width, stage.height);
        drawCover(ctx, sample, stage.width, stage.height);
      }
    } else if (testScreen === 'final') {
      resultSrc = CONFIG.testImage;
      finalResultImg.src = CONFIG.testImage;
      preparePrintImage();
    } else if (testScreen === 'loading') {
      if (sub) sub.textContent = LOADING_LINES[0];
      if (progressBarFill) progressBarFill.style.width = '65%';
    }
    return setState(testScreen);
  }

  // Instantly render the Welcome screen - zero latency, zero unstyled flash
  setState('welcome');

  if (NOCAM) {
    loadImage(CONFIG.testImage).then((img) => { nocamImage = img; });
    return;
  }

  // Warm up camera in the background non-blockingly
  startCamera(localStorage.getItem('camId') || undefined).catch((e) => {
    console.warn('Initial camera warm-up deferred until user interaction:', e);
  });
})();
