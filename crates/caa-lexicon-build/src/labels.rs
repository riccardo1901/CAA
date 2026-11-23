//! Conversione delle etichette di Morph-it! in categoria e tratti interni.
//!
//! La funzione è totale sulle 664 etichette presenti nel file (verificato dal test
//! `tutte_le_etichette_reali_sono_mappate`): un'etichetta sconosciuta è un errore, mai un ramo "altro".

use caa_engine::types::{Cat, Degree, Enclitic, Feats, Gender, Mood, Number, Tense, VerbKind};

/// Etichetta che non si sa convertire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LabelError(pub String);

type Parsed = Result<(Cat, Feats), LabelError>;

fn simple(cat: Cat) -> Parsed {
    Ok((cat, Feats::default()))
}

fn lower(s: &str) -> String {
    s.to_ascii_lowercase()
}

fn gender(s: &str) -> Option<Gender> {
    Gender::from_name(&lower(s))
}

fn number(s: &str) -> Option<Number> {
    Number::from_name(&lower(s))
}

/// "f+p" → (femminile, plurale).
fn gender_number(rest: &str) -> Option<(Gender, Number)> {
    let (g, n) = rest.split_once('+')?;
    Some((gender(g)?, number(n)?))
}

/// Converte un'etichetta Morph-it! (o dei tratti di `forms_extra.tsv`).
pub fn parse_label(label: &str) -> Parsed {
    let err = || LabelError(label.to_string());

    // Etichette senza tratti.
    match label {
        "ABL" | "SMI" | "SYM" => return simple(Cat::Sym),
        "ADV" | "WH" => return simple(Cat::Adv), // WH: come, dove, comunque…
        "CON" | "WH-CHE" => return simple(Cat::Conj), // WH-CHE: che
        "INT" => return simple(Cat::Intj),
        "NPR" => return simple(Cat::Propn),
        "PON" | "SENT" => return simple(Cat::Punct),
        "PRE" => return simple(Cat::Adp),
        "CE" | "CI" | "NE" | "SI" | "PRO-PERS-CLI-COM" => return simple(Cat::Clitic),
        "DET-NUM-CARD" | "PRO-NUM" => return simple(Cat::Num),
        _ => {}
    }

    if let Some((head, rest)) = label.split_once(':') {
        let parts: Vec<&str> = head.split('-').collect();
        return match parts.as_slice() {
            ["NOUN", g] | ["ART", g] | ["ARTPRE", g] => {
                let cat = match parts[0] {
                    "NOUN" => Cat::Noun,
                    "ART" => Cat::Art,
                    _ => Cat::ArtAdp,
                };
                let feats = Feats {
                    gender: Some(gender(g).ok_or_else(err)?),
                    number: Some(number(rest).ok_or_else(err)?),
                    ..Feats::default()
                };
                Ok((cat, feats))
            }
            ["ADJ"] => {
                let (deg, gn) = rest.split_once('+').ok_or_else(err)?;
                let (g, n) = gender_number(gn).ok_or_else(err)?;
                let feats = Feats {
                    degree: Some(Degree::from_name(deg).ok_or_else(err)?),
                    gender: Some(g),
                    number: Some(n),
                    ..Feats::default()
                };
                Ok((Cat::Adj, feats))
            }
            ["DET", kind] if matches!(*kind, "DEMO" | "INDEF" | "POSS" | "WH") => {
                det_like(rest, label)
            }
            ["TALE"] => det_like(rest, label),
            [fam] => verbal(fam, rest, label),
            _ => Err(err()),
        };
    }

    // Pronomi: PRO-DEMO-F-P, PRO-PERS-1-F-S, PRO-PERS-CLI-3-M-S, …
    let parts: Vec<&str> = label.split('-').collect();
    match parts.as_slice() {
        ["PRO", kind, g, n] if matches!(*kind, "DEMO" | "INDEF" | "POSS" | "WH") => {
            Ok((Cat::Pron, gn_feats(g, n, None).ok_or_else(err)?))
        }
        ["PRO", "PERS", p, g, n] => Ok((Cat::Pron, gn_feats(g, n, Some(p)).ok_or_else(err)?)),
        ["PRO", "PERS", "CLI", p, g, n] => {
            Ok((Cat::Clitic, gn_feats(g, n, Some(p)).ok_or_else(err)?))
        }
        _ => Err(err()),
    }
}

fn gn_feats(g: &str, n: &str, person: Option<&str>) -> Option<Feats> {
    let person = match person {
        None => None,
        Some(p) => Some(p.parse::<u8>().ok().filter(|p| (1..=3).contains(p))?),
    };
    Some(Feats {
        gender: Some(gender(g)?),
        number: Some(number(n)?),
        person,
        ..Feats::default()
    })
}

fn det_like(rest: &str, label: &str) -> Parsed {
    let (g, n) = gender_number(rest).ok_or_else(|| LabelError(label.to_string()))?;
    Ok((
        Cat::Det,
        Feats {
            gender: Some(g),
            number: Some(n),
            ..Feats::default()
        },
    ))
}

/// Famiglie verbali: `VER:ind+pres+3+s`, `VER:inf+pres+si`, `VER:part+past+s+m`, …
fn verbal(fam: &str, rest: &str, label: &str) -> Parsed {
    let err = || LabelError(label.to_string());
    let (cat, kind) = match fam {
        "VER" => (Cat::Verb, VerbKind::Plain),
        "AUX" => (Cat::Aux, VerbKind::Plain),
        "MOD" => (Cat::Modal, VerbKind::Plain),
        "CAU" => (Cat::Verb, VerbKind::Causative),
        "ASP" => (Cat::Verb, VerbKind::Aspectual),
        _ => return Err(err()),
    };
    let mut tokens = rest.split('+');
    let mood_tok = tokens.next().ok_or_else(err)?;
    let tense_tok = tokens.next().ok_or_else(err)?;
    let tense = Tense::from_name(tense_tok).ok_or_else(err)?;
    // Un'etichetta di Morph-it! ("mossoci") scrive "past+past" dove ci vorrebbe "part+past":
    // è un participio passato.
    let mood = match (mood_tok, tense) {
        ("past", Tense::Past) => Mood::Part,
        (m, _) => Mood::from_name(m).ok_or_else(err)?,
    };
    let mut feats = Feats {
        mood: Some(mood),
        tense: Some(tense),
        verb_kind: kind,
        ..Feats::default()
    };
    for t in tokens {
        match t {
            "1" | "2" | "3" if feats.person.is_none() => feats.person = t.parse().ok(),
            "s" | "p" if feats.number.is_none() => feats.number = number(t),
            "m" | "f" if feats.gender.is_none() => feats.gender = gender(t),
            _ if feats.enclitic.is_none() => {
                feats.enclitic = Some(Enclitic::parse(t).ok_or_else(err)?)
            }
            _ => return Err(err()),
        }
    }
    Ok((cat, feats))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(label: &str) -> (Cat, Feats) {
        parse_label(label).unwrap_or_else(|e| panic!("etichetta non mappata: {}", e.0))
    }

    #[test]
    fn nomi_articoli_aggettivi() {
        let (c, f) = ok("NOUN-F:p");
        assert_eq!(
            (c, f.gender, f.number),
            (Cat::Noun, Some(Gender::F), Some(Number::P))
        );
        assert_eq!(ok("ARTPRE-M:s").0, Cat::ArtAdp);
        let (c, f) = ok("ADJ:sup+m+p");
        assert_eq!(
            (c, f.degree, f.gender, f.number),
            (
                Cat::Adj,
                Some(Degree::Sup),
                Some(Gender::M),
                Some(Number::P)
            )
        );
    }

    #[test]
    fn verbo_finito_e_imperativo_con_clitico() {
        let (c, f) = ok("VER:ind+impf+3+s");
        assert_eq!(
            (c, f.mood, f.tense, f.person, f.number),
            (
                Cat::Verb,
                Some(Mood::Ind),
                Some(Tense::Impf),
                Some(3),
                Some(Number::S)
            )
        );
        let (c, f) = ok("VER:impr+pres+2+s+mi"); // dammi
        assert_eq!(
            (c, f.mood, f.enclitic.map(|e| e.as_str())),
            (Cat::Verb, Some(Mood::Impr), Some("mi"))
        );
        let (_, f) = ok("VER:inf+pres+si"); // lavarsi
        assert_eq!(f.enclitic.map(|e| e.as_str()), Some("si"));
        let (_, f) = ok("VER:impr+pres+2+s+glielo");
        assert_eq!(f.enclitic.map(|e| e.as_str()), Some("glielo"));
    }

    #[test]
    fn participi_e_gerundi() {
        let (_, f) = ok("VER:part+past+s+f");
        assert_eq!(
            (f.mood, f.tense, f.gender, f.number),
            (
                Some(Mood::Part),
                Some(Tense::Past),
                Some(Gender::F),
                Some(Number::S)
            )
        );
        assert_eq!(ok("VER:ger+pres").1.mood, Some(Mood::Ger));
    }

    #[test]
    fn etichetta_anomala_past_past_e_participio() {
        let (_, f) = ok("VER:past+past+s+m+ci"); // mossoci
        assert_eq!((f.mood, f.tense), (Some(Mood::Part), Some(Tense::Past)));
        assert_eq!(f.enclitic.map(|e| e.as_str()), Some("ci"));
    }

    #[test]
    fn causativi_aspettuali_ausiliari_modali() {
        assert_eq!(
            ok("CAU:inf+pres"),
            (
                Cat::Verb,
                Feats {
                    mood: Some(Mood::Inf),
                    tense: Some(Tense::Pres),
                    verb_kind: VerbKind::Causative,
                    ..Feats::default()
                }
            )
        );
        assert_eq!(ok("ASP:ind+pres+3+s").1.verb_kind, VerbKind::Aspectual);
        assert_eq!(ok("AUX:ind+pres+3+s").0, Cat::Aux);
        assert_eq!(ok("MOD:ind+pres+1+s").0, Cat::Modal);
    }

    #[test]
    fn pronomi_e_clitici() {
        let (c, f) = ok("PRO-PERS-1-M-S");
        assert_eq!((c, f.person), (Cat::Pron, Some(1)));
        let (c, f) = ok("PRO-PERS-CLI-3-F-S");
        assert_eq!(
            (c, f.person, f.gender),
            (Cat::Clitic, Some(3), Some(Gender::F))
        );
        assert_eq!(ok("PRO-PERS-CLI-COM").0, Cat::Clitic);
        assert_eq!(ok("PRO-DEMO-F-P").0, Cat::Pron);
        assert_eq!(ok("DET-INDEF:m+s").0, Cat::Det);
        assert_eq!(ok("TALE:f+p").0, Cat::Det);
    }

    #[test]
    fn senza_tratti() {
        for (l, c) in [
            ("ADV", Cat::Adv),
            ("WH", Cat::Adv),
            ("WH-CHE", Cat::Conj),
            ("CON", Cat::Conj),
            ("NPR", Cat::Propn),
            ("PON", Cat::Punct),
            ("SENT", Cat::Punct),
            ("PRE", Cat::Adp),
            ("INT", Cat::Intj),
            ("ABL", Cat::Sym),
            ("SMI", Cat::Sym),
            ("SYM", Cat::Sym),
            ("CE", Cat::Clitic),
            ("NE", Cat::Clitic),
            ("DET-NUM-CARD", Cat::Num),
            ("PRO-NUM", Cat::Num),
        ] {
            assert_eq!(ok(l).0, c, "{l}");
        }
    }

    #[test]
    fn etichette_sconosciute_o_incoerenti_sono_errori() {
        for l in [
            "",
            "BOH",
            "NOUN-X:s",
            "NOUN-M:x",
            "VER:ind",
            "VER:ind+pres+3+s+zz",
            "VER:ind+pres+3+3",
            "PRO-PERS-9-M-S",
            "ADJ:pos+m",
            "DET-FOO:m+s",
        ] {
            assert_eq!(parse_label(l), Err(LabelError(l.to_string())), "{l:?}");
        }
    }

    /// Le 664 etichette distinte trovate in Morph-it! 048 (elenco in docs/M1-etichette-morphit.tsv).
    #[test]
    fn tutte_le_etichette_reali_sono_mappate() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../docs/M1-etichette-morphit.tsv"
        );
        let text = std::fs::read_to_string(path).expect("docs/M1-etichette-morphit.tsv");
        let labels: Vec<&str> = text
            .lines()
            .filter_map(|l| l.split('\t').next())
            .filter(|l| !l.is_empty())
            .collect();
        assert_eq!(labels.len(), 664);
        let unmapped: Vec<&&str> = labels.iter().filter(|l| parse_label(l).is_err()).collect();
        assert!(unmapped.is_empty(), "etichette non mappate: {unmapped:?}");
    }
}
