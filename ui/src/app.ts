// Collegamento fra editor, pannello e interfaccia di prova (`window.caaProto`, usata dai test).
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { benchmark, checkSymbolHits, checkWrap } from "./checks";
import { setOneLine } from "./editor/printLines";
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
import { icona } from "./ui/icons";
import { installaSuggerimenti } from "./ui/tooltip";
import { conferma } from "./ui/confirm";
import { creaPannelloLaterale } from "./side/panel";
import { creaInvito } from "./ui/invito";
import { installaScorciatoie } from "./ui/help";
import { ripristinaDimensione } from "./ui/dimensione";
import { attachMemoryTab } from "./side/memory";

let view: EditorView;
let size = 68;
let layoutEl: HTMLElement;
let panelEl: HTMLElement;
let sideEl: HTMLElement | null = null;
/** La sessione del documento (salvataggio automatico, apertura): c'è solo con l'archivio dei documenti. */
let session: Session | null = null;
let root: HTMLElement;
/** Il pannello laterale (M11-4): le parti del programma ci aggiungono le loro schede («Pagina», «Memoria»). */
let pannelloLaterale: ReturnType<typeof creaPannelloLaterale> | null = null;
export const pannelloLateraleAttuale = (): ReturnType<typeof creaPannelloLaterale> | null => pannelloLaterale;

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
  // La barra dei simboli sostituisce il pannello di prova: a destra, si riempie quando si agisce su una parola. Sta in
  // un pannello che si richiude (M11-4): da solo quando il foglio non entra accanto, e si riapre quando serve.
  sideEl = createSidebar();
  const pannello = creaPannelloLaterale(sideEl, layoutEl, layoutEl.querySelector<HTMLElement>(".sheet-wrap")!);
  layoutEl.appendChild(pannello.root);
  hooks.apriBarra = () => {
    // Una parola da mostrare: la scheda «Simbolo».
    pannello.mostraScheda("simbolo");
    // Dopo che la parola è evidenziata: se il pannello sta sopra il foglio, la parola non deve restare coperta.
    requestAnimationFrame(() => pannello.mostraParola());
  };
  pannelloLaterale = pannello;
  hooks.lasciaBarra = () => {
    if (pannello.sopra()) pannello.chiudi();
  };
  const app = document.createElement("div");
  app.className = "app";
  // "Nuovo" e "Testo di esempio" buttano via il documento aperto (il salvataggio arriva con M9): si chiede conferma
  // se c'è del testo.
  const confirmReplace = (make: () => PMNode) => async () => {
    const hasText = view.state.doc.textContent.trim().length > 0;
    if (hasText && !(await conferma({ domanda: "Il documento aperto andrà perso. Continuare?", azione: "Continua", pericolo: true }))) return;
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
  bars.collegaPannello(pannello); // la scheda «Pagina» (M11-5): le impostazioni di stampa accanto al foglio
  attachMemoryTab(pannello); // M11-7: la scheda «Memoria» (Cosa ricordo, I miei simboli), dopo «Pagina»
  // Per le prove automatiche: le preferenze del documento (stampa, contorno, dimensione) senza passare dai pulsanti,
  // che in M11 cambiano posto. Nessun effetto per il docente.
  Object.assign((window as unknown as { caaProto: object }).caaProto, { getPrefs: bars.getPrefs, setPrefs: bars.setPrefs, setAuthor: bars.setAuthor });
  // Le parti dei documenti ci sono solo se c'è l'archivio (nell'app); nelle prove senza archivio restano nascoste.
  bars.mostraDocumenti(!!docs);
  const lexBar = createLexBar((p) => client?.url(p) ?? "");
  const originalBar = createOriginalBar();
  // Gli avvisi del documento in un posto solo, sotto la barra degli strumenti e sopra il foglio (M11-4).
  const avvisi = document.createElement("div");
  avvisi.className = "strip-zone";
  avvisi.setAttribute("role", "region");
  avvisi.setAttribute("aria-label", "Avvisi del documento");
  avvisi.append(bars.banner, lexBar.root, originalBar.root);
  app.append(bars.header, bars.toolbar, avvisi, layoutEl, bars.statusbar);
  document.body.append(bars.menu.panel);
  if (docs) {
    const w = window as unknown as { __caaAutosaveMs?: number; __caaRetryMs?: number; __caaLibPollMs?: number };
    const baseBanner = (): void => {
      bars.setBanner(info && !info.ok ? `Il motore non è attivo: ${info.error ?? "errore sconosciuto"}` : null);
    };
    // Gli avvisi importanti stanno in alto finché non si chiudono con la × (K9).
    session = createSession({
      view,
      docs,
      lexicon: info?.lexicon ?? "",
      getPrefs: bars.getPrefs,
      setPrefs: bars.setPrefs,
      replaceDocument,
      emptyDoc,
      setReadOnly: (ro) => setReadOnly(view, ro),
      banner: (message) => (message === null ? baseBanner() : bars.setBanner(message)),
      confirm: conferma,
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
      // Icona e parola, mai solo colore: nuvola (collegata) o nuvola barrata (non raggiungibile).
      bars.libStatus.replaceChildren(icona(s.reachable ? "biblioteca" : "bibliotecaOff"), s.reachable ? "Biblioteca" : "Biblioteca non raggiungibile");
      bars.libStatus.className = `lib-status ${s.reachable ? "on" : "off"}`;
      bars.libStatus.title = s.path ?? "";
    };
    const panel = createDocsPanel(docs, session, (title) => conferma({ domanda: `Eliminare «${title}»?`, spiegazione: "Il documento si cancella da questo computer. Non si può annullare.", azione: "Elimina", pericolo: true }), {
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
          // La versione nuova serve al tecnico: è una voce del menu «Altro», con un pallino sul pulsante.
          (v) =>
            bars.mostraVersione(
              v ? `È disponibile la versione ${v.version} del programma` : null,
              v?.notes ? `${v.notes} — chiedi al tecnico di aggiornare i computer` : "Chiedi al tecnico di aggiornare i computer",
            ),
          () => bars.mostraVersione(null, ""),
        );
      };
      poll();
      window.setInterval(poll, w.__caaLibPollMs ?? 120_000);
      client?.settings?.getName().then((n) => bars.setAuthor(n), () => undefined);
      if (client?.settings) {
        const settings = client.settings;
        // Il nome scritto al primo avvio vale subito anche per il piè di pagina (prima serviva riavviare).
        void firstRun({ settings, library: lib, notice: (m) => hooks.notice?.(m), libraryStatus: showLib }).then(() =>
          settings.getName().then((n) => bars.setAuthor(n), () => undefined),
        );
      }
    }
  }
  // L'invito sul foglio vuoto (M11-8): sopra il foglio, non dentro; «Prova con un testo di esempio».
  creaInvito(view, layoutEl.querySelector<HTMLElement>(".sheet-wrap")!, () =>
    session ? void session.newDocument(sampleDoc(1)) : void confirmReplace(() => sampleDoc(1))(),
  );
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
  installaSuggerimenti();
  installaScorciatoie();
  ripristinaDimensione();
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
    setOneLine: (on: boolean) => setOneLine(view, on),
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
