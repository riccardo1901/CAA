//! Le correzioni dei docenti come carburante (SPEC.md, «Le correzioni dei docenti»): ogni scelta di un
//! pittogramma diventa una riga anonima (forma, una parola di contesto per lato, lettura, pittogramma). Mai il
//! testo intero, mai il nome di chi scrive, mai nomi propri o numeri. «Invia» copia il registro in `correzioni\`
//! nel Drive con un nome casuale; `caa-eval correzioni` lo aggrega per proporre righe ai file curati.

use std::collections::BTreeMap;
use std::path::Path;

use crate::publish::LibError;

/// Un simbolo personale ha un id che vale solo su quel computer: non è una correzione utile.
const CUSTOM_BASE: u32 = 0x8000_0000;
const MAX_WORD: usize = 25;
/// Tetti: righe tenute in locale, byte letti da un file di registro altrui.
pub const MAX_LOCAL_LINES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// Una riga del registro.
#[derive(Debug, Clone, PartialEq)]
pub struct Correction {
    pub form: String,
    pub before: String,
    pub after: String,
    pub lemma: String,
    pub cat: String,
    /// Il pittogramma scelto (0 = «nessun simbolo»).
    pub picto: u32,
    /// Quello che il motore aveva proposto (0 = niente).
    pub auto: u32,
}

fn letters(w: &str) -> String {
    w.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'')
        .to_string()
}

/// Una parola di contesto: minuscola; con maiuscole (nomi), numeri, o troppo lunga → `_`.
fn context_word(w: &str) -> String {
    let w = letters(w);
    let bad = w.is_empty()
        || w.chars().count() > MAX_WORD
        || w.chars().any(|c| c.is_ascii_digit())
        || w.chars().any(char::is_uppercase)
        || !w.chars().any(char::is_alphabetic);
    if bad {
        "_".into()
    } else {
        w
    }
}

/// Costruisce la riga anonima per la parola `[s, e)` (unità UTF-16) del paragrafo, o `None` se non va registrata:
/// parola senza lemma (sconosciuta, forse un nome), con cifre, troppo lunga, o con la maiuscola in mezzo a una
/// frase (un nome proprio); simbolo personale; spazi vuoti.
pub fn make(
    text: &str,
    s: u32,
    e: u32,
    lemma: &str,
    cat: &str,
    picto: u32,
    auto: u32,
) -> Option<Correction> {
    if picto >= CUSTOM_BASE
        || auto >= CUSTOM_BASE
        || lemma.trim().is_empty()
        || cat.trim().is_empty()
    {
        return None;
    }
    let u: Vec<u16> = text.encode_utf16().collect();
    let (s, e) = (s as usize, e as usize);
    if s >= e || e > u.len() {
        return None;
    }
    let form = String::from_utf16(&u[s..e]).ok()?;
    let form = form.trim().to_string();
    if form.is_empty()
        || form.chars().count() > MAX_WORD
        || form
            .chars()
            .any(|c| c.is_ascii_digit() || c.is_whitespace())
    {
        return None;
    }
    let before_text = String::from_utf16(&u[..s]).ok()?;
    let after_text = String::from_utf16(&u[e..]).ok()?;
    // Maiuscola: va bene solo all'inizio del paragrafo o dopo un punto (una parola comune a inizio frase).
    if form.chars().next().is_some_and(char::is_uppercase) {
        let t = before_text.trim_end();
        let sentence_start = t.is_empty() || t.ends_with(['.', '!', '?', ':', '\n']);
        if !sentence_start {
            return None;
        }
    }
    let b = before_text.split_whitespace().last().unwrap_or("");
    let a = after_text.split_whitespace().next().unwrap_or("");
    let clean = |x: &str| x.replace(['\t', '\n', '\r'], " ");
    Some(Correction {
        form: clean(&form.to_lowercase()),
        before: context_word(b),
        after: context_word(a),
        lemma: clean(&lemma.to_lowercase()),
        cat: clean(cat),
        picto,
        auto,
    })
}

impl Correction {
    pub fn to_line(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}",
            self.form, self.before, self.after, self.lemma, self.cat, self.picto, self.auto
        )
    }

    pub fn from_line(line: &str) -> Option<Correction> {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() != 7 || f[0].is_empty() || f[3].is_empty() {
            return None;
        }
        Some(Correction {
            form: f[0].into(),
            before: f[1].into(),
            after: f[2].into(),
            lemma: f[3].into(),
            cat: f[4].into(),
            picto: f[5].parse().ok()?,
            auto: f[6].parse().ok()?,
        })
    }
}

/// Intestazione dei file inviati.
pub const HEADER: &str = "forma\tprima\tdopo\tlemma\tcat\tpittogramma\tautomatico";

/// Invia le righe: un file nuovo `correzioni\<anonimo>-<data>.tsv` (mai sopra uno esistente). Restituisce il nome.
pub fn send(root: &Path, anon_id: &str, lines: &[String], stamp: &str) -> Result<String, LibError> {
    if lines.is_empty() {
        return Err(LibError::Io("non ci sono correzioni da inviare".into()));
    }
    let ok_id = !anon_id.is_empty()
        && anon_id.len() <= 40
        && anon_id.bytes().all(|b| b.is_ascii_hexdigit());
    let ok_stamp = !stamp.is_empty()
        && stamp.len() <= 24
        && stamp.bytes().all(|b| b.is_ascii_digit() || b == b'-');
    if !ok_id || !ok_stamp {
        return Err(LibError::Io("identificativo non valido".into()));
    }
    let dir = root.join("correzioni");
    std::fs::create_dir_all(&dir)?;
    let mut body = String::from(HEADER);
    body.push('\n');
    for l in lines {
        body.push_str(l);
        body.push('\n');
    }
    let name = format!("{anon_id}-{stamp}.tsv");
    crate::shared::write_new(&dir.join(&name), body.as_bytes())?;
    Ok(name)
}

/// Una riga aggregata: quante volte e da quanti docenti è stata fatta la stessa scelta.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub form: String,
    pub lemma: String,
    pub cat: String,
    pub picto: u32,
    pub auto: u32,
    pub count: usize,
    pub users: usize,
}

/// Legge tutti i registri di una cartella e li aggrega per (forma, lemma, categoria, pittogramma, automatico),
/// dalle più frequenti. File troppo grandi, righe rovinate e intestazioni si saltano.
pub fn aggregate(dir: &Path) -> Vec<Row> {
    type Key = (String, String, String, u32, u32);
    let mut map: BTreeMap<Key, (usize, std::collections::BTreeSet<String>)> = BTreeMap::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".tsv") else {
            continue;
        };
        if std::fs::metadata(e.path()).map_or(true, |m| m.len() > MAX_FILE_BYTES) {
            continue;
        }
        let user = stem.split('-').next().unwrap_or("").to_string();
        let Ok(text) = std::fs::read_to_string(e.path()) else {
            continue;
        };
        for line in text.lines().skip(1) {
            if let Some(c) = Correction::from_line(line) {
                let entry = map
                    .entry((c.form, c.lemma, c.cat, c.picto, c.auto))
                    .or_default();
                entry.0 += 1;
                entry.1.insert(user.clone());
            }
        }
    }
    let mut rows: Vec<Row> = map
        .into_iter()
        .map(|((form, lemma, cat, picto, auto), (count, users))| Row {
            form,
            lemma,
            cat,
            picto,
            auto,
            count,
            users: users.len(),
        })
        .collect();
    rows.sort_by(|a, b| {
        b.users
            .cmp(&a.users)
            .then(b.count.cmp(&a.count))
            .then_with(|| a.lemma.cmp(&b.lemma))
    });
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("caa-corr-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn la_riga_ha_solo_forma_contesto_lettura_e_pittogramma() {
        let c = make("Luca mangia il pane con Anna.", 12, 14, "il", "DET", 5, 6);
        // "il": contesto «mangia» prima e «pane» dopo.
        let c = c.unwrap();
        assert_eq!((c.before.as_str(), c.after.as_str()), ("mangia", "pane"));
        let c = make(
            "Luca mangia il pane con Anna.",
            15,
            19,
            "pane",
            "NOUN",
            9,
            8,
        )
        .unwrap();
        assert_eq!(c.to_line(), "pane\til\tcon\tpane\tNOUN\t9\t8");
        // Il nome proprio come contesto diventa «_»; non c'è mai il testo intero.
        let c = make(
            "Luca mangia il pane con Anna.",
            5,
            11,
            "mangiare",
            "VERB",
            4,
            0,
        )
        .unwrap();
        assert_eq!((c.before.as_str(), c.after.as_str()), ("_", "il"));
        assert!(!c.to_line().contains("Luca") && !c.to_line().contains("Anna"));
        let c = make("Marco vede Anna", 6, 10, "vedere", "VERB", 4, 0).unwrap();
        assert_eq!((c.before.as_str(), c.after.as_str()), ("_", "_"));
    }

    #[test]
    fn nomi_numeri_sconosciute_e_simboli_personali_non_si_registrano() {
        // Maiuscola in mezzo alla frase = nome proprio: nessuna riga. A inizio frase è una parola comune.
        assert!(make("Vedo Marco", 5, 10, "marco", "NOUN", 3, 0).is_none());
        assert!(make("Vedo. Casa mia", 6, 10, "casa", "NOUN", 3, 0).is_some());
        // Senza lemma (parola sconosciuta, forse un nome), con cifre, simbolo personale, offset fuori testo.
        assert!(make("Vedo blorpf", 5, 11, "", "", 3, 0).is_none());
        assert!(make("Vedo a4", 5, 7, "a4", "NOUN", 3, 0).is_none());
        assert!(make("Vedo casa", 5, 9, "casa", "NOUN", 0x8000_0001, 0).is_none());
        assert!(make("Vedo casa", 5, 99, "casa", "NOUN", 3, 0).is_none());
        assert!(make("Vedo casa", 5, 5, "casa", "NOUN", 3, 0).is_none());
        // Gli offset sono UTF-16: con le accentate e un'emoji prima non si sbaglia parola.
        let c = make("Perché 😀 città", 10, 15, "città", "NOUN", 2, 0).unwrap();
        assert_eq!(c.form, "città");
        // Una parola di contesto con cifre o troppo lunga diventa «_».
        let c = make("a4 casa 3x", 3, 7, "casa", "NOUN", 2, 0).unwrap();
        assert_eq!((c.before.as_str(), c.after.as_str()), ("_", "_"));
    }

    #[test]
    fn invia_scrive_un_file_nuovo_e_l_aggregazione_conta_docenti_e_volte() {
        let r = tmp("invia");
        let a = Correction::from_line("pesca\tla\tè\tpesca\tNOUN\t11\t12").unwrap();
        let b = Correction::from_line("sale\til\tdi\tsale\tNOUN\t21\t22").unwrap();
        let lines = vec![a.to_line(), a.to_line(), b.to_line()];
        let name = send(&r, "ab12", &lines, "20261125-101500").unwrap();
        assert_eq!(name, "ab12-20261125-101500.tsv");
        // Mai sopra un file che c'è già; id e data strani rifiutati; niente da inviare.
        assert!(send(&r, "ab12", &lines, "20261125-101500").is_err());
        assert!(send(&r, "../x", &lines, "1").is_err());
        assert!(send(&r, "ab12", &lines, "a/b").is_err());
        assert!(send(&r, "ab12", &[], "1").is_err());
        send(
            &r,
            "cd34",
            std::slice::from_ref(&lines[0]),
            "20261126-090000",
        )
        .unwrap();
        // File rovinati o enormi non fanno danni.
        std::fs::write(
            r.join("correzioni/zz-1.tsv"),
            "intestazione\nriga rovinata\n\t\t\n",
        )
        .unwrap();
        std::fs::write(r.join("correzioni/note.txt"), "no").unwrap();
        let rows = aggregate(&r.join("correzioni"));
        assert_eq!(rows.len(), 2);
        assert_eq!(
            (rows[0].lemma.as_str(), rows[0].count, rows[0].users),
            ("pesca", 3, 2)
        );
        assert_eq!(
            (rows[1].lemma.as_str(), rows[1].count, rows[1].users),
            ("sale", 1, 1)
        );
        assert!(aggregate(&r.join("non-c-e")).is_empty());
        std::fs::remove_dir_all(&r).unwrap();
    }
}
