// Image analysis that runs on the phone. Works on ImageData-like objects
// {width, height, data: Uint8ClampedArray RGBA}, so it also runs in Node tests.

export const CARD_RATIO = 86 / 59;   // Yu-Gi-Oh! card: 59 x 86 mm
export const MARGIN = 0.02;          // warped images keep 2 % of background around the card

export function makeImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Nearest-neighbour downscale so the longest side is at most `max`.
export function downscale(img, max) {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  if (s === 1) return { img, scale: 1 };
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / s));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / s));
      const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4;
      out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = 255;
    }
  }
  return { img: out, scale: s };
}

function median(arr) {
  const a = Float64Array.from(arr).sort();
  return a.length ? a[a.length >> 1] : 0;
}

// Least squares fit  v = a*u + b
function fitLine(pts) {
  let su = 0, sv = 0, suu = 0, suv = 0;
  for (const [u, v] of pts) { su += u; sv += v; suu += u * u; suv += u * v; }
  const n = pts.length, den = n * suu - su * su;
  const a = den ? (n * suv - su * sv) / den : 0;
  return { a, b: (sv - a * su) / n };
}

// Find the card: everything that differs clearly from the background colour
// (taken from the photo's outer frame), keep the biggest blob, fit a line to
// each side and intersect them. Returns corners [tl, tr, br, bl] in image
// coordinates, or null.
export function detectCard(src) {
  const { img, scale } = downscale(src, 480);
  const { width: w, height: h, data: d } = img;
  const fr = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const R = [], G = [], B = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= fr && x < w - fr && y >= fr && y < h - fr) continue;
    const i = (y * w + x) * 4; R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]);
  }
  const bg = [median(R), median(G), median(B)];
  // threshold from the spread of the background itself
  const dists = [];
  for (let k = 0; k < R.length; k++) dists.push(Math.hypot(R[k] - bg[0], G[k] - bg[1], B[k] - bg[2]));
  dists.sort((a, b) => a - b);
  const thr = Math.max(40, dists[Math.floor(dists.length * 0.9)] * 1.6);
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    mask[p] = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) > thr ? 1 : 0;
  }
  // Close small holes inside the card (dark artwork next to a dark background):
  // fill each row and column between first and last hit is too greedy, so use
  // connected components and then the component's row/column extents.
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, cur = 0;
  const stack = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || label[p] >= 0) continue;
    let sp = 0, size = 0; stack[sp++] = p; label[p] = cur;
    while (sp) {
      const q = stack[--sp]; size++;
      const x = q % w, y = (q / w) | 0;
      if (x > 0 && mask[q - 1] && label[q - 1] < 0) { label[q - 1] = cur; stack[sp++] = q - 1; }
      if (x < w - 1 && mask[q + 1] && label[q + 1] < 0) { label[q + 1] = cur; stack[sp++] = q + 1; }
      if (y > 0 && mask[q - w] && label[q - w] < 0) { label[q - w] = cur; stack[sp++] = q - w; }
      if (y < h - 1 && mask[q + w] && label[q + w] < 0) { label[q + w] = cur; stack[sp++] = q + w; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
    cur++;
  }
  if (best < 0 || bestSize < w * h * 0.05) return null;
  const left = new Float64Array(h).fill(NaN), right = new Float64Array(h).fill(NaN);
  const top = new Float64Array(w).fill(NaN), bottom = new Float64Array(w).fill(NaN);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (label[y * w + x] !== best) continue;
    if (isNaN(left[y])) left[y] = x; right[y] = x;
    if (isNaN(top[x])) top[x] = y; bottom[x] = y;
  }
  const rows = [...Array(h).keys()].filter(y => !isNaN(left[y]));
  const cols = [...Array(w).keys()].filter(x => !isNaN(top[x]));
  const mid = (list) => { const n = list.length; return list.slice(Math.floor(n * 0.2), Math.ceil(n * 0.8)); };
  // For a tilted card the extreme row/col points near the ends belong to the
  // neighbouring side; the middle 60 % is safe.
  const L = fitLine(mid(rows).map(y => [y, left[y]]));     // x = a*y + b
  const Rr = fitLine(mid(rows).map(y => [y, right[y] + 1]));
  const T = fitLine(mid(cols).map(x => [x, top[x]]));      // y = a*x + b
  const Bt = fitLine(mid(cols).map(x => [x, bottom[x] + 1]));
  const meet = (V, H) => {           // x = V.a*y + V.b ; y = H.a*x + H.b
    const y = (H.a * V.b + H.b) / (1 - H.a * V.a);
    return [(V.a * y + V.b) / scale, y / scale];
  };
  let q = [meet(L, T), meet(Rr, T), meet(Rr, Bt), meet(L, Bt)];
  if (q.some(p => !isFinite(p[0]) || !isFinite(p[1]))) return null;
  return portrait(q);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Card photographed sideways: rotate the corner order so the card is upright.
export function portrait(q) {
  return dist(q[0], q[1]) > dist(q[0], q[3]) ? [q[3], q[0], q[1], q[2]] : q;
}

// Homography mapping the unit square (0,0),(1,0),(1,1),(0,1) to quad.
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, hh = 0;
  if (sx || sy) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
  }
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh];
}

// Straighten the card to W x H pixels (portrait), keeping MARGIN of
// background around it so whitening at the very edge is not cut off.
export function warp(src, quad, W = 708, H = Math.round(W * CARD_RATIO), margin = MARGIN) {
  const [a, b, c, d, e, f, g, h] = squareToQuad(quad);
  const out = makeImage(W, H);
  const sw = src.width, sh = src.height, s = src.data;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H * (1 + 2 * margin) - margin;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W * (1 + 2 * margin) - margin;
      const den = g * u + h * v + 1;
      const px = (a * u + b * v + c) / den - 0.5, py = (d * u + e * v + f) / den - 0.5;
      const o = (y * W + x) * 4;
      out.data[o + 3] = 255;
      if (px < 0 || py < 0 || px >= sw - 1 || py >= sh - 1) continue;
      const x0 = px | 0, y0 = py | 0, fx = px - x0, fy = py - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        out.data[o + k] = (s[i00 + k] * (1 - fx) + s[i10 + k] * fx) * (1 - fy) + (s[i01 + k] * (1 - fx) + s[i11 + k] * fx) * fy;
      }
    }
  }
  return out;
}

export function rotate180(img) {
  const out = makeImage(img.width, img.height), n = img.width * img.height;
  for (let p = 0; p < n; p++) {
    const i = p * 4, j = (n - 1 - p) * 4;
    out.data[i] = img.data[j]; out.data[i + 1] = img.data[j + 1]; out.data[i + 2] = img.data[j + 2]; out.data[i + 3] = 255;
  }
  return out;
}

// Card coordinates (0..1 inside the card) -> pixel in a warped image.
export function toPx(img, u, v, margin = MARGIN) {
  return [Math.round((u + margin) / (1 + 2 * margin) * img.width), Math.round((v + margin) / (1 + 2 * margin) * img.height)];
}

// Cut a region given in card coordinates out of a warped image.
export function cropCard(img, u0, v0, u1, v1, margin = MARGIN) {
  const [x0, y0] = toPx(img, u0, v0, margin), [x1, y1] = toPx(img, u1, v1, margin);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), out = makeImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((y0 + y) * img.width + x0 + x) * 4, di = (y * w + x) * 4;
    out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = 255;
  }
  return out;
}

// Sharpness: variance of the Laplacian on the luminance (higher = sharper).
export function sharpness(img) {
  const { width: w, height: h, data: d } = downscale(img, 600).img;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    const l = 4 * lum(d, i) - lum(d, i - 4) - lum(d, i + 4) - lum(d, i - w * 4) - lum(d, i + w * 4);
    sum += l; sum2 += l * l; n++;
  }
  return n ? sum2 / n - (sum / n) ** 2 : 0;
}

// Whitening on the back: the back border is dark brown, so worn spots show
// up as light, unsaturated pixels along the outer edge.
// Edge band: outermost EDGE_BAND of the card width (plus the margin, in case
// the detected outline is a little too small). Corners are measured apart.
export const EDGE_BAND = 0.02;
export const CORNER = 0.07;

export function whitening(back, margin = MARGIN) {
  const { width: W, height: Hh, data: d } = back;
  const cw = W / (1 + 2 * margin), ch = Hh / (1 + 2 * margin);     // card size in px
  const mx = margin * cw, my = margin * ch;
  const band = EDGE_BAND * cw, cor = CORNER * cw;
  // reference: border colour a little further in
  const ref = [];
  for (let k = 0; k < 400; k++) {
    const t = (k + 0.5) / 400, inset = 0.045 * cw;
    const pts = [[mx + inset, my + t * ch], [mx + cw - inset, my + t * ch], [mx + t * cw, my + inset], [mx + t * cw, my + ch - inset]];
    for (const [x, y] of pts) ref.push(lum(d, ((y | 0) * W + (x | 0)) * 4));
  }
  const refL = median(ref);
  const minL = Math.max(135, refL + 70);
  const zones = { oben: 0, unten: 0, links: 0, rechts: 0, ol: 0, or: 0, ul: 0, ur: 0 };
  const totals = { ...zones };
  const spots = [];
  const tol = 0.6 * margin * cw;   // look a bit outside the detected outline too
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const cx = x - mx, cy = y - my;                 // position relative to the card
    const dl = cx, dr = cw - cx, dt = cy, db = ch - cy;
    const dmin = Math.min(dl, dr, dt, db);
    if (dmin > band || dmin < -tol) continue;
    let zone;
    const nearL = dl < cor, nearR = dr < cor, nearT = dt < cor, nearB = db < cor;
    if (nearT && nearL) zone = "ol"; else if (nearT && nearR) zone = "or";
    else if (nearB && nearL) zone = "ul"; else if (nearB && nearR) zone = "ur";
    else zone = dmin === dt ? "oben" : dmin === db ? "unten" : dmin === dl ? "links" : "rechts";
    totals[zone]++;
    const i = (y * W + x) * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const L = lum(d, i), sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (L >= minL && sat < 70) { zones[zone]++; spots.push(x, y); }
  }
  const frac = {};
  for (const k in zones) frac[k] = totals[k] ? zones[k] / totals[k] : 0;
  const edgeFrac = (zones.oben + zones.unten + zones.links + zones.rechts) /
    Math.max(1, totals.oben + totals.unten + totals.links + totals.rechts);
  const corners = ["ol", "or", "ul", "ur"].filter(k => frac[k] > 0.004).length;
  return { frac, edgeFrac, corners, spots, refL, brightBorder: refL > 120 };
}

// Left/right centring on the front: the artwork box gives strong vertical
// edges near 12 % and 88 % of the width. Returns {left, right, ratio, sure}.
export function centering(front, margin = MARGIN) {
  const { width: W, data: d } = front;
  const prof = new Float64Array(W);
  const [, y0] = toPx(front, 0, 0.3, margin), [, y1] = toPx(front, 0, 0.55, margin);
  for (let y = y0; y < y1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4;
    prof[x] += Math.abs(lum(d, i + 4) - lum(d, i - 4));
  }
  const peak = (u0, u1) => {
    const [a] = toPx(front, u0, 0, margin), [b] = toPx(front, u1, 0, margin);
    let bx = a, bv = -1, sum = 0;
    for (let x = a; x <= b; x++) { sum += prof[x]; if (prof[x] > bv) { bv = prof[x]; bx = x; } }
    return { x: bx, strength: bv / (sum / (b - a + 1) || 1) };
  };
  const L = peak(0.05, 0.18), R = peak(0.82, 0.95);
  const [cardL] = toPx(front, 0, 0, margin), [cardR] = toPx(front, 1, 0, margin);
  const left = L.x - cardL, right = cardR - R.x;
  const pct = Math.round(100 * left / (left + right));
  return { left, right, ratio: `${pct}/${100 - pct}`, offset: Math.abs(pct - 50), sure: L.strength > 2.5 && R.strength > 2.5 };
}

// Grayscale, contrast-stretched, upscaled crop for the text recognition.
export function forOcr(img, scale = 3) {
  const w = img.width * scale, h = img.height * scale, out = makeImage(w, h);
  let lo = 255, hi = 0;
  for (let i = 0; i < img.data.length; i += 4) { const l = lum(img.data, i); lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const k = 255 / Math.max(1, hi - lo);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (lum(img.data, (((y / scale) | 0) * img.width + ((x / scale) | 0)) * 4) - lo) * k;
    const o = (y * w + x) * 4;
    out.data[o] = out.data[o + 1] = out.data[o + 2] = v; out.data[o + 3] = 255;
  }
  return out;
}
