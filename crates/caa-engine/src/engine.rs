//! Motore di simbolizzazione, fasi 1–3 e 8 (M4): da un paragrafo a una lista di token con
//! letture e pittogramma. **Senza contesto**: la scelta fra più letture usa una regola fissa e
//! provvisoria (`BaselinePick`) che la fase 7 (M5) sostituirà con la decodifica sulla frase.
//!
//! Il motore è puro: riceve lessico e file curati già caricati, non tocca disco né rete.

use std::cmp::Reverse;
use std::fmt;

use crate::curated::Curated;
use crate::groups::{
    reflexive_agrees, reflexive_agrees_view, tense_mark, verbal_groups, Tense3, VerbalKind, View,
};
use crate::lexicon::{picto_flags, MorphLexicon, PictoEntry, PictoIndex};
use crate::mwe::MweIndex;
use crate::norm::normalize_key;
use crate::tagger::Tagger;
use crate::tokenize::{tokenize, RawToken, TokenKind};
use crate::types::{Cat, Feats, Gender, Mood, Number, Tense};
use crate::viterbi::{decode, Node, Weights};

// ---------------------------------------------------------------------------------------
// Contratto (SPEC.md, "Contratto (Rust)")
// ---------------------------------------------------------------------------------------

/// Cosa si mostra di una categoria di parole funzionali (SPEC.md, fase 10).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FunctionRule {
    /// Il simbolo come lo ha scelto il motore (senza simbolo resta solo testo).
    Full,
    /// Simbolo piccolo (solo articoli).
    Reduced,
    /// Solo la parola, senza simbolo.
    TextOnly,
    /// La parola resta nel testo ma senza simbolo e attenuata.
    Hidden,
}

/// La tabella per categoria del preset "Personalizzato" (SPEC.md, fase 10). Ausiliari nei tempi
/// composti, riflessivi e punteggiatura non si configurano: hanno regole fisse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PolicyTable {
    pub articles: FunctionRule,
    /// Clitici non riflessivi.
    pub clitics: FunctionRule,
    /// "che" relativo o congiunzione.
    pub che: FunctionRule,
    /// Preposizioni semplici e articolate ("nella" mostra "in").
    pub prepositions: FunctionRule,
    pub conjunctions: FunctionRule,
}

impl PolicyTable {
    /// Articoli ridotti, clitici col simbolo del pronome, "che" come testo.
    pub fn complete() -> Self {
        PolicyTable {
            articles: FunctionRule::Reduced,
            clitics: FunctionRule::Full,
            che: FunctionRule::TextOnly,
            prepositions: FunctionRule::Full,
            conjunctions: FunctionRule::Full,
        }
    }

    /// Articoli, clitici non riflessivi e "che" nascosti.
    pub fn essential() -> Self {
        PolicyTable {
            articles: FunctionRule::Hidden,
            clitics: FunctionRule::Hidden,
            che: FunctionRule::Hidden,
            prepositions: FunctionRule::Full,
            conjunctions: FunctionRule::Full,
        }
    }

    /// Riporta le scelte senza senso a quelle vicine: il simbolo ridotto vale solo per gli articoli
    /// e preposizioni e congiunzioni portano significato (SPEC.md), quindi non si nascondono.
    pub fn normalized(self) -> Self {
        use FunctionRule::*;
        let no_reduced = |r: FunctionRule| if r == Reduced { Full } else { r };
        let no_hidden = |r: FunctionRule| match r {
            Reduced => Full,
            Hidden => TextOnly,
            r => r,
        };
        PolicyTable {
            articles: self.articles,
            clitics: no_reduced(self.clitics),
            che: no_reduced(self.che),
            prepositions: no_hidden(self.prepositions),
            conjunctions: no_hidden(self.conjunctions),
        }
    }
}

/// Politica delle parole funzionali (SPEC.md, fase 10): cosa si mostra di articoli, clitici non
/// riflessivi, "che", preposizioni e congiunzioni.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FunctionPolicy {
    /// Articoli con simbolo ridotto, clitici con il simbolo del pronome, "che" come solo testo.
    #[default]
    Complete,
    /// Articoli, clitici non riflessivi e "che" nascosti.
    Essential,
    /// La tabella del docente.
    Custom(PolicyTable),
}

impl FunctionPolicy {
    /// La tabella che il motore applica (normalizzata).
    pub fn table(self) -> PolicyTable {
        match self {
            FunctionPolicy::Complete => PolicyTable::complete(),
            FunctionPolicy::Essential => PolicyTable::essential(),
            FunctionPolicy::Custom(t) => t.normalized(),
        }
    }
}

/// Preferenze del documento (la politica e, più avanti, la tabella personalizzata).
#[derive(Debug, Clone, Default)]
pub struct DocPrefs {
    pub function_policy: FunctionPolicy,
}

/// Scelta esplicita del docente su un intervallo di testo (la usa la fase 8, M8).
#[derive(Debug, Clone)]
pub struct ForcedPick {
    /// Intervallo di UN token (come lo restituisce il motore).
    pub span_utf16: (u32, u32),
    /// Pittogramma scelto; 0 = nessun simbolo.
    pub picto: u32,
}

/// Lemma → pittogramma già scelto nel documento (blocco di senso, SPEC.md fase 8, livello 2): se il
/// docente ha scelto "pesca" = frutto, tutte le altre "pesca" (stessa categoria) prendono lo stesso.
#[derive(Debug, Clone, Default)]
pub struct SenseLocks {
    locks: std::collections::HashMap<(String, Cat), u32>,
}

impl SenseLocks {
    /// Blocca un lemma (come lo scrive Morph-it!, anche con maiuscole) e una categoria su un pittogramma.
    pub fn insert(&mut self, lemma: &str, cat: Cat, picto: u32) {
        self.locks.insert((normalize_key(lemma), cat), picto);
    }

    pub fn get(&self, lemma: &str, cat: Cat) -> Option<u32> {
        self.locks.get(&(normalize_key(lemma), cat)).copied()
    }

    pub fn is_empty(&self) -> bool {
        self.locks.is_empty()
    }
}

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
    pub kind: GroupKind,
    pub role: GroupRole,
}

/// Che tipo di gruppo (estensione del contratto: la specifica ha solo l'identificativo).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupKind {
    /// avere/essere + participio, passivo.
    Compound,
    /// stare + gerundio.
    Progressive,
    /// Verbo con il suo pronome riflessivo ("mi lavo" = lavarsi).
    Pronominal,
    /// Espressione multiparola di ARASAAC.
    Multiword,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupRole {
    /// Porta il pittogramma e i segni.
    Head,
    Member,
}

/// Alternativa del menu (fase 10, M8).
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub picto: PictoRef,
    /// Parola chiave con cui si è trovato il pittogramma ("portare").
    pub keyword: String,
    /// Perché è fra le alternative ("altra lettura: nome", "altro senso di «pane»").
    pub reason: String,
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
    /// Verbo con clitici attaccati, scomposto dal motore ("portamelo").
    Enclitic,
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
    /// Scelta fra più letture con il tagger sulla frase (M5).
    Tagger,
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
    /// Verbo pronominale: "lavarsi" per "mi lavo".
    Pronominal,
    /// Espressione multiparola di ARASAAC ("far colazione", "ferro da stiro").
    Multiword,
    /// Scelta esplicita del docente su questa parola (livello 1).
    Teacher,
    /// Blocco di senso del documento (livello 2).
    SenseLock,
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
            PictoReason::Pronominal => "verbo pronominale",
            PictoReason::Multiword => "espressione multiparola",
            PictoReason::Teacher => "scelta del docente",
            PictoReason::SenseLock => "stesso senso di tutto il testo",
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
            ReadingReason::Tagger => "scelta del tagger sulla frase",
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
            PictoReason::Pronominal => "pittogramma del verbo pronominale",
            PictoReason::Multiword => "pittogramma dell'espressione multiparola",
            PictoReason::Teacher => "pittogramma scelto dal docente",
            PictoReason::SenseLock => "pittogramma scelto per tutto il testo",
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

/// Livelli 1 e 2 della scelta del pittogramma (SPEC.md, fase 8): la scelta esplicita del docente su un
/// token vince su tutto, poi il blocco di senso per lemma e categoria. Il pittogramma 0 della scelta
/// del docente vuol dire "nessun simbolo". Non tocca le parole nascoste.
fn apply_choices(tokens: &mut [Token], locks: &SenseLocks, forced: &[ForcedPick]) {
    for t in tokens.iter_mut() {
        // Anche le parole sconosciute: sono proprio quelle per cui il docente sceglie a mano.
        if !matches!(
            t.kind,
            TokenKind::Word | TokenKind::Number | TokenKind::Unknown
        ) {
            continue;
        }
        if let Some(f) = forced.iter().find(|f| f.span_utf16 == t.span_utf16) {
            t.confidence = 1.0;
            t.reason.picto = PictoReason::Teacher;
            // Un membro di un gruppo (ausiliare di "ho mangiato", parte di una multiparola) resta
            // nascosto: il suo simbolo sta sulla testa. Una parola nascosta solo dalla politica
            // (articoli in "Essenziale") invece si mostra: l'intervento del docente vince.
            let member = t.group.is_some_and(|g| g.role == GroupRole::Member);
            if f.picto == 0 {
                t.picto = None;
                if !member {
                    t.display = Display::TextOnly;
                }
            } else {
                t.picto = Some(PictoRef { id: f.picto });
                if !member {
                    t.display = Display::Full;
                }
            }
            continue;
        }
        if locks.is_empty() || t.display == Display::Hidden {
            continue;
        }
        let Some(a) = &t.analysis else { continue };
        if let Some(id) = locks.get(&a.lemma, a.cat) {
            // Il docente ha deciso il senso per tutto il testo: la parola non e' piu' da controllare.
            t.confidence = 1.0;
            if t.picto.map(|p| p.id) != Some(id) {
                t.picto = Some(PictoRef { id });
                t.display = Display::Full;
                t.reason.picto = PictoReason::SenseLock;
            }
        }
    }
}

/// Fase 10: cosa si mostra delle parole funzionali. Non tocca i token dei gruppi (ausiliari e
/// membri sono già nascosti, la testa resta visibile) né quelli senza pittogramma.
fn apply_policy(tokens: &mut [Token], prefs: &DocPrefs) {
    let table = prefs.function_policy.table();
    for t in tokens.iter_mut() {
        let Some(a) = &t.analysis else { continue };
        if t.group.is_some() || t.display == Display::Hidden || t.kind != TokenKind::Word {
            continue;
        }
        let rule = if normalize_key(&a.lemma) == "che" {
            table.che
        } else {
            match a.cat {
                Cat::Art => table.articles,
                Cat::Clitic => table.clitics,
                Cat::Adp | Cat::ArtAdp => table.prepositions,
                Cat::Conj => table.conjunctions,
                _ => continue,
            }
        };
        t.display = match rule {
            FunctionRule::Full => t.display,
            FunctionRule::Reduced if t.picto.is_some() => Display::Reduced,
            FunctionRule::Reduced => t.display,
            FunctionRule::TextOnly => Display::TextOnly,
            FunctionRule::Hidden => Display::Hidden,
        };
    }
}

/// Preposizione semplice di una preposizione articolata, dal lemma di Morph-it! ("nella" → "in",
/// "dall'" → "da", "col" → "con").
fn articulated_base(lemma: &str) -> Option<&'static str> {
    Some(match lemma {
        "al" | "alla" | "all'" => "a",
        "col" => "con",
        "dal" | "dalla" | "dall'" => "da",
        "del" | "della" | "dell'" => "di",
        "nel" | "nella" | "nell'" => "in",
        "sul" | "sulla" | "sull'" => "su",
        _ => return None,
    })
}

/// "essere" alla terza persona nella lettura scelta o in un'altra (sono = 1a sing. o 3a plur.).
fn third_person(v: &View) -> bool {
    v.feats.person == Some(3) || v.alts.iter().any(|f| f.person == Some(3))
}

/// Il clitico attaccato (mi/ti/ci/vi) concorda in persona e numero con la forma verbale.
fn attached_reflexive_agrees(piece: &str, verb: &Feats) -> bool {
    let clitic = View {
        word: true,
        cat: Cat::Clitic,
        lemma: piece.to_string(),
        feats: Feats::default(),
        key: piece.to_string(),
        also_adjective: false,
        alts: Vec::new(),
    };
    reflexive_agrees(&clitic, verb)
}

/// Il token successivo è una parola che comincia con la maiuscola (dopo ":" ricomincia una frase).
fn starts_capitalized(text: &str, next: Option<&RawToken>) -> bool {
    next.is_some_and(|t| {
        t.kind == TokenKind::Word
            && text[t.byte_start..t.byte_end]
                .chars()
                .next()
                .is_some_and(char::is_uppercase)
    })
}

/// "lavare" → "lavarsi" (infinito senza -e più "si"; "condurre" → "condursi").
pub fn pronominal_lemma(lemma: &str) -> Option<String> {
    let lemma = normalize_key(lemma);
    let stem = if lemma.ends_with("rre") {
        lemma.strip_suffix("re")?
    } else if lemma.ends_with("are") || lemma.ends_with("ere") || lemma.ends_with("ire") {
        lemma.strip_suffix('e')?
    } else {
        return None;
    };
    Some(format!("{stem}si"))
}

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
    /// Chiave con cui si è trovato (serve a sapere se il pittogramma è già plurale).
    matched: String,
    /// Il pittogramma è stato trovato con un plurale derivato da ARASAAC ("maestre" per
    /// "maestra"): l'immagine resta quella del singolare.
    derived_plural: bool,
}

pub struct Engine<D: AsRef<[u8]>> {
    morph: MorphLexicon<D>,
    picto: PictoIndex<D>,
    curated: Curated,
    tagger: Option<Tagger<D>>,
    mwe: Option<MweIndex<D>>,
    weights: Weights,
}

impl<D: AsRef<[u8]>> Engine<D> {
    pub fn new(morph: MorphLexicon<D>, picto: PictoIndex<D>, curated: Curated) -> Self {
        Engine {
            morph,
            picto,
            curated,
            tagger: None,
            mwe: None,
            weights: Weights::default(),
        }
    }

    /// Aggiunge il tagger statistico (senza, vale la scelta provvisoria di M4).
    pub fn with_tagger(mut self, tagger: Tagger<D>) -> Self {
        self.tagger = Some(tagger);
        self
    }

    /// Aggiunge l'indice delle espressioni multiparola (senza, la fase 6 non fa nulla).
    pub fn with_mwe(mut self, mwe: MweIndex<D>) -> Self {
        self.mwe = Some(mwe);
        self
    }

    pub fn mwe(&self) -> Option<&MweIndex<D>> {
        self.mwe.as_ref()
    }

    /// Cambia i pesi delle regole (serve alla taratura di `caa-eval`).
    pub fn with_weights(mut self, weights: Weights) -> Self {
        self.weights = weights;
        self
    }

    pub fn set_weights(&mut self, weights: Weights) {
        self.weights = weights;
    }

    pub fn weights(&self) -> &Weights {
        &self.weights
    }

    pub fn tagger(&self) -> Option<&Tagger<D>> {
        self.tagger.as_ref()
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
        let surfaces: Vec<String> = prepared
            .iter()
            .map(|p| req.text[p.raw.byte_start..p.raw.byte_end].to_string())
            .collect();
        let mut slots: Vec<Slot> = prepared
            .iter()
            .zip(&surfaces)
            .map(|(p, surface)| self.slot_for(p, surface))
            .collect();
        // ":" seguito da una parola con la maiuscola chiude la frase anche per il tagger.
        for i in 0..slots.len().saturating_sub(1) {
            if surfaces[i] == ":"
                && prepared[i + 1].capitalized
                && prepared[i + 1].raw.kind == TokenKind::Word
            {
                slots[i].terminator = true;
            }
        }
        self.decide(&prepared, &mut slots);
        let mut tokens: Vec<Token> = prepared
            .iter()
            .zip(slots)
            .zip(surfaces)
            .map(|((p, slot), surface)| self.finish(p, surface, slot))
            .collect();
        self.apply_groups(&mut tokens);
        self.apply_multiword(&mut tokens);
        apply_policy(&mut tokens, req.prefs);
        apply_choices(&mut tokens, req.sense_locks, req.forced);
        tokens
    }

    /// Le alternative al pittogramma scelto per il token che occupa `span_utf16` (fino a 8, senza
    /// doppioni e senza i bloccati): prima gli altri pittogrammi delle altre letture, poi gli altri
    /// sensi della stessa parola. Si calcolano a richiesta (il menu) e non per ogni token.
    pub fn alternatives(&self, req: &Request, span_utf16: (u32, u32)) -> Vec<Candidate> {
        let tokens = self.symbolize(req);
        let Some(t) = tokens.iter().find(|t| t.span_utf16 == span_utf16) else {
            return Vec::new();
        };
        self.alternatives_of(t)
    }

    /// Ricerca libera di un pittogramma ("Cerca…" nel menu): per parola chiave esatta, poi per
    /// prefisso. Se non trova nulla prova i lemmi della parola ("mele" → "mela"). Non applica la
    /// lista dei bloccati: il docente cerca apposta.
    pub fn search_pictos(&self, query: &str, limit: usize) -> Vec<Candidate> {
        let q = normalize_key(query);
        let mut out: Vec<Candidate> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut run = |key: &str, out: &mut Vec<Candidate>| {
            for (k, e) in self.picto.search(key, limit.saturating_mul(3)) {
                if out.len() < limit && seen.insert(e.id) {
                    out.push(Candidate {
                        picto: PictoRef { id: e.id },
                        reason: format!("cercato «{query}»"),
                        keyword: k,
                    });
                }
            }
        };
        run(&q, &mut out);
        if out.is_empty() {
            for r in self.morph.lookup(&q) {
                if let Some(l) = self.morph.lemma(r.lemma_id) {
                    run(&normalize_key(l), &mut out);
                }
            }
        }
        out
    }

    /// Le alternative di un token già calcolato (senza rifare la simbolizzazione).
    pub fn alternatives_of_token(&self, t: &Token) -> Vec<Candidate> {
        self.alternatives_of(t)
    }

    fn alternatives_of(&self, t: &Token) -> Vec<Candidate> {
        const MAX: usize = 8;
        let Some(chosen) = &t.analysis else {
            return Vec::new();
        };
        let key = normalize_key(&t.surface);
        let lemma_key = normalize_key(&chosen.lemma);
        let blocked = |id: u32| {
            self.curated
                .is_blocked(&[key.as_str(), lemma_key.as_str()], id)
        };
        let mut seen: std::collections::HashSet<u32> = t.picto.map(|p| p.id).into_iter().collect();
        let mut out: Vec<Candidate> = Vec::new();
        let mut push = |id: u32, keyword: &str, reason: String| {
            if out.len() < MAX && !blocked(id) && seen.insert(id) {
                out.push(Candidate {
                    picto: PictoRef { id },
                    keyword: keyword.to_string(),
                    reason,
                });
            }
        };
        // 1. Le altre letture (altra categoria o altro lemma) con il loro pittogramma.
        for r in &t.readings {
            if r.cat == chosen.cat && r.lemma == chosen.lemma {
                continue;
            }
            if let Some(c) = self.choose_picto(&key, r) {
                let kw = normalize_key(&r.lemma);
                push(
                    c.id,
                    &kw,
                    format!("altra lettura: {} ({})", r.lemma, r.cat.name()),
                );
            }
        }
        // 2. Gli altri sensi della stessa parola: i pittogrammi della forma e del lemma, quelli della
        // stessa categoria per primi, poi la prima parola chiave, poi i meno ambigui.
        let mut keys = vec![key.clone()];
        if lemma_key != key {
            keys.push(lemma_key.clone());
        }
        for k in keys {
            let mut entries = self.picto.lookup(&k);
            entries.sort_by_key(|e| {
                (
                    !compatible(chosen.cat, e),
                    !e.has_flag(picto_flags::FIRST_KEY),
                    e.n_keys,
                    e.id,
                )
            });
            for e in entries {
                push(e.id, &k, format!("altro senso di «{k}»"));
            }
        }
        out
    }

    /// Fase 6: espressioni multiparola. Si cammina sulle unità (parole e gruppi verbali, senza gli
    /// ausiliari già raggruppati) cercando la sequenza di lemmi più lunga che sia una parola
    /// chiave ARASAAC. Un'unità sicura (confidenza almeno 0,6) conta solo con il lemma scelto dal
    /// contesto; una incerta con tutti i suoi lemmi possibili (è l'ipotesi con bonus della
    /// specifica, nella versione semplice: il contesto la fa perdere solo se è sicuro).
    fn apply_multiword(&self, tokens: &mut [Token]) {
        let Some(mwe) = &self.mwe else { return };
        struct Unit {
            tokens: Vec<usize>,
            head: usize,
            lemmas: Vec<String>,
            key: String,
        }
        let mut units: Vec<Option<Unit>> = Vec::new(); // None = confine (punteggiatura, ignoto)
        for i in 0..tokens.len() {
            let t = &tokens[i];
            let (Some(a), TokenKind::Word) = (&t.analysis, t.kind) else {
                units.push(None);
                continue;
            };
            let group = t.group;
            if group.is_some_and(|g| g.role == GroupRole::Member) {
                continue;
            }
            let key = normalize_key(&t.surface);
            let mut members: Vec<usize> = match group {
                Some(g) => (0..tokens.len())
                    .filter(|&j| tokens[j].group.is_some_and(|x| x.id == g.id))
                    .collect(),
                None => vec![i],
            };
            members.sort_unstable();
            let mut lemmas = self.lemma_set(&key);
            let plain = normalize_key(&a.lemma);
            // Un verbo pronominale ("mi lavo") prova prima "lavarsi" se ARASAAC lo ha, poi "lavare";
            // senza "mettersi" in ARASAAC resta "mettere" ("si mette le scarpe" = "mettere le scarpe").
            let pronominal = if group.is_some_and(|g| g.kind == GroupKind::Pronominal) {
                pronominal_lemma(&a.lemma).filter(|p| self.picto_for_key(p).is_some())
            } else {
                None
            };
            let mut preferred: Vec<String> = pronominal.into_iter().collect();
            preferred.push(plain.clone());
            for l in preferred.iter().rev() {
                if !lemmas.contains(l) {
                    lemmas.insert(0, l.clone());
                }
            }
            if t.confidence >= 0.6 {
                lemmas = preferred;
            } else {
                lemmas.sort_by_key(|l| preferred.iter().position(|p| p == l).unwrap_or(usize::MAX));
            }
            units.push(Some(Unit {
                tokens: members,
                head: i,
                lemmas,
                key,
            }));
        }
        let mut s = 0;
        while s < units.len() {
            let Some(first) = &units[s] else {
                s += 1;
                continue;
            };
            let _ = first;
            let span_max = units[s..]
                .iter()
                .take(crate::mwe::MAX_WORDS)
                .take_while(|u| u.is_some())
                .count();
            let mut applied = false;
            for len in (2..=span_max).rev() {
                let sets: Vec<&Vec<String>> = units[s..s + len]
                    .iter()
                    .map(|u| {
                        u.as_ref()
                            .map(|u| &u.lemmas)
                            .unwrap_or_else(|| unreachable!())
                    })
                    .collect();
                // Combinazioni di lemmi, al massimo 64.
                let mut combos: Vec<Vec<&str>> = vec![Vec::new()];
                for set in &sets {
                    let mut next = Vec::new();
                    'outer: for prefix in &combos {
                        for l in set.iter() {
                            let mut p = prefix.clone();
                            p.push(l.as_str());
                            next.push(p);
                            if next.len() >= 64 {
                                break 'outer;
                            }
                        }
                    }
                    combos = next;
                }
                let surfaces: Vec<&str> = units[s..s + len]
                    .iter()
                    .flatten()
                    .map(|u| u.key.as_str())
                    .collect();
                let mut best: Option<(crate::mwe::MweRecord, usize)> = None;
                for combo in &combos {
                    for rec in mwe.lookup(&combo.join(" ")) {
                        if self.curated.is_blocked(&[rec.key.as_str()], rec.picto) {
                            continue;
                        }
                        let words = crate::mwe::key_pieces(&rec.key).unwrap_or_default();
                        if words.len() != len {
                            continue;
                        }
                        let exact = words.iter().zip(&surfaces).filter(|(w, k)| w == k).count();
                        let rank = |r: &crate::mwe::MweRecord, e: usize| {
                            (
                                Reverse(e),
                                r.flags & picto_flags::FIRST_KEY == 0,
                                r.n_keys,
                                r.picto,
                            )
                        };
                        if best
                            .as_ref()
                            .is_none_or(|(b, be)| rank(&rec, exact) < rank(b, *be))
                        {
                            best = Some((rec, exact));
                        }
                    }
                }
                let Some((rec, _)) = best else { continue };
                // "le tre" è anche l'ora (ARASAAC), ma articolo + numero davanti a un nome
                // ("le tre mele") non lo è: l'espressione non si forma.
                let cat_of = |i: usize| tokens[i].analysis.as_ref().map(|a| a.cat);
                let first_cat = units[s].as_ref().and_then(|u| cat_of(u.head));
                let last_cat = units[s + len - 1].as_ref().and_then(|u| cat_of(u.head));
                let after = units[s + len - 1]
                    .as_ref()
                    .and_then(|u| u.tokens.last())
                    .and_then(|&i| tokens.get(i + 1))
                    .and_then(|t| t.analysis.as_ref())
                    .map(|a| a.cat);
                if matches!(first_cat, Some(Cat::Art | Cat::Det))
                    && last_cat == Some(Cat::Num)
                    && matches!(after, Some(Cat::Noun | Cat::Adj))
                {
                    continue;
                }
                let words = crate::mwe::key_pieces(&rec.key).unwrap_or_default();
                let group_id = tokens
                    .iter()
                    .filter_map(|t| t.group.map(|g| g.id))
                    .max()
                    .unwrap_or(0)
                    + 1;
                let span: Vec<usize> = units[s..s + len]
                    .iter()
                    .flatten()
                    .flat_map(|u| u.tokens.iter().copied())
                    .collect();
                let head = units[s].as_ref().map_or(0, |u| u.head);
                // Segni: il tempo del verbo dell'espressione e il plurale di un nome che il
                // pittogramma (singolare) non mostra.
                let mut flags = 0u8;
                let mut confidence: f32 = 1.0;
                for (p, u) in units[s..s + len].iter().flatten().enumerate() {
                    let t = &tokens[u.head];
                    flags |= t.modifiers.0 & (Modifiers::PAST | Modifiers::FUTURE);
                    confidence = confidence.min(t.confidence);
                    let plural_noun = t
                        .analysis
                        .as_ref()
                        .is_some_and(|a| a.cat == Cat::Noun && a.feats.number == Some(Number::P));
                    // Il pittogramma è del singolare se la chiave non ha quella forma, o se è un
                    // plurale che ARASAAC ha derivato dal singolare ("ferri da stiro").
                    let singular_picto = rec.flags & picto_flags::PLURAL_FORM != 0
                        || words.get(p).is_some_and(|w| *w != u.key);
                    if plural_noun && singular_picto {
                        flags |= Modifiers::PLURAL;
                    }
                }
                for &i in &span {
                    let t = &mut tokens[i];
                    t.display = Display::Hidden;
                    t.modifiers = Modifiers::default();
                    t.group = Some(GroupRef {
                        id: group_id,
                        kind: GroupKind::Multiword,
                        role: GroupRole::Member,
                    });
                }
                let t = &mut tokens[head];
                t.display = Display::Full;
                t.picto = Some(PictoRef { id: rec.picto });
                t.reason.picto = PictoReason::Multiword;
                t.modifiers = Modifiers(flags);
                t.confidence = confidence;
                if let Some(g) = &mut t.group {
                    g.role = GroupRole::Head;
                }
                s += len;
                applied = true;
                break;
            }
            if !applied {
                s += 1;
            }
        }
    }

    /// Chiave ARASAAC del verbo pronominale ("lavare" → "lavarsi": infinito senza -e più "si";
    /// "condurre" → "condursi").
    fn pronominal_picto(&self, lemma: &str) -> Option<u32> {
        let key = pronominal_lemma(lemma)?;
        // Una riga di lemma_picto per il verbo pronominale ("fermarsi") vince sull'indice.
        if let Some(id) = self.curated.preferred(&key, Cat::Verb) {
            if !self.curated.is_blocked(&[key.as_str()], id) {
                return Some(id);
            }
        }
        self.picto_for_key(&key)
    }

    /// Il pittogramma di una parola chiave ARASAAC esatta (senza i bloccati).
    fn picto_for_key(&self, key: &str) -> Option<u32> {
        let entries: Vec<PictoEntry> = self
            .picto
            .lookup(key)
            .into_iter()
            .filter(|e| !self.curated.is_blocked(&[key], e.id))
            .collect();
        Self::best_entry(entries).map(|e| e.id)
    }

    /// Fasi 4, 5 e 9 sulle letture già scelte: segni dei tempi semplici, gruppi verbali (tempi
    /// composti, passivo, "stare" + gerundio), verbi pronominali.
    fn apply_groups(&self, tokens: &mut [Token]) {
        let set_tense = |t: &mut Token, mark: Tense3| {
            let flag = match mark {
                Tense3::Past => Modifiers::PAST,
                Tense3::Future => Modifiers::FUTURE,
                Tense3::None => 0,
            };
            t.modifiers = Modifiers((t.modifiers.0 & Modifiers::PLURAL) | flag);
        };
        // Tempi semplici: ogni forma verbale finita porta il suo segno.
        for t in tokens.iter_mut() {
            let Some(a) = &t.analysis else { continue };
            if t.kind == TokenKind::Word && matches!(a.cat, Cat::Verb | Cat::Aux | Cat::Modal) {
                let mark = tense_mark(&a.feats, false);
                set_tense(t, mark);
            }
        }
        let views: Vec<View> = tokens
            .iter()
            .map(|t| {
                let a = t.analysis.as_ref();
                View {
                    word: t.kind == TokenKind::Word && a.is_some(),
                    cat: a.map_or(Cat::Punct, |a| a.cat),
                    lemma: a.map_or(String::new(), |a| normalize_key(&a.lemma)),
                    feats: a.map_or(Feats::default(), |a| a.feats),
                    key: normalize_key(&t.surface),
                    also_adjective: t.readings.iter().any(|r| r.cat == Cat::Adj),
                    alts: a.map_or(Vec::new(), |a| {
                        t.readings
                            .iter()
                            .filter(|r| {
                                r.lemma == a.lemma && r.feats.person.is_some() && r.feats != a.feats
                            })
                            .map(|r| r.feats)
                            .collect()
                    }),
                }
            })
            .collect();
        let mut next_id = 1;
        let mut in_group = vec![false; tokens.len()];
        let link = |tokens: &mut [Token], idx: usize, id: u32, kind: GroupKind, head: bool| {
            tokens[idx].group = Some(GroupRef {
                id,
                kind,
                role: if head {
                    GroupRole::Head
                } else {
                    GroupRole::Member
                },
            });
        };
        for g in verbal_groups(&views) {
            let id = next_id;
            next_id += 1;
            let mut kind = match g.kind {
                VerbalKind::Compound => GroupKind::Compound,
                VerbalKind::Progressive => GroupKind::Progressive,
            };
            // Verbo pronominale ("mi sono lavato" = lavarsi): serve il pittogramma di "lavarsi".
            let mut members = g.hidden.clone();
            let lemma = views[g.head].lemma.clone();
            let pronominal = self.pronominal_picto(&lemma);
            // "essersi lavato": il "si" attaccato all'ausiliare è il riflessivo.
            let aux_si = g.hidden.first().is_some_and(|&h| {
                tokens[h]
                    .analysis
                    .as_ref()
                    .is_some_and(|a| a.feats.enclitic.is_some_and(|e| e.pieces() == ["si"]))
            });
            // Il riflessivo della stessa persona non si mostra: "mi/ti/si" sempre, "ci/vi" solo se
            // ARASAAC ha il verbo pronominale (altrimenti "ci" può essere "lì": "ci abbiamo messo").
            let weak = g
                .reflexive
                .is_some_and(|c| matches!(views[c].lemma.as_str(), "ci" | "vi"));
            let reflexive = g.reflexive.filter(|_| !weak || pronominal.is_some());
            if reflexive.is_some() || aux_si {
                kind = GroupKind::Pronominal;
                members.extend(reflexive);
                if let Some(picto) = pronominal {
                    let head = &mut tokens[g.head];
                    head.picto = Some(PictoRef { id: picto });
                    head.display = Display::Full;
                    head.reason.picto = PictoReason::Pronominal;
                }
            } else if views[g.head].lemma == "essere" {
                // "c'è stato": ci + essere (3a persona) + stato = "esserci" al passato.
                if let Some(&aux) = g.hidden.first() {
                    let ci = aux > 0
                        && views[aux].lemma == "essere"
                        && third_person(&views[aux])
                        && views[aux - 1].word
                        && views[aux - 1].cat == Cat::Clitic
                        && views[aux - 1].lemma == "ci"
                        && !in_group[aux - 1];
                    if ci {
                        kind = GroupKind::Pronominal;
                        members.push(aux - 1);
                        if let Some(picto) = self.picto_for_key("esserci") {
                            let head = &mut tokens[g.head];
                            head.picto = Some(PictoRef { id: picto });
                            head.display = Display::Full;
                            head.reason.picto = PictoReason::Pronominal;
                        }
                    }
                }
            }
            for &m in &members {
                tokens[m].display = Display::Hidden;
                tokens[m].modifiers = Modifiers::default();
                link(tokens, m, id, kind, false);
                in_group[m] = true;
            }
            set_tense(&mut tokens[g.head], g.tense);
            link(tokens, g.head, id, kind, true);
            in_group[g.head] = true;
        }
        // "c'è", "ci sono", "c'era": "ci" + essere alla terza persona è "esserci"; "ci" non si mostra.
        for i in 1..tokens.len() {
            // "ci è utile" (= a noi) non è "esserci": dopo il verbo non deve venire un aggettivo.
            let adjective_next = views
                .get(i + 1)
                .is_some_and(|n| n.word && n.cat == Cat::Adj);
            let essere = views[i].word
                && views[i].lemma == "essere"
                && third_person(&views[i])
                && !adjective_next
                && views[i - 1].word
                && views[i - 1].cat == Cat::Clitic
                && views[i - 1].lemma == "ci";
            if in_group[i] || in_group[i - 1] || !essere {
                continue;
            }
            let id = next_id;
            next_id += 1;
            tokens[i - 1].display = Display::Hidden;
            link(tokens, i - 1, id, GroupKind::Pronominal, false);
            link(tokens, i, id, GroupKind::Pronominal, true);
            if let Some(picto) = self.picto_for_key("esserci") {
                tokens[i].picto = Some(PictoRef { id: picto });
                tokens[i].display = Display::Full;
                tokens[i].reason.picto = PictoReason::Pronominal;
            }
            in_group[i] = true;
            in_group[i - 1] = true;
        }
        // Verbo semplice con il riflessivo davanti ("mi lavo", "si pettina").
        for i in 1..tokens.len() {
            if in_group[i] || in_group[i - 1] || !views[i].word || views[i].cat != Cat::Verb {
                continue;
            }
            if !reflexive_agrees_view(&views[i - 1], &views[i])
                || views[i].feats.mood == Some(Mood::Impr)
            {
                continue;
            }
            // "ci andiamo" (= lì): "ci" e "vi" si nascondono come riflessivi solo se esiste il verbo
            // pronominale in ARASAAC ("ci siamo lavati"); "mi", "ti", "si" sempre.
            if matches!(views[i - 1].lemma.as_str(), "ci" | "vi")
                && self.pronominal_picto(&views[i].lemma).is_none()
            {
                continue;
            }
            let id = next_id;
            next_id += 1;
            tokens[i - 1].display = Display::Hidden;
            link(tokens, i - 1, id, GroupKind::Pronominal, false);
            link(tokens, i, id, GroupKind::Pronominal, true);
            if let Some(picto) = self.pronominal_picto(&views[i].lemma) {
                tokens[i].picto = Some(PictoRef { id: picto });
                tokens[i].display = Display::Full;
                tokens[i].reason.picto = PictoReason::Pronominal;
            }
            in_group[i] = true;
            in_group[i - 1] = true;
        }
        // Clitico riflessivo attaccato ("lavarsi", "lavandosi"): stesso pittogramma pronominale.
        for (i, t) in tokens.iter_mut().enumerate() {
            let Some(a) = &t.analysis else { continue };
            // "si" è sempre riflessivo; mi/ti/ci/vi solo se concordano in persona e numero con
            // l'imperativo ("lavati") o con il verbo finito che precede ("voglio lavarmi").
            let reflexive_suffix = match a.feats.enclitic.map(|e| e.pieces()) {
                Some(p) if p == ["si"] => true,
                Some(p) if p.len() == 1 && matches!(p[0], "mi" | "ti" | "ci" | "vi") => {
                    if a.feats.mood == Some(Mood::Impr) {
                        attached_reflexive_agrees(p[0], &a.feats)
                    } else if matches!(a.feats.mood, Some(Mood::Inf | Mood::Ger)) && i > 0 {
                        views[i - 1].word && attached_reflexive_agrees(p[0], &views[i - 1].feats)
                    } else {
                        false
                    }
                }
                _ => false,
            };
            if in_group[i] || !reflexive_suffix {
                continue;
            }
            if let Some(picto) = self.pronominal_picto(&a.lemma) {
                t.picto = Some(PictoRef { id: picto });
                t.display = Display::Full;
                t.reason.picto = PictoReason::Pronominal;
            }
        }
    }

    /// Fase 7: per ogni frase sceglie le letture con la decodifica; senza tagger resta la scelta
    /// provvisoria di M4 (già calcolata in `slot_for`).
    fn decide(&self, prepared: &[Prepared], slots: &mut [Slot]) {
        let Some(tagger) = &self.tagger else { return };
        let mut start = 0;
        while start < slots.len() {
            let mut end = start;
            while end < slots.len() {
                end += 1;
                if slots[end - 1].terminator {
                    break;
                }
            }
            let range = start..end;
            let nodes: Vec<Vec<Node>> = range
                .clone()
                .map(|k| self.nodes_for(tagger, &prepared[k], &slots[k]))
                .collect();
            let trans = |a: usize, b: usize, c: usize| tagger.transition(a, b, c);
            let d = decode(&trans, &nodes, &self.weights);
            for (k, (best, post)) in range.zip(d.best.into_iter().zip(d.posterior)) {
                let slot = &mut slots[k];
                if slot.readings.len() > 1 {
                    slot.best = best;
                    slot.tagged = true;
                    // Probabilità della lettura scelta, sommando le letture che hanno stessa
                    // categoria e lemma (differiscono solo per i tratti).
                    let chosen = &slot.readings[best];
                    slot.posterior = slot
                        .readings
                        .iter()
                        .zip(&post)
                        .filter(|(a, _)| a.cat == chosen.cat && a.lemma == chosen.lemma)
                        .map(|(_, p)| *p)
                        .sum();
                }
            }
            start = end;
        }
    }

    /// Le letture di un token come nodi del reticolo, con il prior del treebank.
    fn nodes_for(&self, tagger: &Tagger<D>, p: &Prepared, slot: &Slot) -> Vec<Node> {
        if slot.readings.is_empty() {
            let cat = match p.raw.kind {
                TokenKind::Punct | TokenKind::Symbol => Cat::Punct,
                // "3" come "tre": un numero in cifre è un numerale per il tagger.
                TokenKind::Number => Cat::Num,
                _ => Cat::Noun,
            };
            return vec![Node {
                cat,
                feats: Feats::default(),
                lemma: String::new(),
                prior: 0.0,
                capital: false,
                lower_propn: false,
            }];
        }
        let priors = tagger.priors(&p.key);
        let total: f32 = priors.iter().map(|r| r.count as f32).sum();
        let n = slot.readings.len() as f32;
        let capital_mid = p.capitalized && !p.sentence_start;
        slot.readings
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let lemma = normalize_key(&a.lemma);
                let count: f32 = priors
                    .iter()
                    .filter(|r| r.cat == a.cat)
                    .map(|r| r.count as f32)
                    .sum();
                let lemma_seen = priors.iter().any(|r| {
                    r.cat == a.cat
                        && r.lemma.as_deref().map(normalize_key).as_deref() == Some(&lemma)
                });
                // Probabilità della categoria data la forma, con smoothing additivo sulle letture
                // possibili; una forma mai vista è uniforme sulle sue letture.
                let mut prior = ((count + SMOOTHING) / (total + SMOOTHING * n)).ln()
                    - self.weights.unigram * tagger.unigram(a.cat);
                if lemma_seen {
                    prior += LEMMA_BONUS;
                }
                prior += self.curated.prior_bonus(&p.key, a.cat);
                // Spareggio a parità di categoria: come in M4, prima la lettura con pittogramma.
                prior -= slot.rank[i] as f32 * 1e-3;
                Node {
                    cat: a.cat,
                    feats: a.feats,
                    lemma,
                    prior,
                    capital: capital_mid && a.source == ReadingSource::Capital,
                    lower_propn: a.cat == Cat::Propn
                        && a.source == ReadingSource::Lexicon
                        && !p.capitalized,
                }
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
        for (n, raw) in raws.iter().cloned().enumerate() {
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
                    if matches!(surface, "." | "!" | "?" | "…" | "...")
                        || (surface == ":" && starts_capitalized(text, raws.get(n + 1)))
                    {
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
                let lemma = self.morph.lemma(r.lemma_id).unwrap_or("");
                // Preposizione articolata: il lemma è la preposizione ("nella" → "in").
                let lemma = if r.cat == Cat::ArtAdp {
                    articulated_base(lemma).unwrap_or(lemma)
                } else {
                    lemma
                };
                analysis(lemma, r.cat, r.feats, ReadingSource::Lexicon)
            })
            .collect()
    }

    /// I lemmi possibili di una forma già normalizzata, per le espressioni multiparola. È il codice
    /// con cui si lemmatizzano sia le parole chiave ARASAAC alla build sia le parole del testo a
    /// runtime: un infinito con "si" attaccato ("lavarsi") dà il lemma pronominale "lavarsi", una
    /// forma sconosciuta dà se stessa. Al massimo 4 lemmi.
    pub fn lemma_set(&self, key: &str) -> Vec<String> {
        let mut readings = match elision_reading(key) {
            Some(a) => vec![a],
            None => self.lexicon_readings(key),
        };
        let split = self.enclitic_readings(key, &readings);
        readings.extend(split);
        let mut out: Vec<String> = Vec::new();
        for r in &readings {
            // "lavarsi" ma anche "lavati" (imperativo, ti = seconda persona): lemma pronominale.
            let reflexive = r.feats.enclitic.is_some_and(|e| {
                let p = e.pieces();
                (p == ["si"] && matches!(r.feats.mood, Some(Mood::Inf | Mood::Ger | Mood::Part)))
                    || (p.len() == 1
                        && matches!(p[0], "mi" | "ti" | "ci" | "vi")
                        && r.feats.mood == Some(Mood::Impr)
                        && attached_reflexive_agrees(p[0], &r.feats))
            });
            let lemma = if reflexive {
                pronominal_lemma(&r.lemma).unwrap_or_else(|| normalize_key(&r.lemma))
            } else {
                normalize_key(&r.lemma)
            };
            if !lemma.is_empty() && !out.contains(&lemma) {
                out.push(lemma);
            }
        }
        if out.is_empty() {
            out.push(key.to_string());
        }
        out.truncate(4);
        out
    }

    /// Fase 4: verbo con clitici attaccati che Morph-it! non ha ("portamelo", "dillo"). Non si
    /// scompone una parola che è già un verbo con clitico in Morph-it! né una parola funzionale
    /// ("dalla" non è dare + la).
    fn enclitic_readings(&self, key: &str, existing: &[Analysis]) -> Vec<Analysis> {
        if key.chars().count() < 4
            || existing.iter().any(|a| {
                a.feats.enclitic.is_some()
                    || matches!(
                        a.cat,
                        Cat::Art
                            | Cat::ArtAdp
                            | Cat::Adp
                            | Cat::Pron
                            | Cat::Clitic
                            | Cat::Conj
                            | Cat::Det
                    )
            })
        {
            return Vec::new();
        }
        let verbs = |form: &str| -> Vec<crate::clitics::HostReading> {
            self.morph
                .lookup(form)
                .into_iter()
                .filter(|r| matches!(r.cat, Cat::Verb | Cat::Aux | Cat::Modal))
                .filter(|r| r.feats.enclitic.is_none())
                .map(|r| crate::clitics::HostReading {
                    lemma: self.morph.lemma(r.lemma_id).unwrap_or("").to_string(),
                    cat: r.cat,
                    feats: r.feats,
                })
                .collect()
        };
        // Un imperativo ricostruito ("giova" + ne) è troppo facile da confondere con una parola
        // vera ("giovane"): vale solo per forme sconosciute a Morph-it!, tranne gli imperativi
        // tronchi (fallo, dammi), che hanno forma propria.
        let known = !existing.is_empty();
        crate::clitics::split_enclitics(key, &verbs)
            .into_iter()
            .filter(|s| {
                !known
                    || s.feats.mood != Some(Mood::Impr)
                    || crate::clitics::TRUNCATED_IMPERATIVES.contains(&s.host.as_str())
            })
            .map(|s| analysis(&s.lemma, s.cat, s.feats, ReadingSource::Enclitic))
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
        // Prima la riga che nomina la forma ("i" articolo, non la lettera "i"), poi quella del lemma.
        let by_form = self.curated.preferred(key, a.cat);
        if let Some(id) = by_form.or_else(|| self.curated.preferred(&lemma_key, a.cat)) {
            if !blocked(id) {
                return Some(PictoChoice {
                    id,
                    reason: PictoReason::Curated,
                    penalty: 0.0,
                    // Una riga della forma ("occhiali") non e' un singolare da pluralizzare.
                    matched: if by_form.is_some() {
                        key.to_string()
                    } else {
                        lemma_key.clone()
                    },
                    derived_plural: false,
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
                                matched: k.to_string(),
                                derived_plural: best.has_flag(picto_flags::PLURAL_FORM),
                            }
                        } else {
                            PictoChoice {
                                id: best.id,
                                reason,
                                penalty: 0.0,
                                matched: k.to_string(),
                                derived_plural: best.has_flag(picto_flags::PLURAL_FORM),
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

    /// Fasi 1–3 e 8 di un token: letture e, per ciascuna, il pittogramma che porterebbe.
    fn slot_for(&self, p: &Prepared, surface: &str) -> Slot {
        let span_utf16 = (p.raw.start16, p.raw.end16);
        let base = |kind, reason, display, confidence| Token {
            span_utf16,
            surface: surface.to_string(),
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
        let fixed = |token| Slot {
            fixed: Some(token),
            ..Slot::default()
        };
        match p.raw.kind {
            TokenKind::Punct | TokenKind::Symbol => {
                let mut slot = fixed(base(
                    p.raw.kind,
                    ReadingReason::Punctuation,
                    Display::TextOnly,
                    1.0,
                ));
                slot.terminator = matches!(surface, "." | "!" | "?" | "…" | "...");
                slot
            }
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
                fixed(t)
            }
            _ => self.word_slot(p, surface, base),
        }
    }

    fn word_slot(
        &self,
        p: &Prepared,
        surface: &str,
        base: impl Fn(TokenKind, ReadingReason, Display, f32) -> Token,
    ) -> Slot {
        let key = &p.key;
        // I prefissi elisi si risolvono con la tabella della specifica, non con Morph-it!.
        let mut readings = match elision_reading(key) {
            Some(a) => vec![a],
            None => self.lexicon_readings(key),
        };
        let split = self.enclitic_readings(key, &readings);
        readings.extend(split);
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
            return Slot {
                fixed: Some(t),
                ..Slot::default()
            };
        }

        // Scelta provvisoria (M4): prima le letture che portano a un pittogramma della categoria
        // giusta, poi senza categoria, poi nessuna; a parità, priorità fissa per categoria. Serve
        // da scelta senza tagger e da spareggio fra letture della stessa categoria.
        let scored: Vec<Option<PictoChoice>> =
            readings.iter().map(|a| self.choose_picto(key, a)).collect();
        let capital_mid = p.capitalized && !p.sentence_start;
        let mut order: Vec<usize> = (0..readings.len()).collect();
        order.sort_by_key(|&i| {
            // Maiuscola a metà frase: il nome proprio vince su tutto (regola provvisoria di M4).
            let capital_first = !(capital_mid && readings[i].source == ReadingSource::Capital);
            let level = match &scored[i] {
                Some(c) if c.penalty == 0.0 => 0,
                Some(_) => 1,
                None => 2,
            };
            (capital_first, level, category_rank(readings[i].cat), i)
        });
        let mut rank = vec![0; readings.len()];
        for (r, &i) in order.iter().enumerate() {
            rank[i] = r;
        }
        Slot {
            best: order[0],
            readings,
            corrected,
            scored,
            rank,
            ..Slot::default()
        }
    }

    /// Costruisce il token finale dalla lettura scelta.
    fn finish(&self, p: &Prepared, surface: String, slot: Slot) -> Token {
        if let Some(t) = slot.fixed {
            return t;
        }
        let Slot {
            readings,
            corrected,
            scored,
            best,
            tagged,
            posterior,
            ..
        } = slot;
        let chosen = readings[best].clone();
        let mut alternatives = scored.into_iter().map(Some).collect::<Vec<_>>();
        let choice = match alternatives[best].take().flatten() {
            Some(c) => Some(c),
            // Nessun pittogramma per la lettura scelta: si prova con le altre letture dello
            // stesso lemma ("tanto" avverbio non ce l'ha, "tanto" aggettivo sì), con la stessa
            // penalità di una categoria diversa (estensione rispetto a SPEC.md).
            None => readings
                .iter()
                .zip(alternatives)
                .enumerate()
                .filter(|(i, (a, _))| *i != best && a.lemma == chosen.lemma)
                .find_map(|(_, (_, c))| c.flatten())
                .map(|c| PictoChoice {
                    reason: PictoReason::IgnoringCategory,
                    penalty: c.penalty.max(0.2),
                    ..c
                }),
        };
        let reading_reason = match chosen.source {
            ReadingSource::Capital => ReadingReason::Capital,
            ReadingSource::ArasaacKey => ReadingReason::ArasaacKey,
            ReadingSource::Typo => ReadingReason::Typo,
            ReadingSource::SuffixGuess => ReadingReason::SuffixGuess,
            _ if readings.len() == 1 => ReadingReason::OnlyReading,
            _ if tagged => ReadingReason::Tagger,
            _ => ReadingReason::BaselinePick,
        };
        // Senza tagger la confidenza è provvisoria (M4); con il tagger è la probabilità a
        // posteriori della lettura scelta, limitata dall'affidabilità della fonte.
        let source_cap: f32 = match chosen.source {
            ReadingSource::ArasaacKey => 0.7,
            ReadingSource::Typo => 0.4,
            ReadingSource::SuffixGuess => 0.3,
            ReadingSource::Capital if readings.len() == 1 => 0.8,
            _ => 1.0,
        };
        let mut confidence: f32 = if tagged {
            posterior.min(source_cap)
        } else if readings.len() == 1 {
            source_cap
        } else {
            source_cap.min(0.5)
        };
        let matched = choice
            .as_ref()
            .map(|c| (c.reason, c.matched.clone(), c.derived_plural));
        let mut t = Token {
            span_utf16: (p.raw.start16, p.raw.end16),
            surface,
            kind: TokenKind::Word,
            analysis: None,
            readings: Vec::new(),
            corrected: None,
            group: None,
            picto: None,
            modifiers: Modifiers::default(),
            display: Display::TextOnly,
            confidence,
            alternatives: Vec::new(),
            reason: Reason {
                reading: reading_reason,
                picto: PictoReason::NoSymbol,
            },
        };
        if let Some(c) = choice {
            t.picto = Some(PictoRef { id: c.id });
            t.display = Display::Full;
            t.reason.picto = c.reason;
            confidence = (confidence - c.penalty).max(0.0);
        }
        t.confidence = confidence;
        // PLURALE: nome plurale il cui pittogramma è del singolare: trovato con il singolare o il
        // lemma, oppure con un plurale derivato da ARASAAC ("maestre" per "maestra"). Se la forma
        // è una parola chiave a sé ("occhiali", "pastelli", "mani") l'immagine è già plurale.
        if chosen.cat == Cat::Noun && chosen.feats.number == Some(Number::P) {
            if let Some(c) = &matched {
                if c.0 != PictoReason::PluralForm && (c.1 != p.key || c.2) {
                    t.modifiers = Modifiers(Modifiers::PLURAL);
                }
            }
        }
        t.analysis = Some(chosen);
        t.readings = readings;
        t.corrected = corrected;
        t
    }
}

/// Un token durante l'analisi: o già definitivo (punteggiatura, numeri, parole sconosciute) o
/// con le sue letture in attesa della scelta.
#[derive(Default)]
struct Slot {
    fixed: Option<Token>,
    readings: Vec<Analysis>,
    corrected: Option<String>,
    scored: Vec<Option<PictoChoice>>,
    /// Posizione di ogni lettura nell'ordine provvisorio di M4 (0 = prima).
    rank: Vec<usize>,
    /// Lettura scelta.
    best: usize,
    tagged: bool,
    posterior: f32,
    /// Punteggiatura che chiude la frase.
    terminator: bool,
}

/// Smoothing additivo del prior (conteggi del treebank).
const SMOOTHING: f32 = 0.1;
/// Bonus per una lettura il cui lemma coincide con quello visto nel treebank.
const LEMMA_BONUS: f32 = 0.3;

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
