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
use serde::{Deserialize, Serialize};

use crate::custom::CustomStore;
use crate::docs::{opened_from, DocEntry, DocStore, Opened};

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
    /// L'utente del sistema (Windows): serve a sapere se è fra gli amministratori.
    pub user: String,
    /// Chi può ritirare i documenti degli altri (dal `config.json` del tecnico).
    pub admins: Vec<String>,
}

/// L'utente del sistema.
pub fn os_user() -> String {
    ["USERNAME", "USER"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .unwrap_or_default()
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// I dati che il docente scrive quando pubblica.
#[derive(Debug, Deserialize)]
pub struct PublishMeta {
    pub title: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Com'è andata una pubblicazione o un aggiornamento.
#[derive(Debug, Serialize)]
pub struct PublishOutcome {
    /// `published`, `updated` o `saved_as_new` (la biblioteca era andata avanti: salvato come documento nuovo).
    pub kind: &'static str,
    /// La revisione in biblioteca.
    pub rev: u32,
    /// Il documento personale com'è adesso (con il ricordo della pubblicazione, e il nuovo id se `saved_as_new`).
    pub entry: DocEntry,
}

/// Una versione più recente del programma, annunciata da `aggiornamenti\version.json`.
#[derive(Debug, Serialize, PartialEq)]
pub struct VersionInfo {
    pub version: String,
    pub notes: String,
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
            user: os_user(),
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

impl LibraryState {
    /// La cartella della biblioteca, raggiungibile adesso (per scrivere non basta la cache).
    fn writable_root(&self) -> Result<PathBuf, String> {
        let root = self.root().ok_or("la biblioteca non è collegata")?;
        if !is_reachable(&root.join("biblioteca"), REACH_LIMIT) {
            return Err("il Drive non risponde: riprova quando è di nuovo raggiungibile".into());
        }
        Ok(root)
    }

    /// Pubblica un documento personale: lo scrive in biblioteca (mai sopra uno esistente) e ricorda la revisione.
    pub fn publish(
        &self,
        file: &str,
        meta: &PublishMeta,
        docs: &DocStore,
        author: &str,
    ) -> Result<PublishOutcome, String> {
        let root = self.writable_root()?;
        let mut doc = docs.read(file)?.doc;
        apply_meta(&mut doc.manifest, meta);
        let lib = caa_lib::publish::publish(&root, &doc, author).map_err(|e| e.to_string())?;
        let entry = docs.update_manifest(file, |m| {
            apply_meta(m, meta);
            m.published_rev = Some(lib.manifest.rev);
        })?;
        Ok(PublishOutcome {
            kind: "published",
            rev: lib.manifest.rev,
            entry,
        })
    }

    /// Aggiorna in biblioteca (solo l'autore). Se la biblioteca è andata avanti, il documento si salva come nuovo.
    pub fn update(
        &self,
        file: &str,
        docs: &DocStore,
        user: &str,
    ) -> Result<PublishOutcome, String> {
        let root = self.writable_root()?;
        let doc = docs.read(file)?.doc;
        let known = doc
            .manifest
            .published_rev
            .ok_or("questo documento non è stato pubblicato")?;
        match caa_lib::publish::update(&root, &doc, known, user, now_secs()) {
            Ok(caa_lib::publish::Updated::Revision { rev }) => {
                let entry = docs.update_manifest(file, |m| m.published_rev = Some(rev))?;
                Ok(PublishOutcome {
                    kind: "updated",
                    rev,
                    entry,
                })
            }
            Ok(caa_lib::publish::Updated::SavedAsNew { id }) => {
                // Il documento personale diventa l'autore del documento nuovo.
                let entry = docs.update_manifest(file, |m| {
                    m.id = id;
                    m.published_rev = Some(1);
                })?;
                Ok(PublishOutcome {
                    kind: "saved_as_new",
                    rev: 1,
                    entry,
                })
            }
            Err(caa_lib::publish::LibError::NotFound) => {
                // Ritirato nel frattempo: il documento personale non risulta più pubblicato.
                let _ = docs.update_manifest(file, |m| m.published_rev = None);
                Err("il documento non è più in biblioteca (è stato ritirato): puoi pubblicarlo di nuovo".into())
            }
            Err(e) => Err(e.to_string()),
        }
    }

    /// Ritira un documento (l'autore o un amministratore): va in `archivio\`.
    pub fn retire(&self, file: &str, display_name: &str, os_user: &str) -> Result<(), String> {
        let root = self.writable_root()?;
        let admins = &self.config.admins;
        match caa_lib::publish::retire(&root, file, display_name, admins) {
            Err(caa_lib::publish::LibError::NotAuthor { .. }) => {
                // Forse è un amministratore (i nomi del `config.json` sono nomi utente di Windows).
                caa_lib::publish::retire(&root, file, os_user, admins)
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
            other => other.map(|_| ()).map_err(|e| e.to_string()),
        }
    }

    /// L'originale della biblioteca per guardarlo (sola lettura): dal Drive o, se non risponde, dalla copia locale.
    pub fn open_original(&self, file: &str, custom: &CustomStore) -> Result<Opened, String> {
        let root = self.root().unwrap_or_default();
        let loaded = read_for_adapt(&root, &self.cache_dir.join("documenti"), file, READ_LIMIT)?;
        Ok(opened_from(file, loaded, custom, true))
    }

    /// Se `aggiornamenti\version.json` annuncia una versione più recente di `current`.
    pub fn newer_version(&self, current: &str) -> Option<VersionInfo> {
        let root = self.root()?;
        let path = root.join("aggiornamenti").join("version.json");
        let raw = with_timeout(REACH_LIMIT, move || std::fs::read(&path).ok())??;
        #[derive(Deserialize)]
        struct V {
            version: String,
            #[serde(default)]
            notes: String,
        }
        let v: V = serde_json::from_slice(&raw).ok()?;
        caa_lib::publish::newer_version(current, &v.version).then(|| VersionInfo {
            version: v.version.chars().take(40).collect(),
            notes: v.notes.chars().take(300).collect(),
        })
    }
}

fn apply_meta(m: &mut caa_doc::Manifest, meta: &PublishMeta) {
    let clean = |s: &str, max: usize| -> String {
        s.chars()
            .filter(|c| !c.is_control())
            .collect::<String>()
            .trim()
            .chars()
            .take(max)
            .collect()
    };
    let title = clean(&meta.title, 120);
    if !title.is_empty() {
        m.title = title;
    }
    m.subject = clean(&meta.subject, 60);
    m.level = clean(&meta.level, 60);
    m.tags = meta
        .tags
        .iter()
        .map(|t| clean(t, 40))
        .filter(|t| !t.is_empty())
        .take(12)
        .collect();
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

    // ---- M9b-2 ----

    /// Un documento personale pubblicabile in `Documenti`.
    fn personal(docs: &DocStore, title: &str, author: &str) -> DocEntry {
        let mut m = Manifest::new(title, author, "0.1.0", "lex");
        m.rev = 12;
        let doc = Document {
            manifest: m,
            document: json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":title}]}]}),
            render: json!([]),
            media: Default::default(),
        };
        docs.write_document(&doc).unwrap()
    }

    fn setup(name: &str) -> (PathBuf, PathBuf, PathBuf, LibraryState, DocStore) {
        let (sd, lib, dd) = (
            tmp(name),
            tmp(&format!("{name}-lib")),
            tmp(&format!("{name}-docs")),
        );
        std::fs::create_dir_all(lib.join("biblioteca")).unwrap();
        let cfg = SharedConfig {
            admins: vec!["segreteria".into()],
            ..Default::default()
        };
        let st = LibraryState::new(sd.clone(), cfg, vec![]);
        st.set_folder(lib.to_str().unwrap(), false).unwrap();
        (sd, lib, dd.clone(), st, DocStore::new(dd))
    }

    fn meta(title: &str) -> PublishMeta {
        PublishMeta {
            title: title.into(),
            subject: "  Italiano\n".into(),
            level: "primaria".into(),
            tags: vec!["storia".into(), " ".into(), "sociale".into()],
        }
    }

    #[test]
    fn pubblica_e_aggiorna_dal_documento_personale() {
        let (sd, lib, dd, st, docs) = setup("pub");
        let mine = personal(&docs, "La storia", "Maria Rossi");
        assert_eq!(mine.published_rev, None);
        // Pubblica: in biblioteca con id, autore e metadati; il documento personale ricorda la revisione.
        let out = st
            .publish(&mine.file, &meta("La storia di Pepe"), &docs, "Maria Rossi")
            .unwrap();
        assert_eq!((out.kind, out.rev), ("published", 1));
        assert_eq!(out.entry.published_rev, Some(1));
        assert_eq!(
            (out.entry.rev, out.entry.id.as_str()),
            (mine.rev, mine.id.as_str())
        ); // revisione e id personali invariati
        let in_lib = caa_doc::read(&lib.join("biblioteca").join(format!("{}.caa", mine.id)))
            .unwrap()
            .doc
            .manifest;
        assert_eq!(
            (
                in_lib.title.as_str(),
                in_lib.subject.as_str(),
                in_lib.level.as_str(),
                in_lib.author.as_str(),
                in_lib.rev
            ),
            (
                "La storia di Pepe",
                "Italiano",
                "primaria",
                "Maria Rossi",
                1
            )
        );
        assert_eq!(in_lib.tags, vec!["storia", "sociale"]);
        let local = docs.read(&mine.file).unwrap().doc.manifest;
        assert_eq!(
            (local.subject.as_str(), local.published_rev),
            ("Italiano", Some(1))
        );
        // Non si pubblica due volte; senza Drive non si scrive.
        assert!(st
            .publish(&mine.file, &meta("x"), &docs, "Maria Rossi")
            .unwrap_err()
            .contains("già in biblioteca"));
        // Aggiorna: revisione 2 in biblioteca e nel ricordo del documento personale.
        let up = st.update(&mine.file, &docs, "Maria Rossi").unwrap();
        assert_eq!(
            (up.kind, up.rev, up.entry.published_rev),
            ("updated", 2, Some(2))
        );
        assert_eq!(
            caa_doc::read(&lib.join("biblioteca").join(format!("{}.caa", mine.id)))
                .unwrap()
                .doc
                .manifest
                .rev,
            2
        );
        // Un altro utente non aggiorna il documento di Maria.
        assert!(st
            .update(&mine.file, &docs, "Luca Bianchi")
            .unwrap_err()
            .contains("solo l'autore"));
        // Un documento mai pubblicato.
        let other = personal(&docs, "Altro", "Maria Rossi");
        assert!(st
            .update(&other.file, &docs, "Maria Rossi")
            .unwrap_err()
            .contains("non è stato pubblicato"));
        for d in [&sd, &lib, &dd] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn il_salvataggio_automatico_non_perde_il_ricordo_della_pubblicazione() {
        let (sd, lib, dd, st, docs) = setup("autosave");
        let mine = personal(&docs, "Storia", "Maria");
        st.publish(&mine.file, &meta("Storia"), &docs, "Maria")
            .unwrap();
        // Il salvataggio automatico (che riparte da un manifest nuovo) tiene id, revisione pubblicata e metadati.
        let custom = CustomStore::open(sd.join("custom"));
        let saved = docs
            .save(
                crate::docs::SavePayload {
                    file: Some(mine.file.clone()),
                    id: Some(mine.id.clone()),
                    rev: Some(mine.rev),
                    title: "Storia modificata".into(),
                    created: None,
                    origin: None,
                    prefs: json!({}),
                    sense_locks: json!([]),
                    document: json!({"type":"doc","content":[]}),
                    render: json!([]),
                    media: vec![],
                    lexicon: "lex".into(),
                },
                &custom,
                "Maria",
                "0.1.0",
            )
            .unwrap();
        assert_eq!(saved.published_rev, Some(1));
        assert!(!saved.conflict, "i metadati scritti dalla pubblicazione non devono sembrare il cambiamento di un'altra copia");
        let m = docs.read(&mine.file).unwrap().doc.manifest;
        assert_eq!(m.subject, "Italiano");
        for d in [&sd, &lib, &dd] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn aggiornare_dopo_che_la_biblioteca_e_andata_avanti_salva_come_nuovo_e_il_documento_ne_diventa_l_autore(
    ) {
        let (sd, lib, dd, st, docs) = setup("avanti");
        let mine = personal(&docs, "Storia", "Maria");
        st.publish(&mine.file, &meta("Storia"), &docs, "Maria")
            .unwrap();
        // Un altro PC aggiorna il documento di biblioteca (revisione 2).
        let other_pc = DocStore::new(tmp("avanti-altro"));
        std::fs::copy(dd.join(&mine.file), other_pc.dir().join("x.caa")).ok();
        let lib_file = lib.join("biblioteca").join(format!("{}.caa", mine.id));
        let loaded = caa_doc::read(&lib_file).unwrap();
        caa_lib::publish::update(&lib, &loaded.doc, 1, "Maria", 1_800_000_000).unwrap();
        // Questo PC è ancora alla revisione 1: il documento si salva come nuovo, con un id nuovo.
        let out = st.update(&mine.file, &docs, "Maria").unwrap();
        assert_eq!((out.kind, out.rev), ("saved_as_new", 1));
        assert_ne!(out.entry.id, mine.id);
        assert_eq!(out.entry.published_rev, Some(1));
        assert_eq!(
            caa_doc::read(&lib_file).unwrap().doc.manifest.rev,
            2,
            "il documento di biblioteca non è stato sovrascritto"
        );
        assert!(lib
            .join("biblioteca")
            .join(format!("{}.caa", out.entry.id))
            .is_file());
        // E da adesso aggiorna il documento nuovo.
        assert_eq!(
            st.update(&mine.file, &docs, "Maria").unwrap().kind,
            "updated"
        );
        let _ = std::fs::remove_dir_all(other_pc.dir());
        for d in [&sd, &lib, &dd] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn aggiornare_un_documento_ritirato_lo_rende_di_nuovo_pubblicabile() {
        let (sd, lib, dd, st, docs) = setup("ritirato");
        let mine = personal(&docs, "Storia", "Maria");
        st.publish(&mine.file, &meta("Storia"), &docs, "Maria")
            .unwrap();
        st.retire(&format!("{}.caa", mine.id), "Maria", "maria")
            .unwrap();
        assert!(lib
            .join("archivio")
            .join(format!("{}.caa", mine.id))
            .is_file());
        let err = st.update(&mine.file, &docs, "Maria").unwrap_err();
        assert!(err.contains("non è più in biblioteca"), "{err}");
        assert_eq!(
            docs.read(&mine.file).unwrap().doc.manifest.published_rev,
            None
        );
        // Si può pubblicare di nuovo.
        assert_eq!(
            st.publish(&mine.file, &meta("Storia"), &docs, "Maria")
                .unwrap()
                .kind,
            "published"
        );
        for d in [&sd, &lib, &dd] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn ritira_per_autore_o_amministratore() {
        let (sd, lib, dd, st, docs) = setup("ritira");
        let mine = personal(&docs, "Storia", "Maria Rossi");
        st.publish(&mine.file, &meta("Storia"), &docs, "Maria Rossi")
            .unwrap();
        let file = format!("{}.caa", mine.id);
        // Un altro docente no.
        assert!(st
            .retire(&file, "Luca Bianchi", "luca")
            .unwrap_err()
            .contains("solo l'autore"));
        assert!(lib.join("biblioteca").join(&file).is_file());
        // Un amministratore (nome utente di Windows nel config.json) sì, anche con un altro nome da mostrare.
        st.retire(&file, "Segretaria Anna", "Segreteria").unwrap();
        assert!(
            !lib.join("biblioteca").join(&file).exists()
                && lib.join("archivio").join(&file).is_file()
        );
        assert!(st.retire("../x.caa", "Maria Rossi", "maria").is_err());
        for d in [&sd, &lib, &dd] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn senza_il_drive_non_si_scrive_niente() {
        let (sd, lib, dd, st, docs) = setup("offline-w");
        let mine = personal(&docs, "Storia", "Maria");
        std::fs::remove_dir_all(&lib).unwrap();
        for e in [
            st.publish(&mine.file, &meta("Storia"), &docs, "Maria")
                .unwrap_err(),
            st.update(&mine.file, &docs, "Maria").unwrap_err(),
            st.retire("x.caa", "Maria", "maria").unwrap_err(),
        ] {
            assert!(e.contains("non risponde"), "{e}");
        }
        assert_eq!(
            docs.read(&mine.file).unwrap().doc.manifest.published_rev,
            None
        );
        // L'originale si legge lo stesso dalla copia locale, senza cache: errore chiaro.
        assert!(st
            .open_original("x.caa", &CustomStore::open(sd.join("c")))
            .is_err());
        for d in [&sd, &dd] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn l_originale_si_apre_in_sola_lettura_e_la_versione_nuova_si_annuncia() {
        let (sd, lib, dd, st, docs) = setup("orig");
        let mine = personal(&docs, "Storia", "Maria");
        st.publish(&mine.file, &meta("Storia"), &docs, "Maria")
            .unwrap();
        let file = format!("{}.caa", mine.id);
        let custom = CustomStore::open(sd.join("custom"));
        let o = st.open_original(&file, &custom).unwrap();
        assert!(o.read_only);
        assert_eq!((o.entry.id.as_str(), o.entry.rev), (mine.id.as_str(), 1));
        // Versione del programma: nessun file = niente; una più nuova = avviso; uguale o più vecchia = niente.
        assert_eq!(st.newer_version("0.1.0"), None);
        std::fs::create_dir_all(lib.join("aggiornamenti")).unwrap();
        std::fs::write(
            lib.join("aggiornamenti/version.json"),
            br#"{"version":"0.2.0","notes":"Nuove cose"}"#,
        )
        .unwrap();
        assert_eq!(
            st.newer_version("0.1.0"),
            Some(VersionInfo {
                version: "0.2.0".into(),
                notes: "Nuove cose".into()
            })
        );
        assert_eq!(st.newer_version("0.2.0"), None);
        std::fs::write(lib.join("aggiornamenti/version.json"), b"{rotto").unwrap();
        assert_eq!(st.newer_version("0.1.0"), None);
        for d in [&sd, &lib, &dd] {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
