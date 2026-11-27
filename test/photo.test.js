import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { detectCard, detectInFrame } from "../docs/js/vision.js";

// Real phone photo (Samsung): light beige table, glare on the left, purple
// card edge. 440 x 707 RGBA, app overlay removed.
const raw = gunzipSync(readFileSync(new URL("./fixtures/samsung-beige.rgba.gz", import.meta.url)));
const img = { width: 440, height: 707, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) };
const expected = [[64, 215], [389, 215], [390, 689], [62, 689]];

const near = (q) => q.every((p, i) => Math.hypot(p[0] - expected[i][0], p[1] - expected[i][1]) < 8);

test("finds the card edge on a light background with glare", () => {
  const q = detectCard(img);
  assert.ok(q, "no card found");
  assert.ok(near(q), "corners off: " + JSON.stringify(q.map(p => p.map(Math.round))));
});

test("detectInFrame finds it too", () => {
  const r = detectInFrame(img, [60, 200, 400, 700]);
  assert.ok(r.found);
  assert.ok(near(r.quad), JSON.stringify(r.quad.map(p => p.map(Math.round))));
});
