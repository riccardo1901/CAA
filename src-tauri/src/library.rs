//! La biblioteca nell'app (M9b-1): impostazioni dell'utente, cartella del Drive condiviso, elenco, cache e
//! "Adatta". La logica sta in `caa-lib`; qui si tengono insieme stato e cartelle.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use caa_lib::cache::{read_for_adapt, sync_docs};
use caa_lib::config::{clean_display_name, load_settings, save_settings, Settings, SharedConfig};
use caa_lib::detect::{create_library, find_candidates, is_library, Candidate};
use caa_lib::index::{load_index, save_index, scan, IndexCache, LibEntry};
use caa_lib::reach::{is_reachable, with_timeout};
use serde::Serialize;

use crate::docs::{DocEntry, DocStore};

/// Tempi massimi: l'interfaccia non deve restare ad aspettare un Drive che non risponde.
const REACH_LIMIT: Duration = Duration::from_secs(2);
const SCAN_LIMIT: Duration = Duration::from_secs(12);
const READ_LIMIT: Duration = Duration::from_secs(10);

pub struct LibraryState {
    settings_dir: PathBuf,
    /// L'ultimo elenco e le copie dei documenti, per consultare la biblioteca senza il Drive.
    cache_dir: PathBuf,
    config: SharedConfig,
    /// Le unità in cui cercare i Drive condivisi (Windows: le lettere che esistono).
    roots: Vec<PathBuf>,
    settings: Mutex<Settings>,
    index: Arc<Mutex<IndexCache>>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FolderDto {
    pub path: String,
    pub drive: String,
}

#[derive(Debug, Serialize)]
pub struct LibStatus {
    /// C'è una cartella scelta (o trovata) per la biblioteca.
    pub configured: bool,
    pub path: Option<String>,
    /// Il Drive risponde adesso.
    pub reachable: bool,
    pub display_name: String,
    /// Chi può ritirare i documenti degli altri (dal `config.json` del tecnico).
    pub admins: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct LibScan {
    pub configured: bool,
    pub entries: Vec<LibEntry>,
    /// File che non si leggono adesso (ancora in sincronizzazione).
    pub incomplete: usize,
    /// L'elenco viene dall'ultima copia locale, non dal Drive.
    pub offline: bool,
}

impl LibraryState {
    pub fn new(settings_dir: PathBuf, config: SharedConfig, roots: Vec<PathBuf>) -> LibraryState {
        let settings = load_settings(&settings_dir);
        LibraryState {
            cache_dir: settings_dir.join("biblioteca-cache"),
            settings_dir,
            config,
            roots,
            settings: Mutex::new(settings),
            index: Arc::new(Mutex::new(IndexCache::default())),
        }
    }

    fn settings(&self) -> std::sync::MutexGuard<'_, Settings> {
        self.settings.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn display_name(&self) -> String {
        self.settings().display_name.clone()
    }

    pub fn set_display_name(&self, name: &str) -> Result<String, String> {
        let name = clean_display_name(name);
        if name.is_empty() {
            return Err("scrivi il tuo nome".into());
        }
        let mut s = self.settings();
        s.display_name = name.clone();
        save_settings(&self.settings_dir, &s)
            .map_err(|e| format!("non riesco a salvare il nome: {e}"))?;
        Ok(name)
    }

    pub fn candidates(&self) -> Vec<Candidate> {
        find_candidates(&self.roots, &self.config)
    }

    /// La cartella della biblioteca: quella scelta dall'utente, poi quella del tecnico, poi (senza ambiguità)
    /// l'unica trovata nei Drive condivisi.
    pub fn root(&self) -> Option<PathBuf> {
        let chosen = self.settings().library_path.clone();
        // Una cartella scelta ma non raggiungibile (Drive non collegato) resta quella scelta.
        if let Some(p) = chosen.or_else(|| self.config.library_path.clone()) {
            return Some(PathBuf::from(p));
        }
        let mut found = self.candidates();
        if found.len() == 1 {
            return found.pop().map(|c| c.path);
        }
        None
    }

    /// Sceglie la cartella della biblioteca. Deve contenere `biblioteca`, a meno che si chieda di crearla
    /// (la prima volta, da chi imposta la biblioteca).
    pub fn set_folder(&self, path: &str, create: bool) -> Result<(), String> {
        let p = PathBuf::from(path.trim());
        if p.as_os_str().is_empty() || !p.is_dir() {
            return Err("la cartella non esiste".into());
        }
        if !is_library(&p) {
            if !create {
                return Err("questa cartella non contiene una «biblioteca»: scegli quella giusta, oppure creala qui".into());
            }
            create_library(&p).map_err(|e| format!("non riesco a creare la biblioteca: {e}"))?;
        }
        let mut s = self.settings();
        s.library_path = Some(p.to_string_lossy().to_string());
        save_settings(&self.settings_dir, &s)
            .map_err(|e| format!("non riesco a salvare la scelta: {e}"))
    }

    pub fn status(&self) -> LibStatus {
        let root = self.root();
        let reachable = root
            .as_ref()
            .is_some_and(|r| is_reachable(&r.join("biblioteca"), REACH_LIMIT));
        LibStatus {
            configured: root.is_some(),
            path: root.map(|r| r.to_string_lossy().to_string()),
            reachable,
            display_name: self.display_name(),
            admins: self.config.admins.clone(),
        }
    }

    /// L'elenco dei documenti. Se il Drive risponde si rilegge (e si aggiornano elenco e copie in cache); se
    /// no si usa l'ultimo elenco salvato.
    pub fn scan(&self) -> LibScan {
        let Some(root) = self.root() else {
            return LibScan {
                configured: false,
                entries: Vec::new(),
                incomplete: 0,
                offline: false,
            };
        };
        let index = Arc::clone(&self.index);
        let r = root.clone();
        let live = with_timeout(SCAN_LIMIT, move || {
            let mut cache = index.lock().unwrap_or_else(|e| e.into_inner());
            scan(&r, &mut cache)
        })
        .and_then(Result::ok);
        match live {
            Some(s) => {
                let _ = save_index(&self.cache_dir, &s.entries);
                // Le copie dei documenti si fanno in secondo piano: non fanno aspettare l'elenco.
                let (entries, dir) = (s.entries.clone(), self.cache_dir.join("documenti"));
                std::thread::spawn(move || {
                    sync_docs(&root, &entries, &dir);
                });
                LibScan {
                    configured: true,
                    entries: s.entries,
                    incomplete: s.incomplete,
                    offline: false,
                }
            }
            None => LibScan {
                configured: true,
                entries: load_index(&self.cache_dir),
                incomplete: 0,
                offline: true,
            },
        }
    }

    /// "Adatta": una copia personale (id nuovo, ricorda l'originale) in `Documenti\CAA`.
    pub fn adapt(&self, file: &str, docs: &DocStore, author: &str) -> Result<DocEntry, String> {
        let root = self.root().unwrap_or_default();
        let loaded = read_for_adapt(&root, &self.cache_dir.join("documenti"), file, READ_LIMIT)?;
        let copy = caa_lib::adapted_copy(&loaded.doc, author);
        docs.write_document(&copy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use caa_doc::{Document, Manifest};
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("caa-libstate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(root: &std::path::Path, file: &str, title: &str, author: &str) -> String {
        let mut m = Manifest::new(title, author, "0.1.0", "lex");
        m.subject = "italiano".into();
        let id = m.id.clone();
        let doc = Document {
            manifest: m,
            document: json!({"type":"doc","content":[]}),
            render: json!([]),
            media: Default::default(),
        };
        std::fs::create_dir_all(root.join("biblioteca")).unwrap();
        caa_doc::write(&root.join("biblioteca").join(file), &doc).unwrap();
        id
    }

    #[test]
    fn nome_da_mostrare_e_cartella_scelta() {
        let (sd, lib) = (tmp("set"), tmp("set-lib"));
        let st = LibraryState::new(sd.clone(), SharedConfig::default(), vec![]);
        assert_eq!(st.display_name(), "");
        assert!(st.set_display_name("   ").is_err());
        assert_eq!(
            st.set_display_name("  Maria   Rossi ").unwrap(),
            "Maria Rossi"
        );
        // Ricordato anche da una nuova apertura del programma.
        assert_eq!(
            LibraryState::new(sd.clone(), SharedConfig::default(), vec![]).display_name(),
            "Maria Rossi"
        );
        // Nessuna cartella finché non si sceglie; una cartella senza «biblioteca» si rifiuta, a meno di crearla.
        assert!(st.root().is_none() && !st.status().configured);
        assert!(st.set_folder("/non/esiste", false).is_err());
        assert!(st.set_folder(lib.to_str().unwrap(), false).is_err());
        st.set_folder(lib.to_str().unwrap(), true).unwrap();
        assert!(lib.join("biblioteca").is_dir() && lib.join("archivio").is_dir());
        assert_eq!(st.root(), Some(lib.clone()));
        assert_eq!(
            LibraryState::new(sd.clone(), SharedConfig::default(), vec![]).root(),
            Some(lib.clone())
        );
        let s = st.status();
        assert!(s.configured && s.reachable);
        let _ = std::fs::remove_dir_all(&sd);
        let _ = std::fs::remove_dir_all(&lib);
    }

    #[test]
    fn la_cartella_si_trova_da_sola_se_e_una_sola() {
        let (sd, g) = (tmp("auto"), tmp("auto-g"));
        std::fs::create_dir_all(g.join("Drive condivisi/Istituto/CAA/biblioteca")).unwrap();
        let st = LibraryState::new(sd.clone(), SharedConfig::default(), vec![g.clone()]);
        let found = st.root().unwrap();
        assert!(found.ends_with("CAA") && st.status().configured);
        // Due possibilità: non si sceglie da sole; la configurazione del tecnico per nome toglie l'ambiguità.
        std::fs::create_dir_all(g.join("Drive condivisi/Altro/CAA/biblioteca")).unwrap();
        assert!(st.root().is_none());
        assert_eq!(st.candidates().len(), 2);
        let cfg = SharedConfig {
            drive_name: Some("Istituto".into()),
            ..Default::default()
        };
        assert!(LibraryState::new(sd.clone(), cfg, vec![g.clone()])
            .root()
            .is_some());
        // Un percorso scelto dall'utente vince su tutto, anche se in quel momento non c'è (Drive non collegato).
        let cfg = SharedConfig {
            library_path: Some("/da/config".into()),
            ..Default::default()
        };
        assert_eq!(
            LibraryState::new(sd.clone(), cfg, vec![g.clone()]).root(),
            Some(PathBuf::from("/da/config"))
        );
        let _ = std::fs::remove_dir_all(&sd);
        let _ = std::fs::remove_dir_all(&g);
    }

    #[test]
    fn elenco_dal_drive_poi_dalla_cache_e_adatta_in_entrambi_i_casi() {
        let (sd, lib, docs_dir) = (tmp("scan"), tmp("scan-lib"), tmp("scan-docs"));
        let id = put(&lib, "storia.caa", "La storia", "Maria");
        put(&lib, "altra.caa", "Altra", "Luca");
        std::fs::write(lib.join("biblioteca/incompleto.caa"), b"PK\x03\x04 a meta").unwrap();
        let st = LibraryState::new(sd.clone(), SharedConfig::default(), vec![]);
        st.set_folder(lib.to_str().unwrap(), false).unwrap();
        let docs = DocStore::new(docs_dir.clone());
        // Dal Drive.
        let s = st.scan();
        assert!(s.configured && !s.offline);
        assert_eq!((s.entries.len(), s.incomplete), (2, 1));
        // Le copie in cache si fanno in secondo piano: si aspetta che ci siano.
        for _ in 0..100 {
            if sd.join("biblioteca-cache/documenti/storia.caa").is_file()
                && sd.join("biblioteca-cache/documenti/altra.caa").is_file()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        // Adatta dal Drive: copia personale con id nuovo, che ricorda l'originale.
        let a = st.adapt("storia.caa", &docs, "Luca").unwrap();
        assert_eq!(
            (a.title.as_str(), a.author.as_str(), a.rev),
            ("La storia", "Luca", 1)
        );
        assert_ne!(a.id, id);
        assert_eq!(a.origin.as_ref().map(|o| o.id.as_str()), Some(id.as_str()));
        // Il Drive sparisce: l'elenco viene dall'ultima copia e si può ancora adattare.
        std::fs::remove_dir_all(&lib).unwrap();
        let off = st.scan();
        assert!(off.offline && off.configured);
        assert_eq!(off.entries.len(), 2);
        let b = st.adapt("storia.caa", &docs, "Anna").unwrap();
        assert_eq!(b.title, "La storia");
        // Il nome si ripete: la seconda copia non sovrascrive la prima.
        assert_ne!(a.file, b.file);
        assert_eq!(docs.list().0.len(), 2);
        // Un documento che non c'è né nel Drive né in cache è un errore chiaro.
        assert!(st.adapt("non-c-e.caa", &docs, "Anna").is_err());
        assert!(st.adapt("../x.caa", &docs, "Anna").is_err());
        for d in [&sd, &docs_dir] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn senza_cartella_scelta_l_elenco_dice_non_configurata() {
        let sd = tmp("nonconf");
        let st = LibraryState::new(sd.clone(), SharedConfig::default(), vec![]);
        let s = st.scan();
        assert!(!s.configured && s.entries.is_empty() && !s.offline);
        assert!(st
            .adapt("x.caa", &DocStore::new(sd.join("d")), "M")
            .is_err());
        let _ = std::fs::remove_dir_all(&sd);
    }
}
