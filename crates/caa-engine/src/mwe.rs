//! Indice delle espressioni multiparola (SPEC.md, fase 6): `mwe.bin`, costruito alla build dalle
//! parole chiave ARASAAC con più parole, **lemmatizzate con lo stesso codice del motore**
//! ([`crate::engine::Engine::lemma_set`]), così "ferro da stiro" e "i ferri da stiro" si
//! incontrano su [ferro, da, stiro].
//!
//! Il file ha l'intestazione di 28 byte degli altri (magic `CAAM`, schema, identificativo di
//! build, n. record, lunghezza fst, lunghezza testi), poi: `fst` (sequenza di lemmi separati da
//! spazio → `(posizione << 16) | numero_record`), record da 12 byte (id pittogramma, posizione del
//! testo della chiave + 1, flag, numero parole chiave del pittogramma, numero parole della chiave)
//! e testi (lunghezza su 2 byte più UTF-8).

use std::sync::Arc;

use crate::lexicon::{check_header, rd_u32, unpack_span, LexiconError, Section, HEADER_SIZE};

pub const MAGIC_MWE: &[u8; 4] = b"CAAM";
pub const MWE_RECORD_SIZE: usize = 12;
/// Numero massimo di parole di una chiave (le più lunghe non si indicizzano).
pub const MAX_WORDS: usize = 8;

/// Un pittogramma raggiungibile da una sequenza di lemmi.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MweRecord {
    pub picto: u32,
    /// Parola chiave ARASAAC originale, normalizzata ("ferro da stiro").
    pub key: String,
    pub flags: u8,
    pub n_keys: u8,
    pub n_words: u8,
}

/// Pezzi di una parola chiave come li vede il tokenizzatore: parole separate da spazi e, per le
/// elisioni, "dell'orto" → "dell'" + "orto". `None` se la chiave ha cifre o punteggiatura al
/// centro (non può comparire come sequenza di parole in un testo) o più di [`MAX_WORDS`] pezzi.
pub fn key_pieces(key: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    for word in key.split_whitespace() {
        if word.chars().any(|c| c.is_ascii_digit()) {
            return None;
        }
        for piece in word.split_inclusive('\'') {
            let p = piece.trim_matches(|c: char| !c.is_alphabetic() && c != '\'');
            let letters = p.trim_end_matches('\'');
            if letters.is_empty() {
                continue;
            }
            if !letters.chars().all(char::is_alphabetic)
                || piece.chars().any(|c| c.is_ascii_digit())
            {
                return None;
            }
            out.push(crate::norm::normalize_key(p));
        }
    }
    (out.len() >= 2 && out.len() <= MAX_WORDS).then_some(out)
}

pub struct MweIndex<D: AsRef<[u8]>> {
    data: Arc<D>,
    seqs: fst::Map<Section<D>>,
    build_id: u64,
    records_start: usize,
    n_records: usize,
    strings_start: usize,
    strings_len: usize,
}

impl<D: AsRef<[u8]>> MweIndex<D> {
    pub fn new(data: D) -> Result<Self, LexiconError> {
        const FILE: &str = "mwe.bin";
        let h = check_header(data.as_ref(), MAGIC_MWE, FILE)?;
        let (n_records, fst_len, strings_len) = (h.c1 as usize, h.c2 as usize, h.c3 as usize);
        let corrupt = || LexiconError::Corrupt(FILE);
        let fst_start = HEADER_SIZE;
        let records_start = fst_start.checked_add(fst_len).ok_or_else(corrupt)?;
        let strings_start = n_records
            .checked_mul(MWE_RECORD_SIZE)
            .and_then(|r| records_start.checked_add(r))
            .ok_or_else(corrupt)?;
        let total = strings_start.checked_add(strings_len).ok_or_else(corrupt)?;
        if data.as_ref().len() != total {
            return Err(corrupt());
        }
        let data = Arc::new(data);
        let seqs = fst::Map::new(Section {
            data: Arc::clone(&data),
            start: fst_start,
            end: records_start,
        })?;
        seqs.as_fst().verify()?;
        Ok(MweIndex {
            data,
            seqs,
            build_id: h.build_id,
            records_start,
            n_records,
            strings_start,
            strings_len,
        })
    }

    pub fn build_id(&self) -> u64 {
        self.build_id
    }

    pub fn record_count(&self) -> usize {
        self.n_records
    }

    pub fn sequence_count(&self) -> usize {
        self.seqs.len()
    }

    /// Pittogrammi per una sequenza di lemmi già normalizzati, separati da spazio.
    pub fn lookup(&self, lemmas: &str) -> Vec<MweRecord> {
        let Some(v) = self.seqs.get(lemmas) else {
            return Vec::new();
        };
        let (first, count) = unpack_span(v);
        let bytes = (*self.data).as_ref();
        (0..count)
            .filter_map(|i| {
                let start = first
                    .checked_add(i)?
                    .checked_mul(MWE_RECORD_SIZE)?
                    .checked_add(self.records_start)?;
                let rec = bytes.get(start..start.checked_add(MWE_RECORD_SIZE)?)?;
                Some(MweRecord {
                    picto: rd_u32(rec, 0),
                    key: self.text_at(rd_u32(rec, 4) as usize)?,
                    flags: rec[8],
                    n_keys: rec[9],
                    n_words: rec[10],
                })
            })
            .collect()
    }

    fn text_at(&self, pos_plus_one: usize) -> Option<String> {
        let offset = pos_plus_one.checked_sub(1)?;
        let blob = (*self.data)
            .as_ref()
            .get(self.strings_start..self.strings_start.checked_add(self.strings_len)?)?;
        let len =
            u16::from_le_bytes([*blob.get(offset)?, *blob.get(offset.checked_add(1)?)?]) as usize;
        let start = offset.checked_add(2)?;
        std::str::from_utf8(blob.get(start..start.checked_add(len)?)?)
            .ok()
            .map(str::to_string)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pezzi_delle_chiavi() {
        assert_eq!(
            key_pieces("ferro da stiro").unwrap(),
            ["ferro", "da", "stiro"]
        );
        assert_eq!(
            key_pieces("Dell'orto vecchio").unwrap(),
            ["dell'", "orto", "vecchio"]
        );
        assert_eq!(
            key_pieces("c'era una volta").unwrap(),
            ["c'", "era", "una", "volta"]
        );
        assert_eq!(
            key_pieces("buon compleanno!").unwrap(),
            ["buon", "compleanno"]
        );
        assert!(key_pieces("casa").is_none());
        assert!(key_pieces("di 3 anni").is_none());
        assert!(key_pieces("a b c d e f g h i").is_none());
    }
}
