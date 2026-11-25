//! Trovare la cartella della biblioteca: ogni PC ha Google Drive per computer, che di solito mostra i Drive
//! condivisi in `<lettera>:\Drive condivisi\<nome del Drive>\` (in inglese `Shared drives`).

use std::path::{Path, PathBuf};

use crate::config::SharedConfig;

/// Le sottocartelle di una biblioteca.
pub const SUBFOLDERS: [&str; 5] = [
    "biblioteca",
    "archivio",
    "simboli",
    "correzioni",
    "aggiornamenti",
];

const SHARED_NAMES: [&str; 2] = ["Drive condivisi", "Shared drives"];

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// La cartella (contiene `biblioteca`).
    pub path: PathBuf,
    /// Il nome del Drive condiviso in cui è stata trovata.
    pub drive: String,
}

/// Una cartella è una biblioteca se contiene `biblioteca`.
pub fn is_library(path: &Path) -> bool {
    path.join("biblioteca").is_dir()
}

/// Cerca le biblioteche nei Drive condivisi delle radici date (le unità: `C:\`, `G:\`…). Con `drive_name` nella
/// configurazione solo quel Drive; la cartella è `config.folder` (predefinita `CAA`). Non scende altrove e non
/// legge i file: solo i nomi delle cartelle.
pub fn find_candidates(roots: &[PathBuf], cfg: &SharedConfig) -> Vec<Candidate> {
    let folder = cfg
        .folder
        .as_deref()
        .filter(|f| !f.is_empty())
        .unwrap_or("CAA");
    let mut out = Vec::new();
    for root in roots {
        for shared in SHARED_NAMES {
            let Ok(drives) = std::fs::read_dir(root.join(shared)) else {
                continue;
            };
            for d in drives.flatten() {
                let name = d.file_name().to_string_lossy().to_string();
                if let Some(want) = cfg.drive_name.as_deref().filter(|w| !w.is_empty()) {
                    if !name.eq_ignore_ascii_case(want) {
                        continue;
                    }
                }
                let path = d.path().join(folder);
                if is_library(&path) {
                    out.push(Candidate { path, drive: name });
                }
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Le unità del sistema (Windows: `A:\`…`Z:\` che esistono; altrove nessuna).
pub fn drive_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        ('A'..='Z')
            .map(|c| PathBuf::from(format!("{c}:\\")))
            .filter(|p| p.exists())
            .collect()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Crea la struttura di una biblioteca nuova (la prima volta, da chi la imposta).
pub fn create_library(path: &Path) -> std::io::Result<()> {
    for sub in SUBFOLDERS {
        std::fs::create_dir_all(path.join(sub))?;
    }
    Ok(())
}
