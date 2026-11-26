// Scheda «Memoria» del pannello laterale (M11-7, PIANO-M11.md 3.6 e difetto K4).
//
// «Cosa ricordo»: le scelte fatte con «ricorda per sempre», che valgono in tutti i documenti, con Dimentica e
// Dimentica tutto (conferma del programma). Prima si vedeva solo con la barra dei simboli vuota; ora è sempre qui.
// Sotto, «I miei simboli»: le immagini importate su questo computer, che si possono eliminare (prima solo con la ×
// piccola nella scheda Simbolo, che resta). Le voci delle parole governate dalla politica delle parole funzionali
// hanno l'etichetta «mostra sempre il simbolo» (K4: il motore oggi lascia vincere la memoria; si corregge dopo M11).
import type { EditorView } from "prosemirror-view";
import type { EngineClient, MemoryEntry } from "../engine/client";
import { setEngine } from "../editor/engineSymbols";
import { hooks } from "../editor/menuHooks";
import { conferma } from "../ui/confirm";
import { conIcona, icona } from "../ui/icons";
import type { PannelloLaterale } from "./panel";
import { el, governataDallaPolitica, sezione } from "./common";

interface Contesto {
  view: EditorView;
  client: EngineClient;
  /** I simboli personali sono cambiati (uno eliminato da qui): la scheda Simbolo li rilegge. */
  simboliCambiati: () => void;
}

let pane: HTMLElement | null = null;
let ctx: Contesto | null = null;
let generazione = 0;

/** Il riquadro della scheda (uno solo). */
function riquadro(): HTMLElement {
  if (pane) return pane;
  const p = el("div", "side-memoria");
  p.tabIndex = -1;
  // Esc torna al testo, come nella scheda Simbolo (e richiude il pannello quando sta sopra il foglio).
  p.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    ctx?.view.focus();
    hooks.lasciaBarra?.();
  });
  pane = p;
  return p;
}

/** Aggiunge la scheda «Memoria» al pannello laterale; si riempie ogni volta che si apre. */
export function attachMemoryTab(pannello: PannelloLaterale): void {
  pannello.aggiungiScheda("memoria", "Memoria", riquadro());
  pannello.onScheda((id) => {
    if (id === "memoria") aggiornaMemoria();
  });
  hooks.apriMemoria = () => pannello.mostraScheda("memoria", true);
}

/** Collega la scheda al motore (si può richiamare con un motore nuovo). */
export function installMemory(view: EditorView, client: EngineClient, simboliCambiati: () => void): void {
  ctx = { view, client, simboliCambiati };
  aggiornaMemoria();
}

const nomeVoce = (m: MemoryEntry): string => (m.lemma !== "" ? m.lemma : m.form);

/** Rilegge la memoria e i simboli personali e ridisegna la scheda. */
export function aggiornaMemoria(): void {
  const c = ctx;
  const p = riquadro();
  if (!c) return;
  const mia = ++generazione;
  const memoria = c.client.memory;
  Promise.all([
    memoria ? memoria.list().catch(() => [] as MemoryEntry[]) : Promise.resolve([] as MemoryEntry[]),
    c.client.listCustom().catch(() => []),
  ]).then(([voci, simboli]) => {
    if (mia !== generazione) return;
    // Il fuoco, se era dentro la scheda, resta nella scheda (non va perso con i pulsanti ridisegnati).
    const fuocoDentro = p.contains(document.activeElement) && document.activeElement !== p;
    p.replaceChildren();
    p.append(cosaRicordo(c, voci));
    if (simboli.length > 0 && c.client.deleteCustom) {
      const { box } = sezione("mem-custom", "I miei simboli");
      box.append(el("p", "mem-intro", "Le immagini che hai importato su questo computer. I documenti che le usano le conservano anche se le elimini."));
      const ul = el("ul", "mem-list");
      for (const s of [...simboli].reverse()) {
        const nome = s.label || "personale";
        const li = el("li", "mem-row");
        const img = el("img");
        img.src = c.client.url(s.id);
        img.alt = "";
        const del = conIcona(el("button", "", "Elimina"), "elimina");
        del.type = "button";
        del.setAttribute("aria-label", `Elimina il simbolo ${nome}`);
        del.addEventListener("click", async () => {
          const ok = await conferma({
            domanda: `Eliminare il simbolo «${nome}» da questo computer?`,
            spiegazione: "I documenti che lo usano lo conservano. Non si può annullare.",
            azione: "Elimina",
            pericolo: true,
          });
          if (!ok || !c.client.deleteCustom) return;
          c.client.deleteCustom(s.uuid).then(
            () => {
              // Le scelte «per sempre» che lo usavano sono state tolte: i paragrafi si rifanno.
              setEngine(c.view, c.client);
              c.simboliCambiati();
              aggiornaMemoria();
            },
            (e: unknown) => hooks.notice?.(`Non sono riuscito a eliminarlo: ${String(e)}`, "errore"),
          );
        });
        li.append(img, el("span", "mem-word", nome), del);
        ul.append(li);
      }
      box.append(ul);
      p.append(box);
    }
    if (fuocoDentro) p.focus();
  });
}

function cosaRicordo(c: Contesto, voci: MemoryEntry[]): HTMLElement {
  const memoria = c.client.memory;
  if (!memoria || voci.length === 0) {
    // Stato vuoto (PIANO-M11.md 3.6): icona, una frase.
    const vuoto = el("div", "side-empty mem-empty");
    const ico = el("span", "empty-ico");
    ico.append(icona("memoria"));
    vuoto.append(ico, el("h3", "pm-sec-title", "Cosa ricordo"), el("p", "", "Non ricordo ancora nessuna scelta. Quando correggi un simbolo, spunta «ricorda per sempre»."));
    return vuoto;
  }
  const wrap = el("div", "side-memory");
  const titolo = el("h3", "pm-sec-title", "Cosa ricordo");
  titolo.id = "mem-titolo";
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-labelledby", titolo.id);
  wrap.append(titolo, el("p", "mem-intro", "Le scelte fatte con «ricorda per sempre»: valgono in tutti i documenti."));
  const ul = el("ul", "side-memory-list mem-list");
  for (const m of voci) {
    const li = el("li", "mem-row");
    const img = el("img");
    img.src = c.client.url(m.picto);
    img.alt = "";
    const parola = el("span", "mem-word");
    parola.append(el("span", "mem-name", nomeVoce(m)));
    if (governataDallaPolitica(nomeVoce(m), m.cat)) {
      // Revisione M11: la scelta ricordata vince su «Parole funzionali» (K4, nel motore): l'etichetta dice questo.
      const chip = el("span", "mem-chip", "mostra sempre il simbolo");
      chip.title = "È una parola funzionale (articolo, preposizione, congiunzione, «che», pronome come «lo»): questa scelta ricordata mostra il simbolo anche quando «Parole funzionali» dice di nasconderlo. Se non lo vuoi, premi «Dimentica».";
      parola.append(chip);
    }
    const forget = conIcona(el("button", "", "Dimentica"), "dimentica");
    forget.type = "button";
    forget.setAttribute("aria-label", `Dimentica ${nomeVoce(m)}`);
    forget.addEventListener("click", () => {
      memoria.forget(m).then(
        () => {
          setEngine(c.view, c.client);
          aggiornaMemoria();
        },
        (e: unknown) => hooks.notice?.(`Non sono riuscito a dimenticare: ${String(e)}`, "errore"),
      );
    });
    li.append(img, parola, forget);
    ul.append(li);
  }
  const clear = conIcona(el("button", "mem-clear", "Dimentica tutto"), "elimina");
  clear.type = "button";
  clear.addEventListener("click", async () => {
    const ok = await conferma({
      domanda: "Dimenticare tutte le scelte «per sempre»?",
      spiegazione: "Le parole torneranno ai simboli proposti dal programma. Non si può annullare.",
      azione: "Dimentica tutto",
      pericolo: true,
    });
    if (!ok) return;
    memoria.clear().then(
      () => {
        setEngine(c.view, c.client);
        aggiornaMemoria();
      },
      (e: unknown) => hooks.notice?.(`Non sono riuscito a dimenticare: ${String(e)}`, "errore"),
    );
  });
  wrap.append(ul, clear);
  return wrap;
}
