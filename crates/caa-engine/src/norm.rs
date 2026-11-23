//! Normalizzazione delle chiavi di ricerca.
//!
//! È l'unica funzione usata sia alla build del lessico sia a runtime: se divergessero,
//! le ricerche fallirebbero in silenzio (SPEC.md, "Normalizzazione delle chiavi").

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Chiave normalizzata: Unicode NFC, minuscolo, apostrofi tipografici uniformati a `'`,
/// spazi singoli e nessuno spazio ai bordi. Gli accenti **restano** ("pera" e "perà" sono diverse).
pub fn normalize_key(s: &str) -> String {
    let unified: String = s
        .nfc()
        .map(|c| match c {
            '\u{2019}' | '\u{02BC}' | '\u{2032}' => '\'',
            c => c,
        })
        .collect();
    let lower = unified.to_lowercase().nfc().collect::<String>();
    lower.split_whitespace().collect::<Vec<_>>().join(" ")
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
    fn fold_toglie_gli_accenti() {
        assert_eq!(fold_accents("perché città è"), "perche citta e");
        assert_eq!(fold_accents("perche\u{0301}"), "perche");
        assert_eq!(fold_accents("casa"), "casa");
    }
}
