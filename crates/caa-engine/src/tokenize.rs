//! Tokenizzazione italiana (SPEC.md, fase 2). Lavora sul testo originale: gli intervalli dei
//! token sono in byte UTF-8 (per tagliare il testo) e in unità UTF-16 (per l'interfaccia), quindi
//! gli accenti e le emoji non sfasano mai. La normalizzazione (fase 1) si applica poi a ogni
//! token, mai al testo intero.

use unicode_normalization::char::is_combining_mark;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Word,
    Number,
    Punct,
    Symbol,
    /// Parola che l'analisi non sa leggere (la assegna la fase 3, non il tokenizzatore).
    Unknown,
}

/// Un token prima dell'analisi.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawToken {
    pub byte_start: usize,
    pub byte_end: usize,
    /// Intervallo in unità UTF-16 (come in JavaScript).
    pub start16: u32,
    pub end16: u32,
    pub kind: TokenKind,
    /// La parola finisce con un apostrofo non seguito da lettera ("po'", "E'", "perche'"): può
    /// essere un troncamento o una forma senza accento. L'analisi decide se tenerlo o staccarlo.
    pub trailing_apostrophe: bool,
}

#[derive(Clone, Copy)]
struct Ch {
    byte: usize,
    u16: u32,
    c: char,
}

fn is_apostrophe(c: char) -> bool {
    matches!(c, '\'' | '\u{2019}' | '\u{02BC}' | '\u{2032}')
}

fn is_hyphen(c: char) -> bool {
    matches!(c, '-' | '\u{2010}' | '\u{2011}')
}

fn is_word_char(c: char) -> bool {
    // U+02BC (apostrofo modificatore) è una "lettera" per Unicode, ma qui è un apostrofo.
    (c.is_alphabetic() && !is_apostrophe(c)) || is_combining_mark(c)
}

fn is_punct(c: char) -> bool {
    matches!(
        c,
        '.' | ','
            | ';'
            | ':'
            | '!'
            | '?'
            | '\u{2026}'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '\u{00AB}'
            | '\u{00BB}'
            | '\u{201C}'
            | '\u{201D}'
            | '\u{201E}'
            | '"'
            | '\u{2018}'
            | '\u{2019}'
            | '\''
            | '-'
            | '\u{2010}'
            | '\u{2011}'
            | '\u{2012}'
            | '\u{2013}'
            | '\u{2014}'
            | '\u{2015}'
            | '/'
            | '\\'
            | '_'
            | '|'
    )
}

/// Divide un paragrafo in token. Gli spazi (anche a capo e spazio non separabile) separano e non
/// producono token.
pub fn tokenize(text: &str) -> Vec<RawToken> {
    let mut chars: Vec<Ch> = Vec::with_capacity(text.len());
    let mut u16 = 0u32;
    for (byte, c) in text.char_indices() {
        chars.push(Ch { byte, u16, c });
        u16 += c.len_utf16() as u32;
    }
    let end = |idx: usize| -> (usize, u32) {
        chars
            .get(idx)
            .map_or((text.len(), u16), |c| (c.byte, c.u16))
    };
    let at = |idx: usize| chars.get(idx).map(|c| c.c);

    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i].c;
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let mut kind = TokenKind::Punct;
        let mut trailing = false;
        if c.is_ascii_digit() {
            // Numeri, orari e date restano un token ("8:30", "12/11/2026", "3,5").
            kind = TokenKind::Number;
            while at(i).is_some_and(|c| c.is_ascii_digit()) {
                i += 1;
            }
            while at(i).is_some_and(|c| matches!(c, '.' | ',' | ':' | '/'))
                && at(i + 1).is_some_and(|c| c.is_ascii_digit())
            {
                i += 1;
                while at(i).is_some_and(|c| c.is_ascii_digit()) {
                    i += 1;
                }
            }
        } else if c.is_alphabetic() && !is_apostrophe(c) {
            kind = TokenKind::Word;
            loop {
                while at(i).is_some_and(is_word_char) {
                    i += 1;
                }
                match at(i) {
                    // "anti-age" resta un token: trattino tra due lettere.
                    Some(h) if is_hyphen(h) && at(i + 1).is_some_and(is_word_char) => i += 1,
                    // Elisione: il prefisso porta l'apostrofo e il resto è un altro token.
                    Some(a)
                        if is_apostrophe(a) && at(i + 1).is_some_and(|n| n.is_alphanumeric()) =>
                    {
                        i += 1;
                        break;
                    }
                    // Troncamento o accento scritto con l'apostrofo ("po'", "E'", "perche'").
                    Some(a) if is_apostrophe(a) => {
                        i += 1;
                        trailing = true;
                        break;
                    }
                    _ => break,
                }
            }
        } else if c == '.' && at(i + 1) == Some('.') && at(i + 2) == Some('.') {
            while at(i) == Some('.') {
                i += 1;
            }
        } else {
            if !is_punct(c) {
                kind = TokenKind::Symbol;
            }
            i += 1;
        }
        let (byte_start, start16) = (chars[start].byte, chars[start].u16);
        let (byte_end, end16) = end(i);
        out.push(RawToken {
            byte_start,
            byte_end,
            start16,
            end16,
            kind,
            trailing_apostrophe: trailing,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Token come "TIPO:testo" per confrontarli a colpo d'occhio.
    fn toks(text: &str) -> Vec<String> {
        tokenize(text)
            .iter()
            .map(|t| {
                let k = match t.kind {
                    TokenKind::Word => "W",
                    TokenKind::Number => "N",
                    TokenKind::Punct => "P",
                    TokenKind::Symbol => "S",
                    TokenKind::Unknown => "U",
                };
                format!("{k}:{}", &text[t.byte_start..t.byte_end])
            })
            .collect()
    }

    fn slice16(text: &str, a: u32, b: u32) -> String {
        let units: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&units[a as usize..b as usize]).unwrap()
    }

    #[test]
    fn frase_semplice_con_accenti() {
        assert_eq!(
            toks("Marco è a casa perché è in città."),
            [
                "W:Marco",
                "W:è",
                "W:a",
                "W:casa",
                "W:perché",
                "W:è",
                "W:in",
                "W:città",
                "P:."
            ]
        );
    }

    #[test]
    fn elisione_divide_in_prefisso_e_parola() {
        assert_eq!(toks("l'albero"), ["W:l'", "W:albero"]);
        assert_eq!(toks("dell'acqua"), ["W:dell'", "W:acqua"]);
        assert_eq!(
            toks("C'era una volta"),
            ["W:C'", "W:era", "W:una", "W:volta"]
        );
        assert_eq!(toks("quest'anno"), ["W:quest'", "W:anno"]);
        assert_eq!(toks("nell'8 marzo"), ["W:nell'", "N:8", "W:marzo"]);
        assert_eq!(toks("un'amica"), ["W:un'", "W:amica"]);
    }

    #[test]
    fn apostrofo_tipografico_come_quello_dritto() {
        let t = "l\u{2019}albero";
        assert_eq!(toks(t), ["W:l\u{2019}", "W:albero"]);
        assert_eq!(toks("dell\u{02BC}acqua").len(), 2);
    }

    #[test]
    fn apostrofo_finale_segnalato() {
        let t = tokenize("un po' di pane");
        assert_eq!(t.len(), 4);
        assert!(t[1].trailing_apostrophe && !t[0].trailing_apostrophe);
        assert_eq!(
            toks("E' una bella giornata"),
            ["W:E'", "W:una", "W:bella", "W:giornata"]
        );
        assert!(tokenize("perche' no")[0].trailing_apostrophe);
        // Un apostrofo iniziale (virgolette) è punteggiatura.
        assert_eq!(toks("'ciao"), ["P:'", "W:ciao"]);
    }

    #[test]
    fn numeri_orari_e_date_sono_un_token() {
        assert_eq!(
            toks("alle 8:30 del 12/11/2026, 3,5 kg e 1.000 euro"),
            [
                "W:alle",
                "N:8:30",
                "W:del",
                "N:12/11/2026",
                "P:,",
                "N:3,5",
                "W:kg",
                "W:e",
                "N:1.000",
                "W:euro"
            ]
        );
        // Un punto dopo una cifra, senza altre cifre, chiude la frase.
        assert_eq!(toks("ho 3."), ["W:ho", "N:3", "P:."]);
        assert_eq!(toks("3a B"), ["N:3", "W:a", "W:B"]);
    }

    #[test]
    fn trattini() {
        assert_eq!(
            toks("un trattamento anti-age"),
            ["W:un", "W:trattamento", "W:anti-age"]
        );
        assert_eq!(
            toks("– Ciao! — disse"),
            ["P:–", "W:Ciao", "P:!", "P:—", "W:disse"]
        );
        assert_eq!(toks("tre - due"), ["W:tre", "P:-", "W:due"]);
        assert_eq!(toks("casa-"), ["W:casa", "P:-"]);
    }

    #[test]
    fn punteggiatura_virgolette_e_puntini() {
        assert_eq!(toks("«Ciao!»"), ["P:«", "W:Ciao", "P:!", "P:»"]);
        assert_eq!(toks("Boh... forse…"), ["W:Boh", "P:...", "W:forse", "P:…"]);
        assert_eq!(
            toks("(sì), no; ok: bene?"),
            ["P:(", "W:sì", "P:)", "P:,", "W:no", "P:;", "W:ok", "P::", "W:bene", "P:?"]
        );
    }

    #[test]
    fn simboli_ed_emoji() {
        assert_eq!(toks("€ 5 😀 100%"), ["S:€", "N:5", "S:😀", "N:100", "S:%"]);
    }

    #[test]
    fn spazi_e_a_capo_non_producono_token() {
        assert_eq!(
            toks("  uno\ndue\u{00A0}tre \t"),
            ["W:uno", "W:due", "W:tre"]
        );
        assert!(tokenize("").is_empty() && tokenize("   \n ").is_empty());
    }

    #[test]
    fn lettera_con_accento_scomposto_resta_una_parola() {
        assert_eq!(toks("perche\u{0301} si"), ["W:perche\u{0301}", "W:si"]);
    }

    #[test]
    fn gli_offset_utf16_non_sfasano_con_accenti_ed_emoji() {
        let text = "Marco è a casa 😀 perché è in città 😀😀 ok";
        for t in tokenize(text) {
            // L'intervallo UTF-16 e quello in byte indicano lo stesso testo.
            assert_eq!(
                slice16(text, t.start16, t.end16),
                &text[t.byte_start..t.byte_end]
            );
        }
        let t = tokenize(text);
        let che = t
            .iter()
            .find(|t| &text[t.byte_start..t.byte_end] == "perché")
            .unwrap();
        // "Marco è a casa 😀 " = 18 unità UTF-16 (l'emoji ne vale 2).
        assert_eq!((che.start16, che.end16), (18, 24));
        let last = t.last().unwrap();
        assert_eq!(last.end16 as usize, text.encode_utf16().count());
    }

    #[test]
    fn i_token_sono_ordinati_senza_sovrapposizioni() {
        for text in [
            "Il bambino stava dormendo.",
            "E' l'una e un quarto: c'è un po' di tempo… 3,5 € 😀",
            "– «Dammi il libro!» – disse l'amica di Marco.",
            "",
        ] {
            let mut prev_end = 0;
            for t in tokenize(text) {
                assert!(
                    t.byte_start >= prev_end && t.byte_end > t.byte_start,
                    "{text:?}"
                );
                prev_end = t.byte_end;
            }
        }
    }
}
