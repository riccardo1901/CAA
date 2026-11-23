//! Prova completa su un lessico di esempio (tests/fixtures): build, rilettura con i lettori
//! del motore, determinismo, errori.

use std::fs;
use std::path::{Path, PathBuf};

use caa_engine::lexicon::{picto_flags, LexiconError, MorphLexicon, PictoIndex};
use caa_engine::norm::normalize_key;
use caa_engine::types::{Cat, Mood, Number, Tense, VerbKind};
use caa_lexicon_build::compile::{compile, BuildError, Inputs};
use caa_lexicon_build::pipeline::{run, Config};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn config(out: &Path) -> Config {
    Config {
        raw: fixtures().join("raw"),
        overrides: fixtures().join("overrides"),
        out: out.to_path_buf(),
    }
}

struct Built {
    morph: MorphLexicon<Vec<u8>>,
    picto: PictoIndex<Vec<u8>>,
}

fn load(out: &Path) -> Built {
    let r = |p: &str| fs::read(out.join(p)).unwrap_or_else(|e| panic!("{p}: {e}"));
    Built {
        morph: MorphLexicon::new(
            r("morphit/morph.fst"),
            r("morphit/lemmas.fst"),
            r("morphit/morph_feats.bin"),
        )
        .unwrap(),
        picto: PictoIndex::new(r("arasaac/picto_index.bin")).unwrap(),
    }
}

fn lemmas_of(b: &Built, key: &str) -> Vec<String> {
    b.morph
        .lookup(key)
        .iter()
        .map(|r| b.morph.lemma(r.lemma_id).unwrap().to_string())
        .collect()
}

#[test]
fn lessico_di_esempio_si_costruisce_e_si_rilegge() {
    let tmp = tempfile::tempdir().unwrap();
    let summary = run(&config(tmp.path())).unwrap();
    let b = load(tmp.path());
    let st = &summary.stats;

    // Righe riparate e conteggi coerenti con i file riletti.
    assert_eq!(st.repaired_lines, vec![26, 27]);
    assert_eq!(st.rows, 30);
    assert_eq!(st.forms_extra, 1);
    assert_eq!(b.morph.form_count(), st.forms);
    assert_eq!(b.morph.reading_count(), st.readings);
    assert_eq!(b.morph.lemma_count(), st.lemmas);

    // Forma ambigua: 4 letture distinte (il doppione è eliminato).
    let porta = b.morph.lookup("porta");
    assert_eq!(porta.len(), 4);
    assert_eq!(porta.iter().filter(|r| r.cat == Cat::Noun).count(), 1);
    assert_eq!(
        lemmas_of(&b, "porta")
            .iter()
            .filter(|l| *l == "portare")
            .count(),
        2
    );
    assert!(porta
        .iter()
        .any(|r| b.morph.lemma(r.lemma_id) == Some("porgere") && r.feats.mood == Some(Mood::Part)));

    // Parole accentate: la chiave è normalizzata e gli accenti contano.
    assert_eq!(b.morph.lookup(&normalize_key("PERCHÉ")).len(), 1);
    assert!(b.morph.lookup("perche").is_empty());
    assert_eq!(b.morph.lookup(&normalize_key("Città")).len(), 2);
    assert_eq!(b.morph.lookup("è").len(), 2); // verbo e ausiliare

    // Enclitico, verbo causativo, participio anomalo, nome proprio, riga riparata, forms_extra.
    let dammi = b.morph.lookup("dammi");
    assert_eq!(b.morph.lemma(dammi[0].lemma_id), Some("dare"));
    assert_eq!(dammi[0].feats.enclitic.map(|e| e.as_str()), Some("mi"));
    let far = b.morph.lookup("far");
    assert_eq!(far.len(), 2);
    assert!(far.iter().any(|r| r.feats.verb_kind == VerbKind::Causative));
    let mossoci = b.morph.lookup("mossoci");
    assert_eq!(
        (mossoci[0].feats.mood, mossoci[0].feats.tense),
        (Some(Mood::Part), Some(Tense::Past))
    );
    assert_eq!(b.morph.lookup(&normalize_key("Marco"))[0].cat, Cat::Propn);
    assert_eq!(b.morph.lookup("seppur").len(), 2);
    assert_eq!(b.morph.lookup("pouf")[0].cat, Cat::Noun);
    assert_eq!(b.morph.lookup("occhiali")[0].feats.number, Some(Number::P));

    // Lemmi: andata e ritorno tra id e testo.
    let id = b.morph.lemma_id("portare").unwrap();
    assert_eq!(b.morph.lemma(id), Some("portare"));
    assert_eq!(b.morph.lemma(u32::MAX), None);
    assert_eq!(b.morph.lemma_id("inesistente"), None);
    assert!(b.morph.lookup("inesistente").is_empty());

    // Indice dei pittogrammi.
    let ape = b.picto.lookup("ape");
    assert_eq!(ape.iter().map(|e| e.id).collect::<Vec<_>>(), vec![10, 2239]);
    let ape = ape.iter().find(|e| e.id == 2239).unwrap();
    assert!(ape.has_flag(picto_flags::FIRST_KEY) && !ape.has_flag(picto_flags::PLURAL_FORM));
    let api = b.picto.lookup("api");
    assert_eq!(api.len(), 1);
    assert!(api[0].has_flag(picto_flags::PLURAL_FORM));
    assert_eq!(b.picto.lookup("occhiali")[0].id, 3329);
    assert!(b.picto.lookup("scuola media")[0].has_flag(picto_flags::MULTIWORD));
    let citta = b.picto.lookup("città");
    assert_eq!((citta[0].id, citta[0].n_keys), (8, 1)); // la parola chiave vuota non conta
    assert!(citta[0].has_flag(picto_flags::FIRST_KEY));
    assert!(b.picto.lookup("forbici")[0].has_flag(picto_flags::INVARIABLE_PLURAL));
    assert!(!b.picto.lookup("mangiare cibo")[0].has_flag(picto_flags::FIRST_KEY));
    assert!(b.picto.lookup("sconosciuta").is_empty());
    assert_eq!(b.picto.record_count(), st.picto_records);
    assert_eq!(b.picto.key_count(), st.picto_keys);
    assert_eq!(st.pictograms, 11);
    assert_eq!(st.pictograms_without_keys, 1);
}

#[test]
fn rapporto_manifesto_e_file_accessori() {
    let tmp = tempfile::tempdir().unwrap();
    run(&config(tmp.path())).unwrap();
    let read = |p: &str| fs::read_to_string(tmp.path().join(p)).unwrap();

    // Cartelle separate per licenza e correzioni curate copiate.
    assert!(tmp.path().join("arasaac/images/2239.webp").exists());
    assert!(!tmp.path().join("arasaac/images/11.webp").exists());
    assert!(read("overrides/forms_extra.tsv").contains("pouf"));

    let report = read("report/report.md");
    assert!(report.contains("righe riparate (separate da spazi invece che da tabulazioni): 2"));
    assert!(report.contains("pittogrammi con parole chiave ma senza immagine: 1 (primi id: [11])"));
    // "zampogna" non è in Morph-it!; "le 6 e un quarto" ha cifre e non è un lemma da cercare.
    assert!(read("report/keys_without_lemma.tsv").contains("zampogna\t4\t11"));
    assert!(!read("report/keys_without_lemma.tsv").contains("quarto"));
    let multi = read("report/multiword_unknown_words.tsv");
    assert!(multi.contains("mangiare cibo\tcibo"));
    assert!(!multi.contains("scuola media"));

    let manifest: serde_json::Value = serde_json::from_str(&read("manifest.json")).unwrap();
    assert_eq!(manifest["schema"], 1);
    assert_eq!(manifest["sources"]["morphit"]["version"], "sconosciuta"); // la fixture non ha l'archivio
    assert_eq!(manifest["counts"]["images"], 9);
    assert_eq!(manifest["counts"]["pictograms"], 11);
    let files = manifest["files"].as_array().unwrap();
    assert_eq!(files.len(), 4);
    assert!(files.iter().any(|f| f["path"] == "arasaac/picto_index.bin"
        && f["license"].as_str().unwrap().contains("NC-SA")));
    assert!(files
        .iter()
        .all(|f| f["sha256"].as_str().unwrap().len() == 64));
}

#[test]
fn la_build_e_deterministica() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    run(&config(a.path())).unwrap();
    run(&config(b.path())).unwrap();
    for f in [
        "morphit/morph.fst",
        "morphit/morph_feats.bin",
        "morphit/lemmas.fst",
        "arasaac/picto_index.bin",
    ] {
        assert_eq!(
            fs::read(a.path().join(f)).unwrap(),
            fs::read(b.path().join(f)).unwrap(),
            "{f}"
        );
    }
}

#[test]
fn etichetta_non_mappata_ferma_la_build() {
    let pictograms = [];
    let err = compile(&Inputs {
        morphit: "a\ta\tPRE\nx\tx\tBOH\ny\ty\tALTRO\n",
        pictograms: &pictograms,
        forms_extra: &[],
    })
    .err()
    .expect("deve fallire");
    match err {
        BuildError::UnmappedLabels(l) => {
            assert_eq!(l, vec!["ALTRO".to_string(), "BOH".to_string()])
        }
        e => panic!("errore inatteso: {e}"),
    }
}

#[test]
fn riga_irreparabile_ferma_la_build() {
    let err = compile(&Inputs {
        morphit: "a\ta\tPRE\nrotta\n",
        pictograms: &[],
        forms_extra: &[],
    })
    .err()
    .unwrap();
    assert!(matches!(err, BuildError::Morphit(e) if e.len() == 1));
}

#[test]
fn override_con_pittogramma_inesistente_ferma_la_build() {
    let tmp = tempfile::tempdir().unwrap();
    let ov = tempfile::tempdir().unwrap();
    fs::write(ov.path().join("blocklist.tsv"), "ape\t99999\n").unwrap();
    let cfg = Config {
        overrides: ov.path().to_path_buf(),
        ..config(tmp.path())
    };
    let e = run(&cfg).err().unwrap();
    assert!(e.contains("blocklist.tsv:1") && e.contains("99999"), "{e}");
}

#[test]
fn override_assenti_equivalgono_a_vuoti() {
    let tmp = tempfile::tempdir().unwrap();
    let ov = tempfile::tempdir().unwrap(); // nessun file
    let cfg = Config {
        overrides: ov.path().to_path_buf(),
        ..config(tmp.path())
    };
    let s = run(&cfg).unwrap();
    assert_eq!(s.stats.forms_extra, 0);
    assert!(load(tmp.path()).morph.lookup("pouf").is_empty());
}

#[test]
fn lettori_rifiutano_file_corrotti() {
    let tmp = tempfile::tempdir().unwrap();
    run(&config(tmp.path())).unwrap();
    let r = |p: &str| fs::read(tmp.path().join(p)).unwrap();
    let (fst, lem, feats) = (
        r("morphit/morph.fst"),
        r("morphit/lemmas.fst"),
        r("morphit/morph_feats.bin"),
    );
    let picto = r("arasaac/picto_index.bin");

    // Troncati.
    assert!(matches!(
        MorphLexicon::new(fst.clone(), lem.clone(), feats[..10].to_vec()),
        Err(LexiconError::Truncated(_))
    ));
    assert!(matches!(
        MorphLexicon::new(fst.clone(), lem.clone(), feats[..feats.len() - 5].to_vec()),
        Err(LexiconError::Corrupt(_))
    ));
    assert!(matches!(
        PictoIndex::new(picto[..picto.len() - 3].to_vec()),
        Err(LexiconError::Corrupt(_))
    ));
    assert!(matches!(
        PictoIndex::new(Vec::new()),
        Err(LexiconError::Truncated(_))
    ));
    // Non sono file del lessico.
    let mut bad = feats.clone();
    bad[0] = b'X';
    assert!(matches!(
        MorphLexicon::new(fst.clone(), lem.clone(), bad),
        Err(LexiconError::BadMagic(_))
    ));
    // Schema più recente del programma.
    let mut newer = picto.clone();
    newer[4] = 99;
    let Err(LexiconError::BadSchema {
        found, expected, ..
    }) = PictoIndex::new(newer)
    else {
        panic!("schema non rifiutato")
    };
    assert_eq!((found, expected), (99, 1));
    // Automa non valido.
    assert!(matches!(
        MorphLexicon::new(vec![1, 2, 3], lem, feats),
        Err(LexiconError::Fst(_))
    ));
}
