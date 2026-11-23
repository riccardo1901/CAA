//! Prova completa su un lessico di esempio (tests/fixtures): build, rilettura con i lettori
//! del motore, determinismo, errori.

use std::fs;
use std::path::{Path, PathBuf};

use caa_engine::lexicon::{
    picto_flags, LexiconError, MorphLexicon, PictoIndex, HEADER_SIZE, SCHEMA,
};
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
    // Ordine esplicito (revisione M0-M2): per categoria, poi per lemma. Non ha altro significato:
    // la scelta della lettura spetta alla fase 7. Prima era l'ordine casuale degli id dei lemmi
    // ("porta" cominciava con il participio di "porgere").
    assert!(
        porta
            .windows(2)
            .all(|w| w[0].cat.as_u8() <= w[1].cat.as_u8()),
        "{porta:?}"
    );
    assert_eq!(porta[0].cat, Cat::Noun);
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
    // Il plurale ricorda la parola chiave singolare; la chiave propria no.
    assert_eq!(b.picto.singular(&api[0]), Some("ape"));
    assert_eq!(b.picto.singular(&b.picto.lookup("ape")[0]), None);
    assert!(api[0].has_type(2) && !api[0].has_type(3));
    // Le due parti della stessa build portano lo stesso identificativo.
    assert_eq!(b.morph.build_id(), b.picto.build_id());
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
    assert_eq!(manifest["schema"], SCHEMA);
    // Identificativo di build: 16 cifre esadecimali.
    assert_eq!(manifest["build_id"].as_str().unwrap().len(), 16);
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

fn files_under(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            files_under(&p, out);
        } else {
            out.push(p);
        }
    }
}

#[test]
fn la_build_si_puo_ripetere_sulla_stessa_cartella_senza_residui() {
    // I file si scrivono in modo atomico (temporaneo + rinomina): nessun ".tmp" resta, e una
    // seconda build sopra la prima dà gli stessi byte.
    let tmp = tempfile::tempdir().unwrap();
    run(&config(tmp.path())).unwrap();
    let first = fs::read(tmp.path().join("morphit/morph_feats.bin")).unwrap();
    run(&config(tmp.path())).unwrap();
    assert_eq!(
        first,
        fs::read(tmp.path().join("morphit/morph_feats.bin")).unwrap()
    );
    let mut files = Vec::new();
    files_under(tmp.path(), &mut files);
    let leftovers: Vec<_> = files
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e == "tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn file_di_build_diverse_non_si_mescolano() {
    // Revisione M0-M2: un morph.fst di una build con un morph_feats.bin di un'altra veniva accettato
    // e le ricerche davano vuoto senza errori. L'identificativo di build nelle intestazioni e nella
    // chiave sentinella degli automi lo rende un errore.
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    run(&config(a.path())).unwrap();
    // Seconda build con un file curato in più: dati diversi, identificativo diverso.
    let ov = tempfile::tempdir().unwrap();
    for f in [
        "forms_extra.tsv",
        "lemma_picto.tsv",
        "mwe_extra.tsv",
        "function_words.tsv",
        "blocklist.tsv",
    ] {
        fs::copy(fixtures().join("overrides").join(f), ov.path().join(f)).unwrap();
    }
    let mut extra = fs::read_to_string(ov.path().join("forms_extra.tsv")).unwrap();
    extra.push_str("zampogna\tzampogna\tNOUN-F:s\tdiversa\n");
    fs::write(ov.path().join("forms_extra.tsv"), extra).unwrap();
    run(&Config {
        overrides: ov.path().to_path_buf(),
        ..config(b.path())
    })
    .unwrap();

    let r = |d: &Path, p: &str| fs::read(d.join(p)).unwrap();
    let (la, lb) = (load(a.path()), load(b.path()));
    assert_ne!(la.morph.build_id(), lb.morph.build_id());
    // morph.fst e lemmas.fst della build A con morph_feats.bin della build B.
    let mixed = MorphLexicon::new(
        r(a.path(), "morphit/morph.fst"),
        r(a.path(), "morphit/lemmas.fst"),
        r(b.path(), "morphit/morph_feats.bin"),
    );
    assert!(matches!(mixed, Err(LexiconError::BuildMismatch(_))));
    // Solo l'automa dei lemmi di un'altra build.
    let mixed = MorphLexicon::new(
        r(a.path(), "morphit/morph.fst"),
        r(b.path(), "morphit/lemmas.fst"),
        r(a.path(), "morphit/morph_feats.bin"),
    );
    assert!(matches!(mixed, Err(LexiconError::BuildMismatch(_))));
}

#[test]
fn etichetta_non_mappata_ferma_la_build() {
    let pictograms = [];
    let err = compile(&Inputs {
        build_id: 1,
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
        build_id: 1,
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
    assert_eq!((found, expected), (99, SCHEMA));
    // Automa non valido.
    assert!(matches!(
        MorphLexicon::new(vec![1, 2, 3], lem.clone(), feats.clone()),
        Err(LexiconError::Fst(_))
    ));

    // Regressione (revisione M0-M2): un byte alterato dentro un automa ben formato superava i
    // controlli di intestazione e poi mandava in panic la ricerca. La somma di controllo lo rifiuta.
    for i in [fst.len() / 3, fst.len() / 2, fst.len() - 20] {
        let mut bad = fst.clone();
        bad[i] ^= 0xFF;
        assert!(
            matches!(
                MorphLexicon::new(bad, lem.clone(), feats.clone()),
                Err(LexiconError::Fst(_))
            ),
            "morph.fst byte {i}"
        );
    }
    let mut bad_lem = lem.clone();
    let mid = bad_lem.len() / 2;
    bad_lem[mid] ^= 0xFF;
    assert!(
        matches!(
            MorphLexicon::new(fst.clone(), bad_lem, feats.clone()),
            Err(LexiconError::Fst(_))
        ),
        "lemmas.fst"
    );
    let fst_len = u32::from_le_bytes(picto[20..24].try_into().unwrap()) as usize; // secondo contatore
    for i in [
        HEADER_SIZE + fst_len / 3,
        HEADER_SIZE + fst_len / 2,
        HEADER_SIZE + fst_len - 20,
    ] {
        let mut bad = picto.clone();
        bad[i] ^= 0xFF;
        assert!(
            matches!(PictoIndex::new(bad), Err(LexiconError::Fst(_))),
            "picto_index.bin byte {i}"
        );
    }
}

/// Intestazione valida (magic, schema, build) con tre contatori a piacere.
fn header(magic: &[u8; 4], c: [u32; 3]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(magic);
    v.extend_from_slice(&SCHEMA.to_le_bytes());
    v.extend_from_slice(&0u64.to_le_bytes());
    for x in c {
        v.extend_from_slice(&x.to_le_bytes());
    }
    assert_eq!(v.len(), HEADER_SIZE);
    v
}

#[test]
fn intestazioni_con_conteggi_enormi_sono_errori_non_panic() {
    // Intestazioni valide con conteggi assurdi e file minuscolo: errore, mai panic.
    let tmp = tempfile::tempdir().unwrap();
    run(&config(tmp.path())).unwrap();
    let r = |p: &str| fs::read(tmp.path().join(p)).unwrap();
    for counters in [
        [u32::MAX, u32::MAX, 0],
        [u32::MAX, 0, 0],
        [0, u32::MAX, 0],
        [1, 1, 0],
    ] {
        let mut feats = header(b"CAAF", counters);
        feats.extend_from_slice(&[0; 8]);
        let e = MorphLexicon::new(r("morphit/morph.fst"), r("morphit/lemmas.fst"), feats).err();
        assert!(
            matches!(
                e,
                Some(LexiconError::Truncated(_) | LexiconError::Corrupt(_))
            ),
            "{counters:?}: {e:?}"
        );
    }
    for counters in [
        [u32::MAX, u32::MAX, u32::MAX],
        [u32::MAX, 0, 0],
        [0, u32::MAX, 0],
        [0, 0, u32::MAX],
    ] {
        let e = PictoIndex::new(header(b"CAAP", counters)).err();
        assert!(
            matches!(e, Some(LexiconError::Corrupt(_))),
            "{counters:?}: {e:?}"
        );
    }
}
