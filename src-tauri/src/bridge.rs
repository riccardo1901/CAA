//! Collegamento fra l'interfaccia e il motore (M8): ricerca della cartella dei dati, conversione dei
//! token nel formato per la pagina e lettura delle immagini. Niente di Tauri qui, così si prova da solo.

use std::path::{Path, PathBuf};

use caa_engine::engine::{
    Candidate, Display, ForcedPick, FunctionPolicy, FunctionRule, GroupKind, GroupRole,
    PictoReason, PolicyTable, ReadingReason, SenseLocks, Token,
};
use caa_engine::tokenize::TokenKind;
use caa_engine::types::Cat;
use serde::{Deserialize, Serialize};

/// Limiti di una richiesta di simbolizzazione (revisione M8a): senza tetto, un grande incolla
/// bloccherebbe il motore per secondi e produrrebbe decine di MB di risposta.
pub const MAX_PARAGRAPHS: usize = 1000;
pub const MAX_CHARS: usize = 2_000_000;

pub fn check_request(texts: &[String]) -> Result<(), String> {
    if texts.len() > MAX_PARAGRAPHS {
        return Err(format!(
            "troppi paragrafi in una richiesta ({} > {MAX_PARAGRAPHS})",
            texts.len()
        ));
    }
    let chars: usize = texts.iter().map(|t| t.len()).sum();
    if chars > MAX_CHARS {
        return Err(format!(
            "testo troppo lungo in una richiesta ({chars} > {MAX_CHARS} byte)"
        ));
    }
    Ok(())
}

/// Tetti sulle scelte del docente in una richiesta (M8b): sono dati dell'interfaccia, ma un
/// documento enorme o un errore non devono bloccare il motore.
pub const MAX_FORCED: usize = 20_000;
pub const MAX_LOCKS: usize = 5_000;
/// Risultati al massimo di una ricerca libera.
pub const SEARCH_LIMIT: usize = 24;

pub fn check_choices(forced: usize, locks: usize) -> Result<(), String> {
    if forced > MAX_FORCED {
        return Err(format!("troppe scelte nel testo ({forced} > {MAX_FORCED})"));
    }
    if locks > MAX_LOCKS {
        return Err(format!("troppi blocchi di senso ({locks} > {MAX_LOCKS})"));
    }
    Ok(())
}

/// Una scelta del docente su una parola (come arriva dalla pagina). `picto` 0 = nessun simbolo.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ForcedDto {
    pub s: u32,
    pub e: u32,
    pub picto: u32,
}

/// Un paragrafo con le scelte fatte sulle sue parole.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ParaDto {
    pub text: String,
    #[serde(default)]
    pub forced: Vec<ForcedDto>,
}

/// Blocco di senso: il lemma (con la categoria, come "NOUN") prende sempre quel pittogramma.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct LockDto {
    pub lemma: String,
    pub cat: String,
    pub picto: u32,
}

pub fn to_forced(v: &[ForcedDto]) -> Vec<ForcedPick> {
    v.iter()
        .filter(|f| f.s < f.e)
        .map(|f| ForcedPick {
            span_utf16: (f.s, f.e),
            picto: f.picto,
        })
        .collect()
}

/// Blocchi di senso dalla pagina; quelli con categoria sconosciuta o pittogramma 0 si ignorano.
pub fn to_locks(v: &[LockDto]) -> SenseLocks {
    let mut locks = SenseLocks::default();
    for l in v {
        if let (Some(cat), true) = (Cat::from_name(&l.cat), l.picto > 0) {
            locks.insert(&l.lemma, cat, l.picto);
        }
    }
    locks
}

/// Un'alternativa per il menu.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CandidateDto {
    pub picto: u32,
    pub keyword: String,
    pub reason: String,
    /// L'immagine è disponibile nei dati.
    pub image: bool,
}

pub fn candidates_dto(c: &[Candidate], has_image: &dyn Fn(u32) -> bool) -> Vec<CandidateDto> {
    c.iter()
        .map(|c| CandidateDto {
            picto: c.picto.id,
            keyword: c.keyword.clone(),
            reason: c.reason.clone(),
            image: has_image(c.picto.id),
        })
        .collect()
}

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

/// La politica dalla pagina: `complete`, `essential` oppure `custom:articles=reduced;clitics=full;
/// che=text;preps=full;conj=full` (valori `full`, `reduced`, `text`, `hidden`). Nella tabella ciò che manca
/// o non si capisce prende il valore di "Completo"; la tabella è poi normalizzata dal motore.
pub fn parse_policy(s: &str) -> FunctionPolicy {
    match s {
        "essential" => FunctionPolicy::Essential,
        _ => match s.strip_prefix("custom:") {
            Some(list) => FunctionPolicy::Custom(parse_table(list)),
            None => FunctionPolicy::Complete,
        },
    }
}

fn parse_table(list: &str) -> PolicyTable {
    let mut t = PolicyTable::complete();
    for item in list.split(';') {
        let Some((key, value)) = item.split_once('=') else {
            continue;
        };
        let rule = match value.trim() {
            "full" => FunctionRule::Full,
            "reduced" => FunctionRule::Reduced,
            "text" => FunctionRule::TextOnly,
            "hidden" => FunctionRule::Hidden,
            _ => continue,
        };
        match key.trim() {
            "articles" => t.articles = rule,
            "clitics" => t.clitics = rule,
            "che" => t.che = rule,
            "preps" => t.prepositions = rule,
            "conj" => t.conjunctions = rule,
            _ => {}
        }
    }
    t
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
    /// Tipo di gruppo: `compound`, `progressive`, `pronominal`, `multiword` (vuoto se non c'è).
    pub gkind: &'static str,
    pub confidence: f32,
    /// Parola da controllare (confidenza bassa o sconosciuta).
    pub doubtful: bool,
    /// Parola piena senza pittogramma: l'editor mostra il segnaposto tratteggiato.
    pub placeholder: bool,
    /// Lemma e categoria ("NOUN"…) della lettura scelta: servono per il blocco di senso.
    pub lemma: String,
    pub cat: &'static str,
    /// La scelta viene dal docente (non si controlla e non ha segnaposto).
    pub teacher: bool,
    /// Perché il motore ha deciso così, in una riga (menu delle alternative).
    pub why: String,
}

fn cat_label(c: Cat) -> &'static str {
    match c {
        Cat::Noun => "nome",
        Cat::Propn => "nome proprio",
        Cat::Verb => "verbo",
        Cat::Aux => "ausiliare",
        Cat::Modal => "verbo modale",
        Cat::Adj => "aggettivo",
        Cat::Adv => "avverbio",
        Cat::Art => "articolo",
        Cat::Adp => "preposizione",
        Cat::ArtAdp => "preposizione articolata",
        Cat::Pron => "pronome",
        Cat::Clitic => "pronome clitico",
        Cat::Det => "determinante",
        _ => "parola",
    }
}

/// La ragione della scelta del motore in italiano, per il menu ("nome, dal contesto · simbolo dal
/// lemma").
pub fn explain(t: &Token) -> String {
    let reading = match t.reason.reading {
        ReadingReason::Punctuation => "punteggiatura",
        ReadingReason::Literal => "testo",
        ReadingReason::OnlyReading => "unica lettura possibile",
        ReadingReason::BaselinePick => "lettura più probabile",
        ReadingReason::Tagger => "dal contesto della frase",
        ReadingReason::Capital => "maiuscola: nome proprio",
        ReadingReason::ArasaacKey => "parola del lessico dei pittogrammi",
        ReadingReason::Typo => "forse un errore di battitura",
        ReadingReason::SuffixGuess => "forma sconosciuta, ipotesi dal finale",
        ReadingReason::NoReading => "parola sconosciuta",
    };
    let picto = match t.reason.picto {
        PictoReason::NoSymbol => "nessun simbolo disponibile",
        PictoReason::Curated => "scelta curata",
        PictoReason::ExactForm => "parola esatta",
        PictoReason::Singular => "dal singolare",
        PictoReason::Lemma => "dalla forma base",
        PictoReason::PluralForm => "dal plurale",
        PictoReason::IgnoringCategory => "da un'altra categoria grammaticale",
        PictoReason::NumberWord => "numero",
        PictoReason::Pronominal => "verbo pronominale",
        PictoReason::Multiword => "espressione di più parole",
        PictoReason::Teacher => "scelto da te",
        PictoReason::SenseLock => "stesso senso già scelto nel testo",
    };
    match &t.analysis {
        Some(a) => format!("{}, {reading} · simbolo: {picto}", cat_label(a.cat)),
        None => format!("{reading} · simbolo: {picto}"),
    }
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
            let teacher = t.reason.picto == PictoReason::Teacher;
            let group_head = t.group.is_some_and(|g| g.role == GroupRole::Head);
            TokenDto {
                s: t.span_utf16.0,
                e: t.span_utf16.1,
                kind,
                display,
                picto,
                image,
                mods: t.modifiers.0,
                group: t.group.map_or(0, |g| g.id),
                head: group_head,
                gkind: t.group.map_or("", |g| match g.kind {
                    GroupKind::Compound => "compound",
                    GroupKind::Progressive => "progressive",
                    GroupKind::Pronominal => "pronominal",
                    GroupKind::Multiword => "multiword",
                }),
                confidence: t.confidence,
                doubtful: word && !hidden && t.confidence < DOUBT_THRESHOLD,
                // Una parola piena visibile senza simbolo (o con simbolo non disponibile).
                // (non se il docente ha scelto "nessun simbolo": è una scelta, non una mancanza).
                placeholder: word
                    && !hidden
                    && !(teacher && picto.is_none())
                    && (content || t.kind == TokenKind::Unknown || group_head)
                    && (picto.is_none() || !image),
                lemma: t
                    .analysis
                    .as_ref()
                    .map(|a| a.lemma.clone())
                    .unwrap_or_default(),
                cat: t.analysis.as_ref().map_or("", |a| a.cat.name()),
                teacher,
                why: explain(t),
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
    fn una_richiesta_ha_un_tetto() {
        assert!(check_request(&vec!["casa".to_string(); 1000]).is_ok());
        assert!(check_request(&vec!["casa".to_string(); 1001]).is_err());
        assert!(check_request(&["x".repeat(MAX_CHARS + 1)]).is_err());
        assert!(check_request(&[]).is_ok());
    }

    #[test]
    fn politica_dal_testo() {
        assert_eq!(parse_policy("essential"), FunctionPolicy::Essential);
        assert_eq!(parse_policy("complete"), FunctionPolicy::Complete);
        assert_eq!(parse_policy("boh"), FunctionPolicy::Complete);
        // Tabella personalizzata: ciò che manca o non si capisce vale come in "Completo".
        let p = parse_policy("custom:articles=hidden;che=full;preps=text;conj=boh;x=full;rotto");
        let FunctionPolicy::Custom(t) = p else {
            panic!("{p:?}")
        };
        assert_eq!(
            (t.articles, t.clitics, t.che, t.prepositions, t.conjunctions),
            (
                FunctionRule::Hidden,
                FunctionRule::Full,
                FunctionRule::Full,
                FunctionRule::TextOnly,
                FunctionRule::Full
            )
        );
        assert_eq!(
            parse_policy("custom:"),
            FunctionPolicy::Custom(PolicyTable::complete())
        );
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
        assert_eq!((d.group, d.head, d.mods, d.gkind), (4, true, 3, "compound"));
        // La testa di un gruppo senza simbolo (unione del docente) mostra il segnaposto, anche se è una
        // parola funzionale; senza gruppo no.
        let mut bare = token(TokenKind::Word, Some(Cat::Art), None, Display::Full, 1.0);
        assert!(!to_dto(std::slice::from_ref(&bare), &|_| true)[0].placeholder);
        bare.group = Some(GroupRef {
            id: 1,
            kind: GroupKind::Multiword,
            role: GroupRole::Head,
        });
        let b = &to_dto(&[bare], &|_| true)[0];
        assert!(b.placeholder && b.gkind == "multiword");
    }

    #[test]
    fn scelte_e_blocchi_dalla_pagina() {
        let para: ParaDto = serde_json::from_str(r#"{"text":"pane"}"#).unwrap();
        assert!(para.forced.is_empty());
        let para: ParaDto = serde_json::from_str(
            r#"{"text":"pane","forced":[{"s":0,"e":4,"picto":7},{"s":3,"e":3,"picto":1}]}"#,
        )
        .unwrap();
        // L'intervallo vuoto si scarta; 0 resta (nessun simbolo).
        let forced = to_forced(&para.forced);
        assert_eq!(forced.len(), 1);
        assert_eq!((forced[0].span_utf16, forced[0].picto), ((0, 4), 7));
        let locks = to_locks(&[
            LockDto {
                lemma: "Pesca".into(),
                cat: "NOUN".into(),
                picto: 5,
            },
            LockDto {
                lemma: "x".into(),
                cat: "BOH".into(),
                picto: 6,
            },
            LockDto {
                lemma: "y".into(),
                cat: "NOUN".into(),
                picto: 0,
            },
        ]);
        assert_eq!(locks.get("pesca", Cat::Noun), Some(5));
        assert_eq!(locks.get("x", Cat::Noun), None);
        assert_eq!(locks.get("y", Cat::Noun), None);
        assert!(check_choices(MAX_FORCED, MAX_LOCKS).is_ok());
        assert!(check_choices(MAX_FORCED + 1, 0).is_err());
        assert!(check_choices(0, MAX_LOCKS + 1).is_err());
    }

    #[test]
    fn scelta_del_docente_niente_segnaposto_e_motivo_in_italiano() {
        let mut t = token(
            TokenKind::Word,
            Some(Cat::Noun),
            None,
            Display::TextOnly,
            1.0,
        );
        // Senza scelta: segnaposto. Con "nessun simbolo" scelto dal docente: niente.
        assert!(to_dto(std::slice::from_ref(&t), &|_| true)[0].placeholder);
        t.reason.picto = PictoReason::Teacher;
        let d = &to_dto(&[t], &|_| true)[0];
        assert!(d.teacher && !d.placeholder);
        assert_eq!((d.lemma.as_str(), d.cat), ("x", "NOUN"));
        assert!(
            d.why.contains("nome") && d.why.contains("scelto da te"),
            "{}",
            d.why
        );
        let unknown = token(TokenKind::Unknown, None, None, Display::TextOnly, 0.0);
        let u = &to_dto(&[unknown], &|_| true)[0];
        assert_eq!((u.lemma.as_str(), u.cat), ("", ""));
    }

    #[test]
    fn alternative_per_la_pagina() {
        use caa_engine::engine::PictoRef;
        let c = [Candidate {
            picto: PictoRef { id: 8 },
            keyword: "pane".into(),
            reason: "altro senso".into(),
        }];
        let v = candidates_dto(&c, &|id| id != 8);
        assert_eq!(
            (v[0].picto, v[0].image, v[0].keyword.as_str()),
            (8, false, "pane")
        );
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

        // M8b: alternative, scelta del docente e ricerca con il lessico vero.
        use caa_engine::engine::{DocPrefs, ForcedPick, Request, SenseLocks, UserMemory};
        let prefs = DocPrefs::default();
        let memory = UserMemory::default();
        let text = "Il pane e la pesca.";
        let req = |forced: &[ForcedPick], locks: &SenseLocks| -> Vec<TokenDto> {
            to_dto(
                &engine.symbolize(&Request {
                    text,
                    prefs: &prefs,
                    forced,
                    sense_locks: locks,
                    memory: &memory,
                }),
                &has,
            )
        };
        let none = SenseLocks::default();
        let base = req(&[], &none);
        let span = |t: &TokenDto| (t.s, t.e);
        let pane = base.iter().find(|t| t.lemma == "pane").unwrap();
        let alts = engine.alternatives(
            &Request {
                text,
                prefs: &prefs,
                forced: &[],
                sense_locks: &none,
                memory: &memory,
            },
            span(pane),
        );
        assert!(!alts.is_empty(), "il pane ha almeno un'altra immagine");
        // Scegliere la prima alternativa la mette al posto del simbolo e toglie il segnaposto.
        let pick = [ForcedPick {
            span_utf16: span(pane),
            picto: alts[0].picto.id,
        }];
        let after = req(&pick, &none);
        let p2 = after.iter().find(|t| t.lemma == "pane").unwrap();
        assert!(p2.teacher && p2.picto == Some(alts[0].picto.id) && !p2.doubtful);
        // "Nessun simbolo": niente immagine e niente segnaposto.
        let nothing = [ForcedPick {
            span_utf16: span(pane),
            picto: 0,
        }];
        let p3 = req(&nothing, &none)
            .into_iter()
            .find(|t| t.lemma == "pane")
            .unwrap();
        assert!(p3.picto.is_none() && !p3.placeholder && p3.teacher);
        // La ricerca trova per inizio di parola.
        assert!(!engine.search_pictos("pan", 24).is_empty());
        // Con prefissi corti ("ca") le chiavi sono migliaia: le piu' corte devono venire prima delle
        // altre, non le prime in ordine alfabetico ("caa", "cabina"...).
        let ca = engine.search_pictos("ca", 24);
        let short = ca.iter().filter(|c| c.keyword.chars().count() <= 3).count();
        assert!(
            ca.len() == 24 && short >= 1,
            "{:?}",
            ca.iter().map(|c| &c.keyword).collect::<Vec<_>>()
        );
        assert!(
            engine
                .search_pictos("cas", 24)
                .iter()
                .any(|c| c.keyword == "casa"),
            "«cas» deve trovare «casa»"
        );
        assert!(
            engine
                .search_pictos("ca", 5000)
                .iter()
                .any(|c| c.keyword == "casa"),
            "«ca» deve poter trovare «casa»"
        );
    }
}
