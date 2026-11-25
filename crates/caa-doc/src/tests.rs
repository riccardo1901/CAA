use std::io::Cursor;

use serde_json::json;

use super::*;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("caa-doc-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn sample() -> Document {
    let mut manifest = Manifest::new("La storia di è", "Maria", "0.1.0", "lex-7");
    manifest.subject = "italiano".into();
    manifest.tags = vec!["storia".into(), "sociale".into()];
    manifest.prefs = json!({ "policy": "custom:articles=hidden", "size": 68 });
    manifest.sense_locks = json!([{ "lemma": "pesca", "cat": "NOUN", "picto": 5 }]);
    let mut media = BTreeMap::new();
    media.insert(
        "a1b2c3.webp".to_string(),
        b"RIFF\0\0\0\0WEBPVP8 xxxx".to_vec(),
    );
    media.insert("zz_9-x.webp".to_string(), vec![7u8; 5000]);
    manifest.media = media.keys().cloned().collect();
    manifest.has_render = true;
    Document {
        manifest,
        document: json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Città è già così: perché?"}]}]}),
        render: json!([{ "text": "Città", "tokens": [{ "s": 0, "e": 5, "picto": 12 }] }]),
        media,
    }
}

#[test]
fn andata_e_ritorno_con_tutto_dentro() {
    let dir = tmp("andata");
    let path = dir.join("storia.caa");
    let doc = sample();
    write(&path, &doc).unwrap();
    let loaded = read(&path).unwrap();
    assert!(!loaded.read_only && loaded.migrated_from.is_none());
    assert!(
        loaded.doc == doc,
        "il documento letto è diverso da quello scritto"
    );
    // Solo i metadati, senza leggere il resto.
    assert_eq!(read_manifest(&path).unwrap(), doc.manifest);
    // Nessun file temporaneo rimasto.
    let names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name())
        .collect();
    assert_eq!(names, vec![std::ffi::OsString::from("storia.caa")]);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn riscrivere_sostituisce_il_file() {
    let dir = tmp("riscrivi");
    let path = dir.join("d.caa");
    let mut doc = sample();
    write(&path, &doc).unwrap();
    doc.manifest.rev = 2;
    doc.manifest.title = "Nuovo titolo".into();
    write(&path, &doc).unwrap();
    assert_eq!(read(&path).unwrap().doc.manifest.rev, 2);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn un_documento_senza_render_si_apre_lo_stesso() {
    let dir = tmp("norender");
    let path = dir.join("d.caa");
    let mut doc = sample();
    doc.render = Value::Null;
    doc.media.clear();
    doc.manifest.media.clear();
    doc.manifest.has_render = false;
    write(&path, &doc).unwrap();
    assert_eq!(read(&path).unwrap().doc.render, Value::Null);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn una_scrittura_interrotta_non_rovina_il_documento_di_prima() {
    let dir = tmp("interrotta");
    let path = dir.join("d.caa");
    let before = sample();
    write(&path, &before).unwrap();
    let before_bytes = std::fs::read(&path).unwrap();
    let mut after = before.clone();
    after.manifest.rev = 2;
    after.document = json!({"type":"doc","content":[]});
    // Si interrompe in punti diversi della scrittura (all'inizio, a metà, quasi alla fine).
    let total = {
        let probe = dir.join("probe.caa");
        write(&probe, &after).unwrap();
        std::fs::metadata(&probe).unwrap().len()
    };
    std::fs::remove_file(dir.join("probe.caa")).unwrap();
    for cut in [0, 1, 30, 200, total / 2, total - 10, total - 1] {
        let err = write_failing_after(&path, &after, cut);
        assert!(err.is_err(), "taglio a {cut} byte");
        // Il file di prima è identico, ancora valido, e non resta nessun temporaneo.
        assert_eq!(
            std::fs::read(&path).unwrap(),
            before_bytes,
            "taglio a {cut}"
        );
        assert!(read(&path).unwrap().doc == before);
        let leftovers = std::fs::read_dir(&dir).unwrap().flatten().count();
        assert_eq!(leftovers, 1, "taglio a {cut}: restano file temporanei");
    }
    // Una scrittura nuova, senza file di prima, interrotta: niente documento, niente rovine.
    let fresh = dir.join("nuovo.caa");
    assert!(write_failing_after(&fresh, &after, 100).is_err());
    assert!(!fresh.exists());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn un_file_troncato_o_rovinato_non_si_legge_mai_a_meta() {
    let dir = tmp("troncato");
    let path = dir.join("d.caa");
    let original = sample();
    write(&path, &original).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    // Come un file che Drive non ha ancora finito di scaricare: ogni lunghezza è un errore pulito.
    for len in (0..bytes.len()).step_by(37).chain([bytes.len() - 1]) {
        let r = read_from(Cursor::new(bytes[..len].to_vec()));
        assert!(
            matches!(r, Err(DocError::Unreadable(_))),
            "lunghezza {len}: {r:?}"
        );
    }
    // Un byte rovinato nei dati compressi o nei CRC: errore o contenuto identico, mai un panic.
    let mut flipped_errors = 0;
    for i in (0..bytes.len()).step_by(53) {
        let mut b = bytes.clone();
        b[i] ^= 0xFF;
        match read_from(Cursor::new(b)) {
            // Un byte che non cambia i dati (per esempio la data di un'intestazione) può passare, ma
            // mai con un contenuto diverso: la corruzione silenziosa è il caso da escludere.
            Ok(l) => {
                let d = &l.doc;
                let what = [
                    ("manifest", d.manifest == original.manifest),
                    ("document", d.document == original.document),
                    ("render", d.render == original.render),
                    ("media", d.media == original.media),
                ];
                let changed: Vec<&str> = what
                    .iter()
                    .filter(|(_, same)| !same)
                    .map(|(n, _)| *n)
                    .collect();
                assert!(
                    changed.is_empty(),
                    "byte {i} rovinato e sono cambiati: {changed:?}"
                );
            }
            Err(_) => flipped_errors += 1,
        }
    }
    assert!(flipped_errors > 0);
    // Non è nemmeno uno ZIP.
    assert!(matches!(
        read_from(Cursor::new(b"non sono uno zip".to_vec())),
        Err(DocError::Unreadable(_))
    ));
    assert!(matches!(read(&dir.join("manca.caa")), Err(DocError::Io(_))));
    std::fs::remove_dir_all(&dir).unwrap();
}

/// Costruisce uno ZIP a mano con le voci date.
fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        for (name, bytes) in entries {
            z.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            z.write_all(bytes).unwrap();
        }
        z.finish().unwrap();
    }
    buf.into_inner()
}

fn manifest_json(schema: u64) -> Vec<u8> {
    serde_json::to_vec(
        &json!({ "schema": schema, "id": "abc", "title": "t", "futuro": { "x": 1 } }),
    )
    .unwrap()
}

#[test]
fn un_file_piu_nuovo_si_apre_in_sola_lettura() {
    let bytes = zip_with(&[
        ("manifest.json", &manifest_json(u64::from(SCHEMA) + 1)),
        ("document.json", b"{\"type\":\"doc\"}"),
    ]);
    let l = read_from(Cursor::new(bytes)).unwrap();
    assert!(l.read_only);
    assert_eq!(l.doc.manifest.id, "abc");
}

#[test]
fn schema_mancante_o_impossibile_e_un_errore() {
    for m in [
        json!({"id":"x"}),
        json!({"schema":0,"id":"x"}),
        json!({"schema":"uno","id":"x"}),
        json!({"schema":-1,"id":"x"}),
    ] {
        let bytes = zip_with(&[
            ("manifest.json", &serde_json::to_vec(&m).unwrap()),
            ("document.json", b"{}"),
        ]);
        assert!(read_from(Cursor::new(bytes)).is_err(), "{m}");
    }
    // Mancano pezzi essenziali o il JSON è rotto.
    assert!(read_from(Cursor::new(zip_with(&[("document.json", b"{}")]))).is_err());
    assert!(read_from(Cursor::new(zip_with(&[(
        "manifest.json",
        &manifest_json(1)
    )])))
    .is_err());
    assert!(read_from(Cursor::new(zip_with(&[
        ("manifest.json", b"{rotto"),
        ("document.json", b"{}")
    ])))
    .is_err());
}

fn step_add_field(manifest: &mut Value, document: &mut Value) {
    manifest["migrato"] = Value::from(true);
    document["migrato"] = Value::from(true);
}

fn step_rename(manifest: &mut Value, _document: &mut Value) {
    manifest["title2"] = manifest["title"].clone();
}

#[test]
fn le_migrazioni_portano_avanti_di_uno_schema_alla_volta() {
    let mut m = json!({"schema":1,"title":"t"});
    let mut d = json!({"type":"doc"});
    let end = migrate_with(&[step_add_field, step_rename], 1, 3, &mut m, &mut d).unwrap();
    assert_eq!(end, 3);
    assert_eq!(m["schema"], 3);
    assert_eq!(
        (
            m["migrato"].as_bool(),
            d["migrato"].as_bool(),
            m["title2"].as_str()
        ),
        (Some(true), Some(true), Some("t"))
    );
    // Da uno schema a metà strada si fanno solo i passi che restano.
    let mut m = json!({"schema":2,"title":"t"});
    let mut d = json!({});
    migrate_with(&[step_add_field, step_rename], 2, 3, &mut m, &mut d).unwrap();
    assert!(m.get("migrato").is_none() && m["title2"] == "t");
    // Se manca un passo è un errore, non un salto nel vuoto.
    let mut m = json!({"schema":1});
    assert!(migrate_with(&[step_add_field], 1, 3, &mut m, &mut json!({})).is_err());
    // Oggi l'unico schema è il 1: la tabella dei passi veri è vuota e coerente.
    assert_eq!(MIGRATIONS.len() as u32, SCHEMA - 1);
}

#[test]
fn nomi_di_immagini_strani_non_entrano_ne_escono() {
    for ok in ["a.webp", "A1-b_2.webp", &format!("{}.webp", "x".repeat(64))] {
        assert!(valid_media_name(ok), "{ok}");
    }
    for bad in [
        "",
        ".webp",
        "a.png",
        "../x.webp",
        "a/b.webp",
        "a\\b.webp",
        "a b.webp",
        "é.webp",
        &format!("{}.webp", "x".repeat(65)),
        "a.webp.exe",
    ] {
        assert!(!valid_media_name(bad), "{bad}");
    }
    // In lettura una voce con un nome strano si ignora; in scrittura è un errore.
    let bytes = zip_with(&[
        ("manifest.json", &manifest_json(1)),
        ("document.json", b"{}"),
        ("media/ok.webp", b"RIFFxxxxWEBP"),
        ("media/../evil.webp", b"x"),
        ("media/sub/dir.webp", b"x"),
        ("media/a.png", b"x"),
    ]);
    let l = read_from(Cursor::new(bytes)).unwrap();
    assert_eq!(l.doc.media.keys().collect::<Vec<_>>(), vec!["ok.webp"]);
    // Un'immagine che il manifest dice di avere e che nel file non c'è: errore, non una perdita silenziosa.
    let mut m: Value = serde_json::from_slice(&manifest_json(1)).unwrap();
    m["media"] = json!(["ok.webp", "persa.webp"]);
    let bytes = zip_with(&[
        ("manifest.json", &serde_json::to_vec(&m).unwrap()),
        ("document.json", b"{}"),
        ("media/ok.webp", b"RIFFxxxxWEBP"),
    ]);
    assert!(
        matches!(read_from(Cursor::new(bytes)), Err(DocError::Unreadable(m)) if m.contains("persa.webp"))
    );
    let dir = tmp("nomi");
    let mut doc = sample();
    doc.media.insert("../x.webp".into(), vec![1]);
    assert!(write(&dir.join("d.caa"), &doc).is_err());
    assert!(!dir.join("d.caa").exists());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn i_tetti_di_sicurezza_fermano_i_file_enormi() {
    // Una voce più grande del tetto (compressa è minuscola: una "bomba").
    let big = vec![b' '; (MAX_ENTRY_BYTES + 10) as usize];
    let mut buf = Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let o = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        z.start_file("manifest.json", o).unwrap();
        z.write_all(&manifest_json(1)).unwrap();
        z.start_file("document.json", o).unwrap();
        z.write_all(&big).unwrap();
        z.finish().unwrap();
    }
    assert!(matches!(
        read_from(Cursor::new(buf.into_inner())),
        Err(DocError::TooBig(_))
    ));
}

#[test]
fn identificativi_e_date() {
    let a = new_id();
    let b = new_id();
    assert_ne!(a, b);
    assert_eq!(a.len(), 32);
    assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
    // Date note.
    assert_eq!(iso_from_unix(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso_from_unix(951_782_400), "2000-02-29T00:00:00Z"); // anno bisestile
    assert_eq!(iso_from_unix(1_795_603_927), "2026-11-25T10:52:07Z");
    assert_eq!(iso_from_unix(4_102_444_799), "2099-12-31T23:59:59Z");
    let now = now_iso();
    assert_eq!(now.len(), 20);
    assert!(now.starts_with("20") && now.ends_with('Z'));
    // Solo lo schema attuale si scrive.
    let mut doc = sample();
    doc.manifest.schema = SCHEMA + 1;
    let dir = tmp("schema");
    assert!(write(&dir.join("d.caa"), &doc).is_err());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn render_mancante_e_un_errore_solo_se_il_file_dice_di_averlo() {
    // Un file di altra origine senza `render.json` si apre lo stesso.
    let bytes = zip_with(&[
        ("manifest.json", &manifest_json(1)),
        ("document.json", b"{}"),
    ]);
    assert_eq!(
        read_from(Cursor::new(bytes)).unwrap().doc.render,
        Value::Null
    );
    // Un file scritto da noi (`has_render`) senza `render.json` è rovinato.
    let mut m: Value = serde_json::from_slice(&manifest_json(1)).unwrap();
    m["has_render"] = json!(true);
    let bytes = zip_with(&[
        ("manifest.json", &serde_json::to_vec(&m).unwrap()),
        ("document.json", b"{}"),
    ]);
    assert!(
        matches!(read_from(Cursor::new(bytes)), Err(DocError::Unreadable(m)) if m.contains("render.json"))
    );
}

#[test]
fn voci_duplicate_nello_zip_sono_un_errore() {
    // Due voci con lo stesso nome: quale vale? Meglio rifiutare il file che sceglierne una a caso. La libreria
    // ZIP non le scrive: si costruisce il file con un nome diverso e poi lo si cambia nei byte.
    let mut bytes = zip_with(&[
        ("manifest.json", &manifest_json(1)),
        ("document.json", b"{}"),
        ("document.jsoX", b"{\"type\":\"doc\"}"),
    ]);
    let (from, to) = (b"document.jsoX", b"document.json");
    let mut i = 0;
    while i + from.len() <= bytes.len() {
        if &bytes[i..i + from.len()] == from {
            bytes[i..i + from.len()].copy_from_slice(to);
            i += from.len();
        } else {
            i += 1;
        }
    }
    let r = read_from(Cursor::new(bytes));
    assert!(
        matches!(&r, Err(DocError::Unreadable(m)) if m.contains("duplicat")),
        "{:?}",
        r.as_ref().err()
    );
}
