// Il menu «Altro» (M11-4, PIANO-M11.md 3.1 e sezione 0 punto 7): azioni che si usano di rado (Testo di esempio,
// Informazioni, versione nuova del programma) e, quando sullo schermo manca spazio, i gruppi della barra degli
// strumenti che non ci stanno (si spostano qui interi, con i loro controlli veri). Si apre con clic, Invio o ↓; le
// frecce scorrono le voci; Esc o un clic fuori lo chiudono e il fuoco torna al pulsante.
import { icona, type NomeIcona } from "./icons";
import { suggerimento } from "./tooltip";

export interface MenuAltro {
  /** Il pulsante «Altro» (con il pallino quando c'è qualcosa di nuovo). */
  button: HTMLButtonElement;
  /** Il riquadro (sta nel documento, nascosto finché non si apre). */
  panel: HTMLDivElement;
  /** Aggiunge una voce fissa; restituisce l'elemento (per nasconderlo o cambiarne il testo). */
  voce(testo: string, fai: () => void, ico?: NomeIcona): HTMLButtonElement;
  /** Un gruppo di scelte «una fra tante» (per esempio la dimensione dell'interfaccia), con un titolo. */
  scelta(titolo: string, opzioni: Array<[valore: string, testo: string]>, attuale: () => string, cambia: (valore: string) => void): void;
  /** La zona dove vanno i gruppi della barra che non ci stanno. */
  strumenti: HTMLDivElement;
  /** Accende o spegne il pallino («c'è una novità»). */
  pallino(acceso: boolean): void;
  apri(): void;
  chiudi(rimettiFuoco?: boolean): void;
  aperto(): boolean;
}

export function creaMenuAltro(): MenuAltro {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-button icon-only";
  button.setAttribute("aria-label", "Altro");
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  button.append(icona("altro"));
  const dot = document.createElement("span");
  dot.className = "menu-dot";
  dot.hidden = true;
  button.append(dot);
  suggerimento(button, "Altro: testo di esempio, informazioni e i comandi che non stanno nella barra");

  const panel = document.createElement("div");
  panel.className = "menu";
  panel.hidden = true;
  panel.id = "menu-altro";
  button.setAttribute("aria-controls", panel.id);
  const lista = document.createElement("div");
  lista.className = "menu-list";
  lista.setAttribute("role", "menu");
  lista.setAttribute("aria-label", "Altro");
  const strumenti = document.createElement("div");
  strumenti.className = "menu-tools";
  strumenti.setAttribute("role", "group");
  strumenti.setAttribute("aria-label", "Strumenti che non stanno nella barra");
  // Prima le voci fisse, poi gli strumenti che non stanno nella barra.
  panel.append(lista, strumenti);

  const voci = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio], .menu-tools button, .menu-tools select, .menu-tools input")].filter(
      (e) => !e.closest("[hidden]") && !(e as HTMLButtonElement).disabled,
    );

  const aperto = (): boolean => !panel.hidden;
  const fuori = (e: Event): void => {
    const t = e.target as Node;
    if (!panel.contains(t) && !button.contains(t)) chiudi(false);
  };
  function chiudi(rimettiFuoco = true): void {
    if (!aperto()) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", fuori, true);
    if (rimettiFuoco) button.focus();
  }
  function apri(): void {
    if (aperto()) return;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    // Sotto il pulsante, allineato a destra, mai fuori dallo schermo (scorre dentro se è più alto).
    const r = button.getBoundingClientRect();
    panel.style.top = `${r.bottom + 4}px`;
    panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    panel.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 16)}px`;
    document.addEventListener("pointerdown", fuori, true);
    voci()[0]?.focus();
  }
  button.addEventListener("click", () => (aperto() ? chiudi() : apri()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !aperto()) {
      e.preventDefault();
      apri();
    }
  });
  panel.addEventListener("keydown", (e) => {
    const lista = voci();
    const i = lista.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      chiudi();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (document.activeElement as HTMLElement | null)?.tagName !== "SELECT") {
      e.preventDefault();
      const j = e.key === "ArrowDown" ? (i + 1) % lista.length : (i - 1 + lista.length) % lista.length;
      lista[j]?.focus();
    } else if (e.key === "Tab") {
      // Uscendo con Tab il menu si chiude (il fuoco va avanti normalmente).
      setTimeout(() => {
        if (!panel.contains(document.activeElement)) chiudi(false);
      });
    }
  });

  return {
    button,
    panel,
    strumenti,
    voce(testo, fai, ico) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "menu-item";
      b.setAttribute("role", "menuitem");
      if (ico) b.append(icona(ico));
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = testo;
      b.append(lbl);
      b.addEventListener("click", () => {
        // Il fuoco torna su «Altro»: chi apre una finestra da qui ci ritorna quando la chiude.
        chiudi(true);
        fai();
      });
      lista.append(b);
      return b;
    },
    scelta(titolo, opzioni, attuale, cambia) {
      const t = document.createElement("div");
      t.className = "menu-heading";
      t.textContent = titolo;
      t.setAttribute("role", "presentation");
      const gruppo = document.createElement("div");
      gruppo.setAttribute("role", "group");
      gruppo.setAttribute("aria-label", titolo);
      const pulsanti = opzioni.map(([valore, testo]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "menu-item menu-radio";
        b.setAttribute("role", "menuitemradio");
        b.dataset.valore = valore;
        const lbl = document.createElement("span");
        lbl.className = "lbl";
        lbl.textContent = testo;
        b.append(icona("ok"), lbl);
        b.addEventListener("click", () => {
          cambia(valore);
          segna();
          chiudi(true);
        });
        gruppo.append(b);
        return b;
      });
      const segna = (): void => {
        for (const b of pulsanti) b.setAttribute("aria-checked", String(b.dataset.valore === attuale()));
      };
      segna();
      // Il segno si aggiorna anche ogni volta che il menu si apre.
      button.addEventListener("click", segna);
      lista.append(t, gruppo);
    },
    pallino: (acceso) => {
      dot.hidden = !acceso;
    },
    apri,
    chiudi,
    aperto,
  };
}
