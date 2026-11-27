import test from "node:test";
import assert from "node:assert/strict";
import { parseSetCode, languageOf, englishCode, lookup, slug, cardmarketLinks } from "../docs/js/cards.js";
import { grade } from "../docs/js/grade.js";

test("set code from OCR text", () => {
  assert.equal(parseSetCode("PSV-DE092"), "PSV-DE092");
  assert.equal(parseSetCode(" psv - de092 \n"), "PSV-DE092");
  assert.equal(parseSetCode("xx PSV-DEO92 yy"), "PSV-DE092");   // O read instead of 0
  assert.equal(parseSetCode("LOB-G001"), "LOB-G001");
  assert.equal(parseSetCode("RA03–EN045"), "RA03-EN045");
  assert.equal(parseSetCode("MP23-DE123"), "MP23-DE123");
  assert.equal(parseSetCode("ATK 1800"), "");
});

test("language and English code", () => {
  assert.equal(languageOf("PSV-DE092"), "DE");
  assert.equal(languageOf("LOB-G001"), "DE");
  assert.equal(languageOf("RA03-EN045"), "EN");
  assert.equal(languageOf("SD8-JP016"), "JP");
  assert.equal(englishCode("LOB-G001"), "LOB-EN001");
});

test("database lookup", async () => {
  const get = async url => ({ ok: true, json: async () => url.includes("cardsetsinfo")
    ? { name: "Nobleman of Crossout", set_name: "Pharaoh's Servant", set_rarity: "Super Rare" }
    : { data: [{ card_images: [{ image_url_small: "https://img/x.jpg" }],
                 card_sets: [{ set_code: "PSV-EN092", set_rarity: "Super Rare" }, { set_code: "SDDE-EN001", set_rarity: "Common" }] }] } });
  assert.deepEqual(await lookup("PSV-DE092", get),
    { name: "Nobleman of Crossout", setName: "Pharaoh's Servant", rarities: ["Super Rare"], image: "https://img/x.jpg" });
  assert.equal(await lookup("", get), null);
});

test("Cardmarket links", () => {
  assert.equal(slug("Ash Blossom & Joyous Spring"), "Ash-Blossom-Joyous-Spring");
  const l = cardmarketLinks({ name: "Nobleman of Crossout", setName: "Pharaoh's Servant", language: "DE", condition: "EX", firstEd: true });
  assert.equal(l.product, "https://www.cardmarket.com/de/YuGiOh/Products/Singles/Pharaohs-Servant/Nobleman-of-Crossout?language=3&minCondition=3&sellerCountry=7&isFirstEd=Y");
  assert.equal(l.versions, "https://www.cardmarket.com/de/YuGiOh/Cards/Nobleman-of-Crossout/Versions");
});

const W = (o = {}) => ({ frac: { oben: 0, unten: 0, links: 0, rechts: 0, ol: 0, or: 0, ul: 0, ur: 0, ...o } });
const clean = { knick: "nein", biegung: "nein", kratzer: "keine", schaden: "nein" };

test("grading", () => {
  assert.equal(grade({ whitening: W() }, clean).condition, "MT");
  assert.equal(grade({ whitening: W({ oben: 0.004 }) }, clean).condition, "NM");
  assert.equal(grade({ whitening: W({ ul: 0.03 }) }, clean).condition, "EX");
  assert.equal(grade({ whitening: W({ ol: 0.02, or: 0.02, ul: 0.02 }) }, clean).condition, "GD");
  assert.equal(grade({ whitening: W() }, { ...clean, kratzer: "wenige" }).condition, "EX");
  assert.equal(grade({ whitening: W() }, { ...clean, knick: "leicht" }).condition, "LP");
  assert.equal(grade({ whitening: W() }, { ...clean, schaden: "ja" }).condition, "PO");
  const r = grade({ whitening: W({ rechts: 0.05 }) }, clean);
  assert.equal(r.condition, "GD");
  assert.ok(r.reasons.some(x => /rechten Kante/.test(x.why)));
});

test("misread digit is corrected through the database", async () => {
  const { lookupFuzzy } = await import("../docs/js/cards.js");
  const get = async url => ({ ok: true, json: async () => url.includes("cardsetsinfo")
    ? (url.endsWith("PSV-EN092") ? { name: "Nobleman of Crossout", set_name: "Pharaoh's Servant" } : { error: "not found" })
    : { data: [{ card_sets: [{ set_code: "PSV-EN092", set_rarity: "Super Rare" }] }] } });
  const r = await lookupFuzzy("PSV-DE692", get);
  assert.equal(r.code, "PSV-DE092");
  assert.equal(r.info.name, "Nobleman of Crossout");
  assert.equal(await lookupFuzzy("XXX-DE111", get), null);
});

import { parsePasscode, bestPrinting, localCode } from "../docs/js/cards.js";

test("passcode and printing from garbled set-code texts", () => {
  assert.equal(parsePasscode("72630549\n"), "72630549");
  assert.equal(parsePasscode("7263054"), "");
  const sets = [{ code: "SD6-EN008" }, { code: "DB2-EN092" }, { code: "DR1-EN204" }, { code: "SD6-EN018" }];
  // real OCR output from a photo of SD6-DE008
  const hit = bestPrinting(sets, ["SDDEOCOS\n", "SD6-DEUUS\n", "SD6DEOOS\n", "SD6-DEVUS\n"]);
  assert.equal(hit.code, "SD6-DE008");
  assert.equal(bestPrinting(sets, ["nothing"]), null);
  assert.equal(localCode("SD6-EN008", "DE"), "SD6-DE008");
});
