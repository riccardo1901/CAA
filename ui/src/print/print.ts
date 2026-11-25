// Stampa (M10): le impostazioni si traducono in classi, variabili CSS e una regola `@page` generata; il foglio
// dell'editor è lo stesso che si stampa (le regole `@media print` stanno in css/sheet.css). L'attribuzione ARASAAC nel
// piè di pagina c'è sempre e non dipende da nessuna impostazione.
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
  return `"${t.replace(/[\\"]/g, "\\$&").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")}"`;
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
    `@bottom-center { content: ${content}; white-space: pre; text-align: center; vertical-align: top; ` +
    `padding-top: 2.5mm; font: 7.5pt "Segoe UI", system-ui, sans-serif; color: #666; } }`
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
  // Motore vecchio: l'attribuzione va in fondo al testo (altrimenti non comparirebbe).
  const noFooter = !footerSupported();
  root.classList.toggle("p-nofooter", noFooter);
  if (noFooter) ensureFlowAttribution();
  pageStyle.textContent = pageRule(p, meta);
}

/** Il motore di pagine sa scrivere il piè di pagina nel margine (Chromium 131+, che ha la regola dei riquadri)? */
export function footerSupported(): boolean {
  return typeof (window as unknown as { CSSMarginRule?: unknown }).CSSMarginRule !== "undefined";
}

/** L'attribuzione in fondo al testo: serve solo se il motore non scrive il piè di pagina nel margine (si vede solo in stampa). */
function ensureFlowAttribution(): void {
  const sheet = document.querySelector(".sheet");
  if (!sheet || sheet.querySelector(".print-attr-flow")) return;
  const d = document.createElement("div");
  d.className = "print-attr-flow";
  d.textContent = ATTRIBUTION;
  sheet.append(d);
}

/** Stampa: si apre il dialogo di sistema. (Gli a capo di «una frase per riga» ci sono già nella pagina e si vedono solo in stampa.) */
export function printNow(): void {
  window.print();
}
