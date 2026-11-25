// Il pannello laterale richiudibile (M11-4, PIANO-M11.md 3.1, 3.2 e sezione 0 punto 7; difetti K11, D7).
//
// Due modi, decisi dalla larghezza: il foglio (A4 verticale o orizzontale) deve stare intero accanto al pannello.
//   - schermo largo: il pannello sta accanto al foglio, aperto, finché il docente non lo chiude;
//   - schermo stretto: il pannello parte chiuso (una striscia stretta con il pulsante per aprirlo); quando si apre
//     (pulsante, clic sul simbolo, Alt+↓, F8) si appoggia SOPRA la scrivania, senza spostare il foglio, e si richiude
//     con il pulsante o con Esc.
// Le schede (Simbolo, Pagina, Memoria) arrivano in M11-5 e M11-7: per ora c'è la sola «Simbolo».
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
}

export function creaPannelloLaterale(contenuto: HTMLElement, layout: HTMLElement, wrap: HTMLElement): PannelloLaterale {
  const root = document.createElement("div");
  root.className = "side-panel";
  const inner = document.createElement("div");
  inner.className = "side-inner";
  const head = document.createElement("div");
  head.className = "side-head";
  const titolo = document.createElement("span");
  titolo.className = "side-title";
  titolo.textContent = "Simbolo";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "side-toggle icon-only";
  head.append(titolo, toggle);
  inner.append(head, contenuto);
  root.append(inner);

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
    contenuto.hidden = !ap;
    titolo.hidden = !ap;
    toggle.replaceChildren(icona(ap ? "chiudiPannello" : "apriPannello"));
    const nome = ap ? "Chiudi il pannello dei simboli" : "Apri il pannello dei simboli";
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
      contenuto.focus();
    }
  });

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

  return { root, apri, chiudi, aperto, sopra: () => stretto && aperto(), aggiorna, mostraParola };
}
