// «Informazioni» (M10): crediti e licenze. L'attribuzione ARASAAC è obbligatoria (licenza CC BY-NC-SA); lo stesso vale per
// i dati linguistici e per i caratteri inclusi nel programma.
import { ATTRIBUTION } from "./print/print";

declare const __APP_VERSION__: string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const CREDITS: Array<[string, string]> = [
  ["Pittogrammi", `${ATTRIBUTION} I pittogrammi non si possono usare a scopo commerciale.`],
  ["Lessico delle forme (Morph-it!)", "Morph-it!, Università di Bologna (Baroni e Zanchetta), licenza CC BY-SA 2.0 / LGPL."],
  ["Disambiguazione (treebank ISDT)", "Italian Stanford Dependency Treebank (ISDT) di Universal Dependencies, licenza CC BY-NC-SA 3.0."],
  ["Caratteri", "Atkinson Hyperlegible (Braille Institute) e Lexend (Bonnie Shaver-Troup, Thomas Jockin, Santiago Orozco, Hector Gomez, Superunion): licenza SIL Open Font License 1.1."],
  ["Icone", "Lucide (lucide.dev, Lucide Icons and Contributors): licenza ISC."],
  ["Uso", "Programma gratuito e non commerciale, senza pubblicità. Funziona senza collegamento a Internet: i documenti e le correzioni restano sul tuo computer finché non scegli di pubblicarli o inviarli."],
];

/** Apre la finestra; restituisce la funzione che la chiude. */
export function openAbout(): () => void {
  const overlay = el("div", "about-overlay");
  const dialog = el("div", "about-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Informazioni");
  dialog.append(el("h2", "", "Editor CAA in simboli"));
  dialog.append(el("p", "about-version", `Versione ${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "di prova"}`));
  const dl = el("dl");
  for (const [k, v] of CREDITS) {
    dl.append(el("dt", "", k), el("dd", "", v));
  }
  const close = el("button", "", "Chiudi");
  close.type = "button";
  dialog.append(dl, close);
  overlay.append(dialog);
  document.body.append(overlay);
  const finish = (): void => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
  };
  document.addEventListener("keydown", onKey, true);
  close.addEventListener("click", finish);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) finish();
  });
  close.focus();
  return finish;
}
