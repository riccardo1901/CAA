//! Criteri di accettazione di M4 sui dati veri (`data/build`, che non è in git): se mancano, le
//! prove si saltano. Si costruiscono con `cargo run --release -p caa-lexicon-build`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use caa_eval::{coverage, parse_base, run_golden, speed};
use caa_store::open_engine;

fn data_dir() -> Option<PathBuf> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/build");
    p.join("manifest.json").exists().then_some(p)
}

fn repo(file: &str) -> String {
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(file);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

macro_rules! engine_or_skip {
    () => {{
        let Some(dir) = data_dir() else {
            eprintln!("data/build non presente: prova saltata");
            return;
        };
        open_engine(&dir).unwrap_or_else(|e| panic!("{e}"))
    }};
}

#[test]
fn dorati_di_tokenizzazione_sui_dati_veri() {
    let engine = engine_or_skip!();
    let r = run_golden(&engine, &repo("lexicon/golden/tokenizzazione.tsv")).unwrap();
    assert!(r.total >= 45);
    assert!(
        r.failures.is_empty(),
        "{} su {} falliti:\n{}",
        r.failures.len(),
        r.total,
        r.failures.join("\n")
    );
}

#[test]
fn copertura_delle_parole_di_base() {
    let engine = engine_or_skip!();
    let words = parse_base(&repo("lexicon/lessico_base.tsv")).unwrap();
    assert!(
        words.len() >= 500,
        "il lessico di base ha {} parole",
        words.len()
    );
    let r = coverage(&engine, &words);

    // Parole piene (nomi, verbi, aggettivi): almeno il 97%; con gli avverbi almeno il 96%.
    let full = |cats: &[&str]| {
        let (n, ok) = cats
            .iter()
            .filter_map(|c| r.by_cat.get(*c))
            .fold((0, 0), |(n, ok), (a, b)| (n + a, ok + b));
        100.0 * ok as f64 / n as f64
    };
    assert!(
        full(&["NOUN", "VERB", "ADJ"]) >= 97.0,
        "parole piene: {:.1}%",
        full(&["NOUN", "VERB", "ADJ"])
    );
    let total = 100.0 * r.with_picto as f64 / r.total as f64;
    assert!(total >= 96.0, "totale: {total:.1}%");

    // Le parole senza pittogramma sono esattamente quelle dell'elenco delle eccezioni: se i dati
    // cambiano (ARASAAC si aggiorna) il test lo segnala e l'elenco si aggiorna consapevolmente.
    let listed: BTreeSet<String> = repo("lexicon/lessico_base_senza_pittogramma.tsv")
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .filter_map(|l| l.split('\t').next().map(str::to_string))
        .collect();
    let measured: BTreeSet<String> = r.missing.iter().map(|(w, _)| w.clone()).collect();
    assert_eq!(
        measured, listed,
        "elenco delle eccezioni non allineato alla misura"
    );
}

#[test]
fn velocita_di_un_paragrafo() {
    let engine = engine_or_skip!();
    let paragraph = "Quest'anno Giulia frequentava la terza elementare e alla maestra piaceva molto, perché la bambina era gentile, curiosa e faceva sempre tante domande sull'acqua, sul cielo e sugli animali. Un giorno, mentre tornava a casa con la sua amica Marta, vide un uccellino ferito sotto l'albero del giardino. Era piccolo, tremava e non riusciva a volare. «Poverino!» disse Giulia. Le due amiche presero l'uccellino con delicatezza e lo portarono a casa.";
    let r = speed(&engine, paragraph, 50);
    assert!(r.words >= 70);
    // Obiettivo di SPEC.md: meno di 5 ms per 100 parole. In debug il codice è molto più lento:
    // lì si controlla solo un limite largo.
    let limit = if cfg!(debug_assertions) { 50.0 } else { 5.0 };
    assert!(
        r.median_ms < limit,
        "mediana {:.3} ms (limite {limit} ms)",
        r.median_ms
    );
}
