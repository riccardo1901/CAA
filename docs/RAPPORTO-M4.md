# Rapporto M4 — motore, fasi 1–3 e 8

Data: 2026-11-23. Misure con `caa-eval` sui dati di novembre 2026 (`data/build`, schema 2). I test sul mini-lessico girano anche in CI; quelli sui dati veri si eseguono in locale e si saltano da soli se `data/build` manca.

## Criteri di accettazione

| Criterio (SPEC.md) | Esito |
| --- | --- |
| Test dorati di tokenizzazione ed elisione verdi | **48 su 48**, sia sul mini-lessico (CI) sia sui dati veri: le parti di tokenizzazione, elisione e normalizzazione dei 20 test della specifica più 28 casi nuovi (`lexicon/golden/tokenizzazione.tsv`) |
| Ogni parola del lessico scolastico di base riceve un pittogramma | **499 su 516 (96,7%)**; parole piene (nomi, verbi, aggettivi) **97,7%**; vedi sotto la lettura del criterio e le 17 eccezioni |
| Offset in UTF-16 | verificati su testi con accenti ed emoji (token, golden, mini-lessico) |
| Velocità: meno di 5 ms per un paragrafo di 100 parole | **0,13 ms** (mediana, paragrafo di 74 parole, build di rilascio, 200 prove) |

Verifiche: 118 test verdi, `fmt` e `clippy` puliti, `caa-engine` compila ancora per WebAssembly.

## Il "lessico scolastico di base"

La specifica non lo definisce. `lexicon/lessico_base.tsv` ha **516 parole piene** (297 nomi, 114 verbi, 74 aggettivi, 31 avverbi) tipiche di storie e consegne per la primaria, preparate da Claude e non riviste parola per parola dall'utente.

"Ogni parola riceve un pittogramma" non si può soddisfare alla lettera, perché ARASAAC non ha una chiave esatta per 17 di queste parole. Criterio adottato: **almeno il 97% delle parole piene e il 96% del totale, con le eccezioni elencate** in `lexicon/lessico_base_senza_pittogramma.tsv`. Il test sui dati veri confronta quell'elenco con la misura: se ARASAAC si aggiorna, il test lo segnala.

| Categoria | Con pittogramma |
| --- | --- |
| Nomi | 292 su 297 (98,3%) |
| Verbi | 110 su 114 (96,5%) |
| Aggettivi | 72 su 74 (97,3%) |
| Avverbi | 25 su 31 (80,6%) |

Le 17 eccezioni: *pagella, bidello, camera, sera, gioia, partire, tornare, restare, bagnare, bravo, falso, presto, tardi, già, davanti, insieme, forse*. Sono lacune dei dati (per esempio ARASAAC ha "camera da letto", "più tardi", "bagnarsi", ma non le parole sole). Si possono chiudere a mano con `lexicon/overrides/lemma_picto.tsv`.

Altre cifre della misura: 481 parole su 516 hanno il pittogramma della forma esatta, 11 del lemma, 3 del plurale (manca il singolare), 4 ignorando la categoria; 4 sono risolte dalla lettura da chiave ARASAAC; 197 parole sarebbero sottolineate nell'editor, perché hanno più letture e la scelta è provvisoria (cala con M5).

## Cosa fa il motore

**Fasi 1–2, tokenizzatore.** Lavora sul testo originale: gli intervalli sono in byte e in UTF-16, quindi accenti ed emoji non sfasano. Elisione (`l'` + `albero`, `dell'` + `acqua`, apostrofo tipografico compreso), numeri, orari, date e decimali come token unico, trattini tra lettere dentro la parola, trattino di dialogo e punteggiatura come token, puntini di sospensione, simboli ed emoji. Un apostrofo finale ("po'", "E'", "perche'") è risolto con il lessico: prima la forma con l'apostrofo, poi la forma accentata se esiste (`perche'` → `perché`, `E'` → `è`), altrimenti è una virgoletta e si stacca. La tabella dei prefissi elisi della specifica dà il lemma (`nell'` → *in*, `c'` → *ci*, `un'` → *uno*).

**Fase 3, letture.** Tutte le letture di Morph-it!; nome proprio dalla maiuscola; lettura da chiave ARASAAC per le parole sconosciute a Morph-it! (tipo 1 nome proprio, 2 nome, 3 verbo, 4 aggettivo o avverbio; plurale con il singolare come lemma); refuso a distanza 1; indovino per suffisso; altrimenti `Unknown`.

**Fase 8, pittogramma, livelli 5–8.** `lemma_picto.tsv` e blocklist, poi indice ARASAAC (forma esatta, singolare, lemma, e il plurale se manca il singolare) con gli spareggi della specifica, poi senza categoria con penalità, poi nessun simbolo. Ogni token ricorda perché è stato scelto così (`reason`).

**Scelta provvisoria fra più letture.** Senza contesto vale una regola fissa, dichiarata provvisoria: prima le letture che portano a un pittogramma della categoria giusta, poi una priorità fissa per categoria (nome, verbo, aggettivo…); a metà frase la maiuscola vince su tutto. La fase 7 (M5) la sostituirà.

## Scelte e estensioni rispetto alla specifica

1. **Plurale se manca il singolare** (nuovo): ARASAAC ha "pastelli" e "sassi" ma non "pastello" e "sasso"; la specifica copre solo plurale → singolare. Vale per nomi e aggettivi. I plurali regolari si deducono dal suffisso (e si scartano se Morph-it! li conosce come altra parola); i plurali irregolari (*labbro* → *labbra*, *braccio* → *braccia*, *uomo* → *uomini*, *dio* → *dei*…) si accettano solo se Morph-it! li conferma come plurale dello stesso lemma, così *pasto* non diventa *pasta*. Misura su tutti i nomi singolari di Morph-it! assenti in ARASAAC con il plurale presente: **126 su 126 risolti** (la prima versione ne risolveva 122: mancavano gli irregolari). Non è una regola completa: copre i plurali che le regole e la tabella degli irregolari conoscono e non si applica a verbi né avverbi.
2. **Refusi:** la specifica chiede "una sola forma vicina *frequente*", ma non abbiamo frequenze: si usa "una sola forma a distanza 1 e parola di almeno 5 lettere".
3. **`readings` e `corrected` nel `Token`** (nuovi): tutte le letture, che la fase 7 dovrà scegliere, e la forma corretta di un possibile refuso.
4. **`caa-eval` minimo anticipato a M4** (la specifica lo prevede in M7): serve alla regola "prima e dopo" di `CLAUDE.md`. Comandi: `dorati`, `copertura`, `velocita`, `mostra`.
5. **Lettura dei file curati nel motore:** `lemma_picto.tsv` e `blocklist.tsv` si leggono come testo (nessun I/O); `caa-store::open_engine` li carica da `data/build/overrides/`.
6. **Benchmark `criterion`:** rimandato a M7, quando c'è il corpus (la specifica lo vuole su testi fissi del corpus); in M4 la velocità si misura con `caa-eval velocita` e un test.
7. **Test dorati sui dati veri e CI:** la CI usa un mini-lessico scritto a mano e gli stessi casi; i test sui dati veri girano in locale (come deciso).

## Punto di partenza per M5 e M6

Cosa dà il motore, senza contesto, sulle frasi dei 20 test dorati (`caa-eval mostra "frase"`). Tutte le frasi sono tokenizzate correttamente; qui l'analisi:

| # | Frase | Stato di partenza |
| --- | --- | --- |
| 1 | Apri la porta. | corretto: *aprire*, *la* articolo, *porta* nome |
| 2 | Lei la porta a scuola. | *la* articolo e *porta* nome: da correggere (clitico e *portare*) → M5 |
| 9 | C'era una volta un re. | *c'* = *ci*, *era* = *essere*: corretto; PASSATO → M6 |
| 10 | Ho mangiato il riso. | *mangiare* e *riso* nome corretti; PASSATO → M6 |
| 13 | E' una bella giornata. | *E'* = *essere*, corretto |
| 14 | Prendo gli occhiali. | pittogramma della forma esatta, corretto; niente PLURALE (fase 9) |
| 15 | Le maestre sono arrivate. | *maestra* (non *maestro*), corretto; PLURALE e PASSATO → M6 |
| 17, 18 | *sale* | letto come plurale di *sala*: da correggere → M5; *scale* → *scala* corretto; `nell'` → *in* corretto |
| 19 | Mangio ancora un po' di pane. | *ancora* letto come nome: → M5; `po'` non spezzato, "un po'" multiparola → M6 |

## Rimandato

Livelli 1–4 della fase 8 (scelte del docente, blocco di senso, memoria, multiparola: M6 e M8), alternative del menu (fase 10, M8), modificatori (fase 9, M6), politica delle parole funzionali (M8), confidenza vera (fase 7, M5).

## Come rifare le misure

```bash
cargo run --release -p caa-lexicon-build                      # costruisce data/build
cargo run -q -p caa-eval -- dorati
cargo run -q -p caa-eval -- copertura
cargo run --release -q -p caa-eval -- velocita
cargo run -q -p caa-eval -- mostra "Metti il sale nell'acqua."
cargo test -p caa-eval                                        # gli stessi criteri come test
```
