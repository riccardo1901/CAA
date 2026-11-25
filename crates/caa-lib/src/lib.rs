//! La biblioteca condivisa dell'istituto e le impostazioni dell'utente (SPEC.md, "Biblioteca, copie
//! personali, sincronizzazione"). La biblioteca è una cartella dentro un Drive condiviso Google, che Google
//! Drive per computer mostra come una cartella normale: qui non c'è rete né account, solo file. Perciò
//! niente si dà per completo o istantaneo: un file può arrivare a metà, in ritardo, o non arrivare.
//!
//! ```text
//! <cartella CAA>\
//!   biblioteca\<uuid>.caa     documenti di riferimento
//!   archivio\                 documenti ritirati
//!   simboli\  correzioni\  aggiornamenti\
//! ```

pub mod cache;
pub mod config;
pub mod detect;
pub mod index;
pub mod reach;

use caa_doc::{Document, Origin};

/// La copia personale di un documento di biblioteca ("Adatta"): un documento nuovo (id nuovo, revisione 1)
/// che ricorda l'id e la revisione dell'originale. Il contenuto e le immagini restano quelli dell'originale.
pub fn adapted_copy(original: &Document, author: &str) -> Document {
    let mut copy = original.clone();
    let now = caa_doc::now_iso();
    let m = &mut copy.manifest;
    m.origin = Some(Origin {
        id: original.manifest.id.clone(),
        rev: original.manifest.rev,
    });
    m.id = caa_doc::new_id();
    m.rev = 1;
    m.author = author.to_string();
    m.created = now.clone();
    m.modified = now;
    copy
}

#[cfg(test)]
mod tests;
