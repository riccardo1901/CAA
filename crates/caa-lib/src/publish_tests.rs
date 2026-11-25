use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use caa_doc::{DocError, Document, Manifest, Origin};
use serde_json::json;

use crate::index::{scan, IndexCache, LibEntry};
use crate::publish::*;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("caa-pub-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("biblioteca")).unwrap();
    d
}

fn doc(title: &str, author: &str) -> Document {
    let mut m = Manifest::new(title, author, "0.1.0", "lex-1");
    m.subject = "italiano".into();
    m.rev = 57; // le revisioni del documento personale (salvataggi automatici) non c'entrano con quelle della biblioteca
    m.published_rev = Some(9);
    Document {
        manifest: m,
        document: json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":title}]}]}),
        render: json!([]),
        media: BTreeMap::new(),
    }
}

fn read(root: &Path, id: &str) -> caa_doc::Loaded {
    caa_doc::read(&root.join("biblioteca").join(library_file(id))).unwrap()
}

fn files(root: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(root.join("biblioteca"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    v.sort();
    v
}

const NOW: u64 = 1_800_000_000;

#[test]
fn pubblica_crea_un_documento_nuovo_e_non_sovrascrive_mai() {
    let root = tmp("pubblica");
    let d = doc("La storia", "Locale");
    let lib = publish(&root, &d, "Maria Rossi").unwrap();
    // Id del documento personale, revisione 1 della biblioteca, autore dato; niente ricordo del documento personale.
    assert_eq!(
        (
            lib.manifest.id.as_str(),
            lib.manifest.rev,
            lib.manifest.author.as_str()
        ),
        (d.manifest.id.as_str(), 1, "Maria Rossi")
    );
    assert_eq!(lib.manifest.published_rev, None);
    let on_disk = read(&root, &d.manifest.id);
    assert!(on_disk.doc.document == lib.document);
    assert_eq!(
        (
            on_disk.doc.manifest.id.as_str(),
            on_disk.doc.manifest.rev,
            on_disk.doc.manifest.author.as_str()
        ),
        (d.manifest.id.as_str(), 1, "Maria Rossi")
    );
    assert_eq!(files(&root), vec![library_file(&d.manifest.id)]);
    // Pubblicare di nuovo lo stesso documento non lo sovrascrive.
    let mut changed = d.clone();
    changed.document = json!({"type":"doc","content":[]});
    assert_eq!(
        publish(&root, &changed, "Maria Rossi").unwrap_err(),
        LibError::AlreadyPublished
    );
    assert_eq!(read(&root, &d.manifest.id).doc.document, d.document);
    // Anche se lo stesso documento è già in biblioteca sotto un altro nome (copia in conflitto di Drive).
    std::fs::copy(
        root.join("biblioteca").join(library_file(&d.manifest.id)),
        root.join("biblioteca/storia (1).caa"),
    )
    .unwrap();
    std::fs::remove_file(root.join("biblioteca").join(library_file(&d.manifest.id))).unwrap();
    assert_eq!(
        publish(&root, &d, "Maria Rossi").unwrap_err(),
        LibError::AlreadyPublished
    );
    // Identificativi strani.
    let mut bad = d.clone();
    bad.manifest.id = "../x".into();
    assert!(matches!(publish(&root, &bad, "M"), Err(LibError::Io(_))));
    std::fs::remove_dir_all(&root).unwrap();
}

/// Una scrittura che si interrompe dopo `cut` byte.
fn failing(cut: u64) -> impl Fn(&Path, &Document) -> Result<(), DocError> {
    move |p, d| caa_doc::write_failing_after(p, d, cut)
}

#[test]
fn una_pubblicazione_interrotta_non_lascia_niente_di_rotto() {
    let root = tmp("interrotta-pub");
    let d = doc("La storia", "M");
    for cut in [0, 50, 400] {
        assert!(
            publish_using(&root, &d, "Maria", &failing(cut)).is_err(),
            "taglio {cut}"
        );
        assert!(files(&root).is_empty(), "taglio {cut}: {:?}", files(&root));
    }
    // Poi, senza interruzione, riesce.
    publish(&root, &d, "Maria").unwrap();
    assert_eq!(files(&root).len(), 1);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn aggiorna_solo_l_autore_con_la_revisione_avanti_di_uno() {
    let root = tmp("aggiorna");
    let d = doc("Storia", "Maria Rossi");
    publish(&root, &d, "Maria Rossi").unwrap();
    let id = d.manifest.id.clone();
    let mut v2 = d.clone();
    v2.document = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Versione due"}]}]});
    v2.manifest.title = "Storia (nuova)".into();
    assert_eq!(
        update(&root, &v2, 1, "maria rossi ", NOW).unwrap(),
        Updated::Revision { rev: 2 }
    );
    let on_disk = read(&root, &id);
    assert_eq!(
        (
            on_disk.doc.manifest.rev,
            on_disk.doc.manifest.title.as_str(),
            on_disk.doc.manifest.author.as_str()
        ),
        (2, "Storia (nuova)", "Maria Rossi")
    );
    assert_eq!(on_disk.doc.document, v2.document);
    // Un altro utente non può.
    assert_eq!(
        update(&root, &v2, 2, "Luca Bianchi", NOW).unwrap_err(),
        LibError::NotAuthor {
            author: "Maria Rossi".into()
        }
    );
    assert_eq!(read(&root, &id).doc.manifest.rev, 2);
    // Un documento non pubblicato: non c'è.
    let other = doc("Altro", "Maria Rossi");
    assert_eq!(
        update(&root, &other, 1, "Maria Rossi", NOW).unwrap_err(),
        LibError::NotFound
    );
    // Nessun blocco né temporaneo rimasto.
    assert_eq!(files(&root), vec![library_file(&id)]);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn se_la_biblioteca_e_andata_avanti_il_documento_si_salva_come_nuovo() {
    let root = tmp("conflitto");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    // Maria aggiorna da un altro PC: la biblioteca passa alla revisione 2.
    let mut other_pc = d.clone();
    other_pc.document = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Dall'altro PC"}]}]});
    assert_eq!(
        update(&root, &other_pc, 1, "Maria", NOW).unwrap(),
        Updated::Revision { rev: 2 }
    );
    // Questo PC è ancora alla revisione 1: non sovrascrive, salva come documento nuovo.
    let mut mine = d.clone();
    mine.document = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Da questo PC"}]}]});
    let Updated::SavedAsNew { id } = update(&root, &mine, 1, "Maria", NOW).unwrap() else {
        panic!("doveva salvare come nuovo")
    };
    assert_ne!(id, d.manifest.id);
    assert_eq!(
        read(&root, &d.manifest.id).doc.document,
        other_pc.document,
        "il documento di biblioteca non è stato sovrascritto"
    );
    let fresh = read(&root, &id);
    assert_eq!(
        (fresh.doc.manifest.rev, fresh.doc.document),
        (1, mine.document)
    );
    assert_eq!(files(&root).len(), 2);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn il_blocco_protegge_da_due_aggiornamenti_e_scade_dopo_due_ore() {
    let root = tmp("blocco");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    let lock = root
        .join("biblioteca")
        .join(format!("{}.lock", d.manifest.id));
    // Il blocco di un altro (preso adesso): non si aggiorna.
    let held = acquire_lock(&lock, "Luca", NOW).unwrap();
    assert!(lock.exists());
    assert_eq!(
        update(&root, &d, 1, "Maria", NOW + 60).unwrap_err(),
        LibError::Locked {
            by: "Luca".into(),
            at: NOW
        }
    );
    assert!(lock.exists(), "il blocco di un altro non si tocca");
    // A due ore meno un secondo vale ancora; a due ore no: si riprende.
    assert!(matches!(
        acquire_lock(&lock, "Maria", NOW + LOCK_SECONDS - 1),
        Err(LibError::Locked { .. })
    ));
    assert_eq!(
        update(&root, &d, 1, "Maria", NOW + LOCK_SECONDS).unwrap(),
        Updated::Revision { rev: 2 }
    );
    assert!(
        !lock.exists(),
        "il blocco si toglie da solo a fine aggiornamento"
    );
    // Il guardiano di Luca, ormai superato, non toglie il blocco che non è più suo.
    let again = acquire_lock(&lock, "Maria", NOW + LOCK_SECONDS + 5).unwrap();
    drop(held);
    assert!(lock.exists());
    drop(again);
    assert!(!lock.exists());
    // Un blocco illeggibile ma appena creato (chi lo scrive non ha finito) è «preso»: non si riprende.
    std::fs::write(&lock, b"").unwrap();
    assert!(matches!(
        acquire_lock(&lock, "Maria", NOW),
        Err(LibError::Locked { .. })
    ));
    assert!(lock.exists());
    // Uno davvero rovinato (vecchio) si riprende.
    std::fs::write(&lock, b"???").unwrap();
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    std::fs::File::options()
        .write(true)
        .open(&lock)
        .unwrap()
        .set_modified(old)
        .unwrap();
    drop(acquire_lock(&lock, "Maria", NOW).unwrap());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn un_aggiornamento_interrotto_lascia_il_documento_com_era_e_toglie_il_blocco() {
    let root = tmp("interrotto");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    let before = std::fs::read(root.join("biblioteca").join(library_file(&d.manifest.id))).unwrap();
    let mut v2 = d.clone();
    v2.document = json!({"type":"doc","content":[]});
    for cut in [0, 50, 300] {
        assert!(
            update_using(&root, &v2, 1, "Maria", NOW, &failing(cut)).is_err(),
            "taglio {cut}"
        );
        assert_eq!(
            std::fs::read(root.join("biblioteca").join(library_file(&d.manifest.id))).unwrap(),
            before,
            "taglio {cut}"
        );
        assert_eq!(
            files(&root),
            vec![library_file(&d.manifest.id)],
            "taglio {cut}: restano file temporanei o blocchi"
        );
    }
    // Poi riesce.
    assert_eq!(
        update(&root, &v2, 1, "Maria", NOW).unwrap(),
        Updated::Revision { rev: 2 }
    );
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn molti_pc_che_aggiornano_insieme_non_rovinano_mai_il_documento() {
    let root = Arc::new(tmp("insieme"));
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    let id = d.manifest.id.clone();
    // Otto «PC» (thread) che aggiornano lo stesso documento, tutti alla revisione 1, e uno che legge di continuo.
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let reader = {
        let (root, stop, id) = (Arc::clone(&root), Arc::clone(&stop), id.clone());
        std::thread::spawn(move || {
            let mut reads = 0;
            while !stop.load(std::sync::atomic::Ordering::SeqCst) {
                // Chi legge vede sempre un documento intero (il vecchio o il nuovo), mai uno a metà.
                let r = caa_doc::read(&root.join("biblioteca").join(library_file(&id)));
                assert!(r.is_ok(), "lettura di un documento a metà: {:?}", r.err());
                reads += 1;
            }
            reads
        })
    };
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let (root, d) = (Arc::clone(&root), d.clone());
            std::thread::spawn(move || {
                let mut mine = d.clone();
                mine.document = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":format!("PC {i}")}]}]});
                update(&root, &mine, 1, "Maria", NOW)
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    stop.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(reader.join().unwrap() > 0);
    let revisions = results
        .iter()
        .filter(|r| matches!(r, Ok(Updated::Revision { .. })))
        .count();
    let as_new = results
        .iter()
        .filter(|r| matches!(r, Ok(Updated::SavedAsNew { .. })))
        .count();
    let locked = results
        .iter()
        .filter(|r| matches!(r, Err(LibError::Locked { .. })))
        .count();
    // Ogni tentativo ha avuto un esito pulito; uno solo ha preso la revisione 2 (gli altri erano alla 1 e non
    // sovrascrivono: salvati come nuovi, oppure bloccati perché c'era già un aggiornamento in corso).
    assert_eq!(revisions + as_new + locked, 8, "{results:?}");
    assert_eq!(revisions, 1, "{results:?}");
    assert_eq!(read(&root, &id).doc.manifest.rev, 2);
    // Nessun blocco né temporaneo rimasti; ogni file è un documento valido.
    let mut cache = IndexCache::default();
    let s = scan(&root, &mut cache).unwrap();
    assert_eq!(s.incomplete, 0);
    assert_eq!(s.entries.len(), 1 + as_new);
    assert!(
        files(&root).iter().all(|f| f.ends_with(".caa")),
        "{:?}",
        files(&root)
    );
    std::fs::remove_dir_all(&*root).unwrap();
}

#[test]
fn ritira_sposta_in_archivio_solo_l_autore_o_un_amministratore() {
    let root = tmp("ritira");
    let d = doc("Storia", "Maria Rossi");
    publish(&root, &d, "Maria Rossi").unwrap();
    let file = library_file(&d.manifest.id);
    let admins = vec!["Segreteria".to_string()];
    // Un altro docente no; un nome vuoto neppure.
    assert_eq!(
        retire(&root, &file, "Luca", "Luca", &admins).unwrap_err(),
        LibError::NotAuthor {
            author: "Maria Rossi".into()
        }
    );
    assert!(matches!(
        retire(&root, &file, "", "", &admins),
        Err(LibError::NotAuthor { .. })
    ));
    assert!(root.join("biblioteca").join(&file).exists());
    // L'autore sì: il documento esce da biblioteca\ e sta in archivio\, intero.
    let to = retire(&root, &file, " maria rossi", " maria rossi", &admins).unwrap();
    assert!(!root.join("biblioteca").join(&file).exists());
    assert_eq!(to, root.join("archivio").join(&file));
    assert_eq!(caa_doc::read(&to).unwrap().doc.manifest.title, "Storia");
    // Un amministratore ritira anche quelli degli altri; un nome già in archivio non viene sovrascritto.
    publish(&root, &d, "Maria Rossi").unwrap();
    let again = retire(&root, &file, "segreteria", "segreteria", &admins).unwrap();
    assert!(again.to_string_lossy().contains("(2)"), "{again:?}");
    assert_eq!(std::fs::read_dir(root.join("archivio")).unwrap().count(), 2);
    // Un file rovinato (o a metà) lo ritira solo un amministratore.
    std::fs::write(root.join("biblioteca/rotto.caa"), b"PK\x03\x04").unwrap();
    assert!(matches!(
        retire(&root, "rotto.caa", "Maria Rossi", "Maria Rossi", &admins),
        Err(LibError::NotAuthor { .. })
    ));
    assert!(retire(&root, "rotto.caa", "Segreteria", "Segreteria", &admins).is_ok());
    // Nomi sbagliati e documenti che non ci sono.
    assert!(matches!(
        retire(&root, "../x.caa", "Maria Rossi", "Maria Rossi", &admins),
        Err(LibError::Io(_))
    ));
    assert_eq!(
        retire(&root, "non-c-e.caa", "Maria Rossi", "Maria Rossi", &admins).unwrap_err(),
        LibError::NotFound
    );
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn ritirare_un_documento_toglie_anche_il_suo_blocco() {
    let root = tmp("ritira-blocco");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    let lock = root
        .join("biblioteca")
        .join(format!("{}.lock", d.manifest.id));
    std::mem::forget(acquire_lock(&lock, "Maria", 1).unwrap()); // un blocco vecchio rimasto (programma chiuso a metà)
    retire(&root, &library_file(&d.manifest.id), "Maria", "Maria", &[]).unwrap();
    assert!(!lock.exists());
    std::fs::remove_dir_all(&root).unwrap();
}

fn entry(id: &str, rev: u32, conflict: bool) -> LibEntry {
    LibEntry {
        file: format!("{id}.caa"),
        id: id.into(),
        title: "t".into(),
        author: "a".into(),
        subject: String::new(),
        level: String::new(),
        tags: vec![],
        created: String::new(),
        modified: String::new(),
        rev,
        size: 1,
        conflict,
    }
}

#[test]
fn originale_aggiornato() {
    let origin = Origin {
        id: "abc".into(),
        rev: 2,
    };
    let entries = vec![entry("abc", 3, false), entry("altro", 9, false)];
    assert_eq!(original_update(&entries, &origin).map(|e| e.rev), Some(3));
    // Stessa revisione, o più vecchia: niente avviso. Un originale ritirato (non c'è): niente.
    assert!(original_update(&[entry("abc", 2, false)], &origin).is_none());
    assert!(original_update(&[entry("abc", 1, false)], &origin).is_none());
    assert!(original_update(&[entry("altro", 9, false)], &origin).is_none());
    // Con una copia in conflitto non si sa quale sia l'originale: niente avviso.
    assert!(original_update(&[entry("abc", 4, true), entry("abc", 3, true)], &origin).is_none());
}

#[test]
fn versioni_del_programma() {
    for (cur, new, expect) in [
        ("0.1.0", "0.2.0", true),
        ("0.1.0", "0.1.1", true),
        ("0.9.0", "0.10.0", true),
        ("1.0", "1.0.1", true),
        ("0.2.0", "0.2.0", false),
        ("0.2.0", "0.1.9", false),
        ("1.0.0", "1.0", false),
        ("0.1.0", "v0.2.0", true),
        ("0.1.0", "", false),
        ("0.1.0", "boh", false),
        ("0.1.0", "1.x", false),
        ("", "1.0", false),
    ] {
        assert_eq!(newer_version(cur, new), expect, "{cur} → {new}");
    }
}

#[test]
fn il_nome_da_mostrare_non_da_i_poteri_di_amministratore() {
    let root = tmp("ritira-nome");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    let file = library_file(&d.manifest.id);
    let admins = vec!["segreteria".to_string()];
    // Chi sceglie «segreteria» come nome da mostrare, ma ha un altro nome utente, non è amministratore.
    assert!(matches!(
        retire(&root, &file, "segreteria", "luca", &admins),
        Err(LibError::NotAuthor { .. })
    ));
    assert!(root.join("biblioteca").join(&file).exists());
    // Con il nome utente di Windows giusto sì, qualunque sia il nome da mostrare.
    assert!(retire(&root, &file, "Pinco", "SEGRETERIA", &admins).is_ok());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn un_blocco_proprio_rimasto_dopo_un_crash_non_blocca_l_autore() {
    let root = tmp("blocco-proprio");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    let lock = root
        .join("biblioteca")
        .join(format!("{}.lock", d.manifest.id));
    std::mem::forget(acquire_lock(&lock, "Maria", NOW).unwrap());
    // Subito dopo potrebbe essere un altro mio computer che sta aggiornando: aspetta.
    assert!(matches!(
        update(&root, &d, 1, "Maria", NOW + 60),
        Err(LibError::Locked { .. })
    ));
    // Dopo qualche minuto non può più essere un aggiornamento in corso (dura secondi): si riprende.
    assert_eq!(
        update(&root, &d, 1, "Maria", NOW + OWN_LOCK_SECONDS).unwrap(),
        Updated::Revision { rev: 2 }
    );
    assert!(!lock.exists());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn ritirare_non_toglie_il_blocco_di_chi_sta_aggiornando() {
    let root = tmp("ritira-occupato");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    let file = library_file(&d.manifest.id);
    let lock = root
        .join("biblioteca")
        .join(format!("{}.lock", d.manifest.id));
    let _held = acquire_lock(&lock, "Maria", NOW).unwrap();
    let admins = vec!["segreteria".to_string()];
    // L'amministratore non può ritirare mentre l'autore aggiorna: il documento non risorgerebbe mai più.
    assert!(matches!(
        retire(&root, &file, "Segr", "segreteria", &admins),
        Err(LibError::Locked { .. })
    ));
    assert!(root.join("biblioteca").join(&file).exists());
    assert!(lock.exists());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn un_identificativo_strano_non_porta_fuori_dalla_cartella() {
    let root = tmp("ritira-id");
    let mut d = doc("Storia", "Maria");
    d.manifest.id = "../fuori".into();
    // Un manifest di biblioteca con un id che è un percorso (file non fidato).
    caa_doc::write(&root.join("biblioteca").join("x.caa"), &d).unwrap_or(());
    let outside = root.join("fuori.lock");
    std::fs::write(&outside, b"{}").unwrap();
    let _ = retire(&root, "x.caa", "Maria", "maria", &[]);
    assert!(outside.exists(), "un file fuori da biblioteca non si tocca");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn la_copia_da_adattare_non_ricorda_la_pubblicazione() {
    let c = crate::adapted_copy(&doc("Storia", "Maria"), "Luca");
    assert_eq!(c.manifest.published_rev, None);
}

#[test]
fn rev_pubblicata_di_un_documento_gia_in_biblioteca() {
    let root = tmp("rev-esistente");
    let d = doc("Storia", "Maria");
    publish(&root, &d, "Maria").unwrap();
    update(&root, &d, 1, "Maria", NOW).unwrap();
    assert_eq!(existing_rev(&root, &d.manifest.id, "maria", None), Some(2));
    assert_eq!(existing_rev(&root, &d.manifest.id, "Luca", None), None);
    assert_eq!(existing_rev(&root, "altro", "Maria", None), None);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn due_docenti_con_lo_stesso_nome_da_mostrare_non_si_scambiano_i_documenti() {
    let root = tmp("omonimi");
    let mut d = doc("Storia", "Maria Rossi");
    d.manifest.author_user = Some("mrossi".into()); // chi pubblica scrive il suo nome utente di Windows
    publish(&root, &d, "Maria Rossi").unwrap();
    let file = library_file(&d.manifest.id);
    // Un'altra Maria Rossi (nome utente diverso) non è l'autrice: né aggiorna né ritira.
    assert!(matches!(
        update_as(&root, &d, 1, "Maria Rossi", "mrossi2", NOW),
        Err(LibError::NotAuthor { .. })
    ));
    assert!(matches!(
        retire(&root, &file, "Maria Rossi", "mrossi2", &[]),
        Err(LibError::NotAuthor { .. })
    ));
    assert_eq!(
        existing_rev(&root, &d.manifest.id, "Maria Rossi", Some("mrossi2")),
        None
    );
    // L'autrice vera sì, anche se cambia il nome da mostrare.
    assert_eq!(
        update_as(&root, &d, 1, "M. Rossi", "MRossi", NOW).unwrap(),
        Updated::Revision { rev: 2 }
    );
    assert_eq!(
        read(&root, &d.manifest.id)
            .doc
            .manifest
            .author_user
            .as_deref(),
        Some("mrossi")
    );
    assert!(retire(&root, &file, "Altro nome", "mrossi", &[]).is_ok());
    std::fs::remove_dir_all(&root).unwrap();
}
