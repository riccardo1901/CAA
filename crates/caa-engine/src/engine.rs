//! Motore di simbolizzazione, fasi 1–3 e 8 (M4): da un paragrafo a una lista di token con
//! letture e pittogramma. **Senza contesto**: la scelta fra più letture usa una regola fissa e
//! provvisoria (`BaselinePick`) che la fase 7 (M5) sostituirà con la decodifica sulla frase.
//!
//! Il motore è puro: riceve lessico e file curati già caricati, non tocca disco né rete.

use std::cmp::Reverse;
use std::fmt;

use crate::curated::Curated;
use crate::lexicon::{picto_flags, MorphLexicon, PictoEntry, PictoIndex};
use crate::norm::normalize_key;
use crate::tokenize::{tokenize, RawToken, TokenKind};
use crate::types::{Cat, Feats, Gender, Mood, Number, Tense};

// ---------------------------------------------------------------------------------------
// Contratto (SPEC.md, "Contratto (Rust)")
// ---------------------------------------------------------------------------------------

/// Politica delle parole funzionali e preset del documento (la usa la fase 10, M8).
#[derive(Debug, Clone, Default)]
pub struct DocPrefs {}

/// Scelta esplicita del docente su un intervallo di testo (la usa la fase 8, M8).
#[derive(Debug, Clone)]
pub struct ForcedPick {
    pub span_utf16: (u32, u32),
    pub picto: u32,
}

/// Lemma → pittogramma già scelto nel documento (blocco di senso, M8).
#[derive(Debug, Clone, Default)]
pub struct SenseLocks {}

/// Correzioni passate del docente (M8).
#[derive(Debug, Clone, Default)]
pub struct UserMemory {}

pub struct Request<'a> {
    /// Un paragrafo.
    pub text: &'a str,
    pub prefs: &'a DocPrefs,
    pub forced: &'a [ForcedPick],
    pub sense_locks: &'a SenseLocks,
    pub memory: &'a UserMemory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Display {
    Full,
    Reduced,
    TextOnly,
    Hidden,
}

/// Segni da sovrapporre al pittogramma (fase 9, M6): PLURALE, PASSATO, FUTURO.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Modifiers(pub u8);

impl Modifiers {
    pub const PLURAL: u8 = 1;
    pub const PAST: u8 = 2;
    pub const FUTURE: u8 = 4;

    pub fn contains(self, flag: u8) -> bool {
        self.0 & flag != 0
    }
}

/// Pittogramma ARASAAC (i simboli personali arrivano in M8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PictoRef {
    pub id: u32,
}

/// Appartenenza a un tempo composto o a una multiparola (M6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroupRef {
    pub id: u32,
}

/// Alternativa del menu (fase 10, M8).
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub picto: PictoRef,
    pub keyword: String,
}

/// Da dove viene una lettura.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadingSource {
    /// Morph-it! (comprese le forme di `forms_extra.tsv`).
    Lexicon,
    /// Maiuscola: nome proprio.
    Capital,
    /// Parola sconosciuta a Morph-it! ma chiave ARASAAC: categoria dal tipo della parola chiave.
    ArasaacKey,
    /// Una sola forma del lessico a distanza 1.
    Typo,
    /// Indovinata dal suffisso.
    SuffixGuess,
    /// Numeri.
    Literal,
}

/// Una lettura: lemma, categoria e tratti.
#[derive(Debug, Clone, PartialEq)]
pub struct Analysis {
    pub lemma: String,
    pub cat: Cat,
    pub feats: Feats,
    pub source: ReadingSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadingReason {
    Punctuation,
    Literal,
    OnlyReading,
    /// Scelta provvisoria tra più letture (M4): prima quelle che portano a un pittogramma, poi
    /// una priorità fissa per categoria.
    BaselinePick,
    Capital,
    ArasaacKey,
    Typo,
    SuffixGuess,
    NoReading,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PictoReason {
    NoSymbol,
    Curated,
    ExactForm,
    Singular,
    Lemma,
    /// Il singolare non ha pittogramma ma il plurale sì (ARASAAC ha "pastelli", non "pastello").
    /// Estensione rispetto a SPEC.md, che copre solo il caso inverso.
    PluralForm,
    IgnoringCategory,
    NumberWord,
}

/// Perché il motore ha scelto così (debug e menu delle alternative).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reason {
    pub reading: ReadingReason,
    pub picto: PictoReason,
}

impl Reason {
    /// Etichetta breve del motivo del pittogramma (per le statistiche di `caa-eval`).
    pub fn picto_label(&self) -> &'static str {
        match self.picto {
            PictoReason::NoSymbol => "nessun simbolo",
            PictoReason::Curated => "preferito (lemma_picto)",
            PictoReason::ExactForm => "forma esatta",
            PictoReason::Singular => "singolare",
            PictoReason::Lemma => "lemma",
            PictoReason::PluralForm => "plurale (manca il singolare)",
            PictoReason::IgnoringCategory => "ignorando la categoria",
            PictoReason::NumberWord => "numero in lettere",
        }
    }
}

impl fmt::Display for Reason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let reading = match self.reading {
            ReadingReason::Punctuation => "punteggiatura",
            ReadingReason::Literal => "numero",
            ReadingReason::OnlyReading => "una sola lettura",
            ReadingReason::BaselinePick => "scelta provvisoria fra più letture",
            ReadingReason::Capital => "maiuscola: nome proprio",
            ReadingReason::ArasaacKey => {
                "parola non in Morph-it!, categoria dalla parola chiave ARASAAC"
            }
            ReadingReason::Typo => "possibile refuso",
            ReadingReason::SuffixGuess => "indovinata dal suffisso",
            ReadingReason::NoReading => "parola sconosciuta",
        };
        let picto = match self.picto {
            PictoReason::NoSymbol => "nessun simbolo",
            PictoReason::Curated => "pittogramma preferito (lemma_picto)",
            PictoReason::ExactForm => "pittogramma della forma esatta",
            PictoReason::Singular => "pittogramma del singolare",
            PictoReason::Lemma => "pittogramma del lemma",
            PictoReason::PluralForm => "pittogramma del plurale (manca il singolare)",
            PictoReason::IgnoringCategory => "pittogramma trovato ignorando la categoria",
            PictoReason::NumberWord => "pittogramma del numero in lettere",
        };
        write!(f, "{reading}; {picto}")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    /// Intervallo nel paragrafo, in unità UTF-16.
    pub span_utf16: (u32, u32),
    pub surface: String,
    pub kind: TokenKind,
    /// La lettura scelta.
    pub analysis: Option<Analysis>,
    /// Tutte le letture (la fase 7 sceglierà fra queste; estensione rispetto al contratto).
    pub readings: Vec<Analysis>,
    /// Forma corretta proposta per un possibile refuso.
    pub corrected: Option<String>,
    pub group: Option<GroupRef>,
    pub picto: Option<PictoRef>,
    pub modifiers: Modifiers,
    pub display: Display,
    /// 0..1: sotto 0,6 la parola si sottolinea nell'editor.
    pub confidence: f32,
    pub alternatives: Vec<Candidate>,
    pub reason: Reason,
}

// ---------------------------------------------------------------------------------------
// Funzioni di servizio (pure, senza lessico)
// ---------------------------------------------------------------------------------------

/// Maschera dei tipi ARASAAC compatibili con una categoria (bit `t` = tipo `t`); i tipi sono in
/// `docs/RAPPORTO-M1.md`. Una chiave senza tipo (bit 0) è compatibile con tutto.
fn category_mask(cat: Cat) -> u8 {
    match cat {
        Cat::Propn => 1 << 1,
        Cat::Noun => 1 << 2,
        Cat::Verb | Cat::Aux | Cat::Modal => 1 << 3,
        Cat::Adj | Cat::Adv | Cat::Num | Cat::Det => 1 << 4,
        _ => (1 << 4) | (1 << 5) | (1 << 6),
    }
}

fn compatible(cat: Cat, e: &PictoEntry) -> bool {
    e.keyword_types & (category_mask(cat) | 1) != 0
}

/// Priorità fissa fra categorie (regola provvisoria di M4).
fn category_rank(cat: Cat) -> u8 {
    match cat {
        Cat::Noun => 0,
        Cat::Verb => 1,
        Cat::Adj => 2,
        Cat::Adv => 3,
        Cat::Num => 4,
        Cat::Propn => 5,
        Cat::Intj => 6,
        Cat::Conj => 7,
        Cat::Pron => 8,
        Cat::Det => 9,
        Cat::Art => 10,
        Cat::Adp => 11,
        Cat::ArtAdp => 12,
        Cat::Clitic => 13,
        Cat::Aux => 14,
        Cat::Modal => 15,
        Cat::Sym => 16,
        Cat::Punct => 17,
    }
}

/// Genere e numero dedotti dal suffisso (SPEC.md, fase 3, punto 2): -o maschile singolare, -a
/// femminile singolare, -i plurale; -e è ambiguo (madre, madri) e resta vuoto.
fn infer_gender_number(key: &str, plural_flag: bool) -> (Option<Gender>, Option<Number>) {
    if plural_flag {
        return (None, Some(Number::P));
    }
    match key.chars().last() {
        Some('o') => (Some(Gender::M), Some(Number::S)),
        Some('a') => (Some(Gender::F), Some(Number::S)),
        Some('i') => (None, Some(Number::P)),
        _ => (None, None),
    }
}

/// Possibili singolari di una forma plurale, nell'ordine in cui conviene provarli.
fn singular_candidates(key: &str, gender: Option<Gender>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |suffix_from: &str, suffix_to: &str| {
        if let Some(stem) = key.strip_suffix(suffix_from) {
            if !stem.is_empty() {
                out.push(format!("{stem}{suffix_to}"));
            }
        }
    };
    let feminine_first = gender == Some(Gender::F);
    for (from, to) in [("che", "ca"), ("ghe", "ga"), ("chi", "co"), ("ghi", "go")] {
        add(from, to);
    }
    if feminine_first {
        add("e", "a");
        add("i", "e");
        add("i", "o");
    } else {
        add("i", "o");
        add("e", "a");
        add("i", "e");
    }
    add("i", "io");
    out
}

/// Tabella dei prefissi elisi (SPEC.md, fase 2): prefisso → lemma e categoria. Le preposizioni
/// articolate elise mostrano il simbolo della preposizione ("nell'" → "in").
const ELISION_TABLE: [(&str, &str, Cat); 18] = [
    ("l'", "il", Cat::Art),
    ("un'", "uno", Cat::Art),
    ("dell'", "di", Cat::ArtAdp),
    ("all'", "a", Cat::ArtAdp),
    ("dall'", "da", Cat::ArtAdp),
    ("nell'", "in", Cat::ArtAdp),
    ("sull'", "su", Cat::ArtAdp),
    ("c'", "ci", Cat::Clitic),
    ("m'", "mi", Cat::Clitic),
    ("s'", "si", Cat::Clitic),
    ("t'", "ti", Cat::Clitic),
    ("v'", "vi", Cat::Clitic),
    ("d'", "di", Cat::Adp),
    ("quest'", "questo", Cat::Det),
    ("quell'", "quello", Cat::Det),
    ("nessun'", "nessuno", Cat::Det),
    ("buon'", "buono", Cat::Adj),
    ("sant'", "santo", Cat::Adj),
];

fn elision_reading(key: &str) -> Option<Analysis> {
    let (_, lemma, cat) = ELISION_TABLE.iter().find(|(prefix, _, _)| *prefix == key)?;
    Some(analysis(
        lemma,
        *cat,
        Feats::default(),
        ReadingSource::Lexicon,
    ))
}

/// Possibili plurali di un singolare, nell'ordine in cui conviene provarli. Il booleano dice se il
/// candidato è "stretto": un plurale irregolare (labbro → labbra) si accetta solo se Morph-it! lo
/// conferma come plurale dello stesso lemma, perché una regola sul suffisso da sola farebbe
/// diventare "pasto" il plurale... "pasta".
fn plural_candidates(key: &str, gender: Option<Gender>) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    let mut add = |from: &str, to: &str, strict: bool| {
        if let Some(stem) = key.strip_suffix(from) {
            // Un resto vuoto vale solo quando la regola copre la parola intera ("dio" → "dei").
            if !stem.is_empty() || from.len() >= 3 {
                out.push((format!("{stem}{to}"), strict));
            }
        }
    };
    // -co e -go: -chi/-ghi (gioco) oppure -ci/-gi (amico): si provano entrambi.
    for (from, to) in [
        ("co", "chi"),
        ("co", "ci"),
        ("go", "ghi"),
        ("go", "gi"),
        ("ca", "che"),
        ("ga", "ghe"),
        ("io", "i"),
    ] {
        add(from, to, false);
    }
    if gender == Some(Gender::F) {
        add("a", "e", false);
        add("o", "i", false);
    } else {
        add("o", "i", false);
        add("a", "e", false);
    }
    add("e", "i", false);
    // Irregolari: -o → -a (dito/dita, labbro/labbra, uovo/uova, osso/ossa), -io → -a (braccio/braccia),
    // -a → -i (ala/ali, arma/armi) e pochi altri.
    for (from, to) in [
        ("io", "a"),
        ("o", "a"),
        ("a", "i"),
        ("omo", "omini"),
        ("dio", "dei"),
        ("bue", "buoi"),
    ] {
        add(from, to, true);
    }
    out
}

const NUMBER_WORDS: [&str; 21] = [
    "zero",
    "uno",
    "due",
    "tre",
    "quattro",
    "cinque",
    "sei",
    "sette",
    "otto",
    "nove",
    "dieci",
    "undici",
    "dodici",
    "tredici",
    "quattordici",
    "quindici",
    "sedici",
    "diciassette",
    "diciotto",
    "diciannove",
    "venti",
];

/// Cifre → parola ("3" → "tre"): "3" e "tre" hanno lo stesso trattamento (SPEC.md, fase 2).
fn number_word(digits: &str) -> Option<&'static str> {
    let n: usize = digits.parse().ok()?;
    match n {
        0..=20 => Some(NUMBER_WORDS[n]),
        30 => Some("trenta"),
        40 => Some("quaranta"),
        50 => Some("cinquanta"),
        60 => Some("sessanta"),
        70 => Some("settanta"),
        80 => Some("ottanta"),
        90 => Some("novanta"),
        100 => Some("cento"),
        1000 => Some("mille"),
        _ => None,
    }
}

fn analysis(lemma: &str, cat: Cat, feats: Feats, source: ReadingSource) -> Analysis {
    Analysis {
        lemma: lemma.to_string(),
        cat,
        feats,
        source,
    }
}

/// Indovino per suffisso (SPEC.md, fase 3, punto 4). Sempre confidenza bassa.
fn suffix_readings(key: &str) -> Vec<Analysis> {
    let mut out = Vec::new();
    let src = ReadingSource::SuffixGuess;
    let ends = |s: &[&str]| s.iter().any(|x| key.ends_with(x));
    if key.ends_with("mente") {
        out.push(analysis(key, Cat::Adv, Feats::default(), src));
    } else if ends(&["zione", "sione"]) {
        let f = Feats {
            gender: Some(Gender::F),
            number: Some(Number::S),
            ..Feats::default()
        };
        out.push(analysis(key, Cat::Noun, f, src));
    } else if key.ends_with('à') {
        let f = Feats {
            gender: Some(Gender::F),
            ..Feats::default()
        };
        out.push(analysis(key, Cat::Noun, f, src));
    } else if ends(&["are", "ere", "ire"]) {
        let f = Feats {
            mood: Some(Mood::Inf),
            tense: Some(Tense::Pres),
            ..Feats::default()
        };
        out.push(analysis(key, Cat::Verb, f, src));
    } else if ends(&["ando", "endo"]) {
        let f = Feats {
            mood: Some(Mood::Ger),
            tense: Some(Tense::Pres),
            ..Feats::default()
        };
        out.push(analysis(key, Cat::Verb, f, src));
    } else if ends(&["ato", "uto", "ito"]) {
        let f = Feats {
            mood: Some(Mood::Part),
            tense: Some(Tense::Past),
            ..Feats::default()
        };
        out.push(analysis(key, Cat::Verb, f, src));
    }
    out
}

// ---------------------------------------------------------------------------------------
// Il motore
// ---------------------------------------------------------------------------------------

struct Prepared {
    raw: RawToken,
    key: String,
    capitalized: bool,
    sentence_start: bool,
}

struct PictoChoice {
    id: u32,
    reason: PictoReason,
    penalty: f32,
}

pub struct Engine<D: AsRef<[u8]>> {
    morph: MorphLexicon<D>,
    picto: PictoIndex<D>,
    curated: Curated,
}

impl<D: AsRef<[u8]>> Engine<D> {
    pub fn new(morph: MorphLexicon<D>, picto: PictoIndex<D>, curated: Curated) -> Self {
        Engine {
            morph,
            picto,
            curated,
        }
    }

    pub fn morph(&self) -> &MorphLexicon<D> {
        &self.morph
    }

    pub fn picto_index(&self) -> &PictoIndex<D> {
        &self.picto
    }

    /// Scorciatoia con preferenze, scelte e memoria vuote.
    pub fn symbolize_text(&self, text: &str) -> Vec<Token> {
        self.symbolize(&Request {
            text,
            prefs: &DocPrefs::default(),
            forced: &[],
            sense_locks: &SenseLocks::default(),
            memory: &UserMemory::default(),
        })
    }

    /// Un paragrafo → token annotati.
    pub fn symbolize(&self, req: &Request) -> Vec<Token> {
        let prepared = self.prepare(req.text, tokenize(req.text));
        prepared
            .into_iter()
            .map(|p| {
                let surface = req.text[p.raw.byte_start..p.raw.byte_end].to_string();
                self.token_for(p, surface)
            })
            .collect()
    }

    fn known(&self, key: &str) -> bool {
        !self.morph.lookup(key).is_empty() || !self.picto.lookup(key).is_empty()
    }

    /// Apostrofo finale ("po'", "E'", "perche'"): chiave da usare, o `None` se va staccato come
    /// punteggiatura (virgolette).
    fn resolve_apostrophe(&self, surface: &str) -> Option<String> {
        let with = normalize_key(surface);
        if self.known(&with) {
            return Some(with); // "po'", "mo'", "da'"…
        }
        let mut base =
            normalize_key(&surface[..surface.len() - surface.chars().last()?.len_utf8()]);
        let last = base.pop()?;
        let single = base.is_empty() && last == 'e';
        let variants: &[char] = match last {
            'e' if single => &['è'],
            'e' => &['é', 'è'],
            'a' => &['à'],
            'i' => &['ì'],
            'o' => &['ò'],
            'u' => &['ù'],
            _ => &[],
        };
        variants
            .iter()
            .map(|v| format!("{base}{v}"))
            .find(|cand| self.known(cand))
    }

    /// Fasi 1–2: normalizza ogni token e risolve gli apostrofi finali.
    fn prepare(&self, text: &str, raws: Vec<RawToken>) -> Vec<Prepared> {
        let mut out: Vec<Prepared> = Vec::with_capacity(raws.len());
        let mut at_start = true;
        for raw in raws {
            let surface = &text[raw.byte_start..raw.byte_end];
            let capitalized = surface.chars().next().is_some_and(char::is_uppercase);
            match raw.kind {
                TokenKind::Word if raw.trailing_apostrophe => {
                    match self.resolve_apostrophe(surface) {
                        Some(key) => {
                            out.push(Prepared {
                                raw,
                                key,
                                capitalized,
                                sentence_start: at_start,
                            });
                            at_start = false;
                        }
                        None => {
                            // Virgolette: la parola e l'apostrofo diventano due token.
                            let apos = surface
                                .chars()
                                .last()
                                .map_or(1, |c| (c.len_utf8(), c.len_utf16()).0);
                            let apos16 = surface.chars().last().map_or(1, |c| c.len_utf16() as u32);
                            let mut word = raw.clone();
                            word.byte_end -= apos;
                            word.end16 -= apos16;
                            word.trailing_apostrophe = false;
                            let punct = RawToken {
                                byte_start: word.byte_end,
                                start16: word.end16,
                                kind: TokenKind::Punct,
                                trailing_apostrophe: false,
                                ..raw
                            };
                            let key = normalize_key(&text[word.byte_start..word.byte_end]);
                            out.push(Prepared {
                                raw: word,
                                key,
                                capitalized,
                                sentence_start: at_start,
                            });
                            out.push(Prepared {
                                raw: punct,
                                key: String::new(),
                                capitalized: false,
                                sentence_start: false,
                            });
                            at_start = false;
                        }
                    }
                }
                TokenKind::Word | TokenKind::Number => {
                    let key = normalize_key(surface);
                    out.push(Prepared {
                        raw,
                        key,
                        capitalized,
                        sentence_start: at_start,
                    });
                    at_start = false;
                }
                _ => {
                    if matches!(surface, "." | "!" | "?" | "…" | "...") {
                        at_start = true;
                    }
                    out.push(Prepared {
                        raw,
                        key: String::new(),
                        capitalized: false,
                        sentence_start: false,
                    });
                }
            }
        }
        out
    }

    // --- Fase 3: letture -------------------------------------------------------------

    fn lexicon_readings(&self, key: &str) -> Vec<Analysis> {
        self.morph
            .lookup(key)
            .into_iter()
            .map(|r| {
                analysis(
                    self.morph.lemma(r.lemma_id).unwrap_or(""),
                    r.cat,
                    r.feats,
                    ReadingSource::Lexicon,
                )
            })
            .collect()
    }

    /// Chiave ARASAAC esatta (SPEC.md, fase 3, punto 2).
    fn arasaac_readings(&self, key: &str) -> Vec<Analysis> {
        let entries = self.picto.lookup(key);
        if entries.is_empty() {
            return Vec::new();
        }
        let types = entries.iter().fold(0u8, |m, e| m | e.keyword_types);
        let plural_entry = entries
            .iter()
            .find(|e| e.has_flag(picto_flags::PLURAL_FORM));
        let all_plural = entries.iter().all(|e| e.has_flag(picto_flags::PLURAL_FORM));
        let lemma = match (all_plural, plural_entry) {
            (true, Some(e)) => self.picto.singular(e).unwrap_or(key).to_string(),
            _ => key.to_string(),
        };
        let (gender, number) = infer_gender_number(key, all_plural);
        let nominal = Feats {
            gender,
            number,
            ..Feats::default()
        };
        let src = ReadingSource::ArasaacKey;
        let mut out = Vec::new();
        if types & (1 << 1) != 0 {
            out.push(analysis(&lemma, Cat::Propn, Feats::default(), src));
        }
        if types & (1 << 2) != 0 {
            out.push(analysis(&lemma, Cat::Noun, nominal, src));
        }
        if types & (1 << 3) != 0 {
            let f = Feats {
                mood: Some(Mood::Inf),
                tense: Some(Tense::Pres),
                ..Feats::default()
            };
            out.push(analysis(key, Cat::Verb, f, src));
        }
        if types & (1 << 4) != 0 {
            let cat = if key.ends_with("mente") {
                Cat::Adv
            } else {
                Cat::Adj
            };
            out.push(analysis(&lemma, cat, nominal, src));
        }
        out
    }

    /// Refuso: una sola forma del lessico a distanza 1 (SPEC.md, fase 3, punto 3). La specifica
    /// chiede anche che sia "frequente", ma non abbiamo frequenze: si usano parole di almeno
    /// 5 lettere.
    fn typo_readings(&self, key: &str) -> (Vec<Analysis>, Option<String>) {
        if key.chars().count() < 5 || key.chars().count() > 24 {
            return (Vec::new(), None);
        }
        let near = self.morph.similar_forms(key, 1);
        match near.as_slice() {
            [only] => {
                let readings = self
                    .lexicon_readings(only)
                    .into_iter()
                    .map(|mut a| {
                        a.source = ReadingSource::Typo;
                        a
                    })
                    .collect();
                (readings, Some(only.clone()))
            }
            _ => (Vec::new(), None),
        }
    }

    // --- Fase 8: pittogramma ---------------------------------------------------------

    fn best_entry(entries: Vec<PictoEntry>) -> Option<PictoEntry> {
        // A parità di categoria: prima parola chiave, poi meno parole chiave (più specifico), poi id.
        entries.into_iter().max_by_key(|e| {
            (
                e.has_flag(picto_flags::FIRST_KEY),
                Reverse(e.n_keys),
                Reverse(e.id),
            )
        })
    }

    /// Il candidato è un plurale del lemma? Se Morph-it! lo conosce deve essere il plurale dello
    /// stesso lemma; se non lo conosce vale solo per i candidati non "stretti".
    fn plural_of(&self, candidate: &str, lemma_key: &str, strict: bool) -> bool {
        let readings = self.morph.lookup(candidate);
        if readings.is_empty() {
            return !strict;
        }
        readings.iter().any(|r| {
            r.feats.number == Some(Number::P) && self.morph.lemma(r.lemma_id) == Some(lemma_key)
        })
    }

    /// Catena di priorità dei livelli 5–8 (i livelli 1–4 arrivano con M6 e M8).
    fn choose_picto(&self, key: &str, a: &Analysis) -> Option<PictoChoice> {
        let lemma_key = normalize_key(&a.lemma);
        let blocked = |id: u32| self.curated.is_blocked(&[key, lemma_key.as_str()], id);
        // 5. pittogramma preferito per lemma e categoria
        if let Some(id) = self.curated.preferred(&lemma_key, a.cat) {
            if !blocked(id) {
                return Some(PictoChoice {
                    id,
                    reason: PictoReason::Curated,
                    penalty: 0.0,
                });
            }
        }
        // 6. indice ARASAAC: forma esatta, singolare, lemma; 7. stessa ricerca ignorando la categoria
        let plural_reading = a.feats.number == Some(Number::P);
        let singulars = if plural_reading {
            singular_candidates(key, a.feats.gender)
        } else {
            Vec::new()
        };
        // Solo per nomi e aggettivi al singolare (o senza numero).
        let plurals: Vec<String> = if !plural_reading && matches!(a.cat, Cat::Noun | Cat::Adj) {
            plural_candidates(&lemma_key, a.feats.gender)
                .into_iter()
                .filter(|(cand, strict)| self.plural_of(cand, &lemma_key, *strict))
                .map(|(cand, _)| cand)
                .collect()
        } else {
            Vec::new()
        };
        for ignore_category in [false, true] {
            let steps: [(PictoReason, Vec<&str>); 4] = [
                (PictoReason::ExactForm, vec![key]),
                (
                    PictoReason::Singular,
                    singulars.iter().map(String::as_str).collect(),
                ),
                (PictoReason::Lemma, vec![lemma_key.as_str()]),
                (
                    PictoReason::PluralForm,
                    plurals.iter().map(String::as_str).collect(),
                ),
            ];
            for (reason, keys) in steps {
                for k in keys {
                    let entries: Vec<PictoEntry> = self
                        .picto
                        .lookup(k)
                        .into_iter()
                        .filter(|e| !blocked(e.id) && (ignore_category || compatible(a.cat, e)))
                        .collect();
                    if let Some(best) = Self::best_entry(entries) {
                        return Some(if ignore_category {
                            PictoChoice {
                                id: best.id,
                                reason: PictoReason::IgnoringCategory,
                                penalty: 0.2,
                            }
                        } else {
                            PictoChoice {
                                id: best.id,
                                reason,
                                penalty: 0.0,
                            }
                        });
                    }
                }
            }
        }
        None
    }

    fn number_picto(&self, text: &str, a: &Analysis) -> Option<PictoChoice> {
        if let Some(c) = self.choose_picto(text, a) {
            return Some(c);
        }
        let word = number_word(text)?;
        let as_word = analysis(word, Cat::Num, Feats::default(), ReadingSource::Literal);
        self.choose_picto(word, &as_word).map(|c| PictoChoice {
            reason: PictoReason::NumberWord,
            ..c
        })
    }

    // --- Token -----------------------------------------------------------------------

    fn token_for(&self, p: Prepared, surface: String) -> Token {
        let span_utf16 = (p.raw.start16, p.raw.end16);
        let base = |kind, reason, display, confidence| Token {
            span_utf16,
            surface: surface.clone(),
            kind,
            analysis: None,
            readings: Vec::new(),
            corrected: None,
            group: None,
            picto: None,
            modifiers: Modifiers::default(),
            display,
            confidence,
            alternatives: Vec::new(),
            reason: Reason {
                reading: reason,
                picto: PictoReason::NoSymbol,
            },
        };
        match p.raw.kind {
            TokenKind::Punct | TokenKind::Symbol => base(
                p.raw.kind,
                ReadingReason::Punctuation,
                Display::TextOnly,
                1.0,
            ),
            TokenKind::Number => {
                let a = analysis(&p.key, Cat::Num, Feats::default(), ReadingSource::Literal);
                let choice = self.number_picto(&p.key, &a);
                let mut t = base(
                    TokenKind::Number,
                    ReadingReason::Literal,
                    Display::TextOnly,
                    1.0,
                );
                if let Some(c) = choice {
                    t.picto = Some(PictoRef { id: c.id });
                    t.display = Display::Full;
                    t.reason.picto = c.reason;
                    t.confidence = 1.0 - c.penalty;
                }
                t.readings = vec![a.clone()];
                t.analysis = Some(a);
                t
            }
            _ => self.word_token(&p, &surface, base),
        }
    }

    fn word_token(
        &self,
        p: &Prepared,
        surface: &str,
        base: impl Fn(TokenKind, ReadingReason, Display, f32) -> Token,
    ) -> Token {
        let key = &p.key;
        // I prefissi elisi si risolvono con la tabella della specifica, non con Morph-it!.
        let mut readings = match elision_reading(key) {
            Some(a) => vec![a],
            None => self.lexicon_readings(key),
        };
        let lexical = !readings.is_empty();
        if p.capitalized && (!lexical || !p.sentence_start) {
            // Maiuscola: nome proprio (anche a inizio frase se la parola è sconosciuta).
            readings.push(analysis(
                surface,
                Cat::Propn,
                Feats::default(),
                ReadingSource::Capital,
            ));
        }
        if !lexical {
            readings.extend(self.arasaac_readings(key));
        }
        let mut corrected = None;
        if readings.is_empty() {
            let (typo, fixed) = self.typo_readings(key);
            readings = typo;
            corrected = fixed;
        }
        if readings.is_empty() {
            readings = suffix_readings(key);
        }
        if readings.is_empty() {
            let mut t = base(
                TokenKind::Unknown,
                ReadingReason::NoReading,
                Display::TextOnly,
                0.0,
            );
            t.reason.picto = PictoReason::NoSymbol;
            return t;
        }

        // Scelta provvisoria (M4): prima le letture che portano a un pittogramma della categoria
        // giusta, poi senza categoria, poi nessuna; a parità, priorità fissa per categoria.
        let scored: Vec<Option<PictoChoice>> =
            readings.iter().map(|a| self.choose_picto(key, a)).collect();
        let capital_mid = p.capitalized && !p.sentence_start;
        let best = (0..readings.len())
            .min_by_key(|&i| {
                // Maiuscola a metà frase: il nome proprio vince su tutto (regola provvisoria di M4,
                // la fase 7 la tratterà come un bonus).
                let capital_first = !(capital_mid && readings[i].source == ReadingSource::Capital);
                let level = match &scored[i] {
                    Some(c) if c.penalty == 0.0 => 0,
                    Some(_) => 1,
                    None => 2,
                };
                (capital_first, level, category_rank(readings[i].cat), i)
            })
            .unwrap_or(0);

        let chosen = readings[best].clone();
        let choice = scored.into_iter().nth(best).flatten();
        let reading_reason = match chosen.source {
            ReadingSource::Capital => ReadingReason::Capital,
            ReadingSource::ArasaacKey => ReadingReason::ArasaacKey,
            ReadingSource::Typo => ReadingReason::Typo,
            ReadingSource::SuffixGuess => ReadingReason::SuffixGuess,
            _ if readings.len() == 1 => ReadingReason::OnlyReading,
            _ => ReadingReason::BaselinePick,
        };
        // Confidenza provvisoria (M4): la fase 7 la sostituisce con la probabilità a posteriori.
        let mut confidence: f32 = match chosen.source {
            ReadingSource::ArasaacKey => 0.7,
            ReadingSource::Typo => 0.4,
            ReadingSource::SuffixGuess => 0.3,
            ReadingSource::Capital if readings.len() == 1 => 0.8,
            _ if readings.len() == 1 => 1.0,
            _ => 0.5,
        };
        let mut t = base(
            TokenKind::Word,
            reading_reason,
            Display::TextOnly,
            confidence,
        );
        if let Some(c) = choice {
            t.picto = Some(PictoRef { id: c.id });
            t.display = Display::Full;
            t.reason.picto = c.reason;
            confidence = (confidence - c.penalty).max(0.0);
        }
        t.confidence = confidence;
        t.analysis = Some(chosen);
        t.readings = readings;
        t.corrected = corrected;
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn genere_e_numero_dal_suffisso() {
        assert_eq!(
            infer_gender_number("gatto", false),
            (Some(Gender::M), Some(Number::S))
        );
        assert_eq!(
            infer_gender_number("casa", false),
            (Some(Gender::F), Some(Number::S))
        );
        assert_eq!(infer_gender_number("gatti", false), (None, Some(Number::P)));
        assert_eq!(infer_gender_number("madre", false), (None, None)); // -e ambiguo
        assert_eq!(infer_gender_number("api", true), (None, Some(Number::P)));
    }

    #[test]
    fn singolari_candidati() {
        assert_eq!(
            singular_candidates("maestre", Some(Gender::F))[0],
            "maestra"
        );
        assert_eq!(
            singular_candidates("maestri", Some(Gender::M))[0],
            "maestro"
        );
        let amiche = singular_candidates("amiche", Some(Gender::F));
        assert_eq!(amiche[0], "amica");
        assert!(singular_candidates("negozi", None).contains(&"negozio".to_string()));
        assert!(singular_candidates("o", None).is_empty());
    }

    #[test]
    fn tabella_dei_prefissi_elisi() {
        let r = elision_reading("nell'").unwrap();
        assert_eq!((r.lemma.as_str(), r.cat), ("in", Cat::ArtAdp));
        assert_eq!(elision_reading("c'").unwrap().lemma, "ci");
        assert_eq!(elision_reading("un'").unwrap().cat, Cat::Art);
        assert!(elision_reading("po'").is_none() && elision_reading("nell").is_none());
        // La tabella e l'elenco dei prefissi elisi del tokenizzatore coincidono.
        let mut table: Vec<&str> = ELISION_TABLE.iter().map(|(p, _, _)| *p).collect();
        let mut known: Vec<&str> = crate::norm::ELIDED_PREFIXES.to_vec();
        table.sort_unstable();
        known.sort_unstable();
        assert_eq!(table, known);
    }

    #[test]
    fn plurali_candidati() {
        let names = |k: &str, g| -> Vec<String> {
            plural_candidates(k, g)
                .into_iter()
                .map(|(c, _)| c)
                .collect()
        };
        assert_eq!(names("pastello", Some(Gender::M))[0], "pastelli");
        assert_eq!(names("sasso", None)[0], "sassi");
        assert_eq!(names("mela", Some(Gender::F))[0], "mele");
        let amico = names("amico", None);
        assert!(amico.contains(&"amici".to_string()) && amico.contains(&"amichi".to_string()));
        assert!(names("o", None).is_empty());
        // Irregolari: tutti "stretti" (si accettano solo se Morph-it! li conferma).
        let strict = |k: &str, c: &str| plural_candidates(k, None).contains(&(c.to_string(), true));
        assert!(
            strict("labbro", "labbra") && strict("braccio", "braccia") && strict("uomo", "uomini")
        );
        assert!(strict("dio", "dei") && strict("bue", "buoi") && strict("ala", "ali"));
        // I regolari non lo sono.
        assert!(plural_candidates("pasto", None).contains(&("pasti".to_string(), false)));
    }

    #[test]
    fn numeri_in_lettere() {
        assert_eq!(number_word("3"), Some("tre"));
        assert_eq!(number_word("20"), Some("venti"));
        assert_eq!(number_word("1000"), Some("mille"));
        assert_eq!(number_word("37"), None);
        assert_eq!(number_word("8:30"), None);
    }

    #[test]
    fn indovino_per_suffisso() {
        let cat = |k: &str| suffix_readings(k).first().map(|a| a.cat);
        assert_eq!(cat("lentamente"), Some(Cat::Adv));
        assert_eq!(cat("organizzazione"), Some(Cat::Noun));
        assert_eq!(cat("serenità"), Some(Cat::Noun));
        assert_eq!(cat("scaccolare"), Some(Cat::Verb));
        assert_eq!(cat("grigliando"), Some(Cat::Verb));
        assert_eq!(cat("grigliato"), Some(Cat::Verb));
        assert_eq!(cat("xyz"), None);
        let part = &suffix_readings("grigliato")[0];
        assert_eq!(part.feats.mood, Some(Mood::Part));
    }

    #[test]
    fn categorie_compatibili_con_i_tipi_arasaac() {
        let entry = |types: u8| PictoEntry {
            id: 1,
            keyword_types: types,
            flags: 0,
            n_keys: 1,
            singular: 0,
        };
        assert!(compatible(Cat::Noun, &entry(1 << 2)));
        assert!(!compatible(Cat::Noun, &entry(1 << 3)));
        assert!(compatible(Cat::Verb, &entry(1 << 3)));
        assert!(compatible(Cat::Adv, &entry(1 << 4)));
        assert!(compatible(Cat::Noun, &entry(1))); // senza tipo: compatibile con tutto
        assert!(compatible(Cat::Art, &entry(1 << 6)));
    }

    #[test]
    fn descrizione_della_ragione() {
        let r = Reason {
            reading: ReadingReason::BaselinePick,
            picto: PictoReason::ExactForm,
        };
        assert_eq!(
            r.to_string(),
            "scelta provvisoria fra più letture; pittogramma della forma esatta"
        );
    }
}
