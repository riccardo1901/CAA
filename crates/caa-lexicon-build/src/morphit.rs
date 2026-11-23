//! Lettura del file di Morph-it! (UTF-8): una riga per forma, `forma<TAB>lemma<TAB>etichetta`.

/// Una riga del lessico.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub form: String,
    pub lemma: String,
    pub label: String,
}

/// Esito della lettura.
#[derive(Debug, Default)]
pub struct Parsed {
    pub rows: Vec<Row>,
    /// Numeri di riga (da 1) riparati: separate da spazi invece che da tabulazioni.
    pub repaired_lines: Vec<usize>,
}

/// Legge il lessico. Una riga senza tabulazioni ma con esattamente tre parole separate da spazi
/// ("seppur seppure ADV") è letta come `forma lemma etichetta` e segnalata in `repaired_lines`;
/// qualsiasi altra riga anomala è un errore.
pub fn parse(text: &str) -> Result<Parsed, Vec<String>> {
    let mut out = Parsed::default();
    let mut errors = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let line_no = i + 1;
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        let triple: Option<[&str; 3]> =
            if fields.len() == 3 && fields.iter().all(|f| !f.trim().is_empty()) {
                Some([fields[0], fields[1], fields[2]])
            } else if fields.len() == 1 {
                let words: Vec<&str> = line.split_whitespace().collect();
                (words.len() == 3).then(|| {
                    out.repaired_lines.push(line_no);
                    [words[0], words[1], words[2]]
                })
            } else {
                None
            };
        match triple {
            Some([form, lemma, label]) => out.rows.push(Row {
                form: form.trim().to_string(),
                lemma: lemma.trim().to_string(),
                label: label.trim().to_string(),
            }),
            None => errors.push(format!(
                "riga {line_no}: formato non riconosciuto: {line:?}"
            )),
        }
    }
    if errors.is_empty() {
        Ok(out)
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn righe_normali() {
        let p = parse("caschi\tcasco\tNOUN-M:p\n!\t!\tPON\n").unwrap();
        assert_eq!(p.rows.len(), 2);
        assert_eq!(
            p.rows[0],
            Row {
                form: "caschi".into(),
                lemma: "casco".into(),
                label: "NOUN-M:p".into()
            }
        );
        assert!(p.repaired_lines.is_empty());
    }

    #[test]
    fn riga_con_spazi_riparata_e_segnalata() {
        let p = parse("a\ta\tPRE\nseppur seppure ADV\nseppur seppure CON\n").unwrap();
        assert_eq!(p.repaired_lines, vec![2, 3]);
        assert_eq!(
            p.rows[1],
            Row {
                form: "seppur".into(),
                lemma: "seppure".into(),
                label: "ADV".into()
            }
        );
        assert_eq!(p.rows[2].label, "CON");
    }

    #[test]
    fn righe_irreparabili_fermano_la_lettura() {
        let e = parse("a\ta\tPRE\nsolo due\nuno due tre quattro\na\tb\n\tx\tPRE\n").unwrap_err();
        assert_eq!(e.len(), 4); // "solo due", "uno due tre quattro", "a\tb", "\tx\tPRE"
        assert!(e[0].starts_with("riga 2:"));
    }

    #[test]
    fn accenti_e_fine_riga_windows() {
        let p = parse("perché\tperché\tCON\r\ncittà\tcittà\tNOUN-F:s\r\n").unwrap();
        assert_eq!(p.rows[0].form, "perché");
        assert_eq!(p.rows[1].label, "NOUN-F:s");
    }
}
