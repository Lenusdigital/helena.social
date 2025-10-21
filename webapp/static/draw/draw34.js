console.log("Helena Paint - draw30.js")

function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}


let lastX = null;
let lastY = null;


const canvas = document.getElementById("glCanvas");

/*
    Zooming canvas – no timers
*/

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

const canvasWrapper = document.getElementById("canvasWrapper") || canvas.parentElement;
canvas.style.transformOrigin = "top left";

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

// === ADD: gate to block painting during transforms/panning/UI drags ===
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



// NEW: view (UI) rotation in radians. Does NOT touch paint/layers data.
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
// call maybeAutoHideBrushHUD() at the end of drawScene() (see patch below)



// function updateCanvasTransform() {
//     canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
//     canvas.style.transformOrigin = "top left";
// }




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
// =================================



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


//–––––––––––––––––––
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


function initGL() {
  if (!gl) { console.error("WebGL not supported."); return; }
  // If you kept the original quadFS, this still works.
  // If you adopted the opacity-aware fragment shader, remember to set u_layerOpacity before drawing each layer.
  quadProgram   = createProgram(gl, quadVS, quadFS);
  paintProgram  = createProgram(gl, quadVS, paintFS);
  overlayProgram= createProgram(gl, quadVS, overlayFS);
}

// Per-layer FBO/texture
function createLayerFBO(width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  // Use linear filtering for smoother scaling
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
  const { texture, fbo } = createLayerFBO(fixedFBOWidth, fixedFBOHeight);
  const layer = {
    id: Date.now() + Math.random(),
    name, fbo, texture,
    visible: true, opacity: 1,
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
    px: fixedFBOWidth * 0.5, py: fixedFBOHeight * 0.5,
    history: [], redo: []
  };

  // insert BEFORE the current layer index → ends up *below* it in the stack
  const pos = Math.max(0, Math.min(insertBelowIndex, layers.length));
  layers.splice(pos, 0, layer);

  // make the new layer active (or set = pos+1 to keep the old one active)
  activeLayerIndex = pos;

  syncActiveAliases();
  if (typeof rebuildLayersUI === "function") rebuildLayersUI();
  needsRedraw = true;
}



function drawLayerWithTransform(program, layer) {
  const W = fixedFBOWidth, H = fixedFBOHeight;

  // doc→screen scale
  const sx = canvas.width  / W;
  const sy = canvas.height / H;

  // pivot in document px
  const pivX = Number.isFinite(layer.px) ? layer.px : W * 0.5;
  const pivY = Number.isFinite(layer.py) ? layer.py : H * 0.5;

  const corners = [
    {x:0, y:0}, {x:W, y:0},
    {x:0, y:H}, {x:W, y:H}
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

function endTransform(bake = true) {
  // Fast exit if nothing was in progress
  const wasActive = (transformTool?.mode && transformTool.mode !== "idle");
  if (!wasActive) return;

  // Stop any transform-dedicated raf/render loops first
  try {
    if (transformTool.rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(transformTool.rafId);
      transformTool.rafId = null;
    }
  } catch (e) {
    console.warn("[endTransform] RAF cleanup warning:", e);
  }
  try {
    stopRender?.("transform");
  } catch (e) {
    console.warn("[endTransform] stopRender warning:", e);
  }

  // Snapshot the layer reference before we mutate anything
  const layerBefore = getActiveLayer?.();

  // Decide whether to bake:
  // - Only if caller requested it
  // - Only if we have a valid active layer
  // - Only once per gesture (guard against accidental double-apply)
  let didBake = false;
  if (bake && layerBefore && !transformTool.__didBakeOnce) {
    try {
      applyActiveLayerTransform?.();
      resetStrokeState?.();
      didBake = true;
      transformTool.__didBakeOnce = true; // gesture-scope guard
    } catch (e) {
      console.error("[endTransform] apply/bake failed; keeping transform unbaked:", e);
      didBake = false;
    }
  }

  // User feedback
  try {
    showStatusMessage?.(didBake ? "Transform applied" : (bake ? "Transform failed" : "Transform cancelled"),
                        didBake ? "success" : (bake ? "warning" : "info"));
  } catch (_) {}

  // Clear transient gesture state (be thorough but safe)
  try { transformTool.start = null; } catch(_) {}
  try { transformTool.ref   = null; } catch(_) {}
  try { transformTool.delta = null; } catch(_) {}
  try { transformTool.center= null; } catch(_) {}
  try { transformTool.tempMatrix = transformTool.identityMatrix || null; } catch(_) {}
  try { transformTool.bounds = null; } catch(_) {}
  try { transformTool.handle = null; } catch(_) {}
  try { transformTool.__didBakeOnce = false; } catch(_) {}
  try { transformTool.lastEventTs = null; } catch(_) {}

  // Multitouch flags
  try { isTwoFingerGesture = false; } catch(_) {}
  try { pinchStart = null; } catch(_) {}

  // Cursor / affordances
  try { setCursor?.("default"); } catch(_) {}

  // Determine if we should stay armed based on *current* active layer
  // (re-fetch in case bake switched the active or changed flags).
  const layerAfter = getActiveLayer?.();
  const stayArmed = !!(layerAfter && layerAfter.transformLocked);

  // Flip mode to idle before UI updates to avoid race conditions
  try { transformTool.mode = "idle"; } catch(_) {}

  // Helper: toggle active class on the active layer's transform button
  const setTransformBtnActive = (active) => {
    try {
      const list = document.getElementById("layersList");
      if (!list) return;
      const rows = list.querySelectorAll(".layer-item");
      rows.forEach((row) => {
        const idxAttr = row.getAttribute("data-index");
        if (idxAttr !== null && Number(idxAttr) === activeLayerIndex) {
          const btn = row.querySelector(".transform-btn");
          if (btn) btn.classList.toggle("is-active", !!active);
        }
      });
    } catch (e) {
      console.warn("[endTransform] UI toggle warning:", e);
    }
  };

  if (stayArmed) {
    // Keep combo armed and button highlighted for mobile "sticky" transform
    try { transformTool.mobileCombo = true; } catch(_) {}
    setTransformBtnActive(true);

    // Re-arm to grab mode on the next tick to avoid reentrancy
    // with callers that are still in pointer handlers.
    const rearm = () => { try { startTransform?.("grab"); } catch (e) { console.warn("[endTransform] re-arm warning:", e); } };
    if (typeof queueMicrotask === "function") queueMicrotask(rearm);
    else setTimeout(rearm, 0);
  } else {
    // Fully deactivate UI highlight
    setTransformBtnActive(false);
    try { transformTool.mobileCombo = false; } catch(_) {}
  }

  // Final: request redraw
  needsRedraw = true;
  try { requestDrawIfIdle?.(); } catch(_) {}
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

  // ensure background paper is present after a full reset
  if (!texture) {
    if (currentImage) createTextureFromImage(currentImage);
    else loadDefaultImage();
  }

  needsRedraw = true;
}


function duplicateLayer(srcIndex = activeLayerIndex) {
  if (!layers.length) return;

  // clamp + choose source
  srcIndex = Math.max(0, Math.min(srcIndex, layers.length - 1));
  const src = layers[srcIndex];
  if (!src || !gl.isFramebuffer(src.fbo) || !gl.isTexture(src.texture)) {
    console.warn("[duplicateLayer] invalid source layer");
    return;
  }

  // create target FBO/texture
  const { texture: dstTex, fbo: dstFbo } = createLayerFBO(fixedFBOWidth, fixedFBOHeight);

  // blit source → target (GPU copy)
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
  gl.blitFramebuffer(
    0, 0, fixedFBOWidth, fixedFBOHeight,
    0, 0, fixedFBOWidth, fixedFBOHeight,
    gl.COLOR_BUFFER_BIT, gl.NEAREST
  );
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  // new layer object (copy settings; reset transform pivot to center)
  const newLayer = {
    id: Date.now() + Math.random(),
    name: `${src.name} copy`,
    fbo: dstFbo,
    texture: dstTex,
    visible: src.visible,
    opacity: src.opacity,

    x: src.x ?? 0,
    y: src.y ?? 0,
    scaleX: src.scaleX ?? 1,
    scaleY: src.scaleY ?? 1,
    rotation: src.rotation ?? 0,

    px: fixedFBOWidth * 0.5,
    py: fixedFBOHeight * 0.5,

    history: [],
    redo: []
  };

  // insert just above source, select it
  const insertPos = Math.min(srcIndex + 1, layers.length);
  layers.splice(insertPos, 0, newLayer);
  activeLayerIndex = insertPos;
  syncActiveAliases?.();
  rebuildLayersUI?.();

  showStatusMessage?.(`Duplicated: ${src.name}`, "success");


  rebuildLayersUI?.();

  showStatusMessage?.(`Duplicated: ${src.name}`, "success");

  // ⬇️ Immediately enter grab mode like Blender
  startTransform("grab");
  // optional tiny nudge so it’s visibly separate:
  const L = getActiveLayer();
  if (L) { L.x = (L.x || 0) + 5; L.y = (L.y || 0) + 5; needsRedraw = true; }

  // keep RAF alive while user moves
  startRender("transform");

  needsRedraw = true;
}


document.addEventListener("keydown", (e) => {
  if (isUserTyping()) return;
  if (spacePanning || isDrawing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Shift + D → duplicate active layer
  if (e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    e.stopImmediatePropagation();
    duplicateLayer(activeLayerIndex);
    return;
  }
}, { capture: true });




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



// function updateCanvasSize(image) {
//   if (!image) return;

//   const windowAspect = window.innerWidth / window.innerHeight;
//   const imgAspect    = image.width / image.height;

//   let newWidth, newHeight;
//   if (imgAspect > windowAspect) {
//     newWidth  = window.innerWidth;
//     newHeight = window.innerWidth / imgAspect;
//   } else {
//     newHeight = window.innerHeight;
//     newWidth  = window.innerHeight * imgAspect;
//   }

//   // apply new canvas size + GL viewport
//   canvas.width  = Math.round(newWidth);
//   canvas.height = Math.round(newHeight);
//   gl.viewport(0, 0, canvas.width, canvas.height);

//   // keep brush UI scale sensible
//   if (typeof updateBrushSize === "function") updateBrushSize();

//   // make sure overlayPosition stays valid after resize
//   if (Array.isArray(overlayPosition) && overlayPosition.length === 2) {
//     overlayPosition[0] = Math.min(1, Math.max(0, overlayPosition[0]));
//     overlayPosition[1] = Math.min(1, Math.max(0, overlayPosition[1]));
//   }

//   // refresh CSS transform (zoom/pan) and recenter if it drifted
//   if (typeof updateCanvasTransform === "function") updateCanvasTransform();
//   if (typeof ensureCanvasNotLost === "function") ensureCanvasNotLost();

//   // very important: clear last stroke anchors so angle/lines use fresh deltas
//   resetStrokeState();

//   needsRedraw = true;
// }



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
    let bufferSize = audioCtx.sampleRate * 0.5;
    let buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    let data = buffer.getChannelData(0);
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
    filterNode.frequency.value = 400 + strokeSpeed * 300;
    filterNode.Q.value = 2.5;

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
    filterNode.frequency.value = 400 + strokeSpeed * 300;
    gainNode.gain.linearRampToValueAtTime(Math.min(0.15, 0.05 * strokeSpeed), audioCtx.currentTime + 0.05);
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

// **Fix Pointer & Touch Tracking**

// ===== POINTER / COORD HELPERS (canonical) =====





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



// === REPLACE ENTIRE BLOCK: unified painting input handlers (keeps comments) ===
// /* ==== Painting input (unified, no idle-hover redraw) ==== */
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
/* ==== END painting input ==== */




function isUserTyping() {
    const activeElement = document.activeElement;
    return activeElement && (
        activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable
    );
}



//–––––––––––––––––––
// BRUSH SWITCHING (keys 1,2,3 …)
//–––––––––––––––––––
document.addEventListener("keydown", (event) => {
    if (isUserTyping()) return;
  let shouldRedraw = false;
  if (event.key === "[") {
    brushSize = Math.max(0.01, brushSize - 0.02);
    brushSizeSlider.value = brushSize;
    shouldRedraw = true;

    overlayPosition = [lastPointer.cx / canvas.width, lastPointer.cy / canvas.height];
    showBrushHUD(); // persists past mouseup; will auto-hide after idle

  } else if (event.key === "]") {
    brushSize = Math.min(1.0, brushSize + 0.02);
    brushSizeSlider.value = brushSize;
    shouldRedraw = true;

    overlayPosition = [lastPointer.cx / canvas.width, lastPointer.cy / canvas.height];
    showBrushHUD(); // persists past mouseup; will auto-hide after idle


  } else if (!isNaN(event.key)) {
    let index = parseInt(event.key) - 1;
    if (index >= 0 && index < brushTextures.length) {
      currentBrushIndex = index;
      overlayTexture = brushTextures[index];
      brushAspect = brushAspects[index];
      shouldRedraw = true;
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





// function rebuildLayersUI() {
//   const list = document.getElementById("layersList");
//   if (!list) return;

//   // ——— ONE-TIME mobile layer-transform touch handlers (capture phase to override view pinch) ———
//   if (!window.__mobileLayerTransformSetup) {
//     const WRAP = canvasWrapper || document.getElementById("canvasWrapper") || canvas.parentElement;
//     let layerPinch = null; // { dist0, ang0, ref:{scaleX,scaleY,rotation} }

//     function onTouchStart(ev) {
//       if (!isMobile()) return;
//       if (!(transformTool && transformTool.mode !== "idle" && transformTool.mobileCombo)) return;
//       if (ev.touches.length === 2) {
//         // swallow so view pinch doesn't run
//         ev.preventDefault();
//         ev.stopImmediatePropagation();

//         const t1 = ev.touches[0], t2 = ev.touches[1];
//         const dx = t2.clientX - t1.clientX;
//         const dy = t2.clientY - t1.clientY;
//         const dist0 = Math.hypot(dx, dy);
//         const ang0  = Math.atan2(dy, dx);

//         const L = getActiveLayer(); if (!L) return;
//         layerPinch = {
//           dist0: Math.max(1e-6, dist0),
//           ang0,
//           ref: {
//             scaleX: Number.isFinite(L.scaleX) ? L.scaleX : 1,
//             scaleY: Number.isFinite(L.scaleY) ? L.scaleY : 1,
//             rotation: Number.isFinite(L.rotation) ? L.rotation : 0
//           }
//         };
//       }
//     }

//     function onTouchMove(ev) {
//       if (!isMobile()) return;
//       if (!(transformTool && transformTool.mode !== "idle" && transformTool.mobileCombo)) return;

//       // Two-finger = scale+rotate the active layer
//       if (ev.touches.length === 2 && layerPinch) {
//         ev.preventDefault();
//         ev.stopImmediatePropagation();

//         const t1 = ev.touches[0], t2 = ev.touches[1];
//         const dx = t2.clientX - t1.clientX;
//         const dy = t2.clientY - t1.clientY;
//         const dist = Math.max(1e-6, Math.hypot(dx, dy));
//         const ang  = Math.atan2(dy, dx);

//         const L = getActiveLayer(); if (!L) return;

//         // uniform scale from pinch distance
//         const s = dist / layerPinch.dist0;
//         L.scaleX = layerPinch.ref.scaleX * s;
//         L.scaleY = layerPinch.ref.scaleY * s;

//         // rotation from pinch angle delta (normalized)
//         let da = ang - layerPinch.ang0;
//         if (da >  Math.PI) da -= 2 * Math.PI;
//         if (da < -Math.PI) da += 2 * Math.PI;
//         L.rotation = layerPinch.ref.rotation + da;

//         needsRedraw = true;
//         return;
//       }

//       // One-finger drag uses your existing onTransformPointerMove("grab") path
//       // (we do not swallow one-finger moves so your current handler works)
//     }

//     function onTouchEnd(ev) {
//       if (!isMobile()) return;
//       if (layerPinch && (!ev.touches || ev.touches.length < 2)) {
//         layerPinch = null;
//       }
//       // Reset the combo flag when transform fully ends (mouseup/touchend already calls endTransform(true))
//       if (transformTool && transformTool.mode === "idle") {
//         transformTool.mobileCombo = false;
//       }
//     }

//     // capture:true so we can stop the default canvas view pinch handler below us
//     WRAP.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
//     WRAP.addEventListener("touchmove",  onTouchMove,  { passive: false, capture: true });
//     WRAP.addEventListener("touchend",   onTouchEnd,   { passive: true,  capture: true });
//     WRAP.addEventListener("touchcancel",onTouchEnd,   { passive: true,  capture: true });

//     window.__mobileLayerTransformSetup = true;
//   }
//   // ——— END one-time handlers ———

//   // Clear and rebuild list
//   list.innerHTML = "";

//   function selectLayer(idx, layer) {
//     if (activeLayerIndex !== idx) {
//       activeLayerIndex = idx;
//       syncActiveAliases();
//       rebuildLayersUI();
//       showStatusMessage?.(`Selected: ${layer.name}`, "info");
//       needsRedraw = true;
//     }
//   }

//   layers.forEach((L, idx) => {
//     const el = document.createElement("div");
//     el.className = "layer-item" + (idx === activeLayerIndex ? " active" : "");
//     el.dataset.index = String(idx);

//     // — Visibility (eye icon) + Transform (below eye)
//     const vis = document.createElement("div");
//     vis.className = "layer-vis";

//     const visBtn = document.createElement("button");
//     visBtn.type = "button";
//     visBtn.className = "bs icon-btn";
//     visBtn.title = L.visible ? "Hide layer" : "Show layer";
//     visBtn.setAttribute("aria-label", `${L.visible ? "Hide" : "Show"} ${L.name}`);

//     const EYE_OPEN  = "/static/draw/images/icons/show.svg";
//     const EYE_CLOSE = "/static/draw/images/icons/hide.svg";

//     const visIcon = document.createElement("img");
//     visIcon.alt = L.visible ? "Visible" : "Hidden";
//     visIcon.src = L.visible ? EYE_OPEN : EYE_CLOSE;
//     visIcon.style.pointerEvents = "none";
//     visBtn.appendChild(visIcon);

//     function updateEye() {
//       visIcon.src = L.visible ? EYE_OPEN : EYE_CLOSE;
//       visIcon.alt = L.visible ? "Visible" : "Hidden";
//       visBtn.title = L.visible ? "Hide layer" : "Show layer";
//       visBtn.setAttribute("aria-label", `${L.visible ? "Hide" : "Show"} ${L.name}`);
//     }

//     visBtn.addEventListener("click", (e) => {
//       e.stopPropagation();
//       L.visible = !L.visible;
//       updateEye();
//       needsRedraw = true;
//     });

//     vis.appendChild(visBtn);

//     // ——— SINGLE mobile-only Transform icon (PLACED BELOW VISIBILITY) ———
//     const transformBtn = document.createElement("button");
//     transformBtn.type = "button";
//     transformBtn.className = "bs icon-btn transform-btn";
//     transformBtn.title = "Transform layer";
//     transformBtn.setAttribute("aria-label", `Transform ${L.name}`);
//     transformBtn.innerHTML = `<img src="/static/draw/images/icons/transform.svg" alt="Transform">`;

//     if (!isMobile()) transformBtn.style.display = "none";

//     transformBtn.addEventListener("click", (ev) => {
//       ev.stopPropagation();

//       // make row active first
//       if (activeLayerIndex !== idx) {
//         activeLayerIndex = idx;
//         syncActiveAliases();
//         rebuildLayersUI();
//       }

//       const active = (transformTool && transformTool.mode !== "idle" && transformTool.mobileCombo === true);

//       if (!active) {
//         // enter combined mobile transform: 1-finger drag (grab), 2-finger pinch/rotate (scale+rotate)
//         startTransform("grab");
//         transformTool.mobileCombo = true;
//         showStatusMessage?.("Transform: drag to move, pinch to scale/rotate", "info");
//       } else {
//         // toggle off → apply
//         endTransform(true);
//         transformTool.mobileCombo = false;
//       }

//       needsRedraw = true;
//     });

//     vis.appendChild(transformBtn);
//     // ——— END single transform icon ———

//     // — Name (editable)
//     const nameWrap = document.createElement("div");
//     nameWrap.className = "layer-name";

//     const nameInput = document.createElement("input");
//     nameInput.value = L.name;
//     nameInput.title = "Rename layer";
//     nameInput.setAttribute("aria-label", `Rename ${L.name}`);

//     nameInput.addEventListener("click", (e) => e.stopPropagation());
//     nameInput.addEventListener("mousedown", () => selectLayer(idx, L));
//     nameInput.addEventListener("focus", () => selectLayer(idx, L));

//     const commitName = () => {
//       const v = nameInput.value;
//       if (v !== L.name) {
//         L.name = v;
//         updateEye();
//       }
//     };
//     nameInput.addEventListener("change", commitName);
//     nameInput.addEventListener("blur", commitName);

//     nameWrap.appendChild(nameInput);

//     // — Ops (Up/Down)
//     // — Ops (Up/Down)
//     const ops = document.createElement("div");
//     ops.className = "layer-ops";

//     /* Up (file SVG) */
//     const upBtn = document.createElement("button");
//     upBtn.type = "button";
//     upBtn.className = "bs icon-btn";
//     upBtn.title = "Move up";
//     upBtn.setAttribute("aria-label", "Move layer up");
//     upBtn.innerHTML = `<img src="/static/draw/images/icons/up-shevron.svg" alt="" style="pointer-events:none" width="18" height="18">`;
//     upBtn.addEventListener("click", (ev) => { ev.stopPropagation(); moveLayerUp(idx); });

//     /* Down (file SVG) */
//     const downBtn = document.createElement("button");
//     downBtn.type = "button";
//     downBtn.className = "bs icon-btn";
//     downBtn.title = "Move down";
//     downBtn.setAttribute("aria-label", "Move layer down");
//     downBtn.innerHTML = `<img src="/static/draw/images/icons/down-shevron.svg" alt="" style="pointer-events:none" width="18" height="18">`;
//     downBtn.addEventListener("click", (ev) => { ev.stopPropagation(); moveLayerDown(idx); });

//     ops.appendChild(upBtn);
//     ops.appendChild(downBtn);


//     // — Opacity
//     const opacityRow = document.createElement("div");
//     opacityRow.className = "layer-opacity";

//     const opLabel = document.createElement("span");
//     opLabel.textContent = "Opacity";

//     const opRange = document.createElement("input");
//     opRange.type = "range";
//     opRange.min = "0";
//     opRange.max = "1";
//     opRange.step = "0.01";
//     opRange.value = String(L.opacity);

//     // Avoid stealing row click
//     ["click","mousedown","touchstart","keydown"].forEach(ev =>
//       opRange.addEventListener(ev, (e) => e.stopPropagation())
//     );

//     opRange.addEventListener("input", () => {
//       const v = parseFloat(opRange.value);
//       if (!Number.isNaN(v) && v !== L.opacity) {
//         L.opacity = Math.max(0, Math.min(1, v));
//         needsRedraw = true;
//       }
//     });

//     opacityRow.appendChild(opLabel);
//     opacityRow.appendChild(opRange);

//     // Compose row
//     el.appendChild(vis);
//     el.appendChild(nameWrap);
//     el.appendChild(ops);
//     el.appendChild(opacityRow);

//     // Row select
//     el.addEventListener("click", () => selectLayer(idx, L));

//     // newest on top in UI
//     list.prepend(el);
//   });
// }


function rebuildLayersUI() {
  const list = document.getElementById("layersList");
  if (!list) return;

  // ——— ONE-TIME mobile layer-transform touch handlers (capture phase to override view pinch) ———
  if (!window.__mobileLayerTransformSetup) {
    const WRAP = canvasWrapper || document.getElementById("canvasWrapper") || canvas.parentElement;
    let layerPinch = null; // { dist0, ang0, ref:{scaleX,scaleY,rotation} }

    function onTouchStart(ev) {
      if (!isMobile()) return;
      if (!(transformTool && transformTool.mobileCombo)) return;
      if (ev.touches.length === 2) {
        // swallow so view pinch doesn't run
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

      // Two-finger = scale+rotate the active layer
      if (ev.touches.length === 2 && layerPinch) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        const t1 = ev.touches[0], t2 = ev.touches[1];
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        const dist = Math.max(1e-6, Math.hypot(dx, dy));
        const ang  = Math.atan2(dy, dx);

        const L = getActiveLayer(); if (!L) return;

        // uniform scale from pinch distance
        const s = dist / layerPinch.dist0;
        L.scaleX = layerPinch.ref.scaleX * s;
        L.scaleY = layerPinch.ref.scaleY * s;

        // rotation from pinch angle delta (normalized)
        let da = ang - layerPinch.ang0;
        if (da >  Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        L.rotation = layerPinch.ref.rotation + da;

        needsRedraw = true;
        return;
      }

      // One-finger drag uses existing onTransformPointerMove("grab") path
    }

    function onTouchEnd(ev) {
      if (!isMobile()) return;
      if (layerPinch && (!ev.touches || ev.touches.length < 2)) {
        layerPinch = null;
      }
      // If fully ended and not locked, mobileCombo may be cleared by endTransform()
      if (transformTool && transformTool.mode === "idle") {
        const L = getActiveLayer();
        if (!(L && L.transformLocked)) transformTool.mobileCombo = false;
      }
    }

    // capture:true so we can stop the default canvas view pinch handler below us
    WRAP.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
    WRAP.addEventListener("touchmove",  onTouchMove,  { passive: false, capture: true });
    WRAP.addEventListener("touchend",   onTouchEnd,   { passive: true,  capture: true });
    WRAP.addEventListener("touchcancel",onTouchEnd,   { passive: true,  capture: true });

    window.__mobileLayerTransformSetup = true;
  }
  // ——— END one-time handlers ———

  // Clear and rebuild list
  list.innerHTML = "";

  function selectLayer(idx, layer) {
    if (activeLayerIndex !== idx) {
      // Switching to another layer should UNLOCK any previous sticky lock.
      clearTransformLockAll();
      activeLayerIndex = idx;
      syncActiveAliases();
      rebuildLayersUI();
      showStatusMessage?.(`Selected: ${layer.name}`, "info");
      needsRedraw = true;
    }
  }

  layers.forEach((L, idx) => {
    const el = document.createElement("div");
    el.className = "layer-item" + (idx === activeLayerIndex ? " active" : "");
    el.dataset.index = String(idx);

    // — Visibility (eye icon) + Transform (below eye)
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
      // Any other button on any (even same) layer → unlock sticky
      clearTransformLockAll();
      L.visible = !L.visible;
      updateEye();
      needsRedraw = true;
    });

    vis.appendChild(visBtn);

    // ——— SINGLE mobile-only Transform icon (PLACED BELOW VISIBILITY) ———
    const transformBtn = document.createElement("button");
    transformBtn.type = "button";
    transformBtn.className = "bs icon-btn transform-btn";
    transformBtn.title = "Transform layer";
    transformBtn.setAttribute("aria-label", `Transform ${L.name}`);
    transformBtn.innerHTML = `<img src="/static/draw/images/icons/transform.svg" alt="Transform">`;

    if (!isMobile()) transformBtn.style.display = "none";

    // Active state reflects per-layer lock
    if (isMobile() && L.transformLocked && idx === activeLayerIndex) {
      transformBtn.classList.add("is-active");
    } else {
      transformBtn.classList.remove("is-active");
    }

    transformBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();

      // Make this layer active first
      if (activeLayerIndex !== idx) {
        // Switching layers => unlock previous locks
        clearTransformLockAll();
        activeLayerIndex = idx;
        syncActiveAliases();
        rebuildLayersUI();
      }

      const currentlyLocked = !!L.transformLocked;
      if (!currentlyLocked) {
        // Lock ON: enter sticky mobile transform for this layer
        setLayerTransformLock(idx, true);
        transformBtn.classList.add("is-active");
        showStatusMessage?.("Transform locked: drag to move, pinch to scale/rotate", "info");
      } else {
        // Lock OFF: fully unlock and end transform
        setLayerTransformLock(idx, false);
        transformBtn.classList.remove("is-active");
        showStatusMessage?.("Transform unlocked", "info");
      }

      needsRedraw = true;
    });

    vis.appendChild(transformBtn);
    // ——— END single transform icon ———

    // — Name (editable)
    const nameWrap = document.createElement("div");
    nameWrap.className = "layer-name";

    const nameInput = document.createElement("input");
    nameInput.value = L.name;
    nameInput.title = "Rename layer";
    nameInput.setAttribute("aria-label", `Rename ${L.name}`);

    nameInput.addEventListener("click", (e) => e.stopPropagation());
    nameInput.addEventListener("mousedown", () => selectLayer(idx, L));
    nameInput.addEventListener("focus", () => selectLayer(idx, L));

    const commitName = () => {
      const v = nameInput.value;
      if (v !== L.name) {
        // Any edit → keeps current layer selection; no need to unlock
        L.name = v;
        updateEye();
      }
    };
    nameInput.addEventListener("change", commitName);
    nameInput.addEventListener("blur", commitName);

    nameWrap.appendChild(nameInput);

    // — Ops (Up/Down)
    const ops = document.createElement("div");
    ops.className = "layer-ops";

    /* Up */
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "bs icon-btn";
    upBtn.title = "Move up";
    upBtn.setAttribute("aria-label", "Move layer up");
    upBtn.innerHTML = `<img src="/static/draw/images/icons/up-shevron.svg" alt="" style="pointer-events:none" width="18" height="18">`;
    upBtn.addEventListener("click", (ev) => { 
      ev.stopPropagation(); 
      clearTransformLockAll(); // clicking any other button unlocks
      moveLayerUp(idx); 
    });

    /* Down */
    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "bs icon-btn";
    downBtn.title = "Move down";
    downBtn.setAttribute("aria-label", "Move layer down");
    downBtn.innerHTML = `<img src="/static/draw/images/icons/down-shevron.svg" alt="" style="pointer-events:none" width="18" height="18">`;
    downBtn.addEventListener("click", (ev) => { 
      ev.stopPropagation(); 
      clearTransformLockAll(); // clicking any other button unlocks
      moveLayerDown(idx); 
    });

    ops.appendChild(upBtn);
    ops.appendChild(downBtn);

    // — Opacity
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

    // Avoid stealing row click
    ["click","mousedown","touchstart","keydown"].forEach(ev =>
      opRange.addEventListener(ev, (e) => e.stopPropagation())
    );

    opRange.addEventListener("input", () => {
      // Adjusting opacity does not switch layers,
      // but per request, other buttons should unlock sticky transforms.
      clearTransformLockAll();
      const v = parseFloat(opRange.value);
      if (!Number.isNaN(v) && v !== L.opacity) {
        L.opacity = Math.max(0, Math.min(1, v));
        needsRedraw = true;
      }
    });

    opacityRow.appendChild(opLabel);
    opacityRow.appendChild(opRange);

    // Compose row
    el.appendChild(vis);
    el.appendChild(nameWrap);
    el.appendChild(ops);
    el.appendChild(opacityRow);

    // Row select (tap row switches active layer → unlock sticky)
    el.addEventListener("click", () => selectLayer(idx, L));

    // newest on top in UI
    list.prepend(el);
  });
}






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





//–––––––––––––––––––
// FLOODING FUNCTIONS
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
  const L = getActiveLayer();
  if (!L) return;

  // We pass fx, fy in FBO px with top-left origin.
  // Convert to WebGL readPixels coords (bottom-left origin).
  const ix = Math.max(0, Math.min(fixedFBOWidth  - 1, Math.round(fx)));
  const iyTopLeft = Math.max(0, Math.min(fixedFBOHeight - 1, Math.round(fy)));
  const iy = (fixedFBOHeight - 1) - iyTopLeft; // flip Y for readPixels

  const pixel = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.readPixels(ix, iy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const targetColor = [pixel[0]/255, pixel[1]/255, pixel[2]/255, pixel[3]/255];
  runFloodFillShader(L, targetColor, tintColor);
  saveStrokeState();
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




//–––––––––––––––––––
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




//–––––––––––––––––––
// DRAWING FUNCTIONS
//–––––––––––––––––––

let strokeCount = 0;
const FLATTEN_THRESHOLD = isMobile() ? 50 : 150;


function flattenStrokes() {
  console.log("flattenStrokes", strokeCount);

  const L = getActiveLayer();
  if (!L || !L.fbo || !L.texture) return;

  const w = fixedFBOWidth;
  const h = fixedFBOHeight;

  // 1) Create a new texture + FBO to hold the merged result (use LINEAR filtering)
  const mergedTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, mergedTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  // Linear filtering so the layer renders smoothly when scaled on screen
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const mergeFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, mergeFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mergedTexture, 0);

  // Safety: ensure FBO is complete before proceeding
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.warn("flattenStrokes: mergeFBO incomplete:", status);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(mergeFBO);
    gl.deleteTexture(mergedTexture);
    return;
  }

  // 2) Copy the current active layer (L.fbo) -> mergeFBO
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, mergeFBO);
  gl.blitFramebuffer(
    0, 0, w, h,
    0, 0, w, h,
    gl.COLOR_BUFFER_BIT,
    gl.NEAREST
  );

  // 3) Unbind
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // 4) Swap into the layer, then delete the old objects
  const oldTex = L.texture;
  const oldFbo = L.fbo;

  L.texture = mergedTexture;
  L.fbo = mergeFBO;

  if (oldTex) gl.deleteTexture(oldTex);
  if (oldFbo) gl.deleteFramebuffer(oldFbo);

  // 5) Keep aliases in sync so stamping keeps working
  if (typeof syncActiveAliases === "function") {
    syncActiveAliases();
  }

  // 6) Reset counter and request redraw
  strokeCount = 0;
  if (typeof needsRedraw !== "undefined") {
    needsRedraw = true;
  }
}



// Draw a brush stroke into the persistent paint layer (offscreen).
// x and y are in pixel coordinates (with (0,0) at top left).

// let lastX = null,
//     lastY = null;

let currentAngle = 0;


let sharedBuffer = null; // Add this global buffer initialization


//--------------------------------------------
// UNDO
//---------------------------------------------

const UNDO_STEPS = isMobile() ? 8 : 30;
let strokeHistory = []; // will be array of line groups: [ [step1, step2, ...], ... ]
let redoHistory = [];

let currentLineGroup = null;




function saveStrokeState() {
  const L = getActiveLayer();

  const backupTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, backupTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fixedFBOWidth, fixedFBOHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const backupFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, backupFBO);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, backupTexture, 0);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, L.fbo);
  gl.blitFramebuffer(0,0,fixedFBOWidth,fixedFBOHeight, 0,0,fixedFBOWidth,fixedFBOHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  const step = { texture: backupTexture, fbo: backupFBO };

  if (currentLineGroup) {
    currentLineGroup.push(step);
  } else {
    strokeHistory.push([step]);
    if (strokeHistory.length > UNDO_STEPS) {
      const removedGroup = strokeHistory.shift();
      if (removedGroup) {
        removedGroup.forEach(removed => {
          if (removed.texture) gl.deleteTexture(removed.texture);
          if (removed.fbo) gl.deleteFramebuffer(removed.fbo);
        });
      }
    }
    redoHistory = [];
  }

  const totalMB = estimateUndoMemoryMB();
  console.log(`🧠 GPU Undo Memory: ${totalMB.toFixed(1)} MB`);
}



// === Project-wide undo/redo (independent from per-layer strokes) ===
let projectActionHistory = [];  // stack of { type: 'projectClear', snapshot }
let projectActionRedo    = [];

// Duplicate an FBO into a brand-new texture+FBO (GPU-side copy)
function cloneLayerFBO(srcFbo, w, h) {
  const { texture, fbo } = createLayerFBO(w, h);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  return { texture, fbo };
}

// Snapshot the whole project (all layers + background) WITHOUT pushing to history
async function snapshotProjectNow() {
  const w = fixedFBOWidth, h = fixedFBOHeight;

  // Background snapshot (dataURL) — safe even if currentImage is a Blob URL
  let backgroundDataURL = null;
  if (currentImage) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(currentImage, 0, 0, w, h);
    backgroundDataURL = c.toDataURL("image/png", 0.92);
  }

  // Layer snapshots (GPU copies)
  const layerSnaps = layers.map(L => {
    const copy = cloneLayerFBO(L.fbo, w, h);
    return {
      name: L.name,
      visible: !!L.visible,
      opacity: Number(L.opacity) || 1,
      texture: copy.texture,
      fbo: copy.fbo
    };
  });

  return { w, h, backgroundDataURL, layerSnaps };
}

// Restore a project snapshot (replaces current layers/background)
async function restoreProjectSnapshot(snap) {
  const { w, h, backgroundDataURL, layerSnaps } = snap;

  // Dispose current layer GPU objects
  layers.forEach(L => { gl.deleteTexture(L.texture); gl.deleteFramebuffer(L.fbo); });
  layers = [];

  fixedFBOWidth = w;
  fixedFBOHeight = h;

  // Restore background texture
  if (backgroundDataURL) {
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = backgroundDataURL; });
    currentImage = img;
    createTextureFromImage(img);
    updateCanvasSize(img);
  } else {
    currentImage = null;
    texture = null;
  }

  // Install cloned layer FBOs as live layers
  for (const S of layerSnaps) {
    layers.push({
      id: Date.now() + Math.random(),
      name: S.name,
      fbo: S.fbo,
      texture: S.texture,
      visible: S.visible,
      opacity: S.opacity,
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
      px: fixedFBOWidth * 0.5, py: fixedFBOHeight * 0.5,
      history: [], redo: []
    });
  }

  activeLayerIndex = Math.max(0, layers.length - 1);
  syncActiveAliases?.();
  rebuildLayersUI?.();
  centerAndFitToWrapper?.();

  resetStrokeState?.();
  needsRedraw = true;
}

// Push a snapshot into projectActionHistory
async function pushProjectSnapshotForUndo(type) {
  const snap = await snapshotProjectNow();
  projectActionHistory.push({ type, snapshot: snap });
  // clearing a project is a “new branch”; invalidate redo for project actions
  projectActionRedo = [];
}


async function clearProjectUndoable() {
  // 1) Save entire project for undo
  await pushProjectSnapshotForUndo("projectClear");

  // 2) Perform the clear (wipe layers + background to default empty doc)
  //    Dispose old GPU resources
  layers.forEach(L => { gl.deleteTexture(L.texture); gl.deleteFramebuffer(L.fbo); });
  layers = [];
  activeLayerIndex = 0;

  // Remove background
  currentImage = null;
  texture = null;

  // Re-init a fresh, empty document at current size
  addLayer("Layer 1", -1);
  syncActiveAliases();

  // Recentre view, reset stroke/angles
  centerAndFitToWrapper?.();
  resetStrokeState?.();

  // Clear stroke history too (new clean state)
  strokeHistory = [];
  redoHistory = [];

  needsRedraw = true;
  rebuildLayersUI?.();
  showStatusMessage?.("Project cleared (undo enabled)", "success");
}

// Hook up the button
const cleanBtn = document.getElementById("cleanButton");
if (cleanBtn) {
  cleanBtn.addEventListener("click", clearProjectUndoable);
}


async function undoGlobal() {
  // Prefer project-wide actions first
  if (projectActionHistory.length) {
    const act = projectActionHistory.pop();
    if (act.type === "projectClear") {
      // snapshot the *current* (cleared) state for redo
      const nowSnap = await snapshotProjectNow();
      projectActionRedo.push({ type: "projectClear", snapshot: nowSnap });

      await restoreProjectSnapshot(act.snapshot);
      showStatusMessage?.("Undo: project clear", "info");
      needsRedraw = true;
      return;
    }
  }
  // Fallback: per-layer stroke undo
  undoStroke();
}

async function redoGlobal() {
  if (projectActionRedo.length) {
    const act = projectActionRedo.pop();
    if (act.type === "projectClear") {
      // snapshot current for *undo back*
      const nowSnap = await snapshotProjectNow();
      projectActionHistory.push({ type: "projectClear", snapshot: nowSnap });

      await restoreProjectSnapshot(act.snapshot);
      showStatusMessage?.("Redo: project clear", "info");
      needsRedraw = true;
      return;
    }
  }
  // Fallback: per-layer stroke redo
  redoStroke();
}

// Keys & buttons
document.addEventListener("keydown", (event) => {
  if (isUserTyping()) return;

  // Undo
  if ((event.key === "z" && (event.ctrlKey || event.metaKey))) {
    event.preventDefault();
    undoGlobal();
  }

  // Redo
  if ((event.key === "y" && (event.ctrlKey || event.metaKey)) ||
      (event.key === "Z" && (event.shiftKey && (event.ctrlKey || event.metaKey)))) {
    event.preventDefault();
    redoGlobal();
  }
});

const undoBtn = document.getElementById("undoButton");
if (undoBtn) undoBtn.addEventListener("click", () => undoGlobal());

const redoBtn = document.getElementById("redoButton");
if (redoBtn) redoBtn.addEventListener("click", () => redoGlobal());





function undoStroke() {
  if (strokeHistory.length === 0) return;

  const L = getActiveLayer();
  const lastGroup = strokeHistory.pop();
  redoHistory.push(lastGroup);

  // clear active layer
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
  gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (strokeHistory.length > 0) {
    const previousGroup = strokeHistory[strokeHistory.length - 1];
    const lastStep = previousGroup[previousGroup.length - 1];

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, lastStep.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L.fbo);
    gl.blitFramebuffer(0,0,fixedFBOWidth,fixedFBOHeight, 0,0,fixedFBOWidth,fixedFBOHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  needsRedraw = true;
  showStatusMessage("Undo", "info");
}

function redoStroke() {
  if (redoHistory.length === 0) return;

  const L = getActiveLayer();
  const redoGroup = redoHistory.pop();
  strokeHistory.push(redoGroup);
  const lastStep = redoGroup[redoGroup.length - 1];

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, lastStep.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, L.fbo);
  gl.blitFramebuffer(0,0,fixedFBOWidth,fixedFBOHeight, 0,0,fixedFBOWidth,fixedFBOHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  needsRedraw = true;
  showStatusMessage("Redo", "info");
}




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




// ---- Monitor Undo Memory Usage ---- //

function estimateUndoMemoryMB() {
    if (typeof fixedFBOWidth === "undefined" || typeof fixedFBOHeight === "undefined") return 0;

    const bytesPerPixel = 4;
    const baseCount = 5; // paintFBO, fillFBO1, fillFBO2, mergeFBO, current buffer
    const strokeCount = strokeHistory.length;
    const redoCount = redoHistory.length;

    const textureSize = fixedFBOWidth * fixedFBOHeight * bytesPerPixel;
    const totalBytes = textureSize * (strokeCount + redoCount + baseCount);

    return totalBytes / (1024 * 1024); // MB
}



function monitorUndoMemory() {
    const mb = estimateUndoMemoryMB();
    const threshold = isMobile() ? 40 : 150;

    const indicator = document.getElementById("footer");
    if (indicator) {
        indicator.textContent = `${mb.toFixed(1)} MB ${document.title}`;
    }

    if (mb > threshold && !memoryWarningShown) {
        console.warn(`⚠️ Undo stack uses ${mb.toFixed(1)} MB — may overload GPU`);
        showStatusMessage(`⚠️ Undo stack large (${mb.toFixed(1)} MB) — flatten or undo!`, "warning");
        memoryWarningShown = true;
    }

    setTimeout(monitorUndoMemory, 2000);
}


// ---- Start both monitors ---- //
// monitorFrameTime();
monitorUndoMemory();



document.addEventListener("keydown", (event) => {
    if (isUserTyping()) return;
    if (event.key === "z" && (event.ctrlKey || event.metaKey)) {
        undoStroke();
    }
    if (event.key === "y" && (event.ctrlKey || event.metaKey)) {
        redoStroke();
    }

    if (event.key === "f") {
        currentTool = (currentTool === 'fill') ? 'draw' : 'fill';
        console.log("Tool switched to:", currentTool);
    }

});

document.getElementById("undoButton").addEventListener("click", undoStroke);
document.getElementById("redoButton").addEventListener("click", redoStroke);

canvas.addEventListener("pointerdown", (e) => {
    
    currentLineGroup = [];
    redoHistory = [];

    //saveStrokeState();

});

canvas.addEventListener("pointerup", (e) => {
    if (currentLineGroup && currentLineGroup.length > 0) {
        strokeHistory.push(currentLineGroup);
        if (strokeHistory.length > UNDO_STEPS) {
            const removedGroup = strokeHistory.shift();
            removedGroup.forEach(removed => {
                gl.deleteTexture(removed.texture);
                gl.deleteFramebuffer(removed.fbo);
            });
        }
    }
    currentLineGroup = null;
    saveStrokeState();
});



// --------------
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



function drawSingleBrushStamp(fx, fy, sizeOverride = null, angleOverride = null) {
  const brushW = (sizeOverride ?? brushSize) * fixedFBOWidth;
  const brushH = brushW / brushAspect;
  const halfW = brushW / 2;
  const halfH = brushH / 2;

  const L = getActiveLayer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);   // <<< paint into active layer
  gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);
  gl.enable(gl.BLEND);
  gl.useProgram(paintProgram);

  const eraseUniform = gl.getUniformLocation(paintProgram, "u_erase");
  gl.uniform1i(eraseUniform, isErasing ? 1 : 0);
  const eraseStrengthUniform = gl.getUniformLocation(paintProgram, "u_eraseStrength");
  gl.uniform1f(eraseStrengthUniform, eraseStrength);
  const paintStrengthLoc = gl.getUniformLocation(paintProgram, "u_paintStrength");
  gl.uniform1f(paintStrengthLoc, paintStrength);

  if (isErasing) {
    gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  const flipLoc = gl.getUniformLocation(paintProgram, "u_flipY");
  gl.uniform1f(flipLoc, 1.0);

  const resLoc = gl.getUniformLocation(paintProgram, "u_resolution");
  gl.uniform2f(resLoc, fixedFBOWidth, fixedFBOHeight);
  const tintLoc = gl.getUniformLocation(paintProgram, "u_tint");
  gl.uniform4fv(tintLoc, tintColor);

  const offsets = [
    { x: -halfW, y: -halfH }, { x: halfW,  y: -halfH },
    { x: -halfW, y:  halfH }, { x: halfW,  y:  halfH }
  ];

  const angle = angleOverride ?? currentAngle;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const rotated = offsets.map(off => ({ x: off.x * cosA - off.y * sinA, y: off.x * sinA + off.y * cosA }));

  const v0 = { x: fx + rotated[0].x, y: fy + rotated[0].y };
  const v1 = { x: fx + rotated[1].x, y: fy + rotated[1].y };
  const v2 = { x: fx + rotated[2].x, y: fy + rotated[2].y };
  const v3 = { x: fx + rotated[3].x, y: fy + rotated[3].y };

  const vertices = new Float32Array([
    v0.x, v0.y, 0, 0,  v1.x, v1.y, 1, 0,  v2.x, v2.y, 0, 1,
    v2.x, v2.y, 0, 1,  v1.x, v1.y, 1, 0,  v3.x, v3.y, 1, 1
  ]);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);

  const posLoc = gl.getAttribLocation(paintProgram, "a_position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  const texLoc = gl.getAttribLocation(paintProgram, "a_texCoord");
  gl.enableVertexAttribArray(texLoc);
  gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
  gl.uniform1i(gl.getUniformLocation(paintProgram, "u_brush"), 0);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.deleteBuffer(buffer);
  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(texLoc);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}





// drawBrushStrokeToPaintLayer (adds guard) ===

function docToLayerLocal(dx, dy, L) {
  // dx,dy in document/FBO pixels
  const px = Number.isFinite(L.px) ? L.px : fixedFBOWidth * 0.5;
  const py = Number.isFinite(L.py) ? L.py : fixedFBOHeight * 0.5;

  // translate by -position
  let x = dx - (L.x || 0);
  let y = dy - (L.y || 0);

  // to pivot frame
  x -= px; y -= py;

  // inverse rotate
  const c = Math.cos(-(L.rotation || 0));
  const s = Math.sin(-(L.rotation || 0));
  const rx = x * c - y * s;
  const ry = x * s + y * c;

  // inverse scale
  const sx = rx / (L.scaleX || 1);
  const sy = ry / (L.scaleY || 1);

  // back to layer local (pre-transform) coords
  return { x: sx + px, y: sy + py };
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


function applyActiveLayerTransform() {
  const L = getActiveLayer();
  if (!L || !L.texture || !gl.isTexture(L.texture)) return;

  const W = fixedFBOWidth, H = fixedFBOHeight;

  const outTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, outTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const outFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    console.warn("applyActiveLayerTransform: FBO incomplete");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(outFBO);
    gl.deleteTexture(outTex);
    return;
  }

  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // pivot in document px
  const pivX = Number.isFinite(L.px) ? L.px : W * 0.5;
  const pivY = Number.isFinite(L.py) ? L.py : H * 0.5;

  const corners = [
    {x:0,y:0},{x:W,y:0},{x:0,y:H},{x:W,y:H}
  ];
  const c = Math.cos(L.rotation || 0);
  const s = Math.sin(L.rotation || 0);

  function tf(pt){
    // to pivot
    let dx = pt.x - pivX;
    let dy = pt.y - pivY;
    // scale
    dx *= (Number.isFinite(L.scaleX) ? L.scaleX : 1);
    dy *= (Number.isFinite(L.scaleY) ? L.scaleY : 1);
    // rotate
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    // back + translation
    const x = pivX + rx + (Number.isFinite(L.x) ? L.x : 0);
    const y = pivY + ry + (Number.isFinite(L.y) ? L.y : 0);
    return {x, y};
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

  gl.useProgram(quadProgram);
  const uFlipY = gl.getUniformLocation(quadProgram, "u_flipY");
  if (uFlipY) gl.uniform1f(uFlipY, 1.0);
  const uRes = gl.getUniformLocation(quadProgram, "u_resolution");
  if (uRes) gl.uniform2f(uRes, W, H);
  const uOpacity = gl.getUniformLocation(quadProgram, "u_layerOpacity");
  if (uOpacity) gl.uniform1f(uOpacity, 1.0);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

  const posLoc = gl.getAttribLocation(quadProgram, "a_position");
  const uvLoc  = gl.getAttribLocation(quadProgram, "a_texCoord");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, L.texture);
  const uTex = gl.getUniformLocation(quadProgram, "u_texture");
  if (uTex) gl.uniform1i(uTex, 0);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.disableVertexAttribArray(posLoc);
  gl.disableVertexAttribArray(uvLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buf);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // swap & reset transform (and pivot back to center)
  gl.deleteTexture(L.texture);
  gl.deleteFramebuffer(L.fbo);
  L.texture = outTex;
  L.fbo = outFBO;

  L.x = 0; L.y = 0; L.scaleX = 1; L.scaleY = 1; L.rotation = 0;
  L.px = W * 0.5; L.py = H * 0.5;

  syncActiveAliases();
  resetStrokeState?.();
  needsRedraw = true;
  showStatusMessage("Transform applied", "success");
}





// --- Transform hotkeys: G/S/R, Esc, Enter, T ---
document.addEventListener("keydown", (e) => {
  if (isUserTyping()) return;

  // Don’t start transforms while space-panning or drawing
  if (spacePanning || isDrawing) return;

  // Ignore when user is using system/browser shortcuts (e.g., Cmd/Ctrl+S) or Alt-based combos
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const k = e.key.toLowerCase();

  // G: grab (move)
  if (k === "g") {
    e.preventDefault();
    e.stopImmediatePropagation();
    startTransform("grab");
    return;
  }

  // S: scale (Shift+S = invert scaling direction)
  if (k === "s") {
    e.preventDefault();
    e.stopImmediatePropagation();
    startTransform("scale", e.shiftKey);
    return;
  }

  // R: rotate (Shift+R = opposite direction)
  if (k === "r") {
    e.preventDefault();
    e.stopImmediatePropagation();
    startTransform("rotate", e.shiftKey);
    return;
  }

  // Esc: cancel (revert to ref)
// Esc: cancel (revert to ref, do NOT bake)
if (e.key === "Escape" && transformTool.mode !== "idle") {
  const L = getActiveLayer();
  if (L && transformTool.ref) {
    L.x = transformTool.ref.x;
    L.y = transformTool.ref.y;
    L.scaleX = transformTool.ref.scaleX;
    L.scaleY = transformTool.ref.scaleY;
    L.rotation = transformTool.ref.rotation;
  }
  endTransform(false);  // <- no baking on cancel
  needsRedraw = true;
  e.preventDefault();
  e.stopImmediatePropagation();
  return;
}


  // Enter/Return: confirm explicitly (optional, as mouseup already ends)
  if ((e.key === "Enter" || e.key === "Return") && transformTool.mode !== "idle") {
    endTransform();
    needsRedraw = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // T: reset transform on active layer
  if (k === "t") {
    const L = getActiveLayer();
    if (!L) return;
    L.x = 0;
    L.y = 0;
    L.scaleX = 1;
    L.scaleY = 1;
    L.rotation = 0;
    showStatusMessage("Layer transform reset", "info");
    needsRedraw = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
}, { capture: true });



// DROP-IN REPLACEMENT — drawScene()
function drawScene() {
  if (!gl || !quadProgram || !canvas) return;

  // ensure background paper exists before drawing
  if (!texture) {
    if (currentImage) createTextureFromImage(currentImage);
    else loadDefaultImage();
  }

  // reset default framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

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
    const uTex = gl.getUniformLocation(program, "u_texture") ?? gl.getUniformLocation(program, "u_brush");
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

  // 3) Brush overlay (ONLY while drawing or transforming or HUD visible)
  const overlayActive = isDrawing || (transformTool && transformTool.mode !== "idle") || brushHUD.visible;
  if (overlayActive && overlayProgram && overlayTexture && gl.isTexture(overlayTexture) && typeof drawBrushOverlay === "function") {
    gl.useProgram(overlayProgram);
    const uFlipY = gl.getUniformLocation(overlayProgram, "u_flipY");
    if (uFlipY) gl.uniform1f(uFlipY, -1.0);
    const uRes = gl.getUniformLocation(overlayProgram, "u_resolution");
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    drawBrushOverlay();
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.useProgram(null);

  maybeAutoHideBrushHUD();
}





//–––––––––––––––––––
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


//–––––––––––––––––––
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



//–––––––––––––––––––
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




async function saveArtwork(name, isOverwrite = false, existingId = null, options = {}) {
  const { quiet = false } = options;

  try {
    const db = await openDatabase();

    // 1) FLATTENED preview for gallery
    const flattenCanvas = composeToCanvas(true);
    const flattenedBlob = await canvasToBlob(flattenCanvas, "image/png", 0.92);

    // 2) THUMBNAIL
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

    // 3) PROJECT SOURCE (each layer to PNG blob + metadata)
    const w = fixedFBOWidth, h = fixedFBOHeight;

    // optional background snapshot
    let backgroundBlob = null;
    if (currentImage) {
      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = w; bgCanvas.height = h;
      const bgCtx = bgCanvas.getContext("2d");
      bgCtx.drawImage(currentImage, 0, 0, w, h);
      backgroundBlob = await canvasToBlob(bgCanvas, "image/png", 0.92);
    }

    // read each layer FBO → PNG blob
    async function layerBlobFromFBO(fbo) {
      const pixels = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = w; tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext("2d");
      const imageData = new ImageData(new Uint8ClampedArray(pixels), w, h);
      tempCtx.putImageData(imageData, 0, 0);

      // flip into a new canvas so stored layer PNG is in screen coords
      const out = document.createElement("canvas");
      out.width = w; out.height = h;
      const octx = out.getContext("2d");
      octx.save();
      octx.translate(w / 2, h / 2);
      octx.scale(-1, -1);
      octx.rotate(Math.PI);
      octx.drawImage(tempCanvas, -w / 2, -h / 2);
      octx.restore();

      return canvasToBlob(out, "image/png", 0.92);
    }

    const layerEntries = [];
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const blob = await layerBlobFromFBO(L.fbo);
      layerEntries.push({
        name: L.name,
        visible: !!L.visible,
        opacity: Number(L.opacity) || 1,
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
      image: flattenedBlob,
      thumbnail: thumbDataURL,
      project: {
        width: w,
        height: h,
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

      // optional: send thumbnail to chat (skip in quiet mode)
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

  } catch (error) {
    console.error("[saveArtwork] CATCH ERROR:", error);
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



// Factor your existing loadArtwork() logic into a callable that accepts the raw record:
// Rebuild the canvas (background + layers + UI) from a DB record object
async function loadArtworkObject(art) {
  if (!art) { showStatusMessage("Artwork not found.", "error"); return; }

  currentArtworkId = art.id;

  // Project with layers?
  if (art.project && art.project.layers && art.project.layers.length) {
    const w = art.project.width, h = art.project.height;

    fixedFBOWidth = w;
    fixedFBOHeight = h;

    initFloodFBOs();
    initPaintLayerFixed(); // creates one default; we’ll replace

    // restore background (if any)
    if (art.project.backgroundBlob) {
      const bgUrl = URL.createObjectURL(art.project.backgroundBlob);
      const img = new Image();
      await new Promise((resolve) => {


        img.onload = () => {
          currentImage = img;
          updateCanvasSize(img);
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

          URL.revokeObjectURL(bgUrl);
          resolve();
        };



        img.src = bgUrl;
      });
    } else {
      currentImage = null;
      texture = null;
      updateCanvasSize({ width: w, height: h });
    }

    // kill old GL layer objects
    layers.forEach(L => { gl.deleteTexture(L.texture); gl.deleteFramebuffer(L.fbo); });
    layers = [];

    // helper to draw an Image into a layer FBO at size w x h


        function drawImageIntoLayerFBO(image, fbo) {
          // Assumes w,h are the intended document size in the outer scope.
          // If you prefer, replace w/h with fixedFBOWidth/fixedFBOHeight.
          const W = w, H = h;

          // 1) Rasterize the source image into a 2D canvas at the exact target size.
          const temp = document.createElement("canvas");
          temp.width = W;
          temp.height = H;
          const tctx = temp.getContext("2d", { willReadFrequently: false });
          tctx.clearRect(0, 0, W, H);
          tctx.drawImage(image, 0, 0, W, H);

          // 2) Upload as a WebGL texture (LINEAR filtering for smooth sampling later).
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, temp);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

          // 3) Draw the texture into the destination FBO (no blending needed).
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

          // Safety: ensure the FBO is complete before drawing.
          const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
          if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.warn("drawImageIntoLayerFBO: target FBO incomplete:", status);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.deleteTexture(tex);
            return;
          }

          gl.viewport(0, 0, W, H);
          gl.disable(gl.BLEND);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);

          gl.useProgram(quadProgram);
          // We are drawing into the FBO in its native orientation; no flip here.
          const flipLoc = gl.getUniformLocation(quadProgram, "u_flipY");
          if (flipLoc !== null) gl.uniform1f(flipLoc, 1.0);
          const resLoc = gl.getUniformLocation(quadProgram, "u_resolution");
          if (resLoc !== null) gl.uniform2f(resLoc, W, H);
          const opLoc = gl.getUniformLocation(quadProgram, "u_layerOpacity");
          if (opLoc !== null) gl.uniform1f(opLoc, 1.0);

          // Full-rect covering quad in pixel space (matching quadVS expectations).
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

          // 4) Cleanup & restore minimal state.
          gl.disableVertexAttribArray(posLoc);
          gl.disableVertexAttribArray(texLoc);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
          gl.deleteBuffer(buf);

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.bindTexture(gl.TEXTURE_2D, null);
          gl.deleteTexture(tex);

          if (typeof needsRedraw !== "undefined") needsRedraw = true;
        }


    // rebuild layers in stored order
    for (const src of art.project.layers) {
      const { texture, fbo } = createLayerFBO(w, h);


        const L = {
          id: Date.now() + Math.random(),
          name: src.name || `Layer ${layers.length+1}`,
          fbo, texture,
          visible: !!src.visible,
          opacity: Number(src.opacity) || 1,

          x: 0, y: 0,
          scaleX: 1, scaleY: 1,
          rotation: 0,

          history: [], redo: []
        };



      layers.push(L);

      // decode PNG and draw into FBO
      const url = URL.createObjectURL(src.blob);
      const img = new Image();
      await new Promise((resolve) => {
        img.onload = () => { drawImageIntoLayerFBO(img, fbo); URL.revokeObjectURL(url); resolve(); };
        img.src = url;
      });
    }

    activeLayerIndex = Math.max(0, layers.length - 1);
    syncActiveAliases();
    if (typeof rebuildLayersUI === "function") rebuildLayersUI();

    needsRedraw = true;

    // close gallery modal if it exists
    const gModal = document.getElementById("galleryModal");
    if (gModal) closeModal(gModal);

    showStatusMessage("Artwork loaded!", "success");
    return;
  }

  // Fallback: flat image only
  await new Promise((resolve) => {
    const img = new Image();


    img.onload = () => {
      clearCanvas();
      currentImage = img;
      fixedFBOWidth = img.width;
      fixedFBOHeight = img.height;

      updateCanvasSize(img);
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

      const nameEl = document.getElementById("artworkName");
      const idEl   = document.getElementById("existingArtworkId");
      if (art.name && nameEl) nameEl.value = art.name;
      if (idEl) idEl.value = art.id;

      const gModal = document.getElementById("galleryModal");
      if (gModal) closeModal(gModal);

      showStatusMessage("Artwork loaded!", "success");
      resolve();
    };


    img.src = URL.createObjectURL(art.image);
  });
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


async function exportProjectZIP({ includeBackground = true } = {}) {
  if (!window.JSZip) {
    console.error("JSZip not loaded");
    showStatusMessage("Export failed: JSZip not loaded.", "error");
    return;
  }

  const W = fixedFBOWidth, H = fixedFBOHeight;
  const zip = new JSZip();

  // ----- Manifest -----
  const manifest = {
    version: 1,
    width: W,
    height: H,
    app: "Helena Paint",
    date: new Date().toISOString(),
    layers: layers.map((L, i) => ({
      name: L.name,
      visible: !!L.visible,
      opacity: Number(L.opacity) || 1,
      // current transforms are typically baked on endTransform, but keep them anyway:
      x: L.x || 0, y: L.y || 0,
      scaleX: L.scaleX || 1, scaleY: L.scaleY || 1,
      rotation: L.rotation || 0,
      index: i
    })),
    hasBackground: !!currentImage && includeBackground
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2), { compression: "DEFLATE" });

  // ----- Background (optional) -----
  if (manifest.hasBackground) {
    // Re-rasterize the currentImage to exact doc size W×H
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = W; bgCanvas.height = H;
    const bgCtx = bgCanvas.getContext("2d");
    bgCtx.drawImage(currentImage, 0, 0, W, H);
    const bgBlob = await new Promise(res => bgCanvas.toBlob(res, "image/png", 0.92));
    zip.file("background.png", bgBlob, { compression: "DEFLATE" });
  }

  // ----- Layers -----
  // Save each layer’s raw pixels (FBO space) → PNG
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const imgData = readFBOToImageData(L.fbo, W, H);
    const pngBlob = await imageDataToPngBlob(imgData);
    zip.file(`layers/${String(i).padStart(3, "0")}_${(L.name||"Layer").replace(/[^\w\-]+/g,"_")}.png`,
             pngBlob, { compression: "DEFLATE" });
  }

  // ----- Build ZIP -----
  const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const fileName = `helena_project_${Date.now()}.hpaint`; // custom extension (zip under the hood)

  // Download
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showStatusMessage("Project exported!", "success");
}


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

    // Build an object like your IndexedDB record to reuse loadArtworkObject()
    const project = {
      width: manifest.width,
      height: manifest.height,
      backgroundBlob: null,
      layers: []
    };

    // Background
    if (manifest.hasBackground && zip.file("background.png")) {
      const bgBlob = await zip.file("background.png").async("blob");
      project.backgroundBlob = bgBlob;
    }

    // Layers: sorted by index to preserve order
    const layerDefs = (manifest.layers || []).slice().sort((a, b) => a.index - b.index);

    for (let i = 0; i < layerDefs.length; i++) {
      const def = layerDefs[i];
      // filename pattern used on export
      const patternPrefix = String(def.index).padStart(3, "0") + "_";
      // find matching file (fallback: any in /layers)
      const candidates = Object.keys(zip.files).filter(k => k.startsWith("layers/"));
      const match = candidates.find(k => k.split("/").pop().startsWith(patternPrefix)) || candidates[def.index];

      if (!match) {
        console.warn("Missing layer image in zip for index", def.index);
        continue;
      }
      const layerBlob = await zip.file(match).async("blob");

      project.layers.push({
        name: def.name || `Layer ${i+1}`,
        visible: !!def.visible,
        opacity: Number(def.opacity) || 1,
        blob: layerBlob
      });
    }

    // Fake an IndexedDB artwork record-like object and reuse your loader:
    const artObj = {
      id: Date.now(),
      name: (file && file.name) ? file.name.replace(/\.hpaint$/i, "") : "Imported Project",
      date: new Date().toISOString(),
      username: "User",
      appName: "Web Paint",
      image: null,       // not needed for layered project
      thumbnail: null,   // will be generated by save/gallery later
      project
    };

    await loadArtworkObject(artObj);
    showStatusMessage("Project imported!", "success");
  } catch (err) {
    console.error("Import error:", err);
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
  const w = fixedFBOWidth;
  const h = fixedFBOHeight;

  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = w;
  offscreenCanvas.height = h;
  const offscreenCtx = offscreenCanvas.getContext("2d");

  // 0) start transparent
  offscreenCtx.clearRect(0, 0, w, h);

  // 1) optional background
  if (includeBackground && currentImage) {
    offscreenCtx.drawImage(currentImage, 0, 0, w, h);
  }

  // helper to read an FBO into ImageData
  function readFBOToImageData(fbo) {
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new ImageData(new Uint8ClampedArray(pixels), w, h);
  }

  // 2) composite all layers bottom→top with opacity
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (!L.visible || L.opacity <= 0) continue;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.putImageData(readFBOToImageData(L.fbo), 0, 0);

    // Flip to correct WebGL Y orientation
    offscreenCtx.save();
    offscreenCtx.globalAlpha = L.opacity;
    offscreenCtx.translate(w / 2, h / 2);
    offscreenCtx.scale(-1, -1);
    offscreenCtx.rotate(Math.PI);
    offscreenCtx.drawImage(tempCanvas, -w / 2, -h / 2);
    offscreenCtx.restore();
  }

  // 3) export PNG
  const link = document.createElement("a");
  const suffix = includeBackground ? "_with_background" : "_transparent";
  link.download = `canvas_${Date.now()}${suffix}.png`;
  link.href = offscreenCanvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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



// Compose everything into a 2D canvas (background + visible layers)
function composeToCanvas(includeBackground = true) {
  const w = fixedFBOWidth, h = fixedFBOHeight;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d");

  // start transparent
  ctx.clearRect(0, 0, w, h);

  // optional background
  if (includeBackground && currentImage) {
    ctx.drawImage(currentImage, 0, 0, w, h);
  }

  // helper to read an FBO into ImageData
  function readFBOToImageData(fbo) {
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new ImageData(new Uint8ClampedArray(pixels), w, h);
  }

  // composite all layers bottom → top with opacity,
  // flipping to fix WebGL's Y orientation
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    if (!L || !L.visible || L.opacity <= 0) continue;

    const temp = document.createElement("canvas");
    temp.width = w; temp.height = h;
    const tctx = temp.getContext("2d");
    tctx.putImageData(readFBOToImageData(L.fbo), 0, 0);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, L.opacity));
    ctx.translate(w / 2, h / 2);
    ctx.scale(-1, -1);
    ctx.rotate(Math.PI);
    ctx.drawImage(temp, -w / 2, -h / 2);
    ctx.restore();
  }

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


    // Save from Canvas
    drawProfileButton.addEventListener("click", () => {
    if (!canvas) {
        showStatusMessage("Canvas not ready!", "error");
        return;
    }

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

    const avatarSize = 128;
    const avatarCanvas = document.createElement("canvas");
    avatarCanvas.width = avatarSize;
    avatarCanvas.height = avatarSize;
    const avatarCtx = avatarCanvas.getContext("2d");

    avatarCtx.beginPath();
    avatarCtx.arc(avatarSize / 2, avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    avatarCtx.closePath();
    avatarCtx.clip();

    const scale = Math.max(
        avatarSize / fixedFBOWidth,
        avatarSize / fixedFBOHeight
    );

    const drawWidth = fixedFBOWidth * scale;
    const drawHeight = fixedFBOHeight * scale;
    const dx = (avatarSize - drawWidth) / 2;
    const dy = (avatarSize - drawHeight) / 2;

    avatarCtx.drawImage(
        offscreenCanvas,
        dx, dy, drawWidth, drawHeight
    );

    const avatarDataURL = avatarCanvas.toDataURL("image/png");

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

    saveArtwork("avatar-" + (profileData.nickname || "user"));

    showStatusMessage("Profile image updated from drawing!", "success");
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

    console.log("[WebSocket] Connecting to:", wsUrl);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("[WebSocket] Connected");
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
                console.log("[WebSocket] Ping sent");

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
    console.log("[WebSocket] Message received:", event.data);

    try {
        let jsonStr = event.data;
        if (jsonStr.startsWith("[User] ")) {
            jsonStr = jsonStr.substring(7);
        }

        const msgObj = JSON.parse(jsonStr);

        if (msgObj.type === "welcome") {
            clientId = msgObj.clientId;
            console.log("[WebSocket] Assigned clientId:", clientId);
            updateChatUsers();
            return;
        }

        if (msgObj.type === "profile-update") {
            profileCache.set(msgObj.clientId, {
                nickname: msgObj.nickname,
                profileImage: msgObj.profileImage
            });
            console.log("[WebSocket] Profile update:", msgObj.clientId);
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
            console.log("[WebSocket] User list update:", profileCache.size, "users");
            updateChatUsers();
            return;
        }

        if (msgObj.type === "pong") {
            lastPongTime = Date.now();
            console.log("[WebSocket] Pong received");
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
        console.log("[WebSocket] Disconnected. Retrying in 3s...");
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


function sendCurrentArtworkToChat(name = "Untitled", opts = {}) {
  // === TWEAK HERE WHEN CALLING ===
  const {
    size = 1024,            // longest side in pixels; use 1 to keep original size
    quality = 0.75,          // 0..1 (used for WebP/JPEG); ignored for PNG
    format = "image/webp",  // "image/webp" | "image/jpeg" | "image/png"
    includeBackground = true,
    glFlipY = true          // set false if your composeToCanvas already matches screen
  } = opts;

  try {
    console.log("[sendCurrentArtworkToChat] start");

    // 1) Flatten to a single 2D canvas
    let flattened = null;

    if (typeof composeToCanvas === "function") {
      flattened = composeToCanvas(includeBackground);
      console.log("[sendCurrentArtworkToChat] Using composeToCanvas() flatten");
    } else {
      console.log("[sendCurrentArtworkToChat] composeToCanvas() missing; using fallback");
      const offscreenCanvas = document.createElement("canvas");
      offscreenCanvas.width = fixedFBOWidth;
      offscreenCanvas.height = fixedFBOHeight;
      const offscreenCtx = offscreenCanvas.getContext("2d");

      // draw BG/currentImage if you have one
      if (currentImage) {
        offscreenCtx.drawImage(currentImage, 0, 0, fixedFBOWidth, fixedFBOHeight);
      }

      // bring GL layer
      const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
      gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = fixedFBOWidth;
      tempCanvas.height = fixedFBOHeight;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), fixedFBOWidth, fixedFBOHeight), 0, 0);

      // fix orientation (WebGL readPixels is bottom-left origin)
      if (glFlipY) {
        offscreenCtx.save();
        offscreenCtx.translate(fixedFBOWidth / 2, fixedFBOHeight / 2);
        offscreenCtx.scale(-1, -1);
        offscreenCtx.rotate(Math.PI);
        offscreenCtx.drawImage(tempCanvas, -fixedFBOWidth / 2, -fixedFBOHeight / 2);
        offscreenCtx.restore();
      } else {
        offscreenCtx.drawImage(tempCanvas, 0, 0);
      }

      flattened = offscreenCanvas;
    }

    // 2) Target size
    const targetMax = (size === 1) ? Math.max(flattened.width, flattened.height) : Math.max(1, Math.round(size));
    const scale = Math.min(1, targetMax / Math.max(flattened.width, flattened.height));
    const outW = Math.max(1, Math.round(flattened.width  * scale));
    const outH = Math.max(1, Math.round(flattened.height * scale));

    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = outW;
    previewCanvas.height = outH;
    const previewCtx = previewCanvas.getContext("2d");
    previewCtx.drawImage(flattened, 0, 0, outW, outH);

    const rawDataSize = flattened.width * flattened.height * 4;
    console.log(`[sendCurrentArtworkToChat] Raw RGBA ~${Math.round(rawDataSize / 1024)} KB`);

    // 3) Encode & send
    const mime = format;
    const q = quality;

    previewCanvas.toBlob((blob) => {
      if (!blob) {
        console.error("[sendCurrentArtworkToChat] ERROR: Failed to generate blob.");
        showStatusMessage("Error sending artwork to chat.", "error");
        return;
      }

      console.log(`[sendCurrentArtworkToChat] Blob ${mime}, ${Math.round(blob.size/1024)} KB`);

      const reader = new FileReader();
      reader.onloadend = () => {
        const imageDataURL = reader.result;
        if (socket && socket.readyState === WebSocket.OPEN) {
          const profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
          const nickname = profileData.nickname?.trim() || "";
          const profileImage = profileData.image || "";

          const chatMsg = {
            type: "image",
            clientId,
            nickname,
            profileImage,
            imageData: imageDataURL,
            imageName: name,
            timestamp: Date.now()
          };

          socket.send(JSON.stringify(chatMsg));
          console.log("[sendCurrentArtworkToChat] Artwork sent to chat.");
          showStatusMessage("Send to Chat", "info");
        }
      };

      reader.readAsDataURL(blob);
    }, mime, q);

  } catch (error) {
    console.error("[sendCurrentArtworkToChat] CATCH ERROR:", error);
    showStatusMessage("Error sending artwork to chat.", "error");
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

  let offsetX = 0, offsetY = 0, isDragging = false;


dragBar.addEventListener("pointerdown", (e) => {
  // ✅ allow dragging even when minimized
  isDragging = true;
  offsetX = e.clientX - panel.offsetLeft;
  offsetY = e.clientY - panel.offsetTop;
  dragBar.setPointerCapture(e.pointerId);
  dragBar.style.cursor = "grabbing";
});

dragBar.addEventListener("pointermove", (e) => {
  if (!isDragging) return;
  const x = e.clientX - offsetX;
  const y = e.clientY - offsetY;
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  panel.style.bottom = "auto";
});

dragBar.addEventListener("pointerup", (e) => {
  isDragging = false;
  dragBar.releasePointerCapture(e.pointerId);
  dragBar.style.cursor = "grab";
});

dragBar.addEventListener("pointercancel", () => {
  isDragging = false;
  dragBar.style.cursor = "grab";
});



const brushWrapper = document.getElementById("brushContainerWrapper");
const brushDragBar = document.getElementById("brushContainerDragBar");

let brushOffsetX = 0, brushOffsetY = 0, isBrushDragging = false;

brushDragBar.addEventListener("pointerdown", (e) => {
  isBrushDragging = true;
  brushOffsetX = e.clientX - brushWrapper.offsetLeft;
  brushOffsetY = e.clientY - brushWrapper.offsetTop;
  brushDragBar.setPointerCapture(e.pointerId);
  brushDragBar.style.cursor = "grabbing";
});

brushDragBar.addEventListener("pointermove", (e) => {
  if (!isBrushDragging) return;
  const x = e.clientX - brushOffsetX;
  const y = e.clientY - brushOffsetY;
  brushWrapper.style.left = `${x}px`;
  brushWrapper.style.top = `${y}px`;
});

brushDragBar.addEventListener("pointerup", (e) => {
  isBrushDragging = false;
  brushDragBar.releasePointerCapture(e.pointerId);
  brushDragBar.style.cursor = "grab";
});

brushDragBar.addEventListener("pointercancel", () => {
  isBrushDragging = false;
  brushDragBar.style.cursor = "grab";
});








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

function clearCanvas(keepBackground = true) {
  // wipe all paint layers
  layers.forEach(L => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
    gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // reset undo/redo + stroke cursors
  strokeHistory.length = 0;
  redoHistory.length = 0;
  lastX = lastY = lastFx = lastFy = null;
  strokeCount = 0;

  // keep or drop the background image
  if (!keepBackground) {
    currentImage = null;
    texture = null;
  }

  // make sure the canvas is visible & redrawn
  ensureCanvasNotLost?.();
  needsRedraw = true;

  showStatusMessage("Canvas cleared", "info");
  resetToCurrentWindow();
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




// --- Layers Panel: drag + collapse + persist ---
(function setupLayersPanel() {
  const panel  = document.getElementById("layersPanel");
  if (!panel) return;

  const header = panel.querySelector(".layers-header");
  const actions= panel.querySelector(".layers-actions");
  const list   = document.getElementById("layersList");

  // Positioning
  panel.style.position = panel.style.position || "fixed";
  panel.style.zIndex = panel.style.zIndex || "30";
  if (!panel.style.left) panel.style.left = "16px";
  if (!panel.style.top)  panel.style.top  = "16px";

  // Persist keys
  const KEY_MIN = "layersPanel:minimized";
  const KEY_X   = "layersPanel:x";
  const KEY_Y   = "layersPanel:y";

  // Restore position
  const px = localStorage.getItem(KEY_X);
  const py = localStorage.getItem(KEY_Y);
  if (px !== null && py !== null) {
    panel.style.left = `${+px}px`;
    panel.style.top  = `${+py}px`;
  }

  // Toggle button (injected, no HTML change)
  let toggleBtn = document.getElementById("layersPanelToggle");
  if (!toggleBtn) {
    toggleBtn = document.createElement("button");
    toggleBtn.id = "layersPanelToggle";
    toggleBtn.className = "bs";
    toggleBtn.title = "Show/Hide Layers";
    toggleBtn.style.minWidth = "28px";
    toggleBtn.style.display = "inline-flex";
    toggleBtn.style.alignItems = "center";
    toggleBtn.style.justifyContent = "center";
    toggleBtn.innerHTML = `<img class="show-icon-invert" src="/static/draw/images/icons/show.svg" alt="Hide">`;
    actions?.appendChild(toggleBtn);
  }

  // Minimized state
  let minimized = localStorage.getItem(KEY_MIN) === "true";
  function applyMin() {
    if (list) list.style.display = minimized ? "none" : "block";
    toggleBtn.innerHTML = minimized
      ? `<img class="show-icon0invert" src="/static/draw/images/icons/hide.svg" alt="Show">`
      : `<img class="show-icon-invert" src="/static/draw/images/icons/show.svg" alt="Hide">`;
  }
  applyMin();

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    minimized = !minimized;
    localStorage.setItem(KEY_MIN, minimized);
    applyMin();
  });

  // Dragging via header (ignore clicks on buttons/inputs inside header)
  let dragging = false, offX = 0, offY = 0;

  function clampToViewport(x, y) {
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nx = Math.min(Math.max(8 - rect.width * 0.5, x), vw - 8 - rect.width * 0.5);
    const ny = Math.min(Math.max(8, y), vh - 8);
    return { x: nx, y: ny };
  }

  header.style.cursor = "grab";

  header.addEventListener("pointerdown", (e) => {
    // let header buttons work normally
    if (e.target.closest("button,input,select,label")) return;
    dragging = true;
    offX = e.clientX - panel.offsetLeft;
    offY = e.clientY - panel.offsetTop;
    try { header.setPointerCapture(e.pointerId); } catch {}
    header.style.cursor = "grabbing";
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const { x, y } = clampToViewport(e.clientX - offX, e.clientY - offY);
    panel.style.left = `${x}px`;
    panel.style.top  = `${y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });

  function stopDrag(e) {
    if (!dragging) return;
    dragging = false;
    try { header.releasePointerCapture(e.pointerId); } catch {}
    header.style.cursor = "grab";
    localStorage.setItem(KEY_X, String(panel.offsetLeft));
    localStorage.setItem(KEY_Y, String(panel.offsetTop));
  }
  header.addEventListener("pointerup", stopDrag);
  header.addEventListener("pointercancel", stopDrag);

  // If restored off-screen (e.g., after resize), nudge back in
  function nudgeIntoView() {
    const r = panel.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = panel.offsetLeft, y = panel.offsetTop, nudged = false;
    if (r.right < 40) { x = 16; nudged = true; }
    if (r.bottom < 40) { y = 16; nudged = true; }
    if (r.left > vw - 40) { x = vw - r.width - 16; nudged = true; }
    if (r.top  > vh - 40) { y = vh - r.height - 16; nudged = true; }
    if (nudged) {
      panel.style.left = `${x}px`;
      panel.style.top  = `${y}px`;
      localStorage.setItem(KEY_X, String(x));
      localStorage.setItem(KEY_Y, String(y));
    }
  }
  window.addEventListener("resize", nudgeIntoView);
  nudgeIntoView();
})();







//–––––––––––––––––––
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




//–––––––––––––––––––
// SHORTCUTS HE
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



