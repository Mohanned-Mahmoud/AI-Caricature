/**
 * All tunables in one place.
 * Mode precedence: ?mode=test|ai  >  VITE_DEFAULT_MODE  >  APP_MODE
 */
// ⬇️ غير الكلمة دي لـ 'ai' عشان تشغل التجربة الحقيقية، أو 'test' عشان ترجع للتجربة الوهمية ⬇️
const APP_MODE = 'ai'; // 'test' | 'ai'

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') || APP_MODE || import.meta.env.VITE_DEFAULT_MODE).toLowerCase();

export const CONFIG = {
  mode: mode === 'ai' ? 'ai' : 'test',

  // ---- Test mode ----
  testImage: '/test2.png',
  testDelayMs: [6000, 10000],     // simulated "AI" latency range (random in range)
  // override from URL: ?delay=8000
  ...(params.get('delay') ? { testDelayFixed: Number(params.get('delay')) } : {}),

  // ---- Camera ----
  mirrorPreview: true,
  mirrorCapture: false,           // false = saved photo is un-mirrored
  countdownSeconds: 3,
  captureMaxSide: 1920,           // px, capture canvas long side
  apiMaxSide: 1024,               // px, downscale before sending to API
  apiJpegQuality: 0.85,
  apiTimeoutMs: 60000,

  // ---- Final screen ----
  idleTimeoutMs: 45000,           // auto-return to camera
  enableDownload: true,           // "Save" action on final screen

  // ---- Animation timing (ms) ----
  anim: {
    sketchDuration: 6500,         // stage 1: tracing the photo outline
    minBeforeRedraw: 8500,        // never move to stage 2 before this much total time
    hatchDuration: 10000,         // waiting-loop hatching (two passes) fills in over this time
    redrawDuration: 14000,        // stage 2: pencil lines being drawn
    colorDuration: 12000,         // stage 3: colouring in
    finalFade: 900,               // crisp final result fade-in
  },

  // ---- Look ----
  colors: {
    paper: '#faf4ed',             // warm cream drawing paper matching easel
    photoInk: [38, 42, 52],       // graphite pencil (RGB)
    resultInk: [0, 0, 0],         // black pen
    hatchInk: [60, 66, 80],
  },
  edge: {
    scale: 1,                     // full-res edge map -> hair-thin pen lines
    photoBlur: 2,                 // box blur radius before Sobel (photo)
    resultBlur: 1,                // (caricature, already clean)
    photoDensity: 0.085,          // fraction of pixels that become line (adaptive threshold)
    resultDensity: 0.045,
    thickness: 0,                 // no dilation: 1px lines
    wobble: 0.5,                  // line wobble amplitude in edge-map px
    boilPx: 0,                    // no jitter: lines look exactly like the result
    bandWidth: 0.03,              // width of one pen "pass" ring in normalized distance
  },
  brush: {
    width: 22,                    // px, marker width (lanes of zig-zag strokes)
    seeds: 11,                    // colouring starts at this many places
  },
  maxCanvasLongSide: 1920,
};
