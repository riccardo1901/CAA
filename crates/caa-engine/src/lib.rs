//! `caa-engine`: libreria pura. Nessun I/O, nessuna rete, nessuna dipendenza dall'interfaccia.
//!
//! In M0 contiene solo lo scheletro e la conversione degli offset in unità UTF-16.

/// Intervallo di un token nel paragrafo, in unità UTF-16 (come in JavaScript).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpanUtf16 {
    pub start: u32,
    pub end: u32,
}

/// Converte un intervallo di byte UTF-8 in unità UTF-16.
///
/// Panica se gli indici non cadono su confini di carattere o sono fuori dal testo.
pub fn utf8_range_to_utf16(text: &str, start_byte: usize, end_byte: usize) -> SpanUtf16 {
    assert!(
        text.is_char_boundary(start_byte) && text.is_char_boundary(end_byte),
        "indici non su confine di carattere"
    );
    let start: usize = text[..start_byte].encode_utf16().count();
    let len: usize = text[start_byte..end_byte].encode_utf16().count();
    SpanUtf16 {
        start: start as u32,
        end: (start + len) as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trova la parola `word` in `text` e restituisce il suo intervallo UTF-16.
    fn span_of(text: &str, word: &str) -> SpanUtf16 {
        let b = text.find(word).expect("parola assente");
        utf8_range_to_utf16(text, b, b + word.len())
    }

    #[test]
    fn ascii_invariato() {
        assert_eq!(
            span_of("il gatto dorme", "gatto"),
            SpanUtf16 { start: 3, end: 8 }
        );
    }

    #[test]
    fn parole_accentate_non_sfasano() {
        // "è" occupa 2 byte in UTF-8 ma 1 unità UTF-16.
        let t = "Marco è a casa perché è in città";
        assert_eq!(span_of(t, "è"), SpanUtf16 { start: 6, end: 7 });
        assert_eq!(span_of(t, "casa"), SpanUtf16 { start: 10, end: 14 });
        assert_eq!(span_of(t, "perché"), SpanUtf16 { start: 15, end: 21 });
        assert_eq!(span_of(t, "città"), SpanUtf16 { start: 27, end: 32 });
    }

    #[test]
    fn caratteri_fuori_dal_piano_base_valgono_due_unita() {
        // L'emoji è 4 byte in UTF-8 e 2 unità UTF-16 (coppia surrogata).
        let t = "ciao 😀 città";
        assert_eq!(span_of(t, "😀"), SpanUtf16 { start: 5, end: 7 });
        assert_eq!(span_of(t, "città"), SpanUtf16 { start: 8, end: 13 });
    }
}
