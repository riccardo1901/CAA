// Le preferenze di un documento (nel manifest): politica delle parole funzionali, dimensione dei simboli,
// contorno a card. Un file è un dato non fidato: si ripulisce tutto prima di usarlo.
import type { PolicyTable, Rule } from "../engine/client";

export type Preset = "complete" | "essential" | "custom";

export interface DocPrefs {
  preset: Preset;
  table: PolicyTable;
  size: number;
  cards: boolean;
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
  const out: Partial<DocPrefs> = {};
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
  return out;
}
