# Rapporto M2 — build del lessico

Data: 2026-11-23. Il corpo (da "Rapporto di build" in poi) è generato da `caa-lexicon-build` sui dati di M1;
le conclusioni qui sotto sono scritte a mano. Le liste complete delle chiavi senza lemma restano in
`data/build/report/` (fuori da git: sono estratti dei dati ARASAAC) e si rigenerano con il comando in `CLAUDE.md`.

## Criteri di accettazione

| Criterio | Esito |
| --- | --- |
| Caricamento del lessico < 300 ms | **0,02–0,06 ms** (apertura dei 4 file mappati in memoria + due ricerche, 5 prove, cache del disco già calda). Il lessico occupa 7,9 MB; con cache fredda il tempo dipende dalla lettura del disco ma è limitato dalla dimensione dei file. |
| Tutte le etichette mappate | **664 su 664**: la build sui dati veri si ferma con errore se trova un'etichetta non mappata, e un test legge le 664 etichette di `docs/M1-etichette-morphit.tsv`. |
| Rapporto delle chiavi ARASAAC senza lemma | **1.539 chiavi** di una parola senza forma né lemma alla chiusura di M2; dopo il lavoro sulle lacune (sezione sotto) **1.449**, e 838 multiparola con almeno una parola sconosciuta. |

Verifiche: 55 test verdi (motore 15, costruttore 36, archivio 4), `cargo fmt` e `clippy` puliti, build deterministica (stessi dati, stessi byte).

## Lavoro sulle lacune (dopo la chiusura di M2)

Prima e dopo, con lo stesso rapporto (`caa-eval` non esiste ancora: la copertura è la misura disponibile):

| Misura | Alla chiusura di M2 | Dopo |
| --- | --- | --- |
| Verbi ARASAAC con un lemma | 95,3% | **99,6%** |
| Aggettivi, numeri, avverbi | 96,3% | **98,8%** |
| Nomi comuni | 76,9% | 77,1% |
| Chiavi di una parola, totale | 80,0% (6.284 su 7.856) | **81,2%** (6.372 su 7.850) |
| Chiavi di una parola senza lemma | 1.539 | **1.449** |
| Multiparola con tutte le parole note | 82,0% (*) | **87,2%** (5.718 su 6.556) |
| Multiparola con una parola sconosciuta | 1.179 (*) | **838** |

(*) **Errore del rapporto di M2, corretto.** Il rapporto spezzava le parole sull'apostrofo e contava come sconosciuti `l`, `d`, `dell`, `all`, `sull`, `nell` (*l'orchestra*, *dell'asia*): 216 multiparola risultavano sbagliate. Ora le elisioni si riconoscono con la tabella dei prefissi elisi di `SPEC.md` (nel motore: `ELIDED_PREFIXES`), anche nelle chiavi senza spazi come `l'una`. Il test che riproduceva l'errore è stato scritto prima della correzione. Con la correzione e basta le multiparola note erano 85,3%.

Cosa è stato fatto:

1. **Riflessivi:** 29 infiniti riflessivi (*abbottonarsi*, *risciacquarsi*…) non sono in Morph-it!, ma si scompongono in verbo base + clitico come prevede la fase 4. Il rapporto ora li conta come trovati (colonna "di cui riflessivi") invece di segnalarli come lacune; non vanno aggiunti a mano.
2. **Verbi regolari mancanti** (24, per esempio *grigliare*, *messaggiare*, *intubare*): infinito, gerundio e participio passato nei quattro generi e numeri, perché il participio serve ai tempi composti (fase 5). Le altre forme coniugate restano all'indovino per suffisso (fase 3).
3. **Aggettivi e avverbio** (18 aggettivi e 1 avverbio): *bevibile*, *innevato*, *ipoacusico*, *sordocieco*, *trasgender*, *lilla*, *dopodomani*…
4. **Refusi di ARASAAC con la parola giusta senza pittogramma:** 9 voci in `lemma_picto.tsv` (*cnsigliare* → consigliare, *responsabilit* → responsabilità, *scorciatioia* → scorciatoia…) e 1 in `mwe_extra.tsv` (*pandizenzero* → pan di zenzero). I pittogrammi con refuso che duplicano una parola già coperta (per esempio *fidanzao*) non servono e non sono stati toccati.
5. **Parole frequenti dentro le multiparola** (18 nomi e un aggettivo: *dinosauro* 14 volte, *autismo* 12, *stomia* 11, *pipì* 10, *hockey*, *karate*, *velcro*, *spiedino*…): sbloccano molte multiparola insieme.

Le 264 righe di `forms_extra.tsv` hanno una nota con la regola usata. Un test controlla che i file curati del repository siano sempre leggibili e senza righe duplicate.

**Cosa non è stato fatto, e perché.** Restano circa 1.150 nomi comuni di una parola sconosciuti a Morph-it! (*mandorla*, *tofu*, *ecografo*, *fonduta*…), oltre a nomi propri, prestiti e sigle. Aggiungerli a mano richiederebbe di inventare genere e plurale di mille parole rare e di rifarlo a ogni aggiornamento di ARASAAC. Proposta, da approvare perché cambia la fase 3 della specifica: **una parola sconosciuta a Morph-it! ma presente come chiave ARASAAC diventa una lettura con la categoria della parola chiave ARASAAC** (tipo 2 = nome, tipo 3 = verbo…), con genere e numero dedotti dal suffisso e dai plurali che ARASAAC già fornisce (7.079 casi). Così ogni parola con un pittogramma ottiene un simbolo senza elenchi da mantenere; `forms_extra.tsv` resta per le eccezioni.

## Cosa dicono i numeri

1. **Copertura complessiva 81,2%** sulle parole chiave di una parola (senza cifre). Verbi 99,6%, aggettivi/numeri/avverbi 98,8%, nomi comuni 77,1%, nomi propri 44,2%. I nomi propri contano poco: le parole con la maiuscola passano dalla lettura `Propn` della fase 3.
2. **Lacune tipiche dei nomi:** femminili di mestiere (*criminologa*, *dietologa*, *stomatologa*, *plastificatrice*: 65 chiavi in -ologa, -trice, -essa), parole rare di cucina e scienza (*alioli*, *fonduta*, *tofu*, *sepalo*), prestiti e sigle (*judo*, *origami*, *tsunami*).
3. **Chiavi con punteggiatura:** 216 parole chiave finiscono con `?`, `!` o `.` (190 sono frasi di tipo 5: `dove?`, `piove!`). Sono chiavi distinte da `dove` e `piove`, e vanno bene così: sono pittogrammi di domanda ed esclamazione. In M4 si deciderà se cercare anche la forma senza punteggiatura.
4. **Forme con clitici:** `dammi` non ha un pittogramma proprio (0 voci), come previsto: si risolve con il lemma `dare`. `lavarsi` ha il suo pittogramma e in Morph-it! è `lavare` + `si`.
5. **"far colazione":** `far` è già in Morph-it! (`fare`, verbo e causativo), quindi per il test dorato 12 non serve nessuna riga in `forms_extra.tsv`: basta lemmatizzare la chiave multiparola "far colazione" come [fare, colazione] (M4–M6).

## Scelte di formato (approvate)

I file si leggono direttamente dalla memoria mappata, senza ricostruire strutture all'avvio: ogni ricerca passa da un automa `fst` che dà la posizione di un record a lunghezza fissa.

| File | Contenuto | Struttura |
| --- | --- | --- |
| `morphit/morph.fst` | forma normalizzata → letture | `fst::Map`, valore = (posizione << 16) \| numero letture |
| `morphit/lemmas.fst` | lemma normalizzato → id | `fst::Map` |
| `morphit/morph_feats.bin` | testo dei lemmi e letture | intestazione `CAAF` + schema, posizioni dei lemmi, testo, letture da 12 byte |
| `arasaac/picto_index.bin` | chiave normalizzata → pittogrammi | intestazione `CAAP` + schema, `fst` incorporato, record da 8 byte (id, tipo ARASAAC, flag, numero di chiavi) |
| `overrides/*.tsv` | correzioni curate | testo, copiato e validato |
| `manifest.json` | versioni e impronte delle fonti, conteggi, licenza di ogni file | JSON |

Flag di `picto_index.bin`: prima parola chiave; plurale derivato dal campo `plural` di ARASAAC (`api` per `ape`); multiparola; plurale invariabile (ARASAAC indica come plurale la parola stessa, 52 casi). Il fatto che un pittogramma sia "già plurale" (`occhiali`) non si legge dall'indice: si decide a runtime dalle letture di Morph-it! della chiave trovata (`occhiali` = NOUN-M:p).

Estensioni ai tipi rispetto a `SPEC.md`: categoria `Sym` (abbreviazioni, emoticon, simboli), sottotipo verbale causativo/aspettuale (CAU e ASP di Morph-it!), grado dell'aggettivo, clitico attaccato alla forma verbale (41 valori).

Decisioni sulla conversione delle etichette: `WH` (come, dove, comunque) → avverbio; `WH-CHE` (che) → congiunzione; `DET-NUM-CARD` e `PRO-NUM` → numerale; `PRO-PERS-CLI-*`, `CE`, `CI`, `NE`, `SI` → clitico; `TALE` → determinante; `VER:past+past+…` (una sola etichetta, *mossoci*) → participio passato.

Due righe di Morph-it! (413202 e 413203, `seppur seppure ADV` e `CON`) sono separate da spazi invece che da tabulazioni: il lettore le ripara e segnala ogni volta la riga.

## Rimandato (concordato)

- `mwe.trie`: richiede di lemmatizzare le chiavi multiparola con il motore → M4 o M6.
- `tagger.bin`: richiede il treebank (questione aperta) → M5.
- Indice delle chiavi senza accenti per i refusi: la funzione `fold_accents` esiste e ha i test, l'indice si costruisce quando serve (M4–M5).
- Regola di `CLAUDE.md` sul motore: `caa-eval` non ha ancora metriche (arriva in M7), quindi i commit di M2 non hanno un "prima e dopo". Il motore ha ricevuto solo tipi, normalizzazione e lettori, nessuna logica di decisione.

---

## Morph-it!

- righe lette: 505074
- righe riparate (separate da spazi invece che da tabulazioni): 2 (righe [413202, 413203])
- etichette distinte, tutte mappate: 664
- righe aggiunte da `forms_extra.tsv`: 264
- forme distinte: 404930
- lemmi distinti: 34693
- letture (forma, lemma, tratti) distinte: 505040

## ARASAAC

- pittogrammi: 13924
- pittogrammi senza parola chiave italiana: 124
- chiavi distinte nell'indice (con i plurali derivati): 19122
- voci dell'indice (chiave, pittogramma): 29320
- immagini WebP collegate: 13924
- pittogrammi con parole chiave ma senza immagine: 0

## Copertura: parole chiave ARASAAC con un lemma in Morph-it!

Parole chiave di una sola parola, distinte, senza cifre (336 chiavi con cifre escluse). "Trovata" = compare come forma o come lemma, oppure è un infinito riflessivo scomponibile in verbo base + clitico (`lavarsi`).

| Tipo | Significato | Chiavi | Trovate | % | Con infinito verbale | di cui riflessivi | Con lettura di nome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | senza tipo | 194 | 136 | 70.1% | 16 | 1 | 90 |
| 1 | nomi propri e luoghi | 371 | 164 | 44.2% | 0 | 0 | 142 |
| 2 | nomi comuni | 4965 | 3830 | 77.1% | 18 | 0 | 3673 |
| 3 | verbi | 1137 | 1133 | 99.6% | 1123 | 28 | 21 |
| 4 | aggettivi, numeri, avverbi | 954 | 943 | 98.8% | 1 | 0 | 319 |
| 5 | frasi ed esclamazioni | 50 | 29 | 58.0% | 1 | 0 | 15 |
| 6 | orari, mesi, altro | 179 | 137 | 76.5% | 0 | 0 | 50 |
| | **totale** | 7850 | 6372 | 81.2% | | | |

Chiavi senza lemma: **1449** (elenco completo in `report/keys_without_lemma.tsv`). Esempi:

abaco · alioli · appendiabito · autenticazione · baryonyx · boscaiola · campanula · cassapanca · chia · clown · criceto · dietologa · edera · evidenziatore · forana · gamberone · giullare · guiana · induismo · kata · liquirizia · maraca · mezuzah · multipresa · nécessaire · origami · pandizenzero · perché? · plastificatrice · portatovaglioli · quad · rocchetto · scandinavia · shabbat · spazzolone · switch · teide · torà · tutankamon · w-fi

## Multiparola

- chiavi multiparola distinte (senza cifre): 6556
- con tutte le parole note a Morph-it!: 5718 (87.2%)
- con almeno una parola sconosciuta: 838 (elenco in `report/multiword_unknown_words.tsv`)

## File prodotti

- `morphit/morph.fst`: 739739 byte
- `morphit/morph_feats.bin`: 6517534 byte
- `morphit/lemmas.fst`: 222029 byte
- `arasaac/picto_index.bin`: 464416 byte
