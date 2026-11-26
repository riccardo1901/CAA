# Rapporto M11: miglioramento dell'interfaccia

**Stato**: codice e prove automatiche fatti (blocchi M11-0 … M11-9), revisione indipendente fatta e corretta. **Restano**:
- le prove a mano su Windows (`docs/PROVE-M11.md`);
- la prova con un docente che non ha mai visto il programma, che è il criterio di chiusura di M11.

Il piano, le decisioni dell'utente e il dettaglio di ogni blocco sono in `docs/PIANO-M11.md` (sezione «Avanzamento»).

## In una frase
Il foglio e la stampa sono rimasti identici al pixel. È cambiato tutto quello che sta intorno:
- barre più ordinate, su una riga sola;
- un pannello laterale richiudibile, con tre schede;
- finestre, conferme e notifiche che si comportano tutte allo stesso modo;
- scorciatoie visibili e una dimensione dell'interfaccia regolabile;
- testi più semplici.

Il programma si adatta agli schermi da 1024×600 a 3840×2160, con il ridimensionamento di Windows dal 100% al 200%.

## Cosa è cambiato, per il docente
- **Intestazione**: segno e nome «Editor CAA», Documenti, Nuovo, titolo, stato del salvataggio e della biblioteca, **Stampa…** e il menu **«Altro»**, che contiene:
  - Testo di esempio, Informazioni, Scorciatoie da tastiera;
  - la Dimensione dell'interfaccia;
  - l'avviso di versione nuova.
- **Barra degli strumenti su una riga**: quando lo spazio manca, i gruppi passano interi nel menu «Altro». Annulla e Ripeti restano sempre in vista. Ctrl+Z e Ctrl+Y funzionano anche fuori dal foglio (K3).
- **Pannello laterale richiudibile con tre schede**:
  - **Simbolo**: le alternative, divise in sezioni con titolo;
  - **Pagina**: la stampa accanto al foglio, che cambia dal vivo; al posto della finestra Stampa;
  - **Memoria**: Cosa ricordo, I miei simboli.

  Sugli schermi stretti parte chiuso e si apre sopra il foglio quando serve.
- **Documenti e Biblioteca**:
  - ogni riga ha un'azione principale; il resto sta nel menu «⋯»;
  - Pubblica è una sotto-pagina con «← Indietro»;
  - le Correzioni hanno una scheda propria;
  - «Ritira» compare solo a chi ha davvero il permesso (K1).
- **Finestre, conferme, notifiche**:
  - un solo comportamento per tutte le finestre: Tab gira dentro, Esc chiude, il fuoco torna dove era;
  - conferme del programma con il verbo sul pulsante, in rosso se l'azione non si può annullare;
  - le notifiche di problema restano finché non si chiudono.
- **Primi minuti**:
  - benvenuto con una frase su cosa fa il programma;
  - invito sul foglio vuoto, che non entra nel documento né nella stampa;
  - F1 per le scorciatoie;
  - interfaccia Normale / Grande / Molto grande, mentre il foglio resta uguale.
- **Accessibilità**:
  - primo elemento «Vai al testo»;
  - zone con nome per i lettori di schermo;
  - anello di fuoco di 2 px su ogni controllo;
  - contrasto WCAG AA, controllato in 17 situazioni;
  - ogni pulsante con un nome;
  - animazioni spente se Windows chiede di ridurle.
- **Difetti noti corretti** (piano, sezione 4): K1–K18, tutti. Per ognuno c'è prima la prova automatica e poi la correzione. Il difetto K4 nel motore resta per dopo (vedi sotto).

## Cosa NON è cambiato (vincoli verificati)
- **Il foglio e la stampa**:
  - `tests/e2e/foglio.spec.ts` controlla l'impronta dello stile di ogni elemento del foglio, sullo schermo e in stampa, e confronta le immagini al pixel di foglio e pagine del PDF;
  - il PDF di Chromium è identico byte per byte con le stesse impostazioni;
  - l'unico cambiamento voluto, deciso dall'utente, è la striscia grigia della stampa di M10 tolta.
- **Il motore**: non toccato. Il difetto K4 (una scelta ricordata mostra il simbolo anche dove «Parole funzionali» dice di nasconderlo) resta segnalato per una modifica del motore dopo M11. L'interfaccia spegne «ricorda per sempre» per quelle parole e lo dice.
- **I file**:
  - `.caa`, `settings.json`, `memoria.json` e le cartelle del Drive non sono cambiati;
  - l'unica aggiunta lato Rust è il dato `can_retire` passato all'interfaccia;
  - in più, la finestra si apre all'85% dello schermo, come deciso dall'utente.
- **Nessuna rete**: icone (Lucide, ISC, citata in Informazioni) e caratteri sono dentro il programma.

## Divergenze dalla specifica (approvate, `SPEC.md` aggiornata)
1. Barra laterale **richiudibile**, con tre schede (era «fissa»).
2. Stampa come scheda «Pagina» del pannello laterale (era una finestra).
3. La politica delle parole funzionali si vede solo nella barra degli strumenti (era ripetuta nella barra di stato).
4. «Contorna simbolo e parola» diventa «Riquadro attorno a simbolo e parola», nella scheda Pagina.

Altre due decisioni dell'utente:
- **niente zoom del foglio**: l'A4 orizzontale sotto i 1200 punti di larghezza richiede di scorrere, ed è un fallimento accettato nella matrice degli schermi;
- **finestra all'avvio all'85% dello schermo**.

## Prove automatiche
- **Playwright**: tutte verdi (numero esatto nell'ultimo commit). Le 128 prove di prima di M11 restano verdi: sono cambiati solo i selettori dove i comandi hanno cambiato posto, nessuna prova è stata tolta. Le prove nuove:
  - foglio congelato (19);
  - matrice dei 19 schermi (152 controlli);
  - stile e accessibilità;
  - icone, finestre, barre, Pagina, Documenti, Simbolo, primi minuti, rifinitura.
- **Rust**: `cargo test` verde (prove di `can_retire` in `caa-lib` e della dimensione della finestra in `src-tauri`).
- **Schermate prima/dopo**: `CAA_ASPETTO=<etichetta> npx playwright test aspetto` e `node scripts/confronto-ui.mjs m10 m11-9`. 24 situazioni su 4 schermi: 1024×600, 1366×768, 1920×1080 al 150%, 2560×1440.

## Revisione indipendente (M11-9) e correzioni
Il revisore ha letto tutto il codice di M11 e ha riprodotto i difetti. Per ogni difetto c'è una prova in `tests/e2e/rifinitura.spec.ts`, vista fallire prima della correzione.
- **Scorciatoie dietro le finestre**: con Documenti o una conferma aperta, Ctrl+Z, Ctrl+1–4, F8 e Ctrl+P cambiavano il documento dietro. Questo era nuovo di M11: la conferma del sistema bloccava la pagina, quella del programma no. In più, con il fuoco su un pulsante, il browser annullava da solo l'ultima modifica del testo. Ora con una finestra aperta queste scorciatoie non fanno niente; F1 non apre una seconda finestra sopra un'altra.
- **Tab usciva da Documenti** (Biblioteca non collegata) passando per il «Dettagli» chiuso: ora il riquadro dettagli è nel giro e quello che sta dentro, finché è chiuso, no.
- **«Personalizzato» scelto dal menu «Altro»** su schermo piccolo: chiusa la tabella, il fuoco si perdeva. Ora torna su «Altro».
- **Chiudere due volte il programma** con il salvataggio non riuscito apriva due domande uguali: ora una sola.
- **Pannello sopra il foglio**: Esc dalle linguette non lo chiudeva; se si chiudeva da solo (finestra più stretta) il fuoco si perdeva. Corretti tutti e due.
- **Voci spente del menu «⋯»** (per esempio «Pubblica…» senza Drive): ora si raggiungono con le frecce e dicono perché sono spente.
- **Testi**:
  - l'etichetta della Memoria diceva il contrario di quello che succede: «la politica può nasconderla» → «mostra sempre il simbolo»;
  - «la politica delle parole funzionali» → il nome che si vede sullo schermo, «Parole funzionali»;
  - «Ctrl+1 o 2 o 3 o 4» → «Ctrl+1 o Ctrl+2…»;
  - «Il motore non risponde» → «I simboli non arrivano»;
  - «rev. 2» → «versione 2»;
  - le colonne dell'anteprima delle correzioni ora sono in italiano semplice;
  - «Butta via» → «Cancella senza inviare».

**Osservazioni non accolte, con il perché:**
- **Esc su un suggerimento visibile chiude anche la finestra**: il suggerimento compare subito con il fuoco da tastiera, quindi fermare Esc al suggerimento costringerebbe chi usa la tastiera a premerlo sempre due volte. Un Esc chiude tutto quello che sta sopra, suggerimento compreso.
- **Pulsanti spenti della barra (Unisci, Dividi, Annulla, Ripeti)**: la spiegazione si vede con il mouse, non con la tastiera, perché un pulsante spento non prende il fuoco. Lasciarli raggiungibili cambierebbe il giro di Tab di tutta la barra: per ora resta così.
- **Menu «Altro»**: dentro ci sono anche controlli che non sono voci di menu (i gruppi della barra spostati). Con un lettore di schermo può essere meno chiaro: si rivede se un docente lo usa.
- **«Dimensione dell'interfaccia»** non è stata rinominata: è il nome del piano approvato.
- **I quattro modi di dire «Drive non raggiungibile»** sono rimasti come sono: quello dell'intestazione è nella tabella 3.10 approvata.
- **`can_retire`**: verificato corretto. Chi non è l'autore o un amministratore non lo riceve mai. Per i documenti pubblicati prima di M9c-2 (senza nome utente di Windows) vale ancora il nome da mostrare, come per il ritiro vero, da prima di M11.

## Limiti noti
- **A4 orizzontale** su schermi sotto i 1200 punti di larghezza (1024×600, 1366×768 al 125%, 1440×900 al 125%): si scorre in orizzontale, perché non c'è lo zoom del foglio.
- **Le prove automatiche girano su Linux**, con un Chromium simile a WebView2. ClearType, «Segoe UI» vero e le stampanti si vedono solo con le prove a mano.
- **K4** (la memoria vince sulla politica) richiede una modifica del motore: dopo M11.
- **Il piè di pagina** stampa il nome di chi usa il programma, non l'autore dell'originale delle copie adattate: per quello servirebbe un dato nuovo nel documento, dopo la v1.
