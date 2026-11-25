//! "La cartella è raggiungibile?": si prova ad aprirla, con un tempo massimo. Una cartella di un Drive in
//! streaming o di un'unità di rete scollegata può bloccare la lettura per molti secondi: l'interfaccia non
//! deve aspettare.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

/// Esegue `f` su un thread a parte e aspetta al massimo `limit`. `None` se non finisce in tempo (il thread
/// resta a finire da solo; il risultato si butta).
pub fn with_timeout<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(limit).ok()
}

/// La cartella esiste ed è leggibile entro `limit`.
pub fn is_reachable(dir: &Path, limit: Duration) -> bool {
    let dir = dir.to_path_buf();
    with_timeout(limit, move || std::fs::read_dir(&dir).is_ok()).unwrap_or(false)
}
