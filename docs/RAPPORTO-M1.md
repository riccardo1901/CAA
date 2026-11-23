# Rapporto M1 — acquisizione dati

Data: 2026-11-23. Generato da `scripts/report-m1.mjs`, con la sintesi di verifica scritta a mano qui sotto.
I dati grezzi non sono in git (vedi `CLAUDE.md`); l'elenco completo delle etichette Morph-it! è in `docs/M1-etichette-morphit.tsv`.

## Endpoint verificati

| Fonte | Endpoint | Note |
| --- | --- | --- |
| Parole chiave ARASAAC | `https://api.arasaac.org/v1/pictograms/all/it` | JSON, risponde 405 alle richieste HEAD |
| Immagini ARASAAC | `https://static.arasaac.org/pictograms/<id>/<id>_<risoluzione>.png` | risoluzioni 300, 500, 2500 px; usata 500 |
| Morph-it! | `https://docs.sslmit.unibo.it/lib/exe/fetch.php?media=resources:morph-it.tgz` | versione 048; risponde 402 a ogni User-Agent diverso da curl, quindi lo script usa `curl` |

## Mappatura verificata delle categorie ARASAAC

Verificata su esempi reali (12 per tipo, a passo regolare).

| Tipo | Parole chiave | Cosa contiene |
| --- | --- | --- |
| 1 | 822 | nomi propri e luoghi (Turchia, Urano, PlayStation) |
| 2 | 12.939 | nomi comuni |
| 3 | 4.734 | verbi, anche perifrasi (fare il bagno) |
| 4 | 1.914 | aggettivi, numeri e ordinali, avverbi (spesso, varie volte) |
| 5 | 428 | frasi, esclamazioni e cartelli (vietato, auguri); qualche parola isolata anomala (verde) |
| 6 | 948 | orari, mesi, pulsanti, parole funzionali isolate (i, mi) |
| nessuno | 615 | misto, non affidabile per il punteggio |

## Differenze rispetto a `SPEC.md` (da decidere, la specifica non è stata modificata)

1. Pittogrammi: 13.924, non "circa 13.000"; 124 senza parola chiave italiana.
2. Le categorie sono sei più "nessuno" (615 parole chiave senza tipo): la mappatura completa è sopra.
3. ARASAAC fornisce il plurale di ogni parola chiave (7.079 casi): utile per il flag "è plurale" di `picto_index.bin`.
4. Morph-it! è la versione 048 (non 0.11), codificata in ISO-8859-15 (convertita in UTF-8), con 664 etichette distinte e 2 righe malformate (`seppur seppure ADV/CON`, separate da spazi invece che da tabulazioni).
5. Morph-it! contiene già alcune forme con clitici (`dammi`, `lavarsi`): l'analisi dei clitici di M6 resta necessaria per le forme mancanti.
6. "fare colazione" non esiste in ARASAAC: ci sono tre pittogrammi con "far colazione" (ids 4625, 7012, 28667). Per il test dorato 12 serve lemmatizzare "far" come "fare" (regola o riga in `forms_extra.tsv`).
7. Il WebP a 500 px pesa 239 MB in totale (stima da campione: 190 MB).

---


## ARASAAC
- pittogrammi: 13924
- pittogrammi senza parola chiave italiana: 124
- parole chiave italiane (totale): 22404
- parole chiave multiparola: 8593
- parole chiave con plurale indicato: 7079
- immagini WebP presenti: 13924 / 13924
- immagini mancanti: 0
- immagini fallite nell'ultimo scarico: 0

### Categorie delle parole chiave (tipo → numero, esempi presi a passo regolare)
- tipo 1: 822 — PlayStation · Moncayo · Baldassarre · Navarra · Urano · festa di San Giovanni · Turchia · Cattedrale di Malaga · Kasakistan · Albania · Opera di Sidney · Mezzaluna Rossa
- tipo 2: 12939 — ape · yacht · palestra · sedano · eredità · trampolino · tutrice · dentifricio e spazzolino · bagno · carità · vassoio per ghiaccio · operare telefonico
- tipo 3: 4734 — fare il bagno · spazzare · vaccinare · sollevare il sedile del water · donare · dipingere · saltare a piè pari · consacrare · lavorare · indossare la mascherina · diventare grasso · piacere
- tipo 4: 1914 — noioso · dolce · qualcuna · sorpresa · comodo · obbediente · varie volte · sessantaquattro · caloroso · quarta · spesso · oberato
- tipo 5: 428 — senza capelli · lasciami in pace · vietato usare cellulari · che programma vuoi vedere? · io, anche! · auguri · vietato disturbare · troppo stretto · vietato · chiamata al 118 · verde · c'è il sole!
- tipo 6: 948 — numeri · Aprile · i · 22:15h · le quattro in punto · mi · tasto volume giù · un  quarto alle tre · le 2 e mezza · le dieci meno un quarto · le cinque in punto · le 9 e un quarto
- tipo nessuno: 615 — acqua potabile · sala pesi · lombrico · stupro · donna in stato di gravidanza · piccozza · W-Fi · granoturco · allenatore pallacanestro · tutoraggio · musc · caccia alle uova

## Morph-it!
- righe: 505074 (2 non nel formato forma<TAB>lemma<TAB>etichetta)
- forme distinte: 405399
- lemmi distinti: 35056
- etichette distinte: 664 (elenco completo in data/raw/report/morphit_labels.tsv)

### Famiglie di etichette (prefisso → righe)
VER 391285 · ADJ 72371 · NOUN 35564 · NPR 2848 · ADV 871 · PRO 436 · DET 393 · MOD 381 · AUX 257 · CAU 134 · INT 107 · ASP 82 · SMI 68 · CON 56 · PRE 51 · ARTPRE 43 · ABL 35 · PON 25 · WH 18 · ART 18 · SYM 13 · TALE 6 · SENT 5 · NE 2 · CE 1 · CI 1 · SI 1

### Righe anomale (prime 10)
- ["seppur seppure ADV"]
- ["seppur seppure CON"]
