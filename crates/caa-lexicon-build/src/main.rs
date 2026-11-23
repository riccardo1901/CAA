//! `caa-lexicon-build`: riga di comando.

use std::path::PathBuf;
use std::process::ExitCode;

use caa_lexicon_build::pipeline::{run, Config};

const USO: &str = "caa-lexicon-build — costruisce il lessico compilato da ARASAAC, Morph-it! e correzioni curate.\n\
\n\
Uso: caa-lexicon-build [--raw DIR] [--overrides DIR] [--out DIR] [--help] [--version]\n\
\n\
  --raw DIR        dati grezzi scaricati da scripts/ (predefinito: data/raw)\n\
  --overrides DIR  file TSV curati (predefinito: lexicon/overrides)\n\
  --out DIR        cartella di uscita (predefinito: data/build)";

fn main() -> ExitCode {
    let mut cfg = Config {
        raw: "data/raw".into(),
        overrides: "lexicon/overrides".into(),
        out: "data/build".into(),
    };
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut value = |name: &str| -> Result<PathBuf, String> {
            args.next()
                .map(PathBuf::from)
                .ok_or_else(|| format!("{name} richiede un valore"))
        };
        let res = match a.as_str() {
            "--help" | "-h" => {
                println!("{USO}");
                return ExitCode::SUCCESS;
            }
            "--version" => {
                println!("caa-lexicon-build {}", env!("CARGO_PKG_VERSION"));
                return ExitCode::SUCCESS;
            }
            "--raw" => value("--raw").map(|v| cfg.raw = v),
            "--overrides" => value("--overrides").map(|v| cfg.overrides = v),
            "--out" => value("--out").map(|v| cfg.out = v),
            other => Err(format!("argomento sconosciuto: {other}\n\n{USO}")),
        };
        if let Err(e) = res {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    }
    match run(&cfg) {
        Ok(s) => {
            let st = &s.stats;
            println!("Lessico costruito in {}", cfg.out.display());
            println!(
                "  forme {} · lemmi {} · letture {}",
                st.forms, st.lemmas, st.readings
            );
            println!(
                "  pittogrammi {} · chiavi {} · voci {}",
                st.pictograms, st.picto_keys, st.picto_records
            );
            if !st.repaired_lines.is_empty() {
                println!(
                    "  avviso: {} righe di Morph-it! riparate (righe {:?})",
                    st.repaired_lines.len(),
                    st.repaired_lines
                );
            }
            println!("  rapporto: {}", s.report.display());
            println!("  manifesto: {}", s.manifest.display());
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("Errore: {e}");
            ExitCode::FAILURE
        }
    }
}
