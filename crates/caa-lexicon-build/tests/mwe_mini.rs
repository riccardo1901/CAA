//! Espressioni multiparola (fase 6) sul mini-lessico: gira in CI, senza dati scaricati.

use caa_engine::engine::{Display, GroupKind, GroupRole, Modifiers, PictoReason, Token};
use caa_engine::mwe::MweIndex;

mod common;
use common::{engine, engine_mwe};

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

// ---- M8c-2: unisci e dividi a mano ----

use caa_engine::engine::{DocPrefs, ForcedPick, Request, SenseLocks, UserMemory};

fn with_forced(
    e: &caa_engine::engine::Engine<Vec<u8>>,
    text: &str,
    forced: &[ForcedPick],
) -> Vec<Token> {
    e.symbolize(&Request {
        text,
        prefs: &DocPrefs::default(),
        forced,
        sense_locks: &SenseLocks::default(),
        memory: &UserMemory::default(),
    })
}

fn forced(s: u32, e: u32, picto: u32) -> ForcedPick {
    ForcedPick {
        span_utf16: (s, e),
        picto,
    }
}

#[test]
fn dividere_una_multiparola_la_scioglie() {
    let e = engine_mwe("", "");
    let text = "Hanno fatto colazione";
    let auto = with_forced(&e, text, &[]);
    assert_eq!(find(&auto, "fatto").picto.map(|p| p.id), Some(132));
    // Dividi su tutta l'espressione, o solo su una parte: nessun gruppo, ogni parola ha il suo simbolo.
    for span in [(0, 21), (6, 21), (12, 21)] {
        let t = with_forced(&e, text, &[forced(span.0, span.1, ForcedPick::SPLIT)]);
        // ("Hanno fatto" resta un tempo composto: la divisione riguarda solo le espressioni.)
        assert!(
            t.iter()
                .all(|t| t.group.is_none_or(|g| g.kind != GroupKind::Multiword)),
            "{span:?}"
        );
        assert_ne!(find(&t, "fatto").picto.map(|p| p.id), Some(132), "{span:?}");
        assert_ne!(find(&t, "colazione").display, Display::Hidden, "{span:?}");
    }
    // Una divisione altrove non tocca l'espressione.
    let t = with_forced(
        &e,
        "Hanno fatto colazione. Il pane",
        &[forced(26, 30, ForcedPick::SPLIT)],
    );
    assert_eq!(find(&t, "fatto").picto.map(|p| p.id), Some(132));
    // Su una parola sola non e' un pittogramma: il valore speciale non finisce mai in un token.
    let t = with_forced(&e, "pane", &[forced(0, 4, ForcedPick::SPLIT)]);
    assert!(t[0].picto.is_some_and(|p| p.id < 1_000_000));
}

#[test]
fn unire_parole_in_un_simbolo_solo() {
    let e = engine("", ""); // senza espressioni: il gruppo e' tutto del docente
    let text = "ferro da stiro";
    // Automatico: il simbolo della frase intera; la prima parola e' la testa, le altre sono nascoste.
    let t = with_forced(&e, text, &[forced(0, 14, ForcedPick::MERGE)]);
    assert_eq!(t[0].picto.map(|p| p.id), Some(131));
    assert_eq!(t[0].display, Display::Full);
    assert_eq!(
        (t[1].display, t[2].display),
        (Display::Hidden, Display::Hidden)
    );
    let g: Vec<_> = t.iter().map(|t| t.group.unwrap()).collect();
    let first = g[0].id;
    assert!(g
        .iter()
        .all(|x| x.id == first && x.kind == GroupKind::Multiword));
    assert_eq!((g[0].role, g[1].role), (GroupRole::Head, GroupRole::Member));
    // Con un pittogramma scelto dal docente.
    let t = with_forced(&e, text, &[forced(0, 14, 104)]);
    assert_eq!(t[0].picto.map(|p| p.id), Some(104));
    assert_eq!(t[0].reason.picto, PictoReason::Teacher);
    // Una frase senza pittogramma: la testa resta senza simbolo e le altre nascoste.
    let t = with_forced(&e, "pane scuola", &[forced(0, 11, ForcedPick::MERGE)]);
    assert_eq!(
        (t[0].picto, t[0].display, t[1].display),
        (None, Display::Full, Display::Hidden)
    );
    // Una scelta singola sulla testa dopo l'unione vince (e non scopre i membri).
    let t = with_forced(
        &e,
        "pane scuola",
        &[forced(0, 11, ForcedPick::MERGE), forced(0, 4, 116)],
    );
    assert_eq!(
        (t[0].picto.map(|p| p.id), t[1].display),
        (Some(116), Display::Hidden)
    );
}

#[test]
fn unioni_che_non_si_possono_fare_non_fanno_niente() {
    let e = engine_mwe("", "");
    let plain = with_forced(&e, "pane, scuola", &[]);
    for (text, span) in [
        ("pane scuola", (1, 11)),  // non allineata alle parole
        ("pane scuola", (0, 4)),   // una parola sola
        ("pane, scuola", (0, 12)), // dentro c'e' la punteggiatura
        ("pane scuola", (0, 40)),  // oltre la fine
        ("pane scuola", (5, 5)),   // vuota
    ] {
        let t = with_forced(&e, text, &[forced(span.0, span.1, ForcedPick::MERGE)]);
        let base = with_forced(&e, text, &[]);
        assert_eq!(
            t.iter()
                .map(|t| (t.display, t.picto, t.group))
                .collect::<Vec<_>>(),
            base.iter()
                .map(|t| (t.display, t.picto, t.group))
                .collect::<Vec<_>>(),
            "{text:?} {span:?}"
        );
    }
    assert!(plain.iter().all(|t| t.group.is_none()));
    // Un gruppo che esce dall'intervallo non si spezza: "fatto colazione" senza "Hanno" non si unisce.
    let t = with_forced(
        &e,
        "Hanno fatto colazione",
        &[forced(6, 21, ForcedPick::MERGE)],
    );
    assert_eq!(find(&t, "fatto").picto.map(|p| p.id), Some(132));
    assert_eq!(find(&t, "Hanno").display, Display::Hidden);
}

#[test]
fn le_alternative_di_un_gruppo_partono_dalla_frase() {
    let e = engine("", "");
    let req = |forced: &[ForcedPick]| {
        let f = forced.to_vec();
        (f, ())
    };
    let (f, _) = req(&[forced(0, 14, 104)]);
    let alts = e.alternatives(
        &Request {
            text: "ferro da stiro",
            prefs: &DocPrefs::default(),
            forced: &f,
            sense_locks: &SenseLocks::default(),
            memory: &UserMemory::default(),
        },
        (0, 5),
    );
    // Il simbolo della frase (131) e' la prima alternativa; il simbolo scelto (104) non c'e'.
    assert_eq!(alts.first().map(|c| c.picto.id), Some(131), "{alts:?}");
    assert!(alts.iter().all(|c| c.picto.id != 104));
}
