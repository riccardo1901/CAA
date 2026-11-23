// Scarica le parole chiave italiane di tutti i pittogrammi ARASAAC.
// Uscita: data/raw/arasaac/all_it.json (fuori da git).
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ARASAAC_DIR, URLS, ensureDir, fetchBuffer } from "./lib.mjs";

await ensureDir(ARASAAC_DIR);
const { buf } = await fetchBuffer(URLS.keywords);
const data = JSON.parse(buf.toString("utf8"));
if (!Array.isArray(data) || data.length === 0) throw new Error("risposta ARASAAC inattesa");
await writeFile(path.join(ARASAAC_DIR, "all_it.json"), buf);
console.log(`Parole chiave ARASAAC: ${data.length} pittogrammi, ${buf.length} byte`);
