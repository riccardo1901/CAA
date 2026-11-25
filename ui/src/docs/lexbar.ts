// La barra «il lessico è cambiato» (M9a): un documento salvato con un lessico più vecchio si apre con i simboli
// vecchi e questa barra chiede cosa fare: rivedere una parola alla volta, applicare tutti i nuovi, o mantenere
// i vecchi (SPEC.md, "Il problema delle versioni del lessico").

export type LexBarModel =
  | null
  | { kind: "summary"; count: number; onReview(): void; onApplyAll(): void; onKeepAll(): void }
  | {
      kind: "review";
      k: number;
      total: number;
      word: string;
      oldPicto: number;
      newPicto: number;
      onKeep(): void;
      onUseNew(): void;
      onSkip(): void;
      onEnd(): void;
    };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface LexBar {
  root: HTMLElement;
  set(model: LexBarModel): void;
}

export function createLexBar(url: (picto: number) => string): LexBar {
  const root = el("div", "lexbar");
  root.hidden = true;
  root.setAttribute("role", "status");
  const button = (label: string, title: string, fn: () => void): HTMLButtonElement => {
    const b = el("button", "", label);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", fn);
    return b;
  };
  const thumb = (picto: number, caption: string): HTMLElement => {
    const box = el("span", "lex-thumb");
    if (picto > 0) {
      const img = el("img");
      img.src = url(picto);
      img.alt = "";
      box.append(img);
    } else {
      box.append(el("span", "lex-none", "—"));
    }
    box.append(el("span", "lex-cap", caption));
    return box;
  };
  const set = (m: LexBarModel): void => {
    root.replaceChildren();
    root.hidden = m === null;
    if (!m) return;
    if (m.kind === "summary") {
      root.append(
        el("span", "lex-text", `Il lessico è stato aggiornato: il nuovo cambierebbe ${m.count} ${m.count === 1 ? "simbolo" : "simboli"} di questo documento. Per ora vedi quelli vecchi.`),
        button("Rivedi", "Una parola alla volta", m.onReview),
        button("Applica tutti", "Usa tutti i simboli nuovi", m.onApplyAll),
        button("Mantieni i vecchi", "Il documento resta com'era", m.onKeepAll),
      );
      return;
    }
    root.append(
      el("span", "lex-text", `Parola ${m.k} di ${m.total}: «${m.word}»`),
      thumb(m.oldPicto, "vecchio"),
      el("span", "lex-arrow", "→"),
      thumb(m.newPicto, "nuovo"),
      button("Tieni il vecchio", "Questa parola resta com'era", m.onKeep),
      button("Usa il nuovo", "Questa parola prende il simbolo nuovo", m.onUseNew),
      button("Salta", "Decido dopo", m.onSkip),
      button("Fine revisione", "Torna al riepilogo", m.onEnd),
    );
  };
  return { root, set };
}
