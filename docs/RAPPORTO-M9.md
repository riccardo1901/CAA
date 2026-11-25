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

---

# M9b-1 — La biblioteca nel Drive condiviso: trovarla, vederla, adattarla

**Stato**: scritto e provato con prove automatiche; prove a mano su Windows da fare (`docs/PROVE-M9b1.md`). M9b-2 (Pubblica, Aggiorna, Ritira, blocco, «Originale aggiornato», `version.json`) deve ancora partire.

## Cosa c'è
- **`caa-lib`**: libreria senza interfaccia. `config.json` del tecnico (`ProgramData\CAA\config.json`: nome del Drive, cartella, amministratori; tutto facoltativo) e impostazioni dell'utente (`%APPDATA%\Editor CAA\settings.json`: nome da mostrare, cartella scelta, scritto in modo atomico). Ricerca della cartella nei Drive condivisi di ogni unità (`Drive condivisi` o `Shared drives`, cartella `CAA` con dentro `biblioteca`). Controllo di raggiungibilità con tempo massimo (un Drive che si blocca non blocca il programma). Indice dei manifest che rilegge solo i file cambiati; file ancora in sincronizzazione o rovinati saltati e ritrovati alla scansione dopo; copie in conflitto riconosciute dal doppio identificativo; cache dell'ultimo elenco e dei documenti, per consultare e adattare senza il Drive; copia da adattare (id nuovo, revisione 1, ricorda id e revisione dell'originale).
- **App**: nome da mostrare al primo avvio (finestra che non si chiude senza un nome), indicatore «● Biblioteca» in alto (controllo all'avvio e ogni 2 minuti), scheda **Biblioteca** nel pannello Documenti (cartelle trovate con «Usa questa», percorso a mano, «Crea la biblioteca qui» per chi la imposta; elenco con autore, materia, livello, etichette, data, ricerca senza accenti, filtri, «copia in conflitto», avviso sui file in sincronizzazione, **Adatta**). La biblioteca non si scrive mai in questo blocco, tranne la creazione delle cartelle.
- **Scelte confermate**: il nome da mostrare si chiede solo al primo avvio; le cartelle e il `config.json` si usano per nome (la lettera dell'unità cambia da PC a PC); la lettura del Drive ha sempre un tempo massimo e usa la copia locale se non risponde.

---

# M9b-2 — Pubblica, Aggiorna, Ritira, avvisi

**Stato**: scritto e provato con prove automatiche; prove a mano su Windows da fare (`docs/PROVE-M9b2.md`, la più importante per il Drive). M9c deve ancora partire.

## Cosa c'è
- **`caa-lib::publish`** (senza interfaccia):
  - **Pubblica**: documento nuovo in biblioteca con l'id del documento personale e revisione 1; non sovrascrive mai (neppure se lo stesso documento c'è già con un altro nome, per esempio una copia in conflitto di Drive).
  - **Aggiorna in biblioteca**: solo l'autore; blocco `<id>.lock` con utente e ora (scade dopo 2 ore, creazione esclusiva); revisione controllata con il blocco in mano: se la biblioteca è andata avanti da sola, il documento si salva come **documento nuovo** (id nuovo) e lo si dice; il documento personale ne diventa l'autore.
  - **Ritira**: sposta in `archivio\` (l'autore o un amministratore del `config.json`; un file illeggibile solo un amministratore); un nome già in archivio non si sovrascrive; il blocco di quel documento si toglie.
  - Tutte le scritture sono atomiche (file temporaneo accanto e rinomina); le prove interrompono pubblicazione e aggiornamento in vari punti: il documento di prima resta intero, senza `.tmp` né blocchi.
  - Confronto delle versioni (`0.9` < `0.10`) e `original_update`.
- **Documento personale**: ricorda la revisione che ha in biblioteca (`published_rev`, aggiunta al manifest in modo compatibile: schema invariato) e il salvataggio automatico non la perde.
- **App**: nel pannello Documenti, **Pubblica** (modulo con titolo, materia, livello, etichette; suggerimenti dai documenti già in biblioteca) e **Aggiorna in biblioteca** per ogni documento; il documento aperto si salva prima; spenti senza Drive; **Ritira** nella scheda Biblioteca per l'autore o gli amministratori (con conferma); barra azzurra **«L'originale è stato aggiornato»** per le copie adattate, con **Apri l'originale** (sola lettura) e **Torna alla mia copia** e **Ignora** (per revisione); avviso **«È disponibile la versione X»** da `aggiornamenti\version.json`; controllo ogni 2 minuti.
- **Scelte confermate**: «apri l'originale» al posto della copia in sola lettura (non affiancato); l'id del documento di biblioteca è quello del documento personale dell'autore; amministratori = nomi utente di Windows nel `config.json`; materia e livello a testo libero con suggerimenti.

## Difetti trovati dalle prove mentre si scriveva
- Il blocco: il file nasce vuoto e si riempie un istante dopo. Chi lo leggeva in quel momento lo scambiava per «rovinato», lo toglieva e ne prendeva uno suo (due titolari). Ora un blocco illeggibile ma recente è «preso da qualcuno».
- Due scritture dello stesso processo (autosalvataggio e pubblicazione, o più thread) usavano lo stesso nome di file temporaneo. Ora ogni scrittura ha il suo.
- Aprendo «Documenti» subito dopo aver scritto, il documento aperto non era ancora nell'elenco: ora si salva prima.

## Revisione indipendente di M9b (Opus) e correzioni
Ogni difetto confermato ha la prova scritta prima (sul codice vecchio falliva).
- **Ricordo della pubblicazione perso** (salvataggio automatico e Pubblica scrivevano lo stesso file da thread diversi): ora le scritture dell'archivio personale sono una alla volta (anche contro due «Adatta» con lo stesso titolo); se il ricordo manca ma il documento è già in biblioteca con lo stesso autore, «Pubblica» lo ritrova invece di dare errore.
- **Poteri di amministratore dal nome da mostrare**: ora gli amministratori si riconoscono solo dal nome utente di Windows; l'autore dal nome da mostrare.
- **Titolo scelto in «Pubblica» perso** al salvataggio successivo: il documento aperto ora adotta il titolo.
- **Blocco proprio rimasto dopo un crash**: dopo 5 minuti l'autore lo riprende (prima 2 ore); entro 5 minuti vale ancora (potrebbe essere un suo altro computer).
- **«Ritira» durante un aggiornamento**: ora prende il blocco del documento; se qualcuno aggiorna, non ritira. Un id strano in un file di biblioteca non porta più fuori cartella.
- **Cache offline**: file temporanei unici e puliti; un aggiornamento della stessa dimensione ora si ricopia (si confronta la revisione).
- Minori: la copia da adattare azzera il ricordo della pubblicazione; `version.json` si legge al massimo per 64 KB.
- Non corretto, noto: la ricerca automatica della cartella senza tempo massimo se un'unità di rete è scollegata (resta da rivedere in M9c o con la prova sul Drive vero); due utenti omonimi si riconoscono come lo stesso autore (SPEC chiede nome utente Windows + nome da mostrare: da decidere, segnalato).

## Metriche del motore
Invariate: il motore non è cambiato in M9.
