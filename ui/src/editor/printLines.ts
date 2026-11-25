// «Una frase per riga» (M10): solo quando si stampa, dopo ogni frase che finisce con . ! ? o … si mette un a capo
// (un segnaposto <br> che si vede solo con la classe `p-oneper` sulla pagina). Non tocca il testo del documento.
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

const key = new PluginKey<boolean>("printLines");

/** Posizioni (offset nel testo del paragrafo) dopo le quali la frase finisce: dopo la punteggiatura finale e le
 *  eventuali virgolette o parentesi chiuse, solo se segue uno spazio e poi altro testo. */
export function sentenceBreaks(text: string): number[] {
  const out: number[] = [];
  const re = /[.!?…]+["»”’)\]]*(?=\s+\S)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m.index + m[0].length);
  return out;
}

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Un solo testo continuo per paragrafo (i simboli sono decorazioni, non nodi): l'offset del testo è la posizione.
    const text = node.textContent;
    if (text.length !== node.content.size) return false; // nodi non di testo dentro: non si tocca
    for (const off of sentenceBreaks(text)) {
      decos.push(
        Decoration.widget(
          pos + 1 + off,
          () => {
            const br = document.createElement("br");
            br.className = "snl";
            return br;
          },
          { side: 1, key: `snl-${pos}-${off}` },
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export function printLinesPlugin(): Plugin<boolean> {
  return new Plugin<boolean>({
    key,
    state: {
      init: () => false,
      apply: (tr, on) => (tr.getMeta(key) !== undefined ? (tr.getMeta(key) as boolean) : on),
    },
    props: {
      decorations(state) {
        return key.getState(state) ? decorate(state.doc) : DecorationSet.empty;
      },
    },
  });
}

/** Accende o spegne i segnaposto «una frase per riga». */
export function setOneLine(view: EditorView, on: boolean): void {
  if (key.getState(view.state) === on) return;
  view.dispatch(view.state.tr.setMeta(key, on).setMeta("addToHistory", false));
}
