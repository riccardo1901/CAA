//! Misure sul motore (SPEC.md, "Metriche (`caa-eval`)"). In M4 sono tre: i test dorati di
//! tokenizzazione, la copertura delle parole di base (parole piene con almeno un pittogramma) e la
//! velocità. Le metriche sul corpus (correzioni per 100 parole, accuratezza…) arrivano in M7.

use std::collections::BTreeMap;
use std::time::Instant;

use caa_engine::engine::{Engine, PictoReason, ReadingSource};
use caa_engine::golden;
use caa_engine::tokenize::TokenKind;

/// Esito dei test dorati.
pub struct GoldenReport {
    pub total: usize,
    pub failures: Vec<String>,
}

pub fn run_golden<D: AsRef<[u8]>>(
    engine: &Engine<D>,
    text: &str,
) -> Result<GoldenReport, Vec<String>> {
    let cases = golden::parse(text)?;
    let failures = cases
        .iter()
        .filter_map(|c| golden::check(engine, c).err())
        .collect();
    Ok(GoldenReport {
        total: cases.len(),
        failures,
    })
}

/// Una parola di base: forma (lemma) e categoria indicativa.
#[derive(Debug, Clone)]
pub struct BaseWord {
    pub word: String,
    pub cat: String,
}

/// Legge `lessico_base.tsv`: `parola<TAB>categoria`; righe vuote e `#` ignorate.
pub fn parse_base(text: &str) -> Result<Vec<BaseWord>, Vec<String>> {
    let mut out = Vec::new();
    let mut errors = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        match line.split_once('\t') {
            Some((w, c)) if !w.trim().is_empty() && !c.trim().is_empty() => {
                out.push(BaseWord {
                    word: w.trim().to_string(),
                    cat: c.trim().to_string(),
                });
            }
            _ => errors.push(format!(
                "riga {}: servono parola e categoria separate da tabulazione",
                i + 1
            )),
        }
    }
    if errors.is_empty() {
        Ok(out)
    } else {
        Err(errors)
    }
}

#[derive(Debug, Default)]
pub struct CoverageReport {
    pub total: usize,
    pub with_picto: usize,
    /// Per categoria: (parole, con pittogramma).
    pub by_cat: BTreeMap<String, (usize, usize)>,
    /// Parole senza pittogramma, con la categoria.
    pub missing: Vec<(String, String)>,
    /// Quante parole sono risolte dalla lettura da chiave ARASAAC (SPEC.md, fase 3, punto 2).
    pub from_arasaac_key: usize,
    /// Pittogrammi trovati ignorando la categoria (meno affidabili).
    pub ignoring_category: usize,
    /// Parole che nell'editor sarebbero sottolineate (confidenza sotto 0,6).
    pub underlined: usize,
    pub by_reason: BTreeMap<String, usize>,
}

/// Copertura: ogni parola di base, scritta da sola, deve avere un pittogramma.
pub fn coverage<D: AsRef<[u8]>>(engine: &Engine<D>, words: &[BaseWord]) -> CoverageReport {
    let mut r = CoverageReport::default();
    for w in words {
        let tokens = engine.symbolize_text(&w.word);
        let Some(t) = tokens
            .iter()
            .find(|t| matches!(t.kind, TokenKind::Word | TokenKind::Unknown))
        else {
            continue;
        };
        r.total += 1;
        let entry = r.by_cat.entry(w.cat.clone()).or_default();
        entry.0 += 1;
        if t.picto.is_some() {
            entry.1 += 1;
            r.with_picto += 1;
        } else {
            r.missing.push((w.word.clone(), w.cat.clone()));
        }
        if t.analysis
            .as_ref()
            .is_some_and(|a| a.source == ReadingSource::ArasaacKey)
        {
            r.from_arasaac_key += 1;
        }
        if t.reason.picto == PictoReason::IgnoringCategory {
            r.ignoring_category += 1;
        }
        if t.confidence < 0.6 {
            r.underlined += 1;
        }
        *r.by_reason
            .entry(t.reason.picto_label().to_string())
            .or_default() += 1;
    }
    r
}

/// Tempi di simbolizzazione di un paragrafo, in millisecondi.
pub struct SpeedReport {
    pub words: usize,
    pub runs: usize,
    pub median_ms: f64,
    pub max_ms: f64,
}

pub fn speed<D: AsRef<[u8]>>(engine: &Engine<D>, paragraph: &str, runs: usize) -> SpeedReport {
    let words = engine
        .symbolize_text(paragraph)
        .iter()
        .filter(|t| t.kind != TokenKind::Punct)
        .count();
    let mut times: Vec<f64> = (0..runs.max(1))
        .map(|_| {
            let t0 = Instant::now();
            let n = engine.symbolize_text(paragraph).len();
            std::hint::black_box(n);
            t0.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    times.sort_by(f64::total_cmp);
    SpeedReport {
        words,
        runs: times.len(),
        median_ms: times[times.len() / 2],
        max_ms: times[times.len() - 1],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legge_il_lessico_di_base() {
        let b = parse_base("# commento\n\ncasa\tNOUN\nmangiare\tVERB\n").unwrap();
        assert_eq!(b.len(), 2);
        assert_eq!((b[0].word.as_str(), b[0].cat.as_str()), ("casa", "NOUN"));
        assert!(parse_base("solo\n").is_err());
    }
}
