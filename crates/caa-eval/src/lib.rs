//! Misure sul motore (SPEC.md, "Metriche (`caa-eval`)"). In M4 sono tre: i test dorati di
//! tokenizzazione, la copertura delle parole di base (parole piene con almeno un pittogramma) e la
//! velocità. Le metriche sul corpus (correzioni per 100 parole, accuratezza…) arrivano in M7.

use std::collections::BTreeMap;
use std::time::Instant;

use caa_engine::engine::{Engine, PictoReason, ReadingSource};
use caa_engine::golden;
use caa_engine::tokenize::TokenKind;
use caa_engine::treebank::Sentence;
use caa_engine::types::Cat;
use caa_engine::viterbi::Weights;

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

/// Esito dei test dorati di analisi (categoria e lemma).
pub fn run_analysis<D: AsRef<[u8]>>(
    engine: &Engine<D>,
    text: &str,
) -> Result<GoldenReport, Vec<String>> {
    let cases = golden::parse_analysis(text)?;
    let failures = cases
        .iter()
        .filter_map(|c| golden::check_analysis(engine, c).err())
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

/// Misura del motore contro un treebank: scelta della categoria e del lemma (M5). Il treebank fa da
/// corpus finché non c'è quello scolastico (M7).
#[derive(Debug, Default)]
pub struct TaggerReport {
    pub sentences: usize,
    pub ud_tokens: usize,
    /// Token del treebank trovati nel testo e con lo stesso intervallo del motore.
    pub aligned: usize,
    /// Token valutati: allineati, con categoria nota e non punteggiatura.
    pub evaluated: usize,
    /// …per cui tra le letture del motore c'è quella giusta (limite superiore dell'accuratezza).
    pub gold_available: usize,
    pub correct_cat: usize,
    pub correct_lemma: usize,
    /// Token con almeno due categorie diverse tra le letture, e quanti scelti bene.
    pub ambiguous: usize,
    pub ambiguous_correct: usize,
    pub errors: usize,
    /// Errori con confidenza sotto 0,6 (sarebbero sottolineati).
    pub errors_flagged: usize,
    /// Token giusti con confidenza sotto 0,6 (sottolineature inutili).
    pub correct_flagged: usize,
    /// Categorie sbagliate più frequenti: (attesa, scelta) → quante.
    pub confusions: BTreeMap<(String, String), usize>,
    /// Per ogni confusione, le forme sbagliate più frequenti.
    pub error_forms: BTreeMap<(String, String), BTreeMap<String, usize>>,
}

pub fn evaluate_tagger<D: AsRef<[u8]>>(engine: &Engine<D>, sentences: &[Sentence]) -> TaggerReport {
    let mut r = TaggerReport {
        sentences: sentences.len(),
        ..TaggerReport::default()
    };
    for s in sentences {
        let tokens = engine.symbolize_text(&s.text);
        let by_span: BTreeMap<(u32, u32), usize> = tokens
            .iter()
            .enumerate()
            .map(|(i, t)| (t.span_utf16, i))
            .collect();
        let mut cursor = 0usize;
        for u in &s.tokens {
            r.ud_tokens += 1;
            let Some(rel) = s.text[cursor..].find(&u.form) else {
                continue;
            };
            let start = cursor + rel;
            cursor = start + u.form.len();
            let a = s.text[..start].encode_utf16().count() as u32;
            let b = a + u.form.encode_utf16().count() as u32;
            let Some(&i) = by_span.get(&(a, b)) else {
                continue;
            };
            r.aligned += 1;
            let (Some(gold), t) = (u.cat, &tokens[i]) else {
                continue;
            };
            if gold == Cat::Punct {
                continue;
            }
            r.evaluated += 1;
            let chosen = t.analysis.as_ref();
            let cats: std::collections::BTreeSet<Cat> = t.readings.iter().map(|x| x.cat).collect();
            let ok = chosen.is_some_and(|c| c.cat == gold);
            if cats.contains(&gold) {
                r.gold_available += 1;
            }
            if cats.len() >= 2 {
                r.ambiguous += 1;
                if ok {
                    r.ambiguous_correct += 1;
                }
            }
            let flagged = t.confidence < 0.6;
            if ok {
                r.correct_cat += 1;
                if chosen.is_some_and(|c| c.lemma.to_lowercase() == u.lemma) {
                    r.correct_lemma += 1;
                }
                if flagged {
                    r.correct_flagged += 1;
                }
            } else {
                r.errors += 1;
                if flagged {
                    r.errors_flagged += 1;
                }
                let got = chosen.map_or("—".to_string(), |c| c.cat.name().to_string());
                let key = (gold.name().to_string(), got);
                *r.error_forms
                    .entry(key.clone())
                    .or_default()
                    .entry(u.form.to_lowercase())
                    .or_default() += 1;
                *r.confusions.entry(key).or_default() += 1;
            }
        }
    }
    r
}

/// Un parametro dei pesi: nome, lettura, scrittura e valori da provare.
type Knob = (
    &'static str,
    fn(&Weights) -> f32,
    fn(&mut Weights, f32),
    &'static [f32],
);

/// Quante categorie giuste sul treebank vale un caso dorato superato.
pub const GOLDEN_WEIGHT: usize = 30;

const KNOBS: &[Knob] = &[
    (
        "prior",
        |w| w.prior,
        |w, v| w.prior = v,
        &[0.5, 0.75, 1.0, 1.5, 2.0],
    ),
    (
        "trans",
        |w| w.trans,
        |w, v| w.trans = v,
        &[0.5, 0.75, 1.0, 1.5, 2.0],
    ),
    (
        "agree",
        |w| w.agree,
        |w, v| w.agree = v,
        &[0.0, 0.5, 1.0, 1.5, 2.0],
    ),
    (
        "disagree",
        |w| w.disagree,
        |w, v| w.disagree = v,
        &[0.0, -1.0, -2.0, -3.0, -4.0],
    ),
    (
        "subject",
        |w| w.subject,
        |w, v| w.subject = v,
        &[0.0, 0.75, 1.5, 2.5, 3.5],
    ),
    ("non", |w| w.non, |w, v| w.non = v, &[0.0, 0.5, 1.0, 2.0]),
    (
        "prep_inf",
        |w| w.prep_inf,
        |w, v| w.prep_inf = v,
        &[0.0, 0.5, 1.0, 1.5],
    ),
    (
        "modal_inf",
        |w| w.modal_inf,
        |w, v| w.modal_inf = v,
        &[0.0, 0.75, 1.5, 2.5, 3.5],
    ),
    (
        "capital",
        |w| w.capital,
        |w, v| w.capital = v,
        &[0.0, 1.0, 2.0, 3.0, 4.0],
    ),
];

/// Taratura per discesa coordinata per coordinata: ogni peso prova i suoi valori, resta il
/// migliore (a parità, quello attuale); si ripete finché non cambia nulla (al massimo 4 giri).
/// Obiettivo: categorie giuste sul treebank di sviluppo più `GOLDEN_WEIGHT` per ogni caso dorato
/// di analisi superato (i dorati sono la specifica; il treebank, di giornali e leggi, non contiene
/// molti dei casi da scuola dell'infanzia). Restituisce i pesi e il registro dei passi.
pub fn tune<D: AsRef<[u8]>>(
    engine: &mut Engine<D>,
    sentences: &[Sentence],
    cases: &[golden::AnalysisCase],
) -> (Weights, Vec<String>) {
    let mut log = Vec::new();
    let mut w = *engine.weights();
    let score = |engine: &mut Engine<D>, w: &Weights| {
        engine.set_weights(*w);
        let passed = cases
            .iter()
            .filter(|c| golden::check_analysis(engine, c).is_ok())
            .count();
        evaluate_tagger(engine, sentences).correct_cat + GOLDEN_WEIGHT * passed
    };
    let mut best = score(engine, &w);
    log.push(format!("partenza: {best} categorie giuste"));
    for round in 1..=4 {
        let mut changed = false;
        for (name, get, set, values) in KNOBS {
            let current = get(&w);
            for &v in *values {
                if (v - current).abs() < f32::EPSILON {
                    continue;
                }
                let mut trial = w;
                set(&mut trial, v);
                let s = score(engine, &trial);
                if s > best {
                    best = s;
                    w = trial;
                    changed = true;
                    log.push(format!("giro {round}: {name} = {v} → {best}"));
                }
            }
        }
        if !changed {
            break;
        }
    }
    engine.set_weights(w);
    (w, log)
}

/// Quota massima di parole giuste sottolineate (in una frase di 20 parole, una sola sottolineatura).
pub const MAX_CORRECT_FLAGGED: f32 = 0.05;

/// Calibrazione della temperatura: per ogni valore, errori e parole giuste sottolineate.
/// Restituisce il valore che sottolinea più errori restando entro `MAX_CORRECT_FLAGGED` di parole
/// giuste sottolineate (la sottolineatura costa un controllo al docente: troppe e non le guarda più).
pub fn calibrate<D: AsRef<[u8]>>(
    engine: &mut Engine<D>,
    sentences: &[Sentence],
    temperatures: &[f32],
) -> (f32, Vec<String>) {
    let mut log = Vec::new();
    let mut best = (f32::MIN, temperatures.first().copied().unwrap_or(1.0));
    for &t in temperatures {
        let mut w = *engine.weights();
        w.temperature = t;
        engine.set_weights(w);
        let r = evaluate_tagger(engine, sentences);
        let within = (r.correct_flagged as f32) <= MAX_CORRECT_FLAGGED * r.correct_cat as f32;
        let value = if within {
            r.errors_flagged as f32
        } else {
            f32::MIN / 2.0
        };
        log.push(format!(
            "T = {t}: errori sottolineati {}/{} ({:.1}%), parole giuste sottolineate {}/{} ({:.1}%)",
            r.errors_flagged,
            r.errors,
            100.0 * r.errors_flagged as f32 / r.errors.max(1) as f32,
            r.correct_flagged,
            r.correct_cat,
            100.0 * r.correct_flagged as f32 / r.correct_cat.max(1) as f32,
        ));
        if value > best.0 {
            best = (value, t);
        }
    }
    let mut w = *engine.weights();
    w.temperature = best.1;
    engine.set_weights(w);
    (best.1, log)
}

/// Ablazione: quante categorie giuste si perdono azzerando, uno alla volta, i pesi delle regole.
pub fn ablate<D: AsRef<[u8]>>(engine: &mut Engine<D>, sentences: &[Sentence]) -> Vec<String> {
    let base = *engine.weights();
    engine.set_weights(base);
    let reference = evaluate_tagger(engine, sentences).correct_cat as i64;
    let mut out = vec![format!("con tutte le regole: {reference} categorie giuste")];
    for (name, _, set, _) in KNOBS
        .iter()
        .filter(|k| !matches!(k.0, "prior" | "trans" | "unigram"))
    {
        let mut w = base;
        set(&mut w, 0.0);
        engine.set_weights(w);
        let n = evaluate_tagger(engine, sentences).correct_cat as i64;
        out.push(format!("senza {name}: {n} ({:+})", n - reference));
    }
    engine.set_weights(base);
    out
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
