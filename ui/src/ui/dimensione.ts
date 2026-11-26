// La dimensione dell'interfaccia (M11-8, PIANO-M11.md 3.8): Normale (testo 15 px), Grande (17 px), Molto grande
// (19 px). Ingrandisce barre, pannelli e finestre, che sono misurati in rem; il foglio no (le sue misure sono quelle
// della stampa, in px e mm). Si ricorda su questo computer.

export type Dimensione = "normale" | "grande" | "molto-grande";

export const DIMENSIONI: Array<[Dimensione, string]> = [
  ["normale", "Normale"],
  ["grande", "Grande"],
  ["molto-grande", "Molto grande"],
];

/** La dimensione della radice (1rem): il testo normale è 0,9375rem, cioè 15, 17 o 19 px. */
const RADICE: Record<Dimensione, string> = {
  normale: "",
  grande: `${(17 / 15) * 100}%`,
  "molto-grande": `${(19 / 15) * 100}%`,
};

const CHIAVE = "caa.dimensioneInterfaccia";
let attuale: Dimensione = "normale";

export function dimensioneAttuale(): Dimensione {
  return attuale;
}

export function impostaDimensione(d: Dimensione): void {
  attuale = d;
  document.documentElement.style.fontSize = RADICE[d];
  try {
    if (d === "normale") localStorage.removeItem(CHIAVE);
    else localStorage.setItem(CHIAVE, d);
  } catch {
    /* senza memoria del browser la scelta vale finché il programma è aperto */
  }
  // Le barre ricontrollano cosa ci sta (la barra degli strumenti, il pannello laterale): basta un ridisegno.
  window.dispatchEvent(new Event("resize"));
}

/** All'avvio: la dimensione scelta l'ultima volta su questo computer. */
export function ripristinaDimensione(): void {
  let d: string | null = null;
  try {
    d = localStorage.getItem(CHIAVE);
  } catch {
    d = null;
  }
  if (d === "grande" || d === "molto-grande") impostaDimensione(d);
}
