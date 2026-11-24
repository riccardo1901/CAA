// Barra laterale dei simboli (M8b): fissa a destra, si riempie quando si agisce su una parola (clic sul
// simbolo, Alt+↓, F8, clic sul contatore). Mostra la parola, il simbolo attuale, il perché del motore,
// fino a 8 alternative, "Nessun simbolo", "Solo testo", "Automatico", "Cerca…" e "usa per tutto il testo".
// Una scelta è un solo passo di annulla.
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { CandidateDto, EngineClient } from "./engine/client";
import { nextDoubtful, onEngineUpdate, tokenAt, type TokenAt } from "./editor/engineSymbols";
import { focusWordRange, hooks, revealPos, setFocusWord } from "./editor/menuHooks";
import { applyChoice, type Choice } from "./editor/picks";

const GRID = 8;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Crea l'elemento della barra (vuoto: i suggerimenti). Va messo accanto al foglio. */
export function createSidebar(): HTMLElement {
  const root = el("aside", "side");
  root.tabIndex = -1;
  root.setAttribute("aria-label", "Simboli della parola");
  return root;
}

const EMPTY_HINT = [
  "Clicca sul simbolo di una parola per vedere le alternative.",
  "Alt+↓ sulla parola dove hai il cursore.",
  "F8 (o il contatore in basso) porta alla prossima parola da controllare.",
];

let unsubscribe: (() => void) | null = null;
let removeF8: (() => void) | null = null;

/** Collega la barra all'editor e al motore. Si può richiamare con un motore nuovo. */
export function installSidebar(view: EditorView, client: EngineClient, root: HTMLElement): void {
  unsubscribe?.();
  removeF8?.();
  let target: TokenAt | null = null;
  let shownWord = "";
  let sig = "";
  let generation = 0;
  let candidates: CandidateDto[] = [];
  let results: CandidateDto[] = [];
  let searching = false;
  // Il ritardo della ricerca è unico: passando a un'altra parola quello vecchio si annulla.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  // La casella «usa per tutto il testo» resta come l'ha messa il docente anche quando la barra si ridisegna.
  let lockAll = true;

  const signature = (t: TokenAt): string => `${t.token.picto}|${t.token.display}|${t.pick}|${t.token.why}|${t.token.lemma}`;

  function showEmpty(): void {
    generation++;
    target = null;
    sig = "";
    root.replaceChildren();
    const box = el("div", "side-empty");
    box.append(el("h2", "", "Simboli"));
    for (const line of EMPTY_HINT) box.append(el("p", "", line));
    root.append(box);
  }

  function show(t: TokenAt, focusSide: boolean): void {
    const mine = ++generation;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    target = t;
    sig = signature(t);
    shownWord = t.para.text.slice(t.token.s, t.token.e);
    searching = false;
    candidates = [];
    results = [];

    const head = el("div", "pm-head");
    const now = el("div", "pm-now");
    if (t.token.picto !== null && t.token.image && (t.token.display === "full" || t.token.display === "reduced")) {
      const img = el("img");
      img.src = client.url(t.token.picto);
      img.alt = "";
      now.append(img);
    }
    const titles = el("div", "pm-titles");
    titles.append(el("strong", "", shownWord), el("span", "pm-why", t.token.why));
    head.append(now, titles);

    const grid = el("div", "pm-grid");
    const status = el("div", "pm-status", "Carico le alternative…");

    const all = el("input");
    all.type = "checkbox";
    all.checked = lockAll;
    all.addEventListener("change", () => {
      lockAll = all.checked;
    });
    const canLock = t.token.lemma !== "" && t.token.cat !== "";
    all.disabled = !canLock;
    const allLabel = el("label", "pm-all");
    allLabel.append(all, " usa per tutto il testo");
    allLabel.title = canLock ? "Tutte le parole uguali del testo prendono questo simbolo" : "Parola non riconosciuta: vale solo qui";

    const choose = (choice: Choice): void => {
      // La posizione della parola si legge adesso: il testo può essere cambiato da quando la barra l'ha mostrata.
      const w = target ?? t;
      applyChoice(view, { paraPos: w.paraPos, s: w.token.s, e: w.token.e, lemma: w.token.lemma, cat: w.token.cat }, choice, all.checked && canLock);
      // La barra resta sulla parola e si aggiorna quando il motore risponde; il cursore torna nel testo.
      view.focus();
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
    const button = (label: string, title: string, fn: () => void): void => {
      const b = el("button", "pm-btn", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", fn);
      fixed.append(b);
    };
    button("Nessun simbolo", "Lascia lo spazio del simbolo vuoto", () => choose({ kind: "none" }));
    button("Solo testo", "Parola senza spazio per il simbolo", () => choose({ kind: "text" }));
    if (t.pick !== null) button("Automatico", "Torna alla scelta del motore", () => choose({ kind: "auto" }));

    // Ricerca libera: la barra è in alto, i risultati prendono il posto delle alternative.
    const search = el("input", "pm-search");
    search.type = "search";
    search.placeholder = "Cerca un simbolo…";
    search.setAttribute("aria-label", "Cerca un simbolo");
    let resultsQuery = "";
    const runSearch = (): void => {
      if (generation !== mine) return;
      const q = search.value.trim();
      if (q === "") {
        // Query vuota: tornano le alternative della parola.
        results = [];
        resultsQuery = "";
        searching = false;
        status.textContent = candidates.length ? "" : "Nessuna altra alternativa: puoi cercare un simbolo";
        render(candidates, true);
        return;
      }
      searching = true;
      client.search(q).then(
        (r) => {
          if (generation !== mine || search.value.trim() !== q) return;
          results = r;
          resultsQuery = q;
          status.textContent = r.length ? "" : "Nessun simbolo trovato";
          render(r, false);
        },
        () => {
          if (generation === mine) status.textContent = "Ricerca non riuscita";
        },
      );
    };
    search.addEventListener("input", () => {
      if (search.value.trim() !== "") searching = true;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 150);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      // I risultati devono essere quelli di quello che è scritto adesso, non della ricerca di prima.
      if (search.value.trim() !== resultsQuery) {
        if (searchTimer) clearTimeout(searchTimer);
        runSearch();
      } else if (results[0]) {
        choose({ kind: "picto", id: results[0].picto });
      }
    });

    const keys = el("p", "pm-keys", "1–8 sceglie · Esc torna al testo · F8 prossima parola da controllare");
    root.replaceChildren(search, head, status, grid, fixed, allLabel, keys);
    if (focusSide) root.focus();

    client.alternatives(t.para, t.policy, t.locks, t.token.s, t.token.e).then(
      (list) => {
        if (generation !== mine) return;
        candidates = list; // si tengono anche se si sta cercando: servono quando si svuota la ricerca
        if (searching) return;
        status.textContent = list.length ? "" : "Nessuna altra alternativa: puoi cercare un simbolo";
        render(list, true);
      },
      () => {
        if (generation === mine) status.textContent = "Non riesco a caricare le alternative";
      },
    );
  }

  // Tastiera nella barra: 1–8 scelgono (non nella ricerca), Esc torna al testo.
  root.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      view.focus();
      return;
    }
    const inSearch = (e.target as HTMLElement | null)?.tagName === "INPUT" && (e.target as HTMLInputElement).type === "search";
    if (target && !inSearch && !searching && /^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const c = candidates[Number(e.key) - 1];
      if (c) {
        e.preventDefault();
        (root.querySelectorAll<HTMLButtonElement>(".pm-cell")[Number(e.key) - 1] ?? null)?.click();
      }
    }
  };

  // F8 funziona anche con il fuoco nella barra (nel testo lo prende la tastiera dell'editor, che lo segna come gestito).
  const onF8 = (e: KeyboardEvent): void => {
    if (e.key !== "F8" || e.defaultPrevented) return;
    e.preventDefault();
    hooks.next?.();
  };
  document.addEventListener("keydown", onF8);
  removeF8 = () => document.removeEventListener("keydown", onF8);

  /** La parola è cambiata (scelta fatta, testo modificato, politica): aggiorna o svuota la barra. */
  function refresh(): void {
    if (!target) return;
    const r = focusWordRange(view);
    if (!r) {
      showEmpty();
      return;
    }
    const t = tokenAt(view, r.from);
    if (!t) return; // il motore non ha ancora risposto
    if (t.para.text.slice(t.token.s, t.token.e) !== shownWord) {
      setFocusWord(view, null);
      showEmpty();
      return;
    }
    if (signature(t) !== sig) show(t, false);
    else target = t; // stessa parola e stessi simboli: si aggiornano solo le posizioni
  }
  unsubscribe = onEngineUpdate(refresh);

  const activate = (t: TokenAt, focusSide: boolean): void => {
    // Cambiando l'evidenziazione l'editor si aggiorna e chiama `refresh`: con la parola vecchia ancora
    // "in mostra" lo scambierebbe per una parola cambiata e svuoterebbe la barra.
    target = null;
    setFocusWord(view, [t.from, t.to]);
    show(t, focusSide);
  };
  hooks.openAt = (pos) => {
    const t = tokenAt(view, pos);
    if (!t) return false;
    activate(t, true);
    return true;
  };
  hooks.openAtCursor = () => {
    const t = tokenAt(view, view.state.selection.head);
    if (!t) return false;
    revealPos(view, t.from);
    activate(t, true);
    return true;
  };
  hooks.next = () => {
    const t = nextDoubtful(view, view.state.selection.head);
    if (!t) return true; // niente da controllare: il tasto non fa altro
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, t.from)));
    revealPos(view, t.from);
    activate(t, true);
    return true;
  };
  showEmpty();
}
