//! I test dorati di tokenizzazione (lexicon/golden/tokenizzazione.tsv) sul mini-lessico: girano
//! in CI. Gli stessi casi si eseguono sui dati veri con `caa-eval dorati`.

use caa_engine::golden;

mod common;

#[test]
fn dorati_di_tokenizzazione_sul_mini_lessico() {
    let text = include_str!("../../../lexicon/golden/tokenizzazione.tsv");
    let cases = golden::parse(text)
        .unwrap_or_else(|e| panic!("file dei casi non valido:\n{}", e.join("\n")));
    assert!(cases.len() >= 45, "troppo pochi casi: {}", cases.len());
    let engine = common::engine("", "");
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|c| golden::check(&engine, c).err())
        .collect();
    assert!(
        failures.is_empty(),
        "{} casi su {} falliti:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}
