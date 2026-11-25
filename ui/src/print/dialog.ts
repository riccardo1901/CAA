// La finestra «Stampa…» (M10): le impostazioni della pagina e il pulsante Stampa. Le scelte vanno nel documento.
import type { PrintPrefs } from "../docs/prefs";
import { footerSupported } from "./print";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface PrintDialogDeps {
  get(): PrintPrefs;
  /** Le impostazioni sono cambiate (si applicano alla pagina e si salvano con il documento). */
  set(p: PrintPrefs): void;
  print(): void;
}

/** Apre la finestra; restituisce la funzione che la chiude. */
export function openPrintDialog(deps: PrintDialogDeps): () => void {
  const overlay = el("div", "print-overlay");
  const dialog = el("div", "print-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Stampa");
  let p = deps.get();
  const update = (patch: Partial<PrintPrefs>): void => {
    p = { ...p, ...patch };
    deps.set(p);
  };

  const row = (label: string, control: HTMLElement): HTMLElement => {
    const r = el("label", "print-row");
    r.append(el("span", "", label), control);
    return r;
  };
  const select = <T extends string>(label: string, aria: string, options: Array<[T, string]>, value: T, on: (v: T) => void): HTMLElement => {
    const s = el("select");
    s.setAttribute("aria-label", aria);
    for (const [v, t] of options) {
      const o = el("option", "", t);
      o.value = v;
      s.append(o);
    }
    s.value = value;
    s.addEventListener("change", () => on(s.value as T));
    return row(label, s);
  };
  const check = (label: string, value: boolean, on: (v: boolean) => void): HTMLElement => {
    const c = el("input");
    c.type = "checkbox";
    c.checked = value;
    c.addEventListener("change", () => on(c.checked));
    const l = el("label", "print-check");
    l.append(c, ` ${label}`);
    return l;
  };

  const margin = el("input");
  margin.type = "number";
  margin.min = "5";
  margin.max = "40";
  margin.step = "1";
  margin.value = String(p.margin);
  margin.setAttribute("aria-label", "Margini (mm)");
  margin.addEventListener("change", () => {
    const n = Math.min(40, Math.max(5, Math.round(Number(margin.value) || 15)));
    margin.value = String(n);
    update({ margin: n });
  });

  dialog.append(
    el("h2", "", "Stampa"),
    select("Foglio", "Orientamento", [["portrait", "A4 verticale"], ["landscape", "A4 orizzontale"]], p.orientation, (v) => update({ orientation: v })),
    row("Margini (mm)", margin),
    select("Testo", "Posizione del testo", [["below", "sotto il simbolo"], ["above", "sopra il simbolo"]], p.textAbove ? "above" : "below", (v) => update({ textAbove: v === "above" })),
    select("Carattere", "Carattere", [["system", "Normale"], ["atkinson", "Atkinson Hyperlegible"], ["lexend", "Lexend"]], p.font, (v) => update({ font: v })),
    check("Bordo attorno a ogni simbolo", p.border, (v) => update({ border: v })),
    check("Una frase per riga", p.onePerLine, (v) => update({ onePerLine: v })),
    check("Tutto maiuscolo (il testo scritto non cambia)", p.uppercase, (v) => update({ uppercase: v })),
    el("h3", "", "Piè di pagina"),
    el("p", "print-note", "L'attribuzione ARASAAC c'è sempre. In più puoi mettere:"),
    check("il titolo", p.footerTitle, (v) => update({ footerTitle: v })),
    check("l'autore", p.footerAuthor, (v) => update({ footerAuthor: v })),
    check("il numero di pagina", p.footerPage, (v) => update({ footerPage: v })),
    el("p", "print-note", "La dimensione dei simboli è quella dei pulsanti «Simboli» in alto: piccolo 12 mm, medio 18, grande 25, molto grande 40. Per salvare un PDF, nella finestra di stampa scegli la stampante «Microsoft Print to PDF»."),
  );
  if (!footerSupported()) {
    dialog.append(el("p", "print-note warn", "Il motore di pagine di questo computer è vecchio: l'attribuzione ARASAAC in fondo a ogni pagina potrebbe non comparire. Aggiorna WebView2 (o Edge) prima di stampare."));
  }
  const actions = el("div", "print-actions");
  const go = el("button", "", "Stampa");
  go.type = "button";
  const close = el("button", "", "Chiudi");
  close.type = "button";
  actions.append(go, close);
  dialog.append(actions);
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
  go.addEventListener("click", () => {
    // La finestra non deve comparire nella stampa: si toglie prima.
    finish();
    deps.print();
  });
  close.addEventListener("click", finish);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) finish();
  });
  go.focus();
  return finish;
}
