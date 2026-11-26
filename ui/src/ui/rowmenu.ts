// Il menu «⋯» delle righe di un elenco (M11-6, PIANO-M11.md 2.7 «Riga di elenco» e «Menu»): l'azione principale
// della riga sta a destra in vista, le altre (Pubblica, Elimina, Ritira…) in questo menu.
//   - si apre con clic, Invio, Spazio o ↓ sul pulsante; il fuoco va sulla prima voce;
//   - ↓ ↑ (e Inizio / Fine) scorrono le voci, Esc chiude e il fuoco torna al pulsante;
//   - Tab o un clic fuori lo chiudono.
// Il riquadro sta dentro la riga (quindi dentro la finestra Documenti, che tiene il Tab al suo interno), ma è
// «fisso» sullo schermo: non lo taglia l'elenco che scorre.
import { icona, type NomeIcona } from "./icons";

export interface VoceMenuRiga {
  testo: string;
  icona?: NomeIcona;
  fai: () => void;
  /** Azione che non si annulla (Elimina, Ritira): testo rosso; la conferma la chiede chi la esegue. */
  pericolo?: boolean;
  /** Se c'è, la voce è spenta e questo testo dice perché (suggerimento). */
  spenta?: string;
}

/** Il menu aperto adesso (uno solo alla volta). */
let chiudiAperto: ((rimettiFuoco: boolean) => void) | null = null;

/** Crea il pulsante «⋯» con il suo menu. `nome` è il nome per i lettori di schermo («Altre azioni per «Storia»»). */
export function menuRiga(nome: string, voci: VoceMenuRiga[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "row-more";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-more-button icon-only";
  button.setAttribute("aria-label", nome);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.dataset.tip = "Altre azioni";
  button.append(icona("altro"));
  box.append(button);

  let menu: HTMLElement | null = null;

  const attive = (): HTMLButtonElement[] => (menu ? [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].filter((b) => !b.disabled) : []);

  function chiudi(rimettiFuoco: boolean): void {
    if (!menu) return;
    menu.remove();
    menu = null;
    button.setAttribute("aria-expanded", "false");
    window.removeEventListener("keydown", tasti, true);
    document.removeEventListener("pointerdown", fuori, true);
    window.removeEventListener("scroll", alloScorrere, true);
    window.removeEventListener("resize", alloScorrere);
    if (chiudiAperto === chiudi) chiudiAperto = null;
    if (rimettiFuoco) button.focus();
  }

  const fuori = (e: Event): void => {
    const t = e.target as Node;
    if (menu && !menu.contains(t) && !button.contains(t)) chiudi(false);
  };
  // L'elenco scorre o la finestra cambia misura: il riquadro resterebbe nel posto sbagliato.
  const alloScorrere = (e: Event): void => {
    if (menu && e.target instanceof Node && menu.contains(e.target)) return;
    chiudi(false);
  };

  // Ascolta sulla finestra in fase di cattura: prima della finestra Documenti, che altrimenti con Esc si chiuderebbe.
  function tasti(e: KeyboardEvent): void {
    if (!menu) return;
    // L'elenco è stato ridisegnato (o la finestra chiusa) con il menu aperto: si chiude senza rubare il tasto.
    if (!box.isConnected) return chiudi(false);
    const lista = attive();
    const qui = document.activeElement as HTMLElement | null;
    const dentro = !!qui && menu.contains(qui);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      chiudi(true);
      return;
    }
    if (e.key === "Tab") {
      // Il fuoco torna al pulsante e il Tab prosegue da lì (la finestra Documenti fa il resto).
      chiudi(dentro);
      return;
    }
    if (!dentro || lista.length === 0) return;
    const i = lista.indexOf(qui as HTMLButtonElement);
    let j = -1;
    if (e.key === "ArrowDown") j = (i + 1) % lista.length;
    else if (e.key === "ArrowUp") j = (i - 1 + lista.length) % lista.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = lista.length - 1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    lista[j].focus();
  }

  function apri(): void {
    if (menu) return;
    chiudiAperto?.(false);
    menu = document.createElement("div");
    menu.className = "row-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", nome);
    for (const v of voci) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = v.pericolo ? "row-menu-item danger-text" : "row-menu-item";
      b.setAttribute("role", "menuitem");
      if (v.icona) b.append(icona(v.icona));
      const lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = v.testo;
      b.append(lbl);
      if (v.spenta) {
        b.disabled = true;
        b.title = v.spenta;
      }
      b.addEventListener("click", () => {
        // Prima il fuoco torna al pulsante: una conferma aperta dall'azione, chiudendosi, ci ritorna.
        chiudi(true);
        v.fai();
      });
      menu.append(b);
    }
    box.append(menu);
    button.setAttribute("aria-expanded", "true");
    // Sotto il pulsante, allineato a destra; sopra se sotto non c'è posto; mai fuori dallo schermo.
    const r = button.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const margine = 8;
    let top = r.bottom + 4;
    if (top + m.height > window.innerHeight - margine) top = Math.max(margine, r.top - m.height - 4);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(margine, Math.min(r.right - m.width, window.innerWidth - m.width - margine))}px`;
    window.addEventListener("keydown", tasti, true);
    document.addEventListener("pointerdown", fuori, true);
    window.addEventListener("scroll", alloScorrere, true);
    window.addEventListener("resize", alloScorrere);
    chiudiAperto = chiudi;
    attive()[0]?.focus();
  }

  button.addEventListener("click", () => (menu ? chiudi(true) : apri()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !menu) {
      e.preventDefault();
      apri();
    }
  });
  return box;
}
