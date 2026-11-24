// Barra degli strumenti (politica delle parole funzionali, dimensione dei simboli) e barra di stato
// (parole da controllare, numero di parole, stato del motore).
import type { EditorView } from "prosemirror-view";
import type { EngineInfo, Policy } from "./engine/client";
import { engineStats, setPolicy } from "./editor/engineSymbols";

const SIZES: Array<[string, number]> = [
  ["Piccolo", 45],
  ["Medio", 68],
  ["Grande", 94],
  ["Molto grande", 151],
];

const POLICIES: Array<[Policy, string]> = [
  ["complete", "Completo"],
  ["essential", "Essenziale"],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export interface Bars {
  toolbar: HTMLElement;
  statusbar: HTMLElement;
  banner: HTMLElement;
  refresh(): void;
}

export function createBars(
  view: EditorView,
  info: EngineInfo | null,
  setSize: (px: number) => void,
  getSize: () => number,
  newDocument: () => void,
  sampleDocument: () => void,
): Bars {
  const toolbar = el("div", "toolbar");
  toolbar.setAttribute("role", "toolbar");
  const statusbar = el("div", "statusbar");
  const banner = el("div", "banner");
  banner.hidden = !!info?.ok;
  if (info && !info.ok) banner.textContent = `Il motore non è attivo: ${info.error ?? "errore sconosciuto"}`;

  const doc = el("div");
  const newBtn = el("button", "", "Nuovo");
  newBtn.type = "button";
  newBtn.addEventListener("click", newDocument);
  const sampleBtn = el("button", "", "Testo di esempio");
  sampleBtn.type = "button";
  sampleBtn.addEventListener("click", sampleDocument);
  doc.append(newBtn, " ", sampleBtn);

  const policyLabel = el("label", "", "Parole funzionali: ");
  const select = el("select");
  select.setAttribute("aria-label", "Politica delle parole funzionali");
  for (const [value, label] of POLICIES) {
    const o = el("option", "", label);
    o.value = value;
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    setPolicy(view, select.value as Policy);
    refresh();
  });
  policyLabel.appendChild(select);

  const sizes = el("div");
  sizes.append("Simboli: ");
  const sizeButtons: HTMLButtonElement[] = SIZES.map(([label, px], i) => {
    const b = el("button", "", label);
    b.type = "button";
    b.title = `Ctrl+${i + 1}`;
    b.addEventListener("click", () => {
      setSize(px);
      refresh();
      view.focus();
    });
    sizes.append(b, " ");
    return b;
  });

  toolbar.append(doc, el("span", "grow"), policyLabel, sizes);

  const wordsInfo = el("span");
  const doubtInfo = el("span");
  const policyInfo = el("span");
  const engineInfoEl = el("span");
  const errorInfo = el("span");
  statusbar.append(doubtInfo, wordsInfo, errorInfo, el("span", "grow"), policyInfo, engineInfoEl);

  function refresh(): void {
    const s = engineStats(view);
    sizeButtons.forEach((b, i) => b.classList.toggle("on", SIZES[i][1] === getSize()));
    wordsInfo.textContent = `${s.words} parole`;
    doubtInfo.textContent = s.doubtful === 1 ? "1 parola da controllare" : `${s.doubtful} parole da controllare`;
    doubtInfo.classList.toggle("warn", s.doubtful > 0);
    // Il motore ha dato errore e sta riprovando: lo si dice, altrimenti i simboli mancano senza spiegazione.
    errorInfo.textContent = s.error ? "Il motore non risponde: riprovo…" : s.pending > 0 ? "Analisi in corso…" : "";
    errorInfo.classList.toggle("warn", !!s.error);
    policyInfo.textContent = `Parole funzionali: ${select.selectedOptions[0]?.textContent ?? ""}`;
    engineInfoEl.textContent = info?.ok
      ? `Motore attivo${info.tagger ? "" : " (senza tagger)"}${info.expressions ? "" : " (senza espressioni)"}`
      : "Motore non attivo";
  }

  // Ctrl+1–4: dimensione dei simboli.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    setSize(SIZES[i][1]);
    refresh();
  });

  refresh();
  return { toolbar, statusbar, banner, refresh };
}
