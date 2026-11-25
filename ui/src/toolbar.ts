// Le barre attorno al foglio (M11-4, PIANO-M11.md 3.1): intestazione (nome, Documenti, Nuovo, titolo, salvataggio,
// biblioteca, Stampa, menu «Altro»), barra degli strumenti su una riga sola (quello che non ci sta passa in «Altro»),
// fascia gialla del documento con la × e barra di stato (parole da controllare, numero di parole).
import { redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import type { EditorView } from "prosemirror-view";
import type { EngineInfo, Policy, PolicyTable, Rule } from "./engine/client";
import { COMPLETE_TABLE, type DocPrefs, type Preset } from "./docs/prefs";
import { engineStats, setPolicy, tokenAt } from "./editor/engineSymbols";
import { canMerge, groupAction } from "./editor/groups";
import { hooks } from "./editor/menuHooks";
import { DEFAULT_PRINT, type PrintPrefs } from "./docs/prefs";
import { applyPrintPrefs as applyPrintStyle, printNow } from "./print/print";
import { setOneLine } from "./editor/printLines";
import { openPrintDialog } from "./print/dialog";
import { openAbout } from "./about";
import { conIcona, etichetta, soloIcona } from "./ui/icons";
import { suggerimento } from "./ui/tooltip";
import { notifica } from "./ui/toast";
import { creaMenuAltro, type MenuAltro } from "./ui/menu";
import { icona } from "./ui/icons";

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

/** La tabella del preset «Personalizzato»: una riga per categoria, le modifiche valgono subito. È un riquadro a
 *  comparsa (M11-4, K10): il fuoco entra, Esc o un clic fuori lo chiudono. */
function createPolicyDialog(table: PolicyTable, changed: () => void, closed: () => void, anchors: () => HTMLElement[]): PolicyDialog {
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
  const fuori = (e: Event): void => {
    const t = e.target as Node;
    if (root.contains(t) || anchors().some((a) => a.contains(t))) return;
    hide();
  };
  function hide(): void {
    if (root.hidden) return;
    root.hidden = true;
    document.removeEventListener("pointerdown", fuori, true);
  }
  const show = (): void => {
    root.hidden = false;
    document.addEventListener("pointerdown", fuori, true);
    selects[0]?.[1].focus();
  };
  close.addEventListener("click", () => {
    hide();
    closed();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hide();
      closed();
    }
  });
  root.append(grid, note, close);
  const sync = (): void => {
    for (const [key, select] of selects) select.value = table[key];
  };
  return { root, show, hide, sync };
}

export interface Bars {
  /** L'intestazione: nome del programma, Documenti, Nuovo, titolo, salvataggio, biblioteca, Stampa, Altro. */
  header: HTMLElement;
  /** Mostra o nasconde le parti dei documenti (ci sono solo con l'archivio, cioè nell'app). */
  mostraDocumenti(si: boolean): void;
  docsButton: HTMLButtonElement;
  titleInput: HTMLInputElement;
  saveStatus: HTMLElement;
  /** Lo stato della biblioteca nel Drive condiviso (nascosto finché non c'è). */
  libStatus: HTMLButtonElement;
  /** «È disponibile la versione X»: una voce del menu «Altro» (e un pallino sul pulsante). */
  mostraVersione(testo: string | null, note: string): void;
  /** Il menu «Altro» (il suo riquadro va messo nel documento). */
  menu: MenuAltro;
  toolbar: HTMLElement;
  statusbar: HTMLElement;
  /** La fascia gialla del documento (salvato come copia, sola lettura, motore non attivo): si chiude con la ×. */
  banner: HTMLElement;
  /** Il testo della fascia gialla (null la nasconde). */
  setBanner(testo: string | null): void;
  /** Quando si chiude la fascia con la ×. */
  onBannerClose(cb: () => void): void;
  refresh(): void;
  /** Rimette nella barra i gruppi che ci stanno (dopo un cambio di dimensione o di contenuto). */
  adatta(): void;
  /** Le preferenze del documento (politica, tabella, dimensione, contorno). */
  getPrefs(): DocPrefs;
  /** Le imposta (all'apertura di un documento): non conta come una modifica. */
  setPrefs(p: Partial<DocPrefs>): void;
  /** Chiamata quando il docente cambia una preferenza. */
  onPrefsChange(cb: () => void): void;
  /** Il nome di chi scrive, per il piè di pagina facoltativo. */
  setAuthor(name: string): void;
}

/** Il segno del programma: un quadratino (il simbolo) sopra una riga (la parola). */
function segno(): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.classList.add("brand-mark");
  s.innerHTML = '<rect x="7" y="3" width="10" height="10" rx="2.5" fill="currentColor"/><rect x="4" y="17" width="16" height="3" rx="1.5" fill="currentColor"/>';
  return s;
}

/** Il fuoco è in un campo dove si scrive (lì Ctrl+Z e Ctrl+Y sono del campo). */
function inUnCampo(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable;
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
  toolbar.setAttribute("aria-label", "Strumenti");
  const statusbar = el("footer", "statusbar");
  const menu = creaMenuAltro();

  // ---- Fascia gialla del documento, con la × (K9) ----
  const banner = el("div", "banner");
  banner.setAttribute("role", "status");
  const bannerText = el("span", "banner-text");
  const bannerClose = el("button", "banner-close icon-only");
  bannerClose.type = "button";
  bannerClose.setAttribute("aria-label", "Chiudi l'avviso");
  bannerClose.append(icona("chiudi"));
  banner.append(icona("avviso"), bannerText, bannerClose);
  const bannerListeners: Array<() => void> = [];
  const setBanner = (testo: string | null): void => {
    banner.hidden = testo === null || testo === "";
    bannerText.textContent = testo ?? "";
  };
  bannerClose.addEventListener("click", () => {
    setBanner(null);
    bannerListeners.forEach((cb) => cb());
  });
  setBanner(info && !info.ok ? `Il motore non è attivo: ${info.error ?? "errore sconosciuto"}` : null);

  // ---- Intestazione ----
  const newBtn = el("button", "", "Nuovo");
  newBtn.type = "button";
  newBtn.addEventListener("click", newDocument);
  conIcona(newBtn, "nuovo");
  suggerimento(newBtn, "Un documento nuovo, vuoto");
  // «Testo di esempio» e «Informazioni» si usano di rado: stanno nel menu «Altro».
  menu.voce("Testo di esempio", sampleDocument, "esempio");
  menu.voce("Informazioni", () => openAbout(), "info");
  const updateNote = menu.voce("", () => openAbout(), "avviso");
  updateNote.classList.add("update-note");
  updateNote.hidden = true;
  const mostraVersione = (testo: string | null, note: string): void => {
    updateNote.hidden = !testo;
    menu.pallino(!!testo);
    if (testo) {
      etichetta(updateNote, testo);
      updateNote.title = note;
    }
  };

  // Annulla e Ripeti anche con il mouse (Ctrl+Z, Ctrl+Y o Ctrl+Maiusc+Z da tastiera).
  const undoBtn = el("button", "", "Annulla");
  undoBtn.type = "button";
  soloIcona(undoBtn, "annulla", "Annulla");
  suggerimento(undoBtn, "Annulla", { tasti: "Ctrl+Z", spento: "Annulla · niente da annullare" });
  undoBtn.addEventListener("click", () => {
    undo(view.state, view.dispatch);
    view.focus();
  });
  const redoBtn = el("button", "", "Ripeti");
  redoBtn.type = "button";
  soloIcona(redoBtn, "ripeti", "Ripeti");
  suggerimento(redoBtn, "Ripeti", { tasti: "Ctrl+Y o Ctrl+Maiusc+Z", spento: "Ripeti · niente da ripetere" });
  redoBtn.addEventListener("click", () => {
    redo(view.state, view.dispatch);
    view.focus();
  });
  // Ctrl+Z, Ctrl+Y e Ctrl+Maiusc+Z funzionano anche con il fuoco fuori dal testo, per esempio dopo un clic nella
  // barra laterale (K3). Nel testo li gestisce già l'editor; nei campi (titolo, ricerca) sono del campo.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented || inUnCampo(e.target)) return;
    const k = e.key.toLowerCase();
    const annulla = k === "z" && !e.shiftKey;
    const ripeti = (k === "y" && !e.shiftKey) || (k === "z" && e.shiftKey);
    if (!annulla && !ripeti) return;
    e.preventDefault();
    if (annulla) undo(view.state, view.dispatch);
    else redo(view.state, view.dispatch);
  });
  // Unisci e dividi parole (M8c-2).
  const mergeBtn = el("button", "", "Unisci");
  mergeBtn.type = "button";
  conIcona(mergeBtn, "unisci");
  suggerimento(mergeBtn, "Unisce le parole selezionate in un simbolo solo", {
    tasti: "Ctrl+Maiusc+U",
    spento: "Per unire, seleziona due o più parole della stessa frase",
  });
  mergeBtn.addEventListener("click", () => {
    hooks.merge?.();
    view.focus();
  });
  const splitBtn = el("button", "", "Dividi");
  splitBtn.type = "button";
  conIcona(splitBtn, "dividi");
  suggerimento(splitBtn, "Divide il gruppo della parola al cursore", {
    tasti: "Ctrl+Maiusc+D",
    spento: "Per dividere, metti il cursore su un gruppo di parole con un simbolo solo",
  });
  splitBtn.addEventListener("click", () => {
    hooks.split?.();
    view.focus();
  });

  const policyLabel = el("label", "tb-label");
  policyLabel.append(el("span", "", "Parole funzionali"));
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
  }, () => (editBtn.hidden ? select : editBtn).focus(), () => [editBtn, select]);
  const applyPolicy = (): void => {
    const custom = select.value === "custom";
    const cambia = editBtn.hidden === custom;
    editBtn.hidden = !custom;
    if (!custom) dialog.hide();
    setPolicy(view, custom ? tablePolicy(table) : (select.value as Policy));
    refresh();
    if (cambia) adatta();
  };
  // La tabella si apre da sola la prima volta che si sceglie «Personalizzato»; poi c'è «Modifica…».
  let tableShown = false;
  select.addEventListener("change", () => {
    applyPolicy();
    notifyPrefs();
    if (select.value === "custom" && !tableShown) {
      tableShown = true;
      // Se la scelta arriva dal menu «Altro», il menu si chiude: la tabella non deve stargli sotto.
      menu.chiudi(false);
      dialog.show();
    }
  });
  editBtn.addEventListener("click", () => {
    menu.chiudi(false);
    dialog.show();
  });
  policyLabel.append(select);

  // Contorno: ogni coppia simbolo-parola in una "card" (impostazione dell'editor, ricordata sul computer).
  // (In M11-5 va nella scheda «Pagina».)
  const cardsLabel = el("label", "tb-check");
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
  cardsLabel.append(cards, "Contorna simbolo e parola");

  // Dimensione dei simboli: un gruppo a scelta unica.
  const sizes = el("div", "tb-sizes");
  sizes.setAttribute("role", "group");
  sizes.setAttribute("aria-label", "Dimensione dei simboli");
  sizes.append(el("span", "tb-caption", "Simboli"));
  const segmented = el("div", "segmented");
  const sizeButtons: HTMLButtonElement[] = SIZES.map(([label, px], i) => {
    const b = el("button", "", label);
    b.type = "button";
    suggerimento(b, `Simboli: ${label.toLowerCase()}`, { tasti: `Ctrl+${i + 1}` });
    b.addEventListener("click", () => {
      setSize(px);
      refresh();
      notifyPrefs();
      view.focus();
    });
    segmented.append(b);
    return b;
  });
  sizes.append(segmented);

  // Stampa (M10): le impostazioni della pagina stanno nel documento; Ctrl+P apre la finestra.
  let printPrefs: PrintPrefs = { ...DEFAULT_PRINT };
  let author = "";
  // Applica le impostazioni alla pagina e accende (o spegne) gli a capo di «una frase per riga».
  const applyPrintPrefs = (p: PrintPrefs, m: { title: string; author: string }): void => {
    applyPrintStyle(p, m);
    setOneLine(view, p.onePerLine);
  };
  const printMeta = () => ({ title: titleInputRef?.value ?? "", author });
  let titleInputRef: HTMLInputElement | null = null;
  const printBtn = el("button", "primary", "Stampa…");
  printBtn.type = "button";
  conIcona(printBtn, "stampa");
  suggerimento(printBtn, "Stampa o salva in PDF", { tasti: "Ctrl+P" });
  const openPrint = (): void => {
    if (document.querySelector(".print-overlay")) return; // già aperta
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
        printNow();
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

  // ---- La barra degli strumenti: gruppi; quelli che non ci stanno vanno nel menu «Altro» ----
  const gruppo = (cls: string, ...figli: Array<HTMLElement | string>): HTMLElement => {
    const g = el("div", `tb-group ${cls}`);
    g.append(...figli);
    return g;
  };
  const gStoria = gruppo("tb-history", undoBtn, redoBtn);
  const gParole = gruppo("tb-words", mergeBtn, splitBtn);
  const gSimboli = gruppo("tb-symbols", sizes);
  const gPolitica = gruppo("tb-policy", policyLabel, editBtn);
  const gContorno = gruppo("tb-cards", cardsLabel);
  /** In ordine nella barra; `esce` dice chi esce per primo quando manca spazio (prima i meno usati). */
  const gruppi: Array<{ el: HTMLElement; esce: number }> = [
    { el: gStoria, esce: 0 },
    { el: gParole, esce: 4 },
    { el: gSimboli, esce: 3 },
    { el: gPolitica, esce: 2 },
    { el: gContorno, esce: 1 },
  ];
  toolbar.append(...gruppi.map((g) => g.el), dialog.root);
  function adatta(): void {
    // Tutti nella barra, nell'ordine; poi fuori uno alla volta finché la barra sta su una riga.
    for (const g of gruppi) toolbar.insertBefore(g.el, dialog.root);
    const uscita = gruppi.filter((g) => g.esce > 0).sort((a, b) => a.esce - b.esce);
    const fuori: HTMLElement[] = [];
    for (const g of uscita) {
      if (toolbar.scrollWidth <= toolbar.clientWidth + 1) break;
      fuori.push(g.el);
      g.el.remove();
    }
    // Nel menu nello stesso ordine della barra.
    menu.strumenti.replaceChildren(...gruppi.filter((g) => fuori.includes(g.el)).map((g) => g.el));
    menu.strumenti.hidden = fuori.length === 0;
  }
  new ResizeObserver(() => adatta()).observe(toolbar);
  void document.fonts?.ready.then(() => adatta());

  // ---- Barra di stato ----
  const wordsInfo = el("span", "words");
  // Il contatore delle parole da controllare è un vero pulsante (raggiungibile con Tab; K8).
  const doubtInfo = el("button", "link doubt");
  doubtInfo.type = "button";
  conIcona(doubtInfo, "bandierina");
  suggerimento(doubtInfo, "Vai alla prossima parola da controllare", { tasti: "F8" });
  doubtInfo.addEventListener("click", () => hooks.next?.());
  const errorInfo = el("span", "engine-state");
  // I messaggi per il docente sono notifiche (M11-3): prima erano un testo piccolo qui in basso che spariva da solo
  // dopo 6 secondi, anche quando era un errore.
  hooks.notice = (message, tipo = "avviso") => void notifica(message, { tipo });
  statusbar.append(doubtInfo, wordsInfo, errorInfo);
  // «Motore attivo» non si scrive più: si dice solo se c'è un problema.
  if (info?.ok && (!info.tagger || !info.expressions)) {
    const manca = [!info.tagger ? "la disambiguazione" : "", !info.expressions ? "le espressioni di più parole" : ""].filter(Boolean).join(" e ");
    queueMicrotask(() => notifica(`I simboli funzionano, ma senza ${manca}: possono essere meno precisi. Se continua, chiama il tecnico.`, { tipo: "avviso" }));
  }

  let ultimoDividi = "";
  function refresh(): void {
    undoBtn.disabled = undoDepth(view.state) === 0;
    redoBtn.disabled = redoDepth(view.state) === 0;
    mergeBtn.disabled = !canMerge(view);
    const here = tokenAt(view, view.state.selection.head);
    const act = here ? groupAction(view, here) : null;
    const dividi = act?.label ?? "Dividi";
    etichetta(splitBtn, dividi);
    splitBtn.disabled = !act;
    const s = engineStats(view);
    sizeButtons.forEach((b, i) => {
      const on = SIZES[i][1] === getSize();
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    wordsInfo.textContent = `${s.words} parole`;
    etichetta(doubtInfo, s.doubtful === 1 ? "1 parola da controllare" : `${s.doubtful} parole da controllare`);
    doubtInfo.classList.toggle("warn", s.doubtful > 0);
    // Il motore ha dato errore e sta riprovando: lo si dice, altrimenti i simboli mancano senza spiegazione.
    errorInfo.textContent = s.error ? "Il motore non risponde: riprovo…" : s.pending > 0 ? "Analisi in corso…" : "";
    errorInfo.classList.toggle("warn", !!s.error);
    // «Riunisci» è più lungo di «Dividi»: la barra si ricontrolla solo quando cambia.
    if (dividi !== ultimoDividi) {
      ultimoDividi = dividi;
      adatta();
    }
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

  // ---- Intestazione: nome, documenti, titolo, stato, Stampa, Altro ----
  const header = el("header", "app-header");
  const brand = el("div", "brand");
  brand.append(segno(), el("span", "brand-name", "Editor CAA"));
  const docsButton = el("button", "", "Documenti");
  docsButton.type = "button";
  conIcona(docsButton, "documenti");
  suggerimento(docsButton, "I miei documenti e la biblioteca della scuola");
  const docbar = el("div", "docbar docs-only");
  docbar.append(docsButton);
  const titleInput = el("input", "doc-title docs-only");
  titleInput.type = "text";
  titleInput.placeholder = "Senza titolo";
  titleInput.maxLength = 120;
  titleInput.setAttribute("aria-label", "Titolo del documento");
  titleInputRef = titleInput;
  // Il titolo scritto aggiorna il piè di pagina facoltativo.
  titleInput.addEventListener("input", () => applyPrintPrefs(printPrefs, printMeta()));
  const saveStatus = el("span", "save-status docs-only");
  saveStatus.setAttribute("role", "status");
  const libStatus = el("button", "lib-status");
  libStatus.type = "button";
  libStatus.hidden = true;
  header.append(brand, docbar, newBtn, titleInput, el("span", "grow"), saveStatus, libStatus, printBtn, menu.button);
  const mostraDocumenti = (si: boolean): void => {
    for (const e of header.querySelectorAll<HTMLElement>(".docs-only")) e.hidden = !si;
  };

  refresh();

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

  return {
    header,
    mostraDocumenti,
    docsButton,
    titleInput,
    saveStatus,
    libStatus,
    mostraVersione,
    menu,
    toolbar,
    statusbar,
    banner,
    setBanner,
    onBannerClose: (cb) => bannerListeners.push(cb),
    refresh,
    adatta,
    getPrefs,
    setPrefs,
    onPrefsChange: (cb) => prefsListeners.push(cb),
    setAuthor: (name) => {
      author = name;
      applyPrintPrefs(printPrefs, printMeta());
    },
  };
}
