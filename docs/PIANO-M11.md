# Piano di M11: miglioramento dell'interfaccia

**Stato**: **approvato dall'utente** (piano completo, tutte le divergenze dalla specifica, risposte sotto). Non è stato ancora cambiato codice. La sezione 0 ha la precedenza su tutto quello che segue.

**In una frase**: il foglio resta com'è; tutto quello che gli sta intorno (barre, barra laterale, finestre, messaggi) diventa più ordinato, più calmo e più facile, soprattutto sui portatili da 1366 px, senza aggiungere funzioni.

**Come è stato scritto**: ho letto `SPEC.md`, i rapporti di M8, M9 e M10, tutte le istruzioni `docs/PROVE-*.md` e il codice dell'interfaccia (`ui/src/`). Poi ho aperto il programma nel browser con il motore finto delle prove automatiche e ho fatto 40 schermate, a 1366×768 e a 1920×1080. Nelle schermate i pittogrammi sono quadrati colorati: è il motore finto, non un difetto. Le schermate sono in una cartella di lavoro temporanea (elenco in fondo). Nel blocco M11-0 le stesse schermate diventano una prova automatica che si può rifare quando serve.

---

## 0. Decisioni dell'utente (valgono più del resto del documento)

1. **Piano completo**, non la versione minima.
2. **Divergenze dalla specifica approvate** (le quattro della sezione 6): barra laterale richiudibile con tre schede, stampa come scheda «Pagina», politica solo nella barra degli strumenti, «Contorna simbolo e parola» nella scheda Pagina. A fine M11 si aggiorna `SPEC.md`.
3. **Nome e segno**: «Editor CAA» con il segno proposto (quadratino sopra una riga, blu inchiostro).
4. **Dimensione dell'interfaccia regolabile** (Normale / Grande / Molto grande, il foglio non cambia): **sì**, in M11.
5. **Piè di pagina**: «il tuo nome» al posto di «l'autore» (l'autore dell'originale nelle copie adattate resta per dopo).
6. **Prova con un docente nuovo** (domanda 5): da decidere prima di M11-9 (chi, su quale PC). Non blocca l'inizio.
7. **NON TARARE SU UNA DIMENSIONE DI SCHERMO.** Il programma deve funzionare su **tutti i desktop e i portatili della scuola**, quindi su schermi molto diversi (dai portatili piccoli ai monitor grandi) e con il «ridimensionamento» di Windows dal 100% al 200%. Le cifre «1366×768» e «1280×720» di questo documento sono **solo le schermate di esempio della diagnosi**, non un obiettivo. Regole vincolanti per tutti i blocchi:
   - **Layout fluido**, mai misure fisse per l'interfaccia (unità relative, `flex`/`grid`, `min`/`max`/`clamp`, regole per larghezza **e per altezza**).
   - **Intervallo supportato**: da **1024×600** (minimo assoluto) fino a **3840×2160**, con zoom di Windows 100%, 125%, 150%, 175%, 200%.
   - **La barra degli strumenti si adatta**: le azioni meno usate passano in un menu «Altro» man mano che manca spazio (nessun a capo su due righe, nessun pulsante tagliato).
   - **La barra laterale si richiude da sola** sotto una certa larghezza (e si riapre con un clic); il foglio ha **«Adatta alla larghezza»** (predefinito) e uno zoom manuale, così A4 verticale e orizzontale si vedono interi su qualunque schermo senza barre di scorrimento orizzontali dell'interfaccia.
   - **Finestre e pannelli**: mai più alti dello schermo (scorrono dentro), mai più larghi (`max-width` in percentuale).
   - **Finestra del programma**: la dimensione iniziale si calcola dallo schermo (per esempio 85% di larghezza e altezza del monitor, mai oltre) e c'è una dimensione minima ragionevole, non una fissa di 1100×800 (D17).
   - **Prova automatica a matrice** (Playwright) in M11-0 e a ogni blocco: larghezze/altezze 1024×600, 1280×720, 1366×768, 1440×900, 1536×864, 1920×1080, 2560×1440, 3840×2160, con fattore di scala 1, 1,25, 1,5 e 2. In ogni combinazione: nessuna barra di scorrimento orizzontale della pagina, nessun elemento sovrapposto o tagliato, tutte le azioni principali raggiungibili (anche tramite «Altro»), barra degli strumenti su una riga, avvisi non oltre una frazione dell'altezza (indicativamente un quarto), foglio intero visibile con «Adatta alla larghezza». Le schermate di confronto di ogni blocco si fanno su almeno tre di queste combinazioni (piccola, media, grande).

---

## Avanzamento

### M11-0 — fatto (in attesa del via libera)

- **CSS diviso**: `ui/src/css/sheet.css` contiene tutto il foglio e la stampa (importato per ultimo); `ui/src/style.css` solo l'interfaccia. Sul foglio sono scritti carattere, dimensione, interlinea, colore, spaziature e `box-sizing`, che prima ereditava dalla radice della pagina; una regola `@page` fissa fa lo stesso per il piè di pagina di stampa (prima ereditava spaziatura e maiuscole dalla radice: trovato dalle prove «ostili»). La regola `@page` generata da `print/print.ts` non è cambiata.
- **Foglio congelato** (`tests/e2e/foglio.spec.ts`, 16 stati + 3 prove «ostili» con la radice della pagina stravolta): impronta dello stile calcolato di ogni elemento del foglio, sullo schermo e in stampa (`foglio-riferimento/impronta.json`, vale anche nella CI) e immagini al pixel del foglio e delle pagine del PDF (`foglio-riferimento/immagini-<sistema>-<impronta dei caratteri>/`, valgono solo sulla macchina che le ha fatte; altrove la parte delle immagini si salta e lo dice). Riferimenti fatti sul codice di M10, prima di dividere il CSS. Il foglio si fotografa sempre all'inizio di una «piastrella» di 256 px: spostato altrove, il browser sfuma i bordi arrotondati in modo leggermente diverso anche se il foglio è uguale.
- **Matrice degli schermi** (`tests/e2e/schermi.spec.ts`): le 19 combinazioni risoluzione × scala della sezione 0 che danno almeno 1024×600 punti; 8 controlli per schermo. I fallimenti di partenza stanno in `ATTESI` (tutti per M11-4) e contano come «attesi». «Segoe UI» nelle prove diventa Atkinson Hyperlegible, per avere lo stesso risultato su ogni macchina (non sono le misure esatte di Windows). Il caso peggiore reale degli avvisi è lessico nuovo + originale aggiornato + versione nuova: l'avviso «salvato come copia» non si somma (sparisce aprendo un documento). Oggi gli avvisi stanno sotto un quarto dell'altezza su tutti gli schermi.
- **Schermate prima/dopo** (`tests/e2e/aspetto.spec.ts`, 17 stati × 4 schermi; `scripts/confronto-ui.mjs`). Diverso dal piano: si attivano con `CAA_ASPETTO=<etichetta>` invece dell'etichetta `@aspetto`, e lo script distingue «identica», «solo rumore» (differenze di colore ≤ 2/255, che danno già due giri dello stesso codice) e «cambiata».
- **Interfaccia di prova**: `caaProto.getPrefs/setPrefs/setAuthor` (per le prove; nessun effetto per il docente). Motore finto e `open()` spostati in `tests/e2e/fixtures.ts`.
- **Esito**: 128 prove di prima + 19 del foglio + 152 della matrice verdi; confronto m10 → m11-0: 57 schermate identiche al pixel, 11 con solo rumore, 0 cambiate.
- **Dopo la prima CI**: l'impronta salva solo i valori diversi da quelli di partenza del browser (la CI ha un Chromium un po' diverso); il margine automatico che centra il foglio non conta (è interfaccia); la foto del foglio prende solo le righe intere; la CI installa `poppler-utils` (le 9 prove di stampa di M10 fallivano lì da prima).
- **Da decidere prima di M11-4**: la sezione 0 chiede «Adatta alla larghezza» e zoom del foglio, la 3.2 dice «niente zoom del foglio in M11»; la sezione 0 dice finestra all'85% dello schermo, la 3.2 «massimizzata».

### M11-1 — fatto (in attesa del via libera)

- **CSS per zone**: `css/tokens.css` (tavolozza 2.2 e misure 2.8, in rem), `css/base.css` (pulsanti, campi, selezioni, caselle, anello di fuoco 2 px staccato 2 px, `.primary`), `css/bars.css`, `css/side.css`, `css/dialogs.css`, `css/docs.css`; `style.css` tolto. Le regole di base stanno dentro `:where()` (peso zero) e `[hidden]` vince sempre (senza, i pulsanti nascosti come «Modifica…» comparivano).
- **Azioni principali** (`primary`): Stampa…, Stampa, Continua, Usa questo simbolo, Pubblica, Adatta.
- **Barra degli strumenti compatta fino a M11-4** (testo 14 px): con 15 px sugli schermi larghi 1536–1700 punti andava su due righe (la matrice l'ha visto).
- **Prove** `tests/e2e/stile.spec.ts`: coppie della tavolozza (WCAG AA), contrasto vero dei testi in 8 situazioni, anello di fuoco su ogni controllo e giro con Tab. Sul codice di M10 trovano 15 difetti (fra cui «?» a 3,54:1 e anelli da 1 px).
- **Difetto di M10 trovato** (stampa): la radice della pagina in stampa era grigia (#e8e8ec): una striscia chiara sopra il primo titolo o paragrafo e, sull'ultima pagina, tutta la parte sotto l'ultima riga. **Tolto su decisione dell'utente** (commit a parte, dopo M11-2): ogni pixel cambiato era grigio ed è diventato bianco (più i bordi sfumati che lo toccavano). L'impronta della stampa ora controlla anche lo sfondo della pagina sotto il foglio.
- **Ombra del foglio** (`.sheet`): resta quella di prima (è nel foglio), non quella più morbida del piano.

### M11-2 — fatto (in attesa del via libera)

- **Icone** `ui/src/ui/icons.ts`: 29 disegni Lucide 1.80 (ISC, citata in Informazioni) scritti nel codice, generati da `scripts/icone.mjs` (Lucide non è una dipendenza). `conIcona()` mette l'icona davanti al testo (che resta il nome del pulsante), `soloIcona()` per Annulla e Ripeti (con `aria-label`), `etichetta()` cambia il testo senza togliere l'icona (Dividi/Riunisci).
- **Dove**: Documenti, Nuovo, Annulla, Ripeti, Unisci, Dividi, Stampa…; Nessun simbolo, Solo testo, Automatico, Simbolo personale…, Simboli della scuola…, Dimentica, Dimentica tutto; Apri, Pubblica, Aggiorna in biblioteca, Elimina, Chiudi; Aggiorna, Cambia cartella, Adatta, Ritira, Invia correzioni, Butta via; Stampa (finestra), Usa questo simbolo. Indicatore della biblioteca con nuvola / nuvola barrata al posto di «● / ○». Niente icona su «Testo di esempio» e «Informazioni», che vanno nel menu «Altro» in M11-4 (e la barra a 1536 punti resta con margine: 36 px).
- **Suggerimenti** `ui/src/ui/tooltip.ts`: un solo riquadro; 400 ms con il mouse, subito con il fuoco da tastiera, Esc chiude, mai fuori dallo schermo; `aria-describedby` e `aria-keyshortcuts`. Testo da `data-tip` (con scorciatoia) o dall'attributo `title`, che si toglie solo mentre il riquadro è aperto. Sui pulsanti spenti la spiegazione (K15): Unisci, Dividi, Annulla, Ripeti.
- **Prove** `tests/e2e/icone.spec.ts` (7): nomi di tutti i pulsanti, icone accanto al testo, suggerimento da tastiera e da mouse, pulsanti spenti, `title` conservato, nessuna richiesta fuori da `localhost`.
- Pulsanti, campi e selezioni allineati al centro della riga (con l'icona andavano un po' più in alto).

### M11-3 — fatto (in attesa del via libera)

- **Finestre** `ui/src/ui/dialog.ts`: un solo comportamento per Informazioni, Stampa, Documenti, ritaglio, primo avvio e conferme. Tab e Maiusc+Tab girano dentro; il resto della pagina è `inert` finché la finestra è aperta; Esc e clic sul velo chiudono (non al primo avvio, che chiede il nome); il fuoco torna al pulsante che l'ha aperta. Da Documenti, aprendo un documento il cursore va nel testo.
- **Conferme** `ui/src/ui/confirm.ts` (K7): tutte le 15 `window.confirm` sostituite da una finestra del programma (`role="alertdialog"`) con domanda, spiegazione, «Annulla» e il verbo («Elimina», «Ritira», «Dimentica tutto», «Butta via», «Esci senza salvare», «Continua senza salvare»), rosso (`.danger`) se l'azione non si annulla; il fuoco parte da «Annulla», Esc = Annulla. La chiusura del programma con il salvataggio fallito aspetta la risposta (la pagina risponde subito a Tauri come prima).
- **Notifiche** `ui/src/ui/toast.ts` (K5, D3, D4): in basso a destra sopra il foglio, con icona; informazioni e riuscite spariscono dopo 6 s (non con il mouse sopra), avvisi ed errori restano finché si chiudono; `role="status"` / `role="alert"`. `hooks.notice(messaggio, tipo)` le usa tutte; il messaggio in fondo alla barra di stato non c'è più (il testo «Il motore non risponde» resta lì fino a M11-4).
- **Prove**: `tests/e2e/finestre.spec.ts` (12) con le finestre vere; nelle altre prove le conferme dicono «sì» da sole tramite `window.__caaConferma` (come prima la conferma del browser), `rispondiConferma(page, false)` per «Annulla». Prove esistenti aggiornate solo nei selettori (`.toasts` al posto di `.statusbar` per i messaggi), nessuna tolta.
- **Schermate**: nuovi stati «15-conferma» e «16-notifica-errore»; lo stato «09-messaggio» non selezionava le parole giuste da M11-0 (rifatto anche il «prima» sul codice di M11-2).

---

## 1. Diagnosi dell'interfaccia attuale

### 1.1 Cosa funziona già (e va tenuto)

- **Il foglio bianco WYSIWYG** (si vede come si stampa) al centro, con i simboli che compaiono mentre si scrive. È il cuore del programma e funziona.
- **La barra laterale fissa a destra** per correggere un simbolo: un clic sul simbolo, una scelta. Il percorso è breve (1 clic e 1 scelta) e la parola scelta è evidenziata in giallo sul foglio (`1366-02-alternative.png`).
- **Le scorciatoie ci sono già** (Alt+↓, 1–8, F8, Ctrl+1–4, Ctrl+P, Ctrl+Maiusc+U/D). Il problema è che quasi nessuno le vede.
- **Il salvataggio automatico** toglie al docente la paura di perdere il lavoro. «Salvato alle 16:45» in alto è chiaro.
- **I testi sono già in italiano semplice e onesti** (per esempio la spiegazione delle correzioni anonime, la nota sulle foto di studenti).
- **Le conferme prima delle azioni che non si annullano** (Elimina, Ritira, Dimentica tutto) ci sono.

### 1.2 Cosa confonde o disturba

Valuto con le dieci regole di usabilità di Nielsen (le cito con il loro nome in italiano) e pensando a un docente che usa il programma ogni giorno, su un portatile da 1366 px, con poco tempo.

| # | Problema | Dove si vede | Regola violata |
| --- | --- | --- | --- |
| D1 | **Troppe barre impilate in alto.** Con un documento adattato e un lessico nuovo ci sono cinque fasce sopra il foglio (messaggio giallo, barra del lessico, barra dell'originale, riga dei documenti, barra degli strumenti) più la barra di stato: **fino a 290 px su 768 (38% dello schermo)** non sono foglio. | `1366-10-barre.png`, `1366-10b-tutte-le-barre.png`, `1366-10c-revisione-lessico.png` | Estetica e minimalismo |
| D2 | **La barra degli strumenti va a capo su 1366 px**: due righe, «Contorna simbolo e parola» spezzato su due righe, «Molto grande» sotto gli altri tre. Sembra disordinata. | `1366-01-foglio.png` | Estetica e minimalismo |
| D3 | **Sei modi diversi di dare un messaggio**: fascia gialla in alto (che si chiude cliccando il testo), barra gialla del lessico, barra azzurra dell'originale, «pillola» della versione, testo arancione in grassetto nella barra di stato che sparisce dopo 6 secondi, finestre di conferma del sistema. Il docente non sa dove guardare. La prova 15 di M9a è fallita proprio per questo: l'avviso era in basso e nessuno l'ha visto. | `1366-09-messaggio.png`, `1366-10b-tutte-le-barre.png`, `ui/src/toolbar.ts` (`hooks.notice`), `ui/src/app.ts` (banner) | Visibilità dello stato del sistema; Coerenza |
| D4 | **Il messaggio in basso si perde**: testo piccolo, nella barra di stato, accanto al numero di parole, sparisce da solo dopo 6 secondi anche quando è un errore («Non sono riuscito a salvare il simbolo…»). | `1366-09-messaggio.png` | Visibilità dello stato; Aiutare a riconoscere gli errori |
| D5 | **La finestra Stampa copre il foglio con un velo scuro**: le impostazioni cambiano il foglio subito (carattere, maiuscolo, bordo), ma non si vede, perché il foglio è dietro il velo e dietro la finestra. L'anteprima dal vivo c'è ma è nascosta. | `1366-06-stampa.png`, `ui/src/print/dialog.ts` | Visibilità dello stato |
| D6 | **Due opzioni quasi uguali in due posti**: «Contorna simbolo e parola» (barra in alto) e «Bordo attorno a ogni simbolo» (finestra Stampa). Il docente non capisce la differenza senza provarle. | `1366-01-foglio.png`, `1366-06-stampa.png` | Coerenza; Riconoscere invece di ricordare |
| D7 | **A4 orizzontale non ci sta su 1366 px**: il foglio è largo 1123 px, lo spazio libero accanto alla barra laterale è circa 990 px. Il foglio viene tagliato a destra e serve lo scorrimento orizzontale. | `1366-14-orizzontale-grande.png` | Flessibilità |
| D8 | **«Cosa ricordo» si vede solo quando la barra laterale è vuota**: appena si clicca un simbolo sparisce. Chi cerca dove dimenticare una scelta non lo trova. | `1366-01-foglio.png` contro `1366-02-alternative.png` | Riconoscere invece di ricordare (scopribilità) |
| D9 | **Le scorciatoie sono nascoste** nei suggerimenti al passaggio del mouse (che compaiono dopo circa un secondo e non con la tastiera) e in una riga grigia da 12 px in fondo alla barra. | `1366-02-alternative.png`, `ui/src/sidebar.ts` | Flessibilità ed efficienza |
| D10 | **«Testo di esempio» è in prima fila** accanto a «Nuovo», con lo stesso peso di Annulla e Stampa, ma si usa una volta. | `1366-01-foglio.png` | Estetica e minimalismo |
| D11 | **Pulsanti tutti uguali**: «Stampa…», «Informazioni», «Elimina» e «Pubblica» hanno lo stesso aspetto. Non c'è un'azione principale evidente, e «Elimina» sta accanto ad «Apri». | `1366-04-documenti.png`, `1366-05-biblioteca.png` | Prevenzione degli errori |
| D12 | **Pulsanti spenti senza spiegazione**: «Unisci» e «Dividi» sono grigi e non dicono cosa fare per accenderli (selezionare due parole). | `1366-01-foglio.png` | Aiuto e documentazione |
| D13 | **Gergo tecnico**: «Motore attivo» nella barra di stato, «nome, prova» (la riga del perché del motore), «Parole funzionali: Completo» ripetuto in basso quando è già in alto. | `1366-01-foglio.png` | Corrispondenza con il mondo reale |
| D14 | **Il modulo Pubblica sostituisce l'elenco** senza un «Indietro» visibile; il pulsante «Pubblica» non si distingue da «Annulla»; spazi irregolari. | `1366-04b-pubblica.png` | Controllo e libertà dell'utente |
| D15 | **Simboli della scuola mostrati come etichette di testo tagliate** («mensa» tronco), con la × che si sovrappone, mescolati sulla stessa riga dei miei simboli (che invece sono immagini). | `1366-13-simboli-scuola.png` | Coerenza; Estetica |
| D16 | **Il primo avvio è una finestra con un campo e basta**; poi un documento vuoto, senza nessun suggerimento sul foglio. Il docente nuovo non sa che deve solo scrivere, né come si cambia un simbolo. | `1366-11-primo-avvio.png` | Aiuto; Stati vuoti |
| D17 | **La finestra del programma è più alta dello schermo** dei portatili: `src-tauri/tauri.conf.json` apre a 1100×800, ma lo schermo è alto 768 (meno la barra di Windows). | `src-tauri/tauri.conf.json` | Flessibilità |

### 1.3 Cosa è brutto o incoerente a vedersi

- **Caratteri misti**: la radice usa "Segoe UI", la barra laterale e le finestre `system-ui`. Le dimensioni sono 12, 12.5, 13, 14, 16, 17, 18, 19 px senza una regola (`ui/src/style.css`).
- **Colori sparsi**: almeno 6 blu, 5 grigi di bordo, 4 arancioni scritti a mano, ognuno nel suo pezzo di CSS. Non c'è una tavolozza.
- **Bordi dei controlli troppo chiari**: il grigio dei bordi dei pulsanti (#9a9aa8 su bianco) ha contrasto **2,78:1**; la regola di accessibilità (WCAG 1.4.11) chiede almeno 3:1 per capire dov'è un controllo.
- **Spaziature a caso**: 4, 5, 6, 7, 8, 9, 10, 12, 14 px; ogni finestra ha margini suoi (`1366-04b-pubblica.png`: titolo con margini enormi, campi attaccati).
- **Ombre e raggi diversi** fra finestra Documenti (10 px), Stampa (8 px), Informazioni (8 px), ritaglio (10 px), tabella Personalizzato (8 px).
- **Simboli Unicode al posto delle icone** («● Biblioteca», «○ Biblioteca non raggiungibile», «×»): lo stato si capisce solo dal colore.
- **Nessuna identità**: il programma non ha nome né segno visibile nella finestra; sembra un modulo di prova.

### 1.4 Accessibilità: cosa ho verificato

| Controllo | Esito | Come l'ho visto |
| --- | --- | --- |
| Tab dentro una finestra (Stampa, Documenti, Informazioni) | **Esce dalla finestra** e va sui pulsanti dietro il velo | prova con Playwright: dopo «Chiudi» il Tab passa a «Documenti», «Nuovo»… |
| Il fuoco torna al pulsante che ha aperto la finestra | No: torna al foglio o a nessuno | codice di `about.ts`, `print/dialog.ts`, `docs/panel.ts` |
| Contatore «parole da controllare» con la tastiera | **No**: è uno `span` con `role="button"` ma senza `tabindex` né Invio | `ui/src/toolbar.ts` |
| Messaggi letti dai lettori di schermo | **No**: il messaggio in basso non ha `aria-live` | `ui/src/toolbar.ts` |
| Fascia gialla chiudibile | Si chiude cliccando un `div`, non un pulsante; non si chiude da tastiera | `ui/src/app.ts` |
| Tabella «Personalizzato» | Esc non la chiude; il fuoco non entra | `ui/src/toolbar.ts` |
| Contrasto del testo | Buono quasi ovunque (testo secondario 7,1:1); punto debole il «?» dei simboli mancanti (3,5:1) e i bordi (2,8:1) | calcolo dei colori del CSS |
| Contorno di fuoco visibile | Solo quello predefinito del browser, sottile e diverso da un controllo all'altro | schermate |
| Dimensione del testo dell'interfaccia | Fissa a 14 px, non si può ingrandire | `ui/src/style.css` |
| Conferme | Finestre del sistema (`window.confirm`, 15 punti nel codice): pulsanti generici OK/Annulla, di solito un titolo tecnico, aspetto diverso dal programma | `grep confirm ui/src` |

---

## 2. Direzione estetica

### 2.1 Il tono

**Calmo, ordinato, amichevole, da scuola ma non infantile.** Penso a un buon quaderno o a una sala insegnanti luminosa, non a un videogioco: i colori forti li portano già i pittogrammi ARASAAC, quindi l'interfaccia deve stare un passo indietro e lasciarli emergere. Fondo caldo color carta, un solo colore principale (un blu inchiostro), angoli morbidi, ombre leggere, testo grande abbastanza da leggere senza sforzo.

**Regola d'oro: il foglio non si tocca.** Tutto quello che c'è dentro `.sheet` (testo, simboli, segni ◀ ▶ +, evidenziazione gialla della parola, onda arancione, riquadro tratteggiato) resta identico, a schermo e in stampa. Il primo blocco (M11-0) mette una prova automatica che se ne accorge al primo pixel cambiato.

**Tema chiaro solo.** Il tema scuro non lo propongo: il foglio deve restare bianco (è quello che si stampa), e un foglio bianco circondato da barre scure abbaglia; raddoppierebbe anche le prove su Windows. Se servirà, i colori come variabili (sotto) lo rendono possibile più avanti.

### 2.2 Tavolozza (contrasto verificato)

Ogni coppia testo/sfondo usata rispetta WCAG AA: almeno **4,5:1** per il testo normale, **3:1** per bordi dei controlli e testo grande. I numeri li ho calcolati.

| Ruolo | Colore | Su che cosa | Contrasto |
| --- | --- | --- | --- |
| Testo principale | `#1C1C1A` | barre `#F6F5F1` | 15,7:1 |
| Testo secondario | `#5C5B55` | bianco / barre | 6,8:1 / 6,2:1 |
| Testo terziario (date, note) | `#6B6A63` | barre | 5,0:1 |
| Bordo dei controlli | `#807F77` | barre / bianco | 3,7:1 / 4,0:1 |
| Principale (pulsante pieno) | bianco su `#2456B3` | | 6,9:1 |
| Principale premuto / scelta attiva | `#1B4489` su `#D5E3F8` | | 7,2:1 |
| Contorno di fuoco | `#1B4489` | bianco | 9,4:1 |
| Da controllare (arancione) | `#B35400` | bianco / barre | 5,0:1 / 4,6:1 |
| Tutto bene (verde) | `#1E6B3A` su `#E6F4EA` | | 5,7:1 |
| Avviso (giallo) | `#7A4100` su `#FFF3D1` | | 7,4:1 |
| Errore (rosso) | `#B42318` su `#FDECEA`; bianco su `#B42318` | | 5,8:1; 6,6:1 |

La «scrivania» attorno al foglio passa da grigio freddo (`#e8e8ec`) a grigio caldo (`#E9E8E2`) con un'ombra più morbida: il foglio bianco risalta e l'insieme è meno da ufficio.

### 2.3 Caratteri

- **Testo dell'interfaccia: il carattere di sistema** (Segoe UI Variable su Windows 11, Segoe UI su Windows 10). È compatto (importante su 1366 px), nitidissimo con ClearType ed è quello che il docente conosce da Word. Niente da scaricare.
- **Titoli di finestre e pannelli, e nome del programma: Lexend grassetto** (già incorporato per la stampa, licenza SIL OFL). Dà una voce amichevole e riconoscibile senza costare spazio nei pulsanti.
- **Atkinson Hyperlegible** resta una scelta del foglio (finestra Stampa); non lo uso nell'interfaccia perché è più largo e la barra su 1366 px non ci starebbe.
- **Attenzione tecnica**: oggi il foglio prende il carattere «Normale» dalla radice della pagina. Prima di cambiare la radice, M11-0 scrive il carattere del foglio direttamente su `.sheet`, così cambiare l'interfaccia non sposta neanche una parola sul foglio.
- **Dimensioni**: testo normale 15 px, piccolo 13 px, **mai sotto 12 px**; titoli 18 e 22 px. Tutto in `rem` (unità che segue la dimensione scelta dall'utente, vedi 3.7), il foglio resta in px.

### 2.4 Spaziatura, raggi, ombre

- **Spaziatura su una griglia di 4 px**: 4, 8, 12, 16, 24, 32. Dentro un pulsante 8×12; fra controlli vicini 8; fra gruppi 16 o un separatore sottile.
- **Raggi**: 6 px per pulsanti e campi, 10 px per schede e celle della griglia, 14 px per le finestre, rotondo per le etichette («chip»).
- **Ombre**: tre livelli (leggera per il foglio e le schede, media per i menu, forte per le finestre).
- **Altezze**: pulsanti 32 px (bersaglio comodo anche col touchpad), campi 32 px, intestazione 48 px, barra degli strumenti 44 px, barra di stato 28 px.

### 2.5 Icone

**Sì, ma sempre con il testo accanto**, tranne per Annulla e Ripeti (frecce che tutti conoscono, con suggerimento e nome per i lettori di schermo). L'icona aiuta a ritrovare il pulsante a colpo d'occhio; il testo evita di dover indovinare.

- Circa 30 icone **SVG scritte dentro il codice** (`ui/src/ui/icons.ts`), nessuna libreria da installare e niente da scaricare.
- Stile unico: griglia 24×24, tratto 1,75, estremità arrotondate, colore del testo. Prendo i disegni dal set **Lucide** (licenza ISC, libera: basta citarla in Informazioni) copiando solo le icone che servono.
- Elenco: documenti (cartella), nuovo, stampa, annulla, ripeti, unisci, dividi, dimensione simbolo (quadrati crescenti), parole funzionali, biblioteca, Drive collegato, Drive non raggiungibile, salvato, salvataggio in corso, avviso, informazione, errore, chiudi, cerca, altro (tre puntini), aiuto, tastiera, immagine (simbolo personale), scuola, ricorda, elimina, adatta (copia), pubblica, ritira (archivio), parola da controllare (bandierina), apri/chiudi pannello.

### 2.6 Stati dei controlli

| Stato | Pulsante secondario (il più comune) | Pulsante principale |
| --- | --- | --- |
| Normale | fondo bianco, bordo `#807F77`, testo scuro | fondo `#2456B3`, testo bianco |
| Sopra (mouse) | fondo `#EAF1FC`, bordo `#2456B3` | fondo `#1B4489` |
| Premuto | fondo `#D5E3F8`, leggermente più basso (1 px) | fondo `#14336A` |
| Attivo (scelta accesa, es. «Medio») | fondo `#D5E3F8`, bordo e testo `#1B4489`, spunta | — |
| Disattivato | fondo `#F6F5F1`, testo `#A9A8A0`, cursore normale, **suggerimento che spiega perché** | uguale |
| Fuoco da tastiera | **anello blu scuro 2 px staccato di 2 px**, uguale su tutti i controlli; solo con la tastiera (`:focus-visible`), non con il clic | uguale |

### 2.7 Componenti riusabili

Ogni componente ha una classe CSS e, se serve, una piccola funzione TypeScript. Tutte le finestre e i pannelli del programma si costruiscono con questi pezzi, niente più stili scritti a mano per ogni finestra.

| Componente | Uso | Note |
| --- | --- | --- |
| Pulsante principale `.btn.primary` | una sola azione principale per area: Stampa, Pubblica, Usa questo simbolo, Adatta, Continua | |
| Pulsante secondario `.btn` | tutto il resto | |
| Pulsante pericoloso `.btn.danger` | Elimina, Ritira, Dimentica tutto (solo dentro le conferme o i menu) | rosso solo qui |
| Pulsante solo icona `.btn.icon` | Annulla, Ripeti, Chiudi, Altro | nome obbligatorio (`aria-label`) |
| Gruppo a scelta unica `.segmented` | dimensione dei simboli, testo sopra/sotto | un solo pulsante acceso |
| Interruttore `.switch` | opzioni sì/no immediate: Contorni, Una frase per riga, Raccogli le correzioni | è una casella con un aspetto più chiaro |
| Casella `.check` | scelte dentro un elenco: «usa per tutto il testo», «ricorda per sempre», piè di pagina | |
| Selezione `.select` | Parole funzionali, Carattere, Foglio | freccia disegnata, altezza 32 |
| Campo `.field` | titolo, ricerca, nome, percorso | etichetta sopra, errore sotto in rosso |
| Finestra `.dialog` | Documenti, Primo avvio, Informazioni, Ritaglio, Conferma | vedi 3.4 |
| Notifica `.toast` | messaggi brevi | vedi 3.3 |
| Fascia del documento `.strip` | lessico nuovo, originale aggiornato, sola lettura | vedi 3.3 |
| Schede `.tabs` | Documenti / Biblioteca / Correzioni; Simbolo / Pagina / Memoria | frecce ← → fra le schede |
| Riga di elenco `.row` | documenti, biblioteca, Cosa ricordo | titolo, dettagli grigi, azione principale a destra, «⋯» per le altre |
| Etichetta `.chip` | «copia», «in biblioteca (rev. 2)», etichette, «copia in conflitto» | colore per tipo, mai solo colore: sempre testo |
| Menu `.menu` | «Altro» in alto, «⋯» delle righe | si apre con clic, Invio o ↓; Esc chiude |
| Suggerimento `.tip` | nome e scorciatoia dei pulsanti | compare dopo 400 ms al passaggio del mouse **e subito con il fuoco da tastiera** |
| Stato vuoto `.empty` | elenchi vuoti, barra laterale senza parola, foglio vuoto | icona, una frase, un'azione |

### 2.8 Variabili CSS pronte da usare

```css
/* ui/src/css/tokens.css — valori di M11. Il foglio (.sheet) non usa queste variabili. */
:root {
  /* Neutri caldi (carta) */
  --n-0: #FFFFFF;
  --n-25: #FBFAF7;   /* pannelli e finestre secondarie */
  --n-50: #F6F5F1;   /* barre */
  --n-100: #E9E8E2;  /* scrivania attorno al foglio */
  --n-200: #DFDDD5;  /* separatori */
  --n-400: #807F77;  /* bordi dei controlli (>= 3:1) */
  --n-500: #A9A8A0;  /* testo disattivato */
  --n-600: #6B6A63;  /* testo terziario */
  --n-700: #5C5B55;  /* testo secondario */
  --n-900: #1C1C1A;  /* testo */

  /* Principale: blu inchiostro */
  --p-50: #EAF1FC;
  --p-100: #D5E3F8;
  --p-200: #AFC8EF;
  --p-600: #2456B3;
  --p-700: #1B4489;
  --p-800: #14336A;

  /* Stati */
  --ok-fg: #1E6B3A;     --ok-bg: #E6F4EA;     --ok-line: #9CCFAE;
  --warn-fg: #7A4100;   --warn-bg: #FFF3D1;   --warn-line: #E8C35A;
  --err-fg: #B42318;    --err-bg: #FDECEA;    --err-line: #F1A9A2;
  --doubt-fg: #B35400;  --doubt-bg: #FFF1E0;

  /* Ruoli (usare questi nei componenti) */
  --c-text: var(--n-900);
  --c-text-2: var(--n-700);
  --c-text-3: var(--n-600);
  --c-text-off: var(--n-500);
  --c-bar: var(--n-50);
  --c-surface: var(--n-0);
  --c-panel: var(--n-25);
  --c-desk: var(--n-100);
  --c-line: var(--n-200);
  --c-control-line: var(--n-400);
  --c-accent: var(--p-600);
  --c-accent-hover: var(--p-700);
  --c-accent-press: var(--p-800);
  --c-accent-soft: var(--p-50);
  --c-selected: var(--p-100);
  --c-focus: var(--p-700);

  /* Caratteri */
  --f-ui: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --f-title: "Lexend", "Segoe UI", system-ui, sans-serif;
  --fs-xs: 0.75rem;    /* 12 px: solo scorciatoie e numeri piccoli */
  --fs-sm: 0.8125rem;  /* 13 px */
  --fs-md: 0.9375rem;  /* 15 px: testo normale */
  --fs-lg: 1.125rem;   /* 18 px: titoli di sezione */
  --fs-xl: 1.375rem;   /* 22 px: titoli di finestra */
  --lh: 1.45;

  /* Spaziatura (griglia di 4 px) */
  --s-1: 0.25rem; --s-2: 0.5rem; --s-3: 0.75rem; --s-4: 1rem; --s-6: 1.5rem; --s-8: 2rem;

  /* Raggi */
  --r-sm: 6px; --r-md: 10px; --r-lg: 14px; --r-pill: 999px;

  /* Ombre */
  --sh-1: 0 1px 2px rgb(28 28 26 / 0.08), 0 1px 4px rgb(28 28 26 / 0.06);
  --sh-2: 0 4px 12px rgb(28 28 26 / 0.12);
  --sh-3: 0 12px 40px rgb(28 28 26 / 0.22);
  --sh-sheet: 0 1px 3px rgb(28 28 26 / 0.10), 0 6px 24px rgb(28 28 26 / 0.08);

  /* Misure */
  --h-control: 2rem;    /* 32 px */
  --h-header: 3rem;     /* 48 px */
  --h-toolbar: 2.75rem; /* 44 px */
  --h-status: 1.75rem;  /* 28 px */
  --w-side: 20rem;      /* 320 px */
  --w-side-closed: 2.75rem;

  /* Fuoco */
  --focus-ring: 0 0 0 2px var(--n-0), 0 0 0 4px var(--c-focus);

  /* Movimento: breve, e nullo per chi lo ha chiesto a Windows */
  --t-fast: 120ms;
}
@media (prefers-reduced-motion: reduce) { :root { --t-fast: 0ms; } }
```

---

## 3. Struttura e usabilità

### 3.1 La nuova disposizione (1366×768)

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [segno] Editor CAA │ [cartella] Documenti  [+] Nuovo │ La storia del gatto Pepe   [v] Salvato │
│                                              [nuvola] Biblioteca   [stampante] Stampa   [...] │  48 px  INTESTAZIONE
├──────────────────────────────────────────────────────────────────────────────────────┤
│ [<-] [->] │ Unisci  Dividi │ Simboli [▫][□][■][█] │ Parole funzionali [Completo v] Modifica… │  44 px  STRUMENTI
├──────────────────────────────────────────────────────────────────────────────────────┤
│ [!] Il lessico è aggiornato: cambierebbe 2 simboli.  [Rivedi] [Applica tutti] [Mantieni] │  solo se serve
├─────────────────────────────────────────────────────────────┬────────────────────────┤
│                                                             │ Simbolo│Pagina│Memoria [>]│
│                    FOGLIO A4  (identico a oggi)             │                        │
│                                                             │  BARRA LATERALE 320 px │
│                                                             │  (si riduce a 44 px)   │
│                                     ┌──────────────────────┐│                        │
│                                     │ notifica breve    [x]││                        │
│                                     └──────────────────────┘│                        │
├─────────────────────────────────────────────────────────────┴────────────────────────┤
│ [bandierina] 3 parole da controllare  F8          55 parole                           │  28 px  STATO
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Senza avvisi l'interfaccia occupa 120 px in altezza invece di 137, e su una riga sola invece di due. Con due avvisi del documento al massimo 200 px invece di 290.**

| Area | Cosa c'è | Cosa cambia rispetto a oggi |
| --- | --- | --- |
| **Intestazione** (sempre) | nome del programma; Documenti; Nuovo; titolo modificabile; stato del salvataggio; indicatore Biblioteca (icona + parola, mai solo colore); **Stampa** come unico pulsante principale; menu **Altro** | unisce la riga dei documenti e i pulsanti «di file». «Informazioni» e «Testo di esempio» vanno in **Altro**, insieme a «Scorciatoie da tastiera» e «Dimensione dell'interfaccia». L'avviso «È disponibile la versione X» diventa un pallino su Altro e una voce del menu (serve al tecnico, non al docente mentre scrive). |
| **Strumenti** (sempre) | Annulla, Ripeti; Unisci, Dividi/Riunisci; dimensione dei simboli; parole funzionali | una riga sola anche a 1280 px. «Contorna simbolo e parola» va nel pannello **Pagina** accanto a «Bordo attorno a ogni simbolo», con una piccola figura che mostra la differenza (D6). |
| **Fascia del documento** (solo se serve) | avvisi che riguardano il documento aperto e chiedono una decisione | sostituisce fascia gialla, barra del lessico e barra dell'originale (3.3) |
| **Foglio** | invariato | la scrivania attorno ha il colore caldo e l'ombra nuova |
| **Barra laterale** | schede **Simbolo** (le alternative, come oggi), **Pagina** (le impostazioni di stampa, oggi in una finestra), **Memoria** («Cosa ricordo» e «I miei simboli» da gestire) | si chiude a una striscia di 44 px con il pulsante [>] e si riapre da sola quando si clicca un simbolo, con Alt+↓, F8 o Ctrl+P |
| **Barra di stato** | parole da controllare (vero pulsante, raggiungibile con Tab), numero di parole | via «Motore attivo» (si dice solo se c'è un problema, con una notifica) e via la politica ripetuta |

### 3.2 Il foglio su 1366×768 (e sui portatili con lo schermo ingrandito)

Molti portatili da 1920 px hanno Windows con il «ridimensionamento» al 150%: per il programma lo schermo è **1280×720**. (Vale la sezione 0, punto 7: non si progetta per una misura sola; quello che segue è un esempio.) Quindi progetto per **1280×720 come minimo**, non solo per 1366×768.

- **A4 verticale (794 px)**: ci sta sempre con la barra laterale aperta (794 + 320 + margini = 1150 px).
- **A4 orizzontale (1123 px)**: non ci sta con la barra aperta. Decisione: **quando il foglio non entra, la barra laterale parte chiusa** (striscia da 44 px) e quando si apre si appoggia sopra la scrivania con un'ombra, senza spingere il foglio; la parola scelta resta visibile perché il foglio scorre fino a lei. Si richiude con Esc o con [>].
- **Niente zoom del foglio in M11.** Ridurre il foglio sullo schermo cambierebbe le misure che usano cursore, clic sul simbolo e selezione (le prove di M3 che hanno deciso la resa A). È un rischio alto per un guadagno piccolo; lo segno come idea per dopo il pilota.
- **La finestra del programma** si apre **massimizzata**, con misura minima 1024×640 (oggi 1100×800, più alta dello schermo: D17).

### 3.3 Un solo sistema per messaggi e avvisi

Quattro tipi, ognuno con il suo posto. Il docente impara una volta dove guardare.

| Tipo | Quando | Dove | Resta? | Esempi |
| --- | --- | --- | --- | --- |
| **Notifica breve** (informazione o riuscita) | è successo qualcosa di bello o neutro | riquadro in basso a destra sopra il foglio, con icona | sparisce da sola dopo 6 s; resta finché il mouse ci è sopra; si chiude con × | «Simbolo condiviso con la scuola», «Pubblicato in biblioteca (revisione 1)», «Inviate 12 correzioni. Grazie!» |
| **Notifica di problema** (avviso o errore) | qualcosa non è riuscito o va saputo | stesso posto, bordo e icona gialla o rossa | **resta finché non si chiude**; ha un'azione se c'è («Riprova») | «Non sono riuscito a salvare il simbolo: …», «Seleziona due o più parole della stessa frase», «Il motore non risponde: riprovo…» |
| **Fascia del documento** | il documento aperto è in uno stato speciale e serve una decisione | sotto la barra degli strumenti, sopra il foglio; al massimo **due**, la più importante sopra | finché la situazione dura o si sceglie | lessico nuovo (Rivedi / Applica tutti / Mantieni), originale aggiornato (Apri l'originale / Ignora), stai guardando l'originale (Torna alla mia copia), sola lettura, **salvato come copia per un conflitto** (oggi fascia gialla da cliccare) |
| **Conferma** | prima di un'azione che non si annulla | finestra al centro, con il velo | finché non si sceglie | «Eliminare "La storia del gatto Pepe"? Non si può annullare.» con **[Elimina]** rosso e **[Annulla]**; Esc = Annulla |

Regole per i testi: prima cosa è successo, poi cosa fare; i pulsanti dicono il verbo («Elimina», «Ritira», «Dimentica»), mai «OK». Gli errori tecnici del programma (`String(e)`) vanno dopo, in grigio, perché servono a chi assiste.

Gli **indicatori fissi** (salvataggio, Biblioteca, parole da controllare) non sono messaggi: stanno nell'intestazione e nella barra di stato, cambiano parola e icona, non lampeggiano.

I lettori di schermo leggono le notifiche brevi con `role="status"` e quelle di problema con `role="alert"`.

### 3.4 Finestre: un solo comportamento

Tutte le finestre (Documenti, Primo avvio, Informazioni, Ritaglio, Conferma, Scorciatoie) usano lo stesso componente:

- titolo in Lexend, × in alto a destra, azioni in basso a destra con la principale per ultima;
- **il Tab gira dentro la finestra**, Esc chiude (tranne il primo avvio, che chiede il nome), alla chiusura **il fuoco torna al pulsante che l'ha aperta**;
- il fuoco entra sul primo campo o sull'azione principale;
- misura: Documenti fino a 880 px di larghezza (oggi 640, troppo stretta per le righe della biblioteca), le altre 480 px.

La finestra Stampa **non è più una finestra**: diventa la scheda **Pagina** della barra laterale, così le modifiche si vedono sul foglio mentre si fanno (D5). In fondo alla scheda c'è il pulsante principale **Stampa…**. Ctrl+P apre la scheda con il fuoco su «Stampa…»; un secondo Invio stampa. La tabella «Personalizzato» diventa un riquadro a comparsa che si chiude con Esc e con un clic fuori.

### 3.5 Primo avvio e primi minuti

Obiettivo (criterio di M11): un docente che non ha mai visto il programma **scrive e stampa una storia senza aiuto**.

1. **Benvenuto** (finestra): segno e nome del programma, una frase su cosa fa, il campo del nome con la spiegazione già presente, «Continua». Non chiedo altro (la specifica dice: solo il nome).
2. **Foglio vuoto con un invito**, sopra il foglio ma non dentro (quindi non si stampa e non cambia il documento): «Scrivi qui il tuo testo: i simboli compaiono da soli sopra le parole.» e, sotto, tre suggerimenti con piccole figure: *clic sul simbolo per cambiarlo*; *le parole sottolineate in arancione sono da controllare (F8)*; *quando hai finito: Stampa, in alto a destra*. Un collegamento «Prova con un testo di esempio». L'invito sparisce alla prima lettera e torna solo con un documento vuoto.
3. **Barra laterale vuota** con lo stesso stile: «Clicca il simbolo di una parola per cambiarlo» e le scorciatoie scritte come tasti (Alt+↓, F8).
4. **Primo clic su un simbolo**: niente di nuovo, ma le scorciatoie 1–8 sono scritte come numeri sulle celle (già c'è) e la riga in fondo è leggibile (13 px).
5. **Prima stampa**: la scheda Pagina si apre accanto al foglio; i valori di partenza vanno già bene, quindi basta «Stampa…».

### 3.6 Stati vuoti

| Dove | Oggi | Dopo |
| --- | --- | --- |
| Foglio nuovo | bianco | invito (3.5) |
| I miei documenti | «Nessun documento salvato. Scrivi qualcosa…» | icona cartella, stessa frase, pulsante «Nuovo documento» |
| Biblioteca vuota | «La biblioteca è vuota.» | «Nessun documento in biblioteca. Pubblica un tuo documento da "I miei documenti" perché i colleghi possano adattarlo.» |
| Biblioteca non collegata | testo tecnico con percorso e «Crea la biblioteca qui» sullo stesso piano | sopra: «La biblioteca della scuola non è collegata. Chiedi al referente o scegli una cartella trovata.»; le cartelle trovate con «Usa questa»; **sotto, chiuso**: «Per chi imposta la biblioteca» con percorso a mano e «Crea la biblioteca qui» (evita che un docente crei per sbaglio una biblioteca vuota) |
| Ricerca senza risultati | «Nessun documento corrisponde alla ricerca.» | uguale, con «Cancella la ricerca» |
| Memoria | non c'è la scheda | «Non ricordo ancora nessuna scelta. Quando correggi un simbolo, spunta "ricorda per sempre".» |
| Correzioni | «Nessuna correzione in attesa.» | uguale, con la spiegazione sempre visibile |

### 3.7 Scorciatoie visibili

- Ogni pulsante con scorciatoia la mostra nel **suggerimento** («Annulla · Ctrl+Z»), anche con il fuoco da tastiera; i pulsanti hanno `aria-keyshortcuts`.
- **F1** (e Altro → «Scorciatoie da tastiera») apre una finestra con tutte le scorciatoie divise per «Scrivere», «Correggere un simbolo», «Documento e stampa». Scritte come tasti: [Ctrl] [P].
- Nelle celle della barra laterale i numeri 1–8 restano.

### 3.8 Accessibilità

- **Tastiera**: tutto si raggiunge con Tab in un ordine che segue lo schermo (intestazione → strumenti → foglio → barra laterale → barra di stato); fra le schede si passa con ← →; i menu si aprono con Invio o ↓. Un collegamento nascosto «Vai al testo» è il primo elemento.
- **Fuoco sempre visibile**: anello unico (2.6).
- **Nomi per i lettori di schermo**: ogni pulsante solo icona ha `aria-label`; zone con i ruoli giusti (`header`, `main`, `aside`, `footer`); le notifiche come in 3.3; la fascia del documento `role="region"` con nome.
- **Dimensione del testo dell'interfaccia**: Altro → «Dimensione dell'interfaccia»: Normale (15 px), Grande (17 px), Molto grande (19 px). Ingrandisce barre, barra laterale e finestre; **il foglio no** (le sue misure sono quelle della stampa). Si ricorda sul computer. È possibile perché tutto l'interfaccia usa `rem`.
- **Contrasto**: tavolozza 2.2, controllata da una prova automatica.
- **Movimento**: animazioni brevissime e nulle se Windows chiede di ridurle.

### 3.9 I due flussi principali

**A. Scrivere → correggere un simbolo → stampare** (oggi funziona, va solo reso evidente)

1. Scrivo. I simboli arrivano. In basso «3 parole da controllare» con la bandierina arancione.
2. Premo F8 o clicco il contatore: il foglio va alla parola, la barra laterale (scheda Simbolo) si apre se era chiusa.
3. Clic su un'alternativa (o 1–8): il simbolo cambia, il contatore scende. Una notifica? No: il cambiamento sul foglio basta (niente rumore).
4. «Stampa» in alto a destra: la barra laterale passa a Pagina, il foglio resta visibile e cambia dal vivo. «Stampa…» apre il dialogo di Windows.

**B. Biblioteca: adattare e pubblicare**

1. Documenti → scheda Biblioteca: elenco con ricerca e filtri; su ogni riga **Adatta** (principale). «Ritira» solo per chi ne ha davvero il permesso, dentro il menu «⋯» e con conferma.
2. «Adatta» apre la copia e chiude la finestra; notifica «Hai una tua copia di "Le frazioni". L'originale non cambia.»
3. Per pubblicare: I miei documenti → riga → «⋯» → **Pubblica…** (o «Aggiorna in biblioteca»): il modulo si apre come sotto-pagina con «← Indietro», campi allineati, **Pubblica** principale; dopo, notifica di riuscita e la riga mostra l'etichetta «in biblioteca (rev. 1)».

### 3.10 Testi da semplificare (esempi)

| Oggi | Dopo |
| --- | --- |
| Motore attivo / Motore non attivo | (niente) / notifica «I simboli non sono disponibili: … Chiudi e riapri il programma; se continua, chiama il tecnico.» |
| Contorna simbolo e parola | Riquadro attorno a simbolo e parola |
| Bordo attorno a ogni simbolo | Bordo attorno al solo simbolo |
| Piè di pagina: l'autore | Piè di pagina: il tuo nome («Maria Rossi») |
| (Clicca qui per chiudere.) dentro il testo | pulsante × |
| ○ Biblioteca non raggiungibile | [nuvola barrata] Biblioteca non raggiungibile |
| Butta via | Cancella senza inviare |
| 1–8 sceglie · Esc torna al testo · F8 prossima… | [1]–[8] scegli · [Esc] torna al testo · [F8] prossima parola da controllare |

---

## 4. Difetti noti da sistemare

Per ogni difetto: prima la prova automatica che lo mostra, poi la correzione (regola del progetto).

| # | Difetto | Dove | Correzione proposta | Blocco |
| --- | --- | --- | --- | --- |
| K1 | **«Ritira» dei documenti compare in base al nome da mostrare**, ma il permesso vero lo decide il programma con il nome utente di Windows: un omonimo vede il pulsante e poi riceve un errore. | `ui/src/docs/library.ts` (`sameName(e.author, status.display_name)`) | il programma (lato Rust, `caa-lib` + `src-tauri`) calcola `can_retire` per ogni documento, come già fa per i simboli della scuola; l'interfaccia mostra «Ritira» solo se è vero. Cambia solo il dato passato all'interfaccia, **non il formato dei file**. | M11-6 |
| K2 | **«Autore» nel piè di pagina è chi usa il programma**, non l'autore dell'originale della biblioteca. | `ui/src/print/dialog.ts`, `ui/src/toolbar.ts` (`setAuthor`) | la casella dice la verità: «il tuo nome («Maria Rossi»)». Stampare l'autore dell'originale richiederebbe un dato che la copia non conserva: fuori da M11. **La stampa non cambia aspetto.** | M11-5 |
| K3 | **Ctrl+Y su Windows non funzionava** (M8b), mai riprodotto. Il tasto è collegato solo quando il fuoco è nel foglio; se il fuoco è sulla barra laterale o su un pulsante, Ctrl+Y e Ctrl+Z non fanno niente. | `ui/src/editor/editor.ts` (keymap) | un unico ascoltatore a livello di pagina per Ctrl+Z, Ctrl+Y, Ctrl+Maiusc+Z quando il fuoco **non** è in un campo di testo; più una riga nel registro di prova Windows per vedere se il tasto arriva (come previsto in M8b). | M11-4 |
| K4 | **Una voce di «Cosa ricordo» mostra il simbolo anche dove la politica dice «solo testo».** La causa è nel motore (la memoria vince sulla politica): **il motore non si tocca in M11**. | motore (`UserMemory`) | lato interfaccia: «ricorda per sempre» spento, con spiegazione, per le categorie governate dalla politica (articoli, clitici, «che», preposizioni, congiunzioni); in Memoria quelle voci già salvate hanno l'etichetta «la politica può nasconderla». La correzione vera va segnalata per una modifica del motore dopo M11. | M11-7 |
| K5 | **I messaggi in basso si perdono** (D4): testo piccolo nella barra di stato, sparisce dopo 6 s anche per gli errori. | `ui/src/toolbar.ts` (`hooks.notice`) | sistema di notifiche (3.3) | M11-3 |
| K6 | **Il Tab esce dalle finestre** e il fuoco non torna dove era. | `about.ts`, `print/dialog.ts`, `docs/panel.ts`, `customDialog.ts`, `docs/firstrun.ts` | componente finestra unico (3.4) | M11-3 |
| K7 | **Conferme con le finestre del sistema** (15 `window.confirm`): pulsanti OK/Annulla generici, aspetto estraneo. | `app.ts`, `docs/panel.ts`, `docs/library.ts`, `sidebar.ts`, `docs/session.ts` | finestra di conferma del programma con il verbo sul pulsante | M11-3 |
| K8 | **Il contatore «parole da controllare» non si raggiunge con la tastiera.** | `ui/src/toolbar.ts` | vero `<button>` | M11-4 |
| K9 | **La fascia gialla si chiude solo cliccando il testo**, e i messaggi importanti (conflitto) dicono «Clicca qui per chiudere». | `ui/src/app.ts`, `ui/src/docs/session.ts` | fascia del documento con × | M11-4 |
| K10 | **La tabella «Personalizzato» non si chiude con Esc** e copre la barra laterale. | `ui/src/toolbar.ts` | riquadro a comparsa con Esc, clic fuori, fuoco dentro | M11-4 |
| K11 | **A4 orizzontale tagliato su 1366 px** (D7). | `ui/src/style.css` | barra laterale richiudibile (3.2) | M11-4 |
| K12 | **Finestra iniziale più alta dello schermo** (D17). | `src-tauri/tauri.conf.json` | massimizzata, minimo 1024×640 | M11-4 |
| K13 | **Bordi dei controlli sotto 3:1** e «?» dei simboli mancanti nella griglia a 3,5:1. | `ui/src/style.css` | tavolozza | M11-1 |
| K14 | **Simboli della scuola come etichette tagliate** con la × sovrapposta (D15). | `ui/src/sidebar.ts` | etichette («chip») intere su righe proprie, × come pulsante distinto con nome; le miniature richiederebbero di leggere le immagini dal Drive: fuori da M11 | M11-7 |
| K15 | **«Unisci» e «Dividi» spenti senza spiegazione** (D12). | `ui/src/toolbar.ts` | suggerimento anche sul pulsante spento («Seleziona due o più parole della stessa frase») | M11-2 |
| K16 | **Il titolo resta «Senza titolo»** per qualche secondo anche se la prima riga è scritta (finché non c'è il primo salvataggio). | `ui/src/docs/session.ts` | il segnaposto mostra subito la prima riga in grigio | M11-8 |
| K17 | **«Pubblica» senza «Indietro»** e senza azione principale evidente (D14). | `ui/src/docs/panel.ts` | sotto-pagina con «← Indietro» | M11-6 |
| K18 | **«Informazioni»: la voce «Pittogrammi» ripete «Pittogrammi:»** nel testo. | `ui/src/about.ts` | togliere la ripetizione (il testo dell'attribuzione stampata resta identico) | M11-8 |

---

## 5. Divisione in blocchi

Ordine: **rete di sicurezza → fondamenta del design → infrastruttura comune → struttura → finestre e pannelli → primi minuti → rifinitura**. Ogni blocco si chiude con le prove automatiche verdi, le schermate prima/dopo e le prove a mano su Windows elencate.

### M11-0 — Rete di sicurezza e foglio «congelato»

- **Obiettivo**: poter cambiare tutto attorno al foglio sapendo subito se il foglio o la stampa cambiano anche di un pixel; avere le schermate «prima».
- **File**: `ui/src/style.css` → separato in `ui/src/css/sheet.css` (tutto ciò che riguarda `.sheet`, `.w`, `@media print`, con il carattere scritto direttamente sul foglio) e il resto; `ui/src/main.ts` (import); nuovo `tests/e2e/aspetto.spec.ts` (etichetta `@aspetto`); nuovo `scripts/confronto-ui.mjs` (pagina HTML con le schermate prima/dopo affiancate).
- **Accettazione**: le 128 prove esistenti verdi; nuove prove che fotografano solo il foglio (schermo e modalità stampa, verticale e orizzontale, 4 grandezze, card, maiuscolo, testo sopra) e lo confrontano con l'originale con **differenza zero**; la separazione del CSS non cambia nessuna schermata.
- **Rischi**: le immagini di riferimento dipendono dai caratteri del sistema (le facciamo su Linux in CI, come le altre prove).
- **Windows a mano**: nessuna (non cambia niente di visibile).

### M11-1 — Fondamenta del design (colori, caratteri, spazi, controlli)

- **Obiettivo**: applicare tavolozza, caratteri, spaziature, raggi, ombre e stati dei controlli a tutto l'esistente, **senza spostare niente**.
- **File**: nuovi `ui/src/css/tokens.css`, `ui/src/css/base.css` (pulsanti, campi, selezioni, caselle, interruttori, schede, righe, chip, finestre), e CSS divisi per zona (`css/bars.css`, `css/side.css`, `css/dialogs.css`, `css/docs.css`) presi da `style.css`; classi aggiunte ai pulsanti in `toolbar.ts`, `sidebar.ts`, `docs/*.ts`, `print/dialog.ts`, `about.ts`, `customDialog.ts`.
- **Accettazione**: prova automatica del contrasto su tutte le coppie della tavolozza (≥ 4,5:1 testo, ≥ 3:1 bordi); su ogni controllo il fuoco da tastiera ha un anello di almeno 2 px; foglio con differenza zero (M11-0); schermate prima/dopo di tutti gli stati a 1280, 1366 e 1920.
- **Rischi**: bassi; attenzione a non cambiare i nomi visibili (le prove li usano).
- **Windows a mano**: resa di Segoe UI e Lexend con ClearType; anello di fuoco con Tab; schermo al 125% e al 150%.

### M11-2 — Icone e suggerimenti

- **Obiettivo**: icone coerenti accanto al testo, suggerimenti con nome e scorciatoia che compaiono anche con la tastiera, spiegazione sui pulsanti spenti.
- **File**: nuovi `ui/src/ui/icons.ts`, `ui/src/ui/tooltip.ts`; uso in `toolbar.ts`, `sidebar.ts`, `docs/*.ts`; licenza Lucide in `about.ts` (`CREDITS`).
- **Accettazione**: ogni pulsante solo icona ha un nome; il suggerimento compare con il fuoco; nessuna richiesta di rete durante le prove (la prova controlla che ogni richiesta vada a `localhost`); foglio con differenza zero.
- **Rischi**: bassi.
- **Windows a mano**: le icone sono nitide al 100%, 125%, 150%.

### M11-3 — Finestre, notifiche, conferme (infrastruttura comune)

- **Obiettivo**: un solo componente finestra (Tab che gira dentro, Esc, fuoco che torna), un solo sistema di notifiche, conferme del programma al posto di `window.confirm`.
- **File**: nuovi `ui/src/ui/dialog.ts`, `ui/src/ui/toast.ts`, `ui/src/ui/confirm.ts`; adattati `about.ts`, `customDialog.ts`, `docs/firstrun.ts`, `docs/panel.ts`, `docs/library.ts`, `sidebar.ts`, `app.ts`, `toolbar.ts` (`hooks.notice` → notifica), `docs/session.ts` (la conferma diventa asincrona).
- **Accettazione**: prove da tastiera su ogni finestra (Tab resta dentro, Esc chiude, fuoco torna all'opener); prova che nel codice non c'è più `window.confirm`; le notifiche di problema restano finché non si chiudono, quelle brevi spariscono dopo 6 s; le 128 prove verdi (dove usavano la conferma del browser ora cliccano il pulsante della conferma: si aggiornano i selettori, nessuna prova tolta).
- **Rischi**: **medio**. La chiusura del programma («Il documento non si è salvato… Uscire comunque?») passa da una domanda immediata a una finestra: va provata con cura (prova `closeRequest` e prova a mano 16 di M9a).
- **Windows a mano**: Elimina, Ritira, Dimentica tutto, chiusura con salvataggio fallito; Tab ed Esc nelle finestre.

### M11-4 — Nuova struttura delle barre e barra laterale richiudibile

- **Obiettivo**: intestazione + strumenti su una riga, fascia del documento unica, barra di stato pulita, barra laterale a schede e richiudibile, finestra massimizzata.
- **File**: `app.ts`; `toolbar.ts` diviso in `ui/src/bars/header.ts`, `bars/toolbar.ts`, `bars/statusbar.ts`; nuovo `ui/src/side/panel.ts` (contenitore con schede e chiusura); `docs/lexbar.ts` e `docs/originalbar.ts` dentro la fascia del documento (`ui/src/ui/strip.ts`); `editor/editor.ts` solo per l'ascoltatore di Annulla/Ripeti (K3); `src-tauri/tauri.conf.json`.
- **Accettazione** (Playwright, a 1280×720 e 1366×768): barra degli strumenti alta al massimo 48 px (una riga); intestazione + strumenti + stato ≤ 124 px; con due avvisi ≤ 210 px; A4 orizzontale con barra chiusa senza scorrimento orizzontale; la barra si apre da sola con clic sul simbolo, Alt+↓, F8; Ctrl+Y funziona con il fuoco sulla barra laterale; foglio con differenza zero; le 128 prove verdi.
- **Rischi**: **medio-alto**: tocca il centro dell'app e molte prove usano `.statusbar`, `.lexbar`, `.banner`, `.docbar`. Le classi vecchie restano sui nuovi elementi dove possibile, per ridurre i cambi di selettore.
- **Windows a mano**: avvio massimizzato su 1366×768; Ctrl+Y/Ctrl+Z dopo un clic nella barra laterale; apertura e chiusura della barra; A4 orizzontale.

### M11-5 — Scheda «Pagina» (stampa accanto al foglio)

- **Obiettivo**: le impostazioni di stampa nella barra laterale con il foglio visibile; «Riquadro» e «Bordo» insieme con una figura; casella del piè di pagina onesta (K2).
- **File**: `print/dialog.ts` → `print/panel.ts`; `toolbar.ts`/`bars/toolbar.ts` (tolto il contorno); `print/print.ts` **non cambia** nella parte che genera la pagina.
- **Accettazione**: con le stesse impostazioni la stampa (modalità stampa e PDF di Chromium) è identica a prima; Ctrl+P apre la scheda con il fuoco su «Stampa…»; tutte le prove di stampa di M10 verdi.
- **Rischi**: bassi; la finestra scompare dalla stampa già oggi, la barra laterale anche.
- **Windows a mano**: prove 1–3, 6, 10, 11 di `docs/PROVE-M10.md` con la scheda al posto della finestra.

### M11-6 — Documenti e Biblioteca

- **Obiettivo**: finestra più larga, righe ordinate con un'azione principale e il menu «⋯», modulo Pubblica come sotto-pagina, scheda «Correzioni anonime» separata, impostazione della biblioteca con la parte tecnica chiusa, «Ritira» solo con il permesso vero (K1).
- **File**: `docs/panel.ts`, `docs/library.ts`, `docs/panel-format.ts`; `caa-lib` e `src-tauri` solo per aggiungere `can_retire` ai documenti di biblioteca; `engine/client.ts` (tipo).
- **Accettazione**: prova con due «Maria Rossi»: chi non è autore non vede «Ritira»; «Elimina» solo nel menu e con conferma rossa; Pubblica con «← Indietro»; stati vuoti di 3.6; prove di M9b e M9c verdi (selettori aggiornati); `cargo test` verde.
- **Rischi**: medio (molte prove su `.docs-row`, `.lib-row`); piccola modifica Rust da far rivedere.
- **Windows a mano**: prove 1, 2, 6, 7 di `PROVE-M9b2.md` e 4–9 di `PROVE-M9c3.md` (servono il Drive).

### M11-7 — Scheda «Simbolo» e scheda «Memoria»

- **Obiettivo**: barra laterale più leggibile (sezioni con titolo: alternative, scelte rapide, I miei simboli, Simboli della scuola, opzioni), «Cosa ricordo» sempre raggiungibile nella scheda Memoria, simboli della scuola come etichette intere (K14), «ricorda per sempre» spento dove la politica governa la parola (K4).
- **File**: `sidebar.ts` (diviso in `side/symbol.ts` e `side/memory.ts`).
- **Accettazione**: tutte le prove su `.pm-cell`, `.pm-search`, `.pm-all`, `.side-memory` verdi; tastiera 1–8, Esc, Tab nell'ordine dello schermo; la barra si riempie ancora in meno di 100 ms (misura con il motore finto).
- **Rischi**: medio (la barra è la parte più provata del programma).
- **Windows a mano**: prove 1, 3, 5–8 di `PROVE-M8b.md`, 1–9 di `PROVE-M8c3.md`, 7 di `PROVE-M9c1.md`.

### M11-8 — Primo avvio, stati vuoti, scorciatoie, dimensione dell'interfaccia

- **Obiettivo**: i primi minuti di 3.5, gli stati vuoti di 3.6, la finestra delle scorciatoie (F1), la dimensione dell'interfaccia (3.8).
- **File**: `docs/firstrun.ts`, nuovo `ui/src/ui/help.ts`, invito sopra il foglio (fuori da `.sheet`), `bars/header.ts` (menu Altro), `about.ts` (K18), `docs/session.ts` (K16).
- **Accettazione**: prova «docente nuovo» automatica: primo avvio → invito visibile → si scrive → invito sparito → clic sul simbolo → scelta → Stampa (scheda Pagina) senza altri passaggi; F1 apre e Esc chiude; con «Molto grande» l'interfaccia cresce e **il foglio resta a 20 px di testo** e differenza zero.
- **Rischi**: bassi.
- **Windows a mano**: primo avvio cancellando `settings.json`; dimensione dell'interfaccia «Molto grande» su 1366.

### M11-9 — Rifinitura, revisione, prova con un docente

- **Obiettivo**: testi in italiano semplice (3.10), controllo finale di contrasto e tastiera, revisione indipendente, istruzioni `docs/PROVE-M11.md`, prova del criterio di accettazione con un docente che non ha mai visto il programma.
- **File**: testi sparsi; `docs/PROVE-M11.md`, `docs/RAPPORTO-M11.md`, `docs/PROVE-DA-FARE.md`; `SPEC.md` (sezione Editor e interazione aggiornata con le divergenze approvate, vedi sotto).
- **Accettazione**: 128 prove + quelle nuove verdi; schermate prima/dopo consegnate; il docente scrive e stampa una storia senza aiuto (si annotano i punti in cui esita).
- **Windows a mano**: tutto `PROVE-M11.md` (una pagina, 15 prove circa).

### Cosa si può fare in parallelo

| Fase | Blocchi | In parallelo? | Perché |
| --- | --- | --- | --- |
| 1 | M11-0 | no, da solo | è la rete per tutti gli altri |
| 2 | M11-1 e M11-2 | **sì, due agenti** | file diversi (CSS contro `icons.ts`/`tooltip.ts`); M11-2 aggancia le icone solo dopo che M11-1 ha messo le classi dei pulsanti |
| 3 | M11-3 | no, da solo | infrastruttura usata da tutti |
| 4 | M11-4 | no, da solo | tocca `app.ts` e la struttura che gli altri riempiono |
| 5 | M11-5, M11-6, M11-7 | **sì, tre agenti** | zone separate (stampa, documenti, barra laterale) e CSS già divisi per zona in M11-1; un solo agente tocca `app.ts` |
| 6 | M11-8, poi M11-9 | no | rifinitura e revisione guardano l'insieme |

---

## 6. Vincoli (cosa non cambia)

- **Nessuna funzione nuova.** Si sposta, si raggruppa, si spiega. Le uniche aggiunte sono di accessibilità e aiuto, già nel perimetro scritto di M11 (dimensione dell'interfaccia, finestra delle scorciatoie, invito sul foglio vuoto).
- **Il foglio e la stampa non cambiano aspetto** (prova a differenza zero da M11-0 in poi).
- **Il motore non si tocca** (K4 resta segnalato per dopo).
- **File su disco e formato dei documenti invariati**: `.caa`, `settings.json`, `memoria.json`, cartelle del Drive. L'unica modifica Rust (K1) cambia solo un dato passato all'interfaccia.
- **Nessuna dipendenza di rete in esecuzione**: niente caratteri, icone o immagini da Internet; le icone sono nel codice, i caratteri già incorporati.
- **Le 128 prove Playwright restano verdi**: si aggiornano solo i selettori dove cambiano testo o struttura, **mai togliendo una prova**; i nomi visibili dei pulsanti restano uguali dove possibile.
- **WebView2 su Windows 10 e 11**: niente CSS troppo recente senza alternativa (per esempio `:has()` va bene da Chromium 105, `color-mix()` da 111: WebView2 si aggiorna da solo, ma controllo comunque la versione minima già richiesta da M10, Chromium 131).
- **Le scorciatoie esistenti restano** con gli stessi tasti.

### Divergenze dalla specifica da approvare

Se il piano è approvato, a fine M11 aggiorno `SPEC.md`:

1. «Una barra laterale **fissa** a destra» → barra laterale **richiudibile**, con tre schede (Simbolo, Pagina, Memoria).
2. «Oltre ai pannelli a comparsa Documenti e Biblioteca non ci sono altri pannelli» → la stampa passa da finestra a scheda della barra laterale.
3. «Barra di stato: … politica parole funzionali attiva» → la politica resta solo nella barra degli strumenti (era ripetuta).
4. «Contorna simbolo e parola» passa dalla barra degli strumenti alla scheda Pagina (stesso comportamento: vale per il documento e il computer ricorda l'ultima scelta per i documenti nuovi).

### Cosa non faccio in M11 (e perché)

- Zoom del foglio sullo schermo: rischio su cursore e clic (3.2).
- Tema scuro: vedi 2.1.
- Miniature dei simboli della scuola prima di prenderli: servirebbe leggere le immagini dal Drive (funzione nuova).
- Ricerca e ordinamento in «I miei documenti», cambio del nome da mostrare: funzioni nuove, eventualmente in `docs/IDEE.md`.

---

## 7. Domande per l'utente

1. **Nome e segno del programma.** Nell'intestazione serve un nome corto. Propongo «**Editor CAA**» con un segno semplice disegnato da me (un quadratino sopra una riga: il simbolo sopra la parola), in blu inchiostro. Va bene, o la scuola ha già un nome (e magari dei colori) da usare?
2. **Quanto spostare.** Il piano sposta la stampa dalla finestra alla barra laterale (scheda Pagina), mette «Testo di esempio» e «Informazioni» nel menu «Altro» e separa le «Correzioni anonime» in una scheda propria. Va bene così, oppure preferisci una versione minima che cambia solo l'aspetto e lascia tutto dove è (risparmia circa 4 sessioni ma non risolve D1, D5, D6, D8)?
3. **Dimensione dell'interfaccia regolabile** (Normale / Grande / Molto grande, il foglio non cambia): la vuoi in M11? Costa circa mezza sessione ed è utile a chi vede meno bene.
4. **Il piè di pagina**: va bene la correzione «il tuo nome (Maria Rossi)» al posto di «l'autore»? Oppure per le copie adattate vorresti che si stampasse l'autore dell'originale (richiede di salvare quel nome nella copia: è una modifica ai dati, da fare dopo M11)?
5. **La prova con un docente nuovo** (criterio di chiusura di M11): chi la fa, su quale PC (meglio un portatile piccolo, tra quelli della scuola) e quando? Ne serve almeno uno che non abbia mai visto il programma; se possibile due (uno della primaria, uno della secondaria).

---

## 8. Stima e prima/dopo

### Sforzo per blocco

Una «sessione» è una sessione di lavoro con Claude Code di qualche ora, compresi prove e correzioni.

| Blocco | Sessioni | Note |
| --- | --- | --- |
| M11-0 Rete di sicurezza | 1 | |
| M11-1 Fondamenta del design | 2 | tanti file ma lavoro ripetitivo |
| M11-2 Icone e suggerimenti | 1 | in parallelo con M11-1 |
| M11-3 Finestre, notifiche, conferme | 2 | la chiusura del programma va provata bene |
| M11-4 Struttura e barra laterale | 3 | il blocco più delicato |
| M11-5 Scheda Pagina | 1,5 | in parallelo con 6 e 7 |
| M11-6 Documenti e Biblioteca | 2 | più una piccola modifica Rust |
| M11-7 Schede Simbolo e Memoria | 1,5 | |
| M11-8 Primi minuti, scorciatoie, dimensione | 1 | |
| M11-9 Rifinitura, revisione, prova | 1,5 | più il tempo della prova con il docente |
| **Totale** | **circa 16–17 sessioni** | **circa 11 in tempo reale** con le parti parallele |

### Come vedere il prima e il dopo

- In M11-0 le schermate di questa diagnosi diventano una prova: `npx playwright test --grep @aspetto` produce le stesse immagini (foglio con simboli, barra laterale, Documenti, Biblioteca, Stampa/Pagina, ritaglio, Informazioni, primo avvio, tutte le barre) a **1280×720, 1366×768 e 1920×1080**, in `test-results/aspetto/` (fuori da git).
- Le schermate «prima» si fanno una volta sul codice di oggi e si tengono come artefatto della CI.
- `node scripts/confronto-ui.mjs` crea una pagina `confronto.html` con prima e dopo affiancati, stato per stato: la apri con doppio clic e scorri. Ogni blocco la aggiorna, così vedi i progressi senza installare niente.
- Sul PC Windows: `caa-app.exe` della CI dell'ultimo blocco e `docs/PROVE-M11.md`.

---

## Schermate di questa diagnosi

Cartella di lavoro temporanea (non in git): `/tmp/claude-0/-home-user-CAA/f2446a36-8b59-52a0-9d7d-1fa9dd7f1ced/scratchpad/shots/`. Per ogni larghezza (`1366-…` e `1920-…`):

| File | Stato |
| --- | --- |
| `01-foglio` | foglio con testo e simboli, barra laterale vuota con «Cosa ricordo» |
| `02-alternative`, `02b-ricerca` | barra laterale con le alternative e con una ricerca |
| `03-personalizzato` | tabella «Personalizzato» aperta |
| `04-documenti`, `04b-pubblica` | finestra Documenti e modulo Pubblica |
| `05-biblioteca` | scheda Biblioteca con tre documenti (uno in conflitto) |
| `06-stampa` | finestra Stampa |
| `07-informazioni` | Informazioni |
| `08-ritaglio` | ritaglio del simbolo personale |
| `09-messaggio` | messaggio in basso (Unisci non possibile) |
| `10-barre`, `10b-tutte-le-barre`, `10c-revisione-lessico` | fascia gialla, barra dell'originale, barra del lessico, versione nuova, Drive non raggiungibile |
| `11-primo-avvio` | finestra del nome |
| `12-documenti-vuoto`, `12b-biblioteca-da-collegare` | elenco vuoto e biblioteca da collegare |
| `13-simboli-scuola`, `13b-correzioni` | simboli della scuola e correzioni anonime |
| `14-orizzontale-grande` | A4 orizzontale con simboli molto grandi |

Gli script che le producono sono nella stessa cartella (`shots.js`, `shots2.js`, `kb.js` per la prova del Tab, `contrast.js` per i contrasti).
