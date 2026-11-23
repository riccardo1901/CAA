//! Metriche sul corpus con il mini-lessico: gira anche in CI, senza dati scaricati.

#[path = "../../caa-lexicon-build/tests/common/mod.rs"]
mod common;

use caa_eval::corpus::{evaluate, group_errors, parse_text, render, Cause};

fn gold(rows: &str) -> caa_eval::corpus::GoldText {
    parse_text(&format!(
        "# testo: t\n# genere: storia\n# gruppo: sviluppo\n\n# frase: Ho mangiato il pane.\n{rows}"
    ))
    .unwrap()
}

const RIGHT: &str = "Ho\tAUX\tavere\t-\t-\tHidden\n\
mangiato\tVERB\tmangiare\t110\tPAST\tFull\n\
il\tART\til\t-\t-\tTextOnly\n\
pane\tNOUN\tpane\t104|116\t-\tFull\n\
.\tPUNCT\t.\t-\t-\tTextOnly\n";

fn run(rows: &str) -> caa_eval::corpus::Metrics {
    let engine = common::engine("", "");
    let g = gold(rows);
    evaluate(&engine, &[&g])
}

#[test]
fn un_corpus_giusto_non_ha_correzioni() {
    let m = run(RIGHT);
    assert_eq!((m.words, m.wrong), (4, 0), "{:?}", m.errors);
    assert_eq!(m.per_100(), 0.0);
    assert_eq!((m.content, m.content_picto_ok), (2, 2));
    // Il lemma conta per "Ho" (ausiliare), "mangiato" e "pane", non per l'articolo.
    assert_eq!((m.category_ok, m.lemma_ok, m.lemma_words), (4, 3, 3));
    assert_eq!((m.modifier_cases, m.modifier_ok), (1, 1));
    assert_eq!((m.coverage_cases, m.coverage_ok), (2, 2));
    assert!(render("prova", &m, 3).contains("Correzioni per 100 parole: 0.0"));
}

#[test]
fn ogni_causa_e_riconosciuta() {
    let cases: [(&str, Cause); 5] = [
        // il pittogramma atteso e' un altro
        ("pane\tNOUN\tpane\t104|116\t-\tFull", Cause::WrongSense),
        // il lemma atteso e' un altro
        (
            "mangiato\tVERB\tmangiare\t110\tPAST\tFull",
            Cause::WrongReading,
        ),
        // il segno atteso manca
        ("mangiato\tVERB\tmangiare\t110\t-\tFull", Cause::Modifier),
        // l'ausiliare doveva restare visibile
        ("Ho\tAUX\tavere\t-\t-\tFull", Cause::VerbalStructure),
        // il motore non ha il pittogramma che ci si aspetta per "il"
        ("il\tART\til\t999\t-\tFull", Cause::PictoGap),
    ];
    let mut checked = 0;
    for (row, cause) in cases {
        let name = row.split('\t').next().unwrap();
        let (bad, lemma_bad) = match cause {
            Cause::WrongSense => (row.replace("104|116", "999"), false),
            Cause::WrongReading => (row.replace("\tmangiare\t", "\tbere\t"), true),
            _ => (row.to_string(), false),
        };
        let _ = lemma_bad;
        let rows: String = RIGHT
            .lines()
            .map(|l| {
                if l.starts_with(&format!("{name}\t")) {
                    bad.clone()
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let m = run(&rows);
        assert_eq!(m.wrong, 1, "{cause:?}: {:?}", m.errors);
        assert_eq!(m.errors[0].cause, cause, "{:?}", m.errors);
        checked += 1;
    }
    assert_eq!(checked, 5);
}

#[test]
fn la_confidenza_e_gli_errori_si_raggruppano() {
    let wrong = RIGHT.replace("\tpane\t104|116", "\tpane\t999");
    let m = run(&wrong);
    let groups = group_errors(&m);
    assert_eq!(groups.len(), 1);
    assert_eq!((groups[0].0, groups[0].1), (Cause::WrongSense, 1));
    let text = render("prova", &m, 2);
    assert!(text.contains("senso sbagliato") && text.contains("pane"));
}

#[test]
fn una_frase_con_altri_token_si_salta_e_si_dichiara() {
    let m = run("Ho\tAUX\tavere\t-\t-\tHidden\n.\tPUNCT\t.\t-\t-\tTextOnly\n");
    assert_eq!((m.skipped_sentences, m.words), (1, 0));
}
