// Modello del documento (SPEC.md, "Modello del documento"): titolo a due livelli, paragrafo,
// testo, grassetto e `pick` (scelta del docente su una parola, M8b). Il mark `group` arriva con M8c.
import { Schema } from "prosemirror-model";

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
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
    // `lock` = "usa per tutto il testo": il lemma (con la categoria) prende sempre quel simbolo.
    pick: {
      attrs: {
        word: { default: "" },
        picto: { default: 0 },
        lock: { default: 0 },
        lemma: { default: "" },
        cat: { default: "" },
      },
      inclusive: false,
      // Gli attributi viaggiano nel DOM: copia, taglia e incolla (anche da un altro punto del testo) portano con sé le scelte.
      toDOM: (mark) => [
        "span",
        {
          class: "pk",
          "data-word": mark.attrs.word as string,
          "data-picto": String(mark.attrs.picto),
          "data-lock": String(mark.attrs.lock),
          "data-lemma": mark.attrs.lemma as string,
          "data-cat": mark.attrs.cat as string,
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
              picto: Number(e.dataset.picto ?? 0) || 0,
              lock: e.dataset.lock === "1" ? 1 : 0,
              lemma: e.dataset.lemma ?? "",
              cat: e.dataset.cat ?? "",
            };
          },
        },
      ],
    },
  },
});
