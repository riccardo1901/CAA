// Controlli automatici condivisi dal pannello (sul PC dell'utente) e dai test Playwright.
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { wordRanges } from "./editor/words";

function symSize(view: EditorView): number {
  return parseFloat(getComputedStyle(view.dom).getPropertyValue("--sym")) || 0;
}

function docWordCount(view: EditorView): number {
  let n = 0;
  view.state.doc.descendants((node) => {
    if (node.isTextblock) n += wordRanges(node.textContent).length;
    return !node.isTextblock;
  });
  return n;
}

export interface WrapReport {
  words: number;
  /** Elementi della parola nel DOM (se sono più delle parole, qualcuna è stata spezzata). */
  elements: number;
  /** Parole il cui simbolo non sta con la parola (a capo, simbolo tagliato). */
  broken: number;
  /** Parole spezzate in più pezzi dal grassetto parziale (ciascun pezzo ha il suo simbolo). */
  fragments: number;
  examples: string[];
}

/** Prova 4: il simbolo non si separa mai dalla sua parola. */
export function checkWrap(view: EditorView): WrapReport {
  const sym = symSize(view);
  const wordsA = Array.from(view.dom.querySelectorAll<HTMLElement>(".w:not(.wc)"));
  const wordsB = Array.from(view.dom.querySelectorAll<HTMLElement>(".wb:not(.wc)"));
  const pieces = Array.from(view.dom.querySelectorAll<HTMLElement>(".wc"));
  const examples: string[] = [];
  let broken = 0;
  const note = (el: HTMLElement, why: string) => {
    broken++;
    if (examples.length < 5) examples.push(`${el.textContent ?? ""}: ${why}`);
  };
  for (const el of wordsA) {
    const rects = el.getClientRects();
    if (rects.length !== 1) note(el, `${rects.length} blocchi`);
    else if (rects[0].height + 0.5 < sym || rects[0].width + 0.5 < sym) note(el, "simbolo tagliato");
  }
  for (const el of wordsB) {
    const anchor = el.previousElementSibling;
    if (!(anchor instanceof HTMLElement) || !anchor.classList.contains("sw")) {
      note(el, "simbolo mancante");
      continue;
    }
    const a = anchor.getBoundingClientRect();
    const w = el.getBoundingClientRect();
    if (a.top < w.top - 1 || a.top > w.bottom + 1 || Math.abs(a.left - w.left) > 2) {
      note(el, "simbolo su un'altra riga");
    }
  }
  // Un pezzo successivo deve stare sulla riga del pezzo che porta il simbolo.
  const heads = Array.from(view.dom.querySelectorAll<HTMLElement>(".w, .wb"));
  for (const piece of pieces) {
    const head = heads.slice(0, heads.indexOf(piece)).reverse().find((h) => !h.classList.contains("wc"));
    if (!head) continue;
    const a = piece.getBoundingClientRect().bottom;
    const b = head.getBoundingClientRect().bottom;
    if (Math.abs(a - b) > 4) note(piece, "pezzo di parola su un'altra riga");
  }
  const elements = wordsA.length + wordsB.length;
  const words = docWordCount(view);
  return { words, elements, broken, fragments: Math.max(0, elements - words), examples };
}

export interface HitReport {
  tested: number;
  /** Clic sul simbolo che non arrivano all'elemento della propria parola (serve al menu di M8). */
  wrong: number;
  /** Clic sul simbolo per cui `posAtCoords` (cursore col mouse) non cade nella parola: solo informativo. */
  caretMisses: number;
  examples: string[];
}

/**
 * Prova aggiuntiva: un clic sul simbolo individua la parola giusta (serve al menu alternative di M8).
 * Il meccanismo è l'elemento colpito dal clic (lo span della parola, da cui `posAtDOM` dà la
 * posizione esatta); `posAtCoords`, che sceglie dove mettere il cursore, a volte restituisce la fine
 * di un tratto di parole formattate e viene contato a parte.
 */
export function checkSymbolHits(view: EditorView): HitReport {
  const sym = symSize(view);
  let tested = 0;
  let wrong = 0;
  let caretMisses = 0;
  const examples: string[] = [];
  const check = (word: HTMLElement, x: number, y: number) => {
    tested++;
    const target = document.elementFromPoint(x, y);
    const owner = target instanceof HTMLElement ? target.closest<HTMLElement>(".w, .wb") ?? target.closest<HTMLElement>(".sw")?.nextElementSibling : null;
    if (owner !== word) {
      wrong++;
      if (examples.length < 5) examples.push(`${word.textContent ?? ""}: il clic arriva a "${owner?.textContent ?? target?.tagName ?? "nulla"}"`);
    }
    const from = view.posAtDOM(word, 0);
    const to = view.posAtDOM(word, word.childNodes.length);
    const hit = view.posAtCoords({ left: x, top: y });
    if (!hit || hit.pos < from || hit.pos > to) caretMisses++;
  };
  // `elementFromPoint` vale solo per i punti visibili: ogni parola si porta in vista prima della prova.
  const scroller = document.querySelector<HTMLElement>(".sheet-wrap");
  const saved = scroller?.scrollTop ?? 0;
  for (const el of view.dom.querySelectorAll<HTMLElement>(".w:not(.wc)")) {
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    if (r.width > 0) check(el, r.left + r.width / 2, r.top + sym / 2);
  }
  for (const el of view.dom.querySelectorAll<HTMLElement>(".wb:not(.wc)")) {
    el.scrollIntoView({ block: "center" });
    const img = el.previousElementSibling?.querySelector("img");
    if (!img) continue;
    const r = img.getBoundingClientRect();
    if (r.width > 0) check(el, r.left + r.width / 2, r.top + r.height / 2);
  }
  if (scroller) scroller.scrollTop = saved;
  return { tested, wrong, caretMisses, examples };
}

export interface BenchReport {
  keystrokes: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  words: number;
}

const TYPED = "Il gatto dorme sul divano perché è molto stanco, e la bambina lo guarda. ";

/** Prova 7: tempo di ogni battuta (aggiornamento del documento, decorazioni e impaginazione). */
export async function benchmark(view: EditorView, keystrokes = 600): Promise<BenchReport> {
  // Cursore alla fine di un paragrafo a metà documento.
  const blocks = view.state.doc.childCount;
  let pos = 0;
  view.state.doc.forEach((node, offset, index) => {
    if (index === Math.floor(blocks / 2)) pos = offset + node.nodeSize - 1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  const times: number[] = [];
  for (let i = 0; i < keystrokes; i++) {
    const t0 = performance.now();
    view.dispatch(view.state.tr.insertText(TYPED[i % TYPED.length]));
    void view.dom.getBoundingClientRect(); // forza stile e impaginazione
    void (view.dom as HTMLElement).offsetHeight;
    times.push(performance.now() - t0);
    if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0)); // lascia respirare il browser
  }
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  return { keystrokes, medianMs: q(0.5), p95Ms: q(0.95), maxMs: times[times.length - 1], words: docWordCount(view) };
}
