// Evita la finestra del terminale su Windows nelle build di rilascio.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod corrections;
mod custom;
mod docs;
mod library;
mod memory;

use std::path::PathBuf;
use std::sync::Arc;

use caa_engine::engine::{DocPrefs, Request};
use caa_store::{open_engine, MappedEngine};
use serde::Serialize;
use tauri::http::Response;
use tauri::{Emitter, Manager, State};

use corrections::CorrectionStore;
use custom::{app_dir, custom_dir, is_custom, CustomStore, CustomSymbol};
use docs::{docs_dir, DocEntry, DocStore, Opened, SavePayload};
use library::{
    os_user, FolderDto, LibScanView, LibStatus, LibraryState, PublishMeta, PublishOutcome,
    VersionInfo,
};
use memory::{MemoryEntry, MemoryStore};

use bridge::{
    candidates_dto, check_choices, check_request, data_candidates, find_data_dir, image_path,
    parse_picto_path, parse_policy, to_dto, to_forced, to_locks, CandidateDto, LockDto, ParaDto,
    TokenDto, SEARCH_LIMIT,
};

/// Il motore e la cartella dei dati, caricati una volta all'avvio.
struct Backend {
    /// I simboli personali del docente (M8c-3), in una cartella locale.
    custom: CustomStore,
    /// I documenti personali (M9a).
    docs: DocStore,
    /// Impostazioni, biblioteca nel Drive condiviso e sua copia locale (M9b).
    library: LibraryState,
    /// Cosa il docente ha scelto «per sempre» (M9c-1).
    memory: MemoryStore,
    /// Il registro locale delle correzioni anonime (M9c-3).
    corrections: CorrectionStore,
    engine: Option<MappedEngine>,
    dir: Option<PathBuf>,
    error: Option<String>,
}

fn load_backend() -> Backend {
    let env = std::env::var("CAA_DATA").ok();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from));
    let cwd = std::env::current_dir().ok();
    let custom = CustomStore::open(custom_dir(
        std::env::var("CAA_CUSTOM").ok().as_deref(),
        std::env::var("APPDATA").ok().as_deref(),
        std::env::var("XDG_DATA_HOME")
            .ok()
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| format!("{h}/.local/share"))
            })
            .as_deref(),
        exe_dir.as_deref(),
    ));
    let docs = DocStore::new(docs_dir(
        std::env::var("CAA_DOCS").ok().as_deref(),
        std::env::var("USERPROFILE").ok().as_deref(),
        std::env::var("HOME").ok().as_deref(),
        exe_dir.as_deref(),
    ));
    let xdg_or_home = std::env::var("XDG_DATA_HOME").ok().or_else(|| {
        std::env::var("HOME")
            .ok()
            .map(|h| format!("{h}/.local/share"))
    });
    let data_dir = app_dir(
        std::env::var("CAA_APPDATA").ok().as_deref(),
        std::env::var("APPDATA").ok().as_deref(),
        xdg_or_home.as_deref(),
        exe_dir.as_deref(),
    );
    let memory = MemoryStore::open(&data_dir);
    let corrections = CorrectionStore::new(&data_dir);
    let library = LibraryState::new(
        data_dir,
        caa_lib::config::load_config(&caa_lib::config::config_path(
            std::env::var("CAA_CONFIG").ok().as_deref(),
            std::env::var("PROGRAMDATA").ok().as_deref(),
        )),
        caa_lib::detect::drive_roots(),
    );
    let candidates = data_candidates(env.as_deref(), exe_dir.as_deref(), cwd.as_deref());
    let Some(dir) = find_data_dir(&candidates) else {
        let looked: Vec<String> = candidates.iter().map(|c| c.display().to_string()).collect();
        return Backend {
            custom,
            docs,
            library,
            memory,
            corrections,
            engine: None,
            dir: None,
            error: Some(format!(
                "Non trovo la cartella dei dati. Cercata in: {}",
                looked.join("; ")
            )),
        };
    };
    match open_engine(&dir) {
        Ok(engine) => Backend {
            custom,
            docs,
            library,
            memory,
            corrections,
            engine: Some(engine),
            dir: Some(dir),
            error: None,
        },
        Err(e) => Backend {
            custom,
            docs,
            library,
            memory,
            corrections,
            engine: None,
            dir: Some(dir),
            error: Some(e.to_string()),
        },
    }
}

#[derive(Serialize)]
struct EngineInfo {
    ok: bool,
    dir: Option<String>,
    error: Option<String>,
    tagger: bool,
    expressions: bool,
    /// Versione del lessico (serve a sapere se un documento è stato salvato con un lessico diverso).
    lexicon: String,
}

#[tauri::command]
fn engine_info(state: State<'_, Arc<Backend>>) -> EngineInfo {
    EngineInfo {
        ok: state.engine.is_some(),
        dir: state.dir.as_ref().map(|d| d.display().to_string()),
        error: state.error.clone(),
        tagger: state.engine.as_ref().is_some_and(|e| e.tagger().is_some()),
        expressions: state.engine.as_ref().is_some_and(|e| e.mwe().is_some()),
        lexicon: state
            .engine
            .as_ref()
            .map(|e| format!("{:016x}", e.morph().build_id()))
            .unwrap_or_default(),
    }
}

fn engine_of(state: &Backend) -> Result<&MappedEngine, String> {
    state.engine.as_ref().ok_or_else(|| {
        state
            .error
            .clone()
            .unwrap_or_else(|| "motore non caricato".into())
    })
}

/// Il file dell'immagine di un pittogramma ARASAAC o di un simbolo personale.
fn resolve_image(state: &Backend, id: u32) -> Option<PathBuf> {
    if is_custom(id) {
        state.custom.path_of(id)
    } else {
        state.dir.as_ref().map(|d| image_path(d, id))
    }
}

fn image_check(state: &Backend) -> impl Fn(u32) -> bool + '_ {
    move |id: u32| resolve_image(state, id).is_some_and(|p| p.is_file())
}

/// Simbolizza più paragrafi in una chiamata sola. `async`: il comando gira su un thread a parte e non
/// blocca l'interfaccia mentre il motore lavora (con testi lunghi richiede decine di millisecondi).
/// `paras` porta le scelte del docente per paragrafo, `locks` i blocchi di senso del documento.
#[tauri::command(async)]
fn symbolize(
    state: State<'_, Arc<Backend>>,
    paras: Vec<ParaDto>,
    policy: String,
    locks: Vec<LockDto>,
) -> Result<Vec<Vec<TokenDto>>, String> {
    let texts: Vec<String> = paras.iter().map(|p| p.text.clone()).collect();
    check_request(&texts)?;
    check_choices(paras.iter().map(|p| p.forced.len()).sum(), locks.len())?;
    let engine = engine_of(&state)?;
    let prefs = DocPrefs {
        function_policy: parse_policy(&policy),
    };
    let sense_locks = to_locks(&locks);
    let memory = state.memory.snapshot();
    let has_image = image_check(&state);
    Ok(paras
        .iter()
        .map(|p| {
            let forced = to_forced(&p.forced);
            let tokens = engine.symbolize(&Request {
                text: &p.text,
                prefs: &prefs,
                forced: &forced,
                sense_locks: &sense_locks,
                memory: &memory,
            });
            to_dto(&tokens, &has_image)
        })
        .collect())
}

/// Le alternative per la parola `[s, e)` del paragrafo (menu del simbolo), con le scelte attuali.
#[tauri::command(async)]
fn alternatives(
    state: State<'_, Arc<Backend>>,
    para: ParaDto,
    policy: String,
    locks: Vec<LockDto>,
    s: u32,
    e: u32,
) -> Result<Vec<CandidateDto>, String> {
    check_request(std::slice::from_ref(&para.text))?;
    check_choices(para.forced.len(), locks.len())?;
    let engine = engine_of(&state)?;
    let prefs = DocPrefs {
        function_policy: parse_policy(&policy),
    };
    let forced = to_forced(&para.forced);
    let memory = state.memory.snapshot();
    let found = engine.alternatives(
        &Request {
            text: &para.text,
            prefs: &prefs,
            forced: &forced,
            sense_locks: &to_locks(&locks),
            memory: &memory,
        },
        (s, e),
    );
    Ok(candidates_dto(&found, &image_check(&state)))
}

/// La memoria del docente: elenco, aggiunta («usa sempre»), voce dimenticata, tutto dimenticato.
#[tauri::command]
fn memory_list(state: State<'_, Arc<Backend>>) -> Vec<MemoryEntry> {
    state.memory.list()
}

#[tauri::command]
fn memory_add(state: State<'_, Arc<Backend>>, entry: MemoryEntry) -> Result<(), String> {
    state.memory.add(entry)
}

#[tauri::command]
fn memory_forget(state: State<'_, Arc<Backend>>, entry: MemoryEntry) -> Result<(), String> {
    state.memory.forget(&entry)
}

#[tauri::command]
fn memory_clear(state: State<'_, Arc<Backend>>) -> Result<(), String> {
    state.memory.clear()
}

#[derive(Serialize)]
struct CorrectionsInfo {
    enabled: bool,
    pending: usize,
}

#[derive(serde::Deserialize)]
struct CorrectionDto {
    text: String,
    s: u32,
    e: u32,
    lemma: String,
    cat: String,
    picto: u32,
    auto: u32,
}

/// Registra una scelta del docente come riga anonima (se la raccolta è accesa e la parola è adatta).
#[tauri::command]
fn correction_log(state: State<'_, Arc<Backend>>, entry: CorrectionDto) -> Result<(), String> {
    if !state.library.corrections_enabled() || entry.text.len() > 20_000 {
        return Ok(());
    }
    match caa_lib::corrections::make(
        &entry.text,
        entry.s,
        entry.e,
        &entry.lemma,
        &entry.cat,
        entry.picto,
        entry.auto,
    ) {
        Some(c) => state.corrections.log(&c),
        None => Ok(()),
    }
}

#[tauri::command]
fn corrections_info(state: State<'_, Arc<Backend>>) -> CorrectionsInfo {
    CorrectionsInfo {
        enabled: state.library.corrections_enabled(),
        pending: state.corrections.pending().len(),
    }
}

/// Le prime righe da inviare, così il docente vede cosa parte.
#[tauri::command]
fn corrections_preview(state: State<'_, Arc<Backend>>) -> Vec<String> {
    state.corrections.pending().into_iter().take(30).collect()
}

#[tauri::command]
fn corrections_set_enabled(state: State<'_, Arc<Backend>>, on: bool) -> Result<(), String> {
    state.library.set_corrections_enabled(on)
}

/// Butta via le correzioni raccolte (senza inviarle).
#[tauri::command]
fn corrections_discard(state: State<'_, Arc<Backend>>) -> Result<(), String> {
    let _turn = state.corrections.begin_exclusive()?;
    let n = state.corrections.pending().len();
    state.corrections.drop_first(n)
}

/// Invia le correzioni al Drive; se riesce le toglie dal registro locale (restano quelle nuove).
#[tauri::command(async)]
fn corrections_send(state: State<'_, Arc<Backend>>) -> Result<usize, String> {
    let _turn = state.corrections.begin_exclusive()?;
    let lines = state.corrections.pending();
    let id = state.corrections.anon_id()?;
    state.library.send_corrections(&lines, &id)?;
    state.corrections.drop_first(lines.len())?;
    Ok(lines.len())
}

/// Simboli personali: cancellazione dalla raccolta di questo computer.
#[tauri::command]
fn custom_symbol_delete(state: State<'_, Arc<Backend>>, uuid: String) -> Result<(), String> {
    let id = state
        .custom
        .list()
        .into_iter()
        .find(|s| s.uuid == uuid)
        .map(|s| s.id);
    state.custom.delete(&uuid)?;
    // Le scelte «per sempre» che puntavano a quel simbolo non devono restare appese.
    if let Some(id) = id {
        state.memory.forget_picto(id)?;
    }
    Ok(())
}

/// Simboli della scuola (`simboli\` nel Drive): condividi, elenco, prendi, ritira.
#[tauri::command(async)]
fn shared_symbol_share(
    state: State<'_, Arc<Backend>>,
    uuid: String,
) -> Result<library::SharedDto, String> {
    state
        .library
        .share_symbol(&uuid, &state.custom, &author_name(&state), &os_user())
}

#[tauri::command(async)]
fn shared_symbols(state: State<'_, Arc<Backend>>) -> library::SharedList {
    state
        .library
        .shared_symbols(&author_name(&state), &os_user())
}

#[tauri::command(async)]
fn shared_symbol_import(
    state: State<'_, Arc<Backend>>,
    uuid: String,
) -> Result<CustomSymbol, String> {
    state.library.import_shared(&uuid, &state.custom)
}

#[tauri::command(async)]
fn shared_symbol_retire(state: State<'_, Arc<Backend>>, uuid: String) -> Result<(), String> {
    state
        .library
        .retire_shared(&uuid, &author_name(&state), &os_user())
}

/// "Cerca…" nel menu: pittogrammi per parola chiave (esatta o per inizio di parola).
#[tauri::command(async)]
fn search_pictos(
    state: State<'_, Arc<Backend>>,
    query: String,
) -> Result<Vec<CandidateDto>, String> {
    if query.len() > 200 {
        return Err("ricerca troppo lunga".into());
    }
    let engine = engine_of(&state)?;
    let found = engine.search_pictos(&query, SEARCH_LIMIT);
    Ok(candidates_dto(&found, &image_check(&state)))
}

/// Salva un simbolo personale: il corpo della richiesta è l'immagine WebP (già ritagliata e
/// ridimensionata dalla pagina), l'intestazione `x-label` la parola per cui è stato importato.
#[tauri::command]
fn save_custom_symbol(
    state: State<'_, Arc<Backend>>,
    request: tauri::ipc::Request<'_>,
) -> Result<CustomSymbol, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("immagine non ricevuta".into());
    };
    let label = request
        .headers()
        .get("x-label")
        .and_then(|v| v.to_str().ok())
        .map(bridge::percent_decode)
        .unwrap_or_default();
    state.custom.save(bytes, &label)
}

/// Chi scrive: il nome dell'utente del sistema (con M9b il nome scelto al primo avvio).
fn author_name(state: &Backend) -> String {
    // Il nome scelto al primo avvio; senza, quello dell'utente del sistema.
    let chosen = state.library.display_name();
    if !chosen.is_empty() {
        return chosen;
    }
    ["USERNAME", "USER"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .unwrap_or_else(|| "docente".into())
}

#[derive(Serialize)]
struct DocList {
    entries: Vec<DocEntry>,
    /// File `.caa` che non si leggono (rovinati o ancora in sincronizzazione).
    broken: usize,
    dir: String,
}

#[tauri::command]
fn doc_list(state: State<'_, Arc<Backend>>) -> DocList {
    let (entries, broken) = state.docs.list();
    DocList {
        entries,
        broken,
        dir: state.docs.dir().display().to_string(),
    }
}

/// Salva un documento (anche il salvataggio automatico): atomico, nella cartella dei documenti personali.
#[tauri::command(async)]
fn doc_save(state: State<'_, Arc<Backend>>, payload: SavePayload) -> Result<DocEntry, String> {
    state.docs.save(
        payload,
        &state.custom,
        &author_name(&state),
        env!("CARGO_PKG_VERSION"),
    )
}

#[tauri::command(async)]
fn doc_open(state: State<'_, Arc<Backend>>, file: String) -> Result<Opened, String> {
    state.docs.open(&file, &state.custom)
}

#[tauri::command]
fn doc_delete(state: State<'_, Arc<Backend>>, file: String) -> Result<(), String> {
    state.docs.delete(&file)
}

/// Le richieste di chiusura della finestra e quelle a cui la pagina ha risposto (vedi `on_window_event`).
static CLOSE_REQUESTS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static CLOSE_ACKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Se la pagina non ha risposto a una richiesta di chiusura, il programma esce da solo (la pagina è bloccata o
/// rotta); se ha risposto, aspetta che abbia finito di salvare, anche più di qualche secondo.
fn must_force_exit(requested: u64, acked: u64) -> bool {
    acked < requested
}

/// La pagina conferma di aver ricevuto la richiesta di chiusura e sta salvando: niente uscita forzata.
#[tauri::command]
fn close_ack() {
    use std::sync::atomic::Ordering;
    CLOSE_ACKED.store(CLOSE_REQUESTS.load(Ordering::SeqCst), Ordering::SeqCst);
}

/// Le impostazioni dell'utente: il nome da mostrare (vuoto finché non si sceglie al primo avvio).
#[tauri::command]
fn settings_get(state: State<'_, Arc<Backend>>) -> String {
    state.library.display_name()
}

#[tauri::command]
fn settings_set_name(state: State<'_, Arc<Backend>>, name: String) -> Result<String, String> {
    state.library.set_display_name(&name)
}

/// La biblioteca: stato (cartella, raggiungibile), cartelle trovate, scelta, elenco, adattamento. I comandi che
/// toccano il Drive sono `async`: girano su un thread a parte e hanno un tempo massimo.
#[tauri::command(async)]
fn library_status(state: State<'_, Arc<Backend>>) -> LibStatus {
    state.library.status()
}

#[tauri::command(async)]
fn library_find(state: State<'_, Arc<Backend>>) -> Vec<FolderDto> {
    state
        .library
        .candidates()
        .into_iter()
        .map(|c| FolderDto {
            path: c.path.to_string_lossy().to_string(),
            drive: c.drive,
        })
        .collect()
}

#[tauri::command(async)]
fn library_set_folder(
    state: State<'_, Arc<Backend>>,
    path: String,
    create: bool,
) -> Result<LibStatus, String> {
    state.library.set_folder(&path, create)?;
    Ok(state.library.status())
}

#[tauri::command(async)]
fn library_scan(state: State<'_, Arc<Backend>>) -> LibScanView {
    // Con il permesso di ritirare ogni documento (K1): stessi nomi che usa `library_retire`.
    state.library.scan_for(&author_name(&state), &os_user())
}

#[tauri::command(async)]
fn library_adapt(state: State<'_, Arc<Backend>>, file: String) -> Result<DocEntry, String> {
    state
        .library
        .adapt(&file, &state.docs, &author_name(&state))
}

#[tauri::command(async)]
fn library_publish(
    state: State<'_, Arc<Backend>>,
    file: String,
    meta: PublishMeta,
) -> Result<PublishOutcome, String> {
    state
        .library
        .publish(&file, &meta, &state.docs, &author_name(&state), &os_user())
}

#[tauri::command(async)]
fn library_update(state: State<'_, Arc<Backend>>, file: String) -> Result<PublishOutcome, String> {
    state
        .library
        .update(&file, &state.docs, &author_name(&state), &os_user())
}

#[tauri::command(async)]
fn library_retire(state: State<'_, Arc<Backend>>, file: String) -> Result<(), String> {
    state
        .library
        .retire(&file, &author_name(&state), &os_user())
}

/// L'originale di una biblioteca per guardarlo (sola lettura).
#[tauri::command(async)]
fn library_open(state: State<'_, Arc<Backend>>, file: String) -> Result<Opened, String> {
    state.library.open_original(&file, &state.custom)
}

/// Se il Drive annuncia una versione del programma più recente.
#[tauri::command(async)]
fn library_version(state: State<'_, Arc<Backend>>) -> Option<VersionInfo> {
    state.library.newer_version(env!("CARGO_PKG_VERSION"))
}

/// Chiude il programma: la pagina lo chiede dopo aver salvato.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn list_custom_symbols(state: State<'_, Arc<Backend>>) -> Vec<CustomSymbol> {
    state.custom.list()
}

/// La misura della finestra all'avvio (M11-4, K12): l'85% dello schermo in larghezza e in altezza (in punti, cioè
/// già divisi per il «ridimensionamento» di Windows), mai sotto il minimo e mai più grande dello schermo.
fn dimensione_iniziale(schermo_l: f64, schermo_a: f64) -> (f64, f64) {
    const MIN_L: f64 = 800.0;
    const MIN_A: f64 = 500.0;
    let l = (schermo_l * 0.85).max(MIN_L.min(schermo_l));
    let a = (schermo_a * 0.85).max(MIN_A.min(schermo_a));
    (l.round(), a.round())
}

/// All'avvio la finestra (nascosta nella configurazione) prende la sua misura dallo schermo su cui si apre, si centra
/// e solo allora si mostra. Se qualcosa non va, si mostra comunque con la misura della configurazione.
fn prepara_finestra(app: &tauri::App) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let schermo = match win.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => win.primary_monitor().ok().flatten(),
    };
    if let Some(m) = schermo {
        let scala = if m.scale_factor() > 0.0 {
            m.scale_factor()
        } else {
            1.0
        };
        let (l, a) = dimensione_iniziale(
            m.size().width as f64 / scala,
            m.size().height as f64 / scala,
        );
        let _ = win.set_size(tauri::LogicalSize::new(l, a));
        let _ = win.center();
    }
    let _ = win.show();
}

fn main() {
    let backend = Arc::new(load_backend());
    let for_protocol = Arc::clone(&backend);
    tauri::Builder::default()
        .manage(backend)
        .setup(|app| {
            prepara_finestra(app);
            Ok(())
        })
        // Chiudere la finestra non chiude subito: la pagina salva il documento e poi chiede di uscire. Se la
        // pagina non risponde (errore, blocco) il programma esce comunque dopo qualche secondo.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use std::sync::atomic::Ordering;
                api.prevent_close();
                let n = CLOSE_REQUESTS.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = window.emit("caa-close-request", ());
                let handle = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    if must_force_exit(n, CLOSE_ACKED.load(Ordering::SeqCst)) {
                        handle.exit(0);
                    }
                });
            }
        })
        // Le immagini dei pittogrammi: picto://localhost/<id> (su Windows http://picto.localhost/<id>).
        .register_uri_scheme_protocol("picto", move |_ctx, request| {
            let bytes = parse_picto_path(request.uri().path())
                .and_then(|id| resolve_image(&for_protocol, id))
                .and_then(|path| std::fs::read(path).ok());
            match bytes {
                Some(b) => Response::builder()
                    .header("Content-Type", "image/webp")
                    .header("Cache-Control", "max-age=86400")
                    .body(b)
                    .unwrap_or_else(|_| Response::new(Vec::new())),
                None => Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap_or_else(|_| Response::new(Vec::new())),
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine_info,
            symbolize,
            alternatives,
            search_pictos,
            memory_list,
            memory_add,
            memory_forget,
            memory_clear,
            custom_symbol_delete,
            correction_log,
            corrections_info,
            corrections_preview,
            corrections_set_enabled,
            corrections_discard,
            corrections_send,
            shared_symbol_share,
            shared_symbols,
            shared_symbol_import,
            shared_symbol_retire,
            save_custom_symbol,
            list_custom_symbols,
            doc_list,
            doc_save,
            doc_open,
            doc_delete,
            close_ack,
            settings_get,
            settings_set_name,
            library_status,
            library_find,
            library_set_folder,
            library_scan,
            library_adapt,
            library_publish,
            library_update,
            library_retire,
            library_open,
            library_version,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione");
}

#[cfg(test)]
mod tests {
    use super::{dimensione_iniziale, must_force_exit};

    #[test]
    fn la_finestra_parte_all_85_per_cento_dello_schermo() {
        // Portatile 1366×768 al 100%.
        assert_eq!(dimensione_iniziale(1366.0, 768.0), (1161.0, 653.0));
        // Full HD al 150% (1280×720 punti).
        assert_eq!(dimensione_iniziale(1280.0, 720.0), (1088.0, 612.0));
        // Schermo piccolissimo: almeno il minimo, ma mai più grande dello schermo.
        assert_eq!(dimensione_iniziale(900.0, 560.0), (800.0, 500.0));
        assert_eq!(dimensione_iniziale(700.0, 450.0), (700.0, 450.0));
        // 4K al 100%: grande, ma sempre l'85%.
        assert_eq!(dimensione_iniziale(3840.0, 2160.0), (3264.0, 1836.0));
    }

    #[test]
    fn uscita_forzata_solo_se_la_pagina_non_risponde() {
        assert!(must_force_exit(1, 0)); // nessuna risposta: si esce da soli
        assert!(!must_force_exit(1, 1)); // la pagina sta salvando: si aspetta
        assert!(must_force_exit(2, 1)); // una seconda richiesta senza risposta
        assert!(!must_force_exit(2, 2));
    }
}
