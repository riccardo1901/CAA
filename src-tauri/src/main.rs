// Evita la finestra del terminale su Windows nelle build di rilascio.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod custom;
mod docs;

use std::path::PathBuf;
use std::sync::Arc;

use caa_engine::engine::{DocPrefs, Request, UserMemory};
use caa_store::{open_engine, MappedEngine};
use serde::Serialize;
use tauri::http::Response;
use tauri::{Emitter, Manager, State};

use custom::{custom_dir, is_custom, CustomStore, CustomSymbol};
use docs::{docs_dir, DocEntry, DocStore, Opened, SavePayload};

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
    let candidates = data_candidates(env.as_deref(), exe_dir.as_deref(), cwd.as_deref());
    let Some(dir) = find_data_dir(&candidates) else {
        let looked: Vec<String> = candidates.iter().map(|c| c.display().to_string()).collect();
        return Backend {
            custom,
            docs,
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
            engine: Some(engine),
            dir: Some(dir),
            error: None,
        },
        Err(e) => Backend {
            custom,
            docs,
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
                memory: &UserMemory::default(),
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
    let found = engine.alternatives(
        &Request {
            text: &para.text,
            prefs: &prefs,
            forced: &forced,
            sense_locks: &to_locks(&locks),
            memory: &UserMemory::default(),
        },
        (s, e),
    );
    Ok(candidates_dto(&found, &image_check(&state)))
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
fn author_name() -> String {
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
        &author_name(),
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

/// Chiude il programma: la pagina lo chiede dopo aver salvato.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn list_custom_symbols(state: State<'_, Arc<Backend>>) -> Vec<CustomSymbol> {
    state.custom.list()
}

fn main() {
    let backend = Arc::new(load_backend());
    let for_protocol = Arc::clone(&backend);
    tauri::Builder::default()
        .manage(backend)
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
            save_custom_symbol,
            list_custom_symbols,
            doc_list,
            doc_save,
            doc_open,
            doc_delete,
            close_ack,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione");
}

#[cfg(test)]
mod tests {
    use super::must_force_exit;

    #[test]
    fn uscita_forzata_solo_se_la_pagina_non_risponde() {
        assert!(must_force_exit(1, 0)); // nessuna risposta: si esce da soli
        assert!(!must_force_exit(1, 1)); // la pagina sta salvando: si aspetta
        assert!(must_force_exit(2, 1)); // una seconda richiesta senza risposta
        assert!(!must_force_exit(2, 2));
    }
}
