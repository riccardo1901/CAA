//! Scrivere nella biblioteca: Pubblica, Aggiorna, Ritira (SPEC.md, "Operazioni" e "Scritture sicure"). Le
//! regole, in breve:
//!
//! - **Pubblica** non sovrascrive mai: un documento nuovo, con l'id del documento personale.
//! - **Aggiorna** solo l'autore, con un blocco indicativo (`<id>.lock`, scade dopo 2 ore) e il controllo della
//!   revisione: se la biblioteca è andata avanti, il documento si salva come nuovo e lo si dice.
//! - **Ritira** sposta in `archivio\` (l'autore o un amministratore): non si cancella.
//! - Ogni scrittura è atomica (file temporaneo accanto e rinomina), così gli altri PC non vedono mai un
//!   documento a metà. Il blocco su un Drive sincronizzato arriva agli altri con ritardo: protegge dal caso
//!   comune, non da due scritture nello stesso istante; la revisione fa il resto.

use std::path::{Path, PathBuf};

use caa_doc::{DocError, Document, Origin};

/// Dopo quanto un blocco non vale più (SPEC.md: 2 ore).
pub const LOCK_SECONDS: u64 = 2 * 60 * 60;

/// Dopo quanto un blocco *mio* rimasto (programma chiuso a metà) si riprende: un aggiornamento dura secondi.
pub const OWN_LOCK_SECONDS: u64 = 5 * 60;

/// Il nome di un documento nella biblioteca.
pub fn library_file(id: &str) -> String {
    format!("{id}.caa")
}

fn valid_id(id: &str) -> bool {
    caa_doc::valid_media_name(&format!("{id}.webp"))
}

/// Due nomi di utente sono lo stesso (senza badare a maiuscole e spazi ai lati).
pub fn same_user(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim().to_lowercase(), b.trim().to_lowercase());
    !a.is_empty() && a == b
}

#[derive(Debug, PartialEq)]
pub enum LibError {
    /// Il documento di biblioteca con questo id c'è già (si usa «Aggiorna»).
    AlreadyPublished,
    /// Il documento non c'è (più) in biblioteca.
    NotFound,
    /// Solo l'autore può aggiornare o (con un amministratore) ritirare.
    NotAuthor { author: String },
    /// Qualcun altro lo sta aggiornando: nome e ora (secondi dal 1970) del blocco.
    Locked { by: String, at: u64 },
    /// Un errore di lettura o scrittura.
    Io(String),
}

impl std::fmt::Display for LibError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LibError::AlreadyPublished => write!(
                f,
                "questo documento è già in biblioteca: usa «Aggiorna in biblioteca»"
            ),
            LibError::NotFound => write!(f, "il documento non è più in biblioteca"),
            LibError::NotAuthor { author } => write!(f, "solo l'autore ({author}) può farlo"),
            LibError::Locked { by, .. } => {
                write!(f, "{by} lo sta aggiornando adesso: riprova tra poco")
            }
            LibError::Io(m) => write!(f, "{m}"),
        }
    }
}

impl From<DocError> for LibError {
    fn from(e: DocError) -> Self {
        LibError::Io(e.to_string())
    }
}

impl From<std::io::Error> for LibError {
    fn from(e: std::io::Error) -> Self {
        LibError::Io(e.to_string())
    }
}

/// Come si scrive un documento (le prove ci mettono una scrittura che si interrompe).
pub type Writer<'a> = &'a dyn Fn(&Path, &Document) -> Result<(), DocError>;

fn lib_dir(root: &Path) -> PathBuf {
    root.join("biblioteca")
}

/// Pubblica: un documento nuovo in biblioteca, con l'id del documento personale, revisione 1 e l'autore dato.
/// Non sovrascrive mai niente: se c'è già un file o un documento con quell'id, errore.
pub fn publish(root: &Path, doc: &Document, author: &str) -> Result<Document, LibError> {
    publish_using(root, doc, author, &|p, d| caa_doc::write(p, d))
}

pub fn publish_using(
    root: &Path,
    doc: &Document,
    author: &str,
    write: Writer,
) -> Result<Document, LibError> {
    let id = &doc.manifest.id;
    if !valid_id(id) {
        return Err(LibError::Io(
            "identificativo del documento non valido".into(),
        ));
    }
    let dir = lib_dir(root);
    let path = dir.join(library_file(id));
    if path.exists() {
        return Err(LibError::AlreadyPublished);
    }
    // Un altro file con lo stesso documento (per esempio una copia in conflitto) conta come già pubblicato.
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if crate::index::is_doc_name(&name)
                && caa_doc::read_manifest(&e.path()).is_ok_and(|m| &m.id == id)
            {
                return Err(LibError::AlreadyPublished);
            }
        }
    }
    let mut lib_doc = doc.clone();
    let m = &mut lib_doc.manifest;
    m.rev = 1;
    m.author = author.to_string();
    m.modified = caa_doc::now_iso();
    m.published_rev = None; // la biblioteca non tiene il ricordo del documento personale
    write(&path, &lib_doc)?;
    Ok(lib_doc)
}

/// Cosa è successo con «Aggiorna in biblioteca».
#[derive(Debug, PartialEq)]
pub enum Updated {
    /// La stessa revisione avanti di uno.
    Revision { rev: u32 },
    /// La biblioteca era andata avanti da sola: il documento è stato salvato come nuovo (con questo id nuovo).
    SavedAsNew { id: String },
}

#[derive(serde::Serialize, serde::Deserialize)]
struct LockFile {
    user: String,
    /// Secondi dal 1970.
    at: u64,
}

/// Il blocco di un documento mentre l'autore lo aggiorna: si toglie da solo quando finisce (anche in caso di errore).
pub struct LockGuard {
    path: PathBuf,
    user: String,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        // Si toglie solo se è ancora il mio (qualcuno potrebbe averlo preso dopo la scadenza).
        if let Some(l) = read_lock(&self.path) {
            if l.user == self.user {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }
}

fn read_lock(path: &Path) -> Option<LockFile> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
}

/// Il file è stato modificato negli ultimi secondi (orologio del sistema, non quello dell'argomento `now`).
fn is_young(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < std::time::Duration::from_secs(10))
}

/// Prende il blocco di `<id>.lock`. Se c'è e non è scaduto e non è mio: `Locked`. Un blocco scaduto o rovinato si
/// riprende. La creazione è esclusiva (se due lo creano insieme, uno solo ci riesce).
pub fn acquire_lock(path: &Path, user: &str, now: u64) -> Result<LockGuard, LibError> {
    use std::io::Write;
    for _ in 0..6 {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
        {
            Ok(mut f) => {
                let body = serde_json::to_vec(&LockFile {
                    user: user.to_string(),
                    at: now,
                })
                .map_err(std::io::Error::other)?;
                f.write_all(&body)?;
                f.sync_all()?;
                return Ok(LockGuard {
                    path: path.to_path_buf(),
                    user: user.to_string(),
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => match std::fs::read(path) {
                // Nel frattempo chi lo teneva ha finito: si riprova a prenderlo (non è "rovinato").
                Err(r) if r.kind() == std::io::ErrorKind::NotFound => {}
                Err(r) => return Err(r.into()),
                Ok(bytes) => match serde_json::from_slice::<LockFile>(&bytes) {
                    Ok(l)
                        if now.saturating_sub(l.at)
                            < if l.user == user {
                                OWN_LOCK_SECONDS
                            } else {
                                LOCK_SECONDS
                            } =>
                    {
                        return Err(LibError::Locked {
                            by: l.user,
                            at: l.at,
                        });
                    }
                    parsed => {
                        // Illeggibile ma appena creato: chi lo ha creato lo sta ancora scrivendo (il file nasce
                        // vuoto e si riempie un istante dopo). Non è rovinato: è preso da qualcuno.
                        if parsed.is_err() && is_young(path) {
                            return Err(LibError::Locked {
                                by: "un altro utente".into(),
                                at: now,
                            });
                        }
                        // Scaduto o davvero rovinato: si toglie solo se è ancora lo stesso (un altro potrebbe
                        // averne appena preso uno nuovo, che non va toccato) e si riprova.
                        if std::fs::read(path).ok().as_deref() == Some(bytes.as_slice()) {
                            let _ = std::fs::remove_file(path);
                        }
                    }
                },
            },
            Err(e) => return Err(e.into()),
        }
    }
    Err(LibError::Io(
        "non riesco a prendere il blocco del documento".into(),
    ))
}

/// Aggiorna in biblioteca: solo l'autore. `known_rev` è la revisione che il documento personale ha letto
/// l'ultima volta (`published_rev`); se la biblioteca è andata avanti, si salva come documento nuovo.
pub fn update(
    root: &Path,
    doc: &Document,
    known_rev: u32,
    user: &str,
    now: u64,
) -> Result<Updated, LibError> {
    update_using(root, doc, known_rev, user, now, &|p, d| {
        caa_doc::write(p, d)
    })
}

pub fn update_using(
    root: &Path,
    doc: &Document,
    known_rev: u32,
    user: &str,
    now: u64,
    write: Writer,
) -> Result<Updated, LibError> {
    let id = &doc.manifest.id;
    if !valid_id(id) {
        return Err(LibError::Io(
            "identificativo del documento non valido".into(),
        ));
    }
    let dir = lib_dir(root);
    let path = dir.join(library_file(id));
    let existing = match caa_doc::read_manifest(&path) {
        Ok(m) => m,
        Err(DocError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(LibError::NotFound)
        }
        Err(e) => return Err(e.into()),
    };
    if !same_user(&existing.author, user) {
        return Err(LibError::NotAuthor {
            author: existing.author,
        });
    }
    let _lock = acquire_lock(&dir.join(format!("{id}.lock")), user, now)?;
    // Riletto con il blocco in mano: la revisione e l'autore di adesso.
    let existing = caa_doc::read_manifest(&path).map_err(|e| match e {
        DocError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => LibError::NotFound,
        other => other.into(),
    })?;
    if existing.rev != known_rev {
        // La biblioteca è andata avanti da sola: niente sovrascrittura, un documento nuovo.
        let mut fresh = doc.clone();
        fresh.manifest.id = caa_doc::new_id();
        let id = fresh.manifest.id.clone();
        publish_using(root, &fresh, user, write)?;
        return Ok(Updated::SavedAsNew { id });
    }
    let mut lib_doc = doc.clone();
    let m = &mut lib_doc.manifest;
    m.rev = existing.rev + 1;
    m.author = existing.author; // l'autore resta quello del documento di biblioteca
    m.created = existing.created;
    m.modified = caa_doc::now_iso();
    m.published_rev = None;
    let rev = m.rev;
    write(&path, &lib_doc)?;
    Ok(Updated::Revision { rev })
}

/// Ritira: il documento esce dalla biblioteca (spostato in `archivio\`, non cancellato). Solo l'autore o un
/// amministratore. Si indica il file (può essere una copia in conflitto, con lo stesso id di un'altra).
pub fn retire(
    root: &Path,
    file: &str,
    display_name: &str,
    os_user: &str,
    admins: &[String],
) -> Result<PathBuf, LibError> {
    if !crate::index::is_doc_name(file) {
        return Err(LibError::Io("nome di file non valido".into()));
    }
    let from = lib_dir(root).join(file);
    let m = match caa_doc::read_manifest(&from) {
        Ok(m) => Some(m),
        Err(DocError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(LibError::NotFound)
        }
        // Un file che non si legge (rovinato o in sincronizzazione) lo può ritirare solo un amministratore.
        Err(_) => None,
    };
    // Gli amministratori sono nomi utente di Windows (non il nome da mostrare, che ognuno sceglie);
    // l'autore si riconosce dal nome da mostrare.
    let is_admin = admins.iter().any(|a| same_user(a, os_user));
    let is_author = m
        .as_ref()
        .is_some_and(|m| same_user(&m.author, display_name));
    if !is_author && !is_admin {
        return Err(LibError::NotAuthor {
            author: m.map(|m| m.author).unwrap_or_default(),
        });
    }
    // Si ritira con il blocco del documento in mano: se qualcuno lo sta aggiornando, la sua scrittura
    // rimetterebbe il documento in biblioteca. (Un id che non è un nome valido non dà mai un percorso.)
    let _lock = match m.as_ref().filter(|m| valid_id(&m.id)) {
        Some(m) => Some(acquire_lock(
            &lib_dir(root).join(format!("{}.lock", m.id)),
            display_name,
            now_secs(),
        )?),
        None => None,
    };
    let dir = root.join("archivio");
    std::fs::create_dir_all(&dir)?;
    let stem = file.trim_end_matches(".caa");
    let mut to = dir.join(file);
    let mut n = 2;
    while to.exists() {
        to = dir.join(format!("{stem} ({n}).caa"));
        n += 1;
    }
    std::fs::rename(&from, &to)?;
    Ok(to)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// La revisione che `author` ha già in biblioteca per il documento `id` (per ritrovare il ricordo della
/// pubblicazione se il documento personale l'ha perso): `None` se non c'è o l'autore è un altro.
pub fn existing_rev(root: &Path, id: &str, author: &str) -> Option<u32> {
    if !valid_id(id) {
        return None;
    }
    let m = caa_doc::read_manifest(&lib_dir(root).join(library_file(id))).ok()?;
    (m.id == id && same_user(&m.author, author)).then_some(m.rev)
}

/// Se la biblioteca ha una revisione più nuova dell'originale da cui è nata una copia.
pub fn original_update<'a>(
    entries: &'a [crate::index::LibEntry],
    origin: &Origin,
) -> Option<&'a crate::index::LibEntry> {
    entries
        .iter()
        .filter(|e| e.id == origin.id && e.rev > origin.rev && !e.conflict)
        .max_by_key(|e| e.rev)
}

/// Confronta due versioni a numeri puntati (`0.2.0`, `1.10`): `true` se `available` è più recente di `current`.
pub fn newer_version(current: &str, available: &str) -> bool {
    let parse = |v: &str| -> Option<Vec<u64>> {
        let t = v.trim().trim_start_matches('v');
        if t.is_empty() || t.len() > 40 {
            return None;
        }
        t.split('.').map(|p| p.parse::<u64>().ok()).collect()
    };
    let (Some(c), Some(a)) = (parse(current), parse(available)) else {
        return false;
    };
    let n = c.len().max(a.len());
    for i in 0..n {
        let (x, y) = (
            c.get(i).copied().unwrap_or(0),
            a.get(i).copied().unwrap_or(0),
        );
        if y != x {
            return y > x;
        }
    }
    false
}
