// Simbolo sopra ogni parola, come decorazioni: il testo del documento non cambia.
//
// Modalità A: ogni parola è avvolta in uno span inline-block con l'immagine come ::before.
// Modalità B: un'immagine (widget) inserita prima della parola.
// Le decorazioni si ricalcolano solo quando cambia il documento o le impostazioni; per ogni
// paragrafo gli intervalli delle parole sono in cache (come la cache per paragrafo di SPEC.md).

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { symbolUrl } from "./symbols";
import { wordRanges } from "./words";

export type Mode = "A" | "B" | "off";

interface State {
  mode: Mode;
  version: number;
  decos: DecorationSet;
}

export const symbolKey = new PluginKey<State>("symbols");

/** Messaggio per cambiare modalità o forzare il ridisegno (nuovo insieme di simboli). */
export interface SymbolMeta {
  mode?: Mode;
  refresh?: boolean;
}

type Cached = Array<[number, number, string]>;
const wordCache = new WeakMap<PMNode, Cached>();

function wordsOf(node: PMNode): Cached {
  let cached = wordCache.get(node);
  if (!cached) {
    const text = node.textContent;
    cached = wordRanges(text).map(([a, b]) => [a, b, text.slice(a, b).toLowerCase()]);
    wordCache.set(node, cached);
  }
  return cached;
}

/** Fine (in offset relativi al paragrafo) di ciascun pezzo di testo: cambiano dove cambia la formattazione. */
function pieceEnds(node: PMNode): number[] {
  const ends: number[] = [];
  let off = 0;
  node.forEach((child) => {
    off += child.nodeSize;
    ends.push(off);
  });
  return ends;
}

/** Divide la parola [a, b) nei pezzi in cui la formattazione la spezza (es. "gras" + "setto" in grassetto). */
function splitWord(a: number, b: number, ends: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = a;
  for (const e of ends) {
    if (e > from && e < b) {
      out.push([from, e]);
      from = e;
    }
  }
  out.push([from, b]);
  return out;
}

function widgetFor(url: string): HTMLElement {
  const anchor = document.createElement("span");
  anchor.className = "sw";
  anchor.setAttribute("contenteditable", "false");
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.draggable = false;
  anchor.appendChild(img);
  return anchor;
}

function build(doc: PMNode, mode: Mode): DecorationSet {
  if (mode === "off") return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const ends = pieceEnds(node);
    for (const [a, b, word] of wordsOf(node)) {
      const url = symbolUrl(word);
      // Il simbolo sta sul primo pezzo; i pezzi successivi ("wc") restano testo della stessa parola.
      splitWord(a, b, ends).forEach(([x, y], i) => {
        const from = pos + 1 + x;
        const to = pos + 1 + y;
        if (mode === "A") {
          decos.push(Decoration.inline(from, to, { class: i === 0 ? "w" : "w wc", style: `--img:url("${url}")` }));
        } else {
          if (i === 0) decos.push(Decoration.widget(from, () => widgetFor(url), { side: -1, key: `s${url}` }));
          decos.push(Decoration.inline(from, to, { class: i === 0 ? "wb" : "wb wc" }));
        }
      });
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export function symbolPlugin(initial: Mode = "A"): Plugin<State> {
  return new Plugin<State>({
    key: symbolKey,
    state: {
      init: (_, state) => ({ mode: initial, version: 0, decos: build(state.doc, initial) }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(symbolKey) as SymbolMeta | undefined;
        if (!tr.docChanged && !meta) return value;
        const mode = meta?.mode ?? value.mode;
        const version = meta ? value.version + 1 : value.version;
        return { mode, version, decos: build(state.doc, mode) };
      },
    },
    props: {
      decorations: (state) => symbolKey.getState(state)?.decos ?? DecorationSet.empty,
    },
  });
}
