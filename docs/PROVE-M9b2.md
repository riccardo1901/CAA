# Prove a mano di M9b-2 (PC Windows): Pubblica, Aggiorna, Ritira, avvisi

**Serve il Drive vero**, con la biblioteca collegata (prove M9b-1 fatte) e, per le prove 6–9, **due computer** (o due persone con account diversi) che vedono la stessa cartella `biblioteca`. Serve l'app nuova (`caa-app.exe` della CI dell'ultimo commit). Chiama «A» il primo computer e «B» il secondo.

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Su **A** scrivi un documento, poi **Documenti** → sulla riga del documento clicca **Pubblica**. | Si apre un modulo con **Titolo**, **Materia**, **Livello**, **Etichette** (Materia e Livello suggeriscono quelli già in biblioteca). Compila e premi **Pubblica**. |
| 2 | Guarda l'elenco. | «Pubblicato in biblioteca (revisione 1)». La riga ha l'etichetta verde **«in biblioteca (rev. 1)»** e il pulsante **«Aggiorna in biblioteca»**. Nella cartella `biblioteca` del Drive c'è un nuovo file `….caa`. |
| 3 | Su **B**, dopo qualche secondo (o minuto: Drive ci mette un po'), **Documenti → Biblioteca → Aggiorna**. | Il documento compare, con autore **il nome di A**. |
| 4 | Su **B** premi **Adatta**. Su **A** modifica il documento originale e premi **Aggiorna in biblioteca**. | Su A: «Aggiornato in biblioteca: revisione 2». |
| 5 | Su **B**, apri la **copia** (quella adattata in prova 4) da **Documenti** (aspetta che Drive sincronizzi). | In alto compare l'avviso azzurro **«L'originale … è stato aggiornato in biblioteca (revisione 2). La tua copia non cambia da sola»**. **Apri l'originale** lo mostra in sola lettura (non si può scrivere); **Torna alla mia copia** riapre la tua copia. **Ignora** toglie l'avviso (e non torna per quella revisione). |
| 6 | Su **B**, nella scheda Biblioteca guarda il documento di A. | **Non c'è** il pulsante «Ritira» (non è il tuo). Se **B** è nell'elenco degli amministratori del `config.json`, invece c'è. |
| 7 | Su **A** premi **Ritira** sul documento. Conferma. | Esce dall'elenco. Nella cartella del Drive il file non è più in `biblioteca` ma in **`archivio`**. Dopo qualche istante B non lo vede più (con «Aggiorna»). |
| 8 | Su **A** apri il documento personale (era pubblicato, ora ritirato) e premi **Aggiorna in biblioteca**. | Messaggio «il documento non è più in biblioteca (è stato ritirato): puoi pubblicarlo di nuovo». Dopo, il documento mostra di nuovo **Pubblica**. |
| 9 | **Conflitto**: su **A** e su **B**, con la stessa biblioteca, aggiorna lo **stesso** documento (deve essere di A: per B usa lo stesso account di A, oppure fai la prova da due finestre) a distanza di pochi secondi, prima che Drive sincronizzi. | Nessun documento si rovina. Uno dei due, al momento di «Aggiorna», vede **«La biblioteca era già andata avanti…: ho salvato questo documento come nuovo in biblioteca»**. Nell'elenco compaiono due documenti, e nessun testo è andato perso. Se Drive crea una copia «in conflitto», l'elenco la segnala con **«copia in conflitto»**. |
| 10 | Mentre un aggiornamento lungo è in corso (per esempio spegni il Wi-Fi a metà di «Aggiorna»), guarda la cartella dopo. | Il documento di biblioteca è com'era prima o intero nuovo, mai a metà; nessun file `.tmp` resta nella cartella (se resta, dimmi il nome). |
| 11 | Senza Drive (chiudi Google Drive per computer) apri **Documenti**. | **Pubblica** e **Aggiorna in biblioteca** sono **spenti** (non si scrive senza Drive). |
| 12 | Metti nella cartella `aggiornamenti` del Drive un file `version.json` con `{"version": "9.9.9", "notes": "Prova"}`. Aspetta fino a 2 minuti (o riavvia). | In alto compare **«È disponibile la versione 9.9.9 del programma»** (con le note al passaggio del mouse). Se metti una versione uguale o più vecchia, non compare. |

## Come mi riporti il risultato

- Se tutto va bene: "M9b-2 ok".
- Altrimenti: il numero della prova e cosa hai visto (se puoi, una foto).
- Dimmi anche: **quanto ci mette Drive** a far comparire un documento pubblicato sull'altro computer (secondi? minuti?), e se Drive per computer è in modalità *streaming* o *mirror*. È l'informazione che ci serve per la scuola.

## Da sapere

- Il programma non può impedire che due persone scrivano nello stesso istante: il blocco `.lock` arriva con ritardo sull'altro PC. Per questo, se la biblioteca è andata avanti, **non sovrascrive mai**: salva come documento nuovo e te lo dice.
- «Ritira» non cancella: il file resta in `archivio` e un amministratore lo può rimettere in `biblioteca` a mano.
