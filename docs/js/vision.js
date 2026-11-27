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
function detectByColour(src) {
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

// Gradients of a small grey-ish picture: per pixel the strongest Sobel
// response over the three colour channels (a purple card edge on beige has
// little brightness contrast but clear colour contrast).
function gradients(img) {
  const { width: w, height: h, data: d } = img;
  const mag = new Float32Array(w * h), ang = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let bm = 0, bx = 0, by = 0;
    for (let c = 0; c < 3; c++) {
      const v = (dx, dy) => d[((y + dy) * w + x + dx) * 4 + c];
      const gx = v(1, -1) + 2 * v(1, 0) + v(1, 1) - v(-1, -1) - 2 * v(-1, 0) - v(-1, 1);
      const gy = v(-1, 1) + 2 * v(0, 1) + v(1, 1) - v(-1, -1) - 2 * v(0, -1) - v(1, -1);
      const m = gx * gx + gy * gy;
      if (m > bm) { bm = m; bx = gx; by = gy; }
    }
    const p = y * w + x;
    mag[p] = Math.sqrt(bm);
    let a = Math.atan2(by, bx) * 180 / Math.PI;   // direction across the edge
    if (a < 0) a += 180;
    ang[p] = a;                                   // 0..180
  }
  return { w, h, mag, ang };
}

const angDiff = (a, b) => { const t = Math.abs(a - b) % 180; return Math.min(t, 180 - t); };

// Straight lines via a Hough transform, one family at a time:
// base 0 = steep lines (left/right sides), base 90 = flat lines (top/bottom).
// A line is {t, r}: x*cos t + y*sin t = r (t in degrees).
function houghLines(g, edge, base, maxTilt = 25, keep = 24) {
  const { w, h, mag, ang } = g;
  const nT = 2 * maxTilt + 1, R = Math.ceil(Math.hypot(w, h)), nR = 2 * R + 1;
  const acc = new Float32Array(nT * nR);
  const cs = [], sn = [];
  for (let k = 0; k < nT; k++) { const t = (base + k - maxTilt) * Math.PI / 180; cs.push(Math.cos(t)); sn.push(Math.sin(t)); }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    if (mag[p] < edge) continue;
    const a = ang[p];
    for (let k = 0; k < nT; k++) {
      if (angDiff(a, base + k - maxTilt) > 6) continue;
      acc[k * nR + Math.round(x * cs[k] + y * sn[k]) + R] += 1;
    }
  }
  const out = [];
  const minVotes = 0.12 * (base ? w : h);
  for (let n = 0; n < keep; n++) {
    let bi = -1, bv = minVotes;
    for (let i = 0; i < acc.length; i++) if (acc[i] > bv) { bv = acc[i]; bi = i; }
    if (bi < 0) break;
    const k = Math.floor(bi / nR), r = bi % nR - R;
    out.push({ t: base + k - maxTilt, r });
    for (let kk = Math.max(0, k - 2); kk <= Math.min(nT - 1, k + 2); kk++)
      for (let rr = Math.max(0, r + R - 2); rr <= Math.min(nR - 1, r + R + 2); rr++) acc[kk * nR + rr] = 0;
  }
  return out;
}

function meetLines(a, b) {
  const ta = a.t * Math.PI / 180, tb = b.t * Math.PI / 180;
  const a1 = Math.cos(ta), b1 = Math.sin(ta), a2 = Math.cos(tb), b2 = Math.sin(tb);
  const den = a1 * b2 - a2 * b1;
  if (Math.abs(den) < 1e-6) return null;
  return [(a.r * b2 - b.r * b1) / den, (a1 * b.r - a2 * a.r) / den];
}

// Share of points along a side (10..90 %) that sit on an edge running the
// same way as the side.
function coverage(g, edge, p, q) {
  const { w, h, mag, ang } = g;
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
  if (len < 5) return 0;
  const nx = -dy / len, ny = dx / len;
  let dir = Math.atan2(ny, nx) * 180 / Math.PI; if (dir < 0) dir += 180;
  const N = 40; let hit = 0;
  for (let i = 0; i < N; i++) {
    const f = 0.1 + 0.8 * i / (N - 1), x = p[0] + dx * f, y = p[1] + dy * f;
    for (let o = -1; o <= 1; o++) {
      const xi = Math.round(x + nx * o), yi = Math.round(y + ny * o);
      if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) continue;
      const k = yi * w + xi;
      if (mag[k] >= edge && angDiff(ang[k], dir) < 20) { hit++; break; }
    }
  }
  return hit / N;
}

// Average colour difference between thin strips on both sides of a side.
// High for the card outline (card | table), low for a line running inside
// the card's mottled border.
function contrast(img, p, q) {
  const { width: w, height: h, data: d } = img;
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const at = (x, y, c) => d[(Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4 + c];
  let sum = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    const f = 0.1 + 0.8 * i / 29, x = p[0] + dx * f, y = p[1] + dy * f;
    let diff = 0;
    for (let c = 0; c < 3; c++) {
      const a = at(x + nx * 2.5, y + ny * 2.5, c) + at(x + nx * 4, y + ny * 4, c);
      const b = at(x - nx * 2.5, y - ny * 2.5, c) + at(x - nx * 4, y - ny * 4, c);
      diff += ((a - b) / 2) ** 2;
    }
    sum += Math.sqrt(diff); n++;
  }
  return sum / n;
}

function edgeThreshold(g) {
  const s = [];
  for (let i = 0; i < g.mag.length; i += 3) s.push(g.mag[i]);
  s.sort((a, b) => a - b);
  return Math.min(120, Math.max(50, s[Math.floor(s.length * 0.7)]));
}

const quadArea = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % 4]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

// Find the card by its straight outline: the biggest card-shaped rectangle
// whose four sides are all backed by edges. Copes with light, uneven
// backgrounds and glare. Returns {quad, score} in the small picture's
// coordinates scaled back, or null.
function detectByEdges(src) {
  const { img, scale } = downscale(src, 400);
  const g = gradients(img), edge = edgeThreshold(g);
  g.img = img;
  const V = houghLines(g, edge, 0), H = houghLines(g, edge, 90);
  const { w, h } = g;
  const xAt = l => meetLines(l, { t: 90, r: h / 2 })[0];
  const yAt = l => meetLines(l, { t: 0, r: w / 2 })[1];
  V.sort((a, b) => xAt(a) - xAt(b)); H.sort((a, b) => yAt(a) - yAt(b));
  let best = null;
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    if (xAt(V[j]) - xAt(V[i]) < 0.15 * w) continue;
    for (let k = 0; k < H.length; k++) for (let m = k + 1; m < H.length; m++) {
      if (yAt(H[m]) - yAt(H[k]) < 0.15 * h) continue;
      const q = [meetLines(V[i], H[k]), meetLines(V[j], H[k]), meetLines(V[j], H[m]), meetLines(V[i], H[m])];
      if (q.some(p => !p || p[0] < -0.05 * w || p[1] < -0.05 * h || p[0] > 1.05 * w || p[1] > 1.05 * h)) continue;
      const sw = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, sh = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
      const ratio = Math.max(sw, sh) / Math.min(sw, sh);
      if (Math.abs(ratio - CARD_RATIO) / CARD_RATIO > 0.15) continue;
      const area = quadArea(q) / (w * h);
      if (area < 0.08) continue;
      const cov = [0, 1, 2, 3].map(s => coverage(g, edge, q[s], q[(s + 1) % 4]));
      const minCov = Math.min(...cov);
      if (minCov < 0.45) continue;
      const mean = cov.reduce((a, b) => a + b) / 4;
      const con = Math.min(...[0, 1, 2, 3].map(s => contrast(img, q[s], q[(s + 1) % 4])));
      // well-backed sides first, then the outermost rectangle (the card,
      // not the frame or the art box inside it)
      const score = mean + Math.min(1, con / 60) + area;
      if (!best || score > best.score) best = { q, score, mean };
    }
  }
  if (!best) return null;
  return { quad: portrait(best.q.map(([x, y]) => [x / scale, y / scale])), score: best.mean };
}

// How well a quad (full-size coordinates) is backed by edges, 0..1.
function edgeSupport(src, quad) {
  const { img, scale } = downscale(src, 400);
  const g = gradients(img), edge = edgeThreshold(g);
  const q = quad.map(([x, y]) => [x * scale, y * scale]);
  return [0, 1, 2, 3].map(s => coverage(g, edge, q[s], q[(s + 1) % 4])).reduce((a, b) => a + b) / 4;
}

// Find the card: try the colour blob and the straight-edge search and keep
// whichever outline is better backed by real edges in the photo.
// Returns corners [tl, tr, br, bl] in image coordinates, or null.
export function detectCard(src) {
  const byEdge = detectByEdges(src);
  const byColour = detectByColour(src);
  if (!byEdge) return byColour;
  if (!byColour) return byEdge.quad;
  return edgeSupport(src, byColour) >= byEdge.score - 0.05 ? byColour : byEdge.quad;
}

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

export function crop(img, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  x1 = Math.min(img.width, Math.round(x1)); y1 = Math.min(img.height, Math.round(y1));
  const w = x1 - x0, h = y1 - y0, out = makeImage(w, h);
  for (let y = 0; y < h; y++) out.data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x1) * 4), y * w * 4);
  return out;
}

// detectCard works on a shrunken picture; look again closer around the
// card for exact corners.
export function refine(img, q) {
  const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
  const mx = (Math.max(...xs) - Math.min(...xs)) * 0.1, my = (Math.max(...ys) - Math.min(...ys)) * 0.1;
  const x0 = Math.max(0, Math.min(...xs) - mx), y0 = Math.max(0, Math.min(...ys) - my);
  const part = crop(img, x0, y0, Math.max(...xs) + mx, Math.max(...ys) + my);
  const e = detectByEdges(part);
  const f = e && e.score > 0.6 ? e.quad : null;
  if (!f) return q;
  const fine = f.map(([x, y]) => [x + x0, y + y0]);
  const tol = 0.03 * Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return fine.every((p, i) => dist(p, q[i]) < tol) && edgeSupport(img, fine) >= edgeSupport(img, q) ? fine : q;
}

// The user placed the card inside a frame on screen. rect = [x0, y0, x1, y1]
// of that frame in image pixels. Looks for the exact outline near the frame
// and falls back to the frame itself if the result is implausible.
// Returns {quad, found}.
export function detectInFrame(img, rect) {
  const [x0, y0, x1, y1] = rect, fw = x1 - x0, fh = y1 - y0;
  const frameQuad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const area = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % 4]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  const centre = p => [p.reduce((s, a) => s + a[0], 0) / 4, p.reduce((s, a) => s + a[1], 0) / 4];
  const plausible = (quad, minR, maxR) => {
    if (!quad) return false;
    const ratio = area(quad) / (fw * fh);
    const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2, w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
    const shapeOk = Math.abs(h / w - CARD_RATIO) / CARD_RATIO < 0.18;
    const near = dist(centre(quad), centre(frameQuad)) < 0.3 * Math.hypot(fw, fh);
    return ratio > minR && ratio < maxR && shapeOk && near;
  };
  // 1. whole picture (works whenever there is background all around the card)
  const all = detectCard(img);
  if (plausible(all, 0.3, 2.6)) return { quad: refine(img, all), found: true };
  // 2. close around the frame, but only if the outline lies inside the cut-out
  const px = fw * 0.15, py = fh * 0.15;
  const cx0 = Math.max(0, x0 - px), cy0 = Math.max(0, y0 - py), cx1 = Math.min(img.width, x1 + px), cy1 = Math.min(img.height, y1 + py);
  const q = detectCard(crop(img, cx0, cy0, cx1, cy1));
  const quad = q && q.map(([x, y]) => [x + cx0, y + cy0]);
  const inside = quad && quad.every(([x, y]) => x > cx0 + 3 && y > cy0 + 3 && x < cx1 - 3 && y < cy1 - 3);
  if (inside && plausible(quad, 0.55, 1.45)) return { quad, found: true };
  return { quad: frameQuad, found: false };
}
