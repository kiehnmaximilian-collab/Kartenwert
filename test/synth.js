// Synthetic card photos for tests.
import { makeImage, CARD_RATIO } from "../docs/js/vision.js";

// Draw a card (w x h px, rotated by `angle` rad, centred at cx,cy) on a dark
// background. paint(u, v) returns the card's colour at card coords 0..1.
export function photo({ W = 900, H = 1200, cw = 500, angle = 0.1, cx = 450, cy = 600, bg = [25, 25, 28], paint }) {
  const img = makeImage(W, H), ch = cw * CARD_RATIO;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = (cos * dx + sin * dy) / cw + 0.5, v = (-sin * dx + cos * dy) / ch + 0.5;
    const c = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? paint(u, v) : bg.map(b => b + rnd() * 8);
    const i = (y * W + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  const corner = (u, v) => { const dx = (u - 0.5) * cw, dy = (v - 0.5) * ch; return [cx + cos * dx - sin * dy, cy + sin * dx + cos * dy]; };
  return { img, quad: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)] };
}

export const BROWN = [92, 58, 32];

// Back: brown border, lighter swirl inside, optional white spots on the edge.
export const back = (spots = []) => (u, v) => {
  for (const [su, sv, r] of spots) if (Math.hypot(u - su, (v - sv) * CARD_RATIO) < r) return [235, 232, 225];
  if (u > 0.06 && u < 0.94 && v > 0.05 && v < 0.95) return [140, 90, 40];
  return BROWN;
};

// Front: orange frame, artwork box from artL to artR (fraction of width).
export const front = (artL = 0.12, artR = 0.88) => (u, v) => {
  if (u > artL && u < artR && v > 0.18 && v < 0.73) return [40 + 150 * u, 90, 160 - 100 * v];
  return [200, 120, 50];
};
