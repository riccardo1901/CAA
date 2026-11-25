// Barra degli strumenti (politica delle parole funzionali, dimensione dei simboli) e barra di stato
// (parole da controllare, numero di parole, stato del motore).
import { redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import type { EditorView } from "prosemirror-view";
import type { EngineInfo, Policy, PolicyTable, Rule } from "./engine/client";
import { COMPLETE_TABLE, type DocPrefs, type Preset } from "./docs/prefs";
import { engineStats, setPolicy, tokenAt } from "./editor/engineSymbols";
import { canMerge, groupAction } from "./editor/groups";
import { hooks } from "./editor/menuHooks";
import { DEFAULT_PRINT, type PrintPrefs } from "./docs/prefs";
import { applyPrintPrefs, printNow } from "./print/print";
import { openPrintDialog } from "./print/dialog";
import { openAbout } from "./about";

const SIZES: Array<[string, number]> = [
  ["Piccolo", 45],
  ["Medio", 68],
  ["Grande", 94],
  ["Molto grande", 151],
];

const POLICIES: Array<[Policy, string]> = [
  ["complete", "Completo"],
  ["essential", "Essenziale"],
  ["custom", "Personalizzato"],
];

const RULE_LABEL: Record<Rule, string> = { full: "Simbolo", reduced: "Simbolo ridotto", text: "Solo testo", hidden: "Nascosto" };

/** Le righe della tabella «Personalizzato» e le opzioni sensate per ciascuna (SPEC.md, fase 10). */
const TABLE_ROWS: Array<{ key: keyof PolicyTable; label: string; options: Rule[]; labels?: Partial<Record<Rule, string>> }> = [
  { key: "articles", label: "Articoli", options: ["reduced", "full", "text", "hidden"], labels: { full: "Simbolo pieno" } },
  { key: "clitics", label: "Pronomi clitici (non riflessivi)", options: ["full", "text", "hidden"] },
  { key: "che", label: "«che»", options: ["full", "text", "hidden"] },
  { key: "preps", label: "Preposizioni", options: ["full", "text"] },
  { key: "conj", label: "Congiunzioni", options: ["full", "text"] },
];


/** Il valore da mandare al motore per una tabella. */
export function tablePolicy(t: PolicyTable): Policy {
  return `custom:articles=${t.articles};clitics=${t.clitics};che=${t.che};preps=${t.preps};conj=${t.conj}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

interface PolicyDialog {
  root: HTMLElement;
  show(): void;
  hide(): void;
  /** Riporta i menu ai valori della tabella (dopo aver aperto un documento). */
  sync(): void;
}

/** La tabella del preset «Personalizzato»: una riga per categoria, le modifiche valgono subito. */
function createPolicyDialog(table: PolicyTable, changed: () => void, closed: () => void): PolicyDialog {
  const root = el("div", "policy-dialog");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Parole funzionali personalizzate");
  root.append(el("h2", "", "Parole funzionali"));
  const grid = el("table");
  const selects: Array<[keyof PolicyTable, HTMLSelectElement]> = [];
  for (const row of TABLE_ROWS) {
    const tr = el("tr");
    const select = el("select");
    select.setAttribute("aria-label", row.label);
    for (const rule of row.options) {
      const o = el("option", "", row.labels?.[rule] ?? RULE_LABEL[rule]);
      o.value = rule;
      select.append(o);
    }
    select.value = table[row.key];
    selects.push([row.key, select]);
    select.addEventListener("change", () => {
      table[row.key] = select.value as Rule;
      changed();
    });
    const th = el("th", "", row.label);
    const td = el("td");
    td.append(select);
    tr.append(th, td);
    grid.append(tr);
  }
  const note = el("p", "note", "Ausiliari dei tempi composti: sempre nascosti (il tempo è nel segno). Punteggiatura: sempre testo.");
  const close = el("button", "", "Chiudi");
  close.type = "button";
  const hide = (): void => {
    root.hidden = true;
  };
  close.addEventListener("click", () => {
    hide();
    closed();
  });
  root.append(grid, note, close);
  const sync = (): void => {
    for (const [key, select] of selects) select.value = table[key];
  };
  return { root, show: () => (root.hidden = false), hide, sync };
}

export interface Bars {
  /** La riga dei documenti: «Documenti», il titolo, lo stato del salvataggio. */
  docbar: HTMLElement;
  docsButton: HTMLButtonElement;
  titleInput: HTMLInputElement;
  saveStatus: HTMLElement;
  /** Lo stato della biblioteca nel Drive condiviso (nascosto finché non c'è). */
  libStatus: HTMLButtonElement;
  /** «È disponibile la versione X»: nascosto finché il Drive non annuncia una versione più recente. */
  updateNote: HTMLElement;
  toolbar: HTMLElement;
  statusbar: HTMLElement;
  banner: HTMLElement;
  refresh(): void;
  /** Le preferenze del documento (politica, tabella, dimensione, contorno). */
  getPrefs(): DocPrefs;
  /** Le imposta (all'apertura di un documento): non conta come una modifica. */
  setPrefs(p: Partial<DocPrefs>): void;
  /** Chiamata quando il docente cambia una preferenza. */
  onPrefsChange(cb: () => void): void;
  /** Il nome di chi scrive, per il piè di pagina facoltativo. */
  setAuthor(name: string): void;
}

export function createBars(
  view: EditorView,
  info: EngineInfo | null,
  setSize: (px: number) => void,
  getSize: () => number,
  newDocument: () => void,
  sampleDocument: () => void,
): Bars {
  const toolbar = el("div", "toolbar");
  toolbar.setAttribute("role", "toolbar");
  const statusbar = el("div", "statusbar");
  const banner = el("div", "banner");
  banner.hidden = !!info?.ok;
  if (info && !info.ok) banner.textContent = `Il motore non è attivo: ${info.error ?? "errore sconosciuto"}`;

  const doc = el("div");
  const newBtn = el("button", "", "Nuovo");
  newBtn.type = "button";
  newBtn.addEventListener("click", newDocument);
  const sampleBtn = el("button", "", "Testo di esempio");
  sampleBtn.type = "button";
  sampleBtn.addEventListener("click", sampleDocument);
  // Annulla e Ripeti anche con il mouse (Ctrl+Z, Ctrl+Y o Ctrl+Maiusc+Z da tastiera).
  const undoBtn = el("button", "", "Annulla");
  undoBtn.type = "button";
  undoBtn.title = "Ctrl+Z";
  undoBtn.addEventListener("click", () => {
    undo(view.state, view.dispatch);
    view.focus();
  });
  const redoBtn = el("button", "", "Ripeti");
  redoBtn.type = "button";
  redoBtn.title = "Ctrl+Y o Ctrl+Maiusc+Z";
  redoBtn.addEventListener("click", () => {
    redo(view.state, view.dispatch);
    view.focus();
  });
  // Unisci e dividi parole (M8c-2).
  const mergeBtn = el("button", "", "Unisci");
  mergeBtn.type = "button";
  mergeBtn.title = "Unisce le parole selezionate in un simbolo solo (Ctrl+Maiusc+U)";
  mergeBtn.addEventListener("click", () => {
    hooks.merge?.();
    view.focus();
  });
  const splitBtn = el("button", "", "Dividi");
  splitBtn.type = "button";
  splitBtn.title = "Divide il gruppo della parola al cursore (Ctrl+Maiusc+D)";
  splitBtn.addEventListener("click", () => {
    hooks.split?.();
    view.focus();
  });
  doc.append(newBtn, " ", sampleBtn, " ", undoBtn, " ", redoBtn, " ", mergeBtn, " ", splitBtn);

  const policyLabel = el("label", "", "Parole funzionali: ");
  const select = el("select");
  select.setAttribute("aria-label", "Politica delle parole funzionali");
  for (const [value, label] of POLICIES) {
    const o = el("option", "", label);
    o.value = value;
    select.appendChild(o);
  }
  // La tabella di «Personalizzato» sta nel documento aperto (con M9 si salverà nel file).
  const table: PolicyTable = { ...COMPLETE_TABLE };
  const editBtn = el("button", "", "Modifica…");
  editBtn.type = "button";
  editBtn.hidden = true;
  const prefsListeners: Array<() => void> = [];
  const notifyPrefs = (): void => prefsListeners.forEach((cb) => cb());
  const dialog = createPolicyDialog(table, () => {
    setPolicy(view, tablePolicy(table));
    refresh();
    notifyPrefs();
  }, () => view.focus());
  const applyPolicy = (): void => {
    const custom = select.value === "custom";
    editBtn.hidden = !custom;
    if (!custom) dialog.hide();
    setPolicy(view, custom ? tablePolicy(table) : (select.value as Policy));
    refresh();
  };
  // La tabella si apre da sola la prima volta che si sceglie «Personalizzato»; poi c'è «Modifica…».
  let tableShown = false;
  select.addEventListener("change", () => {
    applyPolicy();
    notifyPrefs();
    if (select.value === "custom" && !tableShown) {
      tableShown = true;
      dialog.show();
    }
  });
  editBtn.addEventListener("click", () => dialog.show());
  policyLabel.append(select, " ", editBtn);

  // Contorno: ogni coppia simbolo-parola in una "card" (impostazione dell'editor, ricordata sul computer).
  const cardsLabel = el("label", "", " ");
  const cards = el("input");
  cards.type = "checkbox";
  cards.setAttribute("aria-label", "Contorna simbolo e parola");
  let saved = false;
  try {
    saved = localStorage.getItem("caa.cards") === "1";
  } catch {
    /* senza memoria del browser si parte senza contorno */
  }
  const applyCards = (on: boolean): void => {
    document.querySelector(".sheet")?.classList.toggle("cards", on);
  };
  cards.checked = saved;
  applyCards(saved);
  cards.addEventListener("change", () => {
    applyCards(cards.checked);
    notifyPrefs();
    try {
      localStorage.setItem("caa.cards", cards.checked ? "1" : "0");
    } catch {
      /* non è grave: la scelta vale finché l'app è aperta */
    }
    view.focus();
  });
  cardsLabel.append(cards, " Contorna simbolo e parola");

  const sizes = el("div");
  sizes.append("Simboli: ");
  const sizeButtons: HTMLButtonElement[] = SIZES.map(([label, px], i) => {
    const b = el("button", "", label);
    b.type = "button";
    b.title = `Ctrl+${i + 1}`;
    b.addEventListener("click", () => {
      setSize(px);
      refresh();
      notifyPrefs();
      view.focus();
    });
    sizes.append(b, " ");
    return b;
  });

  // Stampa (M10): le impostazioni della pagina stanno nel documento; Ctrl+P apre la finestra.
  let printPrefs: PrintPrefs = { ...DEFAULT_PRINT };
  let author = "";
  const printMeta = () => ({ title: titleInputRef?.value ?? "", author });
  let titleInputRef: HTMLInputElement | null = null;
  const printBtn = el("button", "", "Stampa…");
  printBtn.type = "button";
  printBtn.title = "Ctrl+P";
  const openPrint = (): void => {
    applyPrintPrefs(printPrefs, printMeta());
    openPrintDialog({
      get: () => printPrefs,
      set: (p) => {
        printPrefs = p;
        applyPrintPrefs(printPrefs, printMeta());
        notifyPrefs();
      },
      print: () => {
        applyPrintPrefs(printPrefs, printMeta());
        void printNow(view, printPrefs);
      },
    });
  };
  printBtn.addEventListener("click", openPrint);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      openPrint();
    }
  });
  applyPrintPrefs(printPrefs, printMeta());

  const aboutBtn = el("button", "", "Informazioni");
  aboutBtn.type = "button";
  aboutBtn.title = "Crediti e licenze";
  aboutBtn.addEventListener("click", () => openAbout());
  toolbar.append(doc, el("span", "grow"), cardsLabel, policyLabel, sizes, printBtn, aboutBtn, dialog.root);

  const wordsInfo = el("span");
  const doubtInfo = el("span", "link");
  doubtInfo.title = "Vai alla prossima parola da controllare (F8)";
  doubtInfo.setAttribute("role", "button");
  doubtInfo.addEventListener("click", () => hooks.next?.());
  const policyInfo = el("span");
  const engineInfoEl = el("span");
  const errorInfo = el("span");
  const noticeInfo = el("span", "warn");
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  hooks.notice = (message) => {
    noticeInfo.textContent = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeInfo.textContent = "";
    }, 6000);
  };
  statusbar.append(doubtInfo, wordsInfo, errorInfo, noticeInfo, el("span", "grow"), policyInfo, engineInfoEl);

  function refresh(): void {
    undoBtn.disabled = undoDepth(view.state) === 0;
    redoBtn.disabled = redoDepth(view.state) === 0;
    mergeBtn.disabled = !canMerge(view);
    const here = tokenAt(view, view.state.selection.head);
    const act = here ? groupAction(view, here) : null;
    splitBtn.textContent = act?.label ?? "Dividi";
    splitBtn.disabled = !act;
    const s = engineStats(view);
    sizeButtons.forEach((b, i) => b.classList.toggle("on", SIZES[i][1] === getSize()));
    wordsInfo.textContent = `${s.words} parole`;
    doubtInfo.textContent = s.doubtful === 1 ? "1 parola da controllare" : `${s.doubtful} parole da controllare`;
    doubtInfo.classList.toggle("warn", s.doubtful > 0);
    // Il motore ha dato errore e sta riprovando: lo si dice, altrimenti i simboli mancano senza spiegazione.
    errorInfo.textContent = s.error ? "Il motore non risponde: riprovo…" : s.pending > 0 ? "Analisi in corso…" : "";
    errorInfo.classList.toggle("warn", !!s.error);
    policyInfo.textContent = `Parole funzionali: ${select.selectedOptions[0]?.textContent ?? ""}`;
    engineInfoEl.textContent = info?.ok
      ? `Motore attivo${info.tagger ? "" : " (senza tagger)"}${info.expressions ? "" : " (senza espressioni)"}`
      : "Motore non attivo";
  }

  // Ctrl+1–4: dimensione dei simboli.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    setSize(SIZES[i][1]);
    refresh();
    notifyPrefs();
  });

  refresh();
  // La riga dei documenti (M9a): la riempie la sessione del documento.
  const docbar = el("div", "docbar");
  const docsButton = el("button", "", "Documenti");
  docsButton.type = "button";
  docsButton.title = "I miei documenti";
  const titleInput = el("input", "doc-title");
  titleInput.type = "text";
  titleInput.placeholder = "Senza titolo";
  titleInput.maxLength = 120;
  titleInput.setAttribute("aria-label", "Titolo del documento");
  titleInputRef = titleInput;
  // Il titolo scritto aggiorna il piè di pagina facoltativo.
  titleInput.addEventListener("input", () => applyPrintPrefs(printPrefs, printMeta()));
  const saveStatus = el("span", "save-status");
  const libStatus = el("button", "lib-status");
  libStatus.type = "button";
  libStatus.hidden = true;
  const updateNote = el("span", "update-note");
  updateNote.hidden = true;
  docbar.append(docsButton, titleInput, el("span", "grow"), updateNote, libStatus, saveStatus);

  const getPrefs = (): DocPrefs => ({ preset: select.value as Preset, table: { ...table }, size: getSize(), cards: cards.checked, print: { ...printPrefs } });
  const setPrefs = (p: Partial<DocPrefs>): void => {
    if (p.table) {
      Object.assign(table, p.table);
      dialog.sync();
    }
    if (p.preset) select.value = p.preset;
    if (p.preset || p.table) applyPolicy();
    if (p.size !== undefined) setSize(p.size);
    if (p.cards !== undefined) {
      cards.checked = p.cards;
      applyCards(p.cards);
    }
    if (p.print) {
      printPrefs = { ...p.print };
      applyPrintPrefs(printPrefs, printMeta());
    }
    refresh();
  };

  return { docbar, docsButton, titleInput, saveStatus, libStatus, updateNote, toolbar, statusbar, banner, refresh, getPrefs, setPrefs, onPrefsChange: (cb) => prefsListeners.push(cb),
    setAuthor: (name) => {
      author = name;
      applyPrintPrefs(printPrefs, printMeta());
    },
  };
}
