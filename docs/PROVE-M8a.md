# Prove a mano di M8a (PC Windows)

Cosa serve: l'app compilata dalla CI (`caa-app.exe`, artifact del run di GitHub Actions) e il pacchetto di dati `caa-dati-prova.zip` (lessico e circa 1.400 immagini ARASAAC).

## Preparazione

1. Scarica l'artifact `caa-app` dal run della CI e decomprimilo in una cartella, per esempio `C:\caa`.
2. Decomprimi `caa-dati-prova.zip` **dentro la stessa cartella**: deve esserci `C:\caa\dati\` accanto a `caa-app.exe`.
3. Avvia `caa-app.exe`. Se Windows chiede conferma (programma non firmato), scegli "Esegui comunque".

## Le prove

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Avvia l'app. | Si apre la finestra con il foglio, la barra in alto e la barra di stato in basso. In basso a destra c'è scritto **"Motore attivo"**. Non c'è nessuna fascia gialla. |
| 2 | Clicca **"Testo di esempio"**. | Sopra le parole compaiono i **pittogrammi veri**. Alcune parole hanno un riquadro tratteggiato al posto del simbolo (nessun pittogramma disponibile nel pacchetto). |
| 3 | Clicca **"Nuovo"** e scrivi: `Oggi Marco è andato al mare con la mamma.` | Dopo la parola, il simbolo compare quasi subito (meno di mezzo secondo, senza scatti). "è" non ha simbolo (è nascosto); "andato" ha un simbolo con un segno **◀** (passato). |
| 4 | Scrivi: `I bambini mangiano le mele.` | "bambini" e "mele" hanno un segno **+** (plurale). |
| 5 | Scrivi: `Domani andremo al parco.` | "andremo" ha un segno **▶** (futuro). |
| 6 | Scrivi: `Ho fatto colazione.` | Un solo simbolo su "fatto" ("far colazione"); "Ho" e "colazione" senza simbolo. |
| 7 | Scrivi: `Mi lavo le mani.` | "Mi" senza simbolo; "lavo" con il simbolo di "lavarsi le mani" e "le", "mani" senza. |
| 8 | Nella barra in alto cambia **Parole funzionali** da "Completo" a "Essenziale" e torna indietro. | In "Completo" gli articoli (il, la, le…) hanno un simbolo piccolo; in "Essenziale" non hanno simbolo. |
| 9 | Clicca i quattro pulsanti **Piccolo / Medio / Grande / Molto grande** e prova **Ctrl+1, 2, 3, 4**. | I simboli cambiano dimensione; il testo non si sposta in modo strano. |
| 10 | Scrivi una parola inventata, per esempio `blorpf`. | La parola è **sottolineata con un'onda arancione**; in basso il numero di "parole da controllare" aumenta. |
| 11 | In mezzo al testo scrivi più veloce che puoi per 10 secondi. | Nessun ritardo o scatto; il cursore non salta; il testo che scrivi resta tutto. |
| 12 | Usa le frecce, seleziona con il mouse, fai doppio clic su una parola. | Come in M3: il cursore e la selezione si comportano normalmente anche con i simboli veri. |

## Come mi riporti il risultato

- Se tutto va bene: scrivimi "M8a ok".
- Altrimenti: il numero della prova e cosa hai visto (se puoi, una foto dello schermo).
- Dimmi anche se i **segni** ◀ ▶ + ti sembrano comprensibili o se la scuola usa un'altra convenzione (sono provvisori).

## Novità dopo la revisione

- "Nuovo" e "Testo di esempio" chiedono conferma se c'è del testo (il salvataggio arriva con M9).
- Se il motore non risponde, in basso compare **"Il motore non risponde: riprovo…"** e l'app riprova da sola.
- **Chiudi sempre l'app prima di sostituire la cartella `dati`** (su Windows i file in uso non si possono sostituire).

## Note

- Il pacchetto di prova ha solo le immagini dei testi del corpus e delle parole di base: per altre parole il simbolo può mancare (riquadro tratteggiato) anche se il motore lo conosce. L'uso vero avrà tutte le immagini.
- Il motore cerca i dati in: `dati\` accanto al programma, poi `data\build\`, oppure nella cartella indicata dalla variabile `CAA_DATA`.
