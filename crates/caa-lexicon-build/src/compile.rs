//! Costruzione dei file binari del lessico a partire dai dati già letti (nessun I/O).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;

use caa_engine::lexicon::{pack_span, HEADER_SIZE, MAGIC_FEATS, MAGIC_PICTO, SCHEMA};
use caa_engine::norm::normalize_key;
use caa_engine::types::{Cat, Feats, Reading, READING_SIZE};

use crate::arasaac::{self, Pictogram};
use crate::labels::parse_label;
use crate::morphit;
use crate::overrides::FormExtra;

pub struct Inputs<'a> {
    pub morphit: &'a str,
    pub pictograms: &'a [Pictogram],
    pub forms_extra: &'a [FormExtra],
}

#[derive(Debug, Default, Clone)]
pub struct Stats {
    pub rows: usize,
    pub repaired_lines: Vec<usize>,
    pub distinct_labels: usize,
    pub forms_extra: usize,
    pub forms: usize,
    pub lemmas: usize,
    pub readings: usize,
    pub pictograms: usize,
    pub pictograms_without_keys: usize,
    pub picto_keys: usize,
    pub picto_records: usize,
}

pub struct Outputs {
    pub morph_fst: Vec<u8>,
    pub lemmas_fst: Vec<u8>,
    pub morph_feats: Vec<u8>,
    pub picto_index: Vec<u8>,
    pub stats: Stats,
}

#[derive(Debug)]
pub enum BuildError {
    Morphit(Vec<String>),
    UnmappedLabels(Vec<String>),
    TooManyReadings(String),
    TooLarge(&'static str),
    Fst(String),
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BuildError::Morphit(e) => write!(
                f,
                "Morph-it!: {} righe non leggibili:\n  {}",
                e.len(),
                e.join("\n  ")
            ),
            BuildError::UnmappedLabels(l) => write!(
                f,
                "{} etichette non mappate (aggiungile in src/labels.rs): {}",
                l.len(),
                l.join(", ")
            ),
            BuildError::TooManyReadings(k) => write!(f, "troppe letture per la forma {k:?}"),
            BuildError::TooLarge(what) => write!(f, "{what} supera i limiti del formato"),
            BuildError::Fst(e) => write!(f, "errore nell'automa fst: {e}"),
        }
    }
}

impl std::error::Error for BuildError {}

fn fst_err(e: impl fmt::Display) -> BuildError {
    BuildError::Fst(e.to_string())
}

fn header(magic: &[u8; 4], a: usize, b: usize, what: &'static str) -> Result<Vec<u8>, BuildError> {
    let a = u32::try_from(a).map_err(|_| BuildError::TooLarge(what))?;
    let b = u32::try_from(b).map_err(|_| BuildError::TooLarge(what))?;
    let mut v = Vec::with_capacity(HEADER_SIZE);
    v.extend_from_slice(magic);
    v.extend_from_slice(&SCHEMA.to_le_bytes());
    v.extend_from_slice(&a.to_le_bytes());
    v.extend_from_slice(&b.to_le_bytes());
    Ok(v)
}

fn resolve(
    cache: &mut HashMap<String, (Cat, Feats)>,
    unmapped: &mut BTreeSet<String>,
    label: &str,
) -> Option<(Cat, Feats)> {
    if let Some(v) = cache.get(label) {
        return Some(*v);
    }
    match parse_label(label) {
        Ok(v) => {
            cache.insert(label.to_string(), v);
            Some(v)
        }
        Err(_) => {
            unmapped.insert(label.to_string());
            None
        }
    }
}

/// Costruisce i quattro file binari. Il risultato è deterministico: stessi dati, stessi byte.
pub fn compile(inp: &Inputs) -> Result<Outputs, BuildError> {
    let parsed = morphit::parse(inp.morphit).map_err(BuildError::Morphit)?;

    // 1. Etichette → categoria e tratti. Una sola etichetta non mappata ferma la build.
    let mut cache = HashMap::new();
    let mut unmapped = BTreeSet::new();
    let mut entries: Vec<(String, String, Cat, Feats)> =
        Vec::with_capacity(parsed.rows.len() + inp.forms_extra.len());
    let sources = parsed
        .rows
        .iter()
        .map(|r| (r.form.as_str(), r.lemma.as_str(), r.label.as_str()))
        .chain(
            inp.forms_extra
                .iter()
                .map(|e| (e.form.as_str(), e.lemma.as_str(), e.label.as_str())),
        );
    for (form, lemma, label) in sources {
        let Some((cat, feats)) = resolve(&mut cache, &mut unmapped, label) else {
            continue;
        };
        let (form, lemma) = (normalize_key(form), normalize_key(lemma));
        if !form.is_empty() && !lemma.is_empty() {
            entries.push((form, lemma, cat, feats));
        }
    }
    if !unmapped.is_empty() {
        return Err(BuildError::UnmappedLabels(unmapped.into_iter().collect()));
    }

    // 2. Lemmi: id = posizione nell'ordine alfabetico.
    let lemma_list: Vec<String> = entries
        .iter()
        .map(|e| e.1.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let lemma_ids: HashMap<&str, u32> = lemma_list
        .iter()
        .enumerate()
        .map(|(i, l)| (l.as_str(), i as u32))
        .collect();
    let mut lemmas_builder = fst::MapBuilder::memory();
    for (i, l) in lemma_list.iter().enumerate() {
        lemmas_builder
            .insert(l.as_bytes(), i as u64)
            .map_err(fst_err)?;
    }
    let lemmas_fst = lemmas_builder.into_inner().map_err(fst_err)?;

    // 3. Letture per forma, ordinate e senza doppioni.
    let mut by_form: BTreeMap<String, Vec<[u8; READING_SIZE]>> = BTreeMap::new();
    for (form, lemma, cat, feats) in entries {
        let reading = Reading {
            lemma_id: lemma_ids[lemma.as_str()],
            cat,
            feats,
        };
        by_form.entry(form).or_default().push(reading.to_bytes());
    }
    let mut forms_builder = fst::MapBuilder::memory();
    let mut readings_bytes: Vec<u8> = Vec::new();
    let mut offset = 0u64;
    for (form, list) in &mut by_form {
        list.sort_unstable();
        list.dedup();
        if list.len() > 0xFFFF {
            return Err(BuildError::TooManyReadings(form.clone()));
        }
        forms_builder
            .insert(form.as_bytes(), pack_span(offset, list.len() as u64))
            .map_err(fst_err)?;
        for r in list.iter() {
            readings_bytes.extend_from_slice(r);
        }
        offset += list.len() as u64;
    }
    let morph_fst = forms_builder.into_inner().map_err(fst_err)?;
    let n_readings = offset as usize;

    // 4. morph_feats.bin: intestazione, posizioni dei lemmi, testo dei lemmi, letture.
    let mut morph_feats = header(MAGIC_FEATS, lemma_list.len(), n_readings, "morph_feats.bin")?;
    let mut blob: Vec<u8> = Vec::new();
    let mut positions: Vec<u32> = vec![0];
    for l in &lemma_list {
        blob.extend_from_slice(l.as_bytes());
        positions
            .push(u32::try_from(blob.len()).map_err(|_| BuildError::TooLarge("testo dei lemmi"))?);
    }
    for p in positions {
        morph_feats.extend_from_slice(&p.to_le_bytes());
    }
    morph_feats.extend_from_slice(&blob);
    morph_feats.extend_from_slice(&readings_bytes);

    // 5. picto_index.bin: intestazione, fst delle chiavi, record.
    let index = arasaac::index_entries(inp.pictograms);
    let mut keys_builder = fst::MapBuilder::memory();
    let mut records: Vec<u8> = Vec::new();
    let mut n_records = 0u64;
    for (key, list) in &index {
        if list.len() > 0xFFFF {
            return Err(BuildError::TooManyReadings(key.clone()));
        }
        keys_builder
            .insert(key.as_bytes(), pack_span(n_records, list.len() as u64))
            .map_err(fst_err)?;
        for e in list {
            records.extend_from_slice(&e.to_bytes());
        }
        n_records += list.len() as u64;
    }
    let keys_fst = keys_builder.into_inner().map_err(fst_err)?;
    let mut picto_index = header(
        MAGIC_PICTO,
        n_records as usize,
        keys_fst.len(),
        "picto_index.bin",
    )?;
    picto_index.extend_from_slice(&keys_fst);
    picto_index.extend_from_slice(&records);

    let stats = Stats {
        rows: parsed.rows.len(),
        repaired_lines: parsed.repaired_lines,
        distinct_labels: cache.len(),
        forms_extra: inp.forms_extra.len(),
        forms: by_form.len(),
        lemmas: lemma_list.len(),
        readings: n_readings,
        pictograms: inp.pictograms.len(),
        pictograms_without_keys: arasaac::without_keywords(inp.pictograms),
        picto_keys: index.len(),
        picto_records: n_records as usize,
    };
    Ok(Outputs {
        morph_fst,
        lemmas_fst,
        morph_feats,
        picto_index,
        stats,
    })
}
