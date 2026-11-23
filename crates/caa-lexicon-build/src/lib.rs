//! `caa-lexicon-build`: costruisce il lessico compilato da ARASAAC, Morph-it! e correzioni curate.
//!
//! La logica sta qui (testabile da sola); `main.rs` è solo la riga di comando.

pub mod arasaac;
pub mod compile;
pub mod labels;
pub mod morphit;
pub mod overrides;
pub mod pipeline;
pub mod report;
pub mod tagger_build;
