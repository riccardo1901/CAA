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
}

export type Policy = "complete" | "essential";

export interface EngineInfo {
  ok: boolean;
  dir: string | null;
  error: string | null;
  tagger: boolean;
  expressions: boolean;
}

/** Quello che serve all'editor per parlare con il motore. */
export interface EngineClient {
  symbolize(texts: string[], policy: Policy): Promise<TokenDto[][]>;
  /** Indirizzo dell'immagine di un pittogramma. */
  url(picto: number): string;
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function tauriClient(): EngineClient {
  return {
    symbolize: (texts, policy) => invoke<TokenDto[][]>("symbolize", { texts, policy }),
    url: (picto) => convertFileSrc(String(picto), "picto"),
  };
}

export function engineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_info");
}
