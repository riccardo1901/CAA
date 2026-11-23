//! Gruppi verbali (SPEC.md, fasi 4 e 5): tempi composti, passivo, perifrasi con "stare" e verbi
//! pronominali. Lavora sulle letture già scelte dalla fase 7 e restituisce, per ogni gruppo, la
//! testa (il verbo che porta il pittogramma), i membri da nascondere e il tempo.
//!
//! Funzione pura su una vista minima dei token, così si prova senza lessico.

use crate::types::{Cat, Feats, Mood, Number, Tense};

/// Quello che serve di un token alla ricerca dei gruppi.
#[derive(Debug, Clone)]
pub struct View {
    /// È una parola (non punteggiatura, numero o simbolo).
    pub word: bool,
    pub cat: Cat,
    /// Lemma della lettura scelta, minuscolo.
    pub lemma: String,
    pub feats: Feats,
    /// Forma normalizzata.
    pub key: String,
    /// Il lessico ha anche una lettura aggettivale della forma (un participio come "chiuso").
    pub also_adjective: bool,
}

/// Segno di tempo da sovrapporre al pittogramma della testa.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tense3 {
    None,
    Past,
    Future,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerbalKind {
    /// avere/essere + participio ("ho mangiato", "sono andato", "è stato chiamato").
    Compound,
    /// stare + gerundio ("sto leggendo").
    Progressive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerbalGroup {
    pub kind: VerbalKind,
    /// Il verbo che porta il pittogramma (participio o gerundio).
    pub head: usize,
    /// Ausiliari da nascondere (ausiliare, ed "stato" nel passivo).
    pub hidden: Vec<usize>,
    pub tense: Tense3,
    /// Pronome riflessivo subito prima del gruppo, della stessa persona ("mi sono lavato").
    pub reflexive: Option<usize>,
}

/// Segno di tempo di una forma verbale semplice o dell'ausiliare di un gruppo.
pub fn tense_mark(f: &Feats, compound: bool) -> Tense3 {
    match (f.mood, f.tense) {
        (Some(Mood::Ind), Some(Tense::Fut)) => Tense3::Future,
        (Some(Mood::Ind), Some(Tense::Impf | Tense::Past)) => Tense3::Past,
        // Tempo composto: il presente dell'ausiliare dà il passato, il condizionale pure.
        (Some(Mood::Ind | Mood::Sub), Some(Tense::Pres)) if compound => Tense3::Past,
        (Some(Mood::Sub | Mood::Cond), _) if compound => Tense3::Past,
        _ => Tense3::None,
    }
}

fn finite(v: &View) -> bool {
    matches!(v.feats.mood, Some(Mood::Ind | Mood::Sub | Mood::Cond)) && v.feats.person.is_some()
}

fn is_aux(v: &View) -> bool {
    v.word && matches!(v.lemma.as_str(), "essere" | "avere") && finite(v)
}

fn is_participle(v: &View) -> bool {
    v.word && matches!(v.cat, Cat::Verb | Cat::Aux | Cat::Modal) && v.feats.mood == Some(Mood::Part)
}

fn is_adverb(v: &View) -> bool {
    v.word && v.cat == Cat::Adv
}

/// Verbi che al passato prossimo vogliono "essere" senza riflessivo (movimento e cambiamento di
/// stato): con questi "essere" + participio è sempre un tempo composto, non un passivo. Elenco
/// chiuso, non previsto dalla specifica (SPEC.md decide solo con il complemento o il prior).
pub const ESSERE_VERBS: [&str; 34] = [
    "andare",
    "venire",
    "arrivare",
    "partire",
    "uscire",
    "entrare",
    "tornare",
    "ritornare",
    "restare",
    "rimanere",
    "cadere",
    "nascere",
    "morire",
    "salire",
    "scendere",
    "diventare",
    "divenire",
    "apparire",
    "scomparire",
    "sparire",
    "scappare",
    "fuggire",
    "crescere",
    "dimagrire",
    "ingrassare",
    "invecchiare",
    "accadere",
    "succedere",
    "costare",
    "durare",
    "piacere",
    "bastare",
    "sembrare",
    "riuscire",
];

const TIME_WORDS: [&str; 7] = [
    "ieri",
    "oggi",
    "stamattina",
    "stasera",
    "stanotte",
    "adesso",
    "poi",
];

/// Il participio è seguito da un complemento di luogo o di tempo ("è chiuso in casa", "è chiuso
/// da ieri")?
fn complement_after(views: &[View], at: usize) -> bool {
    views.get(at + 1).is_some_and(|n| {
        matches!(n.cat, Cat::Adp | Cat::ArtAdp) || TIME_WORDS.contains(&n.key.as_str())
    })
}

/// Primo indice dopo `from` che non sia un avverbio (fino a due avverbi: "era già uscito").
fn skip_adverbs(views: &[View], from: usize) -> usize {
    let mut j = from;
    while j < views.len() && j - from < 2 && is_adverb(&views[j]) {
        j += 1;
    }
    j
}

/// Il clitico riflessivo prima del gruppo concorda in persona e numero con l'ausiliare o il verbo.
pub fn reflexive_agrees(clitic: &View, verb: &Feats) -> bool {
    if !clitic.word || clitic.cat != Cat::Clitic {
        return false;
    }
    let (person, number) = (verb.person, verb.number);
    match clitic.lemma.as_str() {
        "mi" => (person, number) == (Some(1), Some(Number::S)),
        "ti" => (person, number) == (Some(2), Some(Number::S)),
        "ci" => (person, number) == (Some(1), Some(Number::P)),
        "vi" => (person, number) == (Some(2), Some(Number::P)),
        "si" => person == Some(3),
        _ => false,
    }
}

/// Cerca i gruppi verbali nelle letture scelte. I gruppi non si sovrappongono.
pub fn verbal_groups(views: &[View]) -> Vec<VerbalGroup> {
    let mut out: Vec<VerbalGroup> = Vec::new();
    let mut used = vec![false; views.len()];
    let mut i = 0;
    while i < views.len() {
        let v = &views[i];
        let mut found: Option<(VerbalGroup, usize)> = None; // gruppo, ultimo indice
        if !used[i] && is_aux(v) {
            let j = skip_adverbs(views, i + 1);
            if let Some(p) = views.get(j).filter(|p| is_participle(p)) {
                let _ = p;
                // Passivo: essere + stato + participio.
                let passive = v.lemma == "essere" && views[j].lemma == "essere";
                let (head, hidden, last) = if passive {
                    let k = skip_adverbs(views, j + 1);
                    match views
                        .get(k)
                        .filter(|q| is_participle(q) && q.lemma != "essere")
                    {
                        Some(_) => (k, vec![i, j], k),
                        None => (usize::MAX, vec![], j),
                    }
                } else {
                    (j, vec![i], j)
                };
                if head != usize::MAX && !used[head] {
                    // "essere" + participio: tempo composto se il verbo vuole "essere" (andato,
                    // arrivato) o se il participio non è anche un aggettivo; se lo è ("chiuso")
                    // serve un complemento di luogo o di tempo, altrimenti resta "essere" + aggettivo.
                    let ok = v.lemma == "avere"
                        || passive
                        || ESSERE_VERBS.contains(&views[head].lemma.as_str())
                        || !views[head].also_adjective
                        || complement_after(views, head);
                    if ok {
                        let tense = tense_mark(&v.feats, true);
                        found = Some((
                            VerbalGroup {
                                kind: VerbalKind::Compound,
                                head,
                                hidden,
                                tense,
                                reflexive: None,
                            },
                            last.max(head),
                        ));
                    }
                }
            }
        }
        if found.is_none() && !used[i] && v.word && v.lemma == "stare" && finite(v) {
            let j = skip_adverbs(views, i + 1);
            if views
                .get(j)
                .is_some_and(|g| g.word && g.cat == Cat::Verb && g.feats.mood == Some(Mood::Ger))
            {
                found = Some((
                    VerbalGroup {
                        kind: VerbalKind::Progressive,
                        head: j,
                        hidden: vec![i],
                        tense: tense_mark(&v.feats, false),
                        reflexive: None,
                    },
                    j,
                ));
            }
        }
        match found {
            Some((mut g, last)) => {
                // Riflessivo subito prima: "mi sono lavato".
                if i > 0 && !used[i - 1] && reflexive_agrees(&views[i - 1], &v.feats) {
                    g.reflexive = Some(i - 1);
                }
                used[i..=last].fill(true);
                i = last + 1;
                out.push(g);
            }
            None => i += 1,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(
        cat: Cat,
        lemma: &str,
        key: &str,
        mood: Option<Mood>,
        tense: Option<Tense>,
        person: Option<u8>,
        number: Option<Number>,
    ) -> View {
        View {
            word: true,
            cat,
            lemma: lemma.into(),
            feats: Feats {
                mood,
                tense,
                person,
                number,
                ..Feats::default()
            },
            key: key.into(),
            also_adjective: false,
        }
    }
    fn fin(lemma: &str, key: &str, tense: Tense, person: u8) -> View {
        v(
            Cat::Aux,
            lemma,
            key,
            Some(Mood::Ind),
            Some(tense),
            Some(person),
            Some(Number::S),
        )
    }
    fn part(lemma: &str, key: &str) -> View {
        v(
            Cat::Verb,
            lemma,
            key,
            Some(Mood::Part),
            Some(Tense::Past),
            None,
            Some(Number::S),
        )
    }
    fn plain(cat: Cat, lemma: &str, key: &str) -> View {
        v(cat, lemma, key, None, None, None, None)
    }

    #[test]
    fn passato_prossimo_con_avere() {
        let t = [
            fin("avere", "ho", Tense::Pres, 1),
            part("mangiare", "mangiato"),
            plain(Cat::Art, "il", "il"),
        ];
        let g = verbal_groups(&t);
        assert_eq!(g.len(), 1);
        assert_eq!(
            (g[0].kind, g[0].head, g[0].hidden.clone(), g[0].tense),
            (VerbalKind::Compound, 1, vec![0], Tense3::Past)
        );
    }

    #[test]
    fn avverbio_in_mezzo() {
        let t = [
            fin("essere", "era", Tense::Impf, 3),
            plain(Cat::Adv, "già", "già"),
            part("uscire", "uscito"),
        ];
        let g = verbal_groups(&t);
        assert_eq!(
            (g[0].head, g[0].hidden.clone(), g[0].tense),
            (2, vec![0], Tense3::Past)
        );
    }

    #[test]
    fn futuro_e_condizionale() {
        let t = [
            fin("avere", "avrò", Tense::Fut, 1),
            part("finire", "finito"),
        ];
        assert_eq!(verbal_groups(&t)[0].tense, Tense3::Future);
        let mut c = fin("avere", "avrei", Tense::Pres, 1);
        c.feats.mood = Some(Mood::Cond);
        assert_eq!(
            verbal_groups(&[c, part("volere", "voluto")])[0].tense,
            Tense3::Past
        );
    }

    #[test]
    fn passivo_con_stato() {
        let t = [
            fin("essere", "è", Tense::Pres, 3),
            part("essere", "stato"),
            part("chiamare", "chiamato"),
        ];
        let g = verbal_groups(&t);
        assert_eq!(
            (g[0].head, g[0].hidden.clone(), g[0].tense),
            (2, vec![0, 1], Tense3::Past)
        );
    }

    #[test]
    fn essere_senza_participio_resta_verbo_pieno() {
        let t = [
            fin("avere", "ho", Tense::Pres, 1),
            plain(Cat::Noun, "fame", "fame"),
        ];
        assert!(verbal_groups(&t).is_empty());
        let t = [
            fin("essere", "è", Tense::Pres, 3),
            plain(Cat::Adj, "stanco", "stanco"),
        ];
        assert!(verbal_groups(&t).is_empty());
    }

    #[test]
    fn e_chiuso_vuole_un_complemento() {
        let mut chiuso = part("chiudere", "chiuso");
        chiuso.also_adjective = true;
        let e = fin("essere", "è", Tense::Pres, 3);
        // Senza complemento decide il tagger, che qui ha scelto un participio: gruppo.
        // Con participio non aggettivale il gruppo c'è sempre.
        let t = [e.clone(), part("andare", "andato")];
        assert_eq!(verbal_groups(&t).len(), 1);
        // Participio anche aggettivo e nessun complemento: nessun gruppo ("è chiuso").
        assert!(verbal_groups(&[e.clone(), chiuso.clone()]).is_empty());
        // Con un complemento di luogo o di tempo: tempo composto.
        let t = [e.clone(), chiuso.clone(), plain(Cat::ArtAdp, "in", "in")];
        assert_eq!(verbal_groups(&t).len(), 1);
        let t = [e, chiuso, plain(Cat::Adv, "ieri", "ieri")];
        assert_eq!(verbal_groups(&t).len(), 1);
    }

    #[test]
    fn verbi_di_movimento_con_essere_anche_se_il_participio_e_un_aggettivo() {
        let mut arrivate = part("arrivare", "arrivate");
        arrivate.also_adjective = true;
        let t = [fin("essere", "sono", Tense::Pres, 3), arrivate];
        assert_eq!(verbal_groups(&t).len(), 1);
    }

    #[test]
    fn stare_e_gerundio() {
        let t = [
            v(
                Cat::Verb,
                "stare",
                "stava",
                Some(Mood::Ind),
                Some(Tense::Impf),
                Some(3),
                Some(Number::S),
            ),
            v(
                Cat::Verb,
                "dormire",
                "dormendo",
                Some(Mood::Ger),
                Some(Tense::Pres),
                None,
                None,
            ),
        ];
        let g = verbal_groups(&t);
        assert_eq!(
            (g[0].kind, g[0].head, g[0].hidden.clone(), g[0].tense),
            (VerbalKind::Progressive, 1, vec![0], Tense3::Past)
        );
        let mut sto = t.clone();
        sto[0].feats.tense = Some(Tense::Pres);
        assert_eq!(verbal_groups(&sto)[0].tense, Tense3::None);
    }

    #[test]
    fn riflessivo_con_la_stessa_persona() {
        let mi = plain(Cat::Clitic, "mi", "mi");
        let sono = fin("essere", "sono", Tense::Pres, 1);
        let lavato = part("lavare", "lavato");
        let g = verbal_groups(&[mi.clone(), sono.clone(), lavato.clone()]);
        assert_eq!(g[0].reflexive, Some(0));
        // "ti sono lavato" non concorda; "si" va bene con la terza persona.
        let ti = plain(Cat::Clitic, "ti", "ti");
        assert_eq!(
            verbal_groups(&[ti, sono, lavato.clone()])[0].reflexive,
            None
        );
        let si = plain(Cat::Clitic, "si", "si");
        let e = fin("essere", "è", Tense::Pres, 3);
        assert_eq!(verbal_groups(&[si, e, lavato])[0].reflexive, Some(0));
    }

    #[test]
    fn segno_dei_tempi_semplici() {
        let f = |m, t| Feats {
            mood: Some(m),
            tense: Some(t),
            person: Some(3),
            ..Feats::default()
        };
        assert_eq!(tense_mark(&f(Mood::Ind, Tense::Impf), false), Tense3::Past);
        assert_eq!(tense_mark(&f(Mood::Ind, Tense::Past), false), Tense3::Past);
        assert_eq!(tense_mark(&f(Mood::Ind, Tense::Fut), false), Tense3::Future);
        assert_eq!(tense_mark(&f(Mood::Ind, Tense::Pres), false), Tense3::None);
        assert_eq!(tense_mark(&f(Mood::Sub, Tense::Impf), false), Tense3::None);
        assert_eq!(tense_mark(&f(Mood::Cond, Tense::Pres), false), Tense3::None);
        assert_eq!(tense_mark(&f(Mood::Impr, Tense::Pres), false), Tense3::None);
    }
}
