# Prove a mano di M9b-1 (PC Windows): la biblioteca nel Drive condiviso

**Prima di tutto serve Google Drive per computer** installato, con l'accesso al Drive condiviso dell'istituto, e nel Drive condiviso una cartella `CAA` che contenga una cartella `biblioteca` (può essere vuota: le prove 6 e 7 la riempiono). Se non c'è ancora, la crea chi imposta la biblioteca con «Crea la biblioteca qui» (prova 4). Serve l'app nuova (`caa-app.exe` della CI dell'ultimo commit).

Per le prove 6–12 servono **almeno due o tre documenti `.caa` in `biblioteca`**: fai a mano una copia di un tuo documento da `Documenti\CAA` dentro la cartella `biblioteca` del Drive (con nomi diversi). Per vederli con autore e materia diversi, la pubblicazione vera arriva con M9b-2: per ora basta che compaiano.

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | **Primo avvio** (se non lo hai già fatto: cancella `%APPDATA%\Editor CAA\settings.json` per rifarlo). | Compare «Benvenuto/a»: chiede **solo il tuo nome**. «Continua» è spento finché non scrivi. Dopo, il documento vuoto. Il nome non viene richiesto di nuovo. |
| 2 | Guarda in alto, nella riga dei documenti, a destra. | Se il programma ha trovato da solo la biblioteca: **«● Biblioteca»** (verde). Se ne ha trovate più d'una compare un messaggio in basso. Se nessuna, niente. |
| 3 | Clicca **Documenti → Biblioteca**. | Se la cartella non è stata trovata: «non è ancora collegata», l'elenco delle cartelle trovate nei Drive condivisi con **Usa questa**, e la casella per scrivere il percorso. |
| 4 | Scrivi un percorso **sbagliato** (una cartella vuota qualsiasi) e premi **Usa questo percorso**. Poi, solo se sei tu a impostare la biblioteca, **Crea la biblioteca qui** su una cartella vuota del Drive. | Con «Usa questo percorso»: errore «non contiene una biblioteca». Con «Crea la biblioteca qui»: la cartella si riempie di `biblioteca`, `archivio`, `simboli`, `correzioni`, `aggiornamenti` e la scheda mostra «La biblioteca è vuota». |
| 5 | Scegli la cartella giusta (**Usa questa** o il percorso). | La scheda mostra l'elenco; in alto **«Collegata al Drive»** e il pulsante **Aggiorna**; l'indicatore in alto diventa verde. Chiudi e riapri il programma: la scelta resta. |
| 6 | Copia 2–3 file `.caa` nella cartella `biblioteca` del Drive (da Esplora file), poi premi **Aggiorna**. | Compaiono con titolo, autore, materia e livello (se ci sono) e la data. I più recenti per primi. |
| 7 | Copia nella cartella `biblioteca` un file `.caa` **troncato a metà** (o un testo rinominato `.caa`). | L'elenco dice «1 documento è ancora in sincronizzazione» e **non si blocca**. |
| 8 | Scrivi nella casella di ricerca parole del titolo, dell'autore; prova anche senza accenti (`citta` per `città`). Prova i filtri **Materia** e **Livello**. | L'elenco si restringe subito; senza risultati dice «Nessun documento corrisponde». |
| 9 | Clicca **Adatta** su un documento. | Si apre subito una **copia tua** (stesso titolo e contenuto). In **I miei documenti** c'è una voce con l'etichetta **«copia»**. L'originale nella biblioteca non cambia. Modificarla non tocca il Drive. |
| 10 | **Senza Drive**: chiudi Google Drive per computer (o scollega la rete e metti la modalità «mirror» o «streaming» come vuoi provare) e riapri **Documenti → Biblioteca**. | Compare **«Drive non raggiungibile: vedi l'ultima copia»** e l'elenco dell'ultima volta; l'indicatore in alto diventa arancione («non raggiungibile») entro due minuti. **Adatta** funziona sui documenti già visti. |
| 11 | Riattiva Drive e premi **Aggiorna**. | Torna «Collegata al Drive», l'elenco si aggiorna, l'indicatore torna verde (entro due minuti). |
| 12 | Con Drive in modalità **streaming**, prova ad adattare un documento mai aperto. | Può metterci qualche secondo ma l'interfaccia non si blocca; se il file non arriva compare un errore chiaro. Dimmi i tempi che vedi. |
| 13 | Metti due copie dello stesso documento nella biblioteca (copia un file `.caa` con un altro nome). | Nell'elenco compaiono entrambe con l'etichetta **«copia in conflitto»**. |

## Come mi riporti il risultato

- Se tutto va bene: "M9b-1 ok".
- Altrimenti: il numero della prova e cosa hai visto (se puoi, una foto).
- Dimmi anche: **come si chiama il Drive condiviso e dove compare** (la lettera dell'unità e la cartella `Drive condivisi` in italiano o `Shared drives`?), e se il programma l'ha trovato da solo. Mi serve per sistemare la ricerca automatica.

## Da sapere

- La cartella `biblioteca` si legge soltanto: **in questo blocco il programma non scrive mai nel Drive**, tranne la creazione delle cartelle della prova 4. Pubblica, Aggiorna e Ritira arrivano con M9b-2.
- In `%APPDATA%\Editor CAA\biblioteca-cache` il programma tiene l'ultimo elenco e una copia dei documenti, per consultarli senza Drive.
