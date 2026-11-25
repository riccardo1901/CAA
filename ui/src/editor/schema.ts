// Modello del documento (SPEC.md, "Modello del documento"): titolo a due livelli, paragrafo,
// testo, grassetto e `pick` (scelta del docente su una parola, M8b). Il mark `group` arriva con M8c.
import { Schema } from "prosemirror-model";

export const schema = new Schema({
  nodes: {
    // `locks`: i blocchi di senso del documento ("usa per tutto il testo": il lemma, con la categoria, prende
    // sempre quel simbolo). Stanno nei dati del documento (SPEC.md: `sense_locks`), non su una parola:
    // cancellare la parola su cui si è scelto non li scioglie. Vedi `picks.ts`.
    doc: { content: "block+", attrs: { locks: { default: [] } } },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
      ],
      toDOM: (node) => [`h${node.attrs.level as number}`, 0],
    },
    text: { group: "inline" },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    // Scelta esplicita del docente su UNA parola (SPEC.md, "Modello del documento"): segue il testo e
    // rientra in annulla/ripeti perché è un mark. `picto`: id ARASAAC, 0 = nessun simbolo, -1 = solo
    // testo. `word` (minuscola) dice a quale parola si riferisce: se la parola cambia la scelta non vale più.
    pick: {
      attrs: {
        word: { default: "" },
        picto: { default: 0 },
        lemma: { default: "" },
        cat: { default: "" },
        // Simbolo personale (M8c-3): l'identificativo che viaggia nel documento (l'id numerico vale solo su questo computer).
        uuid: { default: "" },
      },
      inclusive: false,
      // Gli attributi viaggiano nel DOM: copia, taglia e incolla (anche da un altro punto del testo) portano con sé le scelte.
      toDOM: (mark) => [
        "span",
        {
          class: "pk",
          "data-word": mark.attrs.word as string,
          "data-picto": String(mark.attrs.picto),
          "data-lemma": mark.attrs.lemma as string,
          "data-cat": mark.attrs.cat as string,
          "data-uuid": mark.attrs.uuid as string,
        },
        0,
      ],
      parseDOM: [
        {
          tag: "span.pk",
          getAttrs: (dom) => {
            const e = dom as HTMLElement;
            return {
              word: e.dataset.word ?? "",
              // I valori speciali di «unisci» e «dividi» (da 2^32-2) non sono pittogrammi: un HTML incollato non li porta nel motore.
              picto: Math.min(Number(e.dataset.picto ?? 0) || 0, 4294967293),
              lemma: e.dataset.lemma ?? "",
              cat: e.dataset.cat ?? "",
              uuid: e.dataset.uuid ?? "",
            };
          },
        },
      ],
    },
    // Unione o divisione manuale di parole (M8c-2): copre le parole (e gli spazi in mezzo) di una frase da
    // trattare come un simbolo solo (`merge`) o da non unire (`split`, per le espressioni che il motore
    // riconosce da solo). `text` (minuscolo) dice a quale testo si riferisce: se cambia, non vale più.
    group: {
      attrs: { text: { default: "" }, mode: { default: "merge" } },
      inclusive: false,
      toDOM: (mark) => ["span", { class: "gp", "data-text": mark.attrs.text as string, "data-mode": mark.attrs.mode as string }, 0],
      parseDOM: [
        {
          tag: "span.gp",
          getAttrs: (dom) => {
            const e = dom as HTMLElement;
            return { text: e.dataset.text ?? "", mode: e.dataset.mode === "split" ? "split" : "merge" };
          },
        },
      ],
    },
  },
});
