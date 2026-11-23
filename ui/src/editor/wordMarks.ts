// La formattazione si applica sempre a parole intere: una parola spezzata in pezzi formattati in
// modo diverso avrebbe più simboli e il browser potrebbe mandare a capo un pezzo da solo (provato
// in M3: tra due blocchi in linea affiancati l'a capo è sempre consentito).
//
//  1. `toggleBoldWords`: il comando grassetto estende la selezione alle parole intere.
//  2. `normalizeMarks`: rete di sicurezza (incolla, annulla, ecc.): una parola con formattazione
//     mista prende quella del suo primo carattere.
import { toggleMark } from "prosemirror-commands";
import { Mark, type Node as PMNode } from "prosemirror-model";
import { EditorState, Plugin, type Command, type Transaction } from "prosemirror-state";
import { schema } from "./schema";
import { wordRanges } from "./words";

/** Per ogni paragrafo toccato da [from, to): l'intervallo esteso alle parole intere che lo toccano. */
export function expandToWords(doc: PMNode, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (const [a, b] of wordRanges(node.textContent)) {
      const wa = start + a;
      const wb = start + b;
      if (wb > from && wa < to) {
        lo = Math.min(lo, wa);
        hi = Math.max(hi, wb);
      }
    }
    if (lo < hi) out.push([lo, hi]);
    return false;
  });
  return out;
}

export const toggleBoldWords: Command = (state, dispatch) => {
  const mark = schema.marks.strong;
  const { from, to, empty } = state.selection;
  if (empty) return toggleMark(mark)(state, dispatch);
  const ranges = expandToWords(state.doc, from, to);
  if (ranges.length === 0) return false;
  if (dispatch) {
    const remove = ranges.some(([a, b]) => state.doc.rangeHasMark(a, b, mark));
    const tr = state.tr;
    for (const [a, b] of ranges) {
      if (remove) tr.removeMark(a, b, mark);
      else tr.addMark(a, b, mark.create());
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Allinea la formattazione delle parole miste in [from, to) a quella del primo carattere. */
function fixRange(tr: Transaction, from: number, to: number): void {
  for (const [a, b] of expandToWords(tr.doc, from, to)) {
    // `expandToWords` restituisce un intervallo per paragrafo: dentro vanno riesaminate le parole una a una.
    tr.doc.nodesBetween(a, b, (node, pos) => {
      if (!node.isTextblock) return true;
      const start = pos + 1;
      for (const [x, y] of wordRanges(node.textContent)) {
        const wa = start + x;
        const wb = start + y;
        if (wb <= a || wa >= b) continue;
        const sets: Array<readonly Mark[]> = [];
        tr.doc.nodesBetween(wa, wb, (n) => {
          if (n.isText) sets.push(n.marks);
        });
        const first = sets[0];
        if (!first || sets.every((s) => Mark.sameSet(s, first))) continue;
        for (const type of Object.values(schema.marks)) {
          const present = first.find((m) => m.type === type);
          if (present) tr.addMark(wa, wb, present);
          else tr.removeMark(wa, wb, type);
        }
      }
      return false;
    });
  }
}

export function normalizeMarks(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _old, newState) {
      if (!transactions.some((t) => t.docChanged)) return null;
      const tr = newState.tr;
      for (const t of transactions) {
        t.mapping.maps.forEach((map) => map.forEach((_a, _b, start, end) => {
          // Le posizioni sono nel documento dopo quel passo: le rimappo su quello finale.
          const rest = transactions.indexOf(t);
          let s = start;
          let e = end;
          for (let i = rest; i < transactions.length; i++) {
            const m = transactions[i].mapping;
            const from = i === rest ? m.maps.indexOf(map) + 1 : 0;
            for (let j = from; j < m.maps.length; j++) {
              s = m.maps[j].map(s, -1);
              e = m.maps[j].map(e, 1);
            }
          }
          fixRange(tr, Math.max(0, s - 1), Math.min(newState.doc.content.size, e + 1));
        }));
      }
      return tr.docChanged ? tr : null;
    },
  });
}

/** Normalizza un intero documento (all'apertura o al caricamento di un testo). */
export function normalizeState(state: EditorState): EditorState {
  const tr = state.tr;
  fixRange(tr, 0, state.doc.content.size);
  return tr.docChanged ? state.apply(tr.setMeta("addToHistory", false)) : state;
}
