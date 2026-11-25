//! La copia locale dei documenti di biblioteca: serve a consultarli e adattarli quando il Drive non c'è.

use std::path::Path;
use std::time::Duration;

use caa_doc::Loaded;

use crate::index::{is_doc_name, LibEntry};
use crate::reach::with_timeout;

/// Tetto alla dimensione di un documento copiato in cache.
const MAX_CACHED_BYTES: u64 = 64 * 1024 * 1024;

/// Copia in `cache_dir` i documenti dell'elenco che non ci sono o hanno una dimensione diversa, e toglie
/// quelli che non sono più in biblioteca. Ogni copia è atomica. Restituisce quanti file ha copiato.
pub fn sync_docs(root: &Path, entries: &[LibEntry], cache_dir: &Path) -> usize {
    if std::fs::create_dir_all(cache_dir).is_err() {
        return 0;
    }
    let mut copied = 0;
    for e in entries {
        if !is_doc_name(&e.file) || e.size > MAX_CACHED_BYTES || e.conflict {
            continue;
        }
        let dest = cache_dir.join(&e.file);
        if std::fs::metadata(&dest).is_ok_and(|m| m.len() == e.size) {
            continue;
        }
        let tmp = cache_dir.join(format!("{}.{}.tmp", e.file, std::process::id()));
        let from = root.join("biblioteca").join(&e.file);
        // Si copia solo se il file è completo e valido (può essere ancora in sincronizzazione).
        if std::fs::copy(&from, &tmp).is_ok()
            && caa_doc::read_manifest(&tmp).is_ok()
            && std::fs::rename(&tmp, &dest).is_ok()
        {
            copied += 1;
        } else {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    if let Ok(rd) = std::fs::read_dir(cache_dir) {
        for f in rd.flatten() {
            let name = f.file_name().to_string_lossy().to_string();
            if is_doc_name(&name) && !entries.iter().any(|e| e.file == name) {
                let _ = std::fs::remove_file(f.path());
            }
        }
    }
    copied
}

/// Legge un documento di biblioteca per adattarlo: dalla biblioteca (con un tempo massimo: un Drive in
/// streaming o scollegato può bloccare la lettura) oppure, se non si riesce, dalla copia in cache.
pub fn read_for_adapt(
    root: &Path,
    cache_dir: &Path,
    file: &str,
    limit: Duration,
) -> Result<Loaded, String> {
    if !is_doc_name(file) {
        return Err("nome di file non valido".into());
    }
    let live = root.join("biblioteca").join(file);
    let from_drive = with_timeout(limit, move || caa_doc::read(&live)).and_then(Result::ok);
    if let Some(l) = from_drive {
        return Ok(l);
    }
    caa_doc::read(&cache_dir.join(file))
        .map_err(|e| format!("il documento non è disponibile (né nel Drive né in cache): {e}"))
}
