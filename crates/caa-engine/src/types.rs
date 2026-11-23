//! Tipi linguistici condivisi tra la build del lessico e il motore.
//!
//! Ogni enumerazione ha un codice numerico stabile (`as_u8`) usato nei file compilati:
//! non va mai cambiato senza aumentare il numero di schema (`lexicon::SCHEMA`).

/// Genera un'enumerazione con codice numerico stabile e nome testuale.
macro_rules! u8_enum {
    ($(#[$meta:meta])* $name:ident { $($(#[$vmeta:meta])* $var:ident = $val:literal => $label:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        #[repr(u8)]
        pub enum $name { $($(#[$vmeta])* $var = $val),+ }

        impl $name {
            /// Tutti i valori, in ordine di codice.
            pub const ALL: &'static [$name] = &[$($name::$var),+];

            pub fn as_u8(self) -> u8 {
                self as u8
            }

            pub fn from_u8(v: u8) -> Option<Self> {
                match v {
                    $($val => Some($name::$var),)+
                    _ => None,
                }
            }

            /// Nome testuale (quello dei file TSV curati).
            pub fn name(self) -> &'static str {
                match self {
                    $($name::$var => $label),+
                }
            }

            pub fn from_name(s: &str) -> Option<Self> {
                match s {
                    $($label => Some($name::$var),)+
                    _ => None,
                }
            }
        }
    };
}

u8_enum!(
    /// Categoria grammaticale.
    Cat {
        Noun = 0 => "NOUN",
        Propn = 1 => "PROPN",
        Verb = 2 => "VERB",
        Aux = 3 => "AUX",
        Modal = 4 => "MODAL",
        Adj = 5 => "ADJ",
        Adv = 6 => "ADV",
        Art = 7 => "ART",
        Adp = 8 => "ADP",
        ArtAdp = 9 => "ARTADP",
        Pron = 10 => "PRON",
        Clitic = 11 => "CLITIC",
        Det = 12 => "DET",
        Conj = 13 => "CONJ",
        Num = 14 => "NUM",
        Intj = 15 => "INTJ",
        Punct = 16 => "PUNCT",
        // Abbreviazioni, emoticon, simboli (estensione rispetto a SPEC.md).
        Sym = 17 => "SYM",
    }
);

u8_enum!(
    /// Sottotipo dei verbi che SPEC.md non distingue (causativi e aspettuali di Morph-it!).
    #[derive(Default)]
    VerbKind {
        #[default]
        Plain = 0 => "plain",
        Causative = 1 => "causative",
        Aspectual = 2 => "aspectual",
    }
);

u8_enum!(Gender { M = 1 => "m", F = 2 => "f" });
u8_enum!(Number { S = 1 => "s", P = 2 => "p" });
u8_enum!(
    /// Modo verbale (infinito, gerundio e participio contati come modi, come in Morph-it!).
    Mood {
        Ind = 1 => "ind",
        Sub = 2 => "sub",
        Cond = 3 => "cond",
        Impr = 4 => "impr",
        Inf = 5 => "inf",
        Ger = 6 => "ger",
        Part = 7 => "part",
    }
);
u8_enum!(
    /// Tempo (`Past` è il passato remoto per l'indicativo, il participio passato per `Part`).
    Tense {
        Pres = 1 => "pres",
        Past = 2 => "past",
        Impf = 3 => "impf",
        Fut = 4 => "fut",
    }
);
u8_enum!(
    /// Grado dell'aggettivo (estensione rispetto a SPEC.md).
    Degree {
        Pos = 1 => "pos",
        Comp = 2 => "comp",
        Sup = 3 => "sup",
    }
);

/// Clitici che Morph-it! attacca in fondo alla forma verbale ("dammi" = dare + mi).
pub const ENCLITICS: [&str; 41] = [
    "ci", "gli", "la", "le", "li", "lo", "ne", "mi", "si", "ti", "vi", "cela", "cele", "celi",
    "celo", "cene", "gliela", "gliele", "glieli", "glielo", "gliene", "mela", "mele", "meli",
    "melo", "mene", "sela", "sele", "seli", "selo", "sene", "tela", "tele", "teli", "telo", "tene",
    "vela", "vele", "veli", "velo", "vene",
];

/// Clitico attaccato a una forma verbale: indice (da 1) in [`ENCLITICS`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Enclitic(u8);

impl Enclitic {
    pub fn parse(s: &str) -> Option<Self> {
        ENCLITICS
            .iter()
            .position(|e| *e == s)
            .map(|i| Enclitic(i as u8 + 1))
    }

    pub fn from_u8(v: u8) -> Option<Self> {
        (1..=ENCLITICS.len() as u8)
            .contains(&v)
            .then_some(Enclitic(v))
    }

    pub fn as_u8(self) -> u8 {
        self.0
    }

    pub fn as_str(self) -> &'static str {
        ENCLITICS[self.0 as usize - 1]
    }
}

/// Tratti morfologici di una lettura.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Feats {
    pub gender: Option<Gender>,
    pub number: Option<Number>,
    pub mood: Option<Mood>,
    pub tense: Option<Tense>,
    /// 1, 2 o 3.
    pub person: Option<u8>,
    pub degree: Option<Degree>,
    pub enclitic: Option<Enclitic>,
    pub verb_kind: VerbKind,
}

/// Una lettura possibile di una forma: lemma, categoria e tratti.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Reading {
    pub lemma_id: u32,
    pub cat: Cat,
    pub feats: Feats,
}

/// Dimensione in byte di una lettura nel file `morph_feats.bin`.
pub const READING_SIZE: usize = 12;

impl Reading {
    /// Codifica: `[lemma u32 LE][cat][verb_kind][gender][number][mood][tense][person | grado<<4][enclitico]`.
    pub fn to_bytes(&self) -> [u8; READING_SIZE] {
        let l = self.lemma_id.to_le_bytes();
        let f = &self.feats;
        [
            l[0],
            l[1],
            l[2],
            l[3],
            self.cat.as_u8(),
            f.verb_kind.as_u8(),
            f.gender.map_or(0, Gender::as_u8),
            f.number.map_or(0, Number::as_u8),
            f.mood.map_or(0, Mood::as_u8),
            f.tense.map_or(0, Tense::as_u8),
            f.person.unwrap_or(0) | (f.degree.map_or(0, Degree::as_u8) << 4),
            f.enclitic.map_or(0, Enclitic::as_u8),
        ]
    }

    /// Decodifica; `None` se i byte sono troppo pochi o contengono codici sconosciuti.
    pub fn from_bytes(b: &[u8]) -> Option<Reading> {
        let b: &[u8; READING_SIZE] = b.get(..READING_SIZE)?.try_into().ok()?;
        // Codice 0 = tratto assente; un codice non zero sconosciuto invalida la lettura.
        fn field<T>(v: u8, decode: impl Fn(u8) -> Option<T>) -> Option<Option<T>> {
            if v == 0 {
                Some(None)
            } else {
                decode(v).map(Some)
            }
        }
        let person = b[10] & 0x0F;
        if person > 3 {
            return None;
        }
        Some(Reading {
            lemma_id: u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            cat: Cat::from_u8(b[4])?,
            feats: Feats {
                verb_kind: VerbKind::from_u8(b[5])?,
                gender: field(b[6], Gender::from_u8)?,
                number: field(b[7], Number::from_u8)?,
                mood: field(b[8], Mood::from_u8)?,
                tense: field(b[9], Tense::from_u8)?,
                person: (person != 0).then_some(person),
                degree: field(b[10] >> 4, Degree::from_u8)?,
                enclitic: field(b[11], Enclitic::from_u8)?,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codici_e_nomi_coerenti() {
        for c in Cat::ALL {
            assert_eq!(Cat::from_u8(c.as_u8()), Some(*c));
            assert_eq!(Cat::from_name(c.name()), Some(*c));
        }
        assert_eq!(Cat::from_u8(200), None);
        assert_eq!(Cat::from_name("boh"), None);
    }

    #[test]
    fn enclitici_41_distinti() {
        let mut v = ENCLITICS.to_vec();
        v.sort_unstable();
        v.dedup();
        assert_eq!(v.len(), 41);
        let e = Enclitic::parse("glielo").unwrap();
        assert_eq!(e.as_str(), "glielo");
        assert_eq!(Enclitic::from_u8(e.as_u8()), Some(e));
        assert_eq!(Enclitic::parse("xx"), None);
        assert_eq!(Enclitic::from_u8(0), None);
        assert_eq!(Enclitic::from_u8(42), None);
    }

    #[test]
    fn lettura_andata_e_ritorno() {
        let r = Reading {
            lemma_id: 0x0102_0304,
            cat: Cat::Verb,
            feats: Feats {
                gender: Some(Gender::F),
                number: Some(Number::P),
                mood: Some(Mood::Impr),
                tense: Some(Tense::Pres),
                person: Some(2),
                degree: Some(Degree::Sup),
                enclitic: Enclitic::parse("mi"),
                verb_kind: VerbKind::Causative,
            },
        };
        assert_eq!(Reading::from_bytes(&r.to_bytes()), Some(r));
        let vuota = Reading {
            lemma_id: 7,
            cat: Cat::Noun,
            feats: Feats::default(),
        };
        assert_eq!(Reading::from_bytes(&vuota.to_bytes()), Some(vuota));
    }

    #[test]
    fn tratti_assenti_non_invalidano_la_lettura() {
        // Regressione: un tratto a 0 (assente) deve restare None, non scartare la lettura.
        let r = Reading {
            lemma_id: 9,
            cat: Cat::Adv,
            feats: Feats {
                number: Some(Number::S),
                ..Feats::default()
            },
        };
        let back = Reading::from_bytes(&r.to_bytes()).unwrap();
        assert_eq!(back.feats.gender, None);
        assert_eq!(back.feats.number, Some(Number::S));
        assert_eq!(back.feats.enclitic, None);
    }

    #[test]
    fn lettura_corrotta_rifiutata() {
        assert_eq!(Reading::from_bytes(&[0; 5]), None);
        let mut b = Reading {
            lemma_id: 1,
            cat: Cat::Noun,
            feats: Feats::default(),
        }
        .to_bytes();
        b[4] = 250; // categoria inesistente
        assert_eq!(Reading::from_bytes(&b), None);
        let mut b = Reading {
            lemma_id: 1,
            cat: Cat::Noun,
            feats: Feats::default(),
        }
        .to_bytes();
        b[10] = 0x0F; // persona 15
        assert_eq!(Reading::from_bytes(&b), None);
    }
}
