// La barra dell'originale (M9b-2): «L'originale è stato aggiornato» per una copia adattata, e la vista
// dell'originale in sola lettura con il ritorno alla propria copia.

export type OriginalBarModel =
  | null
  | { kind: "update"; title: string; rev: number; onOpen(): void; onIgnore(): void }
  | { kind: "viewing"; title: string; onBack(): void };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface OriginalBar {
  root: HTMLElement;
  set(model: OriginalBarModel): void;
}

export function createOriginalBar(): OriginalBar {
  const root = el("div", "origbar");
  root.hidden = true;
  root.setAttribute("role", "status");
  const button = (label: string, title: string, fn: () => void): HTMLButtonElement => {
    const b = el("button", "", label);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", fn);
    return b;
  };
  const set = (m: OriginalBarModel): void => {
    root.replaceChildren();
    root.hidden = m === null;
    if (!m) return;
    if (m.kind === "update") {
      root.append(
        el("span", "orig-text", `L'originale «${m.title}» è stato aggiornato in biblioteca (revisione ${m.rev}). La tua copia non cambia da sola.`),
        button("Apri l'originale", "Lo guardi in sola lettura, poi torni alla tua copia", m.onOpen),
        button("Ignora", "Non ricordarmelo per questa revisione", m.onIgnore),
      );
      return;
    }
    root.append(
      el("span", "orig-text", `Stai guardando l'originale «${m.title}» della biblioteca, in sola lettura.`),
      button("Torna alla mia copia", "Riapre la tua copia", m.onBack),
    );
  };
  return { root, set };
}
