// Barra laterale dei simboli (M8b): fissa a destra, si riempie quando si agisce su una parola (clic sul
// simbolo, Alt+↓, F8, clic sul contatore). Mostra la parola, il simbolo attuale, il perché del motore,
// fino a 8 alternative, "Nessun simbolo", "Solo testo", "Automatico", "Cerca…" e "usa per tutto il testo".
// Una scelta è un solo passo di annulla.
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { cropImage } from "./customDialog";
import { conIcona, type NomeIcona } from "./ui/icons";
import { conferma } from "./ui/confirm";
import type { CandidateDto, CustomSymbol, EngineClient, MemoryEntry } from "./engine/client";
import { nextDoubtful, onEngineUpdate, setEngine, tokenAt, type TokenAt } from "./editor/engineSymbols";
import { focusWordRange, hooks, revealPos, setFocusWord } from "./editor/menuHooks";
import { groupAction, mergeSelection } from "./editor/groups";
import { applyChoice, removeLock, type Choice } from "./editor/picks";

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
  // I simboli personali già importati (M8c-3): si riusano per altre parole e si cercano per etichetta.
  let customList: CustomSymbol[] = [];
  const loadCustom = (): void => {
    client.listCustom().then(
      (list) => {
        customList = list;
      },
      () => {
        customList = [];
      },
    );
  };
  loadCustom();
  // La scelta di un pittogramma; per un simbolo personale porta anche il suo identificativo stabile (per il documento).
  const pictoChoice = (id: number): Choice => ({ kind: "picto", id, uuid: customList.find((c) => c.id === id)?.uuid });
  const asCandidate = (c: CustomSymbol): CandidateDto => ({ picto: c.id, keyword: c.label || "personale", reason: "simbolo personale", image: true });
  // Il ritardo della ricerca è unico: passando a un'altra parola quello vecchio si annulla.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  // La casella «usa per tutto il testo» resta come l'ha messa il docente anche quando la barra si ridisegna.
  let lockAll = true;

  const signature = (t: TokenAt): string => `${t.token.picto}|${t.token.display}|${t.pick}|${t.token.why}|${t.token.lemma}|${t.lock?.picto ?? ""}`;

  // La memoria del docente («ricorda per sempre»): vale in tutti i documenti; si cambia e si dimentica da qui.
  const memory = client.memory;
  const remember = async (t: TokenAt, picto: number): Promise<void> => {
    if (!memory) return;
    const hasLemma = t.token.lemma !== "" && t.token.cat !== "";
    const entry: MemoryEntry = hasLemma
      ? { lemma: t.token.lemma, cat: t.token.cat, form: "", picto }
      : { lemma: "", cat: "", form: t.para.text.slice(t.token.s, t.token.e), picto };
    try {
      await memory.add(entry);
      // Il motore ora decide in un altro modo: i paragrafi si rifanno.
      setEngine(view, client);
    } catch (e) {
      hooks.notice?.(`Non sono riuscito a ricordare la scelta: ${String(e)}`, "errore");
    }
  };
  const memoryLabel = (m: MemoryEntry): string => (m.lemma !== "" ? m.lemma : m.form);
  const fillMemory = (box: HTMLElement, mine: number): void => {
    if (!memory) return;
    memory.list().then(
      (list) => {
        if (generation !== mine || list.length === 0) return;
        const wrap = el("div", "side-memory");
        wrap.append(el("h3", "", "Cosa ricordo"));
        const ul = el("ul", "side-memory-list");
        for (const m of list) {
          const li = el("li");
          const img = el("img");
          img.src = client.url(m.picto);
          img.alt = "";
          const forget = conIcona(el("button", "", "Dimentica"), "dimentica");
          forget.type = "button";
          forget.setAttribute("aria-label", `Dimentica ${memoryLabel(m)}`);
          forget.addEventListener("click", () => {
            memory.forget(m).then(() => {
              setEngine(view, client);
              showEmpty();
            }, (e: unknown) => hooks.notice?.(`Non sono riuscito a dimenticare: ${String(e)}`, "errore"));
          });
          li.append(img, el("span", "", memoryLabel(m)), forget);
          ul.append(li);
        }
        const clear = conIcona(el("button", "", "Dimentica tutto"), "elimina");
        clear.type = "button";
        clear.addEventListener("click", async () => {
          const ok = await conferma({
            domanda: "Dimenticare tutte le scelte «per sempre»?",
            spiegazione: "Le parole torneranno ai simboli proposti dal programma. Non si può annullare.",
            azione: "Dimentica tutto",
            pericolo: true,
          });
          if (!ok) return;
          memory.clear().then(() => {
            setEngine(view, client);
            showEmpty();
          }, (e: unknown) => hooks.notice?.(`Non sono riuscito a dimenticare: ${String(e)}`, "errore"));
        });
        wrap.append(ul, clear);
        box.append(wrap);
      },
      () => undefined,
    );
  };

  function showEmpty(): void {
    const mine = ++generation;
    target = null;
    sig = "";
    root.replaceChildren();
    const box = el("div", "side-empty");
    box.append(el("h2", "", "Simboli"));
    for (const line of EMPTY_HINT) box.append(el("p", "", line));
    root.append(box);
    fillMemory(box, mine);
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
    // Per un gruppo di parole ("scuola media") il titolo è tutta la frase.
    const inGroup = t.token.gkind === "multiword" && t.groupSpan !== null;
    const title = inGroup && t.groupSpan ? t.para.text.slice(t.groupSpan[0], t.groupSpan[1]) : shownWord;
    titles.append(el("strong", "", title), el("span", "pm-why", t.token.why));
    head.append(now, titles);

    const grid = el("div", "pm-grid");
    const status = el("div", "pm-status", "Carico le alternative…");

    const all = el("input");
    all.type = "checkbox";
    all.checked = lockAll;
    all.addEventListener("change", () => {
      lockAll = all.checked;
    });
    // Un gruppo di parole ("far colazione") non ha un lemma solo: la scelta vale per quel punto del testo.
    const canLock = t.token.lemma !== "" && t.token.cat !== "" && !inGroup;
    all.disabled = !canLock;
    const allLabel = el("label", "pm-all");
    allLabel.append(all, " usa per tutto il testo");
    allLabel.title = canLock ? "Tutte le parole uguali del testo prendono questo simbolo" : "Parola non riconosciuta: vale solo qui";

    const always = el("input");
    always.type = "checkbox";
    always.checked = false;
    always.disabled = !memory || inGroup;
    const alwaysLabel = el("label", "pm-always");
    alwaysLabel.append(always, " ricorda per sempre");
    alwaysLabel.title = inGroup ? "Per un gruppo di parole vale solo qui" : "Da ora, in tutti i documenti, questa parola prende questo simbolo";

    const choose = (choice: Choice): void => {
      // La posizione della parola si legge adesso: il testo può essere cambiato da quando la barra l'ha mostrata.
      const w = target ?? t;
      applyChoice(view, { paraPos: w.paraPos, s: w.token.s, e: w.token.e, lemma: w.token.lemma, cat: w.token.cat }, choice, all.checked && canLock);
      if (always.checked && choice.kind === "picto") void remember(w, choice.id);
      // Registro anonimo delle correzioni (solo forma, una parola di contesto per lato, pittogramma): serve a
      // migliorare il lessico per tutti; si può spegnere e si invia solo a mano.
      if (client.corrections && (choice.kind === "picto" || choice.kind === "none")) {
        const picto = choice.kind === "picto" ? choice.id : 0;
        if (picto !== (w.token.picto ?? 0)) {
          client.corrections
            .log({ text: w.para.text, s: w.token.s, e: w.token.e, lemma: w.token.lemma, cat: w.token.cat, picto, auto: w.token.picto ?? 0 })
            .catch(() => undefined);
        }
      }
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
        b.addEventListener("click", () => choose(pictoChoice(c.picto)));
        grid.append(b);
      });
    };

    const fixed = el("div", "pm-fixed");
    const button = (label: string, title: string, fn: () => void, ico?: NomeIcona): void => {
      const b = el("button", "pm-btn", label);
      b.type = "button";
      if (ico) conIcona(b, ico);
      b.title = title;
      b.addEventListener("click", fn);
      fixed.append(b);
    };
    button("Nessun simbolo", "Lascia lo spazio del simbolo vuoto", () => choose({ kind: "none" }), "nessuno");
    button("Solo testo", "Parola senza spazio per il simbolo", () => choose({ kind: "text" }), "soloTesto");
    if (t.pick !== null) button("Automatico", "Torna alla scelta del motore", () => choose({ kind: "auto" }), "automatico");
    // Simbolo personale: si sceglie un'immagine, si ritaglia e diventa il simbolo della parola.
    const picker = el("input");
    picker.type = "file";
    picker.accept = "image/png,image/jpeg";
    picker.hidden = true;
    picker.setAttribute("aria-label", "Immagine per il simbolo personale");
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (!file) return;
      const label = shownWord.toLowerCase();
      void cropImage(file, shownWord, !!client.shared).then(async (cropped) => {
        if (!cropped) return;
        try {
          const symbol = await client.importCustom(cropped.blob, label);
          customList = [...customList, symbol];
          choose({ kind: "picto", id: symbol.id, uuid: symbol.uuid });
          if (cropped.share && client.shared) {
            // Il simbolo si usa comunque: se il Drive non risponde, si può condividere più tardi.
            client.shared.share(symbol.uuid).then(
              () => hooks.notice?.("Simbolo condiviso con la scuola.", "ok"),
              (e: unknown) => hooks.notice?.(`Simbolo salvato per te, ma non condiviso: ${String(e)}`, "avviso"),
            );
          }
        } catch (e) {
          hooks.notice?.(`Non sono riuscito a salvare il simbolo: ${String(e)}`, "errore");
        }
      });
    });
    button("Simbolo personale…", "Importa un'immagine (PNG o JPG) come simbolo di questa parola", () => picker.click(), "immagine");
    if (t.lock) {
      button("Togli il blocco", `Le parole «${t.token.lemma}» tornano al simbolo automatico`, () => {
        removeLock(view, t.token.lemma, t.token.cat);
        view.focus();
      });
    }
    const act = groupAction(view, t);
    if (act) {
      button(act.label, act.label === "Dividi" ? "Una parola, un simbolo (Ctrl+Maiusc+D)" : "Torna a un simbolo solo (Ctrl+Maiusc+D)", () => {
        act.run(view);
        view.focus();
      });
    }

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
          // I simboli personali con quell'etichetta vengono per primi.
          const own = customList.filter((c) => c.label !== "" && c.label.includes(q.toLowerCase())).map(asCandidate);
          results = [...own, ...r];
          resultsQuery = q;
          status.textContent = results.length ? "" : "Nessun simbolo trovato";
          render(results, false);
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
        choose(pictoChoice(results[0].picto));
      }
    });

    const keys = el("p", "pm-keys", "1–8 sceglie · Esc torna al testo · F8 prossima parola da controllare");
    // I miei simboli: le immagini già importate si riusano con un clic (le ultime per prime).
    const saved = el("div", "pm-custom");
    if (customList.length > 0) {
      saved.append(el("span", "pm-custom-title", "I miei simboli"));
      for (const c of [...customList].reverse().slice(0, 12)) {
        const b = el("button", "pm-mini");
        b.type = "button";
        b.title = c.label || "simbolo personale";
        const img = el("img");
        img.src = client.url(c.id);
        img.alt = c.label;
        b.append(img);
        b.addEventListener("click", () => choose({ kind: "picto", id: c.id, uuid: c.uuid }));
        const cell = el("span", "pm-mini-cell");
        cell.append(b);
        const del = client.deleteCustom;
        if (del) {
          const x = el("button", "pm-mini-x", "×");
          x.type = "button";
          x.title = "Elimina questo simbolo dal computer (i documenti che lo usano lo tengono)";
          x.setAttribute("aria-label", `Elimina il simbolo ${c.label || "personale"}`);
          x.addEventListener("click", async () => {
            const ok = await conferma({
              domanda: `Eliminare il simbolo «${c.label || "personale"}» da questo computer?`,
              spiegazione: "I documenti che lo usano lo conservano. Non si può annullare.",
              azione: "Elimina",
              pericolo: true,
            });
            if (!ok) return;
            del(c.uuid).then(
              () => {
                customList = customList.filter((o) => o.uuid !== c.uuid);
                // Le scelte «per sempre» che lo usavano sono state tolte: i paragrafi si rifanno.
                setEngine(view, client);
                show(target ?? t, false);
              },
              (e: unknown) => hooks.notice?.(`Non sono riuscito a eliminarlo: ${String(e)}`, "errore"),
            );
          });
          cell.append(x);
        }
        saved.append(cell);
      }
    }
    // I simboli della scuola: si aprono a richiesta (leggono il Drive).
    const school = client.shared;
    if (school) {
      const box = el("div", "pm-school");
      const open = conIcona(el("button", "pm-btn", "Simboli della scuola…"), "scuola");
      open.type = "button";
      open.addEventListener("click", () => {
        open.disabled = true;
        box.replaceChildren(open, el("span", "pm-school-msg", "Carico…"));
        school.list().then(
          (list) => {
            open.disabled = false;
            const msg = !list.configured ? "La biblioteca non è collegata." : !list.reachable ? "Drive non raggiungibile." : list.symbols.length === 0 ? "Nessun simbolo condiviso." : "";
            box.replaceChildren(open);
            if (msg) box.append(el("span", "pm-school-msg", msg));
            for (const s of list.symbols) {
              const cell = el("span", "pm-mini-cell");
              const b = el("button", "pm-mini");
              b.type = "button";
              b.title = `${s.label || "simbolo"} — ${s.author}`;
              b.textContent = s.label || "simbolo";
              b.addEventListener("click", () => {
                school.take(s.uuid).then(
                  (sym) => {
                    customList = customList.some((o) => o.uuid === sym.uuid) ? customList : [...customList, sym];
                    choose({ kind: "picto", id: sym.id, uuid: sym.uuid });
                  },
                  (e: unknown) => hooks.notice?.(`Non riesco a prendere il simbolo: ${String(e)}`, "errore"),
                );
              });
              cell.append(b);
              if (s.can_retire) {
                const x = el("button", "pm-mini-x", "×");
                x.type = "button";
                x.title = "Ritira dalla scuola (va in archivio, non si cancella)";
                x.setAttribute("aria-label", `Ritira dalla scuola il simbolo ${s.label || "simbolo"}`);
                x.addEventListener("click", async () => {
                  const ok = await conferma({
                    domanda: `Ritirare «${s.label || "simbolo"}» dalla scuola?`,
                    spiegazione: "Lo vedranno sparire tutti i docenti. Va in archivio: non si cancella.",
                    azione: "Ritira",
                    pericolo: true,
                  });
                  if (!ok) return;
                  school.retire(s.uuid).then(
                    () => open.click(),
                    (e: unknown) => hooks.notice?.(`Non sono riuscito a ritirarlo: ${String(e)}`, "errore"),
                  );
                });
                cell.append(x);
              }
              box.append(cell);
            }
          },
          (e: unknown) => {
            open.disabled = false;
            box.replaceChildren(open, el("span", "pm-school-msg", `Non riesco a leggere i simboli della scuola: ${String(e)}`));
          },
        );
      });
      box.append(open);
      saved.append(box);
    }
    root.replaceChildren(search, head, status, grid, saved, fixed, picker, allLabel, alwaysLabel, keys);
    if (focusSide) root.focus();

    client.alternatives(t.para, t.policy, t.locks, t.token.s, t.token.e).then(
      (list) => {
        if (generation !== mine) return;
        // Un simbolo personale importato per questa parola (o per il suo lemma) viene per primo.
        const w = shownWord.toLowerCase();
        const lemma = t.token.lemma.toLowerCase();
        const own = customList
          .filter((c) => c.label !== "" && (c.label === w || c.label === lemma) && c.id !== t.token.picto)
          .map(asCandidate);
        candidates = [...own, ...list]; // si tengono anche se si sta cercando: servono quando si svuota la ricerca
        if (searching) return;
        status.textContent = candidates.length ? "" : "Nessuna altra alternativa: puoi cercare un simbolo";
        render(candidates, true);
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
      hooks.lasciaBarra?.();
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

  hooks.merge = () => {
    const message = mergeSelection(view);
    if (message) hooks.notice?.(message);
    return true;
  };
  hooks.split = () => {
    const t = tokenAt(view, view.state.selection.head);
    const act = t ? groupAction(view, t) : null;
    if (!act) {
      hooks.notice?.("Metti il cursore su una parola di un gruppo (o di una divisione) per dividerla o riunirla.");
      return true;
    }
    act.run(view);
    return true;
  };

  const activate = (t: TokenAt, focusSide: boolean): void => {
    // Se il pannello è chiuso si apre (M11-4).
    hooks.apriBarra?.();
    // Cambiando l'evidenziazione l'editor si aggiorna e chiama `refresh`: con la parola vecchia ancora
    // "in mostra" lo scambierebbe per una parola cambiata e svuoterebbe la barra.
    target = null;
    // Di un gruppo di parole si evidenzia tutta la frase.
    const range: [number, number] = t.groupSpan ? [t.paraPos + 1 + t.groupSpan[0], t.paraPos + 1 + t.groupSpan[1]] : [t.from, t.to];
    setFocusWord(view, range);
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
