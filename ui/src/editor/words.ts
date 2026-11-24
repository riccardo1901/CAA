// Riconoscimento delle parole di un paragrafo (versione del prototipo).
//
// Gli offset sono in unità UTF-16, come in JavaScript e in ProseMirror (SPEC.md, "Offset dei
// caratteri"). L'elisione resta attaccata al prefisso: "l'albero" → "l'" + "albero".

// Le stesse regole del tokenizzatore del motore (crates/caa-engine/src/tokenize.rs): trattino tra due
// lettere dentro la parola ("anti-age", "e-mail"), numeri con . , : / ("12/11/2026"). Se le due
// divergono, il grassetto spezza un token del motore a metà e il simbolo finisce su metà parola.
const WORD_RE = /\p{L}[\p{L}\p{M}\p{N}]*(?:[-\u2010\u2011][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*['’]?|\d+(?:[.,:/]\d+)*/gu;

/** Intervalli [da, a) delle parole nel testo di un paragrafo. */
export function wordRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    out.push([start, start + m[0].length]);
  }
  return out;
}
