//! Rapporto di copertura: quante parole chiave ARASAAC trovano un lemma in Morph-it!.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use caa_engine::lexicon::MorphLexicon;
use caa_engine::norm::is_elided_prefix;
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
    /// …infiniti riflessivi non in Morph-it! ma scomponibili in verbo base + clitico (`lavarsi`).
    /// Contano tra le "trovate": la fase 4 del motore li analizza da sé.
    pub reflexive: usize,
}

#[derive(Debug, Default)]
pub struct Coverage {
    pub by_type: BTreeMap<u8, TypeCoverage>,
    /// Parole chiave distinte con cifre (numeri, orari; anche di più parole): non sono parole del
    /// lessico, escluse dal conto.
    pub with_digits: usize,
    /// Chiavi distinte di una sola parola (senza cifre). Una chiave con due tipi conta una volta.
    pub keys_total: usize,
    /// …di cui trovate (come forma, come lemma o come infinito riflessivo).
    pub keys_found: usize,
    /// Parole chiave di una parola senza forma né lemma: chiave, tipi, primi 5 id.
    pub without_lemma: Vec<(String, BTreeSet<u8>, Vec<u32>)>,
    pub multiword_total: usize,
    pub multiword_known: usize,
    /// Multiparola con almeno una parola sconosciuta: chiave e parole sconosciute.
    pub multiword_unknown: Vec<(String, Vec<String>)>,
}

fn is_infinitive_verb(r: &caa_engine::types::Reading) -> bool {
    matches!(r.cat, Cat::Verb | Cat::Aux | Cat::Modal) && r.feats.mood == Some(Mood::Inf)
}

/// Verbo base di un infinito riflessivo: "abbottonarsi" → "abbottonare" (stessa regola della fase 4).
fn reflexive_base(key: &str) -> Option<String> {
    let stem = key.strip_suffix("rsi").filter(|s| !s.is_empty())?;
    Some(format!("{stem}re"))
}

/// Pezzi di una chiave: parole separate da spazi e, per le elisioni, "dell'acqua" → "dell'" + "acqua".
fn pieces(key: &str) -> Vec<&str> {
    key.split_whitespace()
        .flat_map(|t| t.split_inclusive('\''))
        .collect()
}

pub fn coverage(morph: &MorphLexicon<Vec<u8>>, pictograms: &[Pictogram]) -> Coverage {
    let known = |w: &str| !morph.lookup(w).is_empty() || morph.lemma_id(w).is_some();
    // Una parola di una multiparola è nota anche se è un infinito riflessivo ("stendersi").
    let known_part = |w: &str| {
        known(w)
            || reflexive_base(w).is_some_and(|b| morph.lookup(&b).iter().any(is_infinitive_verb))
    };
    let mut groups: BTreeMap<(String, u8), Vec<u32>> = BTreeMap::new();
    for (key, kind, id) in arasaac::primary_keys(pictograms) {
        groups.entry((key, kind)).or_default().push(id);
    }

    let mut cov = Coverage::default();
    let mut missing: BTreeMap<String, (BTreeSet<u8>, Vec<u32>)> = BTreeMap::new();
    let mut multi_seen: BTreeSet<String> = BTreeSet::new();
    let mut digit_keys: BTreeSet<&str> = BTreeSet::new();
    let mut distinct: BTreeMap<&str, bool> = BTreeMap::new();
    for ((key, kind), ids) in &groups {
        if key.chars().any(|c| c.is_ascii_digit()) {
            digit_keys.insert(key);
            continue;
        }
        let parts = pieces(key);
        if parts.len() > 1 {
            if multi_seen.insert(key.clone()) {
                cov.multiword_total += 1;
                let mut unknown: Vec<String> = Vec::new();
                for piece in parts {
                    let known_piece = if piece.ends_with('\'') {
                        known_part(piece) || is_elided_prefix(piece)
                    } else {
                        let w = piece.trim_matches(|c: char| !c.is_alphanumeric());
                        w.is_empty() || known_part(w)
                    };
                    if !known_piece && !unknown.iter().any(|u| u == piece) {
                        unknown.push(piece.to_string());
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
        let found = !readings.is_empty() || morph.lemma_id(key).is_some();
        let reflexive = !found
            && reflexive_base(key)
                .is_some_and(|base| morph.lookup(&base).iter().any(is_infinitive_verb));
        distinct.insert(key, found || reflexive);
        if reflexive {
            t.found += 1;
            t.reflexive += 1;
            t.verb_infinitive += 1;
        } else if found {
            t.found += 1;
            if readings.iter().any(is_infinitive_verb) {
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
    cov.with_digits = digit_keys.len();
    cov.keys_total = distinct.len();
    cov.keys_found = distinct.values().filter(|ok| **ok).count();
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
    let _ = writeln!(w, "Parole chiave di una sola parola, senza cifre ({} chiavi con cifre, di una o più parole, sono escluse). \"Trovata\" = compare come forma o come lemma, oppure è un infinito riflessivo scomponibile in verbo base + clitico (`lavarsi`). Una chiave con due tipi compare in entrambe le righe; il totale conta le chiavi distinte.\n", cov.with_digits);
    let _ = writeln!(w, "| Tipo | Significato | Chiavi | Trovate | % | Con infinito verbale | di cui riflessivi | Con lettura di nome |");
    let _ = writeln!(w, "| --- | --- | --- | --- | --- | --- | --- | --- |");
    let (tk, tf) = (cov.keys_total, cov.keys_found);
    for (t, c) in &cov.by_type {
        let _ = writeln!(
            w,
            "| {t} | {} | {} | {} | {} | {} | {} | {} |",
            type_name(*t),
            c.keys,
            c.found,
            pct(c.found, c.keys),
            c.verb_infinitive,
            c.reflexive,
            c.noun_reading
        );
    }
    let _ = writeln!(
        w,
        "| | **totale** | {tk} | {tf} | {} | | | |\n",
        pct(tf, tk)
    );
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::{compile, Inputs};

    fn pictograms(json: &str) -> Vec<Pictogram> {
        arasaac::parse(json.as_bytes()).unwrap()
    }

    fn morph(text: &str) -> MorphLexicon<Vec<u8>> {
        let o = compile(&Inputs {
            build_id: 1,
            morphit: text,
            pictograms: &[],
            forms_extra: &[],
        })
        .unwrap();
        MorphLexicon::new(o.morph_fst, o.lemmas_fst, o.morph_feats).unwrap()
    }

    #[test]
    fn riflessivo_con_verbo_base_noto_conta_come_trovato() {
        let m = morph("mangiare\tmangiare\tVER:inf+pres\ndifendere\tdifendere\tVER:inf+pres\ncasa\tcasa\tNOUN-F:s\n");
        let p = pictograms(
            r#"[{"_id":1,"keywords":[{"type":3,"keyword":"mangiarsi"},{"type":3,"keyword":"difendersi"},{"type":3,"keyword":"abbottonarsi"},{"type":3,"keyword":"rsi"}]},
                {"_id":2,"keywords":[{"type":2,"keyword":"casa"},{"type":2,"keyword":"zampogna"}]}]"#,
        );
        let c = coverage(&m, &p);
        let verbs = &c.by_type[&3];
        assert_eq!(
            (
                verbs.keys,
                verbs.found,
                verbs.reflexive,
                verbs.verb_infinitive
            ),
            (4, 2, 2, 2)
        );
        // "abbottonarsi" (base sconosciuta) e "rsi" (nessun tema) restano senza lemma.
        let missing: Vec<&str> = c.without_lemma.iter().map(|(k, _, _)| k.as_str()).collect();
        assert_eq!(missing, vec!["abbottonarsi", "rsi", "zampogna"]);
        assert_eq!(
            (
                c.by_type[&2].keys,
                c.by_type[&2].found,
                c.by_type[&2].reflexive
            ),
            (2, 1, 0)
        );
    }

    #[test]
    fn prefissi_elisi_non_sono_parole_sconosciute() {
        // Regressione: "l'orchestra" non deve produrre le parole sconosciute "l" e "orchestra".
        let m = morph("mangiare\tmangiare\tVER:inf+pres\ndirettore\tdirettore\tNOUN-M:s\norchestra\torchestra\tNOUN-F:s\nacqua\tacqua\tNOUN-F:s\nolio\tolio\tNOUN-M:s\nun\tun\tDET-INDEF:m+s\npo'\tpo'\tADV\n");
        let p = pictograms(
            r#"[{"_id":1,"keywords":[{"keyword":"direttore d'orchestra"},{"keyword":"soffiare sull'acqua"},{"keyword":"un po'"},{"keyword":"sott'olio"},{"keyword":"l'orchestra zampogna"},{"keyword":"mangiarsi qui"}]}]"#,
        );
        let c = coverage(&m, &p);
        assert_eq!(c.multiword_total, 6);
        // "soffiare" non è nel lessico di prova: resta sconosciuta, ma "sull'" no.
        let unknown: std::collections::BTreeMap<&str, Vec<&str>> = c
            .multiword_unknown
            .iter()
            .map(|(k, u)| (k.as_str(), u.iter().map(String::as_str).collect()))
            .collect();
        assert_eq!(unknown.get("soffiare sull'acqua"), Some(&vec!["soffiare"]));
        assert_eq!(unknown.get("sott'olio"), Some(&vec!["sott'"])); // prefisso non in tabella
        assert_eq!(unknown.get("l'orchestra zampogna"), Some(&vec!["zampogna"]));
        // Il riflessivo "mangiarsi" è noto (mangiare + si): resta sconosciuta solo "qui".
        assert_eq!(unknown.get("mangiarsi qui"), Some(&vec!["qui"]));
        assert!(!unknown.contains_key("direttore d'orchestra"));
        assert!(!unknown.contains_key("un po'"));
    }

    #[test]
    fn il_totale_conta_le_chiavi_distinte_anche_se_hanno_due_tipi() {
        // Regressione (revisione M0-M2): una chiave con due tipi era contata due volte nel totale,
        // quindi trovate + senza lemma non faceva il totale.
        let m = morph("casa\tcasa\tNOUN-F:s\n");
        let p = pictograms(
            r#"[{"_id":1,"keywords":[{"type":2,"keyword":"casa"},{"type":4,"keyword":"casa"},{"type":0,"keyword":"zampogna"},{"type":2,"keyword":"zampogna"},{"type":2,"keyword":"mandola"}]}]"#,
        );
        let c = coverage(&m, &p);
        assert_eq!((c.keys_total, c.keys_found), (3, 1));
        assert_eq!(c.keys_total, c.keys_found + c.without_lemma.len());
        // Le righe per tipo contano la chiave in ciascuno dei suoi tipi.
        assert_eq!(c.by_type.values().map(|t| t.keys).sum::<usize>(), 5);
    }

    #[test]
    fn il_verbo_base_deve_essere_un_infinito_verbale() {
        // "pensionare" esiste solo come nome: "pensionarsi" non è riconosciuto.
        let m = morph("pensionare\tpensionare\tNOUN-M:s\n");
        let p = pictograms(r#"[{"_id":1,"keywords":[{"type":3,"keyword":"pensionarsi"}]}]"#);
        assert_eq!(coverage(&m, &p).by_type[&3].found, 0);
    }
}
