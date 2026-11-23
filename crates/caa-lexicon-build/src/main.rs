//! `caa-lexicon-build`: costruisce il lessico compilato (scheletro di M0, la logica arriva in M2).

const USO: &str = "caa-lexicon-build — costruisce il lessico compilato da ARASAAC, Morph-it! e correzioni curate.\n\
Scheletro di M0: non fa ancora nulla (vedi M2 in SPEC.md).\n\
\n\
Uso: caa-lexicon-build [--help] [--version]";

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--version") => println!("caa-lexicon-build {}", env!("CARGO_PKG_VERSION")),
        _ => println!("{USO}"),
    }
}
