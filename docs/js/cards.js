// Set codes, card database (YGOPRODeck, free and without a key) and Cardmarket links.

// "PSV-DE092", "LOB-G001", "RA03-EN045", "SDK-E001", "MP23-DE123"
const CODE = /\b([A-Z0-9]{2,5})-([A-Z]{0,2})([0-9O]{2,3}[0-9O]?)\b/;

// Letters OCR mixes up with digits inside the number part.
const FIX_DIGITS = { O: "0", D: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };

export function parseSetCode(text) {
  const t = (text || "").toUpperCase().replace(/[–—_]/g, "-").replace(/\s*-\s*/g, "-");
  for (const raw of t.split(/\s+/)) {
    const m = raw.match(/([A-Z0-9]{2,5})-([A-Z0-9]{3,6})/);
    if (!m) continue;
    // split the part after the dash into region letters + number
    const tail = m[2], r = tail.match(/^([A-Z]{0,2})([A-Z0-9]{2,4})$/);
    if (!r) continue;
    const num = r[2].split("").map(c => FIX_DIGITS[c] || c).join("");
    if (!/^\d{2,4}$/.test(num)) continue;
    const code = `${m[1]}-${r[1]}${num}`;
    if (CODE.test(code)) return code;
  }
  return "";
}

const REGION = { DE: "DE", G: "DE", EN: "EN", E: "EN", FR: "FR", F: "FR", IT: "IT", I: "IT", SP: "ES", S: "ES",
                 PT: "PT", P: "PT", JP: "JP", KR: "KO", "": "EN" };

export function languageOf(code) {
  const m = (code || "").match(/^[A-Z0-9]+-([A-Z]{0,2})\d/);
  return m ? REGION[m[1]] || "" : "";
}

// YGOPRODeck lists English codes: "LOB-DE001" / "LOB-G001" -> "LOB-EN001"
export function englishCode(code) {
  const m = (code || "").trim().toUpperCase().match(/^([A-Z0-9]+)-([A-Z]{0,2})(\d+)$/);
  return m ? `${m[1]}-EN${m[3]}` : "";
}

const API = "https://db.ygoprodeck.com/api/v7/";

// {name, setName, rarities[], image} or null. `get` is fetch-compatible.
export async function lookup(code, get = fetch) {
  const en = englishCode(code);
  if (!en) return null;
  const r = await get(API + "cardsetsinfo.php?setcode=" + encodeURIComponent(en));
  if (!r.ok) return null;
  const info = await r.json();
  if (!info || !info.name) return null;
  const out = { name: info.name, setName: info.set_name || "", rarities: [], image: "" };
  try {
    const c = await (await get(API + "cardinfo.php?name=" + encodeURIComponent(info.name))).json();
    const card = (c.data || [])[0] || {};
    out.image = (card.card_images || [])[0]?.image_url_small || "";
    for (const s of card.card_sets || []) {
      if ((s.set_code || "").toUpperCase() === en && !out.rarities.includes(s.set_rarity)) out.rarities.push(s.set_rarity);
    }
  } catch { /* rarities stay empty, the user picks */ }
  if (!out.rarities.length && info.set_rarity) out.rarities.push(info.set_rarity);
  return out;
}

// Cardmarket URL name: "Pharaoh's Servant" -> "Pharaohs-Servant"
export function slug(name) {
  return (name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const CONDITIONS = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
const LANG_ID = { EN: 1, FR: 2, DE: 3, ES: 4, IT: 5, JP: 7, PT: 8, KO: 10 };
const GERMANY = 7;

function filters(card) {
  const p = new URLSearchParams();
  if (LANG_ID[card.language]) p.set("language", LANG_ID[card.language]);
  const ci = CONDITIONS.indexOf(card.condition);
  if (ci >= 0 && ci < CONDITIONS.length - 1) p.set("minCondition", ci + 1);
  p.set("sellerCountry", GERMANY);
  if (card.firstEd) p.set("isFirstEd", "Y");
  return p.toString();
}

// product: the printing's own page (set + card). versions: all printings,
// for when the set has the card more than once (Cardmarket adds "-V1-...").
export function cardmarketLinks(card) {
  const base = "https://www.cardmarket.com/de/YuGiOh";
  const q = filters(card);
  return {
    product: card.setName ? `${base}/Products/Singles/${slug(card.setName)}/${slug(card.name)}?${q}` : "",
    versions: `${base}/Cards/${slug(card.name)}/Versions`,
    allOffers: `${base}/Cards/${slug(card.name)}?${q}`,
  };
}

// Digits the text recognition likes to confuse.
const LOOKALIKE = { 0: "689", 6: "058", 8: "0369", 9: "08", 5: "836", 3: "85", 1: "7", 7: "1", 2: "7" };

// Like lookup(), but if the code is unknown, also tries codes with one
// commonly misread digit changed. Returns {info, code} or null.
export async function lookupFuzzy(code, get = fetch, maxTries = 14) {
  const first = await lookup(code, get);
  if (first) return { info: first, code };
  const m = (code || "").match(/^([A-Z0-9]+-[A-Z]{0,2})(\d+)$/);
  if (!m) return null;
  let tries = 0;
  for (let i = 0; i < m[2].length; i++) {
    for (const alt of LOOKALIKE[m[2][i]] || "") {
      if (++tries > maxTries) return null;
      const c = m[1] + m[2].slice(0, i) + alt + m[2].slice(i + 1);
      const info = await lookup(c, get);
      if (info) return { info, code: c };
    }
  }
  return null;
}

// ---- Passcode (8 digits bottom left) ----

export function parsePasscode(text) {
  const m = (text || "").replace(/[^0-9]/g, " ").match(/\b\d{8}\b/);
  return m ? m[0] : "";
}

// {name, image, sets:[{code, setName, rarity}]} or null
export async function lookupById(id, get = fetch) {
  const r = await get(API + "cardinfo.php?id=" + encodeURIComponent(id));
  if (!r.ok) return null;
  const card = ((await r.json()).data || [])[0];
  if (!card) return null;
  return {
    name: card.name, image: (card.card_images || [])[0]?.image_url_small || "",
    sets: (card.card_sets || []).map(s => ({ code: (s.set_code || "").toUpperCase(), setName: s.set_name || "", rarity: s.set_rarity || "" })),
  };
}

// Set code in the card's language: "SD6-EN008" + "DE" -> "SD6-DE008"
export function localCode(enCode, region) {
  const m = (enCode || "").match(/^([A-Z0-9]+)-([A-Z]{0,2})(\d+)$/);
  return m ? `${m[1]}-${region}${m[3]}` : enCode;
}

// Characters the text recognition mixes up cost less to swap.
const SIMILAR = ["0ODQUC", "1IL7T", "2Z", "5S", "8B3S", "6G", "9G"];
const subCost = (x, y) => x === y ? 0 : SIMILAR.some(g => g.includes(x) && g.includes(y)) ? 0.3 : 1;

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]));
  return d[a.length][b.length];
}

const REGIONS = ["DE", "G", "EN", "E", "FR", "F", "IT", "I", "SP", "S", "PT", "P", ""];

// Which of the card's printings matches the (possibly garbled) set-code
// texts best? texts: raw OCR strings like "SD6-DEOOS" or "SD6DEUUS".
// Returns {set, code, region, dist} or null when nothing is clearly closest.
export function bestPrinting(sets, texts) {
  const ts = texts.map(t => (t || "").toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(t => t.length >= 5);
  const scored = [];
  for (const s of sets) {
    const e = s.code.match(/^([A-Z0-9]+)-[A-Z]{0,2}(\d+)$/);
    if (!e) continue;
    let best = null;
    for (const region of REGIONS) {
      const cand = e[1] + region + e[2];
      for (const t of ts) {
        const dist = lev(t, cand);
        if (!best || dist < best.dist) best = { set: s, region, code: `${e[1]}-${region}${e[2]}`, dist };
      }
    }
    if (best) scored.push(best);
  }
  scored.sort((a, b) => a.dist - b.dist);
  const top = scored[0];
  if (!top || top.dist > 2.5) return null;
  const rival = scored.find(x => x.set.code !== top.set.code);
  if (rival && rival.dist - top.dist < 0.5) return null;
  return top;
}
