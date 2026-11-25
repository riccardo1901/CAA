// La sessione del documento (M9a): quale file è aperto, titolo, salvataggio automatico, apertura e
// documento nuovo. Il salvataggio automatico scrive solo nei documenti personali locali, mai nel Drive.
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { clearLegacy, dropLegacyToken, legacyDiff, onEngineUpdate, renderSnapshot, setLegacy, type LexChange } from "../editor/engineSymbols";
import { revealPos, setFocusWord } from "../editor/menuHooks";
import { pinPictos, sanitizeLocks } from "../editor/picks";
import { schema } from "../editor/schema";
import type { DocClient, DocEntry, OpenedDoc, SavePayload } from "../engine/client";
import type { LexBar } from "./lexbar";
import { COMPLETE_TABLE, sanitizePrefs, type DocPrefs } from "./prefs";

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
  titleInput: HTMLInputElement;
  saveStatus: HTMLElement;
  /** La barra «il lessico è cambiato». */
  lexBar: LexBar;
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
  /** Segna il documento come modificato (cambiano le preferenze) e fa partire il salvataggio automatico. */
  touch(): void;
  /** Un nuovo documento senza chiedere niente (all'avvio). */
  startFresh(doc?: PMNode): void;
  onChange(cb: () => void): void;
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

/** Sostituisce, nel documento letto da un file, gli id dei simboli personali con quelli di questo computer. */
export function remapMedia(json: unknown, media: Array<{ uuid: string; id: number }>): unknown {
  const ids = new Map(media.map((m) => [m.uuid, m.id]));
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);
    const n = { ...(node as Record<string, unknown>) };
    if (Array.isArray(n.marks)) {
      n.marks = n.marks.map((m: unknown) => {
        const mark = m as { type?: string; attrs?: Record<string, unknown> };
        const uuid = mark.attrs?.uuid;
        if (mark.type === "pick" && typeof uuid === "string" && ids.has(uuid)) return { ...mark, attrs: { ...mark.attrs, picto: ids.get(uuid) } };
        return m;
      });
    }
    if (n.attrs && typeof n.attrs === "object" && Array.isArray((n.attrs as { locks?: unknown }).locks)) {
      const locks = sanitizeLocks((n.attrs as { locks: unknown }).locks).map((l) => (l.uuid && ids.has(l.uuid) ? { ...l, picto: ids.get(l.uuid) as number } : l));
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
  // Aggiornamento del lessico: il documento si apre con i simboli vecchi finché il docente non decide.
  let legacyActive = false;
  let docLexicon = "";
  let review: number | null = null;
  let shownReview = "";

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

  async function save(): Promise<boolean> {
    if (st.readOnly) return true;
    if (st.saving) {
      again = true;
      return true;
    }
    // Un documento nuovo e vuoto non si salva: non nascono file «Senza titolo» da un clic.
    if (!st.file && !hasText(view.state.doc)) {
      st.dirty = false;
      changed();
      return true;
    }
    const savedDoc = view.state.doc;
    const body = payload();
    st.saving = true;
    changed();
    try {
      const entry: DocEntry = await deps.docs.save(body);
      st.file = entry.file;
      st.id = entry.id;
      st.rev = entry.rev;
      st.title = entry.title;
      st.error = null;
      st.savedAt = new Date();
      st.dirty = view.state.doc !== savedDoc;
    } catch (e) {
      st.error = String(e);
      st.saving = false;
      changed();
      schedule(retryMs);
      return false;
    }
    st.saving = false;
    changed();
    if (st.dirty || again) {
      again = false;
      schedule(delay);
    }
    return true;
  }

  async function flush(): Promise<boolean> {
    if (st.readOnly || (!st.dirty && !st.saving)) return true;
    if (timer) clearTimeout(timer);
    timer = null;
    // Un salvataggio in corso si aspetta, poi si salva quello che è cambiato.
    for (let i = 0; i < 50 && st.saving; i++) await new Promise((r) => setTimeout(r, 20));
    return st.dirty ? save() : !st.error;
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
    const pin = (list: LexChange[]): void => pinPictos(view, list.map((c) => ({ paraPos: c.paraPos, s: c.s, e: c.e, picto: c.oldPicto })));
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
    endLegacy(false);
    st.file = st.id = st.rev = st.created = st.origin = null;
    st.title = "";
    st.dirty = false;
    st.error = null;
    st.savedAt = null;
    st.readOnly = false;
    deps.setReadOnly(false);
    deps.banner(null);
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
    deps.setPrefs({ preset: "complete", table: { ...COMPLETE_TABLE } });
    load(doc ?? deps.emptyDoc());
    changed();
  };

  async function newDocument(doc?: PMNode): Promise<void> {
    if (!(await flush()) && !deps.confirm("Il documento aperto non si è salvato e andrà perso. Continuare?")) return;
    startFresh(doc);
  }

  async function openFile(file: string): Promise<void> {
    if (!(await flush()) && !deps.confirm("Il documento aperto non si è salvato e andrà perso. Continuare?")) return;
    const o: OpenedDoc = await deps.docs.open(file);
    // Un file è un dato non fidato: il documento deve essere valido per lo schema dell'editor.
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
    reset();
    deps.setPrefs({ ...sanitizePrefs(o.prefs) });
    load(doc);
    st.file = o.entry.file;
    st.id = o.entry.id;
    st.rev = o.entry.rev;
    st.created = o.created;
    st.origin = o.entry.origin;
    st.title = o.entry.title;
    st.readOnly = o.read_only;
    st.savedAt = null;
    docLexicon = o.lexicon;
    // Un lessico diverso da quello con cui è stato salvato: si mostrano i simboli vecchi e si chiede.
    if (deps.lexicon && o.lexicon && o.lexicon !== deps.lexicon && Array.isArray(o.render) && o.render.length > 0 && !o.read_only) {
      setLegacy(view, o.render);
      legacyActive = true;
    }
    deps.setReadOnly(o.read_only);
    deps.banner(o.read_only ? "Questo documento è stato scritto da una versione più recente del programma: si apre solo in lettura. Aggiorna il programma per modificarlo." : null);
    changed();
    refreshLexicon();
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
    newDocument,
    openFile,
    forget: () => {
      st.file = st.id = st.rev = st.created = st.origin = null;
      st.savedAt = null;
      changed();
    },
    startFresh,
    touch: markDirty,
    onChange: (cb) => listeners.push(cb),
  };
}
