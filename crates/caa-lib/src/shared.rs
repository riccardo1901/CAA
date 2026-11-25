//! I simboli personali condivisi dalla scuola (`simboli\` nel Drive): `<uuid>.webp` + `<uuid>.json`.
//! Il `.json` si scrive per ultimo: senza, il simbolo è ancora in sincronizzazione e non si mostra. Non si
//! sovrascrive mai niente. Ritirare sposta in `archivio\`: l'autore (per nome utente di Windows) o un
//! amministratore.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::publish::{is_author, same_user, LibError};

/// Tetto alla dimensione di un'immagine condivisa.
pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
/// Tetto al numero di simboli letti dall'elenco.
const MAX_LISTED: usize = 5000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SharedMeta {
    pub label: String,
    pub author: String,
    #[serde(default)]
    pub author_user: String,
    /// Secondi dal 1970.
    #[serde(default)]
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SharedSymbol {
    pub uuid: String,
    pub label: String,
    pub author: String,
    pub at: u64,
}

fn dir(root: &Path) -> PathBuf {
    root.join("simboli")
}

fn valid_uuid(u: &str) -> bool {
    caa_doc::valid_media_name(&format!("{u}.webp"))
}

fn is_webp(b: &[u8]) -> bool {
    b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP"
}

fn clean_label(l: &str) -> String {
    l.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(60)
        .collect()
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), LibError> {
    let tmp = caa_doc::tmp_path(path);
    let res = std::fs::write(&tmp, bytes).and_then(|_| {
        // Mai sopra un file che c'è già (un altro PC può averlo appena scritto).
        if path.exists() {
            Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists))
        } else {
            std::fs::rename(&tmp, path)
        }
    });
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res.map_err(Into::into)
}

/// Condivide un simbolo con la scuola. Se c'è già un simbolo con questo `uuid` non lo tocca (stessa immagine
/// condivisa due volte) e restituisce quello che c'è.
pub fn share(
    root: &Path,
    uuid: &str,
    image: &[u8],
    label: &str,
    author: &str,
    os_user: &str,
    now: u64,
) -> Result<SharedSymbol, LibError> {
    if !valid_uuid(uuid) {
        return Err(LibError::Io("identificativo del simbolo non valido".into()));
    }
    if image.len() > MAX_IMAGE_BYTES || !is_webp(image) {
        return Err(LibError::Io("immagine non valida o troppo grande".into()));
    }
    let d = dir(root);
    if let Some(existing) = list(root).into_iter().find(|s| s.uuid == uuid) {
        return Ok(existing);
    }
    std::fs::create_dir_all(&d)?;
    let meta = SharedMeta {
        label: clean_label(label),
        author: author.trim().to_string(),
        author_user: os_user.trim().to_string(),
        at: now,
    };
    match write_new(&d.join(format!("{uuid}.webp")), image) {
        Ok(()) => {}
        // L'immagine c'è già ma il suo `.json` no (un'altra copia sta scrivendo, o è rimasta a metà): non si tocca.
        Err(LibError::Io(_)) if d.join(format!("{uuid}.webp")).exists() => {
            return Err(LibError::Io(
                "questo simbolo è già in corso di condivisione: riprova tra poco".into(),
            ))
        }
        Err(e) => return Err(e),
    }
    let body = serde_json::to_vec_pretty(&meta).map_err(std::io::Error::other)?;
    write_new(&d.join(format!("{uuid}.json")), &body)?;
    Ok(SharedSymbol {
        uuid: uuid.to_string(),
        label: meta.label,
        author: meta.author,
        at: now,
    })
}

fn read_meta(path: &Path) -> Option<SharedMeta> {
    let len = std::fs::metadata(path).ok()?.len();
    if len > 16 * 1024 {
        return None;
    }
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// I simboli completi (con immagine WebP e `.json` leggibile), i più recenti per primi. Quelli ancora in
/// sincronizzazione o rovinati si saltano.
pub fn list(root: &Path) -> Vec<SharedSymbol> {
    let Ok(rd) = std::fs::read_dir(dir(root)) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(uuid) = name.strip_suffix(".json") else {
            continue;
        };
        if !valid_uuid(uuid) || out.len() >= MAX_LISTED {
            continue;
        }
        let img = e.path().with_extension("webp");
        let ok = std::fs::metadata(&img)
            .is_ok_and(|m| m.len() > 12 && m.len() <= MAX_IMAGE_BYTES as u64);
        if let (true, Some(m)) = (ok, read_meta(&e.path())) {
            out.push(SharedSymbol {
                uuid: uuid.to_string(),
                label: m.label,
                author: m.author,
                at: m.at,
            });
        }
    }
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.uuid.cmp(&b.uuid)));
    out
}

/// L'immagine di un simbolo condiviso (solo se è completo e davvero WebP).
pub fn read_image(root: &Path, uuid: &str) -> Option<(Vec<u8>, String)> {
    if !valid_uuid(uuid) {
        return None;
    }
    let meta = read_meta(&dir(root).join(format!("{uuid}.json")))?;
    let bytes = std::fs::read(dir(root).join(format!("{uuid}.webp"))).ok()?;
    (bytes.len() <= MAX_IMAGE_BYTES && is_webp(&bytes)).then_some((bytes, meta.label))
}

/// Chi può ritirare il simbolo: l'autore, o un amministratore.
pub fn can_retire(
    root: &Path,
    uuid: &str,
    display_name: &str,
    os_user: &str,
    admins: &[String],
) -> bool {
    if admins.iter().any(|a| same_user(a, os_user)) {
        return true;
    }
    valid_uuid(uuid)
        && read_meta(&dir(root).join(format!("{uuid}.json"))).is_some_and(|m| {
            is_author(&m.author, Some(&m.author_user), display_name, Some(os_user))
        })
}

/// Ritira un simbolo condiviso: i due file vanno in `archivio\` (mai sopra qualcosa che c'è già).
pub fn retire(
    root: &Path,
    uuid: &str,
    display_name: &str,
    os_user: &str,
    admins: &[String],
) -> Result<(), LibError> {
    if !valid_uuid(uuid) {
        return Err(LibError::Io("identificativo del simbolo non valido".into()));
    }
    let d = dir(root);
    if !d.join(format!("{uuid}.webp")).exists() {
        return Err(LibError::NotFound);
    }
    if !can_retire(root, uuid, display_name, os_user, admins) {
        let author = read_meta(&d.join(format!("{uuid}.json"))).map_or(String::new(), |m| m.author);
        return Err(LibError::NotAuthor { author });
    }
    let arch = root.join("archivio");
    std::fs::create_dir_all(&arch)?;
    for ext in ["webp", "json"] {
        let from = d.join(format!("{uuid}.{ext}"));
        if !from.exists() {
            continue;
        }
        let mut to = arch.join(format!("simbolo-{uuid}.{ext}"));
        let mut n = 2;
        while to.exists() {
            to = arch.join(format!("simbolo-{uuid} ({n}).{ext}"));
            n += 1;
        }
        // Prima l'immagine, poi il `.json`: a metà, il simbolo non risulta più completo.
        std::fs::rename(&from, &to)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("caa-sh-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn webp(n: usize) -> Vec<u8> {
        let mut v = b"RIFF\0\0\0\0WEBP".to_vec();
        v.resize(n.max(16), 7);
        v
    }

    #[test]
    fn condividi_elenca_legge_e_non_sovrascrive() {
        let r = tmp("base");
        let s = share(
            &r,
            "aaa",
            &webp(100),
            "  la\tmela ",
            "Maria Rossi",
            "mrossi",
            50,
        )
        .unwrap();
        assert_eq!(
            (s.label.as_str(), s.author.as_str()),
            ("la mela", "Maria Rossi")
        );
        // Lo stesso uuid due volte: resta il primo, nessun errore.
        let again = share(&r, "aaa", &webp(200), "altra", "Luca", "luca", 99).unwrap();
        assert_eq!(again.label, "la mela");
        assert_eq!(read_image(&r, "aaa").unwrap().0.len(), 100);
        share(&r, "bbb", &webp(50), "pane", "Luca", "luca", 80).unwrap();
        let l = list(&r);
        assert_eq!(
            l.iter().map(|x| x.uuid.as_str()).collect::<Vec<_>>(),
            ["bbb", "aaa"]
        );
        // Niente file temporanei rimasti.
        assert!(std::fs::read_dir(r.join("simboli"))
            .unwrap()
            .flatten()
            .all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
        std::fs::remove_dir_all(&r).unwrap();
    }

    #[test]
    fn simboli_incompleti_o_rovinati_non_si_mostrano_e_input_strani_si_rifiutano() {
        let r = tmp("incompleti");
        share(&r, "ok", &webp(40), "ok", "Maria", "m", 1).unwrap();
        let d = r.join("simboli");
        std::fs::write(d.join("solo-immagine.webp"), webp(40)).unwrap(); // manca il json: in sincronizzazione
        std::fs::write(d.join("solo-json.json"), br#"{"label":"x","author":"y"}"#).unwrap(); // manca l'immagine
        std::fs::write(d.join("rotto.webp"), webp(40)).unwrap();
        std::fs::write(d.join("rotto.json"), b"{rovinato").unwrap();
        std::fs::write(d.join("../x.json"), b"{}").ok();
        let l = list(&r);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].uuid, "ok");
        assert!(read_image(&r, "rotto").is_none());
        assert!(read_image(&r, "../x").is_none());
        assert!(share(&r, "../x", &webp(40), "x", "a", "b", 1).is_err());
        assert!(share(&r, "png", b"\x89PNG....................", "x", "a", "b", 1).is_err());
        assert!(share(&r, "grande", &webp(MAX_IMAGE_BYTES + 1), "x", "a", "b", 1).is_err());
        std::fs::remove_dir_all(&r).unwrap();
    }

    #[test]
    fn ritira_solo_l_autore_per_nome_utente_o_un_amministratore() {
        let r = tmp("ritira");
        share(&r, "sim", &webp(40), "mela", "Maria Rossi", "mrossi", 1).unwrap();
        let admins = vec!["segreteria".to_string()];
        // Un omonimo (stesso nome da mostrare, altro utente di Windows) non può.
        assert!(matches!(
            retire(&r, "sim", "Maria Rossi", "altra", &admins),
            Err(LibError::NotAuthor { .. })
        ));
        assert!(!can_retire(&r, "sim", "Segreteria", "altra", &admins));
        assert!(can_retire(&r, "sim", "Qualcuno", "SEGRETERIA", &admins));
        assert_eq!(list(&r).len(), 1);
        retire(&r, "sim", "M.", "MRossi", &admins).unwrap();
        assert!(list(&r).is_empty());
        assert!(r.join("archivio/simbolo-sim.webp").exists());
        assert!(r.join("archivio/simbolo-sim.json").exists());
        assert_eq!(
            retire(&r, "sim", "M.", "mrossi", &admins).unwrap_err(),
            LibError::NotFound
        );
        // Un nome già in archivio non si sovrascrive.
        share(&r, "sim", &webp(40), "mela", "Maria Rossi", "mrossi", 2).unwrap();
        retire(&r, "sim", "M.", "mrossi", &admins).unwrap();
        assert!(r.join("archivio/simbolo-sim (2).webp").exists());
        std::fs::remove_dir_all(&r).unwrap();
    }
}
