# Rapporto M6 — strutture verbali e multiparola (fasi 4, 5, 6 e 9)

Data: 2026-11-23. Misure con `caa-eval` su `data/build` (schema 2) e sul treebank ISDT. I test sul mini-lessico girano anche in CI; quelli sui dati veri si eseguono in locale e si saltano da soli se `data/build` manca.

## Criteri di accettazione

| Criterio (SPEC.md) | Esito |
| --- | --- |
| Tutti i 20 test dorati verdi | **20 su 20** in `lexicon/golden/strutture.tsv` (parola per parola: nascosta o visibile, lemma, segni, pittogramma dell'espressione). Vedi sotto i cinque casi riscritti dopo aver controllato l'indice |
| I test dorati di M4 e M5 restano verdi | tokenizzazione **48 su 48**, analisi **48 su 48** |
| Copertura delle parole di base | invariata: **96,7%**, le stesse 17 eccezioni |
| Velocità (meno di 5 ms per un paragrafo di 100 parole) | **0,76 ms** (mediana, paragrafo di 74 parole, build di rilascio) |

Verifiche: 174 test verdi (mini-lessico e dati veri), `fmt` e `clippy -D warnings` puliti, `caa-engine` compila ancora per WebAssembly.

## Cosa c'è di nuovo

- **Clitici attaccati al verbo (fase 4).** `portamelo`, `dillo`, `prendilo`, `fallo`, `stacci`… Il motore stacca da destra uno o due clitici, ricostruisce l'ospite (infinito con `-e` o `-re` ripristinati, gerundio, participio, imperativo di seconda persona o prima plurale, imperativi tronchi `da' fa' di' sta' va'` con raddoppio) e accetta solo se l'ospite è un verbo del lessico. Il cluster sta in `Feats.enclitic` (già esistente per le forme di Morph-it!). Un imperativo ricostruito vale solo per forme sconosciute a Morph-it!: senza questa regola "giovane" diventava giova + ne (errore trovato dalla misura sul lessico di base, riprodotto con un test prima della correzione). Le parole funzionali non si scompongono ("dalla" non è dare + la).
- **Tempi e gruppi verbali (fase 5).** Avere/essere + participio con avverbi in mezzo ("era già uscito"), passivo con "stato", stare + gerundio, riflessivo della stessa persona. L'ausiliare è `Hidden`, la testa porta il pittogramma e il segno. "Ho fame" e "è stanco" restano verbi pieni. Tempi semplici: imperfetto e passato remoto → PASSATO, futuro → FUTURO, anche per "era".
- **Verbi pronominali.** "mi lavo", "mi sono lavato", "lavarsi", "lavandosi" prendono il pittogramma di "lavarsi" se ARASAAC lo ha; il clitico è nascosto. Senza pittogramma resta tutto com'è.
- **Segno PLURALE (fase 9).** Per i nomi plurali il cui pittogramma è del singolare: trovato con il singolare o il lemma, oppure con un plurale che ARASAAC ha derivato dal singolare ("maestre" per "maestra", "ferri da stiro"). Non per forme che sono parola chiave a sé ("occhiali", "mani", "pastelli").
- **Multiparola (fase 6).** `arasaac/mwe.bin` (0,5 MB, licenza ARASAAC): 8.011 delle 8.120 parole chiave ARASAAC con spazio (109 scartate: cifre o punteggiatura in mezzo), riportate ai lemmi con `Engine::lemma_set`, **lo stesso codice a build e a runtime**: 12.092 sequenze, 18.448 record. A runtime vince la corrispondenza più lunga sulle unità (parole e gruppi verbali, ausiliari esclusi). Esempi veri: "ho fatto colazione" → "far colazione" + PASSATO, "mi sono lavato i denti" → "lavarsi i denti" + PASSATO, "i ferri da stiro" → "ferro da stiro" + PLURALE, "Lavo le mani" → "lavarsi le mani", "va a scuola" → "andare a scuola". La testa è la prima unità, gli altri membri sono `Hidden`.
- **Preposizioni articolate.** Il lemma è la preposizione ("nella" → "in", "dalla" → "da"): la specifica lo vuole (fase 10) e "nella" prima non aveva nessun pittogramma. Effetto collaterale utile: il lemma giusto sul treebank sale dall'82,4% all'**89,0%**.
- **Contratto esteso**: `GroupRef` ha anche `kind` (composto, progressivo, pronominale, multiparola) e `role` (testa o membro); nuovi `PictoReason::Pronominal` e `Multiword`. Il motore decide e segna; la politica di cosa mostrare (completo, essenziale) e il disegno dei segni sono di M8.

## Misure sul treebank (invariate dove deve)

| ISDT | M5 | M6 |
| --- | --- | --- |
| Categoria giusta, sviluppo | 94,8% | **94,8%** |
| Categoria giusta, prova | 94,9% | **95,0%** |
| Lemma giusto, sviluppo | 82,4% | **89,0%** |
| Parole ambigue giuste, sviluppo | 91,9% | **91,9%** |

## Decisioni e divergenze dalla specifica (da segnalare)

1. **Cinque dorati riscritti dopo aver controllato l'indice**, come la specifica prescrive per le multiparola. ARASAAC ha i pittogrammi "aprire la porta" (casi 1), "portare a scuola" (2), "avere fame" (16), "salire le scale" (17), "mettere il sale" (18). Con la regola della corrispondenza più lunga assorbono le parole: nel caso 16 "ho" mostra "avere fame" e "fame" è nascosta, invece di "avere" e "fame" separati come nella tabella. L'analisi di ogni parola resta quella della tabella (`analisi.tsv`, 48 su 48); cambia solo cosa si vede. Se la scuola preferisse i simboli separati, basta bloccare la chiave in `lexicon/overrides/blocklist.tsv`.
2. **"C'era una volta"**: ARASAAC ha un pittogramma intero (8277). La specifica vuole "c' = ci, era = essere + PASSATO", quindi 8277 è in `blocklist.tsv` e il caso 9 passa come scritto. "una volta" invece forma un'espressione (27385).
3. **Bonus dei gruppi**: la specifica dà +1,0 al gruppo completato. Per i verbali il peso è **0,1**: da 0,25 il treebank perde parole (forza il verbo contro l'aggettivo); 0,1 non cambia la misura e basta a scegliere il participio tra le letture dello stesso verbo. Per le multiparola il bonus non c'è come termine del punteggio ma come regola: un'unità sicura (confidenza ≥ 0,6) conta solo con il lemma scelto dal contesto, una incerta con tutti i lemmi possibili. È la versione semplice di "se il contesto la rende improbabile, perde".
4. **"Essere" + participio**: la specifica decide con "participio anche aggettivo + complemento di luogo o di tempo, altrimenti il prior". Non copre "le maestre sono arrivate" (arrivato è anche aggettivo, senza complemento). Aggiunto un elenco chiuso di 34 verbi che vogliono "essere" (movimento e cambiamento di stato: andare, venire, arrivare, partire, uscire…): con questi è sempre tempo composto. Per gli altri participi, "la porta è chiusa" resta "essere" + aggettivo.
5. **Il lemma del verbo pronominale** nel testo resta quello di Morph-it! ("lavare"); la forma "lavarsi" compare nel pittogramma e nelle chiavi delle espressioni.

## Limiti noti

- Le multiparola prendono la sequenza più lunga anche quando il docente avrebbe preferito simboli separati; per ora si corregge con la blocklist, in M8 con il menu delle alternative.
- Il segno PLURALE per le espressioni dipende dal fatto che la chiave ARASAAC sia al singolare o plurale derivato: una chiave plurale scritta a mano da ARASAAC ("lavarsi i denti") si considera già plurale.
- "Hanno fatto già colazione" non forma l'espressione: l'avverbio la interrompe (la specifica salta solo gli ausiliari).
- La velocità è raddoppiata (0,34 → 0,76 ms) per la ricerca delle espressioni; resta 6 volte sotto l'obiettivo.
- Il file `mwe.bin` dipende dal codice di lemmatizzazione: se `lemma_set` o la scomposizione dei clitici cambiano, va ricostruito il lessico (la build lo fa sempre).

## Comandi nuovi

```bash
cargo run --release -q -p caa-eval -- strutture      # i 20 test dorati di struttura
cargo run --release -p caa-lexicon-build             # ora costruisce anche data/build/arasaac/mwe.bin
```
