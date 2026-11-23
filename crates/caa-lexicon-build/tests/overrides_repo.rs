//! I file curati veri (`lexicon/overrides/*.tsv`) devono sempre essere leggibili: colonne giuste,
//! etichette dei tratti note, categorie e comportamenti validi. L'esistenza degli id ARASAAC si
//! controlla alla build sui dati veri (qui i dati grezzi non ci sono).

use std::fs;
use std::path::Path;

use caa_lexicon_build::labels::parse_label;
use caa_lexicon_build::overrides::{OverrideTexts, Overrides};

#[test]
fn i_file_curati_del_repository_sono_validi() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../lexicon/overrides");
    let read = |n: &str| fs::read_to_string(dir.join(n)).unwrap_or_else(|e| panic!("{n}: {e}"));
    let texts = OverrideTexts {
        forms_extra: read("forms_extra.tsv"),
        lemma_picto: read("lemma_picto.tsv"),
        mwe_extra: read("mwe_extra.tsv"),
        function_words: read("function_words.tsv"),
        blocklist: read("blocklist.tsv"),
    };
    let o = Overrides::parse(&texts)
        .unwrap_or_else(|e| panic!("file curati non validi:\n{}", e.join("\n")));
    assert!(!o.forms_extra.is_empty());
    for f in &o.forms_extra {
        assert!(
            parse_label(&f.label).is_ok(),
            "forms_extra.tsv:{}: {}",
            f.line,
            f.label
        );
    }
}

#[test]
fn nessuna_forma_curata_e_duplicata() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../lexicon/overrides");
    let text = fs::read_to_string(dir.join("forms_extra.tsv")).unwrap();
    let o = Overrides::parse(&OverrideTexts {
        forms_extra: text,
        ..OverrideTexts::default()
    })
    .unwrap();
    let mut seen = std::collections::HashSet::new();
    for f in &o.forms_extra {
        assert!(
            seen.insert((f.form.clone(), f.lemma.clone(), f.label.clone())),
            "forms_extra.tsv:{}: riga duplicata",
            f.line
        );
    }
}
