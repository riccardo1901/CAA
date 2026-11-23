//! `caa-eval`: misure sul motore.
//!
//! ```text
//! caa-eval dorati    [--lexicon DIR] [--golden FILE]   test dorati di tokenizzazione
//! caa-eval copertura [--lexicon DIR] [--base FILE]     parole di base con pittogramma
//! caa-eval velocita  [--lexicon DIR]                   tempo per un paragrafo di ~100 parole
//! caa-eval tagger    [--lexicon DIR] [--conllu FILE]   scelta di categoria e lemma contro un treebank
//! caa-eval analisi   [--lexicon DIR] [--analisi FILE]  test dorati di analisi (categoria e lemma)
//! caa-eval strutture [--lexicon DIR] [--strutture FILE]  test dorati di struttura (gruppi, segni)
//! caa-eval corpus    [--corpus DIR] [--gruppo sviluppo|prova] [--esempi N]  metriche sul corpus annotato
//! caa-eval prepara FILE.txt                          bozza TSV di un testo da correggere a mano
//! caa-eval candidati PAROLA                          pittogrammi dell'indice per una parola
//! caa-eval tara      [--lexicon DIR] [--conllu FILE]   taratura dei pesi e della confidenza (usa solo il file di sviluppo)
//! caa-eval mostra FRASE [--lexicon DIR]                cosa decide il motore su una frase
//! ```

use std::path::PathBuf;
use std::process::ExitCode;

use caa_engine::treebank::parse_conllu;
use caa_eval::{
    ablate, calibrate, coverage, evaluate_tagger, parse_base, run_analysis, run_golden,
    run_structures, speed, tune,
};
use caa_store::open_engine;

const USO: &str = "caa-eval — misure sul motore di simbolizzazione.\n\
\n\
Uso: caa-eval <comando> [opzioni]\n\
\n\
Comandi:\n\
  dorati     esegue i test dorati di tokenizzazione (opzione --golden FILE)\n\
  copertura  parole di base con pittogramma (opzione --base FILE)\n\
  velocita   tempo di simbolizzazione di un paragrafo di circa 100 parole\n\
  tagger     categoria e lemma scelti dal motore contro un treebank (opzione --conllu FILE)\n\
  analisi    test dorati di analisi: categoria e lemma scelti (opzione --analisi FILE)\n\
  strutture  test dorati di struttura: parole nascoste, segni, espressioni (opzione --strutture FILE)\n\
  corpus     metriche e errori per causa sul corpus annotato (opzioni --corpus, --gruppo, --esempi)\n\
  prepara    bozza TSV di un testo da correggere a mano\n\
  candidati  pittogrammi dell'indice per una parola\n\
  tara       cerca i pesi migliori e la temperatura della confidenza (opzione --conllu FILE)\n\
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
    let mut analysis = PathBuf::from("lexicon/golden/analisi.tsv");
    let mut structures = PathBuf::from("lexicon/golden/strutture.tsv");
    let mut base = PathBuf::from("lexicon/lessico_base.tsv");
    let mut conllu = PathBuf::from("data/raw/treebank/isdt/it_isdt-ud-dev.conllu");
    let mut sentence = String::new();
    if matches!(command.as_str(), "mostra" | "prepara" | "candidati") {
        sentence = args.next().unwrap_or_default();
    }
    let mut corpus_dir = PathBuf::from("corpus/annotati");
    let mut group = PathBuf::from("tutti");
    let mut examples = PathBuf::from("3");
    while let Some(a) = args.next() {
        let target = match a.as_str() {
            "--lexicon" => &mut lexicon,
            "--golden" => &mut golden,
            "--analisi" => &mut analysis,
            "--strutture" => &mut structures,
            "--corpus" => &mut corpus_dir,
            "--gruppo" => &mut group,
            "--esempi" => &mut examples,
            "--base" => &mut base,
            "--conllu" => &mut conllu,
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
    let mut engine = match open_engine(&lexicon) {
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
        "tagger" => {
            let text = match read(&conllu) {
                Ok(t) => t,
                Err(e) => return fail(&e),
            };
            let sentences = parse_conllu(&text);
            let r = evaluate_tagger(&engine, &sentences);
            let pct = |a: usize, b: usize| {
                if b == 0 {
                    0.0
                } else {
                    100.0 * a as f64 / b as f64
                }
            };
            println!(
                "Treebank: {} ({} frasi, {} token; allineati al testo: {})",
                conllu.display(),
                r.sentences,
                r.ud_tokens,
                r.aligned
            );
            println!("Token valutati (senza punteggiatura): {}", r.evaluated);
            println!(
                "  la lettura giusta è tra quelle del motore: {:.1}%",
                pct(r.gold_available, r.evaluated)
            );
            println!(
                "  categoria giusta: {:.1}%   lemma giusto: {:.1}%",
                pct(r.correct_cat, r.evaluated),
                pct(r.correct_lemma, r.evaluated)
            );
            println!(
                "  parole ambigue: {} — categoria giusta: {:.1}%",
                r.ambiguous,
                pct(r.ambiguous_correct, r.ambiguous)
            );
            println!(
                "  errori: {} — con confidenza < 0,6 (sottolineati): {:.1}%",
                r.errors,
                pct(r.errors_flagged, r.errors)
            );
            println!(
                "  parole giuste sottolineate per niente: {:.1}%",
                pct(r.correct_flagged, r.correct_cat)
            );
            let mut c: Vec<_> = r.confusions.iter().collect();
            c.sort_by_key(|(_, n)| std::cmp::Reverse(**n));
            println!("Confusioni più frequenti (attesa → scelta):");
            for ((gold, got), n) in c.iter().take(8) {
                let mut forms: Vec<_> = r.error_forms[&(gold.to_string(), got.to_string())]
                    .iter()
                    .collect();
                forms.sort_by_key(|(f, k)| (std::cmp::Reverse(**k), (*f).clone()));
                let top: Vec<String> = forms
                    .iter()
                    .take(6)
                    .map(|(f, k)| format!("{f} {k}"))
                    .collect();
                println!("  {gold} → {got}: {n}   ({})", top.join(", "));
            }
            ExitCode::SUCCESS
        }
        "analisi" => {
            let text = match read(&analysis) {
                Ok(t) => t,
                Err(e) => return fail(&e),
            };
            match run_analysis(&engine, &text) {
                Ok(r) => {
                    println!("{} casi, {} falliti", r.total, r.failures.len());
                    for f in &r.failures {
                        println!("{f}");
                    }
                    if r.failures.is_empty() {
                        ExitCode::SUCCESS
                    } else {
                        ExitCode::FAILURE
                    }
                }
                Err(errors) => fail(&errors.join("\n")),
            }
        }
        "strutture" => {
            let text = match read(&structures) {
                Ok(t) => t,
                Err(e) => return fail(&e),
            };
            match run_structures(&engine, &text) {
                Ok(r) => {
                    println!("{} casi, {} falliti", r.total, r.failures.len());
                    for f in &r.failures {
                        println!("{f}");
                    }
                    if r.failures.is_empty() {
                        ExitCode::SUCCESS
                    } else {
                        ExitCode::FAILURE
                    }
                }
                Err(errors) => fail(&errors.join("\n")),
            }
        }
        "tara" => {
            let text = match read(&conllu) {
                Ok(t) => t,
                Err(e) => return fail(&e),
            };
            let sentences = parse_conllu(&text);
            let cases = match read(&analysis)
                .map_err(|e| vec![e])
                .and_then(|t| caa_engine::golden::parse_analysis(&t))
            {
                Ok(c) => c,
                Err(e) => return fail(&e.join("\n")),
            };
            println!(
                "Taratura su {} ({} frasi) e {} casi dorati di analisi",
                conllu.display(),
                sentences.len(),
                cases.len()
            );
            let (w, log) = tune(&mut engine, &sentences, &cases);
            for l in &log {
                println!("  {l}");
            }
            println!("Pesi scelti: {w:?}");
            println!("Ablazione (un peso alla volta a zero):");
            for l in ablate(&mut engine, &sentences) {
                println!("  {l}");
            }
            let (t, log) = calibrate(
                &mut engine,
                &sentences,
                &[0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0],
            );
            for l in &log {
                println!("  {l}");
            }
            println!("Temperatura scelta: {t}");
            ExitCode::SUCCESS
        }
        "prepara" => {
            // caa-eval prepara FILE.txt: bozza TSV del motore da correggere a mano. Le righe
            // `# genere: …` del file diventano l'intestazione.
            let path = PathBuf::from(&sentence);
            let text = match read(&path) {
                Ok(t) => t,
                Err(e) => return fail(&e),
            };
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("testo")
                .to_string();
            let header: Vec<(String, String)> = text
                .lines()
                .filter_map(|l| l.strip_prefix("# "))
                .filter_map(|l| l.split_once(": "))
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            let header: Vec<(&str, &str)> = header
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            print!(
                "{}",
                caa_eval::corpus::draft(&engine, &name, &header, &text)
            );
            ExitCode::SUCCESS
        }
        "candidati" => {
            // caa-eval candidati PAROLA: i pittogrammi dell'indice per la parola e per il suo lemma.
            let key = caa_engine::norm::normalize_key(&sentence);
            let mut keys = vec![key.clone()];
            for r in engine.morph().lookup(&key) {
                if let Some(l) = engine.morph().lemma(r.lemma_id) {
                    if !keys.iter().any(|k| k == l) {
                        keys.push(l.to_string());
                    }
                }
            }
            for k in keys {
                let entries = engine.picto_index().lookup(&k);
                println!(
                    "{k}: {}",
                    if entries.is_empty() {
                        "nessun pittogramma".to_string()
                    } else {
                        String::new()
                    }
                );
                for e in entries {
                    println!(
                        "  id {:<6} tipi {:08b} flag {:03b} parole chiave {}",
                        e.id, e.keyword_types, e.flags, e.n_keys
                    );
                }
            }
            ExitCode::SUCCESS
        }
        "corpus" => {
            let mut files: Vec<PathBuf> = match std::fs::read_dir(&corpus_dir) {
                Ok(d) => d
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|x| x == "tsv"))
                    .collect(),
                Err(e) => return fail(&format!("{}: {e}", corpus_dir.display())),
            };
            files.sort();
            let mut texts = Vec::new();
            for f in &files {
                let parsed = read(f)
                    .map_err(|e| vec![e])
                    .and_then(|t| caa_eval::corpus::parse_text(&t));
                match parsed {
                    Ok(t) => texts.push(t),
                    Err(e) => return fail(&format!("{}:\n  {}", f.display(), e.join("\n  "))),
                }
            }
            let n_examples: usize = examples.to_string_lossy().parse().unwrap_or(3);
            let wanted = group.to_string_lossy().to_string();
            let labels: Vec<&str> = if wanted == "tutti" {
                vec!["sviluppo", "prova"]
            } else {
                vec![wanted.as_str()]
            };
            for label in labels {
                let selected: Vec<&caa_eval::corpus::GoldText> =
                    texts.iter().filter(|t| t.group == label).collect();
                let m = caa_eval::corpus::evaluate(&engine, &selected);
                print!("{}", caa_eval::corpus::render(label, &m, n_examples));
                println!();
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
