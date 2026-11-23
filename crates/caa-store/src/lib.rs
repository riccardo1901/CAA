//! `caa-store`: documenti, biblioteca e sincronizzazione (la logica arriva in M9) e, già da M2,
//! l'apertura del lessico compilato da disco. Il motore non fa I/O: lo fa questo modulo.

use std::fmt;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use caa_engine::lexicon::{LexiconError, MorphLexicon, PictoIndex};
use memmap2::Mmap;

/// Numero di schema del formato `.caa` (cresce a ogni modifica incompatibile).
pub const SCHEMA: u32 = 1;

/// Errore di apertura del lessico.
#[derive(Debug)]
pub enum LoadError {
    Io(PathBuf, io::Error),
    Format(LexiconError),
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoadError::Io(p, e) => write!(f, "{}: {e}", p.display()),
            LoadError::Format(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for LoadError {}

impl From<LexiconError> for LoadError {
    fn from(e: LexiconError) -> Self {
        LoadError::Format(e)
    }
}

/// Il lessico compilato, letto direttamente dai file mappati in memoria.
pub struct Lexicon {
    pub morph: MorphLexicon<Mmap>,
    pub picto: PictoIndex<Mmap>,
}

fn map(path: &Path) -> Result<Mmap, LoadError> {
    let io = |e| LoadError::Io(path.to_path_buf(), e);
    let file = File::open(path).map_err(io)?;
    // SAFETY: i file del lessico sono installati in sola lettura e il programma non li modifica
    // mentre sono mappati; se un altro processo li troncasse, la lettura potrebbe fallire ma i
    // lettori di `caa-engine` controllano comunque ogni intervallo prima di usarlo.
    unsafe { Mmap::map(&file) }.map_err(io)
}

/// Apre il lessico da una cartella con la struttura prodotta da `caa-lexicon-build`
/// (`morphit/` e `arasaac/`).
pub fn open_lexicon(dir: &Path) -> Result<Lexicon, LoadError> {
    let morph = MorphLexicon::new(
        map(&dir.join("morphit/morph.fst"))?,
        map(&dir.join("morphit/lemmas.fst"))?,
        map(&dir.join("morphit/morph_feats.bin"))?,
    )?;
    let picto = PictoIndex::new(map(&dir.join("arasaac/picto_index.bin"))?)?;
    Ok(Lexicon { morph, picto })
}

#[cfg(test)]
mod tests {
    use super::*;
    use caa_lexicon_build::pipeline::{run, Config};

    fn build(out: &Path) {
        let fx = Path::new(env!("CARGO_MANIFEST_DIR")).join("../caa-lexicon-build/tests/fixtures");
        run(&Config {
            raw: fx.join("raw"),
            overrides: fx.join("overrides"),
            out: out.to_path_buf(),
        })
        .unwrap();
    }

    #[test]
    fn schema_parte_da_uno() {
        assert_eq!(SCHEMA, 1);
    }

    #[test]
    fn apre_il_lessico_da_disco() {
        let tmp = tempfile::tempdir().unwrap();
        build(tmp.path());
        let lex = open_lexicon(tmp.path()).unwrap();
        assert_eq!(lex.morph.lookup("porta").len(), 4);
        assert_eq!(lex.morph.lookup("perché").len(), 1);
        assert_eq!(lex.picto.lookup("ape").len(), 2);
        let id = lex.morph.lemma_id("dare").unwrap();
        assert_eq!(lex.morph.lemma(id), Some("dare"));
    }

    #[test]
    fn cartella_o_file_mancanti_sono_errori_chiari() {
        let tmp = tempfile::tempdir().unwrap();
        let Err(e) = open_lexicon(tmp.path()) else {
            panic!("doveva fallire")
        };
        assert!(matches!(e, LoadError::Io(..)));
        assert!(e.to_string().contains("morph.fst"));
    }

    #[test]
    fn file_con_schema_diverso_rifiutato() {
        let tmp = tempfile::tempdir().unwrap();
        build(tmp.path());
        let p = tmp.path().join("arasaac/picto_index.bin");
        let mut bytes = std::fs::read(&p).unwrap();
        bytes[4] = 7;
        std::fs::write(&p, bytes).unwrap();
        let Err(e) = open_lexicon(tmp.path()) else {
            panic!("doveva fallire")
        };
        assert!(e.to_string().contains("schema 7"), "{e}");
    }
}
