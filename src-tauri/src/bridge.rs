//! Collegamento fra l'interfaccia e il motore (M8): ricerca della cartella dei dati, conversione dei
//! token nel formato per la pagina e lettura delle immagini. Niente di Tauri qui, così si prova da solo.

use std::path::{Path, PathBuf};

use caa_engine::engine::{Display, FunctionPolicy, GroupRole, Token};
use caa_engine::tokenize::TokenKind;
use caa_engine::types::Cat;
use serde::Serialize;

/// Sotto questa confidenza la parola si sottolinea (SPEC.md, fase 7).
pub const DOUBT_THRESHOLD: f32 = 0.6;

/// Cartelle in cui cercare i dati, nell'ordine: la variabile `CAA_DATA`, `dati/` e `data/build/`
/// accanto al programma, `data/build/` nella cartella corrente (sviluppo).
pub fn data_candidates(
    env: Option<&str>,
    exe_dir: Option<&Path>,
    cwd: Option<&Path>,
) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(e) = env.filter(|e| !e.is_empty()) {
        v.push(PathBuf::from(e));
    }
    if let Some(d) = exe_dir {
        v.push(d.join("dati"));
        v.push(d.join("data/build"));
    }
    if let Some(c) = cwd {
        v.push(c.join("data/build"));
    }
    v
}

/// Prima cartella dei candidati che contiene un lessico (`manifest.json`).
pub fn find_data_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|d| d.join("manifest.json").is_file())
        .cloned()
}

pub fn parse_policy(s: &str) -> FunctionPolicy {
    match s {
        "essential" => FunctionPolicy::Essential,
        _ => FunctionPolicy::Complete,
    }
}

/// Un token come lo vede la pagina. Gli offset sono in unità UTF-16 (come in JavaScript).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TokenDto {
    pub s: u32,
    pub e: u32,
    /// `word`, `punct`, `number`, `unknown`.
    pub kind: &'static str,
    /// `full`, `reduced`, `text`, `hidden`.
    pub display: &'static str,
    pub picto: Option<u32>,
    /// L'immagine del pittogramma è disponibile nei dati.
    pub image: bool,
    /// Segni: 1 plurale, 2 passato, 4 futuro.
    pub mods: u8,
    /// Identificativo del gruppo (0 = nessuno) e se è la testa.
    pub group: u32,
    pub head: bool,
    pub confidence: f32,
    /// Parola da controllare (confidenza bassa o sconosciuta).
    pub doubtful: bool,
    /// Parola piena senza pittogramma: l'editor mostra il segnaposto tratteggiato.
    pub placeholder: bool,
}

fn is_content(cat: Cat) -> bool {
    matches!(cat, Cat::Noun | Cat::Verb | Cat::Adj | Cat::Adv)
}

pub fn to_dto(tokens: &[Token], has_image: &dyn Fn(u32) -> bool) -> Vec<TokenDto> {
    tokens
        .iter()
        .map(|t| {
            let kind = match t.kind {
                TokenKind::Word => "word",
                TokenKind::Number => "number",
                TokenKind::Punct | TokenKind::Symbol => "punct",
                TokenKind::Unknown => "unknown",
            };
            let display = match t.display {
                Display::Full => "full",
                Display::Reduced => "reduced",
                Display::TextOnly => "text",
                Display::Hidden => "hidden",
            };
            let picto = t.picto.map(|p| p.id);
            let image = picto.is_some_and(has_image);
            let content = t.analysis.as_ref().is_some_and(|a| is_content(a.cat));
            let word = matches!(t.kind, TokenKind::Word | TokenKind::Unknown);
            let hidden = t.display == Display::Hidden;
            TokenDto {
                s: t.span_utf16.0,
                e: t.span_utf16.1,
                kind,
                display,
                picto,
                image,
                mods: t.modifiers.0,
                group: t.group.map_or(0, |g| g.id),
                head: t.group.is_some_and(|g| g.role == GroupRole::Head),
                confidence: t.confidence,
                doubtful: word && !hidden && t.confidence < DOUBT_THRESHOLD,
                // Una parola piena visibile senza simbolo (o con simbolo non disponibile).
                placeholder: word
                    && !hidden
                    && (content || t.kind == TokenKind::Unknown)
                    && (picto.is_none() || !image),
            }
        })
        .collect()
}

/// Percorso dell'immagine di un pittogramma nella cartella dei dati.
pub fn image_path(dir: &Path, id: u32) -> PathBuf {
    dir.join("arasaac/images").join(format!("{id}.webp"))
}

/// Id di pittogramma da un percorso di richiesta ("/12345"); `None` se non è un numero.
pub fn parse_picto_path(path: &str) -> Option<u32> {
    let p = path.trim_start_matches('/');
    if p.is_empty() || p.len() > 9 || !p.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    p.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use caa_engine::engine::{
        Analysis, GroupKind, GroupRef, Modifiers, PictoReason, PictoRef, ReadingReason,
        ReadingSource, Reason,
    };
    use caa_engine::types::Feats;

    fn token(
        kind: TokenKind,
        cat: Option<Cat>,
        picto: Option<u32>,
        display: Display,
        conf: f32,
    ) -> Token {
        Token {
            span_utf16: (3, 8),
            surface: "x".into(),
            kind,
            analysis: cat.map(|c| Analysis {
                lemma: "x".into(),
                cat: c,
                feats: Feats::default(),
                source: ReadingSource::Lexicon,
            }),
            readings: Vec::new(),
            corrected: None,
            group: None,
            picto: picto.map(|id| PictoRef { id }),
            modifiers: Modifiers::default(),
            display,
            confidence: conf,
            alternatives: Vec::new(),
            reason: Reason {
                reading: ReadingReason::OnlyReading,
                picto: PictoReason::NoSymbol,
            },
        }
    }

    #[test]
    fn cartelle_in_ordine() {
        let c = data_candidates(
            Some("/dati"),
            Some(Path::new("/app")),
            Some(Path::new("/lavoro")),
        );
        assert_eq!(
            c,
            vec![
                PathBuf::from("/dati"),
                "/app/dati".into(),
                "/app/data/build".into(),
                "/lavoro/data/build".into()
            ]
        );
        assert_eq!(data_candidates(Some(""), None, None), Vec::<PathBuf>::new());
        let tmp = std::env::temp_dir().join(format!("caa-bridge-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("b")).unwrap();
        std::fs::write(tmp.join("b/manifest.json"), "{}").unwrap();
        assert_eq!(
            find_data_dir(&[tmp.join("a"), tmp.join("b")]),
            Some(tmp.join("b"))
        );
        assert_eq!(find_data_dir(&[tmp.join("a")]), None);
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn percorsi_delle_immagini() {
        assert_eq!(parse_picto_path("/12345"), Some(12345));
        assert_eq!(parse_picto_path("12345"), Some(12345));
        for bad in ["", "/", "/../x", "/12a", "/1234567890", "/-1", "/12/34"] {
            assert_eq!(parse_picto_path(bad), None, "{bad:?}");
        }
        assert_eq!(
            image_path(Path::new("/d"), 7),
            PathBuf::from("/d/arasaac/images/7.webp")
        );
    }

    #[test]
    fn politica_dal_testo() {
        assert_eq!(parse_policy("essential"), FunctionPolicy::Essential);
        assert_eq!(parse_policy("complete"), FunctionPolicy::Complete);
        assert_eq!(parse_policy("boh"), FunctionPolicy::Complete);
    }

    #[test]
    fn token_per_la_pagina() {
        let has = |id: u32| id != 99;
        let noun = token(
            TokenKind::Word,
            Some(Cat::Noun),
            Some(5),
            Display::Full,
            1.0,
        );
        let d = &to_dto(&[noun], &has)[0];
        assert_eq!(
            (d.s, d.e, d.kind, d.display, d.picto, d.image),
            (3, 8, "word", "full", Some(5), true)
        );
        assert!(!d.doubtful && !d.placeholder);
        // Parola piena senza simbolo: segnaposto; con immagine mancante: segnaposto.
        let none = token(
            TokenKind::Word,
            Some(Cat::Verb),
            None,
            Display::TextOnly,
            1.0,
        );
        assert!(to_dto(&[none], &has)[0].placeholder);
        let missing = token(
            TokenKind::Word,
            Some(Cat::Noun),
            Some(99),
            Display::Full,
            1.0,
        );
        let m = &to_dto(&[missing], &has)[0];
        assert!(m.placeholder && !m.image);
        // Parola funzionale senza simbolo e punteggiatura: niente segnaposto.
        let prep = token(
            TokenKind::Word,
            Some(Cat::Adp),
            None,
            Display::TextOnly,
            1.0,
        );
        assert!(!to_dto(&[prep], &has)[0].placeholder);
        let punct = token(TokenKind::Punct, None, None, Display::TextOnly, 1.0);
        let p = &to_dto(&[punct], &has)[0];
        assert!(p.kind == "punct" && !p.placeholder && !p.doubtful);
        // Confidenza bassa: da controllare, ma non se è nascosta.
        let shaky = token(
            TokenKind::Word,
            Some(Cat::Noun),
            Some(5),
            Display::Full,
            0.4,
        );
        assert!(to_dto(&[shaky], &has)[0].doubtful);
        let hidden = token(
            TokenKind::Word,
            Some(Cat::Aux),
            Some(5),
            Display::Hidden,
            0.1,
        );
        let h = &to_dto(&[hidden], &has)[0];
        assert!(!h.doubtful && !h.placeholder && h.display == "hidden");
        // Parola sconosciuta: segnaposto e da controllare.
        let unknown = token(TokenKind::Unknown, None, None, Display::TextOnly, 0.0);
        let u = &to_dto(&[unknown], &has)[0];
        assert!(u.doubtful && u.placeholder && u.kind == "unknown");
    }

    #[test]
    fn gruppi_e_segni() {
        let mut head = token(
            TokenKind::Word,
            Some(Cat::Verb),
            Some(5),
            Display::Full,
            1.0,
        );
        head.group = Some(GroupRef {
            id: 4,
            kind: GroupKind::Compound,
            role: GroupRole::Head,
        });
        head.modifiers = Modifiers(Modifiers::PAST | Modifiers::PLURAL);
        let d = &to_dto(&[head], &|_| true)[0];
        assert_eq!((d.group, d.head, d.mods), (4, true, 3));
    }

    /// Con i dati veri (`data/build`, fuori da git): se mancano la prova si salta.
    #[test]
    fn con_il_motore_vero() {
        use caa_engine::engine::Engine;
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data/build");
        if !dir.join("manifest.json").is_file() {
            eprintln!("data/build non presente: prova saltata");
            return;
        }
        let engine: Engine<_> = caa_store::open_engine(&dir).unwrap();
        let has = |id: u32| image_path(&dir, id).is_file();
        let text = "Ieri sono andato al mare. I ragazzi hanno fatto colazione!";
        let dto = to_dto(&engine.symbolize_text(text), &has);
        // Gli intervalli sono UTF-16 e ritagliano le parole del testo.
        let units: Vec<u16> = text.encode_utf16().collect();
        let word = |t: &TokenDto| String::from_utf16(&units[t.s as usize..t.e as usize]).unwrap();
        let by = |w: &str| {
            dto.iter()
                .find(|t| word(t) == w)
                .unwrap_or_else(|| panic!("manca {w}"))
        };
        // "sono" e' un ausiliare nascosto, "andato" porta il passato, "ragazzi" il plurale.
        assert_eq!(by("sono").display, "hidden");
        assert_eq!((by("andato").display, by("andato").mods & 2), ("full", 2));
        assert_eq!(by("ragazzi").mods & 1, 1);
        // "hanno fatto colazione" e' un'espressione: la testa e' "fatto", gli altri sono nascosti.
        assert!(
            by("fatto").head
                && by("colazione").display == "hidden"
                && by("hanno").display == "hidden"
        );
        assert!(dto
            .iter()
            .filter(|t| t.kind == "punct")
            .all(|t| !t.placeholder && !t.doubtful));
    }
}
