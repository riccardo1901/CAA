# Idee per V2 e V3 — Editor CAA in simboli

Versione del 23/11/2026

## Come si decide cosa entra

Un'idea entra in una versione solo se risponde a un problema emerso dall'uso reale: dal pilota, dalle correzioni registrate o da richieste ripetute dei docenti. Questo documento è un serbatoio, non un impegno.

Tre domande per ogni idea:

1. **Riduce il tempo del docente** o migliora la leggibilità per lo studente? Se no, si scarta.
2. **Costa meno di quanto rende**, contando anche la manutenzione negli anni?
3. **Resta compatibile** con i vincoli del progetto: offline, non commerciale, dati della scuola nella scuola.

Costi stimati: **S** = giorni, **M** = settimane, **L** = mesi di lavoro con Claude Code. Sono stime d'ordine di grandezza, da rivedere quando l'idea diventa concreta.

## V2: più veloce e più utile per i docenti

La V2 resta uno strumento per docenti. Priorità: far entrare i testi nel programma più in fretta, farli uscire in più formati, e far sbagliare meno il motore.

### Far entrare i testi

| Idea | Perché | Costo | Dipende da |
| --- | --- | --- | --- |
| **Foto di una pagina del libro → testo** (OCR italiano offline, es. Tesseract) | Adattare il libro di testo è il caso d'uso più frequente; ricopiare a mano è la parte più lenta | M | — |
| **Importa da PDF e Word** | Molti materiali arrivano già in digitale | S | — |
| **Semplificazione del testo con IA locale** (modello in esecuzione su un PC o server della scuola, mai in cloud) | Proposta di frasi più brevi e lessico più semplice, che il docente approva frase per frase | L | server della scuola o PC dedicato |

### Far uscire i testi

| Idea | Perché | Costo | Dipende da |
| --- | --- | --- | --- |
| **Esporta in Word (.docx) modificabile** | I docenti finiscono i materiali in Word; ogni parola come tabella di una cella con immagine sopra e testo sotto | M | — |
| **Stampa a libretto** (A5 piegato, impaginazione automatica) | Le storie diventano libri da sfogliare | S | M10 |
| **Una pagina per frase con immagine grande** | Storie sociali e sequenze | S | — |
| **Sintesi vocale** (voci di Windows, offline) con evidenziazione della parola letta | Lettura alla LIM o al PC dello studente | M | — |

### Far sbagliare meno il motore

| Idea | Perché | Costo | Dipende da |
| --- | --- | --- | --- |
| **Tagger addestrato** (percettrone o simile sul treebank, al posto dei soli trigrammi) | Meno errori sulle forme ambigue | M | corpus e treebank |
| **Sensi per materia**: il documento ha una materia, e i pittogrammi con categorie ARASAAC affini vengono favoriti | "Pianta" in scienze è una pianta, in geografia una cartina | S | categorie ARASAAC verificate |
| **Sinonimi per le parole senza simbolo** (proporre il simbolo di un sinonimo, segnalato come tale) | Copertura del lessico disciplinare | M | dizionario di sinonimi con licenza compatibile |
| **Correzioni condivise automaticamente**: le correzioni ricorrenti di tutta la scuola diventano proposte per la revisione | Il motore impara dalla scuola intera | S | registro correzioni (v1) |

### Organizzare il lavoro

| Idea | Perché | Costo | Dipende da |
| --- | --- | --- | --- |
| **Profili studente**: politica parole funzionali, dimensione, carattere, simboli personali per singolo studente | Ogni studente ha le sue convenzioni; oggi vanno reimpostate a ogni copia | M | — |
| **Confronto copia/originale** affiancato, con le differenze evidenziate | Riprendere le correzioni dell'autore senza rifare il lavoro | M | biblioteca (v1) |
| **Modelli** (storia sociale, agenda, ricetta, avviso) | Partire da una struttura pronta | S | — |
| **Verifiche semplici**: scelta multipla e abbinamento con simboli | Richieste occasionali | L | — |
| **macOS e Linux** | Docenti con Mac a casa | S–M | Tauri le supporta; serve solo test |

## V3: oltre i docenti

La V3 allarga il pubblico: studenti, altre scuole, altri set di simboli. Ogni voce qui è un progetto a sé e va valutata solo se la V2 è stabile e usata.

| Idea | Perché | Costo | Rischi e vincoli |
| --- | --- | --- | --- |
| **Scrittura assistita per studenti**: griglie di parole e simboli, predizione della parola successiva, sintesi vocale | È il pezzo di SymWriter che la v1 lascia fuori | L | Serve un'interfaccia diversa, pensata per lo studente; test con studenti reali |
| **Tabelle di comunicazione** stampabili e su tablet | Uso quotidiano in classe | M | Rischio di rifare male strumenti dedicati già esistenti |
| **Accesso con sensori e scansione** | Studenti con disabilità motorie | L | Hardware CTS, competenze specifiche |
| **Versione web** (motore compilato in WebAssembly, sito statico) | Docenti senza Windows, uso da qualunque dispositivo | M | Biblioteca e privacy da ripensare; il motore è già pronto per questo |
| **Biblioteca tra scuole** (rete di istituti o CTS) | Materiali condivisi su scala più ampia | M | Governance, revisione dei contenuti, server condiviso |
| **Altri set di simboli** (Mulberry, simboli della scuola) | Il formato del lessico è già indipendente dal set | M | Lessico italiano da costruire per ogni set |
| **Simboli generati con IA per il lessico disciplinare mancante** ("mitocondrio", "Risorgimento") | Coprire la coda lunga che nessun set libero copre | M | Coerenza di stile con ARASAAC; revisione umana obbligatoria; non per le parole astratte |
| **Collaborazione in tempo reale** su un documento | Due docenti sullo stesso materiale | L | Serve un server; contro il principio offline |
| **App per tablet** | Lettura delle storie in classe | L | Distribuzione e manutenzione su più piattaforme |

## Idee scartate o rimandate

| Idea | Motivo |
| --- | --- |
| Pubblicità o vendita del programma | Incompatibile con la licenza ARASAAC (CC BY-NC-SA) |
| Interfaccia grafica nativa in Rust (egui, iced, Slint) | Richiederebbe di scrivere da zero un motore di impaginazione del testo; Tauri + ProseMirror evita il problema |
| Database condiviso (SQLite) sulla cartella di rete | Rischio di corruzione con accessi concorrenti; si usano file separati |
| Fusione automatica delle modifiche tra copia e originale | Una fusione sbagliata produce simboli incoerenti che nessuno nota fino alla stampa |
| Generare con IA l'intero set di simboli | Coerenza di stile impossibile su migliaia di simboli; le parole astratte non hanno un'immagine; gli studenti perderebbero il set che già conoscono |
| Modelli linguistici in cloud dentro il programma | Contro il principio offline e la privacy dei materiali con dati degli studenti |
