// Evita la finestra del terminale su Windows nelle build di rilascio.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;

use std::path::PathBuf;
use std::sync::Arc;

use caa_engine::engine::{DocPrefs, ForcedPick, Request, SenseLocks, UserMemory};
use caa_store::{open_engine, MappedEngine};
use serde::Serialize;
use tauri::http::Response;
use tauri::State;

use bridge::{
    check_request, data_candidates, find_data_dir, image_path, parse_picto_path, parse_policy,
    to_dto, TokenDto,
};

/// Il motore e la cartella dei dati, caricati una volta all'avvio.
struct Backend {
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
    let candidates = data_candidates(env.as_deref(), exe_dir.as_deref(), cwd.as_deref());
    let Some(dir) = find_data_dir(&candidates) else {
        let looked: Vec<String> = candidates.iter().map(|c| c.display().to_string()).collect();
        return Backend {
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
            engine: Some(engine),
            dir: Some(dir),
            error: None,
        },
        Err(e) => Backend {
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

/// Simbolizza più paragrafi in una chiamata sola. `async`: il comando gira su un thread a parte e non
/// blocca l'interfaccia mentre il motore lavora (con testi lunghi richiede decine di millisecondi).
#[tauri::command(async)]
fn symbolize(
    state: State<'_, Arc<Backend>>,
    texts: Vec<String>,
    policy: String,
) -> Result<Vec<Vec<TokenDto>>, String> {
    check_request(&texts)?;
    let engine = state.engine.as_ref().ok_or_else(|| {
        state
            .error
            .clone()
            .unwrap_or_else(|| "motore non caricato".into())
    })?;
    let dir = state.dir.clone();
    let prefs = DocPrefs {
        function_policy: parse_policy(&policy),
    };
    let has_image = move |id: u32| dir.as_ref().is_some_and(|d| image_path(d, id).is_file());
    Ok(texts
        .iter()
        .map(|text| {
            let tokens = engine.symbolize(&Request {
                text,
                prefs: &prefs,
                forced: &[] as &[ForcedPick],
                sense_locks: &SenseLocks::default(),
                memory: &UserMemory::default(),
            });
            to_dto(&tokens, &has_image)
        })
        .collect())
}

fn main() {
    let backend = Arc::new(load_backend());
    let for_protocol = Arc::clone(&backend);
    tauri::Builder::default()
        .manage(backend)
        // Le immagini dei pittogrammi: picto://localhost/<id> (su Windows http://picto.localhost/<id>).
        .register_uri_scheme_protocol("picto", move |_ctx, request| {
            let bytes = parse_picto_path(request.uri().path())
                .zip(for_protocol.dir.as_ref())
                .and_then(|(id, dir)| std::fs::read(image_path(dir, id)).ok());
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
        .invoke_handler(tauri::generate_handler![engine_info, symbolize])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione");
}
