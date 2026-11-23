// Simboli veri dal motore (M8): per ogni paragrafo si chiede al motore i token e si disegnano come
// decorazioni (resa A). Il testo del documento non cambia.
//
// Mentre il docente scrive, le decorazioni già disegnate seguono le modifiche (si "mappano") e solo
// i paragrafi nuovi o cambiati vanno al motore; quando arriva la risposta si ridisegna il paragrafo.
// La risposta di un testo vecchio non rovina niente: va nella cache e basta.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EngineClient, Policy, TokenDto } from "../engine/client";
import { pieceEnds, splitWord } from "./symbolPlugin";

export interface EngineStats {
  /** Parole e numeri del documento che il motore ha già analizzato. */
  words: number;
  /** Parole da controllare (confidenza bassa o sconosciute). */
  doubtful: number;
  /** Paragrafi ancora in attesa del motore. */
  pending: number;
}

interface State {
  client: EngineClient | null;
  policy: Policy;
  cache: Map<string, TokenDto[]>;
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

const CACHE_LIMIT = 2000;

const listeners = new Set<() => void>();

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

function rebuild(doc: PMNode, value: State, mapped: DecorationSet): { decos: DecorationSet; stats: EngineStats } {
  const client = value.client;
  if (!client) return { decos: DecorationSet.empty, stats: { words: 0, doubtful: 0, pending: 0 } };
  const decos: Decoration[] = [];
  const stats: EngineStats = { words: 0, doubtful: 0, pending: 0 };
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const tokens = value.cache.get(node.textContent);
    if (tokens) {
      decos.push(...paragraphDecos(node, pos, tokens, client));
      for (const t of tokens) {
        if (t.kind === "punct") continue;
        stats.words++;
        if (t.doubtful) stats.doubtful++;
      }
    } else {
      // Testo nuovo: finché non risponde il motore restano i simboli di prima, spostati dalla modifica.
      decos.push(...mapped.find(pos, pos + node.nodeSize));
      if (node.textContent.trim()) stats.pending++;
    }
    return false;
  });
  return { decos: DecorationSet.create(doc, decos), stats };
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
        stats: { words: 0, doubtful: 0, pending: 0 },
        version: 0,
      }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(engineKey) as EngineMeta | undefined;
        if (!meta && !tr.docChanged) return value;
        let next: State = value;
        if (meta?.client !== undefined) next = { ...next, client: meta.client, cache: new Map() };
        if (meta?.policy !== undefined && meta.policy !== next.policy) next = { ...next, policy: meta.policy, cache: new Map() };
        if (meta?.results && meta.results.policy === next.policy) {
          const cache = new Map(next.cache);
          for (const [text, tokens] of meta.results.items) cache.set(text, tokens);
          while (cache.size > CACHE_LIMIT) {
            const first = cache.keys().next();
            if (first.done) break;
            cache.delete(first.value);
          }
          next = { ...next, cache };
        }
        const mapped = tr.docChanged ? value.decos.map(tr.mapping, tr.doc) : value.decos;
        const changedCache = next.cache !== value.cache || next.client !== value.client;
        if (meta?.refresh || changedCache || (tr.docChanged && next.client)) {
          // A ogni modifica si ridisegnano i paragrafi che hanno già la risposta del motore e si
          // tengono i simboli spostati per gli altri.
          const { decos, stats } = rebuild(state.doc, next, mapped);
          return { ...next, decos, stats, version: value.version + 1 };
        }
        return { ...next, decos: mapped };
      },
    },
    props: {
      decorations: (state) => engineKey.getState(state)?.decos ?? DecorationSet.empty,
    },
    view(view) {
      const pending = new Set<string>();
      const request = (v: EditorView) => {
        const st = engineKey.getState(v.state);
        if (!st?.client) return;
        const texts: string[] = [];
        v.state.doc.descendants((node) => {
          if (!node.isTextblock) return true;
          const text = node.textContent;
          const key = `${st.policy}\u0000${text}`;
          if (text.trim() && !st.cache.has(text) && !pending.has(key) && !texts.includes(text)) texts.push(text);
          return false;
        });
        if (texts.length === 0) return;
        const policy = st.policy;
        for (const t of texts) pending.add(`${policy}\u0000${t}`);
        st.client.symbolize(texts, policy).then(
          (all) => {
            for (const t of texts) pending.delete(`${policy}\u0000${t}`);
            if (destroyed) return;
            const items = texts.map((t, i): [string, TokenDto[]] => [t, all[i] ?? []]);
            v.dispatch(v.state.tr.setMeta(engineKey, { results: { policy, items } } satisfies EngineMeta).setMeta("addToHistory", false));
          },
          (err: unknown) => {
            for (const t of texts) pending.delete(`${policy}\u0000${t}`);
            console.error("motore:", err);
          },
        );
      };
      let destroyed = false;
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
        },
      };
    },
  });
}

export function engineStats(view: EditorView): EngineStats {
  return engineKey.getState(view.state)?.stats ?? { words: 0, doubtful: 0, pending: 0 };
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
