// Simboli veri dal motore (M8): per ogni paragrafo si chiede al motore i token e si disegnano come
// decorazioni (resa A). Il testo del documento non cambia.
//
// Mentre il docente scrive, le decorazioni già disegnate seguono le modifiche (si "mappano") e si
// ridisegnano solo i paragrafi toccati da una modifica o appena risposti dal motore: il costo di una
// battuta non cresce con la lunghezza del documento. La risposta di un testo vecchio non rovina
// niente: va nella cache e basta. Se il motore dà errore, si riprova a intervalli crescenti.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EngineClient, Policy, TokenDto } from "../engine/client";
import { pieceEnds, splitWord } from "./symbolPlugin";

export interface EngineStats {
  /** Parole e numeri del documento (con i paragrafi in attesa, l'ultimo valore noto). */
  words: number;
  /** Parole da controllare (confidenza bassa o sconosciute). */
  doubtful: number;
  /** Paragrafi ancora in attesa del motore. */
  pending: number;
  /** Ultimo errore del motore, se sta riprovando. */
  error: string | null;
}

interface Entry {
  tokens: TokenDto[];
  words: number;
  doubtful: number;
}

interface State {
  client: EngineClient | null;
  policy: Policy;
  cache: Map<string, Entry>;
  decos: DecorationSet;
  stats: EngineStats;
  version: number;
}

export const engineKey = new PluginKey<State>("engineSymbols");

/** Messaggi per il plugin. */
export interface EngineMeta {
  /** Attiva (o spegne, con `null`) il motore. */
  client?: EngineClient | null;
  policy?: Policy;
  /** Risposte del motore: testo del paragrafo → token, per la politica indicata. */
  results?: { policy: Policy; items: Array<[string, TokenDto[]]> };
  refresh?: boolean;
}

/** Limiti della cache: voci e caratteri totali delle chiavi. */
const CACHE_ENTRIES = 1000;
const CACHE_CHARS = 1_000_000;
/** Paragrafi e caratteri per richiesta al motore. */
const BATCH_PARAGRAPHS = 50;
const BATCH_CHARS = 100_000;
/** Attesa prima di riprovare dopo un errore: raddoppia fino al massimo. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;

const listeners = new Set<() => void>();
let lastError: string | null = null;

/** Chiamata dopo ogni modifica dello stato dell'editor (aggiorna la barra di stato). */
export function onEngineUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Classi e stile del primo pezzo di un token. */
function firstPiece(t: TokenDto, client: EngineClient): { class: string; style?: string } {
  const classes = ["w"];
  const symbol = t.picto !== null && t.image && (t.display === "full" || t.display === "reduced");
  let style: string | undefined;
  if (symbol && t.picto !== null) {
    style = `--img:url("${client.url(t.picto)}")`;
    if (t.display === "reduced") classes.push("red");
  } else {
    classes.push("ns");
    if (t.placeholder) classes.push("ph");
    if (t.display === "hidden") classes.push("hid");
  }
  if (t.doubtful) classes.push("dbt");
  if (t.mods & 1) classes.push("mp");
  if (t.mods & 2) classes.push("mpast");
  if (t.mods & 4) classes.push("mfut");
  return { class: classes.join(" "), style };
}

function paragraphDecos(node: PMNode, pos: number, tokens: TokenDto[], client: EngineClient): Decoration[] {
  const out: Decoration[] = [];
  const ends = pieceEnds(node);
  const size = node.content.size;
  for (const t of tokens) {
    if (t.kind === "punct" || t.e > size || t.s >= t.e) continue;
    // Il simbolo sta sul primo pezzo; i pezzi successivi (parola spezzata dalla formattazione) sono testo.
    splitWord(t.s, t.e, ends).forEach(([x, y], i) => {
      const attrs: { class: string; style?: string } = i === 0 ? firstPiece(t, client) : { class: "w wc" };
      out.push(Decoration.inline(pos + 1 + x, pos + 1 + y, attrs));
    });
  }
  return out;
}

function entryOf(tokens: TokenDto[]): Entry {
  let words = 0;
  let doubtful = 0;
  for (const t of tokens) {
    if (t.kind === "punct") continue;
    words++;
    if (t.doubtful) doubtful++;
  }
  return { tokens, words, doubtful };
}

function emptyStats(): EngineStats {
  return { words: 0, doubtful: 0, pending: 0, error: null };
}

/** Somma le statistiche dei paragrafi. Con paragrafi in attesa si tiene l'ultimo conteggio noto, così la barra non salta. */
function computeStats(doc: PMNode, cache: Map<string, Entry>, previous: EngineStats): EngineStats {
  let words = 0;
  let doubtful = 0;
  let pending = 0;
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const entry = cache.get(node.textContent);
    if (entry) {
      words += entry.words;
      doubtful += entry.doubtful;
    } else if (node.textContent.trim()) {
      pending++;
    }
    return false;
  });
  if (pending > 0) return { words: previous.words, doubtful: previous.doubtful, pending, error: null };
  return { words, doubtful, pending, error: null };
}

/** Ridisegna tutto: a ogni cambio di motore, politica o documento sostituito. */
function rebuildAll(doc: PMNode, value: State, mapped: DecorationSet): DecorationSet {
  const client = value.client;
  if (!client) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const entry = value.cache.get(node.textContent);
    // Testo nuovo: finché non risponde il motore restano i simboli di prima, spostati dalla modifica.
    if (entry) decos.push(...paragraphDecos(node, pos, entry.tokens, client));
    else decos.push(...mapped.find(pos, pos + node.nodeSize));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** Ridisegna solo i paragrafi indicati (posizioni di inizio) che hanno già la risposta del motore. */
function rebuildSome(doc: PMNode, value: State, mapped: DecorationSet, starts: Iterable<number>): DecorationSet {
  const client = value.client;
  if (!client) return DecorationSet.empty;
  let decos = mapped;
  for (const pos of starts) {
    const node = doc.nodeAt(pos);
    if (!node || !node.isTextblock) continue;
    const entry = value.cache.get(node.textContent);
    if (!entry) continue;
    decos = decos.remove(decos.find(pos, pos + node.nodeSize));
    decos = decos.add(doc, paragraphDecos(node, pos, entry.tokens, client));
  }
  return decos;
}

/** Inizio dei paragrafi del documento nuovo toccati dalle modifiche di una transazione. */
function touchedParagraphs(tr: { mapping: import("prosemirror-transform").Mapping; doc: PMNode }): Set<number> {
  const touched = new Set<number>();
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const a = rest.map(newStart, -1);
      const b = Math.max(a, rest.map(newEnd, 1));
      tr.doc.nodesBetween(a, b, (node, pos) => {
        if (node.isTextblock) touched.add(pos);
        return !node.isTextblock;
      });
    });
  });
  return touched;
}

/** Toglie voci dalla cache oltre i limiti: prima quelle che non sono nel documento, dalla più vecchia. */
function prune(cache: Map<string, Entry>, doc: PMNode): void {
  let chars = 0;
  for (const k of cache.keys()) chars += k.length;
  if (cache.size <= CACHE_ENTRIES && chars <= CACHE_CHARS) return;
  const inDoc = new Set<string>();
  doc.descendants((node) => {
    if (node.isTextblock) inDoc.add(node.textContent);
    return !node.isTextblock;
  });
  for (const k of [...cache.keys()]) {
    if (cache.size <= CACHE_ENTRIES && chars <= CACHE_CHARS) break;
    if (inDoc.has(k)) continue;
    cache.delete(k);
    chars -= k.length;
  }
}

export function engineSymbolPlugin(): Plugin<State> {
  return new Plugin<State>({
    key: engineKey,
    state: {
      init: () => ({
        client: null,
        policy: "complete",
        cache: new Map(),
        decos: DecorationSet.empty,
        stats: emptyStats(),
        version: 0,
      }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(engineKey) as EngineMeta | undefined;
        if (!meta && !tr.docChanged) return value;
        let next: State = value;
        let full = !!meta?.refresh;
        if (meta?.client !== undefined) {
          next = { ...next, client: meta.client, cache: new Map() };
          full = true;
        }
        if (meta?.policy !== undefined && meta.policy !== next.policy) {
          next = { ...next, policy: meta.policy, cache: new Map() };
          full = true;
        }
        const mapped = tr.docChanged ? value.decos.map(tr.mapping, tr.doc) : value.decos;
        if (!next.client) return { ...next, decos: mapped };
        const arrived = new Set<string>();
        if (meta?.results && meta.results.policy === next.policy) {
          // La cache e' un'ottimizzazione e non fa parte della cronologia: si aggiorna sul posto.
          for (const [text, tokens] of meta.results.items) {
            next.cache.set(text, entryOf(tokens));
            arrived.add(text);
          }
          prune(next.cache, state.doc);
        }
        let decos: DecorationSet;
        if (full) {
          decos = rebuildAll(state.doc, next, mapped);
        } else {
          const starts = new Set<number>();
          if (tr.docChanged) for (const pos of touchedParagraphs(tr)) starts.add(pos);
          if (arrived.size > 0) {
            state.doc.descendants((node, pos) => {
              if (node.isTextblock && arrived.has(node.textContent)) starts.add(pos);
              return !node.isTextblock;
            });
          }
          decos = starts.size > 0 ? rebuildSome(state.doc, next, mapped, starts) : mapped;
        }
        const stats = computeStats(state.doc, next.cache, value.stats);
        return { ...next, decos, stats, version: value.version + 1 };
      },
    },
    props: {
      decorations: (state) => engineKey.getState(state)?.decos ?? DecorationSet.empty,
    },
    view(view) {
      const pending = new Set<string>();
      // Dopo un errore il motore e' "in pausa" per tutti i testi (altrimenti ogni battuta, che cambia il
      // testo, rimanderebbe una richiesta): quando riprovare e quanti errori di fila.
      let blockedUntil = 0;
      let failures = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;

      const schedule = (at: number) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          request(view);
        }, Math.max(0, at - Date.now()) + 5);
      };

      const send = async (v: EditorView, texts: string[], policy: Policy, client: EngineClient) => {
        for (let i = 0; i < texts.length; ) {
          // Un lotto: al massimo BATCH_PARAGRAPHS paragrafi e BATCH_CHARS caratteri.
          const batch: string[] = [];
          let chars = 0;
          while (i < texts.length && batch.length < BATCH_PARAGRAPHS && (batch.length === 0 || chars + texts[i].length <= BATCH_CHARS)) {
            chars += texts[i].length;
            batch.push(texts[i++]);
          }
          try {
            const all = await client.symbolize(batch, policy);
            for (const t of batch) pending.delete(`${policy}\u0000${t}`);
            failures = 0;
            lastError = null;
            if (destroyed) return;
            const items = batch.map((t, k): [string, TokenDto[]] => [t, all[k] ?? []]);
            v.dispatch(v.state.tr.setMeta(engineKey, { results: { policy, items } } satisfies EngineMeta).setMeta("addToHistory", false));
          } catch (err) {
            // Errore del motore: si dice nella barra di stato e si riprova dopo un po' (1 s, 2 s, 4 s… al massimo 30 s).
            lastError = String(err);
            console.error("motore:", err);
            for (const t of texts) pending.delete(`${policy}\u0000${t}`);
            // Più richieste in volo possono fallire insieme (una per battuta): l'attesa raddoppia una
            // volta sola per ondata di errori, non una volta per richiesta.
            if (Date.now() >= blockedUntil) failures++;
            blockedUntil = Math.max(blockedUntil, Date.now() + Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (failures - 1)));
            schedule(blockedUntil);
            listeners.forEach((cb) => cb());
            return;
          }
        }
      };

      function request(v: EditorView): void {
        const st = engineKey.getState(v.state);
        if (!st?.client || destroyed) return;
        if (Date.now() < blockedUntil) {
          schedule(blockedUntil);
          return;
        }
        const texts: string[] = [];
        v.state.doc.descendants((node) => {
          if (!node.isTextblock) return true;
          const text = node.textContent;
          const key = `${st.policy}\u0000${text}`;
          if (text.trim() && !st.cache.has(text) && !pending.has(key) && !texts.includes(text)) texts.push(text);
          return false;
        });
        if (texts.length === 0) return;
        for (const t of texts) pending.add(`${st.policy}\u0000${t}`);
        void send(v, texts, st.policy, st.client);
      }

      request(view);
      return {
        update(v, prev) {
          const a = engineKey.getState(v.state);
          const b = engineKey.getState(prev);
          if (v.state.doc !== prev.doc || a?.client !== b?.client || a?.policy !== b?.policy) request(v);
          listeners.forEach((cb) => cb());
        },
        destroy() {
          destroyed = true;
          if (timer) clearTimeout(timer);
        },
      };
    },
  });
}

export function engineStats(view: EditorView): EngineStats {
  const s = engineKey.getState(view.state)?.stats ?? emptyStats();
  return { ...s, error: lastError };
}

export function engineActive(view: EditorView): boolean {
  return !!engineKey.getState(view.state)?.client;
}

export function setEngine(view: EditorView, client: EngineClient | null): void {
  view.dispatch(view.state.tr.setMeta(engineKey, { client } satisfies EngineMeta));
}

export function setPolicy(view: EditorView, policy: Policy): void {
  view.dispatch(view.state.tr.setMeta(engineKey, { policy } satisfies EngineMeta));
}
