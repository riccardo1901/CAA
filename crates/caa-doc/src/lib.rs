//! Il documento `.caa` (SPEC.md, "Formato file"): un archivio ZIP con dentro JSON leggibile e le
//! immagini dei simboli personali. Questa libreria non conosce l'interfaccia né il motore: legge e
//! scrive il file, controlla che sia completo e valido, porta le migrazioni di schema e scrive sempre in
//! modo atomico (file temporaneo e rinomina), anche su una cartella sincronizzata da Google Drive.
//!
//! ```text
//! storia.caa
//!   manifest.json     metadati e versioni
//!   document.json     il documento dell'editor (testo, formattazione, scelte del docente)
//!   render.json       i pittogrammi risolti al salvataggio, per token
//!   media/<id>.webp   i simboli personali usati nel documento
//! ```

use std::collections::BTreeMap;
use std::fmt;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Lo schema che questa versione del programma scrive. Cresce a ogni modifica incompatibile.
pub const SCHEMA: u32 = 1;

/// Tetti di sicurezza in lettura (un file di rete o scaricato può essere qualunque cosa).
pub const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_MEDIA: usize = 2000;

/// Da quale documento è nata una copia ("Adatta").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Origin {
    pub id: String,
    pub rev: u32,
}

/// Metadati e versioni (`manifest.json`). `prefs` e `sense_locks` sono dati dell'interfaccia: per la
/// libreria sono JSON qualunque, che torna com'è.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub lexicon_version: String,
    pub id: String,
    #[serde(default)]
    pub rev: u32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub modified: String,
    #[serde(default)]
    pub origin: Option<Origin>,
    #[serde(default)]
    pub prefs: Value,
    #[serde(default)]
    pub sense_locks: Value,
    /// Le immagini che il file deve contenere (nomi sotto `media/`): la scrittura lo compila da sola e la
    /// lettura lo controlla, così un'immagine persa per un byte rovinato non passa inosservata.
    #[serde(default)]
    pub media: Vec<String>,
    /// La revisione che questo documento ha in biblioteca, se è stato pubblicato (lo ricorda per «Aggiorna in
    /// biblioteca»: se la biblioteca è andata avanti da sola, non si sovrascrive).
    #[serde(default)]
    pub published_rev: Option<u32>,
    /// Il nome utente di Windows di chi ha pubblicato (in biblioteca): serve a riconoscere l'autore anche se
    /// due docenti scelgono lo stesso nome da mostrare. Assente nei documenti più vecchi.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_user: Option<String>,
    /// `render.json` deve esserci (la scrittura lo mette sempre): se manca, il file è rovinato.
    #[serde(default)]
    pub has_render: bool,
}

impl Manifest {
    /// Un manifest nuovo, con identificativo e date di adesso.
    pub fn new(title: &str, author: &str, app_version: &str, lexicon_version: &str) -> Manifest {
        let now = now_iso();
        Manifest {
            schema: SCHEMA,
            app_version: app_version.into(),
            lexicon_version: lexicon_version.into(),
            id: new_id(),
            rev: 1,
            title: title.into(),
            author: author.into(),
            subject: String::new(),
            level: String::new(),
            tags: Vec::new(),
            created: now.clone(),
            modified: now,
            origin: None,
            prefs: Value::Null,
            sense_locks: Value::Null,
            media: Vec::new(),
            published_rev: None,
            author_user: None,
            has_render: false,
        }
    }
}

/// Un documento in memoria.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub manifest: Manifest,
    pub document: Value,
    pub render: Value,
    /// Nome del file (senza cartella, es. `3f2a….webp`) → immagine.
    pub media: BTreeMap<String, Vec<u8>>,
}

/// Un documento letto dal disco.
#[derive(Debug, Clone, PartialEq)]
pub struct Loaded {
    pub doc: Document,
    /// Il file è di uno schema più recente del programma: si apre ma non si deve riscrivere.
    pub read_only: bool,
    /// Lo schema del file, se è stato portato avanti con le migrazioni.
    pub migrated_from: Option<u32>,
}

#[derive(Debug)]
pub enum DocError {
    /// Il file non c'è o non si apre.
    Io(std::io::Error),
    /// Non è un `.caa` completo e valido: troncato (magari ancora in sincronizzazione), rovinato, o
    /// non è uno ZIP. Il messaggio dice cosa non va.
    Unreadable(String),
    /// Troppo grande rispetto ai tetti di sicurezza.
    TooBig(String),
}

impl fmt::Display for DocError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DocError::Io(e) => write!(f, "file non leggibile: {e}"),
            DocError::Unreadable(m) => write!(f, "documento incompleto o rovinato: {m}"),
            DocError::TooBig(m) => write!(f, "documento troppo grande: {m}"),
        }
    }
}

impl std::error::Error for DocError {}

impl From<std::io::Error> for DocError {
    fn from(e: std::io::Error) -> Self {
        DocError::Io(e)
    }
}

/// 32 caratteri esadecimali non prevedibili (senza dipendenze nuove): ora, contatore e il caso che
/// il sistema dà a ogni `RandomState`.
pub fn new_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let part = |salt: u64| {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(now);
        h.write_u64(n);
        h.write_u64(salt);
        h.finish()
    };
    format!("{:016x}{:016x}", part(1), part(2))
}

/// Data e ora di adesso in UTC, `2026-11-25T10:42:07Z` (senza dipendenze nuove).
pub fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    iso_from_unix(secs)
}

fn iso_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Giorni dal 1970-01-01 → data civile (algoritmo di Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Un nome di immagine valido (niente cartelle, niente `..`): lettere, cifre, `-` e `_`, poi `.webp`.
pub fn valid_media_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".webp") else {
        return false;
    };
    !stem.is_empty()
        && stem.len() <= 64
        && stem
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

// ---------------------------------------------------------------------------------------
// Migrazioni
// ---------------------------------------------------------------------------------------

/// Un passo di migrazione: porta manifest e documento dallo schema `n` allo schema `n + 1`.
pub type MigrationStep = fn(&mut Value, &mut Value);

/// I passi del programma, dal primo schema in poi: `MIGRATIONS[0]` porta dallo schema 1 al 2. Oggi lo
/// schema 1 è l'unico e non ce ne sono.
pub const MIGRATIONS: &[MigrationStep] = &[];

/// Porta avanti un documento da `from` a `to` con i passi dati. Restituisce lo schema finale.
pub fn migrate_with(
    steps: &[MigrationStep],
    from: u32,
    to: u32,
    manifest: &mut Value,
    document: &mut Value,
) -> Result<u32, DocError> {
    let mut schema = from;
    while schema < to {
        let step = steps.get(schema as usize - 1).ok_or_else(|| {
            DocError::Unreadable(format!("manca la migrazione dallo schema {schema}"))
        })?;
        step(manifest, document);
        schema += 1;
        manifest["schema"] = Value::from(schema);
    }
    Ok(schema)
}

// ---------------------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------------------

fn bad(msg: impl Into<String>) -> DocError {
    DocError::Unreadable(msg.into())
}

fn read_entry<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
    budget: &mut u64,
) -> Result<Vec<u8>, DocError> {
    let file = zip
        .by_name(name)
        .map_err(|e| bad(format!("manca «{name}» ({e})")))?;
    read_limited(file, name, budget)
}

/// Legge una voce con i tetti di sicurezza; il controllo dei CRC lo fa la libreria ZIP.
fn read_limited<R: Read>(mut file: R, name: &str, budget: &mut u64) -> Result<Vec<u8>, DocError> {
    let mut buf = Vec::new();
    let limit = MAX_ENTRY_BYTES.min(*budget);
    (&mut file)
        .take(limit + 1)
        .read_to_end(&mut buf)
        .map_err(|e| bad(format!("«{name}» non si legge ({e})")))?;
    if buf.len() as u64 > limit {
        return Err(DocError::TooBig(format!("«{name}»")));
    }
    *budget -= buf.len() as u64;
    Ok(buf)
}

fn parse(bytes: &[u8], name: &str) -> Result<Value, DocError> {
    serde_json::from_slice(bytes).map_err(|e| bad(format!("«{name}» non è un JSON valido ({e})")))
}

/// Legge un documento completo. Un file più nuovo del programma si legge lo stesso, con
/// `read_only = true`; uno più vecchio si porta allo schema attuale con le migrazioni.
pub fn read(path: &Path) -> Result<Loaded, DocError> {
    let file = std::fs::File::open(path)?;
    read_from(file)
}

/// I nomi delle voci come stanno nella directory centrale dello ZIP, uno per ognuna (la libreria ZIP ne tiene
/// una sola per nome, quindi i duplicati si vedono solo qui). `None` se non si riesce a leggerla (ZIP64…).
fn central_directory_names<R: Read + Seek>(r: &mut R) -> std::io::Result<Option<Vec<String>>> {
    use std::io::SeekFrom;
    let len = r.seek(SeekFrom::End(0))?;
    let tail_len = len.min(22 + 65_535);
    r.seek(SeekFrom::Start(len - tail_len))?;
    let mut tail = vec![0u8; tail_len as usize];
    r.read_exact(&mut tail)?;
    let Some(pos) = tail.windows(4).rposition(|w| w == [0x50, 0x4b, 0x05, 0x06]) else {
        return Ok(None);
    };
    let eocd = &tail[pos..];
    if eocd.len() < 22 {
        return Ok(None);
    }
    let count = u16::from_le_bytes([eocd[10], eocd[11]]) as usize;
    let size = u64::from(u32::from_le_bytes([eocd[12], eocd[13], eocd[14], eocd[15]]));
    let offset = u64::from(u32::from_le_bytes([eocd[16], eocd[17], eocd[18], eocd[19]]));
    if count == 0xFFFF || offset == 0xFFFF_FFFF || size > 16 * 1024 * 1024 || offset + size > len {
        return Ok(None);
    }
    r.seek(SeekFrom::Start(offset))?;
    let mut dir = vec![0u8; size as usize];
    r.read_exact(&mut dir)?;
    let mut names = Vec::new();
    let mut i = 0usize;
    while i + 46 <= dir.len() && dir[i..i + 4] == [0x50, 0x4b, 0x01, 0x02] {
        let n = u16::from_le_bytes([dir[i + 28], dir[i + 29]]) as usize;
        let extra = u16::from_le_bytes([dir[i + 30], dir[i + 31]]) as usize;
        let comment = u16::from_le_bytes([dir[i + 32], dir[i + 33]]) as usize;
        let Some(raw) = dir.get(i + 46..i + 46 + n) else {
            return Ok(None);
        };
        names.push(String::from_utf8_lossy(raw).into_owned());
        i += 46 + n + extra + comment;
    }
    Ok(Some(names))
}

pub fn read_from<R: Read + Seek>(mut reader: R) -> Result<Loaded, DocError> {
    // Due voci con lo stesso nome: quale vale? Si rifiuta il file (il programma non ne scrive mai).
    if let Ok(Some(names)) = central_directory_names(&mut reader) {
        let mut seen = std::collections::HashSet::new();
        if let Some(dup) = names.iter().find(|n| !seen.insert(n.as_str())) {
            return Err(bad(format!("voce duplicata «{dup}»")));
        }
    }
    reader.rewind()?;
    let mut zip = zip::ZipArchive::new(reader)
        .map_err(|e| bad(format!("non è un archivio completo ({e})")))?;
    let mut budget = MAX_TOTAL_BYTES;
    let mut manifest = parse(
        &read_entry(&mut zip, "manifest.json", &mut budget)?,
        "manifest.json",
    )?;
    let mut document = parse(
        &read_entry(&mut zip, "document.json", &mut budget)?,
        "document.json",
    )?;
    // `render.json` è un'istantanea: in un file scritto da noi c'è sempre (il manifest lo dice) e se manca il
    // file è rovinato; in un file di altra origine senza, il documento si apre lo stesso.
    let render = match zip.by_name("render.json") {
        Ok(f) => parse(&read_limited(f, "render.json", &mut budget)?, "render.json")?,
        Err(_) if manifest.get("has_render").and_then(Value::as_bool) == Some(true) => {
            return Err(bad("manca «render.json»"));
        }
        Err(_) => Value::Null,
    };
    let schema = manifest
        .get("schema")
        .and_then(Value::as_u64)
        .filter(|s| *s >= 1 && *s <= u64::from(u32::MAX))
        .ok_or_else(|| bad("schema mancante o non valido"))? as u32;
    let (read_only, migrated_from) = if schema > SCHEMA {
        (true, None)
    } else if schema < SCHEMA {
        migrate_with(MIGRATIONS, schema, SCHEMA, &mut manifest, &mut document)?;
        (false, Some(schema))
    } else {
        (false, None)
    };
    let manifest: Manifest =
        serde_json::from_value(manifest).map_err(|e| bad(format!("manifest non valido ({e})")))?;
    let mut media = BTreeMap::new();
    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.name_for_index(i).map(str::to_string))
        .filter_map(|n| n.strip_prefix("media/").map(str::to_string))
        .filter(|n| !n.is_empty())
        .collect();
    if names.len() > MAX_MEDIA {
        return Err(DocError::TooBig("troppe immagini".into()));
    }
    for name in names {
        if !valid_media_name(&name) {
            continue; // una voce con un nome strano non si legge e non si riscrive
        }
        let bytes = read_entry(&mut zip, &format!("media/{name}"), &mut budget)?;
        media.insert(name, bytes);
    }
    if let Some(missing) = manifest.media.iter().find(|n| !media.contains_key(*n)) {
        return Err(bad(format!("manca l'immagine «{missing}»")));
    }
    Ok(Loaded {
        doc: Document {
            manifest,
            document,
            render,
            media,
        },
        read_only,
        migrated_from,
    })
}

/// Solo i metadati (per l'indice della biblioteca): non legge il documento né le immagini.
pub fn read_manifest(path: &Path) -> Result<Manifest, DocError> {
    let file = std::fs::File::open(path)?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| bad(format!("non è un archivio completo ({e})")))?;
    let mut budget = MAX_ENTRY_BYTES;
    let bytes = read_entry(&mut zip, "manifest.json", &mut budget)?;
    serde_json::from_slice(&bytes).map_err(|e| bad(format!("manifest non valido ({e})")))
}

// ---------------------------------------------------------------------------------------
// Scrittura
// ---------------------------------------------------------------------------------------

/// Un `Write` che si rompe dopo un certo numero di byte: serve alle prove per simulare
/// un'interruzione a metà scrittura (disco pieno, cavo staccato, Drive che si ferma).
struct FailAfter<W> {
    inner: W,
    left: u64,
}

impl<W: Write> Write for FailAfter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.left == 0 {
            return Err(std::io::Error::other("interruzione simulata"));
        }
        let n = buf.len().min(self.left as usize);
        let written = self.inner.write(&buf[..n])?;
        self.left -= written as u64;
        Ok(written)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl<W: Seek> Seek for FailAfter<W> {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

fn write_zip<W: Write + Seek>(w: W, doc: &Document) -> Result<(), DocError> {
    let mut zip = zip::ZipWriter::new(w);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let stored =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let json = |v: &Value| serde_json::to_vec(v).map_err(|e| bad(e.to_string()));
    let put = |zip: &mut zip::ZipWriter<W>, name: &str, bytes: &[u8], o| -> Result<(), DocError> {
        zip.start_file(name, o).map_err(|e| bad(e.to_string()))?;
        zip.write_all(bytes)?;
        Ok(())
    };
    let mut listed = doc.manifest.clone();
    listed.media = doc.media.keys().cloned().collect();
    listed.has_render = true;
    let manifest = serde_json::to_vec_pretty(&listed).map_err(|e| bad(e.to_string()))?;
    put(&mut zip, "manifest.json", &manifest, opts)?;
    put(&mut zip, "document.json", &json(&doc.document)?, opts)?;
    put(&mut zip, "render.json", &json(&doc.render)?, opts)?;
    for (name, bytes) in &doc.media {
        if !valid_media_name(name) {
            return Err(bad(format!("nome di immagine non valido: {name}")));
        }
        // Le immagini sono già WebP compresse: non si ricomprimono.
        put(&mut zip, &format!("media/{name}"), bytes, stored)?;
    }
    zip.finish().map_err(|e| bad(e.to_string()))?;
    Ok(())
}

/// Il nome del file temporaneo accanto a `path`: lo stesso nome più il numero del processo, così due
/// copie del programma non si pestano; gli altri PC e l'indice ignorano i `.tmp`.
pub fn tmp_path(path: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    // Anche due scritture dello stesso processo (salvataggio automatico e pubblicazione, o più thread) hanno
    // nomi diversi.
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(format!(
        ".{}.{}.tmp",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    path.with_file_name(name)
}

/// La rinomina finale, con qualche nuovo tentativo: su Windows un antivirus, l'indicizzazione o Drive possono
/// tenere aperto il file di destinazione per un istante (errore di condivisione) e poi lasciarlo.
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for attempt in 0..6 {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                if attempt < 5 {
                    std::thread::sleep(std::time::Duration::from_millis(40 * (attempt + 1)));
                }
            }
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("rinomina non riuscita")))
}

fn write_inner(path: &Path, doc: &Document, fail_after: Option<u64>) -> Result<(), DocError> {
    if doc.manifest.schema != SCHEMA {
        return Err(bad(format!(
            "il programma scrive solo lo schema {SCHEMA} (questo è {})",
            doc.manifest.schema
        )));
    }
    let tmp = tmp_path(path);
    let result = (|| -> Result<(), DocError> {
        let file = std::fs::File::create(&tmp)?;
        match fail_after {
            None => {
                let mut file = file;
                write_zip(&mut file, doc)?;
                file.sync_all()?;
            }
            Some(n) => write_zip(
                FailAfter {
                    inner: file,
                    left: n,
                },
                doc,
            )?,
        }
        // Nome definitivo solo a file completo: chi legge vede il vecchio documento o il nuovo, mai metà.
        rename_with_retry(&tmp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Scrive il documento in modo atomico: prima un file temporaneo accanto, poi la rinomina sopra il file
/// finale. Un'interruzione a metà non lascia mai un documento rotto.
pub fn write(path: &Path, doc: &Document) -> Result<(), DocError> {
    write_inner(path, doc, None)
}

/// Come `write`, ma la scrittura si interrompe dopo `fail_after` byte (solo per le prove).
#[doc(hidden)]
pub fn write_failing_after(path: &Path, doc: &Document, fail_after: u64) -> Result<(), DocError> {
    write_inner(path, doc, Some(fail_after))
}

#[cfg(test)]
mod tests;
