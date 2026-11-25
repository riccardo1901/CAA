// Stampa (M10): le impostazioni si traducono in classi, variabili CSS e una regola `@page` generata; il foglio
// dell'editor è lo stesso che si stampa (le regole `@media print` stanno in style.css). L'attribuzione ARASAAC nel
// piè di pagina c'è sempre e non dipende da nessuna impostazione.
import type { EditorView } from "prosemirror-view";
import { setOneLine } from "../editor/printLines";
import type { PrintPrefs } from "../docs/prefs";

export const ATTRIBUTION =
  "Pittogrammi: Sergio Palao per ARASAAC (arasaac.org), proprietà del Governo d'Aragona, licenza CC BY-NC-SA.";

export interface PrintMeta {
  title: string;
  author: string;
}

/** Spazio sotto il testo per il piè di pagina (mm): il margine in fondo alla pagina lo include. */
export const FOOTER_MM = 9;

/** Un a capo dentro un `content:` di CSS. */
const CSS_NEWLINE = '"\\A "';

let pageStyle: HTMLStyleElement | null = null;

/** Un testo dentro una stringa CSS: barre, virgolette e a capo non devono poter uscire dalla stringa. */
export function cssString(t: string): string {
  return `"${t.replace(/[\\"]/g, "\\$&").replace(/[\r\n\u2028\u2029]+/g, " ")}"`;
}

/** Il piè di pagina: sempre l'attribuzione; titolo, autore e numero di pagina se richiesti. Sono righe di testo. */
export function footerLines(p: PrintPrefs, meta: PrintMeta): { meta: string; pageNumber: boolean; attribution: string } {
  const parts: string[] = [];
  if (p.footerTitle && meta.title.trim()) parts.push(meta.title.trim());
  if (p.footerAuthor && meta.author.trim()) parts.push(meta.author.trim());
  return { meta: parts.join(" · "), pageNumber: p.footerPage, attribution: ATTRIBUTION };
}

/** La regola `@page`: formato A4, orientamento, margini (sotto, in più, lo spazio del piè di pagina) e il piè di
 *  pagina stesso, scritto nel riquadro del margine: così si ripete su ogni pagina. L'attribuzione è fissa. */
export function pageRule(p: PrintPrefs, meta: PrintMeta = { title: "", author: "" }): string {
  const m = p.margin;
  const f = footerLines(p, meta);
  const first: string[] = [];
  if (f.meta) first.push(cssString(f.meta));
  if (f.pageNumber) first.push(cssString(f.meta ? " · pag. " : "pag. "), "counter(page)");
  const content = (first.length ? [...first, CSS_NEWLINE] : []).concat(cssString(f.attribution)).join(" ");
  return (
    `@page { size: A4 ${p.orientation}; margin: ${m}mm ${m}mm ${m + FOOTER_MM}mm ${m}mm; ` +
    `@bottom-center { content: ${content}; white-space: pre; text-align: center; vertical-align: bottom; ` +
    `padding-bottom: 3mm; font: 7.5pt "Segoe UI", system-ui, sans-serif; color: #666; } }`
  );
}

/** Applica le impostazioni alla pagina (anche sullo schermo: font, maiuscolo, testo sopra e bordo si vedono subito). */
export function applyPrintPrefs(p: PrintPrefs, meta: PrintMeta): void {
  if (!pageStyle) {
    pageStyle = document.createElement("style");
    pageStyle.id = "caa-page";
    document.head.append(pageStyle);
  }
  const root = document.documentElement;
  for (const f of ["system", "atkinson", "lexend"]) root.classList.toggle(`pf-${f}`, p.font === f);
  root.classList.toggle("p-above", p.textAbove);
  root.classList.toggle("p-border", p.border);
  root.classList.toggle("p-upper", p.uppercase);
  root.classList.toggle("p-oneper", p.onePerLine);
  root.classList.toggle("p-landscape", p.orientation === "landscape");
  root.style.setProperty("--p-margin", `${p.margin}mm`);
  pageStyle.textContent = pageRule(p, meta);
}

/** Il motore di pagine del programma sa scrivere il piè di pagina nel margine (Chromium 131 o più recente)? */
export function footerSupported(ua: string = navigator.userAgent): boolean {
  const m = /Chrom(?:e|ium)\/(\d+)/.exec(ua) ?? /Edg\/(\d+)/.exec(ua);
  return m === null ? true : Number(m[1]) >= 131;
}

/** Stampa: si accende «una frase per riga» (se richiesto), si aspetta che la pagina si ridisegni, si apre il dialogo di
 *  sistema e, alla fine, si rimette tutto com'era. */
export async function printNow(view: EditorView, p: PrintPrefs): Promise<void> {
  const restore = (): void => setOneLine(view, false);
  window.addEventListener("afterprint", restore, { once: true });
  setOneLine(view, p.onePerLine);
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  try {
    window.print();
  } finally {
    // Su alcuni sistemi `print()` torna subito, su altri solo a stampa finita: in ogni caso, senza l'evento, si ripristina.
    window.setTimeout(restore, 1500);
  }
}
