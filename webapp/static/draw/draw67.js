console.log("Helena Paint - draw67.js")


const canvas = document.getElementById("glCanvas");
const canvasWrapper = document.getElementById("canvasWrapper") || canvas.parentElement;
canvas.style.transformOrigin = "top left";


let lastX = null;
let lastY = null;


let zoomScale = 1;
let panX = 0;
let panY = 0;
let zoomMin = 1;
let zoomMax = 5;
let lastTouchDist = null;
let lastTouchMidpoint = null;
let isPanning = false;
let isTwoFingerGesture = false;
let isUIDragging = false;


function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}

function getMidpoint(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
    };
}
function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function canPaint() {
  return (
    transformTool.mode === "idle" &&   // not grabbing/scaling/rotating a layer
    !spacePanning &&                   // not space-bar panning
    !isTwoFingerGesture &&             // not pinch/rotate view gesture
    !isUIDragging                      // not dragging a UI panel/slider
  );
}

// --- two-finger gesture state ---
let pinchStart = null; // { dist, angle, scale0, rot0, anchorCanvas:{x,y} }

function normAngle(d) { // normalize to [-PI, PI]
  if (d >  Math.PI) d -= 2*Math.PI;
  if (d < -Math.PI) d += 2*Math.PI;
  return d;
}

// transform a canvas point (px) by scale+rotation, origin = canvas (0,0)
function transformCanvasPoint(px, py, scale, rot) {
  const x = px * scale, y = py * scale;
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: x*c - y*s, y: x*s + y*c };
}

// view (UI) rotation in radians. Does NOT touch paint/layers data.
let viewRotation = 0;

// keep origin consistent everywhere
let transformOriginX = 0;  // in CSS px relative to canvas top-left
let transformOriginY = 0;

function updateCanvasTransform() {
  canvas.style.transformOrigin = "0 0"; // keep fixed
  canvas.style.transform =
    `translate(${panX}px, ${panY}px) rotate(${viewRotation}rad) scale(${zoomScale})`;
}


function rotatePoint(x, y, angle, ox=0, oy=0) {
  const dx = x - ox, dy = y - oy;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: ox + dx*c - dy*s, y: oy + dx*s + dy*c };
}

function screenToCanvasPx(clientX, clientY) {
  const wrap = canvasWrapper.getBoundingClientRect();
  let px = clientX - wrap.left;
  let py = clientY - wrap.top;
  px -= panX; py -= panY;
  const inv = rotatePoint(px, py, -viewRotation, transformOriginX, transformOriginY);
  px = inv.x; py = inv.y;
  const cx = px / zoomScale;
  const cy = py / zoomScale;
  return {
    x: Math.max(0, Math.min(canvas.width,  cx)),
    y: Math.max(0, Math.min(canvas.height, cy))
  };
}

function canvasPxToFBO(x, y) {
  return {
    fx: x * (fixedFBOWidth  / canvas.width),
    fy: y * (fixedFBOHeight / canvas.height)
  };
}

function pointerToBoth(eLike) {
  const c = screenToCanvasPx(eLike.clientX, eLike.clientY);
  const f = canvasPxToFBO(c.x, c.y);
  return { cx: c.x, cy: c.y, fx: f.fx, fy: f.fy };
}


// Brush size HUD (centered preview even when not painting)
let brushHUD = { visible: false, hideAt: 0 };
let lastPointer = { cx: canvas.width * 0.5, cy: canvas.height * 0.5 }; // fallback

function showBrushHUD(ms = 1200) {
  brushHUD.visible = true;
  brushHUD.hideAt = performance.now() + ms;
  needsRedraw = true;
  requestDrawIfIdle(); // your patched helper draws once even with RAF disabled
}

// keep it alive while changing size repeatedly
function maybeAutoHideBrushHUD() {
  if (!brushHUD.visible) return;
  if (performance.now() >= brushHUD.hideAt) {
    brushHUD.visible = false;
    needsRedraw = true;
    requestDrawIfIdle();
  }
}

// --- Touch viz: single, centralized observer (no patching per-handler) ---
let touchViz = { pts: [], visible: false };

function setTouchVizFromTouches(touchList) {
  const pts = [];
  for (let i = 0; i < touchList.length; i++) {
    const t = touchList[i];
    // map screen -> canvas px (you already have this)
    const c = screenToCanvasPx(t.clientX, t.clientY);
    pts.push({ x: c.x, y: c.y });
  }
  touchViz.pts = pts;
  touchViz.visible = pts.length > 0;
  if (typeof needsRedraw !== "undefined") needsRedraw = true;
  if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
}

function clearTouchViz() {
  touchViz.pts = [];
  touchViz.visible = false;
  if (typeof needsRedraw !== "undefined") needsRedraw = true;
  if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
}

// Centralized capture listeners: observe all touches, don’t fight existing handlers
const TOUCH_TARGET_OK = (el) => {
  // only show rings when touching the canvas or its wrapper
  return !!(el && (el === canvas || el === canvasWrapper || el.closest?.("#canvasWrapper")));
};

function onTouchStartCapture(e) {
  if (!e.touches || !e.touches.length) return;
  if (!TOUCH_TARGET_OK(e.target)) return;
  setTouchVizFromTouches(e.touches);
}
function onTouchMoveCapture(e) {
  if (!e.touches || !e.touches.length) return;
  if (!TOUCH_TARGET_OK(e.target)) return;
  setTouchVizFromTouches(e.touches);
}
function onTouchEndCapture(e) {
  // keep viz in sync with remaining touches; clear if none
  if (e.touches && e.touches.length) setTouchVizFromTouches(e.touches);
  else clearTouchViz();
}

// capture = true so we see events no matter what your inner handlers do
document.addEventListener("touchstart", onTouchStartCapture, { capture: true, passive: true });
document.addEventListener("touchmove",  onTouchMoveCapture,  { capture: true, passive: true });
document.addEventListener("touchend",   onTouchEndCapture,   { capture: true, passive: true });
document.addEventListener("touchcancel",onTouchEndCapture,   { capture: true, passive: true });


// ---- Monitor Frame Time + Undo Memory ---- //

let frameTimes = [];
let memoryWarningShown = false;
let frameRateMonitoringActive = false;  


function sampleFrameTime() {
  const now = performance.now();
  frameTimes.push(now);
  if (frameTimes.length > 30) frameTimes.shift();

  // warn only when we’re actually drawing
  if (activeReasons.size > 0) {
    const deltas = [];
    for (let i = 1; i < frameTimes.length; i++) deltas.push(frameTimes[i] - frameTimes[i-1]);
    const avg = deltas.length ? deltas.reduce((a,b)=>a+b,0) / deltas.length : 0;
    if (avg > 80 && !memoryWarningShown) {
      console.warn("⚠️ Low frame rate detected! Possible memory overload.");
      showStatusMessage("⚠️ App running slow — consider undo or saving", "warning");
      memoryWarningShown = true;
    }
  }
}


// ===== RAF: runs ONLY while a reason is active =====
let rafId = null;
const activeReasons = new Set(); // e.g. "draw", "transform"
// one–shot drawer for passive UI changes
function requestDrawIfIdle() {
  if (rafId) return; // a frame is already booked
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (needsRedraw) {
      drawScene();
      needsRedraw = false;
      sampleFrameTime?.();
    }
  });
}

function startRender(reason) {
  if (reason) activeReasons.add(reason);
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function stopRender(reason) {
  if (reason) activeReasons.delete(reason);
  // tick will naturally stop next frame when no reasons remain
}

function tick() {
  rafId = null;
  const isActive = activeReasons.size > 0;

  if (!isActive) {
    if (needsRedraw) { drawScene(); needsRedraw = false; sampleFrameTime?.(); }
    return; // no loop
  }

  // Active: only draw when flagged
  if (needsRedraw) {
    drawScene();
    needsRedraw = false;
    sampleFrameTime?.();
  }

  // Keep the loop *while* active, but it will be cheap when idle
  rafId = requestAnimationFrame(tick);
}


// ==== KILL THE RENDER LOOP ====
let RENDER_LOOP_DISABLED = true;

function disableRenderLoop() {
  RENDER_LOOP_DISABLED = true;
  try { activeReasons?.clear?.(); } catch {}
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function enableRenderLoop() { RENDER_LOOP_DISABLED = false; }

// Patch the helpers to no-op RAF usage
const _startRender = startRender;
startRender = function(reason) {
  if (RENDER_LOOP_DISABLED) return;      // never schedule RAF
  _startRender.call(this, reason);
};

const _requestDrawIfIdle = requestDrawIfIdle;
requestDrawIfIdle = function() {
  if (RENDER_LOOP_DISABLED) {
    if (needsRedraw) {                    // draw once, synchronously
      drawScene();
      needsRedraw = false;
      sampleFrameTime?.();
    }
    return;
  }
  _requestDrawIfIdle.call(this);
};

const _tick = tick;
tick = function() {
  if (RENDER_LOOP_DISABLED) {             // bail if something slipped through
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    return;
  }
  _tick.call(this);
};

// Immediately stop any loop already running
disableRenderLoop();


// Pan with two-finger scroll, pinch-zoom when ctrlKey is true (Mac trackpad)
canvasWrapper.addEventListener("wheel", (e) => {
  e.preventDefault();
  const unit = (e.deltaMode === 1) ? 16 : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;

  const wrapperRect = canvasWrapper.getBoundingClientRect();
  const pointerX = e.clientX - wrapperRect.left;
  const pointerY = e.clientY - wrapperRect.top;

  const worldX = (pointerX - panX) / zoomScale;
  const worldY = (pointerY - panY) / zoomScale;

  if (e.ctrlKey) {
    const zoomSpeed = 0.0025;
    const newScale = Math.min(Math.max(zoomScale - dy * zoomSpeed, zoomMin), zoomMax);
    const scaleChange = newScale / zoomScale;
    panX -= worldX * (scaleChange - 1) * zoomScale;
    panY -= worldY * (scaleChange - 1) * zoomScale;
    zoomScale = newScale;
    updateCanvasTransform();
  } else {
    const panSpeed = 1;
    panX -= dx * panSpeed;
    panY -= dy * panSpeed;
    updateCanvasTransform();
  }
}, { passive: false });


// Track pointer over the wrapper so we get moves even when not painting
canvasWrapper.addEventListener("mousemove", (e) => {
  const c = screenToCanvasPx(e.clientX, e.clientY);
  lastPointer.cx = c.x;
  lastPointer.cy = c.y;

  if (brushHUD.visible) {
    overlayPosition = [c.x / canvas.width, c.y / canvas.height];
    needsRedraw = true;
    requestDrawIfIdle();
  }
}, { passive: true });



let spacePanning = false;
let panStart = null;

document.addEventListener("keydown", e => { if (e.code === "Space") spacePanning = true; });
document.addEventListener("keyup",   e => { if (e.code === "Space") spacePanning = false; });

canvasWrapper.addEventListener("mousedown", e => {
  if (!spacePanning) return;
  e.preventDefault();
  panStart = { x: e.clientX, y: e.clientY, panX0: panX, panY0: panY };
});
window.addEventListener("mousemove", e => {
  if (!panStart) return;
  panX = panStart.panX0 + (e.clientX - panStart.x);
  panY = panStart.panY0 + (e.clientY - panStart.y);
  updateCanvasTransform();
});
["mouseup","mouseleave"].forEach(ev => window.addEventListener(ev, () => panStart = null));

canvasWrapper.addEventListener("mousedown", e => {
  if (e.button !== 1) return; // middle
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY, panX0: panX, panY0: panY };
  const move = ev => { panX = start.panX0 + (ev.clientX - start.x); panY = start.panY0 + (ev.clientY - start.y); updateCanvasTransform(); };
  const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
});



// mouse
window.addEventListener("mousemove", onTransformPointerMove);


// touch
canvas.addEventListener("touchmove", (ev) => {
  if (transformTool.mode === "idle") return;
  const t = ev.touches[0]; if (!t) return;
  onTransformPointerMove(t);
}, { passive:false });

// end / cancel
["mouseup","mouseleave","touchend","touchcancel"].forEach(ev =>
  window.addEventListener(ev, () => {
    if (transformTool.mode !== "idle") endTransform(true);
  }, { passive:true })
);




// 2) Wire it to the places that temporarily need drawing - Painting

canvas.addEventListener("mousedown", () => {
  isDrawing = true;
  startRender("draw");
});
["mouseup","mouseleave"].forEach(ev =>
  canvas.addEventListener(ev, () => {
    isDrawing = false;
    stopRender("draw");
  })
);

canvas.addEventListener("touchstart", (ev) => {
  if (isTwoFingerGesture) return;
  isDrawing = true;
  startRender("draw");
}, { passive:false });


["touchend","touchcancel"].forEach(ev =>
  window.addEventListener(ev, () => {
    if (isTwoFingerGesture && (!event.touches || event.touches.length < 2)) {
      isTwoFingerGesture = false;
      pinchStart = null; // keep the final zoomScale/viewRotation; don’t reset!
    }
    if (transformTool.mode !== "idle") endTransform(true);
  }, { passive:true })
);



// Two-finger pinch + rotate (keep new, remove old commented pinch)

let lastTouchAngle = null;


function getAngle(t1, t2) {
  return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
}

canvasWrapper.addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    isTwoFingerGesture = true;

    const t1 = e.touches[0], t2 = e.touches[1];
    lastTouchDist  = getDistance(t1, t2);
    lastTouchAngle = getAngle(t1, t2);

    const mid = getMidpoint(t1, t2);
    const wrap = canvasWrapper.getBoundingClientRect();
    const midX = mid.x - wrap.left;
    const midY = mid.y - wrap.top;

    // canvas coords under the midpoint at gesture start (this is our anchor)
    const c = screenToCanvasPx(midX + wrap.left, midY + wrap.top);

    pinchStart = {
      dist:  Math.max(1e-6, lastTouchDist),
      angle: lastTouchAngle,
      scale0: zoomScale,
      rot0:   viewRotation,
      anchorCanvas: { x: c.x, y: c.y }
    };
  }
}, { passive: false });




canvasWrapper.addEventListener("touchmove", (e) => {
  if (e.touches.length !== 2 || !pinchStart) return;
  e.preventDefault();
  isDrawing = false;

  const t1 = e.touches[0], t2 = e.touches[1];
  const newDist = Math.max(1e-6, getDistance(t1, t2));
  const newAng  = getAngle(t1, t2);
  const mid     = getMidpoint(t1, t2);

  const wrap = canvasWrapper.getBoundingClientRect();
  const pointerX = mid.x - wrap.left;
  const pointerY = mid.y - wrap.top;

  // 1) continuous scale & rotation based on gesture start
  const rawScale = pinchStart.scale0 * (newDist / pinchStart.dist);
  const nextScale = Math.min(Math.max(rawScale, zoomMin), zoomMax);
  const angDelta  = normAngle(newAng - pinchStart.angle);
  const nextRot   = pinchStart.rot0 + angDelta;

  // 2) pan so the anchor canvas point stays under the moving midpoint
  const anchor = pinchStart.anchorCanvas;           // canvas px at start under midpoint
  const p = transformCanvasPoint(anchor.x, anchor.y, nextScale, nextRot); // screen delta (pre-translate)
  panX = pointerX - p.x;
  panY = pointerY - p.y;

  // 3) commit
  zoomScale = nextScale;
  viewRotation = nextRot;
  updateCanvasTransform();

  // remember for smooth continuation, though we’re anchored to pinchStart anyway
  lastTouchDist  = newDist;
  lastTouchAngle = newAng;
}, { passive:false });



canvas.addEventListener("touchstart", (e) => {
  if (isTwoFingerGesture) { e.preventDefault(); e.stopPropagation(); }
}, { passive: false });






const gl = canvas.getContext("webgl2", { 
    alpha: true, 
    powerPreference: "high-performance" 
});

let needsRedraw = true;

const imageLoader = document.getElementById("imageLoader");
const colorPicker = document.getElementById("colorPicker");

//–– Brush switching ––

const brushes = [
    { name: "Dot", file: "/static/draw/images/brushes/dot.webp", defaultSize: 0.02, selected: false },
    { name: "Fine Liner", file: "/static/draw/images/brushes/fine-liner-2.webp", defaultSize: 0.03, selected: false },
    { name: "Brush 12", file: "/static/draw/images/brushes/12.webp", defaultSize: 0.04, selected: false },
    { name: "Brush 11", file: "/static/draw/images/brushes/11.webp", defaultSize: 0.05, selected: true },
    { name: "Brush 0", file: "/static/draw/images/brushes/0.png", defaultSize: 0.025, selected: false },
    { name: "Brush 5", file: "/static/draw/images/brushes/5.png", defaultSize: 0.03, selected: false },
    { name: "Brush 1", file: "/static/draw/images/brushes/1.png", defaultSize: 0.035, selected: false },
    { name: "Brush 2", file: "/static/draw/images/brushes/2.png", defaultSize: 0.04, selected: false },
    { name: "Brush 3", file: "/static/draw/images/brushes/3.png", defaultSize: 0.045, selected: false },
    { name: "Brush 4", file: "/static/draw/images/brushes/4.png", defaultSize: 0.05, selected: false },
    { name: "Brush 7", file: "/static/draw/images/brushes/7.webp", defaultSize: 0.06, selected: false },
    { name: "Brush 8", file: "/static/draw/images/brushes/8.webp", defaultSize: 0.2, selected: false }
];


let brushTextures = {};
let brushAspects = {};
let currentBrush = null; // Store the currently selected brush object

let currentArtworkId = null;


//–– Global textures ––
// The background image texture.
let texture = null;
// The currently active brush texture.
let overlayTexture = null;
let brushAspect = 1; // width/height of the current brush

//–– Global image & canvas sizing ––
let imageAspect = 1;
let currentImage = null;

//–– Persistent paint layer (accumulates brush strokes) ––
let paintFBO;
let paintTexture;

//–– Shader programs ––
// quadProgram: draws a full-screen quad with a texture
let quadProgram;
// paintProgram: draws a brush quad that outputs tinted paint using the brush alpha
let paintProgram;
// overlayProgram: draws the brush preview tinted with the selected color
let overlayProgram;

let overlayPosition = [0, 0]; // normalized [x,y] (0–1)

let isDrawing = false;


let floodFillProgram;

let currentTool = 'draw';

let fixedFBOWidth = 0;
let fixedFBOHeight = 0;


//-------
// Colour picking
//----------------

// The tint color (RGBA as floats, default black)
let tintColor = [0, 0, 0, 1];

/// HELPER: Convert a hex color string (e.g. "#ff0000") to [r,g,b,a] with components in 0..1.
// function hexToRGBA(hex) {
//     if (hex.charAt(0) === "#") hex = hex.substr(1);
//     if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
//     let intVal = parseInt(hex, 16);
//     let r = ((intVal >> 16) & 255) / 255;
//     let g = ((intVal >> 8) & 255) / 255;
//     let b = (intVal & 255) / 255;
//     return [r, g, b, 1.0];
// }


function hexToHSL(hex) {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex.split("").map(x => x + x).join("");
  }
  let r = parseInt(hex.substr(0, 2), 16) / 255,
      g = parseInt(hex.substr(2, 2), 16) / 255,
      b = parseInt(hex.substr(4, 2), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

colorPicker.addEventListener("input", (e) => {
  tintColor = hexToRGBA(e.target.value);
  const hsl = hexToHSL(e.target.value);
  baseColor = hexToRGBA(e.target.value).slice(0, 3);
  lightnessFactor = hsl.l;
  updateLightnessGradient();
  updateFinalColor();
  const indicatorColor = colorPalette.querySelector(".indicator");
  if (indicatorColor) {
    indicatorColor.style.top =
      hsl.h * (colorPalette.clientHeight - indicatorColor.clientHeight) + "px";
  }
  const indicatorLightness = lightnessPalette.querySelector(".indicator");
  if (indicatorLightness) {
    indicatorLightness.style.top =
      hsl.l * (lightnessPalette.clientHeight - indicatorLightness.clientHeight) + "px";
  }
});


const colorPalette = document.getElementById("colorPalette");
const lightnessPalette = document.getElementById("lightnessPalette");
let baseColor = [0, 0, 0]; // Default red
let lightnessFactor = 0.5; // Default 50%


function updateLightnessGradient() {
    const r = Math.round(baseColor[0] * 255);
    const g = Math.round(baseColor[1] * 255);
    const b = Math.round(baseColor[2] * 255);

    // New gradient: From selected color (top) → black (middle) → white (bottom)
    const lightnessGradient = `linear-gradient(to bottom, rgb(${r}, ${g}, ${b}), white)`;
    document.getElementById("lightnessPalette").style.background = lightnessGradient;
}

function pickBaseColor(event) {
  const rect = colorPalette.getBoundingClientRect();
  const y = (event.touches ? event.touches[0].clientY : event.clientY) - rect.top;
  const ratio = Math.max(0, Math.min(1, y / rect.height));
  const colors = [
    [255, 0, 0],
    [255, 255, 0],
    [0, 255, 0],
    [0, 255, 255],
    [0, 0, 255],
    [255, 0, 255],
    [255, 0, 0]
  ];
  const index = Math.floor(ratio * (colors.length - 1));
  const nextIndex = Math.min(index + 1, colors.length - 1);
  const mix = (ratio * (colors.length - 1)) % 1;
  baseColor = [
    (colors[index][0] * (1 - mix) + colors[nextIndex][0] * mix) / 255,
    (colors[index][1] * (1 - mix) + colors[nextIndex][1] * mix) / 255,
    (colors[index][2] * (1 - mix) + colors[nextIndex][2] * mix) / 255
  ];
  updateLightnessGradient();
  updateFinalColor();
  const indicator = colorPalette.querySelector('.indicator');
  if (indicator) {
    indicator.style.top = (ratio * (colorPalette.clientHeight - indicator.clientHeight)) + "px";
  }
}

function pickLightness(event) {
  const rect = lightnessPalette.getBoundingClientRect();
  const y = (event.touches ? event.touches[0].clientY : event.clientY) - rect.top;
  const ratio = Math.max(0, Math.min(1, y / rect.height));
  lightnessFactor = ratio;
  updateFinalColor();
  const indicator = lightnessPalette.querySelector('.indicator');
  if (indicator) {
    indicator.style.top = (ratio * (lightnessPalette.clientHeight - indicator.clientHeight)) + "px";
  }
}




function updateFinalColor() {
    const r = Math.round(baseColor[0] * (1 - lightnessFactor) * 255 + lightnessFactor * 255);
    const g = Math.round(baseColor[1] * (1 - lightnessFactor) * 255 + lightnessFactor * 255);
    const b = Math.round(baseColor[2] * (1 - lightnessFactor) * 255 + lightnessFactor * 255);
    tintColor = [r / 255, g / 255, b / 255, 1];
    // Convert RGB to HEX
    const hexColor = rgbToHex(r, g, b);
    // Update the color picker's value
    console.log("hexColor", hexColor)
    document.getElementById("colorPicker").value = hexColor;
    //drawScene();
    needsRedraw = true;
}


// Convert HEX to RGBA (ensures correct format)
// function hexToRGBA(hex) {
//     if (hex.charAt(0) === "#") hex = hex.substr(1);
//     if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
//     let intVal = parseInt(hex, 16);
//     let r = ((intVal >> 16) & 255) / 255;
//     let g = ((intVal >> 8) & 255) / 255;
//     let b = (intVal & 255) / 255;
//     return [r, g, b, 1.0];
// }


// Convert RGB to HEX
function rgbToHex(r, g, b) {
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

// Replace the color picker to force UI update
function replaceColorPicker(newColor) {
    const oldPicker = document.getElementById("colorPicker");

    // Create a new input element
    const newPicker = document.createElement("input");
    newPicker.type = "color";
    newPicker.id = "colorPicker";
    newPicker.value = newColor;

    // Preserve event listeners
    newPicker.addEventListener("input", (e) => {
        tintColor = hexToRGBA(e.target.value);
        needsRedraw = true;
    });

    // Replace the old element with the new one
    oldPicker.parentNode.replaceChild(newPicker, oldPicker);
}

// Convert HEX to RGBA (ensures correct format)
function hexToRGBA(hex) {
    if (hex.charAt(0) === "#") hex = hex.substr(1);
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    let intVal = parseInt(hex, 16);
    let r = ((intVal >> 16) & 255) / 255;
    let g = ((intVal >> 8) & 255) / 255;
    let b = (intVal & 255) / 255;
    return [r, g, b, 1.0];
}


// Add event listeners for both desktop & mobile interactions
["mousedown", "touchstart"].forEach(event => {
    colorPalette.addEventListener(event, (e) => {
        pickBaseColor(e);
        document.addEventListener("mousemove", pickBaseColor);
        document.addEventListener("touchmove", pickBaseColor);
    });

    lightnessPalette.addEventListener(event, (e) => {
        pickLightness(e);
        document.addEventListener("mousemove", pickLightness);
        document.addEventListener("touchmove", pickLightness);
    });
});

// Remove event listeners on mouse/touch release
["mouseup", "touchend"].forEach(event => {
    document.addEventListener(event, () => {
        document.removeEventListener("mousemove", pickBaseColor);
        document.removeEventListener("mousemove", pickLightness);
        document.removeEventListener("touchmove", pickBaseColor);
        document.removeEventListener("touchmove", pickLightness);
    });
});


document.addEventListener("touchmove", function(event) {
    if (event.target.closest("#colorPalette, #lightnessPalette")) {
        event.preventDefault();
    }
}, { passive: false });





//–––––––––––––––––––
// SHADER COMPILATION UTILS
//–––––––––––––––––––
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Program link error:", gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}





//–––––––––––––––––––
// SHADERS
//–––––––––––––––––––

// Vertex shader for full-screen quads and brush quads (positions in pixel space)
const quadVS = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  uniform vec2 u_resolution;
  uniform float u_flipY; // set to 1.0 for no flip; -1.0 for normal flip
  varying vec2 v_texCoord;
  void main() {
    vec2 zeroToOne = a_position / u_resolution;
    vec2 clipSpace = zeroToOne * 2.0 - 1.0;
    gl_Position = vec4(clipSpace.x, clipSpace.y * u_flipY, 0, 1);
    v_texCoord = a_texCoord;
  }
`;

// Fragment shader for drawing a texture (used for background and the paint layer)
const quadFS = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform float u_layerOpacity; // NEW

    void main() {
      vec4 c = texture2D(u_texture, v_texCoord);
      c.a *= u_layerOpacity;      // apply per-layer opacity here
      gl_FragColor = c;
    }
`;


const paintFS = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_brush;
  uniform vec4 u_tint;
  uniform bool u_erase;
  uniform float u_eraseStrength; // controls erasing strength
  uniform float u_paintStrength; // controls painting strength
  void main() {
    vec4 brushColor = texture2D(u_brush, v_texCoord);
    if (u_erase) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, brushColor.a * u_eraseStrength * 0.05);
    } else {
      // Multiply the brush alpha by u_paintStrength so that lower values yield lighter strokes.
      gl_FragColor = vec4(u_tint.rgb, brushColor.a * u_paintStrength);
    }
  }
`;


// Fragment shader for drawing the brush overlay (preview) tinted.
const overlayFS = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_brush;
  uniform vec4 u_tint;
  void main() {
    vec4 brushColor = texture2D(u_brush, v_texCoord);
    gl_FragColor = vec4(u_tint.rgb, brushColor.a);
  }
`;


// Add near other program vars
let ringProgram;

// Fragment shader to draw a hollow circle (ring) in screen-space
const ringFS = `
precision mediump float;
uniform vec2  u_center;     // circle center in screen px (top-left origin)
uniform float u_radius;     // ring radius in px
uniform float u_thickness;  // ring thickness in px
uniform vec4  u_color;      // RGBA
uniform vec2  u_viewport;   // canvas size (w,h)

void main() {
  // Convert gl_FragCoord (bottom-left origin) to top-left
  vec2 p = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
  float d = abs(length(p - u_center) - u_radius);
  // 1px anti-aliasing band
  float aa = 1.0;
  float alpha = smoothstep(u_thickness + aa, u_thickness - aa, d);
  gl_FragColor = vec4(u_color.rgb, u_color.a * alpha);
}
`;


// --- Dashed line program ---
let dashProgram;

const dashFS = `
precision mediump float;

uniform vec2  u_a;          // start of line in screen px (top-left origin)
uniform vec2  u_b;          // end of line in screen px
uniform float u_thickness;  // half-thickness in px
uniform float u_dash;       // dash length in px
uniform float u_gap;        // gap length in px
uniform vec4  u_color;      // RGBA
uniform vec2  u_viewport;   // canvas size (w,h)

void main() {
  // convert gl_FragCoord (bottom-left origin) to top-left origin
  vec2 p = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
  vec2 a = u_a, b = u_b;

  vec2 ab = b - a;
  float len = max(1.0, length(ab));
  vec2 ap = p - a;

  // project p onto segment a-b
  float t = clamp(dot(ap, ab) / (len * len), 0.0, 1.0);
  float dist = length(ap - ab * t);

  // dashed pattern along the segment
  float along = t * len;
  float seg   = max(1.0, u_dash + u_gap);
  float m     = mod(along, seg);
  float inDash = step(m, u_dash); // 1 inside dash, 0 inside gap

  // soft edges (1px AA band)
  float aa = 1.0;
  float alpha = inDash * smoothstep(u_thickness + aa, u_thickness - aa, dist);

  gl_FragColor = vec4(u_color.rgb, u_color.a * alpha);
}
`;



// INITIALIZATION (layers-ready)
//–––––––––––––––––––

function getActiveLayer() {
  return layers[activeLayerIndex];
}

function syncActiveAliases() {
  const L = getActiveLayer();
  if (!L) { paintFBO = null; paintTexture = null; return; }
  paintFBO = L.fbo;
  paintTexture = L.texture;
}


// function initGL() {
//   if (!gl) { console.error("WebGL not supported."); return; }
//   // If you kept the original quadFS, this still works.
//   // If you adopted the opacity-aware fragment shader, remember to set u_layerOpacity before drawing each layer.
//   quadProgram   = createProgram(gl, quadVS, quadFS);
//   paintProgram  = createProgram(gl, quadVS, paintFS);
//   overlayProgram= createProgram(gl, quadVS, overlayFS);
// }


function initGL() {
  if (!gl) { console.error("WebGL not supported."); return; }
  quadProgram    = createProgram(gl, quadVS, quadFS);
  paintProgram   = createProgram(gl, quadVS, paintFS);
  overlayProgram = createProgram(gl, quadVS, overlayFS);
  ringProgram    = createProgram(gl, quadVS, ringFS); 
  dashProgram    = createProgram(gl, quadVS, dashFS);
}

// === One-time quad helper (put once, top-level is fine) ===
let __quadVbo = null;
function __bindAndDrawTexturedQuad(program, W, H) {
  const verts = new Float32Array([
    // x, y,   u, v
     0, 0,    0, 0,
     W, 0,    1, 0,
     0, H,    0, 1,

     0, H,    0, 1,
     W, 0,    1, 0,
     W, H,    1, 1
  ]);
  if (!__quadVbo) __quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, __quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  const posLoc = gl.getAttribLocation(program, "a_position");
  const uvLoc  = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(uvLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}


// ===========================
// Helpers for merging
// ===========================

// Return selected layer indices (bottom→top). If none, fall back to active.
function __getSelectedIndices() {
  // 1) explicit set (if your UI manages a Set)
  if (typeof selectedLayerIndices !== "undefined" && selectedLayerIndices && selectedLayerIndices.size) {
    return Array.from(selectedLayerIndices).sort((a,b) => a - b);
  }
  // 2) UI checkboxes (if present)
  try {
    const listEl = document.getElementById("layersList");
    if (listEl) {
      const picked = [];
      listEl.querySelectorAll(".layer-item").forEach((row) => {
        const idxAttr = row.getAttribute("data-index");
        const cb = row.querySelector(".layer-select input[type='checkbox']");
        if (cb && cb.checked && idxAttr != null) picked.push(Number(idxAttr));
      });
      if (picked.length) return picked.sort((a,b) => a - b);
    }
  } catch {}
  // 3) fallback to just the active layer
  return [typeof activeLayerIndex === "number" ? activeLayerIndex : 0];
}

// Build a transformed quad for a layer in **document pixel space**,
// then shift into destination FBO pixel space (0..W × 0..H)
function __layerQuadInFboSpace(L, outW, outH) {
  const Wdoc = fixedFBOWidth, Hdoc = fixedFBOHeight;

  // Layer’s own rect in document space
  const Lx = Number.isFinite(L.ox)   ? L.ox   : 0;
  const Ly = Number.isFinite(L.oy)   ? L.oy   : 0;
  const Lw = Number.isFinite(L.texW) ? L.texW : Wdoc;
  const Lh = Number.isFinite(L.texH) ? L.texH : Hdoc;

  // pivot in doc px
  const pivX = Number.isFinite(L.px) ? L.px : Wdoc * 0.5;
  const pivY = Number.isFinite(L.py) ? L.py : Hdoc * 0.5;

  const c = Math.cos(L.rotation || 0);
  const s = Math.sin(L.rotation || 0);

  function tf(xDoc, yDoc) {
    let dx = xDoc - pivX;
    let dy = yDoc - pivY;
    dx *= (Number.isFinite(L.scaleX) ? L.scaleX : 1);
    dy *= (Number.isFinite(L.scaleY) ? L.scaleY : 1);
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    const docX = pivX + rx + (Number.isFinite(L.x) ? L.x : 0);
    const docY = pivY + ry + (Number.isFinite(L.y) ? L.y : 0);
    // FBO is 1:1 with document pixels
    return { x: docX, y: docY };
  }

  const p0 = tf(Lx,     Ly);
  const p1 = tf(Lx+Lw,  Ly);
  const p2 = tf(Lx,     Ly+Lh);
  const p3 = tf(Lx+Lw,  Ly+Lh);

  // Positions in FBO px, UVs in [0..1] from the source texture
  // (No scaling to canvas here; we draw into a doc-sized FBO)
  const verts = new Float32Array([
    p0.x, p0.y, 0, 0,
    p1.x, p1.y, 1, 0,
    p2.x, p2.y, 0, 1,
    p2.x, p2.y, 0, 1,
    p1.x, p1.y, 1, 0,
    p3.x, p3.y, 1, 1
  ]);

  // Clamp to destination bounds if you use scissor later (not required here)
  return verts;
}




// Per-layer FBO/texture
// function createLayerFBO(width, height) {
//   const tex = gl.createTexture();
//   gl.bindTexture(gl.TEXTURE_2D, tex);
//   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

//   // Use linear filtering for smoother scaling
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

//   const fbo = gl.createFramebuffer();
//   gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
//   gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

//   gl.clearColor(0, 0, 0, 0);
//   gl.clear(gl.COLOR_BUFFER_BIT);

//   gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//   return { texture: tex, fbo };
// }


// function createLayerFBO(width, height) {
//   const tex = gl.createTexture();
//   gl.bindTexture(gl.TEXTURE_2D, tex);
//   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

//   // Use NEAREST filtering to preserve pixel sharpness
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

//   const fbo = gl.createFramebuffer();
//   gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
//   gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

//   gl.clearColor(0, 0, 0, 0);
//   gl.clear(gl.COLOR_BUFFER_BIT);

//   gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//   return { texture: tex, fbo };
// }


function createLayerFBO(width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  // Use LINEAR for source textures to maintain compatibility
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture: tex, fbo };
}



// Global layers model
// Each layer: { id, name, fbo, texture, visible, opacity, history:[], redo:[] }
let layers = [];
let activeLayerIndex = 0;

// function addLayer(name = `Layer ${layers.length+1}`, insertAboveIndex = activeLayerIndex) {
//   const { texture, fbo } = createLayerFBO(fixedFBOWidth, fixedFBOHeight);
//   const layer = {
//     id: Date.now() + Math.random(),
//     name, fbo, texture,
//     visible: true, opacity: 1,

//     // transform
//     x: 0, y: 0,
//     scaleX: 1, scaleY: 1,
//     rotation: 0,

//     // NEW: pivot in document/FBO pixels (defaults to doc center)
//     px: fixedFBOWidth  * 0.5,
//     py: fixedFBOHeight * 0.5,

//     history: [], redo: []
//   };
//   const pos = Math.min(insertAboveIndex + 1, layers.length);
//   layers.splice(pos, 0, layer);
//   activeLayerIndex = pos;
//   syncActiveAliases();
//   if (typeof rebuildLayersUI === "function") rebuildLayersUI();
//   needsRedraw = true;
// }

function addLayer(name = `Layer ${layers.length+1}`, insertBelowIndex = activeLayerIndex) {
  const W = fixedFBOWidth, H = fixedFBOHeight;
  const { texture, fbo } = createLayerFBO(W, H);

  const layer = {
    id: Date.now() + Math.random(),
    name, fbo, texture,
    visible: true, opacity: 1,

    // transform params (same as v46)
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    px: W * 0.5, py: H * 0.5,

    // NEW: own texture rect (in document pixels)
    texW: W, texH: H,  // size of this layer's texture in doc px
    ox: 0, oy: 0,      // document-space location of this texture's top-left

    history: [], redo: []
  };

  const pos = Math.max(0, Math.min(insertBelowIndex, layers.length));
  layers.splice(pos, 0, layer);

  activeLayerIndex = pos;
  syncActiveAliases();
  if (typeof rebuildLayersUI === "function") rebuildLayersUI();
  needsRedraw = true;
}



function drawRingOverlay(cx, cy, radiusPx, thicknessPx, color=[1,0,0,0.95]) {
  if (!ringProgram) return;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(ringProgram);

  // quadVS uniforms (REQUIRED!)
  const uFlipY = gl.getUniformLocation(ringProgram, "u_flipY");
  if (uFlipY) gl.uniform1f(uFlipY, -1.0);
  const uRes = gl.getUniformLocation(ringProgram, "u_resolution");
  if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);

  // ringFS uniforms
  gl.uniform2f(gl.getUniformLocation(ringProgram, "u_center"),   cx, cy);
  gl.uniform1f(gl.getUniformLocation(ringProgram, "u_radius"),   Math.max(0.0, radiusPx));
  gl.uniform1f(gl.getUniformLocation(ringProgram, "u_thickness"),Math.max(0.5, thicknessPx));
  gl.uniform4fv(gl.getUniformLocation(ringProgram, "u_color"),   color);
  gl.uniform2f(gl.getUniformLocation(ringProgram, "u_viewport"), canvas.width, canvas.height);

  const verts = new Float32Array([
    0,0, 0,0,                     canvas.width,0, 1,0,
    0,canvas.height, 0,1,         0,canvas.height, 0,1,
    canvas.width,0, 1,0,          canvas.width,canvas.height, 1,1
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  // IMPORTANT: attribute locations for the *current* program
  const posLoc = gl.getAttribLocation(ringProgram, "a_position");
  const uvLoc  = gl.getAttribLocation(ringProgram, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(uvLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buf);
}


function drawDashedLine(ax, ay, bx, by, thickness = 1.5, dash = 10.0, gap = 6.0, color = [1, 0, 0, 0.95]) {
  if (!dashProgram) return;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(dashProgram);

  // quadVS uniforms (REQUIRED!)
  const uFlipY = gl.getUniformLocation(dashProgram, "u_flipY");
  if (uFlipY) gl.uniform1f(uFlipY, -1.0);
  const uRes = gl.getUniformLocation(dashProgram, "u_resolution");
  if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);

  // fragment uniforms
  gl.uniform2f(gl.getUniformLocation(dashProgram, "u_a"), ax, ay);
  gl.uniform2f(gl.getUniformLocation(dashProgram, "u_b"), bx, by);
  gl.uniform1f(gl.getUniformLocation(dashProgram, "u_thickness"), Math.max(0.5, thickness));
  gl.uniform1f(gl.getUniformLocation(dashProgram, "u_dash"), Math.max(1.0, dash));
  gl.uniform1f(gl.getUniformLocation(dashProgram, "u_gap"), Math.max(0.5, gap));
  gl.uniform4fv(gl.getUniformLocation(dashProgram, "u_color"), color);
  gl.uniform2f(gl.getUniformLocation(dashProgram, "u_viewport"), canvas.width, canvas.height);

  // full-screen quad
  const verts = new Float32Array([
    0,0, 0,0,                     canvas.width,0, 1,0,
    0,canvas.height, 0,1,         0,canvas.height, 0,1,
    canvas.width,0, 1,0,          canvas.width,canvas.height, 1,1
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  // IMPORTANT: attribute locations for the *current* program
  const posLoc = gl.getAttribLocation(dashProgram, "a_position");
  const uvLoc  = gl.getAttribLocation(dashProgram, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(uvLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buf);
}




function drawLayerWithTransform(program, layer) {
  const Wdoc = fixedFBOWidth, Hdoc = fixedFBOHeight;

  // doc→screen scale
  const sx = canvas.width  / Wdoc;
  const sy = canvas.height / Hdoc;

  // layer’s own rectangle in document space
  const Lx = Number.isFinite(layer.ox)   ? layer.ox   : 0;
  const Ly = Number.isFinite(layer.oy)   ? layer.oy   : 0;
  const Lw = Number.isFinite(layer.texW) ? layer.texW : Wdoc;
  const Lh = Number.isFinite(layer.texH) ? layer.texH : Hdoc;

  // pivot in document px
  const pivX = Number.isFinite(layer.px) ? layer.px : Wdoc * 0.5;
  const pivY = Number.isFinite(layer.py) ? layer.py : Hdoc * 0.5;

  // local corners in doc space (layer’s texture rect)
  const corners = [
    {x:Lx,     y:Ly     }, {x:Lx+Lw, y:Ly     },
    {x:Lx,     y:Ly+Lh  }, {x:Lx+Lw, y:Ly+Lh  }
  ];

  const c = Math.cos(layer.rotation || 0);
  const s = Math.sin(layer.rotation || 0);

  function tf(pt) {
    // translate to pivot
    let dx = pt.x - pivX;
    let dy = pt.y - pivY;
    // scale
    dx *= (Number.isFinite(layer.scaleX) ? layer.scaleX : 1);
    dy *= (Number.isFinite(layer.scaleY) ? layer.scaleY : 1);
    // rotate
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    // back to doc + translation
    const docX = pivX + rx + (Number.isFinite(layer.x) ? layer.x : 0);
    const docY = pivY + ry + (Number.isFinite(layer.y) ? layer.y : 0);
    // to screen
    return { x: docX * sx, y: docY * sy };
  }

  const p0 = tf(corners[0]);
  const p1 = tf(corners[1]);
  const p2 = tf(corners[2]);
  const p3 = tf(corners[3]);

  const verts = new Float32Array([
    p0.x, p0.y, 0, 0,
    p1.x, p1.y, 1, 0,
    p2.x, p2.y, 0, 1,
    p2.x, p2.y, 0, 1,
    p1.x, p1.y, 1, 0,
    p3.x, p3.y, 1, 1
  ]);

  gl.useProgram(program);

  const uFlipY = gl.getUniformLocation(program, "u_flipY");
  if (uFlipY) gl.uniform1f(uFlipY, -1.0);
  const uRes = gl.getUniformLocation(program, "u_resolution");
  if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
  const uOpacity = gl.getUniformLocation(program, "u_layerOpacity");
  if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, layer.opacity || 1)));

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  const posLoc = gl.getAttribLocation(program, "a_position");
  const texLoc = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(texLoc);
  gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, layer.texture);
  const uTex = gl.getUniformLocation(program, "u_texture");
  if (uTex) gl.uniform1i(uTex, 0);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(texLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buf);
}










let transformTool = {
  mode: "idle",       // "idle" | "grab" | "scale" | "rotate"
  start: null,        // {cx, cy} start in canvas pixels
  ref: null,          // reference copy of layer transform when gesture starts
  shiftInvert: false, // for Shift+S / Shift+R
};

// === ADD: sticky mobile transform lock helpers (per-layer) ===
// When locked on mobile, the transform UI stays active for the active layer
// and the user can do multiple drags/pinches without re-tapping the button.

function setLayerTransformLock(layerIndex, locked) {
  const L = layers[layerIndex];
  if (!L) return;
  L.transformLocked = !!locked;

  // Keep UI (button) in sync
  const list = document.getElementById("layersList");
  if (list) {
    const rows = list.querySelectorAll(".layer-item");
    rows.forEach((row) => {
      const idxAttr = row.getAttribute("data-index");
      const idx = idxAttr !== null ? Number(idxAttr) : null;
      if (idx === layerIndex) {
        const btn = row.querySelector(".transform-btn");
        if (btn) btn.classList.toggle("is-active", locked);
      }
    });
  }

  // Tool flags
  if (locked && layerIndex === activeLayerIndex) {
    transformTool.mobileCombo = true; // combined: 1-finger drag, 2-finger pinch/rotate
    if (transformTool.mode === "idle") {
      // enter grab so next pointer move works immediately
      startTransform("grab");
    }
  } else if (!locked) {
    // only clear global flag if nothing else is locked
    const anyLocked = layers.some(Ly => !!Ly.transformLocked);
    if (!anyLocked) {
      transformTool.mobileCombo = false;
      if (transformTool.mode !== "idle") endTransform(true);
    }
  }

  needsRedraw = true;
}

function clearTransformLockAll() {
  layers.forEach(L => { if (L) L.transformLocked = false; });
  transformTool.mobileCombo = false;

  // Reset UI buttons
  const list = document.getElementById("layersList");
  if (list) {
    list.querySelectorAll(".transform-btn.is-active").forEach(btn => btn.classList.remove("is-active"));
  }

  // Exit transform if running
  if (transformTool.mode !== "idle") endTransform(true);
  needsRedraw = true;
}


function onTransformPointerMove(ev) {
  if (transformTool.mode === "idle") return;
  const p = pointerToBoth(ev); // { cx, cy, fx, fy }
  const L = getActiveLayer(); if (!L) return;

  if (!transformTool.start) transformTool.start = { cx: p.cx, cy: p.cy };

  const dx = p.cx - transformTool.start.cx;
  const dy = p.cy - transformTool.start.cy;

  const toDocX = fixedFBOWidth  / canvas.width;
  const toDocY = fixedFBOHeight / canvas.height;

  if (transformTool.mode === "grab") {
    L.x = transformTool.ref.x + dx * toDocX;
    L.y = transformTool.ref.y + dy * toDocY;


    } else if (transformTool.mode === "scale") {
      // --- config knobs ---
      const SENSITIVITY = 0.004;  // smaller = less sensitive (try 0.003–0.006)
      const DEADZONE    = 3;      // px around start where scale ≈ 1
      const MIN_RADIUS  = 40;     // avoid exploding when starting near pivot
      const MIN_SCALE   = 0.05;
      const MAX_SCALE   = 20;

      // pivot in canvas pixels
      const pc = transformTool.pivotCanvas || { cx: canvas.width * 0.5, cy: canvas.height * 0.5 };

      // distances from pivot at start vs current
      const s0x = transformTool.start.cx - pc.cx;
      const s0y = transformTool.start.cy - pc.cy;
      const sx  = p.cx - pc.cx;
      const sy  = p.cy - pc.cy;

      // clamp the starting radius so near-pivot gestures aren’t explosive
      const d0raw = Math.hypot(s0x, s0y);
      const d1    = Math.hypot(sx,  sy);
      const d0    = Math.max(MIN_RADIUS, d0raw);

      // signed distance change
      let delta = d1 - d0raw;

      // deadzone so a few pixels ≈ no change
      if (Math.abs(delta) <= DEADZONE) delta = 0;
      else delta = delta - Math.sign(delta) * DEADZONE;

      // smooth exponential mapping (direction preserved by the sign of delta)
      let f = Math.exp(delta * SENSITIVITY);

      // optional invert (Shift+S)
      if (transformTool.shiftInvert) f = 1 / Math.max(f, 1e-6);

      // apply uniformly; clamp
      const baseX = transformTool.ref.scaleX;
      const baseY = transformTool.ref.scaleY;
      const newScale = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v * f));

      L.scaleX = newScale(baseX);
      L.scaleY = newScale(baseY);
    

  } else if (transformTool.mode === "rotate") {
    const pc = transformTool.pivotCanvas || { cx: canvas.width*0.5, cy: canvas.height*0.5 };
    const a0 = Math.atan2(transformTool.start.cy - pc.cy, transformTool.start.cx - pc.cx);
    const a1 = Math.atan2(p.cy - pc.cy, p.cx - pc.cx);
    let delta = a1 - a0;
    if (transformTool.shiftInvert) delta = -delta;
    const step = Math.PI / 90; // ~2°
    delta = Math.round(delta / step) * step;
    L.rotation = transformTool.ref.rotation + delta;
  }

  needsRedraw = true;
}


// === REPLACE ENTIRE FUNCTION: startTransform (keeps comments) ===
function startTransform(mode, withShift=false) {
  const L = getActiveLayer(); 
  if (!L) { console.warn("[transform] no active layer"); return; }

  // sanitize
  L.x = Number.isFinite(L.x) ? L.x : 0;
  L.y = Number.isFinite(L.y) ? L.y : 0;
  L.scaleX = Number.isFinite(L.scaleX) ? L.scaleX : 1;
  L.scaleY = Number.isFinite(L.scaleY) ? L.scaleY : 1;
  L.rotation = Number.isFinite(L.rotation) ? L.rotation : 0;

  // compute pivot from last pointer if available, else canvas center
  let pcx = (lastX != null) ? lastX : canvas.width * 0.5;
  let pcy = (lastY != null) ? lastY : canvas.height * 0.5;
  const pf = canvasPxToFBO(pcx, pcy);

  // store pivot on the layer (document/FBO space)
  L.px = Math.max(0, Math.min(fixedFBOWidth,  pf.fx));
  L.py = Math.max(0, Math.min(fixedFBOHeight, pf.fy));

  // also stash the pivot in canvas px for the gesture math
  const toCanvasX = canvas.width  / fixedFBOWidth;
  const toCanvasY = canvas.height / fixedFBOHeight;
  transformTool.pivotCanvas = { cx: L.px * toCanvasX, cy: L.py * toCanvasY };

  transformTool.mode = mode;
  transformTool.shiftInvert = withShift;
  transformTool.ref = {
    x: L.x, y: L.y,
    scaleX: L.scaleX, scaleY: L.scaleY,
    rotation: L.rotation,
    px: L.px, py: L.py
  };
  transformTool.start = null; // set on first move

  // --- HARD STOP any in-progress painting before entering transform ---
  if (isDrawing) {
    isDrawing = false;
    stopRender("draw");
  }

  startRender("transform");

  showStatusMessage(
    mode === "grab" ? "Grab (move) layer" :
    mode === "scale" ? (withShift ? "Scale (down)" : "Scale (up)") :
    mode === "rotate" ? (withShift ? "Rotate (counter-clockwise)" : "Rotate (clockwise)") :
    "", "info"
  );

  needsRedraw = true;
}



// bake: true → applyActiveLayerTransform() so drawing aligns with cursor

/* endTransform(bake = true)
   Purpose: finalize the current transform gesture. If bake=true, bake transform into pixels and
   record a History entry that has BEFORE/AFTER snapshots with pose metadata, so undo/redo exactly
   restores pixels and transform. If bake=false, cancel without changing pixels.
   Behavior fixes:
   - Snapshot BEFORE and AFTER from the layer FBO to prevent Y flips and drift.
   - After baking, the layer pose is reset to neutral so subsequent preview/undo do not double-apply.
   - Clears gesture state to avoid stale reference frames.
   Drop-in replacement. */
function endTransform(bake = true) {
  const running = transformTool && transformTool.mode && transformTool.mode !== "idle";
  if (!running) {
    try { isTwoFingerGesture = false; pinchStart = null; } catch {}
    if (transformTool) transformTool.mode = "idle";
    needsRedraw = true; if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    return;
  }

  try { stopRender?.("transform"); } catch {}

  let didBake = false;
  if (bake) {
    try {
      const before = snapshotLayer(activeLayerIndex);
      applyActiveLayerTransform();          // bakes and resets transform to neutral
      const after  = snapshotLayer(activeLayerIndex);
      if (before && after) {
        History.push({ type: "transform_bake", before, after });
      }
      didBake = true;
    } catch (e) {
      console.warn("[endTransform] bake failed", e);
      didBake = false;
    }
  }

  // Clear transform gesture state to avoid reusing stale frames
  try {
    transformTool.start = null;
    transformTool.ref = null;
    transformTool.shiftInvert = false;
    transformTool.pivotCanvas = null;
  } catch {}
  if (transformTool) transformTool.mode = "idle";
  try { isTwoFingerGesture = false; pinchStart = null; } catch {}

  // Keep armed on mobile if layer is transform-locked
  const L = getActiveLayer?.();
  const stayArmed = !!(L && L.transformLocked);
  if (transformTool) transformTool.mobileCombo = stayArmed;
  if (stayArmed) queueMicrotask?.(() => startTransform?.("grab"));

  showStatusMessage?.(didBake ? "Transform applied" : (bake ? "Transform failed" : "Transform cancelled"),
                      didBake ? "success" : (bake ? "warning" : "info"));
  needsRedraw = true; if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
}






// Create (or recreate) the layers stack matching fixed FBO size.
function initPaintLayerFixed() {
  // dispose old
  layers.forEach(L => { gl.deleteTexture(L.texture); gl.deleteFramebuffer(L.fbo); });
  layers = [];
  activeLayerIndex = 0;

  // one default layer
  addLayer("Layer 1", -1);
  syncActiveAliases();   // legacy aliases kept in sync
}



/* mergeSelectedLayers()
   Merges only the currently selected layers into a single new layer in DOCUMENT SPACE without Y-flips.
   Composition is done into a document-sized FBO using the same orientation as layer FBOs (u_flipY = 1.0),
   so pixels remain upright. Stacking order is preserved (back→front). The resulting layer keeps a neutral
   transform (x,y=0; scale=1; rotation=0); its texture rect spans the full document (endless canvas safe).
   The layers list is rebuilt, selection is updated to the merged layer, and a detailed log is printed.
   A single History “merge_layers” action is pushed with CPU snapshots for perfect undo/redo. */
function mergeSelectedLayers() {
  try {
    if (!gl || !quadProgram || !Array.isArray(layers) || layers.length === 0) {
      console.warn("[mergeSelectedLayers] GL or layers not ready");
      return;
    }
    // Resolve selected indices; require at least 2 layers
    let sel = [];
    if (typeof selectedLayerIndices?.forEach === "function") {
      selectedLayerIndices.forEach(i => { if (Number.isFinite(i)) sel.push(i | 0); });
    }
    sel = sel.filter(i => i >= 0 && i < layers.length);
    if (sel.length < 2) {
      showStatusMessage?.("Select at least two layers to merge", "warning");
      console.warn("[mergeSelectedLayers] not enough selected layers", sel);
      return;
    }

    // Sort bottom→top to keep paint order
    sel.sort((a, b) => a - b);

    const Wdoc = fixedFBOWidth | 0;
    const Hdoc = fixedFBOHeight | 0;

    // Preserve GL state
    const prevFBO      = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const prevProg     = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevViewport = gl.getParameter(gl.VIEWPORT);
    const wasBlend     = gl.isEnabled(gl.BLEND);

    // Create document-sized composite target
    const compositeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, compositeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Wdoc, Hdoc, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const compositeFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, compositeFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, compositeTex, 0);

    gl.viewport(0, 0, Wdoc, Hdoc);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Program + uniforms
    gl.useProgram(quadProgram);
    const uTex      = gl.getUniformLocation(quadProgram, "u_texture");
    const uRes      = gl.getUniformLocation(quadProgram, "u_resolution");
    const uFlipY    = gl.getUniformLocation(quadProgram, "u_flipY");
    const uOpacity  = gl.getUniformLocation(quadProgram, "u_layerOpacity");
    if (uRes)   gl.uniform2f(uRes, Wdoc, Hdoc);
    if (uFlipY) gl.uniform1f(uFlipY, 1.0); // match layer FBO/document orientation to prevent Y flips

    // Single VBO reused for all quads
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const aPos = gl.getAttribLocation(quadProgram, "a_position");
    const aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUV);

    // Draw each selected layer with its current transform into the composite FBO
    let drawnCount = 0;
    for (const idx of sel) {
      const L = layers[idx];
      if (!L || L.visible === false || !L.texture) continue;

      const Lx   = Number.isFinite(L.ox) ? L.ox : 0;
      const Ly   = Number.isFinite(L.oy) ? L.oy : 0;
      const Lw   = Math.max(1, Number.isFinite(L.texW) ? L.texW : Wdoc);
      const Lh   = Math.max(1, Number.isFinite(L.texH) ? L.texH : Hdoc);
      const scx  = Number.isFinite(L.scaleX) ? L.scaleX : 1;
      const scy  = Number.isFinite(L.scaleY) ? L.scaleY : 1;
      const rot  = Number.isFinite(L.rotation) ? L.rotation : 0;
      const tx   = Number.isFinite(L.x) ? L.x : 0;
      const ty   = Number.isFinite(L.y) ? L.y : 0;
      const pivX = Number.isFinite(L.px) ? L.px : Wdoc * 0.5;
      const pivY = Number.isFinite(L.py) ? L.py : Hdoc * 0.5;

      const c = Math.cos(rot), s = Math.sin(rot);
      function tf(x, y) {
        let dx = (x - pivX) * scx, dy = (y - pivY) * scy;
        const rx = dx * c - dy * s, ry = dx * s + dy * c;
        return { x: pivX + rx + tx, y: pivY + ry + ty };
      }

      const p0 = tf(Lx,      Ly);
      const p1 = tf(Lx + Lw, Ly);
      const p2 = tf(Lx,      Ly + Lh);
      const p3 = tf(Lx + Lw, Ly + Lh);

      const verts = new Float32Array([
        p0.x, p0.y, 0, 0,
        p1.x, p1.y, 1, 0,
        p2.x, p2.y, 0, 1,
        p2.x, p2.y, 0, 1,
        p1.x, p1.y, 1, 0,
        p3.x, p3.y, 1, 1
      ]);

      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8);

      if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, L.opacity ?? 1)));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, L.texture);
      if (uTex) gl.uniform1i(uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawnCount++;
    }

    // Read back composite into CPU snapshot
    const mergedPixels = new Uint8Array(Wdoc * Hdoc * 4);
    gl.readPixels(0, 0, Wdoc, Hdoc, gl.RGBA, gl.UNSIGNED_BYTE, mergedPixels);

    // Cleanup VBO and restore GL state
    gl.disableVertexAttribArray(aPos);
    gl.disableVertexAttribArray(aUV);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.deleteBuffer(vbo);

    if (!wasBlend) gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
    gl.useProgram(prevProg);
    if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

    // Build History payload BEFORE mutating layers: CPU snapshots of originals
    const removed = sel.map(i => ({
      index: i,
      data: {
        name: layers[i].name,
        visible: (layers[i].visible !== false),
        opacity: (typeof layers[i].opacity === "number" ? layers[i].opacity : 1),
        snapshot: snapshotLayer(i)
      }
    }));

    // Remove originals (top→bottom), delete GL resources
    for (let k = sel.length - 1; k >= 0; k--) {
      const rmIdx = sel[k];
      const L = layers[rmIdx];
      if (L) {
        try { if (L.texture) gl.deleteTexture(L.texture); } catch {}
        try { if (L.fbo) gl.deleteFramebuffer(L.fbo); } catch {}
        layers.splice(rmIdx, 1);
      }
    }

    // Insert merged layer at position of the top-most original (comp remains document-sized)
    const insertIndex = Math.min(sel[sel.length - 1] - (sel.length - 1), layers.length);
    const mergedData = {
      name: `Merged (${sel.length})`,
      visible: true,
      opacity: 1,
      snapshot: { index: insertIndex, w: Wdoc, h: Hdoc, pixels: mergedPixels }
    };
    History._insertLayer(insertIndex, mergedData);

    // Update selection/UI
    activeLayerIndex = insertIndex;
    if (typeof selectedLayerIndices?.clear === "function") {
      selectedLayerIndices.clear();
      selectedLayerIndices.add(insertIndex);
    }
    syncActiveAliases?.();
    rebuildLayersUI?.();
    needsRedraw = true;
    requestDrawIfIdle?.();

    // Push History action
    const added = {
      index: insertIndex,
      data: {
        name: mergedData.name,
        visible: true,
        opacity: 1,
        snapshot: snapshotLayer(insertIndex)
      }
    };
    History.push({ type: "merge_layers", removed, added });

    // Verbose confirmation
    showStatusMessage?.(
      `Merged ${drawnCount}/${sel.length} selected layer(s) → index ${insertIndex}`,
      "success"
    );
    console.log("[mergeSelectedLayers] done", {
      selected: sel,
      drawnCount,
      insertIndex,
      doc: { Wdoc, Hdoc }
    });
  } catch (err) {
    console.error("[mergeSelectedLayers] failed", err);
    showStatusMessage?.("Merge failed – see console for details", "error");
    needsRedraw = true;
    requestDrawIfIdle?.();
  }
}




function mergeAllLayers() {
  if (!gl || !layers || layers.length < 2) return;
  selectedLayerIndices = new Set(layers.map((_, i) => i));
  mergeSelectedLayers();
}


// function mergeSelectedLayers() {

//   // ==== PRECHECKS ====
//   if (!gl || !layers?.length || selectedLayerIndices.size < 2) {
//     console.debug("[merge] abort: gl/layers/selection invalid", {
//       gl: !!gl,
//       layersLen: layers?.length ?? 0,
//       selCount: selectedLayerIndices?.size ?? 0
//     });
//     return;
//   }

//   // bottom → top (lower index = below)
//   const sel = Array.from(selectedLayerIndices).sort((a, b) => a - b);
//   const W = fixedFBOWidth;
//   const H = fixedFBOHeight;

//   let dstTex, dstFbo;
//   try {
//     ({ texture: dstTex, fbo: dstFbo } = createLayerFBO(W, H));
//   } catch (e) {
//     console.error("[merge] createLayerFBO failed", e, { W, H });
//     return;
//   }

//   // ==== GL STATE SAVE ====
//   const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
//   const prevViewport = gl.getParameter(gl.VIEWPORT);
//   const blendWas = gl.isEnabled(gl.BLEND);
//   const depthWas = gl.isEnabled(gl.DEPTH_TEST);
//   const cullWas = gl.isEnabled(gl.CULL_FACE);
//   const scissorWas = gl.isEnabled(gl.SCISSOR_TEST);

//   // ==== HELPERS ====
//   function hashRow(ySample) {
//     try {
//       const buf = new Uint8Array(W * 4);
//       gl.readPixels(0, ySample, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
//       let h = 2166136261 >>> 0;
//       for (let i = 0; i < buf.length; i++) {
//         h ^= buf[i];
//         h = Math.imul(h, 16777619) >>> 0;
//       }
//       return ("00000000" + h.toString(16)).slice(-8);
//     } catch (e) {
//       console.debug("[merge] hashRow/readPixels failed", e);
//       return "readFail";
//     }
//   }

//   function logEdgeDiagnostics(stageLabel) {
//     const topHash = hashRow(H - 1);
//     const bottomHash = hashRow(0);
//     console.debug(`[merge] ${stageLabel} | hashes`, {
//       topHash,
//       bottomHash,
//       equal: topHash === bottomHash
//     });
//   }

//   // Draw one layer into the offscreen target using TARGET resolution (no rescale vs doc)
//   function drawLayerIntoTarget(program, layer, targetW, targetH) {
//     const docW = fixedFBOWidth, docH = fixedFBOHeight;

//     const sx = targetW / docW;
//     const sy = targetH / docH;

//     const pivX = Number.isFinite(layer.px) ? layer.px : docW * 0.5;
//     const pivY = Number.isFinite(layer.py) ? layer.py : docH * 0.5;

//     const c = Math.cos(layer.rotation || 0);
//     const s = Math.sin(layer.rotation || 0);

//     function tf(x, y) {
//       let dx = x - pivX;
//       let dy = y - pivY;
//       dx *= (Number.isFinite(layer.scaleX) ? layer.scaleX : 1);
//       dy *= (Number.isFinite(layer.scaleY) ? layer.scaleY : 1);
//       const rx = dx * c - dy * s;
//       const ry = dx * s + dy * c;
//       const docX = pivX + rx + (Number.isFinite(layer.x) ? layer.x : 0);
//       const docY = pivY + ry + (Number.isFinite(layer.y) ? layer.y : 0);
//       return { x: docX * sx, y: docY * sy };
//     }

//     const p0 = tf(0, 0);
//     const p1 = tf(docW, 0);
//     const p2 = tf(0, docH);
//     const p3 = tf(docW, docH);

//     // CRITICAL: flip the V texcoord here; keep u_flipY = -1.0.
//     const verts = new Float32Array([
//       p0.x, p0.y, 0, 1,
//       p1.x, p1.y, 1, 1,
//       p2.x, p2.y, 0, 0,
//       p2.x, p2.y, 0, 0,
//       p1.x, p1.y, 1, 1,
//       p3.x, p3.y, 1, 0
//     ]);

//     gl.useProgram(program);

//     // Match live rendering path: top-left UI coords, no extra passes.
//     const uFlipY = gl.getUniformLocation(program, "u_flipY");
//     if (uFlipY) gl.uniform1f(uFlipY, -1.0);

//     const uRes = gl.getUniformLocation(program, "u_resolution");
//     if (uRes) gl.uniform2f(uRes, targetW, targetH);

//     const uOpacity = gl.getUniformLocation(program, "u_layerOpacity");
//     if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, layer.opacity || 1)));

//     const buf = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, buf);
//     gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

//     const posLoc = gl.getAttribLocation(program, "a_position");
//     const texLoc = gl.getAttribLocation(program, "a_texCoord");
//     gl.enableVertexAttribArray(posLoc);
//     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
//     gl.enableVertexAttribArray(texLoc);
//     gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

//     gl.activeTexture(gl.TEXTURE0);
//     gl.bindTexture(gl.TEXTURE_2D, layer.texture);
//     const uTex = gl.getUniformLocation(program, "u_texture");
//     if (uTex) gl.uniform1i(uTex, 0);

//     gl.drawArrays(gl.TRIANGLES, 0, 6);

//     gl.disableVertexAttribArray(posLoc);
//     gl.disableVertexAttribArray(texLoc);
//     gl.bindBuffer(gl.ARRAY_BUFFER, null);
//     gl.deleteBuffer(buf);
//   }

//   // ==== COMPOSE PASS (OFFSCREEN, TARGET-RES; NO Y-FLIP AFTER) ====
//   try {
//     console.groupCollapsed?.("[merge] compose start");
//     gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//     gl.viewport(0, 0, W, H);
//     gl.disable(gl.DEPTH_TEST);
//     gl.disable(gl.CULL_FACE);
//     gl.disable(gl.SCISSOR_TEST);
//     gl.clearColor(0, 0, 0, 0);
//     gl.clear(gl.COLOR_BUFFER_BIT);

//     // Preserve exact visual blending as live view
//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

//     console.debug("[merge] target", { W, H, sel, activeLayerIndex });

//     for (const i of sel) {
//       const L = layers[i];
//       if (!L) { console.warn("[merge] missing layer at index", i); continue; }
//       if (!L.visible || L.opacity <= 0) {
//         console.debug("[merge] skip invisible/zero-opacity", { i, name: L?.name, visible: L?.visible, opacity: L?.opacity });
//         continue;
//       }
//       if (!gl.isTexture(L.texture)) {
//         console.warn("[merge] skip: invalid texture", { i, name: L?.name });
//         continue;
//       }
//       console.debug("[merge] draw layer", {
//         i, name: L.name,
//         x: L.x, y: L.y,
//         scaleX: L.scaleX, scaleY: L.scaleY,
//         rotation: L.rotation,
//         px: L.px, py: L.py,
//         opacity: L.opacity, visible: L.visible
//       });
//       drawLayerIntoTarget(quadProgram, L, W, H);
//     }

//     logEdgeDiagnostics("after-compose");
//   } catch (err) {
//     console.error("[merge] unexpected error", err);
//   } finally {
//     // ==== RESTORE GL STATE ====
//     if (!blendWas) gl.disable(gl.BLEND);
//     if (depthWas) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
//     if (cullWas) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
//     if (scissorWas) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
//     if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
//     console.groupEnd?.();
//   }

//   // ==== BUILD MERGED LAYER ====
//   const topIdx = sel[sel.length - 1];
//   const merged = {
//     id: Date.now() + Math.random(),
//     name: `Merged (${sel.length})`,
//     fbo: dstFbo,
//     texture: dstTex,
//     visible: true,
//     opacity: 1,
//     x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
//     px: W * 0.5,
//     py: H * 0.5,
//     history: [],
//     redo: []
//   };

//   // remove originals top → bottom
//   for (let k = sel.length - 1; k >= 0; k--) {
//     const rm = sel[k];
//     const L = layers[rm];
//     console.debug("[merge] removing original layer", { rm, name: L?.name });
//     try { if (L?.texture && gl.isTexture(L.texture)) gl.deleteTexture(L.texture); } catch (e) { console.debug("[merge] deleteTexture err", e); }
//     try { if (L?.fbo) gl.deleteFramebuffer(L.fbo); } catch (e) { console.debug("[merge] deleteFramebuffer err", e); }
//     layers.splice(rm, 1);
//   }

//   // insert merged where topmost used to be
//   const insertAt = Math.min(topIdx, layers.length);
//   layers.splice(insertAt, 0, merged);
//   activeLayerIndex = insertAt;

//   // selection → merged only
//   selectedLayerIndices.clear();
//   selectedLayerIndices.add(activeLayerIndex);

//   console.debug("[merge] done", {
//     insertAt,
//     mergedId: merged.id,
//     layersLen: layers.length,
//     activeLayerIndex,
//     canvasSize: { W, H }
//   });

//   syncActiveAliases?.();
//   rebuildLayersUI?.();
//   showStatusMessage?.("Layers merged", "success");
//   needsRedraw = true;
//   requestDrawIfIdle?.();
// }






// function mergeSelectedLayers() {
//   // ==== PRECHECKS ====
//   if (!gl || !layers?.length || selectedLayerIndices.size < 2) {
//     console.debug("[merge] abort: gl/layers/selection invalid", {
//       gl: !!gl,
//       layersLen: layers?.length ?? 0,
//       selCount: selectedLayerIndices?.size ?? 0
//     });
//     return;
//   }

//   // bottom → top (lower index = below)
//   const sel = Array.from(selectedLayerIndices).sort((a, b) => a - b);
//   const W = fixedFBOWidth;
//   const H = fixedFBOHeight;

//   // Create merge FBO with NEAREST filtering for detail preservation
//   let dstTex, dstFbo;
//   try {
//     const tex = gl.createTexture();
//     gl.bindTexture(gl.TEXTURE_2D, tex);
//     gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

//     dstFbo = gl.createFramebuffer();
//     gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//     gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
//     gl.clearColor(0, 0, 0, 0);
//     gl.clear(gl.COLOR_BUFFER_BIT);
//     dstTex = tex;
//     gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//   } catch (e) {
//     console.error("[merge] createLayerFBO failed", e, { W, H });
//     return;
//   }

//   // ==== GL STATE SAVE ====
//   const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
//   const prevViewport = gl.getParameter(gl.VIEWPORT);
//   const blendWas = gl.isEnabled(gl.BLEND);
//   const depthWas = gl.isEnabled(gl.DEPTH_TEST);
//   const cullWas = gl.isEnabled(gl.CULL_FACE);
//   const scissorWas = gl.isEnabled(gl.SCISSOR_TEST);

//   // ==== HELPERS ====
//   function hashRow(ySample) {
//     try {
//       const buf = new Uint8Array(W * 4);
//       gl.readPixels(0, ySample, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
//       let h = 2166136261 >>> 0;
//       for (let i = 0; i < buf.length; i++) {
//         h ^= buf[i];
//         h = Math.imul(h, 16777619) >>> 0;
//       }
//       return ("00000000" + h.toString(16)).slice(-8);
//     } catch (e) {
//       console.debug("[merge] hashRow/readPixels failed", e);
//       return "readFail";
//     }
//   }

//   function logEdgeDiagnostics(stageLabel) {
//     const topHash = hashRow(H - 1);
//     const bottomHash = hashRow(0);
//     console.debug(`[merge] ${stageLabel} | hashes`, {
//       topHash,
//       bottomHash,
//       equal: topHash === bottomHash
//     });
//   }

//   // Draw one layer into the offscreen target with pixel-perfect coordinates
//   function drawLayerIntoTarget(program, layer, targetW, targetH) {
//     const docW = fixedFBOWidth, docH = fixedFBOHeight;

//     const sx = targetW / docW;
//     const sy = targetH / docH;

//     const pivX = Math.round(Number.isFinite(layer.px) ? layer.px : docW * 0.5);
//     const pivY = Math.round(Number.isFinite(layer.py) ? layer.py : docH * 0.5);

//     const c = Math.cos(layer.rotation || 0);
//     const s = Math.sin(layer.rotation || 0);

//     function tf(x, y) {
//       let dx = x - pivX;
//       let dy = y - pivY;
//       dx *= (Number.isFinite(layer.scaleX) ? layer.scaleX : 1);
//       dy *= (Number.isFinite(layer.scaleY) ? layer.scaleY : 1);
//       const rx = dx * c - dy * s;
//       const ry = dx * s + dy * c;
//       const docX = pivX + rx + (Number.isFinite(layer.x) ? layer.x : 0);
//       const docY = pivY + ry + (Number.isFinite(layer.y) ? layer.y : 0);
//       // Snap to pixel grid in target FBO space
//       return { x: Math.round(docX * sx), y: Math.round(docY * sy) };
//     }

//     const p0 = tf(0, 0);
//     const p1 = tf(docW, 0);
//     const p2 = tf(0, docH);
//     const p3 = tf(docW, docH);

//     // Flip texture v-coordinate for FBO (v = 1 - v) to match top-left origin
//     const verts = new Float32Array([
//       p0.x, p0.y, 0, 1,
//       p1.x, p1.y, 1, 1,
//       p2.x, p2.y, 0, 0,
//       p2.x, p2.y, 0, 0,
//       p1.x, p1.y, 1, 1,
//       p3.x, p3.y, 1, 0
//     ]);

//     gl.useProgram(program);

//     const uFlipY = gl.getUniformLocation(program, "u_flipY");
//     if (uFlipY) gl.uniform1f(uFlipY, -1.0);

//     const uRes = gl.getUniformLocation(program, "u_resolution");
//     if (uRes) gl.uniform2f(uRes, targetW, targetH);

//     const uOpacity = gl.getUniformLocation(program, "u_layerOpacity");
//     if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, layer.opacity || 1)));

//     const buf = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, buf);
//     gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

//     const posLoc = gl.getAttribLocation(program, "a_position");
//     const texLoc = gl.getAttribLocation(program, "a_texCoord");
//     gl.enableVertexAttribArray(posLoc);
//     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
//     gl.enableVertexAttribArray(texLoc);
//     gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

//     // Preserve source texture details with NEAREST during merge
//     gl.activeTexture(gl.TEXTURE0);
//     gl.bindTexture(gl.TEXTURE_2D, layer.texture);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
//     const uTex = gl.getUniformLocation(program, "u_texture");
//     if (uTex) gl.uniform1i(uTex, 0);

//     gl.drawArrays(gl.TRIANGLES, 0, 6);

//     gl.disableVertexAttribArray(posLoc);
//     gl.disableVertexAttribArray(texLoc);
//     gl.bindBuffer(gl.ARRAY_BUFFER, null);
//     gl.deleteBuffer(buf);
//   }

//   // ==== COMPOSE PASS ====
//   try {
//     console.groupCollapsed?.("[merge] compose start");
//     gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//     gl.viewport(0, 0, W, H);
//     gl.disable(gl.DEPTH_TEST);
//     gl.disable(gl.CULL_FACE);
//     gl.disable(gl.SCISSOR_TEST);
//     gl.clearColor(0, 0, 0, 0);
//     gl.clear(gl.COLOR_BUFFER_BIT);

//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

//     console.debug("[merge] target", { W, H, sel, activeLayerIndex });

//     for (const i of sel) {
//       const L = layers[i];
//       if (!L) { console.warn("[merge] missing layer at index", i); continue; }
//       if (!L.visible || L.opacity <= 0) {
//         console.debug("[merge] skip invisible/zero-opacity", { i, name: L?.name, visible: L?.visible, opacity: L?.opacity });
//         continue;
//       }
//       if (!gl.isTexture(L.texture)) {
//         console.warn("[merge] skip: invalid texture", { i, name: L?.name });
//         continue;
//       }
//       console.debug("[merge] draw layer", {
//         i, name: L.name,
//         x: L.x, y: L.y,
//         scaleX: L.scaleX, scaleY: L.scaleY,
//         rotation: L.rotation,
//         px: L.px, py: L.py,
//         opacity: L.opacity, visible: L.visible
//       });
//       drawLayerIntoTarget(quadProgram, L, W, H);
//     }

//     logEdgeDiagnostics("after-compose");
//   } catch (err) {
//     console.error("[merge] unexpected error", err);
//   } finally {
//     // ==== RESTORE GL STATE ====
//     if (!blendWas) gl.disable(gl.BLEND);
//     if (depthWas) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
//     if (cullWas) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
//     if (scissorWas) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
//     if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
//     console.groupEnd?.();
//   }

//   // ==== BUILD MERGED LAYER ====
//   const topIdx = sel[sel.length - 1];
//   const merged = {
//     id: Date.now() + Math.random(),
//     name: `Merged (${sel.length})`,
//     fbo: dstFbo,
//     texture: dstTex,
//     visible: true,
//     opacity: 1,
//     x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
//     px: W * 0.5,
//     py: H * 0.5,
//     history: [],
//     redo: []
//   };

//   // remove originals top → bottom
//   for (let k = sel.length - 1; k >= 0; k--) {
//     const rm = sel[k];
//     const L = layers[rm];
//     console.debug("[merge] removing original layer", { rm, name: L?.name });
//     try { if (L?.texture && gl.isTexture(L.texture)) gl.deleteTexture(L.texture); } catch (e) { console.debug("[merge] deleteTexture err", e); }
//     try { if (L?.fbo) gl.deleteFramebuffer(L.fbo); } catch (e) { console.debug("[merge] deleteFramebuffer err", e); }
//     layers.splice(rm, 1);
//   }

//   // insert merged where topmost used to be
//   const insertAt = Math.min(topIdx, layers.length);
//   layers.splice(insertAt, 0, merged);
//   activeLayerIndex = insertAt;

//   // selection → merged only
//   selectedLayerIndices.clear();
//   selectedLayerIndices.add(activeLayerIndex);

//   console.debug("[merge] done", {
//     insertAt,
//     mergedId: merged.id,
//     layersLen: layers.length,
//     activeLayerIndex,
//     canvasSize: { W, H }
//   });

//   syncActiveAliases?.();
//   rebuildLayersUI?.();
//   showStatusMessage?.("Layers merged", "success");
//   needsRedraw = true;
//   requestDrawIfIdle?.();
// }



// function mergeSelectedLayers() {
//   // ==== PRECHECKS ====
//   if (!gl || !layers?.length || selectedLayerIndices.size < 2) {
//     console.debug("[merge] abort: gl/layers/selection invalid", {
//       gl: !!gl,
//       layersLen: layers?.length ?? 0,
//       selCount: selectedLayerIndices?.size ?? 0
//     });
//     return;
//   }

//   // bottom → top (lower index = below)
//   const sel = Array.from(selectedLayerIndices).sort((a, b) => a - b);
//   const W = fixedFBOWidth;
//   const H = fixedFBOHeight;

//   let dstTex, dstFbo;
//   try {
//     ({ texture: dstTex, fbo: dstFbo } = createLayerFBO(W, H));
//   } catch (e) {
//     console.error("[merge] createLayerFBO failed", e, { W, H });
//     return;
//   }

//   // ==== GL STATE SAVE ====
//   const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
//   const prevViewport = gl.getParameter(gl.VIEWPORT);
//   const blendWas = gl.isEnabled(gl.BLEND);
//   const depthWas = gl.isEnabled(gl.DEPTH_TEST);
//   const cullWas = gl.isEnabled(gl.CULL_FACE);
//   const scissorWas = gl.isEnabled(gl.SCISSOR_TEST);

//   // ==== HELPERS ====
//   function hashRow(ySample) {
//     try {
//       const buf = new Uint8Array(W * 4);
//       gl.readPixels(0, ySample, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
//       let h = 2166136261 >>> 0;
//       for (let i = 0; i < buf.length; i++) {
//         h ^= buf[i];
//         h = Math.imul(h, 16777619) >>> 0;
//       }
//       return ("00000000" + h.toString(16)).slice(-8);
//     } catch (e) {
//       console.debug("[merge] hashRow/readPixels failed", e);
//       return "readFail";
//     }
//   }

//   function logEdgeDiagnostics(stageLabel) {
//     const topHash = hashRow(H - 1);
//     const bottomHash = hashRow(0);
//     console.debug(`[merge] ${stageLabel} | hashes`, {
//       topHash,
//       bottomHash,
//       equal: topHash === bottomHash
//     });
//   }

//   // Draw one layer into the offscreen target using TARGET resolution
//   function drawLayerIntoTarget(program, layer, targetW, targetH) {
//     const docW = fixedFBOWidth, docH = fixedFBOHeight;

//     const sx = targetW / docW;
//     const sy = targetH / docH;

//     const pivX = Number.isFinite(layer.px) ? layer.px : docW * 0.5;
//     const pivY = Number.isFinite(layer.py) ? layer.py : docH * 0.5;

//     const c = Math.cos(layer.rotation || 0);
//     const s = Math.sin(layer.rotation || 0);

//     function tf(x, y) {
//       let dx = x - pivX;
//       let dy = y - pivY;
//       dx *= (Number.isFinite(layer.scaleX) ? layer.scaleX : 1);
//       dy *= (Number.isFinite(layer.scaleY) ? layer.scaleY : 1);
//       const rx = dx * c - dy * s;
//       const ry = dx * s + dy * c;
//       const docX = pivX + rx + (Number.isFinite(layer.x) ? layer.x : 0);
//       const docY = pivY + ry + (Number.isFinite(layer.y) ? layer.y : 0);
//       // Round to nearest pixel to avoid subpixel sampling
//       return { x: Math.round(docX * sx), y: Math.round(docY * sy) };
//     }

//     const p0 = tf(0, 0);
//     const p1 = tf(docW, 0);
//     const p2 = tf(0, docH);
//     const p3 = tf(docW, docH);

//     // Flip texture v-coordinate for FBO (v = 1 - v) to match top-left origin
//     const verts = new Float32Array([
//       p0.x, p0.y, 0, 1,
//       p1.x, p1.y, 1, 1,
//       p2.x, p2.y, 0, 0,
//       p2.x, p2.y, 0, 0,
//       p1.x, p1.y, 1, 1,
//       p3.x, p3.y, 1, 0
//     ]);

//     gl.useProgram(program);

//     const uFlipY = gl.getUniformLocation(program, "u_flipY");
//     if (uFlipY) gl.uniform1f(uFlipY, -1.0);

//     const uRes = gl.getUniformLocation(program, "u_resolution");
//     if (uRes) gl.uniform2f(uRes, targetW, targetH);

//     const uOpacity = gl.getUniformLocation(program, "u_layerOpacity");
//     if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, layer.opacity || 1)));

//     const buf = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, buf);
//     gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

//     const posLoc = gl.getAttribLocation(program, "a_position");
//     const texLoc = gl.getAttribLocation(program, "a_texCoord");
//     gl.enableVertexAttribArray(posLoc);
//     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
//     gl.enableVertexAttribArray(texLoc);
//     gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

//     gl.activeTexture(gl.TEXTURE0);
//     gl.bindTexture(gl.TEXTURE_2D, layer.texture);
//     const uTex = gl.getUniformLocation(program, "u_texture");
//     if (uTex) gl.uniform1i(uTex, 0);

//     gl.drawArrays(gl.TRIANGLES, 0, 6);

//     gl.disableVertexAttribArray(posLoc);
//     gl.disableVertexAttribArray(texLoc);
//     gl.bindBuffer(gl.ARRAY_BUFFER, null);
//     gl.deleteBuffer(buf);
//   }

//   // ==== COMPOSE PASS ====
//   try {
//     console.groupCollapsed?.("[merge] compose start");
//     gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//     gl.viewport(0, 0, W, H);
//     gl.disable(gl.DEPTH_TEST);
//     gl.disable(gl.CULL_FACE);
//     gl.disable(gl.SCISSOR_TEST);
//     gl.clearColor(0, 0, 0, 0);
//     gl.clear(gl.COLOR_BUFFER_BIT);

//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

//     console.debug("[merge] target", { W, H, sel, activeLayerIndex });

//     for (const i of sel) {
//       const L = layers[i];
//       if (!L) { console.warn("[merge] missing layer at index", i); continue; }
//       if (!L.visible || L.opacity <= 0) {
//         console.debug("[merge] skip invisible/zero-opacity", { i, name: L?.name, visible: L?.visible, opacity: L?.opacity });
//         continue;
//       }
//       if (!gl.isTexture(L.texture)) {
//         console.warn("[merge] skip: invalid texture", { i, name: L?.name });
//         continue;
//       }
//       console.debug("[merge] draw layer", {
//         i, name: L.name,
//         x: L.x, y: L.y,
//         scaleX: L.scaleX, scaleY: L.scaleY,
//         rotation: L.rotation,
//         px: L.px, py: L.py,
//         opacity: L.opacity, visible: L.visible
//       });
//       drawLayerIntoTarget(quadProgram, L, W, H);
//     }

//     logEdgeDiagnostics("after-compose");
//   } catch (err) {
//     console.error("[merge] unexpected error", err);
//   } finally {
//     // ==== RESTORE GL STATE ====
//     if (!blendWas) gl.disable(gl.BLEND);
//     if (depthWas) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
//     if (cullWas) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
//     if (scissorWas) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
//     if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
//     console.groupEnd?.();
//   }

//   // ==== BUILD MERGED LAYER ====
//   const topIdx = sel[sel.length - 1];
//   const merged = {
//     id: Date.now() + Math.random(),
//     name: `Merged (${sel.length})`,
//     fbo: dstFbo,
//     texture: dstTex,
//     visible: true,
//     opacity: 1,
//     x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
//     px: W * 0.5,
//     py: H * 0.5,
//     history: [],
//     redo: []
//   };

//   // remove originals top → bottom
//   for (let k = sel.length - 1; k >= 0; k--) {
//     const rm = sel[k];
//     const L = layers[rm];
//     console.debug("[merge] removing original layer", { rm, name: L?.name });
//     try { if (L?.texture && gl.isTexture(L.texture)) gl.deleteTexture(L.texture); } catch (e) { console.debug("[merge] deleteTexture err", e); }
//     try { if (L?.fbo) gl.deleteFramebuffer(L.fbo); } catch (e) { console.debug("[merge] deleteFramebuffer err", e); }
//     layers.splice(rm, 1);
//   }

//   // insert merged where topmost used to be
//   const insertAt = Math.min(topIdx, layers.length);
//   layers.splice(insertAt, 0, merged);
//   activeLayerIndex = insertAt;

//   // selection → merged only
//   selectedLayerIndices.clear();
//   selectedLayerIndices.add(activeLayerIndex);

//   console.debug("[merge] done", {
//     insertAt,
//     mergedId: merged.id,
//     layersLen: layers.length,
//     activeLayerIndex,
//     canvasSize: { W, H }
//   });

//   syncActiveAliases?.();
//   rebuildLayersUI?.();
//   showStatusMessage?.("Layers merged", "success");
//   needsRedraw = true;
//   requestDrawIfIdle?.();
// }







// function mergeSelectedLayers() {
//   // ==== PRECHECKS ====
//   if (!gl || !layers?.length || selectedLayerIndices.size < 2) {
//     console.debug("[merge] abort: gl/layers/selection invalid", {
//       gl: !!gl,
//       layersLen: layers?.length ?? 0,
//       selCount: selectedLayerIndices?.size ?? 0
//     });
//     return;
//   }

//   // bottom → top (lower index = below)
//   const sel = Array.from(selectedLayerIndices).sort((a, b) => a - b);
//   const W = fixedFBOWidth;
//   const H = fixedFBOHeight;

//   let dstTex, dstFbo;
//   try {
//     ({ texture: dstTex, fbo: dstFbo } = createLayerFBO(W, H));
//   } catch (e) {
//     console.error("[merge] createLayerFBO failed", e, { W, H });
//     return;
//   }

//   // ==== GL STATE SAVE ====
//   const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
//   const prevViewport = gl.getParameter(gl.VIEWPORT);
//   const blendWas = gl.isEnabled(gl.BLEND);
//   const depthWas = gl.isEnabled(gl.DEPTH_TEST);
//   const cullWas = gl.isEnabled(gl.CULL_FACE);
//   const scissorWas = gl.isEnabled(gl.SCISSOR_TEST);

//   // ==== HELPERS ====
//   function hashRow(ySample) {
//     try {
//       const buf = new Uint8Array(W * 4);
//       gl.readPixels(0, ySample, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
//       let h = 2166136261 >>> 0;
//       for (let i = 0; i < buf.length; i++) {
//         h ^= buf[i];
//         h = Math.imul(h, 16777619) >>> 0;
//       }
//       return ("00000000" + h.toString(16)).slice(-8);
//     } catch (e) {
//       console.debug("[merge] hashRow/readPixels failed", e);
//       return "readFail";
//     }
//   }

//   function logEdgeDiagnostics(stageLabel) {
//     const topHash = hashRow(H - 1);
//     const bottomHash = hashRow(0);
//     console.debug(`[merge] ${stageLabel} | hashes`, {
//       topHash,
//       bottomHash,
//       equal: topHash === bottomHash
//     });
//   }

//   // ==== COMPOSE PASS ====
//   try {
//     console.groupCollapsed?.("[merge] compose start");
//     gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//     gl.viewport(0, 0, W, H);
//     gl.disable(gl.DEPTH_TEST);
//     gl.disable(gl.CULL_FACE);
//     gl.disable(gl.SCISSOR_TEST);
//     gl.clearColor(0, 0, 0, 0);
//     gl.clear(gl.COLOR_BUFFER_BIT);

//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

//     console.debug("[merge] target", { W, H, sel, activeLayerIndex });

//     for (const i of sel) {
//       const L = layers[i];
//       if (!L) { console.warn("[merge] missing layer at index", i); continue; }
//       if (!L.visible || L.opacity <= 0) {
//         console.debug("[merge] skip invisible/zero-opacity", { i, name: L?.name, visible: L?.visible, opacity: L?.opacity });
//         continue;
//       }
//       if (!gl.isTexture(L.texture)) {
//         console.warn("[merge] skip: invalid texture", { i, name: L?.name });
//         continue;
//       }
//       console.debug("[merge] draw layer", {
//         i, name: L.name,
//         x: L.x, y: L.y,
//         scaleX: L.scaleX, scaleY: L.scaleY,
//         rotation: L.rotation,
//         px: L.px, py: L.py,
//         opacity: L.opacity, visible: L.visible
//       });
//       drawLayerWithTransform(quadProgram, L);
//     }

//     logEdgeDiagnostics("before-vertical-fix");

//     // ==== CORRECT VERTICAL MIRROR (DO NOT RELY ON YOUR SHADERS/TRANSFORM) ====
//     // Prefer WebGL2 blit with inverted src rect. Fallback to shader-based pass on WebGL1.
//     const isWebGL2 = (typeof WebGL2RenderingContext !== "undefined") && (gl instanceof WebGL2RenderingContext);

//     if (isWebGL2) {
//       // Create temporary FBO to receive the corrected (unflipped) image
//       let tmpTex, tmpFbo;
//       try {
//         ({ texture: tmpTex, fbo: tmpFbo } = createLayerFBO(W, H));
//       } catch (e) {
//         console.error("[merge] create tmp FBO for blit failed", e);
//         throw e;
//       }

//       // READ from composed, DRAW into tmp, invert Y by swapping src y0/y1
//       gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dstFbo);
//       gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, tmpFbo);
//       // src: (0,0)-(W,H) but flipped as (0,H)-(W,0)
//       gl.blitFramebuffer(
//         0, 0, W, H,
//         0, H, W, 0,
//         gl.COLOR_BUFFER_BIT,
//         gl.NEAREST
//       );

//       // switch back to default binding points
//       gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
//       gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

//       // Replace dst with corrected tmp
//       try { if (dstFbo) gl.deleteFramebuffer(dstFbo); } catch (e) { console.debug("[merge] delete old dstFbo error", e); }
//       try { if (dstTex && gl.isTexture(dstTex)) gl.deleteTexture(dstTex); } catch (e) { console.debug("[merge] delete old dstTex error", e); }
//       dstFbo = tmpFbo;
//       dstTex = tmpTex;

//       // For diagnostics, bind corrected dst and sample again
//       gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//       gl.viewport(0, 0, W, H);
//       logEdgeDiagnostics("after-vertical-fix (blit)");
//     } else {
//       // WebGL1 fallback: draw once with scaleY:-1 into a temp FBO (no shader changes required)
//       let tmpTex, tmpFbo;
//       try {
//         ({ texture: tmpTex, fbo: tmpFbo } = createLayerFBO(W, H));
//       } catch (e) {
//         console.error("[merge] create tmp FBO for fallback failed", e);
//         throw e;
//       }

//       gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFbo);
//       gl.viewport(0, 0, W, H);
//       gl.clearColor(0, 0, 0, 0);
//       gl.clear(gl.COLOR_BUFFER_BIT);

//       const unflip = {
//         texture: dstTex,
//         visible: true,
//         opacity: 1,
//         x: 0,
//         y: 0,
//         rotation: 0,
//         scaleX: 1,
//         scaleY: -1,        // flip around center
//         px: W * 0.5,
//         py: H * 0.5
//       };
//       console.debug("[merge] fallback unflip pass (scaleY:-1)", unflip);
//       drawLayerWithTransform(quadProgram, unflip);

//       try { if (dstFbo) gl.deleteFramebuffer(dstFbo); } catch (e) { console.debug("[merge] delete old dstFbo error", e); }
//       try { if (dstTex && gl.isTexture(dstTex)) gl.deleteTexture(dstTex); } catch (e) { console.debug("[merge] delete old dstTex error", e); }
//       dstFbo = tmpFbo;
//       dstTex = tmpTex;

//       gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//       gl.viewport(0, 0, W, H);
//       logEdgeDiagnostics("after-vertical-fix (fallback)");
//     }
//   } catch (err) {
//     console.error("[merge] unexpected error", err);
//   } finally {
//     // ==== RESTORE GL STATE ====
//     if (!blendWas) gl.disable(gl.BLEND);
//     if (depthWas) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
//     if (cullWas) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
//     if (scissorWas) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
//     if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
//     console.groupEnd?.();
//   }

//   // ==== BUILD MERGED LAYER ====
//   const topIdx = sel[sel.length - 1];
//   const merged = {
//     id: Date.now() + Math.random(),
//     name: `Merged (${sel.length})`,
//     fbo: dstFbo,
//     texture: dstTex,
//     visible: true,
//     opacity: 1,
//     x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
//     px: W * 0.5,
//     py: H * 0.5,
//     history: [],
//     redo: []
//   };

//   // remove originals top → bottom
//   for (let k = sel.length - 1; k >= 0; k--) {
//     const rm = sel[k];
//     const L = layers[rm];
//     console.debug("[merge] removing original layer", { rm, name: L?.name });
//     try { if (L?.texture && gl.isTexture(L.texture)) gl.deleteTexture(L.texture); } catch (e) { console.debug("[merge] deleteTexture err", e); }
//     try { if (L?.fbo) gl.deleteFramebuffer(L.fbo); } catch (e) { console.debug("[merge] deleteFramebuffer err", e); }
//     layers.splice(rm, 1);
//   }

//   // insert merged where topmost used to be
//   const insertAt = Math.min(topIdx, layers.length);
//   layers.splice(insertAt, 0, merged);
//   activeLayerIndex = insertAt;

//   // selection → merged only
//   selectedLayerIndices.clear();
//   selectedLayerIndices.add(activeLayerIndex);

//   console.debug("[merge] done", {
//     insertAt,
//     mergedId: merged.id,
//     layersLen: layers.length,
//     activeLayerIndex,
//     canvasSize: { W, H },
//     webgl2: (typeof WebGL2RenderingContext !== "undefined") && (gl instanceof WebGL2RenderingContext)
//   });

//   syncActiveAliases?.();
//   rebuildLayersUI?.();
//   needsRedraw = true;
//   requestDrawIfIdle?.();
// }




// function mergeSelectedLayers() {
//   if (!gl || !layers?.length || selectedLayerIndices.size < 2) return;

//   // Sort bottom → top (lower index = below, per your model)
//   const sel = Array.from(selectedLayerIndices).sort((a,b)=>a-b);

//   // Create target FBO/texture for merged result
//   const { texture: dstTex, fbo: dstFbo } = createLayerFBO(fixedFBOWidth, fixedFBOHeight);

//   // Preserve GL state
//   const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
//   const prevViewport = gl.getParameter(gl.VIEWPORT);
//   const blendingWasEnabled = gl.isEnabled(gl.BLEND);

//   gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
//   gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);
//   gl.disable(gl.DEPTH_TEST);
//   gl.disable(gl.CULL_FACE);
//   gl.disable(gl.SCISSOR_TEST);
//   gl.clearColor(0, 0, 0, 0);
//   gl.clear(gl.COLOR_BUFFER_BIT);

//   gl.enable(gl.BLEND);
//   gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

//   // Draw each selected layer into the target (bottom → top)
//   for (const i of sel) {
//     const L = layers[i];
//     if (!L || !L.visible || L.opacity <= 0) continue;
//     if (!gl.isTexture(L.texture)) continue;

//     // Reuse your existing path for per-layer transform draw
//     // It should honor L.opacity and transform. If it uses canvas dims,
//     // make sure fixedFBOWidth/Height == canvas size, or adapt uniform there.
//     drawLayerWithTransform(quadProgram, L);
//   }

//   // Restore GL state
//   if (!blendingWasEnabled) gl.disable(gl.BLEND);
//   gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
//   if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

//   // Build merged layer metadata
//   const topIdx = sel[sel.length - 1];
//   const top = layers[topIdx];

//   const merged = {
//     id: Date.now() + Math.random(),
//     name: `Merged (${sel.length})`,
//     fbo: dstFbo,
//     texture: dstTex,
//     visible: true,
//     opacity: 1,

//     // You can decide strategy: keep top’s transform, or bake transforms (we baked already),
//     // so reset to identity:
//     x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,

//     px: fixedFBOWidth * 0.5,
//     py: fixedFBOHeight * 0.5,

//     history: [],
//     redo: []
//   };

//   // Remove originals (delete from top → bottom so indices stay valid)
//   for (let i = sel.length - 1; i >= 0; i--) {
//     const rm = sel[i];
//     const L = layers[rm];
//     // free GPU (optional if you want to keep for undo)
//     try { gl.deleteTexture(L.texture); } catch {}
//     try { gl.deleteFramebuffer(L.fbo); } catch {}
//     layers.splice(rm, 1);
//   }

//   // Insert merged where topmost used to be
//   const insertAt = Math.min(topIdx, layers.length);
//   layers.splice(insertAt, 0, merged);
//   activeLayerIndex = insertAt;

//   // Update selection to the merged layer only
//   selectedLayerIndices.clear();
//   selectedLayerIndices.add(activeLayerIndex);

//   syncActiveAliases?.();
//   rebuildLayersUI?.();

//   showStatusMessage?.("Layers merged", "success");
//   needsRedraw = true;
//   requestDrawIfIdle?.();
// }


/* duplicateLayer(srcIndex = activeLayerIndex)
   Purpose: create an exact visual + parametric clone of a layer without re-centering or shifting the pivot.
   Key guarantees:
   - Copies GPU pixels 1:1 into a new FBO of the SAME size as the source texture (no scaling, no Y flip).
   - Clones ALL transform fields (x, y, scaleX, scaleY, rotation, px, py) AND texture-rect fields (ox, oy, texW, texH).
   - Preserves visibility and opacity.
   - Inserts the clone directly above the source, selects it, and records a History action (“add_layer”)
     with a CPU snapshot so undo/redo won’t drift pivot or flip Y.
   Drop-in: replace the existing duplicateLayer function body with this one. */
function duplicateLayer(srcIndex = activeLayerIndex) {
  if (!Array.isArray(layers) || !layers.length || !gl || !quadProgram) return;

  // Resolve and validate source
  srcIndex = Math.max(0, Math.min(srcIndex | 0, layers.length - 1));
  const src = layers[srcIndex];
  if (!src || !gl.isFramebuffer(src.fbo) || !gl.isTexture(src.texture)) {
    console.warn("[duplicateLayer] invalid source layer");
    return;
  }

  // Allocate destination FBO exactly the size of the source layer’s storage
  const W = Number.isFinite(src.texW) ? src.texW : fixedFBOWidth | 0;
  const H = Number.isFinite(src.texH) ? src.texH : fixedFBOHeight | 0;
  const { texture: dstTex, fbo: dstFbo } = createLayerFBO(W, H);

  // Copy pixels src.texture -> dstFbo in FBO space (no orientation change)
  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(quadProgram);
  const uFlipY   = gl.getUniformLocation(quadProgram, "u_flipY");
  const uRes     = gl.getUniformLocation(quadProgram, "u_resolution");
  const uOpacity = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  const uTex     = gl.getUniformLocation(quadProgram, "u_texture");
  if (uFlipY)   gl.uniform1f(uFlipY, 1.0);             // FBO→FBO copy uses the same basis (no vertical flip)
  if (uRes)     gl.uniform2f(uRes, W, H);
  if (uOpacity) gl.uniform1f(uOpacity, 1.0);

  const verts = new Float32Array([
    0, 0, 0, 0,
    W, 0, 1, 0,
    0, H, 0, 1,
    0, H, 0, 1,
    W, 0, 1, 0,
    W, H, 1, 1
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
  const aPos = gl.getAttribLocation(quadProgram, "a_position");
  const aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV ); gl.vertexAttribPointer(aUV , 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.texture);
  if (uTex) gl.uniform1i(uTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(aPos);
  gl.disableVertexAttribArray(aUV);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Build the cloned layer with IDENTICAL parametric + texture-rect state.
  // This is critical to keep the transform gizmo/pivot stable after duplication.
  const clone = {
    id: Date.now() + Math.random(),
    name: (typeof src.name === "string" ? src.name : "Layer") + " copy",
    fbo: dstFbo,
    texture: dstTex,

    visible: (typeof src.visible === "boolean" ? src.visible : true),
    opacity: (typeof src.opacity === "number" ? src.opacity : 1),

    // texture rectangle in document space
    ox: Number.isFinite(src.ox) ? src.ox : 0,
    oy: Number.isFinite(src.oy) ? src.oy : 0,
    texW: Number.isFinite(src.texW) ? src.texW : W,
    texH: Number.isFinite(src.texH) ? src.texH : H,

    // parametric transform (MUST be copied verbatim to avoid pivot drift)
    x: Number.isFinite(src.x) ? src.x : 0,
    y: Number.isFinite(src.y) ? src.y : 0,
    scaleX: Number.isFinite(src.scaleX) ? src.scaleX : 1,
    scaleY: Number.isFinite(src.scaleY) ? src.scaleY : 1,
    rotation: Number.isFinite(src.rotation) ? src.rotation : 0,
    px: Number.isFinite(src.px) ? src.px : (fixedFBOWidth * 0.5),
    py: Number.isFinite(src.py) ? src.py : (fixedFBOHeight * 0.5)
  };

  // Insert clone directly above the source
  const insertIndex = Math.min(srcIndex + 1, layers.length);
  layers.splice(insertIndex, 0, clone);
  activeLayerIndex = insertIndex;
  selectedLayerIndices?.clear?.();
  selectedLayerIndices?.add?.(activeLayerIndex);
  syncActiveAliases?.();
  rebuildLayersUI?.();

  // Record History with a CPU snapshot of the new layer to guarantee robust undo/redo
  // without re-reading GPU state later (avoids orientation/state races).
  try {
    const snap = snapshotLayer(insertIndex); // { index,w,h,pixels }
    History.push({
      type: "add_layer",
      index: insertIndex,
      addedLayer: {
        name: clone.name,
        visible: clone.visible,
        opacity: clone.opacity,
        snapshot: snap
      }
    });
  } catch (e) {
    console.warn("[duplicateLayer] history snapshot failed:", e);
  }

  needsRedraw = true;
  requestDrawIfIdle?.();
  showStatusMessage?.("Layer duplicated", "success");
  console.log("[duplicateLayer] cloned at index", insertIndex, "from", srcIndex, {
    px: clone.px, py: clone.py, x: clone.x, y: clone.y, scaleX: clone.scaleX, scaleY: clone.scaleY, rot: clone.rotation,
    ox: clone.ox, oy: clone.oy, texW: clone.texW, texH: clone.texH
  });
}







//–––––––––––––––––––
// IMAGE & BRUSH LOADING
//–––––––––––––––––––

// Load a texture from an image. For background images, no flip; for brushes, flip Y and pre-multiply alpha.
function createTextureFromImage(image, isOverlay = false) {
    if (!image) { console.error("Image is null or undefined."); return; }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (isOverlay) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    } else {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isOverlay) {
        overlayTexture = tex;
        brushAspect = image.width / image.height;
    } else {
        texture = tex;
    }
    
    //drawScene();
    needsRedraw = true;

}


function centerAndFitToWrapper() {
  // measure wrapper as it is *now*
  const wrap = canvasWrapper.getBoundingClientRect();

  // canvas bitmap size (no CSS)
  const cw = canvas.width;
  const ch = canvas.height;

  // choose a scale that fits; clamp to your zoom limits
  const fitScale = Math.min(wrap.width / cw, wrap.height / ch);
  zoomScale = Math.min(zoomMax, Math.max(zoomMin, fitScale));

  // center with that scale
  panX = Math.round((wrap.width  - cw * zoomScale) / 2);
  panY = Math.round((wrap.height - ch * zoomScale) / 2);

  updateCanvasTransform();
  resetStrokeState();
  needsRedraw = true;
}

// keep a helper that defers to the next frame so layout is settled
function centerNextFrame() {
  requestAnimationFrame(() => {
    centerAndFitToWrapper();
  });
}




function loadDefaultImage() {

  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = window.innerWidth;
  baseCanvas.height = window.innerHeight;
  const ctx = baseCanvas.getContext("2d");

  // Base paper color (slightly textured off-white)
  ctx.fillStyle = "#f2efe4";
  ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);

  // **Generate Noise Texture with High Detail**
  const noiseCanvas = document.createElement("canvas");
  noiseCanvas.width = baseCanvas.width;
  noiseCanvas.height = baseCanvas.height;
  const nctx = noiseCanvas.getContext("2d");
  const noiseData = nctx.createImageData(noiseCanvas.width, noiseCanvas.height);

  for (let i = 0; i < noiseData.data.length; i += 4) {
    const noise = Math.random() * 50 - 25; // Fine-grain range (-25 to +25)
    noiseData.data[i] = 240 + noise; // R
    noiseData.data[i + 1] = 235 + noise; // G
    noiseData.data[i + 2] = 225 + noise; // B
    noiseData.data[i + 3] = 255; // Alpha
  }

  nctx.putImageData(noiseData, 0, 0);
  ctx.globalAlpha = 0.2; // Subtle overlay effect
  ctx.drawImage(noiseCanvas, 0, 0);
  ctx.globalAlpha = 1.0;

  // **Crisp High-Contrast Noise Overlay**
  const crispCanvas = document.createElement("canvas");
  crispCanvas.width = baseCanvas.width;
  crispCanvas.height = baseCanvas.height;
  const cctx = crispCanvas.getContext("2d");
  const crispData = cctx.createImageData(crispCanvas.width, crispCanvas.height);

  for (let i = 0; i < crispData.data.length; i += 4) {
    const value = Math.random() * 255;
    crispData.data[i] = value;
    crispData.data[i + 1] = value;
    crispData.data[i + 2] = value;
    crispData.data[i + 3] = Math.random() * 90; // Low opacity speckling
  }

  cctx.putImageData(crispData, 0, 0);
  ctx.globalAlpha = 0.08;
  ctx.drawImage(crispCanvas, 0, 0);
  ctx.globalAlpha = 1.0;

  // **Vignette Effect (Subtle Shadows in Corners)**
  const vignetteGradient = ctx.createRadialGradient(
    baseCanvas.width / 2,
    baseCanvas.height / 2,
    Math.min(baseCanvas.width, baseCanvas.height) * 0.3,
    baseCanvas.width / 2,
    baseCanvas.height / 2,
    Math.max(baseCanvas.width, baseCanvas.height) * 0.6
  );

  vignetteGradient.addColorStop(0, "rgba(0,0,0,0)");
  vignetteGradient.addColorStop(1, "rgba(0,0,0,0.35)"); // Darker vignette
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = vignetteGradient;
  ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
  ctx.globalAlpha = 1.0;

  // **Finalizing the Image as a WebGL Texture**
  const img = new Image();
  img.crossOrigin = "anonymous";

img.onload = () => {
  currentImage = img;
  fixedFBOWidth = img.width;
  fixedFBOHeight = img.height;
  initPaintLayerFixed();

  updateCanvasSize(img);
  initFloodFBOs();
  createTextureFromImage(img);

  // ---- force layout, then center (no timers) ----
  void canvas.offsetWidth; 
  void canvasWrapper.offsetWidth;
  zoomScale = 1;
  panX = (canvasWrapper.clientWidth  - canvas.width ) / 2;
  panY = (canvasWrapper.clientHeight - canvas.height) / 2;
  updateCanvasTransform();
  resetStrokeState();
  needsRedraw = true;
  // -----------------------------------------------

  initFloodFillProgram();
  addSoundEvents();
};




  img.onerror = () => console.error("Failed to load default image.");

  img.src = baseCanvas.toDataURL("image/png");
}


function createBrushThumbnails() {
    const container = document.getElementById("brushContainer");
    container.innerHTML = "";
    brushes.forEach((brush) => {
        const thumb = document.createElement("img");
        thumb.src = brush.file;
        thumb.classList.add("brush-thumbnail");
        if (brush.selected) {
            thumb.style.border = "2px solid red";
        }
        thumb.addEventListener("click", () => selectBrush(brush.name));
        container.appendChild(thumb);
    });

    // Move the brushContainerToggle button AFTER the brushes
    const brushContainerToggle = document.getElementById("brushContainerToggle");
    container.appendChild(brushContainerToggle);
}


function updateBrushThumbnailStyles(activeBrush) {
    const container = document.getElementById("brushContainer");
    const thumbnails = container.querySelectorAll("img.brush-thumbnail");
    brushes.forEach((brush, i) => {
        if (thumbnails[i]) {
            thumbnails[i].style.border = (brush.name === activeBrush) ? "2px solid red" : "2px solid transparent";
        }
    });
}


function selectBrush(name) {
    const brush = brushes.find(b => b.name === name);
    if (!brush) {
        console.warn(`Brush "${name}" not found.`);
        return;
    }
    currentBrush = brush;
    overlayTexture = brushTextures[brush.name];
    brushAspect = brushAspects[brush.name];

    // Do NOT reset brushSize — keep current value

    // Update the slider UI to reflect the current value
    const brushSizeSlider = document.getElementById("brushSizeSlider");
    const brushSizeValue = document.getElementById("brushSizeValue");
    brushSizeSlider.value = brushSize;
    brushSizeValue.textContent = brushSize.toFixed(2);

    // Update selection state
    brushes.forEach(b => b.selected = (b.name === name));
    updateBrushThumbnailStyles(brush.name);
    needsRedraw = true;
}



function loadBrushes() {
    brushes.forEach((brush) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            brushTextures[brush.name] = tex;
            brushAspects[brush.name] = img.width / img.height;

            if (brush.selected) {
                selectBrush(brush.name);
            }
        };
        img.onerror = () => console.error("Failed to load brush image:", brush.file);
        img.src = brush.file;
    });
}



//–––––––––––––––––––
// CANVAS RESIZING (layers version)
//–––––––––––––––––––

// function centerCanvasInWrapper() {
//   const wrap = canvasWrapper.getBoundingClientRect();
//   const cw = canvas.width  * zoomScale;
//   const ch = canvas.height * zoomScale;
//   panX = (wrap.width  - cw) / 2;
//   panY = (wrap.height - ch) / 2;
//   updateCanvasTransform();
// }


function centerCanvasInWrapper() {
  const wrap = canvasWrapper.getBoundingClientRect();
  const cw = canvas.width  * zoomScale;
  const ch = canvas.height * zoomScale;
  panX = (wrap.width  - cw) / 2;
  panY = (wrap.height - ch) / 2;
  viewRotation = 0;               // NEW: also reset rotation
  transformOriginX = 0;
  transformOriginY = 0;
  updateCanvasTransform();
}



// only act if it's basically gone (not visible), otherwise do nothing
function ensureCanvasNotLost() {
  const wrap = canvasWrapper.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();

  // intersection area
  const ix = Math.max(0, Math.min(c.right, wrap.right) - Math.min(c.left, wrap.left));
  const iy = Math.max(0, Math.min(c.bottom, wrap.bottom) - Math.min(c.top,  wrap.top));
  const interArea = ix * iy;
  const canvasArea = c.width * c.height;

  // if 0 (completely gone) OR < 5% visible → snap back once
  if (!isFinite(interArea) || canvasArea <= 0 || interArea / canvasArea < 0.05) {
    centerCanvasInWrapper();
  }
}

// run the check at safe moments only (after user gesture finishes / layout changes)
["mouseup","mouseleave","touchend","touchcancel"].forEach(ev =>
  canvasWrapper.addEventListener(ev, ensureCanvasNotLost, { passive:true })
);


window.addEventListener("resize", ensureCanvasNotLost);


if (window.visualViewport) {
  visualViewport.addEventListener("resize", ensureCanvasNotLost);
  visualViewport.addEventListener("scroll", ensureCanvasNotLost);
}


let lastMultiTap = 0;
canvasWrapper.addEventListener("touchend", (e) => {
  if (e.changedTouches.length >= 2) {
    const now = performance.now();
    if (now - lastMultiTap < 350) {
      centerCanvasInWrapper(); // quick reset
    }
    lastMultiTap = now;
  }
}, { passive: true });


function snapBackIfLost(el, margin) {
  margin = (typeof margin === 'number') ? margin : 8;

  var r  = el.getBoundingClientRect();
  var vv = (window.visualViewport) ? window.visualViewport : null;
  var vw = (vv && vv.width)  ? vv.width  : window.innerWidth;
  var vh = (vv && vv.height) ? vv.height : window.innerHeight;

  // if it’s still visible, do nothing
  var visible =
    (r.right  > margin) &&
    (r.bottom > margin) &&
    (r.left   < vw - margin) &&
    (r.top    < vh - margin);
  if (visible) return;

  // otherwise, bring it back to a safe corner
  var left = Math.min(Math.max(el.offsetLeft || 0, margin), vw - r.width  - margin);
  var top  = Math.min(Math.max(el.offsetTop  || 0, margin), vh - r.height - margin);
  el.style.left = Math.round(left) + 'px';
  el.style.top  = Math.round(top)  + 'px';
}


// call on pointerup for your draggable panels
[
  ["brushSizeSliderContainer","brushSizeDragBar"],
  ["brushContainerWrapper","brushContainerDragBar"],
  ["layersPanel",".layers-header"] // if you have a header there
].forEach(([id, handleSel]) => {
  const el = document.getElementById(id);
  const handle = el && (handleSel.startsWith("#") ? document.querySelector(handleSel) : el.querySelector(handleSel));
  if (!el || !handle) return;
  const end = (e) => { try { handle.releasePointerCapture(e.pointerId); } catch {} snapBackIfLost(el); };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
});

// also on resize/orientation
window.addEventListener("resize", () => {
  ["brushSizeSliderContainer","brushContainerWrapper","layersPanel"]
    .forEach(id => { const el = document.getElementById(id); if (el) snapBackIfLost(el); });
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentImage) updateCanvasSize(currentImage);
    centerCanvasInWrapper?.();
  }, 120);
});


function updateBrushSize() {
  const newWidth = canvas.width;
  // Keep same logic if you like; brush size is a fraction of screen width
  brushSize = Math.min(brushSize, newWidth / 10);
}



function updateCanvasSize(image) {
  if (!image) return;

  const windowAspect = window.innerWidth / window.innerHeight;
  imageAspect = image.width / image.height;

  let newWidth, newHeight;
  if (imageAspect > windowAspect) {
    newWidth  = window.innerWidth;
    newHeight = window.innerWidth / imageAspect;
  } else {
    newHeight = window.innerHeight;
    newWidth  = window.innerHeight * imageAspect;
  }

  // Only resize the on-screen canvas + viewport.
  // Do NOT recreate any paint textures here (layers keep fixedFBOWidth/Height).
  canvas.width  = Math.round(newWidth);
  canvas.height = Math.round(newHeight);
  gl.viewport(0, 0, canvas.width, canvas.height);

  updateBrushSize();
  needsRedraw = true;  // let the render loop redraw
}

window.addEventListener("resize", () => {
  if (currentImage) updateCanvasSize(currentImage);
});


function resetStrokeState() {
  // clear last canvas- and FBO-space cursors
  lastX = null;
  lastY = null;
  lastFx = null;
  lastFy = null;

  // optional: reset draw throttling + sound cursors if you use them
  if (typeof lastDrawTime !== "undefined") lastDrawTime = 0;
  if (typeof soundLastX !== "undefined") soundLastX = null;
  if (typeof soundLastY !== "undefined") soundLastY = null;
}

/**
 * Resize the on-screen canvas to fit the image while keeping the fixed FBO size unchanged.
 * Also recenters/retains pan-zoom safely and resets stroke state so angles/lines don’t jump.
 */


function setDocumentSize(w, h) {
  fixedFBOWidth  = w;
  fixedFBOHeight = h;

  // The on-screen canvas bitmap == document size (1:1)
  canvas.width  = w;
  canvas.height = h;

  // GL viewport matches canvas
  gl.viewport(0, 0, w, h);

  // Start at 1:1. Viewport is the wrapper; we pan to center.
  zoomScale = 1;
  const wrapRect = canvasWrapper.getBoundingClientRect();
  panX = Math.round((wrapRect.width  - w) / 2);
  panY = Math.round((wrapRect.height - h) / 2);
  updateCanvasTransform();

  // Reset stroke state so angles don’t jump
  resetStrokeState();
  needsRedraw = true;
}





//–––––––––––––––––––
// SCRATCHING
//–––––––––––––––––––


// **Web Audio Context (Fix for iOS)**
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isDrawingSoundActive = false;
let gainNode, noiseNode, filterNode;

// Sound state tracking
let soundLastX = null, soundLastY = null;
let soundIsMoving = false;
let lastMoveTimestamp = 0;

// **Unlock Web Audio for iOS**
function unlockAudio() {
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
}

// **Create Noise Buffer (Sparse Scratch Effect)**
function createNoiseBuffer() {
    const sr = audioCtx.sampleRate;
    const bufferSize = Math.max(1, Math.floor(sr * 0.5)); // must be an integer
    const buffer = audioCtx.createBuffer(1, bufferSize, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() > 0.9 ? (Math.random() * 2 - 1) * 0.5 : 0;
    }
    return buffer;
}

// **Start Scratch Sound (Only on Movement)**
function startDrawingSound(strokeSpeed = 1) {
    if (isDrawingSoundActive) return;
    isDrawingSoundActive = true;

    unlockAudio();

    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = "bandpass";

    // clamp frequency to nominal range
    const nyquist = audioCtx.sampleRate * 0.5;
    const rawHz = 400 + (Number(strokeSpeed) || 0) * 300;
    const safeHz = Math.min(nyquist - 20, Math.max(10, rawHz));

    filterNode.frequency.setValueAtTime(safeHz, audioCtx.currentTime);
    filterNode.Q.setValueAtTime(2.5, audioCtx.currentTime);

    noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = createNoiseBuffer();
    noiseNode.loop = true;

    noiseNode.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    noiseNode.start();
}

// **Update Scratch Sound (Stroke Speed Changes Frequency & Volume)**
function updateDrawingSound(strokeSpeed) {
    if (!isDrawingSoundActive) return;

    const nyquist = audioCtx.sampleRate * 0.5;

    // frequency (clamped)
    const rawHz = 400 + (Number(strokeSpeed) || 0) * 300;
    const safeHz = Math.min(nyquist - 20, Math.max(10, rawHz));
    filterNode.frequency.linearRampToValueAtTime(safeHz, audioCtx.currentTime + 0.05);

    // gain (clamped 0..1; your original cap 0.15 preserved)
    const rawGain = Math.min(0.15, 0.05 * (Number(strokeSpeed) || 0));
    const safeGain = Math.max(0, Math.min(1, rawGain));
    gainNode.gain.linearRampToValueAtTime(safeGain, audioCtx.currentTime + 0.05);
}





// **Stop Scratch Sound (Smooth Fade Out)**
function stopDrawingSound() {
    if (!isDrawingSoundActive) return;
    isDrawingSoundActive = false;

    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
    setTimeout(() => {
        if (noiseNode) {
            noiseNode.stop();
            noiseNode.disconnect();
        }
        if (filterNode) filterNode.disconnect();
        if (gainNode) gainNode.disconnect();
    }, 200);
}


// ===== POINTER / COORD HELPERS (canonical) =====
function getTouchPos(ev) {
  const t = ev.touches && ev.touches[0] ? ev.touches[0] : (ev.changedTouches && ev.changedTouches[0]);
  if (!t) return { x: 0, y: 0 };
  const wrap = canvasWrapper.getBoundingClientRect();
  const px = t.clientX - wrap.left;
  const py = t.clientY - wrap.top;
  const c = screenToCanvasPx(t.clientX, t.clientY);
  return { x: px, y: py, cx: c.x, cy: c.y };
}

// **Attach to Drawing Events**
function addSoundEvents() {
    document.addEventListener("touchstart", unlockAudio, { once: true });
    document.addEventListener("click", unlockAudio, { once: true });

    // **Mouse Events**
    canvas.addEventListener("mousedown", () => {
        soundIsMoving = false;
    });

    canvas.addEventListener("mousemove", (event) => {
        if (!isDrawing) return;

        let speed = Math.sqrt(event.movementX ** 2 + event.movementY ** 2);
        
        if (!soundIsMoving) {
            startDrawingSound(speed);
            soundIsMoving = true;
        }

        updateDrawingSound(speed);
    });

    canvas.addEventListener("mouseup", () => {
        soundIsMoving = false;
        stopDrawingSound();
    });

    canvas.addEventListener("mouseleave", () => {
        soundIsMoving = false;
        stopDrawingSound();
    });

    // **Touch Events**
    canvas.addEventListener("touchstart", (event) => {
        event.preventDefault();
        isDrawing = true;
        soundLastX = null;
        soundLastY = null;
        soundIsMoving = false;
        lastMoveTimestamp = Date.now();
    });

    canvas.addEventListener("touchmove", (event) => {
        event.preventDefault();
        if (!isDrawing) return;

        const pos = getTouchPos(event);
        const now = Date.now();

        if (soundLastX !== null && soundLastY !== null) {
            const dx = pos.x - soundLastX;
            const dy = pos.y - soundLastY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 1) {  // Ignore micro-movements
                let speed = distance / (now - lastMoveTimestamp + 1); // Normalize by time
                lastMoveTimestamp = now;

                if (!soundIsMoving) {
                    startDrawingSound(speed);
                    soundIsMoving = true;
                }

                updateDrawingSound(speed);
            }
        }

        soundLastX = pos.x;
        soundLastY = pos.y;
    });

    canvas.addEventListener("touchend", () => {
        soundIsMoving = false;
        stopDrawingSound();
    });

    canvas.addEventListener("touchcancel", () => {
        soundIsMoving = false;
        stopDrawingSound();
    });

    // **Force Stop Sound if No Movement for 100ms**
    setInterval(() => {
        if (isDrawing && soundIsMoving && Date.now() - lastMoveTimestamp > 100) {
            soundIsMoving = false;
            stopDrawingSound();
        }
    }, 50);
}

/* ==== Painting input (unified, no idle-hover redraw) ==== */
let lastDrawTime = 0;

canvas.addEventListener("mousedown", (ev) => {
  if (!canPaint()) return;
  const p = pointerToBoth(ev);
  overlayPosition = [p.cx / canvas.width, p.cy / canvas.height];

  if (currentTool === "fill") {
    performFloodFill(p.fx, p.fy);
    needsRedraw = true;
    drawScene();
    return;
  }

  isDrawing = true;
  startRender("draw");
  drawBrushStrokeToPaintLayer(p.cx, p.cy);
});

canvas.addEventListener("mousemove", (ev) => {
  if (!canPaint() && !isDrawing) return;

  const now = Date.now();
  if (now - lastDrawTime < 16) return;
  lastDrawTime = now;

  const p = pointerToBoth(ev);
  if (lastX !== null && lastY !== null) {
    const dx = p.cx - lastX, dy = p.cy - lastY;
    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) currentAngle = Math.atan2(dy, dx);
  }
  lastX = p.cx; lastY = p.cy;
  overlayPosition = [p.cx / canvas.width, p.cy / canvas.height];

  if (isDrawing && canPaint()) drawBrushStrokeToPaintLayer(p.cx, p.cy);
});

canvas.addEventListener("mouseup", () => {
  isDrawing = false;
  stopRender("draw");
  lastFx = null; lastFy = null;
});

canvas.addEventListener("mouseleave", () => {
  isDrawing = false;
  stopRender("draw");
  lastFx = null; lastFy = null;
});

canvas.addEventListener("touchstart", (ev) => {
  ev.preventDefault();
  if (!canPaint()) return;
  const t = ev.touches[0]; if (!t) return;

  const p = pointerToBoth(t);
  overlayPosition = [p.cx / canvas.width, p.cy / canvas.height];

  if (currentTool === "fill") {
    performFloodFill(p.fx, p.fy);
    needsRedraw = true;
    drawScene();
    return;
  }

  isDrawing = true;
  startRender("draw");
  drawBrushStrokeToPaintLayer(p.cx, p.cy);
}, { passive: false });

canvas.addEventListener("touchmove", (ev) => {
  ev.preventDefault();
  if (!isDrawing || !canPaint()) return;
  const t = ev.touches[0]; if (!t) return;

  const now = Date.now();
  if (now - lastDrawTime < 16) return;
  lastDrawTime = now;

  const p = pointerToBoth(t);
  if (lastX !== null && lastY !== null) {
    const dx = p.cx - lastX, dy = p.cy - lastY;
    if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) currentAngle = Math.atan2(dy, dx);
  }
  lastX = p.cx; lastY = p.cy;
  overlayPosition = [p.cx / canvas.width, p.cy / canvas.height];

  drawBrushStrokeToPaintLayer(p.cx, p.cy);
}, { passive: false });

canvas.addEventListener("touchend", () => {
  isDrawing = false;
  stopRender("draw");
  lastFx = null; lastFy = null;
}, { passive: true });

canvas.addEventListener("touchcancel", () => {
  isDrawing = false;
  stopRender("draw");
  lastFx = null; lastFy = null;
}, { passive: true });











function isUserTyping() {
    const activeElement = document.activeElement;
    return activeElement && (
        activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable
    );
}


// BRUSH SWITCHING (keys 1…0)
//–––––––––––––––––––
document.addEventListener("keydown", (event) => {
  if (isUserTyping()) return;

  let shouldRedraw = false;

  // Size down/up with [ and ]
  if (event.key === "[") {
    brushSize = Math.max(0.01, brushSize - 0.02);
    const brushSizeSlider = document.getElementById("brushSizeSlider");
    if (brushSizeSlider) brushSizeSlider.value = brushSize;
    shouldRedraw = true;

    overlayPosition = [lastPointer.cx / canvas.width, lastPointer.cy / canvas.height];
    showBrushHUD(); // keep HUD visible briefly
  } else if (event.key === "]") {
    brushSize = Math.min(1.0, brushSize + 0.02);
    const brushSizeSlider = document.getElementById("brushSizeSlider");
    if (brushSizeSlider) brushSizeSlider.value = brushSize;
    shouldRedraw = true;

    overlayPosition = [lastPointer.cx / canvas.width, lastPointer.cy / canvas.height];
    showBrushHUD();
  } else if (event.key >= "0" && event.key <= "9") {
    // Numeric brush select: 1→index 0, 2→1, …, 9→8, 0→9
    let index = event.key === "0" ? 9 : (parseInt(event.key, 10) - 1);

    if (index >= 0 && index < brushes.length) {
      // Use the canonical selector so textures/aspect/thumbnail state stay in sync
      selectBrush(brushes[index].name);
      shouldRedraw = true;

      // Keep the brush size HUD centered on last pointer
      overlayPosition = [lastPointer.cx / canvas.width, lastPointer.cy / canvas.height];
      showBrushHUD();
    }
  }

  if (shouldRedraw) {
    needsRedraw = true;
  }
});



// Global variables
let brushSize = 0.02;
let opacity = 1.0;
let eraseStrength = 0.5;
let paintStrength = 1.0;

// Event listeners for each slider
document.addEventListener("DOMContentLoaded", () => {

  // Brush Size Slider
  const brushSizeSlider = document.getElementById("brushSizeSlider");
  const brushSizeValue = document.getElementById("brushSizeValue");
  // Initialize
  brushSizeSlider.value = brushSize;
  brushSizeValue.textContent = brushSize.toFixed(2);
  brushSizeSlider.addEventListener("input", (e) => {
    brushSize = parseFloat(e.target.value);
    brushSizeValue.textContent = brushSize.toFixed(2);
    needsRedraw = true;
    showBrushHUD();
  });
    
  // Eraser Strength Slider
  const eraseStrengthSlider = document.getElementById("eraseStrengthSlider");
  const eraseStrengthValue = document.getElementById("eraseStrengthValue");
  // Initialize
  eraseStrengthSlider.value = eraseStrength;
  eraseStrengthValue.textContent = eraseStrength.toFixed(2);
  eraseStrengthSlider.addEventListener("input", (e) => {
    eraseStrength = parseFloat(e.target.value);
    eraseStrengthValue.textContent = eraseStrength.toFixed(2);
    needsRedraw = true;
    showBrushHUD();
  });
  
  // Paint Strength Slider
  const paintStrengthSlider = document.getElementById("paintStrengthSlider");
  const paintStrengthValue = document.getElementById("paintStrengthValue");
  // Initialize
  paintStrengthSlider.value = paintStrength;
  paintStrengthValue.textContent = paintStrength.toFixed(2);
  paintStrengthSlider.addEventListener("input", (e) => {
    paintStrength = parseFloat(e.target.value);
    paintStrengthValue.textContent = paintStrength.toFixed(2);
    needsRedraw = true;
  });
});






// rebuilding layers in the Layers Panel
// -------------------------------------

let selectedLayerIndices = new Set();

function rebuildLayersUI() {
  const list = document.getElementById("layersList");
  if (!list) return;

  // Ensure selection contains at least the active layer
  if (!layers?.length) {
    selectedLayerIndices.clear();
  } else if (selectedLayerIndices.size === 0 && Number.isInteger(activeLayerIndex)) {
    selectedLayerIndices.add(activeLayerIndex);
  }

  // ——— ONE-TIME mobile layer-transform touch handlers (capture phase to override view pinch) ———
  if (!window.__mobileLayerTransformSetup) {
    const WRAP = canvasWrapper || document.getElementById("canvasWrapper") || canvas?.parentElement;
    let layerPinch = null;

    function onTouchStart(ev) {
      if (!isMobile()) return;
      if (!(transformTool && transformTool.mobileCombo)) return;
      if (ev.touches.length === 2) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        const t1 = ev.touches[0], t2 = ev.touches[1];
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        const dist0 = Math.hypot(dx, dy);
        const ang0  = Math.atan2(dy, dx);

        const L = getActiveLayer(); if (!L) return;
        layerPinch = {
          dist0: Math.max(1e-6, dist0),
          ang0,
          ref: {
            scaleX: Number.isFinite(L.scaleX) ? L.scaleX : 1,
            scaleY: Number.isFinite(L.scaleY) ? L.scaleY : 1,
            rotation: Number.isFinite(L.rotation) ? L.rotation : 0
          }
        };
      }
    }

    function onTouchMove(ev) {
      if (!isMobile()) return;
      if (!(transformTool && transformTool.mobileCombo)) return;

      if (ev.touches.length === 2 && layerPinch) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        const t1 = ev.touches[0], t2 = ev.touches[1];
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        const dist = Math.max(1e-6, Math.hypot(dx, dy));
        const ang  = Math.atan2(dy, dx);

        const L = getActiveLayer(); if (!L) return;

        const s = dist / layerPinch.dist0;
        L.scaleX = layerPinch.ref.scaleX * s;
        L.scaleY = layerPinch.ref.scaleY * s;

        let da = ang - layerPinch.ang0;
        if (da >  Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        L.rotation = layerPinch.ref.rotation + da;

        needsRedraw = true;
        return;
      }
    }

    function onTouchEnd(ev) {
      if (!isMobile()) return;
      if (layerPinch && (!ev.touches || ev.touches.length < 2)) {
        layerPinch = null;
      }
      if (transformTool && transformTool.mode === "idle") {
        const L = getActiveLayer();
        if (!(L && L.transformLocked)) transformTool.mobileCombo = false;
      }
    }

    if (WRAP) {
      WRAP.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
      WRAP.addEventListener("touchmove",  onTouchMove,  { passive: false, capture: true });
      WRAP.addEventListener("touchend",   onTouchEnd,   { passive: true,  capture: true });
      WRAP.addEventListener("touchcancel",onTouchEnd,   { passive: true,  capture: true });
    }
    window.__mobileLayerTransformSetup = true;
  }

  list.innerHTML = "";

  const header = document.createElement("div");
  header.className = "layers-header";

  const mergeBtn = document.createElement("button");
  mergeBtn.type = "button";
  mergeBtn.className = "bs-n";
  mergeBtn.textContent = "Merge Selected";
  mergeBtn.disabled = selectedLayerIndices.size < 2;
  mergeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (selectedLayerIndices.size >= 2) {
      mergeSelectedLayers();
    }
  });

  const mergeAllBtn = document.createElement("button");
  mergeAllBtn.type = "button";
  mergeAllBtn.className = "bs-n";
  mergeAllBtn.textContent = "Merge All";
  mergeAllBtn.disabled = !(layers && layers.length >= 2);
  mergeAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!(layers && layers.length >= 2)) return;
    selectedLayerIndices.clear();
    for (let i = 0; i < layers.length; i++) selectedLayerIndices.add(i);
    mergeSelectedLayers();
    selectedLayerIndices.clear();
    if (Number.isInteger(activeLayerIndex)) selectedLayerIndices.add(activeLayerIndex);
    rebuildLayersUI();
  });

  header.appendChild(mergeBtn);
  header.appendChild(mergeAllBtn);
  list.appendChild(header);

  function refreshHeader() {
    mergeBtn.disabled = selectedLayerIndices.size < 2;
    mergeBtn.textContent = selectedLayerIndices.size > 1
      ? `Merge Selected (${selectedLayerIndices.size})`
      : "Merge Selected";
    mergeAllBtn.disabled = !(layers && layers.length >= 2);
  }

  function selectSingle(idx, layer) {
    clearTransformLockAll();
    activeLayerIndex = idx;
    selectedLayerIndices.clear();
    selectedLayerIndices.add(idx);
    syncActiveAliases?.();
    rebuildLayersUI();
    showStatusMessage?.(`Selected: ${layer.name}`, "info");
    needsRedraw = true;
  }

  function toggleSelection(idx, additive) {
    if (!additive) {
      selectedLayerIndices.clear();
      selectedLayerIndices.add(idx);
      activeLayerIndex = idx;
      return;
    }
    if (selectedLayerIndices.has(idx)) {
      selectedLayerIndices.delete(idx);
      if (selectedLayerIndices.size === 0) {
        selectedLayerIndices.add(idx);
      }
    } else {
      selectedLayerIndices.add(idx);
      activeLayerIndex = idx;
    }
  }

  function rangeSelect(toIdx) {
    if (selectedLayerIndices.size === 0) {
      selectedLayerIndices.add(toIdx);
      activeLayerIndex = toIdx;
      return;
    }
    const anchor = activeLayerIndex ?? toIdx;
    const min = Math.min(anchor, toIdx);
    const max = Math.max(anchor, toIdx);
    selectedLayerIndices.clear();
    for (let i = min; i <= max; i++) selectedLayerIndices.add(i);
    activeLayerIndex = toIdx;
  }

  (layers || []).forEach((L, idx) => {
    const el = document.createElement("div");
    const isActive = idx === activeLayerIndex;
    const isSelected = selectedLayerIndices.has(idx);

    el.className = "layer-item" + (isActive ? " active" : "") + (isSelected ? " is-selected" : "");
    el.dataset.index = String(idx);

    const sel = document.createElement("div");
    sel.className = "layer-select";
    const selCb = document.createElement("input");
    selCb.type = "checkbox";
    selCb.checked = isSelected;
    selCb.title = "Select for merge";
    selCb.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSelection(idx, true);
      refreshHeader();
      el.classList.toggle("is-selected", selectedLayerIndices.has(idx));
    });
    sel.appendChild(selCb);

    const vis = document.createElement("div");
    vis.className = "layer-vis";

    const visBtn = document.createElement("button");
    visBtn.type = "button";
    visBtn.className = "bs icon-btn";
    visBtn.title = L.visible ? "Hide layer" : "Show layer";
    visBtn.setAttribute("aria-label", `${L.visible ? "Hide" : "Show"} ${L.name}`);

    const EYE_OPEN  = "/static/draw/images/icons/show.svg";
    const EYE_CLOSE = "/static/draw/images/icons/hide.svg";

    const visIcon = document.createElement("img");
    visIcon.alt = L.visible ? "Visible" : "Hidden";
    visIcon.src = L.visible ? EYE_OPEN : EYE_CLOSE;
    visIcon.style.pointerEvents = "none";
    visBtn.appendChild(visIcon);

    function updateEye() {
      visIcon.src = L.visible ? EYE_OPEN : EYE_CLOSE;
      visIcon.alt = L.visible ? "Visible" : "Hidden";
      visBtn.title = L.visible ? "Hide layer" : "Show layer";
      visBtn.setAttribute("aria-label", `${L.visible ? "Hide" : "Show"} ${L.name}`);
    }

    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearTransformLockAll();
      L.visible = !L.visible;
      updateEye();
      needsRedraw = true;
    });

    vis.appendChild(visBtn);

    const transformBtn = document.createElement("button");
    transformBtn.type = "button";
    transformBtn.className = "bs icon-btn transform-btn";
    transformBtn.title = "Transform layer";
    transformBtn.setAttribute("aria-label", `Transform ${L.name}`);
    transformBtn.innerHTML = `<img src="/static/draw/images/icons/transform.svg" alt="Transform">`;
    if (!isMobile()) transformBtn.style.display = "none";
    if (isMobile() && L.transformLocked && isActive) {
      transformBtn.classList.add("is-active");
    } else {
      transformBtn.classList.remove("is-active");
    }
    transformBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (activeLayerIndex !== idx) {
        clearTransformLockAll();
        activeLayerIndex = idx;
        syncActiveAliases?.();
        rebuildLayersUI();
      }
      const currentlyLocked = !!L.transformLocked;
      setLayerTransformLock(idx, !currentlyLocked);
      transformBtn.classList.toggle("is-active", !currentlyLocked);
      showStatusMessage?.(!currentlyLocked
        ? "Transform locked: drag to move, pinch to scale/rotate"
        : "Transform unlocked", "info");
      needsRedraw = true;
    });
    vis.appendChild(transformBtn);

    const nameWrap = document.createElement("div");
    nameWrap.className = "layer-name";

    const nameInput = document.createElement("input");
    nameInput.value = L.name;
    nameInput.title = "Rename layer";
    nameInput.setAttribute("aria-label", `Rename ${L.name}`);
    nameInput.addEventListener("click", (e) => e.stopPropagation());
    nameInput.addEventListener("mousedown", () => {
      activeLayerIndex = idx;
    });
    nameInput.addEventListener("focus", () => {
      activeLayerIndex = idx;
    });
    const commitName = () => {
      const v = nameInput.value;
      if (v !== L.name) {
        L.name = v;
        updateEye();
      }
    };
    nameInput.addEventListener("change", commitName);
    nameInput.addEventListener("blur", commitName);
    nameWrap.appendChild(nameInput);

    const ops = document.createElement("div");
    ops.className = "layer-ops";

    const dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.className = "bs icon-btn";
    dupBtn.title = "Duplicate layer";
    dupBtn.setAttribute("aria-label", "Duplicate layer");
    dupBtn.innerHTML = `<img src="/static/draw/images/icons/clone.svg" alt="" style="pointer-events:none" width="18" height="18">`;
    dupBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      clearTransformLockAll();
      duplicateLayer(idx);
    });

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "bs icon-btn";
    upBtn.title = "Move up";
    upBtn.setAttribute("aria-label", "Move layer up");
    upBtn.innerHTML = `<img src="/static/draw/images/icons/up-shevron.svg" alt="" style="pointer-events:none" width="18" height="18">`;
    upBtn.addEventListener("click", (ev) => { 
      ev.stopPropagation();
      clearTransformLockAll();
      moveLayerUp(idx); 
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "bs icon-btn";
    downBtn.title = "Move down";
    downBtn.setAttribute("aria-label", "Move layer down");
    downBtn.innerHTML = `<img src="/static/draw/images/icons/down-shevron.svg" alt="" style="pointer-events:none" width="18" height="18">`;
    downBtn.addEventListener("click", (ev) => { 
      ev.stopPropagation();
      clearTransformLockAll();
      moveLayerDown(idx); 
    });

    ops.appendChild(dupBtn);
    ops.appendChild(upBtn);
    ops.appendChild(downBtn);

    const opacityRow = document.createElement("div");
    opacityRow.className = "layer-opacity";

    const opLabel = document.createElement("span");
    opLabel.textContent = "Opacity";

    const opRange = document.createElement("input");
    opRange.type = "range";
    opRange.min = "0";
    opRange.max = "1";
    opRange.step = "0.01";
    opRange.value = String(L.opacity);
    ["click","mousedown","touchstart","keydown"].forEach(ev =>
      opRange.addEventListener(ev, (e) => e.stopPropagation())
    );
    opRange.addEventListener("input", () => {
      clearTransformLockAll();
      const v = parseFloat(opRange.value);
      if (!Number.isNaN(v) && v !== L.opacity) {
        L.opacity = Math.max(0, Math.min(1, v));
        needsRedraw = true;
      }
    });

    opacityRow.appendChild(opLabel);
    opacityRow.appendChild(opRange);

    el.appendChild(sel);
    el.appendChild(vis);
    el.appendChild(nameWrap);
    el.appendChild(ops);
    el.appendChild(opacityRow);

    el.addEventListener("click", (ev) => {
      const additive = !!(ev.ctrlKey || ev.metaKey);
      const ranged   = !!ev.shiftKey;

      clearTransformLockAll();

      if (ranged) {
        rangeSelect(idx);
      } else if (additive) {
        toggleSelection(idx, true);
        activeLayerIndex = idx;
      } else {
        selectSingle(idx, L);
        return;
      }

      document.querySelectorAll('#layersList .layer-item').forEach(node => {
        const i = Number(node.dataset.index);
        node.classList.toggle("is-selected", selectedLayerIndices.has(i));
        node.classList.toggle("active", i === activeLayerIndex);
      });
      refreshHeader();
    });

    list.insertBefore(el, list.children[1] || null);
  });

  refreshHeader();
}



/* clearActiveLayer()
   Clears ALL pixels of the active layer to transparent, keeps the layer itself, and records History.
   Drop-in function. */
function clearActiveLayer() {
  const L = (typeof getActiveLayer === "function") ? getActiveLayer() : layers?.[activeLayerIndex];
  if (!gl || !L || !L.fbo || !L.texture) return;

  const before = snapshotLayer(activeLayerIndex);

  const W = fixedFBOWidth | 0;
  const H = fixedFBOHeight | 0;

  // Clear the layer’s FBO to transparent
  const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const prevViewport = gl.getParameter(gl.VIEWPORT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Ensure layer texture matches document size (defensive)
  gl.bindTexture(gl.TEXTURE_2D, L.texture);
  if (((L.texW | 0) !== W) || ((L.texH | 0) !== H)) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    L.texW = W; L.texH = H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, L.texture, 0);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

  const after = snapshotLayer(activeLayerIndex);
  if (before && after) {
    History.push({ type: "clear_layer", index: activeLayerIndex, before, after });
  }

  needsRedraw = true;
  requestDrawIfIdle?.();
  showStatusMessage?.("Layer cleared", "info");
}


/* Shortcut: Clear Layer
   Typical behavior: Delete / Backspace clears content. 
   Implementation: when not typing, pressing Delete or Backspace clears the ACTIVE layer.
   Drop-in block. */
(function setupClearLayerShortcut() {
  function onKeyDownClear(e) {
    if (typeof isUserTyping === "function" && isUserTyping()) return;

    const key = e.key;
    const isDelete = key === "Delete";
    const isBackspace = key === "Backspace";

    if ((isDelete || isBackspace) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      clearActiveLayer();
    }
  }
  try { document.removeEventListener("keydown", onKeyDownClear, true); } catch {}
  document.addEventListener("keydown", onKeyDownClear, true);
})();






function removeActiveLayer() {
  if (layers.length <= 1) { showStatusMessage("Need at least one layer", "warning"); return; }
  const [removed] = layers.splice(activeLayerIndex, 1);
  gl.deleteTexture(removed.texture);
  gl.deleteFramebuffer(removed.fbo);
  activeLayerIndex = Math.max(0, activeLayerIndex - 1);
  syncActiveAliases();
  rebuildLayersUI();
  needsRedraw = true;
}


function moveLayerUp(idx) {
  if (idx >= layers.length - 1) return;
  [layers[idx], layers[idx+1]] = [layers[idx+1], layers[idx]];
  if (activeLayerIndex === idx) activeLayerIndex = idx+1;
  else if (activeLayerIndex === idx+1) activeLayerIndex = idx;
  syncActiveAliases();                 // <<< keep aliases current
  rebuildLayersUI();
  needsRedraw = true;
}
function moveLayerDown(idx) {
  if (idx <= 0) return;
  [layers[idx], layers[idx-1]] = [layers[idx-1], layers[idx]];
  if (activeLayerIndex === idx) activeLayerIndex = idx-1;
  else if (activeLayerIndex === idx-1) activeLayerIndex = idx;
  syncActiveAliases();                 // <<< keep aliases current
  rebuildLayersUI();
  needsRedraw = true;
}


document.getElementById("addLayerBtn").addEventListener("click", () => {
  addLayer(`Layer ${layers.length+1}`, activeLayerIndex);
});

document.getElementById("removeLayerBtn").addEventListener("click", () => {
  removeActiveLayer();
});


/* New Empty Layer Shortcut: press "n" (no modifiers)
   Behavior: mirrors the existing "Add" button logic; ignored while typing in inputs/textarea/contenteditable. */
(function setupNewLayerShortcutN() {
  const addBtn = document.getElementById("addLayerBtn");
  if (!addBtn) return;

  function triggerAdd() {
    try {
      addBtn.click(); // reuse existing handlers/history hooks
      console.log("[Shortcut] New Layer via 'n' → addBtn.click()");
    } catch (err) {
      try {
        const name = `Layer ${layers.length + 1}`;
        const insertBelowIndex = (typeof activeLayerIndex === "number") ? activeLayerIndex : (layers.length - 1);
        addLayer(name, insertBelowIndex);
        console.log("[Shortcut] New Layer fallback → addLayer()", { name, insertBelowIndex });
      } catch (e2) {
        console.warn("[Shortcut] New Layer failed", e2);
      }
    }
  }

  function onKeyDownNewLayerN(e) {
    if (typeof isUserTyping === "function" && isUserTyping()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = (e.key || "");
    // Accept both lowercase and uppercase 'N' to handle CapsLock or accidental Shift
    if (key === "n" || key === "N") {
      e.preventDefault();
      triggerAdd();
    }
  }

  try { document.removeEventListener("keydown", onKeyDownNewLayerN, true); } catch {}
  document.addEventListener("keydown", onKeyDownNewLayerN, true);
})();




// X / Delete -> remove the currently selected layer (Blender-style)
document.addEventListener("keydown", (e) => {
  if (isUserTyping()) return;
  if (spacePanning || isDrawing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const k = e.key.toLowerCase();
  if (k === "x" || e.key === "Delete") {
    e.preventDefault();
    e.stopImmediatePropagation();

    // if user is mid-transform, cancel it like Blender before delete
    if (transformTool?.mode && transformTool.mode !== "idle") {
      endTransform(false);
    }

    if (layers.length <= 1) {
      showStatusMessage("Need at least one layer", "warning");
      return;
    }

    const name = layers[activeLayerIndex]?.name || "Layer";
    removeActiveLayer();                   // uses your existing GPU cleanup
    showStatusMessage(`Deleted: ${name}`, "success");
  }
}, { capture: true });



// FLOODING FUNCTIONS - EXPERIMENTAL - NOT WORKING PROPERLY
//–––––––––––––––––––

function initFloodFillProgram() {
    const vertexShaderSource = `
        attribute vec2 aPosition;
        varying vec2 vTexCoord;
        void main() {
            vTexCoord = (aPosition + 1.0) * 0.5;
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
    `;

    const fragmentShaderSource = `
        precision mediump float;
        varying vec2 vTexCoord;
        uniform sampler2D uSource;
        uniform vec4 uTargetColor;
        uniform vec4 uFillColor;
        uniform vec2 uTexelSize;

        void main() {
            vec4 current = texture2D(uSource, vTexCoord);

            float threshold = 0.01;

            bool isTarget = distance(current, uTargetColor) < threshold;
            bool isFilled = distance(current, uFillColor) < threshold;

            if (isFilled) {
                gl_FragColor = uFillColor;
                return;
            }

            // Check neighbors:
            vec2 offsets[8];
            offsets[0] = vec2(-uTexelSize.x, 0.0);
            offsets[1] = vec2(uTexelSize.x, 0.0);
            offsets[2] = vec2(0.0, -uTexelSize.y);
            offsets[3] = vec2(0.0, uTexelSize.y);
            offsets[4] = vec2(-uTexelSize.x, -uTexelSize.y);
            offsets[5] = vec2(-uTexelSize.x, uTexelSize.y);
            offsets[6] = vec2(uTexelSize.x, -uTexelSize.y);
            offsets[7] = vec2(uTexelSize.x, uTexelSize.y);

            // vec2 offsets[4];
            // offsets[0] = vec2(-uTexelSize.x, 0.0);
            // offsets[1] = vec2(uTexelSize.x, 0.0);
            // offsets[2] = vec2(0.0, -uTexelSize.y);
            // offsets[3] = vec2(0.0, uTexelSize.y);

            for (int i = 0; i < 8; i++) {
                vec4 neighbor = texture2D(uSource, vTexCoord + offsets[i]);
                bool neighborFilled = distance(neighbor, uFillColor) < threshold;
                if (neighborFilled && isTarget) {
                    gl_FragColor = uFillColor;
                    return;
                }
            }

            // for (int i = 0; i < 4; i++) {
            //     vec4 neighbor = texture2D(uSource, vTexCoord + offsets[i]);
            //     bool neighborFilled = distance(neighbor, uFillColor) < threshold;
            //     if (neighborFilled && isTarget) {
            //         gl_FragColor = uFillColor;
            //         return;
            //     }
            // }

            gl_FragColor = current;
        }
    `;

    // floodFillProgram = createProgram(vertexShaderSource, fragmentShaderSource);
    floodFillProgram = createProgram(gl, vertexShaderSource, fragmentShaderSource);

}


function performFloodFill(fx, fy) {
  // — Paint into the ACTIVE LAYER with proper history snapshots —
  const L = getActiveLayer();
  if (!L) return;

  // Snapshot BEFORE
  const before = snapshotLayer(activeLayerIndex);

  // Convert FBO top-left → WebGL readPixels bottom-left for seed color
  const ix = Math.max(0, Math.min(fixedFBOWidth  - 1, Math.round(fx)));
  const iyTopLeft = Math.max(0, Math.min(fixedFBOHeight - 1, Math.round(fy)));
  const iy = (fixedFBOHeight - 1) - iyTopLeft; // flip Y for readPixels

  const pixel = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.readPixels(ix, iy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const targetColor = [pixel[0]/255, pixel[1]/255, pixel[2]/255, pixel[3]/255];

  // Run the GPU flood fill from the selected seed color to current tintColor
  runFloodFillShader(L, targetColor, tintColor);

  // Snapshot AFTER + commit to History
  const after = snapshotLayer(activeLayerIndex);
  History.push({ type: "fill", before, after });

  needsRedraw = true;
}


function runFloodFillShader(layer, targetColor, fillColor) {
  const maxIterations = 50;
  let sourceFBO = fillFBO1;
  let destFBO   = fillFBO2;

  // Step 1: copy layer → source
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, layer.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sourceFBO.fbo);
  gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);
  gl.blitFramebuffer(0,0,fixedFBOWidth,fixedFBOHeight, 0,0,fixedFBOWidth,fixedFBOHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  // fullscreen quad
  const floodVertices = new Float32Array([-1,-1, 1,-1, -1,1,  -1,1, 1,-1, 1,1]);
  const floodBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, floodBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, floodVertices, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(floodFillProgram, "aPosition");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  for (let i = 0; i < maxIterations; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.fbo);
    gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);

    gl.useProgram(floodFillProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceFBO.texture);
    gl.uniform1i(gl.getUniformLocation(floodFillProgram, "uSource"), 0);

    gl.uniform4fv(gl.getUniformLocation(floodFillProgram, "uTargetColor"), targetColor);
    gl.uniform4fv(gl.getUniformLocation(floodFillProgram, "uFillColor"), fillColor);
    gl.uniform2f(gl.getUniformLocation(floodFillProgram, "uTexelSize"),
                 1.0 / fixedFBOWidth, 1.0 / fixedFBOHeight);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap
    let tmp = sourceFBO; sourceFBO = destFBO; destFBO = tmp;
  }

  // copy result → layer
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFBO.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, layer.fbo);
  gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);
  gl.blitFramebuffer(0,0,fixedFBOWidth,fixedFBOHeight, 0,0,fixedFBOWidth,fixedFBOHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);

  gl.disableVertexAttribArray(posLoc);
  gl.deleteBuffer(floodBuffer);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


// FLOOD FBO SETUP
//–––––––––––––––––––

function createFBO(width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { fbo, texture };
}

let fillFBO1 = null;
let fillFBO2 = null;

function initFloodFBOs() {
    if (fillFBO1) {
        gl.deleteTexture(fillFBO1.texture);
        gl.deleteFramebuffer(fillFBO1.fbo);
    }
    if (fillFBO2) {
        gl.deleteTexture(fillFBO2.texture);
        gl.deleteFramebuffer(fillFBO2.fbo);
    }

    fillFBO1 = createFBO(fixedFBOWidth, fixedFBOHeight);
    fillFBO2 = createFBO(fixedFBOWidth, fixedFBOHeight);
}


// DRAWING FUNCTIONS
//–––––––––––––––––––

let strokeCount = 0;
const FLATTEN_THRESHOLD = isMobile() ? 50 : 150;


// function flattenStrokes() {
//   const L = getActiveLayer();
//   if (!L || !gl || !L.fbo || !L.texture) return;

//   const W = fixedFBOWidth  | 0;
//   const H = fixedFBOHeight | 0;

//   // Source sub-rect (the layer’s bitmap rect in document pixels)
//   const srcOx = Number.isFinite(L.ox)   ? L.ox   : 0;
//   const srcOy = Number.isFinite(L.oy)   ? L.oy   : 0;
//   const srcW  = Math.max(1, (Number(L.texW) || W) | 0);
//   const srcH  = Math.max(1, (Number(L.texH) || H) | 0);

//   // Clip the blit to the document bounds in case the rect pokes outside
//   let dstX0 = Math.max(0, Math.floor(srcOx));
//   let dstY0 = Math.max(0, Math.floor(srcOy));
//   let copyW = Math.max(0, Math.min(srcW, W - dstX0));
//   let copyH = Math.max(0, Math.min(srcH, H - dstY0));

//   // Adjust source rect if we clipped on the left/top
//   let srcX0 = 0, srcY0 = 0;
//   if (srcOx < 0) { srcX0 = -srcOx | 0; copyW -= srcX0; }
//   if (srcOy < 0) { srcY0 = -srcOy | 0; copyH -= srcY0; }
//   if (copyW <= 0 || copyH <= 0) {
//     console.warn("[flattenStrokes] nothing to copy (empty intersection). Keeping as-is.");
//     return;
//   }

//   // ---- logs ----
//   console.log("[flattenStrokes] strokeCount =", strokeCount, {
//     srcRect: { x: srcX0, y: srcY0, w: copyW, h: copyH },
//     dstRect: { x: dstX0, y: dstY0, w: copyW, h: copyH },
//     layerRect: { ox: srcOx, oy: srcOy, texW: srcW, texH: srcH }
//   });

//   // Save GL state we touch
//   const prevFBO      = gl.getParameter(gl.FRAMEBUFFER_BINDING);
//   const prevProg     = gl.getParameter(gl.CURRENT_PROGRAM);
//   const prevViewport = gl.getParameter(gl.VIEWPORT);
//   const blendWasOn   = gl.isEnabled(gl.BLEND);

//   try {
//     // 1) Destination = full-document texture/FBO (NEAREST to avoid post-flatten softness)
//     const mergedTexture = gl.createTexture();
//     gl.bindTexture(gl.TEXTURE_2D, mergedTexture);
//     gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

//     const mergeFBO = gl.createFramebuffer();
//     gl.bindFramebuffer(gl.FRAMEBUFFER, mergeFBO);
//     gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mergedTexture, 0);
//     if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
//       console.warn("[flattenStrokes] destination FBO incomplete");
//       gl.deleteFramebuffer(mergeFBO);
//       gl.deleteTexture(mergedTexture);
//       return;
//     }

//     // 2) Clear destination
//     gl.viewport(0, 0, W, H);
//     gl.disable(gl.DEPTH_TEST);
//     gl.disable(gl.CULL_FACE);
//     gl.disable(gl.SCISSOR_TEST);
//     gl.disable(gl.BLEND);
//     gl.clearColor(0, 0, 0, 0);
//     gl.clear(gl.COLOR_BUFFER_BIT);

//     // 3) Copy current layer sub-rect → document-positioned rect in merged FBO
//     if (gl.blitFramebuffer) {
//       // WebGL2 path: raw blit (no filtering/gamma/flip). Coordinates are inclusive-exclusive.
//       gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.fbo);
//       gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, mergeFBO);

//       gl.blitFramebuffer(
//         srcX0,        srcY0,        srcX0 + copyW, srcY0 + copyH, // from old layer FBO
//         dstX0,        dstY0,        dstX0 + copyW, dstY0 + copyH, // into merged FBO at (ox,oy)
//         gl.COLOR_BUFFER_BIT,
//         gl.NEAREST
//       );

//       gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
//       gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
//     } else {
//       // WebGL1 fallback: shader blit via quadProgram (no Y flip; FBO→FBO)
//       gl.useProgram(quadProgram);
//       const uTex =
//         gl.getUniformLocation(quadProgram, "u_texture") ||
//         gl.getUniformLocation(quadProgram, "u_image");
//       const uFlipY      = gl.getUniformLocation(quadProgram, "u_flipY");
//       const uResolution = gl.getUniformLocation(quadProgram, "u_resolution");
//       const uOpacity    = gl.getUniformLocation(quadProgram, "u_layerOpacity");

//       if (uFlipY)      gl.uniform1f(uFlipY, 1.0);           // keep top-left convention
//       if (uResolution) gl.uniform2f(uResolution, W, H);
//       if (uOpacity)    gl.uniform1f(uOpacity, 1.0);

//       const v = new Float32Array([
//         // x,                y,                u, v
//         dstX0,              dstY0,             srcX0 / srcW,           srcY0 / srcH,
//         dstX0 + copyW,      dstY0,            (srcX0 + copyW) / srcW,  srcY0 / srcH,
//         dstX0,              dstY0 + copyH,     srcX0 / srcW,          (srcY0 + copyH) / srcH,

//         dstX0,              dstY0 + copyH,     srcX0 / srcW,          (srcY0 + copyH) / srcH,
//         dstX0 + copyW,      dstY0,            (srcX0 + copyW) / srcW,  srcY0 / srcH,
//         dstX0 + copyW,      dstY0 + copyH,    (srcX0 + copyW) / srcW, (srcY0 + copyH) / srcH
//       ]);

//       const vbo = gl.createBuffer();
//       gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
//       gl.bufferData(gl.ARRAY_BUFFER, v, gl.STREAM_DRAW);

//       const aPos = gl.getAttribLocation(quadProgram, "a_position");
//       const aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
//       if (aPos >= 0) { gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0); }
//       if (aUV  >= 0) { gl.enableVertexAttribArray(aUV);  gl.vertexAttribPointer(aUV,  2, gl.FLOAT, false, 16, 8); }

//       gl.activeTexture(gl.TEXTURE0);
//       gl.bindTexture(gl.TEXTURE_2D, L.texture);
//       if (uTex) gl.uniform1i(uTex, 0);

//       gl.drawArrays(gl.TRIANGLES, 0, 6);

//       if (aPos >= 0) gl.disableVertexAttribArray(aPos);
//       if (aUV  >= 0) gl.disableVertexAttribArray(aUV);
//       gl.bindBuffer(gl.ARRAY_BUFFER, null);
//       gl.deleteBuffer(vbo);
//     }

//     // 4) Swap in the merged FBO/texture; PRESERVE layer rect (no jump)
//     const oldTex = L.texture;
//     const oldFbo = L.fbo;

//     L.texture = mergedTexture;
//     L.fbo     = mergeFBO;

//     // Keep original rect so document position stays identical
//     L.ox   = srcOx;
//     L.oy   = srcOy;
//     L.texW = srcW;
//     L.texH = srcH;

//     // Clean old GPU objects
//     if (oldTex && gl.isTexture && gl.isTexture(oldTex)) gl.deleteTexture(oldTex);
//     else if (oldTex) gl.deleteTexture(oldTex);
//     if (oldFbo) gl.deleteFramebuffer(oldFbo);

//     // Sync + counters
//     strokeCount = 0;
//     if (typeof syncActiveAliases === "function") syncActiveAliases();

//     console.log("[flattenStrokes] done", {
//       keptRect: { ox: L.ox, oy: L.oy, texW: L.texW, texH: L.texH },
//       filter: "NEAREST",
//       path: gl.blitFramebuffer ? "blitFramebuffer" : "shaderBlit"
//     });

//   } finally {
//     // Restore GL state
//     if (!blendWasOn) gl.disable(gl.BLEND);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
//     gl.useProgram(prevProg);
//     gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
//   }

//   // Redraw
//   try { startRender?.("flatten"); } catch {}
//   needsRedraw = true;
//   requestDrawIfIdle?.();
// }



// === REPLACE: flattenStrokes() ===
// Collapse strokes into SAME layer rect (no clamp to document; preserves off-document).
function flattenStrokes() {
  const L = getActiveLayer?.();
  if (!gl || !L || !L.texture || !quadProgram) return;

  const outW = Math.max(1, L.texW | 0);
  const outH = Math.max(1, L.texH | 0);

  const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevViewport = gl.getParameter(gl.VIEWPORT);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, outW, outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  gl.viewport(0, 0, outW, outH);
  gl.disable(gl.BLEND);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(quadProgram);
  const uFlipY = gl.getUniformLocation(quadProgram, "u_flipY");
  if (uFlipY) gl.uniform1f(uFlipY, 1.0);
  const uRes = gl.getUniformLocation(quadProgram, "u_resolution");
  if (uRes) gl.uniform2f(uRes, outW, outH);
  const uOpacity = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  if (uOpacity) gl.uniform1f(uOpacity, 1.0);
  const uTex = gl.getUniformLocation(quadProgram, "u_texture");

  // Draw existing bitmap at its own (0..texW, 0..texH) in the new target
  const verts = new Float32Array([
    0,     0,      0, 0,
    outW,  0,      1, 0,
    0,     outH,   0, 1,
    0,     outH,   0, 1,
    outW,  0,      1, 0,
    outW,  outH,   1, 1
  ]);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
  const aPos = gl.getAttribLocation(quadProgram, "a_position");
  const aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV ); gl.vertexAttribPointer(aUV , 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, L.texture);
  if (uTex) gl.uniform1i(uTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(aPos);
  gl.disableVertexAttribArray(aUV);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(vbo);

  const oldTex = L.texture, oldFbo = L.fbo;
  L.texture = tex; L.fbo = fbo;
  // keep ox/oy/texW/texH as-is (no cropping, no normalization)

  try { if (oldTex) gl.deleteTexture(oldTex); } catch {}
  try { if (oldFbo) gl.deleteFramebuffer(oldFbo); } catch {}

  // reset stroke counter if used
  try { strokeCount = 0; } catch {}

  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.useProgram(prevProg);
  if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

  needsRedraw = true; requestDrawIfIdle?.();
}





let currentAngle = 0;
let sharedBuffer = null; // Add this global buffer initialization


// === Drop-in: Undoable Project Clear (binds #cleanButton) ===
// Place this block anywhere after History is defined and GL/canvas globals exist.


// 1) Pure helper: build the noisy paper as an Image (no GL side effects)
function createPaperImage(width, height) {
  return new Promise((resolve, reject) => {
    try {
      const baseCanvas = document.createElement("canvas");
      baseCanvas.width = Math.max(1, Math.floor(width));
      baseCanvas.height = Math.max(1, Math.floor(height));
      const ctx = baseCanvas.getContext("2d");

      // Base color
      ctx.fillStyle = "#f2efe4";
      ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);

      // Fine grain noise
      const noiseCanvas = document.createElement("canvas");
      noiseCanvas.width = baseCanvas.width;
      noiseCanvas.height = baseCanvas.height;
      const nctx = noiseCanvas.getContext("2d");
      const noiseData = nctx.createImageData(noiseCanvas.width, noiseCanvas.height);
      for (let i = 0; i < noiseData.data.length; i += 4) {
        const noise = Math.random() * 50 - 25;
        noiseData.data[i]     = 240 + noise; // R
        noiseData.data[i + 1] = 235 + noise; // G
        noiseData.data[i + 2] = 225 + noise; // B
        noiseData.data[i + 3] = 255;         // A
      }
      nctx.putImageData(noiseData, 0, 0);
      ctx.globalAlpha = 0.2;
      ctx.drawImage(noiseCanvas, 0, 0);
      ctx.globalAlpha = 1.0;

      // Crisp speckle overlay
      const crispCanvas = document.createElement("canvas");
      crispCanvas.width = baseCanvas.width;
      crispCanvas.height = baseCanvas.height;
      const cctx = crispCanvas.getContext("2d");
      const crispData = cctx.createImageData(crispCanvas.width, crispCanvas.height);
      for (let i = 0; i < crispData.data.length; i += 4) {
        const val = Math.random() * 255;
        crispData.data[i]     = val;
        crispData.data[i + 1] = val;
        crispData.data[i + 2] = val;
        crispData.data[i + 3] = Math.random() * 90; // translucency
      }
      cctx.putImageData(crispData, 0, 0);
      ctx.globalAlpha = 0.08;
      ctx.drawImage(crispCanvas, 0, 0);
      ctx.globalAlpha = 1.0;

      // Subtle vignette
      const vg = ctx.createRadialGradient(
        baseCanvas.width / 2, baseCanvas.height / 2, Math.min(baseCanvas.width, baseCanvas.height) * 0.3,
        baseCanvas.width / 2, baseCanvas.height / 2, Math.max(baseCanvas.width, baseCanvas.height) * 0.6
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
      ctx.globalAlpha = 1.0;

      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = baseCanvas.toDataURL("image/png");
    } catch (err) {
      reject(err);
    }
  });
}

// 2) Reset document to the base paper (re-centers view, rebuilds layers)
async function resetToBasePaper() {
  const W = (Number(fixedFBOWidth)  > 0 ? fixedFBOWidth  : window.innerWidth);
  const H = (Number(fixedFBOHeight) > 0 ? fixedFBOHeight : window.innerHeight);

  const img = await createPaperImage(W, H);

  // Set as current background & rebuild paint stack
  currentImage = img;
  fixedFBOWidth  = img.width;
  fixedFBOHeight = img.height;

  initPaintLayerFixed();  // wipes layers → adds fresh Layer 1
  initFloodFBOs?.();

  updateCanvasSize(img);
  createTextureFromImage(img); // sets `texture`

  // Center & reset view (no white flash)
  void canvas.offsetWidth; 
  void canvasWrapper.offsetWidth;
  zoomScale = 1;
  panX = (canvasWrapper.clientWidth  - canvas.width ) / 2;
  panY = (canvasWrapper.clientHeight - canvas.height) / 2;
  viewRotation = 0;
  updateCanvasTransform();

  resetStrokeState?.();
  rebuildLayersUI?.();
  needsRedraw = true;
  requestDrawIfIdle?.();
}

// 3) Replace your clearProject with this async version
async function clearProject() {
  try {
    console.log("[ClearProject] begin");

    // BEFORE snapshot (includes current background if any)
    const beforeAll = History._captureProject?.();

    // Dispose existing GL layer resources
    try {
      if (Array.isArray(layers)) {
        layers.forEach(L => {
          try { gl.deleteTexture(L.texture); } catch {}
          try { gl.deleteFramebuffer(L.fbo); } catch {}
        });
      }
    } catch (e) {
      console.warn("[ClearProject] disposing old layers warning:", e);
    }

    // IMPORTANT: recreate the base paper instead of clearing to white
    await resetToBasePaper();

    // AFTER snapshot (now includes the fresh noisy paper background)
    const afterAll = History._captureProject?.();

    // Single undoable action
    History.push({ type: "clear_project", beforeAll, afterAll });

    showStatusMessage?.("Project cleared to base paper", "success");
    console.log("[ClearProject] done");
  } catch (err) {
    console.error("[ClearProject] fatal error:", err);
    showStatusMessage?.("Clear failed", "error");
  }
}

// Bind to the UI button (id="cleanButton")
(() => {
  const btn = document.getElementById("cleanButton");
  if (!btn) {
    console.warn('[ClearProject] "#cleanButton" not found; binding skipped.');
    return;
  }
  btn.addEventListener("click", () => {
    console.log("[ClearProject] click");
    clearProject();
    try { saveAutosaveDebounced?.(400); } catch {}
  });
})();




//---------------
// UNDO SYSTEM

/* History: configuration */
const UNDO_LIMIT = isMobile() ? 50 : 200;

/* History: FBO utilities */
function createTextureAndFBO(w, h, filtering = gl.NEAREST) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, fbo };
}

function blitFBOtoFBO(srcFbo, dstFbo, w = fixedFBOWidth, h = fixedFBOHeight) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}




/* applySnapshotToLayer(layerIndex, snapshot)
   Restore pixels ONLY. Do not alter any transform fields (x,y,scale,rotation,px,py,ox,oy,texW,texH).
   This preserves the pivot and prevents “grabbing point” drift after undo/redo. */
function applySnapshotToLayer(layerIndex, snapshot) {
  const L = layers?.[layerIndex];
  if (!gl || !L || !snapshot) return;

  const W = snapshot.w | 0;
  const H = snapshot.h | 0;

  if (!L.texture) {
    L.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, L.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, L.texture);
  }
  if (!L.fbo) {
    L.fbo = gl.createFramebuffer();
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, L.texture, 0);

  if (gl.UNPACK_FLIP_Y_WEBGL !== undefined) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  if ((L.texW | 0) !== W || (L.texH | 0) !== H) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, snapshot.pixels);
    // keep L.ox/L.oy/L.px/L.py intact; just update storage size
    L.texW = W; L.texH = H;
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, snapshot.pixels);
  }

  needsRedraw = true;
  requestDrawIfIdle?.();
}





// /* snapshotLayer(layerIndex)
//    Captures the specified layer into an offscreen FBO in full document space (fixedFBOWidth × fixedFBOHeight)
//    using the SAME vertical orientation as on-screen rendering (u_flipY = -1.0). This prevents Y-inversion
//    on undo/redo because the snapshot pixels match the renderer’s expected orientation. Swap in fully. :contentReference[oaicite:0]{index=0} */
// function snapshotLayer(layerIndex) {
//   const L = layers?.[layerIndex];
//   if (!gl || !L || !L.texture || !quadProgram) return null;

//   const W = fixedFBOWidth | 0;
//   const H = fixedFBOHeight | 0;

//   // Preserve GL state (FBO/program/viewport)
//   const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
//   const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
//   const prevViewport = gl.getParameter(gl.VIEWPORT);

//   // Offscreen target (document-sized)
//   const tmpTex = gl.createTexture();
//   gl.bindTexture(gl.TEXTURE_2D, tmpTex);
//   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
//   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

//   const tmpFBO = gl.createFramebuffer();
//   gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFBO);
//   gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tmpTex, 0);

//   gl.viewport(0, 0, W, H);
//   gl.disable(gl.BLEND);
//   gl.clearColor(0, 0, 0, 0);
//   gl.clear(gl.COLOR_BUFFER_BIT);

//   // Draw the layer (document coordinates) with the SAME flip as screen (-1.0)
//   gl.useProgram(quadProgram);
//   const uFlipY   = gl.getUniformLocation(quadProgram, "u_flipY");
//   const uRes     = gl.getUniformLocation(quadProgram, "u_resolution");
//   const uOpacity = gl.getUniformLocation(quadProgram, "u_layerOpacity");
//   const uTex     = gl.getUniformLocation(quadProgram, "u_texture");
//   if (uFlipY)   gl.uniform1f(uFlipY, -1.0);       // <— critical: match on-screen orientation
//   if (uRes)     gl.uniform2f(uRes, W, H);
//   if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, L.opacity ?? 1)));

//   // Build transformed quad for the layer’s texture rect in document space
//   const Lx = Number.isFinite(L.ox) ? L.ox : 0;
//   const Ly = Number.isFinite(L.oy) ? L.oy : 0;
//   const Lw = Math.max(1, Number.isFinite(L.texW) ? L.texW : W);
//   const Lh = Math.max(1, Number.isFinite(L.texH) ? L.texH : H);
//   const scx = Number.isFinite(L.scaleX) ? L.scaleX : 1;
//   const scy = Number.isFinite(L.scaleY) ? L.scaleY : 1;
//   const rot = Number.isFinite(L.rotation) ? L.rotation : 0;
//   const tx  = Number.isFinite(L.x) ? L.x : 0;
//   const ty  = Number.isFinite(L.y) ? L.y : 0;
//   const pivX = Number.isFinite(L.px) ? L.px : W * 0.5;
//   const pivY = Number.isFinite(L.py) ? L.py : H * 0.5;

//   const c = Math.cos(rot), s = Math.sin(rot);
//   function tf(x, y) {
//     let dx = (x - pivX) * scx, dy = (y - pivY) * scy;
//     const rx = dx * c - dy * s, ry = dx * s + dy * c;
//     return { x: pivX + rx + tx, y: pivY + ry + ty };
//   }
//   const p0 = tf(Lx,      Ly);
//   const p1 = tf(Lx + Lw, Ly);
//   const p2 = tf(Lx,      Ly + Lh);
//   const p3 = tf(Lx + Lw, Ly + Lh);

//   const verts = new Float32Array([
//     p0.x, p0.y, 0, 0,
//     p1.x, p1.y, 1, 0,
//     p2.x, p2.y, 0, 1,
//     p2.x, p2.y, 0, 1,
//     p1.x, p1.y, 1, 0,
//     p3.x, p3.y, 1, 1
//   ]);
//   const vbo = gl.createBuffer();
//   gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
//   gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
//   const aPos = gl.getAttribLocation(quadProgram, "a_position");
//   const aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
//   gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
//   gl.enableVertexAttribArray(aUV ); gl.vertexAttribPointer(aUV , 2, gl.FLOAT, false, 16, 8);

//   gl.activeTexture(gl.TEXTURE0);
//   gl.bindTexture(gl.TEXTURE_2D, L.texture);
//   if (uTex) gl.uniform1i(uTex, 0);
//   gl.drawArrays(gl.TRIANGLES, 0, 6);

//   gl.disableVertexAttribArray(aPos);
//   gl.disableVertexAttribArray(aUV);
//   gl.bindBuffer(gl.ARRAY_BUFFER, null);
//   gl.deleteBuffer(vbo);

//   // Immutable CPU copy
//   const pixels = new Uint8Array(W * H * 4);
//   gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

//   // Restore GL state and clean up
//   gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
//   gl.useProgram(prevProg);
//   if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
//   try { gl.deleteFramebuffer(tmpFBO); } catch {}
//   try { gl.deleteTexture(tmpTex); } catch {}

//   return { index: layerIndex, w: W, h: H, pixels };
// }

/* snapshotLayer(layerIndex)
   Captures the active layer’s pixels DIRECTLY from its own FBO at full document resolution.
   Critical details:
   - No draw/quad/shader path → avoids double-transform and stray u_flipY usage.
   - Reads raw pixels in the exact orientation the brush pipeline wrote them.
   - Returns immutable CPU pixels and the target layer index for unambiguous restores.
   Swap this entire function body in place of the existing snapshotLayer. */
function snapshotLayer(layerIndex) {
  const L = layers?.[layerIndex];
  if (!gl || !L || !L.fbo) return null;

  const W = fixedFBOWidth | 0;
  const H = fixedFBOHeight | 0;

  // Preserve GL state so normal rendering isn’t perturbed.
  const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const prevViewport = gl.getParameter(gl.VIEWPORT);

  // Bind the layer’s FBO and read the raw pixels (document orientation).
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.viewport(0, 0, W, H);

  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Restore GL state.
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

  // Include the target index so History restores into the correct layer.
  return { index: layerIndex, w: W, h: H, pixels };
}



/* applyLayerTransformState(index, state)
   Applies a previously captured transform without touching pixels. 
   Use only for transform undo/redo — not for strokes. */
/* applyLayerTransformState(index, state)
   Apply parametric transform EXACTLY as captured; never recenter pivot or alter ox/oy.
   Prevents rotation/pivot drift after scaling or undo/redo. */
function applyLayerTransformState(index, state) {
  const L = layers?.[index];
  if (!L || !state) return;
  L.x = state.x; L.y = state.y;
  L.scaleX = state.scaleX; L.scaleY = state.scaleY;
  L.rotation = state.rotation;
  L.px = state.px; L.py = state.py;           // keep pivot fixed
  L.ox = state.ox; L.oy = state.oy;           // document-space layer rect origin
  L.texW = state.texW; L.texH = state.texH;   // texture rect size (no crop)
  if (typeof state.opacity === "number") L.opacity = state.opacity;
  if (typeof state.visible === "boolean") L.visible = state.visible;
  needsRedraw = true;
  requestDrawIfIdle?.();
}


/* endTransformHistory(layerIndex)
   Call at the end of move/scale/rotate/pivot interactions (mouse/touch up). 
   Pushes a parametric action only if something actually changed. */
function endTransformHistory(layerIndex = activeLayerIndex) {
  if (!__transformBefore) return;
  const after = getLayerTransformState(layerIndex);
  const b = __transformBefore;
  const changed =
    b.x !== after.x || b.y !== after.y ||
    b.scaleX !== after.scaleX || b.scaleY !== after.scaleY ||
    b.rotation !== after.rotation ||
    b.px !== after.px || b.py !== after.py ||
    b.ox !== after.ox || b.oy !== after.oy ||
    b.texW !== after.texW || b.texH !== after.texH ||
    b.opacity !== after.opacity || b.visible !== after.visible;

  if (changed) {
    History.push({
      type: "layer_transform",
      index: layerIndex,
      before: b,
      after
    });
  }
  __transformBefore = null;
}




/* beginTransformHistory(layerIndex)
   Call at the start of move/scale/rotate/pivot interactions (mouse/touch down on transform gizmo). */
let __transformBefore = null;
function beginTransformHistory(layerIndex = activeLayerIndex) {
  __transformBefore = getLayerTransformState(layerIndex);
}




/* getLayerTransformState(index)
   Reads the current parametric transform of a layer. 
   Drop-in function; call this when a transform interaction starts/ends. */
function getLayerTransformState(index) {
  const L = layers?.[index];
  if (!L) return null;
  return {
    x: L.x || 0,
    y: L.y || 0,
    scaleX: (typeof L.scaleX === "number" ? L.scaleX : 1),
    scaleY: (typeof L.scaleY === "number" ? L.scaleY : 1),
    rotation: L.rotation || 0,
    px: (typeof L.px === "number" ? L.px : (fixedFBOWidth * 0.5)),
    py: (typeof L.py === "number" ? L.py : (fixedFBOHeight * 0.5)),
    ox: L.ox || 0,
    oy: L.oy || 0,
    texW: L.texW || fixedFBOWidth,
    texH: L.texH || fixedFBOHeight,
    opacity: (typeof L.opacity === "number" ? L.opacity : 1),
    visible: (typeof L.visible === "boolean" ? L.visible : true)
  };
}



/* restoreLayerSnapshot(snap)
   Applies a snapshot to its original layer index (embedded in the snapshot).
   Simple router used by History._apply/_applyInverse to avoid mismatched targets.
   Swap this entire function body in place of the existing restoreLayerSnapshot. */
function restoreLayerSnapshot(snap) {
  if (!snap) return;
  const idx = (typeof snap.index === "number") ? snap.index : activeLayerIndex;
  if (!layers[idx]) return;
  applySnapshotToLayer(idx, snap);
}





function disposeSnapshot(snap) {
  try {
    if (snap?.texture) gl.deleteTexture(snap.texture);
    if (snap?.fbo) gl.deleteFramebuffer(snap.fbo);
  } catch (e) { console.warn("disposeSnapshot", e); }
}



/* History (drop-in full replacement)
   Handles undo/redo for pixel edits (strokes/fills/commits) and parametric/structural changes.
   Design:
   - Pixel edits store immutable CPU snapshots (Uint8Array RGBA) captured in document space.
   - Transforms store parametric state only (x/y/scale/rotation/pivot/opacity/visibility).
   - Structural ops (add/remove/move/merge/clear project) recreate GL resources on demand.
   - No GL handles are kept inside actions, so stacks are safe across context work.
   Integration points expected to exist in the app:
     - snapshotLayer(index) → { index,w,h,pixels }  (document-space, non-flipped)
     - restoreLayerSnapshot(snap) → void             (blits doc-space pixels to target layer)
     - applyLayerTransformState(index,state) → void  (sets x/y/scale/rotation/px/py/opacity/visible)
     - createLayerFBO(w,h) → { texture,fbo }        (allocates a layer target)
     - blitFBOtoFBO(srcFBO,dstFBO,w?,h?)            (copies pixels between FBOs)
     - getActiveLayer(), layers[], activeLayerIndex
     - syncActiveAliases(), rebuildLayersUI(), updateCanvasSize(), createTextureFromImage()
     - currentImage, fixedFBOWidth, fixedFBOHeight, texture (background)
     - showStatusMessage(), requestDrawIfIdle(), needsRedraw (boolean), gl (WebGLRenderingContext)
*/
const History = {
  /* stacks */
  stack: [],
  redo: [],
  limit: UNDO_LIMIT,

  /* push(action)
     Adds an action to the undo stack, evicts beyond limit, clears redo. */
  push(action) {
    this.stack.push(action);
    if (this.stack.length > this.limit) this._dispose(this.stack.shift());
    this.redo.length = 0;
    console.log("[History] push", action.type);
  },

  /* undo()
     Applies inverse of the last action, moves it to redo, forces a redraw. */
  undo() {
    const action = this.stack.pop();
    if (!action) return;
    this._applyInverse(action);
    this.redo.push(action);
    try { gl.flush?.(); } catch {}
    needsRedraw = true;
    requestDrawIfIdle?.();
    showStatusMessage?.("Undo", "info");
    console.log("[History] undo", action.type);
  },

  /* redoDo()
     Reapplies an action from redo, moves it back to undo, forces a redraw. */
  redoDo() {
    const action = this.redo.pop();
    if (!action) return;
    this._apply(action);
    this.stack.push(action);
    try { gl.flush?.(); } catch {}
    needsRedraw = true;
    requestDrawIfIdle?.();
    showStatusMessage?.("Redo", "info");
    console.log("[History] redo", action.type);
  },

  /* _dispose(action)
     Releases CPU buffers embedded in an evicted action (prevents heap bloat). */
  _dispose(action) {
    if (!action) return;
    const nuke = (snap) => { if (snap && snap.pixels) snap.pixels = null; };

    nuke(action.before);
    nuke(action.after);

    if (action.removedLayer) nuke(action.removedLayer.snapshot);
    if (action.addedLayer)   nuke(action.addedLayer.snapshot);

    if (action.type === "merge_layers") {
      if (action.added?.data) nuke(action.added.data.snapshot);
      if (Array.isArray(action.removed)) {
        for (const r of action.removed) nuke(r?.data?.snapshot);
      }
    }
  },

  /* _apply(action)
     Redo path: applies “after” state/snapshot for a previously undone action. */
  _apply(action) {
    switch (action.type) {
      /* pixel-domain edits: restore baked pixels */
      case "stroke":
      case "fill":
      case "transform_bake": {
        if (action.after) restoreLayerSnapshot(action.after);
        break;
      }

      /* param toggles: set new value only (no snapshot) */
      case "layer_visibility":
        layers[action.index].visible = action.next;
        break;
      case "layer_opacity":
        layers[action.index].opacity = action.next;
        break;
      case "layer_rename":
        layers[action.index].name = action.next;
        rebuildLayersUI?.();
        break;

      /* structural: reorder / insert / remove / merge / full reset */
      case "layer_move":
        this._moveLayer(action.from, action.to);
        break;
      case "add_layer":
        this._insertLayer(action.index, action.addedLayer);
        break;
      case "remove_layer":
        this._removeLayerAt(action.index);
        break;
      case "clear_project":
        this._restoreProject(action.afterAll);
        break;
      case "merge_layers": {
        if (!Array.isArray(action.removed) || !action.added) break;
        const toRemove = action.removed.map(r => r.index).sort((a, b) => b - a);
        for (const idx of toRemove) this._removeLayerAt(idx);
        this._insertLayer(action.added.index, action.added.data);
        activeLayerIndex = action.added.index;
        syncActiveAliases?.();
        rebuildLayersUI?.();
        break;
      }

      /* parametric transform (non-baked): set “after” transform values */
      case "layer_transform":
        applyLayerTransformState(action.index, action.after);
        break;
    }
  },

  /* _applyInverse(action)
     Undo path: applies “before” state/snapshot for the last action. */
  _applyInverse(action) {
    switch (action.type) {
      /* pixel-domain edits: restore prior baked pixels */
      case "stroke":
      case "fill":
      case "transform_bake": {
        if (action.before) restoreLayerSnapshot(action.before);
        break;
      }

      /* param toggles: restore previous value */
      case "layer_visibility":
        layers[action.index].visible = action.prev;
        break;
      case "layer_opacity":
        layers[action.index].opacity = action.prev;
        break;
      case "layer_rename":
        layers[action.index].name = action.prev;
        rebuildLayersUI?.();
        break;

      /* structural: reverse the operation exactly */
      case "layer_move":
        this._moveLayer(action.to, action.from);
        break;
      case "add_layer":
        this._removeLayerAt(action.index);
        break;
      case "remove_layer":
        this._insertLayer(action.index, action.removedLayer);
        break;
      case "clear_project":
        this._restoreProject(action.beforeAll);
        break;
      case "merge_layers": {
        if (action.added) this._removeLayerAt(action.added.index);
        if (Array.isArray(action.removed)) {
          const originals = action.removed.slice().sort((a, b) => a.index - b.index);
          for (const r of originals) this._insertLayer(r.index, r.data);
          activeLayerIndex = originals[originals.length - 1]?.index ?? 0;
          syncActiveAliases?.();
          rebuildLayersUI?.();
        }
        break;
      }

      /* parametric transform (non-baked): set “before” transform values */
      case "layer_transform":
        applyLayerTransformState(action.index, action.before);
        break;
    }
  },

  /* _moveLayer(from,to)
     Moves a layer in the stack and refreshes selection + UI. */
  _moveLayer(from, to) {
    if (from === to) return;
    const L = layers.splice(from, 1)[0];
    layers.splice(to, 0, L);
    activeLayerIndex = to;
    syncActiveAliases?.();
    rebuildLayersUI?.();
  },

  /* _removeLayerAt(index)
     Destroys GL resources for a layer and removes it from the list. */
  _removeLayerAt(index) {
    const L = layers[index];
    if (!L) return;
    try { gl.deleteTexture(L.texture); } catch {}
    try { gl.deleteFramebuffer(L.fbo); } catch {}
    layers.splice(index, 1);
    activeLayerIndex = Math.max(0, Math.min(activeLayerIndex, layers.length - 1));
    syncActiveAliases?.();
    rebuildLayersUI?.();
  },

  /* _insertLayer(index,data)
     Inserts a new layer and restores pixels from an optional snapshot. */
  _insertLayer(index, data) {
    const layer = {
      id: Date.now() + Math.random(),
      name: data?.name ?? "Layer",
      visible: data?.visible ?? true,
      opacity: data?.opacity ?? 1,
      // geometric defaults; snapshots restore only pixels, not transforms
      ox: 0, oy: 0, texW: fixedFBOWidth, texH: fixedFBOHeight,
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
      px: fixedFBOWidth * 0.5, py: fixedFBOHeight * 0.5,
      texture: null, fbo: null
    };

    // allocate GL targets
    const res = createLayerFBO(fixedFBOWidth, fixedFBOHeight);
    layer.texture = res.texture;
    layer.fbo = res.fbo;

    // place into stack
    layers.splice(index, 0, layer);

    // restore pixels or leave empty transparent
    if (data?.snapshot && data.snapshot.pixels) {
      applySnapshotToLayer(index, data.snapshot);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fixedFBOWidth, fixedFBOHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      layer.texW = fixedFBOWidth;
      layer.texH = fixedFBOHeight;
    }

    activeLayerIndex = index;
    syncActiveAliases?.();
    rebuildLayersUI?.();
  },

  /* _captureProject()
     Captures full project state into CPU data (no GL handles). */
  _captureProject() {
    return {
      w: fixedFBOWidth,
      h: fixedFBOHeight,
      layers: layers.map((L, i) => ({
        index: i,
        name: L.name,
        visible: L.visible,
        opacity: L.opacity,
        snapshot: snapshotLayer(i)
      })),
      background: (() => {
        try {
          if (!currentImage) return null;
          const c = document.createElement("canvas");
          c.width = fixedFBOWidth; c.height = fixedFBOHeight;
          const ctx = c.getContext("2d");
          ctx.drawImage(currentImage, 0, 0, fixedFBOWidth, fixedFBOHeight);
          return c.toDataURL("image/png");
        } catch { return null; }
      })()
    };
  },

  /* _restoreProject(all)
     Replaces current project with CPU-captured data, recreating GL resources. */
  _restoreProject(all) {
    if (!all) return;
    try {
      // dispose current layers
      for (const L of layers) {
        try { gl.deleteTexture(L.texture); } catch {}
        try { gl.deleteFramebuffer(L.fbo); } catch {}
      }
      layers = [];

      // restore background image (if present)
      if (all.background) {
        const img = new Image();
        img.onload = () => {
          currentImage = img;
          updateCanvasSize(img);
          createTextureFromImage(img);
          needsRedraw = true;
          requestDrawIfIdle?.();
        };
        img.src = all.background;
      } else {
        currentImage = null;
        texture = null;
      }

      // rebuild layers from snapshots
      for (const info of all.layers) {
        this._insertLayer(layers.length, {
          name: info.name,
          visible: info.visible,
          opacity: info.opacity,
          snapshot: info.snapshot
        });
      }

      activeLayerIndex = Math.max(0, layers.length - 1);
      syncActiveAliases?.();
      rebuildLayersUI?.();
      needsRedraw = true;
      requestDrawIfIdle?.();
    } catch (e) {
      console.error("[History] _restoreProject failed:", e);
    }
  }
};



/* History: stroke grouping */
/* beginStrokeHistory()
   Starts a paint interaction and captures the immutable CPU snapshot BEFORE any brush writes.
   Guards against duplicate captures within a single gesture. Keep this as a top-level function,
   replacing the current implementation. :contentReference[oaicite:2]{index=2} */
let __strokeBeforeSnap = null;
let __strokeInProgress = false;
function beginStrokeHistory() {
  try {
    if (__strokeInProgress) return;
    const L = getActiveLayer?.(); if (!L) return;
    __strokeInProgress = true;
    __strokeBeforeSnap = snapshotLayer(activeLayerIndex);
    console.log("[History] begin stroke on layer", activeLayerIndex);
  } catch (e) {
    console.warn("beginStrokeHistory", e);
    __strokeInProgress = false;
    __strokeBeforeSnap = null;
  }
}

/* endStrokeHistory(type = "stroke")
   Ends the paint interaction. Defers the “after” snapshot to the next animation frame and finishes
   GPU work so readPixels reflects the final stroke. Skips no-op entries to keep stacks clean.
   Keep this as a top-level function, replacing the current implementation. :contentReference[oaicite:3]{index=3} */
function endStrokeHistory(type = "stroke") {
  try {
    const L = getActiveLayer?.();
    if (!L || !__strokeInProgress || !__strokeBeforeSnap) {
      __strokeInProgress = false;
      __strokeBeforeSnap = null;
      return;
    }

    function snapshotsEqual(a, b) {
      if (!a || !b) return false;
      if (a.w !== b.w || a.h !== b.h) return false;
      const ap = a.pixels, bp = b.pixels;
      if (!ap || !bp || ap.length !== bp.length) return false;
      // Sample every 32nd pixel (4 bytes per pixel) to avoid big mem compares on large canvases
      const stride = 128;
      const len = ap.length;
      for (let i = 0; i < len; i += stride) {
        if (ap[i] !== bp[i] || ap[i+1] !== bp[i+1] || ap[i+2] !== bp[i+2] || ap[i+3] !== bp[i+3]) return false;
      }
      const j = len - 4;
      return ap[j] === bp[j] && ap[j+1] === bp[j+1] && ap[j+2] === bp[j+2] && ap[j+3] === bp[j+3];
    }

    // Defer one frame so the last brush segments are committed to the layer’s FBO/texture
    requestAnimationFrame(() => {
      try {
        gl.flush?.();
        gl.finish?.(); // ensure GPU completion before reading back

        const after = snapshotLayer(activeLayerIndex);

        if (!snapshotsEqual(__strokeBeforeSnap, after)) {
          History.push({ type, before: __strokeBeforeSnap, after });
          console.log("[History] commit stroke", { type, layer: activeLayerIndex });
        } else {
          console.log("[History] skip no-op stroke", { layer: activeLayerIndex });
        }
      } catch (e) {
        console.warn("endStrokeHistory/commit", e);
      } finally {
        __strokeInProgress = false;
        __strokeBeforeSnap = null;
        needsRedraw = true;
        requestDrawIfIdle?.();
      }
    });
  } catch (e) {
    console.warn("endStrokeHistory", e);
    __strokeInProgress = false;
    __strokeBeforeSnap = null;
  }
}


/* History: public bindings */
function undoStroke() { History.undo(); }
function redoStroke() { History.redoDo(); }

/* History: UI bindings */
try {
  document.getElementById("undoButton").removeEventListener?.("click", undoStroke);
  document.getElementById("redoButton").removeEventListener?.("click", redoStroke);
} catch {}
document.getElementById("undoButton").addEventListener("click", undoStroke);
document.getElementById("redoButton").addEventListener("click", redoStroke);

/* History: keybindings */
document.addEventListener("keydown", (event) => {
  if (isUserTyping()) return;
  if (event.key === "z" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); undoStroke(); }
  if (event.key === "y" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); redoStroke(); }
}, { capture: true });

/* History: pointer integration */
canvas.addEventListener("pointerdown", () => { beginStrokeHistory(); }, { capture: true });
canvas.addEventListener("pointerup", () => { endStrokeHistory("stroke"); }, { capture: true });

/* FINAL Flood Fill (no wrappers, self-contained history) */
function performFloodFill(fx, fy) {
  const L = getActiveLayer();
  if (!L) return;

  // Snapshot BEFORE
  const before = snapshotLayer(activeLayerIndex);

  // Compute seed color (account for WebGL readPixels bottom-left origin)
  const ix = Math.max(0, Math.min(fixedFBOWidth  - 1, Math.round(fx)));
  const iyTopLeft = Math.max(0, Math.min(fixedFBOHeight - 1, Math.round(fy)));
  const iy = (fixedFBOHeight - 1) - iyTopLeft;

  const pixel = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.readPixels(ix, iy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const targetColor = [pixel[0]/255, pixel[1]/255, pixel[2]/255, pixel[3]/255];

  // GPU fill to current tintColor
  runFloodFillShader(L, targetColor, tintColor);

  // Snapshot AFTER + commit
  const after = snapshotLayer(activeLayerIndex);
  History.push({ type: "fill", before, after });

  needsRedraw = true;
}


/* endTransform(bake = false)
   Finalizes a move/scale/rotate gesture WITHOUT baking pixels. Records a parametric history entry
   (layer_transform) using the transform state at gesture start (before) and at gesture end (after).
   This preserves “endless layers” because no offscreen FBO is created and nothing is cropped.
   Drop-in replacement for the existing endTransform(). */
function endTransform(bake = false) {
  const running = transformTool && transformTool.mode && transformTool.mode !== "idle";
  if (!running) {
    try { isTwoFingerGesture = false; pinchStart = null; } catch {}
    if (transformTool) transformTool.mode = "idle";
    needsRedraw = true; if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    return;
  }

  try { stopRender?.("transform"); } catch {}

  // Capture parametric BEFORE from the ref saved at startTransform(), AFTER from the layer now.
  const idx = activeLayerIndex;
  const L = layers[idx];
  const before = transformTool && transformTool.ref ? {
    x: transformTool.ref.x, y: transformTool.ref.y,
    scaleX: transformTool.ref.scaleX, scaleY: transformTool.ref.scaleY,
    rotation: transformTool.ref.rotation,
    px: transformTool.ref.px, py: transformTool.ref.py,
    ox: L.ox ?? 0, oy: L.oy ?? 0,            // keep rect metadata with before
    texW: L.texW ?? fixedFBOWidth, texH: L.texH ?? fixedFBOHeight,
    opacity: (typeof L.opacity === "number" ? L.opacity : 1),
    visible: (typeof L.visible === "boolean" ? L.visible : true)
  } : null;

  const after = L ? {
    x: L.x || 0, y: L.y || 0,
    scaleX: (typeof L.scaleX === "number" ? L.scaleX : 1),
    scaleY: (typeof L.scaleY === "number" ? L.scaleY : 1),
    rotation: L.rotation || 0,
    px: (typeof L.px === "number" ? L.px : (fixedFBOWidth * 0.5)),
    py: (typeof L.py === "number" ? L.py : (fixedFBOHeight * 0.5)),
    ox: L.ox || 0, oy: L.oy || 0,
    texW: L.texW || fixedFBOWidth, texH: L.texH || fixedFBOHeight,
    opacity: (typeof L.opacity === "number" ? L.opacity : 1),
    visible: (typeof L.visible === "boolean" ? L.visible : true)
  } : null;

  // Push only if something actually changed.
  const changed = !!before && !!after && (
    before.x !== after.x || before.y !== after.y ||
    before.scaleX !== after.scaleX || before.scaleY !== after.scaleY ||
    before.rotation !== after.rotation ||
    before.px !== after.px || before.py !== after.py ||
    before.ox !== after.ox || before.oy !== after.oy ||
    before.texW !== after.texW || before.texH !== after.texH ||
    before.opacity !== after.opacity || before.visible !== after.visible
  );

  if (changed) {
    History.push({ type: "layer_transform", index: idx, before, after });
  }

  // Clear gesture state and exit transform mode; do NOT bake pixels (keeps layers unbounded).
  try {
    transformTool.start = null;
    transformTool.ref = null;
    transformTool.shiftInvert = false;
    transformTool.pivotCanvas = null;
  } catch {}
  if (transformTool) transformTool.mode = "idle";
  try { isTwoFingerGesture = false; pinchStart = null; } catch {}

  // Keep transform tool armed on mobile if the layer is locked for transforms.
  const stayArmed = !!(L && L.transformLocked);
  if (transformTool) transformTool.mobileCombo = stayArmed;
  if (stayArmed) queueMicrotask?.(() => startTransform?.("grab"));

  showStatusMessage?.(changed ? "Transform applied" : "Transform cancelled", changed ? "success" : "info");
  needsRedraw = true; if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
}



/* History: layer operations API */
function recordLayerVisibilityChange(index, prev, next) {
  History.push({ type: "layer_visibility", index, prev, next });
}
function recordLayerOpacityChange(index, prev, next) {
  History.push({ type: "layer_opacity", index, prev, next });
}
function recordLayerRename(index, prev, next) {
  History.push({ type: "layer_rename", index, prev, next });
}
function recordLayerMove(from, to) {
  History.push({ type: "layer_move", from, to });
}
function recordAddLayer(index) {
  const snap = snapshotLayer(index);
  History.push({ type: "add_layer", index, addedLayer: { name: layers[index].name, visible: layers[index].visible, opacity: layers[index].opacity, snapshot: snap } });
}
function recordRemoveLayer(index, removedLayerData) {
  History.push({ type: "remove_layer", index, removedLayer: removedLayerData });
}
function captureLayerDataForRemoval(index) {
  const L = layers[index];
  return { name: L.name, visible: L.visible, opacity: L.opacity, snapshot: snapshotLayer(index) };
}

/* History: layer UI callbacks integration */
const __moveLayerUp = moveLayerUp;
moveLayerUp = function(idx) {
  const to = Math.min(layers.length - 1, idx + 1);
  if (idx === to) return;
  __moveLayerUp(idx);
  recordLayerMove(idx, to);
};

const __moveLayerDown = moveLayerDown;
moveLayerDown = function(idx) {
  const to = Math.max(0, idx - 1);
  if (idx === to) return;
  __moveLayerDown(idx);
  recordLayerMove(idx, to);
};

const __removeActiveLayer = removeActiveLayer;
removeActiveLayer = function() {
  if (layers.length <= 1) { __removeActiveLayer(); return; }
  const idx = activeLayerIndex;
  const removed = captureLayerDataForRemoval(idx);
  __removeActiveLayer();
  recordRemoveLayer(idx, removed);
};

const __addLayer = addLayer;
addLayer = function(name = `Layer ${layers.length+1}`, insertBelowIndex = activeLayerIndex) {
  __addLayer(name, insertBelowIndex);
  recordAddLayer(activeLayerIndex);
};

/* History: rebuildLayersUI integration */
const __rebuildLayersUI = rebuildLayersUI;
rebuildLayersUI = function() {
  __rebuildLayersUI();
  try {
    const list = document.getElementById("layersList");
    if (!list) return;

    list.querySelectorAll(".layer-item").forEach((row) => {
      const idx = Number(row.getAttribute("data-index"));
      const visBtn = row.querySelector(".layer-vis button.bs.icon-btn");
      if (visBtn && !visBtn.__hp_vis_hist_patched) {
        visBtn.__hp_vis_hist_patched = true;
        const originalHandler = visBtn.onclick;
        visBtn.onclick = (e) => {
          const prev = layers[idx].visible;
          originalHandler?.(e);
          const next = layers[idx].visible;
          if (prev !== next) recordLayerVisibilityChange(idx, prev, next);
        };
      }
      const opRange = row.querySelector(".layer-opacity input[type='range']");
      if (opRange && !opRange.__hp_op_hist_patched) {
        opRange.__hp_op_hist_patched = true;
        let lastVal = layers[idx].opacity;
        opRange.addEventListener("change", () => {
          const next = layers[idx].opacity;
          if (lastVal !== next) {
            recordLayerOpacityChange(idx, lastVal, next);
            lastVal = next;
          }
        });
      }
      const nameInput = row.querySelector(".layer-name input");
      if (nameInput && !nameInput.__hp_name_hist_patched) {
        nameInput.__hp_name_hist_patched = true;
        let last = layers[idx].name;
        nameInput.addEventListener("blur", () => {
          const next = layers[idx].name;
          if (last !== next) { recordLayerRename(idx, last, next); last = next; }
        });
        nameInput.addEventListener("change", () => {
          const next = layers[idx].name;
          if (last !== next) { recordLayerRename(idx, last, next); last = next; }
        });
      }
    });
  } catch (e) { console.warn("rebuildLayersUI history patch", e); }
};

/* History: project clear action */
function recordClearProject(beforeAll, afterAll) {
  History.push({ type: "clear_project", beforeAll, afterAll });
}



// Eraser
// --------------
let isErasing = false;

function updateEraserSliderVisibility() {
    const eraseSlider = document.getElementById("eraseStrengthSlider");
    if (eraseSlider) {
        eraseSlider.style.display = isErasing ? "block" : "none";
    }
}

function toggleEraser() {
    isErasing = !isErasing;

    updateEraserSliderVisibility();
    updateEraserButton();

    // Show status message:
    showStatusMessage(isErasing ? "Mode: Erase" : "Mode: Paint", "info");
}

function updateEraserButton() {
    const eraserToggle = document.querySelector("#eraserToggle");
    eraserToggle.innerHTML = isErasing
        ? `<img src="/static/draw/images/icons/eraser.svg" alt="Erase">`
        : `<img src="/static/draw/images/icons/brush.svg" alt="Brush">`;

    needsRedraw = true;
}

document.addEventListener("keydown", (event) => {
    if (isUserTyping()) return;
    if (event.key.toLowerCase() === "e") {
        toggleEraser();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const eraserToggle = document.querySelector("#eraserToggle");
    if (eraserToggle) {
        eraserToggle.addEventListener("click", toggleEraser);
        updateEraserButton();
    }
});


// Listen for keydown events to modify eraser strength
document.addEventListener("keydown", (event) => {
    if (isUserTyping()) return;
  if (event.key === ",") {
    // Decrease eraser strength by a small step (e.g. 0.01)
    eraseStrength = Math.max(0, eraseStrength - 0.01);
    updateEraserSliderUI();
  } else if (event.key === ".") {
    // Increase eraser strength by a small step (e.g. 0.01)
    eraseStrength = Math.min(1, eraseStrength + 0.01);
    updateEraserSliderUI();
  }
});


let lineMode = true; // Toggle line interpolation on/off

let lineStepFactor = 0.02; // Smaller values yield more stamps (i.e. more continuous lines)
let lastFx = null,
    lastFy = null; // Store previous fixed‑FBO coordinates


// === COMPLETE REPLACEMENT (pivot-safe, headroom grow, robust shader blit) ===
function drawSingleBrushStamp(fx_doc, fy_doc, sizeOverride = null, angleOverride = null) {
  const L = getActiveLayer();
  if (!L || !gl) return;

  const W = fixedFBOWidth  | 0;
  const H = fixedFBOHeight | 0;

  // ---- Layer rect (document-space box this texture represents) ----
  let texW = Math.max(1, (Number(L.texW) || W) | 0);
  let texH = Math.max(1, (Number(L.texH) || H) | 0);
  let ox   = Number.isFinite(L.ox) ? L.ox : 0;
  let oy   = Number.isFinite(L.oy) ? L.oy : 0;

  // ---- Display transform (we’ll invert to place the stamp in layer-pre doc space) ----
  let px  = Number.isFinite(L.px) ? L.px : (ox + texW * 0.5); // default pivot = current layer center
  let py  = Number.isFinite(L.py) ? L.py : (oy + texH * 0.5);
  const tx  = Number.isFinite(L.x)  ? L.x  : 0;
  const ty  = Number.isFinite(L.y)  ? L.y  : 0;
  const sx  = Number.isFinite(L.scaleX) ? L.scaleX : 1;
  const sy  = Number.isFinite(L.scaleY) ? L.scaleY : 1;
  const rot = Number.isFinite(L.rotation) ? L.rotation : 0;

  const pivotWasImplicit = !Number.isFinite(L.px) || !Number.isFinite(L.py);
  const prevPivotDocX = px;
  const prevPivotDocY = py;

  // ---- Invert display transform: doc → layer-pre (still in document pixel space) ----
  let dx = fx_doc - tx, dy = fy_doc - ty;   // remove translation
  dx -= px; dy -= py;                        // to pivot frame
  const cr = Math.cos(-rot), sr = Math.sin(-rot);
  const rx = dx * cr - dy * sr;              // inverse rotate
  const ry = dx * sr + dy * cr;
  const lx_doc = (sx !== 0 ? rx / sx : rx) + px; // inverse scale → back to layer-pre doc
  const ly_doc = (sy !== 0 ? ry / sy : ry) + py;

  // ---- Map to layer-local (FBO) coords ----
  let cx = lx_doc - ox;
  let cy = ly_doc - oy;

  // ---- Brush quad in layer-local pixels (for bounds & rendering) ----
  const brushW = (sizeOverride ?? brushSize) * W; // size in document px
  const brushH = brushW / brushAspect;
  const halfW  = brushW * 0.5;
  const halfH  = brushH * 0.5;

  const ang = angleOverride ?? currentAngle;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rot2 = (x,y)=>({ x: x*ca - y*sa, y: x*sa + y*ca });

  let o0 = rot2(-halfW, -halfH);
  let o1 = rot2( halfW, -halfH);
  let o2 = rot2(-halfW,  halfH);
  let o3 = rot2( halfW,  halfH);

  let v0x = cx + o0.x, v0y = cy + o0.y;
  let v1x = cx + o1.x, v1y = cy + o1.y;
  let v2x = cx + o2.x, v2y = cy + o2.y;
  let v3x = cx + o3.x, v3y = cy + o3.y;

  // ---- AABB of this stamp in current texture space ----
  let minX = Math.min(v0x, v1x, v2x, v3x);
  let minY = Math.min(v0y, v1y, v2y, v3y);
  let maxX = Math.max(v0x, v1x, v2x, v3x);
  let maxY = Math.max(v0y, v1y, v2y, v3y);

  // Grow policy: if overflow, grow with PAD and HEADROOM to avoid repeated reallocs
  const PAD = 4;
  const HEADROOM = 1.5; // grow 1.5× beyond exactly needed space

  const needGrowLeft   = minX < 0;
  const needGrowTop    = minY < 0;
  const needGrowRight  = maxX > texW;
  const needGrowBottom = maxY > texH;

  if (needGrowLeft || needGrowTop || needGrowRight || needGrowBottom) {
    const needL = needGrowLeft   ? Math.ceil(-minX)     : 0;
    const needT = needGrowTop    ? Math.ceil(-minY)     : 0;
    const needR = needGrowRight  ? Math.ceil(maxX-texW) : 0;
    const needB = needGrowBottom ? Math.ceil(maxY-texH) : 0;

    const addLeft   = needL ? Math.ceil((needL + PAD) * HEADROOM) : 0;
    const addTop    = needT ? Math.ceil((needT + PAD) * HEADROOM) : 0;
    const addRight  = needR ? Math.ceil((needR + PAD) * HEADROOM) : 0;
    const addBottom = needB ? Math.ceil((needB + PAD) * HEADROOM) : 0;

    const newW = texW + addLeft + addRight;
    const newH = texH + addTop  + addBottom;

    // --- Create enlarged texture & FBO (destination) ---
    const newTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, newTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, newW, newH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const newFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, newFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, newTex, 0);

    // Clear new target to transparent
    gl.viewport(0, 0, newW, newH);
    gl.disable(gl.BLEND);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // --- Shader blit: old texture -> new FBO at (addLeft, addTop) ---
    gl.useProgram(quadProgram);
    const uTex     = gl.getUniformLocation(quadProgram, "u_texture") || gl.getUniformLocation(quadProgram, "u_image");
    const uFlipY   = gl.getUniformLocation(quadProgram, "u_flipY");
    const uRes     = gl.getUniformLocation(quadProgram, "u_resolution");
    const uOpacity = gl.getUniformLocation(quadProgram, "u_layerOpacity");

    if (uFlipY)   gl.uniform1f(uFlipY,  1.0);                // FBO top-left convention
    if (uRes)     gl.uniform2f(uRes,    newW, newH);
    if (uOpacity) gl.uniform1f(uOpacity, 1.0);

    // quad covering old rect at offset (addLeft, addTop)
    const blitVerts = new Float32Array([
      // x, y,                    u, v
      addLeft,          addTop,           0, 0,
      addLeft + texW,   addTop,           1, 0,
      addLeft,          addTop + texH,    0, 1,

      addLeft,          addTop + texH,    0, 1,
      addLeft + texW,   addTop,           1, 0,
      addLeft + texW,   addTop + texH,    1, 1
    ]);
    const blitVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, blitVbo);
    gl.bufferData(gl.ARRAY_BUFFER, blitVerts, gl.STREAM_DRAW);

    const aPos = gl.getAttribLocation(quadProgram, "a_position");
    const aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, L.texture);
    if (uTex) gl.uniform1i(uTex, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Cleanup blit VBO
    gl.disableVertexAttribArray(aPos);
    gl.disableVertexAttribArray(aUV);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.deleteBuffer(blitVbo);

    // --- Swap in the new resources ---
    const oldTex = L.texture;
    const oldFbo = L.fbo;
    L.texture = newTex;
    L.fbo     = newFbo;

    // Update rect & offsets (local origin shifted by addLeft/addTop)
    L.texW = texW = newW;
    L.texH = texH = newH;
    L.ox   = ox   = ox - addLeft;
    L.oy   = oy   = oy - addTop;

    // Freeze pivot if it was implicit (prevents visual jump)
    if (pivotWasImplicit) { L.px = prevPivotDocX; L.py = prevPivotDocY; px = L.px; py = L.py; }

    // Shift current stamp & its quad by same offset so we still hit the same doc point
    cx += addLeft;  cy += addTop;
    v0x += addLeft; v1x += addLeft; v2x += addLeft; v3x += addLeft;
    v0y += addTop;  v1y += addTop;  v2y += addTop;  v3y += addTop;

    // Dispose old GPU objects AFTER blit
    gl.deleteFramebuffer(oldFbo);
    gl.deleteTexture(oldTex);
  }

  // ---- Paint into the (possibly enlarged) FBO ----
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.viewport(0, 0, texW, texH);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  gl.useProgram(paintProgram);
  gl.enable(gl.BLEND);
  if (isErasing) gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  else           gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // uniforms
  const uFlipY2 = gl.getUniformLocation(paintProgram, "u_flipY");
  if (uFlipY2) gl.uniform1f(uFlipY2, 1.0);
  const uRes2 = gl.getUniformLocation(paintProgram, "u_resolution");
  if (uRes2) gl.uniform2f(uRes2, texW, texH);
  const uErase = gl.getUniformLocation(paintProgram, "u_erase");
  if (uErase) gl.uniform1i(uErase, isErasing ? 1 : 0);
  const uEraseStr = gl.getUniformLocation(paintProgram, "u_eraseStrength");
  if (uEraseStr) gl.uniform1f(uEraseStr, eraseStrength);
  const uPaintStr = gl.getUniformLocation(paintProgram, "u_paintStrength");
  if (uPaintStr) gl.uniform1f(uPaintStr, paintStrength);
  const uTint = gl.getUniformLocation(paintProgram, "u_tint");
  if (uTint) gl.uniform4fv(uTint, tintColor);

  // brush sampler (both names supported)
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
  const loc0 = gl.getUniformLocation(paintProgram, "u_brushTex");
  const loc1 = gl.getUniformLocation(paintProgram, "u_brush");
  if (loc0) gl.uniform1i(loc0, 0);
  if (loc1) gl.uniform1i(loc1, 0);

  // geometry (pos.xy, uv.xy) using (v0..v3)
  const verts = new Float32Array([
    v0x, v0y, 0, 0,  v1x, v1y, 1, 0,  v2x, v2y, 0, 1,
    v2x, v2y, 0, 1,  v1x, v1y, 1, 0,  v3x, v3y, 1, 1
  ]);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  const aPos2 = gl.getAttribLocation(paintProgram, "a_position");
  const aUV2  = gl.getAttribLocation(paintProgram, "a_texCoord");
  gl.enableVertexAttribArray(aPos2);
  gl.vertexAttribPointer(aPos2, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV2);
  gl.vertexAttribPointer(aUV2, 2, gl.FLOAT, false, 16, 8);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(aPos2);
  gl.disableVertexAttribArray(aUV2);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(vbo);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  needsRedraw = true;
  requestDrawIfIdle?.();
}






// --- COMPLETE REPLACEMENT ---
// Draw stroke into ACTIVE layer but keep the brush exactly under the pointer.
// Converts the pointer from document coords → layer-pre coords by inverting
// the layer’s transform (x,y,scale,rotation around pivot). Updates spacing
// and last* state in that same pre-transform space to keep strokes continuous.

function drawBrushStrokeToPaintLayer(x, y) {
  if (!canPaint()) return;
  if (!gl || !layers.length || !overlayTexture || !getActiveLayer()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;

  // Canvas → document
  const fx = x * (fixedFBOWidth  / canvas.width);
  const fy = y * (fixedFBOHeight / canvas.height);

  const L = getActiveLayer();

  // dynamics preserved
  let sizeMul = 1.0;
  if (typeof dynamicModeEnabled !== "undefined" && dynamicModeEnabled) {
    sizeMul = (typeof intuitiveMode !== "undefined" && intuitiveMode)
      ? (0.8 + Math.random() * 0.8)
      : (1.5 - Math.random());
  }

  if (window.__stampCarry === undefined) window.__stampCarry = 0;
  if (window.__angleEMA   === undefined) window.__angleEMA   = null;
  if (!L.__lastDoc) L.__lastDoc = null;

  if (!L.__lastDoc) {
    let ang0 = currentAngle;
    if (typeof reverseModeEnabled !== "undefined" && reverseModeEnabled) ang0 += Math.PI;
    drawSingleBrushStamp(fx, fy, brushSize * sizeMul, ang0);
    L.__lastDoc = { x: fx, y: fy };
    lastFx = fx; lastFy = fy; lastX = x; lastY = y;
    needsRedraw = true;
    strokeCount++;
    if (typeof FLATTEN_THRESHOLD !== "undefined" && strokeCount >= FLATTEN_THRESHOLD) {
      flattenStrokes?.();
    }
    return;
  }

  const dx = fx - L.__lastDoc.x;
  const dy = fy - L.__lastDoc.y;
  const segDist = Math.hypot(dx, dy);

  let theta = Math.atan2(dy, dx);
  if (window.__angleEMA == null) window.__angleEMA = theta;
  else {
    const ALPHA = 0.35;
    let a0 = window.__angleEMA, a1 = theta;
    while (a1 - a0 >  Math.PI) a1 -= 2*Math.PI;
    while (a1 - a0 < -Math.PI) a1 += 2*Math.PI;
    window.__angleEMA = a0 + (a1 - a0) * ALPHA;
    theta = window.__angleEMA;
  }
  if (typeof reverseModeEnabled !== "undefined" && reverseModeEnabled) theta += Math.PI;

  const baseBrushW = Math.max(1, brushSize * fixedFBOWidth);
  const denom = Math.max(1e-6, baseBrushW * 0.3);
  const speedFactor = Math.min(2.5, segDist / denom);
  const dynSize = brushSize * speedFactor * sizeMul;

  let step = baseBrushW * (typeof lineStepFactor !== "undefined" ? lineStepFactor : 0.3)
           * speedFactor * sizeMul;
  step = Math.max(0.5, step);

  let s = Math.max(0, step - window.__stampCarry);

  if (!lineMode) {
    drawSingleBrushStamp(fx, fy, dynSize, theta);
    window.__stampCarry = (step - (segDist % step)) % step;
  } else {
    while (s <= segDist) {
      const t = s / segDist;
      const ix = L.__lastDoc.x + dx * t;
      const iy = L.__lastDoc.y + dy * t;
      drawSingleBrushStamp(ix, iy, dynSize, theta);
      s += step;
    }
    window.__stampCarry = s - segDist;
  }

  L.__lastDoc = { x: fx, y: fy };
  lastFx = fx; lastFy = fy; lastX = x; lastY = y;

  strokeCount++;
  if (typeof FLATTEN_THRESHOLD !== "undefined" && strokeCount >= FLATTEN_THRESHOLD) {
    flattenStrokes?.();
  }
  needsRedraw = true;
}









function drawBrushStrokeToPaintLayer(x, y) {
  // 1) gates & clamps
  if (!canPaint()) return;
  if (!gl || !layers.length || !overlayTexture || !getActiveLayer()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;

  // 2) canvas → fixed FBO coords (where we actually paint)
  const scaleX = fixedFBOWidth  / canvas.width;
  const scaleY = fixedFBOHeight / canvas.height;
  const fx = x * scaleX;
  const fy = y * scaleY;

  // --- persistent, precise spacing reservoir (kept across calls) ---
  // (attached to window so we don’t rely on hoisting above)
  if (window.__stampCarry === undefined) window.__stampCarry = 0; // leftover distance from last segment
  if (window.__angleEMA   === undefined) window.__angleEMA   = null;

  // 3) first point bootstrap: just stamp once and prime state
  if (lastFx === null || lastFy === null) {
    // compute current size once (keeps your dynamic flag)
    let sizeMultiplier = 1.0;
    if (dynamicModeEnabled) {
      sizeMultiplier = intuitiveMode
        ? (0.8 + Math.random() * 0.8) // 0.8–1.6
        : (1.5 - Math.random());      // 0.5–1.5
    }

    // angle init (no previous -> keep currentAngle unchanged)
    let angle = currentAngle;
    if (reverseModeEnabled) angle += Math.PI;

    drawSingleBrushStamp(fx, fy, brushSize * sizeMultiplier, angle);
    lastFx = fx; lastFy = fy;
    lastX  = x;  lastY  = y;
    needsRedraw = true;

    strokeCount++;
    if (strokeCount >= FLATTEN_THRESHOLD) flattenStrokes();
    return;
  }

  // 4) deltas & distance in FBO space (precision!)
  const dxF = fx - lastFx;
  const dyF = fy - lastFy;
  const segDist = Math.hypot(dxF, dyF);
  if (segDist <= 1e-6) return; // nothing to do

  // 5) stroke direction angle (FBO space) + gentle smoothing
  //    use vector smoothing to avoid wrap issues, then atan2
  const rawAngle = Math.atan2(dyF, dxF);
  if (window.__angleEMA === null) {
    window.__angleEMA = rawAngle;
  } else {
    // smooth via blending unit vectors; keeps wrap correct
    const a0 = window.__angleEMA;
    const v0x = Math.cos(a0), v0y = Math.sin(a0);
    const v1x = Math.cos(rawAngle), v1y = Math.sin(rawAngle);
    const alpha = 0.25; // smaller = smoother
    const vx = (1 - alpha) * v0x + alpha * v1x;
    const vy = (1 - alpha) * v0y + alpha * v1y;
    window.__angleEMA = Math.atan2(vy, vx);
  }
  let actualAngle = window.__angleEMA;
  if (reverseModeEnabled) actualAngle += Math.PI;

  // 6) dynamic size modulation (same behavior you had)
  let sizeMultiplier = 1.0;
  if (dynamicModeEnabled) {
    sizeMultiplier = intuitiveMode
      ? (0.8 + Math.random() * 0.8) // 0.8–1.6
      : (1.5 - Math.random());      // 0.5–1.5
  }

  // 7) compute precise, even spacing in *FBO* units
  //    base spacing from brush width and your lineStepFactor
  const baseBrushW = Math.max(1, brushSize * fixedFBOWidth);
  const denom = Math.max(1e-6, baseBrushW * 0.3);
  const speedFactor = Math.min(2.5, segDist / denom); // keep your speed-driven feel
  const dynamicBrushSize = brushSize * speedFactor * sizeMultiplier;

  // desired step between stamps
  let step = baseBrushW * lineStepFactor * speedFactor * sizeMultiplier;
  step = Math.max(0.5, step); // safety lower bound (subpixel ok)

  // 8) exact, carry-aware interpolation (no gaps/blobs)
  // first stamp along this segment occurs at s = step - carry
  let s = Math.max(0, step - window.__stampCarry);

  // if line mode is off, just place one stamp at the end; still update carry
  if (!lineMode) {
    drawSingleBrushStamp(fx, fy, dynamicBrushSize, actualAngle);
    // update carry as if we placed exactly one at the end
    window.__stampCarry = (step - (segDist % step)) % step;
  } else {
    // iterate evenly along the segment
    while (s <= segDist) {
      const t = s / segDist;
      const ix = lastFx + dxF * t;
      const iy = lastFy + dyF * t;
      drawSingleBrushStamp(ix, iy, dynamicBrushSize, actualAngle);
      s += step;
    }
    // whatever exceeded the segment becomes carry for the next segment
    window.__stampCarry = s - segDist;
  }

  // 9) advance cursors (both spaces)
  lastFx = fx; lastFy = fy;
  lastX  = x;  lastY  = y;

  // 10) flatten & redraw
  strokeCount++;
  if (strokeCount >= FLATTEN_THRESHOLD) flattenStrokes();
  needsRedraw = true;
}


function drawBrushOverlay() {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(overlayProgram);

    // When drawing to screen, flip Y.
    let flipLoc = gl.getUniformLocation(overlayProgram, "u_flipY");
    gl.uniform1f(flipLoc, -1.0);
    let resLoc = gl.getUniformLocation(overlayProgram, "u_resolution");
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    let tintLoc = gl.getUniformLocation(overlayProgram, "u_tint");
    gl.uniform4fv(tintLoc, tintColor);

    // Use the same rotation as the last computed currentAngle.
    const posX = overlayPosition[0] * canvas.width;
    const posY = overlayPosition[1] * canvas.height;
    const brushW = brushSize * canvas.width;
    const brushH = brushW / brushAspect;
    const halfW = brushW / 2;
    const halfH = brushH / 2;
    const offsets = [
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: -halfW, y: halfH },
        { x: halfW, y: halfH }
    ];
    const cosA = Math.cos(currentAngle);
    const sinA = Math.sin(currentAngle);

    function rotateOffset(off) {
        return {
            x: off.x * cosA - off.y * sinA,
            y: off.x * sinA + off.y * cosA
        };
    }
    const rotated = offsets.map(rotateOffset);
    const v0 = { x: posX + rotated[0].x, y: posY + rotated[0].y };
    const v1 = { x: posX + rotated[1].x, y: posY + rotated[1].y };
    const v2 = { x: posX + rotated[2].x, y: posY + rotated[2].y };
    const v3 = { x: posX + rotated[3].x, y: posY + rotated[3].y };

    const vertices = new Float32Array([
        v0.x, v0.y, 0, 0,
        v1.x, v1.y, 1, 0,
        v2.x, v2.y, 0, 1,
        v2.x, v2.y, 0, 1,
        v1.x, v1.y, 1, 0,
        v3.x, v3.y, 1, 1
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);

    let posLocOverlay = gl.getAttribLocation(overlayProgram, "a_position");
    gl.enableVertexAttribArray(posLocOverlay);
    gl.vertexAttribPointer(posLocOverlay, 2, gl.FLOAT, false, 16, 0);
    let texLocOverlay = gl.getAttribLocation(overlayProgram, "a_texCoord");
    gl.enableVertexAttribArray(texLocOverlay);
    gl.vertexAttribPointer(texLocOverlay, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    const brushUniform = gl.getUniformLocation(overlayProgram, "u_brush");
    gl.uniform1i(brushUniform, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.deleteBuffer(buffer);
    gl.disableVertexAttribArray(posLocOverlay);
    gl.disableVertexAttribArray(texLocOverlay);
}






// === NEW: guard to detect off-canvas clipping before baking ===
function activeLayerWouldClip() {
  const L = getActiveLayer?.(); if (!L) return false;
  const W = fixedFBOWidth, H = fixedFBOHeight;

  const pivX = Number.isFinite(L.px) ? L.px : W * 0.5;
  const pivY = Number.isFinite(L.py) ? L.py : H * 0.5;
  const c = Math.cos(L.rotation || 0), s = Math.sin(L.rotation || 0);

  function tf(x, y) {
    let dx = x - pivX, dy = y - pivY;
    dx *= Number.isFinite(L.scaleX) ? L.scaleX : 1;
    dy *= Number.isFinite(L.scaleY) ? L.scaleY : 1;
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    return {
      x: pivX + rx + (Number.isFinite(L.x) ? L.x : 0),
      y: pivY + ry + (Number.isFinite(L.y) ? L.y : 0)
    };
  }

  const pts = [tf(0,0), tf(W,0), tf(0,H), tf(W,H)];
  return pts.some(p => p.x < 0 || p.y < 0 || p.x > W || p.y > H);
}



/* applyActiveLayerTransform()
   Purpose: bake the active layer’s current transform (x/y/scale/rotation around pivot) into its pixels.
   Pipeline:
   1) Render the layer’s texture with its current transform into a temporary full-document FBO.
   2) Copy the result BACK into the layer’s texture/FBO (so WebGL handles remain consistent).
   3) Reset the layer’s transform to a neutral pose (since transform is now baked into pixels).
   Notes:
   - Full document FBO prevents cropping of oversized layers.
   - Using u_flipY = 1.0 matches document FBO orientation to avoid Y inversions.
   Drop-in replacement. */
function applyActiveLayerTransform() {
  const L = getActiveLayer?.();
  if (!gl || !L || !L.texture || !quadProgram) return;

  const Wdoc = fixedFBOWidth | 0;
  const Hdoc = fixedFBOHeight | 0;

  // Preserve GL state
  const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevViewport = gl.getParameter(gl.VIEWPORT);

  // Temporary document-sized target
  const tmpTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tmpTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Wdoc, Hdoc, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const tmpFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tmpTex, 0);

  gl.viewport(0, 0, Wdoc, Hdoc);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Source rect in document px
  const Lx = Number.isFinite(L.ox) ? L.ox : 0;
  const Ly = Number.isFinite(L.oy) ? L.oy : 0;
  const Lw = Math.max(1, Number.isFinite(L.texW) ? L.texW : Wdoc);
  const Lh = Math.max(1, Number.isFinite(L.texH) ? L.texH : Hdoc);

  // Transform parameters
  const scx = Number.isFinite(L.scaleX) ? L.scaleX : 1;
  const scy = Number.isFinite(L.scaleY) ? L.scaleY : 1;
  const rot = Number.isFinite(L.rotation) ? L.rotation : 0;
  const tx  = Number.isFinite(L.x) ? L.x : 0;
  const ty  = Number.isFinite(L.y) ? L.y : 0;
  const pivX = Number.isFinite(L.px) ? L.px : Wdoc * 0.5;
  const pivY = Number.isFinite(L.py) ? L.py : Hdoc * 0.5;

  const c = Math.cos(rot), s = Math.sin(rot);
  function tf(x, y) {
    let dx = (x - pivX) * scx, dy = (y - pivY) * scy;
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return { x: pivX + rx + tx, y: pivY + ry + ty };
  }

  const p0 = tf(Lx,      Ly);
  const p1 = tf(Lx + Lw, Ly);
  const p2 = tf(Lx,      Ly + Lh);
  const p3 = tf(Lx + Lw, Ly + Lh);

  // Draw transformed quad into tmpFBO
  gl.useProgram(quadProgram);
  const uTex      = gl.getUniformLocation(quadProgram, "u_texture");
  const uRes      = gl.getUniformLocation(quadProgram, "u_resolution");
  const uFlipY    = gl.getUniformLocation(quadProgram, "u_flipY");
  const uOpacity  = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  if (uRes)     gl.uniform2f(uRes, Wdoc, Hdoc);
  if (uFlipY)   gl.uniform1f(uFlipY, 1.0);      // document FBO orientation
  if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, L.opacity ?? 1)));

  const verts = new Float32Array([
    p0.x, p0.y, 0, 0,
    p1.x, p1.y, 1, 0,
    p2.x, p2.y, 0, 1,
    p2.x, p2.y, 0, 1,
    p1.x, p1.y, 1, 0,
    p3.x, p3.y, 1, 1
  ]);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  const aPos = gl.getAttribLocation(quadProgram, "a_position");
  const aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV ); gl.vertexAttribPointer(aUV , 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, L.texture);
  if (uTex) gl.uniform1i(uTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(aPos);
  gl.disableVertexAttribArray(aUV);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(vbo);

  // Copy tmpFBO → layer texture/FBO so handles remain the same
  gl.bindTexture(gl.TEXTURE_2D, L.texture);
  const needRealloc = ((L.texW | 0) !== Wdoc) || ((L.texH | 0) !== Hdoc);
  if (needRealloc) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Wdoc, Hdoc, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (!L.fbo) L.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, L.texture, 0);
  }
  // Read back tmp and upload into the layer texture (keeps orientation consistent)
  const pixels = new Uint8Array(Wdoc * Hdoc * 4);
  gl.readPixels(0, 0, Wdoc, Hdoc, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindTexture(gl.TEXTURE_2D, L.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Wdoc, Hdoc, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Reset transform because it is now baked into the pixels
  L.ox = 0; L.oy = 0; L.texW = Wdoc; L.texH = Hdoc;
  L.x = 0; L.y = 0; L.scaleX = 1; L.scaleY = 1; L.rotation = 0;
  L.px = Wdoc * 0.5; L.py = Hdoc * 0.5;

  // Restore GL state
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.useProgram(prevProg);
  if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
  try { gl.deleteFramebuffer(tmpFBO); } catch {}
  try { gl.deleteTexture(tmpTex); } catch {}

  needsRedraw = true;
  if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
}





// --- Transform & layer hotkeys: G/S/R, H, ↑/↓, Esc, Enter, T, Shift+D (duplicate) ---
document.addEventListener("keydown", (e) => {
  if (typeof isUserTyping === "function" && isUserTyping()) return;

  // Don’t start actions while space-panning or drawing
  if (typeof spacePanning !== "undefined" && spacePanning) return;
  if (typeof isDrawing !== "undefined" && isDrawing) return;

  // Ignore system/browser combos and Alt-based combos
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const k = e.key;
  const lower = k.toLowerCase();
  const isArrow =
    k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight";
  const DEG = Math.PI / 180;

  // ——— helper: reorder layers in the model + keep active index sane ———
  function reorderInModel(from, to) {
    if (!Array.isArray(layers) || layers.length === 0) return;
    from = Math.max(0, Math.min(layers.length - 1, from | 0));
    to   = Math.max(0, Math.min(layers.length - 1, to   | 0));
    if (from === to) return;

    const moved = layers.splice(from, 1)[0];
    layers.splice(to, 0, moved);

    // fix activeLayerIndex
    const cur = Number.isInteger(activeLayerIndex) ? activeLayerIndex : 0;
    if (cur === from) {
      activeLayerIndex = to;
    } else if (from < cur && cur <= to) {
      activeLayerIndex = cur - 1;
    } else if (to <= cur && cur < from) {
      activeLayerIndex = cur + 1;
    }

    try { recordLayerReorder?.(from, to); } catch {}
    try { rebuildLayersUI?.(); } catch {}
    try { syncActiveAliases?.(); } catch {}

    needsRedraw = true;
    if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
  }

  // ===== Shift + D : duplicate active layer and start grab =====
  if (e.shiftKey && lower === "d") {
    e.preventDefault();
    e.stopImmediatePropagation();

    // duplicate
    const before = Array.isArray(layers) ? layers.length : 0;
    try {
      if (typeof duplicateLayer === "function") {
        duplicateLayer(typeof activeLayerIndex === "number" ? activeLayerIndex : undefined);
      }
    } catch {}

    const after = Array.isArray(layers) ? layers.length : 0;

    // if duplication succeeded, nudge the clone and arm grab so it follows the pointer
    if (after > before) {
      try {
        const L = (typeof getActiveLayer === "function")
          ? getActiveLayer()
          : (layers && layers[activeLayerIndex] ? layers[activeLayerIndex] : null);
        if (L) {
          L.x = (Number.isFinite(L.x) ? L.x : 0) + 10;
          L.y = (Number.isFinite(L.y) ? L.y : 0) + 10;
          if (typeof startTransform === "function") startTransform("grab");
        }
      } catch {}

      try { rebuildLayersUI?.(); } catch {}
      try { showStatusMessage?.("Layer duplicated (Shift+D)", "success"); } catch {}
      needsRedraw = true;
      if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    }
    return;
  }

  // ===== Desktop-only: nudge current transform with Arrow keys =====
  if (typeof isMobile === "function" && !isMobile() && transformTool?.mode !== "idle" && isArrow) {
    e.preventDefault();
    e.stopImmediatePropagation();

    const L = typeof getActiveLayer === "function" ? getActiveLayer() : null;
    if (!L) return;

    // Ensure sane numeric bases
    if (!Number.isFinite(L.x)) L.x = 0;
    if (!Number.isFinite(L.y)) L.y = 0;
    if (!Number.isFinite(L.scaleX)) L.scaleX = 1;
    if (!Number.isFinite(L.scaleY)) L.scaleY = 1;
    if (!Number.isFinite(L.rotation)) L.rotation = 0;

    const mode = transformTool.mode;

    if (mode === "grab") {
      // Position nudge (px)
      const step = e.shiftKey ? 10 : 1;
      if (k === "ArrowLeft")  L.x -= step;
      if (k === "ArrowRight") L.x += step;
      if (k === "ArrowUp")    L.y -= step;
      if (k === "ArrowDown")  L.y += step;
    } else if (mode === "scale") {
      // Scale nudge
      const step = e.shiftKey ? 0.10 : 0.01; // 10% or 1%
      const applyUniform = e.shiftKey;

      // Helper to clamp scale to a tiny positive minimum
      const clamp = (v) => Math.max(0.001, v);

      if (applyUniform) {
        // Any arrow uniformly scales both axes
        const dir =
          (k === "ArrowRight" || k === "ArrowUp") ? +1 :
          (k === "ArrowLeft"  || k === "ArrowDown") ? -1 : 0;
        if (dir !== 0) {
          const mul = 1 + dir * step;
          L.scaleX = clamp(L.scaleX * mul);
          L.scaleY = clamp(L.scaleY * mul);
        }
      } else {
        // Per-axis scaling
        if (k === "ArrowLeft") {
          L.scaleX = clamp(L.scaleX * (1 - step));
        } else if (k === "ArrowRight") {
          L.scaleX = clamp(L.scaleX * (1 + step));
        } else if (k === "ArrowUp") {
          L.scaleY = clamp(L.scaleY * (1 + step));
        } else if (k === "ArrowDown") {
          L.scaleY = clamp(L.scaleY * (1 - step));
        }
      }
    } else if (mode === "rotate") {
      // Rotation nudge (degrees -> radians)
      const degStep = e.shiftKey ? 5 : 1;
      const sign =
        (k === "ArrowRight" || k === "ArrowDown") ? +1 :
        (k === "ArrowLeft"  || k === "ArrowUp")   ? -1 : 0;
      L.rotation += sign * degStep * DEG;
    } else {
      // Fallback: treat like grab for any other custom mode
      const step = e.shiftKey ? 10 : 1;
      if (k === "ArrowLeft")  L.x -= step;
      if (k === "ArrowRight") L.x += step;
      if (k === "ArrowUp")    L.y -= step;
      if (k === "ArrowDown")  L.y += step;
    }

    try { startRender?.("transform"); } catch {}
    needsRedraw = true;
    if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    return;
  }

  // ===== Desktop-only: Shift + ArrowUp/ArrowDown reorders layers (IDLE only) =====
  if (typeof isMobile === "function"
      && !isMobile()
      && transformTool?.mode === "idle"
      && e.shiftKey
      && (k === "ArrowUp" || k === "ArrowDown")) {

    e.preventDefault();
    e.stopImmediatePropagation();

    if (!layers || !layers.length) return;

    const cur = Number.isInteger(activeLayerIndex) ? activeLayerIndex : 0;
    const delta = (k === "ArrowUp") ? +1 : -1; // higher index = visually above
    const to = Math.max(0, Math.min(layers.length - 1, cur + delta));
    if (to === cur) return;

    const name = layers[cur]?.name ?? "";
    reorderInModel(cur, to);
    try { showStatusMessage?.(`Moved ${name || "layer"} ${delta > 0 ? "up" : "down"}`, "info"); } catch {}
    return;
  }

  // ===== Desktop-only: layer selection with ArrowUp/ArrowDown when NOT transforming =====
  if (typeof isMobile === "function"
      && !isMobile()
      && transformTool?.mode === "idle"
      && !e.shiftKey
      && (k === "ArrowUp" || k === "ArrowDown")) {

    e.preventDefault();
    e.stopImmediatePropagation();

    if (!layers || !layers.length) return;

    // Defensive: clear any stray transform state
    try { if (transformTool?.mode !== "idle") endTransform(false); } catch {}
    try { clearTransformLockAll?.(); } catch {}

    // UI order note: higher index is visually above
    const delta = (k === "ArrowUp") ? +1 : -1;
    const next = Math.max(0, Math.min(layers.length - 1, activeLayerIndex + delta));
    if (next !== activeLayerIndex) {
      activeLayerIndex = next;
      try { syncActiveAliases?.(); } catch {}
      try { rebuildLayersUI?.(); } catch {}
      try { showStatusMessage?.(`Selected: ${layers[activeLayerIndex].name}`, "info"); } catch {}
      needsRedraw = true;
      if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    }
    return;
  }

  // H: toggle visibility of active layer
  if (lower === "h") {
    e.preventDefault();
    e.stopImmediatePropagation();

    const idx = activeLayerIndex;
    const L = layers?.[idx];
    if (!L) return;

    const prev = !!L.visible;
    const next = !prev;
    L.visible = next;

    try { recordLayerVisibilityChange?.(idx, prev, next); } catch {}
    try { rebuildLayersUI?.(); } catch {}
    try { showStatusMessage?.(next ? "Layer visible" : "Layer hidden", "info"); } catch {}

    needsRedraw = true;
    if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    return;
  }

  // G: grab (move)
  if (lower === "g") {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typeof startTransform === "function") startTransform("grab");
    return;
  }

  // S: scale (Shift+S = invert flag passthrough)
  if (lower === "s") {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typeof startTransform === "function") startTransform("scale", e.shiftKey);
    return;
  }

  // R: rotate (Shift+R = opposite flag passthrough)
  if (lower === "r") {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typeof startTransform === "function") startTransform("rotate", e.shiftKey);
    return;
  }

  // Esc: cancel (revert to ref, do NOT bake)
  if (k === "Escape" && transformTool?.mode !== "idle") {
    const L = typeof getActiveLayer === "function" ? getActiveLayer() : null;
    if (L && transformTool.ref) {
      L.x = transformTool.ref.x;
      L.y = transformTool.ref.y;
      L.scaleX = transformTool.ref.scaleX;
      L.scaleY = transformTool.ref.scaleY;
      L.rotation = transformTool.ref.rotation;
    }
    if (typeof endTransform === "function") endTransform(false);
    needsRedraw = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // Enter/Return: confirm transform (bake)
  if ((k === "Enter" || k === "Return") && transformTool?.mode !== "idle") {
    if (typeof endTransform === "function") endTransform();
    needsRedraw = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // T: reset transform on active layer
  if (lower === "t") {
    e.preventDefault();
    e.stopImmediatePropagation();

    const L = typeof getActiveLayer === "function" ? getActiveLayer() : null;
    if (!L) return;

    L.x = 0; L.y = 0; L.scaleX = 1; L.scaleY = 1; L.rotation = 0;

    try { showStatusMessage?.("Layer transform reset", "info"); } catch {}
    needsRedraw = true;
    if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    return;
  }

  // Merge: Ctrl/Cmd+E (common in editors) — preserved, but only when modifiers present
  // (This block won't run here since ctrl/meta was filtered above; keep your original if needed elsewhere)
}, { capture: true });









function drawScene() {
  if (!gl || !quadProgram || !canvas) return;

  // detect touch/mobile once per frame (cheap)
  const isTouchEnv = (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
                     (typeof window !== "undefined" && "ontouchstart" in window);

  // reset default framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // —— helper to draw textured quad from provided vertices ——
  function drawTexturedQuadWithVertices(program, tex, vertices, layerOpacity) {
    if (!program || !tex || !gl.isTexture(tex)) return;

    gl.useProgram(program);

    const uFlipY = gl.getUniformLocation(program, "u_flipY");
    if (uFlipY) gl.uniform1f(uFlipY, -1.0);

    const uRes = gl.getUniformLocation(program, "u_resolution");
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);

    const uLayerOpacity = gl.getUniformLocation(program, "u_layerOpacity");
    if (uLayerOpacity) gl.uniform1f(uLayerOpacity, layerOpacity != null ? layerOpacity : 1.0);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    const texLoc = gl.getAttribLocation(program, "a_texCoord");
    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    }
    if (texLoc >= 0) {
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const uTex =
      gl.getUniformLocation(program, "u_texture") ??
      gl.getUniformLocation(program, "u_brush");
    if (uTex) gl.uniform1i(uTex, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (posLoc >= 0) gl.disableVertexAttribArray(posLoc);
    if (texLoc >= 0) gl.disableVertexAttribArray(texLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.deleteBuffer(buffer);
  }

  // 1) Background image
  if (texture && gl.isTexture(texture)) {
    const full = new Float32Array([
      0, 0, 0, 0,
      canvas.width, 0, 1, 0,
      0, canvas.height, 0, 1,

      0, canvas.height, 0, 1,
      canvas.width, 0, 1, 0,
      canvas.width, canvas.height, 1, 1
    ]);
    gl.disable(gl.BLEND);
    drawTexturedQuadWithVertices(quadProgram, texture, full, 1.0);
  }

  // 2) Paint layers (with per-layer transform + opacity)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  if (Array.isArray(layers)) {
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      if (!L || !L.visible || L.opacity <= 0) continue;
      if (!L.texture || !gl.isTexture(L.texture)) continue;
      drawLayerWithTransform(quadProgram, L);
    }
  }
  gl.disable(gl.BLEND);

  // 3) Brush overlay + desktop transform ring/tether
  const isTransforming = !!(transformTool && transformTool.mode !== "idle");
  const overlayActive  = isDrawing || isTransforming || brushHUD.visible;

  // ring/tether are desktop-only:
  const ringActive = isTransforming && !isTouchEnv;

  if (overlayActive &&
      overlayProgram &&
      overlayTexture &&
      gl.isTexture(overlayTexture) &&
      typeof drawBrushOverlay === "function") {

    gl.useProgram(overlayProgram);
    const uFlipY = gl.getUniformLocation(overlayProgram, "u_flipY");
    if (uFlipY) gl.uniform1f(uFlipY, -1.0);
    const uRes = gl.getUniformLocation(overlayProgram, "u_resolution");
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);

    drawBrushOverlay();

    if (ringActive) {
      const posX = overlayPosition[0] * canvas.width;
      const posY = overlayPosition[1] * canvas.height;
      const brushW = brushSize * canvas.width;
      const radius = brushW * 1.5;
      const thickness = Math.max(1.0, brushW * 0.06);
      if (typeof drawRingOverlay === "function")
        drawRingOverlay(posX, posY, radius, thickness, [1, 0, 0, 0.95]);

      const ax = lastPointer?.cx ?? posX;
      const ay = lastPointer?.cy ?? posY;
      const dashLen = 10.0, gapLen = 6.0, linePx = 1.5;

      if (typeof drawDashedLine === "function")
        drawDashedLine(ax, ay, posX, posY, linePx, dashLen, gapLen, [1, 0, 0, 0.95]);
    }
  }

  // 4) Touch-point visualization — ONLY during transform (any touch env)
  if (isTransforming &&
      typeof touchViz === "object" &&
      touchViz?.visible &&
      Array.isArray(touchViz.pts) &&
      touchViz.pts.length &&
      typeof drawRingOverlay === "function") {

    if (overlayProgram) {
      gl.useProgram(overlayProgram);
      const uFlipY2 = gl.getUniformLocation(overlayProgram, "u_flipY");
      if (uFlipY2) gl.uniform1f(uFlipY2, -1.0);
      const uRes2 = gl.getUniformLocation(overlayProgram, "u_resolution");
      if (uRes2) gl.uniform2f(uRes2, canvas.width, canvas.height);
    }

    const GREEN = [0, 1, 0, 0.95];
    const RADIUS = 20 * (window.devicePixelRatio || 1);;  // px
    const THICK  = 2  * (window.devicePixelRatio || 1);
    const LINE_T = 2;   // px
    const DASH = 10, GAP = 6;

    for (const p of touchViz.pts) {
      drawRingOverlay(p.x, p.y, RADIUS, THICK, GREEN);
    }

    if (touchViz.pts.length === 2 && typeof drawDashedLine === "function") {
      const a = touchViz.pts[0], b = touchViz.pts[1];
      drawDashedLine(a.x, a.y, b.x, b.y, LINE_T, DASH, GAP, GREEN);
    }
  }

  // final cleanup
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.useProgram(null);

  maybeAutoHideBrushHUD();
}




// DYNAMIC DRAWING MODE
//–––––––––––––––––––

let dynamicModeEnabled = false;
let reverseModeEnabled = false;
let intuitiveMode = true; // if false → counter-intuitive

    function showStatusMessage(message, type = "info") {

        console.log("showStatusMessage", message)

        const messageBubble = document.createElement("div");
        messageBubble.classList.add("status-message", type);
        messageBubble.innerText = message;

        document.body.appendChild(messageBubble);

        setTimeout(() => {
            messageBubble.classList.add("fade-out");
            setTimeout(() => messageBubble.remove(), 700);
        }, 700);
    }


document.addEventListener("keydown", (event) => {

    if (isUserTyping()) return;

    // Dynamic mode: D
    // if (event.key.toLowerCase() === "d") {
    //     dynamicModeEnabled = !dynamicModeEnabled;
    //     showStatusMessage(`Dynamic Mode: ${dynamicModeEnabled ? "ON" : "OFF"}`, "info");
    //     needsRedraw = true;
    // }

    // // Reverse mode: Shift+R
    // if (event.shiftKey && event.key.toLowerCase() === "r") {
    //     reverseModeEnabled = !reverseModeEnabled;
    //     showStatusMessage(`Reverse Mode: ${reverseModeEnabled ? "ON" : "OFF"}`, "info");
    //     needsRedraw = true;
    // }

    // // Intuitive mode: Shift+F
    // if (event.shiftKey && event.key.toLowerCase() === "f") {
    //     intuitiveMode = !intuitiveMode;
    //     showStatusMessage(`Mode: ${intuitiveMode ? "Intuitive" : "Counter-Intuitive"}`, "info");
    //     needsRedraw = true;
    // }

    // Eraser: Shift+E
    if (event.shiftKey && event.key.toLowerCase() === "e") {
        isErasing = !isErasing;
        showStatusMessage(isErasing ? "Mode: Erase" : "Mode: Paint", "info");
        needsRedraw = true;
    }

    // Line Mode: Shift+G
    if (event.shiftKey && event.key.toLowerCase() === "g") {
        lineMode = !lineMode;
        showStatusMessage(`Line Mode: ${lineMode ? "ON" : "OFF"}`, "info");
        needsRedraw = true;
    }
});


//–––––––––––––––––––
// FILE LOADER (for background image)
//–––––––––––––––––––

// Add a downscale function that creates a JPEG data URL from a larger image
function downscaleImage(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  if (scale < 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(image.width * scale);
    canvas.height = Math.floor(image.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Use JPEG with quality 0.7 to reduce memory usage
    return canvas.toDataURL("image/jpeg", 0.7);
  }
  return null;
}


/**
 * Downscale an image to fit within the window dimensions.
 * Returns a data URL (JPEG) if downscaling is performed,
 * or null if the image is already within the desired size.
 */
function downscaleImageToWindow(image) {
  const maxWidth = window.innerWidth;
  const maxHeight = window.innerHeight;
  // Calculate the scale factor, ensuring it does not exceed 1.
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  
  if (scale < 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(image.width * scale);
    canvas.height = Math.floor(image.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Return the JPEG data URL with a quality setting of 0.7.
    return canvas.toDataURL("image/jpeg", 0.7);
  }
  
  return null; // No downscaling needed
}


// FILE LOADER (for background image)
//–––––––––––––––––––

imageLoader.addEventListener("change", (event) => {
  
  console.log("[DEBUG] imageLoader change event fired:", event);
  
  const file = event.target.files[0];
  if (file) {
    console.log("[DEBUG] Selected file:", file.name, file.type, file.size);
    const reader = new FileReader();

    reader.onerror = (err) => {
      console.error("[DEBUG] FileReader error:", err);
    };

    reader.onload = (e) => {
      console.log("[DEBUG] FileReader onload triggered. Data length:", e.target.result.length);
      const img = new Image();

      img.onerror = (err) => {
        console.error("[DEBUG] Image load error:", err);
      };

      img.onload = () => {
        console.log("[DEBUG] Image loaded successfully. Dimensions:", img.width, img.height);
        
        // Downscale the image if it's larger than the window
        const downscaledDataUrl = downscaleImageToWindow(img);
        if (downscaledDataUrl) {
          console.log("[DEBUG] Downscaled image to window dimensions.");
          img.src = downscaledDataUrl;
          // Once the downscaled image is loaded, use it:


            img.onload = () => {
              console.log("[DEBUG] Downscaled image loaded. Dimensions:", img.width, img.height);
              currentImage = img;
              fixedFBOWidth = img.width;
              fixedFBOHeight = img.height;

              console.log("[DEBUG] Calling initPaintLayerFixed()");
              initPaintLayerFixed();
              initFloodFillProgram();

              console.log("[DEBUG] Calling updateCanvasSize(currentImage)");
              updateCanvasSize(currentImage);

              console.log("[DEBUG] Calling createTextureFromImage(currentImage)");
              createTextureFromImage(currentImage);

              // ---- force layout, then center (no timers) ----
              void canvas.offsetWidth; 
              void canvasWrapper.offsetWidth;
              zoomScale = 1;
              panX = (canvasWrapper.clientWidth  - canvas.width ) / 2;
              panY = (canvasWrapper.clientHeight - canvas.height) / 2;
              updateCanvasTransform();
              resetStrokeState();
              needsRedraw = true;
              // -----------------------------------------------
            };




            } else {
              console.log("[DEBUG] No downscaling needed.");
              currentImage = img;
              fixedFBOWidth = img.width;
              fixedFBOHeight = img.height;

              console.log("[DEBUG] Calling initPaintLayerFixed()");
              initPaintLayerFixed();
              initFloodFillProgram();

              console.log("[DEBUG] Calling updateCanvasSize(currentImage)");
              updateCanvasSize(currentImage);

              console.log("[DEBUG] Calling createTextureFromImage(currentImage)");
              createTextureFromImage(currentImage);

              // ---- force layout, then center (no timers) ----
              void canvas.offsetWidth;
              void canvasWrapper.offsetWidth;
              zoomScale = 1;
              panX = (canvasWrapper.clientWidth  - canvas.width ) / 2;
              panY = (canvasWrapper.clientHeight - canvas.height) / 2;
              updateCanvasTransform();
              resetStrokeState();
              needsRedraw = true;
              // -----------------------------------------------
            }

      };

      console.log("[DEBUG] Setting image src to FileReader result");
      img.src = e.target.result;
    };


    try {
      reader.readAsDataURL(file);
      console.log("[DEBUG] FileReader readAsDataURL called successfully");
    } catch (ex) {
      console.error("[DEBUG] Exception while reading file:", ex);
    }
  } else {
    console.warn("[DEBUG] No file selected.");
  }
});

// Trigger the file input when clicking or touching the button
const imageLoaderButton = document.getElementById("imageLoaderButton");
imageLoaderButton.addEventListener("click", () => {
  console.log("[DEBUG] imageLoaderButton clicked.");
  document.getElementById("imageLoader").click();
});
imageLoaderButton.addEventListener("touchend", () => {
  console.log("[DEBUG] imageLoaderButton touchend triggered.");
  document.getElementById("imageLoader").click();
});

// On iOS, remove the 'capture' attribute so users can choose from gallery or camera
if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
  console.log("[DEBUG] Detected iOS device – removing capture attribute");
  imageLoader.removeAttribute("capture");
}



// Gallery / Save IndexedDB (Fixed & Optimized)
//–––––––––––––––––––

document.addEventListener("DOMContentLoaded", async () => {

    const DB_NAME = "DrawingAppDB";
    const DB_VERSION = 1;
    const STORE_NAME = "artworks";
    let db;

    // Open IndexedDB
    async function openDatabase() {
        if (db) return db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                let db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id" });
                }
            };
            request.onsuccess = () => resolve((db = request.result));
            request.onerror = () => reject("IndexedDB failed to open");
        });
    }

    // Helper Function: Flip Image Data Vertically
    function flipImageData(imageData) {
        const { width, height, data } = imageData;
        const flippedData = new Uint8ClampedArray(data.length);

        for (let row = 0; row < height; row++) {
            const srcStart = row * width * 4;
            const destStart = (height - row - 1) * width * 4;
            flippedData.set(data.subarray(srcStart, srcStart + width * 4), destStart);
        }

        return new ImageData(flippedData, width, height);
    }


    function drawFullscreenQuad() {
        const quadVertices = new Float32Array([
            -1, -1, 0, 0,
            1, -1, 1, 0,
            -1, 1, 0, 1,
            -1, 1, 0, 1,
            1, -1, 1, 0,
            1, 1, 1, 1
        ]);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(quadProgram, "a_position");
        const texLoc = gl.getAttribLocation(quadProgram, "a_texCoord");

        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.disableVertexAttribArray(posLoc);
        gl.disableVertexAttribArray(texLoc);
        gl.deleteBuffer(buffer);
    }






// =======================
// SAVE to IndexedDB (full)
// =======================
async function saveArtwork(name, isOverwrite = false, existingId = null, quiet = false) {
  try {
    const db = await openDatabase();

    // 1) FLATTENED preview for gallery (unchanged)
    const flattenCanvas = composeToCanvas(true);
    const flattenedBlob = await canvasToBlob(flattenCanvas, "image/png", 0.92);

    // 2) THUMBNAIL (unchanged)
    const thumbMax = 320;
    const thumbScale = Math.min(
      thumbMax / flattenCanvas.width,
      thumbMax / flattenCanvas.height,
      1
    );
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = Math.round(flattenCanvas.width * thumbScale);
    thumbCanvas.height = Math.round(flattenCanvas.height * thumbScale);
    thumbCanvas.getContext("2d").drawImage(
      flattenCanvas,
      0,
      0,
      thumbCanvas.width,
      thumbCanvas.height
    );
    const thumbBlob = await canvasToBlob(thumbCanvas, "image/webp", 0.7);
    const thumbDataURL = await new Promise((res) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.readAsDataURL(thumbBlob);
    });

    // 3) PROJECT SOURCE (background + each layer as its OWN rect)
    const docW = fixedFBOWidth, docH = fixedFBOHeight;

    // optional background snapshot (unchanged)
    let backgroundBlob = null;
    if (currentImage) {
      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = docW; bgCanvas.height = docH;
      const bgCtx = bgCanvas.getContext("2d");
      bgCtx.drawImage(currentImage, 0, 0, docW, docH);
      backgroundBlob = await canvasToBlob(bgCanvas, "image/png", 0.92);
    }

    // helper: dump an FBO (size W x H) → PNG blob
    async function fboToBlob(fbo, W, H) {
      const pixels = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // pack into 2D canvas then flip Y into output so stored PNG is top-left origin
      const temp = document.createElement("canvas");
      temp.width = W; temp.height = H;
      const tctx = temp.getContext("2d");
      const imgData = new ImageData(new Uint8ClampedArray(pixels), W, H);
      tctx.putImageData(imgData, 0, 0);

      const out = document.createElement("canvas");
      out.width = W; out.height = H;
      const octx = out.getContext("2d");
      octx.save();
      octx.translate(W / 2, H / 2);
      octx.scale(-1, -1);
      octx.rotate(Math.PI);
      octx.drawImage(temp, -W / 2, -H / 2);
      octx.restore();

      return canvasToBlob(out, "image/png", 0.92);
    }

    // build layer entries (NEW: keep per-layer rect + transform)
    const layerEntries = [];
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];

      // fallbacks to doc size if older layers don’t have per-layer rect
      const W = Math.max(1, (Number(L.texW) || docW) | 0);
      const H = Math.max(1, (Number(L.texH) || docH) | 0);

      const blob = await fboToBlob(L.fbo, W, H);

      layerEntries.push({
        // visual props
        name: L.name,
        visible: !!L.visible,
        opacity: Number(L.opacity) || 1,

        // transform props (v46-compatible)
        x: Number(L.x) || 0,
        y: Number(L.y) || 0,
        scaleX: Number.isFinite(L.scaleX) ? L.scaleX : 1,
        scaleY: Number.isFinite(L.scaleY) ? L.scaleY : 1,
        rotation: Number(L.rotation) || 0,
        px: Number.isFinite(L.px) ? L.px : docW * 0.5,
        py: Number.isFinite(L.py) ? L.py : docH * 0.5,

        // NEW: own texture rect in document space
        texW: W,
        texH: H,
        ox: Number(L.ox) || 0,
        oy: Number(L.oy) || 0,

        // the pixels
        blob
      });
    }

    const existingIdInput = document.getElementById("existingArtworkId");
    const existingIdValue = existingIdInput ? existingIdInput.value : null;

    const computedId = isOverwrite
      ? (existingId ?? currentArtworkId ?? existingIdValue ?? Date.now())
      : Date.now();

    const artwork = {
      id: computedId,
      name: name || `Untitled ${computedId}`,
      date: new Date().toISOString(),
      username: "User",
      appName: "Web Paint",
      // for gallery
      image: flattenedBlob,
      thumbnail: thumbDataURL,
      // full project
      project: {
        v: 2, // schema marker (backward compatible)
        width: docW,
        height: docH,
        backgroundBlob,
        layers: layerEntries
      }
    };

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(artwork);

    tx.oncomplete = () => {
      if (!quiet) {
        showStatusMessage(isOverwrite ? "Artwork overwritten!" : "Artwork saved!", "success");
      }
      if (existingIdInput) existingIdInput.value = computedId;
      currentArtworkId = computedId;

      // optional thumbnail to chat (unchanged)
      if (!quiet && socket && socket.readyState === WebSocket.OPEN) {
        const profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
        const chatMsg = {
          type: "image",
          clientId: clientId,
          nickname: profileData.nickname?.trim() || "",
          profileImage: profileData.image || "",
          imageData: artwork.thumbnail,
          imageName: artwork.name,
          timestamp: Date.now()
        };
        socket.send(JSON.stringify(chatMsg));
      }
    };

    tx.onerror = (err) => {
      console.error("[saveArtwork] IndexedDB ERROR:", err);
      if (!quiet) showStatusMessage("Error saving artwork.", "error");
    };
  } catch (err) {
    console.error("[saveArtwork] ERROR:", err);
    if (!quiet) showStatusMessage("Error saving artwork.", "error");
  }
}







const AUTOSAVE_ID = "__autosave__";
let autosaveTimer = null;

async function saveAutosaveNow() {
  const db = await openDatabase();

  // Reuse your project packing logic from saveArtwork()
  const nameInput = document.getElementById("artworkName");
  const userGivenName = nameInput ? nameInput.value : "";

  // Save under a fixed id so we can overwrite every time
  // await saveArtwork(userGivenName || "Autosave", true, AUTOSAVE_ID);
  await saveArtwork(userGivenName || "Autosave", true, AUTOSAVE_ID, { quiet: true });

}

function saveAutosaveDebounced(delay = 800) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { saveAutosaveNow().catch(console.error); }, delay);
}

// Load from autosave at startup

async function tryRestoreAutosave() {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const req = store.get(AUTOSAVE_ID);
  req.onsuccess = async () => {
    const art = req.result;
    if (!art) return; // nothing to restore
    await loadArtworkObject(art);
    showStatusMessage("Autosave restored", "success");
  };
  req.onerror = () => {
    console.warn("Autosave lookup failed.");
  };
}










// ============================
// LOAD from IndexedDB (full)
// ============================
async function loadArtworkObject(art) {
  if (!art) return;

  // update selection/global
  currentArtworkId = art.id;

  // has a project?
  if (art.project && art.project.layers && art.project.layers.length) {
    const docW = art.project.width | 0;
    const docH = art.project.height | 0;

    // set fixed doc size first
    fixedFBOWidth = docW;
    fixedFBOHeight = docH;

    initFloodFBOs();
    initPaintLayerFixed(); // creates one default; we’ll replace all

    // restore background (unchanged)
    if (art.project.backgroundBlob) {
      const bgUrl = URL.createObjectURL(art.project.backgroundBlob);
      const img = new Image();
      await new Promise((resolve) => {
        img.onload = () => {
          currentImage = img;
          updateCanvasSize(img);
          createTextureFromImage(img);

          // force layout, then center
          void canvas.offsetWidth; void canvasWrapper.offsetWidth;
          zoomScale = 1;
          panX = (canvasWrapper.clientWidth  - canvas.width ) / 2;
          panY = (canvasWrapper.clientHeight - canvas.height) / 2;
          updateCanvasTransform();
          resetStrokeState();
          needsRedraw = true;

          URL.revokeObjectURL(bgUrl);
          resolve();
        };
        img.src = bgUrl;
      });
    } else {
      currentImage = null;
      texture = null;
      updateCanvasSize({ width: docW, height: docH });
    }

    // clear old GL layer objects
    layers.forEach(L => { gl.deleteTexture(L.texture); gl.deleteFramebuffer(L.fbo); });
    layers = [];




    // === FULL REPLACEMENT: drawImageIntoFBO (no drawFullScreenQuad dependency) ===
    function drawImageIntoFBO(image, fbo, W, H) {
      // 1) Rasterize the Image/Bitmap into a 2D canvas of exact size
      const temp = document.createElement("canvas");
      temp.width = W; temp.height = H;
      const tctx = temp.getContext("2d");
      tctx.clearRect(0, 0, W, H);
      tctx.drawImage(image, 0, 0, W, H);

      // 2) Upload that canvas as a WebGL texture
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // we flip via shader uniform
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, temp);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // 3) Draw that texture into the destination FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(quadProgram);

      // Handle both common uniform namings your code uses
      const uFlipY      = gl.getUniformLocation(quadProgram, "u_flipY");
      const uResolution = gl.getUniformLocation(quadProgram, "u_resolution");
      const uOpacity    = gl.getUniformLocation(quadProgram, "u_layerOpacity");
      const uTex        = gl.getUniformLocation(quadProgram, "u_texture") 
                       || gl.getUniformLocation(quadProgram, "u_image");

      if (uFlipY)      gl.uniform1f(uFlipY, 1.0);          // FBO-space draw (no screen flip)
      if (uResolution) gl.uniform2f(uResolution, W, H);
      if (uOpacity)    gl.uniform1f(uOpacity, 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (uTex) gl.uniform1i(uTex, 0);

      __bindAndDrawTexturedQuad(quadProgram, W, H);

      // 4) Cleanup
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex);
    }




    // rebuild layers from stored entries
    for (const src of art.project.layers) {
      // Back-compat: old saves had only {name, visible, opacity, blob}
      const W = Math.max(1, (Number(src.texW) || docW) | 0);
      const H = Math.max(1, (Number(src.texH) || docH) | 0);
      const OX = Number(src.ox) || 0;
      const OY = Number(src.oy) || 0;

      const { texture, fbo } = createLayerFBO(W, H);

      // upload blob → image → fbo
      if (src.blob) {
        const url = URL.createObjectURL(src.blob);
        const img = new Image();
        // eslint-disable-next-line no-loop-func
        await new Promise((resolve) => {
          img.onload = () => {
            drawImageIntoFBO(img, fbo, W, H);
            URL.revokeObjectURL(url);
            resolve();
          };
          img.src = url;
        });
      } else {
        // no pixels stored? just clear
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      const layer = {
        id: Date.now() + Math.random(),
        name: src.name || `Layer ${layers.length + 1}`,
        fbo, texture,
        visible: src.visible !== false,
        opacity: Number(src.opacity) || 1,

        // v46 transforms (with safe defaults)
        x: Number(src.x) || 0,
        y: Number(src.y) || 0,
        scaleX: Number.isFinite(src.scaleX) ? src.scaleX : 1,
        scaleY: Number.isFinite(src.scaleY) ? src.scaleY : 1,
        rotation: Number(src.rotation) || 0,
        px: Number.isFinite(src.px) ? src.px : docW * 0.5,
        py: Number.isFinite(src.py) ? src.py : docH * 0.5,

        // NEW rect in doc space
        texW: W,
        texH: H,
        ox: OX,
        oy: OY,

        history: [],
        redo: []
      };

      layers.push(layer);
    }

    // select top
    activeLayerIndex = Math.max(0, layers.length - 1);
    syncActiveAliases?.();
    rebuildLayersUI?.();
    needsRedraw = true;
    requestDrawIfIdle?.();
    return;
  }

  // No project? (back-compat single-image path)
  if (art.image) {
    const url = URL.createObjectURL(art.image);
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      updateCanvasSize(img);
      createTextureFromImage(img);
      zoomScale = 1;
      panX = (canvasWrapper.clientWidth  - canvas.width ) / 2;
      panY = (canvasWrapper.clientHeight - canvas.height) / 2;
      updateCanvasTransform();
      resetStrokeState();
      needsRedraw = true;
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
}









async function loadArtwork(id) {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const req = store.get(id);

  req.onsuccess = async () => {
    const art = req.result;
    if (!art) { showStatusMessage("Artwork not found.", "error"); return; }
    await loadArtworkObject(art);
  };

  req.onerror = () => {
    console.error("Failed to load artwork from IndexedDB.");
    showStatusMessage("Failed to load artwork.", "error");
  };
}


// ... inside the same DOMContentLoaded callback, AFTER
// openDatabase, saveAutosaveNow, saveAutosaveDebounced, tryRestoreAutosave, etc.

(function wireAutosave() {
  const saveSoon = () => saveAutosaveDebounced(500);
  const saveNow  = () => { try { saveAutosaveNow(); } catch (_) {} };

  const canvasEl = document.getElementById("glCanvas");
  if (canvasEl) {
    ["pointerup","mouseup","touchend"].forEach(ev =>
      canvasEl.addEventListener(ev, saveSoon, { passive: true })
    );
  }
  document.addEventListener("keyup", saveSoon, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveNow();
  });
  window.addEventListener("beforeunload", saveNow);

  // light periodic safety save (skip while drawing if you like)
  setInterval(() => {
    try { if (!isDrawing) saveSoon(); } catch (_) { /* ignore */ }
  }, 15000);

  // restore once everything visual is initialized
  window.addEventListener("load", () => {
    requestAnimationFrame(() => {
      tryRestoreAutosave(); // <-- this now calls the *real* function in-scope
    });
  });
})();







    document.addEventListener("keydown", (event) => {
      
      if (isUserTyping()) return;
      // Command + S: overwrite existing artwork (on macOS, use metaKey)

      if (event.metaKey && event.key.toLowerCase() === "s") {

        console.log("kd: s") 


        event.preventDefault();
        event.stopPropagation(); // Stop further propagation if necessary

        const nameInput = document.getElementById("artworkName").value;
        const existingIdInput = document.getElementById("existingArtworkId");
        if (existingIdInput && existingIdInput.value) {
          saveArtwork(nameInput, true, existingIdInput.value);
          showStatusMessage("Artwork overwritten!", "success");
        } else {
          console.warn("No artwork selected for overwrite.");
        }
      }
      // Shift + S: open modal for "Save As New"
      else if (event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        const saveModal = document.getElementById("saveModal");
        showModal(saveModal);
      }
    });


    document.getElementById("saveNewButton").addEventListener("click", () => {
        const nameInput = document.getElementById("artworkName").value;
        saveArtwork(nameInput, false); // Pass `false` for new save
        closeModal(saveModal);
    });

    document.getElementById("overwriteButton").addEventListener("click", () => {
        const nameInput = document.getElementById("artworkName").value;
        const existingIdInput = document.getElementById("existingArtworkId");

        // Ensure that the existing ID is populated
        const existingId = existingIdInput ? existingIdInput.value : null;

        if (existingId && nameInput) {
            // Proceed to overwrite artwork
            saveArtwork(nameInput, true, existingId, { quiet: true });
        } else {
            console.error("No existing artwork ID or name found. Cannot overwrite.");
        }

        closeModal(saveModal);
    });



    function saveCanvasAsPNG(includeBackground = true) {
      const out = composeToCanvas(includeBackground);
      const link = document.createElement("a");
      const suffix = includeBackground ? "_with_background" : "_transparent";
      link.download = `canvas_${Date.now()}${suffix}.png`;
      link.href = out.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }


    // function saveCanvasAsPNG() {
    //     const offscreenCanvas = document.createElement("canvas");
    //     offscreenCanvas.width = fixedFBOWidth;
    //     offscreenCanvas.height = fixedFBOHeight;
    //     const offscreenCtx = offscreenCanvas.getContext("2d");

    //     if (currentImage) {
    //         offscreenCtx.drawImage(currentImage, 0, 0, fixedFBOWidth, fixedFBOHeight);
    //     }

    //     const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
    //     gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    //     gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    //     gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    //     const tempCanvas = document.createElement("canvas");
    //     tempCanvas.width = fixedFBOWidth;
    //     tempCanvas.height = fixedFBOHeight;
    //     const tempCtx = tempCanvas.getContext("2d");

    //     const imageData = new ImageData(new Uint8ClampedArray(pixels), fixedFBOWidth, fixedFBOHeight);
    //     tempCtx.putImageData(imageData, 0, 0);

    //     offscreenCtx.save();
    //     offscreenCtx.translate(fixedFBOWidth / 2, fixedFBOHeight / 2);
    //     offscreenCtx.scale(-1, -1);
    //     offscreenCtx.rotate(Math.PI);
    //     offscreenCtx.drawImage(tempCanvas, -fixedFBOWidth / 2, -fixedFBOHeight / 2);
    //     offscreenCtx.restore();

    //     const dataURL = offscreenCanvas.toDataURL("image/png");
    //     const link = document.createElement("a");
    //     link.href = dataURL;
    //     link.download = `canvas_${Date.now()}.png`;
    //     document.body.appendChild(link);
    //     link.click();
    //     document.body.removeChild(link);
    // }


/* Save as Project File */







/* Save as Project File — v2 manifest with per-layer rects (ox/oy/texW/texH) */

async function exportProjectZIP({ includeBackground = true } = {}) {
  if (!window.JSZip) {
    console.error("JSZip not loaded");
    showStatusMessage("Export failed: JSZip not loaded.", "error");
    return;
  }

  const W = fixedFBOWidth, H = fixedFBOHeight;
  const zip = new JSZip();

  // ----- Manifest (v2) -----
  const manifest = {
    version: 2,
    width: W,
    height: H,
    app: "Helena Paint",
    date: new Date().toISOString(),
    hasBackground: !!currentImage && includeBackground,
    layers: layers.map((L, i) => ({
      index: i,
      name: L.name,
      visible: !!L.visible,
      opacity: Number(L.opacity) || 1,

      // transform (kept for UI continuity; typically baked at endTransform)
      x: Number(L.x) || 0,
      y: Number(L.y) || 0,
      scaleX: Number(L.scaleX) || 1,
      scaleY: Number(L.scaleY) || 1,
      rotation: Number(L.rotation) || 0,
      px: Number.isFinite(L.px) ? L.px : W * 0.5,
      py: Number.isFinite(L.py) ? L.py : H * 0.5,

      // NEW: real texture rect in document space
      ox: Number.isFinite(L.ox) ? L.ox : 0,
      oy: Number.isFinite(L.oy) ? L.oy : 0,
      texW: Number.isFinite(L.texW) ? L.texW : W,
      texH: Number.isFinite(L.texH) ? L.texH : H
    }))
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2), { compression: "DEFLATE" });

  // ----- Background (optional) -----
  if (manifest.hasBackground) {
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = W; bgCanvas.height = H;
    const bgCtx = bgCanvas.getContext("2d");
    bgCtx.drawImage(currentImage, 0, 0, W, H);
    const bgBlob = await new Promise(res => bgCanvas.toBlob(res, "image/png", 0.92));
    zip.file("background.png", bgBlob, { compression: "DEFLATE" });
  }

  // ----- Layers -----
  // Save each layer’s pixels at its own size (NO resizing to canvas).
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const w = Number.isFinite(L.texW) ? L.texW : W;
    const h = Number.isFinite(L.texH) ? L.texH : H;

    const imgData = readFBOToImageData(L.fbo, w, h); // reads the bound FBO at the given size
    const pngBlob = await imageDataToPngBlob(imgData);

    const safe = (L.name || "Layer").replace(/[^\w\-]+/g, "_");
    const filename = `layers/${String(i).padStart(3, "0")}_${safe}_${w}x${h}.png`;
    zip.file(filename, pngBlob, { compression: "DEFLATE" });
  }

  // ----- Build ZIP -----
  const content = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  const fileName = `helena_project_${Date.now()}.hpaint`; // zip under the hood

  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showStatusMessage("Project exported!", "success");
}


/* importProjectZIP(file)
   Fixes:
   1) Correct WebGL upload path (allocate with texImage2D null, then texSubImage2D with ImageBitmap).
      Your previous call used the 9-arg ArrayBufferView overload with an ImageBitmap → resulted in empty textures.
   2) Preserve per-layer transforms from manifest (x,y,scaleX,scaleY,rotation,px,py,ox,oy,texW,texH) instead of resetting to identity.
   3) Use UNPACK_FLIP_Y_WEBGL = true to match the renderer’s expected orientation. */
async function importProjectZIP(file) {
  if (!window.JSZip) {
    console.error("JSZip not loaded");
    showStatusMessage("Import failed: JSZip not loaded.", "error");
    return;
  }
  try {
    const zip = await JSZip.loadAsync(file);
    const manifestText = await zip.file("manifest.json").async("string");
    const manifest = JSON.parse(manifestText);

    const ver = Number(manifest.version) || 1;
    const W = Number(manifest.width)  || fixedFBOWidth;
    const H = Number(manifest.height) || fixedFBOHeight;

    if (typeof setFixedFBODimensions === "function") {
      setFixedFBODimensions(W, H);
    } else {
      window.fixedFBOWidth = W;
      window.fixedFBOHeight = H;
    }
    initPaintLayerFixed?.(); // rebuild base state for W×H

    // background (optional)
    if (manifest.hasBackground && zip.file("background.png")) {
      const bgBlob = await zip.file("background.png").async("blob");
      const bgImg = await createImageBitmap(bgBlob);
      if (typeof setDocumentBackgroundImageBitmap === "function") {
        await setDocumentBackgroundImageBitmap(bgImg);
      } else {
        window.currentImage = bgImg;
      }
    }

    // upload helper: allocate Tw×Th, then upload bitmap at (0,0); preserves endless layers
    function createLayerFromBitmap(name, bmp, rect, opts) {
      const w = Math.max(1, rect.texW | 0);
      const h = Math.max(1, rect.texH | 0);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // Allocate storage first (null data), then upload source with texSubImage2D (correct overload)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      if (bmp) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      }

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Preserve full transform state from manifest
      const layer = {
        id: Date.now() + Math.random(),
        name,
        texture: tex,
        fbo,
        visible: !!opts.visible,
        opacity: Number.isFinite(opts.opacity) ? opts.opacity : 1,

        ox: rect.ox | 0, oy: rect.oy | 0,
        texW: w, texH: h,

        x: Number.isFinite(opts.x) ? opts.x : 0,
        y: Number.isFinite(opts.y) ? opts.y : 0,
        scaleX: Number.isFinite(opts.scaleX) ? opts.scaleX : 1,
        scaleY: Number.isFinite(opts.scaleY) ? opts.scaleY : 1,
        rotation: Number.isFinite(opts.rotation) ? opts.rotation : 0,

        px: Number.isFinite(opts.px) ? opts.px : (W * 0.5),
        py: Number.isFinite(opts.py) ? opts.py : (H * 0.5),

        history: [], redo: []
      };

      layers.push(layer);
    }

    // Layers (bottom→top)
    const defs = (manifest.layers || []).slice().sort((a, b) => a.index - b.index);
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];

      // locate bitmap in ZIP
      const prefix = String(def.index).padStart(3, "0") + "_";
      const files = Object.keys(zip.files).filter(k => k.startsWith("layers/"));
      const match =
        files.find(k => k.split("/").pop().startsWith(prefix)) ||
        files[def.index];

      let bmp = null;
      if (match) {
        const blob = await zip.file(match).async("blob");
        bmp = await createImageBitmap(blob);
      } else {
        console.warn("Missing layer image in zip for index", def.index);
      }

      // rect (v2) or full-canvas fallback (v1)
      const rect = (ver >= 2) ? {
        ox: Number.isFinite(def.ox) ? def.ox : 0,
        oy: Number.isFinite(def.oy) ? def.oy : 0,
        texW: Number.isFinite(def.texW) ? def.texW : W,
        texH: Number.isFinite(def.texH) ? def.texH : H
      } : { ox: 0, oy: 0, texW: W, texH: H };

      // pass through all transforms from manifest (do NOT reset to identity)
      createLayerFromBitmap(def.name || `Layer ${i + 1}`, bmp, rect, {
        visible: !!def.visible,
        opacity: Number(def.opacity) || 1,

        x: def.x, y: def.y,
        scaleX: def.scaleX, scaleY: def.scaleY,
        rotation: def.rotation,

        px: def.px, py: def.py
      });
    }

    // finish
    activeLayerIndex = Math.max(0, layers.length - 1);
    syncActiveAliases?.();
    rebuildLayersUI?.();
    needsRedraw = true;
    requestDrawIfIdle?.();
    showStatusMessage?.("Project imported", "success");
  } catch (err) {
    console.error(err);
    showStatusMessage("Import failed.", "error");
  }
}








document.getElementById("exportProjectBtn").addEventListener("click", () => {
  exportProjectZIP({ includeBackground: true }); // or false for no background
});


const importInput = document.getElementById("importProjectInput");
document.getElementById("importProjectBtn").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importProjectZIP(file);
});


// Blob/ArrayBuffer helpers
const blobToArrayBuffer = (blob) =>
  new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(blob); });

const blobToDataURL = (blob) =>
  new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

// Read current FBO → ImageData
function readFBOToImageData(fbo, w, h) {
  const pixels = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return new ImageData(new Uint8ClampedArray(pixels), w, h);
}

// Convert ImageData to PNG Blob (via 2D canvas)
function imageDataToPngBlob(imageData) {
  const c = document.createElement("canvas");
  c.width = imageData.width; c.height = imageData.height;
  c.getContext("2d").putImageData(imageData, 0, 0);
  return new Promise(r => c.toBlob(r, "image/png", 0.92));
}








// ————————————————————————————————————————————————
// Layers as Brush
// ————————————————————————————————————————————————



// === REPLACE: makeBrushFromActiveLayer (instant-select as active brush) ===
function makeBrushFromActiveLayer() {
  var L = (typeof getActiveLayer === "function") ? getActiveLayer() : null;
  if (!gl || !quadProgram || !L || !L.texture) return null;

  var srcW = Math.max(1, (L.texW | 0) || fixedFBOWidth || canvas.width);
  var srcH = Math.max(1, (L.texH | 0) || fixedFBOHeight || canvas.height);

  // Save GL state
  var prevFBO      = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  var prevProg     = gl.getParameter(gl.CURRENT_PROGRAM);
  var prevViewport = gl.getParameter(gl.VIEWPORT);

  // Create brush texture/FBO (same size as layer bitmap)
  var brushTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, brushTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, srcW, srcH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  var brushFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, brushFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, brushTex, 0);

  // Clear & copy the layer texture (no vertical flip)
  gl.viewport(0, 0, srcW, srcH);
  gl.disable(gl.BLEND);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(quadProgram);
  var uFlipY   = gl.getUniformLocation(quadProgram, "u_flipY");
  var uRes     = gl.getUniformLocation(quadProgram, "u_resolution");
  var uOpacity = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  var uTex     = gl.getUniformLocation(quadProgram, "u_texture");
  if (uFlipY)   gl.uniform1f(uFlipY, 1.0);
  if (uRes)     gl.uniform2f(uRes, srcW, srcH);
  if (uOpacity) gl.uniform1f(uOpacity, 1.0);
  if (uTex)     gl.uniform1i(uTex, 0);

  var verts = new Float32Array([
    0,    0,     0, 0,
    srcW, 0,     1, 0,
    0,    srcH,  0, 1,
    0,    srcH,  0, 1,
    srcW, 0,     1, 0,
    srcW, srcH,  1, 1
  ]);
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  var aPos = gl.getAttribLocation(quadProgram, "a_position");
  var aUV  = gl.getAttribLocation(quadProgram, "a_texCoord");
  if (aPos >= 0) { gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0); }
  if (aUV  >= 0) { gl.enableVertexAttribArray(aUV ); gl.vertexAttribPointer(aUV , 2, gl.FLOAT, false, 16, 8); }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, L.texture);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  if (aPos >= 0) gl.disableVertexAttribArray(aPos);
  if (aUV  >= 0) gl.disableVertexAttribArray(aUV);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(vbo);

  // Restore GL
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  try { gl.deleteFramebuffer(brushFBO); } catch(e){}
  gl.useProgram(prevProg);
  if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);

  // === Make it ACTIVE immediately ===
  // 1) set overlay texture (preview + paint sampler in your pipeline)
  overlayTexture = brushTex;
  brushAspect = srcW / srcH;

  // 2) set current brush object so paint path picks it up
  currentBrush = {
    name: (L.name ? (L.name + " → Brush") : "Layer Brush"),
    type: "bitmap",
    texture: brushTex,
    defaultSize: currentBrush && currentBrush.defaultSize ? currentBrush.defaultSize : 0.05, // keep user size if exists
    aspect: brushAspect,
    spacing: 0.14,
    angleFromDirection: true,
    opacity: 1.0
  };

  // 3) switch tool to draw and show HUD at pointer for visual confirmation
  currentTool = 'draw';
  if (lastPointer && typeof showBrushHUD === "function") showBrushHUD(1500);

  // 4) force a redraw so you can paint immediately
  needsRedraw = true;
  if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();

  return currentBrush;
}


function deleteBrushById(id) {
  const list = window.brushes || [];
  const i = list.findIndex(b => b.id === id);
  if (i >= 0) {
    const b = list[i];
    try { if (b.type === "bitmap" && b.tex) gl.deleteTexture(b.tex); } catch {}
    list.splice(i, 1);
  }
}

var layerToBrushBtn = document.getElementById("layerToBrushBtn");
if (layerToBrushBtn) {
  layerToBrushBtn.addEventListener("click", function () {
    var made = makeBrushFromActiveLayer();
    if (made) {
      if (typeof showStatusMessage === "function") showStatusMessage("Brush created from layer", "success");
      if (typeof requestDrawIfIdle === "function") requestDrawIfIdle();
    } else {
      if (typeof showStatusMessage === "function") showStatusMessage("No active layer to convert", "warning");
    }
  });
}





const importLayerBtn   = document.getElementById("importLayerButton");
const importLayerInput = document.getElementById("importLayerInput");
const exportLayerBtn   = document.getElementById("exportLayerButton");

// iOS: allow choosing from gallery or camera
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
  importLayerInput?.removeAttribute("capture");
}

// Click "Imp" -> open hidden file input
importLayerBtn?.addEventListener("click", () => importLayerInput?.click());


// Read an HTMLImageElement into an FBO the size of the document
// Raster an <img> into the target FBO WITHOUT distorting aspect ratio.
// Strategy: "contain", center, never upscale above 100%.
async function rasterImageIntoFBO(image, fbo) {
  const W = fixedFBOWidth, H = fixedFBOHeight;

  // Compute scale that fits within the document without changing AR
  const sx = W / image.width;
  const sy = H / image.height;
  const scale = Math.min(sx, sy, 1); // never upscale past 1:1

  const drawW = Math.round(image.width * scale);
  const drawH = Math.round(image.height * scale);
  const offX  = Math.floor((W - drawW) / 2);
  const offY  = Math.floor((H - drawH) / 2);

  // 1) Rasterize onto a 2D canvas with transparent padding
  const temp = document.createElement("canvas");
  temp.width = W;
  temp.height = H;
  const tctx = temp.getContext("2d");
  tctx.clearRect(0, 0, W, H);
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "high";
  tctx.drawImage(image, 0, 0, image.width, image.height, offX, offY, drawW, drawH);

  // 2) Upload as GL texture
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, temp);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // 3) Draw texture into target FBO (no further scaling here)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(quadProgram);
  const flipLoc = gl.getUniformLocation(quadProgram, "u_flipY");
  if (flipLoc) gl.uniform1f(flipLoc, 1.0);
  const resLoc = gl.getUniformLocation(quadProgram, "u_resolution");
  if (resLoc) gl.uniform2f(resLoc, W, H);
  const opLoc = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  if (opLoc) gl.uniform1f(opLoc, 1.0);

  const verts = new Float32Array([
    0, 0,   0, 0,
    W, 0,   1, 0,
    0, H,   0, 1,
    0, H,   0, 1,
    W, 0,   1, 0,
    W, H,   1, 1
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(quadProgram, "a_position");
  const uvLoc  = gl.getAttribLocation(quadProgram, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const uTex = gl.getUniformLocation(quadProgram, "u_texture");
  if (uTex) gl.uniform1i(uTex, 0);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Cleanup
  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(uvLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.deleteTexture(tex);

  needsRedraw = true;
}





// Handle chosen file → add as new layer directly under the active layer
importLayerInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const img = new Image();
  img.onload = async () => {
    // If doc size is not initialized yet, bootstrap it from the image
    if (!fixedFBOWidth || !fixedFBOHeight) {
      fixedFBOWidth  = img.width;
      fixedFBOHeight = img.height;
      initPaintLayerFixed?.();
      updateCanvasSize({ width: img.width, height: img.height });
      needsRedraw = true;
    }

    const { texture, fbo } = createLayerFBO(fixedFBOWidth, fixedFBOHeight);
    const L = {
      id: Date.now() + Math.random(),
      name: (file.name || "Imported").replace(/\.[^.]+$/, ""),
      fbo, texture,
      visible: true, opacity: 1,
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
      px: fixedFBOWidth * 0.5, py: fixedFBOHeight * 0.5,
      history: [], redo: []
    };

    // Insert below the current active layer in the stack
    const insertPos = Math.max(0, Math.min(activeLayerIndex, layers.length));
    layers.splice(insertPos, 0, L);
    activeLayerIndex = insertPos;

    await rasterImageIntoFBO(img, fbo);
    syncActiveAliases?.();
    rebuildLayersUI?.();
    needsRedraw = true;
    showStatusMessage?.("Imported image as new layer.", "success");
  };
  img.src = URL.createObjectURL(file);

  // reset input so selecting the same file again still triggers change
  e.target.value = "";
});

// Export active layer as PNG (screen-corrected flip)
exportLayerBtn?.addEventListener("click", () => {
  const L = layers?.[activeLayerIndex];
  if (!L) { showStatusMessage?.("No active layer to export.", "error"); return; }

  const w = fixedFBOWidth, h = fixedFBOHeight;

  // Read FBO → ImageData (uses global helper)
  // A global helper already exists in this file: readFBOToImageData(fbo, w, h) :contentReference[oaicite:0]{index=0}
  const temp = document.createElement("canvas");
  temp.width = w; temp.height = h;
  const tctx = temp.getContext("2d");
  tctx.putImageData(readFBOToImageData(L.fbo, w, h), 0, 0); // read FBO pixels :contentReference[oaicite:1]{index=1}

  // Flip to match on-screen orientation (WebGL → 2D canvas coords),
  // same approach used elsewhere when compositing exports. :contentReference[oaicite:2]{index=2}
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d");
  octx.save();
  octx.translate(w / 2, h / 2);
  octx.scale(-1, -1);
  octx.rotate(Math.PI);
  octx.drawImage(temp, -w / 2, -h / 2);
  octx.restore();

  const a = document.createElement("a");
  a.download = `${(L.name || "Layer").replace(/\s+/g, "_")}.png`;
  a.href = out.toDataURL("image/png");
  document.body.appendChild(a);
  a.click();
  a.remove();

  showStatusMessage?.("Active layer exported.", "success");
});






/* Save as ICO */


function saveCanvasAsICO() {
  const targetSize = 64;
  const composed = composeToCanvas(true); // ICO always with background; change if you want

  const icoCanvas = document.createElement("canvas");
  icoCanvas.width = targetSize;
  icoCanvas.height = targetSize;
  const ictx = icoCanvas.getContext("2d");
  ictx.drawImage(composed, 0, 0, targetSize, targetSize);

  icoCanvas.toBlob((pngBlob) => {
    if (!pngBlob) { showStatusMessage("ICO export failed.", "error"); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const pngArrayBuffer = reader.result;
      const icoArrayBuffer = convertPNGToICO(pngArrayBuffer, targetSize);
      const icoBlob = new Blob([icoArrayBuffer], { type: "image/x-icon" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(icoBlob);
      link.download = "favicon.ico";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    reader.readAsArrayBuffer(pngBlob);
  }, "image/png");
}



// function saveCanvasAsICO() {
//     const targetSize = 64; // Change to 32, 48, etc., for other favicon sizes

//     // Create an offscreen canvas for composing the final image
//     const offscreenCanvas = document.createElement("canvas");
//     offscreenCanvas.width = targetSize;
//     offscreenCanvas.height = targetSize;
//     const offscreenCtx = offscreenCanvas.getContext("2d");

//     // Step 1: Draw the background image (if available)
//     if (currentImage) {
//         offscreenCtx.drawImage(currentImage, 0, 0, targetSize, targetSize);
//     }

//     // Step 2: Extract paint layer from WebGL
//     const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
//     gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, null);

//     // Step 3: Create a temporary canvas for strokes
//     const tempCanvas = document.createElement("canvas");
//     tempCanvas.width = fixedFBOWidth;
//     tempCanvas.height = fixedFBOHeight;
//     const tempCtx = tempCanvas.getContext("2d");

//     const imageData = new ImageData(new Uint8ClampedArray(pixels), fixedFBOWidth, fixedFBOHeight);
//     tempCtx.putImageData(imageData, 0, 0);

//     // Step 4: Scale down the composed artwork to ICO size
//     offscreenCtx.save();
//     offscreenCtx.translate(targetSize / 2, targetSize / 2);
//     offscreenCtx.scale(-1, -1); // Flip for correct orientation
//     offscreenCtx.rotate(Math.PI);
//     offscreenCtx.drawImage(tempCanvas, -targetSize / 2, -targetSize / 2, targetSize, targetSize);
//     offscreenCtx.restore();

//     // Step 5: Convert to ICO format
//     offscreenCanvas.toBlob((blob) => {
//         const reader = new FileReader();
//         reader.readAsArrayBuffer(blob);
//         reader.onloadend = () => {
//             const pngArrayBuffer = reader.result;
//             const icoArrayBuffer = convertPNGToICO(pngArrayBuffer, targetSize);

//             const icoBlob = new Blob([icoArrayBuffer], { type: "image/x-icon" });
//             const link = document.createElement("a");
//             link.href = URL.createObjectURL(icoBlob);
//             link.download = `favicon.ico`;
//             document.body.appendChild(link);
//             link.click();
//             document.body.removeChild(link);
//         };
//     }, "image/png");
// }

// Convert PNG to ICO (Fixed)
function convertPNGToICO(pngBuffer, size) {
    const icoHeader = new Uint8Array([
        0x00, 0x00,  // Reserved
        0x01, 0x00,  // Type (1 = icon)
        0x01, 0x00,  // Number of images (1 icon stored)
    ]);

    const iconEntry = new Uint8Array(16); // Ensure correct buffer size
    iconEntry.set([
        size, size,  // Width, Height
        0x00,        // Color count (0 = 256+ colors)
        0x00,        // Reserved
        0x01, 0x00,  // Color planes (1)
        0x20, 0x00,  // Bits per pixel (32-bit)
    ]);

    const pngSize = pngBuffer.byteLength;
    const pngOffset = icoHeader.length + iconEntry.length;

    // Ensure the DataView has correct bounds
    const sizeView = new DataView(iconEntry.buffer);
    sizeView.setUint32(8, pngSize, true);  // Store PNG size
    sizeView.setUint32(12, pngOffset, true); // Store PNG offset

    const icoSize = icoHeader.length + iconEntry.length + pngSize;
    const icoBuffer = new Uint8Array(icoSize);

    icoBuffer.set(icoHeader, 0);
    icoBuffer.set(iconEntry, icoHeader.length);
    icoBuffer.set(new Uint8Array(pngBuffer), pngOffset);

    return icoBuffer.buffer;
}

// Attach button event
document.getElementById("saveCanvasAsIcoButton").addEventListener("click", saveCanvasAsICO);


    // Helper function to flip ImageData vertically
    function flipImageData(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const flippedData = new Uint8ClampedArray(imageData.data.length);

        for (let row = 0; row < height; row++) {
            const sourceStart = row * width * 4;
            const destStart = (height - row - 1) * width * 4;
            flippedData.set(imageData.data.subarray(sourceStart, sourceStart + width * 4), destStart);
        }

        return new ImageData(flippedData, width, height);
    }



    // Helper Function: Flip Image Data Vertically
    function flipImageData(imageData) {
        const { width, height, data } = imageData;
        const flippedData = new Uint8ClampedArray(data.length);

        for (let row = 0; row < height; row++) {
            const srcStart = row * width * 4;
            const destStart = (height - row - 1) * width * 4;
            flippedData.set(data.subarray(srcStart, srcStart + width * 4), destStart);
        }

        return new ImageData(flippedData, width, height);
    }
    // Helper Function: Flip Image Data Vertically
    function flipImageData(imageData) {
        const { width, height, data } = imageData;
        const flippedData = new Uint8ClampedArray(data.length);

        for (let row = 0; row < height; row++) {
            const srcStart = row * width * 4;
            const destStart = (height - row - 1) * width * 4;
            flippedData.set(data.subarray(srcStart, srcStart + width * 4), destStart);
        }

        return new ImageData(flippedData, width, height);
    }

    // Add an event listener to the save button
    



//---------------
// Export PNG Modal (Proper FBO Composition + Filename + Flip)
//---------------

function openExportModal() {
    document.getElementById("exportOptionsModal").style.display = "flex";
}

function closeExportModal() {
    document.getElementById("exportOptionsModal").style.display = "none";
}

function exportWithBackground() {
    closeExportModal();
    exportDrawingWithModal(true);
}

function exportTransparent() {
    closeExportModal();
    exportDrawingWithModal(false);
}





function exportDrawingWithModal(includeBackground) {
  const W = fixedFBOWidth | 0;
  const H = fixedFBOHeight | 0;

  // ---- 1) Doc-sized offscreen target ----
  const outTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, outTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const outFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(outFbo);
    gl.deleteTexture(outTex);
    showStatusMessage?.("Export failed (FBO incomplete).", "error");
    return;
  }

  // ---- 2) GL state ----
  gl.viewport(0, 0, W, H);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(quadProgram);
  const uFlipY      = gl.getUniformLocation(quadProgram, "u_flipY");
  const uResolution = gl.getUniformLocation(quadProgram, "u_resolution");
  const uOpacity    = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  const uTex        = gl.getUniformLocation(quadProgram, "u_texture") || gl.getUniformLocation(quadProgram, "u_image");

  // IMPORTANT: must be -1.0 (0.0 collapses geometry → fully transparent output)
  if (uFlipY)      gl.uniform1f(uFlipY, -1.0);
  if (uResolution) gl.uniform2f(uResolution, W, H);

  // shared VBO
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const posLoc = gl.getAttribLocation(quadProgram, "a_position");
  const uvLoc  = gl.getAttribLocation(quadProgram, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  function drawQuad(tex, p0, p1, p2, p3, opacity) {
    const verts = new Float32Array([
      p0.x, p0.y, 0, 0,
      p1.x, p1.y, 1, 0,
      p2.x, p2.y, 0, 1,
      p2.x, p2.y, 0, 1,
      p1.x, p1.y, 1, 0,
      p3.x, p3.y, 1, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    if (uOpacity) gl.uniform1f(uOpacity, Math.max(0, Math.min(1, opacity)));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (uTex) gl.uniform1i(uTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ---- 3) Background ----
  let bgTex = null;
  if (includeBackground && currentImage) {
    bgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, currentImage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    drawQuad(bgTex, {x:0,y:0}, {x:W,y:0}, {x:0,y:H}, {x:W,y:H}, 1.0);
  }

  // ---- 4) Layers bottom→top ----
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (!L || L.visible === false) continue;
    if (L.opacity != null && L.opacity <= 0) continue;
    if (!L.texture) continue;

    const Lx = Number.isFinite(L.ox) ? L.ox : 0;
    const Ly = Number.isFinite(L.oy) ? L.oy : 0;
    const Lw = Math.max(1, (Number(L.texW) || W) | 0);
    const Lh = Math.max(1, (Number(L.texH) || H) | 0);

    const pivX = Number.isFinite(L.px) ? L.px : W * 0.5;
    const pivY = Number.isFinite(L.py) ? L.py : H * 0.5;
    const dx   = Number.isFinite(L.x) ? L.x : 0;
    const dy   = Number.isFinite(L.y) ? L.y : 0;
    const sx   = Number.isFinite(L.scaleX) ? L.scaleX : 1;
    const sy   = Number.isFinite(L.scaleY) ? L.scaleY : 1;
    const rot  = Number.isFinite(L.rotation) ? L.rotation : 0;
    const c = Math.cos(rot), s = Math.sin(rot);

    function tf(x, y) {
      let rx = x - pivX, ry = y - pivY;
      rx *= sx; ry *= sy;
      return {
        x: pivX + (rx * c - ry * s) + dx,
        y: pivY + (rx * s + ry * c) + dy
      };
    }

    const p0 = tf(Lx,     Ly);
    const p1 = tf(Lx+Lw,  Ly);
    const p2 = tf(Lx,     Ly+Lh);
    const p3 = tf(Lx+Lw,  Ly+Lh);

    drawQuad(L.texture, p0, p1, p2, p3, Number(L.opacity) || 1);
  }

  // ---- 5) Readback + flip rows for PNG top-left origin ----
  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const flipped = new Uint8ClampedArray(W * H * 4);
  const rowBytes = W * 4;
  for (let y = 0; y < H; y++) {
    const src = y * rowBytes;
    const dst = (H - 1 - y) * rowBytes;
    flipped.set(pixels.subarray(src, src + rowBytes), dst);
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = W; outCanvas.height = H;
  const outCtx = outCanvas.getContext("2d");
  outCtx.putImageData(new ImageData(flipped, W, H), 0, 0);

  const suffix = includeBackground ? "_with_background" : "_transparent";
  const fname = `canvas_${Date.now()}${suffix}.png`;
  outCanvas.toBlob((blob) => {
    if (!blob) { showStatusMessage?.("Export failed.", "error"); return; }
    const a = document.createElement("a");
    a.download = fname;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }, "image/png", 0.92);

  // ---- 6) Cleanup ----
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(uvLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(vbo);
  if (bgTex) gl.deleteTexture(bgTex);
  gl.deleteFramebuffer(outFbo);
  gl.deleteTexture(outTex);
}



document.getElementById("exportModalClose").addEventListener("click", closeExportModal);
document.getElementById("exportWithBackgroundBtn").addEventListener("click", exportWithBackground);
document.getElementById("exportTransparentBtn").addEventListener("click", exportTransparent);
document.getElementById("saveCanvasButton").addEventListener("click", openExportModal);


// old
//document.getElementById("saveCanvasButton").addEventListener("click", saveCanvasAsPNG);


//---------------
// Share Modal
//---------------

document.getElementById("shareButton").addEventListener("click", openShareModal);

function openShareModal() {
    document.getElementById("shareOptionsModal").style.display = "flex";
}

function closeShareModal() {
    document.getElementById("shareOptionsModal").style.display = "none";
}

function shareWithBackground() {
    closeShareModal();
    shareDrawingWithModal(true);
}

function shareTransparent() {
    closeShareModal();
    shareDrawingWithModal(false);
}


function shareDrawingWithModal(includeBackground) {
  const out = composeToCanvas(includeBackground);
  out.toBlob(async (blob) => {
    if (!blob) { showStatusMessage("Error generating artwork.", "error"); return; }
    const suffix = includeBackground ? "_with_background" : "_transparent";
    const file = new File([blob], `artwork${suffix}.png`, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: "Artwork", text: "Check out my artwork!", files: [file] });
      } catch { showStatusMessage("Error sharing artwork.", "error"); }
    } else {
      showStatusMessage("Sharing not supported on this device.", "error");
    }
  }, "image/png");
}


// function shareDrawingWithModal(includeBackground) {
//     const offscreenCanvas = document.createElement("canvas");
//     offscreenCanvas.width = fixedFBOWidth;
//     offscreenCanvas.height = fixedFBOHeight;
//     const offscreenCtx = offscreenCanvas.getContext("2d");

//     if (includeBackground && currentImage) {
//         offscreenCtx.drawImage(currentImage, 0, 0, fixedFBOWidth, fixedFBOHeight);
//     }

//     const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
//     gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, null);

//     const tempCanvas = document.createElement("canvas");
//     tempCanvas.width = fixedFBOWidth;
//     tempCanvas.height = fixedFBOHeight;
//     const tempCtx = tempCanvas.getContext("2d");

//     const imageData = new ImageData(new Uint8ClampedArray(pixels), fixedFBOWidth, fixedFBOHeight);
//     tempCtx.putImageData(imageData, 0, 0);

//     offscreenCtx.save();
//     offscreenCtx.translate(fixedFBOWidth / 2, fixedFBOHeight / 2);
//     offscreenCtx.scale(-1, -1);
//     offscreenCtx.rotate(Math.PI);
//     offscreenCtx.drawImage(tempCanvas, -fixedFBOWidth / 2, -fixedFBOHeight / 2);
//     offscreenCtx.restore();

//     offscreenCanvas.toBlob(async (blob) => {
//         if (!blob) {
//             showStatusMessage("Error generating artwork for sharing.", "error");
//             return;
//         }

//         const suffix = includeBackground ? "_with_background" : "_transparent";
//         const file = new File([blob], `artwork${suffix}.png`, { type: "image/png" });

//         if (navigator.canShare && navigator.canShare({ files: [file] })) {
//             try {
//                 await navigator.share({
//                     title: "Artwork",
//                     text: "Check out my artwork!",
//                     files: [file],
//                 });
//             } catch {
//                 showStatusMessage("Error sharing artwork.", "error");
//             }
//         } else {
//             showStatusMessage("Sharing not supported on this device.", "error");
//         }
//     }, "image/png");
// }

document.getElementById("shareModalClose").addEventListener("click", closeShareModal);
document.getElementById("shareWithBackgroundBtn").addEventListener("click", shareWithBackground);
document.getElementById("shareTransparentBtn").addEventListener("click", shareTransparent);






    // Load artworks for gallery

let galleryEditMode = false;
let artworkToDeleteId = null;


/* composeToCanvas(includeBackground)
   Document-space composite that matches PNG export exactly.
   Renders background+layers into a doc-sized WebGL FBO with the SAME on-screen orientation (u_flipY = -1),
   then readPixels and do a single CPU row-flip to top-left canvas. */
function composeToCanvas(includeBackground = true) {
  if (!gl || !quadProgram) return null;

  const W = fixedFBOWidth | 0;
  const H = fixedFBOHeight | 0;

  // preserve GL state
  const prevFBO      = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const prevProg     = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevViewport = gl.getParameter(gl.VIEWPORT);
  const prevBlend    = gl.isEnabled(gl.BLEND);

  // target FBO (document space)
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  gl.viewport(0, 0, W, H);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // shader setup
  gl.useProgram(quadProgram);
  const uFlipY   = gl.getUniformLocation(quadProgram, "u_flipY");
  const uRes     = gl.getUniformLocation(quadProgram, "u_resolution");
  const uOpacity = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  const uTex     = gl.getUniformLocation(quadProgram, "u_texture");
  const aPos     = gl.getAttribLocation(quadProgram, "a_position");
  const aUV      = gl.getAttribLocation(quadProgram, "a_texCoord");

  if (uFlipY) gl.uniform1f(uFlipY, -1.0);    // match on-screen renderer
  if (uRes)   gl.uniform2f(uRes, W, H);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aUV , 2, gl.FLOAT, false, 16, 8);

  // background
  let bgTex = null;
  if (includeBackground && currentImage) {
    bgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, currentImage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (uOpacity) gl.uniform1f(uOpacity, 1.0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    if (uTex) gl.uniform1i(uTex, 0);

    const vertsBG = new Float32Array([
      0, 0, 0, 0,   W, 0, 1, 0,   0, H, 0, 1,
      0, H, 0, 1,   W, 0, 1, 0,   W, H, 1, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertsBG, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // layers
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (!L || !L.visible || !L.texture) continue;

    const Lx   = Number.isFinite(L.ox) ? L.ox : 0;
    const Ly   = Number.isFinite(L.oy) ? L.oy : 0;
    const Lw   = Math.max(1, Number.isFinite(L.texW) ? L.texW : W);
    const Lh   = Math.max(1, Number.isFinite(L.texH) ? L.texH : H);
    const scx  = Number.isFinite(L.scaleX) ? L.scaleX : 1;
    const scy  = Number.isFinite(L.scaleY) ? L.scaleY : 1;
    const rot  = Number.isFinite(L.rotation) ? L.rotation : 0;
    const tx   = Number.isFinite(L.x) ? L.x : 0;
    const ty   = Number.isFinite(L.y) ? L.y : 0;
    const pivX = Number.isFinite(L.px) ? L.px : W * 0.5;
    const pivY = Number.isFinite(L.py) ? L.py : H * 0.5;
    const op   = Math.max(0, Math.min(1, L.opacity ?? 1));

    const c = Math.cos(rot), s = Math.sin(rot);
    const tf = (x, y) => {
      let dx = (x - pivX) * scx, dy = (y - pivY) * scy;
      const rx = dx * c - dy * s, ry = dx * s + dy * c;
      return { x: pivX + rx + tx, y: pivY + ry + ty };
    };

    const p0 = tf(Lx,      Ly);
    const p1 = tf(Lx + Lw, Ly);
    const p2 = tf(Lx,      Ly + Lh);
    const p3 = tf(Lx + Lw, Ly + Lh);

    const verts = new Float32Array([
      p0.x, p0.y, 0, 0,
      p1.x, p1.y, 1, 0,
      p2.x, p2.y, 0, 1,
      p2.x, p2.y, 0, 1,
      p1.x, p1.y, 1, 0,
      p3.x, p3.y, 1, 1
    ]);

    if (uOpacity) gl.uniform1f(uOpacity, op);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, L.texture);
    if (uTex) gl.uniform1i(uTex, 0);

    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // readback and CPU flip to top-left canvas
  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const flipped = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const src = y * W * 4;
    const dst = (H - 1 - y) * W * 4;
    flipped.set(pixels.subarray(src, src + W * 4), dst);
  }

  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  ctx.putImageData(new ImageData(flipped, W, H), 0, 0);

  // restore & cleanup
  if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
  if (prevViewport) gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
  gl.useProgram(prevProg);
  gl.disableVertexAttribArray(aPos);
  gl.disableVertexAttribArray(aUV);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(vbo);
  if (bgTex) gl.deleteTexture(bgTex);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);

  return out;
}








// PNG blob (flattened) from full composition
function composeToPNGBlob(includeBackground = true, quality = 0.92) {
  return new Promise((resolve) => {
    const c = composeToCanvas(includeBackground);
    c.toBlob(b => resolve(b), "image/png", quality);
  });
}

// WEBP/JPEG blob (useful for thumbnails)
function canvasToBlob(canvas, type = "image/webp", quality = 0.75) {
  return new Promise((resolve) => {
    canvas.toBlob(b => resolve(b), type, quality);
  });
}




async function loadGallery() {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const artworks = request.result;
        artworks.sort((a, b) => new Date(b.date) - new Date(a.date));

        const gallery = document.getElementById("gallery");
        gallery.innerHTML = artworks.length ? "" : "<p>No saved artworks</p>";

        artworks.forEach((art) => {
            const div = document.createElement("div");
            div.classList.add("gallery-item");

            const img = document.createElement("img");
            img.src = art.thumbnail || "";
            img.alt = art.name;
            div.appendChild(img);

            const nameP = document.createElement("p");
            nameP.textContent = art.name;
            div.appendChild(nameP);

            const deleteBtn = document.createElement("button");
            deleteBtn.classList.add("delete-button");
            deleteBtn.style.display = galleryEditMode ? "block" : "none";

            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" stroke-width="1.5" fill="none">
                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                          d="M19 11v9.4a.6.6 0 0 1-.6.6H5.6a.6.6 0 0 1-.6-.6V11M10 17v-6M14 17v-6M21 7h-5M3 7h5m0 0V3.6a.6.6 0 0 1 .6-.6h6.8a.6.6 0 0 1 .6.6V7M8 7h8" />
                </svg>
            `;

            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                artworkToDeleteId = art.id;
                document.getElementById("deleteConfirmModal").style.display = "flex";
            });

            div.appendChild(deleteBtn);

            div.addEventListener("click", () => {
                if (!galleryEditMode) {
                    loadArtwork(art.id);
                }
            });

            gallery.appendChild(div);
        });
    };

    request.onerror = () => console.error("Failed to load gallery.");
}


document.getElementById("galleryEditButton").addEventListener("click", () => {
    galleryEditMode = !galleryEditMode;
    document.querySelectorAll(".gallery-item .delete-button").forEach(btn => {
        btn.style.display = galleryEditMode ? "block" : "none";
    });
    document.getElementById("galleryEditButton").textContent = galleryEditMode ? "Done" : "Edit";
});

document.getElementById("confirmDeleteButton").addEventListener("click", async () => {
    if (artworkToDeleteId !== null) {
        const db = await openDatabase();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(artworkToDeleteId);

        tx.oncomplete = () => {
            showStatusMessage("Artwork deleted!", "success");
            artworkToDeleteId = null;
            document.getElementById("deleteConfirmModal").style.display = "none";
            loadGallery();
        };

        tx.onerror = () => {
            console.error("Failed to delete artwork.");
            showStatusMessage("Error deleting artwork.", "error");
        };
    }
});

document.getElementById("cancelDeleteButton").addEventListener("click", () => {
    artworkToDeleteId = null;
    document.getElementById("deleteConfirmModal").style.display = "none";
});


//–––––––––––––––––––
// Profile
//–––––––––––––––––––

    const profileModal = document.getElementById("profileModal");
    const profileButton = document.getElementById("profileIconButton");
    const saveProfileButton = document.getElementById("saveProfileButton");
    const profileImageInput = document.getElementById("profileImageInput");
    const profileImagePreview = document.getElementById("profileImagePreview");
    const drawProfileButton = document.getElementById("drawProfileButton");

    function loadProfile() {
        const profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
        if (profileData.image) {
            profileImagePreview.style.backgroundImage = `url('${profileData.image}')`;

            const profileIconImg = document.querySelector("#profileIconButton img");
            if (profileIconImg) {
                profileIconImg.src = profileData.image;
            }
        } else {
            profileImagePreview.style.backgroundImage = `url('/static/draw/images/icons/cat.svg')`;

            const profileIconImg = document.querySelector("#profileIconButton img");
            if (profileIconImg) {
                profileIconImg.src = "/static/draw/images/icons/cat.svg";
            }
        }

        document.getElementById("profileNickname").value = profileData.nickname || "";
        document.getElementById("profileEmail").value = profileData.email || "";
        document.getElementById("profileBio").value = profileData.bio || "";
    }

    loadProfile()

    function saveProfile() {
        const backgroundImage = profileImagePreview.style.backgroundImage;
        const imageUrlMatch = backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        const imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;

        const profileData = {
            image: imageUrl,
            nickname: document.getElementById("profileNickname").value,
            email: document.getElementById("profileEmail").value,
            bio: document.getElementById("profileBio").value
        };
        localStorage.setItem("userProfile", JSON.stringify(profileData));

        nickname = profileData.nickname?.trim() || "";
        sendNicknameToServer();        
        
        showStatusMessage("Profile saved!", "success");
        closeModal(profileModal);
    }

    function showModal(modal) {
        modal.style.display = "flex";
        const closeButton = modal.querySelector(".close");
        if (closeButton && !closeButton.dataset.listenerAdded) {
            closeButton.addEventListener("click", () => closeModal(modal));
            closeButton.dataset.listenerAdded = "true";
        }
    }


    function closeModal(modal) {
        modal.style.display = "none";
    }

    // Profile button click
    profileButton.addEventListener("click", () => {
        loadProfile();
        showModal(profileModal);
    });

    // Save button
    saveProfileButton.addEventListener("click", saveProfile);

    // Avatar click opens file dialog
    profileImagePreview.addEventListener("click", () => {
        profileImageInput.click();
    });

    // Image upload
    profileImageInput.addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                const avatarDataURL = reader.result;

                profileImagePreview.style.backgroundImage = `url('${avatarDataURL}')`;

                const profileData = {
                    image: avatarDataURL,
                    nickname: document.getElementById("profileNickname").value,
                    email: document.getElementById("profileEmail").value,
                    bio: document.getElementById("profileBio").value
                };
                localStorage.setItem("userProfile", JSON.stringify(profileData));

                const profileIconImg = document.querySelector("#profileIconButton img");
                if (profileIconImg) {
                    profileIconImg.src = avatarDataURL;
                }

                // Save to gallery:
                fetch(avatarDataURL)
                    .then(res => res.blob())
                    .then(blob => {
                        const artwork = {
                            id: Date.now(),
                            name: "Profile",
                            date: new Date().toISOString(),
                            username: "User",
                            appName: "Web Paint",
                            image: blob,
                            thumbnail: avatarDataURL
                        };

                        openDatabase().then(db => {
                            const tx = db.transaction(STORE_NAME, "readwrite");
                            const store = tx.objectStore(STORE_NAME);
                            store.put(artwork);
                            showStatusMessage("Profile image saved to gallery!", "success");
                        });
                    });

            };
            reader.readAsDataURL(file);
        }
    });


/* Profile “Save from Canvas”
   Uses composeToCanvas(true) to match on-screen orientation; center-crops to square; updates preview and gallery. */
drawProfileButton.addEventListener("click", () => {
  try {
    const doc = composeToCanvas(true);
    if (!doc) { showStatusMessage?.("Profile export unavailable.", "error"); return; }

    const W = doc.width, H = doc.height;
    const size = Math.min(W, H);
    const sx = ((W - size) / 2) | 0;
    const sy = ((H - size) / 2) | 0;

    const sq = document.createElement("canvas");
    sq.width = size; sq.height = size;
    const sctx = sq.getContext("2d");
    sctx.drawImage(doc, sx, sy, size, size, 0, 0, size, size);

    const dataURL = sq.toDataURL("image/png");
    profileImagePreview.style.backgroundImage = `url('${dataURL}')`;
    const profileIconImg = document.querySelector("#profileIconButton img");
    if (profileIconImg) profileIconImg.src = dataURL;

    const profileData = {
      image: dataURL,
      nickname: document.getElementById("profileNickname").value,
      email: document.getElementById("profileEmail").value,
      bio: document.getElementById("profileBio").value
    };
    try { localStorage.setItem("userProfile", JSON.stringify(profileData)); } catch {}

    sq.toBlob((blob) => {
      if (!blob) { showStatusMessage?.("Profile save failed.", "error"); return; }
      const artwork = {
        id: Date.now(),
        name: "Profile",
        date: new Date().toISOString(),
        username: "User",
        appName: "Web Paint",
        image: blob,
        thumbnail: dataURL
      };
      openDatabase().then(db => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(artwork);
        showStatusMessage?.("Profile image saved.", "success");
      }).catch(err => {
        console.error("[Profile] gallery save error", err);
        showStatusMessage?.("Saved preview; gallery write failed.", "warning");
      });
    }, "image/png");
  } catch (e) {
    console.error("[Profile] compose/save failed", e);
    showStatusMessage?.("Profile export failed.", "error");
  }
});






//-------------
// Chat
//------------------------------------------------------------

const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatOverlay = document.getElementById("chatOverlay");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");

chatToggleBtn.addEventListener("click", () => {
    chatOverlay.classList.remove("hidden");
    //chatInput.focus();
});

chatCloseBtn.addEventListener("click", () => {
    chatOverlay.classList.add("hidden");
});

let socket = null;
let clientId = null;
let reconnectTimer = null;

let profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
let nickname = profileData.nickname?.trim() || "";
let profileImage = profileData.image || "";

const profileCache = new Map();

function updateChatButtonStatus(connected) {
    chatToggleBtn.style.borderColor = connected ? "limegreen" : "red";
}


let heartbeatTimer = null;
let lastPongTime = 0;

function connectWebSocket() {
    if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        socket = null;
    }

    let wsUrl = "";

    if (
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1" ||
        location.hostname.startsWith("172.") ||
        location.hostname.startsWith("192.168.")
    ) {
        const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
        const wsPort = 3001;
        wsUrl = `${wsProtocol}://${location.hostname}:${wsPort}`;
    } else {
        const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
        wsUrl = `${wsProtocol}://${location.host}/chat-ws/`;
    }

    ////console.log("[WebSocket] Connecting to:", wsUrl);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        ////console.log("[WebSocket] Connected");
        updateChatButtonStatus(true);

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        // start heartbeat timer
        lastPongTime = Date.now();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
                ////console.log("[WebSocket] Ping sent");

                // check pong timeout
                const now = Date.now();
                if (now - lastPongTime > 10000) {
                    console.warn("[WebSocket] Pong timeout — force reconnect");
                    socket.close();
                }
            }
        }, 3000);

        sendNicknameToServer();
    };

socket.onmessage = (event) => {
    ////console.log("[WebSocket] Message received:", event.data);

    try {
        let jsonStr = event.data;
        if (jsonStr.startsWith("[User] ")) {
            jsonStr = jsonStr.substring(7);
        }

        const msgObj = JSON.parse(jsonStr);

        if (msgObj.type === "welcome") {
            clientId = msgObj.clientId;
            ////console.log("[WebSocket] Assigned clientId:", clientId);
            updateChatUsers();
            return;
        }

        if (msgObj.type === "profile-update") {
            profileCache.set(msgObj.clientId, {
                nickname: msgObj.nickname,
                profileImage: msgObj.profileImage
            });
            ////console.log("[WebSocket] Profile update:", msgObj.clientId);
            updateChatUsers();
            return;
        }

        if (msgObj.type === "user-list") {
            profileCache.clear();
            msgObj.users.forEach(user => {
                profileCache.set(user.clientId, {
                    nickname: user.nickname,
                    profileImage: user.profileImage
                });
            });
            ////console.log("[WebSocket] User list update:", profileCache.size, "users");
            updateChatUsers();
            return;
        }

        if (msgObj.type === "pong") {
            lastPongTime = Date.now();
            ////console.log("[WebSocket] Pong received");
            return;
        }

        if (msgObj.type === "text") {
            const isOwnMessage = (msgObj.clientId === clientId);
            const type = isOwnMessage ? "sent" : "received";
            addChatMessage(msgObj, type);
            return;
        }

        if (msgObj.type === "image") {
            const senderProfile = profileCache.get(msgObj.clientId) || {};
            const sender = senderProfile.nickname || "Unknown";
            const avatar = senderProfile.profileImage
                ? `<img src="${senderProfile.profileImage}" class="chat-avatar">`
                : "";

            const color = colorFromClientId(msgObj.clientId);

            const msgDiv = document.createElement("div");
            msgDiv.className = "chat-message received";
            msgDiv.style.backgroundColor = color;

            msgDiv.innerHTML = `
                ${avatar} 
                <div class="chat-text">
                    <div>[${sender}]: posted artwork</div>
                    <img src="${msgObj.imageData}" alt="${msgObj.imageName}" style="max-width: 220px; max-height: 320px; margin-top: 5px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                </div>
            `;

            chatMessages.prepend(msgDiv);
            return;
        }

        if (msgObj.type === "system") {
            const sysMsg = {
                clientId: "",
                message: msgObj.message,
                timestamp: msgObj.timestamp
            };
            addChatMessage(sysMsg, "system");
            return;
        }

    } catch (err) {
        console.error("[WebSocket] Invalid message format", event.data);
    }
};


    socket.onclose = () => {
        //console.log("[WebSocket] Disconnected. Retrying in 3s...");
        updateChatButtonStatus(false);

        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }

        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
        console.error("[WebSocket] Error:", err);
    };
}

connectWebSocket();



function sendNicknameToServer() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
        nickname = profileData.nickname?.trim() || "";
        profileImage = profileData.image || "";

        socket.send(JSON.stringify({
            type: "set-nickname",
            nickname: nickname,
            profileImage: profileImage
        }));
    }
}

function updateChatUsers() {
    const chatUsers = document.getElementById("chatUsers");
    const chatUserBadge = document.getElementById("chatUserBadge");

    chatUsers.innerHTML = ""; // clear

    profileCache.forEach((profile, id) => {
        const div = document.createElement("div");
        div.className = "chat-user-item";

        const avatar = document.createElement("img");
        avatar.className = "chat-user-avatar";

        const defaultAvatar = "/static/draw/images/icons/cat.svg";

        // If image starts with 'data:', it's base64; otherwise, use the path or fallback
        if (profile.profileImage && profile.profileImage.startsWith("data:")) {
            avatar.src = profile.profileImage;
        } else if (profile.profileImage && profile.profileImage !== "") {
            avatar.src = profile.profileImage;
        } else {
            avatar.src = defaultAvatar;
        }

        const name = document.createElement("span");
        name.className = "chat-user-name";
        name.textContent = profile.nickname || "Unknown";

        div.appendChild(avatar);
        div.appendChild(name);
        chatUsers.appendChild(div);
    });

    // update badge
    const count = profileCache.size;
    if (chatUserBadge) {
        chatUserBadge.textContent = count;
        chatUserBadge.style.display = (count > 0) ? "flex" : "none";
    }
}



function sendImageToChat(imageDataURL) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const msgObj = {
            type: "image",
            clientId: clientId,
            imageDataURL: imageDataURL,
            timestamp: Date.now()
        };
        socket.send(JSON.stringify(msgObj));
    }
}


function sendMessage() {
    const message = chatInput.value.trim();
    if (message && socket && socket.readyState === WebSocket.OPEN) {
        const msgObj = {
            type: "text",
            clientId: clientId,
            message: message,
            timestamp: Date.now()
        };
        socket.send(JSON.stringify(msgObj));
        chatInput.value = "";

        // add own message to chat
        addChatMessage(msgObj, "sent");
    }
}


chatSendBtn.addEventListener("click", sendMessage);

chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
    }
});

marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false,
    sanitize: false
});

function addChatMessage(msgObj, type) {
    const senderProfile = profileCache.get(msgObj.clientId) || {};
    const sender = senderProfile.nickname || "Unknown";
    const avatar = senderProfile.profileImage
        ? `<img src="${senderProfile.profileImage}" class="chat-avatar">`
        : "";

    const color = colorFromClientId(msgObj.clientId);

    const timestamp = new Date(msgObj.timestamp || Date.now());
    const hh = String(timestamp.getHours()).padStart(2, '0');
    const mm = String(timestamp.getMinutes()).padStart(2, '0');
    const ss = String(timestamp.getSeconds()).padStart(2, '0');
    const timeStr = `${hh}:${mm}:${ss}`;

    const msgDiv = document.createElement("div");

    if (type === "system") {
        msgDiv.textContent = `*** ${msgObj.message} ***`;
        msgDiv.className = "chat-message system";
    } else {
        msgDiv.className = `chat-message ${type}`;
        msgDiv.style.backgroundColor = (type === "received") ? color : "";

        const rawHTML = marked.parse(msgObj.message);

        const safeHTML = DOMPurify.sanitize(rawHTML, {
            ADD_TAGS: ['pre', 'code'],
            ADD_ATTR: ['class']
        });

        msgDiv.innerHTML = `
            <div class="chat-timestamp">${timeStr}</div>
            <div class="chat-message-header">
                ${avatar}
                <span class="chat-sender-name">${sender}</span>
            </div>
            <div class="chat-message-body">${safeHTML}</div>
        `;

        msgDiv.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
        });
    }

    chatMessages.prepend(msgDiv);
}


function colorFromClientId(clientId) {
    let hash = 0;
    for (let i = 0; i < clientId.length; i++) {
        hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const color = `hsl(${hash % 360}, 70%, 80%)`;
    return color;
}




// function sendCurrentArtworkToChat(name = "Untitled", opts = {}) {
//   // === TWEAK HERE WHEN CALLING ===
//   const {
//     size = 1024,            // longest side in pixels; use 1 to keep original size
//     quality = 0.75,          // 0..1 (used for WebP/JPEG); ignored for PNG
//     format = "image/webp",  // "image/webp" | "image/jpeg" | "image/png"
//     includeBackground = true,
//     glFlipY = true          // set false if your composeToCanvas already matches screen
//   } = opts;

//   try {
//     console.log("[sendCurrentArtworkToChat] start");

//     // 1) Flatten to a single 2D canvas
//     let flattened = null;

//     if (typeof composeToCanvas === "function") {
//       flattened = composeToCanvas(includeBackground);
//       console.log("[sendCurrentArtworkToChat] Using composeToCanvas() flatten");
//     } else {
//       console.log("[sendCurrentArtworkToChat] composeToCanvas() missing; using fallback");
//       const offscreenCanvas = document.createElement("canvas");
//       offscreenCanvas.width = fixedFBOWidth;
//       offscreenCanvas.height = fixedFBOHeight;
//       const offscreenCtx = offscreenCanvas.getContext("2d");

//       // draw BG/currentImage if you have one
//       if (currentImage) {
//         offscreenCtx.drawImage(currentImage, 0, 0, fixedFBOWidth, fixedFBOHeight);
//       }

//       // bring GL layer
//       const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
//       gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
//       gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
//       gl.bindFramebuffer(gl.FRAMEBUFFER, null);

//       const tempCanvas = document.createElement("canvas");
//       tempCanvas.width = fixedFBOWidth;
//       tempCanvas.height = fixedFBOHeight;
//       const tempCtx = tempCanvas.getContext("2d");
//       tempCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), fixedFBOWidth, fixedFBOHeight), 0, 0);

//       // fix orientation (WebGL readPixels is bottom-left origin)
//       if (glFlipY) {
//         offscreenCtx.save();
//         offscreenCtx.translate(fixedFBOWidth / 2, fixedFBOHeight / 2);
//         offscreenCtx.scale(-1, -1);
//         offscreenCtx.rotate(Math.PI);
//         offscreenCtx.drawImage(tempCanvas, -fixedFBOWidth / 2, -fixedFBOHeight / 2);
//         offscreenCtx.restore();
//       } else {
//         offscreenCtx.drawImage(tempCanvas, 0, 0);
//       }

//       flattened = offscreenCanvas;
//     }

//     // 2) Target size
//     const targetMax = (size === 1) ? Math.max(flattened.width, flattened.height) : Math.max(1, Math.round(size));
//     const scale = Math.min(1, targetMax / Math.max(flattened.width, flattened.height));
//     const outW = Math.max(1, Math.round(flattened.width  * scale));
//     const outH = Math.max(1, Math.round(flattened.height * scale));

//     const previewCanvas = document.createElement("canvas");
//     previewCanvas.width = outW;
//     previewCanvas.height = outH;
//     const previewCtx = previewCanvas.getContext("2d");
//     previewCtx.drawImage(flattened, 0, 0, outW, outH);

//     const rawDataSize = flattened.width * flattened.height * 4;
//     console.log(`[sendCurrentArtworkToChat] Raw RGBA ~${Math.round(rawDataSize / 1024)} KB`);

//     // 3) Encode & send
//     const mime = format;
//     const q = quality;

//     previewCanvas.toBlob((blob) => {
//       if (!blob) {
//         console.error("[sendCurrentArtworkToChat] ERROR: Failed to generate blob.");
//         showStatusMessage("Error sending artwork to chat.", "error");
//         return;
//       }

//       console.log(`[sendCurrentArtworkToChat] Blob ${mime}, ${Math.round(blob.size/1024)} KB`);

//       const reader = new FileReader();
//       reader.onloadend = () => {
//         const imageDataURL = reader.result;
//         if (socket && socket.readyState === WebSocket.OPEN) {
//           const profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
//           const nickname = profileData.nickname?.trim() || "";
//           const profileImage = profileData.image || "";

//           const chatMsg = {
//             type: "image",
//             clientId,
//             nickname,
//             profileImage,
//             imageData: imageDataURL,
//             imageName: name,
//             timestamp: Date.now()
//           };

//           socket.send(JSON.stringify(chatMsg));
//           console.log("[sendCurrentArtworkToChat] Artwork sent to chat.");
//           showStatusMessage("Send to Chat", "info");
//         }
//       };

//       reader.readAsDataURL(blob);
//     }, mime, q);

//   } catch (error) {
//     console.error("[sendCurrentArtworkToChat] CATCH ERROR:", error);
//     showStatusMessage("Error sending artwork to chat.", "error");
//   }
// }




/* sendCurrentArtworkToChat(name, opts)
   Mobile-safe, budget-aware sender. Adapts format/quality/size to fit a JSON budget
   (mobile uses a higher budget and smaller start size). Always tries WebP, falls back to JPEG
   if encoder returns null. Logs each attempt (dims, quality, blob bytes, JSON bytes). */
async function sendCurrentArtworkToChat(name = "Untitled", opts = {}) {
  // device-adaptive defaults (can be overridden via opts)
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1);
  const {
    includeBackground = true,
    startLongest = isMobile ? 720 : 1024,   // px, starting longest side
    jsonBudgetBytes = isMobile ? 300_000 : 100_000, // final JSON size cap
    startQuality = 0.8,
    minQuality = 0.4,
    downscaleStep = 0.85,                   // dimension multiplier when shrinking
    maxAttempts = 16
  } = opts;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showStatusMessage?.("Chat not connected.", "warning");
    return;
  }

  // compose current artwork in document space (correct orientation)
  const src = (typeof composeToCanvas === "function") ? composeToCanvas(includeBackground) : null;
  if (!src) { showStatusMessage?.("Compose failed.", "error"); return; }

  const enc = new TextEncoder();
  const jsonSize = (obj) => enc.encode(JSON.stringify(obj)).length;
  const toBlobAsync = (canvas, mime, q) => new Promise(r => canvas.toBlob(b => r(b), mime, q));
  const asDataURL = (blob) => new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(blob); });

  // initial working size
  const longest = Math.max(src.width, src.height);
  const s0 = Math.min(1, (startLongest === 1 ? longest : startLongest) / longest);
  let outW = Math.max(1, Math.round(src.width  * s0));
  let outH = Math.max(1, Math.round(src.height * s0));

  let work = document.createElement("canvas");
  work.width = outW; work.height = outH;
  let wctx = work.getContext("2d");
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = "high";
  wctx.drawImage(src, 0, 0, outW, outH);

  // pick format: prefer WebP; if encoder returns null, switch to JPEG
  let fmt = "image/webp";
  let q = startQuality;

  const profileData = JSON.parse(localStorage.getItem("userProfile") || "{}");
  const nickname = (profileData.nickname || "").trim();

  console.log("[ChatSend] start", {
    device: isMobile ? "mobile" : "desktop",
    doc: `${src.width}x${src.height}`,
    start: `${outW}x${outH}`,
    budget: jsonBudgetBytes
  });

  const shrink = (factor) => {
    outW = Math.max(1, Math.round(outW * factor));
    outH = Math.max(1, Math.round(outH * factor));
    const c = document.createElement("canvas");
    c.width = outW; c.height = outH;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(work, 0, 0, outW, outH);
    work = c; wctx = ctx;
  };

  let attempt = 0;
  let sent = false;
  let lastStats = null;

  while (attempt < maxAttempts) {
    attempt++;

    // try current fmt/quality
    let blob = await toBlobAsync(work, fmt, q);
    if (!blob && fmt === "image/webp") {
      // Safari <= iOS 13 or some contexts: fall back to JPEG
      fmt = "image/jpeg";
      q = startQuality;
      blob = await toBlobAsync(work, fmt, q);
    }
    if (!blob && fmt === "image/jpeg") {
      // as a last resort: PNG (lossless, big) — immediately shrink after
      fmt = "image/png";
      blob = await toBlobAsync(work, fmt);
    }
    if (!blob) break;

    const dataURL = await asDataURL(blob);

    // Build the exact message (avatar omitted to keep payload small)
    const msgProbe = {
      type: "image",
      clientId,
      nickname,
      imageName: name,
      width: outW,
      height: outH,
      mime: fmt,
      imageData: dataURL,
      timestamp: Date.now()
    };
    const bytes = jsonSize(msgProbe);

    lastStats = { attempt, dims: `${outW}x${outH}`, fmt, q: q ?? "n/a", blob: blob.size, json: bytes };
    console.log("[ChatSend] try", lastStats);

    if (bytes <= jsonBudgetBytes) {
      socket.send(JSON.stringify(msgProbe));
      showStatusMessage?.("Sent image to chat", "info");
      console.log("[ChatSend] sent", lastStats);
      sent = true;
      break;
    }

    // adjust: reduce quality (for lossy), then shrink dimensions
    if ((fmt === "image/webp" || fmt === "image/jpeg") && q > minQuality + 1e-3) {
      q = Math.max(minQuality, q - 0.15);
      continue;
    }

    // if PNG (huge), switch to JPEG/WebP before shrinking further
    if (fmt === "image/png") {
      fmt = "image/jpeg"; // JPEG is widely supported on mobile
      q = startQuality;
      continue;
    }

    shrink(downscaleStep);
    q = startQuality;
  }

  if (!sent) {
    // last-mile emergency pass: force JPEG 0.55 and aggressively shrink until fit or tiny
    fmt = "image/jpeg";
    q = 0.55;
    let guard = 10;
    while (guard-- > 0) {
      const blob = await toBlobAsync(work, fmt, q);
      if (!blob) break;
      const dataURL = await asDataURL(blob);
      const msgProbe = {
        type: "image",
        clientId,
        nickname,
        imageName: name,
        width: outW,
        height: outH,
        mime: fmt,
        imageData: dataURL,
        timestamp: Date.now()
      };
      const bytes = jsonSize(msgProbe);
      console.log("[ChatSend] emergency", { dims: `${outW}x${outH}`, q, blob: blob.size, json: bytes });
      if (bytes <= jsonBudgetBytes) {
        socket.send(JSON.stringify(msgProbe));
        showStatusMessage?.("Sent image to chat", "info");
        return;
      }
      if (outW <= 240 || outH <= 240) break; // do not degrade further
      shrink(0.8);
    }

    console.warn("[ChatSend] failed to meet budget", { budget: jsonBudgetBytes, last: lastStats });
    showStatusMessage?.("Image too large for chat after compression.", "warning");
  }
}



document.getElementById("sendToChatButton").addEventListener("click", () => {
    sendCurrentArtworkToChat("Quick Share");
});






/* Min Max */


const brushSizeToggle = document.getElementById("brushSizeToggle");
const brushSizeSliderContainer = document.getElementById("brushSizeSliderContainer");

let minimized = localStorage.getItem("brushSizeToggleMinimized") === "true";


function updateBrushSizeToggleUI() {
  brushSizeSliderContainer.dataset.minimized = minimized ? "true" : "false";

  brushSizeSliderContainer.classList.remove("brush-panel-visible", "brush-panel-hidden");

  if (minimized) {
    brushSizeSliderContainer.classList.add("brush-panel-hidden");
    brushSizeToggle.innerHTML = `<img class="show-icon" src="/static/draw/images/icons/hide.svg" alt="Show">`;

    const rect = brushSizeSliderContainer.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.left < 0 || rect.top < 0 || rect.left > vw - 40 || rect.top > vh - 40) {
      brushSizeSliderContainer.style.left = "10px";
      brushSizeSliderContainer.style.top = "10px";
    }

  } else {
    brushSizeSliderContainer.classList.add("brush-panel-visible");
    brushSizeToggle.innerHTML = `<img class="show-icon" src="/static/draw/images/icons/show.svg" alt="Hide">`;;
  }
}

updateBrushSizeToggleUI();



brushSizeToggle.addEventListener("click", () => {
  minimized = !minimized;
  localStorage.setItem("brushSizeToggleMinimized", minimized);
  updateBrushSizeToggleUI();
});

updateBrushSizeToggleUI();

const brushContainerToggle = document.getElementById("brushContainerToggle");
const brushContainer = document.getElementById("brushContainer");

let brushContainerMinimized = localStorage.getItem("brushContainerMinimized") === "true";

function updateBrushContainerUI() {
  const thumbnails = brushContainer.querySelectorAll(".brush-thumbnail");
  thumbnails.forEach(thumb => {
    thumb.style.display = brushContainerMinimized ? "none" : "inline-block";
  });
  brushContainerToggle.innerHTML = brushContainerMinimized ? `<img class="show-icon" src="/static/draw/images/icons/hide.svg" alt="Show">` : `<img class="show-icon" src="/static/draw/images/icons/show.svg" alt="Hide">` 
}

brushContainerToggle.addEventListener("click", () => {
  brushContainerMinimized = !brushContainerMinimized;
  localStorage.setItem("brushContainerMinimized", brushContainerMinimized);
  updateBrushContainerUI();
});

updateBrushContainerUI();




//--------------
// Extra UI
//-------------

  const panel = document.getElementById("brushSizeSliderContainer");
  const dragBar = document.getElementById("brushSizeDragBar");

  // drag state for brush size panel (descriptive names, local scope)
  let brushSizeDragStartOffsetX = 0;
  let brushSizeDragStartOffsetY = 0;
  let brushSizeDragging = false;

dragBar.addEventListener("pointerdown", (e) => {
  // allow dragging even when minimized
  brushSizeDragging = true;
  brushSizeDragStartOffsetX = e.clientX - panel.offsetLeft;
  brushSizeDragStartOffsetY = e.clientY - panel.offsetTop;
  try { dragBar.setPointerCapture(e.pointerId); } catch {}
  dragBar.style.cursor = "grabbing";
});

dragBar.addEventListener("pointermove", (e) => {
  if (!brushSizeDragging) return;

  // target position before clamp
  const rawX = e.clientX - brushSizeDragStartOffsetX;
  const rawY = e.clientY - brushSizeDragStartOffsetY;

  // clamp to current viewport so panel never goes off-screen
  const vw = (window.visualViewport && window.visualViewport.width)  || window.innerWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const rect = panel.getBoundingClientRect();

  const clampedX = Math.min(Math.max(rawX, 0), vw - rect.width);
  const clampedY = Math.min(Math.max(rawY, 0), vh - rect.height);

  panel.style.left = `${clampedX}px`;
  panel.style.top  = `${clampedY}px`;
  panel.style.bottom = "auto";
});

dragBar.addEventListener("pointerup", (e) => {
  brushSizeDragging = false;
  try { dragBar.releasePointerCapture(e.pointerId); } catch {}
  dragBar.style.cursor = "grab";

  // final clamp on release
  const vw = (window.visualViewport && window.visualViewport.width)  || window.innerWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const rect = panel.getBoundingClientRect();

  const clampedX = Math.min(Math.max(panel.offsetLeft, 0), vw - rect.width);
  const clampedY = Math.min(Math.max(panel.offsetTop,  0), vh - rect.height);

  panel.style.left = `${clampedX}px`;
  panel.style.top  = `${clampedY}px`;
});

dragBar.addEventListener("pointercancel", () => {
  brushSizeDragging = false;
  dragBar.style.cursor = "grab";
});



const brushWrapper = document.getElementById("brushContainerWrapper");
const brushDragBar = document.getElementById("brushContainerDragBar");

// drag state for brush container panel (descriptive names, local scope)
let brushPanelDragStartOffsetX = 0;
let brushPanelDragStartOffsetY = 0;
let brushPanelDragging = false;

brushDragBar.addEventListener("pointerdown", (e) => {
  brushPanelDragging = true;
  brushPanelDragStartOffsetX = e.clientX - brushWrapper.offsetLeft;
  brushPanelDragStartOffsetY = e.clientY - brushWrapper.offsetTop;
  try { brushDragBar.setPointerCapture(e.pointerId); } catch {}
  brushDragBar.style.cursor = "grabbing";
});

brushDragBar.addEventListener("pointermove", (e) => {
  if (!brushPanelDragging) return;

  // target position before clamp
  const rawX = e.clientX - brushPanelDragStartOffsetX;
  const rawY = e.clientY - brushPanelDragStartOffsetY;

  // clamp to current viewport so panel never goes off-screen
  const vw = (window.visualViewport && window.visualViewport.width)  || window.innerWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const rect = brushWrapper.getBoundingClientRect();

  const clampedX = Math.min(Math.max(rawX, 0), vw - rect.width);
  const clampedY = Math.min(Math.max(rawY, 0), vh - rect.height);

  brushWrapper.style.left = `${clampedX}px`;
  brushWrapper.style.top  = `${clampedY}px`;
});

brushDragBar.addEventListener("pointerup", (e) => {
  brushPanelDragging = false;
  try { brushDragBar.releasePointerCapture(e.pointerId); } catch {}
  brushDragBar.style.cursor = "grab";

  // final clamp on release
  const vw = (window.visualViewport && window.visualViewport.width)  || window.innerWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const rect = brushWrapper.getBoundingClientRect();

  const clampedX = Math.min(Math.max(brushWrapper.offsetLeft, 0), vw - rect.width);
  const clampedY = Math.min(Math.max(brushWrapper.offsetTop,  0), vh - rect.height);

  brushWrapper.style.left = `${clampedX}px`;
  brushWrapper.style.top  = `${clampedY}px`;
});

brushDragBar.addEventListener("pointercancel", () => {
  brushPanelDragging = false;
  brushDragBar.style.cursor = "grab";
});





/* toggleUIVisibilityMode()
   Hides all UI except canvases and the #hideAllButton; toggles back on next call. */
function toggleUIVisibilityMode() {
  // install CSS once
  if (!document.getElementById("__uiHideStyle")) {
    const style = document.createElement("style");
    style.id = "__uiHideStyle";
    style.textContent = `
      /* hide any element that is neither a canvas nor an ancestor of a canvas,
         and keep the toggle button and its children visible */
      body.__ui_off :not(canvas):not(#hideAllButton):not(#hideAllButton *):not(:has(canvas)) {
        visibility: hidden !important;
      }
      /* canvases must remain interactive while UI is hidden */
      body.__ui_off canvas { pointer-events: auto !important; }
      /* ensure the toggle stays clickable above everything */
      #hideAllButton { z-index: 999999; }
    `;
    document.head.appendChild(style);
  }

  const off = document.body.classList.toggle("__ui_off");

  // optional: tooltip reflects current state
  const btn = document.getElementById("hideAllButton");
  if (btn) btn.title = off ? "Show UI" : "Hide UI";
}

// wire the top-left eye button to the toggle
document.getElementById("hideAllButton")?.addEventListener("click", toggleUIVisibilityMode);






/* Share */    

function shareCurrentArtwork() {
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = fixedFBOWidth;
    offscreenCanvas.height = fixedFBOHeight;
    const offscreenCtx = offscreenCanvas.getContext("2d");

    if (currentImage) {
        offscreenCtx.drawImage(currentImage, 0, 0, fixedFBOWidth, fixedFBOHeight);
    }

    const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = fixedFBOWidth;
    tempCanvas.height = fixedFBOHeight;
    const tempCtx = tempCanvas.getContext("2d");

    const imageData = new ImageData(new Uint8ClampedArray(pixels), fixedFBOWidth, fixedFBOHeight);
    tempCtx.putImageData(imageData, 0, 0);

    offscreenCtx.save();
    offscreenCtx.translate(fixedFBOWidth / 2, fixedFBOHeight / 2);
    offscreenCtx.scale(-1, -1);
    offscreenCtx.rotate(Math.PI);
    offscreenCtx.drawImage(tempCanvas, -fixedFBOWidth / 2, -fixedFBOHeight / 2);
    offscreenCtx.restore();

    offscreenCanvas.toBlob(async (blob) => {
        if (!blob) {
            showStatusMessage("Error generating artwork for sharing.", "error");
            return;
        }

        const file = new File([blob], "artwork.png", { type: "image/png" });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
                title: "Artwork",
                text: "Check out my artwork!",
                files: [file],
            }).catch(() => {
                showStatusMessage("Error sharing artwork.", "error");
            });
        } else {
            showStatusMessage("Sharing not supported on this device.", "error");
        }
    }, "image/png");
}

// Bind function to share button
//  old - replaced by modal
// document.getElementById("shareButton").addEventListener("click", shareCurrentArtwork);


/* Menu */



    const menuButton = document.getElementById("menuButton");
    const menuButtonsContainer = document.querySelector("#saveGalleryButtons .menuButtons");

    // Initial state: hidden
    menuButtonsContainer.style.display = "none";

    menuButton.addEventListener("click", () => {
        if (menuButtonsContainer.style.display === "none") {
            menuButtonsContainer.style.display = "flex";
        } else {
            menuButtonsContainer.style.display = "none";
        }
    });


    function showStatusMessage(message, type = "info") {

        console.log("showStatusMessage", message)

        const messageBubble = document.createElement("div");
        messageBubble.classList.add("status-message", type);
        messageBubble.innerText = message;

        document.body.appendChild(messageBubble);

        setTimeout(() => {
            messageBubble.classList.add("fade-out");
            setTimeout(() => messageBubble.remove(), 700);
        }, 700);
    }






    // Modal handling
    function showModal(modal) {
        modal.style.display = "flex";

        // Ensure event listeners are only added once
        setTimeout(() => {
            const closeButton = modal.querySelector(".close");
            if (closeButton && !closeButton.dataset.listenerAdded) {
                closeButton.addEventListener("click", () => closeModal(modal));
                closeButton.dataset.listenerAdded = "true";
            }
        }, 0);
    }



    function closeModal(modal) {
        modal.style.display = "none";
    }

    // Get modal elements and buttons
    const saveModal = document.getElementById("saveModal");
    const galleryModal = document.getElementById("galleryModal");
    const saveButton = document.getElementById("saveButton");
    const galleryButton = document.getElementById("galleryButton");
    const confirmSave = document.getElementById("confirmSave");

    // Check if elements exist before adding event listeners
    if (saveButton) saveButton.addEventListener("click", () => showModal(saveModal));
    if (galleryButton) galleryButton.addEventListener("click", () => { showModal(galleryModal);
        loadGallery(); });

    if (confirmSave) confirmSave.addEventListener("click", () => {
        const nameInput = document.getElementById("artworkName");
        saveArtwork(nameInput ? nameInput.value : "");
        closeModal(saveModal);
    });


    function resetView({ fit = true } = {}) {
      // Compute a scale that ensures the whole canvas is visible in the wrapper.
      const wrap = canvasWrapper.getBoundingClientRect();
      const cw = canvas.width;
      const ch = canvas.height;

      // Fit scale (respect zoomMin/zoomMax). If you prefer strict 1:1, set fit=false.
      const fitScale = Math.min(wrap.width / cw, wrap.height / ch, zoomMax);
      const targetScale = fit ? Math.max(zoomMin, fitScale) : 1;

      // Smooth snap
      const prev = canvas.style.transition;
      canvas.style.transition = "transform 140ms ease-out";

      zoomScale = targetScale;
      // Center with your existing helper
      centerCanvasInWrapper();

      // Clean up
      setTimeout(() => { canvas.style.transition = prev; }, 160);
      resetStrokeState();
      needsRedraw = true;
    }


    // document.getElementById("resetViewBtn").addEventListener("click", () => resetView({ fit: true }));
    // Reset View: also clears mobile input zoom (iOS/Android) by blurring focus and nudging viewport
    const resetViewBtn = document.getElementById("resetViewBtn");
    resetViewBtn.addEventListener("click", () => {
      // your existing view reset
      resetView({ fit: true });

      // 1) Blur any focused input to dismiss keyboard & stop sticky zoom
      if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }

      // 2) Nudge the viewport meta so mobile browsers snap back to 1.0
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta) {
        const original = meta.getAttribute("content") || "width=device-width, initial-scale=1";
        const base = original.replace(/,\s*maximum-scale=[^,]+/i, "");
        meta.setAttribute("content", `${base}, maximum-scale=1`);
        setTimeout(() => meta.setAttribute("content", original), 80);
      }
    });



    // Optional keyboard shortcut: press "0" to reset
    document.addEventListener("keydown", (e) => {
      if (isUserTyping()) return;
      if (e.key === "0") resetView({ fit: true });
    });



// the end of DOM

});




// Function to clear the strokes but leave the background image intact
// REPLACE ENTIRE FUNCTION: clearCanvas
async function clearCanvas(record = true) {
  const before = History._captureProject ? History._captureProject() : null;

  try {
    console.log("[Clear] start");

    // Dispose existing GL resources for layers
    try {
      if (Array.isArray(layers)) {
        layers.forEach(L => {
          try { gl.deleteTexture(L.texture); } catch {}
          try { gl.deleteFramebuffer(L.fbo); } catch {}
        });
      }
    } catch (e) {
      console.warn("[Clear] warning disposing old layers:", e);
    }

    // Compute current window size (CSS px)
    const vw = Math.max(1, (window.visualViewport?.width  | 0) || (window.innerWidth  | 0));
    const vh = Math.max(1, (window.visualViewport?.height | 0) || (window.innerHeight | 0));

    // Create a fresh base paper image exactly matching the window
    let img = null;
    if (typeof createPaperImage === "function") {
      try {
        img = await createPaperImage(vw, vh);
      } catch (e) {
        console.warn("[Clear] createPaperImage failed, falling back to flat paper:", e);
      }
    }
    if (!img) {
      const paper = document.createElement("canvas");
      paper.width = vw;
      paper.height = vh;
      const ctx = paper.getContext("2d");
      ctx.fillStyle = "#f2efe4";
      ctx.fillRect(0, 0, vw, vh);
      img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = paper.toDataURL("image/png");
      });
    }

    // Commit as current background & rebuild the document at this size
    currentImage     = img;
    fixedFBOWidth    = img.width;
    fixedFBOHeight   = img.height;

    if (typeof setDocumentSize === "function") {
      setDocumentSize(img.width, img.height);
    } else {
      canvas.width  = img.width;
      canvas.height = img.height;
      gl.viewport(0, 0, img.width, img.height);
    }

    // Re-init paint stack/FBOs at the new size
    try { initFloodFBOs?.(); } catch {}
    initPaintLayerFixed();

    // Upload background to GL
    try {
      // If there is an old background texture, drop it before replacing
      if (texture) { try { gl.deleteTexture(texture); } catch {} }
      createTextureFromImage(img);
    } catch (e) {
      console.error("[Clear] createTextureFromImage failed:", e);
    }

    // Resize on-screen canvas presentation and center view
    try { updateCanvasSize(img); } catch {}
    zoomScale = 1;
    panX = panY = 0;
    try { centerCanvasInWrapper?.(); } catch {}
    viewRotation = 0;
    try { updateCanvasTransform?.(); } catch {}

    // UI/state sync
    try { resetStrokeState?.(); } catch {}
    try { syncActiveAliases?.(); } catch {}
    try { rebuildLayersUI?.(); } catch {}
    try { showStatusMessage?.("New project created to match current window.", "success"); } catch {}

    needsRedraw = true;
    try { requestDrawIfIdle?.(); } catch {}

    console.log("[Clear] done", { w: img.width, h: img.height });
  } catch (e) {
    console.error("[Clear] fatal error:", e);
    try { showStatusMessage?.("Clear failed.", "error"); } catch {}
  }

  // Single undoable action (preserve existing history behavior)
  if (record && History._captureProject) {
    const after = History._captureProject();
    try { recordClearProject?.(before, after); } catch (e) {
      console.warn("[Clear] recordClearProject failed; pushing generic history entry:", e);
      try { History.push?.({ type: "clear_project", beforeAll: before, afterAll: after }); } catch {}
    }
  }
}




// — Reset page zoom caused by mobile input focus (iOS/Android)
// Works by briefly forcing maximum-scale=1, then restoring the original content.
function resetPageZoomFromInputs() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;

  const original = meta.getAttribute('content') || 'width=device-width, initial-scale=1';
  // strip any previous maximum-scale to avoid duplicates
  const base = original.replace(/,\s*maximum-scale=[^,]+/i, '');

  // Force zoom=1 momentarily
  meta.setAttribute('content', `${base}, maximum-scale=1`);
  // Restore original a tick later so normal pinch-zoom remains allowed
  setTimeout(() => meta.setAttribute('content', original), 80);
}

// — Blur any focused element (kills keyboard + cancels input-driven zoom)
function blurActiveElement() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}



function resetToCurrentWindow() {
  const vw = (window.visualViewport?.width  || window.innerWidth)  | 0;
  const vh = (window.visualViewport?.height || window.innerHeight) | 0;

  // build a paper texture that exactly matches the viewport
  const paper = document.createElement("canvas");
  paper.width = vw;
  paper.height = vh;
  const ctx = paper.getContext("2d");
  ctx.fillStyle = "#f2efe4";
  ctx.fillRect(0, 0, vw, vh);

  // light noise
  const noise = ctx.createImageData(vw, vh);
  for (let i = 0; i < noise.data.length; i += 4) {
    const n = (Math.random() * 40) | 0;
    noise.data[i+0] = 230 + n;
    noise.data[i+1] = 226 + n;
    noise.data[i+2] = 218 + n;
    noise.data[i+3] = 255;
  }
  ctx.globalAlpha = 0.15;
  ctx.putImageData(noise, 0, 0);
  ctx.globalAlpha = 1;

  // commit as current image
  const img = new Image();
  img.onload = () => {
    currentImage = img;

    // FIXED document size == viewport size
    fixedFBOWidth  = img.width;
    fixedFBOHeight = img.height;

    // rebuild FBOs/layers for the new doc size
    initFloodFBOs();
    initPaintLayerFixed();

    // resize on-screen canvas to fit (keeps aspect properly)
    updateCanvasSize(img);

    // upload background to GL
    createTextureFromImage(img);

    // hard reset zoom/pan and center
    zoomScale = 1;
    panX = panY = 0;
    centerCanvasInWrapper?.();
    resetStrokeState();

    needsRedraw = true;
    showStatusMessage("New document sized to window", "success");
  };
  img.src = paper.toDataURL("image/png");
}


// Event listener for the Clean button
//document.getElementById("cleanButton").addEventListener("click", clearCanvas);
document.getElementById("cleanButton").addEventListener("click", () => clearCanvas(true));



document.getElementById("artworkName").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        event.preventDefault(); // prevent form submission or newline
        document.getElementById("saveNewButton").click();
    }
});


const uiElements = [
  { id: "brushContainerWrapper", display: "flex" },
  { id: "brushSizeSliderContainer", display: "flex" },
  { id: "redoUndoButtons", display: "flex" },
  { id: "colorsContainer", display: "block" },
  { id: "saveGalleryButtons", display: "block" },
  { id: "profileSection", display: "block" },
  { id: "chatToggleBtn", display: "flex" },
  { id: "layersPanel", display: "block" } 
];


const fadeOutUI = () => {
  uiElements.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      el.style.opacity = "0"; // Start fading out
      setTimeout(() => {
        el.style.display = "none"; // Hide after fade-out completes
      }, 250); // Match the transition duration in CSS
    }
  });
};

const fadeInUI = () => {
  uiElements.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      el.style.display = item.display; // Show before fading in
      setTimeout(() => {
        el.style.opacity = "1"; // Fade in
      }, 10);
    }
  });
};

let uiTimeout = null;
const uiTimeoutInterval = 500;

const resetUITimeout = () => {
  if (uiTimeout) clearTimeout(uiTimeout);
  uiTimeout = setTimeout(fadeInUI, uiTimeoutInterval);
};

// --- Smarter UI hide: only after real drawing movement ---

let uiHidden = false;
let hideStart = null;            // {x, y} at pointer down
const HIDE_MOVE_THRESHOLD = 6;   // pixels in canvas space

function getCanvasPosFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const p = ("touches" in e ? e.touches[0] : e);
  return {
    x: (p.clientX - rect.left) * (canvas.width / rect.width),
    y: (p.clientY - rect.top)  * (canvas.height / rect.height)
  };
}

canvas.addEventListener("mousedown", (e) => {
  if (currentTool === 'fill') return; // taps for fill shouldn't hide UI
  hideStart = getCanvasPosFromEvent(e);
  uiHidden = false;
});

canvas.addEventListener("touchstart", (e) => {
  if (isTwoFingerGesture) return;     // ignore pinch/zoom
  if (currentTool === 'fill') return;
  hideStart = getCanvasPosFromEvent(e);
  uiHidden = false;
}, { passive: false });

// Hide once we detect actual drawing movement
function maybeHideUIOnMove(e) {
  if (!isDrawing || uiHidden || !hideStart) return;

  const pos = getCanvasPosFromEvent(("touches" in e ? e.touches[0] : e));
  const dx = pos.x - hideStart.x;
  const dy = pos.y - hideStart.y;
  if (Math.hypot(dx, dy) >= HIDE_MOVE_THRESHOLD) {
    fadeOutUI();
    if (uiTimeout) clearTimeout(uiTimeout);
    uiHidden = true;
  }
}

canvas.addEventListener("mousemove", maybeHideUIOnMove, { passive: true });
canvas.addEventListener("touchmove", (e) => {
  if (isTwoFingerGesture) return; // still ignore pinch/zoom
  maybeHideUIOnMove(e);
}, { passive: false });




function endStrokeUIReset() {
  // only schedule fade-in if UI was hidden during the stroke
  if (uiHidden) resetUITimeout();
  hideStart = null;
  uiHidden = false;
}

canvas.addEventListener("mouseup", endStrokeUIReset);
canvas.addEventListener("touchend", endStrokeUIReset);
canvas.addEventListener("mouseleave", endStrokeUIReset);


window.addEventListener("blur", resetUITimeout);
window.addEventListener("focus", fadeInUI);


document.getElementById("footer").innerHTML = document.title;



const panels = [
{
  id: "brushSizeSliderContainer",
  dragBarId: "brushSizeDragBar",
},
{
  id: "brushContainerWrapper",
  dragBarId: "brushContainerDragBar",
},
];

panels.forEach(({ id, dragBarId }) => {
const panel = document.getElementById(id);
const dragBar = document.getElementById(dragBarId);
if (!panel || !dragBar) return;

let offsetX = 0,
    offsetY = 0,
    isDragging = false;

// Restore saved position
const x = localStorage.getItem(`${id}-x`);
const y = localStorage.getItem(`${id}-y`);
if (x !== null && y !== null) {
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  panel.style.bottom = "auto";
}

dragBar.addEventListener("pointerdown", (e) => {
  isDragging = true;
  offsetX = e.clientX - panel.offsetLeft;
  offsetY = e.clientY - panel.offsetTop;
  dragBar.setPointerCapture(e.pointerId);
  dragBar.style.cursor = "grabbing";
});

dragBar.addEventListener("pointermove", (e) => {
  if (!isDragging) return;
  const newX = e.clientX - offsetX;
  const newY = e.clientY - offsetY;
  panel.style.left = `${newX}px`;
  panel.style.top = `${newY}px`;
  panel.style.bottom = "auto";
});

dragBar.addEventListener("pointerup", (e) => {
  isDragging = false;
  dragBar.releasePointerCapture(e.pointerId);
  dragBar.style.cursor = "grab";
  localStorage.setItem(`${id}-x`, panel.offsetLeft);
  localStorage.setItem(`${id}-y`, panel.offsetTop);
});

dragBar.addEventListener("pointercancel", () => {
  isDragging = false;
  dragBar.style.cursor = "grab";
});
});


//------------------
// AI - image2image
//------------------

function exportCanvasToImage() {
  const canvas = document.getElementById('glCanvas');
  if (!canvas) {
    alert('Canvas not found!');
    return null;
  }

  return canvas.toDataURL('image/png'); // Base64 PNG
}

function sendCanvasToFlaskForAI() {
  const imageData = exportCanvasToImage();
  if (!imageData) return;

  fetch('/run_ai_inference', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ image_data: imageData })
  })
  .then(res => res.blob())
  .then(blob => {
    const previewURL = URL.createObjectURL(blob);
    const preview = document.createElement('img');
    preview.src = previewURL;
    preview.style.position = 'fixed';
    preview.style.bottom = '10px';
    preview.style.right = '10px';
    preview.style.border = '2px solid #ccc';
    preview.style.maxWidth = '200px';
    preview.style.zIndex = 9999;
    document.body.appendChild(preview);
  })
  .catch(error => {
    console.error('Error during AI request:', error);
    alert('AI request failed.');
  });
}


// Clipboard: complete replacements (no external import routines required)

async function pasteImageFromClipboard(event) {
  console.log("[Clipboard] pasteImageFromClipboard start");
  try {
    let blob = null;

    if (event && event.clipboardData && event.clipboardData.items && event.clipboardData.items.length) {
      for (let i = 0; i < event.clipboardData.items.length; i++) {
        const it = event.clipboardData.items[i];
        if (it && it.type && it.type.startsWith("image/")) {
          blob = it.getAsFile ? it.getAsFile() : null;
          break;
        }
      }
    }

    if (!blob && navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith("image/")) {
              blob = await item.getType(type);
              break;
            }
          }
          if (blob) break;
        }
      } catch (e) {
        console.warn("[Clipboard] navigator.clipboard.read not permitted", e);
      }
    }

    if (!blob) {
      showStatusMessage?.("Clipboard has no image data.", "error");
      return;
    }

    const img = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      im.src = url;
    });

    if (!fixedFBOWidth || !fixedFBOHeight) {
      fixedFBOWidth  = img.width;
      fixedFBOHeight = img.height;
      if (typeof initPaintLayerFixed === "function") initPaintLayerFixed();
      if (typeof updateCanvasSize === "function") updateCanvasSize({ width: img.width, height: img.height });
      needsRedraw = true;
    }

    const L = (layers && Number.isInteger(activeLayerIndex)) ? layers[activeLayerIndex] : null;
    if (!L || !L.fbo) {
      showStatusMessage?.("No active layer to paste into.", "error");
      return;
    }

    const W = fixedFBOWidth;
    const H = fixedFBOHeight;

    (function _drawImageContainToFBO(image, fbo, w, h) {
      const sx = w / image.width;
      const sy = h / image.height;
      const scale = Math.min(sx, sy, 1);
      const drawW = Math.max(1, Math.round(image.width  * scale));
      const drawH = Math.max(1, Math.round(image.height * scale));
      const offX  = Math.floor((w - drawW) / 2);
      const offY  = Math.floor((h - drawH) / 2);

      const temp = document.createElement("canvas");
      temp.width = w;
      temp.height = h;
      const tctx = temp.getContext("2d");
      tctx.clearRect(0, 0, w, h);
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(image, 0, 0, image.width, image.height, offX, offY, drawW, drawH);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, temp);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn("[Clipboard] FBO incomplete:", status);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.deleteTexture(tex);
        return;
      }

      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(quadProgram);
      const flipLoc = gl.getUniformLocation(quadProgram, "u_flipY");
      if (flipLoc !== null) gl.uniform1f(flipLoc, 1.0);
      const resLoc = gl.getUniformLocation(quadProgram, "u_resolution");
      if (resLoc !== null) gl.uniform2f(resLoc, w, h);
      const opLoc = gl.getUniformLocation(quadProgram, "u_layerOpacity");
      if (opLoc !== null) gl.uniform1f(opLoc, 1.0);

      const verts = new Float32Array([
        0, 0,   0, 0,
        w, 0,   1, 0,
        0, h,   0, 1,
        0, h,   0, 1,
        w, 0,   1, 0,
        w, h,   1, 1
      ]);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(quadProgram, "a_position");
      const texLoc = gl.getAttribLocation(quadProgram, "a_texCoord");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const uTex = gl.getUniformLocation(quadProgram, "u_texture");
      if (uTex !== null) gl.uniform1i(uTex, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.disableVertexAttribArray(posLoc);
      gl.disableVertexAttribArray(texLoc);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.deleteBuffer(buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteTexture(tex);
    })(img, L.fbo, W, H);

    syncActiveAliases?.();
    rebuildLayersUI?.();
    needsRedraw = true;
    showStatusMessage?.("Pasted image into active layer.", "success");
    console.log("[Clipboard] Paste complete");
  } catch (err) {
    console.error("pasteImageFromClipboard error", err);
    showStatusMessage?.("Paste failed.", "error");
  }
}

async function copyActiveLayerToClipboard() {
  console.log("[Clipboard] copyActiveLayerToClipboard start");
  try {
    if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem)) {
      showStatusMessage?.("Clipboard copy not supported.", "error");
      return;
    }

    const L = (layers && Number.isInteger(activeLayerIndex)) ? layers[activeLayerIndex] : null;
    if (!L || !L.fbo) {
      showStatusMessage?.("No active layer to copy.", "error");
      return;
    }

    const w = fixedFBOWidth, h = fixedFBOHeight;

    const temp = document.createElement("canvas");
    temp.width = w; temp.height = h;
    const tctx = temp.getContext("2d");
    tctx.putImageData(readFBOToImageData(L.fbo, w, h), 0, 0);

    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const octx = out.getContext("2d");
    octx.save();
    octx.translate(w / 2, h / 2);
    octx.scale(-1, -1);
    octx.rotate(Math.PI);
    octx.drawImage(temp, -w / 2, -h / 2);
    octx.restore();

    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
    if (!blob) {
      showStatusMessage?.("Copy failed (no data).", "error");
      return;
    }

    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showStatusMessage?.("Active layer copied to clipboard.", "success");
    console.log("[Clipboard] Copy complete");
  } catch (err) {
    console.error("copyActiveLayerToClipboard error", err);
    showStatusMessage?.("Copy to clipboard failed.", "error");
  }
}


// Helpers (local-only, no globals)
async function _readClipboardImage(event) {
  // Prefer event.clipboardData (Ctrl/Cmd+V)
  if (event && event.clipboardData && event.clipboardData.items && event.clipboardData.items.length) {
    for (let i = 0; i < event.clipboardData.items.length; i++) {
      const it = event.clipboardData.items[i];
      if (it && it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile ? it.getAsFile() : null;
        if (f) return f;
      }
    }
  }
  // Fallback: async read() if permitted
  if (navigator.clipboard && navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            if (blob) return blob;
          }
        }
      }
    } catch (e) {
      console.warn("[Clipboard] navigator.clipboard.read not permitted", e);
    }
  }
  return null;
}

function _blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Event wiring (reuses existing app; no UI changes)
document.addEventListener("paste", (e) => {
  const hasImage = !!(e && e.clipboardData && [...e.clipboardData.items].some(it => it.type.startsWith("image/")));
  if (hasImage) {
    e.preventDefault();
    pasteImageFromClipboard(e);
  }
});

document.addEventListener("copy", (e) => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod   = isMac ? e.metaKey : e.ctrlKey;
  // Use Ctrl/Cmd+Shift+C to copy active layer image (does not interfere with plain text copy)
  if (mod && e.shiftKey === true) {
    e.preventDefault();
    copyActiveLayerToClipboard();
  }
});

// Optional fallback: if native paste event didn't deliver the image, try programmatic read
document.addEventListener("keydown", (e) => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod   = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === "v") {
    setTimeout(async () => {
      if (navigator.clipboard && navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read();
          const hasImg = items.some(it => it.types.some(t => t.startsWith("image/")));
          if (hasImg) pasteImageFromClipboard(null);
        } catch (_) { /* permission denied is fine */ }
      }
    }, 0);
  }
});









// // --- Layers Panel: drag + collapse + persist ---
// (function setupLayersPanel() {
//   const panel  = document.getElementById("layersPanel");
//   if (!panel) return;

//   const header = panel.querySelector(".layers-header");
//   const actions= panel.querySelector(".layers-actions");
//   const list   = document.getElementById("layersList");

//   // Positioning
//   panel.style.position = panel.style.position || "fixed";
//   panel.style.zIndex = panel.style.zIndex || "30";
//   if (!panel.style.left) panel.style.left = "16px";
//   if (!panel.style.top)  panel.style.top  = "16px";

//   // Persist keys
//   const KEY_MIN = "layersPanel:minimized";
//   const KEY_X   = "layersPanel:x";
//   const KEY_Y   = "layersPanel:y";

//   // Restore position
//   const px = localStorage.getItem(KEY_X);
//   const py = localStorage.getItem(KEY_Y);
//   if (px !== null && py !== null) {
//     panel.style.left = `${+px}px`;
//     panel.style.top  = `${+py}px`;
//   }

//   // Toggle button (injected, no HTML change)
//   let toggleBtn = document.getElementById("layersPanelToggle");
//   if (!toggleBtn) {
//     toggleBtn = document.createElement("button");
//     toggleBtn.id = "layersPanelToggle";
//     toggleBtn.className = "bs";
//     toggleBtn.title = "Show/Hide Layers";
//     toggleBtn.style.minWidth = "28px";
//     toggleBtn.style.display = "inline-flex";
//     toggleBtn.style.alignItems = "center";
//     toggleBtn.style.justifyContent = "center";
//     toggleBtn.innerHTML = `<img class="show-icon-invert" src="/static/draw/images/icons/show.svg" alt="Hide">`;
//     actions?.appendChild(toggleBtn);
//   }

//   // Minimized state
//   let minimized = localStorage.getItem(KEY_MIN) === "true";
//   function applyMin() {
//     if (list) list.style.display = minimized ? "none" : "block";
//     toggleBtn.innerHTML = minimized
//       ? `<img class="show-icon0invert" src="/static/draw/images/icons/hide.svg" alt="Show">`
//       : `<img class="show-icon-invert" src="/static/draw/images/icons/show.svg" alt="Hide">`;
//   }
//   applyMin();

//   toggleBtn.addEventListener("click", (e) => {
//     e.stopPropagation();
//     minimized = !minimized;
//     localStorage.setItem(KEY_MIN, minimized);
//     applyMin();
//   });

//   // Dragging via header (ignore clicks on buttons/inputs inside header)
//   let dragging = false, offX = 0, offY = 0;

//   function clampToViewport(x, y) {
//     const rect = panel.getBoundingClientRect();
//     const vw = window.innerWidth;
//     const vh = window.innerHeight;
//     const nx = Math.min(Math.max(8 - rect.width * 0.5, x), vw - 8 - rect.width * 0.5);
//     const ny = Math.min(Math.max(8, y), vh - 8);
//     return { x: nx, y: ny };
//   }

//   header.style.cursor = "grab";

//   header.addEventListener("pointerdown", (e) => {
//     // let header buttons work normally
//     if (e.target.closest("button,input,select,label")) return;
//     dragging = true;
//     offX = e.clientX - panel.offsetLeft;
//     offY = e.clientY - panel.offsetTop;
//     try { header.setPointerCapture(e.pointerId); } catch {}
//     header.style.cursor = "grabbing";
//   });

//   header.addEventListener("pointermove", (e) => {
//     if (!dragging) return;
//     const { x, y } = clampToViewport(e.clientX - offX, e.clientY - offY);
//     panel.style.left = `${x}px`;
//     panel.style.top  = `${y}px`;
//     panel.style.right = "auto";
//     panel.style.bottom = "auto";
//   });

//   function stopDrag(e) {
//     if (!dragging) return;
//     dragging = false;
//     try { header.releasePointerCapture(e.pointerId); } catch {}
//     header.style.cursor = "grab";
//     localStorage.setItem(KEY_X, String(panel.offsetLeft));
//     localStorage.setItem(KEY_Y, String(panel.offsetTop));
//   }
//   header.addEventListener("pointerup", stopDrag);
//   header.addEventListener("pointercancel", stopDrag);

//   // If restored off-screen (e.g., after resize), nudge back in
//   function nudgeIntoView() {
//     const r = panel.getBoundingClientRect();
//     const vw = window.innerWidth, vh = window.innerHeight;
//     let x = panel.offsetLeft, y = panel.offsetTop, nudged = false;
//     if (r.right < 40) { x = 16; nudged = true; }
//     if (r.bottom < 40) { y = 16; nudged = true; }
//     if (r.left > vw - 40) { x = vw - r.width - 16; nudged = true; }
//     if (r.top  > vh - 40) { y = vh - r.height - 16; nudged = true; }
//     if (nudged) {
//       panel.style.left = `${x}px`;
//       panel.style.top  = `${y}px`;
//       localStorage.setItem(KEY_X, String(x));
//       localStorage.setItem(KEY_Y, String(y));
//     }
//   }
//   window.addEventListener("resize", nudgeIntoView);
//   nudgeIntoView();
// })();


// --- Layers Panel: drag + collapse + persist (drag bar version) ---
(function setupLayersPanel() {
  const panel  = document.getElementById("layersPanel");
  const dragBar = document.getElementById("layersPanelDragBar");
  const list    = document.getElementById("layersList");
  const actions    = document.getElementById("layersActions");
  const toggle  = document.getElementById("layersPanelToggle");
  if (!panel || !dragBar) return;

  // Persist keys (compatible with older builds)
  const KEY_MIN = "layersPanel:minimized";
  const KEY_X   = "layersPanel:x";
  const KEY_Y   = "layersPanel:y";

  // Restore position (don’t fight CSS defaults if nothing saved)
  const px = localStorage.getItem(KEY_X);
  const py = localStorage.getItem(KEY_Y);
  if (px !== null && py !== null) {
    panel.style.left = `${+px}px`;
    panel.style.top  = `${+py}px`;
    panel.style.bottom = "auto";
  }

  // Restore minimized state
  let minimized = localStorage.getItem(KEY_MIN) === "true";

  function applyMin() {

    if (list) list.style.display = minimized ? "none" : "flex";
    if (actions) actions.style.display = minimized ? "none" : "flex";
    
    if (toggle) {
      toggle.innerHTML = minimized
        ? `<img class="show-icon-invert" src="/static/draw/images/icons/hide.svg" alt="Show">`
        : `<img class="show-icon-invert" src="/static/draw/images/icons/show.svg" alt="Hide">`;
    }
  }
  applyMin();

  if (toggle) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      minimized = !minimized;
      localStorage.setItem(KEY_MIN, minimized);
      applyMin();
    });
  }

  // Drag (pointer events). Avoid starting drag on buttons/inputs inside the bar.
  let dragging = false, offsetX = 0, offsetY = 0;

  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  function onDown(e) {
    // Only start drag if the down target is the bar or its grip/spacer
    const el = e.target;
    if (el.closest && el.closest(".icon-btn")) return;
    dragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
    try { dragBar.setPointerCapture(e.pointerId); } catch {}
    dragBar.style.cursor = "grabbing";
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const newX = clamp(e.clientX - offsetX, 0, vw - panel.offsetWidth);
    const newY = clamp(e.clientY - offsetY, 0, vh - panel.offsetHeight);
    panel.style.left   = `${newX}px`;
    panel.style.top    = `${newY}px`;
    panel.style.bottom = "auto";
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    try { dragBar.releasePointerCapture(e.pointerId); } catch {}
    dragBar.style.cursor = "grab";
    localStorage.setItem(KEY_X, panel.offsetLeft);
    localStorage.setItem(KEY_Y, panel.offsetTop);
  }

  dragBar.style.cursor = "grab";
  dragBar.addEventListener("pointerdown", onDown);
  dragBar.addEventListener("pointermove", onMove);
  dragBar.addEventListener("pointerup", onUp);
  dragBar.addEventListener("pointercancel", onUp);

  // Ensure the list is flex after DOM replacements
  try { if (list && getComputedStyle(list).display === "block") list.style.display = "flex"; } catch {}

  // Rebuild list once so UI reflects current layers
  try { rebuildLayersUI?.(); } catch {}
})();





// INITIALIZE & START
//–––––––––––––––––––
initGL();
loadDefaultImage();
loadBrushes();
createBrushThumbnails();

// Instead of calling drawScene() directly, use the render loop:
//let needsRedraw = true; // Global flag indicating when to redraw

function renderLoop() {
    if (needsRedraw) {
        drawScene();
        console.log("renderLoop")
        needsRedraw = false; // Reset after drawing
    }
    requestAnimationFrame(renderLoop);
}

renderLoop();


// SHORTCUTS MENU
//–––––––––––––––––––

window.addEventListener("keydown", (e) => {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  // F1 → open full Help
  if (e.key === "F1") {
    e.preventDefault();
    openHelpModal(); // your function
  }

  // Shift+/ → '?' quick help
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
    e.preventDefault();
    openQuickHelpOverlay(); // your function
  }

  // Ctrl+/ (Cmd+/ on Mac) → quick help
  if ((isMac ? e.metaKey : e.ctrlKey) && e.key === "/") {
    e.preventDefault();
    openQuickHelpOverlay();
  }
});

