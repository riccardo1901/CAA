// Collegamento fra l'editor e la barra laterale dei simboli (M8b). L'editor si crea prima della barra:
// qui c'è il punto d'incontro (la barra si registra quando parte il motore), il plugin del clic sul
// simbolo e l'evidenziazione della parola di cui la barra mostra le alternative.
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";

export const hooks: {
  /** Mostra nella barra la parola al cursore (Alt+↓). */
  openAtCursor: (() => boolean) | null;
  /** Va alla prossima parola da controllare e la mostra nella barra (F8, clic sul contatore). */
  next: (() => boolean) | null;
  /** Mostra nella barra la parola alla posizione indicata (clic sul simbolo). */
  openAt: ((pos: number) => boolean) | null;
  /** Unisce le parole selezionate in un simbolo solo (Ctrl+Maiusc+U). */
  merge: (() => boolean) | null;
  /** Divide l'unione o l'espressione della parola al cursore, o riunisce una divisione (Ctrl+Maiusc+D). */
  split: (() => boolean) | null;
  /** Un messaggio breve per il docente (barra di stato). */
  /** Un messaggio per il docente: diventa una notifica (M11-3). Di partenza «avviso» (resta finché non si chiude). */
  notice: ((message: string, tipo?: "info" | "ok" | "avviso" | "errore") => void) | null;
} = { openAtCursor: null, next: null, openAt: null, merge: null, split: null, notice: null };

/** Altezza (px) della zona del simbolo in una parola: il clic lì mostra le alternative, sul testo sposta il cursore. */
function symbolHeight(view: EditorView): number {
  return parseFloat(getComputedStyle(view.dom).getPropertyValue("--sym")) || 0;
}

/** Il clic sul simbolo si risolve dall'elemento colpito (SPEC.md, esito di M3), non da `posAtCoords`. */
export function symbolClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          const ev = event as MouseEvent;
          if (!hooks.openAt || ev.button !== 0 || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
          const el = (ev.target as HTMLElement | null)?.closest?.(".w") as HTMLElement | null;
          if (!el || !view.dom.contains(el) || el.classList.contains("wc") || el.classList.contains("txt")) return false;
          const rect = el.getBoundingClientRect();
          if (ev.clientY - rect.top >= symbolHeight(view)) return false;
          const opened = hooks.openAt(view.posAtDOM(el, 0));
          if (opened) ev.preventDefault();
          return opened;
        },
      },
    },
  });
}

const curKey = new PluginKey<DecorationSet>("focusWord");

/** Evidenzia la parola mostrata nella barra; segue il testo mentre si scrive e sparisce se la parola sparisce. */
export function focusWordPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: curKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const m = tr.getMeta(curKey) as { range: [number, number] | null } | undefined;
        if (m) {
          return m.range
            ? DecorationSet.create(tr.doc, [Decoration.inline(m.range[0], m.range[1], { class: "cur" }, { inclusiveStart: false, inclusiveEnd: false })])
            : DecorationSet.empty;
        }
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    props: { decorations: (state) => curKey.getState(state) },
  });
}

export function setFocusWord(view: EditorView, range: [number, number] | null): void {
  view.dispatch(view.state.tr.setMeta(curKey, { range }).setMeta("addToHistory", false));
}

/** La parola evidenziata, con la posizione di adesso. */
export function focusWordRange(view: EditorView): { from: number; to: number } | null {
  const found = curKey.getState(view.state)?.find() ?? [];
  return found.length > 0 ? { from: found[0].from, to: found[0].to } : null;
}

/** Porta la parola in mezzo allo schermo (anche se il foglio è lungo). */
export function revealPos(view: EditorView, pos: number): void {
  const { node } = view.domAtPos(pos);
  const e = node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
  (e?.closest(".w") ?? e)?.scrollIntoView({ block: "center" });
}
