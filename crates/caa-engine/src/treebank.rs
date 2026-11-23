//! Lettura dei treebank in formato CoNLL-U (Universal Dependencies) e conversione delle categorie
//! nelle nostre 18 (SPEC.md, "Treebank per le statistiche del tagger"). Testo puro: serve alla build
//! del tagger e alle misure di `caa-eval`.
//!
//! Le unità sono i **token di superficie**, come li vede il motore: una preposizione articolata
//! ("dalla" = da + la) è un solo token `ArtAdp`, un verbo con clitico ("dammi") è un solo verbo.

use crate::types::Cat;

/// Un token di superficie del treebank.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UdToken {
    pub form: String,
    /// Lemma in minuscolo.
    pub lemma: String,
    /// `None` per le categorie senza corrispondenza (X, ecc.).
    pub cat: Option<Cat>,
}

#[derive(Debug, Clone)]
pub struct Sentence {
    pub id: String,
    /// Testo originale (`# text = …`).
    pub text: String,
    pub tokens: Vec<UdToken>,
}

/// Categoria nostra da UPOS, tratti e relazione sintattica.
///
/// * `AUX` con relazione `cop` (copulativo: "è stanco") è un verbo pieno (SPEC.md, fase 5: essere e
///   avere non seguiti da participio restano verbi pieni); gli altri `AUX` sono ausiliari.
/// * `potere`, `dovere`, `volere` sono modali.
/// * `DET` con `PronType=Art` è un articolo; `PRON` con `PronType=Clit` o `Clitic=Yes` è un clitico
///   (ISDT usa la seconda forma per "si", "mi", "ne").
pub fn map_cat(upos: &str, lemma: &str, feats: &str, deprel: &str) -> Option<Cat> {
    let has = |f: &str| feats.split('|').any(|x| x == f);
    let modal = matches!(lemma, "potere" | "dovere" | "volere");
    Some(match upos {
        "NOUN" => Cat::Noun,
        "PROPN" => Cat::Propn,
        "VERB" | "AUX" if modal => Cat::Modal,
        "VERB" => Cat::Verb,
        "AUX" if deprel.starts_with("cop") => Cat::Verb,
        "AUX" => Cat::Aux,
        "ADJ" => Cat::Adj,
        "ADV" => Cat::Adv,
        "DET" if has("PronType=Art") => Cat::Art,
        "DET" => Cat::Det,
        "NUM" => Cat::Num,
        "ADP" => Cat::Adp,
        "PRON" if has("PronType=Clit") || has("Clitic=Yes") => Cat::Clitic,
        "PRON" => Cat::Pron,
        "CCONJ" | "SCONJ" => Cat::Conj,
        "INTJ" => Cat::Intj,
        "PUNCT" => Cat::Punct,
        "SYM" => Cat::Sym,
        _ => return None,
    })
}

struct Word {
    lemma: String,
    cat: Option<Cat>,
}

/// Token di superficie di un intervallo (parola multipla): ADP + DET → `ArtAdp` con il lemma della
/// preposizione; verbo + clitico → il verbo; negli altri casi la prima parola.
fn merge_range(form: &str, words: &[Word]) -> UdToken {
    let first = &words[0];
    let has_art = words
        .iter()
        .any(|w| matches!(w.cat, Some(Cat::Art | Cat::Det)));
    let (cat, lemma) = if first.cat == Some(Cat::Adp) && has_art {
        (Some(Cat::ArtAdp), first.lemma.clone())
    } else {
        (first.cat, first.lemma.clone())
    };
    UdToken {
        form: form.to_string(),
        lemma,
        cat,
    }
}

/// Legge un file CoNLL-U. Le righe malformate si saltano (il treebank è un dato esterno).
pub fn parse_conllu(text: &str) -> Vec<Sentence> {
    let mut out = Vec::new();
    let mut id = String::new();
    let mut sentence_text = String::new();
    let mut tokens: Vec<UdToken> = Vec::new();
    // Intervallo aperto: (ultimo id coperto, forma, parole raccolte).
    let mut range: Option<(usize, String, Vec<Word>)> = None;

    let flush =
        |id: &mut String, text: &mut String, tokens: &mut Vec<UdToken>, out: &mut Vec<Sentence>| {
            if !tokens.is_empty() {
                out.push(Sentence {
                    id: std::mem::take(id),
                    text: std::mem::take(text),
                    tokens: std::mem::take(tokens),
                });
            } else {
                id.clear();
                text.clear();
            }
        };

    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() {
            if let Some((_, form, words)) = range.take() {
                tokens.push(merge_range(&form, &words));
            }
            flush(&mut id, &mut sentence_text, &mut tokens, &mut out);
        } else if let Some(c) = line.strip_prefix('#') {
            let c = c.trim();
            if let Some(v) = c.strip_prefix("sent_id =") {
                id = v.trim().to_string();
            } else if let Some(v) = c.strip_prefix("text =") {
                sentence_text = v.trim().to_string();
            }
        } else {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() < 8 {
                continue;
            }
            let (idcol, form, lemma, upos, feats, deprel) =
                (cols[0], cols[1], cols[2], cols[3], cols[5], cols[7]);
            if idcol.contains('.') {
                continue; // nodi vuoti
            }
            if let Some((a, b)) = idcol.split_once('-') {
                if let (Ok(_), Ok(last)) = (a.parse::<usize>(), b.parse::<usize>()) {
                    range = Some((last, form.to_string(), Vec::new()));
                }
                continue;
            }
            let Ok(n) = idcol.parse::<usize>() else {
                continue;
            };
            let lemma = lemma.to_lowercase();
            let cat = map_cat(upos, &lemma, feats, deprel);
            match &mut range {
                Some((last, form_range, words)) => {
                    words.push(Word { lemma, cat });
                    if n >= *last {
                        let t = merge_range(form_range, words);
                        range = None;
                        tokens.push(t);
                    }
                }
                None => tokens.push(UdToken {
                    form: form.to_string(),
                    lemma,
                    cat,
                }),
            }
        }
    }
    if let Some((_, form, words)) = range.take() {
        tokens.push(merge_range(&form, &words));
    }
    flush(&mut id, &mut sentence_text, &mut tokens, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
# sent_id = s1
# text = Gas dalla statua dammi.
1\tGas\tgas\tNOUN\tS\tGender=Masc\t0\troot\t0:root\t_
2-3\tdalla\t_\t_\t_\t_\t_\t_\t_\t_
2\tda\tda\tADP\tE\t_\t4\tcase\t4:case\t_
3\tla\til\tDET\tRD\tDefinite=Def|Gender=Fem|Number=Sing|PronType=Art\t4\tdet\t4:det\t_
4\tstatua\tstatua\tNOUN\tS\tGender=Fem|Number=Sing\t1\tnmod\t1:nmod:da\t_
5-6\tdammi\t_\t_\t_\t_\t_\t_\t_\t_
5\tda'\tdare\tVERB\tV\tMood=Imp\t0\troot\t0:root\t_
6\tmi\tmi\tPRON\tPC\tPronType=Clit\t5\tiobj\t5:iobj\t_
7.1\tvuoto\tvuoto\tX\tX\t_\t_\t_\t_\t_
7\t.\t.\tPUNCT\tFS\t_\t1\tpunct\t1:punct\t_

# sent_id = s2
# text = È stanco e Marco vuole lavarsi.
1\tÈ\tessere\tAUX\tVA\t_\t2\tcop\t2:cop\t_
2\tstanco\tstanco\tADJ\tA\t_\t0\troot\t0:root\t_
3\te\te\tCCONJ\tCC\t_\t6\tcc\t6:cc\t_
4\tMarco\tMarco\tPROPN\tSP\t_\t5\tnsubj\t5:nsubj\t_
5\tvuole\tvolere\tVERB\tV\t_\t0\tconj\t0:conj\t_
6\tla\til\tPRON\tPC\tPronType=Clit\t5\tobj\t5:obj\t_
7\tha\tavere\tAUX\tVA\t_\t8\taux\t8:aux\t_
8\tX\tx\tX\tX\t_\t5\tdep\t5:dep\t_
";

    #[test]
    fn legge_frasi_e_token_di_superficie() {
        let s = parse_conllu(SAMPLE);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].id, "s1");
        assert_eq!(s[0].text, "Gas dalla statua dammi.");
        let forms: Vec<&str> = s[0].tokens.iter().map(|t| t.form.as_str()).collect();
        assert_eq!(forms, ["Gas", "dalla", "statua", "dammi", "."]);
    }

    #[test]
    fn preposizione_articolata_e_verbo_con_clitico() {
        let t = &parse_conllu(SAMPLE)[0].tokens;
        assert_eq!((t[1].cat, t[1].lemma.as_str()), (Some(Cat::ArtAdp), "da"));
        assert_eq!((t[3].cat, t[3].lemma.as_str()), (Some(Cat::Verb), "dare"));
        assert_eq!(t[4].cat, Some(Cat::Punct));
    }

    #[test]
    fn copulativo_e_verbo_pieno_modale_e_clitico() {
        let t = &parse_conllu(SAMPLE)[1].tokens;
        assert_eq!(t[0].cat, Some(Cat::Verb)); // "è stanco": copula, verbo pieno
        assert_eq!(t[2].cat, Some(Cat::Conj));
        assert_eq!(t[3].cat, Some(Cat::Propn));
        assert_eq!(t[4].cat, Some(Cat::Modal)); // volere
        assert_eq!(t[5].cat, Some(Cat::Clitic));
        assert_eq!(t[6].cat, Some(Cat::Aux)); // aux, non cop
        assert_eq!(t[7].cat, None); // X: senza corrispondenza
    }

    #[test]
    fn tabella_delle_categorie() {
        let m = |u, l, f, d| map_cat(u, l, f, d);
        assert_eq!(
            m("DET", "il", "PronType=Art|Gender=Masc", "det"),
            Some(Cat::Art)
        );
        assert_eq!(m("DET", "questo", "PronType=Dem", "det"), Some(Cat::Det));
        assert_eq!(m("PRON", "lui", "PronType=Prs", "nsubj"), Some(Cat::Pron));
        // ISDT marca "si" con Clitic=Yes, non con PronType=Clit.
        assert_eq!(
            m("PRON", "si", "Clitic=Yes|Person=3|PronType=Prs", "expl"),
            Some(Cat::Clitic)
        );
        assert_eq!(m("PRON", "che", "PronType=Rel", "nsubj"), Some(Cat::Pron));
        assert_eq!(m("SCONJ", "che", "_", "mark"), Some(Cat::Conj));
        assert_eq!(m("NUM", "tre", "NumType=Card", "nummod"), Some(Cat::Num));
        assert_eq!(m("AUX", "potere", "_", "aux"), Some(Cat::Modal));
        assert_eq!(m("VERB", "dovere", "_", "root"), Some(Cat::Modal));
        assert_eq!(m("INTJ", "ciao", "_", "discourse"), Some(Cat::Intj));
        assert_eq!(m("X", "boh", "_", "dep"), None);
    }

    #[test]
    fn file_vuoto_o_malformato() {
        assert!(parse_conllu("").is_empty());
        assert!(parse_conllu("riga senza tabulazioni\n\n# solo commento\n").is_empty());
    }
}
