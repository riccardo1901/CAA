// Scarica Morph-it! e lo converte da ISO-8859-15 a UTF-8.
// Uscita: data/raw/morphit/morph-it.utf8.txt, readme e licenze (fuori da git).
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { MORPHIT_DIR, URLS, ensureDir } from "./lib.mjs";

await ensureDir(MORPHIT_DIR);
const tgz = path.join(MORPHIT_DIR, "morph-it.tgz");
// Il sito di Unibo risponde 402 a ogni User-Agent personalizzato (anche di Node) e
// accetta solo quello di curl: si scarica quindi con curl stesso, presente anche su Windows 10/11.
execFileSync("curl", ["-fsSL", "--retry", "5", "--retry-delay", "3", "-o", tgz, URLS.morphit]);

const extracted = path.join(MORPHIT_DIR, "extracted");
await ensureDir(extracted);
execFileSync("tar", ["-xzf", tgz, "-C", extracted]); // tar è presente anche su Windows 10/11

const dir = path.join(extracted, "current_version");
const files = await readdir(dir);
const lexicon = files.find((f) => /^morph-it_.*\.txt$/.test(f));
if (!lexicon) throw new Error("file del lessico non trovato nell'archivio");

const text = new TextDecoder("iso-8859-15").decode(await readFile(path.join(dir, lexicon)));
await writeFile(path.join(MORPHIT_DIR, "morph-it.utf8.txt"), text);
for (const f of ["readme-morph-it.txt", "lgpl.txt"]) {
  await copyFile(path.join(dir, f), path.join(MORPHIT_DIR, f)).catch(() => {});
}
console.log(`Morph-it!: ${lexicon}, ${text.split("\n").length - 1} righe, convertito in UTF-8`);
