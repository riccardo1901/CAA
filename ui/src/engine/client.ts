// Collegamento con il motore (M8). Nell'app (Tauri) i comandi arrivano al motore in Rust; nel browser
// (prove automatiche) non c'è motore e l'editor usa i simboli finti del prototipo o un motore finto.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Un token come lo manda il motore (vedi src-tauri/src/bridge.rs). Offset in unità UTF-16. */
export interface TokenDto {
  s: number;
  e: number;
  kind: "word" | "punct" | "number" | "unknown";
  display: "full" | "reduced" | "text" | "hidden";
  picto: number | null;
  image: boolean;
  /** Segni: 1 plurale, 2 passato, 4 futuro. */
  mods: number;
  group: number;
  head: boolean;
  confidence: number;
  doubtful: boolean;
  placeholder: boolean;
  /** Lemma e categoria ("NOUN"…) della lettura scelta; vuoti se la parola è sconosciuta. */
  lemma: string;
  cat: string;
  /** La scelta viene dal docente. */
  teacher: boolean;
  /** Perché il motore ha deciso così, in una riga. */
  why: string;
}

/** Una scelta del docente su una parola del paragrafo (picto 0 = nessun simbolo). */
export interface ForcedReq {
  s: number;
  e: number;
  picto: number;
}

/** Un paragrafo con le scelte fatte sulle sue parole. */
export interface ParaReq {
  text: string;
  forced: ForcedReq[];
}

/** Blocco di senso: il lemma (con categoria) prende sempre quel pittogramma. */
export interface LockReq {
  lemma: string;
  cat: string;
  picto: number;
}

/** Un'alternativa del menu (o un risultato di ricerca). */
export interface CandidateDto {
  picto: number;
  keyword: string;
  reason: string;
  /** L'immagine è disponibile nei dati. */
  image: boolean;
}

/** Politica delle parole funzionali: `complete`, `essential` o `custom:articles=reduced;clitics=full;che=text;preps=full;conj=full`. */
export type Policy = string;

/** Cosa si mostra di una categoria: simbolo, simbolo ridotto (solo articoli), solo testo, nascosto. */
export type Rule = "full" | "reduced" | "text" | "hidden";

/** La tabella del preset «Personalizzato». */
export interface PolicyTable {
  articles: Rule;
  clitics: Rule;
  che: Rule;
  preps: Rule;
  conj: Rule;
}

export interface EngineInfo {
  ok: boolean;
  dir: string | null;
  error: string | null;
  tagger: boolean;
  expressions: boolean;
}

/** Quello che serve all'editor per parlare con il motore. */
export interface EngineClient {
  symbolize(paras: ParaReq[], policy: Policy, locks: LockReq[]): Promise<TokenDto[][]>;
  /** Le alternative per la parola [s, e) del paragrafo. */
  alternatives(para: ParaReq, policy: Policy, locks: LockReq[], s: number, e: number): Promise<CandidateDto[]>;
  /** Ricerca libera di un pittogramma. */
  search(query: string): Promise<CandidateDto[]>;
  /** Indirizzo dell'immagine di un pittogramma. */
  url(picto: number): string;
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function tauriClient(): EngineClient {
  return {
    symbolize: (paras, policy, locks) => invoke<TokenDto[][]>("symbolize", { paras, policy, locks }),
    alternatives: (para, policy, locks, s, e) => invoke<CandidateDto[]>("alternatives", { para, policy, locks, s, e }),
    search: (query) => invoke<CandidateDto[]>("search_pictos", { query }),
    url: (picto) => convertFileSrc(String(picto), "picto"),
  };
}

export function engineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_info");
}
