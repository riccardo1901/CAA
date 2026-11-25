// La sessione del documento (M9a): quale file è aperto, titolo, salvataggio automatico, apertura e
// documento nuovo. Il salvataggio automatico scrive solo nei documenti personali locali, mai nel Drive.
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { clearLegacy, dropLegacyToken, legacyDiff, onEngineUpdate, renderSnapshot, setLegacy, type LexChange } from "../editor/engineSymbols";
import { revealPos, setFocusWord } from "../editor/menuHooks";
import { FORCED_MERGE, pinPictos, sanitizeLocks } from "../editor/picks";
import { schema } from "../editor/schema";
import type { DocClient, DocEntry, LibEntry, LibraryClient, OpenedDoc, SavePayload } from "../engine/client";
import type { OriginalBar } from "./originalbar";
import type { LexBar } from "./lexbar";
import { COMPLETE_TABLE, DEFAULT_PRINT, sanitizePrefs, type DocPrefs } from "./prefs";

export interface SessionDeps {
  view: EditorView;
  docs: DocClient;
  /** Versione del lessico del programma. */
  lexicon: string;
  getPrefs(): DocPrefs;
  setPrefs(p: Partial<DocPrefs>): void;
  replaceDocument(doc: PMNode): void;
  emptyDoc(): PMNode;
  setReadOnly(readOnly: boolean): void;
  /** Un avviso fisso in alto (`null` lo toglie). */
  banner(message: string | null): void;
  confirm(message: string): boolean;
  /** Un messaggio breve per il docente. */
  notice(message: string): void;
  titleInput: HTMLInputElement;
  saveStatus: HTMLElement;
  /** La barra «il lessico è cambiato». */
  lexBar: LexBar;
  /** La biblioteca (per l'avviso «originale aggiornato» e per guardare l'originale) e la sua barra. */
  library?: LibraryClient;
  originalBar: OriginalBar;
  /** Attesa prima del salvataggio automatico (ms). */
  delayMs?: number;
  /** Attesa prima di riprovare dopo un errore di salvataggio (ms). */
  retryMs?: number;
}

export interface SessionState {
  file: string | null;
  id: string | null;
  rev: number | null;
  created: string | null;
  origin: { id: string; rev: number } | null;
  title: string;
  readOnly: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  savedAt: Date | null;
}

export interface Session {
  state(): SessionState;
  /** Salva subito quello che c'è da salvare. `false` se il salvataggio non è riuscito. */
  flush(): Promise<boolean>;
  /** Un documento nuovo (vuoto, o con il contenuto dato, come il testo di esempio): non si salva finché non lo si modifica. */
  newDocument(doc?: PMNode): Promise<void>;
  openFile(file: string): Promise<void>;
  /** Il documento aperto non ha più un file (è stato eliminato). */
  forget(): void;
  /** Il documento aperto ha cambiato identità o titolo dopo una pubblicazione (salvato come nuovo in biblioteca). */
  adopt(entry: DocEntry): void;
  /** Guarda l'originale della biblioteca in sola lettura (con il ritorno alla propria copia). */
  openOriginal(file: string): Promise<void>;
  /** Riguarda se la biblioteca ha una revisione più nuova dell'originale del documento aperto (se è una copia). */
  recheckOriginal(): Promise<void>;
  /** La finestra sta per chiudersi: salva e dice se si può uscire (se il salvataggio non riesce, chiede conferma). */
  prepareClose(): Promise<boolean>;
  /** Segna il documento come modificato (cambiano le preferenze) e fa partire il salvataggio automatico. */
  touch(): void;
  /** Un nuovo documento senza chiedere niente (all'avvio). */
  startFresh(doc?: PMNode): void;
  onChange(cb: () => void): void;
}

/** Se la biblioteca ha una revisione più nuova dell'originale da cui è nata una copia (e l'originale è uno solo). */
export function originalUpdate(entries: LibEntry[], origin: { id: string; rev: number }): LibEntry | null {
  const newer = entries.filter((e) => e.id === origin.id && e.rev > origin.rev && !e.conflict);
  return newer.sort((a, b) => b.rev - a.rev)[0] ?? null;
}

const ignoreKey = (id: string): string => `caa.ignore-original.${id}`;

function ignoredRev(id: string): number {
  try {
    return Number(localStorage.getItem(ignoreKey(id)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function ignoreRev(id: string, rev: number): void {
  try {
    localStorage.setItem(ignoreKey(id), String(rev));
  } catch {
    /* non è grave: l'avviso ricompare */
  }
}

/** Dal contenuto di un documento al titolo: la prima riga con del testo, corta. */
export function deriveTitle(doc: PMNode): string {
  let title = "";
  doc.forEach((block) => {
    if (title) return;
    const t = block.textContent.trim().replace(/\s+/g, " ");
    if (t) title = t.length > 60 ? `${t.slice(0, 60).replace(/\s+\S*$/, "")}…` : t;
  });
  return title || "Senza titolo";
}

/** Gli `uuid` dei simboli personali usati dal documento (nei segni delle parole e nei blocchi). */
export function usedMedia(doc: PMNode): string[] {
  const uuids = new Set<string>();
  for (const l of sanitizeLocks(doc.attrs.locks)) if (l.uuid) uuids.add(l.uuid);
  doc.descendants((node) => {
    for (const m of node.marks) {
      const u = m.type.name === "pick" ? (m.attrs.uuid as string) : "";
      if (u) uuids.add(u);
    }
    return true;
  });
  return [...uuids];
}

/**
 * Prepara il documento letto da un file (dato non fidato): gli id dei simboli personali diventano quelli di
 * questo computer; le scelte con un simbolo che non c'è, o con valori impossibili, si scartano (la parola
 * torna automatica: meglio che mostrare un altro simbolo con un id sbagliato).
 */
export function remapMedia(json: unknown, media: Array<{ uuid: string; id: number }>): unknown {
  const ids = new Map(media.map((m) => [m.uuid, m.id]));
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);
    const n = { ...(node as Record<string, unknown>) };
    if (Array.isArray(n.marks)) {
      n.marks = n.marks.flatMap((m: unknown) => {
        const mark = m as { type?: string; attrs?: Record<string, unknown> };
        if (mark.type !== "pick") return [m];
        const picto = mark.attrs?.picto;
        const uuid = mark.attrs?.uuid;
        // Un valore che non è un intero ammesso (-1 = solo testo, 0 = nessun simbolo) o un valore speciale.
        if (typeof picto !== "number" || !Number.isInteger(picto) || picto < -1 || picto >= FORCED_MERGE) return [];
        if (typeof uuid === "string" && uuid !== "") {
          const id = ids.get(uuid);
          return id === undefined ? [] : [{ ...mark, attrs: { ...mark.attrs, picto: id } }];
        }
        return [m];
      });
    }
    if (n.attrs && typeof n.attrs === "object" && Array.isArray((n.attrs as { locks?: unknown }).locks)) {
      const locks = sanitizeLocks((n.attrs as { locks: unknown }).locks).flatMap((l) => {
        if (!l.uuid) return [l];
        const id = ids.get(l.uuid);
        return id === undefined ? [] : [{ ...l, picto: id }];
      });
      n.attrs = { ...(n.attrs as Record<string, unknown>), locks };
    }
    if (Array.isArray(n.content)) n.content = n.content.map(walk);
    return n;
  };
  return walk(json);
}

export function createSession(deps: SessionDeps): Session {
  const { view } = deps;
  const delay = deps.delayMs ?? 3000;
  const retryMs = deps.retryMs ?? 10_000;
  const st: SessionState = { file: null, id: null, rev: null, created: null, origin: null, title: "", readOnly: false, dirty: false, saving: false, error: null, savedAt: null };
  const listeners: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loading = false;
  let lastDoc = view.state.doc;
  let again = false;
  // Cambia ogni volta che la sessione passa a un altro documento: un salvataggio partito prima non deve
  // più toccare lo stato né far ripartire un salvataggio sul file di prima.
  let epoch = 0;
  // Cresce a ogni modifica da salvare (testo, titolo, preferenze): dice se dopo un salvataggio c'è altro.
  let version = 0;
  let inflight: Promise<boolean> | null = null;
  // Aggiornamento del lessico: il documento si apre con i simboli vecchi finché il docente non decide.
  let legacyActive = false;
  let docLexicon = "";
  let review: number | null = null;
  let shownReview = "";
  // Se si sta guardando l'originale della biblioteca: il file della propria copia a cui tornare.
  let returnTo: string | null = null;

  const statusText = (): string => {
    if (st.readOnly) return "Sola lettura";
    if (st.error) return "Non salvato: riprovo…";
    if (st.saving) return "Salvataggio…";
    if (st.dirty) return "Modifiche non ancora salvate";
    if (st.savedAt) return `Salvato alle ${st.savedAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
    return "";
  };
  const changed = (): void => {
    deps.saveStatus.textContent = statusText();
    deps.saveStatus.classList.toggle("warn", !!st.error);
    if (deps.titleInput.value !== st.title) deps.titleInput.value = st.title;
    listeners.forEach((cb) => cb());
  };

  const schedule = (ms: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, ms);
  };

  const markDirty = (): void => {
    if (st.readOnly || loading) return;
    version++;
    st.dirty = true;
    changed();
    schedule(delay);
  };

  const hasText = (doc: PMNode): boolean => doc.textContent.trim().length > 0;

  const payload = (): SavePayload => {
    const doc = view.state.doc;
    return {
      file: st.file,
      id: st.id,
      rev: st.rev,
      title: st.title.trim() || deriveTitle(doc),
      created: st.created,
      origin: st.origin,
      prefs: deps.getPrefs(),
      sense_locks: sanitizeLocks(doc.attrs.locks),
      document: doc.toJSON() as unknown,
      render: renderSnapshot(view),
      media: usedMedia(doc),
      // Con simboli vecchi in sospeso il documento resta alla versione vecchia del lessico.
      lexicon: legacyActive ? docLexicon : deps.lexicon,
    };
  };

  /** Salva ora. Se un salvataggio è già in corso lo aspetta e ne fa partire un altro appena finisce. */
  function save(): Promise<boolean> {
    if (st.readOnly) return Promise.resolve(true);
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = doSave().finally(() => {
      inflight = null;
      if (again) {
        again = false;
        if (st.dirty) schedule(0);
      }
    });
    return inflight;
  }

  async function doSave(): Promise<boolean> {
    // Un documento nuovo e vuoto non si salva: non nascono file «Senza titolo» da un clic.
    if (!st.file && !hasText(view.state.doc)) {
      st.dirty = false;
      changed();
      return true;
    }
    const myEpoch = epoch;
    const myVersion = version;
    const titleAtSave = st.title;
    const body = payload();
    st.saving = true;
    changed();
    let entry: DocEntry;
    try {
      entry = await deps.docs.save(body);
    } catch (e) {
      if (myEpoch !== epoch) return false;
      st.error = String(e);
      st.saving = false;
      changed();
      schedule(retryMs);
      return false;
    }
    // Nel frattempo si è passati a un altro documento: il file è stato scritto, ma lo stato della sessione
    // non è più di questo documento e non va toccato.
    if (myEpoch !== epoch) return true;
    st.file = entry.file;
    st.id = entry.id;
    st.rev = entry.rev;
    // Il titolo scritto dal docente mentre si salvava non si annulla.
    if (st.title === titleAtSave) st.title = entry.title;
    st.error = null;
    st.savedAt = new Date();
    st.saving = false;
    st.dirty = version !== myVersion;
    changed();
    if (entry.conflict) {
      // In alto e finché non si clicca: un avviso di pochi secondi in fondo allo schermo non si vede.
      deps.banner(`Il file era stato cambiato da un'altra copia del programma: ho salvato questo documento come «${entry.title}» (${entry.file}). Nessun testo è andato perso. (Clicca qui per chiudere.)`);
    }
    if (st.dirty) schedule(delay);
    return true;
  }

  /** Salva quello che c'è da salvare, aspettando i salvataggi in corso (anche se lenti). `false` se non riesce. */
  async function flush(): Promise<boolean> {
    if (st.readOnly) return true;
    for (let round = 0; round < 6; round++) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (inflight) await inflight;
      if (st.error) return false;
      if (!st.dirty) return true;
      if (!(await save())) return false;
    }
    return !st.dirty && !st.error;
  }

  async function prepareClose(): Promise<boolean> {
    if (await flush()) return true;
    return deps.confirm("Il documento aperto non si è salvato e le ultime modifiche andranno perse. Uscire comunque?");
  }

  const endLegacy = (save: boolean): void => {
    const was = legacyActive;
    legacyActive = false;
    review = null;
    shownReview = "";
    deps.lexBar.set(null);
    if (was) {
      clearLegacy(view);
      setFocusWord(view, null);
      if (save) markDirty();
    }
  };

  /** Dopo ogni risposta del motore: se i simboli vecchi sono in sospeso, aggiorna la barra del lessico. */
  const refreshLexicon = (): void => {
    if (!legacyActive) return;
    const d = legacyDiff(view);
    if (!d.active) return endLegacy(false);
    if (d.pending) return;
    if (d.changes.length === 0) return endLegacy(true);
    // Le posizioni si rileggono al momento del clic: il testo può essere cambiato da quando la barra le ha mostrate.
    const pin = (list: LexChange[]): void => {
      const now = legacyDiff(view).changes;
      const fresh = list.flatMap((c) => now.filter((x) => x.text === c.text && x.s === c.s && x.e === c.e));
      pinPictos(view, fresh.map((c) => ({ paraPos: c.paraPos, s: c.s, e: c.e, picto: c.oldPicto })));
    };
    if (review === null) {
      shownReview = "";
      deps.lexBar.set({
        kind: "summary",
        count: d.changes.length,
        onReview: () => {
          review = 0;
          refreshLexicon();
        },
        onApplyAll: () => endLegacy(true),
        onKeepAll: () => {
          pin(d.changes);
          endLegacy(true);
        },
      });
      return;
    }
    review = Math.min(review, d.changes.length - 1);
    const c = d.changes[review];
    const key = `${review}|${d.changes.length}|${c.text}|${c.s}|${c.e}|${c.oldPicto}|${c.newPicto}`;
    if (key === shownReview) return;
    shownReview = key;
    const at = c.paraPos + 1 + c.s;
    setFocusWord(view, [at, c.paraPos + 1 + c.e]);
    revealPos(view, at);
    deps.lexBar.set({
      kind: "review",
      k: review + 1,
      total: d.changes.length,
      word: c.word,
      oldPicto: c.oldPicto,
      newPicto: c.newPicto,
      onKeep: () => pin([c]),
      onUseNew: () => dropLegacyToken(view, c.text, c.s, c.e),
      onSkip: () => {
        review = ((review ?? 0) + 1) % d.changes.length;
        refreshLexicon();
      },
      onEnd: () => {
        review = null;
        setFocusWord(view, null);
        refreshLexicon();
      },
    });
  };

  const reset = (): void => {
    epoch++;
    st.saving = false;
    endLegacy(false);
    st.file = st.id = st.rev = st.created = st.origin = null;
    st.title = "";
    st.dirty = false;
    st.error = null;
    st.savedAt = null;
    st.readOnly = false;
    deps.setReadOnly(false);
    deps.banner(null);
    deps.originalBar.set(null);
    returnTo = null;
  };

  function load(doc: PMNode): void {
    loading = true;
    try {
      deps.replaceDocument(doc);
      lastDoc = view.state.doc;
    } finally {
      loading = false;
    }
  }

  const startFresh = (doc?: PMNode): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    reset();
    deps.setPrefs({ preset: "complete", table: { ...COMPLETE_TABLE }, print: { ...DEFAULT_PRINT } });
    load(doc ?? deps.emptyDoc());
    changed();
  };

  async function newDocument(doc?: PMNode): Promise<void> {
    if (!(await flush()) && !deps.confirm("Il documento aperto non si è salvato e andrà perso. Continuare?")) return;
    startFresh(doc);
  }

  /** Mette un documento letto in pagina (dato non fidato: deve essere valido per lo schema dell'editor). */
  function present(o: OpenedDoc, original: boolean): void {
    const json = remapMedia(o.document, o.media);
    let doc: PMNode;
    try {
      doc = schema.nodeFromJSON(json);
      doc.check();
    } catch {
      throw new Error("il documento non è valido");
    }
    if (timer) clearTimeout(timer);
    timer = null;
    const back = original ? st.file : null;
    reset();
    deps.setPrefs({ ...sanitizePrefs(o.prefs) });
    load(doc);
    // L'originale della biblioteca non è un documento personale: nessun file, sola lettura.
    st.file = original ? null : o.entry.file;
    st.id = original ? null : o.entry.id;
    st.rev = original ? null : o.entry.rev;
    st.created = o.created;
    st.origin = original ? null : o.entry.origin;
    st.title = o.entry.title;
    st.readOnly = o.read_only || original;
    st.savedAt = null;
    docLexicon = o.lexicon;
    // Un lessico diverso da quello con cui è stato salvato: si mostrano i simboli vecchi e si chiede.
    if (deps.lexicon && o.lexicon && o.lexicon !== deps.lexicon && Array.isArray(o.render) && o.render.length > 0 && !st.readOnly) {
      setLegacy(view, o.render);
      legacyActive = true;
    }
    deps.setReadOnly(st.readOnly);
    if (original) {
      returnTo = back;
      deps.banner(null);
      deps.originalBar.set({ kind: "viewing", title: o.entry.title, onBack: () => void (returnTo ? openFile(returnTo) : newDocument()) });
    } else {
      deps.banner(o.read_only ? "Questo documento è stato scritto da una versione più recente del programma: si apre solo in lettura. Aggiorna il programma per modificarlo." : null);
    }
    changed();
    refreshLexicon();
  }

  async function openFile(file: string): Promise<void> {
    if (!(await flush()) && !deps.confirm("Il documento aperto non si è salvato e andrà perso. Continuare?")) return;
    const o: OpenedDoc = await deps.docs.open(file);
    present(o, false);
    void recheckOriginal();
  }

  async function openOriginal(file: string): Promise<void> {
    if (!deps.library) return;
    if (!(await flush()) && !deps.confirm("Il documento aperto non si è salvato e andrà perso. Continuare?")) return;
    const o = await deps.library.open(file);
    present(o, true);
  }

  /** «L'originale è stato aggiornato»: per una copia adattata, se la biblioteca ha una revisione più nuova. */
  async function recheckOriginal(): Promise<void> {
    if (!deps.library || !st.origin || st.readOnly) {
      if (!returnTo) deps.originalBar.set(null);
      return;
    }
    const mine = epoch;
    const origin = st.origin;
    let entries: LibEntry[];
    try {
      entries = (await deps.library.scan()).entries;
    } catch {
      return;
    }
    if (mine !== epoch) return; // nel frattempo si è passati a un altro documento
    const e = originalUpdate(entries, origin);
    if (!e || e.rev <= ignoredRev(origin.id)) {
      deps.originalBar.set(null);
      return;
    }
    deps.originalBar.set({
      kind: "update",
      title: e.title,
      rev: e.rev,
      onOpen: () => void openOriginal(e.file),
      onIgnore: () => {
        ignoreRev(origin.id, e.rev);
        deps.originalBar.set(null);
      },
    });
  }

  // Le modifiche al documento e alle preferenze fanno partire il salvataggio automatico.
  onEngineUpdate(() => {
    if (view.state.doc !== lastDoc) {
      lastDoc = view.state.doc;
      markDirty();
    }
    refreshLexicon();
  });
  deps.titleInput.addEventListener("input", () => {
    st.title = deps.titleInput.value;
    markDirty();
  });
  // Cambiando scheda o finestra si salva subito.
  const quick = (): void => {
    if (st.dirty) void flush();
  };
  window.addEventListener("blur", quick);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && quick());

  return {
    state: () => ({ ...st }),
    flush,
    prepareClose,
    newDocument,
    openFile,
    forget: () => {
      epoch++;
      st.saving = false;
      st.file = st.id = st.rev = st.created = st.origin = null;
      st.savedAt = null;
      changed();
    },
    startFresh,
    adopt: (entry) => {
      st.id = entry.id;
      st.rev = entry.rev;
      st.title = entry.title;
      changed();
    },
    openOriginal,
    recheckOriginal,
    touch: markDirty,
    onChange: (cb) => listeners.push(cb),
  };
}
