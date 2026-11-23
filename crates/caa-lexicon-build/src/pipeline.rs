//! Orchestrazione della build: legge i dati grezzi, compila, scrive i file e il rapporto.
//!
//! Uscita (cartelle separate per licenza):
//!
//! ```text
//! <out>/arasaac/picto_index.bin, images/<id>.webp   (CC BY-NC-SA)
//! <out>/morphit/morph.fst, morph_feats.bin, lemmas.fst (CC BY-SA / LGPL)
//! <out>/overrides/*.tsv                              (correzioni curate)
//! <out>/report/report.md, keys_without_lemma.tsv, multiword_unknown_words.tsv
//! <out>/manifest.json
//! ```

use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use caa_engine::lexicon::{MorphLexicon, PictoIndex, SCHEMA};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::arasaac;
use crate::compile::{compile, Inputs, Stats};
use crate::overrides::{OverrideTexts, Overrides};
use crate::report::{self, ImageReport};

pub struct Config {
    /// Cartella dei dati grezzi (`data/raw`).
    pub raw: PathBuf,
    /// Cartella dei TSV curati (`lexicon/overrides`).
    pub overrides: PathBuf,
    /// Cartella di uscita (`data/build`).
    pub out: PathBuf,
}

pub struct Summary {
    pub stats: Stats,
    pub report: PathBuf,
    pub manifest: PathBuf,
}

const OVERRIDE_FILES: [&str; 5] = [
    "forms_extra.tsv",
    "lemma_picto.tsv",
    "mwe_extra.tsv",
    "function_words.tsv",
    "blocklist.tsv",
];

fn io_err(path: &Path, e: io::Error) -> String {
    format!("{}: {e}", path.display())
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| io_err(path, e))
}

fn read_or_empty(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(io_err(path, e)),
    }
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
    }
    fs::write(path, bytes).map_err(|e| io_err(path, e))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Data UTC (AAAA-MM-GG) da un numero di giorni dal 1970-01-01.
pub fn civil_date(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn date_of(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    civil_date((secs / 86_400) as i64)
}

/// Collega (o copia) le immagini WebP nella cartella di uscita; restituisce quante.
fn link_images(from: &Path, to: &Path) -> Result<usize, String> {
    fs::create_dir_all(to).map_err(|e| io_err(to, e))?;
    let Ok(dir) = fs::read_dir(from) else {
        return Ok(0);
    };
    let mut n = 0;
    for entry in dir.flatten() {
        let src = entry.path();
        if src.extension().and_then(|e| e.to_str()) != Some("webp") {
            continue;
        }
        let dest = to.join(entry.file_name());
        let same = fs::metadata(&dest)
            .ok()
            .zip(fs::metadata(&src).ok())
            .is_some_and(|(a, b)| a.len() == b.len());
        if !same {
            let _ = fs::remove_file(&dest);
            if fs::hard_link(&src, &dest).is_err() {
                fs::copy(&src, &dest).map_err(|e| io_err(&dest, e))?;
            }
        }
        n += 1;
    }
    Ok(n)
}

pub fn run(cfg: &Config) -> Result<Summary, String> {
    let morphit_file = cfg.raw.join("morphit/morph-it.utf8.txt");
    let arasaac_file = cfg.raw.join("arasaac/all_it.json");
    let images_dir = cfg.raw.join("arasaac/images");

    let morphit_text = String::from_utf8(read(&morphit_file)?)
        .map_err(|e| format!("{}: non è UTF-8: {e}", morphit_file.display()))?;
    let arasaac_bytes = read(&arasaac_file)?;
    let pictograms = arasaac::parse(&arasaac_bytes)?;

    // File curati: lettura e controlli.
    let mut texts = Vec::new();
    for name in OVERRIDE_FILES {
        texts.push(read_or_empty(&cfg.overrides.join(name))?);
    }
    let mut it = texts.iter().cloned();
    let override_texts = OverrideTexts {
        forms_extra: it.next().unwrap_or_default(),
        lemma_picto: it.next().unwrap_or_default(),
        mwe_extra: it.next().unwrap_or_default(),
        function_words: it.next().unwrap_or_default(),
        blocklist: it.next().unwrap_or_default(),
    };
    let overrides = Overrides::parse(&override_texts)
        .map_err(|e| format!("file curati non validi:\n  {}", e.join("\n  ")))?;
    let known_ids: HashSet<u32> = pictograms.iter().map(|p| p.id).collect();
    let id_errors = overrides.check_ids(&known_ids);
    if !id_errors.is_empty() {
        return Err(format!(
            "file curati non validi:\n  {}",
            id_errors.join("\n  ")
        ));
    }

    // Compilazione e verifica che i file prodotti si rileggano.
    let out = compile(&Inputs {
        morphit: &morphit_text,
        pictograms: &pictograms,
        forms_extra: &overrides.forms_extra,
    })
    .map_err(|e| e.to_string())?;
    let morph = MorphLexicon::new(
        out.morph_fst.clone(),
        out.lemmas_fst.clone(),
        out.morph_feats.clone(),
    )
    .map_err(|e| e.to_string())?;
    let index = PictoIndex::new(out.picto_index.clone()).map_err(|e| e.to_string())?;
    if morph.form_count() != out.stats.forms
        || morph.reading_count() != out.stats.readings
        || index.record_count() != out.stats.picto_records
    {
        return Err("i file prodotti non coincidono con i conteggi della build".into());
    }

    // Scrittura.
    let files: Vec<(&str, &Vec<u8>, &str)> = vec![
        (
            "morphit/morph.fst",
            &out.morph_fst,
            "CC BY-SA 2.0 oppure LGPL (Morph-it!)",
        ),
        (
            "morphit/morph_feats.bin",
            &out.morph_feats,
            "CC BY-SA 2.0 oppure LGPL (Morph-it!)",
        ),
        (
            "morphit/lemmas.fst",
            &out.lemmas_fst,
            "CC BY-SA 2.0 oppure LGPL (Morph-it!)",
        ),
        (
            "arasaac/picto_index.bin",
            &out.picto_index,
            "CC BY-NC-SA 4.0 (ARASAAC)",
        ),
    ];
    for (name, bytes, _) in &files {
        write(&cfg.out.join(name), bytes)?;
    }
    for (name, text) in OVERRIDE_FILES.iter().zip(&texts) {
        write(&cfg.out.join("overrides").join(name), text.as_bytes())?;
    }
    let linked = link_images(&images_dir, &cfg.out.join("arasaac/images"))?;
    let present: BTreeSet<u32> = fs::read_dir(cfg.out.join("arasaac/images"))
        .map_err(|e| io_err(&cfg.out, e))?
        .flatten()
        .filter_map(|e| e.path().file_stem()?.to_str()?.parse().ok())
        .collect();
    let keyed: BTreeSet<u32> = arasaac::primary_keys(&pictograms)
        .into_iter()
        .map(|(_, _, id)| id)
        .collect();
    let img = ImageReport {
        linked,
        missing_for_keyed: keyed.difference(&present).copied().collect(),
    };

    // Rapporto di copertura.
    let cov = report::coverage(&morph, &pictograms);
    let sizes: Vec<(String, u64)> = files
        .iter()
        .map(|(n, b, _)| ((*n).to_string(), b.len() as u64))
        .collect();
    let report_dir = cfg.out.join("report");
    let report_path = report_dir.join("report.md");
    write(
        &report_path,
        report::render_markdown(&out.stats, &cov, &sizes, &img).as_bytes(),
    )?;
    write(
        &report_dir.join("keys_without_lemma.tsv"),
        report::keys_without_lemma_tsv(&cov).as_bytes(),
    )?;
    write(
        &report_dir.join("multiword_unknown_words.tsv"),
        report::multiword_unknown_tsv(&cov).as_bytes(),
    )?;

    // Manifesto.
    let morphit_version = fs::read_dir(cfg.raw.join("morphit/extracted/current_version"))
        .ok()
        .and_then(|d| {
            d.flatten().find_map(|e| {
                e.file_name()
                    .to_str()?
                    .strip_prefix("morph-it_")?
                    .strip_suffix(".txt")
                    .map(String::from)
            })
        })
        .unwrap_or_else(|| "sconosciuta".into());
    let retrieved = fs::metadata(&arasaac_file)
        .and_then(|m| m.modified())
        .map_or_else(|_| "sconosciuta".into(), date_of);
    let s = &out.stats;
    let manifest = json!({
        "schema": SCHEMA,
        "builder_version": env!("CARGO_PKG_VERSION"),
        "built": date_of(SystemTime::now()),
        "sources": {
            "morphit": { "version": morphit_version, "sha256": sha256_hex(morphit_text.as_bytes()), "rows": s.rows },
            "arasaac": { "retrieved": retrieved, "sha256": sha256_hex(&arasaac_bytes), "pictograms": s.pictograms },
        },
        "counts": {
            "forms": s.forms, "lemmas": s.lemmas, "readings": s.readings, "labels": s.distinct_labels,
            "pictograms": s.pictograms, "pictograms_without_keys": s.pictograms_without_keys,
            "picto_keys": s.picto_keys, "picto_records": s.picto_records,
            "images": img.linked, "keys_without_lemma": cov.without_lemma.len(),
        },
        "files": files.iter().map(|(n, b, l)| json!({ "path": n, "bytes": b.len(), "sha256": sha256_hex(b), "license": l })).collect::<Vec<_>>(),
        "images": { "path": "arasaac/images", "format": "webp 500 px", "license": "CC BY-NC-SA 4.0 (ARASAAC)" },
    });
    let manifest_path = cfg.out.join("manifest.json");
    write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )?;

    Ok(Summary {
        stats: out.stats,
        report: report_path,
        manifest: manifest_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_civili() {
        assert_eq!(civil_date(0), "1970-01-01");
        assert_eq!(civil_date(19_723), "2024-01-01");
        assert_eq!(civil_date(19_782), "2024-02-29");
        assert_eq!(civil_date(-1), "1969-12-31");
    }
}
