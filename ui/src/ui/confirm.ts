// Conferme del programma (M11-3, PIANO-M11.md 3.3; difetto K7): al posto della finestra del sistema con OK/Annulla,
// una finestra del programma con la domanda, una riga di spiegazione e il verbo sul pulsante («Elimina», «Ritira»,
// «Esci senza salvare»), rosso se l'azione non si annulla. Esc o clic fuori = Annulla.
import { finestra } from "./dialog";

export interface Conferma {
  /** La domanda, breve («Eliminare «La storia del gatto»?»). */
  domanda: string;
  /** Una riga che spiega cosa succede («Non si può annullare.»). */
  spiegazione?: string;
  /** Il verbo del pulsante che conferma («Elimina»). */
  azione: string;
  /** Il testo del pulsante che rinuncia (di partenza «Annulla»). */
  annulla?: string;
  /** L'azione non si annulla: pulsante rosso, e il fuoco parte da «Annulla». */
  pericolo?: boolean;
}

/** Per le prove automatiche: se c'è, risponde lei (sì o no) senza mostrare la finestra, come facevano le prove con
 *  la conferma del browser. Non esiste nel programma vero. */
type RispostaDiProva = (c: Conferma) => boolean | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

let numero = 0;

/** Chiede conferma; risponde true se il docente sceglie l'azione. */
export function conferma(c: Conferma): Promise<boolean> {
  const prova = (window as unknown as { __caaConferma?: RispostaDiProva }).__caaConferma;
  if (typeof prova === "function") {
    const r = prova(c);
    if (r !== undefined) return Promise.resolve(r);
  }
  return new Promise((resolve) => {
    const overlay = el("div", "dialog-overlay confirm-overlay");
    const box = el("div", "dialog confirm-dialog");
    const id = `conferma-${++numero}`;
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-labelledby", `${id}-t`);
    const titolo = el("h2", "", c.domanda);
    titolo.id = `${id}-t`;
    box.append(titolo);
    if (c.spiegazione) {
      const p = el("p", "dialog-text", c.spiegazione);
      p.id = `${id}-d`;
      box.setAttribute("aria-describedby", p.id);
      box.append(p);
    }
    const azioni = el("div", "dialog-actions");
    const no = el("button", "", c.annulla ?? "Annulla");
    no.type = "button";
    const si = el("button", c.pericolo ? "danger" : "primary", c.azione);
    si.type = "button";
    // La principale per ultima, a destra.
    azioni.append(no, si);
    box.append(azioni);
    overlay.append(box);
    document.body.append(overlay);
    let risposta = false;
    const chiudi = finestra({ overlay, box, fuoco: c.pericolo ? no : si, onChiudi: () => resolve(risposta) });
    no.addEventListener("click", () => chiudi());
    si.addEventListener("click", () => {
      risposta = true;
      chiudi();
    });
  });
}
