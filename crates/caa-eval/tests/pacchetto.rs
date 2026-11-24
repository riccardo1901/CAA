//! `caa-eval pacchetto`: non deve mai distruggere il lessico da cui copia (revisione M8a).

use std::path::{Path, PathBuf};
use std::process::Command;

use caa_lexicon_build::pipeline::{run, Config};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn build_lexicon(out: &Path) {
    let fx = repo().join("crates/caa-lexicon-build/tests/fixtures");
    run(&Config {
        raw: fx.join("raw"),
        overrides: fx.join("overrides"),
        out: out.to_path_buf(),
    })
    .unwrap();
}

fn pacchetto(lexicon: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_caa-eval"))
        .current_dir(repo())
        .arg("pacchetto")
        .args(args)
        .arg("--lexicon")
        .arg(lexicon)
        .output()
        .unwrap()
}

#[test]
fn senza_cartella_di_destinazione_non_scrive_niente() {
    let tmp = tempfile::tempdir().unwrap();
    build_lexicon(tmp.path());
    let o = Command::new(env!("CARGO_BIN_EXE_caa-eval"))
        .current_dir(tmp.path())
        .args(["pacchetto", "--lexicon"])
        .arg(tmp.path())
        .output()
        .unwrap();
    // `pacchetto` senza argomento prende "--lexicon" come destinazione: deve rifiutare.
    assert!(!o.status.success());
    assert!(!tmp.path().join("--lexicon").exists());
}

#[test]
fn rifiuta_la_cartella_del_lessico_e_non_tronca_i_file() {
    let tmp = tempfile::tempdir().unwrap();
    build_lexicon(tmp.path());
    let before = std::fs::metadata(tmp.path().join("morphit/morph.fst"))
        .unwrap()
        .len();
    assert!(before > 0);
    for dest in [tmp.path().to_path_buf(), tmp.path().join("morphit")] {
        let o = pacchetto(tmp.path(), &[dest.to_str().unwrap()]);
        assert!(!o.status.success(), "{dest:?}");
        assert_eq!(
            std::fs::metadata(tmp.path().join("morphit/morph.fst"))
                .unwrap()
                .len(),
            before,
            "{dest:?}"
        );
    }
}

#[test]
fn rifiuta_una_destinazione_non_vuota_e_accetta_una_vuota() {
    let tmp = tempfile::tempdir().unwrap();
    let lex = tmp.path().join("lessico");
    build_lexicon(&lex);
    let full = tmp.path().join("piena");
    std::fs::create_dir_all(&full).unwrap();
    std::fs::write(full.join("avanzo.txt"), "x").unwrap();
    assert!(!pacchetto(&lex, &[full.to_str().unwrap()]).status.success());
    assert!(full.join("avanzo.txt").exists());
    let empty = tmp.path().join("nuova");
    let o = pacchetto(&lex, &[empty.to_str().unwrap()]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(empty.join("manifest.json").is_file() && empty.join("morphit/morph.fst").is_file());
}
