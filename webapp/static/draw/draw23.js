console.log("Helena Paint - draw19.js")

function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}

const canvas = document.getElementById("glCanvas");

const gl = canvas.getContext("webgl2", { 
    alpha: true, 
    powerPreference: "high-performance" 
});

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
function hexToRGBA(hex) {
    if (hex.charAt(0) === "#") hex = hex.substr(1);
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    let intVal = parseInt(hex, 16);
    let r = ((intVal >> 16) & 255) / 255;
    let g = ((intVal >> 8) & 255) / 255;
    let b = (intVal & 255) / 255;
    return [r, g, b, 1.0];
}


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
function hexToRGBA(hex) {
    if (hex.charAt(0) === "#") hex = hex.substr(1);
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    let intVal = parseInt(hex, 16);
    let r = ((intVal >> 16) & 255) / 255;
    let g = ((intVal >> 8) & 255) / 255;
    let b = (intVal & 255) / 255;
    return [r, g, b, 1.0];
}


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
  void main() {
    gl_FragColor = texture2D(u_texture, v_texCoord);
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
// INITIALIZATION
//–––––––––––––––––––
function initGL() {
    if (!gl) {
        console.error("WebGL not supported.");
        return;
    }
    quadProgram = createProgram(gl, quadVS, quadFS);
    paintProgram = createProgram(gl, quadVS, paintFS);
    overlayProgram = createProgram(gl, quadVS, overlayFS);
}

// Create (or recreate) the persistent paint layer matching canvas size.
function initPaintLayer() {
    if (paintTexture) { gl.deleteTexture(paintTexture);
        paintTexture = null; }
    if (paintFBO) { gl.deleteFramebuffer(paintFBO);
        paintFBO = null; }
    paintTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paintTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height,
        0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    paintFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, paintTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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


function initPaintLayerFixed() {
  if (paintTexture) { gl.deleteTexture(paintTexture); paintTexture = null; }
  if (paintFBO) { gl.deleteFramebuffer(paintFBO); paintFBO = null; }
  paintTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, paintTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    fixedFBOWidth,
    fixedFBOHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  paintFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, paintTexture, 0);
  // Clear the persistent layer to fully transparent:
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    const thumbnails = container.getElementsByTagName("img");
    for (let i = 0; i < thumbnails.length; i++) {
        const brushName = brushes[i].name;
        thumbnails[i].style.border = (brushName === activeBrush) ? "2px solid red" : "2px solid transparent";
    }
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
// CANVAS RESIZING
//–––––––––––––––––––

function updateBrushSize() {
    const newWidth = canvas.width;
    const newHeight = canvas.height;

    // Adjust the brush size relative to the canvas width.
    // For example, 0.1 means the brush size is 10% of the canvas width.
    brushSize = Math.min(brushSize, newWidth / 10);
}


function updateCanvasSize(image) {
    if (!image) return;

    const windowAspect = window.innerWidth / window.innerHeight;
    imageAspect = image.width / image.height;
    let newWidth, newHeight;

    if (imageAspect > windowAspect) {
        newWidth = window.innerWidth;
        newHeight = window.innerWidth / imageAspect;
    } else {
        newHeight = window.innerHeight;
        newWidth = window.innerHeight * imageAspect;
    }

    const oldPaintFBO = paintFBO;
    const oldPaintTexture = paintTexture;

    canvas.width = newWidth;
    canvas.height = newHeight;
    gl.viewport(0, 0, newWidth, newHeight);

    const newPaintTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, newPaintTexture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        fixedFBOWidth,
        fixedFBOHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const newPaintFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, newPaintFBO);
    gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        newPaintTexture,
        0
    );

    if (oldPaintFBO && fixedFBOWidth > 0 && fixedFBOHeight > 0) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, oldPaintFBO);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, newPaintFBO);
        gl.blitFramebuffer(
            0, 0, fixedFBOWidth, fixedFBOHeight,
            0, 0, fixedFBOWidth, fixedFBOHeight,
            gl.COLOR_BUFFER_BIT,
            gl.NEAREST
        );
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.deleteTexture(oldPaintTexture);
        gl.deleteFramebuffer(oldPaintFBO);
    }

    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    paintTexture = newPaintTexture;
    paintFBO = newPaintFBO;

    // Adjust brush size based on new canvas size
    updateBrushSize();

    drawScene();
}

window.addEventListener("resize", () => {
    if (currentImage) updateCanvasSize(currentImage);
});




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
function getTouchPos(event) {
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches[0] || event.changedTouches[0];
    return {
        x: (touch.clientX - rect.left) * (canvas.width / rect.width),
        y: (touch.clientY - rect.top) * (canvas.height / rect.height)
    };
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



//–––––––––––––––––––
// MOUSE/TOUCH HANDLING
//–––––––––––––––––––
function getMousePos(event) {
    const rect = canvas.getBoundingClientRect();
    let x, y;
    if (event.offsetX !== undefined && event.offsetY !== undefined) {
        x = event.offsetX;
        y = event.offsetY;
    } else {
        x = (event.clientX - rect.left) * (canvas.width / rect.width);
        y = (event.clientY - rect.top) * (canvas.height / rect.height);
    }
    return { x, y };
}

canvas.addEventListener("mousedown", (event) => {
    if (currentTool === 'fill') {
        const pos = getMousePos(event);
        performFloodFill(pos.x, pos.y);
        return;
    }

    isDrawing = true;
    const pos = getMousePos(event);
    overlayPosition = [pos.x / canvas.width, pos.y / canvas.height];
    drawBrushStrokeToPaintLayer(pos.x, pos.y);
});




let lastDrawTime = 0;

canvas.addEventListener("mousemove", (event) => {
    if (Date.now() - lastDrawTime < 16) return;
    lastDrawTime = Date.now();
    const pos = getMousePos(event);
    if (lastX !== null && lastY !== null) {
        const dx = pos.x - lastX;
        const dy = pos.y - lastY;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            currentAngle = Math.atan2(dy, dx);
        }
    }
    lastX = pos.x;
    lastY = pos.y;
    overlayPosition = [pos.x / canvas.width, pos.y / canvas.height];
    if (isDrawing) {
        drawBrushStrokeToPaintLayer(pos.x, pos.y);
    }
});

// Replace the existing touchmove listener with:
canvas.addEventListener("touchmove", (event) => {
    event.preventDefault();
    if (Date.now() - lastDrawTime < 16) return;
    lastDrawTime = Date.now();
    const pos = getMousePos(event.touches[0]);
    if (lastX !== null && lastY !== null) {
        const dx = pos.x - lastX;
        const dy = pos.y - lastY;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            currentAngle = Math.atan2(dy, dx);
        }
    }
    lastX = pos.x;
    lastY = pos.y;
    overlayPosition = [pos.x / canvas.width, pos.y / canvas.height];
    if (isDrawing) {
        drawBrushStrokeToPaintLayer(pos.x, pos.y);
    }
});


canvas.addEventListener("mouseup", () => { isDrawing = false; });
canvas.addEventListener("mouseleave", () => { isDrawing = false; });


canvas.addEventListener("mouseup", () => {
    isDrawing = false;
    lastFx = null;
    lastFy = null;
});

canvas.addEventListener("mouseleave", () => {
    isDrawing = false;
    lastFx = null;
    lastFy = null;
});

canvas.addEventListener("touchend", () => {
    isDrawing = false;
    lastFx = null;
    lastFy = null;
});


canvas.addEventListener("touchstart", (event) => {
    event.preventDefault();
    const pos = getMousePos(event.touches[0]);

    if (currentTool === 'fill') {
        performFloodFill(pos.x, pos.y);
        return;
    }

    isDrawing = true;
    overlayPosition = [pos.x / canvas.width, pos.y / canvas.height];
    drawBrushStrokeToPaintLayer(pos.x, pos.y);
});




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
  } else if (event.key === "]") {
    brushSize = Math.min(1.0, brushSize + 0.02);
    brushSizeSlider.value = brushSize;
    shouldRedraw = true;
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


function performFloodFill(mouseX, mouseY) {
    const pixelColor = new Uint8Array(4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    gl.readPixels(mouseX, fixedFBOHeight - mouseY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelColor);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const targetColor = [
        pixelColor[0] / 255.0,
        pixelColor[1] / 255.0,
        pixelColor[2] / 255.0,
        pixelColor[3] / 255.0
    ];

    const fillColor = tintColor; // use the currently selected brush color

    runFloodFillShader(targetColor, fillColor);

    saveStrokeState(); // record to strokeHistory for undo/redo
    needsRedraw = true;
}


function runFloodFillShader(targetColor, fillColor) {
    const maxIterations = 50;
    let sourceFBO = fillFBO1;
    let destFBO = fillFBO2;

    // Step 1: copy paintFBO → sourceFBO (initialize)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, paintFBO);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sourceFBO.fbo);
    gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);

    gl.blitFramebuffer(
        0, 0, fixedFBOWidth, fixedFBOHeight,
        0, 0, fixedFBOWidth, fixedFBOHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
    );

    // Create full-screen quad buffer
    const floodVertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1
    ]);

    const floodBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, floodBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, floodVertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(floodFillProgram, "aPosition");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Step 2: iterative passes
    for (let i = 0; i < maxIterations; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.fbo);
        gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);

        gl.useProgram(floodFillProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceFBO.texture);
        gl.uniform1i(gl.getUniformLocation(floodFillProgram, "uSource"), 0);

        gl.uniform4fv(gl.getUniformLocation(floodFillProgram, "uTargetColor"), targetColor);
        gl.uniform4fv(gl.getUniformLocation(floodFillProgram, "uFillColor"), fillColor);
        gl.uniform2f(gl.getUniformLocation(floodFillProgram, "uTexelSize"), 1.0 / fixedFBOWidth, 1.0 / fixedFBOHeight);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Swap FBOs
        let temp = sourceFBO;
        sourceFBO = destFBO;
        destFBO = temp;
    }

    // Step 3: copy result → paintFBO
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, paintFBO);
    gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);

    gl.blitFramebuffer(
        0, 0, fixedFBOWidth, fixedFBOHeight,
        0, 0, fixedFBOWidth, fixedFBOHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
    );

    // Cleanup
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

    console.log("flattenStrokes", strokeCount)

    // Create a new texture to hold the merged strokes.
    const mergedTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, mergedTexture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        fixedFBOWidth,
        fixedFBOHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
    );
    // Use NEAREST filtering for a 1:1 copy.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Create a framebuffer for the merged texture.
    const mergeFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, mergeFBO);
    gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        mergedTexture,
        0
    );

    // Bind the current persistent paint layer for reading.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, paintFBO);
    gl.blitFramebuffer(
        0, 0, fixedFBOWidth, fixedFBOHeight, // source rectangle (fixed resolution)
        0, 0, fixedFBOWidth, fixedFBOHeight, // destination rectangle (fixed resolution)
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    // Replace the old persistent paint layer with the merged one.
    gl.deleteTexture(paintTexture);
    gl.deleteFramebuffer(paintFBO);
    paintTexture = mergedTexture;
    paintFBO = mergeFBO;

    // Reset the stroke counter.
    strokeCount = 0;
}

// Draw a brush stroke into the persistent paint layer (offscreen).
// x and y are in pixel coordinates (with (0,0) at top left).

let lastX = null,
    lastY = null;
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
    const backupTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, backupTexture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        fixedFBOWidth,
        fixedFBOHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const backupFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, backupFBO);
    gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        backupTexture,
        0
    );

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, paintFBO);
    gl.blitFramebuffer(
        0, 0, fixedFBOWidth, fixedFBOHeight,
        0, 0, fixedFBOWidth, fixedFBOHeight,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
    );
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

function undoStroke() {
    console.log("undoStroke", strokeHistory.length);

    if (strokeHistory.length > 0) {
        const lastGroup = strokeHistory.pop();
        redoHistory.push(lastGroup);

        gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
        gl.viewport(0, 0, fixedFBOWidth, fixedFBOHeight);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (strokeHistory.length > 0) {
            const previousGroup = strokeHistory[strokeHistory.length - 1];
            const lastStep = previousGroup[previousGroup.length - 1];

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, lastStep.fbo);
            gl.blitFramebuffer(
                0, 0, fixedFBOWidth, fixedFBOHeight,
                0, 0, fixedFBOWidth, fixedFBOHeight,
                gl.COLOR_BUFFER_BIT,
                gl.NEAREST
            );
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        } else {
            gl.clearColor(1, 1, 1, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        needsRedraw = true;
        showStatusMessage("Undo", "info");
    }
}

function redoStroke() {
    if (redoHistory.length > 0) {
        const redoGroup = redoHistory.pop();
        strokeHistory.push(redoGroup);

        const lastStep = redoGroup[redoGroup.length - 1];

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, lastStep.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, paintFBO);
        gl.blitFramebuffer(
            0, 0, fixedFBOWidth, fixedFBOHeight,
            0, 0, fixedFBOWidth, fixedFBOHeight,
            gl.COLOR_BUFFER_BIT,
            gl.NEAREST
        );
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

        needsRedraw = true;
        showStatusMessage("Red", "info");
    }
}



// ---- Monitor Frame Time + Undo Memory ---- //

let frameTimes = [];
let memoryWarningShown = false;
let frameRateMonitoringActive = false;  // <-- NEW

function monitorFrameTime() {
    const now = performance.now();

    if (frameTimes.length > 0) {
        const delta = now - frameTimes[frameTimes.length - 1];
        frameTimes.push(now);

        if (frameTimes.length > 30) frameTimes.shift();

        if (frameRateMonitoringActive) {  // <-- only after first interaction
            const avgDelta = frameTimes.reduce((a, b, i, arr) => i > 0 ? a + (b - arr[i - 1]) : a, 0) / (frameTimes.length - 1);

            // If average frame time > 80ms (i.e. < 12fps) → warn
            if (avgDelta > 80 && !memoryWarningShown) {
                console.warn("⚠️ Low frame rate detected! Possible memory overload.");
                showStatusMessage("⚠️ App running slow — consider undo or saving", "warning");
                memoryWarningShown = true;
            }
        }
    } else {
        frameTimes.push(now);
    }

    requestAnimationFrame(monitorFrameTime);
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

    const indicator = document.getElementById("undoMemoryIndicator");
    if (indicator) {
        indicator.textContent = `Undo Mem: ${mb.toFixed(1)} MB`;
    }

    if (mb > threshold && !memoryWarningShown) {
        console.warn(`⚠️ Undo stack uses ${mb.toFixed(1)} MB — may overload GPU`);
        showStatusMessage(`⚠️ Undo stack large (${mb.toFixed(1)} MB) — flatten or undo!`, "warning");
        memoryWarningShown = true;
    }

    setTimeout(monitorUndoMemory, 2000);
}


// ---- Start both monitors ---- //
monitorFrameTime();
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

    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
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
        { x: -halfW, y: -halfH },
        { x: halfW,  y: -halfH },
        { x: -halfW, y: halfH },
        { x: halfW,  y: halfH }
    ];

    const angle = angleOverride ?? currentAngle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const rotated = offsets.map(off => ({
        x: off.x * cosA - off.y * sinA,
        y: off.x * sinA + off.y * cosA
    }));

    const v0 = { x: fx + rotated[0].x, y: fy + rotated[0].y };
    const v1 = { x: fx + rotated[1].x, y: fy + rotated[1].y };
    const v2 = { x: fx + rotated[2].x, y: fy + rotated[2].y };
    const v3 = { x: fx + rotated[3].x, y: fy + rotated[3].y };

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

    const posLoc = gl.getAttribLocation(paintProgram, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

    const texLoc = gl.getAttribLocation(paintProgram, "a_texCoord");
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);

    const brushUniform = gl.getUniformLocation(paintProgram, "u_brush");
    gl.uniform1i(brushUniform, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.deleteBuffer(buffer);
    gl.disableVertexAttribArray(posLoc);
    gl.disableVertexAttribArray(texLoc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}



function drawBrushStrokeToPaintLayer(x, y) {

    //saveStrokeState();

    const scaleX = fixedFBOWidth / canvas.width;
    const scaleY = fixedFBOHeight / canvas.height;
    const fx = x * scaleX;
    const fy = y * scaleY;

    if (lastX !== null && lastY !== null) {
        const dx = x - lastX;
        const dy = y - lastY;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            currentAngle = Math.atan2(dy, dx);
        }
    }
    lastX = x;
    lastY = y;

    // Apply reverse mode
    let actualAngle = currentAngle;
    if (reverseModeEnabled) {
        actualAngle += Math.PI;
    }

    let sizeMultiplier = 1.0;
    if (dynamicModeEnabled) {
        sizeMultiplier = intuitiveMode
            ? (0.8 + Math.random() * 0.8)
            : (1.5 - Math.random());
    }

    if (lineMode && lastFx !== null && lastFy !== null) {
        const dxFixed = fx - lastFx;
        const dyFixed = fy - lastFy;
        const dist = Math.sqrt(dxFixed * dxFixed + dyFixed * dyFixed);

        const baseBrushW = brushSize * fixedFBOWidth;
        let stepSize = baseBrushW * lineStepFactor;

        const speedFactor = Math.min(2.5, dist / (baseBrushW * 0.3));
        let dynamicBrushSize = brushSize * speedFactor * sizeMultiplier;

        stepSize *= speedFactor * sizeMultiplier;

        const steps = Math.max(1, Math.floor(dist / stepSize));
        for (let i = 0; i <= steps; i++) {
            const interpX = lastFx + (dxFixed * i) / steps;
            const interpY = lastFy + (dyFixed * i) / steps;

            drawSingleBrushStamp(interpX, interpY, dynamicBrushSize, actualAngle);
        }
    } else {
        drawSingleBrushStamp(fx, fy, brushSize * sizeMultiplier, actualAngle);
    }

    lastFx = fx;
    lastFy = fy;

    strokeCount++;
    if (strokeCount >= FLATTEN_THRESHOLD) {
        flattenStrokes();
    }

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


function drawScene() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); // Transparent base
  gl.clear(gl.COLOR_BUFFER_BIT);

  // --- 1. Draw background image ---
  if (texture) {
    gl.useProgram(quadProgram);

    const flipLoc = gl.getUniformLocation(quadProgram, "u_flipY");
    gl.uniform1f(flipLoc, -1.0);
    const resLoc = gl.getUniformLocation(quadProgram, "u_resolution");
    gl.uniform2f(resLoc, canvas.width, canvas.height);

    const quadVertices = new Float32Array([
      0, 0, 0, 0,
      canvas.width, 0, 1, 0,
      0, canvas.height, 0, 1,
      0, canvas.height, 0, 1,
      canvas.width, 0, 1, 0,
      canvas.width, canvas.height, 1, 1
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(quadProgram, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

    const texLoc = gl.getAttribLocation(quadProgram, "a_texCoord");
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const texUniform = gl.getUniformLocation(quadProgram, "u_texture");
    gl.uniform1i(texUniform, 0);

    gl.disable(gl.BLEND); // No blending needed for background
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.deleteBuffer(buffer);
  }

  // --- 2. Draw persistent paint layer with blending ---
  if (paintTexture) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(quadProgram);

    const flipLoc = gl.getUniformLocation(quadProgram, "u_flipY");
    gl.uniform1f(flipLoc, -1.0);
    const resLoc = gl.getUniformLocation(quadProgram, "u_resolution");
    gl.uniform2f(resLoc, canvas.width, canvas.height);

    const quadVertices = new Float32Array([
      0, 0, 0, 0,
      canvas.width, 0, 1, 0,
      0, canvas.height, 0, 1,
      0, canvas.height, 0, 1,
      canvas.width, 0, 1, 0,
      canvas.width, canvas.height, 1, 1
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(quadProgram, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

    const texLoc = gl.getAttribLocation(quadProgram, "a_texCoord");
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paintTexture);
    const texUniform = gl.getUniformLocation(quadProgram, "u_texture");
    gl.uniform1i(texUniform, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.deleteBuffer(buffer);
    gl.disable(gl.BLEND);
  }

  // --- 3. Draw brush overlay (preview cursor) ---
  if (overlayProgram) {
    gl.useProgram(overlayProgram);
    const flipLoc = gl.getUniformLocation(overlayProgram, "u_flipY");
    gl.uniform1f(flipLoc, -1.0);
    const resLoc = gl.getUniformLocation(overlayProgram, "u_resolution");
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    drawBrushOverlay();
  }
}



// // Update drawScene by removing the internal requestAnimationFrame call:
// function drawScene() {
//     gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//     gl.viewport(0, 0, canvas.width, canvas.height);
//     gl.clearColor(1, 1, 1, 1);
//     gl.clear(gl.COLOR_BUFFER_BIT);

//     // Draw background image using quadProgram
//     gl.useProgram(quadProgram);
//     let flipLoc = gl.getUniformLocation(quadProgram, "u_flipY");
//     gl.uniform1f(flipLoc, -1.0);
//     let resLoc = gl.getUniformLocation(quadProgram, "u_resolution");
//     gl.uniform2f(resLoc, canvas.width, canvas.height);
//     const quadVertices = new Float32Array([
//         0, 0, 0, 0,
//         canvas.width, 0, 1, 0,
//         0, canvas.height, 0, 1,
//         0, canvas.height, 0, 1,
//         canvas.width, 0, 1, 0,
//         canvas.width, canvas.height, 1, 1
//     ]);
//     let buffer = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
//     gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
//     let posLoc = gl.getAttribLocation(quadProgram, "a_position");
//     gl.enableVertexAttribArray(posLoc);
//     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
//     let texLoc = gl.getAttribLocation(quadProgram, "a_texCoord");
//     gl.enableVertexAttribArray(texLoc);
//     gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
//     gl.activeTexture(gl.TEXTURE0);
//     gl.bindTexture(gl.TEXTURE_2D, texture);
//     const texUniform = gl.getUniformLocation(quadProgram, "u_texture");
//     gl.uniform1i(texUniform, 0);
//     gl.drawArrays(gl.TRIANGLES, 0, 6);
//     gl.deleteBuffer(buffer);

//     // Draw persistent paint layer
//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
//     gl.useProgram(quadProgram);
//     flipLoc = gl.getUniformLocation(quadProgram, "u_flipY");
//     gl.uniform1f(flipLoc, -1.0);
//     buffer = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
//     gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
//     posLoc = gl.getAttribLocation(quadProgram, "a_position");
//     gl.enableVertexAttribArray(posLoc);
//     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
//     texLoc = gl.getAttribLocation(quadProgram, "a_texCoord");
//     gl.enableVertexAttribArray(texLoc);
//     gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
//     gl.activeTexture(gl.TEXTURE0);
//     gl.bindTexture(gl.TEXTURE_2D, paintTexture);
//     gl.uniform1i(texUniform, 0);
//     gl.drawArrays(gl.TRIANGLES, 0, 6);
//     gl.deleteBuffer(buffer);
//     gl.disable(gl.BLEND);

//     // Draw brush overlay
//     gl.useProgram(overlayProgram);
//     flipLoc = gl.getUniformLocation(overlayProgram, "u_flipY");
//     gl.uniform1f(flipLoc, -1.0);
//     resLoc = gl.getUniformLocation(overlayProgram, "u_resolution");
//     gl.uniform2f(resLoc, canvas.width, canvas.height);
//     drawBrushOverlay();
// }


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
    if (event.key.toLowerCase() === "d") {
        dynamicModeEnabled = !dynamicModeEnabled;
        showStatusMessage(`Dynamic Mode: ${dynamicModeEnabled ? "ON" : "OFF"}`, "info");
        needsRedraw = true;
    }

    // Reverse mode: Shift+R
    if (event.shiftKey && event.key.toLowerCase() === "r") {
        reverseModeEnabled = !reverseModeEnabled;
        showStatusMessage(`Reverse Mode: ${reverseModeEnabled ? "ON" : "OFF"}`, "info");
        needsRedraw = true;
    }

    // Intuitive mode: Shift+F
    if (event.shiftKey && event.key.toLowerCase() === "f") {
        intuitiveMode = !intuitiveMode;
        showStatusMessage(`Mode: ${intuitiveMode ? "Intuitive" : "Counter-Intuitive"}`, "info");
        needsRedraw = true;
    }

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


async function saveArtwork(name, isOverwrite = false, existingId = null) {
    try {
        console.log("[saveArtwork] START", { isOverwrite, existingId, currentArtworkId });

        const db = await openDatabase();

        const offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = fixedFBOWidth;
        offscreenCanvas.height = fixedFBOHeight;
        const offscreenCtx = offscreenCanvas.getContext("2d");

        if (currentImage) {
            console.log("[saveArtwork] Drawing currentImage to offscreenCanvas");
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
                console.error("[saveArtwork] ERROR: Failed to generate artwork blob.");
                showStatusMessage("Error saving artwork.", "error");
                return;
            }

            const existingIdInput = document.getElementById("existingArtworkId");
            const existingIdValue = existingIdInput ? existingIdInput.value : null;

            const computedId = isOverwrite
                ? Number(existingId || currentArtworkId || existingIdValue)
                : Date.now();

            console.log("[saveArtwork] Computed ID:", computedId, "typeof:", typeof computedId);

            const artwork = {
                id: computedId,
                name: name || `Untitled ${computedId}`,
                date: new Date().toISOString(),
                username: "User",
                appName: "Web Paint",
                image: blob,
                thumbnail: null,
            };

            const reader = new FileReader();
            reader.onloadend = async () => {
                artwork.thumbnail = reader.result;

                console.log("[saveArtwork] Saving to IndexedDB:", artwork);

                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);

                store.put(artwork);

                tx.oncomplete = () => {
                    console.log("[saveArtwork] SAVE COMPLETE", { id: computedId });
                    showStatusMessage("Artwork saved!", "success");

                    if (existingIdInput) {
                        existingIdInput.value = computedId;
                        console.log("[saveArtwork] Updated existingArtworkId input:", computedId);
                    }

                    currentArtworkId = computedId;
                    console.log("[saveArtwork] Updated currentArtworkId:", currentArtworkId);

                    //––––––––––––––––––––––––––––––
                    // SEND ARTWORK TO CHAT (HERE)
                    //––––––––––––––––––––––––––––––
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        const profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
                        const nickname = profileData.nickname?.trim() || "";
                        const profileImage = profileData.image || "";

                        const chatMsg = {
                            type: "image",
                            clientId: clientId,
                            nickname: nickname,
                            profileImage: profileImage,
                            imageData: artwork.thumbnail, // send image as base64 string
                            imageName: artwork.name,
                            timestamp: Date.now()
                        };

                        socket.send(JSON.stringify(chatMsg));
                        console.log("[saveArtwork] Artwork sent to chat.");
                    }
                };

                tx.onerror = (err) => {
                    console.error("[saveArtwork] IndexedDB ERROR:", err);
                    showStatusMessage("Error saving artwork.", "error");
                };
            };

            reader.readAsDataURL(blob);
        }, "image/webp");

    } catch (error) {
        console.error("[saveArtwork] CATCH ERROR:", error);
        showStatusMessage("Error saving artwork.", "error");
    }
}


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
            saveArtwork(nameInput, true, existingId); // Pass `true` for overwrite and the existing ID
        } else {
            console.error("No existing artwork ID or name found. Cannot overwrite.");
        }

        closeModal(saveModal);
    });


    function saveCanvasAsPNG() {
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

        const dataURL = offscreenCanvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataURL;
        link.download = `canvas_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }



/* Save as ICO */


function saveCanvasAsICO() {
    const targetSize = 64; // Change to 32, 48, etc., for other favicon sizes

    // Create an offscreen canvas for composing the final image
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = targetSize;
    offscreenCanvas.height = targetSize;
    const offscreenCtx = offscreenCanvas.getContext("2d");

    // Step 1: Draw the background image (if available)
    if (currentImage) {
        offscreenCtx.drawImage(currentImage, 0, 0, targetSize, targetSize);
    }

    // Step 2: Extract paint layer from WebGL
    const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
    gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Step 3: Create a temporary canvas for strokes
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = fixedFBOWidth;
    tempCanvas.height = fixedFBOHeight;
    const tempCtx = tempCanvas.getContext("2d");

    const imageData = new ImageData(new Uint8ClampedArray(pixels), fixedFBOWidth, fixedFBOHeight);
    tempCtx.putImageData(imageData, 0, 0);

    // Step 4: Scale down the composed artwork to ICO size
    offscreenCtx.save();
    offscreenCtx.translate(targetSize / 2, targetSize / 2);
    offscreenCtx.scale(-1, -1); // Flip for correct orientation
    offscreenCtx.rotate(Math.PI);
    offscreenCtx.drawImage(tempCanvas, -targetSize / 2, -targetSize / 2, targetSize, targetSize);
    offscreenCtx.restore();

    // Step 5: Convert to ICO format
    offscreenCanvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.readAsArrayBuffer(blob);
        reader.onloadend = () => {
            const pngArrayBuffer = reader.result;
            const icoArrayBuffer = convertPNGToICO(pngArrayBuffer, targetSize);

            const icoBlob = new Blob([icoArrayBuffer], { type: "image/x-icon" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(icoBlob);
            link.download = `favicon.ico`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
    }, "image/png");
}

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
    document.getElementById("saveCanvasButton").addEventListener("click", saveCanvasAsPNG);



    // Load artworks for gallery

let galleryEditMode = false;
let artworkToDeleteId = null;

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
                    <img src="${msgObj.imageData}" alt="${msgObj.imageName}" style="max-width: 220px; max-height: 220px; margin-top: 5px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
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


function sendCurrentArtworkToChat(name = "Untitled") {
    try {
        const offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = fixedFBOWidth;
        offscreenCanvas.height = fixedFBOHeight;
        const offscreenCtx = offscreenCanvas.getContext("2d");

        if (currentImage) {
            console.log("[sendCurrentArtworkToChat] Drawing currentImage to offscreenCanvas");
            offscreenCtx.drawImage(currentImage, 0, 0, fixedFBOWidth, fixedFBOHeight);
        }

        const pixels = new Uint8Array(fixedFBOWidth * fixedFBOHeight * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, paintFBO);
        gl.readPixels(0, 0, fixedFBOWidth, fixedFBOHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        const rawDataSize = pixels.length;
        console.log(`[sendCurrentArtworkToChat] Raw data size: ${rawDataSize} bytes (${Math.round(rawDataSize / 1024)} KB)`);

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

        // Scale down for sending (decimate pixels)
        const scaleFactor = 0.33; // 33% smaller
        const previewWidth = Math.round(fixedFBOWidth * scaleFactor);
        const previewHeight = Math.round(fixedFBOHeight * scaleFactor);

        const previewCanvas = document.createElement("canvas");
        previewCanvas.width = previewWidth;
        previewCanvas.height = previewHeight;
        const previewCtx = previewCanvas.getContext("2d");

        previewCtx.drawImage(offscreenCanvas, 0, 0, previewWidth, previewHeight);

        previewCanvas.toBlob((blob) => {
            if (!blob) {
                console.error("[sendCurrentArtworkToChat] ERROR: Failed to generate preview blob.");
                showStatusMessage("Error sending artwork to chat.", "error");
                return;
            }

            const blobSize = blob.size;
            const compressionRatio = (100 * blobSize) / rawDataSize;

            console.log(`[sendCurrentArtworkToChat] Compressed blob size: ${blobSize} bytes (${Math.round(blobSize / 1024)} KB)`);
            console.log(`[sendCurrentArtworkToChat] Compression ratio: ${compressionRatio.toFixed(2)}% of original raw data`);

            const reader = new FileReader();
            reader.onloadend = () => {
                const imageDataURL = reader.result;

                if (socket && socket.readyState === WebSocket.OPEN) {
                    const profileData = JSON.parse(localStorage.getItem("userProfile")) || {};
                    const nickname = profileData.nickname?.trim() || "";
                    const profileImage = profileData.image || "";

                    const chatMsg = {
                        type: "image",
                        clientId: clientId,
                        nickname: nickname,
                        profileImage: profileImage,
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
        }, "image/webp", 0.35); // compression quality

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
    brushSizeToggle.textContent = "Sliders";

    const rect = brushSizeSliderContainer.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.left < 0 || rect.top < 0 || rect.left > vw - 40 || rect.top > vh - 40) {
      brushSizeSliderContainer.style.left = "10px";
      brushSizeSliderContainer.style.top = "10px";
    }

  } else {
    brushSizeSliderContainer.classList.add("brush-panel-visible");
    brushSizeToggle.textContent = "Hide";
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
  brushContainerToggle.textContent = brushContainerMinimized ? "Brushes" : "Hide";
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



  // dragBar.addEventListener("pointerdown", (e) => {
  //   if (panel.dataset.minimized === "true") return; // ✅ no JS var used
  //   isDragging = true;
  //   offsetX = e.clientX - panel.offsetLeft;
  //   offsetY = e.clientY - panel.offsetTop;
  //   dragBar.setPointerCapture(e.pointerId);
  //   dragBar.style.cursor = "grabbing";
  // });

  // dragBar.addEventListener("pointermove", (e) => {
  //   if (!isDragging || panel.dataset.minimized === "true") return;
  //   const x = e.clientX - offsetX;
  //   const y = e.clientY - offsetY;
  //   panel.style.left = `${x}px`;
  //   panel.style.top = `${y}px`;
  //   panel.style.bottom = "auto";
  // });

  // dragBar.addEventListener("pointerup", (e) => {
  //   isDragging = false;
  //   dragBar.releasePointerCapture(e.pointerId);
  //   dragBar.style.cursor = "grab";
  // });

  // dragBar.addEventListener("pointercancel", () => {
  //   isDragging = false;
  //   dragBar.style.cursor = "grab";
  // });





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
document.getElementById("shareButton").addEventListener("click", shareCurrentArtwork);


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


    async function loadArtwork(id) {
        console.log("Loading artwork with ID:", id);

        showStatusMessage("Loading artwork...", "info");

        const db = await openDatabase();
        const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
        const request = store.get(id);


        request.onsuccess = () => {
            if (request.result) {
                console.log("Artwork found:", request.result);

                const artwork = request.result;

                // Set currentArtworkId global so saveArtwork knows what to overwrite
                currentArtworkId = artwork.id;

                const img = new Image();
                img.onload = () => {
                    console.log("Image loaded successfully.");

                    // Step 1: Clear Canvas Before Loading
                    clearCanvas();

                    // Step 2: Set New Background Image
                    currentImage = img;
                    updateCanvasSize(img);
                    createTextureFromImage(img);

                    drawScene();
                    console.log("Artwork loaded and displayed on canvas.");

                    // Step 3: Populate the Modal with Artwork Info
                    const artworkNameInput = document.getElementById("artworkName");
                    const existingArtworkIdInput = document.getElementById("existingArtworkId");

                    if (artworkNameInput && existingArtworkIdInput) {
                        artworkNameInput.value = artwork.name;
                        existingArtworkIdInput.value = artwork.id;
                    }

                    // Close the gallery modal
                    closeModal(document.getElementById("galleryModal"));
                    showStatusMessage("Artwork loaded!", "success");
                };

                img.onerror = () => {
                    console.error("Failed to load image.");
                    showStatusMessage("Error loading image.", "error");
                };

                img.src = URL.createObjectURL(artwork.image);
            } else {
                console.error("Artwork not found in IndexedDB.");
                showStatusMessage("Artwork not found.", "error");
            }
        };


        request.onerror = () => {
            console.error("Failed to load artwork from IndexedDB.");
            showStatusMessage("Failed to load artwork.", "error");
        };
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
});


// Function to clear the strokes but leave the background image intact
function clearCanvas() {
    console.log("Clearing canvas...");

    // Call undoStroke repeatedly to clear everything
    while (strokeHistory.length > 0) {
        undoStroke();
    }

    drawScene(); // Redraw the scene after clearing

    // Show status message
    showStatusMessage("Canvas cleared", "info");
}

// Event listener for the Clean button
document.getElementById("cleanButton").addEventListener("click", clearCanvas);


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
  { id: "profileSection", display: 'block'},
  { id: "chatToggleBtn", display: 'flex'}
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

canvas.addEventListener("mousedown", () => {
  fadeOutUI();
  if (uiTimeout) clearTimeout(uiTimeout);
});
canvas.addEventListener("touchstart", () => {
  fadeOutUI();
  if (uiTimeout) clearTimeout(uiTimeout);
});
canvas.addEventListener("mouseup", resetUITimeout);
canvas.addEventListener("touchend", resetUITimeout);
canvas.addEventListener("mouseleave", resetUITimeout);
window.addEventListener("blur", resetUITimeout);
window.addEventListener("focus", fadeInUI);


document.getElementById("footer").innerHTML = document.title;

//–––––––––––––––––––
// INITIALIZE & START
//–––––––––––––––––––
initGL();
loadDefaultImage();
loadBrushes();
createBrushThumbnails();

// Instead of calling drawScene() directly, use the render loop:
let needsRedraw = true; // Global flag indicating when to redraw

function renderLoop() {
    if (needsRedraw) {
        drawScene();
        console.log("renderLoop")
        needsRedraw = false; // Reset after drawing
    }
    requestAnimationFrame(renderLoop);
}

renderLoop();







