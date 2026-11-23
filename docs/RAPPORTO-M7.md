# Rapporto M7 — valutazione sul corpus

Data: 2026-11-23. Misure con `caa-eval corpus` su `data/build` (schema 2) e sui 20 testi di `corpus/`.

## Criteri di accettazione

| Criterio (SPEC.md) | Esito |
| --- | --- |
| Rapporto completo con metriche | sì: le sei metriche della specifica, per testi di sviluppo e di prova (sotto) |
| Errori raggruppati per causa | sì: `caa-eval corpus` stampa nove cause in ordine di frequenza, con esempi (sotto la lista di lavoro attuale) |
| Prima taratura dei pesi | fatta: nessun peso migliora in modo apprezzabile (sotto); restano quelli della specifica |
| Primi 10 testi annotati | **20 testi annotati** (richiesti 10): 7 storie, 6 favole, 7 storie sociali, 1.945 parole |
| Comando "Esporta come caso di test" nell'editor | **rimandato a M8** (serve il motore collegato all'editor); in M7 c'è `caa-eval prepara`, che dà il TSV compilato dal motore da correggere a mano |

## Il corpus

20 testi **scritti per il progetto** (sintetici: non ho testi veri della scuola), 1.945 parole. Annotazione parola per parola: bozza del motore corretta da **cinque annotatori indipendenti** (uno ogni quattro testi), con le regole di `corpus/LEGGIMI.md`, senza usare le metriche per decidere. 14 testi di **sviluppo** (servono a correggere il motore) e 6 di **prova** (2 per genere, mai usati per correggere: misurano se i miglioramenti valgono anche su testi nuovi).

Due cose che falsano e che ho corretto:
1. **Ancoraggio sulla bozza.** Gli annotatori tendevano a lasciare la bozza dove non erano sicuri: per "e", "a", "i" la bozza dava la lettera dell'alfabeto (3026, 3021, 3030) e 122 righe la accettavano. Ho armonizzato: il pittogramma accettato è quello grammaticale. Con le lettere accettate la misura di partenza sarebbe stata 17,5 e 18,7 invece di 24,0 e 24,4: gonfiata.
2. **Il gruppo prova** doveva avere 6 testi ma ne aveva 7 (tre storie): corretto.

## Metrica principale: correzioni per 100 parole

Una parola richiede una correzione se il risultato (nascosta o visibile, pittogramma, segni) non è tra quelli accettati. È il costo reale per il docente.

| | Sviluppo (14 testi, 1.335 parole) | Prova (6 testi, 610 parole) |
| --- | --- | --- |
| **Partenza** (motore di fine M6) | 24,0 | 24,4 |
| **Dopo M7** | **7,2** | **15,1** |

**Il numero onesto è quello della prova: da 24,4 a 15,1 correzioni ogni 100 parole.** Quello dello sviluppo (7,2) è gonfiato: gli errori sono stati corretti proprio su quei testi, con file curati che nominano quelle parole. La distanza fra i due (7,2 contro 15,1) è la stima di quanto si impara dal particolare e non si generalizza.

Per genere (dopo M7): storie 6,6 sviluppo / 14,3 prova; favole 6,5 / 18,2; storie sociali 8,6 / 12,5. Le favole in prova vanno peggio: lessico meno quotidiano (rete, rosicchiare, ruggito, palude).

## Le altre metriche (dopo M7)

| | Sviluppo | Prova |
| --- | --- | --- |
| Pittogramma giusto sulle parole piene | 95,2% (era 81,8%) | **82,5%** (era 80,7%) |
| Categoria giusta | 96,2% | 96,4% |
| Lemma giusto (parole con significato) | 98,1% | 98,9% |
| Segni (plurale, passato, futuro) | 98,0% | 88,1% (59 su 67) |
| Copertura (parole piene con un pittogramma) | 99,5% (era 94,1%) | 92,6% (era 91,9%) |
| Errori sottolineati / parole giuste sottolineate | 15,6% / 2,3% | 10,9% / 3,5% |

Letture: **l'analisi grammaticale è buona** (categoria 96%, lemma 99% anche su testi mai visti). **Il problema è il senso del pittogramma e la sua disponibilità** (82,5% sulle parole piene, 92,6% di copertura): quasi tutta la distanza fra 15,1 e 0 sta lì.

## Errori per causa

Lista di lavoro attuale (partenza → dopo), parole da correggere:

| Causa | Sviluppo | Prova (dopo) |
| --- | --- | --- |
| Senso sbagliato (pittogramma di un altro significato) | 81 → 10 | 31 |
| Lettura sbagliata (categoria o lemma) | 60 → 47 | 19 |
| Lacuna di pittogramma (nessuno per quella parola) | 29 → 3 | 21 |
| Simbolo non voluto (dove l'annotatore non voleva nessun simbolo) | 23 → 20 | 10 |
| Struttura verbale (ausiliare, clitico) | 18 → 8 | 4 |
| Multiparola sbagliata | 17 → 3 | 4 |
| Segno (plurale, passato, futuro) | 2 → 1 | 1 |

## Cosa è cambiato nel motore e nei file curati

Codice (generale, vale per qualsiasi testo):
- Le parole chiave ARASAAC con `?` o `!` (frasi e saluti: "sei contento?", "lo vedi?") non entrano nell'indice delle espressioni: "era contenta" non diventa più "sei contento?" (17 errori sullo sviluppo → 3).
- Il riflessivo della stessa persona (mi, ti, si, ci, vi) si nasconde sempre, anche se ARASAAC non ha il verbo con "-si" (la specifica parla solo di "clitici non riflessivi"). "c'è", "ci sono", "c'era" = "esserci".
- Infinito composto ("dopo aver giocato", "senza essere stato"): ausiliare nascosto e PASSATO.
- Una riga di `lemma_picto.tsv` può nominare una **forma** (vince sul lemma) e vale anche per i verbi pronominali.
- Nuovi prior curati `lexicon/overrides/ambiguity_priors.tsv` (previsti dalla specifica come ripiego): 15 prime persone che il treebank, di giornali, legge come nomi ("aspetto", "cammino", "entro", "conto"…) più "quando" congiunzione, "fino" preposizione, "piano" avverbio.

File curati (derivati dal corpus di **sviluppo**, quindi con effetto gonfiato su di esso): 67 righe di `lemma_picto.tsv` (parole per cui l'indice propone più pittogrammi e il primo non è quello giusto: "classe", "scala", "porta", "camminare", "arrivare"…; più "e", "a", "i" grammaticali e "fermarsi"), 9 righe di `blocklist.tsv` (simboli di un altro senso: "brillare", "via", "scusa"…), la forma "po'" = "poco" in `forms_extra.tsv`.

Misure del treebank e dei test dorati dopo le modifiche: tokenizzazione 48/48, analisi 48/48, strutture 20/20 (il caso 9 e il 19 cambiano: "c'" è dentro "esserci", "po'" ha lemma "poco"), copertura delle parole di base **97,5%** (era 96,7%), treebank categoria 94,9% invariata.

## Taratura dei pesi

Prima taratura sul corpus con una ricerca a griglia (un peso alla volta) controllando insieme sviluppo e prova: tutti i valori provati cambiano il risultato di al massimo 1–2 parole su 1.335 e su 610, cioè rumore. I pesi della specifica restano. Conferma l'ablazione di M5: le regole di contesto contano poco, il collo di bottiglia sono i dati curati.

## Limiti e cosa fare dopo

- **I testi sono sintetici** e scritti da me; le annotazioni sono di annotatori che sono modelli, non docenti. Quello che conta davvero (cosa un docente accetta) si misura nel pilota con i docenti (M11) e, prima, con le correzioni raccolte dall'editor (M8–M9).
- **Con 20 testi la prova è piccola** (610 parole): ±1 parola sbagliata sposta di 0,16 punti. I confronti sotto l'1 punto sono rumore.
- **La taratura della confidenza è debole nel dominio scuola**: solo 11–16% degli errori è sottolineato (il treebank dava 38%), perché gli errori qui sono quasi tutti di senso del pittogramma e la confidenza misura l'incertezza della lettura. Il rimedio previsto è il menu delle alternative (M8): segnalare le parole con più pittogrammi plausibili.
- **Lacune di pittogramma**: i 21 casi della prova sono parole che ARASAAC non ha sole ("tornare", "riuscire", "calma"); gli annotatori hanno accettato il sinonimo. Un elenco di sinonimi curato (`lemma_picto.tsv`) è la cura, e va costruito con i docenti.
- Le multiparola prendono sempre la sequenza più lunga: dove l'annotatore preferiva simboli separati è un errore ("multiparola sbagliata").

## Comandi

```bash
cargo run --release -q -p caa-eval -- corpus                       # metriche e errori per causa (sviluppo e prova)
cargo run --release -q -p caa-eval -- corpus --gruppo prova        # solo la prova
cargo run --release -q -p caa-eval -- prepara corpus/testi/X.txt   # bozza TSV dal motore da correggere a mano
cargo run --release -q -p caa-eval -- candidati sale               # pittogrammi dell'indice per una parola
```
