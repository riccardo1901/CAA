//! Decodifica sulla frase (SPEC.md, fase 7): Viterbi per scegliere la combinazione di letture con
//! il punteggio migliore e forward-backward per la probabilità a posteriori di ogni lettura
//! (la confidenza). Lo stato è la coppia (lettura precedente, lettura corrente), perché le
//! transizioni sono trigrammi di categoria e alcune regole guardano due parole indietro.
//!
//! Punteggio di una combinazione = somma, in logaritmo, di:
//! * il prior della lettura data la forma (dal treebank), per `Weights::prior`;
//! * il trigramma di categoria, per `Weights::trans`;
//! * le regole di contesto pesate (accordo, pronome soggetto, "non", preposizione e modale +
//!   infinito) e il bonus della maiuscola.

use crate::tagger::{state_of, BOS, EOS};
use crate::types::{Cat, Feats, Mood};

/// Pesi delle regole (SPEC.md: i valori iniziali vanno tarati sul corpus, non a sentimento).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Weights {
    pub prior: f32,
    /// Quanto dividere il prior per la frequenza della categoria (0 = niente, 1 = emissione piena).
    pub unigram: f32,
    pub trans: f32,
    pub agree: f32,
    pub disagree: f32,
    pub subject: f32,
    pub non: f32,
    pub prep_inf: f32,
    pub modal_inf: f32,
    /// Tempo composto o perifrasi completati. SPEC.md propone +1,0, ma già da 0,25 il treebank
    /// perde parole (forza il verbo contro l'aggettivo); 0,1 è il valore più alto che non cambia
    /// la misura e basta a scegliere il participio fra le letture dello stesso verbo.
    pub group: f32,
    pub capital: f32,
    /// Lettura di nome proprio per una parola scritta in minuscolo (il prior non distingue le maiuscole).
    pub lower_propn: f32,
    /// Temperatura delle probabilità a posteriori (non cambia la scelta, solo la confidenza).
    pub temperature: f32,
}

impl Default for Weights {
    /// I valori della specifica (non toccati dalla taratura: nessuna modifica migliorava in modo
    /// apprezzabile); la temperatura viene dalla calibrazione della confidenza (`caa-eval tara`).
    fn default() -> Self {
        Weights {
            prior: 1.0,
            unigram: 1.0,
            trans: 1.0,
            agree: 1.0,
            disagree: -2.0,
            subject: 1.5,
            non: 1.0,
            prep_inf: 0.5,
            modal_inf: 1.5,
            group: 0.1,
            capital: 2.0,
            lower_propn: -3.0,
            temperature: 1.5,
        }
    }
}

/// Una lettura candidata di un token.
#[derive(Debug, Clone)]
pub struct Node {
    pub cat: Cat,
    pub feats: Feats,
    pub lemma: String,
    /// Logaritmo naturale del prior della lettura.
    pub prior: f32,
    /// Maiuscola a metà frase con lettura di nome proprio: riceve il bonus.
    pub capital: bool,
    /// Lettura di nome proprio da una parola in minuscolo.
    pub lower_propn: bool,
}

/// Esito: indice della lettura scelta e probabilità a posteriori di ogni lettura, per token.
#[derive(Debug, Clone, PartialEq)]
pub struct Decoded {
    pub best: Vec<usize>,
    pub posterior: Vec<Vec<f32>>,
}

const NEG_INF: f32 = f32::NEG_INFINITY;

fn is_verb(cat: Cat) -> bool {
    matches!(cat, Cat::Verb | Cat::Aux | Cat::Modal)
}

fn is_infinitive(n: &Node) -> bool {
    is_verb(n.cat) && n.feats.mood == Some(Mood::Inf)
}

fn is_finite(n: &Node) -> bool {
    is_verb(n.cat)
        && matches!(n.feats.mood, Some(Mood::Ind | Mood::Sub | Mood::Cond))
        && n.feats.person.is_some()
}

fn is_participle(n: &Node) -> bool {
    is_verb(n.cat) && n.feats.mood == Some(Mood::Part)
}

/// avere/essere a un modo finito.
fn is_auxiliary(n: &Node) -> bool {
    is_verb(n.cat) && matches!(n.lemma.as_str(), "essere" | "avere") && is_finite(n)
}

/// `a` e `b` (anche a distanza, con la riga sopra) formano un tempo composto o una perifrasi.
fn completes_group(a: &Node, b: &Node) -> bool {
    (is_auxiliary(a) && is_participle(b))
        || (is_verb(a.cat)
            && a.lemma == "stare"
            && is_finite(a)
            && is_verb(b.cat)
            && b.feats.mood == Some(Mood::Ger))
}

/// Persona e numero di un pronome personale soggetto.
fn subject_person(n: &Node) -> Option<(u8, crate::types::Number)> {
    use crate::types::Number::{P, S};
    if n.cat != Cat::Pron {
        return None;
    }
    Some(match n.lemma.as_str() {
        "io" => (1, S),
        "tu" => (2, S),
        "lui" | "lei" | "egli" | "ella" | "esso" | "essa" => (3, S),
        "noi" => (1, P),
        "voi" => (2, P),
        "loro" | "essi" | "esse" => (3, P),
        _ => return None,
    })
}

fn subject_agrees(pronoun: &Node, verb: &Node) -> bool {
    subject_person(pronoun).is_some_and(|(p, n)| {
        is_finite(verb) && verb.feats.person == Some(p) && verb.feats.number == Some(n)
    })
}

fn agreement(a: &Feats, b: &Feats, w: &Weights) -> f32 {
    fn eq<T: PartialEq>(x: Option<T>, y: Option<T>) -> Option<bool> {
        Some(x? == y?)
    }
    let (g, n) = (eq(a.gender, b.gender), eq(a.number, b.number));
    if g.is_none() && n.is_none() {
        0.0
    } else if g.unwrap_or(true) && n.unwrap_or(true) {
        w.agree
    } else {
        w.disagree
    }
}

/// Regole di contesto fra tre letture consecutive (`None` = inizio o fine della frase).
pub fn local_score(z: Option<&Node>, a: Option<&Node>, b: Option<&Node>, w: &Weights) -> f32 {
    let Some(b) = b else { return 0.0 };
    let mut s = 0.0;
    if let Some(a) = a {
        let det_like = matches!(a.cat, Cat::Art | Cat::Det | Cat::Adj)
            && matches!(b.cat, Cat::Noun | Cat::Adj);
        if det_like || (a.cat == Cat::Noun && b.cat == Cat::Adj) {
            s += agreement(&a.feats, &b.feats, w);
        }
        if a.lemma == "non" && (is_verb(b.cat) || b.cat == Cat::Clitic) {
            s += w.non;
        }
        if a.cat == Cat::Adp
            && matches!(a.lemma.as_str(), "a" | "di" | "per" | "da")
            && is_infinitive(b)
        {
            s += w.prep_inf;
        }
        if a.cat == Cat::Modal && is_infinitive(b) {
            s += w.modal_inf;
        }
        // Gruppi verbali completati: ausiliare + participio, stare + gerundio, e il passivo con
        // "stato" ("è stato chiamato"): il bonus va alla lettura che li completa.
        if completes_group(a, b) {
            s += w.group;
        }
        if subject_agrees(a, b) {
            s += w.subject;
        }
        if let Some(z) = z {
            // Con un clitico in mezzo ("devo farlo") o una negazione ("lui non va").
            // Con un avverbio ("era già uscito") o "stato" in mezzo ("è stato chiamato").
            if (a.cat == Cat::Adv || is_participle(a)) && is_auxiliary(z) && completes_group(z, b) {
                s += w.group;
            }
            if z.cat == Cat::Modal && a.cat == Cat::Clitic && is_infinitive(b) {
                s += w.modal_inf;
            }
            if (a.lemma == "non" || a.cat == Cat::Clitic) && subject_agrees(z, b) {
                s += w.subject;
            }
        }
    }
    s
}

/// Punteggio di una lettura da sola: prior, bonus della maiuscola, penalità del nome proprio in
/// minuscolo.
fn unary_score(x: &Node, w: &Weights) -> f32 {
    w.prior * x.prior
        + if x.capital { w.capital } else { 0.0 }
        + if x.lower_propn { w.lower_propn } else { 0.0 }
}

/// Un livello del reticolo: i token reali hanno più letture, `BOS` e `EOS` una sola.
struct Layer<'a> {
    nodes: Vec<Option<&'a Node>>,
    states: Vec<usize>,
}

fn build<'a>(tokens: &'a [Vec<Node>]) -> Vec<Layer<'a>> {
    let edge = |s| Layer {
        nodes: vec![None],
        states: vec![s],
    };
    let mut layers = vec![edge(BOS), edge(BOS)];
    for t in tokens {
        layers.push(Layer {
            nodes: t.iter().map(Some).collect(),
            states: t.iter().map(|n| state_of(n.cat)).collect(),
        });
    }
    layers.push(edge(EOS));
    layers
}

fn logsumexp(xs: impl Iterator<Item = f32>) -> f32 {
    let v: Vec<f32> = xs.collect();
    let m = v.iter().copied().fold(NEG_INF, f32::max);
    if m == NEG_INF {
        return NEG_INF;
    }
    m + v.iter().map(|x| (x - m).exp()).sum::<f32>().ln()
}

/// Decodifica una frase. `trans(c2, c1, c)` è il logaritmo di P(c | c2, c1).
pub fn decode(
    trans: &dyn Fn(usize, usize, usize) -> f32,
    tokens: &[Vec<Node>],
    w: &Weights,
) -> Decoded {
    if tokens.is_empty() {
        return Decoded {
            best: Vec::new(),
            posterior: Vec::new(),
        };
    }
    assert!(
        tokens.iter().all(|t| !t.is_empty()),
        "ogni token deve avere almeno una lettura"
    );
    let layers = build(tokens);
    let n = layers.len();
    let unary =
        |k: usize, b: usize| -> f32 { layers[k].nodes[b].map_or(0.0, |x| unary_score(x, w)) };
    let step = |k: usize, z: usize, a: usize, b: usize| -> f32 {
        let (lz, la, lb) = (&layers[k - 2], &layers[k - 1], &layers[k]);
        w.trans * trans(lz.states[z], la.states[a], lb.states[b])
            + local_score(lz.nodes[z], la.nodes[a], lb.nodes[b], w)
    };
    let size = |k: usize| layers[k - 1].nodes.len() * layers[k].nodes.len();

    // Viterbi.
    let mut delta: Vec<Vec<f32>> = vec![Vec::new(); n];
    let mut back: Vec<Vec<usize>> = vec![Vec::new(); n];
    delta[1] = vec![0.0];
    for k in 2..n {
        let (rz, ra, rb) = (
            layers[k - 2].nodes.len(),
            layers[k - 1].nodes.len(),
            layers[k].nodes.len(),
        );
        delta[k] = vec![NEG_INF; size(k)];
        back[k] = vec![0; size(k)];
        for a in 0..ra {
            for b in 0..rb {
                let (mut best, mut arg) = (NEG_INF, 0);
                for z in 0..rz {
                    let s = delta[k - 1][z * ra + a] + step(k, z, a, b);
                    if s > best {
                        (best, arg) = (s, z);
                    }
                }
                delta[k][a * rb + b] = best + unary(k, b);
                back[k][a * rb + b] = arg;
            }
        }
    }
    let ra = layers[n - 2].nodes.len();
    let mut idx = vec![0usize; n];
    // A parità di punteggio vince la prima lettura (ordine provvisorio di M4).
    idx[n - 2] = (0..ra).fold(0, |b, a| {
        if delta[n - 1][a] > delta[n - 1][b] {
            a
        } else {
            b
        }
    });
    for k in (2..n).rev() {
        let rb = layers[k].nodes.len();
        idx[k - 2] = back[k][idx[k - 1] * rb + idx[k]];
    }
    let best = idx[2..n - 1].to_vec();

    // Forward-backward con temperatura.
    let t = w.temperature.max(1e-3);
    let mut alpha: Vec<Vec<f32>> = vec![Vec::new(); n];
    alpha[1] = vec![0.0];
    for k in 2..n {
        let (rz, ra, rb) = (
            layers[k - 2].nodes.len(),
            layers[k - 1].nodes.len(),
            layers[k].nodes.len(),
        );
        alpha[k] = vec![NEG_INF; size(k)];
        for a in 0..ra {
            for b in 0..rb {
                let acc =
                    logsumexp((0..rz).map(|z| alpha[k - 1][z * ra + a] + step(k, z, a, b) / t));
                alpha[k][a * rb + b] = acc + unary(k, b) / t;
            }
        }
    }
    let mut beta: Vec<Vec<f32>> = vec![Vec::new(); n];
    beta[n - 1] = vec![0.0; size(n - 1)];
    for k in (1..n - 1).rev() {
        let (ra, rb, rc) = (
            layers[k - 1].nodes.len(),
            layers[k].nodes.len(),
            layers[k + 1].nodes.len(),
        );
        beta[k] = vec![NEG_INF; ra * rb];
        for a in 0..ra {
            for b in 0..rb {
                // Transizione verso il livello k+1: qui il "precedente" è a (k-1), poi b (k), poi c (k+1).
                beta[k][a * rb + b] = logsumexp((0..rc).map(|c| {
                    unary(k + 1, c) / t + step(k + 1, a, b, c) / t + beta[k + 1][b * rc + c]
                }));
            }
        }
    }
    let z_total = logsumexp((0..ra).map(|a| alpha[n - 1][a] + beta[n - 1][a]));
    let mut posterior = Vec::with_capacity(tokens.len());
    for k in 2..n - 1 {
        let (ra, rb) = (layers[k - 1].nodes.len(), layers[k].nodes.len());
        let mut p: Vec<f32> = (0..rb)
            .map(|b| {
                (0..ra)
                    .map(|a| (alpha[k][a * rb + b] + beta[k][a * rb + b] - z_total).exp())
                    .sum::<f32>()
            })
            .collect();
        let sum: f32 = p.iter().sum();
        if sum > 0.0 {
            p.iter_mut().for_each(|x| *x /= sum);
        }
        posterior.push(p);
    }
    Decoded { best, posterior }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Gender, Number};

    fn node(cat: Cat, lemma: &str, prior: f32) -> Node {
        Node {
            cat,
            feats: Feats::default(),
            lemma: lemma.to_string(),
            prior,
            capital: false,
            lower_propn: false,
        }
    }

    /// Trigrammi sintetici: dopo un articolo il nome è molto più probabile del verbo.
    fn trans(c2: usize, c1: usize, c: usize) -> f32 {
        let (art, noun, verb) = (state_of(Cat::Art), state_of(Cat::Noun), state_of(Cat::Verb));
        let base = -3.0;
        if c1 == art && c == noun {
            -0.2
        } else if c1 == art && c == verb {
            -6.0
        } else if c2 == BOS && c1 == BOS && c == art {
            -0.5
        } else {
            base
        }
    }

    /// Punteggio di una combinazione calcolato a mano, indipendente da `decode`.
    fn brute(tokens: &[Vec<Node>], w: &Weights) -> Vec<(Vec<usize>, f32)> {
        let mut paths: Vec<Vec<usize>> = vec![vec![]];
        for t in tokens {
            paths = paths
                .into_iter()
                .flat_map(|p| (0..t.len()).map(move |j| [p.clone(), vec![j]].concat()))
                .collect();
        }
        paths
            .into_iter()
            .map(|p| {
                let mut seq: Vec<Option<&Node>> = vec![None, None];
                let mut st = vec![BOS, BOS];
                for (t, &j) in tokens.iter().zip(&p) {
                    seq.push(Some(&t[j]));
                    st.push(state_of(t[j].cat));
                }
                seq.push(None);
                st.push(EOS);
                let mut s = 0.0;
                for k in 2..seq.len() {
                    s += w.trans * trans(st[k - 2], st[k - 1], st[k])
                        + local_score(seq[k - 2], seq[k - 1], seq[k], w);
                    if let Some(x) = seq[k] {
                        s += unary_score(x, w);
                    }
                }
                (p, s)
            })
            .collect()
    }

    fn lattice() -> Vec<Vec<Node>> {
        let mut n_agree = node(Cat::Noun, "porta", -0.7);
        n_agree.feats = Feats {
            gender: Some(Gender::F),
            number: Some(Number::S),
            ..Feats::default()
        };
        let mut art = node(Cat::Art, "la", -0.4);
        art.feats = Feats {
            gender: Some(Gender::F),
            number: Some(Number::S),
            ..Feats::default()
        };
        vec![
            vec![
                art,
                node(Cat::Clitic, "la", -1.5),
                node(Cat::Noun, "la", -3.0),
            ],
            vec![n_agree, node(Cat::Verb, "portare", -0.7)],
            vec![node(Cat::Punct, ".", 0.0)],
        ]
    }

    #[test]
    fn la_scelta_coincide_con_il_calcolo_esaustivo() {
        let w = Weights::default();
        let tokens = lattice();
        let d = decode(&trans, &tokens, &w);
        let all = brute(&tokens, &w);
        let best = all.iter().max_by(|a, b| a.1.total_cmp(&b.1)).unwrap();
        assert_eq!(d.best, best.0);
        // Dopo l'articolo il nome vince sul verbo, a parità di prior.
        assert_eq!(d.best, vec![0, 0, 0]);
    }

    #[test]
    fn le_probabilita_a_posteriori_coincidono_con_il_calcolo_esaustivo() {
        for temperature in [1.0, 2.5] {
            let w = Weights {
                temperature,
                ..Weights::default()
            };
            let tokens = lattice();
            let d = decode(&trans, &tokens, &w);
            let all = brute(&tokens, &w);
            let z = logsumexp(all.iter().map(|(_, s)| s / temperature));
            for (k, probs) in d.posterior.iter().enumerate() {
                assert!(
                    (probs.iter().sum::<f32>() - 1.0).abs() < 1e-4,
                    "token {k}: somma {}",
                    probs.iter().sum::<f32>()
                );
                for (j, p) in probs.iter().enumerate() {
                    let expected: f32 = all
                        .iter()
                        .filter(|(path, _)| path[k] == j)
                        .map(|(_, s)| (s / temperature - z).exp())
                        .sum();
                    assert!(
                        (p - expected).abs() < 1e-4,
                        "token {k} lettura {j}: {p} contro {expected} (T={temperature})"
                    );
                }
            }
        }
    }

    #[test]
    fn la_temperatura_non_cambia_la_scelta_ma_la_confidenza() {
        let tokens = lattice();
        let cold = decode(
            &trans,
            &tokens,
            &Weights {
                temperature: 0.5,
                ..Weights::default()
            },
        );
        let hot = decode(
            &trans,
            &tokens,
            &Weights {
                temperature: 4.0,
                ..Weights::default()
            },
        );
        assert_eq!(cold.best, hot.best);
        assert!(cold.posterior[1][0] > hot.posterior[1][0]);
    }

    #[test]
    fn una_sola_lettura_per_token_ha_probabilita_uno() {
        let tokens = vec![
            vec![node(Cat::Noun, "casa", 0.0)],
            vec![node(Cat::Punct, ".", 0.0)],
        ];
        let d = decode(&trans, &tokens, &Weights::default());
        assert_eq!(d.best, vec![0, 0]);
        assert!(d.posterior.iter().all(|p| (p[0] - 1.0).abs() < 1e-5));
        assert!(decode(&trans, &[], &Weights::default()).best.is_empty());
    }

    #[test]
    fn regole_di_contesto() {
        let w = Weights::default();
        let mut pron = node(Cat::Pron, "lei", 0.0);
        pron.feats = Feats {
            person: Some(3),
            number: Some(Number::S),
            ..Feats::default()
        };
        let mut verb = node(Cat::Verb, "portare", 0.0);
        verb.feats = Feats {
            mood: Some(Mood::Ind),
            person: Some(3),
            number: Some(Number::S),
            ..Feats::default()
        };
        let mut verb_p = verb.clone();
        verb_p.feats.number = Some(Number::P);
        let clitic = node(Cat::Clitic, "la", 0.0);
        // pronome soggetto + verbo coerente
        assert_eq!(local_score(None, Some(&pron), Some(&verb), &w), w.subject);
        assert_eq!(local_score(None, Some(&pron), Some(&verb_p), &w), 0.0);
        // pronome + clitico + verbo: la regola guarda due parole indietro
        assert_eq!(
            local_score(Some(&pron), Some(&clitic), Some(&verb), &w),
            w.subject
        );
        // "non" + verbo; preposizione + infinito; modale + infinito (anche con clitico in mezzo)
        let non = node(Cat::Adv, "non", 0.0);
        assert_eq!(local_score(None, Some(&non), Some(&verb), &w), w.non);
        let mut inf = node(Cat::Verb, "studiare", 0.0);
        inf.feats.mood = Some(Mood::Inf);
        let da = node(Cat::Adp, "da", 0.0);
        assert_eq!(local_score(None, Some(&da), Some(&inf), &w), w.prep_inf);
        let modal = node(Cat::Modal, "dovere", 0.0);
        assert_eq!(local_score(None, Some(&modal), Some(&inf), &w), w.modal_inf);
        assert_eq!(
            local_score(Some(&modal), Some(&clitic), Some(&inf), &w),
            w.modal_inf
        );
        // accordo: articolo e nome
        let mut art = node(Cat::Art, "il", 0.0);
        art.feats = Feats {
            gender: Some(Gender::M),
            number: Some(Number::S),
            ..Feats::default()
        };
        let mut noun_f = node(Cat::Noun, "porta", 0.0);
        noun_f.feats = Feats {
            gender: Some(Gender::F),
            number: Some(Number::S),
            ..Feats::default()
        };
        let mut noun_m = noun_f.clone();
        noun_m.feats.gender = Some(Gender::M);
        assert_eq!(local_score(None, Some(&art), Some(&noun_m), &w), w.agree);
        assert_eq!(local_score(None, Some(&art), Some(&noun_f), &w), w.disagree);
        // tratti ignoti: nessun effetto
        assert_eq!(
            local_score(None, Some(&node(Cat::Art, "il", 0.0)), Some(&noun_f), &w),
            0.0
        );
    }

    #[test]
    fn nome_proprio_in_minuscolo_e_penalizzato() {
        // Stesso prior: senza penalità vince il nome proprio (primo), con la penalità il nome comune.
        let mut propn = node(Cat::Propn, "sasso", -0.5);
        propn.lower_propn = true;
        let tokens = vec![vec![propn.clone(), node(Cat::Noun, "sasso", -0.5)]];
        let flat = Weights {
            lower_propn: 0.0,
            ..Weights::default()
        };
        let flat_trans = |_: usize, _: usize, _: usize| -1.0;
        assert_eq!(decode(&flat_trans, &tokens, &flat).best, vec![0]);
        assert_eq!(
            decode(&flat_trans, &tokens, &Weights::default()).best,
            vec![1]
        );
    }
}
