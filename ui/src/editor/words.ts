// Riconoscimento delle parole di un paragrafo (versione del prototipo).
//
// Gli offset sono in unità UTF-16, come in JavaScript e in ProseMirror (SPEC.md, "Offset dei
// caratteri"). L'elisione resta attaccata al prefisso: "l'albero" → "l'" + "albero".

const WORD_RE = /\p{L}[\p{L}\p{M}]*['’]?|\d+(?:[.,:]\d+)*/gu;

/** Intervalli [da, a) delle parole nel testo di un paragrafo. */
export function wordRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    out.push([start, start + m[0].length]);
  }
  return out;
}
