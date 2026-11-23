// Pannello laterale del prototipo: impostazioni e prove di accettazione di M3.
import type { EditorView } from "prosemirror-view";
import { benchmark, checkSymbolHits, checkWrap } from "./checks";
import { currentMode } from "./editor/editor";
import { symbolKey, type Mode } from "./editor/symbolPlugin";
import { SIMPLE_SYMBOLS, setSymbols, symbolCount } from "./editor/symbols";
import { emptyDoc, sampleDoc } from "./sample";
import { replaceDocument } from "./app";

const SIZES: Array<[string, number]> = [
  ["Piccolo", 45],
  ["Medio", 68],
  ["Grande", 94],
  ["Molto grande", 151],
];

const MANUAL: Array<[string, string, string]> = [
  ["1", "Frecce", "Clicca in un paragrafo. Premi → e ← molte volte, poi ↓ e ↑. Il cursore deve spostarsi di una lettera o di una riga alla volta, senza saltare né fermarsi."],
  ["2", "Selezione col mouse", "Trascina il mouse dall'inizio di una frase fino a tre righe più sotto. Deve selezionarsi tutto il testo in mezzo, senza salti."],
  ["3", "Doppio clic", "Fai doppio clic su una parola: deve selezionarsi solo quella parola."],
  ["5", "Copia e incolla", "Seleziona due righe, premi Ctrl+C, vai in fondo, premi Ctrl+V. Poi copia un testo da Word o da una pagina web e incollalo: deve entrare solo il testo (e i titoli), senza colori né caratteri strani."],
  ["6", "Correttore ortografico", "Scrivi in una frase una parola sbagliata, per esempio «cvasa». Deve comparire la sottolineatura rossa del correttore di sistema; con il clic destro devono comparire i suggerimenti."],
  ["7b", "Digitazione veloce", "In mezzo al testo, scrivi più veloce che puoi per dieci secondi. Non devono esserci ritardi o scatti visibili."],
];

type Verdict = "" | "ok" | "ko";
const results: Record<string, Verdict> = {};
try {
  Object.assign(results, JSON.parse(localStorage.getItem("caa-m3-risultati") ?? "{}"));
} catch {
  /* senza memoria locale il pannello funziona lo stesso */
}

function saveResults(): void {
  try {
    localStorage.setItem("caa-m3-risultati", JSON.stringify(results));
  } catch {
    /* ignora */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", { type: "button" }, label);
  b.addEventListener("click", onClick);
  return b;
}

function section(title: string): HTMLElement {
  const s = el("section");
  s.appendChild(el("h2", {}, title));
  return s;
}

export function createPanel(view: EditorView, setSize: (px: number) => void, getSize: () => number): HTMLElement {
  const panel = el("aside", { class: "panel" });
  panel.appendChild(el("h1", {}, "Prototipo editor (M3)"));
  const out: string[] = [];

  // Modalità A / B
  const modes = section("Resa del simbolo");
  const modeButtons: Record<string, HTMLButtonElement> = {};
  const refreshModes = () => {
    for (const [m, b] of Object.entries(modeButtons)) b.classList.toggle("on", currentMode(view) === m);
  };
  for (const [m, label] of [["A", "A · pseudo-elemento"], ["B", "B · widget"]] as const) {
    modeButtons[m] = button(label, () => {
      view.dispatch(view.state.tr.setMeta(symbolKey, { mode: m as Mode }));
      refreshModes();
    });
    modes.appendChild(modeButtons[m]);
  }
  panel.appendChild(modes);

  // Dimensione
  const sizes = section("Dimensione dei simboli");
  const sizeButtons: HTMLButtonElement[] = [];
  const refreshSizes = () => sizeButtons.forEach((b, i) => b.classList.toggle("on", SIZES[i][1] === getSize()));
  SIZES.forEach(([label, px]) => {
    const b = button(label, () => {
      setSize(px);
      refreshSizes();
    });
    sizeButtons.push(b);
    sizes.appendChild(b);
  });
  panel.appendChild(sizes);

  // Simboli
  const syms = section("Simboli");
  const info = el("p", { class: "note" });
  const refreshInfo = () => {
    info.textContent = symbolCount() === SIMPLE_SYMBOLS.length ? "Simboli semplici (forme colorate)." : `Immagini scelte da te: ${symbolCount()}.`;
  };
  const picker = el("input", { type: "file", webkitdirectory: "", multiple: "", hidden: "" });
  picker.addEventListener("change", () => {
    const files = Array.from(picker.files ?? []).filter((f) => /\.(webp|png|svg|jpe?g)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
    if (files.length === 0) {
      info.textContent = "Nessuna immagine trovata in quella cartella.";
      return;
    }
    const step = Math.max(1, Math.floor(files.length / 60));
    const chosen = files.filter((_, i) => i % step === 0).slice(0, 60);
    setSymbols(chosen.map((f) => URL.createObjectURL(f)));
    view.dispatch(view.state.tr.setMeta(symbolKey, { refresh: true }));
    refreshInfo();
  });
  syms.appendChild(button("Scegli la cartella delle immagini…", () => picker.click()));
  syms.appendChild(picker);
  syms.appendChild(button("Simboli semplici", () => {
    setSymbols(SIMPLE_SYMBOLS);
    view.dispatch(view.state.tr.setMeta(symbolKey, { refresh: true }));
    refreshInfo();
  }));
  syms.appendChild(info);
  panel.appendChild(syms);

  // Testo
  const text = section("Testo");
  text.appendChild(button("Testo di prova", () => replaceDocument(sampleDoc(1))));
  text.appendChild(button("Testo lungo (×3)", () => replaceDocument(sampleDoc(3))));
  text.appendChild(button("Svuota", () => replaceDocument(emptyDoc())));
  panel.appendChild(text);

  // Prove automatiche
  const auto = section("Prove automatiche (4, 7 e clic sul simbolo)");
  const autoOut = el("pre", { class: "auto" });
  auto.appendChild(button("Esegui le prove automatiche", async () => {
    autoOut.textContent = "In corso…";
    const lines: string[] = [];
    const wrap = checkWrap(view);
    lines.push(`4 · A capo: ${wrap.broken === 0 ? "SUPERATA" : "FALLITA"} — ${wrap.broken} parole separate dal simbolo su ${wrap.words}` + (wrap.fragments ? `; ${wrap.fragments} pezzi di parola in più (grassetto parziale)` : ""));
    if (wrap.examples.length) lines.push("   es.: " + wrap.examples.join("; "));
    const hits = checkSymbolHits(view);
    lines.push(`Clic sul simbolo: ${hits.wrong === 0 ? "SUPERATA" : "FALLITA"} — ${hits.wrong} errori su ${hits.tested}; cursore messo altrove: ${hits.caretMisses}`);
    if (hits.examples.length) lines.push("   es.: " + hits.examples.join("; "));
    autoOut.textContent = lines.join("\n") + "\n7 · Velocità: in corso…";
    const b = await benchmark(view);
    lines.push(`7 · Velocità: ${b.p95Ms < 30 ? "SUPERATA" : "FALLITA"} — ${b.keystrokes} battute su ${b.words} parole: mediana ${b.medianMs.toFixed(1)} ms, 95° percentile ${b.p95Ms.toFixed(1)} ms, massimo ${b.maxMs.toFixed(1)} ms (obiettivo < 30 ms)`);
    autoOut.textContent = lines.join("\n");
    out.length = 0;
    out.push(...lines);
  }));
  auto.appendChild(autoOut);
  panel.appendChild(auto);

  // Prove a mano
  const manual = section("Prove a mano");
  manual.appendChild(el("p", { class: "note" }, "Prova una modalità alla volta (A e poi B) e segna il risultato."));
  const table = el("table");
  const head = el("tr");
  ["Prova", "A", "B"].forEach((h) => head.appendChild(el("th", {}, h)));
  table.appendChild(head);
  for (const [id, title, steps] of MANUAL) {
    const row = el("tr");
    const cell = el("td");
    cell.appendChild(el("strong", {}, `${id} · ${title}`));
    cell.appendChild(el("div", { class: "steps" }, steps));
    row.appendChild(cell);
    for (const m of ["A", "B"]) {
      const key = `${m}${id}`;
      const select = el("select");
      for (const [v, label] of [["", "—"], ["ok", "Superata"], ["ko", "Fallita"]]) {
        const o = el("option", { value: v }, label);
        select.appendChild(o);
      }
      select.value = results[key] ?? "";
      select.addEventListener("change", () => {
        results[key] = select.value as Verdict;
        saveResults();
      });
      const td = el("td");
      td.appendChild(select);
      row.appendChild(td);
    }
    table.appendChild(row);
  }
  manual.appendChild(table);
  panel.appendChild(manual);

  // Risultati
  const res = section("Risultati");
  const area = el("textarea", { rows: "8", readonly: "", class: "res" });
  res.appendChild(button("Copia risultati", async () => {
    const lines: string[] = ["Risultati M3", `Ambiente: ${navigator.userAgent}`, `Schermo: ${window.devicePixelRatio}x, finestra ${window.innerWidth}x${window.innerHeight}`, `Simboli: ${symbolCount() === SIMPLE_SYMBOLS.length ? "semplici" : `immagini scelte (${symbolCount()})`}, dimensione ${getSize()} px, resa ${currentMode(view)}`, "", "Prove automatiche (ultima esecuzione):", ...(out.length ? out : ["(non eseguite)"]), "", "Prove a mano:"];
    for (const [id, title] of MANUAL) lines.push(`${id} ${title}: A=${label(results[`A${id}`])} B=${label(results[`B${id}`])}`);
    area.value = lines.join("\n");
    try {
      await navigator.clipboard.writeText(area.value);
    } catch {
      area.select();
    }
  }));
  res.appendChild(area);
  panel.appendChild(res);

  refreshModes();
  refreshSizes();
  refreshInfo();
  return panel;
}

function label(v: Verdict | undefined): string {
  return v === "ok" ? "superata" : v === "ko" ? "FALLITA" : "non provata";
}
