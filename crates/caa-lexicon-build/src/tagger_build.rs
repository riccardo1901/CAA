//! Costruzione di `tagger.bin` dal treebank (SPEC.md, fase 7): trigrammi di categoria con smoothing
//! per interpolazione e conteggi (categoria, lemma) per ogni forma.

use std::collections::{BTreeMap, HashMap};

use caa_engine::lexicon::{pack_span, HEADER_SIZE, SCHEMA};
use caa_engine::norm::normalize_key;
use caa_engine::tagger::{
    state_of, BOS, EOS, MAGIC_TAGGER, N_STATES, PRIOR_RECORD_SIZE, TRIGRAM_BYTES, UNIGRAM_BYTES,
};
use caa_engine::treebank::Sentence;

/// Pesi dell'interpolazione trigramma / bigramma / unigramma.
const LAMBDA: [f64; 3] = [0.70, 0.25, 0.05];
/// Probabilità minima di una categoria (evita logaritmi infiniti).
const FLOOR: f64 = 1e-6;

pub struct TaggerStats {
    pub sentences: usize,
    pub tokens: usize,
    pub forms: usize,
    pub records: usize,
}

pub struct TaggerBuild {
    pub bytes: Vec<u8>,
    pub stats: TaggerStats,
}

/// Trigrammi e probabilità delle singole categorie, entrambi in logaritmo naturale.
fn ln_tables(sentences: &[Sentence]) -> (Vec<f32>, Vec<f32>) {
    let n = N_STATES;
    let mut c3 = vec![0f64; n * n * n];
    let mut c2 = vec![0f64; n * n];
    let mut c1 = vec![0f64; n];
    for s in sentences {
        let mut seq = vec![BOS, BOS];
        seq.extend(s.tokens.iter().filter_map(|t| t.cat).map(state_of));
        seq.push(EOS);
        for w in seq.windows(3) {
            c3[(w[0] * n + w[1]) * n + w[2]] += 1.0;
        }
        for w in seq.windows(2) {
            c2[w[0] * n + w[1]] += 1.0;
        }
        for &x in &seq[2..] {
            c1[x] += 1.0;
        }
    }
    let total: f64 = c1.iter().sum::<f64>().max(1.0);
    let unigram: Vec<f32> = c1
        .iter()
        .map(|&c| ((c / total).max(FLOOR)).ln() as f32)
        .collect();
    let mut out = vec![0f32; n * n * n];
    for a in 0..n {
        for b in 0..n {
            let ctx3: f64 = (0..n).map(|c| c3[(a * n + b) * n + c]).sum();
            let ctx2: f64 = (0..n).map(|c| c2[b * n + c]).sum();
            for c in 0..n {
                let p3 = if ctx3 > 0.0 {
                    c3[(a * n + b) * n + c] / ctx3
                } else {
                    0.0
                };
                let p2 = if ctx2 > 0.0 {
                    c2[b * n + c] / ctx2
                } else {
                    0.0
                };
                let p1 = c1[c] / total;
                // Senza contesto osservato il peso passa ai livelli più bassi.
                let (l3, l2, l1) = match (ctx3 > 0.0, ctx2 > 0.0) {
                    (true, _) => (LAMBDA[0], LAMBDA[1], LAMBDA[2]),
                    (false, true) => (0.0, LAMBDA[0] + LAMBDA[1], LAMBDA[2]),
                    _ => (0.0, 0.0, 1.0),
                };
                let p = (l3 * p3 + l2 * p2 + l1 * p1).max(FLOOR);
                out[(a * n + b) * n + c] = p.ln() as f32;
            }
        }
    }
    (out, unigram)
}

/// Costruisce `tagger.bin` con l'identificativo di build dato.
pub fn build_tagger(sentences: &[Sentence], build_id: u64) -> Result<TaggerBuild, String> {
    // forma normalizzata -> categoria -> (conteggio, lemma -> conteggio)
    type Lemmas = HashMap<String, u32>;
    let mut forms: BTreeMap<String, BTreeMap<u8, (u32, Lemmas)>> = BTreeMap::new();
    let mut tokens = 0;
    for s in sentences {
        for t in &s.tokens {
            let Some(cat) = t.cat else { continue };
            tokens += 1;
            let e = forms
                .entry(normalize_key(&t.form))
                .or_default()
                .entry(cat.as_u8())
                .or_default();
            e.0 += 1;
            *e.1.entry(t.lemma.clone()).or_default() += 1;
        }
    }

    let mut strings: Vec<u8> = Vec::new();
    let mut string_pos: HashMap<String, u32> = HashMap::new();
    let mut records: Vec<u8> = Vec::new();
    let mut n_records = 0usize;
    let mut builder = fst::MapBuilder::memory();
    for (form, cats) in &forms {
        let first = n_records;
        for (&cat, (count, lemmas)) in cats {
            // Lemma più frequente (a parità, il primo in ordine alfabetico: build ripetibile).
            let lemma = lemmas
                .iter()
                .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
                .map(|(l, _)| l.clone())
                .unwrap_or_default();
            let pos = if lemma.is_empty() {
                0
            } else if let Some(&p) = string_pos.get(&lemma) {
                p
            } else {
                let len = u16::try_from(lemma.len()).map_err(|_| "lemma troppo lungo")?;
                let p = u32::try_from(strings.len() + 1).map_err(|_| "testi troppo grandi")?;
                strings.extend_from_slice(&len.to_le_bytes());
                strings.extend_from_slice(lemma.as_bytes());
                string_pos.insert(lemma, p);
                p
            };
            let mut rec = [0u8; PRIOR_RECORD_SIZE];
            rec[0] = cat;
            rec[4..8].copy_from_slice(&count.to_le_bytes());
            rec[8..12].copy_from_slice(&pos.to_le_bytes());
            records.extend_from_slice(&rec);
            n_records += 1;
        }
        builder
            .insert(
                form.as_bytes(),
                pack_span(first as u64, (n_records - first) as u64),
            )
            .map_err(|e| e.to_string())?;
    }
    let fst_bytes = builder.into_inner().map_err(|e| e.to_string())?;

    let (table, unigram) = ln_tables(sentences);
    let mut v = Vec::with_capacity(
        HEADER_SIZE
            + TRIGRAM_BYTES
            + UNIGRAM_BYTES
            + fst_bytes.len()
            + records.len()
            + strings.len(),
    );
    v.extend_from_slice(MAGIC_TAGGER);
    v.extend_from_slice(&SCHEMA.to_le_bytes());
    v.extend_from_slice(&build_id.to_le_bytes());
    for c in [n_records, fst_bytes.len(), strings.len()] {
        v.extend_from_slice(
            &u32::try_from(c)
                .map_err(|_| "tagger.bin troppo grande")?
                .to_le_bytes(),
        );
    }
    for x in table.iter().chain(&unigram) {
        v.extend_from_slice(&x.to_le_bytes());
    }
    v.extend_from_slice(&fst_bytes);
    v.extend_from_slice(&records);
    v.extend_from_slice(&strings);
    Ok(TaggerBuild {
        bytes: v,
        stats: TaggerStats {
            sentences: sentences.len(),
            tokens,
            forms: forms.len(),
            records: n_records,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use caa_engine::tagger::Tagger;
    use caa_engine::treebank::parse_conllu;
    use caa_engine::types::Cat;

    const CONLLU: &str = "# sent_id = 1\n# text = Il gatto dorme.\n\
1\tIl\til\tDET\tRD\tDefinite=Def|Gender=Masc|Number=Sing|PronType=Art\t2\tdet\t_\t_\n\
2\tgatto\tgatto\tNOUN\tS\tGender=Masc|Number=Sing\t3\tnsubj\t_\t_\n\
3\tdorme\tdormire\tVERB\tV\tMood=Ind|Number=Sing|Person=3|Tense=Pres\t0\troot\t_\t_\n\
4\t.\t.\tPUNCT\tFS\t_\t3\tpunct\t_\t_\n\n\
# sent_id = 2\n# text = Il gatto.\n\
1\tIl\til\tDET\tRD\tDefinite=Def|Gender=Masc|Number=Sing|PronType=Art\t2\tdet\t_\t_\n\
2\tgatto\tgatto\tNOUN\tS\tGender=Masc|Number=Sing\t0\troot\t_\t_\n\
3\t.\t.\tPUNCT\tFS\t_\t2\tpunct\t_\t_\n\n";

    #[test]
    fn il_file_si_rilegge_e_i_numeri_tornano() {
        let s = parse_conllu(CONLLU);
        let b = build_tagger(&s, 0xABCD).unwrap();
        assert_eq!(b.stats.sentences, 2);
        assert_eq!(b.stats.tokens, 7);
        let t = Tagger::new(b.bytes).unwrap();
        assert_eq!(t.build_id(), 0xABCD);
        let il = t.priors("il");
        assert_eq!(il.len(), 1);
        assert_eq!(
            (il[0].cat, il[0].count, il[0].lemma.as_deref()),
            (Cat::Art, 2, Some("il"))
        );
        assert_eq!(t.priors("dorme")[0].lemma.as_deref(), Some("dormire"));
        assert!(t.priors("sconosciuta").is_empty());
        // Dopo l'articolo il nome è certo; le righe delle probabilità sommano a 1.
        let (art, noun) = (state_of(Cat::Art), state_of(Cat::Noun));
        assert!(t.transition(BOS, art, noun) > -0.1);
        assert!(t.transition(BOS, art, state_of(Cat::Verb)) < -5.0);
        let sum: f64 = (0..N_STATES)
            .map(|c| f64::from(t.transition(BOS, art, c)).exp())
            .sum();
        assert!((sum - 1.0).abs() < 0.01, "somma {sum}");
        // Probabilità delle categorie: l'articolo è molto più frequente del clitico.
        assert!(t.unigram(Cat::Art) > t.unigram(Cat::Adv));
        assert!(t.unigram(Cat::Art) < 0.0);
        // Contesto mai visto: si ricade sui livelli più bassi, senza infiniti.
        assert!(t
            .transition(state_of(Cat::Adj), state_of(Cat::Intj), noun)
            .is_finite());
    }

    #[test]
    fn la_build_e_ripetibile() {
        let s = parse_conllu(CONLLU);
        assert_eq!(
            build_tagger(&s, 1).unwrap().bytes,
            build_tagger(&s, 1).unwrap().bytes
        );
    }
}
