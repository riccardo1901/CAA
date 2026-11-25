// La scheda «Pagina» del pannello laterale (M11-5, PIANO-M11.md 3.4 e 3.9 flusso A): le impostazioni di stampa
// accanto al foglio, così ogni modifica si vede subito; in fondo «Stampa…», che apre il dialogo di stampa di Windows.
// Prima (M10) era una finestra con il velo scuro: le impostazioni sono le stesse e vanno nel documento come prima.
// Qui c'è anche «Riquadro attorno a simbolo e parola» (prima «Contorna simbolo e parola», nella barra degli strumenti).
import type { PrintPrefs } from "../docs/prefs";
import { footerSupported } from "./print";
import { conIcona } from "../ui/icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface SchedaPaginaDeps {
  get(): PrintPrefs;
  /** Le impostazioni sono cambiate (si applicano alla pagina e si salvano con il documento). */
  set(p: PrintPrefs): void;
  /** Riquadro attorno a simbolo e parola (vale per il documento; il computer ricorda l'ultima scelta). */
  getRiquadro(): boolean;
  setRiquadro(on: boolean): void;
  print(): void;
  /** Esc dentro la scheda: si torna dove si era. */
  esci(): void;
}

export interface SchedaPagina {
  root: HTMLElement;
  /** Il pulsante principale «Stampa…» (Ctrl+P ci porta il fuoco). */
  stampa: HTMLButtonElement;
  /** Riporta i controlli ai valori attuali (dopo aver aperto un documento o uno nuovo). */
  aggiorna(): void;
  /** Il nome di chi scrive: la casella del piè di pagina lo mostra (K2). */
  setNome(nome: string): void;
}

/** Una piccola figura per far vedere la differenza fra riquadro e bordo (fuori dal foglio: non si stampa). */
function figura(tipo: "riquadro" | "bordo"): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 40 40");
  s.setAttribute("aria-hidden", "true");
  s.classList.add("pg-fig", `pg-fig-${tipo}`);
  // Il simbolo (un quadrato pieno) e, sotto, la parola (una riga).
  const simbolo = '<rect class="pg-fig-sym" x="13" y="8" width="14" height="14" rx="2"/>';
  const parola = '<rect class="pg-fig-word" x="11" y="28" width="18" height="3" rx="1.5"/>';
  const contorno =
    tipo === "riquadro"
      ? '<rect class="pg-fig-line" x="5" y="3" width="30" height="33" rx="5"/>'
      : '<rect class="pg-fig-line" x="10" y="5" width="20" height="20" rx="3"/>';
  s.innerHTML = contorno + simbolo + parola;
  return s;
}

export function creaSchedaPagina(deps: SchedaPaginaDeps): SchedaPagina {
  const root = el("div", "page-panel");
  root.tabIndex = -1;
  const aggiornatori: Array<(p: PrintPrefs) => void> = [];
  const update = (patch: Partial<PrintPrefs>): void => deps.set({ ...deps.get(), ...patch });

  const sezione = (titolo: string, id: string): HTMLElement => {
    const s = el("section", "pg-section");
    const h = el("h3", "pg-title", titolo);
    h.id = `pg-${id}`;
    s.setAttribute("aria-labelledby", h.id);
    s.append(h);
    return s;
  };
  const riga = (label: string, control: HTMLElement): HTMLElement => {
    const r = el("label", "pg-row");
    r.append(el("span", "", label), control);
    return r;
  };
  const select = <T extends string>(label: string, aria: string, options: Array<[T, string]>, value: (p: PrintPrefs) => T, on: (v: T) => void): HTMLElement => {
    const s = el("select");
    s.setAttribute("aria-label", aria);
    for (const [v, t] of options) {
      const o = el("option", "", t);
      o.value = v;
      s.append(o);
    }
    aggiornatori.push((p) => (s.value = value(p)));
    s.addEventListener("change", () => on(s.value as T));
    return riga(label, s);
  };
  /** Una casella con la sua etichetta; il testo si può cambiare (serve per il nome). */
  const casella = (label: string, value: () => boolean, on: (v: boolean) => void): { l: HTMLLabelElement; testo: HTMLSpanElement } => {
    const c = el("input");
    c.type = "checkbox";
    aggiornatori.push(() => (c.checked = value()));
    c.addEventListener("change", () => on(c.checked));
    const l = el("label", "pg-check");
    const testo = el("span", "", label);
    l.append(c, testo);
    return { l, testo };
  };
  const check = (label: string, key: "border" | "onePerLine" | "uppercase" | "footerTitle" | "footerAuthor" | "footerPage") =>
    casella(label, () => deps.get()[key], (v) => update({ [key]: v }));

  // ---- Foglio ----
  const margin = el("input");
  margin.type = "number";
  margin.min = "5";
  margin.max = "40";
  margin.step = "1";
  margin.setAttribute("aria-label", "Margini (mm)");
  aggiornatori.push((p) => (margin.value = String(p.margin)));
  margin.addEventListener("change", () => {
    const n = Math.min(40, Math.max(5, Math.round(Number(margin.value) || 15)));
    margin.value = String(n);
    update({ margin: n });
  });
  const foglio = sezione("Foglio", "foglio");
  foglio.append(
    select("Orientamento", "Orientamento", [["portrait", "A4 verticale"], ["landscape", "A4 orizzontale"]], (p) => p.orientation, (v) => update({ orientation: v })),
    riga("Margini (mm)", margin),
  );

  // ---- Testo ----
  const testo = sezione("Testo", "testo");
  testo.append(
    select("Posizione", "Posizione del testo", [["below", "sotto il simbolo"], ["above", "sopra il simbolo"]], (p) => (p.textAbove ? "above" : "below"), (v) => update({ textAbove: v === "above" })),
    select("Carattere", "Carattere", [["system", "Normale"], ["atkinson", "Atkinson Hyperlegible"], ["lexend", "Lexend"]], (p) => p.font, (v) => update({ font: v })),
    check("Tutto maiuscolo (il testo scritto non cambia)", "uppercase").l,
    check("Una frase per riga", "onePerLine").l,
  );

  // ---- Contorni: riquadro (simbolo e parola) e bordo (solo il simbolo), ognuno con la sua figura ----
  const contorni = sezione("Contorni", "contorni");
  const conFigura = (c: { l: HTMLLabelElement }, tipo: "riquadro" | "bordo"): HTMLElement => {
    c.l.classList.add("pg-fig-check");
    c.l.append(figura(tipo));
    return c.l;
  };
  contorni.append(
    conFigura(casella("Riquadro attorno a simbolo e parola", () => deps.getRiquadro(), (v) => deps.setRiquadro(v)), "riquadro"),
    conFigura(check("Bordo attorno al solo simbolo", "border"), "bordo"),
  );

  // ---- Piè di pagina ----
  const pie = sezione("Piè di pagina", "pie");
  const nome = check("", "footerAuthor");
  const setNome = (n: string): void => {
    const t = n.trim();
    // K2: è il nome di chi usa il programma (non l'autore dell'originale di una copia della biblioteca).
    nome.testo.textContent = t ? `il tuo nome («${t}»)` : "il tuo nome (non è ancora scritto: non si stampa niente)";
  };
  setNome("");
  pie.append(
    el("p", "pg-note", "L'attribuzione ARASAAC c'è sempre. In più puoi mettere:"),
    check("il titolo", "footerTitle").l,
    nome.l,
    check("il numero di pagina", "footerPage").l,
  );

  root.append(foglio, testo, contorni, pie);
  root.append(el("p", "pg-note", "La dimensione dei simboli è quella dei pulsanti «Simboli» in alto: piccolo 12 mm, medio 18, grande 25, molto grande 40. Per salvare un PDF, nella finestra di stampa scegli la stampante «Microsoft Print to PDF»."));
  // Si controlla ogni volta che la scheda si aggiorna (la scheda c'è dall'avvio, la finestra di M10 si creava ogni volta).
  const vecchio = el("p", "pg-note warn", "Il motore di pagine di questo computer è vecchio: l'attribuzione ARASAAC in fondo a ogni pagina potrebbe non comparire. Aggiorna WebView2 (o Edge) prima di stampare.");
  root.append(vecchio);
  const azioni = el("div", "pg-actions");
  const stampa = conIcona(el("button", "primary", "Stampa…"), "stampa");
  stampa.type = "button";
  stampa.addEventListener("click", () => deps.print());
  azioni.append(stampa);
  root.append(azioni);

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    deps.esci();
  });

  const aggiorna = (): void => {
    const p = deps.get();
    aggiornatori.forEach((f) => f(p));
    vecchio.hidden = footerSupported();
  };
  aggiorna();
  return { root, stampa, aggiorna, setNome };
}
