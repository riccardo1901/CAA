# Rapporto M3 — prototipo dell'editor

Data: 2026-11-23. Prove automatiche in Chromium (Playwright, anche in CI) e prove a mano su un PC Windows (Edge/WebView2 157, schermo 1,25×).

## Esito

**M3 chiusa: la resa A supera tutte le prove.** La resa B fallisce l'a capo, la freccia su/giù e il clic sul simbolo, quindi è scartata.

Scostamento dalla specifica, deciso con l'utente: il criterio dice "su un PC Windows della scuola"; la prova è stata fatta su un **PC Windows personale** (Edge/WebView2 157). La prova su un PC della scuola entra nel pilota (M11).

## Le prove (SPEC.md, "Resa simbolo sopra la parola")

| # | Prova | A, Chromium (automatica) | A, Windows | B, Chromium (automatica) |
| --- | --- | --- | --- | --- |
| 1 | Frecce sinistra/destra e su/giù senza salti | superata | superata (a mano) | destra/sinistra sì, **su/giù no** |
| 2 | Selezione col mouse su più righe | superata | superata (a mano) | superata (superata anche a mano su Windows) |
| 3 | Doppio clic seleziona la parola | superata | superata (a mano) | superata |
| 4 | A capo che non separa simbolo e parola | superata: 4 dimensioni × 3 larghezze, 0 parole separate | superata: 0 su 329 | **fallita**: 44–62 parole con simbolo e testo su righe diverse già a 794 px |
| 5 | Copia e incolla | superata | superata (a mano) | superata |
| 6 | Correttore ortografico di sistema | attributi `lang="it"` e `spellcheck` presenti | superata (a mano): WebView2 lo attiva senza opzioni | — |
| 7 | Digitazione veloce su tre pagine | 95° percentile 1,8 ms con 1.058 parole | **1,1 ms** (mediana 0,6, massimo 3,6; 600 battute su 445 parole; obiettivo < 30 ms) | 2,3 ms |
| extra | Un clic sul simbolo individua la parola giusta (serve a M8) | superata a 4 dimensioni | superata: 0 errori su 329 | **fallita** |

Il testo di prova di 329 parole occupa 4,0 pagine A4 a 68 px (2,6 a 45 px, 6,8 a 94 px). Con 60 immagini ARASAAC vere (scelte da cartella, mai in git) le prestazioni restano uguali: 95° percentile 1,2–1,8 ms alle quattro dimensioni e nessuna parola separata dal simbolo.

Risultato incollato dall'utente per le prove automatiche su Windows:

```text
4 · A capo: SUPERATA — 0 parole separate dal simbolo su 329
Clic sul simbolo: SUPERATA — 0 errori su 329
7 · Velocità: SUPERATA — 600 battute su 445 parole: mediana 0.6 ms, 95° percentile 1.1 ms, massimo 3.6 ms (obiettivo < 30 ms)
```

## Perché A e non B

Nella resa B il simbolo è un widget e la parola un'altra decorazione: ProseMirror disegna le decorazioni in linea **dentro** i segni di formattazione e non può racchiudere un widget insieme alla parola. Sono quindi due blocchi affiancati e il browser può andare a capo fra l'uno e l'altro. Nella resa A il simbolo è il `::before` di un blocco in linea che contiene anche la parola: restano uniti per costruzione.

## Cosa ha insegnato il prototipo

1. **La formattazione si applica a parole intere** (deciso con l'utente). Una parola con un pezzo in grassetto ha due blocchi, quindi due simboli, e il browser può mandare a capo un pezzo da solo: tra due blocchi in linea affiancati l'a capo è sempre consentito, anche con un WORD JOINER (provato e scartato). Implementazione: il comando Ctrl+B estende la selezione alle parole intere; una rete di sicurezza riallinea le parole miste (incolla, annulla…) alla formattazione del primo carattere; il documento si normalizza all'apertura. Vale anche per i futuri colore e dimensione del testo.
2. **Il clic sul simbolo si risolve dall'elemento colpito, non da `posAtCoords`.** Il pseudo-elemento non è un elemento, ma il clic arriva allo `span` della parola e `posAtDOM` dà la posizione esatta. `posAtCoords` (che sceglie dove mettere il cursore) restituisce a volte la fine di un tratto di parole in grassetto: meno del 2% dei clic sul simbolo, solo effetto sul cursore. Per il menu delle alternative di M8 si usa l'elemento colpito.
3. **Le posizioni di ProseMirror, subito dopo un tasto, sono in ritardo** sul cursore del browser: i test leggono la posizione dal DOM.
4. **Prestazioni:** ricostruire tutte le decorazioni a ogni battuta costa circa 1 ms con 1.000 parole, molto sotto i 30 ms. La cache per paragrafo delle parole c'è già; l'aggiornamento incrementale delle decorazioni non serve per ora.
5. **Correttore ortografico:** WebView2 lo attiva con `lang="it"` e `spellcheck`, senza opzioni aggiuntive.

## Limiti e punti da riprendere

- Prova su un PC della scuola: da fare nel pilota (M11).
- La resa B è stata provata a mano solo per la selezione col mouse; il resto è in Chromium. Basta, perché fallisce la prova 4.
- Prove a mano: una persona, un PC, schermo a 1,25×.
- I simboli del prototipo sono finti (uno per parola, scelto da un hash della parola) o immagini ARASAAC scelte dall'utente: il motore non è ancora collegato (M8).
- Il prototipo non è l'editor finale: mancano menu delle alternative, `pick`, `group`, dimensioni e politica delle parole funzionali (M8).

## Come rifare le prove

```bash
npx playwright test                       # resa A, tutte le prove (anche in CI, senza @perf)
npm run test:e2e:confronto                # resa A e B
npx playwright test --grep @perf          # velocità (dipende dalla macchina)
```

Sul PC Windows: avvia `caa-app.exe` (artifact della CI), premi "Esegui le prove automatiche", fai le prove a mano nel pannello e premi "Copia risultati".
