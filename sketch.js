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

// Fließen: Agenten wandern an den Kanten entlang nach unten und hinterlassen
// Spuren in einem eigenen transparenten Buffer, der jeden Frame leicht ausblendet.
let flowLayer;        // persistenter, transparenter Buffer für die Fließ-Spuren
let flowAgents = [];  // Agenten in Canvas-Pixeln
let edgeCells = [];   // Grid-Indizes aller Kantenzellen (Spawn-Punkte)
let fadeDebt = 0;     // angesammelter Spur-Abtrag (für sehr lange Spuren, s. updateFlow)

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
  flowLayer = createGraphics(w, h);

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
      flowLayer = createGraphics(w, h);
      flowAgents.length = 0;
      buildEdges();
    });
  });
}

function draw() {
  background(bgCol);
  image(edgeLayer, 0, 0);
  updateFlow();              // fadet die Spuren und zeichnet die Agenten in flowLayer
  image(flowLayer, 0, 0);
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

// --- Fließen ---
// Agenten spawnen auf Kantenzellen und wandern mit Abwärts-Drang an den Konturen
// entlang ("angedockt") oder fallen frei ("fallend"). Kontur-Treue mischt beides:
// 1 = klebt an jeder Kante, 0 = Kanten sind nur Startpunkte, alles fällt gerade runter.
// Gezeichnet wird nur das Bewegungs-Segment des aktuellen Frames in flowLayer;
// die Spur entsteht durch die Persistenz des Buffers, der pro Frame leicht ausblendet.

function newFlowAgent(randomAge) {
  const i = edgeCells[(Math.random() * edgeCells.length) | 0];
  const x = (i % gCols + 0.5) * gcw + random(-0.4, 0.4) * gcw;
  const y = (Math.floor(i / gCols) + 0.5) * gch;
  const maxLife = num('lebensdauer') * random(0.7, 1.3);  // ±30%, sonst sterben alle im Takt
  return { x, y, px: x, py: y,
           vx: 0, vy: 0.5,                 // Startbewegung leicht abwärts
           r: random(),                    // persönliche Tempo-Variation
           dir: random() < 0.5 ? -1 : 1,   // bevorzugte Seite (verhindert Ping-Pong)
           falling: false, tx: x, ty: y,
           life: randomAge ? random(maxLife) : maxLife, maxLife };
}

function respawnFlowAgent(a) {
  Object.assign(a, newFlowAgent(false));   // setzt auch px/py → keine Teleport-Linie
}

function updateFlow() {
  // 1) Spur ausblenden — immer, auch ohne Agenten, damit Reste verschwinden.
  //    Spurlänge = Halbwertszeit in Frames. Ein zu schwacher Pro-Frame-Fade verpufft
  //    im 8-bit-Alpha wirkungslos (Rundung → Geisterspuren). Deshalb sammelt sich der
  //    gewünschte Abtrag als "Schuld" an und wird erst angewendet, wenn er stark genug
  //    ist (≥12), um sicher zu wirken — so gehen auch sehr lange Spuren ohne Reste.
  //    erase() braucht BEIDE Argumente, sonst radiert der Default-Stroke einen Rahmen.
  fadeDebt += 255 * (1 - Math.pow(0.5, 1 / num('spurLaenge')));
  if (fadeDebt >= 12) {
    const s = Math.min(90, Math.round(fadeDebt));
    flowLayer.erase(s, s);
    flowLayer.rect(0, 0, width, height);
    flowLayer.noErase();
    fadeDebt -= s;
  }

  const target = Math.round(num('flussMenge'));
  if (target === 0 || !edgeCells.length) { flowAgents.length = 0; return; }

  // Beim Auffüllen mit zufälligem Alter starten, sonst sterben alle gleichzeitig (Pulsieren).
  while (flowAgents.length < target) flowAgents.push(newFlowAgent(true));
  if (flowAgents.length > target) flowAgents.length = target;

  const tempo = num('flussTempo');
  const treue = num('konturTreue');
  const wirbel = num('flussWirbel');
  const steer = 1 - num('traegheit');   // wie schnell die Richtung umlenkt (klein = weite Bögen)
  const windA = radians(num('flussWind'));
  const windX = Math.sin(windA), windY = Math.cos(windA);   // Fallrichtung freier Teilchen
  const baseA = num('flussDeckkraft');
  const c = color(colr('farbeFluss'));
  c.setAlpha(baseA);
  flowLayer.stroke(c);
  flowLayer.strokeWeight(num('flussDicke'));

  for (const a of flowAgents) {
    const speed = tempo * (0.7 + 0.6 * a.r);
    a.px = a.x; a.py = a.y;
    stepFlowAgent(a, speed, treue, wirbel, steer, windX, windY);
    a.life--;
    if (a.life <= 0 || a.y >= height || a.x < -20 || a.x > width + 20) {
      respawnFlowAgent(a);   // Lebensende, unten raus oder per Wind seitlich raus
      continue;
    }
    const lifeFrac = a.life / a.maxLife;
    if (lifeFrac < 0.25) {
      // Sanft ausfaden auf den letzten 25% der Lebensdauer (wie versickerndes Wasser).
      c.setAlpha(baseA * lifeFrac * 4);
      flowLayer.stroke(c);
      flowLayer.line(a.px, a.py, a.x, a.y);
      c.setAlpha(baseA);
      flowLayer.stroke(c);
    } else {
      flowLayer.line(a.px, a.py, a.x, a.y);
    }
  }
}

function stepFlowAgent(a, speed, treue, wirbel, steer, windX, windY) {
  // 1) Wunschrichtung bestimmen.
  let wx, wy, sp = speed;
  if (a.falling) {
    wx = windX + random(-1, 1) * wirbel * 0.4;   // Wind treibt freie Teilchen
    wy = windY;
    sp = speed * 1.4;   // Tropfen fallen etwas schneller als sie kriechen
    if (isEdgeAt(a.x, a.y) && random() < treue) {   // an Kante darunter andocken
      a.falling = false;
      const cc = Math.floor(a.x / gcw), rr = Math.floor(a.y / gch);
      a.tx = (cc + 0.5) * gcw; a.ty = (rr + 0.5) * gch;
    }
  } else {
    // Nahe genug am Ziel → nächste Zelle wählen. Großzügiger Radius statt Snappen,
    // sonst kreisen träge Agenten um ihr Ziel bzw. brechen die Bögen ab.
    if (Math.hypot(a.tx - a.x, a.ty - a.y) < Math.max(speed * 1.2, gcw * 0.7)) {
      chooseNextFlowCell(a, treue);
    }
    wx = (a.tx - a.x) + random(-0.5, 0.5) * wirbel * 0.3;
    wy = a.ty - a.y;
  }

  // 2) Geschwindigkeit nur begrenzt schnell umlenken (Trägheit → Bögen),
  //    danach aufs Tempo normieren: reines Richtungs-Drehen, konstante Geschwindigkeit.
  const wm = Math.hypot(wx, wy) || 1;
  a.vx += ((wx / wm) * sp - a.vx) * steer;
  a.vy += ((wy / wm) * sp - a.vy) * steer;
  const vm = Math.hypot(a.vx, a.vy) || 1;
  a.vx = (a.vx / vm) * sp;
  a.vy = (a.vy / vm) * sp;
  a.x += a.vx;
  a.y += a.vy;
}

function chooseNextFlowCell(a, treue) {
  if (random() > treue) { a.falling = true; return; }   // absichtlich abtropfen
  const c = Math.floor(a.x / gcw), r = Math.floor(a.y / gch);
  // Kandidaten in Priorität: direkt unten, diagonal unten (bevorzugte Seite zuerst),
  // seitwärts nur mit gedrosselter Wahrscheinlichkeit (rückwärts noch seltener).
  const cand = [
    [c,         r + 1, 1],
    [c + a.dir, r + 1, 1], [c - a.dir, r + 1, 0.9],
    [c + a.dir, r,     treue], [c - a.dir, r, treue * 0.3],
  ];
  for (const [cc, rr, p] of cand) {
    if (cc < 0 || cc >= gCols || rr < 0 || rr >= gRows) continue;
    if (edgeGrid[rr * gCols + cc] && random() < p) {
      if (cc !== c) a.dir = Math.sign(cc - c);
      a.tx = (cc + 0.5) * gcw; a.ty = (rr + 0.5) * gch;
      return;
    }
  }
  a.falling = true;   // keine Kante in der Nachbarschaft → frei fallen
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
  flowLayer = createGraphics(w, h);
  flowAgents.length = 0;   // Positionen wären bei neuer Größe ungültig
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

  // 2) Weichzeichnen — stufenlos: ganze Durchgänge + anteiliger letzter (Überblendung).
  const blur = num('weichzeichnung');
  const blurFull = Math.floor(blur), blurFrac = blur - blurFull;
  for (let p = 0; p < blurFull; p++) gray = boxBlur(gray, cols, rows);
  if (blurFrac > 0) {
    const extra = boxBlur(gray, cols, rows);
    for (let i = 0; i < gray.length; i++) gray[i] = gray[i] * (1 - blurFrac) + extra[i] * blurFrac;
  }

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

  // 6) Kanten-Maske + Intensität berechnen.
  let on = new Uint8Array(cols * rows);
  const inten = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const m = keep[i];
    const intensity = soft ? constrain((m - thresh) / span, 0, 1) : (m > thresh ? 1 : 0);
    if (intensity > 0) { on[i] = 1; inten[i] = intensity; }
  }

  // 7) Verdünnen: dicke Bänder von außen abtragen, dünne Linien bleiben erhalten
  //    (geschützte Erosion). Stufenlos: ganze Schichten + eine anteilige letzte Schicht.
  const verd = num('verduennen');
  const verdFull = Math.floor(verd), verdFrac = verd - verdFull;
  for (let p = 0; p < verdFull; p++) on = erodeProtected(on, cols, rows, 1);
  if (verdFrac > 0) on = erodeProtected(on, cols, rows, verdFrac);

  // 8) In Buffer zeichnen + Kollisions-Raster füllen.
  edgeGrid = new Uint8Array(cols * rows);
  gCols = cols; gRows = rows; gcw = cw; gch = ch;
  edgeCells = [];   // Spawn-Punkte für die Fließ-Agenten
  if (flowLayer) flowLayer.clear();   // alte Spuren passen nicht mehr zur neuen Geometrie

  edgeLayer.clear();
  edgeLayer.strokeWeight(weight);
  const e = color(edgeCol);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!on[i]) continue;
      edgeGrid[i] = 1;
      edgeCells.push(i);
      e.setAlpha(inten[i] * opacity);
      edgeLayer.stroke(e);
      edgeLayer.point(x * cw + cw / 2, y * ch + ch / 2);
    }
  }
}

// Eine Erosions-Runde: entfernt Rand-Pixel dicker Bänder, schützt aber dünne Linien.
// Ein Pixel wird nur abgetragen, wenn es am Rand liegt UND genug Kanten-Nachbarn hat
// (dünne 1-2px-Linien haben wenige Nachbarn und bleiben deshalb erhalten).
// fraction < 1 trägt nur einen Teil der Rand-Pixel ab (per Bayer-Dither, deterministisch)
// → stufenloser Übergang zwischen zwei ganzen Schichten.
const ERODE_PROTECT = 4;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function erodeProtected(on, cols, rows, fraction) {
  const out = on.slice();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!on[i]) continue;
      let cnt = 0, boundary = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx, yy = y + dy;
          const isOn = xx >= 0 && yy >= 0 && xx < cols && yy < rows && on[yy * cols + xx];
          if (isOn) cnt++; else boundary = true;
        }
      }
      if (!boundary || cnt < ERODE_PROTECT) continue;
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;  // Schwelle 0..1
      if (fraction >= 1 || t < fraction) out[i] = 0;
    }
  }
  return out;
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
