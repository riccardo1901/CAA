// L'invito sul foglio vuoto (M11-8, PIANO-M11.md 3.5 punto 2 e 3.6). Sta SOPRA il foglio, non dentro: non entra nel
// documento e non si stampa. Sparisce alla prima lettera e torna solo con un documento vuoto. I clic passano
// attraverso (si scrive cliccando dove c'è l'invito), tranne sul collegamento «Prova con un testo di esempio».
import type { EditorView } from "prosemirror-view";
import { icona, type NomeIcona } from "./icons";

export function creaInvito(view: EditorView, wrap: HTMLElement, esempio: () => void): HTMLElement {
  const box = document.createElement("div");
  box.className = "invito";
  box.setAttribute("aria-hidden", "false");
  const titolo = document.createElement("p");
  titolo.className = "invito-titolo";
  titolo.textContent = "Scrivi qui il tuo testo: i simboli compaiono da soli sopra le parole.";
  const lista = document.createElement("ul");
  const SUGGERIMENTI: Array<[NomeIcona, string]> = [
    ["puntatore", "Clic sul simbolo di una parola per cambiarlo."],
    ["bandierina", "Le parole sottolineate in arancione sono da controllare (F8)."],
    ["stampa", "Quando hai finito: Stampa, in alto a destra."],
  ];
  for (const [ico, testo] of SUGGERIMENTI) {
    const li = document.createElement("li");
    li.append(icona(ico), document.createTextNode(testo));
    lista.append(li);
  }
  const prova = document.createElement("button");
  prova.type = "button";
  prova.className = "invito-prova";
  prova.textContent = "Prova con un testo di esempio";
  prova.addEventListener("click", esempio);
  box.append(titolo, lista, prova);
  wrap.append(box);

  // Il riquadro sta dove comincia il testo del foglio (dentro i margini), qualunque sia l'orientamento.
  const posiziona = (): void => {
    const sheet = wrap.querySelector<HTMLElement>(".sheet");
    if (!sheet) return;
    const cs = getComputedStyle(sheet);
    box.style.left = `${sheet.offsetLeft + parseFloat(cs.paddingLeft)}px`;
    box.style.top = `${sheet.offsetTop + parseFloat(cs.paddingTop)}px`;
    box.style.width = `${sheet.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`;
  };
  const vuoto = (): boolean => view.state.doc.textContent.length === 0;
  const aggiorna = (): void => {
    box.hidden = !vuoto();
    if (!box.hidden) posiziona();
  };
  // Ogni modifica del testo (anche aprire un documento o «Nuovo») passa dal DOM dell'editor.
  new MutationObserver(aggiorna).observe(view.dom, { childList: true, subtree: true, characterData: true });
  const sheet = wrap.querySelector(".sheet");
  const ro = new ResizeObserver(aggiorna);
  ro.observe(wrap);
  if (sheet) ro.observe(sheet);
  aggiorna();
  return box;
}
