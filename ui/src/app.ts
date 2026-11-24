// Collegamento fra editor, pannello e interfaccia di prova (`window.caaProto`, usata dai test).
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { benchmark, checkSymbolHits, checkWrap } from "./checks";
import { createEditor, currentMode, replaceDoc } from "./editor/editor";
import { engineStats, onEngineUpdate, setEngine, setPolicy } from "./editor/engineSymbols";
import { engineInfo, inTauri, tauriClient, type EngineClient, type EngineInfo, type Policy } from "./engine/client";
import { createSidebar, installSidebar } from "./sidebar";
import { createBars } from "./toolbar";
import { symbolKey, type Mode } from "./editor/symbolPlugin";
import { setSymbols } from "./editor/symbols";
import { createPanel } from "./panel";
import { emptyDoc, fragmentsDoc, sampleDoc } from "./sample";
import type { Node as PMNode } from "prosemirror-model";

let view: EditorView;
let size = 68;
let layoutEl: HTMLElement;
let panelEl: HTMLElement;
let sideEl: HTMLElement | null = null;
let root: HTMLElement;

export function replaceDocument(doc: PMNode): void {
  replaceDoc(view, doc);
  view.focus();
}

function applySize(px: number): void {
  size = px;
  document.documentElement.style.setProperty("--sym", `${px}px`);
}

/** Passa all'interfaccia con il motore: barre, simboli veri, niente pannello di prova. */
let engineModeOn = false;

function enterEngineMode(client: EngineClient | null, info: EngineInfo | null): void {
  // Una volta sola: i pulsanti e gli ascoltatori delle barre non si devono accumulare.
  if (engineModeOn) {
    if (client && sideEl) {
      setEngine(view, client);
      installSidebar(view, client, sideEl);
    }
    return;
  }
  engineModeOn = true;
  panelEl.remove();
  // La barra dei simboli sostituisce il pannello di prova: fissa a destra, si riempie quando si agisce su una parola.
  sideEl = createSidebar();
  layoutEl.appendChild(sideEl);
  const app = document.createElement("div");
  app.className = "app";
  // "Nuovo" e "Testo di esempio" buttano via il documento aperto (il salvataggio arriva con M9): si chiede conferma
  // se c'è del testo.
  const confirmReplace = (make: () => PMNode) => () => {
    const hasText = view.state.doc.textContent.trim().length > 0;
    if (hasText && !window.confirm("Il documento aperto andrà perso. Continuare?")) return;
    replaceDocument(make());
  };
  const bars = createBars(view, info, applySize, () => size, confirmReplace(emptyDoc), confirmReplace(() => sampleDoc(1)));
  app.append(bars.banner, bars.toolbar, layoutEl, bars.statusbar);
  root.appendChild(app);
  onEngineUpdate(bars.refresh);
  // I simboli finti del prototipo si spengono sempre: col motore non servono e costano tempo a ogni battuta.
  view.dispatch(view.state.tr.setMeta(symbolKey, { mode: "off" }));
  if (client) {
    setEngine(view, client);
    installSidebar(view, client, sideEl);
  }
  bars.refresh();
}

export function startApp(mount: HTMLElement): void {
  root = mount;
  const layout = document.createElement("div");
  layout.className = "layout";
  const wrap = document.createElement("main");
  wrap.className = "sheet-wrap";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  wrap.appendChild(sheet);
  layout.appendChild(wrap);
  root.appendChild(layout);

  applySize(size);
  view = createEditor(sheet, sampleDoc(1));
  layoutEl = layout;
  panelEl = createPanel(view, applySize, () => size);
  layout.appendChild(panelEl);

  // Nell'app (Tauri) si passa subito al motore; nel browser restano il prototipo e le sue prove.
  if (inTauri()) {
    engineInfo().then(
      (info) => enterEngineMode(info.ok ? tauriClient() : null, info),
      (e: unknown) => enterEngineMode(null, { ok: false, dir: null, error: String(e), tagger: false, expressions: false }),
    );
  }

  // Interfaccia per i test automatici.
  (window as unknown as { caaProto: unknown }).caaProto = {
    view,
    setMode: (m: Mode) => view.dispatch(view.state.tr.setMeta(symbolKey, { mode: m })),
    mode: () => currentMode(view),
    setSize: applySize,
    loadSample: (repeat = 1) => replaceDocument(sampleDoc(repeat)),
    loadFragments: () => replaceDocument(fragmentsDoc()),
    setSymbols,
    // Motore (prove automatiche con un motore finto, app con quello vero).
    enterEngineMode: (client: EngineClient) => enterEngineMode(client, { ok: true, dir: null, error: null, tagger: true, expressions: true }),
    engineStats: () => engineStats(view),
    setPolicy: (p: Policy) => setPolicy(view, p),
    refresh: () => view.dispatch(view.state.tr.setMeta(symbolKey, { refresh: true })),
    checkWrap: () => checkWrap(view),
    checkSymbolHits: () => checkSymbolHits(view),
    benchmark: (n?: number) => benchmark(view, n),
    // Funzioni di servizio per i test.
    setCaret: (pos: number, to?: number) => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, to ?? pos)));
      view.focus();
    },
    selection: () => ({ anchor: view.state.selection.anchor, head: view.state.selection.head, from: view.state.selection.from, to: view.state.selection.to }),
    // Posizione del cursore letta dal browser (ProseMirror la sincronizza con un piccolo ritardo).
    domHead: () => {
      const sel = window.getSelection();
      return sel && sel.focusNode ? view.posAtDOM(sel.focusNode, sel.focusOffset) : null;
    },
    // Coordinate del cursore relative al foglio (non allo schermo: il foglio scorre).
    caret: (pos?: number) => {
      const sel = window.getSelection();
      const head = sel && sel.focusNode ? view.posAtDOM(sel.focusNode, sel.focusOffset) : view.state.selection.head;
      const c = view.coordsAtPos(pos ?? head);
      const scroll = document.querySelector<HTMLElement>(".sheet-wrap")?.scrollTop ?? 0;
      return { left: c.left, top: c.top + scroll, bottom: c.bottom + scroll };
    },
    posAt: (left: number, top: number) => view.posAtCoords({ left, top })?.pos ?? null,
    text: (from: number, to: number) => view.state.doc.textBetween(from, to, "\n"),
    docSize: () => view.state.doc.content.size,
    docJSON: () => view.state.doc.toJSON() as unknown,
    pasteHTML: (html: string) => view.pasteHTML(html),
    setSheetWidth: (px: number) => {
      const sheet = document.querySelector<HTMLElement>(".sheet");
      if (sheet) sheet.style.width = `${px}px`;
    },
  };
}
