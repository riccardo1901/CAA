// Finestre: un solo comportamento per tutte (M11-3, PIANO-M11.md 3.4; difetto K6).
//   - il tasto Tab gira DENTRO la finestra (il resto della pagina diventa «inerte» finché è aperta);
//   - Esc chiude (tranne le finestre che chiedono qualcosa di obbligatorio, come il nome al primo avvio);
//   - un clic sul velo attorno chiude (se la finestra lo permette);
//   - alla chiusura il fuoco torna al controllo che l'ha aperta (se nel frattempo non è andato altrove apposta).

export interface OpzioniFinestra {
  /** Il velo che copre la pagina (contiene la finestra; è già nel documento). */
  overlay: HTMLElement;
  /** La finestra vera e propria. */
  box: HTMLElement;
  /** Il nome della finestra per i lettori di schermo (se non ce l'ha già). */
  nome?: string;
  /** Esc chiude (di partenza sì). */
  esc?: boolean;
  /** Un clic sul velo chiude (di partenza sì). */
  clicFuori?: boolean;
  /** Dove va il fuoco all'apertura (di partenza: il primo controllo). */
  fuoco?: HTMLElement | null;
  /** Dopo la chiusura (per qualunque motivo). */
  onChiudi?: () => void;
}

const pila: HTMLElement[] = [];

const SELETTORE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** I controlli della finestra che si raggiungono con Tab, nell'ordine. */
function raggiungibili(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(SELETTORE)].filter((e) => {
    if ((e as HTMLButtonElement).disabled || e.closest("[hidden], [inert]")) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/** Una finestra aperta adesso sopra tutte le altre? (per esempio una conferma sopra Documenti) */
export function finestraAperta(): boolean {
  return pila.length > 0;
}

/** Dà il comportamento unico alla finestra; restituisce la funzione che la chiude. */
export function finestra(o: OpzioniFinestra): () => void {
  const { overlay, box } = o;
  const apertoDa = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  box.setAttribute("role", box.getAttribute("role") ?? "dialog");
  box.setAttribute("aria-modal", "true");
  if (o.nome && !box.hasAttribute("aria-label") && !box.hasAttribute("aria-labelledby")) box.setAttribute("aria-label", o.nome);
  if (!box.hasAttribute("tabindex")) box.tabIndex = -1;

  // Il resto della pagina non si raggiunge (né con Tab né con il mouse né con il lettore di schermo).
  const resi: Element[] = [];
  for (const c of document.body.children) {
    if (c === overlay || c.hasAttribute("inert") || c.matches("script, style, .tip, .toasts")) continue;
    c.setAttribute("inert", "");
    resi.push(c);
  }
  pila.push(box);

  let chiusa = false;
  const chiudi = (): void => {
    if (chiusa) return;
    chiusa = true;
    document.removeEventListener("keydown", tasti, true);
    overlay.remove();
    for (const c of resi) c.removeAttribute("inert");
    const i = pila.lastIndexOf(box);
    if (i >= 0) pila.splice(i, 1);
    o.onChiudi?.();
    // Il fuoco torna dove era, se nessuno l'ha già spostato apposta.
    const a = document.activeElement;
    if ((!a || a === document.body || !a.isConnected) && apertoDa?.isConnected && !apertoDa.closest("[inert]")) apertoDa.focus();
  };

  function tasti(e: KeyboardEvent): void {
    if (pila[pila.length - 1] !== box) return; // risponde solo la finestra in cima
    if (e.key === "Escape" && o.esc !== false) {
      e.preventDefault();
      e.stopPropagation();
      chiudi();
      return;
    }
    if (e.key !== "Tab") return;
    const lista = raggiungibili(box);
    if (lista.length === 0) {
      e.preventDefault();
      box.focus();
      return;
    }
    const primo = lista[0];
    const ultimo = lista[lista.length - 1];
    const qui = document.activeElement;
    const dentro = qui instanceof HTMLElement && box.contains(qui);
    if (e.shiftKey && (!dentro || qui === primo || qui === box)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (!dentro || qui === ultimo)) {
      e.preventDefault();
      primo.focus();
    }
  }
  document.addEventListener("keydown", tasti, true);
  if (o.clicFuori !== false) {
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) chiudi();
    });
  }
  const fuoco = o.fuoco === undefined ? raggiungibili(box)[0] ?? box : o.fuoco ?? box;
  fuoco.focus();
  return chiudi;
}
