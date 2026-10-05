"use strict";
const ROUNDS = 5;
const $ = id => document.getElementById(id);
const shuffle = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
const strip = s => (s || "").replace(/<[^>]*>/g, "");
const haversine = (a, b, c, d) => { const r = x => x * Math.PI / 180, R = 6371;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)); };

/* ---------- Jahres-Skala (0 bis 2026, überall derselbe Maßstab) ---------- */
const YMAX = 2026;
(function buildScale() {
  const sc = $("scale");
  const add = (y, big) => { const t = document.createElement("div"); t.className = "tick" + (big ? " big" : ""); t.style.left = y / YMAX * 100 + "%"; sc.appendChild(t);
    if (big) { const l = document.createElement("div"); l.className = "tl"; l.style.left = y / YMAX * 100 + "%"; l.textContent = y; sc.appendChild(l); } };
  for (let y = 0; y <= 2000; y += 50) add(y, y % 500 === 0);
})();
const yearSlider = $("year"), yearNum = $("yn");
let curYear = 1900;
function setYear(y) {
  curYear = Math.max(0, Math.min(YMAX, Math.round(y)));
  yearNum.value = curYear; yearSlider.value = curYear;
}
let yearTouched = false;
yearSlider.oninput = () => { yearTouched = true; setYear(+yearSlider.value); };
yearNum.oninput = () => { if (yearNum.value !== "") { yearTouched = true; setYear(+yearNum.value); } };
setYear(1900);
function stepBtn(id, delta) {
  const b = $(id); let t1 = null, t2 = null;
  const go = () => { yearTouched = true; setYear(curYear + delta); };
  const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
  b.addEventListener("pointerdown", e => { e.preventDefault(); go(); t1 = setTimeout(() => { t2 = setInterval(go, 60); }, 400); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, stop));
  b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
}
stepBtn("ym", -1); stepBtn("yp", 1);

/* ---------- Karte (nur Umrisse, keine Ortsnamen) ---------- */
const map = L.map("map", { minZoom: 5, maxBounds: [[44, 2], [58, 19]] });
const fitDE = () => map.fitBounds([[47.2, 5.8], [55.1, 15.1]]);
fitDE();
L.geoJSON(GEO_NB, { interactive: false, style: { color: "#aaa", weight: 1, fillColor: "#dcd8cb", fillOpacity: 1 } }).addTo(map);
L.geoJSON(GEO_DE, { interactive: false, style: { color: "#444", weight: 2, fillColor: "#f7f3e3", fillOpacity: 1 } }).addTo(map);
const panel = $("panel");
const mobile = window.matchMedia("(max-width:700px)");
function setMin(m) {
  panel.classList.toggle("min", m);
  $("ptoggle").textContent = m ? "\u25B2 Karte \u00F6ffnen" : "\u25BC Karte einklappen";
  if (!m) setTimeout(() => { map.invalidateSize(); if (!guess && !done) fitDE(); }, 50);
}
$("ptoggle").onclick = () => setMin(!panel.classList.contains("min"));
setMin(false);
panel.addEventListener("transitionend", e => { if (e.propertyName === "width" || e.propertyName === "height") { map.invalidateSize(); if (!guess && !done) fitDE(); } });
const dot = (ll, color) => L.circleMarker(ll, { radius: 4, weight: 2, color, fillOpacity: .9 }).addTo(map);
map.on("click", e => {
  if (done || !active) return;
  layers.forEach(l => l.remove()); layers = [dot(e.latlng, "#e33")];
  guess = e.latlng; $("submit").disabled = false; $("submit").textContent = "Bestätigen";
});

/* ---------- 360°-Betrachter (WebGL, ein Fragment-Shader rechnet jeden Pixel aus der Blickrichtung) ---------- */
const canvas = $("view");
const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
let prog, tex, loc = {}, view = { yaw: 0, pitch: 0, fov: 78, vy: 0, vp: 0 };
function initGL() {
  const vs = "attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}";
  const fs = `precision highp float;varying vec2 v;uniform sampler2D tex;uniform float yaw,pitch,th,asp;
  const float PI=3.14159265359;
  void main(){
    vec3 d=normalize(vec3(v.x*asp*th,v.y*th,-1.));
    float cp=cos(pitch),sp=sin(pitch);
    d=vec3(d.x,d.y*cp-d.z*sp,d.y*sp+d.z*cp);
    float cy=cos(yaw),sy=sin(yaw);
    d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);
    float lon=atan(d.x,-d.z),lat=asin(clamp(d.y,-1.,1.));
    gl_FragColor=texture2D(tex,vec2(lon/(2.*PI)+.5,.5-lat/PI));
  }`;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  ["yaw", "pitch", "th", "asp"].forEach(n => loc[n] = gl.getUniformLocation(prog, n));
  tex = gl.createTexture();
}
function setTexture(img) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
let hasTex = false;
function draw() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  if (!hasTex) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
  gl.uniform1f(loc.yaw, view.yaw); gl.uniform1f(loc.pitch, view.pitch);
  gl.uniform1f(loc.th, Math.tan(view.fov * Math.PI / 360)); gl.uniform1f(loc.asp, w / h);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function tick() {
  if (Math.abs(view.vy) > 1e-5 || Math.abs(view.vp) > 1e-5) {
    view.yaw += view.vy; view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + view.vp));
    view.vy *= .93; view.vp *= .93;
  }
  draw(); requestAnimationFrame(tick);
}
let dragging = false, lx = 0, ly = 0;
canvas.addEventListener("pointerdown", e => { dragging = true; lx = e.clientX; ly = e.clientY; view.vy = view.vp = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add("drag"); $("hint").style.display = "none"; });
canvas.addEventListener("pointermove", e => {
  if (!dragging) return;
  const k = view.fov * Math.PI / 180 / canvas.clientHeight;      // Bogenmaß pro Pixel
  const dx = (e.clientX - lx) * k, dy = (e.clientY - ly) * k; lx = e.clientX; ly = e.clientY;
  view.yaw += dx; view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + dy)); view.vy = dx; view.vp = dy;
});
const endDrag = () => { dragging = false; canvas.classList.remove("drag"); };
canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("wheel", e => { e.preventDefault(); view.fov = Math.max(35, Math.min(100, view.fov * (e.deltaY > 0 ? 1.07 : .93))); }, { passive: false });
window.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  const s = .07; if (e.key === "ArrowLeft") view.yaw -= s; else if (e.key === "ArrowRight") view.yaw += s;
  else if (e.key === "ArrowUp") view.pitch = Math.min(1.45, view.pitch + s); else if (e.key === "ArrowDown") view.pitch = Math.max(-1.45, view.pitch - s);
});

/* ---------- Spiel ---------- */
let scenes = [], idx = 0, total = 0, guess = null, layers = [], done = false, active = false, history = [];
const tolerance = y => 10 + 0.05 * (2026 - y);             // frühe Jahre werden großzügiger gewertet
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Bild " + src)); i.src = src; });
const cache = {};
const getPano = s => cache[s.id] || (cache[s.id] = loadImg(`panos/szene-${String(s.id).padStart(2, "0")}.jpg`));

async function showRound() {
  const s = scenes[idx]; done = false; guess = null; active = false;
  layers.forEach(l => l.remove()); layers = [];
  panel.classList.remove("big"); setMin(mobile.matches); fitDE(); setTimeout(() => { map.invalidateSize(); fitDE(); }, 250);
  $("result").hidden = $("next").hidden = true; $("submit").hidden = false; $("submit").disabled = true; $("submit").textContent = "Ort auf der Karte wählen";
  $("credit").innerHTML = ""; setYear(1900); yearTouched = false; stopTimer(); $("timer").textContent = fmt(TIME); $("timer").classList.remove("low");
  $("round").textContent = `Runde ${idx + 1}/${scenes.length}`; $("total").textContent = `Punkte: ${total}`;
  {
    $("overlay").hidden = false; $("start").hidden = true; $("msg").hidden = false; $("msg").textContent = "Lade Szene …";
    try { setTexture(await getPano(s)); hasTex = true; } catch (e) { $("msg").textContent = "Bild konnte nicht geladen werden."; console.error(e); return; }
    view.yaw = 0; view.pitch = 0; view.fov = 78; view.vy = view.vp = 0; $("hint").style.display = "";
    $("overlay").hidden = true; $("msg").hidden = true;
    if (idx + 1 < scenes.length) getPano(scenes[idx + 1]).catch(() => {});
  }
  active = true; startTimer();
}

/* ---------- Timer ---------- */
const TIME = 60; let tId = null, tEnd = 0;
const fmt = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
function stopTimer() { if (tId) clearInterval(tId); tId = null; }
function startTimer() {
  stopTimer(); tEnd = Date.now() + TIME * 1000;
  const upd = () => {
    const left = Math.max(0, Math.ceil((tEnd - Date.now()) / 1000));
    $("timer").textContent = fmt(left); $("timer").classList.toggle("low", left <= 10);
    if (left <= 0) { stopTimer(); doSubmit(true); }
  };
  upd(); tId = setInterval(upd, 200);
}

$("submit").onclick = () => doSubmit(false);
function doSubmit(timeUp) {
  if (done || !active || (!guess && !timeUp)) return;
  stopTimer();
  const s = scenes[idx], y = curYear;
  const hasY = !timeUp || yearTouched;
  const km = guess ? haversine(guess.lat, guess.lng, s.lat, s.lon) : null, dy = Math.abs(y - s.jahr);
  const pl = guess ? Math.round(5000 * Math.exp(-km / 300)) : 0, py = hasY ? Math.round(5000 * Math.exp(-dy / tolerance(s.jahr))) : 0;
  total += pl + py; done = true; active = false;
  history.push({ s, pts: pl + py });
  panel.classList.add("big"); setMin(false);
  layers.push(dot([s.lat, s.lon], "#3c3"));
  if (guess) layers.push(L.polyline([guess, [s.lat, s.lon]], { color: "#fff", dashArray: "6", weight: 2 }).addTo(map));
  setTimeout(() => { map.invalidateSize(); if (guess) map.fitBounds(L.latLngBounds([guess, [s.lat, s.lon]]).pad(.5), { maxZoom: 7 }); else map.setView([s.lat, s.lon], 6); }, 230);
  const what = `<div class="w">${s.kurzname} · ${s.epoche}</div><div>${s.ort}</div>`;
  $("result").hidden = false;
  const locTxt = guess ? `Entfernung: <b>${km.toFixed(0)} km</b> (${pl} Pkt.)` : `Kein Ort gewählt (0 Pkt.)`;
  const yrTxt = hasY ? `Richtig: <b>${s.jahr}</b>, du: ${y}, Abweichung ${dy} Jahre (${py} Pkt.)` : `Richtig: <b>${s.jahr}</b>, kein Jahr gewählt (0 Pkt.)`;
  $("result").innerHTML = `${timeUp ? "<div class=\"w\">Zeit abgelaufen!</div>" : ""}${what}${locTxt}<br>${yrTxt}`;
  $("total").textContent = `Punkte: ${total}`;
  $("submit").hidden = true; $("next").hidden = false; $("next").textContent = idx + 1 < scenes.length ? "Weiter" : "Ergebnis";
}
$("next").onclick = () => { if (++idx < scenes.length) showRound(); else finish(); };

function finish() {
  stopTimer();
  $("overlay").hidden = false; $("msg").hidden = true; $("start").hidden = true;
  let end = $("end"); if (!end) { end = document.createElement("div"); end.id = "end"; $("overlay").appendChild(end); }
  end.hidden = false;
  end.innerHTML = `<h2>Fertig!</h2><p>Gesamtpunktzahl: <b>${total}</b> / ${scenes.length * 10000}</p><table id="rounds">` +
    history.map(h => `<tr><td>${h.s.kurzname}</td><td>${h.s.jahr}</td><td>${h.pts}</td></tr>`).join("") +
    `</table><button id="again" type="button">Nochmal spielen</button>`;
  $("again").onclick = () => location.reload();
}

/* ---------- Start ---------- */
function pickPanos() {
  let seen = []; try { seen = JSON.parse(localStorage.getItem("wwd_seen") || "[]"); } catch (e) {}
  let fresh = SCENES.filter(s => !seen.includes(s.id));
  if (fresh.length < ROUNDS) { seen = []; fresh = SCENES.slice(); }
  const pick = shuffle(fresh).slice(0, ROUNDS);
  try { localStorage.setItem("wwd_seen", JSON.stringify(seen.concat(pick.map(s => s.id)))); } catch (e) {}
  return pick;
}
function startGame() {
  startMusic();
  $("start").hidden = true; $("msg").hidden = false; $("msg").textContent = "Lade Szenen …";
  scenes = pickPanos(); idx = 0; total = 0; history = [];
  showRound();
}
$("goPano").onclick = startGame;

/* ---------- Hintergrundmusik ---------- */
const TRACKS = ["music/waltz.mp3"];
let trackIdx = 0, musicOn = true, musicStarted = false;
const bgm = new Audio(TRACKS[0]);
bgm.volume = 0.10; bgm.loop = TRACKS.length === 1;
bgm.onended = () => { trackIdx = (trackIdx + 1) % TRACKS.length; bgm.src = TRACKS[trackIdx]; bgm.play().catch(() => {}); };
function startMusic() { if (!musicOn || musicStarted) return; bgm.play().then(() => { musicStarted = true; }).catch(() => {}); }
$("vol").oninput = () => { bgm.volume = $("vol").value / 100; };
$("mbtn").onclick = () => {
  musicOn = !musicOn; $("mbtn").textContent = musicOn ? "♪" : "🔇";
  if (musicOn) { musicStarted = false; startMusic(); } else { bgm.pause(); musicStarted = false; }
};

try { initGL(); requestAnimationFrame(tick); } catch (e) { $("start").insertAdjacentHTML("beforeend", "<p>WebGL wird von deinem Browser nicht unterstützt.</p>"); console.error(e); }
