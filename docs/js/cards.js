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
const LOOKALIKE = { 0: "689", 6: "058", 8: "0369", 9: "08", 5: "63", 3: "85", 1: "7", 7: "1", 2: "7" };

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
