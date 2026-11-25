//! Simboli personali (M8c-3): immagini importate dal docente (foto o disegni), salvate in una cartella
//! locale del computer e servite come i pittogrammi ARASAAC. Niente rete. Con M9 le immagini usate da un
//! documento viaggeranno dentro il file `.caa`; la raccolta della scuola arriva con la biblioteca.
//!
//! Ogni simbolo ha un `id` numerico (da `CUSTOM_BASE` in su, per non incontrare mai gli id ARASAAC, che
//! sono più piccoli) che il motore tratta come un pittogramma qualsiasi, e un `uuid` stabile fra computer.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Gli id dei simboli personali partono da qui; sotto ci sono i pittogrammi ARASAAC.
pub const CUSTOM_BASE: u32 = 0x8000_0000;
/// Dimensione massima di un'immagine (WebP già ridimensionata dalla pagina: di solito 30–150 KB).
pub const MAX_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_SYMBOLS: usize = 5000;
const MAX_LABEL: usize = 60;

pub fn is_custom(id: u32) -> bool {
    id >= CUSTOM_BASE
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomSymbol {
    pub id: u32,
    pub uuid: String,
    /// La parola per cui è stato importato (minuscola): serve a ritrovarlo.
    pub label: String,
}

#[derive(Serialize, Deserialize, Default)]
struct IndexFile {
    next: u32,
    symbols: Vec<CustomSymbol>,
}

pub struct CustomStore {
    dir: PathBuf,
    state: Mutex<IndexFile>,
}

/// Cartella dei simboli personali: la variabile `CAA_CUSTOM`; altrimenti la cartella dati dell'utente
/// (`%APPDATA%` su Windows, `~/.local/share` altrove); come ultima possibilità accanto al programma.
pub fn custom_dir(
    env: Option<&str>,
    appdata: Option<&str>,
    xdg_or_home: Option<&str>,
    exe_dir: Option<&Path>,
) -> PathBuf {
    if let Some(e) = env.filter(|e| !e.is_empty()) {
        return PathBuf::from(e);
    }
    if let Some(a) = appdata.filter(|a| !a.is_empty()) {
        return Path::new(a).join("Editor CAA").join("simboli-personali");
    }
    if let Some(h) = xdg_or_home.filter(|h| !h.is_empty()) {
        return Path::new(h).join("editor-caa").join("simboli-personali");
    }
    exe_dir
        .unwrap_or_else(|| Path::new("."))
        .join("simboli-personali")
}

/// Intestazione di un file WebP: `RIFF` + dimensione + `WEBP`.
fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

fn clean_label(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_lowercase();
    cleaned.chars().take(MAX_LABEL).collect()
}

/// 32 caratteri esadecimali non prevedibili (senza dipendenze nuove): ora, contatore e il caso
/// che il sistema dà a ogni `RandomState`.
fn new_uuid(counter: u32) -> String {
    use std::hash::{BuildHasher, Hasher};
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let part = |salt: u64| {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(now);
        h.write_u32(counter);
        h.write_u64(salt);
        h.finish()
    };
    format!("{:016x}{:016x}", part(1), part(2))
}

/// Scrive un file in modo che non resti mai a metà: prima un file temporaneo, poi lo si rinomina.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

impl CustomStore {
    /// Apre la raccolta (la cartella si crea al primo salvataggio). Un indice illeggibile non si
    /// sovrascrive: si mette da parte come `index.json.bad` e si riparte da vuoto.
    pub fn open(dir: PathBuf) -> CustomStore {
        let index_path = dir.join("index.json");
        let state = match std::fs::read(&index_path) {
            Ok(bytes) => match serde_json::from_slice::<IndexFile>(&bytes) {
                Ok(i) => i,
                Err(_) => {
                    let _ = std::fs::rename(&index_path, dir.join("index.json.bad"));
                    IndexFile::default()
                }
            },
            Err(_) => IndexFile::default(),
        };
        CustomStore {
            dir,
            state: Mutex::new(state),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, IndexFile> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn list(&self) -> Vec<CustomSymbol> {
        self.lock().symbols.clone()
    }

    /// Salva un'immagine WebP e la aggiunge alla raccolta.
    pub fn save(&self, bytes: &[u8], label: &str) -> Result<CustomSymbol, String> {
        if bytes.len() > MAX_BYTES {
            return Err(format!("immagine troppo grande ({} byte)", bytes.len()));
        }
        if !is_webp(bytes) {
            return Err("l'immagine non è nel formato atteso (WebP)".into());
        }
        let mut state = self.lock();
        if state.symbols.len() >= MAX_SYMBOLS {
            return Err("troppi simboli personali".into());
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| format!("cartella non disponibile: {e}"))?;
        let id = CUSTOM_BASE + state.next;
        let symbol = CustomSymbol {
            id,
            uuid: new_uuid(state.next),
            label: clean_label(label),
        };
        write_atomic(&self.dir.join(format!("{}.webp", symbol.uuid)), bytes)
            .map_err(|e| format!("salvataggio non riuscito: {e}"))?;
        let mut next = IndexFile {
            next: state.next + 1,
            symbols: state.symbols.clone(),
        };
        next.symbols.push(symbol.clone());
        let json = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        write_atomic(&self.dir.join("index.json"), &json)
            .map_err(|e| format!("salvataggio non riuscito: {e}"))?;
        *state = next;
        Ok(symbol)
    }

    /// Il file di un simbolo personale, se esiste nella raccolta.
    pub fn path_of(&self, id: u32) -> Option<PathBuf> {
        let state = self.lock();
        let s = state.symbols.iter().find(|s| s.id == id)?;
        Some(self.dir.join(format!("{}.webp", s.uuid)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("caa-custom-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn webp(len: usize) -> Vec<u8> {
        let mut v = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        v.resize(len.max(20), 7);
        v
    }

    #[test]
    fn salva_ritrova_e_ricorda() {
        let dir = tmp("salva");
        let store = CustomStore::open(dir.clone());
        assert!(store.list().is_empty());
        let a = store.save(&webp(100), "  Mamma\n").unwrap();
        let b = store.save(&webp(200), "Il mio cane").unwrap();
        // Id oltre gli ARASAAC, crescenti; uuid diversi di 32 caratteri; etichetta pulita e minuscola.
        assert!(is_custom(a.id) && b.id == a.id + 1);
        assert_ne!(a.uuid, b.uuid);
        assert_eq!(a.uuid.len(), 32);
        assert_eq!(a.label, "mamma");
        assert!(!is_custom(36_473)); // un id ARASAAC vero
        assert_eq!(
            std::fs::read(store.path_of(a.id).unwrap()).unwrap(),
            webp(100)
        );
        assert!(store.path_of(CUSTOM_BASE + 99).is_none());
        assert!(store.path_of(7).is_none());
        // Riaprendo la raccolta ci sono ancora e il contatore continua.
        let again = CustomStore::open(dir.clone());
        assert_eq!(again.list(), vec![a.clone(), b.clone()]);
        let c = again.save(&webp(50), "casa").unwrap();
        assert_eq!(c.id, b.id + 1);
        // Nessun file temporaneo rimasto.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "tmp"))
            .collect();
        assert!(leftovers.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rifiuta_file_sbagliati() {
        let dir = tmp("rifiuta");
        let store = CustomStore::open(dir.clone());
        assert!(store
            .save(b"\x89PNG\r\n\x1a\n....................", "x")
            .is_err());
        assert!(store.save(b"", "x").is_err());
        assert!(store.save(&webp(MAX_BYTES + 1), "x").is_err());
        assert!(store.list().is_empty());
        // Un rifiuto non lascia niente su disco.
        assert!(!dir.join("index.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn etichetta_pulita_e_corta() {
        assert_eq!(clean_label("  CaSa\t\n"), "casa");
        assert_eq!(clean_label(&"a".repeat(200)).chars().count(), MAX_LABEL);
        assert_eq!(clean_label("\u{0}\u{7}"), "");
    }

    #[test]
    fn un_indice_rovinato_non_si_perde() {
        let dir = tmp("rovinato");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.json"), b"{ non e' json").unwrap();
        let store = CustomStore::open(dir.clone());
        assert!(store.list().is_empty());
        // L'indice rovinato e' stato messo da parte, non cancellato.
        assert_eq!(
            std::fs::read(dir.join("index.json.bad")).unwrap(),
            b"{ non e' json"
        );
        store.save(&webp(40), "ok").unwrap();
        assert_eq!(store.list().len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn dove_stanno_i_simboli() {
        let exe = Path::new("/app");
        assert_eq!(
            custom_dir(Some("/x"), Some("/ad"), Some("/h"), Some(exe)),
            PathBuf::from("/x")
        );
        assert_eq!(
            custom_dir(None, Some("/ad"), Some("/h"), Some(exe)),
            Path::new("/ad")
                .join("Editor CAA")
                .join("simboli-personali")
        );
        assert_eq!(
            custom_dir(Some(""), None, Some("/h"), Some(exe)),
            Path::new("/h").join("editor-caa").join("simboli-personali")
        );
        assert_eq!(
            custom_dir(None, None, None, Some(exe)),
            PathBuf::from("/app/simboli-personali")
        );
    }
}
