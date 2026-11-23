//! Normalizzazione delle chiavi di ricerca.
//!
//! È l'unica funzione usata sia alla build del lessico sia a runtime: se divergessero,
//! le ricerche fallirebbero in silenzio (SPEC.md, "Normalizzazione delle chiavi").

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Chiave normalizzata: Unicode NFC, minuscolo, apostrofi uniformati a `'` (anche ‘ ´ ` usati da
/// tastiera), caratteri invisibili tolti (trattino morbido, spazio di larghezza zero, word joiner,
/// BOM: arrivano da testo copiato da Word o PDF), spazi singoli e nessuno spazio ai bordi.
/// Gli accenti **restano** ("pera" e "perà" sono diverse).
pub fn normalize_key(s: &str) -> String {
    let unified: String = s
        .nfc()
        .filter_map(|c| match c {
            '\u{00AD}' | '\u{200B}' | '\u{2060}' | '\u{FEFF}' => None,
            '\u{2018}' | '\u{2019}' | '\u{02BC}' | '\u{2032}' | '\u{00B4}' | '`' => Some('\''),
            // "İ" in minuscolo darebbe "i" + punto combinante, che il lessico non conosce.
            '\u{0130}' => Some('i'),
            c => Some(c),
        })
        .collect();
    let lower = unified.to_lowercase().nfc().collect::<String>();
    lower.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Prefissi elisi riconosciuti dal tokenizzatore (SPEC.md, fase 2: l', un', dell', c', m', s', t', v',
/// d', quest', quell', nessun', buon', sant'), più le altre preposizioni articolate elise
/// (all', dall', nell', sull'). Sempre con l'apostrofo e in minuscolo.
pub const ELIDED_PREFIXES: [&str; 18] = [
    "l'", "un'", "dell'", "all'", "dall'", "nell'", "sull'", "c'", "m'", "s'", "t'", "v'", "d'",
    "quest'", "quell'", "nessun'", "buon'", "sant'",
];

/// Vero se `s` (con l'apostrofo finale, già normalizzato) è un prefisso eliso noto.
pub fn is_elided_prefix(s: &str) -> bool {
    ELIDED_PREFIXES.contains(&s)
}

/// Versione senza accenti di una stringa, usata solo come ripiego per i refusi
/// ("perche" → trova "perché"). Non va mai usata per la ricerca principale.
pub fn fold_accents(s: &str) -> String {
    s.nfd().filter(|c| !is_combining_mark(*c)).nfc().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minuscolo_e_accenti_conservati() {
        assert_eq!(normalize_key("PERCHÉ"), "perché");
        assert_eq!(normalize_key("È"), "è");
        assert_eq!(normalize_key("Città"), "città");
        assert_ne!(normalize_key("pera"), normalize_key("perà"));
    }

    #[test]
    fn forma_scomposta_diventa_composta() {
        // "e" + accento combinante (NFD) deve uguagliare "é" precomposta (NFC).
        assert_eq!(normalize_key("perche\u{0301}"), normalize_key("perché"));
        assert_eq!(normalize_key("cittá").chars().count(), 5);
    }

    #[test]
    fn apostrofi_tipografici_uniformati() {
        assert_eq!(normalize_key("l\u{2019}albero"), "l'albero");
        assert_eq!(normalize_key("un po\u{02BC}"), "un po'");
        assert_eq!(normalize_key("dell\u{2032}acqua"), "dell'acqua");
    }

    #[test]
    fn spazi_singoli() {
        assert_eq!(normalize_key("  scuola \t  media\n"), "scuola media");
        assert_eq!(normalize_key("   "), "");
    }

    #[test]
    fn idempotente() {
        for s in [
            "PERCHÉ",
            "l\u{2019}Albero",
            "  Ferro   da stiro ",
            "perche\u{0301}",
        ] {
            let once = normalize_key(s);
            assert_eq!(normalize_key(&once), once);
        }
    }

    #[test]
    fn apostrofi_e_accenti_da_tastiera() {
        // Revisione M0-M2: ‘ ´ ` si usano spesso al posto dell'apostrofo ("perche´", "po`").
        assert_eq!(normalize_key("perche\u{00B4}"), "perche'");
        assert_eq!(normalize_key("l\u{2018}albero"), "l'albero");
        assert_eq!(normalize_key("po`"), "po'");
    }

    #[test]
    fn caratteri_invisibili_da_word_e_pdf() {
        // Trattino morbido, spazio di larghezza zero, word joiner e BOM non fanno parte della parola.
        assert_eq!(normalize_key("cit\u{00AD}tà"), "città");
        assert_eq!(normalize_key("cit\u{200B}tà"), "città");
        assert_eq!(normalize_key("\u{FEFF}casa"), "casa");
        assert_eq!(normalize_key("ca\u{2060}sa"), "casa");
        // Lo spazio non separabile è uno spazio.
        assert_eq!(normalize_key("scuola\u{00A0}media"), "scuola media");
    }

    #[test]
    fn i_maiuscola_con_punto_diventa_i() {
        // "İ" in minuscolo darebbe "i" + punto combinante: non si troverebbe nel lessico.
        assert_eq!(normalize_key("İstria"), "istria");
        assert_eq!(normalize_key("İSTRIA").chars().count(), 6);
    }

    #[test]
    fn prefissi_elisi() {
        for p in ["l'", "dell'", "all'", "sull'", "un'", "quest'", "sant'"] {
            assert!(is_elided_prefix(p), "{p}");
        }
        // Senza apostrofo, o fuori tabella: no. "po'" è un troncamento, non un prefisso eliso.
        for p in ["l", "dell", "sott'", "po'", "", "'"] {
            assert!(!is_elided_prefix(p), "{p:?}");
        }
        // La tabella contiene solo prefissi minuscoli già normalizzati.
        assert!(ELIDED_PREFIXES
            .iter()
            .all(|p| normalize_key(p) == *p && p.ends_with('\'')));
    }

    #[test]
    fn fold_toglie_gli_accenti() {
        assert_eq!(fold_accents("perché città è"), "perche citta e");
        assert_eq!(fold_accents("perche\u{0301}"), "perche");
        assert_eq!(fold_accents("casa"), "casa");
    }
}
