//! `caa-store`: documenti, biblioteca e sincronizzazione (la logica arriva in M9) e, già da M2,
//! l'apertura del lessico compilato da disco. Il motore non fa I/O: lo fa questo modulo.

use std::fmt;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use caa_engine::curated::Curated;
use caa_engine::engine::Engine;
use caa_engine::lexicon::{LexiconError, MorphLexicon, PictoIndex};
use memmap2::Mmap;

/// Numero di schema del formato `.caa` (cresce a ogni modifica incompatibile).
pub const SCHEMA: u32 = 1;

/// Errore di apertura del lessico.
#[derive(Debug)]
pub enum LoadError {
    Io(PathBuf, io::Error),
    Format(LexiconError),
    /// `lemma_picto.tsv` o `blocklist.tsv` non validi.
    Curated(Vec<String>),
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LoadError::Io(p, e) => write!(f, "{}: {e}", p.display()),
            LoadError::Format(e) => write!(f, "{e}"),
            LoadError::Curated(e) => write!(f, "file curati non validi:\n  {}", e.join("\n  ")),
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
    // SAFETY: i file del lessico sono installati in sola lettura e il programma non li modifica.
    // Il rischio di `mmap` è un file troncato da un altro processo mentre è mappato: su Linux e
    // macOS la lettura darebbe SIGBUS (i controlli sugli intervalli dei lettori non bastano), su
    // Windows la scrittura fallirebbe. `caa-lexicon-build` scrive in modo atomico (file
    // temporaneo e rinomina), quindi un file già mappato non viene mai troncato sul posto.
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
    // Morfologia e pittogrammi devono venire dalla stessa build del lessico.
    if morph.build_id() != picto.build_id() {
        return Err(LexiconError::BuildMismatch("le cartelle morphit/ e arasaac/").into());
    }
    Ok(Lexicon { morph, picto })
}

/// Apre il motore completo: lessico mappato in memoria più i file curati (`overrides/`, copiati
/// dalla build; se mancano valgono come vuoti).
pub fn open_engine(dir: &Path) -> Result<Engine<Mmap>, LoadError> {
    let lexicon = open_lexicon(dir)?;
    let read = |name: &str| -> Result<String, LoadError> {
        let path = dir.join("overrides").join(name);
        match std::fs::read_to_string(&path) {
            Ok(text) => Ok(text),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(String::new()),
            Err(e) => Err(LoadError::Io(path, e)),
        }
    };
    let curated = Curated::parse(&read("lemma_picto.tsv")?, &read("blocklist.tsv")?)
        .map_err(LoadError::Curated)?;
    Ok(Engine::new(lexicon.morph, lexicon.picto, curated))
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
    fn apre_il_motore_con_i_file_curati() {
        let tmp = tempfile::tempdir().unwrap();
        build(tmp.path());
        let engine = open_engine(tmp.path()).unwrap();
        let tokens = engine.symbolize_text("La porta è aperta.");
        assert_eq!(tokens.len(), 5);
        assert_eq!(tokens[1].surface, "porta");
        // Senza la cartella `overrides/` i file curati valgono come vuoti.
        std::fs::remove_dir_all(tmp.path().join("overrides")).unwrap();
        assert!(open_engine(tmp.path()).is_ok());
        // File curati non validi: errore con riga.
        std::fs::create_dir_all(tmp.path().join("overrides")).unwrap();
        std::fs::write(tmp.path().join("overrides/blocklist.tsv"), "solo\n").unwrap();
        let Err(e) = open_engine(tmp.path()) else {
            panic!("doveva fallire")
        };
        assert!(e.to_string().contains("blocklist.tsv:1"), "{e}");
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
    fn parti_di_build_diverse_rifiutate() {
        let fx = Path::new(env!("CARGO_MANIFEST_DIR")).join("../caa-lexicon-build/tests/fixtures");
        let (a, b, ov) = (
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
            tempfile::tempdir().unwrap(),
        );
        build(a.path());
        // Seconda build con un file curato in più: dati e identificativo diversi.
        for f in [
            "forms_extra.tsv",
            "lemma_picto.tsv",
            "mwe_extra.tsv",
            "function_words.tsv",
            "blocklist.tsv",
        ] {
            std::fs::copy(fx.join("overrides").join(f), ov.path().join(f)).unwrap();
        }
        let mut extra = std::fs::read_to_string(ov.path().join("forms_extra.tsv")).unwrap();
        extra.push_str("zampogna\tzampogna\tNOUN-F:s\tdiversa\n");
        std::fs::write(ov.path().join("forms_extra.tsv"), extra).unwrap();
        run(&Config {
            raw: fx.join("raw"),
            overrides: ov.path().to_path_buf(),
            out: b.path().to_path_buf(),
        })
        .unwrap();
        // Indice dei pittogrammi della build B dentro la cartella della build A.
        std::fs::copy(
            b.path().join("arasaac/picto_index.bin"),
            a.path().join("arasaac/picto_index.bin"),
        )
        .unwrap();
        let Err(e) = open_lexicon(a.path()) else {
            panic!("doveva fallire")
        };
        assert!(e.to_string().contains("build diverse"), "{e}");
    }

    #[test]
    fn file_con_schema_diverso_rifiutato() {
        let tmp = tempfile::tempdir().unwrap();
        build(tmp.path());
        let p = tmp.path().join("arasaac/picto_index.bin");
        let mut bytes = std::fs::read(&p).unwrap();
        bytes[4] = 77;
        std::fs::write(&p, bytes).unwrap();
        let Err(e) = open_lexicon(tmp.path()) else {
            panic!("doveva fallire")
        };
        assert!(e.to_string().contains("schema 77"), "{e}");
    }
}
