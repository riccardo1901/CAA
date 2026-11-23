// Funzioni condivise dagli script di acquisizione dati (M1).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RAW = path.join(ROOT, "data", "raw");
export const ARASAAC_DIR = path.join(RAW, "arasaac");
export const MORPHIT_DIR = path.join(RAW, "morphit");
export const IMAGES_DIR = path.join(ARASAAC_DIR, "images");

export const URLS = {
  keywords: "https://api.arasaac.org/v1/pictograms/all/it",
  image: (id, res) => `https://static.arasaac.org/pictograms/${id}/${id}_${res}.png`,
  morphit: "https://docs.sslmit.unibo.it/lib/exe/fetch.php?media=resources:morph-it.tgz",
};

export const ensureDir = (d) => mkdir(d, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch con nuovi tentativi (attesa crescente). Non ritenta gli errori 404.
 *  Alcuni server rispondono a tratti con errori temporanei (es. 402): si riprova. */
export async function fetchBuffer(url, { retries = 8, timeoutMs = 60000 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) return { status: 404, buf: null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      last = e;
      await sleep(Math.min(500 * 2 ** i, 30000)); // attesa crescente, al massimo 30 s
    }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}
