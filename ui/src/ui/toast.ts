// Notifiche (M11-3, PIANO-M11.md 3.3; difetti K5, D3, D4): un solo posto per i messaggi brevi, in basso a destra
// sopra il foglio, con icona e testo.
//   - informazione e riuscita: spariscono da sole dopo 6 secondi (non mentre ci si tiene sopra il mouse);
//   - avviso ed errore: restano finché non si chiudono con ×, e possono avere un'azione («Riprova»).
// I lettori di schermo le leggono: le informazioni con calma (role="status"), i problemi subito (role="alert").
import { icona, type NomeIcona } from "./icons";

export type TipoNotifica = "info" | "ok" | "avviso" | "errore";

export interface OpzioniNotifica {
  tipo?: TipoNotifica;
  /** Un'azione legata al messaggio (per esempio «Riprova»). */
  azione?: { testo: string; fai: () => void };
  /** Dettaglio tecnico (l'errore com'è): in piccolo e in grigio, serve a chi assiste. */
  dettaglio?: string;
}

const DURATA_MS = 6000;
const MASSIMO = 4;
const ICONE: Record<TipoNotifica, NomeIcona> = { info: "info", ok: "ok", avviso: "avviso", errore: "avviso" };

let zona: HTMLDivElement | null = null;

function contenitore(): HTMLDivElement {
  if (zona?.isConnected) return zona;
  zona = document.createElement("div");
  zona.className = "toasts";
  zona.setAttribute("role", "region");
  zona.setAttribute("aria-label", "Messaggi");
  document.body.append(zona);
  return zona;
}

/** Mostra una notifica; restituisce la funzione che la toglie. */
export function notifica(testo: string, o: OpzioniNotifica = {}): () => void {
  const tipo = o.tipo ?? "info";
  const problema = tipo === "avviso" || tipo === "errore";
  const z = contenitore();
  const t = document.createElement("div");
  t.className = `toast toast-${tipo}`;
  t.setAttribute("role", problema ? "alert" : "status");
  const corpo = document.createElement("div");
  corpo.className = "toast-body";
  const msg = document.createElement("p");
  msg.className = "toast-text";
  msg.textContent = testo;
  corpo.append(msg);
  if (o.dettaglio) {
    const d = document.createElement("p");
    d.className = "toast-detail";
    d.textContent = o.dettaglio;
    corpo.append(d);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const togli = (): void => {
    if (timer) clearTimeout(timer);
    t.remove();
  };
  if (o.azione) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = o.azione.testo;
    const fai = o.azione.fai;
    b.addEventListener("click", () => {
      togli();
      fai();
    });
    corpo.append(b);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "toast-close";
  x.setAttribute("aria-label", "Chiudi il messaggio");
  x.append(icona("chiudi"));
  x.addEventListener("click", togli);
  t.append(icona(ICONE[tipo]), corpo, x);
  z.append(t);
  while (z.children.length > MASSIMO) z.firstElementChild?.remove();
  if (!problema) {
    const parti = (): void => {
      timer = setTimeout(togli, (window as unknown as { __caaNotificaMs?: number }).__caaNotificaMs ?? DURATA_MS);
    };
    t.addEventListener("mouseenter", () => timer && clearTimeout(timer));
    t.addEventListener("mouseleave", parti);
    parti();
  }
  return togli;
}
