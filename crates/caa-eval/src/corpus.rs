//! Corpus annotato e metriche (SPEC.md, "Formato del corpus" e "Metriche (`caa-eval`)", M7).
//!
//! Un file TSV per testo: intestazione (`# testo:`, `# genere:`, `# gruppo:`, `# origine:`), poi
//! un blocco per frase, separati da riga vuota:
//!
//! ```text
//! # frase: Cappuccetto Rosso è andata dalla nonna.
//! andata<TAB>VERB<TAB>andare<TAB>24598|2432<TAB>PAST<TAB>Full
//! ```
//!
//! Colonne: forma, categoria, lemma, pittogrammi accettati (id separati da `|`, `-` se nessuno),
//! segni (`PLURAL`, `PAST`, `FUTURE` uniti da `+`, `-` se nessuno), visualizzazione
//! (`Full`, `Reduced`, `TextOnly`, `Hidden`).

use std::collections::BTreeMap;

use caa_engine::engine::{
    Display, Engine, GroupKind, Modifiers, PictoReason, ReadingSource, Token,
};
use caa_engine::tokenize::TokenKind;
use caa_engine::types::Cat;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoldToken {
    pub form: String,
    pub cat: Cat,
    pub lemma: String,
    /// Pittogrammi accettati; vuoto = nessun simbolo atteso.
    pub pictos: Vec<u32>,
    pub modifiers: u8,
    pub display: Display,
}

#[derive(Debug, Clone)]
pub struct GoldSentence {
    pub text: String,
    pub tokens: Vec<GoldToken>,
}

#[derive(Debug, Clone)]
pub struct GoldText {
    pub name: String,
    pub genre: String,
    /// `sviluppo` (si usa per correggere il motore) o `prova` (si guarda solo per misurare).
    pub group: String,
    pub origin: String,
    pub sentences: Vec<GoldSentence>,
}

pub fn modifiers_to_str(m: u8) -> String {
    let mut parts = Vec::new();
    for (flag, name) in [
        (Modifiers::PLURAL, "PLURAL"),
        (Modifiers::PAST, "PAST"),
        (Modifiers::FUTURE, "FUTURE"),
    ] {
        if m & flag != 0 {
            parts.push(name);
        }
    }
    if parts.is_empty() {
        "-".to_string()
    } else {
        parts.join("+")
    }
}

fn parse_modifiers(s: &str) -> Option<u8> {
    if s == "-" {
        return Some(0);
    }
    let mut m = 0;
    for p in s.split('+') {
        m |= match p {
            "PLURAL" => Modifiers::PLURAL,
            "PAST" => Modifiers::PAST,
            "FUTURE" => Modifiers::FUTURE,
            _ => return None,
        };
    }
    Some(m)
}

fn parse_display(s: &str) -> Option<Display> {
    Some(match s {
        "Full" => Display::Full,
        "Reduced" => Display::Reduced,
        "TextOnly" => Display::TextOnly,
        "Hidden" => Display::Hidden,
        _ => return None,
    })
}

pub fn display_name(d: Display) -> &'static str {
    match d {
        Display::Full => "Full",
        Display::Reduced => "Reduced",
        Display::TextOnly => "TextOnly",
        Display::Hidden => "Hidden",
    }
}

/// Legge un testo annotato; gli errori hanno il numero di riga.
pub fn parse_text(text: &str) -> Result<GoldText, Vec<String>> {
    let mut errors = Vec::new();
    let mut out = GoldText {
        name: String::new(),
        genre: String::new(),
        group: String::new(),
        origin: String::new(),
        sentences: Vec::new(),
    };
    let mut current: Option<GoldSentence> = None;
    for (i, raw) in text.lines().enumerate() {
        let n = i + 1;
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() {
            if let Some(s) = current.take() {
                out.sentences.push(s);
            }
            continue;
        }
        if let Some(c) = line.strip_prefix('#') {
            let c = c.trim();
            if let Some(v) = c.strip_prefix("frase:") {
                if let Some(s) = current.take() {
                    out.sentences.push(s);
                }
                current = Some(GoldSentence {
                    text: v.trim().to_string(),
                    tokens: Vec::new(),
                });
            } else if let Some(v) = c.strip_prefix("testo:") {
                out.name = v.trim().to_string();
            } else if let Some(v) = c.strip_prefix("genere:") {
                out.genre = v.trim().to_string();
            } else if let Some(v) = c.strip_prefix("gruppo:") {
                out.group = v.trim().to_string();
            } else if let Some(v) = c.strip_prefix("origine:") {
                out.origin = v.trim().to_string();
            }
            continue;
        }
        let Some(sentence) = current.as_mut() else {
            errors.push(format!("riga {n}: una parola prima di `# frase:`"));
            continue;
        };
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() != 6 {
            errors.push(format!(
                "riga {n}: servono 6 colonne, ce ne sono {}",
                cols.len()
            ));
            continue;
        }
        let cat = Cat::from_name(cols[1]);
        let pictos: Option<Vec<u32>> = if cols[3] == "-" {
            Some(Vec::new())
        } else {
            cols[3].split('|').map(|x| x.parse().ok()).collect()
        };
        let (Some(cat), Some(pictos), Some(modifiers), Some(display)) = (
            cat,
            pictos,
            parse_modifiers(cols[4]),
            parse_display(cols[5]),
        ) else {
            errors.push(format!(
                "riga {n}: categoria, pittogrammi, segni o visualizzazione non validi"
            ));
            continue;
        };
        sentence.tokens.push(GoldToken {
            form: cols[0].to_string(),
            cat,
            lemma: cols[2].to_string(),
            pictos,
            modifiers,
            display,
        });
    }
    if let Some(s) = current.take() {
        out.sentences.push(s);
    }
    if out.name.is_empty() {
        errors.push("manca `# testo:`".to_string());
    }
    if !matches!(out.group.as_str(), "sviluppo" | "prova") {
        errors.push("`# gruppo:` deve essere `sviluppo` o `prova`".to_string());
    }
    if errors.is_empty() {
        Ok(out)
    } else {
        Err(errors)
    }
}

/// Divide un testo in frasi (`. ! ? …` seguiti da spazio o fine, con eventuali virgolette di
/// chiusura) e righe. Serve a `prepara`.
pub fn split_sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let mut cur = String::new();
        let mut i = 0;
        while i < chars.len() {
            cur.push(chars[i]);
            if matches!(chars[i], '.' | '!' | '?' | '…') {
                // Gruppi di terminatori e virgolette di chiusura restano nella frase.
                while i + 1 < chars.len()
                    && matches!(chars[i + 1], '.' | '!' | '?' | '…' | '"' | '»' | '”')
                {
                    i += 1;
                    cur.push(chars[i]);
                }
                if i + 1 >= chars.len() || chars[i + 1].is_whitespace() {
                    out.push(cur.trim().to_string());
                    cur.clear();
                }
            }
            i += 1;
        }
        if !cur.trim().is_empty() {
            out.push(cur.trim().to_string());
        }
    }
    out
}

/// Bozza TSV di un testo dal motore, da correggere a mano (`caa-eval prepara`).
pub fn draft<D: AsRef<[u8]>>(
    engine: &Engine<D>,
    name: &str,
    header: &[(&str, &str)],
    text: &str,
) -> String {
    let mut s = format!("# testo: {name}\n");
    for (k, v) in header {
        s += &format!("# {k}: {v}\n");
    }
    for sentence in split_sentences(text) {
        s += &format!("\n# frase: {sentence}\n");
        for t in engine.symbolize_text(&sentence) {
            let (cat, lemma) = match (&t.analysis, t.kind) {
                (Some(a), _) => (a.cat, a.lemma.to_lowercase()),
                (None, TokenKind::Punct | TokenKind::Symbol) => (Cat::Punct, t.surface.clone()),
                (None, _) => (Cat::Noun, t.surface.to_lowercase()),
            };
            let picto = t.picto.map_or("-".to_string(), |p| p.id.to_string());
            let display = match (t.display, t.picto) {
                (Display::Hidden, _) => "Hidden",
                (_, Some(_)) => "Full",
                _ => "TextOnly",
            };
            s += &format!(
                "{}\t{}\t{}\t{}\t{}\t{}\n",
                t.surface,
                cat.name(),
                lemma,
                picto,
                modifiers_to_str(t.modifiers.0),
                display
            );
        }
    }
    s
}

// ---------------------------------------------------------------------------------------
// Metriche
// ---------------------------------------------------------------------------------------

/// Perché una parola richiede una correzione (in ordine di priorità).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Cause {
    UnknownForm,
    WrongReading,
    MissedMultiword,
    WrongMultiword,
    VerbalStructure,
    Modifier,
    WrongSense,
    PictoGap,
    UnwantedSymbol,
}

impl Cause {
    pub fn label(self) -> &'static str {
        match self {
            Cause::UnknownForm => "forma sconosciuta",
            Cause::WrongReading => "lettura sbagliata",
            Cause::MissedMultiword => "multiparola mancata",
            Cause::WrongMultiword => "multiparola sbagliata",
            Cause::VerbalStructure => "struttura verbale",
            Cause::Modifier => "segno (plurale, passato, futuro)",
            Cause::WrongSense => "senso sbagliato",
            Cause::PictoGap => "lacuna di pittogramma",
            Cause::UnwantedSymbol => "simbolo non voluto",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ErrorItem {
    pub text: String,
    pub sentence: usize,
    pub form: String,
    pub cause: Cause,
    pub detail: String,
}

#[derive(Debug, Default, Clone)]
pub struct Metrics {
    pub texts: usize,
    pub words: usize,
    /// Parole che richiedono una correzione.
    pub wrong: usize,
    pub content: usize,
    pub content_picto_ok: usize,
    pub category_ok: usize,
    pub lemma_ok: usize,
    /// Parole per cui il lemma conta (nomi, verbi, aggettivi, avverbi…).
    pub lemma_words: usize,
    /// Parole con un segno atteso o prodotto, e quante lo hanno giusto.
    pub modifier_cases: usize,
    pub modifier_ok: usize,
    /// Parole piene con un pittogramma atteso, e quante ne hanno uno qualsiasi.
    pub coverage_cases: usize,
    pub coverage_ok: usize,
    pub wrong_flagged: usize,
    pub right_flagged: usize,
    pub skipped_sentences: usize,
    pub errors: Vec<ErrorItem>,
}

impl Metrics {
    pub fn per_100(&self) -> f64 {
        pct(self.wrong, self.words)
    }
}

pub fn pct(a: usize, b: usize) -> f64 {
    if b == 0 {
        0.0
    } else {
        100.0 * a as f64 / b as f64
    }
}

fn same_class(a: Cat, b: Cat) -> bool {
    let verbal = |c: Cat| matches!(c, Cat::Verb | Cat::Aux | Cat::Modal);
    a == b || (verbal(a) && verbal(b))
}

/// Il lemma conta solo per le parole con significato: per articoli, preposizioni e pronomi le
/// convenzioni di Morph-it! ("le" → "la", "gli" → "il") non cambiano il pittogramma.
fn lemma_matters(c: Cat) -> bool {
    matches!(
        c,
        Cat::Noun
            | Cat::Propn
            | Cat::Verb
            | Cat::Aux
            | Cat::Modal
            | Cat::Adj
            | Cat::Adv
            | Cat::Num
            | Cat::Intj
    )
}

fn is_content(c: Cat) -> bool {
    matches!(c, Cat::Noun | Cat::Verb | Cat::Adj | Cat::Adv)
}

/// Valuta una parola; `None` se è corretta, altrimenti la causa e un dettaglio.
fn judge(gold: &GoldToken, t: &Token) -> Option<(Cause, String)> {
    let a = t.analysis.as_ref();
    let hidden = t.display == Display::Hidden;
    let gold_hidden = gold.display == Display::Hidden;
    let engine_cat = a.map(|a| a.cat);
    let engine_lemma = a.map(|a| a.lemma.to_lowercase());
    let wrong_reading = engine_cat.is_none_or(|c| !same_class(c, gold.cat))
        || (lemma_matters(gold.cat)
            && engine_lemma.as_deref() != Some(gold.lemma.to_lowercase().as_str()));
    let detail_reading = || {
        format!(
            "atteso {}/{}, ottenuto {}/{}",
            gold.cat.name(),
            gold.lemma,
            engine_cat.map_or("?", |c| c.name()),
            engine_lemma.clone().unwrap_or_default()
        )
    };
    let uncertain_source = t.kind == TokenKind::Unknown
        || a.is_some_and(|a| matches!(a.source, ReadingSource::Typo | ReadingSource::SuffixGuess));
    let in_multiword = t.group.is_some_and(|g| g.kind == GroupKind::Multiword);
    if gold_hidden {
        if hidden {
            return None;
        }
        // Dovrebbe essere nascosta e non lo è.
        if uncertain_source {
            return Some((Cause::UnknownForm, detail_reading()));
        }
        return Some(
            if matches!(gold.cat, Cat::Aux | Cat::Clitic | Cat::Verb | Cat::Modal) {
                (
                    Cause::VerbalStructure,
                    "ausiliare o clitico visibile".to_string(),
                )
            } else {
                (
                    Cause::MissedMultiword,
                    "parola da nascondere in un'espressione".to_string(),
                )
            },
        );
    }
    if hidden {
        return Some(if in_multiword {
            (
                Cause::WrongMultiword,
                "nascosta da un'espressione non voluta".to_string(),
            )
        } else {
            (
                Cause::VerbalStructure,
                "nascosta ma doveva essere visibile".to_string(),
            )
        });
    }
    if uncertain_source && (wrong_reading || !picto_ok(gold, t)) {
        return Some((Cause::UnknownForm, detail_reading()));
    }
    if wrong_reading {
        return Some((Cause::WrongReading, detail_reading()));
    }
    if !picto_ok(gold, t) {
        let got = t.picto.map(|p| p.id);
        return Some(match (got, gold.pictos.is_empty()) {
            (None, _) => (
                Cause::PictoGap,
                format!("nessun pittogramma, attesi {:?}", gold.pictos),
            ),
            (Some(id), true) => (Cause::UnwantedSymbol, format!("{id} dove non serve")),
            (Some(id), false) if t.reason.picto == PictoReason::Multiword || in_multiword => (
                Cause::WrongMultiword,
                format!("{id} da espressione, attesi {:?}", gold.pictos),
            ),
            (Some(id), false) => (
                Cause::WrongSense,
                format!(
                    "{id} ({}), attesi {:?}",
                    t.reason.picto_label(),
                    gold.pictos
                ),
            ),
        });
    }
    if t.modifiers.0 != gold.modifiers {
        return Some((
            Cause::Modifier,
            format!(
                "atteso {}, ottenuto {}",
                modifiers_to_str(gold.modifiers),
                modifiers_to_str(t.modifiers.0)
            ),
        ));
    }
    None
}

fn picto_ok(gold: &GoldToken, t: &Token) -> bool {
    match t.picto {
        None => gold.pictos.is_empty(),
        Some(p) => gold.pictos.contains(&p.id),
    }
}

/// Valuta i testi annotati con il motore.
pub fn evaluate<D: AsRef<[u8]>>(engine: &Engine<D>, texts: &[&GoldText]) -> Metrics {
    let mut m = Metrics {
        texts: texts.len(),
        ..Metrics::default()
    };
    for gt in texts {
        for (si, s) in gt.sentences.iter().enumerate() {
            let tokens = engine.symbolize_text(&s.text);
            let same = tokens.len() == s.tokens.len()
                && tokens
                    .iter()
                    .zip(&s.tokens)
                    .all(|(t, g)| t.surface == g.form);
            if !same {
                m.skipped_sentences += 1;
                m.errors.push(ErrorItem {
                    text: gt.name.clone(),
                    sentence: si + 1,
                    form: s.text.clone(),
                    cause: Cause::UnknownForm,
                    detail: "i token del motore non coincidono con quelli annotati: frase saltata"
                        .to_string(),
                });
                continue;
            }
            for (t, g) in tokens.iter().zip(&s.tokens) {
                if g.cat == Cat::Punct {
                    continue;
                }
                m.words += 1;
                let verdict = judge(g, t);
                let wrong = verdict.is_some();
                let flagged = t.confidence < 0.6;
                if wrong {
                    m.wrong += 1;
                    if flagged {
                        m.wrong_flagged += 1;
                    }
                } else if flagged {
                    m.right_flagged += 1;
                }
                if let Some((cause, detail)) = verdict {
                    m.errors.push(ErrorItem {
                        text: gt.name.clone(),
                        sentence: si + 1,
                        form: g.form.clone(),
                        cause,
                        detail,
                    });
                }
                let a = t.analysis.as_ref();
                if a.is_some_and(|a| a.cat == g.cat) {
                    m.category_ok += 1;
                }
                if lemma_matters(g.cat) {
                    m.lemma_words += 1;
                    if a.is_some_and(|a| a.lemma.to_lowercase() == g.lemma.to_lowercase()) {
                        m.lemma_ok += 1;
                    }
                }
                let visible = g.display != Display::Hidden;
                if visible && is_content(g.cat) && !g.pictos.is_empty() {
                    m.content += 1;
                    if t.picto.is_some_and(|p| g.pictos.contains(&p.id)) {
                        m.content_picto_ok += 1;
                    }
                    m.coverage_cases += 1;
                    if t.picto.is_some() {
                        m.coverage_ok += 1;
                    }
                }
                if visible && (g.modifiers != 0 || t.modifiers.0 != 0) {
                    m.modifier_cases += 1;
                    if g.modifiers == t.modifiers.0 {
                        m.modifier_ok += 1;
                    }
                }
            }
        }
    }
    m
}

/// Errori raggruppati per causa, dalla più frequente: (causa, quanti, esempi).
pub fn group_errors(m: &Metrics) -> Vec<(Cause, usize, Vec<&ErrorItem>)> {
    let mut by: BTreeMap<Cause, Vec<&ErrorItem>> = BTreeMap::new();
    for e in &m.errors {
        by.entry(e.cause).or_default().push(e);
    }
    let mut v: Vec<_> = by
        .into_iter()
        .map(|(c, items)| (c, items.len(), items))
        .collect();
    v.sort_by_key(|(c, n, _)| (std::cmp::Reverse(*n), *c));
    v
}

pub fn render(label: &str, m: &Metrics, examples: usize) -> String {
    let mut s = format!("== {label}: {} testi, {} parole ==\n", m.texts, m.words);
    s += &format!(
        "Correzioni per 100 parole: {:.1} ({} su {})\n",
        m.per_100(),
        m.wrong,
        m.words
    );
    s += &format!(
        "Pittogramma giusto sulle parole piene: {:.1}% ({} su {})\n",
        pct(m.content_picto_ok, m.content),
        m.content_picto_ok,
        m.content
    );
    s += &format!(
        "Categoria giusta: {:.1}%   lemma giusto (parole con significato): {:.1}%\n",
        pct(m.category_ok, m.words),
        pct(m.lemma_ok, m.lemma_words)
    );
    s += &format!(
        "Segni giusti (plurale, passato, futuro): {:.1}% ({} su {})\n",
        pct(m.modifier_ok, m.modifier_cases),
        m.modifier_ok,
        m.modifier_cases
    );
    s += &format!(
        "Copertura (parole piene con un pittogramma): {:.1}% ({} su {})\n",
        pct(m.coverage_ok, m.coverage_cases),
        m.coverage_ok,
        m.coverage_cases
    );
    s += &format!(
        "Taratura: errori sottolineati {:.1}% ({} su {}); parole giuste sottolineate {:.1}% ({} su {})\n",
        pct(m.wrong_flagged, m.wrong),
        m.wrong_flagged,
        m.wrong,
        pct(m.right_flagged, m.words - m.wrong),
        m.right_flagged,
        m.words - m.wrong
    );
    if m.skipped_sentences > 0 {
        s += &format!(
            "Frasi saltate (tokenizzazione diversa): {}\n",
            m.skipped_sentences
        );
    }
    s += "Errori per causa:\n";
    for (cause, n, items) in group_errors(m) {
        s += &format!("  {:<34} {:>4}\n", cause.label(), n);
        for e in items.iter().take(examples) {
            s += &format!(
                "      {} [{} f.{}]: {}\n",
                e.form, e.text, e.sentence, e.detail
            );
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# testo: prova\n# genere: storia\n# gruppo: sviluppo\n# origine: sintetico\n\n# frase: Ho mangiato.\nHo\tAUX\tavere\t7271\t-\tHidden\nmangiato\tVERB\tmangiare\t2349|6456\tPAST\tFull\n.\tPUNCT\t.\t-\t-\tTextOnly\n";

    #[test]
    fn legge_un_testo() {
        let t = parse_text(SAMPLE).unwrap();
        assert_eq!(
            (t.name.as_str(), t.genre.as_str(), t.group.as_str()),
            ("prova", "storia", "sviluppo")
        );
        assert_eq!(t.sentences.len(), 1);
        let s = &t.sentences[0];
        assert_eq!(s.text, "Ho mangiato.");
        assert_eq!(s.tokens.len(), 3);
        assert_eq!(s.tokens[1].pictos, vec![2349, 6456]);
        assert_eq!(s.tokens[1].modifiers, Modifiers::PAST);
        assert_eq!(s.tokens[0].display, Display::Hidden);
        assert!(s.tokens[2].pictos.is_empty());
    }

    #[test]
    fn errori_con_riga() {
        let bad = "# testo: x\n# gruppo: sviluppo\n# frase: a\nuna\tcolonna\n";
        let e = parse_text(bad).unwrap_err();
        assert!(e[0].contains("riga 4"));
        assert!(parse_text("# testo: x\n# gruppo: altro\n").is_err());
        assert!(parse_text("# testo: x\n# gruppo: prova\nparola\tNOUN\tp\t-\t-\tFull\n").is_err());
        let invalid = "# testo: x\n# gruppo: prova\n# frase: a\na\tNOUN\ta\t-\tPLURALE\tFull\n";
        assert!(parse_text(invalid).is_err());
    }

    #[test]
    fn segni_in_testo() {
        assert_eq!(modifiers_to_str(0), "-");
        assert_eq!(
            modifiers_to_str(Modifiers::PLURAL | Modifiers::PAST),
            "PLURAL+PAST"
        );
        assert_eq!(
            parse_modifiers("PAST+PLURAL"),
            Some(Modifiers::PAST | Modifiers::PLURAL)
        );
        assert_eq!(parse_modifiers("X"), None);
    }

    #[test]
    fn frasi_e_virgolette() {
        let t = "Marco corre. Giulia dorme!\nElena chiede: \"Vuoi giocare?\" Karim sorride.\n# commento\n\nUn po' di pane... e basta.";
        assert_eq!(
            split_sentences(t),
            vec![
                "Marco corre.",
                "Giulia dorme!",
                "Elena chiede: \"Vuoi giocare?\"",
                "Karim sorride.",
                "Un po' di pane...",
                "e basta."
            ]
        );
        // I decimali e le sigle senza spazio dopo il punto non spezzano.
        assert_eq!(
            split_sentences("Costa 3.50 euro."),
            vec!["Costa 3.50 euro."]
        );
    }
}
