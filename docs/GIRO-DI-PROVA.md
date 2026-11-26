# Giro di prova su Windows: tutte le prove in un solo percorso

Questo documento **sostituisce l'ordine** dei file `docs/PROVE-*.md` (che restano per i dettagli). Le prove sono rimesse in ordine di rischio e scritte con i nomi della **nuova interfaccia** (M11). Sono circa 45 controlli in tre parti: **A** un solo PC senza Drive (circa 50 minuti), **B** un PC con Google Drive (circa 25 minuti), **C** due computer (circa 30 minuti). Se hai poco tempo, fai prima la parte A, poi la C.

## Preparazione (10 minuti)
1. **Programma**: scarica `caa-app` dalla pagina della CI dell'ultimo commit (<https://github.com/riccardo1901/CAA/actions>, la corsa verde in cima, in fondo «Artifacts» → `editor-caa-windows`, che contiene `caa-app.exe`) e decomprimilo in una cartella, per esempio `C:\CAA-prova`.
2. **Dati**: decomprimi `caa-dati-prova.zip` e metti la cartella **`dati`** accanto a `caa-app.exe`. Windows può dire «app sconosciuta»: «Ulteriori informazioni» → «Esegui comunque».
3. **Per la parte A**: due o tre immagini tue (PNG o JPG; **non foto di studenti**), un testo tuo di una pagina e mezza e, per la stampa su carta, un righello.
4. **Per le parti B e C**: Google Drive per computer, con l'account che userete. La cartella deve avere questa forma: `…\CAA\biblioteca` (dentro «Il mio Drive» se l'account è uno solo, o dentro un Drive condiviso). Per C servono **due computer** con lo stesso Drive (o due account Windows).
5. Se vuoi rifare il primo avvio: rinomina `%APPDATA%\Editor CAA\settings.json` in `settings-vecchio.json`.

**Come riportare:** per ogni numero scrivi «ok» oppure cosa hai visto (meglio con una foto dello schermo). Indica il computer (dimensione dello schermo e «Scala» di Windows).

---

## PARTE A: un PC, senza Drive

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| A1 | Primo avvio (punto 5 sopra). | Finestra centrata, un po' più piccola dello schermo. Benvenuto con «Editor CAA», chiede solo il nome. Poi foglio vuoto con l'invito «Scrivi qui…». |
| A2 | Scrivi qualche frase. Aspetta 3–4 secondi. | I simboli compaiono sopra le parole. In alto compare «Salvato alle …» e il titolo prende la prima riga. In `Documenti\CAA` c'è un solo file `.caa`. |
| A3 | Clicca il simbolo di una parola, scegli un'alternativa (anche con i tasti 1–8). Poi **F8**. Poi **Ctrl+Z** e **Ctrl+Y**, anche dopo aver cliccato nel pannello laterale. | Si apre il pannello laterale (scheda **Simbolo**) e il simbolo cambia. F8 va alla prossima parola da controllare. Annulla e Ripeti funzionano sempre (prima Ctrl+Y no). |
| A4 | Scegli un simbolo con «usa per tutto il testo» acceso, poi con «**ricorda per sempre**» acceso. Apri un **documento nuovo** e scrivi la stessa parola. | Con «tutto il testo» cambiano tutte le parole uguali. Con «ricorda per sempre» la parola esce già col simbolo scelto, anche nel documento nuovo e dopo aver riavviato. Nella scheda **Memoria** c'è la voce, con «Dimentica». |
| A5 | **Parole funzionali → Personalizzato**: nascondi gli articoli, metti le preposizioni «solo testo». Clicca poi il simbolo di un articolo nascosto e scegline uno. | La tabella cambia subito il foglio. La tua scelta vince sulla tabella. Completo ed Essenziale tornano come prima. |
| A6 | **Unisci/Dividi**: seleziona «scuola media», premi **Unisci** (o Ctrl+Maiusc+U), poi **Dividi**. Prova su «ferro da stiro» (già unito). Selezionando due parole con una virgola in mezzo, Unisci resta spento. | Un solo simbolo per la frase unita; Dividi li separa; Ctrl+Z rimette l'unione. |
| A7 | **Simbolo personale**: clicca il simbolo di «mela», nel pannello **Simbolo personale…**, scegli una tua immagine, ritaglia (trascina e ingrandisci), **Usa questo simbolo**. | **L'immagine si vede sopra la parola** (la prima volta non si vedeva). Compare nella scheda **Memoria → I miei simboli**, come prima alternativa e per prima nella ricerca. Annulla non salva niente. Una foto grande da telefono funziona. Un file non-immagine dà un messaggio chiaro. |
| A8 | **Salvataggio**: scrivi una parola e chiudi **subito** con la X della finestra. Riapri il programma e il documento da **Documenti**. | L'ultima parola c'è. Tutto torna com'era: scelte, unioni, tabella, dimensione, simbolo personale. |
| A9 | Apri **due volte** il programma sullo stesso documento e scrivi in entrambe. | La seconda copia mostra **in alto** (finché non ci clicchi) l'avviso «il file era stato cambiato da un'altra copia…» e salva come «(copia)». Nessun testo perso. |
| A10 | Rendi non scrivibile `Documenti\CAA` (tasto destro → Proprietà → sola lettura o permessi), scrivi e chiudi. Poi rimetti i permessi. | Una finestra chiede «Resta nel programma» / «Esci senza salvare»; il programma non si chiude da solo. |
| A11 | **Correzioni anonime**: scrivi `Luca mangia il pane con Anna.` e cambia il simbolo di «pane». Apri `%APPDATA%\Editor CAA\correzioni-locali.tsv`. | Una riga con «pane», le parole vicine («il», «con»), il lemma e il numero del simbolo. **Mai «Luca», «Anna» o la frase intera.** Nome proprio scelto a mano o parola sconosciuta: nessuna riga. |
| A12 | **Stampa**: **Stampa…** in alto (o Ctrl+P) → scheda **Pagina**. Cambia orientamento, carattere, «Riquadro attorno a simbolo e parola», una frase per riga. Premi **Stampa…** e guarda l'anteprima di Windows. Poi **Microsoft Print to PDF**. | Il foglio cambia subito. L'anteprima e il PDF non hanno barre né pannelli; **su ogni pagina** c'è «Pittogrammi: Sergio Palao per ARASAAC…». Nelle opzioni del dialogo di Windows togli «Grafica di sfondo»: **i simboli escono lo stesso**. |
| A13 | Con una stampante vera: stampa su carta con i quattro formati dei simboli e **misura con il righello** il lato di un simbolo. Prova margine 5 mm e «Margini: Nessuno». | Circa 12, 18, 25, 40 mm. Dimmi le misure e se la riga dell'attribuzione è tagliata. |
| A14 | **Schermo**: restringi la finestra poco a poco fino al minimo. Poi cambia **Scala** di Windows (125%, 150%). Poi **Altro → Dimensione dell'interfaccia → Molto grande**. | La barra resta su una riga: i gruppi che non ci stanno passano in **Altro**. Il pannello laterale si chiude da solo se manca spazio. Niente tagliato. «Molto grande» ingrandisce barre e finestre, non il foglio, e resta dopo la riapertura. |
| A15 | **Tastiera**: premi Tab appena aperto il programma; poi **F1**; apri **Altro** con le frecce. | Il primo elemento è «Vai al testo»; l'anello blu del fuoco si vede sempre; in una finestra Tab non esce. F1 mostra le scorciatoie. |

---

## PARTE B: un PC con Google Drive

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| B1 | **Documenti → Biblioteca**. | Se il programma trova la cartella `CAA\biblioteca` (anche in **«Il mio Drive»**), compare «Collegata al Drive» e l'indicatore **● Biblioteca** in alto. Se no, mostra le cartelle trovate e il campo del percorso: provalo con un percorso sbagliato (errore chiaro) e con quello giusto. Dimmi com'è il percorso reale (lettera dell'unità, «Il mio Drive»?). |
| B2 | Scrivi un documento e nella sua riga: menu **⋯ → Pubblica…** (titolo, materia, livello, etichette). Poi **← Indietro**. | «Pubblicato in biblioteca (revisione 1)»; nella cartella `biblioteca` del Drive c'è un nuovo file `.caa`. La riga mostra «in biblioteca (rev. 1)». |
| B3 | Nella scheda **Biblioteca** cerca una parola del titolo (anche senza accenti, `citta`) e prova i filtri Materia/Livello. Premi **Adatta** su un documento. | L'elenco si restringe. «Adatta» apre una tua **copia** (etichetta «copia»); l'originale non cambia. |
| B4 | Metti nella cartella `biblioteca` un file `.caa` troncato a metà e premi **Aggiorna**. | «1 documento è ancora in sincronizzazione»: non si blocca. |
| B5 | **Senza Drive**: chiudi Google Drive per computer e riapri **Documenti → Biblioteca**. Poi riaccendilo e premi Aggiorna. | «Drive non raggiungibile: vedi l'ultima copia»; Adatta funziona sui documenti già visti; Pubblica/Aggiorna sono spenti. L'indicatore diventa arancione entro 2 minuti e torna verde. |
| B6 | **Simbolo della scuola**: importa un simbolo personale con la casella **«Condividi con tutta la scuola»** accesa. | Compare «Simbolo condiviso con la scuola»; in `simboli\` del Drive ci sono un `.webp` e un `.json`. Con Drive spento: «salvato per te, ma non condiviso». |
| B7 | **Correzioni anonime**: nella scheda **Correzioni** guarda il testo, «Vedi cosa parte», poi **Invia correzioni**. | Il testo dice che il file lo crea l'account Google. Dopo l'invio c'è un file in `correzioni\` (nome lungo casuale, **senza il tuo nome**) e il registro locale si svuota. Senza Drive «Invia» è spento. Spegni la raccolta: non registra più. |
| B8 | **Cancellazione**: nella scheda **Memoria → I miei simboli** elimina un simbolo (× e conferma). | Sparisce dal computer; un documento che lo usa lo conserva. |

---

## PARTE C: due computer (A e B) sullo stesso Drive

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| C1 | Su **A**: pubblica un documento (B2). Su **B**: **Documenti → Biblioteca → Aggiorna**. | Il documento compare su B con il nome di A. **Annota quanto ci mette Drive** (secondi? minuti?) e se è in modalità *streaming* o *mirror*. |
| C2 | Su **B**: **Adatta** quel documento. Su **A**: modifica l'originale e premi «Aggiorna in biblioteca». Su **B** apri la copia (aspetta la sincronizzazione). | Su A «Aggiornato in biblioteca: revisione 2». Su B, sopra il foglio, la fascia «**L'originale è stato aggiornato**»: **Apri l'originale** (sola lettura), **Torna alla mia copia**, **Ignora**. |
| C3 | Su **B**: il documento di A ha il pulsante **Ritira** nel menu ⋯? (non deve averlo, salvo che B sia amministratore). Su **A**: **Ritira** e conferma. | Su B nessun «Ritira». Su A il documento esce dall'elenco e il file va in `archivio\`. Dopo qualche istante B non lo vede più. |
| C4 | Con un documento ritirato, su A premi «Aggiorna in biblioteca». | Messaggio chiaro: non è più in biblioteca, si può pubblicare di nuovo. |
| C5 | **Conflitto**: aggiorna lo stesso documento da due computer a pochi secondi di distanza, prima che Drive sincronizzi. | Nessun testo si perde: uno dei due vede «ho salvato questo documento come nuovo in biblioteca». |
| C6 | Su **B**: prendi un **simbolo della scuola** (pannello, scheda **Memoria**, «Simboli della scuola…») e usalo. Spegni Drive: il simbolo funziona ancora. Apri il documento su un terzo computer che non lo aveva mai preso. | Il simbolo c'è anche lì (viaggia dentro il documento). Il × per ritirarlo c'è solo per l'autore. |
| C7 | **Omonimi**: su due computer (o utenti Windows) metti **lo stesso nome da mostrare**; uno pubblica un documento o un simbolo. | L'altro **non** vede «Ritira» né può aggiornarlo: l'autore si riconosce dal nome utente di Windows, non dal nome scelto. |
| C8 | Spegni il Wi-Fi a metà di un «Aggiorna» e guarda la cartella dopo. | Il documento di biblioteca è com'era o intero nuovo, mai a metà; nessun file `.tmp` resta. |

---

## Per il pilota con PC personali e un account Google comune
- **Funziona** con «Il mio Drive» dell'account in comune (il programma lo cerca da solo). Il programma non ha accesso a Internet: è Google Drive per computer a sincronizzare.
- **Identità**: l'autore di un documento si riconosce dal **nome utente di Windows**. Se due docenti hanno lo stesso nome utente (per esempio «Utente»), per il programma sono la stessa persona e possono aggiornare o ritirare i documenti l'uno dell'altro. Controllalo sui PC dei docenti prima di partire.
- **Amministratori** (chi può ritirare i documenti degli altri): file `C:\ProgramData\CAA\config.json` da creare a mano su ogni PC, per esempio `{"admins": ["maria"]}` (nomi utente di Windows).
- **Foto di studenti**: non usarle come simboli personali senza l'autorizzazione della scuola; con la casella «Condividi con tutta la scuola» finirebbero nel Drive comune.

## Quando hai finito
Mandami il riepilogo (per ogni numero ok o cosa hai visto, con foto). Io sistemo i difetti in ordine di gravità, prima quelli che fanno perdere dati o stampare male.
