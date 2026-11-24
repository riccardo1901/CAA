# Rapporto M7 — valutazione sul corpus (rivisto dopo la revisione indipendente)

Data: 2026-11-24. Misure con `caa-eval corpus` su `data/build` (schema 2). Questa versione sostituisce quella del 23 novembre: quattro revisori indipendenti (Opus) hanno trovato difetti nella misura e nel metodo, corretti qui sotto. **I numeri della versione precedente non vanno più citati.**

## Criteri di accettazione

| Criterio (SPEC.md) | Esito |
| --- | --- |
| Rapporto completo con metriche | sì: sei metriche, per sviluppo e prova |
| Errori raggruppati per causa | sì: dieci cause, in ordine di frequenza, con esempi (`caa-eval corpus`) |
| Prima taratura dei pesi | fatta: nessun peso migliora in modo apprezzabile; restano quelli della specifica |
| Primi 10 testi annotati | **26 testi annotati**: 20 di sviluppo, 6 di prova (7 storie, 6 favole… vedi sotto) |
| "Esporta come caso di test" nell'editor | rimandato a M8; in M7 ci sono `prepara` e `prepara-candidati` |

## Il corpus e il metodo (cosa è cambiato dopo la revisione)

- **26 testi sintetici** scritti per il progetto, 2.588 parole: storie, favole, storie sociali. Annotazione parola per parola da annotatori indipendenti (modelli, non docenti).
- **La prova della prima serie era consumata.** L'avevo guardata mentre correggevo il motore, contro la mia stessa regola. Quei 6 testi sono passati a **sviluppo** (ora 20 testi, 1.945 parole). La **prova è nuova**: 6 testi (21–26, 643 parole) scritti dopo la revisione, annotati **senza proporre la scelta del motore** (la bozza elencava i candidati dell'indice: `prepara-candidati`) e misurati **una sola volta**, a motore fermo.
- **La metrica ora conta l'uscita**, come dice SPEC.md ("risultato non tra quelli accettati"): una parola richiede una correzione solo se il pittogramma *mostrato* (non quello nascosto da una politica), i segni o la visibilità non sono tra quelli accettati. Una lettura sbagliata con l'uscita giusta si vede nelle metriche di categoria e lemma, non nelle correzioni. Una frase i cui token non coincidono con l'annotazione conta come errore per ogni sua parola (prima abbassava il numero).
- **Armonizzazione per regola**, non per parola: per le parole grammaticali l'insieme dei pittogrammi accettati è l'unione fra annotatori; la lettera E/A/I non è accettata per "e", "a", "i"; "che" nella politica Completo è solo testo (SPEC.md, fase 10); "po'" è sempre avverbio "poco". Gli annotatori ancoravano sulla bozza (in 80 righe accettavano *solo* la lettera dell'alfabeto): per questo la bozza dei testi di prova non propone più la scelta del motore.

## Risultato: correzioni per 100 parole

Stessa metrica e stessa annotazione per entrambi i motori.

| | Sviluppo (20 testi, 1.945 parole) | **Prova nuova (6 testi, 643 parole)** |
| --- | --- | --- |
| Motore di fine M6 | 21,9 | 26,6 |
| Motore dopo M7 | 6,9 | **13,4** |

- **Il numero da citare è 13,4 sulla prova nuova** (26,6 prima). Quello dello sviluppo (6,9) è gonfiato: i file curati derivano da quei testi.
- **Come si scompone il miglioramento sulla prova** (171 → 86 parole da correggere):
  - 55 parole vengono da due convenzioni grammaticali: la lettera dell'alfabeto per "e", "a", "i" (49, la bozza e il motore di M6 le davano e nessun docente le vorrebbe) e "che" solo testo (6, effetto della politica Completo di M8a). **Al netto di queste, la prova passa da 18,0 a 13,4.**
  - Il resto (30 parole) viene dal codice di M7 (riflessivo sempre nascosto, "esserci", espressioni senza frasi-domanda, infiniti composti, prior curati).
  - **Le righe curate una per una non generalizzano**: la revisione ha provato a toglierle una alla volta sulla prova (la prima serie) e il saldo era nullo (alcune aiutano una parola, altre ne peggiorano una). Ho tolto quelle che peggioravano o non servivano (il prior "passo", "libero" in blocklist, le preferenze di "chiamare", "lo", "presto", "sentire", "spingere").
- **Intervallo**: per testo la prova va da circa 9 a 19 correzioni per 100 parole (deviazione standard intorno a 3,5). Con 643 parole e 6 testi, **differenze sotto i 2 punti sono rumore**.

## Le altre metriche

| | Sviluppo | Prova nuova |
| --- | --- | --- |
| Pittogramma giusto sulle parole piene | 91,4% (era 81,2%) | **83,4%** (era 79,6%) |
| Categoria giusta | 96,7% | 96,1% |
| Lemma giusto (parole con significato) | 98,5% | 97,6% |
| Segni (plurale, passato, futuro) | 96,3% | 94,3% (83 su 88) |
| Copertura (parole piene con un pittogramma) | 97,4% (era 93,2%) | 97,2% (era 94,5%) |
| Errori sottolineati / parole giuste sottolineate | 12,7% / 3,3% | 17,4% / 2,7% |

L'analisi grammaticale è buona anche su testi mai visti. **Il problema è il senso del pittogramma**: 83% sulle parole piene.

## Errori per causa (prova nuova, 86 parole)

| Causa | Parole |
| --- | --- |
| Senso sbagliato (pittogramma di un altro significato) | 31 |
| Simbolo non voluto (l'annotatore non voleva nessun simbolo) | 16 |
| Lettura sbagliata (categoria o lemma) con uscita sbagliata | 10 |
| Multiparola sbagliata | 10 |
| Lacuna di pittogramma | 8 |
| Multiparola mancata | 5 |
| Struttura verbale | 4 |
| Forma sconosciuta | 2 |

## Cosa è cambiato nel motore e nei file curati

Codice (generale):
- Le parole chiave ARASAAC con `?` o `!` (frasi e saluti) non entrano nell'indice delle espressioni.
- Il riflessivo della stessa persona si nasconde sempre; "ci" e "vi" solo se esiste il verbo pronominale in ARASAAC ("ci andiamo" resta con "ci" visibile). La concordanza guarda tutte le letture finite dello stesso verbo ("sono" è 1ª singolare e 3ª plurale).
- "ci" + essere alla 3ª persona = "esserci" ("c'è", "ci sono", "c'è stato"), non davanti a un aggettivo ("ci è utile").
- "Mi sono divertito", "essersi lavato": riflessivo anche senza complemento e anche attaccato all'ausiliare.
- Infinito composto ("dopo aver giocato"): ausiliare nascosto e passato.
- Le espressioni di un verbo pronominale senza pittogramma pronominale usano il lemma semplice ("si mette le scarpe" = "mettere le scarpe").
- Una riga di `lemma_picto.tsv` può nominare una forma; una riga della forma non aggiunge il segno di plurale.
- Prior curati `ambiguity_priors.tsv` (spec: fase 7, ripiego): 13 prime persone (aspetto, cammino, entro, conto…), "quando" congiunzione, "fino" preposizione; "piano" avverbio in `forms_extra.tsv` (Morph-it! non ha la lettura).

File curati: 58 righe in `lemma_picto.tsv` (derivate dal corpus di sviluppo; le 3 grammaticali "e", "a", "i" e "fermarsi" sono decisioni di principio, il resto è locale), 8 in `blocklist.tsv`, "po'", "piano" in `forms_extra.tsv`.

Altre misure dopo le modifiche: tokenizzazione 48/48, analisi 48/48, strutture 20/20, copertura del lessico di base 97,3% (503→502: "presto" è tornato fra le eccezioni dopo aver tolto una scelta locale), treebank invariato.

## Taratura dei pesi

Ricerca a griglia (un peso alla volta) con sviluppo e prova insieme sulla prima serie: ogni valore provato cambia il risultato di 1–2 parole, cioè rumore. I pesi della specifica restano. (La revisione ha notato giustamente che la prova di allora era già stata guardata: il confronto sui pesi è informativo ma non una misura pulita.)

## Decisioni da segnalare (divergenze dalla specifica)

1. **"che" nella politica Completo è solo testo**, come dice SPEC.md fase 10; per Essenziale è nascosto, anche quando "che" è un esclamativo ("Che bello!"): la specifica parla di "che relativo o congiunzione" e il motore non distingue ancora l'esclamativo.
2. **Il segnaposto** (riquadro tratteggiato) si mostra per nomi, verbi, aggettivi, avverbi e parole sconosciute senza pittogramma; **non per i nomi propri** ("Marco", "Roma") né per le parole grammaticali: SPEC.md, fase 8, dice solo "Nessun simbolo: segnaposto". Per i nomi propri l'intento è che si usi un simbolo personale (M8c).
3. **Riflessivo sempre nascosto** (anche senza il verbo pronominale in ARASAAC): la specifica per quel caso lascia il clitico con il simbolo del pronome, ma la tabella della fase 10 parla solo di "clitici *non riflessivi*".
4. **Il caso dorato 9** ("C'era una volta un re") ora ha "c'" nascosto dentro "esserci"; l'analisi (`analisi.tsv`) resta "c' = ci".
5. **La "seconda passata"** della specifica (rieseguire Viterbi quando una struttura fallisce per una lettura vicina) non c'è: per i gruppi verbali il bonus sta nelle regole di Viterbi (peso 0,1), per le espressioni in una regola sulla confidenza. Conseguenza: in "È stato bello" "stato" resta il nome.

## Limiti

- **I testi sono sintetici e gli annotatori sono modelli**, non docenti: quello che un docente accetta davvero si misura nel pilota (M11).
- **Ancoraggio residuo**: anche con i candidati al posto della scelta del motore, categoria, lemma e segni nelle bozze della prova venivano dal motore.
- **Incoerenze fra annotatori** nelle parole non grammaticali ("più", "forte", "presto": 10 errori circa su 1.900 parole) non sono state armonizzate: sono casi di senso.
- **La sottolineatura delle parole incerte intercetta solo il 13–17% degli errori** (contro il 38% sul treebank): gli errori sono di senso del pittogramma, che la confidenza non misura. Il rimedio è il menu delle alternative (M8b), segnalando le parole con più pittogrammi plausibili.
- **Le lacune** sono soprattutto parole che ARASAAC non ha sole ("tornare", "riuscire", "calma"): gli annotatori accettano un sinonimo; serve un elenco curato con i docenti.

## Comandi

```bash
cargo run --release -q -p caa-eval -- corpus                       # metriche e errori per causa (sviluppo e prova)
cargo run --release -q -p caa-eval -- corpus --gruppo prova        # solo la prova (non per correggere!)
cargo run --release -q -p caa-eval -- prepara-candidati corpus/testi/X.txt   # bozza senza la scelta del motore
cargo run --release -q -p caa-eval -- candidati sale               # pittogrammi dell'indice per una parola
```
