# Rapporto M9 — Archivio e biblioteca

**Stato**: M9a scritto e provato con prove automatiche; **le prove a mano su Windows sono ancora da fare** (`docs/PROVE-M9a.md`, elenco in `docs/PROVE-DA-FARE.md`). M9b (biblioteca nel Drive condiviso) e M9c (memoria delle correzioni, raccolta condivisa dei simboli) devono ancora partire.

## Decisione di progetto: la biblioteca è un Drive condiviso Google
La scuola usa un Drive condiviso di Google Workspace, non un server. La specifica è stata cambiata di conseguenza (`SPEC.md`, «Biblioteca, copie personali, sincronizzazione»): ogni PC ha Google Drive per computer, che mostra il Drive come una normale cartella; il programma non parla mai con Google e resta senza rete. Conseguenze: il salvataggio automatico scrive solo in `Documenti\CAA`, il Drive si scrive solo con Pubblica e Aggiorna; i file arrivano con ritardo e possono arrivare incompleti (si leggono solo `.caa` completi e validi); il blocco di aggiornamento è indicativo; nessuna coda offline. Punto aperto per il tecnico: installare Google Drive per computer sui PC e sui portatili (consigliata la modalità «mirror» per la cartella `CAA`).

## M9a — Il file `.caa` e i documenti personali
- **`caa-doc`**: libreria nuova, senza interfaccia. File ZIP (`manifest.json`, `document.json`, `render.json`, `media/*.webp`). Scrittura atomica (file temporaneo per processo e rinomina, con nuovi tentativi per Windows); lettura che rifiuta file troncati, rovinati, con voci duplicate o enormi, e riconosce la perdita silenziosa di immagini o dell'istantanea (il manifest elenca ciò che il file deve contenere). Schema, migrazioni con prove, schema più recente in sola lettura.
- **Documenti personali** in `Documenti\CAA`: salvataggio automatico (solo locale), un documento vuoto non crea file, titolo dalla prima riga o scelto, Nuovo/Apri/Elimina, scheda «Biblioteca» (segnaposto). Chiudendo la finestra il programma salva e poi esce; se la pagina non risponde esce comunque dopo 4 secondi; se il salvataggio non riesce chiede conferma.
- **Blocchi di senso nei dati del documento** (`sense_locks`): cancellare la parola su cui si è scelto non li scioglie; «Togli il blocco»; annulla e ripeti li includono.
- **Preferenze del documento** (politica e tabella personalizzata, dimensione dei simboli, contorno a card) salvate e ripristinate. I simboli personali viaggiano nel file e si rimappano sull'id del computer che apre il documento; scelte con simboli mancanti o valori impossibili si scartano.
- **Lessico nuovo**: `render.json` conserva i simboli risolti; se il lessico è cambiato il documento si apre con i simboli vecchi e una barra («Rivedi» una parola alla volta, «Applica tutti», «Mantieni i vecchi» come scelte del docente). Salvare nel frattempo non fa passare di nascosto il lessico nuovo.
- **Conflitti**: se il file è stato cambiato da un'altra copia del programma (revisione o id diversi), il documento si salva come nuovo («… (copia)») e lo dice; un file di schema più recente non si riscrive.

## Revisione indipendente (Opus) e correzioni
Dodici osservazioni; i difetti con rischio di perdita dati corretti con una prova scritta prima (sei prove fallivano con il codice vecchio):
- **Alta**: un salvataggio lento (più di 1 s: OneDrive, antivirus) più «Apri» o «Nuovo» riscriveva il documento precedente con il contenuto dell'altro. Ora ogni salvataggio sa a quale documento appartiene (contatore di sessione) e «Apri/Nuovo/Chiudi» aspettano il salvataggio in corso senza limite.
- **Alta**: alla chiusura il programma usciva anche se il salvataggio era fallito o a metà, senza avviso, e dopo 4 secondi usciva comunque. Ora la pagina conferma di aver ricevuto la richiesta (niente uscita forzata), salva con calma e, se non riesce, chiede conferma.
- **Media-alta**: nessun controllo di revisione/id prima di scrivere (due copie del programma sullo stesso file si sovrascrivevano): ora conflitto → documento nuovo.
- **Media**: il titolo scritto durante un salvataggio veniva annullato.
- La revisione del lessico agiva su posizioni vecchie dopo una modifica del testo; un documento eliminato durante un salvataggio rinasceva; i simboli personali con uuid mancante mostravano un altro simbolo; scelte con valori impossibili; voci duplicate nello ZIP; rinomina senza nuovi tentativi; un simbolo non importabile rendeva illeggibile tutto il documento.

Limiti noti (accettati):
- Se si modifica un paragrafo mentre la decisione sul lessico è in sospeso, quel paragrafo passa ai simboli nuovi (gli altri no).
- Il programma non impedisce di aprire due copie sullo stesso documento: ora lo riconosce al salvataggio (conflitto), ma non lo previene.
- I simboli personali non si ritrovano se l'immagine manca nel file e nella raccolta locale: la scelta torna automatica.
- Il salvataggio scarta in silenzio un simbolo personale la cui immagine non è sul computer.

## Metriche del motore
Invariate: il motore non è cambiato in M9.
