// Le scorciatoie da tastiera (M11-8, PIANO-M11.md 3.7): una finestra con tutte le scorciatoie divise per argomento,
// scritte come tasti. Si apre con F1 o da «Altro › Scorciatoie da tastiera»; Esc la chiude.
import { finestra } from "./dialog";

/** [tasti, cosa fanno]. I tasti separati da «+» si premono insieme, «o» separa alternative. */
const GRUPPI: Array<[string, Array<[string, string]>]> = [
  [
    "Scrivere",
    [
      ["Ctrl+Z", "Annulla"],
      ["Ctrl+Y o Ctrl+Maiusc+Z", "Ripeti"],
      ["Ctrl+1 o 2 o 3 o 4", "Simboli piccoli, medi, grandi, molto grandi"],
      ["Ctrl+Maiusc+U", "Unisci le parole selezionate in un simbolo solo"],
      ["Ctrl+Maiusc+D", "Dividi (o riunisci) il gruppo della parola al cursore"],
    ],
  ],
  [
    "Correggere un simbolo",
    [
      ["Alt+↓", "Le alternative della parola dove hai il cursore"],
      ["1–8", "Scegli l'alternativa con quel numero"],
      ["Invio", "Nella ricerca: scegli il primo simbolo trovato"],
      ["Esc", "Torna al testo"],
      ["F8", "Vai alla prossima parola da controllare"],
    ],
  ],
  [
    "Documento e stampa",
    [
      ["Ctrl+P", "Stampa (le impostazioni della pagina, poi Invio per stampare)"],
      ["F1", "Queste scorciatoie"],
      ["Tab o Maiusc+Tab", "Passa da un controllo all'altro"],
      ["← o →", "Passa da una scheda all'altra (pannello laterale, Documenti)"],
    ],
  ],
];

/** I tasti come elementi <kbd>: «Ctrl+Maiusc+U» → [Ctrl] + [Maiusc] + [U]; «o» resta parola. */
function tasti(t: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "keys";
  t.split(" o ").forEach((alt, i) => {
    if (i > 0) span.append(" o ");
    alt.split("+").forEach((k, j) => {
      if (j > 0) span.append("+");
      const kbd = document.createElement("kbd");
      kbd.textContent = k;
      span.append(kbd);
    });
  });
  return span;
}

let aperta: (() => void) | null = null;

export function apriScorciatoie(): void {
  if (aperta) return;
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay help-overlay";
  const box = document.createElement("div");
  box.className = "dialog help-dialog";
  box.setAttribute("aria-labelledby", "scorciatoie-titolo");
  const h = document.createElement("h2");
  h.id = "scorciatoie-titolo";
  h.textContent = "Scorciatoie da tastiera";
  box.append(h);
  for (const [titolo, righe] of GRUPPI) {
    const sezione = document.createElement("section");
    const h3 = document.createElement("h3");
    h3.textContent = titolo;
    const dl = document.createElement("dl");
    dl.className = "help-list";
    for (const [k, cosa] of righe) {
      const dt = document.createElement("dt");
      dt.append(tasti(k));
      const dd = document.createElement("dd");
      dd.textContent = cosa;
      dl.append(dt, dd);
    }
    sezione.append(h3, dl);
    box.append(sezione);
  }
  const azioni = document.createElement("div");
  azioni.className = "dialog-actions";
  const chiudiBtn = document.createElement("button");
  chiudiBtn.type = "button";
  chiudiBtn.textContent = "Chiudi";
  azioni.append(chiudiBtn);
  box.append(azioni);
  overlay.append(box);
  document.body.append(overlay);
  const chiudi = finestra({
    overlay,
    box,
    fuoco: chiudiBtn,
    onChiudi: () => {
      aperta = null;
    },
  });
  chiudiBtn.addEventListener("click", chiudi);
  aperta = chiudi;
  // «Chiudi» sta fermo in fondo: la finestra si apre dall'inizio (titolo e primo gruppo in vista).
  box.scrollTop = 0;
}

let installato = false;

/** F1 apre le scorciatoie da qualunque punto del programma. */
export function installaScorciatoie(): void {
  if (installato) return;
  installato = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "F1" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      apriScorciatoie();
    }
  });
}
