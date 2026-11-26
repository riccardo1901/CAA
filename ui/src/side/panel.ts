// Il pannello laterale richiudibile (M11-4, PIANO-M11.md 3.1, 3.2 e sezione 0 punto 7; difetti K11, D7).
//
// Due modi, decisi dalla larghezza: il foglio (A4 verticale o orizzontale) deve stare intero accanto al pannello.
//   - schermo largo: il pannello sta accanto al foglio, aperto, finché il docente non lo chiude;
//   - schermo stretto: il pannello parte chiuso (una striscia stretta con il pulsante per aprirlo); quando si apre
//     (pulsante, clic sul simbolo, Alt+↓, F8) si appoggia SOPRA la scrivania, senza spostare il foglio, e si richiude
//     con il pulsante o con Esc.
// Schede: «Simbolo» (le alternative della parola) e quelle aggiunte con aggiungiScheda() («Pagina» in M11-5,
// «Memoria» in M11-7). Le linguette si scorrono con ← → (Home, Fine); una sola scheda alla volta è visibile.
import { icona } from "../ui/icons";
import { suggerimento } from "../ui/tooltip";

export interface PannelloLaterale {
  root: HTMLElement;
  apri(): void;
  chiudi(): void;
  aperto(): boolean;
  /** Il pannello aperto sta sopra il foglio (schermo stretto). */
  sopra(): boolean;
  /** Ricalcola il modo (dopo un cambio di orientamento del foglio, per esempio). */
  aggiorna(): void;
  /** Con il pannello sopra il foglio: fa scorrere il foglio perché la parola scelta non resti coperta. */
  mostraParola(): void;
  /** Aggiunge una scheda (dopo quelle che ci sono). Il contenuto diventa il suo riquadro. */
  aggiungiScheda(id: string, nome: string, contenuto: HTMLElement): void;
  /** Apre il pannello sulla scheda indicata (con fuoco: il fuoco va sulla linguetta). */
  mostraScheda(id: string, fuoco?: boolean): void;
  /** La scheda visibile adesso. */
  schedaAttiva(): string;
  /** Chiamata quando cambia la scheda visibile. */
  onScheda(cb: (id: string) => void): void;
}

export function creaPannelloLaterale(contenuto: HTMLElement, layout: HTMLElement, wrap: HTMLElement): PannelloLaterale {
  // Una zona con nome per i lettori di schermo (M11-9, PIANO-M11.md 3.8).
  const root = document.createElement("aside");
  root.className = "side-panel";
  root.setAttribute("aria-label", "Pannello laterale");
  const inner = document.createElement("div");
  inner.className = "side-inner";
  const head = document.createElement("div");
  head.className = "side-head";
  const linguette = document.createElement("div");
  linguette.className = "side-tabs";
  linguette.setAttribute("role", "tablist");
  linguette.setAttribute("aria-label", "Schede del pannello laterale");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "side-toggle icon-only";
  head.append(linguette, toggle);
  inner.append(head);
  root.append(inner);

  interface Scheda {
    id: string;
    tab: HTMLButtonElement;
    pane: HTMLElement;
  }
  const schede: Scheda[] = [];
  let attiva = "simbolo";
  const ascoltatori: Array<(id: string) => void> = [];
  function aggiungiScheda(id: string, nome: string, pane: HTMLElement): void {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "side-tab";
    tab.id = `scheda-${id}`;
    tab.textContent = nome;
    tab.setAttribute("role", "tab");
    pane.id = pane.id || `riquadro-${id}`;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", tab.id);
    pane.classList.add("side-pane");
    tab.setAttribute("aria-controls", pane.id);
    tab.addEventListener("click", () => mostraScheda(id));
    linguette.append(tab);
    inner.append(pane);
    schede.push({ id, tab, pane });
    disegna();
  }
  // Frecce fra le linguette (come vuole il ruolo «tablist»).
  linguette.addEventListener("keydown", (e) => {
    const i = schede.findIndex((s) => s.id === attiva);
    let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % schede.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + schede.length) % schede.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = schede.length - 1;
    if (j < 0) return;
    e.preventDefault();
    mostraScheda(schede[j].id, true);
  });

  let chiusoDalDocente = false; // schermo largo: il docente l'ha chiuso
  let apertoSopra = false; // schermo stretto: aperto sopra la scrivania
  let stretto = false;

  /** Il foglio non sta intero accanto al pannello aperto. */
  const calcolaStretto = (): boolean => {
    const sheet = wrap.querySelector<HTMLElement>(".sheet");
    if (!sheet) return false;
    const cs = getComputedStyle(wrap);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    // La larghezza del pannello aperto (--w-side, in rem: segue la dimensione dell'interfaccia).
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const pannello = (parseFloat(getComputedStyle(root).getPropertyValue("--w-side")) || 21.25) * rem;
    return layout.clientWidth < sheet.offsetWidth + pad + pannello;
  };

  const aperto = (): boolean => (stretto ? apertoSopra : !chiusoDalDocente);

  function disegna(): void {
    const ap = aperto();
    root.classList.toggle("open", ap);
    root.classList.toggle("closed", !ap);
    root.classList.toggle("sopra", stretto && ap);
    // Con il pannello sopra, la scrivania si allarga a destra: il foglio può scorrere da sotto il pannello.
    layout.classList.toggle("con-pannello-sopra", stretto && ap);
    linguette.hidden = !ap;
    for (const s of schede) {
      const qui = s.id === attiva;
      s.pane.hidden = !ap || !qui;
      s.tab.setAttribute("aria-selected", String(qui));
      s.tab.tabIndex = qui ? 0 : -1;
      s.tab.classList.toggle("on", qui);
    }
    toggle.replaceChildren(icona(ap ? "chiudiPannello" : "apriPannello"));
    const nome = ap ? "Chiudi il pannello laterale" : "Apri il pannello laterale";
    toggle.setAttribute("aria-label", nome);
    toggle.setAttribute("aria-expanded", String(ap));
    suggerimento(toggle, nome);
  }

  function aggiorna(): void {
    const era = stretto;
    stretto = calcolaStretto();
    // Passando da largo a stretto il pannello si chiude (altrimenti coprirebbe il foglio senza che lo si chieda).
    if (stretto && !era) apertoSopra = false;
    disegna();
  }

  function apri(): void {
    if (stretto) apertoSopra = true;
    else chiusoDalDocente = false;
    disegna();
  }
  function chiudi(): void {
    if (stretto) apertoSopra = false;
    else chiusoDalDocente = true;
    disegna();
  }
  toggle.addEventListener("click", () => {
    if (aperto()) chiudi();
    else {
      apri();
      (schede.find((s) => s.id === attiva)?.pane ?? contenuto).focus();
    }
  });

  function mostraScheda(id: string, fuoco = false): void {
    if (!schede.some((s) => s.id === id)) return;
    const cambia = id !== attiva;
    attiva = id;
    apri();
    if (fuoco) schede.find((s) => s.id === id)?.tab.focus();
    if (cambia) ascoltatori.forEach((cb) => cb(id));
  }
  aggiungiScheda("simbolo", "Simbolo", contenuto);

  // Il modo segue la finestra e il foglio (A4 verticale o orizzontale, margini).
  const ro = new ResizeObserver(() => aggiorna());
  ro.observe(layout);
  const sheet = wrap.querySelector(".sheet");
  if (sheet) ro.observe(sheet);
  aggiorna();

  function mostraParola(): void {
    if (!(stretto && aperto())) return;
    const parola = wrap.querySelector<HTMLElement>(".cur");
    if (!parola) return;
    const coperto = inner.getBoundingClientRect().left;
    const r = parola.getBoundingClientRect();
    const margine = 16;
    if (r.right + margine > coperto) wrap.scrollLeft += r.right + margine - coperto;
    else if (r.left - margine < wrap.getBoundingClientRect().left) wrap.scrollLeft -= wrap.getBoundingClientRect().left - r.left + margine;
  }

  return {
    root,
    apri,
    chiudi,
    aperto,
    sopra: () => stretto && aperto(),
    aggiorna,
    mostraParola,
    aggiungiScheda,
    mostraScheda,
    schedaAttiva: () => attiva,
    onScheda: (cb) => ascoltatori.push(cb),
  };
}
