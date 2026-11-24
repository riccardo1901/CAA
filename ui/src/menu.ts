// Menu delle alternative (M8b): clic sul simbolo (o Alt+↓) → griglia di pittogrammi, "Nessun simbolo",
// "Solo testo", "Cerca…" e la casella "usa per tutto il testo". Una scelta è un solo passo di annulla.
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { CandidateDto, EngineClient } from "./engine/client";
import { nextDoubtful, tokenAt, type TokenAt } from "./editor/engineSymbols";
import { hooks } from "./editor/menuHooks";
import { applyChoice, type Choice } from "./editor/picks";

const GRID = 8;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Open {
  root: HTMLElement;
  close: () => void;
}

/** Installa il menu sull'editor: registra i collegamenti in `hooks`. */
export function installMenu(view: EditorView, client: EngineClient): void {
  let current: Open | null = null;

  function close(refocus = false): void {
    current?.close();
    current = null;
    if (refocus) view.focus();
  }

  function open(target: TokenAt): void {
    close();
    const word = target.para.text.slice(target.token.s, target.token.e);
    const root = el("div", "pmenu");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", `Simbolo per «${word}»`);

    // Intestazione: parola, simbolo attuale e perché.
    const head = el("div", "pm-head");
    const now = el("div", "pm-now");
    if (target.token.picto !== null && target.token.image) {
      const img = el("img");
      img.src = client.url(target.token.picto);
      img.alt = "";
      now.append(img);
    }
    const titles = el("div", "pm-titles");
    titles.append(el("strong", "", word), el("span", "pm-why", target.token.why));
    head.append(now, titles);

    const grid = el("div", "pm-grid");
    const status = el("div", "pm-status", "Carico le alternative…");
    let searching = false;
    let candidates: CandidateDto[] = [];

    const all = el("input");
    all.type = "checkbox";
    all.checked = true;
    const canLock = target.token.lemma !== "" && target.token.cat !== "";
    all.disabled = !canLock;
    const allLabel = el("label", "pm-all");
    allLabel.append(all, " usa per tutto il testo");
    allLabel.title = canLock ? "Tutte le parole uguali del testo prendono questo simbolo" : "Parola non riconosciuta: vale solo qui";

    const choose = (choice: Choice): void => {
      applyChoice(view, { paraPos: target.paraPos, s: target.token.s, e: target.token.e, lemma: target.token.lemma, cat: target.token.cat }, choice, all.checked && canLock);
      close(true);
    };

    const render = (list: CandidateDto[], numbered: boolean): void => {
      grid.replaceChildren();
      list.slice(0, numbered ? GRID : 24).forEach((c, i) => {
        const b = el("button", "pm-cell");
        b.type = "button";
        b.title = c.reason;
        if (c.image) {
          const img = el("img");
          img.src = client.url(c.picto);
          img.alt = "";
          b.append(img);
        } else {
          b.append(el("span", "pm-noimg", "?"));
        }
        b.append(el("span", "pm-kw", c.keyword));
        if (numbered) b.append(el("span", "pm-num", String(i + 1)));
        b.addEventListener("click", () => choose({ kind: "picto", id: c.picto }));
        grid.append(b);
      });
    };

    const fixed = el("div", "pm-fixed");
    const button = (label: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = el("button", "pm-btn", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", fn);
      fixed.append(b);
      return b;
    };
    button("Nessun simbolo", "Lascia lo spazio del simbolo vuoto", () => choose({ kind: "none" }));
    button("Solo testo", "Parola senza spazio per il simbolo", () => choose({ kind: "text" }));
    if (target.pick !== null) button("Automatico", "Torna alla scelta del motore", () => choose({ kind: "auto" }));

    const search = el("input", "pm-search");
    search.type = "search";
    search.placeholder = "Cerca un simbolo…";
    search.hidden = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let results: CandidateDto[] = [];
    const runSearch = (): void => {
      const q = search.value.trim();
      if (q === "") {
        results = [];
        status.textContent = "Scrivi una parola";
        grid.replaceChildren();
        return;
      }
      client.search(q).then(
        (r) => {
          if (current?.root !== root || search.value.trim() !== q) return;
          results = r;
          status.textContent = r.length ? "" : "Nessun simbolo trovato";
          render(r, false);
        },
        () => {
          if (current?.root === root) status.textContent = "Ricerca non riuscita";
        },
      );
    };
    search.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runSearch, 150);
    });
    button("Cerca…", "Cerca un pittogramma per parola", () => {
      searching = true;
      search.hidden = false;
      status.textContent = "Scrivi una parola";
      grid.replaceChildren();
      search.focus();
    });

    root.append(head, status, grid, fixed, search, allLabel);
    document.body.append(root);
    place(root, target);

    // Tastiera: 1–8 scelgono, Esc chiude, Invio nella ricerca sceglie il primo risultato.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      }
      if (searching && document.activeElement === search) {
        if (e.key === "Enter" && results[0]) {
          e.preventDefault();
          choose({ kind: "picto", id: results[0].picto });
        }
        return;
      }
      if (!searching && /^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const c = candidates[Number(e.key) - 1];
        if (c) {
          e.preventDefault();
          choose({ kind: "picto", id: c.picto });
        }
      }
    };
    const onDown = (e: MouseEvent): void => {
      if (!root.contains(e.target as Node)) close();
    };
    const onScroll = (): void => close();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("resize", onScroll);
    document.querySelector(".sheet-wrap")?.addEventListener("scroll", onScroll);

    current = {
      root,
      close: () => {
        if (timer) clearTimeout(timer);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("mousedown", onDown, true);
        window.removeEventListener("resize", onScroll);
        document.querySelector(".sheet-wrap")?.removeEventListener("scroll", onScroll);
        root.remove();
      },
    };

    client.alternatives(target.para, target.policy, target.locks, target.token.s, target.token.e).then(
      (list) => {
        if (current?.root !== root || searching) return;
        candidates = list;
        status.textContent = list.length ? "" : "Nessuna altra alternativa: puoi cercare un simbolo";
        render(list, true);
      },
      () => {
        if (current?.root === root) status.textContent = "Non riesco a caricare le alternative";
      },
    );
  }

  /** Sotto la parola, dentro lo schermo. */
  function place(root: HTMLElement, target: TokenAt): void {
    const c = view.coordsAtPos(target.from);
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const left = Math.max(8, Math.min(c.left, window.innerWidth - w - 8));
    const below = c.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, c.top - h - 6) : below;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  hooks.openAt = (pos) => {
    const t = tokenAt(view, pos);
    if (!t) return false;
    open(t);
    return true;
  };
  hooks.openAtCursor = () => {
    const t = tokenAt(view, view.state.selection.head);
    if (!t) return false;
    open(t);
    return true;
  };
  hooks.next = () => {
    const t = nextDoubtful(view, view.state.selection.head);
    if (!t) return true; // niente da controllare: il tasto non fa altro
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, t.from)).scrollIntoView());
    view.focus();
    open(t);
    return true;
  };
}
