//! I documenti personali (M9a): file `.caa` nella cartella `Documenti\CAA` dell'utente. Il salvataggio
//! automatico scrive solo qui, mai nel Drive condiviso della biblioteca (M9b).

use std::path::{Path, PathBuf};

use caa_doc::{Document, Manifest, Origin};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::custom::CustomStore;

/// Cartella dei documenti personali: la variabile `CAA_DOCS`; altrimenti `Documenti\CAA` (Windows) o
/// `~/Documents/CAA`; come ultima possibilità accanto al programma.
pub fn docs_dir(
    env: Option<&str>,
    userprofile: Option<&str>,
    home: Option<&str>,
    exe_dir: Option<&Path>,
) -> PathBuf {
    if let Some(e) = env.filter(|e| !e.is_empty()) {
        return PathBuf::from(e);
    }
    for base in [userprofile, home] {
        if let Some(b) = base.filter(|b| !b.is_empty()) {
            return Path::new(b).join("Documents").join("CAA");
        }
    }
    exe_dir.unwrap_or_else(|| Path::new(".")).join("documenti")
}

/// Un nome di file semplice: niente cartelle né `..`, estensione `.caa`.
pub fn safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= 120
        && name.ends_with(".caa")
        && name.len() > ".caa".len()
        && !name.starts_with('.')
        && !name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !name.ends_with(" .caa")
}

/// Un nome di file dal titolo: i caratteri che Windows non ammette diventano trattini.
pub fn file_stem_from_title(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    let cleaned: String = cleaned
        .trim()
        .trim_matches('.')
        .trim()
        .chars()
        .take(80)
        .collect();
    let cleaned = cleaned.trim().to_string();
    // Nomi riservati di Windows.
    let reserved = ["con", "prn", "aux", "nul"].contains(&cleaned.to_lowercase().as_str())
        || (cleaned.len() == 4
            && (cleaned.to_lowercase().starts_with("com")
                || cleaned.to_lowercase().starts_with("lpt"))
            && cleaned.as_bytes()[3].is_ascii_digit());
    if cleaned.is_empty() || reserved {
        "Senza titolo".into()
    } else {
        cleaned
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DocEntry {
    pub file: String,
    pub id: String,
    pub title: String,
    pub modified: String,
    pub rev: u32,
    pub author: String,
    pub origin: Option<Origin>,
}

fn entry_of(file: &str, m: &Manifest) -> DocEntry {
    DocEntry {
        file: file.to_string(),
        id: m.id.clone(),
        title: m.title.clone(),
        modified: m.modified.clone(),
        rev: m.rev,
        author: m.author.clone(),
        origin: m.origin.clone(),
    }
}

/// Quello che la pagina manda per salvare.
#[derive(Debug, Deserialize)]
pub struct SavePayload {
    /// Il file di questo documento, se è già stato salvato.
    pub file: Option<String>,
    pub id: Option<String>,
    pub rev: Option<u32>,
    pub title: String,
    pub created: Option<String>,
    pub origin: Option<Origin>,
    #[serde(default)]
    pub prefs: Value,
    #[serde(default)]
    pub sense_locks: Value,
    pub document: Value,
    #[serde(default)]
    pub render: Value,
    /// Gli `uuid` dei simboli personali usati dal documento.
    #[serde(default)]
    pub media: Vec<String>,
    /// La versione del lessico con cui si è risolto `render`.
    #[serde(default)]
    pub lexicon: String,
}

#[derive(Debug, Serialize)]
pub struct MediaMap {
    pub uuid: String,
    /// L'id numerico che il simbolo ha su questo computer.
    pub id: u32,
}

#[derive(Debug, Serialize)]
pub struct Opened {
    pub entry: DocEntry,
    pub document: Value,
    pub render: Value,
    pub prefs: Value,
    pub sense_locks: Value,
    pub lexicon: String,
    pub created: String,
    pub read_only: bool,
    pub media: Vec<MediaMap>,
}

pub struct DocStore {
    dir: PathBuf,
}

impl DocStore {
    pub fn new(dir: PathBuf) -> DocStore {
        DocStore { dir }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, file: &str) -> Result<PathBuf, String> {
        if !safe_file_name(file) {
            return Err("nome di file non valido".into());
        }
        Ok(self.dir.join(file))
    }

    /// I documenti della cartella, i più recenti per primi, e quanti file `.caa` non si leggono (rovinati
    /// o incompleti). I temporanei `.tmp` non contano.
    pub fn list(&self) -> (Vec<DocEntry>, usize) {
        let mut entries = Vec::new();
        let mut broken = 0;
        let Ok(rd) = std::fs::read_dir(&self.dir) else {
            return (entries, 0);
        };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !safe_file_name(&name) {
                continue;
            }
            match caa_doc::read_manifest(&e.path()) {
                Ok(m) => entries.push(entry_of(&name, &m)),
                Err(_) => broken += 1,
            }
        }
        entries.sort_by(|a, b| {
            b.modified
                .cmp(&a.modified)
                .then_with(|| a.file.cmp(&b.file))
        });
        (entries, broken)
    }

    /// Il primo nome libero per un titolo: `Titolo.caa`, poi `Titolo (2).caa`…
    fn free_name(&self, title: &str) -> String {
        let stem = file_stem_from_title(title);
        let mut n = 1;
        loop {
            let name = if n == 1 {
                format!("{stem}.caa")
            } else {
                format!("{stem} ({n}).caa")
            };
            if !self.dir.join(&name).exists() {
                return name;
            }
            n += 1;
        }
    }

    pub fn save(
        &self,
        p: SavePayload,
        custom: &CustomStore,
        author: &str,
        app_version: &str,
    ) -> Result<DocEntry, String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| format!("cartella non disponibile: {e}"))?;
        let file = match &p.file {
            Some(f) => {
                self.path(f)?;
                f.clone()
            }
            None => self.free_name(&p.title),
        };
        let path = self.dir.join(&file);
        // Il documento di questo file, se c'è già: l'identificativo e la data di creazione restano.
        let existing = caa_doc::read_manifest(&path).ok();
        let mut manifest = Manifest::new(&p.title, author, app_version, &p.lexicon);
        if let Some(old) = &existing {
            manifest.id = old.id.clone();
            manifest.created = old.created.clone();
            manifest.subject = old.subject.clone();
            manifest.level = old.level.clone();
            manifest.tags = old.tags.clone();
            manifest.author = old.author.clone();
        } else if let Some(id) =
            p.id.as_deref()
                .filter(|i| caa_doc::valid_media_name(&format!("{i}.webp")))
        {
            manifest.id = id.to_string();
        }
        if let Some(c) = p.created.as_deref().filter(|_| existing.is_none()) {
            manifest.created = c.to_string();
        }
        manifest.rev = existing.as_ref().map_or(p.rev.unwrap_or(0), |m| m.rev) + 1;
        manifest.origin = p.origin.or_else(|| existing.and_then(|m| m.origin));
        manifest.prefs = p.prefs;
        manifest.sense_locks = p.sense_locks;
        let mut media = std::collections::BTreeMap::new();
        for uuid in &p.media {
            if let Some(bytes) = custom.bytes_of_uuid(uuid) {
                media.insert(format!("{uuid}.webp"), bytes);
            }
        }
        let doc = Document {
            manifest,
            document: p.document,
            render: p.render,
            media,
        };
        caa_doc::write(&path, &doc).map_err(|e| e.to_string())?;
        Ok(entry_of(&file, &doc.manifest))
    }

    pub fn open(&self, file: &str, custom: &CustomStore) -> Result<Opened, String> {
        let path = self.path(file)?;
        let loaded = caa_doc::read(&path).map_err(|e| e.to_string())?;
        let mut media = Vec::new();
        for (name, bytes) in &loaded.doc.media {
            let uuid = name.trim_end_matches(".webp");
            let symbol = custom.import_uuid(uuid, bytes, "")?;
            media.push(MediaMap {
                uuid: symbol.uuid,
                id: symbol.id,
            });
        }
        let m = &loaded.doc.manifest;
        Ok(Opened {
            entry: entry_of(file, m),
            document: loaded.doc.document,
            render: loaded.doc.render,
            prefs: m.prefs.clone(),
            sense_locks: m.sense_locks.clone(),
            lexicon: m.lexicon_version.clone(),
            created: m.created.clone(),
            read_only: loaded.read_only,
            media,
        })
    }

    pub fn delete(&self, file: &str) -> Result<(), String> {
        let path = self.path(file)?;
        std::fs::remove_file(path).map_err(|e| format!("non riesco a eliminare il documento: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("caa-docs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn webp(n: usize) -> Vec<u8> {
        let mut v = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        v.resize(n.max(20), 3);
        v
    }

    fn payload(title: &str) -> SavePayload {
        SavePayload {
            file: None,
            id: None,
            rev: None,
            title: title.into(),
            created: None,
            origin: None,
            prefs: json!({"size": 68}),
            sense_locks: json!([]),
            document: json!({"type":"doc","content":[]}),
            render: json!([]),
            media: vec![],
            lexicon: "lex-1".into(),
        }
    }

    #[test]
    fn nomi_di_file_sicuri() {
        for ok in ["storia.caa", "La storia di è (2).caa", "a b.caa"] {
            assert!(safe_file_name(ok), "{ok}");
        }
        for bad in [
            "",
            ".caa",
            "x.txt",
            "../x.caa",
            "a/b.caa",
            "a\\b.caa",
            "C:x.caa",
            ".nascosto.caa",
            "a\u{0}.caa",
            "x.caa.tmp",
            &format!("{}.caa", "x".repeat(130)),
        ] {
            assert!(!safe_file_name(bad), "{bad:?}");
        }
        assert_eq!(
            file_stem_from_title("Il gatto: storia?"),
            "Il gatto- storia-"
        );
        assert_eq!(file_stem_from_title("  ..  "), "Senza titolo");
        assert_eq!(file_stem_from_title("CON"), "Senza titolo");
        assert_eq!(file_stem_from_title("com1"), "Senza titolo");
        assert_eq!(file_stem_from_title(""), "Senza titolo");
        assert_eq!(file_stem_from_title(&"a".repeat(200)).chars().count(), 80);
        assert!(safe_file_name(&format!(
            "{}.caa",
            file_stem_from_title("a<b>c|d")
        )));
    }

    #[test]
    fn dove_stanno_i_documenti() {
        let exe = Path::new("/app");
        assert_eq!(
            docs_dir(Some("/x"), Some("/u"), Some("/h"), Some(exe)),
            PathBuf::from("/x")
        );
        assert_eq!(
            docs_dir(None, Some("/u"), Some("/h"), Some(exe)),
            Path::new("/u").join("Documents").join("CAA")
        );
        assert_eq!(
            docs_dir(Some(""), None, Some("/h"), Some(exe)),
            Path::new("/h").join("Documents").join("CAA")
        );
        assert_eq!(
            docs_dir(None, None, None, Some(exe)),
            PathBuf::from("/app/documenti")
        );
    }

    #[test]
    fn salva_riapre_e_il_salvataggio_automatico_sovrascrive() {
        let (dd, cd) = (tmp("doc"), tmp("cust"));
        let (store, custom) = (DocStore::new(dd.clone()), CustomStore::open(cd.clone()));
        let first = store
            .save(payload("La mia storia"), &custom, "Maria", "0.1.0")
            .unwrap();
        assert_eq!(first.file, "La mia storia.caa");
        assert_eq!((first.rev, first.author.as_str()), (1, "Maria"));
        // Salvare di nuovo lo stesso file (salvataggio automatico): stesso documento, revisione avanti.
        let mut again = payload("La mia storia (titolo cambiato)");
        again.file = Some(first.file.clone());
        again.rev = Some(first.rev);
        let second = store.save(again, &custom, "Altro", "0.1.0").unwrap();
        assert_eq!(
            (second.file.as_str(), second.id.as_str()),
            (first.file.as_str(), first.id.as_str())
        );
        assert_eq!(
            (second.rev, second.title.as_str()),
            (2, "La mia storia (titolo cambiato)")
        );
        assert_eq!(second.author, "Maria"); // l'autore resta quello del primo salvataggio
                                            // Un secondo documento con lo stesso titolo non sovrascrive il primo.
        let other = store
            .save(payload("La mia storia"), &custom, "Maria", "0.1.0")
            .unwrap();
        assert_eq!(other.file, "La mia storia (2).caa");
        assert_ne!(other.id, first.id);
        let (list, broken) = store.list();
        assert_eq!((list.len(), broken), (2, 0));
        let opened = store.open(&first.file, &custom).unwrap();
        assert_eq!(
            (opened.entry.id.as_str(), opened.read_only),
            (first.id.as_str(), false)
        );
        assert_eq!(opened.prefs, json!({"size": 68}));
        assert_eq!(opened.lexicon, "lex-1");
        store.delete(&other.file).unwrap();
        assert_eq!(store.list().0.len(), 1);
        std::fs::remove_dir_all(&dd).unwrap();
        let _ = std::fs::remove_dir_all(&cd);
    }

    #[test]
    fn i_simboli_personali_viaggiano_nel_documento_da_un_pc_all_altro() {
        let (dd, ca, cb) = (tmp("viaggio"), tmp("pc-a"), tmp("pc-b"));
        let (store, pc_a, pc_b) = (
            DocStore::new(dd.clone()),
            CustomStore::open(ca.clone()),
            CustomStore::open(cb.clone()),
        );
        let sym = pc_a.save(&webp(80), "mamma").unwrap();
        let mut p = payload("Con immagine");
        p.media = vec![sym.uuid.clone(), "non-esiste-qui".into()];
        let saved = store.save(p, &pc_a, "Maria", "0.1.0").unwrap();
        // Sull'altro PC (raccolta vuota) il documento si apre e il simbolo compare nella raccolta.
        let opened = store.open(&saved.file, &pc_b).unwrap();
        assert_eq!(opened.media.len(), 1);
        assert_eq!(opened.media[0].uuid, sym.uuid);
        assert_eq!(
            std::fs::read(pc_b.path_of(opened.media[0].id).unwrap()).unwrap(),
            webp(80)
        );
        // Riaprirlo non lo duplica.
        store.open(&saved.file, &pc_b).unwrap();
        assert_eq!(pc_b.list().len(), 1);
        for d in [&dd, &ca, &cb] {
            std::fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn elenco_con_file_rotti_e_temporanei() {
        let (dd, cd) = (tmp("elenco"), tmp("elenco-c"));
        let (store, custom) = (DocStore::new(dd.clone()), CustomStore::open(cd.clone()));
        store.save(payload("Buono"), &custom, "M", "0.1.0").unwrap();
        // Un file troncato (come un download di Drive a metà), un temporaneo e un file qualunque.
        let good = std::fs::read(dd.join("Buono.caa")).unwrap();
        std::fs::write(dd.join("Tagliato.caa"), &good[..good.len() / 2]).unwrap();
        std::fs::write(dd.join("Buono.caa.123.tmp"), &good).unwrap();
        std::fs::write(dd.join("appunti.txt"), b"x").unwrap();
        let (list, broken) = store.list();
        assert_eq!(
            list.iter().map(|e| e.file.as_str()).collect::<Vec<_>>(),
            vec!["Buono.caa"]
        );
        assert_eq!(broken, 1);
        // Aprire un file rotto o con nome sbagliato è un errore pulito.
        assert!(store.open("Tagliato.caa", &custom).is_err());
        for bad in ["../x.caa", "a/b.caa", "x.txt", ""] {
            assert!(store.open(bad, &custom).is_err(), "{bad:?}");
            assert!(store.delete(bad).is_err(), "{bad:?}");
        }
        let mut p = payload("x");
        p.file = Some("../fuori.caa".into());
        assert!(store.save(p, &custom, "M", "0.1.0").is_err());
        // Una cartella che non esiste ancora: elenco vuoto, non un errore.
        assert_eq!(DocStore::new(dd.join("non-c-e")).list(), (vec![], 0));
        std::fs::remove_dir_all(&dd).unwrap();
        let _ = std::fs::remove_dir_all(&cd);
    }
}
