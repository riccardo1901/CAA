// Scarica i treebank italiani di Universal Dependencies usati per le statistiche del tagger (M5):
// ISDT (CC BY-NC-SA 3.0) e MarkIT (CC BY 4.0), dalla versione fissa r2.17, con licenza e README.
// Uscita: data/raw/treebank/<isdt|markit>/ (fuori da git). Riprendibile: salta i file già presenti.
import { access, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { RAW, ensureDir, fetchBuffer } from "./lib.mjs";

const TAG = "r2.17";
const CORPORA = {
  isdt: { repo: "UD_Italian-ISDT", prefix: "it_isdt-ud", license: "LICENSE.txt" },
  markit: { repo: "UD_Italian-MarkIT", prefix: "it_markit-ud", license: "LICENSE.txt" },
};
const exists = (f) => access(f).then(() => true, () => false);

for (const [name, c] of Object.entries(CORPORA)) {
  const dir = path.join(RAW, "treebank", name);
  await ensureDir(dir);
  const files = [`${c.prefix}-train.conllu`, `${c.prefix}-dev.conllu`, `${c.prefix}-test.conllu`, c.license, "README.md"];
  for (const f of files) {
    const out = path.join(dir, f);
    if (await exists(out)) continue;
    const url = `https://raw.githubusercontent.com/UniversalDependencies/${c.repo}/${TAG}/${f}`;
    const { status, buf } = await fetchBuffer(url);
    if (status === 404) {
      console.log(`  ${name}/${f}: non esiste nella versione ${TAG}`);
      continue;
    }
    await writeFile(out + ".tmp", buf);
    await rename(out + ".tmp", out);
    console.log(`  ${name}/${f}: ${buf.length} byte`);
  }
}
console.log(`Treebank scaricati (versione ${TAG}) in data/raw/treebank/`);
