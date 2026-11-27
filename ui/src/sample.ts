// Testo di prova: storia scolastica con parole accentate, elisioni, numeri e grassetto,
// abbastanza lunga da riempire tre pagine con i simboli di dimensione media.
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "./editor/schema";

type Run = string | { b: string };

const PARAGRAPHS: Run[][] = [
  ["C'era una volta una bambina di nome Giulia che viveva in una piccola città vicino al mare. Ogni mattina, prima di andare a scuola, dava da mangiare al suo gatto, che si chiamava Pepe."],
  ["Quest'anno Giulia frequentava la terza elementare. Alla maestra piaceva molto perché la bambina era gentile, curiosa e faceva sempre tante domande sull'acqua, sul cielo e sugli animali."],
  ["Un giorno, mentre tornava a casa con la sua amica Marta, vide un uccellino ferito sotto l'albero del giardino. Era piccolo, tremava e non riusciva a volare. «Poverino!» disse Giulia."],
  ["Prova del grassetto: una parola ", { b: "tutta" }, " in grassetto, una frase ", { b: "intera in grassetto" }, " e una parola a metà gras", { b: "setto" }, "."],
  ["Le due amiche presero l'uccellino con delicatezza e lo portarono a casa. La mamma di Giulia preparò una scatola con un po' di paglia e un panno morbido. Poi chiamarono il veterinario, che arrivò alle 10:30."],
  ["Il veterinario guardò l'ala del piccolo e sorrise. «Non è niente di grave», spiegò, «ma dovrà riposare per tre giorni. Datemi una mano: più è tranquillo, prima guarisce.»"],
  ["Per tre giorni Giulia e Marta si occuparono dell'uccellino. Gli davano acqua fresca, qualche briciola di pane e un po' di frutta. Pepe, il gatto, lo osservava da lontano, con la coda ferma e gli occhi grandi."],
  ["Il quarto giorno l'uccellino saltellava già nella scatola e cantava piano. Giulia capì che era arrivato il momento di lasciarlo andare. Era un po' triste, ma sapeva che era la cosa giusta."],
  ["Il pomeriggio andarono tutti in giardino. La mamma aprì la scatola, Giulia sollevò l'uccellino sul palmo della mano e Marta contò: uno, due, tre! L'uccellino aprì le ali e volò sopra i tetti della città."],
  ["Da quel giorno, ogni mattina, un uccellino si posava sul davanzale della finestra di Giulia. Cantava una canzone breve, come per dire grazie, e poi tornava verso il mare. Giulia lo salutava sempre con la mano."],
];

function paragraph(runs: Run[]): PMNode {
  const nodes = runs.map((r) =>
    typeof r === "string"
      ? schema.text(r)
      : schema.text(r.b, [schema.marks.strong.create()]),
  );
  return schema.nodes.paragraph.create(null, nodes);
}

/** Documento di prova; `repeat` ripete la storia per prove di carico. */
export function sampleDoc(repeat = 1): PMNode {
  const blocks: PMNode[] = [schema.nodes.heading.create({ level: 1 }, schema.text("La bambina e l'uccellino"))];
  for (let i = 0; i < repeat; i++) {
    if (i > 0) blocks.push(schema.nodes.heading.create({ level: 2 }, schema.text(`Capitolo ${i + 1}`)));
    for (const p of PARAGRAPHS) blocks.push(paragraph(p));
  }
  return schema.nodes.doc.create(null, blocks);
}

/** Il «Testo di esempio» che vede il docente: una breve storia pulita (nessuna riga di prova, niente grassetti strani). */
export function exampleDoc(): PMNode {
  const blocks: PMNode[] = [
    schema.nodes.heading.create({ level: 1 }, schema.text("La bambina e l'uccellino")),
    paragraph(["C'era una volta una bambina di nome Giulia che viveva in una piccola città vicino al mare. Ogni mattina, prima di andare a scuola, dava da mangiare al suo gatto, che si chiamava Pepe."]),
    paragraph(["Un giorno, mentre tornava a casa con la sua amica Marta, vide un uccellino ferito sotto l'albero del giardino. Era piccolo, tremava e non riusciva a volare. «Poverino!» disse Giulia."]),
    paragraph(["Le due amiche presero l'uccellino con delicatezza e lo portarono a casa. La mamma preparò una scatola con un po' di paglia e un panno morbido."]),
    paragraph(["Per tre giorni Giulia e Marta si occuparono dell'uccellino. Gli davano acqua fresca, qualche briciola di pane e un po' di frutta."]),
    paragraph(["Il quarto giorno l'uccellino saltellava già nella scatola e cantava piano. Giulia lo lasciò andare in giardino e lui volò sopra i tetti."]),
  ];
  return schema.nodes.doc.create(null, blocks);
}

export function emptyDoc(): PMNode {
  return schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
}

/** Molte parole spezzate dalla formattazione (anche in tre pezzi), per provare l'a capo. */
export function fragmentsDoc(words = 90): PMNode {
  const runs: Run[] = [];
  const forms: Run[][] = [
    ["casa", { b: "lingo" }, " "],
    [{ b: "ba" }, "m", { b: "bi" }, "na "],
    ["pa", { b: "ro" }, "la "],
    ["tutto ", { b: "gras" }, { b: "setto" }, " "],
  ];
  for (let i = 0; i < words; i++) runs.push(...forms[i % forms.length]);
  return schema.nodes.doc.create(null, [paragraph(runs)]);
}
