//! Lettura del JSON delle parole chiave italiane di ARASAAC e costruzione delle voci dell'indice.

use std::collections::BTreeMap;

use caa_engine::lexicon::{picto_flags, PictoEntry};
use caa_engine::norm::normalize_key;
use serde::Deserialize;

/// Una parola chiave di un pittogramma, come arriva da `api.arasaac.org`.
#[derive(Debug, Clone, Deserialize)]
pub struct Keyword {
    #[serde(default)]
    pub keyword: String,
    #[serde(rename = "type")]
    pub kind: Option<u8>,
    #[serde(default)]
    pub plural: Option<String>,
}

/// Un pittogramma ARASAAC con le sue parole chiave italiane.
#[derive(Debug, Clone, Deserialize)]
pub struct Pictogram {
    #[serde(rename = "_id")]
    pub id: u32,
    #[serde(default)]
    pub keywords: Vec<Keyword>,
}

pub fn parse(json: &[u8]) -> Result<Vec<Pictogram>, String> {
    serde_json::from_slice(json).map_err(|e| format!("JSON ARASAAC non valido: {e}"))
}

/// Parola chiave normalizzata (le vuote sono scartate), con il suo tipo e il plurale normalizzato.
struct Normalized {
    key: String,
    kind: u8,
    plural: Option<String>,
}

fn normalized_keywords(p: &Pictogram) -> Vec<Normalized> {
    p.keywords
        .iter()
        .filter_map(|k| {
            let key = normalize_key(&k.keyword);
            if key.is_empty() {
                return None;
            }
            let plural = k
                .plural
                .as_deref()
                .map(normalize_key)
                .filter(|s| !s.is_empty());
            Some(Normalized {
                key,
                kind: k.kind.unwrap_or(0),
                plural,
            })
        })
        .collect()
}

/// Le parole chiave "proprie" di ogni pittogramma (senza i plurali derivati): chiave, tipo, id.
pub fn primary_keys(pictograms: &[Pictogram]) -> Vec<(String, u8, u32)> {
    pictograms
        .iter()
        .flat_map(|p| {
            normalized_keywords(p)
                .into_iter()
                .map(move |k| (k.key, k.kind, p.id))
        })
        .collect()
}

/// Numero di pittogrammi senza nessuna parola chiave italiana utilizzabile.
pub fn without_keywords(pictograms: &[Pictogram]) -> usize {
    pictograms
        .iter()
        .filter(|p| normalized_keywords(p).is_empty())
        .count()
}

fn merge(map: &mut BTreeMap<String, Vec<PictoEntry>>, key: String, entry: PictoEntry) {
    let list = map.entry(key).or_default();
    match list.iter_mut().find(|e| e.id == entry.id) {
        Some(existing) => existing.flags |= entry.flags,
        None => list.push(entry),
    }
}

/// Voci dell'indice: chiave normalizzata → pittogrammi, in ordine di id.
///
/// Per ogni parola chiave si registra la chiave stessa e, se ARASAAC indica un plurale diverso,
/// anche il plurale (con `PLURAL_FORM`). Se il plurale coincide con la parola chiave, questa è
/// invariabile (`INVARIABLE_PLURAL`).
pub fn index_entries(pictograms: &[Pictogram]) -> BTreeMap<String, Vec<PictoEntry>> {
    let mut map: BTreeMap<String, Vec<PictoEntry>> = BTreeMap::new();
    for p in pictograms {
        let kws = normalized_keywords(p);
        let n_keys = u16::try_from(kws.len()).unwrap_or(u16::MAX);
        for (i, k) in kws.iter().enumerate() {
            let multi = |s: &str| {
                if s.contains(' ') {
                    picto_flags::MULTIWORD
                } else {
                    0
                }
            };
            let mut flags = multi(&k.key) | if i == 0 { picto_flags::FIRST_KEY } else { 0 };
            if k.plural.as_deref() == Some(k.key.as_str()) {
                flags |= picto_flags::INVARIABLE_PLURAL;
            }
            merge(
                &mut map,
                k.key.clone(),
                PictoEntry {
                    id: p.id,
                    keyword_type: k.kind,
                    flags,
                    n_keys,
                },
            );
            // Per le frasi ARASAAC indica spesso solo il plurale della testa ("mettere un cartello"
            // → "cartelli"): registrarlo come chiave autonoma farebbe vincere il pittogramma
            // sbagliato. Il plurale vale solo se ha le stesse parole della chiave.
            let same_words = |pl: &str| pl.split(' ').count() == k.key.split(' ').count();
            if let Some(pl) = k
                .plural
                .as_ref()
                .filter(|pl| **pl != k.key && same_words(pl))
            {
                let entry = PictoEntry {
                    id: p.id,
                    keyword_type: k.kind,
                    flags: multi(pl) | picto_flags::PLURAL_FORM,
                    n_keys,
                };
                merge(&mut map, pl.clone(), entry);
            }
        }
    }
    for list in map.values_mut() {
        list.sort_by_key(|e| e.id);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pics(json: &str) -> Vec<Pictogram> {
        parse(json.as_bytes()).unwrap()
    }

    #[test]
    fn plurale_derivato_e_prima_chiave() {
        let m = index_entries(&pics(
            r#"[{"_id":2239,"keywords":[{"type":2,"keyword":"Ape","plural":"api"}]}]"#,
        ));
        let ape = &m["ape"][0];
        assert_eq!((ape.id, ape.keyword_type, ape.n_keys), (2239, 2, 1));
        assert!(ape.has_flag(picto_flags::FIRST_KEY));
        assert!(!ape.has_flag(picto_flags::PLURAL_FORM));
        let api = &m["api"][0];
        assert_eq!(api.id, 2239);
        assert!(api.has_flag(picto_flags::PLURAL_FORM));
        assert!(!api.has_flag(picto_flags::FIRST_KEY));
    }

    #[test]
    fn plurale_uguale_alla_chiave_e_invariabile() {
        let m = index_entries(&pics(
            r#"[{"_id":9,"keywords":[{"keyword":"forbici","plural":"forbici"}]}]"#,
        ));
        assert_eq!(m.len(), 1);
        let e = &m["forbici"][0];
        assert!(e.has_flag(picto_flags::INVARIABLE_PLURAL));
        assert_eq!(e.keyword_type, 0); // tipo assente
    }

    #[test]
    fn multiparola_vuote_e_accenti() {
        let p = pics(
            r#"[{"_id":1,"keywords":[{"type":2,"keyword":"  "},{"type":2,"keyword":"Scuola   media"},{"type":2,"keyword":"CITTÀ"}]},{"_id":2,"keywords":[]}]"#,
        );
        let m = index_entries(&p);
        let sm = &m["scuola media"][0];
        assert!(sm.has_flag(picto_flags::MULTIWORD) && sm.has_flag(picto_flags::FIRST_KEY));
        assert_eq!(sm.n_keys, 2); // la parola chiave vuota non conta
        assert!(!m["città"][0].has_flag(picto_flags::FIRST_KEY));
        assert_eq!(without_keywords(&p), 1);
    }

    #[test]
    fn stessa_chiave_su_piu_pittogrammi_in_ordine_di_id() {
        let m = index_entries(&pics(
            r#"[{"_id":30,"keywords":[{"type":2,"keyword":"porta"}]},{"_id":5,"keywords":[{"type":2,"keyword":"porta"}]}]"#,
        ));
        let ids: Vec<u32> = m["porta"].iter().map(|e| e.id).collect();
        assert_eq!(ids, vec![5, 30]);
    }

    #[test]
    fn il_plurale_di_una_frase_non_diventa_una_chiave_di_una_parola() {
        // Regressione (revisione M0-M2): ARASAAC indica come plurale solo la testa della frase
        // ("mettere un cartello" → "cartelli"). Registrarlo come chiave autonoma faceva vincere
        // il pittogramma sbagliato per "cartelli" ("meno chiavi = più specifico").
        let m = index_entries(&pics(
            r#"[{"_id":8065,"keywords":[{"type":2,"keyword":"cartello"},{"type":2,"keyword":"insegna"}]},
                {"_id":33958,"keywords":[{"type":3,"keyword":"mettere un cartello","plural":"cartelli"}]},
                {"_id":1,"keywords":[{"type":2,"keyword":"cartello","plural":"cartelli"}]},
                {"_id":2,"keywords":[{"type":2,"keyword":"tartaruga marina","plural":"tartarughe marine"}]},
                {"_id":3,"keywords":[{"type":2,"keyword":"lettore dvd","plural":"lettori"}]}]"#,
        ));
        let ids: Vec<u32> = m["cartelli"].iter().map(|e| e.id).collect();
        assert_eq!(
            ids,
            vec![1],
            "solo il pittogramma di una parola con plurale di una parola"
        );
        assert!(!m.contains_key("lettori"));
        // Una frase con un plurale della stessa lunghezza resta valida.
        assert!(m["tartarughe marine"][0].has_flag(picto_flags::PLURAL_FORM));
        assert!(m["tartarughe marine"][0].has_flag(picto_flags::MULTIWORD));
    }

    #[test]
    fn json_non_valido() {
        assert!(parse(b"{}").is_err());
    }
}
