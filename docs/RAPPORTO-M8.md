# Rapporto M8a — Motore collegato all'editor

## Cosa è stato fatto
- Comandi Tauri `engine_info` e `symbolize` (limiti: 1000 paragrafi / 2 MB), protocollo `picto://localhost/<id>` per le immagini locali, ricerca dei dati in `CAA_DATA`, `dati/` accanto al programma, `data/build/`.
- Editor: simboli veri dal motore con cache per paragrafo, ricostruzione solo dei paragrafi toccati, risposte vecchie innocue, ripetizione con attesa crescente in caso di errore, segnaposto tratteggiato, sottolineatura ondulata arancione per le parole dubbie, contatori in barra di stato.
- Politica parole funzionali (Completo/Essenziale), quattro grandezze (Ctrl+1–4), segni ◀ ▶ + per passato, futuro, plurale.
- "Nuovo" e "Testo di esempio" chiedono conferma se c'è testo.

## Bug trovati nelle prove e corretti
- Dopo "Testo di esempio" tornavano le forme finte: `replaceDoc` perdeva il client del motore. Corretto, con prova automatica.
- Il segnaposto su "fatto" ("Ho fatto colazione") era un limite del pacchetto di prova: mancava l'immagine 4625. Pacchetto rigenerato (1.600 immagini).

## Esito delle prove a mano (Windows)
Tutte le prove di `docs/PROVE-M8a.md` superate. I segni ◀ ▶ + sono accettati dall'utente.

## Limiti noti
- "che" esclamativo nascosto in Essenziale.
- Nessun segnaposto per i nomi propri.
- Seconda passata di Viterbi non implementata.
- Gli errori di senso del pittogramma dominano (circa 83% sulle parole piene), con calibrazione debole della confidenza.

## Prossimi passi
M8b editor (menu alternative, "Cerca…", scelte come marcature con annulla/ripeti, Tab/F8 alla parola dubbia, "usa per tutto il testo"), poi M8c.

---

# Rapporto M8b — Correggere un simbolo

## Cosa è stato fatto
- **Motore (solo aggiunte)**: `PictoIndex::search` e `Engine::search_pictos` ("Cerca…": chiave esatta, poi per inizio di parola, poi lemma), `alternatives_of_token`. Metriche invariate: test dorati 48/48, strutture 20/20, corpus sviluppo 6,9 e prova 13,4 correzioni per 100 parole.
- **Ponte Tauri**: `symbolize` riceve per ogni paragrafo le scelte del docente e per il documento i blocchi di senso; nuovi comandi `alternatives` e `search_pictos`; `TokenDto` porta `lemma`, `cat`, `teacher`, `why`. Tetti su scelte e blocchi.
- **Editor**: mark `pick` (parola, pittogramma, blocco, lemma, categoria) che segue il testo e rientra in annulla/ripeti; cache per paragrafo con chiave testo + scelte + blocchi di senso; "Solo testo" (la parola perde lo spazio del simbolo) e "Nessun simbolo" (spazio vuoto, senza segnaposto).
- **Barra laterale fissa** (scelta dell'utente al posto del menu a comparsa): si riempie con clic sul simbolo, Alt+↓, F8 o clic sul contatore; parola evidenziata, foglio che scorre fino a lei; ricerca in cima; 1–8 scelgono solo con il fuoco nella barra; la spunta "usa per tutto il testo" resta com'è.
- **Impostazione "Contorna simbolo e parola"** (card per ogni coppia, ricordata sul computer); pulsanti Annulla e Ripeti.

## Bug trovati nelle prove a mano e corretti (con prova automatica)
- Annulla/ripeti di una scelta non ridisegnava il paragrafo (i mark non hanno mappa di passo).
- La barra si svuotava passando da una parola all'altra e F8 ripetuto si fermava.
- La spunta "usa per tutto il testo" tornava attiva a ogni scelta.
- Il blocco di senso non sostituiva le scelte singole fatte prima sulle parole uguali.

## Esito delle prove a mano (Windows)
Tutte le prove di `docs/PROVE-M8b.md` superate dopo le correzioni sopra ("M8b ok"). Il Ctrl+Y non funzionava all'inizio e non è stato riprodotto in Chromium: aggiunti Ctrl-y esplicito, Ctrl+Maiusc+Z e i pulsanti Annulla/Ripeti.

## Decisioni
- "Nessun simbolo" e "Solo testo" valgono per la sola parola scelta (la spunta si applica solo ai pittogrammi veri).
- La correzione vale nel documento aperto; la memoria fra documenti arriva con M9.
- "Tab fuori dal testo" per la parola dubbia non c'è: F8 e clic sul contatore.

## Limiti noti
- Una parola nascosta dalla politica (articoli in "Essenziale") non ha menu.
- Dopo un cambio di politica la barra può restare ferma finché non si sceglie un'altra parola.
- L'impostazione delle card non è ancora in una finestra delle impostazioni, né nella stampa (M10).
