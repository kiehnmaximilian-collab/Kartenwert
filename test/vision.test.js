import test from "node:test";
import assert from "node:assert/strict";
import { detectCard, warp, whitening, centering, MARGIN } from "../docs/js/vision.js";
import { photo, back, front } from "./synth.js";

const close = (q, r, tol) => q.forEach((p, k) => assert.ok(Math.hypot(p[0] - r[k][0], p[1] - r[k][1]) < tol, `corner ${k}: ${p} vs ${r[k]}`));

test("finds a tilted card", () => {
  const { img, quad } = photo({ paint: back(), angle: 0.12 });
  close(detectCard(img), quad, 6);
});

test("finds a card photographed sideways and turns it upright", () => {
  const { img, quad } = photo({ W: 1200, H: 900, cx: 600, cy: 450, paint: back(), angle: Math.PI / 2 + 0.05 });
  const q = detectCard(img);
  // upright order: the long side runs top to bottom
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.ok(len(q[0], q[3]) > len(q[0], q[1]));
  // Which way round (90 or 270 degrees) cannot be told from the outline
  for (const p of quad) assert.ok(q.some(r => len(p, r) < 6), String(p));
});

test("clean back has (almost) no whitening", () => {
  const { img } = photo({ paint: back() });
  const w = whitening(warp(img, detectCard(img)));
  assert.ok(w.edgeFrac < 0.002, String(w.edgeFrac));
  assert.equal(w.corners, 0);
});

test("white spots on edge and corner are found where they are", () => {
  const { img } = photo({ paint: back([[0.5, 0.0, 0.03], [0.0, 1.0, 0.03]]) });
  const w = whitening(warp(img, detectCard(img)));
  assert.ok(w.frac.oben > 0.02, JSON.stringify(w.frac));
  assert.ok(w.frac.ul > 0.02, JSON.stringify(w.frac));
  assert.ok(w.frac.unten < 0.002 && w.frac.rechts < 0.002 && w.frac.or < 0.002, JSON.stringify(w.frac));
  assert.equal(w.corners, 1);
});

test("centring left/right", () => {
  const even = photo({ paint: front(0.12, 0.88) }).img;
  const c1 = centering(warp(even, detectCard(even)));
  assert.ok(c1.offset <= 2, c1.ratio); assert.ok(c1.sure);
  const off = photo({ paint: front(0.15, 0.91) }).img;
  const c2 = centering(warp(off, detectCard(off)));
  assert.ok(c2.offset >= 10 && c2.left > c2.right, JSON.stringify(c2));
});
