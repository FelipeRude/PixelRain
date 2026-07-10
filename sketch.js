// Edge Detection auf image.jpg. Nur die Kanten werden angezeigt.
// Alle Parameter kommen live aus dem Slider-Panel (siehe index.html).
// Kanten werden nur bei Slider-Änderung neu berechnet und in edgeLayer gebacken;
// draw() zeigt danach nur noch diesen Buffer an (schnell).

let img;
let edgeLayer;     // Offscreen-Buffer mit den gezeichneten Kanten
let bgCol;         // aktuell wirksame Hintergrundfarbe (kann durch Invertieren wechseln)

// Kanten als abfragbares Raster (für die Kollision der Tropfen).
let edgeGrid;      // Uint8Array: 1 = Kante in dieser Zelle
let gCols, gRows, gcw, gch;   // Rastermaße + Zellgröße in Canvas-Pixeln

// Kurze Helfer zum Auslesen der Regler
const num = (id) => parseFloat(document.getElementById(id).value);
const flag = (id) => document.getElementById(id).checked;
const colr = (id) => document.getElementById(id).value;

function preload() {
  img = loadImage('image.jpg');
}

function setup() {
  const [w, h] = fitSize();
  const c = createCanvas(w, h);
  c.parent('stage');

  edgeLayer = createGraphics(w, h);

  loadSettings();          // gespeicherte Regler-Werte wiederherstellen
  bgCol = colr('farbeBg');
  buildEdges();

  // Bei jeder Änderung speichern. Kanten nur neu berechnen, wenn ein Kanten-Regler (data-edge)
  // bewegt wurde — Regen-Regler werden ohnehin live pro Frame gelesen.
  document.querySelectorAll('#panel input:not([type=file])').forEach((el) =>
    el.addEventListener('input', () => {
      saveSettings();
      if (el.hasAttribute('data-edge')) buildEdges();
    })
  );

  // Eigenes Bild laden.
  document.getElementById('bildDatei').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadImage(url, (loaded) => {
      img = loaded;
      URL.revokeObjectURL(url);
      const [w, h] = fitSize();
      resizeCanvas(w, h);
      edgeLayer = createGraphics(w, h);
      buildEdges();
    });
  });
}

function draw() {
  background(bgCol);
  image(edgeLayer, 0, 0);
  updateRain();
  updateSplashes();
}

// --- Regen ---
// Alle Streifen sind parallel und fallen in dieselbe Richtung (Neigung).
// Jeder Tropfen merkt sich nur zwei Zufallswerte 0..1 (Tempo, Dicke); die echten
// Werte kommen live aus den Reglern. Verlässt ein Tropfen den Rand, taucht er auf
// der Gegenseite wieder auf (Wrap) → immer volle Abdeckung, egal welche Neigung.
let drops = [];
let splashes = [];

function newDrop() {
  return { x: random(width), y: random(height), r: random(), rt: random(), onEdge: false };
}

function updateRain() {
  const target = Math.round(num('regenMenge'));
  while (drops.length < target) drops.push(newDrop());
  if (drops.length > target) drops.length = target;

  const angle = radians(num('neigung'));
  const dx = Math.sin(angle), dy = Math.cos(angle);  // feste Fallrichtung für alle
  const len = num('tropfenLaenge');
  const base = num('grundGeschw');
  const varz = num('geschwVariation');
  const dmin = num('dickeMin'), dmax = num('dickeMax');
  const prob = num('abprallWkt') / 100;   // Abprall-Wahrscheinlichkeit pro berührter Kante

  const c = color(colr('farbeRegen'));
  c.setAlpha(num('regenDeckkraft'));
  stroke(c);

  for (const d of drops) {
    const speed = base * (1 - varz + 2 * varz * d.r); // Tempo variiert, Winkel bleibt gleich
    const thick = dmin + (dmax - dmin) * d.rt;
    d.x += dx * speed;
    d.y += dy * speed;
    d.x = (d.x % width + width) % width;
    d.y = (d.y % height + height) % height;

    // Kollision: nur beim ERSTEN Berühren einer Kante würfeln (nicht jeden Frame).
    const onEdge = isEdgeAt(d.x, d.y);
    if (onEdge && !d.onEdge && random() < prob) {
      spawnSplash(d.x, d.y);         // Splash entsteht
      d.x = random(width); d.y = 0;  // Original verschwindet → startet oben neu
      d.r = random(); d.rt = random(); d.onEdge = false;
      continue;
    }
    d.onEdge = onEdge;

    strokeWeight(thick);
    line(d.x, d.y, d.x - dx * len, d.y - dy * len);
  }
}

// --- Abprallen / Splash ---
// An der Kante spritzen ein paar Tropfen wie eine Fontäne weg und fallen in Kurven runter.
const SPLASH_GRAVITY = 0.35;

function spawnSplash(x, y) {
  const mn = Math.round(num('splashMin'));
  const mx = Math.round(num('splashMax'));
  const n = Math.floor(random(Math.min(mn, mx), Math.max(mn, mx) + 1));
  const weite = num('splashWeite');
  const life = num('splashLeben');
  const thick = num('splashDicke');
  const len = num('splashLaenge');
  for (let i = 0; i < n; i++) {
    const l = life * random(0.7, 1.1);
    splashes.push({
      x, y,
      vx: random(-1, 1) * weite,        // seitlich raus (Weite)
      vy: -random(0.2, 1) * weite,      // erst nach oben, dann zieht die Schwerkraft
      thick: thick * random(0.7, 1.2),
      len,
      life: l, maxLife: l,
    });
  }
}

function updateSplashes() {
  const c = color(colr('farbeRegen'));
  const baseA = num('regenDeckkraft');
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.vy += SPLASH_GRAVITY;
    s.x += s.vx;
    s.y += s.vy;
    s.life--;
    c.setAlpha(baseA * Math.max(0, s.life / s.maxLife));  // ausblenden
    stroke(c);
    strokeWeight(s.thick);
    const sp = Math.hypot(s.vx, s.vy) || 1;
    line(s.x, s.y, s.x - (s.vx / sp) * s.len, s.y - (s.vy / sp) * s.len);
    if (s.life <= 0) splashes.splice(i, 1);
  }
}

// Canvasgröße: Bild-Seitenverhältnis, passend in den Platz neben dem Panel (Breite + Höhe).
function fitSize() {
  const availW = windowWidth - 250; // Panelbreite abziehen
  const availH = windowHeight;
  const aspect = img.width / img.height;
  let h = availH;
  let w = h * aspect;
  if (w > availW) { w = availW; h = w / aspect; }
  return [w, h];
}

function windowResized() {
  const [w, h] = fitSize();
  resizeCanvas(w, h);
  edgeLayer = createGraphics(w, h);
  buildEdges();
}


function buildEdges() {
  const cols = Math.round(num('rasterFeinheit'));
  const rows = Math.max(1, Math.round(cols * img.height / img.width));

  // 1) Bild aufs Raster herunterrechnen und Graustufen auslesen.
  const src = createGraphics(cols, rows);
  src.pixelDensity(1);   // wichtig: 1 Pixel = 1 Zelle (sonst nur ein Bildausschnitt)
  src.image(img, 0, 0, cols, rows);
  src.loadPixels();
  let gray = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const p = i * 4;
    gray[i] = 0.299 * src.pixels[p] + 0.587 * src.pixels[p + 1] + 0.114 * src.pixels[p + 2];
  }
  src.remove();

  // 2) Weichzeichnen (mehrere Box-Blur-Durchgänge).
  const passes = Math.round(num('weichzeichnung'));
  for (let p = 0; p < passes; p++) gray = boxBlur(gray, cols, rows);

  // 3) Sobel -> Magnitude + Richtung.
  const at = (x, y) =>
    gray[constrain(y, 0, rows - 1) * cols + constrain(x, 0, cols - 1)];
  const gain = num('verstaerkung');
  const mag = new Float32Array(cols * rows);
  const dir = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
         at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
         at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const i = y * cols + x;
      mag[i] = Math.hypot(gx, gy) * gain;
      dir[i] = Math.atan2(gy, gx);
    }
  }

  // 4) Optional ausdünnen (Non-Maximum-Suppression quer zur Kante).
  let keep = mag;
  if (flag('ausduennen')) {
    keep = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const dx = Math.round(Math.cos(dir[i]));
        const dy = Math.round(Math.sin(dir[i]));
        const m = mag[i];
        const a = magAt(mag, cols, rows, x + dx, y + dy);
        const b = magAt(mag, cols, rows, x - dx, y - dy);
        keep[i] = (m >= a && m >= b) ? m : 0;
      }
    }
  }

  // 5) Farben (bei Invertieren vertauscht).
  let edgeCol = colr('farbeKante');
  let bg = colr('farbeBg');
  if (flag('invertieren')) { const t = edgeCol; edgeCol = bg; bg = t; }
  bgCol = bg;

  // 6) Kanten in den Buffer zeichnen.
  const thresh = num('schwellwert');
  const soft = flag('weicheKanten');
  const span = 60;                 // Übergangsbreite für weiche Kanten
  const opacity = num('deckkraft');
  const weight = num('dicke');
  const cw = width / cols;
  const ch = height / rows;

  // Raster für die Kollision (mit den Canvas-Maßen merken).
  edgeGrid = new Uint8Array(cols * rows);
  gCols = cols; gRows = rows; gcw = cw; gch = ch;

  edgeLayer.clear();
  edgeLayer.strokeWeight(weight);
  const e = color(edgeCol);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const m = keep[y * cols + x];
      let intensity;
      if (soft) intensity = constrain((m - thresh) / span, 0, 1);
      else intensity = m > thresh ? 1 : 0;
      if (intensity <= 0) continue;
      edgeGrid[y * cols + x] = 1;
      e.setAlpha(intensity * opacity);
      edgeLayer.stroke(e);
      edgeLayer.point(x * cw + cw / 2, y * ch + ch / 2);
    }
  }
}

// Liegt der Punkt (x,y) auf einer Kante?
function isEdgeAt(x, y) {
  if (!edgeGrid || x < 0 || y < 0 || x >= width || y >= height) return false;
  const c = Math.floor(x / gcw);
  const r = Math.floor(y / gch);
  return edgeGrid[r * gCols + c] === 1;
}

// 3x3-Box-Blur über das Graustufen-Raster.
function boxBlur(src, cols, rows) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = constrain(x + dx, 0, cols - 1);
          const yy = constrain(y + dy, 0, rows - 1);
          sum += src[yy * cols + xx]; n++;
        }
      out[y * cols + x] = sum / n;
    }
  }
  return out;
}

function magAt(mag, cols, rows, x, y) {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return 0;
  return mag[y * cols + x];
}

// --- Einstellungen im Browser merken (localStorage) ---
const STORE_KEY = 'pixelrain-settings';

function saveSettings() {
  const data = {};
  document.querySelectorAll('#panel input:not([type=file])').forEach((el) => {
    data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function loadSettings() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return; }
  for (const id in data) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = data[id];
    else el.value = data[id];
  }
}
