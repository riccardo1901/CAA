//! L'indice della biblioteca: i metadati di ogni documento (dal manifest del `.caa`). Nessun file indice
//! centrale e nessun database nella cartella del Drive: ogni documento porta i suoi metadati e il programma
//! costruisce l'indice in locale, rileggendo solo i file la cui dimensione o data di modifica è cambiata.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Un documento della biblioteca come si vede nell'elenco.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LibEntry {
    /// Il nome del file in `biblioteca\`.
    pub file: String,
    pub id: String,
    pub title: String,
    pub author: String,
    pub subject: String,
    pub level: String,
    pub tags: Vec<String>,
    pub created: String,
    pub modified: String,
    pub rev: u32,
    pub size: u64,
    /// Un altro file ha lo stesso identificativo (Drive ha creato una copia «in conflitto»).
    pub conflict: bool,
    /// Il nome utente di Windows di chi l'ha pubblicato (dal manifest), per sapere chi può ritirarlo (K1). Resta in
    /// memoria: non va nell'elenco salvato in cache né all'interfaccia (il formato dei file non cambia).
    #[serde(skip)]
    pub author_user: Option<String>,
}

/// Il massimo di documenti letti in una scansione (una cartella enorme non deve bloccare il programma).
pub const MAX_DOCS: usize = 20_000;

/// Un nome di documento di biblioteca: `.caa`, niente file nascosti, temporanei (`.tmp`) o blocchi (`.lock`).
pub fn is_doc_name(name: &str) -> bool {
    name.ends_with(".caa")
        && name.len() > ".caa".len()
        && !name.starts_with('.')
        && !name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
}

struct Stamped {
    len: u64,
    mtime: u128,
    entry: LibEntry,
}

/// La memoria della scansione precedente: un file con la stessa dimensione e data non si rilegge.
#[derive(Default)]
pub struct IndexCache {
    map: HashMap<String, Stamped>,
}

#[derive(Debug, Default)]
pub struct Scan {
    /// I documenti letti, i più recenti per primi.
    pub entries: Vec<LibEntry>,
    /// File `.caa` che non si leggono adesso (ancora in sincronizzazione, o rovinati): si riprova alla prossima.
    pub incomplete: usize,
    /// Quanti manifest sono stati riletti (gli altri vengono dalla memoria).
    pub reads: usize,
}

fn mtime_nanos(meta: &std::fs::Metadata) -> u128 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos())
}

/// Legge `biblioteca\` della cartella `root`. Errore se la cartella non si apre (non raggiungibile).
pub fn scan(root: &Path, cache: &mut IndexCache) -> std::io::Result<Scan> {
    let dir = root.join("biblioteca");
    let mut out = Scan::default();
    let mut seen = std::collections::HashSet::new();
    for e in std::fs::read_dir(&dir)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !is_doc_name(&name) || seen.len() >= MAX_DOCS {
            continue;
        }
        let Ok(meta) = e.metadata() else {
            out.incomplete += 1;
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        seen.insert(name.clone());
        let (len, mtime) = (meta.len(), mtime_nanos(&meta));
        if let Some(c) = cache.map.get(&name) {
            if c.len == len && c.mtime == mtime {
                out.entries.push(c.entry.clone());
                continue;
            }
        }
        out.reads += 1;
        match caa_doc::read_manifest(&e.path()) {
            Ok(m) => {
                let entry = LibEntry {
                    file: name.clone(),
                    id: m.id,
                    title: m.title,
                    author: m.author,
                    subject: m.subject,
                    level: m.level,
                    tags: m.tags,
                    created: m.created,
                    modified: m.modified,
                    rev: m.rev,
                    size: len,
                    conflict: false,
                    author_user: m.author_user,
                };
                cache.map.insert(
                    name,
                    Stamped {
                        len,
                        mtime,
                        entry: entry.clone(),
                    },
                );
                out.entries.push(entry);
            }
            Err(_) => {
                cache.map.remove(&name);
                out.incomplete += 1;
            }
        }
    }
    cache.map.retain(|k, _| seen.contains(k));
    // Lo stesso identificativo in più file: Drive ha creato una copia in conflitto.
    let mut count: HashMap<&str, usize> = HashMap::new();
    for e in &out.entries {
        *count.entry(e.id.as_str()).or_default() += 1;
    }
    let dup: std::collections::HashSet<String> = count
        .into_iter()
        .filter(|(_, n)| *n > 1)
        .map(|(id, _)| id.to_string())
        .collect();
    for e in &mut out.entries {
        e.conflict = dup.contains(&e.id);
    }
    out.entries.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.file.cmp(&b.file))
    });
    Ok(out)
}

const INDEX_FILE: &str = "index.json";

/// Salva l'ultimo elenco letto (per consultare la biblioteca senza il Drive).
pub fn save_index(dir: &Path, entries: &[LibEntry]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{INDEX_FILE}.{}.tmp", std::process::id()));
    std::fs::write(
        &tmp,
        serde_json::to_vec(entries).map_err(std::io::Error::other)?,
    )?;
    std::fs::rename(&tmp, dir.join(INDEX_FILE))
}

/// L'ultimo elenco salvato; mancante o rovinato = vuoto.
pub fn load_index(dir: &Path) -> Vec<LibEntry> {
    std::fs::read(dir.join(INDEX_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
