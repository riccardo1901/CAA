//! File curati letti dal motore (SPEC.md, "Correzioni curate"): `lemma_picto.tsv` e
//! `blocklist.tsv`. Il motore non apre file: riceve il testo, e il docente può modificarli.
//!
//! Colonne (separate da tabulazione; righe vuote e `#` ignorate; l'ultima colonna, la nota, è facoltativa):
//! * `lemma_picto.tsv`: `lemma`, `categoria` (NOUN, VERB…), `id` ARASAAC, `priorità` (intero)
//! * `blocklist.tsv`: `chiave` (forma o lemma), `id` ARASAAC

use std::collections::{HashMap, HashSet};

use crate::norm::normalize_key;
use crate::types::Cat;

#[derive(Debug, Default, Clone)]
pub struct Curated {
    preferred: HashMap<String, Vec<(Cat, u32, i32)>>,
    blocked: HashSet<(String, u32)>,
}

fn rows(text: &str) -> impl Iterator<Item = (usize, Vec<&str>)> {
    text.lines().enumerate().filter_map(|(i, raw)| {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            return None;
        }
        Some((i + 1, line.split('\t').map(str::trim).collect()))
    })
}

impl Curated {
    /// Nessuna preferenza e nessun blocco.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Legge i due file; gli errori riportano file e riga.
    pub fn parse(lemma_picto: &str, blocklist: &str) -> Result<Self, Vec<String>> {
        let mut c = Curated::default();
        let mut errors = Vec::new();
        for (line, f) in rows(lemma_picto) {
            let parsed = (f.len() >= 4).then(|| {
                (
                    Cat::from_name(f[1]),
                    f[2].parse::<u32>(),
                    f[3].parse::<i32>(),
                )
            });
            match parsed {
                Some((Some(cat), Ok(id), Ok(priority))) if !f[0].is_empty() => {
                    c.preferred
                        .entry(normalize_key(f[0]))
                        .or_default()
                        .push((cat, id, priority));
                }
                _ => errors.push(format!("lemma_picto.tsv:{line}: riga non valida")),
            }
        }
        for (line, f) in rows(blocklist) {
            match (f.len() >= 2, f.get(1).and_then(|v| v.parse::<u32>().ok())) {
                (true, Some(id)) if !f[0].is_empty() => {
                    c.blocked.insert((normalize_key(f[0]), id));
                }
                _ => errors.push(format!("blocklist.tsv:{line}: riga non valida")),
            }
        }
        if errors.is_empty() {
            Ok(c)
        } else {
            Err(errors)
        }
    }

    /// Pittogramma preferito per un lemma e una categoria: priorità più alta, a parità id più basso.
    pub fn preferred(&self, lemma: &str, cat: Cat) -> Option<u32> {
        self.preferred
            .get(lemma)?
            .iter()
            .filter(|(c, _, _)| *c == cat)
            .max_by_key(|(_, id, priority)| (*priority, std::cmp::Reverse(*id)))
            .map(|(_, id, _)| *id)
    }

    /// Vero se il pittogramma è bloccato per una delle chiavi (forma o lemma).
    pub fn is_blocked(&self, keys: &[&str], id: u32) -> bool {
        keys.iter()
            .any(|k| self.blocked.contains(&((*k).to_string(), id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legge_preferenze_e_blocchi() {
        let c = Curated::parse(
            "# commento\npesca\tNOUN\t2468\t5\tfrutto\npesca\tNOUN\t11339\t9\n\nPesca\tVERB\t77\t1\n",
            "ape\t10\tinadatto\n",
        )
        .unwrap();
        assert_eq!(c.preferred("pesca", Cat::Noun), Some(11339)); // priorità più alta
        assert_eq!(c.preferred("pesca", Cat::Verb), Some(77));
        assert_eq!(c.preferred("pesca", Cat::Adj), None);
        assert_eq!(c.preferred("zucca", Cat::Noun), None);
        assert!(
            c.is_blocked(&["ape"], 10)
                && !c.is_blocked(&["ape"], 11)
                && !c.is_blocked(&["casa"], 10)
        );
    }

    #[test]
    fn a_parita_di_priorita_vince_l_id_piu_basso() {
        let c = Curated::parse("x\tNOUN\t9\t1\nx\tNOUN\t3\t1\n", "").unwrap();
        assert_eq!(c.preferred("x", Cat::Noun), Some(3));
    }

    #[test]
    fn errori_con_riga() {
        let e = Curated::parse("a\tBOH\t1\t1\n", "solo\n").unwrap_err();
        assert_eq!(
            e,
            vec![
                "lemma_picto.tsv:1: riga non valida",
                "blocklist.tsv:1: riga non valida"
            ]
        );
    }

    #[test]
    fn vuoto() {
        let c = Curated::empty();
        assert_eq!(c.preferred("a", Cat::Noun), None);
        assert!(Curated::parse("", "# solo intestazione\n").is_ok());
    }
}
