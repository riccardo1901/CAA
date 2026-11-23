use caa_engine::engine::ReadingSource;
fn main() {
    let e = caa_store::open_engine(std::path::Path::new("data/build")).unwrap();
    for w in [
        "dammi",
        "portamelo",
        "condurlo",
        "lavarsi",
        "dicendolo",
        "fallo",
        "dillo",
        "stacci",
        "vattene",
        "cartella",
        "prendilo",
        "guardarlo",
        "dalla",
        "amici",
        "glielo",
    ] {
        let t = &e.symbolize_text(w)[0];
        println!(
            "{w}: {:?}",
            t.readings
                .iter()
                .map(|r| (
                    r.cat,
                    r.lemma.clone(),
                    r.feats.enclitic.map(|x| x.as_str()),
                    r.source == ReadingSource::Enclitic
                ))
                .collect::<Vec<_>>()
        );
    }
    // quante parole del lessico di base ricevono letture da scomposizione?
    let text = std::fs::read_to_string("lexicon/lessico_base.tsv").unwrap();
    let mut n = 0;
    for l in text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
    {
        let w = l.split('\t').next().unwrap();
        let t = &e.symbolize_text(w)[0];
        if t.readings
            .iter()
            .any(|r| r.source == ReadingSource::Enclitic)
        {
            n += 1;
            println!(
                "  base: {w} -> {:?}",
                t.readings
                    .iter()
                    .filter(|r| r.source == ReadingSource::Enclitic)
                    .map(|r| (r.lemma.clone(), r.feats.enclitic.map(|x| x.as_str())))
                    .collect::<Vec<_>>()
            );
        }
    }
    println!("lessico di base con letture da scomposizione: {n}");
}
