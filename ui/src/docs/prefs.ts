// Le preferenze di un documento (nel manifest): politica delle parole funzionali, dimensione dei simboli,
// contorno a card. Un file è un dato non fidato: si ripulisce tutto prima di usarlo.
import type { PolicyTable, Rule } from "../engine/client";

export type Preset = "complete" | "essential" | "custom";

/** Come si stampa il documento (M10): salvato con il documento, così chiunque lo stampa uguale. La dimensione dei
 *  simboli è quella dei pulsanti «Simboli» (45, 68, 94, 151 px = 12, 18, 25, 40 mm a 96 dpi, stampati a grandezza vera). */
export interface PrintPrefs {
  orientation: "portrait" | "landscape";
  /** Margini in millimetri. */
  margin: number;
  /** Testo sopra il simbolo (di partenza sotto). */
  textAbove: boolean;
  /** Bordo attorno a ogni simbolo. */
  border: boolean;
  /** Una frase per riga. */
  onePerLine: boolean;
  /** Tutto maiuscolo, solo in resa. */
  uppercase: boolean;
  font: "system" | "atkinson" | "lexend";
  /** Piè di pagina facoltativi (l'attribuzione ARASAAC c'è sempre). */
  footerTitle: boolean;
  footerAuthor: boolean;
  footerPage: boolean;
}

export const DEFAULT_PRINT: PrintPrefs = {
  orientation: "portrait",
  margin: 15,
  textAbove: false,
  border: false,
  onePerLine: false,
  uppercase: false,
  font: "system",
  footerTitle: false,
  footerAuthor: false,
  footerPage: false,
};

export interface DocPrefs {
  preset: Preset;
  table: PolicyTable;
  size: number;
  cards: boolean;
  print: PrintPrefs;
}

/** Da un valore qualunque (letto da un file) alle sole impostazioni di stampa valide; il resto è quello di partenza. */
export function sanitizePrint(value: unknown): PrintPrefs {
  const out: PrintPrefs = { ...DEFAULT_PRINT };
  if (!value || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;
  if (v.orientation === "portrait" || v.orientation === "landscape") out.orientation = v.orientation;
  if (typeof v.margin === "number" && Number.isFinite(v.margin)) out.margin = Math.min(40, Math.max(5, Math.round(v.margin)));
  if (v.font === "system" || v.font === "atkinson" || v.font === "lexend") out.font = v.font;
  for (const k of ["textAbove", "border", "onePerLine", "uppercase", "footerTitle", "footerAuthor", "footerPage"] as const) {
    if (typeof v[k] === "boolean") out[k] = v[k] as boolean;
  }
  return out;
}

/** Le scelte ammesse per ogni riga della tabella (le stesse della finestra «Personalizzato»). */
export const ALLOWED: Record<keyof PolicyTable, Rule[]> = {
  articles: ["reduced", "full", "text", "hidden"],
  clitics: ["full", "text", "hidden"],
  che: ["full", "text", "hidden"],
  preps: ["full", "text"],
  conj: ["full", "text"],
};

export const COMPLETE_TABLE: PolicyTable = { articles: "reduced", clitics: "full", che: "text", preps: "full", conj: "full" };

/** Da un valore qualunque (letto da un file) alle sole preferenze valide; il resto resta com'è. */
export function sanitizePrefs(value: unknown): Partial<DocPrefs> {
  const out: Partial<DocPrefs> = { print: { ...DEFAULT_PRINT } };
  if (!value || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;
  if (v.preset === "complete" || v.preset === "essential" || v.preset === "custom") out.preset = v.preset;
  if (v.table && typeof v.table === "object") {
    const t = v.table as Record<string, unknown>;
    const table: PolicyTable = { ...COMPLETE_TABLE };
    for (const key of Object.keys(ALLOWED) as Array<keyof PolicyTable>) {
      const r = t[key];
      if (typeof r === "string" && (ALLOWED[key] as string[]).includes(r)) table[key] = r as Rule;
    }
    out.table = table;
  }
  if (typeof v.size === "number" && Number.isFinite(v.size) && v.size >= 20 && v.size <= 400) out.size = Math.round(v.size);
  if (typeof v.cards === "boolean") out.cards = v.cards;
  // Sempre: un documento senza impostazioni di stampa non eredita quelle del precedente.
  out.print = sanitizePrint(v.print);
  return out;
}
