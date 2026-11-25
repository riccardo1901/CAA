// Evita la finestra del terminale su Windows nelle build di rilascio.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod custom;

use std::path::PathBuf;
use std::sync::Arc;

use caa_engine::engine::{DocPrefs, Request, UserMemory};
use caa_store::{open_engine, MappedEngine};
use serde::Serialize;
use tauri::http::Response;
use tauri::State;

use custom::{custom_dir, is_custom, CustomStore, CustomSymbol};

use bridge::{
    candidates_dto, check_choices, check_request, data_candidates, find_data_dir, image_path,
    parse_picto_path, parse_policy, to_dto, to_forced, to_locks, CandidateDto, LockDto, ParaDto,
    TokenDto, SEARCH_LIMIT,
};

/// Il motore e la cartella dei dati, caricati una volta all'avvio.
struct Backend {
    /// I simboli personali del docente (M8c-3), in una cartella locale.
    custom: CustomStore,
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
    let candidates = data_candidates(env.as_deref(), exe_dir.as_deref(), cwd.as_deref());
    let Some(dir) = find_data_dir(&candidates) else {
        let looked: Vec<String> = candidates.iter().map(|c| c.display().to_string()).collect();
        return Backend {
            custom,
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
            engine: Some(engine),
            dir: Some(dir),
            error: None,
        },
        Err(e) => Backend {
            custom,
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
}

#[tauri::command]
fn engine_info(state: State<'_, Arc<Backend>>) -> EngineInfo {
    EngineInfo {
        ok: state.engine.is_some(),
        dir: state.dir.as_ref().map(|d| d.display().to_string()),
        error: state.error.clone(),
        tagger: state.engine.as_ref().is_some_and(|e| e.tagger().is_some()),
        expressions: state.engine.as_ref().is_some_and(|e| e.mwe().is_some()),
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

#[tauri::command]
fn list_custom_symbols(state: State<'_, Arc<Backend>>) -> Vec<CustomSymbol> {
    state.custom.list()
}

fn main() {
    let backend = Arc::new(load_backend());
    let for_protocol = Arc::clone(&backend);
    tauri::Builder::default()
        .manage(backend)
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
            list_custom_symbols
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione");
}
