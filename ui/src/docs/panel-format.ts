// Formato della data dei documenti nell'elenco.

/** Data e ora di un documento come le scrive il docente (il manifest ha la data in UTC). */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
