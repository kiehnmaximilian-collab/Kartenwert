import { detectCard, detectInFrame, refine, crop, warp, rotate180, whitening, centering, sharpness, forOcr, warpRegion, stretchGray, cropCard, makeImage } from "./vision.js";
import { parseSetCode, languageOf, lookupFuzzy, cardmarketLinks, parsePasscode, lookupById, bestPrinting, localCode } from "./cards.js";
import { grade, QUESTIONS } from "./grade.js";
import * as db from "./store.js";

const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = v => (v == null || v === "" || isNaN(v)) ? "–" : Number(v).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const COND = { MT: "Mint", NM: "Near Mint", EX: "Excellent", GD: "Good", LP: "Light Played", PL: "Played", PO: "Poor" };
const LANGS = { DE: "Deutsch", EN: "Englisch", FR: "Französisch", IT: "Italienisch", ES: "Spanisch", PT: "Portugiesisch", JP: "Japanisch", KO: "Koreanisch" };
const WARP_W = 1000;
const SHARP_MIN = 15;   // variance of the Laplacian below this = blurry

document.getElementById("home").onclick = () => home();

// ---------- images ----------
async function fileToImage(file, max = 2400) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function toCanvas(img, canvas = document.createElement("canvas")) {
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext("2d").putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return canvas;
}

function thumb(img, w = 220) {
  const c = toCanvas(img), t = document.createElement("canvas");
  t.width = w; t.height = Math.round(img.height * w / img.width);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.8);
}

// ---------- home ----------
async function home() {
  document.getElementById("home").hidden = true;
  document.getElementById("title").textContent = "Kartenwert";
  const list = await db.all().catch(() => []);
  app.innerHTML = `
    <div class="box">
      <h2>Karte bewerten</h2>
      <p class="sub">Fotografiere Vorder- und Rückseite. Die App misst Kanten, Ecken und Zentrierung, liest den Set-Code und stellt dir ein paar Fragen. Alles passiert auf deinem Handy, ohne Konto und ohne Kosten.</p>
      <details><summary>So werden die Fotos gut</summary><ul class="tips sub">
        <li>Karte ohne Hülle auf einen <b>dunklen, einfarbigen</b> Untergrund legen (z.B. schwarzes Tuch).</li>
        <li>Gerade von oben, die Karte soll gut die Hälfte des Bildes füllen.</li>
        <li>Helles, gleichmäßiges Licht ohne Spiegelung auf der Karte.</li>
        <li>Scharf stellen: kurz auf die Karte tippen, bevor du auslöst.</li>
      </ul></details>
      <button class="wide" id="new">Neue Karte bewerten</button>
    </div>
    <div class="box">
      <h2>Verlauf</h2>
      ${list.length ? list.map(r => `
        <div class="hist" data-id="${esc(r.id)}">
          <img src="${esc(r.thumbFront || "")}" alt="">
          <div class="t"><b>${esc(r.name || "Unbekannte Karte")}</b>
            <span class="sub"><span class="tag">${esc(r.condition)}</span>${esc(r.setCode || "")} · ${esc(new Date(r.time).toLocaleDateString("de-DE"))}</span></div>
          <div class="price">${eur(r.price)}</div>
        </div>`).join("") : `<p class="sub">Noch keine Karten bewertet.</p>`}
    </div>`;
  app.querySelector("#new").onclick = () => capture("front", {});
  app.querySelectorAll(".hist").forEach(el => el.onclick = async () => detail(await db.get(el.dataset.id)));
}

// ---------- capture + corner adjustment ----------
function capture(side, job) {
  const name = side === "front" ? "Vorderseite" : "Rückseite";
  document.getElementById("home").hidden = false;
  document.getElementById("title").textContent = name;
  app.innerHTML = `
    <div class="box" id="pick">
      <h2>${side === "front" ? "1" : "2"}. ${name} fotografieren</h2>
      <p class="sub">${side === "back" ? "Die Rückseite ist wichtig: Weiße Stellen an den braunen Kanten zeigen, wie viel die Karte gespielt wurde." : "Lege die Karte so in den Rahmen, dass der Set-Code unter dem Bild scharf ist."}</p>
      <label class="btn wide"><input type="file" accept="image/*" capture="environment" hidden id="file">Foto mit der Kamera-App</label>
      <p class="sub">Die Kamera-App deines Handys stellt am besten scharf. Danach markierst du die Karte im Foto.</p>
      <button class="sec wide" id="cam">Kamera mit Rahmen</button>
      <label class="btn sec wide"><input type="file" accept="image/*" hidden id="file2">Foto aus der Galerie</label>
    </div>
    <div class="box" id="adjust" hidden>
      <p class="sub" id="detmsg"></p>
      <div class="stage" id="stage"><canvas id="cv"></canvas></div>
      <button class="wide" id="ok">Passt, weiter</button>
      <button class="sec wide" id="again">Neu aufnehmen</button>
    </div>`;
  const next = (img, quad, found, sharp = Infinity) => {
    app.querySelector("#pick").hidden = true;
    app.querySelector("#adjust").hidden = false;
    app.querySelector("#detmsg").innerHTML = (sharp < SHARP_MIN
      ? `<b class="warn">Das Foto ist unscharf.</b> Tippe besser auf „Neu aufnehmen“: Handy etwas weiter weg (ca. 20 cm), vor dem Auslösen auf die Karte tippen, mehr Licht.<br>` : "") + (found
      ? "Karte erkannt. Liegt ein blauer Punkt nicht genau auf einer Kartenecke, zieh ihn mit dem Finger hin."
      : `<span class="warn">Den Kartenrand konnte ich nicht sicher finden.</span> Zieh die vier blauen Punkte genau auf die Kartenecken.`);
    editor(img, quad, q => { job[side] = { img, quad: q }; side === "front" ? capture("back", job) : analyze(job); });
    app.querySelector("#again").onclick = () => capture(side, job);
  };
  app.querySelector("#cam").onclick = () => camera(name).then(r => {
    if (!r) return;
    // keep only the area around the frame: easier to check, less to compute
    const [x0, y0, x1, y1] = r.rect, mx = (x1 - x0) * 0.35, my = (y1 - y0) * 0.25;
    const cx = Math.max(0, x0 - mx), cy = Math.max(0, y0 - my);
    const img = crop(r.img, cx, cy, x1 + mx, y1 + my);
    const res = detectInFrame(img, [x0 - cx, y0 - cy, x1 - cx, y1 - cy]);
    next(img, res.quad, res.found, sharpness(warp(img, res.quad, 500)));
  }).catch(e => {
    app.querySelector("#pick").insertAdjacentHTML("beforeend", `<p class="err">Kamera nicht verfügbar (${esc(e.message || e)}). Erlaube den Kamerazugriff oder nimm ein Foto aus der Galerie.</p>`);
  });
  const fromFile = async e => {
    const f = e.target.files[0];
    if (!f) return;
    app.querySelector("#pick").insertAdjacentHTML("beforeend", `<p class="progress" id="busy"><span class="spinner"></span>Suche die Karte im Foto…</p>`);
    await new Promise(r => setTimeout(r, 30));
    const img = await fileToImage(f, 3000);
    let quad = detectCard(img);
    if (quad) quad = refine(img, quad);
    const found = !!quad;
    if (!quad) {
      // card-shaped outline in the middle; usually only small drags needed
      const w = img.width, h = img.height;
      let ch = h * 0.6, cw = ch * 59 / 86;
      if (cw > w * 0.8) { cw = w * 0.8; ch = cw * 86 / 59; }
      const x0 = (w - cw) / 2, y0 = (h - ch) / 2;
      quad = [[x0, y0], [x0 + cw, y0], [x0 + cw, y0 + ch], [x0, y0 + ch]];
    }
    next(img, quad, found, found ? sharpness(warp(img, quad, 500)) : Infinity);
  };
  app.querySelector("#file").onchange = fromFile;
  app.querySelector("#file2").onchange = fromFile;
}

// Full-screen live camera with a card-shaped frame. Resolves {img, rect}
// (photo + frame position in photo pixels) or null when cancelled.
async function camera(name) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  const track = stream.getVideoTracks()[0];
  const caps = (track.getCapabilities && track.getCapabilities()) || {};
  const apply = c => track.applyConstraints({ advanced: [c] }).catch(() => {});
  if ((caps.focusMode || []).includes("continuous")) apply({ focusMode: "continuous" });
  const ov = document.createElement("div");
  ov.className = "cam";
  ov.innerHTML = `<video playsinline muted autoplay></video><div class="frame"><i></i><i></i><i></i><i></i></div>
    <p class="hint">${esc(name)}: Karte in den Rahmen, Handy ca. 20 cm über der Karte. Tippe auf die Karte zum Scharfstellen.</p>
    <div class="bar"><button class="sec" data-a="x">Abbrechen</button><button class="shutter" data-a="shot" aria-label="Foto aufnehmen"></button>
      ${caps.torch ? `<button class="sec" data-a="torch">Licht</button>` : "<span></span>"}</div>`;
  document.body.appendChild(ov);
  const video = ov.querySelector("video"), frame = ov.querySelector(".frame");
  video.srcObject = stream;
  await video.play().catch(() => {});
  const layout = () => {
    // Not too big: a phone held very close to the card can't focus.
    const W = ov.clientWidth, H = ov.clientHeight - 150;
    let fh = H * 0.62, fw = fh * 59 / 86;
    if (fw > W * 0.62) { fw = W * 0.62; fh = fw * 86 / 59; }
    Object.assign(frame.style, { width: fw + "px", height: fh + "px", left: (W - fw) / 2 + "px", top: 60 + (H - 60 - fh) / 2 + "px" });
  };
  layout();
  addEventListener("resize", layout);
  let torch = false, busy = false;
  const result = await new Promise(res => {
    ov.onclick = async e => {
      const a = e.target.dataset.a;
      if (a === "x") return res(null);
      if (a === "torch") { torch = !torch; return apply({ torch }); }
      if (a !== "shot") {
        // tap to focus where the user tapped
        const r = video.getBoundingClientRect();
        if ((caps.focusMode || []).includes("single-shot")) {
          await apply({ pointsOfInterest: [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }], focusMode: "single-shot" });
          setTimeout(() => (caps.focusMode || []).includes("continuous") && apply({ focusMode: "continuous" }), 1500);
        }
        return;
      }
      if (busy || !video.videoWidth) return;
      busy = true;
      ov.querySelector(".shutter").style.opacity = ".4";
      const vw = video.videoWidth, vh = video.videoHeight;
      // frame position as a share of the video picture (shown with object-fit: cover)
      const r = video.getBoundingClientRect(), f = frame.getBoundingClientRect();
      const s = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * s) / 2, oy = (r.height - vh * s) / 2;
      const toV = (x, y) => [(x - r.left - ox) / s, (y - r.top - oy) / s];
      const [x0, y0] = toV(f.left, f.top), [x1, y1] = toV(f.right, f.bottom);
      // Full-resolution photo with the camera's own focus, where the browser offers it.
      try {
        if (window.ImageCapture) {
          const blob = await new ImageCapture(track).takePhoto();
          const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
          const pw = bmp.width, ph = bmp.height;
          if ((pw > ph) === (vw > vh)) {
            // the preview is usually a centred cut-out of the photo
            const k = Math.min(pw / vw, ph / vh), dx = (pw - vw * k) / 2, dy = (ph - vh * k) / 2;
            const sc = Math.min(1, 4000 / Math.max(pw, ph));
            const c = document.createElement("canvas"); c.width = Math.round(pw * sc); c.height = Math.round(ph * sc);
            c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
            const m = v => v * sc;
            return res({ img: c.getContext("2d").getImageData(0, 0, c.width, c.height),
                         rect: [m(x0 * k + dx), m(y0 * k + dy), m(x1 * k + dx), m(y1 * k + dy)] });
          }
        }
      } catch { /* fall back to the preview picture */ }
      const c = document.createElement("canvas"); c.width = vw; c.height = vh;
      c.getContext("2d").drawImage(video, 0, 0);
      res({ img: c.getContext("2d").getImageData(0, 0, vw, vh), rect: [x0, y0, x1, y1] });
    };
  });
  removeEventListener("resize", layout);
  stream.getTracks().forEach(t => t.stop());
  ov.remove();
  return result;
}

function editor(img, quad, done) {
  const stage = app.querySelector("#stage"), cv = app.querySelector("#cv");
  toCanvas(img, cv);
  const ctx = cv.getContext("2d"), base = ctx.getImageData(0, 0, cv.width, cv.height);
  stage.querySelectorAll(".handle").forEach(h => h.remove());
  const handles = quad.map(() => { const h = document.createElement("div"); h.className = "handle"; stage.appendChild(h); return h; });
  const draw = () => {
    ctx.putImageData(base, 0, 0);
    ctx.strokeStyle = "#4f7bff"; ctx.lineWidth = Math.max(3, img.width / 250);
    ctx.beginPath(); quad.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
    const s = cv.clientWidth / img.width;
    quad.forEach((p, i) => { handles[i].style.left = p[0] * s + "px"; handles[i].style.top = p[1] * s + "px"; });
  };
  let drag = -1;
  const pos = e => { const r = cv.getBoundingClientRect(), s = img.width / r.width; return [(e.clientX - r.left) * s, (e.clientY - r.top) * s]; };
  stage.onpointerdown = e => {
    const p = pos(e), s = img.width / cv.clientWidth;
    let best = -1, bd = 40 * s;
    quad.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { drag = best; stage.setPointerCapture(e.pointerId); }
  };
  stage.onpointermove = e => {
    if (drag < 0) return;
    const p = pos(e);
    quad[drag] = [Math.min(img.width, Math.max(0, p[0])), Math.min(img.height, Math.max(0, p[1]))];
    draw();
  };
  stage.onpointerup = stage.onpointercancel = () => { drag = -1; };
  new ResizeObserver(draw).observe(cv);
  draw();
  app.querySelector("#ok").onclick = () => done(quad);
}

// ---------- analysis ----------
let worker = null;
async function ocrWorker() {
  if (worker) return worker;
  await new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script"); s.src = "vendor/tesseract.min.js"; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  const here = new URL(".", location.href).href;
  worker = await window.Tesseract.createWorker("eng", 1, {
    workerPath: here + "vendor/worker.min.js", corePath: here + "vendor/", langPath: here + "vendor/",
    workerBlobURL: false,
  });
  await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-", tessedit_pageseg_mode: "7" });
  return worker;
}

// Reads the set code (right under the artwork) and the 8-digit passcode
// (bottom left) straight from the original photo in high resolution.
// Tries the card upside down too.
async function readCode(src, quad) {
  const w = await ocrWorker();
  const out = { code: "", flipped: false, passcode: "", texts: [] };
  const run = async (q, region, bias) => {
    let img;
    if (bias === null) {      // the plain way: small straightened card, enlarged grey crop
      const [u0, v0, u1, v1] = region;
      img = stretchGray(cropCard(warp(src, q, WARP_W), u0, v0, u1, v1));
    } else img = forOcr(warpRegion(src, q, ...region), 48, bias);
    return img ? (await w.recognize(toCanvas(img))).data.text : "";
  };
  for (const [q, flipped] of [[quad, false], [[quad[2], quad[3], quad[0], quad[1]], true]]) {
    await w.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: "7" });
    for (const bias of [0.3, 0.15, 0.45]) {
      const pc = parsePasscode(await run(q, [0.02, 0.95, 0.4, 1.0], bias));
      if (pc) { out.passcode = pc; break; }
    }
    await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-", tessedit_pageseg_mode: "7" });
    for (const [region, biases] of [[[0.5, 0.69, 0.97, 0.79], [0, 0.15]], [[0.55, 0.705, 0.97, 0.755], [0, 0.15]], [[0.55, 0.712, 0.96, 0.772], [null]]]) {
      for (const bias of biases) {
        const text = await run(q, region, bias);
        out.texts.push(text);
      }
    }
    // the code read most often wins
    const votes = {};
    for (const t of out.texts) { const c = parseSetCode(t); if (c) votes[c] = (votes[c] || 0) + 1; }
    out.codes = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);
    out.code = out.codes[0] || "";
    if (out.passcode || out.code) {
      out.flipped = flipped;
      // "1. Auflage" / "1st Edition" left under the artwork
      await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789. " });
      const ed = await run(q, [0.03, 0.69, 0.5, 0.79], 0.15).catch(() => "");
      out.firstEd = /auf|lage|edit|1st/i.test(ed);
      return out;
    }
    out.texts = [];
  }
  return out;
}

async function analyze(job) {
  document.getElementById("title").textContent = "Auswertung";
  app.innerHTML = `<div class="box"><div class="progress"><span class="spinner"></span><span id="step">Richte die Karte aus…</span></div></div>`;
  const step = t => { app.querySelector("#step").textContent = t; return new Promise(r => setTimeout(r, 30)); };
  await step("Richte die Karte aus…");
  let front = warp(job.front.img, job.front.quad, WARP_W);
  let back = warp(job.back.img, job.back.quad, WARP_W);
  await step("Messe Kanten und Ecken der Rückseite…");
  const wh = whitening(back);
  const warnings = [];
  if (wh.brightBorder) warnings.push("Der Rand der Rückseite wirkt sehr hell. War es wirklich die Rückseite, oder spiegelt das Licht?");
  if (sharpness(back) < 25) warnings.push("Das Foto der Rückseite ist etwas unscharf. Weiße Stellen werden dann schlechter erkannt.");
  await step("Lese den Set-Code (beim ersten Mal lädt die Texterkennung kurz)…");
  let ocr = { code: "", flipped: false, passcode: "", texts: [] };
  try { ocr = await readCode(job.front.img, job.front.quad); } catch (e) { warnings.push("Texterkennung nicht verfügbar: " + e.message); }
  if (ocr.flipped) front = rotate180(front);
  const cen = centering(front);
  const card = { setCode: ocr.code, language: languageOf(ocr.code) || "DE", firstEd: !!ocr.firstEd, name: "", setName: "", rarity: "", rarities: [], options: [] };
  let done = false;
  if (ocr.passcode) {
    await step("Suche die Karte in der Kartendatenbank…");
    const info = await lookupById(ocr.passcode).catch(() => null);
    if (info) {
      Object.assign(card, { name: info.name, image: info.image });
      const bp = bestPrinting(info.sets, ocr.texts);
      const codes = [...new Set(info.sets.map(s => s.code))];
      const region = bp && bp.region ? bp.region : "DE";
      card.options = codes.map(c => localCode(c, region));
      const set = bp ? bp.set : codes.length === 1 ? info.sets[0] : null;
      if (set) {
        Object.assign(card, { setCode: localCode(set.code, region), setName: set.setName,
          rarities: [...new Set(info.sets.filter(s => s.code === set.code).map(s => s.rarity))] });
        card.rarity = card.rarities[0] || "";
        card.language = languageOf(card.setCode) || "DE";
        done = true;
      } else {
        card.setCode = "";
        warnings.push(`Karte erkannt: ${info.name}. Den Set-Code konnte ich nicht sicher lesen. Bitte wähle ihn unten aus (er steht rechts unter dem Bild).`);
        done = true;
      }
    }
  }
  if (!done && ocr.code) {
    await step("Suche die Karte in der Kartendatenbank…");
    let hit = null;
    for (const c of (ocr.codes || [ocr.code]).slice(0, 3)) {
      hit = await lookupFuzzy(c).catch(() => null);
      if (hit) { if (hit.code !== c || (ocr.codes || []).length > 1) warnings.push(`Gelesen wurde ${c}, gemeint ist wohl ${hit.code}. Bitte kurz auf der Karte prüfen.`); break; }
    }
    const info = hit && hit.info;
    if (info) Object.assign(card, { setCode: hit.code, name: info.name, setName: info.setName, rarities: info.rarities, rarity: info.rarities[0] || "", image: info.image });
    else warnings.push("Die Kartendatenbank war nicht erreichbar oder kennt den Code nicht. Trag Name und Set unten selbst ein.");
  } else if (!done) warnings.push("Den Set-Code konnte ich nicht lesen. Bitte unten eintragen, er steht rechts unter dem Bild.");
  result({ front, back, whitening: wh, centering: cen, card, answers: {}, warnings, time: Date.now() });
}

function markSpots(back, wh) {
  const c = toCanvas(back), ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(255,40,40,.9)";
  for (let i = 0; i < wh.spots.length; i += 2) ctx.fillRect(wh.spots[i] - 1, wh.spots[i + 1] - 1, 3, 3);
  return c;
}

// ---------- result ----------
function sel(name, map, val, extra = "") {
  return `<select name="${name}" ${extra}>${Object.entries(map).map(([k, v]) => `<option value="${esc(k)}"${k === val ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
}

function result(r) {
  document.getElementById("title").textContent = "Ergebnis";
  const c = r.card;
  const rarityField = c.rarities.length > 1
    ? sel("rarity", Object.fromEntries(c.rarities.map(x => [x, x])), c.rarity)
    : `<input type="text" name="rarity" value="${esc(c.rarity)}">`;
  app.innerHTML = `
    ${r.warnings.map(w => `<p class="warn">${esc(w)}</p>`).join("")}
    <div class="box">
      <div class="pair"><canvas id="cf"></canvas><canvas id="cb"></canvas></div>
      <p class="sub">Rot markiert: weiße Stellen an Kanten und Ecken der Rückseite.${r.centering.sure ? ` Zentrierung links/rechts: ${esc(r.centering.ratio)}.` : ""}</p>
    </div>
    <div class="box">
      <h2>Karte</h2>
      <form id="card">
        <div class="row"><div><label class="f">Set-Code</label><input type="text" name="setCode" value="${esc(c.setCode)}" autocapitalize="characters" placeholder="z.B. PSV-DE092" list="codes"><datalist id="codes">${(c.options || []).map(o => `<option value="${esc(o)}">`).join("")}</datalist></div>
          <div style="flex:0 0 auto"><button type="button" class="sec small" id="look">Suchen</button></div></div>
        <label class="f">Name (englisch, wie auf Cardmarket)</label><input type="text" name="name" value="${esc(c.name)}">
        <label class="f">Set</label><input type="text" name="setName" value="${esc(c.setName)}">
        <label class="f">Seltenheit</label>${rarityField}
        <div class="row"><div><label class="f">Sprache</label>${sel("language", LANGS, c.language)}</div>
          <div><label class="f">Edition</label>${sel("firstEd", { "": "Unlimited", "1": "1. Auflage / 1st Edition" }, c.firstEd ? "1" : "")}</div></div>
      </form>
    </div>
    <div class="box">
      <h2>Noch ein paar Fragen</h2>
      <form id="qs">${QUESTIONS.map(q => `<div class="q"><p>${esc(q.text)}</p><div class="opts">${q.options.map(([v, t]) =>
        `<label><input type="radio" name="${q.id}" value="${v}"${(r.answers[q.id] || q.options[0][0]) === v ? " checked" : ""}><span>${esc(t)}</span></label>`).join("")}</div></div>`).join("")}</form>
    </div>
    <div class="box" id="res"></div>`;
  toCanvas(r.front, app.querySelector("#cf"));
  const cb = app.querySelector("#cb"), marked = markSpots(r.back, r.whitening);
  cb.width = marked.width; cb.height = marked.height; cb.getContext("2d").drawImage(marked, 0, 0);

  const readForms = () => {
    const f = Object.fromEntries(new FormData(app.querySelector("#card")));
    Object.assign(r.card, { ...f, setCode: f.setCode.trim().toUpperCase(), firstEd: f.firstEd === "1" });
    r.answers = Object.fromEntries(new FormData(app.querySelector("#qs")));
  };
  const render = () => {
    readForms();
    const g = grade({ whitening: r.whitening, centering: r.centering }, r.answers);
    r.grade = g;
    const links = cardmarketLinks({ ...r.card, condition: g.condition });
    app.querySelector("#res").innerHTML = `
      <h2>Zustand: <span class="cond">${g.condition}</span> ${esc(COND[g.condition])}</h2>
      <ul class="reasons">${g.reasons.map(x => `<li>${x.cond ? `<span class="tag">${x.cond}</span>` : ""}${esc(x.why)}</li>`).join("")}</ul>
      <h2 style="margin-top:18px">Preis</h2>
      <p class="sub">Öffnet Cardmarket mit Filter: ${esc(LANGS[r.card.language] || "")}, ${esc(COND[g.condition])} oder besser, Verkäufer aus Deutschland${r.card.firstEd ? ", 1. Auflage" : ""}. Das günstigste Angebot steht oben.</p>
      ${links.product && r.card.name ? `<a class="btn wide" href="${esc(links.product)}" target="_blank" rel="noopener">Angebote dieser Auflage</a>` : ""}
      ${r.card.name ? `<a class="btn sec wide" href="${esc(links.versions)}" target="_blank" rel="noopener">Alle Auflagen der Karte</a>
        <p class="sub">Falls die erste Seite nicht gefunden wird (manche Sets haben die Karte mehrmals): Bei „Alle Auflagen“ die mit deinem Set-Code wählen.</p>` : `<p class="warn">Trag oben den Namen ein, dann erscheinen die Cardmarket-Links.</p>`}
      <label class="f">Günstigster Preis auf Cardmarket (€)</label>
      <input type="text" id="price" inputmode="decimal" value="${esc(r.price ?? "")}" placeholder="z.B. 0,49">
      <button class="wide" id="save">${r.id ? "Änderungen speichern" : "Im Verlauf speichern"}</button>`;
    app.querySelector("#save").onclick = async () => {
      readForms();
      const p = parseFloat(String(app.querySelector("#price").value).replace(",", "."));
      const rec = {
        id: r.id || String(r.time), time: r.time, name: r.card.name, setCode: r.card.setCode, setName: r.card.setName,
        rarity: r.card.rarity, rarities: r.card.rarities, language: r.card.language, firstEd: r.card.firstEd,
        condition: g.condition, reasons: g.reasons, answers: r.answers, centering: r.centering,
        whitening: { frac: r.whitening.frac }, price: isNaN(p) ? null : p,
        thumbFront: r.thumbFront || thumb(r.front), thumbBack: r.thumbBack || thumb(markSpots(r.back, r.whitening).getContext("2d").getImageData(0, 0, r.back.width, r.back.height)),
      };
      await db.put(rec);
      home();
    };
  };
  app.querySelector("#qs").onchange = render;
  app.querySelector("#card").onchange = render;
  app.querySelector("#look").onclick = async () => {
    readForms();
    const btn = app.querySelector("#look"); btn.disabled = true; btn.textContent = "…";
    const hit = await lookupFuzzy(r.card.setCode).catch(() => null), info = hit && hit.info;
    if (hit) r.card.setCode = hit.code;
    if (info) Object.assign(r.card, { name: info.name, setName: info.setName, rarities: info.rarities, rarity: info.rarities[0] || "" });
    r.card.language = languageOf(r.card.setCode) || r.card.language;
    r.warnings = info ? [] : ["Zu diesem Set-Code nichts gefunden (oder keine Verbindung)."];
    result(r);
  };
  render();
}

// ---------- saved card ----------
function detail(rec) {
  if (!rec) return home();
  document.getElementById("home").hidden = false;
  document.getElementById("title").textContent = rec.name || "Karte";
  const links = cardmarketLinks(rec);
  app.innerHTML = `
    <div class="box">
      <div class="pair"><img src="${esc(rec.thumbFront)}" alt="Vorderseite"><img src="${esc(rec.thumbBack)}" alt="Rückseite"></div>
      <h2 style="margin-top:12px">${esc(rec.name)}</h2>
      <p class="sub">${esc(rec.setCode)} · ${esc(rec.setName)} · ${esc(rec.rarity)} · ${esc(LANGS[rec.language] || rec.language)}${rec.firstEd ? " · 1. Auflage" : ""}</p>
      <h2>Zustand: <span class="cond">${esc(rec.condition)}</span> ${esc(COND[rec.condition])}</h2>
      <ul class="reasons">${(rec.reasons || []).map(x => `<li>${x.cond ? `<span class="tag">${esc(x.cond)}</span>` : ""}${esc(x.why)}</li>`).join("")}</ul>
      ${rec.name ? `<a class="btn wide" href="${esc(links.product)}" target="_blank" rel="noopener">Angebote dieser Auflage</a>
      <a class="btn sec wide" href="${esc(links.versions)}" target="_blank" rel="noopener">Alle Auflagen der Karte</a>` : ""}
      <label class="f">Günstigster Preis (€)</label>
      <input type="text" id="price" inputmode="decimal" value="${esc(rec.price ?? "")}">
      <button class="wide" id="save">Preis speichern</button>
      <button class="sec wide" id="del">Löschen</button>
    </div>`;
  app.querySelector("#save").onclick = async () => {
    const p = parseFloat(String(app.querySelector("#price").value).replace(",", "."));
    rec.price = isNaN(p) ? null : p; await db.put(rec); home();
  };
  app.querySelector("#del").onclick = async () => {
    const b = app.querySelector("#del");
    if (b.dataset.sure) { await db.del(rec.id); home(); } else { b.dataset.sure = "1"; b.textContent = "Wirklich löschen?"; }
  };
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
home();
