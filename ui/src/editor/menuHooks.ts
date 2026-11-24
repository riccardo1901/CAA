// Collegamento fra l'editor e il menu delle alternative (M8b). L'editor si crea prima del menu: qui
// c'è il punto d'incontro (il menu si registra quando parte il motore) e il plugin del clic sul simbolo.
import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export const hooks: {
  /** Apre il menu per la parola al cursore (Alt+↓). */
  openAtCursor: (() => boolean) | null;
  /** Va alla prossima parola da controllare e apre il menu (F8, clic sul contatore). */
  next: (() => boolean) | null;
  /** Apre il menu per la parola alla posizione indicata (clic sul simbolo). */
  openAt: ((pos: number) => boolean) | null;
} = { openAtCursor: null, next: null, openAt: null };

/** Altezza (px) della zona del simbolo in una parola: il clic lì apre il menu, sul testo sposta il cursore. */
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
          if (!el || !view.dom.contains(el) || el.classList.contains("wc") || el.classList.contains("txt") || el.classList.contains("hid")) return false;
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
