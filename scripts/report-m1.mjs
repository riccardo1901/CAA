// Rapporto di acquisizione dati (M1): conteggi, etichette Morph-it! distinte, categorie ARASAAC con esempi.
// Uscita: stampa a video e scrive data/raw/report/ (fuori da git).
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ARASAAC_DIR, IMAGES_DIR, MORPHIT_DIR, RAW, ensureDir } from "./lib.mjs";

const out = [];
const say = (s = "") => out.push(s);

// ---------- ARASAAC ----------
const all = JSON.parse(await readFile(path.join(ARASAAC_DIR, "all_it.json"), "utf8"));
const keywords = all.flatMap((p) => (p.keywords ?? []).map((k) => ({ id: p._id, ...k })));
const norm = (s) => s.trim();
const noKeyword = all.filter((p) => !(p.keywords ?? []).some((k) => norm(k.keyword))).length;
const multiword = keywords.filter((k) => /\s/.test(norm(k.keyword))).length;
const withPlural = keywords.filter((k) => k.plural && norm(k.plural)).length;
const imageFiles = new Set((await readdir(IMAGES_DIR).catch(() => [])).filter((f) => f.endsWith(".webp")));
const missingImages = all.filter((p) => !imageFiles.has(`${p._id}.webp`)).map((p) => p._id);
const failed = JSON.parse(await readFile(path.join(ARASAAC_DIR, "images_failed.json"), "utf8").catch(() => "[]"));

say("# Rapporto M1 — acquisizione dati");
say();
say("## ARASAAC");
say(`- pittogrammi: ${all.length}`);
say(`- pittogrammi senza parola chiave italiana: ${noKeyword}`);
say(`- parole chiave italiane (totale): ${keywords.length}`);
say(`- parole chiave multiparola: ${multiword}`);
say(`- parole chiave con plurale indicato: ${withPlural}`);
say(`- immagini WebP presenti: ${imageFiles.size} / ${all.length}`);
say(`- immagini mancanti: ${missingImages.length}${missingImages.length ? ` (primi id: ${missingImages.slice(0, 10).join(", ")})` : ""}`);
say(`- immagini fallite nell'ultimo scarico: ${failed.length}`);

// Categorie: esempi riproducibili (seme fisso), ordinati per id.
const byType = new Map();
for (const k of keywords) {
  const t = k.type ?? "nessuno";
  if (!byType.has(t)) byType.set(t, []);
  byType.get(t).push(k);
}
say();
say("### Categorie delle parole chiave (tipo → numero, esempi presi a passo regolare)");
for (const t of [...byType.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
  const list = byType.get(t).filter((k) => norm(k.keyword));
  const step = Math.max(1, Math.floor(list.length / 12));
  const ex = list.filter((_, i) => i % step === 0).slice(0, 12).map((k) => k.keyword.trim());
  say(`- tipo ${t}: ${list.length} — ${ex.join(" · ")}`);
}

// ---------- Morph-it! ----------
const text = await readFile(path.join(MORPHIT_DIR, "morph-it.utf8.txt"), "utf8");
const rows = text.split("\n").filter(Boolean).map((l) => l.split("\t"));
const bad = rows.filter((r) => r.length !== 3);
const good = rows.filter((r) => r.length === 3);
const labels = new Map();
for (const [, , tag] of good) labels.set(tag, (labels.get(tag) ?? 0) + 1);
const forms = new Set(good.map((r) => r[0]));
const lemmas = new Set(good.map((r) => r[1]));

say();
say("## Morph-it!");
say(`- righe: ${rows.length} (${bad.length} non nel formato forma<TAB>lemma<TAB>etichetta)`);
say(`- forme distinte: ${forms.size}`);
say(`- lemmi distinti: ${lemmas.size}`);
say(`- etichette distinte: ${labels.size} (elenco completo in data/raw/report/morphit_labels.tsv)`);

const family = new Map();
for (const [tag, n] of labels) {
  const f = tag.split(/[:+-]/)[0];
  family.set(f, (family.get(f) ?? 0) + n);
}
say();
say("### Famiglie di etichette (prefisso → righe)");
say([...family].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(" · "));
if (bad.length) {
  say();
  say("### Righe anomale (prime 10)");
  for (const r of bad.slice(0, 10)) say(`- ${JSON.stringify(r)}`);
}

// ---------- scrittura ----------
const dir = path.join(RAW, "report");
await ensureDir(dir);
await writeFile(
  path.join(dir, "morphit_labels.tsv"),
  [...labels].sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) => `${t}\t${n}`).join("\n") + "\n",
);
await writeFile(path.join(dir, "report-m1.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
