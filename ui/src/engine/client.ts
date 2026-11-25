// Collegamento con il motore (M8). Nell'app (Tauri) i comandi arrivano al motore in Rust; nel browser
// (prove automatiche) non c'è motore e l'editor usa i simboli finti del prototipo o un motore finto.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Un token come lo manda il motore (vedi src-tauri/src/bridge.rs). Offset in unità UTF-16. */
export interface TokenDto {
  s: number;
  e: number;
  kind: "word" | "punct" | "number" | "unknown";
  display: "full" | "reduced" | "text" | "hidden";
  picto: number | null;
  image: boolean;
  /** Segni: 1 plurale, 2 passato, 4 futuro. */
  mods: number;
  group: number;
  head: boolean;
  /** Tipo di gruppo: compound, progressive, pronominal, multiword (vuoto se non c'è). */
  gkind: string;
  confidence: number;
  doubtful: boolean;
  placeholder: boolean;
  /** Lemma e categoria ("NOUN"…) della lettura scelta; vuoti se la parola è sconosciuta. */
  lemma: string;
  cat: string;
  /** La scelta viene dal docente. */
  teacher: boolean;
  /** Perché il motore ha deciso così, in una riga. */
  why: string;
}

/** Una scelta del docente su una parola del paragrafo (picto 0 = nessun simbolo). */
export interface ForcedReq {
  s: number;
  e: number;
  picto: number;
}

/** Un paragrafo con le scelte fatte sulle sue parole. */
export interface ParaReq {
  text: string;
  forced: ForcedReq[];
}

/** Blocco di senso: il lemma (con categoria) prende sempre quel pittogramma. */
export interface LockReq {
  lemma: string;
  cat: string;
  picto: number;
}

/** Un'alternativa del menu (o un risultato di ricerca). */
export interface CandidateDto {
  picto: number;
  keyword: string;
  reason: string;
  /** L'immagine è disponibile nei dati. */
  image: boolean;
}

/** Politica delle parole funzionali: `complete`, `essential` o `custom:articles=reduced;clitics=full;che=text;preps=full;conj=full`. */
export type Policy = string;

/** Cosa si mostra di una categoria: simbolo, simbolo ridotto (solo articoli), solo testo, nascosto. */
export type Rule = "full" | "reduced" | "text" | "hidden";

/** La tabella del preset «Personalizzato». */
export interface PolicyTable {
  articles: Rule;
  clitics: Rule;
  che: Rule;
  preps: Rule;
  conj: Rule;
}

/** Un documento personale nell'elenco (dal manifest del file `.caa`). */
export interface DocEntry {
  file: string;
  id: string;
  title: string;
  modified: string;
  rev: number;
  author: string;
  origin: { id: string; rev: number } | null;
  /** Il file era stato cambiato da un'altra copia del programma: questo documento è stato salvato come nuovo. */
  conflict?: boolean;
  /** La revisione che il documento ha in biblioteca, se è stato pubblicato. */
  published_rev?: number | null;
}

export interface DocList {
  entries: DocEntry[];
  /** File `.caa` che non si leggono (rovinati o ancora in sincronizzazione). */
  broken: number;
  dir: string;
}

/** Quello che si manda per salvare un documento (vedi src-tauri/src/docs.rs). */
export interface SavePayload {
  file: string | null;
  id: string | null;
  rev: number | null;
  title: string;
  created: string | null;
  origin: { id: string; rev: number } | null;
  prefs: unknown;
  sense_locks: unknown;
  document: unknown;
  render: unknown;
  /** Gli `uuid` dei simboli personali usati. */
  media: string[];
  lexicon: string;
}

export interface OpenedDoc {
  entry: DocEntry;
  document: unknown;
  render: unknown;
  prefs: unknown;
  sense_locks: unknown;
  lexicon: string;
  created: string;
  read_only: boolean;
  /** Per ogni simbolo personale del documento, l'id numerico che ha su questo computer. */
  media: Array<{ uuid: string; id: number }>;
}

/** I documenti personali (`Documenti\CAA`): il salvataggio automatico scrive solo qui. */
export interface DocClient {
  list(): Promise<DocList>;
  save(payload: SavePayload): Promise<DocEntry>;
  open(file: string): Promise<OpenedDoc>;
  remove(file: string): Promise<void>;
}

/** Un documento della biblioteca nell'elenco (dal manifest del file nel Drive condiviso). */
export interface LibEntry {
  file: string;
  id: string;
  title: string;
  author: string;
  subject: string;
  level: string;
  tags: string[];
  created: string;
  modified: string;
  rev: number;
  size: number;
  /** Un altro file ha lo stesso identificativo (Drive ha creato una copia «in conflitto»). */
  conflict: boolean;
}

export interface LibStatus {
  /** C'è una cartella scelta (o trovata) per la biblioteca. */
  configured: boolean;
  path: string | null;
  /** Il Drive risponde adesso. */
  reachable: boolean;
  display_name: string;
  /** L'utente del sistema (Windows): serve a sapere se è fra gli amministratori. */
  user: string;
  /** Nomi utente che possono ritirare i documenti degli altri (dal `config.json` del tecnico). */
  admins: string[];
}

export interface LibScan {
  configured: boolean;
  entries: LibEntry[];
  /** File che non si leggono adesso (ancora in sincronizzazione). */
  incomplete: number;
  /** L'elenco viene dall'ultima copia locale, non dal Drive. */
  offline: boolean;
}

/** I dati che il docente scrive quando pubblica. */
export interface PublishMeta {
  title: string;
  subject: string;
  level: string;
  tags: string[];
}

/** Com'è andata una pubblicazione o un aggiornamento. */
export interface PublishOutcome {
  /** `saved_as_new`: la biblioteca era andata avanti, il documento è stato salvato come nuovo. */
  kind: "published" | "updated" | "saved_as_new";
  rev: number;
  /** Il documento personale com'è adesso. */
  entry: DocEntry;
}

/** Una versione più recente del programma, annunciata nel Drive. */
export interface VersionInfo {
  version: string;
  notes: string;
}

/** La biblioteca nel Drive condiviso (cartella sincronizzata da Google Drive per computer). */
export interface LibraryClient {
  status(): Promise<LibStatus>;
  /** Le cartelle `CAA` trovate nei Drive condivisi. */
  find(): Promise<Array<{ path: string; drive: string }>>;
  setFolder(path: string, create: boolean): Promise<LibStatus>;
  scan(): Promise<LibScan>;
  /** Fa una copia personale (in «I miei documenti») di un documento di biblioteca. */
  adapt(file: string): Promise<DocEntry>;
  /** Pubblica un documento personale (mai sopra uno esistente). */
  publish(file: string, meta: PublishMeta): Promise<PublishOutcome>;
  /** Aggiorna in biblioteca (solo l'autore). */
  update(file: string): Promise<PublishOutcome>;
  /** Ritira un documento di biblioteca (l'autore o un amministratore): va in archivio. */
  retire(file: string): Promise<void>;
  /** L'originale di biblioteca, da guardare in sola lettura. */
  open(file: string): Promise<OpenedDoc>;
  /** Una versione più recente del programma, se il Drive la annuncia. */
  version(): Promise<VersionInfo | null>;
}

export interface EngineInfo {
  ok: boolean;
  dir: string | null;
  error: string | null;
  tagger: boolean;
  expressions: boolean;
  /** Versione del lessico del programma. */
  lexicon?: string;
}

/** Un simbolo personale importato dal docente (immagine salvata sul computer). */
export interface CustomSymbol {
  /** Numero che il motore tratta come un pittogramma (da 2^31 in su). */
  id: number;
  uuid: string;
  /** La parola per cui è stato importato (minuscola). */
  label: string;
}

/** Una voce della memoria del docente («usa sempre»): per lemma e categoria, oppure solo per forma. */
export interface MemoryEntry {
  lemma: string;
  cat: string;
  form: string;
  picto: number;
}

export interface MemoryClient {
  list(): Promise<MemoryEntry[]>;
  add(entry: MemoryEntry): Promise<void>;
  forget(entry: MemoryEntry): Promise<void>;
  clear(): Promise<void>;
}

/** Un simbolo condiviso dalla scuola. */
export interface SharedSymbol {
  uuid: string;
  label: string;
  author: string;
  /** L'utente può ritirarlo (è suo, o è amministratore). */
  can_retire: boolean;
}

export interface SharedList {
  configured: boolean;
  reachable: boolean;
  symbols: SharedSymbol[];
}

export interface SharedClient {
  share(uuid: string): Promise<SharedSymbol>;
  list(): Promise<SharedList>;
  /** Copia il simbolo nella raccolta di questo computer e lo restituisce (con l'id locale). */
  take(uuid: string): Promise<CustomSymbol>;
  retire(uuid: string): Promise<void>;
}

/** Quello che serve all'editor per parlare con il motore. */
export interface EngineClient {
  symbolize(paras: ParaReq[], policy: Policy, locks: LockReq[]): Promise<TokenDto[][]>;
  /** Le alternative per la parola [s, e) del paragrafo. */
  alternatives(para: ParaReq, policy: Policy, locks: LockReq[], s: number, e: number): Promise<CandidateDto[]>;
  /** Ricerca libera di un pittogramma. */
  search(query: string): Promise<CandidateDto[]>;
  /** I documenti personali; assente nelle prove senza archivio. */
  docs?: DocClient;
  /** La biblioteca nel Drive condiviso e il nome da mostrare; assenti nelle prove senza archivio. */
  library?: LibraryClient;
  /** I simboli della scuola nel Drive (M9c-2); assenti nelle prove senza biblioteca. */
  shared?: SharedClient;
  /** Toglie un simbolo personale dalla raccolta di questo computer. */
  deleteCustom?(uuid: string): Promise<void>;
  /** La memoria del docente (M9c-1); assente nelle prove senza archivio. */
  memory?: MemoryClient;
  settings?: { getName(): Promise<string>; setName(name: string): Promise<string> };
  /** I simboli personali già importati. */
  listCustom(): Promise<CustomSymbol[]>;
  /** Salva un simbolo personale (immagine WebP quadrata) per la parola indicata. */
  importCustom(image: Blob, label: string): Promise<CustomSymbol>;
  /** Indirizzo dell'immagine di un pittogramma. */
  url(picto: number): string;
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function tauriClient(): EngineClient {
  return {
    symbolize: (paras, policy, locks) => invoke<TokenDto[][]>("symbolize", { paras, policy, locks }),
    alternatives: (para, policy, locks, s, e) => invoke<CandidateDto[]>("alternatives", { para, policy, locks, s, e }),
    search: (query) => invoke<CandidateDto[]>("search_pictos", { query }),
    docs: {
      list: () => invoke<DocList>("doc_list"),
      save: (payload) => invoke<DocEntry>("doc_save", { payload }),
      open: (file) => invoke<OpenedDoc>("doc_open", { file }),
      remove: (file) => invoke<void>("doc_delete", { file }),
    },
    library: {
      status: () => invoke<LibStatus>("library_status"),
      find: () => invoke<Array<{ path: string; drive: string }>>("library_find"),
      setFolder: (path, create) => invoke<LibStatus>("library_set_folder", { path, create }),
      scan: () => invoke<LibScan>("library_scan"),
      adapt: (file) => invoke<DocEntry>("library_adapt", { file }),
      publish: (file, meta) => invoke<PublishOutcome>("library_publish", { file, meta }),
      update: (file) => invoke<PublishOutcome>("library_update", { file }),
      retire: (file) => invoke<void>("library_retire", { file }),
      open: (file) => invoke<OpenedDoc>("library_open", { file }),
      version: () => invoke<VersionInfo | null>("library_version"),
    },
    settings: {
      getName: () => invoke<string>("settings_get"),
      setName: (name) => invoke<string>("settings_set_name", { name }),
    },
    listCustom: () => invoke<CustomSymbol[]>("list_custom_symbols"),
    deleteCustom: (uuid) => invoke<void>("custom_symbol_delete", { uuid }),
    shared: {
      share: (uuid) => invoke<SharedSymbol>("shared_symbol_share", { uuid }),
      list: () => invoke<SharedList>("shared_symbols"),
      take: (uuid) => invoke<CustomSymbol>("shared_symbol_import", { uuid }),
      retire: (uuid) => invoke<void>("shared_symbol_retire", { uuid }),
    },
    memory: {
      list: () => invoke<MemoryEntry[]>("memory_list"),
      add: (entry) => invoke<void>("memory_add", { entry }),
      forget: (entry) => invoke<void>("memory_forget", { entry }),
      clear: () => invoke<void>("memory_clear"),
    },
    importCustom: async (image, label) =>
      invoke<CustomSymbol>("save_custom_symbol", new Uint8Array(await image.arrayBuffer()), {
        headers: { "x-label": encodeURIComponent(label) },
      }),
    url: (picto) => convertFileSrc(String(picto), "picto"),
  };
}

export function engineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("engine_info");
}
