// Measurements + answers -> Cardmarket condition, with the reasons.
import { CONDITIONS } from "./cards.js";

// Limits for the share of white pixels on the back's outer edge.
// First guesses; to be tuned with cards whose condition is known.
export const LIMITS = {
  edge: [            // worst single edge (top/bottom/left/right)
    [0.001, "MT"], [0.006, "NM"], [0.025, "EX"], [0.06, "GD"], [0.12, "LP"], [0.25, "PL"],
  ],
  corner: [          // worst single corner
    [0.002, "MT"], [0.012, "NM"], [0.04, "EX"], [0.10, "GD"], [0.2, "LP"], [0.35, "PL"],
  ],
};

const worse = (a, b) => (CONDITIONS.indexOf(a) > CONDITIONS.indexOf(b) ? a : b);
const step = (limits, v) => { for (const [lim, c] of limits) if (v <= lim) return c; return "PO"; };

export const QUESTIONS = [
  { id: "knick", text: "Hat die Karte einen Knick?", options: [["nein", "Nein"], ["leicht", "Leicht, nur im Licht zu sehen"], ["deutlich", "Deutlich"]] },
  { id: "biegung", text: "Ist die Karte gebogen (liegt nicht flach)?", options: [["nein", "Nein"], ["leicht", "Leicht"], ["stark", "Stark"]] },
  { id: "kratzer", text: "Halte die Vorderseite schräg ins Licht: Siehst du Kratzer oder Abdrücke?", options: [["keine", "Keine"], ["wenige", "Ein, zwei feine"], ["mehrere", "Mehrere"], ["viele", "Viele oder tiefe"]] },
  { id: "schaden", text: "Sonstige Schäden?", options: [["nein", "Nein"], ["ja", "Ja: Wasser, Riss, Schrift, fehlendes Stück"]] },
];

const ANSWER_GRADE = {
  knick: { nein: "MT", leicht: "LP", deutlich: "PL" },
  biegung: { nein: "MT", leicht: "GD", stark: "PL" },
  kratzer: { keine: "MT", wenige: "EX", mehrere: "GD", viele: "LP" },
  schaden: { nein: "MT", ja: "PO" },
};

const ZONE_NAMES = { oben: "oberen Kante", unten: "unteren Kante", links: "linken Kante", rechts: "rechten Kante",
                     ol: "Ecke oben links", or: "Ecke oben rechts", ul: "Ecke unten links", ur: "Ecke unten rechts" };

// m = {whitening: {...} | null, centering: {...} | null}; answers = {knick: "nein", ...}
export function grade(m, answers, limits = LIMITS) {
  let cond = "MT";
  const reasons = [];
  const add = (c, why) => { cond = worse(cond, c); reasons.push({ cond: c, why }); };

  if (m.whitening) {
    const f = m.whitening.frac;
    const edges = ["oben", "unten", "links", "rechts"], corners = ["ol", "or", "ul", "ur"];
    const we = edges.reduce((a, k) => (f[k] > f[a] ? k : a)), wc = corners.reduce((a, k) => (f[k] > f[a] ? k : a));
    const ce = step(limits.edge, f[we]), cc = step(limits.corner, f[wc]);
    add(ce, ce === "MT" ? "Kanten der Rückseite ohne weiße Stellen" :
      `Weiße Stellen an der ${ZONE_NAMES[we]} (${(f[we] * 100).toFixed(1)} %)`);
    add(cc, cc === "MT" ? "Ecken der Rückseite ohne weiße Stellen" :
      `Weiß an der ${ZONE_NAMES[wc]} (${(f[wc] * 100).toFixed(1)} %)`);
    // Several worn corners point to more play than one bad spot.
    const worn = corners.filter(k => f[k] > limits.corner[1][0]).length;
    if (worn >= 3) add("GD", `${worn} Ecken abgenutzt`);
    else if (worn === 2) add("EX", "2 Ecken abgenutzt");
  } else {
    reasons.push({ cond: "", why: "Kanten nicht gemessen" });
  }
  if (m.centering && m.centering.sure && m.centering.offset > 15) {
    reasons.push({ cond: "", why: `Zentrierung ${m.centering.ratio} (bei Cardmarket kein Abzug, aber erwähnenswert)` });
  }
  for (const q of QUESTIONS) {
    const a = answers[q.id];
    if (!a) continue;
    const c = ANSWER_GRADE[q.id][a];
    if (c !== "MT") add(c, `${q.text.split(":")[0].replace(/\?$/, "")}: ${q.options.find(o => o[0] === a)[1]}`);
  }
  // Mint only when nothing at all was found; a photo can't prove perfection.
  if (cond === "MT") reasons.push({ cond: "", why: "Nichts gefunden. Mint heißt makellos: im Zweifel lieber als NM anbieten." });
  return { condition: cond, reasons };
}
