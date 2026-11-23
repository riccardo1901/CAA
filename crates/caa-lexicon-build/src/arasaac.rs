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
    /// La chiave si è ottenuta togliendo una precisazione tra parentesi.
    disambiguated: bool,
}

/// Toglie i gruppi tra parentesi da una chiave già normalizzata ("castagno (albero)" → "castagno",
/// "(la) atleta" → "atleta"). Restituisce la chiave e se è cambiata.
fn strip_parens(key: &str) -> (String, bool) {
    if !key.contains(['(', ')']) {
        return (key.to_string(), false);
    }
    let mut depth = 0usize;
    let mut out = String::with_capacity(key.len());
    for c in key.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            c if depth == 0 => out.push(c),
            _ => {}
        }
    }
    (normalize_key(&out), true)
}

fn normalized_keywords(p: &Pictogram) -> Vec<Normalized> {
    p.keywords
        .iter()
        .filter_map(|k| {
            let (key, disambiguated) = strip_parens(&normalize_key(&k.keyword));
            if key.is_empty() {
                return None;
            }
            let plural = k
                .plural
                .as_deref()
                .map(|pl| strip_parens(&normalize_key(pl)).0)
                .filter(|s| !s.is_empty());
            Some(Normalized {
                key,
                kind: k.kind.unwrap_or(0),
                plural,
                disambiguated,
            })
        })
        .collect()
}

/// Le parole chiave "proprie" di ogni pittogramma (senza i plurali derivati): chiave, tipo, id.
/// Le chiavi sono quelle dell'indice (senza le precisazioni tra parentesi).
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

/// Una voce dell'indice prima della scrittura: il record e, per i plurali derivati, il testo
/// della parola chiave singolare (il campo `singular` del record lo assegna la build).
#[derive(Debug, Clone)]
pub struct IndexEntry {
    pub entry: PictoEntry,
    pub singular: Option<String>,
}

/// Bit del tipo ARASAAC in `keyword_types` (i tipi oltre il 7 confluiscono nel bit 7).
fn type_bit(kind: u8) -> u8 {
    1 << kind.min(7)
}

fn merge(map: &mut BTreeMap<String, Vec<IndexEntry>>, key: String, new: IndexEntry) {
    let list = map.entry(key).or_default();
    match list.iter_mut().find(|e| e.entry.id == new.entry.id) {
        Some(existing) => {
            // La stessa chiave sullo stesso pittogramma con più tipi o più ruoli: si uniscono.
            existing.entry.flags |= new.entry.flags;
            existing.entry.keyword_types |= new.entry.keyword_types;
            if existing.singular.is_none() {
                existing.singular = new.singular;
            }
        }
        None => list.push(new),
    }
}

/// Voci dell'indice: chiave normalizzata → pittogrammi, in ordine di id.
///
/// Per ogni parola chiave si registra la chiave stessa e, se ARASAAC indica un plurale diverso,
/// anche il plurale (con `PLURAL_FORM` e il testo del singolare). Se il plurale coincide con la
/// parola chiave, questa è invariabile (`INVARIABLE_PLURAL`).
pub fn index_entries(pictograms: &[Pictogram]) -> BTreeMap<String, Vec<IndexEntry>> {
    let mut map: BTreeMap<String, Vec<IndexEntry>> = BTreeMap::new();
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
            let disamb = if k.disambiguated {
                picto_flags::DISAMBIGUATED
            } else {
                0
            };
            let mut flags =
                multi(&k.key) | disamb | if i == 0 { picto_flags::FIRST_KEY } else { 0 };
            if k.plural.as_deref() == Some(k.key.as_str()) {
                flags |= picto_flags::INVARIABLE_PLURAL;
            }
            let record = |flags: u8| PictoEntry {
                id: p.id,
                keyword_types: type_bit(k.kind),
                flags,
                n_keys,
                singular: 0,
            };
            merge(
                &mut map,
                k.key.clone(),
                IndexEntry {
                    entry: record(flags),
                    singular: None,
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
                merge(
                    &mut map,
                    pl.clone(),
                    IndexEntry {
                        entry: record(multi(pl) | disamb | picto_flags::PLURAL_FORM),
                        singular: Some(k.key.clone()),
                    },
                );
            }
        }
    }
    for list in map.values_mut() {
        list.sort_by_key(|e| e.entry.id);
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
        let ape = &m["ape"][0].entry;
        assert_eq!((ape.id, ape.n_keys), (2239, 1));
        assert!(ape.has_type(2) && !ape.has_type(3));
        assert!(ape.has_flag(picto_flags::FIRST_KEY));
        assert!(!ape.has_flag(picto_flags::PLURAL_FORM));
        assert_eq!(m["ape"][0].singular, None);
        let api = &m["api"][0];
        assert_eq!(api.entry.id, 2239);
        assert!(api.entry.has_flag(picto_flags::PLURAL_FORM));
        assert!(!api.entry.has_flag(picto_flags::FIRST_KEY));
        // Il plurale ricorda la parola chiave singolare (revisione M0-M2: serve alla fase 3).
        assert_eq!(api.singular.as_deref(), Some("ape"));
    }

    #[test]
    fn plurale_uguale_alla_chiave_e_invariabile() {
        let m = index_entries(&pics(
            r#"[{"_id":9,"keywords":[{"keyword":"forbici","plural":"forbici"}]}]"#,
        ));
        assert_eq!(m.len(), 1);
        let e = &m["forbici"][0].entry;
        assert!(e.has_flag(picto_flags::INVARIABLE_PLURAL));
        assert!(e.has_type(0) && e.keyword_types == 1); // tipo assente
        assert_eq!(m["forbici"][0].singular, None);
    }

    #[test]
    fn multiparola_vuote_e_accenti() {
        let p = pics(
            r#"[{"_id":1,"keywords":[{"type":2,"keyword":"  "},{"type":2,"keyword":"Scuola   media"},{"type":2,"keyword":"CITTÀ"}]},{"_id":2,"keywords":[]}]"#,
        );
        let m = index_entries(&p);
        let sm = &m["scuola media"][0].entry;
        assert!(sm.has_flag(picto_flags::MULTIWORD) && sm.has_flag(picto_flags::FIRST_KEY));
        assert_eq!(sm.n_keys, 2); // la parola chiave vuota non conta
        assert!(!m["città"][0].entry.has_flag(picto_flags::FIRST_KEY));
        assert_eq!(without_keywords(&p), 1);
    }

    #[test]
    fn stessa_chiave_su_piu_pittogrammi_in_ordine_di_id() {
        let m = index_entries(&pics(
            r#"[{"_id":30,"keywords":[{"type":2,"keyword":"porta"}]},{"_id":5,"keywords":[{"type":2,"keyword":"porta"}]}]"#,
        ));
        let ids: Vec<u32> = m["porta"].iter().map(|e| e.entry.id).collect();
        assert_eq!(ids, vec![5, 30]);
    }

    #[test]
    fn i_tipi_di_una_stessa_chiave_si_uniscono() {
        // Revisione M0-M2: "giallo" è tipo 4 (aggettivo) e tipo 2 (nome) sullo stesso pittogramma;
        // prima restava solo il primo.
        let m = index_entries(&pics(
            r#"[{"_id":7,"keywords":[{"type":4,"keyword":"giallo"},{"type":2,"keyword":"giallo"}]}]"#,
        ));
        let e = &m["giallo"][0].entry;
        assert_eq!(m["giallo"].len(), 1);
        assert!(e.has_type(4) && e.has_type(2) && !e.has_type(3) && !e.has_type(0));
        assert!(!e.has_type(9)); // fuori intervallo: mai vero
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
        let ids: Vec<u32> = m["cartelli"].iter().map(|e| e.entry.id).collect();
        assert_eq!(
            ids,
            vec![1],
            "solo il pittogramma di una parola con plurale di una parola"
        );
        assert!(!m.contains_key("lettori"));
        // Una frase con un plurale della stessa lunghezza resta valida.
        let tm = &m["tartarughe marine"][0];
        assert!(tm.entry.has_flag(picto_flags::PLURAL_FORM));
        assert!(tm.entry.has_flag(picto_flags::MULTIWORD));
        assert_eq!(tm.singular.as_deref(), Some("tartaruga marina"));
    }

    #[test]
    fn le_precisazioni_tra_parentesi_si_tolgono_dalla_chiave() {
        // Revisione M0-M2: "castagno (albero)" e "(la) atleta" non corrisponderebbero mai a una
        // parola del testo.
        let p = pics(
            r#"[{"_id":1,"keywords":[{"type":2,"keyword":"castagno (albero)"},{"type":2,"keyword":"(la) atleta"}]},
                {"_id":2,"keywords":[{"type":2,"keyword":"(le) pugili"},{"type":2,"keyword":"( )"}]}]"#,
        );
        let m = index_entries(&p);
        assert!(!m.keys().any(|k| k.contains(['(', ')'])));
        let c = &m["castagno"][0].entry;
        assert!(c.has_flag(picto_flags::DISAMBIGUATED) && c.has_flag(picto_flags::FIRST_KEY));
        assert!(m["atleta"][0].entry.has_flag(picto_flags::DISAMBIGUATED));
        assert!(m["pugili"][0].entry.has_flag(picto_flags::DISAMBIGUATED));
        assert_eq!(m["pugili"][0].entry.n_keys, 1); // "( )" non è una parola chiave
                                                    // Anche il rapporto di copertura usa le chiavi senza parentesi.
        let keys: Vec<String> = primary_keys(&p).into_iter().map(|(k, _, _)| k).collect();
        assert_eq!(keys, vec!["castagno", "atleta", "pugili"]);
    }

    #[test]
    fn strip_parens_casi_limite() {
        assert_eq!(strip_parens("casa"), ("casa".to_string(), false));
        assert_eq!(
            strip_parens("banco (di scuola) nuovo"),
            ("banco nuovo".to_string(), true)
        );
        assert_eq!(strip_parens("a (b (c) d) e"), ("a e".to_string(), true));
        assert_eq!(
            strip_parens("storto) caso"),
            ("storto caso".to_string(), true)
        );
        assert_eq!(strip_parens("(x)"), (String::new(), true));
    }

    #[test]
    fn json_non_valido() {
        assert!(parse(b"{}").is_err());
    }
}
