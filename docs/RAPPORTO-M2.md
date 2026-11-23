# Rapporto M2 — build del lessico

Data: 2026-11-23. Il corpo (da "Rapporto di build" in poi) è generato da `caa-lexicon-build` sui dati di M1;
le conclusioni qui sotto sono scritte a mano. Le liste complete delle chiavi senza lemma restano in
`data/build/report/` (fuori da git: sono estratti dei dati ARASAAC) e si rigenerano con il comando in `CLAUDE.md`.

## Criteri di accettazione

| Criterio | Esito |
| --- | --- |
| Caricamento del lessico < 300 ms | **0,3–0,6 ms** (apertura dei 4 file mappati in memoria con il controllo di integrità degli automi + due ricerche, 5 prove, cache del disco già calda). Il lessico occupa 7,9 MB; con cache fredda il tempo dipende dalla lettura del disco ma è limitato dalla dimensione dei file. |
| Tutte le etichette mappate | **664 su 664**: la build sui dati veri si ferma con errore se trova un'etichetta non mappata, e un test legge le 664 etichette di `docs/M1-etichette-morphit.tsv`. |
| Rapporto delle chiavi ARASAAC senza lemma | **1.539 chiavi** di una parola senza forma né lemma alla chiusura di M2; dopo il lavoro sulle lacune e la revisione (sezioni sotto) **1.450**, e 838 multiparola con almeno una parola sconosciuta. |

Verifiche: 67 test verdi (motore 18, costruttore 44, archivio 5), `cargo fmt` e `clippy` puliti, build deterministica (stessi dati, stessi byte).

## Lavoro sulle lacune (dopo la chiusura di M2)

Prima e dopo, con lo stesso rapporto (`caa-eval` non esiste ancora: la copertura è la misura disponibile):

| Misura | Alla chiusura di M2 | Dopo |
| --- | --- | --- |
| Verbi ARASAAC con un lemma | 95,3% | **99,6%** |
| Aggettivi, numeri, avverbi | 96,3% | **98,7%** |
| Nomi comuni | 76,9% | 77,1% |
| Chiavi di una parola, chiavi distinte (**) | circa 79,8% (7.601 − 1.539 = 6.062) | **80,9%** (6.151 su 7.601) |
| Chiavi di una parola senza lemma | 1.539 | **1.450** |
| Multiparola con tutte le parole note | 82,0% (*) | **87,2%** (5.718 su 6.556) |
| Multiparola con una parola sconosciuta | 1.179 (*) | **838** |

(**) Il totale del rapporto di M2 contava due volte le chiavi che hanno due tipi (per esempio `giallo`, tipo 4 e 2): vedi la revisione sotto. Il "prima" è una stima, perché allora le elisioni erano trattate in modo diverso.

(*) **Errore del rapporto di M2, corretto.** Il rapporto spezzava le parole sull'apostrofo e contava come sconosciuti `l`, `d`, `dell`, `all`, `sull`, `nell` (*l'orchestra*, *dell'asia*): 216 multiparola risultavano sbagliate. Ora le elisioni si riconoscono con la tabella dei prefissi elisi di `SPEC.md` (nel motore: `ELIDED_PREFIXES`), anche nelle chiavi senza spazi come `l'una`. Il test che riproduceva l'errore è stato scritto prima della correzione. Con la correzione e basta le multiparola note erano 85,3%.

Cosa è stato fatto:

1. **Riflessivi:** 29 infiniti riflessivi (*abbottonarsi*, *risciacquarsi*…) non sono in Morph-it!, ma si scompongono in verbo base + clitico come prevede la fase 4. Il rapporto ora li conta come trovati (colonna "di cui riflessivi") invece di segnalarli come lacune; non vanno aggiunti a mano.
2. **Verbi regolari mancanti** (24, per esempio *grigliare*, *messaggiare*, *intubare*): infinito, gerundio e participio passato nei quattro generi e numeri, perché il participio serve ai tempi composti (fase 5). Le altre forme coniugate restano all'indovino per suffisso (fase 3).
3. **Aggettivi e avverbio** (18 aggettivi e 1 avverbio): *bevibile*, *innevato*, *ipoacusico*, *sordocieco*, *trasgender*, *lilla*, *dopodomani*…
4. **Refusi di ARASAAC con la parola giusta senza pittogramma:** 9 voci in `lemma_picto.tsv` (*cnsigliare* → consigliare, *responsabilit* → responsabilità, *scorciatioia* → scorciatoia…) e 1 in `mwe_extra.tsv` (*pandizenzero* → pan di zenzero). I pittogrammi con refuso che duplicano una parola già coperta (per esempio *fidanzao*) non servono e non sono stati toccati.
5. **Parole frequenti dentro le multiparola** (18 nomi e un aggettivo: *dinosauro* 14 volte, *autismo* 12, *stomia* 11, *pipì* 10, *hockey*, *karate*, *velcro*, *spiedino*…): sbloccano molte multiparola insieme.

Le 272 righe di `forms_extra.tsv` hanno una nota con la regola usata. Un test controlla che i file curati del repository siano sempre leggibili e senza righe duplicate.

**Cosa non è stato fatto, e perché.** Restano circa 1.150 nomi comuni di una parola sconosciuti a Morph-it! (*mandorla*, *tofu*, *ecografo*, *fonduta*…), oltre a nomi propri, prestiti e sigle. Aggiungerli a mano richiederebbe di inventare genere e plurale di mille parole rare e di rifarlo a ogni aggiornamento di ARASAAC. Proposta, da approvare perché cambia la fase 3 della specifica: **una parola sconosciuta a Morph-it! ma presente come chiave ARASAAC diventa una lettura con la categoria della parola chiave ARASAAC** (tipo 2 = nome, tipo 3 = verbo…), con genere e numero dedotti dal suffisso e dai plurali che ARASAAC già fornisce (7.079 casi). Così ogni parola con un pittogramma ottiene un simbolo senza elenchi da mantenere; `forms_extra.tsv` resta per le eccezioni.

## Cosa dicono i numeri

1. **Copertura complessiva 80,9%** sulle chiavi distinte di una parola (senza cifre). Verbi 99,6%, aggettivi/numeri/avverbi 98,7%, nomi comuni 77,1%, nomi propri 44,2%. I nomi propri contano poco: le parole con la maiuscola passano dalla lettura `Propn` della fase 3.
2. **Lacune tipiche dei nomi:** femminili di mestiere (*criminologa*, *dietologa*, *stomatologa*, *plastificatrice*: 65 chiavi in -ologa, -trice, -essa), parole rare di cucina e scienza (*alioli*, *fonduta*, *tofu*, *sepalo*), prestiti e sigle (*judo*, *origami*, *tsunami*).
3. **Chiavi con punteggiatura:** 216 parole chiave finiscono con `?`, `!` o `.` (190 sono frasi di tipo 5: `dove?`, `piove!`). Sono chiavi distinte da `dove` e `piove`, e vanno bene così: sono pittogrammi di domanda ed esclamazione. In M4 si deciderà se cercare anche la forma senza punteggiatura.
4. **Forme con clitici:** `dammi` non ha un pittogramma proprio (0 voci), come previsto: si risolve con il lemma `dare`. `lavarsi` ha il suo pittogramma e in Morph-it! è `lavare` + `si`.
5. **"far colazione":** `far` è già in Morph-it! (`fare`, verbo e causativo), quindi per il test dorato 12 non serve nessuna riga in `forms_extra.tsv`: basta lemmatizzare la chiave multiparola "far colazione" come [fare, colazione] (M4–M6).

## Revisione indipendente (Opus) e correzioni

Dopo la chiusura di M2 un revisore indipendente ha riletto M0–M2 in sola lettura. Ha confermato che i test passano, che la build è riproducibile byte per byte, che nessun dato ARASAAC o Morph-it! è in git (né nella storia) e che il motore resta puro. Ha trovato tre bug certi, tutti corretti con il test scritto prima:

1. **Un automa `fst` corrotto mandava in panic la ricerca.** `fst::Map::new` non controlla l'integrità: alterando 4 byte a caso in 40.000 file, quasi tutti si aprivano senza errore e 27 mandavano poi in panic la ricerca di una parola. Ora l'apertura verifica la somma di controllo (costo 0,3–0,5 ms in totale). Corretta anche l'aritmetica dei lettori, ora con controllo di overflow (importante per WebAssembly a 32 bit).
2. **I plurali delle frasi diventavano chiavi di una parola.** ARASAAC indica per le frasi solo il plurale della testa ("mettere un cartello" → "cartelli"): 18 voci nei dati ("cartelli", "lettori", "banchi"…) facevano vincere il pittogramma sbagliato. Ora il plurale vale solo se ha le stesse parole della chiave.
3. **Terzo errore nel rapporto di copertura:** il totale contava due volte le chiavi con due tipi (trovate + senza lemma non faceva il totale). Ora il totale conta le chiavi distinte: 6.151 su 7.601 (80,9%).

Altre correzioni: i file del lessico si scrivono in modo atomico (file temporaneo e rinomina), il commento sul `mmap` è stato corretto (un file troncato mentre è mappato dà SIGBUS su Linux e macOS), `tar` su Windows usa percorsi relativi e la cartella di estrazione si svuota, la CI verifica che `caa-engine` compili per WebAssembly (verificato anche qui), `.gitattributes` fissa i fine riga a LF. Forme italiane: `trasgender` è un refuso di ARASAAC per *transgender* (ora `transgender` più una voce in `lemma_picto.tsv`), *cheesecake* ha anche il femminile, *lilla* e *malva* anche come nomi.

**Decisioni prese dopo la revisione** (formato schema 2, applicate e provate):

1. **Ordine delle letture:** per categoria e poi per lemma, solo per essere deterministico (prima era l'ordine casuale degli id dei lemmi). La scelta della lettura resta alla fase 7.
2. **Tipi ARASAAC:** una chiave con più tipi li conserva tutti (insieme di bit); `giallo` ha ora i tipi 4 e 2.
3. **Singolare e parentesi:** le voci dei plurali derivati ricordano la parola chiave singolare (`api` → `ape`), che la fase 3 usa come lemma; le chiavi con precisazione tra parentesi si registrano senza la parte tra parentesi (flag `DISAMBIGUATED`).
4. **Etichette `WH` e `WH-CHE`:** rimandate a M5 (serve il treebank); annotate nelle questioni aperte di `SPEC.md`.
5. **`normalize_key`:** uniforma anche ‘ ´ ` , toglie trattino morbido, spazio di larghezza zero, word joiner e BOM, e tratta "İ" come "i". Con il test scritto prima.
6. **File di build diverse:** le intestazioni dei `.bin` portano un identificativo di build (hash dei dati di partenza), che sta anche nei due automi morfologici come chiave sentinella; `caa-store` verifica che morfologia e pittogrammi vengano dalla stessa build. Costo: il file dei pittogrammi passa da 464 a 644 KB (record da 12 byte invece di 8 e testi dei singolari).

## Scelte di formato (approvate)

I file si leggono direttamente dalla memoria mappata, senza ricostruire strutture all'avvio: ogni ricerca passa da un automa `fst` che dà la posizione di un record a lunghezza fissa.

| File | Contenuto | Struttura |
| --- | --- | --- |
| `morphit/morph.fst` | forma normalizzata → letture | `fst::Map`, valore = (posizione << 16) \| numero letture |
| `morphit/lemmas.fst` | lemma normalizzato → id | `fst::Map` |
| `morphit/morph_feats.bin` | testo dei lemmi e letture | intestazione `CAAF` (28 byte), posizioni dei lemmi, testo, letture da 12 byte |
| `arasaac/picto_index.bin` | chiave normalizzata → pittogrammi | intestazione `CAAP` (28 byte), `fst` incorporato, record da 12 byte (id, insieme dei tipi ARASAAC, flag, numero di chiavi, singolare), testi dei singolari |
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
- righe aggiunte da `forms_extra.tsv`: 272
- forme distinte: 404930
- lemmi distinti: 34692
- letture (forma, lemma, tratti) distinte: 505047

## ARASAAC

- pittogrammi: 13924
- pittogrammi senza parola chiave italiana: 124
- chiavi distinte nell'indice (con i plurali derivati): 19102
- voci dell'indice (chiave, pittogramma): 29296
- immagini WebP collegate: 13924
- pittogrammi con parole chiave ma senza immagine: 0

## Copertura: parole chiave ARASAAC con un lemma in Morph-it!

Parole chiave di una sola parola, senza cifre (335 chiavi con cifre, di una o più parole, sono escluse). "Trovata" = compare come forma o come lemma, oppure è un infinito riflessivo scomponibile in verbo base + clitico (`lavarsi`). Una chiave con due tipi compare in entrambe le righe; il totale conta le chiavi distinte.

| Tipo | Significato | Chiavi | Trovate | % | Con infinito verbale | di cui riflessivi | Con lettura di nome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | senza tipo | 194 | 136 | 70.1% | 16 | 1 | 90 |
| 1 | nomi propri e luoghi | 371 | 164 | 44.2% | 0 | 0 | 142 |
| 2 | nomi comuni | 4966 | 3831 | 77.1% | 18 | 0 | 3676 |
| 3 | verbi | 1137 | 1133 | 99.6% | 1123 | 28 | 21 |
| 4 | aggettivi, numeri, avverbi | 954 | 942 | 98.7% | 1 | 0 | 321 |
| 5 | frasi ed esclamazioni | 50 | 29 | 58.0% | 1 | 0 | 15 |
| 6 | orari, mesi, altro | 178 | 136 | 76.4% | 0 | 0 | 50 |
| | **totale** | 7601 | 6151 | 80.9% | | | |

Chiavi senza lemma: **1450** (elenco completo in `report/keys_without_lemma.tsv`). Esempi:

abaco · alioli · appendiabito · autenticazione · baryonyx · boscaiola · campanula · cassapanca · chia · clown · criceto · dietologa · edera · evidenziatore · forana · gamberone · giullare · guiana · induismo · kata · liquirizia · maraca · mezuzah · multipresa · nécessaire · origami · pandizenzero · perché? · plastificatrice · portatovaglioli · quad · rocchetto · scandinavia · shabbat · spazzolone · switch · teide · torà · turkmenistan · w

## Multiparola

- chiavi multiparola distinte (senza cifre): 6546
- con tutte le parole note a Morph-it!: 5709 (87.2%)
- con almeno una parola sconosciuta: 837 (elenco in `report/multiword_unknown_words.tsv`)

## File prodotti

- `morphit/morph.fst`: 746849 byte
- `morphit/morph_feats.bin`: 6517626 byte
- `morphit/lemmas.fst`: 222244 byte
- `arasaac/picto_index.bin`: 644085 byte
