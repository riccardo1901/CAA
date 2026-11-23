// Collegamento fra editor, pannello e interfaccia di prova (`window.caaProto`, usata dai test).
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { benchmark, checkSymbolHits, checkWrap } from "./checks";
import { createEditor, currentMode, replaceDoc } from "./editor/editor";
import { symbolKey, type Mode } from "./editor/symbolPlugin";
import { setSymbols } from "./editor/symbols";
import { createPanel } from "./panel";
import { fragmentsDoc, sampleDoc } from "./sample";
import type { Node as PMNode } from "prosemirror-model";

let view: EditorView;
let size = 68;

export function replaceDocument(doc: PMNode): void {
  replaceDoc(view, doc);
  view.focus();
}

function applySize(px: number): void {
  size = px;
  document.documentElement.style.setProperty("--sym", `${px}px`);
}

export function startApp(root: HTMLElement): void {
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
  layout.appendChild(createPanel(view, applySize, () => size));

  // Interfaccia per i test automatici.
  (window as unknown as { caaProto: unknown }).caaProto = {
    view,
    setMode: (m: Mode) => view.dispatch(view.state.tr.setMeta(symbolKey, { mode: m })),
    mode: () => currentMode(view),
    setSize: applySize,
    loadSample: (repeat = 1) => replaceDocument(sampleDoc(repeat)),
    loadFragments: () => replaceDocument(fragmentsDoc()),
    setSymbols,
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
