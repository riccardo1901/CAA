//! Test dorati di tokenizzazione (SPEC.md, "Due livelli di test"): frasi con i token attesi,
//! lette da un file di testo e verificate sul motore. Lo stesso file serve ai test in CI (con un
//! mini-lessico), a `caa-eval` e ai test sui dati veri.
//!
//! Formato: una riga per caso, `frase<TAB>token…`, con i token separati da spazio nella forma
//! `K:testo` (K = W parola, N numero, P punteggiatura, S simbolo). Una parola che l'analisi non sa
//! leggere conta come W. Righe vuote e righe che iniziano con `#` sono ignorate.

use crate::engine::{Engine, Token};
use crate::tokenize::TokenKind;
use crate::types::Cat;

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

// ---------------------------------------------------------------------------------------
// Test dorati di analisi (M5): categoria e lemma scelti per alcune parole di una frase
// ---------------------------------------------------------------------------------------

/// Una parola della frase con la lettura attesa.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expect {
    /// Forma come scritta nel testo (senza distinzione fra maiuscole e minuscole).
    pub surface: String,
    /// Quale occorrenza della forma (1 = la prima).
    pub nth: usize,
    /// Categorie accettate (più di una solo dove la distinzione è rimandata a M6, es. `VERB|AUX`).
    pub cats: Vec<Cat>,
    pub lemma: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AnalysisCase {
    pub line: usize,
    pub sentence: String,
    pub expects: Vec<Expect>,
}

/// Legge `analisi.tsv`: `frase<TAB>parola=CAT[|CAT][/lemma] …`; `parola#2` indica la seconda
/// occorrenza. Righe vuote e righe che iniziano con `#` sono ignorate.
pub fn parse_analysis(text: &str) -> Result<Vec<AnalysisCase>, Vec<String>> {
    let mut cases = Vec::new();
    let mut errors = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let n = i + 1;
        let Some((sentence, rest)) = line.split_once('\t') else {
            errors.push(format!("riga {n}: manca la tabulazione"));
            continue;
        };
        let mut expects = Vec::new();
        for item in rest.split_whitespace() {
            let Some((word, spec)) = item.split_once('=') else {
                errors.push(format!("riga {n}: {item:?} non ha la forma parola=CAT"));
                continue;
            };
            let (surface, nth) = match word.split_once('#') {
                Some((w, k)) => match k.parse::<usize>() {
                    Ok(k) if k >= 1 => (w, k),
                    _ => {
                        errors.push(format!("riga {n}: occorrenza non valida in {item:?}"));
                        continue;
                    }
                },
                None => (word, 1),
            };
            let (cats_s, lemma) = match spec.split_once('/') {
                Some((c, l)) => (c, Some(l.to_string())),
                None => (spec, None),
            };
            let cats: Option<Vec<Cat>> = cats_s.split('|').map(Cat::from_name).collect();
            match cats {
                Some(cats) if !cats.is_empty() => expects.push(Expect {
                    surface: surface.to_string(),
                    nth,
                    cats,
                    lemma,
                }),
                _ => errors.push(format!("riga {n}: categoria sconosciuta in {item:?}")),
            }
        }
        if expects.is_empty() {
            errors.push(format!("riga {n}: nessuna lettura attesa"));
            continue;
        }
        cases.push(AnalysisCase {
            line: n,
            sentence: sentence.to_string(),
            expects,
        });
    }
    if errors.is_empty() {
        Ok(cases)
    } else {
        Err(errors)
    }
}

/// Verifica un caso di analisi; l'errore elenca tutte le parole sbagliate.
pub fn check_analysis<D: AsRef<[u8]>>(
    engine: &Engine<D>,
    case: &AnalysisCase,
) -> Result<(), String> {
    let tokens = engine.symbolize_text(&case.sentence);
    let mut problems = Vec::new();
    for e in &case.expects {
        let found = tokens
            .iter()
            .filter(|t| t.surface.to_lowercase() == e.surface.to_lowercase())
            .nth(e.nth - 1);
        let Some(a) = found.and_then(|t| t.analysis.as_ref()) else {
            problems.push(format!(
                "{}#{}: parola non trovata o senza lettura",
                e.surface, e.nth
            ));
            continue;
        };
        let cat_ok = e.cats.contains(&a.cat);
        let lemma_ok = e
            .lemma
            .as_ref()
            .is_none_or(|l| a.lemma.to_lowercase() == l.to_lowercase());
        if !cat_ok || !lemma_ok {
            let want: Vec<&str> = e.cats.iter().map(|c| c.name()).collect();
            problems.push(format!(
                "{}#{}: atteso {}{}, ottenuto {}/{}",
                e.surface,
                e.nth,
                want.join("|"),
                e.lemma.as_ref().map_or(String::new(), |l| format!("/{l}")),
                a.cat.name(),
                a.lemma
            ));
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "riga {}: {:?}\n  {}",
            case.line,
            case.sentence,
            problems.join("\n  ")
        ))
    }
}

// ---------------------------------------------------------------------------------------
// Test dorati di struttura (M6): per ogni parola, cosa viene mostrato
// ---------------------------------------------------------------------------------------

/// Cosa ci si aspetta di una parola della frase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructItem {
    /// `~`: la parola è nascosta (ausiliare, clitico, membro di un'espressione).
    pub hidden: bool,
    pub lemma: Option<String>,
    /// Segni attesi (bit di [`crate::engine::Modifiers`]).
    pub modifiers: u8,
    /// Parola chiave ARASAAC del pittogramma (con `_` al posto degli spazi).
    pub picto_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StructureCase {
    pub line: usize,
    pub sentence: String,
    pub items: Vec<StructItem>,
}

/// Legge `strutture.tsv`: `frase<TAB>elemento …`, un elemento per parola (la punteggiatura non
/// conta). Elemento: `~` (nascosta) oppure `lemma[+PLURALE][+PASSATO][+FUTURO][=chiave_arasaac]`.
pub fn parse_structures(text: &str) -> Result<Vec<StructureCase>, Vec<String>> {
    let mut cases = Vec::new();
    let mut errors = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let n = i + 1;
        let Some((sentence, rest)) = line.split_once('\t') else {
            errors.push(format!("riga {n}: manca la tabulazione"));
            continue;
        };
        let mut items = Vec::new();
        for raw_item in rest.split_whitespace() {
            if raw_item == "~" {
                items.push(StructItem {
                    hidden: true,
                    lemma: None,
                    modifiers: 0,
                    picto_key: None,
                });
                continue;
            }
            let (head, picto_key) = match raw_item.split_once('=') {
                Some((h, k)) => (h, Some(k.replace('_', " "))),
                None => (raw_item, None),
            };
            let mut parts = head.split('+');
            let lemma = parts.next().unwrap_or("").to_string();
            let mut modifiers = 0u8;
            for m in parts {
                match m {
                    "PLURALE" => modifiers |= crate::engine::Modifiers::PLURAL,
                    "PASSATO" => modifiers |= crate::engine::Modifiers::PAST,
                    "FUTURO" => modifiers |= crate::engine::Modifiers::FUTURE,
                    other => errors.push(format!("riga {n}: segno sconosciuto {other:?}")),
                }
            }
            if lemma.is_empty() {
                errors.push(format!("riga {n}: elemento senza lemma: {raw_item:?}"));
                continue;
            }
            items.push(StructItem {
                hidden: false,
                lemma: Some(lemma),
                modifiers,
                picto_key,
            });
        }
        if items.is_empty() {
            errors.push(format!("riga {n}: nessun elemento"));
            continue;
        }
        cases.push(StructureCase {
            line: n,
            sentence: sentence.to_string(),
            items,
        });
    }
    if errors.is_empty() {
        Ok(cases)
    } else {
        Err(errors)
    }
}

/// Verifica un caso di struttura; l'errore mostra cosa ha deciso il motore per ogni parola.
pub fn check_structure<D: AsRef<[u8]>>(
    engine: &Engine<D>,
    case: &StructureCase,
) -> Result<(), String> {
    use crate::engine::{Display, Modifiers};
    let tokens = engine.symbolize_text(&case.sentence);
    let words: Vec<&Token> = tokens
        .iter()
        .filter(|t| {
            matches!(
                t.kind,
                TokenKind::Word | TokenKind::Unknown | TokenKind::Number
            )
        })
        .collect();
    let describe = |t: &Token| {
        let lemma = t
            .analysis
            .as_ref()
            .map_or("?".to_string(), |a| a.lemma.to_lowercase());
        let mut mods = String::new();
        for (flag, name) in [
            (Modifiers::PLURAL, "+PLURALE"),
            (Modifiers::PAST, "+PASSATO"),
            (Modifiers::FUTURE, "+FUTURO"),
        ] {
            if t.modifiers.contains(flag) {
                mods += name;
            }
        }
        let picto = t.picto.map_or(String::new(), |p| format!("#{}", p.id));
        if t.display == Display::Hidden {
            "~".to_string()
        } else {
            format!("{lemma}{mods}{picto}")
        }
    };
    let got: Vec<String> = words.iter().map(|t| describe(t)).collect();
    let mut problems = Vec::new();
    if words.len() != case.items.len() {
        problems.push(format!(
            "{} parole attese, {} trovate",
            case.items.len(),
            words.len()
        ));
    }
    for (w, e) in words.iter().zip(&case.items) {
        let hidden = w.display == Display::Hidden;
        if hidden != e.hidden {
            problems.push(format!(
                "{}: atteso {}, ottenuto {}",
                w.surface,
                if e.hidden { "nascosta" } else { "visibile" },
                if hidden { "nascosta" } else { "visibile" }
            ));
            continue;
        }
        if e.hidden {
            continue;
        }
        let lemma = w.analysis.as_ref().map(|a| a.lemma.to_lowercase());
        if e.lemma.as_deref() != lemma.as_deref() {
            problems.push(format!(
                "{}: lemma atteso {:?}, ottenuto {:?}",
                w.surface, e.lemma, lemma
            ));
        }
        if w.modifiers.0 != e.modifiers {
            problems.push(format!(
                "{}: segni attesi {}, ottenuti {}",
                w.surface, e.modifiers, w.modifiers.0
            ));
        }
        if let Some(key) = &e.picto_key {
            let ok = w.picto.is_some_and(|p| {
                engine
                    .picto_index()
                    .lookup(&crate::norm::normalize_key(key))
                    .iter()
                    .any(|x| x.id == p.id)
            });
            if !ok {
                problems.push(format!(
                    "{}: il pittogramma {:?} non e' di {key:?}",
                    w.surface,
                    w.picto.map(|p| p.id)
                ));
            }
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "riga {}: {:?}\n  ottenuto: {}\n  {}",
            case.line,
            case.sentence,
            got.join(" "),
            problems.join("\n  ")
        ))
    }
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

    #[test]
    fn legge_i_casi_di_analisi() {
        let c =
            parse_analysis("# x\n\nLei la porta.\tla=CLITIC porta=VERB/portare ho#2=VERB|AUX\n")
                .unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].line, 3);
        let e = &c[0].expects;
        assert_eq!(
            (e[0].surface.as_str(), e[0].nth, e[0].cats.clone()),
            ("la", 1, vec![Cat::Clitic])
        );
        assert_eq!(e[1].lemma.as_deref(), Some("portare"));
        assert_eq!(
            (e[2].nth, e[2].cats.clone()),
            (2, vec![Cat::Verb, Cat::Aux])
        );
        for bad in ["a\tx", "a\tx=NONE", "a\tx#0=NOUN", "solo testo", "a\t"] {
            assert!(parse_analysis(bad).is_err(), "{bad:?}");
        }
    }
}
