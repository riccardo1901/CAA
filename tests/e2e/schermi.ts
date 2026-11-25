// Aiuti comuni alle prove degli schermi (schermi.spec.ts) e alle schermate prima/dopo (aspetto.spec.ts) di M11.
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { open } from "./fixtures";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Uno schermo della scuola: risoluzione vera del monitor e «ridimensionamento» di Windows. Il programma vede
 *  uno schermo di (larghezza / scala) × (altezza / scala) punti, disegnati con `scala` pixel per punto. */
export interface Schermo {
  nome: string;
  larghezza: number;
  altezza: number;
  scala: number;
  /** Le misure che vede il programma (pixel CSS). */
  css: { width: number; height: number };
}

const RISOLUZIONI: Array<[number, number]> = [
  [1024, 600], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440], [3840, 2160],
];
const SCALE = [1, 1.25, 1.5, 2];
/** Sotto questa misura (in punti) il programma non deve funzionare: è il minimo dichiarato in PIANO-M11.md. */
const MINIMO = { width: 1024, height: 600 };

const schermo = (w: number, h: number, s: number): Schermo => ({
  nome: `${w}x${h} al ${Math.round(s * 100)}%`,
  larghezza: w,
  altezza: h,
  scala: s,
  css: { width: Math.round(w / s), height: Math.round(h / s) },
});

/** Tutte le combinazioni risoluzione × scala che danno almeno 1024×600 punti (le altre Windows non le permette o
 *  sono sotto il minimo dichiarato): 19 schermi, dal portatile piccolo al monitor 4K. */
export const SCHERMI: Schermo[] = RISOLUZIONI.flatMap(([w, h]) => SCALE.map((s) => schermo(w, h, s))).filter(
  (x) => x.css.width >= MINIMO.width && x.css.height >= MINIMO.height,
);

/** I quattro schermi delle schermate di confronto: piccolo, portatile comune, portatile Full HD al 150%, grande. */
export const SCHERMI_CONFRONTO: Schermo[] = [schermo(1024, 600, 1), schermo(1366, 768, 1), schermo(1920, 1080, 1.5), schermo(2560, 1440, 1)];

/** Carattere fisso per le prove che misurano l'interfaccia (a capo, una riga, larghezze). Il programma usa «Segoe
 *  UI», che c'è solo su Windows: altrove il browser prende un altro carattere (qui Inter, nella CI un altro ancora) e le
 *  misure cambierebbero da una macchina all'altra. Nelle prove «Segoe UI» diventa Atkinson Hyperlegible (già nel
 *  progetto, licenza SIL OFL): così la prova dà lo stesso risultato su ogni macchina. Non ha le misure esatte di Segoe
 *  UI: la resa vera su Windows si controlla a mano (prove su Windows di ogni blocco). Il programma non cambia. */
export async function caratteriFissi(page: Page): Promise<void> {
  const req = createRequire(import.meta.url);
  const file = (peso: number, parte: string) =>
    readFileSync(req.resolve(`@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-${parte}-${peso}-normal.woff2`)).toString("base64");
  const facce = ["Segoe UI", "Segoe UI Variable Text", "Segoe UI Variable Display"]
    .flatMap((nome) =>
      [400, 700].flatMap((peso) =>
        [
          ["latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
          ["latin-ext", "U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"],
        ].map(([parte, range]) => `@font-face { font-family: "${nome}"; font-weight: ${peso}; src: url(data:font/woff2;base64,${file(peso, parte)}) format("woff2"); unicode-range: ${range}; }`),
      ),
    )
    .join("\n");
  await page.addInitScript((css) => {
    const add = () => {
      const st = document.createElement("style");
      st.id = "caratteri-fissi-prove";
      st.textContent = css;
      document.head.append(st);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, facce);
}

export const STORIA = [
  "La gita al mare",
  "Marco è andato al mare con la mamma. Il gatto dorme la sera. Anna legge un libro sotto l'ombrellone.",
  "I ferri sono caldi. Domani andremo in città, perché siamo andati alla scuola media. Ho un dubbio sul pranzo.",
  "Luca va a scuola con il suo amico. La maestra scrive alla lavagna. I bambini giocano in cortile.",
].join("\n");

export const LIB_ENTRIES = [
  { file: "citta.caa", id: "id-1", title: "La città di Marco", author: "Maria Rossi", subject: "Italiano", level: "Primaria", tags: ["storia", "sociale"], created: "2026-11-01T10:00:00Z", modified: "2026-11-20T10:00:00Z", rev: 3, size: 1000, conflict: false },
  { file: "frazioni.caa", id: "id-2", title: "Le frazioni", author: "Luca Bianchi", subject: "Matematica", level: "Secondaria", tags: ["numeri"], created: "2026-10-01T10:00:00Z", modified: "2026-10-05T10:00:00Z", rev: 3, size: 800, conflict: false },
  { file: "regole.caa", id: "id-3", title: "Regole della classe", author: "Maria Rossi", subject: "italiano", level: "primaria", tags: [], created: "2026-09-01T10:00:00Z", modified: "2026-09-02T10:00:00Z", rev: 2, size: 900, conflict: true },
];

export const BIBLIOTECA = { configured: true, path: "G:/Drive condivisi/CAA Istituto/CAA", name: "Maria Rossi", entries: LIB_ENTRIES };

/** Il programma come lo vede il docente: archivio dei documenti, biblioteca collegata, un testo con simboli. */
export async function apriCompleto(page: Page, lib: Record<string, unknown> = BIBLIOTECA, testo = STORIA): Promise<void> {
  await open(page, "", true, lib);
  // Se le prove usano il carattere fisso, che sia davvero caricato prima di misurare qualcosa.
  await page.evaluate(async () => {
    if (!document.getElementById("caratteri-fissi-prove")) return;
    await Promise.all(["400 15px \"Segoe UI\"", "700 15px \"Segoe UI\""].map((f) => document.fonts.load(f, "Aa")));
    if (!document.fonts.check("400 15px \"Segoe UI\"", "Aa")) throw new Error("il carattere fisso delle prove non si è caricato");
    await document.fonts.ready;
  });
  if (testo) {
    await page.evaluate((t) => {
      const p = (window as any).caaProto;
      const s = p.view.state.schema;
      const righe = t.split("\n");
      const content = righe.map((r: string, i: number) => (i === 0 ? s.nodes.heading.create({ level: 1 }, s.text(r)) : s.nodes.paragraph.create(null, s.text(r))));
      p.view.dispatch(p.view.state.tr.replaceWith(0, p.view.state.doc.content.size, content));
    }, testo);
    await page.waitForSelector(".w[style*='--img']");
  }
  await attendi(page);
}

export async function attendi(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).caaProto.engineStats().pending === 0);
  await page.waitForTimeout(150);
}

/** Alcuni documenti personali nell'archivio finto. */
export async function documentiSalvati(page: Page): Promise<void> {
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const s = p.view.state.schema;
    const mk = (file: string, title: string, minuti: number, origin: unknown = null, published?: number) => {
      const d = s.nodes.doc.create(null, [s.nodes.paragraph.create(null, s.text(title))]);
      const entry = { file, id: "id-" + file, title, modified: new Date(Date.UTC(2026, 10, 24, 9, minuti)).toISOString(), rev: 1, author: "Maria Rossi", origin, published_rev: published };
      (window as any).__mock.docsStore.set(file, { entry, payload: { document: d.toJSON(), prefs: {}, render: [], sense_locks: [], lexicon: "lex-new" } });
    };
    mk("Il gatto Pepe.caa", "La storia del gatto Pepe", 40);
    mk("Le frazioni.caa", "Le frazioni", 30, { id: "id-2", rev: 3 });
    mk("Regole.caa", "Regole della classe", 20, null, 2);
    mk("Mensa.caa", "In mensa", 10);
  });
}

/** Il caso peggiore reale per l'altezza degli avvisi sopra il foglio: lessico nuovo e originale aggiornato insieme,
 *  più l'avviso della versione nuova. (L'avviso «salvato come copia» non si somma: aprendo un documento sparisce, e
 *  un salvataggio come copia toglie la barra del lessico.) */
export async function tuttiGliAvvisi(page: Page): Promise<void> {
  await apriCompleto(page, { ...BIBLIOTECA, entries: [{ ...LIB_ENTRIES[1], rev: 3 }], version: { version: "0.2.0", notes: "Correzioni" } }, "");
  await page.evaluate(() => {
    const p = (window as any).caaProto;
    const s = p.view.state.schema;
    const d = s.nodes.doc.create(null, [s.nodes.paragraph.create(null, s.text("Marco mangia pane"))]);
    const render = [{ i: 0, text: "Marco mangia pane", tokens: [[0, 5, 768, "full", 0], [6, 12, 5001, "full", 0], [13, 17, 5002, "full", 0]] }];
    (window as any).__mock.docsStore.set("Copia.caa", {
      entry: { file: "Copia.caa", id: "copy-1", title: "Le frazioni", modified: new Date().toISOString(), rev: 1, author: "Maria Rossi", origin: { id: "id-2", rev: 1 } },
      payload: { document: d.toJSON(), prefs: {}, render, sense_locks: [], lexicon: "lex-old" },
    });
  });
  // Una copia adattata, salvata con un lessico vecchio, il cui originale è andato avanti in biblioteca.
  await page.getByRole("button", { name: "Documenti" }).click();
  await page.locator(".docs-row", { hasText: "Le frazioni" }).getByRole("button", { name: "Apri" }).click();
  await page.locator(".lexbar").waitFor({ state: "visible" });
  await page.locator(".origbar").waitFor({ state: "visible" });
  // La versione nuova è una voce del menu «Altro» (M11-4): si vede il pallino sul pulsante.
  await page.locator(".menu-dot").waitFor({ state: "visible" });
  await attendi(page);
}
