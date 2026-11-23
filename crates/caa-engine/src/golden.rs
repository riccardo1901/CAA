//! Test dorati di tokenizzazione (SPEC.md, "Due livelli di test"): frasi con i token attesi,
//! lette da un file di testo e verificate sul motore. Lo stesso file serve ai test in CI (con un
//! mini-lessico), a `caa-eval` e ai test sui dati veri.
//!
//! Formato: una riga per caso, `frase<TAB>token…`, con i token separati da spazio nella forma
//! `K:testo` (K = W parola, N numero, P punteggiatura, S simbolo). Una parola che l'analisi non sa
//! leggere conta come W. Righe vuote e righe che iniziano con `#` sono ignorate.

use crate::engine::{Engine, Token};
use crate::tokenize::TokenKind;

#[derive(Debug, Clone)]
pub struct GoldenCase {
    pub line: usize,
    pub sentence: String,
    pub tokens: Vec<(char, String)>,
}

pub fn parse(text: &str) -> Result<Vec<GoldenCase>, Vec<String>> {
    let mut cases = Vec::new();
    let mut errors = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((sentence, tokens)) = line.split_once('\t') else {
            errors.push(format!("riga {}: manca la tabulazione", i + 1));
            continue;
        };
        let parsed: Option<Vec<(char, String)>> = tokens
            .split(' ')
            .filter(|t| !t.is_empty())
            .map(|t| {
                let (k, s) = t.split_once(':')?;
                let k = k
                    .chars()
                    .next()
                    .filter(|_| k.len() == 1 && "WNPS".contains(k))?;
                (!s.is_empty()).then(|| (k, s.to_string()))
            })
            .collect();
        match parsed {
            Some(tokens) if !tokens.is_empty() => {
                cases.push(GoldenCase {
                    line: i + 1,
                    sentence: sentence.to_string(),
                    tokens,
                });
            }
            _ => errors.push(format!("riga {}: token non validi", i + 1)),
        }
    }
    if errors.is_empty() {
        Ok(cases)
    } else {
        Err(errors)
    }
}

fn letter(t: &Token) -> char {
    match t.kind {
        TokenKind::Word | TokenKind::Unknown => 'W',
        TokenKind::Number => 'N',
        TokenKind::Punct => 'P',
        TokenKind::Symbol => 'S',
    }
}

/// Verifica un caso: token, tipi e intervalli UTF-16 (che devono ritagliare esattamente il testo).
pub fn check<D: AsRef<[u8]>>(engine: &Engine<D>, case: &GoldenCase) -> Result<(), String> {
    let tokens = engine.symbolize_text(&case.sentence);
    let got: Vec<(char, String)> = tokens
        .iter()
        .map(|t| (letter(t), t.surface.clone()))
        .collect();
    if got != case.tokens {
        let fmt = |v: &[(char, String)]| {
            v.iter()
                .map(|(k, s)| format!("{k}:{s}"))
                .collect::<Vec<_>>()
                .join(" ")
        };
        return Err(format!(
            "riga {}: {:?}\n  atteso:  {}\n  ottenuto: {}",
            case.line,
            case.sentence,
            fmt(&case.tokens),
            fmt(&got)
        ));
    }
    let units: Vec<u16> = case.sentence.encode_utf16().collect();
    for t in &tokens {
        let (a, b) = (t.span_utf16.0 as usize, t.span_utf16.1 as usize);
        let slice = units.get(a..b).and_then(|u| String::from_utf16(u).ok());
        if slice.as_deref() != Some(t.surface.as_str()) {
            return Err(format!(
                "riga {}: intervallo UTF-16 {a}..{b} non ritaglia {:?}",
                case.line, t.surface
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legge_i_casi() {
        let c = parse("# commento\n\nL'albero.\tW:L' W:albero P:.\n8:30\tN:8:30\n").unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].line, 3);
        assert_eq!(c[0].tokens[2], ('P', ".".to_string()));
        assert_eq!(c[1].tokens, vec![('N', "8:30".to_string())]);
    }

    #[test]
    fn errori_con_riga() {
        let e = parse("senza tab\nfrase\tX:a\nfrase\tW:\n").unwrap_err();
        assert_eq!(e.len(), 3);
        assert!(e[0].starts_with("riga 1:") && e[2].starts_with("riga 3:"));
    }
}
