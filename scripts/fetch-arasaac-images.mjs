// Scarica i pittogrammi ARASAAC a 500 px e li converte in WebP.
// Uscita: data/raw/arasaac/images/<id>.webp (fuori da git) + images_failed.json.
// Riprendibile: salta i file già presenti. Uso: node scripts/fetch-arasaac-images.mjs [--limit N]
import { readFile, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ARASAAC_DIR, IMAGES_DIR, URLS, ensureDir, fetchBuffer, sleep } from "./lib.mjs";

const RES = 500;
const CONCURRENCY = 4;
const PAUSE_MS = 100; // pausa fra una richiesta e la successiva, per cortesia verso il server
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const all = JSON.parse(await readFile(path.join(ARASAAC_DIR, "all_it.json"), "utf8"));
const ids = all.map((p) => p._id).slice(0, limit);
await ensureDir(IMAGES_DIR);

const exists = (f) => access(f).then(() => true, () => false);
const failed = [];
let done = 0, skipped = 0, missing = 0;
let next = 0;

async function worker() {
  while (next < ids.length) {
    const id = ids[next++];
    const out = path.join(IMAGES_DIR, `${id}.webp`);
    if (await exists(out)) { skipped++; continue; }
    try {
      const { status, buf } = await fetchBuffer(URLS.image(id, RES));
      if (status === 404) { missing++; failed.push({ id, reason: "404" }); continue; }
      const webp = await sharp(buf).resize(RES, RES, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      await writeFile(out + ".tmp", webp);
      await rename(out + ".tmp", out); // scrittura atomica: nessun file a metà
      done++;
    } catch (e) {
      failed.push({ id, reason: String(e.message ?? e) });
    }
    if ((done + skipped + missing + failed.length) % 500 === 0) {
      console.log(`  ${done + skipped + missing + failed.length}/${ids.length}`);
    }
    await sleep(PAUSE_MS);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await writeFile(path.join(ARASAAC_DIR, "images_failed.json"), JSON.stringify(failed, null, 1));
console.log(`Immagini: ${done} scaricate, ${skipped} già presenti, ${missing} inesistenti (404), ${failed.length - missing} errori`);
if (failed.length) console.log("Elenco in data/raw/arasaac/images_failed.json: rilancia lo script per riprovare.");
