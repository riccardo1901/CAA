//! Costruzione di `mwe.bin` (SPEC.md, build passo 4): le parole chiave ARASAAC con più parole,
//! lemmatizzate con il motore stesso. Una chiave dà una sequenza di lemmi per ogni combinazione
//! dei lemmi possibili delle sue parole (al massimo [`MAX_COMBINATIONS`]).

use std::collections::BTreeMap;

use caa_engine::engine::Engine;
use caa_engine::lexicon::{pack_span, HEADER_SIZE, SCHEMA};
use caa_engine::mwe::{key_pieces, MAGIC_MWE, MWE_RECORD_SIZE};

use crate::arasaac::IndexEntry;

/// Combinazioni di lemmi al massimo per una chiave.
pub const MAX_COMBINATIONS: usize = 16;

#[derive(Debug, Default, Clone)]
pub struct MweStats {
    /// Chiavi multiparola di ARASAAC (con spazio).
    pub keys: usize,
    /// Chiavi indicizzate.
    pub indexed: usize,
    /// Chiavi scartate: cifre, punteggiatura al centro, troppo lunghe.
    pub skipped: usize,
    pub sequences: usize,
    pub records: usize,
}

pub struct MweBuild {
    pub bytes: Vec<u8>,
    pub stats: MweStats,
}

/// Prodotto cartesiano limitato delle alternative di ogni parola.
fn combinations(sets: &[Vec<String>]) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = vec![Vec::new()];
    for set in sets {
        let mut next = Vec::new();
        'outer: for prefix in &out {
            for lemma in set {
                let mut p = prefix.clone();
                p.push(lemma.clone());
                next.push(p);
                if next.len() >= MAX_COMBINATIONS {
                    break 'outer;
                }
            }
        }
        out = next;
    }
    out
}

pub fn build_mwe<D: AsRef<[u8]>>(
    engine: &Engine<D>,
    entries: &BTreeMap<String, Vec<IndexEntry>>,
    build_id: u64,
) -> Result<MweBuild, String> {
    let mut stats = MweStats::default();
    // sequenza di lemmi -> (chiave, entry); BTreeMap: ordine stabile e chiavi ordinate per l'fst.
    let mut seqs: BTreeMap<String, Vec<(String, &IndexEntry)>> = BTreeMap::new();
    for (key, list) in entries {
        if !key.contains(' ') {
            continue;
        }
        stats.keys += 1;
        let Some(pieces) = key_pieces(key) else {
            stats.skipped += 1;
            continue;
        };
        stats.indexed += 1;
        let sets: Vec<Vec<String>> = pieces.iter().map(|w| engine.lemma_set(w)).collect();
        for combo in combinations(&sets) {
            let joined = combo.join(" ");
            let bucket = seqs.entry(joined).or_default();
            for e in list {
                if !bucket
                    .iter()
                    .any(|(k, x)| k == key && x.entry.id == e.entry.id)
                {
                    bucket.push((key.clone(), e));
                }
            }
        }
    }

    let mut strings: Vec<u8> = Vec::new();
    let mut string_pos: BTreeMap<String, u32> = BTreeMap::new();
    let mut records: Vec<u8> = Vec::new();
    let mut n_records = 0usize;
    let mut builder = fst::MapBuilder::memory();
    for (joined, list) in &seqs {
        let first = n_records;
        for (key, e) in list {
            let pos = match string_pos.get(key) {
                Some(&p) => p,
                None => {
                    let len = u16::try_from(key.len()).map_err(|_| "chiave troppo lunga")?;
                    let p = u32::try_from(strings.len() + 1).map_err(|_| "testi troppo grandi")?;
                    strings.extend_from_slice(&len.to_le_bytes());
                    strings.extend_from_slice(key.as_bytes());
                    string_pos.insert(key.clone(), p);
                    p
                }
            };
            let mut rec = [0u8; MWE_RECORD_SIZE];
            rec[0..4].copy_from_slice(&e.entry.id.to_le_bytes());
            rec[4..8].copy_from_slice(&pos.to_le_bytes());
            rec[8] = e.entry.flags;
            rec[9] = u8::try_from(e.entry.n_keys).unwrap_or(u8::MAX);
            rec[10] = key.split_whitespace().count().min(255) as u8;
            records.extend_from_slice(&rec);
            n_records += 1;
        }
        builder
            .insert(
                joined.as_bytes(),
                pack_span(first as u64, (n_records - first) as u64),
            )
            .map_err(|e| e.to_string())?;
    }
    let fst_bytes = builder.into_inner().map_err(|e| e.to_string())?;

    let mut v = Vec::with_capacity(HEADER_SIZE + fst_bytes.len() + records.len() + strings.len());
    v.extend_from_slice(MAGIC_MWE);
    v.extend_from_slice(&SCHEMA.to_le_bytes());
    v.extend_from_slice(&build_id.to_le_bytes());
    for c in [n_records, fst_bytes.len(), strings.len()] {
        v.extend_from_slice(
            &u32::try_from(c)
                .map_err(|_| "mwe.bin troppo grande")?
                .to_le_bytes(),
        );
    }
    v.extend_from_slice(&fst_bytes);
    v.extend_from_slice(&records);
    v.extend_from_slice(&strings);
    stats.sequences = seqs.len();
    stats.records = n_records;
    Ok(MweBuild { bytes: v, stats })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combinazioni_limitate() {
        let sets = vec![
            vec!["a".to_string(), "b".to_string()],
            vec!["c".to_string()],
        ];
        assert_eq!(combinations(&sets).len(), 2);
        let many: Vec<Vec<String>> = (0..6)
            .map(|_| vec!["x".into(), "y".into(), "z".into()])
            .collect();
        assert!(combinations(&many).len() <= MAX_COMBINATIONS);
    }
}
