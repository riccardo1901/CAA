//! Lettura dei file del lessico compilato.
//!
//! Il motore non apre file: riceve i byte già caricati (da `mmap` in `caa-store`, o da un `Vec<u8>`
//! nei test). Ogni ricerca passa da un automa `fst` che restituisce una posizione in una tabella
//! di record a lunghezza fissa, quindi non si ricostruisce nulla all'avvio.
//!
//! Formati (tutti little-endian; vedi `SCHEMA`):
//!
//! * `morph.fst`: forma normalizzata → `(posizione << 16) | numero_letture`
//! * `lemmas.fst`: lemma normalizzato → id del lemma
//! * `morph_feats.bin`: intestazione `CAAF` + schema + n. lemmi + n. letture, tabella delle
//!   posizioni dei lemmi, testo dei lemmi, letture da 12 byte (`types::Reading`)
//! * `picto_index.bin`: intestazione `CAAP` + schema + n. record + lunghezza fst, l'fst
//!   (chiave → `(posizione << 16) | numero_record`), record da 8 byte

use std::fmt;
use std::sync::Arc;

use crate::types::{Reading, READING_SIZE};

/// Numero di schema dei file compilati: cresce a ogni modifica incompatibile.
pub const SCHEMA: u32 = 1;

pub const MAGIC_FEATS: &[u8; 4] = b"CAAF";
pub const MAGIC_PICTO: &[u8; 4] = b"CAAP";
/// Dimensione dell'intestazione di `morph_feats.bin` e di `picto_index.bin`.
pub const HEADER_SIZE: usize = 16;
/// Dimensione di un record di `picto_index.bin`.
pub const PICTO_RECORD_SIZE: usize = 8;

/// Bit del campo `flags` di un [`PictoEntry`].
pub mod picto_flags {
    /// La chiave è la prima parola chiave del pittogramma.
    pub const FIRST_KEY: u8 = 1;
    /// La chiave è il plurale indicato da ARASAAC per un'altra parola chiave ("api" per "ape").
    pub const PLURAL_FORM: u8 = 2;
    /// La chiave contiene più parole.
    pub const MULTIWORD: u8 = 4;
    /// ARASAAC indica come plurale la parola chiave stessa (parola invariabile).
    pub const INVARIABLE_PLURAL: u8 = 8;
}

/// Errore di lettura di un file del lessico.
#[derive(Debug)]
pub enum LexiconError {
    Truncated(&'static str),
    BadMagic(&'static str),
    BadSchema {
        file: &'static str,
        found: u32,
        expected: u32,
    },
    Corrupt(&'static str),
    Fst(fst::Error),
}

impl fmt::Display for LexiconError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LexiconError::Truncated(file) => write!(f, "{file}: file troncato"),
            LexiconError::BadMagic(file) => write!(f, "{file}: non è un file del lessico"),
            LexiconError::BadSchema { file, found, expected } => write!(
                f,
                "{file}: schema {found}, atteso {expected} (rigenera il lessico con caa-lexicon-build)"
            ),
            LexiconError::Corrupt(file) => write!(f, "{file}: contenuto incoerente"),
            LexiconError::Fst(e) => write!(f, "automa fst non valido: {e}"),
        }
    }
}

impl std::error::Error for LexiconError {}

impl From<fst::Error> for LexiconError {
    fn from(e: fst::Error) -> Self {
        LexiconError::Fst(e)
    }
}

fn rd_u32(b: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
}

/// Valore di un `fst`: posizione del primo record e numero di record.
pub fn pack_span(offset: u64, count: u64) -> u64 {
    (offset << 16) | count
}

fn unpack_span(v: u64) -> (usize, usize) {
    ((v >> 16) as usize, (v & 0xFFFF) as usize)
}

/// Controlla intestazione e schema; restituisce i due contatori dell'intestazione.
fn check_header(b: &[u8], magic: &[u8; 4], file: &'static str) -> Result<(u32, u32), LexiconError> {
    if b.len() < HEADER_SIZE {
        return Err(LexiconError::Truncated(file));
    }
    if &b[0..4] != magic {
        return Err(LexiconError::BadMagic(file));
    }
    let schema = rd_u32(b, 4);
    if schema != SCHEMA {
        return Err(LexiconError::BadSchema {
            file,
            found: schema,
            expected: SCHEMA,
        });
    }
    Ok((rd_u32(b, 8), rd_u32(b, 12)))
}

// ---------------------------------------------------------------------------------------
// Lessico morfologico (Morph-it!)
// ---------------------------------------------------------------------------------------

/// Forme flesse → letture (lemma, categoria, tratti).
pub struct MorphLexicon<D: AsRef<[u8]>> {
    forms: fst::Map<D>,
    lemmas: fst::Map<D>,
    feats: D,
    n_lemmas: usize,
    n_readings: usize,
    blob_start: usize,
    blob_len: usize,
    readings_start: usize,
}

impl<D: AsRef<[u8]>> MorphLexicon<D> {
    /// `forms` = `morph.fst`, `lemmas` = `lemmas.fst`, `feats` = `morph_feats.bin`.
    pub fn new(forms: D, lemmas: D, feats: D) -> Result<Self, LexiconError> {
        const FILE: &str = "morph_feats.bin";
        let (n_lemmas, n_readings) = {
            let (a, b) = check_header(feats.as_ref(), MAGIC_FEATS, FILE)?;
            (a as usize, b as usize)
        };
        let f = feats.as_ref();
        // Aritmetica con controllo: su 32 bit (WebAssembly) un'intestazione ostile non deve
        // "avvolgere" i calcoli e superare i controlli di lunghezza.
        let corrupt = || LexiconError::Corrupt(FILE);
        let offsets_len = n_lemmas
            .checked_add(1)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(corrupt)?;
        let blob_start = HEADER_SIZE.checked_add(offsets_len).ok_or_else(corrupt)?;
        if f.len() < blob_start {
            return Err(LexiconError::Truncated(FILE));
        }
        let blob_len = rd_u32(f, blob_start - 4) as usize;
        let readings_start = blob_start.checked_add(blob_len).ok_or_else(corrupt)?;
        let total = n_readings
            .checked_mul(READING_SIZE)
            .and_then(|r| readings_start.checked_add(r))
            .ok_or_else(corrupt)?;
        if f.len() != total {
            return Err(corrupt());
        }
        // `fst::Map::new` non controlla l'integrità: un byte alterato supererebbe l'apertura e
        // manderebbe in panic la ricerca. `verify` controlla la somma di controllo scritta da fst.
        let forms = fst::Map::new(forms)?;
        forms.as_fst().verify()?;
        let lemmas = fst::Map::new(lemmas)?;
        lemmas.as_fst().verify()?;
        Ok(MorphLexicon {
            forms,
            lemmas,
            feats,
            n_lemmas,
            n_readings,
            blob_start,
            blob_len,
            readings_start,
        })
    }

    /// Tutte le letture di una forma. La chiave deve essere già normalizzata (`norm::normalize_key`).
    pub fn lookup(&self, key: &str) -> Vec<Reading> {
        let Some(v) = self.forms.get(key) else {
            return Vec::new();
        };
        let (offset, count) = unpack_span(v);
        let range = offset
            .checked_mul(READING_SIZE)
            .and_then(|o| self.readings_start.checked_add(o))
            .and_then(|start| {
                let end = start.checked_add(count.checked_mul(READING_SIZE)?)?;
                Some(start..end)
            });
        let Some(bytes) = range.and_then(|r| self.feats.as_ref().get(r)) else {
            return Vec::new();
        };
        bytes
            .as_chunks::<READING_SIZE>()
            .0
            .iter()
            .filter_map(|chunk| Reading::from_bytes(chunk))
            .collect()
    }

    /// Id di un lemma normalizzato.
    pub fn lemma_id(&self, lemma: &str) -> Option<u32> {
        self.lemmas.get(lemma).map(|v| v as u32)
    }

    /// Testo di un lemma.
    pub fn lemma(&self, id: u32) -> Option<&str> {
        let id = id as usize;
        if id >= self.n_lemmas {
            return None;
        }
        let f = self.feats.as_ref();
        let a = rd_u32(f, HEADER_SIZE + id * 4) as usize;
        let b = rd_u32(f, HEADER_SIZE + (id + 1) * 4) as usize;
        let blob = &f[self.blob_start..self.blob_start + self.blob_len];
        std::str::from_utf8(blob.get(a..b)?).ok()
    }

    pub fn form_count(&self) -> usize {
        self.forms.len()
    }

    pub fn lemma_count(&self) -> usize {
        self.n_lemmas
    }

    pub fn reading_count(&self) -> usize {
        self.n_readings
    }
}

// ---------------------------------------------------------------------------------------
// Indice dei pittogrammi (ARASAAC)
// ---------------------------------------------------------------------------------------

/// Un pittogramma associato a una chiave.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PictoEntry {
    /// Id ARASAAC.
    pub id: u32,
    /// Categoria numerica ARASAAC della parola chiave (0 = nessuna); vedi `docs/RAPPORTO-M1.md`.
    pub keyword_type: u8,
    /// Combinazione di [`picto_flags`].
    pub flags: u8,
    /// Numero di parole chiave italiane del pittogramma (meno ne ha, più è specifico).
    pub n_keys: u16,
}

impl PictoEntry {
    pub fn to_bytes(&self) -> [u8; PICTO_RECORD_SIZE] {
        let i = self.id.to_le_bytes();
        let n = self.n_keys.to_le_bytes();
        [
            i[0],
            i[1],
            i[2],
            i[3],
            self.keyword_type,
            self.flags,
            n[0],
            n[1],
        ]
    }

    pub fn from_bytes(b: &[u8]) -> Option<PictoEntry> {
        let b = b.get(..PICTO_RECORD_SIZE)?;
        Some(PictoEntry {
            id: u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            keyword_type: b[4],
            flags: b[5],
            n_keys: u16::from_le_bytes([b[6], b[7]]),
        })
    }

    pub fn has_flag(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }
}

/// Porzione di un buffer condiviso, usata per leggere l'`fst` incorporato in `picto_index.bin`.
struct Section<D> {
    data: Arc<D>,
    start: usize,
    end: usize,
}

impl<D: AsRef<[u8]>> AsRef<[u8]> for Section<D> {
    fn as_ref(&self) -> &[u8] {
        &(*self.data).as_ref()[self.start..self.end]
    }
}

/// Chiave normalizzata → pittogrammi ARASAAC.
pub struct PictoIndex<D: AsRef<[u8]>> {
    keys: fst::Map<Section<D>>,
    data: Arc<D>,
    records_start: usize,
    n_records: usize,
}

impl<D: AsRef<[u8]>> PictoIndex<D> {
    /// `data` = contenuto di `picto_index.bin`.
    pub fn new(data: D) -> Result<Self, LexiconError> {
        const FILE: &str = "picto_index.bin";
        let (n_records, fst_len) = {
            let (a, b) = check_header(data.as_ref(), MAGIC_PICTO, FILE)?;
            (a as usize, b as usize)
        };
        let corrupt = || LexiconError::Corrupt(FILE);
        let fst_start = HEADER_SIZE;
        let records_start = fst_start.checked_add(fst_len).ok_or_else(corrupt)?;
        let total = n_records
            .checked_mul(PICTO_RECORD_SIZE)
            .and_then(|r| records_start.checked_add(r))
            .ok_or_else(corrupt)?;
        if data.as_ref().len() != total {
            return Err(corrupt());
        }
        let data = Arc::new(data);
        let keys = fst::Map::new(Section {
            data: Arc::clone(&data),
            start: fst_start,
            end: records_start,
        })?;
        keys.as_fst().verify()?; // vedi MorphLexicon::new
        Ok(PictoIndex {
            keys,
            data,
            records_start,
            n_records,
        })
    }

    /// Pittogrammi di una chiave già normalizzata, in ordine di id.
    pub fn lookup(&self, key: &str) -> Vec<PictoEntry> {
        let Some(v) = self.keys.get(key) else {
            return Vec::new();
        };
        let (offset, count) = unpack_span(v);
        let range = offset
            .checked_mul(PICTO_RECORD_SIZE)
            .and_then(|o| self.records_start.checked_add(o))
            .and_then(|start| {
                let end = start.checked_add(count.checked_mul(PICTO_RECORD_SIZE)?)?;
                Some(start..end)
            });
        let Some(bytes) = range.and_then(|r| (*self.data).as_ref().get(r)) else {
            return Vec::new();
        };
        bytes
            .as_chunks::<PICTO_RECORD_SIZE>()
            .0
            .iter()
            .filter_map(|chunk| PictoEntry::from_bytes(chunk))
            .collect()
    }

    pub fn key_count(&self) -> usize {
        self.keys.len()
    }

    pub fn record_count(&self) -> usize {
        self.n_records
    }
}
