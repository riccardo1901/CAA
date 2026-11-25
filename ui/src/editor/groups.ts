// Unisci e dividi parole (M8c-2): comandi sul documento. L'unione è un mark `group` (modo `merge`) sulle
// parole scelte; la divisione di un'espressione riconosciuta dal motore è un mark `group` in modo `split`;
// "Dividi" su un'unione fatta a mano toglie il mark, "Riunisci" toglie una divisione.
import type { EditorView } from "prosemirror-view";
import type { TokenAt } from "./engineSymbols";
import { paraInfo } from "./picks";
import { schema } from "./schema";
import { wordRanges } from "./words";

export const MERGE_HELP = "Seleziona due o più parole della stessa frase, senza punteggiatura in mezzo.";

interface Selected {
  paraPos: number;
  /** Prima e ultima parola toccate dalla selezione (offset nel paragrafo). */
  from: number;
  to: number;
  count: number;
}

/** Le parole toccate dalla selezione, se si possono unire (stesso paragrafo, almeno due, solo spazi in mezzo). */
function selectedWords(view: EditorView): Selected | null {
  const { from, to, empty } = view.state.selection;
  if (empty) return null;
  const $from = view.state.doc.resolve(from);
  const $to = view.state.doc.resolve(to);
  if (!$from.parent.isTextblock || $from.parent !== $to.parent) return null;
  const start = $from.start();
  const text = $from.parent.textContent;
  const words = wordRanges(text).filter(([a, b]) => b > from - start && a < to - start);
  if (words.length < 2) return null;
  for (let i = 1; i < words.length; i++) {
    if (text.slice(words[i - 1][1], words[i][0]).trim() !== "") return null;
  }
  return { paraPos: $from.before(), from: words[0][0], to: words[words.length - 1][1], count: words.length };
}

export function canMerge(view: EditorView): boolean {
  return selectedWords(view) !== null;
}

/** Unisce le parole selezionate in un simbolo solo. Restituisce un messaggio se non si può. */
export function mergeSelection(view: EditorView): string | null {
  const sel = selectedWords(view);
  if (!sel) return MERGE_HELP;
  const node = view.state.doc.nodeAt(sel.paraPos);
  if (!node) return MERGE_HELP;
  const a = sel.paraPos + 1 + sel.from;
  const b = sel.paraPos + 1 + sel.to;
  const text = node.textContent.slice(sel.from, sel.to).toLowerCase();
  const tr = view.state.tr.removeMark(a, b, schema.marks.pick).removeMark(a, b, schema.marks.group);
  tr.addMark(a, b, schema.marks.group.create({ text, mode: "merge" }));
  view.dispatch(tr.scrollIntoView());
  return null;
}

export interface GroupAction {
  label: "Dividi" | "Riunisci";
  run: (view: EditorView) => void;
}

/** Cosa si può fare con il gruppo della parola: dividere un'unione o un'espressione, o riunire una divisione. */
export function groupAction(view: EditorView, t: TokenAt): GroupAction | null {
  const node = view.state.doc.nodeAt(t.paraPos);
  if (!node || !node.isTextblock) return null;
  const covering = paraInfo(node).groups.find((g) => g.s <= t.token.s && t.token.e <= g.e);
  const abs = (s: number, e: number): [number, number] => [t.paraPos + 1 + s, t.paraPos + 1 + e];
  if (covering) {
    const [a, b] = abs(covering.s, covering.e);
    return {
      label: covering.mode === "merge" ? "Dividi" : "Riunisci",
      run: (v) => v.dispatch(v.state.tr.removeMark(a, b, schema.marks.group)),
    };
  }
  if (t.token.gkind === "multiword" && t.groupSpan) {
    const [s, e] = t.groupSpan;
    const [a, b] = abs(s, e);
    const text = node.textContent.slice(s, e).toLowerCase();
    return {
      label: "Dividi",
      run: (v) => v.dispatch(v.state.tr.addMark(a, b, schema.marks.group.create({ text, mode: "split" }))),
    };
  }
  return null;
}
