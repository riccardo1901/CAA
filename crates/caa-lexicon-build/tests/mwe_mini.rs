//! Espressioni multiparola (fase 6) sul mini-lessico: gira in CI, senza dati scaricati.

use caa_engine::engine::{Display, GroupKind, GroupRole, Modifiers, PictoReason, Token};
use caa_engine::mwe::MweIndex;

mod common;
use common::engine_mwe;

fn run(text: &str) -> Vec<Token> {
    engine_mwe("", "").symbolize_text(text)
}

fn find<'a>(t: &'a [Token], surface: &str) -> &'a Token {
    t.iter()
        .find(|t| t.surface == surface)
        .unwrap_or_else(|| panic!("manca {surface:?}"))
}

#[test]
fn la_chiave_si_trova_dalla_forma_flessa() {
    // "far colazione" è la chiave ARASAAC; "hanno fatto colazione" si riduce a [fare, colazione].
    let t = run("Hanno fatto colazione");
    let (hanno, fatto, colazione) = (find(&t, "Hanno"), find(&t, "fatto"), find(&t, "colazione"));
    assert_eq!(fatto.picto.map(|p| p.id), Some(132));
    assert_eq!(fatto.reason.picto, PictoReason::Multiword);
    assert_eq!(fatto.display, Display::Full);
    // Il passato dell'ausiliare resta sulla testa; ausiliare e nome sono nascosti.
    assert_eq!(fatto.modifiers.0, Modifiers::PAST);
    assert_eq!(
        (hanno.display, colazione.display),
        (Display::Hidden, Display::Hidden)
    );
    let ids: Vec<_> = [hanno, fatto, colazione]
        .iter()
        .map(|t| t.group.unwrap().id)
        .collect();
    assert!(ids.iter().all(|i| *i == ids[0]));
    assert_eq!(fatto.group.unwrap().kind, GroupKind::Multiword);
    assert_eq!(fatto.group.unwrap().role, GroupRole::Head);
}

#[test]
fn plurale_della_multiparola() {
    // "i ferri da stiro": il pittogramma è del singolare (ARASAAC indica il plurale), quindi PLURALE.
    let t = run("i ferri da stiro");
    let ferri = find(&t, "ferri");
    assert_eq!(ferri.picto.map(|p| p.id), Some(131));
    assert_eq!(ferri.modifiers.0, Modifiers::PLURAL);
    assert_eq!(
        (find(&t, "da").display, find(&t, "stiro").display),
        (Display::Hidden, Display::Hidden)
    );
    // L'articolo resta fuori dall'espressione.
    assert!(find(&t, "i").group.is_none());
    // Al singolare nessun segno.
    assert_eq!(find(&run("il ferro da stiro"), "ferro").modifiers.0, 0);
}

#[test]
fn verbo_pronominale_con_complemento_mi_sono_lavato_i_denti() {
    // [lavarsi, il, dente]: "mi sono lavato" è un gruppo, poi "i denti" completano la chiave.
    let t = run("Mi sono lavato i denti");
    let lavato = find(&t, "lavato");
    assert_eq!(lavato.picto.map(|p| p.id), Some(133));
    assert_eq!(lavato.modifiers.0, Modifiers::PAST);
    for w in ["Mi", "sono", "i", "denti"] {
        assert_eq!(find(&t, w).display, Display::Hidden, "{w}");
    }
    // La chiave dice "denti" come nel testo: nessun PLURALE.
    assert_eq!(lavato.modifiers.0 & Modifiers::PLURAL, 0);
}

#[test]
fn la_blocklist_vale_anche_per_le_multiparola() {
    let blocked =
        engine_mwe("", "far colazione\t132\tprova\n").symbolize_text("Hanno fatto colazione");
    assert_ne!(find(&blocked, "fatto").picto.map(|p| p.id), Some(132));
    assert_ne!(find(&blocked, "colazione").display, Display::Hidden);
}

#[test]
fn senza_indice_non_cambia_niente() {
    let t = common::engine("", "").symbolize_text("Hanno fatto colazione");
    assert!(t
        .iter()
        .all(|t| t.group.map(|g| g.kind) != Some(GroupKind::Multiword)));
}

#[test]
fn le_parole_non_contigue_non_formano_l_espressione() {
    // La punteggiatura interrompe la sequenza.
    let t = run("fatto, colazione");
    assert!(t.iter().all(|t| t.group.is_none()));
    let _ = MweIndex::<Vec<u8>>::record_count;
}

#[test]
fn le_tre_dell_ora_non_assorbe_un_numero_davanti_a_un_nome() {
    // "le tre" è l'ora (ARASAAC), ma in "le tre mele" è articolo + numero + nome (revisione M5-M6).
    let t = run("le tre mele");
    assert!(t.iter().all(|t| t.group.is_none()), "{t:?}");
    assert!(t.iter().all(|t| t.display != Display::Hidden));
    // Senza un nome dopo resta l'espressione dell'ora.
    let t = run("sono le tre");
    assert_eq!(find(&t, "le").picto.map(|p| p.id), Some(135));
    assert_eq!(find(&t, "tre").display, Display::Hidden);
}
