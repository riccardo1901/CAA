#!/usr/bin/env node
// M11 · Confronto prima/dopo delle schermate dell'interfaccia (fatte da tests/e2e/aspetto.spec.ts).
//
//   node scripts/confronto-ui.mjs m10 m11-0
//
// Legge aspetto/<prima>/ e aspetto/<dopo>/, confronta ogni coppia di immagini pixel per pixel e scrive in
// aspetto/confronto-<prima>-<dopo>/:
//   index.html                pagina con prima e dopo affiancati, schermo per schermo (si apre con doppio clic)
//   <schermo>/<stato>.png     le due immagini affiancate in un'unica immagine (prima a sinistra, dopo a destra)
// e stampa un riepilogo: quante schermate sono identiche e quante cambiano.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..", "aspetto");
const [prima, dopo] = process.argv.slice(2);
if (!prima || !dopo) {
  console.error("Uso: node scripts/confronto-ui.mjs <etichetta-prima> <etichetta-dopo>   (es. m10 m11-0)");
  process.exit(2);
}
for (const e of [prima, dopo]) {
  if (!existsSync(join(RADICE, e))) {
    console.error(`Manca aspetto/${e}: prima si fanno le schermate con  CAA_ASPETTO=${e} npx playwright test aspetto`);
    process.exit(2);
  }
}
const OUT = join(RADICE, `confronto-${prima}-${dopo}`);
mkdirSync(OUT, { recursive: true });

const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : []);
const schermi = [...new Set([...readdirSync(join(RADICE, prima)), ...readdirSync(join(RADICE, dopo))])].sort((a, b) => parseInt(a) - parseInt(b));

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Differenze di colore fino a RUMORE (su 255) sono rumore del browser: due giri dello stesso codice le danno già
 *  (per esempio un indicatore ridisegnato ogni 300 ms). Non si vedono. Il foglio ha la sua prova a tolleranza zero
 *  (tests/e2e/foglio.spec.ts); questa pagina serve a vedere l'interfaccia. */
const RUMORE = 2;

/** Quanti pixel cambiano davvero e quanti solo di rumore (null se le misure sono diverse). */
async function diff(a, b) {
  const A = await raw(a);
  const B = await raw(b);
  if (A.w !== B.w || A.h !== B.h) return { diversi: null, rumore: 0, totale: B.w * B.h, misure: `${A.w}×${A.h} → ${B.w}×${B.h}` };
  let n = 0;
  let r = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > RUMORE) n++;
    else if (d > 0) r++;
  }
  return { diversi: n, rumore: r, totale: A.w * A.h, misure: `${A.w}×${A.h}` };
}

/** Le due immagini affiancate, con una striscia di separazione. */
async function affianca(a, b, out) {
  const A = await sharp(a).metadata();
  const B = await sharp(b).metadata();
  const gap = 24;
  await sharp({ create: { width: A.width + B.width + gap, height: Math.max(A.height, B.height), channels: 3, background: "#1c1c1a" } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: A.width + gap, top: 0 }])
    .png()
    .toFile(out);
}

const righe = [];
let identiche = 0;
let soloRumore = 0;
let cambiate = 0;
let mancanti = 0;
for (const s of schermi) {
  const da = join(RADICE, prima, s);
  const a = join(RADICE, dopo, s);
  mkdirSync(join(OUT, s), { recursive: true });
  for (const f of [...new Set([...pngs(da), ...pngs(a)])].sort()) {
    const pa = join(da, f);
    const pb = join(a, f);
    if (!existsSync(pa) || !existsSync(pb)) {
      mancanti++;
      righe.push({ s, f, stato: existsSync(pa) ? "solo prima" : "solo dopo" });
      continue;
    }
    const d = await diff(pa, pb);
    await affianca(pa, pb, join(OUT, s, f));
    const uguale = d.diversi === 0;
    if (uguale && d.rumore === 0) identiche++;
    else if (uguale) soloRumore++;
    else cambiate++;
    const quota = d.diversi === null ? "misure diverse" : `${d.diversi} pixel, ${((100 * d.diversi) / d.totale).toFixed(2)}%`;
    const stato = !uguale ? `cambia (${quota})` : d.rumore ? `uguale (solo rumore: ${d.rumore} pixel di 1–${RUMORE} punti su 255)` : "identica al pixel";
    righe.push({ s, f, stato, uguale, misure: d.misure });
  }
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sezioni = schermi
  .map((s) => {
    const card = righe
      .filter((r) => r.s === s)
      .map(
        (r) => `
      <figure class="${r.uguale ? "same" : "diff"}">
        <figcaption><strong>${esc(r.f.replace(/\.png$/, ""))}</strong> <span class="tag">${esc(r.stato)}</span></figcaption>
        <div class="pair">
          <a href="../${esc(prima)}/${esc(s)}/${esc(r.f)}"><img loading="lazy" src="../${esc(prima)}/${esc(s)}/${esc(r.f)}" alt="prima"></a>
          <a href="../${esc(dopo)}/${esc(s)}/${esc(r.f)}"><img loading="lazy" src="../${esc(dopo)}/${esc(s)}/${esc(r.f)}" alt="dopo"></a>
        </div>
      </figure>`,
      )
      .join("");
    return `<section><h2>Schermo ${esc(s.replace(/-(\d+)$/, " al $1%"))}</h2><p class="legend"><span>Prima: ${esc(prima)}</span><span>Dopo: ${esc(dopo)}</span></p>${card}</section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confronto ${esc(prima)} → ${esc(dopo)}</title>
<style>
  :root { --bg: #f6f5f1; --fg: #1c1c1a; --muted: #5c5b55; --ok: #1e6b3a; --okbg: #e6f4ea; --warn: #7a4100; --warnbg: #fff3d1; --line: #dfddd5; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px clamp(16px, 3vw, 40px) 48px; background: var(--bg); color: var(--fg); font: 15px/1.45 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .summary { color: var(--muted); margin: 0 0 24px; }
  h2 { font-size: 1.15rem; margin: 32px 0 4px; padding-top: 16px; border-top: 1px solid var(--line); }
  .legend { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; color: var(--muted); margin: 0 0 8px; }
  figure { margin: 0 0 20px; }
  figcaption { margin: 0 0 6px; }
  .tag { display: inline-block; padding: 0 8px; border-radius: 999px; font-size: 0.85em; background: var(--warnbg); color: var(--warn); }
  .same .tag { background: var(--okbg); color: var(--ok); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .pair img { width: 100%; height: auto; display: block; border: 1px solid var(--line); background: #fff; }
  @media (max-width: 700px) { .pair, .legend { grid-template-columns: 1fr; } }
</style></head>
<body>
<h1>Interfaccia: ${esc(prima)} → ${esc(dopo)}</h1>
<p class="summary">${identiche} schermate identiche al pixel, ${soloRumore} uguali con solo rumore del browser (differenze di colore fino a ${RUMORE} su 255, invisibili), ${cambiate} cambiate${mancanti ? `, ${mancanti} presenti da una parte sola` : ""}. Clic su un'immagine per vederla a grandezza piena.</p>
${sezioni}
</body></html>
`;
writeFileSync(join(OUT, "index.html"), html);

console.log(`Confronto ${prima} → ${dopo}: ${identiche} identiche al pixel, ${soloRumore} con solo rumore (≤ ${RUMORE}/255), ${cambiate} cambiate${mancanti ? `, ${mancanti} da una parte sola` : ""}.`);
for (const r of righe) if (!r.uguale) console.log(`  ${r.s}/${r.f}: ${r.stato}`);
console.log(`Pagina: ${join(OUT, "index.html")}`);
