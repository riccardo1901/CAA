//! Scomposizione dei clitici attaccati al verbo (SPEC.md, fase 4): "portamelo" = portare + me + lo.
//!
//! Funzione pura: riceve una ricerca nel lessico dei verbi e restituisce le scomposizioni valide.
//! Si accetta solo se l'ospite ricostruito è un verbo del lessico all'infinito, al gerundio, al
//! participio o all'imperativo (seconda persona o prima plurale): "cartella" non diventa
//! "carte" + "lla".

use crate::types::{Cat, Enclitic, Feats, Mood, Number};

/// Una lettura verbale dell'ospite, come la dà il lessico.
#[derive(Debug, Clone)]
pub struct HostReading {
    pub lemma: String,
    pub cat: Cat,
    pub feats: Feats,
}

/// Una scomposizione valida: il lemma e i tratti dell'ospite, con il cluster in `feats.enclitic`.
#[derive(Debug, Clone, PartialEq)]
pub struct Split {
    pub lemma: String,
    pub cat: Cat,
    pub feats: Feats,
    /// Forma dell'ospite come ricostruita ("lavare", "porta", "da'").
    pub host: String,
}

const SINGLE: [&str; 11] = [
    "mi", "ti", "ci", "vi", "si", "gli", "lo", "la", "li", "le", "ne",
];
const FIRST: [&str; 6] = ["me", "te", "ce", "ve", "se", "glie"];
const SECOND: [&str; 5] = ["lo", "la", "li", "le", "ne"];

/// Imperativi tronchi che raddoppiano la consonante del clitico: dammi, fallo, dillo, stacci, vattene.
const DOUBLING: [(&str, &str); 5] = [
    ("da", "dare"),
    ("fa", "fare"),
    ("di", "dire"),
    ("sta", "stare"),
    ("va", "andare"),
];

/// Ospiti degli imperativi tronchi (da', fa', di', sta', va').
pub const TRUNCATED_IMPERATIVES: [&str; 5] = ["da", "fa", "di", "sta", "va"];

/// Gruppi di clitici che chiudono `key`, dal più lungo (coppia) al più corto.
fn clusters(key: &str) -> Vec<&'static str> {
    let mut out = Vec::new();
    for a in FIRST {
        for b in SECOND {
            let pair = format!("{a}{b}");
            if key.ends_with(&pair) {
                if let Some(e) = crate::types::ENCLITICS.iter().find(|e| **e == pair) {
                    out.push(*e);
                }
            }
        }
    }
    out.extend(SINGLE.iter().copied().filter(|c| key.ends_with(c)));
    out
}

fn imperative_ok(f: &Feats) -> bool {
    f.mood == Some(Mood::Impr)
        && (f.person == Some(2) || (f.person == Some(1) && f.number == Some(Number::P)))
}

/// Scomposizioni valide di `key` (una forma già normalizzata). `verbs(forma)` restituisce le
/// letture verbali della forma nel lessico.
pub fn split_enclitics(key: &str, verbs: &dyn Fn(&str) -> Vec<HostReading>) -> Vec<Split> {
    let mut out: Vec<Split> = Vec::new();
    let mut push = |lemma: &str, cat: Cat, mut feats: Feats, host: &str, cluster: &str| {
        feats.enclitic = Enclitic::parse(cluster);
        let s = Split {
            lemma: lemma.to_string(),
            cat,
            feats,
            host: host.to_string(),
        };
        if !out.contains(&s) {
            out.push(s);
        }
    };
    for cluster in clusters(key) {
        let host = &key[..key.len() - cluster.len()];
        if host.chars().count() < 2 {
            continue;
        }
        // 1. L'ospite così com'è: gerundio, participio, imperativo ("dicendolo", "portamelo").
        for r in verbs(host) {
            let f = &r.feats;
            if matches!(f.mood, Some(Mood::Ger | Mood::Part)) || imperative_ok(f) {
                push(&r.lemma, r.cat, r.feats, host, cluster);
            }
        }
        // 2. Infinito troncato: lavar + e, condur + re.
        let mut infinitives = vec![format!("{host}e")];
        if host.ends_with('r') {
            infinitives.push(format!("{host}re"));
        }
        for inf in &infinitives {
            for r in verbs(inf) {
                if r.feats.mood == Some(Mood::Inf) {
                    push(&r.lemma, r.cat, r.feats, inf, cluster);
                }
            }
        }
        // 3. Imperativo tronco: da', fa', di', sta', va' (con raddoppio: dammi, fallo, vattene).
        let first = cluster.chars().next().unwrap_or(' ');
        let doubled = cluster != "gli" && host.ends_with(first) && !"aeiou".contains(first);
        for (short, lemma) in DOUBLING {
            let matches = host == short || (doubled && host.strip_suffix(first) == Some(short));
            if matches {
                let feats = Feats {
                    mood: Some(Mood::Impr),
                    person: Some(2),
                    number: Some(Number::S),
                    ..Feats::default()
                };
                push(lemma, Cat::Verb, feats, short, cluster);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Tense;

    fn host(lemma: &str, mood: Mood, person: Option<u8>, number: Option<Number>) -> HostReading {
        HostReading {
            lemma: lemma.into(),
            cat: Cat::Verb,
            feats: Feats {
                mood: Some(mood),
                tense: Some(Tense::Pres),
                person,
                number,
                ..Feats::default()
            },
        }
    }

    /// Un lessico finto di forme verbali.
    fn verbs(form: &str) -> Vec<HostReading> {
        use Mood::*;
        match form {
            "lavare" => vec![host("lavare", Inf, None, None)],
            "dicendo" => vec![host("dire", Ger, None, None)],
            "porta" => vec![
                host("portare", Impr, Some(2), Some(Number::S)),
                host("portare", Ind, Some(3), Some(Number::S)),
            ],
            "condurre" => vec![host("condurre", Inf, None, None)],
            "ami" => vec![host("amare", Sub, Some(3), Some(Number::S))],
            "dato" => vec![host("dare", Part, None, None)],
            "prendi" => vec![host("prendere", Impr, Some(2), Some(Number::S))],
            "porre" => vec![host("porre", Inf, None, None)],
            _ => vec![],
        }
    }

    fn one(key: &str) -> Split {
        let v = split_enclitics(key, &verbs);
        assert_eq!(v.len(), 1, "{key}: {v:?}");
        v.into_iter().next().unwrap()
    }

    #[test]
    fn esempi_della_specifica() {
        let s = one("lavarsi");
        assert_eq!((s.lemma.as_str(), s.host.as_str()), ("lavare", "lavare"));
        assert_eq!(s.feats.enclitic.unwrap().as_str(), "si");
        assert_eq!(one("dicendolo").lemma, "dire");
        let s = one("portamelo");
        assert_eq!(s.lemma, "portare");
        assert_eq!(s.feats.enclitic.unwrap().pieces(), vec!["mi", "lo"]);
        assert_eq!(one("condurlo").lemma, "condurre");
        assert_eq!(one("porlo").lemma, "porre");
        assert_eq!(one("prendilo").lemma, "prendere");
        assert_eq!(one("datolo").lemma, "dare");
    }

    #[test]
    fn imperativi_tronchi_con_raddoppio() {
        for (key, lemma, cluster) in [
            ("dammi", "dare", "mi"),
            ("fallo", "fare", "lo"),
            ("dillo", "dire", "lo"),
            ("stacci", "stare", "ci"),
            ("vattene", "andare", "tene"),
            ("dagli", "dare", "gli"),
            ("dacci", "dare", "ci"),
        ] {
            let s = one(key);
            assert_eq!(s.lemma, lemma, "{key}");
            assert_eq!(s.feats.enclitic.unwrap().as_str(), cluster, "{key}");
            assert_eq!(s.feats.mood, Some(Mood::Impr));
        }
    }

    #[test]
    fn non_si_scompone_se_l_ospite_non_e_un_verbo_valido() {
        for key in ["cartella", "pane", "palla", "mi", "lo", "ne"] {
            assert!(split_enclitics(key, &verbs).is_empty(), "{key}");
        }
        // "ami" è congiuntivo, non imperativo di seconda persona: "amici" non diventa amare + ci.
        assert!(split_enclitics("amici", &verbs).is_empty());
        // L'ospite deve essere lungo almeno 2 lettere.
        assert!(split_enclitics("elo", &verbs).is_empty());
    }

    #[test]
    fn gruppi_di_clitici() {
        assert_eq!(
            Enclitic::parse("glielo").unwrap().pieces(),
            vec!["gli", "lo"]
        );
        assert_eq!(Enclitic::parse("tene").unwrap().pieces(), vec!["ti", "ne"]);
        assert_eq!(Enclitic::parse("ci").unwrap().pieces(), vec!["ci"]);
        assert_eq!(Enclitic::parse("cela").unwrap().pieces(), vec!["ci", "la"]);
    }
}
