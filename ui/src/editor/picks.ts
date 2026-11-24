// Le scelte del docente come mark `pick` (M8b): lettura dal documento, comando per cambiarle.
//
// Il mark sta sulle lettere di UNA parola (l'intervallo di un token del motore). Dal documento si
// ricavano, per ogni paragrafo, le scelte valide (che il motore riceve come "scelte forzate") e, per
// tutto il documento, i blocchi di senso ("usa per tutto il testo").
import type { Mark, Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { ForcedReq, LockReq } from "../engine/client";
import { schema } from "./schema";

/** Valori speciali di `picto`. */
export const PICTO_NONE = 0;
export const PICTO_TEXT_ONLY = -1;

export interface PickInfo {
  /** Intervallo nel paragrafo (UTF-16). */
  s: number;
  e: number;
  word: string;
  picto: number;
  lock: boolean;
  lemma: string;
  cat: string;
}

export interface ParaInfo {
  text: string;
  picks: PickInfo[];
  /** Scelte per il motore (solo testo → "nessun simbolo": lo spazio lo toglie l'editor). */
  forced: ForcedReq[];
  /** Firma delle scelte, per la chiave della cache. */
  sig: string;
}

const memo = new WeakMap<PMNode, ParaInfo>();

/** Informazioni sulle scelte di un paragrafo (memorizzate per nodo: i nodi non toccati restano gli stessi). */
export function paraInfo(node: PMNode): ParaInfo {
  let info = memo.get(node);
  if (info) return info;
  const text = node.textContent;
  const raw: Array<{ s: number; e: number; mark: Mark }> = [];
  node.forEach((child, off) => {
    const mark = child.isText ? child.marks.find((m) => m.type === schema.marks.pick) : undefined;
    if (!mark) return;
    const last = raw[raw.length - 1];
    if (last && last.e === off && last.mark.eq(mark)) last.e = off + child.nodeSize;
    else raw.push({ s: off, e: off + child.nodeSize, mark });
  });
  const picks: PickInfo[] = [];
  for (const r of raw) {
    const a = r.mark.attrs as { word: string; picto: number; lock: number; lemma: string; cat: string };
    // La scelta vale solo se la parola è ancora quella per cui è stata fatta.
    if (text.slice(r.s, r.e).toLowerCase() !== a.word) continue;
    picks.push({ s: r.s, e: r.e, word: a.word, picto: a.picto, lock: a.lock === 1, lemma: a.lemma, cat: a.cat });
  }
  const forced = picks.map((p): ForcedReq => ({ s: p.s, e: p.e, picto: Math.max(0, p.picto) }));
  info = { text, picks, forced, sig: picks.map((p) => `${p.s}-${p.e}:${p.picto}`).join(",") };
  memo.set(node, info);
  return info;
}

export interface Locks {
  list: LockReq[];
  /** Firma stabile dei blocchi, per la chiave della cache. */
  sig: string;
}

/** I blocchi di senso di tutto il documento (l'ultimo nel testo vince per lo stesso lemma e categoria). */
export function collectLocks(doc: PMNode): Locks {
  const map = new Map<string, LockReq>();
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    for (const p of paraInfo(node).picks) {
      if (p.lock && p.picto > 0 && p.lemma && p.cat) map.set(`${p.cat}\u0000${p.lemma.toLowerCase()}`, { lemma: p.lemma, cat: p.cat, picto: p.picto });
    }
    return false;
  });
  const list = [...map.values()].sort((a, b) => (a.cat + a.lemma).localeCompare(b.cat + b.lemma));
  return { list, sig: list.map((l) => `${l.cat}:${l.lemma}:${l.picto}`).join("|") };
}

export type Choice =
  | { kind: "picto"; id: number }
  | { kind: "none" }
  | { kind: "text" }
  /** Toglie la scelta: torna quella automatica del motore. */
  | { kind: "auto" };

export interface WordRef {
  /** Posizione di inizio del paragrafo nel documento. */
  paraPos: number;
  s: number;
  e: number;
  lemma: string;
  cat: string;
}

/**
 * Applica una scelta a una parola in un'unica transazione (un solo passo di annulla). Con `all`, e solo
 * per un pittogramma vero, la scelta diventa un blocco di senso del documento: le scelte precedenti
 * delle parole con lo stesso lemma (singole o in blocco) si sciolgono.
 */
export function applyChoice(view: EditorView, w: WordRef, choice: Choice, all: boolean): void {
  const { doc } = view.state;
  const para = doc.nodeAt(w.paraPos);
  if (!para || !para.isTextblock) return;
  const from = w.paraPos + 1 + w.s;
  const to = w.paraPos + 1 + w.e;
  if (to > w.paraPos + para.nodeSize - 1) return;
  const type = schema.marks.pick;
  const tr = view.state.tr.removeMark(from, to, type);
  if (choice.kind !== "auto") {
    const picto = choice.kind === "picto" ? choice.id : choice.kind === "text" ? PICTO_TEXT_ONLY : PICTO_NONE;
    const lock = all && choice.kind === "picto" && w.lemma !== "" && w.cat !== "";
    const word = para.textContent.slice(w.s, w.e).toLowerCase();
    if (lock) {
      // «Tutto il testo» vale per tutte le parole uguali (stesso lemma e categoria): le loro scelte
      // precedenti, singole o di un blocco più vecchio, si sciolgono; altrimenti vincerebbero sul blocco.
      tr.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        for (const p of paraInfo(node).picks) {
          if (p.cat === w.cat && p.lemma.toLowerCase() === w.lemma.toLowerCase() && !(pos === w.paraPos && p.s === w.s)) {
            tr.removeMark(pos + 1 + p.s, pos + 1 + p.e, type);
          }
        }
        return false;
      });
    }
    tr.addMark(from, to, type.create({ word, picto, lock: lock ? 1 : 0, lemma: w.lemma, cat: w.cat }));
  }
  view.dispatch(tr.scrollIntoView());
}
