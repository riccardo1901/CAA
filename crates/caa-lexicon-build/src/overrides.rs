//! File TSV curati (`lexicon/overrides/*.tsv`): lettura e controlli di validità.
//!
//! Righe vuote e righe che iniziano con `#` sono ignorate. L'ultima colonna (`nota`) è facoltativa.
//!
//! | File | Colonne |
//! | --- | --- |
//! | `forms_extra.tsv` | `forma`, `lemma`, `tratti` (etichetta Morph-it!), `nota` |
//! | `lemma_picto.tsv` | `lemma`, `categoria` (NOUN, VERB…), `id` ARASAAC, `priorità` (intero), `nota` |
//! | `mwe_extra.tsv` | `espressione`, `id` ARASAAC, `nota` |
//! | `function_words.tsv` | `forma_o_lemma`, `categoria`, `comportamento` (simbolo, nessuno, ridotto), `nota` |
//! | `blocklist.tsv` | `chiave`, `id` ARASAAC, `nota` |

use std::collections::HashSet;

use caa_engine::types::Cat;

use crate::labels::parse_label;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormExtra {
    pub line: usize,
    pub form: String,
    pub lemma: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LemmaPicto {
    pub line: usize,
    pub lemma: String,
    pub cat: Cat,
    pub id: u32,
    pub priority: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdEntry {
    pub line: usize,
    pub key: String,
    pub id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Behavior {
    Symbol,
    None,
    Reduced,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionWord {
    pub line: usize,
    pub key: String,
    pub cat: Cat,
    pub behavior: Behavior,
}

/// Testi grezzi dei cinque file (vuoti se il file non esiste).
#[derive(Debug, Default)]
pub struct OverrideTexts {
    pub forms_extra: String,
    pub lemma_picto: String,
    pub mwe_extra: String,
    pub function_words: String,
    pub blocklist: String,
}

#[derive(Debug, Default)]
pub struct Overrides {
    pub forms_extra: Vec<FormExtra>,
    pub lemma_picto: Vec<LemmaPicto>,
    pub mwe_extra: Vec<IdEntry>,
    pub function_words: Vec<FunctionWord>,
    pub blocklist: Vec<IdEntry>,
}

/// Righe dati di un TSV: (numero di riga, colonne senza la nota finale).
fn rows<'a>(
    file: &str,
    text: &'a str,
    cols: usize,
    errors: &mut Vec<String>,
) -> Vec<(usize, Vec<&'a str>)> {
    let mut out = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').map(str::trim).collect();
        if fields.len() < cols
            || fields.len() > cols + 1
            || fields[..cols].iter().any(|f| f.is_empty())
        {
            errors.push(format!(
                "{file}:{}: servono {cols} colonne (più la nota facoltativa), trovate {}",
                i + 1,
                fields.len()
            ));
            continue;
        }
        out.push((i + 1, fields[..cols].to_vec()));
    }
    out
}

impl Overrides {
    pub fn parse(t: &OverrideTexts) -> Result<Overrides, Vec<String>> {
        let mut errors = Vec::new();
        let mut o = Overrides::default();

        for (line, f) in rows("forms_extra.tsv", &t.forms_extra, 3, &mut errors) {
            if parse_label(f[2]).is_err() {
                errors.push(format!(
                    "forms_extra.tsv:{line}: etichetta dei tratti sconosciuta: {}",
                    f[2]
                ));
                continue;
            }
            o.forms_extra.push(FormExtra {
                line,
                form: f[0].into(),
                lemma: f[1].into(),
                label: f[2].into(),
            });
        }
        for (line, f) in rows("lemma_picto.tsv", &t.lemma_picto, 4, &mut errors) {
            match (
                Cat::from_name(f[1]),
                f[2].parse::<u32>(),
                f[3].parse::<i32>(),
            ) {
                (Some(cat), Ok(id), Ok(priority)) => o.lemma_picto.push(LemmaPicto {
                    line,
                    lemma: f[0].into(),
                    cat,
                    id,
                    priority,
                }),
                _ => errors.push(format!(
                    "lemma_picto.tsv:{line}: categoria, id o priorità non validi"
                )),
            }
        }
        for (line, f) in rows("mwe_extra.tsv", &t.mwe_extra, 2, &mut errors) {
            match f[1].parse::<u32>() {
                Ok(id) => o.mwe_extra.push(IdEntry {
                    line,
                    key: f[0].into(),
                    id,
                }),
                Err(_) => errors.push(format!("mwe_extra.tsv:{line}: id non valido: {}", f[1])),
            }
        }
        for (line, f) in rows("function_words.tsv", &t.function_words, 3, &mut errors) {
            let behavior = match f[2] {
                "simbolo" => Some(Behavior::Symbol),
                "nessuno" => Some(Behavior::None),
                "ridotto" => Some(Behavior::Reduced),
                _ => None,
            };
            match (Cat::from_name(f[1]), behavior) {
                (Some(cat), Some(behavior)) => o.function_words.push(FunctionWord { line, key: f[0].into(), cat, behavior }),
                _ => errors.push(format!("function_words.tsv:{line}: categoria o comportamento (simbolo, nessuno, ridotto) non validi")),
            }
        }
        for (line, f) in rows("blocklist.tsv", &t.blocklist, 2, &mut errors) {
            match f[1].parse::<u32>() {
                Ok(id) => o.blocklist.push(IdEntry {
                    line,
                    key: f[0].into(),
                    id,
                }),
                Err(_) => errors.push(format!("blocklist.tsv:{line}: id non valido: {}", f[1])),
            }
        }
        if errors.is_empty() {
            Ok(o)
        } else {
            Err(errors)
        }
    }

    /// Controlla che ogni id citato esista in ARASAAC.
    pub fn check_ids(&self, known: &HashSet<u32>) -> Vec<String> {
        let mut errors = Vec::new();
        let mut check = |file: &str, line: usize, id: u32| {
            if !known.contains(&id) {
                errors.push(format!(
                    "{file}:{line}: il pittogramma {id} non esiste in ARASAAC"
                ));
            }
        };
        self.lemma_picto
            .iter()
            .for_each(|e| check("lemma_picto.tsv", e.line, e.id));
        self.mwe_extra
            .iter()
            .for_each(|e| check("mwe_extra.tsv", e.line, e.id));
        self.blocklist
            .iter()
            .for_each(|e| check("blocklist.tsv", e.line, e.id));
        errors
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts() -> OverrideTexts {
        OverrideTexts {
            forms_extra:
                "# commento\n\npouf\tpouf\tNOUN-M:s\tprestito\ncherimoya\tcherimoya\tNOUN-F:s\n"
                    .into(),
            lemma_picto: "pesca\tNOUN\t2468\t10\tfrutto\n".into(),
            mwe_extra: "lavarsi i denti\t2271\n".into(),
            function_words: "il\tART\tnessuno\n".into(),
            blocklist: "ape\t10\tinadatto\n".into(),
        }
    }

    #[test]
    fn file_validi() {
        let o = Overrides::parse(&texts()).unwrap();
        assert_eq!(o.forms_extra.len(), 2);
        assert_eq!(o.forms_extra[0].line, 3);
        assert_eq!(
            o.lemma_picto[0],
            LemmaPicto {
                line: 1,
                lemma: "pesca".into(),
                cat: Cat::Noun,
                id: 2468,
                priority: 10
            }
        );
        assert_eq!(o.function_words[0].behavior, Behavior::None);
        assert_eq!(o.mwe_extra[0].key, "lavarsi i denti");
    }

    #[test]
    fn file_vuoti_o_solo_commenti() {
        let t = OverrideTexts {
            forms_extra: "# solo intestazione\n".into(),
            ..OverrideTexts::default()
        };
        let o = Overrides::parse(&t).unwrap();
        assert!(o.forms_extra.is_empty() && o.blocklist.is_empty());
    }

    #[test]
    fn errori_con_file_e_riga() {
        let t = OverrideTexts {
            forms_extra: "a\tb\tBOH\nsolo\tdue\n".into(),
            lemma_picto: "pesca\tNOME\t1\t1\n".into(),
            function_words: "il\tART\tforse\n".into(),
            blocklist: "ape\tx\n".into(),
            ..OverrideTexts::default()
        };
        let e = Overrides::parse(&t).unwrap_err();
        assert_eq!(e.len(), 5, "{e:?}");
        assert!(e[0].starts_with("forms_extra.tsv:2:") || e[0].starts_with("forms_extra.tsv:1:"));
        assert!(e.iter().any(|m| m.starts_with("blocklist.tsv:1:")));
    }

    #[test]
    fn id_inesistenti_segnalati() {
        let o = Overrides::parse(&texts()).unwrap();
        let known: HashSet<u32> = [2468, 2271].into_iter().collect();
        let e = o.check_ids(&known);
        assert_eq!(
            e,
            vec!["blocklist.tsv:1: il pittogramma 10 non esiste in ARASAAC".to_string()]
        );
    }
}
