# Rapporto M2 — build del lessico

Data: 2026-11-23. Il corpo (da "Rapporto di build" in poi) è generato da `caa-lexicon-build` sui dati di M1;
le conclusioni qui sotto sono scritte a mano. Le liste complete delle chiavi senza lemma restano in
`data/build/report/` (fuori da git: sono estratti dei dati ARASAAC) e si rigenerano con il comando in `CLAUDE.md`.

## Criteri di accettazione

| Criterio | Esito |
| --- | --- |
| Caricamento del lessico < 300 ms | **0,02–0,06 ms** (apertura dei 4 file mappati in memoria + due ricerche, 5 prove, cache del disco già calda). Il lessico occupa 7,9 MB; con cache fredda il tempo dipende dalla lettura del disco ma è limitato dalla dimensione dei file. |
| Tutte le etichette mappate | **664 su 664**: la build sui dati veri si ferma con errore se trova un'etichetta non mappata, e un test legge le 664 etichette di `docs/M1-etichette-morphit.tsv`. |
| Rapporto delle chiavi ARASAAC senza lemma | **1.539 chiavi** di una parola senza forma né lemma, 1.179 multiparola con almeno una parola sconosciuta (dettagli sotto). |

Verifiche: 49 test verdi (motore 14, costruttore 31, archivio 4), `cargo fmt` e `clippy` puliti, build deterministica (stessi dati, stessi byte).

## Cosa dicono i numeri

1. **Copertura complessiva 80,0%** sulle parole chiave di una parola (senza cifre). Verbi 95,3%, aggettivi/numeri/avverbi 96,3%, nomi comuni 76,9%, nomi propri 44,1%. I nomi propri contano poco: le parole con la maiuscola passano dalla lettura `Propn` della fase 3.
2. **Il 94% dei verbi ARASAAC** (1.073 su 1.137) ha un infinito noto a Morph-it!.
3. **Lacune tipiche:** femminili di mestiere (criminologa, dietologa, stomatologa, plastificatrice: 65 chiavi in -ologa, -trice, -essa), parole rare di cucina e scienza (alioli, fonduta, tofu, sepalo), prestiti e sigle (judo, origami, tsunami). Sono il lavoro per `forms_extra.tsv`; una regola di derivazione dei femminili ne coprirebbe una parte (idea per dopo, non in v1).
4. **Errori nei dati ARASAAC:** per esempio la chiave `cnsigliare` (refuso). Si correggono con `forms_extra.tsv` o `blocklist.tsv` quando disturbano.
5. **Chiavi con punteggiatura:** 216 parole chiave finiscono con `?`, `!` o `.` (190 sono frasi di tipo 5: `dove?`, `piove!`). Sono chiavi distinte da `dove` e `piove`, e vanno bene così: sono pittogrammi di domanda ed esclamazione. In M4 si deciderà se cercare anche la forma senza punteggiatura.
6. **Forme con clitici:** `dammi` non ha un pittogramma proprio (0 voci), come previsto: si risolve con il lemma `dare`. `lavarsi` ha il suo pittogramma e in Morph-it! è `lavare` + `si`.
7. **"far colazione":** `far` è già in Morph-it! (`fare`, verbo e causativo), quindi per il test dorato 12 non serve nessuna riga in `forms_extra.tsv`: basta lemmatizzare la chiave multiparola "far colazione" come [fare, colazione] (M4–M6).

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
- righe aggiunte da `forms_extra.tsv`: 0
- forme distinte: 404711
- lemmi distinti: 34626
- letture (forma, lemma, tratti) distinte: 504776

## ARASAAC

- pittogrammi: 13924
- pittogrammi senza parola chiave italiana: 124
- chiavi distinte nell'indice (con i plurali derivati): 19122
- voci dell'indice (chiave, pittogramma): 29320
- immagini WebP collegate: 13924
- pittogrammi con parole chiave ma senza immagine: 0

## Copertura: parole chiave ARASAAC con un lemma in Morph-it!

Parole chiave di una sola parola, distinte, senza cifre (336 chiavi con cifre escluse). "Trovata" = compare come forma o come lemma.

| Tipo | Significato | Chiavi | Trovate | % | Con infinito verbale | Con lettura di nome |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | senza tipo | 194 | 134 | 69.1% | 15 | 89 |
| 1 | nomi propri e luoghi | 372 | 164 | 44.1% | 0 | 142 |
| 2 | nomi comuni | 4967 | 3818 | 76.9% | 18 | 3663 |
| 3 | verbi | 1137 | 1083 | 95.3% | 1073 | 21 |
| 4 | aggettivi, numeri, avverbi | 954 | 919 | 96.3% | 1 | 319 |
| 5 | frasi ed esclamazioni | 52 | 29 | 55.8% | 1 | 15 |
| 6 | orari, mesi, altro | 180 | 137 | 76.1% | 0 | 50 |
| | **totale** | 7856 | 6284 | 80.0% | | |

Chiavi senza lemma: **1539** (elenco completo in `report/keys_without_lemma.tsv`). Esempi:

abaco · alioli · appendiabito · autenticazione · barelliera · borragine · cambia-monete · casseruola · chiama-angeli · cnsigliare · criminologa · dietologa · ecografo · etilometro · fonduta · gambia · glutine · guiro · innaffiatoio · judo · licantropo · mandorle · messaggiare · motozappa · nutria · origami · pandemia · perché? · plastificatrice · portavivande · quando? · risciacquarsi · scalatrice · sepalo · sordocieco · stomatologa · tarallo · tofu · tsunami · vasectomia

## Multiparola

- chiavi multiparola distinte (senza cifre): 6551
- con tutte le parole note a Morph-it!: 5372 (82.0%)
- con almeno una parola sconosciuta: 1179 (elenco in `report/multiword_unknown_words.tsv`)

## File prodotti

- `morphit/morph.fst`: 740278 byte
- `morphit/morph_feats.bin`: 6513465 byte
- `morphit/lemmas.fst`: 221586 byte
- `arasaac/picto_index.bin`: 464416 byte
