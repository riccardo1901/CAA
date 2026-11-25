// Collegamento fra editor, pannello e interfaccia di prova (`window.caaProto`, usata dai test).
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { benchmark, checkSymbolHits, checkWrap } from "./checks";
import { createEditor, currentMode, replaceDoc, setReadOnly } from "./editor/editor";
import { engineStats, onEngineUpdate, setEngine, setPolicy } from "./editor/engineSymbols";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { engineInfo, inTauri, tauriClient, type EngineClient, type EngineInfo, type LibStatus, type Policy } from "./engine/client";
import { hooks } from "./editor/menuHooks";
import { createDocsPanel } from "./docs/panel";
import { firstRun } from "./docs/firstrun";
import { createLexBar } from "./docs/lexbar";
import { createOriginalBar } from "./docs/originalbar";
import { createSession, type Session } from "./docs/session";
import { createSidebar, installSidebar } from "./sidebar";
import { createBars } from "./toolbar";
import { symbolKey, type Mode } from "./editor/symbolPlugin";
import { setSymbols } from "./editor/symbols";
import { createPanel } from "./panel";
import { emptyDoc, fragmentsDoc, sampleDoc } from "./sample";
import type { Node as PMNode } from "prosemirror-model";

let view: EditorView;
let size = 68;
let layoutEl: HTMLElement;
let panelEl: HTMLElement;
let sideEl: HTMLElement | null = null;
/** La sessione del documento (salvataggio automatico, apertura): c'è solo con l'archivio dei documenti. */
let session: Session | null = null;
let root: HTMLElement;

export function replaceDocument(doc: PMNode): void {
  replaceDoc(view, doc);
  view.focus();
}

function applySize(px: number): void {
  size = px;
  document.documentElement.style.setProperty("--sym", `${px}px`);
}

/** Passa all'interfaccia con il motore: barre, simboli veri, niente pannello di prova. */
let engineModeOn = false;

function enterEngineMode(client: EngineClient | null, info: EngineInfo | null): void {
  // Una volta sola: i pulsanti e gli ascoltatori delle barre non si devono accumulare.
  if (engineModeOn) {
    if (client && sideEl) {
      setEngine(view, client);
      installSidebar(view, client, sideEl);
    }
    return;
  }
  engineModeOn = true;
  panelEl.remove();
  // La barra dei simboli sostituisce il pannello di prova: fissa a destra, si riempie quando si agisce su una parola.
  sideEl = createSidebar();
  layoutEl.appendChild(sideEl);
  const app = document.createElement("div");
  app.className = "app";
  // "Nuovo" e "Testo di esempio" buttano via il documento aperto (il salvataggio arriva con M9): si chiede conferma
  // se c'è del testo.
  const confirmReplace = (make: () => PMNode) => () => {
    const hasText = view.state.doc.textContent.trim().length > 0;
    if (hasText && !window.confirm("Il documento aperto andrà perso. Continuare?")) return;
    replaceDocument(make());
  };
  const docs = client?.docs ?? null;
  const bars = createBars(
    view,
    info,
    applySize,
    () => size,
    () => (session ? void session.newDocument() : confirmReplace(emptyDoc)()),
    () => (session ? void session.newDocument(sampleDoc(1)) : confirmReplace(() => sampleDoc(1))()),
  );
  // La riga dei documenti c'è solo se c'è l'archivio (nell'app); nelle prove senza archivio resta nascosta.
  bars.docbar.hidden = !docs;
  const lexBar = createLexBar((p) => client?.url(p) ?? "");
  const originalBar = createOriginalBar();
  app.append(bars.banner, lexBar.root, originalBar.root, bars.docbar, bars.toolbar, layoutEl, bars.statusbar);
  if (docs) {
    const w = window as unknown as { __caaAutosaveMs?: number; __caaRetryMs?: number; __caaLibPollMs?: number };
    const baseBanner = (): void => {
      bars.banner.hidden = !!info?.ok;
      bars.banner.textContent = info && !info.ok ? `Il motore non è attivo: ${info.error ?? "errore sconosciuto"}` : "";
    };
    // Gli avvisi importanti stanno in alto finché non si clicca.
    bars.banner.title = "Clicca per chiudere";
    bars.banner.addEventListener("click", baseBanner);
    session = createSession({
      view,
      docs,
      lexicon: info?.lexicon ?? "",
      getPrefs: bars.getPrefs,
      setPrefs: bars.setPrefs,
      replaceDocument,
      emptyDoc,
      setReadOnly: (ro) => setReadOnly(view, ro),
      banner: (message) => {
        if (message === null) return baseBanner();
        bars.banner.hidden = false;
        bars.banner.textContent = message;
      },
      confirm: (m) => window.confirm(m),
      notice: (m) => hooks.notice?.(m),
      titleInput: bars.titleInput,
      saveStatus: bars.saveStatus,
      lexBar,
      library: client?.library,
      originalBar,
      delayMs: w.__caaAutosaveMs,
      retryMs: w.__caaRetryMs,
    });
    bars.onPrefsChange(() => session?.touch());
    // L'indicatore della biblioteca in alto: si controlla all'avvio e ogni 2 minuti (SPEC.md, "Online e offline").
    const lib = client?.library;
    const showLib = (s: LibStatus | null): void => {
      bars.libStatus.hidden = !s || !s.configured;
      if (!s || !s.configured) return;
      bars.libStatus.textContent = s.reachable ? "● Biblioteca" : "○ Biblioteca non raggiungibile";
      bars.libStatus.className = `lib-status ${s.reachable ? "on" : "off"}`;
      bars.libStatus.title = s.path ?? "";
    };
    const panel = createDocsPanel(docs, session, (title) => window.confirm(`Eliminare «${title}»? Non si può annullare.`), {
      library: lib,
      libraryChanged: showLib,
      corrections: client?.corrections,
      onClose: () => view.focus(),
    });
    bars.docsButton.addEventListener("click", () => panel.open());
    bars.libStatus.addEventListener("click", () => panel.open("library"));
    if (lib) {
      // Ogni 2 minuti: stato del Drive, «originale aggiornato» per la copia aperta, versione nuova del programma.
      const poll = (): void => {
        void lib.status().then(
          (s) => {
            showLib(s);
            if (s.reachable) void session?.recheckOriginal();
          },
          () => showLib(null),
        );
        void lib.version().then(
          (v) => {
            bars.updateNote.hidden = !v;
            if (v) {
              bars.updateNote.textContent = `È disponibile la versione ${v.version} del programma`;
              bars.updateNote.title = v.notes ? `${v.notes} — chiedi al tecnico di aggiornare i computer` : "Chiedi al tecnico di aggiornare i computer";
            }
          },
          () => (bars.updateNote.hidden = true),
        );
      };
      poll();
      window.setInterval(poll, w.__caaLibPollMs ?? 120_000);
      if (client?.settings) void firstRun({ settings: client.settings, library: lib, notice: (m) => hooks.notice?.(m), libraryStatus: showLib });
    }
  }
  root.appendChild(app);
  onEngineUpdate(bars.refresh);
  // I simboli finti del prototipo si spengono sempre: col motore non servono e costano tempo a ogni battuta.
  view.dispatch(view.state.tr.setMeta(symbolKey, { mode: "off" }));
  if (client) {
    setEngine(view, client);
    installSidebar(view, client, sideEl);
  }
  bars.refresh();
}

export function startApp(mount: HTMLElement): void {
  root = mount;
  const layout = document.createElement("div");
  layout.className = "layout";
  const wrap = document.createElement("main");
  wrap.className = "sheet-wrap";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  wrap.appendChild(sheet);
  layout.appendChild(wrap);
  root.appendChild(layout);

  applySize(size);
  view = createEditor(sheet, sampleDoc(1));
  layoutEl = layout;
  panelEl = createPanel(view, applySize, () => size);
  layout.appendChild(panelEl);

  // Nell'app (Tauri) si passa subito al motore; nel browser restano il prototipo e le sue prove.
  if (inTauri()) {
    // Alla chiusura della finestra il programma salva quello che c'è da salvare e poi esce (se non risponde,
    // esce da solo dopo pochi secondi).
    void listen("caa-close-request", async () => {
      // La pagina risponde subito (niente uscita forzata), salva con calma e, se non riesce, chiede conferma.
      await invoke("close_ack").catch(() => undefined);
      const leave = session ? await session.prepareClose().catch(() => false) : true;
      if (leave) await invoke("exit_app");
    });
    engineInfo().then(
      (info) => {
        enterEngineMode(info.ok ? tauriClient() : null, info);
        // All'avvio un documento vuoto, pronto per scrivere.
        session?.startFresh();
      },
      (e: unknown) => enterEngineMode(null, { ok: false, dir: null, error: String(e), tagger: false, expressions: false }),
    );
  }

  // Interfaccia per i test automatici.
  (window as unknown as { caaProto: unknown }).caaProto = {
    view,
    setMode: (m: Mode) => view.dispatch(view.state.tr.setMeta(symbolKey, { mode: m })),
    mode: () => currentMode(view),
    setSize: applySize,
    loadSample: (repeat = 1) => replaceDocument(sampleDoc(repeat)),
    loadFragments: () => replaceDocument(fragmentsDoc()),
    setSymbols,
    // Motore (prove automatiche con un motore finto, app con quello vero).
    enterEngineMode: (client: EngineClient) => enterEngineMode(client, { ok: true, dir: null, error: null, tagger: true, expressions: true, lexicon: "lex-new" }),
    engineStats: () => engineStats(view),
    // La chiusura della finestra (prova: chiede di uscire solo se il salvataggio è riuscito o il docente conferma).
    closeRequest: () => (session ? session.prepareClose() : Promise.resolve(true)),
    setPolicy: (p: Policy) => setPolicy(view, p),
    refresh: () => view.dispatch(view.state.tr.setMeta(symbolKey, { refresh: true })),
    checkWrap: () => checkWrap(view),
    checkSymbolHits: () => checkSymbolHits(view),
    benchmark: (n?: number) => benchmark(view, n),
    // Funzioni di servizio per i test.
    setCaret: (pos: number, to?: number) => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, to ?? pos)));
      view.focus();
    },
    selection: () => ({ anchor: view.state.selection.anchor, head: view.state.selection.head, from: view.state.selection.from, to: view.state.selection.to }),
    // Posizione del cursore letta dal browser (ProseMirror la sincronizza con un piccolo ritardo).
    domHead: () => {
      const sel = window.getSelection();
      return sel && sel.focusNode ? view.posAtDOM(sel.focusNode, sel.focusOffset) : null;
    },
    // Coordinate del cursore relative al foglio (non allo schermo: il foglio scorre).
    caret: (pos?: number) => {
      const sel = window.getSelection();
      const head = sel && sel.focusNode ? view.posAtDOM(sel.focusNode, sel.focusOffset) : view.state.selection.head;
      const c = view.coordsAtPos(pos ?? head);
      const scroll = document.querySelector<HTMLElement>(".sheet-wrap")?.scrollTop ?? 0;
      return { left: c.left, top: c.top + scroll, bottom: c.bottom + scroll };
    },
    posAt: (left: number, top: number) => view.posAtCoords({ left, top })?.pos ?? null,
    text: (from: number, to: number) => view.state.doc.textBetween(from, to, "\n"),
    docSize: () => view.state.doc.content.size,
    docJSON: () => view.state.doc.toJSON() as unknown,
    pasteHTML: (html: string) => view.pasteHTML(html),
    setSheetWidth: (px: number) => {
      const sheet = document.querySelector<HTMLElement>(".sheet");
      if (sheet) sheet.style.width = `${px}px`;
    },
  };
}
