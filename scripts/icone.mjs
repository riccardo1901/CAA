#!/usr/bin/env node
// M11-2 · Genera ui/src/ui/icons.ts con i disegni delle icone che servono all'interfaccia, presi dal set Lucide
// (licenza ISC). Lucide non è una dipendenza del programma: i disegni finiscono scritti dentro icons.ts.
//
//   cd /tmp && npm pack lucide-static && tar xzf lucide-static-*.tgz      # una volta, in una cartella qualsiasi
//   node scripts/icone.mjs /tmp/package                                    # rigenera ui/src/ui/icons.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pacchetto = process.argv[2];
if (!pacchetto) {
  console.error("Uso: node scripts/icone.mjs <cartella del pacchetto lucide-static>");
  process.exit(2);
}
const nodi = JSON.parse(readFileSync(join(pacchetto, "icon-nodes.json"), "utf8"));
const versione = JSON.parse(readFileSync(join(pacchetto, "package.json"), "utf8")).version;

/** Nome nel programma → nome in Lucide. */
const ICONE = {
  documenti: "folder",
  nuovo: "file-plus",
  esempio: "file-text",
  annulla: "undo-2",
  ripeti: "redo-2",
  unisci: "link",
  dividi: "unlink",
  stampa: "printer",
  info: "info",
  biblioteca: "cloud",
  bibliotecaOff: "cloud-off",
  apri: "folder-open",
  pubblica: "upload",
  elimina: "trash",
  aggiorna: "refresh-cw",
  adatta: "copy",
  ritira: "archive",
  chiudi: "x",
  cerca: "search",
  immagine: "image-plus",
  scuola: "school",
  nessuno: "ban",
  soloTesto: "type",
  automatico: "wand-sparkles",
  dimentica: "eraser",
  avviso: "triangle-exclamation-point",
  invia: "send",
  cartella: "folder-search",
  ok: "check",
  altro: "ellipsis",
  apriPannello: "panel-right-open",
  chiudiPannello: "panel-right-close",
  bandierina: "flag",
  indietro: "arrow-left",
};

const mancano = Object.entries(ICONE).filter(([, v]) => !nodi[v]);
if (mancano.length) {
  console.error("Icone che non ci sono in questa versione di Lucide:", mancano.map(([k, v]) => `${k} (${v})`).join(", "));
  process.exit(1);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const disegno = (nome) =>
  nodi[nome].map(([tag, attr]) => `<${tag} ${Object.entries(attr).filter(([a]) => a !== "key").map(([a, b]) => `${a}="${esc(b)}"`).join(" ")}/>`).join("");

const righe = Object.entries(ICONE).map(([k, v]) => `  ${k}: '${disegno(v)}', // lucide: ${v}`).join("\n");

const ts = `// Icone dell'interfaccia (M11-2). GENERATO da scripts/icone.mjs: non modificare a mano.
// Disegni del set Lucide ${versione} (https://lucide.dev), licenza ISC, citata nella schermata Informazioni. Solo quelle che
// servono, scritte qui dentro: niente da scaricare. Griglia 24×24, tratto 1,75, colore del testo.
//
// ISC License. Copyright (c) Lucide Icons and Contributors. Permission to use, copy, modify, and/or distribute this
// software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this
// permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.

/** Nome dell'icona nel programma → disegno (elementi SVG). */
const DISEGNI = {
${righe}
} as const;

export type NomeIcona = keyof typeof DISEGNI;

const SVG = "http://www.w3.org/2000/svg";

/** Un'icona come elemento SVG, nascosta ai lettori di schermo (il nome lo dà il testo o l'aria-label del pulsante). */
export function icona(nome: NomeIcona): SVGSVGElement {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.75");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.classList.add("ico");
  s.innerHTML = DISEGNI[nome];
  return s;
}

/** Mette l'icona davanti al testo; il testo va in uno <span class="lbl"> (per cambiarlo si usa etichetta()). */
export function conIcona<T extends HTMLElement>(el: T, nome: NomeIcona): T {
  const testo = el.textContent ?? "";
  el.textContent = "";
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = testo;
  el.append(icona(nome), lbl);
  return el;
}

/** Pulsante solo icona: il nome per i lettori di schermo (e per le prove) è obbligatorio. */
export function soloIcona<T extends HTMLElement>(el: T, nome: NomeIcona, nomeAccessibile: string): T {
  el.textContent = "";
  el.setAttribute("aria-label", nomeAccessibile);
  el.classList.add("icon-only");
  el.append(icona(nome));
  return el;
}

/** Cambia il testo di un pulsante con icona senza togliere l'icona. */
export function etichetta(el: HTMLElement, testo: string): void {
  const lbl = el.querySelector<HTMLElement>(":scope > .lbl");
  if (lbl) lbl.textContent = testo;
  else el.textContent = testo;
}
`;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "src", "ui", "icons.ts");
writeFileSync(out, ts);
console.log(`Scritte ${Object.keys(ICONE).length} icone (Lucide ${versione}) in ${out}`);
