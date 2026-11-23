//! Il motore (fasi 1–3 e 8) su un mini-lessico scritto a mano: nessun dato scaricato, quindi gira
//! anche in CI. I test sui dati veri stanno in `caa-eval`.

use caa_engine::engine::{PictoReason, ReadingReason, ReadingSource, Token};
use caa_engine::tokenize::TokenKind;
use caa_engine::types::{Cat, Gender, Mood, Number};

mod common;
use common::engine;

fn run(text: &str) -> Vec<Token> {
    engine("", "").symbolize_text(text)
}

fn word<'a>(tokens: &'a [Token], surface: &str) -> &'a Token {
    tokens
        .iter()
        .find(|t| t.surface == surface)
        .unwrap_or_else(|| panic!("manca {surface:?}"))
}

fn lemma(t: &Token) -> &str {
    &t.analysis.as_ref().expect("lettura").lemma
}

#[test]
fn forma_ambigua_ha_tutte_le_letture_e_una_scelta_provvisoria() {
    let t = run("porta");
    let w = &t[0];
    assert_eq!(w.readings.len(), 3); // nome + due letture verbali
    assert!(
        w.readings.iter().any(|r| r.cat == Cat::Noun)
            && w.readings.iter().any(|r| r.cat == Cat::Verb)
    );
    // Regola provvisoria di M4: con più letture che portano a un pittogramma vince il nome.
    assert_eq!(w.analysis.as_ref().unwrap().cat, Cat::Noun);
    assert_eq!(w.picto.map(|p| p.id), Some(101));
    assert_eq!(w.reason.reading, ReadingReason::BaselinePick);
    assert_eq!(w.reason.picto, PictoReason::ExactForm);
    assert!(w.confidence < 0.6, "ambigua: viene sottolineata");
}

#[test]
fn una_sola_lettura_ha_confidenza_piena() {
    let w = &run("albero")[0];
    assert_eq!(
        (w.confidence, w.reason.reading),
        (1.0, ReadingReason::OnlyReading)
    );
    assert_eq!(w.picto.map(|p| p.id), Some(100));
}

#[test]
fn elisione_e_offset_utf16() {
    let t = run("L'albero è una bella giornata.");
    let surfaces: Vec<&str> = t.iter().map(|t| t.surface.as_str()).collect();
    assert_eq!(
        surfaces,
        ["L'", "albero", "è", "una", "bella", "giornata", "."]
    );
    assert_eq!(t[0].span_utf16, (0, 2));
    assert_eq!(t[1].span_utf16, (2, 8));
    assert_eq!(lemma(&t[0]), "il"); // il prefisso eliso si legge con la tabella del lessico
    assert_eq!(t[6].kind, TokenKind::Punct);
    assert_eq!((t[6].picto, t[6].confidence), (None, 1.0));
}

#[test]
fn prefissi_elisi_risolti_con_la_tabella_della_specifica() {
    // "nell'" mostra il simbolo di "in"; "c'" è "ci"; "un'" è "una".
    let t = run("Metti il pane nell'acqua, c'era un'amica");
    let nell = word(&t, "nell'");
    let a = nell.analysis.as_ref().unwrap();
    assert_eq!((a.lemma.as_str(), a.cat), ("in", Cat::ArtAdp));
    assert_eq!(
        (nell.picto.map(|p| p.id), nell.reason.picto),
        (Some(121), PictoReason::Lemma)
    );
    let c = word(&t, "c'");
    assert_eq!(
        (lemma(c), c.analysis.as_ref().unwrap().cat),
        ("ci", Cat::Clitic)
    );
    assert_eq!(c.picto.map(|p| p.id), Some(122));
    assert_eq!(lemma(word(&t, "un'")), "uno");
}

#[test]
fn e_maiuscola_con_apostrofo_diventa_voce_del_verbo_essere() {
    let t = run("E' una bella giornata");
    assert_eq!(t[0].surface, "E'");
    assert_eq!(t[0].span_utf16, (0, 2)); // il testo originale non cambia
    assert_eq!(lemma(&t[0]), "essere");
    assert_eq!(t[0].picto.map(|p| p.id), Some(111));
}

#[test]
fn accento_scritto_con_apostrofo_solo_se_la_forma_accentata_esiste() {
    let t = run("perche' sì");
    assert_eq!(t[0].surface, "perche'");
    assert_eq!(lemma(&t[0]), "perché");
    assert_eq!(t[0].span_utf16, (0, 7));
    // "ciao'" non diventa una forma accentata: l'apostrofo è una virgoletta e si stacca.
    let t = run("'ciao' disse");
    let surfaces: Vec<&str> = t.iter().map(|t| t.surface.as_str()).collect();
    assert_eq!(surfaces, ["'", "ciao", "'", "disse"]);
    assert_eq!(t[2].kind, TokenKind::Punct);
    assert_eq!(t[2].span_utf16, (5, 6));
}

#[test]
fn troncamento_resta_una_parola() {
    let t = run("un po' di pane");
    let surfaces: Vec<&str> = t.iter().map(|t| t.surface.as_str()).collect();
    assert_eq!(surfaces, ["un", "po'", "di", "pane"]);
    assert_eq!(lemma(&t[1]), "po'");
}

#[test]
fn nome_proprio_dalla_maiuscola() {
    // Sconosciuta e maiuscola, anche a inizio frase: nome proprio.
    let w = &run("Marco")[0];
    assert_eq!(w.analysis.as_ref().unwrap().cat, Cat::Propn);
    assert_eq!(w.reason.reading, ReadingReason::Capital);
    assert_eq!(w.confidence, 0.8);
    // Nota ma con la maiuscola a metà frase: lettura di nome proprio in più, e vince.
    let t = run("La Rosa");
    let rosa = word(&t, "Rosa");
    assert!(
        rosa.readings.iter().any(|r| r.cat == Cat::Propn)
            && rosa.readings.iter().any(|r| r.cat == Cat::Noun)
    );
    assert_eq!(rosa.analysis.as_ref().unwrap().cat, Cat::Propn);
    // A inizio frase la maiuscola non basta: nessuna lettura in più.
    let t = run("Rosa");
    assert!(t[0].readings.iter().all(|r| r.cat != Cat::Propn));
}

#[test]
fn chiave_arasaac_per_parole_sconosciute_a_morph_it() {
    // "mandorle" non è nel lessico morfologico, ma è il plurale indicato da ARASAAC per "mandorla".
    let w = &run("mandorle")[0];
    let a = w.analysis.as_ref().unwrap();
    assert_eq!(
        (a.source, a.cat, a.lemma.as_str()),
        (ReadingSource::ArasaacKey, Cat::Noun, "mandorla")
    );
    assert_eq!(a.feats.number, Some(Number::P));
    assert_eq!(w.picto.map(|p| p.id), Some(108));
    assert_eq!(
        (w.confidence, w.reason.reading),
        (0.7, ReadingReason::ArasaacKey)
    );
    // Il singolare: genere e numero dal suffisso.
    let a = run("mandorla")[0].analysis.clone().unwrap();
    assert_eq!(
        (a.feats.gender, a.feats.number),
        (Some(Gender::F), Some(Number::S))
    );
    // Più tipi sulla stessa chiave: una lettura per tipo (giallo = aggettivo e nome).
    let w = &run("giallo")[0];
    let cats: Vec<Cat> = w.readings.iter().map(|r| r.cat).collect();
    assert!(cats.contains(&Cat::Adj) && cats.contains(&Cat::Noun));
}

#[test]
fn chiavi_di_frasi_o_senza_tipo_non_producono_letture() {
    // "ciao!" è una frase (tipo 5): non crea una lettura da chiave. "ciao" è nel lessico.
    let w = &run("ciao")[0];
    assert_eq!(w.readings[0].source, ReadingSource::Lexicon);
}

#[test]
fn refuso_a_distanza_uno_con_una_sola_forma_vicina() {
    let w = &run("scuoia")[0];
    assert_eq!(w.corrected.as_deref(), Some("scuola"));
    assert_eq!(lemma(w), "scuola");
    assert_eq!((w.confidence, w.reason.reading), (0.4, ReadingReason::Typo));
    assert!(w.confidence < 0.6);
    // Parole corte: nessuna correzione (troppo rischioso).
    let w = &run("sua")[0];
    assert!(w.corrected.is_none());
}

#[test]
fn indovino_per_suffisso_e_parole_sconosciute() {
    let w = &run("grigliare")[0];
    let a = w.analysis.as_ref().unwrap();
    assert_eq!(
        (a.cat, a.feats.mood, a.source),
        (Cat::Verb, Some(Mood::Inf), ReadingSource::SuffixGuess)
    );
    assert_eq!((w.confidence, w.picto), (0.3, None));
    let w = &run("xqzwvk")[0];
    assert_eq!(
        (w.kind, w.analysis.is_none(), w.confidence),
        (TokenKind::Unknown, true, 0.0)
    );
    assert_eq!(w.reason.reading, ReadingReason::NoReading);
}

#[test]
fn numeri_in_cifre_come_in_lettere() {
    let t = run("3 volte");
    assert_eq!(t[0].kind, TokenKind::Number);
    assert_eq!(t[0].picto.map(|p| p.id), Some(109));
    assert_eq!(t[0].reason.picto, PictoReason::NumberWord);
    // Un orario resta un token unico e senza pittogramma.
    let t = run("alle 8:30");
    assert_eq!(word(&t, "8:30").kind, TokenKind::Number);
    assert!(word(&t, "8:30").picto.is_none());
}

#[test]
fn forma_esatta_e_pittogramma_del_singolare() {
    // "occhiali": forma esatta, nessun singolare cercato.
    let w = &run("occhiali")[0];
    assert_eq!(
        (w.picto.map(|p| p.id), w.reason.picto),
        (Some(105), PictoReason::ExactForm)
    );
    // "maestre" → "maestra", non "maestro" (anche se il lemma di Morph-it! è maschile).
    let w = &run("maestre")[0];
    assert_eq!(lemma(w), "maestro");
    assert_eq!(
        (w.picto.map(|p| p.id), w.reason.picto),
        (Some(106), PictoReason::Singular)
    );
}

#[test]
fn il_plurale_si_usa_solo_se_e_il_plurale_dello_stesso_lemma() {
    // Singolare senza pittogramma, plurale in ARASAAC: si usa il plurale…
    let w = &run("pastello")[0];
    assert_eq!(
        (w.picto.map(|p| p.id), w.reason.picto),
        (Some(125), PictoReason::PluralForm)
    );
    // …anche per i plurali irregolari (labbro → labbra, uomo → uomini)…
    let w = &run("labbro")[0];
    assert_eq!(
        (w.picto.map(|p| p.id), w.reason.picto),
        (Some(123), PictoReason::PluralForm)
    );
    let w = &run("uomo")[0];
    assert_eq!(
        (w.picto.map(|p| p.id), w.reason.picto),
        (Some(126), PictoReason::PluralForm)
    );
    // …ma "pasto" non diventa "pasta": "pasta" è il singolare di un'altra parola.
    let w = &run("pasto")[0];
    assert_eq!((w.picto, w.reason.picto), (None, PictoReason::NoSymbol));
    // Una parola che ha già il suo pittogramma non passa dal plurale.
    assert_eq!(run("pasta")[0].reason.picto, PictoReason::ExactForm);
}

#[test]
fn a_parita_vince_la_prima_chiave_poi_il_pittogramma_piu_specifico() {
    // "pane" ha due pittogrammi: uno con una sola parola chiave, uno con tre (più generico).
    assert_eq!(run("pane")[0].picto.map(|p| p.id), Some(104));
}

#[test]
fn pittogramma_preferito_e_blocklist() {
    let w = &engine("pane\tNOUN\t116\t5\tpreferito\n", "").symbolize_text("pane")[0];
    assert_eq!(
        (w.picto.map(|p| p.id), w.reason.picto),
        (Some(116), PictoReason::Curated)
    );
    // La categoria deve coincidere: una preferenza per il verbo non vale per il nome.
    let w = &engine("pane\tVERB\t116\t5\n", "").symbolize_text("pane")[0];
    assert_eq!(w.picto.map(|p| p.id), Some(104));
    // Blocco: il pittogramma 104 non si propone mai per "pane"; resta il 116.
    let w = &engine("", "pane\t104\tinadatto\n").symbolize_text("pane")[0];
    assert_eq!(w.picto.map(|p| p.id), Some(116));
    // Se si bloccano entrambi, nessun simbolo.
    let w = &engine("", "pane\t104\npane\t116\n").symbolize_text("pane")[0];
    assert_eq!(
        (w.picto, w.reason.picto, w.display),
        (
            None,
            PictoReason::NoSymbol,
            caa_engine::engine::Display::TextOnly
        )
    );
}

#[test]
fn parole_funzionali_senza_pittogramma_restano_solo_testo() {
    let w = &run("di")[0];
    assert_eq!(
        (w.picto, w.display),
        (None, caa_engine::engine::Display::TextOnly)
    );
    assert_eq!(w.analysis.as_ref().unwrap().cat, Cat::Adp);
}

#[test]
fn ignorando_la_categoria_si_trova_comunque_qualcosa_con_penalita() {
    // "rosa" è nome nel lessico e ha un pittogramma di tipo nome: nessuna penalità.
    let w = &run("rosa")[0];
    assert_eq!((w.picto.map(|p| p.id), w.confidence), (Some(117), 1.0));
    // "la" ha un pittogramma di tipo 6 (non di nome): l'articolo lo trova per categoria,
    // il nome "la" (nota musicale) no.
    let w = &run("la")[0];
    assert!(w.picto.is_some());
}

#[test]
fn offset_utf16_con_emoji_e_accenti() {
    let text = "città 😀 perché";
    let t = run(text);
    let units: Vec<u16> = text.encode_utf16().collect();
    for tok in &t {
        let slice =
            String::from_utf16(&units[tok.span_utf16.0 as usize..tok.span_utf16.1 as usize])
                .unwrap();
        assert_eq!(slice, tok.surface);
    }
    // L'attesa si calcola contando le unità UTF-16 del testo che precede (l'emoji ne vale 2).
    let before = text[..text.find("perché").unwrap()].encode_utf16().count() as u32;
    assert_eq!(word(&t, "perché").span_utf16, (before, before + 6));
    assert_eq!(before, 9);
}

// --- Fase 4: clitici attaccati al verbo -------------------------------------------------

fn enclitic(t: &Token) -> Vec<(String, &'static str, ReadingSource)> {
    t.readings
        .iter()
        .filter_map(|r| {
            r.feats
                .enclitic
                .map(|e| (r.lemma.clone(), e.as_str(), r.source))
        })
        .collect()
}

#[test]
fn verbo_con_due_clitici_si_scompone() {
    let t = run("Portamelo");
    let found = enclitic(&t[0]);
    assert_eq!(
        found,
        vec![("portare".into(), "melo", ReadingSource::Enclitic)]
    );
    assert_eq!(t[0].analysis.as_ref().unwrap().cat, Cat::Verb);
    // Gli intervalli non cambiano: resta un token solo.
    assert_eq!((t.len(), t[0].span_utf16), (1, (0, 9)));
}

#[test]
fn infinito_e_gerundio_con_clitico() {
    let t = run("lavarsi dicendolo prendilo");
    let get = |i: usize| {
        enclitic(&t[i])
            .pop()
            .unwrap_or_else(|| panic!("token {i}: {:?}", t[i]))
    };
    assert_eq!(get(0), ("lavare".into(), "si", ReadingSource::Enclitic));
    assert_eq!(get(1), ("dire".into(), "lo", ReadingSource::Enclitic));
    assert_eq!(get(2), ("prendere".into(), "lo", ReadingSource::Enclitic));
}

#[test]
fn non_si_scompone_una_parola_che_non_e_un_verbo_con_clitico() {
    // "giovane" = giova (imperativo di giovare) + ne? No: è un aggettivo di Morph-it!.
    for w in ["giovane", "pane", "pasta", "scuola", "maestre"] {
        let t = run(w);
        assert!(enclitic(&t[0]).is_empty(), "{w}");
    }
}

// --- Fasi 5 e 9: tempi, gruppi verbali, pronominali, plurale ----------------------------------

use caa_engine::engine::{Display, GroupKind, GroupRole, Modifiers};

fn mods(t: &Token) -> u8 {
    t.modifiers.0
}

#[test]
fn passato_prossimo_nasconde_l_ausiliare_e_segna_il_passato() {
    let t = run("Ho mangiato il pane.");
    let (ho, mangiato) = (word(&t, "Ho"), word(&t, "mangiato"));
    assert_eq!(ho.display, Display::Hidden);
    assert_eq!(mangiato.display, Display::Full);
    assert_eq!(mods(mangiato), Modifiers::PAST);
    assert_eq!(mods(ho), 0);
    let (g1, g2) = (ho.group.unwrap(), mangiato.group.unwrap());
    assert_eq!(
        (g1.id, g1.kind, g1.role),
        (g2.id, GroupKind::Compound, GroupRole::Member)
    );
    assert_eq!(g2.role, GroupRole::Head);
    assert!(word(&t, "pane").group.is_none());
}

#[test]
fn essere_senza_participio_resta_un_verbo_pieno_con_il_segno() {
    // "era" da solo: essere all'imperfetto, visibile, con PASSATO (golden 9).
    let t = run("era");
    assert_eq!(
        (t[0].display, mods(&t[0]), t[0].group),
        (Display::Full, Modifiers::PAST, None)
    );
    // "ho" senza participio: nessun gruppo, non nascosto, nessun segno.
    let t = run("ho il pane");
    let ho = word(&t, "ho");
    assert_ne!(ho.display, Display::Hidden);
    assert_eq!((mods(ho), ho.group), (0, None));
}

#[test]
fn futuro_semplice_e_stare_con_gerundio() {
    assert_eq!(mods(&run("mangerò")[0]), Modifiers::FUTURE);
    let t = run("stava dormendo");
    assert_eq!(
        (t[0].display, t[1].display),
        (Display::Hidden, Display::Full)
    );
    assert_eq!(
        (mods(&t[1]), t[1].group.unwrap().kind),
        (Modifiers::PAST, GroupKind::Progressive)
    );
    let t = run("sto dormendo");
    assert_eq!(mods(&t[1]), 0);
}

#[test]
fn verbo_pronominale_prende_il_pittogramma_di_lavarsi() {
    // "mi lavo": riflessivo della stessa persona e "lavarsi" esiste in ARASAAC.
    let t = run("Mi lavo");
    assert_eq!(
        (t[0].display, t[1].picto.map(|p| p.id)),
        (Display::Hidden, Some(127))
    );
    assert_eq!(t[1].group.unwrap().kind, GroupKind::Pronominal);
    assert_eq!(t[1].reason.picto, PictoReason::Pronominal);
    // Con il tempo composto: "mi sono lavato" = lavarsi + PASSATO, "mi" e "sono" nascosti.
    let t = run("Mi sono lavato");
    assert_eq!(
        (
            t[0].display,
            t[1].display,
            t[2].display,
            t[2].picto.map(|p| p.id),
            mods(&t[2])
        ),
        (
            Display::Hidden,
            Display::Hidden,
            Display::Full,
            Some(127),
            Modifiers::PAST
        )
    );
    // "lavarsi" attaccato: stesso pittogramma.
    assert_eq!(run("lavarsi")[0].picto.map(|p| p.id), Some(127));
}

#[test]
fn senza_pittogramma_pronominale_il_clitico_resta() {
    // "andare" non ha "andarsi" in ARASAAC: "mi sono andato" non forma un gruppo pronominale.
    let t = run("Mi sono andato");
    assert_ne!(t[0].display, Display::Hidden);
    assert_ne!(t[0].group.map(|g| g.kind), Some(GroupKind::Pronominal));
}

#[test]
fn plurale_solo_se_il_pittogramma_e_del_singolare() {
    // maestre → maestra + PLURALE; occhiali ha una parola chiave propria: nessun segno.
    assert_eq!(mods(&run("maestre")[0]), Modifiers::PLURAL);
    assert_eq!(mods(&run("occhiali")[0]), 0);
    assert_eq!(mods(&run("maestra")[0]), 0);
    // Un plurale che non ha un pittogramma né singolare né plurale: niente segno.
    assert_eq!(mods(&run("labbra")[0]), 0);
}
