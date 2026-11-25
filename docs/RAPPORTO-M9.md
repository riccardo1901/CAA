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

---

# M9c-1 — memoria del docente

**Stato**: codice e prove automatiche fatti; prova a mano su Windows da fare (`docs/PROVE-M9c1.md`).

- **Motore**: `UserMemory`, livello 3 della scelta (`PictoReason::Memory`). Per lemma e categoria; per forma esatta solo le parole senza lemma. Cede alla scelta esplicita e al blocco di senso del documento; vince su curati e indice. Valori speciali (0, unisci, dividi) mai ricordati. Resta senza accesso al disco.
- **App**: `memoria.json` in `%APPDATA%\Editor CAA` (scrittura atomica, tetto 5.000 voci e 4 MB, voci non valide scartate, file rovinato messo da parte, un salvataggio che fallisce non cambia la memoria). Comandi `memory_list/add/forget/clear`; `symbolize` e `alternatives` la usano.
- **Editor**: casella «ricorda per sempre» (spenta di default; solo per scelte di un pittogramma), elenco «Cosa ricordo» nella barra vuota con Dimentica e Dimentica tutto; i paragrafi si rifanno quando la memoria cambia.
- **Scelta aperta**: un documento già fatto, riaperto con la stessa versione del lessico, si ri-simbolizza con la memoria di adesso e può cambiare simbolo. È coerente con «usa sempre»; da confermare con la prova a mano.

# M9c-2 — simboli della scuola e identità dell'autore

**Stato**: codice e prove automatiche fatti; prova a mano su Windows da fare (`docs/PROVE-M9c2.md`).

- **`caa-lib::shared`**: `simboli\<uuid>.webp` + `.json` (etichetta, autore, nome utente di Windows, data). Il `.json` si scrive per ultimo (senza, il simbolo è «in sincronizzazione» e non si mostra); mai sopra un file esistente; stesso uuid due volte = resta il primo; rovinati, incompleti, troppo grandi, non-WebP e uuid strani scartati. Ritira in `archivio\` (due file, nome mai sovrascritto): autore (nome utente) o amministratore.
- **Identità dell'autore** (decisione 4 del piano): il manifest ricorda `author_user` (nome utente di Windows, campo facoltativo: schema invariato). Pubblica lo scrive; Aggiorna e Ritira confrontano quello, per i file vecchi il nome da mostrare. Chiude il difetto degli omonimi segnalato dalla revisione di M9b (prova con due «Maria Rossi»).
- **App**: simboli della scuola presi con una copia nella raccolta locale (stesso `uuid`: viaggiano nei documenti e funzionano senza Drive); condivisione con elenco, ritiro con permessi calcolati lato Rust (`can_retire`); cancellazione di un simbolo locale (indice prima, file poi; gli id non si riusano). Letture del Drive con tempo massimo.
- **Editor**: «Condividi con tutta la scuola» nel ritaglio (solo con la biblioteca; un errore non toglie il simbolo), «Simboli della scuola…» nella barra, × per eliminare/ritirare con conferma.
- Non fatto (per scelta): cache offline dell'elenco della scuola (senza Drive l'elenco è vuoto, ma quelli già presi restano nella raccolta locale).

# Revisione indipendente di M9c (Opus) e correzioni
Ogni difetto confermato ha la prova scritta prima.
- **Privacy**: un nome proprio a inizio frase (il motore lo legge come PROPN con lemma = la parola) finiva nel registro → ora le righe PROPN non si registrano. Il contesto accetta solo lettere e apostrofo (prima passava un indirizzo email in minuscolo). Il testo nella scheda ora dice la verità: il file lo crea l'account Google di chi invia e chi ha accesso alla cartella lo vede.
- **Perdita di dati**: eliminare un simbolo personale lo toglieva dal documento aperto al salvataggio successivo → ora il file immagine resta (si toglie solo dalla raccolta) e le voci di memoria che lo usavano si tolgono.
- **Motore**: «ricorda per sempre» non funzionava sulle parole sconosciute (la memoria per forma era dopo il controllo dell'analisi) → ora sì.
- **Identità**: un documento pubblicato prima di M9c-2 prende il nome utente al primo aggiornamento dell'autore.
- **Drive**: una condivisione rimasta a metà (immagine senza json) bloccava il simbolo per sempre → si completa se l'immagine è la stessa, si ripulisce se il json non si scrive.
- **Registro**: «Invia» e «Butta via» non si sovrappongono più (un solo turno alla volta); l'anteprima dice quante righe in più partono; «Nessun simbolo» su una parola che non aveva simbolo non registra più una riga inutile.
- **Non corretto, noto**: la scheda mostra «Ritira» dei documenti in base al nome da mostrare, mentre il permesso vero lo decide il programma con il nome utente (un omonimo vede il pulsante e riceve un errore); una voce ricordata mostra la parola anche dove la politica dice «solo testo»; `write_new` controlla l'esistenza e poi rinomina (con nomi casuali il rischio è minimo; l'alternativa dei collegamenti fisici non è sicura su un Drive virtuale).

# M9c-3 — correzioni anonime

**Stato**: codice e prove automatiche fatti; prova a mano su Windows da fare (`docs/PROVE-M9c3.md`).

- **`caa-lib::corrections`**: una riga per scelta = forma, una parola di contesto per lato, lemma, categoria, pittogramma scelto (0 = nessun simbolo), pittogramma proposto. Mai il testo intero né il nome di chi scrive. Non si registrano: parole senza lemma (sconosciute, forse nomi), maiuscola in mezzo alla frase (nomi propri), cifre, parole troppo lunghe, simboli personali. Nei contesti nomi, numeri e parole lunghe diventano `_`. Offset in UTF-16 (prova con accentate ed emoji).
- **Invio**: `correzioni\<id casuale>-<data>-<ora>.tsv`, mai sopra un file esistente; l'id è un numero casuale in `anon-id`, non il nome utente. Se riesce si tolgono dal registro locale solo le righe inviate (quelle arrivate nel frattempo restano). Senza Drive non si invia.
- **App**: registro locale `correzioni-locali.tsv` (tetto 20.000 righe, righe rovinate ignorate), interruttore «Raccogli le correzioni» (acceso di partenza, salvato nelle impostazioni).
- **Editor**: ogni scelta di un pittogramma diverso dal proposto, o «Nessun simbolo», si registra; sezione «Correzioni anonime» nella scheda Biblioteca (testo di spiegazione, anteprima, Invia, Butta via).
- **`caa-eval correzioni DIR [--tutte]`**: aggrega i registri (docenti, volte, forma, lemma, categoria, scelto, proposto) per decidere a mano cosa portare nei file curati; non modifica niente.
- Limite noto: un nome conosciuto dal lessico come parola comune a inizio frase può finire nella forma; per questo c'è l'anteprima prima dell'invio.

## Metriche del motore
Invariate (la memoria è vuota nelle misure): dorati 48/48; strutture 20/20; corpus sviluppo 6,9 (134/1945); prova 13,4 (86/643).
