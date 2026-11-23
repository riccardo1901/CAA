//! Il tagger (fase 7) sul mini-lessico, con un treebank minuscolo scritto qui: gira anche in CI,
//! senza dati scaricati. Le misure sul treebank vero stanno in `caa-eval`.

use caa_engine::engine::{ReadingReason, Token};
use caa_engine::tagger::Tagger;
use caa_engine::treebank::parse_conllu;
use caa_engine::types::Cat;
use caa_lexicon_build::tagger_build::build_tagger;

mod common;
use common::engine;

fn sentence(id: usize, words: &[(&str, &str, &str)]) -> String {
    let text: Vec<&str> = words.iter().map(|w| w.0).collect();
    let mut s = format!("# sent_id = {id}\n# text = {}.\n", text.join(" "));
    for (i, (form, lemma, upos)) in words.iter().enumerate() {
        // Gli articoli del treebank hanno PronType=Art.
        let feats = if *upos == "DET" { "PronType=Art" } else { "_" };
        s += &format!(
            "{}\t{form}\t{lemma}\t{upos}\t_\t{feats}\t0\t_\t_\t_\n",
            i + 1
        );
    }
    s += &format!("{}\t.\t.\tPUNCT\t_\t_\t0\t_\t_\t_\n\n", words.len() + 1);
    s
}

fn tagged() -> caa_engine::engine::Engine<Vec<u8>> {
    let mut text = String::new();
    // "porta" è verbo dopo un nome ("il maestro porta"), nome dopo l'articolo ("la porta").
    for i in 0..6 {
        text += &sentence(
            i,
            &[
                ("il", "il", "DET"),
                ("maestro", "maestro", "NOUN"),
                ("porta", "portare", "VERB"),
                ("il", "il", "DET"),
                ("pane", "pane", "NOUN"),
            ],
        );
        text += &sentence(
            100 + i,
            &[
                ("la", "la", "DET"),
                ("porta", "porta", "NOUN"),
                ("è", "essere", "AUX"),
                ("una", "uno", "DET"),
                ("giornata", "giornata", "NOUN"),
            ],
        );
    }
    let sentences = parse_conllu(&text);
    assert!(sentences
        .iter()
        .all(|s| s.tokens.iter().all(|t| t.cat.is_some())));
    let build = build_tagger(&sentences, 7).unwrap();
    engine("", "").with_tagger(Tagger::new(build.bytes).unwrap())
}

fn word<'a>(tokens: &'a [Token], surface: &str) -> &'a Token {
    tokens.iter().find(|t| t.surface == surface).unwrap()
}

fn cat(t: &Token) -> Cat {
    t.analysis.as_ref().unwrap().cat
}

#[test]
fn senza_tagger_vale_la_scelta_provvisoria() {
    let t = engine("", "").symbolize_text("Il maestro porta il pane.");
    assert_eq!(cat(word(&t, "porta")), Cat::Noun);
    assert_eq!(
        word(&t, "porta").reason.reading,
        ReadingReason::BaselinePick
    );
}

#[test]
fn il_contesto_cambia_la_lettura() {
    let e = tagged();
    let verbo = e.symbolize_text("Il maestro porta il pane.");
    let porta = word(&verbo, "porta");
    assert_eq!(cat(porta), Cat::Verb);
    assert_eq!(porta.analysis.as_ref().unwrap().lemma, "portare");
    assert_eq!(porta.reason.reading, ReadingReason::Tagger);
    let nome = e.symbolize_text("La porta è una giornata.");
    assert_eq!(cat(word(&nome, "porta")), Cat::Noun);
}

#[test]
fn la_confidenza_e_la_probabilita_della_lettura() {
    let e = tagged();
    let t = e.symbolize_text("Il maestro porta il pane.");
    // Parole con una sola lettura: certe. Parola ambigua ma decisa dal contesto: alta ma non 1.
    assert_eq!(word(&t, "maestro").confidence, 1.0);
    let c = word(&t, "porta").confidence;
    assert!(c > 0.6 && c <= 1.0, "confidenza {c}");
    // Una parola ambigua in un contesto mai visto è incerta.
    let strano = e.symbolize_text("Porta porta porta.");
    assert!(strano
        .iter()
        .filter(|t| t.surface == "porta")
        .any(|t| t.confidence < 0.9));
}

#[test]
fn le_frasi_sono_indipendenti_e_gli_intervalli_non_cambiano() {
    let e = tagged();
    let testo = "La porta è una giornata. Il maestro porta il pane. Perché?";
    let con = e.symbolize_text(testo);
    let senza = engine("", "").symbolize_text(testo);
    let spans = |t: &[Token]| {
        t.iter()
            .map(|x| (x.span_utf16, x.surface.clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(spans(&con), spans(&senza));
    // La seconda "porta" è verbo, la prima nome, anche nello stesso paragrafo.
    let porte: Vec<Cat> = con
        .iter()
        .filter(|t| t.surface == "porta")
        .map(cat)
        .collect();
    assert_eq!(porte, vec![Cat::Noun, Cat::Verb]);
}
