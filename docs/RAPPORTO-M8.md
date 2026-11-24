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
