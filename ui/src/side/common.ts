// Pezzi comuni alle schede «Simbolo» e «Memoria» del pannello laterale (M11-7).

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Una riga con le scorciatoie scritte come tasti (PIANO-M11.md 3.7 e 3.10): le parti fra parentesi quadre diventano
 * tasti, il resto resta testo. «[1]–[8] scegli · [Esc] torna al testo» → <kbd>1</kbd>–<kbd>8</kbd> scegli · …
 */
export function conTasti(box: HTMLElement, testo: string): HTMLElement {
  for (const parte of testo.split(/(\[[^\]]+\])/)) {
    if (parte === "") continue;
    const m = /^\[([^\]]+)\]$/.exec(parte);
    box.append(m ? el("kbd", "key", m[1]) : document.createTextNode(parte));
  }
  return box;
}

/** Titolo di una sezione della scheda (h3) con il suo identificativo, per dare il nome alla sezione. */
let numero = 0;
export function sezione(cls: string, titolo: string): { box: HTMLElement; title: HTMLHeadingElement } {
  const box = el("section", `pm-sec ${cls}`);
  const title = el("h3", "pm-sec-title", titolo);
  title.id = `pm-sec-${++numero}`;
  box.setAttribute("aria-labelledby", title.id);
  box.append(title);
  return { box, title };
}

/**
 * Le parole governate dalla politica delle parole funzionali (K4): articoli, clitici non riflessivi, «che»,
 * preposizioni (semplici e articolate) e congiunzioni. Sono le categorie che il motore guarda in `apply_policy`
 * (crates/caa-engine/src/engine.rs): «che» per lemma, le altre per categoria. I nomi delle categorie sono quelli
 * che l'interfaccia riceve nel token (`cat`, da `Cat::name()`): ART, CLITIC, ADP, ARTADP, CONJ.
 * Il motore oggi lascia vincere la memoria sulla politica: per queste parole «ricorda per sempre» resta spento.
 */
const CATEGORIE_DELLA_POLITICA = new Set(["ART", "CLITIC", "ADP", "ARTADP", "CONJ"]);
export function governataDallaPolitica(lemmaOForma: string, cat: string): boolean {
  if (lemmaOForma.normalize("NFC").trim().toLowerCase() === "che") return true;
  return CATEGORIE_DELLA_POLITICA.has(cat);
}

/** La spiegazione sul controllo spento (suggerimento). */
export const SPIEGAZIONE_POLITICA =
  "Non si può ricordare: per articoli, preposizioni, congiunzioni, «che» e pronomi come «lo» decide la politica delle parole funzionali, nella barra degli strumenti.";
