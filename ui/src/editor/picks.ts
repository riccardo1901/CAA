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
/** Valori speciali che il motore capisce su più parole (crates/caa-engine: ForcedPick::MERGE e ::SPLIT). */
export const FORCED_MERGE = 4294967294;
export const FORCED_SPLIT = 4294967295;

/** Unione o divisione manuale di parole, come sta nel documento (dentro un paragrafo, UTF-16). */
export interface GroupInfo {
  s: number;
  e: number;
  mode: "merge" | "split";
}

export interface PickInfo {
  /** Intervallo nel paragrafo (UTF-16). */
  s: number;
  e: number;
  word: string;
  picto: number;
  lemma: string;
  cat: string;
}

export interface ParaInfo {
  text: string;
  picks: PickInfo[];
  groups: GroupInfo[];
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
    const a = r.mark.attrs as { word: string; picto: number; lemma: string; cat: string };
    // La scelta vale solo se la parola è ancora quella per cui è stata fatta.
    if (text.slice(r.s, r.e).toLowerCase() !== a.word) continue;
    picks.push({ s: r.s, e: r.e, word: a.word, picto: a.picto, lemma: a.lemma, cat: a.cat });
  }
  const forced = picks.map((p): ForcedReq => ({ s: p.s, e: p.e, picto: Math.max(0, p.picto) }));
  // Unioni e divisioni: valgono solo se il testo coperto è ancora quello per cui sono state fatte.
  const rawGroups: Array<{ s: number; e: number; mark: Mark }> = [];
  node.forEach((child, off) => {
    const mark = child.isText ? child.marks.find((m) => m.type === schema.marks.group) : undefined;
    if (!mark) return;
    const last = rawGroups[rawGroups.length - 1];
    if (last && last.e === off && last.mark.eq(mark)) last.e = off + child.nodeSize;
    else rawGroups.push({ s: off, e: off + child.nodeSize, mark });
  });
  const groups: GroupInfo[] = [];
  for (const r of rawGroups) {
    const a = r.mark.attrs as { text: string; mode: string };
    if (text.slice(r.s, r.e).toLowerCase() !== a.text) continue;
    groups.push({ s: r.s, e: r.e, mode: a.mode === "split" ? "split" : "merge" });
  }
  for (const g of groups) forced.push({ s: g.s, e: g.e, picto: g.mode === "split" ? FORCED_SPLIT : FORCED_MERGE });
  const sig =
    picks.map((p) => `${p.s}-${p.e}:${p.picto}`).join(",") + (groups.length ? `|g${groups.map((g) => `${g.s}-${g.e}:${g.mode}`).join(",")}` : "");
  info = { text, picks, groups, forced, sig };
  memo.set(node, info);
  return info;
}

export interface Locks {
  list: LockReq[];
  /** Firma stabile dei blocchi, per la chiave della cache. */
  sig: string;
}

/** Un blocco di senso come sta nei dati del documento: porta anche l'`uuid` di un simbolo personale. */
export interface LockEntry extends LockReq {
  uuid: string;
}

/** Il limite di blocchi in un documento (un file di altra origine non deve poter mandarne milioni). */
const MAX_LOCKS = 5000;

/** Ripulisce i blocchi letti dal documento (un file è dato non fidato): tiene solo quelli ben formati. */
export function sanitizeLocks(value: unknown): LockEntry[] {
  if (!Array.isArray(value)) return [];
  const out: LockEntry[] = [];
  for (const raw of value.slice(0, MAX_LOCKS)) {
    const l = raw as Partial<LockEntry> | null;
    if (!l || typeof l.lemma !== "string" || typeof l.cat !== "string" || typeof l.picto !== "number") continue;
    if (l.lemma === "" || l.lemma.length > 100 || l.cat === "" || l.cat.length > 20) continue;
    // I valori speciali di «unisci» e «dividi» non sono pittogrammi.
    if (!Number.isInteger(l.picto) || l.picto <= 0 || l.picto >= FORCED_MERGE) continue;
    out.push({ lemma: l.lemma, cat: l.cat, picto: l.picto, uuid: typeof l.uuid === "string" && l.uuid.length <= 64 ? l.uuid : "" });
  }
  return out;
}

const sameLemma = (a: { lemma: string; cat: string }, b: { lemma: string; cat: string }): boolean =>
  a.cat === b.cat && a.lemma.toLowerCase() === b.lemma.toLowerCase();

/** I blocchi di senso di tutto il documento (stanno nei dati del documento, non su una parola). */
export function collectLocks(doc: PMNode): Locks {
  const entries = sanitizeLocks(doc.attrs.locks);
  const list = entries.map(({ lemma, cat, picto }): LockReq => ({ lemma, cat, picto })).sort((a, b) => (a.cat + a.lemma).localeCompare(b.cat + b.lemma));
  return { list, sig: list.map((l) => `${l.cat}:${l.lemma}:${l.picto}`).join("|") };
}

/** Toglie il blocco di senso di un lemma: le sue parole tornano al simbolo automatico. */
export function removeLock(view: EditorView, lemma: string, cat: string): void {
  const kept = sanitizeLocks(view.state.doc.attrs.locks).filter((l) => !sameLemma(l, { lemma, cat }));
  view.dispatch(view.state.tr.setDocAttribute("locks", kept));
}

export type Choice =
  | { kind: "picto"; id: number; /** Simbolo personale: il suo identificativo stabile. */ uuid?: string }
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
  const lock = all && choice.kind === "picto" && w.lemma !== "" && w.cat !== "";
  if (lock && choice.kind === "picto") {
    // «Tutto il testo» vale per tutte le parole uguali (stesso lemma e categoria): le loro scelte precedenti si
    // sciolgono (altrimenti vincerebbero sul blocco) e il blocco sta nei dati del documento.
    tr.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      for (const p of paraInfo(node).picks) {
        if (sameLemma(p, w)) tr.removeMark(pos + 1 + p.s, pos + 1 + p.e, type);
      }
      return false;
    });
    const locks = sanitizeLocks(doc.attrs.locks).filter((l) => !sameLemma(l, w));
    locks.push({ lemma: w.lemma, cat: w.cat, picto: choice.id, uuid: choice.uuid ?? "" });
    tr.setDocAttribute("locks", locks);
  } else if (choice.kind !== "auto") {
    const picto = choice.kind === "picto" ? choice.id : choice.kind === "text" ? PICTO_TEXT_ONLY : PICTO_NONE;
    const word = para.textContent.slice(w.s, w.e).toLowerCase();
    const uuid = choice.kind === "picto" ? (choice.uuid ?? "") : "";
    tr.addMark(from, to, type.create({ word, picto, lemma: w.lemma, cat: w.cat, uuid }));
  }
  view.dispatch(tr.scrollIntoView());
}
