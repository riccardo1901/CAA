//! Lettura dei file del lessico compilato.
//!
//! Il motore non apre file: riceve i byte già caricati (da `mmap` in `caa-store`, o da un `Vec<u8>`
//! nei test). Ogni ricerca passa da un automa `fst` che restituisce una posizione in una tabella
//! di record a lunghezza fissa, quindi non si ricostruisce nulla all'avvio.
//!
//! Formati (tutti little-endian; vedi `SCHEMA`). Le intestazioni dei `.bin` sono di 28 byte:
//! magic (4), schema (4), identificativo di build (8), tre contatori (4 ciascuno).
//!
//! * `morph.fst`: forma normalizzata → `(posizione << 16) | numero_letture`
//! * `lemmas.fst`: lemma normalizzato → id del lemma
//! * `morph_feats.bin` (`CAAF`; contatori: n. lemmi, n. letture): tabella delle posizioni dei lemmi,
//!   testo dei lemmi, letture da 12 byte (`types::Reading`)
//! * `picto_index.bin` (`CAAP`; contatori: n. record, lunghezza fst, lunghezza testi): l'fst
//!   (chiave → `(posizione << 16) | numero_record`), record da 12 byte, testi dei singolari
//!   (ciascuno preceduto dalla lunghezza su 2 byte)
//!
//! I due `fst` morfologici contengono in più la chiave sentinella [`BUILD_KEY`] con
//! l'identificativo di build: chi li apre insieme a un `morph_feats.bin` di un'altra build riceve un
//! errore invece di ricerche vuote. Chi scorre le chiavi di un `fst` deve saltare le chiavi che
//! iniziano con NUL.

use std::fmt;
use std::sync::Arc;

use crate::types::{Reading, READING_SIZE};

/// Numero di schema dei file compilati: cresce a ogni modifica incompatibile.
pub const SCHEMA: u32 = 2;

pub const MAGIC_FEATS: &[u8; 4] = b"CAAF";
pub const MAGIC_PICTO: &[u8; 4] = b"CAAP";
/// Dimensione dell'intestazione di `morph_feats.bin` e di `picto_index.bin`.
pub const HEADER_SIZE: usize = 28;
/// Dimensione di un record di `picto_index.bin`.
pub const PICTO_RECORD_SIZE: usize = 12;
/// Chiave sentinella (inizia con NUL: nessuna chiave normalizzata può coincidere) con l'identificativo
/// di build, nei due `fst` morfologici.
pub const BUILD_KEY: &str = "\u{0}build";

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
    /// La chiave si è ottenuta togliendo una precisazione tra parentesi ("castagno (albero)").
    pub const DISAMBIGUATED: u8 = 16;
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
    /// I file aperti insieme non vengono dalla stessa build del lessico.
    BuildMismatch(&'static str),
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
            LexiconError::BuildMismatch(what) => write!(
                f,
                "{what}: file di build diverse (rigenera il lessico con caa-lexicon-build)"
            ),
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

/// Contenuto dell'intestazione di un `.bin`.
struct Header {
    build_id: u64,
    c1: u32,
    c2: u32,
    c3: u32,
}

/// Controlla magic e schema; restituisce identificativo di build e contatori.
fn check_header(b: &[u8], magic: &[u8; 4], file: &'static str) -> Result<Header, LexiconError> {
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
    let mut id = [0u8; 8];
    id.copy_from_slice(&b[8..16]);
    Ok(Header {
        build_id: u64::from_le_bytes(id),
        c1: rd_u32(b, 16),
        c2: rd_u32(b, 20),
        c3: rd_u32(b, 24),
    })
}

// ---------------------------------------------------------------------------------------
// Lessico morfologico (Morph-it!)
// ---------------------------------------------------------------------------------------

/// Forme flesse → letture (lemma, categoria, tratti).
pub struct MorphLexicon<D: AsRef<[u8]>> {
    forms: fst::Map<D>,
    lemmas: fst::Map<D>,
    feats: D,
    build_id: u64,
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
        let header = check_header(feats.as_ref(), MAGIC_FEATS, FILE)?;
        let (n_lemmas, n_readings) = (header.c1 as usize, header.c2 as usize);
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
        // I tre file devono venire dalla stessa build (la sentinella è nei due automi).
        if forms.get(BUILD_KEY) != Some(header.build_id)
            || lemmas.get(BUILD_KEY) != Some(header.build_id)
        {
            return Err(LexiconError::BuildMismatch(
                "morph.fst, lemmas.fst e morph_feats.bin",
            ));
        }
        Ok(MorphLexicon {
            forms,
            lemmas,
            feats,
            build_id: header.build_id,
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

    /// Identificativo della build che ha prodotto i file.
    pub fn build_id(&self) -> u64 {
        self.build_id
    }

    /// Numero di forme (senza la chiave sentinella).
    pub fn form_count(&self) -> usize {
        self.forms.len().saturating_sub(1)
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
    /// Categorie numeriche ARASAAC della parola chiave, come insieme di bit: il bit `t` è acceso
    /// se la chiave ha il tipo `t` (0 = nessun tipo); vedi `docs/RAPPORTO-M1.md`.
    pub keyword_types: u8,
    /// Combinazione di [`picto_flags`].
    pub flags: u8,
    /// Numero di parole chiave italiane del pittogramma (meno ne ha, più è specifico).
    pub n_keys: u16,
    /// Per le voci `PLURAL_FORM`: posizione (da 1) del testo della parola chiave singolare; 0 se non c'è.
    /// Si legge con [`PictoIndex::singular`].
    pub singular: u32,
}

impl PictoEntry {
    pub fn to_bytes(&self) -> [u8; PICTO_RECORD_SIZE] {
        let i = self.id.to_le_bytes();
        let n = self.n_keys.to_le_bytes();
        let g = self.singular.to_le_bytes();
        [
            i[0],
            i[1],
            i[2],
            i[3],
            self.keyword_types,
            self.flags,
            n[0],
            n[1],
            g[0],
            g[1],
            g[2],
            g[3],
        ]
    }

    pub fn from_bytes(b: &[u8]) -> Option<PictoEntry> {
        let b = b.get(..PICTO_RECORD_SIZE)?;
        Some(PictoEntry {
            id: u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            keyword_types: b[4],
            flags: b[5],
            n_keys: u16::from_le_bytes([b[6], b[7]]),
            singular: u32::from_le_bytes([b[8], b[9], b[10], b[11]]),
        })
    }

    pub fn has_flag(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }

    /// Vero se la chiave ha la categoria ARASAAC `t` (0..=7).
    pub fn has_type(&self, t: u8) -> bool {
        t < 8 && (self.keyword_types >> t) & 1 == 1
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
    build_id: u64,
    records_start: usize,
    n_records: usize,
    strings_start: usize,
    strings_len: usize,
}

impl<D: AsRef<[u8]>> PictoIndex<D> {
    /// `data` = contenuto di `picto_index.bin`.
    pub fn new(data: D) -> Result<Self, LexiconError> {
        const FILE: &str = "picto_index.bin";
        let header = check_header(data.as_ref(), MAGIC_PICTO, FILE)?;
        let (n_records, fst_len, strings_len) =
            (header.c1 as usize, header.c2 as usize, header.c3 as usize);
        let corrupt = || LexiconError::Corrupt(FILE);
        let fst_start = HEADER_SIZE;
        let records_start = fst_start.checked_add(fst_len).ok_or_else(corrupt)?;
        let strings_start = n_records
            .checked_mul(PICTO_RECORD_SIZE)
            .and_then(|r| records_start.checked_add(r))
            .ok_or_else(corrupt)?;
        let total = strings_start.checked_add(strings_len).ok_or_else(corrupt)?;
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
            build_id: header.build_id,
            records_start,
            n_records,
            strings_start,
            strings_len,
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

    /// Parola chiave singolare di una voce `PLURAL_FORM` ("ape" per la chiave "api").
    pub fn singular(&self, entry: &PictoEntry) -> Option<&str> {
        let offset = (entry.singular as usize).checked_sub(1)?;
        let blob = (*self.data)
            .as_ref()
            .get(self.strings_start..self.strings_start.checked_add(self.strings_len)?)?;
        let len =
            u16::from_le_bytes([*blob.get(offset)?, *blob.get(offset.checked_add(1)?)?]) as usize;
        let start = offset.checked_add(2)?;
        std::str::from_utf8(blob.get(start..start.checked_add(len)?)?).ok()
    }

    /// Identificativo della build che ha prodotto il file.
    pub fn build_id(&self) -> u64 {
        self.build_id
    }

    pub fn key_count(&self) -> usize {
        self.keys.len()
    }

    pub fn record_count(&self) -> usize {
        self.n_records
    }
}
