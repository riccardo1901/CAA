//! Rapporto di copertura: quante parole chiave ARASAAC trovano un lemma in Morph-it!.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use caa_engine::lexicon::MorphLexicon;
use caa_engine::types::{Cat, Mood};

use crate::arasaac::{self, Pictogram};
use crate::compile::Stats;

#[derive(Debug, Default, Clone)]
pub struct TypeCoverage {
    /// Parole chiave distinte di una sola parola (senza cifre) con questo tipo.
    pub keys: usize,
    /// …che compaiono in Morph-it! come forma o come lemma.
    pub found: usize,
    /// …con una lettura verbale all'infinito (utile per il tipo 3).
    pub verb_infinitive: usize,
    /// …con una lettura di nome (utile per i tipi 1 e 2).
    pub noun_reading: usize,
}

#[derive(Debug, Default)]
pub struct Coverage {
    pub by_type: BTreeMap<u8, TypeCoverage>,
    /// Parole chiave con cifre (numeri, orari): non sono parole del lessico, escluse dal conto.
    pub with_digits: usize,
    /// Parole chiave di una parola senza forma né lemma: chiave, tipi, primi 5 id.
    pub without_lemma: Vec<(String, BTreeSet<u8>, Vec<u32>)>,
    pub multiword_total: usize,
    pub multiword_known: usize,
    /// Multiparola con almeno una parola sconosciuta: chiave e parole sconosciute.
    pub multiword_unknown: Vec<(String, Vec<String>)>,
}

pub fn coverage(morph: &MorphLexicon<Vec<u8>>, pictograms: &[Pictogram]) -> Coverage {
    let known = |w: &str| !morph.lookup(w).is_empty() || morph.lemma_id(w).is_some();
    let mut groups: BTreeMap<(String, u8), Vec<u32>> = BTreeMap::new();
    for (key, kind, id) in arasaac::primary_keys(pictograms) {
        groups.entry((key, kind)).or_default().push(id);
    }

    let mut cov = Coverage::default();
    let mut missing: BTreeMap<String, (BTreeSet<u8>, Vec<u32>)> = BTreeMap::new();
    let mut multi_seen: BTreeSet<String> = BTreeSet::new();
    for ((key, kind), ids) in &groups {
        if key.chars().any(|c| c.is_ascii_digit()) {
            cov.with_digits += 1;
            continue;
        }
        if key.contains(' ') {
            if multi_seen.insert(key.clone()) {
                cov.multiword_total += 1;
                let mut unknown: Vec<String> = Vec::new();
                for w in key.split(|c: char| c.is_whitespace() || c == '\'') {
                    let w = w.trim_matches(|c: char| !c.is_alphanumeric());
                    if !w.is_empty() && !known(w) && !unknown.iter().any(|u| u == w) {
                        unknown.push(w.to_string());
                    }
                }
                if unknown.is_empty() {
                    cov.multiword_known += 1;
                } else {
                    cov.multiword_unknown.push((key.clone(), unknown));
                }
            }
            continue;
        }
        let t = cov.by_type.entry(*kind).or_default();
        t.keys += 1;
        let readings = morph.lookup(key);
        if !readings.is_empty() || morph.lemma_id(key).is_some() {
            t.found += 1;
            if readings.iter().any(|r| {
                matches!(r.cat, Cat::Verb | Cat::Aux | Cat::Modal)
                    && r.feats.mood == Some(Mood::Inf)
            }) {
                t.verb_infinitive += 1;
            }
            if readings
                .iter()
                .any(|r| matches!(r.cat, Cat::Noun | Cat::Propn))
            {
                t.noun_reading += 1;
            }
        } else {
            let m = missing.entry(key.clone()).or_default();
            m.0.insert(*kind);
            m.1.extend(ids.iter().copied().take(5));
            m.1.truncate(5);
        }
    }
    cov.without_lemma = missing
        .into_iter()
        .map(|(k, (t, ids))| (k, t, ids))
        .collect();
    cov
}

/// Immagini collegate e pittogrammi con parole chiave ma senza immagine.
#[derive(Debug, Default)]
pub struct ImageReport {
    pub linked: usize,
    pub missing_for_keyed: Vec<u32>,
}

fn pct(a: usize, b: usize) -> String {
    if b == 0 {
        "–".to_string()
    } else {
        format!("{:.1}%", 100.0 * a as f64 / b as f64)
    }
}

fn type_name(t: u8) -> &'static str {
    match t {
        1 => "nomi propri e luoghi",
        2 => "nomi comuni",
        3 => "verbi",
        4 => "aggettivi, numeri, avverbi",
        5 => "frasi ed esclamazioni",
        6 => "orari, mesi, altro",
        _ => "senza tipo",
    }
}

fn sample<T>(v: &[T], n: usize) -> impl Iterator<Item = &T> {
    let step = (v.len() / n.max(1)).max(1);
    v.iter().step_by(step).take(n)
}

pub fn render_markdown(
    stats: &Stats,
    cov: &Coverage,
    files: &[(String, u64)],
    img: &ImageReport,
) -> String {
    let mut s = String::new();
    let w = &mut s;
    let _ = writeln!(w, "# Rapporto di build del lessico\n");
    let _ = writeln!(w, "## Morph-it!\n");
    let _ = writeln!(w, "- righe lette: {}", stats.rows);
    let rep = &stats.repaired_lines;
    let _ = writeln!(
        w,
        "- righe riparate (separate da spazi invece che da tabulazioni): {}{}",
        rep.len(),
        if rep.is_empty() {
            String::new()
        } else {
            format!(" (righe {rep:?})")
        }
    );
    let _ = writeln!(
        w,
        "- etichette distinte, tutte mappate: {}",
        stats.distinct_labels
    );
    let _ = writeln!(
        w,
        "- righe aggiunte da `forms_extra.tsv`: {}",
        stats.forms_extra
    );
    let _ = writeln!(w, "- forme distinte: {}", stats.forms);
    let _ = writeln!(w, "- lemmi distinti: {}", stats.lemmas);
    let _ = writeln!(
        w,
        "- letture (forma, lemma, tratti) distinte: {}\n",
        stats.readings
    );
    let _ = writeln!(w, "## ARASAAC\n");
    let _ = writeln!(w, "- pittogrammi: {}", stats.pictograms);
    let _ = writeln!(
        w,
        "- pittogrammi senza parola chiave italiana: {}",
        stats.pictograms_without_keys
    );
    let _ = writeln!(
        w,
        "- chiavi distinte nell'indice (con i plurali derivati): {}",
        stats.picto_keys
    );
    let _ = writeln!(
        w,
        "- voci dell'indice (chiave, pittogramma): {}",
        stats.picto_records
    );
    let _ = writeln!(w, "- immagini WebP collegate: {}", img.linked);
    let _ = writeln!(
        w,
        "- pittogrammi con parole chiave ma senza immagine: {}{}\n",
        img.missing_for_keyed.len(),
        if img.missing_for_keyed.is_empty() {
            String::new()
        } else {
            format!(
                " (primi id: {:?})",
                &img.missing_for_keyed[..img.missing_for_keyed.len().min(10)]
            )
        }
    );

    let _ = writeln!(
        w,
        "## Copertura: parole chiave ARASAAC con un lemma in Morph-it!\n"
    );
    let _ = writeln!(w, "Parole chiave di una sola parola, distinte, senza cifre ({} chiavi con cifre escluse). \"Trovata\" = compare come forma o come lemma.\n", cov.with_digits);
    let _ = writeln!(w, "| Tipo | Significato | Chiavi | Trovate | % | Con infinito verbale | Con lettura di nome |");
    let _ = writeln!(w, "| --- | --- | --- | --- | --- | --- | --- |");
    let (mut tk, mut tf) = (0, 0);
    for (t, c) in &cov.by_type {
        tk += c.keys;
        tf += c.found;
        let _ = writeln!(
            w,
            "| {t} | {} | {} | {} | {} | {} | {} |",
            type_name(*t),
            c.keys,
            c.found,
            pct(c.found, c.keys),
            c.verb_infinitive,
            c.noun_reading
        );
    }
    let _ = writeln!(w, "| | **totale** | {tk} | {tf} | {} | | |\n", pct(tf, tk));
    let _ = writeln!(w, "Chiavi senza lemma: **{}** (elenco completo in `report/keys_without_lemma.tsv`). Esempi:\n", cov.without_lemma.len());
    let ex: Vec<String> = sample(&cov.without_lemma, 40)
        .map(|(k, _, _)| k.clone())
        .collect();
    let _ = writeln!(w, "{}\n", ex.join(" · "));
    let _ = writeln!(w, "## Multiparola\n");
    let _ = writeln!(
        w,
        "- chiavi multiparola distinte (senza cifre): {}",
        cov.multiword_total
    );
    let _ = writeln!(
        w,
        "- con tutte le parole note a Morph-it!: {} ({})",
        cov.multiword_known,
        pct(cov.multiword_known, cov.multiword_total)
    );
    let _ = writeln!(w, "- con almeno una parola sconosciuta: {} (elenco in `report/multiword_unknown_words.tsv`)\n", cov.multiword_unknown.len());
    let _ = writeln!(w, "## File prodotti\n");
    for (name, bytes) in files {
        let _ = writeln!(w, "- `{name}`: {bytes} byte");
    }
    s
}

pub fn keys_without_lemma_tsv(cov: &Coverage) -> String {
    let mut s = String::from("chiave\ttipi\tid_pittogrammi\n");
    for (key, types, ids) in &cov.without_lemma {
        let t: Vec<String> = types.iter().map(u8::to_string).collect();
        let i: Vec<String> = ids.iter().map(u32::to_string).collect();
        let _ = writeln!(s, "{key}\t{}\t{}", t.join(","), i.join(","));
    }
    s
}

pub fn multiword_unknown_tsv(cov: &Coverage) -> String {
    let mut s = String::from("chiave\tparole_sconosciute\n");
    for (key, unknown) in &cov.multiword_unknown {
        let _ = writeln!(s, "{key}\t{}", unknown.join(","));
    }
    s
}
