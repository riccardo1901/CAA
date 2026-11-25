# Prove a mano di M9a (PC Windows): documenti, salvataggio automatico, lessico

Serve l'app nuova (`caa-app.exe` della CI dell'ultimo commit) e il pacchetto dati più recente. I documenti si salvano in `Documenti\CAA` (puoi guardare la cartella con Esplora file). **Per le prove 13 e 14 serve un solo PC; non serve ancora il Drive.**

| # | Cosa fare | Cosa deve succedere |
| --- | --- | --- |
| 1 | Avvia l'app. | Si apre un documento **vuoto**. In alto c'è una riga con il pulsante **Documenti**, il titolo (grigio: «Senza titolo») e a destra lo stato del salvataggio (vuoto). Nessun file è stato creato in `Documenti\CAA`. |
| 2 | Scrivi `La storia del gatto Pepe` (o altro). Aspetta 3–4 secondi. | A destra compare **«Salvato alle …»**. Il titolo diventa la prima riga. In `Documenti\CAA` c'è un file `La storia del gatto Pepe.caa`. |
| 3 | Continua a scrivere. | Ogni pochi secondi compare di nuovo «Salvato alle …» e il file è sempre lo stesso (nessun file in più). |
| 4 | Cambia il titolo nella casella in alto. | Si salva da solo. (Il nome del file non cambia: è normale.) |
| 5 | Clicca **Nuovo**. | Documento vuoto, nessuna richiesta di conferma (il precedente è già salvato). |
| 6 | Clicca **Documenti**. | Si apre un pannello con due schede: **I miei documenti** (l'elenco, con titolo, data e ora, **Apri**, **Elimina**) e **Biblioteca** (per ora dice che arriva con la prossima versione). In fondo la cartella usata. |
| 7 | Dall'elenco clicca **Apri** sul documento di prima. | Si riapre identico: testo, titolo, simboli, scelte, dimensione dei simboli. |
| 8 | In un documento: scegli un simbolo con «usa per tutto il testo», un'altra scelta su una parola, unisci due parole, scegli **Personalizzato** nella politica con una modifica, cambia la dimensione, importa un simbolo personale. Poi **Nuovo** e riapri il documento da **Documenti**. | Tutto torna come l'avevi lasciato (il simbolo personale compare ancora). |
| 9 | Chiudi il programma (la X della finestra) subito dopo aver scritto una parola, senza aspettare. Riaprilo e apri il documento. | L'ultima parola c'è: alla chiusura il programma salva prima di uscire. La finestra si chiude in meno di qualche secondo. |
| 10 | Nell'elenco clicca **Elimina** su un documento. | Chiede conferma; poi il documento sparisce dall'elenco e dalla cartella. |
| 11 | Dal pannello, prova ad aprire un file `.caa` rovinato: copia in `Documenti\CAA` un file `.caa` troncato a metà (o un testo rinominato `.caa`). | L'elenco dice «1 file non si legge» e il programma non si blocca. |
| 12 | Con il documento aperto, apri `Documenti\CAA` in Esplora file e **rinomina** il file. Poi scrivi qualcosa nel programma. | Non si perde niente: il programma riscrive il documento (può ricreare un file). Dimmi cosa succede. |
| 13 | Scrivi `Marco mangia pane` e scegli un simbolo diverso per «pane». Esci dal programma, aggiornalo (con un pacchetto dati nuovo se ce l'hai), riapri. | Se il lessico è cambiato compare una barra gialla «Il nuovo lessico cambierebbe N simboli» e il documento mostra i **vecchi** simboli. Con **Rivedi** passi una parola alla volta (vecchio → nuovo); **Applica tutti** usa i nuovi; **Mantieni i vecchi** li fissa. Se il lessico non è cambiato, nessuna barra. |
| 14 | Durante la revisione del lessico, scrivi un nuovo paragrafo in fondo. | Il paragrafo si salva; la barra resta; i simboli vecchi degli altri paragrafi non cambiano da soli. |

| 15 | Apri **due volte** il programma sullo stesso documento (doppio clic sul programma) e scrivi in una finestra, poi nell'altra. | Il programma non si blocca: la seconda copia, al salvataggio, dice «Il file era stato cambiato da un'altra copia del programma» e salva sotto un altro nome («… (copia)»). Nessun testo va perso. |
| 16 | Chiudi la finestra mentre il disco è molto lento (per esempio subito dopo aver incollato molto testo) o quando `Documenti\CAA` non si può scrivere (togli il permesso alla cartella). | Se il salvataggio non riesce compare una domanda: «Il documento aperto non si è salvato… Uscire comunque?». Con «No» resti nel programma. |

## Come mi riporti il risultato

- Se tutto va bene: "M9a ok".
- Altrimenti: il numero della prova e cosa hai visto (se puoi, una foto).
- Dimmi anche: il salvataggio automatico ti dà fastidio da qualche parte? Il titolo in alto è chiaro? L'elenco dei documenti basta o ti serve la ricerca/l'ordinamento?

## Da sapere

- Il salvataggio automatico scrive **solo** in `Documenti\CAA`, mai nel Drive.
- Il file `.caa` è uno ZIP: si può aprire con un programma di archivi per guardare dentro (manifest, documento, immagini), ma non va modificato a mano.
- La biblioteca nel Drive condiviso (Adatta, Pubblica, Aggiorna) è M9b.
