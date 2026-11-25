//! Configurazione del tecnico (`config.json` in `ProgramData`) e impostazioni dell'utente.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Il file che il tecnico mette una volta sola per tutti i PC: dove sta la biblioteca (per nome del Drive
/// condiviso e della cartella, perché la lettera dell'unità cambia da PC a PC) e chi può ritirare i
/// documenti degli altri. Tutto facoltativo; un file mancante o illeggibile vale come vuoto.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct SharedConfig {
    /// Un percorso completo (per prove o per cartelle che non sono un Drive condiviso).
    pub library_path: Option<String>,
    /// Il nome del Drive condiviso in cui cercare (es. `CAA Istituto`).
    pub drive_name: Option<String>,
    /// Il nome della cartella dentro il Drive (predefinito `CAA`).
    pub folder: Option<String>,
    /// Nomi utente (di Windows) che possono ritirare documenti altrui.
    pub admins: Vec<String>,
}

pub fn load_config(path: &Path) -> SharedConfig {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Le impostazioni dell'utente, in `%APPDATA%\Editor CAA\settings.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Il nome da mostrare (autore dei documenti pubblicati), scelto al primo avvio.
    pub display_name: String,
    /// La cartella della biblioteca scelta da questo utente.
    pub library_path: Option<String>,
}

const SETTINGS_FILE: &str = "settings.json";

/// Legge le impostazioni; mancanti o rovinate = quelle di partenza (un file rovinato si mette da parte).
pub fn load_settings(dir: &Path) -> Settings {
    let path = dir.join(SETTINGS_FILE);
    match std::fs::read(&path) {
        Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|_| {
            let _ = std::fs::rename(&path, dir.join("settings.json.bad"));
            Settings::default()
        }),
        Err(_) => Settings::default(),
    }
}

/// Scrive le impostazioni in modo atomico (file temporaneo e rinomina).
pub fn save_settings(dir: &Path, s: &Settings) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(SETTINGS_FILE);
    let tmp = dir.join(format!("{SETTINGS_FILE}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(s).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, &path)
}

/// Un nome da mostrare pulito: senza caratteri di controllo, spazi doppi o troppo lungo.
pub fn clean_display_name(name: &str) -> String {
    let one_line: String = name.chars().filter(|c| !c.is_control()).collect();
    one_line
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(60)
        .collect()
}

/// Dove sta il `config.json` del tecnico: la variabile `CAA_CONFIG`, altrimenti `ProgramData\CAA\config.json`
/// (Windows) o `/etc/caa/config.json`.
pub fn config_path(env: Option<&str>, programdata: Option<&str>) -> PathBuf {
    if let Some(e) = env.filter(|e| !e.is_empty()) {
        return PathBuf::from(e);
    }
    match programdata.filter(|p| !p.is_empty()) {
        Some(p) => Path::new(p).join("CAA").join("config.json"),
        None => PathBuf::from("/etc/caa/config.json"),
    }
}
