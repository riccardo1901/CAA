//! Tagger statistico (SPEC.md, fase 7): lettura di `tagger.bin`, costruito alla build dal treebank.
//!
//! Il file contiene i trigrammi di categoria (probabilità logaritmiche con smoothing), le
//! probabilità logaritmiche delle singole categorie (`N_STATES` numeri `f32`) e, per ogni
//! forma vista nel treebank, quante volte ha avuto ciascuna categoria e lemma. Intestazione di 28
//! byte come gli altri file (magic `CAAT`, schema, identificativo di build, tre contatori: n.
//! record, lunghezza fst, lunghezza testi), poi: tabella dei trigrammi (`N_STATES`³ numeri `f32`),
//! fst (forma → `(posizione << 16) | numero_record`), record da 12 byte (categoria, conteggio,
//! posizione del lemma + 1) e testi dei lemmi (preceduti dalla lunghezza su 2 byte).

use std::sync::Arc;

use crate::lexicon::{check_header, rd_u32, unpack_span, LexiconError, Section, HEADER_SIZE};
use crate::types::Cat;

pub const MAGIC_TAGGER: &[u8; 4] = b"CAAT";
/// 18 categorie più l'inizio (`BOS`) e la fine (`EOS`) della frase.
pub const N_STATES: usize = 20;
pub const BOS: usize = 18;
pub const EOS: usize = 19;
/// Dimensione della tabella dei trigrammi in byte.
pub const TRIGRAM_BYTES: usize = N_STATES * N_STATES * N_STATES * 4;
/// Dimensione della tabella delle probabilità delle categorie.
pub const UNIGRAM_BYTES: usize = N_STATES * 4;
/// Dimensione di un record dei conteggi.
pub const PRIOR_RECORD_SIZE: usize = 12;

/// Indice di una categoria negli stati del tagger.
pub fn state_of(cat: Cat) -> usize {
    cat.as_u8() as usize
}

/// Quante volte una forma ha avuto una categoria (e un lemma) nel treebank.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriorRecord {
    pub cat: Cat,
    pub count: u32,
    pub lemma: Option<String>,
}

pub struct Tagger<D: AsRef<[u8]>> {
    data: Arc<D>,
    forms: fst::Map<Section<D>>,
    build_id: u64,
    records_start: usize,
    strings_start: usize,
    strings_len: usize,
}

impl<D: AsRef<[u8]>> Tagger<D> {
    /// `data` = contenuto di `tagger.bin`.
    pub fn new(data: D) -> Result<Self, LexiconError> {
        const FILE: &str = "tagger.bin";
        let h = check_header(data.as_ref(), MAGIC_TAGGER, FILE)?;
        let (n_records, fst_len, strings_len) = (h.c1 as usize, h.c2 as usize, h.c3 as usize);
        let corrupt = || LexiconError::Corrupt(FILE);
        let fst_start = HEADER_SIZE
            .checked_add(TRIGRAM_BYTES + UNIGRAM_BYTES)
            .ok_or_else(corrupt)?;
        let records_start = fst_start.checked_add(fst_len).ok_or_else(corrupt)?;
        let strings_start = n_records
            .checked_mul(PRIOR_RECORD_SIZE)
            .and_then(|r| records_start.checked_add(r))
            .ok_or_else(corrupt)?;
        let total = strings_start.checked_add(strings_len).ok_or_else(corrupt)?;
        if data.as_ref().len() < fst_start {
            return Err(LexiconError::Truncated(FILE));
        }
        if data.as_ref().len() != total {
            return Err(corrupt());
        }
        let data = Arc::new(data);
        let forms = fst::Map::new(Section {
            data: Arc::clone(&data),
            start: fst_start,
            end: records_start,
        })?;
        forms.as_fst().verify()?;
        Ok(Tagger {
            data,
            forms,
            build_id: h.build_id,
            records_start,
            strings_start,
            strings_len,
        })
    }

    pub fn build_id(&self) -> u64 {
        self.build_id
    }

    /// Logaritmo naturale di P(c | c2, c1); gli stati sono categorie, `BOS` o `EOS`.
    pub fn transition(&self, c2: usize, c1: usize, c: usize) -> f32 {
        if c2 >= N_STATES || c1 >= N_STATES || c >= N_STATES {
            return f32::NEG_INFINITY;
        }
        let at = HEADER_SIZE + ((c2 * N_STATES + c1) * N_STATES + c) * 4;
        let bytes = (*self.data).as_ref();
        f32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
    }

    /// Logaritmo naturale di P(categoria) nel treebank (serve a trasformare P(categoria | forma) in
    /// una probabilità di emissione: si divide per la frequenza della categoria).
    pub fn unigram(&self, cat: Cat) -> f32 {
        let at = HEADER_SIZE + TRIGRAM_BYTES + state_of(cat) * 4;
        let bytes = (*self.data).as_ref();
        f32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
    }

    /// Conteggi del treebank per una forma già normalizzata (vuoti se non è mai comparsa).
    pub fn priors(&self, form: &str) -> Vec<PriorRecord> {
        let Some(v) = self.forms.get(form) else {
            return Vec::new();
        };
        let (offset, count) = unpack_span(v);
        let bytes = (*self.data).as_ref();
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            let Some(start) = offset
                .checked_add(i)
                .and_then(|n| n.checked_mul(PRIOR_RECORD_SIZE))
                .and_then(|n| self.records_start.checked_add(n))
            else {
                break;
            };
            let Some(rec) = bytes.get(start..start + PRIOR_RECORD_SIZE) else {
                break;
            };
            let Some(cat) = Cat::from_u8(rec[0]) else {
                continue;
            };
            let lemma_pos = rd_u32(rec, 8) as usize;
            out.push(PriorRecord {
                cat,
                count: rd_u32(rec, 4),
                lemma: self.lemma_at(lemma_pos),
            });
        }
        out
    }

    fn lemma_at(&self, pos_plus_one: usize) -> Option<String> {
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
