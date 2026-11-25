# Prove a mano di M9c-3 (PC Windows): correzioni anonime

Serve l'app nuova e la biblioteca collegata (come M9b). Il registro locale è `%APPDATA%\Editor CAA\correzioni-locali.tsv` (puoi aprirlo con il Blocco note); l'identificativo anonimo è in `anon-id`.

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Scrivi `Luca mangia il pane con Anna.` Clicca il simbolo di **pane**, scegli un'alternativa. Poi **Nessun simbolo** su un'altra parola. | Nel file `correzioni-locali.tsv` compaiono righe come `pane<TAB>il<TAB>con<TAB>pane<TAB>NOUN<TAB>…`: **mai** «Luca», «Anna» né la frase intera (nei contesti i nomi diventano `_`). |
| 2 | Scegli un simbolo per una parola **con la maiuscola in mezzo alla frase** (un nome) e per una parola che il programma non conosce (`blorpf`). | **Nessuna riga** nuova. |
| 3 | **Solo testo** e **Automatico** su una parola. | Nessuna riga nuova. |
| 4 | **Documenti → Biblioteca**, in fondo: sezione **Correzioni anonime**. | Spiega cosa si ricorda, la casella **Raccogli le correzioni** (accesa), «N correzioni in attesa», **Vedi cosa parte**, **Invia correzioni**, **Butta via**. |
| 5 | **Vedi cosa parte**. | Si vedono le righe (anche solo le prime 30): controlla che non ci sia niente di personale. |
| 6 | Spegni la casella, scegli un altro simbolo, riaccendi. | Con la casella spenta non si registra niente; la scelta resta dopo il riavvio. |
| 7 | **Invia correzioni**. | «Inviate N correzioni. Grazie!» Nella cartella `correzioni\` del Drive c'è un file `<numero lungo>-<data>-<ora>.tsv` con l'intestazione e le righe. Il registro locale si svuota. |
| 8 | Spegni Drive e riapri la scheda. | **Invia correzioni** è spento («serve il Drive»); le correzioni restano in attesa. |
| 9 | **Butta via** (conferma/annulla). | Con «Annulla» non cambia niente; con «OK» il registro si svuota. |
| 10 | (Per te o per chi cura il lessico) `cargo run -q -p caa-eval -- correzioni "<cartella correzioni del Drive>"` | Elenca le scelte ripetute da più docenti o più volte: docenti, volte, forma, lemma, categoria, simbolo scelto, simbolo proposto. Con `--tutte` anche quelle singole. |

## Come mi riporti il risultato
- Se tutto va bene: "M9c-3 ok".
- Altrimenti: il numero della prova e cosa hai visto. **Se in una riga vedi qualcosa di personale (un nome, un numero) dimmelo subito.**
- Dimmi anche: il testo della sezione è chiaro per un collega? Va bene che la raccolta sia accesa di partenza?

## Da sapere
- Il programma non invia mai da solo: l'invio è sempre un tuo clic.
- Restano fuori i nomi propri certi (maiuscola in mezzo alla frase), le parole sconosciute, i numeri, i simboli personali. Un nome a inizio frase che il lessico conosce come parola comune potrebbe finire nella colonna «forma»: per questo c'è l'anteprima.
