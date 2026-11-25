//! La memoria del docente (M9c-1): «usa sempre questo simbolo per questa parola», in tutti i documenti.
//! Sta in `memoria.json` nella cartella dati dell'utente (mai nel Drive, mai nei documenti). Il motore la
//! riceve già pronta (`UserMemory`): non legge né scrive niente.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use caa_engine::engine::UserMemory;
use caa_engine::types::Cat;
use serde::{Deserialize, Serialize};

/// Tetto alle voci (un docente ne ha qualche decina; un file enorme o rovinato non deve pesare).
const MAX_ENTRIES: usize = 5000;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Una voce: un lemma con la sua categoria (la normale), oppure solo una forma (parole che il motore non
/// conosce e non ha lemma).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemoryEntry {
    #[serde(default)]
    pub lemma: String,
    #[serde(default)]
    pub cat: String,
    #[serde(default)]
    pub form: String,
    pub picto: u32,
}

impl MemoryEntry {
    fn same_key(&self, o: &MemoryEntry) -> bool {
        self.lemma.to_lowercase() == o.lemma.to_lowercase()
            && self.cat == o.cat
            && self.form.to_lowercase() == o.form.to_lowercase()
    }

    fn valid(&self) -> bool {
        let by_lemma = !self.lemma.trim().is_empty() && Cat::from_name(&self.cat).is_some();
        let by_form = self.lemma.trim().is_empty() && !self.form.trim().is_empty();
        (by_lemma || by_form)
            && self.picto > 0
            && self.picto < caa_engine::engine::ForcedPick::MERGE
            && self.lemma.chars().count() <= 80
            && self.form.chars().count() <= 80
    }
}

#[derive(Serialize, Deserialize, Default)]
struct MemoryFile {
    #[serde(default)]
    entries: Vec<MemoryEntry>,
}

struct Inner {
    entries: Vec<MemoryEntry>,
    built: Arc<UserMemory>,
}

pub struct MemoryStore {
    path: PathBuf,
    state: Mutex<Inner>,
}

fn build(entries: &[MemoryEntry]) -> Arc<UserMemory> {
    let mut m = UserMemory::default();
    for e in entries {
        if e.lemma.trim().is_empty() {
            m.insert_form(&e.form, e.picto);
        } else if let Some(cat) = Cat::from_name(&e.cat) {
            m.insert_lemma(&e.lemma, cat, e.picto);
        }
    }
    Arc::new(m)
}

impl MemoryStore {
    /// Apre `<dir>/memoria.json`; un file mancante, enorme o rovinato vale come memoria vuota (un file
    /// rovinato non si cancella: si mette da parte, così non si perde niente).
    pub fn open(dir: &Path) -> MemoryStore {
        let path = dir.join("memoria.json");
        let mut entries = Vec::new();
        match std::fs::metadata(&path) {
            Ok(m) if m.len() <= MAX_FILE_BYTES => {
                match std::fs::read(&path)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<MemoryFile>(&b).ok())
                {
                    Some(f) => {
                        entries = f
                            .entries
                            .into_iter()
                            .filter(MemoryEntry::valid)
                            .take(MAX_ENTRIES)
                            .collect()
                    }
                    None => {
                        let _ = std::fs::rename(&path, dir.join("memoria.rovinata.json"));
                    }
                }
            }
            Ok(_) => {
                let _ = std::fs::rename(&path, dir.join("memoria.rovinata.json"));
            }
            Err(_) => {}
        }
        let built = build(&entries);
        MemoryStore {
            path,
            state: Mutex::new(Inner { entries, built }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// La memoria per il motore (una copia condivisa, senza costo).
    pub fn snapshot(&self) -> Arc<UserMemory> {
        self.lock().built.clone()
    }

    pub fn list(&self) -> Vec<MemoryEntry> {
        self.lock().entries.clone()
    }

    fn persist(&self, entries: &[MemoryEntry]) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("cartella non disponibile: {e}"))?;
        }
        let body = serde_json::to_vec_pretty(&MemoryFile {
            entries: entries.to_vec(),
        })
        .map_err(|e| e.to_string())?;
        let tmp = caa_doc::tmp_path(&self.path);
        let res = std::fs::write(&tmp, body).and_then(|_| std::fs::rename(&tmp, &self.path));
        if res.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        res.map_err(|e| format!("non riesco a salvare la memoria: {e}"))
    }

    /// Cambia le voci e salva; se il salvataggio non riesce non cambia niente.
    fn change(
        &self,
        f: impl FnOnce(&mut Vec<MemoryEntry>) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut st = self.lock();
        let mut next = st.entries.clone();
        f(&mut next)?;
        self.persist(&next)?;
        st.built = build(&next);
        st.entries = next;
        Ok(())
    }

    /// Ricorda (o cambia) la scelta per questa parola.
    pub fn add(&self, entry: MemoryEntry) -> Result<(), String> {
        if !entry.valid() {
            return Err("voce di memoria non valida".into());
        }
        self.change(|v| {
            if let Some(old) = v.iter_mut().find(|e| e.same_key(&entry)) {
                old.picto = entry.picto;
            } else if v.len() >= MAX_ENTRIES {
                return Err("la memoria è piena: dimentica qualche parola".into());
            } else {
                v.push(entry);
            }
            Ok(())
        })
    }

    pub fn forget(&self, entry: &MemoryEntry) -> Result<(), String> {
        self.change(|v| {
            v.retain(|e| !e.same_key(entry));
            Ok(())
        })
    }

    /// Toglie le voci che puntano a un pittogramma (un simbolo personale eliminato non lascia voci appese).
    pub fn forget_picto(&self, picto: u32) -> Result<(), String> {
        if !self.list().iter().any(|e| e.picto == picto) {
            return Ok(());
        }
        self.change(|v| {
            v.retain(|e| e.picto != picto);
            Ok(())
        })
    }

    pub fn clear(&self) -> Result<(), String> {
        self.change(|v| {
            v.clear();
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("caa-mem-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn lemma(l: &str, c: &str, p: u32) -> MemoryEntry {
        MemoryEntry {
            lemma: l.into(),
            cat: c.into(),
            form: String::new(),
            picto: p,
        }
    }

    #[test]
    fn ricorda_cambia_dimentica_e_resta_dopo_la_chiusura() {
        let d = tmp("base");
        let s = MemoryStore::open(&d);
        assert!(s.snapshot().is_empty());
        s.add(lemma("pesca", "NOUN", 11)).unwrap();
        s.add(lemma("Pesca", "NOUN", 12)).unwrap(); // stessa voce: cambia il simbolo
        s.add(MemoryEntry {
            lemma: String::new(),
            cat: String::new(),
            form: "Blorpf".into(),
            picto: 5,
        })
        .unwrap();
        assert_eq!(s.list().len(), 2);
        assert_eq!(s.snapshot().get("pesca", "pesca", Cat::Noun), Some(12));
        assert_eq!(s.snapshot().get("blorpf", "", Cat::Noun), Some(5));
        let again = MemoryStore::open(&d);
        assert_eq!(again.list(), s.list());
        again.forget(&lemma("PESCA", "NOUN", 0)).unwrap();
        assert_eq!(again.list().len(), 1);
        assert_eq!(again.snapshot().get("pesca", "pesca", Cat::Noun), None);
        again.clear().unwrap();
        assert!(MemoryStore::open(&d).list().is_empty());
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1, "nessun .tmp");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn un_simbolo_eliminato_non_lascia_voci_appese() {
        let d = tmp("picto");
        let s = MemoryStore::open(&d);
        s.add(lemma("pane", "NOUN", 2_147_483_648)).unwrap();
        s.add(lemma("casa", "NOUN", 7)).unwrap();
        s.forget_picto(2_147_483_648).unwrap();
        assert_eq!(s.list().len(), 1);
        s.forget_picto(99).unwrap();
        assert_eq!(MemoryStore::open(&d).list().len(), 1);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn voci_non_valide_si_rifiutano_e_un_file_rovinato_si_mette_da_parte() {
        let d = tmp("rovinata");
        let s = MemoryStore::open(&d);
        assert!(s.add(lemma("pesca", "NOUN", 0)).is_err());
        assert!(s.add(lemma("pesca", "NOUN", u32::MAX)).is_err());
        assert!(s.add(lemma("pesca", "boh", 3)).is_err());
        assert!(s.add(lemma("", "NOUN", 3)).is_err());
        assert!(s.list().is_empty());
        std::fs::write(d.join("memoria.json"), b"{rovinato").unwrap();
        let s = MemoryStore::open(&d);
        assert!(s.list().is_empty());
        assert!(d.join("memoria.rovinata.json").exists());
        // Voci non valide dentro un file buono si scartano, le altre restano.
        std::fs::write(
            d.join("memoria.json"),
            br#"{"entries":[{"lemma":"pane","cat":"NOUN","picto":7},{"lemma":"x","cat":"NOUN","picto":0}]}"#,
        )
        .unwrap();
        assert_eq!(MemoryStore::open(&d).list().len(), 1);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn un_salvataggio_che_non_riesce_non_cambia_la_memoria() {
        let d = tmp("sola");
        let s = MemoryStore::open(&d);
        s.add(lemma("pane", "NOUN", 7)).unwrap();
        // La cartella sparisce e al suo posto c'è un file: scrivere non è possibile.
        std::fs::remove_dir_all(&d).unwrap();
        std::fs::write(&d, b"x").unwrap();
        assert!(s.add(lemma("latte", "NOUN", 8)).is_err());
        assert_eq!(s.list().len(), 1);
        assert_eq!(s.snapshot().get("latte", "latte", Cat::Noun), None);
        std::fs::remove_file(&d).unwrap();
    }
}
