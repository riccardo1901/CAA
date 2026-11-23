//! Misura il tempo di caricamento del lessico compilato (criterio di M2: < 300 ms).
//!
//! Uso: `cargo run --release -p caa-store --example load_lexicon -- data/build`

use std::path::PathBuf;
use std::time::Instant;

use caa_engine::norm::normalize_key;
use caa_store::open_lexicon;

fn rss_mb() -> Option<f64> {
    let s = std::fs::read_to_string("/proc/self/status").ok()?;
    let kb: f64 = s
        .lines()
        .find(|l| l.starts_with("VmRSS:"))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()?;
    Some(kb / 1024.0)
}

fn main() {
    let dir: PathBuf = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "data/build".into())
        .into();
    let mut times = Vec::new();
    for i in 0..5 {
        let t = Instant::now();
        let lex = open_lexicon(&dir).unwrap_or_else(|e| panic!("{e}"));
        // Una ricerca per forzare l'accesso ai file, come farebbe l'app subito dopo l'avvio.
        let n = lex.morph.lookup("porta").len() + lex.picto.lookup("casa").len();
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        times.push(ms);
        if i == 0 {
            println!(
                "build {:016x} · forme {} · lemmi {} · letture {} · chiavi pittogrammi {} · voci {} (prova: {n} risultati)",
                lex.morph.build_id(),
                lex.morph.form_count(),
                lex.morph.lemma_count(),
                lex.morph.reading_count(),
                lex.picto.key_count(),
                lex.picto.record_count()
            );
        }
    }
    println!(
        "caricamento (5 prove, ms): {}",
        times
            .iter()
            .map(|t| format!("{t:.2}"))
            .collect::<Vec<_>>()
            .join(" · ")
    );
    if let Some(m) = rss_mb() {
        println!("memoria residente del processo: {m:.1} MB");
    }

    // Piccola verifica con parole accentate.
    let lex = open_lexicon(&dir).unwrap();
    for w in [
        "porta", "perché", "città", "dammi", "lavarsi", "occhiali", "era",
    ] {
        let readings = lex.morph.lookup(&normalize_key(w));
        let lemmas: Vec<&str> = readings
            .iter()
            .filter_map(|r| lex.morph.lemma(r.lemma_id))
            .collect();
        println!(
            "  {w}: {} letture {:?} · pittogrammi: {}",
            readings.len(),
            lemmas,
            lex.picto.lookup(&normalize_key(w)).len()
        );
    }
}
