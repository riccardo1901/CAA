//! Il registro locale delle correzioni anonime (M9c-3). Ogni scelta di un pittogramma diventa una riga senza
//! testo intero né nomi (vedi `caa_lib::corrections`); «Invia» la copia nel Drive e la toglie da qui. L'identificativo
//! anonimo è un numero casuale tenuto in `anon-id`, non il nome utente.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use caa_lib::corrections::{Correction, MAX_LOCAL_LINES};

pub struct CorrectionStore {
    dir: PathBuf,
    lock: Mutex<()>,
    /// Tenuto per tutto un invio: due invii insieme (o un «Butta via» a metà) perderebbero righe.
    sending: Mutex<()>,
}

impl CorrectionStore {
    pub fn new(dir: &Path) -> CorrectionStore {
        CorrectionStore {
            dir: dir.to_path_buf(),
            lock: Mutex::new(()),
            sending: Mutex::new(()),
        }
    }

    /// Prende il turno per inviare o buttare via; se un altro invio è in corso, errore (si riprova).
    pub fn begin_exclusive(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.sending
            .try_lock()
            .map_err(|_| "un invio è già in corso: riprova tra poco".to_string())
    }

    fn path(&self) -> PathBuf {
        self.dir.join("correzioni-locali.tsv")
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn read_lines(&self) -> Vec<String> {
        std::fs::read_to_string(self.path())
            .map(|t| {
                t.lines()
                    .filter(|l| Correction::from_line(l).is_some())
                    .map(str::to_string)
                    .take(MAX_LOCAL_LINES)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Aggiunge una riga (ignorata se il registro è pieno).
    pub fn log(&self, c: &Correction) -> Result<(), String> {
        let _g = self.guard();
        if self.read_lines().len() >= MAX_LOCAL_LINES {
            return Ok(());
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path())
            .map_err(|e| e.to_string())?;
        writeln!(f, "{}", c.to_line()).map_err(|e| e.to_string())
    }

    /// Le righe in attesa di essere inviate.
    pub fn pending(&self) -> Vec<String> {
        let _g = self.guard();
        self.read_lines()
    }

    /// Toglie le prime `n` righe (quelle appena inviate); le nuove, arrivate nel frattempo, restano.
    pub fn drop_first(&self, n: usize) -> Result<(), String> {
        let _g = self.guard();
        let rest: Vec<String> = self.read_lines().into_iter().skip(n).collect();
        let mut body = rest.join("\n");
        if !body.is_empty() {
            body.push('\n');
        }
        let tmp = caa_doc::tmp_path(&self.path());
        let res = std::fs::write(&tmp, body).and_then(|_| std::fs::rename(&tmp, self.path()));
        if res.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        res.map_err(|e| format!("non riesco ad aggiornare il registro: {e}"))
    }

    /// L'identificativo anonimo di questo computer (32 cifre esadecimali casuali, creato la prima volta).
    pub fn anon_id(&self) -> Result<String, String> {
        let _g = self.guard();
        let path = self.dir.join("anon-id");
        if let Ok(t) = std::fs::read_to_string(&path) {
            let t = t.trim();
            if t.len() == 32 && t.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Ok(t.to_string());
            }
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let id = caa_doc::new_id();
        std::fs::write(&path, &id).map_err(|e| e.to_string())?;
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("caa-cs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn c(lemma: &str) -> Correction {
        Correction::from_line(&format!("{lemma}\tla\tè\t{lemma}\tNOUN\t1\t2")).unwrap()
    }

    #[test]
    fn registra_invia_e_toglie_solo_le_righe_inviate() {
        let d = tmp("base");
        let s = CorrectionStore::new(&d);
        assert!(s.pending().is_empty());
        s.log(&c("pesca")).unwrap();
        s.log(&c("sale")).unwrap();
        let sent = s.pending();
        assert_eq!(sent.len(), 2);
        // Una riga arriva mentre si invia: resta.
        s.log(&c("riso")).unwrap();
        s.drop_first(sent.len()).unwrap();
        let left = s.pending();
        assert_eq!(left.len(), 1);
        assert!(left[0].starts_with("riso\t"));
        // Righe rovinate nel file non si contano né si inviano.
        std::fs::write(
            d.join("correzioni-locali.tsv"),
            "boh\n\nriso\tla\tè\triso\tNOUN\t1\t2\n",
        )
        .unwrap();
        assert_eq!(s.pending().len(), 1);
        assert!(std::fs::read_dir(&d)
            .unwrap()
            .flatten()
            .all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn un_solo_invio_alla_volta() {
        let d = tmp("turno");
        let s = CorrectionStore::new(&d);
        let g = s.begin_exclusive().unwrap();
        assert!(s.begin_exclusive().is_err());
        drop(g);
        assert!(s.begin_exclusive().is_ok());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn l_identificativo_anonimo_e_casuale_e_resta_lo_stesso() {
        let (a, b) = (tmp("anon-a"), tmp("anon-b"));
        let (sa, sb) = (CorrectionStore::new(&a), CorrectionStore::new(&b));
        let id = sa.anon_id().unwrap();
        assert_eq!(id.len(), 32);
        assert_eq!(sa.anon_id().unwrap(), id);
        assert_eq!(CorrectionStore::new(&a).anon_id().unwrap(), id);
        assert_ne!(sb.anon_id().unwrap(), id);
        // Non contiene il nome dell'utente del sistema.
        let user = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_default();
        assert!(user.is_empty() || !id.contains(&user.to_lowercase()));
        for d in [a, b] {
            std::fs::remove_dir_all(d).unwrap();
        }
    }
}
