// Saved cards, kept in the phone's browser storage (IndexedDB).
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open("kartenwert", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("karten", { keyPath: "id" });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function tx(mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction("karten", mode), req = fn(t.objectStore("karten"));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}

export const all = async () => ((await tx("readonly", s => s.getAll())) || []).sort((a, b) => b.time - a.time);
export const get = id => tx("readonly", s => s.get(id));
export const put = rec => tx("readwrite", s => s.put(rec));
export const del = id => tx("readwrite", s => s.delete(id));
