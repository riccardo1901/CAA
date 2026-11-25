// Suggerimenti (M11-2, PIANO-M11.md 2.7 e 3.7): nome del pulsante e scorciatoia, in un solo riquadro uguale in tutto
// il programma. Compare dopo 400 ms con il mouse e SUBITO con il fuoco da tastiera; sui pulsanti spenti dice perché
// sono spenti. Si chiude con Esc, uscendo con il mouse o spostando il fuoco.
//
// Il testo viene da data-tip (messo con suggerimento()) oppure, per tutto il resto, dall'attributo title: mentre il
// riquadro è aperto il title si toglie, perché non compaia anche il suggerimento del browser, e poi si rimette.

const RITARDO_MS = 400;

let tip: HTMLDivElement | null = null;
let attuale: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let titoloSalvato: string | null = null;

/** I nomi dei tasti come li vuole aria-keyshortcuts («Ctrl+Maiusc+U» → «Control+Shift+U»). */
function perAria(tasti: string): string {
  return tasti
    .split(/\s+o\s+/)
    .map((t) => t.replace(/Ctrl/g, "Control").replace(/Maiusc/g, "Shift").replace(/↓/g, "ArrowDown").replace(/\s+/g, ""))
    .join(" ");
}

/** Mette il suggerimento a un controllo: testo, scorciatoia (facoltativa) e spiegazione per quando è spento. */
export function suggerimento(el: HTMLElement, testo: string, opzioni: { tasti?: string; spento?: string } = {}): void {
  el.dataset.tip = opzioni.tasti ? `${testo} · ${opzioni.tasti}` : testo;
  if (opzioni.tasti) el.setAttribute("aria-keyshortcuts", perAria(opzioni.tasti));
  if (opzioni.spento) el.dataset.tipOff = opzioni.spento;
  else delete el.dataset.tipOff;
  el.removeAttribute("title");
}

const spento = (el: HTMLElement) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";

function testoDi(el: HTMLElement): string {
  if (spento(el) && el.dataset.tipOff) return el.dataset.tipOff;
  return el.dataset.tip ?? titoloSalvato ?? el.getAttribute("title") ?? "";
}

function nascondi(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (attuale && titoloSalvato !== null) attuale.setAttribute("title", titoloSalvato);
  if (attuale) attuale.removeAttribute("aria-describedby");
  titoloSalvato = null;
  attuale = null;
  if (tip) tip.hidden = true;
}

function mostra(el: HTMLElement): void {
  if (!el.isConnected) return;
  const testo = testoDi(el);
  if (!testo) return;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    tip.id = "caa-tip";
    tip.setAttribute("role", "tooltip");
    document.body.append(tip);
  }
  tip.textContent = testo;
  tip.hidden = false;
  el.setAttribute("aria-describedby", tip.id);
  // Sotto il controllo, centrato; sopra se sotto non c'è posto; mai fuori dallo schermo.
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const margine = 6;
  let top = r.bottom + margine;
  if (top + t.height > window.innerHeight - margine) top = r.top - t.height - margine;
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(margine, Math.min(left, window.innerWidth - t.width - margine));
  tip.style.top = `${Math.max(margine, top)}px`;
  tip.style.left = `${left}px`;
}

function inizia(el: HTMLElement, subito: boolean): void {
  if (attuale === el) return;
  nascondi();
  attuale = el;
  if (el.hasAttribute("title") && el.dataset.tip === undefined) {
    titoloSalvato = el.getAttribute("title");
    el.removeAttribute("title");
  }
  if (subito) mostra(el);
  else timer = setTimeout(() => mostra(el), RITARDO_MS);
}

const conSuggerimento = (n: EventTarget | null): HTMLElement | null =>
  n instanceof Element ? (n.closest("[data-tip], [title]") as HTMLElement | null) : null;

let installato = false;

/** Una volta sola, all'avvio: ascolta mouse, fuoco ed Esc in tutta la pagina. */
export function installaSuggerimenti(): void {
  if (installato) return;
  installato = true;
  document.addEventListener("pointerover", (e) => {
    const el = conSuggerimento(e.target);
    if (!el || el.closest(".sheet")) return;
    inizia(el, false);
  });
  document.addEventListener("pointerout", (e) => {
    if (!attuale) return;
    const verso = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    if (verso && attuale.contains(verso)) return;
    if (document.activeElement === attuale && attuale.matches(":focus-visible")) return;
    nascondi();
  });
  document.addEventListener("focusin", (e) => {
    const el = conSuggerimento(e.target);
    if (!el || el !== e.target || el.closest(".sheet") || !el.matches(":focus-visible")) return;
    inizia(el, true);
  });
  document.addEventListener("focusout", () => nascondi());
  document.addEventListener("pointerdown", () => nascondi(), true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && attuale && tip && !tip.hidden) nascondi();
  }, true);
  window.addEventListener("blur", () => nascondi());
}
