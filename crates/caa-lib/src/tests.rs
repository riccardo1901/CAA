use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use caa_doc::{Document, Manifest};
use serde_json::json;

use crate::cache::{read_for_adapt, sync_docs};
use crate::config::{
    clean_display_name, config_path, load_config, load_settings, save_settings, Settings,
};
use crate::detect::{create_library, find_candidates, is_library};
use crate::index::{is_doc_name, load_index, save_index, scan, IndexCache};
use crate::reach::{is_reachable, with_timeout};
use crate::{adapted_copy, config::SharedConfig};

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("caa-lib-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn doc(title: &str, author: &str, rev: u32) -> Document {
    let mut m = Manifest::new(title, author, "0.1.0", "lex-1");
    m.rev = rev;
    m.subject = "italiano".into();
    m.level = "primaria".into();
    m.tags = vec!["storia".into()];
    let mut media = BTreeMap::new();
    media.insert(
        "img1.webp".to_string(),
        b"RIFF\0\0\0\0WEBPVP8 abcd".to_vec(),
    );
    m.media = media.keys().cloned().collect();
    Document {
        manifest: m,
        document: json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":title}]}]}),
        render: json!([]),
        media,
    }
}

/// Scrive un documento in `<root>/biblioteca/<file>`.
fn put(root: &Path, file: &str, d: &Document) {
    let dir = root.join("biblioteca");
    std::fs::create_dir_all(&dir).unwrap();
    caa_doc::write(&dir.join(file), d).unwrap();
}

#[test]
fn la_copia_da_adattare_e_un_documento_nuovo_che_ricorda_l_originale() {
    let original = doc("La storia di è", "Maria", 4);
    let copy = adapted_copy(&original, "Luca");
    assert_ne!(copy.manifest.id, original.manifest.id);
    assert_eq!(copy.manifest.id.len(), 32);
    assert_eq!(
        (copy.manifest.rev, copy.manifest.author.as_str()),
        (1, "Luca")
    );
    let origin = copy.manifest.origin.clone().unwrap();
    assert_eq!((origin.id, origin.rev), (original.manifest.id.clone(), 4));
    // Contenuto, immagini e metadati restano quelli dell'originale.
    assert_eq!(copy.document, original.document);
    assert_eq!(copy.media, original.media);
    assert_eq!(
        (copy.manifest.title.as_str(), copy.manifest.subject.as_str()),
        ("La storia di è", "italiano")
    );
    // L'originale non è toccato.
    assert_eq!(
        (original.manifest.rev, original.manifest.author.as_str()),
        (4, "Maria")
    );
    // Una copia di una copia ricorda la sua copia diretta, non l'originale lontano.
    let again = adapted_copy(&copy, "Anna");
    assert_eq!(again.manifest.origin.unwrap().id, copy.manifest.id);
}

#[test]
fn configurazione_e_impostazioni() {
    let dir = tmp("config");
    // Mancante o rovinata: vale come vuota.
    assert_eq!(
        load_config(&dir.join("non-c-e.json")),
        SharedConfig::default()
    );
    std::fs::write(dir.join("rotto.json"), b"{ no").unwrap();
    assert_eq!(
        load_config(&dir.join("rotto.json")),
        SharedConfig::default()
    );
    std::fs::write(
        dir.join("config.json"),
        br#"{"drive_name":"CAA Istituto","folder":"CAA","admins":["segreteria","tecnico"],"altro":1}"#,
    )
    .unwrap();
    let cfg = load_config(&dir.join("config.json"));
    assert_eq!(cfg.drive_name.as_deref(), Some("CAA Istituto"));
    assert_eq!(cfg.admins, vec!["segreteria", "tecnico"]);
    assert_eq!(cfg.library_path, None);
    // Impostazioni: andata e ritorno; un file rovinato si mette da parte.
    assert_eq!(load_settings(&dir.join("sub")), Settings::default());
    let s = Settings {
        display_name: "Maria Rossi".into(),
        library_path: Some("G:\\x".into()),
    };
    save_settings(&dir.join("sub"), &s).unwrap();
    assert_eq!(load_settings(&dir.join("sub")), s);
    assert!(std::fs::read_dir(dir.join("sub"))
        .unwrap()
        .flatten()
        .all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
    std::fs::write(dir.join("sub").join("settings.json"), b"???").unwrap();
    assert_eq!(load_settings(&dir.join("sub")), Settings::default());
    assert!(dir.join("sub").join("settings.json.bad").exists());
    // Il nome da mostrare.
    assert_eq!(clean_display_name("  Maria \t  Rossi\n"), "Maria Rossi");
    assert_eq!(clean_display_name("\u{0}\u{7}"), "");
    assert_eq!(clean_display_name(&"é".repeat(100)).chars().count(), 60);
    assert_eq!(
        config_path(Some("/x/c.json"), Some("/pd")),
        PathBuf::from("/x/c.json")
    );
    assert_eq!(
        config_path(None, Some("/pd")),
        Path::new("/pd").join("CAA").join("config.json")
    );
    assert_eq!(
        config_path(Some(""), None),
        PathBuf::from("/etc/caa/config.json")
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn si_trova_la_cartella_nei_drive_condivisi() {
    let g = tmp("drive-g");
    let h = tmp("drive-h");
    // G:\Drive condivisi\CAA Istituto\CAA\biblioteca  e  G:\Drive condivisi\Altro\CAA (senza biblioteca)
    std::fs::create_dir_all(g.join("Drive condivisi/CAA Istituto/CAA/biblioteca")).unwrap();
    std::fs::create_dir_all(g.join("Drive condivisi/Altro/CAA")).unwrap();
    // H:\Shared drives\Scuola\CAA\biblioteca (Drive in inglese)
    std::fs::create_dir_all(h.join("Shared drives/Scuola/CAA/biblioteca")).unwrap();
    let roots = [g.clone(), h.clone(), PathBuf::from("/non/esiste")];
    let all = find_candidates(&roots, &SharedConfig::default());
    assert_eq!(all.len(), 2, "{all:?}");
    assert!(all
        .iter()
        .any(|c| c.drive == "CAA Istituto" && c.path.ends_with("CAA")));
    assert!(all.iter().any(|c| c.drive == "Scuola"));
    // Con il nome del Drive nella configurazione, solo quello (senza badare alle maiuscole).
    let cfg = SharedConfig {
        drive_name: Some("caa istituto".into()),
        ..Default::default()
    };
    let one = find_candidates(&roots, &cfg);
    assert_eq!(one.len(), 1);
    assert_eq!(one[0].drive, "CAA Istituto");
    assert!(is_library(&one[0].path));
    // Un altro nome di cartella.
    std::fs::create_dir_all(g.join("Drive condivisi/CAA Istituto/Materiali/biblioteca")).unwrap();
    let cfg = SharedConfig {
        folder: Some("Materiali".into()),
        ..Default::default()
    };
    assert_eq!(find_candidates(&roots, &cfg).len(), 1);
    // Creare la struttura di una biblioteca nuova.
    let fresh = g.join("nuova");
    create_library(&fresh).unwrap();
    for sub in [
        "biblioteca",
        "archivio",
        "simboli",
        "correzioni",
        "aggiornamenti",
    ] {
        assert!(fresh.join(sub).is_dir(), "{sub}");
    }
    assert!(is_library(&fresh) && !is_library(&g));
    std::fs::remove_dir_all(&g).unwrap();
    std::fs::remove_dir_all(&h).unwrap();
}

#[test]
fn raggiungibile_con_un_tempo_massimo() {
    let dir = tmp("reach");
    assert!(is_reachable(&dir, Duration::from_secs(2)));
    assert!(!is_reachable(&dir.join("non-c-e"), Duration::from_secs(2)));
    // Una lettura che si blocca non blocca chi chiede.
    let t0 = std::time::Instant::now();
    let r = with_timeout(Duration::from_millis(100), || {
        std::thread::sleep(Duration::from_secs(2));
        1
    });
    assert!(r.is_none());
    assert!(t0.elapsed() < Duration::from_secs(1));
    assert_eq!(with_timeout(Duration::from_secs(1), || 7), Some(7));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn nomi_dei_documenti() {
    for ok in ["a.caa", "La storia (2).caa"] {
        assert!(is_doc_name(ok), "{ok}");
    }
    for bad in [
        "",
        ".caa",
        ".nascosto.caa",
        "a.caa.tmp",
        "a.caa.123.tmp",
        "a.lock",
        "a.txt",
        "a/b.caa",
        "a\u{0}.caa",
    ] {
        assert!(!is_doc_name(bad), "{bad:?}");
    }
}

#[test]
fn l_indice_legge_i_manifest_e_rilegge_solo_i_file_cambiati() {
    let root = tmp("indice");
    put(&root, "uno.caa", &doc("Uno", "Maria", 1));
    put(&root, "due.caa", &doc("Due", "Luca", 3));
    // Cose da ignorare: temporanei, blocchi, altri file, sottocartelle.
    std::fs::write(root.join("biblioteca/uno.caa.4242.tmp"), b"x").unwrap();
    std::fs::write(root.join("biblioteca/uno.lock"), b"{}").unwrap();
    std::fs::write(root.join("biblioteca/note.txt"), b"x").unwrap();
    std::fs::create_dir_all(root.join("biblioteca/sotto.caa")).unwrap();
    let mut cache = IndexCache::default();
    let a = scan(&root, &mut cache).unwrap();
    assert_eq!((a.entries.len(), a.incomplete, a.reads), (2, 0, 2));
    let two = a.entries.iter().find(|e| e.title == "Due").unwrap();
    assert_eq!(
        (
            two.author.as_str(),
            two.rev,
            two.subject.as_str(),
            two.level.as_str()
        ),
        ("Luca", 3, "italiano", "primaria")
    );
    assert_eq!(two.tags, vec!["storia"]);
    assert!(!two.conflict && two.size > 0);
    // Seconda scansione: niente è cambiato, niente si rilegge.
    assert_eq!(scan(&root, &mut cache).unwrap().reads, 0);
    // Un file riscritto (dimensione o data diversa) si rilegge, gli altri no.
    std::thread::sleep(Duration::from_millis(20));
    put(
        &root,
        "due.caa",
        &doc("Due con titolo più lungo", "Luca", 4),
    );
    let b = scan(&root, &mut cache).unwrap();
    assert_eq!(b.reads, 1);
    assert_eq!(
        b.entries.iter().find(|e| e.file == "due.caa").unwrap().rev,
        4
    );
    // Un file tolto sparisce dall'elenco.
    std::fs::remove_file(root.join("biblioteca/uno.caa")).unwrap();
    assert_eq!(scan(&root, &mut cache).unwrap().entries.len(), 1);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn file_ancora_in_sincronizzazione_si_saltano_e_si_ritrovano_dopo() {
    let root = tmp("sync");
    put(&root, "bello.caa", &doc("Bello", "M", 1));
    let full = std::fs::read(root.join("biblioteca/bello.caa")).unwrap();
    // Un file scaricato a metà: Drive lo sta ancora copiando.
    std::fs::write(root.join("biblioteca/arriva.caa"), &full[..full.len() / 2]).unwrap();
    std::fs::write(root.join("biblioteca/vuoto.caa"), b"").unwrap();
    let mut cache = IndexCache::default();
    let a = scan(&root, &mut cache).unwrap();
    assert_eq!((a.entries.len(), a.incomplete), (1, 2));
    // Quando il file è completo compare alla scansione dopo (un errore non si ricorda).
    std::fs::write(root.join("biblioteca/arriva.caa"), &full).unwrap();
    let b = scan(&root, &mut cache).unwrap();
    assert_eq!((b.entries.len(), b.incomplete), (2, 1));
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn due_file_con_lo_stesso_id_sono_una_copia_in_conflitto() {
    let root = tmp("conflitto");
    let d = doc("Storia", "Maria", 2);
    put(&root, "storia.caa", &d);
    put(&root, "storia (1).caa", &d); // la copia che Drive crea quando due PC scrivono insieme
    put(&root, "altro.caa", &doc("Altro", "Luca", 1));
    let s = scan(&root, &mut IndexCache::default()).unwrap();
    let mut flagged: Vec<_> = s
        .entries
        .iter()
        .filter(|e| e.conflict)
        .map(|e| e.file.as_str())
        .collect();
    flagged.sort_unstable();
    assert_eq!(flagged, vec!["storia (1).caa", "storia.caa"]);
    assert!(
        !s.entries
            .iter()
            .find(|e| e.file == "altro.caa")
            .unwrap()
            .conflict
    );
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn senza_la_cartella_la_scansione_dice_errore_e_l_ultimo_elenco_si_ritrova() {
    let root = tmp("offline");
    let cache_dir = tmp("offline-cache");
    put(&root, "uno.caa", &doc("Uno", "M", 1));
    let mut cache = IndexCache::default();
    let s = scan(&root, &mut cache).unwrap();
    save_index(&cache_dir, &s.entries).unwrap();
    assert_eq!(load_index(&cache_dir), s.entries);
    // Il Drive sparisce.
    std::fs::remove_dir_all(&root).unwrap();
    assert!(scan(&root, &mut cache).is_err());
    assert_eq!(load_index(&cache_dir).len(), 1);
    // Un elenco rovinato o mancante è vuoto.
    std::fs::write(cache_dir.join("index.json"), b"{rotto").unwrap();
    assert!(load_index(&cache_dir).is_empty());
    assert!(load_index(&cache_dir.join("non-c-e")).is_empty());
    std::fs::remove_dir_all(&cache_dir).unwrap();
}

#[test]
fn la_cache_dei_documenti_serve_a_adattare_senza_il_drive() {
    let root = tmp("cache-root");
    let cache_dir = tmp("cache-dir");
    put(&root, "uno.caa", &doc("Uno", "Maria", 2));
    put(&root, "due.caa", &doc("Due", "Luca", 1));
    // Un file a metà non finisce in cache.
    let full = std::fs::read(root.join("biblioteca/uno.caa")).unwrap();
    std::fs::write(root.join("biblioteca/mezzo.caa"), &full[..full.len() / 3]).unwrap();
    let s = scan(&root, &mut IndexCache::default()).unwrap();
    assert_eq!(sync_docs(&root, &s.entries, &cache_dir), 2);
    assert!(cache_dir.join("uno.caa").is_file() && !cache_dir.join("mezzo.caa").exists());
    // Una seconda copia non rifà quello che c'è già.
    assert_eq!(sync_docs(&root, &s.entries, &cache_dir), 0);
    // Adattare dal Drive: legge l'originale.
    let live = read_for_adapt(&root, &cache_dir, "uno.caa", Duration::from_secs(2)).unwrap();
    assert_eq!(live.doc.manifest.title, "Uno");
    // Senza il Drive si legge la copia in cache.
    std::fs::remove_dir_all(&root).unwrap();
    let cached = read_for_adapt(&root, &cache_dir, "uno.caa", Duration::from_secs(2)).unwrap();
    assert_eq!(cached.doc.manifest.id, live.doc.manifest.id);
    // Né nel Drive né in cache: errore chiaro; nomi sbagliati rifiutati.
    assert!(read_for_adapt(&root, &cache_dir, "tre.caa", Duration::from_secs(2)).is_err());
    for bad in ["../uno.caa", "a/b.caa", "uno.txt", ""] {
        assert!(
            read_for_adapt(&root, &cache_dir, bad, Duration::from_secs(2)).is_err(),
            "{bad:?}"
        );
    }
    // Un documento ritirato dalla biblioteca esce anche dalla cache.
    let none: Vec<_> = Vec::new();
    sync_docs(Path::new("/non/c/e"), &none, &cache_dir);
    assert!(!cache_dir.join("uno.caa").exists());
    std::fs::remove_dir_all(&cache_dir).unwrap();
}
