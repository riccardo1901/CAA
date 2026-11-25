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
import { AddMarkStep, RemoveMarkStep, type Step } from "prosemirror-transform";
import type { EngineClient, LockReq, ParaReq, Policy, TokenDto } from "../engine/client";
import { collectLocks, CUSTOM_BASE, paraInfo, PICTO_TEXT_ONLY } from "./picks";
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

/** Un simbolo come stava nel documento quando è stato salvato (`render.json`). */
interface LegacyToken {
  picto: number;
  display: TokenDto["display"];
  mods: number;
}

/**
 * I simboli salvati dei paragrafi (per testo del paragrafo, poi per intervallo "inizio-fine" della parola),
 * mostrati al posto di quelli del lessico nuovo finché il docente non decide. Per testo e non per posizione:
 * se si inserisce un paragrafo sopra, quelli già salvati restano al loro posto.
 */
type Legacy = Map<string, Map<string, LegacyToken>>;

interface State {
  client: EngineClient | null;
  /** Simboli vecchi (da `render.json`); `null` se nessuna decisione è in sospeso. */
  legacy: Legacy | null;
  policy: Policy;
  cache: Map<string, Entry>;
  /** Blocchi di senso del documento ("usa per tutto il testo") e la loro firma. */
  locks: LockReq[];
  locksSig: string;
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
  /** Imposta (o toglie, con `null`) i simboli vecchi da mostrare al posto di quelli del lessico nuovo. */
  legacy?: Legacy | null;
  /** Il docente ha deciso per un simbolo: il vecchio non si mostra più. */
  dropLegacy?: { text: string; key: string };
  /** Risposte del motore: chiave del paragrafo (testo, scelte, blocchi) → token, per la politica indicata. */
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

/** Un paragrafo da mandare al motore, con la chiave sotto cui si salva la risposta. */
interface Job {
  key: string;
  para: ParaReq;
}

const listeners = new Set<() => void>();
let lastError: string | null = null;

/** Chiamata dopo ogni modifica dello stato dell'editor (aggiorna la barra di stato). */
export function onEngineUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Chiave di cache di un paragrafo: testo, scelte del docente sulle sue parole e blocchi di senso. */
export function paraKey(node: PMNode, locksSig: string): string {
  return `${node.textContent}\u0001${paraInfo(node).sig}\u0002${locksSig}`;
}

/** Classi e stile del primo pezzo di un token. `textOnly`: il docente ha scelto "solo testo". */
function firstPiece(t: TokenDto, client: EngineClient, textOnly: boolean): { class: string; style?: string } {
  const classes = ["w"];
  if (textOnly) classes.push("txt");
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

/** I token del motore con sopra i simboli vecchi del documento (se il testo del paragrafo è lo stesso). */
function withLegacy(tokens: TokenDto[], text: string, legacy: Legacy | null | undefined): TokenDto[] {
  const saved = legacy?.get(text);
  if (!saved) return tokens;
  return tokens.map((t) => {
    const o = saved.get(`${t.s}-${t.e}`);
    // Una scelta del docente (fatta dopo l'apertura) vince sempre sul simbolo vecchio.
    if (!o || t.teacher) return t;
    return { ...t, picto: o.picto > 0 ? o.picto : null, image: o.picto > 0, display: o.display, mods: o.mods, placeholder: false, doubtful: false };
  });
}

function paragraphDecos(node: PMNode, pos: number, shown: TokenDto[], client: EngineClient, legacy?: Legacy | null): Decoration[] {
  const tokens = withLegacy(shown, node.textContent, legacy);
  const out: Decoration[] = [];
  const ends = pieceEnds(node);
  const size = node.content.size;
  const picks = paraInfo(node).picks;
  for (const t of tokens) {
    if (t.kind === "punct" || t.e > size || t.s >= t.e) continue;
    const textOnly = picks.some((p) => p.s === t.s && p.e === t.e && p.picto === PICTO_TEXT_ONLY);
    // Il simbolo sta sul primo pezzo; i pezzi successivi (parola spezzata dalla formattazione) sono testo.
    splitWord(t.s, t.e, ends).forEach(([x, y], i) => {
      const attrs: { class: string; style?: string } = i === 0 ? firstPiece(t, client, textOnly) : { class: "w wc" };
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
function computeStats(doc: PMNode, cache: Map<string, Entry>, previous: EngineStats, locksSig: string): EngineStats {
  let words = 0;
  let doubtful = 0;
  let pending = 0;
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const entry = cache.get(paraKey(node, locksSig));
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
    const entry = value.cache.get(paraKey(node, value.locksSig));
    // Testo nuovo: finché non risponde il motore restano i simboli di prima, spostati dalla modifica.
    if (entry) decos.push(...paragraphDecos(node, pos, entry.tokens, client, value.legacy));
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
    const entry = value.cache.get(paraKey(node, value.locksSig));
    if (!entry) continue;
    decos = decos.remove(decos.find(pos, pos + node.nodeSize));
    decos = decos.add(doc, paragraphDecos(node, pos, entry.tokens, client, value.legacy));
  }
  return decos;
}

/** Inizio dei paragrafi del documento nuovo toccati dalle modifiche di una transazione. */
function touchedParagraphs(tr: { mapping: import("prosemirror-transform").Mapping; doc: PMNode; steps: readonly Step[] }): Set<number> {
  const touched = new Set<number>();
  // Un mark (scelta del docente, annulla) non sposta nulla e la sua mappa è vuota: i paragrafi si
  // ricavano dall'intervallo del passo.
  tr.steps.forEach((step, i) => {
    if (!(step instanceof AddMarkStep || step instanceof RemoveMarkStep)) return;
    const rest = tr.mapping.slice(i + 1);
    const a = rest.map(step.from, -1);
    const b = Math.max(a, rest.map(step.to, 1));
    tr.doc.nodesBetween(a, b, (node, pos) => {
      if (node.isTextblock) touched.add(pos);
      return !node.isTextblock;
    });
  });
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
function prune(cache: Map<string, Entry>, doc: PMNode, locksSig: string): void {
  let chars = 0;
  for (const k of cache.keys()) chars += k.length;
  if (cache.size <= CACHE_ENTRIES && chars <= CACHE_CHARS) return;
  const inDoc = new Set<string>();
  doc.descendants((node) => {
    if (node.isTextblock) inDoc.add(paraKey(node, locksSig));
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
        legacy: null,
        locks: [],
        locksSig: "",
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
        if (meta?.legacy !== undefined) {
          next = { ...next, legacy: meta.legacy };
          full = true;
        }
        if (meta?.dropLegacy && next.legacy) {
          const map = new Map(next.legacy);
          const saved = map.get(meta.dropLegacy.text);
          if (saved) {
            const tokens = new Map(saved);
            tokens.delete(meta.dropLegacy.key);
            map.set(meta.dropLegacy.text, tokens);
          }
          next = { ...next, legacy: map };
          full = true;
        }
        const mapped = tr.docChanged ? value.decos.map(tr.mapping, tr.doc) : value.decos;
        // I blocchi di senso cambiano il risultato di tutti i paragrafi: nuove chiavi, si ridisegna tutto.
        if (tr.docChanged || meta?.client !== undefined) {
          const locks = collectLocks(tr.doc);
          if (locks.sig !== next.locksSig) {
            next = { ...next, locks: locks.list, locksSig: locks.sig };
            full = true;
          }
        }
        if (!next.client) return { ...next, decos: mapped };
        const arrived = new Set<string>();
        if (meta?.results && meta.results.policy === next.policy) {
          // La cache e' un'ottimizzazione e non fa parte della cronologia: si aggiorna sul posto.
          for (const [text, tokens] of meta.results.items) {
            next.cache.set(text, entryOf(tokens));
            arrived.add(text);
          }
          prune(next.cache, state.doc, next.locksSig);
        }
        let decos: DecorationSet;
        if (full) {
          decos = rebuildAll(state.doc, next, mapped);
        } else {
          const starts = new Set<number>();
          if (tr.docChanged) for (const pos of touchedParagraphs(tr)) starts.add(pos);
          if (arrived.size > 0) {
            state.doc.descendants((node, pos) => {
              if (node.isTextblock && arrived.has(paraKey(node, next.locksSig))) starts.add(pos);
              return !node.isTextblock;
            });
          }
          decos = starts.size > 0 ? rebuildSome(state.doc, next, mapped, starts) : mapped;
        }
        const stats = computeStats(state.doc, next.cache, value.stats, next.locksSig);
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

      const send = async (v: EditorView, items: Job[], policy: Policy, locks: LockReq[], client: EngineClient) => {
        for (let i = 0; i < items.length; ) {
          // Un lotto: al massimo BATCH_PARAGRAPHS paragrafi e BATCH_CHARS caratteri.
          const batch: Job[] = [];
          let chars = 0;
          while (i < items.length && batch.length < BATCH_PARAGRAPHS && (batch.length === 0 || chars + items[i].para.text.length <= BATCH_CHARS)) {
            chars += items[i].para.text.length;
            batch.push(items[i++]);
          }
          try {
            const all = await client.symbolize(batch.map((j) => j.para), policy, locks);
            for (const j of batch) pending.delete(`${policy}\u0000${j.key}`);
            failures = 0;
            lastError = null;
            if (destroyed) return;
            const results = batch.map((j, k): [string, TokenDto[]] => [j.key, all[k] ?? []]);
            v.dispatch(v.state.tr.setMeta(engineKey, { results: { policy, items: results } } satisfies EngineMeta).setMeta("addToHistory", false));
          } catch (err) {
            // Errore del motore: si dice nella barra di stato e si riprova dopo un po' (1 s, 2 s, 4 s… al massimo 30 s).
            lastError = String(err);
            console.error("motore:", err);
            for (const j of items) pending.delete(`${policy}\u0000${j.key}`);
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
        const jobs: Job[] = [];
        const queued = new Set<string>();
        v.state.doc.descendants((node) => {
          if (!node.isTextblock) return true;
          const info = paraInfo(node);
          const key = paraKey(node, st.locksSig);
          if (info.text.trim() && !st.cache.has(key) && !pending.has(`${st.policy}\u0000${key}`) && !queued.has(key)) {
            queued.add(key);
            jobs.push({ key, para: { text: info.text, forced: info.forced } });
          }
          return false;
        });
        if (jobs.length === 0) return;
        for (const j of jobs) pending.add(`${st.policy}\u0000${j.key}`);
        void send(v, jobs, st.policy, st.locks, st.client);
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

/** Un token del documento con tutto quello che serve per il menu delle alternative. */
export interface TokenAt {
  /** Posizione di inizio del paragrafo. */
  paraPos: number;
  token: TokenDto;
  /** Inizio e fine della parola nel documento. */
  from: number;
  to: number;
  para: ParaReq;
  policy: Policy;
  locks: LockReq[];
  /** Scelta del docente su questa parola, se c'è (valore di `picto` del mark). */
  pick: number | null;
  /** Estensione (offset nel paragrafo) del gruppo di cui la parola è la testa, se ne ha uno. */
  groupSpan: [number, number] | null;
  /** Il blocco di senso del documento che vale per questa parola, se c'è. */
  lock: LockReq | null;
}

function tokenInfo(view: EditorView, st: State, paraPos: number, node: PMNode, token: TokenDto, tokens: TokenDto[]): TokenAt {
  const info = paraInfo(node);
  let groupSpan: [number, number] | null = null;
  if (token.group !== 0 && token.head) {
    const members = tokens.filter((x) => x.group === token.group);
    groupSpan = [Math.min(...members.map((x) => x.s)), Math.max(...members.map((x) => x.e))];
  }
  const p = info.picks.find((x) => x.s === token.s && x.e === token.e);
  return {
    paraPos,
    token,
    from: paraPos + 1 + token.s,
    to: paraPos + 1 + token.e,
    para: { text: info.text, forced: info.forced },
    policy: st.policy,
    locks: st.locks,
    pick: p ? p.picto : null,
    groupSpan,
    lock: st.locks.find((l) => l.cat === token.cat && l.lemma.toLowerCase() === token.lemma.toLowerCase()) ?? null,
  };
}

/**
 * Parole su cui si può scegliere il simbolo: non la punteggiatura e non i membri di un gruppo nascosti
 * (l'ausiliare di "ho mangiato": il simbolo sta sul verbo). Le parole nascoste solo dalla politica sì.
 */
function pickable(t: TokenDto): boolean {
  return t.kind !== "punct" && t.s < t.e && (t.display !== "hidden" || t.group === 0);
}

/** La parola alla posizione `pos` (se il cursore è alla fine di una parola vale quella), se il motore ha già risposto. */
export function tokenAt(view: EditorView, pos: number): TokenAt | null {
  const st = engineKey.getState(view.state);
  if (!st?.client) return null;
  const $pos = view.state.doc.resolve(pos);
  const node = $pos.parent;
  if (!node.isTextblock) return null;
  const entry = st.cache.get(paraKey(node, st.locksSig));
  if (!entry) return null;
  const off = pos - $pos.start();
  const all = entry.tokens.filter((t) => t.kind !== "punct" && t.s < t.e);
  let hit = all.find((t) => t.s <= off && off < t.e) ?? all.find((t) => t.e === off);
  // Una parola nascosta perché fa parte di un gruppo ("ho" in "ho mangiato", "media" in una unione) porta
  // alla testa del gruppo, che ha il simbolo.
  if (hit && hit.display === "hidden" && hit.group !== 0) {
    const g = hit.group;
    hit = all.find((t) => t.group === g && t.head);
  }
  return hit && pickable(hit) ? tokenInfo(view, st, $pos.before(), node, hit, entry.tokens) : null;
}

/** La prossima parola da controllare dopo `from` (con giro completo del documento). */
export function nextDoubtful(view: EditorView, from: number): TokenAt | null {
  const st = engineKey.getState(view.state);
  if (!st?.client) return null;
  let first: TokenAt | null = null;
  let after: TokenAt | null = null;
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const entry = st.cache.get(paraKey(node, st.locksSig));
    if (!entry) return false;
    for (const t of entry.tokens) {
      if (!t.doubtful || !pickable(t)) continue;
      const found = tokenInfo(view, st, pos, node, t, entry.tokens);
      first ??= found;
      if (!after && found.from > from) after = found;
    }
    return false;
  });
  return after ?? first;
}

// ---- Istantanea dei simboli (`render.json`) e simboli vecchi (M9a) ----

/** I simboli di un paragrafo come si salvano: `[inizio, fine, pittogramma (0 = nessuno), visualizzazione, segni]`. */
export interface RenderPara {
  i: number;
  text: string;
  tokens: Array<[number, number, number, string, number]>;
}

/**
 * Cosa il motore ha deciso per ogni paragrafo, da salvare nel documento (`render.json`). Con simboli vecchi in
 * sospeso si salvano quelli vecchi: salvare nel frattempo non deve far passare di nascosto il lessico nuovo.
 */
export function renderSnapshot(view: EditorView): RenderPara[] {
  const st = engineKey.getState(view.state);
  if (!st?.client) return [];
  const out: RenderPara[] = [];
  let index = 0;
  view.state.doc.forEach((node) => {
    const i = index++;
    if (!node.isTextblock) return;
    const entry = st.cache.get(paraKey(node, st.locksSig));
    if (!entry) return;
    const tokens = withLegacy(entry.tokens, node.textContent, st.legacy);
    out.push({
      i,
      text: node.textContent,
      // I simboli personali non si salvano nell'istantanea: il loro id vale solo su questo computer.
      tokens: tokens
        .filter((t) => t.kind !== "punct" && t.s < t.e && (t.picto ?? 0) < CUSTOM_BASE)
        .map((t) => [t.s, t.e, t.picto ?? 0, t.display, t.mods]),
    });
  });
  return out;
}

/** Ripulisce un `render.json` letto da un file (dato non fidato) e lo trasforma in simboli vecchi. */
export function parseRender(value: unknown): Legacy {
  const out: Legacy = new Map();
  if (!Array.isArray(value)) return out;
  for (const raw of value.slice(0, 20_000)) {
    const p = raw as Partial<RenderPara> | null;
    if (!p || typeof p.i !== "number" || !Number.isInteger(p.i) || p.i < 0 || typeof p.text !== "string" || !Array.isArray(p.tokens)) continue;
    const tokens = new Map<string, LegacyToken>();
    for (const t of p.tokens.slice(0, 100_000)) {
      if (!Array.isArray(t) || t.length < 5) continue;
      const [s, e, picto, display, mods] = t as unknown[];
      if (typeof s !== "number" || typeof e !== "number" || typeof picto !== "number" || typeof mods !== "number") continue;
      if (display !== "full" && display !== "reduced" && display !== "text" && display !== "hidden") continue;
      if (!Number.isInteger(picto) || picto < 0 || picto > 0xfffffffd) continue;
      tokens.set(`${s}-${e}`, { picto, display, mods: mods & 7 });
    }
    if (!out.has(p.text)) out.set(p.text, tokens);
  }
  return out;
}

/** Mostra i simboli salvati nel documento al posto di quelli del lessico nuovo, finché il docente non decide. */
export function setLegacy(view: EditorView, render: unknown): void {
  view.dispatch(view.state.tr.setMeta(engineKey, { legacy: parseRender(render) } satisfies EngineMeta).setMeta("addToHistory", false));
}

export function clearLegacy(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(engineKey, { legacy: null } satisfies EngineMeta).setMeta("addToHistory", false));
}

/** Il lessico nuovo cambierebbe il simbolo di questa parola. */
export interface LexChange {
  /** Testo del paragrafo (la chiave dei simboli vecchi) e posizione della parola nel documento. */
  text: string;
  index: number;
  paraPos: number;
  s: number;
  e: number;
  word: string;
  oldPicto: number;
  newPicto: number;
}

/**
 * Le parole di cui il lessico nuovo cambierebbe il simbolo (solo il pittogramma; segni e visualizzazione
 * seguono la politica del documento). `pending`: il motore non ha ancora risposto per tutti i paragrafi.
 */
export function legacyDiff(view: EditorView): { changes: LexChange[]; pending: boolean; active: boolean } {
  const st = engineKey.getState(view.state);
  const changes: LexChange[] = [];
  if (!st?.client || !st.legacy) return { changes, pending: false, active: false };
  let pending = false;
  let index = 0;
  view.state.doc.forEach((node, offset) => {
    const i = index++;
    const old = node.isTextblock ? st.legacy?.get(node.textContent) : undefined;
    if (!old) return;
    const entry = st.cache.get(paraKey(node, st.locksSig));
    if (!entry) {
      pending = true;
      return;
    }
    for (const t of entry.tokens) {
      const o = old.get(`${t.s}-${t.e}`);
      if (!o || t.kind === "punct" || t.teacher) continue;
      const now = t.picto ?? 0;
      if (o.picto !== now) changes.push({ text: node.textContent, index: i, paraPos: offset, s: t.s, e: t.e, word: node.textContent.slice(t.s, t.e), oldPicto: o.picto, newPicto: now });
    }
  });
  return { changes, pending, active: true };
}

/** Il docente ha deciso per una parola (nuovo simbolo): il vecchio non si mostra più. */
export function dropLegacyToken(view: EditorView, text: string, s: number, e: number): void {
  view.dispatch(view.state.tr.setMeta(engineKey, { dropLegacy: { text, key: `${s}-${e}` } } satisfies EngineMeta).setMeta("addToHistory", false));
}
