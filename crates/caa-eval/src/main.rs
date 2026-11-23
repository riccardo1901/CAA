//! `caa-eval`: esegue il motore sul corpus e stampa le metriche (scheletro di M0, la logica arriva in M7).

const USO: &str = "caa-eval — esegue il motore sul corpus di test e produce le metriche.\n\
Scheletro di M0: non fa ancora nulla (vedi M7 in SPEC.md).\n\
\n\
Uso: caa-eval [--help] [--version]";

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--version") => println!("caa-eval {}", env!("CARGO_PKG_VERSION")),
        _ => println!("{USO}"),
    }
}
