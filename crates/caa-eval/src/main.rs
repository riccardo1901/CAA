//! `caa-eval`: misure sul motore.
//!
//! ```text
//! caa-eval dorati    [--lexicon DIR] [--golden FILE]   test dorati di tokenizzazione
//! caa-eval copertura [--lexicon DIR] [--base FILE]     parole di base con pittogramma
//! caa-eval velocita  [--lexicon DIR]                   tempo per un paragrafo di ~100 parole
//! caa-eval mostra FRASE [--lexicon DIR]                cosa decide il motore su una frase
//! ```

use std::path::PathBuf;
use std::process::ExitCode;

use caa_eval::{coverage, parse_base, run_golden, speed};
use caa_store::open_engine;

const USO: &str = "caa-eval — misure sul motore di simbolizzazione.\n\
\n\
Uso: caa-eval <comando> [opzioni]\n\
\n\
Comandi:\n\
  dorati     esegue i test dorati di tokenizzazione (opzione --golden FILE)\n\
  copertura  parole di base con pittogramma (opzione --base FILE)\n\
  velocita   tempo di simbolizzazione di un paragrafo di circa 100 parole\n\
  mostra     lettura, categoria e pittogramma di ogni parola di una frase\n\
\n\
Opzioni comuni: --lexicon DIR (predefinito data/build), --help, --version";

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        println!("{USO}");
        return ExitCode::SUCCESS;
    };
    let mut lexicon = PathBuf::from("data/build");
    let mut golden = PathBuf::from("lexicon/golden/tokenizzazione.tsv");
    let mut base = PathBuf::from("lexicon/lessico_base.tsv");
    let mut sentence = String::new();
    if command == "mostra" {
        sentence = args.next().unwrap_or_default();
    }
    while let Some(a) = args.next() {
        let target = match a.as_str() {
            "--lexicon" => &mut lexicon,
            "--golden" => &mut golden,
            "--base" => &mut base,
            other => {
                eprintln!("argomento sconosciuto: {other}\n\n{USO}");
                return ExitCode::FAILURE;
            }
        };
        match args.next() {
            Some(v) => *target = PathBuf::from(v),
            None => {
                eprintln!("{a} richiede un valore");
                return ExitCode::FAILURE;
            }
        }
    }
    match command.as_str() {
        "--help" | "-h" => {
            println!("{USO}");
            return ExitCode::SUCCESS;
        }
        "--version" => {
            println!("caa-eval {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    let engine = match open_engine(&lexicon) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Non riesco ad aprire il lessico in {}: {e}\n(si costruisce con: cargo run --release -p caa-lexicon-build)", lexicon.display());
            return ExitCode::FAILURE;
        }
    };
    let read =
        |p: &PathBuf| std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()));
    match command.as_str() {
        "dorati" => {
            let text = match read(&golden) {
                Ok(t) => t,
                Err(e) => return fail(&e),
            };
            match run_golden(&engine, &text) {
                Ok(r) => {
                    println!(
                        "Test dorati di tokenizzazione: {} su {} superati",
                        r.total - r.failures.len(),
                        r.total
                    );
                    for f in &r.failures {
                        println!("{f}");
                    }
                    if r.failures.is_empty() {
                        ExitCode::SUCCESS
                    } else {
                        ExitCode::FAILURE
                    }
                }
                Err(e) => fail(&e.join("\n")),
            }
        }
        "copertura" => {
            let words = match read(&base)
                .map_err(|e| vec![e])
                .and_then(|t| parse_base(&t))
            {
                Ok(w) => w,
                Err(e) => return fail(&e.join("\n")),
            };
            let r = coverage(&engine, &words);
            let pct = |a: usize, b: usize| {
                if b == 0 {
                    0.0
                } else {
                    100.0 * a as f64 / b as f64
                }
            };
            println!(
                "Copertura delle parole di base: {} su {} con un pittogramma ({:.1}%)",
                r.with_picto,
                r.total,
                pct(r.with_picto, r.total)
            );
            for (cat, (n, ok)) in &r.by_cat {
                println!("  {cat:<5} {ok:>4} / {n:<4} ({:.1}%)", pct(*ok, *n));
            }
            println!(
                "Risolte dalla lettura da chiave ARASAAC: {} ({:.1}%)",
                r.from_arasaac_key,
                pct(r.from_arasaac_key, r.total)
            );
            println!(
                "Pittogramma trovato ignorando la categoria: {}",
                r.ignoring_category
            );
            println!(
                "Parole che nell'editor sarebbero sottolineate (confidenza < 0,6): {}",
                r.underlined
            );
            println!("Come è stato scelto il pittogramma:");
            for (reason, n) in &r.by_reason {
                println!("  {reason:<26} {n}");
            }
            if !r.missing.is_empty() {
                println!("Senza pittogramma ({}):", r.missing.len());
                println!(
                    "  {}",
                    r.missing
                        .iter()
                        .map(|(w, c)| format!("{w} ({c})"))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
            ExitCode::SUCCESS
        }
        "mostra" => {
            for t in engine.symbolize_text(&sentence) {
                let reading = t
                    .analysis
                    .as_ref()
                    .map_or("—".to_string(), |a| format!("{} {:?}", a.lemma, a.cat));
                let picto = t.picto.map_or("—".to_string(), |p| p.id.to_string());
                println!(
                    "{:>3}-{:<3} {:<14} {:<26} picto {:<6} fiducia {:.1}  [{}]",
                    t.span_utf16.0,
                    t.span_utf16.1,
                    t.surface,
                    reading,
                    picto,
                    t.confidence,
                    t.reason
                );
            }
            ExitCode::SUCCESS
        }
        "velocita" => {
            let paragraph = "Quest'anno Giulia frequentava la terza elementare e alla maestra piaceva molto, perché la bambina era gentile, curiosa e faceva sempre tante domande sull'acqua, sul cielo e sugli animali. Un giorno, mentre tornava a casa con la sua amica Marta, vide un uccellino ferito sotto l'albero del giardino. Era piccolo, tremava e non riusciva a volare. «Poverino!» disse Giulia. Le due amiche presero l'uccellino con delicatezza e lo portarono a casa.";
            let r = speed(&engine, paragraph, 200);
            println!("Paragrafo di {} parole, {} prove: mediana {:.3} ms, massimo {:.3} ms (obiettivo < 5 ms)", r.words, r.runs, r.median_ms, r.max_ms);
            ExitCode::SUCCESS
        }
        other => fail(&format!("comando sconosciuto: {other}\n\n{USO}")),
    }
}

fn fail(msg: &str) -> ExitCode {
    eprintln!("{msg}");
    ExitCode::FAILURE
}
